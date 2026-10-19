/* ====================================================================
   Módulo: Mobilizações — quadro obra × equipamento (substitui o Trello)
   Fase 34 (02/09/2026). Espelha as 7 colunas do quadro "MOBILIZAÇÕES",
   mas a coluna é DERIVADA (vw_mobilizacoes_quadro.coluna): ninguém arrasta
   card. O que move o card: mobilizacoes.status (botões de ação no card),
   obras.status e medicoes.status.

   Regras (SPEC_MOBILIZACOES.md, decisões de 01/09/2026):
   - unidade = obra × equipamento; TAG nula = "XX" (decidida na mobilização)
   - mobilizacoes.status é a única fonte de equipamentos.localizacao_* (trigger)
   - em_transito gera remessa em movimentacoes_ativos; desmobilizar gera retorno
   - pendências por setor nascem do modelo ao criar; "pendência aberta" não
     bloqueia mobilizar (aviso), senão a equipe volta pro WhatsApp
   ==================================================================== */

let _mobCards      = [];      // linhas de vw_mobilizacoes_quadro
let _mobPendSetor  = [];      // linhas de vw_mobilizacao_pendencias_setor
let _mobView       = "quadro"; // quadro | pendencias
let _mobCarregado  = false;
let _mobAberta     = null;    // registro de mobilizacoes aberto no drawer
let _mobAbertaCard = null;    // linha da view correspondente
let _mobPendAberta = [];      // pendências da mobilização aberta
let _mobEquips     = [];      // equipamentos ativos
let _mobObras      = [];      // obras candidatas a nova mobilização
let _mobProfiles   = [];      // responsáveis (profiles ativos)
let _mobKit        = [];      // ids dos acessórios separados para a mobilização aberta (mobilizacoes.acessorios_ids)
let _mobApoioSel   = { mob: [], mobn: [] };   // fase 80: TAGs de apoio escolhidas na ficha (mob) e na nova mobilização (mobn)
const MOB_APOIO_TIPOS = ["bomba", "compressor", "gerador"];
const _mobColapsadas = new Set(["finalizada", "cancelados"]);

const MOB_COLUNAS = [
  { k: "novo_contrato",              label: "Novo contrato",                  cor: "var(--info)" },
  { k: "mobilizando",                label: "Mobilizando",                    cor: "var(--aviso)" },
  { k: "andamento_helice_secante",   label: "Hélice / Secante · em andamento", cor: "var(--marca-600)" },
  { k: "andamento_raiz_trado",       label: "Raiz / Trado · em andamento",     cor: "var(--marca-700)" },
  { k: "finalizada_medicao_pendente",label: "Finalizadas · medição pendente",  cor: "var(--marca-laranja)" },
  { k: "finalizada",                 label: "Finalizadas",                    cor: "var(--sucesso)" },
  { k: "cancelados",                 label: "Cancelados",                     cor: "var(--txt-fraco)" }
];
const MOB_STATUS = { prevista: "Prevista", em_preparacao: "Em preparação", em_transito: "Em trânsito", em_obra: "Em obra", desmobilizada: "Desmobilizada", cancelada: "Cancelada" };
const MOB_SETOR  = { engenharia: "Engenharia", sesmt: "SESMT", rh: "RH", manutencao: "Manutenção", almoxarifado: "Almoxarifado", logistica: "Logística", comercial: "Comercial" };
// profiles.cargo → setor cujas pendências a pessoa vê em "Minhas pendências"
const MOB_CARGO_SETOR = { engenheiro: "engenharia", assistente_engenharia: "engenharia", encarregado: "engenharia", operador: "engenharia", sesmt: "sesmt", rh: "rh", mecanico: "manutencao", almoxarife: "almoxarifado", comprador: "almoxarifado", gestor_acessorios: "almoxarifado", logistica: "logistica", comercial: "comercial" };
const MOB_TIPO_ICONE = { helice: "🌀", secante: "🌀", raiz: "🌱", trado: "🔩", outro: "⚙️" };
// transições válidas por status atual (quem pode é o RLS + regra no confirmar)
const MOB_TRANSICOES = {
  prevista:      [["em_preparacao", "▶ Iniciar preparação", "btn"], ["cancelada", "✕ Cancelar", "btn-sec txt-perigo"]],
  em_preparacao: [["em_transito", "🚚 Saiu para a obra (gera remessa)", "btn"], ["cancelada", "✕ Cancelar", "btn-sec txt-perigo"]],
  em_transito:   [["em_obra", "🏗️ Chegou na obra", "btn btn-sucesso"], ["cancelada", "✕ Cancelar", "btn-sec txt-perigo"]],
  em_obra:       [["desmobilizada", "↩ Desmobilizar (gera retorno)", "btn"]],
  desmobilizada: [], cancelada: []
};

function mobSetorDoUsuario(){
  const cargo = usuarioAtual?.cargo;
  if(!cargo || ["diretor", "admin", "auditor"].includes(cargo)) return null; // vê todos
  return MOB_CARGO_SETOR[cargo] || null;
}

/* ---------- Carga ---------- */
async function carregarMobilizacoes(forcar){
  if(_mobCarregado && !forcar) return;
  const cont = $("mob-conteudo");
  if(cont && !_mobCarregado) cont.innerHTML = `<p class="vazio">Carregando quadro…</p>`;
  const [qRes, pRes, eRes, oRes, prRes] = await Promise.all([
    sb.from("vw_mobilizacoes_quadro").select("*").order("data_mobilizacao_prev", { ascending: true, nullsFirst: false }),
    sb.from("vw_mobilizacao_pendencias_setor").select("*"),
    sb.from("equipamentos").select("id,codigo,nome,tipo,status,localizacao_tipo,localizacao_obra_id").eq("ativo", true).order("codigo"),
    sb.from("obras").select("id,codigo,nome,status,contrato_id,cliente_id,cidade,uf").not("status", "in", "(cancelada)").order("codigo", { ascending: false }),
    sb.from("profiles").select("id,nome,cargo").eq("ativo", true).order("nome")
  ]);
  if(qRes.error){ aviso("app-aviso", "Não foi possível carregar as mobilizações: " + qRes.error.message, "erro"); return; }
  _mobCards     = qRes.data || [];
  _mobPendSetor = pRes.data || [];
  _mobEquips    = eRes.data || [];
  _mobObras     = oRes.data || [];
  _mobProfiles  = prRes.data || [];
  _mobCarregado = true;
  preencherFiltrosMob();
  renderMobilizacoes();
}

function preencherFiltrosMob(){
  const selCli = $("mob-f-cliente"), selTag = $("mob-f-tag"), selSetor = $("mob-f-setor");
  if(selCli){
    const v = selCli.value;
    const clientes = [...new Set(_mobCards.map(c => c.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    selCli.innerHTML = '<option value="">Todos os clientes</option>' + clientes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    selCli.value = clientes.includes(v) ? v : "";
  }
  if(selTag){
    const v = selTag.value;
    const tags = [...new Set(_mobCards.map(c => c.equipamento_tag).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
    selTag.innerHTML = '<option value="">Todas as TAGs</option>' + tags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    selTag.value = tags.includes(v) ? v : "";
  }
  if(selSetor && !selSetor.options.length){
    selSetor.innerHTML = '<option value="">Qualquer setor pendente</option>' + Object.entries(MOB_SETOR).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
  }
}

/* ---------- Render ---------- */
function renderMobilizacoes(){
  // KPIs
  const ativos = _mobCards.filter(c => ["novo_contrato", "mobilizando", "andamento_helice_secante", "andamento_raiz_trado"].includes(c.coluna));
  const pendAb = ativos.reduce((s, c) => s + (Number(c.pendencias_abertas) || 0), 0);
  const atras  = ativos.filter(c => c.tem_atrasada).length;
  const emObra = new Set(_mobCards.filter(c => c.mob_status === "em_obra" && c.equipamento_id).map(c => c.equipamento_id)).size;
  const kp = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  kp("mob-kpi-ativas", ativos.length);
  kp("mob-kpi-pend", pendAb);
  kp("mob-kpi-atrasadas", atras);
  kp("mob-kpi-maquinas", emObra);
  const minhas = _mobPendSetor.filter(p => !p.concluida && (!mobSetorDoUsuario() || p.setor === mobSetorDoUsuario())).length;
  kp("mob-kpi-minhas", minhas);
  const badge = $("mob-minhas-badge"); if(badge) badge.textContent = minhas || "";

  document.querySelectorAll("#sec-mobilizacoes .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _mobView));
  if(_mobView === "pendencias") renderMinhasPendenciasMob(); else renderQuadroMob();
}

function mobFiltrados(){
  const termo = ($("mob-busca")?.value || "").trim().toLowerCase();
  const cli = $("mob-f-cliente")?.value || "", tag = $("mob-f-tag")?.value || "", setor = $("mob-f-setor")?.value || "";
  return _mobCards.filter(c => {
    if(cli && c.cliente !== cli) return false;
    if(tag && c.equipamento_tag !== tag) return false;
    if(setor && !(c.setores_pendentes || []).includes(setor)) return false;
    if(termo && !`${c.titulo_card} ${c.obra_nome || ""} ${c.contrato_numero || ""} ${c.apoio_tags || ""}`.toLowerCase().includes(termo)) return false;
    return true;
  });
}

function mobBadgePend(c){
  const ab = Number(c.pendencias_abertas) || 0, tot = Number(c.pendencias_total) || 0;
  if(!tot) return "";
  const cls = c.tem_atrasada ? "perigo" : (ab ? "aviso" : "ok");
  const txt = ab ? `${ab}/${tot} pend.` : `✓ ${tot}/${tot}`;
  const setores = (c.setores_pendentes || []).map(s => MOB_SETOR[s] || s).join(", ");
  return `<span class="mob-badge ${cls}" title="${esc(setores || "todas as pendências concluídas")}">${c.tem_atrasada ? "⏰ " : ""}${txt}</span>`;
}

function cardMobHTML(c){
  const dias = c.data_mobilizacao_prev ? Math.round((new Date(c.data_mobilizacao_prev + "T00:00:00") - new Date(hojeISO() + "T00:00:00")) / 86400000) : null;
  const quando = c.data_mobilizacao_prev
    ? `📅 ${dataBR(c.data_mobilizacao_prev)}${(dias != null && ["novo_contrato", "mobilizando"].includes(c.coluna)) ? ` <span class="meta">(${dias < 0 ? `há ${-dias} d` : dias === 0 ? "hoje" : `em ${dias} d`})</span>` : ""}`
    : `<span class="meta">sem data prevista</span>`;
  const med = ["finalizada_medicao_pendente", "finalizada"].includes(c.coluna)
    ? `<span class="mob-badge ${Number(c.medicoes_abertas) ? "aviso" : (Number(c.medicoes_faturadas) ? "ok" : "perigo")}">💰 ${Number(c.medicoes_abertas) ? c.medicoes_abertas + " aberta(s)" : (Number(c.medicoes_faturadas) ? c.medicoes_faturadas + " faturada(s)" : "sem medição")}</span>` : "";
  const icone = MOB_TIPO_ICONE[c.tipo_proposta] || "⚙️";
  return `<div class="mob-card" data-id="${esc(c.id)}" style="border-left-color:${(MOB_COLUNAS.find(x => x.k === c.coluna) || {}).cor || "var(--sup-3)"}" tabindex="0" role="button" aria-label="Abrir mobilização ${esc(c.titulo_card)}">
    <div class="mob-card-titulo">${icone} ${esc(c.titulo_card)}</div>
    ${c.obra_codigo && c.obra_id ? `<div class="meta">🏗️ ${linkObra(c.obra_id, `${c.obra_codigo} — ${c.obra_nome || ""}`.trim())}</div>` : ""}
    <div class="mob-card-chips">
      <span class="mob-chip tag">${esc(c.equipamento_tag || "XX")}</span>
      ${c.apoio_tags ? `<span class="mob-chip">+ ${esc(c.apoio_tags)}</span>` : ""}
      <span class="mob-chip st">${esc(MOB_STATUS[c.mob_status] || c.mob_status)}</span>
    </div>
    <div class="mob-card-rodape">
      <span>${quando}</span>
      ${mobBadgePend(c)}${med}
    </div>
  </div>`;
}

function renderQuadroMob(){
  const cont = $("mob-conteudo");
  if(!cont) return;
  const dados = mobFiltrados();
  if(!_mobCards.length){
    cont.innerHTML = `<p class="vazio">Nenhuma mobilização ainda. Clique em <strong>+ Nova mobilização</strong> ou importe os cards do Trello.</p>`;
    return;
  }
  const porCol = {};
  MOB_COLUNAS.forEach(c => porCol[c.k] = []);
  dados.forEach(c => (porCol[c.coluna] || (porCol[c.coluna] = [])).push(c));
  cont.innerHTML = `<div class="mob-quadro">${MOB_COLUNAS.map(col => {
    const cards = porCol[col.k] || [];
    const colapsada = _mobColapsadas.has(col.k);
    return `<div class="mob-col${colapsada ? " colapsada" : ""}" data-col="${col.k}">
      <div class="mob-col-titulo" style="border-top-color:${col.cor}">
        <span>${esc(col.label)}</span><span class="mob-col-n">${cards.length}</span>
        <button type="button" class="mob-col-toggle" title="${colapsada ? "mostrar" : "recolher"}" aria-label="${colapsada ? "Mostrar" : "Recolher"} coluna ${esc(col.label)}">${colapsada ? "▸" : "▾"}</button>
      </div>
      ${colapsada ? "" : (cards.length ? cards.map(cardMobHTML).join("") : `<p class="vazio mob-vazio">—</p>`)}
    </div>`;
  }).join("")}</div>`;
  cont.querySelectorAll(".mob-card").forEach(el => el.addEventListener("click", () => abrirMobilizacao(el.dataset.id)));
  cont.querySelectorAll(".mob-col-toggle").forEach(b => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const k = b.closest(".mob-col").dataset.col;
    if(_mobColapsadas.has(k)) _mobColapsadas.delete(k); else _mobColapsadas.add(k);
    renderQuadroMob();
  }));
}

/* ---------- Minhas pendências (tela do celular de cada setor) ---------- */
function renderMinhasPendenciasMob(){
  const cont = $("mob-conteudo");
  if(!cont) return;
  const setorUser = mobSetorDoUsuario();
  const selSetor = $("mob-f-setor");
  const setorFiltro = (selSetor && selSetor.value) || setorUser || "";
  const termo = ($("mob-busca")?.value || "").trim().toLowerCase();
  const lista = _mobPendSetor
    .filter(p => !setorFiltro || p.setor === setorFiltro)
    .filter(p => !termo || `${p.titulo} ${p.titulo_card}`.toLowerCase().includes(termo))
    .sort((a, b) => (Number(b.atrasada) - Number(a.atrasada)) || (Number(a.concluida) - Number(b.concluida))
      || String(a.prazo || "9999").localeCompare(String(b.prazo || "9999")) || String(a.data_mobilizacao_prev || "9999").localeCompare(String(b.data_mobilizacao_prev || "9999")));
  const abertas = lista.filter(p => !p.concluida);
  const cab = `<div class="mob-pend-topo">
    <span>${setorFiltro ? `Setor <strong>${esc(MOB_SETOR[setorFiltro] || setorFiltro)}</strong>` : "Todos os setores"} · <strong>${abertas.length}</strong> aberta(s)${abertas.filter(p => p.atrasada).length ? ` · <span class="txt-perigo">${abertas.filter(p => p.atrasada).length} atrasada(s)</span>` : ""}</span>
    <span class="meta">Marque a caixa ao concluir. Mobilizações já em obra não aparecem aqui.</span>
  </div>`;
  if(!lista.length){ cont.innerHTML = cab + `<p class="vazio">🎉 Nenhuma pendência para este setor.</p>`; return; }
  const resp = (id) => (_mobProfiles.find(p => p.id === id) || {}).nome || "";
  cont.innerHTML = cab + `<div class="mob-pend-lista">${lista.map(p => `
    <label class="mob-pend${p.atrasada ? " atrasada" : ""}${p.concluida ? " feita" : ""}">
      <input type="checkbox" data-pend="${esc(p.id)}" ${p.concluida ? "checked" : ""} />
      <span class="mob-pend-txt">
        <span class="mob-pend-titulo">${esc(p.titulo)}</span>
        <span class="meta"><a href="#" class="mob-pend-card" data-mob="${esc(p.mobilizacao_id)}">${esc(p.titulo_card)}</a>${p.data_mobilizacao_prev ? ` · mobiliza ${dataBR(p.data_mobilizacao_prev)}` : ""}</span>
      </span>
      <span class="mob-pend-meta">
        <span class="mob-chip">${esc(MOB_SETOR[p.setor] || p.setor)}</span>
        ${p.prazo ? `<span class="mob-chip${p.atrasada ? " perigo" : ""}">⏰ ${dataBR(p.prazo)}</span>` : ""}
        ${p.responsavel_id ? `<span class="mob-chip">👤 ${esc(resp(p.responsavel_id))}</span>` : ""}
      </span>
    </label>`).join("")}</div>`;
  cont.querySelectorAll("input[data-pend]").forEach(cb => cb.addEventListener("change", () => concluirPendenciaMob(cb.dataset.pend, cb.checked, cb)));
  cont.querySelectorAll(".mob-pend-card").forEach(a => a.addEventListener("click", (e) => { e.preventDefault(); abrirMobilizacao(a.dataset.mob); }));
}

async function concluirPendenciaMob(id, concluida, cb){
  const { error } = await sb.from("mobilizacao_pendencias").update({ concluida }).eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível atualizar a pendência: " + error.message, "erro"); if(cb) cb.checked = !concluida; return; }
  const p = _mobPendSetor.find(x => x.id === id); if(p) p.concluida = concluida;
  const pa = _mobPendAberta.find(x => x.id === id); if(pa) pa.concluida = concluida;
  // recarrega o quadro em segundo plano (badges de pendência mudam)
  carregarMobilizacoes(true);
}

/* ---------- Drawer da mobilização ---------- */
async function abrirMobilizacao(id){
  const [{ data: m, error }, { data: pend }] = await Promise.all([
    sb.from("mobilizacoes").select("*").eq("id", id).single(),
    sb.from("mobilizacao_pendencias").select("*").eq("mobilizacao_id", id).order("ordem")
  ]);
  if(error || !m){ aviso("app-aviso", "Não foi possível abrir a mobilização.", "erro"); return; }
  _mobAberta = m;
  _mobAbertaCard = _mobCards.find(c => c.id === id) || {};
  _mobPendAberta = pend || [];
  _mobKit = Array.isArray(m.acessorios_ids) ? [...m.acessorios_ids] : [];
  renderDrawerMob();
  $("mob-modal").style.display = "flex";
}
function fecharMobilizacao(){
  $("mob-modal").style.display = "none"; _mobAberta = null;
  // Aberta a partir da ficha da obra (aba Mobilização & equipamentos): recarrega a aba ao fechar
  if(typeof obraEditId !== "undefined" && obraEditId && document.querySelector("#sec-obras.ativa") && typeof carregarEquipamentosDaObra === "function") carregarEquipamentosDaObra(obraEditId);
}

/* fase 80: onde a TAG está agora (vem do status da mobilização, pelo gatilho) */
function mobEquipOnde(e){
  const o = e.localizacao_obra_id ? _mobObras.find(x => x.id === e.localizacao_obra_id) : null;
  switch(e.localizacao_tipo){
    case "obra": return "em " + (o ? o.codigo : "obra");
    case "em_transito": return "em trânsito" + (o ? " → " + o.codigo : "");
    case "fornecedor_manutencao": return "em manutenção externa";
    case "cliente": return "no cliente";
    default: return "na base";
  }
}
/* fase 80: TAGs de apoio por busca (bomba, compressor e gerador; "todos os tipos" para segunda perfuratriz ou
   caminhão). Cada resultado diz onde a TAG está; a que está em outra obra aparece com aviso, não some. */
function mobApoioHTML(pref){
  return `<div id="${pref}-apoio-chips" class="mob-acoes" style="margin:0 0 6px;"></div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <input id="${pref}-apoio-busca" placeholder="buscar bomba, compressor ou gerador por TAG ou nome…" autocomplete="off" style="flex:1;min-width:220px;" />
      <label class="check-inline"><input type="checkbox" id="${pref}-apoio-todos" /> todos os tipos</label>
    </div>
    <div id="${pref}-apoio-res" class="autocomplete-lista" style="display:none;"></div>`;
}
function mobLigarApoio(pref, obraId, principalSelId){
  const inp = $(`${pref}-apoio-busca`), lista = $(`${pref}-apoio-res`), todos = $(`${pref}-apoio-todos`), chips = $(`${pref}-apoio-chips`);
  if(!inp || !lista) return;
  const obraAtual = () => (typeof obraId === "function" ? obraId() : obraId) || null;
  const renderChips = () => {
    chips.innerHTML = _mobApoioSel[pref].map(id => { const e = _mobEquips.find(x => x.id === id) || { codigo: "?" };
      return `<span class="mob-chip">${esc(e.codigo)}${e.nome ? ` <span class="meta">${esc(e.nome)}</span>` : ""} <button type="button" class="btn-rem" data-rem="${esc(id)}" title="tirar do apoio">&times;</button></span>`; }).join("")
      || `<span class="meta">Nenhuma TAG de apoio.</span>`;
    chips.querySelectorAll("[data-rem]").forEach(b => b.addEventListener("click", () => { _mobApoioSel[pref] = _mobApoioSel[pref].filter(x => x !== b.dataset.rem); renderChips(); }));
  };
  const mostrar = () => {
    const termo = inp.value.trim().toLowerCase(), principal = $(principalSelId)?.value || null, obra = obraAtual();
    const cands = _mobEquips.filter(e => e.id !== principal && !_mobApoioSel[pref].includes(e.id)
      && (todos?.checked || MOB_APOIO_TIPOS.includes(e.tipo))
      && (!termo || `${e.codigo} ${e.nome || ""} ${e.tipo || ""}`.toLowerCase().includes(termo)));
    lista.innerHTML = cands.slice(0, 40).map(e => {
      const outra = ["obra", "em_transito"].includes(e.localizacao_tipo) && e.localizacao_obra_id && e.localizacao_obra_id !== obra;
      return `<div class="resultado-item" data-id="${esc(e.id)}"><strong>${esc(e.codigo)}</strong> — ${esc(e.nome || "")} <span class="meta">${esc(e.tipo || "")} · ${esc(mobEquipOnde(e))}${e.status ? " · " + esc(e.status) : ""}</span>${outra ? ' <span class="tag ambar">em outra obra</span>' : ""}</div>`;
    }).join("") || `<div class="resultado-item vazio">Nenhuma TAG${todos?.checked ? "" : " de bomba, compressor ou gerador"} com esse termo.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("mousedown", ev => {
      ev.preventDefault(); _mobApoioSel[pref].push(d.dataset.id); inp.value = ""; renderChips(); mostrar();
    }));
  };
  inp.addEventListener("focus", mostrar);
  inp.addEventListener("input", mostrar);
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 150));
  todos?.addEventListener("change", () => { if(document.activeElement === inp || lista.style.display !== "none") mostrar(); });
  renderChips();
}

function mobEquipOpts(sel, filtro){
  const lista = _mobEquips.filter(filtro || (() => true));
  return '<option value="">— XX (a definir) —</option>' + lista.map(e => `<option value="${esc(e.id)}"${e.id === sel ? " selected" : ""}>${esc(e.codigo)} — ${esc(e.nome)} · ${esc(mobEquipOnde(e))}</option>`).join("");
}

function renderDrawerMob(){
  const m = _mobAberta, c = _mobAbertaCard || {};
  const cont = $("mob-modal-conteudo");
  if(!cont || !m) return;
  const col = MOB_COLUNAS.find(x => x.k === c.coluna) || {};
  const est = Array.isArray(m.estacas_resumo) ? m.estacas_resumo : [];
  const podeEditar = usuarioAtual && ["diretor", "admin", "engenheiro", "assistente_engenharia", "comercial", "encarregado", "logistica"].includes(usuarioAtual.cargo);
  const porQuem = (id, v) => `<select id="${id}"><option value="">—</option><option value="cgl"${v === "cgl" ? " selected" : ""}>CGL</option><option value="cliente"${v === "cliente" ? " selected" : ""}>Cliente</option></select>`;
  const simNao = (id, v) => `<select id="${id}"><option value="">—</option><option value="true"${v === true ? " selected" : ""}>Sim</option><option value="false"${v === false ? " selected" : ""}>Não</option></select>`;
  _mobApoioSel.mob = [...(m.equipamentos_apoio || [])];
  const transicoes = (MOB_TRANSICOES[m.status] || []).map(([st, lbl, cls]) => `<button type="button" class="${cls}" data-mob-status="${st}">${lbl}</button>`).join("");
  const respOpts = (sel) => '<option value="">— responsável —</option>' + _mobProfiles.map(p => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.nome)}</option>`).join("");
  const porSetor = {};
  _mobPendAberta.forEach(p => (porSetor[p.setor] = porSetor[p.setor] || []).push(p));
  const pendHTML = Object.keys(MOB_SETOR).filter(s => porSetor[s]).map(s => `
    <div class="mob-pend-setor">
      <div class="mob-pend-setor-titulo">${esc(MOB_SETOR[s])} <span class="meta">${porSetor[s].filter(p => !p.concluida).length} aberta(s)</span></div>
      ${porSetor[s].map(p => {
        const atras = p.prazo && !p.concluida && p.prazo < hojeISO();
        return `<div class="mob-pend${atras ? " atrasada" : ""}${p.concluida ? " feita" : ""}" data-pend-row="${esc(p.id)}">
          <input type="checkbox" data-pend="${esc(p.id)}" ${p.concluida ? "checked" : ""} title="concluir" />
          <span class="mob-pend-txt"><span class="mob-pend-titulo">${esc(p.titulo)}</span>${p.concluida && p.concluida_em ? `<span class="meta">concluída em ${dataBR(String(p.concluida_em).slice(0, 10))}</span>` : ""}</span>
          <select class="mob-pend-resp" data-pend="${esc(p.id)}" title="responsável">${respOpts(p.responsavel_id)}</select>
          <input type="date" class="mob-pend-prazo" data-pend="${esc(p.id)}" value="${esc(p.prazo || "")}" title="prazo" />
          <input type="text" class="mob-pend-obs" data-pend="${esc(p.id)}" value="${esc(p.observacao || "")}" placeholder="observação" />
        </div>`; }).join("")}
    </div>`).join("") || `<p class="vazio">Sem pendências geradas.</p>`;

  cont.innerHTML = `
    <div class="mob-drawer-topo">
      <div>
        <div class="mob-drawer-titulo">${MOB_TIPO_ICONE[c.tipo_proposta] || "⚙️"} ${esc(c.titulo_card || "Mobilização")}</div>
        <div class="mob-drawer-sub">
          <span class="mob-chip st">${esc(MOB_STATUS[m.status] || m.status)}</span>
          <span class="mob-chip" style="border-color:${col.cor || "var(--sup-3)"}">${esc(col.label || "")}</span>
          ${c.obra_codigo ? `🏗️ ${linkObra(m.obra_id, `${c.obra_codigo} — ${c.obra_nome || ""}`.trim())}` : ""}
          ${m.trello_card_url ? `<a href="${esc(m.trello_card_url)}" target="_blank" rel="noopener" class="meta">card no Trello ↗</a>` : ""}
        </div>
      </div>
      <button type="button" class="btn-sec" id="btn-mob-fechar" aria-label="Fechar">×</button>
    </div>

    <div class="mob-acoes">${transicoes || `<span class="meta">Sem ações de status disponíveis.</span>`}
      ${m.movimentacao_remessa_id ? `<span class="mob-chip ok">remessa gerada</span>` : ""}${m.movimentacao_retorno_id ? `<span class="mob-chip ok">retorno gerado</span>` : ""}
    </div>

    <div class="mob-sec"><h4>1 · Mobilização</h4>
      <div class="grade">
        <div class="campo"><label>Mobilização prevista</label><input type="date" id="mob-data-prev" value="${esc(m.data_mobilizacao_prev || "")}" /></div>
        <div class="campo"><label>Início de obra previsto</label><input type="date" id="mob-data-inicio" value="${esc(m.data_inicio_obra_prev || "")}" /></div>
        <div class="campo"><label>TAG principal</label><select id="mob-equip">${mobEquipOpts(m.equipamento_id)}</select></div>
        <div class="campo"><label>Saída real</label><input type="date" id="mob-data-saida" value="${esc(m.data_saida_real || "")}" /></div>
        <div class="campo"><label>Chegada real</label><input type="date" id="mob-data-chegada" value="${esc(m.data_chegada_real || "")}" /></div>
        <div class="campo"><label>Desmobilização real</label><input type="date" id="mob-data-desmob" value="${esc(m.data_desmob_real || "")}" /></div>
        <div class="campo largo"><label>TAGs de apoio (bomba, compressor, gerador)</label>${mobApoioHTML("mob")}</div>
      </div>
    </div>

    <div class="mob-sec"><h4>2 · Estacas <span class="meta">(resumo do projeto — o detalhe fica na aba Estacas da obra)</span></h4>
      <div class="tabela-rola"><table class="itens-tabela mob-est-tabela">
        <thead><tr><th>Qtd.</th><th>Ø (mm)</th><th>Prof. mín. (m)</th><th>Prof. máx. (m)</th><th>Obs.</th><th></th></tr></thead>
        <tbody id="mob-est-tbody">${est.map(e => mobEstacaLinhaHTML(e)).join("")}</tbody>
      </table></div>
      <button type="button" class="btn-sec btn-sm" id="btn-mob-est-add">+ linha</button>
    </div>

    <div class="mob-sec"><h4>3 · Itens da mobilização <span class="meta">(kit de acessórios que sai na remessa + materiais do almoxarifado; a viagem leva tudo)</span></h4>
      <div id="mob-viagens" class="mob-card-chips" style="margin-bottom:6px;"><span class="meta">Carregando viagens…</span></div>
      <div id="mob-sep" class="mob-card-chips"></div>
      <div class="meta" style="font-weight:600;margin:6px 0 4px;">Acessórios (kit)</div>
      <div id="mob-kit"><p class="vazio">Carregando peças…</p></div>
      <div class="meta" style="font-weight:600;margin:12px 0 4px;">Materiais <span style="font-weight:400;">(consumíveis e peças sem marcação; viram itens da separação)</span></div>
      <div id="mob-materiais"><p class="vazio">Carregando…</p></div>
    </div>

    <div class="mob-sec"><h4>4 · Observações técnicas</h4>
      <div class="grade">
        <div class="campo"><label>Concreto usinado</label>${simNao("mob-concreto", m.concreto_usinado)}</div>
        <div class="campo"><label>Martelo</label>${simNao("mob-martelo", m.martelo)}</div>
        <div class="campo"><label>Tricone</label>${simNao("mob-tricone", m.tricone)}</div>
        <div class="campo"><label>Torre baixa</label>${simNao("mob-torre", m.torre_baixa)}</div>
      </div>
    </div>

    <div class="mob-sec"><h4>5 · Endereço e contato da obra</h4>
      <p class="meta">${esc([c.cliente, c.cidade && c.uf ? `${c.cidade} / ${c.uf}` : (c.cidade || "")].filter(Boolean).join(" — ") || "Endereço na ficha da obra.")}</p>
      <div class="grade">
        <div class="campo"><label>Contato na obra</label><input id="mob-contato-nome" value="${esc(m.contato_obra_nome || "")}" /></div>
        <div class="campo"><label>Telefone</label><input id="mob-contato-tel" value="${esc(m.contato_obra_telefone || "")}" /></div>
      </div>
    </div>

    <div class="mob-sec"><h4>6 · Condições</h4>
      <div class="grade">
        <div class="campo"><label>Alimentação interna por</label>${porQuem("mob-alim", m.alimentacao_interna_por)}</div>
        <div class="campo"><label>Diesel por</label>${porQuem("mob-diesel", m.diesel_por)}</div>
        <div class="campo"><label>Hospedagem por</label>${porQuem("mob-hosp", m.hospedagem_por)}</div>
        <div class="campo largo"><label>Observações</label><textarea id="mob-obs" rows="2">${esc(m.observacoes || "")}</textarea></div>
      </div>
      ${podeEditar ? `<div class="form-acoes compacta"><button type="button" class="btn" id="btn-mob-salvar">💾 Salvar alterações</button></div>` : ""}
    </div>

    <div class="mob-sec"><h4>7 · Pendências por setor <span class="meta">${_mobPendAberta.filter(p => !p.concluida).length} aberta(s) de ${_mobPendAberta.length}</span></h4>
      ${pendHTML}
    </div>

    <div class="mob-sec"><h4>8 · Conversa</h4><div id="mob-chatter"></div></div>
  `;

  $("btn-mob-fechar")?.addEventListener("click", fecharMobilizacao);
  $("btn-mob-salvar")?.addEventListener("click", () => comBotaoTravado("btn-mob-salvar", salvarMobilizacao));
  $("btn-mob-est-add")?.addEventListener("click", () => $("mob-est-tbody").insertAdjacentHTML("beforeend", mobEstacaLinhaHTML({})));
  cont.querySelectorAll("[data-mob-status]").forEach(b => b.addEventListener("click", () => mudarStatusMobilizacao(b.dataset.mobStatus, b)));
  cont.querySelectorAll("input[type=checkbox][data-pend]").forEach(cb => cb.addEventListener("change", () => concluirPendenciaMob(cb.dataset.pend, cb.checked, cb)));
  cont.querySelectorAll(".mob-pend-resp").forEach(s => s.addEventListener("change", () => atualizarPendenciaMob(s.dataset.pend, { responsavel_id: s.value || null })));
  cont.querySelectorAll(".mob-pend-prazo").forEach(i => i.addEventListener("change", () => atualizarPendenciaMob(i.dataset.pend, { prazo: i.value || null })));
  cont.querySelectorAll(".mob-pend-obs").forEach(i => i.addEventListener("change", () => atualizarPendenciaMob(i.dataset.pend, { observacao: i.value.trim() || null })));
  cont.addEventListener("click", (e) => { if(e.target.classList.contains("mob-est-rem")) e.target.closest("tr").remove(); });
  if(typeof montarHistorico === "function") montarHistorico("mobilizacoes", m.id, "mob-chatter");
  mobLigarApoio("mob", m.obra_id, "mob-equip");
  mobRenderKit();
  mobRenderMateriais();   // fase 83
  mobRenderSeparacao();
  mobRenderViagens();     // fase 89
}

/* ---------- Fase 89: viagens da mobilização (ida e volta) ----------
   Chips "Viagem VG-…" na seção 3 e o botão "Programar viagem" (cria a viagem de ida planejada e abre a ficha
   em Logística para pôr caminhão, motorista e data). A ficha da viagem volta para esta mobilização. */
async function mobRenderViagens(){
  const box = $("mob-viagens"); const m = _mobAberta; if(!box || !m) return;
  const ids = [m.viagem_ida_id, m.viagem_volta_id].filter(Boolean);
  const { data } = ids.length ? await sb.from("viagens").select("id,numero,status,data,caminhao:equipamentos!caminhao_id(codigo),funcionario:funcionarios(nome)").in("id", ids) : { data: [] };
  if(!$("mob-viagens") || _mobAberta !== m) return;
  const pode = typeof logPodeOperar === "function" ? logPodeOperar() : false;
  const chip = (id, rot) => {
    const v = (data || []).find(x => x.id === id); if(!v) return "";
    const st = (typeof STATUS !== "undefined" && STATUS.viagem && STATUS.viagem[v.status]) || { label: v.status };
    return `<a href="#" class="mob-chip ${v.status === "concluida" ? "ok" : "st"}" data-vg="${esc(v.id)}" title="abrir a viagem em Logística">🚚 ${rot} ${esc(v.numero)} · ${esc(st.label)} · ${v.caminhao ? esc(v.caminhao.codigo) : "sem caminhão"}${v.funcionario ? " · " + esc(v.funcionario.nome) : ""}</a>`;
  };
  const podeProgramar = pode && !m.viagem_ida_id && ["prevista", "em_preparacao"].includes(m.status);
  box.innerHTML = chip(m.viagem_ida_id, "Viagem de ida") + chip(m.viagem_volta_id, "Viagem de volta")
    + (podeProgramar ? `<button type="button" class="btn-sec btn-sm" id="btn-mob-programar-viagem" title="cria a viagem de mobilização (planejada) e abre a ficha para pôr caminhão, motorista e data">🚚 Programar viagem</button>` : "")
    + (!ids.length && !podeProgramar ? `<span class="meta">Sem viagem gerada.</span>` : "");
  box.querySelectorAll("a[data-vg]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); mobAbrirViagem(a.dataset.vg); }));
  $("btn-mob-programar-viagem")?.addEventListener("click", () => comBotaoTravado("btn-mob-programar-viagem", async () => {
    try {
      await salvarMobilizacaoSilencioso();
      const vg = await mobGarantirViagem(_mobAberta, "ida");
      await carregarMobilizacoes(true);
      mobAbrirViagem(vg.id);
    } catch(err){ aviso("app-aviso", "Não foi possível programar a viagem: " + err.message, "erro"); }
  }));
}
function mobAbrirViagem(id){
  const mobId = _mobAberta?.id;
  fecharMobilizacao();
  if(!irParaSecao("frota") || typeof abrirViagem !== "function") return;
  abrirViagem(id, async () => { if(irParaSecao("mobilizacoes")){ await carregarMobilizacoes(false); abrirMobilizacao(mobId); } });
}

/* ---------- Fase 83: materiais da mobilização e separação ----------
   Além do kit de acessórios, a mobilização pré-configura os materiais do almoxarifado (mobilizacao_materiais).
   "Gerar separação" cria a lista (kit + materiais) para o almoxarife de plantão; a baixa acontece lá, ao marcar. */
let _mobMatN = 0;
function mobMatPodeEditar(){
  return !!usuarioAtual && !["concluida", "cancelada", "desmobilizada"].includes(_mobAberta?.status)
    && ["diretor", "admin", "engenheiro", "assistente_engenharia", "comercial", "encarregado", "logistica", "almoxarife", "gestor_acessorios", "comprador"].includes(usuarioAtual.cargo);
}
async function mobRenderMateriais(){
  const box = $("mob-materiais"); const m = _mobAberta; if(!box || !m) return;
  const { data, error } = await sb.from("mobilizacao_materiais").select("id,produto_id,descricao,unidade,quantidade,observacoes,ordem,produto:produtos(codigo,nome,estoque_atual)")
    .eq("mobilizacao_id", m.id).order("ordem").order("created_at");
  if(!$("mob-materiais") || _mobAberta !== m) return;
  if(error){ box.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  const its = data || [], pode = mobMatPodeEditar();
  _mobMatN = its.length;
  box.innerHTML = `${its.length ? `<div class="tabela-rola"><table class="itens-tabela"><thead><tr><th>Item</th><th style="width:60px;">Un</th><th class="num" style="width:90px;">Qtd</th><th>Obs.</th><th class="col-acao"></th></tr></thead>
      <tbody>${its.map(i => `<tr><td>${i.produto_id ? `${linkProduto(i.produto_id, i.produto?.codigo || "produto")} ${esc(i.produto?.nome || i.descricao)}` : `${esc(i.descricao)} <span class="meta">(item livre)</span>`}${i.produto ? ` <span class="meta">· saldo ${num(i.produto.estoque_atual || 0)}</span>` : ""}</td>
        <td>${esc(i.unidade || "un")}</td><td class="num">${num(i.quantidade)}</td><td class="meta">${esc(i.observacoes || "")}</td>
        <td class="col-acao">${pode ? `<button type="button" class="btn-rem mob-mat-rem" data-id="${esc(i.id)}" title="tirar">&times;</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="vazio">Nenhum material pré-configurado.</p>`}
    ${pode ? `<div class="grade" style="margin-top:6px;">
      <div class="campo largo"><input id="mob-mat-busca" placeholder="+ produto do catálogo (código, código de barras ou nome; Enter adiciona)…" autocomplete="off" /><div id="mob-mat-res" class="autocomplete-lista" style="display:none;"></div></div>
      <div class="campo"><div style="display:flex;gap:4px;"><input type="number" id="mob-mat-qtd" min="0.001" step="0.001" value="1" style="width:80px;" title="quantidade" /><input id="mob-mat-livre" placeholder="ou item livre" style="flex:1;" /><button type="button" class="btn-sec btn-sm" id="btn-mob-mat-livre">+</button></div></div>
    </div>` : ""}`;
  box.querySelectorAll(".mob-mat-rem").forEach(b => b.addEventListener("click", async () => {
    const { error: e2 } = await sb.from("mobilizacao_materiais").delete().eq("id", b.dataset.id);
    if(e2){ aviso("app-aviso", "Não foi possível: " + e2.message, "erro"); return; }
    mobRenderMateriais();
  }));
  if(pode && typeof sepLigarBusca === "function") sepLigarBusca($("mob-mat-busca"), $("mob-mat-res"), p => mobMatAdd({ produto_id: p.id, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || "un" }));
  $("btn-mob-mat-livre")?.addEventListener("click", () => { const d = $("mob-mat-livre").value.trim(); if(d) mobMatAdd({ descricao: d, unidade: "un" }); });
  $("mob-mat-livre")?.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); $("btn-mob-mat-livre")?.click(); } });
}
async function mobMatAdd(it){
  const m = _mobAberta; if(!m) return;
  const q = Number($("mob-mat-qtd")?.value || 1); if(!(q > 0)){ aviso("app-aviso", "Quantidade inválida.", "erro"); return; }
  const { error } = await sb.from("mobilizacao_materiais").insert({ mobilizacao_id: m.id, produto_id: it.produto_id || null, descricao: it.descricao, unidade: it.unidade, quantidade: q, ordem: _mobMatN + 1 });
  if(error){ aviso("app-aviso", "Não foi possível adicionar: " + error.message, "erro"); return; }
  if($("mob-mat-qtd")) $("mob-mat-qtd").value = 1;
  if($("mob-mat-livre")) $("mob-mat-livre").value = "";
  mobRenderMateriais();
}
async function mobRenderSeparacao(){
  const box = $("mob-sep"); const m = _mobAberta; if(!box || !m) return;
  const { data } = await sb.from("separacoes").select("id,numero,status,responsavel:profiles!separacoes_responsavel_id_fkey(nome),itens:separacao_itens(separado)")
    .eq("mobilizacao_id", m.id).neq("status", "cancelada").order("created_at", { ascending: false }).limit(1);
  if(!$("mob-sep") || _mobAberta !== m) return;
  const s = (data || [])[0];
  const podePedir = typeof sepPodePedir === "function" && sepPodePedir() && !["concluida", "cancelada", "desmobilizada"].includes(m.status);
  if(s){
    const its = s.itens || [], ok = its.filter(i => i.separado).length;
    const lbl = { aberta: "aberta", em_separacao: "em separação", separada: "separada", entregue: "entregue" }[s.status] || s.status;
    box.innerHTML = `<a href="#" class="mob-chip ${s.status === "entregue" ? "ok" : "st"}" id="mob-sep-abrir" title="abrir a separação">📦 Separação ${esc(s.numero)}: ${ok} de ${its.length} separado(s) · ${esc(lbl)}${s.responsavel ? " · " + esc(s.responsavel.nome) : " · sem responsável"}</a>`;
    $("mob-sep-abrir")?.addEventListener("click", e => { e.preventDefault(); fecharMobilizacao(); if(irParaSecao("separacoes") && typeof abrirSeparacao === "function") abrirSeparacao(s.id); });
  } else {
    box.innerHTML = podePedir
      ? `<button type="button" class="btn-sec btn-sm" id="btn-mob-sep-gerar" title="cria a lista de separação (kit + materiais) para o almoxarife de plantão">📦 Gerar separação</button> <span class="meta">o almoxarifado separa e dá a baixa; o status da mobilização não muda</span>`
      : `<span class="meta">Sem separação gerada.</span>`;
    $("btn-mob-sep-gerar")?.addEventListener("click", () => comBotaoTravado("btn-mob-sep-gerar", async () => {
      if(mobKitEditavel() && JSON.stringify([..._mobKit].sort()) !== JSON.stringify([...(m.acessorios_ids || [])].sort())){ aviso("app-aviso", "Salve o kit antes de gerar a separação.", "erro"); return; }
      const id = typeof sepGerarDeMobilizacao === "function" ? await sepGerarDeMobilizacao(m.id) : null;
      if(!id) return;
      aviso("app-aviso", "Separação gerada para o almoxarifado (responsável: almoxarife de plantão; ajuste na ficha da separação).", "ok");
      mobRenderSeparacao();
    }));
  }
}

/* ---------- Kit de acessórios da mobilização ----------
   Antes da saída: escolhe as peças (sugestão pela TAG + Ø das estacas, ou busca por marcação/jogo).
   Na saída, viram itens da remessa (acessorio_id) e a logística só confere na tela de Movimentações.
   Em obra: mostra o que o sistema registra na obra; a conferência do retorno acontece na movimentação. */
function mobKitEditavel(){ return _mobAberta && ["prevista","em_preparacao"].includes(_mobAberta.status); }
function mobAceDescr(a){ return (typeof aceDescr === "function" ? aceDescr(a) : (a.tipo || "Acessório")); }
function mobAceOnde(a){ return typeof aceOnde === "function" ? aceOnde(a) : (a.local_tipo || ""); }
function mobAceCond(a){ const o = (STATUS.acessorio || {})[a.condicao] || {}; return `<span class="tag ${o.cor || "cinza"}">${esc(o.label || a.condicao || "")}</span>`; }
async function mobCatalogo(force){
  if(typeof aceCatalogo !== "function") return [];
  try { return await aceCatalogo(force); } catch(e){ aviso("app-aviso", "Não foi possível carregar os acessórios: " + (e.message || e), "erro"); return []; }
}
function mobKitGruposHTML(pecas, remover){
  const grupos = new Map();
  pecas.forEach(a => { const k = mobAceDescr(a); (grupos.get(k) || grupos.set(k, []).get(k)).push(a); });
  return [...grupos.entries()].map(([k, ps]) => `
    <div class="mov-ace-sug-grupo">
      <div class="mov-ace-sug-grupo-t">${esc(k)} <span class="meta">${ps.length}</span></div>
      ${ps.map(a => `<div class="mov-ace-sug-item">
        ${remover ? `<button type="button" class="btn-rem mob-kit-rem" data-id="${esc(a.id)}" title="tirar do kit">&times;</button>` : ""}
        <strong>${linkAcessorio(a.id, a.marcacao)}</strong>${a.jogo ? ` <span class="meta">jogo ${esc(a.jogo)}</span>` : ""}
        ${mobAceCond(a)} <span class="meta">${esc(mobAceOnde(a))}</span>
      </div>`).join("")}
    </div>`).join("");
}
async function mobRenderKit(){
  const box = $("mob-kit"); const m = _mobAberta;
  if(!box || !m) return;
  const cat = await mobCatalogo();
  if(!$("mob-kit") || _mobAberta !== m) return;
  const porId = {}; cat.forEach(a => porId[a.id] = a);
  const kit = _mobKit.map(id => porId[id]).filter(Boolean);
  if(mobKitEditavel()){
    box.innerHTML = `
      <div class="grade">
        <div class="campo largo">
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <button type="button" class="btn-sec btn-sm" id="btn-mob-kit-sugerir" title="peças da TAG principal, filtradas pelos Ø das estacas">✨ Sugerir kit pela TAG e pelos Ø</button>
            <input id="mob-kit-busca" placeholder="adicionar por marcação, jogo ou descrição…" autocomplete="off" style="flex:1;min-width:220px;" />
          </div>
          <div id="mob-kit-res" class="autocomplete-lista" style="display:none;"></div>
        </div>
      </div>
      <div class="mov-ace-sug-lista" id="mob-kit-lista">${kit.length ? mobKitGruposHTML(kit, true) : `<p class="vazio">Nenhuma peça separada ainda.</p>`}</div>
      <div class="form-acoes compacta" style="justify-content:space-between;align-items:center;">
        <span class="meta">${kit.length} peça(s) no kit${_mobKit.length !== kit.length ? ` · ${_mobKit.length - kit.length} não encontrada(s) no cadastro` : ""}</span>
        <button type="button" class="btn btn-sm" id="btn-mob-kit-salvar">💾 Salvar kit</button>
      </div>`;
    $("btn-mob-kit-sugerir")?.addEventListener("click", () => comBotaoTravado("btn-mob-kit-sugerir", mobSugerirKit));
    $("btn-mob-kit-salvar")?.addEventListener("click", () => comBotaoTravado("btn-mob-kit-salvar", mobSalvarKit));
    box.querySelectorAll(".mob-kit-rem").forEach(b => b.addEventListener("click", () => { _mobKit = _mobKit.filter(id => id !== b.dataset.id); mobRenderKit(); }));
    mobLigarBuscaKit(cat);
  } else {
    // fase 80: depois da remessa a mobilização mostra só o kit DELA e o que voltou; a obra inteira fica na aba
    // "Bens do contrato" da ficha da obra
    const movIds = [m.movimentacao_remessa_id, m.movimentacao_retorno_id].filter(Boolean);
    const { data: movs } = movIds.length ? await sb.from("movimentacoes_ativos").select("id,numero,tipo").in("id", movIds) : { data: [] };
    if(!$("mob-kit") || _mobAberta !== m) return;
    const num = id => ((movs || []).find(x => x.id === id) || {}).numero || "ver";
    const sit = a => {
      if(a.ativo === false || a.local_tipo === "perdido") return ["perdida", "vermelho"];
      if(a.condicao === "em_manutencao" || a.local_tipo === "fornecedor" || a.local_tipo === "oficina") return ["em reparo", "ambar"];
      if(a.local_tipo === "obra" && a.local_obra_id === m.obra_id) return ["na obra", "azul"];
      if(a.local_tipo === "em_transito") return ["em trânsito", "ambar"];
      if(["patio", "equipamento"].includes(a.local_tipo)) return ["retornou ao pátio", "verde"];
      return [mobAceOnde(a) || "—", "cinza"];
    };
    const cont = {}; kit.forEach(a => { const [l] = sit(a); cont[l] = (cont[l] || 0) + 1; });
    box.innerHTML = `
      <p class="meta">Kit desta mobilização: ${kit.length} peça(s)${Object.keys(cont).length ? " · " + Object.entries(cont).map(([l, n]) => `${n} ${l}`).join(" · ") : ""}
        ${m.movimentacao_remessa_id ? ` · remessa ${linkMovimentacao(m.movimentacao_remessa_id, num(m.movimentacao_remessa_id))}` : ""}
        ${m.movimentacao_retorno_id ? ` · retorno ${linkMovimentacao(m.movimentacao_retorno_id, num(m.movimentacao_retorno_id))}` : ""}</p>
      ${kit.length ? `<div class="tabela-rola"><table class="itens-tabela"><thead><tr><th>Peça</th><th>Descrição</th><th>Jogo</th><th>Condição</th><th>Situação hoje</th></tr></thead>
        <tbody>${kit.map(a => { const [l, cor] = sit(a); return `<tr><td><strong>${linkAcessorio(a.id, a.marcacao)}</strong></td><td>${esc(mobAceDescr(a))}</td><td>${esc(a.jogo || "—")}</td><td>${mobAceCond(a)}</td><td><span class="tag ${cor}">${esc(l)}</span> <span class="meta">${esc(mobAceOnde(a))}</span></td></tr>`; }).join("")}</tbody></table></div>`
        : `<p class="vazio">Nenhuma peça foi separada no kit desta mobilização.</p>`}
      ${m.status === "em_obra" && kit.length ? `<p class="meta">Ao desmobilizar, as peças do kit que estiverem na obra entram no retorno para a logística conferir (o retorno leva também as demais peças registradas na obra; o que ficar é removido lá).</p>` : ""}
      <p><a href="#" id="mob-ver-bens">Ver todos os bens desta obra →</a></p>`;
    $("mob-ver-bens")?.addEventListener("click", async e => {
      e.preventDefault();
      const obraId = m.obra_id; fecharMobilizacao();
      if(!irParaSecao("obras") || typeof abrirObra !== "function") return;
      await abrirObra(obraId);
      document.querySelector('#obr-notebook button[data-tab="equipamentos"]')?.click();
    });
  }
}
function mobLigarBuscaKit(cat){
  const inp = $("mob-kit-busca"), lista = $("mob-kit-res");
  if(!inp || !lista) return;
  let t = null;
  const fechar = () => { inp.value = ""; lista.innerHTML = ""; lista.style.display = "none"; };
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const termo = inp.value.trim().toLowerCase();
      if(termo.length < 2){ lista.innerHTML = ""; lista.style.display = "none"; return; }
      const disp = cat.filter(a => a.ativo !== false && a.local_tipo !== "perdido" && a.condicao !== "baixado");
      const hits = disp.filter(a => String(a.marcacao || "").toLowerCase().includes(termo) || String(a.jogo || "").toLowerCase() === termo || mobAceDescr(a).toLowerCase().includes(termo));
      const jogos = [...new Set(disp.filter(a => a.jogo && String(a.jogo).toLowerCase().includes(termo)).map(a => a.jogo))].slice(0, 5);
      if(!hits.length && !jogos.length){ lista.innerHTML = `<div class="resultado-item vazio">Nenhuma peça encontrada.</div>`; lista.style.display = ""; return; }
      const noKit = new Set(_mobKit);
      lista.innerHTML = jogos.map(j => `<div class="resultado-item mov-ace-jogo" data-jogo="${esc(j)}"><strong>🧩 Jogo ${esc(j)}</strong> — adicionar as ${disp.filter(a => a.jogo === j).length} peça(s)</div>`).join("") +
        hits.slice(0, 30).map(a => `<div class="resultado-item${noKit.has(a.id) ? " ja" : ""}" data-id="${esc(a.id)}"><strong>${esc(a.marcacao)}</strong> — ${esc(mobAceDescr(a))}${a.jogo ? ` <span class="meta">jogo ${esc(a.jogo)}</span>` : ""} <span class="meta" style="float:right;">${mobAceCond(a)} ${esc(mobAceOnde(a))}${noKit.has(a.id) ? " · já no kit" : ""}</span></div>`).join("") +
        (hits.length > 30 ? `<div class="resultado-item vazio">… e mais ${hits.length - 30}. Refine a busca.</div>` : "");
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => { mobKitAdicionar([d.dataset.id]); fechar(); }));
      lista.querySelectorAll(".mov-ace-jogo").forEach(d => d.addEventListener("click", () => { mobKitAdicionar(disp.filter(a => a.jogo === d.dataset.jogo).map(a => a.id)); fechar(); }));
    }, 200);
  });
}
function mobKitAdicionar(ids){
  const novos = ids.filter(id => !_mobKit.includes(id));
  _mobKit.push(...novos);
  if(novos.length) aviso("app-aviso", `${novos.length} peça(s) no kit. Lembre de salvar o kit.`, "ok");
  else aviso("app-aviso", "Essas peças já estão no kit.", "erro");
  mobRenderKit();
}
async function mobSugerirKit(){
  const eq = $("mob-equip")?.value;
  if(!eq){ aviso("app-aviso", "Defina a TAG principal para sugerir o kit.", "erro"); $("mob-equip")?.focus(); return; }
  const diams = new Set(lerEstacasResumoMob().map(e => e.diametro_mm).filter(Boolean).map(Number));
  const [cat, comp] = await Promise.all([mobCatalogo(), sb.from("acessorio_equipamentos").select("acessorio_id").eq("equipamento_id", eq)]);
  const compIds = new Set((comp.data || []).map(c => c.acessorio_id));
  const daTag = cat.filter(a => a.ativo !== false
    && ["patio","oficina","equipamento"].includes(a.local_tipo)
    && !["em_manutencao","baixado","sem_marcacao"].includes(a.condicao)
    && (a.equipamento_padrao_id === eq || a.local_equipamento_id === eq || compIds.has(a.id)));
  const cands = daTag.filter(a => !diams.size || !a.diametro_mm || diams.has(Number(a.diametro_mm)));
  if(!daTag.length){ aviso("app-aviso", "Nenhuma peça disponível vinculada a essa TAG (campo \"pertence à TAG\" ou compatibilidade na ficha do acessório). Use a busca para montar o kit.", "erro"); return; }
  const foraDiam = daTag.length - cands.length;
  const novos = cands.map(a => a.id).filter(id => !_mobKit.includes(id));
  _mobKit.push(...novos);
  aviso("app-aviso", `${novos.length} peça(s) sugerida(s) entraram no kit${foraDiam ? ` (${foraDiam} da TAG ficaram de fora por não baterem com os Ø ${[...diams].join("/")})` : ""}. Revise e salve o kit.`, "ok");
  mobRenderKit();
}
async function mobSalvarKit(){
  if(!_mobAberta) return;
  const { error } = await sb.from("mobilizacoes").update({ acessorios_ids: _mobKit }).eq("id", _mobAberta.id);
  if(error){ aviso("app-aviso", "Não foi possível salvar o kit: " + error.message, "erro"); return; }
  _mobAberta.acessorios_ids = [..._mobKit];
  aviso("app-aviso", `Kit salvo: ${_mobKit.length} peça(s).`, "ok");
}

function mobEstacaLinhaHTML(e){
  const v = (x) => (x == null ? "" : x);
  return `<tr>
    <td><input type="number" class="me-qtd" value="${v(e.qtd)}" style="width:70px" /></td>
    <td><input type="number" class="me-diam" value="${v(e.diametro_mm)}" style="width:80px" /></td>
    <td><input type="number" step="0.5" class="me-pmin" value="${v(e.prof_min)}" style="width:80px" /></td>
    <td><input type="number" step="0.5" class="me-pmax" value="${v(e.prof_max)}" style="width:80px" /></td>
    <td><input type="text" class="me-obs" value="${esc(v(e.obs))}" /></td>
    <td class="col-acao"><button type="button" class="btn-rem mob-est-rem" title="remover">&times;</button></td>
  </tr>`;
}

function lerEstacasResumoMob(){
  const num = (x) => (x === "" || x == null) ? null : Number(x);
  return [...document.querySelectorAll("#mob-est-tbody tr")].map(tr => ({
    qtd: num(tr.querySelector(".me-qtd").value), diametro_mm: num(tr.querySelector(".me-diam").value),
    prof_min: num(tr.querySelector(".me-pmin").value), prof_max: num(tr.querySelector(".me-pmax").value),
    obs: tr.querySelector(".me-obs").value.trim() || null
  })).filter(e => e.qtd != null || e.diametro_mm != null || e.obs);
}

async function salvarMobilizacao(){
  if(!_mobAberta) return;
  const b = (id) => { const v = $(id)?.value; return v === "true" ? true : v === "false" ? false : null; };
  const reg = {
    data_mobilizacao_prev: $("mob-data-prev").value || null,
    data_inicio_obra_prev: $("mob-data-inicio").value || null,
    data_saida_real: $("mob-data-saida").value || null,
    data_chegada_real: $("mob-data-chegada").value || null,
    data_desmob_real: $("mob-data-desmob").value || null,
    equipamento_id: $("mob-equip").value || null,
    equipamentos_apoio: [..._mobApoioSel.mob],
    estacas_resumo: lerEstacasResumoMob(),
    concreto_usinado: b("mob-concreto"), martelo: b("mob-martelo"), tricone: b("mob-tricone"), torre_baixa: b("mob-torre"),
    contato_obra_nome: $("mob-contato-nome").value.trim() || null,
    contato_obra_telefone: $("mob-contato-tel").value.trim() || null,
    alimentacao_interna_por: $("mob-alim").value || null, diesel_por: $("mob-diesel").value || null, hospedagem_por: $("mob-hosp").value || null,
    observacoes: $("mob-obs").value.trim() || null
  };
  if(mobKitEditavel()) reg.acessorios_ids = _mobKit;
  const { error } = await sb.from("mobilizacoes").update(reg).eq("id", _mobAberta.id);
  if(error){
    const msg = /mobilizacoes_equip_ativa_uq/.test(error.message) ? "Esta TAG já está em outra mobilização ativa (em preparação, em trânsito ou em obra)." : error.message;
    aviso("app-aviso", "Não foi possível salvar: " + msg, "erro"); return;
  }
  aviso("app-aviso", "Mobilização salva.", "ok");
  await carregarMobilizacoes(true);
  await abrirMobilizacao(_mobAberta.id);
}

async function atualizarPendenciaMob(id, campos){
  const { error } = await sb.from("mobilizacao_pendencias").update(campos).eq("id", id);
  if(error) aviso("app-aviso", "Não foi possível atualizar a pendência: " + error.message, "erro");
  else { const p = _mobPendAberta.find(x => x.id === id); if(p) Object.assign(p, campos); }
}

/* ---------- Transições de status ---------- */
/* Fase 89: a VIAGEM é o registro central da logística. A mobilização gera a viagem de ida (base → obra) ao
   iniciar a preparação ou ao sair, e a de volta (obra → base) ao desmobilizar; a nota de remessa/retorno
   nasce ligada à viagem. A localização da TAG continua vindo do status da mobilização (gatilho da fase 34). */
const MOB_VG_SELECT = "id,numero,status,data,caminhao_id,funcionario_id,origem_tipo,origem_obra_id,origem_descricao,destino_tipo,destino_obra_id,destino_descricao";
async function mobGarantirViagem(m, sentido){
  const campo = sentido === "ida" ? "viagem_ida_id" : "viagem_volta_id";
  if(m[campo]){
    const { data } = await sb.from("viagens").select(MOB_VG_SELECT).eq("id", m[campo]).maybeSingle();
    if(data) return data;
  }
  const obra = _mobObras.find(o => o.id === m.obra_id) || {};
  const obraTxt = obra.codigo ? `${obra.codigo} — ${obra.nome || ""}`.trim() : null;
  const reg = sentido === "ida"
    ? { finalidade: "mobilizacao", status: "planejada", data: m.data_mobilizacao_prev || hojeISO(), origem_tipo: "base", origem_descricao: "Base Itabira",
        destino_tipo: "obra", destino_obra_id: m.obra_id, destino_descricao: obraTxt, equipamento_atendido_id: m.equipamento_id || null, mobilizacao_id: m.id,
        observacoes: "Viagem de mobilização gerada pelo quadro de Mobilizações." }
    : { finalidade: "desmobilizacao", status: "planejada", data: hojeISO(), origem_tipo: "obra", origem_obra_id: m.obra_id, origem_descricao: obraTxt,
        destino_tipo: "base", destino_descricao: "Base Itabira", equipamento_atendido_id: m.equipamento_id || null, mobilizacao_id: m.id,
        observacoes: "Viagem de desmobilização gerada pelo quadro de Mobilizações." };
  const { data, error } = await sb.from("viagens").insert(reg).select(MOB_VG_SELECT).single();
  if(error) throw new Error("viagem: " + error.message);
  const { error: e2 } = await sb.from("mobilizacoes").update({ [campo]: data.id }).eq("id", m.id);
  if(e2) throw new Error("vínculo da viagem: " + e2.message);
  m[campo] = data.id;
  if(typeof _frotaViagens !== "undefined") _frotaViagens.chave = null;
  return data;
}
/* em_transito: a viagem planejada sai (data de saída agora); em_obra: a viagem de ida conclui com a chegada real */
async function mobViagemStatus(vg, status, dataChegada){
  if(!vg?.id) return;
  if(status === "em_transito"){
    const { error } = await sb.from("viagens").update({ status: "em_transito", data_saida: new Date().toISOString() }).eq("id", vg.id).eq("status", "planejada");
    if(error) throw new Error("status da viagem: " + error.message);
  } else if(status === "concluida"){
    const chegada = dataChegada ? new Date(dataChegada + "T12:00:00").toISOString() : new Date().toISOString();
    const { error } = await sb.from("viagens").update({ status: "concluida", data_chegada: chegada }).eq("id", vg.id).in("status", ["planejada", "em_transito"]);
    if(error) throw new Error("status da viagem: " + error.message);
  }
  if(typeof _frotaViagens !== "undefined") _frotaViagens.chave = null;
}
async function criarMovimentacaoMob(tipo, m, vg){
  // Remessa (base → obra) ao sair; retorno (obra → base) ao desmobilizar. Fica em rascunho, ligada à viagem (fase 89),
  // para a logística completar NF/transportadora na ficha do documento.
  const { data: numero, error: errNum } = await sb.rpc("proximo_numero_movimentacao");
  if(errNum) throw new Error("número da movimentação: " + errNum.message);
  const obra = _mobObras.find(o => o.id === m.obra_id) || {};
  const obraTxt = obra.codigo ? `${obra.codigo} — ${obra.nome || ""}`.trim() : null;
  const obraUf = obra.uf ? String(obra.uf).toLowerCase() : null;
  const cam = (typeof _frotaVeic !== "undefined" ? _frotaVeic : []).find(x => x.id === vg?.caminhao_id);
  const mot = (typeof _frotaFuncs !== "undefined" ? _frotaFuncs : []).find(f => f.id === vg?.funcionario_id);
  const comum = { numero, status: "rascunho", interna: false, viagem_id: vg?.id || null, data_emissao: hojeISO(), frete_por_conta: "proprio",
    motorista: mot ? mot.nome : null, transp_placa: cam?.placa || null };
  const reg = tipo === "remessa"
    ? { ...comum, tipo: "remessa", origem_tipo: "base", origem_descricao: "Base Itabira", origem_uf: "mg", destino_tipo: "obra", destino_obra_id: m.obra_id, destino_descricao: obraTxt, destino_uf: obraUf, observacoes: "Gerada pela mobilização (saída para a obra)." }
    : { ...comum, tipo: "retorno", origem_tipo: "obra", origem_obra_id: m.obra_id, origem_descricao: obraTxt, origem_uf: obraUf, destino_tipo: "base", destino_descricao: "Base Itabira", destino_uf: "mg", observacoes: "Gerada pela mobilização (desmobilização). Conferir os acessórios: remova do retorno o que ficou na obra." };
  const { data: mov, error } = await sb.from("movimentacoes_ativos").insert(reg).select("id").single();
  if(error) throw new Error("movimentação: " + error.message);
  const ids = [m.equipamento_id, ...(m.equipamentos_apoio || [])].filter(Boolean);
  const itens = ids.map(id => { const e = _mobEquips.find(x => x.id === id) || {}; return { movimentacao_id: mov.id, equipamento_id: id, descricao: [e.codigo, e.nome].filter(Boolean).join(" — ") || "Equipamento", quantidade: 1, unidade: "un" }; });
  // Acessórios: remessa leva o kit separado; retorno traz o que o sistema registra na obra (logística confere no rascunho).
  let aces = [];
  try {
    const cat = await mobCatalogo(true);
    aces = tipo === "remessa"
      ? cat.filter(a => (m.acessorios_ids || []).includes(a.id))
      : cat.filter(a => a.ativo !== false && a.local_tipo === "obra" && a.local_obra_id === m.obra_id);
  } catch(e){ console.warn("acessórios da movimentação:", e.message || e); }
  aces.forEach(a => itens.push({ movimentacao_id: mov.id, acessorio_id: a.id, descricao: `${mobAceDescr(a)} · ${a.marcacao}`, quantidade: 1, unidade: "un", valor_unitario: Number(a.modelo?.preco_referencia || 0) }));
  if(itens.length){ const { error: errIt } = await sb.from("movimentacao_itens").insert(itens); if(errIt) console.warn("itens da movimentação:", errIt.message); }
  return mov.id;
}

async function mudarStatusMobilizacao(novo, btn){
  const m = _mobAberta; if(!m) return;
  const abertas = _mobPendAberta.filter(p => !p.concluida).length;
  if(novo === "em_transito"){
    const equip = $("mob-equip")?.value || m.equipamento_id;
    if(!equip){ aviso("app-aviso", "Defina a TAG principal antes de registrar a saída.", "erro"); $("mob-equip")?.focus(); return; }
    if(abertas && !confirm(`Ainda há ${abertas} pendência(s) aberta(s). Registrar a saída mesmo assim?`)) return;
    if(!confirm("Registrar saída para a obra? A viagem de ida passa a 'em trânsito' em Logística com a nota de remessa (rascunho), e a TAG passa a 'em trânsito'.")) return;
  } else if(novo === "desmobilizada"){
    if(!confirm("Desmobilizar? Será gerada a viagem de volta em Logística com a nota de retorno (rascunho), e a TAG volta para a base.")) return;
  } else if(novo === "cancelada"){
    if(!confirm("Cancelar esta mobilização?")) return;
  } else if(novo === "em_preparacao"){
    const st = _mobAbertaCard?.contrato_status;
    if(st && !["aguardando_assinatura", "vigente"].includes(st) && !confirm(`O contrato está "${st}". Iniciar a preparação mesmo assim?`)) return;
  }
  if(btn) btn.disabled = true;
  try {
    // salva o formulário antes (TAG/apoio escolhidos agora contam para a remessa)
    await salvarMobilizacaoSilencioso();
    const atual = _mobAberta;
    const upd = { status: novo };
    // fase 89: viagem de ida nasce planejada na preparação (ou agora, se ainda não existir) e sai junto com a remessa
    if(novo === "em_preparacao"){ const vg = await mobGarantirViagem(atual, "ida"); upd.viagem_ida_id = vg.id; }
    if(novo === "em_transito"){
      const vg = await mobGarantirViagem(atual, "ida"); upd.viagem_ida_id = vg.id;
      upd.movimentacao_remessa_id = await criarMovimentacaoMob("remessa", atual, vg);
      await mobViagemStatus(vg, "em_transito");
    }
    if(novo === "em_obra" && atual.viagem_ida_id) await mobViagemStatus({ id: atual.viagem_ida_id }, "concluida", $("mob-data-chegada")?.value || atual.data_chegada_real || null);
    if(novo === "desmobilizada"){
      const vg = await mobGarantirViagem(atual, "volta"); upd.viagem_volta_id = vg.id;
      upd.movimentacao_retorno_id = await criarMovimentacaoMob("retorno", atual, vg);
      await mobViagemStatus(vg, "em_transito");
    }
    const { error } = await sb.from("mobilizacoes").update(upd).eq("id", atual.id);
    if(error) throw new Error(/mobilizacoes_equip_ativa_uq/.test(error.message) ? "Esta TAG já está em outra mobilização ativa." : error.message);
    // kit saiu na remessa → a pendência "acessórios conferidos e separados" do almoxarifado está cumprida
    if(novo === "em_transito" && (atual.acessorios_ids || []).length){
      const p = _mobPendAberta.find(x => !x.concluida && x.setor === "almoxarifado" && /acess/i.test(x.titulo || ""));
      if(p) await sb.from("mobilizacao_pendencias").update({ concluida: true }).eq("id", p.id);
    }
    aviso("app-aviso", `Mobilização: ${MOB_STATUS[novo]}.`, "ok");
    await carregarMobilizacoes(true);
    if(typeof carregarMovimentacoes === "function" && (novo === "em_transito" || novo === "desmobilizada")) carregarMovimentacoes();
    if(typeof _frotaViagens !== "undefined") _frotaViagens.chave = null;   // fase 89: painel de Logística recarrega
    await abrirMobilizacao(atual.id);
  } catch(err){
    aviso("app-aviso", "Não foi possível mudar o status: " + err.message, "erro");
    if(btn) btn.disabled = false;
  }
}
async function salvarMobilizacaoSilencioso(){
  if(!_mobAberta || !$("mob-equip")) return;
  const reg = { equipamento_id: $("mob-equip").value || null, equipamentos_apoio: [..._mobApoioSel.mob],
    data_mobilizacao_prev: $("mob-data-prev").value || null, data_inicio_obra_prev: $("mob-data-inicio").value || null };
  if(mobKitEditavel()) reg.acessorios_ids = _mobKit;
  const { data, error } = await sb.from("mobilizacoes").update(reg).eq("id", _mobAberta.id).select("*").single();
  if(error) throw new Error(/mobilizacoes_equip_ativa_uq/.test(error.message) ? "Esta TAG já está em outra mobilização ativa." : error.message);
  _mobAberta = data;
}

/* ---------- Nova mobilização ---------- */
function abrirNovaMobilizacao(obraIdPre){
  const sel = $("mobn-obra");
  if(sel){
    const ativas = _mobObras.filter(o => o.status !== "concluida");
    sel.innerHTML = '<option value="">— selecione a obra —</option>' + ativas.map(o => `<option value="${esc(o.id)}"${o.id === obraIdPre ? " selected" : ""}>${esc(o.codigo)} — ${esc(o.nome)}${o.cidade ? ` (${esc(o.cidade)}${o.uf ? "/" + esc(o.uf) : ""})` : ""}</option>`).join("");
  }
  const eq = $("mobn-equip"); if(eq) eq.innerHTML = mobEquipOpts(null);
  const ap = $("mobn-apoio"); if(ap){ _mobApoioSel.mobn = []; ap.innerHTML = mobApoioHTML("mobn"); mobLigarApoio("mobn", () => $("mobn-obra")?.value, "mobn-equip"); }
  if($("mobn-data")) $("mobn-data").value = "";
  $("mob-nova-modal").style.display = "flex";
}
function fecharNovaMobilizacao(){ $("mob-nova-modal").style.display = "none"; }
async function criarMobilizacao(){
  const obra_id = $("mobn-obra")?.value;
  if(!obra_id){ aviso("app-aviso", "Selecione a obra.", "erro"); return; }
  const reg = { obra_id, equipamento_id: $("mobn-equip")?.value || null,
    equipamentos_apoio: [..._mobApoioSel.mobn],
    data_mobilizacao_prev: $("mobn-data")?.value || null, status: "prevista" };
  const { data, error } = await sb.from("mobilizacoes").insert(reg).select("id").single();
  if(error){ aviso("app-aviso", "Não foi possível criar: " + (/mobilizacoes_equip_ativa_uq/.test(error.message) ? "esta TAG já está em outra mobilização ativa." : error.message), "erro"); return; }
  fecharNovaMobilizacao();
  aviso("app-aviso", "Mobilização criada com as pendências do modelo.", "ok");
  await carregarMobilizacoes(true);
  abrirMobilizacao(data.id);
}

/* ---------- Listeners ---------- */
function ligarMobilizacoes(){
  document.querySelectorAll("#sec-mobilizacoes .serv-view-btn").forEach(b => b.addEventListener("click", () => { _mobView = b.dataset.view; renderMobilizacoes(); }));
  $("mob-busca")?.addEventListener("input", debounce(renderMobilizacoes));
  ["mob-f-cliente", "mob-f-tag", "mob-f-setor"].forEach(id => $(id)?.addEventListener("change", renderMobilizacoes));
  $("btn-mob-atualizar")?.addEventListener("click", () => carregarMobilizacoes(true));
  $("btn-mob-nova")?.addEventListener("click", () => abrirNovaMobilizacao());
  $("btn-mobn-fechar")?.addEventListener("click", fecharNovaMobilizacao);
  $("btn-mobn-criar")?.addEventListener("click", () => comBotaoTravado("btn-mobn-criar", criarMobilizacao));
  $("mob-modal")?.addEventListener("click", (e) => { if(e.target.id === "mob-modal") fecharMobilizacao(); });
  $("mob-kpi-card-minhas")?.addEventListener("click", () => { _mobView = "pendencias"; renderMobilizacoes(); });
  document.querySelector('nav button[data-secao="mobilizacoes"]')?.addEventListener("click", () => carregarMobilizacoes(false));
  // Gatilho a partir da ficha da Obra (aba Contrato): abre o quadro com a obra já escolhida
  $("btn-obr-criar-mob")?.addEventListener("click", async () => {
    const id = (typeof obraEditId !== "undefined") ? obraEditId : null;
    if(!id){ aviso("app-aviso", "Salve a obra antes de criar a mobilização.", "erro"); return; }
    if(typeof irParaSecao === "function") irParaSecao("mobilizacoes");
    await carregarMobilizacoes(false);
    abrirNovaMobilizacao(id);
  });
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarMobilizacoes); else ligarMobilizacoes();

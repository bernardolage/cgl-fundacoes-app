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
const MOB_CARGO_SETOR = { engenheiro: "engenharia", encarregado: "engenharia", operador: "engenharia", sesmt: "sesmt", rh: "rh", mecanico: "manutencao", almoxarife: "almoxarifado", comprador: "almoxarifado", logistica: "logistica", comercial: "comercial" };
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
  if(!cargo || ["diretor", "admin"].includes(cargo)) return null; // vê todos
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
  renderDrawerMob();
  $("mob-modal").style.display = "flex";
}
function fecharMobilizacao(){ $("mob-modal").style.display = "none"; _mobAberta = null; }

function mobEquipOpts(sel, filtro){
  const lista = _mobEquips.filter(filtro || (() => true));
  return '<option value="">— XX (a definir) —</option>' + lista.map(e => `<option value="${esc(e.id)}"${e.id === sel ? " selected" : ""}>${esc(e.codigo)} — ${esc(e.nome)}${e.localizacao_tipo && e.localizacao_tipo !== "base" ? ` (${esc(e.localizacao_tipo)})` : ""}</option>`).join("");
}

function renderDrawerMob(){
  const m = _mobAberta, c = _mobAbertaCard || {};
  const cont = $("mob-modal-conteudo");
  if(!cont || !m) return;
  const col = MOB_COLUNAS.find(x => x.k === c.coluna) || {};
  const est = Array.isArray(m.estacas_resumo) ? m.estacas_resumo : [];
  const podeEditar = usuarioAtual && ["diretor", "admin", "engenheiro", "comercial", "encarregado", "logistica"].includes(usuarioAtual.cargo);
  const porQuem = (id, v) => `<select id="${id}"><option value="">—</option><option value="cgl"${v === "cgl" ? " selected" : ""}>CGL</option><option value="cliente"${v === "cliente" ? " selected" : ""}>Cliente</option></select>`;
  const simNao = (id, v) => `<select id="${id}"><option value="">—</option><option value="true"${v === true ? " selected" : ""}>Sim</option><option value="false"${v === false ? " selected" : ""}>Não</option></select>`;
  const apoioIds = new Set(m.equipamentos_apoio || []);
  const apoioOpts = _mobEquips.filter(e => e.id !== m.equipamento_id).map(e => `<label class="check-inline mob-apoio"><input type="checkbox" class="mob-apoio-cb" value="${esc(e.id)}"${apoioIds.has(e.id) ? " checked" : ""} /> ${esc(e.codigo)}</label>`).join("");
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
          ${c.obra_codigo ? `<a href="#" class="mob-link-obra" data-obra="${esc(m.obra_id)}">🏗️ ${esc(c.obra_codigo)} — ${esc(c.obra_nome || "")}</a>` : ""}
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
        <div class="campo largo"><label>TAGs de apoio (bomba, compressor, gerador)</label><div class="mob-apoio-lista">${apoioOpts}</div></div>
      </div>
    </div>

    <div class="mob-sec"><h4>2 · Estacas <span class="meta">(resumo do projeto — o detalhe fica na aba Estacas da obra)</span></h4>
      <div class="tabela-rola"><table class="itens-tabela mob-est-tabela">
        <thead><tr><th>Qtd.</th><th>Ø (mm)</th><th>Prof. mín. (m)</th><th>Prof. máx. (m)</th><th>Obs.</th><th></th></tr></thead>
        <tbody id="mob-est-tbody">${est.map(e => mobEstacaLinhaHTML(e)).join("")}</tbody>
      </table></div>
      <button type="button" class="btn-sec btn-sm" id="btn-mob-est-add">+ linha</button>
    </div>

    <div class="mob-sec"><h4>3 · Observações técnicas</h4>
      <div class="grade">
        <div class="campo"><label>Concreto usinado</label>${simNao("mob-concreto", m.concreto_usinado)}</div>
        <div class="campo"><label>Martelo</label>${simNao("mob-martelo", m.martelo)}</div>
        <div class="campo"><label>Tricone</label>${simNao("mob-tricone", m.tricone)}</div>
        <div class="campo"><label>Torre baixa</label>${simNao("mob-torre", m.torre_baixa)}</div>
      </div>
    </div>

    <div class="mob-sec"><h4>4 · Endereço e contato da obra</h4>
      <p class="meta">${esc([c.cliente, c.cidade && c.uf ? `${c.cidade} / ${c.uf}` : (c.cidade || "")].filter(Boolean).join(" — ") || "Endereço na ficha da obra.")}</p>
      <div class="grade">
        <div class="campo"><label>Contato na obra</label><input id="mob-contato-nome" value="${esc(m.contato_obra_nome || "")}" /></div>
        <div class="campo"><label>Telefone</label><input id="mob-contato-tel" value="${esc(m.contato_obra_telefone || "")}" /></div>
      </div>
    </div>

    <div class="mob-sec"><h4>5 · Condições</h4>
      <div class="grade">
        <div class="campo"><label>Alimentação interna por</label>${porQuem("mob-alim", m.alimentacao_interna_por)}</div>
        <div class="campo"><label>Diesel por</label>${porQuem("mob-diesel", m.diesel_por)}</div>
        <div class="campo"><label>Hospedagem por</label>${porQuem("mob-hosp", m.hospedagem_por)}</div>
        <div class="campo largo"><label>Observações</label><textarea id="mob-obs" rows="2">${esc(m.observacoes || "")}</textarea></div>
      </div>
      ${podeEditar ? `<div class="form-acoes compacta"><button type="button" class="btn" id="btn-mob-salvar">💾 Salvar alterações</button></div>` : ""}
    </div>

    <div class="mob-sec"><h4>6 · Pendências por setor <span class="meta">${_mobPendAberta.filter(p => !p.concluida).length} aberta(s) de ${_mobPendAberta.length}</span></h4>
      ${pendHTML}
    </div>

    <div class="mob-sec"><h4>7 · Conversa</h4><div id="mob-chatter"></div></div>
  `;

  $("btn-mob-fechar")?.addEventListener("click", fecharMobilizacao);
  $("btn-mob-salvar")?.addEventListener("click", () => comBotaoTravado("btn-mob-salvar", salvarMobilizacao));
  $("btn-mob-est-add")?.addEventListener("click", () => $("mob-est-tbody").insertAdjacentHTML("beforeend", mobEstacaLinhaHTML({})));
  cont.querySelector(".mob-link-obra")?.addEventListener("click", (e) => { e.preventDefault(); fecharMobilizacao(); if(typeof dashAbrirObra === "function") dashAbrirObra(e.currentTarget.dataset.obra); });
  cont.querySelectorAll("[data-mob-status]").forEach(b => b.addEventListener("click", () => mudarStatusMobilizacao(b.dataset.mobStatus, b)));
  cont.querySelectorAll("input[type=checkbox][data-pend]").forEach(cb => cb.addEventListener("change", () => concluirPendenciaMob(cb.dataset.pend, cb.checked, cb)));
  cont.querySelectorAll(".mob-pend-resp").forEach(s => s.addEventListener("change", () => atualizarPendenciaMob(s.dataset.pend, { responsavel_id: s.value || null })));
  cont.querySelectorAll(".mob-pend-prazo").forEach(i => i.addEventListener("change", () => atualizarPendenciaMob(i.dataset.pend, { prazo: i.value || null })));
  cont.querySelectorAll(".mob-pend-obs").forEach(i => i.addEventListener("change", () => atualizarPendenciaMob(i.dataset.pend, { observacao: i.value.trim() || null })));
  cont.addEventListener("click", (e) => { if(e.target.classList.contains("mob-est-rem")) e.target.closest("tr").remove(); });
  if(typeof montarHistorico === "function") montarHistorico("mobilizacoes", m.id, "mob-chatter");
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
    equipamentos_apoio: [...document.querySelectorAll(".mob-apoio-cb:checked")].map(x => x.value),
    estacas_resumo: lerEstacasResumoMob(),
    concreto_usinado: b("mob-concreto"), martelo: b("mob-martelo"), tricone: b("mob-tricone"), torre_baixa: b("mob-torre"),
    contato_obra_nome: $("mob-contato-nome").value.trim() || null,
    contato_obra_telefone: $("mob-contato-tel").value.trim() || null,
    alimentacao_interna_por: $("mob-alim").value || null, diesel_por: $("mob-diesel").value || null, hospedagem_por: $("mob-hosp").value || null,
    observacoes: $("mob-obs").value.trim() || null
  };
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
async function criarMovimentacaoMob(tipo, m){
  // Remessa (base → obra) ao sair; retorno (obra → base) ao desmobilizar. Fica em rascunho para a
  // logística completar NF/transportadora na tela de Movimentações.
  const { data: numero, error: errNum } = await sb.rpc("proximo_numero_movimentacao");
  if(errNum) throw new Error("número da movimentação: " + errNum.message);
  const reg = tipo === "remessa"
    ? { numero, tipo: "remessa", status: "rascunho", origem_tipo: "base", destino_tipo: "obra", destino_obra_id: m.obra_id, data_emissao: hojeISO(), observacoes: "Gerada pela mobilização (saída para a obra)." }
    : { numero, tipo: "retorno", status: "rascunho", origem_tipo: "obra", origem_obra_id: m.obra_id, destino_tipo: "base", data_emissao: hojeISO(), observacoes: "Gerada pela mobilização (desmobilização)." };
  const { data: mov, error } = await sb.from("movimentacoes_ativos").insert(reg).select("id").single();
  if(error) throw new Error("movimentação: " + error.message);
  const ids = [m.equipamento_id, ...(m.equipamentos_apoio || [])].filter(Boolean);
  const itens = ids.map(id => { const e = _mobEquips.find(x => x.id === id) || {}; return { movimentacao_id: mov.id, equipamento_id: id, descricao: [e.codigo, e.nome].filter(Boolean).join(" — ") || "Equipamento", quantidade: 1, unidade: "un" }; });
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
    if(!confirm("Registrar saída para a obra? Será gerada uma remessa (rascunho) em Movimentações e a TAG passa a 'em trânsito'.")) return;
  } else if(novo === "desmobilizada"){
    if(!confirm("Desmobilizar? Será gerado um retorno (rascunho) em Movimentações e a TAG volta para a base.")) return;
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
    if(novo === "em_transito")  upd.movimentacao_remessa_id = await criarMovimentacaoMob("remessa", atual);
    if(novo === "desmobilizada") upd.movimentacao_retorno_id = await criarMovimentacaoMob("retorno", atual);
    const { error } = await sb.from("mobilizacoes").update(upd).eq("id", atual.id);
    if(error) throw new Error(/mobilizacoes_equip_ativa_uq/.test(error.message) ? "Esta TAG já está em outra mobilização ativa." : error.message);
    aviso("app-aviso", `Mobilização: ${MOB_STATUS[novo]}.`, "ok");
    await carregarMobilizacoes(true);
    if(typeof carregarMovimentacoes === "function" && (novo === "em_transito" || novo === "desmobilizada")) carregarMovimentacoes();
    await abrirMobilizacao(atual.id);
  } catch(err){
    aviso("app-aviso", "Não foi possível mudar o status: " + err.message, "erro");
    if(btn) btn.disabled = false;
  }
}
async function salvarMobilizacaoSilencioso(){
  if(!_mobAberta || !$("mob-equip")) return;
  const reg = { equipamento_id: $("mob-equip").value || null, equipamentos_apoio: [...document.querySelectorAll(".mob-apoio-cb:checked")].map(x => x.value),
    data_mobilizacao_prev: $("mob-data-prev").value || null, data_inicio_obra_prev: $("mob-data-inicio").value || null };
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
  const ap = $("mobn-apoio"); if(ap) ap.innerHTML = _mobEquips.map(e => `<label class="check-inline mob-apoio"><input type="checkbox" class="mobn-apoio-cb" value="${esc(e.id)}" /> ${esc(e.codigo)}</label>`).join("");
  if($("mobn-data")) $("mobn-data").value = "";
  $("mob-nova-modal").style.display = "flex";
}
function fecharNovaMobilizacao(){ $("mob-nova-modal").style.display = "none"; }
async function criarMobilizacao(){
  const obra_id = $("mobn-obra")?.value;
  if(!obra_id){ aviso("app-aviso", "Selecione a obra.", "erro"); return; }
  const reg = { obra_id, equipamento_id: $("mobn-equip")?.value || null,
    equipamentos_apoio: [...document.querySelectorAll(".mobn-apoio-cb:checked")].map(x => x.value),
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
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarMobilizacoes); else ligarMobilizacoes();

/* ====================================================================
   Módulo: Equipamentos (fase 50 — plano de acessórios §4.1)
   Máquinas de produção: tipo not in (caminhao, veiculo) — esses são da Frota.
   Painel (kanban por status / lista) + ficha Odoo (Geral · Ficha técnica ·
   Acessórios por Ø · Mobilizações · Movimentações · Reparos & manutenções · Timeline).
   Localização vem do trigger de movimentação; aqui só se corrige o cadastro.
   ==================================================================== */

let _eqpView = "kanban";
let _eqpKpi = "";
let _eqpRegistros = [];
let _eqpObras = [];
let _eqpObraMap = {};
let _eqpCarregado = false;
let _eqpAtual = null;          // registro aberto
let _eqpEditId = null;         // null = novo
let _eqpAceModo = "";          // filtro da aba Acessórios
let _eqpAceCache = { id: null, na: [], pertence: [], compat: [] };

const EQP_TIPOS = ["perfuratriz","bate_estaca","escavadeira","retroescavadeira","guindaste","compressor","gerador","bomba","ferramenta","outro"];
const EQP_TIPO_LBL = { perfuratriz: "Perfuratriz", bate_estaca: "Bate-estaca", escavadeira: "Escavadeira", retroescavadeira: "Retroescavadeira", guindaste: "Guindaste", compressor: "Compressor", gerador: "Gerador", bomba: "Bomba", ferramenta: "Ferramenta", outro: "Outro" };
const EQP_LOCAL_LBL = { base: "Base", obra: "Obra", em_transito: "Em trânsito", fornecedor_manutencao: "Fornecedor / manutenção", cliente: "Cliente" };
const EQP_LOCAL_COR = { base: "verde", obra: "azul", em_transito: "ambar", fornecedor_manutencao: "ambar", cliente: "azul" };
const EQP_MOB_ATIVA = ["em_preparacao","em_transito","em_obra"];

function eqpPodeEditar(){
  return !!usuarioAtual && ["admin","diretor","mecanico","engenheiro","logistica","rh","gestor_acessorios"].includes(usuarioAtual.cargo);
}
function eqpLbl(v){ const o = (STATUS.equipamento || {})[v]; return o ? o.label : (v || "—"); }
function eqpObra(id){ const o = _eqpObraMap[id]; return o ? `${o.codigo} — ${o.nome}` : ((typeof mapaObras === "object" && mapaObras && mapaObras[id]) || ""); }
function eqpOnde(e){
  const d = e.localizacao_descricao ? ` · ${e.localizacao_descricao}` : "";
  switch(e.localizacao_tipo){
    case "obra":        return (e.localizacao_obra_id ? eqpObra(e.localizacao_obra_id) : "Obra") + d;
    case "em_transito": return "Em trânsito" + (e.localizacao_obra_id ? " → " + eqpObra(e.localizacao_obra_id) : "") + d;
    case "fornecedor_manutencao": return "Fornecedor / manutenção" + d;
    case "cliente":     return "Cliente" + d;
    default:            return "Base" + d;
  }
}
function eqpOndeHTML(e){
  const t = e.localizacao_tipo || "base";
  const txt = e.localizacao_obra_id && (t === "obra" || t === "em_transito")
    ? `${t === "em_transito" ? "Em trânsito → " : ""}${linkObra(e.localizacao_obra_id, eqpObra(e.localizacao_obra_id) || "Obra")}${e.localizacao_descricao ? " · " + esc(e.localizacao_descricao) : ""}`
    : esc(eqpOnde(e));
  return `<span class="tag ${EQP_LOCAL_COR[t] || "cinza"}">${esc(EQP_LOCAL_LBL[t] || t)}</span> ${txt}`;
}
function eqpTag(e){ return `${e.codigo}${e.nome ? " · " + e.nome : ""}`; }
function eqpOrd(a, b){ return String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }); }
function eqpNumAce(e){ return e._ace || 0; }

/* ---------- carga ---------- */
async function carregarEquipamentos(force){
  const cont = $("eqp-conteudo");
  if(!cont) return;
  if(force || !_eqpCarregado){
    cont.innerHTML = `<p class="vazio">Carregando equipamentos…</p>`;
    try {
      const [eq, ob, mob] = await Promise.all([
        sb.from("equipamentos").select("*").not("tipo", "in", "(caminhao,veiculo)").order("codigo"),
        sb.from("obras").select("id,codigo,nome,status").not("status", "in", "(cancelada)").order("codigo", { ascending: false }),
        sb.from("mobilizacoes").select("id,obra_id,equipamento_id,equipamentos_apoio,status").in("status", EQP_MOB_ATIVA)
      ]);
      if(eq.error) throw eq.error;
      _eqpRegistros = (eq.data || []).sort(eqpOrd);
      _eqpObras = ob.data || [];
      _eqpObraMap = {}; _eqpObras.forEach(o => _eqpObraMap[o.id] = o);
      // mobilização ativa por equipamento (principal ou apoio)
      const mobPor = {};
      (mob.data || []).forEach(m => { [m.equipamento_id, ...(m.equipamentos_apoio || [])].filter(Boolean).forEach(id => { if(!mobPor[id]) mobPor[id] = m; }); });
      _eqpRegistros.forEach(e => e._mob = mobPor[e.id] || null);
      // contagem de acessórios por máquina (catálogo do módulo Acessórios; falha não derruba a tela)
      try {
        const cat = typeof aceCatalogo === "function" ? await aceCatalogo() : [];
        const na = {};
        cat.forEach(a => { if(a.ativo !== false && a.local_tipo === "equipamento" && a.local_equipamento_id) na[a.local_equipamento_id] = (na[a.local_equipamento_id] || 0) + 1; });
        _eqpRegistros.forEach(e => e._ace = na[e.id] || 0);
      } catch(err){ console.warn("acessórios por máquina:", err.message || err); }
      _eqpCarregado = true;
      eqpPreencherSelectsFixos();
    } catch(e){
      cont.innerHTML = `<p class="vazio">Erro ao carregar equipamentos: ${esc(e.message || e)}</p>`;
      return;
    }
  }
  const bn = $("btn-eqp-novo"); if(bn) bn.style.display = eqpPodeEditar() ? "" : "none";
  eqpPreencherFiltros();
  renderEquipamentos();
}

function eqpPreencherSelectsFixos(){
  const tipo = $("eqp-tipo");
  if(tipo) tipo.innerHTML = EQP_TIPOS.map(t => `<option value="${t}">${esc(EQP_TIPO_LBL[t])}</option>`).join("");
  const ac = $("eqp-acopl");
  if(ac && typeof ACE_ACOPL_LBL === "object") ac.innerHTML = `<option value="">—</option>` + Object.entries(ACE_ACOPL_LBL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  const lo = $("eqp-local-obra");
  if(lo) preencherSelect(lo, _eqpObras.map(o => ({ id: o.id, txt: `${o.codigo} — ${o.nome}` })), "id", "txt", "— obra —");
  const fs = $("eqp-f-status");
  if(fs) fs.innerHTML = `<option value="">Status</option>` + Object.entries(STATUS.equipamento || {}).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
  const fl = $("eqp-f-local");
  if(fl) fl.innerHTML = `<option value="">Onde está</option>` + Object.entries(EQP_LOCAL_LBL).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
}
function eqpPreencherFiltros(){
  const keep = (sel, itens, ph) => { if(!sel) return; const v = sel.value; sel.innerHTML = `<option value="">${ph}</option>` + itens.map(i => `<option value="${esc(i.v)}">${esc(i.t)}</option>`).join(""); sel.value = v; };
  const tipos = [...new Set(_eqpRegistros.map(e => e.tipo).filter(Boolean))].sort((a, b) => (EQP_TIPO_LBL[a] || a).localeCompare(EQP_TIPO_LBL[b] || b));
  keep($("eqp-f-tipo"), tipos.map(t => ({ v: t, t: EQP_TIPO_LBL[t] || t })), "Todos os tipos");
  const obras = [...new Set(_eqpRegistros.map(e => e.localizacao_obra_id).filter(Boolean))];
  keep($("eqp-f-obra"), obras.map(id => ({ v: id, t: eqpObra(id) || id })).sort((a, b) => a.t.localeCompare(b.t)), "Obra");
}

/* ---------- filtros + render ---------- */
function eqpFiltradas(){
  const q = ($("eqp-busca")?.value || "").trim().toLowerCase();
  const fTipo = $("eqp-f-tipo")?.value || "", fSt = $("eqp-f-status")?.value || "", fLoc = $("eqp-f-local")?.value || "", fObra = $("eqp-f-obra")?.value || "";
  const inativos = !!$("eqp-f-inativos")?.checked;
  return _eqpRegistros.filter(e => {
    if(!inativos && e.ativo === false) return false;
    if(fTipo && e.tipo !== fTipo) return false;
    if(fSt && e.status !== fSt) return false;
    if(fLoc && (e.localizacao_tipo || "base") !== fLoc) return false;
    if(fObra && e.localizacao_obra_id !== fObra) return false;
    switch(_eqpKpi){
      case "obra":       if(e.localizacao_tipo !== "obra") return false; break;
      case "base":       if((e.localizacao_tipo || "base") !== "base") return false; break;
      case "transito":   if(e.localizacao_tipo !== "em_transito") return false; break;
      case "manutencao": if(e.status !== "em_manutencao" && e.localizacao_tipo !== "fornecedor_manutencao") return false; break;
      case "acessorios": if(!eqpNumAce(e)) return false; break;
    }
    if(q){
      const alvo = [e.codigo, e.nome, e.marca, e.modelo, e.numero_serie, e.codigo_externo, EQP_TIPO_LBL[e.tipo], eqpOnde(e)].filter(Boolean).join(" ").toLowerCase();
      if(!alvo.includes(q)) return false;
    }
    return true;
  });
}
function renderEquipamentos(){
  const cont = $("eqp-conteudo"); if(!cont) return;
  eqpRenderKpis();
  document.querySelectorAll("#eqp-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _eqpView));
  document.querySelectorAll("#eqp-painel .ind[data-kpi]").forEach(el => el.classList.toggle("ativo", el.dataset.kpi === _eqpKpi));
  const dados = eqpFiltradas();
  $("eqp-contador").textContent = `${dados.length} de ${_eqpRegistros.filter(e => e.ativo !== false).length}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhum equipamento com esses filtros.</p>`; return; }
  if(_eqpView === "lista") renderEquipamentosLista(dados); else renderEquipamentosKanban(dados);
}
function eqpRenderKpis(){
  const at = _eqpRegistros.filter(e => e.ativo !== false);
  const set = (id, n) => { const el = $(id); if(el) el.textContent = n; };
  set("eqp-kpi-total", at.length);
  set("eqp-kpi-obra", at.filter(e => e.localizacao_tipo === "obra").length);
  set("eqp-kpi-base", at.filter(e => (e.localizacao_tipo || "base") === "base").length);
  set("eqp-kpi-transito", at.filter(e => e.localizacao_tipo === "em_transito").length);
  set("eqp-kpi-manut", at.filter(e => e.status === "em_manutencao" || e.localizacao_tipo === "fornecedor_manutencao").length);
  set("eqp-kpi-ace", at.reduce((s, e) => s + eqpNumAce(e), 0));
}
function eqpCardHTML(e){
  const mob = e._mob;
  return `<div class="serv-kan-card eqp-card" data-id="${esc(e.id)}">
    <div class="serv-kan-card-nome"><strong>${esc(e.codigo)}</strong> ${esc(e.nome || "")}</div>
    <div class="meta">${esc(EQP_TIPO_LBL[e.tipo] || e.tipo)}${e.marca || e.modelo ? " · " + esc([e.marca, e.modelo].filter(Boolean).join(" ")) : ""}</div>
    <div class="meta" style="margin-top:4px;">${eqpOndeHTML(e)}</div>
    <div class="meta eqp-card-rodape">
      ${eqpNumAce(e) ? `<span title="acessórios registrados nesta máquina">⚙️ ${eqpNumAce(e)}</span>` : ""}
      ${mob ? `<span title="mobilização ativa">🏗️ ${esc(MOB_LBL_SAFE(mob.status))}</span>` : ""}
      ${e.horimetro != null ? `<span>⏱ ${num(e.horimetro)} h</span>` : ""}
    </div>
  </div>`;
}
function MOB_LBL_SAFE(st){ return (typeof MOB_STATUS === "object" && MOB_STATUS && MOB_STATUS[st]) || st || ""; }
function renderEquipamentosKanban(dados){
  const cols = Object.keys(STATUS.equipamento || {});
  $("eqp-conteudo").innerHTML = `<div class="serv-kanban">${cols.map(st => {
    const its = dados.filter(e => (e.status || "disponivel") === st);
    return `<div class="serv-kan-col" data-status="${st}">
      <div class="serv-kan-col-head">${tagStatus("equipamento", st)} <span class="contador">${its.length}</span></div>
      ${its.map(eqpCardHTML).join("") || `<p class="vazio">—</p>`}
    </div>`; }).join("")}</div>`;
}
function renderEquipamentosLista(dados){
  $("eqp-conteudo").innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>TAG</th><th>Nome</th><th>Tipo</th><th>Marca / modelo</th><th>Status</th><th>Onde está</th><th>Mobilização</th><th class="num">Acessórios</th><th class="num">Horímetro</th></tr></thead>
    <tbody>${dados.map(e => `<tr class="linha-clicavel" data-id="${esc(e.id)}">
      <td><strong>${esc(e.codigo)}</strong>${e.ativo === false ? ' <span class="tag cinza">inativo</span>' : ""}</td>
      <td>${esc(e.nome || "")}</td>
      <td>${esc(EQP_TIPO_LBL[e.tipo] || e.tipo)}</td>
      <td>${esc([e.marca, e.modelo].filter(Boolean).join(" ") || "—")}</td>
      <td>${tagStatus("equipamento", e.status || "disponivel")}</td>
      <td>${eqpOndeHTML(e)}</td>
      <td>${e._mob ? `${esc(MOB_LBL_SAFE(e._mob.status))} · ${linkObra(e._mob.obra_id, eqpObra(e._mob.obra_id) || "obra")}` : "—"}</td>
      <td class="num">${eqpNumAce(e) || "—"}</td>
      <td class="num">${e.horimetro != null ? num(e.horimetro) : "—"}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

/* ---------- ficha ---------- */
function mostrarPainelEquipamentos(){
  $("eqp-ficha").style.display = "none";
  $("eqp-painel").style.display = "";
  _eqpAtual = null; _eqpEditId = null;
  if(typeof ocultarHistorico === "function") ocultarHistorico("eqp-chatter");
  renderEquipamentos();
}
function novoEquipamento(){
  if(!eqpPodeEditar()){ aviso("app-aviso", "Seu perfil não cadastra equipamentos.", "erro"); return; }
  abrirFichaEquipamento({ id: null, codigo: "", nome: "", tipo: "perfuratriz", status: "disponivel", ativo: true, localizacao_tipo: "base", localizacao_descricao: "Base Itabira" });
}
async function abrirEquipamento(id){
  if(!_eqpCarregado) await carregarEquipamentos(false);
  let e = _eqpRegistros.find(x => x.id === id);
  if(!e){
    const { data } = await sb.from("equipamentos").select("*").eq("id", id).maybeSingle();
    if(!data){ aviso("app-aviso", "Equipamento não encontrado.", "erro"); return; }
    e = data;
  }
  abrirFichaEquipamento(e);
}
function eqpToggleLocalObra(){
  const t = $("eqp-local-tipo").value;
  $("eqp-local-obra-campo").style.display = (t === "obra" || t === "em_transito" || t === "cliente") ? "" : "none";
}
function abrirFichaEquipamento(e){
  _eqpAtual = e; _eqpEditId = e.id || null;
  const novo = !e.id;
  $("eqp-painel").style.display = "none";
  $("eqp-ficha").style.display = "";
  $("eqp-ficha-titulo").textContent = novo ? "Novo equipamento" : eqpTag(e);
  document.querySelectorAll("#eqp-ficha .eqp-so-existente").forEach(b => b.style.display = novo ? "none" : "");
  const pode = eqpPodeEditar();
  $("btn-eqp-salvar").style.display = pode ? "" : "none";
  $("eqp-ficha").querySelectorAll("input,select,textarea").forEach(el => el.disabled = !pode);
  $("eqp-codigo").disabled = !pode || !novo;

  $("eqp-codigo").value = e.codigo || "";
  $("eqp-nome").value = e.nome || "";
  $("eqp-tipo").value = EQP_TIPOS.includes(e.tipo) ? e.tipo : "outro";
  $("eqp-marca").value = e.marca || ""; $("eqp-modelo").value = e.modelo || "";
  $("eqp-ano").value = e.ano_fabricacao ?? ""; $("eqp-serie").value = e.numero_serie || "";
  $("eqp-horimetro").value = e.horimetro ?? ""; $("eqp-aquisicao").value = e.data_aquisicao || "";
  $("eqp-valor").value = e.valor_aquisicao ?? ""; $("eqp-cod-ext").value = e.codigo_externo || "";
  $("eqp-ativo").checked = e.ativo !== false;
  $("eqp-local-tipo").value = e.localizacao_tipo || "base";
  $("eqp-local-obra").value = e.localizacao_obra_id || "";
  $("eqp-local-desc").value = e.localizacao_descricao || "";
  eqpToggleLocalObra();
  $("eqp-obs").value = e.observacoes || "";
  $("eqp-encaixe").value = e.encaixe_trado || ""; $("eqp-acopl").value = e.acoplamento_trado || "";
  $("eqp-diam-max").value = e.diametro_max_mm ?? ""; $("eqp-prof-max").value = e.profundidade_max_m ?? "";
  $("eqp-pino").value = e.pino_trado_mm ?? ""; $("eqp-obs-ace").value = e.obs_acessorios || "";

  // chips
  $("eqp-chip-tag").textContent = e.codigo || "—";
  $("eqp-chip-tipo").textContent = EQP_TIPO_LBL[e.tipo] || e.tipo || "—";
  $("eqp-chip-onde").textContent = novo ? "—" : eqpOnde(e);
  $("eqp-chip-mob").textContent = e._mob ? `${MOB_LBL_SAFE(e._mob.status)} · ${eqpObra(e._mob.obra_id) || "obra"}` : "—";
  $("eqp-chip-hor").textContent = e.horimetro != null ? `${num(e.horimetro)} h` : "—";
  const tec = [e.encaixe_trado, e.acoplamento_trado ? (ACE_ACOPL_LBL?.[e.acoplamento_trado] || e.acoplamento_trado) : null, e.diametro_max_mm ? `Ø máx. ${e.diametro_max_mm}` : null, e.profundidade_max_m ? `${e.profundidade_max_m} m` : null].filter(Boolean).join(" · ");
  $("eqp-chip-tec").textContent = tec || "—";
  atualizarStatusbarEquipamento(e.status || "disponivel");

  // smart-buttons zerados até carregar
  ["sb-eqp-ace","sb-eqp-mob","sb-eqp-mov","sb-eqp-rep","sb-eqp-man"].forEach(id => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = "0"; b.classList.add("zero"); } });
  $("eqp-ace-lista").innerHTML = `<p class="vazio">${novo ? "Salve o equipamento para ver os acessórios." : "Carregando…"}</p>`;
  ["eqp-mob-lista","eqp-mov-lista","eqp-rep-lista"].forEach(id => $(id).innerHTML = `<p class="vazio">${novo ? "—" : "Carregando…"}</p>`);
  $("eqp-man-lista").innerHTML = "";

  if(!novo) eqpCarregarFilhas(e);
  if(!novo && typeof montarHistorico === "function") montarHistorico("equipamentos", e.id, "eqp-chatter");
  else if(typeof ocultarHistorico === "function") ocultarHistorico("eqp-chatter");
  ativarTabEquipamento("geral");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function atualizarStatusbarEquipamento(st){
  document.querySelectorAll("#eqp-statusbar .stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    if(el.dataset.status === st) el.classList.add(st === "inativo" ? "cancelada" : "atual");
  });
}
function ativarTabEquipamento(nome){
  document.querySelectorAll("#eqp-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#eqp-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}

async function eqpCarregarFilhas(e){
  const id = e.id;
  const [mob, mov, rep, man, comp, cat] = await Promise.all([
    sb.from("mobilizacoes").select("id,obra_id,status,data_mobilizacao_prev,data_saida_real,data_chegada_real,data_desmob_real,equipamento_id,equipamentos_apoio").or(`equipamento_id.eq.${id},equipamentos_apoio.cs.{${id}}`).order("data_mobilizacao_prev", { ascending: false }),
    sb.from("movimentacao_itens").select("movimentacao_id,movimentacao:movimentacoes_ativos(id,numero,tipo,status,data_emissao,data_recebimento,origem_tipo,origem_descricao,destino_tipo,destino_descricao,destino_obra_id)").eq("equipamento_id", id),
    sb.from("reparos_caldeiraria").select("id,status,descricao,tipo_servico,data_abertura,data_conclusao,custo_estimado,custo_real,acessorio_id").eq("equipamento_id", id).order("data_abertura", { ascending: false }).limit(200),
    sb.from("manutencoes").select("id,tipo,status,descricao,data_prevista,data_inicio,data_conclusao,custo,horimetro_km").eq("equipamento_id", id).order("data_prevista", { ascending: false }).limit(200),
    sb.from("acessorio_equipamentos").select("acessorio_id").eq("equipamento_id", id),
    (typeof aceCatalogo === "function" ? aceCatalogo() : Promise.resolve([])).catch(() => [])
  ]);
  if(_eqpAtual?.id !== id) return;
  const setSb = (bid, n) => { const b = $(bid); if(!b) return; b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); };

  // acessórios
  const compIds = new Set((comp.data || []).map(c => c.acessorio_id));
  const vivos = cat.filter(a => a.ativo !== false);
  _eqpAceCache = {
    id,
    na: vivos.filter(a => a.local_equipamento_id === id && ["equipamento","obra","em_transito"].includes(a.local_tipo)),
    pertence: vivos.filter(a => a.equipamento_padrao_id === id),
    compat: vivos.filter(a => compIds.has(a.id) && a.equipamento_padrao_id !== id),
    cat: vivos
  };
  const todos = eqpAceTodos();
  setSb("sb-eqp-ace", todos.length);
  eqpRenderAcessorios();

  // mobilizações
  const mobs = mob.data || [];
  setSb("sb-eqp-mob", mobs.length);
  $("eqp-mob-lista").innerHTML = mob.error ? `<p class="vazio">Erro: ${esc(mob.error.message)}</p>` : !mobs.length ? `<p class="vazio">Nenhuma mobilização com esta TAG.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>Obra</th><th>Papel</th><th>Status</th><th>Prevista</th><th>Saída</th><th>Chegada</th><th>Desmobilização</th></tr></thead>
    <tbody>${mobs.map(m => `<tr class="linha-clicavel" data-mob="${esc(m.id)}">
      <td>${linkObra(m.obra_id, eqpObra(m.obra_id) || "obra")}</td><td>${m.equipamento_id === id ? "Principal" : "Apoio"}</td>
      <td><span class="tag ${EQP_MOB_ATIVA.includes(m.status) ? "azul" : m.status === "cancelada" ? "cinza" : "verde"}">${esc(MOB_LBL_SAFE(m.status))}</span></td>
      <td>${dataBR(m.data_mobilizacao_prev)}</td><td>${dataBR(m.data_saida_real)}</td><td>${dataBR(m.data_chegada_real)}</td><td>${dataBR(m.data_desmob_real)}</td></tr>`).join("")}</tbody></table></div>`;

  // movimentações
  const movs = (mov.data || []).map(i => i.movimentacao).filter(Boolean).sort((a, b) => String(b.data_emissao || "").localeCompare(String(a.data_emissao || "")));
  setSb("sb-eqp-mov", movs.length);
  const locLbl = (t) => (typeof LOC_TIPOS === "object" && LOC_TIPOS && LOC_TIPOS[t]) || EQP_LOCAL_LBL[t] || t || "";
  $("eqp-mov-lista").innerHTML = mov.error ? `<p class="vazio">Erro: ${esc(mov.error.message)}</p>` : !movs.length ? `<p class="vazio">Nenhuma movimentação com esta TAG.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>Nº</th><th>Tipo</th><th>Status</th><th>Emissão</th><th>Origem</th><th>Destino</th><th>Recebida</th></tr></thead>
    <tbody>${movs.map(m => `<tr class="linha-clicavel" data-mov="${esc(m.id)}">
      <td><strong>${esc(m.numero || "—")}</strong></td><td>${esc((typeof MOV_TIPOS === "object" && MOV_TIPOS && MOV_TIPOS[m.tipo]) || m.tipo)}</td>
      <td>${typeof MOV_STATUS === "object" && MOV_STATUS && MOV_STATUS[m.status] ? `<span class="tag ${MOV_STATUS[m.status].cor}">${esc(MOV_STATUS[m.status].label)}</span>` : esc(m.status)}</td>
      <td>${dataBR(m.data_emissao)}</td><td>${esc(m.origem_descricao || locLbl(m.origem_tipo))}</td>
      <td>${m.destino_obra_id ? linkObra(m.destino_obra_id, m.destino_descricao || eqpObra(m.destino_obra_id)) : esc(m.destino_descricao || locLbl(m.destino_tipo))}</td>
      <td>${dataBR(m.data_recebimento)}</td></tr>`).join("")}</tbody></table></div>`;

  // reparos e manutenções
  const reps = rep.data || [], mans = man.data || [];
  setSb("sb-eqp-rep", reps.length); setSb("sb-eqp-man", mans.length);
  const repSt = { aberto: "ambar", em_execucao: "ambar", concluido: "verde", cancelado: "cinza" };
  const repLbl = (typeof ACE_REPARO_STATUS === "object" && ACE_REPARO_STATUS) || {};
  $("eqp-rep-lista").innerHTML = `<h3 class="titulo-bloco">Reparos de caldeiraria</h3>` + (rep.error ? `<p class="vazio">Erro: ${esc(rep.error.message)}</p>` : !reps.length ? `<p class="vazio">Nenhum reparo aberto para esta TAG.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>Abertura</th><th>Status</th><th>Descrição</th><th>Conclusão</th><th class="num">Custo</th></tr></thead>
    <tbody>${reps.map(r => `<tr><td>${dataBR(r.data_abertura)}</td><td><span class="tag ${repSt[r.status] || "cinza"}">${esc(repLbl[r.status] || r.status)}</span></td>
      <td>${r.acessorio_id ? "⚙️ " : ""}${esc(r.descricao || "")}</td><td>${dataBR(r.data_conclusao)}</td>
      <td class="num">${r.custo_real != null ? brl(r.custo_real) : r.custo_estimado != null ? brl(r.custo_estimado) + " (est.)" : "—"}</td></tr>`).join("")}</tbody></table></div>`);
  const manTipo = { preventiva: "Preventiva", corretiva: "Corretiva", preditiva: "Preditiva" };
  const manSt = { agendada: ["Agendada","azul"], em_andamento: ["Em andamento","ambar"], concluida: ["Concluída","verde"], cancelada: ["Cancelada","cinza"] };
  $("eqp-man-lista").innerHTML = `<h3 class="titulo-bloco">Manutenções</h3>` + (man.error ? `<p class="vazio">Erro: ${esc(man.error.message)}</p>` : !mans.length ? `<p class="vazio">Nenhuma manutenção registrada.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>Prevista</th><th>Tipo</th><th>Status</th><th>Descrição</th><th>Início</th><th>Conclusão</th><th class="num">Horímetro</th><th class="num">Custo</th></tr></thead>
    <tbody>${mans.map(m => `<tr><td>${dataBR(m.data_prevista)}</td><td>${esc(manTipo[m.tipo] || m.tipo)}</td>
      <td><span class="tag ${(manSt[m.status] || [])[1] || "cinza"}">${esc((manSt[m.status] || [])[0] || m.status)}</span></td>
      <td>${esc(m.descricao || "")}</td><td>${dataBR(m.data_inicio)}</td><td>${dataBR(m.data_conclusao)}</td>
      <td class="num">${m.horimetro_km != null ? num(m.horimetro_km) : "—"}</td><td class="num">${m.custo != null ? brl(m.custo) : "—"}</td></tr>`).join("")}</tbody></table></div>`);
}

/* ---------- aba Acessórios (a GERAL da planilha de hélice) ---------- */
function eqpAceTodos(){
  const m = new Map();
  [..._eqpAceCache.na, ..._eqpAceCache.pertence, ..._eqpAceCache.compat].forEach(a => m.set(a.id, a));
  return [...m.values()];
}
function eqpAceOrigem(a){
  const t = [];
  if(_eqpAceCache.na.some(x => x.id === a.id)) t.push("na máquina");
  if(_eqpAceCache.pertence.some(x => x.id === a.id)) t.push("pertence");
  if(_eqpAceCache.compat.some(x => x.id === a.id)) t.push("compatível");
  return t.join(" · ");
}
function eqpRenderAcessorios(){
  const c = $("eqp-ace-lista"); if(!c) return;
  document.querySelectorAll("#eqp-ace-modo .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.modo === _eqpAceModo));
  const base = _eqpAceModo === "na" ? _eqpAceCache.na : _eqpAceModo === "pertence" ? _eqpAceCache.pertence : _eqpAceModo === "compat" ? _eqpAceCache.compat : eqpAceTodos();
  if(!base.length){
    c.innerHTML = `<p class="vazio">${_eqpAceModo ? "Nenhuma peça nesta visão." : "Nenhuma peça ligada a esta máquina. Na ficha do acessório, informe <em>Pertence à TAG</em> ou marque como compatível; peças movidas para a máquina aparecem aqui sozinhas."}</p>`;
    return;
  }
  // jogo separado: irmãos do jogo (no catálogo inteiro) em lugares diferentes
  const cat = _eqpAceCache.cat || [];
  const jogoLocais = {};
  cat.forEach(a => { if(!a.jogo) return; const k = `${a.familia}|${a.jogo}`; const loc = (typeof aceColKey === "function") ? aceColKey(a) : (a.local_tipo + ":" + (a.local_equipamento_id || a.local_obra_id || "")); (jogoLocais[k] = jogoLocais[k] || new Set()).add(loc); });
  const separado = a => a.jogo && (jogoLocais[`${a.familia}|${a.jogo}`]?.size || 0) > 1;
  const descr = a => (typeof aceDescr === "function" ? aceDescr(a) : (a.tipo || ""));
  const onde = a => (typeof aceOnde === "function" ? aceOnde(a) : (a.local_tipo || ""));
  // grupos por Ø (desc), peças sem Ø no fim; dentro: jogo, seq, marcação
  const porDiam = new Map();
  base.forEach(a => { const k = a.diametro_mm ? Number(a.diametro_mm) : 0; (porDiam.get(k) || porDiam.set(k, []).get(k)).push(a); });
  const chaves = [...porDiam.keys()].sort((x, y) => (x === 0) - (y === 0) || y - x);
  const ordem = (x, y) => String(x.jogo || "").localeCompare(String(y.jogo || ""), "pt-BR", { numeric: true }) || (Number(x.seq_no_jogo) || 0) - (Number(y.seq_no_jogo) || 0) || String(x.marcacao).localeCompare(String(y.marcacao), "pt-BR", { numeric: true });
  c.innerHTML = chaves.map(k => {
    const ps = porDiam.get(k).sort(ordem);
    const jogos = new Set(ps.filter(a => a.jogo).map(a => a.jogo));
    return `<div class="eqp-diam-bloco">
      <div class="eqp-diam-titulo">${k ? `Ø ${k} mm` : "Sem Ø (guias, prolongas, caixas, bombas…)"} <span class="meta">${ps.length} peça(s)${jogos.size ? ` · ${jogos.size} jogo(s)` : ""}</span></div>
      <div class="tabela-rola"><table>
        <thead><tr><th>Jogo</th><th>Marcação</th><th>Peça</th><th class="num">Passo</th><th class="num">Compr.</th><th>Condição</th><th>Onde está</th><th>Vínculo</th></tr></thead>
        <tbody>${ps.map(a => `<tr class="linha-clicavel" data-ace="${esc(a.id)}">
          <td>${a.jogo ? `<strong>${esc(a.jogo)}</strong>${a.seq_no_jogo != null ? ` <span class="meta">#${esc(a.seq_no_jogo)}</span>` : ""}${separado(a) ? ` <span class="tag vermelho" title="peças deste jogo estão em lugares diferentes">jogo separado</span>` : ""}` : "—"}</td>
          <td><strong>${esc(a.marcacao)}</strong></td>
          <td>${esc(descr(a))}</td>
          <td class="num">${a.passo_mm ? esc(a.passo_mm) : "—"}</td>
          <td class="num">${a.comprimento_m ? esc(a.comprimento_m) + " m" : "—"}</td>
          <td>${tagStatus("acessorio", a.condicao)}</td>
          <td>${esc(onde(a))}</td>
          <td class="meta">${esc(eqpAceOrigem(a))}</td>
        </tr>`).join("")}</tbody></table></div>
    </div>`;
  }).join("");
}

/* ---------- salvar ---------- */
async function salvarEquipamento(){
  if(!eqpPodeEditar()) return;
  const n = v => v === "" ? null : Number(v);
  const localTipo = $("eqp-local-tipo").value;
  const reg = {
    nome: $("eqp-nome").value.trim(), tipo: $("eqp-tipo").value,
    marca: $("eqp-marca").value.trim() || null, modelo: $("eqp-modelo").value.trim() || null,
    ano_fabricacao: n($("eqp-ano").value), numero_serie: $("eqp-serie").value.trim() || null,
    horimetro: n($("eqp-horimetro").value), data_aquisicao: $("eqp-aquisicao").value || null, valor_aquisicao: n($("eqp-valor").value),
    codigo_externo: $("eqp-cod-ext").value.trim() || null, ativo: $("eqp-ativo").checked,
    localizacao_tipo: localTipo,
    localizacao_obra_id: ["obra","em_transito","cliente"].includes(localTipo) ? ($("eqp-local-obra").value || null) : null,
    localizacao_descricao: $("eqp-local-desc").value.trim() || null,
    observacoes: $("eqp-obs").value.trim() || null,
    encaixe_trado: $("eqp-encaixe").value.trim() || null, acoplamento_trado: $("eqp-acopl").value || null,
    diametro_max_mm: n($("eqp-diam-max").value), profundidade_max_m: n($("eqp-prof-max").value), pino_trado_mm: n($("eqp-pino").value),
    obs_acessorios: $("eqp-obs-ace").value.trim() || null
  };
  if(!reg.nome){ aviso("app-aviso", "Informe o nome do equipamento.", "erro"); $("eqp-nome").focus(); return; }
  if(reg.localizacao_tipo === "obra" && !reg.localizacao_obra_id){ aviso("app-aviso", "Escolha a obra em que a máquina está.", "erro"); return; }
  const atual = _eqpAtual || {};
  const mudouLocal = _eqpEditId && (atual.localizacao_tipo !== reg.localizacao_tipo || (atual.localizacao_obra_id || null) !== reg.localizacao_obra_id || (atual.localizacao_descricao || null) !== reg.localizacao_descricao);
  if(mudouLocal) reg.localizacao_atualizada_em = new Date().toISOString();
  let id = _eqpEditId;
  if(id){
    const { error } = await sb.from("equipamentos").update(reg).eq("id", id);
    if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return; }
  } else {
    const codigo = $("eqp-codigo").value.trim().toUpperCase();
    if(!codigo){ aviso("app-aviso", "Informe a TAG.", "erro"); $("eqp-codigo").focus(); return; }
    if(_eqpRegistros.some(e => String(e.codigo).toUpperCase() === codigo)){ aviso("app-aviso", `Já existe a TAG ${codigo}.`, "erro"); return; }
    const { data, error } = await sb.from("equipamentos").insert({ ...reg, codigo, status: "disponivel" }).select("id").single();
    if(error){ aviso("app-aviso", "Erro ao cadastrar: " + error.message, "erro"); return; }
    id = data.id;
  }
  aviso("app-aviso", "Equipamento salvo.", "ok");
  await carregarEquipamentos(true);
  await abrirEquipamento(id);
}
async function eqpMudarStatus(novo){
  if(!_eqpEditId || !eqpPodeEditar()) return;
  if(novo === (_eqpAtual.status || "disponivel")) return;
  const lbl = eqpLbl(novo);
  if(novo === "inativo" && !confirm(`Marcar ${_eqpAtual.codigo} como INATIVO? A TAG some das listas de mobilização e remessa.`)) return;
  const { error } = await sb.from("equipamentos").update({ status: novo }).eq("id", _eqpEditId);
  if(error){ aviso("app-aviso", "Não foi possível mudar o status: " + error.message, "erro"); return; }
  aviso("app-aviso", `${_eqpAtual.codigo}: ${lbl}.`, "ok");
  await carregarEquipamentos(true);
  await abrirEquipamento(_eqpEditId);
}

/* ---------- atalhos para outros módulos ---------- */
function eqpNovaRemessa(){
  const e = _eqpAtual; if(!e?.id) return;
  if(!irParaSecao("movimentacoes") || typeof novaMovimentacao !== "function") return;
  setTimeout(() => {
    novaMovimentacao();
    const sel = $("mov-add-equip");
    if(sel && typeof adicionarEquipamento === "function"){
      if(![...sel.options].some(o => o.value === e.id)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`);
      if(!mapaEquipamentos[e.id]) mapaEquipamentos[e.id] = e;
      sel.value = e.id; adicionarEquipamento();
    }
    if(e.localizacao_tipo === "obra" && e.localizacao_obra_id && typeof movDefinirObra === "function"){
      $("mov-tipo").value = "retorno"; movDefinirObra("origem", e.localizacao_obra_id);
      $("mov-destino-tipo").value = "base"; $("mov-destino-descricao").value = "Base Itabira"; $("mov-destino-uf").value = "mg";
      if(typeof toggleObraCampos === "function") toggleObraCampos();
    }
    if(typeof ativarTab === "function") ativarTab("itens");
    aviso("app-aviso", `Movimentação pré-preenchida com a TAG ${e.codigo}. Revise origem/destino e as peças sugeridas.`, "ok");
  }, 250);
}
function eqpVerAcessorios(){
  const e = _eqpAtual; if(!e?.id) return;
  if(!irParaSecao("acessorios")) return;
  const aplicar = () => {
    const f = $("ace-f-equip"); if(!f) return;
    if(![...f.options].some(o => o.value === e.id)) f.insertAdjacentHTML("beforeend", `<option value="${esc(e.id)}">${esc(e.codigo)}</option>`);
    f.value = e.id;
    if(typeof _aceFamilia !== "undefined"){ _aceFamilia = ""; document.querySelectorAll("#ace-familias .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.familia === "")); }
    if(typeof renderAcessorios === "function") renderAcessorios();
  };
  if(typeof carregarAcessorios === "function") carregarAcessorios(false).then(aplicar); else setTimeout(aplicar, 400);
}
async function eqpAbrirAcessorio(id){
  if(!irParaSecao("acessorios")) return;
  if(typeof carregarAcessorios === "function") await carregarAcessorios(false);
  if(typeof abrirAcessorio === "function") abrirAcessorio(id);
}
async function eqpAbrirMobilizacao(id){
  if(!irParaSecao("mobilizacoes")) return;
  if(typeof carregarMobilizacoes === "function") await carregarMobilizacoes(false);
  if(typeof abrirMobilizacao === "function") abrirMobilizacao(id);
}
async function eqpAbrirMovimentacao(id){
  if(!irParaSecao("movimentacoes")) return;
  if(typeof carregarMovimentacoes === "function" && !(typeof _movRegistros !== "undefined" && _movRegistros.length)) await carregarMovimentacoes();
  if(typeof abrirMovimentacao === "function") abrirMovimentacao(id);
}

/* ---------- ligação ---------- */
function ligarEquipamentos(){
  if(!$("sec-equipamentos")) return;
  document.querySelector('nav button[data-secao="equipamentos"]')?.addEventListener("click", () => carregarEquipamentos(false));
  document.querySelectorAll("#eqp-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _eqpView = b.dataset.view; renderEquipamentos(); }));
  document.querySelectorAll("#eqp-painel .ind[data-kpi]").forEach(el => el.addEventListener("click", () => { _eqpKpi = (_eqpKpi === el.dataset.kpi) ? "" : el.dataset.kpi; renderEquipamentos(); }));
  ["eqp-f-tipo","eqp-f-status","eqp-f-local","eqp-f-obra","eqp-f-inativos"].forEach(id => $(id)?.addEventListener("change", renderEquipamentos));
  $("eqp-busca")?.addEventListener("input", debounce(renderEquipamentos));
  $("btn-eqp-atualizar")?.addEventListener("click", () => carregarEquipamentos(true));
  $("btn-eqp-novo")?.addEventListener("click", novoEquipamento);
  $("eqp-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a.link-obra")) return;
    const el = e.target.closest("[data-id]");
    if(el) abrirEquipamento(el.dataset.id);
  });

  // ficha
  $("btn-eqp-voltar")?.addEventListener("click", mostrarPainelEquipamentos);
  $("btn-eqp-salvar")?.addEventListener("click", () => comBotaoTravado("btn-eqp-salvar", salvarEquipamento));
  $("btn-eqp-remessa")?.addEventListener("click", eqpNovaRemessa);
  $("btn-eqp-acessorios")?.addEventListener("click", eqpVerAcessorios);
  $("eqp-local-tipo")?.addEventListener("change", eqpToggleLocalObra);
  document.querySelectorAll("#eqp-notebook button").forEach(b => b.addEventListener("click", () => ativarTabEquipamento(b.dataset.tab)));
  document.querySelectorAll("#eqp-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => ativarTabEquipamento(b.dataset.gotoTab)));
  document.querySelectorAll("#eqp-statusbar .stage").forEach(st => st.addEventListener("click", () => eqpMudarStatus(st.dataset.status)));
  document.querySelectorAll("#eqp-ace-modo .serv-view-btn").forEach(b => b.addEventListener("click", () => { _eqpAceModo = b.dataset.modo; eqpRenderAcessorios(); }));
  $("eqp-ace-lista")?.addEventListener("click", e => { const tr = e.target.closest("tr[data-ace]"); if(tr) eqpAbrirAcessorio(tr.dataset.ace); });
  $("eqp-mob-lista")?.addEventListener("click", e => { if(e.target.closest("a.link-obra")) return; const tr = e.target.closest("tr[data-mob]"); if(tr) eqpAbrirMobilizacao(tr.dataset.mob); });
  $("eqp-mov-lista")?.addEventListener("click", e => { if(e.target.closest("a.link-obra")) return; const tr = e.target.closest("tr[data-mov]"); if(tr) eqpAbrirMovimentacao(tr.dataset.mov); });
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarEquipamentos);
else ligarEquipamentos();

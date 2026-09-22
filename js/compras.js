/* ====================================================================
   Módulo: Compras (fase 53 — plano "Compras e Custos por Equipamento", fase 1)
   Pedido de compra → aprovação por alçada → enviado → recebimento da NF (manual nesta fase)
   → entrada de estoque (destino base) ou custo direto (obra/TAG) → títulos a pagar.
   Fase 55 (21/09/2026): as visões A pagar, Lançamentos avulsos e a exportação saíram daqui para
   "Contratos & Contas a pagar" (js/contas_pagar.js). Ficam aqui o modal de custo avulso e a aba
   Custos (vw_custos) usada por Equipamentos e Obras.
   Prefixo: cmp-. Regras de negócio ficam nas RPCs (pedido_enviar_aprovacao, pedido_aprovar,
   pedido_mudar_status, recebimento_confirmar).
   ==================================================================== */

let _cmpView = "kanban";
let _cmpKpi = "";
let _cmpPedidos = [];
let _cmpForns = [];
let _cmpFornMap = {};
let _cmpObras = [];
let _cmpObraMap = {};
let _cmpEquips = [];
let _cmpEqMap = {};
let _cmpAlcada = -1;              // null = sem limite; -1 = sem alçada
let _cmpCarregado = false;
let _cmpAtual = null;             // pedido aberto
let _cmpEditId = null;
let _cmpItens = [];               // itens em edição na ficha
let _cmpRec = null;               // recebimento em montagem no modal
let _cmpAvPre = null;             // callback após salvar custo avulso

const CMP_STATUS = {
  rascunho:              { label: "Rascunho",             cor: "cinza" },
  aguardando_aprovacao:  { label: "Aguardando aprovação", cor: "ambar" },
  aprovado:              { label: "Aprovado",             cor: "azul" },
  enviado:               { label: "Enviado",              cor: "azul" },
  parcialmente_recebido: { label: "Parcialmente recebido",cor: "ambar" },
  recebido:              { label: "Recebido",             cor: "verde" },
  cancelado:             { label: "Cancelado",            cor: "vermelho" }
};
const CMP_STAGES = ["rascunho","aguardando_aprovacao","aprovado","enviado","parcialmente_recebido","recebido"];
const CMP_ABERTOS = ["rascunho","aguardando_aprovacao","aprovado","enviado","parcialmente_recebido"];
const CMP_CAT_LBL = { peca: "Peça", pneu: "Pneu", combustivel: "Combustível", lubrificante: "Lubrificante", servico_terceiro: "Serviço de terceiro", mao_obra_interna: "Mão de obra interna", frete: "Frete", locacao: "Locação", multa: "Multa", seguro_ipva: "Seguro / IPVA", deslocamento: "Deslocamento", outro: "Outro" };
const CMP_ORIGEM_LBL = { compra: "Compra direta", estoque: "Saída de estoque", deslocamento: "Deslocamento", manutencao: "Manutenção", reparo: "Reparo caldeiraria", avulso: "Avulso" };

function cmpPodeOperar(){
  return !!usuarioAtual && ["admin","diretor","comprador","almoxarife","gestor_acessorios","engenheiro","logistica","financeiro","mecanico"].includes(usuarioAtual.cargo);
}
function cmpForn(id){ const f = _cmpFornMap[id]; return f ? f.razao_social : ""; }
function cmpObra(id){ const o = _cmpObraMap[id]; return o ? `${o.codigo} — ${o.nome}` : ((typeof mapaObras === "object" && mapaObras && mapaObras[id]) || ""); }
function cmpEq(id){ const e = _cmpEqMap[id]; return e ? e.codigo + (e.nome ? " · " + e.nome : "") : ""; }
function cmpTag(st){ const o = CMP_STATUS[st] || {}; return `<span class="tag ${o.cor || "cinza"}">${esc(o.label || st)}</span>`; }
function cmpDestinoTxt(it){
  if(it.destino === "obra") return "Obra: " + (cmpObra(it.obra_id) || "?");
  if(it.destino === "equipamento") return "TAG " + (cmpEq(it.equipamento_id) || "?");
  return "Estoque";
}
function cmpDestinoValor(it){ return it.destino === "obra" ? "obra:" + (it.obra_id || "") : it.destino === "equipamento" ? "eq:" + (it.equipamento_id || "") : "estoque"; }
function cmpDestinoDoValor(v){
  if(v.startsWith("obra:")) return { destino: "obra", obra_id: v.slice(5) || null, equipamento_id: null };
  if(v.startsWith("eq:")) return { destino: "equipamento", obra_id: null, equipamento_id: v.slice(3) || null };
  return { destino: "estoque", obra_id: null, equipamento_id: null };
}
function cmpDestinoOptions(sel){
  const obras = _cmpObras.map(o => `<option value="obra:${o.id}"${sel === "obra:" + o.id ? " selected" : ""}>Obra: ${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("");
  const eqs = _cmpEquips.map(e => `<option value="eq:${e.id}"${sel === "eq:" + e.id ? " selected" : ""}>TAG ${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
  return `<option value="estoque"${sel === "estoque" ? " selected" : ""}>Estoque (base)</option><optgroup label="Custo direto na obra">${obras}</optgroup><optgroup label="Custo direto na TAG">${eqs}</optgroup>`;
}
function cmpCatOptions(sel){ return Object.entries(CMP_CAT_LBL).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join(""); }
function cmpAlcadaTxt(){ return _cmpAlcada === null ? "sem limite" : _cmpAlcada < 0 ? "sem alçada de aprovação" : "até " + brl(_cmpAlcada); }

/* ---------- carga ---------- */
/* Cadastros de apoio (fornecedores, obras, TAGs, alçada): painel, ficha, modal de custo avulso e
   também o módulo Contas a pagar (fase 55) usam daqui. */
async function cmpCarregarBase(force){
  if(!force && _cmpCarregado) return;
  {
    const [fo, ob, eq, al] = await Promise.all([
      sb.from("fornecedores").select("id,razao_social,nome_fantasia,cpf_cnpj,email,telefone,cidade,uf,condicao_pagamento_padrao,prazo_entrega_dias").eq("ativo", true).order("razao_social"),
      sb.from("obras").select("id,codigo,nome,status").not("status", "in", "(cancelada,concluida)").order("codigo", { ascending: false }),
      sb.from("equipamentos").select("id,codigo,nome,tipo").eq("ativo", true).order("codigo"),
      sb.rpc("compras_alcada_usuario")
    ]);
    _cmpForns = fo.data || []; _cmpFornMap = {}; _cmpForns.forEach(f => _cmpFornMap[f.id] = f);
    _cmpObras = ob.data || []; _cmpObraMap = {}; _cmpObras.forEach(o => _cmpObraMap[o.id] = o);
    _cmpEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
    _cmpEqMap = {}; _cmpEquips.forEach(e => _cmpEqMap[e.id] = e);
    _cmpAlcada = al.error ? -1 : (al.data === null || al.data === undefined ? null : Number(al.data));
    cmpPreencherSelectsFixos();
    _cmpCarregado = true;
  }
}
async function carregarCompras(force){
  const cont = $("cmp-conteudo"); if(!cont) return;
  if(force || !_cmpCarregado) cont.innerHTML = `<p class="vazio">Carregando compras…</p>`;
  await cmpCarregarBase(force);
  const pode = cmpPodeOperar();
  ["btn-cmp-novo","btn-cmp-receber-avulso"].forEach(id => { const b = $(id); if(b) b.style.display = pode ? "" : "none"; });
  await cmpFetchPedidos();
  renderCompras();
}
async function cmpFetchPedidos(){
  const pd = await sb.from("pedidos_compra").select("*, fornecedor:fornecedores(razao_social), itens:pedido_compra_itens(id,descricao,quantidade,quantidade_recebida,obra_id,equipamento_id)").order("created_at", { ascending: false }).limit(1000);
  if(pd.error){ aviso("app-aviso", "Erro ao carregar pedidos: " + pd.error.message, "erro"); return; }
  _cmpPedidos = pd.data || [];
}
function cmpPreencherSelectsFixos(){
  const fornOpts = ph => `<option value="">${ph}</option>` + _cmpForns.map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}${f.nome_fantasia && f.nome_fantasia !== f.razao_social ? " (" + esc(f.nome_fantasia) + ")" : ""}</option>`).join("");
  const obraOpts = ph => `<option value="">${ph}</option>` + _cmpObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("");
  const eqOpts = ph => `<option value="">${ph}</option>` + _cmpEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
  const set = (id, html) => { const el = $(id); if(el){ const v = el.value; el.innerHTML = html; el.value = v; } };
  set("cmp-forn", fornOpts("— escolha o fornecedor —")); set("cmp-f-forn", fornOpts("Fornecedor")); set("cmp-rec-forn", fornOpts("— fornecedor —")); set("cmp-av-forn", fornOpts("— nenhum —"));
  set("cmp-obra", obraOpts("— nenhuma —")); set("cmp-f-obra", obraOpts("Obra")); set("cmp-av-obra", obraOpts("— nenhuma —"));
  set("cmp-equip", eqOpts("— nenhuma —")); set("cmp-f-equip", eqOpts("TAG")); set("cmp-av-equip", eqOpts("— nenhuma —"));
  const fs = $("cmp-f-status"); if(fs) fs.innerHTML = `<option value="">Status</option>` + Object.entries(CMP_STATUS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
  const ac = $("cmp-av-cat"); if(ac) ac.innerHTML = cmpCatOptions("outro");
}

/* ---------- painel ---------- */
function cmpFiltrados(){
  const q = ($("cmp-busca")?.value || "").trim().toLowerCase();
  const fSt = $("cmp-f-status")?.value || "", fF = $("cmp-f-forn")?.value || "", fO = $("cmp-f-obra")?.value || "", fE = $("cmp-f-equip")?.value || "", fM = $("cmp-f-mes")?.value || "";
  const hoje = hojeISO();
  return _cmpPedidos.filter(p => {
    if(fSt && p.status !== fSt) return false;
    if(!fSt && _cmpKpi === "" && _cmpView === "kanban" && p.status === "cancelado") return false;
    if(fF && p.fornecedor_id !== fF) return false;
    if(fO && p.obra_id !== fO && !(p.itens || []).some(i => i.obra_id === fO)) return false;
    if(fE && p.equipamento_id !== fE && !(p.itens || []).some(i => i.equipamento_id === fE)) return false;
    if(fM && String(p.data_pedido || "").slice(0, 7) !== fM) return false;
    switch(_cmpKpi){
      case "aprovar":   if(p.status !== "aguardando_aprovacao") return false; break;
      case "entrega":   if(!["enviado","parcialmente_recebido","aprovado"].includes(p.status)) return false; break;
      case "atrasados": if(!(CMP_ABERTOS.includes(p.status) && p.previsao_entrega && p.previsao_entrega < hoje)) return false; break;
    }
    if(q){
      const alvo = [p.numero, p.fornecedor?.razao_social, cmpObra(p.obra_id), cmpEq(p.equipamento_id), p.condicao_pagamento, ...(p.itens || []).map(i => i.descricao)].filter(Boolean).join(" ").toLowerCase();
      if(!alvo.includes(q)) return false;
    }
    return true;
  });
}
function cmpRenderKpis(){
  const hoje = hojeISO();
  const ab = _cmpPedidos.filter(p => CMP_ABERTOS.includes(p.status));
  const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  set("cmp-kpi-abertos", ab.length);
  set("cmp-kpi-aprovar", ab.filter(p => p.status === "aguardando_aprovacao").length);
  set("cmp-kpi-entrega", ab.filter(p => ["enviado","parcialmente_recebido"].includes(p.status)).length);
  set("cmp-kpi-atrasados", ab.filter(p => p.previsao_entrega && p.previsao_entrega < hoje).length);
  set("cmp-kpi-valor", brl(ab.reduce((s, p) => s + Number(p.total || 0), 0)));
}
function renderCompras(){
  const cont = $("cmp-conteudo"); if(!cont) return;
  cmpRenderKpis();
  document.querySelectorAll("#cmp-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _cmpView));
  document.querySelectorAll("#cmp-painel .ind[data-kpi]").forEach(el => el.classList.toggle("ativo", el.dataset.kpi === _cmpKpi));
  $("cmp-filtros").style.display = ["kanban","lista"].includes(_cmpView) ? "" : "none";
  if(_cmpView === "recebimentos") return renderRecebimentos();
  const dados = cmpFiltrados();
  $("cmp-contador").textContent = `${dados.length} de ${_cmpPedidos.length}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhum pedido com esses filtros.</p>`; return; }
  if(_cmpView === "lista") renderComprasLista(dados); else renderComprasKanban(dados);
}
function cmpCardHTML(p){
  const hoje = hojeISO(); const atras = CMP_ABERTOS.includes(p.status) && p.previsao_entrega && p.previsao_entrega < hoje;
  const dest = p.obra_id ? "🏗️ " + esc(cmpObra(p.obra_id)) : p.equipamento_id ? "🚜 TAG " + esc(cmpEq(p.equipamento_id)) : "📦 Estoque";
  const it = p.itens || [];
  return `<div class="serv-kan-card" data-id="${esc(p.id)}">
    <div class="serv-kan-card-nome"><strong>${esc(p.numero)}</strong> <span class="meta">${dataBR(p.data_pedido)}</span></div>
    <div>${esc(p.fornecedor?.razao_social || "— sem fornecedor —")}</div>
    <div class="meta">${dest} · ${it.length} item(ns)</div>
    <div class="meta" style="display:flex;justify-content:space-between;margin-top:4px;"><strong>${brl(p.total)}</strong>${p.previsao_entrega ? `<span class="${atras ? "txt-perigo" : ""}">${atras ? "⚠ " : "📅 "}${dataBR(p.previsao_entrega)}</span>` : ""}</div>
  </div>`;
}
function renderComprasKanban(dados){
  const cols = CMP_STAGES.concat(dados.some(p => p.status === "cancelado") ? ["cancelado"] : []);
  $("cmp-conteudo").innerHTML = `<div class="serv-kanban">${cols.map(st => {
    const its = dados.filter(p => p.status === st);
    return `<div class="serv-kan-col" data-status="${st}"><div class="serv-kan-col-head">${cmpTag(st)} <span class="contador">${its.length}</span>${its.length ? ` <span class="meta">${brl(its.reduce((s, p) => s + Number(p.total || 0), 0))}</span>` : ""}</div>
      ${its.map(cmpCardHTML).join("") || `<p class="vazio">—</p>`}</div>`; }).join("")}</div>`;
}
function renderComprasLista(dados){
  const hoje = hojeISO();
  $("cmp-conteudo").innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Número</th><th>Data</th><th>Fornecedor</th><th>Destino</th><th class="num">Itens</th><th class="num">Total</th><th>Previsão</th><th>Status</th><th>Solicitante</th></tr></thead>
    <tbody>${dados.map(p => `<tr class="linha-clicavel" data-id="${esc(p.id)}">
      <td><strong>${esc(p.numero)}</strong></td><td>${dataBR(p.data_pedido)}</td><td>${esc(p.fornecedor?.razao_social || "—")}</td>
      <td>${p.obra_id ? linkObra(p.obra_id, cmpObra(p.obra_id)) : p.equipamento_id ? "TAG " + esc(cmpEq(p.equipamento_id)) : "Estoque"}</td>
      <td class="num">${(p.itens || []).length}</td><td class="num">${brl(p.total)}</td>
      <td class="${CMP_ABERTOS.includes(p.status) && p.previsao_entrega && p.previsao_entrega < hoje ? "txt-perigo" : ""}">${dataBR(p.previsao_entrega)}</td>
      <td>${cmpTag(p.status)}</td><td class="meta">${esc(p._solicitante || "")}</td></tr>`).join("")}</tbody></table></div>`;
}

/* recebimentos (visão do painel) */
async function renderRecebimentos(){
  const cont = $("cmp-conteudo");
  const { data, error } = await sb.from("recebimentos").select("id,status,nf_numero,nf_serie,data_recebimento,total_nf,fornecedor_id,pedido:pedidos_compra(numero),itens:recebimento_itens(id,destino)").order("data_recebimento", { ascending: false }).limit(300);
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  $("cmp-contador").textContent = `${(data || []).length} recebimento(s)`;
  if(!data?.length){ cont.innerHTML = `<p class="vazio">Nenhum recebimento ainda. Use "Receber NF" no pedido ou "Receber NF sem pedido".</p>`; return; }
  const stTag = s => s === "confirmado" ? '<span class="tag verde">Confirmado</span>' : s === "cancelado" ? '<span class="tag cinza">Cancelado</span>' : '<span class="tag ambar">Conferindo</span>';
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>NF</th><th>Fornecedor</th><th>Pedido</th><th class="num">Itens</th><th>Destinos</th><th class="num">Total</th><th>Status</th></tr></thead>
    <tbody>${data.map(r => { const it = r.itens || []; const d = [...new Set(it.map(i => i.destino === "estoque" ? "estoque" : "custo direto"))].join(" + ");
      return `<tr class="linha-clicavel" data-pedido="${esc(r.pedido ? r.pedido.numero : "")}"><td>${dataBR(r.data_recebimento)}</td><td><strong>${esc(r.nf_numero || "—")}</strong>${r.nf_serie ? "/" + esc(r.nf_serie) : ""}</td>
      <td>${esc(cmpForn(r.fornecedor_id) || "—")}</td><td>${r.pedido ? esc(r.pedido.numero) : '<span class="meta">sem pedido</span>'}</td><td class="num">${it.length}</td><td class="meta">${esc(d)}</td><td class="num">${brl(r.total_nf)}</td><td>${stTag(r.status)}</td></tr>`; }).join("")}</tbody></table></div>`;
}

/* ---------- ficha do pedido ---------- */
function mostrarPainelCompras(){
  $("cmp-ficha").style.display = "none"; $("cmp-painel").style.display = "";
  _cmpAtual = null; _cmpEditId = null; _cmpItens = [];
  if(typeof ocultarHistorico === "function") ocultarHistorico("cmp-chatter");
  renderCompras();
}
function novoPedido(pre){
  if(!cmpPodeOperar()){ aviso("app-aviso", "Seu perfil não opera compras.", "erro"); return; }
  _cmpItens = [];
  abrirFichaPedido(Object.assign({ id: null, numero: "(novo)", status: "rascunho", data_pedido: hojeISO(), local_entrega: "base", frete: 0, desconto: 0, total: 0, itens: [] }, pre || {}));
}
async function abrirPedido(id){
  const [{ data: p, error }, it] = await Promise.all([
    sb.from("pedidos_compra").select("*, fornecedor:fornecedores(razao_social), solicitante:profiles!pedidos_compra_solicitante_id_fkey(nome), aprovador:profiles!pedidos_compra_aprovador_id_fkey(nome)").eq("id", id).single(),
    sb.from("pedido_compra_itens").select("*").eq("pedido_id", id).order("ordem").order("created_at")
  ]);
  if(error || !p){ aviso("app-aviso", "Não foi possível abrir o pedido" + (error ? ": " + error.message : "."), "erro"); return; }
  if(it.error){ aviso("app-aviso", "Itens não carregaram: " + it.error.message, "erro"); return; }
  _cmpItens = (it.data || []).map(i => ({ ...i }));
  abrirFichaPedido(p);
}
function cmpEditavel(){ return cmpPodeOperar() && (_cmpAtual?.status || "rascunho") === "rascunho"; }
function abrirFichaPedido(p){
  _cmpAtual = p; _cmpEditId = p.id || null;
  const novo = !p.id;
  $("cmp-painel").style.display = "none"; $("cmp-ficha").style.display = "";
  $("cmp-ficha-titulo").textContent = novo ? "Novo pedido" : `${p.numero} · ${p.fornecedor?.razao_social || cmpForn(p.fornecedor_id) || "sem fornecedor"}`;
  const ed = cmpEditavel();
  $("cmp-forn").value = p.fornecedor_id || ""; $("cmp-data").value = p.data_pedido || hojeISO(); $("cmp-prev").value = p.previsao_entrega || "";
  $("cmp-cond").value = p.condicao_pagamento || ""; $("cmp-local").value = p.local_entrega || "base";
  $("cmp-obra").value = p.obra_id || ""; $("cmp-equip").value = p.equipamento_id || "";
  $("cmp-frete").value = p.frete ?? 0; $("cmp-desc").value = p.desconto ?? 0; $("cmp-obs").value = p.observacoes || "";
  $("cmp-ficha").querySelectorAll(".odoo-tab[data-tab=cabecalho] input, .odoo-tab[data-tab=cabecalho] select, .odoo-tab[data-tab=cabecalho] textarea").forEach(el => el.disabled = !ed);
  $("cmp-itens-add").style.display = ed ? "" : "none";
  $("cmp-alcada-info").textContent = `Sua alçada de aprovação: ${cmpAlcadaTxt()}. Pedido acima da alçada vai para "Aguardando aprovação" e é aprovado por quem tiver alçada.`;
  cmpAtualizarStatusbar(p.status || "rascunho");
  cmpAtualizarChips();
  cmpAtualizarBotoes();
  renderItensPedido();
  const setSb = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); } };
  setSb("sb-cmp-itens", _cmpItens.length); setSb("sb-cmp-rec", 0); setSb("sb-cmp-tit", 0);
  $("cmp-rec-lista").innerHTML = `<p class="vazio">${novo ? "Salve o pedido para receber." : "Carregando…"}</p>`;
  $("cmp-tit-lista").innerHTML = `<p class="vazio">—</p>`;
  if(!novo) cmpCarregarFilhas(p.id);
  if(!novo && typeof montarHistorico === "function") montarHistorico("pedidos_compra", p.id, "cmp-chatter");
  else if(typeof ocultarHistorico === "function") ocultarHistorico("cmp-chatter");
  ativarTabPedido(novo ? "cabecalho" : (_cmpItens.length ? "itens" : "cabecalho"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function cmpAtualizarStatusbar(st){
  document.querySelectorAll("#cmp-statusbar .stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    const i = CMP_STAGES.indexOf(st), j = CMP_STAGES.indexOf(el.dataset.status);
    if(st === "cancelado") return;
    if(j === i) el.classList.add("atual"); else if(j < i) el.classList.add("passada");
  });
  $("cmp-statusbar").title = st === "cancelado" ? "Pedido cancelado" : "Status do pedido";
}
function cmpAtualizarChips(){
  const p = _cmpAtual; if(!p) return;
  const total = _cmpItens.reduce((s, i) => s + Number(i.quantidade || 0) * Number(i.valor_unitario || 0), 0) + Number($("cmp-frete").value || 0) - Number($("cmp-desc").value || 0);
  $("cmp-chip-num").textContent = p.numero || "(novo)";
  $("cmp-chip-forn").textContent = cmpForn($("cmp-forn").value) || "—";
  const obra = $("cmp-obra").value, eq = $("cmp-equip").value;
  $("cmp-chip-destino").textContent = $("cmp-local").value === "obra" ? "Obra: " + (cmpObra(obra) || "?") : eq ? "TAG " + cmpEq(eq) : obra ? "Estoque · obra " + cmpObra(obra) : "Estoque (base)";
  $("cmp-chip-total").textContent = brl(total);
  $("cmp-chip-prev").textContent = dataBR($("cmp-prev").value) || "—";
  $("cmp-chip-aprov").textContent = p.status === "cancelado" ? "Cancelado" : p.aprovador ? `${p.aprovador.nome}${p.aprovado_em ? " · " + dataBR(String(p.aprovado_em).slice(0, 10)) : ""}` : p.status === "aguardando_aprovacao" ? "aguardando" : "—";
}
function cmpAtualizarBotoes(){
  const st = _cmpAtual?.status || "rascunho", novo = !_cmpEditId, pode = cmpPodeOperar();
  const total = Number(_cmpAtual?.total || 0);
  const podeAprovar = pode && st === "aguardando_aprovacao" && (_cmpAlcada === null || (_cmpAlcada >= 0 && total <= _cmpAlcada));
  const mostra = { "btn-cmp-salvar": pode && st === "rascunho", "btn-cmp-enviar-aprov": pode && st === "rascunho" && !novo, "btn-cmp-aprovar": podeAprovar,
    "btn-cmp-enviado": pode && st === "aprovado", "btn-cmp-receber": pode && ["aprovado","enviado","parcialmente_recebido"].includes(st),
    "btn-cmp-pdf": !novo && st !== "cancelado", "btn-cmp-voltar-rascunho": pode && ["aguardando_aprovacao","aprovado"].includes(st),
    "btn-cmp-cancelar": pode && !novo && !["recebido","cancelado"].includes(st) };
  Object.entries(mostra).forEach(([id, on]) => { const b = $(id); if(b) b.style.display = on ? "" : "none"; });
}
function ativarTabPedido(nome){
  document.querySelectorAll("#cmp-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#cmp-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
async function cmpCarregarFilhas(id){
  const [rec, tit] = await Promise.all([
    sb.from("recebimentos").select("id,status,nf_numero,nf_serie,data_recebimento,total_nf,vencimento,parcelas,itens:recebimento_itens(id,descricao,quantidade_aceita,valor_unitario_nf,destino,obra_id,equipamento_id)").eq("pedido_id", id).order("data_recebimento", { ascending: false }),
    sb.from("titulos_pagar").select("*, recebimento:recebimentos!inner(pedido_id)").eq("recebimento.pedido_id", id).order("vencimento")
  ]);
  if(_cmpEditId !== id) return;
  const setSb = (bid, n) => { const b = $(bid); if(b){ b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); } };
  const recs = rec.data || [], tits = tit.data || [];
  setSb("sb-cmp-rec", recs.length); setSb("sb-cmp-tit", tits.length);
  $("cmp-rec-lista").innerHTML = rec.error ? `<p class="vazio">Erro: ${esc(rec.error.message)}</p>` : !recs.length ? `<p class="vazio">Nenhum recebimento. Use "Receber NF" quando a mercadoria chegar.</p>` :
    recs.map(r => `<div class="card compacto" style="margin-bottom:10px;"><div class="lista-topo compacta"><h3>NF ${esc(r.nf_numero || "—")}${r.nf_serie ? "/" + esc(r.nf_serie) : ""} <span class="meta">recebida em ${dataBR(r.data_recebimento)}</span></h3>
      <span style="margin-left:auto;">${r.status === "confirmado" ? '<span class="tag verde">Confirmado</span>' : r.status === "cancelado" ? '<span class="tag cinza">Cancelado</span>' : '<span class="tag ambar">Conferindo</span>'} <strong>${brl(r.total_nf)}</strong></span></div>
      <table><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th>Destino</th></tr></thead><tbody>${(r.itens || []).map(i => `<tr><td>${esc(i.descricao)}</td><td class="num">${num(i.quantidade_aceita)}</td><td class="num">${brl(i.valor_unitario_nf)}</td><td class="meta">${esc(cmpDestinoTxt(i))}</td></tr>`).join("")}</tbody></table></div>`).join("");
  $("cmp-tit-lista").innerHTML = !podeVerContasPagar() ? `<p class="vazio">Os títulos deste pedido ficam em Contratos & Contas a pagar; seu perfil não tem acesso a esse módulo.</p>` : tit.error ? `<p class="vazio">Erro: ${esc(tit.error.message)}</p>` : !tits.length ? `<p class="vazio">Nenhum título. Eles nascem no recebimento da NF quando há vencimento informado.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>Vencimento</th><th>NF</th><th>Parcela</th><th class="num">Valor</th><th>Exportado ao financeiro</th></tr></thead><tbody>${tits.map(t => `<tr><td><strong>${dataBR(t.vencimento)}</strong></td><td>${esc(t.nf_numero || "—")}</td><td>${t.parcela}/${t.total_parcelas}</td><td class="num">${brl(t.valor)}</td><td>${t.exportado_em ? `<span class="tag verde">${dataBR(String(t.exportado_em).slice(0, 10))}</span>` : '<span class="tag ambar">pendente</span>'}</td></tr>`).join("")}</tbody></table></div>`;
}

/* itens */
function cmpDestinoPadrao(){
  const local = $("cmp-local").value, obra = $("cmp-obra").value, eq = $("cmp-equip").value;
  if(eq) return "eq:" + eq;
  if(local === "obra" && obra) return "obra:" + obra;
  return "estoque";
}
function renderItensPedido(){
  const tb = $("cmp-itens"); const ed = cmpEditavel();
  if(!_cmpItens.length){ tb.innerHTML = `<tr><td colspan="9" class="vazio">${ed ? "Adicione produtos do catálogo ou um item livre." : "Sem itens."}</td></tr>`; cmpAtualizarChips(); return; }
  tb.innerHTML = _cmpItens.map((it, idx) => {
    const tot = Number(it.quantidade || 0) * Number(it.valor_unitario || 0);
    return `<tr data-idx="${idx}">
      <td>${it.produto_id ? esc(it.descricao) : (ed ? `<input class="cmp-it" data-f="descricao" value="${esc(it.descricao || "")}" placeholder="descrição do item" style="width:100%;" />` : esc(it.descricao))}${it.produto_id ? "" : ' <span class="meta">livre</span>'}</td>
      <td>${ed && !it.produto_id ? `<input class="cmp-it" data-f="unidade" value="${esc(it.unidade || "un")}" style="width:56px;" />` : esc(it.unidade || "un")}</td>
      <td>${ed ? `<input type="number" step="0.001" min="0.001" class="cmp-it" data-f="quantidade" value="${esc(it.quantidade ?? 1)}" style="width:80px;text-align:right;" />` : num(it.quantidade)}</td>
      <td>${ed ? `<input type="number" step="0.01" min="0" class="cmp-it" data-f="valor_unitario" value="${esc(it.valor_unitario ?? 0)}" style="width:105px;text-align:right;" />` : brl(it.valor_unitario)}</td>
      <td class="num cmp-it-total">${brl(tot)}</td>
      <td>${ed ? `<select class="cmp-it" data-f="categoria_custo">${cmpCatOptions(it.categoria_custo || "peca")}</select>` : esc(CMP_CAT_LBL[it.categoria_custo] || "—")}</td>
      <td>${ed ? `<select class="cmp-it" data-f="destino" style="max-width:150px;">${cmpDestinoOptions(cmpDestinoValor(it))}</select>` : esc(cmpDestinoTxt(it))}</td>
      <td class="num">${it.quantidade_recebida ? num(it.quantidade_recebida) : "—"}</td>
      <td>${ed ? `<button type="button" class="btn-sec btn-sm cmp-it-rem" title="remover">×</button>` : ""}</td>
    </tr>`; }).join("");
  tb.querySelectorAll(".cmp-it").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", e => {
    const tr = e.target.closest("tr"), it = _cmpItens[Number(tr.dataset.idx)], f = e.target.dataset.f;
    if(f === "destino") Object.assign(it, cmpDestinoDoValor(e.target.value));
    else if(f === "quantidade" || f === "valor_unitario") it[f] = Number(e.target.value || 0);
    else it[f] = e.target.value;
    tr.querySelector(".cmp-it-total").textContent = brl(Number(it.quantidade || 0) * Number(it.valor_unitario || 0));
    cmpAtualizarChips();
  }));
  tb.querySelectorAll(".cmp-it-rem").forEach(b => b.addEventListener("click", e => { _cmpItens.splice(Number(e.target.closest("tr").dataset.idx), 1); renderItensPedido(); }));
  const sbi = $("sb-cmp-itens"); if(sbi){ sbi.querySelector(".sb-num").textContent = _cmpItens.length; sbi.classList.toggle("zero", !_cmpItens.length); }
  cmpAtualizarChips();
}
function cmpAddItem(p){
  const d = cmpDestinoDoValor(cmpDestinoPadrao());
  _cmpItens.push({ produto_id: p?.id || null, descricao: p ? `${p.codigo} — ${p.nome}` : "", unidade: p?.unidade || "un", quantidade: 1,
    valor_unitario: Number(p?.custo_ultimo || 0), categoria_custo: p?.categoria_custo || "peca", ...d, quantidade_recebida: 0 });
  renderItensPedido();
  if(!p){ const inp = $("cmp-itens").querySelector(`tr[data-idx="${_cmpItens.length - 1}"] input[data-f=descricao]`); if(inp) inp.focus(); }
}
async function cmpBuscarProdutos(termo){
  if(!termo || termo.length < 2) return [];
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data } = await sb.from("produtos").select("id,codigo,nome,unidade,estoque_atual,custo_ultimo,categoria_custo,fornecedor_padrao_id").eq("ativo", true).or(`nome.ilike.%${t}%,codigo.ilike.%${t}%`).order("nome").limit(25);
  return data || [];
}
function cmpLigarBusca(inpId, listaId, aoEscolher){
  const inp = $(inpId), lista = $(listaId); if(!inp || !lista) return;
  let t = null;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = inp.value.trim();
      if(termo.length < 2){ lista.innerHTML = ""; lista.style.display = "none"; return; }
      const res = await cmpBuscarProdutos(termo);
      lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">estoque ${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}${p.custo_ultimo ? " · último " + brl(p.custo_ultimo) : ""}</span></div>`).join("")
        : `<div class="resultado-item vazio">Nenhum produto. Use "Item livre" ou cadastre em Produtos.</div>`;
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => { const p = res.find(x => x.id === d.dataset.id); inp.value = ""; lista.innerHTML = ""; lista.style.display = "none"; aoEscolher(p); }));
    }, 250);
  });
}

/* salvar / ações */
function cmpColetarCabecalho(){
  return {
    fornecedor_id: $("cmp-forn").value || null, data_pedido: $("cmp-data").value || hojeISO(), previsao_entrega: $("cmp-prev").value || null,
    condicao_pagamento: $("cmp-cond").value.trim() || null, local_entrega: $("cmp-local").value, obra_id: $("cmp-obra").value || null, equipamento_id: $("cmp-equip").value || null,
    frete: Number($("cmp-frete").value || 0), desconto: Number($("cmp-desc").value || 0), observacoes: $("cmp-obs").value.trim() || null
  };
}
async function salvarPedido(silencioso){
  if(!cmpEditavel()){ if(!silencioso) aviso("app-aviso", "Este pedido não está em rascunho.", "erro"); return null; }
  const dados = cmpColetarCabecalho();
  if(dados.local_entrega === "obra" && !dados.obra_id){ aviso("app-aviso", "Entrega direto na obra: escolha a obra.", "erro"); ativarTabPedido("cabecalho"); return null; }
  for(const it of _cmpItens){
    if(!it.descricao || !String(it.descricao).trim()){ aviso("app-aviso", "Há item sem descrição.", "erro"); ativarTabPedido("itens"); return null; }
    if(!(Number(it.quantidade) > 0)){ aviso("app-aviso", `Quantidade inválida em "${it.descricao}".`, "erro"); ativarTabPedido("itens"); return null; }
    if(it.destino === "obra" && !it.obra_id || it.destino === "equipamento" && !it.equipamento_id){ aviso("app-aviso", `Destino incompleto em "${it.descricao}".`, "erro"); ativarTabPedido("itens"); return null; }
  }
  let id = _cmpEditId;
  if(id){
    const { error } = await sb.from("pedidos_compra").update(dados).eq("id", id);
    if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return null; }
  } else {
    const { data, error } = await sb.from("pedidos_compra").insert(dados).select("id").single();
    if(error){ aviso("app-aviso", "Erro ao criar o pedido: " + error.message, "erro"); return null; }
    id = data.id;
  }
  const { error: eDel } = await sb.from("pedido_compra_itens").delete().eq("pedido_id", id);
  if(eDel){ aviso("app-aviso", "Erro ao regravar os itens: " + eDel.message, "erro"); return null; }
  if(_cmpItens.length){
    const { error: eIns } = await sb.from("pedido_compra_itens").insert(_cmpItens.map((it, i) => ({
      pedido_id: id, ordem: i, produto_id: it.produto_id || null, descricao: String(it.descricao).trim(), unidade: it.unidade || "un", quantidade: Number(it.quantidade),
      valor_unitario: Number(it.valor_unitario || 0), categoria_custo: it.categoria_custo || null, destino: it.destino || "estoque", obra_id: it.obra_id || null, equipamento_id: it.equipamento_id || null
    })));
    if(eIns){ aviso("app-aviso", "Erro ao salvar itens: " + eIns.message, "erro"); return null; }
  }
  if(!silencioso) aviso("app-aviso", "Pedido salvo.", "ok");
  _cmpEditId = id;
  return id;
}
async function cmpAcao(acao){
  if(acao === "pdf"){ return cmpPdfPedido(); }
  if(acao === "receber"){ return abrirRecebimento(_cmpAtual); }
  let id = _cmpEditId;
  try {
    if(acao === "enviar_aprovacao"){
      id = await salvarPedido(true); if(!id) return;
      const { data, error } = await sb.rpc("pedido_enviar_aprovacao", { p_id: id }); if(error) throw error;
      aviso("app-aviso", data === "aprovado" ? "Pedido aprovado dentro da sua alçada. Marque como enviado quando mandar ao fornecedor." : "Pedido enviado para aprovação de quem tem alçada.", "ok");
    } else if(acao === "aprovar"){
      const { error } = await sb.rpc("pedido_aprovar", { p_id: id }); if(error) throw error;
      aviso("app-aviso", "Pedido aprovado.", "ok");
    } else if(acao === "enviado"){
      const { error } = await sb.rpc("pedido_mudar_status", { p_id: id, p_status: "enviado" }); if(error) throw error;
      aviso("app-aviso", "Pedido marcado como enviado ao fornecedor.", "ok");
    } else if(acao === "rascunho"){
      const { error } = await sb.rpc("pedido_mudar_status", { p_id: id, p_status: "rascunho" }); if(error) throw error;
      aviso("app-aviso", "Pedido voltou para rascunho.", "ok");
    } else if(acao === "cancelar"){
      const motivo = prompt("Motivo do cancelamento:"); if(motivo === null) return;
      const { error } = await sb.rpc("pedido_mudar_status", { p_id: id, p_status: "cancelado", p_motivo: motivo || null }); if(error) throw error;
      aviso("app-aviso", "Pedido cancelado.", "ok");
    }
  } catch(e){ aviso("app-aviso", (e.message || String(e)).replace(/^.*?: /, ""), "erro"); return; }
  await cmpFetchPedidos();
  await abrirPedido(id);
}

/* ---------- recebimento ---------- */
function abrirRecebimento(pedido){
  if(!cmpPodeOperar()) return;
  const semPedido = !pedido;
  _cmpRec = { pedido: pedido || null, itens: [], xml: null, duplicatas: null };
  $("cmp-rec-xml").value = "";
  $("cmp-rec-xml-info").textContent = "Clique ou arraste o XML aqui. Preenche cabeçalho, duplicatas e itens; casa os produtos por código do fornecedor, EAN e pedido.";
  $("cmp-rec-titulo").textContent = semPedido ? "Receber NF sem pedido" : `Receber NF — pedido ${pedido.numero}`;
  $("cmp-rec-forn").value = pedido?.fornecedor_id || ""; $("cmp-rec-forn").disabled = !semPedido;
  ["cmp-rec-nf","cmp-rec-chave","cmp-rec-emissao","cmp-rec-frete","cmp-rec-venc","cmp-rec-total","cmp-rec-obs"].forEach(id => $(id).value = "");
  $("cmp-rec-serie").value = "1"; $("cmp-rec-parc").value = "1"; $("cmp-rec-data").value = hojeISO();
  if(pedido && pedido.condicao_pagamento && /(\d+)\s*dias?/i.test(pedido.condicao_pagamento)){
    const dias = Number(RegExp.$1); const d = new Date(); d.setDate(d.getDate() + dias); $("cmp-rec-venc").value = d.toISOString().slice(0, 10);
    const parc = (pedido.condicao_pagamento.match(/\d+/g) || []).length; if(parc > 1) $("cmp-rec-parc").value = parc;
  }
  if(pedido){
    _cmpItens.forEach(it => {
      const pend = Number(it.quantidade || 0) - Number(it.quantidade_recebida || 0);
      if(pend <= 0) return;
      _cmpRec.itens.push({ pedido_item_id: it.id, produto_id: it.produto_id, descricao: it.descricao, unidade: it.unidade, pendente: pend, quantidade_nf: pend, valor_unitario_nf: Number(it.valor_unitario || 0),
        categoria_custo: it.categoria_custo, destino: it.destino, obra_id: it.obra_id, equipamento_id: it.equipamento_id });
    });
  }
  renderItensRecebimento();
  $("cmp-rec-modal").style.display = "flex";
}
function fecharRecebimento(){ $("cmp-rec-modal").style.display = "none"; _cmpRec = null; }
function renderItensRecebimento(){
  const tb = $("cmp-rec-itens"); const its = _cmpRec?.itens || [];
  if(!its.length){ tb.innerHTML = `<tr><td colspan="9" class="vazio">${_cmpRec?.pedido ? "Tudo deste pedido já foi recebido. Adicione itens fora do pedido se a nota trouxer." : "Adicione os itens da nota."}</td></tr>`; }
  else tb.innerHTML = its.map((it, idx) => `<tr data-idx="${idx}">
      <td>${it.livre && !it.produto_id ? `<input class="cmp-ri" data-f="descricao" value="${esc(it.descricao || "")}" placeholder="descrição na nota" style="width:100%;" />` : `<strong>${esc(it.descricao)}</strong>`}${it.codigo_fornecedor ? ` <span class="meta">cód. ${esc(it.codigo_fornecedor)}</span>` : ""}${cmpRiBadge(it)}
        ${it.pedido_item_id && it.casamento !== "manual" && it.produto_id ? (it.produto_txt && it.produto_txt !== it.descricao ? `<div class="meta">→ ${esc(it.produto_txt)}</div>` : "") : `<div class="cmp-ri-pick"><input class="cmp-ri-prod" placeholder="casar com produto do catálogo…" value="${esc(it.produto_txt || "")}" autocomplete="off" /><div class="autocomplete-lista" style="display:none;"></div></div>`}</td>
      <td>${esc(it.unidade || "un")}</td>
      <td class="num">${it.pendente != null ? num(it.pendente) : "—"}</td>
      <td><input type="number" step="0.001" min="0" class="cmp-ri" data-f="quantidade_nf" value="${esc(it.quantidade_nf ?? 0)}" style="width:80px;text-align:right;" /></td>
      <td><input type="number" step="0.0001" min="0" class="cmp-ri" data-f="valor_unitario_nf" value="${esc(it.valor_unitario_nf ?? 0)}" style="width:100px;text-align:right;" /></td>
      <td class="num cmp-ri-total">${brl(Number(it.quantidade_nf || 0) * Number(it.valor_unitario_nf || 0))}</td>
      <td colspan="2"><select class="cmp-ri" data-f="destino" style="max-width:280px;">${cmpDestinoOptions(cmpDestinoValor(it))}</select>${!it.produto_id ? ' <span class="meta" title="item sem produto casado não entra no estoque">só custo direto</span>' : ""}</td>
      <td><button type="button" class="btn-sec btn-sm cmp-ri-rem" title="tirar da nota">×</button></td>
    </tr>`).join("");
  tb.querySelectorAll(".cmp-ri").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", e => {
    const tr = e.target.closest("tr"), it = _cmpRec.itens[Number(tr.dataset.idx)], f = e.target.dataset.f;
    if(f === "destino") Object.assign(it, cmpDestinoDoValor(e.target.value));
    else if(f === "descricao") it.descricao = e.target.value; else it[f] = Number(e.target.value || 0);
    tr.querySelector(".cmp-ri-total").textContent = brl(Number(it.quantidade_nf || 0) * Number(it.valor_unitario_nf || 0));
    cmpRecSoma();
  }));
  tb.querySelectorAll(".cmp-ri-rem").forEach(b => b.addEventListener("click", e => { _cmpRec.itens.splice(Number(e.target.closest("tr").dataset.idx), 1); renderItensRecebimento(); }));
  tb.querySelectorAll("tr[data-idx]").forEach(tr => { const inp = tr.querySelector(".cmp-ri-prod"); if(inp) cmpRiPicker(tr, inp); });
  cmpRecSoma();
}
function cmpRiBadge(it){
  const m = { codigo: ["casado por código", "verde"], ean: ["casado por EAN", "verde"], pedido: ["do pedido", "azul"], manual: ["casado à mão", "verde"] };
  if(it.casamento && m[it.casamento]) return ` <span class="tag ${m[it.casamento][1]} cmp-ri-badge">${m[it.casamento][0]}</span>`;
  if(it.produto_id) return "";
  return ` <span class="tag ambar cmp-ri-badge">sem produto</span>`;
}
/* casamento de produto na linha do recebimento (XML ou item livre) */
function cmpRiPicker(tr, inp){
  const lista = tr.querySelector(".cmp-ri-pick .autocomplete-lista"); let t = null;
  const it = () => _cmpRec.itens[Number(tr.dataset.idx)];
  inp.addEventListener("input", () => {
    clearTimeout(t);
    const x = it(); if(!x) return;
    if(!inp.value.trim() && x.produto_id){ x.produto_id = null; x.produto_txt = ""; x.casamento = null; if(x.destino === "estoque" && !x.pedido_item_id){ /* fica para o usuário decidir */ } renderItensRecebimento(); return; }
    t = setTimeout(async () => {
      const termo = inp.value.trim(); if(termo.length < 2){ lista.style.display = "none"; return; }
      const res = await cmpBuscarProdutos(termo);
      lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}</span></div>`).join("") : `<div class="resultado-item vazio">Nenhum produto. Cadastre em Produtos ou mande para obra/TAG como custo direto.</div>`;
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => {
        const p = res.find(y => y.id === d.dataset.id); const x2 = it(); if(!p || !x2) return;
        x2.produto_id = p.id; x2.produto_txt = `${p.codigo} — ${p.nome}`; x2.casamento = "manual"; if(!x2.categoria_custo || x2.categoria_custo === "peca") x2.categoria_custo = p.categoria_custo || "peca";
        if(x2.livre && (!x2.descricao || !x2.descricao.trim())) x2.descricao = x2.produto_txt;
        if(_cmpRec.pedido && !x2.pedido_item_id) cmpLigarItemAoPedido(x2, cmpPedidoPendentes());
        renderItensRecebimento();
      }));
    }, 250);
  });
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 200));
}
function cmpRecSoma(){
  const s = (_cmpRec?.itens || []).reduce((a, it) => a + Number(it.quantidade_nf || 0) * Number(it.valor_unitario_nf || 0), 0) + Number($("cmp-rec-frete").value || 0);
  $("cmp-rec-soma").textContent = `Total dos itens + frete: ${brl(s)}`;
}
function cmpRecAddItem(p){
  const d = _cmpRec.pedido ? cmpDestinoDoValor(cmpDestinoPadraoDe(_cmpRec.pedido)) : { destino: "estoque", obra_id: null, equipamento_id: null };
  _cmpRec.itens.push({ pedido_item_id: null, produto_id: p?.id || null, produto_txt: p ? `${p.codigo} — ${p.nome}` : "", casamento: p ? "manual" : null, livre: !p, descricao: p ? `${p.codigo} — ${p.nome}` : "", unidade: p?.unidade || "un", pendente: null, quantidade_nf: 1,
    valor_unitario_nf: Number(p?.custo_ultimo || 0), categoria_custo: p?.categoria_custo || "peca", ...(p ? d : { destino: d.destino === "estoque" ? "obra" : d.destino, obra_id: d.obra_id, equipamento_id: d.equipamento_id }) });
  renderItensRecebimento();
}
function cmpDestinoPadraoDe(p){ return p.equipamento_id ? "eq:" + p.equipamento_id : (p.local_entrega === "obra" && p.obra_id) ? "obra:" + p.obra_id : "estoque"; }
async function confirmarRecebimento(){
  const r = _cmpRec; if(!r) return;
  const forn = $("cmp-rec-forn").value;
  if(!forn){ aviso("app-aviso", "Informe o fornecedor.", "erro"); return; }
  const itens = r.itens.filter(it => Number(it.quantidade_nf) > 0);
  if(!itens.length){ aviso("app-aviso", "Nenhum item com quantidade.", "erro"); return; }
  for(const it of itens){
    if(!it.descricao || !it.descricao.trim()){ aviso("app-aviso", "Há item sem descrição.", "erro"); return; }
    if(it.destino === "estoque" && !it.produto_id){ aviso("app-aviso", `"${it.descricao}" não tem cadastro: mande para obra ou TAG (custo direto) ou cadastre o produto.`, "erro"); return; }
    if(it.destino === "obra" && !it.obra_id || it.destino === "equipamento" && !it.equipamento_id){ aviso("app-aviso", `Destino incompleto em "${it.descricao}".`, "erro"); return; }
    if(it.pendente != null && Number(it.quantidade_nf) > it.pendente * 1.1 && !confirm(`"${it.descricao}": a nota traz ${num(it.quantidade_nf)} e o pedido tem ${num(it.pendente)} pendente. Receber assim mesmo?`)) return;
  }
  const venc = $("cmp-rec-venc").value || null;
  const dups = Array.isArray(r.duplicatas) && r.duplicatas.length ? r.duplicatas : null;
  if(!venc && !dups && !confirm("Sem vencimento não é gerado título a pagar para o financeiro. Continuar mesmo assim?")) return;
  const cab = {
    pedido_id: r.pedido?.id || null, fornecedor_id: forn, nf_numero: $("cmp-rec-nf").value.trim() || null, nf_serie: $("cmp-rec-serie").value.trim() || null,
    nf_chave: $("cmp-rec-chave").value.replace(/\D/g, "") || null, nf_data_emissao: $("cmp-rec-emissao").value || null, data_recebimento: $("cmp-rec-data").value || hojeISO(),
    frete: Number($("cmp-rec-frete").value || 0), vencimento: venc, parcelas: Math.max(1, Number($("cmp-rec-parc").value || 1)), total_nf: Number($("cmp-rec-total").value || 0), observacoes: $("cmp-rec-obs").value.trim() || null,
    duplicatas: dups, xml_texto: r.xml?.texto || null
  };
  const { data: rec, error } = await sb.from("recebimentos").insert(cab).select("id").single();
  if(error){ aviso("app-aviso", "Erro ao criar o recebimento: " + error.message, "erro"); return; }
  const { error: eIt } = await sb.from("recebimento_itens").insert(itens.map(it => ({
    recebimento_id: rec.id, pedido_item_id: it.pedido_item_id || null, produto_id: it.produto_id || null, descricao: it.descricao.trim(), unidade: it.unidade || "un",
    quantidade_nf: Number(it.quantidade_nf), valor_unitario_nf: Number(it.valor_unitario_nf || 0), quantidade_aceita: Number(it.quantidade_nf),
    categoria_custo: it.categoria_custo || null, destino: it.destino || "estoque", obra_id: it.obra_id || null, equipamento_id: it.equipamento_id || null,
    codigo_fornecedor: it.codigo_fornecedor || null, ean: it.ean || null, ncm: it.ncm || null, cfop: it.cfop || null, casamento: it.casamento || null
  })));
  if(eIt){ await sb.from("recebimentos").delete().eq("id", rec.id); aviso("app-aviso", "Erro nos itens do recebimento: " + eIt.message, "erro"); return; }
  const { error: eRpc } = await sb.rpc("recebimento_confirmar", { p_id: rec.id });
  if(eRpc){ await sb.from("recebimentos").delete().eq("id", rec.id); aviso("app-aviso", "Recebimento não confirmado: " + eRpc.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", "Recebimento confirmado: estoque/custos atualizados" + (venc ? " e títulos gerados." : "."), "ok");
  fecharRecebimento();
  if(typeof aceInvalidar === "function") aceInvalidar();
  if(typeof carregarProdutos === "function") carregarProdutos();
  await cmpFetchPedidos();
  if(r.pedido?.id) await abrirPedido(r.pedido.id); else renderCompras();
}

/* ---------- XML da NF-e ---------- */
function cmpLerXmlNfe(text){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error("O arquivo não é um XML válido.");
  const first = (el, tag) => el ? el.getElementsByTagNameNS("*", tag)[0] : null;
  const g = (el, tag) => { const n = first(el, tag); return n ? n.textContent.trim() : ""; };
  const inf = first(doc, "infNFe");
  if(!inf) throw new Error("Não é um XML de NF-e (infNFe não encontrado). Eventos e cancelamentos não servem aqui.");
  const ide = first(inf, "ide"), emit = first(inf, "emit"), dest = first(inf, "dest"), tot = first(inf, "ICMSTot"), ender = first(emit, "enderEmit");
  const chave = (inf.getAttribute("Id") || "").replace(/^NFe/i, "") || g(doc, "chNFe");
  const itens = [...inf.getElementsByTagNameNS("*", "det")].map(d => { const p = first(d, "prod"); return {
    nItem: d.getAttribute("nItem"), cProd: g(p, "cProd"), cEAN: g(p, "cEAN") || g(p, "cEANTrib"), xProd: g(p, "xProd"), ncm: g(p, "NCM"), cfop: g(p, "CFOP"),
    uCom: g(p, "uCom"), qCom: Number(g(p, "qCom") || 0), vUnCom: Number(g(p, "vUnCom") || 0), vProd: Number(g(p, "vProd") || 0) }; });
  const duplicatas = [...inf.getElementsByTagNameNS("*", "dup")].map(d => ({ n: g(d, "nDup"), vencimento: g(d, "dVenc"), valor: Number(g(d, "vDup") || 0) })).filter(d => d.vencimento && d.valor > 0);
  return {
    chave, numero: g(ide, "nNF"), serie: g(ide, "serie"), emissao: (g(ide, "dhEmi") || g(ide, "dEmi")).slice(0, 10), natureza: g(ide, "natOp"),
    emit: { cnpj: (g(emit, "CNPJ") || g(emit, "CPF")).replace(/\D/g, ""), nome: g(emit, "xNome"), fantasia: g(emit, "xFant"), ie: g(emit, "IE"), fone: g(ender, "fone"), cidade: g(ender, "xMun"), uf: g(ender, "UF"), cep: g(ender, "CEP"), logradouro: g(ender, "xLgr"), numero: g(ender, "nro"), bairro: g(ender, "xBairro") },
    dest_cnpj: (g(dest, "CNPJ") || g(dest, "CPF")).replace(/\D/g, ""),
    totais: { vNF: Number(g(tot, "vNF") || 0), vProd: Number(g(tot, "vProd") || 0), vFrete: Number(g(tot, "vFrete") || 0), vDesc: Number(g(tot, "vDesc") || 0), vIPI: Number(g(tot, "vIPI") || 0), vST: Number(g(tot, "vST") || 0) },
    itens, duplicatas
  };
}
function cmpPedidoPendentes(){
  if(!_cmpRec?.pedido) return [];
  if(!_cmpRec._pend) _cmpRec._pend = _cmpItens.filter(it => Number(it.quantidade || 0) - Number(it.quantidade_recebida || 0) > 0).map(it => ({ ...it, _usado: _cmpRec.itens.some(x => x.pedido_item_id === it.id) }));
  return _cmpRec._pend;
}
function cmpTokens(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 2); }
/* liga um item da nota a um item pendente do pedido: mesmo produto, ou descrição parecida quando o item do pedido é livre */
function cmpLigarItemAoPedido(it, pend){
  if(!pend || !pend.length || it.pedido_item_id) return false;
  let p = it.produto_id ? pend.find(x => !x._usado && x.produto_id === it.produto_id) : null;
  if(!p){
    const tk = cmpTokens(it.descricao); if(tk.length){
      let melhor = null, score = 0;
      pend.filter(x => !x._usado && !x.produto_id).forEach(x => { const t2 = cmpTokens(x.descricao); const inter = tk.filter(w => t2.includes(w)).length; if(inter >= Math.min(2, t2.length) && inter > score){ score = inter; melhor = x; } });
      p = melhor;
    }
  }
  if(!p) return false;
  it.pedido_item_id = p.id; it.pendente = Number(p.quantidade || 0) - Number(p.quantidade_recebida || 0);
  it.destino = p.destino || it.destino; it.obra_id = p.obra_id || null; it.equipamento_id = p.equipamento_id || null;
  if(p.categoria_custo) it.categoria_custo = p.categoria_custo;
  if(!it.produto_id && p.produto_id){ it.produto_id = p.produto_id; it.produto_txt = p.descricao; it.casamento = "pedido"; }
  if(!it.casamento) it.casamento = "pedido";
  p._usado = true;
  return true;
}
async function cmpImportarXml(file){
  if(!_cmpRec || !file) return;
  const info = $("cmp-rec-xml-info");
  let texto, nf;
  try { texto = await file.text(); nf = cmpLerXmlNfe(texto); } catch(e){ aviso("app-aviso", e.message || String(e), "erro"); return; }
  info.textContent = "Lendo a nota…";
  _cmpRec.xml = { texto, chave: nf.chave, nome: file.name }; _cmpRec._pend = null;
  // cabeçalho
  $("cmp-rec-nf").value = nf.numero; $("cmp-rec-serie").value = nf.serie || "1"; $("cmp-rec-chave").value = nf.chave; $("cmp-rec-emissao").value = nf.emissao;
  $("cmp-rec-frete").value = nf.totais.vFrete || ""; $("cmp-rec-total").value = nf.totais.vNF || "";
  if(nf.duplicatas.length){ _cmpRec.duplicatas = nf.duplicatas; $("cmp-rec-venc").value = nf.duplicatas[0].vencimento; $("cmp-rec-parc").value = nf.duplicatas.length; }
  else { _cmpRec.duplicatas = null; }
  // fornecedor pelo CNPJ
  const forn = _cmpForns.find(f => (f.cpf_cnpj || "").replace(/\D/g, "") === nf.emit.cnpj);
  const avisos = [];
  if(forn){
    if(_cmpRec.pedido && _cmpRec.pedido.fornecedor_id && _cmpRec.pedido.fornecedor_id !== forn.id) avisos.push(`⚠ a nota é de <strong>${esc(forn.razao_social)}</strong>, mas o pedido é de ${esc(cmpForn(_cmpRec.pedido.fornecedor_id))}`);
    if(!_cmpRec.pedido) $("cmp-rec-forn").value = forn.id;
  }
  // já foi recebida?
  if(nf.chave){ const { data: dupNf } = await sb.from("recebimentos").select("id,status").eq("nf_chave", nf.chave).neq("status", "cancelado").limit(1); if(dupNf?.length) avisos.push(`⚠ <strong>esta chave de acesso já tem um recebimento registrado</strong>. Confira antes de confirmar de novo`); }
  // casamento de produtos: código do fornecedor → EAN → pedido
  const [cod, ean] = await Promise.all([
    forn ? sb.from("produto_fornecedor_codigos").select("codigo_fornecedor,produto:produtos(id,codigo,nome,unidade,custo_ultimo,categoria_custo)").eq("fornecedor_id", forn.id) : Promise.resolve({ data: [] }),
    (() => { const eans = nf.itens.map(i => i.cEAN).filter(e => e && !/sem\s*gtin/i.test(e)); return eans.length ? sb.from("produtos").select("id,codigo,nome,unidade,custo_ultimo,categoria_custo,codigo_barras").in("codigo_barras", eans) : Promise.resolve({ data: [] }); })()
  ]);
  const mapCod = {}; (cod.data || []).forEach(c => { if(c.produto) mapCod[c.codigo_fornecedor] = c.produto; });
  const mapEan = {}; (ean.data || []).forEach(p => mapEan[p.codigo_barras] = p);
  const destPadrao = cmpDestinoDoValor(_cmpRec.pedido ? cmpDestinoPadraoDe(_cmpRec.pedido) : "estoque");
  _cmpRec.itens = nf.itens.map(d => {
    let prod = mapCod[d.cProd] || null, cas = prod ? "codigo" : null;
    const eanOk = d.cEAN && !/sem\s*gtin/i.test(d.cEAN) ? d.cEAN : null;
    if(!prod && eanOk && mapEan[eanOk]){ prod = mapEan[eanOk]; cas = "ean"; }
    return { pedido_item_id: null, produto_id: prod?.id || null, produto_txt: prod ? `${prod.codigo} — ${prod.nome}` : "", casamento: cas, livre: false,
      descricao: d.xProd, codigo_fornecedor: d.cProd || null, ean: eanOk, ncm: d.ncm || null, cfop: d.cfop || null,
      unidade: (d.uCom || "un").toLowerCase().slice(0, 8), pendente: null, quantidade_nf: d.qCom, valor_unitario_nf: d.vUnCom,
      categoria_custo: prod?.categoria_custo || "peca", ...destPadrao };
  });
  const pend = cmpPedidoPendentes(); pend.forEach(p => p._usado = false);
  _cmpRec.itens.forEach(it => cmpLigarItemAoPedido(it, pend));
  const naoVieram = pend.filter(p => !p._usado).length;
  const casados = _cmpRec.itens.filter(i => i.produto_id).length, semProd = _cmpRec.itens.length - casados;
  const somaItens = _cmpRec.itens.reduce((s, i) => s + i.quantidade_nf * i.valor_unitario_nf, 0);
  const dif = nf.totais.vNF - somaItens - (nf.totais.vFrete || 0);
  info.innerHTML = `✔ NF <strong>${esc(nf.numero)}</strong> de <strong>${esc(nf.emit.nome)}</strong> (${esc(nf.emit.cnpj)}) · ${nf.itens.length} item(ns): ${casados} casado(s) com o catálogo${semProd ? `, <strong>${semProd} para casar</strong> (ou mandar como custo direto)` : ""}`
    + (nf.duplicatas.length ? ` · ${nf.duplicatas.length} duplicata(s)` : " · sem duplicatas no XML: informe o vencimento")
    + (naoVieram ? ` · ${naoVieram} item(ns) do pedido não vieram nesta nota (ficam pendentes)` : "")
    + (Math.abs(dif) >= 0.05 ? ` · total da NF ${brl(nf.totais.vNF)} difere dos itens + frete em ${brl(dif)} (IPI/ST/desconto)` : "")
    + (!forn ? `<br>⚠ Emitente não está no cadastro de fornecedores. <button type="button" class="btn-sec btn-sm" id="btn-cmp-rec-criar-forn">Cadastrar a partir da NF</button>` : "")
    + (avisos.length ? "<br>" + avisos.join("<br>") : "");
  $("btn-cmp-rec-criar-forn")?.addEventListener("click", () => comBotaoTravado("btn-cmp-rec-criar-forn", () => cmpCriarFornecedorDaNf(nf.emit)));
  renderItensRecebimento();
}
async function cmpCriarFornecedorDaNf(e){
  const reg = { razao_social: e.nome || "Fornecedor da NF", nome_fantasia: e.fantasia || null, cpf_cnpj: e.cnpj || null, inscricao_estadual: e.ie || null, telefone: e.fone || null,
    cidade: e.cidade || null, uf: e.uf ? e.uf.toLowerCase() : null, cep: e.cep || null, logradouro: e.logradouro || null, numero: e.numero || null, bairro: e.bairro || null,
    tipo_pessoa: (e.cnpj || "").length === 11 ? "fisica" : "juridica", observacoes: "Cadastrado a partir do XML da NF-e em " + dataBR(hojeISO()) };
  const { data, error } = await sb.from("fornecedores").insert(reg).select("id,razao_social,nome_fantasia,cpf_cnpj,email,telefone,cidade,uf,condicao_pagamento_padrao,prazo_entrega_dias").single();
  if(error){ aviso("app-aviso", "Não foi possível cadastrar o fornecedor: " + error.message, "erro"); return; }
  _cmpForns.push(data); _cmpFornMap[data.id] = data; _cmpForns.sort((a, b) => a.razao_social.localeCompare(b.razao_social));
  cmpPreencherSelectsFixos();
  if(!_cmpRec?.pedido) $("cmp-rec-forn").value = data.id;
  if(typeof mapaFornecedores === "object" && mapaFornecedores) mapaFornecedores[data.id] = data.razao_social;
  $("btn-cmp-rec-criar-forn")?.closest("span, div")?.querySelector("#btn-cmp-rec-criar-forn")?.remove();
  aviso("app-aviso", `Fornecedor ${data.razao_social} cadastrado.`, "ok");
}

/* ---------- custo avulso ---------- */
async function abrirCustoAvulso(pre, depois){
  if(!cmpPodeOperar()){ aviso("app-aviso", "Seu perfil não lança custos.", "erro"); return; }
  _cmpAvPre = depois || null;
  await cmpCarregarBase(false);
  $("cmp-av-data").value = hojeISO(); $("cmp-av-cat").value = pre?.categoria || "outro"; $("cmp-av-valor").value = "";
  $("cmp-av-equip").value = pre?.equipamento_id || ""; $("cmp-av-obra").value = pre?.obra_id || ""; $("cmp-av-forn").value = "";
  $("cmp-av-desc").value = ""; $("cmp-av-doc").value = "";
  $("cmp-av-modal").style.display = "flex";
  setTimeout(() => { if(pre?.equipamento_id && $("cmp-av-equip")) $("cmp-av-equip").value = pre.equipamento_id; if(pre?.obra_id && $("cmp-av-obra")) $("cmp-av-obra").value = pre.obra_id; }, 300);
}
function fecharCustoAvulso(){ $("cmp-av-modal").style.display = "none"; }
async function salvarCustoAvulso(){
  const reg = { data: $("cmp-av-data").value || hojeISO(), categoria: $("cmp-av-cat").value, valor: Number($("cmp-av-valor").value), equipamento_id: $("cmp-av-equip").value || null, obra_id: $("cmp-av-obra").value || null,
    fornecedor_id: $("cmp-av-forn").value || null, descricao: $("cmp-av-desc").value.trim(), documento: $("cmp-av-doc").value.trim() || null };
  if(!(reg.valor >= 0) || $("cmp-av-valor").value === ""){ aviso("app-aviso", "Informe o valor.", "erro"); return; }
  if(!reg.descricao){ aviso("app-aviso", "Informe a descrição.", "erro"); return; }
  if(!reg.equipamento_id && !reg.obra_id){ aviso("app-aviso", "Informe a TAG ou a obra.", "erro"); return; }
  const { error } = await sb.from("custos_avulsos").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível lançar: " + error.message, "erro"); return; }
  aviso("app-aviso", "Custo lançado.", "ok");
  fecharCustoAvulso();
  if(_cmpAvPre) _cmpAvPre();
}

/* ---------- aba Custos (equipamento / obra) — lê vw_custos ---------- */
async function custosRender(containerId, filtro, cbTotal){
  const c = $(containerId); if(!c) return;
  c.innerHTML = `<p class="vazio">Carregando custos…</p>`;
  let q = sb.from("vw_custos").select("*").order("data", { ascending: false }).limit(2000);
  if(filtro.equipamento_id) q = q.eq("equipamento_id", filtro.equipamento_id);
  if(filtro.obra_id) q = q.eq("obra_id", filtro.obra_id);
  const { data, error } = await q;
  if(error){ c.innerHTML = `<p class="vazio">Erro ao carregar custos: ${esc(error.message)}</p>`; return; }
  const linhas = data || [];
  const total = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  if(cbTotal) cbTotal(total);
  const pode = cmpPodeOperar();
  const porCat = {}; linhas.forEach(l => porCat[l.categoria] = (porCat[l.categoria] || 0) + Number(l.valor || 0));
  const porMes = {}; linhas.forEach(l => { const m = String(l.data || "").slice(0, 7); porMes[m] = (porMes[m] || 0) + Number(l.valor || 0); });
  const meses = Object.keys(porMes).sort().reverse().slice(0, 12);
  const nomeForn = id => (typeof _cmpFornMap === "object" && _cmpFornMap[id]?.razao_social) || (typeof mapaFornecedores === "object" && mapaFornecedores && mapaFornecedores[id]) || "";
  const nomeObra = id => cmpObra(id) || "";
  const nomeEq = id => cmpEq(id) || (typeof aceEqTag === "function" ? aceEqTag(id) : "");
  c.innerHTML = `
    <div class="lista-topo compacta"><h3>Custos <span class="meta">${linhas.length} lançamento(s)</span></h3>
      <strong style="margin-left:auto;">Total ${brl(total)}</strong>
      ${pode ? `<button type="button" class="btn-sec btn-sm" id="${containerId}-av">＋ Custo avulso</button>` : ""}
      ${linhas.length ? `<button type="button" class="btn-sec btn-sm" id="${containerId}-xls">📊 Excel</button>` : ""}
    </div>
    ${linhas.length ? `<div class="custos-resumo">
      <div><div class="mov-ace-sug-grupo-t">Por categoria</div>${Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="custos-linha"><span>${esc(CMP_CAT_LBL[k] || k)}</span><strong>${brl(v)}</strong></div>`).join("")}</div>
      <div><div class="mov-ace-sug-grupo-t">Por mês</div>${meses.map(m => `<div class="custos-linha"><span>${m.slice(5, 7)}/${m.slice(0, 4)}</span><strong>${brl(porMes[m])}</strong></div>`).join("")}</div>
    </div>
    <div class="tabela-rola"><table><thead><tr><th>Data</th><th>Origem</th><th>Categoria</th><th>Descrição</th><th>${filtro.equipamento_id ? "Obra" : "TAG"}</th><th>Fornecedor</th><th>Doc.</th><th class="num">Valor</th></tr></thead>
      <tbody>${linhas.slice(0, 500).map(l => `<tr><td>${dataBR(l.data)}</td><td><span class="tag ${l.origem === "avulso" ? "ambar" : l.origem === "compra" ? "azul" : "cinza"}">${esc(CMP_ORIGEM_LBL[l.origem] || l.origem)}</span></td>
        <td>${esc(CMP_CAT_LBL[l.categoria] || l.categoria)}</td><td>${esc(l.descricao || "")}</td>
        <td>${filtro.equipamento_id ? (l.obra_id ? linkObra(l.obra_id, nomeObra(l.obra_id) || "obra") : "—") : esc(nomeEq(l.equipamento_id) || "—")}</td>
        <td>${esc(nomeForn(l.fornecedor_id) || "—")}</td><td class="meta">${esc(l.documento || "")}</td><td class="num">${brl(l.valor)}</td></tr>`).join("")}</tbody></table></div>
    ${linhas.length > 500 ? `<p class="meta">Mostrando 500 de ${linhas.length}. Use o Excel para a lista completa.</p>` : ""}`
    : `<p class="vazio">Nenhum custo registrado${filtro.equipamento_id ? " para esta TAG" : " para esta obra"}. Os custos nascem do recebimento de compra direta, da saída de estoque, de deslocamentos, manutenções, reparos e lançamentos avulsos.</p>`}`;
  $(`${containerId}-av`)?.addEventListener("click", () => abrirCustoAvulso({ equipamento_id: filtro.equipamento_id || "", obra_id: filtro.obra_id || "" }, () => custosRender(containerId, filtro, cbTotal)));
  $(`${containerId}-xls`)?.addEventListener("click", () => {
    const rows = linhas.map(l => ({ Data: dataBR(l.data), Origem: CMP_ORIGEM_LBL[l.origem] || l.origem, Categoria: CMP_CAT_LBL[l.categoria] || l.categoria, Descrição: l.descricao || "", TAG: nomeEq(l.equipamento_id), Obra: nomeObra(l.obra_id), Fornecedor: nomeForn(l.fornecedor_id), Documento: l.documento || "", Quantidade: Number(l.quantidade || 0), Valor: Number(l.valor || 0) }));
    if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "CUSTOS"); XLSX.writeFile(wb, `custos_${hojeISO()}.xlsx`);
  });
}

/* ---------- PDF do pedido ---------- */
async function cmpPdfPedido(){
  const p = _cmpAtual; if(!p?.id) return;
  const f = _cmpFornMap[p.fornecedor_id] || {};
  const itens = _cmpItens;
  const total = itens.reduce((s, i) => s + Number(i.quantidade || 0) * Number(i.valor_unitario || 0), 0) + Number(p.frete || 0) - Number(p.desconto || 0);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;padding:18mm 16mm;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1B5FA8;padding-bottom:8px;">
      <div><div style="font-size:20px;font-weight:700;color:#1B5FA8;">CGL Fundações</div><div>Itabira/MG</div></div>
      <div style="text-align:right;"><div style="font-size:16px;font-weight:700;">PEDIDO DE COMPRA ${esc(p.numero)}</div><div>Data: ${dataBR(p.data_pedido)}</div>${p.previsao_entrega ? `<div>Entrega prevista: ${dataBR(p.previsao_entrega)}</div>` : ""}</div>
    </div>
    <table style="width:100%;margin:10px 0;font-size:12px;"><tr>
      <td style="vertical-align:top;width:50%;"><strong>Fornecedor</strong><br>${esc(f.razao_social || "")}<br>${f.cpf_cnpj ? "CNPJ/CPF: " + esc(f.cpf_cnpj) + "<br>" : ""}${[f.cidade, f.uf].filter(Boolean).join("/")}<br>${esc(f.telefone || "")} ${esc(f.email || "")}</td>
      <td style="vertical-align:top;"><strong>Entrega</strong><br>${p.local_entrega === "obra" ? "Direto na obra: " + esc(cmpObra(p.obra_id)) : "Base CGL — Itabira/MG"}${p.equipamento_id ? "<br>Equipamento: TAG " + esc(cmpEq(p.equipamento_id)) : ""}<br><strong>Condição de pagamento:</strong> ${esc(p.condicao_pagamento || "a combinar")}</td>
    </tr></table>
    <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
      <thead><tr style="background:#eef3fa;"><th style="border:1px solid #ccd;padding:5px;text-align:left;">#</th><th style="border:1px solid #ccd;padding:5px;text-align:left;">Descrição</th><th style="border:1px solid #ccd;padding:5px;">Un</th><th style="border:1px solid #ccd;padding:5px;text-align:right;">Qtd</th><th style="border:1px solid #ccd;padding:5px;text-align:right;">Unitário</th><th style="border:1px solid #ccd;padding:5px;text-align:right;">Total</th></tr></thead>
      <tbody>${itens.map((i, k) => `<tr><td style="border:1px solid #ccd;padding:5px;">${k + 1}</td><td style="border:1px solid #ccd;padding:5px;">${esc(i.descricao)}</td><td style="border:1px solid #ccd;padding:5px;text-align:center;">${esc(i.unidade || "un")}</td><td style="border:1px solid #ccd;padding:5px;text-align:right;">${num(i.quantidade)}</td><td style="border:1px solid #ccd;padding:5px;text-align:right;">${brl(i.valor_unitario)}</td><td style="border:1px solid #ccd;padding:5px;text-align:right;">${brl(Number(i.quantidade || 0) * Number(i.valor_unitario || 0))}</td></tr>`).join("")}</tbody>
      <tfoot>${Number(p.frete) ? `<tr><td colspan="5" style="padding:4px;text-align:right;">Frete</td><td style="padding:4px;text-align:right;">${brl(p.frete)}</td></tr>` : ""}${Number(p.desconto) ? `<tr><td colspan="5" style="padding:4px;text-align:right;">Desconto</td><td style="padding:4px;text-align:right;">− ${brl(p.desconto)}</td></tr>` : ""}
        <tr><td colspan="5" style="padding:6px;text-align:right;font-weight:700;">TOTAL</td><td style="padding:6px;text-align:right;font-weight:700;">${brl(total)}</td></tr></tfoot>
    </table>
    ${p.observacoes ? `<p style="margin-top:10px;"><strong>Observações:</strong> ${esc(p.observacoes).replace(/\n/g, "<br>")}</p>` : ""}
    <p style="margin-top:14px;font-size:11px;color:#444;">Favor mencionar o número do pedido na nota fiscal. Entregas na base: seg–sex 7h–17h. ${p.aprovador ? "Aprovado por " + esc(p.aprovador.nome) + (p.aprovado_em ? " em " + dataBR(String(p.aprovado_em).slice(0, 10)) : "") + "." : ""}</p>
  </div>`;
  const wrap = document.createElement("div"); wrap.innerHTML = html;
  if(typeof html2pdf === "undefined"){
    const w = window.open("", "_blank"); if(!w){ aviso("app-aviso", "Permita pop-ups para imprimir.", "erro"); return; }
    w.document.write(`<html><head><title>${esc(p.numero)}</title></head><body>${html}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); return;
  }
  try {
    await html2pdf().set({ margin: 0, filename: `Pedido_${p.numero}.pdf`, image: { type: "jpeg", quality: 0.95 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } }).from(wrap).save();
  } catch(e){ aviso("app-aviso", "Erro ao gerar o PDF: " + (e.message || e), "erro"); }
}

/* ---------- ligação ---------- */
function ligarCompras(){
  if(!$("sec-compras")) return;
  document.querySelector('nav button[data-secao="compras"]')?.addEventListener("click", () => carregarCompras(false));
  document.querySelectorAll("#cmp-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _cmpView = b.dataset.view; renderCompras(); }));
  document.querySelectorAll("#cmp-painel .ind[data-kpi]").forEach(el => el.addEventListener("click", () => {
    const k = el.dataset.kpi;
    _cmpKpi = (_cmpKpi === k) ? "" : k; if(!["kanban","lista"].includes(_cmpView)) _cmpView = "kanban"; renderCompras();
  }));
  ["cmp-f-status","cmp-f-forn","cmp-f-obra","cmp-f-equip","cmp-f-mes"].forEach(id => $(id)?.addEventListener("change", renderCompras));
  $("cmp-busca")?.addEventListener("input", debounce(renderCompras));
  $("btn-cmp-atualizar")?.addEventListener("click", () => carregarCompras(true));
  $("btn-cmp-novo")?.addEventListener("click", () => novoPedido());
  $("btn-cmp-receber-avulso")?.addEventListener("click", () => { _cmpItens = []; abrirRecebimento(null); });
  $("cmp-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a.link-obra") || e.target.closest("button") || e.target.closest("input,label")) return;
    const el = e.target.closest("[data-id]"); if(el){ abrirPedido(el.dataset.id); return; }
    const tr = e.target.closest("tr[data-pedido]"); if(tr && tr.dataset.pedido){ const p = _cmpPedidos.find(x => x.numero === tr.dataset.pedido); if(p) abrirPedido(p.id); }
  });

  // ficha
  $("btn-cmp-voltar")?.addEventListener("click", mostrarPainelCompras);
  $("btn-cmp-salvar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-salvar", async () => { const id = await salvarPedido(false); if(id){ await cmpFetchPedidos(); await abrirPedido(id); } }));
  document.querySelectorAll("#cmp-ficha .cmp-acao").forEach(b => b.addEventListener("click", () => comBotaoTravado(b.id, () => cmpAcao(b.dataset.acao))));
  document.querySelectorAll("#cmp-notebook button").forEach(b => b.addEventListener("click", () => ativarTabPedido(b.dataset.tab)));
  document.querySelectorAll("#cmp-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => ativarTabPedido(b.dataset.gotoTab)));
  ["cmp-forn","cmp-local","cmp-obra","cmp-equip","cmp-prev"].forEach(id => $(id)?.addEventListener("change", cmpAtualizarChips));
  ["cmp-frete","cmp-desc"].forEach(id => $(id)?.addEventListener("input", cmpAtualizarChips));
  $("cmp-forn")?.addEventListener("change", () => { const f = _cmpFornMap[$("cmp-forn").value]; if(f?.condicao_pagamento_padrao && !$("cmp-cond").value) $("cmp-cond").value = f.condicao_pagamento_padrao;
    if(f?.prazo_entrega_dias && !$("cmp-prev").value){ const d = new Date(); d.setDate(d.getDate() + Number(f.prazo_entrega_dias)); $("cmp-prev").value = d.toISOString().slice(0, 10); cmpAtualizarChips(); } });
  cmpLigarBusca("cmp-busca-prod", "cmp-res-prod", p => cmpAddItem(p));
  $("btn-cmp-item-livre")?.addEventListener("click", () => cmpAddItem(null));

  // recebimento
  $("btn-cmp-rec-fechar")?.addEventListener("click", fecharRecebimento);
  $("btn-cmp-rec-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-rec-confirmar", confirmarRecebimento));
  $("cmp-rec-frete")?.addEventListener("input", cmpRecSoma);
  $("btn-cmp-rec-xml")?.addEventListener("click", () => $("cmp-rec-xml").click());
  $("cmp-rec-xml")?.addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if(f) cmpImportarXml(f); });
  const zona = $("cmp-rec-xml-zona");
  if(zona){
    ["dragenter","dragover"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("arrastando"); }));
    ["dragleave","drop"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("arrastando"); }));
    zona.addEventListener("drop", e => { const f = e.dataTransfer?.files && e.dataTransfer.files[0]; if(f) cmpImportarXml(f); });
  }
  cmpLigarBusca("cmp-rec-busca", "cmp-rec-res", p => cmpRecAddItem(p));
  $("btn-cmp-rec-livre")?.addEventListener("click", () => cmpRecAddItem(null));

  // custo avulso
  $("btn-cmp-av-fechar")?.addEventListener("click", fecharCustoAvulso);
  $("btn-cmp-av-salvar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-av-salvar", salvarCustoAvulso));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarCompras);
else ligarCompras();

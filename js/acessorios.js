/* ====================================================================
   ACESSÓRIOS (fase 47/48 · 15/09/2026)
   Peças com identidade (marcação) de hélice, raiz, secante e trado.
   - Painel "Onde está" (kanban por localização, agrupado por modelo),
     Lista e Contagem (vw_acessorios_contagem = CONTAGEM GERAL da planilha).
   - Seleção em massa → Enviar para obra / Retornar ao pátio / Mover /
     Abrir reparo / Condição / Registrar perda (RPCs da fase 48; cada
     peça ganha o seu evento em acessorio_eventos pelo trigger).
   - Ficha Odoo: statusbar = condição, chips, smart-buttons, abas
     Dados técnicos · Jogo · Histórico · Reparos · Observações (+ chatter).
   Escrita: admin, diretor, gestor_acessorios, mecanico, logistica,
   engenheiro (RLS acessorios_write). Família escolhida fica lembrada
   por usuário (localStorage): Walison abre em raiz, Lucas em hélice.
   ==================================================================== */
let _aceView = "kanban";
let _aceFamilia = null;            // '' = todas
let _aceKpi = "";                  // filtro rápido dos indicadores
let _aceRegistros = [];            // acessórios (cache)
let _aceModelos = [];
let _aceEquips = [];               // equipamentos de produção (sem caminhão/veículo)
let _aceEq = {};                   // id -> equipamento
let _aceForns = [];
let _aceSel = new Set();           // ids selecionados
let _aceCarregado = false;
let _aceContagem = null;           // linhas da view (cache)
let _aceAcaoIds = [];              // alvo da ação em curso (modais)
let _aceAtual = null;              // registro aberto na ficha
let acessorioEditId = null;        // null = novo
let _aceMdDepois = null;           // callback após salvar modelo
let _aceMdEditId = null;

const ACE_FAMILIA_LBL = { helice: "Hélice", raiz: "Raiz", secante: "Secante", trado: "Trado", comum: "Comum" };
const ACE_TIPO_LBL = {
  segmento: "Segmento", ponta: "Ponta", prolonga: "Prolonga", guia: "Guia", curva: "Curva", caixa_redutora: "Caixa redutora",
  trava: "Trava", transferidor: "Transferidor", trado_mecanizado: "Trado mecanizado", tubo: "Tubo", twister: "Twister", cacamba: "Caçamba",
  haste: "Haste", camisa: "Camisa / revestimento", coroa: "Coroa", tricone: "Tricone", flange: "Flange", martelo: "Martelo / bit", bit: "Bit",
  rosca: "Rosca", bomba_argamassa: "Bomba de argamassa", bomba_agua: "Bomba d'água", misturador: "Misturador", mangote: "Mangote",
  painel_eletrico: "Painel elétrico", caixa_dagua: "Caixa d'água", amortecedor: "Amortecedor", pescador: "Pescador", ferramenta: "Ferramenta", outro: "Outro"
};
const ACE_TIPOS_FAMILIA = {
  helice:  ["segmento","ponta","prolonga","guia","curva","caixa_redutora","trava","transferidor","tubo","twister","cacamba","ferramenta","outro"],
  secante: ["segmento","ponta","prolonga","guia","curva","caixa_redutora","trava","tubo","ferramenta","outro"],
  trado:   ["trado_mecanizado","segmento","ponta","prolonga","caixa_redutora","ferramenta","outro"],
  raiz:    ["haste","camisa","coroa","tricone","flange","martelo","bit","rosca","bomba_argamassa","bomba_agua","misturador","mangote","painel_eletrico","caixa_dagua","amortecedor","pescador","ferramenta","outro"],
  comum:   Object.keys(ACE_TIPO_LBL)
};
const ACE_ACOPL_LBL = { czm: "CZM", hg: "HG", soilmec: "Soilmec", cgl: "CGL", ek: "EK", api: "API", outro: "Outro" };
const ACE_EVENTO_LBL = { localizacao: "Localização", condicao: "Condição", reparo: "Reparo", perda: "Perda", observacao: "Conferência / nota", importacao: "Importação" };
const ACE_REPARO_TIPOS = { recuperacao_estrutural: "Recuperação estrutural", solda: "Solda", corte: "Corte", usinagem: "Usinagem", fabricacao_peca: "Fabricação de peça", pintura: "Pintura", outro: "Outro" };
const ACE_REPARO_STATUS = { aberto: "Aberto", em_execucao: "Em execução", concluido: "Concluído", cancelado: "Cancelado" };
const ACE_LOCAIS_MOVER = ["patio","oficina","equipamento","obra","em_transito","fornecedor","desconhecido"];

function acePodeEditar(){
  return ["admin","diretor","gestor_acessorios","mecanico","logistica","engenheiro"].includes(usuarioAtual?.cargo);
}
function aceLbl(grupo, v){ const o = (STATUS[grupo] || {})[v]; return o ? o.label : (v || "—"); }
function aceEqTag(id){ const e = _aceEq[id]; return e ? e.codigo : ""; }
function aceObra(id){ return (typeof mapaObras === "object" && mapaObras && mapaObras[id]) || ""; }
function aceForn(id){ return (typeof mapaFornecedores === "object" && mapaFornecedores && mapaFornecedores[id]) || ""; }
function aceMedida(a){
  if(a.modelo?.medida && a.modelo.medida !== "-") return a.modelo.medida;
  if(a.diametro_mm) return `Ø${a.diametro_mm}`;
  if(a.comprimento_m) return `${a.comprimento_m} m`;
  return "";
}
function aceDescr(a){
  if(a.modelo?.descricao) return a.modelo.descricao;
  const p = [ACE_TIPO_LBL[a.tipo] || a.tipo];
  if(a.diametro_mm) p.push(`Ø${a.diametro_mm}`);
  if(a.acoplamento) p.push(ACE_ACOPL_LBL[a.acoplamento] || a.acoplamento);
  if(a.pol_interna) p.push(`${a.pol_interna}"`);
  return p.join(" ");
}
/* chave de agrupamento (modelo) usada no kanban e na contagem local */
function aceModeloKey(a){ return a.modelo_id || `${a.tipo}|${a.diametro_mm || ""}|${a.acoplamento || ""}|${a.pol_interna || ""}`; }
function aceOnde(a){
  const d = a.local_descricao ? ` · ${a.local_descricao}` : "";
  switch(a.local_tipo){
    case "patio":       return "Pátio" + d;
    case "oficina":     return "Oficina" + d;
    case "fornecedor":  return (aceForn(a.local_fornecedor_id) || "Fornecedor") + d;
    case "equipamento": return (a.local_equipamento_id ? "TAG " + aceEqTag(a.local_equipamento_id) : "Equipamento") + d;
    case "obra":        return (aceObra(a.local_obra_id) || "Obra") + (a.local_equipamento_id ? " · TAG " + aceEqTag(a.local_equipamento_id) : "") + d;
    case "em_transito": return "Em trânsito" + (a.local_obra_id ? " → " + aceObra(a.local_obra_id) : "") + d;
    case "perdido":     return "Perdido" + (a.condicao_motivo ? " · " + a.condicao_motivo : "");
    default:            return "Não localizado" + d;
  }
}
/* coluna do kanban "onde está" */
function aceColKey(a){
  switch(a.local_tipo){
    case "fornecedor":  return "forn:" + (a.local_fornecedor_id || "");
    case "equipamento": return "eq:" + (a.local_equipamento_id || "");
    case "obra":        return "obra:" + (a.local_obra_id || "");
    default:            return a.local_tipo || "desconhecido";
  }
}
function aceColLabel(key){
  if(key.startsWith("eq:"))   return "TAG " + (aceEqTag(key.slice(3)) || "?") + (_aceEq[key.slice(3)]?.nome ? " · " + _aceEq[key.slice(3)].nome : "");
  if(key.startsWith("obra:")) return aceObra(key.slice(5)) || "Obra";
  if(key.startsWith("forn:")) return aceForn(key.slice(5)) || "Fornecedor";
  return aceLbl("acessorio_local", key);
}
function aceDataISOparaTS(d){ return d ? new Date(d + "T12:00:00").toISOString() : null; }
function aceQuando(iso){
  if(!iso) return "—";
  const d = new Date(iso); if(isNaN(d)) return "—";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function aceOrdMarc(a, b){ return String(a.marcacao).localeCompare(String(b.marcacao), "pt-BR", { numeric: true }); }
function aceChaveFamilia(){ return "ace_familia_" + (usuarioAtual?.id || "anon"); }

/* ---------- carga ---------- */
async function aceFetchTodos(){
  const cols = "id,marcacao,familia,modelo_id,jogo,seq_no_jogo,tipo,diametro_mm,diametro_real_mm,passo_mm,passo_ideal_mm,acoplamento,pol_interna,comprimento_m,tubo_mm,detalhe,peso_kg,numero_serie,condicao,condicao_motivo,local_tipo,local_equipamento_id,local_obra_id,local_fornecedor_id,local_descricao,local_confirmado_em,equipamento_padrao_id,produto_id,observacoes,ativo,updated_at,modelo:acessorio_modelos(descricao,medida,grupo_contagem,preco_referencia)";
  const tudo = []; const passo = 1000;
  for(let de = 0; ; de += passo){
    const { data, error } = await sb.from("acessorios").select(cols).order("marcacao").range(de, de + passo - 1);
    if(error) throw error;
    tudo.push(...(data || []));
    if(!data || data.length < passo) break;
  }
  return tudo;
}

async function carregarAcessorios(force){
  const cont = $("ace-conteudo");
  if(!cont) return;
  if(_aceFamilia === null){
    let salva = null;
    try { salva = localStorage.getItem(aceChaveFamilia()); } catch(e){}
    _aceFamilia = salva != null ? salva : "";
  }
  if(force || !_aceCarregado){
    cont.innerHTML = `<p class="vazio">Carregando acessórios…</p>`;
    try {
      const [regs, mod, eq, fo] = await Promise.all([
        aceFetchTodos(),
        sb.from("acessorio_modelos").select("id,familia,tipo,descricao,medida,grupo_contagem,preco_referencia,produto_id,ativo").order("descricao"),
        sb.from("equipamentos").select("id,codigo,nome,tipo,ativo,status,localizacao_tipo,localizacao_obra_id").not("tipo", "in", "(caminhao,veiculo)").order("codigo"),
        sb.from("fornecedores").select("id,razao_social").eq("ativo", true).order("razao_social")
      ]);
      if(mod.error) throw mod.error;
      _aceRegistros = regs;
      _aceModelos = mod.data || [];
      _aceEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
      _aceEq = {}; _aceEquips.forEach(e => _aceEq[e.id] = e);
      _aceForns = fo.data || [];
      _aceContagem = null;
      _aceCarregado = true;
      _aceSel = new Set([..._aceSel].filter(id => _aceRegistros.some(a => a.id === id)));
      acePreencherSelectsFixos();
    } catch(e){
      cont.innerHTML = `<p class="vazio">Erro ao carregar acessórios: ${esc(e.message || e)}</p>`;
      return;
    }
  }
  const pode = acePodeEditar();
  const bn = $("btn-ace-nova");    if(bn) bn.style.display = pode ? "" : "none";
  const bm = $("btn-ace-modelo");  if(bm) bm.style.display = pode ? "" : "none";
  acePreencherFiltros();
  renderAcessorios();
}

/* Catálogo para outros módulos (Movimentações, Mobilizações): devolve as peças em cache ou carrega.
   Também garante _aceEq (nomes de TAG usados por aceOnde). */
let _aceCatalogoEm = 0;
async function aceCatalogo(force){
  const fresco = _aceRegistros.length && (_aceCarregado || (Date.now() - _aceCatalogoEm) < 120000);
  if(!force && fresco) return _aceRegistros;
  const [regs, eq] = await Promise.all([
    aceFetchTodos(),
    _aceEquips.length ? Promise.resolve({ data: null }) : sb.from("equipamentos").select("id,codigo,nome,tipo,ativo,status,localizacao_tipo,localizacao_obra_id").not("tipo", "in", "(caminhao,veiculo)").order("codigo")
  ]);
  _aceRegistros = regs;
  if(eq.data){ _aceEquips = eq.data; _aceEq = {}; _aceEquips.forEach(e => _aceEq[e.id] = e); }
  _aceCatalogoEm = Date.now();
  _aceContagem = null;
  return _aceRegistros;
}
/* outro módulo mudou peças de lugar (remessa recebida, mobilização): próxima visita recarrega */
function aceInvalidar(){ _aceCarregado = false; _aceCatalogoEm = 0; }

/* recarrega só algumas peças (depois de uma ação) e re-renderiza */
async function aceRefetch(ids){
  if(!ids || !ids.length) return;
  const cols = "id,marcacao,familia,modelo_id,jogo,seq_no_jogo,tipo,diametro_mm,diametro_real_mm,passo_mm,passo_ideal_mm,acoplamento,pol_interna,comprimento_m,tubo_mm,detalhe,peso_kg,numero_serie,condicao,condicao_motivo,local_tipo,local_equipamento_id,local_obra_id,local_fornecedor_id,local_descricao,local_confirmado_em,equipamento_padrao_id,produto_id,observacoes,ativo,updated_at,modelo:acessorio_modelos(descricao,medida,grupo_contagem,preco_referencia)";
  const { data, error } = await sb.from("acessorios").select(cols).in("id", ids);
  if(error){ aviso("app-aviso", "Erro ao atualizar a lista: " + error.message, "erro"); return; }
  (data || []).forEach(n => {
    const i = _aceRegistros.findIndex(a => a.id === n.id);
    if(i >= 0) _aceRegistros[i] = n; else _aceRegistros.push(n);
  });
  ids.forEach(id => { if(!(data || []).some(n => n.id === id)) _aceRegistros = _aceRegistros.filter(a => a.id !== id); });
  _aceContagem = null;
  renderAcessorios();
  if(_aceAtual && ids.includes(_aceAtual.id)){
    const n = _aceRegistros.find(a => a.id === _aceAtual.id);
    if(n) abrirFichaAcessorio(n); else mostrarPainelAcessorios();
  }
}

function acePreencherSelectsFixos(){
  const optEq = `<option value="">— nenhum —</option>` + _aceEquips.map(e => `<option value="${e.id}">${esc(e.codigo)}${e.nome ? " · " + esc(e.nome) : ""}</option>`).join("");
  ["ace-padrao","ace-mv-equip"].forEach(id => { const el = $(id); if(el) el.innerHTML = optEq; });
  const comp = $("ace-compat"); if(comp) comp.innerHTML = _aceEquips.map(e => `<option value="${e.id}">${esc(e.codigo)}${e.nome ? " · " + esc(e.nome) : ""}</option>`).join("");
  const obras = Object.entries(typeof mapaObras === "object" && mapaObras ? mapaObras : {}).sort((a, b) => String(b[1]).localeCompare(String(a[1]), "pt-BR"));
  const optObra = `<option value="">— selecione —</option>` + obras.map(([id, rot]) => `<option value="${id}">${esc(rot)}</option>`).join("");
  const mo = $("ace-mv-obra"); if(mo) mo.innerHTML = optObra;
  const optForn = `<option value="">— selecione —</option>` + _aceForns.map(f => `<option value="${f.id}">${esc(f.razao_social)}</option>`).join("");
  ["ace-mv-forn","ace-rp-forn"].forEach(id => { const el = $(id); if(el) el.innerHTML = optForn; });
  const fam = Object.entries(ACE_FAMILIA_LBL).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  ["ace-familia","ace-md-familia"].forEach(id => { const el = $(id); if(el) el.innerHTML = fam; });
  const ac = $("ace-acopl"); if(ac) ac.innerHTML = `<option value="">—</option>` + Object.entries(ACE_ACOPL_LBL).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  const mv = $("ace-mv-tipo"); if(mv) mv.innerHTML = ACE_LOCAIS_MOVER.map(v => `<option value="${v}">${esc(aceLbl("acessorio_local", v))}</option>`).join("");
  const cd = $("ace-cd-cond"); if(cd) cd.innerHTML = opcoesStatus("acessorio");
  const rt = $("ace-rp-tipo"); if(rt) rt.innerHTML = Object.entries(ACE_REPARO_TIPOS).map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  const fc = $("ace-f-condicao"); if(fc) fc.innerHTML = `<option value="">Condição</option>` + opcoesStatus("acessorio");
  const fl = $("ace-f-local"); if(fl) fl.innerHTML = `<option value="">Onde está</option>` + opcoesStatus("acessorio_local");
  const grupos = [...new Set(_aceModelos.map(m => m.grupo_contagem).filter(Boolean))].sort();
  const dl = $("ace-md-grupos"); if(dl) dl.innerHTML = grupos.map(g => `<option value="${esc(g)}"></option>`).join("");
}

function aceDaFamilia(){ return _aceFamilia ? _aceRegistros.filter(a => a.familia === _aceFamilia) : _aceRegistros; }

/* selects de filtro dependem da família (mantêm o valor se ainda existir) */
function acePreencherFiltros(){
  const base = aceDaFamilia();
  const setOpts = (id, placeholder, pares) => {
    const el = $(id); if(!el) return;
    const atual = el.value;
    el.innerHTML = `<option value="">${esc(placeholder)}</option>` + pares.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    if(pares.some(p => String(p[0]) === atual)) el.value = atual;
  };
  const tipos = [...new Set(base.map(a => a.tipo))].sort((a, b) => (ACE_TIPO_LBL[a] || a).localeCompare(ACE_TIPO_LBL[b] || b, "pt-BR"));
  setOpts("ace-f-tipo", "Todos os tipos", tipos.map(t => [t, ACE_TIPO_LBL[t] || t]));
  const medidas = [...new Set(base.map(aceMedida).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  setOpts("ace-f-medida", "Ø / medida", medidas.map(m => [m, m]));
  const acopls = [...new Set(base.map(a => a.acoplamento).filter(Boolean))];
  setOpts("ace-f-acopl", "Acoplamento", acopls.map(a => [a, ACE_ACOPL_LBL[a] || a]));
  const fa = $("ace-f-acopl"); if(fa) fa.style.display = acopls.length ? "" : "none";
  const eqIds = [...new Set(base.flatMap(a => [a.local_equipamento_id, a.equipamento_padrao_id]).filter(Boolean))];
  setOpts("ace-f-equip", "Equipamento (está / pertence)", eqIds.map(id => [id, "TAG " + aceEqTag(id)]).sort((a, b) => a[1].localeCompare(b[1], "pt-BR", { numeric: true })));
  const obraIds = [...new Set(base.map(a => a.local_obra_id).filter(Boolean))];
  setOpts("ace-f-obra", "Obra", obraIds.map(id => [id, aceObra(id) || id]).sort((a, b) => a[1].localeCompare(b[1], "pt-BR")));
  const jogos = [...new Set(base.map(a => a.jogo).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  setOpts("ace-f-jogo", "Jogo", jogos.map(j => [j, j]));
  const fj = $("ace-f-jogo"); if(fj) fj.style.display = jogos.length ? "" : "none";
}

function aceFiltradas(){
  const termo = ($("ace-busca")?.value || "").trim().toLowerCase();
  const fT = $("ace-f-tipo")?.value || "", fM = $("ace-f-medida")?.value || "", fA = $("ace-f-acopl")?.value || "";
  const fC = $("ace-f-condicao")?.value || "", fL = $("ace-f-local")?.value || "", fE = $("ace-f-equip")?.value || "";
  const fO = $("ace-f-obra")?.value || "", fJ = $("ace-f-jogo")?.value || "";
  return aceDaFamilia().filter(a => {
    if(a.ativo === false && fC !== "baixado") return false;
    if(fT && a.tipo !== fT) return false;
    if(fM && aceMedida(a) !== fM) return false;
    if(fA && a.acoplamento !== fA) return false;
    if(fC && a.condicao !== fC) return false;
    if(fL && a.local_tipo !== fL) return false;
    if(fE && a.local_equipamento_id !== fE && a.equipamento_padrao_id !== fE) return false;
    if(fO && a.local_obra_id !== fO) return false;
    if(fJ && a.jogo !== fJ) return false;
    if(_aceKpi === "estoque"    && !(["patio","oficina","equipamento"].includes(a.local_tipo) && a.condicao !== "em_manutencao")) return false;
    if(_aceKpi === "obra"       && !["obra","em_transito"].includes(a.local_tipo)) return false;
    if(_aceKpi === "manutencao" && a.condicao !== "em_manutencao") return false;
    if(_aceKpi === "perdido"    && a.local_tipo !== "perdido") return false;
    if(_aceKpi === "atencao"    && !(["precisa_manutencao","sem_marcacao"].includes(a.condicao) || a.local_tipo === "desconhecido")) return false;
    if(termo){
      const txt = `${a.marcacao} ${a.jogo || ""} ${aceDescr(a)} ${a.numero_serie || ""} ${a.detalhe || ""} ${aceOnde(a)}`.toLowerCase();
      if(!txt.includes(termo)) return false;
    }
    return true;
  });
}

/* ---------- render ---------- */
function renderAcessorios(){
  document.querySelectorAll("#ace-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _aceView));
  document.querySelectorAll("#ace-familias .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.familia === (_aceFamilia || "")));
  document.querySelectorAll("#ace-painel .ind[data-kpi]").forEach(el => el.style.outline = (el.dataset.kpi === _aceKpi && _aceKpi) ? "2px solid var(--marca-600)" : "");
  aceRenderKpis();
  const filtros = $("ace-filtros"); if(filtros) filtros.style.display = _aceView === "contagem" ? "none" : "";
  aceRenderSelecao();
  if(_aceView === "contagem") return renderAcessoriosContagem();
  const dados = aceFiltradas().sort(aceOrdMarc);
  const c = $("ace-contador"); if(c) c.textContent = `${dados.length} de ${aceDaFamilia().filter(a => a.ativo !== false).length}`;
  if(_aceView === "lista") renderAcessoriosLista(dados); else renderAcessoriosKanban(dados);
}

function aceRenderKpis(){
  const base = aceDaFamilia().filter(a => a.ativo !== false);
  const set = (id, v) => { const el = $(id); if(el) el.textContent = num(v); };
  set("ace-kpi-total", base.length);
  set("ace-kpi-estoque", base.filter(a => ["patio","oficina","equipamento"].includes(a.local_tipo) && a.condicao !== "em_manutencao").length);
  set("ace-kpi-obra", base.filter(a => ["obra","em_transito"].includes(a.local_tipo)).length);
  set("ace-kpi-manut", base.filter(a => a.condicao === "em_manutencao").length);
  set("ace-kpi-atencao", base.filter(a => ["precisa_manutencao","sem_marcacao"].includes(a.condicao) || a.local_tipo === "desconhecido").length);
  set("ace-kpi-perdido", base.filter(a => a.local_tipo === "perdido").length);
}

function aceCondCor(c){ return (STATUS.acessorio[c] || {}).cor || "cinza"; }

function renderAcessoriosKanban(dados){
  const cont = $("ace-conteudo");
  const cols = new Map();
  dados.forEach(a => { const k = aceColKey(a); if(!cols.has(k)) cols.set(k, []); cols.get(k).push(a); });
  const peso = k => k === "patio" ? 0 : k === "oficina" ? 1 : k === "em_transito" ? 2 : k.startsWith("eq:") ? 3 : k.startsWith("obra:") ? 4 : k.startsWith("forn:") ? 5 : k === "desconhecido" ? 6 : 7;
  const chaves = [...cols.keys()].sort((a, b) => (peso(a) - peso(b)) || aceColLabel(a).localeCompare(aceColLabel(b), "pt-BR", { numeric: true }));
  if(!chaves.length){ cont.innerHTML = `<p class="vazio">Nenhuma peça com esses filtros.</p>`; return; }
  const html = chaves.map(k => {
    const itens = cols.get(k);
    const grupos = new Map();
    itens.forEach(a => { const g = aceModeloKey(a); if(!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(a); });
    const cards = [...grupos.values()].sort((x, y) => aceDescr(x[0]).localeCompare(aceDescr(y[0]), "pt-BR", { numeric: true })).map(g => {
      const ids = g.map(a => a.id);
      const todosSel = ids.every(id => _aceSel.has(id));
      const pills = g.sort(aceOrdMarc).map(a => `<span class="tag ${aceCondCor(a.condicao)} ace-pill" data-id="${a.id}" title="${esc(aceDescr(a))} · ${esc(aceLbl("acessorio", a.condicao))}${a.jogo ? " · jogo " + esc(a.jogo) : ""}\nClique: abrir · Ctrl+clique: selecionar" style="cursor:pointer;margin:2px 3px 2px 0;${_aceSel.has(a.id) ? "outline:2px solid var(--marca-600);outline-offset:1px;" : ""}">${esc(a.marcacao)}</span>`).join("");
      const med = aceMedida(g[0]);
      return `<div class="serv-kan-card" data-ids="${ids.join(",")}" draggable="true" style="cursor:grab;">
        <div class="serv-kan-card-nome" style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" class="ace-sel-grupo" ${todosSel ? "checked" : ""} title="Selecionar estas ${ids.length} peça(s)" style="margin:0;" />
          <span style="flex:1;">${esc(aceDescr(g[0]))}${med && !aceDescr(g[0]).includes(med) ? ` <span class="meta">${esc(med)}</span>` : ""}</span>
          <strong>${ids.length}</strong>
        </div>
        <div style="margin-top:6px;line-height:1.9;">${pills}</div>
      </div>`;
    }).join("");
    return `<div class="serv-kan-col" data-col="${esc(k)}"><div class="serv-kan-col-head">${esc(aceColLabel(k))}<span>${itens.length}</span></div>${cards}</div>`;
  }).join("");
  cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">Colunas = onde a peça está; cards = modelo. Clique na marcação para abrir a ficha, Ctrl+clique para selecionar; arraste um card para outra coluna para mover o grupo.</p><div class="serv-kanban">${html}</div>`;
  aceLigarDrag(cont);
}

function renderAcessoriosLista(dados){
  const cont = $("ace-conteudo");
  const todosSel = dados.length && dados.every(a => _aceSel.has(a.id));
  const temAcopl = dados.some(a => a.acoplamento), temJogo = dados.some(a => a.jogo);
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th style="width:28px;"><input type="checkbox" id="ace-sel-todos" ${todosSel ? "checked" : ""} title="Selecionar todas as ${dados.length} filtradas" /></th>
      <th>Marcação</th><th>Modelo</th><th>Tipo</th><th>Ø / medida</th>${temAcopl ? "<th>Acopl.</th>" : ""}${temJogo ? "<th>Jogo</th>" : ""}
      <th>Condição</th><th>Onde está</th><th>Pertence</th><th>Atualizado</th>
    </tr></thead>
    <tbody>${dados.map(a => `<tr class="linha-clicavel" data-id="${a.id}" ${a.ativo === false ? 'style="opacity:.55"' : ""}>
        <td><input type="checkbox" class="ace-sel" data-id="${a.id}" ${_aceSel.has(a.id) ? "checked" : ""} /></td>
        <td><strong>${esc(a.marcacao)}</strong></td><td>${esc(aceDescr(a))}</td><td>${esc(ACE_TIPO_LBL[a.tipo] || a.tipo)}</td><td>${esc(aceMedida(a) || "—")}</td>
        ${temAcopl ? `<td>${esc(ACE_ACOPL_LBL[a.acoplamento] || a.acoplamento || "—")}</td>` : ""}${temJogo ? `<td>${esc(a.jogo || "—")}${a.seq_no_jogo ? ` <span class="meta">#${a.seq_no_jogo}</span>` : ""}</td>` : ""}
        <td>${tagStatus("acessorio", a.condicao)}${a.condicao_motivo && a.local_tipo !== "perdido" ? ` <span class="meta" title="${esc(a.condicao_motivo)}">ⓘ</span>` : ""}</td>
        <td>${tagStatus("acessorio_local", a.local_tipo)} ${esc(aceOnde(a).replace(/^(Pátio|Oficina|Em trânsito|Perdido|Não localizado)/, "").replace(/^ · /, ""))}</td>
        <td>${a.equipamento_padrao_id ? "TAG " + esc(aceEqTag(a.equipamento_padrao_id)) : "—"}</td>
        <td class="meta">${dataBR(a.local_confirmado_em || a.updated_at)}</td>
      </tr>`).join("") || `<tr><td colspan="11" class="vazio">Nenhuma peça com esses filtros.</td></tr>`}</tbody>
  </table></div>`;
}

/* ---------- Contagem (CONTAGEM GERAL) ---------- */
async function renderAcessoriosContagem(){
  const cont = $("ace-conteudo");
  if(!_aceContagem){
    cont.innerHTML = `<p class="vazio">Calculando contagem…</p>`;
    const { data, error } = await sb.from("vw_acessorios_contagem").select("*");
    if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
    _aceContagem = data || [];
  }
  const linhas = _aceContagem.filter(l => (!_aceFamilia || l.familia === _aceFamilia) && Number(l.cadastrados) > 0)
    .sort((a, b) => (a.grupo_contagem || "ZZZ").localeCompare(b.grupo_contagem || "ZZZ", "pt-BR") || a.descricao.localeCompare(b.descricao, "pt-BR", { numeric: true }) || String(a.medida || "").localeCompare(String(b.medida || ""), "pt-BR", { numeric: true }));
  const c = $("ace-contador"); if(c) c.textContent = `${linhas.length} modelos`;
  const cols = ["cadastrados","em_estoque","em_obra","em_manutencao","perdas","sem_marcacao"];
  const soma = arr => cols.reduce((o, k) => (o[k] = arr.reduce((s, l) => s + Number(l[k] || 0), 0), o), { valor_total: arr.reduce((s, l) => s + Number(l.valor_total || 0), 0) });
  const grupos = new Map();
  linhas.forEach(l => { const g = l.grupo_contagem || "SEM GRUPO"; if(!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(l); });
  const linha = (l) => `<tr class="linha-clicavel" data-modelo="${l.modelo_id}">
      <td>${esc(l.descricao)}</td><td>${esc(l.medida && l.medida !== "-" ? l.medida : "")}</td>
      <td class="num"><strong>${l.cadastrados}</strong></td><td class="num">${l.em_estoque}</td><td class="num">${l.em_obra}</td><td class="num">${l.em_manutencao}</td><td class="num">${l.perdas}</td><td class="num">${l.sem_marcacao}</td>
      <td class="num">${l.preco_referencia != null ? brl(l.preco_referencia) : '<span class="meta">—</span>'}</td><td class="num">${l.preco_referencia != null ? brl(l.valor_total) : '<span class="meta">—</span>'}</td></tr>`;
  const sub = (g, arr) => { const t = soma(arr); return `<tr style="background:var(--bg-body);font-weight:600;"><td colspan="2">Subtotal ${esc(g)}</td>${cols.map(k => `<td class="num">${t[k]}</td>`).join("")}<td></td><td class="num">${brl(t.valor_total)}</td></tr>`; };
  const tot = soma(linhas);
  const semPreco = linhas.filter(l => l.preco_referencia == null).length;
  cont.innerHTML = `
    <div class="meta" style="margin:0 0 8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      Contagem por modelo${_aceFamilia ? " · " + esc(ACE_FAMILIA_LBL[_aceFamilia]) : ""}. Em estoque = pátio, oficina ou na máquina (fora de manutenção). Clique na linha para editar descrição, grupo e preço.
      ${semPreco ? `<span class="tag ambar">${semPreco} modelo(s) sem preço de referência</span>` : ""}
      <button type="button" class="btn-sec btn-sm" id="btn-ace-xlsx" style="margin-left:auto;">⬇️ Excel</button>
    </div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Modelo</th><th>Medida</th><th class="num">Cadastradas</th><th class="num">Em estoque</th><th class="num">Em obra</th><th class="num">Em manut.</th><th class="num">Perdas</th><th class="num">S/M</th><th class="num">Preço unit.</th><th class="num">Total</th></tr></thead>
      <tbody>${[...grupos.entries()].map(([g, arr]) => `<tr><td colspan="10" style="background:var(--bg-body);"><strong>${esc(g)}</strong></td></tr>` + arr.map(linha).join("") + (arr.length > 1 ? sub(g, arr) : "")).join("") || `<tr><td colspan="10" class="vazio">Nenhum modelo com peças.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2"><strong>Total geral</strong></td>${cols.map(k => `<td class="num"><strong>${tot[k]}</strong></td>`).join("")}<td></td><td class="num"><strong>${brl(tot.valor_total)}</strong></td></tr></tfoot>
    </table></div>`;
  $("btn-ace-xlsx")?.addEventListener("click", () => aceExportarContagem(linhas, grupos, tot));
}

function aceExportarContagem(linhas, grupos, tot){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
  const cab = ["GRUPO","MODELO","MEDIDA","CADASTRADAS","EM ESTOQUE","EM OBRA","EM MANUTENÇÃO","PERDAS","SEM MARCAÇÃO","PREÇO UNITÁRIO","TOTAL"];
  const aoa = [cab];
  grupos.forEach((arr, g) => arr.forEach(l => aoa.push([g, l.descricao, l.medida || "", +l.cadastrados, +l.em_estoque, +l.em_obra, +l.em_manutencao, +l.perdas, +l.sem_marcacao, l.preco_referencia != null ? +l.preco_referencia : null, l.preco_referencia != null ? +l.valor_total : null])));
  aoa.push(["TOTAL GERAL","","",tot.cadastrados,tot.em_estoque,tot.em_obra,tot.em_manutencao,tot.perdas,tot.sem_marcacao,null,tot.valor_total]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 28 },{ wch: 46 },{ wch: 8 },{ wch: 12 },{ wch: 11 },{ wch: 9 },{ wch: 14 },{ wch: 8 },{ wch: 13 },{ wch: 15 },{ wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CONTAGEM GERAL");
  XLSX.writeFile(wb, `contagem-acessorios-${_aceFamilia || "todas"}-${hojeISO()}.xlsx`);
}

/* ---------- seleção em massa ---------- */
function aceRenderSelecao(){
  const box = $("ace-selecao"); if(!box) return;
  const n = _aceSel.size;
  box.style.display = (n && acePodeEditar() && _aceView !== "contagem") ? "flex" : "none";
  const t = $("ace-selecao-n"); if(t) t.textContent = `${n} peça${n === 1 ? "" : "s"} selecionada${n === 1 ? "" : "s"}`;
}
function aceToggleSel(id, on){ if(on) _aceSel.add(id); else _aceSel.delete(id); }
function aceIdsSel(){ return [..._aceSel]; }
function aceResumoIds(ids){
  const regs = ids.map(id => _aceRegistros.find(a => a.id === id)).filter(Boolean).sort(aceOrdMarc);
  const marc = regs.slice(0, 12).map(a => a.marcacao).join(", ") + (regs.length > 12 ? ` … (+${regs.length - 12})` : "");
  return `${regs.length} peça${regs.length === 1 ? "" : "s"}: ${marc}`;
}

function aceLigarDrag(cont){
  cont.querySelectorAll(".serv-kan-card[data-ids]").forEach(card => {
    card.addEventListener("dragstart", e => { card.classList.add("kan-dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", card.dataset.ids); });
    card.addEventListener("dragend", () => { card.classList.remove("kan-dragging"); cont.querySelectorAll(".serv-kan-col").forEach(c => c.classList.remove("kan-drop-target")); });
  });
  cont.querySelectorAll(".serv-kan-col[data-col]").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; col.classList.add("kan-drop-target"); });
    col.addEventListener("dragleave", () => col.classList.remove("kan-drop-target"));
    col.addEventListener("drop", e => {
      e.preventDefault(); col.classList.remove("kan-drop-target");
      const ids = (e.dataTransfer.getData("text/plain") || "").split(",").filter(Boolean);
      if(!ids.length || !acePodeEditar()) return;
      const k = col.dataset.col;
      if(k === "perdido"){ abrirPerdaAcessorios(ids); return; }
      const pre = {};
      if(k.startsWith("eq:")){ pre.tipo = "equipamento"; pre.equip = k.slice(3); }
      else if(k.startsWith("obra:")){ pre.tipo = "obra"; pre.obra = k.slice(5); }
      else if(k.startsWith("forn:")){ pre.tipo = "fornecedor"; pre.forn = k.slice(5); }
      else pre.tipo = k;
      abrirMoverAcessorios(ids, pre);
    });
  });
}

/* ---------- modais de ação ---------- */
function aceMvAtualizarCampos(){
  const t = $("ace-mv-tipo").value;
  $("ace-mv-c-obra").style.display  = ["obra","em_transito"].includes(t) ? "" : "none";
  $("ace-mv-c-equip").style.display = ["obra","equipamento","em_transito"].includes(t) ? "" : "none";
  $("ace-mv-c-forn").style.display  = t === "fornecedor" ? "" : "none";
}
function abrirMoverAcessorios(ids, pre){
  if(!acePodeEditar()){ aviso("app-aviso", "Seu perfil não movimenta acessórios.", "erro"); return; }
  if(!ids.length) return;
  _aceAcaoIds = ids; pre = pre || {};
  $("ace-mv-titulo").textContent = pre.tipo === "obra" ? "Enviar para obra" : pre.tipo === "patio" ? "Retornar ao pátio" : "Mover peças";
  $("ace-mv-resumo").textContent = aceResumoIds(ids);
  $("ace-mv-tipo").value = pre.tipo || "patio";
  $("ace-mv-data").value = hojeISO();
  $("ace-mv-obra").value = pre.obra || "";
  $("ace-mv-equip").value = pre.equip || "";
  $("ace-mv-forn").value = pre.forn || "";
  $("ace-mv-desc").value = ""; $("ace-mv-obs").value = "";
  // sugestão: peça única já em obra/equipamento mantém a referência
  if(ids.length === 1 && !pre.obra && !pre.equip){
    const a = _aceRegistros.find(x => x.id === ids[0]);
    if(a && ["obra","em_transito"].includes(pre.tipo) && a.local_obra_id) $("ace-mv-obra").value = a.local_obra_id;
  }
  // equipamento mobilizado na obra escolhida: pré-seleciona se só houver um
  aceMvAtualizarCampos();
  $("ace-mover-modal").style.display = "flex";
}
function fecharMoverAcessorios(){ $("ace-mover-modal").style.display = "none"; }
async function salvarMoverAcessorios(){
  const t = $("ace-mv-tipo").value;
  const p = {
    p_ids: _aceAcaoIds, p_local_tipo: t,
    p_equipamento_id: $("ace-mv-equip").value || null, p_obra_id: $("ace-mv-obra").value || null, p_fornecedor_id: $("ace-mv-forn").value || null,
    p_descricao: $("ace-mv-desc").value.trim() || null, p_obs: $("ace-mv-obs").value.trim() || null, p_data: aceDataISOparaTS($("ace-mv-data").value)
  };
  if(t === "obra" && !p.p_obra_id){ aviso("app-aviso", "Informe a obra.", "erro"); return; }
  if(t === "equipamento" && !p.p_equipamento_id){ aviso("app-aviso", "Informe o equipamento.", "erro"); return; }
  if(t === "fornecedor" && !p.p_fornecedor_id){ aviso("app-aviso", "Informe o fornecedor.", "erro"); return; }
  const { data, error } = await sb.rpc("acessorios_mover", p);
  if(error){ aviso("app-aviso", "Não foi possível mover: " + error.message, "erro"); return; }
  aviso("app-aviso", `${data} peça(s) movida(s) para ${aceLbl("acessorio_local", t).toLowerCase()}.`, "ok");
  fecharMoverAcessorios();
  const ids = _aceAcaoIds.slice(); _aceAcaoIds = [];
  ids.forEach(id => _aceSel.delete(id));
  await aceRefetch(ids);
}

function abrirPerdaAcessorios(ids){
  if(!acePodeEditar() || !ids.length) return;
  _aceAcaoIds = ids;
  $("ace-pd-resumo").textContent = aceResumoIds(ids);
  $("ace-pd-motivo").value = ""; $("ace-pd-obs").value = ""; $("ace-pd-data").value = hojeISO();
  $("ace-perda-modal").style.display = "flex";
}
function fecharPerdaAcessorios(){ $("ace-perda-modal").style.display = "none"; }
async function salvarPerdaAcessorios(){
  const motivo = $("ace-pd-motivo").value.trim();
  if(!motivo){ aviso("app-aviso", "Informe o motivo da perda.", "erro"); return; }
  if(!confirm(`Registrar perda de ${_aceAcaoIds.length} peça(s)? Elas saem do estoque e ficam no histórico como perdidas.`)) return;
  const { data, error } = await sb.rpc("acessorios_perda", { p_ids: _aceAcaoIds, p_motivo: motivo, p_obs: $("ace-pd-obs").value.trim() || null, p_data: aceDataISOparaTS($("ace-pd-data").value) });
  if(error){ aviso("app-aviso", "Erro ao registrar perda: " + error.message, "erro"); return; }
  aviso("app-aviso", `${data} peça(s) registrada(s) como perdida(s).`, "ok");
  fecharPerdaAcessorios();
  const ids = _aceAcaoIds.slice(); _aceAcaoIds = [];
  ids.forEach(id => _aceSel.delete(id));
  await aceRefetch(ids);
}

function abrirCondicaoAcessorios(ids, cond){
  if(!acePodeEditar() || !ids.length) return;
  _aceAcaoIds = ids;
  $("ace-cd-resumo").textContent = aceResumoIds(ids);
  $("ace-cd-cond").value = cond || "bom_estado";
  $("ace-cd-motivo").value = ""; $("ace-cd-data").value = hojeISO();
  $("ace-cond-modal").style.display = "flex";
}
function fecharCondicaoAcessorios(){ $("ace-cond-modal").style.display = "none"; }
async function salvarCondicaoAcessorios(){
  const cond = $("ace-cd-cond").value;
  if(cond === "baixado" && !confirm(`Baixar ${_aceAcaoIds.length} peça(s)? Elas saem do cadastro ativo (continuam no histórico).`)) return;
  const { data, error } = await sb.rpc("acessorios_condicao", { p_ids: _aceAcaoIds, p_condicao: cond, p_motivo: $("ace-cd-motivo").value.trim() || null, p_data: aceDataISOparaTS($("ace-cd-data").value) });
  if(error){ aviso("app-aviso", "Erro ao mudar a condição: " + error.message, "erro"); return; }
  aviso("app-aviso", `${data} peça(s) agora em "${aceLbl("acessorio", cond)}".`, "ok");
  fecharCondicaoAcessorios();
  const ids = _aceAcaoIds.slice(); _aceAcaoIds = [];
  await aceRefetch(ids);
}

function abrirReparoAcessorios(ids){
  if(!acePodeEditar() || !ids.length) return;
  _aceAcaoIds = ids;
  $("ace-rp-resumo").textContent = aceResumoIds(ids);
  $("ace-rp-desc").value = ""; $("ace-rp-tipo").value = "recuperacao_estrutural"; $("ace-rp-data").value = hojeISO();
  $("ace-rp-local").value = "oficina"; $("ace-rp-forn").value = ""; $("ace-rp-c-forn").style.display = "none";
  $("ace-rp-custo").value = ""; $("ace-rp-obs").value = "";
  $("ace-reparo-modal").style.display = "flex";
}
function fecharReparoAcessorios(){ $("ace-reparo-modal").style.display = "none"; }
async function salvarReparoAcessorios(){
  const desc = $("ace-rp-desc").value.trim();
  if(!desc){ aviso("app-aviso", "Descreva o que precisa ser feito.", "erro"); return; }
  const local = $("ace-rp-local").value, fornId = $("ace-rp-forn").value || null;
  if(local === "fornecedor" && !fornId){ aviso("app-aviso", "Informe o fornecedor.", "erro"); return; }
  const obsLocal = local === "fornecedor" ? `Fornecedor: ${aceForn(fornId) || fornId}` : "Oficina CGL";
  const custo = $("ace-rp-custo").value === "" ? null : Number($("ace-rp-custo").value);
  const linhas = _aceAcaoIds.map(id => {
    const a = _aceRegistros.find(x => x.id === id) || {};
    return { acessorio_id: id, equipamento_id: a.local_equipamento_id || a.equipamento_padrao_id || null,
      descricao: `${aceDescr(a)} ${a.marcacao || ""} — ${desc}`.trim(), tipo_servico: $("ace-rp-tipo").value, status: "aberto",
      data_abertura: $("ace-rp-data").value || hojeISO(), custo_estimado: custo,
      observacoes: [obsLocal, $("ace-rp-obs").value.trim()].filter(Boolean).join(" · ") };
  });
  const { data, error } = await sb.from("reparos_caldeiraria").insert(linhas).select("id");
  if(error){ aviso("app-aviso", "Erro ao abrir reparo: " + error.message, "erro"); return; }
  // peça vai para a oficina (trigger). Se é no fornecedor, move para lá.
  if(local === "fornecedor"){
    await sb.rpc("acessorios_mover", { p_ids: _aceAcaoIds, p_local_tipo: "fornecedor", p_fornecedor_id: fornId, p_obs: "Enviada para reparo: " + desc, p_data: aceDataISOparaTS($("ace-rp-data").value) });
  }
  aviso("app-aviso", `${(data || []).length} reparo(s) aberto(s).`, "ok");
  fecharReparoAcessorios();
  const ids = _aceAcaoIds.slice(); _aceAcaoIds = [];
  ids.forEach(id => _aceSel.delete(id));
  await aceRefetch(ids);
}

async function aceMudarStatusReparo(repId, novo){
  const upd = { status: novo };
  if(novo === "concluido") upd.data_conclusao = hojeISO();
  if(novo === "em_execucao") upd.data_inicio = hojeISO();
  const { error } = await sb.from("reparos_caldeiraria").update(upd).eq("id", repId);
  if(error){ aviso("app-aviso", "Erro no reparo: " + error.message, "erro"); return; }
  aviso("app-aviso", `Reparo ${ACE_REPARO_STATUS[novo].toLowerCase()}.`, "ok");
  if(_aceAtual) await aceRefetch([_aceAtual.id]);
}

/* ---------- modelo ---------- */
function abrirModeloAcessorio(modeloId, pre, depois){
  if(!acePodeEditar()) return;
  _aceMdEditId = modeloId || null; _aceMdDepois = depois || null;
  const m = modeloId ? _aceModelos.find(x => x.id === modeloId) : null;
  $("ace-md-titulo").textContent = m ? `Modelo: ${m.descricao}` : "Novo modelo";
  $("ace-md-familia").value = m?.familia || pre?.familia || _aceFamilia || "raiz";
  aceMdPreencherTipos();
  $("ace-md-tipo").value = m?.tipo || pre?.tipo || $("ace-md-tipo").options[0]?.value || "outro";
  $("ace-md-desc").value = m?.descricao || pre?.descricao || "";
  $("ace-md-medida").value = m?.medida || pre?.medida || "";
  $("ace-md-grupo").value = m?.grupo_contagem || "";
  $("ace-md-preco").value = m?.preco_referencia ?? "";
  $("ace-md-ativo").checked = m ? m.ativo !== false : true;
  $("ace-modelo-modal").style.display = "flex";
}
function aceMdPreencherTipos(){
  const fam = $("ace-md-familia").value;
  const atual = $("ace-md-tipo").value;
  $("ace-md-tipo").innerHTML = (ACE_TIPOS_FAMILIA[fam] || Object.keys(ACE_TIPO_LBL)).map(t => `<option value="${t}">${esc(ACE_TIPO_LBL[t])}</option>`).join("");
  if([...$("ace-md-tipo").options].some(o => o.value === atual)) $("ace-md-tipo").value = atual;
}
function fecharModeloAcessorio(){ $("ace-modelo-modal").style.display = "none"; }
async function salvarModeloAcessorio(){
  const reg = {
    familia: $("ace-md-familia").value, tipo: $("ace-md-tipo").value, descricao: $("ace-md-desc").value.trim(),
    medida: $("ace-md-medida").value.trim() || null, grupo_contagem: $("ace-md-grupo").value.trim().toUpperCase() || null,
    preco_referencia: $("ace-md-preco").value === "" ? null : Number($("ace-md-preco").value), ativo: $("ace-md-ativo").checked
  };
  if(!reg.descricao){ aviso("app-aviso", "Informe a descrição do modelo.", "erro"); return; }
  const r = _aceMdEditId
    ? await sb.from("acessorio_modelos").update(reg).eq("id", _aceMdEditId).select().single()
    : await sb.from("acessorio_modelos").insert(reg).select().single();
  if(r.error){ aviso("app-aviso", "Erro ao salvar modelo: " + r.error.message, "erro"); return; }
  const i = _aceModelos.findIndex(m => m.id === r.data.id);
  if(i >= 0) _aceModelos[i] = r.data; else _aceModelos.push(r.data);
  _aceModelos.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR", { numeric: true }));
  // peças já ligadas a esse modelo mostram a descrição nova
  _aceRegistros.forEach(a => { if(a.modelo_id === r.data.id) a.modelo = { descricao: r.data.descricao, medida: r.data.medida, grupo_contagem: r.data.grupo_contagem, preco_referencia: r.data.preco_referencia }; });
  _aceContagem = null;
  aviso("app-aviso", "Modelo salvo.", "ok");
  fecharModeloAcessorio();
  acePreencherSelectsFixos();
  if(_aceMdDepois){ const f = _aceMdDepois; _aceMdDepois = null; f(r.data); }
  else renderAcessorios();
}

/* ---------- ficha ---------- */
function mostrarPainelAcessorios(){
  $("ace-ficha").style.display = "none";
  $("ace-painel").style.display = "";
  _aceAtual = null; acessorioEditId = null;
  if(typeof ocultarHistorico === "function") ocultarHistorico("ace-chatter");
  renderAcessorios();
}
function aceTiposDaFamilia(fam){ return ACE_TIPOS_FAMILIA[fam] || Object.keys(ACE_TIPO_LBL); }
function acePreencherTipoForm(valor){
  const fam = $("ace-familia").value;
  const sel = $("ace-tipo");
  const tipos = aceTiposDaFamilia(fam).slice();
  if(valor && !tipos.includes(valor)) tipos.push(valor);
  sel.innerHTML = tipos.map(t => `<option value="${t}">${esc(ACE_TIPO_LBL[t] || t)}</option>`).join("");
  if(valor) sel.value = valor;
}
function acePreencherModeloForm(valor){
  const fam = $("ace-familia").value, tipo = $("ace-tipo").value;
  const lista = _aceModelos.filter(m => m.familia === fam && (m.tipo === tipo || m.id === valor) && (m.ativo !== false || m.id === valor));
  $("ace-modelo").innerHTML = `<option value="">— sem modelo —</option>` + lista.map(m => `<option value="${m.id}">${esc(m.descricao)}${m.medida && m.medida !== "-" ? " · " + esc(m.medida) : ""}</option>`).join("");
  $("ace-modelo").value = valor || "";
}

function novoAcessorio(){
  if(!acePodeEditar()){ aviso("app-aviso", "Seu perfil não cadastra acessórios.", "erro"); return; }
  abrirFichaAcessorio({ id: null, marcacao: "", familia: _aceFamilia || "raiz", tipo: null, condicao: "bom_estado", local_tipo: "patio", ativo: true });
}
async function abrirAcessorio(id){
  const a = _aceRegistros.find(x => x.id === id);
  if(!a){ aviso("app-aviso", "Peça não encontrada na lista. Atualize.", "erro"); return; }
  abrirFichaAcessorio(a);
}

function abrirFichaAcessorio(a){
  _aceAtual = a; acessorioEditId = a.id || null;
  const novo = !a.id;
  $("ace-painel").style.display = "none";
  $("ace-ficha").style.display = "";
  $("ace-ficha-titulo").textContent = novo ? "Nova peça" : `${aceDescr(a)} · ${a.marcacao}`;
  document.querySelectorAll("#ace-ficha .ace-so-existente").forEach(b => b.style.display = novo ? "none" : "");
  const pode = acePodeEditar();
  $("btn-ace-salvar").style.display = pode ? "" : "none";
  $("btn-ace-excluir").style.display = (!novo && ["admin","diretor"].includes(usuarioAtual?.cargo)) ? "" : "none";
  $("ace-ficha").querySelectorAll("input,select,textarea").forEach(el => { if(!el.closest(".modal-fundo")) el.disabled = !pode; });

  // form
  $("ace-marcacao").value = a.marcacao || "";
  $("ace-familia").value = a.familia || "raiz";
  acePreencherTipoForm(a.tipo || aceTiposDaFamilia($("ace-familia").value)[0]);
  acePreencherModeloForm(a.modelo_id || "");
  $("ace-jogo").value = a.jogo || ""; $("ace-seq").value = a.seq_no_jogo ?? "";
  $("ace-diam").value = a.diametro_mm ?? ""; $("ace-diam-real").value = a.diametro_real_mm ?? "";
  $("ace-passo").value = a.passo_mm ?? ""; $("ace-passo-ideal").value = a.passo_ideal_mm ?? "";
  $("ace-acopl").value = a.acoplamento || ""; $("ace-pol").value = a.pol_interna ?? "";
  $("ace-comp").value = a.comprimento_m ?? ""; $("ace-tubo").value = a.tubo_mm ?? "";
  $("ace-detalhe").value = a.detalhe || ""; $("ace-peso").value = a.peso_kg ?? ""; $("ace-serie").value = a.numero_serie || "";
  $("ace-padrao").value = a.equipamento_padrao_id || "";
  $("ace-ativo").checked = a.ativo !== false;
  $("ace-obs").value = a.observacoes || "";
  [...$("ace-compat").options].forEach(o => o.selected = false);
  $("ace-local-atual").innerHTML = novo
    ? "A peça nova entra no <strong>pátio</strong>. Depois de salvar, use <em>Mover</em> para colocá-la onde está."
    : `Onde está: <strong>${esc(aceOnde(a))}</strong> · ${tagStatus("acessorio_local", a.local_tipo)} · última confirmação ${aceQuando(a.local_confirmado_em)}${a.condicao_motivo ? ` · motivo: ${esc(a.condicao_motivo)}` : ""}`;

  // chips
  $("ace-chip-marc").textContent = a.marcacao || "—";
  $("ace-chip-modelo").textContent = a.id ? aceDescr(a) : "—";
  $("ace-chip-medida").textContent = aceMedida(a) || "—";
  $("ace-chip-onde").textContent = a.id ? aceOnde(a) : "Pátio";
  $("ace-chip-pertence").textContent = a.equipamento_padrao_id ? "TAG " + aceEqTag(a.equipamento_padrao_id) : "—";
  $("ace-chip-cond").innerHTML = tagStatus("acessorio", a.condicao);
  atualizarStatusbarAcessorio(a.condicao);

  // smart-buttons e abas filhas
  const setSb = (id, n) => { const b = $(id); if(!b) return; b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); };
  const irmaos = a.jogo ? _aceRegistros.filter(x => x.familia === a.familia && x.jogo === a.jogo && x.id !== a.id) : [];
  setSb("sb-ace-jogo", irmaos.length);
  aceRenderJogo(a, irmaos);
  setSb("sb-ace-hist", 0); setSb("sb-ace-rep", 0); setSb("sb-ace-compat", 0);
  $("ace-hist-lista").innerHTML = `<p class="vazio">${novo ? "A peça ainda não foi salva." : "Carregando…"}</p>`;
  $("ace-rep-lista").innerHTML = `<p class="vazio">${novo ? "A peça ainda não foi salva." : "Carregando…"}</p>`;
  if(!novo) aceCarregarFilhas(a);
  if(!novo && typeof montarHistorico === "function") montarHistorico("acessorios", a.id, "ace-chatter");
  else if(typeof ocultarHistorico === "function") ocultarHistorico("ace-chatter");
  ativarTabAcessorio("dados");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function aceCarregarFilhas(a){
  const [ev, rep, comp] = await Promise.all([
    sb.from("acessorio_eventos").select("id,tipo,data,de_local_tipo,de_ref_id,de_descricao,para_local_tipo,para_ref_id,para_descricao,de_condicao,para_condicao,observacao,autor_nome,movimentacao_id,reparo_id").eq("acessorio_id", a.id).order("data", { ascending: false }).limit(300),
    sb.from("reparos_caldeiraria").select("id,status,descricao,tipo_servico,data_abertura,data_inicio,data_conclusao,custo_estimado,custo_real,observacoes").eq("acessorio_id", a.id).order("data_abertura", { ascending: false }),
    sb.from("acessorio_equipamentos").select("equipamento_id").eq("acessorio_id", a.id)
  ]);
  if(_aceAtual?.id !== a.id) return;
  const setSb = (id, n) => { const b = $(id); if(!b) return; b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); };
  const compIds = (comp.data || []).map(c => c.equipamento_id);
  [...$("ace-compat").options].forEach(o => o.selected = compIds.includes(o.value));
  setSb("sb-ace-compat", compIds.length + (a.equipamento_padrao_id ? 1 : 0));
  setSb("sb-ace-hist", (ev.data || []).length);
  setSb("sb-ace-rep", (rep.data || []).length);
  aceRenderHistorico(ev.data || [], ev.error);
  aceRenderReparos(rep.data || [], rep.error);
}

function aceRefLabel(tipo, refId, desc){
  let base = aceLbl("acessorio_local", tipo);
  if(tipo === "equipamento" && refId) base = "TAG " + aceEqTag(refId);
  else if(tipo === "obra" && refId) base = aceObra(refId) || base;
  else if(tipo === "fornecedor" && refId) base = aceForn(refId) || base;
  else if(tipo === "em_transito" && refId) base += " → " + (aceObra(refId) || aceEqTag(refId) || "");
  return base + (desc ? ` · ${desc}` : "");
}
function aceRenderHistorico(evs, err){
  const c = $("ace-hist-lista");
  if(err){ c.innerHTML = `<p class="vazio">Erro: ${esc(err.message)}</p>`; return; }
  if(!evs.length){ c.innerHTML = `<p class="vazio">Sem eventos.</p>`; return; }
  const icone = { localizacao: "📍", condicao: "🔩", reparo: "🔧", perda: "⚠️", observacao: "📝", importacao: "📥" };
  c.innerHTML = `<div class="tl-lista">${evs.map(e => {
    let txt = "";
    if(e.tipo === "importacao") txt = `Cadastro importado · ${esc(aceRefLabel(e.para_local_tipo, e.para_ref_id, e.para_descricao))}${e.para_condicao ? " · " + esc(aceLbl("acessorio", e.para_condicao)) : ""}`;
    else if(["localizacao","perda","observacao"].includes(e.tipo)) txt = `${e.de_local_tipo ? esc(aceRefLabel(e.de_local_tipo, e.de_ref_id, e.de_descricao)) + " → " : ""}${esc(aceRefLabel(e.para_local_tipo, e.para_ref_id, e.para_descricao))}`;
    else txt = `${esc(aceLbl("acessorio", e.de_condicao))} → ${esc(aceLbl("acessorio", e.para_condicao))}`;
    return `<div class="tl-item"><div class="tl-icone">${icone[e.tipo] || "•"}</div><div class="tl-conteudo">
      <div class="tl-titulo">${esc(ACE_EVENTO_LBL[e.tipo] || e.tipo)} <span class="tl-data meta">${aceQuando(e.data)}</span></div>
      <div>${txt}</div>${e.observacao ? `<div class="meta">${esc(e.observacao)}</div>` : ""}
      <div class="tl-autor meta">${esc(e.autor_nome || "sistema")}</div></div></div>`;
  }).join("")}</div>`;
}
function aceRenderReparos(reps, err){
  const c = $("ace-rep-lista");
  if(err){ c.innerHTML = `<p class="vazio">Erro: ${esc(err.message)}</p>`; return; }
  const pode = acePodeEditar();
  c.innerHTML = `<div class="lista-topo"><h3>Reparos de caldeiraria</h3>${pode ? `<button type="button" class="btn-sec btn-sm" id="btn-ace-rep-novo" style="margin-left:auto;">🔧 Abrir reparo</button>` : ""}</div>` +
    (reps.length ? `<div class="tabela-rola"><table><thead><tr><th>Abertura</th><th>Status</th><th>Descrição</th><th>Início</th><th>Conclusão</th><th class="num">Custo</th><th>Obs.</th>${pode ? "<th></th>" : ""}</tr></thead>
    <tbody>${reps.map(r => `<tr><td>${dataBR(r.data_abertura)}</td><td><span class="tag ${r.status === "concluido" ? "verde" : r.status === "cancelado" ? "cinza" : "ambar"}">${esc(ACE_REPARO_STATUS[r.status] || r.status)}</span></td>
      <td>${esc(r.descricao || "")}</td><td>${dataBR(r.data_inicio)}</td><td>${dataBR(r.data_conclusao)}</td><td class="num">${r.custo_real != null ? brl(r.custo_real) : r.custo_estimado != null ? brl(r.custo_estimado) + " (est.)" : "—"}</td>
      <td class="meta">${esc((r.observacoes || "").replace(/^\[import raiz\]\s*/, ""))}</td>
      ${pode ? `<td style="white-space:nowrap;">${r.status === "aberto" ? `<button type="button" class="btn-sec btn-sm" data-rep="${r.id}" data-st="em_execucao">▶ Iniciar</button> ` : ""}${["aberto","em_execucao"].includes(r.status) ? `<button type="button" class="btn-sec btn-sm" data-rep="${r.id}" data-st="concluido">✅ Concluir</button> <button type="button" class="btn-sec btn-sm" data-rep="${r.id}" data-st="cancelado" style="color:var(--perigo);">✖</button>` : ""}</td>` : ""}</tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Nenhum reparo registrado para esta peça.</p>`);
  $("btn-ace-rep-novo")?.addEventListener("click", () => abrirReparoAcessorios([_aceAtual.id]));
  c.querySelectorAll("button[data-rep]").forEach(b => b.addEventListener("click", () => {
    const st = b.dataset.st;
    if(st === "cancelado" && !confirm("Cancelar este reparo?")) return;
    aceMudarStatusReparo(b.dataset.rep, st);
  }));
}
function aceRenderJogo(a, irmaos){
  const c = $("ace-jogo-lista");
  const btn = $("btn-ace-mover-jogo"); if(btn) btn.style.display = (a.jogo && acePodeEditar()) ? "" : "none";
  if(!a.jogo){ c.innerHTML = `<p class="vazio">Peça avulsa (sem jogo). Informe o jogo nos dados técnicos para agrupá-la.</p>`; return; }
  const todos = [a, ...irmaos].sort((x, y) => (x.seq_no_jogo || 0) - (y.seq_no_jogo || 0) || aceOrdMarc(x, y));
  const locais = new Set(todos.map(aceColKey));
  c.innerHTML = (locais.size > 1 ? `<p class="meta" style="color:var(--perigo);">⚠️ O jogo <strong>${esc(a.jogo)}</strong> está separado em ${locais.size} lugares.</p>` : `<p class="meta">Jogo <strong>${esc(a.jogo)}</strong> completo no mesmo lugar.</p>`) +
    `<div class="tabela-rola"><table><thead><tr><th>#</th><th>Marcação</th><th>Modelo</th><th>Condição</th><th>Onde está</th></tr></thead>
    <tbody>${todos.map(x => `<tr class="linha-clicavel" data-id="${x.id}" ${x.id === a.id ? 'style="background:var(--bg-body);"' : ""}><td>${x.seq_no_jogo ?? ""}</td><td><strong>${esc(x.marcacao)}</strong></td><td>${esc(aceDescr(x))}</td><td>${tagStatus("acessorio", x.condicao)}</td><td>${esc(aceOnde(x))}</td></tr>`).join("")}</tbody></table></div>`;
}

const ACE_STAGES = ["sem_avaliacao","sem_marcacao","bom_estado","precisa_manutencao","em_manutencao","baixado"];
function atualizarStatusbarAcessorio(st){
  document.querySelectorAll("#ace-statusbar .stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    if(el.dataset.status === st) el.classList.add(st === "baixado" ? "cancelada" : "atual");
  });
}
function ativarTabAcessorio(nome){
  document.querySelectorAll("#ace-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#ace-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}

async function salvarAcessorio(){
  if(!acePodeEditar()) return;
  const n = v => v === "" ? null : Number(v);
  const reg = {
    marcacao: $("ace-marcacao").value.trim().toUpperCase(), familia: $("ace-familia").value, tipo: $("ace-tipo").value,
    modelo_id: $("ace-modelo").value || null, jogo: $("ace-jogo").value.trim().toUpperCase() || null, seq_no_jogo: n($("ace-seq").value),
    diametro_mm: n($("ace-diam").value), diametro_real_mm: n($("ace-diam-real").value), passo_mm: n($("ace-passo").value), passo_ideal_mm: n($("ace-passo-ideal").value),
    acoplamento: $("ace-acopl").value || null, pol_interna: n($("ace-pol").value), comprimento_m: n($("ace-comp").value), tubo_mm: n($("ace-tubo").value),
    detalhe: $("ace-detalhe").value.trim() || null, peso_kg: n($("ace-peso").value), numero_serie: $("ace-serie").value.trim() || null,
    equipamento_padrao_id: $("ace-padrao").value || null, ativo: $("ace-ativo").checked, observacoes: $("ace-obs").value.trim() || null
  };
  if(!reg.marcacao){ aviso("app-aviso", "Informe a marcação da peça.", "erro"); $("ace-marcacao").focus(); return; }
  if(!reg.tipo){ aviso("app-aviso", "Informe o tipo.", "erro"); return; }
  const dup = _aceRegistros.find(a => a.familia === reg.familia && a.marcacao === reg.marcacao && a.id !== acessorioEditId);
  if(dup){ aviso("app-aviso", `Já existe a marcação ${reg.marcacao} em ${ACE_FAMILIA_LBL[reg.familia]}.`, "erro"); return; }
  let id = acessorioEditId;
  if(id){
    const { error } = await sb.from("acessorios").update(reg).eq("id", id);
    if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return; }
  } else {
    const { data, error } = await sb.from("acessorios").insert({ ...reg, condicao: "bom_estado", local_tipo: "patio", local_confirmado_em: new Date().toISOString() }).select("id").single();
    if(error){ aviso("app-aviso", "Erro ao cadastrar: " + error.message, "erro"); return; }
    id = data.id;
  }
  const compat = [...$("ace-compat").selectedOptions].map(o => o.value).filter(v => v && v !== reg.equipamento_padrao_id);
  await sb.from("acessorio_equipamentos").delete().eq("acessorio_id", id);
  if(compat.length){ const { error } = await sb.from("acessorio_equipamentos").insert(compat.map(e => ({ acessorio_id: id, equipamento_id: e }))); if(error) aviso("app-aviso", "Compatibilidades não salvas: " + error.message, "erro"); }
  aviso("app-aviso", "Peça salva.", "ok");
  acessorioEditId = id;
  _aceAtual = { id };
  await aceRefetch([id]);
  acePreencherFiltros();
}

async function excluirAcessorio(){
  if(!acessorioEditId || !["admin","diretor"].includes(usuarioAtual?.cargo)) return;
  if(!confirm("Excluir esta peça e todo o seu histórico? Se ela existiu de verdade, prefira baixar (condição = Baixado).")) return;
  const { error } = await sb.from("acessorios").delete().eq("id", acessorioEditId);
  if(error){ aviso("app-aviso", "Não foi possível excluir: " + error.message, "erro"); return; }
  const id = acessorioEditId;
  _aceRegistros = _aceRegistros.filter(a => a.id !== id); _aceSel.delete(id); _aceContagem = null;
  aviso("app-aviso", "Peça excluída.", "ok");
  mostrarPainelAcessorios();
}

/* ---------- ligação ---------- */
function ligarAcessorios(){
  if(!$("sec-acessorios")) return;
  document.querySelector('nav button[data-secao="acessorios"]')?.addEventListener("click", () => carregarAcessorios(false));
  document.querySelectorAll("#ace-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _aceView = b.dataset.view; renderAcessorios(); }));
  document.querySelectorAll("#ace-familias .serv-view-btn").forEach(b => b.addEventListener("click", () => {
    _aceFamilia = b.dataset.familia; _aceKpi = "";
    try { localStorage.setItem(aceChaveFamilia(), _aceFamilia); } catch(e){}
    acePreencherFiltros(); renderAcessorios();
  }));
  document.querySelectorAll("#ace-painel .ind[data-kpi]").forEach(el => el.addEventListener("click", () => { _aceKpi = (_aceKpi === el.dataset.kpi) ? "" : el.dataset.kpi; if(_aceView === "contagem") _aceView = "kanban"; renderAcessorios(); }));
  ["ace-f-tipo","ace-f-medida","ace-f-acopl","ace-f-condicao","ace-f-local","ace-f-equip","ace-f-obra","ace-f-jogo"].forEach(id => $(id)?.addEventListener("change", renderAcessorios));
  $("ace-busca")?.addEventListener("input", debounce(renderAcessorios));
  $("btn-ace-atualizar")?.addEventListener("click", () => carregarAcessorios(true));
  $("btn-ace-nova")?.addEventListener("click", novoAcessorio);
  $("btn-ace-modelo")?.addEventListener("click", () => abrirModeloAcessorio(null));

  // conteúdo: cliques em pills, linhas, checkboxes
  $("ace-conteudo")?.addEventListener("click", e => {
    const pill = e.target.closest(".ace-pill");
    if(pill){
      if(e.ctrlKey || e.metaKey){ aceToggleSel(pill.dataset.id, !_aceSel.has(pill.dataset.id)); renderAcessorios(); }
      else abrirAcessorio(pill.dataset.id);
      return;
    }
    const cbG = e.target.closest(".ace-sel-grupo");
    if(cbG){ const ids = cbG.closest(".serv-kan-card").dataset.ids.split(","); ids.forEach(id => aceToggleSel(id, cbG.checked)); renderAcessorios(); return; }
    const cb = e.target.closest(".ace-sel");
    if(cb){ aceToggleSel(cb.dataset.id, cb.checked); aceRenderSelecao(); return; }
    if(e.target.id === "ace-sel-todos"){ const on = e.target.checked; aceFiltradas().forEach(a => aceToggleSel(a.id, on)); renderAcessorios(); return; }
    const trM = e.target.closest("tr[data-modelo]");
    if(trM){ if(acePodeEditar()) abrirModeloAcessorio(trM.dataset.modelo); return; }
    const tr = e.target.closest("tr[data-id]");
    if(tr) abrirAcessorio(tr.dataset.id);
  });

  // barra de seleção
  $("ace-selecao")?.addEventListener("click", e => {
    const b = e.target.closest("button[data-acao]"); if(!b) return;
    const ids = aceIdsSel();
    switch(b.dataset.acao){
      case "obra":     abrirMoverAcessorios(ids, { tipo: "obra" }); break;
      case "patio":    abrirMoverAcessorios(ids, { tipo: "patio" }); break;
      case "mover":    abrirMoverAcessorios(ids, {}); break;
      case "reparo":   abrirReparoAcessorios(ids); break;
      case "condicao": abrirCondicaoAcessorios(ids); break;
      case "perda":    abrirPerdaAcessorios(ids); break;
      case "limpar":   _aceSel.clear(); renderAcessorios(); break;
    }
  });

  // ficha
  $("btn-ace-voltar")?.addEventListener("click", mostrarPainelAcessorios);
  $("btn-ace-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ace-salvar", salvarAcessorio));
  $("btn-ace-excluir")?.addEventListener("click", excluirAcessorio);
  $("btn-ace-mover")?.addEventListener("click", () => _aceAtual?.id && abrirMoverAcessorios([_aceAtual.id], {}));
  $("btn-ace-reparo")?.addEventListener("click", () => _aceAtual?.id && abrirReparoAcessorios([_aceAtual.id]));
  $("btn-ace-perda")?.addEventListener("click", () => _aceAtual?.id && abrirPerdaAcessorios([_aceAtual.id]));
  $("btn-ace-mover-jogo")?.addEventListener("click", () => {
    const a = _aceAtual; if(!a?.jogo) return;
    abrirMoverAcessorios(_aceRegistros.filter(x => x.familia === a.familia && x.jogo === a.jogo).map(x => x.id), {});
  });
  $("ace-familia")?.addEventListener("change", () => { acePreencherTipoForm(null); acePreencherModeloForm(""); });
  $("ace-tipo")?.addEventListener("change", () => acePreencherModeloForm(""));
  $("btn-ace-novo-modelo")?.addEventListener("click", () => abrirModeloAcessorio(null, { familia: $("ace-familia").value, tipo: $("ace-tipo").value }, (m) => { acePreencherModeloForm(m.id); }));
  document.querySelectorAll("#ace-notebook button").forEach(b => b.addEventListener("click", () => ativarTabAcessorio(b.dataset.tab)));
  document.querySelectorAll("#ace-ficha .sb-btn").forEach(b => b.addEventListener("click", () => ativarTabAcessorio(b.dataset.gotoTab)));
  document.querySelectorAll("#ace-statusbar .stage").forEach(el => el.addEventListener("click", () => {
    const novo = el.dataset.status;
    if(!acePodeEditar()) return;
    if(!acessorioEditId){ atualizarStatusbarAcessorio(novo); $("ace-chip-cond").innerHTML = tagStatus("acessorio", novo); if(_aceAtual) _aceAtual.condicao = novo; return; }
    if(novo === _aceAtual?.condicao) return;
    if(novo === "em_manutencao") abrirReparoAcessorios([acessorioEditId]);
    else abrirCondicaoAcessorios([acessorioEditId], novo);
  }));
  $("ace-jogo-lista")?.addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if(tr && tr.dataset.id !== _aceAtual?.id) abrirAcessorio(tr.dataset.id); });

  // modais
  $("btn-ace-mv-fechar")?.addEventListener("click", fecharMoverAcessorios);
  $("btn-ace-mv-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ace-mv-salvar", salvarMoverAcessorios));
  $("ace-mv-tipo")?.addEventListener("change", aceMvAtualizarCampos);
  $("ace-mv-obra")?.addEventListener("change", () => {
    // sugere a máquina mobilizada nessa obra, se houver só uma
    const obraId = $("ace-mv-obra").value; if(!obraId || $("ace-mv-equip").value) return;
    const eqs = _aceEquips.filter(e => e.localizacao_tipo === "obra" && e.localizacao_obra_id === obraId);
    if(eqs.length === 1) $("ace-mv-equip").value = eqs[0].id;
  });
  $("btn-ace-pd-fechar")?.addEventListener("click", fecharPerdaAcessorios);
  $("btn-ace-pd-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ace-pd-salvar", salvarPerdaAcessorios));
  $("btn-ace-cd-fechar")?.addEventListener("click", fecharCondicaoAcessorios);
  $("btn-ace-cd-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ace-cd-salvar", salvarCondicaoAcessorios));
  $("btn-ace-rp-fechar")?.addEventListener("click", fecharReparoAcessorios);
  $("btn-ace-rp-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ace-rp-salvar", salvarReparoAcessorios));
  $("ace-rp-local")?.addEventListener("change", () => { $("ace-rp-c-forn").style.display = $("ace-rp-local").value === "fornecedor" ? "" : "none"; });
  $("btn-ace-md-fechar")?.addEventListener("click", fecharModeloAcessorio);
  $("btn-ace-md-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ace-md-salvar", salvarModeloAcessorio));
  $("ace-md-familia")?.addEventListener("change", aceMdPreencherTipos);
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarAcessorios); else ligarAcessorios();

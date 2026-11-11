/* ====================================================================
   js/estacas_perfuracao.js — estaca raiz com a injeção lançada e nenhuma perfuração em diário (funções elp*, IDs est-lp-).
   Em estaca raiz a perfuração e a injeção são etapas separadas: caem em dias diferentes e, com mais de uma máquina na obra,
   uma perfura e outra injeta. A linha só de injeção já marca a estaca como executada, sem profundidade. Este arquivo mostra
   quem está assim, filtra, explica e leva ao diário certo para lançar a metragem. A pendência é da estaca, não da máquina:
   some quando a estaca ganha uma linha com metragem, de qualquer máquina, dia ou turno.
   Carregado depois do js/estacas.js, que chama os ganchos daqui (todos guardados por typeof):
     - renderEstacas              -> elpFaixa(): o resumo clicável e o aviso de quem chega pelo filtro "Sem profundidade";
     - carregarAcompanhamentoRaiz -> elpAoCarregar(): a faixa de novo, agora com os diários lidos;
     - estFiltroProfRegularizar   -> elpFiltro(e, f): os filtros "Só injeção: falta a perfuração" e "Perfurada sem injeção";
     - _raizLinha                 -> elpAjustarLinha(l, est, execs): EXECUÇÃO deixa de mostrar a data e a TAG da injeção, e
                                     INJEÇÃO passa a reconhecer a injeção pela etapa;
     - Acompanhamento raiz e Lista -> elpCelulaRaiz(l), elpCelulaLista(e) e elpBotaoLinha(id): a etiqueta e o botão;
     - abrirModalEstaca           -> elpFicha(est): o mesmo aviso, com o botão, na janela da estaca.
   Regra (a mesma da pendência do "Para regularizar"): estaca raiz executada, sem profundidade executada, com linha de
   injeção e nenhuma linha com metragem. Perfuração é a linha com metragem (no dia ou acumulada); refuro não conta.
   Este arquivo NÃO GRAVA NADA. Os diários lidos são os que a aba já lê para o Acompanhamento raiz (por obra, paginados);
   obra sem estaca raiz não ganha leitura nenhuma. "Lançar perfuração" pede data, máquina e período, procura o diário de
   estaca raiz daquela obra, data, máquina e período e abre a ficha do RDO (a que existe, ou uma nova) com a linha da estaca
   já ligada pelo estaca_id. Quem grava é o Salvar do diário, pelas validações de sempre; status e profundidade da estaca
   nascem no banco, do gatilho, quando o diário é salvo.
   As funções puras saem também por module.exports, para o teste em Node (scripts/testar-fase173a.mjs).
   ==================================================================== */
const ELP_FILTROS = ["injecao_sem_perfuracao", "perfuracao_sem_injecao"];
const ELP_TIPO_DIARIO = "estaca_raiz";
const ELP_TITULO_BOTAO = "Abre o diário da máquina e do turno que perfurou, com a linha desta estaca já ligada. Nada é gravado antes de salvar o diário.";

/* ---------- números, datas e textos ---------- */
function elpNum(v){
  if(v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
/* o dia como o diário grava (hora de parede, sem fuso): fatia o texto, nunca converte */
function elpDia(iso){
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || ""));
  return m ? m[1] : null;
}
function elpDiaMes(iso){ const d = elpDia(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ""; }
function elpDataBR(iso){ const d = elpDia(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ""; }
function elpSemAcento(s){ return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
function elpPl(n, um, varios){ return Number(n) === 1 ? um : varios; }
function elpMetros(v){ return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); }

/* ---------- as duas etapas de uma estaca raiz, pelas linhas de diário ---------- */
function elpEhRefuro(x){ return ((x && x.modalidade_execucao) || "furo_normal") === "refuro"; }
/* perfuração = linha com metragem (no dia ou acumulada) */
function elpTemMetragem(x){ return (elpNum(x.profundidade_executada) || 0) > 0 || (elpNum(x.perfuracao_ate_m) || 0) > 0; }
/* injeção = etapa reconhecida pelo banco, ou hora, volume ou cimento de injeção, ou a palavra na observação (a linha de
   metragem com a injeção no mesmo dia fica com a etapa "metragem" e só a observação diz que injetou) */
function elpTemInjecao(x){
  return x.etapa_final === "injecao" || !!x.concretagem_inicio || (elpNum(x.volume_concreto_m3) || 0) > 0 || (elpNum(x.volume_injetado_m3) || 0) > 0
    || !!String(x.consumo_cimento_raiz == null ? "" : x.consumo_cimento_raiz).trim() || /inje(cao|tad)/.test(elpSemAcento(x.observacoes));
}
function elpMaquinaDaLinha(x){ return x.equipamento_id || x.rdo_equipamento_id || (x.maquina_codigo ? "txt:" + x.maquina_codigo : null); }
function elpDiaPerfuracao(x){ return elpDia(x.perfuracao_fim || x.perfuracao_inicio) || elpDia(x.data); }
function elpDiaInjecao(x){ return elpDia(x.concretagem_inicio) || elpDia(x.data); }
/* Recebe as linhas de diário de UMA estaca e diz o que foi lançado. Refuro fica fora das duas etapas. */
function raizEtapas(execs){
  const linhas = (Array.isArray(execs) ? execs : []).filter(x => x && !elpEhRefuro(x));
  const perf = linhas.filter(elpTemMetragem), inj = linhas.filter(elpTemInjecao);
  const unicos = (l) => [...new Set(l.filter(v => v != null && v !== ""))];
  const ultima = (l, dia) => l.reduce((u, x) => (!u || String(dia(x) || "") >= String(dia(u) || "") ? x : u), null);
  const perfurou = perf.length > 0, injetou = inj.length > 0;
  return {
    linhas: linhas.length, perfurou, injetou,
    faltaPerfuracao: injetou && !perfurou,
    faltaInjecao: perfurou && !injetou,
    maquinasPerfuracao: unicos(perf.map(elpMaquinaDaLinha)), datasPerfuracao: unicos(perf.map(elpDiaPerfuracao)).sort(),
    maquinasInjecao: unicos(inj.map(elpMaquinaDaLinha)), datasInjecao: unicos(inj.map(elpDiaInjecao)).sort(),
    ultimaPerfuracao: ultima(perf, elpDiaPerfuracao), ultimaInjecao: ultima(inj, elpDiaInjecao)
  };
}
/* O que mostrar na estaca:
   "falta_perfuracao"       executada, sem profundidade executada, com injeção e nenhuma linha com metragem (a pendência);
   "sem_diario_perfuracao"  só injeção nos diários, mas o cadastro tem profundidade executada (carga antiga): não é pendência;
   "falta_injecao"          perfurada sem injeção lançada (só filtro, sem pendência);
   ""                       nada. Estaca de outro tipo e estaca Refurada ficam de fora. */
function elpSituacao(est, et){
  if(!est || !et || est.tipo !== "raiz") return "";
  if(et.faltaPerfuracao){
    if((elpNum(est.profundidade_executada_m) || 0) > 0) return "sem_diario_perfuracao";
    return est.status === "executada" ? "falta_perfuracao" : "";
  }
  if(et.faltaInjecao) return est.status === "refugada" ? "" : "falta_injecao";
  return "";
}
/* true ou false para os dois filtros deste arquivo; null para os outros valores do filtro (quem decide é o estacas.js) */
function elpFiltroPuro(est, filtro, et){
  if(!ELP_FILTROS.includes(filtro)) return null;
  const s = elpSituacao(est, et);
  return filtro === "injecao_sem_perfuracao" ? s === "falta_perfuracao" : s === "falta_injecao";
}
function elpContar(estacas, etapasDe){
  const c = { soInjecao: 0, semDiario: 0, semInjecao: 0 };
  (estacas || []).forEach(e => {
    const s = elpSituacao(e, etapasDe(e));
    if(s === "falta_perfuracao") c.soInjecao++;
    else if(s === "sem_diario_perfuracao") c.semDiario++;
    else if(s === "falta_injecao") c.semInjecao++;
  });
  return c;
}

/* ---------- o diário e a linha ---------- */
/* A linha que entra na ficha do RDO: ligada à estaca pelo estaca_id (o mesmo número pode existir em outro local da obra),
   com número e Ø, sem metragem. O id da linha é dado pelo Salvar do diário. */
function elpLinhaPerfuracao(est){
  return { estaca_id: est.id, estaca_numero: est.numero || "", diametro_mm: elpNum(est.diametro_mm), profundidade_projeto: null,
    profundidade_executada: null, perfuracao_de_m: null, perfuracao_ate_m: null, _solo: [], _just: [] };
}
/* a linha desta estaca num diário já aberto: só pelo estaca_id (pelo número poderia ser a estaca de outro local) */
function elpAcharLinha(execs, est){
  return (Array.isArray(execs) ? execs : []).findIndex(x => x && est && x.estaca_id === est.id);
}
/* o diário da chave única de rdo: obra, data, tipo, máquina e período (período vazio conta como diurno) */
function elpAcharDiario(rdos, pedido){
  return (Array.isArray(rdos) ? rdos : []).find(r => r && r.equipamento_id === pedido.maquina && (r.turno_campo || "diurno") === pedido.turno
    && (!r.data || elpDia(r.data) === pedido.data) && (!r.tipo_servico || r.tipo_servico === ELP_TIPO_DIARIO)) || null;
}
function elpValidarPedido(p, hoje){
  if(!p || !/^\d{4}-\d{2}-\d{2}$/.test(String(p.data || ""))) return "Informe a data da perfuração.";
  if(hoje && p.data > hoje) return "A data da perfuração não pode ser no futuro.";
  if(!p.maquina) return "Escolha a máquina que perfurou.";
  if(p.turno !== "diurno" && p.turno !== "noturno") return "Escolha o período: diurno ou noturno.";
  return null;
}

/* ---------- textos e HTML ---------- */
/* "Injeção lançada em 08/10 pela 102-RZ, diurno." O período só entra em obra de dois turnos. */
function elpApoioTexto(et, tagDe, doisTurnos){
  const u = et && et.ultimaInjecao;
  if(!u) return "";
  const dia = elpDiaMes(elpDiaInjecao(u)), tag = tagDe ? String(tagDe(u) || "") : "";
  const per = doisTurnos && u._periodo ? ", " + String(u._periodo).toLowerCase() : "";
  return `Injeção lançada${dia ? " em " + dia : ""}${tag ? " pela " + tag : ""}${per}.`;
}
function elpTituloFalta(et, tagDe){
  const u = et && et.ultimaInjecao;
  const dia = u ? elpDiaMes(elpDiaInjecao(u)) : "", tag = u && tagDe ? String(tagDe(u) || "") : "";
  return `A injeção foi lançada${dia ? " em " + dia : ""}${tag ? " pela " + tag : ""}. A perfuração não está em nenhum diário: pode ser de outra máquina ou do outro turno.`;
}
function elpEtiquetaHTML(situacao, est, et, tagDe){
  if(situacao === "falta_perfuracao")
    return `<span class="tag ambar est-lp-tag" title="${esc(elpTituloFalta(et, tagDe))}">falta a perfuração</span>`;
  if(situacao === "sem_diario_perfuracao")
    return `<span class="tag cinza est-lp-tag" title="${esc(`No cadastro a estaca tem ${elpMetros(est && est.profundidade_executada_m)} m de profundidade executada, mas nenhum diário traz a perfuração. ${elpApoioTexto(et, tagDe, false)}`.trim())}">sem diário de perfuração</span>`;
  return "";
}
function elpBotaoHTML(est, pode){
  if(!pode || !est) return "";
  return `<button type="button" class="btn-sec btn-sm est-lp-lancar" data-est-lp="${esc(est.id)}" title="${esc(ELP_TITULO_BOTAO)}">Lançar perfuração</button>`;
}
/* A faixa entre os filtros e a lista: resumo clicável (zero não aparece), aviso de quem chega por "Sem profundidade" e a
   explicação do filtro ligado. carregado = os diários da obra já foram lidos. */
function elpFaixaHTML(c, filtro, carregado){
  const novo = ELP_FILTROS.includes(filtro);
  if(!carregado) return novo ? uiVazio("Lendo os diários da obra…") : "";
  const n = Number(c && c.soInjecao) || 0, m = Number(c && c.semInjecao) || 0;
  const verTodas = `<button type="button" class="btn-sec btn-sm" data-est-lp-filtro="" title="Tirar o filtro e mostrar todas as estacas">Ver todas</button>`;
  if(filtro === "injecao_sem_perfuracao"){
    if(!n) return uiVazio("Nenhuma estaca só com injeção.") + /* html */ verTodas;
    return `<div class="dist-aviso atencao"><span><strong>${esc(n)}</strong> ${esc(elpPl(n, "estaca só com injeção", "estacas só com injeção"))}: falta a perfuração. A perfuração ${esc(elpPl(n, "dela", "delas"))} não está em nenhum diário: pode ser de outra máquina ou do outro turno. Lance a metragem no diário de quem perfurou.</span>${/* html */ verTodas}</div>`;
  }
  if(filtro === "perfuracao_sem_injecao"){
    if(!m) return uiVazio("Nenhuma estaca perfurada sem injeção lançada.") + /* html */ verTodas;
    return `<div class="dist-aviso neutro"><span><strong>${esc(m)}</strong> ${esc(elpPl(m, "perfurada sem injeção lançada", "perfuradas sem injeção lançada"))}: a injeção ${esc(elpPl(m, "desta estaca", "destas estacas"))} não aparece em nenhum diário.</span>${/* html */ verTodas}</div>`;
  }
  const chipSemInj = m ? `<button type="button" class="est-lp-chip" data-est-lp-filtro="perfuracao_sem_injecao" title="Mostrar só as estacas perfuradas que não têm injeção em nenhum diário"><strong>${esc(m)}</strong> ${esc(elpPl(m, "perfurada sem injeção lançada", "perfuradas sem injeção lançada"))}</button>` : "";
  if(filtro === "sem_profundidade"){
    const aviso = n ? `<div class="dist-aviso atencao"><span><strong>${esc(n)}</strong> ${esc(elpPl(n, "destas tem", "destas têm"))} a injeção lançada e nenhuma perfuração.</span><button type="button" class="btn-sec btn-sm" data-est-lp-filtro="injecao_sem_perfuracao" title="Mostrar só as estacas com a injeção lançada e nenhuma perfuração em diário">Ver só essas</button></div>` : "";
    return aviso + /* html */ chipSemInj;
  }
  const chipSoInj = n ? `<button type="button" class="est-lp-chip alerta" data-est-lp-filtro="injecao_sem_perfuracao" title="Mostrar só as estacas com a injeção lançada e nenhuma perfuração em diário"><strong>${esc(n)}</strong> só com injeção: falta a perfuração</button>` : "";
  return chipSoInj + /* html */ chipSemInj;
}
/* opções do campo "Máquina que perfurou": as máquinas da obra primeiro, depois as demais; nasce sem escolha */
function elpMaquinasHTML(equips, idsObra){
  const daObra = new Set(idsObra || []);
  const ord = (a, b) => String(a.codigo || a.nome || "").localeCompare(String(b.codigo || b.nome || ""), "pt-BR", { numeric: true });
  const opt = (q) => `<option value="${esc(q.id)}">${esc(q.codigo || q.nome || "")}${q.codigo && q.nome ? " — " + esc(q.nome) : ""}</option>`;
  const lista = (equips || []).filter(q => q && q.id);
  const l1 = lista.filter(q => daObra.has(q.id)).sort(ord), l2 = lista.filter(q => !daObra.has(q.id)).sort(ord);
  return '<option value="">— escolha a máquina —</option>'
    + (l1.length ? `<optgroup label="Máquinas da obra">${l1.map(opt).join("")}</optgroup>${l2.length ? `<optgroup label="Demais máquinas">${l2.map(opt).join("")}</optgroup>` : ""}` : l2.map(opt).join(""));
}
/* Gancho de _raizLinha (Acompanhamento raiz). A etiqueta sai das linhas LIGADAS à estaca (a mesma regra do filtro e da
   pendência); o que a linha mostra sai das linhas que ela já usa. Sem perfuração lançada, EXECUÇÃO não mostra a data, a TAG
   nem o período da injeção; INJEÇÃO ganha data, TAG e turno também quando a injeção foi reconhecida só pela etapa. */
function elpAjustarLinha(l, est, execs, tagDe){
  if(!l || !est || est.tipo !== "raiz") return l;
  const lista = Array.isArray(execs) ? execs : [];
  const tag = tagDe || elpTagDe;
  const daLinha = raizEtapas(lista), ligadas = raizEtapas(lista.filter(x => x && x.estaca_id === est.id));
  l.lpSituacao = elpSituacao(est, ligadas);
  l.lpEtiqueta = elpEtiquetaHTML(l.lpSituacao, est, ligadas, tag);
  if(daLinha.faltaPerfuracao){ l.dataExec = null; l.tagExec = ""; l.periodo = ""; }
  if(daLinha.injetou && !l.dataInj){
    const u = daLinha.ultimaInjecao;
    l.dataInj = elpDiaInjecao(u);
    if(!l.tagInj) l.tagInj = tag(u) || "";
    if(!l.turnoInj) l.turnoInj = u._periodo || "";
  }
  return l;
}

/* ====================================================================
   Daqui para baixo: tela (lê o DOM e o que a aba Estacas já carregou). Nada disto roda sozinho no teste em Node.
   ==================================================================== */
let _elp = { fonte: null, cache: new Map(), carregando: null, falhou: null, estaca: null, obra: null, origem: null, seq: 0 };

function elpEstacasDaAba(){ return typeof _estacas !== "undefined" && Array.isArray(_estacas) ? _estacas : []; }
function elpObra(){ return typeof obraEditId !== "undefined" ? obraEditId : null; }
function elpVista(){ return typeof _estView !== "undefined" ? _estView : "lista"; }
/* os diários da obra, lidos pelo Acompanhamento raiz (carregarAcompanhamentoRaiz, por obra e paginado) */
function elpDados(){ return typeof _raizDados !== "undefined" && _raizDados && _raizDados.porEstaca ? _raizDados : null; }
function elpTagDe(x){
  if(typeof _raizTag === "function") return _raizTag(x);
  return (x && x.maquina_codigo) || "";
}
/* quem lança diário (a mesma função da ficha do RDO); o usuário de revisão nunca */
function elpPodeLancar(){ return typeof rdoPodeOperarFront === "function" && rdoPodeOperarFront(); }
function elpEtapasDe(est){
  const d = elpDados();
  if(!d || !est || est.tipo !== "raiz") return null;
  if(_elp.fonte !== d){ _elp.fonte = d; _elp.cache = new Map(); }
  let et = _elp.cache.get(est.id);
  if(!et){ et = raizEtapas(d.porEstaca.get(est.id) || []); _elp.cache.set(est.id, et); }
  return et;
}
function elpSituacaoDe(est){ return elpSituacao(est, elpEtapasDe(est)); }
/* as estacas raiz que passam pelos outros filtros da vista (status, local, busca e, na Lista, tipo): a base do resumo */
function elpEstacasDaVista(){
  const fStatus = $("est-f-status")?.value || "", fLocal = $("est-f-local")?.value || "";
  const fTipo = elpVista() === "lista" ? ($("est-f-tipo")?.value || "") : "";
  const termo = ($("est-busca")?.value || "").trim().toLowerCase();
  return elpEstacasDaAba().filter(e => e.tipo === "raiz" && (!fStatus || e.status === fStatus) && (!fTipo || e.tipo === fTipo)
    && (typeof estCasaLocal !== "function" || estCasaLocal(e, fLocal))
    && (!termo || `${e.numero || ""} ${e.observacoes || ""} ${e.local || ""} ${e.bloco || ""}`.toLowerCase().includes(termo)));
}
/* Fora do Acompanhamento raiz (que já lê os diários), só vale ler quando há o que mostrar: um dos dois filtros ligado ou
   alguma estaca raiz executada sem profundidade. Obra sem estaca raiz nunca lê. */
function elpPrecisaLer(filtro){
  const raiz = elpEstacasDaAba().filter(e => e.tipo === "raiz");
  if(!raiz.length) return false;
  return ELP_FILTROS.includes(filtro) || raiz.some(e => e.status === "executada" && !((elpNum(e.profundidade_executada_m) || 0) > 0));
}
async function elpCarregar(){
  const obra = elpObra();
  if(!obra || typeof carregarAcompanhamentoRaiz !== "function" || _elp.carregando === obra) return;
  if(_elp.falhou && _elp.falhou.obra === obra && Date.now() - _elp.falhou.em < 15000) return;   // a leitura falhou há pouco: não insiste a cada desenho
  _elp.carregando = obra;
  let r = null;
  try { r = await carregarAcompanhamentoRaiz(); } finally { _elp.carregando = null; }
  if(obra !== elpObra()) return;
  if(!r){ _elp.falhou = { obra, em: Date.now() }; return; }
  _elp.falhou = null;
  if(typeof renderEstacas === "function") renderEstacas();   // a lista de novo, agora com a etiqueta e os filtros
}

/* gancho de renderEstacas */
function elpFaixa(){
  const el = $("est-lp-faixa");
  if(!el) return;
  const filtro = $("est-f-prof")?.value || "";
  if(!elpEstacasDaAba().some(e => e.tipo === "raiz")){ if(el.innerHTML !== "") el.innerHTML = ""; return; }
  if(!elpDados()){
    el.innerHTML = elpFaixaHTML(null, filtro, false);
    if(elpVista() !== "raiz" && elpPrecisaLer(filtro)) elpCarregar();   // no Acompanhamento raiz a própria vista lê
    return;
  }
  el.innerHTML = elpFaixaHTML(elpContar(elpEstacasDaVista(), elpEtapasDe), filtro, true);
}
/* gancho de carregarAcompanhamentoRaiz: os diários acabaram de chegar */
function elpAoCarregar(){ elpFaixa(); }
/* gancho de estFiltroProfRegularizar */
function elpFiltro(est, filtro){
  if(!ELP_FILTROS.includes(filtro)) return null;
  return elpFiltroPuro(est, filtro, elpEtapasDe(est)) === true;
}
/* ganchos das linhas */
function elpCelulaRaiz(l){ return (l && l.lpEtiqueta) || ""; }
function elpCelulaLista(est){
  const s = elpSituacaoDe(est);
  return s === "falta_perfuracao" ? elpEtiquetaHTML(s, est, elpEtapasDe(est), elpTagDe) : "";
}
function elpBotaoLinha(id){
  const est = elpEstacasDaAba().find(e => e.id === id);
  return est && elpSituacaoDe(est) === "falta_perfuracao" ? elpBotaoHTML(est, elpPodeLancar()) : "";
}
/* gancho de abrirModalEstaca: o aviso e o botão na janela da estaca */
function elpFicha(est){
  const el = $("est-lp-ficha");
  if(!el) return;
  if(!est || elpSituacaoDe(est) !== "falta_perfuracao"){ el.innerHTML = ""; return; }
  const d = elpDados();
  el.innerHTML = `<div class="dist-aviso atencao"><span><strong>Falta lançar a perfuração.</strong> ${esc(elpApoioTexto(elpEtapasDe(est), elpTagDe, !!(d && d.doisTurnos)))} A perfuração não está em nenhum diário: pode ser de outra máquina ou do outro turno.</span>${/* html */ elpBotaoHTML(est, elpPodeLancar())}</div>`;
}
function elpDefinirFiltro(valor){
  if(typeof estDefinirFiltroProf === "function") estDefinirFiltroProf(valor || "");
  if(typeof renderEstacas === "function") renderEstacas();
}

/* ---------- janela "Lançar perfuração" (não grava) ---------- */
function elpAviso(msg, tipo){
  const el = $("est-lp-aviso");
  if(!el) return;
  el.textContent = msg || "";
  el.className = "aviso" + (msg ? " " + (tipo || "erro") : "");
}
function elpEquipamentos(){
  const rdo = typeof _rdoEquipsCache !== "undefined" && Array.isArray(_rdoEquipsCache) ? _rdoEquipsCache : [];
  if(rdo.length) return rdo;   // as mesmas máquinas do cabeçalho do diário
  return typeof _equipamentosCache !== "undefined" && Array.isArray(_equipamentosCache) ? _equipamentosCache : [];
}
/* máquinas que já têm linha de estaca nos diários desta obra */
function elpMaquinasDosDiarios(){
  const d = elpDados(), ids = new Set();
  if(d) d.porEstaca.forEach(l => l.forEach(x => { const id = x.equipamento_id || x.rdo_equipamento_id; if(id) ids.add(id); }));
  return [...ids];
}
function elpPreencherMaquinas(idsObra){
  const sel = $("est-lp-maquina");
  if(!sel) return;
  const atual = sel.value;
  sel.innerHTML = elpMaquinasHTML(elpEquipamentos(), idsObra);
  sel.value = atual;
}
function elpJanelaAberta(){ const m = $("est-lp-modal"); return !!m && m.style.display !== "none"; }
function elpAbrirJanela(id, origem){
  const modal = $("est-lp-modal"), obra = elpObra();
  const est = elpEstacasDaAba().find(e => e.id === id);
  if(!modal || !est || !obra || !elpPodeLancar()) return;
  if(typeof fecharModalEstaca === "function" && $("est-modal") && $("est-modal").style.display !== "none") fecharModalEstaca();
  const d = elpDados(), dois = !!(d && d.doisTurnos);
  const seq = ++_elp.seq;
  _elp.estaca = est; _elp.obra = obra; _elp.origem = origem && origem.isConnected ? origem : null;
  elpAviso("");
  const onde = [est.local, est.bloco].map(s => String(s || "").trim()).filter(Boolean).join(" · ");
  const apoio = $("est-lp-apoio");
  if(apoio) apoio.innerHTML = `<span class="rotulo-caps">Estaca</span> ${/* html */ uiCodigo(est.numero || "")}${onde ? ` <span class="meta">${esc(onde)}</span>` : ""}<br>${esc(elpApoioTexto(elpEtapasDe(est), elpTagDe, dois))} Informe quem perfurou e quando: o diário abre com a linha desta estaca.`;
  const data = $("est-lp-data");
  if(data){ data.value = ""; if(typeof hojeISO === "function") data.max = hojeISO(); }
  const per = $("est-lp-periodo");
  if(per) per.value = "diurno";
  const campoPer = $("est-lp-periodo-campo");
  if(campoPer) campoPer.style.display = dois ? "" : "none";   // o período só existe em obra de dois turnos
  if($("est-lp-maquina")) $("est-lp-maquina").value = "";
  const dosDiarios = elpMaquinasDosDiarios();
  elpPreencherMaquinas(dosDiarios);
  modal.style.display = "flex";
  data?.focus();
  // as máquinas da obra (mobilização, diário recente, vínculo): a lista se completa sem travar a janela
  sb.from("vw_obra_equipamentos").select("equipamento_id").eq("obra_id", obra).then(({ data: linhas, error }) => {
    if(error || seq !== _elp.seq || !elpJanelaAberta()) return;
    elpPreencherMaquinas([...new Set(dosDiarios.concat((linhas || []).map(x => x.equipamento_id)))]);
  });
}
function elpFecharJanela(){
  const modal = $("est-lp-modal");
  if(!modal || modal.style.display === "none") return;
  modal.style.display = "none";
  elpAviso("");
  const origem = _elp.origem;
  _elp.estaca = null; _elp.obra = null; _elp.origem = null; _elp.seq++;
  if(origem && origem.isConnected) origem.focus();
}
/* Continuar: valida, procura o diário daquela obra, data, máquina e período e abre a ficha do RDO. Nada é gravado. */
async function elpContinuar(){
  const est = _elp.estaca, obra = _elp.obra;
  if(!est || !obra || obra !== elpObra() || !elpPodeLancar()) return;
  const dois = $("est-lp-periodo-campo") ? $("est-lp-periodo-campo").style.display !== "none" : false;
  const pedido = { data: $("est-lp-data")?.value || "", maquina: $("est-lp-maquina")?.value || "", turno: dois ? ($("est-lp-periodo")?.value || "") : "diurno" };
  const erro = elpValidarPedido(pedido, typeof hojeISO === "function" ? hojeISO() : null);
  if(erro){
    elpAviso(erro, "erro");
    $(/data/i.test(erro) ? "est-lp-data" : /máquina/i.test(erro) ? "est-lp-maquina" : "est-lp-periodo")?.focus();   // o foco vai para o campo que falta
    return;
  }
  elpAviso("");
  const { data: rdos, error } = await sb.from("rdo").select("id,data,tipo_servico,equipamento_id,turno_campo,status")
    .eq("obra_id", obra).eq("data", pedido.data).eq("tipo_servico", ELP_TIPO_DIARIO).eq("equipamento_id", pedido.maquina);
  if(error){ elpAviso("Não foi possível procurar o diário: " + (error.message || "erro sem mensagem") + ". Nada foi gravado.", "erro"); return; }
  if(_elp.estaca !== est || obra !== elpObra() || !elpJanelaAberta()) return;   // fechou a janela ou trocou de obra enquanto lia
  const achado = elpAcharDiario(rdos, pedido);
  _elp.origem = null;   // a tela vai mudar: o foco segue para o diário
  elpFecharJanela();
  await elpAbrirDiario(est, obra, pedido, achado);
}
/* Abre a ficha do RDO (o diário achado, ou um novo com o cabeçalho preenchido) e põe nela a linha da estaca, com o foco no
   acumulado. Só mexe na tela: quem grava é o Salvar do diário. */
async function elpAbrirDiario(est, obra, pedido, achado){
  if(typeof irParaSecao !== "function" || typeof abrirRDO !== "function" || typeof novoRDO !== "function") return false;
  if(!irParaSecao("rdo")) return false;   // perfil sem o módulo: o aviso é do menu
  if(typeof _rdoVoltarPara !== "undefined") _rdoVoltarPara = obra;   // o Voltar da ficha devolve para a obra
  const maq = (elpEquipamentos().find(q => q.id === pedido.maquina) || {}).codigo || "a máquina escolhida";
  const quando = `${elpDataBR(pedido.data)} da ${maq}${pedido.turno === "noturno" ? " (noturno)" : ""}`;
  let idx = -1, msg = "";
  if(achado){
    await abrirRDO(achado.id);
    // a ficha só vale se abriu este diário (falha de leitura deixa a ficha anterior na tela: o aviso é do RDO)
    const abriu = rdoEditId === achado.id && $("rdo-ficha")?.style.display !== "none" && $("rdo-obra")?.value === obra && $("rdo-data")?.value === pedido.data;
    if(!abriu){
      // leitura que falhou já tem o aviso do RDO; ficha aberta com outra obra ou data (obra fora da lista do diário) avisa aqui
      if(rdoEditId === achado.id) aviso("app-aviso", `O diário de ${quando} abriu sem a obra ou a data esperada; a linha da estaca não foi posta nele. Nada foi gravado.`, "erro");
      return false;
    }
    idx = elpAcharLinha(_rdoExecucoes, est);
    if(idx >= 0) msg = `O diário de ${quando} já tem a linha da estaca ${est.numero}. Informe o acumulado (Acum.) nela e salve o diário: nada foi gravado ainda.`;
    else {
      _rdoExecucoes.push(elpLinhaPerfuracao(est));
      idx = _rdoExecucoes.length - 1;
      msg = `Diário de ${quando} aberto com a linha da estaca ${est.numero}. Informe o acumulado (Acum.) e salve o diário: nada foi gravado ainda.`;
    }
    if(achado.status === "finalizado") msg += " O diário está finalizado e continua assim ao salvar.";
  } else {
    await novoRDO();
    const por = (id, v) => { const el = $(id); if(el) el.value = v; return el ? el.value === v : false; };
    if(!por("rdo-obra", obra)){ aviso("app-aviso", "Não foi possível abrir um diário novo para esta obra. Nada foi gravado.", "erro"); return false; }
    por("rdo-data", pedido.data);
    por("rdo-tipo-servico", ELP_TIPO_DIARIO);
    por("rdo-turno", pedido.turno);
    por("rdo-local", est.local || "");
    const temMaq = por("rdo-equipamento", pedido.maquina);
    _rdoExecucoes.push(elpLinhaPerfuracao(est));
    idx = _rdoExecucoes.length - 1;
    // chips, abas de estaca raiz e grade, com o cabeçalho que acabou de ser preenchido
    if(typeof abrirFichaRDOVisual === "function") abrirFichaRDOVisual({ obra_id: obra, data: pedido.data, tipo_servico: ELP_TIPO_DIARIO, equipamento_id: pedido.maquina, turno_campo: pedido.turno, status: "rascunho" });
    if(typeof carregarParamsObraRDO === "function") await carregarParamsObraRDO(obra);   // máquinas da obra primeiro, período e jornada da obra
    if(typeof carregarLocaisRDO === "function") carregarLocaisRDO(obra);
    if($("rdo-obra")?.value !== obra || rdoEditId) return false;   // saiu da ficha nova enquanto a obra carregava
    por("rdo-turno", pedido.turno);
    msg = `Diário novo de ${quando}, ainda não gravado, com a linha da estaca ${est.numero}. Informe o acumulado (Acum.), complete o diário e salve.`
      + (temMaq ? "" : " Escolha a máquina no cabeçalho.");
  }
  if(typeof ativarTabRDO === "function") ativarTabRDO("execucoes");   // redesenha a grade com a linha
  const tr = $("rdo-execs")?.querySelector(`tr[data-idx="${idx}"]`);
  tr?.scrollIntoView?.({ block: "center" });
  tr?.querySelector(".ex-pate")?.focus();
  if(typeof appMarcarSujo === "function") appMarcarSujo();   // há uma linha na tela que ainda não foi salva
  aviso("app-aviso", msg, "aviso");
  return true;
}

/* ---------- eventos ---------- */
function ligarElp(){
  document.addEventListener("click", (ev) => {
    const alvo = ev.target && ev.target.closest ? ev.target : null;
    if(!alvo) return;
    const f = alvo.closest("#est-lp-faixa [data-est-lp-filtro]");
    if(f){ elpDefinirFiltro(f.dataset.estLpFiltro); return; }
    const b = alvo.closest("[data-est-lp]");
    if(b){ ev.preventDefault(); elpAbrirJanela(b.dataset.estLp, b); }
  });
  $("btn-est-lp-fechar")?.addEventListener("click", elpFecharJanela);
  $("btn-est-lp-cancelar")?.addEventListener("click", elpFecharJanela);
  $("btn-est-lp-continuar")?.addEventListener("click", (ev) => comBotaoTravado(ev.currentTarget, elpContinuar));
  document.addEventListener("keydown", (ev) => {
    if(!elpJanelaAberta()) return;
    if(ev.key === "Escape"){ elpFecharJanela(); return; }
    if(ev.key === "Enter" && ev.target && ev.target.closest && ev.target.closest("#est-lp-modal .campo")){ ev.preventDefault(); $("btn-est-lp-continuar")?.click(); }
  });
}
if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarElp);
  else ligarElp();
}

// teste em Node (scripts/testar-fase173a.mjs): as funções puras também saem por module.exports
if(typeof module === "object" && module && module.exports){
  module.exports = { ELP_FILTROS, ELP_TIPO_DIARIO, raizEtapas, elpSituacao, elpFiltroPuro, elpContar, elpLinhaPerfuracao, elpAcharLinha, elpAcharDiario, elpValidarPedido,
    elpApoioTexto, elpTituloFalta, elpEtiquetaHTML, elpBotaoHTML, elpFaixaHTML, elpMaquinasHTML, elpAjustarLinha };
}

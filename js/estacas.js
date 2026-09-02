/* ====================================================================
   Módulo: Estacas (aba dentro da ficha de Obra)
   Lista, cadastro manual, edição, exclusão e importação via PDF (IA).
   Depende de: window.obraEditId (id da obra aberta na ficha)
   ==================================================================== */

let _estacas = [];            // cache das estacas da obra atual
let _estacaEdit = null;       // estaca em edição no modal
let _importPreview = [];      // estacas extraídas do PDF aguardando confirmação
let _importUnidade = null;    // unidade das coordenadas do import (IA ou heurística): "m" | "cm" | "mm"

// Heurística pela MENOR distância entre estacas nas unidades cruas do arquivo:
// estacas nunca ficam a menos de ~0,5 m nem a mais de ~500 m da vizinha mais próxima.
//   dmin < 50    → metros (ex.: 1,70)      50 ≤ dmin < 500 → centímetros (ex.: 170)
//   dmin ≥ 500   → milímetros (ex.: 1700)
function unidadeSugeridaCoords(lista){
  const pts = (lista || []).filter(e => e.coord_x != null && e.coord_y != null).map(e => [Number(e.coord_x), Number(e.coord_y)]);
  if(pts.length < 2) return null;
  let dmin = Infinity;
  for(let i = 0; i < pts.length; i++) for(let j = i + 1; j < pts.length; j++){
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if(d > 0 && d < dmin) dmin = d;
  }
  if(!isFinite(dmin)) return null;
  return dmin < 50 ? "m" : dmin < 500 ? "cm" : "mm";
}
let _estView = "lista";       // vista atual da aba Estacas: lista | planta
let _estExecId = null;        // estaca aberta no modal de execução rápida
let _estacaFuncs = [];        // cache funcionários para select operador
let _estacaEquips = [];       // cache equipamentos para select equipamento
let _plantaState = { zoom: 1, panX: 0, panY: 0 }; // estado do pan/zoom
let _plantaCor = "status";  // como colorir a planta: "status" | "maquina"
const _mapaMaquinas = {};   // equipamento_id -> { codigo, nome }
let _equipamentosCache = []; // equipamentos ativos da obra atual
let _distanciaMinObra = 0;    // piso absoluto opcional da obra (0 = sem piso)
let _regraDist = { fatorHelice: 5, fatorEscavada: 2.5, piso: 0, fatorLocacao: 3 };
// Coordenadas ficam gravadas na unidade do projeto (mm por padrão — DXF/PDF vêm assim).
// Tudo que desenha ou mede converte para metros via _coordM().
let _unidadeCoord = "mm";
let _fatorCoord = 1000;
const FATOR_UNIDADE = { mm: 1000, cm: 100, m: 1 };
function _coordM(e){
  if(e == null || e.coord_x == null || e.coord_y == null) return e;
  return Object.assign({}, e, { coord_x: Number(e.coord_x) / _fatorCoord, coord_y: Number(e.coord_y) / _fatorCoord });
}
function _aplicarUnidadeCoordUI(){
  const lx = $("lbl-est-coord-x"), ly = $("lbl-est-coord-y");
  if(lx) lx.textContent = "Coordenada X / Leste (" + _unidadeCoord + ")";
  if(ly) ly.textContent = "Coordenada Y / Norte (" + _unidadeCoord + ")";
  if($("regra-unidade")) $("regra-unidade").value = _unidadeCoord;
}

// Regra de cura da CGL: distância mínima EIXO A EIXO = fator × Ø (maior Ø do par).
// Hélice/raiz/demais 5×Ø; escavada × escavada 2,5×Ø. Piso opcional por obra.
// Sem Ø conhecido nas duas estacas cai no piso ou, se não houver, nos 2,05 m históricos.
function distMinEntre(a, b){
  const dA = Number(a?.diametro_mm) || 0, dB = Number(b?.diametro_mm) || 0;
  const diam = Math.max(dA, dB) / 1000;
  const escav = (t) => t === "escavada";
  const fator = (escav(a?.tipo) && escav(b?.tipo)) ? _regraDist.fatorEscavada : _regraDist.fatorHelice;
  const porDiam = diam > 0 ? fator * diam : 0;
  const exigido = Math.max(porDiam, Number(_regraDist.piso) || 0);
  return exigido > 0 ? exigido : 2.05;
}
// Regra de LOCAÇÃO do projeto (independe de máquina/sequência): fatorLocacao × maior Ø do par.
// null quando nenhuma das duas tem Ø (não dá para avaliar).
function distMinLocacao(a, b){
  const diam = Math.max(Number(a?.diametro_mm) || 0, Number(b?.diametro_mm) || 0) / 1000;
  const f = Number(_regraDist.fatorLocacao) || 0;
  return (diam > 0 && f > 0) ? f * diam : null;
}
function descreverRegraDist(){
  const f = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  // Só menciona o fator de escavada se a obra tiver estacas escavadas (obra de raiz/hélice não precisa ver isso)
  const tipos = new Set((_estacas || []).map(e => e.tipo).filter(Boolean));
  const temEsc = tipos.has("escavada"), soEsc = temEsc && tipos.size === 1;
  const exec = soEsc ? f(_regraDist.fatorEscavada) + "×Ø"
    : f(_regraDist.fatorHelice) + "×Ø" + (temEsc ? " (escavada " + f(_regraDist.fatorEscavada) + "×Ø)" : "");
  return "execução " + exec
    + (Number(_regraDist.piso) > 0 ? " · piso " + f(_regraDist.piso) + " m" : "")
    + " · locação " + f(_regraDist.fatorLocacao) + "×Ø";
}
function preencherRegraDistUI(){
  const t = $("regra-dist-txt"); if(t) t.textContent = descreverRegraDist() + " · coordenadas em " + _unidadeCoord;
  if($("regra-fator"))     $("regra-fator").value     = _regraDist.fatorHelice;
  if($("regra-fator-esc")) $("regra-fator-esc").value = _regraDist.fatorEscavada;
  if($("regra-piso"))      $("regra-piso").value      = _regraDist.piso;
  if($("regra-fator-loc")) $("regra-fator-loc").value = _regraDist.fatorLocacao;
  _aplicarUnidadeCoordUI();
}
async function salvarRegraDist(){
  if(!obraEditId) return;
  const fh = Number($("regra-fator")?.value), fe = Number($("regra-fator-esc")?.value), piso = Number($("regra-piso")?.value), fl = Number($("regra-fator-loc")?.value);
  if(!(fh > 0) || !(fe > 0) || !(fl > 0) || !(piso >= 0)){ aviso("app-aviso","Informe fatores maiores que zero e piso ≥ 0.","erro"); return; }
  const un = $("regra-unidade")?.value || "mm";
  if(!FATOR_UNIDADE[un]){ aviso("app-aviso","Unidade inválida.","erro"); return; }
  const { error } = await sb.from("obras").update({ fator_dist_diametro: fh, fator_dist_diametro_escavada: fe, distancia_minima_estacas: piso, fator_dist_locacao: fl, unidade_coordenadas: un }).eq("id", obraEditId);
  if(error){ aviso("app-aviso","Não foi possível salvar a regra: " + error.message,"erro"); return; }
  _regraDist = { fatorHelice: fh, fatorEscavada: fe, piso, fatorLocacao: fl };
  _unidadeCoord = un; _fatorCoord = FATOR_UNIDADE[un];
  _distanciaMinObra = piso;
  preencherRegraDistUI();
  const d = $("regra-dist"); if(d) d.open = false;
  renderPlantaSVG();
  aviso("app-aviso","Regra de distância salva: " + descreverRegraDist(), "ok");
}
let _dxfParsed = null;        // resultado do parse do DXF: { entidades, layers }
let _dxfCfg = null;           // config escolhida no modal DXF

/* Paleta para colorir por máquina (cores de domínio, não semânticas) */
const CORES_MAQUINA = ["#F4A020", "#1B5FA8", "#8B5CF6", "#2D7D46", "#C0392B",
                        "#0EA5E9", "#DB2777", "#65A30D", "#EA580C", "#4B5563"];
function corDaMaquina(eqId){
  if(!eqId) return "var(--txt-sutil)";
  const ids = Object.keys(_mapaMaquinas).sort();
  const i = ids.indexOf(eqId);
  return CORES_MAQUINA[i % CORES_MAQUINA.length];
}

/* Cores da estaca por status na planta. Fluxo (fase 25):
   prevista → em_execucao → perfuracao_concluida → armacao_aplicada
   → executada(=concretada) → refugada. */
const COR_STATUS = {
  prevista:             "var(--estaca-prevista)",
  em_execucao:          "var(--aviso)",
  perfuracao_concluida: "var(--estaca-hoje)",
  armacao_aplicada:     "var(--marca-laranja)",
  executada:            "var(--sucesso)",
  refugada:             "var(--perigo)"
};
const COR_HOJE = "var(--estaca-hoje)";

/* Normaliza nome da estaca (UPPER + trim) — mesmo formato que o trigger SQL usa.
   NOTA: NÃO remove BB. Em obras da CGL, BB1.1, B6.1_BB etc são nomes legítimos
   (estacas reais distintas de B1.1 / B6.1). Só normaliza caixa e espaços. */
function normalizarNumeroEstacaEstacas(s){
  if(!s) return "";
  return String(s).toUpperCase().trim().replace(/\s+/g, " ");
}

/* Reduz a string a apenas dígitos (pra comparar "B66" vs "B6.6" → ambos viram "66") */
// ---- Coordenadas/cotas vindas como texto no import (IA v4 escrevia
// "Coordenadas N=2553,000 E=4253,940. CAE=99,350m, CPE=87,300m" em observacoes).
// Sem coord_x/coord_y a planta vira grid por bloco e a checagem de 2,05 m nao roda.
function _numBRImport(s){
  if(s == null) return null;
  let t = String(s).trim();
  if(/,\d{1,3}$/.test(t) && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function _pegaRotuloImport(txt, rotulo){
  const m = txt.match(new RegExp("(?:^|[\\s,;(])" + rotulo + "\\s*[=:]\\s*(-?[0-9]+(?:[.,][0-9]+)?)", "i"));
  return m ? _numBRImport(m[1]) : null;
}
function extrairCoordsDaObservacao(item){
  const e = Object.assign({}, item);
  for(const k of ["coord_x","coord_y","cota_topo","cota_ponta"]) if(typeof e[k] === "string") e[k] = _numBRImport(e[k]);
  const obs = typeof e.observacoes === "string" ? e.observacoes : "";
  if(!obs) return e;
  if(e.coord_x == null && e.coord_y == null){
    const X = _pegaRotuloImport(obs, "E") ?? _pegaRotuloImport(obs, "X") ?? _pegaRotuloImport(obs, "Leste");
    const Y = _pegaRotuloImport(obs, "N") ?? _pegaRotuloImport(obs, "Y") ?? _pegaRotuloImport(obs, "Norte");
    if(X != null && Y != null){ e.coord_x = X; e.coord_y = Y; }
  }
  if(e.cota_topo == null){ const v = _pegaRotuloImport(obs, "CAE") ?? _pegaRotuloImport(obs, "Cota de arrasamento"); if(v != null) e.cota_topo = v; }
  if(e.cota_ponta == null){ const v = _pegaRotuloImport(obs, "CPE") ?? _pegaRotuloImport(obs, "Cota de ponta"); if(v != null) e.cota_ponta = v; }
  return e;
}

function soDigitos(s){
  return String(s||"").replace(/\D/g, "");
}

/* Score de similaridade entre nome do CSV e nome cadastrado (0..1)
   Bônus / penalidade pra prefixo BB: ambos com BB ou ambos sem BB tem prioridade
   sobre cruzamentos (BB11 deve sugerir BB1.1 antes de B1.1). */
function scoreSimilaridade(csvNome, projNome){
  const a = String(csvNome||"").toUpperCase();
  const b = String(projNome||"").toUpperCase();
  if(a === b) return 1;
  const da = soDigitos(a);
  const db = soDigitos(b);
  if(!da || !db) return 0;
  // Indicador BB: começa com BB OU termina com _BB
  const isBBa = /^BB(?=\d)/.test(a) || /_BB$/.test(a);
  const isBBb = /^BB(?=\d)/.test(b) || /_BB$/.test(b);
  const ajusteBB = (isBBa === isBBb) ? 0 : -0.15;  // penaliza cruzamento BB↔não-BB
  let base = 0;
  if(da === db)                                base = 0.95;     // mesmos dígitos
  else if(da.includes(db) || db.includes(da))  base = 0.70;     // um contém o outro
  else if(da[0] === db[0])                     base = 0.40;     // mesmo primeiro dígito
  if(base === 0) return 0;
  return Math.max(0, Math.min(1, base + ajusteBB));
}

const ESTACA_TIPOS = {
  helice_continua: "Hélice contínua",
  pre_moldada: "Pré-moldada",
  raiz: "Raiz",
  escavada: "Escavada",
  strauss: "Strauss",
  metalica: "Metálica",
  franki: "Franki",
  hsa: "HSA",
  barrete: "Barrete",
  outro: "Outro"
};

const ESTACA_STATUS = {
  prevista:             { label: "Prevista",              cor: "cinza"    },
  em_execucao:          { label: "Em execução",           cor: "ambar"    },
  perfuracao_concluida: { label: "Perfuração concluída",  cor: "azul"     },
  armacao_aplicada:     { label: "Armação aplicada",      cor: "ambar"    },
  executada:            { label: "Executada",             cor: "verde"    },
  refugada:             { label: "Refurada",              cor: "vermelho" }
};

/* ---------- Carga ---------- */
async function carregarEstacasDaObra(obraId){
  if(!obraId){
    _estacas = [];
    renderEstacas();
    return;
  }
  const [estsRes, execsRes, equipsRes, obraRes] = await Promise.all([
    sb.from("estacas")
      .select("id,numero,tipo,status,diametro_mm,profundidade_m,cota_topo,cota_ponta,volume_concreto_m3,data_execucao,equipamento_id,operador_id,observacoes,alterada_em,alteracao_motivo,bloco,ordem_execucao,coord_x,coord_y,local")
      .eq("obra_id", obraId)
      .order("numero"),
    // !inner + eq no join: filtra por obra NO SERVIDOR (antes baixava a tabela
    // inteira de execuções e filtrava no navegador a cada abertura)
    sb.from("rdo_execucao_estaca")
      .select("estaca_id, modalidade_execucao, rdo:rdo_id!inner(obra_id)")
      .eq("rdo.obra_id", obraId)
      .not("estaca_id", "is", null),
    sb.from("equipamentos").select("id,codigo,nome").eq("ativo", true).order("codigo"),
    sb.from("obras").select("distancia_minima_estacas,fator_dist_diametro,fator_dist_diametro_escavada,fator_dist_locacao,unidade_coordenadas").eq("id", obraId).single()
  ]);
  // Guarda de corrida: se o usuário abriu OUTRA obra enquanto esta carregava,
  // descarta o resultado (antes a ficha de B mostrava as estacas de A).
  if(obraId !== obraEditId) return;
  _equipamentosCache = equipsRes.error ? [] : (equipsRes.data || []);
  _regraDist = {
    fatorHelice:   Number(obraRes.data?.fator_dist_diametro ?? 5) || 5,
    fatorEscavada: Number(obraRes.data?.fator_dist_diametro_escavada ?? 2.5) || 2.5,
    piso:          Number(obraRes.data?.distancia_minima_estacas ?? 0) || 0,
    fatorLocacao:  Number(obraRes.data?.fator_dist_locacao ?? 3) || 3
  };
  _distanciaMinObra = _regraDist.piso;
  _unidadeCoord = FATOR_UNIDADE[obraRes.data?.unidade_coordenadas] ? obraRes.data.unidade_coordenadas : "mm";
  _fatorCoord = FATOR_UNIDADE[_unidadeCoord];
  _raizDados = null; // acompanhamento raiz recarrega com a obra
  _estacas = estsRes.error ? [] : (estsRes.data || []);
  // Conta execuções por estaca pra detectar "ALTERADO" (refuros, casamentos errados)
  const contExec = {};
  (execsRes.data || []).forEach(re => {
    if(!re.rdo || re.rdo.obra_id !== obraId) return;
    if(!contExec[re.estaca_id]) contExec[re.estaca_id] = { total: 0, refuros: 0 };
    contExec[re.estaca_id].total++;
    if(re.modalidade_execucao === "refuro") contExec[re.estaca_id].refuros++;
  });
  // Anexa metadados nas estacas (não persiste — só uso em render)
  _estacas.forEach(e => {
    const c = contExec[e.id] || { total: 0, refuros: 0 };
    e._execs_total   = c.total;
    e._execs_refuros = c.refuros;
    // ALTERADO se: tem refuro OU se tem 2+ execuções (suspeito)
    e._alterada = c.total > 1;
  });
  renderEstacas();
  carregarContagemReconciliacao(obraId);
}

/* ---------- Render ---------- */
/* Filtro por local (1º nível acima do bloco) — só aparece quando a obra tem locais */
function atualizarFiltroLocal(){
  const sel = $("est-f-local");
  if(!sel) return;
  const locais = [...new Set(_estacas.map(e => (e.local || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos os locais</option>' + locais.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join("");
  if(locais.includes(atual)) sel.value = atual;
  sel.style.display = locais.length ? "" : "none";
}
/* Botão "Acompanhamento raiz" só para obra com estacas raiz */
function atualizarBotaoRaiz(){
  const b = $("btn-est-view-raiz");
  if(!b) return;
  const tem = _estacas.some(e => e.tipo === "raiz");
  b.style.display = tem ? "" : "none";
  if(!tem && _estView === "raiz"){ _estView = "lista"; document.querySelectorAll("[data-est-view]").forEach(x => x.classList.toggle("ativo", x.dataset.estView === "lista")); }
}

/* ====================================================================
   ACOMPANHAMENTO RAIZ (RG 11.1) — vista "Raiz" da aba Estacas.
   Replica a planilha de acompanhamento de estaca raiz da CGL, por estaca:
   Local · Bloco · Estaca · Ø · Comp. estimado | EXECUÇÃO: comp. final,
   comp. total executado (inclui refuros), data, metros por ferramenta
   (revestimento / martelo / tricone), TAG | INJEÇÃO: data, sacos, m³, TAG |
   Período · Medição (BM) · Observação. Tudo derivado do RDO (execuções +
   trechos de solo com ferramenta + itens de medição) — nada é digitado aqui.
   Só aparece quando a obra tem estacas do tipo raiz.
   ==================================================================== */
let _raizDados = null;   // { execsPorEstaca: Map, carregadoEm }

function _raizPeriodo(iso){
  if(!iso) return "";
  const h = Number(String(iso).slice(11, 13));
  if(Number.isNaN(h)) return "";
  return (h >= 18 || h < 6) ? "NOTURNO" : "DIURNO";
}
function _raizTag(exec){
  if(exec.equipamento_id){
    const eq = (_equipamentosCache || []).find(x => x.id === exec.equipamento_id);
    if(eq) return eq.codigo || eq.nome || "";
  }
  return exec.maquina_codigo || "";
}

async function carregarAcompanhamentoRaiz(){
  if(!obraEditId) return null;
  const { data: execs, error } = await sb.from("rdo_execucao_estaca")
    .select("id,estaca_id,estaca_numero,profundidade_executada,perfuracao_inicio,perfuracao_fim,concretagem_inicio,concretagem_fim,volume_concreto_m3,consumo_cimento_raiz,consumo_cimento_unidade,equipamento_id,maquina_codigo,modalidade_execucao,observacoes,rdo:rdo_id!inner(obra_id,data)")
    .eq("rdo.obra_id", obraEditId)
    .order("perfuracao_inicio", { ascending: true });
  if(error){ aviso("app-aviso", "Não foi possível carregar as execuções: " + error.message, "erro"); return null; }
  const ids = (execs || []).map(e => e.id);
  let solos = [], meds = [];
  if(ids.length){
    const [sRes, mRes] = await Promise.all([
      sb.from("rdo_raiz_solo").select("execucao_id,inicio_ml,final_ml,ferramenta").in("execucao_id", ids),
      sb.from("medicao_itens").select("execucao_id, medicao:medicao_id(numero,status)").in("execucao_id", ids)
    ]);
    solos = sRes.data || [];
    meds  = mRes.data || [];
  }
  const soloPorExec = new Map();
  solos.forEach(s => { if(!soloPorExec.has(s.execucao_id)) soloPorExec.set(s.execucao_id, []); soloPorExec.get(s.execucao_id).push(s); });
  const medPorExec = new Map();
  meds.forEach(m => { if(m.medicao?.numero){ if(!medPorExec.has(m.execucao_id)) medPorExec.set(m.execucao_id, new Set()); medPorExec.get(m.execucao_id).add(m.medicao.numero); } });

  // agrupa por estaca (id; sem id, pelo número normalizado)
  const porEstaca = new Map();
  (execs || []).forEach(ex => {
    const chave = ex.estaca_id || ("n:" + normalizarNumeroEstacaEstacas(ex.estaca_numero || ""));
    if(!porEstaca.has(chave)) porEstaca.set(chave, []);
    porEstaca.get(chave).push({ ...ex, _solo: soloPorExec.get(ex.id) || [], _meds: [...(medPorExec.get(ex.id) || [])] });
  });
  _raizDados = { porEstaca, carregadoEm: Date.now() };
  return _raizDados;
}

function _raizLinha(est, execs){
  const num = (v) => (v == null ? null : Number(v));
  const furos = execs.filter(x => (x.modalidade_execucao || "furo_normal") !== "refuro");
  const ultimo = execs.length ? execs[execs.length - 1] : null;
  const compFinal = furos.length ? Math.max(...furos.map(x => num(x.profundidade_executada) || 0)) : (ultimo ? num(ultimo.profundidade_executada) : null);
  const compTotal = execs.reduce((s, x) => s + (num(x.profundidade_executada) || 0), 0);
  const ferr = { revestimento: 0, martelo: 0, tricone: 0, outro: 0 };
  execs.forEach(x => (x._solo || []).forEach(s => {
    const m = Math.max(0, (num(s.final_ml) || 0) - (num(s.inicio_ml) || 0));
    const k = ferr[s.ferramenta] != null ? s.ferramenta : "outro";
    ferr[k] += m;
  }));
  const comInj = execs.filter(x => x.concretagem_inicio || x.volume_concreto_m3 != null || x.consumo_cimento_raiz);
  const ultInj = comInj.length ? comInj[comInj.length - 1] : null;
  let sacos = 0, sacosTxt = [];
  execs.forEach(x => {
    if(!x.consumo_cimento_raiz) return;
    const n = Number(String(x.consumo_cimento_raiz).replace(",", "."));
    if(isFinite(n) && (!x.consumo_cimento_unidade || /saco/i.test(x.consumo_cimento_unidade))) sacos += n;
    else sacosTxt.push(String(x.consumo_cimento_raiz) + (x.consumo_cimento_unidade ? " " + x.consumo_cimento_unidade : ""));
  });
  const m3 = execs.reduce((s, x) => s + (num(x.volume_concreto_m3) || 0), 0);
  const meds = [...new Set(execs.flatMap(x => x._meds))];
  return {
    local: est.local || "", bloco: est.bloco || "", numero: est.numero || "", diametro: est.diametro_mm, estimado: est.profundidade_m,
    compFinal: execs.length ? compFinal : null, compTotal: execs.length ? compTotal : null,
    dataExec: ultimo ? (ultimo.perfuracao_fim || ultimo.perfuracao_inicio || ultimo.rdo?.data || null) : null,
    revest: ferr.revestimento, martelo: ferr.martelo, tricone: ferr.tricone, outro: ferr.outro,
    tagExec: ultimo ? _raizTag(ultimo) : "",
    dataInj: ultInj ? (ultInj.concretagem_inicio || ultInj.rdo?.data || null) : null,
    sacos: sacos || null, sacosTxt: sacosTxt.join("; "), m3: comInj.length ? m3 : null,
    tagInj: ultInj ? _raizTag(ultInj) : "",
    periodo: ultimo ? _raizPeriodo(ultimo.perfuracao_inicio) : "",
    medicoes: meds.join(", "),
    refuros: execs.length - furos.length,
    obs: est.observacoes || "",
    status: est.status
  };
}

async function renderAcompanhamentoRaiz(){
  const cont = $("est-raiz-conteudo");
  if(!cont) return;
  if(!_raizDados) { cont.innerHTML = `<p class="vazio">Carregando execuções do RDO…</p>`; if(!(await carregarAcompanhamentoRaiz())) return; }

  const fStatus = $("est-f-status")?.value || "";
  const fLocal  = $("est-f-local")?.value || "";
  const termo   = ($("est-busca")?.value || "").trim().toLowerCase();
  const lista = _estacas.filter(e => e.tipo === "raiz")
    .filter(e => !fStatus || e.status === fStatus)
    .filter(e => !fLocal || (e.local || "") === fLocal)
    .filter(e => !termo || `${e.numero||""} ${e.observacoes||""} ${e.local||""} ${e.bloco||""}`.toLowerCase().includes(termo));
  if(!lista.length){ cont.innerHTML = `<p class="vazio">Nenhuma estaca raiz para os filtros.</p>`; return; }

  const linhas = lista.map(e => _raizLinha(e, _raizDados.porEstaca.get(e.id) || _raizDados.porEstaca.get("n:" + normalizarNumeroEstacaEstacas(e.numero || "")) || []));
  // ordena por local, bloco, número
  const ord = (a, b) => (a.local.localeCompare(b.local, "pt-BR") || a.bloco.localeCompare(b.bloco, "pt-BR", { numeric: true }) || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
  linhas.sort(ord);

  const f2 = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const f0 = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }));
  const dt = (v) => (v ? dataBR(String(v).slice(0, 10)) : "—");
  const soma = (k) => linhas.reduce((s, l) => s + (Number(l[k]) || 0), 0);
  const execN = linhas.filter(l => l.compFinal != null).length;
  const semFerr = linhas.filter(l => l.compFinal != null && !(l.revest + l.martelo + l.tricone + l.outro)).length;

  let html = `<div class="raiz-resumo">
      <span><strong>${linhas.length}</strong> estacas raiz</span>
      <span><strong>${execN}</strong> executadas</span>
      <span><strong>${f2(soma("compTotal"))} m</strong> executados (com refuros)</span>
      <span><strong>${f2(soma("revest"))} m</strong> revestimento · <strong>${f2(soma("martelo"))} m</strong> martelo · <strong>${f2(soma("tricone"))} m</strong> tricone</span>
      <span><strong>${f0(soma("sacos"))}</strong> sacos · <strong>${f2(soma("m3"))} m³</strong></span>
      <button type="button" class="btn-sec btn-sm" id="btn-raiz-csv">⬇️ CSV</button>
    </div>`;
  if(semFerr) html += `<div class="dist-aviso neutro">ℹ️ ${semFerr} estaca(s) executada(s) sem trechos de solo com ferramenta no RDO — as colunas revestimento/martelo/tricone ficam zeradas até o RDO ser preenchido.</div>`;

  let localAtual = null;
  const trs = linhas.map(l => {
    let cab = "";
    if(l.local !== localAtual){ localAtual = l.local; cab = `<tr class="raiz-grupo"><td colspan="19">📍 ${esc(l.local || "Sem local")}</td></tr>`; }
    const stCls = l.status === "executada" ? "ok" : (l.status === "refugada" ? "perigo" : "");
    return cab + `<tr class="${stCls}">
      <td>${esc(l.bloco || "—")}</td><td><strong>${esc(l.numero)}</strong>${l.refuros ? ` <span class="badge-alterado" title="${l.refuros} refuro(s)">🔄${l.refuros}</span>` : ""}</td>
      <td class="num">${f0(l.diametro)}</td><td class="num">${f2(l.estimado)}</td>
      <td class="num">${f2(l.compFinal)}</td><td class="num">${f2(l.compTotal)}</td><td>${dt(l.dataExec)}</td>
      <td class="num">${l.compFinal != null ? f2(l.revest) : "—"}</td><td class="num">${l.compFinal != null ? f2(l.martelo) : "—"}</td><td class="num">${l.compFinal != null ? f2(l.tricone) : "—"}</td>
      <td>${esc(l.tagExec || "—")}</td>
      <td>${dt(l.dataInj)}</td><td class="num">${l.sacos != null ? f0(l.sacos) : (l.sacosTxt ? esc(l.sacosTxt) : "—")}</td><td class="num">${f2(l.m3)}</td><td>${esc(l.tagInj || "—")}</td>
      <td>${esc(l.periodo || "—")}</td><td>${esc(l.medicoes || "—")}</td><td class="meta">${esc(l.obs)}</td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm raiz-edit" data-num="${esc(l.numero)}" title="abrir estaca">✏️</button></td>
    </tr>`;
  }).join("");

  html += `<div class="tabela-rola"><table class="raiz-tabela">
    <thead>
      <tr class="raiz-cab-grupo"><th colspan="4"></th><th colspan="7">EXECUÇÃO DA ESTACA</th><th colspan="4">INJEÇÃO</th><th colspan="4"></th></tr>
      <tr><th>Bloco</th><th>Estaca</th><th class="num">Ø (mm)</th><th class="num">Comp. est. (m)</th>
        <th class="num">Comp. final</th><th class="num">Total exec.</th><th>Data</th><th class="num">Revest.</th><th class="num">Martelo</th><th class="num">Tricone</th><th>TAG</th>
        <th>Data</th><th class="num">Sacos</th><th class="num">m³</th><th>TAG</th>
        <th>Período</th><th>Medição</th><th>Obs.</th><th></th></tr>
    </thead>
    <tbody>${trs}</tbody>
    <tfoot><tr><td colspan="4"><strong>Totais</strong></td><td class="num"></td><td class="num"><strong>${f2(soma("compTotal"))}</strong></td><td></td>
      <td class="num"><strong>${f2(soma("revest"))}</strong></td><td class="num"><strong>${f2(soma("martelo"))}</strong></td><td class="num"><strong>${f2(soma("tricone"))}</strong></td><td></td>
      <td></td><td class="num"><strong>${f0(soma("sacos"))}</strong></td><td class="num"><strong>${f2(soma("m3"))}</strong></td><td colspan="5"></td></tr></tfoot>
  </table></div>`;
  cont.innerHTML = html;

  cont.querySelectorAll(".raiz-edit").forEach(b => b.addEventListener("click", () => {
    const e = _estacas.find(x => x.numero === b.dataset.num);
    if(e) abrirModalEstaca(e.id);
  }));
  $("btn-raiz-csv")?.addEventListener("click", () => {
    const cab = ["Local","Bloco","Estaca","Diametro_mm","Comp_estimado_m","Comp_final_m","Comp_total_exec_m","Data_execucao","Revestimento_m","Martelo_m","Tricone_m","TAG_exec","Data_injecao","Sacos","m3","TAG_injecao","Periodo","Medicao","Observacao"];
    const cel = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const csv = [cab.join(";")].concat(linhas.map(l => [l.local, l.bloco, l.numero, l.diametro, l.estimado, l.compFinal, l.compTotal, l.dataExec ? String(l.dataExec).slice(0,10) : "", l.revest, l.martelo, l.tricone, l.tagExec, l.dataInj ? String(l.dataInj).slice(0,10) : "", l.sacos ?? l.sacosTxt, l.m3, l.tagInj, l.periodo, l.medicoes, l.obs].map(cel).join(";"))).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `acompanhamento-raiz-${(obraEditId || "obra").slice(0, 8)}-${hojeISO()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

function renderEstacas(){
  atualizarFiltroLocal();
  atualizarBotaoRaiz();
  // Mini-stats — contagem literal (todas as estacas cadastradas contam, incluindo BB)
  const total = _estacas.length;
  const exec  = _estacas.filter(e => e.status === "executada").length;
  const metragem = _estacas
    .filter(e => e.status === "executada")
    .reduce((s, e) => s + (Number(e.profundidade_m) || 0), 0);
  const pct = total ? Math.round((exec / total) * 100) : 0;
  $("est-stat-total").textContent      = total;
  $("est-stat-executadas").textContent = exec;
  $("est-stat-pct").textContent        = `${pct}%`;
  $("est-stat-metragem").textContent   = `${num(metragem)} m`;

  // Toggle vistas
  const wrapLista  = $("est-conteudo");
  const wrapPlanta = $("est-planta-wrap");
  const wrapRaiz   = $("est-raiz-wrap");
  const mostrar = (el, on) => { if(el) el.style.display = on ? "" : "none"; };
  if(_estView === "planta"){
    mostrar(wrapLista, false); mostrar(wrapRaiz, false); mostrar(wrapPlanta, true);
    renderPlantaSVG();
    return;
  }
  if(_estView === "raiz"){
    mostrar(wrapLista, false); mostrar(wrapPlanta, false); mostrar(wrapRaiz, true);
    renderAcompanhamentoRaiz();
    return;
  }
  mostrar(wrapLista, true); mostrar(wrapPlanta, false); mostrar(wrapRaiz, false);

  const cont = wrapLista;
  if(!cont) return;

  // Filtros
  const fStatus = $("est-f-status")?.value || "";
  const fTipo   = $("est-f-tipo")?.value || "";
  const fLocal  = $("est-f-local")?.value || "";
  const termo   = ($("est-busca")?.value || "").trim().toLowerCase();
  const filtradas = _estacas.filter(e => {
    if(fStatus && e.status !== fStatus) return false;
    if(fTipo && e.tipo !== fTipo) return false;
    if(fLocal && (e.local || "") !== fLocal) return false;
    if(termo){
      const alvo = `${e.numero||""} ${e.observacoes||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });

  if(!filtradas.length){
    cont.innerHTML = `<p class="vazio">${total ? "Nenhuma estaca encontrada para os filtros." : "Nenhuma estaca cadastrada. Use \"+ Nova\" ou \"📄 Importar PDF\"."}</p>`;
    return;
  }
  const linhas = filtradas.map(e => {
    const st = ESTACA_STATUS[e.status] || { label: e.status, cor: "cinza" };
    // Badge ALTERADO (estilo Maya). Prioridade:
    //   1) Alteração manual registrada (alterada_em) — sempre aparece, mesmo com 1 execução
    //   2) Tem refuro vinculado — verde
    //   3) Múltiplas execuções sem refuro — laranja "suspeito"
    let badgeAlt = "";
    if(e.alterada_em){
      const quando = new Date(e.alterada_em).toLocaleDateString("pt-BR");
      const motivo = e.alteracao_motivo || "Alteração manual";
      badgeAlt = `<span class="badge-alterado badge-alterado-suspeito" title="Alterada em ${quando} · ${esc(motivo)}">⚠️ ALTERADO</span>`;
    } else if(e._execs_refuros > 0){
      badgeAlt = `<span class="badge-alterado" title="Estaca tem ${e._execs_refuros} refuro(s) registrado(s)">🔄 REFURO</span>`;
    } else if(e._alterada){
      badgeAlt = `<span class="badge-alterado badge-alterado-suspeito" title="${e._execs_total} execuções vinculadas — verificar na Conferência">⚠️ ALTERADO</span>`;
    }
    return `<tr data-id="${esc(e.id)}">
      <td>${esc(e.numero)} ${badgeAlt}</td>
      <td class="meta">${esc([e.local, e.bloco].filter(Boolean).join(" · ") || "—")}</td>
      <td>${esc(ESTACA_TIPOS[e.tipo] || e.tipo || "—")}</td>
      <td class="num">${e.diametro_mm != null ? num(e.diametro_mm) : "—"}</td>
      <td class="num">${e.profundidade_m != null ? num(e.profundidade_m) : "—"}</td>
      <td>${dataBR(e.data_execucao)}</td>
      <td><span class="tag ${st.cor}">${esc(st.label)}</span></td>
      <td class="col-acao">
        <button type="button" class="btn-sec btn-sm est-edit" data-id="${esc(e.id)}">✏️</button>
        <button type="button" class="btn-sec btn-sm est-del txt-perigo" data-id="${esc(e.id)}">🗑️</button>
      </td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nº</th><th>Local · bloco</th><th>Tipo</th><th class="num">Ø (mm)</th><th class="num">Prof. (m)</th>
      <th>Execução</th><th>Status</th><th class="col-acao"></th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;

  cont.querySelectorAll(".est-edit").forEach(b => {
    b.addEventListener("click", () => abrirModalEstaca(b.dataset.id));
  });
  cont.querySelectorAll(".est-del").forEach(b => {
    b.addEventListener("click", () => excluirEstaca(b.dataset.id));
  });
}

/* ---------- Modal Estaca (nova / editar) ---------- */
function abrirModalEstaca(id){
  _estacaEdit = id ? _estacas.find(e => e.id === id) : null;
  const e = _estacaEdit || {};
  $("est-modal-titulo").textContent = id ? `Estaca ${e.numero}` : "Nova estaca";
  $("est-numero").value         = e.numero || "";
  $("est-tipo").value           = e.tipo || "helice_continua";
  $("est-status").value         = e.status || "prevista";
  $("est-diametro").value       = e.diametro_mm ?? "";
  $("est-profundidade").value   = e.profundidade_m ?? "";
  $("est-cota-topo").value      = e.cota_topo ?? "";
  $("est-cota-ponta").value     = e.cota_ponta ?? "";
  $("est-volume").value         = e.volume_concreto_m3 ?? "";
  $("est-data").value           = e.data_execucao || "";
  $("est-bloco").value          = e.bloco || "";
  $("est-local").value          = e.local || "";
  $("est-ordem").value          = e.ordem_execucao ?? "";
  $("est-coord-x").value        = e.coord_x ?? "";
  $("est-coord-y").value        = e.coord_y ?? "";
  $("est-obs").value            = e.observacoes || "";
  preencherSelectMaquinasEstaca("est-equipamento", e.equipamento_id);
  $("est-modal").style.display = "flex";
}

/* Preenche um select com as máquinas (equipamentos) disponíveis */
async function preencherSelectMaquinasEstaca(selId, selecionado){
  const sel = $(selId);
  if(!sel) return;
  if(!sel.dataset.carregado){
    const { data } = await sb.from("equipamentos")
      .select("id,codigo,nome").eq("ativo", true).order("codigo");
    sel.innerHTML = `<option value="">— nenhuma —</option>` +
      (data || []).map(eq => `<option value="${esc(eq.id)}">${esc(eq.codigo || eq.nome)}${eq.codigo && eq.nome ? " — " + esc(eq.nome) : ""}</option>`).join("");
    sel.dataset.carregado = "1";
  }
  sel.value = selecionado || "";
}

function fecharModalEstaca(){
  $("est-modal").style.display = "none";
  _estacaEdit = null;
}

async function salvarEstaca(){
  if(!obraEditId){ aviso("app-aviso","Salve a obra antes de adicionar estacas.","erro"); return; }
  // Mesma normalização (UPPER + trim) dos imports e do trigger SQL: sem isso,
  // "b12" manual e "B12" importada coexistiam (UNIQUE é case-sensitive).
  const numero = normalizarNumeroEstacaEstacas($("est-numero").value);
  if(!numero){ aviso("app-aviso","Informe o nº da estaca.","erro"); return; }

  const reg = {
    obra_id: obraEditId,
    numero,
    tipo: $("est-tipo").value,
    status: $("est-status").value,
    diametro_mm: $("est-diametro").value !== "" ? Number($("est-diametro").value) : null,
    profundidade_m: $("est-profundidade").value !== "" ? Number($("est-profundidade").value) : null,
    cota_topo: $("est-cota-topo").value !== "" ? Number($("est-cota-topo").value) : null,
    cota_ponta: $("est-cota-ponta").value !== "" ? Number($("est-cota-ponta").value) : null,
    volume_concreto_m3: $("est-volume").value !== "" ? Number($("est-volume").value) : null,
    data_execucao: $("est-data").value || null,
    bloco: $("est-bloco").value.trim() || null,
    local: $("est-local").value.trim() || null,
    equipamento_id: $("est-equipamento").value || null,
    ordem_execucao: $("est-ordem").value !== "" ? Number($("est-ordem").value) : null,
    coord_x: $("est-coord-x").value !== "" ? Number($("est-coord-x").value) : null,
    coord_y: $("est-coord-y").value !== "" ? Number($("est-coord-y").value) : null,
    observacoes: $("est-obs").value.trim() || null
  };

  let result;
  if(_estacaEdit && _estacaEdit.id){
    result = await sb.from("estacas").update(reg).eq("id", _estacaEdit.id);
  } else {
    result = await sb.from("estacas").insert(reg);
  }
  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    if(m.includes("duplicate") || m.includes("unique"))
      aviso("app-aviso","Já existe uma estaca com esse número nesta obra.","erro");
    else
      aviso("app-aviso","Não foi possível salvar: "+result.error.message,"erro");
    return;
  }
  aviso("app-aviso","Estaca salva.","ok");
  fecharModalEstaca();
  await carregarEstacasDaObra(obraEditId);
}

async function excluirEstaca(id){
  if(!confirm("Excluir esta estaca? A ação não pode ser desfeita.")) return;
  const { error } = await sb.from("estacas").delete().eq("id", id);
  if(error){ aviso("app-aviso","Não foi possível excluir: "+error.message,"erro"); return; }
  aviso("app-aviso","Estaca excluída.","ok");
  await carregarEstacasDaObra(obraEditId);
}

/* ---------- Importação via PDF ---------- */
async function importarEstacasPDF(){
  const fileInput = $("est-import-file");
  if(!fileInput.files || !fileInput.files[0]){
    avisoImport("Selecione um PDF.","erro");
    return;
  }
  if(!obraEditId){
    avisoImport("Salve a obra primeiro.","erro");
    return;
  }
  const btn = $("btn-est-extrair");
  btn.disabled = true;
  btn.textContent = "🤖 Extraindo... (~30s)";

  try {
    // Converte PDF → base64 (FileReader é nativo e não estoura a pilha como o
    // loop byte a byte). Limite de 20 MB: acima disso a Edge Function/IA falha
    // com erro genérico — melhor avisar antes de enviar.
    const file = fileInput.files[0];
    const LIMITE_MB = 20;
    if(file.size > LIMITE_MB * 1024 * 1024){
      avisoImport(`PDF com ${(file.size/1048576).toFixed(1)} MB — o limite é ${LIMITE_MB} MB. Exporte só as folhas de locação/tabela de estacas.`,"erro");
      return;
    }
    const base64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload  = () => res(String(fr.result).split(",")[1] || "");
      fr.onerror = () => rej(new Error("Falha ao ler o arquivo."));
      fr.readAsDataURL(file);
    });

    // Chama Edge Function (extrai body mesmo em erro pra ver mensagem real)
    const { data, error } = await sb.functions.invoke("extrair-estacas-pdf", {
      body: { pdf_base64: base64, obra_id: obraEditId }
    });
    if(error){
      // supabase-js esconde o body de erro; tenta lê-lo via ctx.context
      let detalhe = error.message || "";
      try {
        if(error.context && typeof error.context.json === "function"){
          const body = await error.context.json();
          if(body){
            detalhe = body.error || JSON.stringify(body);
            if(body.sugestao) detalhe += "\n💡 " + body.sugestao;
            if(body.stop_reason) detalhe += " (motivo: " + body.stop_reason + ")";
            if(body.detalhes) detalhe += "\n" + body.detalhes;
          }
        }
      } catch(_e) { /* ignora */ }
      throw new Error(detalhe);
    }
    if(data && data.error){
      let msg = data.error;
      if(data.sugestao) msg += "\n💡 " + data.sugestao;
      throw new Error(msg);
    }

    const estacas = data.estacas || [];
    if(!estacas.length){
      avisoImport("A IA não encontrou estacas neste PDF. Tente outro arquivo ou cadastre manualmente.","erro");
      return;
    }
    _importPreview = estacas.map(extrairCoordsDaObservacao);
    _importUnidade = FATOR_UNIDADE[data.unidade_coordenadas] ? data.unidade_coordenadas : unidadeSugeridaCoords(_importPreview);
    // Local do projeto (prancha inteira de um local): aplica às estacas que vieram sem
    if(data.local_detectado) _importPreview.forEach(e => { if(!e.local) e.local = data.local_detectado; });
    // Junta aviso da heurística (se houver) às observações da IA
    let obsCombinadas = data.observacoes || "";
    if(data._aviso_confusao){
      obsCombinadas = `⚠️ ${data._aviso_confusao}\n\n${obsCombinadas}`;
    }
    renderImportPreview(obsCombinadas, data._meta);
    avisoImport(`IA extraiu ${estacas.length} estacas. Revise antes de importar.`, "ok");
  } catch(err){
    avisoImport("Erro ao extrair: " + err.message,"erro");
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 Extrair com IA";
  }
}

function renderImportPreview(observacoes, meta, contId = "est-import-preview-conteudo", wrapId = "est-import-preview"){
  if($(wrapId)) $(wrapId).style.display = "";
  const temCoord = _importPreview.some(e => e.coord_x != null || e.coord_y != null);
  // Unidade das coordenadas: detectada (IA/heurística) e confirmada pela pessoa; vale para a obra inteira
  let blocoUnidade = "";
  if(temCoord){
    const sug = _importUnidade || unidadeSugeridaCoords(_importPreview) || _unidadeCoord || "mm";
    const opt = (v, l) => `<option value="${v}"${v === sug ? " selected" : ""}>${l}</option>`;
    const aviso_ = (sug !== _unidadeCoord) ? ` <span style="color:var(--aviso-txt);">— a obra estava em <strong>${esc(_unidadeCoord)}</strong>; ao importar, a obra passa para a unidade escolhida.</span>` : "";
    blocoUnidade = `<div style="background:var(--marca-50);border-left:3px solid var(--marca-600);padding:8px 12px;margin-bottom:10px;font-size:var(--txt-sm);">
      📏 <strong>Unidade das coordenadas:</strong>
      <select id="import-unidade" style="margin:0 6px;">${opt("m","metros (ex.: 4253,94)")}${opt("cm","centímetros (ex.: 425394)")}${opt("mm","milímetros (ex.: 4253940)")}</select>
      <span class="meta">detectada: ${esc(sug)}</span>${aviso_}
    </div>`;
  }
  const obs = observacoes ? `<p style="font-size:var(--txt-sm);color:var(--txt-fraco);margin:0 0 8px;"><b>Notas da IA:</b> ${esc(observacoes)}</p>` : "";
  const metaTxt = meta ? `<p style="font-size:var(--txt-xs);color:var(--txt-sutil);margin:0 0 8px;">Modelo: ${esc(meta.modelo)} · Tokens: ${meta.tokens_input}/${meta.tokens_output}</p>` : "";

  // Conta quantas precisam de cada campo
  const semDiam = _importPreview.filter(e => e.diametro_mm == null).length;
  const semProf = _importPreview.filter(e => e.profundidade_m == null).length;
  const semTipo = _importPreview.filter(e => !e.tipo || e.tipo === "outro").length;
  const alerta = (semDiam || semProf || semTipo)
    ? `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:8px 12px;margin-bottom:10px;font-size:var(--txt-sm);">
        ⚠️ A IA não extraiu tudo:
        ${semDiam ? `<strong>${semDiam}</strong> sem diâmetro · ` : ""}
        ${semProf ? `<strong>${semProf}</strong> sem profundidade · ` : ""}
        ${semTipo ? `<strong>${semTipo}</strong> sem tipo definido` : ""}
        — use a barra abaixo pra aplicar valores em lote.
      </div>` : "";

  const COLUNAS_LBL = {
    numero: "Nº da estaca",
    local: "Local",
    bloco: "Bloco",
    tipo: "Tipo",
    diametro_mm: "Diâmetro (mm)",
    profundidade_m: "Profundidade (m)",
    observacoes: "Observações"
  };

  // Barra de reorganização de colunas
  const reorganizador = `
    <div style="background:#f0f7ff;border:1px solid #b6d4f5;border-radius:6px;padding:10px 12px;margin-bottom:10px;">
      <div style="font-size:var(--txt-sm);color:var(--marca-600);margin-bottom:8px;font-weight:600;">🔀 Reorganizar colunas (se a IA interpretou errado)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
        <div>
          <label class="meta bloco">Coluna A</label>
          <select id="reorg-a" class="col-xl">
            ${Object.entries(COLUNAS_LBL).map(([v,l],i) => `<option value="${v}" ${i===0?"selected":""}>${esc(l)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="meta bloco">Ação</label>
          <select id="reorg-acao" class="col-xl">
            <option value="swap">↔ Trocar A com B</option>
            <option value="mover">→ Mover A para B (limpa A)</option>
            <option value="copiar">⎘ Copiar A para B</option>
            <option value="limpar">🗑️ Limpar coluna A</option>
          </select>
        </div>
        <div>
          <label class="meta bloco">Coluna B</label>
          <select id="reorg-b" class="col-xl">
            ${Object.entries(COLUNAS_LBL).map(([v,l],i) => `<option value="${v}" ${i===1?"selected":""}>${esc(l)}</option>`).join("")}
          </select>
        </div>
        <button type="button" class="btn" id="btn-reorg-aplicar" style="padding:5px 12px;background:var(--marca-600);">Aplicar</button>
        <button type="button" class="btn-sec" id="btn-reorg-rapido" style="padding:5px 12px;" title="Atalho: troca Nº e Bloco">↔ Trocar Nº ↔ Bloco</button>
      </div>
    </div>`;

  // Barra de mass-edit
  const massEdit = `
    <div style="background:var(--sup-2);border:1px solid var(--borda-forte);border-radius:6px;padding:10px 12px;margin-bottom:10px;">
      <div style="font-size:var(--txt-sm);color:var(--txt-sec);margin-bottom:8px;font-weight:600;">📋 Aplicar a TODAS as estacas</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
        <div>
          <label class="meta bloco">Diâmetro (mm)</label>
          <input id="mass-diam" type="number" step="0.1" min="0" placeholder="ex.: 400" class="col-md"/>
        </div>
        <div>
          <label class="meta bloco">Profundidade (m)</label>
          <input id="mass-prof" type="number" step="0.01" min="0" placeholder="ex.: 14.5" class="col-md"/>
        </div>
        <div>
          <label class="meta bloco">Tipo</label>
          <select id="mass-tipo" class="col-xl">
            <option value="">— não alterar —</option>
            ${Object.entries(ESTACA_TIPOS).map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join("")}
          </select>
        </div>
        <label style="font-size:var(--txt-xs);color:var(--txt-fraco);display:flex;align-items:center;gap:4px;margin-bottom:6px;">
          <input type="checkbox" id="mass-so-vazios" checked />
          Só os vazios
        </label>
        <button type="button" class="btn" id="btn-mass-aplicar" style="padding:5px 12px;">Aplicar</button>
      </div>
    </div>`;

  const linhas = _importPreview.map((e, idx) => {
    const semDiamHl = e.diametro_mm == null ? 'style="background:var(--aviso-bg);"' : "";
    const semProfHl = e.profundidade_m == null ? 'style="background:var(--aviso-bg);"' : "";
    return `<tr>
      <td><input type="text" value="${esc(e.numero||"")}" data-idx="${idx}" data-field="numero" class="prev-input col-xs"/></td>
      <td><input type="text" value="${esc(e.local||"")}" data-idx="${idx}" data-field="local" class="prev-input col-sm" placeholder="local"/></td>
      <td><input type="text" value="${esc(e.bloco||"")}" data-idx="${idx}" data-field="bloco" class="prev-input col-xs"/></td>
      <td>
        <select data-idx="${idx}" data-field="tipo" class="prev-input">
          ${Object.entries(ESTACA_TIPOS).map(([v,l]) => `<option value="${v}" ${e.tipo===v?"selected":""}>${esc(l)}</option>`).join("")}
        </select>
      </td>
      <td ${semDiamHl}><input type="number" step="0.1" value="${esc(e.diametro_mm ?? "")}" data-idx="${idx}" data-field="diametro_mm" class="prev-input col-xs"/></td>
      <td ${semProfHl}><input type="number" step="0.01" value="${esc(e.profundidade_m ?? "")}" data-idx="${idx}" data-field="profundidade_m" class="prev-input col-xs"/></td>
      ${temCoord ? `
      <td><input type="number" step="any" value="${esc(e.coord_x ?? "")}" data-idx="${idx}" data-field="coord_x" class="prev-input col-xs"/></td>
      <td><input type="number" step="any" value="${esc(e.coord_y ?? "")}" data-idx="${idx}" data-field="coord_y" class="prev-input col-xs"/></td>` : ""}
      <td><input type="text" value="${esc(e.observacoes||"")}" data-idx="${idx}" data-field="observacoes" class="prev-input"/></td>
      <td><button type="button" class="btn-sec btn-sm prev-del txt-perigo" data-idx="${idx}">×</button></td>
    </tr>`;
  }).join("");

  $(contId).innerHTML = `
    ${obs}${metaTxt}${blocoUnidade}${alerta}${reorganizador}${massEdit}
    <div class="tabela-rola">
      <table>
        <thead><tr>
          <th>Nº</th><th>Local</th><th>Bloco</th><th>Tipo</th><th>Ø (mm)</th><th>Prof. (m)</th>${temCoord ? "<th>X</th><th>Y</th>" : ""}<th>Obs.</th><th></th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <p style="margin-top:8px;font-size:var(--txt-sm);color:var(--txt-fraco);">${_importPreview.length} estacas${temCoord ? " (com coordenadas)" : " extraídas"}. Edite o que precisar antes de importar. <span style="background:var(--aviso-bg);padding:1px 6px;">células amarelas</span> = campos vazios.</p>
  `;

  // listeners de edição inline
  $(contId).querySelectorAll(".prev-input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      let v = e.target.value;
      if(field === "diametro_mm" || field === "profundidade_m" || field === "coord_x" || field === "coord_y") v = v !== "" ? Number(v) : null;
      _importPreview[idx][field] = v;
    });
  });
  $(contId).querySelectorAll(".prev-del").forEach(b => {
    b.addEventListener("click", (e) => {
      _importPreview.splice(Number(e.target.dataset.idx), 1);
      renderImportPreview(observacoes, meta, contId, wrapId);
    });
  });

  // Reorganizador de colunas
  function aplicarReorg(acao, a, b){
    if(a === b && acao !== "limpar"){
      aviso("app-aviso","Escolha colunas diferentes pra A e B.","erro");
      return;
    }
    _importPreview.forEach(e => {
      const valA = e[a];
      const valB = e[b];
      if(acao === "swap"){ e[a] = valB; e[b] = valA; }
      else if(acao === "mover"){ e[b] = valA; e[a] = (a === "diametro_mm" || a === "profundidade_m") ? null : ""; }
      else if(acao === "copiar"){ e[b] = valA; }
      else if(acao === "limpar"){ e[a] = (a === "diametro_mm" || a === "profundidade_m") ? null : ""; }
    });
    const labelAcao = { swap: "Trocadas", mover: "Movidas", copiar: "Copiadas", limpar: "Limpas" }[acao];
    aviso("app-aviso", `${labelAcao} colunas em ${_importPreview.length} linhas.`, "ok");
    renderImportPreview(observacoes, meta, contId, wrapId);
  }
  $("btn-reorg-aplicar")?.addEventListener("click", () => {
    aplicarReorg($("reorg-acao").value, $("reorg-a").value, $("reorg-b").value);
  });
  $("btn-reorg-rapido")?.addEventListener("click", () => {
    aplicarReorg("swap", "numero", "bloco");
  });

  // Mass-edit
  $("btn-mass-aplicar")?.addEventListener("click", () => {
    const soVazios = $("mass-so-vazios").checked;
    const vDiam = $("mass-diam").value !== "" ? Number($("mass-diam").value) : null;
    const vProf = $("mass-prof").value !== "" ? Number($("mass-prof").value) : null;
    const vTipo = $("mass-tipo").value || null;
    if(vDiam == null && vProf == null && !vTipo){
      aviso("app-aviso","Preencha pelo menos um campo pra aplicar.","erro");
      return;
    }
    let alterados = 0;
    _importPreview.forEach(e => {
      if(vDiam != null && (!soVazios || e.diametro_mm == null)){ e.diametro_mm = vDiam; alterados++; }
      if(vProf != null && (!soVazios || e.profundidade_m == null)){ e.profundidade_m = vProf; }
      if(vTipo && (!soVazios || !e.tipo || e.tipo === "outro")){ e.tipo = vTipo; }
    });
    aviso("app-aviso", `Aplicado a ${alterados || _importPreview.length} estacas.`, "ok");
    renderImportPreview(observacoes, meta, contId, wrapId);
  });
}

/* Aviso visível dentro do modal de import aberto (PDF ou DXF) — o app-aviso do topo
   fica atrás do modal e a pessoa não vê o erro ("parecia que não tinha clicado"). */
function avisoImport(msg, tipo){
  aviso("app-aviso", msg, tipo);
  const alvo = ($("est-dxf-modal")?.style.display !== "none" && $("est-dxf-modal")?.style.display !== "") ? $("est-dxf-aviso")
             : ($("est-import-modal")?.style.display !== "none" && $("est-import-modal")?.style.display !== "") ? $("est-import-aviso") : null;
  const el = alvo || $("est-import-aviso");
  if(!el) return;
  el.textContent = msg;
  el.className = "aviso " + tipo;
  if(tipo === "ok") setTimeout(() => { el.className = "aviso"; el.textContent = ""; }, 4000);
  el.scrollIntoView({ block: "nearest" });
}
function limparAvisoImport(){
  ["est-import-aviso","est-dxf-aviso"].forEach(id => { const el = $(id); if(el){ el.textContent = ""; el.className = "aviso"; } });
}

async function confirmarImportEstacas(){
  if(!_importPreview.length){ avisoImport("Nada a importar.","erro"); return; }
  if(!obraEditId){ avisoImport("Obra não identificada.","erro"); return; }
  if(!confirm(`Importar ${_importPreview.length} estacas pra esta obra?`)) return;

  const regs = _importPreview
    .filter(e => e.numero)
    .map(e => ({
      obra_id: obraEditId,
      numero: normalizarNumeroEstacaEstacas(e.numero),
      tipo: e.tipo || "outro",
      status: "prevista",
      diametro_mm: e.diametro_mm ?? null,
      profundidade_m: e.profundidade_m ?? null,
      bloco: e.bloco || null,
      local: (e.local || "").trim() || null,
      coord_x: e.coord_x ?? null,
      coord_y: e.coord_y ?? null,
      cota_topo: e.cota_topo ?? null,
      cota_ponta: e.cota_ponta ?? null,
      observacoes: e.observacoes || null
    }));
  if(!regs.length){ avisoImport("Nenhuma estaca válida (todas sem nº).","erro"); return; }

  // Duplicidade = mesmo número NO MESMO LOCAL (projetos de locais diferentes repetem E01…).
  const chave = (r) => String(r.local || "").trim().toUpperCase() + "|" + String(r.numero || "").toUpperCase();
  const existentes = new Set(_estacas.map(chave));
  const vistos = new Set();
  const novos = [], repetidos = [];
  regs.forEach(r => {
    const k = chave(r);
    if(existentes.has(k) || vistos.has(k)) repetidos.push(r); else { vistos.add(k); novos.push(r); }
  });
  if(!novos.length){
    avisoImport(`Todas as ${regs.length} estacas já existem nesta obra no mesmo local — nada foi importado. Se são de outro local/projeto, preencha a coluna Local no preview.`, "erro");
    return;
  }
  if(repetidos.length && !confirm(`${repetidos.length} estaca(s) já existem no mesmo local e serão ignoradas (${repetidos.slice(0,8).map(r => r.numero).join(", ")}${repetidos.length > 8 ? "…" : ""}). Importar as outras ${novos.length}?`)) return;
  regs.length = 0; novos.forEach(r => regs.push(r));

  // Unidade das coordenadas escolhida no preview → obra (a planta converte para metros a partir dela)
  const unSel = $("import-unidade")?.value || _importUnidade;
  if(unSel && FATOR_UNIDADE[unSel] && unSel !== _unidadeCoord && regs.some(r => r.coord_x != null)){
    const { error: errUn } = await sb.from("obras").update({ unidade_coordenadas: unSel }).eq("id", obraEditId);
    if(errUn){ avisoImport("Não foi possível gravar a unidade das coordenadas: " + errUn.message,"erro"); return; }
  }
  const { error } = await sb.from("estacas").insert(regs);
  if(error){
    avisoImport("Erro ao importar: " + error.message,"erro");
    return;
  }
  avisoImport(`${regs.length} estacas importadas com sucesso.`, "ok");
  _importPreview = [];
  fecharModalImport();
  fecharModalDXF();
  await carregarEstacasDaObra(obraEditId);
}

function abrirModalImport(){
  limparAvisoImport();
  if(!obraEditId){
    aviso("app-aviso","Salve a obra antes de importar estacas.","erro");
    return;
  }
  _importPreview = [];
  $("est-import-file").value = "";
  $("est-import-preview").style.display = "none";
  $("est-import-preview-conteudo").innerHTML = "";
  $("est-import-modal").style.display = "flex";
}

function fecharModalImport(){
  $("est-import-modal").style.display = "none";
  _importPreview = [];
}

/* ====================================================================
   IMPORTAÇÃO via DXF (CAD) — parser client-side, sem servidor.
   DWG é binário proprietário da Autodesk; peça ao projetista/CAD para
   exportar em DXF (ou use o ODA File Converter, grátis) antes de importar.
   ==================================================================== */

/* Limpa formatação de MTEXT (\A1;  {\fArial...}  \P  etc) deixando só o texto */
function _limparTextoDXF(s){
  if(!s) return "";
  return String(s)
    .replace(/\\[A-Za-z][^;]*;/g, "")   // \A1;  \fArial|b0;  \H2.5x;
    .replace(/[{}]/g, "")
    .replace(/\\P/g, " ")
    .replace(/\\~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Parser DXF: percorre pares (código, valor) e extrai entidades da seção
   ENTITIES. Retorna { entidades:[{tipo,layer,x,y,r,texto,bloco}], layers:{} } */
function parsearDXF(texto){
  const L = texto.split(/\r\n|\r|\n/);
  const ents = [];
  let cur = null;
  let inEntities = false;
  let esperandoNomeSecao = false;

  for(let i = 0; i + 1 < L.length; i += 2){
    const code = parseInt(L[i], 10);
    if(Number.isNaN(code)) continue;
    const v = (L[i+1] || "").trim();

    if(code === 0){
      if(inEntities && cur){ ents.push(cur); cur = null; }
      if(v === "SECTION"){ esperandoNomeSecao = true; }
      else if(v === "ENDSEC"){ inEntities = false; }
      else if(inEntities){
        cur = { tipo: v, layer: "0", x: null, y: null, r: null, texto: "", bloco: "" };
      }
      continue;
    }
    if(esperandoNomeSecao && code === 2){
      inEntities = (v === "ENTITIES");
      esperandoNomeSecao = false;
      continue;
    }
    if(!inEntities || !cur) continue;
    switch(code){
      case 8:  cur.layer = v; break;
      case 10: cur.x = parseFloat(v); break;
      case 20: cur.y = parseFloat(v); break;
      case 40: cur.r = parseFloat(v); break;
      case 1:  cur.texto = _limparTextoDXF(cur.texto + " " + v); break;
      case 3:  cur.texto = _limparTextoDXF(cur.texto + v); break;
      case 2:  cur.bloco = v; break;   // nome do bloco no INSERT
    }
  }
  if(inEntities && cur) ents.push(cur);

  // Resumo por layer (contagem por tipo relevante)
  const layers = {};
  const TIPOS = ["POINT","CIRCLE","INSERT","TEXT","MTEXT"];
  ents.forEach(e => {
    if(!TIPOS.includes(e.tipo)) return;
    if(e.x == null || e.y == null) return;
    (layers[e.layer] ||= { POINT:0, CIRCLE:0, INSERT:0, TEXT:0, MTEXT:0 });
    layers[e.layer][e.tipo]++;
  });
  return { entidades: ents, layers };
}

async function lerArquivoDXF(){
  const fileInput = $("est-dxf-file");
  if(!fileInput.files || !fileInput.files[0]){
    avisoImport("Selecione um arquivo .dxf.","erro");
    return;
  }
  const file = fileInput.files[0];
  const nome = (file.name || "").toLowerCase();
  if(nome.endsWith(".dwg")){
    avisoImport("Arquivo DWG não é lido diretamente. Exporte como DXF no AutoCAD (SALVARCOMO → DXF) ou use o ODA File Converter (grátis) e envie o .dxf.","erro");
    return;
  }
  try {
    const texto = await file.text();
    _dxfParsed = parsearDXF(texto);
    const layers = _dxfParsed.layers;
    if(!Object.keys(layers).length){
      avisoImport("Nenhuma geometria (POINT/CIRCLE/INSERT/TEXT) encontrada no DXF. Confira se as estacas estão como pontos/círculos/blocos e não como hachura/imagem.","erro");
      return;
    }
    renderDXFConfig();
    avisoImport(`DXF lido: ${_dxfParsed.entidades.length} entidades em ${Object.keys(layers).length} layers. Escolha a layer das estacas.`, "ok");
  } catch(err){
    avisoImport("Erro ao ler DXF: " + err.message,"erro");
  }
}

/* Monta a UI de seleção: qual layer/tipo = estacas, e de onde vêm os rótulos */
function renderDXFConfig(){
  const box = $("est-dxf-config");
  if(!box || !_dxfParsed) return;
  const layers = _dxfParsed.layers;

  // Layers candidatas a geometria (têm POINT/CIRCLE/INSERT)
  const geomLayers = Object.entries(layers)
    .filter(([,c]) => c.POINT + c.CIRCLE + c.INSERT > 0)
    .sort((a,b) => (b[1].POINT+b[1].CIRCLE+b[1].INSERT) - (a[1].POINT+a[1].CIRCLE+a[1].INSERT));
  const textLayers = Object.entries(layers).filter(([,c]) => c.TEXT + c.MTEXT > 0);

  if(!geomLayers.length){
    box.innerHTML = `<div class="dist-aviso alerta">Nenhuma layer com pontos, círculos ou blocos. As estacas podem estar como texto apenas — nesse caso use o import por PDF.</div>`;
    box.style.display = "";
    return;
  }

  const geomOpts = geomLayers.map(([nome, c], i) => {
    const partes = [];
    if(c.POINT)  partes.push(`${c.POINT} pontos`);
    if(c.CIRCLE) partes.push(`${c.CIRCLE} círculos`);
    if(c.INSERT) partes.push(`${c.INSERT} blocos`);
    return `<option value="${esc(nome)}" ${i===0?"selected":""}>${esc(nome)} — ${partes.join(", ")}</option>`;
  }).join("");

  const textOpts = `<option value="__auto__" selected>Automático (texto mais próximo de cada estaca)</option>`
    + textLayers.map(([nome, c]) => `<option value="${esc(nome)}">${esc(nome)} — ${c.TEXT+c.MTEXT} textos</option>`).join("")
    + `<option value="__none__">Sem rótulo (numero em branco)</option>`;

  box.innerHTML = `
    <div style="background:var(--sup-2);border:1px solid var(--borda-forte);border-radius:6px;padding:12px;margin-top:12px;">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end;">
        <div>
          <label class="meta bloco">Layer das estacas</label>
          <select id="dxf-layer-geom" class="col-xl">${geomOpts}</select>
        </div>
        <div>
          <label class="meta bloco">Rótulo (número) vem de</label>
          <select id="dxf-layer-text" class="col-xl">${textOpts}</select>
        </div>
        <label style="font-size:var(--txt-xs);color:var(--txt-fraco);display:flex;align-items:center;gap:4px;margin-bottom:6px;">
          <input type="checkbox" id="dxf-bloco-da-layer" />
          Usar nome da layer como Bloco
        </label>
      </div>
      <p class="meta" style="margin:8px 0 0;">As coordenadas X/Y do CAD entram como estão; a planta faz a auto-escala. A distância mínima usa esses metros de verdade.</p>
      <div class="form-acoes compacta" style="margin-top:10px;">
        <button type="button" class="btn" id="btn-dxf-extrair">📐 Extrair estacas</button>
      </div>
    </div>`;
  box.style.display = "";
  $("btn-dxf-extrair")?.addEventListener("click", extrairEstacasDXF);
}

/* Casa cada geometria (estaca) com o texto mais próximo dentro de um raio */
function extrairEstacasDXF(){
  if(!_dxfParsed){ avisoImport("Leia um DXF primeiro.","erro"); return; }
  const layerGeom = $("dxf-layer-geom")?.value;
  const modoTexto = $("dxf-layer-text")?.value || "__auto__";
  const blocoDaLayer = $("dxf-bloco-da-layer")?.checked;
  const ents = _dxfParsed.entidades;

  const geoms = ents.filter(e =>
    e.layer === layerGeom &&
    ["POINT","CIRCLE","INSERT"].includes(e.tipo) &&
    e.x != null && e.y != null);
  if(!geoms.length){ avisoImport("Nenhuma estaca nessa layer.","erro"); return; }

  let textos = [];
  if(modoTexto !== "__none__"){
    textos = ents.filter(e =>
      ["TEXT","MTEXT"].includes(e.tipo) &&
      e.x != null && e.y != null && e.texto &&
      (modoTexto === "__auto__" || e.layer === modoTexto));
  }

  // Raio de busca do rótulo: metade do espaçamento médio entre estacas
  let raio = Infinity;
  if(geoms.length > 1){
    // diagonal do bbox / sqrt(n) ≈ espaçamento típico
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    geoms.forEach(g => { if(g.x<minX)minX=g.x; if(g.x>maxX)maxX=g.x; if(g.y<minY)minY=g.y; if(g.y>maxY)maxY=g.y; });
    const diag = Math.hypot(maxX-minX, maxY-minY) || 1;
    raio = (diag / Math.sqrt(geoms.length)) * 0.75;
  }

  const usados = new Set();
  const acharTexto = (gx, gy) => {
    let melhor = null, melhorD = Infinity, melhorIdx = -1;
    textos.forEach((t, idx) => {
      if(usados.has(idx)) return;
      const d = Math.hypot(t.x - gx, t.y - gy);
      if(d < melhorD){ melhorD = d; melhor = t; melhorIdx = idx; }
    });
    if(melhor && melhorD <= raio){ usados.add(melhorIdx); return melhor.texto; }
    return "";
  };

  _importPreview = geoms.map(g => {
    const numero = acharTexto(g.x, g.y);
    // círculo: diâmetro em unidades do desenho — não assume mm (deixa o usuário definir)
    return {
      numero: numero || "",
      bloco: blocoDaLayer ? layerGeom : "",
      tipo: "outro",
      diametro_mm: null,
      profundidade_m: null,
      coord_x: g.x,
      coord_y: g.y,
      observacoes: ""
    };
  });

  const semNum = _importPreview.filter(e => !e.numero).length;
  const nota = `${geoms.length} estacas extraídas da layer "${layerGeom}".` +
    (semNum ? ` ${semNum} sem número (preencha na tabela ou pela reorganização).` : "");
  _importUnidade = unidadeSugeridaCoords(_importPreview) || "mm";
  const locDxf = ($("est-dxf-local")?.value || "").trim();
  if(locDxf) _importPreview.forEach(e => { e.local = locDxf; });
  renderImportPreview(nota, null, "est-dxf-preview-conteudo", "est-dxf-preview");
  avisoImport(nota, "ok");
}

function abrirModalDXF(){
  limparAvisoImport();
  if(!obraEditId){
    aviso("app-aviso","Salve a obra antes de importar estacas.","erro");
    return;
  }
  _importPreview = [];
  _dxfParsed = null;
  $("est-dxf-file").value = "";
  $("est-dxf-config").style.display = "none";
  $("est-dxf-config").innerHTML = "";
  $("est-dxf-preview").style.display = "none";
  $("est-dxf-preview-conteudo").innerHTML = "";
  $("est-dxf-modal").style.display = "flex";
}

function fecharModalDXF(){
  $("est-dxf-modal").style.display = "none";
  _importPreview = [];
  _dxfParsed = null;
}

/* ====================================================================
   PLANTA SVG
   ==================================================================== */

/* Extrai bloco de uma estaca (pode estar no campo bloco ou em observacoes "Bloco X · ...") */
function extrairBloco(e){
  if(e.bloco) return e.bloco;
  const obs = e.observacoes || "";
  const m = obs.match(/Bloco\s+([A-Z0-9\-_.]+)/i);
  return m ? m[1] : "";
}

/* Gera posições em grid agrupando por bloco quando estacas não têm coordenadas */
function gerarGridParaSemCoords(estacas){
  // Agrupa por bloco
  const blocos = {};
  estacas.forEach(e => {
    const k = extrairBloco(e) || "_SEM_BLOCO";
    if(!blocos[k]) blocos[k] = [];
    blocos[k].push(e);
  });
  const nomesBlocos = Object.keys(blocos).sort();
  const numBlocos = nomesBlocos.length;

  // Layout: distribui blocos numa grade (até 3 colunas) e dentro do bloco as estacas em mini-grid
  const VIEW_W = 600, VIEW_H = 400;
  const PADDING = 25;
  const colsB = Math.min(3, numBlocos);
  const rowsB = Math.ceil(numBlocos / colsB);
  const blocoW = (VIEW_W - PADDING * 2) / colsB;
  const blocoH = (VIEW_H - PADDING * 2) / rowsB;

  const posicoes = new Map(); // id -> {x, y, blocoNome, blocoOriginX, blocoOriginY, blocoW, blocoH}

  nomesBlocos.forEach((nome, bIdx) => {
    const estsBloco = blocos[nome];
    const bCol = bIdx % colsB;
    const bRow = Math.floor(bIdx / colsB);
    const x0 = PADDING + bCol * blocoW;
    const y0 = PADDING + bRow * blocoH;
    const innerPad = 18;
    const inW = blocoW - innerPad * 2;
    const inH = blocoH - innerPad * 2 - 12; // -12 pro título do bloco
    const n = estsBloco.length;
    const cols = Math.ceil(Math.sqrt(n * (inW / Math.max(inH, 1))));
    const rows = Math.ceil(n / cols);
    const stepX = cols > 1 ? inW / (cols - 1) : 0;
    const stepY = rows > 1 ? inH / (rows - 1) : 0;
    estsBloco.forEach((e, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = x0 + innerPad + (cols === 1 ? inW/2 : c * stepX);
      const y = y0 + innerPad + 12 + (rows === 1 ? inH/2 : r * stepY);
      posicoes.set(e.id, { x, y, blocoNome: nome === "_SEM_BLOCO" ? "" : nome,
        blocoOriginX: x0, blocoOriginY: y0, blocoW, blocoH });
    });
  });
  return posicoes;
}

/* Auto-escala: mapeia coordenadas reais (UTM/metros, valores grandes) para
   o viewBox 600×400, preservando proporção e invertendo o eixo Y (norte pra
   cima). Retorna uma função (x,y) -> {vx, vy}. As coordenadas reais continuam
   intactas nos dados (a validação de distância usa os metros de verdade). */
function _transformCoords(estsComCoord){
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  estsComCoord.forEach(e => {
    const x = Number(e.coord_x), y = Number(e.coord_y);
    if(x < minX) minX = x; if(x > maxX) maxX = x;
    if(y < minY) minY = y; if(y > maxY) maxY = y;
  });
  const VW = 600, VH = 400, PAD = 56;
  const dx = (maxX - minX) || 1, dy = (maxY - minY) || 1;
  const s = Math.min((VW - 2*PAD) / dx, (VH - 2*PAD) / dy);
  const offX = (VW - s*dx) / 2;
  const offY = (VH - s*dy) / 2;
  const tf = (x, y) => ({
    vx: offX + (Number(x) - minX) * s,
    vy: offY + (maxY - Number(y)) * s   // flip Y
  });
  // s = pixels do viewBox por metro; usado para desenhar em escala real
  Object.assign(tf, { s, minX, maxX, minY, maxY, offX, offY });
  return tf;
}

/* ---------- Desenho "de projeto" (escala real) ----------
   Com coordenadas reais a planta deixa de ser um mapa de bolinhas e vira um
   desenho de locação: estaca no diâmetro real, malha em metros com eixos
   N/E, contorno dos blocos, cotas entre vizinhas (vermelhas abaixo da
   distância mínima), barra de escala e norte. Tudo dentro do <g> de
   pan/zoom, então escala e cotas continuam verdadeiras ao dar zoom. */
function raioEstacaPx(e, s){
  const d = Number(e.diametro_mm) || 400;
  return Math.max(6, Math.min(40, (d / 2000) * s));
}
function _passoGrade(s, minPx){
  const cands = [0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
  return cands.find(c => c * s >= (minPx || 36)) || 1000;
}
function _fmtM(v, passo){
  const dec = passo < 1 ? 2 : 0;
  return v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function desenharFundoProjeto(g, ns, tf, ests){
  const s = tf.s;
  const mk = (tag, attrs, cls) => {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if(cls) el.setAttribute("class", cls);
    return el;
  };
  const fundo = mk("g", {}, "planta-fundo");
  g.appendChild(fundo);

  // 1) Malha em metros reais + eixos (E embaixo, N à esquerda)
  const passo = _passoGrade(s);
  const wx0 = tf.minX - tf.offX / s, wx1 = tf.minX + (600 - tf.offX) / s;
  const wy0 = tf.maxY - (400 - tf.offY) / s, wy1 = tf.maxY + tf.offY / s;
  const x0 = Math.floor(wx0 / passo) * passo, y0 = Math.floor(wy0 / passo) * passo;
  let n = 0;
  for(let x = x0; x <= wx1 && n < 400; x += passo, n++){
    const vx = tf(x, 0).vx;
    const forte = Math.round(x / passo) % 5 === 0;
    fundo.appendChild(mk("line", { x1: vx, y1: 0, x2: vx, y2: 400 }, "planta-grid" + (forte ? " forte" : "")));
    if(forte){ const t = mk("text", { x: vx + 2, y: 396 }, "planta-eixo"); t.textContent = "E " + _fmtM(x, passo); fundo.appendChild(t); }
  }
  n = 0;
  for(let y = y0; y <= wy1 && n < 400; y += passo, n++){
    const vy = tf(0, y).vy;
    const forte = Math.round(y / passo) % 5 === 0;
    fundo.appendChild(mk("line", { x1: 0, y1: vy, x2: 600, y2: vy }, "planta-grid" + (forte ? " forte" : "")));
    if(forte){ const t = mk("text", { x: 3, y: vy - 2 }, "planta-eixo"); t.textContent = "N " + _fmtM(y, passo); fundo.appendChild(t); }
  }

  // 2) Contorno dos blocos (caixa das estacas do bloco + folga de 35 cm)
  const porBloco = new Map();
  ests.forEach(e => {
    const b = String(e.bloco || "").trim();
    if(!b) return;
    const k = String(e.local || "") + "|" + b; // BL03 existe em mais de um local
    if(!porBloco.has(k)) porBloco.set(k, []);
    porBloco.get(k).push(e);
  });
  porBloco.forEach((lista, chave) => {
    const nome = chave.split("|")[1];
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    lista.forEach(e => {
      const p = tf(e.coord_x, e.coord_y), r = raioEstacaPx(e, s);
      x1 = Math.min(x1, p.vx - r); x2 = Math.max(x2, p.vx + r);
      y1 = Math.min(y1, p.vy - r); y2 = Math.max(y2, p.vy + r);
    });
    // folga de 35 cm em volta da estaca, limitada para o contorno não sair da área (PAD 56 − raio 40)
    const folga = Math.min(Math.max(8, 0.35 * s), 28);
    fundo.appendChild(mk("rect", { x: x1 - folga, y: y1 - folga, width: (x2 - x1) + 2*folga, height: (y2 - y1) + 2*folga, rx: 2 }, "planta-bloco"));
    // rótulo acima do contorno; se o bloco encosta na borda de cima, vai para dentro
    const ly = (y1 - folga - 3) < 8 ? Math.max(y1 - folga + 9, 9) : (y1 - folga - 3);
    const lx = Math.max(x1 - folga + 2, 3);
    const t = mk("text", { x: lx, y: ly }, "planta-bloco-lbl");
    t.textContent = nome;
    fundo.appendChild(t);
  });

  // 3) Cotas entre vizinhas (2 mais próximas de cada estaca; em obras grandes
  //    só os pares abaixo do mínimo) — vermelho abaixo da distância mínima
  const dist = (a, b) => Math.hypot(Number(a.coord_x) - Number(b.coord_x), Number(a.coord_y) - Number(b.coord_y));
  const todas = ests.length <= 80;
  const pares = new Map();
  for(let i = 0; i < ests.length; i++){
    const viz = [];
    for(let j = 0; j < ests.length; j++){
      if(i === j) continue;
      if((ests[i].local || "") !== (ests[j].local || "")) continue; // cotas só dentro do mesmo local
      const d = dist(ests[i], ests[j]);
      if(todas || d < distMinEntre(ests[i], ests[j])) viz.push({ j, d });
    }
    viz.sort((a, b) => a.d - b.d);
    (todas ? viz.slice(0, 2) : viz).forEach(v => {
      const k = i < v.j ? i + ":" + v.j : v.j + ":" + i;
      if(!pares.has(k)) pares.set(k, { a: ests[i], b: ests[v.j], d: v.d });
    });
  }
  pares.forEach(p => {
    const pa = tf(p.a.coord_x, p.a.coord_y), pb = tf(p.b.coord_x, p.b.coord_y);
    const ra = raioEstacaPx(p.a, s), rb = raioEstacaPx(p.b, s);
    const dx = pb.vx - pa.vx, dy = pb.vy - pa.vy, L = Math.hypot(dx, dy) || 1;
    if(L <= ra + rb + 6) return; // círculos encostados: sem espaço para a cota
    const ux = dx / L, uy = dy / L;
    const x1 = pa.vx + ux * ra, y1 = pa.vy + uy * ra, x2 = pb.vx - ux * rb, y2 = pb.vy - uy * rb;
    // vermelho: fere a locação (3×Ø) · âmbar: abaixo da distância de execução (cura) · cinza: ok
    const loc = distMinLocacao(p.a, p.b);
    const cls = (loc && p.d < loc) ? " perigo" : (p.d < distMinEntre(p.a, p.b) ? " atencao" : "");
    fundo.appendChild(mk("line", { x1, y1, x2, y2 }, "planta-cota" + cls));
    const t = mk("text", { x: (x1 + x2) / 2 - uy * 6, y: (y1 + y2) / 2 + ux * 6 + 2.5 }, "planta-cota-txt" + cls);
    t.textContent = p.d.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    fundo.appendChild(t);
  });

  // 4) Barra de escala (canto inferior esquerdo) + norte (canto superior direito)
  const escM = _passoGrade(s, 60);
  const escPx = escM * s, bx = 14, by = 378;
  fundo.appendChild(mk("line", { x1: bx, y1: by, x2: bx + escPx, y2: by }, "planta-escala"));
  fundo.appendChild(mk("line", { x1: bx, y1: by - 4, x2: bx, y2: by + 4 }, "planta-escala"));
  fundo.appendChild(mk("line", { x1: bx + escPx, y1: by - 4, x2: bx + escPx, y2: by + 4 }, "planta-escala"));
  const te = mk("text", { x: bx + escPx / 2, y: by - 5, "text-anchor": "middle" }, "planta-hud-txt");
  te.textContent = _fmtM(escM, escM) + " m";
  fundo.appendChild(te);
  fundo.appendChild(mk("line", { x1: 582, y1: 30, x2: 582, y2: 12 }, "planta-escala"));
  fundo.appendChild(mk("polygon", { points: "578,16 582,8 586,16" }, "planta-norte"));
  const tn = mk("text", { x: 582, y: 40, "text-anchor": "middle" }, "planta-hud-txt");
  tn.textContent = "N";
  fundo.appendChild(tn);
}

// Duas regras geométricas, independentes da sequência:
//  • LOCAÇÃO (projeto): todo par deve ter d >= fatorLocacao × Ø → abaixo disso é erro de projeto (vermelho)
//  • EXECUÇÃO (cura): pares abaixo de fator × Ø não podem ser executados em seguida pela mesma máquina (âmbar)
function _avisoParesProximos(comCoord){
  if(comCoord.length < 2) return "";
  const dist = (a, b) => Math.hypot(Number(a.coord_x) - Number(b.coord_x), Number(a.coord_y) - Number(b.coord_y));
  // Sanidade da unidade: distâncias (já em metros) todas < 5 cm ou a vizinha mais próxima > 500 m
  // significam que a unidade da obra não bate com a das coordenadas gravadas.
  {
    let dmin = Infinity, dmax = 0;
    for(let i = 0; i < comCoord.length; i++) for(let j = i + 1; j < comCoord.length; j++){
      const d = dist(comCoord[i], comCoord[j]); if(d > 0 && d < dmin) dmin = d; if(d > dmax) dmax = d;
    }
    const sug = dmax > 0 && dmax < 0.05 ? (_unidadeCoord === "mm" ? "m ou cm" : "m")
              : (isFinite(dmin) && dmin > 500 ? (_unidadeCoord === "m" ? "mm ou cm" : "mm") : null);
    if(sug){
      return `<div class="dist-aviso alerta">📏 <strong>Unidade das coordenadas provavelmente errada.</strong> A obra está em <strong>${esc(_unidadeCoord)}</strong>, mas as distâncias entre estacas ficaram ${dmax < 0.05 ? "todas abaixo de 5 cm" : "acima de 500 m"} — as coordenadas parecem estar em <strong>${sug}</strong>. Ajuste em "Regra de distância → Unidade das coordenadas".</div>`;
    }
  }
  const f2 = (n) => n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const locacao = [], execucao = [];
  for(let i = 0; i < comCoord.length; i++){
    for(let j = i + 1; j < comCoord.length; j++){
      const a = comCoord[i], b = comCoord[j];
      if((a.local || "") !== (b.local || "")) continue; // locais diferentes = plantas diferentes
      const d = dist(a, b);
      const loc = distMinLocacao(a, b);
      if(loc && d < loc){ locacao.push({ a, b, d, min: loc }); continue; }
      const exe = distMinEntre(a, b);
      if(d < exe) execucao.push({ a, b, d, min: exe });
    }
  }
  const lista = (arr) => arr.sort((x, y) => x.d - y.d).slice(0, 6)
    .map(p => `<strong>${esc(p.a.numero)}–${esc(p.b.numero)}</strong> ${f2(p.d)} m (mín. ${f2(p.min)})`).join(" · ")
    + (arr.length > 6 ? ` · e mais ${arr.length - 6}` : "");
  const fL = Number(_regraDist.fatorLocacao).toLocaleString("pt-BR");
  let html = "";
  if(locacao.length){
    html += `<div class="dist-aviso alerta">❌ <strong>Locação fora da regra (${fL}×Ø eixo a eixo):</strong> ${locacao.length} par(es) — ${lista(locacao)}. <span class="meta">Confira o projeto ou as coordenadas antes de executar.</span></div>`;
  }
  if(execucao.length){
    html += `<div class="dist-aviso atencao">⚠️ <strong>${execucao.length} par(es) abaixo da distância de execução</strong> (${esc(descreverRegraDist())}): ${lista(execucao)}. <span class="meta">Não podem ser executadas em sequência pela mesma máquina (cura).</span></div>`;
  }
  return html;
}

function renderPlantaSVG(){
  const svg = $("est-planta-svg");
  if(!svg) return;
  const ns = "http://www.w3.org/2000/svg";

  // Aplica filtros (mesma lógica que a lista)
  const fStatus = $("est-f-status")?.value || "";
  const fTipo   = $("est-f-tipo")?.value || "";
  const fLocal  = $("est-f-local")?.value || "";
  const termo   = ($("est-busca")?.value || "").trim().toLowerCase();
  const filtradas = _estacas.filter(e => {
    if(fStatus && e.status !== fStatus) return false;
    if(fTipo && e.tipo !== fTipo) return false;
    if(fLocal && (e.local || "") !== fLocal) return false;
    if(termo){
      const alvo = `${e.numero||""} ${e.observacoes||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  }).map(_coordM); // planta e cotas sempre em metros

  svg.innerHTML = "";

  // Mapa de máquinas presentes (para colorir/legenda por máquina)
  Object.keys(_mapaMaquinas).forEach(k => delete _mapaMaquinas[k]);
  _estacas.forEach(e => {
    if(e.equipamento_id && !_mapaMaquinas[e.equipamento_id]){
      const eq = (_equipamentosCache || []).find(x => x.id === e.equipamento_id);
      _mapaMaquinas[e.equipamento_id] = eq ? { codigo: eq.codigo, nome: eq.nome } : { codigo: "?", nome: "" };
    }
  });
  renderLegendaPlanta();
  renderConflitosDistancia(filtradas);
  preencherRegraDistUI(); // texto da regra depende dos tipos de estaca carregados

  // Grupo que carrega o transform pan/zoom
  const g = document.createElementNS(ns, "g");
  g.setAttribute("id", "planta-g");
  g.setAttribute("transform", `translate(${_plantaState.panX}, ${_plantaState.panY}) scale(${_plantaState.zoom})`);
  svg.appendChild(g);

  // Delegação de eventos: 1 handler para todos os círculos (em vez de 3 por
  // estaca recriados a cada render). Lookup O(1) pelo data-id.
  const porId = new Map(filtradas.map(e => [e.id, e]));
  const alvo = (ev) => {
    const c = ev.target && ev.target.closest ? ev.target.closest(".estaca-circ") : null;
    return c ? porId.get(c.dataset.id) : null;
  };
  g.addEventListener("click", (ev) => {
    const e = alvo(ev);
    if(!e) return;
    ev.stopPropagation();
    abrirModalExecucao(e.id);
  });
  g.addEventListener("mouseover", (ev) => { const e = alvo(ev); if(e) mostrarTooltipPlanta(ev, e); });
  g.addEventListener("mouseout",  (ev) => { if(alvo(ev)) esconderTooltipPlanta(); });

  const semCoords = filtradas.filter(e => e.coord_x == null || e.coord_y == null);
  let grid = null;
  let usandoGrid = false;
  if(semCoords.length && semCoords.length === filtradas.length){
    // todas sem coords: usa grid pra todas
    grid = gerarGridParaSemCoords(filtradas);
    usandoGrid = true;
  } else if(semCoords.length){
    // mistura: grid só pras sem coord (posiciona no rodapé)
    grid = gerarGridParaSemCoords(semCoords);
  }

  if(!filtradas.length){
    const txt = document.createElementNS(ns, "text");
    txt.setAttribute("class", "sem-coordenadas");
    txt.setAttribute("x", "300");
    txt.setAttribute("y", "200");
    txt.textContent = "Nenhuma estaca pra mostrar.";
    g.appendChild(txt);
  }

  // Se usando grid, desenha contornos dos blocos
  if(usandoGrid){
    const blocosVistos = new Set();
    grid.forEach(p => {
      if(blocosVistos.has(p.blocoNome)) return;
      blocosVistos.add(p.blocoNome);
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", p.blocoOriginX + 6);
      rect.setAttribute("y", p.blocoOriginY + 6);
      rect.setAttribute("width", p.blocoW - 12);
      rect.setAttribute("height", p.blocoH - 12);
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", "#cfd8e3");
      rect.setAttribute("stroke-dasharray", "3 3");
      rect.setAttribute("rx", 4);
      g.appendChild(rect);
      if(p.blocoNome){
        const lbl = document.createElementNS(ns, "text");
        lbl.setAttribute("x", p.blocoOriginX + 12);
        lbl.setAttribute("y", p.blocoOriginY + 18);
        lbl.setAttribute("font-size", "9");
        lbl.setAttribute("fill", "#5a6b7d");
        lbl.setAttribute("font-weight", "600");
        lbl.textContent = p.blocoNome;
        g.appendChild(lbl);
      }
    });
  }

  const hoje = hojeISO();

  // Transform de auto-escala a partir das estacas com coordenadas reais
  const comCoordF = filtradas.filter(e => e.coord_x != null && e.coord_y != null);
  const tf = comCoordF.length ? _transformCoords(comCoordF) : null;
  if(tf) desenharFundoProjeto(g, ns, tf, comCoordF);

  // Desenha cada estaca (com coords reais auto-escaladas OU do grid)
  filtradas.forEach(e => {
    let x, y;
    if(e.coord_x != null && e.coord_y != null && tf){
      const p = tf(e.coord_x, e.coord_y);
      x = p.vx; y = p.vy;
    } else if(grid && grid.has(e.id)){
      const p = grid.get(e.id);
      x = p.x; y = p.y;
    } else {
      return;
    }
    const raio = (tf && e.coord_x != null && e.coord_y != null) ? raioEstacaPx(e, tf.s) : 11;
    desenharEstaca(g, ns, e, x, y, hoje, raio);
  });

  // Atualiza barra de progresso (sobre o que está filtrado)
  const total = filtradas.length;
  const exec = filtradas.filter(e => e.status === "executada").length;
  const pct = total ? Math.round((exec/total) * 100) : 0;
  const fill = $("planta-progresso-fill");
  if(fill) fill.style.width = pct + "%";
  // Resumo da planta para leitores de tela (o SVG é decorativo sem isso)
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Planta de locação: ${exec} de ${total} estacas executadas (${pct}%)`);
  const txt = $("planta-progresso-texto");
  if(txt){
    let extra = "";
    const locaisPlanta = new Set(comCoordF.map(e => (e.local || "").trim()));
    if(locaisPlanta.size > 1) extra += ` · 🗂️ ${locaisPlanta.size} locais na mesma planta — filtre por local para ver cada projeto`;
    if(usandoGrid) extra = " · 📐 posições em grid (planta original sem coordenadas)";
    else if(semCoords.length) extra = ` · ${semCoords.length} sem coords no grid auxiliar`;
    txt.textContent = `${exec} de ${total} executadas (${pct}%)${extra}`;
  }
}

/* Legenda da planta: por status (fixa) ou por máquina (dinâmica) */
function renderLegendaPlanta(){
  const box = $("planta-legenda");
  if(!box) return;
  if(_plantaCor === "maquina"){
    const ids = Object.keys(_mapaMaquinas).sort();
    box.innerHTML = ids.map(id => {
      const m = _mapaMaquinas[id];
      return `<span><i style="background:${corDaMaquina(id)}"></i>${esc(m.codigo || m.nome || "?")}</span>`;
    }).join("") || `<span class="meta">nenhuma máquina atribuída às estacas</span>`;
  } else {
    // A amostra da legenda repete o CONTORNO usado nos círculos (cor + forma):
    // quem não distingue as cores ainda separa prevista / em andamento / executada / refurada
    const contorno = {
      prevista: "1.5px solid var(--sup-3)",
      em_execucao: "2px dashed var(--txt-sec)", perfuracao_concluida: "2px dashed var(--txt-sec)", armacao_aplicada: "2px dashed var(--txt-sec)",
      executada: "2.5px solid var(--txt)", refugada: "2.5px dotted var(--txt)"
    };
    box.innerHTML = Object.entries(ESTACA_STATUS)
      .map(([v]) => `<span title="${esc(ESTACA_STATUS[v].label)}"><i style="background:${COR_STATUS[v] || "var(--txt-sutil)"};border:${contorno[v] || "1.5px solid var(--sup-3)"};box-sizing:border-box;"></i>${esc(ESTACA_STATUS[v].label)}</span>`).join("") +
      `<span><i style="background:var(--estaca-hoje)"></i>Hoje</span>`;
  }
}

/* Validação de distância (regra de cura): dentro da sequência de cada
   máquina (ordenada por ordem_execucao), acusa quando uma estaca é
   executada perto demais de outra recém-concretada da mesma máquina.
   Só roda quando há coordenadas; sem elas, orienta como habilitar. */
function renderConflitosDistancia(filtradas){
  const box = $("planta-conflitos");
  if(!box) return;

  const comCoord = _estacas.filter(e => e.coord_x != null && e.coord_y != null).map(_coordM); // em metros
  const comOrdem = _estacas.filter(e => e.ordem_execucao != null && e.equipamento_id);
  const htmlProx = _avisoParesProximos(comCoord);
  if(comCoord.length < 2 || comOrdem.length < 2){
    box.innerHTML = htmlProx + (comCoord.length < 2
      ? `<div class="dist-aviso neutro">📐 Validação de distância inativa — preencha as coordenadas (X/Y) das estacas para ativá-la.</div>`
      : `<div class="dist-aviso neutro">📐 Defina a máquina e a ordem de execução das estacas para validar a distância da sequência.</div>`);
    return;
  }

  const dist = (a, b) => Math.hypot(Number(a.coord_x) - Number(b.coord_x), Number(a.coord_y) - Number(b.coord_y));

  // agrupa por máquina, ordena pela sequência
  const porMaq = {};
  comCoord.forEach(e => {
    if(e.ordem_execucao == null || !e.equipamento_id) return;
    (porMaq[e.equipamento_id] ||= []).push(e);
  });

  const conflitos = [];
  // Para cada estaca, checa contra a ANTERIOR na sequência da mesma máquina
  Object.values(porMaq).forEach(lista => {
    lista.sort((a, b) => a.ordem_execucao - b.ordem_execucao);
    for(let i = 1; i < lista.length; i++){
      if((lista[i].local || "") !== (lista[i - 1].local || "")) continue; // mudou de local/planta
      const d = dist(lista[i], lista[i - 1]);
      const min = distMinEntre(lista[i - 1], lista[i]);
      if(d < min){
        conflitos.push({ a: lista[i - 1], b: lista[i], d, min });
      }
    }
  });

  if(!conflitos.length){
    box.innerHTML = htmlProx + `<div class="dist-aviso ok">✓ Nenhum conflito de distância na sequência (regra ${esc(descreverRegraDist())} entre estacas consecutivas da mesma máquina).</div>`;
    return;
  }
  const itens = conflitos.slice(0, 8).map(c =>
    `<li><strong>${esc(c.b.numero)}</strong> logo após <strong>${esc(c.a.numero)}</strong> — ${c.d.toLocaleString("pt-BR",{maximumFractionDigits:2})} m (mín. ${c.min.toLocaleString("pt-BR",{maximumFractionDigits:2})} m)</li>`).join("");
  const resto = conflitos.length > 8 ? `<li>… e mais ${conflitos.length - 8}.</li>` : "";
  box.innerHTML = htmlProx + `<div class="dist-aviso alerta">
    <strong>⚠️ ${conflitos.length} conflito(s) de distância na sequência</strong>
    <span class="meta">a sequência fura ao lado de uma estaca recém-concretada (regra de cura)</span>
    <ul>${itens}${resto}</ul>
  </div>`;
}

function desenharEstaca(g, ns, e, x, y, hoje, r = 11){
  const ehHoje = (e.data_execucao === hoje);
  let cor;
  if(_plantaCor === "maquina"){
    cor = corDaMaquina(e.equipamento_id);
  } else {
    cor = ehHoje ? COR_HOJE : (COR_STATUS[e.status] || "var(--txt-sutil)");
  }
  const circ = document.createElementNS(ns, "circle");
  circ.setAttribute("class", "estaca-circ");
  circ.setAttribute("cx", x);
  circ.setAttribute("cy", y);
  circ.setAttribute("r", r);
  // via style, e não setAttribute: atributo de apresentação do SVG ignora tokens CSS
  circ.style.fill = cor;
  // Redundância à cor (daltônicos): o CONTORNO codifica o status —
  // prevista: fino e claro · em andamento (execução/perfuração/armação):
  // tracejado · executada: contorno escuro sólido · refurada: tracejado curto
  // escuro. Assim executada ≠ refurada mesmo sem enxergar verde/vermelho.
  const traco = {
    prevista:             { stroke: "var(--sup-0)",   w: "1.5", dash: "" },
    em_execucao:          { stroke: "var(--txt-sec)", w: "2",   dash: "4 2" },
    perfuracao_concluida: { stroke: "var(--txt-sec)", w: "2",   dash: "4 2" },
    armacao_aplicada:     { stroke: "var(--txt-sec)", w: "2",   dash: "4 2" },
    executada:            { stroke: "var(--txt)",     w: "2.5", dash: "" },
    refugada:             { stroke: "var(--txt)",     w: "2.5", dash: "2 2" }
  }[e.status] || { stroke: "var(--sup-0)", w: "1.5", dash: "" };
  circ.style.stroke = traco.stroke;
  circ.style.strokeWidth = traco.w;
  if(traco.dash) circ.setAttribute("stroke-dasharray", traco.dash);
  circ.dataset.id = e.id;
  // Acessível: nome + status lidos pelo leitor de tela; tabindex/role vêm do
  // observer global (core.js) e Enter dispara o click delegado.
  circ.setAttribute("role", "button");
  circ.setAttribute("aria-label", `Estaca ${e.numero || ""}, ${(ESTACA_STATUS[e.status] || {}).label || e.status || ""}`);
  g.appendChild(circ);

  const label = document.createElementNS(ns, "text");
  // Número dentro do círculo quando cabe; acima dele quando a estaca é pequena na escala
  label.setAttribute("class", "estaca-label" + (r < 8 ? " fora" : ""));
  label.setAttribute("x", x);
  label.setAttribute("y", r < 8 ? y - r - 3 : y);
  label.setAttribute("font-size", Math.max(7, Math.min(12, r * 0.85)));
  const so_num = (e.numero || "").replace(/\D/g, "").slice(-3);
  label.textContent = so_num || (e.numero || "").slice(0,3);
  g.appendChild(label);

  // Sem listeners por círculo: click/hover são delegados no <g id="planta-g">
  // (renderPlantaSVG) — antes eram 3 listeners × N estacas a cada tecla da busca.
}

/* ---------- Tooltip ---------- */
function mostrarTooltipPlanta(ev, e){
  let tip = $("est-planta-tooltip");
  if(!tip){
    tip = document.createElement("div");
    tip.id = "est-planta-tooltip";
    $("est-planta-svg-container").appendChild(tip);
  }
  const tipoLbl = ESTACA_TIPOS[e.tipo] || e.tipo || "—";
  const stLbl = (ESTACA_STATUS[e.status] || {}).label || e.status;
  tip.innerHTML = `<strong>${esc(e.numero)}</strong> · ${esc(stLbl)}<br>
    ${esc(tipoLbl)} · Ø ${e.diametro_mm || "?"}mm · ${e.profundidade_m || "?"}m
    ${e.data_execucao ? "<br>Exec: " + dataBR(e.data_execucao) : ""}`;
  const cont = $("est-planta-svg-container").getBoundingClientRect();
  tip.style.left = (ev.clientX - cont.left + 12) + "px";
  tip.style.top  = (ev.clientY - cont.top  + 12) + "px";
}
function esconderTooltipPlanta(){
  const tip = $("est-planta-tooltip");
  if(tip) tip.remove();
}

/* ---------- Pan & Zoom ---------- */
function aplicarPlantaTransform(){
  const g = document.getElementById("planta-g");
  if(g) g.setAttribute("transform",
    `translate(${_plantaState.panX}, ${_plantaState.panY}) scale(${_plantaState.zoom})`);
}
function plantaZoom(delta, cx, cy){
  const novo = Math.max(0.5, Math.min(5, _plantaState.zoom + delta));
  if(cx != null && cy != null){
    // mantém o ponto sob o cursor estável
    _plantaState.panX = cx - (cx - _plantaState.panX) * (novo / _plantaState.zoom);
    _plantaState.panY = cy - (cy - _plantaState.panY) * (novo / _plantaState.zoom);
  }
  _plantaState.zoom = novo;
  aplicarPlantaTransform();
}
function plantaZoomFit(){
  _plantaState = { zoom: 1, panX: 0, panY: 0 };
  aplicarPlantaTransform();
}

function configurarPanZoom(){
  const svg = $("est-planta-svg");
  if(!svg || svg.dataset.panzoom === "1") return;
  svg.dataset.panzoom = "1";

  let dragging = false, lastX = 0, lastY = 0;
  svg.addEventListener("mousedown", (e) => {
    if(e.target.classList && e.target.classList.contains("estaca-circ")) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mousemove", (e) => {
    if(!dragging) return;
    _plantaState.panX += (e.clientX - lastX);
    _plantaState.panY += (e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    aplicarPlantaTransform();
  });
  window.addEventListener("mouseup", () => { dragging = false; });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    plantaZoom(e.deltaY < 0 ? 0.15 : -0.15, cx, cy);
  }, { passive: false });

  // Touch (mobile) - pan com 1 dedo, pinch com 2
  let touchStart = null, pinchDist = null;
  svg.addEventListener("touchstart", (e) => {
    if(e.touches.length === 1){
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if(e.touches.length === 2){
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchDist = Math.sqrt(dx*dx + dy*dy);
    }
  }, { passive: true });
  svg.addEventListener("touchmove", (e) => {
    if(e.touches.length === 1 && touchStart){
      const dx = e.touches[0].clientX - touchStart.x;
      const dy = e.touches[0].clientY - touchStart.y;
      _plantaState.panX += dx;
      _plantaState.panY += dy;
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      aplicarPlantaTransform();
    } else if(e.touches.length === 2 && pinchDist){
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const nova = Math.sqrt(dx*dx + dy*dy);
      const delta = (nova - pinchDist) * 0.005;
      pinchDist = nova;
      _plantaState.zoom = Math.max(0.5, Math.min(5, _plantaState.zoom + delta));
      aplicarPlantaTransform();
    }
  }, { passive: true });
  svg.addEventListener("touchend", () => { touchStart = null; pinchDist = null; });
}

/* ====================================================================
   MODAL DE EXECUÇÃO RÁPIDA (clique na bolinha da planta)
   ==================================================================== */

async function carregarAuxiliaresExec(){
  if(_estacaFuncs.length && _estacaEquips.length) return;
  const [f, eq] = await Promise.all([
    sb.from("funcionarios").select("id,nome").eq("ativo", true).order("nome"),
    sb.from("equipamentos").select("id,codigo,nome").eq("ativo", true).order("codigo")
  ]);
  _estacaFuncs = f.data || [];
  _estacaEquips = eq.data || [];
  // popula selects
  $("exec-equipamento").innerHTML = `<option value="">— nenhum —</option>` +
    _estacaEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome)}</option>`).join("");
  $("exec-operador").innerHTML = `<option value="">— nenhum —</option>` +
    _estacaFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
}

async function abrirModalExecucao(id){
  await carregarAuxiliaresExec();
  const e = _estacas.find(x => x.id === id);
  if(!e) return;
  _estExecId = id;
  $("exec-titulo").textContent = e.numero || "(sem nº)";
  const tipoLbl = ESTACA_TIPOS[e.tipo] || e.tipo || "—";
  $("exec-resumo").innerHTML = `
    <strong>${esc(tipoLbl)}</strong>
    · Ø ${e.diametro_mm || "—"}mm
    · projeto ${e.profundidade_m || "?"}m
    ${e.observacoes ? "<br>" + esc(e.observacoes) : ""}
  `;
  $("exec-status").value = e.status || "prevista";
  $("exec-data").value = e.data_execucao || hojeISO();
  $("exec-profundidade").value = e.profundidade_m ?? "";
  $("exec-volume").value = e.volume_concreto_m3 ?? "";
  $("exec-equipamento").value = e.equipamento_id || "";
  $("exec-operador").value = e.operador_id || "";
  $("exec-obs").value = e.observacoes || "";
  $("est-exec-modal").style.display = "flex";
}

function fecharModalExecucao(){
  $("est-exec-modal").style.display = "none";
  _estExecId = null;
}

async function salvarExecucao(novoStatus){
  if(!_estExecId) return;
  const reg = {
    status: novoStatus || $("exec-status").value,
    data_execucao: $("exec-data").value || null,
    profundidade_m: $("exec-profundidade").value !== "" ? Number($("exec-profundidade").value) : null,
    volume_concreto_m3: $("exec-volume").value !== "" ? Number($("exec-volume").value) : null,
    equipamento_id: $("exec-equipamento").value || null,
    operador_id: $("exec-operador").value || null,
    observacoes: $("exec-obs").value.trim() || null
  };
  const { error } = await sb.from("estacas").update(reg).eq("id", _estExecId);
  if(error){ aviso("app-aviso","Erro ao salvar: "+error.message,"erro"); return; }
  aviso("app-aviso", `Estaca ${(_estacas.find(e=>e.id===_estExecId)||{}).numero || ""} atualizada.`, "ok");
  fecharModalExecucao();
  await carregarEstacasDaObra(obraEditId);
}

/* ====================================================================
   RECONCILIAÇÃO DE ESTACAS ÓRFÃS (execuções sem estaca vinculada)
   ==================================================================== */

let _recOrfas = [];      // execuções órfãs
let _recPrevs = [];      // estacas previstas da obra
let _recVinculos = {};   // { execucao_id: estaca_id_escolhida }
let _confDuplicadas = []; // grupos: [{ numero, estacas:[...] }, ...]
let _confRefuradas = [];  // estacas com status='refurada'
let _confAlteradas = [];  // estacas com 2+ execuções: [{ estaca, execs:[...] }]
let _confAbaAtual = "orfas";

async function carregarContagemReconciliacao(obraId){
  const btn = $("btn-est-reconciliar");
  if(!btn) return;
  // Botão sempre visível quando há obra carregada — permite conferência preventiva
  if(!obraId){ btn.style.display = "none"; return; }
  btn.style.display = "";

  // Conta os 3 tipos de problemas em paralelo
  const [orfasRes, estsRes] = await Promise.all([
    sb.from("rdo_execucao_estaca").select("id, rdo:rdo_id(obra_id)").is("estaca_id", null),
    sb.from("estacas").select("numero,status").eq("obra_id", obraId)
  ]);
  const orfas = (orfasRes.data || []).filter(r => r.rdo && r.rdo.obra_id === obraId);
  const ests = estsRes.data || [];
  // Duplicadas: grupos com mesmo número literal
  const cont = {};
  ests.forEach(e => {
    const k = (e.numero||"").trim().toUpperCase();
    cont[k] = (cont[k]||0) + 1;
  });
  const dups = Object.values(cont).filter(c => c > 1).reduce((s,c) => s + c, 0);
  // Refuradas
  const refs = ests.filter(e => e.status === "refurada").length;

  const total = orfas.length + dups + refs;
  const badge = $("est-reconciliar-badge");
  if(total){
    // Há pendências: badge vermelho com número
    if(badge){
      badge.textContent = total;
      badge.style.display = "";
      badge.style.background = "var(--perigo)";
    }
  } else {
    // Tudo certo: badge verde com ✓ (botão ainda permite abrir pra ver o estado)
    if(badge){
      badge.textContent = "✓";
      badge.style.display = "";
      badge.style.background = "var(--sucesso)";
    }
  }
}

async function abrirModalReconciliacao(){
  if(!obraEditId){ aviso("app-aviso","Salve a obra primeiro.","erro"); return; }
  ["est-reconciliar-conteudo","conf-alteradas-conteudo","conf-duplicadas-conteudo","conf-refuradas-conteudo"].forEach(id => {
    const el = $(id); if(el) el.innerHTML = `<p class="vazio">Carregando...</p>`;
  });
  $("est-reconciliar-modal").style.display = "flex";

  // Busca tudo em paralelo
  const [orfasRes, estsRes, todasExecsRes] = await Promise.all([
    sb.from("rdo_execucao_estaca")
      .select("id, estaca_numero, perfuracao_inicio, profundidade_executada, equipamento_id, rdo:rdo_id(obra_id)")
      .is("estaca_id", null),
    sb.from("estacas")
      .select("id, numero, tipo, diametro_mm, profundidade_m, status, data_execucao, observacoes")
      .eq("obra_id", obraEditId)
      .order("numero"),
    sb.from("rdo_execucao_estaca")
      .select("id, estaca_id, estaca_numero, perfuracao_inicio, profundidade_executada, volume_concreto_m3, modalidade_execucao, rdo:rdo_id(obra_id, data)")
      .not("estaca_id", "is", null)
  ]);

  // Tratamento de erro visível (antes era silencioso e zerava _recPrevs)
  if(orfasRes.error){ aviso("app-aviso","Erro ao carregar órfãs: "+orfasRes.error.message,"erro"); }
  if(estsRes.error){ aviso("app-aviso","Erro ao carregar previstas: "+estsRes.error.message,"erro"); }

  const orfas = (orfasRes.data || []).filter(r => r.rdo && r.rdo.obra_id === obraEditId);
  const previstas = estsRes.data || [];

  _recOrfas = orfas;
  _recPrevs = previstas;
  _recVinculos = {};

  // Detecta duplicadas: agrupa pelo nome LITERAL (UPPER + trim).
  // BB1.1 e B1.1 são estacas distintas — não agrupamos.
  const grupos = {};
  previstas.forEach(e => {
    const k = (e.numero||"").trim().toUpperCase();
    if(!grupos[k]) grupos[k] = [];
    grupos[k].push(e);
  });
  _confDuplicadas = Object.entries(grupos)
    .filter(([_, ests]) => ests.length > 1)
    .map(([num, ests]) => ({ numero: num, estacas: ests }));

  // Refuradas
  _confRefuradas = previstas.filter(e => e.status === "refurada");

  // Estacas alteradas (2+ execuções) — agrupar todas execs por estaca_id e filtrar
  const execsDestaObra = (todasExecsRes.data || []).filter(e => e.rdo && e.rdo.obra_id === obraEditId);
  const porEstaca = {};
  execsDestaObra.forEach(re => {
    if(!porEstaca[re.estaca_id]) porEstaca[re.estaca_id] = [];
    porEstaca[re.estaca_id].push(re);
  });
  _confAlteradas = Object.entries(porEstaca)
    .filter(([_, execs]) => execs.length > 1)
    .map(([estId, execs]) => {
      const estaca = previstas.find(p => p.id === estId);
      // Ordena por data (mais antiga primeiro)
      execs.sort((a,b) => (a.perfuracao_inicio||"").localeCompare(b.perfuracao_inicio||""));
      return { estaca, execs };
    })
    .filter(g => g.estaca); // ignora se a estaca já foi deletada

  // Atualiza badges das abas
  atualizarBadgesConferencia();
  // Renderiza tudo
  renderizarReconciliacao();
  renderizarAlteradas();
  renderizarDuplicadas();
  renderizarRefuradas();
  ativarConfAba(_confAbaAtual);
}

function atualizarBadgesConferencia(){
  const set = (id, n) => {
    const el = $(id);
    if(!el) return;
    el.textContent = n || "";
    el.classList.toggle("zero", n === 0);
  };
  set("conf-tab-orfas-badge", _recOrfas.length);
  set("conf-tab-alt-badge",  _confAlteradas.filter(g => g.execs.some(e => e.modalidade_execucao !== "refuro")).length); // só conta as suspeitas (sem refuro explícito)
  set("conf-tab-dups-badge", _confDuplicadas.reduce((s,g) => s + g.estacas.length, 0));
  set("conf-tab-ref-badge", _confRefuradas.length);
}

function ativarConfAba(nome){
  _confAbaAtual = nome;
  document.querySelectorAll("#conf-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.confTab === nome);
  });
  document.querySelectorAll("#est-reconciliar-modal .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.confTab === nome);
  });
  renderizarAcoesRodape(nome);
}

function renderizarAcoesRodape(aba){
  const rodape = $("conf-acoes-rodape");
  if(!rodape) return;
  if(aba === "orfas"){
    rodape.innerHTML = `
      <button type="button" class="btn-sec" id="btn-est-rec-aplicar-sugestoes" title="Pré-seleciona a sugestão Top em cada linha (você ainda precisa confirmar)">✨ Aplicar todas as sugestões</button>
      <button type="button" class="btn-sec" id="btn-est-rec-criar-todas" title="Cria as estacas previstas que faltam e vincula as execuções correspondentes">➕ Criar todas as previstas faltantes</button>
      <button type="button" class="btn" id="btn-est-rec-confirmar" style="background:var(--sucesso);">✅ Confirmar vínculos selecionados</button>
    `;
    $("btn-est-rec-aplicar-sugestoes")?.addEventListener("click", aplicarTodasSugestoes);
    $("btn-est-rec-criar-todas")?.addEventListener("click", criarTodasPrevistasFaltantes);
    $("btn-est-rec-confirmar")?.addEventListener("click", confirmarReconciliacao);
  } else if(aba === "alteradas"){
    rodape.innerHTML = `<p style="font-size:var(--txt-xs);color:var(--txt-sutil);margin:0;">Use as ações em cada execução extra: ↻ marcar como refuro (legítimo) ou → realocar para outra estaca prevista.</p>`;
  } else if(aba === "duplicadas"){
    rodape.innerHTML = `<p style="font-size:var(--txt-xs);color:var(--txt-sutil);margin:0;">Use as ações em cada grupo (manter / excluir / renomear).</p>`;
  } else if(aba === "refuradas"){
    rodape.innerHTML = `<p style="font-size:var(--txt-xs);color:var(--txt-sutil);margin:0;">Use as ações em cada estaca refurada.</p>`;
  }
}

function fecharModalReconciliacao(){
  $("est-reconciliar-modal").style.display = "none";
}

function renderizarReconciliacao(){
  const cont = $("est-reconciliar-conteudo");
  if(!cont) return;

  if(!_recOrfas.length){
    cont.innerHTML = `<p class="vazio">🎉 Não há execuções órfãs nesta obra.</p>`;
    return;
  }

  // Aviso útil quando não há previstas — não bloqueia, só orienta
  const semPrevistas = !_recPrevs.length;
  const avisoSemPrev = semPrevistas
    ? `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
        ⚠️ Esta obra não tem estacas previstas cadastradas.
        Você pode <strong>criar cada estaca individualmente</strong> (botão <strong>+ Criar</strong> em cada linha)
        ou <strong>todas de uma vez</strong> com o botão verde do rodapé.
       </div>`
    : "";

  // Options das previstas montadas UMA vez (antes: re-escapadas por órfã, com
  // um .find() por item — 100 órfãs × 160 previstas = 16k options recalculadas)
  const optPorId = new Map(_recPrevs.map(p => [p.id,
    `<option value="${esc(p.id)}">${esc(p.numero)}${p.status==='executada' ? " ⚠ já executada" : ""}</option>`]));

  // Pra cada órfã, calcula sugestões e pré-seleciona a melhor
  const linhas = _recOrfas.map(o => {
    const sugs = _recPrevs
      .map(p => ({ p, score: scoreSimilaridade(o.estaca_numero, p.numero) }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0, 5);

    const optionsSugs = sugs.map(({p, score}) => {
      const exec = p.status==='executada' ? " ⚠ já executada" : "";
      const stars = score >= 0.9 ? "★★★" : score >= 0.6 ? "★★" : "★";
      const pct = (score*100).toFixed(0);
      return `<option value="${esc(p.id)}">${stars} ${esc(p.numero)} — ${pct}%${exec}</option>`;
    }).join("");

    const idsSug = new Set(sugs.map(s => s.p.id));
    const optionsTodas = _recPrevs
      .filter(p => !idsSug.has(p.id))
      .map(p => optPorId.get(p.id)).join("");

    const sugestaoTop = sugs[0];
    const sugId = sugestaoTop?.p.id || "";
    const data = o.perfuracao_inicio ? dataBR(o.perfuracao_inicio) : ""; // fatia a string: sem conversão de fuso

    // Badge de confiança ao lado do select
    const badge = sugestaoTop
      ? `<span class="rec-badge rec-badge-${sugestaoTop.score >= 0.9 ? "alta" : sugestaoTop.score >= 0.6 ? "media" : "baixa"}" title="Confiança da sugestão">${(sugestaoTop.score*100).toFixed(0)}%</span>`
      : `<span class="rec-badge rec-badge-zero" title="Nenhuma estaca prevista parecida">sem match</span>`;

    return `<tr data-orfa-id="${esc(o.id)}">
      <td><strong>${esc(o.estaca_numero)}</strong><br><small style="color:var(--txt-sutil);">${esc(data)}</small></td>
      <td class="num">${num(o.profundidade_executada || 0)} m</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;">
          <select class="rec-select" data-orfa-id="${esc(o.id)}" data-sugestao="${esc(sugId)}" style="flex:1;min-width:0;">
            <option value="">— não vincular —</option>
            ${optionsSugs ? `<optgroup label="🤖 Sugestões automáticas">${optionsSugs}</optgroup>` : ""}
            ${optionsTodas ? `<optgroup label="Outras estacas previstas">${optionsTodas}</optgroup>` : ""}
          </select>
          ${badge}
        </div>
      </td>
      <td class="col-acao" style="white-space:nowrap;text-align:right;">
        <button type="button" class="btn btn-sm btn-rec-vincular" data-orfa-id="${esc(o.id)}" style="background:var(--sucesso);" title="Vincular à estaca selecionada no select">✓ Vincular</button>
        <button type="button" class="btn-sec btn-sm btn-rec-criar" data-orfa-id="${esc(o.id)}" data-numero="${esc(o.estaca_numero)}" data-prof="${esc(o.profundidade_executada||'')}" title="Criar estaca prevista com o nome '${esc(o.estaca_numero)}' e vincular">+ Criar</button>
      </td>
    </tr>`;
  }).join("");

  cont.innerHTML = `
    <div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
      ⚠️ <strong>${_recOrfas.length} execução(ões) órfã(s)</strong> nesta obra · <strong>${_recPrevs.length}</strong> estacas previstas no projeto
    </div>
    ${avisoSemPrev}
    <div class="tabela-rola">
      <table>
        <thead><tr>
          <th style="width:18%;">Execução (CSV)</th>
          <th class="num" style="width:12%;">Prof. exec.</th>
          <th>Sugestão · vincular a</th>
          <th class="col-acao" style="width:200px;text-align:right;">Ações</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;

  // Pré-seleciona a sugestão top em cada linha (UX: economiza um clique)
  cont.querySelectorAll(".rec-select").forEach(sel => {
    const sug = sel.dataset.sugestao;
    if(sug){ sel.value = sug; _recVinculos[sel.dataset.orfaId] = sug; }
  });

  cont.querySelectorAll(".rec-select").forEach(sel => {
    sel.addEventListener("change", () => {
      _recVinculos[sel.dataset.orfaId] = sel.value || null;
      destacarConflitosVinculacao();
    });
  });
  // Roda uma vez já após renderizar (caso pré-seleção tenha gerado conflitos)
  destacarConflitosVinculacao();
  cont.querySelectorAll(".btn-rec-vincular").forEach(b => {
    b.addEventListener("click", () => vincularIndividual(b.dataset.orfaId));
  });
  cont.querySelectorAll(".btn-rec-criar").forEach(b => {
    b.addEventListener("click", () => criarPrevistaDaOrfa(b.dataset.orfaId, b.dataset.numero, b.dataset.prof));
  });
}

async function vincularIndividual(orfaId){
  const sel = document.querySelector(`.rec-select[data-orfa-id="${orfaId}"]`);
  const estacaId = sel?.value;
  if(!estacaId){
    aviso("app-aviso","Escolha uma estaca no select antes de vincular.","erro");
    return;
  }
  const { error } = await sb.from("rdo_execucao_estaca")
    .update({ estaca_id: estacaId })
    .eq("id", orfaId);
  if(error){ aviso("app-aviso","Erro ao vincular: "+error.message,"erro"); return; }
  aviso("app-aviso","Execução vinculada.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function criarPrevistaDaOrfa(orfaId, numero, profundidade){
  if(!obraEditId) return;
  const nomeNorm = normalizarNumeroEstacaEstacas(numero);
  // Verifica se já existe (pode ter sido criada por outra órfã na mesma sessão)
  const { data: candidatas } = await sb.from("estacas")
    .select("id,local").eq("obra_id", obraEditId)
    .eq("numero", nomeNorm).limit(2); // eq, não ilike: "_" e "%" são curingas no ILIKE
  if((candidatas || []).length > 1){
    aviso("app-aviso", `"${nomeNorm}" existe em mais de um local (${candidatas.map(c => c.local || "sem local").join(" / ")}). Vincule manualmente pela sugestão da Conferência.`, "erro");
    return;
  }
  const existente = (candidatas || [])[0];
  let estacaId;
  if(existente){
    estacaId = existente.id;
  } else {
    const reg = {
      obra_id: obraEditId,
      numero: nomeNorm,
      tipo: "helice_continua",  // default razoável; user ajusta depois
      status: "prevista",
      profundidade_m: profundidade ? Number(profundidade) : null,
      observacoes: "Criada automaticamente a partir de execução CSV"
    };
    const { data: novo, error } = await sb.from("estacas").insert(reg).select("id").single();
    if(error){
      aviso("app-aviso","Erro ao criar estaca: "+error.message,"erro");
      return;
    }
    estacaId = novo.id;
  }
  // Vincula a execução
  const { error: errVinc } = await sb.from("rdo_execucao_estaca")
    .update({ estaca_id: estacaId })
    .eq("id", orfaId);
  if(errVinc){ aviso("app-aviso","Estaca criada mas erro ao vincular: "+errVinc.message,"erro"); return; }
  aviso("app-aviso", `Estaca ${nomeNorm} criada e vinculada.`, "ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function criarTodasPrevistasFaltantes(){
  if(!_recOrfas.length){ aviso("app-aviso","Sem órfãs.","erro"); return; }
  if(!confirm(`Criar ${_recOrfas.length} estacas previstas a partir das execuções e vincular todas? Tipo default: hélice contínua.`)) return;

  const btn = $("btn-est-rec-criar-todas");
  if(btn){ btn.disabled = true; btn.textContent = "Criando..."; }

  let criadas = 0, vinculadas = 0;
  for(const o of _recOrfas){
    const nomeNorm = normalizarNumeroEstacaEstacas(o.estaca_numero);
    // Verifica/cria
    const { data: candidatas } = await sb.from("estacas")
      .select("id,local").eq("obra_id", obraEditId)
      .eq("numero", nomeNorm).limit(2); // eq, não ilike: "_" e "%" são curingas no ILIKE
    if((candidatas || []).length > 1) continue; // mesmo número em locais diferentes: fica para vínculo manual
    const existente = (candidatas || [])[0];
    let estacaId;
    if(existente){
      estacaId = existente.id;
    } else {
      const { data: novo, error } = await sb.from("estacas").insert({
        obra_id: obraEditId,
        numero: nomeNorm,
        tipo: "helice_continua",
        status: "prevista",
        profundidade_m: o.profundidade_executada ? Number(o.profundidade_executada) : null,
        observacoes: "Criada automaticamente a partir de execução CSV"
      }).select("id").single();
      if(error) continue;
      estacaId = novo.id;
      criadas++;
    }
    const { error: errV } = await sb.from("rdo_execucao_estaca")
      .update({ estaca_id: estacaId })
      .eq("id", o.id);
    if(!errV) vinculadas++;
  }

  aviso("app-aviso", `✅ ${criadas} estacas criadas e ${vinculadas} execuções vinculadas.`, "ok");
  fecharModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

function aplicarTodasSugestoes(){
  document.querySelectorAll(".rec-select").forEach(sel => {
    const sug = sel.dataset.sugestao;
    if(sug){
      sel.value = sug;
      _recVinculos[sel.dataset.orfaId] = sug;
    }
  });
  destacarConflitosVinculacao();
  const total = Object.values(_recVinculos).filter(Boolean).length;
  const conflitos = contarConflitosVinculacao();
  if(conflitos > 0){
    aviso("app-aviso", `⚠️ ${total} sugestões aplicadas, mas ${conflitos} execuções estão competindo pela mesma estaca — linhas em vermelho. Ajuste antes de confirmar.`, "erro");
  } else {
    aviso("app-aviso", `${total} sugestões aplicadas. Confira antes de confirmar.`, "ok");
  }
}

/* Conta quantas execuções estão apontando pra uma estaca que outra execução também aponta */
function contarConflitosVinculacao(){
  const cont = {};
  Object.values(_recVinculos).forEach(v => { if(v){ cont[v] = (cont[v]||0) + 1; } });
  let conflitos = 0;
  Object.values(cont).forEach(n => { if(n > 1) conflitos += n; });
  return conflitos;
}

/* Marca em vermelho as linhas cujo select aponta pra mesma estaca que outra(s) linha(s) */
function destacarConflitosVinculacao(){
  const cont = {};
  Object.entries(_recVinculos).forEach(([orfa, est]) => {
    if(!est) return;
    if(!cont[est]) cont[est] = [];
    cont[est].push(orfa);
  });
  document.querySelectorAll("tr[data-orfa-id]").forEach(tr => {
    tr.style.background = "";
    tr.title = "";
  });
  Object.entries(cont).forEach(([est, orfas]) => {
    if(orfas.length <= 1) return;
    orfas.forEach(orfa => {
      const tr = document.querySelector(`tr[data-orfa-id="${orfa}"]`);
      if(tr){
        tr.style.background = "var(--perigo-bg)";
        tr.title = `⚠️ Conflito: ${orfas.length} execuções apontam pra esta mesma estaca`;
      }
    });
  });
}

/* Move TODOS os RDOs desta obra (com órfãs) pra outra obra e recasa via RPC. */
async function moverExecucoesPraOutraObra(){
  const novaObraId = $("conf-mover-obra")?.value;
  if(!novaObraId){ aviso("app-aviso","Escolha a obra de destino.","erro"); return; }
  if(!confirm(`Mover todos os RDOs (e execuções) desta obra pra "${mapaObras[novaObraId]}"?\n\nVai recasar estacas automaticamente após o move.`)) return;

  // 1. Move todos os RDOs pra nova obra
  const { data: rdos, error: errRdo } = await sb.from("rdo").select("id").eq("obra_id", obraEditId);
  if(errRdo || !rdos || !rdos.length){
    aviso("app-aviso","Não foi possível listar RDOs desta obra.","erro");
    return;
  }
  const { error: errMove } = await sb.from("rdo")
    .update({ obra_id: novaObraId })
    .in("id", rdos.map(r => r.id));
  if(errMove){ aviso("app-aviso","Erro ao mover: "+errMove.message,"erro"); return; }

  // 2. Chama a RPC pra limpar estaca_id (que apontava pra obra antiga) e recasar com a nova
  const { data: result, error: errRpc } = await sb.rpc("recasar_execucoes_obra", { p_obra_id: novaObraId });
  if(errRpc){
    aviso("app-aviso", `Movidos ${rdos.length} RDOs, mas erro ao recasar: ${errRpc.message}`, "erro");
    return;
  }

  const vinc = result?.vinculadas ?? 0;
  const ests = result?.estacas_atualizadas ?? 0;
  aviso("app-aviso",
    `✅ ${rdos.length} RDO(s) movidos para "${mapaObras[novaObraId]}". ${vinc} execução(ões) vinculada(s), ${ests} estaca(s) atualizada(s).`,
    "ok");
  fecharModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

/* ====================================================================
   ABA ALTERADAS — estacas com 2+ execuções (refuros legítimos OU mal-casadas)
   ==================================================================== */

function renderizarAlteradas(){
  const cont = $("conf-alteradas-conteudo");
  if(!cont) return;
  if(!_confAlteradas.length){
    cont.innerHTML = `<p class="vazio">🎉 Todas as estacas têm execução única ou são refuros marcados corretamente.</p>`;
    return;
  }

  const linhas = _confAlteradas.map(g => {
    const todasRefuro = g.execs.every(e => e.modalidade_execucao === "refuro" || g.execs.indexOf(e) === 0);
    const algumRefuro = g.execs.some(e => e.modalidade_execucao === "refuro");
    const isSuspeito  = !algumRefuro;  // 2+ execs sem nenhuma marcada como refuro = suspeito
    const corTopo = isSuspeito ? "var(--perigo-bg)" : "var(--aviso-bg)";
    const bordaTopo = isSuspeito ? "var(--perigo)" : "var(--aviso)";
    const tagTopo = isSuspeito
      ? `<span class="rec-badge rec-badge-baixa">⚠️ SUSPEITO</span>`
      : `<span class="rec-badge rec-badge-alta">✓ Refuro confirmado</span>`;

    // Linhas das execuções
    const linhasExec = g.execs.map((re, idx) => {
      const data = re.perfuracao_inicio ? dataBR(re.perfuracao_inicio) : "—"; // sem conversão de fuso
      const tag = re.modalidade_execucao === "refuro"
        ? `<span class="rec-badge rec-badge-alta">REFURO</span>`
        : (idx === 0 ? `<span class="rec-badge" style="background:var(--info-bg);color:var(--marca-600);">furo original</span>` : `<span class="rec-badge rec-badge-baixa">extra</span>`);
      // Select só com estacas AINDA PREVISTAS (não faz sentido realocar pra uma já executada)
      const optsPrev = _recPrevs
        .filter(p => p.id !== g.estaca.id && p.status === "prevista")
        .map(p => `<option value="${esc(p.id)}">${esc(p.numero)}</option>`).join("");
      const semPrevistas = optsPrev.length === 0;
      const selectBlock = semPrevistas
        ? `<small style="color:var(--txt-sutil);font-style:italic;">Nenhuma estaca prevista disponível pra realocar</small>`
        : `<select class="alt-realoc-sel" data-exec-id="${esc(re.id)}" style="font-size:var(--txt-xs);max-width:220px;">
             <option value="">— manter aqui —</option>
             ${optsPrev}
           </select>
           <button type="button" class="btn btn-sm btn-alt-realocar" data-exec-id="${esc(re.id)}" data-estaca-orig="${esc(g.estaca.id)}" style="background:var(--marca-600);">→ Realocar</button>`;
      return `<tr>
        <td>${tag}</td>
        <td>${esc(data)}</td>
        <td class="num">${num(re.profundidade_executada || 0)} m</td>
        <td class="num">${num(re.volume_concreto_m3 || 0)} m³</td>
        <td>
          ${idx > 0 ? `
            ${selectBlock}
            <button type="button" class="btn-sec btn-sm btn-alt-marcar-refuro" data-exec-id="${esc(re.id)}" title="Marcar esta execução como REFURO desta estaca">↻ Marcar refuro</button>
          ` : ""}
        </td>
      </tr>`;
    }).join("");

    return `<div style="border:1px solid ${bordaTopo};border-radius:6px;margin-bottom:12px;background:${corTopo};">
      <div style="padding:10px 14px;border-bottom:1px solid ${bordaTopo};display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong style="font-size:var(--txt-base);">${esc(g.estaca.numero)}</strong>
        ${tagTopo}
        <span class="meta">${g.execs.length} execuções vinculadas</span>
      </div>
      <div style="padding:8px 14px;background:var(--sup-0);">
        <table style="width:100%;font-size:var(--txt-sm);">
          <thead><tr style="background:var(--sup-2);">
            <th>Tipo</th><th>Data</th><th class="num">Prof.</th><th class="num">Concreto</th><th>Ação</th>
          </tr></thead>
          <tbody>${linhasExec}</tbody>
        </table>
      </div>
    </div>`;
  }).join("");

  cont.innerHTML = `
    <div style="background:var(--info-bg);border-left:3px solid var(--marca-600);padding:10px 14px;margin-bottom:12px;font-size:var(--txt-sm);">
      📊 <strong>${_confAlteradas.length} estaca(s) com múltiplas execuções.</strong>
      Refuros legítimos (mesmo nome + R no CSV) já vêm marcados em verde.
      Casos suspeitos em <strong>vermelho</strong> precisam de revisão.
    </div>
    ${linhas}
  `;

  // Listeners
  cont.querySelectorAll(".btn-alt-realocar").forEach(b => {
    b.addEventListener("click", () => realocarExecucao(b.dataset.execId, b.dataset.estacaOrig));
  });
  cont.querySelectorAll(".btn-alt-marcar-refuro").forEach(b => {
    b.addEventListener("click", () => marcarComoRefuro(b.dataset.execId));
  });
}

async function realocarExecucao(execId, estacaOrigId){
  const sel = document.querySelector(`.alt-realoc-sel[data-exec-id="${execId}"]`);
  const novaEstacaId = sel?.value;
  if(!novaEstacaId){ aviso("app-aviso","Escolha a estaca de destino no select.","erro"); return; }
  // Busca nomes pra mensagem de motivo
  const orig = _recPrevs.find(p => p.id === estacaOrigId);
  const dest = _recPrevs.find(p => p.id === novaEstacaId);
  if(!confirm(`Realocar esta execução de "${orig?.numero||"?"}" pra "${dest?.numero||"?"}"? A estaca antiga ficará só com as execuções restantes.`)) return;

  const { error } = await sb.from("rdo_execucao_estaca")
    .update({ estaca_id: novaEstacaId })
    .eq("id", execId);
  if(error){ aviso("app-aviso","Erro ao realocar: "+error.message,"erro"); return; }

  // Registra ALTERAÇÃO MANUAL nas DUAS estacas (origem e destino)
  const motivoOrig = `Execução realocada para "${dest?.numero||"?"}" via Conferência`;
  const motivoDest = `Execução recebida de "${orig?.numero||"?"}" via Conferência`;
  await Promise.all([
    sb.rpc("registrar_alteracao_estaca", { p_estaca_id: estacaOrigId, p_motivo: motivoOrig }),
    sb.rpc("registrar_alteracao_estaca", { p_estaca_id: novaEstacaId, p_motivo: motivoDest })
  ]);

  aviso("app-aviso","Execução realocada e registrada como alteração.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function marcarComoRefuro(execId){
  if(!confirm("Marcar esta execução como REFURO? Os dados da estaca pai não serão sobrescritos por ela.")) return;
  // Busca a execução pra saber qual estaca registrar
  const { data: execData } = await sb.from("rdo_execucao_estaca").select("estaca_id").eq("id", execId).single();
  const { error } = await sb.from("rdo_execucao_estaca")
    .update({ modalidade_execucao: "refuro" })
    .eq("id", execId);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }

  // Registra alteração manual na estaca
  if(execData?.estaca_id){
    await sb.rpc("registrar_alteracao_estaca", {
      p_estaca_id: execData.estaca_id,
      p_motivo: "Execução marcada como REFURO via Conferência"
    });
  }

  aviso("app-aviso","Execução marcada como refuro e registrada como alteração.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

/* ====================================================================
   ABA DUPLICADAS — grupos de estacas com mesmo número
   ==================================================================== */

function renderizarDuplicadas(){
  const cont = $("conf-duplicadas-conteudo");
  if(!cont) return;
  if(!_confDuplicadas.length){
    cont.innerHTML = `<p class="vazio">🎉 Não há estacas duplicadas nesta obra.</p>`;
    return;
  }
  const blocos = _confDuplicadas.map(grupo => {
    const linhas = grupo.estacas.map((e, i) => {
      const stMeta = ESTACA_STATUS[e.status] || { label: e.status, cor: "cinza" };
      return `<tr data-id="${esc(e.id)}">
        <td><strong>#${i+1}</strong></td>
        <td>${esc(e.numero)}</td>
        <td>${esc(extrairBloco(e)||"—")}</td>
        <td>${esc((ESTACA_TIPOS[e.tipo]||e.tipo||"—"))}</td>
        <td class="num">${e.diametro_mm!=null ? num(e.diametro_mm) : "—"}</td>
        <td class="num">${e.profundidade_m!=null ? num(e.profundidade_m) : "—"}</td>
        <td><span class="tag ${stMeta.cor}">${esc(stMeta.label)}</span></td>
        <td class="col-acao">
          <button type="button" class="btn-sec btn-sm btn-dup-renomear" data-id="${esc(e.id)}" data-num="${esc(e.numero)}">✏️ Renomear</button>
          <button type="button" class="btn-sec btn-sm btn-dup-excluir txt-perigo" data-id="${esc(e.id)}" data-num="${esc(e.numero)}">🗑️</button>
        </td>
      </tr>`;
    }).join("");
    return `<div style="margin-bottom:18px;border:1px solid var(--aviso);border-radius:6px;padding:10px;background:#fff8e8;">
      <h4>
        ⚠️ Número <code style="background:var(--sup-0);padding:2px 8px;border-radius:3px;">${esc(grupo.numero)}</code> aparece <strong>${grupo.estacas.length}× </strong>
      </h4>
      <div class="tabela-rola"><table>
        <thead><tr>
          <th>#</th><th>Número</th><th>Bloco</th><th>Tipo</th>
          <th class="num">Ø</th><th class="num">Prof.</th><th>Status</th><th class="col-acao"></th>
        </tr></thead>
        <tbody>${linhas}</tbody></table></div>
    </div>`;
  }).join("");
  cont.innerHTML = blocos;

  cont.querySelectorAll(".btn-dup-renomear").forEach(b => {
    b.addEventListener("click", () => renomearEstacaDuplicada(b.dataset.id, b.dataset.num));
  });
  cont.querySelectorAll(".btn-dup-excluir").forEach(b => {
    b.addEventListener("click", () => excluirEstacaDuplicada(b.dataset.id, b.dataset.num));
  });
}

async function renomearEstacaDuplicada(id, numAtual){
  const novo = prompt(`Renomear estaca "${numAtual}" para:`, numAtual + "-2");
  if(!novo || novo.trim() === numAtual) return;
  const novoNorm = normalizarNumeroEstacaEstacas(novo);
  const { error } = await sb.from("estacas").update({ numero: novoNorm }).eq("id", id);
  if(error){
    if((error.message||"").toLowerCase().includes("duplicate"))
      aviso("app-aviso","Já existe outra estaca com esse número. Escolha um diferente.","erro");
    else
      aviso("app-aviso","Erro: "+error.message,"erro");
    return;
  }
  aviso("app-aviso", `Estaca renomeada para ${novoNorm}.`, "ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function excluirEstacaDuplicada(id, num){
  if(!confirm(`Excluir esta estaca "${num}"? A ação não pode ser desfeita.\n(Execuções vinculadas ficarão órfãs até serem realocadas).`)) return;
  const { error } = await sb.from("estacas").delete().eq("id", id);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  aviso("app-aviso","Estaca excluída.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

/* ====================================================================
   ABA REFURADAS — estacas com status=refurada
   ==================================================================== */

function renderizarRefuradas(){
  const cont = $("conf-refuradas-conteudo");
  if(!cont) return;
  if(!_confRefuradas.length){
    cont.innerHTML = `<p class="vazio">🎉 Não há estacas refuradas nesta obra.</p>`;
    return;
  }
  const linhas = _confRefuradas.map(e => `<tr data-id="${esc(e.id)}">
    <td><strong>${esc(e.numero)}</strong></td>
    <td>${esc(extrairBloco(e)||"—")}</td>
    <td class="num">${e.diametro_mm!=null ? num(e.diametro_mm) : "—"}</td>
    <td class="num">${e.profundidade_m!=null ? num(e.profundidade_m) + " m" : "—"}</td>
    <td>${dataBR(e.data_execucao)}</td>
    <td>${esc(e.observacoes || "—")}</td>
    <td class="col-acao">
      <button type="button" class="btn-sec btn-sm btn-ref-substituir" data-id="${esc(e.id)}" data-num="${esc(e.numero)}">➕ Criar substituta</button>
      <button type="button" class="btn-sec btn-sm btn-ref-restaurar" data-id="${esc(e.id)}" title="Voltar para 'prevista'">↩️ Restaurar</button>
    </td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nº</th><th>Bloco</th><th class="num">Ø</th><th class="num">Profund.</th>
      <th>Data</th><th>Observação</th><th class="col-acao"></th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;

  cont.querySelectorAll(".btn-ref-substituir").forEach(b => {
    b.addEventListener("click", () => criarSubstitutaRefurada(b.dataset.id, b.dataset.num));
  });
  cont.querySelectorAll(".btn-ref-restaurar").forEach(b => {
    b.addEventListener("click", () => restaurarRefurada(b.dataset.id));
  });
}

async function criarSubstitutaRefurada(idOriginal, numOriginal){
  const original = _confRefuradas.find(e => e.id === idOriginal);
  if(!original) return;
  const sugestao = numOriginal + "-S";
  const novoNum = prompt(`Número da estaca substituta (a refurada "${numOriginal}" continua no histórico):`, sugestao);
  if(!novoNum) return;
  const novoNorm = normalizarNumeroEstacaEstacas(novoNum);
  const reg = {
    obra_id: obraEditId,
    numero: novoNorm,
    tipo: original.tipo || "outro",
    status: "prevista",
    diametro_mm: original.diametro_mm,
    profundidade_m: original.profundidade_m,  // copia profundidade projetada
    observacoes: `Substituta de ${numOriginal} (refurada)` + (original.observacoes ? ` · ${original.observacoes}` : "")
  };
  const { error } = await sb.from("estacas").insert(reg);
  if(error){
    if((error.message||"").toLowerCase().includes("duplicate"))
      aviso("app-aviso","Já existe estaca com esse número. Escolha outro.","erro");
    else
      aviso("app-aviso","Erro: "+error.message,"erro");
    return;
  }
  aviso("app-aviso", `Estaca substituta ${novoNorm} criada como prevista.`, "ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function restaurarRefurada(id){
  if(!confirm("Restaurar esta estaca para status 'prevista'? Use só se a refuração foi marcada por engano.")) return;
  const { error } = await sb.from("estacas").update({
    status: "prevista",
    data_execucao: null
  }).eq("id", id);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  aviso("app-aviso","Estaca restaurada para prevista.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function confirmarReconciliacao(){
  const escolhidos = Object.entries(_recVinculos).filter(([_,v]) => v);
  if(!escolhidos.length){
    aviso("app-aviso","Nenhuma vinculação escolhida. Use 'Aplicar sugestões' ou selecione manualmente.","erro");
    return;
  }

  // Bloqueia confirmar se há 2+ execuções apontando pra mesma estaca (a menos que usuário confirme intencionalmente)
  const conflitos = contarConflitosVinculacao();
  if(conflitos > 0){
    const ok = confirm(
      `⚠️ ATENÇÃO: ${conflitos} execuções estão competindo pela mesma estaca (linhas em vermelho na tabela).\n\n` +
      `Se confirmar assim, algumas estacas receberão MAIS DE UMA execução (anomalia de cadastro).\n\n` +
      `Recomendado: cancelar, ajustar manualmente cada linha em vermelho, depois confirmar.\n\n` +
      `Deseja confirmar mesmo assim?`
    );
    if(!ok) return;
  }
  if(!confirm(`Vincular ${escolhidos.length} execução(ões) às estacas escolhidas? Isso atualiza status pra 'executada' e profundidade.`)) return;

  // Desabilita o botão pra evitar duplo-clique
  const btn = $("btn-est-rec-confirmar");
  if(btn){ btn.disabled = true; btn.textContent = "Vinculando..."; }

  let sucesso = 0, falhas = 0;
  const erros = [];
  for(const [execId, estacaId] of escolhidos){
    const { error } = await sb.from("rdo_execucao_estaca")
      .update({ estaca_id: estacaId })
      .eq("id", execId);
    if(error){ falhas++; erros.push(error.message); }
    else { sucesso++; }
  }

  // Toast de aviso (continua) — mas NÃO fecha mais o modal de cara
  aviso("app-aviso", `✅ ${sucesso} vinculada(s)${falhas ? ` · ${falhas} falha(s)` : ""}.`, sucesso > 0 ? "ok" : "erro");

  // Atualiza dados em background
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
  if(typeof carregarContagemReconciliacao === "function") await carregarContagemReconciliacao(obraEditId);

  // Recarrega modal (vai mostrar 0 órfãs se tudo OK) e injeta banner de resumo no topo
  await abrirModalReconciliacao();
  const cont = $("est-reconciliar-conteudo");
  if(cont){
    const cor = falhas === 0 ? "var(--sucesso-bg)" : "var(--aviso-bg)";
    const borda = falhas === 0 ? "var(--sucesso)" : "var(--aviso)";
    const icone = falhas === 0 ? "✅" : "⚠️";
    const titulo = falhas === 0
      ? `${sucesso} execução(ões) vinculada(s) com sucesso!`
      : `${sucesso} vinculada(s) · ${falhas} falharam`;
    const detalhe = falhas > 0
      ? `<details style="margin-top:6px;font-size:var(--txt-xs);"><summary>Ver erros</summary><pre style="white-space:pre-wrap;">${esc(erros.slice(0,5).join("\n"))}</pre></details>`
      : `<div style="font-size:var(--txt-sm);margin-top:4px;color:var(--txt-sec);">As estacas previstas correspondentes foram marcadas como <strong>executada</strong> automaticamente.</div>`;
    const banner = `
      <div style="background:${cor};border-left:4px solid ${borda};padding:14px 18px;margin-bottom:14px;border-radius:4px;">
        <div style="font-size:var(--txt-base);font-weight:600;color:var(--marca-900);">${icone} ${titulo}</div>
        ${detalhe}
      </div>`;
    cont.insertAdjacentHTML("afterbegin", banner);
  }
}

/* ---------- Listeners ---------- */
function ligarEstacas(){
  $("btn-est-nova")?.addEventListener("click", () => {
    if(!obraEditId){ aviso("app-aviso","Salve a obra antes de adicionar estacas.","erro"); return; }
    abrirModalEstaca(null);
  });
  $("btn-est-importar")?.addEventListener("click", abrirModalImport);
  $("btn-est-importar-dxf")?.addEventListener("click", abrirModalDXF);
  $("btn-est-fechar-dxf")?.addEventListener("click", fecharModalDXF);
  $("btn-dxf-ler")?.addEventListener("click", lerArquivoDXF);
  $("btn-est-dxf-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-est-dxf-confirmar", confirmarImportEstacas));
  $("btn-est-salvar")?.addEventListener("click", () => comBotaoTravado("btn-est-salvar", salvarEstaca));
  $("btn-est-cancelar")?.addEventListener("click", fecharModalEstaca);

  $("btn-est-extrair")?.addEventListener("click", importarEstacasPDF);
  $("btn-est-confirmar-import")?.addEventListener("click", () => comBotaoTravado("btn-est-confirmar-import", confirmarImportEstacas));
  $("btn-est-fechar-import")?.addEventListener("click", fecharModalImport);

  // Conferência do Projeto (modal expandido)
  $("btn-est-reconciliar")?.addEventListener("click", abrirModalReconciliacao);
  $("btn-est-rec-fechar")?.addEventListener("click", fecharModalReconciliacao);

  // Switcher das abas internas do modal (event delegation)
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("#conf-notebook button[data-conf-tab]");
    if(t) ativarConfAba(t.dataset.confTab);
  });

  ["est-busca","est-f-status","est-f-tipo","est-f-local"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "est-busca" ? "input" : "change", id === "est-busca" ? debounce(renderEstacas) : renderEstacas);
  });

  // Toggle Lista | Planta
  document.querySelectorAll("[data-est-view]").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-est-view]").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _estView = b.dataset.estView;
      renderEstacas();
      if(_estView === "planta") configurarPanZoom();
    });
  });

  // Colorir planta por status / por máquina
  document.querySelectorAll("[data-planta-cor]").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-planta-cor]").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _plantaCor = b.dataset.plantaCor;
      renderPlantaSVG();
    });
  });

  // Zoom buttons
  $("btn-planta-zoom-in")?.addEventListener("click", () => plantaZoom(0.2));
  $("btn-planta-zoom-out")?.addEventListener("click", () => plantaZoom(-0.2));
  $("btn-planta-zoom-fit")?.addEventListener("click", plantaZoomFit);
  $("btn-regra-salvar")?.addEventListener("click", () => comBotaoTravado("btn-regra-salvar", salvarRegraDist));

  // Modal de execução rápida
  $("btn-exec-fechar")?.addEventListener("click", fecharModalExecucao);
  $("btn-exec-salvar")?.addEventListener("click", () => comBotaoTravado("btn-exec-salvar", () => salvarExecucao()));
  $("btn-exec-iniciar")?.addEventListener("click", () => salvarExecucao("em_execucao"));
  $("btn-exec-concluir")?.addEventListener("click", () => {
    if(!$("exec-profundidade").value){
      if(!confirm("Sem profundidade real informada. Marcar como executada mesmo assim?")) return;
    }
    salvarExecucao("executada");
  });
  $("btn-exec-refugar")?.addEventListener("click", () => {
    if(!confirm("Marcar esta estaca como REFURADA?")) return;
    salvarExecucao("refugada");
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarEstacas);
} else {
  ligarEstacas();
}

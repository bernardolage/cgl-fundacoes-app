
































const PPJ_POS_TABELA = "estacas_planta_posicao";
const PPJ_POS_COLUNAS = "estaca_id,x_frac,y_frac";
const PPJ_POS_NS = "http://www.w3.org/2000/svg";
const PPJ_POS_DESFAZER_MAX = 50;
const PPJ_POS_RAIO = 8;
const PPJ_POS_TOQUE_PX = 5;
const PPJ_POS_ROTULO_MIN_PX = 56;
const PPJ_POS_ZOOM_BUSCA = 4;
const PPJ_POS_AMOSTRA = 600;
const PPJ_POS_LISTA_MAX = 300;
const PPJ_POS_STATUS = { prevista: "Prevista", em_execucao: "Em execução", perfuracao_concluida: "Perfuração concluída", armacao_aplicada: "Armação aplicada", executada: "Executada", refugada: "Refurada" };



const PPJ_POS_TRACO = {
  prevista:             { stroke: "var(--doc-papel)", w: "1.5", dash: "",    op: "" },
  em_execucao:          { stroke: "var(--doc-tinta)", w: "2",   dash: "4 2", op: "0.7" },
  perfuracao_concluida: { stroke: "var(--doc-tinta)", w: "2",   dash: "4 2", op: "0.7" },
  armacao_aplicada:     { stroke: "var(--doc-tinta)", w: "2",   dash: "4 2", op: "0.7" },
  executada:            { stroke: "var(--doc-tinta)", w: "2.5", dash: "",    op: "" },
  refugada:             { stroke: "var(--doc-tinta)", w: "2.5", dash: "2 2", op: "" }
};





function ppjPosArredondar(n){
  if(n === null || n === undefined || n === "") return null;
  const v = Number(n);
  if(!Number.isFinite(v)) return null;
  return Math.round(Math.min(1, Math.max(0, v)) * 1e6) / 1e6;
}
const ppjPosPonto = (p) => !!p && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y);


function ppjPosFracao(v, px, py, lw, lh, prender){
  if(!v || !ppjNum(v.z) || !ppjNum(v.tx) || !ppjNum(v.ty) || !(v.z > 0) || !ppjNum(px) || !ppjNum(py) || !(lw > 0) || !(lh > 0)) return null;
  const x = (px - v.tx) / (lw * v.z), y = (py - v.ty) / (lh * v.z);
  if(!prender && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: ppjPosArredondar(x), y: ppjPosArredondar(y) };
}



function ppjPosNoPalco(r, bordaEsq, bordaTopo, clientX, clientY){
  const b = (v) => (ppjNum(v) ? v : 0);
  return { x: clientX - b(r && r.left) - b(bordaEsq), y: clientY - b(r && r.top) - b(bordaTopo) };
}

function ppjPosTela(v, xf, yf, lw, lh){
  if(!v || !ppjNum(v.z) || !ppjNum(v.tx) || !ppjNum(v.ty) || !ppjNum(xf) || !ppjNum(yf) || !(lw > 0) || !(lh > 0)) return null;
  return { x: xf * lw * v.z + v.tx, y: yf * lh * v.z + v.ty };
}

function ppjPosCentrar(v, xf, yf, lw, lh, W, H){
  const atual = ppjLimitar(v, lw, lh, W, H);
  if(!ppjNum(xf) || !ppjNum(yf)) return atual;
  const base = ppjAjustar(lw, lh, W, H);
  const z = Math.min(base.z * PPJ_ZOOM_MAX, Math.max(atual.z, base.z * PPJ_POS_ZOOM_BUSCA));
  return ppjLimitar({ z, tx: W / 2 - xf * lw * z, ty: H / 2 - yf * lh * z }, lw, lh, W, H);
}




function ppjPosPartes(nome){ return String(nome ?? "").trim().toUpperCase().match(/\d+|\D+/g) || []; }
function ppjPosCompararNomes(a, b){
  const pa = ppjPosPartes(a), pb = ppjPosPartes(b);
  for(let i = 0; i < Math.min(pa.length, pb.length); i++){
    const x = pa[i], y = pb[i], nx = /^\d/.test(x), ny = /^\d/.test(y);
    if(nx && ny){
      const d = Number(x) - Number(y);
      if(d) return d < 0 ? -1 : 1;
      if(x.length !== y.length) return x.length < y.length ? -1 : 1;
    } else if(nx !== ny) return nx ? -1 : 1;
    else if(x !== y) return x < y ? -1 : 1;
  }
  return pa.length === pb.length ? 0 : pa.length < pb.length ? -1 : 1;
}
function ppjPosOrdenar(estacas){
  return (Array.isArray(estacas) ? estacas : []).filter(Boolean).slice().sort((a, b) => ppjPosCompararNomes(a.numero, b.numero) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
}


const ppjPosTexto = (e) => `${e.numero || ""} ${e.observacoes || ""} ${e.local || ""} ${e.bloco || ""}`.toLowerCase();


function ppjPosFiltrar(estacas, f){
  const p = f || {}, termo = String(p.termo || "").trim().toLowerCase();
  return (Array.isArray(estacas) ? estacas : []).filter(e => e && (!p.status || e.status === p.status) && (!p.tipo || e.tipo === p.tipo) && (!termo || ppjPosTexto(e).includes(termo)));
}


function ppjPosSemPosicao(estacas, mapa, o){
  const p = o || {}, local = String(p.local || "").trim(), termo = String(p.termo || "").trim().toLowerCase();
  const tem = (id) => !!mapa && typeof mapa.has === "function" && mapa.has(id);
  return ppjPosOrdenar((Array.isArray(estacas) ? estacas : []).filter(e => e && !tem(e.id)
    && (p.todas || !local || String(e.local || "").trim() === local) && (!termo || ppjPosTexto(e).includes(termo))));
}

function ppjPosDaVez(lista, atualId){
  const l = Array.isArray(lista) ? lista : [];
  return l.some(e => e.id === atualId) ? atualId : l.length ? l[0].id : null;
}

function ppjPosProxima(lista, atualId){
  const l = Array.isArray(lista) ? lista : [], i = l.findIndex(e => e.id === atualId);
  if(i < 0) return l.length ? l[0].id : null;
  return l.length <= 1 ? null : l[(i + 1) % l.length].id;
}





function ppjPosAcaoVale(a){
  if(!a || !a.estaca_id) return false;
  if(a.tipo === "posicionar") return ppjPosPonto(a.depois);
  if(a.tipo === "mover") return ppjPosPonto(a.antes) && ppjPosPonto(a.depois);
  return a.tipo === "tirar" && ppjPosPonto(a.antes);
}
function ppjPosOperacao(a){
  if(!ppjPosAcaoVale(a)) return null;
  return a.tipo === "tirar" ? { op: "tirar", estaca_id: a.estaca_id } : { op: "gravar", estaca_id: a.estaca_id, x: a.depois.x, y: a.depois.y };
}
function ppjPosInverso(a){
  if(!ppjPosAcaoVale(a)) return null;
  return a.tipo === "posicionar" ? { op: "tirar", estaca_id: a.estaca_id } : { op: "gravar", estaca_id: a.estaca_id, x: a.antes.x, y: a.antes.y };
}
function ppjPosAplicar(mapa, op){
  const novo = new Map(mapa && typeof mapa[Symbol.iterator] === "function" ? mapa : []);
  if(!op || !op.estaca_id) return novo;
  if(op.op === "tirar") novo.delete(op.estaca_id);
  else if(op.op === "gravar"){
    const x = ppjPosArredondar(op.x), y = ppjPosArredondar(op.y);
    if(x !== null && y !== null) novo.set(op.estaca_id, { x, y });
  }
  return novo;
}
function ppjPosEmpilhar(pilha, acao, max){
  const l = Array.isArray(pilha) ? pilha : [], m = Number(max) > 0 ? Number(max) : PPJ_POS_DESFAZER_MAX;
  return ppjPosAcaoVale(acao) ? l.concat(acao).slice(-m) : l.slice();
}
function ppjPosDesempilhar(pilha){
  const l = Array.isArray(pilha) ? pilha : [];
  return { pilha: l.slice(0, -1), acao: l.length ? l[l.length - 1] : null };
}




function ppjPosResumo(o){
  const p = o || {}, n = (v) => Math.max(0, Math.trunc(Number(v) || 0));
  const pos = n(p.posicionadas), mostradas = n(p.mostradas), exec = Math.min(n(p.executadas), mostradas);
  return `${pos} de ${n(p.total)} estacas da obra posicionadas nesta folha`
    + (mostradas ? ` · ${exec} de ${mostradas} executadas (${Math.round(exec / mostradas * 100)}%)` : "")
    + (pos > mostradas ? ` · ${pos - mostradas} fora do filtro` : "");
}


function ppjPosEspacamento(pontos, lw, lh){
  const l = (Array.isArray(pontos) ? pontos : []).filter(ppjPosPonto);
  if(l.length < 2 || !(lw > 0) || !(lh > 0)) return Infinity;
  const passo = Math.max(1, Math.ceil(l.length / PPJ_POS_AMOSTRA)), ds = [];
  for(let i = 0; i < l.length; i += passo){
    let m = Infinity;
    for(let j = 0; j < l.length; j++){
      if(j === i) continue;
      const dx = (l[i].x - l[j].x) * lw, dy = (l[i].y - l[j].y) * lh, d = dx * dx + dy * dy;
      if(d < m) m = d;
    }
    ds.push(Math.sqrt(m));
  }
  ds.sort((a, b) => a - b);
  return ds[Math.floor(ds.length / 2)];
}

function ppjPosRotuloCabe(z, espacamento, n){
  if(!(n >= 1) || !(z > 0)) return false;
  return n === 1 || z >= PPJ_POS_ROTULO_MIN_PX / espacamento;
}

function ppjPosLinha(plantaId, estacaId, obraId, x, y){
  if(![plantaId, estacaId, obraId].every(id => PPJ_UUID_RE.test(String(id || "")))) return null;
  if(typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { planta_id: plantaId, estaca_id: estacaId, obra_id: obraId, x_frac: ppjPosArredondar(x), y_frac: ppjPosArredondar(y) };
}

function ppjPosTabelaAusente(erro){
  if(!erro) return false;
  const cod = String(erro.code || ""), msg = String(erro.message || "");
  if(cod === "PGRST205" || cod === "42P01") return true;
  return msg.includes(PPJ_POS_TABELA) && /schema cache|does not exist|não existe/i.test(msg);
}
function ppjPosStatusRotulo(st){
  const daAba = typeof ESTACA_STATUS !== "undefined" && ESTACA_STATUS && ESTACA_STATUS[st] ? ESTACA_STATUS[st].label : "";
  return daAba || PPJ_POS_STATUS[st] || String(st || "");
}

function ppjPosTitulo(e){
  const p = e || {};
  return [String(p.numero || "").trim() || "Estaca", ppjPosStatusRotulo(p.status), String(p.local || "").trim(), String(p.bloco || "").trim()].filter(Boolean).join(" · ");
}



function ppjPosChaveMarca(e, preenchimento){
  const p = e || {};
  return JSON.stringify([String(preenchimento || ""), String(p.status || ""), ppjPosTitulo(p), String(p.numero || "").trim()]);
}


function ppjPosLegendaHTML(cor, maquinas){
  if(cor === "maquina"){
    const l = Array.isArray(maquinas) ? maquinas : [];
    return l.length ? l.map(m => `<span><i class="ppj-leg" data-ppj-maq="${esc(m.id)}"></i>${esc(m.rotulo)}</span>`).join("") : `<span class="meta">nenhuma máquina atribuída às estacas</span>`;
  }
  return Object.keys(PPJ_POS_TRACO).map(st => `<span title="${esc(ppjPosStatusRotulo(st))}"><i class="ppj-leg ppj-leg-${esc(st)}"></i>${esc(ppjPosStatusRotulo(st))}</span>`).join("")
    + `<span title="Executada hoje"><i class="ppj-leg ppj-leg-hoje"></i>Hoje</span>`;
}





function ppjPosFerramentasHTML(s){
  const p = s || {}, cor = p.cor === "maquina" ? "maquina" : "status", editando = !!p.podeEditar && !!p.editando;
  const botao = (v, texto, dica) => `<button type="button" class="serv-view-btn${cor === v ? " ativo" : ""}" data-ppj-cor="${esc(v)}" aria-pressed="${cor === v ? "true" : "false"}" title="${esc(dica)}">${esc(texto)}</button>`;
  const acoes = editando
    ? `<button type="button" class="btn-sec btn-sm" data-ppj-ed="desfazer" title="Desfazer a última mudança (Ctrl+Z)"${Number(p.desfazer) > 0 ? "" : " disabled"}>Desfazer</button>
       <button type="button" class="btn btn-sm" data-ppj-ed="concluir" title="Sair do modo de edição. O que foi feito já está gravado.">Concluir</button>`
    : p.podeEditar ? `<button type="button" class="btn-sec btn-sm" data-ppj-ed="entrar" title="Posicionar, mover ou tirar estacas desta folha. Cada mudança é gravada na hora.">Editar posições</button>` : "";
  const instrucao = p.instrucao || "Clique no desenho para posicionar a estaca da vez. Arraste um marcador para mover; clique nele para selecionar e tirar da folha. Cada mudança é gravada na hora.";
  const faixa = editando ? `<div class="ppj-faixa-edicao" role="status"><strong>Modo de edição</strong><span>${esc(instrucao)}</span>${p.nota ? `<strong class="ppj-faixa-nota">${esc(p.nota)}</strong>` : ""}</div>` : "";
  const erro = p.erro ? `<p class="ppj-erro ppj-recusa" role="alert">${esc(p.erro)}</p>` : "";
  return `<div class="ppj-ferramentas-linha">
      <div class="serv-views" role="group" aria-label="Cor das estacas">${  botao("status", "Por status", "Cor da estaca pelo status dela")}${  botao("maquina", "Por máquina", "Cor da estaca pela máquina que a executa")}</div>
      <div class="planta-legenda ppj-legenda">${  ppjPosLegendaHTML(cor, p.maquinas)}</div>
      <span class="ppj-barra-acoes">${  p.extra || ""}${  acoes}</span>
    </div>${  faixa}${  erro}`;
}


function ppjPosPainelHTML(s){
  const p = s || {};
  return `<div class="rotulo-caps" id="ppj-ed-conta">Sem posição nesta folha</div>
    <div class="ppj-ed-sel" id="ppj-ed-sel"></div>
    <p class="ppj-ed-vez" id="ppj-ed-vez"></p>
    <input id="ppj-ed-busca" type="search" placeholder="Buscar estaca…" aria-label="Buscar estaca sem posição nesta folha" autocomplete="off" />
    ${p.temLocal ? `<label class="ppj-check" title="Esta folha é do local ${esc(p.local)}. Marque para listar também as estacas dos outros locais."><input type="checkbox" id="ppj-ed-todas"${p.todas ? " checked" : ""} /> Todos os locais (a folha é de ${esc(p.local)})</label>` : ""}
    <div class="ppj-lista" id="ppj-ed-lista" role="group" aria-label="Estacas sem posição nesta folha"></div>`;
}


function ppjPosListaHTML(lista, daVez, buscando){
  const l = Array.isArray(lista) ? lista : [];
  if(!l.length) return uiVazio(buscando ? "Nenhuma estaca sem posição com esse nome. Confira a busca." : "Nenhuma estaca sem posição aqui: as deste filtro já estão nesta folha.");
  return l.slice(0, PPJ_POS_LISTA_MAX).map(e => {
    const sub = [e.local, e.bloco].map(x => String(x || "").trim()).filter(Boolean).join(" · ");
    return `<div class="ppj-item${e.id === daVez ? " ativo" : ""}" role="button" tabindex="0" data-ppj-item="${esc(e.id)}" draggable="true" aria-pressed="${e.id === daVez ? "true" : "false"}" title="Clique para fazer desta a estaca da vez, ou arraste até o desenho"><span class="ppj-item-nome">${esc(String(e.numero || "").trim() || "(sem nº)")}</span>${sub ? `<span class="ppj-item-sub">${esc(sub)}</span>` : ""}</div>`;
  }).join("") + (l.length > PPJ_POS_LISTA_MAX ? `<p class="ppj-item-mais">e mais ${l.length - PPJ_POS_LISTA_MAX}: use a busca para achar.</p>` : "");
}




function ppjPosEstadoNovo(folha){
  return { plantaId: folha ? folha.id : null, obraId: folha ? (folha.obra_id || _ppj.obraId) : null, local: folha ? String(folha.local || "").trim() : "",
    mapa: new Map(), disponivel: false, lendo: false, editando: false, daVez: null, selecionada: null, pilha: [], lista: [], todas: false, termo: "",
    arrasto: null, toque: null, ponteiros: new Set(), itemArrastado: null, svg: null, camada: null, marcas: new Map(), zMarcas: 0, espacamento: Infinity,
    buscaCentrada: "", chaveBarra: "", painelMontado: false, pendentes: 0, fila: Promise.resolve(), erro: "", reler: false };
}
let _ppjPos = ppjPosEstadoNovo(null);
let _ppjPosAusenteEm = 0;
const _ppjPosCache = new Map();
const _ppjPosPedidos = new Map();

const ppjPosIndisponivel = () => _ppjPosAusenteEm > 0 && Date.now() - _ppjPosAusenteEm < PPJ_AUSENTE_MS;
const ppjPosValor = (id) => { const el = $(id); return el ? String(el.value || "") : ""; };
const ppjPosCor = () => (typeof _plantaCor !== "undefined" && _plantaCor === "maquina" ? "maquina" : "status");
const ppjPosPontoDoPalco = (palco, ev) => ppjPosNoPalco(palco.getBoundingClientRect(), palco.clientLeft, palco.clientTop, ev.clientX, ev.clientY);
const ppjPosMarcaDe = (alvo) => { const no = alvo && alvo.closest ? alvo.closest("[data-ppj-estaca]") : null; return no ? no.getAttribute("data-ppj-estaca") : null; };
const ppjPosGuardar = (st) => { if(st.plantaId) _ppjPosCache.set(st.plantaId, { mapa: st.mapa, em: Date.now() }); };




function ppjPosBuscar(plantaId){
  if(!plantaId || ppjPosIndisponivel()) return Promise.resolve({ ausente: true });
  const guardado = _ppjPosCache.get(plantaId);
  if(guardado && Date.now() - guardado.em < PPJ_VALIDADE_MS) return Promise.resolve({ mapa: guardado.mapa });
  if(_ppjPosPedidos.has(plantaId)) return _ppjPosPedidos.get(plantaId);
  const pedido = Promise.resolve().then(() => lerTudo(() => sb.from(PPJ_POS_TABELA).select(PPJ_POS_COLUNAS).eq("planta_id", plantaId), "estaca_id"))
    .catch(e => ({ data: [], error: e }))
    .then(r => {
      _ppjPosPedidos.delete(plantaId);
      if(r.error){
        if(ppjPosTabelaAusente(r.error)){ _ppjPosAusenteEm = Date.now(); return { ausente: true }; }
        console.error("Estacas na folha, leitura das posições:", r.error);
        return { erro: r.error.message || "erro de leitura" };
      }
      _ppjPosAusenteEm = 0;
      const mapa = new Map();
      for(const l of r.data || []){
        const x = ppjPosArredondar(l.x_frac), y = ppjPosArredondar(l.y_frac);
        if(l.estaca_id && x !== null && y !== null) mapa.set(l.estaca_id, { x, y });
      }
      _ppjPosCache.set(plantaId, { mapa, em: Date.now() });
      return { mapa };
    });
  _ppjPosPedidos.set(plantaId, pedido);
  return pedido;
}



async function ppjPosAbrirPrimeira(){
  const obraId = _ppj.obraId;
  if(!obraId || _ppj.atual || _ppj.escolheu || !_ppj.folhas) return;
  const primeira = ppjFolhasVisiveis(_ppj.folhas, ppjFiltroLocal())[0];
  if(!primeira) return;
  const r = await ppjPosBuscar(primeira.id);
  if(obraId !== _ppj.obraId || _ppj.atual || _ppj.escolheu || !r.mapa || !r.mapa.size) return;
  if(!ppjFolhasVisiveis(_ppj.folhas || [], ppjFiltroLocal()).some(f => f.id === primeira.id)) return;
  _ppj.atual = primeira.id;
  ppjRedesenhar();
}



function ppjPosEsconder(){
  const f = $("ppj-ferramentas"), p = $("ppj-painel"), c = $("ppj-contagem"), palco = $("ppj-palco");
  if(f){ f.hidden = true; f.replaceChildren(); }
  if(p){ p.hidden = true; p.replaceChildren(); }
  if(c) c.textContent = "";
  if(palco) palco.classList.remove("ppj-editando");
}

function ppjPosMontar(folha, palco){
  const antigo = _ppjPos;
  if(antigo.svg && antigo.svg.parentNode) antigo.svg.remove();
  const st = _ppjPos = ppjPosEstadoNovo(folha);
  ppjPosEsconder();
  const nota = $("ppj-nota-sem");
  if(nota) nota.hidden = false;
  if(!folha || !palco) return;
  const svg = document.createElementNS(PPJ_POS_NS, "svg"), g = document.createElementNS(PPJ_POS_NS, "g");
  svg.setAttribute("class", "ppj-marcas");
  svg.setAttribute("id", "ppj-marcas");
  svg.setAttribute("aria-label", "Estacas posicionadas nesta folha");
  g.setAttribute("id", "ppj-marcas-g");
  svg.appendChild(g);
  palco.insertBefore(svg, $("ppj-estado"));
  st.svg = svg; st.camada = g;
  ppjPosLigarPalco(palco);
  ppjPosCarregar(st);
  if(typeof pplLeiMontar === "function") pplLeiMontar(st);
}
async function ppjPosCarregar(st){
  if(st.lendo) return;
  st.lendo = true;
  const r = await ppjPosBuscar(st.plantaId);
  st.lendo = false;
  if(st !== _ppjPos) return;
  if(r.ausente){ if(!st.disponivel) ppjPosEsconder(); return; }
  if(r.erro){
    if(st.disponivel) return;
    ppjPosEsconder();
    const c = $("ppj-contagem");
    if(c) c.textContent = "Não foi possível ler a posição das estacas: " + r.erro;
    return;
  }
  if(!st.pendentes) st.mapa = r.mapa;
  st.disponivel = true;
  const nota = $("ppj-nota-sem");
  if(nota) nota.hidden = true;
  ppjPosPintar(st);
}

function ppjPosAtualizar(folha){
  const st = _ppjPos;
  if(!folha || st.plantaId !== folha.id || !st.disponivel) return;
  ppjPosPintar(st);
  const guardado = _ppjPosCache.get(st.plantaId);
  if(!st.editando && !st.pendentes && (!guardado || Date.now() - guardado.em > PPJ_VALIDADE_MS)) ppjPosCarregar(st);
}

function ppjPosVisor(v, t){
  const st = _ppjPos;
  if(!t || !t.folha || t.folha.id !== st.plantaId) return;
  ppjPosColocar(st, false);
  if(typeof ppjSeqVisor === "function") ppjSeqVisor(st);
}

function ppjPosSair(){
  const st = _ppjPos;
  if(st.editando) ppjPosEditar(st, false);
}


function ppjPosPintar(st){
  ppjPosBarra(st);
  ppjPosMarcadores(st);
  ppjPosPainel(st);
  ppjPosExtras(st);
}

function ppjPosExtras(st){
  if(typeof ppjVinPintar === "function") ppjVinPintar(st);
  if(typeof ppjSeqPintar === "function") ppjSeqPintar(st);
}

function ppjPosAvisar(msg){
  const st = _ppjPos;
  st.erro = String(msg || "");
  if(st.disponivel) ppjPosBarra(st);
}


function ppjPosAbrirEstaca(id){
  if(typeof ppjVinCliqueEstaca === "function" && ppjVinCliqueEstaca(id)) return;
  if(typeof abrirModalExecucao === "function") abrirModalExecucao(id);
}

function ppjPosMaquinas(){
  if(typeof _mapaMaquinas !== "object" || !_mapaMaquinas) return [];
  const equips = typeof _equipamentosCache !== "undefined" && Array.isArray(_equipamentosCache) ? _equipamentosCache : [];
  Object.keys(_mapaMaquinas).forEach(k => delete _mapaMaquinas[k]);
  ppjEstacas().forEach(e => {
    if(!e.equipamento_id || _mapaMaquinas[e.equipamento_id]) return;
    const eq = equips.find(x => x.id === e.equipamento_id);
    _mapaMaquinas[e.equipamento_id] = eq ? { codigo: eq.codigo, nome: eq.nome } : { codigo: "?", nome: "" };
  });
  return Object.keys(_mapaMaquinas).sort().map(id => ({ id, rotulo: _mapaMaquinas[id].codigo || _mapaMaquinas[id].nome || "?" }));
}
function ppjPosBarra(st){
  const f = $("ppj-ferramentas");
  if(!f) return;
  const maquinas = ppjPosMaquinas();
  const extra = (typeof ppjVinExtraBarra === "function" ? ppjVinExtraBarra(st) : "") + (typeof pplLeiExtraBarra === "function" ? pplLeiExtraBarra(st) : "");
  const faixa = (typeof ppjSeqFaixa === "function" ? ppjSeqFaixa(st) : null) || {};
  const html = ppjPosFerramentasHTML({ podeEditar: ppjPodeEditar(), editando: st.editando, cor: ppjPosCor(), desfazer: st.pilha.length, maquinas, erro: st.erro, extra,
    instrucao: faixa.instrucao, nota: faixa.nota });
  if(html !== st.chaveBarra || !f.firstChild){
    f.innerHTML = html;
    st.chaveBarra = html;
    if(typeof corDaMaquina === "function") f.querySelectorAll("[data-ppj-maq]").forEach(i => { i.style.background = corDaMaquina(i.dataset.ppjMaq); });
  }
  f.hidden = false;
}

function ppjPosPreenchimento(e, cor, hoje){
  if(cor === "maquina") return typeof corDaMaquina === "function" ? corDaMaquina(e.equipamento_id) : "var(--txt-sutil)";
  if(hoje && e.data_execucao === hoje) return typeof COR_HOJE !== "undefined" ? COR_HOJE : "var(--estaca-hoje)";
  return (typeof COR_STATUS !== "undefined" && COR_STATUS[e.status]) || "var(--txt-sutil)";
}

function ppjPosMarca(e, preenchimento){
  const no = document.createElementNS(PPJ_POS_NS, "g"), titulo = document.createElementNS(PPJ_POS_NS, "title"),
    circ = document.createElementNS(PPJ_POS_NS, "circle"), rot = document.createElementNS(PPJ_POS_NS, "text");
  no.setAttribute("class", "ppj-marca");
  no.setAttribute("data-ppj-estaca", e.id);
  no.setAttribute("tabindex", "0");
  no.setAttribute("role", "button");
  no.setAttribute("aria-label", "Estaca " + ppjPosTitulo(e));
  titulo.textContent = ppjPosTitulo(e);
  circ.setAttribute("r", String(PPJ_POS_RAIO));

  circ.style.fill = preenchimento;
  const traco = PPJ_POS_TRACO[e.status] || PPJ_POS_TRACO.prevista;
  circ.style.stroke = traco.stroke;
  circ.style.strokeWidth = traco.w;
  if(traco.op) circ.style.strokeOpacity = traco.op;
  if(traco.dash) circ.setAttribute("stroke-dasharray", traco.dash);
  rot.setAttribute("class", "ppj-marca-rot");
  rot.setAttribute("x", String(PPJ_POS_RAIO + 4));
  rot.setAttribute("y", "4");
  rot.textContent = String(e.numero || "").trim();
  no.appendChild(titulo); no.appendChild(circ); no.appendChild(rot);
  return no;
}
function ppjPosMarcadores(st){
  const g = st.camada, folha = ppjFolhaAtual();
  if(!g || !folha || folha.id !== st.plantaId) return;
  const estacas = ppjEstacas(), filtro = { status: ppjPosValor("est-f-status"), tipo: ppjPosValor("est-f-tipo"), termo: ppjPosValor("est-busca") };
  const posicionadas = estacas.filter(e => e && st.mapa.has(e.id)), mostradas = ppjPosFiltrar(posicionadas, filtro);
  const cor = ppjPosCor(), hoje = typeof hojeISO === "function" ? hojeISO() : "";
  if(st.selecionada && !mostradas.some(e => e.id === st.selecionada)) st.selecionada = null;

  const marcas = new Map(), nos = [];
  for(const e of mostradas){
    const preenchimento = ppjPosPreenchimento(e, cor, hoje), chave = ppjPosChaveMarca(e, preenchimento);
    let no = st.marcas.get(e.id);
    if(!no || no.ppjChave !== chave || no.parentNode !== g){ no = ppjPosMarca(e, preenchimento); no.ppjChave = chave; }
    no.classList.toggle("ppj-selecionada", st.selecionada === e.id);
    if(typeof pplLeiMarcaClasse === "function") pplLeiMarcaClasse(no, e.id);
    marcas.set(e.id, no); nos.push(no);
  }
  ppjPosTrocarFilhos(g, nos);
  st.marcas = marcas;
  st.espacamento = ppjPosEspacamento(mostradas.map(e => st.mapa.get(e.id)), Number(folha.largura_px), Number(folha.altura_px));
  ppjPosColocar(st, true);
  const c = $("ppj-contagem");
  if(c) c.textContent = ppjPosResumo({ posicionadas: posicionadas.length, total: estacas.length, mostradas: mostradas.length, executadas: mostradas.filter(e => e.status === "executada").length })
    + (typeof ppjVinResumoFolha === "function" ? ppjVinResumoFolha(st) : "");

  const termo = filtro.termo.trim().toLowerCase();
  if(!termo){ st.buscaCentrada = ""; return; }
  if(mostradas.length !== 1) return;
  const chave = termo + "|" + mostradas[0].id;
  if(chave === st.buscaCentrada) return;
  st.buscaCentrada = chave;
  const t = ppjTamanho(), p = st.mapa.get(mostradas[0].id);
  if(t && _ppj.visor && p) ppjMexer(ppjPosCentrar(_ppj.visor, p.x, p.y, t.lw, t.lh, t.W, t.H));
}

function ppjPosTrocarFilhos(g, nos){
  const queridos = new Set(nos), ficam = [];
  for(const velho of Array.from(g.children)){ if(queridos.has(velho)) ficam.push(velho); else velho.remove(); }
  let j = 0;
  for(const no of nos){
    if(ficam[j] === no){ j++; continue; }
    g.insertBefore(no, ficam[j] || null);
    const k = ficam.indexOf(no, j);
    if(k >= 0) ficam.splice(k, 1);
  }
}

function ppjPosMoverMarca(no, x, y){
  const t = `translate(${x}, ${y})`;
  if(no.ppjLugar === t) return;
  no.setAttribute("transform", t);
  no.ppjLugar = t;
}


function ppjPosColocar(st, forcar){
  const v = _ppj.visor, folha = ppjFolhaAtual();
  if(!st.camada || !v || !folha || folha.id !== st.plantaId) return;
  const lw = Number(folha.largura_px), lh = Number(folha.altura_px);
  st.camada.setAttribute("transform", `translate(${v.tx}, ${v.ty})`);
  if(typeof pplLeiColocar === "function") pplLeiColocar(st);
  if(!forcar && v.z === st.zMarcas) return;
  st.zMarcas = v.z;
  for(const [id, no] of st.marcas){
    const p = st.mapa.get(id);
    if(p) ppjPosMoverMarca(no, p.x * lw * v.z, p.y * lh * v.z);
  }
  st.camada.classList.toggle("ppj-com-rotulo", ppjPosRotuloCabe(v.z, st.espacamento, st.marcas.size));
}

function ppjPosPainel(st){
  const painel = $("ppj-painel"), palco = $("ppj-palco");
  if(palco) palco.classList.toggle("ppj-editando", st.editando);
  if(!painel) return;
  if(!st.editando){
    painel.hidden = true;
    if(st.painelMontado){ painel.replaceChildren(); st.painelMontado = false; }
    return;
  }
  if(!st.painelMontado){ painel.innerHTML = ppjPosPainelHTML({ temLocal: !!st.local, local: st.local, todas: st.todas }); st.painelMontado = true; }
  painel.hidden = false;
  const estacas = ppjEstacas(), o = { local: st.local, todas: st.todas };
  const total = ppjPosSemPosicao(estacas, st.mapa, o);
  st.lista = st.termo ? ppjPosSemPosicao(estacas, st.mapa, { ...o, termo: st.termo }) : total;
  st.daVez = ppjPosDaVez(st.lista, st.daVez);
  const conta = $("ppj-ed-conta"), vez = $("ppj-ed-vez"), sel = $("ppj-ed-sel"), lista = $("ppj-ed-lista");
  if(conta) conta.textContent = `Sem posição nesta folha (${total.length})`;
  const daVez = st.lista.find(e => e.id === st.daVez), marcada = st.selecionada ? estacas.find(e => e.id === st.selecionada) : null;
  if(vez) vez.textContent = daVez ? `Estaca da vez: ${String(daVez.numero || "").trim() || "(sem nº)"}` : total.length ? "Nenhuma estaca nesta busca." : "Nenhuma estaca para posicionar.";
  if(sel) sel.innerHTML = marcada ? `<span>Selecionada: <strong>${esc(String(marcada.numero || "").trim() || "(sem nº)")}</strong></span><button type="button" class="btn-sec btn-sm txt-perigo" data-ppj-ed="tirar" title="Tirar esta estaca da folha (tecla Delete). A estaca continua na obra.">Tirar da folha</button>${  typeof pplLeiSelHTML === "function" ? pplLeiSelHTML(st, marcada) : ""}` : "";
  if(lista) lista.innerHTML = ppjPosListaHTML(st.lista, st.daVez, !!st.termo && total.length > 0);
}


function ppjPosEditar(st, liga){
  if(liga && (!st.disponivel || !ppjPodeEditar())) return;
  st.editando = !!liga;
  st.selecionada = null; st.arrasto = null; st.itemArrastado = null; st.termo = ""; st.erro = "";
  st.painelMontado = false;
  const painel = $("ppj-painel");
  if(painel) painel.replaceChildren();
  ppjPosPintar(st);
}
function ppjPosSelecionar(st, id){
  st.selecionada = id || null;
  for(const [mid, no] of st.marcas) no.classList.toggle("ppj-selecionada", mid === st.selecionada);
  ppjPosPainel(st);
}
function ppjPosMudarCor(st, modo){
  const cor = modo === "maquina" ? "maquina" : "status";
  if(typeof _plantaCor !== "undefined") _plantaCor = cor;
  document.querySelectorAll("[data-planta-cor]").forEach(b => b.classList.toggle("ativo", b.dataset.plantaCor === cor));
  if(st.disponivel) ppjPosPintar(st);
}


function ppjPosFazer(st, acao){
  if(!st.editando || !st.disponivel || !ppjPodeEditar() || !ppjPosAcaoVale(acao)) return;
  st.erro = "";
  st.mapa = ppjPosAplicar(st.mapa, ppjPosOperacao(acao));
  st.pilha = ppjPosEmpilhar(st.pilha, acao);
  if(acao.tipo === "tirar") st.selecionada = null;
  ppjPosGuardar(st);
  ppjPosPintar(st);
  ppjPosEnviar(st, ppjPosOperacao(acao), () => {
    st.pilha = st.pilha.filter(a => a !== acao);
    st.mapa = ppjPosAplicar(st.mapa, ppjPosInverso(acao));
    if(acao.tipo === "posicionar") st.daVez = acao.estaca_id;
  });
  if(typeof pplLeiAposAcao === "function") pplLeiAposAcao(st, acao);
}
function ppjPosDesfazer(st){
  if(!st.editando || !st.disponivel || !ppjPodeEditar()) return;
  const r = ppjPosDesempilhar(st.pilha);
  if(!r.acao) return;
  if(r.acao.composta){
    if(typeof ppjSeqDesfazer !== "function") return;
    st.pilha = r.pilha;
    st.selecionada = null;
    ppjSeqDesfazer(st, r.acao);
    return;
  }
  const op = ppjPosInverso(r.acao);
  st.erro = "";
  st.pilha = r.pilha;
  st.mapa = ppjPosAplicar(st.mapa, op);
  st.selecionada = null;
  if(r.acao.tipo === "posicionar") st.daVez = r.acao.estaca_id;
  ppjPosGuardar(st);
  ppjPosPintar(st);
  ppjPosEnviar(st, op, () => {
    st.mapa = ppjPosAplicar(st.mapa, ppjPosOperacao(r.acao));
    st.pilha = ppjPosEmpilhar(st.pilha, r.acao);
  });
}

function ppjPosPosicionar(st, estacaId, p){
  const t = ppjTamanho();
  if(!st.editando || !estacaId || !t || !_ppj.visor || st.mapa.has(estacaId) || !ppjEstacas().some(e => e.id === estacaId)) return;
  const f = ppjPosFracao(_ppj.visor, p.x, p.y, t.lw, t.lh);
  if(!f) return;
  if(estacaId === st.daVez) st.daVez = ppjPosProxima(st.lista, estacaId);
  ppjPosFazer(st, { tipo: "posicionar", estaca_id: estacaId, depois: f });
}
function ppjPosTirar(st, estacaId){
  const antes = st.mapa.get(estacaId);
  if(antes) ppjPosFazer(st, { tipo: "tirar", estaca_id: estacaId, antes });
}


function ppjPosEnviar(st, op, aoFalhar){
  st.pendentes++;
  st.fila = st.fila.then(async () => {
    let r;
    try { r = await ppjPosGravar(st.plantaId, st.obraId, op); }
    catch(e){ r = { ok: false, erro: e }; }
    st.pendentes--;
    if(r.ok) ppjPosGuardar(st);
    else {
      if(r.erro) console.error("Estacas na folha, gravação:", r.erro);
      aoFalhar();
      st.erro = ppjPosMensagem(r.erro);
      aviso("app-aviso", st.erro, "erro");
      st.reler = true;
      ppjPosGuardar(st);
      if(st === _ppjPos) ppjPosPintar(st);
    }



    if(!st.reler || st.pendentes) return;
    st.reler = false;
    _ppjPosCache.delete(st.plantaId);
    const lido = await ppjPosBuscar(st.plantaId);
    if(!lido.mapa || st.pendentes){ st.reler = true; ppjPosGuardar(st); return; }
    st.mapa = lido.mapa;
    if(st === _ppjPos) ppjPosPintar(st);
  }).catch(e => console.error("Estacas na folha, fila de gravação:", e));
}

async function ppjPosGravar(plantaId, obraId, op){
  if(op.op === "gravar"){
    const linha = ppjPosLinha(plantaId, op.estaca_id, obraId, op.x, op.y);
    if(!linha) return { ok: false, erro: { message: "posição inválida" } };
    const r = await sb.from(PPJ_POS_TABELA).upsert(linha, { onConflict: "planta_id,estaca_id" }).select(PPJ_POS_COLUNAS);
    return r.error ? { ok: false, erro: r.error } : { ok: !!(r.data && r.data.length) };
  }
  const estacaId = op.estaca_id;
  const r = await sb.from(PPJ_POS_TABELA).delete().eq("planta_id", plantaId).eq("estaca_id", estacaId).select("estaca_id");
  return r.error ? { ok: false, erro: r.error } : { ok: !!(r.data && r.data.length) };
}
function ppjPosMensagem(erro){
  if(!erro) return "A mudança não foi gravada: seu cargo não altera a posição das estacas nesta obra, ou outra pessoa mexeu nesta folha. A tela foi atualizada.";
  if(typeof ehErroDePermissao === "function" && ehErroDePermissao(erro)) return "Seu cargo não altera a posição das estacas nesta obra. Nada foi gravado.";
  return "Não foi possível gravar a posição da estaca: " + (erro.message || erro);
}




function ppjPosAgarrar(ev, p){
  const st = _ppjPos;
  if(!st.editando || !st.disponivel || st.ponteiros.size > 0 || !ppjPodeEditar()) return false;
  const id = ppjPosMarcaDe(ev.target), antes = id ? st.mapa.get(id) : null, t = ppjTamanho();
  const tela = antes && t && _ppj.visor ? ppjPosTela(_ppj.visor, antes.x, antes.y, t.lw, t.lh) : null;
  if(!tela) return false;
  st.arrasto = { ponteiro: ev.pointerId, id, antes, x0: p.x, y0: p.y, tela, moveu: false, pos: null };
  const palco = $("ppj-palco");
  try { if(palco) palco.setPointerCapture(ev.pointerId); } catch(e){   }
  return true;
}
function ppjPosLigarPalco(palco){
  if(palco.ppjPosLigado) return;
  palco.ppjPosLigado = true;
  palco.addEventListener("pointerdown", (ev) => {
    const st = _ppjPos;
    if(ev.pointerType === "mouse" && ev.button !== 0) return;
    if(ev.target && ev.target.closest && ev.target.closest(".ppj-controles")) return;
    st.ponteiros.add(ev.pointerId);
    if(st.arrasto && st.arrasto.ponteiro === ev.pointerId) return;
    if(st.ponteiros.size > 1){ st.toque = null; return; }
    const p = ppjPosPontoDoPalco(palco, ev);
    st.toque = { ponteiro: ev.pointerId, x0: p.x, y0: p.y, id: ppjPosMarcaDe(ev.target), moveu: false };
  });
  palco.addEventListener("pointermove", (ev) => {
    const st = _ppjPos, a = st.arrasto, q = st.toque, p = ppjPosPontoDoPalco(palco, ev);
    if(a && a.ponteiro === ev.pointerId){
      if(!a.moveu && Math.hypot(p.x - a.x0, p.y - a.y0) <= PPJ_POS_TOQUE_PX) return;
      a.moveu = true;
      const t = ppjTamanho(), no = st.marcas.get(a.id);
      if(!t || !_ppj.visor) return;
      a.pos = ppjPosFracao(_ppj.visor, a.tela.x + p.x - a.x0, a.tela.y + p.y - a.y0, t.lw, t.lh, true);
      if(no && a.pos) ppjPosMoverMarca(no, a.pos.x * t.lw * _ppj.visor.z, a.pos.y * t.lh * _ppj.visor.z);
      return;
    }
    if(q && q.ponteiro === ev.pointerId && !q.moveu && Math.hypot(p.x - q.x0, p.y - q.y0) > PPJ_POS_TOQUE_PX) q.moveu = true;
  });
  const soltar = (ev, cancelado) => {
    const st = _ppjPos, a = st.arrasto, q = st.toque;
    st.ponteiros.delete(ev.pointerId);
    if(a && a.ponteiro === ev.pointerId){
      st.arrasto = null;
      if(!cancelado && a.moveu && a.pos && (a.pos.x !== a.antes.x || a.pos.y !== a.antes.y)) ppjPosFazer(st, { tipo: "mover", estaca_id: a.id, antes: a.antes, depois: a.pos });
      else if(cancelado || a.moveu) ppjPosColocar(st, true);
      else if(typeof ppjSeqCliqueMarca === "function" && ppjSeqCliqueMarca(st, a.id, ev)){   }
      else ppjPosSelecionar(st, st.selecionada === a.id ? null : a.id);
      return;
    }
    if(!q || q.ponteiro !== ev.pointerId) return;
    st.toque = null;
    if(cancelado || q.moveu) return;
    if(q.id){ if(!st.editando && st.mapa.has(q.id)) ppjPosAbrirEstaca(q.id); return; }
    if(!st.editando) return;
    if(typeof ppjSeqCliqueVazio === "function" && ppjSeqCliqueVazio(st, ppjPosPontoDoPalco(palco, ev))) return;
    if(st.daVez) ppjPosPosicionar(st, st.daVez, ppjPosPontoDoPalco(palco, ev));
    else if(st.selecionada) ppjPosSelecionar(st, null);
  };
  palco.addEventListener("pointerup", (ev) => soltar(ev, false));
  palco.addEventListener("pointercancel", (ev) => soltar(ev, true));

  palco.addEventListener("dragover", (ev) => {
    const st = _ppjPos;
    if(!st.editando || !st.itemArrastado) return;
    ev.preventDefault();
    if(ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  });
  palco.addEventListener("drop", (ev) => {
    const st = _ppjPos, id = st.itemArrastado;
    st.itemArrastado = null;
    if(!st.editando || !id) return;
    ev.preventDefault();
    ppjPosPosicionar(st, id, ppjPosPontoDoPalco(palco, ev));
  });
}


function ppjPosClique(ev){
  const st = _ppjPos, alvo = ev.target;
  if(!alvo || !alvo.closest) return;
  const cor = alvo.closest("[data-ppj-cor]");
  if(cor) return void ppjPosMudarCor(st, cor.dataset.ppjCor);
  const ed = alvo.closest("[data-ppj-ed]");
  if(ed){
    if(ed.disabled) return;
    const acao = ed.dataset.ppjEd;
    if(acao === "entrar" || acao === "concluir"){
      ppjPosEditar(st, acao === "entrar");

      const f = $("ppj-ferramentas"), novo = f && f.querySelector ? f.querySelector(st.editando ? '[data-ppj-ed="concluir"]' : '[data-ppj-ed="entrar"]') : null;
      if(novo && novo.focus) novo.focus({ preventScroll: true });
    }
    else if(acao === "desfazer") ppjPosDesfazer(st);
    else if(acao === "tirar" && st.editando && st.selecionada) ppjPosTirar(st, st.selecionada);
    return;
  }
  const item = alvo.closest("[data-ppj-item]");
  if(item && st.editando){ st.daVez = item.dataset.ppjItem; ppjPosPainel(st); }
}
function ppjPosTecla(ev){
  const st = _ppjPos, alvo = ev.target, tecla = String(ev.key || "");
  const ativar = tecla === "Enter" || tecla === " ";
  const marca = ppjPosMarcaDe(alvo), item = alvo && alvo.closest ? alvo.closest("[data-ppj-item]") : null;
  if(marca && ativar){
    ev.preventDefault();
    if(st.editando) ppjPosSelecionar(st, st.selecionada === marca ? null : marca);
    else if(st.mapa.has(marca)) ppjPosAbrirEstaca(marca);
    return;
  }
  if(item && ativar && st.editando){ ev.preventDefault(); st.daVez = item.dataset.ppjItem; ppjPosPainel(st); return; }
  if(!st.editando || /^(INPUT|TEXTAREA|SELECT)$/.test(String((alvo && alvo.tagName) || "").toUpperCase())) return;
  if(tecla === "Delete" && st.selecionada){ ev.preventDefault(); ppjPosTirar(st, st.selecionada); }
  else if((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && tecla.toLowerCase() === "z"){ ev.preventDefault(); ppjPosDesfazer(st); }
}
function ligarPlantaPosicoes(){
  if(typeof $ !== "function") return;
  const visor = $("ppj-visor");
  if(!visor) return;
  visor.addEventListener("click", ppjPosClique);
  visor.addEventListener("keydown", ppjPosTecla);
  visor.addEventListener("input", (ev) => {
    const st = _ppjPos;
    if(!st.editando || !ev.target || ev.target.id !== "ppj-ed-busca") return;
    st.termo = String(ev.target.value || "").trim();
    ppjPosPainel(st);
  });
  visor.addEventListener("change", (ev) => {
    const st = _ppjPos;
    if(!st.editando || !ev.target || ev.target.id !== "ppj-ed-todas") return;
    st.todas = !!ev.target.checked;
    ppjPosPainel(st);
  });
  visor.addEventListener("dragstart", (ev) => {
    const st = _ppjPos, item = ev.target && ev.target.closest ? ev.target.closest("[data-ppj-item]") : null;
    if(!item || !st.editando) return;
    st.itemArrastado = item.dataset.ppjItem;
    if(ev.dataTransfer){ ev.dataTransfer.setData("text/plain", st.itemArrastado); ev.dataTransfer.effectAllowed = "move"; }
  });
  visor.addEventListener("dragend", () => { _ppjPos.itemArrastado = null; });

  document.addEventListener("keydown", (ev) => {
    const st = _ppjPos;
    if(!st.editando || ev.target !== document.body || visor.style.display === "none") return;
    if((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && String(ev.key || "").toLowerCase() === "z"){ ev.preventDefault(); ppjPosDesfazer(st); }
  });
}

if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarPlantaPosicoes);
  else ligarPlantaPosicoes();
}


if(typeof module === "object" && module && module.exports){
  Object.assign(module.exports, { PPJ_POS_TABELA, PPJ_POS_COLUNAS, PPJ_POS_DESFAZER_MAX, PPJ_POS_RAIO, PPJ_POS_TOQUE_PX, PPJ_POS_ROTULO_MIN_PX, PPJ_POS_ZOOM_BUSCA, PPJ_POS_LISTA_MAX,
    ppjPosArredondar, ppjPosFracao, ppjPosTela, ppjPosCentrar, ppjPosCompararNomes, ppjPosOrdenar, ppjPosFiltrar, ppjPosSemPosicao, ppjPosDaVez, ppjPosProxima,
    ppjPosOperacao, ppjPosInverso, ppjPosAplicar, ppjPosEmpilhar, ppjPosDesempilhar, ppjPosResumo, ppjPosEspacamento, ppjPosRotuloCabe, ppjPosLinha, ppjPosTabelaAusente,
    ppjPosTitulo, ppjPosNoPalco, ppjPosChaveMarca, ppjPosFerramentasHTML, ppjPosPainelHTML, ppjPosListaHTML, ppjPosStatusRotulo });
}

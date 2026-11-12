/* ====================================================================
   Módulo: estacas por cima da folha do projeto do cliente — fase 167b (continua o prefixo ppj-)
   Carregado logo depois de js/planta_projeto.js, que chama este arquivo por ganchos guardados por typeof (ppjPosMontar,
   ppjPosAtualizar, ppjPosVisor, ppjPosAgarrar, ppjPosSair e ppjPosAbrirPrimeira). Sem este arquivo, a folha é só o fundo.
   - Cada estaca posicionada numa folha é um marcador em SVG por cima da imagem: raio constante na tela, cor por status ou
     por máquina (o mesmo alternador do Esquema), contorno por status, nome inteiro no rótulo quando cabe no zoom e sempre
     no title. Valem os filtros da aba (status, tipo e busca); busca com um resultado leva a estaca ao centro.
   - Modo de leitura (padrão): clicar na estaca abre a execução dela. Nada se move.
   - Modo de edição, separado ("Editar posições", só para quem edita estaca; faixa âmbar enquanto ligado; "Concluir" sai):
     clicar num ponto vazio posiciona a estaca da vez e passa para a próxima; arrastar um item da lista até o desenho
     faz o mesmo; arrastar um marcador move; clicar nele seleciona e mostra "Tirar da folha" (tecla Delete); "Desfazer"
     (Ctrl+Z) guarda as últimas 50 ações. Cada ação grava na hora e confere a linha que voltou; se o banco recusa, o
     marcador volta e a tela avisa, ao lado da folha (a faixa de aviso do topo fica fora da vista de quem está no desenho).
     Recusa com outras gravações na fila: quando a fila esvazia, a folha é relida do banco.
   - A folha é papel branco nos dois temas: contorno e nome do marcador usam --doc-tinta e --doc-papel, que não trocam.
   - Tabela public.estacas_planta_posicao (migration 20261111_fase167b_estacas_planta_posicao.sql): a posição é fração da
     largura e da altura da imagem da folha (0 a 1). NÃO é coordenada: a coordenada real da estaca não é lida nem gravada
     aqui, e a regra de distância continua só no Esquema. SEM a migration no banco a leitura acusa tabela ausente e o
     módulo se cala: nenhum marcador, nenhum botão, a folha fica como era, sem erro do código no console.
   - Grava: diretor, admin, engenheiro, assistente de engenharia e encarregado (ppjPodeEditar), nunca o usuário de
     revisão. O banco decide; a tela só esconde o que a pessoa não pode usar.
   - Os módulos carregados depois continuam esta tela por ganchos guardados por typeof, e sem eles nada muda aqui:
     js/planta_vinculo.js (fase 169a, executadas sem vínculo: ppjVinExtraBarra, ppjVinResumoFolha, ppjVinPintar e
     ppjVinCliqueEstaca) e js/planta_sequencia.js (fase 169b, por bloco e em sequência: ppjSeqFaixa, ppjSeqPintar,
     ppjSeqVisor, ppjSeqCliqueVazio, ppjSeqCliqueMarca e ppjSeqDesfazer; as ações dele na pilha de desfazer levam
     composta = true). Para eles, ppjPosAvisar põe um aviso na caixa acima da folha.
   As funções ppjPosArredondar, ppjPosFracao, ppjPosTela, ppjPosCompararNomes, ppjPosOrdenar, ppjPosSemPosicao, ppjPosDaVez,
   ppjPosProxima, ppjPosEmpilhar, ppjPosDesempilhar, ppjPosOperacao, ppjPosInverso, ppjPosAplicar, ppjPosFiltrar,
   ppjPosResumo, ppjPosEspacamento, ppjPosRotuloCabe, ppjPosCentrar, ppjPosLinha, ppjPosTabelaAusente, ppjPosTitulo,
   ppjPosNoPalco, ppjPosChaveMarca e as que montam HTML são puras (sem tela nem banco) e testadas por
   scripts/testar-fase167b.mjs.
   ==================================================================== */

const PPJ_POS_TABELA = "estacas_planta_posicao";
const PPJ_POS_COLUNAS = "estaca_id,x_frac,y_frac";
const PPJ_POS_NS = "http://www.w3.org/2000/svg";
const PPJ_POS_DESFAZER_MAX = 50;         // ações guardadas para o Desfazer
const PPJ_POS_RAIO = 8;                  // raio do marcador, em pixels de tela (não muda com o zoom)
const PPJ_POS_TOQUE_PX = 5;              // até aqui o ponteiro não andou: é clique, não arrasto
const PPJ_POS_ROTULO_MIN_PX = 56;        // distância na tela até o vizinho para o nome caber ao lado do marcador
const PPJ_POS_ZOOM_BUSCA = 4;            // a estaca achada pela busca aparece com pelo menos 4 vezes o "cabe na tela"
const PPJ_POS_AMOSTRA = 600;             // estacas medidas para estimar o espaçamento (obra grande)
const PPJ_POS_LISTA_MAX = 300;           // itens desenhados na lista "Sem posição" (o resto, pela busca)
const PPJ_POS_STATUS = { prevista: "Prevista", em_execucao: "Em execução", perfuracao_concluida: "Perfuração concluída", armacao_aplicada: "Armação aplicada", executada: "Executada", refugada: "Refurada" };
/* contorno por status, no desenho de desenharEstaca (js/estacas.js): quem não distingue as cores ainda separa os estados.
   A folha é papel branco nos dois temas, então o contorno usa a tinta e o papel do documento (--doc-*, iguais no claro e
   no escuro): com --txt, no tema escuro o contorno da executada saía branco sobre o papel branco e sumia. */
const PPJ_POS_TRACO = {
  prevista:             { stroke: "var(--doc-papel)", w: "1.5", dash: "",    op: "" },
  em_execucao:          { stroke: "var(--doc-tinta)", w: "2",   dash: "4 2", op: "0.7" },
  perfuracao_concluida: { stroke: "var(--doc-tinta)", w: "2",   dash: "4 2", op: "0.7" },
  armacao_aplicada:     { stroke: "var(--doc-tinta)", w: "2",   dash: "4 2", op: "0.7" },
  executada:            { stroke: "var(--doc-tinta)", w: "2.5", dash: "",    op: "" },
  refugada:             { stroke: "var(--doc-tinta)", w: "2.5", dash: "2 2", op: "" }
};

/* ---------- fração ↔ pixel ----------
   A posição gravada é fração da largura e da altura da imagem da folha: (0, 0) é o canto de cima à esquerda e (1, 1) o
   de baixo à direita. O visor { z, tx, ty } é o de js/planta_projeto.js: um ponto (x, y) da folha, em pixels da imagem
   alta (lw × lh), aparece no palco em (x·z + tx, y·z + ty). */
function ppjPosArredondar(n){
  if(n === null || n === undefined || n === "") return null;
  const v = Number(n);
  if(!Number.isFinite(v)) return null;
  return Math.round(Math.min(1, Math.max(0, v)) * 1e6) / 1e6;
}
const ppjPosPonto = (p) => !!p && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y);
/* Ponto do palco (px, py) → fração da folha { x, y }, com 6 casas. Fora da folha devolve nulo; com prender = true
   (marcador sendo arrastado), para na borda. */
function ppjPosFracao(v, px, py, lw, lh, prender){
  if(!v || !ppjNum(v.z) || !ppjNum(v.tx) || !ppjNum(v.ty) || !(v.z > 0) || !ppjNum(px) || !ppjNum(py) || !(lw > 0) || !(lh > 0)) return null;
  const x = (px - v.tx) / (lw * v.z), y = (py - v.ty) / (lh * v.z);
  if(!prender && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: ppjPosArredondar(x), y: ppjPosArredondar(y) };
}
/* Ponto do ponteiro (clientX, clientY) → ponto do palco, na mesma origem da imagem e dos marcadores: o canto de dentro da
   borda. r = getBoundingClientRect() do palco (que inclui a borda); bordaEsq e bordaTopo = clientLeft e clientTop dele.
   Sem descontar a borda, a estaca ficava 1 pixel de tela abaixo e à direita do ponto clicado. */
function ppjPosNoPalco(r, bordaEsq, bordaTopo, clientX, clientY){
  const b = (v) => (ppjNum(v) ? v : 0);
  return { x: clientX - b(r && r.left) - b(bordaEsq), y: clientY - b(r && r.top) - b(bordaTopo) };
}
/* Fração da folha → ponto do palco { x, y } */
function ppjPosTela(v, xf, yf, lw, lh){
  if(!v || !ppjNum(v.z) || !ppjNum(v.tx) || !ppjNum(v.ty) || !ppjNum(xf) || !ppjNum(yf) || !(lw > 0) || !(lh > 0)) return null;
  return { x: xf * lw * v.z + v.tx, y: yf * lh * v.z + v.ty };
}
/* Leva a estaca ao centro do palco, com pelo menos 4 vezes o "cabe na tela" (quem já está mais perto não perde o zoom) */
function ppjPosCentrar(v, xf, yf, lw, lh, W, H){
  const atual = ppjLimitar(v, lw, lh, W, H);
  if(!ppjNum(xf) || !ppjNum(yf)) return atual;
  const base = ppjAjustar(lw, lh, W, H);
  const z = Math.min(base.z * PPJ_ZOOM_MAX, Math.max(atual.z, base.z * PPJ_POS_ZOOM_BUSCA));
  return ppjLimitar({ z, tx: W / 2 - xf * lw * z, ty: H / 2 - yf * lh * z }, lw, lh, W, H);
}

/* ---------- ordem natural do nome ----------
   Cada número do nome conta como número (E2 antes de E10) e número vem antes de letra (B1.1 antes de BB1.1). B1.1 e
   BB1.1 são estacas diferentes: nomes diferentes nunca empatam. Caixa e espaço das pontas não contam. */
function ppjPosPartes(nome){ return String(nome ?? "").trim().toUpperCase().match(/\d+|\D+/g) || []; }
function ppjPosCompararNomes(a, b){
  const pa = ppjPosPartes(a), pb = ppjPosPartes(b);
  for(let i = 0; i < Math.min(pa.length, pb.length); i++){
    const x = pa[i], y = pb[i], nx = /^\d/.test(x), ny = /^\d/.test(y);
    if(nx && ny){
      const d = Number(x) - Number(y);
      if(d) return d < 0 ? -1 : 1;
      if(x.length !== y.length) return x.length < y.length ? -1 : 1;   // E1 antes de E01
    } else if(nx !== ny) return nx ? -1 : 1;
    else if(x !== y) return x < y ? -1 : 1;
  }
  return pa.length === pb.length ? 0 : pa.length < pb.length ? -1 : 1;
}
function ppjPosOrdenar(estacas){
  return (Array.isArray(estacas) ? estacas : []).filter(Boolean).slice().sort((a, b) => ppjPosCompararNomes(a.numero, b.numero) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
}

/* ---------- filtros ---------- */
const ppjPosTexto = (e) => `${e.numero || ""} ${e.observacoes || ""} ${e.local || ""} ${e.bloco || ""}`.toLowerCase();
/* Os filtros da aba que valem para os marcadores: status, tipo e busca (a mesma busca da lista). O filtro de local não
   esconde marcador: ele já escolhe quais folhas aparecem, e a folha sem local mostra as estacas de todos os locais. */
function ppjPosFiltrar(estacas, f){
  const p = f || {}, termo = String(p.termo || "").trim().toLowerCase();
  return (Array.isArray(estacas) ? estacas : []).filter(e => e && (!p.status || e.status === p.status) && (!p.tipo || e.tipo === p.tipo) && (!termo || ppjPosTexto(e).includes(termo)));
}
/* A lista "Sem posição nesta folha": estacas da obra que ainda não estão no mapa da folha, em ordem natural.
   o = { local: o da folha (vazio = folha sem local), todas: mostrar as de todos os locais, termo: busca do painel }. */
function ppjPosSemPosicao(estacas, mapa, o){
  const p = o || {}, local = String(p.local || "").trim(), termo = String(p.termo || "").trim().toLowerCase();
  const tem = (id) => !!mapa && typeof mapa.has === "function" && mapa.has(id);
  return ppjPosOrdenar((Array.isArray(estacas) ? estacas : []).filter(e => e && !tem(e.id)
    && (p.todas || !local || String(e.local || "").trim() === local) && (!termo || ppjPosTexto(e).includes(termo))));
}
/* A estaca da vez: a escolhida, se ainda está na lista; senão a primeira; lista vazia = nenhuma */
function ppjPosDaVez(lista, atualId){
  const l = Array.isArray(lista) ? lista : [];
  return l.some(e => e.id === atualId) ? atualId : l.length ? l[0].id : null;
}
/* A que vem depois da estaca da vez (antes de ela sair da lista). Depois da última, volta à primeira que sobrou. */
function ppjPosProxima(lista, atualId){
  const l = Array.isArray(lista) ? lista : [], i = l.findIndex(e => e.id === atualId);
  if(i < 0) return l.length ? l[0].id : null;
  return l.length <= 1 ? null : l[(i + 1) % l.length].id;
}

/* ---------- desfazer ----------
   Ação = { tipo: "posicionar" | "mover" | "tirar", estaca_id, antes: { x, y }, depois: { x, y } } (posicionar não tem
   antes; tirar não tem depois). Operação = o que vai ao banco: { op: "gravar", estaca_id, x, y } ou { op: "tirar",
   estaca_id }. O mapa da folha é Map(estaca_id → { x, y }) e nunca é alterado no lugar. */
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

/* ---------- legenda, rótulo e linha gravada ---------- */
/* o = { posicionadas: estacas da obra nesta folha, total: estacas da obra, mostradas: as que passam nos filtros,
   executadas: entre as mostradas } */
function ppjPosResumo(o){
  const p = o || {}, n = (v) => Math.max(0, Math.trunc(Number(v) || 0));
  const pos = n(p.posicionadas), mostradas = n(p.mostradas), exec = Math.min(n(p.executadas), mostradas);
  return `${pos} de ${n(p.total)} estacas da obra posicionadas nesta folha`
    + (mostradas ? ` · ${exec} de ${mostradas} executadas (${Math.round(exec / mostradas * 100)}%)` : "")
    + (pos > mostradas ? ` · ${pos - mostradas} fora do filtro` : "");
}
/* Espaçamento típico entre as estacas da folha: mediana da distância ao vizinho mais próximo, em pixels da imagem
   alta. Uma estaca só (ou nenhuma) não tem vizinho: infinito. Obra grande é medida por amostra. */
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
/* O nome inteiro cabe ao lado do marcador? Sim quando o vizinho típico está longe o bastante na tela. */
function ppjPosRotuloCabe(z, espacamento, n){
  if(!(n >= 1) || !(z > 0)) return false;
  return n === 1 || z >= PPJ_POS_ROTULO_MIN_PX / espacamento;
}
/* A linha que vai ao banco. Só com uuid de verdade e fração de 0 a 1; quem marcou e quando são do banco. */
function ppjPosLinha(plantaId, estacaId, obraId, x, y){
  if(![plantaId, estacaId, obraId].every(id => PPJ_UUID_RE.test(String(id || "")))) return null;
  if(typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { planta_id: plantaId, estaca_id: estacaId, obra_id: obraId, x_frac: ppjPosArredondar(x), y_frac: ppjPosArredondar(y) };
}
/* A tabela de posições ainda não existe (migration não aplicada)? Qualquer outro erro é erro de verdade. */
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
/* texto do title do marcador: nome inteiro, status e onde fica */
function ppjPosTitulo(e){
  const p = e || {};
  return [String(p.numero || "").trim() || "Estaca", ppjPosStatusRotulo(p.status), String(p.local || "").trim(), String(p.bloco || "").trim()].filter(Boolean).join(" · ");
}

/* O que o marcador mostra, em uma chave: enquanto ela não muda, o nó do marcador é reaproveitado. Em obra grande cada
   ação refazia os mil marcadores da folha (0,1 a 0,3 s por clique); com a chave, mexe só no que mudou. */
function ppjPosChaveMarca(e, preenchimento){
  const p = e || {};
  return JSON.stringify([String(preenchimento || ""), String(p.status || ""), ppjPosTitulo(p), String(p.numero || "").trim()]);
}

/* ---------- HTML ---------- */
function ppjPosLegendaHTML(cor, maquinas){
  if(cor === "maquina"){
    const l = Array.isArray(maquinas) ? maquinas : [];
    return l.length ? l.map(m => `<span><i class="ppj-leg" data-ppj-maq="${esc(m.id)}"></i>${esc(m.rotulo)}</span>`).join("") : `<span class="meta">nenhuma máquina atribuída às estacas</span>`;
  }
  return Object.keys(PPJ_POS_TRACO).map(st => `<span title="${esc(ppjPosStatusRotulo(st))}"><i class="ppj-leg ppj-leg-${esc(st)}"></i>${esc(ppjPosStatusRotulo(st))}</span>`).join("")
    + `<span title="Executada hoje"><i class="ppj-leg ppj-leg-hoje"></i>Hoje</span>`;
}
/* s = { podeEditar, editando, cor: "status" | "maquina", desfazer: ações na pilha, maquinas: [{ id, rotulo }], erro, extra,
         instrucao, nota }. instrucao troca o texto da faixa do modo de edição e nota entra no fim dela (fase 169b).
   A barra da folha: alternador de cor, legenda e, só para quem edita, o modo de edição. erro = a última gravação que o
   banco recusou, dita aqui, ao lado da folha (o aviso do topo da página fica fora da vista de quem está no desenho).
   extra = botões já montados e escapados pelos módulos que continuam esta tela; entram antes dos botões de edição. */
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
      <div class="serv-views" role="group" aria-label="Cor das estacas">${/* html */ botao("status", "Por status", "Cor da estaca pelo status dela")}${/* html */ botao("maquina", "Por máquina", "Cor da estaca pela máquina que a executa")}</div>
      <div class="planta-legenda ppj-legenda">${/* html */ ppjPosLegendaHTML(cor, p.maquinas)}</div>
      <span class="ppj-barra-acoes">${/* html */ p.extra || ""}${/* html */ acoes}</span>
    </div>${/* html */ faixa}${/* html */ erro}`;
}
/* s = { temLocal, local, todas }. O esqueleto do painel lateral do modo de edição; contador, estaca da vez, selecionada
   e lista são preenchidos depois, sem recriar o campo de busca. */
function ppjPosPainelHTML(s){
  const p = s || {};
  return `<div class="rotulo-caps" id="ppj-ed-conta">Sem posição nesta folha</div>
    <div class="ppj-ed-sel" id="ppj-ed-sel"></div>
    <p class="ppj-ed-vez" id="ppj-ed-vez"></p>
    <input id="ppj-ed-busca" type="search" placeholder="Buscar estaca…" aria-label="Buscar estaca sem posição nesta folha" autocomplete="off" />
    ${p.temLocal ? `<label class="ppj-check" title="Esta folha é do local ${esc(p.local)}. Marque para listar também as estacas dos outros locais."><input type="checkbox" id="ppj-ed-todas"${p.todas ? " checked" : ""} /> Todos os locais (a folha é de ${esc(p.local)})</label>` : ""}
    <div class="ppj-lista" id="ppj-ed-lista" role="group" aria-label="Estacas sem posição nesta folha"></div>`;
}
/* os itens da lista: clicar faz da estaca a da vez; arrastar até o desenho posiciona. buscando = a busca do painel não
   achou nenhuma das estacas que ainda estão sem posição (não é o mesmo que estarem todas na folha). */
function ppjPosListaHTML(lista, daVez, buscando){
  const l = Array.isArray(lista) ? lista : [];
  if(!l.length) return uiVazio(buscando ? "Nenhuma estaca sem posição com esse nome. Confira a busca." : "Nenhuma estaca sem posição aqui: as deste filtro já estão nesta folha.");
  return l.slice(0, PPJ_POS_LISTA_MAX).map(e => {
    const sub = [e.local, e.bloco].map(x => String(x || "").trim()).filter(Boolean).join(" · ");
    return `<div class="ppj-item${e.id === daVez ? " ativo" : ""}" role="button" tabindex="0" data-ppj-item="${esc(e.id)}" draggable="true" aria-pressed="${e.id === daVez ? "true" : "false"}" title="Clique para fazer desta a estaca da vez, ou arraste até o desenho"><span class="ppj-item-nome">${esc(String(e.numero || "").trim() || "(sem nº)")}</span>${sub ? `<span class="ppj-item-sub">${esc(sub)}</span>` : ""}</div>`;
  }).join("") + (l.length > PPJ_POS_LISTA_MAX ? `<p class="ppj-item-mais">e mais ${l.length - PPJ_POS_LISTA_MAX}: use a busca para achar.</p>` : "");
}

/* ====================================================================
   Tela
   ==================================================================== */
function ppjPosEstadoNovo(folha){
  return { plantaId: folha ? folha.id : null, obraId: folha ? (folha.obra_id || _ppj.obraId) : null, local: folha ? String(folha.local || "").trim() : "",
    mapa: new Map(), disponivel: false, lendo: false, editando: false, daVez: null, selecionada: null, pilha: [], lista: [], todas: false, termo: "",
    arrasto: null, toque: null, ponteiros: new Set(), itemArrastado: null, svg: null, camada: null, marcas: new Map(), zMarcas: 0, espacamento: Infinity,
    buscaCentrada: "", chaveBarra: "", painelMontado: false, pendentes: 0, fila: Promise.resolve(), erro: "", reler: false };
}
let _ppjPos = ppjPosEstadoNovo(null);   // trocado inteiro a cada folha montada
let _ppjPosAusenteEm = 0;               // quando a leitura acusou tabela ausente (migration não aplicada)
const _ppjPosCache = new Map();         // folha → { mapa, em }: trocar de folha e voltar não relê antes de um minuto
const _ppjPosPedidos = new Map();       // folha → leitura em curso

const ppjPosIndisponivel = () => _ppjPosAusenteEm > 0 && Date.now() - _ppjPosAusenteEm < PPJ_AUSENTE_MS;
const ppjPosValor = (id) => { const el = $(id); return el ? String(el.value || "") : ""; };
const ppjPosCor = () => (typeof _plantaCor !== "undefined" && _plantaCor === "maquina" ? "maquina" : "status");
const ppjPosPontoDoPalco = (palco, ev) => ppjPosNoPalco(palco.getBoundingClientRect(), palco.clientLeft, palco.clientTop, ev.clientX, ev.clientY);
const ppjPosMarcaDe = (alvo) => { const no = alvo && alvo.closest ? alvo.closest("[data-ppj-estaca]") : null; return no ? no.getAttribute("data-ppj-estaca") : null; };
const ppjPosGuardar = (st) => { if(st.plantaId) _ppjPosCache.set(st.plantaId, { mapa: st.mapa, em: Date.now() }); };

/* ---------- leitura ----------
   Devolve { mapa } | { ausente: true } (banco sem a tabela: não pergunta de novo por 5 minutos) | { erro }.
   Pode passar de 1.000 linhas (a maior obra tem 1.478 estacas): lerTudo, com a chave estaca_id. */
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

/* Gancho de ppjLer (primeira leitura das folhas da obra): a planta abre direto na primeira folha quando ela já tem
   estaca posicionada. Quem já escolheu um fundo na barra fica onde está. */
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

/* ---------- montagem ---------- */
/* barra e painel só aparecem depois de as posições serem lidas; sem a tabela, a folha fica como era */
function ppjPosEsconder(){
  const f = $("ppj-ferramentas"), p = $("ppj-painel"), c = $("ppj-contagem"), palco = $("ppj-palco");
  if(f){ f.hidden = true; f.replaceChildren(); }
  if(p){ p.hidden = true; p.replaceChildren(); }
  if(c) c.textContent = "";
  if(palco) palco.classList.remove("ppj-editando");
}
/* Gancho de ppjMostrarFolha, quando a folha é montada no visor: cria a camada dos marcadores e lê as posições */
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
  palco.insertBefore(svg, $("ppj-estado"));   // por cima da imagem; o aviso de carregando e os botões ficam por cima dela
  st.svg = svg; st.camada = g;
  ppjPosLigarPalco(palco);
  ppjPosCarregar(st);
  if(typeof pplLeiMontar === "function") pplLeiMontar(st);   // leitura da folha (fase 175b)
}
async function ppjPosCarregar(st){
  if(st.lendo) return;
  st.lendo = true;
  const r = await ppjPosBuscar(st.plantaId);
  st.lendo = false;
  if(st !== _ppjPos) return;
  if(r.ausente){ if(!st.disponivel) ppjPosEsconder(); return; }
  if(r.erro){
    if(st.disponivel) return;   // já havia posições na tela: ficam as que estavam
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
/* Gancho de ppjMostrarFolha, quando a mesma folha é redesenhada (filtro, busca, status ou máquina de uma estaca mudou) */
function ppjPosAtualizar(folha){
  const st = _ppjPos;
  if(!folha || st.plantaId !== folha.id || !st.disponivel) return;
  ppjPosPintar(st);
  const guardado = _ppjPosCache.get(st.plantaId);
  if(!st.editando && !st.pendentes && (!guardado || Date.now() - guardado.em > PPJ_VALIDADE_MS)) ppjPosCarregar(st);   // outra pessoa pode ter mexido
}
/* Gancho de ppjAplicarVisor: os marcadores acompanham o zoom e o arrasto da folha */
function ppjPosVisor(v, t){
  const st = _ppjPos;
  if(!t || !t.folha || t.folha.id !== st.plantaId) return;
  ppjPosColocar(st, false);
  if(typeof ppjSeqVisor === "function") ppjSeqVisor(st);   // a caixa presa ao ponto e a prévia acompanham a folha
}
/* Gancho de ppjEsquema: voltar ao Esquema encerra o modo de edição */
function ppjPosSair(){
  const st = _ppjPos;
  if(st.editando) ppjPosEditar(st, false);
}

/* ---------- desenho ---------- */
function ppjPosPintar(st){
  ppjPosBarra(st);
  ppjPosMarcadores(st);
  ppjPosPainel(st);
  ppjPosExtras(st);
}
/* os módulos que continuam esta tela pintam o deles por cima, depois da folha */
function ppjPosExtras(st){
  if(typeof ppjVinPintar === "function") ppjVinPintar(st);
  if(typeof ppjSeqPintar === "function") ppjSeqPintar(st);
}
/* Aviso na caixa acima da folha, para os módulos que continuam esta tela. Texto vazio apaga. */
function ppjPosAvisar(msg){
  const st = _ppjPos;
  st.erro = String(msg || "");
  if(st.disponivel) ppjPosBarra(st);
}
/* Clique (ou Enter) numa estaca fora do modo de edição: o painel de executadas sem vínculo pode ficar com o clique;
   senão, abre a execução da estaca. */
function ppjPosAbrirEstaca(id){
  if(typeof ppjVinCliqueEstaca === "function" && ppjVinCliqueEstaca(id)) return;
  if(typeof abrirModalExecucao === "function") abrirModalExecucao(id);
}
/* máquinas das estacas da obra, na tabela que o corDaMaquina do Esquema usa (a mesma cor nos dois desenhos) */
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
/* cor de dentro do marcador: pela máquina, ou pelo status (a executada hoje tem a cor de hoje), como no Esquema */
function ppjPosPreenchimento(e, cor, hoje){
  if(cor === "maquina") return typeof corDaMaquina === "function" ? corDaMaquina(e.equipamento_id) : "var(--txt-sutil)";
  if(hoje && e.data_execucao === hoje) return typeof COR_HOJE !== "undefined" ? COR_HOJE : "var(--estaca-hoje)";
  return (typeof COR_STATUS !== "undefined" && COR_STATUS[e.status]) || "var(--txt-sutil)";
}
/* um marcador: grupo com title, círculo de raio fixo e o nome inteiro ao lado (o CSS mostra o nome quando cabe) */
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
  // cor de token só por style: atributo de apresentação do SVG ignora var(--…)
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
  // o nó de cada marcador é reaproveitado enquanto o que ele mostra não muda: uma ação mexe em um nó, não em todos
  const marcas = new Map(), nos = [];
  for(const e of mostradas){
    const preenchimento = ppjPosPreenchimento(e, cor, hoje), chave = ppjPosChaveMarca(e, preenchimento);
    let no = st.marcas.get(e.id);
    if(!no || no.ppjChave !== chave || no.parentNode !== g){ no = ppjPosMarca(e, preenchimento); no.ppjChave = chave; }
    no.classList.toggle("ppj-selecionada", st.selecionada === e.id);
    if(typeof pplLeiMarcaClasse === "function") pplLeiMarcaClasse(no, e.id);   // a conferir (fase 175b)
    marcas.set(e.id, no); nos.push(no);
  }
  ppjPosTrocarFilhos(g, nos);
  st.marcas = marcas;
  st.espacamento = ppjPosEspacamento(mostradas.map(e => st.mapa.get(e.id)), Number(folha.largura_px), Number(folha.altura_px));
  ppjPosColocar(st, true);
  const c = $("ppj-contagem");
  if(c) c.textContent = ppjPosResumo({ posicionadas: posicionadas.length, total: estacas.length, mostradas: mostradas.length, executadas: mostradas.filter(e => e.status === "executada").length })
    + (typeof ppjVinResumoFolha === "function" ? ppjVinResumoFolha(st) : "");
  // busca com um resultado só: a estaca vai para o centro, uma vez por busca (depois a pessoa arrasta à vontade)
  const termo = filtro.termo.trim().toLowerCase();
  if(!termo){ st.buscaCentrada = ""; return; }
  if(mostradas.length !== 1) return;
  const chave = termo + "|" + mostradas[0].id;
  if(chave === st.buscaCentrada) return;
  st.buscaCentrada = chave;
  const t = ppjTamanho(), p = st.mapa.get(mostradas[0].id);
  if(t && _ppj.visor && p) ppjMexer(ppjPosCentrar(_ppj.visor, p.x, p.y, t.lw, t.lh, t.W, t.H));
}
/* Deixa em g exatamente os nós pedidos, na ordem pedida, mexendo só no que mudou (um nó a mais, um a menos) */
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
/* o lugar de um marcador dentro da camada; o atributo só é escrito quando muda */
function ppjPosMoverMarca(no, x, y){
  const t = `translate(${x}, ${y})`;
  if(no.ppjLugar === t) return;
  no.setAttribute("transform", t);
  no.ppjLugar = t;
}
/* Põe os marcadores no lugar. A camada anda com a folha (um atributo só); cada marcador só é recalculado quando o zoom
   muda, porque o raio é fixo na tela e a posição é fração × tamanho da folha × zoom. */
function ppjPosColocar(st, forcar){
  const v = _ppj.visor, folha = ppjFolhaAtual();
  if(!st.camada || !v || !folha || folha.id !== st.plantaId) return;
  const lw = Number(folha.largura_px), lh = Number(folha.altura_px);
  st.camada.setAttribute("transform", `translate(${v.tx}, ${v.ty})`);
  if(typeof pplLeiColocar === "function") pplLeiColocar(st);   // marcadores tracejados da prévia da leitura (fase 175b)
  if(!forcar && v.z === st.zMarcas) return;
  st.zMarcas = v.z;
  for(const [id, no] of st.marcas){
    const p = st.mapa.get(id);
    if(p) ppjPosMoverMarca(no, p.x * lw * v.z, p.y * lh * v.z);
  }
  st.camada.classList.toggle("ppj-com-rotulo", ppjPosRotuloCabe(v.z, st.espacamento, st.marcas.size));
}
/* painel lateral do modo de edição: contador, estaca selecionada, estaca da vez e a lista "Sem posição nesta folha" */
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
  if(sel) sel.innerHTML = marcada ? `<span>Selecionada: <strong>${esc(String(marcada.numero || "").trim() || "(sem nº)")}</strong></span><button type="button" class="btn-sec btn-sm txt-perigo" data-ppj-ed="tirar" title="Tirar esta estaca da folha (tecla Delete). A estaca continua na obra.">Tirar da folha</button>${/* html */ typeof pplLeiSelHTML === "function" ? pplLeiSelHTML(st, marcada) : ""}` : "";
  if(lista) lista.innerHTML = ppjPosListaHTML(st.lista, st.daVez, !!st.termo && total.length > 0);
}

/* ---------- modo de edição ---------- */
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
  if(typeof _plantaCor !== "undefined") _plantaCor = cor;   // o mesmo alternador do Esquema (js/estacas.js)
  document.querySelectorAll("[data-planta-cor]").forEach(b => b.classList.toggle("ativo", b.dataset.plantaCor === cor));
  if(st.disponivel) ppjPosPintar(st);
}

/* Faz uma ação: aparece na hora, entra na pilha de desfazer e vai ao banco. Se o banco recusar, volta. */
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
  if(typeof pplLeiAposAcao === "function") pplLeiAposAcao(st, acao);   // mover a estaca lida confere (fase 175b)
}
function ppjPosDesfazer(st){
  if(!st.editando || !st.disponivel || !ppjPodeEditar()) return;
  const r = ppjPosDesempilhar(st.pilha);
  if(!r.acao) return;
  if(r.acao.composta){   // ação de outro módulo (estaca criada pelo desenho, bloco posicionado): quem fez é quem desfaz
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
  if(r.acao.tipo === "posicionar") st.daVez = r.acao.estaca_id;   // a estaca volta para a lista e é a da vez
  ppjPosGuardar(st);
  ppjPosPintar(st);
  ppjPosEnviar(st, op, () => {   // o banco recusou o desfazer: a ação continua valendo
    st.mapa = ppjPosAplicar(st.mapa, ppjPosOperacao(r.acao));
    st.pilha = ppjPosEmpilhar(st.pilha, r.acao);
  });
}
/* posiciona uma estaca no ponto p do palco (clique no vazio, ou item da lista solto no desenho) */
function ppjPosPosicionar(st, estacaId, p){
  const t = ppjTamanho();
  if(!st.editando || !estacaId || !t || !_ppj.visor || st.mapa.has(estacaId) || !ppjEstacas().some(e => e.id === estacaId)) return;
  const f = ppjPosFracao(_ppj.visor, p.x, p.y, t.lw, t.lh);
  if(!f) return;   // fora da folha
  if(estacaId === st.daVez) st.daVez = ppjPosProxima(st.lista, estacaId);
  ppjPosFazer(st, { tipo: "posicionar", estaca_id: estacaId, depois: f });
}
function ppjPosTirar(st, estacaId){
  const antes = st.mapa.get(estacaId);
  if(antes) ppjPosFazer(st, { tipo: "tirar", estaca_id: estacaId, antes });
}

/* ---------- gravação: uma de cada vez, na ordem em que a pessoa fez ---------- */
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
      if(st === _ppjPos) ppjPosPintar(st);   // o marcador volta já, e o aviso aparece ao lado da folha
    }
    /* Houve recusa: relê o que o banco tem, para a tela não ficar mostrando o que não foi gravado. Só com a fila vazia:
       uma gravação feita depois da recusada (a mesma estaca movida duas vezes, por exemplo) ainda vai ao banco, e sem a
       releitura no fim a tela ficava num lugar e o banco em outro. */
    if(!st.reler || st.pendentes) return;
    st.reler = false;
    _ppjPosCache.delete(st.plantaId);
    const lido = await ppjPosBuscar(st.plantaId);
    if(!lido.mapa || st.pendentes){ st.reler = true; ppjPosGuardar(st); return; }   // não leu, ou a pessoa já fez outra ação: fica para o fim dela
    st.mapa = lido.mapa;
    if(st === _ppjPos) ppjPosPintar(st);
  }).catch(e => console.error("Estacas na folha, fila de gravação:", e));
}
/* Grava uma operação e confere a linha que voltou: sem linha de volta, não gravou (o banco filtra em silêncio) */
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

/* ---------- ponteiro ---------- */
/* Gancho do pointerdown do palco (js/planta_projeto.js): no modo de edição, o ponteiro que desce em cima de um marcador
   é do marcador, e a folha não anda. Fora do modo de edição devolve falso sempre: nada se move. */
function ppjPosAgarrar(ev, p){
  const st = _ppjPos;
  if(!st.editando || !st.disponivel || st.ponteiros.size > 0 || !ppjPodeEditar()) return false;
  const id = ppjPosMarcaDe(ev.target), antes = id ? st.mapa.get(id) : null, t = ppjTamanho();
  const tela = antes && t && _ppj.visor ? ppjPosTela(_ppj.visor, antes.x, antes.y, t.lw, t.lh) : null;
  if(!tela) return false;
  st.arrasto = { ponteiro: ev.pointerId, id, antes, x0: p.x, y0: p.y, tela, moveu: false, pos: null };
  const palco = $("ppj-palco");
  try { if(palco) palco.setPointerCapture(ev.pointerId); } catch(e){ /* ponteiro já solto */ }
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
    if(st.ponteiros.size > 1){ st.toque = null; return; }   // dois dedos: é pinça, não clique
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
      else if(cancelado || a.moveu) ppjPosColocar(st, true);                  // volta ao lugar
      else if(typeof ppjSeqCliqueMarca === "function" && ppjSeqCliqueMarca(st, a.id, ev)){ /* Shift+clique: seleção de várias, do outro módulo */ }
      else ppjPosSelecionar(st, st.selecionada === a.id ? null : a.id);        // clique no marcador: seleciona
      return;
    }
    if(!q || q.ponteiro !== ev.pointerId) return;
    st.toque = null;
    if(cancelado || q.moveu) return;                                           // arrastou a folha: não é clique
    if(q.id){ if(!st.editando && st.mapa.has(q.id)) ppjPosAbrirEstaca(q.id); return; }
    if(!st.editando) return;
    if(typeof ppjSeqCliqueVazio === "function" && ppjSeqCliqueVazio(st, ppjPosPontoDoPalco(palco, ev))) return;   // por bloco ou em sequência
    if(st.daVez) ppjPosPosicionar(st, st.daVez, ppjPosPontoDoPalco(palco, ev));
    else if(st.selecionada) ppjPosSelecionar(st, null);
  };
  palco.addEventListener("pointerup", (ev) => soltar(ev, false));
  palco.addEventListener("pointercancel", (ev) => soltar(ev, true));
  // item da lista arrastado até o desenho
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

/* ---------- eventos do visor (delegados: a barra e o painel são redesenhados) ---------- */
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
      // a barra é redesenhada e o botão clicado some: o foco vai para o botão que ficou no lugar dele (senão cai no começo da página)
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
  // Ctrl+Z com o foco fora do visor (a pessoa acabou de clicar num botão que sumiu): vale enquanto o modo de edição está ligado
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

// teste em Node (scripts/testar-fase167b.mjs): as funções puras saem pelo mesmo module.exports de js/planta_projeto.js
if(typeof module === "object" && module && module.exports){
  Object.assign(module.exports, { PPJ_POS_TABELA, PPJ_POS_COLUNAS, PPJ_POS_DESFAZER_MAX, PPJ_POS_RAIO, PPJ_POS_TOQUE_PX, PPJ_POS_ROTULO_MIN_PX, PPJ_POS_ZOOM_BUSCA, PPJ_POS_LISTA_MAX,
    ppjPosArredondar, ppjPosFracao, ppjPosTela, ppjPosCentrar, ppjPosCompararNomes, ppjPosOrdenar, ppjPosFiltrar, ppjPosSemPosicao, ppjPosDaVez, ppjPosProxima,
    ppjPosOperacao, ppjPosInverso, ppjPosAplicar, ppjPosEmpilhar, ppjPosDesempilhar, ppjPosResumo, ppjPosEspacamento, ppjPosRotuloCabe, ppjPosLinha, ppjPosTabelaAusente,
    ppjPosTitulo, ppjPosNoPalco, ppjPosChaveMarca, ppjPosFerramentasHTML, ppjPosPainelHTML, ppjPosListaHTML, ppjPosStatusRotulo });
}

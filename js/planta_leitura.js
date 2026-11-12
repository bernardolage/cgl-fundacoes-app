/* ====================================================================
   Módulo: ler as estacas da folha do projeto do cliente — fase 175b (prefixo ppl-)
   Carregado depois de js/planta_projeto.js, js/planta_posicoes.js e js/planta_sequencia.js, e junto com o detector
   (js/planta_detector.js, ppd-) e as regras da leitura (js/planta_leitura_regras.js). Os arquivos da planta chamam este por
   ganchos guardados por typeof (pplLeiMontar, pplLeiExtraBarra, pplLeiMarcaClasse, pplLeiColocar, pplLeiAposAcao,
   pplLeiSelHTML e pplLeiOferecer); sem ele, a folha fica como era.
   - "Ler estacas da folha" (barra da folha, só para quem edita estaca, folha que veio de PDF): o navegador abre o PDF
     original, acha os símbolos redondos das estacas sem IA (ppdFormas), desenha a folha em ladrilhos e manda cada um à
     edge function ler-planta-estacas, que devolve nome e caixa de cada estaca. Os nomes são juntados, sem repetir a
     sobreposição, e puxados para o centro do símbolo mais perto (pplJuntar, pplPuxar).
   - Prévia antes de gravar: lidas, já existentes (só posiciona), novas (cria), ambíguas e pontos sem nome, com marcadores
     tracejados sobre a folha. "Usar as lidas" grava; "Descartar e marcar à mão" não grava nada.
   - Gravar: estaca nova nasce prevista, com tipo e Ø escolhidos uma vez na prévia e o local da folha; a posição nasce com
     origem 'leitura' e conferida = false ("a conferir": borda tracejada). Ambíguas e sem nome viram pontos
     (obras_plantas_pontos). O resumo vai para obras_plantas.leitura_resumo.
   - Pilar que virou estaca (P10 prevista, sem execução, sem medida e sem posição, e a folha leu P10A e P10B): a prévia
     oferece trocar P10 por P10A pela RPC estaca_renomear_pilar, que grava em registros_log. Nunca apaga estaca.
   - A conferir: clicar no marcador (modo de edição) e "Conferir", ou arrastar, marca conferida; "A conferir (N)" mostra só
     essas; "Conferir todas desta folha". "Desfazer a leitura" (só na sessão) apaga as estacas criadas que continuam
     previstas e sem execução, tira as posições gravadas e desfaz as trocas de pilar.
   As funções pplLeiCusto, pplLeiEstacasObra, pplLeiResumo, pplLeiLinhasPosicao, pplLeiPontos e pplLeiPreviaHTML são puras
   e testadas por scripts/testar-fase175b.mjs.
   ==================================================================== */

const PPL_FUNCAO = "ler-planta-estacas";
const PPL_PARALELO = 4;                    // ladrilhos lidos ao mesmo tempo
const PPL_CUSTO_LADRILHO_USD = 0.013;      // medido na 8506 (12/11/2026): US$ 0,25 em 20 ladrilhos
const PPL_VERSAO = "175b-1";               // versão do detector e da leitura, gravada nos pontos e no resumo
const PPL_LOTE = 200;                      // linhas por gravação

/* ---------- regras puras ---------- */
function pplLeiCusto(ladrilhos){
  const n = Math.max(0, Number(ladrilhos) || 0);
  return Math.max(0.01, Math.round(n * PPL_CUSTO_LADRILHO_USD * 100) / 100);
}
const pplLeiDinheiro = (v) => (Number(v) || 0).toFixed(2).replace(".", ",");
/* as estacas da obra no formato das regras (pplClassificar e pplPilares) */
function pplLeiEstacasObra(estacas, comPosicao, medidas){
  const pos = comPosicao instanceof Set ? comPosicao : new Set(), med = medidas instanceof Set ? medidas : new Set();
  return (Array.isArray(estacas) ? estacas : []).filter(e => e && e.id).map(e => ({ id: e.id, nome: String(e.numero || "").trim(), status: e.status,
    local: e.local || "", bloco: e.bloco || "", diametro_mm: e.diametro_mm, temExecucao: Number(e._execs_total) > 0, temMedida: med.has(e.id), temPosicao: pos.has(e.id) }));
}
/* Junta a classificação e os pilares no que a prévia mostra e grava.
   classe = pplClassificar(...); pilares = pplPilares(...); naFolha = Set dos ids já posicionados nesta folha.
   Lista antes da leitura (a planilha do projeto já criou as estacas): quando ao menos metade dos nomes lidos já existe
   na obra, a leitura só posiciona e confere; nome lido fora da lista vai para "fora da lista" (fica como ponto com o
   nome, para conferir) e não é criado. Sem lista, os nomes novos são criados.
   Devolve { posicionar: [{ estaca_id, nome, x, y }], novas: [{ nome, x, y }], foraDaLista, ambiguas, semNome, conferir,
   pilares, ja, modoLista }. */
function pplLeiResumo(classe, pilares, naFolha){
  const c = classe || {}, folha = naFolha instanceof Set ? naFolha : new Set();
  const existentes = (c.existentes || []).filter(it => it.estaca && it.estaca.id);
  const ja = existentes.filter(it => folha.has(it.estaca.id));
  const posicionar = existentes.filter(it => !folha.has(it.estaca.id)).map(it => ({ estaca_id: it.estaca.id, nome: it.nome, x: it.x, y: it.y }));
  const lidas = (c.novas || []).map(it => ({ nome: it.nome, x: it.x, y: it.y, simbolo: it.simbolo }));
  const modoLista = existentes.length > 0 && existentes.length >= lidas.length;
  return { posicionar, novas: modoLista ? [] : lidas, foraDaLista: modoLista ? lidas : [], ambiguas: c.ambiguas || [], semNome: c.semNome || [],
    conferir: c.conferir || [], pilares: modoLista ? [] : (pilares || []).filter(p => p && p.estaca && p.filhas && p.filhas.length >= 2), ja: ja.length, modoLista };
}
/* As linhas de posição que vão ao banco: origem leitura, a conferir. Só uuid de verdade e fração de 0 a 1. */
function pplLeiLinhasPosicao(plantaId, obraId, itens){
  return (Array.isArray(itens) ? itens : []).map(it => {
    const l = typeof ppjPosLinha === "function" ? ppjPosLinha(plantaId, it.estaca_id, obraId, it.x, it.y) : null;
    return l ? { ...l, origem: "leitura", conferida: false } : null;
  }).filter(Boolean);
}
/* Os pontos guardados: símbolos sem nome e estacas ambíguas (com o nome lido). formas: as do detector, em fração. */
function pplLeiPontos(plantaId, obraId, resumo, formas){
  const r = resumo || {}, f = Array.isArray(formas) ? formas : [], saida = [];
  const lim = (v) => Math.min(1, Math.max(0, Math.round(Number(v) * 1e6) / 1e6));
  const ponto = (x, y, raio, serie, rotulo) => ({ planta_id: plantaId, obra_id: obraId, x_frac: lim(x), y_frac: lim(y), raio_frac: raio ? lim(raio) : null,
    origem: "leitura", rotulo_lido: rotulo || null, serie: Number.isFinite(serie) ? serie : null, versao_detector: PPL_VERSAO });
  for(const s of r.semNome || []) if(Number.isFinite(s.x) && Number.isFinite(s.y)) saida.push(ponto(s.x, s.y, s.r, s.serie, null));
  for(const a of (r.ambiguas || []).concat(r.foraDaLista || [])){
    if(!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
    const s = a.simbolo != null ? f[a.simbolo] : null;
    saida.push(ponto(a.x, a.y, s ? s.r : null, s ? s.serie : null, a.nome));
  }
  return saida;
}
/* p = { resumo, lidas, previstas, tipo, diametro, tipos: { valor: rotulo }, local, ladrilhos, segundos, custo } */
function pplLeiPreviaHTML(p){
  const o = p || {}, r = o.resumo || {}, novas = (r.novas || []).length, pos = (r.posicionar || []).length;
  const amb = (r.ambiguas || []).length, sem = (r.semNome || []).length + (r.conferir || []).length;
  const kpis = `<div class="ppl-kpis">${uiKpi(String(o.lidas || 0), "Lidas")}${uiKpi(String(pos), "Já existem", "só posiciona")}${r.modoLista ? uiKpi(String((r.foraDaLista || []).length), "Fora da lista", "a conferir") : uiKpi(String(novas), "Novas", "cria")}${uiKpi(String(amb), "Ambíguas", "só à mão")}${uiKpi(String(sem), "Pontos sem nome")}</div>`;
  const meta = `<p class="meta">${esc(`${o.ladrilhos || 0} ladrilhos em ${Math.round(Number(o.segundos) || 0)} s, US$ ${pplLeiDinheiro(o.custo)}.`)}${r.ja ? esc(` ${r.ja} lidas já estavam nesta folha e ficam como estão.`) : ""}</p>`;
  const tipos = o.tipos || {};
  const criar = novas ? `<p class="texto-apoio">${esc(`Esta obra tem ${Number(o.previstas) || 0} estacas previstas. As ${novas} novas entram na conta do avanço.`)}</p>
    <div class="ppl-linha">
      <label class="campo"><span class="rotulo-caps">Tipo das novas</span><select id="ppl-tipo">${Object.keys(tipos).map(k => `<option value="${esc(k)}"${k === o.tipo ? " selected" : ""}>${esc(tipos[k])}</option>`).join("")}</select></label>
      <label class="campo"><span class="rotulo-caps">Ø das novas (mm)</span><input id="ppl-diametro" type="number" min="50" max="3000" step="10" value="${esc(o.diametro || "")}" /></label>
      ${o.local ? `<span class="meta">${esc(`Local: ${o.local}`)}</span>` : ""}
    </div>` : "";
  const pilares = (r.pilares || []).length ? `<div class="ppl-pilares"><div class="rotulo-caps">Pilares que parecem estacas</div>${r.pilares.map((pl, i) => {
      const texto = `${pl.estaca.nome} parece ser o pilar destas ${pl.filhas.length} estacas: ${pl.filhas.join(", ")}.`;
      return pl.livre
        ? `<label class="ppj-check" title="Troca o nome da estaca ${esc(pl.estaca.nome)} para ${esc(pl.filhas[0])} (fica no histórico da estaca); as outras são criadas."><input type="checkbox" data-ppl-pilar="${i}" /> ${esc(texto)} Trocar ${uiCodigo(pl.estaca.nome)} por ${uiCodigo(pl.filhas[0])}</label>`
        : `<p class="meta">${esc(texto + " Não troca: ela já tem execução, medida ou posição.")}</p>`;
    }).join("")}</div>` : "";
  const nomes = (l) => l.slice(0, 40).map(it => uiCodigo(it.nome || "?")).join(" ") + (l.length > 40 ? esc(` e mais ${l.length - 40}`) : "");
  const listaAmb = amb ? `<p class="meta">Ambíguas (repetidas na folha ou na obra; ficam como ponto para marcar à mão): ${/* html */ nomes(r.ambiguas)}</p>` : "";
  const listaFora = (r.foraDaLista || []).length ? `<p class="meta">A obra já tem a lista do projeto: a leitura só posiciona. Lidas fora da lista (ficam como ponto com o nome, para conferir; nada é criado): ${/* html */ nomes(r.foraDaLista)}</p>` : "";
  return `<div class="ppl-previa" role="region" aria-label="Prévia da leitura da folha">
      <div class="ppl-topo"><strong>Prévia da leitura</strong><span class="meta">Os marcadores tracejados mostram onde cada estaca lida ficaria. Nada foi gravado ainda.</span></div>
      ${/* html */ kpis}${/* html */ meta}${/* html */ criar}${/* html */ pilares}${/* html */ listaAmb}${/* html */ listaFora}
      <div class="ppl-acoes"><button type="button" class="btn btn-sm" data-ppl="usar"${pos + novas ? "" : " disabled"} title="Grava as estacas lidas nesta folha. As posições ficam a conferir.">Usar as lidas</button>
        <button type="button" class="btn-sec btn-sm" data-ppl="descartar" title="Não grava nada. Marque as estacas à mão em Editar posições.">Descartar e marcar à mão</button></div>
    </div>`;
}

/* ====================================================================
   Tela
   ==================================================================== */
function pplLeiEstadoNovo(plantaId){
  return { plantaId, conferir: new Set(), soConferir: false, fase: "", feitos: 0, total: 0, oferta: null, previa: null, sessao: null, ocupado: false, g: null, msg: "" };
}
let _ppl = pplLeiEstadoNovo(null);
/* os tipos oferecidos para estaca nova: os ativos da aba Estacas (js/estacas.js), com o rótulo de lá */
function pplLeiTipos(){
  const rot = typeof ESTACA_TIPOS !== "undefined" && ESTACA_TIPOS ? ESTACA_TIPOS : (typeof PPJ_SEQ_TIPOS !== "undefined" ? PPJ_SEQ_TIPOS : {});
  const chaves = typeof ESTACA_TIPOS_ATIVOS !== "undefined" && Array.isArray(ESTACA_TIPOS_ATIVOS) ? ESTACA_TIPOS_ATIVOS : Object.keys(rot);
  return Object.fromEntries(chaves.map(k => [k, String(rot[k] || k)]));
}
const pplLeiFolhaPdf = (f) => !!(f && f.documento && /\.pdf$/i.test(String(f.documento.storage_path || "")));

/* Gancho de ppjPosMontar: folha nova no visor. Lê quais posições desta folha estão a conferir. */
function pplLeiMontar(st){
  const mesma = _ppl.plantaId === st.plantaId;
  const sessao = mesma ? _ppl.sessao : null, oferta = mesma ? _ppl.oferta : null;
  if(!mesma || !_ppl.ocupado) _ppl = pplLeiEstadoNovo(st.plantaId);
  if(sessao) _ppl.sessao = sessao;
  if(oferta) _ppl.oferta = oferta;
  pplLeiCaixa();
  pplLeiLerConferir(st.plantaId);
}
async function pplLeiLerConferir(plantaId){
  if(!plantaId) return;
  let r;
  try { r = await lerTudo(() => sb.from(PPJ_POS_TABELA).select("estaca_id").eq("planta_id", plantaId).eq("conferida", false), "estaca_id"); }
  catch(e){ r = { data: [], error: e }; }
  if(_ppl.plantaId !== plantaId) return;
  if(r.error){ if(!/conferida/.test(String(r.error.message || ""))) console.error("Leitura da folha, posições a conferir:", r.error); return; }
  _ppl.conferir = new Set((r.data || []).map(l => l.estaca_id));
  pplLeiRepintar();
}
function pplLeiRepintar(){
  if(_ppl.g) _ppl.g.ppjZ = null;   // a prévia mudou: os marcadores tracejados são refeitos
  const st = typeof _ppjPos !== "undefined" ? _ppjPos : null;
  if(st && st.disponivel && st.plantaId === _ppl.plantaId) ppjPosPintar(st);
  pplLeiCaixa();
}
/* Gancho de ppjPosBarra: botões da leitura e do "a conferir" (já escapados) */
function pplLeiExtraBarra(st){
  const folha = typeof ppjFolhaAtual === "function" ? ppjFolhaAtual() : null;
  if(!folha || folha.id !== st.plantaId) return "";
  const n = [..._ppl.conferir].filter(id => st.mapa.has(id)).length, partes = [];
  if(n || _ppl.soConferir) partes.push(`<button type="button" class="serv-view-btn${_ppl.soConferir ? " ativo" : ""}" data-ppl="filtro" aria-pressed="${_ppl.soConferir ? "true" : "false"}" title="Mostrar só as estacas lidas da folha que ainda não foram conferidas">A conferir (${esc(String(n))})</button>`);
  if(n && ppjPodeEditar()) partes.push(`<button type="button" class="btn-sec btn-sm" data-ppl="conferir-todas" title="Marcar como conferidas todas as posições lidas desta folha">Conferir todas desta folha</button>`);
  if(ppjPodeEditar() && pplLeiFolhaPdf(folha) && !_ppl.ocupado && !_ppl.previa)
    partes.push(`<button type="button" class="btn-sec btn-sm" data-ppl="ler" title="Ler os nomes das estacas desta folha com a IA de imagem e mostrar a prévia antes de gravar">Ler estacas da folha</button>`);
  return partes.join("");
}
/* Gancho de ppjPosMarcadores: borda tracejada na estaca a conferir; filtro "A conferir" esconde as outras */
function pplLeiMarcaClasse(no, id){
  no.classList.toggle("ppl-a-conferir", _ppl.conferir.has(id));
  no.classList.toggle("ppl-oculta", _ppl.soConferir && !_ppl.conferir.has(id));
}
/* Gancho de ppjPosPainel: na estaca selecionada a conferir, o botão Conferir */
function pplLeiSelHTML(st, estaca){
  if(!estaca || !_ppl.conferir.has(estaca.id) || !ppjPodeEditar()) return "";
  return `<button type="button" class="btn-sec btn-sm" data-ppl="conferir-uma" data-ppl-id="${esc(estaca.id)}" title="A posição lida está certa: marcar como conferida">Conferir</button>`;
}
/* Gancho de ppjPosFazer: mover a estaca a conferir confere; tirar da folha tira da conta */
function pplLeiAposAcao(st, acao){
  if(!acao || !_ppl.conferir.has(acao.estaca_id)) return;
  if(acao.tipo === "tirar"){ _ppl.conferir.delete(acao.estaca_id); pplLeiRepintar(); return; }
  if(acao.tipo === "mover") st.fila = st.fila.then(() => pplLeiConferir([acao.estaca_id]));   // depois da gravação da posição
}
async function pplLeiConferir(ids){
  const lista = (ids || []).filter(id => _ppl.conferir.has(id)), plantaId = _ppl.plantaId;
  if(!lista.length || !plantaId) return;
  let ok = 0, erro = null;
  for(let i = 0; i < lista.length; i += PPL_LOTE){
    let r;
    try { r = await sb.from(PPJ_POS_TABELA).update({ conferida: true }).eq("planta_id", plantaId).in("estaca_id", lista.slice(i, i + PPL_LOTE)).select("estaca_id"); }
    catch(e){ r = { error: e }; }
    if(r.error){ erro = r.error; break; }
    (r.data || []).forEach(l => { _ppl.conferir.delete(l.estaca_id); ok++; });
  }
  if(erro){ console.error("Leitura da folha, conferir:", erro); aviso("app-aviso", "Não foi possível marcar como conferida: " + (erro.message || erro), "erro"); }
  else if(!ok) aviso("app-aviso", "Nada foi conferido: seu cargo não altera a posição das estacas nesta obra.", "erro");
  if(!_ppl.conferir.size) _ppl.soConferir = false;
  pplLeiRepintar();
}

/* ---------- caixa da leitura (progresso, oferta, prévia, sessão) ---------- */
function pplLeiCaixa(){
  const el = $("ppl-caixa");
  if(!el) return;
  let html = "";
  if(_ppl.ocupado) html = `<p class="ppl-progresso" role="status">${esc(_ppl.fase || "Lendo…")}</p>`;
  else if(_ppl.previa) html = pplLeiPreviaHTML(_ppl.previa.mostra);
  else if(_ppl.oferta) html = `<div class="ppl-oferta"><span>${esc(`Ler os nomes das estacas agora? Custa cerca de US$ ${pplLeiDinheiro(_ppl.oferta.custo)} por folha.`)}</span>
      <button type="button" class="btn btn-sm" data-ppl="ler">Ler agora</button><button type="button" class="btn-sec btn-sm" data-ppl="nao">Agora não</button></div>`;
  else if(_ppl.sessao && _ppl.sessao.plantaId === _ppl.plantaId) html = `<div class="ppl-oferta"><span>${esc(_ppl.sessao.texto)}</span>
      <button type="button" class="btn-sec btn-sm" data-ppl="desfazer" title="Apaga as estacas criadas pela leitura que continuam previstas e sem execução, tira as posições gravadas e desfaz as trocas de pilar">Desfazer a leitura</button></div>`;
  if(_ppl.msg) html += `<p class="ppj-erro" role="alert">${esc(_ppl.msg)}</p>`;
  el.innerHTML = html;
  el.hidden = !html;
}
/* Gancho de ppjGerar: folha nova guardada. Abre a primeira e oferece a leitura. */
function pplLeiOferecer(folhas){
  const f = (folhas || []).find(pplLeiFolhaPdf);
  if(!f || !ppjPodeEditar()) return;
  _ppj.atual = f.id; _ppj.escolheu = true;
  ppjRedesenhar();
  _ppl = pplLeiEstadoNovo(f.id);
  _ppl.oferta = { custo: pplLeiCusto(20) };
  pplLeiCaixa();
  pplLeiPreparar(f).then(prep => {
    if(_ppl.plantaId !== f.id || !_ppl.oferta) return;
    _ppl.preparo = prep; _ppl.oferta = { custo: pplLeiCusto(prep.ladrilhos.length) };
    pplLeiCaixa();
  }).catch(() => { /* o erro aparece se a pessoa pedir a leitura */ });
}

/* ---------- ler ---------- */
/* Abre o PDF original da folha, acha os símbolos e monta os ladrilhos (sem IA, sem custo) */
async function pplLeiPreparar(folha){
  if(!pplLeiFolhaPdf(folha)) throw new Error("Esta folha não veio de um PDF. A leitura precisa do PDF do projeto; projeto escaneado se marca à mão.");
  let rot = 0;
  const g = await sb.from("obras_plantas").select("rotacao_graus").eq("id", folha.id).single();
  if(!g.error && g.data) rot = Number(g.data.rotacao_graus) || 0;
  const baixado = await sb.storage.from(PPJ_BUCKET).download(folha.documento.storage_path);
  if(baixado.error || !baixado.data) throw new Error("não foi possível baixar o PDF original (" + ((baixado.error && baixado.error.message) || "sem arquivo") + ")");
  const pdf = await ppjAbrirPdf(await baixado.data.arrayBuffer());
  const page = await pdf.getPage(Number(folha.pagina) || 1);
  const vp1 = page.getViewport({ scale: 1, rotation: rot });
  const { referencia, series } = pplSeriesDaLeitura(ppdSeries(ppdFormas(await page.getOperatorList(), vp1)));
  if(!series.length) throw new Error("Não achei os símbolos das estacas no desenho desta folha. Marque as estacas à mão em Editar posições.");
  const formas = series.flatMap(s => s.formas), lado = Math.max(vp1.width, vp1.height);
  let escala = pplEscala(referencia.r * lado), W, H, ladrilhos;
  for(;;){
    W = Math.round(vp1.width * escala); H = Math.round(vp1.height * escala);
    ladrilhos = pplLadrilhos(W, H, formas, PPL_LADO_PX, PPL_SOBRA_PX);
    if(ladrilhos.length <= PPL_MAX_LADRILHOS || escala <= 1) break;
    escala = Math.max(1, escala * 0.8);
  }
  return { pdf, page, rot, escala, W, H, formas, ladrilhos, plantaId: folha.id };
}
async function pplLeiDesenhar(prep, t){
  const c = ppjCanvasNovo(t.w, t.h);
  if(!c) throw new Error("o navegador não criou a imagem do ladrilho");
  const v = prep.page.getViewport({ scale: prep.escala, rotation: prep.rot, offsetX: -t.x, offsetY: -t.y });
  await prep.page.render({ canvasContext: c.ctx, viewport: v, intent: "print" }).promise;
  const png = c.canvas.toDataURL("image/png");
  ppjSoltarCanvas(c.canvas);
  return png;
}
async function pplLeiLer(){
  const st = _ppjPos, folha = ppjFolhaAtual();
  if(_ppl.ocupado || !folha || !st || folha.id !== st.plantaId || !ppjPodeEditar()) return;
  _ppl.ocupado = true; _ppl.msg = ""; _ppl.oferta = null; _ppl.fase = "Abrindo o PDF da folha e achando os símbolos das estacas…";
  pplLeiRepintar();
  const inicio = Date.now(), leituraId = crypto.randomUUID();
  try {
    const prep = _ppl.preparo && _ppl.preparo.plantaId === folha.id ? _ppl.preparo : await pplLeiPreparar(folha);
    _ppl.preparo = prep;
    const fila = prep.ladrilhos.slice(), respostas = [];
    let feitos = 0, custo = 0, falhas = 0, ultimoErro = "";
    _ppl.fase = `Lendo ladrilho 1 de ${prep.ladrilhos.length}…`; pplLeiCaixa();
    const trabalhador = async () => {
      while(fila.length){
        const t = fila.shift();
        const png = await pplLeiDesenhar(prep, t);
        let r = null;
        for(let tentativa = 0; tentativa < 2 && !r; tentativa++){
          const { data, error } = await sb.functions.invoke(PPL_FUNCAO, { body: { imagem_base64: png, largura: t.w, altura: t.h, obra_id: st.obraId, planta_id: folha.id,
            ladrilho: t.i, ladrilhos: prep.ladrilhos.length, leitura_id: leituraId } });
          if(error){ ultimoErro = (data && data.error) || error.message || String(error); if(/teto|limite|403|401/i.test(ultimoErro)) break; }
          else r = data;
        }
        feitos++;
        if(r && Array.isArray(r.estacas)){ respostas.push({ ladrilho: t.i, estacas: r.estacas }); custo += Number(r._meta && r._meta.custo_usd) || 0; }
        else falhas++;
        _ppl.fase = `Lendo ladrilho ${Math.min(feitos + 1, prep.ladrilhos.length)} de ${prep.ladrilhos.length}…`; pplLeiCaixa();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PPL_PARALELO, prep.ladrilhos.length) }, trabalhador));
    if(!respostas.length) throw new Error("nenhum ladrilho foi lido" + (ultimoErro ? ` (${ultimoErro})` : ""));
    const puxado = pplPuxar(pplJuntar(respostas, prep.ladrilhos, prep.W, prep.H), prep.formas, prep.W, prep.H);
    // o que a obra já tem: execução (_execs_total), medida (RPC) e posição em qualquer folha
    const estacas = ppjEstacas();
    const [medR, posR] = await Promise.all([sb.rpc("estacas_medidas", { p_obra: st.obraId }),
      lerTudo(() => sb.from(PPJ_POS_TABELA).select("estaca_id,planta_id").eq("obra_id", st.obraId), "estaca_id,planta_id")]);
    const medidas = new Set(((medR && medR.data) || []).map(x => typeof x === "string" ? x : x.estacas_medidas || x.estaca_id).filter(Boolean));
    const comPosicao = new Set(((posR && posR.data) || []).map(l => l.estaca_id));
    const naFolha = new Set(((posR && posR.data) || []).filter(l => l.planta_id === folha.id).map(l => l.estaca_id));
    const obra = pplLeiEstacasObra(estacas, comPosicao, medidas), local = String(folha.local || "").trim();
    const classe = pplClassificar(puxado, obra, local);
    const loc = pplNome(local);
    const pilares = pplPilares(puxado.estacas.map(e => e.nome).filter(Boolean), obra.filter(e => !loc || !pplNome(e.local) || pplNome(e.local) === loc));
    const resumo = pplLeiResumo(classe, pilares, naFolha);
    const padrao = typeof ppjSeqPadroes === "function" ? ppjSeqPadroes(estacas) : { tipo: "", diametro: "" };
    const diam = pplDiametroComum(estacas.filter(e => !padrao.tipo || e.tipo === padrao.tipo));
    const segundos = (Date.now() - inicio) / 1000;
    _ppl.previa = { resumo, formas: prep.formas, mostra: { resumo, lidas: puxado.estacas.filter(e => e.nome).length, previstas: estacas.filter(e => e.status === "prevista").length,
      tipo: padrao.tipo || Object.keys(pplLeiTipos())[0] || "", diametro: diam ? String(diam) : padrao.diametro, tipos: pplLeiTipos(), local,
      ladrilhos: prep.ladrilhos.length, segundos, custo }, falhas,
      info: { ladrilhos: prep.ladrilhos.length, segundos: Math.round(segundos), custo_usd: Math.round(custo * 10000) / 10000, leitura_id: leituraId } };
    if(falhas) _ppl.msg = `${falhas} de ${prep.ladrilhos.length} ladrilhos não foram lidos${ultimoErro ? ` (${ultimoErro})` : ""}: as estacas deles ficam para marcar à mão.`;
  } catch(e){
    console.error("Leitura da folha:", e);
    _ppl.msg = "A leitura não terminou: " + ((e && e.message) || e);
  }
  _ppl.ocupado = false; _ppl.fase = "";
  pplLeiRepintar();
}

/* ---------- prévia sobre a folha: marcadores tracejados ---------- */
function pplLeiColocar(st){
  if(!st.svg) return;
  let g = _ppl.g;
  if(!g || g.parentNode !== st.svg){
    g = document.createElementNS(PPJ_POS_NS, "g");
    g.setAttribute("class", "ppl-previa-g");
    g.setAttribute("aria-hidden", "true");
    st.svg.appendChild(g);
    _ppl.g = g;
  }
  const pv = _ppl.previa, folha = ppjFolhaAtual(), v = _ppj.visor;
  if(!pv || !folha || folha.id !== st.plantaId || !v){ g.replaceChildren(); return; }
  const lw = Number(folha.largura_px), lh = Number(folha.altura_px), r = pv.resumo;
  g.setAttribute("transform", `translate(${v.tx}, ${v.ty})`);
  if(g.ppjZ === v.z && g.childNodes.length) return;
  g.ppjZ = v.z;
  const nos = [];
  const marca = (it, classe) => {
    if(!Number.isFinite(it.x) || !Number.isFinite(it.y)) return;
    const no = document.createElementNS(PPJ_POS_NS, "g"), c = document.createElementNS(PPJ_POS_NS, "circle"), t = document.createElementNS(PPJ_POS_NS, "text");
    no.setAttribute("class", "ppl-prev " + classe);
    no.setAttribute("transform", `translate(${it.x * lw * v.z}, ${it.y * lh * v.z})`);
    c.setAttribute("r", String(PPJ_POS_RAIO));
    t.setAttribute("x", String(PPJ_POS_RAIO + 3)); t.setAttribute("y", "4");
    t.textContent = String(it.nome || "?");
    no.appendChild(c); no.appendChild(t); nos.push(no);
  };
  r.posicionar.forEach(it => marca(it, "ppl-prev-existe"));
  r.novas.forEach(it => marca(it, "ppl-prev-nova"));
  r.ambiguas.concat(r.foraDaLista || []).forEach(it => marca(it, "ppl-prev-ambigua"));
  r.semNome.forEach(it => marca({ ...it, nome: "" }, "ppl-prev-sem"));
  g.replaceChildren(...nos);
}

/* ---------- gravar ---------- */
async function pplLeiGravar(){
  const st = _ppjPos, folha = ppjFolhaAtual(), pv = _ppl.previa;
  if(!pv || _ppl.ocupado || !folha || !st || folha.id !== st.plantaId || !ppjPodeEditar()) return;
  const r = pv.resumo, tipo = ($("ppl-tipo") || {}).value || "", diametro = ($("ppl-diametro") || {}).value || "";
  const trocas = [...document.querySelectorAll("[data-ppl-pilar]")].filter(c => c.checked).map(c => r.pilares[Number(c.dataset.pplPilar)]).filter(p => p && p.livre);
  const nomesTrocados = new Map(trocas.map(p => [p.filhas[0], p.estaca]));
  const novas = r.novas.filter(n => !nomesTrocados.has(n.nome));
  const linhas = [];
  for(const n of novas){
    const l = ppjSeqLinhaEstaca({ obraId: st.obraId, numero: n.nome, tipo, diametro, local: folha.local, hoje: hojeISO(), tipos: Object.keys(pplLeiTipos()) });
    if(l.erro){ _ppl.msg = l.erro.replace("na barra ao lado", "na prévia"); pplLeiCaixa(); return; }
    l.linha.observacoes = `Lida da folha do projeto em ${dataBR(hojeISO())}.`;
    linhas.push({ linha: l.linha, n });
  }
  _ppl.ocupado = true; _ppl.msg = ""; _ppl.fase = "Gravando as estacas lidas…"; pplLeiRepintar();
  const sessao = { plantaId: folha.id, obraId: st.obraId, criadas: [], posicoes: [], trocas: [], texto: "" };
  const lista = typeof _estacas !== "undefined" && Array.isArray(_estacas) ? _estacas : null;
  let problema = "";
  try {
    // 1. trocas de pilar, pela RPC (fica em registros_log)
    const posicionar = r.posicionar.slice();
    for(const p of trocas){
      const lida = r.novas.find(n => n.nome === p.filhas[0]);
      const { data, error } = await sb.rpc("estaca_renomear_pilar", { p_estaca: p.estaca.id, p_numero: p.filhas[0] });
      if(error){   // a troca foi recusada: a estaca lida nasce nova, como as outras filhas
        problema += ` ${p.estaca.nome} não foi trocada (${error.message}).`;
        const l = lida ? ppjSeqLinhaEstaca({ obraId: st.obraId, numero: lida.nome, tipo, diametro, local: folha.local, hoje: hojeISO(), tipos: Object.keys(pplLeiTipos()) }) : {};
        if(l.linha){ l.linha.observacoes = `Lida da folha do projeto em ${dataBR(hojeISO())}.`; linhas.push({ linha: l.linha, n: lida }); }
        continue;
      }
      sessao.trocas.push({ estaca_id: p.estaca.id, antes: data.antes, depois: data.depois });
      const e = lista && lista.find(x => x.id === p.estaca.id);
      if(e) e.numero = data.depois;
      if(lida) posicionar.push({ estaca_id: p.estaca.id, nome: lida.nome, x: lida.x, y: lida.y });
    }
    // 2. estacas novas
    for(let i = 0; i < linhas.length; i += PPL_LOTE){
      const lote = linhas.slice(i, i + PPL_LOTE);
      const ins = await sb.from("estacas").insert(lote.map(x => x.linha)).select(PPJ_SEQ_COLUNAS);
      if(ins.error) throw ins.error;
      for(const nova of ins.data || []){
        sessao.criadas.push(nova.id);
        if(lista && !lista.some(e => e.id === nova.id)) lista.push({ ...nova, _execs_total: 0, _execs_refuros: 0, _alterada: false });
        const lida = lote.find(x => x.linha.numero === nova.numero);
        if(lida) posicionar.push({ estaca_id: nova.id, nome: nova.numero, x: lida.n.x, y: lida.n.y });
      }
    }
    // 3. posições, a conferir
    const linhasPos = pplLeiLinhasPosicao(folha.id, st.obraId, posicionar);
    for(let i = 0; i < linhasPos.length; i += PPL_LOTE){
      const up = await sb.from(PPJ_POS_TABELA).upsert(linhasPos.slice(i, i + PPL_LOTE), { onConflict: "planta_id,estaca_id", ignoreDuplicates: true }).select("estaca_id,x_frac,y_frac");
      if(up.error) throw up.error;
      for(const l of up.data || []){
        sessao.posicoes.push(l.estaca_id);
        _ppl.conferir.add(l.estaca_id);
        st.mapa = ppjPosAplicar(st.mapa, { op: "gravar", estaca_id: l.estaca_id, x: Number(l.x_frac), y: Number(l.y_frac) });
      }
    }
    ppjPosGuardar(st);
    // 4. pontos sem nome e ambíguos (os prováveis da leitura anterior desta folha saem)
    const pontos = pplLeiPontos(folha.id, st.obraId, r, pv.formas);
    const apaga = await sb.from("obras_plantas_pontos").delete().eq("planta_id", folha.id).eq("situacao", "provavel");
    if(apaga.error) console.error("Leitura da folha, pontos antigos:", apaga.error);
    for(let i = 0; i < pontos.length; i += PPL_LOTE){
      const ip = await sb.from("obras_plantas_pontos").insert(pontos.slice(i, i + PPL_LOTE));
      if(ip.error){ console.error("Leitura da folha, pontos:", ip.error); problema += " Os pontos sem nome não foram guardados."; break; }
    }
    // 5. resumo da leitura na folha
    const resumo = { lidas: pv.mostra.lidas, existentes: r.posicionar.length, novas: sessao.criadas.length, trocas: sessao.trocas.length, ambiguas: r.ambiguas.length,
      fora_da_lista: (r.foraDaLista || []).length, sem_nome: r.semNome.length + r.conferir.length, posicionadas: sessao.posicoes.length, versao: PPL_VERSAO, ...pv.info };
    const fr = await sb.from("obras_plantas").update({ leitura_em: new Date().toISOString(), leitura_resumo: resumo }).eq("id", folha.id).select("id");
    if(fr.error) console.error("Leitura da folha, resumo:", fr.error);
    sessao.texto = `Leitura gravada: ${sessao.posicoes.length} estacas posicionadas a conferir, ${sessao.criadas.length} criadas${sessao.trocas.length ? `, ${sessao.trocas.length} pilares trocados` : ""}.`;
    aviso("app-aviso", sessao.texto + (problema ? " Atenção:" + problema : ""), problema ? "aviso" : "ok");
  } catch(e){
    console.error("Leitura da folha, gravação:", e);
    const permissao = typeof ehErroDePermissao === "function" && ehErroDePermissao(e);
    _ppl.msg = (permissao ? "Seu cargo não grava estacas nesta obra." : "A gravação parou: " + ((e && e.message) || e))
      + (sessao.criadas.length || sessao.posicoes.length || sessao.trocas.length ? " O que já foi gravado pode ser desfeito em Desfazer a leitura." : "");
    sessao.texto = `Leitura gravada em parte: ${sessao.posicoes.length} posições, ${sessao.criadas.length} estacas criadas.`;
  }
  _ppl.previa = null; _ppl.ocupado = false; _ppl.fase = "";
  if(sessao.criadas.length || sessao.posicoes.length || sessao.trocas.length) _ppl.sessao = sessao;
  if(typeof renderEstacas === "function") renderEstacas();
  pplLeiRepintar();
}
/* Desfaz a leitura gravada nesta sessão: só apaga estaca criada por ela que continua prevista e sem execução */
async function pplLeiDesfazer(){
  const s = _ppl.sessao, st = _ppjPos;
  if(!s || _ppl.ocupado || !ppjPodeEditar()) return;
  if(!confirm("Desfazer a leitura desta folha? As estacas criadas por ela que continuam previstas e sem execução são apagadas, as posições gravadas saem da folha e as trocas de pilar voltam.")) return;
  _ppl.ocupado = true; _ppl.fase = "Desfazendo a leitura…"; pplLeiRepintar();
  let ficaram = 0;
  try {
    for(let i = 0; i < s.posicoes.length; i += PPL_LOTE){
      const d = await sb.from(PPJ_POS_TABELA).delete().eq("planta_id", s.plantaId).in("estaca_id", s.posicoes.slice(i, i + PPL_LOTE)).select("estaca_id");
      if(d.error) throw d.error;
      (d.data || []).forEach(l => { if(st && st.plantaId === s.plantaId) st.mapa = ppjPosAplicar(st.mapa, { op: "tirar", estaca_id: l.estaca_id }); _ppl.conferir.delete(l.estaca_id); });
    }
    if(st && st.plantaId === s.plantaId) ppjPosGuardar(st);
    const comExec = new Set();
    for(let i = 0; i < s.criadas.length; i += PPL_LOTE){
      const ex = await sb.from(PPJ_SEQ_VIEW_EXEC).select("estaca_id").eq("obra_id", s.obraId).in("estaca_id", s.criadas.slice(i, i + PPL_LOTE));
      if(ex.error) throw ex.error;
      (ex.data || []).forEach(l => comExec.add(l.estaca_id));
    }
    const apagar = s.criadas.filter(id => !comExec.has(id));
    const lista = typeof _estacas !== "undefined" && Array.isArray(_estacas) ? _estacas : null;
    for(let i = 0; i < apagar.length; i += PPL_LOTE){
      const d = await sb.from("estacas").delete().in("id", apagar.slice(i, i + PPL_LOTE)).eq("status", "prevista").select("id");
      if(d.error) throw d.error;
      const saiu = new Set((d.data || []).map(l => l.id));
      if(lista) for(let k = lista.length - 1; k >= 0; k--) if(saiu.has(lista[k].id)) lista.splice(k, 1);
    }
    ficaram = s.criadas.length - apagar.length;
    for(const t of s.trocas){
      const { error } = await sb.rpc("estaca_renomear_pilar", { p_estaca: t.estaca_id, p_numero: t.antes });
      if(error){ ficaram++; console.error("Leitura da folha, desfazer troca de pilar:", error); continue; }
      const e = lista && lista.find(x => x.id === t.estaca_id);
      if(e) e.numero = t.antes;
    }
    _ppl.sessao = null;
    aviso("app-aviso", ficaram ? `Leitura desfeita, menos ${ficaram} estaca(s) que já têm execução ou mudaram: confira na lista.` : "Leitura desfeita.", ficaram ? "aviso" : "ok");
  } catch(e){
    console.error("Leitura da folha, desfazer:", e);
    _ppl.msg = "Não foi possível desfazer tudo: " + ((e && e.message) || e);
  }
  _ppl.ocupado = false; _ppl.fase = "";
  if(typeof renderEstacas === "function") renderEstacas();
  pplLeiRepintar();
}

/* ---------- eventos ---------- */
function pplLeiClique(ev){
  const b = ev.target && ev.target.closest ? ev.target.closest("[data-ppl]") : null;
  if(!b || b.disabled) return;
  const acao = b.dataset.ppl, st = _ppjPos;
  if(acao === "ler") return void pplLeiLer();
  if(acao === "nao"){ _ppl.oferta = null; return void pplLeiCaixa(); }
  if(acao === "usar") return void pplLeiGravar();
  if(acao === "descartar"){ _ppl.previa = null; _ppl.msg = ""; if(st && !st.editando && ppjPodeEditar()) ppjPosEditar(st, true); return void pplLeiRepintar(); }
  if(acao === "desfazer") return void pplLeiDesfazer();
  if(acao === "filtro"){ _ppl.soConferir = !_ppl.soConferir; return void pplLeiRepintar(); }
  if(acao === "conferir-todas"){
    if(confirm(`Marcar como conferidas as ${[..._ppl.conferir].length} posições lidas desta folha?`)) pplLeiConferir([..._ppl.conferir]);
    return;
  }
  if(acao === "conferir-uma") return void pplLeiConferir([b.dataset.pplId]);
}
function ligarPlantaLeitura(){
  if(typeof $ !== "function") return;
  const visor = $("ppj-visor");
  if(visor) visor.addEventListener("click", pplLeiClique);
}
if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarPlantaLeitura);
  else ligarPlantaLeitura();
}

// teste em Node (scripts/testar-fase175b.mjs)
if(typeof module === "object" && module && module.exports){
  Object.assign(module.exports, { PPL_CUSTO_LADRILHO_USD, PPL_VERSAO, pplLeiCusto, pplLeiEstacasObra, pplLeiResumo, pplLeiLinhasPosicao, pplLeiPontos, pplLeiPreviaHTML });
}

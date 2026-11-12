/* ====================================================================
   Módulo: Assistente (fase 174a — 12/11/2026)
   Chat em painel lateral, aberto pelo botão "Assistente" do topo em qualquer tela (tela cheia no celular).
   Responde dúvida de uso e entrevista a pessoa para montar um chamado estruturado (rotina, como faz hoje, onde trava,
   exemplo real, impacto, ideia de quem abriu). A edge function `assistente` nunca grava chamado: devolve o rascunho, que
   aparece como cartão editável aqui; "Abrir chamado" grava pelo insert de sempre (RLS da pessoa) com origem 'assistente'.
   Print: anexar ou colar (Ctrl+V); reduzido para 1600 px em JPEG e enviado ao bucket privado assistente-anexos
   (<uid>/<conversa>/). Até 5 por conversa. Ditado pela Web Speech API do navegador (pt-BR): o texto cai na caixa para
   a pessoa revisar; nada de áudio é gravado pelo app. Sem suporte, o botão não aparece.
   Prefixo de IDs: ast-. Carregado depois de chamados.js (usa chamadosContextoAtual, chamEnviarAnexos, CHAM_CATEGORIA).
   Fase 174b: modo orçamento ("Montar orçamento", só com o módulo extra assistente_orcamento). Arquivos (projeto em PDF,
   planilha, sondagem, pedido) vão para orcamentos-arquivos/<uid>/pendente/<conversa>/; o projeto é lido pela
   extrair-estacas-pdf com o SHA-256 do arquivo (leitura paga uma vez), a planilha é lida aqui (até 300 linhas). O resumo do
   orçamento abre na tela de orçamento preenchida (preencherOrcamentoDoAssistente em js/orcamentos.js); quem salva é a pessoa.
   ==================================================================== */

const AST_BUCKET = "assistente-anexos";
const AST_BUCKET_ORC = "orcamentos-arquivos";
const AST_ARQ_MAX_MB = 20;
const AST_PLANILHA_LINHAS = 300;
const AST_SONDAGEM_PAGINAS = 20;
const AST_TIPOS_ARQ = { projeto: "Projeto (quadro de estacas)", sondagem: "Sondagem", planilha: "Planilha", pedido: "Pedido/e-mail" };
const AST_MAX_IMAGENS = 5;
const AST_LADO_MAX = 1600;
const AST_LIMITE_MS = 130000;
// telas com dado pessoal: o painel avisa antes de anexar print (D9)
const AST_SECOES_SENSIVEIS = new Set(["funcionarios", "rhh", "rhv", "sesmt", "sesmt-ocorrencias"]);

let _astConversaId = null;
let _astContexto = null;      // tela e registro no momento em que o assistente abriu
let _astItens = [];           // { tipo: "usuario"|"assistente"|"rascunho"|"parecidos"|"aviso", ... }
let _astPendentes = [];       // prints enviados ao bucket e ainda não mandados na mensagem: { caminho, url }
let _astPrintsConversa = [];  // todos os prints da conversa (vão para o chamado)
let _astEnviando = false;
let _astSomenteLeitura = false; // "Ver conversa" de um chamado
let _astReconhecedor = null;
let _astModo = "geral";        // fase 174b: "geral" ou "orcamento"
let _astArqPendentes = [];     // arquivos escolhidos e ainda não enviados: { file, nome, ext, tipo }
let _astArquivosConversa = []; // arquivos já no bucket: { caminho, tipo, nome, sha256, tamanho }
let _astStatus = "";           // o que está acontecendo enquanto envia ("Lendo o projeto…")

const astPodeAbrirChamado = () => !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
const astPodeOrcamento = () => typeof temModuloExtra === "function" && temModuloExtra("assistente_orcamento");

/* ---------- Abrir, fechar, nova conversa ---------- */
function abrirAssistente(ctx){
  if(!usuarioAtual){ aviso("app-aviso", "Entre no sistema para usar o assistente.", "erro"); return; }
  const painel = $("ast-painel");
  if(!painel) return;
  if(_astSomenteLeitura) novaConversaAssistente();
  _astContexto = ctx || (typeof chamadosContextoAtual === "function" ? chamadosContextoAtual() : { modulo: null, modulo_label: "—" });
  painel.hidden = false;
  document.body.classList.add("ast-aberto");
  $("btn-assistente")?.setAttribute("aria-expanded", "true");
  renderAssistente();
  setTimeout(() => $("ast-texto")?.focus(), 50);
}
function fecharAssistente(){
  const painel = $("ast-painel");
  if(painel) painel.hidden = true;
  document.body.classList.remove("ast-aberto");
  $("btn-assistente")?.setAttribute("aria-expanded", "false");
  astPararDitado();
}
function novaConversaAssistente(modo){
  _astConversaId = null; _astItens = []; _astPendentes = []; _astPrintsConversa = []; _astSomenteLeitura = false;
  _astModo = modo === "orcamento" && astPodeOrcamento() ? "orcamento" : "geral";
  _astArqPendentes = []; _astArquivosConversa = [];
  _astContexto = typeof chamadosContextoAtual === "function" ? chamadosContextoAtual() : _astContexto;
  renderAssistente();
  setTimeout(() => $("ast-texto")?.focus(), 50);
}
/* fase 174b: conversa de orçamento (D2) */
function montarOrcamentoAssistente(){
  if(!astPodeOrcamento()) return;
  if($("ast-painel")?.hidden !== false) abrirAssistente();
  novaConversaAssistente("orcamento");
}

/* ---------- Render ---------- */
/* A caixa de mensagem cresce com o texto até 160 px (o CSS limita) e volta a uma linha depois de enviar */
function astAjustarCaixa(){
  const c = $("ast-texto");
  if(!c) return;
  c.style.height = "auto";
  c.style.height = Math.min(c.scrollHeight, 160) + "px";
  c.style.overflowY = c.scrollHeight > 160 ? "auto" : "hidden";
}
function astHora(quando){
  const d = quando ? new Date(quando) : new Date();
  return isNaN(d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function astRenderContexto(){
  const el = $("ast-contexto");
  if(!el) return;
  if(_astSomenteLeitura){
    el.innerHTML = `<span class="rotulo-caps">Conversa</span><span>que gerou o chamado (só leitura)</span>`;
    return;
  }
  const c = _astContexto || {};
  const tela = c.modulo_label && c.modulo_label !== "—" ? c.modulo_label : null;
  const reg = c.registro_label || null;
  el.innerHTML = tela ? `<span class="rotulo-caps">Tela</span><span class="ast-contexto-tela">${esc(tela)}</span>`
    + (reg ? `<span class="ast-contexto-sep">/</span>${uiCodigo(reg)}` : "") : "";
}
/* Resposta do assistente: escapa linha a linha e só então troca **negrito** e `código`; linhas "1. …" viram passos
   numerados e "- …" lista. O resto do markdown fica como texto. A mensagem de quem escreve continua literal. */
function astInline(linha){
  return esc(linha)
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+?)`/g, '<code class="ast-msg-cod">$1</code>');
}
function astFormatarResposta(texto){
  const blocos = [];
  let par = [], lista = null;
  const fecharPar = () => { if(par.length){ blocos.push(`<p>${/* html */ par.map(astInline).join("\n")}</p>`); par = []; } };
  const fecharLista = () => {
    if(!lista) return;
    blocos.push(lista.tipo === "ol"
      ? `<ol class="ast-passos">${/* html */ lista.itens.map((t, k) => `<li><span class="ast-passo-n" aria-hidden="true">${esc(k + 1)}</span><span>${/* html */ astInline(t)}</span></li>`).join("")}</ol>`
      : `<ul class="ast-lista">${/* html */ lista.itens.map(t => `<li>${/* html */ astInline(t)}</li>`).join("")}</ul>`);
    lista = null;
  };
  for(const linha of String(texto || "").replace(/\r/g, "").split("\n")){
    const ol = linha.match(/^\s*\d+[.)]\s+(.*)$/), ul = linha.match(/^\s*[-•]\s+(.*)$/);
    if(ol || ul){
      fecharPar();
      const tipo = ol ? "ol" : "ul";
      if(lista && lista.tipo !== tipo) fecharLista();
      if(!lista) lista = { tipo, itens: [] };
      lista.itens.push((ol || ul)[1]);
    } else if(!linha.trim()){ fecharPar(); fecharLista(); }
    else { fecharLista(); par.push(linha); }
  }
  fecharPar(); fecharLista();
  return blocos.join("");
}
function astTurno(it){
  const eu = it.tipo === "usuario";
  const cls = eu ? "ast-turno ast-turno-eu" : "ast-turno ast-turno-ia";
  const rotulo = (eu ? "Você" : "Resposta") + (it.hora ? " · " + it.hora : "");
  const prints = (it.prints && it.prints.length ? `<span class="ast-msg-prints">${esc(it.prints.length)} print(s) anexado(s)</span>` : "")
    + (it.arquivos && it.arquivos.length ? `<span class="ast-msg-prints">${esc(it.arquivos.map(a => `${a.nome} (${AST_TIPOS_ARQ[a.tipo] || a.tipo})`).join(", "))}</span>` : "");
  const sem = it.sem_resposta ? `<div class="ast-msg-nota-info">Pergunta guardada para a equipe responder e para o manual do app.</div>` : "";
  const txt = eu ? esc(it.texto || "") : astFormatarResposta(it.texto);
  return `<section class="${esc(cls)}"><span class="rotulo-caps">${esc(rotulo)}</span><div class="ast-turno-txt">${/* html */ txt}</div>${prints}${sem}</section>`;
}
function astCartaoRascunho(it, i){
  const r = it.rascunho;
  if(it.aberto){
    return `<div class="ast-cartao">
      <div class="ast-cartao-topo"><span class="rotulo-caps">Chamado aberto</span></div>
      <div class="ast-cartao-corpo"><span>${uiCodigo("#" + (it.numero ?? ""))} ${esc(r.titulo)}</span></div>
      <div class="ast-cartao-acoes"><button type="button" class="btn-sec btn-sm" data-ast-ver-chamado="${esc(it.chamado_id)}">Ver em Chamados</button></div></div>`;
  }
  const cats = Object.entries(CHAM_CATEGORIA).map(([v, o]) => `<option value="${esc(v)}"${v === r.categoria ? " selected" : ""}>${esc(o.label)}</option>`).join("");
  const obras = Object.entries(mapaObras || {}).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR"))
    .map(([id, nome]) => `<option value="${esc(id)}"${id === r.obra_id ? " selected" : ""}>${esc(nome)}</option>`).join("");
  const reg = r.registro_tipo ? `<span class="chip">Registro: <strong>${esc(r.registro_tipo)}</strong>${_astContexto?.registro_id === r.registro_id && _astContexto?.registro_label ? " · " + esc(_astContexto.registro_label) : ""}</span>` : "";
  const mod = r.modulo ? `<span class="chip">Módulo: <strong>${esc(typeof chamModuloLabel === "function" ? chamModuloLabel(r.modulo) : r.modulo)}</strong></span>` : "";
  const prints = _astPrintsConversa.length ? `<span class="chip">${esc(_astPrintsConversa.length)} print(s) vão anexados</span>` : "";
  const podeAbrir = astPodeAbrirChamado();
  return `<div class="ast-cartao" data-ast-rascunho="${esc(i)}">
    <div class="ast-cartao-topo"><span class="rotulo-caps">Rascunho do chamado</span><span class="ast-pilula-aviso">Confira antes de abrir</span></div>
    <div class="ast-cartao-corpo">
      <div class="cham-contexto">${mod}${reg}${prints}</div>
      <div class="campo largo"><label for="ast-r-titulo-${esc(i)}">Título</label><input id="ast-r-titulo-${esc(i)}" maxlength="140" value="${esc(r.titulo)}" /></div>
      <div class="ast-cartao-linha">
        <div class="campo"><label for="ast-r-cat-${esc(i)}">Categoria</label><select id="ast-r-cat-${esc(i)}">${cats}</select></div>
        <div class="campo"><label for="ast-r-obra-${esc(i)}">Obra</label><select id="ast-r-obra-${esc(i)}"><option value="">— nenhuma —</option>${obras}</select></div>
      </div>
      <div class="campo largo"><label for="ast-r-desc-${esc(i)}">Descrição</label><textarea id="ast-r-desc-${esc(i)}" rows="10">${esc(r.descricao)}</textarea></div>
      <div class="aviso" id="ast-r-aviso-${esc(i)}"></div>
    </div>
    <div class="ast-cartao-acoes">
      ${podeAbrir ? `<button type="button" class="btn btn-sm" id="ast-r-abrir-${esc(i)}" data-ast-abrir="${esc(i)}">Abrir chamado</button>` : `<span class="meta">O perfil de revisão não abre chamado.</span>`}
      <button type="button" class="btn-sec btn-sm ast-descartar" data-ast-descartar="${esc(i)}">Descartar</button>
    </div>
  </div>`;
}
/* fase 174b (D7): resumo do orçamento montado pelo assistente. Total sem e com ISS pelas funções do orçamento
   (orcIssSobre); preço de cada item com a fonte que o servidor calculou. Nada é gravado aqui. */
function astCartaoOrcamento(it, i){
  const r = it.rascunho || {};
  const itens = Array.isArray(r.itens) ? r.itens : [];
  const issP = r.iss_percentual != null ? Number(r.iss_percentual) : 5;
  const issPd = r.iss_por_dentro !== false;
  const sub = itens.reduce((s, x) => s + (Number(x.quantidade) || 0) * (Number(x.valor_unitario) || 0), 0);
  const iss = typeof orcIssSobre === "function" ? orcIssSobre(sub, { iss_percentual: issP, iss_por_dentro: issPd }) : 0;
  const lbl = (mapa, v) => (typeof mapa !== "undefined" && mapa && mapa[v]) || v;
  const cli = r.cliente?.id ? `Cliente: <strong>${esc(r.cliente.nome || "")}</strong>`
    : `Cliente não cadastrado: <strong>${esc(r.cliente?.nome || "—")}</strong>${r.cliente?.cnpj ? " · CNPJ " + esc(r.cliente.cnpj) : ""} (cadastrar pelo CNPJ)`;
  const chips = [
    `<span class="chip">${/* html */ cli}</span>`,
    `<span class="chip">Método: <strong>${esc(lbl(typeof ORC_TIPO_LBL !== "undefined" ? ORC_TIPO_LBL : null, r.tipo_proposta))}</strong></span>`,
    r.tipo_obra ? `<span class="chip">Obra: <strong>${esc(r.tipo_obra)}</strong></span>` : "",
    r.faixa_profundidade ? `<span class="chip">Profundidade: <strong>${esc(lbl(typeof ORC_FAIXA_LBL !== "undefined" ? ORC_FAIXA_LBL : null, r.faixa_profundidade))}</strong></span>` : "",
    r.local_execucao ? `<span class="chip">Local: <strong>${esc(r.local_execucao)}</strong></span>` : ""
  ].join("");
  const linhas = itens.map(x => {
    const semPreco = x.valor_unitario == null;
    const tot = (Number(x.quantidade) || 0) * (Number(x.valor_unitario) || 0);
    return `<tr>
      <td>${esc(x.descricao || "")}${x.memoria ? `<span class="ast-orc-memoria">${esc(x.memoria)}</span>` : ""}</td>
      <td class="num">${esc(String(x.quantidade ?? 0).replace(".", ","))} ${esc(x.unidade || "")}</td>
      <td class="num" data-val-sens>${semPreco ? "—" : esc(brl(x.valor_unitario))}<span class="ast-orc-fonte${semPreco ? " sem-preco" : ""}">${esc(x.fonte || "")}</span></td>
      <td class="num" data-val-sens>${semPreco ? "—" : esc(brl(tot))}</td></tr>`;
  }).join("");
  const lista = (arr, cls) => Array.isArray(arr) && arr.length ? `<ul class="ast-orc-lista ${esc(cls)}">${arr.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : "";
  const podeAbrir = typeof preencherOrcamentoDoAssistente === "function" && typeof podeVerOrcamentos === "function" && podeVerOrcamentos();
  return `<div class="ast-cartao" data-ast-orcamento="${esc(i)}">
    <div class="ast-cartao-topo"><span class="rotulo-caps">Resumo do orçamento</span><span class="ast-pilula-aviso">Confira antes de salvar</span></div>
    <div class="ast-cartao-corpo">
      <div class="ast-orc-chips">${/* html */ chips}</div>
      <table class="ast-orc-tabela"><thead><tr><th>Item</th><th class="num">Qtd.</th><th class="num">Unitário e fonte</th><th class="num">Total</th></tr></thead>
        <tbody>${/* html */ linhas || `<tr><td colspan="4">Nenhum item.</td></tr>`}</tbody></table>
      <div class="ast-orc-totais" data-val-sens>
        <span>Subtotal (sem ISS)</span><span class="num">${esc(brl(sub))}</span>
        <span>ISS ${esc(issPd ? String(issP).replace(".", ",") + "% por dentro" : "não incluído")}</span><span class="num">${esc(brl(iss))}</span>
        <strong>Total com ISS</strong><strong class="num">${esc(brl(sub + iss))}</strong>
      </div>
      ${r.avisos?.length ? `<div><span class="rotulo-caps">Avisos</span>${/* html */ lista(r.avisos, "avisos")}</div>` : ""}
      ${r.pendencias?.length ? `<div><span class="rotulo-caps">Ficou sem resposta</span>${/* html */ lista(r.pendencias, "")}</div>` : ""}
    </div>
    <div class="ast-cartao-acoes">
      ${podeAbrir ? `<button type="button" class="btn btn-sm" data-ast-orc-abrir="${esc(i)}">Abrir na tela de orçamento</button>` : `<span class="meta">Seu perfil não abre a tela de orçamento.</span>`}
      <button type="button" class="btn-sec btn-sm ast-descartar" data-ast-descartar="${esc(i)}">Descartar</button>
    </div>
  </div>`;
}
function astCartaoParecidos(it){
  return `<section class="ast-bloco"><span class="rotulo-caps">Chamados parecidos já abertos</span>
    <div class="ast-parecidos">${it.chamados.map(c => `<div class="ast-parecido">${uiCodigo("#" + (c.numero ?? ""))}
      <div class="ast-parecido-txt"><strong>${esc(c.titulo || "")}</strong><span>${esc((CHAM_STATUS[c.status] || {}).label || c.status || "")}</span></div>
      <button type="button" class="btn-sec btn-sm" data-ast-ver-chamado="${esc(c.id)}" aria-label="Comentar no chamado #${esc(c.numero ?? "")}">Comentar</button></div>`).join("")}</div>
    ${_astSomenteLeitura ? "" : `<div><button type="button" class="btn-sec btn-sm" data-ast-mesmo-assim="1">Abrir um novo mesmo assim</button></div>`}
  </section>`;
}
function renderAssistente(){
  const lista = $("ast-mensagens");
  if(!lista) return;
  astRenderContexto();
  const sensivel = !_astSomenteLeitura && AST_SECOES_SENSIVEIS.has(_astContexto?.modulo);
  $("ast-aviso-sensivel").hidden = !sensivel;
  const orc = _astModo === "orcamento";
  const sub = $("ast-subtitulo"); if(sub) sub.textContent = orc ? "Montar orçamento" : "Dúvida ou chamado";
  const btnOrc = $("ast-orcamento"); if(btnOrc) btnOrc.hidden = !astPodeOrcamento() || orc || _astSomenteLeitura;
  const anexar = $("ast-anexar");
  if(anexar){ const t = orc ? "Anexar projeto (PDF), planilha, sondagem ou e-mail (até 20 MB)" : "Anexar print (até 5 por conversa)"; anexar.title = t; anexar.setAttribute("aria-label", t); }
  const inpArq = $("ast-arquivo"); if(inpArq) inpArq.accept = orc ? ".pdf,.xlsx,.xls,.csv,image/*" : "image/*";
  const boasVindas = _astItens.length ? "" : uiVazio(orc
    ? "Conte o pedido do cliente (pode colar o e-mail) e anexe o projeto em PDF, a planilha ou a sondagem. O assistente pergunta só o que faltar e monta o resumo com itens, quantidades e preço com a fonte; você confere e abre na tela de orçamento para salvar."
    : "Conte o que você precisa fazer ou tire uma dúvida de uso. Pode digitar, falar pelo microfone ou colar um print (Ctrl+V).");
  lista.innerHTML = boasVindas + _astItens.map((it, i) =>
    it.tipo === "rascunho" ? astCartaoRascunho(it, i)
    : it.tipo === "orcamento" ? astCartaoOrcamento(it, i)
    : it.tipo === "oferta_orc" ? `<section class="ast-bloco"><div><button type="button" class="btn btn-sm" data-ast-modo-orc="1">Montar orçamento</button></div></section>`
    : it.tipo === "parecidos" ? astCartaoParecidos(it)
    : it.tipo === "aviso" ? `<div class="ast-msg-erro" role="alert">${esc(it.texto)}</div>`
    : astTurno(it)).join("") + (_astEnviando ? `<section class="ast-turno ast-turno-ia"><span class="rotulo-caps">Resposta</span><span class="ast-digitando">${esc(_astStatus || "Procurando a resposta…")}</span></section>` : "");
  lista.scrollTop = lista.scrollHeight;
  const pend = $("ast-pendentes");
  if(pend){
    pend.innerHTML = _astPendentes.map((p, i) => `<span class="ast-pendente"><img src="${esc(p.url)}" alt="Print ${i + 1}" />
      <button type="button" class="btn-sec btn-sm" data-ast-tirar="${i}" aria-label="Tirar o print ${i + 1}">×</button></span>`).join("")
      + _astArqPendentes.map((a, i) => `<span class="ast-arquivo"><span class="ast-arquivo-nome" title="${esc(a.nome)}">${esc(a.nome)}</span>
        <select data-ast-arq-tipo="${esc(i)}" aria-label="Tipo do arquivo ${esc(a.nome)}">${Object.entries(AST_TIPOS_ARQ).map(([v, l]) => `<option value="${esc(v)}"${v === a.tipo ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <button type="button" class="btn-sec btn-sm" data-ast-tirar-arq="${esc(i)}" aria-label="Tirar o arquivo ${esc(a.nome)}">×</button></span>`).join("");
    pend.hidden = !_astPendentes.length && !_astArqPendentes.length;
  }
  const rod = $("ast-rodape");
  if(rod) rod.hidden = _astSomenteLeitura;
  const env = $("ast-enviar"); if(env) env.disabled = _astEnviando;
}

/* ---------- Conversa no banco (a function grava as mensagens; o front só cria a conversa quando precisa da pasta) ---------- */
async function astGarantirConversa(){
  if(_astConversaId) return _astConversaId;
  const c = _astContexto || {};
  const { data, error } = await sb.from("assistente_conversas").insert({
    secao: c.modulo || null, registro_tipo: c.registro_id ? c.registro_tipo : null, registro_id: c.registro_id || null,
    modo: _astModo === "orcamento" ? "orcamento" : "geral"   // fase 174b: a RLS só aceita 'orcamento' com o módulo extra
  }).select("id").single();
  if(error) throw new Error(error.message);
  _astConversaId = data.id;
  return _astConversaId;
}

/* ---------- Prints ---------- */
function astReduzirImagem(arquivo){
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.addEventListener("load", () => {
      const f = Math.min(1, AST_LADO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.naturalWidth * f); cv.height = Math.round(img.naturalHeight * f);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? ok(b) : falha(new Error("não foi possível reduzir a imagem")), "image/jpeg", 0.85);
    });
    img.addEventListener("error", () => { URL.revokeObjectURL(url); falha(new Error("arquivo não é imagem")); });
    img.src = url;
  });
}
async function astAnexarArquivos(arquivos){
  if(_astModo === "orcamento"){ astAnexarArquivosOrc(arquivos); return; }
  const imgs = [...arquivos].filter(f => /^image\//.test(f.type || ""));
  if(!imgs.length) return;
  if(_astPrintsConversa.length + _astPendentes.length + imgs.length > AST_MAX_IMAGENS){
    astAviso(`Até ${AST_MAX_IMAGENS} prints por conversa.`); return;
  }
  try {
    const conv = await astGarantirConversa();
    for(const f of imgs){
      const blob = await astReduzirImagem(f);
      const caminho = `${usuarioAtual.id}/${conv}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      // supabase-js ignora contentType com File: o corpo já é Blob image/jpeg
      const up = await sb.storage.from(AST_BUCKET).upload(caminho, new Blob([blob], { type: "image/jpeg" }), { contentType: "image/jpeg", upsert: false });
      if(up.error){ astAviso("Não foi possível enviar o print: " + up.error.message); continue; }
      _astPendentes.push({ caminho, url: URL.createObjectURL(blob), blob });
    }
  } catch(e){ astAviso("Não foi possível anexar: " + e.message); }
  renderAssistente();
}
async function astTirarPendente(i){
  const p = _astPendentes[i];
  if(!p) return;
  _astPendentes.splice(i, 1);
  URL.revokeObjectURL(p.url);
  await sb.storage.from(AST_BUCKET).remove([p.caminho]);
  renderAssistente();
}
function astAviso(txt){ _astItens.push({ tipo: "aviso", texto: txt }); renderAssistente(); }

/* ---------- Fase 174b: arquivos do orçamento (D9) ---------- */
const AST_EXT_ORC = ["pdf", "xlsx", "xls", "csv", "jpg", "jpeg", "png", "webp"];
function astAnexarArquivosOrc(arquivos){
  for(const f of [...arquivos]){
    const ext = extensaoArquivo(f);
    if(!AST_EXT_ORC.includes(ext)){ astAviso(`${f.name}: envie PDF, planilha (xlsx, xls, csv) ou imagem.`); continue; }
    if(f.size > AST_ARQ_MAX_MB * 1048576){ astAviso(`${f.name} tem ${(f.size / 1048576).toFixed(1)} MB; o limite é ${AST_ARQ_MAX_MB} MB. Exporte só as folhas que importam.`); continue; }
    const tipo = ["xlsx", "xls", "csv"].includes(ext) ? "planilha" : ext === "pdf" ? (/sondag|spt/i.test(f.name) ? "sondagem" : "projeto") : "pedido";
    _astArqPendentes.push({ file: f, nome: f.name, ext, tipo });
  }
  renderAssistente();
}
async function astSha256(file){
  const buf = await file.arrayBuffer();
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map(b => b.toString(16).padStart(2, "0")).join("");
}
function astBase64(file){
  return new Promise((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(",")[1] || "");
    fr.onerror = () => falha(new Error("Falha ao ler o arquivo."));
    fr.readAsDataURL(file);
  });
}
/* páginas de um PDF pelo texto do arquivo (/Type /Page); 0 = não deu para contar (objetos comprimidos): segue */
async function astContarPaginasPdf(file){
  const txt = new TextDecoder("latin1").decode(new Uint8Array(await file.arrayBuffer()));
  return (txt.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}
/* planilha lida no navegador (SheetJS de vendor/): primeira aba, até 300 linhas não vazias, colunas separadas por " | " */
async function astLerPlanilha(file){
  if(typeof XLSX === "undefined") return "";
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const aba = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(aba, { header: 1, raw: false, defval: "" })
    .map(l => l.map(c => String(c).replace(/\s+/g, " ").trim()))
    .filter(l => l.some(c => c));
  return linhas.slice(0, AST_PLANILHA_LINHAS).map(l => l.join(" | ")).join("\n")
    + (linhas.length > AST_PLANILHA_LINHAS ? `\n(… mais ${linhas.length - AST_PLANILHA_LINHAS} linha(s) não enviadas)` : "");
}
/* projeto: leitura do quadro de estacas pela extrair-estacas-pdf com o hash (cache D11: mesmo arquivo não paga de novo) */
async function astLerProjeto(file, sha){
  const pdf = await astBase64(file);
  const { data, error } = await iaInvocarComLimite("extrair-estacas-pdf", { pdf_base64: pdf, sha256: sha },
    "A leitura do projeto passou do limite de tempo. Divida o PDF nas folhas do quadro de estacas.", 400000);
  if(error){
    let msg = error.message;
    try { const j = await error.context?.json?.(); if(j?.error) msg = j.error; } catch(_){ /* corpo ilegível */ }
    throw new Error(msg);
  }
  if(data?.error) throw new Error(data.error);
  return data;
}
/* sobe os arquivos pendentes para a pasta da conversa; devolve o que vai no corpo da mensagem */
async function astEnviarArquivosOrc(conv, arqs){
  const enviados = [];
  let planilha = null;
  for(const a of arqs){
    try {
      if(a.tipo === "sondagem" && a.ext === "pdf"){
        const n = await astContarPaginasPdf(a.file);
        if(n > AST_SONDAGEM_PAGINAS){ astAviso(`${a.nome}: a sondagem tem ${n} páginas; envie só as ${AST_SONDAGEM_PAGINAS} que importam.`); continue; }
      }
      if((a.tipo === "sondagem" || a.tipo === "pedido") && !["pdf", "jpg", "jpeg", "png", "webp"].includes(a.ext)){
        astAviso(`${a.nome}: sondagem e pedido vão em PDF ou imagem.`); continue;
      }
      _astStatus = `Enviando ${a.nome}…`; renderAssistente();
      const sha = await astSha256(a.file);
      const nomeLimpo = a.nome.replace(/\.[^.]*$/, "").normalize("NFD").replace(/[^\w-]+/g, "_").slice(0, 60) || "arquivo";
      const caminho = `${usuarioAtual.id}/pendente/${conv}/${Date.now()}_${a.tipo}_${nomeLimpo}.${a.ext}`;
      const mime = mimeDoArquivo(a.file, a.ext);
      const up = await sb.storage.from(AST_BUCKET_ORC).upload(caminho, corpoComMime(a.file, mime), { contentType: mime, upsert: false });
      if(up.error){ astAviso(`Não foi possível enviar ${a.nome}: ${up.error.message}`); continue; }
      const reg = { caminho, tipo: a.tipo, nome: a.nome, sha256: sha, tamanho: a.file.size };
      if(a.tipo === "projeto" && a.ext === "pdf"){
        _astStatus = `Lendo o projeto ${a.nome} (até ~1 minuto; projeto já lido não paga de novo)…`; renderAssistente();
        try {
          const r = await astLerProjeto(a.file, sha);
          const n = Array.isArray(r?.estacas) ? r.estacas.length : 0;
          if(!n) astAviso(`${a.nome}: a leitura não achou o quadro de estacas. Conte o quantitativo na conversa ou mande a planilha.`);
        } catch(e){ astAviso(`${a.nome}: a leitura do projeto falhou (${e.message}). O assistente vai perguntar o quantitativo.`); }
      }
      if(a.tipo === "planilha"){
        try { planilha = { nome: a.nome, texto: await astLerPlanilha(a.file) }; }
        catch(e){ astAviso(`${a.nome}: não consegui ler a planilha (${e.message}).`); }
      }
      _astArquivosConversa.push(reg);
      enviados.push(reg);
    } catch(e){ astAviso(`${a.nome}: ${e.message}`); }
  }
  _astStatus = "";
  return { enviados, planilha };
}

/* ---------- Enviar ---------- */
async function enviarMensagemAssistente(textoForcado){
  if(_astEnviando || _astSomenteLeitura) return;
  const caixa = $("ast-texto");
  const texto = (textoForcado ?? caixa?.value ?? "").trim();
  if(!texto && !_astPendentes.length && !_astArqPendentes.length) return;
  astPararDitado();
  const prints = _astPendentes.splice(0);
  const arqs = _astArqPendentes.splice(0);
  _astPrintsConversa.push(...prints);
  _astItens.push({ tipo: "usuario", texto, prints, arquivos: arqs.map(a => ({ nome: a.nome, tipo: a.tipo })), hora: astHora() });
  if(caixa && textoForcado == null){ caixa.value = ""; astAjustarCaixa(); }
  _astEnviando = true;
  renderAssistente();
  try {
    const conv = await astGarantirConversa();
    const ins = arqs.length ? await astEnviarArquivosOrc(conv, arqs) : { enviados: [], planilha: null };
    if(!texto && !prints.length && !ins.enviados.length && !ins.planilha) return;
    _astStatus = ""; renderAssistente();
    const c = _astContexto || {};
    const corpo = {
      conversa_id: conv, mensagem: texto, anexos: prints.map(p => p.caminho), modo: _astModo,
      arquivos: ins.enviados.map(a => ({ caminho: a.caminho, tipo: a.tipo, nome: a.nome, sha256: a.sha256 })),
      planilha: ins.planilha,
      contexto: { secao: c.modulo || null, secao_label: c.modulo_label || null, registro_tipo: c.registro_tipo || null,
        registro_id: c.registro_id || null, registro_label: c.registro_label || null, obra_id: c.obra_id || null,
        sensivel: AST_SECOES_SENSIVEIS.has(c.modulo) }
    };
    const { data, error } = await iaInvocarComLimite("assistente", corpo, "O assistente demorou demais para responder. Tente de novo.", AST_LIMITE_MS);
    if(error){
      let msg = error.message;
      try { const j = await error.context?.json?.(); if(j?.error) msg = j.error; } catch(_){ /* corpo ilegível */ }
      throw new Error(msg);
    }
    if(data?.error) throw new Error(data.error);
    if(data?.conversa_id) _astConversaId = data.conversa_id;
    _astItens.push({ tipo: "assistente", texto: data.resposta, sem_resposta: !!data.sem_resposta, hora: astHora() });
    if(Array.isArray(data.chamados_parecidos) && data.chamados_parecidos.length) _astItens.push({ tipo: "parecidos", chamados: data.chamados_parecidos });
    if(data.rascunho_chamado) _astItens.push({ tipo: "rascunho", rascunho: data.rascunho_chamado });
    if(data.rascunho_orcamento) _astItens.push({ tipo: "orcamento", rascunho: data.rascunho_orcamento });   // fase 174b
    if(data.sugerir_modo_orcamento && astPodeOrcamento()) _astItens.push({ tipo: "oferta_orc" });
  } catch(e){
    _astItens.push({ tipo: "aviso", texto: "Não foi possível falar com o assistente: " + e.message });
  } finally {
    _astEnviando = false; _astStatus = "";
    renderAssistente();
  }
}

/* ---------- Confirmar o chamado (insert da pessoa, origem 'assistente') ---------- */
async function confirmarChamadoAssistente(i){
  const it = _astItens[i];
  if(!it || it.tipo !== "rascunho" || it.aberto || !usuarioAtual || !_astConversaId) return;
  const titulo = ($(`ast-r-titulo-${i}`)?.value || "").trim();
  const descricao = ($(`ast-r-desc-${i}`)?.value || "").trim();
  const categoria = $(`ast-r-cat-${i}`)?.value || it.rascunho.categoria;
  if(!titulo){ aviso(`ast-r-aviso-${i}`, "Dê um título ao chamado.", "erro"); return; }
  if(!descricao){ aviso(`ast-r-aviso-${i}`, "A descrição não pode ficar vazia.", "erro"); return; }
  const c = _astContexto || {};
  const rodape = [`tela: ${c.modulo_label || "—"}`, c.registro_label ? `registro: ${c.registro_label}` : null, "aberto pelo assistente",
    `navegador: ${(navigator.userAgent || "").replace(/\).*$/, ")").slice(0, 120)}`].filter(Boolean).join(" · ");
  const reg = {
    titulo, categoria, status: "aberto",
    descricao: descricao + "\n\n— contexto automático: " + rodape,
    modulo: it.rascunho.modulo || c.modulo || null,
    obra_id: $(`ast-r-obra-${i}`)?.value || null,
    registro_tipo: it.rascunho.registro_id ? it.rascunho.registro_tipo : null,
    registro_id: it.rascunho.registro_id || null,
    aberto_por: usuarioAtual.id,
    origem: "assistente",
    assistente_conversa_id: _astConversaId
  };
  const { data, error } = await sb.from("chamados").insert(reg).select("id,numero").single();
  if(error){ aviso(`ast-r-aviso-${i}`, "Não foi possível abrir o chamado: " + error.message, "erro"); return; }
  // prints da conversa vão para os anexos do chamado (rotina da fase 48: 5 arquivos, 20 MB)
  let falhas = [];
  if(_astPrintsConversa.length && typeof chamEnviarAnexos === "function"){
    const arquivos = [];
    for(const [k, p] of _astPrintsConversa.entries()){
      let blob = p.blob;
      if(!blob){ const d = await sb.storage.from(AST_BUCKET).download(p.caminho); blob = d.data; }
      if(blob) arquivos.push(new File([blob], `print-${k + 1}.jpg`, { type: "image/jpeg" }));
    }
    falhas = await chamEnviarAnexos(data.id, arquivos.slice(0, CHAM_ANEXO_MAX));
  }
  await sb.from("assistente_conversas").update({ chamado_id: data.id, encerrada_em: new Date().toISOString() }).eq("id", _astConversaId);
  it.aberto = true; it.chamado_id = data.id; it.numero = data.numero; it.rascunho.titulo = titulo;
  _astItens.push({ tipo: "assistente", hora: astHora(), texto: `Chamado #${data.numero} aberto. A triagem diária dá o retorno no próprio chamado.` +
    (falhas.length ? ` ${falhas.length} print(s) não subiram; anexe pela ficha do chamado.` : "") });
  renderAssistente();
  if(typeof carregarChamados === "function") carregarChamados(true);
}
async function astVerChamado(id){
  fecharAssistente();
  irParaSecao("chamados");
  if(typeof carregarChamados === "function") await carregarChamados(true);
  if(typeof abrirChamado === "function") abrirChamado(id);
}

/* ---------- "Ver conversa" a partir da ficha do chamado (RLS: autor e diretoria) ---------- */
async function abrirConversaAssistente(conversaId){
  const { data, error } = await sb.from("assistente_mensagens").select("papel,texto,anexos,sem_resposta,criado_em")
    .eq("conversa_id", conversaId).order("criado_em", { ascending: true });
  if(error || !data?.length){
    aviso("cham-ficha-aviso", error ? "Não foi possível ler a conversa: " + error.message : "A conversa não está visível para você.", "erro");
    return;
  }
  _astSomenteLeitura = true; _astConversaId = conversaId; _astPendentes = []; _astPrintsConversa = [];
  _astItens = data.map(m => ({ tipo: m.papel === "assistente" ? "assistente" : "usuario", texto: m.texto, sem_resposta: m.sem_resposta, hora: astHora(m.criado_em),
    prints: Array.isArray(m.anexos) ? m.anexos : [] }));
  if(typeof fecharChamado === "function") fecharChamado();
  const painel = $("ast-painel");
  painel.hidden = false;
  document.body.classList.add("ast-aberto");
  renderAssistente();
}

/* ---------- Ditado (Web Speech API do navegador) ---------- */
function astDitadoDisponivel(){ return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function astAlternarDitado(){
  if(_astReconhecedor){ astPararDitado(); return; }
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!R) return;
  const rec = new R();
  rec.lang = "pt-BR"; rec.interimResults = false; rec.continuous = true;
  const caixa = $("ast-texto");
  rec.addEventListener("result", (ev) => {
    let novo = "";
    for(let k = ev.resultIndex; k < ev.results.length; k++) if(ev.results[k].isFinal) novo += ev.results[k][0].transcript;
    if(novo && caixa){ caixa.value = (caixa.value ? caixa.value.replace(/\s*$/, " ") : "") + novo.trim(); astAjustarCaixa(); }
  });
  rec.addEventListener("end", () => { _astReconhecedor = null; astMarcarMicrofone(false); });
  rec.addEventListener("error", (ev) => { _astReconhecedor = null; astMarcarMicrofone(false);
    if(ev.error === "not-allowed") astAviso("O navegador não liberou o microfone."); });
  _astReconhecedor = rec;
  astMarcarMicrofone(true);
  rec.start();
}
function astPararDitado(){ if(_astReconhecedor){ try { _astReconhecedor.stop(); } catch(_){ /* já parado */ } } }
function astMarcarMicrofone(ligado){
  const b = $("ast-microfone");
  if(!b) return;
  b.setAttribute("aria-pressed", ligado ? "true" : "false");
  b.title = ligado ? "Parar o ditado" : "Ditar pelo microfone (o texto cai na caixa para você revisar)";
}

/* ---------- Listeners ---------- */
function ligarAssistente(){
  $("btn-assistente")?.addEventListener("click", () => { $("ast-painel")?.hidden === false ? fecharAssistente() : abrirAssistente(); });
  $("ast-fechar")?.addEventListener("click", fecharAssistente);
  $("ast-nova")?.addEventListener("click", () => novaConversaAssistente());
  $("ast-orcamento")?.addEventListener("click", montarOrcamentoAssistente);   // fase 174b
  $("ast-pendentes")?.addEventListener("change", (e) => {
    const s = e.target.closest("[data-ast-arq-tipo]");
    if(s && _astArqPendentes[Number(s.dataset.astArqTipo)]) _astArqPendentes[Number(s.dataset.astArqTipo)].tipo = s.value;
  });
  $("ast-formulario")?.addEventListener("click", () => {
    const ctx = _astContexto; fecharAssistente();
    if(typeof abrirNovoChamado === "function") abrirNovoChamado(ctx || (typeof chamadosContextoAtual === "function" ? chamadosContextoAtual() : null));
  });
  $("ast-enviar")?.addEventListener("click", () => enviarMensagemAssistente());
  $("ast-texto")?.addEventListener("input", astAjustarCaixa);
  $("ast-texto")?.addEventListener("keydown", (e) => {
    if(e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); enviarMensagemAssistente(); }
  });
  $("ast-texto")?.addEventListener("paste", (e) => {
    const arqs = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type));
    if(arqs.length){ e.preventDefault(); astAnexarArquivos(arqs); }
  });
  $("ast-anexar")?.addEventListener("click", () => $("ast-arquivo")?.click());
  $("ast-arquivo")?.addEventListener("change", (e) => { astAnexarArquivos(e.target.files || []); e.target.value = ""; });
  const mic = $("ast-microfone");
  if(mic){ if(astDitadoDisponivel()) { mic.hidden = false; mic.addEventListener("click", astAlternarDitado); } else mic.hidden = true; }
  $("ast-pendentes")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ast-tirar]"); if(b){ astTirarPendente(Number(b.dataset.astTirar)); return; }
    const a = e.target.closest("[data-ast-tirar-arq]"); if(a){ _astArqPendentes.splice(Number(a.dataset.astTirarArq), 1); renderAssistente(); }
  });
  $("ast-mensagens")?.addEventListener("click", (e) => {
    const abrir = e.target.closest("[data-ast-abrir]");
    if(abrir){ comBotaoTravado(abrir.id, () => confirmarChamadoAssistente(Number(abrir.dataset.astAbrir))); return; }
    const desc = e.target.closest("[data-ast-descartar]");
    if(desc){ _astItens.splice(Number(desc.dataset.astDescartar), 1); renderAssistente(); return; }
    const ver = e.target.closest("[data-ast-ver-chamado]");
    if(ver){ astVerChamado(ver.dataset.astVerChamado); return; }
    if(e.target.closest("[data-ast-mesmo-assim]")){ enviarMensagemAssistente("Quero abrir um chamado novo mesmo assim."); return; }
    if(e.target.closest("[data-ast-modo-orc]")){ montarOrcamentoAssistente(); return; }   // fase 174b
    const orc = e.target.closest("[data-ast-orc-abrir]");
    if(orc){
      const it = _astItens[Number(orc.dataset.astOrcAbrir)];
      if(!it?.rascunho) return;
      fecharAssistente();
      preencherOrcamentoDoAssistente(it.rascunho, { conversa_id: _astConversaId, arquivos: _astArquivosConversa.slice() });
    }
  });
  document.addEventListener("keydown", (e) => { if(e.key === "Escape" && $("ast-painel")?.hidden === false) fecharAssistente(); });
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarAssistente);
} else {
  ligarAssistente();
}

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
   ==================================================================== */

const AST_BUCKET = "assistente-anexos";
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

const astPodeAbrirChamado = () => !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());

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
function novaConversaAssistente(){
  _astConversaId = null; _astItens = []; _astPendentes = []; _astPrintsConversa = []; _astSomenteLeitura = false;
  _astContexto = typeof chamadosContextoAtual === "function" ? chamadosContextoAtual() : _astContexto;
  renderAssistente();
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
  const prints = it.prints && it.prints.length ? `<span class="ast-msg-prints">${esc(it.prints.length)} print(s) anexado(s)</span>` : "";
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
  const boasVindas = _astItens.length ? "" : uiVazio("Conte o que você precisa fazer ou tire uma dúvida de uso. Pode digitar, falar pelo microfone ou colar um print (Ctrl+V).");
  lista.innerHTML = boasVindas + _astItens.map((it, i) =>
    it.tipo === "rascunho" ? astCartaoRascunho(it, i)
    : it.tipo === "parecidos" ? astCartaoParecidos(it)
    : it.tipo === "aviso" ? `<div class="ast-msg-erro" role="alert">${esc(it.texto)}</div>`
    : astTurno(it)).join("") + (_astEnviando ? `<section class="ast-turno ast-turno-ia"><span class="rotulo-caps">Resposta</span><span class="ast-digitando">Procurando a resposta…</span></section>` : "");
  lista.scrollTop = lista.scrollHeight;
  const pend = $("ast-pendentes");
  if(pend){
    pend.innerHTML = _astPendentes.map((p, i) => `<span class="ast-pendente"><img src="${esc(p.url)}" alt="Print ${i + 1}" />
      <button type="button" class="btn-sec btn-sm" data-ast-tirar="${i}" aria-label="Tirar o print ${i + 1}">×</button></span>`).join("");
    pend.hidden = !_astPendentes.length;
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
    secao: c.modulo || null, registro_tipo: c.registro_id ? c.registro_tipo : null, registro_id: c.registro_id || null
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

/* ---------- Enviar ---------- */
async function enviarMensagemAssistente(textoForcado){
  if(_astEnviando || _astSomenteLeitura) return;
  const caixa = $("ast-texto");
  const texto = (textoForcado ?? caixa?.value ?? "").trim();
  if(!texto && !_astPendentes.length) return;
  astPararDitado();
  const prints = _astPendentes.splice(0);
  _astPrintsConversa.push(...prints);
  _astItens.push({ tipo: "usuario", texto, prints, hora: astHora() });
  if(caixa && textoForcado == null){ caixa.value = ""; astAjustarCaixa(); }
  _astEnviando = true;
  renderAssistente();
  try {
    const conv = await astGarantirConversa();
    const c = _astContexto || {};
    const corpo = {
      conversa_id: conv, mensagem: texto, anexos: prints.map(p => p.caminho),
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
  } catch(e){
    _astItens.push({ tipo: "aviso", texto: "Não foi possível falar com o assistente: " + e.message });
  } finally {
    _astEnviando = false;
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
  $("ast-nova")?.addEventListener("click", novaConversaAssistente);
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
  $("ast-pendentes")?.addEventListener("click", (e) => { const b = e.target.closest("[data-ast-tirar]"); if(b) astTirarPendente(Number(b.dataset.astTirar)); });
  $("ast-mensagens")?.addEventListener("click", (e) => {
    const abrir = e.target.closest("[data-ast-abrir]");
    if(abrir){ comBotaoTravado(abrir.id, () => confirmarChamadoAssistente(Number(abrir.dataset.astAbrir))); return; }
    const desc = e.target.closest("[data-ast-descartar]");
    if(desc){ _astItens.splice(Number(desc.dataset.astDescartar), 1); renderAssistente(); return; }
    const ver = e.target.closest("[data-ast-ver-chamado]");
    if(ver){ astVerChamado(ver.dataset.astVerChamado); return; }
    if(e.target.closest("[data-ast-mesmo-assim]")) enviarMensagemAssistente("Quero abrir um chamado novo mesmo assim.");
  });
  document.addEventListener("keydown", (e) => { if(e.key === "Escape" && $("ast-painel")?.hidden === false) fecharAssistente(); });
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarAssistente);
} else {
  ligarAssistente();
}

/* ====================================================================
   Módulo: Histórico de registros ("chatter", estilo Odoo)
   Mostra, na ficha de um cadastro, a linha do tempo de alterações
   automáticas + notas internas + comunicação, e permite publicar
   mensagens. Genérico: serve a qualquer entidade (clientes, etc.).

   Lote S55 (#176, 27/10/2026): menção "@usuário". Digitar "@" no compositor
   abre a lista de usuários ativos ("Nome · cargo"); a escolha entra no texto
   como "@Nome Sobrenome" e vai como p_mencionados para a RPC chatter_publicar
   (mensagem + chatter_mencoes numa transação). O mencionado recebe o card
   "Você foi mencionado por…" na Minha fila (vw_sc_minha_fila_mencoes) e, ao
   abrir a ficha, chatter_mencoes_marcar_lidas tira o card. Antes da migration
   a RPC não existe: cai no insert direto de hoje, sem menção.
   Obra (obras_comentarios) e Chamados têm o próprio "marcar" e ficam fora.
   ==================================================================== */

let _histCtx  = { entidade:null, registroId:null, containerId:null };
let _histUser = null;   /* { id, nome } do usuário logado (cache) */
let _histUsuarios = null;          /* lote S55: profiles ativos { id, nome, cargo }, carregados no primeiro "@" */
let _histMencoes = new Map();      /* lote S55: nome escolhido no picker → id (do compositor aberto) */
let _histMencoesPendentes = null;  /* lote S55: Set de registro_id com menção não lida (preenchido por dashCarregarFila); null = não carregado */
let _histPickIdx = -1;             /* lote S55: item realçado no picker */
const HIST_MENCAO_MAX = 8;

/* rótulos amigáveis dos campos do banco */
const HIST_CAMPOS = {
  tipo_pessoa:"Tipo de pessoa", nome:"Nome / Razão social", razao_social:"Razão social",
  nome_fantasia:"Nome fantasia", cpf_cnpj:"CPF / CNPJ", inscricao_estadual:"Inscrição estadual",
  email:"E-mail", telefone:"Telefone", contato_nome:"Pessoa de contato", categoria:"Categoria",
  cep:"CEP", logradouro:"Logradouro", numero:"Número", complemento:"Complemento",
  bairro:"Bairro", cidade:"Cidade", uf:"UF", observacoes:"Observações", ativo:"Situação (ativo)"
};
const histCampoLabel = (c) => HIST_CAMPOS[c] || c || "campo";

/* usuário logado (id + nome), com cache */
async function histUsuario(){
  if(_histUser) return _histUser;
  const { data:{ user } } = await sb.auth.getUser();
  if(!user){ _histUser = { id:null, nome:null }; return _histUser; }
  const { data:perfil } = await sb.from("profiles").select("nome").eq("id",user.id).single();
  _histUser = { id:user.id, nome: perfil ? perfil.nome : user.email };
  return _histUser;
}

/* data/hora curta dd/mm/aaaa hh:mm */
function histQuando(iso){
  const d = new Date(iso);
  if(isNaN(d)) return "";
  const p = (n)=>String(n).padStart(2,"0");
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- lote S55: menções ---------- */
/* sem acento e minúsculo, para casar "fab" com "Fabrício" */
const histNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/* rótulo do cargo: CARGOS de usuarios.js quando carregado, senão o valor bruto */
const histCargoLabel = (cargo) => (typeof CARGOS !== "undefined" && CARGOS && CARGOS[cargo]) || cargo || "";
/* usuários ativos (id, nome, cargo), legíveis por todo autenticado (profiles_select_all) */
async function histUsuariosAtivos(){
  if(_histUsuarios) return _histUsuarios;
  const { data, error } = await sb.from("profiles").select("id,nome,cargo").eq("ativo", true).order("nome");
  _histUsuarios = error ? [] : (data || []).filter(p => p.nome);
  return _histUsuarios;
}
/* dashCarregarFila (dashboard.js) avisa quais registros têm menção não lida para mim */
function histMencoesPendentesDefinir(ids){
  _histMencoesPendentes = new Set((ids || []).filter(Boolean));
}
/* trecho "@xxx" imediatamente antes do cursor (sem quebra de linha nem outro "@"), ou null */
function histTrechoMencao(ta){
  const antes = ta.value.slice(0, ta.selectionStart || 0);
  const m = antes.match(/(^|[\s(])@([^\n@]{0,30})$/);
  return m ? { prefixo: m[2], inicio: antes.length - m[2].length - 1 } : null;
}
async function histAtualizarPicker(){
  const ta = $("hist-texto"), lista = $("hist-mencoes");
  if(!ta || !lista) return;
  const trecho = histTrechoMencao(ta);
  if(!trecho){ histFecharPicker(); return; }
  const usuarios = await histUsuariosAtivos();
  const u = await histUsuario();
  const pref = histNorm(trecho.prefixo);
  // casa pelo começo do nome ou de qualquer palavra dele ("fab" → Fabrício; "lima" → Fabrício Lima); nunca o próprio usuário
  const achados = usuarios.filter(p => p.id !== u.id && (histNorm(p.nome).startsWith(pref) || histNorm(p.nome).split(/\s+/).some(w => w.startsWith(pref))))
    .slice(0, HIST_MENCAO_MAX);
  if(!achados.length){
    lista.innerHTML = `<div class="resultado-item vazio">Ninguém com "${esc(trecho.prefixo)}"</div>`;
    lista.style.display = ""; _histPickIdx = -1; return;
  }
  _histPickIdx = 0;
  lista.innerHTML = achados.map((p, i) => `<div class="resultado-item${i === 0 ? " ativo" : ""}" data-id="${esc(p.id)}" data-nome="${esc(p.nome)}">${esc(p.nome)} <span class="meta">· ${esc(histCargoLabel(p.cargo))}</span></div>`).join("");
  lista.style.display = "";
}
function histFecharPicker(){
  const lista = $("hist-mencoes");
  if(lista){ lista.style.display = "none"; lista.innerHTML = ""; }
  _histPickIdx = -1;
}
function histPickerMover(delta){
  const itens = [...document.querySelectorAll("#hist-mencoes .resultado-item[data-id]")];
  if(!itens.length) return false;
  _histPickIdx = (_histPickIdx + delta + itens.length) % itens.length;
  itens.forEach((el, i) => el.classList.toggle("ativo", i === _histPickIdx));
  itens[_histPickIdx].scrollIntoView({ block: "nearest" });
  return true;
}
/* troca o "@pref" pelo "@Nome Sobrenome " e guarda a escolha */
function histEscolherMencao(id, nome){
  const ta = $("hist-texto");
  if(!ta || !id || !nome) return;
  const trecho = histTrechoMencao(ta);
  const fim = ta.selectionStart || ta.value.length;
  const inicio = trecho ? trecho.inicio : fim;
  const marca = "@" + nome + " ";
  ta.value = ta.value.slice(0, inicio) + marca + ta.value.slice(fim);
  const pos = inicio + marca.length;
  ta.setSelectionRange(pos, pos);
  _histMencoes.set(nome, id);
  histFecharPicker();
  ta.focus();
}
function histPickerEscolherAtivo(){
  const itens = [...document.querySelectorAll("#hist-mencoes .resultado-item[data-id]")];
  const el = itens[_histPickIdx >= 0 ? _histPickIdx : 0];
  if(!el) return false;
  histEscolherMencao(el.dataset.id, el.dataset.nome);
  return true;
}
/* ids dos mencionados cujo "@Nome" ainda está no texto (apagou o nome = não menciona) */
function histMencionadosNoTexto(txt){
  return [..._histMencoes].filter(([nome]) => txt.includes("@" + nome)).map(([, id]) => id);
}
/* ao abrir a ficha de um registro com menção não lida para mim, marca como lida e refaz a Minha fila */
async function histMarcarMencoesLidas(entidade, registroId){
  if(!registroId) return;
  if(_histMencoesPendentes && !_histMencoesPendentes.has(registroId)) return;
  const { data, error } = await sb.rpc("chatter_mencoes_marcar_lidas", { p_entidade: entidade, p_registro_id: registroId });
  if(error || !(Number(data) > 0)) return;   // RPC ausente (antes da migration) ou nada a marcar
  if(_histMencoesPendentes) _histMencoesPendentes.delete(registroId);
  if(typeof dashCarregarFila === "function") dashCarregarFila();
}

/* monta o painel de histórico dentro de um container */
async function montarHistorico(entidade, registroId, containerId){
  _histCtx = { entidade, registroId, containerId };
  _histMencoes = new Map();
  const cont = $(containerId);
  if(!cont) return;
  cont.style.display = "block";
  cont.innerHTML = `
    <h3 style="margin-top:22px;">Histórico</h3>
    <div class="hist-compositor">
      <div class="hist-abas">
        <button type="button" class="hist-aba ativo" data-tipo="nota">Nota interna</button>
        <button type="button" class="hist-aba" data-tipo="comunicacao">Comunicação</button>
      </div>
      <div class="hist-mencoes-wrap">
        <textarea id="hist-texto" placeholder="Escreva uma nota interna... (@ menciona alguém)"></textarea>
        <div id="hist-mencoes" class="autocomplete-lista" style="display:none;"></div>
      </div>
      <div class="hist-compositor-acoes">
        <span class="meta">Digite <strong>@</strong> para mencionar um usuário: ele recebe o aviso na Sala de Comando.</span>
        <button type="button" class="btn" id="hist-publicar">Publicar</button>
      </div>
    </div>
    <div id="hist-timeline" class="hist-timeline"><p class="vazio">Carregando histórico...</p></div>
  `;
  cont.querySelectorAll(".hist-aba").forEach(b=>{
    b.addEventListener("click", ()=>{
      cont.querySelectorAll(".hist-aba").forEach(x=>x.classList.remove("ativo"));
      b.classList.add("ativo");
      $("hist-texto").placeholder = b.dataset.tipo === "comunicacao"
        ? "Registre uma comunicação (e-mail, contato, ligação)... (@ menciona alguém)"
        : "Escreva uma nota interna... (@ menciona alguém)";
    });
  });
  $("hist-publicar").addEventListener("click", histPublicar);
  // lote S55: picker de menção
  const ta = $("hist-texto"), lista = $("hist-mencoes");
  ta.addEventListener("input", histAtualizarPicker);
  ta.addEventListener("click", histAtualizarPicker);
  ta.addEventListener("blur", () => setTimeout(histFecharPicker, 150));
  ta.addEventListener("keydown", (e) => {
    if(!lista || lista.style.display === "none") return;
    if(e.key === "ArrowDown"){ if(histPickerMover(1)) e.preventDefault(); }
    else if(e.key === "ArrowUp"){ if(histPickerMover(-1)) e.preventDefault(); }
    else if(e.key === "Enter" || e.key === "Tab"){ if(histPickerEscolherAtivo()) e.preventDefault(); }
    else if(e.key === "Escape"){ histFecharPicker(); e.preventDefault(); }
  });
  lista.addEventListener("mousedown", (e) => e.preventDefault());   // não tira o foco do textarea
  lista.addEventListener("click", (e) => {
    const el = e.target.closest(".resultado-item[data-id]");
    if(el) histEscolherMencao(el.dataset.id, el.dataset.nome);
  });
  await histCarregarTimeline();
  histMarcarMencoesLidas(entidade, registroId);
}

/* esconde o painel (registros novos ainda não têm id) */
function ocultarHistorico(containerId){
  const c = $(containerId);
  if(c){ c.style.display = "none"; c.innerHTML = ""; }
}

/* lote S55: menções do registro agrupadas por mensagem → [nomes]; vazio antes da migration */
async function histMencoesDoRegistro(entidade, registroId){
  const { data, error } = await sb.from("chatter_mencoes").select("mensagem_id,mencionado_id").eq("entidade", entidade).eq("registro_id", registroId);
  if(error || !data || !data.length) return {};
  const ids = [...new Set(data.map(m => m.mencionado_id))];
  const nomes = {};
  (_histUsuarios || []).forEach(p => { nomes[p.id] = p.nome; });
  const faltam = ids.filter(id => !nomes[id]);
  if(faltam.length){
    const { data: perfis } = await sb.from("profiles").select("id,nome").in("id", faltam);
    (perfis || []).forEach(p => { nomes[p.id] = p.nome; });
  }
  const porMsg = {};
  data.forEach(m => { if(nomes[m.mencionado_id]) (porMsg[m.mensagem_id] = porMsg[m.mensagem_id] || []).push(nomes[m.mencionado_id]); });
  return porMsg;
}

/* carrega e renderiza a linha do tempo */
async function histCarregarTimeline(){
  const { entidade, registroId } = _histCtx;
  const tl = $("hist-timeline");
  if(!tl) return;
  const [logR, msgR, mencoes] = await Promise.all([
    sb.from("registros_log").select("*")
      .eq("entidade",entidade).eq("registro_id",registroId),
    sb.from("registros_mensagens").select("*")
      .eq("entidade",entidade).eq("registro_id",registroId),
    histMencoesDoRegistro(entidade, registroId)
  ]);
  const eventos = [];
  (logR.data||[]).forEach(l => eventos.push({ kind:"log", ...l }));
  (msgR.data||[]).forEach(m => eventos.push({ kind:"msg", ...m }));
  eventos.sort((a,b)=> new Date(b.criado_em) - new Date(a.criado_em));

  if(!eventos.length){
    tl.innerHTML = `<p class="vazio">Nada registrado ainda. Alterações e mensagens aparecerão aqui.</p>`;
    return;
  }
  tl.innerHTML = eventos.map(ev=>{
    const autor  = esc(ev.autor_nome || "Sistema");
    const quando = histQuando(ev.criado_em);
    if(ev.kind === "msg"){
      const tag = ev.tipo === "comunicacao"
        ? '<span class="tag azul">Comunicação</span>'
        : '<span class="tag ambar">Nota interna</span>';
      // lote S55: o "@Nome" dos mencionados conhecidos vira tag; o texto já está escapado e a troca é por texto
      // literal (o nome escapado do mesmo jeito), nunca por regex solta no HTML
      let texto = esc(ev.texto).replace(/\n/g,"<br>");
      (mencoes[ev.id] || []).forEach(nome => {
        texto = texto.split(esc("@" + nome)).join(`<span class="tag azul">@${esc(nome)}</span>`);
      });
      return `<div class="hist-item hist-msg">
        <div class="hist-item-topo"><strong>${autor}</strong> ${tag}<span class="hist-quando">${esc(quando)}</span></div>
        <div class="hist-item-corpo">${/* html */ texto}</div>
      </div>`;
    }
    let corpo;
    if(ev.tipo === "criacao"){
      corpo = `<em>Cadastro criado.</em>`;
    } else {
      const de   = (ev.valor_anterior!=null && ev.valor_anterior!=="") ? esc(ev.valor_anterior) : "—";
      const para = (ev.valor_novo!=null && ev.valor_novo!=="") ? esc(ev.valor_novo) : "—";
      corpo = `<strong>${esc(histCampoLabel(ev.campo))}:</strong> ${de} <span class="hist-seta">&rarr;</span> ${para}`;
    }
    return `<div class="hist-item hist-log">
      <div class="hist-item-topo"><strong>${autor}</strong><span class="hist-quando">${esc(quando)}</span></div>
      <div class="hist-item-corpo">${/* html */ corpo}</div>
    </div>`;
  }).join("");
}

/* RPC ainda não existe no banco (migration do lote S55 não aplicada) */
const histRpcAusente = (err) => /PGRST202|42883|Could not find the function|schema cache/i.test(String(err?.message || "") + " " + String(err?.code || ""));

/* publica uma nota interna ou comunicação (lote S55: pela RPC chatter_publicar, com menções) */
async function histPublicar(){
  const campo = $("hist-texto");
  const txt = (campo.value||"").trim();
  if(!txt){ aviso("app-aviso","Escreva uma mensagem antes de publicar.","erro"); return; }
  const aba = document.querySelector(".hist-aba.ativo");
  const tipo = aba ? aba.dataset.tipo : "nota";
  const mencionados = histMencionadosNoTexto(txt);
  let { error } = await sb.rpc("chatter_publicar", {
    p_entidade: _histCtx.entidade, p_registro_id: _histCtx.registroId, p_tipo: tipo, p_texto: txt, p_mencionados: mencionados
  });
  if(error && histRpcAusente(error)){
    // app no ar antes da migration: insert direto de sempre, sem menção
    const u = await histUsuario();
    ({ error } = await sb.from("registros_mensagens").insert({
      entidade:    _histCtx.entidade,
      registro_id: _histCtx.registroId,
      tipo,
      texto:       txt,
      autor_id:    u.id,
      autor_nome:  u.nome
    }));
    if(!error && mencionados.length) aviso("app-aviso","Mensagem publicada. Menções entram depois da atualização do banco.","ok");
  }
  if(error){ aviso("app-aviso","Não foi possível publicar a mensagem: "+error.message,"erro"); return; }
  campo.value = "";
  _histMencoes = new Map();
  histFecharPicker();
  await histCarregarTimeline();
}

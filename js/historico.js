/* ====================================================================
   Módulo: Histórico de registros ("chatter", estilo Odoo)
   Mostra, na ficha de um cadastro, a linha do tempo de alterações
   automáticas + notas internas + comunicação, e permite publicar
   mensagens. Genérico: serve a qualquer entidade (clientes, etc.).
   ==================================================================== */

let _histCtx  = { entidade:null, registroId:null, containerId:null };
let _histUser = null;   /* { id, nome } do usuário logado (cache) */

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

/* monta o painel de histórico dentro de um container */
async function montarHistorico(entidade, registroId, containerId){
  _histCtx = { entidade, registroId, containerId };
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
      <textarea id="hist-texto" placeholder="Escreva uma nota interna..."></textarea>
      <div class="hist-compositor-acoes">
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
        ? "Registre uma comunicação (e-mail, contato, ligação)..."
        : "Escreva uma nota interna...";
    });
  });
  $("hist-publicar").addEventListener("click", histPublicar);
  await histCarregarTimeline();
}

/* esconde o painel (registros novos ainda não têm id) */
function ocultarHistorico(containerId){
  const c = $(containerId);
  if(c){ c.style.display = "none"; c.innerHTML = ""; }
}

/* carrega e renderiza a linha do tempo */
async function histCarregarTimeline(){
  const { entidade, registroId } = _histCtx;
  const tl = $("hist-timeline");
  if(!tl) return;
  const [logR, msgR] = await Promise.all([
    sb.from("registros_log").select("*")
      .eq("entidade",entidade).eq("registro_id",registroId),
    sb.from("registros_mensagens").select("*")
      .eq("entidade",entidade).eq("registro_id",registroId)
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
      return `<div class="hist-item hist-msg">
        <div class="hist-item-topo"><strong>${autor}</strong> ${tag}<span class="hist-quando">${quando}</span></div>
        <div class="hist-item-corpo">${esc(ev.texto).replace(/\n/g,"<br>")}</div>
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
      <div class="hist-item-topo"><strong>${autor}</strong><span class="hist-quando">${quando}</span></div>
      <div class="hist-item-corpo">${corpo}</div>
    </div>`;
  }).join("");
}

/* publica uma nota interna ou comunicação */
async function histPublicar(){
  const campo = $("hist-texto");
  const txt = (campo.value||"").trim();
  if(!txt){ aviso("app-aviso","Escreva uma mensagem antes de publicar.","erro"); return; }
  const aba = document.querySelector(".hist-aba.ativo");
  const tipo = aba ? aba.dataset.tipo : "nota";
  const u = await histUsuario();
  const { error } = await sb.from("registros_mensagens").insert({
    entidade:    _histCtx.entidade,
    registro_id: _histCtx.registroId,
    tipo,
    texto:       txt,
    autor_id:    u.id,
    autor_nome:  u.nome
  });
  if(error){ aviso("app-aviso","Não foi possível publicar a mensagem: "+error.message,"erro"); return; }
  campo.value = "";
  await histCarregarTimeline();
}

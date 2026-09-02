/* ====================================================================
   CGL Fundações — Sistema de Gestão
   core.js — cliente Supabase, helpers, autenticação e navegação.
   Carregado ANTES dos módulos. Não chama nada sozinho: a inicialização
   fica em init.js, executado por último.
   ==================================================================== */

/* ---------- Conexão Supabase ---------- */
const SUPABASE_URL = "https://xiirduialyewpqkwsfxx.supabase.co";
const SUPABASE_KEY = "sb_publishable_uef7GgPhtV5SSp-281PtNA_fD3ajHN4";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* Captura o hash da URL ANTES de o client consumi-lo: é ele que diz se
   o usuário chegou por um link de convite ou de recuperação de senha
   (#access_token=...&type=invite|recovery). Nesses casos o app abre um
   diálogo para definir a senha — sem isso, o convidado entrava uma vez
   e nunca mais conseguia logar. */
const _hashChegada = location.hash || "";
/* recovery/invite/signup abrem o diálogo de senha; magiclink também, porque
   é o que usamos quando o reset por e-mail está no limite */
const _chegouPorConvite = /type=(invite|recovery|signup|magiclink)/.test(_hashChegada);

/* Consome o token que vem no hash (#access_token=...&refresh_token=...) e
   estabelece a sessão explicitamente. Não dependemos do detectSessionInUrl
   do supabase-js, que em fluxo PKCE ignora tokens no hash — era por isso que
   o magic link chegava com token válido mas não logava. */
async function consumirTokenDoHash(){
  const h = new URLSearchParams(_hashChegada.replace(/^#/, ""));
  const access_token  = h.get("access_token");
  const refresh_token = h.get("refresh_token");
  if(access_token && refresh_token){
    try {
      await sb.auth.setSession({ access_token, refresh_token });
      /* limpa o token da barra de endereço (não deixa vazar em histórico) */
      history.replaceState(null, "", location.pathname + location.search);
    } catch(e){ /* token expirado: segue para a tela de login normal */ }
  }
}

/* ---------- Cache Global de Mapas ---------- */
let mapaClientes = {};
let mapaFornecedores = {};
let mapaObras = {};

/* ---------- Constantes ---------- */
const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const UNIDADES = ["un","pc","cx","kg","g","ton","m","m2","m3","l","ml","sc","par","rl","jg"];

/* Status de cada etapa do fluxo comercial: rótulo amigável + cor da tag */
const STATUS = {
  orcamento: {
    rascunho:      { label:"Rascunho",       cor:"cinza"    },
    enviado:       { label:"Enviado",        cor:"azul"     },
    em_negociacao: { label:"Em negociação",  cor:"ambar"    },
    aprovado:      { label:"Aprovado",       cor:"verde"    },
    rejeitado:     { label:"Rejeitado",      cor:"vermelho" },
    cancelado:     { label:"Cancelado",      cor:"vermelho" }
  },
  contrato: {
    em_elaboracao:         { label:"Em elaboração",        cor:"cinza"    },
    aguardando_assinatura: { label:"Aguardando assinatura", cor:"ambar"    },
    vigente:               { label:"Vigente",               cor:"verde"    },
    suspenso:              { label:"Suspenso",              cor:"ambar"    },
    vencido:               { label:"Vencido",               cor:"vermelho" },
    renovado:              { label:"Renovado",              cor:"azul"     },
    rescindido:            { label:"Rescindido",            cor:"vermelho" },
    encerrado:             { label:"Encerrado",             cor:"cinza"    },
    cancelado:             { label:"Cancelado",             cor:"vermelho" }
  },
  obra: {
    planejada:    { label:"Planejada",    cor:"cinza"    },
    em_andamento: { label:"Em andamento", cor:"azul"     },
    paralisada:   { label:"Paralisada",   cor:"ambar"    },
    concluida:    { label:"Concluída",    cor:"verde"    },
    cancelada:    { label:"Cancelada",    cor:"vermelho" }
  },
  medicao: {
    rascunho:  { label:"Rascunho",  cor:"cinza"    },
    enviada:   { label:"Enviada",   cor:"azul"     },
    aprovada:  { label:"Aprovada",  cor:"verde"    },
    faturada:  { label:"Faturada",  cor:"verde"    },
    rejeitada: { label:"Rejeitada", cor:"vermelho" }
  },
  rdo: {
    rascunho:   { label:"Rascunho",   cor:"cinza" },
    finalizado: { label:"Finalizado", cor:"verde" }
  },
  funcionario: {
    ativo:    { label:"Ativo",    cor:"verde"    },
    afastado: { label:"Afastado", cor:"ambar"    },
    ferias:   { label:"Férias",   cor:"azul"     },
    demitido: { label:"Demitido", cor:"vermelho" }
  }
};

/* Condições de tempo do RDO (manhã/tarde) */
const CONDICAO_TEMPO = {
  bom:          "Bom",
  nublado:      "Nublado",
  chuva_fraca:  "Chuva fraca",
  chuva_forte:  "Chuva forte",
  impraticavel: "Impraticável"
};

/* Categoria e recorrência dos contratos.
   A natureza (cliente/fornecedor) continua na tabela, mas deixou de ser
   escolhida na tela: o módulo Contratos é só de fornecedores e o contrato
   do cliente nasce na aba Contrato da obra (fase 21). */
const CONTRATO_CATEGORIA = {
  prestacao_servico: "Prestação de serviços",
  locacao:           "Locação",
  assinatura:        "Assinatura",
  seguro:            "Seguro",
  fornecimento:      "Fornecimento",
  empreitada:        "Empreitada",
  consultoria:       "Consultoria",
  outro:             "Outro"
};
const RECORRENCIA = {
  unica:      "Única",
  mensal:     "Mensal",
  trimestral: "Trimestral",
  semestral:  "Semestral",
  anual:      "Anual"
};
const INDICES_REAJUSTE = ["IPCA","IGP-M","INCC","IGP-DI","INPC","CDI"];

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const brl = (v) => Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const num = (v) => Number(v||0).toLocaleString("pt-BR",{maximumFractionDigits:3});

/* escapa texto antes de injetar em innerHTML (evita quebrar o HTML) */
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => (
    {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]
  ));
}

/* converte data ISO (yyyy-mm-dd) para dd/mm/aaaa */
function dataBR(d){
  if(!d) return "—";
  const p = String(d).slice(0,10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}

/* data de hoje em formato ISO (yyyy-mm-dd) no FUSO LOCAL, para preencher
   campos <input type=date> e gravar datas. NÃO usar toISOString(): ele é UTC
   e, no Brasil (UTC-3), das 21h às 00h devolve o dia seguinte — gravava RDO,
   medição e NF com a data de amanhã. */
function dataLocalISO(d){
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
}
function hojeISO(){ return dataLocalISO(new Date()); }
/* hoje ± n dias, em ISO local (n negativo = passado) */
function addDiasISO(n){
  const h = new Date();
  return dataLocalISO(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n));
}

/* mostra um aviso temporário (ok) ou fixo (erro) */
function aviso(elId, msg, tipo){
  const el = $(elId);
  el.textContent = msg;
  el.className = "aviso " + tipo;
  if(tipo === "ok") setTimeout(()=>{ el.className = "aviso"; }, 4000);
}

/* monta as <option> de um <select> a partir de uma lista de objetos */
function preencherSelect(sel, itens, valor, texto, placeholder){
  const ph = placeholder != null ? `<option value="">${esc(placeholder)}</option>` : "";
  sel.innerHTML = ph + itens.map(i =>
    `<option value="${esc(i[valor])}">${esc(i[texto])}</option>`
  ).join("");
}

/* devolve as <option> de um grupo de status (core STATUS) */
function opcoesStatus(grupo){
  return Object.entries(STATUS[grupo])
    .map(([v,o]) => `<option value="${v}">${esc(o.label)}</option>`).join("");
}

/* devolve a tag colorida de um status */
function tagStatus(grupo, valor){
  const o = (STATUS[grupo] || {})[valor];
  if(!o) return `<span class="tag cinza">${esc(valor||"—")}</span>`;
  return `<span class="tag ${o.cor}">${esc(o.label)}</span>`;
}

/* devolve as <option> de um objeto simples { valor: "Rótulo" } */
function opcoesDe(obj){
  return Object.entries(obj)
    .map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
}

/* ---------- Selects fixos ---------- */
function montarSelects(){
  $("cli-uf").innerHTML = '<option value="">—</option>' +
    UFS.map(u=>`<option value="${u.toLowerCase()}">${u}</option>`).join("");
  $("obr-uf").innerHTML = '<option value="">—</option>' +
    UFS.map(u=>`<option value="${u.toLowerCase()}">${u}</option>`).join("");
  $("forn-uf").innerHTML = '<option value="">—</option>' +
    UFS.map(u=>`<option value="${u.toLowerCase()}">${u}</option>`).join("");
  ["mov-origem-uf","mov-destino-uf"].forEach(id => {
    const el = $(id);
    if(el) el.innerHTML = '<option value="">—</option>' +
      UFS.map(u=>`<option value="${u.toLowerCase()}">${u}</option>`).join("");
  });
  $("prod-unidade").innerHTML = UNIDADES.map(u=>`<option value="${u}">${u}</option>`).join("");
  $("orc-status").innerHTML = opcoesStatus("orcamento");
  $("con-status").innerHTML = opcoesStatus("contrato");
  $("obr-status").innerHTML = opcoesStatus("obra");
  $("med-status").innerHTML = opcoesStatus("medicao");
  $("con-categoria").innerHTML = opcoesDe(CONTRATO_CATEGORIA);
  $("con-recorrencia").innerHTML = opcoesDe(RECORRENCIA);
  $("lista-indices").innerHTML = INDICES_REAJUSTE.map(i=>`<option value="${i}">`).join("");
  /* aba Contrato da ficha da obra (contrato do cliente — fase 21) */
  $("obr-con-categoria").innerHTML = opcoesDe(CONTRATO_CATEGORIA);
  $("obr-con-status").innerHTML = opcoesStatus("contrato");
}

/* ---------- Carga de Selects Comuns ---------- */
/* clientes -> selects de orçamento e obra */
async function carregarClientesSelects(){
  const { data } = await sb.from("clientes").select("id,nome").order("nome");
  const lista = data || [];
  mapaClientes = {};
  lista.forEach(c => mapaClientes[c.id] = c.nome);
  ["orc-cliente","obr-cliente"].forEach(id=>{
    const el = $(id);
    if(el) preencherSelect(el, lista, "id", "nome", "— selecione —");
  });
}

/* fornecedores ativos -> select de contrato */
async function carregarFornecedoresSelects(){
  const { data } = await sb.from("fornecedores")
    .select("id,razao_social").eq("ativo",true).order("razao_social");
  const lista = data || [];
  mapaFornecedores = {};
  lista.forEach(f => mapaFornecedores[f.id] = f.razao_social);
  const el = $("con-fornecedor");
  if(el) preencherSelect(el, lista, "id", "razao_social", "— selecione —");
}

/* profiles ativos -> selects de responsável */
async function carregarResponsaveis(){
  const { data } = await sb.from("profiles").select("id,nome").eq("ativo",true).order("nome");
  const lista = data || [];
  ["orc-responsavel","obr-responsavel","con-responsavel"].forEach(id=>{
    const el = $(id);
    if(el) preencherSelect(el, lista, "id", "nome", "— não informado —");
  });
}

/* ---------- Sugestão de numeração sequencial ---------- */
function sugerirNumeros(){
  const proximo = (tbId, prefixo) => {
    const el = $(tbId);
    if(!el) return prefixo + "0001";
    const linhas = el.querySelectorAll("tr").length;
    /* ignora a linha de "nenhum registro" */
    const temDados = el.querySelector(".vazio") ? 0 : linhas;
    return prefixo + String(temDados + 1).padStart(4,"0");
  };
  const orcNum = $("orc-numero");
  if(orcNum && !orcNum.value) orcNum.value = proximo("tab-orcamentos","ORC-");
  /* con-numero é sugerido pelo próprio módulo (proximoNumeroContrato).
     obr-codigo NÃO é sugerido: o <tbody> #tab-obras é sempre esvaziado pelo
     render, então a contagem dava "OB-0001" (já existente → erro de UNIQUE).
     O código da obra segue o padrão da CGL (ex.: 7822-2025) e é digitado. */
}

/* Executa fn() com o botão desabilitado até terminar — evita clique duplo em
   Salvar (que duplicava execuções de RDO, entradas de estoque e movimentações).
   Aceita o id do botão ou o elemento. Reentrância é ignorada. */
async function comBotaoTravado(btnOuId, fn){
  const b = typeof btnOuId === "string" ? $(btnOuId) : btnOuId;
  if(b){
    if(b.dataset.travado) return;
    b.dataset.travado = "1";
    b.disabled = true;
  }
  try { return await fn(); }
  finally { if(b){ delete b.dataset.travado; b.disabled = false; } }
}


/* ====================== AUTENTICAÇÃO ====================== */
$("form-login").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const btn = $("btn-entrar");
  btn.disabled = true; btn.textContent = "Entrando...";
  const { error } = await sb.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-senha").value
  });
  btn.disabled = false; btn.textContent = "Entrar";
  if(error){
    const m = (error.message||"").toLowerCase();
    if(m.includes("invalid login")) aviso("login-aviso","E-mail ou senha inválidos.","erro");
    else aviso("login-aviso","Falha no login: "+(error.message||"erro desconhecido"),"erro");
    return;
  }
  // Verifica se é necessário step MFA (usuário já tem TOTP cadastrado)
  const { data: aalData } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if(aalData?.nextLevel === "aal2" && aalData?.currentLevel !== "aal2"){
    mostrarDesafioMFALogin();
    return;
  }
  iniciarApp();
});

/* ---------- Esqueci minha senha ----------
   Envia o link de redefinição; o retorno chega com #type=recovery e o
   modal "Defina sua senha" (fase 24) cuida do resto. O e-mail sai pelo
   serviço embutido do Supabase (limite de poucos envios/hora), por isso
   o botão trava por 60s após cada envio. */
$("btn-esqueci-senha")?.addEventListener("click", async ()=>{
  const email = $("login-email").value.trim().toLowerCase();
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    aviso("login-aviso","Digite seu e-mail no campo acima e clique de novo em \"Esqueci minha senha\".","erro");
    $("login-email").focus();
    return;
  }
  const btn = $("btn-esqueci-senha");
  btn.disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.protocol.startsWith("http")
      ? location.origin + location.pathname
      : undefined
  });
  if(error){
    btn.disabled = false;
    const m = (error.message||"").toLowerCase();
    aviso("login-aviso", m.includes("rate") || m.includes("seconds")
      ? "Muitas tentativas — aguarde um minuto e tente de novo."
      : "Não foi possível enviar: " + error.message, "erro");
    return;
  }
  aviso("login-aviso",`📧 Enviamos um link de redefinição para ${email}. Abra o e-mail (confira o spam) e clique no link — você voltará aqui direto na tela de nova senha.`,"ok");
  setTimeout(()=>{ btn.disabled = false; }, 60000);
});

$("btn-ver-senha").addEventListener("click", ()=>{
  const inp = $("login-senha");
  const oculto = inp.type === "password";
  inp.type = oculto ? "text" : "password";
  $("btn-ver-senha").textContent = oculto ? "ocultar" : "mostrar";
});

$("btn-sair").addEventListener("click", async ()=>{
  await sb.auth.signOut();
  location.reload();
});

/* perfil do usuário logado — preenchido em iniciarApp() */
let usuarioAtual = null;

async function iniciarApp(){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user) return;
  const { data:perfil } = await sb.from("profiles")
    .select("id,nome,cargo,ativo").eq("id",user.id).single();

  /* bloqueia acesso de usuários desativados */
  if(perfil && perfil.ativo === false){
    await sb.auth.signOut();
    aviso("login-aviso","Seu acesso foi desativado. Procure um administrador.","erro");
    return;
  }

  usuarioAtual = perfil || { id:user.id, nome:user.email, cargo:null, ativo:true };
  const nome = perfil ? (perfil.nome + " · " + perfil.cargo) : user.email;
  $("usr-nome").textContent = nome;

  /* Cargos de gestão: diretor tem acesso total (has_role() no banco
     também devolve true para ele em qualquer verificação) */
  const ehDiretorOuAdmin = perfil && ["diretor","admin"].includes(perfil.cargo);

  /* item "Usuários" só aparece para diretor/admin */
  const navUsr = $("nav-usuarios");
  if(navUsr) navUsr.style.display = ehDiretorOuAdmin ? "" : "none";

  /* "Carteira" (controle de contratos & pendências): só diretoria.
     As pendências que interessam à engenharia aparecem dentro da ficha
     da Obra (aba Contrato) e como badge na lista de obras. */
  const navCart = $("nav-carteira");
  if(navCart) navCart.style.display =
    (perfil && ["diretor","admin"].includes(perfil.cargo)) ? "" : "none";

  $("tela-login").style.display = "none";
  $("tela-app").style.display = "flex";

  /* P0 — alertar diretor/admin sem MFA configurado */
  if(ehDiretorOuAdmin) verificarMFAAdmin();

  /* Chegou por link de convite ou recuperação: definir a senha agora */
  if(_chegouPorConvite) abrirDefinirSenha();

  await carregarTudo();
}

/* ---------- Definição de senha (convite / recuperação) ---------- */
function abrirDefinirSenha(){
  const m = $("senha-modal");
  if(m) m.style.display = "flex";
}

$("btn-senha-salvar")?.addEventListener("click", async ()=>{
  const s1 = $("senha-nova").value;
  const s2 = $("senha-confirma").value;
  if(s1.length < 8){ aviso("senha-modal-aviso","A senha precisa de pelo menos 8 caracteres.","erro"); return; }
  if(s1 !== s2){ aviso("senha-modal-aviso","As senhas não conferem.","erro"); return; }
  const btn = $("btn-senha-salvar");
  btn.disabled = true; btn.textContent = "Salvando...";
  const { error } = await sb.auth.updateUser({ password: s1 });
  btn.disabled = false; btn.textContent = "Salvar senha";
  if(error){
    aviso("senha-modal-aviso","Não foi possível salvar: "+(error.message||"erro"),"erro");
    return;
  }
  $("senha-modal").style.display = "none";
  aviso("app-aviso","🔐 Senha definida. Use-a nos próximos acessos.","ok");
});

/* ====================== NAVEGAÇÃO ====================== */
// Controle do menu lateral (sidebar) no mobile
const toggleBtn = $("btn-menu-toggle");
const closeBtn = $("btn-menu-close");
const overlay = $("sidebar-overlay");
const telaApp = $("tela-app");

function closeSidebar() {
  if (telaApp) telaApp.classList.remove("sidebar-aberta");
}

if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    if (telaApp) telaApp.classList.add("sidebar-aberta");
  });
}
if (closeBtn) {
  closeBtn.addEventListener("click", closeSidebar);
}
if (overlay) {
  overlay.addEventListener("click", closeSidebar);
}

// Navegação entre seções
document.querySelectorAll(".sidebar-nav button").forEach(b=>{
  b.addEventListener("click", ()=>{
    document.querySelectorAll(".sidebar-nav button").forEach(x=>x.classList.remove("ativo"));
    b.classList.add("ativo");
    document.querySelectorAll(".secao").forEach(s=>s.classList.remove("ativa"));
    
    const secId = "sec-" + b.dataset.secao;
    const secEl = $(secId);
    if(secEl) secEl.classList.add("ativa");
    
    // Atualiza o título no cabeçalho
    const spanText = b.querySelector("span");
    if(spanText && $("app-secao-titulo")) {
      $("app-secao-titulo").textContent = spanText.textContent;
    }
    
    closeSidebar();
  });
});

/* Navega para uma seção via o botão da nav (reusa o handler acima, que
   ativa a seção e o título). Usado pelos atalhos clicáveis do dashboard. */
function irParaSecao(secao){
  const b = document.querySelector(`.sidebar-nav button[data-secao="${secao}"]`);
  if(b){ b.click(); return true; }
  return false;
}

/* ====================== CARGA GERAL ====================== */
async function carregarTudo(){
  // 1. Carrega cadastros base
  await Promise.all([
    carregarClientes(),
    carregarCategorias(),
    carregarFornecedores(),
    carregarListaFornecedores()
  ]);
  // 2. Carrega produtos (depende das categorias)
  await carregarProdutos();
  
  // 3. Preenche selects comuns e inicializa mapas globais
  await Promise.all([
    carregarClientesSelects(),
    carregarFornecedoresSelects(),
    carregarResponsaveis()
  ]);
  
  // 4. Carrega os módulos comerciais separados
  await Promise.all([
    carregarOrcamentos(),
    carregarContratos(),
    carregarObras(),
    carregarMedicoes()
  ]);

  // 5. Módulos operacionais (dependem de obras carregadas)
  if(typeof carregarFuncionarios === "function") await carregarFuncionarios();
  if(typeof carregarRDO === "function") await carregarRDO();
  if(typeof carregarMovimentacoes === "function") await carregarMovimentacoes();

  // 6. Usuários (só admin)
  if(usuarioAtual && ["diretor","admin"].includes(usuarioAtual.cargo) && typeof carregarUsuarios === "function"){
    await carregarUsuarios();
  }

  // 7. Atualiza dashboard e sugestões sequenciais
  await carregarDashboard();
  sugerirNumeros();
}

/* ============================================================
   DRAG & DROP em kanbans (genérico — todos os módulos)
   Uso:
     habilitarDragKanban({
       container: "#med-conteudo .serv-kanban",   // selector do wrapper
       tabela: "medicoes",                          // tabela do banco
       coluna: "status",                            // coluna de status
       onUpdate: (id, novoStatus) => { ... },      // opcional, recarrega
       confirmar: true                              // pede confirmação antes de salvar
     });
   ============================================================ */
function habilitarDragKanban(opts){
  const cont = typeof opts.container === "string" ? document.querySelector(opts.container) : opts.container;
  if(!cont) return;
  const tabela = opts.tabela;
  const coluna = opts.coluna || "status";
  if(!tabela) return;

  const cards = cont.querySelectorAll(".serv-kan-card[data-id]");
  cards.forEach(card => {
    card.draggable = true;
    card.style.cursor = "grab";
    card.addEventListener("dragstart", (e) => {
      card.classList.add("kan-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", JSON.stringify({
        id: card.dataset.id,
        origemStatus: card.closest(".serv-kan-col")?.dataset.status || ""
      }));
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("kan-dragging");
      cont.querySelectorAll(".serv-kan-col").forEach(c => c.classList.remove("kan-drop-target"));
    });
  });

  const colunas = cont.querySelectorAll(".serv-kan-col[data-status]");
  colunas.forEach(col => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("kan-drop-target");
    });
    col.addEventListener("dragleave", () => col.classList.remove("kan-drop-target"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("kan-drop-target");
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); } catch(err){ return; }
      const id = payload.id;
      const novoStatus = col.dataset.status;
      const origem = payload.origemStatus;
      if(!id || !novoStatus || novoStatus === origem) return;

      if(opts.confirmar){
        if(!confirm(`Mover este card para "${novoStatus}"?`)) return;
      }
      // Atualiza no banco
      const { error } = await sb.from(tabela).update({ [coluna]: novoStatus, updated_at: new Date().toISOString() }).eq("id", id);
      if(error){
        aviso("app-aviso", `Não foi possível mover: ${error.message}`, "erro");
        return;
      }
      aviso("app-aviso", `✅ Movido para "${novoStatus}"`, "ok");
      if(typeof opts.onUpdate === "function"){
        await opts.onUpdate(id, novoStatus, origem);
      }
    });
  });
}

/* ====================== SEGURANÇA — MFA ====================== */
async function verificarMFAAdmin(){
  try {
    const { data, error } = await sb.auth.mfa.listFactors();
    if(error) return;
    const temTOTP = (data?.totp || []).some(f => f.status === "verified");
    if(temTOTP) return;

    document.getElementById("mfa-aviso-banner")?.remove();
    const banner = document.createElement("div");
    banner.id = "mfa-aviso-banner";
    banner.innerHTML = `
      <div style="
        position:fixed; top:0; left:0; right:0; z-index:9999;
        background:#7a2a1a; color:var(--txt-sobre); font-size:13px;
        padding:10px 16px; display:flex; align-items:center; gap:12px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
      ">
        <strong>⚠ Segurança:</strong>
        Sua conta de administrador não tem autenticação em dois fatores (MFA) configurada.
        <button onclick="abrirModalMFA()" style="
          background:rgba(255,255,255,0.25); border:1px solid rgba(255,255,255,0.5);
          color:var(--txt-sobre); padding:4px 14px; cursor:pointer; border-radius:3px;
          font-size:12px; font-weight:600; white-space:nowrap;
        ">Configurar agora</button>
        <button onclick="document.getElementById('mfa-aviso-banner').remove()" style="
          background:rgba(255,255,255,0.15); border:none;
          color:var(--txt-sobre); padding:4px 10px; cursor:pointer; border-radius:2px;
          font-size:12px; white-space:nowrap;
        ">Fechar</button>
      </div>`;
    document.body.prepend(banner);
  } catch(_){}
}

/* ====================== MFA — DESAFIO NO LOGIN ====================== */
function mostrarDesafioMFALogin(){
  $("form-login").style.display = "none";
  $("mfa-desafio").style.display = "";
  $("mfa-desafio-codigo").value = "";
  $("mfa-desafio-codigo").focus();
}

async function confirmarDesafioMFALogin(){
  const code = ($("mfa-desafio-codigo")?.value || "").trim();
  if(!/^\d{6}$/.test(code)){
    aviso("mfa-desafio-aviso","Digite os 6 dígitos exibidos no app autenticador.","erro");
    return;
  }
  const btn = $("btn-mfa-desafio-ok");
  btn.disabled = true;
  btn.textContent = "Verificando...";
  try {
    const { data: fatores } = await sb.auth.mfa.listFactors();
    const totp = (fatores?.totp || []).find(f => f.status === "verified");
    if(!totp) throw new Error("Nenhum fator TOTP ativo encontrado.");
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
    if(error) throw error;
    $("mfa-desafio").style.display = "none";
    $("form-login").style.display = "";
    await iniciarApp();
  } catch(err){
    aviso("mfa-desafio-aviso", err.message || "Código inválido. Tente novamente.","erro");
    btn.disabled = false;
    btn.textContent = "Confirmar";
  }
}

/* ====================== MFA — ENROLAMENTO (admin) ====================== */
let _mfaFactorId = null;

async function abrirModalMFA(){
  const modal = $("modal-mfa");
  if(!modal) return;
  modal.style.display = "flex";
  const qrArea = $("mfa-qr-area");
  qrArea.innerHTML = '<p style="font-size:13px;color:var(--txt-sutil);">Gerando QR code…</p>';
  $("mfa-modal-aviso").textContent = "";
  $("mfa-codigo-input").value = "";
  $("mfa-secret-area").style.display = "none";
  _mfaFactorId = null;
  try {
    // Remove fatores não verificados anteriores para poder re-enrolar
    const { data: fatores } = await sb.auth.mfa.listFactors();
    for(const f of (fatores?.totp || []).filter(f => f.status !== "verified")){
      await sb.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", issuer: "CGL Fundações" });
    if(error) throw error;
    _mfaFactorId = data.id;
    const qr = data.totp.qr_code;
    if(qr && qr.startsWith("<svg")){
      qrArea.innerHTML = `<div style="display:inline-block;padding:12px;background:var(--sup-0);
        border:1px solid var(--borda);border-radius:6px;">${qr}</div>`;
    } else {
      qrArea.innerHTML = `<img src="${qr}" alt="QR Code MFA"
        style="width:200px;height:200px;border:1px solid var(--borda);padding:8px;border-radius:6px;" />`;
    }
    $("mfa-secret-text").textContent = data.totp.secret;
  } catch(err){
    qrArea.innerHTML = `<p style="color:red;font-size:13px;">Erro: ${esc(err.message)}</p>`;
  }
}

async function verificarCodigoMFA(){
  if(!_mfaFactorId){
    aviso("mfa-modal-aviso","Reinicie o processo clicando em 'Configurar agora'.","erro");
    return;
  }
  const code = ($("mfa-codigo-input")?.value || "").trim();
  if(!/^\d{6}$/.test(code)){
    aviso("mfa-modal-aviso","Insira os 6 dígitos do app autenticador.","erro");
    return;
  }
  const btn = $("btn-mfa-verificar");
  btn.disabled = true;
  btn.textContent = "Verificando…";
  try {
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: _mfaFactorId, code });
    if(error) throw error;
    $("modal-mfa").style.display = "none";
    $("mfa-aviso-banner")?.remove();
    aviso("app-aviso","✅ MFA ativado! Sua conta agora está protegida com dois fatores.","ok");
    _mfaFactorId = null;
  } catch(err){
    aviso("mfa-modal-aviso", err.message || "Código inválido. Tente novamente.","erro");
    btn.disabled = false;
    btn.textContent = "✅ Verificar e ativar";
  }
}

/* — Wiring dos eventos MFA — */
$("btn-mfa-desafio-ok")?.addEventListener("click", confirmarDesafioMFALogin);
$("btn-mfa-desafio-cancelar")?.addEventListener("click", async () => {
  await sb.auth.signOut();
  $("mfa-desafio").style.display = "none";
  $("form-login").style.display = "";
  $("mfa-desafio-codigo").value = "";
});
$("mfa-desafio-codigo")?.addEventListener("keydown", e => {
  if(e.key === "Enter") confirmarDesafioMFALogin();
});

$("btn-mfa-verificar")?.addEventListener("click", verificarCodigoMFA);
$("btn-mfa-cancelar")?.addEventListener("click", () => {
  $("modal-mfa").style.display = "none";
  _mfaFactorId = null;
});
$("btn-mfa-mostrar-codigo")?.addEventListener("click", () => {
  const area = $("mfa-secret-area");
  area.style.display = area.style.display === "none" ? "" : "none";
});
$("mfa-codigo-input")?.addEventListener("keydown", e => {
  if(e.key === "Enter") verificarCodigoMFA();
});

/* ====================================================================
   CGL Fundações — Sistema de Gestão
   core.js — cliente Supabase, helpers, autenticação e navegação.
   Carregado ANTES dos módulos. Não chama nada sozinho: a inicialização
   fica em init.js, executado por último.
   ==================================================================== */

/* ---------- Conexão Supabase ---------- */
const SUPABASE_URL = "https://xiirduialyewpqkwsfxx.supabase.co";
const SUPABASE_KEY = "sb_publishable_uef7GgPhtV5SSp-281PtNA_fD3ajHN4";

/* Fase 87 (política de sessão, decisão do Bernardo em 16/10/2026): a sessão do Supabase vive no
   sessionStorage, então vale só para a janela aberta (fechou o navegador, saiu). Com "Manter conectado
   neste computador" marcado no login ela vai para o localStorage pelo prazo de
   empresa_config.sessao_lembrar_dias (flag cgl_lembrar, com validade). Sessão antiga deixada no
   localStorage sem a flag (anterior a esta fase) é apagada na primeira carga: todo mundo entra de novo
   uma vez. Storage bloqueado (navegação privada) nunca derruba o app. */
const SESSAO_LEMBRAR_CHAVE = "cgl_lembrar";
function lembrarLer(){
  try {
    const r = JSON.parse(localStorage.getItem(SESSAO_LEMBRAR_CHAVE) || "null");
    if(r && r.ate && Date.now() < r.ate) return r;
    if(r) localStorage.removeItem(SESSAO_LEMBRAR_CHAVE);   // venceu
  } catch(_){}
  return null;
}
function lembrarAtivo(){ return !!lembrarLer(); }
function lembrarGravar(dias, desde){
  try {
    const d = Number(dias) > 0 ? Number(dias) : 7;
    const ini = desde || Date.now();
    localStorage.setItem(SESSAO_LEMBRAR_CHAVE, JSON.stringify({ desde: ini, ate: ini + d * 86400000 }));
  } catch(_){}
}
function lembrarApagar(){ try { localStorage.removeItem(SESSAO_LEMBRAR_CHAVE); } catch(_){} }
const sessaoStorage = {
  getItem(k){
    try {
      if(lembrarAtivo()) return localStorage.getItem(k);
      if(localStorage.getItem(k) != null) localStorage.removeItem(k);   // sessão antiga sem "manter conectado": encerra uma vez
      return sessionStorage.getItem(k);
    } catch(_){ return null; }
  },
  setItem(k, v){ try { (lembrarAtivo() ? localStorage : sessionStorage).setItem(k, v); } catch(_){} },
  removeItem(k){ try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch(_){} }
};
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storage: sessaoStorage } });

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
const UNIDADES = ["un","pc","cx","kg","g","ton","m","m2","m3","l","ml","sc","par","rl","jg","vb","diária","mês","h"]; // vb/diária/mês: fase 40 (proposta RG 11.8); h: lote S45 (L8), migration 20261020_loteS45_unidade_h

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
    recebida:  { label:"Recebida",  cor:"verde"    },   // fase 91: recebimentos confirmados atingiram o líquido (gatilho)
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
  },
  /* Acessórios (fase 47): condição da peça e onde ela está */
  equipamento: {
    disponivel:     { label:"Disponível",     cor:"verde"    },
    em_uso:         { label:"Em uso",         cor:"azul"     },
    em_manutencao:  { label:"Em manutenção",  cor:"ambar"    },
    inativo:        { label:"Inativo",        cor:"cinza"    },
    vendido:        { label:"Vendido",        cor:"cinza"    }   // fase 96: nasce do registro da venda (js/vendas_bens.js)
  },
  acessorio: {
    sem_avaliacao:      { label:"Sem avaliação",      cor:"cinza"    },
    sem_marcacao:       { label:"Sem marcação",       cor:"ambar"    },
    bom_estado:         { label:"Bom estado",         cor:"verde"    },
    precisa_manutencao: { label:"Precisa manutenção", cor:"ambar"    },
    em_manutencao:      { label:"Em manutenção",      cor:"azul"     },
    sucata:             { label:"Sucata",             cor:"vermelho" },
    baixado:            { label:"Baixado",            cor:"vermelho" }
  },
  acessorio_local: {
    patio:        { label:"Pátio",          cor:"verde"    },
    oficina:      { label:"Oficina",        cor:"azul"     },
    fornecedor:   { label:"Fornecedor",     cor:"azul"     },
    equipamento:  { label:"No equipamento", cor:"verde"    },
    obra:         { label:"Em obra",        cor:"azul"     },
    em_transito:  { label:"Em trânsito",    cor:"ambar"    },
    perdido:      { label:"Perdido",        cor:"vermelho" },
    desconhecido: { label:"Não localizado", cor:"cinza"    }
  },
  /* Logística (fase 89): viagem de caminhão */
  viagem: {
    planejada:   { label:"Planejada",   cor:"cinza"    },
    em_transito: { label:"Em trânsito", cor:"ambar"    },
    concluida:   { label:"Concluída",   cor:"verde"    },
    cancelada:   { label:"Cancelada",   cor:"vermelho" }
  },
  // fase 105b: NF-e de remessa/retorno emitida pelo app (movimentacoes_ativos.nf_status, gravado pela Focus NFe)
  nfe: {
    rascunho:    { label:"NF-e rascunho",    cor:"cinza"    },
    processando: { label:"NF-e processando", cor:"azul"     },
    autorizada:  { label:"NF-e autorizada",  cor:"verde"    },
    rejeitada:   { label:"NF-e rejeitada",   cor:"vermelho" },
    cancelada:   { label:"NF-e cancelada",   cor:"vermelho" },
    denegada:    { label:"NF-e denegada",    cor:"vermelho" },
    inutilizada: { label:"NF-e inutilizada", cor:"cinza"    }
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
  // fase 79: o usuário de revisão (auditor) é barrado pela RLS em toda gravação; a mensagem diz isso em vez do erro técnico
  if(tipo === "erro" && typeof ehSomenteLeitura === "function" && ehSomenteLeitura()
     && /row-level security|permission denied|42501|sem permiss|não foi possível (salvar|gravar|abrir|mudar|excluir)/i.test(String(msg || "")))
    msg = "Usuário de revisão não grava.";
  el.textContent = msg;
  el.className = "aviso " + (tipo === "aviso" ? "atencao" : tipo);
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

/* Situação ativo/inativo — UMA semântica para Clientes, Fornecedores e
   Usuários (antes: cinza numa tela, vermelho noutra, e "ativo" nem aparecia).
   O glifo (●/○) é redundância à cor, para daltônicos. */
function tagSituacao(ativo){
  return ativo === false
    ? `<span class="tag cinza" title="Inativo">○ inativo</span>`
    : `<span class="tag verde" title="Ativo">● ativo</span>`;
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

/* profiles ativos -> selects de responsável. O da obra (fase 75) lista só a engenharia:
   é o engenheiro que o gestor do serviço indica e que recebe o "Para regularizar" da obra. */
const CARGOS_RESP_OBRA = ["engenheiro", "assistente_engenharia", "diretor"];
async function carregarResponsaveis(){
  const { data } = await sb.from("profiles").select("id,nome,cargo").eq("ativo",true).order("nome");
  const lista = data || [];
  ["orc-responsavel","con-responsavel"].forEach(id=>{
    const el = $(id);
    if(el) preencherSelect(el, lista, "id", "nome", "— não informado —");
  });
  const obr = $("obr-responsavel");
  if(obr) preencherSelect(obr, lista.filter(p => CARGOS_RESP_OBRA.includes(p.cargo)), "id", "nome", "— não informado —");
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
/* Fase 86: só um salvar que passou libera a atualização do app (limpa a marca de formulário sujo):
   botão de gravação (id ou texto), fn resolvida sem exceção e nenhum aviso de erro visível depois dela
   (validação que avisa e retorna). Gerar PDF, importar, exportar e buscar nunca limpam. */
const BOTAO_GRAVACAO_RE = /salvar|gravar|confirmar|aprovar|concluir|enviar|registrar|lan[cç]ar|marcar|baixa|receber|entregar/i;
async function comBotaoTravado(btnOuId, fn){
  const b = typeof btnOuId === "string" ? $(btnOuId) : btnOuId;
  if(b){
    if(b.dataset.travado) return;
    b.dataset.travado = "1";
    b.disabled = true;
  }
  let passou = false;
  try { const r = await fn(); passou = true; return r; }
  finally {
    if(b){ delete b.dataset.travado; b.disabled = false; }
    if(passou && b && BOTAO_GRAVACAO_RE.test((b.id || "") + " " + (b.textContent || "")) && !appAvisoComErro()) appLimparSujo();
  }
}

/* Leitura por IA (edge function) com limite de tempo no cliente (lote S39, chamados #28 #20 #21).
   A function morre por tempo sem devolver nada em PDF grande; sem o limite o modal ficava parado. */
const IA_LIMITE_MS = 150000;
/* lote S48 (#128): limiteMs opcional — a leitura de RDO (extrair-rdo-arquivo v3.6, até 32.000 tokens de saída) espera mais */
function iaInvocarComLimite(nome, body, msgTempo, limiteMs){
  let t = null;
  const tempo = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(msgTempo || "A leitura demorou demais. Exporte só as páginas do quadro de estacas e tente de novo.")), limiteMs || IA_LIMITE_MS);
  });
  return Promise.race([sb.functions.invoke(nome, { body }), tempo]).finally(() => clearTimeout(t));
}

/* ====================== IDENTIDADE VISUAL DOS PDFs (lote S41, chamado #36) ======================
   Um ponto só para logo e selo ISO 9001 nos três geradores (proposta, medição, pedido de compra).
   Estilo inline com hex: o PDF é renderizado fora do CSS do app (exceção permitida para PDF).
   - pdfCabecalhoHTML(titulo, subtitulo): logo oficial (18 mm) e, se houver, título ao lado.
   - pdfRodapeHTML(): rodapé com o selo para a pré-visualização em HTML e a impressão.
   - pdfGerar(elemento, opcoes): html2pdf com margem para o rodapé, sem cortar linha
     (tr, p, li, .nao-quebrar) e com selo + "CGL Fundações · Empresa certificada ISO 9001"
     carimbados pelo jsPDF em TODA página (html2pdf fatia uma imagem só; rodapé em HTML
     sairia só na última página). */
const PDF_LOGO_SRC = "img/logo-cgl.png";
const PDF_SELO_SRC = "img/selo-iso9001.png";
const PDF_RODAPE_TEXTO = "CGL Fundações · Empresa certificada ISO 9001";
const PDF_SELO_MM = 16;
const PDF_BASE_MIN_MM = 25;   // espaço no pé da página para o selo e o texto
const PX_POR_MM = 96 / 25.4;

/* Margens [topo, esquerda, base, direita] em mm para uma largura útil pedida.
   O html2pdf 0.10.1 empurra a linha para a página seguinte usando floor(altura em px) e fatia o
   canvas com floor(largura do canvas × altura/largura): com medidas quebradas as duas contas
   divergem ~1,5 px por página e a borda da linha empurrada aparecia no pé da página anterior,
   crescendo a cada página. Largura e altura úteis em px inteiros (+0,04 px de folga contra o
   arredondamento) e o canvas com largura fixa fazem as duas contas darem o mesmo número. */
function pdfMargens(larguraMm, topoMm){
  const largPx = Math.round(larguraMm * PX_POR_MM);
  const altPx  = Math.floor((297 - topoMm - PDF_BASE_MIN_MM) * PX_POR_MM);
  const larg = largPx / PX_POR_MM;
  const alt  = (altPx + 0.04) / PX_POR_MM;
  const lado = (210 - larg) / 2;
  return { margem: [topoMm, lado, 297 - topoMm - alt, lado], largPx };
}

/* URL absoluta: a pré-visualização abre em about:blank e não resolveria caminho relativo */
function pdfUrl(caminho){ return new URL(caminho, document.baseURI).href; }

function pdfCabecalhoHTML(titulo = "", subtitulo = ""){
  const logo = `<img src="${pdfUrl(PDF_LOGO_SRC)}" alt="CGL Fundações" style="display:block;height:18mm;width:18mm;">`;
  if(!titulo && !subtitulo) return logo;
  return `<div style="display:flex;align-items:center;justify-content:center;gap:4mm;">${logo}<div style="text-align:left;">
    ${titulo ? `<div style="font-size:14px;font-weight:700;color:#111;">${esc(titulo)}</div>` : ""}
    ${subtitulo ? `<div style="font-size:10px;color:#444;margin-top:2px;">${esc(subtitulo)}</div>` : ""}
  </div></div>`;
}

function pdfRodapeHTML(){
  return `<div class="pdf-rodape" style="display:flex;align-items:center;justify-content:space-between;gap:4mm;margin-top:6mm;padding-top:2mm;border-top:1px solid #b4b4b4;font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#555;">
    <span>${esc(PDF_RODAPE_TEXTO)}</span>
    <img src="${pdfUrl(PDF_SELO_SRC)}" alt="Selo ISO 9001" style="display:block;height:${PDF_SELO_MM}mm;width:${PDF_SELO_MM}mm;">
  </div>`;
}

/* carrega uma imagem da mesma origem; com `lado` devolve PNG reduzido (selo de 1080 px vira ~300 px) */
const _pdfImgCache = {};
function pdfCarregarImagem(caminho, lado){
  const chave = caminho + "|" + (lado || "");
  if(!_pdfImgCache[chave]){
    _pdfImgCache[chave] = new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => {
        if(!lado) return ok(img);
        const cv = document.createElement("canvas");
        cv.width = lado; cv.height = lado;
        cv.getContext("2d").drawImage(img, 0, 0, lado, lado);
        ok(cv.toDataURL("image/png"));
      };
      img.onerror = () => falha(new Error("Imagem não encontrada: " + caminho));
      img.src = pdfUrl(caminho);
    }).catch(err => { delete _pdfImgCache[chave]; throw err; });
  }
  return _pdfImgCache[chave];
}

/* selo e texto no pé de cada página do jsPDF */
function pdfCarimbarRodape(pdf, selo, margem){
  const larg = pdf.internal.pageSize.getWidth();
  const alt  = pdf.internal.pageSize.getHeight();
  const esq = margem[1], dir = margem[3];
  const xSelo = larg - dir - PDF_SELO_MM, ySelo = alt - 5 - PDF_SELO_MM;
  const total = pdf.internal.getNumberOfPages();
  for(let i = 1; i <= total; i++){
    pdf.setPage(i);
    pdf.setDrawColor(180); pdf.setLineWidth(0.2);
    pdf.line(esq, alt - 14, xSelo - 3, alt - 14);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(85);
    pdf.text(PDF_RODAPE_TEXTO, esq, alt - 10);
    pdf.text(`Página ${i} de ${total}`, esq + pdf.getTextWidth(PDF_RODAPE_TEXTO) + 6, alt - 10);   // lote S42 (L2): vale para os três PDFs
    if(selo) pdf.addImage(selo, "PNG", xSelo, ySelo, PDF_SELO_MM, PDF_SELO_MM, "selo-iso9001", "FAST");
  }
}

/* gera e baixa o PDF; `elemento` é um container temporário (o rodapé HTML dele é retirado).
   opcoes: filename, largura (mm úteis, padrão 190), topo (mm, padrão 12) */
async function pdfGerar(elemento, opcoes = {}){
  if(typeof html2pdf === "undefined") throw new Error("Biblioteca html2pdf não carregada.");
  const { margem, largPx } = pdfMargens(opcoes.largura || 190, opcoes.topo || 12);
  /* logo pré-carregado para o html2canvas não fotografar a imagem vazia; sem selo o PDF sai assim mesmo */
  await pdfCarregarImagem(PDF_LOGO_SRC).catch(() => null);
  const selo = await pdfCarregarImagem(PDF_SELO_SRC, 300).catch(() => null);
  elemento.querySelectorAll(".pdf-rodape").forEach(n => n.remove());
  await html2pdf().set({
    margin:      margem,
    filename:    opcoes.filename || "documento.pdf",
    image:       { type: "jpeg", quality: 0.95 },
    // lote S42 (L3): letterRendering desenha letra por letra e embaralhava "NBR-7212 e NBR-12.655" na quebra de linha
    html2canvas: { scale: 2, useCORS: true, letterRendering: false, width: largPx },
    jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak:   { mode: ["css", "legacy"], avoid: ["tr", "p", "li", ".nao-quebrar"] }
  }).from(elemento).toPdf().get("pdf").then(pdf => pdfCarimbarRodape(pdf, selo, margem)).save();
}

/* Debounce para campos de busca: re-renderizar a lista inteira a cada tecla
   travava nas listas grandes (produtos, estacas). 150 ms é imperceptível. */
function debounce(fn, ms = 150){
  let t = null;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* Lote S47 (#112): ordenação pelo cabeçalho, para reaproveitar em qualquer lista.
   colunas: { chave: { valor: (linha) => número | texto | data ISO, tipo: "num" | "texto" | "data", dirInicial?: "asc"|"desc" } }
   estado:  { chave: "orc-ordem" (sessionStorage: vale para a janela aberta), padrao: { col, dir } }
   Uso:  const ord = ordenarTabela(colunas, estado);
         lista = ord.aplicar(lista);                    // cópia ordenada (vazio sempre por último; empate mantém a ordem)
         `<thead><tr>${ord.th("cliente", "Cliente")}…`  // <th> com seta (aria-sort) e data-ordena
         ord.ligar(container, render);                  // clique/Enter no cabeçalho alterna asc ↔ desc e chama render() */
function ordenarTabela(colunas, estado){
  const chave = estado && estado.chave ? estado.chave : null;
  const dirOk = (d) => d === "desc" ? "desc" : "asc";
  let atual = { col: estado?.padrao?.col || null, dir: dirOk(estado?.padrao?.dir) };
  if(chave){
    try { const s = JSON.parse(sessionStorage.getItem(chave) || "null"); if(s && colunas[s.col]) atual = { col: s.col, dir: dirOk(s.dir) }; }
    catch(_e){ /* sessionStorage bloqueado ou valor velho: fica o padrão */ }
  }
  const vazio = (v) => v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));
  const comparar = (a, b, tipo) => {
    if(tipo === "num") return Number(a) - Number(b);
    if(tipo === "data") return String(a).localeCompare(String(b));
    return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
  };
  const api = {
    get estado(){ return { ...atual }; },
    aplicar(lista){
      const c = atual.col && colunas[atual.col];
      if(!c) return (lista || []).slice();
      const m = atual.dir === "desc" ? -1 : 1;
      return (lista || []).map((x, i) => ({ x, i, v: c.valor(x) })).sort((p, q) => {
        const ep = vazio(p.v), eq = vazio(q.v);
        if(ep || eq) return ep && eq ? p.i - q.i : ep ? 1 : -1;
        return (comparar(p.v, q.v, c.tipo || "texto") * m) || p.i - q.i;
      }).map(o => o.x);
    },
    th(col, rotulo, extra){
      const s = atual.col === col ? (atual.dir === "desc" ? "descending" : "ascending") : "none";
      const cls = extra && extra.cls ? " " + extra.cls : "";
      const tit = extra && extra.title ? extra.title + " · " : "";
      return `<th class="th-ordena${cls}" data-ordena="${esc(col)}" aria-sort="${s}" tabindex="0" title="${esc(tit)}Clique para ordenar (de novo inverte)">${esc(rotulo)}</th>`;
    },
    alternar(col){
      if(!colunas[col]) return;
      atual = atual.col === col ? { col, dir: atual.dir === "asc" ? "desc" : "asc" } : { col, dir: dirOk(colunas[col].dirInicial) };
      if(chave){ try { sessionStorage.setItem(chave, JSON.stringify(atual)); } catch(_e){ /* ok */ } }
    },
    ligar(container, aoMudar){
      const el = typeof container === "string" ? $(container) : container;
      if(!el || el.dataset.ordenaLigado) return;
      el.dataset.ordenaLigado = "1";
      const vai = (th) => { api.alternar(th.dataset.ordena); if(typeof aoMudar === "function") aoMudar(); };
      el.addEventListener("click", (e) => { const th = e.target.closest("th[data-ordena]"); if(th && el.contains(th)) vai(th); });
      el.addEventListener("keydown", (e) => {
        const th = e.target.closest && e.target.closest("th[data-ordena]");
        if(th && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); vai(th); }
      });
    }
  };
  return api;
}

/* ====================== ACESSIBILIDADE (Onda 3) ======================
   Um único inicializador cobre o app inteiro sem tocar nos templates:
   1. <label> sem `for` dentro de .campo passa a apontar para o campo seguinte
      (clicar no rótulo foca; leitor de tela associa).
   2. Buscas/filtros/selects sem rótulo ganham aria-label (do placeholder ou
      da 1ª opção); botões "×" viram "Fechar".
   3. Tudo que é clicável mas é <div>/<tr>/<circle> (linhas, cards, statusbar,
      KPIs, planta) ganha tabindex=0 + role=button — via MutationObserver,
      então vale também para o que os módulos renderizam depois.
   4. Enter/Espaço num desses elementos dispara o mesmo click do mouse. */
const ACIONAVEIS = ".linha-clicavel, .serv-kan-card, .odoo-statusbar .stage, .ind-click, .dash-card.clicavel, .dash-pendencia-item.clicavel, .dash-linha-obra, .dash-ativ-item, #est-planta-svg .estaca-circ";
function marcarAcionaveis(raiz){
  const alvo = raiz && raiz.querySelectorAll ? raiz : document;
  alvo.querySelectorAll(ACIONAVEIS).forEach(el => {
    if(el.hasAttribute("tabindex")) return;
    el.setAttribute("tabindex", "0");
    if(!el.hasAttribute("role")) el.setAttribute("role", "button");
  });
}
function rotularControles(raiz){
  const alvo = raiz && raiz.querySelectorAll ? raiz : document;
  alvo.querySelectorAll(".campo > label:not([for])").forEach(lb => {
    const campo = lb.parentElement.querySelector("input, select, textarea");
    if(campo && campo.id) lb.setAttribute("for", campo.id);
  });
  alvo.querySelectorAll("input[placeholder]:not([aria-label]):not([aria-labelledby])").forEach(i => {
    if(!i.closest(".campo")) i.setAttribute("aria-label", i.placeholder);
  });
  alvo.querySelectorAll("select:not([aria-label]):not([aria-labelledby])").forEach(s => {
    if(!s.closest(".campo") && s.options[0]) s.setAttribute("aria-label", s.options[0].textContent.trim());
  });
  alvo.querySelectorAll("button:not([aria-label])").forEach(b => {
    if(b.textContent.trim() === "×") b.setAttribute("aria-label", "Fechar");
  });
}
function iniciarAcessibilidade(){
  rotularControles(document);
  marcarAcionaveis(document);
  // Renders posteriores (innerHTML dos módulos) passam pelo observer
  const obs = new MutationObserver(muts => {
    for(const m of muts){
      m.addedNodes.forEach(n => { if(n.nodeType === 1){ marcarAcionaveis(n); rotularControles(n); } });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  // Teclado: Enter/Espaço = click (reaproveita os handlers já existentes)
  document.addEventListener("keydown", (ev) => {
    if(ev.key !== "Enter" && ev.key !== " ") return;
    const el = ev.target;
    if(!el || !el.matches || !el.matches(ACIONAVEIS)) return;
    if(el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT") return;
    ev.preventDefault();
    el.click();
  });
}


/* ====================== AUTENTICAÇÃO ====================== */
/* Fase 93b: funcionário entra com o CPF. O usuário dele no Auth tem o e-mail técnico
   <cpf só dígitos>@funcionarios.cglfundacoes.com.br (domínio interno, sem caixa postal), criado pelo RH na aba
   Acesso da ficha do funcionário. O campo "E-mail ou CPF" aceita os dois: só dígitos (com ou sem pontos e traço),
   11 deles, vira o e-mail técnico aqui; qualquer outra coisa segue como e-mail. O e-mail técnico nunca vai para a
   tela: fica nesta função e em `_loginCpfDigitos` (para recusar senha igual ao CPF). */
const LOGIN_CPF_DOMINIO = "funcionarios.cglfundacoes.com.br";
let _loginCpfDigitos = null;
function loginPareceCpf(v){
  const s = String(v || "").trim();
  return /^[\d.\-\s]+$/.test(s) && s.replace(/\D/g, "").length === 11;
}
function loginParaEmail(v){
  const s = String(v || "").trim();
  return loginPareceCpf(s) ? s.replace(/\D/g, "") + "@" + LOGIN_CPF_DOMINIO : s;
}
function emailEhLoginCpf(email){ return String(email || "").toLowerCase().endsWith("@" + LOGIN_CPF_DOMINIO); }

$("form-login").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const btn = $("btn-entrar");
  btn.disabled = true; btn.textContent = "Entrando...";
  // fase 87: "Manter conectado neste computador" decide onde a sessão vai viver; tem que estar gravado
  // antes do signIn, que é quem grava a sessão. O prazo da empresa é aplicado depois do login.
  if($("login-lembrar") && $("login-lembrar").checked) lembrarGravar(POL_SESSAO_PADRAO.lembrar_dias); else lembrarApagar();
  const { error } = await sb.auth.signInWithPassword({
    email: loginParaEmail($("login-email").value),   // fase 93b: CPF vira o e-mail técnico
    password: $("login-senha").value
  });
  btn.disabled = false; btn.textContent = "Entrar";
  if(error){
    const m = (error.message||"").toLowerCase();
    if(m.includes("invalid login")) aviso("login-aviso", loginPareceCpf($("login-email").value) ? "CPF ou senha inválidos. Sem a senha, peça uma nova ao RH." : "E-mail ou senha inválidos.","erro");
    else if(m.includes("banned")) aviso("login-aviso","Seu usuário está desativado. Fale com a diretoria.","erro");
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
  // fase 93b: login por CPF não tem caixa postal; a senha nova vem do RH (aba Acesso da ficha do funcionário)
  if(loginPareceCpf(email) || emailEhLoginCpf(email)){
    aviso("login-aviso","Quem entra com o CPF não redefine a senha por e-mail: peça uma nova senha ao RH.","aviso");
    return;
  }
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
  appLimparSujo();   // fase 86: sair abandona o que estava na tela
  _polSaindo = true; // fase 87: saída voluntária, sem aviso de "sessão encerrada" na tela de login
  polSessaoLimpar(); // fase 87: esquece "manter conectado" e os marcos da sessão
  await sb.auth.signOut();
  location.reload();
});

/* perfil do usuário logado — preenchido em iniciarApp() */
let usuarioAtual = null;

async function iniciarApp(){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user) return;
  /* fase 99b: sessão restaurada (manter conectado, recarga da aba) de quem tem fator verificado mas não fez o
     desafio nesta sessão: pede o código antes de entrar, para qualquer cargo (antes só o login por senha pedia) */
  if(await mfaPrecisaDesafio()){ $("tela-app").style.display = "none"; $("tela-login").style.display = ""; mostrarDesafioMFALogin(); return; }
  // fase 93b: login_cpf e senha_provisoria entram na leitura; se a migration da 93b ainda não estiver no banco
  // (42703: coluna não existe), lê sem elas para ninguém ficar sem perfil
  let { data:perfil, error:perfilErr } = await sb.from("profiles")
    .select("id,nome,cargo,ativo,login_cpf,senha_provisoria,modulos_extras,modulos_extras_ate").eq("id",user.id).single();   // hotfix 113: módulos extras
  if(perfilErr && perfilErr.code === "42703"){
    ({ data:perfil, error:perfilErr } = await sb.from("profiles").select("id,nome,cargo,ativo").eq("id",user.id).single());
  }

  /* bloqueia acesso de usuários desativados. Fase 62: com o is_ativo() nas policies o
     desativado não lê nem o próprio perfil (a consulta volta sem linha, PGRST116) */
  if((perfil && perfil.ativo === false) || (!perfil && perfilErr?.code === "PGRST116")){
    await sb.auth.signOut();
    aviso("login-aviso","Seu usuário está desativado. Fale com a diretoria.","erro");
    return;
  }

  // fase 93b: o e-mail técnico do login por CPF não aparece na tela (carrega o CPF)
  _loginCpfDigitos = emailEhLoginCpf(user.email) ? String(user.email).split("@")[0] : null;
  const rotuloSemPerfil = _loginCpfDigitos ? "Funcionário" : user.email;
  usuarioAtual = perfil || { id:user.id, nome:rotuloSemPerfil, cargo:null, ativo:true };
  const nome = perfil ? (perfil.nome + " · " + perfil.cargo) : rotuloSemPerfil;
  $("usr-nome").textContent = nome;

  /* Cargos de gestão: diretor tem acesso total (has_role() no banco
     também devolve true para ele em qualquer verificação) */
  const ehDiretorOuAdmin = perfil && ["diretor","admin"].includes(perfil.cargo);

  aplicarMenuPorCargo(perfil);

  $("tela-login").style.display = "none";
  $("tela-app").style.display = "flex";

  /* fase 86: a aba passa a conferir versao.json e se atualiza sozinha depois de cada publicação */
  iniciarVerificacaoVersao();

  /* fase 87: prazos da empresa, vigia de inatividade / sessão máxima / revogação e MFA obrigatório por cargo */
  await carregarPoliticaSessao();
  if(!iniciarPoliticaSessao()) return;   // um prazo já tinha estourado ao abrir: saiu para o login
  const mfaObrigatorio = await exigirMFAObrigatorio(perfil);

  /* P0 — alertar diretor/admin sem MFA configurado (quando o cargo não está na lista do obrigatório) */
  if(ehDiretorOuAdmin && !mfaObrigatorio) verificarMFAAdmin();

  /* fase 93b: senha definida pelo RH é provisória — troca obrigatória antes de qualquer outra coisa */
  if(perfil?.senha_provisoria && !mfaObrigatorio) await exigirTrocaSenhaProvisoria();
  /* Chegou por link de convite ou recuperação: definir a senha agora */
  else if(_chegouPorConvite) abrirDefinirSenha();

  await carregarTudo();
}

/* ---------- Definição de senha (convite / recuperação) ---------- */
function abrirDefinirSenha(){
  const m = $("senha-modal");
  if(m) m.style.display = "flex";
}

/* Fase 93b: a senha que o RH digitou na aba Acesso é provisória (profiles.senha_provisoria). O mesmo modal
   do convite abre em modo obrigatório: sem fechar, menu travado (body.senha-provisoria, conferido em
   ativarSecao) e o resto do app só carrega depois que a senha nova é gravada e a RPC
   rh_login_marcar_senha_trocada() zera a flag. Senha igual ao CPF é recusada. */
let _senhaProvisoriaResolver = null;
function exigirTrocaSenhaProvisoria(){
  return new Promise((resolve) => {
    _senhaProvisoriaResolver = resolve;
    document.body.classList.add("senha-provisoria");
    if($("senha-modal-titulo")) $("senha-modal-titulo").textContent = "🔐 Troque sua senha";
    if($("senha-modal-texto")) $("senha-modal-texto").textContent =
      "Sua senha foi definida pelo RH e vale só para este primeiro acesso. Escolha agora a senha que usará daqui em diante (mínimo 8 caracteres).";
    abrirDefinirSenha();
    $("senha-nova")?.focus();
  });
}

$("btn-senha-salvar")?.addEventListener("click", async ()=>{
  const s1 = $("senha-nova").value;
  const s2 = $("senha-confirma").value;
  if(s1.length < 8){ aviso("senha-modal-aviso","A senha precisa de pelo menos 8 caracteres.","erro"); return; }
  if(s1 !== s2){ aviso("senha-modal-aviso","As senhas não conferem.","erro"); return; }
  if(_loginCpfDigitos && s1.replace(/\D/g, "") === _loginCpfDigitos){ aviso("senha-modal-aviso","A senha não pode ser o seu CPF.","erro"); return; }
  const btn = $("btn-senha-salvar");
  btn.disabled = true; btn.textContent = "Salvando...";
  const { error } = await sb.auth.updateUser({ password: s1 });
  btn.disabled = false; btn.textContent = "Salvar senha";
  if(error){
    const m = (error.message || "").toLowerCase();
    aviso("senha-modal-aviso", m.includes("different from the old") || m.includes("same password")
      ? "Escolha uma senha diferente da que o RH definiu." : "Não foi possível salvar: "+(error.message||"erro"),"erro");
    return;
  }
  $("senha-nova").value = ""; $("senha-confirma").value = "";
  $("senha-modal").style.display = "none";
  if(_senhaProvisoriaResolver){   // fase 93b: zera a flag e libera o app
    const { error: rpcErr } = await sb.rpc("rh_login_marcar_senha_trocada");
    if(rpcErr) console.warn("rh_login_marcar_senha_trocada:", rpcErr.message);
    if(usuarioAtual) usuarioAtual.senha_provisoria = false;
    document.body.classList.remove("senha-provisoria");
    const r = _senhaProvisoriaResolver; _senhaProvisoriaResolver = null; r();
  }
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

// Navegação entre seções. ativarSecao(secao, botao) é o que o clique no menu faz; a fase 89 usa a
// mesma função para seções SEM item no menu (Movimentações de Ativos virou ficha do documento da viagem).
function ativarSecao(secao, b){
  if(document.body.classList.contains("mfa-obrigatorio")) return;   // fase 87: menu travado até concluir o MFA
  if(document.body.classList.contains("senha-provisoria")) return;  // fase 93b: idem até trocar a senha provisória
  if(b){
    document.querySelectorAll(".sidebar-nav button").forEach(x=>x.classList.remove("ativo"));
    b.classList.add("ativo");
  }
  document.querySelectorAll(".secao").forEach(s=>s.classList.remove("ativa"));

  const secId = "sec-" + secao;
  const secEl = $(secId);
  if(secEl) secEl.classList.add("ativa");
  // aviso da tela anterior não deve seguir para a próxima
  const av = $("app-aviso");
  if(av){ av.textContent = ""; av.className = "aviso"; }
  // fase 86: o que estava na seção foi salvo ou abandonado; e trocar de seção também confere se saiu
  // versão nova (no máximo uma consulta a cada 30 s)
  appLimparSujo();
  verificarVersaoApp(30000);
  // Carga sob demanda: a posição de estoque (aba legada) só ao abrir a seção
  if(secao === "estoque" && typeof carregarPosicaoEstoque === "function") carregarPosicaoEstoque();

  // Atualiza o título no cabeçalho: usa o h2 da seção (nome completo, ex.: "Diário de
  // Obra (RDO)") e cai no rótulo do menu quando a seção não tem h2
  const spanText = b ? b.querySelector("span") : null;
  const h2 = secEl ? secEl.querySelector(":scope > h2:first-child") : null;
  const titulo = (h2 && h2.textContent.trim()) || (spanText && spanText.textContent.trim());
  if(titulo && $("app-secao-titulo")) {
    $("app-secao-titulo").textContent = titulo;
  }

  closeSidebar();
}
document.querySelectorAll(".sidebar-nav button").forEach(b=>{
  b.addEventListener("click", ()=> ativarSecao(b.dataset.secao, b));
});
/* Seções que existem sem item no menu (fase 89): abrem só por atalho (link, ficha da viagem) e o acesso é
   decidido pela função de gate. Movimentações de Ativos = ficha do documento (nota/MDF-e) da viagem. */
const SECOES_SEM_MENU = { movimentacoes: () => podeVerMovimentacoes() };

/* Navega para uma seção via o botão da nav (reusa o handler acima, que
   ativa a seção e o título). Usado pelos atalhos clicáveis do dashboard. */
/* Fase 49: módulos comerciais (catálogo de serviços e orçamentos) — só diretoria e comercial */
const SECOES_COMERCIAIS = ["servicos", "orcamentos"];
/* Fase 53: Movimentações de Ativos (remessa/retorno de máquinas e acessórios) — diretoria, admin, logística, gestor de acessórios e almoxarife.
   Os demais cargos seguem gerando remessa/retorno pela mobilização, sem precisar da tela.
   Fase 105b: o financeiro entra (decisão 6: emite e cancela a NF-e de remessa, que vive na ficha do documento). */
function podeVerMovimentacoes(){
  return !!usuarioAtual && ["diretor", "admin", "logistica", "gestor_acessorios", "almoxarife", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}
function podeVerComercial(){
  return !!usuarioAtual && ["diretor", "comercial", "auditor"].includes(usuarioAtual.cargo);
}
/* Hotfix 113 (21/10/2026): módulo liberado além do cargo, por usuário e com validade (profiles.modulos_extras /
   modulos_extras_ate; só diretoria/admin gravam, tela Usuários). Espelha tem_modulo_extra() do banco. Hoje só
   "orcamentos" (o Frederico Vaz apoia o Thales nas férias dele). Serviços continua só comercial/diretoria. */
function temModuloExtra(modulo){
  if(!usuarioAtual || !Array.isArray(usuarioAtual.modulos_extras) || !usuarioAtual.modulos_extras.includes(modulo)) return false;
  const ate = usuarioAtual.modulos_extras_ate;
  return !ate || String(ate).slice(0, 10) >= (typeof hojeISO === "function" ? hojeISO() : new Date().toISOString().slice(0, 10));
}
function podeVerOrcamentos(){ return podeVerComercial() || temModuloExtra("orcamentos"); }
/* Fase 55: Contratos & Contas a pagar (contratos de fornecedor, títulos a pagar, lançamentos avulsos, exportação
   para o Compor 90). Quem não está aqui vê os valores só como custo, na aba Custos da obra e do equipamento. */
/* 22/09/2026 (diretoria): somatórios patrimoniais (valor de reposição dos acessórios, FIPE da frota) só para o cargo diretor.
   Fase 79: o auditor (usuário de revisão, só leitura) também vê, para conferir a Sala de Comando inteira. */
function ehDiretoria(){ return !!usuarioAtual && ["diretor", "auditor"].includes(usuarioAtual.cargo); }
/* Fase 79 (Bernardo, 15/10/2026): cargo auditor = usuário de revisão. Vê o que a diretoria vê (menos dados sensíveis
   de funcionário) e não grava nada: a RLS barra; a classe body.so-leitura só esconde os botões de gravação. */
function ehSomenteLeitura(){ return !!usuarioAtual && usuarioAtual.cargo === "auditor"; }
function podeVerContasPagar(){
  return !!usuarioAtual && ["diretor", "admin", "financeiro", "comprador", "auditor"].includes(usuarioAtual.cargo);
}
/* Fase 76: Centros de custo internos (setores e obras internas): quem lê custos de compras e acessórios */
function podeVerCentrosCusto(){
  return !!usuarioAtual && ["diretor", "admin", "financeiro", "comprador", "gestor_acessorios", "gestor_frota", "auditor"].includes(usuarioAtual.cargo);
}
/* Fase 90 (áudios do Julio, 18/10/2026): o valor contratado da obra vive em obras_financeiro, que no banco só
   pode_ler_financeiro() lê (admin, engenheiro, assistente de engenharia, comercial, financeiro, auditor; diretor por
   has_role). O front espelha a lista para não desenhar coluna, chip e campo vazios para quem não lê. */
function podeVerValorObra(){
  return !!usuarioAtual && ["diretor", "admin", "engenheiro", "assistente_engenharia", "comercial", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}
/* Fase 98: permutas (obra paga em imóvel: teto, crédito, saldo, documentos). Espelha pode_ler_permutas() do banco:
   sem engenharia nem comercial, ao contrário de podeVerValorObra(). */
function podeVerPermutas(){
  return !!usuarioAtual && ["diretor", "admin", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}
/* Fase 93c: "Horas e alocação" (horas do RDO a liberar, fechamento do mês, alocação por obra). Quem libera é o
   engenheiro responsável da obra ou o gestor do serviço (rh_horas_liberar() no banco); encarregado só vê; RH fecha o
   mês e lança na folha; logística confere a alocação. Espelha rh_pode_ler_horas() do banco, menos gestor de frota.
   "Minhas horas de viagem" (sec-rhv) é de todos. */
function podeVerHorasRH(){
  return !!usuarioAtual && ["diretor", "admin", "engenheiro", "assistente_engenharia", "encarregado", "rh", "logistica", "auditor"].includes(usuarioAtual.cargo);
}
/* Fase 97 (Bernardo, 20/10/2026, decisão 2): Patrimônio (valor de mercado dos bens) só para diretor e auditor; ADMIN
   NÃO VÊ. Espelha pode_ler_patrimonio() do banco, que ainda exige a sessão com MFA (aal2). */
function podeVerPatrimonio(perfil){
  const p = perfil || usuarioAtual;
  return !!p && ["diretor", "auditor"].includes(p.cargo);
}
/* Fase 105 (Bernardo, 22/10/2026, decisão 6): emitem e cancelam NF-e de remessa e NFS-e, e editam os dados fiscais da
   empresa, o gestor de acessórios, o financeiro e a logística; ADMIN FORA. Espelha fiscal_pode_emitir() do banco. */
function podeEmitirFiscal(){
  return !!usuarioAtual && ["diretor", "gestor_acessorios", "financeiro", "logistica"].includes(usuarioAtual.cargo);
}
/* Módulos que um cargo não usa e por isso saem do menu (o atalho por irParaSecao também é barrado).
   22/09/2026 (Bernardo com a Ju): RH fica com Início, Funcionários, Mobilizações, Frota, RDO e Chamados. */
const SECOES_OCULTAS_POR_CARGO = {
  rh: ["medicoes", "acessorios", "reparos", "fabricacao", "equipamentos", "obras", "compras", "estoque", "separacoes", "produtos", "fornecedores", "clientes"],
  // fase 77 (Bernardo, 07/10/2026): gestor de frota cuida de frota, equipamentos, manutenção e compras da frota
  gestor_frota: ["acessorios", "reparos", "fabricacao", "medicoes"],
  // fase 79: auditor (usuário de revisão) vê tudo, menos a gestão de logins
  auditor: ["usuarios"],
  // fase 90 (Bernardo, 19/10/2026): auxiliar de almoxarifado = equipe do Julio. Fica só com Início (fila de separação),
  // Estoque, Separações, Produtos (consulta), Reparos (aba Peças) e Chamados; o resto sai do menu e irParaSecao barra.
  auxiliar_almoxarifado: ["clientes", "fornecedores", "funcionarios", "servicos", "compras", "orcamentos", "contratos", "centros",
    "carteira", "obras", "mobilizacoes", "equipamentos", "frota", "acessorios", "fabricacao", "medicoes", "rdo", "usuarios", "rhh"],
  // fase 92 (Bernardo, 19/10/2026, decisão 1): gestor da manutenção (Bruno) cuida de OS, planos, checklists, equipamentos, frota
  // e das compras do setor; obras, medições e contas a pagar (podeVerContasPagar) ficam fora
  gestor_manutencao: ["obras", "medicoes"]
};
/* Fase 97: Patrimônio sai do menu de todo cargo que não é diretor nem auditor (admin incluído). O item também nasce
   escondido no index.html e só aplicarMenuPorCargo o mostra (podeVerPatrimonio), então cargo novo fica sem ele. */
["admin", "engenheiro", "assistente_engenharia", "comercial", "financeiro", "comprador", "almoxarife", "auxiliar_almoxarifado",
 "gestor_acessorios", "gestor_frota", "gestor_manutencao", "mecanico", "encarregado", "operador", "rh", "sesmt", "logistica",
 "visualizador"].forEach(c => { (SECOES_OCULTAS_POR_CARGO[c] = SECOES_OCULTAS_POR_CARGO[c] || []).push("patrimonio"); });
/* Mostra/esconde os itens do menu conforme o cargo. Chamado no login; isolado para poder ser testado. */
function aplicarMenuPorCargo(perfil){
  const ehDiretorOuAdmin = !!perfil && ["diretor","admin"].includes(perfil.cargo);
  /* item "Usuários" só aparece para diretor/admin */
  const navUsr = $("nav-usuarios");
  if(navUsr) navUsr.style.display = ehDiretorOuAdmin ? "" : "none";

  /* "Carteira" (controle de contratos & pendências): só diretoria.
     As pendências que interessam à engenharia aparecem dentro da ficha
     da Obra (aba Contrato) e como badge na lista de obras. */
  // Carteira: só cargo diretor (admin ficou de fora em 02/09/2026 a pedido da diretoria;
  // as pendências por contrato continuam visíveis na aba Contrato da Obra para todos)
  const navCart = $("nav-carteira");
  if(navCart) navCart.style.display = (perfil && ["diretor", "auditor"].includes(perfil.cargo)) ? "" : "none";

  // Fase 49 (Bernardo, 21/09/2026): Catálogo de Serviços e Orçamentos só para diretoria e comercial.
  // Os demais cargos não veem os itens no menu; irParaSecao() também barra atalhos de outras telas.
  SECOES_COMERCIAIS.forEach(s => {
    const b = document.querySelector(`.sidebar-nav button[data-secao="${s}"]`);
    if(b) b.style.display = (s === "orcamentos" ? podeVerOrcamentos() : podeVerComercial()) ? "" : "none";   // hotfix 113: Orçamentos também por módulo extra
  });
  // Fase 53 → 89: Movimentações de Ativos saiu do menu (19/10/2026); é a ficha do documento da viagem, aberta de
  // dentro de Logística, da obra, do equipamento e do acessório. podeVerMovimentacoes() gateia só a ficha (irParaSecao).
  // Fase 55 (Bernardo, 21/09/2026): Contratos & Contas a pagar só para diretoria, admin, financeiro e comprador
  const navCon = document.querySelector('.sidebar-nav button[data-secao="contratos"]');
  if(navCon) navCon.style.display = podeVerContasPagar() ? "" : "none";
  const navCcu = document.querySelector('.sidebar-nav button[data-secao="centros"]');
  if(navCcu) navCcu.style.display = podeVerCentrosCusto() ? "" : "none";
  // Fase 93c: "Horas e alocação" só para quem libera, confere ou fecha horas (lista em podeVerHorasRH)
  const navRhh = $("nav-rhh");
  if(navRhh) navRhh.style.display = podeVerHorasRH() ? "" : "none";
  // Fase 97: Patrimônio só diretor e auditor (admin não); a lista de ocultas abaixo reforça para os demais cargos
  const navPat = $("nav-patrimonio");
  if(navPat) navPat.style.display = podeVerPatrimonio(perfil) ? "" : "none";
  // Fase 95: criar mobilização (botão do quadro e "Criar mobilização" da aba Contrato da obra) só para quem grava em
  // mobilizacoes (MOB_CARGOS_EDITAM em js/mobilizacoes.js, que já está carregado quando o login chama esta função)
  const podeMob = typeof MOB_CARGOS_EDITAM !== "undefined" && !!perfil && MOB_CARGOS_EDITAM.includes(perfil.cargo);
  ["btn-mob-nova", "btn-obr-criar-mob"].forEach(id => { const b = $(id); if(b) b.style.display = podeMob ? "" : "none"; });

  // Só esconde: reexibir aqui mostraria "Usuários" (oculto do auditor) a todos os cargos. Sair recarrega a página.
  (SECOES_OCULTAS_POR_CARGO[perfil?.cargo] || []).forEach(s => {
    const b = document.querySelector(`.sidebar-nav button[data-secao="${s}"]`);
    if(b) b.style.display = "none";
  });

  // Fase 79: usuário de revisão — faixa no topo e botões de gravação escondidos (body.so-leitura no CSS)
  const soLeitura = !!perfil && perfil.cargo === "auditor";
  document.body.classList.toggle("so-leitura", soLeitura);
  let faixa = $("faixa-so-leitura");
  if(soLeitura && !faixa){
    faixa = document.createElement("div");
    faixa.id = "faixa-so-leitura";
    faixa.className = "faixa-so-leitura";
    faixa.textContent = "Modo leitura: usuário de revisão";
    document.body.prepend(faixa);
  }
  if(faixa) faixa.style.display = soLeitura ? "" : "none";
}
function irParaSecao(secao){
  const b = document.querySelector(`.sidebar-nav button[data-secao="${secao}"]`);
  // item escondido do menu (Usuários, Carteira, Serviços, Orçamentos…) = módulo fora do perfil: não navega por atalho
  if(b && b.style.display === "none"){ aviso("app-aviso", "Seu perfil não tem acesso a este módulo.", "erro"); return false; }
  if(b){ b.click(); return true; }
  // fase 89: seção sem item no menu (ficha do documento de movimentação) — o gate decide, o item ativo do menu fica
  if(SECOES_SEM_MENU[secao] && $("sec-" + secao)){
    if(!SECOES_SEM_MENU[secao]()){ aviso("app-aviso", "Seu perfil não tem acesso a este módulo.", "erro"); return false; }
    ativarSecao(secao, null);
    return true;
  }
  return false;
}

/* Chamado #4 (Thales, 15/09/2026): a obra é clicável em qualquer tela.
   linkObra(obraId, texto) devolve um <a class="link-obra"> que abre a ficha da
   obra; sem obraId devolve só o texto. O clique é tratado aqui, em fase de
   captura, para não disparar o clique da linha/card que contém o link
   (ex.: abrir a medição em vez da obra). Fecha drawers/modais abertos antes
   de navegar (chamado, mobilização, import de RDO). */
function linkObra(obraId, texto){
  const t = texto != null ? texto : (mapaObras[obraId] || "—");
  if(!obraId) return esc(t);
  return `<a href="#" class="link-obra" data-obra-id="${esc(obraId)}" title="Abrir a ficha da obra">${esc(t)}</a>`;
}
document.addEventListener("click", (e) => {
  const a = e.target && e.target.closest ? e.target.closest("a.link-obra") : null;
  if(!a) return;
  e.preventDefault();
  e.stopPropagation();
  const id = a.dataset.obraId;
  if(!id) return;
  if(typeof fecharChamado === "function" && $("cham-modal") && $("cham-modal").style.display !== "none") fecharChamado();
  if(typeof fecharMobilizacao === "function" && $("mob-modal") && $("mob-modal").style.display !== "none") fecharMobilizacao();
  if(typeof fecharModalImportCSV === "function" && $("csv-modal") && $("csv-modal").style.display !== "none") fecharModalImportCSV();
  if(typeof dashAbrirObra === "function") dashAbrirObra(id);
  else { irParaSecao("obras"); if(typeof abrirObra === "function") abrirObra(id); }
}, true);

/* Fase 80 (pedido do Bernardo, 15/10/2026): peça, TAG, produto e movimentação clicáveis em qualquer
   tela, no mesmo padrão de linkObra. linkX(id, texto) devolve um <a class="link-cad"> que abre o
   cadastro; sem id devolve só o texto. Clique tratado em captura, como o da obra. */
function linkCadastro(tipo, id, texto, titulo){
  const t = texto != null ? texto : "—";
  if(!id) return esc(t);
  return `<a href="#" class="link-cad" data-cad="${esc(tipo)}" data-cad-id="${esc(id)}" title="${esc(titulo)}">${esc(t)}</a>`;
}
function linkAcessorio(id, texto){ return linkCadastro("acessorio", id, texto, "Abrir a ficha da peça"); }
function linkEquipamento(id, texto){ return linkCadastro("equipamento", id, texto, "Abrir a ficha do equipamento"); }
function linkProduto(id, texto){ return linkCadastro("produto", id, texto, "Abrir o cadastro do produto"); }
function linkMovimentacao(id, texto){ return linkCadastro("movimentacao", id, texto, "Abrir a nota (documento da viagem)"); }
function linkReparo(id, texto){ return linkCadastro("reparo", id, texto, "Abrir o reparo"); }   // fase 82
function linkFabricacao(id, texto){ return linkCadastro("fabricacao", id, texto, "Abrir a ordem de fabricação"); }   // fase 84
function linkViagem(id, texto){ return linkCadastro("viagem", id, texto, "Abrir a viagem (Logística)"); }   // fase 89
function linkManutencao(id, texto){ return linkCadastro("manutencao", id, texto, "Abrir a OS de manutenção"); }   // fase 92
const LINK_CAD_SECAO = { acessorio: "acessorios", equipamento: "equipamentos", produto: "produtos", movimentacao: "movimentacoes", reparo: "reparos", fabricacao: "fabricacao", viagem: "frota", manutencao: "manutencao" };
document.addEventListener("click", async (e) => {
  const a = e.target && e.target.closest ? e.target.closest("a.link-cad") : null;
  if(!a) return;
  e.preventDefault();
  e.stopPropagation();
  const tipo = a.dataset.cad, id = a.dataset.cadId;
  if(!id || !LINK_CAD_SECAO[tipo]) return;
  if(typeof fecharMobilizacao === "function" && $("mob-modal") && $("mob-modal").style.display !== "none") fecharMobilizacao();
  if(typeof fecharChamado === "function" && $("cham-modal") && $("cham-modal").style.display !== "none") fecharChamado();
  if(!irParaSecao(LINK_CAD_SECAO[tipo])) return;
  if(tipo === "acessorio" && typeof abrirAcessorio === "function"){
    // a seção carrega o catálogo ao abrir; espera ele chegar (até 20 s)
    for(let i = 0; i < 80 && !(typeof _aceCarregado !== "undefined" && _aceCarregado); i++) await new Promise(r => setTimeout(r, 250));
    abrirAcessorio(id);
  }
  else if(tipo === "equipamento" && typeof abrirEquipamento === "function") abrirEquipamento(id);
  else if(tipo === "produto" && typeof abrirProduto === "function") abrirProduto(id);
  else if(tipo === "movimentacao" && typeof abrirMovimentacao === "function") abrirMovimentacao(id);
  else if(tipo === "reparo" && typeof abrirReparo === "function") abrirReparo(id);
  else if(tipo === "fabricacao" && typeof abrirOrdemFabricacao === "function") abrirOrdemFabricacao(id);
  else if(tipo === "viagem" && typeof abrirViagem === "function") abrirViagem(id, null);
  else if(tipo === "manutencao" && typeof abrirManutencao === "function") abrirManutencao(id);   // fase 92
}, true);

/* ====================== ATUALIZAÇÃO AUTOMÁTICA DO APP (fase 86) ======================
   Pedido do Bernardo em 16/10/2026: depois de cada publicação ninguém pode continuar numa versão
   antiga. A saída é recarregar a aba, nunca deslogar: o login vive no storage do navegador (fase 87:
   sessionStorage, ou localStorage com "manter conectado") e sobrevive ao reload, então ninguém digita
   senha nem MFA de novo. `scripts/publicar-app.sh` grava `versao.json`
   ao lado do index.html publicado e carimba a <meta name="app-versao"> com o commit; aqui o app
   compara os dois.
   - APP_VERSAO = conteúdo da meta. No repo fonte é "dev" e a verificação não roda.
   - verificarVersaoApp(): lê versao.json sem cache logo após o login, a cada 5 min, ao voltar para a
     aba e ao trocar de seção. Falha de rede ou arquivo ausente é ignorada em silêncio.
   - appAtualizacaoPendente(info): sem modal aberto e sem formulário alterado, faixa no topo e
     recarga em 5 s (botão "Agora"); com modal ou formulário sujo a faixa fica fixa, sem recarregar,
     e quando o modal fecha ou o salvar passa (appFormSujo() volta a false) a recarga segue em 5 s.
     Teto: 30 min pendente e 2 min sem tecla ou clique → recarrega mesmo assim.
   - appFormSujo(): input/change em input, select ou textarea dentro de <section> ou de modal marca
     body.dataset.sujo. Limpam a marca: um salvar que passou (comBotaoTravado com botão de gravação,
     sem exceção e sem aviso de erro na tela), a troca de seção, o Sair e o fechamento de modal/drawer.
     Busca e filtro (.serv-filtros, .lista-topo, type=search) não contam: não é trabalho perdido.
   - Na carga: se versao.json já está à frente da meta (o navegador entregou um index.html do cache
     do Pages, max-age 600), recarrega uma vez com ?v=<versao>; guarda em sessionStorage.
   - Depois de recarregar por atualização, avisa uma vez "Sistema atualizado em DD/MM HH:MM: …". */
const APP_VERSAO = (document.querySelector('meta[name="app-versao"]') || {}).content || "dev";
const APP_VERSAO_INTERVALO_MS = 5 * 60 * 1000;   // consulta periódica
const APP_VERSAO_TETO_MS      = 30 * 60 * 1000;  // pendente há tanto tempo…
const APP_VERSAO_INATIVO_MS   = 2 * 60 * 1000;   // …e sem tecla ou clique há tanto: recarrega
const APP_VERSAO_CONTAGEM_S   = 5;
let _appVersaoNova = null;          // versao.json da atualização pendente
let _appVersaoPendenteDesde = 0;
let _appVersaoUltimaConsulta = 0;
let _appVersaoTimerContagem = null;
let _appVersaoTimerVigia = null;
let _appVersaoIniciado = false;
let _appUltimaInteracao = Date.now();

function appVersaoAtiva(){ return APP_VERSAO !== "dev"; }

/* lê o versao.json publicado; null quando não há rede, arquivo ou JSON válido */
async function lerVersaoPublicada(){
  try {
    const r = await fetch("versao.json?ts=" + Date.now(), { cache: "no-store" });
    if(!r.ok) return null;
    const info = await r.json();
    return info && typeof info.versao === "string" && info.versao ? info : null;
  } catch(_){ return null; }
}

/* "DD/MM HH:MM" no fuso do navegador a partir do ISO UTC do versao.json */
function dataHoraBR(iso){
  const d = iso ? new Date(iso) : null;
  if(!d || isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* sessionStorage pode estar bloqueado (navegação privada): nunca deixar isso derrubar o app */
function sessaoLer(chave){ try { return sessionStorage.getItem(chave); } catch(_){ return null; } }
function sessaoGravar(chave, valor){ try { sessionStorage.setItem(chave, valor); } catch(_){} }
function sessaoApagar(chave){ try { sessionStorage.removeItem(chave); } catch(_){} }

/* ---- formulário alterado e modal aberto ---- */
const APP_MODAIS = ".modal-fundo, #modal-mfa";
const APP_SUJO_IGNORAR = ".serv-filtros, .lista-topo, input[type=search]";
function appModalAberto(){
  return Array.from(document.querySelectorAll(APP_MODAIS)).some(m => getComputedStyle(m).display !== "none");
}
function appFormSujo(){ return document.body.dataset.sujo === "1"; }
function appMarcarSujo(){ document.body.dataset.sujo = "1"; }
function appLimparSujo(){ delete document.body.dataset.sujo; }
/* algum aviso de erro visível (#app-aviso ou o aviso do modal/seção aberta): o salvar não passou */
function appAvisoComErro(){
  return Array.from(document.querySelectorAll(".aviso.erro")).some(a => getComputedStyle(a).display !== "none");
}
function appPodeRecarregar(){ return !appModalAberto() && !appFormSujo(); }

/* ---- consulta ---- */
async function verificarVersaoApp(minimoMs){
  if(!_appVersaoIniciado) return;
  if(minimoMs && Date.now() - _appVersaoUltimaConsulta < minimoMs) return;
  _appVersaoUltimaConsulta = Date.now();
  verificarSessaoRevogada();   // fase 87: na mesma cadência, confere se a sessão foi encerrada pela diretoria
  if(!appVersaoAtiva()) return;
  const info = await lerVersaoPublicada();
  if(!info || info.versao === APP_VERSAO) return;
  appAtualizacaoPendente(info);
}

/* registra que a aba vai recarregar por causa desta versão: evita recarregar em laço enquanto o
   Pages ainda entrega o index.html velho e deixa o aviso "Sistema atualizado" para a próxima carga */
function appRegistrarRecarga(info){
  sessaoGravar("cgl_versao_tentativa", JSON.stringify({ versao: info.versao, em: Date.now() }));
  sessaoGravar("cgl_versao_avisar", JSON.stringify({ de: APP_VERSAO, info }));
}

function appAtualizacaoPendente(info){
  if(_appVersaoNova){ _appVersaoNova = info; return; }   // já tratando: só atualiza o que vai ser mostrado
  let tentativa = null;
  try { tentativa = JSON.parse(sessaoLer("cgl_versao_tentativa") || "null"); } catch(_){}
  // esta aba já recarregou por esta versão há menos de 5 min e o index.html continuou velho (CDN do
  // Pages propagando): espera a próxima verificação em vez de recarregar de novo
  if(tentativa && tentativa.versao === info.versao && Date.now() - tentativa.em < APP_VERSAO_INTERVALO_MS) return;
  _appVersaoNova = info;
  _appVersaoPendenteDesde = Date.now();
  appVersaoAvaliar();
  if(!_appVersaoTimerVigia) _appVersaoTimerVigia = setInterval(appVersaoAvaliar, 1000);
}

function appVersaoTeto(){
  const agora = Date.now();
  return agora - _appVersaoPendenteDesde >= APP_VERSAO_TETO_MS && agora - _appUltimaInteracao >= APP_VERSAO_INATIVO_MS;
}

/* a cada segundo enquanto houver atualização pendente: conta 5 s ou segura a faixa */
function appVersaoAvaliar(){
  if(!_appVersaoNova) return;
  const livre = appPodeRecarregar() || appVersaoTeto();
  if(livre){
    if(!_appVersaoTimerContagem) appVersaoContar();
  } else {
    if(_appVersaoTimerContagem){ clearInterval(_appVersaoTimerContagem); _appVersaoTimerContagem = null; }
    appVersaoFaixa(null);
  }
}

function appVersaoContar(){
  let s = APP_VERSAO_CONTAGEM_S;
  appVersaoFaixa(s);
  _appVersaoTimerContagem = setInterval(() => {
    s--;
    if(s <= 0){ clearInterval(_appVersaoTimerContagem); _appVersaoTimerContagem = null; appRecarregarAgora(); return; }
    appVersaoFaixa(s);
  }, 1000);
}

/* faixa no topo do viewport (mesmo lugar do banner de MFA); reaproveita .aviso.atencao */
function appVersaoFaixa(segundos){
  let f = $("app-faixa-versao");
  if(!f){
    f = document.createElement("div");
    f.id = "app-faixa-versao";
    f.className = "aviso atencao faixa-versao";
    f.setAttribute("role", "status");
    f.innerHTML = '<span id="app-faixa-versao-txt"></span><button type="button" class="btn-sec btn-sm" id="app-faixa-versao-btn">Atualizar</button>';
    f.querySelector("button").addEventListener("click", appRecarregarAgora);
    ($("app-viewport") || document.body).prepend(f);
  }
  const quando = dataHoraBR(_appVersaoNova && _appVersaoNova.publicado_em);
  const txt = $("app-faixa-versao-txt"), btn = $("app-faixa-versao-btn");
  if(segundos != null){
    txt.textContent = `Nova versão publicada${quando ? " (" + quando + ")" : ""}. Atualizando em ${segundos} s…`;
    btn.textContent = "Agora";
  } else {
    txt.textContent = "Nova versão disponível. Salve o que está fazendo e clique em Atualizar.";
    btn.textContent = "Atualizar";
  }
}

function appRecarregarAgora(){
  if(_appVersaoNova) appRegistrarRecarga(_appVersaoNova);
  location.reload();
}

/* depois de recarregar por atualização: "Sistema atualizado em …" uma vez por versão, no #app-aviso
   (sem o timeout de aviso(): a mensagem fica até a próxima troca de tela) */
function avisarVersaoAtualizada(){
  let reg = null;
  try { reg = JSON.parse(sessaoLer("cgl_versao_avisar") || "null"); } catch(_){}
  if(!reg || !reg.info) return;
  if(APP_VERSAO === reg.de) return;   // ainda na versão velha (cache): o aviso fica para a próxima carga
  sessaoApagar("cgl_versao_avisar");
  if(sessaoLer("cgl_versao_avisada") === APP_VERSAO) return;
  sessaoGravar("cgl_versao_avisada", APP_VERSAO);
  const el = $("app-aviso");
  if(!el) return;
  const quando = dataHoraBR(reg.info.publicado_em);
  const msg = reg.info.mensagem ? ": " + reg.info.mensagem : "";
  el.textContent = `Sistema atualizado${quando ? " em " + quando : ""}${msg}.`;
  el.className = "aviso ok";
}

/* chamado em iniciarApp(): liga a verificação periódica, o rastro de formulário sujo e de interação */
function iniciarVerificacaoVersao(){
  if(_appVersaoIniciado) return;
  _appVersaoIniciado = true;
  avisarVersaoAtualizada();
  if(!appVersaoAtiva()) return;

  ["input", "change"].forEach(ev => document.addEventListener(ev, e => {
    const el = e.target;
    if(!el || !el.matches || !el.matches("input, select, textarea")) return;
    if(!el.closest("section, " + APP_MODAIS)) return;   // login e campos soltos não contam
    if(el.closest(APP_SUJO_IGNORAR)) return;
    appMarcarSujo();
  }, true));
  ["keydown", "pointerdown"].forEach(ev => document.addEventListener(ev, () => { _appUltimaInteracao = Date.now(); }, { capture: true, passive: true }));
  // modal/drawer fechou (display volta a none): o que estava nele foi salvo ou abandonado
  const obs = new MutationObserver(muts => {
    for(const m of muts){
      if(m.target.matches && m.target.matches(APP_MODAIS) && getComputedStyle(m.target).display === "none") appLimparSujo();
    }
  });
  document.querySelectorAll(APP_MODAIS).forEach(m => obs.observe(m, { attributes: true, attributeFilter: ["style", "class"] }));

  verificarVersaoApp();
  setInterval(verificarVersaoApp, APP_VERSAO_INTERVALO_MS);
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") verificarVersaoApp(30000); });
}

/* Na carga (antes do login): index.html velho vindo do cache com versao.json já novo → recarrega uma
   vez com ?v=<versao>. Chegada por convite/recuperação fica de fora para não perder o token do hash
   (a verificação normal cuida depois do login). Roda aqui porque precisa ser o mais cedo possível. */
(async function verificarVersaoNaCarga(){
  if(!appVersaoAtiva() || _chegouPorConvite) return;
  const info = await lerVersaoPublicada();
  if(!info || info.versao === APP_VERSAO) return;
  let tentativa = null;
  try { tentativa = JSON.parse(sessaoLer("cgl_versao_tentativa") || "null"); } catch(_){}
  if(tentativa && tentativa.versao === info.versao) return;   // já tentou uma vez: sem laço; a verificação periódica segue
  appRegistrarRecarga(info);
  location.replace(location.pathname + "?v=" + encodeURIComponent(info.versao) + location.hash);
})();

/* ====================== POLÍTICA DE SESSÃO (fase 87) ======================
   Decisão do Bernardo em 16/10/2026: ninguém fica logado por acaso. Prazos em empresa_config (mudam
   em Usuários → Política de sessão, sem código): sessao_inatividade_min (240), sessao_maxima_h (12),
   sessao_lembrar_dias (7) e sessao_mfa_cargos ({diretor,admin,rh,financeiro}).
   - Inatividade: keydown, pointerdown, touchstart, scroll e a volta para a aba marcam atividade
     (cgl_ultima_atividade no mesmo storage da sessão: compartilhado entre abas quando é localStorage).
     Vigia a cada 60 s; faltando 5 min, faixa "Sua sessão encerra em N min por inatividade [Continuar]";
     no limite, signOut local e tela de login com o motivo.
   - Sessão máxima: cgl_login_em gravado no primeiro SIGNED_IN; faltando 5 min, faixa (sem Continuar:
     não dá para estender); no limite, sai. Formulário com alteração não salva (appFormSujo) só muda o
     texto da faixa: a saída acontece mesmo assim (a regra é de segurança).
   - Ao abrir o app (inclusive com "manter conectado"), os dois prazos são conferidos antes de qualquer
     coisa: estourou, volta ao login.
   - Auditor (usuário de revisão) fica fora da inatividade e do limite; entra na revogação.
   - Revogação: sessao_ok(login_em) a cada 5 min junto com a verificação da fase 86 (e aqui a cada
     5 ticks quando o app roda em "dev"); falso → sai com "Sessões encerradas pela diretoria".
   - SIGNED_OUT vindo do Supabase com o app aberto (refresh recusado porque a sessão foi apagada,
     Time-box ou Inactivity do painel, saída em outra aba) → volta ao login com aviso.
   - MFA obrigatório: cargo em sessao_mfa_cargos sem aal2 → modal de cadastro em modo obrigatório
     ("Sair" no lugar de Cancelar) e menu travado (body.mfa-obrigatorio) até concluir. Quem já tem MFA
     passa pelo desafio no login (fluxo da fase 24).
   O servidor reforça (painel do Supabase: JWT 10 min, Time-box 12 h, Inactivity 4 h). */
const POL_SESSAO_PADRAO = { inatividade_min: 240, maxima_h: 12, lembrar_dias: 7, mfa_cargos: ["diretor", "admin", "rh", "financeiro"] };
const POL_TICK_MS = 60 * 1000;
const POL_AVISO_MS = 5 * 60 * 1000;
const POL_REVOGACAO_TICKS = 5;
const POL_MOTIVOS = {
  inatividade: "Sessão encerrada por inatividade. Entre de novo.",
  maxima:      "Sua sessão atingiu o tempo máximo. Entre de novo.",
  revogada:    "Sessões encerradas pela diretoria. Entre de novo.",
  encerrada:   "Sua sessão foi encerrada. Entre de novo.",
  mfa:         "Seu cargo exige autenticação em dois fatores. Entre de novo e conclua o cadastro do MFA."
};
let polSessao = Object.assign({}, POL_SESSAO_PADRAO);
let _polTimer = null, _polTicks = 0, _polSaindo = false, _polUltimaGravacao = 0;

function polStore(){ return lembrarAtivo() ? localStorage : sessionStorage; }
function polLer(chave){ try { return polStore().getItem(chave); } catch(_){ return null; } }
function polGravar(chave, valor){ try { polStore().setItem(chave, valor); } catch(_){} }
function polApagar(chave){ try { localStorage.removeItem(chave); sessionStorage.removeItem(chave); } catch(_){} }
function polSessaoLimpar(){ polApagar("cgl_login_em"); polApagar("cgl_ultima_atividade"); lembrarApagar(); }
function polIsento(){ return ehSomenteLeitura(); }

/* prazos da empresa; sem leitura (rede, RLS) ficam os padrões */
async function carregarPoliticaSessao(){
  try {
    const { data } = await sb.from("empresa_config")
      .select("sessao_inatividade_min,sessao_maxima_h,sessao_lembrar_dias,sessao_mfa_cargos").eq("id", 1).maybeSingle();
    if(data){
      polSessao = {
        inatividade_min: Number(data.sessao_inatividade_min) || POL_SESSAO_PADRAO.inatividade_min,
        maxima_h:        Number(data.sessao_maxima_h)        || POL_SESSAO_PADRAO.maxima_h,
        lembrar_dias:    Number(data.sessao_lembrar_dias)    || POL_SESSAO_PADRAO.lembrar_dias,
        mfa_cargos:      Array.isArray(data.sessao_mfa_cargos) ? data.sessao_mfa_cargos : POL_SESSAO_PADRAO.mfa_cargos
      };
    }
  } catch(_){}
  // "manter conectado" foi gravado no login com o prazo padrão; agora vale o prazo da empresa, contado do login
  const lembrar = lembrarLer();
  if(lembrar) lembrarGravar(polSessao.lembrar_dias, lembrar.desde);
}

function polMarcarAtividade(forcar){
  const agora = Date.now();
  if(!forcar && agora - _polUltimaGravacao < 5000) return;   // sem gravar a cada tecla
  _polUltimaGravacao = agora;
  polGravar("cgl_ultima_atividade", String(agora));
}

/* chamado em iniciarApp(). Devolve false quando um prazo já tinha estourado ao abrir (saiu para o login). */
function iniciarPoliticaSessao(){
  if(!polLer("cgl_login_em")) polGravar("cgl_login_em", String(Date.now()));
  if(polVigiar(true) === false) return false;
  polMarcarAtividade(true);
  if(_polTimer) return true;
  ["keydown", "pointerdown", "touchstart", "scroll"].forEach(ev =>
    document.addEventListener(ev, () => polMarcarAtividade(false), { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState !== "visible") return;
    if(polVigiar(false) === false) return;   // estourou enquanto a aba estava escondida
    polMarcarAtividade(true);
  });
  _polTimer = setInterval(() => polVigiar(false), POL_TICK_MS);
  return true;
}

/* a cada 60 s (e ao abrir, e ao voltar para a aba). Devolve false quando saiu. */
function polVigiar(naAbertura){
  if(!usuarioAtual || _polSaindo) return true;
  if(!naAbertura){
    _polTicks++;
    // em produção a verificação da fase 86 já chama a cada 5 min; em "dev" ela não roda
    if(_polTicks % POL_REVOGACAO_TICKS === 0 && !appVersaoAtiva()) verificarSessaoRevogada();
  }
  if(polIsento()) return true;
  const agora = Date.now();
  const ultima  = Number(polLer("cgl_ultima_atividade")) || agora;
  const loginEm = Number(polLer("cgl_login_em")) || agora;
  const limiteInat = ultima + polSessao.inatividade_min * 60000;
  const limiteMax  = loginEm + polSessao.maxima_h * 3600000;
  if(agora >= limiteInat){ sairPorPolitica("inatividade"); return false; }
  if(agora >= limiteMax){ sairPorPolitica("maxima"); return false; }
  const proximo = Math.min(limiteInat, limiteMax);
  if(proximo - agora <= POL_AVISO_MS) polFaixa(proximo === limiteInat ? "inatividade" : "maxima", proximo - agora);
  else polFaixaFechar();
  return true;
}

/* faixa no topo do viewport: mesmo lugar e mesma classe da faixa de versão (fase 86) */
function polFaixa(motivo, restaMs){
  let f = $("app-faixa-sessao");
  if(!f){
    f = document.createElement("div");
    f.id = "app-faixa-sessao";
    f.className = "aviso atencao faixa-versao";
    f.setAttribute("role", "status");
    f.innerHTML = '<span id="app-faixa-sessao-txt"></span><button type="button" class="btn-sec btn-sm" id="app-faixa-sessao-btn">Continuar</button>';
    f.querySelector("button").addEventListener("click", () => { polMarcarAtividade(true); polFaixaFechar(); });
    ($("app-viewport") || document.body).prepend(f);
  }
  const min = Math.max(1, Math.ceil(restaMs / 60000));
  const sujo = appFormSujo() ? " Você tem alterações não salvas: salve agora." : "";
  const txt = $("app-faixa-sessao-txt"), btn = $("app-faixa-sessao-btn");
  if(motivo === "inatividade"){
    txt.textContent = `Sua sessão encerra em ${min} min por inatividade.${sujo}`;
    btn.style.display = "";
  } else {
    txt.textContent = `Sua sessão atinge o limite de ${polSessao.maxima_h} h em ${min} min e será encerrada.${sujo}`;
    btn.style.display = "none";
  }
  f.style.display = "";
}
function polFaixaFechar(){ const f = $("app-faixa-sessao"); if(f) f.style.display = "none"; }

/* sai desta janela (signOut local: as outras janelas e aparelhos têm o próprio prazo) e volta ao login
   com o motivo. chamarSignOut = false quando o Supabase já avisou SIGNED_OUT. */
async function sairPorPolitica(motivo, chamarSignOut){
  if(_polSaindo) return;
  _polSaindo = true;
  appLimparSujo();
  sessaoGravar("cgl_saida_motivo", motivo);
  polSessaoLimpar();
  if(chamarSignOut !== false){ try { await sb.auth.signOut({ scope: "local" }); } catch(_){} }
  location.reload();
}

/* sessao_ok(): falso quando a sessão foi encerrada (por usuário ou geral) ou o usuário foi desativado */
async function verificarSessaoRevogada(){
  if(!usuarioAtual || _polSaindo) return;
  try {
    const loginEm = Number(polLer("cgl_login_em")) || null;
    const { data, error } = await sb.rpc("sessao_ok", { p_login_em: loginEm ? new Date(loginEm).toISOString() : null });
    if(error) return;   // rede ou erro: não derruba ninguém por isso
    if(data === false) sairPorPolitica("revogada");
  } catch(_){}
}

/* cargo em sessao_mfa_cargos sem aal2 → cadastro obrigatório. Devolve true quando o MFA foi exigido (a tela ficou
   travada até cadastrar, ou o usuário adiou dentro da carência e viu a faixa).
   Fase 99b: o cadastro acontece ANTES de entrar (iniciarApp espera esta promessa para carregar os dados) e há
   carência de empresa_config.mfa_carencia_dias (7) contada do primeiro login exigido (RPC mfa_carencia_status):
   dentro dela, "Depois" uma vez por dia e faixa com os dias restantes; vencida, não entra sem cadastrar. Sem a RPC
   (migration não aplicada) fica a regra da fase 87, sem carência. */
async function exigirMFAObrigatorio(perfil){
  if(!perfil || !(polSessao.mfa_cargos || []).includes(perfil.cargo)) return false;
  let nivel = null;
  try { const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); nivel = data || null; } catch(_){ return false; }
  if(!nivel || nivel.currentLevel === "aal2") return false;
  if(nivel.nextLevel === "aal2"){   // tem fator verificado mas entrou sem o desafio (não deveria): sai e pede de novo
    sairPorPolitica("mfa");
    return true;
  }
  return await mfaExigirComCarencia(perfil);   // fase 99b (fim do arquivo)
}

/* marcos da sessão e saída avisada pelo Supabase */
sb.auth.onAuthStateChange((evento, sessao) => {
  if(evento === "SIGNED_IN" && sessao && !polLer("cgl_login_em")) polGravar("cgl_login_em", String(Date.now()));
  if(evento === "SIGNED_OUT" && usuarioAtual && !_polSaindo) sairPorPolitica("encerrada", false);
});

/* na carga: a tela de login mostra por que a sessão anterior acabou */
(function avisarSaidaAnterior(){
  const m = sessaoLer("cgl_saida_motivo");
  if(!m) return;
  sessaoApagar("cgl_saida_motivo");
  if($("login-aviso")) aviso("login-aviso", POL_MOTIVOS[m] || POL_MOTIVOS.encerrada, "aviso");
})();

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

  // 5+6. Módulos operacionais e usuários — em paralelo (dependem só de obras,
  // já carregadas no passo 4; antes eram 4 ondas sequenciais de latência)
  const ehGestao = usuarioAtual && ["diretor","admin"].includes(usuarioAtual.cargo);
  await Promise.all([
    typeof carregarFuncionarios  === "function" ? carregarFuncionarios()  : null,
    typeof carregarRDO           === "function" ? carregarRDO()           : null,
    typeof carregarMovimentacoes === "function" ? carregarMovimentacoes() : null,
    typeof carregarChamados      === "function" ? carregarChamados(true)  : null,
    (ehGestao && typeof carregarUsuarios === "function") ? carregarUsuarios() : null
  ]);

  // 7. Atualiza dashboard e sugestões sequenciais
  await carregarDashboard();
  sugerirNumeros();

  // 8. Acessibilidade global (rótulos, aria-label, teclado nos clicáveis)
  iniciarAcessibilidade();
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
    // lote S45 (L4): estilo na classe .aviso-mfa (css/estilo.css), com tokens da paleta; antes era hex inline
    banner.innerHTML = `
      <div class="aviso-mfa">
        <strong>⚠ Segurança:</strong>
        Sua conta de administrador não tem autenticação em dois fatores (MFA) configurada.
        <button type="button" class="aviso-mfa-btn" onclick="abrirModalMFA()">Configurar agora</button>
        <button type="button" class="aviso-mfa-btn aviso-mfa-fechar" onclick="document.getElementById('mfa-aviso-banner').remove()">Fechar</button>
      </div>`;
    // Dentro do viewport (coluna flex de altura fixa): o banner ocupa espaço e o <main> encolhe.
    // Antes ia no <body>, empurrava a tela inteira para baixo e escondia o rodapé da sidebar.
    ($("app-viewport") || document.body).prepend(banner);
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
let _mfaObrigatorio = false;   // fase 87: cargo em sessao_mfa_cargos sem MFA cadastrado

async function abrirModalMFA(obrigatorio){
  const modal = $("modal-mfa");
  if(!modal) return;
  _mfaObrigatorio = obrigatorio === true;
  document.body.classList.toggle("mfa-obrigatorio", _mfaObrigatorio);
  if($("mfa-obrig-texto")) $("mfa-obrig-texto").style.display = _mfaObrigatorio ? "" : "none";
  if($("btn-mfa-cancelar")) $("btn-mfa-cancelar").textContent = _mfaObrigatorio ? "Sair" : "Cancelar";
  modal.style.display = "flex";
  const qrArea = $("mfa-qr-area");
  qrArea.innerHTML = '<p style="font-size:var(--txt-md);color:var(--txt-sutil);">Gerando QR code…</p>';
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
    qrArea.innerHTML = `<p style="color:red;font-size:var(--txt-md);">Erro: ${esc(err.message)}</p>`;
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
    _mfaObrigatorio = false;                               // fase 87: a sessão agora é aal2; menu liberado
    document.body.classList.remove("mfa-obrigatorio");
    mfaLiberarEntrada();                                   // fase 99b: iniciarApp segue e carrega os dados
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
  if(_mfaObrigatorio){ sairPorPolitica("mfa"); return; }   // fase 87: sem cadastrar não entra; "Sair" volta ao login
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

/* ====================== FASE 99b — MFA NO LOGIN COM CARÊNCIA (21/10/2026) ======================
   Decisão 3 do Bernardo (spec docs/specs/fase-99-seguranca-owasp.md): MFA obrigatório no login para os cargos de
   empresa_config.sessao_mfa_cargos (diretor, admin, rh, financeiro), com carência de mfa_carencia_dias (7).
   - iniciarApp espera exigirMFAObrigatorio(): o cadastro (QR + código) acontece antes de carregar os dados.
   - A carência conta do primeiro login em que o MFA foi exigido (RPC mfa_carencia_status, tabela mfa_carencias).
     Dentro dela o modal oferece "Depois (N dias)" uma vez por dia (localStorage cgl_mfa_adiado_<id> = hoje);
     nos outros logins do mesmo dia entra direto, com a faixa vermelha contando os dias. Vencida: sem "Depois",
     só cadastrar ou sair.
   - Quem já tem fator passa pelo desafio no login por senha e, desde esta fase, também ao reabrir a aba com a
     sessão guardada ("manter conectado"): mfaPrecisaDesafio() no começo de iniciarApp.
   - Operador, encarregado e mecânico (login por CPF) não estão na lista: nada muda para eles. */
let _mfaLiberarResolver = null;   // promessa em que iniciarApp espera o cadastro ou o "Depois"
let _mfaCarencia = null;          // retorno de mfa_carencia_status() deste login

async function mfaPrecisaDesafio(){
  try {
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return !!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2";
  } catch(_){ return false; }
}

/* null quando a RPC não existe ou falhou: vale a regra da fase 87 (sem carência) */
async function mfaLerCarencia(){
  try {
    const { data, error } = await sb.rpc("mfa_carencia_status");
    return error || !data ? null : data;
  } catch(_){ return null; }
}

function mfaChaveAdiado(){ return "cgl_mfa_adiado_" + (usuarioAtual?.id || ""); }
function mfaAdiadoHoje(){ try { return localStorage.getItem(mfaChaveAdiado()) === hojeISO(); } catch(_){ return false; } }
function mfaMarcarAdiado(){ try { localStorage.setItem(mfaChaveAdiado(), hojeISO()); } catch(_){} }
function mfaPrazoTxt(car){
  if(!car?.prazo) return "";
  const d = new Date(car.prazo);
  return isNaN(d) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function mfaDiasTxt(n){ return `${n} dia${n === 1 ? "" : "s"}`; }

async function mfaExigirComCarencia(perfil){
  const car = await mfaLerCarencia();
  _mfaCarencia = car;
  if(car && car.exige === false) return false;                   // a lista do banco não inclui o cargo
  if(car && car.tem_fator){ sairPorPolitica("mfa"); return true; } // fator cadastrado em outra aba: entra de novo com o desafio
  const emCarencia = !!car && car.vencida === false && Number(car.dias_restantes) > 0;
  if(emCarencia && mfaAdiadoHoje()){ mfaFaixaCarencia(car); return true; }
  return new Promise(resolve => {
    _mfaLiberarResolver = resolve;
    abrirModalMFA(true);
    mfaAjustarModal(car, emCarencia);
  });
}

function mfaAjustarModal(car, emCarencia){
  const txt = $("mfa-obrig-texto"), dep = $("btn-mfa-depois");
  const n = Number(car?.dias_restantes) || 0;
  if(txt){
    if(txt.dataset.padrao == null) txt.dataset.padrao = txt.textContent;
    txt.textContent = emCarencia
      ? `Seu cargo exige autenticação em dois fatores. Você pode adiar por mais ${mfaDiasTxt(n)} (até ${mfaPrazoTxt(car)}); depois disso o sistema só abre com o MFA cadastrado.`
      : (car?.vencida
        ? `O prazo para cadastrar a autenticação em dois fatores venceu em ${mfaPrazoTxt(car)}. Configure agora para entrar; sem o aplicativo autenticador à mão, use "Sair".`
        : txt.dataset.padrao);
  }
  if(dep){
    dep.style.display = emCarencia ? "" : "none";
    dep.textContent = `Depois (${mfaDiasTxt(n)})`;
  }
}

/* "Depois": fecha o modal, libera o menu e deixa entrar; amanhã o modal volta */
function mfaAdiar(){
  mfaMarcarAdiado();
  $("modal-mfa").style.display = "none";
  _mfaFactorId = null;
  _mfaObrigatorio = false;
  document.body.classList.remove("mfa-obrigatorio");
  mfaFaixaCarencia(_mfaCarencia);
  const f = _mfaLiberarResolver; _mfaLiberarResolver = null;
  if(f) f(true);
}

/* chamada por verificarCodigoMFA() quando o fator foi ativado */
function mfaLiberarEntrada(){
  const dep = $("btn-mfa-depois");
  if(dep) dep.style.display = "none";
  const f = _mfaLiberarResolver; _mfaLiberarResolver = null;
  if(f) f(true);
}

/* faixa da carência: mesmo lugar e mesma classe do banner de MFA do admin (id mfa-aviso-banner, que
   verificarCodigoMFA já remove ao concluir) */
function mfaFaixaCarencia(car){
  document.getElementById("mfa-aviso-banner")?.remove();
  const n = Number(car?.dias_restantes) || 0;
  const banner = document.createElement("div");
  banner.id = "mfa-aviso-banner";
  const box = document.createElement("div");
  box.className = "aviso-mfa";
  const forte = document.createElement("strong");
  forte.textContent = "⚠ Segurança:";
  box.append(forte, ` Seu cargo exige autenticação em dois fatores (MFA). Falta${n === 1 ? "" : "m"} ${mfaDiasTxt(n)} para cadastrar`
    + (mfaPrazoTxt(car) ? ` (até ${mfaPrazoTxt(car)})` : "") + "; depois disso o sistema só abre com o MFA. ");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "aviso-mfa-btn"; btn.textContent = "Configurar agora";
  btn.addEventListener("click", () => abrirModalMFA());
  const fechar = document.createElement("button");
  fechar.type = "button"; fechar.className = "aviso-mfa-btn aviso-mfa-fechar"; fechar.textContent = "Fechar";
  fechar.addEventListener("click", () => banner.remove());
  box.append(btn, " ", fechar);
  banner.append(box);
  ($("app-viewport") || document.body).prepend(banner);
}

$("btn-mfa-depois")?.addEventListener("click", mfaAdiar);

/* ====================== FASE 99b — KPIs FINANCEIROS POR CARGO ======================
   Decisão 4 do Bernardo (21/10/2026): ler o valor do que se lança (medição, obra: pode_ler_financeiro(), espelhado
   em podeVerValorObra) é diferente de ver os SOMATÓRIOS financeiros. Os somatórios (Sala de Comando: "Medido no
   período" e "A receber"; Medições: indicadores A receber / Vencidas / Recebido no mês e os da visão Caução;
   Equipamentos › Vendas: indicadores; Carteira: KPIs em R$) passam a financeiro e auditor, diretor sempre (o admin
   saiu em 21/10/2026 a pedido do Bernardo: somatório financeiro é só da diretoria e do financeiro):
   espelha pode_ver_kpi_financeiro() do banco. Engenheiro, assistente e comercial continuam vendo o valor de cada
   medição e obra.
   KPI_FIN_RESTRITO = false desliga a regra nova: cada tela volta à regra que tinha antes (o argumento). */
const KPI_FIN_RESTRITO = true;
function podeVerKpiFinanceiro(regraAnterior){
  if(!KPI_FIN_RESTRITO){
    if(typeof regraAnterior === "function") return !!regraAnterior();
    return typeof podeVerValorObra === "function" && podeVerValorObra();
  }
  return !!usuarioAtual && ["diretor", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}

/* ---------- fase 101 (#85): texto do documento → TAG do cadastro ----------
   "TAG 99", "TAG-99", "Máquina 107", "Equipamento 099", "EQP 66", "HC-66", "66-HC", "99 RZ" → { numero: "99", familia: "RZ"|null }.
   equipamentos.codigo é "NN-XX" (99-RZ, 55B-CM): o número casa com zeros à esquerda ignorados e, quando o texto traz a
   família (HC, RZ…), ela desempata. eqCasarTexto devolve { exato, proximo, candidatos } e NUNCA vincula sozinho: quem
   chama mostra a sugestão e a pessoa confirma (exato = o número bate; proximo = o número mais perto, de preferência entre
   as máquinas da obra). Usado na prévia do import do RDO. */
function eqNormalizarTexto(texto){
  const t = String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/\b(TAG|MAQUINA|MAQ|EQUIPAMENTO|EQUIP|EQP|EQ|PERFURATRIZ)\b\.?/g, " ").replace(/[º°#:]/g, " ").replace(/\bN[O]?\b\.?/g, " ").trim();
  // família antes (HC-66) ou depois (66-HC, 99 RZ) do número; letra colada ao número (55B) faz parte dele
  let m = t.match(/(?:^|[^0-9A-Z])([A-Z]{2,3})[\s\-./]*0*(\d{1,4})(?![0-9])/);
  if(m) return { numero: m[2].replace(/^0+(?=\d)/, "") || "0", familia: m[1] };
  m = t.match(/0*(\d{1,4})([A-Z](?![A-Z]))?(?:[\s\-./]+([A-Z]{2,3}))?/);
  if(!m) return { numero: null, familia: null };
  return { numero: ((m[1] || "") + (m[2] || "")).replace(/^0+(?=\d)/, "") || null, familia: m[3] || null };
}
function eqNumeroDoCodigo(codigo){
  const m = String(codigo || "").toUpperCase().match(/^0*(\d{1,4}[A-Z]?)[\s\-]*([A-Z]{1,3})?/);
  return m ? { numero: m[1].replace(/^0+(?=\d)/, ""), familia: m[2] || null } : { numero: null, familia: null };
}
function eqCasarTexto(texto, lista, preferidosIds){
  const vazio = { texto: texto || "", numero: null, familia: null, exato: null, proximo: null, candidatos: [] };
  const bruto = String(texto || "").trim();
  if(!bruto || !Array.isArray(lista) || !lista.length) return vazio;
  const pref = new Set(preferidosIds || []);
  const up = bruto.toUpperCase().replace(/\s+/g, "");
  // código ou código externo idêntico também é exato (mas continua sendo só sugestão)
  const igual = lista.find(e => [e.codigo, e.codigo_externo].filter(Boolean).some(c => String(c).toUpperCase().replace(/\s+/g, "") === up));
  const { numero, familia } = eqNormalizarTexto(bruto);
  if(igual) return { ...vazio, numero, familia, exato: igual, candidatos: [igual] };
  if(!numero) return { ...vazio, familia };
  const comNum = lista.map(e => ({ e, ...eqNumeroDoCodigo(e.codigo) })).filter(x => x.numero);
  const filtra = (arr, f) => { const r = arr.filter(f); return r.length ? r : arr; };
  let cands = comNum.filter(x => x.numero === numero);
  if(familia && cands.length > 1) cands = filtra(cands, x => x.familia === familia);
  if(cands.length > 1 && pref.size) cands = filtra(cands, x => pref.has(x.e.id));
  if(cands.length > 1) cands = filtra(cands, x => ["perfuratriz", "bate_estaca"].includes(x.e.tipo));
  if(cands.length === 1) return { ...vazio, numero, familia, exato: cands[0].e, candidatos: [cands[0].e] };
  if(cands.length > 1) return { ...vazio, numero, familia, candidatos: cands.map(x => x.e) };
  // sem número igual: o mais perto (primeiro entre as máquinas da obra, depois perfuratriz/bate-estaca, depois todas)
  const n = parseInt(numero, 10);
  const universo = [comNum.filter(x => pref.has(x.e.id)), comNum.filter(x => ["perfuratriz", "bate_estaca"].includes(x.e.tipo)), comNum].find(u => u.length) || [];
  const ord = universo.map(x => ({ ...x, d: Math.abs(parseInt(x.numero, 10) - n) + (familia && x.familia !== familia ? 0.5 : 0) }))
    .sort((a, b) => a.d - b.d);
  return { ...vazio, numero, familia, proximo: ord.length ? ord[0].e : null, candidatos: ord.slice(0, 3).map(x => x.e) };
}
/* "TAG-99 (exata)" / "107-RZ (mais próximo)" para a prévia; '' quando não há sugestão */
function eqSugestaoTxt(r){
  if(r && r.exato) return `${r.exato.codigo} (exata)`;
  if(r && r.proximo) return `${r.proximo.codigo} (mais próximo)`;
  return "";
}

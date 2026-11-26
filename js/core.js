







const SUPABASE_URL = "https://xiirduialyewpqkwsfxx.supabase.co";
const SUPABASE_KEY = "sb_publishable_uef7GgPhtV5SSp-281PtNA_fD3ajHN4";







const SESSAO_LEMBRAR_CHAVE = "cgl_lembrar";
function lembrarLer(){
  try {
    const r = JSON.parse(localStorage.getItem(SESSAO_LEMBRAR_CHAVE) || "null");
    if(r && r.ate && Date.now() < r.ate) return r;
    if(r) localStorage.removeItem(SESSAO_LEMBRAR_CHAVE);
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
      if(localStorage.getItem(k) != null) localStorage.removeItem(k);
      return sessionStorage.getItem(k);
    } catch(_){ return null; }
  },
  setItem(k, v){ try { (lembrarAtivo() ? localStorage : sessionStorage).setItem(k, v); } catch(_){} },
  removeItem(k){ try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch(_){} }
};
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storage: sessaoStorage } });






const _hashChegada = location.hash || "";


const _chegouPorConvite = /type=(invite|recovery|signup|magiclink)/.test(_hashChegada);


const _primeiroAcessoToken = (() => {
  const m = /^#primeiro-acesso=(.*)$/.exec(_hashChegada);
  if(!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return m[1].slice(0, 200).replace(/[.,;:!?)\]]+$/, "");
})();

window.addEventListener("hashchange", () => { if(location.hash.startsWith("#primeiro-acesso=")) location.reload(); });





async function consumirTokenDoHash(){
  const h = new URLSearchParams(_hashChegada.replace(/^#/, ""));
  const access_token  = h.get("access_token");
  const refresh_token = h.get("refresh_token");
  if(access_token && refresh_token){
    try {
      await sb.auth.setSession({ access_token, refresh_token });

      history.replaceState(null, "", location.pathname + location.search);
    } catch(e){   }
  }
}


let mapaClientes = {};
let mapaFornecedores = {};
let mapaObras = {};





let mapaObraEtiqueta = {};
function obraRotulo(o){
  if(!o) return "";
  const id = typeof o === "string" ? o : o.id;
  if(id && mapaObraEtiqueta[id]) return mapaObraEtiqueta[id];
  if(typeof o === "string") return (mapaObras && mapaObras[o]) || "";
  return o.codigo ? `${o.codigo} — ${o.nome || ""}`.trim() : "";
}

function obraEtiquetaMontar(o, cliente){
  const t = (v) => String(v == null ? "" : v).trim();
  const local = t(o.cidade) ? t(o.cidade) + (o.uf ? "/" + String(o.uf).toUpperCase() : "") : "";
  return [t(o.codigo), t(cliente), t(o.nome_projeto) || local].filter(Boolean).join(" · ");
}


const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const UNIDADES = ["un","pc","cx","kg","g","ton","m","m2","m3","l","ml","sc","par","rl","jg","km","vb","diária","mês","h"];


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
    recebida:  { label:"Recebida",  cor:"verde"    },
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

  equipamento: {
    disponivel:     { label:"Disponível",     cor:"verde"    },
    em_uso:         { label:"Em uso",         cor:"azul"     },
    em_manutencao:  { label:"Em manutenção",  cor:"ambar"    },
    inativo:        { label:"Inativo",        cor:"cinza"    },
    vendido:        { label:"Vendido",        cor:"cinza"    },
    vendido_reserva:   { label:"Vendido · reserva de domínio", cor:"ambar" },
    liberado_retirada: { label:"Vendido · liberado p/ retirada", cor:"azul" }
  },
  acessorio: {
    sem_avaliacao:      { label:"Sem avaliação",      cor:"cinza"    },
    sem_marcacao:       { label:"Sem marcação",       cor:"ambar"    },
    bom_estado:         { label:"Bom estado",         cor:"verde"    },
    precisa_manutencao: { label:"Precisa manutenção", cor:"ambar"    },
    em_manutencao:      { label:"Em manutenção",      cor:"azul"     },
    sucata:             { label:"Sucata",             cor:"vermelho" },
    baixado:            { label:"Baixado",            cor:"vermelho" },
    vendido:            { label:"Vendido",            cor:"cinza"    }
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

  viagem: {
    planejada:   { label:"Planejada",   cor:"cinza"    },
    em_transito: { label:"Em trânsito", cor:"ambar"    },
    concluida:   { label:"Concluída",   cor:"verde"    },
    cancelada:   { label:"Cancelada",   cor:"vermelho" }
  },

  nfe: {
    rascunho:    { label:"NF-e rascunho",    cor:"cinza"    },
    processando: { label:"NF-e processando", cor:"azul"     },
    autorizada:  { label:"NF-e autorizada",  cor:"verde"    },
    rejeitada:   { label:"NF-e rejeitada",   cor:"vermelho" },
    cancelada:   { label:"NF-e cancelada",   cor:"vermelho" },
    denegada:    { label:"NF-e denegada",    cor:"vermelho" },
    inutilizada: { label:"NF-e inutilizada", cor:"cinza"    }
  },

  nfse: {
    rascunho:    { label:"NFS-e rascunho",    cor:"cinza"    },
    processando: { label:"NFS-e processando", cor:"azul"     },
    autorizada:  { label:"NFS-e autorizada",  cor:"verde"    },
    rejeitada:   { label:"NFS-e rejeitada",   cor:"vermelho" },
    cancelada:   { label:"NFS-e cancelada",   cor:"vermelho" },
    substituida: { label:"NFS-e substituída", cor:"cinza"    }
  }
};


const CONDICAO_TEMPO = {
  bom:          "Bom",
  nublado:      "Nublado",
  chuva_fraca:  "Chuva fraca",
  chuva_forte:  "Chuva forte",
  impraticavel: "Impraticável"
};



const CLIMA_3 = { bom: "bom", nublado: "bom", chuva_fraca: "chuva", chuva_forte: "chuva", impraticavel: "impraticavel" };
const CLIMA_3_OPCOES = [["bom", "Bom", "bom"], ["chuva", "Chuva", "chuva_fraca"], ["impraticavel", "Impraticável", "impraticavel"]];
function climaOpcao(v){ return CLIMA_3[v] || ""; }
function climaOpcaoRotulo(v){ const o = CLIMA_3_OPCOES.find(x => x[0] === climaOpcao(v)); return o ? o[1] : ""; }
function climaGravar(opcao, atual){
  if(!opcao) return null;
  if(CLIMA_3[atual] === opcao) return atual;
  const o = CLIMA_3_OPCOES.find(x => x[0] === opcao);
  return o ? o[2] : null;
}


function climaDetalhe(v, auto){
  const a = auto && auto.valor ? auto : null;
  const base = a ? a.valor : v;
  if(!base) return "";
  const rot = (CONDICAO_TEMPO[base] || "").toLowerCase();
  const mm = a && a.chuva_mm != null && Number(a.chuva_mm) > 0 ? `${Number(a.chuva_mm).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm` : "";
  if(!a && CLIMA_3_OPCOES.some(o => o[2] === base)) return "";
  return [rot, mm].filter(Boolean).join(", ");
}

const RDO_DIA_ESTADO = { produtivo: { label: "Produtivo", cor: "verde" }, parcial: { label: "Parcial", cor: "ambar" }, improdutivo: { label: "Improdutivo", cor: "vermelho" } };
STATUS.rdo_dia = RDO_DIA_ESTADO;
function rdoDiaRegraTexto(d){
  if(!d) return "";
  const n = (x) => Number(x || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if(d.estado === "improdutivo") return "Nenhuma estaca executada no dia";
  if(d.regra === "parametro") return `${n(d.metros_dia)} m de ${n(d.minimo_dia_m)} m mínimos da obra`;
  return `Sem parâmetro na obra: ${n(d.metros_dia)} m e paradas de ${n(d.horas_paradas)} h (parcial a partir de ${n(d.limite_horas_parada)} h)`;
}





const CONTRATO_CATEGORIA = {
  prestacao_servico: "Prestação de serviços",
  locacao:           "Locação",
  assinatura:        "Assinatura",
  seguro:            "Seguro",
  fornecimento:      "Fornecimento",
  empreitada:        "Empreitada",
  consultoria:       "Consultoria",
  outro:             "Outro",
  venda_bem:         "Venda de bem"
};

const EQP_STATUS_VENDIDO = ["vendido", "vendido_reserva", "liberado_retirada"];
function bemVendido(e){ return !!e && (EQP_STATUS_VENDIDO.includes(e.status) || !!e.venda_id); }
const RECORRENCIA = {
  unica:      "Única",
  mensal:     "Mensal",
  trimestral: "Trimestral",
  semestral:  "Semestral",
  anual:      "Anual"
};
const INDICES_REAJUSTE = ["IPCA","IGP-M","INCC","IGP-DI","INPC","CDI"];


const $ = (id) => document.getElementById(id);
const brl = (v) => Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const num = (v) => Number(v||0).toLocaleString("pt-BR",{maximumFractionDigits:3});


function horasHM(h, opt){
  const t = Math.round(Number(h || 0) * 60);
  if(!t) return opt && opt.zero ? "0:00" : "—";
  const a = Math.abs(t);
  return `${t < 0 ? "−" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}


function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => (
    {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]
  ));
}


function dataBR(d){
  if(!d) return "—";
  const p = String(d).slice(0,10).split("-");

  return esc(p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d);
}





function dataLocalISO(d){
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
}
function hojeISO(){ return dataLocalISO(new Date()); }

function addDiasISO(n){
  const h = new Date();
  return dataLocalISO(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n));
}


function aviso(elId, msg, tipo){
  const el = $(elId);

  if(tipo === "erro" && typeof ehSomenteLeitura === "function" && ehSomenteLeitura()
     && /row-level security|permission denied|42501|sem permiss|não foi possível (salvar|gravar|abrir|mudar|excluir)/i.test(String(msg || "")))
    msg = "Usuário de revisão não grava.";
  el.textContent = msg;
  el.className = "aviso " + (tipo === "aviso" ? "atencao" : tipo);
  if(tipo === "ok") setTimeout(()=>{ el.className = "aviso"; }, 4000);
}


function preencherSelect(sel, itens, valor, texto, placeholder){
  const ph = placeholder != null ? `<option value="">${esc(placeholder)}</option>` : "";
  sel.innerHTML = ph + itens.map(i =>
    `<option value="${esc(i[valor])}">${esc(i[texto])}</option>`
  ).join("");
}


function opcoesStatus(grupo){
  return Object.entries(STATUS[grupo])
    .map(([v,o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("");
}


function tagStatus(grupo, valor){
  const o = (STATUS[grupo] || {})[valor];
  if(!o) return `<span class="tag cinza">${esc(valor||"—")}</span>`;
  return `<span class="tag ${esc(o.cor)}">${esc(o.label)}</span>`;
}




function tagSituacao(ativo){
  return ativo === false
    ? `<span class="tag cinza" title="Inativo">○ inativo</span>`
    : `<span class="tag verde" title="Ativo">● ativo</span>`;
}


function opcoesDe(obj){
  return Object.entries(obj)
    .map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
}


function montarSelects(){
  $("cli-uf").innerHTML = '<option value="">—</option>' +
    UFS.map(u=>`<option value="${esc(u.toLowerCase())}">${esc(u)}</option>`).join("");
  $("obr-uf").innerHTML = '<option value="">—</option>' +
    UFS.map(u=>`<option value="${esc(u.toLowerCase())}">${esc(u)}</option>`).join("");
  $("forn-uf").innerHTML = '<option value="">—</option>' +
    UFS.map(u=>`<option value="${esc(u.toLowerCase())}">${esc(u)}</option>`).join("");
  ["mov-origem-uf","mov-destino-uf"].forEach(id => {
    const el = $(id);
    if(el) el.innerHTML = '<option value="">—</option>' +
      UFS.map(u=>`<option value="${esc(u.toLowerCase())}">${esc(u)}</option>`).join("");
  });
  $("prod-unidade").innerHTML = UNIDADES.map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join("");
  $("orc-status").innerHTML = opcoesStatus("orcamento");
  $("con-status").innerHTML = opcoesStatus("contrato");
  $("obr-status").innerHTML = opcoesStatus("obra");
  $("med-status").innerHTML = opcoesStatus("medicao");
  $("con-categoria").innerHTML = opcoesDe(CONTRATO_CATEGORIA);
  $("con-recorrencia").innerHTML = opcoesDe(RECORRENCIA);
  $("lista-indices").innerHTML = INDICES_REAJUSTE.map(i=>`<option value="${esc(i)}">`).join("");

  $("obr-con-categoria").innerHTML = opcoesDe(CONTRATO_CATEGORIA);
  $("obr-con-status").innerHTML = opcoesStatus("contrato");
}



async function carregarClientesSelects(){
  const { data } = await sb.from("clientes").select("id,nome").order("nome");
  const lista = data || [];
  mapaClientes = {};
  lista.forEach(c => mapaClientes[c.id] = c.nome);
  ["orc-cliente","obr-cliente","con-cliente"].forEach(id=>{
    const el = $(id);
    if(el) preencherSelect(el, lista, "id", "nome", "— selecione —");
  });
  const op = $("obr-obra-para");
  if(op){ const v = op.value; preencherSelect(op, lista, "id", "nome", "— o próprio cliente —"); op.value = v; }
}


async function carregarFornecedoresSelects(){
  const { data } = await sb.from("fornecedores")
    .select("id,razao_social").eq("ativo",true).order("razao_social");
  const lista = data || [];
  mapaFornecedores = {};
  lista.forEach(f => mapaFornecedores[f.id] = f.razao_social);
  const el = $("con-fornecedor");
  if(el) preencherSelect(el, lista, "id", "razao_social", "— selecione —");
}



const CARGOS_RESP_OBRA = ["engenheiro", "assistente_engenharia", "diretor"];
async function carregarResponsaveis(){
  const { data } = await sb.from("profiles").select("id,nome,cargo").eq("ativo",true).order("nome");
  const lista = data || [];
  ["orc-responsavel","con-responsavel","orc-neg-resp"].forEach(id=>{
    const el = $(id);
    if(el) preencherSelect(el, lista, "id", "nome", "— não informado —");
  });
  const obr = $("obr-responsavel");
  if(obr) preencherSelect(obr, lista.filter(p => CARGOS_RESP_OBRA.includes(p.cargo)), "id", "nome", "— não informado —");
}


function sugerirNumeros(){
  const proximo = (tbId, prefixo) => {
    const el = $(tbId);
    if(!el) return prefixo + "0001";
    const linhas = el.querySelectorAll("tr").length;

    const temDados = el.querySelector(".vazio") ? 0 : linhas;
    return prefixo + String(temDados + 1).padStart(4,"0");
  };
  const orcNum = $("orc-numero");
  if(orcNum && !orcNum.value) orcNum.value = proximo("tab-orcamentos","ORC-");




}







const BOTAO_GRAVACAO_RE = /salvar|gravar|confirmar|aprovar|concluir|finalizar|enviar|registrar|lan[cç]ar|marcar|baixa|receber|entregar/i;

document.addEventListener("click", e => {
  document.querySelectorAll("details.ficha-mais[open]").forEach(d => {
    if(!d.contains(e.target) || e.target.closest(".ficha-mais-menu")) d.open = false;
  });
});
document.addEventListener("keydown", e => {
  if(e.key !== "Escape") return;
  document.querySelectorAll("details.ficha-mais[open]").forEach(d => { d.open = false; d.querySelector("summary")?.focus(); });
});
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





const MIME_POR_EXTENSAO = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword", xls: "application/vnd.ms-excel", txt: "text/plain", csv: "text/csv",
  dwg: "image/vnd.dwg", dxf: "image/vnd.dxf", zip: "application/zip"
};

function extensaoArquivo(file){
  const partes = String((file && file.name) || "").split(".");
  return (partes.length > 1 && (partes.pop().toLowerCase().match(/^[a-z0-9]{1,5}$/) || [])[0]) || "bin";
}

function mimeDoArquivo(file, ext){
  const e = ext || extensaoArquivo(file);
  if(MIME_POR_EXTENSAO[e]) return MIME_POR_EXTENSAO[e];
  return String((file && file.type) || "").toLowerCase() || "application/octet-stream";
}

function corpoComMime(file, mime){ return file.type === mime ? file : new Blob([file], { type: mime }); }

function ehErroDePermissao(err){
  const e = err || {};
  return e.code === "42501" || String(e.statusCode || "") === "403" || e.status === 403
    || /row-level security|permission denied/i.test(String(e.message || e.error || err || ""));
}



const IA_LIMITE_MS = 150000;

function iaInvocarComLimite(nome, body, msgTempo, limiteMs){
  let t = null;
  const tempo = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(msgTempo || "A leitura demorou demais. Exporte só as páginas do quadro de estacas e tente de novo.")), limiteMs || IA_LIMITE_MS);
  });
  return Promise.race([sb.functions.invoke(nome, { body }), tempo]).finally(() => clearTimeout(t));
}










const PDF_LOGO_SRC = "img/logo-cgl.png";
const PDF_SELO_SRC = "img/selo-iso9001.png";
const PDF_RODAPE_TEXTO = "CGL Fundações · Empresa certificada ISO 9001";
const PDF_SELO_MM = 16;
const PDF_BASE_MIN_MM = 25;
const PX_POR_MM = 96 / 25.4;







function pdfMargens(larguraMm, topoMm){
  const largPx = Math.round(larguraMm * PX_POR_MM);
  const altPx  = Math.floor((297 - topoMm - PDF_BASE_MIN_MM) * PX_POR_MM);
  const larg = largPx / PX_POR_MM;
  const alt  = (altPx + 0.04) / PX_POR_MM;
  const lado = (210 - larg) / 2;
  return { margem: [topoMm, lado, 297 - topoMm - alt, lado], largPx };
}


function pdfUrl(caminho){ return new URL(caminho, document.baseURI).href; }

function pdfCabecalhoHTML(titulo = "", subtitulo = ""){
  const logo = `<img src="${esc(pdfUrl(PDF_LOGO_SRC))}" alt="CGL Fundações" style="display:block;height:18mm;width:18mm;">`;
  if(!titulo && !subtitulo) return logo;
  return `<div style="display:flex;align-items:center;justify-content:center;gap:4mm;">${logo}<div style="text-align:left;">
    ${titulo ? `<div style="font-size:14px;font-weight:700;color:#111;">${esc(titulo)}</div>` : ""}
    ${subtitulo ? `<div style="font-size:10px;color:#444;margin-top:2px;">${esc(subtitulo)}</div>` : ""}
  </div></div>`;
}

function pdfRodapeHTML(){
  return `<div class="pdf-rodape" style="display:flex;align-items:center;justify-content:space-between;gap:4mm;margin-top:6mm;padding-top:2mm;border-top:1px solid #b4b4b4;font-family:Arial,Helvetica,sans-serif;font-size:8pt;color:#555;">
    <span>${esc(PDF_RODAPE_TEXTO)}</span>
    <img src="${esc(pdfUrl(PDF_SELO_SRC))}" alt="Selo ISO 9001" style="display:block;height:${PDF_SELO_MM}mm;width:${PDF_SELO_MM}mm;">
  </div>`;
}


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
    pdf.text(`Página ${i} de ${total}`, esq + pdf.getTextWidth(PDF_RODAPE_TEXTO) + 6, alt - 10);
    if(selo) pdf.addImage(selo, "PNG", xSelo, ySelo, PDF_SELO_MM, PDF_SELO_MM, "selo-iso9001", "FAST");
  }
}




async function pdfNovoDocumento(){
  if(typeof html2pdf === "undefined") throw new Error("Biblioteca html2pdf não carregada.");
  const el = document.createElement("div");
  el.style.cssText = "width:1px;height:1px;";
  const pdf = await html2pdf().set({
    margin: 0, image: { type: "png" }, html2canvas: { scale: 1, width: 1, height: 1, logging: false },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
  }).from(el).toPdf().get("pdf");
  pdf.addPage("a4", "portrait");
  pdf.deletePage(1);
  return pdf;
}




const _PDF_WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const _PDF_TROCAS = { "≥": ">=", "≤": "<=", "−": "-", "→": "->", "←": "<-", "✓": "X", "✔": "X", " ": " ", " ": " ",
  " ": " ", "\t": " ", "​": "", "\r": "" };
function pdfTextoWinAnsi(s){
  return String(s ?? "").normalize("NFC").replace(/[^\n\x20-\x7e\xa1-\xff]/g,
    c => c in _PDF_TROCAS ? _PDF_TROCAS[c] : (_PDF_WINANSI_EXTRA.includes(c) ? c : "?"));
}



async function pdfGerar(elemento, opcoes = {}){
  if(typeof html2pdf === "undefined") throw new Error("Biblioteca html2pdf não carregada.");
  const { margem, largPx } = pdfMargens(opcoes.largura || 190, opcoes.topo || 12);

  await pdfCarregarImagem(PDF_LOGO_SRC).catch(() => null);
  const selo = await pdfCarregarImagem(PDF_SELO_SRC, 300).catch(() => null);
  elemento.querySelectorAll(".pdf-rodape").forEach(n => n.remove());


  const temaAntes = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = "claro";
  try{
    await html2pdf().set({
      margin:      margem,
      filename:    opcoes.filename || "documento.pdf",
      image:       { type: "jpeg", quality: 0.95 },

      html2canvas: { scale: 2, useCORS: true, letterRendering: false, width: largPx },
      jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak:   { mode: ["css", "legacy"], avoid: ["tr", "p", "li", ".nao-quebrar"] }
    }).from(elemento).toPdf().get("pdf").then(pdf => pdfCarimbarRodape(pdf, selo, margem)).save();
  }finally{
    if(temaAntes) document.documentElement.dataset.theme = temaAntes;
    else delete document.documentElement.dataset.theme;
  }
}



async function lerTudo(montar, chave = "id"){
  const out = [];
  for(let de = 0; out.length === de; de += 1000){
    const q = [].concat(chave).reduce((b, c) => b.order(c), montar());
    const r = await q.range(de, de + 999);
    if(r.error) return { data: [], error: r.error };
    out.push(...(r.data || []));
  }
  return { data: out, error: null };
}



const MOTIVOS_REFURADA = [
  { valor: "obstrucao", rotulo: "Obstrução" }, { valor: "desmoronamento", rotulo: "Desmoronamento" }, { valor: "desvio_locacao", rotulo: "Desvio de locação" },
  { valor: "ferramenta_quebrou", rotulo: "Ferramenta quebrou" }, { valor: "maquina_parou", rotulo: "Máquina parou" }, { valor: "projeto_alterado", rotulo: "Projeto alterado" },
  { valor: "erro_operacional", rotulo: "Erro operacional" }, { valor: "teste", rotulo: "Teste" },
  { valor: "concreto", rotulo: "Concreto" }, { valor: "armacao", rotulo: "Armação" }, { valor: "outro", rotulo: "Outro" }
];
function motivoRefuradaLbl(v){ return (MOTIVOS_REFURADA.find(m => m.valor === v) || {}).rotulo || v || ""; }

const REFURO_COBRANCA = {
  pendente:        { label: "Aguarda decisão",    cor: "ambar" },
  cobrar:          { label: "Cobrar",             cor: "verde" },
  nao_cobrar:      { label: "Não cobrar",         cor: "cinza" },
  fora_de_medicao: { label: "Período já medido",  cor: "cinza" }
};
const REFURO_RESPONSABILIDADE = [{ valor: "cliente", rotulo: "Cliente" }, { valor: "terceiro", rotulo: "Terceiro" }, { valor: "cgl", rotulo: "CGL" }];
const REFURO_RESP_SUGERIDA = { concreto: "cliente", armacao: "cliente", projeto_alterado: "cliente",
  erro_operacional: "cgl", ferramenta_quebrou: "cgl", maquina_parou: "cgl" };
function refuroRespLbl(v){ return (REFURO_RESPONSABILIDADE.find(r => r.valor === v) || {}).rotulo || v || ""; }
function chipsMotivo(container, opcoes, valor, aoMudar){
  let atual = valor ?? null;
  container.setAttribute("role", "radiogroup");
  container.classList.add("chips-motivo");
  container.innerHTML = opcoes.map(o => `<button type="button" class="chip-motivo" role="radio" data-valor="${esc(o.valor)}">${esc(o.rotulo)}</button>`).join("");
  const botoes = [...container.querySelectorAll(".chip-motivo")];
  const pintar = () => {
    const temEscolha = botoes.some(b => b.dataset.valor === atual);
    botoes.forEach((b, i) => {
      const on = b.dataset.valor === atual;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on || (!temEscolha && i === 0) ? 0 : -1;
    });
  };
  const escolher = (b) => { atual = b.dataset.valor; pintar(); if(aoMudar) aoMudar(atual); };
  container.onclick = (e) => { const b = e.target.closest(".chip-motivo"); if(b && !b.disabled) escolher(b); };
  container.onkeydown = (e) => {
    const i = botoes.indexOf(document.activeElement);
    if(i < 0) return;
    let alvo = null;
    if(e.key === "ArrowRight" || e.key === "ArrowDown") alvo = botoes[(i + 1) % botoes.length];
    else if(e.key === "ArrowLeft" || e.key === "ArrowUp") alvo = botoes[(i - 1 + botoes.length) % botoes.length];
    else if(e.key === "Home") alvo = botoes[0];
    else if(e.key === "End") alvo = botoes[botoes.length - 1];
    else if(e.key === " " || e.key === "Enter"){ e.preventDefault(); escolher(botoes[i]); return; }
    if(!alvo) return;
    e.preventDefault(); alvo.focus(); escolher(alvo);
  };
  pintar();
  return { get valor(){ return atual; }, definir(v){ atual = v ?? null; pintar(); } };
}



const RASCUNHO_PREFIXO = "rascunho:";
function rascunhoChave(tipo, id){ return `${RASCUNHO_PREFIXO}${usuarioAtual?.id || "anon"}:${tipo}:${id || "novo"}`; }
function rascunhoGuardar(chave, dados){ try { sessionStorage.setItem(chave, JSON.stringify({ em: new Date().toISOString(), dados })); return true; } catch(_){ return false; } }
function rascunhoLer(chave){ try { const t = sessionStorage.getItem(chave); return t ? JSON.parse(t) : null; } catch(_){ return null; } }
function rascunhoApagar(chave){ try { sessionStorage.removeItem(chave); } catch(_){} }


const RASCUNHO_LOCAL_DIAS = 7;
function rascunhoGuardarLocal(chave, dados){ try { localStorage.setItem(chave, JSON.stringify({ em: new Date().toISOString(), dados })); return true; } catch(_){ return false; } }
function rascunhoLerLocal(chave){
  try {
    const t = localStorage.getItem(chave); if(!t) return null;
    const r = JSON.parse(t);
    if(!r || !r.em || Date.now() - new Date(r.em).getTime() > RASCUNHO_LOCAL_DIAS * 864e5){ localStorage.removeItem(chave); return null; }
    return r;
  } catch(_){ return null; }
}
function rascunhoApagarLocal(chave){ try { localStorage.removeItem(chave); } catch(_){} }

function rascunhoLimparTodos(){
  try { Object.keys(sessionStorage).filter(k => k.startsWith(RASCUNHO_PREFIXO)).forEach(k => sessionStorage.removeItem(k)); } catch(_){}
  try {
    const meu = `${RASCUNHO_PREFIXO}${usuarioAtual?.id || "anon"}:`;
    Object.keys(localStorage).filter(k => k.startsWith(RASCUNHO_PREFIXO)).forEach(k => { if(k.startsWith(meu)) localStorage.removeItem(k); else rascunhoLerLocal(k); });
  } catch(_){}
}

function rascunhoQuando(em){
  const d = new Date(em), hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return dataLocalISO(d) === hojeISO() ? hora : `${hora} de ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
}
function rascunhoPergunta(em, alteradoEm, deQue){
  const hora = iso => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const aviso = alteradoEm && new Date(alteradoEm) > new Date(em) ? `Atenção: o registro foi alterado no banco às ${hora(alteradoEm)}, depois desse rascunho. Restaurar traz o rascunho para a tela; ao salvar, ele substitui o que foi gravado.\n\n` : "";
  return `${aviso}Há um rascunho de ${hora(em)} ${deQue}, ainda não salvo.\n\nOK: restaurar o rascunho.\nCancelar: descartar.`;
}

function respTodos(principal, extras, nomeDe){
  return [...new Set([principal, ...(extras || [])].filter(Boolean))].map(id => nomeDe(id) || "(inativo)");
}
function respResumo(nomes){ return !nomes.length ? "" : nomes.length === 1 ? nomes[0] : `${nomes[0]} + ${nomes.length - 1}`; }
function respExtrasRender({ wrap, sel, extras, principal, funcs, pode, aoMudar }){
  const w = $(wrap), s = $(sel); if(!w || !s) return;
  const nomeDe = id => funcs.find(f => f.id === id)?.nome || "(inativo)";
  w.innerHTML = extras.filter(id => id !== principal).map(id => `<span class="mob-chip">${esc(nomeDe(id))}${pode ? ` <button type="button" class="forn-chip-x" data-id="${esc(id)}" title="tirar" aria-label="Tirar ${esc(nomeDe(id))}">×</button>` : ""}</span>`).join("") || `<span class="meta">nenhum</span>`;
  s.innerHTML = `<option value="">+ somar responsável…</option>` + funcs.filter(f => f.id !== principal && !extras.includes(f.id))
    .map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.funcao ? " · " + esc(f.funcao) : ""}</option>`).join("");
  s.disabled = !pode; s.style.display = pode ? "" : "none";
  s.onchange = () => { if(s.value) aoMudar([...extras, s.value]); };
  w.querySelectorAll("button[data-id]").forEach(b => b.addEventListener("click", () => aoMudar(extras.filter(x => x !== b.dataset.id))));
}



function debounce(fn, ms = 150){
  let t = null;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}








function ordenarTabela(colunas, estado){
  const chave = estado && estado.chave ? estado.chave : null;
  const dirOk = (d) => d === "desc" ? "desc" : "asc";
  let atual = { col: estado?.padrao?.col || null, dir: dirOk(estado?.padrao?.dir) };
  if(chave){
    try { const s = JSON.parse(sessionStorage.getItem(chave) || "null"); if(s && colunas[s.col]) atual = { col: s.col, dir: dirOk(s.dir) }; }
    catch(_e){   }
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
      return `<th class="th-ordena${esc(cls)}" data-ordena="${esc(col)}" aria-sort="${esc(s)}" tabindex="0" title="${esc(tit)}Clique para ordenar (de novo inverte)">${esc(rotulo)}</th>`;
    },
    alternar(col){
      if(!colunas[col]) return;
      atual = atual.col === col ? { col, dir: atual.dir === "asc" ? "desc" : "asc" } : { col, dir: dirOk(colunas[col].dirInicial) };
      if(chave){ try { sessionStorage.setItem(chave, JSON.stringify(atual)); } catch(_e){   } }
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

  const obs = new MutationObserver(muts => {
    for(const m of muts){
      m.addedNodes.forEach(n => { if(n.nodeType === 1){ marcarAcionaveis(n); rotularControles(n); } });
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("keydown", (ev) => {
    if(ev.key !== "Enter" && ev.key !== " ") return;
    const el = ev.target;
    if(!el || !el.matches || !el.matches(ACIONAVEIS)) return;
    if(el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT") return;
    ev.preventDefault();
    el.click();
  });
}








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


  if($("login-lembrar") && $("login-lembrar").checked) lembrarGravar(POL_SESSAO_PADRAO.lembrar_dias); else lembrarApagar();
  const { error } = await sb.auth.signInWithPassword({
    email: loginParaEmail($("login-email").value),
    password: $("login-senha").value
  });
  btn.disabled = false; btn.textContent = "Entrar";
  if(error){
    const m = (error.message||"").toLowerCase();
    if(m.includes("invalid login")) aviso("login-aviso", loginPareceCpf($("login-email").value) ? "CPF ou senha inválidos. Sem a senha, peça ao RH um link de acesso." : "E-mail ou senha inválidos.","erro");
    else if(m.includes("banned")) aviso("login-aviso","Seu usuário está desativado. Fale com a diretoria.","erro");
    else aviso("login-aviso","Falha no login: "+(error.message||"erro desconhecido"),"erro");
    return;
  }

  const { data: aalData } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if(aalData?.nextLevel === "aal2" && aalData?.currentLevel !== "aal2"){
    mostrarDesafioMFALogin();
    return;
  }
  iniciarApp();
});






$("btn-esqueci-senha")?.addEventListener("click", async ()=>{
  const email = $("login-email").value.trim().toLowerCase();

  if(loginPareceCpf(email) || emailEhLoginCpf(email)){
    aviso("login-aviso","Quem entra com o CPF não redefine a senha por e-mail: peça ao RH um link de acesso.","aviso");
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




async function paChamar(corpo){
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/primeiro-acesso`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify(Object.assign({ token: _primeiroAcessoToken }, corpo))
  });
  return resp.json().catch(() => ({}));
}

function paEstado(estado){
  $("pa-form").style.display = estado === "form" ? "" : "none";
  $("btn-pa-tentar").style.display = estado === "rede" ? "" : "none";
  $("btn-pa-entrar").style.display = estado === "invalido" || estado === "rede" ? "" : "none";
  if(estado === "invalido" || estado === "rede") $("pa-validade").textContent = "";
  if(estado === "conferindo") aviso("pa-aviso", "Conferindo o link…", "aviso");
}
function paLinkNaoVale(msg){
  $("pa-titulo").textContent = "Link de acesso";
  aviso("pa-aviso", msg || "Este link não vale mais. Peça outro ao RH.", "erro");
  paEstado("invalido");
}
async function paConferir(){
  paEstado("conferindo");
  let r;
  try { r = await paChamar({ acao: "conferir" }); }
  catch(_){ aviso("pa-aviso", "Sem conexão para conferir o link. Tente de novo; abrir o link não o gasta.", "erro"); paEstado("rede"); return; }
  if(r.ok){
    $("pa-titulo").textContent = r.primeiro_nome ? `Olá, ${r.primeiro_nome}. Crie sua senha` : "Crie sua senha";
    $("pa-validade").textContent = r.expira_em ? `Este link vale até ${dataHoraBR(r.expira_em)}.` : "";
    $("pa-aviso").textContent = ""; $("pa-aviso").className = "aviso";
    paEstado("form");
    $("pa-cpf").focus();
    return;
  }
  if(r.link_invalido){ paLinkNaoVale(r.error); return; }
  aviso("pa-aviso", r.error || "Não foi possível conferir o link agora. Tente de novo.", "erro");
  paEstado("rede");
}
function abrirPrimeiroAcesso(){
  $("form-login").style.display = "none";
  $("pa-tela").style.display = "";
  paConferir();
}
async function paCriarSenha(){
  const cpf = $("pa-cpf").value.replace(/\D/g, ""), senha = $("pa-senha").value, senha2 = $("pa-senha2").value;
  if(cpf.length !== 11){ aviso("pa-aviso", "Digite os 11 números do seu CPF.", "erro"); return; }
  if(senha.length < 8){ aviso("pa-aviso", "A senha precisa de pelo menos 8 caracteres.", "erro"); return; }
  if(senha !== senha2){ aviso("pa-aviso", "As senhas não conferem.", "erro"); return; }
  if(senha.replace(/\D/g, "") === cpf){ aviso("pa-aviso", "A senha não pode ser o próprio CPF.", "erro"); return; }
  let r;
  try { r = await paChamar({ acao: "criar_senha", cpf, senha }); }
  catch(_){ aviso("pa-aviso", "Sem conexão. A senha não foi criada, e o link continua valendo. Tente de novo.", "erro"); return; }
  if(r.link_invalido){ paLinkNaoVale(r.error); return; }
  if(!r.ok){ aviso("pa-aviso", r.error || "Não foi possível criar a senha. Tente de novo.", "erro"); return; }

  try { await sb.auth.signOut({ scope: "local" }); } catch(_){}
  $("pa-tela").style.display = "none";
  $("pa-senha").value = ""; $("pa-senha2").value = "";
  $("form-login").style.display = "";
  $("login-email").value = cpf;
  aviso("login-aviso", "Senha criada. Entre com seu CPF e a senha nova.", "ok");
  $("login-senha").focus();
}
$("pa-form").addEventListener("submit", (e) => {
  e.preventDefault();
  comBotaoTravado("btn-pa-criar", paCriarSenha);
});
$("btn-pa-tentar").addEventListener("click", paConferir);
$("btn-pa-entrar").addEventListener("click", () => location.replace(location.pathname + location.search));
$("btn-pa-ver-senha").addEventListener("click", () => {
  const inp = $("pa-senha");
  const oculto = inp.type === "password";
  inp.type = oculto ? "text" : "password";
  $("btn-pa-ver-senha").textContent = oculto ? "ocultar" : "mostrar";
});





const TEMA_CHAVE = "cgl-tema";
function temaAtual(){ return document.documentElement.dataset.theme === "escuro" ? "escuro" : "claro"; }

function aplicarTema(tema){
  const escuro = tema === "escuro";
  if(escuro) document.documentElement.dataset.theme = "escuro";
  else delete document.documentElement.dataset.theme;
  try{ localStorage.setItem(TEMA_CHAVE, escuro ? "escuro" : "claro"); }
  catch(_){   }
  temaSincronizarBotoes();
}
function temaSincronizarBotoes(){
  const escuro = temaAtual() === "escuro";
  const titulo = escuro ? "Mudar para o tema claro" : "Mudar para o tema escuro";
  document.querySelectorAll(".btn-tema").forEach(btn => {
    btn.setAttribute("aria-pressed", escuro ? "true" : "false");
    btn.title = titulo;
    btn.setAttribute("aria-label", titulo);

  });
}

function ligarTema(){
  document.querySelectorAll(".btn-tema").forEach(btn => {
    if(btn.dataset.temaLigado) return;
    btn.dataset.temaLigado = "1";
    btn.addEventListener("click", () => aplicarTema(temaAtual() === "escuro" ? "claro" : "escuro"));
  });
  temaSincronizarBotoes();
}
ligarTema();





const VAL_SENS_CHAVE = "cgl_valores_visiveis";
const VAL_SENS_ZONAS = ".ind, .dash-card, .sb-num, tfoot, #pat-conteudo, [data-val-sens]";
const VAL_SENS_FORA = ".val-sens, svg, option, select, textarea, script, style";
const VAL_SENS_RE = /(?:[-−+]\s*)?R\$\s*[-−]?\s*\d[\d.,]*(?:\s*(?:mil|mi)\b)?/g;
const VAL_SENS_TEM = /R\$\s*[-−]?\s*\d/;
let _valSensVisivel = false, _valSensPend = new Set(), _valSensRaf = 0;

function valSensTitulo(el){
  const t = el.getAttribute("title");
  if(t && t.includes("R$") && el.closest(VAL_SENS_ZONAS)){ el.dataset.valTitle = t; el.removeAttribute("title"); }
}
function valSensTexto(no){
  const pai = no.parentElement, s = no.nodeValue;
  if(!pai || !VAL_SENS_TEM.test(s) || pai.closest(VAL_SENS_FORA) || !pai.closest(VAL_SENS_ZONAS)) return;
  const frag = document.createDocumentFragment();
  let pos = 0;
  for(const m of s.matchAll(VAL_SENS_RE)){
    if(m.index > pos) frag.append(s.slice(pos, m.index));
    const barra = document.createElement("span");
    barra.className = "val-sens";
    barra.textContent = m[0];
    frag.append(barra);
    pos = m.index + m[0].length;
  }
  if(pos < s.length) frag.append(s.slice(pos));
  no.replaceWith(frag);
}
function valSensCobrir(no){
  if(!no.isConnected) return;
  if(no.nodeType === Node.TEXT_NODE){ valSensTexto(no); return; }
  if(no.nodeType !== Node.ELEMENT_NODE) return;
  valSensTitulo(no);
  no.querySelectorAll("[title]").forEach(valSensTitulo);
  const textos = [], w = document.createTreeWalker(no, NodeFilter.SHOW_TEXT);
  while(w.nextNode()) if(VAL_SENS_TEM.test(w.currentNode.nodeValue)) textos.push(w.currentNode);
  textos.forEach(valSensTexto);
}
const _valSensObs = new MutationObserver(lista => {
  lista.forEach(m => {
    if(m.type === "attributes") valSensTitulo(m.target);
    else if(m.type === "characterData") _valSensPend.add(m.target);
    else m.addedNodes.forEach(n => _valSensPend.add(n));
  });
  if(!_valSensPend.size || _valSensRaf) return;
  _valSensRaf = requestAnimationFrame(() => {
    const nos = [..._valSensPend];
    _valSensPend.clear();
    _valSensRaf = 0;
    nos.forEach(valSensCobrir);
  });
});
function valSensAplicar(visivel){
  _valSensVisivel = visivel;
  document.body.classList.toggle("valores-ocultos", !visivel);
  if(visivel){
    _valSensObs.disconnect();
    cancelAnimationFrame(_valSensRaf);
    _valSensRaf = 0;
    _valSensPend.clear();
    document.querySelectorAll("[data-val-title]").forEach(el => { el.setAttribute("title", el.dataset.valTitle); delete el.dataset.valTitle; });
  } else {
    valSensCobrir(document.body);
    _valSensObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title"] });
  }
  const btn = $("btn-val-sens");
  if(btn){
    const rotulo = visivel ? "Ocultar valores" : "Mostrar valores";
    btn.querySelector("span").textContent = rotulo;
    btn.title = rotulo;
    btn.setAttribute("aria-label", rotulo);
    btn.setAttribute("aria-pressed", String(visivel));
  }
}
function ligarValSens(){
  let visivel = false;
  try { visivel = sessionStorage.getItem(VAL_SENS_CHAVE) === "1"; } catch(_){}
  valSensAplicar(visivel);
  const trocar = v => {
    valSensAplicar(v);
    try { if(_valSensVisivel) sessionStorage.setItem(VAL_SENS_CHAVE, "1"); else sessionStorage.removeItem(VAL_SENS_CHAVE); } catch(_){}
  };
  $("btn-val-sens")?.addEventListener("click", () => trocar(!_valSensVisivel));

  document.addEventListener("click", e => { if(e.target.closest?.("[data-val-mostrar]")) trocar(true); });
}
ligarValSens();

$("btn-sair").addEventListener("click", async ()=>{
  appLimparSujo();
  _polSaindo = true;
  polSessaoLimpar();
  rascunhoLimparTodos();
  await sb.auth.signOut();
  location.reload();
});


let usuarioAtual = null;

async function iniciarApp(){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user) return;


  if(await mfaPrecisaDesafio()){ $("tela-app").style.display = "none"; $("tela-login").style.display = ""; mostrarDesafioMFALogin(); return; }




  const perfilCols = "id,nome,cargo,ativo,login_cpf,senha_provisoria,modulos_extras,modulos_extras_ate";


  let perfil = null, perfilErr = null;
  if(emailEhLoginCpf(user.email)){
    const rp = await sb.rpc("campo_meu_perfil");
    if(!rp.error && rp.data) perfil = rp.data;
  }
  if(!perfil) ({ data:perfil, error:perfilErr } = await sb.from("profiles")
    .select(perfilCols + ",funcionario:funcionarios!profiles_funcionario_id_fkey(funcao)").eq("id",user.id).single());
  if(perfilErr && (perfilErr.code === "PGRST200" || perfilErr.code === "42703")){
    ({ data:perfil, error:perfilErr } = await sb.from("profiles").select(perfilCols).eq("id",user.id).single());
  }
  if(perfilErr && perfilErr.code === "42703"){
    ({ data:perfil, error:perfilErr } = await sb.from("profiles").select("id,nome,cargo,ativo").eq("id",user.id).single());
  }



  if((perfil && perfil.ativo === false) || (!perfil && perfilErr?.code === "PGRST116")){
    await sb.auth.signOut();
    aviso("login-aviso","Seu usuário está desativado. Fale com a diretoria.","erro");
    return;
  }



  if(perfil?.cargo === "operador"){ location.replace("operador.html"); return; }
  const lnkCampo = $("lnk-modo-campo");
  if(lnkCampo) lnkCampo.hidden = !["encarregado", "engenheiro", "assistente_engenharia", "admin", "diretor"].includes(perfil?.cargo);


  _loginCpfDigitos = emailEhLoginCpf(user.email) ? String(user.email).split("@")[0] : null;
  const rotuloSemPerfil = _loginCpfDigitos ? "Funcionário" : user.email;
  usuarioAtual = perfil || { id:user.id, nome:rotuloSemPerfil, cargo:null, ativo:true };


  usuarioAtual.funcao = String(perfil?.funcionario?.funcao || "").trim() || null;
  const nome = !perfil ? rotuloSemPerfil
    : (perfil.login_cpf && usuarioAtual.funcao) ? (perfil.nome + " · " + usuarioAtual.funcao)
    : (perfil.nome + " · " + perfil.cargo);
  $("usr-nome").textContent = nome;



  const ehDiretorOuAdmin = perfil && ["diretor","admin"].includes(perfil.cargo);

  aplicarMenuPorCargo(perfil);
  ligarTema();

  $("tela-login").style.display = "none";
  $("tela-app").style.display = "flex";


  iniciarVerificacaoVersao();


  await carregarPoliticaSessao();
  if(!iniciarPoliticaSessao()) return;

  if(typeof astIniciarCobranca === "function") astIniciarCobranca();
  const mfaObrigatorio = await exigirMFAObrigatorio(perfil);


  if(ehDiretorOuAdmin && !mfaObrigatorio) verificarMFAAdmin();


  if(perfil?.senha_provisoria && !mfaObrigatorio) await exigirTrocaSenhaProvisoria();

  else if(_chegouPorConvite) abrirDefinirSenha();

  await carregarTudo();
  await appRestaurarTela();
}


function abrirDefinirSenha(){
  const m = $("senha-modal");
  if(m) m.style.display = "flex";
}





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
  if(_senhaProvisoriaResolver){
    const { error: rpcErr } = await sb.rpc("rh_login_marcar_senha_trocada");
    if(rpcErr) console.warn("rh_login_marcar_senha_trocada:", rpcErr.message);
    if(usuarioAtual) usuarioAtual.senha_provisoria = false;
    document.body.classList.remove("senha-provisoria");
    const r = _senhaProvisoriaResolver; _senhaProvisoriaResolver = null; r();
  }
  aviso("app-aviso","🔐 Senha definida. Use-a nos próximos acessos.","ok");
});



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



function semCodOdoo(txt){ return String(txt ?? "").replace(/^ODOO-\d+\s*[—·-]\s*/, ""); }
function prodTxt(p){
  if(!p) return "";
  const cod = String(p.codigo || "");
  return cod && !cod.startsWith("ODOO-") ? `${cod} — ${p.nome || ""}` : (p.nome || "");
}

function prodBuscaHtml(p, lista){
  const cod = String(p.codigo || "");
  const repetido = !!lista && lista.filter(x => x.nome === p.nome).length > 1;
  const mostra = cod && (!cod.startsWith("ODOO-") || repetido);
  return `<span title="${esc(cod)}">${mostra ? `<strong>${esc(cod)}</strong> — ` : ""}${esc(p.nome)}</span>`;
}


function ajudaTelaAtualizar(secEl){
  const btn = $("btn-ajuda-tela");
  if(!btn) return;
  const p = secEl ? secEl.querySelector(".ajuda-tela") : null;
  btn.hidden = !p;
  btn.setAttribute("aria-expanded", p && p.classList.contains("aberta") ? "true" : "false");
}
$("btn-ajuda-tela")?.addEventListener("click", () => {
  const p = document.querySelector(".secao.ativa .ajuda-tela");
  if(!p) return;
  const aberta = p.classList.toggle("aberta");
  $("btn-ajuda-tela").setAttribute("aria-expanded", aberta ? "true" : "false");
});


const MENU_RECOLHIDO_CHAVE = "cgl_menu_recolhido";
function menuRecolher(sim){
  const btn = $("btn-menu-recolher");
  if(!btn) return;
  $("tela-app")?.classList.toggle("menu-recolhido", sim);
  const txt = sim ? "Abrir o menu" : "Recolher o menu";
  btn.setAttribute("aria-pressed", sim ? "true" : "false");
  btn.setAttribute("aria-label", txt);
  btn.title = txt;

  document.querySelectorAll(".sidebar-nav button").forEach(b => { b.title = sim ? (b.querySelector("span")?.textContent || "").trim() : ""; });
}
try { menuRecolher(localStorage.getItem(MENU_RECOLHIDO_CHAVE) === "1"); } catch(_){}
$("btn-menu-recolher")?.addEventListener("click", () => {
  const sim = !$("tela-app")?.classList.contains("menu-recolhido");
  menuRecolher(sim);
  try { localStorage.setItem(MENU_RECOLHIDO_CHAVE, sim ? "1" : "0"); } catch(_){}
});

document.querySelector(".sidebar-nav")?.addEventListener("mouseover", ev => {
  const b = ev.target.closest("button");
  if(b) b.title = $("tela-app")?.classList.contains("menu-recolhido") ? (b.querySelector("span")?.textContent || "").trim() : "";
});



function ativarSecao(secao, b){
  if(document.body.classList.contains("mfa-obrigatorio")) return;
  if(document.body.classList.contains("senha-provisoria")) return;
  if(b){
    document.querySelectorAll(".sidebar-nav button").forEach(x=>{ x.classList.remove("ativo"); x.removeAttribute("aria-current"); });
    b.classList.add("ativo");
    b.setAttribute("aria-current", "page");
  }
  document.querySelectorAll(".secao").forEach(s=>s.classList.remove("ativa"));

  const secId = "sec-" + secao;
  const secEl = $(secId);
  if(secEl) secEl.classList.add("ativa");

  const av = $("app-aviso");
  if(av){ av.textContent = ""; av.className = "aviso"; }


  appLimparSujo();
  verificarVersaoApp(30000);

  if(secao === "estoque" && typeof carregarPosicaoEstoque === "function") carregarPosicaoEstoque();



  const spanText = b ? b.querySelector("span") : null;
  const h2 = secEl ? secEl.querySelector(":scope > h2:first-child") : null;
  const titulo = (h2 && h2.textContent.trim()) || (spanText && spanText.textContent.trim());

  if(titulo && $("app-trilha") && typeof uiBreadcrumb === "function") {
    const grupo = b ? (b.closest(".nav-grupo")?.getAttribute("aria-label") || "") : "";
    $("app-trilha").innerHTML = uiBreadcrumb([{ texto: grupo }, { texto: titulo }], { tituloId: "app-secao-titulo" });
  } else if(titulo && $("app-secao-titulo")) {
    $("app-secao-titulo").textContent = titulo;
  }
  ajudaTelaAtualizar(secEl);

  closeSidebar();
}

$("btn-pular-conteudo")?.addEventListener("click", ev=>{ ev.preventDefault(); $("app-conteudo")?.focus(); });
document.querySelectorAll(".sidebar-nav button").forEach(b=>{
  b.addEventListener("click", ()=> ativarSecao(b.dataset.secao, b));
});


const SECOES_SEM_MENU = { movimentacoes: () => podeVerMovimentacoes() };




const SECOES_COMERCIAIS = ["servicos", "orcamentos"];



function podeVerMovimentacoes(){
  return !!usuarioAtual && ["diretor", "admin", "logistica", "gestor_acessorios", "gestor_manutencao", "almoxarife", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}
function podeVerComercial(){
  return !!usuarioAtual && ["diretor", "comercial", "auditor"].includes(usuarioAtual.cargo);
}



function temModuloExtra(modulo){
  if(!usuarioAtual || !Array.isArray(usuarioAtual.modulos_extras) || !usuarioAtual.modulos_extras.includes(modulo)) return false;
  const ate = usuarioAtual.modulos_extras_ate;
  return !ate || String(ate).slice(0, 10) >= (typeof hojeISO === "function" ? hojeISO() : new Date().toISOString().slice(0, 10));
}


function podeVerOrcamentos(){ return podeVerComercial() || temModuloExtra("orcamentos") || temModuloExtra("orcamentos_leitura"); }



const SECOES_POR_MODULO_EXTRA = { orcamentos: "orcamentos", orcamentos_leitura: "orcamentos", compras: "compras" };
function secaoLiberadaPorExtra(secao){
  return Object.entries(SECOES_POR_MODULO_EXTRA).some(([modulo, sec]) => sec === secao && temModuloExtra(modulo));
}



function sstPodeOperar(){
  if(!usuarioAtual || ehSomenteLeitura()) return false;
  return ["diretor", "admin", "sesmt"].includes(usuarioAtual.cargo) || temModuloExtra("sesmt");
}
function podeVerSesmt(){ return sstPodeOperar() || (!!usuarioAtual && ["rh", "auditor"].includes(usuarioAtual.cargo)); }




function ehDiretoria(){ return !!usuarioAtual && ["diretor", "auditor"].includes(usuarioAtual.cargo); }


function ehSomenteLeitura(){ return !!usuarioAtual && usuarioAtual.cargo === "auditor"; }
function podeVerContasPagar(){
  return !!usuarioAtual && ["diretor", "admin", "financeiro", "comprador", "auditor"].includes(usuarioAtual.cargo);
}




function podeVerContratosReceita(){
  return !!usuarioAtual && (["diretor", "comercial", "financeiro", "auditor", "juridico"].includes(usuarioAtual.cargo) || temModuloExtra("orcamentos"));
}
function podeVerContratosDespesa(){ return podeVerContasPagar() || ehJuridico(); }




function ehJuridico(){ return !!usuarioAtual && usuarioAtual.cargo === "juridico"; }
function podeVerSomaContratos(){ return !!usuarioAtual && !ehJuridico(); }
function podeVerContratos(){ return podeVerContratosReceita() || podeVerContratosDespesa(); }



const APT_CARGOS_GRAVAM = {
  RP: ["diretor", "admin", "mecanico", "engenheiro", "gestor_acessorios", "gestor_manutencao", "logistica"],
  OS: ["diretor", "admin", "engenheiro", "mecanico", "gestor_frota", "logistica", "gestor_manutencao"],
  OF: ["diretor", "admin", "gestor_acessorios", "gestor_manutencao", "mecanico", "logistica", "engenheiro", "almoxarife"]
};
function podeVerApontamentos(){
  if(!usuarioAtual) return false;

  return ["auditor", "rh"].includes(usuarioAtual.cargo) || Object.values(APT_CARGOS_GRAVAM).some(l => l.includes(usuarioAtual.cargo));
}

function podeVerCentrosCusto(){
  return !!usuarioAtual && ["diretor", "admin", "financeiro", "comprador", "gestor_acessorios", "gestor_manutencao", "gestor_frota", "auditor"].includes(usuarioAtual.cargo);
}



function podeVerValorObra(){
  return !!usuarioAtual && ["diretor", "admin", "engenheiro", "assistente_engenharia", "comercial", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}



function podeVerCustoMO(){
  return podeVerValorObra() || (!!usuarioAtual && ["gestor_manutencao", "gestor_acessorios"].includes(usuarioAtual.cargo));
}
function brlMO(v){ return podeVerCustoMO() ? brl(v || 0) : "—"; }



async function anexarCustoMO(tipo, linhas){
  const lista = [].concat(linhas || []).filter(Boolean);
  if(!lista.length) return lista;
  const sel = "id,custo_horas,custo_real", mapa = new Map();
  if(lista.length > 300){
    const r = await lerTudo(() => sb.from("vw_custo_mo").select(sel).eq("tipo", tipo), "id");
    (r.data || []).forEach(x => mapa.set(x.id, x));
  } else {
    const ids = [...new Set(lista.map(x => x.id))], lotes = [];
    for(let i = 0; i < ids.length; i += 150) lotes.push(sb.from("vw_custo_mo").select(sel).eq("tipo", tipo).in("id", ids.slice(i, i + 150)));
    (await Promise.all(lotes)).forEach(r => (r.data || []).forEach(x => mapa.set(x.id, x)));
  }
  lista.forEach(x => { const c = mapa.get(x.id); x.custo_horas = c ? c.custo_horas : null; x.custo_real = c ? c.custo_real : null; });
  return lista;
}

async function moHorasSemValor(tipo, id, alvo){
  if(!id) return;
  const { data, error } = await sb.rpc("custo_mo_horas_sem_valor", { p_tipo: tipo, p_id: id });
  const el = document.getElementById(alvo);
  if(!el || error || !(Number(data) > 0)) return;
  el.textContent = `· ${num(data)} h sem custo (sem funcionário ou sem salário cadastrado)`;
}





function podeVerValorBem(){ return !!usuarioAtual && ["diretor", "financeiro", "auditor"].includes(usuarioAtual.cargo); }
function podeGravarValorBem(){ return !!usuarioAtual && ["diretor", "financeiro"].includes(usuarioAtual.cargo); }
function semValorBem(reg){ if(reg && typeof reg === "object"){ delete reg.valor_aquisicao; delete reg.data_aquisicao; } return reg; }





function podeVerEncontroContas(){
  return !!usuarioAtual && ["diretor", "admin", "engenheiro", "assistente_engenharia", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}
function podeVerPermutas(){
  return !!usuarioAtual && ["diretor", "admin", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}




function podeVerHorasRH(){
  return !!usuarioAtual && ["diretor", "admin", "engenheiro", "assistente_engenharia", "encarregado", "rh", "logistica", "auditor"].includes(usuarioAtual.cargo);
}


function podeVerPatrimonio(perfil){
  const p = perfil || usuarioAtual;
  return !!p && ["diretor", "auditor"].includes(p.cargo);
}



function podeEmitirFiscal(){
  return !!usuarioAtual && ["diretor", "gestor_acessorios", "gestor_manutencao", "financeiro", "logistica"].includes(usuarioAtual.cargo);
}


const SECOES_OCULTAS_POR_CARGO = {
  rh: ["medicoes", "acessorios", "reparos", "fabricacao", "equipamentos", "obras", "compras", "estoque", "separacoes", "produtos", "fornecedores", "clientes"],

  gestor_frota: ["acessorios", "reparos", "fabricacao", "medicoes"],

  auditor: ["usuarios"],



  auxiliar_almoxarifado: ["clientes", "fornecedores", "funcionarios", "servicos", "orcamentos", "contratos", "contaspagar", "centros",
    "carteira", "obras", "mobilizacoes", "equipamentos", "frota", "acessorios", "fabricacao", "medicoes", "rdo", "usuarios", "rhh"],



  gestor_manutencao: ["medicoes", "clientes"],

  juridico: ["medicoes", "contaspagar", "carteira", "centros", "funcionarios", "rhh"]
};


["admin", "engenheiro", "assistente_engenharia", "comercial", "financeiro", "comprador", "almoxarife", "auxiliar_almoxarifado",
 "gestor_acessorios", "gestor_frota", "gestor_manutencao", "mecanico", "encarregado", "operador", "rh", "sesmt", "logistica",
 "visualizador"].forEach(c => { (SECOES_OCULTAS_POR_CARGO[c] = SECOES_OCULTAS_POR_CARGO[c] || []).push("patrimonio"); });

function aplicarMenuPorCargo(perfil){
  const ehDiretorOuAdmin = !!perfil && ["diretor","admin"].includes(perfil.cargo);

  const navUsr = $("nav-usuarios");
  if(navUsr) navUsr.style.display = ehDiretorOuAdmin ? "" : "none";






  const navCart = $("nav-carteira");
  if(navCart) navCart.style.display = (perfil && ["diretor", "auditor"].includes(perfil.cargo)) ? "" : "none";



  SECOES_COMERCIAIS.forEach(s => {
    const b = document.querySelector(`.sidebar-nav button[data-secao="${s}"]`);
    if(b) b.style.display = (s === "orcamentos" ? podeVerOrcamentos() : podeVerComercial()) ? "" : "none";
  });



  const navCon = document.querySelector('.sidebar-nav button[data-secao="contratos"]');

  if(navCon) navCon.style.display = podeVerContratos() ? "" : "none";
  const navCap = document.querySelector('.sidebar-nav button[data-secao="contaspagar"]');
  if(navCap) navCap.style.display = podeVerContasPagar() ? "" : "none";
  const navCcu = document.querySelector('.sidebar-nav button[data-secao="centros"]');
  if(navCcu) navCcu.style.display = podeVerCentrosCusto() ? "" : "none";

  const navEcc = $("nav-encontro-contas");
  if(navEcc) navEcc.style.display = podeVerEncontroContas() ? "" : "none";

  const navApt = $("nav-apontamentos");
  if(navApt) navApt.style.display = podeVerApontamentos() ? "" : "none";

  const navRhh = $("nav-rhh");
  if(navRhh) navRhh.style.display = podeVerHorasRH() ? "" : "none";

  const navSst = $("nav-sesmt");
  if(navSst) navSst.style.display = podeVerSesmt() ? "" : "none";

  const navPat = $("nav-patrimonio");
  if(navPat) navPat.style.display = podeVerPatrimonio(perfil) ? "" : "none";


  const podeMob = typeof MOB_CARGOS_EDITAM !== "undefined" && !!perfil && MOB_CARGOS_EDITAM.includes(perfil.cargo);
  ["btn-mob-nova", "btn-obr-criar-mob"].forEach(id => { const b = $(id); if(b) b.style.display = podeMob ? "" : "none"; });



  (SECOES_OCULTAS_POR_CARGO[perfil?.cargo] || []).forEach(s => {
    if(secaoLiberadaPorExtra(s)) return;
    const b = document.querySelector(`.sidebar-nav button[data-secao="${s}"]`);
    if(b) b.style.display = "none";
  });


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

  if(b && b.style.display === "none"){ aviso("app-aviso", "Seu perfil não tem acesso a este módulo.", "erro"); return false; }
  if(b){ b.click(); return true; }

  if(SECOES_SEM_MENU[secao] && $("sec-" + secao)){
    if(!SECOES_SEM_MENU[secao]()){ aviso("app-aviso", "Seu perfil não tem acesso a este módulo.", "erro"); return false; }
    ativarSecao(secao, null);
    return true;
  }
  return false;
}







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




function linkCadastro(tipo, id, texto, titulo){
  const t = texto != null ? texto : "—";
  if(!id) return esc(t);
  return `<a href="#" class="link-cad" data-cad="${esc(tipo)}" data-cad-id="${esc(id)}" title="${esc(titulo)}">${esc(t)}</a>`;
}
function linkAcessorio(id, texto){ return linkCadastro("acessorio", id, texto, "Abrir a ficha da peça"); }
function linkEquipamento(id, texto){ return linkCadastro("equipamento", id, texto, "Abrir a ficha do equipamento"); }
function linkProduto(id, texto){ return linkCadastro("produto", id, texto, "Abrir o cadastro do produto"); }
function linkMovimentacao(id, texto){ return linkCadastro("movimentacao", id, texto, "Abrir a nota (documento da viagem)"); }
function linkReparo(id, texto){ return linkCadastro("reparo", id, texto, "Abrir o reparo"); }
function linkFabricacao(id, texto){ return linkCadastro("fabricacao", id, texto, "Abrir a ordem de fabricação"); }
function linkViagem(id, texto){ return linkCadastro("viagem", id, texto, "Abrir a viagem (Logística)"); }
function linkManutencao(id, texto){ return linkCadastro("manutencao", id, texto, "Abrir a OS de manutenção"); }
function linkSeparacao(id, texto){ return linkCadastro("separacao", id, texto, "Abrir a separação"); }


function linkDocumentoSaida(mov, vinculo){
  const v = vinculo || {};
  return v.tipo === "manutencao" ? linkManutencao(v.ref_id, v.numero)
    : v.tipo === "reparo" ? linkReparo(v.ref_id, v.numero)
    : v.tipo === "fabricacao" ? linkFabricacao(v.ref_id, v.numero)
    : v.tipo === "separacao" ? linkSeparacao(v.ref_id, v.numero)
    : esc(mov.documento || "");
}
async function carregarVinculosSaida(ids){
  const mapa = new Map(), lista = [...new Set(ids.filter(Boolean))];
  for(let i = 0; i < lista.length; i += 300){
    const { data, error } = await sb.from("vw_estoque_saida_vinculo").select("movimentacao_id,tipo,ref_id,numero").in("movimentacao_id", lista.slice(i, i + 300));
    if(error){ console.warn("vínculo das saídas:", error.message); return mapa; }
    (data || []).forEach(v => mapa.set(v.movimentacao_id, v));
  }
  return mapa;
}
const LINK_CAD_SECAO = { acessorio: "acessorios", equipamento: "equipamentos", produto: "produtos", movimentacao: "movimentacoes", reparo: "reparos", fabricacao: "fabricacao", viagem: "frota", manutencao: "manutencao", separacao: "separacoes" };
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

    for(let i = 0; i < 80 && !(typeof _aceCarregado !== "undefined" && _aceCarregado); i++) await new Promise(r => setTimeout(r, 250));
    abrirAcessorio(id);
  }
  else if(tipo === "equipamento" && typeof abrirEquipamento === "function") abrirEquipamento(id);
  else if(tipo === "produto" && typeof abrirProduto === "function") abrirProduto(id);
  else if(tipo === "movimentacao" && typeof abrirMovimentacao === "function") abrirMovimentacao(id);
  else if(tipo === "reparo" && typeof abrirReparo === "function") abrirReparo(id);
  else if(tipo === "fabricacao" && typeof abrirOrdemFabricacao === "function") abrirOrdemFabricacao(id);
  else if(tipo === "viagem" && typeof abrirViagem === "function") abrirViagem(id, null);
  else if(tipo === "manutencao" && typeof abrirManutencao === "function") abrirManutencao(id);
  else if(tipo === "separacao" && typeof abrirSeparacao === "function") abrirSeparacao(id);
}, true);







const CODIGOS_DOC = [
  { tipo: "pc", re: "PC-\\d{4}-\\d{5}", tabela: "pedidos_compra", coluna: "numero", titulo: "Abrir o pedido de compra",
    rotulo: "Pedido", abrir: async (id) => {
      if(!irParaSecao("compras")) return;
      if(typeof cmpCarregarBase === "function") await cmpCarregarBase(false);
      if(typeof abrirPedido === "function") await abrirPedido(id);
    } }
];

const _CODIGOS_DOC_RE = new RegExp("(?<![\\w-])(?:" + CODIGOS_DOC.map(p => "(" + p.re + ")").join("|") + ")(?![\\w-])", "g");
function linkificarCodigos(html){
  return String(html ?? "").replace(_CODIGOS_DOC_RE, (m, ...g) => {
    const p = CODIGOS_DOC[g.findIndex((v, i) => i < CODIGOS_DOC.length && v !== undefined)];
    if(!p) return m;

    return `<a href="#" class="link-cod" data-cod="${esc(p.tipo)}" data-cod-num="${  m}" title="${esc(p.titulo)}">${  m}</a>`;
  });
}
async function resolverCodigosDoc(caixa){
  if(!caixa) return;
  const porTipo = {};
  for(const el of caixa.querySelectorAll("a.link-cod[data-cod]")) (porTipo[el.dataset.cod] = porTipo[el.dataset.cod] || []).push(el);
  for(const [tipo, els] of Object.entries(porTipo)){
    const p = CODIGOS_DOC.find(x => x.tipo === tipo); if(!p) continue;
    const nums = [...new Set(els.map(el => el.dataset.codNum))];
    const { data, error } = await sb.from(p.tabela).select(`id,${p.coluna}`).in(p.coluna, nums);
    if(error){ console.warn("códigos de documento:", error.message); continue; }
    const ids = new Map((data || []).map(r => [r[p.coluna], r.id]));
    els.forEach(el => {
      const id = ids.get(el.dataset.codNum);
      if(id) el.dataset.codId = id;
      else el.replaceWith(document.createTextNode(el.textContent));
    });
  }
}
document.addEventListener("click", async (e) => {
  const a = e.target && e.target.closest ? e.target.closest("a.link-cod") : null;
  if(!a) return;
  e.preventDefault();
  e.stopPropagation();
  const p = CODIGOS_DOC.find(x => x.tipo === a.dataset.cod); if(!p) return;
  let id = a.dataset.codId;
  if(!id){
    const { data } = await sb.from(p.tabela).select("id").eq(p.coluna, a.dataset.codNum).maybeSingle();
    id = data?.id;
    if(!id){ aviso("app-aviso", `${p.rotulo} ${a.dataset.codNum} não encontrado.`, "erro"); return; }
  }
  if(typeof fecharChamado === "function" && $("cham-modal") && $("cham-modal").style.display !== "none") fecharChamado();
  await p.abrir(id);
}, true);



























const APP_VERSAO = (document.querySelector('meta[name="app-versao"]') || {}).content || "dev";
const APP_VERSAO_INTERVALO_MS = 5 * 60 * 1000;
const APP_VERSAO_OCIOSO_MS    = 10 * 60 * 1000;
const APP_VERSAO_CONTAGEM_S   = 5;
const APP_TELA_CHAVE          = "cgl_tela_antes_recarga";
const APP_TELA_VALIDADE_MS    = 10 * 60 * 1000;
let _appVersaoNova = null;
let _appVersaoUltimaConsulta = 0;
let _appVersaoTimerContagem = null;
let _appVersaoTimerVigia = null;
let _appVersaoIniciado = false;
let _appUltimaInteracao = Date.now();

function appVersaoAtiva(){ return APP_VERSAO !== "dev"; }


async function lerVersaoPublicada(){
  try {
    const r = await fetch("versao.json?ts=" + Date.now(), { cache: "no-store" });
    if(!r.ok) return null;
    const info = await r.json();
    return info && typeof info.versao === "string" && info.versao ? info : null;
  } catch(_){ return null; }
}


function dataHoraBR(iso){
  const d = iso ? new Date(iso) : null;
  if(!d || isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}




const CARGAS_ODOO_ORDENS = ["2026-10-19", "2026-10-20"];
function autorOrdemTexto(o, autor){
  if(!o || !o.id) return usuarioAtual?.nome ? `${usuarioAtual.nome} (ao salvar)` : "—";
  const dia = o.created_at ? dataLocalISO(new Date(o.created_at)) : "";
  if(o.codigo_externo || CARGAS_ODOO_ORDENS.includes(dia)) return "Importada do Odoo";
  if(autor && autor.nome) return `${autor.nome}${dia ? " em " + dataBR(dia) : ""}`;
  return "Autor não registrado";
}


function sessaoLer(chave){ try { return sessionStorage.getItem(chave); } catch(_){ return null; } }
function sessaoGravar(chave, valor){ try { sessionStorage.setItem(chave, valor); } catch(_){} }
function sessaoApagar(chave){ try { sessionStorage.removeItem(chave); } catch(_){} }


const APP_MODAIS = ".modal-fundo, #modal-mfa";
const APP_SUJO_IGNORAR = ".serv-filtros, .lista-topo, input[type=search]";
function appModalAberto(){
  return Array.from(document.querySelectorAll(APP_MODAIS)).some(m => getComputedStyle(m).display !== "none");
}
function appFormSujo(){ return document.body.dataset.sujo === "1"; }
function appMarcarSujo(){ document.body.dataset.sujo = "1"; }
function appLimparSujo(){ delete document.body.dataset.sujo; }

function appAvisoComErro(){
  return Array.from(document.querySelectorAll(".aviso.erro")).some(a => getComputedStyle(a).display !== "none");
}

function appTelaOciosa(){
  return document.visibilityState === "hidden" || Date.now() - _appUltimaInteracao >= APP_VERSAO_OCIOSO_MS;
}
function appPodeRecarregar(){ return appTelaOciosa() && !appModalAberto() && !appFormSujo(); }


const APP_ABAS_ATIVAS = "button[data-tab].ativo, button[data-tab].ativa, button[data-sub].ativo, button[data-sub].ativa, button[data-aba].ativa, button[data-aba].ativo";
function appVisivel(el){ return !!(el && el.offsetParent !== null); }
function appGuardarTela(){
  const sec = document.querySelector(".secao.ativa");
  if(!sec || !sec.id.startsWith("sec-")) return;
  const abas = Array.from(sec.querySelectorAll(APP_ABAS_ATIVAS)).filter(appVisivel).map(b => {
    const attr = b.hasAttribute("data-tab") ? "data-tab" : b.hasAttribute("data-sub") ? "data-sub" : "data-aba";
    const caixa = b.parentElement && b.parentElement.closest("[id]");
    return { caixa: caixa ? caixa.id : null, attr, valor: b.getAttribute(attr) };
  }).filter(a => a.caixa && a.valor);
  const fichaObra = $("obr-ficha");
  const obra = sec.id === "sec-obras" && typeof obraEditId !== "undefined" && obraEditId && appVisivel(fichaObra) ? obraEditId : null;
  const rola = $("app-conteudo");
  sessaoGravar(APP_TELA_CHAVE, JSON.stringify({
    usuario: usuarioAtual?.id || null, secao: sec.id.slice(4), abas, obra,
    rolagem: rola ? rola.scrollTop : 0, rolagemJanela: window.scrollY, em: Date.now()
  }));
}

async function appEsperarElemento(seletor, ms){
  const fim = Date.now() + ms;
  while(Date.now() < fim){
    const el = document.querySelector(seletor);
    if(appVisivel(el)) return el;
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
}

async function appRestaurarTela(){
  let t = null;
  try { t = JSON.parse(sessaoLer(APP_TELA_CHAVE) || "null"); } catch(_){}
  sessaoApagar(APP_TELA_CHAVE);
  if(!t || !t.secao || Date.now() - (t.em || 0) > APP_TELA_VALIDADE_MS) return;
  if(t.usuario && usuarioAtual?.id && t.usuario !== usuarioAtual.id) return;
  if(document.body.classList.contains("mfa-obrigatorio") || document.body.classList.contains("senha-provisoria")) return;
  if(t.secao !== "inicio" && !irParaSecao(t.secao)) return;
  try {
    if(t.obra && t.secao === "obras" && typeof abrirObra === "function") await abrirObra(t.obra);
    for(const a of t.abas || []){
      const valor = String(a.valor).replace(/["\\]/g, "\\$&");
      const b = await appEsperarElemento(`#${CSS.escape(a.caixa)} button[${a.attr}="${valor}"]`, 4000);
      if(b && !b.classList.contains("ativo") && !b.classList.contains("ativa")) b.click();
    }
  } catch(e){ console.warn("restaurar tela:", e.message); }

  requestAnimationFrame(() => {
    const rola = $("app-conteudo");
    if(rola && t.rolagem) rola.scrollTop = t.rolagem;
    if(t.rolagemJanela) window.scrollTo(0, t.rolagemJanela);
  });
}


async function verificarVersaoApp(minimoMs){
  if(!_appVersaoIniciado) return;
  if(minimoMs && Date.now() - _appVersaoUltimaConsulta < minimoMs) return;
  _appVersaoUltimaConsulta = Date.now();
  verificarSessaoRevogada();
  if(!appVersaoAtiva()) return;
  const info = await lerVersaoPublicada();
  if(!info || info.versao === APP_VERSAO) return;
  appAtualizacaoPendente(info);
}



function appRegistrarRecarga(info){
  sessaoGravar("cgl_versao_tentativa", JSON.stringify({ versao: info.versao, em: Date.now() }));
  sessaoGravar("cgl_versao_avisar", JSON.stringify({ de: APP_VERSAO, info }));
}

function appAtualizacaoPendente(info){
  if(_appVersaoNova){ _appVersaoNova = info; return; }
  let tentativa = null;
  try { tentativa = JSON.parse(sessaoLer("cgl_versao_tentativa") || "null"); } catch(_){}


  if(tentativa && tentativa.versao === info.versao && Date.now() - tentativa.em < APP_VERSAO_INTERVALO_MS) return;
  _appVersaoNova = info;
  appVersaoAvaliar();
  if(!_appVersaoTimerVigia) _appVersaoTimerVigia = setInterval(appVersaoAvaliar, 1000);
}


function appVersaoAvaliar(){
  if(!_appVersaoNova) return;
  if(appPodeRecarregar()){
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
    txt.textContent = appFormSujo() || appModalAberto()
      ? "Nova versão disponível. Salve o que está fazendo e clique em Atualizar; você volta para esta mesma tela."
      : "Nova versão disponível. Clique em Atualizar quando puder; você volta para esta mesma tela.";
    btn.textContent = "Atualizar";
  }
}

function appRecarregarAgora(){
  if(_appVersaoNova) appRegistrarRecarga(_appVersaoNova);
  appGuardarTela();
  location.reload();
}



function avisarVersaoAtualizada(){
  let reg = null;
  try { reg = JSON.parse(sessaoLer("cgl_versao_avisar") || "null"); } catch(_){}
  if(!reg || !reg.info) return;
  if(APP_VERSAO === reg.de) return;
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


function iniciarVerificacaoVersao(){
  if(_appVersaoIniciado) return;
  _appVersaoIniciado = true;
  avisarVersaoAtualizada();
  if(!appVersaoAtiva()) return;

  ["input", "change"].forEach(ev => document.addEventListener(ev, e => {
    const el = e.target;
    if(!el || !el.matches || !el.matches("input, select, textarea")) return;
    if(!el.closest("section, " + APP_MODAIS)) return;
    if(el.closest(APP_SUJO_IGNORAR)) return;
    appMarcarSujo();
  }, true));
  ["keydown", "pointerdown"].forEach(ev => document.addEventListener(ev, () => { _appUltimaInteracao = Date.now(); }, { capture: true, passive: true }));

  const obs = new MutationObserver(muts => {
    for(const m of muts){
      if(m.target.matches && m.target.matches(APP_MODAIS) && getComputedStyle(m.target).display === "none") appLimparSujo();
    }
  });
  document.querySelectorAll(APP_MODAIS).forEach(m => obs.observe(m, { attributes: true, attributeFilter: ["style", "class"] }));

  verificarVersaoApp();

  setInterval(() => { verificarVersaoApp(); if(typeof dashAtualizarBadgeMencoes === "function") dashAtualizarBadgeMencoes(); }, APP_VERSAO_INTERVALO_MS);
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState !== "visible"){ appVersaoAvaliar(); return; }
    _appUltimaInteracao = Date.now();
    if(_appVersaoTimerContagem){ clearInterval(_appVersaoTimerContagem); _appVersaoTimerContagem = null; appVersaoAvaliar(); }
    verificarVersaoApp(30000);
    if(typeof dashAtualizarBadgeMencoes === "function") dashAtualizarBadgeMencoes();
  });
}




(async function verificarVersaoNaCarga(){
  if(!appVersaoAtiva() || _chegouPorConvite || _primeiroAcessoToken !== null) return;
  const info = await lerVersaoPublicada();
  if(!info || info.versao === APP_VERSAO) return;
  let tentativa = null;
  try { tentativa = JSON.parse(sessaoLer("cgl_versao_tentativa") || "null"); } catch(_){}
  if(tentativa && tentativa.versao === info.versao) return;
  appRegistrarRecarga(info);
  location.replace(location.pathname + "?v=" + encodeURIComponent(info.versao) + location.hash);
})();























const POL_SESSAO_PADRAO = { inatividade_min: 240, maxima_h: 12, lembrar_dias: 7, mfa_cargos: ["diretor", "admin", "rh", "financeiro", "juridico"] };
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
function polSessaoLimpar(){
  polApagar("cgl_login_em"); polApagar("cgl_ultima_atividade"); lembrarApagar();
  try { sessionStorage.removeItem(VAL_SENS_CHAVE); } catch(_){}
}
function polIsento(){ return ehSomenteLeitura(); }


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

  const lembrar = lembrarLer();
  if(lembrar) lembrarGravar(polSessao.lembrar_dias, lembrar.desde);
}

function polMarcarAtividade(forcar){
  const agora = Date.now();
  if(!forcar && agora - _polUltimaGravacao < 5000) return;
  _polUltimaGravacao = agora;
  polGravar("cgl_ultima_atividade", String(agora));
}


function iniciarPoliticaSessao(){
  if(!polLer("cgl_login_em")) polGravar("cgl_login_em", String(Date.now()));
  if(polVigiar(true) === false) return false;
  polMarcarAtividade(true);
  if(_polTimer) return true;
  ["keydown", "pointerdown", "touchstart", "scroll"].forEach(ev =>
    document.addEventListener(ev, () => polMarcarAtividade(false), { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => {
    if(document.visibilityState !== "visible") return;
    if(polVigiar(false) === false) return;
    polMarcarAtividade(true);
  });
  _polTimer = setInterval(() => polVigiar(false), POL_TICK_MS);
  return true;
}


function polVigiar(naAbertura){
  if(!usuarioAtual || _polSaindo) return true;
  if(!naAbertura){
    _polTicks++;

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



async function sairPorPolitica(motivo, chamarSignOut){
  if(_polSaindo) return;
  _polSaindo = true;
  appLimparSujo();
  sessaoGravar("cgl_saida_motivo", motivo);
  rascunhoLimparTodos();
  polSessaoLimpar();
  if(chamarSignOut !== false){ try { await sb.auth.signOut({ scope: "local" }); } catch(_){} }
  location.reload();
}


async function verificarSessaoRevogada(){
  if(!usuarioAtual || _polSaindo) return;
  try {
    const loginEm = Number(polLer("cgl_login_em")) || null;
    const { data, error } = await sb.rpc("sessao_ok", { p_login_em: loginEm ? new Date(loginEm).toISOString() : null });
    if(error) return;
    if(data === false) sairPorPolitica("revogada");
  } catch(_){}
}







async function exigirMFAObrigatorio(perfil){
  if(!perfil || !(polSessao.mfa_cargos || []).includes(perfil.cargo)) return false;
  let nivel = null;
  try { const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); nivel = data || null; } catch(_){ return false; }
  if(!nivel || nivel.currentLevel === "aal2") return false;
  if(nivel.nextLevel === "aal2"){
    sairPorPolitica("mfa");
    return true;
  }
  return await mfaExigirComCarencia(perfil);
}


sb.auth.onAuthStateChange((evento, sessao) => {
  if(evento === "SIGNED_IN" && sessao && !polLer("cgl_login_em")) polGravar("cgl_login_em", String(Date.now()));
  if(evento === "SIGNED_OUT" && usuarioAtual && !_polSaindo) sairPorPolitica("encerrada", false);
});


(function avisarSaidaAnterior(){
  const m = sessaoLer("cgl_saida_motivo");
  if(!m) return;
  sessaoApagar("cgl_saida_motivo");
  if($("login-aviso")) aviso("login-aviso", POL_MOTIVOS[m] || POL_MOTIVOS.encerrada, "aviso");
})();


async function carregarTudo(){

  await Promise.all([
    carregarClientes(),
    carregarCategorias(),
    carregarFornecedores(),
    carregarListaFornecedores()
  ]);

  await carregarProdutos();


  await Promise.all([
    carregarClientesSelects(),
    carregarFornecedoresSelects(),
    carregarResponsaveis()
  ]);


  await Promise.all([
    carregarOrcamentos(),
    carregarContratos(),
    carregarObras(),
    carregarMedicoes()
  ]);



  const ehGestao = usuarioAtual && ["diretor","admin"].includes(usuarioAtual.cargo);
  await Promise.all([
    typeof carregarFuncionarios  === "function" ? carregarFuncionarios()  : null,
    typeof carregarRDO           === "function" ? carregarRDO()           : null,
    typeof carregarMovimentacoes === "function" ? carregarMovimentacoes() : null,
    typeof carregarChamados      === "function" ? carregarChamados(true)  : null,
    (ehGestao && typeof carregarUsuarios === "function") ? carregarUsuarios() : null
  ]);


  await carregarDashboard();
  sugerirNumeros();


  iniciarAcessibilidade();
}












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
      <div class="aviso-mfa">
        <strong>⚠ Segurança:</strong>
        Sua conta de administrador não tem autenticação em dois fatores (MFA) configurada.
        <button type="button" class="aviso-mfa-btn aviso-mfa-configurar">Configurar agora</button>
        <button type="button" class="aviso-mfa-btn aviso-mfa-fechar">Fechar</button>
      </div>`;

    banner.querySelector(".aviso-mfa-configurar").addEventListener("click", () => abrirModalMFA());
    banner.querySelector(".aviso-mfa-fechar").addEventListener("click", () => banner.remove());


    ($("app-viewport") || document.body).prepend(banner);
  } catch(_){}
}


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


let _mfaFactorId = null;
let _mfaObrigatorio = false;

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
        border:1px solid var(--borda);border-radius:6px;">${  qr}</div>`;
    } else {
      qrArea.innerHTML = `<img src="${esc(qr)}" alt="QR Code MFA"
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
    _mfaObrigatorio = false;
    document.body.classList.remove("mfa-obrigatorio");
    mfaLiberarEntrada();
  } catch(err){
    aviso("mfa-modal-aviso", err.message || "Código inválido. Tente novamente.","erro");
    btn.disabled = false;
    btn.textContent = "Verificar e ativar";
  }
}


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
  if(_mfaObrigatorio){ sairPorPolitica("mfa"); return; }
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












let _mfaLiberarResolver = null;
let _mfaCarencia = null;

async function mfaPrecisaDesafio(){
  try {
    const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return !!data && data.nextLevel === "aal2" && data.currentLevel !== "aal2";
  } catch(_){ return false; }
}


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
  if(car && car.exige === false) return false;
  if(car && car.tem_fator){ sairPorPolitica("mfa"); return true; }
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


function mfaLiberarEntrada(){
  const dep = $("btn-mfa-depois");
  if(dep) dep.style.display = "none";
  const f = _mfaLiberarResolver; _mfaLiberarResolver = null;
  if(f) f(true);
}



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










const KPI_FIN_RESTRITO = true;
function podeVerKpiFinanceiro(regraAnterior){
  if(!KPI_FIN_RESTRITO){
    if(typeof regraAnterior === "function") return !!regraAnterior();
    return typeof podeVerValorObra === "function" && podeVerValorObra();
  }
  return !!usuarioAtual && ["diretor", "financeiro", "auditor"].includes(usuarioAtual.cargo);
}







function eqNormalizarTexto(texto){
  const t = String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/\b(TAG|MAQUINA|MAQ|EQUIPAMENTO|EQUIP|EQP|EQ|PERFURATRIZ)\b\.?/g, " ").replace(/[º°#:]/g, " ").replace(/\bN[O]?\b\.?/g, " ").trim();

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

  const n = parseInt(numero, 10);
  const universo = [comNum.filter(x => pref.has(x.e.id)), comNum.filter(x => ["perfuratriz", "bate_estaca"].includes(x.e.tipo)), comNum].find(u => u.length) || [];
  const ord = universo.map(x => ({ ...x, d: Math.abs(parseInt(x.numero, 10) - n) + (familia && x.familia !== familia ? 0.5 : 0) }))
    .sort((a, b) => a.d - b.d);
  return { ...vazio, numero, familia, proximo: ord.length ? ord[0].e : null, candidatos: ord.slice(0, 3).map(x => x.e) };
}

function eqSugestaoTxt(r){
  if(r && r.exato) return `${r.exato.codigo} (exata)`;
  if(r && r.proximo) return `${r.proximo.codigo} (mais próximo)`;
  return "";
}

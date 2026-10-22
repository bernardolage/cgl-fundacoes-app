/* ====================================================================
   Módulo: Movimentações de Ativos
   Layout: padrão Serviços (painel + ficha) + Odoo (statusbar, header
   actions, notebook tabs). Ver memória feedback-padrao-ui.
   Fluxo: rascunho → emitida (com NF-e) → em_trânsito → recebida.
   Fase 105b: a NF-e de remessa/retorno sai pelo app (Focus NFe, function focus-nfe): Emitir NF-e, Simular, Consultar,
   DANFE, XML, Carta de correção, Cancelar NF-e e Inutilizar número. O status da nota (nf_status) e os campos mov-nf-*
   chegam pelo webhook e ficam só leitura; nota digitada à mão (UniNFe, contingência) continua editável. Itens de nota
   emitida pelo app não mudam (o banco também barra). Quem emite: podeEmitirFiscal().
   ==================================================================== */

let mapaEquipamentos = {};            // id -> equipamento
let _movRegistros    = [];            // cache da lista (para filtros client-side)
let _movView         = "lista";       // visão atual: lista | kanban
let movimentacaoAtual = null;         // edição em andamento
let itensAtuais      = [];            // linhas do grid
let _movObras        = [];            // obras (para vincular origem/destino e sugerir peças)
let _movObraMap      = {};            // id -> obra
let _movAceSug       = [];            // peças sugeridas no painel da aba Itens
let _movVoltarPara   = null;          // fase 89: "Voltar" devolve para quem abriu a nota (ficha da viagem, Documentos de Logística)
let _movNfeOk        = false;         // fase 105b: a migration da NF-e pelo app (nf_status) já está no banco
let _movNcmOk        = false;         // fase 105a: NCM nos cadastros de equipamento, acessório e produto
let _movFiscalItens  = {};            // fase 105b: "tipo:id" -> { ncm, ucom, sug, origem } dos itens da ficha
const MOV_EQ_PRODUCAO = ["perfuratriz","bate_estaca","escavadeira","retroescavadeira","guindaste"]; // TAG que "leva" acessório

const MOV_TIPOS = {
  remessa: "Remessa",
  retorno: "Retorno",
  transferencia: "Transferência",
  conserto: "Conserto",
  emprestimo: "Empréstimo",
  venda: "Venda",
  setup_inicial: "Setup inicial"
};

const MOV_STATUS = {
  rascunho:    { label: "Rascunho",    cor: "cinza"    },
  emitida:     { label: "Emitida",     cor: "azul"     },
  em_transito: { label: "Em trânsito", cor: "ambar"    },
  recebida:    { label: "Recebida",    cor: "verde"    },
  cancelada:   { label: "Cancelada",   cor: "vermelho" }
};

/* Ordem das etapas no statusbar (cancelada é "fora do fluxo") */
const STATUSBAR_STAGES = ["rascunho","emitida","em_transito","recebida"];

const LOC_TIPOS = {
  base: "Base",
  obra: "Obra",
  fornecedor_manutencao: "Fornecedor / manutenção",
  cliente: "Cliente",
  em_transito: "Em trânsito"
};

const FRETE_POR_CONTA = {
  remetente:    "Remetente",
  destinatario: "Destinatário",
  terceiro:     "Terceiro",
  proprio:      "Próprio CGL",
  sem_frete:    "Sem frete"
};

/* ---------- Carga inicial ---------- */
async function carregarMovimentacoes(){
  await Promise.all([carregarEquipamentosSelect(), carregarObrasMov()]);
  await fetchMovimentacoes();
  renderMovimentacoes();
}

async function carregarObrasMov(){
  const { data } = await sb.from("obras").select("id,codigo,nome,cidade,uf,status")
    .not("status", "in", "(cancelada)").order("codigo", { ascending: false });
  _movObras = data || [];
  _movObraMap = {};
  _movObras.forEach(o => {
    _movObraMap[o.id] = o;
    if(typeof mapaObras === "object" && mapaObras && !mapaObras[o.id]) mapaObras[o.id] = `${o.codigo} — ${o.nome}`;
  });
  ["mov-origem-obra","mov-destino-obra"].forEach(id => {
    const sel = $(id); if(!sel) return;
    const v = sel.value;
    preencherSelect(sel, _movObras.map(o => ({ id: o.id, txt: `${o.codigo} — ${o.nome}${o.status === "em_andamento" ? "" : " (" + o.status + ")"}` })), "id", "txt", "— escolha a obra —");
    sel.value = v;
  });
}
function movObraTxt(id){ const o = _movObraMap[id]; return o ? `${o.codigo} — ${o.nome}` : ""; }

async function carregarEquipamentosSelect(){
  const { data } = await sb.from("equipamentos")
    .select("id,codigo,nome,tipo,localizacao_tipo")
    .eq("ativo", true).order("codigo");
  mapaEquipamentos = {};
  (data||[]).forEach(e => mapaEquipamentos[e.id] = e);
}

async function fetchMovimentacoes(){
  if(!_movNfeOk && typeof fiscalColunaExiste === "function") _movNfeOk = await fiscalColunaExiste("movimentacoes_ativos", "nf_status");
  const { data, error } = await sb.from("movimentacoes_ativos")
    .select("id,numero,tipo,status,origem_tipo,origem_descricao,destino_tipo,destino_descricao,data_emissao,nf_numero,nf_chave_acesso,valor_total_produtos" + (_movNfeOk ? ",nf_status,nf_ambiente" : ""))
    .order("created_at", { ascending: false })
    .limit(500);
  _movRegistros = error ? [] : (data || []);
}

/* ---------- Filtros (client-side) ---------- */
function movFiltrados(){
  const termo = ($("mov-busca")?.value || "").trim().toLowerCase();
  const fStatus = $("mov-f-status")?.value || "";
  const fTipo   = $("mov-f-tipo")?.value || "";
  return _movRegistros.filter(m => {
    if(fStatus && m.status !== fStatus) return false;
    if(fTipo   && m.tipo !== fTipo)     return false;
    if(termo){
      const alvo = `${m.numero||""} ${m.nf_numero||""} ${m.origem_descricao||""} ${m.destino_descricao||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/* ---------- Despachante de visões ---------- */
function renderMovimentacoes(){
  const dados = movFiltrados();
  const cont = $("mov-contador");
  if(cont) cont.textContent = `${dados.length} de ${_movRegistros.length}`;
  if(_movView === "kanban") renderMovKanban(dados);
  else                      renderMovLista(dados);
}

/* ---------- Visão Lista ---------- */
function renderMovLista(dados){
  const cont = $("mov-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhuma movimentação encontrada.</p>`;
    return;
  }
  const linhas = dados.map(m => {
    const st = MOV_STATUS[m.status] || { label: m.status, cor: "cinza" };
    return `<tr class="linha-clicavel" data-id="${esc(m.id)}">
      <td>${esc(m.numero)}</td>
      <td>${esc(MOV_TIPOS[m.tipo] || m.tipo)}</td>
      <td>${esc(LOC_TIPOS[m.origem_tipo])}${m.origem_descricao ? " · " + esc(m.origem_descricao) : ""}</td>
      <td>${esc(LOC_TIPOS[m.destino_tipo])}${m.destino_descricao ? " · " + esc(m.destino_descricao) : ""}</td>
      <td>${dataBR(m.data_emissao)}</td>
      <td>${m.nf_numero ? esc(m.nf_numero) : "—"}${m.nf_status ? " " + tagStatus("nfe", m.nf_status) : ""}${m.nf_status && m.nf_ambiente === "homologacao" ? ' <span class="tag ambar" title="emitida em homologação: sem valor fiscal">homolog.</span>' : ""}</td>
      <td class="num">${brl(m.valor_total_produtos)}</td>
      <td><span class="tag ${st.cor}">${esc(st.label)}</span></td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Número</th><th>Tipo</th><th>Origem</th><th>Destino</th>
      <th>Emissão</th><th>NF</th><th class="num">Total</th><th>Status</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

/* ---------- Visão Kanban (colunas = status) ---------- */
function renderMovKanban(dados){
  const cont = $("mov-conteudo");
  if(!cont) return;
  const colunas = STATUSBAR_STAGES.concat(["cancelada"]).map(st => {
    const itens = dados.filter(m => m.status === st);
    if(!itens.length && st === "cancelada") return "";
    const stMeta = MOV_STATUS[st];
    const cards = itens.map(m => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(m.id)}">
        <div class="serv-kan-card-nome">${esc(m.numero)} · ${esc(MOV_TIPOS[m.tipo]||m.tipo)}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">→ ${esc(m.destino_descricao || LOC_TIPOS[m.destino_tipo])}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${m.nf_numero ? "NF " + esc(m.nf_numero) : dataBR(m.data_emissao)}</span>
          <strong>${brl(m.valor_total_produtos)}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  habilitarDragKanban({
    container: "#mov-conteudo .serv-kanban",
    tabela: "movimentacoes_ativos",
    onUpdate: async () => { await carregarMovimentacoes(); }
  });
}

/* ---------- Ficha (nova / editar) ---------- */
function novaMovimentacao(){
  movimentacaoAtual = {
    tipo: "remessa",
    status: "rascunho",
    origem_tipo: "base",
    origem_descricao: "Base Itabira",
    origem_uf: "mg",
    destino_tipo: "obra",
    destino_descricao: "",
    destino_uf: null,
    data_emissao: hojeISO(),
    frete_por_conta: "proprio"
  };
  itensAtuais = [];
  _movFiscalItens = {};
  mostrarFichaMovimentacao();
}

async function abrirMovimentacao(id){
  const { data: m, error } = await sb.from("movimentacoes_ativos")
    .select("*, viagem:viagens(id,numero,status)").eq("id", id).single();   // fase 89: a nota é documento da viagem
  if(error){ aviso("app-aviso","Erro ao abrir movimentação: "+error.message, "erro"); return; }
  const { data: itens, error: errItens } = await sb.from("movimentacao_itens")
    .select("*").eq("movimentacao_id", id).order("created_at");
  // Itens não carregaram → não abrir: salvar faz delete+insert e reinseriria vazio.
  if(errItens){
    aviso("app-aviso","Não foi possível carregar os itens da movimentação ("+errItens.message+"). Tente abrir de novo.","erro");
    return;
  }
  movimentacaoAtual = m;
  itensAtuais = itens || [];
  _movNfeOk = Object.prototype.hasOwnProperty.call(m, "nf_status");   // fase 105b: o select("*") já traz as colunas novas
  await movCarregarFiscalItens();
  if(movimentacaoAtual !== m) return;
  mostrarFichaMovimentacao();
}

function voltarParaLista(){
  movimentacaoAtual = null;
  itensAtuais = [];
  $("mov-painel").style.display = "";
  $("mov-ficha").style.display = "none";
  // fase 89: aberta de dentro da viagem (ou da visão Documentos de Logística) → volta para lá
  if(_movVoltarPara){ const f = _movVoltarPara; _movVoltarPara = null; f(); }
}

function mostrarFichaMovimentacao(){
  $("mov-painel").style.display = "none";
  $("mov-ficha").style.display = "";

  const m = movimentacaoAtual;

  // Form fields
  $("mov-tipo").value = m.tipo;
  $("mov-origem-tipo").value = m.origem_tipo || "base";
  $("mov-origem-descricao").value = m.origem_descricao || "";
  $("mov-origem-uf").value = m.origem_uf || "";
  $("mov-origem-obra").value = m.origem_obra_id || "";
  $("mov-destino-tipo").value = m.destino_tipo || "obra";
  $("mov-destino-descricao").value = m.destino_descricao || "";
  $("mov-destino-uf").value = m.destino_uf || "";
  $("mov-destino-obra").value = m.destino_obra_id || "";
  $("mov-data-emissao").value = m.data_emissao || hojeISO();
  $("mov-data-saida").value = m.data_saida || "";
  $("mov-data-recebimento").value = m.data_recebimento || "";
  $("mov-frete").value = m.frete_por_conta || "proprio";
  $("mov-transp-nome").value = m.transp_nome || "";
  $("mov-transp-cnpj").value = m.transp_cnpj || "";
  $("mov-transp-placa").value = m.transp_placa || m.placa_veiculo || "";
  $("mov-transp-ie").value = m.transp_ie || "";               // lote S46 (#88): dados completos da transportadora
  $("mov-transp-endereco").value = m.transp_endereco || "";
  $("mov-transp-municipio").value = m.transp_municipio || "";
  $("mov-transp-uf").value = m.transp_uf || "";
  if($("mov-transp-busca")) $("mov-transp-busca").value = "";
  $("mov-motorista").value = m.motorista || "";
  $("mov-nf-numero").value = m.nf_numero || "";
  $("mov-nf-serie").value = m.nf_serie || "1";
  $("mov-nf-chave").value = m.nf_chave_acesso || "";
  $("mov-nf-protocolo").value = m.nf_protocolo || "";
  $("mov-cfop").value = m.cfop || "";
  $("mov-natureza").value = m.natureza_operacao || "";
  $("mov-peso-bruto").value = m.peso_bruto_kg || "";
  $("mov-peso-liquido").value = m.peso_liquido_kg || "";
  $("mov-valor-produtos").value = m.valor_total_produtos || 0;
  $("mov-info-complementar").value = m.info_complementar || "";
  $("mov-observacoes").value = m.observacoes || "";

  // descrições padrão de uma movimentação nova podem ser trocadas pela obra escolhida
  ["origem","destino"].forEach(l => { $(`mov-${l}-descricao`).dataset.auto = m.id ? "0" : "1"; });
  toggleTransportadorVisivel();
  toggleObraCampos();
  popularSelectEquipamentos();
  movFecharBuscaAcessorio();
  renderizarItens();
  atualizarStatusbar();
  atualizarChipsContexto();
  atualizarBotoesAcao();
  movNfeAtualizar();   // fase 105b: statusbar fiscal, chip do ambiente, rejeição, campos travados, eventos
  // sempre abre na primeira aba
  ativarTab("cabecalho");
}

/* lote S46 (#88): transportadora pelo cadastro de fornecedores (razão social, fantasia ou CNPJ), no molde do
   cmpCampoFornecedor do S45. Escolher preenche razão social, CNPJ, IE e endereço; digitar direto nos campos continua
   valendo. Fornecedor escolhido sem categoria passa a "transportadora" (policy fornecedores_write: logística, gestor de
   acessórios, almoxarife, comprador e admin gravam; sem permissão, só preenche). */
let _movForns = null;
const movNorm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
async function movFornecedores(){
  if(_movForns) return _movForns;
  const { data, error } = await sb.from("fornecedores")
    .select("id,razao_social,nome_fantasia,cpf_cnpj,inscricao_estadual,logradouro,numero,complemento,bairro,cidade,uf,categoria")
    .eq("ativo", true).order("razao_social").limit(5000);
  if(error){ aviso("app-aviso", "Não foi possível ler os fornecedores: " + error.message, "erro"); return []; }
  _movForns = data || [];
  return _movForns;
}
async function movTranspEscolher(f){
  $("mov-transp-nome").value = f.razao_social || f.nome_fantasia || "";
  $("mov-transp-cnpj").value = f.cpf_cnpj || "";
  $("mov-transp-ie").value = f.inscricao_estadual || "";
  $("mov-transp-endereco").value = [[f.logradouro, f.numero].filter(Boolean).join(", "), f.complemento, f.bairro].filter(Boolean).join(" · ");
  $("mov-transp-municipio").value = f.cidade || "";
  $("mov-transp-uf").value = String(f.uf || "").toLowerCase();
  $("mov-transp-busca").value = "";
  if(!String(f.categoria || "").trim()){
    const { data, error } = await sb.from("fornecedores").update({ categoria: "transportadora" }).eq("id", f.id).is("categoria", null).select("id");
    if(!error && (data || []).length) f.categoria = "transportadora";
  }
}
function ligarBuscaTransportadora(){
  const ufSel = $("mov-transp-uf");
  if(ufSel && !ufSel.options.length) ufSel.innerHTML = `<option value="">—</option>` + UFS.map(u => `<option value="${u.toLowerCase()}">${u}</option>`).join("");
  const inp = $("mov-transp-busca"), lista = $("mov-transp-lista");
  if(!inp || !lista || inp.dataset.ligado) return;
  inp.dataset.ligado = "1";
  const fechar = () => { lista.style.display = "none"; lista.innerHTML = ""; };
  let achados = [];
  inp.addEventListener("input", debounce(async () => {
    const t = movNorm(inp.value.trim()), dig = t.replace(/\D/g, "");
    if(t.length < 2){ fechar(); return; }
    const forns = await movFornecedores();
    const ehTransp = (f) => movNorm(f.categoria).includes("transport") ? 0 : 1;   // transportadoras primeiro
    achados = forns.filter(f => movNorm(f.razao_social).includes(t) || movNorm(f.nome_fantasia).includes(t)
      || (dig.length >= 3 && String(f.cpf_cnpj || "").replace(/\D/g, "").includes(dig)))
      .sort((a, b) => ehTransp(a) - ehTransp(b)).slice(0, 25);
    lista.innerHTML = achados.length
      ? achados.map(f => `<div class="resultado-item" data-id="${esc(f.id)}"><strong>${esc(f.razao_social)}</strong>${f.nome_fantasia && f.nome_fantasia !== f.razao_social ? ` <span class="meta">${esc(f.nome_fantasia)}</span>` : ""}<span class="meta" style="float:right;">${esc([f.cpf_cnpj, f.cidade, f.categoria].filter(Boolean).join(" · "))}</span></div>`).join("")
      : `<div class="resultado-item vazio">Nenhum fornecedor com esse nome ou CNPJ. Preencha os campos abaixo ou cadastre em Fornecedores.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("mousedown", ev => {
      ev.preventDefault(); fechar();
      const f = achados.find(x => x.id === d.dataset.id); if(f) movTranspEscolher(f);
    }));
  }, 150));
  inp.addEventListener("keydown", ev => {
    if(ev.key === "Enter"){ ev.preventDefault(); if(achados[0] && lista.style.display !== "none"){ fechar(); movTranspEscolher(achados[0]); } }
    if(ev.key === "Escape") fechar();
  });
  inp.addEventListener("blur", () => setTimeout(fechar, 150));
}

function toggleTransportadorVisivel(){
  const tipo = $("mov-frete").value;
  $("bloco-transportador").style.display = (tipo === "terceiro") ? "" : "none";
}

/* ---------- Statusbar + chips ---------- */
/* Origem/destino do tipo obra ou cliente ganham o select de obra (é o vínculo que faz as peças
   e a TAG "saberem" em que obra estão ao receber). */
function toggleObraCampos(){
  ["origem","destino"].forEach(lado => {
    const tipo = $(`mov-${lado}-tipo`).value;
    const mostra = tipo === "obra" || tipo === "cliente";
    $(`mov-${lado}-obra-campo`).style.display = mostra ? "" : "none";
    if(!mostra) $(`mov-${lado}-obra`).value = "";
  });
  movAtualizarSugestao();
}
function movObraEscolhida(lado){
  const id = $(`mov-${lado}-obra`).value;
  const o = _movObraMap[id];
  if(o){
    const desc = $(`mov-${lado}-descricao`);
    if(!desc.value.trim() || desc.dataset.auto === "1"){ desc.value = `${o.codigo} — ${o.nome}`; desc.dataset.auto = "1"; }
    const uf = $(`mov-${lado}-uf`);
    if(o.uf && !uf.value) uf.value = String(o.uf).toLowerCase();
  }
  movAtualizarSugestao();
}
/* usado pela aba Movimentações da obra (atalho "remessa/retorno para esta obra") */
function movDefinirObra(lado, obraId){
  const tipoSel = $(`mov-${lado}-tipo`);
  if(tipoSel.value !== "obra" && tipoSel.value !== "cliente") tipoSel.value = "obra";
  toggleObraCampos();
  $(`mov-${lado}-obra`).value = obraId || "";
  movObraEscolhida(lado);
}

function atualizarStatusbar(){
  const sb = $("mov-statusbar");
  if(!sb) return;
  const st = movimentacaoAtual.status;
  const idxAtual = STATUSBAR_STAGES.indexOf(st);
  sb.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    el.removeAttribute("aria-current");
    const idx = STATUSBAR_STAGES.indexOf(el.dataset.status);
    if(st === "cancelada"){
      // tudo cinza, último marcado vermelho
      if(idx === STATUSBAR_STAGES.length - 1){ el.classList.add("cancelada"); el.setAttribute("aria-current", "step"); }
    } else if(idx === idxAtual){
      el.classList.add("atual");
      el.setAttribute("aria-current", "step");
    } else if(idx < idxAtual){
      el.classList.add("passada");
    }
  });
}

function atualizarChipsContexto(){
  const m = movimentacaoAtual;
  $("mov-ficha-numero").textContent = m.numero || "(novo)";
  $("mov-ficha-tipo-chip").textContent = MOV_TIPOS[m.tipo] || m.tipo || "—";
  $("mov-ficha-origem-chip").textContent = m.origem_descricao || LOC_TIPOS[m.origem_tipo] || "—";
  $("mov-ficha-destino-chip").textContent = m.destino_descricao || LOC_TIPOS[m.destino_tipo] || "—";
  $("mov-ficha-nf-chip").textContent = m.nf_numero ? `${m.nf_numero}/${m.nf_serie || "1"}` : "—";
  $("mov-ficha-total-chip").textContent = brl(m.valor_total_produtos || 0);
  // fase 89: viagem que leva esta nota (link para a ficha em Logística); nota solta se vincula na visão Documentos
  const vc = $("mov-ficha-viagem-chip");
  if(vc) vc.innerHTML = m.viagem ? `${typeof linkViagem === "function" ? linkViagem(m.viagem.id, m.viagem.numero) : esc(m.viagem.numero)}${m.interna ? ' <span class="meta">(itens da viagem)</span>' : ""}` : (m.viagem_id ? "viagem" : '<span class="meta" title="vincule na visão Documentos de Logística">sem viagem</span>');
}

/* ---------- Notebook (abas internas) ---------- */
function ativarTab(nome){
  document.querySelectorAll("#mov-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll(".odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Grid de itens ---------- */
function renderizarItens(){
  const tb = $("mov-itens");
  if(!itensAtuais.length){
    tb.innerHTML = `<tr><td colspan="7" class="vazio">Adicione equipamentos, produtos ou acessórios abaixo.</td></tr>`;
    atualizarTotal();
    movAtualizarSugestao();
    return;
  }
  const trava = movItensTravados();   // fase 105b: itens de NF-e emitida pelo app não mudam
  const origemTxt = o => (typeof FISCAL_ITEM_ORIGEM === "object" && FISCAL_ITEM_ORIGEM[o]) || o || "";
  tb.innerHTML = itensAtuais.map((it, idx) => {
    const fis = movItemFiscal(it);
    const [tipoMestre, idMestre] = movItemChave(it);
    const ncm = fis.ncm ? (typeof ncmFormatar === "function" ? ncmFormatar(fis.ncm) : fis.ncm) : "";
    const ncmCel = !_movNcmOk ? '<span class="meta">—</span>'
      : ncm ? esc(ncm)
      : `<a href="#" class="mov-sem-ncm txt-perigo" data-tipo="${esc(tipoMestre)}" data-id="${esc(idMestre)}" title="Sem NCM a NF-e não sai: abre a aba Fiscal do cadastro">sem NCM</a>`;
    const sug = !trava && !(Number(it.valor_unitario) > 0) && fis.sug > 0
      ? `<div class="meta">sugerido <a href="#" class="mov-usar-sug" data-idx="${idx}" title="${esc(origemTxt(fis.origem))}">${brl(fis.sug)}</a></div>` : "";
    return `<tr>
      <td>${it.acessorio_id ? "⚙️ " + linkAcessorio(it.acessorio_id, it.descricao) : it.equipamento_id ? "🔧 " + linkEquipamento(it.equipamento_id, it.descricao) : "📦 " + linkProduto(it.produto_id, it.descricao)}${it.acessorio_id && it._onde ? ` <span class="meta">· ${esc(it._onde)}</span>` : ""}</td>
      <td>${ncmCel}</td>
      <td><input type="number" step="0.001" min="0" value="${esc(it.quantidade)}" data-idx="${idx}" data-field="quantidade" class="item-input" style="width:80px;text-align:right;" ${trava ? "disabled" : ""} /></td>
      <td>${esc(movItemUnidade(it))}</td>
      <td><input type="number" step="0.01" min="0" value="${esc(it.valor_unitario || 0)}" data-idx="${idx}" data-field="valor_unitario" class="item-input" style="width:110px;text-align:right;" ${trava ? "disabled" : ""} />${sug}</td>
      <td class="num">${brl((it.quantidade||0) * (it.valor_unitario||0))}</td>
      <td>${trava ? "" : `<button type="button" class="btn-sec btn-sm btn-remove-item" data-idx="${idx}">×</button>`}</td>
    </tr>`;
  }).join("");

  tb.querySelectorAll(".item-input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      itensAtuais[idx][field] = Number(e.target.value || 0);
      atualizarTotal();
      const linha = e.target.closest("tr");
      const it = itensAtuais[idx];
      linha.querySelector(".num").textContent = brl((it.quantidade||0) * (it.valor_unitario||0));
    });
  });
  tb.querySelectorAll(".btn-remove-item").forEach(b => {
    b.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.idx);
      itensAtuais.splice(idx, 1);
      renderizarItens();
    });
  });
  // fase 105b: valor sugerido (fiscal_valor_remessa) e atalho para o NCM no cadastro
  tb.querySelectorAll(".mov-usar-sug").forEach(a => a.addEventListener("click", (e) => {
    e.preventDefault();
    const it = itensAtuais[Number(a.dataset.idx)];
    const fis = it ? movItemFiscal(it) : {};
    if(it && fis.sug > 0){ it.valor_unitario = fis.sug; renderizarItens(); }
  }));
  tb.querySelectorAll(".mov-sem-ncm").forEach(a => a.addEventListener("click", (e) => {
    e.preventDefault();
    movAbrirFiscalItem(a.dataset.tipo, a.dataset.id);
  }));
  atualizarTotal();
  movAtualizarSugestao();
}

function atualizarTotal(){
  const total = itensAtuais.reduce((s,i) => s + (i.quantidade||0) * (i.valor_unitario||0), 0);
  $("mov-valor-produtos").value = total.toFixed(2);
  // atualiza chip também
  const chip = $("mov-ficha-total-chip");
  if(chip) chip.textContent = brl(total);
}

/* ---------- Adicionar equipamento ---------- */
function popularSelectEquipamentos(){
  const sel = $("mov-add-equip");
  if(!sel) return;
  const lista = Object.values(mapaEquipamentos);
  preencherSelect(sel, lista.map(e => ({
    id: e.id,
    txt: `${e.codigo} — ${e.nome} (${e.localizacao_tipo})`
  })), "id", "txt", "— escolha um equipamento —");
}

function adicionarEquipamento(){
  const sel = $("mov-add-equip");
  const id = sel.value;
  if(!id){ aviso("app-aviso","Escolha um equipamento.", "erro"); return; }
  const eq = mapaEquipamentos[id];
  if(itensAtuais.some(i => i.equipamento_id === id)){
    aviso("app-aviso","Esse equipamento já está na lista.", "erro");
    return;
  }
  itensAtuais.push({
    equipamento_id: id,
    produto_id: null,
    descricao: `${eq.codigo} — ${eq.nome}`,
    quantidade: 1,
    unidade: "un",
    valor_unitario: 0
  });
  sel.value = "";
  renderizarItens();
  movCompletarNovos(itensAtuais.slice(-1));   // fase 105b: NCM e valor sugerido do cadastro
}

/* ---------- Buscar produto ---------- */
async function buscarProdutos(termo){
  if(!termo || termo.length < 2) return [];
  const { data } = await sb.from("produtos")
    .select("id,codigo,nome,unidade,custo_ultimo")
    .ilike("nome", "%"+termo+"%")
    .limit(20);
  return data || [];
}

let buscaProdTimeout = null;
function configurarBuscaProdutos(){
  const inp = $("mov-busca-produto");
  const lista = $("mov-resultados-produto");
  if(!inp) return;

  inp.addEventListener("input", () => {
    clearTimeout(buscaProdTimeout);
    buscaProdTimeout = setTimeout(async () => {
      const termo = inp.value.trim();
      if(!termo || termo.length < 2){
        lista.innerHTML = "";
        lista.style.display = "none";
        return;
      }
      const resultados = await buscarProdutos(termo);
      if(!resultados.length){
        lista.innerHTML = `<div class="resultado-item vazio">Nenhum produto encontrado.</div>`;
      } else {
        lista.innerHTML = resultados.map(p => `
          <div class="resultado-item" data-id="${esc(p.id)}" data-nome="${esc(p.nome)}" data-unid="${esc(p.unidade)}" data-custo="${esc(p.custo_ultimo)}">
            <strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <em>(${esc(p.unidade)})</em>
          </div>
        `).join("");
        lista.querySelectorAll(".resultado-item").forEach(div => {
          if(!div.dataset.id) return;
          div.addEventListener("click", () => {
            itensAtuais.push({
              equipamento_id: null,
              produto_id: div.dataset.id,
              descricao: div.dataset.nome,
              quantidade: 1,
              unidade: div.dataset.unid,
              valor_unitario: Number(div.dataset.custo || 0)
            });
            inp.value = "";
            lista.innerHTML = "";
            lista.style.display = "none";
            renderizarItens();
            movCompletarNovos(itensAtuais.slice(-1));   // fase 105b
          });
        });
      }
      lista.style.display = "";
    }, 250);
  });
}

/* ---------- Acessórios na carga ----------
   Catálogo vem do módulo Acessórios (aceCatalogo). Peça entra como item com acessorio_id; ao marcar
   em trânsito / recebida, o gatilho do banco move a peça junto (e vincula à TAG que vai na mesma carga). */
function movAceDescr(a){
  const d = typeof aceDescr === "function" ? aceDescr(a) : (a.tipo || "Acessório");
  return `${d} · ${a.marcacao}`;
}
function movAceOnde(a){ return typeof aceOnde === "function" ? aceOnde(a) : (a.local_tipo || ""); }
function movAceCond(a){
  const o = (STATUS.acessorio || {})[a.condicao] || {};
  return `<span class="tag ${o.cor || "cinza"}">${esc(o.label || a.condicao || "")}</span>`;
}
function movAddAcessorio(a){
  if(itensAtuais.some(i => i.acessorio_id === a.id)) return false;
  itensAtuais.push({
    equipamento_id: null, produto_id: null, acessorio_id: a.id,
    descricao: movAceDescr(a), quantidade: 1, unidade: "un",
    valor_unitario: Number(a.modelo?.preco_referencia || 0),
    _onde: movAceOnde(a)
  });
  return true;
}
function movAddAcessorios(lista){
  let n = 0; lista.forEach(a => { if(movAddAcessorio(a)) n++; });
  renderizarItens();
  if(n) movCompletarNovos(itensAtuais.slice(-n));   // fase 105b
  if(n) aviso("app-aviso", `${n} peça(s) adicionada(s) à carga.`, "ok");
  else aviso("app-aviso", "Essas peças já estão na lista.", "erro");
}
async function movCatalogoAce(){
  if(typeof aceCatalogo !== "function") return [];
  try { return await aceCatalogo(); } catch(e){ aviso("app-aviso", "Não foi possível carregar os acessórios: " + (e.message || e), "erro"); return []; }
}
function movFecharBuscaAcessorio(){
  const inp = $("mov-busca-acessorio"), lista = $("mov-resultados-acessorio");
  if(inp) inp.value = "";
  if(lista){ lista.innerHTML = ""; lista.style.display = "none"; }
}
let buscaAceTimeout = null;
function configurarBuscaAcessorios(){
  const inp = $("mov-busca-acessorio");
  const lista = $("mov-resultados-acessorio");
  if(!inp) return;
  inp.addEventListener("focus", () => { movCatalogoAce(); });   // pré-carrega
  inp.addEventListener("input", () => {
    clearTimeout(buscaAceTimeout);
    buscaAceTimeout = setTimeout(async () => {
      const termo = inp.value.trim().toLowerCase();
      if(termo.length < 2){ lista.innerHTML = ""; lista.style.display = "none"; return; }
      const cat = await movCatalogoAce();
      const disp = cat.filter(a => a.ativo !== false && a.local_tipo !== "perdido" && a.condicao !== "baixado");
      const hits = disp.filter(a =>
        String(a.marcacao || "").toLowerCase().includes(termo) ||
        String(a.jogo || "").toLowerCase() === termo ||
        movAceDescr(a).toLowerCase().includes(termo));
      const jogos = [...new Set(disp.filter(a => a.jogo && String(a.jogo).toLowerCase().includes(termo)).map(a => a.jogo))].slice(0, 5);
      if(!hits.length && !jogos.length){ lista.innerHTML = `<div class="resultado-item vazio">Nenhuma peça encontrada.</div>`; lista.style.display = ""; return; }
      const jogoHTML = jogos.map(j => {
        const pecas = disp.filter(a => a.jogo === j);
        return `<div class="resultado-item mov-ace-jogo" data-jogo="${esc(j)}"><strong>🧩 Jogo ${esc(j)}</strong> — adicionar as ${pecas.length} peça(s) <em>(${esc(movAceOnde(pecas[0]))})</em></div>`;
      }).join("");
      const naLista = new Set(itensAtuais.map(i => i.acessorio_id).filter(Boolean));
      const itemHTML = hits.slice(0, 30).map(a => `
        <div class="resultado-item${naLista.has(a.id) ? " ja" : ""}" data-id="${esc(a.id)}">
          <strong>${esc(a.marcacao)}</strong> — ${esc(typeof aceDescr === "function" ? aceDescr(a) : a.tipo)}${a.jogo ? ` <span class="meta">jogo ${esc(a.jogo)}</span>` : ""}
          <span class="meta" style="float:right;">${movAceCond(a)} ${esc(movAceOnde(a))}${naLista.has(a.id) ? " · já na lista" : ""}</span>
        </div>`).join("");
      lista.innerHTML = jogoHTML + itemHTML + (hits.length > 30 ? `<div class="resultado-item vazio">… e mais ${hits.length - 30}. Refine a busca.</div>` : "");
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(div => div.addEventListener("click", () => {
        const a = cat.find(x => x.id === div.dataset.id); if(!a) return;
        movAddAcessorios([a]); movFecharBuscaAcessorio();
      }));
      lista.querySelectorAll(".mov-ace-jogo").forEach(div => div.addEventListener("click", () => {
        movAddAcessorios(disp.filter(a => a.jogo === div.dataset.jogo)); movFecharBuscaAcessorio();
      }));
    }, 200);
  });
}

/* Painel de sugestão na aba Itens:
   - origem é obra  → peças que estão nessa obra (retorno com conferência: desmarca o que ficou lá);
   - senão, TAG de produção na carga → peças que estão nessa TAG ou pertencem a ela (kit da remessa). */
async function movAtualizarSugestao(){
  const box = $("mov-ace-sugestao"); if(!box || !movimentacaoAtual) return;
  const st = movimentacaoAtual.status || "rascunho";
  if((st !== "rascunho" && st !== "emitida") || movItensTravados()){ box.style.display = "none"; return; }
  const origemTipo = $("mov-origem-tipo").value, origemObra = $("mov-origem-obra").value;
  const eqIds = itensAtuais.filter(i => i.equipamento_id && MOV_EQ_PRODUCAO.includes((mapaEquipamentos[i.equipamento_id] || {}).tipo)).map(i => i.equipamento_id);
  let titulo = "", filtro = null;
  if(["obra","cliente"].includes(origemTipo) && origemObra){
    titulo = `Peças na obra ${movObraTxt(origemObra)}`;
    filtro = a => a.local_tipo === "obra" && a.local_obra_id === origemObra;
  } else if(eqIds.length){
    titulo = `Peças da TAG ${eqIds.map(id => (mapaEquipamentos[id] || {}).codigo || "?").join(", ")}`;
    filtro = a => ["patio","oficina","equipamento"].includes(a.local_tipo) && a.condicao !== "em_manutencao" &&
      ((a.local_tipo === "equipamento" && eqIds.includes(a.local_equipamento_id)) || eqIds.includes(a.equipamento_padrao_id));
  }
  if(!filtro){ box.style.display = "none"; _movAceSug = []; return; }
  const cat = await movCatalogoAce();
  // o estado pode ter mudado enquanto o catálogo carregava
  if(!movimentacaoAtual) return;
  _movAceSug = cat.filter(a => a.ativo !== false && a.condicao !== "baixado" && filtro(a))
    .sort((x, y) => movAceDescr(x).localeCompare(movAceDescr(y), "pt-BR", { numeric: true }));
  $("mov-ace-sug-titulo").textContent = titulo;
  const naLista = new Set(itensAtuais.map(i => i.acessorio_id).filter(Boolean));
  const fora = _movAceSug.filter(a => !naLista.has(a.id));
  $("mov-ace-sug-resumo").textContent = _movAceSug.length ? `${_movAceSug.length} peça(s) · ${fora.length} ainda fora da carga` : "";
  const l = $("mov-ace-sug-lista");
  if(!_movAceSug.length){ l.innerHTML = `<p class="vazio">Nenhuma peça registrada aqui.</p>`; box.style.display = ""; return; }
  const grupos = new Map();
  _movAceSug.forEach(a => { const k = typeof aceDescr === "function" ? aceDescr(a) : a.tipo; (grupos.get(k) || grupos.set(k, []).get(k)).push(a); });
  l.innerHTML = [...grupos.entries()].map(([k, pecas]) => `
    <div class="mov-ace-sug-grupo">
      <div class="mov-ace-sug-grupo-t">${esc(k)} <span class="meta">${pecas.length}</span></div>
      ${pecas.map(a => `<label class="mov-ace-sug-item${naLista.has(a.id) ? " ja" : ""}">
        <input type="checkbox" value="${esc(a.id)}" ${naLista.has(a.id) ? "disabled" : "checked"} />
        <strong>${esc(a.marcacao)}</strong>${a.jogo ? ` <span class="meta">jogo ${esc(a.jogo)}</span>` : ""}
        ${movAceCond(a)} <span class="meta">${esc(movAceOnde(a))}${naLista.has(a.id) ? " · já na carga" : ""}</span>
      </label>`).join("")}
    </div>`).join("");
  box.style.display = "";
}
function movSugMarcar(on){ document.querySelectorAll("#mov-ace-sug-lista input[type=checkbox]:not(:disabled)").forEach(c => c.checked = on); }
function movSugAdicionar(){
  const ids = [...document.querySelectorAll("#mov-ace-sug-lista input[type=checkbox]:checked:not(:disabled)")].map(c => c.value);
  if(!ids.length){ aviso("app-aviso", "Marque as peças que vão na carga.", "erro"); return; }
  movAddAcessorios(_movAceSug.filter(a => ids.includes(a.id)));
}

/* ---------- Botões de ação contextuais ---------- */
function atualizarBotoesAcao(){
  const m = movimentacaoAtual, st = m.status;
  const nfeApp = movNfeEmitidaPeloApp(m);                                        // fase 105b
  const nfeViva = nfeApp && ["processando", "autorizada"].includes(m.nf_status);
  $("btn-salvar-rascunho").style.display   = (st !== "recebida" && st !== "cancelada") ? "" : "none";
  $("btn-marcar-emitida").style.display    = (st === "rascunho" && !nfeViva) ? "" : "none";   // NF-e do app: vira emitida na autorização
  $("btn-marcar-transito").style.display   = (st === "emitida")  ? "" : "none";
  $("btn-marcar-recebida").style.display   = (st === "emitida" || st === "em_transito") ? "" : "none";
  $("btn-cancelar").style.display          = (st !== "cancelada" && st !== "recebida" && !nfeViva) ? "" : "none";   // com NF-e viva, cancele a nota antes
  $("btn-dados-uninfe").style.display      = (st !== "cancelada" && !nfeApp) ? "" : "none";   // UniNFe = contingência
  $("btn-recomenda-mdf").style.display     = (st === "emitida" || st === "em_transito") ? "" : "none";
  $("btn-sugerir-fiscais").style.display   = ((st === "rascunho" || st === "emitida") && !nfeApp) ? "" : "none";
  movNfeBotoes();
}

/* ---------- Coletar dados do form ---------- */
function coletarDadosForm(){
  const dados = {
    tipo: $("mov-tipo").value,
    origem_tipo: $("mov-origem-tipo").value,
    origem_descricao: $("mov-origem-descricao").value.trim() || null,
    origem_uf: $("mov-origem-uf").value || null,
    origem_obra_id: ["obra","cliente"].includes($("mov-origem-tipo").value) ? ($("mov-origem-obra").value || null) : null,
    destino_tipo: $("mov-destino-tipo").value,
    destino_descricao: $("mov-destino-descricao").value.trim() || null,
    destino_uf: $("mov-destino-uf").value || null,
    destino_obra_id: ["obra","cliente"].includes($("mov-destino-tipo").value) ? ($("mov-destino-obra").value || null) : null,
    data_emissao: $("mov-data-emissao").value || hojeISO(),
    data_saida: $("mov-data-saida").value || null,
    data_recebimento: $("mov-data-recebimento").value || null,
    frete_por_conta: $("mov-frete").value,
    transp_nome: $("mov-transp-nome").value.trim() || null,
    transp_cnpj: $("mov-transp-cnpj").value.trim() || null,
    transp_ie: $("mov-transp-ie").value.trim() || null,                 // lote S46 (#88)
    transp_endereco: $("mov-transp-endereco").value.trim() || null,
    transp_municipio: $("mov-transp-municipio").value.trim() || null,
    transp_uf: $("mov-transp-uf").value || null,
    transp_placa: $("mov-transp-placa").value.trim() || null,
    motorista: $("mov-motorista").value.trim() || null,
    nf_numero: $("mov-nf-numero").value.trim() || null,
    nf_serie: $("mov-nf-serie").value.trim() || "1",
    nf_chave_acesso: ($("mov-nf-chave").value.trim().replace(/\s/g,"")) || null,
    nf_protocolo: $("mov-nf-protocolo").value.trim() || null,
    cfop: $("mov-cfop").value.trim() || null,
    natureza_operacao: $("mov-natureza").value.trim() || null,
    peso_bruto_kg: Number($("mov-peso-bruto").value) || null,
    peso_liquido_kg: Number($("mov-peso-liquido").value) || null,
    valor_total_produtos: Number($("mov-valor-produtos").value) || 0,
    info_complementar: $("mov-info-complementar").value.trim() || null,
    observacoes: $("mov-observacoes").value.trim() || null
  };
  // fase 105b: nota emitida pelo app e já na SEFAZ (processando, autorizada, cancelada, denegada) — número, série, chave,
  // protocolo, CFOP, natureza, tipo, obras e valor vêm da Focus e ficam como estão (o banco barra a troca). Rejeitada ou
  // inutilizada continua editável: é o caminho da contingência pela UniNFe.
  if(movItensTravados()){
    ["nf_numero", "nf_serie", "nf_chave_acesso", "nf_protocolo", "cfop", "natureza_operacao",
     "tipo", "origem_obra_id", "destino_obra_id", "valor_total_produtos"].forEach(k => delete dados[k]);
  }
  return dados;
}

/* ---------- Salvar (cabeçalho + itens) ---------- */
async function salvarMovimentacao(novoStatus){
  if(!itensAtuais.length){
    aviso("app-aviso","Adicione pelo menos um item.", "erro");
    ativarTab("itens");
    return null;
  }
  const dados = coletarDadosForm();
  const travaItens = movItensTravados();   // fase 105b: nota emitida pelo app — itens ficam como estão
  if(novoStatus) dados.status = novoStatus;
  const temAce = itensAtuais.some(it => it.acessorio_id);
  if(temAce && ["obra","cliente"].includes(dados.destino_tipo) && !dados.destino_obra_id){
    aviso("app-aviso","Há acessórios na carga: escolha a obra de destino para as peças ficarem vinculadas a ela.", "erro");
    ativarTab("cabecalho"); $("mov-destino-obra")?.focus();
    return null;
  }

  let movId = movimentacaoAtual.id;

  if(!movId){
    const { data: numData, error: numErr } = await sb.rpc("proximo_numero_movimentacao");
    if(numErr){ aviso("app-aviso","Erro gerando número: "+numErr.message, "erro"); return null; }
    dados.numero = numData;
    const { data: ins, error: insErr } = await sb.from("movimentacoes_ativos").insert(dados).select().single();
    if(insErr){ aviso("app-aviso","Erro ao salvar: "+insErr.message, "erro"); return null; }
    movId = ins.id;
    movimentacaoAtual = ins;
  } else {
    const { data: upd, error: updErr } = await sb.from("movimentacoes_ativos").update(dados).eq("id", movId).select().single();
    if(updErr){ aviso("app-aviso","Erro ao atualizar: "+updErr.message, "erro"); return null; }
    movimentacaoAtual = upd;
  }

  const { error: errDelItens } = travaItens ? { error: null } : await sb.from("movimentacao_itens").delete().eq("movimentacao_id", movId);
  if(errDelItens){ aviso("app-aviso","Erro ao substituir os itens: "+errDelItens.message+". Nada foi reinserido — tente salvar de novo.","erro"); return; }
  const itensInsert = itensAtuais.map(it => ({
    movimentacao_id: movId,
    equipamento_id: it.equipamento_id || null,
    produto_id: it.produto_id || null,
    acessorio_id: it.acessorio_id || null,
    descricao: it.descricao,
    quantidade: it.quantidade,
    unidade: it.unidade,
    valor_unitario: it.valor_unitario || 0,
    numero_serie: it.numero_serie || null,
    chassi: it.chassi || null,
    ncm: it.ncm || null,
    cst: it.cst || null,
    cfop_item: it.cfop_item || null
  }));
  const { error: itErr } = travaItens ? { error: null } : await sb.from("movimentacao_itens").insert(itensInsert);
  if(itErr){ aviso("app-aviso","Erro ao salvar itens: "+itErr.message, "erro"); return null; }

  aviso("app-aviso","Movimentação salva com sucesso.", "ok");
  if(temAce && typeof aceInvalidar === "function") aceInvalidar();   // peças mudaram de lugar (trigger)
  await fetchMovimentacoes();
  renderMovimentacoes();
  await carregarEquipamentosSelect();
  await abrirMovimentacao(movId);
  return movId;
}

/* ---------- Sugerir CFOP/natureza ---------- */
async function sugerirDadosFiscais(){
  if(!movimentacaoAtual.id){
    aviso("app-aviso","Salve o rascunho primeiro pra sugerir CFOP.", "erro");
    return;
  }
  const { data, error } = await sb.rpc("sugerir_dados_fiscais", { p_movimentacao_id: movimentacaoAtual.id });
  if(error){ aviso("app-aviso","Erro: "+error.message, "erro"); return; }
  if(data && data.length){
    const s = data[0];
    $("mov-cfop").value = s.cfop;
    $("mov-natureza").value = s.natureza_operacao;
    ativarTab("fiscal");
    if(s.observacao) aviso("app-aviso", s.observacao, "ok");
    else aviso("app-aviso","CFOP e natureza sugeridos.", "ok");
  }
}

/* ---------- Painel "Dados pra UniNFe" ---------- */
function gerarBlocoUniNFe(){
  const m = movimentacaoAtual;
  const itens = itensAtuais;
  const linhas = [];
  linhas.push(`=== DADOS PARA EMISSÃO NO UNINFE (NF-e Modelo 55) ===`);
  linhas.push(``);
  linhas.push(`Natureza da operação: ${m.natureza_operacao || "(definir)"}`);
  linhas.push(`CFOP: ${m.cfop || "(definir)"}`);
  linhas.push(`Série: ${m.nf_serie || "1"}`);
  linhas.push(``);
  linhas.push(`DESTINATÁRIO`);
  linhas.push(`Tipo: ${LOC_TIPOS[m.destino_tipo]}`);
  linhas.push(`Descrição: ${m.destino_descricao || "—"}`);
  linhas.push(`UF: ${(m.destino_uf||"").toUpperCase()}`);
  linhas.push(``);
  linhas.push(`TRANSPORTADOR`);
  linhas.push(`Frete por conta: ${FRETE_POR_CONTA[m.frete_por_conta]}`);
  if(m.frete_por_conta === "terceiro"){
    linhas.push(`Nome: ${m.transp_nome || "—"}`);
    linhas.push(`CNPJ: ${m.transp_cnpj || "—"}`);
    if(m.transp_ie) linhas.push(`IE: ${m.transp_ie}`);
    if(m.transp_endereco || m.transp_municipio) linhas.push(`Endereço: ${[m.transp_endereco, [m.transp_municipio, (m.transp_uf || "").toUpperCase()].filter(Boolean).join("/")].filter(Boolean).join(" · ")}`);
  }
  linhas.push(`Placa: ${m.transp_placa || "—"}`);
  linhas.push(`Motorista: ${m.motorista || "—"}`);
  linhas.push(``);
  linhas.push(`ITENS`);
  itens.forEach((it,i) => {
    linhas.push(`${i+1}. ${it.descricao}`);
    linhas.push(`   Qtd: ${it.quantidade} ${it.unidade} | Valor unit: R$ ${Number(it.valor_unitario).toFixed(2)} | Total: R$ ${((it.quantidade||0)*(it.valor_unitario||0)).toFixed(2)}`);
    if(it.ncm) linhas.push(`   NCM: ${it.ncm}`);
    if(it.numero_serie) linhas.push(`   Série: ${it.numero_serie}`);
    if(it.chassi) linhas.push(`   Chassi: ${it.chassi}`);
  });
  linhas.push(``);
  linhas.push(`TOTAIS`);
  linhas.push(`Valor produtos: R$ ${Number(m.valor_total_produtos||0).toFixed(2)}`);
  if(m.peso_bruto_kg)   linhas.push(`Peso bruto: ${m.peso_bruto_kg} kg`);
  if(m.peso_liquido_kg) linhas.push(`Peso líquido: ${m.peso_liquido_kg} kg`);
  linhas.push(``);
  linhas.push(`INFORMAÇÃO COMPLEMENTAR`);
  const origemTxt = `${(m.origem_descricao||LOC_TIPOS[m.origem_tipo])}/${(m.origem_uf||"").toUpperCase()}`;
  const destinoTxt = `${(m.destino_descricao||LOC_TIPOS[m.destino_tipo])}/${(m.destino_uf||"").toUpperCase()}`;
  const tipoOpStr = m.tipo === "remessa" ? "MOBILIZACAO" : m.tipo === "retorno" ? "DESMOBILIZACAO" : m.tipo.toUpperCase();
  const infoPadrao = `SAIDA:${origemTxt} DESTINO:${destinoTxt} ${tipoOpStr}`;
  linhas.push(m.info_complementar || infoPadrao);
  return linhas.join("\n");
}

function mostrarDadosUniNFe(){
  if(!movimentacaoAtual.id){
    aviso("app-aviso","Salve o rascunho primeiro.", "erro");
    return;
  }
  $("mov-uninfe-conteudo").textContent = gerarBlocoUniNFe();
  $("mov-uninfe-modal").style.display = "flex";
}

function copiarUniNFe(){
  const txt = $("mov-uninfe-conteudo").textContent;
  navigator.clipboard.writeText(txt).then(()=>{
    aviso("app-aviso","Copiado pra área de transferência.", "ok");
  });
}

/* ---------- Recomendação de MDF ---------- */
async function verificarMDFRecomendado(){
  if(!movimentacaoAtual.id) return;
  const { data, error } = await sb.rpc("recomenda_mdfe", { p_movimentacao_id: movimentacaoAtual.id });
  if(error) return;
  if(data === true){
    aviso("app-aviso","💡 MDF-e recomendado: frete próprio + UF de destino diferente da origem. Considere agrupar essa NF num manifesto.", "ok");
  } else {
    aviso("app-aviso","MDF-e não é obrigatório nessa movimentação.", "ok");
  }
}

/* ---------- Statusbar clicável (avança/recua status) ---------- */
function ligarStatusbarClicavel(){
  document.querySelectorAll("#mov-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!movimentacaoAtual.id){
        aviso("app-aviso","Salve o rascunho primeiro.","erro");
        return;
      }
      if(novo === movimentacaoAtual.status) return;
      // confirmações sensíveis
      if(novo === "emitida" && !$("mov-nf-numero").value){
        aviso("app-aviso","Informe o número da NF-e antes de marcar como emitida.","erro");
        ativarTab("fiscal");
        return;
      }
      if(novo === "recebida"){
        if(!confirm("Marcar como RECEBIDA? Isso atualiza a localização dos equipamentos e acessórios automaticamente.")) return;
      }
      await salvarMovimentacao(novo);
    });
  });
}

/* ====================================================================
   Fase 105b — NF-e de remessa e retorno pelo app (Focus NFe; function focus-nfe, status pelo focus-nfe-webhook)
   ==================================================================== */
const MOV_NFE_STAGES = ["rascunho", "processando", "autorizada", "cancelada"];
function movNfeEmitidaPeloApp(m){ m = m || movimentacaoAtual; return !!(m && m.nf_ref_focus); }
function movItensTravados(m){
  m = m || movimentacaoAtual;
  return !!(m && m.nf_ref_focus && ["processando", "autorizada", "cancelada", "denegada"].includes(m.nf_status));
}
function movNfeTipoOk(m){ return !!m && ["remessa", "retorno"].includes(m.tipo) && !m.interna; }

/* ---------- itens: NCM, unidade comercial e valor sugerido (cadastro da fase 105a) ---------- */
const MOV_TABELA_MESTRE = { equipamento: "equipamentos", acessorio: "acessorios", produto: "produtos" };
function movItemChave(it){
  if(it.equipamento_id) return ["equipamento", it.equipamento_id];
  if(it.acessorio_id) return ["acessorio", it.acessorio_id];
  return ["produto", it.produto_id];
}
function movItemFiscal(it){
  const [t, id] = movItemChave(it);
  const f = _movFiscalItens[`${t}:${id}`] || {};
  return { ...f, ncm: it.ncm || f.ncm || null };
}
function movItemUnidade(it){ return String(movItemFiscal(it).ucom || it.unidade || "un").toUpperCase(); }
async function movSugerirValor(it){
  const [t, id] = movItemChave(it);
  if(!id) return null;
  const { data } = await sb.rpc("fiscal_valor_remessa", { p_tipo: t, p_id: id });
  const s = Array.isArray(data) ? data[0] : data;
  if(!s || s.valor == null) return null;
  const k = `${t}:${id}`;
  _movFiscalItens[k] = { ...(_movFiscalItens[k] || {}), sug: Number(s.valor), origem: s.origem };
  return Number(s.valor);
}
async function movCarregarFiscalItens(lista){
  if(!lista) _movFiscalItens = {};
  _movNcmOk = typeof fiscalColunaExiste === "function" && await fiscalColunaExiste("equipamentos", "ncm");
  const itens = lista || itensAtuais;
  if(!_movNcmOk || !itens.length) return;
  const ids = { equipamento: new Set(), acessorio: new Set(), produto: new Set() };
  itens.forEach(it => { const [t, id] = movItemChave(it); if(id) ids[t].add(id); });
  await Promise.all(Object.entries(ids).filter(([, s]) => s.size).map(async ([t, s]) => {
    const { data } = await sb.from(MOV_TABELA_MESTRE[t]).select("id,ncm,unidade_comercial").in("id", [...s]);
    (data || []).forEach(r => { const k = `${t}:${r.id}`; _movFiscalItens[k] = { ...(_movFiscalItens[k] || {}), ncm: r.ncm, ucom: r.unidade_comercial }; });
  }));
  if(movItensTravados()) return;
  await Promise.all(itens.filter(it => !(Number(it.valor_unitario) > 0)).map(it => movSugerirValor(it)));
}
/* item recém-adicionado: lê o NCM e, sem valor, já preenche o sugerido */
async function movCompletarNovos(novos){
  if(!novos.length) return;
  const doc = movimentacaoAtual;
  await movCarregarFiscalItens(novos);
  if(movimentacaoAtual !== doc) return;
  novos.forEach(it => { const f = movItemFiscal(it); if(!(Number(it.valor_unitario) > 0) && f.sug > 0) it.valor_unitario = f.sug; });
  renderizarItens();
}
/* "sem NCM": abre o cadastro na aba Fiscal (mesmo caminho do Para regularizar da 105a) */
async function movAbrirFiscalItem(tipo, id){
  if(!id) return;
  if(tipo === "equipamento"){
    if(irParaSecao("equipamentos") && typeof abrirEquipamento === "function"){ await abrirEquipamento(id); if(typeof ativarTabEquipamento === "function") ativarTabEquipamento("fiscal"); }
  } else if(tipo === "acessorio"){
    if(irParaSecao("acessorios") && typeof abrirAcessorio === "function"){
      for(let i = 0; i < 80 && !(typeof _aceCarregado !== "undefined" && _aceCarregado); i++) await new Promise(r => setTimeout(r, 250));
      abrirAcessorio(id);
      if(typeof ativarTabAcessorio === "function") ativarTabAcessorio("fiscal");
    }
  } else if(irParaSecao("produtos") && typeof abrirProduto === "function"){
    await abrirProduto(id);
    if(typeof ativarTabProd === "function") ativarTabProd("fiscal");
  }
}

/* ---------- ficha: statusbar fiscal, chip do ambiente, rejeição, campos travados ---------- */
function movNfeAtualizar(){
  const m = movimentacaoAtual;
  if(!m) return;
  const nfeApp = movNfeEmitidaPeloApp(m);
  const homolog = m.nf_ambiente === "homologacao";
  const chip = $("mov-ficha-nfe-chip");
  if(chip){
    chip.innerHTML = m.nf_status
      ? tagStatus("nfe", m.nf_status) + (homolog ? ' <span class="tag ambar" title="Ambiente de homologação da Focus: nota de teste, sem valor fiscal">Homologação</span>' : "")
      : '<span class="meta">—</span>';
  }
  const painel = $("mov-nfe-painel");
  if(painel) painel.style.display = _movNfeOk && movNfeTipoOk(m) && m.id ? "" : "none";
  const sbar = $("mov-nfe-statusbar");
  if(sbar){
    const st = m.nf_status || "rascunho";
    const ruim = ["rejeitada", "denegada", "inutilizada"].includes(st);
    const pos = ruim ? 2 : Math.max(0, MOV_NFE_STAGES.indexOf(st));
    sbar.querySelectorAll(".stage").forEach((el, i) => {
      el.classList.remove("atual", "passada", "cancelada");
      el.removeAttribute("aria-current");
      if(el.dataset.nfe === "autorizada") el.textContent = ruim ? String((STATUS.nfe[st] || {}).label || st).replace(/^NF-e /, "") : "Autorizada";
      if(i < pos) el.classList.add("passada");
      if(i === pos){ el.classList.add(ruim || st === "cancelada" ? "cancelada" : "atual"); el.setAttribute("aria-current", "step"); }
    });
  }
  const amb = $("mov-nfe-amb");
  if(amb){
    amb.innerHTML = m.nf_ambiente
      ? `<span class="tag ${homolog ? "ambar" : "verde"}">${homolog ? "Homologação: sem valor fiscal" : "Produção"}</span>`
      : '<span class="meta">o ambiente (homologação ou produção) vem dos dados fiscais da empresa</span>';
  }
  const rej = $("mov-nfe-rejeicao");
  if(rej){
    const erros = Array.isArray(m.nf_erros) ? m.nf_erros : [];
    const mostra = ["rejeitada", "denegada"].includes(m.nf_status) && (m.nf_mensagem || erros.length);
    rej.style.display = mostra ? "" : "none";
    rej.innerHTML = !mostra ? "" : `<strong>${m.nf_status === "denegada" ? "Uso denegado pela SEFAZ" : "Rejeição"}:</strong> ${esc(m.nf_mensagem || "")}
      ${erros.length ? `<ul>${erros.map(x => `<li>${x.campo ? `<strong>${esc(x.campo)}</strong>: ` : ""}${esc(x.mensagem || "")}</li>`).join("")}</ul>` : ""}
      ${m.nf_status === "rejeitada" ? `<div class="meta">Corrija o cadastro indicado e use Emitir NF-e de novo (mesma referência${m.nf_ambiente === "producao" && m.nf_numero ? ` e o mesmo número ${esc(m.nf_numero)}` : ""}).</div>` : ""}`;
  }
  const info = $("mov-nfe-info");
  if(info){
    info.textContent = !m.nf_status ? "Nota ainda não emitida pelo app."
      : m.nf_status === "processando" ? "Enviada à SEFAZ pela Focus NFe: o status chega sozinho em segundos (webhook). Se não chegar, use Consultar."
      : (!["rejeitada", "denegada"].includes(m.nf_status) && m.nf_mensagem) ? `SEFAZ: ${m.nf_mensagem}${m.nf_cce_sequencia ? ` · cartas de correção: ${m.nf_cce_sequencia}` : ""}` : "";
  }
  const trava = movItensTravados(m);
  ["mov-nf-numero", "mov-nf-serie", "mov-nf-chave", "mov-nf-protocolo", "mov-cfop", "mov-natureza"].forEach(i => { const el = $(i); if(el) el.readOnly = trava; });
  const nota = $("mov-fiscal-nota");
  if(nota) nota.textContent = trava
    ? "Número, série, chave, protocolo, CFOP e natureza vêm da Focus NFe (emissão pelo app): a tela não altera."
    : nfeApp
      ? "A nota do app não foi autorizada: corrija e emita de novo, ou, na contingência (UniNFe), preencha estes campos depois de emitir lá."
      : "Emissão pelo app: botão Emitir NF-e. Na contingência (UniNFe), preencha estes campos depois de emitir lá.";
  ["mov-tipo", "mov-origem-tipo", "mov-destino-tipo", "mov-origem-obra", "mov-destino-obra"].forEach(i => { const el = $(i); if(el) el.disabled = trava; });
  const add = $("mov-itens-adicionar");
  if(add) add.style.display = trava ? "none" : "";
  movNfeEventos();
}
function movNfeBotoes(){
  const m = movimentacaoAtual;
  const pode = typeof podeEmitirFiscal === "function" && podeEmitirFiscal();
  const ok = _movNfeOk && movNfeTipoOk(m) && !!m.id;
  const st = m.nf_status;
  const mostra = (id, cond) => { const b = $(id); if(b) b.style.display = cond ? "" : "none"; };
  const emitivel = ok && pode && m.status === "rascunho" && (!st || st === "rascunho" || st === "rejeitada") && itensAtuais.length > 0;
  const noBucket = c => !!m[c] && String(m[c]).startsWith("nfe/");
  mostra("btn-mov-nfe-emitir", emitivel);
  mostra("btn-mov-nfe-simular", emitivel);
  mostra("btn-mov-nfe-consultar", ok && pode && !!m.nf_ref_focus && (st === "processando" || (st === "autorizada" && (!m.arquivo_pdf_url || !m.nf_xml_url))));
  mostra("btn-mov-nfe-danfe", ok && (noBucket("arquivo_pdf_url") || (pode && ["autorizada", "cancelada"].includes(st))));
  mostra("btn-mov-nfe-xml", ok && (noBucket("nf_xml_url") || (pode && ["autorizada", "cancelada"].includes(st))));
  mostra("btn-mov-nfe-cce", ok && pode && st === "autorizada");
  mostra("btn-mov-nfe-cancelar", ok && pode && st === "autorizada");
  mostra("btn-mov-nfe-inutilizar", ok && pode && st === "rejeitada" && m.nf_ambiente === "producao" && !!m.nf_numero);
}
/* eventos fiscais do documento (registros_log, tipo 'fiscal'; gravados pela function e pelo webhook) */
async function movNfeEventos(){
  const box = $("mov-nfe-eventos");
  const m = movimentacaoAtual;
  if(!box) return;
  if(!m?.id || !_movNfeOk){ box.innerHTML = ""; return; }
  const { data, error } = await sb.from("registros_log").select("campo,valor_anterior,valor_novo,autor_nome,criado_em")
    .eq("entidade", "movimentacoes_ativos").eq("registro_id", m.id).eq("tipo", "fiscal")
    .order("criado_em", { ascending: false }).limit(50);
  if(movimentacaoAtual !== m) return;
  if(error || !(data || []).length){ box.innerHTML = '<p class="vazio">Nenhum evento fiscal registrado.</p>'; return; }
  const quando = d => typeof histQuando === "function" ? histQuando(d) : dataBR(d);
  box.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Quando</th><th>Evento</th><th>Por</th></tr></thead>
    <tbody>${data.map(l => `<tr><td>${esc(quando(l.criado_em))}</td><td>${l.campo === "nf_cce" ? "Carta de correção" : "NF-e"}: ${l.valor_anterior ? esc(l.valor_anterior) + " → " : ""}${esc(l.valor_novo || "")}</td><td>${esc(l.autor_nome || "—")}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

/* ---------- diálogo único das ações fiscais ---------- */
let _movNfeModalOk = null;
function movNfeModal({ titulo, corpo, texto, rotulo, min, max, botao, perigo, onOk }){
  $("mov-nfe-modal-titulo").textContent = titulo || "NF-e";
  $("mov-nfe-modal-corpo").innerHTML = corpo || "";
  const campo = $("mov-nfe-modal-texto-campo"), ta = $("mov-nfe-modal-texto"), cont = $("mov-nfe-modal-contador");
  campo.style.display = texto ? "" : "none";
  ta.value = "";
  ta.oninput = null;
  if(texto){
    $("mov-nfe-modal-texto-rot").textContent = rotulo || "Texto";
    ta.maxLength = max;
    const contar = () => { const n = ta.value.replace(/\s+/g, " ").trim().length; cont.textContent = `${n} caracteres (de ${min} a ${max})`; cont.classList.toggle("txt-perigo", n > 0 && n < min); };
    ta.oninput = contar;
    contar();
  }
  const b = $("btn-mov-nfe-modal-ok");
  b.style.display = onOk ? "" : "none";
  b.textContent = botao || "Confirmar";
  b.className = perigo ? "btn-sec acao-perigo" : "btn";
  _movNfeModalOk = onOk ? async () => {
    const txt = ta.value.replace(/\s+/g, " ").trim();
    if(texto && (txt.length < min || txt.length > max)){ aviso("app-aviso", `${rotulo}: de ${min} a ${max} caracteres.`, "erro"); return; }
    await onOk(txt);
  } : null;
  $("mov-nfe-modal").style.display = "flex";
  if(texto) ta.focus();
}
function movNfeModalFechar(){ $("mov-nfe-modal").style.display = "none"; _movNfeModalOk = null; }
function movNfeResumoHtml(d){
  const r = d.resumo || {}, pend = d.pendencias || [];
  const prod = r.ambiente === "producao";
  return `${pend.length ? `<div class="dist-aviso alerta"><strong>Falta completar antes de emitir (nada foi enviado):</strong><ul>${pend.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
    <div class="dist-aviso ${prod ? "perigo" : "neutro"}"><strong>${prod ? "PRODUÇÃO: nota com valor fiscal na SEFAZ" : "Homologação: nota de teste, sem valor fiscal"}</strong></div>
    <div class="grade">
      <div class="campo"><label>Natureza</label><div>${esc(r.natureza || "")}</div></div>
      <div class="campo"><label>CFOP</label><div>${esc(r.cfop || "—")} <span class="meta">${esc(r.tipo_documento || "")} · ${esc(r.operacao || "")}</span></div></div>
      <div class="campo"><label>Número</label><div>${esc(r.numero || "")}</div></div>
      <div class="campo largo"><label>Destinatário</label><div>${esc(r.destinatario || "—")}${r.entrega ? ` <span class="meta">· entrega/retirada: ${esc(r.entrega)}</span>` : ""}</div></div>
    </div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Item</th><th>NCM</th><th class="num">Qtd</th><th>Un</th><th class="num">Valor</th></tr></thead>
      <tbody>${(r.itens || []).map(i => `<tr><td>${esc(i.descricao)}</td><td>${esc(i.ncm || "—")}</td><td class="num">${esc(i.quantidade)}</td><td>${esc(i.unidade)}</td><td class="num">${brl(i.valor)}</td></tr>`).join("")}
        <tr><td colspan="4"><strong>Total</strong></td><td class="num"><strong>${brl(r.total)}</strong></td></tr></tbody>
    </table></div>
    ${r.informacoes ? `<p class="nota"><strong>Informações complementares:</strong> ${esc(r.informacoes)}</p>` : ""}`;
}

/* ---------- ações ---------- */
async function movNfeSalvarAntes(){
  const m = movimentacaoAtual;
  if(!m?.id){ aviso("app-aviso", "Salve o documento antes.", "erro"); return false; }
  if(movItensTravados(m)) return true;
  return !!(await salvarMovimentacao(m.status || "rascunho"));   // a function lê o banco: o que está na tela precisa estar salvo
}
async function movNfeRecarregar(){
  const id = movimentacaoAtual?.id;
  if(!id) return;
  await abrirMovimentacao(id);
  ativarTab("fiscal");
  await fetchMovimentacoes();
  renderMovimentacoes();
}
async function movNfeSimular(previa){
  const r = await fiscalChamarFocus("emitir", { movimentacao_id: movimentacaoAtual.id, dry_run: true, previa_danfe: !!previa });
  if(r.erro){ aviso("app-aviso", "NF-e: " + r.erro, "erro"); return null; }
  return r.data;
}
async function movNfeSimularMostrar(){
  if(!(await movNfeSalvarAntes())) return;
  const d = await movNfeSimular(true);
  if(!d) return;
  const previa = d.previa_url
    ? `<p><a href="${esc(d.previa_url)}" target="_blank" rel="noopener">📄 Abrir a prévia do DANFE (sem valor fiscal)</a></p>`
    : d.previa_erro ? `<p class="nota txt-perigo">${esc(d.previa_erro)}</p>`
    : (d.pendencias || []).length ? "" : '<p class="nota">A prévia do DANFE aparece quando o token da Focus estiver configurado.</p>';
  movNfeModal({
    titulo: `Simulação da NF-e · ${movimentacaoAtual.numero}`,
    corpo: movNfeResumoHtml(d) + previa + `<details><summary class="meta">JSON que vai para a Focus</summary><pre class="mov-nfe-json">${esc(JSON.stringify(d.nfe, null, 2))}</pre></details>`
  });
}
async function movNfeEmitir(){
  if(!(await movNfeSalvarAntes())) return;
  const d = await movNfeSimular(false);
  if(!d) return;
  const prod = d.ambiente === "producao";
  const doc = movimentacaoAtual;
  movNfeModal({
    titulo: `Emitir NF-e · ${doc.numero}`,
    corpo: movNfeResumoHtml(d),
    botao: prod ? "🧾 Emitir em PRODUÇÃO" : "🧾 Emitir em homologação",
    onOk: (d.pendencias || []).length ? null : async () => {
      if(prod && !confirm("Emitir a NF-e em PRODUÇÃO, com valor fiscal na SEFAZ?")) return;
      const r = await fiscalChamarFocus("emitir", { movimentacao_id: doc.id });
      movNfeModalFechar();
      if(r.erro){
        const pend = r.corpo?.pendencias || [];
        aviso("app-aviso", "NF-e: " + r.erro + (pend.length ? " " + pend.join(" ") : ""), "erro");
      } else {
        aviso("app-aviso", r.data.nf_status === "autorizada" ? `NF-e autorizada${r.data.mensagem ? ": " + r.data.mensagem : "."}` : (r.data.mensagem || "NF-e enviada."), r.data.nf_status === "rejeitada" ? "erro" : "ok");
      }
      await movNfeRecarregar();
    }
  });
}
async function movNfeConsultar(){
  const r = await fiscalChamarFocus("consultar", { movimentacao_id: movimentacaoAtual.id });
  if(r.erro){ aviso("app-aviso", "Consulta da NF-e: " + r.erro, "erro"); return; }
  const rot = String((STATUS.nfe[r.data.nf_status] || {}).label || r.data.nf_status || "");
  aviso("app-aviso", `${rot}${r.data.mensagem ? ": " + r.data.mensagem : ""}`, r.data.nf_status === "rejeitada" ? "erro" : "ok");
  await movNfeRecarregar();
}
async function movNfeArquivo(tipo){
  const m = movimentacaoAtual;
  const col = tipo === "pdf" ? "arquivo_pdf_url" : "nf_xml_url";
  const nome = tipo === "pdf" ? "DANFE" : "XML";
  const janela = window.open("", "_blank");   // aberta no clique, antes do await (bloqueador de pop-up)
  let url = null, erro = null;
  if(m[col] && String(m[col]).startsWith("nfe/")){
    const { data, error } = await sb.storage.from("fiscal-documentos").createSignedUrl(m[col], 120);
    url = data?.signedUrl || null;
    erro = error?.message || null;
  }
  if(!url && typeof podeEmitirFiscal === "function" && podeEmitirFiscal()){
    const r = await fiscalChamarFocus(tipo === "pdf" ? "baixar_pdf" : "baixar_xml", { movimentacao_id: m.id });
    url = r.data?.url || null;
    erro = r.erro || erro;
  }
  if(!url){
    if(janela) janela.close();
    aviso("app-aviso", `${nome}: ${erro || "arquivo ainda não disponível"}.`, "erro");
    return;
  }
  if(janela) janela.location.href = url; else window.open(url, "_blank");
  if(!m[col]) await movNfeRecarregar();
}
function movNfeCartaCorrecao(){
  const m = movimentacaoAtual;
  movNfeModal({
    titulo: `Carta de correção · NF ${m.nf_numero || ""}`,
    corpo: `<p class="nota">Corrige dado que não muda o imposto, o remetente/destinatário nem as datas (regra da SEFAZ). Vale sempre a última carta; até 20 por nota. Já enviadas: ${Number(m.nf_cce_sequencia) || 0}.</p>`,
    texto: true, rotulo: "Texto da correção", min: 15, max: 1000, botao: "✎ Enviar carta de correção",
    onOk: async (txt) => {
      const r = await fiscalChamarFocus("carta_correcao", { movimentacao_id: m.id, correcao: txt });
      if(r.erro){ aviso("app-aviso", "Carta de correção: " + r.erro, "erro"); return; }
      movNfeModalFechar();
      aviso("app-aviso", `Carta de correção ${r.data.sequencia || ""} registrada na SEFAZ.`, "ok");
      if(r.data.url) window.open(r.data.url, "_blank");
      await movNfeRecarregar();
    }
  });
}
function movNfeCancelar(){
  const m = movimentacaoAtual;
  const horas = m.nf_data_autorizacao ? (Date.now() - new Date(m.nf_data_autorizacao).getTime()) / 3600000 : 0;
  movNfeModal({
    titulo: `Cancelar NF-e · NF ${m.nf_numero || ""}`,
    corpo: `<div class="dist-aviso ${horas > 24 ? "perigo" : "alerta"}">${horas > 24
      ? `A nota foi autorizada há ${Math.floor(horas)} h: a SEFAZ costuma aceitar o cancelamento só nas primeiras 24 h. Pode tentar; se recusar, fale com o contador.`
      : "O cancelamento é definitivo. Para levar a carga depois, crie outro documento."}</div>`,
    texto: true, rotulo: "Motivo do cancelamento", min: 15, max: 255, botao: "✗ Cancelar a NF-e", perigo: true,
    onOk: async (txt) => {
      const r = await fiscalChamarFocus("cancelar", { movimentacao_id: m.id, justificativa: txt });
      if(r.erro){ aviso("app-aviso", "Cancelamento: " + r.erro, "erro"); return; }
      movNfeModalFechar();
      aviso("app-aviso", "NF-e cancelada" + (r.data.mensagem ? ": " + r.data.mensagem : "."), "ok");
      await movNfeRecarregar();
    }
  });
}
function movNfeInutilizar(){
  const m = movimentacaoAtual;
  movNfeModal({
    titulo: `Inutilizar o número ${m.nf_numero}/${m.nf_serie || ""}`,
    corpo: `<p class="nota">O número ${esc(m.nf_numero)} da série ${esc(m.nf_serie || "")} ficou reservado para esta nota rejeitada. Inutilize só se este documento não vai mais ser emitido: a SEFAZ registra o salto da numeração.</p>`,
    texto: true, rotulo: "Justificativa", min: 15, max: 255, botao: "Inutilizar o número", perigo: true,
    onOk: async (txt) => {
      const r = await fiscalChamarFocus("inutilizar", { movimentacao_id: m.id, numero_inicial: Number(m.nf_numero), numero_final: Number(m.nf_numero), serie: m.nf_serie, justificativa: txt });
      if(r.erro){ aviso("app-aviso", "Inutilização: " + r.erro, "erro"); return; }
      movNfeModalFechar();
      aviso("app-aviso", r.data.mensagem || "Número inutilizado.", "ok");
      await movNfeRecarregar();
    }
  });
}

/* ---------- Listeners ---------- */
function ligarFichaMovimentacao(){
  // Painel: visões + filtros + nova + clique nas linhas
  document.querySelectorAll("#mov-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#mov-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _movView = b.dataset.view;
      renderMovimentacoes();
    });
  });
  ["mov-busca","mov-f-status","mov-f-tipo"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "mov-busca" ? "input" : "change", id === "mov-busca" ? debounce(renderMovimentacoes) : renderMovimentacoes);
  });
  $("mov-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirMovimentacao(tr.dataset.id);
  });

  // Ficha — header actions
  $("btn-nova-movimentacao")?.addEventListener("click", novaMovimentacao);
  $("btn-voltar-mov")?.addEventListener("click", voltarParaLista);
  $("mov-frete")?.addEventListener("change", toggleTransportadorVisivel);
  ligarBuscaTransportadora();   // lote S46 (#88)
  $("mov-origem-tipo")?.addEventListener("change", toggleObraCampos);
  $("mov-destino-tipo")?.addEventListener("change", toggleObraCampos);
  $("mov-origem-obra")?.addEventListener("change", () => movObraEscolhida("origem"));
  $("mov-destino-obra")?.addEventListener("change", () => movObraEscolhida("destino"));
  ["origem","destino"].forEach(l => $(`mov-${l}-descricao`)?.addEventListener("input", (e) => { e.target.dataset.auto = "0"; }));
  $("btn-add-equipamento")?.addEventListener("click", adicionarEquipamento);
  $("btn-mov-ace-sug-todos")?.addEventListener("click", () => movSugMarcar(true));
  $("btn-mov-ace-sug-nenhum")?.addEventListener("click", () => movSugMarcar(false));
  $("btn-mov-ace-sug-add")?.addEventListener("click", movSugAdicionar);

  $("btn-salvar-rascunho")?.addEventListener("click", () => salvarMovimentacao(movimentacaoAtual?.status || "rascunho"));
  $("btn-marcar-emitida")?.addEventListener("click", async () => {
    if(!$("mov-nf-numero").value){
      aviso("app-aviso","Informe o número da NF-e antes de marcar como emitida.","erro");
      ativarTab("fiscal");
      return;
    }
    await salvarMovimentacao("emitida");
  });
  $("btn-marcar-transito")?.addEventListener("click", () => salvarMovimentacao("em_transito"));
  $("btn-marcar-recebida")?.addEventListener("click", async () => {
    if(!confirm("Marcar como RECEBIDA? Isso atualiza a localização dos equipamentos e acessórios automaticamente.")) return;
    await salvarMovimentacao("recebida");
  });
  $("btn-cancelar")?.addEventListener("click", async () => {
    if(!confirm("Cancelar esta movimentação?")) return;
    await salvarMovimentacao("cancelada");
  });

  $("btn-sugerir-fiscais")?.addEventListener("click", sugerirDadosFiscais);
  $("btn-dados-uninfe")?.addEventListener("click", mostrarDadosUniNFe);
  $("btn-fechar-uninfe")?.addEventListener("click", () => { $("mov-uninfe-modal").style.display = "none"; });
  $("btn-copiar-uninfe")?.addEventListener("click", copiarUniNFe);
  $("btn-recomenda-mdf")?.addEventListener("click", verificarMDFRecomendado);

  // fase 105b: NF-e pelo app (Focus NFe)
  $("btn-mov-nfe-emitir")?.addEventListener("click", () => comBotaoTravado("btn-mov-nfe-emitir", movNfeEmitir));
  $("btn-mov-nfe-simular")?.addEventListener("click", () => comBotaoTravado("btn-mov-nfe-simular", movNfeSimularMostrar));
  $("btn-mov-nfe-consultar")?.addEventListener("click", () => comBotaoTravado("btn-mov-nfe-consultar", movNfeConsultar));
  $("btn-mov-nfe-danfe")?.addEventListener("click", () => comBotaoTravado("btn-mov-nfe-danfe", () => movNfeArquivo("pdf")));
  $("btn-mov-nfe-xml")?.addEventListener("click", () => comBotaoTravado("btn-mov-nfe-xml", () => movNfeArquivo("xml")));
  $("btn-mov-nfe-cce")?.addEventListener("click", movNfeCartaCorrecao);
  $("btn-mov-nfe-cancelar")?.addEventListener("click", movNfeCancelar);
  $("btn-mov-nfe-inutilizar")?.addEventListener("click", movNfeInutilizar);
  $("btn-mov-nfe-modal-fechar")?.addEventListener("click", movNfeModalFechar);
  $("btn-mov-nfe-modal-ok")?.addEventListener("click", () => comBotaoTravado("btn-mov-nfe-modal-ok", () => _movNfeModalOk ? _movNfeModalOk() : null));

  // Notebook (abas internas)
  document.querySelectorAll("#mov-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTab(b.dataset.tab));
  });

  ligarStatusbarClicavel();
  configurarBuscaProdutos();
  configurarBuscaAcessorios();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarFichaMovimentacao);
} else {
  ligarFichaMovimentacao();
}

/* ====================================================================
   Módulo: Obras
   Layout: padrão Serviços (painel + ficha) + Odoo (statusbar, header
   actions, notebook). Ver memória feedback-padrao-ui.
   Cadastro, listagem, edição, exclusão.
   ==================================================================== */

let _obrRegistros = [];   // cache da lista (filtros client-side)
let _obrView      = "lista";
let obraEditId    = null; // null = nova; uuid = editando
let _obrContrato  = null; // contrato do cliente vinculado à obra aberta (fase 21)
let _obrContratoPend = []; // pendências do contrato da obra aberta (fase 26)
let _obrPendMap   = {};   // contrato_id -> [pendências] (badge na lista, fase 26)

/* Etapas do statusbar (ordem do enum obra_status) */
const OBR_STAGES = ["planejada","em_andamento","paralisada","concluida"];

/* Config dos anexos do contrato dentro da ficha da obra (ver contratos.js) */
const OBR_CON_DOC_CONF = {
  container: "obr-con-doc-conteudo",
  prefixo:   "obr-con-doc",
  smartBtn:  null,
  msgSemPai: "Preencha o número do contrato e salve a obra para anexar o contrato assinado."
};

/* ---------- Carga ---------- */
async function carregarObras(){
  const { data, error } = await sb.from("vw_obras_controle")
    .select("id,codigo,nome,cliente_id,contrato_id,status,valor_contratado,data_inicio,data_fim_prevista,responsavel_id,cidade,uf")
    .order("codigo");
  if(error){
    _obrRegistros = [];
  } else {
    _obrRegistros = data || [];
    mapaObras = {};
    _obrRegistros.forEach(o => mapaObras[o.id] = `${o.codigo} — ${o.nome}`);
  }
  await carregarPendenciasObras();
  renderObras();

  // alimenta selects que dependem de obras
  const selectMedObra = $("med-obra");
  if(selectMedObra){
    preencherSelect(selectMedObra,
      _obrRegistros.map(o => ({ id:o.id, txt:`${o.codigo} — ${o.nome}` })),
      "id","txt","— selecione —");
  }
}

/* Carrega as pendências de contrato (mesma fonte da Carteira) e indexa por
   contrato_id, para destacar na lista/kanban de obras. Falha em silêncio
   se o perfil não puder ler a view. (fase 26) */
async function carregarPendenciasObras(){
  _obrPendMap = {};
  try {
    const { data, error } = await sb.from("vw_pendencias_contratos")
      .select("contrato_id,tipo,severidade");
    if(error || !data) return;
    data.forEach(p => { (_obrPendMap[p.contrato_id] ||= []).push(p); });
  } catch(_e) { /* sem permissão / view ausente: sem badge */ }
}

/* Badge de pendência para a lista/kanban de obras. Saldo negativo (precisa
   de aditivo) tem destaque vermelho; demais pendências, âmbar com contagem. */
function obrPendBadge(o){
  const pend = (o && o.contrato_id) ? _obrPendMap[o.contrato_id] : null;
  if(!pend || !pend.length) return "";
  if(pend.some(p => p.tipo === "saldo_negativo"))
    return `<span class="tag vermelho" title="Saldo negativo — precisa de aditivo">precisa aditivo</span>`;
  return `<span class="tag ambar" title="${pend.length} pendência(s) no contrato deste cliente">${pend.length} pend.</span>`;
}

/* ---------- Filtros ---------- */
function obrFiltradas(){
  const termo = ($("obr-busca")?.value || "").trim().toLowerCase();
  const fStatus = $("obr-f-status")?.value || "";
  const fCliente = $("obr-f-cliente")?.value || "";
  return _obrRegistros.filter(o => {
    if(fStatus && o.status !== fStatus) return false;
    if(fCliente && o.cliente_id !== fCliente) return false;
    if(termo){
      const alvo = `${o.codigo||""} ${o.nome||""} ${mapaClientes[o.cliente_id]||""} ${o.cidade||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function preencherFiltrosObras(){
  // Status
  const sel = $("obr-f-status");
  if(sel && !sel.options.length){
    sel.innerHTML = `<option value="">Todos os status</option>` + opcoesStatus("obra");
  }
  // Cliente (popula a partir do mapaClientes carregado em core.js)
  const selCli = $("obr-f-cliente");
  if(selCli){
    const atual = selCli.value; // preserva a seleção (o render roda a cada tecla)
    const lista = Object.entries(mapaClientes).map(([id, nome]) => ({ id, nome }));
    selCli.innerHTML = `<option value="">Todos os clientes</option>` +
      lista.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
    selCli.value = atual;
  }
}

/* ---------- Render ---------- */
function renderObras(){
  preencherFiltrosObras();
  const dados = obrFiltradas();
  const cont = $("obr-contador");
  if(cont) cont.textContent = `${dados.length} de ${_obrRegistros.length}`;
  if(_obrView === "kanban") renderObrasKanban(dados);
  else                       renderObrasLista(dados);
  // mantém compatibilidade com código antigo que esperava #tab-obras populado
  const legacy = $("tab-obras");
  if(legacy && _obrView === "lista"){
    // já está dentro de #obr-conteudo, mas alguns lugares usam isto para contar; deixamos vazio aqui
    legacy.innerHTML = "";
  }
}

function renderObrasLista(dados){
  const cont = $("obr-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhuma obra encontrada.</p>`;
    return;
  }
  const linhas = dados.map(o => `<tr class="linha-clicavel" data-id="${esc(o.id)}">
    <td>${esc(o.codigo)} ${obrPendBadge(o)}</td>
    <td>${esc(o.nome)}</td>
    <td>${esc(mapaClientes[o.cliente_id] || "—")}</td>
    <td>${esc((o.cidade||"") + (o.uf ? "/" + o.uf.toUpperCase() : ""))}</td>
    <td>${dataBR(o.data_inicio)}</td>
    <td>${tagStatus("obra", o.status)}</td>
    <td class="num">${brl(o.valor_contratado)}</td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Código</th><th>Nome</th><th>Cliente</th><th>Cidade/UF</th>
      <th>Início</th><th>Status</th><th class="num">Valor contratado</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderObrasKanban(dados){
  const cont = $("obr-conteudo");
  if(!cont) return;
  const colunas = OBR_STAGES.concat(["cancelada"]).map(st => {
    const itens = dados.filter(o => o.status === st);
    if(!itens.length && st === "cancelada") return "";
    const stMeta = (STATUS.obra && STATUS.obra[st]) || { label: st, cor: "cinza" };
    const cards = itens.map(o => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(o.id)}">
        <div class="serv-kan-card-nome">${esc(o.codigo)} · ${esc(o.nome)}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${esc(mapaClientes[o.cliente_id]||"—")}</span>
          ${obrPendBadge(o)}
        </div>
        <div class="serv-kan-card-rod">
          <span>${o.cidade ? esc(o.cidade) + "/" + esc((o.uf||"").toUpperCase()) : "—"}</span>
          <strong>${brl(o.valor_contratado)}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  habilitarDragKanban({
    container: "#obr-conteudo .serv-kanban",
    tabela: "obras",
    onUpdate: async () => { await carregarObras(); }
  });
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelObra(){
  $("obr-painel").style.display = "";
  $("obr-ficha").style.display = "none";
  obraEditId = null;
  _obrContrato = null;
}

function novaObra(){
  obraEditId = null;
  _obrContrato = null;
  // limpa form
  $("obr-codigo").value = "";
  $("obr-nome").value = "";
  $("obr-cliente").value = "";
  $("obr-status").value = "planejada";
  $("obr-responsavel").value = "";
  $("obr-inicio").value = "";
  $("obr-fim-prev").value = "";
  $("obr-fim-real").value = "";
  $("obr-valor").value = 0;
  $("obr-cep").value = "";
  $("obr-logradouro").value = "";
  $("obr-numero").value = "";
  $("obr-complemento").value = "";
  $("obr-bairro").value = "";
  $("obr-cidade").value = "";
  $("obr-uf").value = "";
  $("obr-descricao").value = "";
  $("obr-obs").value = "";
  limparAbaContratoObra();

  $("btn-excluir-obra").style.display = "none";
  abrirFichaObra({ codigo: "", nome: "(nova)", status: "planejada", valor_contratado: 0 });
  // Sem sugestão automática de código: sugerirNumeros() contava um <tbody> sempre
  // vazio e propunha "OB-0001" (já usado → erro de UNIQUE). O código da obra
  // segue o padrão da CGL (ex.: 7822-2025) e é informado pelo usuário.
}

async function abrirObra(id){
  const { data, error } = await sb.from("obras").select("*").eq("id", id).single();
  if(error){ aviso("app-aviso","Erro ao abrir obra: "+error.message, "erro"); return; }
  obraEditId = id;

  $("obr-codigo").value = data.codigo || "";
  $("obr-nome").value = data.nome || "";
  $("obr-cliente").value = data.cliente_id || "";
  $("obr-status").value = data.status || "planejada";
  $("obr-responsavel").value = data.responsavel_id || "";
  $("obr-inicio").value = data.data_inicio || "";
  $("obr-fim-prev").value = data.data_fim_prevista || "";
  $("obr-fim-real").value = data.data_fim_real || "";
  $("obr-valor").value = data.valor_contratado || 0;
  $("obr-cep").value = data.cep || "";
  $("obr-logradouro").value = data.logradouro || "";
  $("obr-numero").value = data.numero || "";
  $("obr-complemento").value = data.complemento || "";
  $("obr-bairro").value = data.bairro || "";
  $("obr-cidade").value = data.cidade || "";
  $("obr-uf").value = data.uf || "";
  $("obr-descricao").value = data.descricao || "";
  $("obr-obs").value = data.observacoes || "";

  await carregarContratoDaObra(data.contrato_id);

  $("btn-excluir-obra").style.display = "";
  abrirFichaObra(data);
}

/* ====================================================================
   ABA CONTRATO — o contrato do cliente vive dentro da obra (fase 21)

   A tabela `contratos` continua sendo a fonte; a obra guarda o vínculo
   em contrato_id. Cliente, valor, datas e responsável são espelhados da
   obra ao salvar, então só os campos propriamente contratuais aparecem
   aqui.
   ==================================================================== */
function limparAbaContratoObra(){
  _obrContrato = null;
  _obrContratoPend = [];
  const box = $("obr-con-pendencias"); if(box) box.innerHTML = "";
  ["obr-con-numero","obr-con-assinatura","obr-con-orcamento","obr-con-indice","obr-con-descricao"]
    .forEach(k => { const el = $(k); if(el) el.value = ""; });
  const cat = $("obr-con-categoria"); if(cat) cat.value = "empreitada";
  const st  = $("obr-con-status");    if(st)  st.value  = "em_elaboracao";
  atualizarBadgeContratoObra();
}

async function carregarContratoDaObra(contratoId){
  if(!contratoId){ limparAbaContratoObra(); return; }
  const { data, error } = await sb.from("contratos").select("*").eq("id", contratoId).single();
  if(error || !data){ limparAbaContratoObra(); return; }
  _obrContrato = data;
  $("obr-con-numero").value     = data.numero || "";
  $("obr-con-categoria").value  = data.categoria || "empreitada";
  $("obr-con-status").value     = data.status || "em_elaboracao";
  $("obr-con-assinatura").value = data.data_assinatura || "";
  $("obr-con-orcamento").value  = data.orcamento_id || "";
  $("obr-con-indice").value     = data.indice_reajuste || "";
  $("obr-con-descricao").value  = data.descricao || "";
  atualizarBadgeContratoObra();
  renderPendenciasContratoObra(contratoId);
}

/* Bloco de pendências do contrato dentro da ficha da Obra (fase 26).
   Mesma fonte da Carteira (vw_pendencias_contratos), para a engenharia
   ver e resolver sem depender do acesso à Carteira. */
async function renderPendenciasContratoObra(contratoId){
  const box = $("obr-con-pendencias");
  _obrContratoPend = [];
  if(box) box.innerHTML = "";
  if(!contratoId){ atualizarBadgeContratoObra(); return; }
  const { data, error } = await sb.from("vw_pendencias_contratos")
    .select("tipo,detalhe,valor_impacto,severidade").eq("contrato_id", contratoId);
  if(error){ atualizarBadgeContratoObra(); return; }
  const pend = (data || []).slice().sort((a,b) => (a.severidade||9) - (b.severidade||9));
  _obrContratoPend = pend;
  atualizarBadgeContratoObra();
  if(!box) return;
  if(!pend.length){
    box.innerHTML = `<div class="dist-aviso ok" style="margin-bottom:14px;">✓ Sem pendências neste contrato.</div>`;
    return;
  }
  const meta = (typeof CART_PEND_META !== "undefined") ? CART_PEND_META : {};
  const itens = pend.map(p => {
    const m = meta[p.tipo] || { label: p.tipo, cor: "cinza" };
    let txt = esc(p.detalhe || "");
    if(p.tipo === "saldo_negativo" && p.valor_impacto != null)
      txt += ` <strong>(excede ${brl(p.valor_impacto)} — abra um aditivo)</strong>`;
    return `<li><span class="tag ${m.cor}">${esc(m.label)}</span> ${txt}</li>`;
  }).join("");
  const grave = pend.some(p => (p.severidade || 9) === 1);
  box.innerHTML = `<div class="dist-aviso ${grave ? "alerta" : "neutro"}" style="margin-bottom:14px;">
    <strong>⚠️ ${pend.length} pendência(s) neste contrato</strong>
    <span class="meta">resolva o quanto antes — cada linha some sozinha quando o cadastro é corrigido</span>
    <ul style="margin:6px 0 0;padding-left:18px;">${itens}</ul>
  </div>`;
}

/* Badge da aba: ✓ quando há contrato, alerta quando ele ainda não foi assinado */
function atualizarBadgeContratoObra(){
  const badge = $("obr-con-badge");
  if(!badge) return;
  // Pendências (fase 26) têm prioridade no badge: mostra a contagem em alerta.
  const nPend = (_obrContratoPend || []).length;
  if(nPend){
    badge.textContent = String(nPend);
    badge.className   = "aba-badge alerta";
    badge.title       = `${nPend} pendência(s) no contrato — ver aba Contrato`;
    return;
  }
  if(!_obrContrato){ badge.textContent = ""; badge.className = "aba-badge"; return; }
  const pendente = !_obrContrato.data_assinatura;
  badge.textContent = pendente ? "!" : "✓";
  badge.className   = pendente ? "aba-badge alerta" : "aba-badge";
  badge.title       = pendente ? "Contrato sem data de assinatura" : "Contrato registrado";
}

/* Cria ou atualiza o contrato do cliente a partir dos dados da obra.
   Devolve o id do contrato, ou null se a obra não tem contrato. */
async function salvarContratoDaObra(obra){
  const numero = ($("obr-con-numero")?.value || "").trim();

  // Sem número e sem contrato prévio: a obra simplesmente não tem contrato.
  if(!numero && !_obrContrato) return null;

  // Tinha contrato e o número foi apagado: mantém o registro, só avisa.
  if(!numero && _obrContrato){
    aviso("app-aviso","O número do contrato ficou em branco — o contrato existente foi mantido.","erro");
    return _obrContrato.id;
  }

  const reg = {
    numero,
    natureza: "cliente",
    cliente_id: obra.cliente_id,
    fornecedor_id: null,
    orcamento_id: $("obr-con-orcamento").value || null,
    categoria: $("obr-con-categoria").value,
    status: $("obr-con-status").value,
    descricao: ($("obr-con-descricao").value || "").trim() || obra.descricao || null,
    responsavel_id: obra.responsavel_id,
    data_assinatura: $("obr-con-assinatura").value || null,
    data_inicio: obra.data_inicio,
    data_fim_prevista: obra.data_fim_prevista,
    valor_total: obra.valor_contratado || 0,
    indice_reajuste: ($("obr-con-indice").value || "").trim() || null
  };

  let result;
  if(_obrContrato){
    result = await sb.from("contratos").update(reg).eq("id", _obrContrato.id).select().single();
  } else {
    result = await sb.from("contratos").insert(reg).select().single();
  }
  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    const detalhe = (m.includes("duplicate") || m.includes("unique"))
      ? `já existe outro contrato com o número ${numero}`
      : result.error.message;
    aviso("app-aviso","Obra salva, mas o contrato não pôde ser gravado: "+detalhe,"erro");
    return _obrContrato ? _obrContrato.id : null;
  }
  _obrContrato = result.data;
  return result.data.id;
}

function abrirFichaObra(obra){
  $("obr-painel").style.display = "none";
  $("obr-ficha").style.display = "";

  // Chips de contexto
  $("obr-ficha-codigo").textContent = obra.codigo || "(novo)";
  $("obr-ficha-cliente-chip").textContent = mapaClientes[obra.cliente_id] || "—";
  $("obr-ficha-status-chip").innerHTML = tagStatus("obra", obra.status);
  $("obr-ficha-valor-chip").textContent = brl(obra.valor_contratado);
  $("obr-ficha-cidade-chip").textContent = obra.cidade
    ? `${obra.cidade}${obra.uf ? "/" + obra.uf.toUpperCase() : ""}`
    : "—";
  $("obr-ficha-titulo").textContent = obra.codigo ? `${obra.codigo} — ${obra.nome}` : "Nova obra";

  atualizarStatusbarObra(obra.status);
  ativarTabObra("geral");
  // Aba Contrato: badge + anexos + assinatura do contrato vinculado
  atualizarBadgeContratoObra();
  if(typeof carregarDocumentosDoContrato === "function"){
    carregarDocumentosDoContrato(_obrContrato ? _obrContrato.id : null, OBR_CON_DOC_CONF);
  }
  if(typeof renderBlocoAssinatura === "function"){
    renderBlocoAssinatura(_obrContrato, "obr-con-assinatura-bloco", {
      recarregar: async () => { await abrirObra(obraEditId); ativarTabObra("contrato"); }
    });
  }
  // Carrega estacas vinculadas (aba Estacas)
  if(typeof carregarEstacasDaObra === "function"){
    carregarEstacasDaObra(obraEditId);
  }
  // Carrega contagens dos smart-buttons (e prepara dados das abas)
  if(typeof carregarAbasObra === "function"){
    carregarAbasObra(obraEditId);
  }
}

function atualizarStatusbarObra(st){
  const bar = $("obr-statusbar");
  if(!bar) return;
  const idxAtual = OBR_STAGES.indexOf(st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    el.removeAttribute("aria-current"); // etapa atual é anunciada pelo leitor de tela
    const idx = OBR_STAGES.indexOf(el.dataset.status);
    if(st === "cancelada"){
      if(idx === OBR_STAGES.length - 1){ el.classList.add("cancelada"); el.setAttribute("aria-current", "step"); }
    } else if(idx === idxAtual){
      el.classList.add("atual");
      el.setAttribute("aria-current", "step");
    } else if(idx < idxAtual){
      el.classList.add("passada");
    }
  });
}

function ativarTabObra(nome){
  document.querySelectorAll("#obr-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#obr-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Salvar (insert ou update) ---------- */
async function salvarObra(novoStatus){
  const cliente_id = $("obr-cliente").value;
  if(!cliente_id){ aviso("app-aviso","Selecione o cliente da obra.","erro"); ativarTabObra("geral"); return; }
  if(!$("obr-codigo").value || !$("obr-nome").value){
    aviso("app-aviso","Preencha código e nome da obra.","erro"); ativarTabObra("geral"); return;
  }
  const reg = {
    codigo: $("obr-codigo").value.trim(),
    nome: $("obr-nome").value.trim(),
    cliente_id,
    status: novoStatus || $("obr-status").value,
    responsavel_id: $("obr-responsavel").value || null,
    data_inicio: $("obr-inicio").value || null,
    data_fim_prevista: $("obr-fim-prev").value || null,
    data_fim_real: $("obr-fim-real").value || null,
    valor_contratado: Number($("obr-valor").value || 0),
    cep: $("obr-cep").value.trim() || null,
    logradouro: $("obr-logradouro").value.trim() || null,
    numero: $("obr-numero").value.trim() || null,
    complemento: $("obr-complemento").value.trim() || null,
    bairro: $("obr-bairro").value.trim() || null,
    cidade: $("obr-cidade").value.trim() || null,
    uf: $("obr-uf").value || null,
    descricao: $("obr-descricao").value.trim() || null,
    observacoes: $("obr-obs").value.trim() || null
  };

  let result;
  if(obraEditId){
    result = await sb.from("obras").update(reg).eq("id", obraEditId).select().single();
  } else {
    result = await sb.from("obras").insert(reg).select().single();
  }
  if(result.error){
    aviso("app-aviso","Não foi possível salvar a obra: "+result.error.message,"erro");
    return;
  }
  obraEditId = result.data.id;
  $("btn-excluir-obra").style.display = "";
  $("obr-status").value = result.data.status;

  // Contrato do cliente (aba Contrato) — espelha os dados da obra recém-salva
  const contratoId = await salvarContratoDaObra(result.data);
  if(contratoId && contratoId !== result.data.contrato_id){
    const { error: errVinc } = await sb.from("obras")
      .update({ contrato_id: contratoId }).eq("id", obraEditId);
    if(errVinc) aviso("app-aviso","Contrato gravado, mas não foi possível vinculá-lo à obra: "+errVinc.message,"erro");
  }

  aviso("app-aviso","Obra salva com sucesso.","ok");
  await carregarObras();
  await carregarDashboard();
  if(typeof carregarContratos === "function") await carregarContratos();
  // re-abre com dados frescos
  await abrirObra(obraEditId);
}

async function excluirObra(){
  if(!obraEditId) return;
  if(!confirm("Excluir esta obra? Esta ação não pode ser desfeita.")) return;
  const { error } = await sb.from("obras").delete().eq("id", obraEditId);
  if(error){
    aviso("app-aviso","Não foi possível excluir: "+error.message,"erro");
    return;
  }
  aviso("app-aviso","Obra excluída.","ok");
  await carregarObras();
  await carregarDashboard();
  mostrarPainelObra();
}

/* ---------- Listeners ---------- */
function ligarObras(){
  // Painel: visões, filtros, clique nas linhas, nova obra
  document.querySelectorAll("#obr-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#obr-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _obrView = b.dataset.view;
      renderObras();
    });
  });
  ["obr-busca","obr-f-status","obr-f-cliente"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "obr-busca" ? "input" : "change", id === "obr-busca" ? debounce(renderObras) : renderObras);
  });
  $("obr-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirObra(tr.dataset.id);
  });

  $("btn-nova-obra")?.addEventListener("click", novaObra);
  $("btn-voltar-obra")?.addEventListener("click", mostrarPainelObra);
  $("btn-salvar-obra")?.addEventListener("click", () => comBotaoTravado("btn-salvar-obra", () => salvarObra()));
  $("btn-excluir-obra")?.addEventListener("click", excluirObra);

  // Notebook
  document.querySelectorAll("#obr-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabObra(b.dataset.tab));
  });

  // Statusbar clicável (muda status)
  document.querySelectorAll("#obr-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!obraEditId){
        // novo registro: só atualiza form
        $("obr-status").value = novo;
        atualizarStatusbarObra(novo);
        return;
      }
      if(novo === $("obr-status").value) return;
      await salvarObra(novo);
    });
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarObras);
} else {
  ligarObras();
}

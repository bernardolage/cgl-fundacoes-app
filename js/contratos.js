/* ====================================================================
   Módulo: Contratos de FORNECEDORES
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   Fluxo: em_elaboração → aguardando_assinatura → vigente → encerrado / rescindido / cancelado.

   Fase 21: o contrato do lado CLIENTE saiu daqui — ele duplicava a obra
   (cliente, valor, datas, status, responsável) e agora é editado na aba
   "Contrato" da ficha da Obra (ver obra_abas.js). Este módulo lista e
   edita apenas natureza = 'fornecedor'.
   ==================================================================== */

let _contratos = [];
let _conView   = "lista";
let conEditId  = null;

const CON_STAGES = ["em_elaboracao","aguardando_assinatura","vigente","encerrado"];

/* Categorias dos anexos de contrato (tabela contratos_documentos) */
const CON_DOC_CATEGORIAS = {
  contrato_assinado: "Contrato assinado",
  aditivo:           "Aditivo",
  proposta:          "Proposta",
  anexo:             "Anexo",
  outro:             "Outro"
};

/* ---------- Vencimento ---------- */
/* Dias até o fim da vigência (negativo = já venceu; null = sem data) */
function diasParaVencer(c){
  if(!c || !c.data_fim_prevista) return null;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const fim  = new Date(String(c.data_fim_prevista).slice(0,10) + "T00:00:00");
  return Math.round((fim - hoje) / 86400000);
}

/* Contrato está dentro da janela de aviso configurada nele mesmo? */
function contratoEmAlerta(c){
  if(c.status !== "vigente") return false;
  const dias = diasParaVencer(c);
  if(dias === null) return false;
  const janela = Number(c.aviso_vencimento_dias || 0) || 30;
  return dias <= janela;
}

/* Usado pelo dashboard (js/dashboard.js) para as ações pendentes */
async function contratosVencendo(){
  const { data } = await sb.from("contratos")
    .select("id,numero,fornecedor_id,status,data_fim_prevista,aviso_vencimento_dias,renovacao_automatica")
    .eq("natureza","fornecedor")
    .eq("status","vigente")
    .not("data_fim_prevista","is",null);
  return (data || []).filter(contratoEmAlerta)
    .sort((a,b) => diasParaVencer(a) - diasParaVencer(b));
}

/* ---------- Carga ---------- */
async function carregarContratos(){
  const { data, error } = await sb.from("contratos")
    .select("id,numero,fornecedor_id,categoria,status,valor_total,descricao,data_inicio,data_fim_prevista,aviso_vencimento_dias,renovacao_automatica")
    .eq("natureza","fornecedor")
    .order("created_at",{ ascending:false });
  _contratos = error ? [] : (data || []);
  renderContratos();
}

/* ---------- Filtros ---------- */
function conFiltrados(){
  const termo = ($("con-busca")?.value || "").trim().toLowerCase();
  const fStat = $("con-f-status")?.value || "";
  const fCat  = $("con-f-categoria")?.value || "";
  const fVenc = $("con-f-vencimento")?.value || "";
  return _contratos.filter(c => {
    if(fStat && c.status !== fStat) return false;
    if(fCat  && c.categoria !== fCat) return false;
    if(fVenc){
      const dias = diasParaVencer(c);
      if(dias === null) return false;
      if(fVenc === "vencidos"){ if(dias >= 0) return false; }
      else if(dias < 0 || dias > Number(fVenc)) return false;
    }
    if(termo){
      const alvo = `${c.numero||""} ${mapaFornecedores[c.fornecedor_id]||""} ${c.descricao||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function preencherFiltrosCon(){
  const selSt = $("con-f-status");
  if(selSt && !selSt.options.length){
    selSt.innerHTML = `<option value="">Todos os status</option>` + opcoesStatus("contrato");
  }
  const selCat = $("con-f-categoria");
  if(selCat && !selCat.options.length){
    selCat.innerHTML = `<option value="">Todas as categorias</option>` +
      Object.entries(CONTRATO_CATEGORIA).map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  }
}

/* ---------- Render ---------- */
function renderContratos(){
  preencherFiltrosCon();
  const dados = conFiltrados();
  const cont = $("con-contador");
  if(cont) cont.textContent = `${dados.length} de ${_contratos.length}`;
  renderAlertaVencimento();
  if(_conView === "kanban") renderConKanban(dados);
  else                       renderConLista(dados);
  const legacy = $("tab-contratos");
  if(legacy) legacy.innerHTML = "";
}

/* Faixa de alerta no topo do painel */
function renderAlertaVencimento(){
  const cont = $("con-alerta-venc");
  if(!cont) return;
  const emAlerta = _contratos.filter(contratoEmAlerta)
    .sort((a,b) => diasParaVencer(a) - diasParaVencer(b));
  if(!emAlerta.length){ cont.innerHTML = ""; return; }

  const temVencido = emAlerta.some(c => diasParaVencer(c) < 0);
  const itens = emAlerta.slice(0,6).map(c => {
    const dias = diasParaVencer(c);
    const quando = dias < 0
      ? `venceu há ${Math.abs(dias)} dia(s)`
      : dias === 0 ? "vence hoje" : `vence em ${dias} dia(s)`;
    const renova = c.renovacao_automatica ? " · renova automaticamente" : "";
    return `<li><button type="button" class="con-alerta-link" data-id="${esc(c.id)}"><strong>${esc(c.numero)}</strong></button>
      — ${esc(mapaFornecedores[c.fornecedor_id] || "fornecedor não informado")}, ${quando} (${dataBR(c.data_fim_prevista)})${renova}</li>`;
  }).join("");
  const resto = emAlerta.length > 6 ? `<li>… e mais ${emAlerta.length - 6} contrato(s).</li>` : "";

  cont.innerHTML = `<div class="con-alerta${temVencido ? " critico" : ""}">
    <span class="con-alerta-icone">${temVencido ? "⛔" : "⏰"}</span>
    <div>
      <strong>${emAlerta.length} contrato(s) exigindo atenção</strong>
      <ul>${itens}${resto}</ul>
    </div>
  </div>`;
  cont.querySelectorAll(".con-alerta-link").forEach(b => {
    b.addEventListener("click", () => abrirContrato(b.dataset.id));
  });
}

/* Tag de dias restantes ao lado da data de fim */
function tagDias(c){
  if(c.status !== "vigente") return "";
  const dias = diasParaVencer(c);
  if(dias === null) return "";
  const janela = Number(c.aviso_vencimento_dias || 0) || 30;
  if(dias > janela) return "";
  const txt = dias < 0 ? `${Math.abs(dias)}d vencido` : `${dias}d`;
  return `<span class="con-dias-tag${dias < 0 ? " critico" : ""}">${txt}</span>`;
}

function renderConLista(dados){
  const cont = $("con-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum contrato encontrado.</p>`;
    return;
  }
  const linhas = dados.map(c => {
    const dias = diasParaVencer(c);
    let classe = "linha-clicavel";
    if(contratoEmAlerta(c)) classe += dias < 0 ? " con-vencido" : " con-vencendo";
    return `<tr class="${classe}" data-id="${esc(c.id)}">
      <td>${esc(c.numero)}</td>
      <td>${esc(mapaFornecedores[c.fornecedor_id] || "—")}</td>
      <td>${esc(CONTRATO_CATEGORIA[c.categoria] || c.categoria || "—")}</td>
      <td>${dataBR(c.data_inicio)}</td>
      <td>${dataBR(c.data_fim_prevista)}${tagDias(c)}</td>
      <td>${tagStatus("contrato", c.status)}</td>
      <td class="num">${brl(c.valor_total)}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Número</th><th>Fornecedor</th><th>Categoria</th>
      <th>Início</th><th>Fim da vigência</th><th>Status</th><th class="num">Valor</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderConKanban(dados){
  const cont = $("con-conteudo");
  if(!cont) return;
  const colunas = CON_STAGES.concat(["rescindido","cancelado","vencido"]).map(st => {
    const itens = dados.filter(c => c.status === st);
    if(!itens.length && (st === "rescindido" || st === "cancelado" || st === "vencido")) return "";
    const stMeta = (STATUS.contrato && STATUS.contrato[st]) || { label: st, cor: "cinza" };
    const cards = itens.map(c => `<div class="serv-kan-card linha-clicavel" data-id="${esc(c.id)}">
        <div class="serv-kan-card-nome">${esc(c.numero)} · ${esc(mapaFornecedores[c.fornecedor_id] || "—")}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${esc(CONTRATO_CATEGORIA[c.categoria] || "—")}</span>
          ${tagDias(c)}
        </div>
        <div class="serv-kan-card-rod">
          <span>${c.data_fim_prevista ? "Até " + dataBR(c.data_fim_prevista) : ""}</span>
          <strong>${brl(c.valor_total)}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  habilitarDragKanban({
    container: "#con-conteudo .serv-kanban",
    tabela: "contratos",
    onUpdate: async () => { await carregarContratos(); }
  });
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelCon(){
  $("con-painel").style.display = "";
  $("con-ficha").style.display = "none";
  conEditId = null;
}

/* Próximo número CT- livre.
   contratos.numero é UNIQUE na tabela inteira, então a sugestão precisa
   olhar também os contratos de cliente (que nascem na ficha da obra). */
async function proximoNumeroContrato(){
  const { data } = await sb.from("contratos").select("numero").like("numero","CT-%");
  const usados = (data || [])
    .map(c => /^CT-(\d+)$/.exec((c.numero || "").trim()))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));
  const proximo = usados.length ? Math.max(...usados) + 1 : 1;
  return "CT-" + String(proximo).padStart(4, "0");
}

async function novoContrato(){
  conEditId = null;
  ["con-descricao","con-fornecedor","con-responsavel","con-assinatura",
   "con-inicio","con-fim","con-indice","con-obs"
  ].forEach(k => { const el = $(k); if(el) el.value = ""; });
  $("con-numero").value = await proximoNumeroContrato();
  $("con-categoria").value = "prestacao_servico";
  $("con-status").value = "em_elaboracao";
  $("con-renovacao").checked = false;
  $("con-aviso").value = 30;
  $("con-recorrencia").value = "unica";
  $("con-valor-rec").value = 0;
  $("con-dia-venc").value = "";
  $("con-valor").value = 0;
  $("btn-excluir-con").style.display = "none";
  abrirFichaConVisual({ numero: $("con-numero").value, status: "em_elaboracao", valor_total: 0, categoria: "prestacao_servico" });
}

async function abrirContrato(id){
  conEditId = id;
  const { data:c, error } = await sb.from("contratos").select("*").eq("id",id).single();
  if(error){ aviso("app-aviso","Erro ao abrir contrato: "+error.message,"erro"); return; }
  $("con-numero").value = c.numero || "";
  $("con-fornecedor").value = c.fornecedor_id || "";
  $("con-categoria").value = c.categoria || "prestacao_servico";
  $("con-status").value = c.status || "em_elaboracao";
  $("con-descricao").value = c.descricao || "";
  $("con-responsavel").value = c.responsavel_id || "";
  $("con-assinatura").value = c.data_assinatura || "";
  $("con-inicio").value = c.data_inicio || "";
  $("con-fim").value = c.data_fim_prevista || "";
  $("con-renovacao").checked = c.renovacao_automatica === true;
  $("con-aviso").value = c.aviso_vencimento_dias != null ? c.aviso_vencimento_dias : 30;
  $("con-recorrencia").value = c.forma_recorrencia || "unica";
  $("con-valor-rec").value = c.valor_recorrente || 0;
  $("con-dia-venc").value = c.dia_vencimento || "";
  $("con-valor").value = c.valor_total || 0;
  $("con-indice").value = c.indice_reajuste || "";
  $("con-obs").value = c.observacoes || "";
  $("btn-excluir-con").style.display = "";
  abrirFichaConVisual(c);
}

let _conAtual = null; // registro completo do contrato aberto (usado pela assinatura)

function abrirFichaConVisual(c){
  _conAtual = c;
  $("con-painel").style.display = "none";
  $("con-ficha").style.display = "";

  $("con-ficha-numero").textContent = c.numero || "(novo)";
  $("con-ficha-contraparte-chip").textContent = mapaFornecedores[c.fornecedor_id] || "—";
  $("con-ficha-categoria-chip").textContent = CONTRATO_CATEGORIA[c.categoria] || "—";
  $("con-ficha-status-chip").innerHTML = tagStatus("contrato", c.status);
  $("con-ficha-valor-chip").textContent = brl(c.valor_total || 0);
  const dias = diasParaVencer(c);
  $("con-ficha-vigencia-chip").innerHTML = c.data_inicio || c.data_fim_prevista
    ? `${dataBR(c.data_inicio)}${c.data_fim_prevista ? " → " + dataBR(c.data_fim_prevista) : ""}${tagDias(c)}`
    : "—";
  $("con-ficha-titulo").textContent = conEditId ? `Contrato ${c.numero}` : "Novo contrato";

  const chipAssin = $("con-ficha-assinatura-chip");
  if(chipAssin) chipAssin.innerHTML = tagAssinatura(c.assinatura_status);

  atualizarStatusbarCon(c.status);
  ativarTabCon("geral");
  carregarDocumentosDoContrato(conEditId);
  renderBlocoAssinatura(conEditId ? c : null, "con-assinatura-bloco", {
    recarregar: () => abrirContrato(conEditId)
  });
}

function atualizarStatusbarCon(st){
  const bar = $("con-statusbar");
  if(!bar) return;
  const idxAtual = CON_STAGES.indexOf(st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    const idx = CON_STAGES.indexOf(el.dataset.status);
    if(st === "rescindido" || st === "cancelado" || st === "vencido"){
      if(idx === CON_STAGES.length - 1) el.classList.add("cancelada");
    } else if(idx === idxAtual){
      el.classList.add("atual");
    } else if(idx >= 0 && idx < idxAtual){
      el.classList.add("passada");
    }
  });
}

function ativarTabCon(nome){
  document.querySelectorAll("#con-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#con-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Salvar / excluir ---------- */
async function salvarContrato(novoStatus){
  const fornecedor_id = $("con-fornecedor").value || null;
  if(!fornecedor_id){ aviso("app-aviso","Selecione o fornecedor.","erro"); ativarTabCon("geral"); return; }
  if(!$("con-numero").value){ aviso("app-aviso","Informe o número.","erro"); ativarTabCon("geral"); return; }

  const dia = $("con-dia-venc").value;
  const reg = {
    numero: $("con-numero").value.trim(),
    natureza: "fornecedor",
    cliente_id: null,
    fornecedor_id,
    orcamento_id: null,
    categoria: $("con-categoria").value,
    status: novoStatus || $("con-status").value,
    descricao: $("con-descricao").value.trim() || null,
    responsavel_id: $("con-responsavel").value || null,
    data_assinatura: $("con-assinatura").value || null,
    data_inicio: $("con-inicio").value || null,
    data_fim_prevista: $("con-fim").value || null,
    renovacao_automatica: $("con-renovacao").checked,
    aviso_vencimento_dias: Number($("con-aviso").value || 0),
    forma_recorrencia: $("con-recorrencia").value,
    valor_recorrente: Number($("con-valor-rec").value || 0),
    dia_vencimento: dia ? Number(dia) : null,
    valor_total: Number($("con-valor").value || 0),
    indice_reajuste: $("con-indice").value.trim() || null,
    observacoes: $("con-obs").value.trim() || null
  };

  let result;
  if(conEditId){
    result = await sb.from("contratos").update(reg).eq("id", conEditId).select().single();
  } else {
    result = await sb.from("contratos").insert(reg).select().single();
  }
  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    if(m.includes("duplicate") || m.includes("unique")){
      aviso("app-aviso",`Já existe um contrato com o número ${reg.numero} (o número é único no sistema inteiro, incluindo os contratos de obra).`,"erro");
      ativarTabCon("geral");
    } else {
      aviso("app-aviso","Não foi possível salvar: "+result.error.message,"erro");
    }
    return;
  }
  conEditId = result.data.id;
  $("btn-excluir-con").style.display = "";
  $("con-status").value = result.data.status;
  aviso("app-aviso","Contrato salvo.","ok");
  await carregarContratos();
  await abrirContrato(conEditId);
}

async function excluirContrato(){
  if(!conEditId) return;
  if(!confirm("Excluir este contrato? Os anexos enviados também serão removidos.")) return;
  // Remove os arquivos do Storage antes (o delete em cascata só apaga os metadados)
  const { data: docs } = await sb.from("contratos_documentos")
    .select("storage_path").eq("contrato_id", conEditId);
  if(docs && docs.length){
    await sb.storage.from("contratos-docs").remove(docs.map(d => d.storage_path));
  }
  const { error } = await sb.from("contratos").delete().eq("id", conEditId);
  if(error){ aviso("app-aviso","Não foi possível excluir: "+error.message,"erro"); return; }
  aviso("app-aviso","Contrato excluído.","ok");
  await carregarContratos();
  mostrarPainelCon();
}

/* ====================================================================
   ABA DOCUMENTOS — anexos do contrato (bucket contratos-docs)

   Serve duas fichas: a do contrato de fornecedor (padrão) e a aba
   Contrato da obra, que passa outro container/prefixo em `opts`.
   ==================================================================== */
const CON_DOC_PADRAO = {
  container:  "con-doc-conteudo",
  prefixo:    "con-doc",
  smartBtn:   "sb-con-documentos",
  msgSemPai:  "Salve o contrato primeiro para anexar arquivos."
};

async function carregarDocumentosDoContrato(contratoId, opts){
  const conf = Object.assign({}, CON_DOC_PADRAO, opts || {});
  const cont = $(conf.container);
  if(!cont) return;
  const setSB = (n) => {
    const el = conf.smartBtn ? $(conf.smartBtn) : null;
    if(!el) return;
    el.querySelector(".sb-num").textContent = n || 0;
    el.classList.toggle("zero", !n);
  };

  if(!contratoId){
    cont.innerHTML = `<p class="vazio">${esc(conf.msgSemPai)}</p>`;
    setSB(0);
    return;
  }

  const { data, error } = await sb.from("contratos_documentos")
    .select("id,categoria,nome,descricao,storage_path,mime_type,tamanho_bytes,created_at")
    .eq("contrato_id", contratoId)
    .order("created_at", { ascending:false });
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; setSB(0); return; }
  setSB((data||[]).length);

  const px   = conf.prefixo;
  const cats = Object.entries(CON_DOC_CATEGORIAS)
    .map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  const uploader = `
    <div class="card" style="margin-bottom:14px;padding:12px;">
      <h4 style="margin:0 0 8px;font-size:13px;">📤 Anexar arquivo</h4>
      <div class="grade">
        <div class="campo"><label>Tipo</label>
          <select id="${px}-categoria">${cats}</select>
        </div>
        <div class="campo"><label>Descrição (opcional)</label>
          <input id="${px}-descricao" placeholder="ex.: 1º aditivo de prazo" />
        </div>
        <div class="campo largo"><label>Arquivo — PDF, Word ou imagem (máx. 20MB)</label>
          <input id="${px}-arquivo" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
        </div>
      </div>
      <div class="form-acoes">
        <button type="button" class="btn" id="btn-${px}-enviar">📤 Enviar</button>
      </div>
    </div>`;

  if(!data || !data.length){
    cont.innerHTML = `${uploader}<p class="vazio">Nenhum arquivo anexado ainda.</p>`;
    $(`btn-${px}-enviar`)?.addEventListener("click", () => enviarDocumentoContrato(contratoId, conf));
    return;
  }

  const linhas = data.map(d => {
    const tamKB = d.tamanho_bytes ? (d.tamanho_bytes/1024).toFixed(0) + " KB" : "—";
    return `<tr>
      <td>📄 ${esc(d.nome)}</td>
      <td>${esc(CON_DOC_CATEGORIAS[d.categoria] || d.categoria)}</td>
      <td>${esc(d.descricao || "—")}</td>
      <td>${tamKB}</td>
      <td>${new Date(d.created_at).toLocaleDateString("pt-BR")}</td>
      <td class="col-acao">
        <button type="button" class="btn-sec btn-sm doc-con-baixar" data-path="${esc(d.storage_path)}" data-nome="${esc(d.nome)}" title="Baixar">⬇️</button>
        <button type="button" class="btn-sec btn-sm doc-con-excluir txt-perigo" data-id="${esc(d.id)}" data-path="${esc(d.storage_path)}" title="Excluir">🗑️</button>
      </td>
    </tr>`;
  }).join("");

  cont.innerHTML = `${uploader}<div class="tabela-rola"><table>
    <thead><tr><th>Arquivo</th><th>Tipo</th><th>Descrição</th><th>Tamanho</th><th>Enviado em</th><th class="col-acao"></th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;

  $(`btn-${px}-enviar`)?.addEventListener("click", () => enviarDocumentoContrato(contratoId, conf));
  cont.querySelectorAll(".doc-con-baixar").forEach(b => {
    b.addEventListener("click", () => baixarDocumentoContrato(b.dataset.path, b.dataset.nome));
  });
  cont.querySelectorAll(".doc-con-excluir").forEach(b => {
    b.addEventListener("click", () => excluirDocumentoContrato(b.dataset.id, b.dataset.path, contratoId, conf));
  });
}

async function enviarDocumentoContrato(contratoId, opts){
  const conf = Object.assign({}, CON_DOC_PADRAO, opts || {});
  const px   = conf.prefixo;
  const inp  = $(`${px}-arquivo`);
  if(!inp?.files || !inp.files[0]){ aviso("app-aviso","Selecione um arquivo.","erro"); return; }
  const file = inp.files[0];
  if(file.size > 20971520){ aviso("app-aviso","Arquivo maior que 20MB.","erro"); return; }

  const btn = $(`btn-${px}-enviar`);
  btn.disabled = true;
  const txtOrig = btn.textContent;
  btn.textContent = "Enviando...";

  try {
    // Extensão entra no caminho do storage: só letras/dígitos (1-5), senão "bin"
    const ext = (String(file.name.split(".").pop()||"").toLowerCase().match(/^[a-z0-9]{1,5}$/)||[])[0] || "bin";
    const nomeUnico = `${contratoId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const { error: errUp } = await sb.storage.from("contratos-docs").upload(nomeUnico, file, {
      cacheControl: "3600", contentType: file.type, upsert: false
    });
    if(errUp) throw errUp;

    const { data:{ user } } = await sb.auth.getUser();
    const { error: errIns } = await sb.from("contratos_documentos").insert({
      contrato_id: contratoId,
      categoria: $(`${px}-categoria`).value,
      nome: file.name,
      descricao: $(`${px}-descricao`).value.trim() || null,
      storage_path: nomeUnico,
      mime_type: file.type,
      tamanho_bytes: file.size,
      enviado_por: user ? user.id : null
    });
    if(errIns){
      // se falhar o metadado, remove o arquivo pra não deixar órfão
      await sb.storage.from("contratos-docs").remove([nomeUnico]);
      throw errIns;
    }
    aviso("app-aviso","Arquivo anexado.","ok");
    await carregarDocumentosDoContrato(contratoId, conf);
  } catch(err){
    aviso("app-aviso","Erro ao enviar: "+(err.message||err),"erro");
  } finally {
    btn.disabled = false;
    btn.textContent = txtOrig;
  }
}

async function baixarDocumentoContrato(path, nome){
  const { data, error } = await sb.storage.from("contratos-docs").createSignedUrl(path, 60);
  if(error){ aviso("app-aviso","Erro ao gerar URL: "+error.message,"erro"); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl;
  a.download = nome;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function excluirDocumentoContrato(id, path, contratoId, opts){
  if(!confirm("Excluir este anexo?")) return;
  await sb.storage.from("contratos-docs").remove([path]);
  const { error } = await sb.from("contratos_documentos").delete().eq("id", id);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  aviso("app-aviso","Anexo excluído.","ok");
  await carregarDocumentosDoContrato(contratoId, opts);
}

/* ====================================================================
   ASSINATURA ELETRÔNICA (D4Sign) — fase 22

   Plano básico: 10 requisições/hora. O custo de cada ação aparece na
   tela e a Edge Function bloqueia o que não couber na cota. O bloco
   serve duas fichas: contrato de fornecedor e aba Contrato da obra.
   ==================================================================== */
const ASSINATURA_META = {
  nao_iniciada: { label: "Não iniciada", cor: "cinza"    },
  enviada:      { label: "Aguardando",   cor: "ambar"    },
  parcial:      { label: "Parcial",      cor: "ambar"    },
  concluida:    { label: "Assinado",     cor: "verde"    },
  cancelada:    { label: "Cancelada",    cor: "vermelho" }
};

function tagAssinatura(st){
  const m = ASSINATURA_META[st] || ASSINATURA_META.nao_iniciada;
  // Glifo redundante à cor (daltônicos não distinguem verde/âmbar/vermelho)
  const glifo = { verde: "✓ ", ambar: "◔ ", vermelho: "✕ ", azul: "→ " }[m.cor] || "○ ";
  return `<span class="tag ${m.cor}">${glifo}${esc(m.label)}</span>`;
}

/* Alvo atual do modal: contrato + como recarregar a ficha de origem */
let _d4sAlvo = null;

async function cotaD4SignUsada(){
  const { data, error } = await sb.rpc("d4sign_cota_usada");
  return error ? null : data;
}

/* Bloco de status + ações, renderizado na aba Documentos do contrato
   e na aba Contrato da obra. `contrato` = registro completo ou null. */
function renderBlocoAssinatura(contrato, containerId, conf){
  const cont = $(containerId);
  if(!cont) return;
  if(!contrato || !contrato.id){
    cont.innerHTML = "";
    return;
  }
  const st = contrato.assinatura_status || "nao_iniciada";
  const signatarios = Array.isArray(contrato.assinatura_signatarios)
    ? contrato.assinatura_signatarios.map(s => s.email).join(", ") : "";

  let meio = "";
  if(st === "enviada" || st === "parcial"){
    meio = `<span class="meta">enviado em ${contrato.data_envio_assinatura
      ? new Date(contrato.data_envio_assinatura).toLocaleDateString("pt-BR") : "—"}${
      signatarios ? " para " + esc(signatarios) : ""}</span>`;
  } else if(st === "concluida" && contrato.arquivo_assinado_url){
    meio = `<button type="button" class="btn-sec btn-sm" id="btn-d4s-baixar-${containerId}">⬇️ Baixar assinado</button>`;
  }

  let acoes = "";
  if(st === "nao_iniciada" || st === "cancelada"){
    acoes = `<button type="button" class="btn-sec btn-sm" id="btn-d4s-abrir-${containerId}">✍️ Enviar para assinatura</button>`;
  } else if(st === "enviada" || st === "parcial"){
    acoes = `<button type="button" class="btn-sec btn-sm" id="btn-d4s-status-${containerId}" title="Consulta manual — gasta 1 requisição da cota">🔄 Atualizar status</button>`;
  }

  cont.innerHTML = `<div class="assin-bloco">
    <strong>Assinatura eletrônica</strong>
    ${tagAssinatura(st)}
    ${meio}
    <div class="assin-acoes">${acoes}</div>
  </div>`;

  $(`btn-d4s-abrir-${containerId}`)?.addEventListener("click", () => abrirModalAssinatura(contrato, conf));
  $(`btn-d4s-status-${containerId}`)?.addEventListener("click", () => atualizarStatusAssinatura(contrato.id, conf));
  $(`btn-d4s-baixar-${containerId}`)?.addEventListener("click", () =>
    baixarDocumentoContrato(contrato.arquivo_assinado_url, `Contrato ${contrato.numero} — assinado.pdf`));
}

async function abrirModalAssinatura(contrato, conf){
  _d4sAlvo = { contrato, conf };

  // Anexos disponíveis do contrato
  const { data: docs } = await sb.from("contratos_documentos")
    .select("id,nome,categoria")
    .eq("contrato_id", contrato.id)
    .neq("categoria", "contrato_assinado")
    .order("created_at", { ascending: false });
  if(!docs || !docs.length){
    aviso("app-aviso", "Anexe primeiro o PDF do contrato (aba Documentos) para poder enviá-lo.", "erro");
    return;
  }
  $("d4s-documento").innerHTML = docs.map(d =>
    `<option value="${esc(d.id)}">${esc(d.nome)} (${esc(CON_DOC_CATEGORIAS[d.categoria] || d.categoria)})</option>`).join("");

  // Limpa signatários e sugere o e-mail da contraparte
  for(let i = 1; i <= 3; i++){ $(`d4s-nome-${i}`).value = ""; $(`d4s-email-${i}`).value = ""; }
  $("d4s-mensagem").value = "";
  try {
    if(contrato.fornecedor_id){
      const { data: f } = await sb.from("fornecedores")
        .select("razao_social,email").eq("id", contrato.fornecedor_id).single();
      if(f?.email){ $("d4s-email-1").value = f.email; $("d4s-nome-1").value = f.razao_social || ""; }
    } else if(contrato.cliente_id){
      const { data: c } = await sb.from("clientes")
        .select("nome,email").eq("id", contrato.cliente_id).single();
      if(c?.email){ $("d4s-email-1").value = c.email; $("d4s-nome-1").value = c.nome || ""; }
    }
  } catch(_e){ /* sugestão é cortesia; sem e-mail o usuário digita */ }

  const usada = await cotaD4SignUsada();
  $("d4s-cota-nota").textContent = usada === null
    ? "O envio usa 4 das 10 requisições/hora do plano D4Sign."
    : `O envio usa 4 requisições. Cota da última hora: ${usada}/10 usadas.`;

  $("d4s-modal").style.display = "flex";
}

function fecharModalAssinatura(){
  $("d4s-modal").style.display = "none";
  _d4sAlvo = null;
}

async function enviarAssinaturaD4S(){
  if(!_d4sAlvo) return;
  const signatarios = [];
  for(let i = 1; i <= 3; i++){
    const email = $(`d4s-email-${i}`).value.trim();
    if(email) signatarios.push({ email, nome: $(`d4s-nome-${i}`).value.trim() });
  }
  if(!signatarios.length){ aviso("app-aviso", "Informe ao menos um e-mail de signatário.", "erro"); return; }

  const btn = $("btn-d4s-enviar");
  btn.disabled = true;
  const txt = btn.textContent;
  btn.textContent = "Enviando...";
  try {
    const { data, error } = await sb.functions.invoke("d4sign-api", {
      body: {
        acao: "enviar",
        contrato_id: _d4sAlvo.contrato.id,
        documento_id: $("d4s-documento").value,
        signatarios,
        mensagem: $("d4s-mensagem").value.trim() || undefined
      }
    });
    // FunctionsHttpError: o corpo com a mensagem real vem em error.context
    if(error){
      let msg = error.message || "erro";
      try { const corpo = await error.context?.json(); if(corpo?.error) msg = corpo.error; } catch(_e){}
      aviso("app-aviso", "Envio não realizado: " + msg, "erro");
      return;
    }
    aviso("app-aviso", `✍️ Documento enviado para assinatura.${data?.aviso ? " " + data.aviso : ""}`, "ok");
    const conf = _d4sAlvo.conf;
    fecharModalAssinatura();
    if(conf?.recarregar) await conf.recarregar();
  } catch(e){
    aviso("app-aviso", "Erro ao enviar: " + (e.message || e), "erro");
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
}

async function atualizarStatusAssinatura(contratoId, conf){
  if(!confirm("Consultar o status na D4Sign agora? Isso usa 1 requisição da cota (o normal é o status chegar sozinho pelo webhook).")) return;
  const { data, error } = await sb.functions.invoke("d4sign-api", {
    body: { acao: "status", contrato_id: contratoId }
  });
  if(error){
    let msg = error.message || "erro";
    try { const corpo = await error.context?.json(); if(corpo?.error) msg = corpo.error; } catch(_e){}
    aviso("app-aviso", "Consulta falhou: " + msg, "erro");
    return;
  }
  const nome = data?.status_d4sign?.statusName || "?";
  aviso("app-aviso", `Status na D4Sign: ${nome}.${data?.arquivo_baixado ? " PDF assinado baixado para a aba Documentos." : ""}`, "ok");
  if(conf?.recarregar) await conf.recarregar();
}

/* ---------- Listeners ---------- */
function ligarContratos(){
  $("btn-d4s-enviar")?.addEventListener("click", enviarAssinaturaD4S);
  $("btn-d4s-cancelar")?.addEventListener("click", fecharModalAssinatura);
  document.querySelectorAll("#con-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#con-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _conView = b.dataset.view;
      renderContratos();
    });
  });
  ["con-busca","con-f-status","con-f-categoria","con-f-vencimento"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "con-busca" ? "input" : "change", id === "con-busca" ? debounce(renderContratos) : renderContratos);
  });
  $("con-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirContrato(tr.dataset.id);
  });

  $("btn-novo-contrato")?.addEventListener("click", novoContrato);
  $("btn-voltar-con")?.addEventListener("click", mostrarPainelCon);
  $("btn-salvar-con")?.addEventListener("click", () => comBotaoTravado("btn-salvar-con", () => salvarContrato()));
  $("btn-excluir-con")?.addEventListener("click", excluirContrato);

  document.querySelectorAll("#con-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabCon(b.dataset.tab));
  });
  $("sb-con-documentos")?.addEventListener("click", () => ativarTabCon("documentos"));

  document.querySelectorAll("#con-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!conEditId){
        $("con-status").value = novo;
        atualizarStatusbarCon(novo);
        return;
      }
      if(novo === $("con-status").value) return;
      await salvarContrato(novo);
    });
  });

  const navCon = document.querySelector('nav button[data-secao="contratos"]');
  if(navCon) navCon.addEventListener("click", mostrarPainelCon);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarContratos);
} else {
  ligarContratos();
}

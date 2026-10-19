/* ====================================================================
   Módulo: Medições
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   Fluxo: rascunho → enviada → aprovada → faturada (rejeitada = lateral).
   ==================================================================== */

let _medRegistros = [];
let _medView      = "lista";
let medEditId     = null;

const MED_STAGES = ["rascunho","enviada","aprovada","faturada"];

/* ---------- Carga ---------- */
async function carregarMedicoes(){
  const { data, error } = await sb.from("medicoes")
    .select("id,numero,obra_id,data_medicao,percentual,status,valor_medido,periodo_inicio,periodo_fim,descricao,observacoes,nf_numero,doc_tipo,nf_vencimento,origem,obra:obras(codigo,nome)")
    .order("data_medicao", { ascending: false });
  _medRegistros = error ? [] : (data || []);
  renderMedicoes();
}

/* ---------- Filtros ---------- */
function medFiltradas(){
  const termo = ($("med-busca")?.value || "").trim().toLowerCase();
  const fStatus = $("med-f-status")?.value || "";
  const fObra = $("med-f-obra")?.value || "";
  const fOrigem = $("med-f-origem")?.value || ""; // fase 88: "Importadas" (boletim PDF) × digitadas
  return _medRegistros.filter(m => {
    if(fStatus && m.status !== fStatus) return false;
    if(fObra && m.obra_id !== fObra) return false;
    if(fOrigem && (m.origem || "manual") !== fOrigem) return false;
    if(termo){
      const alvo = `${m.numero||""} ${medObraTxt(m)} ${m.nf_numero||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function preencherFiltrosMed(){
  const selSt = $("med-f-status");
  if(selSt && !selSt.options.length){
    selSt.innerHTML = `<option value="">Todos os status</option>` + opcoesStatus("medicao");
  }
  const selObra = $("med-f-obra");
  if(selObra){
    const atual = selObra.value; // preserva a seleção (o render roda a cada tecla)
    const lista = Object.entries(mapaObras).map(([id, txt]) => ({ id, txt }));
    selObra.innerHTML = `<option value="">Todas as obras</option>` +
      lista.map(o => `<option value="${esc(o.id)}">${esc(o.txt)}</option>`).join("");
    selObra.value = atual;
  }
}

/* ---------- Render ---------- */
function renderMedicoes(){
  preencherFiltrosMed();
  const dados = medFiltradas();
  const cont = $("med-contador");
  if(cont) cont.textContent = `${dados.length} de ${_medRegistros.length}`;
  if(_medView === "kanban") renderMedKanban(dados);
  else                       renderMedLista(dados);

  // compat com tbody antigo
  const legacy = $("tab-medicoes");
  if(legacy) legacy.innerHTML = "";
}

/* Textos da listagem (outra sessão, 02/09/2026): obra pelo join, período como data, NF/RR */
function medObraTxt(m){
  if(m.obra && m.obra.codigo) return `${m.obra.codigo} — ${m.obra.nome||""}`.trim();
  return mapaObras[m.obra_id] || "—";
}
function medPeriodoTxt(m){
  if(m.periodo_inicio && m.periodo_fim) return `${dataBR(m.periodo_inicio)} – ${dataBR(m.periodo_fim)}`;
  if(m.periodo_fim) return dataBR(m.periodo_fim);
  return dataBR(m.data_medicao);
}
function medDocTxt(m){
  if(!m.nf_numero) return "—";
  return `${m.doc_tipo === "rr" ? "RR" : "NF"} ${m.nf_numero}`;
}

function renderMedLista(dados){
  const cont = $("med-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhuma medição encontrada.</p>`;
    return;
  }
  const linhas = dados.map(m => `<tr class="linha-clicavel" data-id="${esc(m.id)}">
    <td>${esc(m.numero)}${m.origem === "importada_pdf" ? ' <span title="Importada do boletim (PDF), fase 88">📄</span>' : ""}</td>
    <td>${linkObra(m.obra_id, medObraTxt(m))}</td>
    <td>${medPeriodoTxt(m)}</td>
    <td>${num(m.percentual)}%</td>
    <td>${tagStatus("medicao", m.status)}</td>
    <td>${esc(medDocTxt(m))}</td>
    <td class="num">${brl(m.valor_medido)}</td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nº</th><th>Obra</th><th>Período</th><th>%</th><th>Status</th><th>NF/RR</th><th class="num">Valor medido</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderMedKanban(dados){
  const cont = $("med-conteudo");
  if(!cont) return;
  const colunas = MED_STAGES.concat(["rejeitada"]).map(st => {
    const itens = dados.filter(m => m.status === st);
    if(!itens.length && st === "rejeitada") return "";
    const stMeta = (STATUS.medicao && STATUS.medicao[st]) || { label: st, cor: "cinza" };
    const cards = itens.map(m => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(m.id)}">
        <div class="serv-kan-card-nome">${esc(m.numero)} · ${linkObra(m.obra_id, medObraTxt(m))}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${num(m.percentual)}% · ${medPeriodoTxt(m)}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${esc(medDocTxt(m))}</span>
          <strong>${brl(m.valor_medido)}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  // Habilita drag&drop entre colunas (muda status)
  habilitarDragKanban({
    container: "#med-conteudo .serv-kanban",
    tabela: "medicoes",
    onUpdate: async () => { await carregarMedicoes(); }
  });
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelMed(){
  $("med-painel").style.display = "";
  $("med-ficha").style.display = "none";
  medEditId = null;
}

/* Cache dos itens da medição aberta (variante_id, descricao, qty, unidade, unitário, total, origem) */
let _medItens = [];

/* Sugere número + tipo da medição baseado na obra selecionada.
   - Se obra ainda não tem medição → tipo='sinal_contratual' (primeira sempre é o sinal 30%)
   - Caso contrário → tipo='quinzenal'
   - Não atropela campos já preenchidos manualmente */
async function sugerirNumeroMedicao(){
  if(medEditId) return; // só pra nova medição
  const obraId  = $("med-obra")?.value;
  const inputNum = $("med-numero");
  const selTipo  = $("med-tipo");
  if(!obraId || !inputNum) return;

  // Conta medições existentes da obra
  const { count } = await sb.from("medicoes")
    .select("id", { count: "exact", head: true })
    .eq("obra_id", obraId);
  const n = count || 0;

  // Só preenche se vazio
  if(!inputNum.value.trim()){
    inputNum.value = String(n + 1).padStart(2, "0");
  }
  // Sugere tipo só na primeira medição da obra (preserva escolha do usuário caso ele já tenha trocado)
  if(selTipo && n === 0 && (selTipo.value === "quinzenal" || !selTipo.value)){
    selTipo.value = "sinal_contratual";
    aviso("app-aviso", "1ª medição da obra detectada — tipo definido como Sinal Contratual. Use ✨ Compor sinal contratual na aba Itens.", "ok");
    if(typeof ajustarUISinalContratual === "function") ajustarUISinalContratual();
  } else if(selTipo && n > 0 && selTipo.value === "sinal_contratual"){
    // Se obra já tem outras medições e o user não mexeu, default volta pra quinzenal
    selTipo.value = "quinzenal";
    if(typeof ajustarUISinalContratual === "function") ajustarUISinalContratual();
  }
}

function novaMedicao(){
  medEditId = null;
  $("med-numero").value = "";
  $("med-obra").value = "";
  if($("med-tipo")) $("med-tipo").value = "quinzenal";
  if($("med-multiplicador")) $("med-multiplicador").value = 100;
  $("med-status").value = "rascunho";
  $("med-data").value = hojeISO();
  $("med-inicio").value = "";
  $("med-fim").value = "";
  if($("med-doc-tipo"))  $("med-doc-tipo").value  = "";
  if($("med-nf-numero")) $("med-nf-numero").value = "";
  if($("med-nf-emissao"))$("med-nf-emissao").value= "";
  if($("med-nf-venc"))   $("med-nf-venc").value   = "";
  if($("med-nf-valor"))  $("med-nf-valor").value  = "";
  if($("med-ret-pct"))      $("med-ret-pct").value = "";
  if($("med-ret-valor"))  { $("med-ret-valor").value = ""; $("med-ret-valor").dataset.manual = "0"; }
  if($("med-ret-liberada")) $("med-ret-liberada").value = "false";
  if($("med-ret-data"))     $("med-ret-data").value = "";
  if($("med-iss-pct"))      $("med-iss-pct").value = "";
  if($("med-iss-retido"))   $("med-iss-retido").value = "true";
  if($("med-iss-valor"))  { $("med-iss-valor").value = ""; $("med-iss-valor").dataset.manual = "0"; }
  $("med-percentual").value = 0;
  if($("med-subtotal"))      $("med-subtotal").value = 0;
  if($("med-desc-sinal"))    $("med-desc-sinal").value = 0;
  if($("med-desc-sinal-obs"))$("med-desc-sinal-obs").value = "";
  if($("med-acrescimo"))     $("med-acrescimo").value = 0;
  if($("med-acrescimo-obs")) $("med-acrescimo-obs").value = "";
  if($("med-valor-final"))   $("med-valor-final").value = 0;
  $("med-descricao").value = "";
  $("med-obs").value = "";
  _medItens = [];
  renderMedItens();
  $("btn-excluir-med").style.display = "none";
  abrirFichaMed({ numero: "(nova)", status: "rascunho", subtotal: 0, valor_final: 0 });
}

async function abrirMedicao(id){
  const [medRes, itensRes] = await Promise.all([
    sb.from("medicoes").select("*").eq("id", id).single(),
    sb.from("medicao_itens")
      .select("id,ordem,descricao,variante_id,execucao_id,orcamento_item_id,quantidade,unidade,valor_unitario,valor_total,preco_origem,preco_origem_obs,equipamento_id,equipamento_tag,quantidade_lida,valor_unitario_lido,conferido")
      .eq("medicao_id", id).order("ordem")
  ]);
  if(medRes.error){ aviso("app-aviso","Erro ao abrir medição: "+medRes.error.message, "erro"); return; }
  // Itens não carregaram → NÃO abrir: salvarMedicao apaga e reinsere os itens,
  // e reinseriria uma lista vazia (perda dos itens da medição).
  if(itensRes.error){
    aviso("app-aviso","Não foi possível carregar os itens da medição ("+itensRes.error.message+"). Tente abrir de novo.","erro");
    return;
  }
  const data = medRes.data;
  medEditId = id;
  _medSaldoSinal = null;
  if($("med-sinal-hint")){ $("med-sinal-hint").textContent = ""; $("med-sinal-hint").style.color = ""; }
  $("med-numero").value = data.numero || "";
  $("med-obra").value = data.obra_id || "";
  if($("med-tipo")) $("med-tipo").value = data.tipo_medicao || "quinzenal";
  if($("med-multiplicador")) $("med-multiplicador").value = data.multiplicador_pct ?? 100;
  ajustarUISinalContratual();
  $("med-status").value = data.status || "rascunho";
  $("med-data").value = data.data_medicao || "";
  $("med-inicio").value = data.periodo_inicio || "";
  $("med-fim").value = data.periodo_fim || "";
  if($("med-doc-tipo"))  $("med-doc-tipo").value  = data.doc_tipo || "";
  if($("med-nf-numero")) $("med-nf-numero").value = data.nf_numero || "";
  if($("med-nf-emissao"))$("med-nf-emissao").value= data.nf_data_emissao || "";
  if($("med-nf-venc"))   $("med-nf-venc").value   = data.nf_vencimento || "";
  if($("med-nf-valor"))  $("med-nf-valor").value  = data.nf_valor ?? "";
  if($("med-ret-pct"))      $("med-ret-pct").value = data.retencao_percentual ?? "";
  if($("med-ret-valor"))  { $("med-ret-valor").value = data.retencao_valor ?? ""; $("med-ret-valor").dataset.manual = (data.retencao_valor != null && data.retencao_percentual == null) ? "1" : "0"; }
  if($("med-ret-liberada")) $("med-ret-liberada").value = data.retencao_liberada ? "true" : "false";
  if($("med-ret-data"))     $("med-ret-data").value = data.retencao_data_liberacao || "";
  if($("med-iss-pct"))      $("med-iss-pct").value = data.iss_percentual ?? "";
  if($("med-iss-retido"))   $("med-iss-retido").value = data.iss_retido_fonte === false ? "false" : "true";
  if($("med-iss-valor"))  { $("med-iss-valor").value = data.iss_valor ?? ""; $("med-iss-valor").dataset.manual = (data.iss_valor != null && data.iss_percentual == null) ? "1" : "0"; }
  if(data.iss_percentual == null) medPreencherIssDaObra(data.obra_id); // medição antiga sem ISS: herda a alíquota da obra
  $("med-percentual").value = data.percentual || 0;
  if($("med-subtotal"))      $("med-subtotal").value = data.subtotal ?? 0;
  if($("med-desc-sinal"))    $("med-desc-sinal").value = data.desconto_sinal ?? 0;
  if($("med-desc-sinal-obs"))$("med-desc-sinal-obs").value = data.desconto_descricao || "";
  if($("med-acrescimo"))     $("med-acrescimo").value = data.acrescimo ?? 0;
  if($("med-acrescimo-obs")) $("med-acrescimo-obs").value = data.acrescimo_descricao || "";
  // valor_final vem da trigger (itens); numa medição sem itens ele é 0 e o valor real está em valor_medido
  if($("med-valor-final"))   $("med-valor-final").value = (Number(data.valor_final) || Number(data.valor_medido) || 0).toFixed(2);
  $("med-descricao").value = data.descricao || "";
  $("med-obs").value = data.observacoes || "";

  _medItens = (itensRes.data || []).map(it => ({ ...it, _persisted: true }));
  renderMedItens();
  $("btn-excluir-med").style.display = "";
  abrirFichaMed(data);
}

function abrirFichaMed(med){
  $("med-painel").style.display = "none";
  $("med-ficha").style.display = "";

  $("med-ficha-numero").textContent = med.numero || "(novo)";
  $("med-ficha-obra-chip").innerHTML = linkObra(med.obra_id); // chamado #4: clicável
  $("med-ficha-status-chip").innerHTML = tagStatus("medicao", med.status);
  if($("med-ficha-subtotal-chip")) $("med-ficha-subtotal-chip").textContent = brl(med.subtotal||0);
  $("med-ficha-valor-chip").textContent = brl(med.valor_final || med.valor_medido || 0);
  $("med-ficha-titulo").textContent = med.numero ? `Medição ${med.numero}` : "Nova medição";

  atualizarStatusbarMed(med.status);
  medAtualizarOrigemFicha(med); // fase 88: chip "Origem" e botão do PDF do boletim importado
  ativarTabMed("geral");
  medAtualizarProducaoPendente(med.id);
}

/* Lote S39 (chamado #26): NF cadastrada antes da produção. A pendência é calculada na view
   vw_medicoes_pendencias e some quando os itens do período batem com a NF. */
async function medAtualizarProducaoPendente(medicaoId){
  const chip = $("med-ficha-prodpend");
  if(!chip) return;
  chip.style.display = "none";
  if(!medicaoId) return;
  const { data, error } = await sb.from("vw_medicoes_pendencias")
    .select("detalhe").eq("medicao_id", medicaoId).eq("tipo", "producao_pendente").maybeSingle();
  if(error || !data || medEditId !== medicaoId) return; // view ausente, sem pendência ou ficha trocada
  $("med-ficha-prodpend-txt").textContent = data.detalhe || ""; // "NF R$ X × produzido R$ Y"
  chip.style.display = "";
}

/* ============================================================
   ITENS DA MEDIÇÃO
   ============================================================ */

const PRECO_ORIGEM_INFO = {
  orcamento_obra:   { lbl: "Orçamento da obra", ic: "📋", cor: "var(--sucesso)", bg: "var(--sucesso-bg)" },
  negociado_cliente:{ lbl: "Cliente",           ic: "🤝", cor: "var(--marca-600)", bg: "var(--info-bg)" },
  referencia:       { lbl: "Catálogo",          ic: "📚", cor: "var(--txt-fraco)", bg: "var(--sup-3)" },
  manual:           { lbl: "Manual",            ic: "✋", cor: "var(--aviso-txt)", bg: "var(--aviso-bg)" }
};

function renderMedItens(){
  const tb    = $("med-itens-tbody");
  const vazio = $("med-itens-vazio");
  if(!tb) return;
  if(!_medItens.length){
    tb.innerHTML = "";
    if(vazio) vazio.style.display = "";
    if($("med-itens-badge")) $("med-itens-badge").textContent = "";
    recalcularTotaisMedicao();
    return;
  }
  if(vazio) vazio.style.display = "none";
  if($("med-itens-badge")) $("med-itens-badge").textContent = _medItens.length;

  tb.innerHTML = _medItens.map((it, idx) => {
    const oi = PRECO_ORIGEM_INFO[it.preco_origem] || PRECO_ORIGEM_INFO.manual;
    const tituloOrigem = it.preco_origem_obs || oi.lbl;
    // fase 88: item que veio de boletim importado mostra o que o PDF trazia, para comparar com o que ficou
    const lido = (it.quantidade_lida != null || it.valor_unitario_lido != null)
      ? `<div class="meta" title="O que o boletim importado (PDF) trazia">PDF: ${it.quantidade_lida != null ? num(it.quantidade_lida) : "—"} × ${it.valor_unitario_lido != null ? brl(it.valor_unitario_lido) : "—"}${it.conferido ? " · ✓ conferido" : ""}${it.equipamento_tag ? " · " + esc(it.equipamento_tag) : ""}</div>`
      : "";
    return `<tr data-idx="${idx}">
      <td><strong>${idx+1}</strong></td>
      <td><input type="text" class="mi-desc" value="${esc(it.descricao||"")}" style="min-width:220px;" placeholder="ex.: Estaca Ø400 18-24m" />${lido}</td>
      <td><input type="number" class="mi-qty col-xs" step="0.01" min="0" value="${it.quantidade ?? 0}" /></td>
      <td><input type="text" class="mi-uni" value="${esc(it.unidade||"")}" style="width:50px;" placeholder="m/vb/h" /></td>
      <td><input type="number" class="mi-unit col-sm" step="0.01" min="0" value="${it.valor_unitario ?? 0}" /></td>
      <td class="num"><strong class="mi-total">${brl(it.valor_total ?? 0)}</strong></td>
      <td><span class="badge-origem" title="${esc(tituloOrigem)}" style="background:${oi.bg};color:${oi.cor};">${oi.ic} ${oi.lbl}</span></td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-mi-rem txt-perigo" data-idx="${idx}">×</button></td>
    </tr>`;
  }).join("");

  // Listeners
  tb.querySelectorAll("tr").forEach(tr => {
    const idx = Number(tr.dataset.idx);
    const sync = () => {
      const it = _medItens[idx];
      it.descricao      = tr.querySelector(".mi-desc")?.value.trim() || null;
      it.quantidade     = parseFloat(tr.querySelector(".mi-qty")?.value) || 0;
      it.unidade        = tr.querySelector(".mi-uni")?.value.trim() || null;
      it.valor_unitario = parseFloat(tr.querySelector(".mi-unit")?.value) || 0;
      it.valor_total    = +(it.quantidade * it.valor_unitario).toFixed(2);
      // Se editou unitário manualmente, marca como manual
      const unitInput = tr.querySelector(".mi-unit");
      if(document.activeElement === unitInput && it.preco_origem !== "manual"){
        it.preco_origem = "manual";
        it.preco_origem_obs = "Ajustado manualmente";
        renderMedItens();
        return;
      }
      tr.querySelector(".mi-total").textContent = brl(it.valor_total);
      recalcularTotaisMedicao();
    };
    tr.addEventListener("input", sync);
    tr.addEventListener("change", sync);
  });
  tb.querySelectorAll(".btn-mi-rem").forEach(b => {
    b.addEventListener("click", () => {
      _medItens.splice(Number(b.dataset.idx), 1);
      renderMedItens();
    });
  });
  recalcularTotaisMedicao();
}

/* ====================================================================
   SINAL CONTRATUAL — saldo por obra e abatimento nas medições seguintes
   (decisão do Bernardo, 14/09/2026)
   recebido  = Σ valor das medições tipo sinal_contratual (valor_final, ou valor_medido
               quando a medição não tem itens), status ≠ rejeitada
   abatido   = Σ desconto_sinal das demais medições
   saldo     = recebido − abatido  (tem de chegar a zero no fim da obra)
   Modelo de abatimento (obras.sinal_abatimento_modelo):
     proporcional (padrão): desconto = subtotal × saldo_sinal ÷ saldo_a_medir
                            → se o contrato cresce (aditivo) a fração cai, se encolhe sobe;
                              fecha em zero na última medição sem ajuste manual
     percentual:            desconto = subtotal × (recebido ÷ valor contratado), com teto no saldo
     cliente:               o cliente elabora o boletim e já consumiu o sinal no quadro dele
                            (ex.: Monlevade Mall) → não descontar por medição
   ==================================================================== */
const SINAL_MODELOS = {
  proporcional: "Proporcional ao saldo (padrão)",
  percentual:   "Percentual fixo do sinal em cada medição",
  cliente:      "Boletim do cliente (sinal já consumido no quadro dele; sem desconto)"
};
const medValorEfetivo = (m) => Number(m.valor_final) || Number(m.valor_medido) || 0;
async function calcularSaldoSinalObra(obraId, excluirMedId){
  if(!obraId) return null;
  const [obraRes, medsRes] = await Promise.all([
    sb.from("obras").select("*, financeiro:obras_financeiro(valor_contratado)").eq("id", obraId).single(),   // fase 90
    sb.from("medicoes").select("id,numero,tipo_medicao,status,valor_medido,valor_final,subtotal,desconto_sinal,percentual").eq("obra_id", obraId)
  ]);
  if(obraRes.error || medsRes.error) return null;
  const obra = obraRes.data || {};
  const meds = (medsRes.data || []).filter(m => m.status !== "rejeitada" && m.id !== excluirMedId);
  const sinais = meds.filter(m => m.tipo_medicao === "sinal_contratual");
  const outras = meds.filter(m => m.tipo_medicao !== "sinal_contratual");
  const recebido = sinais.reduce((s, m) => s + medValorEfetivo(m), 0);
  const abatido  = outras.reduce((s, m) => s + (Number(m.desconto_sinal) || 0), 0);
  const medidoBruto = outras.reduce((s, m) => s + (Number(m.subtotal) || medValorEfetivo(m)), 0);
  const valorContratado = Number(obra.financeiro?.valor_contratado) || 0;   // obras_financeiro (fase 90): nulo para quem não lê financeiro
  return {
    obra, valorContratado, recebido, abatido, saldoSinal: Math.max(0, recebido - abatido),
    medidoBruto, saldoAMedir: Math.max(0, valorContratado - medidoBruto),
    pctSinal: valorContratado > 0 ? recebido / valorContratado : 0,
    modelo: SINAL_MODELOS[obra.sinal_abatimento_modelo] ? obra.sinal_abatimento_modelo : "proporcional",
    qtdSinais: sinais.length
  };
}
let _medSaldoSinal = null; // último saldo calculado para a medição aberta (aviso de desconto > saldo)
async function sugerirAbatimentoSinal(){
  const obraId = $("med-obra")?.value;
  if(!obraId){ aviso("app-aviso","Selecione a obra da medição (aba Geral).","erro"); return; }
  if(($("med-tipo")?.value || "") === "sinal_contratual"){ aviso("app-aviso","Esta É a medição do sinal — o abatimento vale para as medições seguintes.","erro"); return; }
  const hint = $("med-sinal-hint");
  const r = await calcularSaldoSinalObra(obraId, medEditId);
  _medSaldoSinal = r;
  if(!r){ aviso("app-aviso","Não foi possível ler o saldo do sinal da obra.","erro"); return; }
  if(!r.recebido){
    if(hint) hint.textContent = "Obra sem medição de sinal contratual registrada — nada a abater.";
    return;
  }
  const subtotal = _medItens.reduce((s, it) => s + (Number(it.valor_total) || 0), 0);
  let desconto = 0, regra = "";
  if(r.modelo === "cliente"){
    regra = "modelo 'boletim do cliente': o sinal já foi consumido no quadro do cliente, sem desconto por medição";
  } else if(r.modelo === "percentual"){
    desconto = Math.min(subtotal * r.pctSinal, r.saldoSinal);
    regra = `${(r.pctSinal * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% do subtotal (percentual fixo), limitado ao saldo`;
  } else {
    desconto = r.saldoAMedir > 0 ? Math.min(subtotal * r.saldoSinal / r.saldoAMedir, r.saldoSinal) : r.saldoSinal;
    regra = `subtotal × saldo do sinal ${brl(r.saldoSinal)} ÷ saldo a medir ${brl(r.saldoAMedir)} (proporcional)`;
  }
  desconto = Math.round(desconto * 100) / 100;
  if(!subtotal && r.modelo !== "cliente"){ aviso("app-aviso","Adicione os itens da medição antes: o abatimento é calculado sobre o subtotal.","erro"); return; }
  $("med-desc-sinal").value = desconto.toFixed(2);
  $("med-desc-sinal-obs").value = `Abatimento do sinal contratual — ${regra}. Saldo do sinal antes: ${brl(r.saldoSinal)}; depois: ${brl(r.saldoSinal - desconto)}.`;
  recalcularTotaisMedicao();
  if(hint) hint.textContent = `Sinal recebido ${brl(r.recebido)} · já abatido ${brl(r.abatido)} · saldo ${brl(r.saldoSinal)} · modelo: ${SINAL_MODELOS[r.modelo]}`;
  aviso("app-aviso", `Abatimento sugerido: ${brl(desconto)}. Confira e salve.`, "ok");
}
/* Aviso quando o desconto digitado passa do saldo do sinal (só depois de calcular o saldo) */
function avisarDescontoAcimaDoSaldo(descSinal){
  const hint = $("med-sinal-hint");
  if(!hint || !_medSaldoSinal) return;
  if(descSinal > _medSaldoSinal.saldoSinal + 0.005){
    hint.style.color = "var(--perigo)";
    hint.textContent = `⚠️ Desconto ${brl(descSinal)} maior que o saldo do sinal ${brl(_medSaldoSinal.saldoSinal)}.`;
  } else {
    hint.style.color = "";
  }
}

/* Medição SEM itens (sinal contratual, boletim elaborado pelo cliente): o valor final é
   informado à mão e preservado. Antes, o recálculo zerava o campo e o Salvar gravava
   valor_medido = 0 por cima do valor existente (caso BM01 Monlevade Mall, 14/09/2026). */
function medicaoSemItens(){ return _medItens.length === 0; }
/* ISS (16/09/2026): toda NF tem ISS e a alíquota varia por município — fica em obras.iss_percentual
   (Obra › Parâmetros). A medição herda quando não tem ISS próprio (ou quando a obra é trocada). */
async function medPreencherIssDaObra(obraId, sobrescrever){
  const el = $("med-iss-pct");
  if(!el || !obraId) return;
  if(!sobrescrever && el.value !== "") return;
  const { data } = await sb.from("obras").select("iss_percentual").eq("id", obraId).maybeSingle();
  if(data && data.iss_percentual != null){
    el.value = data.iss_percentual;
    if($("med-iss-valor")) $("med-iss-valor").dataset.manual = "0";
    recalcularTotaisMedicao();
  }
}

function recalcularTotaisMedicao(){
  const subtotal = _medItens.reduce((s, it) => s + (Number(it.valor_total) || 0), 0);
  const descSinal = parseFloat($("med-desc-sinal")?.value)   || 0;
  const acresc    = parseFloat($("med-acrescimo")?.value)    || 0;
  const mult      = parseFloat($("med-multiplicador")?.value);
  const multiplicador = (isFinite(mult) && mult > 0) ? mult : 100;
  const campoVF = $("med-valor-final");
  const nota    = $("med-valor-final-nota");
  let valorFinal;
  if(medicaoSemItens()){
    valorFinal = parseFloat(campoVF?.value) || 0;
    if(campoVF){ campoVF.readOnly = false; campoVF.style.background = "var(--aviso-bg)"; campoVF.title = "Sem itens: informe o valor da medição à mão"; }
    if(nota) nota.style.display = "";
  } else {
    valorFinal = ((subtotal - descSinal + acresc) * multiplicador / 100);
    if(campoVF){ campoVF.readOnly = true; campoVF.style.background = "var(--sucesso-bg)"; campoVF.title = ""; campoVF.value = valorFinal.toFixed(2); }
    if(nota) nota.style.display = "none";
  }

  if($("med-subtotal"))      $("med-subtotal").value = subtotal.toFixed(2);
  avisarDescontoAcimaDoSaldo(descSinal);
  // retenção: % sobre o valor final, a menos que o valor tenha sido digitado à mão
  const retPct = parseFloat($("med-ret-pct")?.value);
  if($("med-ret-valor") && $("med-ret-valor").dataset.manual !== "1"){
    $("med-ret-valor").value = (isFinite(retPct) && retPct > 0) ? (valorFinal * retPct / 100).toFixed(2) : "";
  }
  // ISS (financeiro, 16/09/2026): por dentro — valor = valor final × %; retido na fonte sai do líquido a receber
  const issPct = parseFloat($("med-iss-pct")?.value);
  if($("med-iss-valor") && $("med-iss-valor").dataset.manual !== "1"){
    $("med-iss-valor").value = (isFinite(issPct) && issPct > 0) ? (valorFinal * issPct / 100).toFixed(2) : "";
  }
  if($("med-liquido")){
    const retV = parseFloat($("med-ret-valor")?.value) || 0;
    const issV = ($("med-iss-retido")?.value === "false") ? 0 : (parseFloat($("med-iss-valor")?.value) || 0);
    $("med-liquido").value = (valorFinal - retV - issV).toFixed(2);
  }
  if($("med-ficha-subtotal-chip")) $("med-ficha-subtotal-chip").textContent = brl(subtotal);
  if($("med-ficha-valor-chip"))    $("med-ficha-valor-chip").textContent = brl(valorFinal);
}

function adicionarItemMedicaoManual(){
  _medItens.push({
    descricao: "",
    quantidade: 0,
    unidade: "m",
    valor_unitario: 0,
    valor_total: 0,
    preco_origem: "manual",
    preco_origem_obs: "Adicionado manualmente"
  });
  renderMedItens();
}

/* Carrega e renderiza aba "🔧 Detalhes Execução" — read-only com cada estaca executada no período */
async function carregarDetalhesExecucaoMed(){
  const cont = $("med-detalhes-conteudo");
  const badge = $("med-detalhes-badge");
  if(!cont) return;
  const obraId = $("med-obra")?.value;
  const pIni   = $("med-inicio")?.value;
  const pFim   = $("med-fim")?.value;
  if(!obraId || !pIni || !pFim){
    cont.innerHTML = `<p class="vazio">Defina <strong>obra</strong> + <strong>período (início + fim)</strong> na aba Geral pra carregar as execuções.</p>`;
    if(badge) badge.textContent = "";
    return;
  }
  cont.innerHTML = `<p class="vazio">Carregando...</p>`;

  // !inner + filtros no join: só as execuções desta obra/período saem do servidor
  // (antes baixava a tabela inteira e filtrava no navegador a cada medição aberta)
  const { data: execs, error } = await sb.from("rdo_execucao_estaca")
    .select("id,estaca_numero,perfuracao_inicio,profundidade_executada,volume_concreto_m3,modalidade_execucao,equipamento:equipamento_id(codigo),estaca:estaca_id(numero,diametro_mm),rdo:rdo_id!inner(obra_id,data)")
    .eq("rdo.obra_id", obraId).gte("rdo.data", pIni).lte("rdo.data", pFim)
    .order("perfuracao_inicio");
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }

  const lista = (execs||[]).filter(e => e.rdo && e.rdo.obra_id === obraId && e.rdo.data >= pIni && e.rdo.data <= pFim);
  if(badge) badge.textContent = lista.length || "";
  if(!lista.length){
    cont.innerHTML = `<p class="vazio">Nenhuma execução nesse período pra essa obra.</p>`;
    return;
  }

  const totalProf = lista.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0);
  const totalVol  = lista.reduce((s,e) => s + (Number(e.volume_concreto_m3)||0), 0);
  const refuros   = lista.filter(e => e.modalidade_execucao === "refuro").length;

  const linhas = lista.map((e,i) => {
    const isRef = e.modalidade_execucao === "refuro";
    const num = e.estaca_numero || e.estaca?.numero || "—";
    const diam = e.estaca?.diametro_mm || "—";
    const data = e.rdo?.data ? dataBR(e.rdo.data) : "—";
    // Horário do RDO é gravado "sem fuso" (naive); fatiar a string mostra o que foi
    // digitado. toLocaleTimeString convertia de UTC e exibia 3h a menos.
    const hora = e.perfuracao_inicio ? String(e.perfuracao_inicio).slice(11,16) : "—";
    return `<tr ${isRef ? 'style="background:var(--aviso-bg);"' : ""}>
      <td style="text-align:center;">${i+1}</td>
      <td><strong>${esc(num)}</strong>${isRef ? ' <span class="badge-alterado" style="background:var(--aviso-bg);color:var(--aviso-txt);border-color:var(--aviso);">REFURO</span>' : ""}</td>
      <td>${esc(data)} <small style="color:var(--txt-sutil);">${esc(hora)}</small></td>
      <td class="num">${diam}</td>
      <td class="num">${num(e.profundidade_executada||0)} m</td>
      <td class="num">${num(e.volume_concreto_m3||0)} m³</td>
      <td>${esc(e.equipamento?.codigo || "—")}</td>
    </tr>`;
  }).join("");

  cont.innerHTML = `
    <div style="display:flex;gap:14px;margin-bottom:10px;font-size:12px;">
      <div style="background:var(--sup-2);padding:8px 14px;border-radius:6px;"><strong>${lista.length}</strong> execuções</div>
      <div style="background:var(--sup-2);padding:8px 14px;border-radius:6px;"><strong>${num(totalProf)} m</strong> de profundidade</div>
      <div style="background:var(--sup-2);padding:8px 14px;border-radius:6px;"><strong>${num(totalVol)} m³</strong> de concreto</div>
      ${refuros > 0 ? `<div style="background:var(--aviso-bg);padding:8px 14px;border-radius:6px;color:var(--aviso-txt);"><strong>${refuros}</strong> refuro(s)</div>` : ""}
    </div>
    <div class="tabela-rola"><table>
      <thead><tr>
        <th style="width:32px;">#</th>
        <th>Estaca</th>
        <th>Data / hora</th>
        <th class="num">Ø (mm)</th>
        <th class="num">Prof.</th>
        <th class="num">Concreto</th>
        <th>Equip.</th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>`;
}

/* Calcula horas extras dos RDOs do período e preenche o campo acréscimo */
async function calcularHoraExtraMedicao(){
  const obraId = $("med-obra")?.value;
  const pIni   = $("med-inicio")?.value;
  const pFim   = $("med-fim")?.value;
  if(!obraId || !pIni || !pFim){
    aviso("app-aviso","Defina obra + período (início e fim) na aba Geral.","erro");
    ativarTabMed("geral"); return;
  }
  const btn = $("btn-med-calc-he");
  if(btn){ btn.disabled = true; btn.textContent = "Calculando..."; }
  const { data, error } = await sb.rpc("calcular_hora_extra_medicao", {
    p_obra_id: obraId, p_inicio: pIni, p_fim: pFim
  });
  if(btn){ btn.disabled = false; btn.textContent = "✨ Calcular Hora Extra"; }
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  const r = data?.[0];
  if(!r || (Number(r.valor_total) || 0) === 0){
    aviso("app-aviso","Sem horas extras lançadas nos RDOs do período. Preencha em RDO → 👷 Equipe.","erro");
    return;
  }
  // Acumula no acréscimo (não substitui)
  const atual = parseFloat($("med-acrescimo").value) || 0;
  const novo  = atual + Number(r.valor_total);
  $("med-acrescimo").value = novo.toFixed(2);
  const obsAtual = $("med-acrescimo-obs").value.trim();
  const novaObs = obsAtual ? `${obsAtual} · ${r.descricao}` : r.descricao;
  $("med-acrescimo-obs").value = novaObs;
  recalcularTotaisMedicao();
  aviso("app-aviso", `✅ +${brl(r.valor_total)} de HE adicionados. ${r.qtd_pessoas} pessoa(s) · ${r.qtd_dias} dia(s).`, "ok");
}

/* Calcula faturamento mínimo (dias úteis sem produção) e preenche acréscimo */
async function calcularFatMinimoMedicao(){
  const obraId = $("med-obra")?.value;
  const pIni   = $("med-inicio")?.value;
  const pFim   = $("med-fim")?.value;
  if(!obraId || !pIni || !pFim){
    aviso("app-aviso","Defina obra + período (início e fim) na aba Geral.","erro");
    ativarTabMed("geral"); return;
  }
  const btn = $("btn-med-calc-fatmin");
  if(btn){ btn.disabled = true; btn.textContent = "Calculando..."; }
  const { data, error } = await sb.rpc("calcular_faturamento_minimo_medicao", {
    p_obra_id: obraId, p_inicio: pIni, p_fim: pFim
  });
  if(btn){ btn.disabled = false; btn.textContent = "✨ Calcular Fat. Mínimo"; }
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  const r = data?.[0];
  if(!r || (Number(r.valor_total) || 0) === 0){
    aviso("app-aviso","Nenhum dia útil sem produção no período (ou nenhum RDO cadastrado).","ok");
    return;
  }
  // Pergunta antes de aplicar (faturamento mínimo é mais sensível — operador pode querer revisar)
  if(!confirm(`Adicionar Faturamento Mínimo ao acréscimo?\n\n${r.descricao}\n\nValor: ${brl(r.valor_total)}\n\nDias detectados sem produção:\n${(r.datas||[]).map(d => new Date(d+"T00:00:00").toLocaleDateString("pt-BR")).join(", ")}`)) return;

  const atual = parseFloat($("med-acrescimo").value) || 0;
  const novo  = atual + Number(r.valor_total);
  $("med-acrescimo").value = novo.toFixed(2);
  const obsAtual = $("med-acrescimo-obs").value.trim();
  const novaObs = obsAtual ? `${obsAtual} · ${r.descricao}` : r.descricao;
  $("med-acrescimo-obs").value = novaObs;
  recalcularTotaisMedicao();
  aviso("app-aviso", `✅ +${brl(r.valor_total)} de Faturamento Mínimo adicionados (${r.dias_sem_producao} dia(s)).`, "ok");
}

/* Mostra/oculta UI do Sinal Contratual baseado no tipo da medição */
function ajustarUISinalContratual(){
  const tipo = $("med-tipo")?.value;
  const ehSinal = tipo === "sinal_contratual";
  const btnComp = $("btn-med-compor-sinal");
  const campoMult = $("campo-med-multiplicador");
  if(btnComp)   btnComp.style.display = ehSinal ? "" : "none";
  if(campoMult) campoMult.style.display = ehSinal ? "" : "none";
  // Default do multiplicador
  const mult = $("med-multiplicador");
  if(mult && ehSinal && (!mult.value || mult.value === "100")){
    mult.value = 30;
    recalcularTotaisMedicao();
  } else if(mult && !ehSinal && mult.value !== "100"){
    mult.value = 100;
    recalcularTotaisMedicao();
  }
}

async function comporMedicaoSinal(){
  const obraId = $("med-obra").value;
  if(!obraId){ aviso("app-aviso","Selecione a obra primeiro (aba Geral).","erro"); ativarTabMed("geral"); return; }
  if(_medItens.length && !confirm(`Substituir os ${_medItens.length} item(ns) existentes pelos itens do orçamento?`)) return;

  const btn = $("btn-med-compor-sinal");
  if(btn){ btn.disabled = true; btn.textContent = "Compondo..."; }

  const { data, error } = await sb.rpc("compor_medicao_sinal", { p_obra_id: obraId });
  if(btn){ btn.disabled = false; btn.textContent = "✨ Compor sinal contratual"; }
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  if(!data || !data.length){
    aviso("app-aviso","Nenhum item válido no orçamento da obra.","erro");
    return;
  }

  _medItens = data.map(d => ({
    descricao: d.descricao,
    variante_id: d.variante_id,
    quantidade: Number(d.quantidade) || 0,
    unidade: d.unidade || "vb",
    valor_unitario: Number(d.valor_unitario) || 0,
    valor_total: Number(d.valor_total) || 0,
    preco_origem: d.preco_origem || "orcamento_obra",
    preco_origem_obs: d.preco_origem_obs || "Sinal Contratual via orçamento",
    orcamento_item_id: d.orcamento_item_id || null
  }));

  // Aplica multiplicador do empresa_config (vem no retorno)
  const mult = Number(data[0]?.multiplicador_pct) || 30;
  if($("med-multiplicador")) $("med-multiplicador").value = mult;

  renderMedItens();
  recalcularTotaisMedicao();
  aviso("app-aviso", `✅ ${_medItens.length} item(ns) do orçamento copiados. Sinal Contratual = ${mult}% do subtotal.`, "ok");
}

async function sugerirItensMedicao(){
  const obraId = $("med-obra").value;
  const inicio = $("med-inicio").value;
  const fim    = $("med-fim").value;
  if(!obraId){ aviso("app-aviso","Selecione a obra primeiro (aba Geral).","erro"); ativarTabMed("geral"); return; }
  if(!inicio || !fim){ aviso("app-aviso","Defina o período (início e fim) na aba Geral.","erro"); ativarTabMed("geral"); return; }

  if(_medItens.length && !confirm(`Já existem ${_medItens.length} item(ns) na medição. Substituir pelos sugeridos?`)) return;

  const btn = $("btn-med-sugerir");
  if(btn){ btn.disabled = true; btn.textContent = "Carregando..."; }

  // 1) Itens base: estacas agrupadas por variante
  // 2) Itens extras: mobilização não-cobrada + refuros
  const [previewRes, extrasRes] = await Promise.all([
    sb.rpc("montar_medicao_preview", { p_obra_id: obraId, p_inicio: inicio, p_fim: fim }),
    sb.rpc("sugerir_extras_medicao", { p_obra_id: obraId, p_inicio: inicio, p_fim: fim, p_medicao_atual: medEditId || null })
  ]);

  if(btn){ btn.disabled = false; btn.textContent = "✨ Sugerir do período"; }
  if(previewRes.error){ aviso("app-aviso","Erro ao sugerir: "+previewRes.error.message,"erro"); return; }

  const itensBase = (previewRes.data || []).map(d => ({
    descricao: `${d.variante_nome || "Estaca"} (${d.faixa_descricao})`,
    variante_id: d.variante_id,
    quantidade: Number(d.quantidade) || 0,
    unidade: d.unidade || "m",
    valor_unitario: Number(d.valor_unitario) || 0,
    valor_total: (Number(d.quantidade)||0) * (Number(d.valor_unitario)||0),
    preco_origem: d.preco_origem || "manual",
    preco_origem_obs: d.preco_origem_obs || null,
    orcamento_item_id: d.orcamento_item_id || null
  }));

  const itensExtras = (extrasRes.data || []).map(d => ({
    descricao: d.descricao,
    variante_id: d.variante_id,
    quantidade: Number(d.quantidade) || 1,
    unidade: d.unidade || "vb",
    valor_unitario: Number(d.valor_unitario) || 0,
    valor_total: (Number(d.quantidade)||1) * (Number(d.valor_unitario)||0),
    preco_origem: d.preco_origem || "orcamento_obra",
    preco_origem_obs: d.preco_origem_obs || null,
    orcamento_item_id: d.orcamento_item_id || null,
    _categoria: d.categoria || null
  }));

  if(!itensBase.length && !itensExtras.length){
    aviso("app-aviso","Nada a sugerir no período. Confira datas, RDOs e orçamento da obra.","erro");
    return;
  }

  _medItens = [...itensBase, ...itensExtras];
  renderMedItens();

  const partes = [];
  if(itensBase.length)   partes.push(`${itensBase.length} estaca(s) agrupada(s)`);
  const mob = itensExtras.filter(i => i._categoria === "mobilizacao").length;
  const ref = itensExtras.filter(i => i._categoria === "refuro").length;
  if(mob) partes.push(`${mob} mobilização`);
  if(ref) partes.push(`${ref} refuro(s)`);
  const semPreco = _medItens.filter(i => !i.valor_unitario).length;
  let msg = `✨ Sugestão: ${partes.join(" + ")}.`;
  if(semPreco) msg += ` ⚠️ ${semPreco} sem preço — ajuste manualmente.`;
  aviso("app-aviso", msg, semPreco ? "erro" : "ok");
}

function atualizarStatusbarMed(st){
  const bar = $("med-statusbar");
  if(!bar) return;
  const idxAtual = MED_STAGES.indexOf(st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    const idx = MED_STAGES.indexOf(el.dataset.status);
    if(st === "rejeitada"){
      if(idx === MED_STAGES.length - 1) el.classList.add("cancelada");
    } else if(idx === idxAtual){
      el.classList.add("atual");
    } else if(idx < idxAtual){
      el.classList.add("passada");
    }
  });
}

function ativarTabMed(nome){
  document.querySelectorAll("#med-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#med-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
  if(nome === "detalhes" && typeof carregarDetalhesExecucaoMed === "function"){
    carregarDetalhesExecucaoMed();
  }
}

/* ---------- Salvar / excluir ---------- */
async function salvarMedicao(novoStatus){
  const obra_id = $("med-obra").value;
  if(!obra_id){ aviso("app-aviso","Selecione a obra da medição.","erro"); ativarTabMed("geral"); return; }
  if(!$("med-numero").value){ aviso("app-aviso","Informe o número.","erro"); ativarTabMed("geral"); return; }

  // Garante totais atualizados antes do save
  recalcularTotaisMedicao();
  const subtotal    = parseFloat($("med-subtotal")?.value)    || 0;
  const descSinal   = parseFloat($("med-desc-sinal")?.value)  || 0;
  const acrescimo   = parseFloat($("med-acrescimo")?.value)   || 0;
  const valorFinal  = parseFloat($("med-valor-final")?.value) || 0;

  const reg = {
    numero: $("med-numero").value.trim(),
    obra_id,
    tipo_medicao: $("med-tipo")?.value || "quinzenal",
    multiplicador_pct: parseFloat($("med-multiplicador")?.value) || 100,
    descricao: $("med-descricao").value.trim() || null,
    status: novoStatus || $("med-status").value,
    data_medicao: $("med-data").value || hojeISO(),
    periodo_inicio: $("med-inicio").value || null,
    periodo_fim: $("med-fim").value || null,
    percentual: Number($("med-percentual").value || 0),
    valor_medido: valorFinal,          // compat: valor_medido = valor_final
    subtotal,
    desconto_sinal: descSinal,
    desconto_descricao: $("med-desc-sinal-obs")?.value.trim() || null,
    acrescimo,
    acrescimo_descricao: $("med-acrescimo-obs")?.value.trim() || null,
    doc_tipo: $("med-doc-tipo")?.value || null,
    nf_numero: $("med-nf-numero")?.value.trim() || null,
    nf_data_emissao: $("med-nf-emissao")?.value || null,
    nf_vencimento: $("med-nf-venc")?.value || null,
    nf_valor: $("med-nf-valor")?.value ? Number($("med-nf-valor").value) : null,
    // Retenção contratual / caução (14/09/2026): valor retido pelo cliente nesta medição, a receber depois
    retencao_percentual: $("med-ret-pct")?.value ? Number($("med-ret-pct").value) : null,
    retencao_valor: $("med-ret-valor")?.value ? Number($("med-ret-valor").value) : null,
    retencao_liberada: $("med-ret-liberada")?.value === "true",
    retencao_data_liberacao: $("med-ret-data")?.value || null,
    // ISS (financeiro, 16/09/2026)
    iss_percentual: $("med-iss-pct")?.value ? Number($("med-iss-pct").value) : null,
    iss_valor: $("med-iss-valor")?.value ? Number($("med-iss-valor").value) : null,
    iss_retido_fonte: $("med-iss-retido")?.value !== "false",
    observacoes: $("med-obs").value.trim() || null
    // valor_final é recalculado por trigger no banco
  };
  let result;
  if(medEditId){
    result = await sb.from("medicoes").update(reg).eq("id", medEditId).select().single();
  } else {
    result = await sb.from("medicoes").insert(reg).select().single();
  }
  if(result.error){
    aviso("app-aviso","Não foi possível salvar a medição: "+result.error.message,"erro");
    return;
  }
  medEditId = result.data.id;

  // Substitui itens (delete + insert) — mais simples que reconciliar por id
  if(medEditId){
    const { error: errDel } = await sb.from("medicao_itens").delete().eq("medicao_id", medEditId);
    if(errDel){ aviso("app-aviso","Erro ao limpar itens antigos: "+errDel.message,"erro"); return; }
    if(_medItens.length){
      const insertItens = _medItens
        .filter(it => it.descricao || it.variante_id)
        .map((it, i) => ({
          medicao_id: medEditId,
          ordem: i + 1,
          descricao: it.descricao || null,
          variante_id: it.variante_id || null,
          execucao_id: it.execucao_id || null,
          orcamento_item_id: it.orcamento_item_id || null,
          quantidade: Number(it.quantidade) || 0,
          unidade: it.unidade || null,
          valor_unitario: Number(it.valor_unitario) || 0,
          // valor_total é coluna GENERATED no banco — não enviamos
          preco_origem: it.preco_origem || "manual",
          preco_origem_obs: it.preco_origem_obs || null,
          // TAG do boletim e, na fase 88, o que o PDF importado trazia: preservados no delete + insert
          equipamento_id: it.equipamento_id || null,
          equipamento_tag: it.equipamento_tag || null,
          quantidade_lida: it.quantidade_lida ?? null,
          valor_unitario_lido: it.valor_unitario_lido ?? null,
          conferido: it.conferido === true
        }));
      if(insertItens.length){
        const { error: errIns } = await sb.from("medicao_itens").insert(insertItens);
        if(errIns){ aviso("app-aviso","Erro ao salvar itens: "+errIns.message,"erro"); return; }
      }
    }
  }

  $("btn-excluir-med").style.display = "";
  $("med-status").value = result.data.status;
  aviso("app-aviso","Medição salva com sucesso.","ok");
  await carregarMedicoes();
  await abrirMedicao(medEditId);
  // lote S39 (#26): quinzenal sem execução no período não bloqueia, só avisa
  if(reg.tipo_medicao === "quinzenal" && !_medItens.length){
    aviso("app-aviso","Medição salva. Nenhuma execução no período: a medição fica com a pendência 'produção pendente' até os diários serem lançados.","aviso");
  }
}

/* ============================================================
   GERADOR DE PDF DA MEDIÇÃO (estilo CGL RG 11.4)
   Usa html2pdf.js (já carregado no index.html)
   ============================================================ */
async function gerarPDFMedicao(){
  if(!medEditId){ aviso("app-aviso","Salve a medição antes de gerar o PDF.","erro"); return; }
  if(typeof html2pdf === "undefined"){ aviso("app-aviso","Biblioteca html2pdf não carregada.","erro"); return; }

  const btn = $("btn-gerar-pdf-med");
  if(btn){ btn.disabled = true; btn.textContent = "Gerando..."; }

  try {
    // 1) Cabeçalho da medição (com obra/cliente/contrato)
    const medRes = await sb.from("medicoes")
      .select(`*, obra:obra_id(id,codigo,nome,cliente_id,cidade,uf,logradouro,numero,contrato_id,
                                cliente:cliente_id(nome,cpf_cnpj,email,telefone,contato_nome),
                                contrato:contrato_id(numero,data_assinatura))`)
      .eq("id", medEditId).single();
    if(medRes.error) throw new Error(medRes.error.message);
    const m = medRes.data;
    const obraId = m.obra?.id;
    const pIni = m.periodo_inicio;
    const pFim = m.periodo_fim;

    // 2) Itens + 3) Execuções/RDOs/Ocorrências do período (só pra quinzenal/final/avulsa — sinal não usa)
    const ehSinal = m.tipo_medicao === "sinal_contratual";
    const [itensRes, execsRes, rdosRes, ocorrRes] = await Promise.all([
      sb.from("medicao_itens")
        .select("ordem,descricao,quantidade,unidade,valor_unitario,valor_total,preco_origem,variante_id")
        .eq("medicao_id", medEditId).order("ordem"),
      (!ehSinal && obraId && pIni && pFim) ? sb.from("rdo_execucao_estaca")
        .select("estaca_numero,perfuracao_inicio,profundidade_executada,volume_concreto_m3,modalidade_execucao,equipamento:equipamento_id(codigo),estaca:estaca_id(numero,diametro_mm),rdo:rdo_id!inner(obra_id,data)")
        .eq("rdo.obra_id", obraId).gte("rdo.data", pIni).lte("rdo.data", pFim)
        .order("perfuracao_inicio") : Promise.resolve({ data: [] }),
      (!ehSinal && obraId && pIni && pFim) ? sb.from("rdo")
        .select("id,data,producao_dia_m,observacoes,atividades")
        .eq("obra_id", obraId)
        .gte("data", pIni).lte("data", pFim)
        .order("data") : Promise.resolve({ data: [] }),
      (!ehSinal && obraId && pIni && pFim) ? sb.from("ocorrencias")
        .select("data,tipo,descricao,horas_paradas,observacoes,rdo_id")
        .eq("obra_id", obraId)
        .gte("data", pIni).lte("data", pFim)
        .order("data") : Promise.resolve({ data: [] })
    ]);

    const itens = itensRes.data || [];
    const execs = (execsRes.data || []).filter(e => !e.rdo || (e.rdo.obra_id === obraId && (!pIni || e.rdo.data >= pIni) && (!pFim || e.rdo.data <= pFim)));
    const rdos  = rdosRes.data || [];
    const ocorr = ocorrRes.data || [];

    const html = montarHTMLMedicaoPDF(m, itens, execs, rdos, ocorr);

    // Container temporário pro html2pdf renderizar
    const container = document.createElement("div");
    container.innerHTML = html;
    container.style.position = "fixed";
    container.style.left = "-9999px";
    document.body.appendChild(container);

    const nomeArq = `Medicao_${(m.numero||"S-N").replace(/[\/\\]/g,"-")}_${(m.obra?.codigo||"obra").replace(/[\/\\]/g,"-")}_${(m.data_medicao||"").replace(/-/g,"")}.pdf`;

    // lote S41 (#36): logo no cabeçalho, selo ISO em toda página e linha de tabela sem corte
    try {
      await pdfGerar(container.firstElementChild, { filename: nomeArq, largura: 186 });
    } finally {
      document.body.removeChild(container);
    }
    aviso("app-aviso", `📄 ${nomeArq} gerado com sucesso.`, "ok");
  } catch(err){
    console.error(err);
    aviso("app-aviso", "Erro ao gerar PDF: " + (err.message||err), "erro");
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = "📄 Gerar PDF"; }
  }
}

/* Monta o HTML do PDF estilo CGL RG 11.4 */
function montarHTMLMedicaoPDF(m, itens, execs = [], rdos = [], ocorrencias = []){
  const ehSinal = m.tipo_medicao === "sinal_contratual";
  if(ehSinal) return montarHTMLSinalContratualPDF(m, itens);
  return montarHTMLQuinzenalPDF(m, itens, execs, rdos, ocorrencias);
}

/* ============================================================
   PDF SINAL CONTRATUAL — estilo Maya/RG 11.4 (1 página simples)
   ============================================================ */
function montarHTMLSinalContratualPDF(m, itens){
  const obra = m.obra || {};
  const cli  = obra.cliente || {};
  const contr= obra.contrato || {};
  const subtotal = Number(m.subtotal) || 0;
  const mult     = Number(m.multiplicador_pct) || 30;
  const total    = Number(m.valor_final) || (subtotal * mult / 100);
  const endereco = [obra.logradouro, obra.numero, obra.cidade, obra.uf ? obra.uf.toUpperCase() : ""].filter(Boolean).join(" - ");
  const equipamento = obra.codigo && obra.codigo.match(/HC[\s-]*(\d+)/i) ? `Hélice ${obra.codigo.match(/HC[\s-]*(\d+)/i)[1]}` : "Hélice";

  return `
<div id="pdf-medicao" style="font-family: Arial, Helvetica, sans-serif; color:#000; font-size:11px; width:186mm; background:#fff;">

  ${headerSGQ()}

  <div style="text-align:center;font-size:13px;font-weight:700;margin:14px 0 8px;">
    OBRA: ${esc(endereco || "—")}
  </div>

  <table style="width:100%;font-size:10.5px;margin-bottom:6px;border-collapse:collapse;">
    <tr>
      <td style="padding:3px 6px;width:50%;"><strong>Equipamento:</strong> ${esc(equipamento)}</td>
      <td style="padding:3px 6px;width:50%;"><strong>CLIENTE:</strong> ${esc((cli.nome||"").toUpperCase())}</td>
    </tr>
    <tr>
      <td style="padding:3px 6px;"><strong>Operador:</strong> ${esc(cli.contato_nome || "—")}</td>
      <td style="padding:3px 6px;"><strong>CONTRATO:</strong> ${esc(contr.numero || "—")}</td>
    </tr>
  </table>

  <div style="text-align:center;font-weight:700;padding:6px;border-top:1px solid #777;border-bottom:1px solid #777;margin:8px 0 14px;font-size:11px;">
    Período Medição: Sinal Contratual
  </div>

  <div style="text-align:center;font-size:13px;font-weight:700;margin-bottom:6px;">Resumo Medição</div>

  <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #000;">
    <thead>
      <tr style="background:#e8e8e8;">
        <th style="padding:6px;border:1px solid #000;text-align:left;">ITEM</th>
        <th style="padding:6px;border:1px solid #000;width:11%;text-align:center;">UNIDADE</th>
        <th style="padding:6px;border:1px solid #000;width:13%;text-align:center;">QUANT.</th>
        <th style="padding:6px;border:1px solid #000;width:18%;text-align:center;">VALOR UNIT.</th>
        <th style="padding:6px;border:1px solid #000;width:20%;text-align:center;">VALOR TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${itens.map((it,i) => `<tr>
        <td style="padding:5px 8px;border:1px solid #000;">${i+1}- ${esc(it.descricao||"")}</td>
        <td style="padding:5px 8px;border:1px solid #000;text-align:center;">${esc(it.unidade||"")}</td>
        <td style="padding:5px 8px;border:1px solid #000;text-align:center;">${num(it.quantidade||0)}</td>
        <td style="padding:5px 8px;border:1px solid #000;text-align:right;">${brl(it.valor_unitario||0)}</td>
        <td style="padding:5px 8px;border:1px solid #000;text-align:right;">${brl(it.valor_total||0)}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <table style="width:100%;font-size:11.5px;margin-top:14px;border-collapse:collapse;">
    <tr>
      <td style="padding:5px 8px;text-align:right;font-weight:600;">Valor Total Estimado</td>
      <td style="padding:5px 8px;text-align:right;width:28%;border-bottom:1px solid #999;">${brl(subtotal)}</td>
    </tr>
    <tr>
      <td style="padding:8px;text-align:right;font-weight:700;font-size:12.5px;">Sinal Contratual ${num(mult)}%</td>
      <td style="padding:8px;text-align:right;font-weight:700;font-size:12.5px;border-bottom:3px double #000;">${brl(total)}</td>
    </tr>
  </table>

  ${rodape(cli)}
</div>`;
}

/* ============================================================
   PDF MEDIÇÃO QUINZENAL/FINAL/AVULSA — layout completo
   Inspirado no PDF Medição 01 real da CGL
   ============================================================ */
function montarHTMLQuinzenalPDF(m, itens, execs, rdos, ocorrencias){
  const obra = m.obra || {};
  const cli  = obra.cliente || {};
  const contr= obra.contrato || {};
  const periodo = (m.periodo_inicio && m.periodo_fim)
    ? `${dataBR(m.periodo_inicio)} a ${dataBR(m.periodo_fim)}`
    : (m.data_medicao ? dataBR(m.data_medicao) : "—");

  const subtotal = Number(m.subtotal) || 0;
  const desc     = Number(m.desconto_sinal) || 0;
  const acresc   = Number(m.acrescimo) || 0;
  const mult     = Number(m.multiplicador_pct) || 100;
  const total    = Number(m.valor_final) || ((subtotal - desc + acresc) * mult / 100);
  const endereco = [obra.logradouro, obra.numero, obra.cidade, obra.uf ? obra.uf.toUpperCase() : ""].filter(Boolean).join(" - ");

  // SEÇÃO 2: Estacas executadas (1 linha por execução)
  // Preço por metro vem do item de estaca/hélice/trado da medição. Sem item de
  // referência, NÃO inventar valor (antes caía num R$ 52/m fictício que ia
  // para o PDF do cliente): mostra "—" nas colunas de valor.
  const itemRef = itens.find(i => /estaca|h.lice|trado/i.test(i.descricao||""));
  const valorPorMetro = itemRef && Number(itemRef.valor_unitario) > 0 ? Number(itemRef.valor_unitario) : null;
  const linhasEstacas = execs.length ? execs.map((e, i) => {
    const numEstaca = e.estaca_numero || e.estaca?.numero || "—";
    const diam = e.estaca?.diametro_mm || "—";
    const prof = Number(e.profundidade_executada) || 0;
    const valor = valorPorMetro != null ? prof * valorPorMetro : null;
    return `<tr>
      <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${i+1}</td>
      <td style="padding:4px 6px;border:1px solid #000;">${esc(numEstaca)}</td>
      <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${e.rdo?.data ? dataBR(e.rdo.data) : "—"}</td>
      <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${esc(diam)}</td>
      <td style="padding:4px 6px;border:1px solid #000;text-align:right;">${num(prof)} m</td>
      <td style="padding:4px 6px;border:1px solid #000;text-align:right;">${valorPorMetro != null ? brl(valorPorMetro) : "—"}</td>
      <td style="padding:4px 6px;border:1px solid #000;text-align:right;">${valor != null ? brl(valor) : "—"}</td>
    </tr>`;
  }).join("") : "";

  const totalMetragem = execs.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0);
  const totalEstacasValor = valorPorMetro != null ? totalMetragem * valorPorMetro : null;

  const blocoEstacas = execs.length ? `
    <div style="font-size:12.5px;font-weight:700;text-align:center;margin:14px 0 6px;background:#e8e8e8;padding:6px;border:1px solid #000;">Estacas Executadas</div>
    <table style="width:100%;border-collapse:collapse;font-size:9.5px;border:1px solid #000;">
      <thead>
        <tr style="background:#f4f4f4;">
          <th style="padding:5px;border:1px solid #000;width:5%;">N°</th>
          <th style="padding:5px;border:1px solid #000;">Estaca</th>
          <th style="padding:5px;border:1px solid #000;width:13%;">Data</th>
          <th style="padding:5px;border:1px solid #000;width:11%;">Diâmetro (mm)</th>
          <th style="padding:5px;border:1px solid #000;width:14%;">Profundidade (m)</th>
          <th style="padding:5px;border:1px solid #000;width:12%;">R$ / m</th>
          <th style="padding:5px;border:1px solid #000;width:14%;">R$ Total</th>
        </tr>
      </thead>
      <tbody>${linhasEstacas}</tbody>
      <tfoot>
        <tr style="background:#f4f4f4;font-weight:700;">
          <td colspan="4" style="padding:5px;border:1px solid #000;text-align:right;">TOTAL DE ESTACAS:</td>
          <td style="padding:5px;border:1px solid #000;text-align:right;">${num(totalMetragem)} m</td>
          <td style="padding:5px;border:1px solid #000;"></td>
          <td style="padding:5px;border:1px solid #000;text-align:right;">${totalEstacasValor != null ? brl(totalEstacasValor) : "—"}</td>
        </tr>
      </tfoot>
    </table>` : "";

  // SEÇÃO 3: Resumo por diâmetro
  const porDiam = {};
  execs.forEach(e => {
    const d = e.estaca?.diametro_mm || "—";
    if(!porDiam[d]) porDiam[d] = { metragem: 0, qty: 0 };
    porDiam[d].metragem += Number(e.profundidade_executada) || 0;
    porDiam[d].qty++;
  });
  const blocoResumoDiam = execs.length ? `
    <div style="font-size:12px;font-weight:700;text-align:center;margin:14px 0 4px;">Resumo das Estacas</div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #000;">
      <thead>
        <tr style="background:#e8e8e8;">
          <th style="padding:5px;border:1px solid #000;text-align:center;">Diâmetro (mm)</th>
          <th style="padding:5px;border:1px solid #000;text-align:center;">Comprimento (m)</th>
          <th style="padding:5px;border:1px solid #000;text-align:center;">R$/m</th>
          <th style="padding:5px;border:1px solid #000;text-align:center;">Quantidade</th>
          <th style="padding:5px;border:1px solid #000;text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(porDiam).map(([d, info]) => `<tr>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${d}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:right;">${num(info.metragem)} m</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:right;">${valorPorMetro != null ? brl(valorPorMetro) : "—"}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${info.qty}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:right;">${valorPorMetro != null ? brl(info.metragem * valorPorMetro) : "—"}</td>
        </tr>`).join("")}
        <tr style="background:#f4f4f4;font-weight:700;">
          <td colspan="3" style="padding:5px;border:1px solid #000;text-align:right;">TOTAL:</td>
          <td style="padding:5px;border:1px solid #000;text-align:center;">${execs.length}</td>
          <td style="padding:5px;border:1px solid #000;text-align:right;">${totalEstacasValor != null ? brl(totalEstacasValor) : "—"}</td>
        </tr>
      </tbody>
    </table>` : "";

  // SEÇÃO 4: Mobilização (procura item de mobilização nos itens da medição)
  const itemMob = itens.find(i => /mobiliza/i.test(i.descricao||""));
  const blocoMobilizacao = itemMob ? `
    <div style="font-size:12px;font-weight:700;text-align:center;margin:14px 0 4px;">Mobilização / Desmobilização</div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #000;">
      <thead>
        <tr style="background:#e8e8e8;">
          <th style="padding:5px;border:1px solid #000;text-align:center;">Data</th>
          <th style="padding:5px;border:1px solid #000;text-align:left;">Descrição</th>
          <th style="padding:5px;border:1px solid #000;text-align:right;width:25%;">Valor (R$)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${m.periodo_fim ? dataBR(m.periodo_fim) : "—"}</td>
          <td style="padding:4px 6px;border:1px solid #000;">${esc(itemMob.descricao||"")}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:right;">${brl(itemMob.valor_total||0)}</td>
        </tr>
      </tbody>
    </table>` : "";

  // SEÇÃO 5: Resumo Diário
  const porDia = {};
  execs.forEach(e => {
    const d = e.rdo?.data || "—";
    if(!porDia[d]) porDia[d] = { estacas: 0, metragem: 0 };
    porDia[d].estacas++;
    porDia[d].metragem += Number(e.profundidade_executada) || 0;
  });
  const diasOrd = Object.keys(porDia).sort();
  const blocoResumoDiario = diasOrd.length ? `
    <div style="font-size:12px;font-weight:700;text-align:center;margin:14px 0 4px;">Resumo Diário</div>
    <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #000;">
      <thead>
        <tr style="background:#e8e8e8;">
          <th style="padding:5px;border:1px solid #000;text-align:center;">Data</th>
          <th style="padding:5px;border:1px solid #000;text-align:center;">Estacas</th>
          <th style="padding:5px;border:1px solid #000;text-align:center;">Produção (m)</th>
          <th style="padding:5px;border:1px solid #000;text-align:right;">Valor (R$)</th>
        </tr>
      </thead>
      <tbody>
        ${diasOrd.map(d => `<tr>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${dataBR(d)}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${porDia[d].estacas}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;">${num(porDia[d].metragem)} m</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:right;">${valorPorMetro != null ? brl(porDia[d].metragem * valorPorMetro) : "—"}</td>
        </tr>`).join("")}
        <tr style="background:#f4f4f4;font-weight:700;">
          <td style="padding:5px;border:1px solid #000;text-align:right;">TOTAL:</td>
          <td style="padding:5px;border:1px solid #000;text-align:center;">${execs.length}</td>
          <td style="padding:5px;border:1px solid #000;text-align:center;">${num(totalMetragem)} m</td>
          <td style="padding:5px;border:1px solid #000;text-align:right;">${totalEstacasValor != null ? brl(totalEstacasValor) : "—"}</td>
        </tr>
      </tbody>
    </table>` : "";

  // SEÇÃO 6: Horas Paradas / Ocorrências
  const blocoOcorrencias = ocorrencias.length ? `
    <div style="font-size:12px;font-weight:700;text-align:center;margin:14px 0 4px;">Horas Paradas / Ocorrências</div>
    <table style="width:100%;border-collapse:collapse;font-size:9px;border:1px solid #000;">
      <thead>
        <tr style="background:#e8e8e8;">
          <th style="padding:5px;border:1px solid #000;text-align:center;width:4%;">N°</th>
          <th style="padding:5px;border:1px solid #000;text-align:center;width:11%;">Data</th>
          <th style="padding:5px;border:1px solid #000;text-align:center;width:12%;">Tipo</th>
          <th style="padding:5px;border:1px solid #000;text-align:center;width:9%;">Duração</th>
          <th style="padding:5px;border:1px solid #000;text-align:left;">Descrição</th>
        </tr>
      </thead>
      <tbody>
        ${ocorrencias.map((o,i) => `<tr>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;vertical-align:top;">${i+1}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;vertical-align:top;">${dataBR(o.data)}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;vertical-align:top;">${esc(o.tipo||"")}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:center;vertical-align:top;">${o.horas_paradas ? num(o.horas_paradas) + " h" : "—"}</td>
          <td style="padding:4px 6px;border:1px solid #000;text-align:justify;">${esc(o.descricao||"")}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : "";

  // SEÇÃO 7: Totalizadores
  const blocoTotal = `
    <table style="width:100%;font-size:11.5px;margin-top:18px;border-collapse:collapse;">
      <tr>
        <td style="padding:5px 8px;text-align:right;font-weight:600;">SUBTOTAL</td>
        <td style="padding:5px 8px;text-align:right;width:25%;border-bottom:1px solid #999;">${brl(subtotal)}</td>
      </tr>
      ${desc > 0 ? `<tr>
        <td style="padding:5px 8px;text-align:right;font-style:italic;">Desconto — Sinal Contratual (30%)${m.desconto_descricao ? `<br><span style="font-size:9.5px;font-style:normal;">${esc(m.desconto_descricao)}</span>` : ""}</td>
        <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #999;">− ${brl(desc)}</td>
      </tr>` : ""}
      ${acresc > 0 ? `<tr>
        <td style="padding:5px 8px;text-align:right;font-style:italic;">Hora Extra / Acréscimos${m.acrescimo_descricao ? `<br><span style="font-size:9.5px;font-style:normal;">${esc(m.acrescimo_descricao)}</span>` : ""}</td>
        <td style="padding:5px 8px;text-align:right;border-bottom:1px solid #999;">+ ${brl(acresc)}</td>
      </tr>` : ""}
      <tr>
        <td style="padding:8px;text-align:right;font-weight:700;font-size:13px;">VALOR TOTAL DA MEDIÇÃO</td>
        <td style="padding:8px;text-align:right;font-weight:700;font-size:13px;border-bottom:3px double #000;">${brl(total)}</td>
      </tr>
    </table>`;

  return `
<div id="pdf-medicao" style="font-family: Arial, Helvetica, sans-serif; color:#000; font-size:11px; width:186mm; background:#fff;">

  ${headerSGQ()}

  <!-- Identificação da obra (bloco principal de destaque) -->
  <table style="width:100%;border-collapse:collapse;border:1px solid #000;margin:12px 0;font-size:10.5px;">
    <tr style="background:#f4f4f4;">
      <td colspan="2" style="padding:6px 10px;border:1px solid #000;font-weight:700;font-size:13px;">
        ${esc(obra.codigo||"—")} — ${esc(obra.nome||"—")}
      </td>
      <td style="padding:6px 10px;border:1px solid #000;font-weight:700;text-align:right;width:20%;">
        Medição: ${esc(m.numero||"—")}
      </td>
    </tr>
    <tr>
      <td style="padding:5px 10px;border:1px solid #000;width:50%;">
        <strong>Endereço:</strong> ${esc(endereco || "—")}
      </td>
      <td style="padding:5px 10px;border:1px solid #000;">
        <strong>Cliente:</strong> ${esc(cli.nome||"—")}
      </td>
      <td style="padding:5px 10px;border:1px solid #000;">
        <strong>CNPJ:</strong> ${esc(cli.cpf_cnpj||"—")}
      </td>
    </tr>
    <tr>
      <td style="padding:5px 10px;border:1px solid #000;" colspan="2">
        <strong>Realizado entre:</strong> ${esc(periodo)}
      </td>
      <td style="padding:5px 10px;border:1px solid #000;">
        <strong>Contrato:</strong> ${esc(contr.numero||"—")}
      </td>
    </tr>
  </table>

  ${blocoEstacas}
  ${blocoResumoDiam}
  ${blocoMobilizacao}
  ${blocoResumoDiario}
  ${blocoOcorrencias}
  ${blocoTotal}

  ${m.observacoes ? `
    <div style="margin-top:14px;font-size:10px;padding:8px;border:1px solid #ccc;">
      <strong>Observações:</strong><br>${esc(m.observacoes).replace(/\n/g,"<br>")}
    </div>` : ""}

  ${rodape(cli)}
</div>`;
}

/* Cabeçalho SGQ comum (todas medições) */
function headerSGQ(){
  return `
  <table style="width:100%;border-collapse:collapse;border:1px solid #000;font-size:10px;">
    <tr style="background:#f0f0f0;">
      <th style="padding:5px 8px;border:1px solid #000;font-weight:700;text-align:left;width:30%;">Tipo de Documento</th>
      <th style="padding:5px 8px;border:1px solid #000;font-weight:700;text-align:center;width:40%;">Sistema de Gestão da Qualidade</th>
      <th style="padding:5px 8px;border:1px solid #000;font-weight:700;text-align:left;width:30%;">Identificação</th>
    </tr>
    <tr>
      <td rowspan="3" style="padding:10px;border:1px solid #000;vertical-align:middle;text-align:center;">
        <div style="font-size:18px;font-weight:700;letter-spacing:1.5px;">HÉLICE</div>
      </td>
      <td rowspan="3" style="padding:10px;border:1px solid #000;vertical-align:middle;text-align:center;">
        ${pdfCabecalhoHTML("RELATÓRIO DE MEDIÇÃO")}
      </td>
      <td style="padding:5px 8px;border:1px solid #000;"><strong>RG 11.4 — IT 11.3</strong></td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #000;"><strong>Revisão</strong><br>01 — 03/06/2024</td>
    </tr>
  </table>`;
}

/* Rodapé sutil (todas medições) */
function rodape(cli){
  return `
  <div style="margin-top:24px;padding-top:6px;border-top:1px solid #999;font-size:9.5px;color:#555;display:flex;justify-content:space-between;">
    <span>${esc(cli?.nome || "")}</span>
    <span>CGL Fundações &nbsp;|&nbsp; cglfundacoes.com.br</span>
  </div>`;
}

async function excluirMedicao(){
  if(!medEditId) return;
  if(!confirm("Excluir esta medição?")) return;
  const { error } = await sb.from("medicoes").delete().eq("id", medEditId);
  if(error){
    aviso("app-aviso","Não foi possível excluir: "+error.message,"erro");
    return;
  }
  aviso("app-aviso","Medição excluída.","ok");
  await carregarMedicoes();
  mostrarPainelMed();
}

/* ====================================================================
   FASE 88 (19/10/2026, chamado #54) — IMPORTAR BOLETIM DE MEDIÇÃO JÁ EMITIDO (PDF)
   O PDF é o boletim que a CGL calculou e enviou ao cliente (Maya nas obras de hélice e
   secante; planilha da CGL nas de raiz e trado). A edge function extrair-medicao-pdf lê e
   devolve JSON; aqui o usuário confere item a item contra a cascata de preço do app
   (RPC medicao_precos_cascata: orçamento aprovado > preço do cliente > referência), escolhe
   por item "usar o lido" (padrão: já foi ao cliente) ou "usar o do app", e confirma. A
   medição nasce aprovada, origem = 'importada_pdf', com o PDF no bucket obras-documentos
   (medicoes/<obra>/). Vários PDFs entram em fila e são conferidos um a um.
   Fora: gerar a medição a partir do RDO; boletim do cliente/fiscalização.
   ==================================================================== */
const MED_IMP_MAX_BYTES   = 2 * 1024 * 1024;
const MED_IMP_MAX_PAGINAS = 10;
const MED_IMP_CARGOS      = ["diretor", "admin", "financeiro", "engenheiro", "assistente_engenharia"]; // mesma lista da function
const MED_IMP_UNIDADES_VALIDAS = (typeof UNIDADES !== "undefined" ? UNIDADES : []).concat(["km"]);
const MED_IMP_UNIDADE_MAPA = {
  m:"m", ml:"m", metro:"m", metros:"m", "m.l":"m", "m/l":"m", mts:"m",
  m2:"m2", "m²":"m2", m3:"m3", "m³":"m3",
  un:"un", und:"un", unid:"un", unidade:"un", unidades:"un", pç:"pc", pc:"pc", peca:"pc", "peça":"pc",
  vb:"vb", verba:"vb", gl:"vb", global:"vb", cj:"jg", conj:"jg", jg:"jg",
  kg:"kg", t:"ton", ton:"ton", l:"l", lt:"l", km:"km", sc:"sc", cx:"cx", par:"par", rl:"rl",
  dia:"diária", dias:"diária", diaria:"diária", "diária":"diária", "diárias":"diária", mes:"mês", "mês":"mês", meses:"mês",
  h:"un", hs:"un", hr:"un", hrs:"un", hora:"un", horas:"un"   // o enum unidade_medida não tem hora: vira "un" e a tela avisa
};
let _medImp = null;          // estado da importação em curso (modal aberto)
let _medBoletimPath = null;  // caminho do PDF da medição aberta na ficha

function medImpPodeImportar(){ return !!usuarioAtual && MED_IMP_CARGOS.includes(usuarioAtual.cargo); }

function medImpNormalizarUnidade(u){
  const raw = String(u || "").trim();
  const chave = raw.toLowerCase().replace(/\s+/g, "").replace(/\.+$/, "");
  if(!raw) return { valor: "un", aviso: "sem unidade no PDF: gravada como un" };
  if(MED_IMP_UNIDADES_VALIDAS.includes(chave)) return { valor: chave, aviso: null };
  const map = MED_IMP_UNIDADE_MAPA[chave];
  if(map){
    const perde = /^(h|hs|hr|hrs|hora|horas)$/.test(chave);
    return { valor: map, aviso: perde ? `unidade "${raw}" não existe no app: gravada como un (a descrição guarda a hora)` : null };
  }
  return { valor: "un", aviso: `unidade "${raw}" não existe no app: gravada como un` };
}

/* Texto sem acento, minúsculo, só letras e dígitos; Ø e "diâmetro" viram "d" para casar "Ø 400" com "D400" */
function medImpNormalizarTexto(s){
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ø|diametro|diam\.?|\bdn\b/g, " d ").replace(/[^a-z0-9]+/g, " ").trim();
}
const MED_IMP_STOP = new Set(["de","da","do","das","dos","em","mm","com","por","a","e","o","ate","at"]);
function medImpTokens(s){ return new Set(medImpNormalizarTexto(s).split(" ").filter(t => t.length > 1 && !MED_IMP_STOP.has(t))); }
/* Casa a descrição lida com a cascata: tokens em comum + números iguais (diâmetro, faixa). A lista já
   vem na ordem orçamento > cliente > referência, então o empate fica com o primeiro nível. */
function medImpCasarCascata(descricao){
  const lista = (_medImp && _medImp.cascata) || [];
  if(!lista.length || !descricao) return null;
  const alvoLido = medImpNormalizarTexto(descricao);
  const a = medImpTokens(descricao);
  const numsA = alvoLido.match(/\d+/g) || [];
  let melhor = null, melhorPts = 0;
  lista.forEach(c => {
    const texto = c.descricao || c.variante_nome || "";
    if(!texto) return;
    const alvo = medImpNormalizarTexto(texto);
    let pts;
    if(alvo === alvoLido){
      pts = 2;
    } else {
      const b = medImpTokens(texto);
      let comum = 0; a.forEach(t => { if(b.has(t)) comum++; });
      const uniao = new Set([...a, ...b]).size || 1;
      pts = comum / uniao;
      const numsB = alvo.match(/\d+/g) || [];
      if(numsA.length && numsB.length){
        const iguais = numsA.filter(n => numsB.includes(n)).length;
        pts += (iguais === numsA.length && iguais === numsB.length) ? 0.3 : (iguais ? 0.1 : -0.3);
      }
    }
    if(pts > melhorPts){ melhor = c; melhorPts = pts; }
  });
  return melhorPts >= 0.45 ? melhor : null;
}

function medImpEstadoInicial(obraId){
  return { obraId, obra: null, cascata: [], cascataErro: null, numerosExistentes: [], equipamentos: [], tipoServico: null,
           fila: [], atual: null, resp: null, itens: [], cab: null };
}
function medImpLimparAviso(){ const el = $("med-imp-aviso"); if(el){ el.textContent = ""; el.className = "aviso"; } }

async function abrirImportBoletimPDF(obraId){
  if(!obraId){ aviso("app-aviso", "Salve a obra antes de importar boletins.", "erro"); return; }
  if(!$("med-imp-modal")) return;
  _medImp = medImpEstadoInicial(obraId);
  $("med-imp-fila").innerHTML = "";
  $("med-imp-conf").style.display = "none"; $("med-imp-conf").innerHTML = "";
  $("med-imp-acoes").style.display = "none";
  $("med-imp-arquivo").value = "";
  medImpLimparAviso();
  $("med-imp-obra-txt").textContent = mapaObras[obraId] ? `· ${mapaObras[obraId]}` : "";
  $("med-imp-modal").style.display = "flex";
  if(!medImpPodeImportar()){
    aviso("med-imp-aviso", "Seu cargo não importa boletins (diretor, admin, financeiro, engenheiro ou assistente de engenharia).", "erro");
  } else if(usuarioAtual && ["financeiro", "assistente_engenharia"].includes(usuarioAtual.cargo)){
    // divergência registrada na fase 88: a function aceita estes cargos, mas medicao_itens_write e o bucket
    // obras-documentos hoje só aceitam admin, engenheiro e comercial (além do diretor)
    aviso("med-imp-aviso", "Atenção: seu cargo lê o boletim, mas a gravação dos itens e o anexo do PDF dependem de permissão no banco (hoje: admin, engenheiro e comercial). Se a gravação for recusada, peça ao diretor.", "aviso");
  }
  await medImpCarregarContextoObra();
}
function fecharImportBoletimPDF(){
  if(_medImp && _medImp.atual && _medImp.atual.status === "lendo" && !confirm("Há um boletim sendo lido. Fechar mesmo assim?")) return;
  $("med-imp-modal").style.display = "none";
  _medImp = null;
}

/* Obra, medições existentes (não duplicar número), cascata de preço, TAGs e tipo de serviço (pelos RDOs) */
async function medImpCarregarContextoObra(){
  const st = _medImp; if(!st) return;
  const [obraRes, medsRes, casRes, eqRes, rdoRes] = await Promise.all([
    sb.from("obras").select("id,codigo,nome,cliente_id,contrato_id,iss_percentual,cliente:cliente_id(nome),contrato:contrato_id(numero),financeiro:obras_financeiro(valor_contratado)").eq("id", st.obraId).single(),
    sb.from("medicoes").select("numero,status").eq("obra_id", st.obraId),
    sb.rpc("medicao_precos_cascata", { p_obra_id: st.obraId }),
    sb.from("equipamentos").select("id,codigo").not("codigo", "is", null).limit(500),
    sb.from("rdo").select("tipo_servico").eq("obra_id", st.obraId).not("tipo_servico", "is", null).limit(1)
  ]);
  if(_medImp !== st) return; // modal fechado no meio
  st.obra = obraRes.data || null;
  st.numerosExistentes = (medsRes.data || []).map(m => String(m.numero || "").trim().toLowerCase());
  st.cascata = casRes.error ? [] : (casRes.data || []);
  st.cascataErro = casRes.error ? casRes.error.message : null;
  st.equipamentos = eqRes.data || [];
  st.tipoServico = rdoRes.data && rdoRes.data[0] ? rdoRes.data[0].tipo_servico : null;
}

/* ---- fila de arquivos ---- */
function medImpAdicionarArquivos(files){
  if(!_medImp) return;
  medImpLimparAviso();
  const erros = [];
  Array.from(files || []).forEach(f => {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if(ext !== "pdf" && f.type !== "application/pdf"){ erros.push(`${f.name}: não é PDF`); return; }
    if(f.size > MED_IMP_MAX_BYTES){ erros.push(`${f.name}: ${(f.size / 1048576).toFixed(1)} MB (limite 2 MB; exporte só as páginas do boletim)`); return; }
    _medImp.fila.push({ file: f, nome: f.name, status: "fila", erro: null, medicaoId: null });
  });
  if(erros.length) aviso("med-imp-aviso", erros.join(" · "), "erro");
  medImpRenderFila();
  if(!_medImp.atual) medImpProcessarProximo();
}
function medImpRenderFila(){
  const ul = $("med-imp-fila"); if(!ul || !_medImp) return;
  const rot = { fila: "na fila", lendo: "lendo…", conferindo: "em conferência", feito: "gravada", erro: "erro", pulado: "pulado" };
  ul.innerHTML = _medImp.fila.map(a => `<li class="${(a.status === "lendo" || a.status === "conferindo") ? "atual" : esc(a.status)}" title="${esc(a.erro || "")}">📄 ${esc(a.nome)} · ${rot[a.status] || esc(a.status)}${a.erro ? " · " + esc(a.erro) : ""}</li>`).join("");
}
function medImpLerArquivo(file, modo){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Não foi possível ler o PDF."));
    if(modo === "base64") fr.readAsDataURL(file); else fr.readAsArrayBuffer(file);
  });
}
/* Conta os objetos /Type /Page do PDF (aproximação; PDF com object streams comprimidos devolve 0 e não barra) */
async function medImpContarPaginas(file){
  try {
    const buf = await medImpLerArquivo(file, "buffer");
    const bin = new TextDecoder("latin1").decode(new Uint8Array(buf));
    return (bin.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  } catch(_){ return 0; }
}
async function medImpProcessarProximo(){
  const st = _medImp; if(!st) return;
  const prox = st.fila.find(a => a.status === "fila");
  const cont = $("med-imp-conf");
  if(!prox){
    st.atual = null; st.resp = null; st.cab = null; st.itens = [];
    $("med-imp-acoes").style.display = "none";
    if(st.fila.length){
      const feitas = st.fila.filter(a => a.status === "feito").length;
      cont.style.display = "";
      cont.innerHTML = `<p class="vazio">Fila concluída: ${feitas} medição(ões) gravada(s) aprovada(s). Escolha outros PDFs ou feche.</p>`;
    }
    return;
  }
  st.atual = prox; prox.status = "lendo"; medImpRenderFila();
  cont.style.display = "";
  cont.innerHTML = `<p class="vazio">🤖 Lendo <strong>${esc(prox.nome)}</strong>… isso leva de 20 a 90 segundos.</p>`;
  $("med-imp-acoes").style.display = "none";
  try {
    const paginas = await medImpContarPaginas(prox.file);
    if(paginas > MED_IMP_MAX_PAGINAS) throw new Error(`PDF com ${paginas} páginas; o limite é ${MED_IMP_MAX_PAGINAS}. Envie só as páginas do boletim.`);
    const dataUrl = await medImpLerArquivo(prox.file, "base64");
    const base64 = String(dataUrl).split(",")[1];
    const o = st.obra || {};
    const contexto = {
      obra_codigo: o.codigo || null, obra_nome: o.nome || null,
      cliente_nome: o.cliente?.nome || null, contrato_numero: o.contrato?.numero || null,
      tipo_servico: st.tipoServico,
      itens_orcamento: st.cascata.filter(c => c.fonte === "orcamento_obra").map(c => c.descricao).filter(Boolean).slice(0, 60),
      maquinas: st.equipamentos.map(e => e.codigo).filter(Boolean)
    };
    const { data, error } = await iaInvocarComLimite("extrair-medicao-pdf", { arquivo_base64: base64, media_type: "application/pdf", contexto },
      "A leitura demorou demais. Exporte só as páginas do boletim e tente de novo.");
    if(error){
      let detalhe = error.message || "";
      try {
        if(error.context && typeof error.context.json === "function"){
          const b = await error.context.json();
          if(b){ detalhe = b.error || JSON.stringify(b); if(b.sugestao) detalhe += " 💡 " + b.sugestao; }
        }
      } catch(_){ /* segue */ }
      throw new Error(detalhe || "Falha ao chamar a leitura por IA.");
    }
    if(data && data.error) throw new Error(data.error + (data.sugestao ? " 💡 " + data.sugestao : ""));
    if(_medImp !== st) return;
    if(!data || !Array.isArray(data.itens) || !data.itens.length){
      throw new Error("A IA não reconheceu um boletim de medição com itens neste arquivo. " + (data?.observacoes || ""));
    }
    prox.status = "conferindo"; medImpRenderFila();
    st.resp = data;
    medImpMontarConferencia(data, prox);
  } catch(err){
    if(_medImp !== st) return;
    prox.status = "erro"; prox.erro = err?.message || "falha sem mensagem"; medImpRenderFila();
    aviso("med-imp-aviso", `${prox.nome}: ${prox.erro}`, "erro");
    cont.innerHTML = `<p class="vazio">${esc(prox.erro)}</p>`;
    st.atual = null;
    if(st.fila.some(a => a.status === "fila")) medImpProcessarProximo();
  }
}
function medImpPular(){
  const st = _medImp; if(!st || !st.atual) return;
  st.atual.status = "pulado"; st.atual = null; st.cab = null; st.resp = null; st.itens = [];
  medImpRenderFila();
  medImpProcessarProximo();
}

/* ---- conferência ---- */
function medImpMontarConferencia(resp, arq){
  const st = _medImp; if(!st) return;
  const m = resp.medicao || {};
  const o = st.obra || {};
  st.itens = (resp.itens || []).map((it, i) => {
    const uni = medImpNormalizarUnidade(it.unidade);
    const cas = medImpCasarCascata(it.descricao);
    const qtd = Number(it.quantidade) || 0;
    const vuLido = Number(it.valor_unitario) || 0;
    return {
      ordem: i + 1, descricao: it.descricao || "", unidade: uni.valor, unidade_lida: it.unidade || "", unidade_aviso: uni.aviso,
      quantidade: qtd, quantidade_lida: qtd, valor_unitario_lido: vuLido,
      valor_total_lido: it.valor_total != null ? Number(it.valor_total) : +(qtd * vuLido).toFixed(2),
      tag: it.tag || m.equipamento || null, cascata: cas, usar: "lido", conferido: false, removido: false
    };
  });
  const sinalV = m.sinal?.valor ?? ((m.sinal?.percentual && m.subtotal) ? +(m.subtotal * m.sinal.percentual / 100).toFixed(2) : 0);
  const acrescV = (m.acrescimos || []).reduce((s, a) => s + (Number(a.valor) || 0), 0);
  st.cab = {
    numero: m.numero || "", tipo_medicao: m.tipo_medicao || "quinzenal",
    data: m.data || m.periodo_fim || hojeISO(), periodo_inicio: m.periodo_inicio || "", periodo_fim: m.periodo_fim || "",
    desconto_sinal: +(Number(sinalV) || 0).toFixed(2),
    desconto_descricao: m.sinal?.descricao || (sinalV ? "Desconto do sinal contratual lido no boletim" : ""),
    acrescimo: +acrescV.toFixed(2),
    acrescimo_descricao: (m.acrescimos || []).map(a => a.descricao ? `${a.descricao}${a.valor != null ? " " + brl(a.valor) : ""}` : brl(a.valor)).join(" · "),
    ret_pct: m.retencao?.percentual ?? "", ret_valor: m.retencao?.valor ?? "", ret_manual: m.retencao?.valor != null && m.retencao?.percentual == null,
    iss_pct: m.iss?.percentual ?? (o.iss_percentual ?? ""), iss_valor: m.iss?.valor ?? "", iss_manual: m.iss?.valor != null && m.iss?.percentual == null,
    iss_origem: m.iss?.percentual != null ? "lido no boletim" : (o.iss_percentual != null ? "da obra (o boletim não traz ISS)" : ""),
    iss_retido: m.iss?.retido_fonte === false ? "false" : "true",
    valor_final_lido: m.valor_final, subtotal_lido: m.subtotal,
    obra_ref: m.obra_ref || "", cliente: m.cliente || "", contrato: m.contrato || "",
    observacoes: m.observacoes || ""
  };
  medImpRenderConferencia(resp, arq);
}

function medImpLinhaItem(it, i){
  const cas = it.cascata;
  const oi = cas ? (PRECO_ORIGEM_INFO[cas.fonte] || PRECO_ORIGEM_INFO.manual) : null;
  const vuApp = cas ? (Number(cas.valor_unitario) || 0) : null;
  const dif = vuApp != null ? it.valor_unitario_lido - vuApp : null;
  const difAlta = dif != null && Math.abs(dif) > Math.max(0.01, Math.abs(vuApp) * 0.005);
  const uniOpts = MED_IMP_UNIDADES_VALIDAS.map(u => `<option value="${esc(u)}"${u === it.unidade ? " selected" : ""}>${esc(u)}</option>`).join("");
  return `<tr data-idx="${i}" class="${cas ? "" : "sem-app"}">
    <td>${i + 1}</td>
    <td><input data-c="descricao" value="${esc(it.descricao)}" style="min-width:240px" />
        ${it.unidade_aviso ? `<div class="meta" style="color:var(--aviso-txt);">⚠️ ${esc(it.unidade_aviso)}</div>` : ""}
        ${cas ? `<div class="meta" title="Item do app casado pela descrição">≈ ${esc(cas.descricao || cas.variante_nome || "")}${(cas.fonte === "orcamento_obra" && cas.orcamento_numero) ? ` · orç. ${esc(cas.orcamento_numero)}${cas.orcamento_revisao ? " rev " + esc(cas.orcamento_revisao) : ""}` : ""}</div>` : ""}</td>
    <td><select data-c="unidade" title="Lido no PDF: ${esc(it.unidade_lida || "—")}">${uniOpts}</select></td>
    <td class="num"><input type="number" step="0.001" min="0" data-c="quantidade" value="${it.quantidade}" style="width:84px" /></td>
    <td class="num"><input type="number" step="0.01" min="0" data-c="valor_unitario_lido" value="${it.valor_unitario_lido}" style="width:92px" /></td>
    <td class="num" title="Total impresso no PDF">${brl(it.valor_total_lido)}</td>
    <td class="num col-app">${vuApp != null ? brl(vuApp) : "—"}</td>
    <td class="col-app">${oi ? `<span class="badge-origem" style="background:${oi.bg};color:${oi.cor};">${oi.ic} ${oi.lbl}</span>` : '<span class="meta">sem preço no app</span>'}</td>
    <td class="num med-imp-dif${difAlta ? " dif-alta" : ""}">${dif != null ? (dif > 0 ? "+" : "") + brl(dif) : "—"}</td>
    <td style="white-space:nowrap;"><label class="meta"><input type="radio" name="med-imp-usar-${i}" data-c="usar" value="lido"${it.usar === "lido" ? " checked" : ""} /> lido</label><br><label class="meta"><input type="radio" name="med-imp-usar-${i}" data-c="usar" value="app"${it.usar === "app" ? " checked" : ""}${cas ? "" : " disabled"} /> app</label></td>
    <td><input data-c="tag" value="${esc(it.tag || "")}" style="width:72px" placeholder="HC-66" /></td>
    <td style="text-align:center;"><input type="checkbox" data-c="conferido"${it.conferido ? " checked" : ""} title="Conferido" /></td>
    <td class="col-acao"><button type="button" class="btn-rem med-imp-rem" title="não importar esta linha">&times;</button></td>
  </tr>`;
}

function medImpRenderConferencia(resp, arq){
  const st = _medImp; if(!st || !st.cab) return;
  const c = st.cab, o = st.obra || {};
  const cont = $("med-imp-conf");
  const conf = resp.confianca || "media";
  const corConf = conf === "alta" ? "var(--sucesso)" : conf === "baixa" ? "var(--perigo)" : "var(--aviso)";
  const leiauteLbl = { maya_helice: "boletim do Maya (hélice/secante)", planilha_cgl: "planilha da CGL (raiz/trado)", outro: "leiaute não reconhecido" }[resp.leiaute] || "—";
  const refs = [o.codigo, o.contrato?.numero].filter(Boolean).map(medImpNormalizarTexto);
  const refLida = medImpNormalizarTexto(c.obra_ref);
  const refOk = !refLida || refs.some(r => r && (refLida.includes(r) || r.includes(refLida)));
  const dup = c.numero && st.numerosExistentes.includes(String(c.numero).trim().toLowerCase());
  const tipoOpts = Object.entries({ quinzenal: "Quinzenal", sinal_contratual: "Sinal contratual", final: "Final", avulsa: "Avulsa" })
    .map(([k, l]) => `<option value="${k}"${k === c.tipo_medicao ? " selected" : ""}>${l}</option>`).join("");
  const v = (x) => (x == null ? "" : x);

  cont.innerHTML = `<div class="ia-conf-topo">
    <div>🤖 <strong>Lido por IA</strong> · ${esc(arq.nome)} · ${esc(leiauteLbl)} · confiança <strong style="color:${corConf}">${esc(conf)}</strong>
      ${resp.observacoes ? `<div class="meta">${esc(resp.observacoes)}</div>` : ""}</div>
    ${resp.escaneado ? `<div class="ia-duvidas">⚠️ PDF sem camada de texto (escaneado ou foto): a IA leu como imagem e a precisão cai. Confira cada número.</div>` : ""}
    ${(resp.duvidas || []).length ? `<div class="ia-duvidas">⚠️ Pontos para conferir: ${resp.duvidas.map(esc).join(" · ")}</div>` : ""}
    ${!refOk ? `<div class="ia-duvidas">⚠️ O boletim cita a obra/contrato "${esc(c.obra_ref)}", mas a obra aberta é ${esc(o.codigo || "")}${o.contrato?.numero ? " (contrato " + esc(o.contrato.numero) + ")" : ""}. Confira se é o PDF certo.</div>` : ""}
    ${st.cascataErro ? `<div class="ia-duvidas">Sem preço do app para comparar: ${esc(st.cascataErro)}</div>` : (!st.cascata.length ? `<div class="meta">Sem preço do app para comparar (obra sem orçamento aprovado, sem preço de cliente e sem referência, ou seu cargo não lê orçamentos e preços).</div>` : "")}
    <div class="meta">Confira e corrija. Por item, escolha <strong>usar o lido</strong> (padrão: já foi ao cliente) ou <strong>usar o do app</strong> (cascata: orçamento › cliente › referência). Linhas removidas com ✕ não entram. A medição é gravada <strong>aprovada</strong>, com o PDF anexado.</div>
  </div>
  <div class="grade med-imp-cab">
    <div class="campo"><label>Número *</label><input id="med-imp-h-numero" value="${esc(c.numero)}" placeholder="ex.: 03" /></div>
    <div class="campo"><label>Tipo</label><select id="med-imp-h-tipo">${tipoOpts}</select></div>
    <div class="campo"><label>Data da medição</label><input id="med-imp-h-data" type="date" value="${esc(c.data)}" /></div>
    <div class="campo"><label>Período — início</label><input id="med-imp-h-ini" type="date" value="${esc(c.periodo_inicio)}" /></div>
    <div class="campo"><label>Período — fim</label><input id="med-imp-h-fim" type="date" value="${esc(c.periodo_fim)}" /></div>
    <div class="campo"><label>Obra / contrato no PDF</label><input value="${esc([c.obra_ref, c.contrato].filter(Boolean).join(" · ") || "—")}" readonly /></div>
    <div class="campo"><label>Cliente no PDF</label><input value="${esc(c.cliente || "—")}" readonly /></div>
  </div>
  <div id="med-imp-dup" class="med-imp-dup" style="${dup ? "" : "display:none;"}">Já existe a medição <strong>${esc(c.numero)}</strong> nesta obra. Altere o número ou pule este arquivo: a importação não duplica.</div>
  <div class="tabela-rola"><table class="itens-tabela ia-tabela med-imp-tabela">
    <thead><tr>
      <th>#</th><th>Descrição</th><th>Un.</th>
      <th class="num" title="Lido no PDF">Qtd lida</th><th class="num" title="Lido no PDF">Unit. lido</th><th class="num" title="Lido no PDF">Total lido</th>
      <th class="num" title="Cascata de preço do app: orçamento aprovado › preço do cliente › referência">Unit. app</th><th title="Origem do preço do app">Origem app</th><th class="num" title="Unit. lido − Unit. app">Dif.</th>
      <th title="Qual unitário fica na medição">Usar</th><th title="TAG da máquina, quando o PDF trouxer">TAG</th><th title="Marque depois de conferir">✓</th><th></th>
    </tr></thead>
    <tbody>${st.itens.map((it, i) => medImpLinhaItem(it, i)).join("")}</tbody>
  </table></div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0;">
    <button type="button" class="btn-sec btn-sm" id="btn-med-imp-conferir-todos">✓ Marcar todos como conferidos</button>
    <button type="button" class="btn-sec btn-sm" id="btn-med-imp-usar-app" title="Só nos itens que têm preço no app">Usar o do app em todos</button>
    <button type="button" class="btn-sec btn-sm" id="btn-med-imp-usar-lido">Usar o lido em todos</button>
  </div>
  <div class="grade med-imp-cab">
    <div class="campo"><label>Desconto do sinal (R$)</label><input id="med-imp-h-sinal" type="number" step="0.01" min="0" value="${v(c.desconto_sinal)}" /></div>
    <div class="campo largo"><label>Descrição do desconto</label><input id="med-imp-h-sinal-obs" value="${esc(c.desconto_descricao)}" /></div>
    <div class="campo"><label>Acréscimos (R$)</label><input id="med-imp-h-acresc" type="number" step="0.01" min="0" value="${v(c.acrescimo)}" /></div>
    <div class="campo largo"><label>Descrição dos acréscimos</label><input id="med-imp-h-acresc-obs" value="${esc(c.acrescimo_descricao)}" /></div>
    <div class="campo"><label>Retenção contratual (%)</label><input id="med-imp-h-ret-pct" type="number" step="0.01" min="0" max="100" value="${v(c.ret_pct)}" /></div>
    <div class="campo"><label>Valor retido (R$)</label><input id="med-imp-h-ret-valor" type="number" step="0.01" min="0" value="${v(c.ret_valor)}" data-manual="${c.ret_manual ? "1" : "0"}" /></div>
    <div class="campo"><label>ISS (%) <small class="meta">${esc(c.iss_origem)}</small></label><input id="med-imp-h-iss-pct" type="number" step="0.01" min="0" max="100" value="${v(c.iss_pct)}" /></div>
    <div class="campo"><label>Valor do ISS (R$)</label><input id="med-imp-h-iss-valor" type="number" step="0.01" min="0" value="${v(c.iss_valor)}" data-manual="${c.iss_manual ? "1" : "0"}" /></div>
    <div class="campo"><label>ISS retido na fonte?</label><select id="med-imp-h-iss-retido"><option value="true"${c.iss_retido === "true" ? " selected" : ""}>Sim (cliente retém e recolhe)</option><option value="false"${c.iss_retido === "false" ? " selected" : ""}>Não (CGL recolhe)</option></select></div>
    <div class="campo largo"><label>Observações</label><input id="med-imp-h-obs" value="${esc(c.observacoes)}" /></div>
  </div>
  <div class="indicadores med-imp-totais" id="med-imp-totais"></div>`;
  $("med-imp-acoes").style.display = "";

  cont.querySelectorAll("tbody tr[data-idx]").forEach(tr => {
    const sync = () => { medImpLerLinha(tr); medImpAtualizarLinha(tr); medImpAtualizarTotais(); };
    tr.addEventListener("input", sync);
    tr.addEventListener("change", sync);
    tr.querySelector(".med-imp-rem")?.addEventListener("click", () => { st.itens[Number(tr.dataset.idx)].removido = true; tr.remove(); medImpAtualizarTotais(); });
  });
  $("med-imp-h-numero")?.addEventListener("input", medImpChecarDuplicado);
  $("med-imp-h-tipo")?.addEventListener("change", medImpAtualizarTotais);
  ["med-imp-h-sinal", "med-imp-h-acresc", "med-imp-h-ret-pct", "med-imp-h-iss-pct"].forEach(id => $(id)?.addEventListener("input", () => {
    if(id === "med-imp-h-ret-pct" && $("med-imp-h-ret-valor")) $("med-imp-h-ret-valor").dataset.manual = "0";
    if(id === "med-imp-h-iss-pct" && $("med-imp-h-iss-valor")) $("med-imp-h-iss-valor").dataset.manual = "0";
    medImpAtualizarTotais();
  }));
  $("med-imp-h-iss-retido")?.addEventListener("change", medImpAtualizarTotais);
  $("med-imp-h-ret-valor")?.addEventListener("input", () => { $("med-imp-h-ret-valor").dataset.manual = "1"; medImpAtualizarTotais(); });
  $("med-imp-h-iss-valor")?.addEventListener("input", () => { $("med-imp-h-iss-valor").dataset.manual = "1"; medImpAtualizarTotais(); });
  $("btn-med-imp-conferir-todos")?.addEventListener("click", () => {
    cont.querySelectorAll('tbody tr[data-idx] [data-c="conferido"]').forEach(ch => { ch.checked = true; });
    st.itens.forEach(it => { if(!it.removido) it.conferido = true; });
  });
  $("btn-med-imp-usar-app")?.addEventListener("click", () => medImpUsarTodos("app"));
  $("btn-med-imp-usar-lido")?.addEventListener("click", () => medImpUsarTodos("lido"));
  medImpAtualizarTotais();
}

function medImpLerLinha(tr){
  const it = _medImp?.itens[Number(tr.dataset.idx)]; if(!it) return;
  it.descricao = tr.querySelector('[data-c="descricao"]').value.trim();
  it.unidade = tr.querySelector('[data-c="unidade"]').value;
  it.quantidade = parseFloat(tr.querySelector('[data-c="quantidade"]').value) || 0;
  it.valor_unitario_lido = parseFloat(tr.querySelector('[data-c="valor_unitario_lido"]').value) || 0;
  const usar = tr.querySelector('[data-c="usar"]:checked'); it.usar = usar ? usar.value : "lido";
  it.tag = tr.querySelector('[data-c="tag"]').value.trim() || null;
  it.conferido = tr.querySelector('[data-c="conferido"]').checked;
}
function medImpAtualizarLinha(tr){
  const it = _medImp?.itens[Number(tr.dataset.idx)]; if(!it) return;
  const vuApp = it.cascata ? (Number(it.cascata.valor_unitario) || 0) : null;
  const dif = vuApp != null ? it.valor_unitario_lido - vuApp : null;
  const difAlta = dif != null && Math.abs(dif) > Math.max(0.01, Math.abs(vuApp) * 0.005);
  const cel = tr.querySelector(".med-imp-dif");
  if(cel){ cel.textContent = dif != null ? (dif > 0 ? "+" : "") + brl(dif) : "—"; cel.classList.toggle("dif-alta", difAlta); }
}
function medImpUnitarioEscolhido(it){ return (it.usar === "app" && it.cascata) ? (Number(it.cascata.valor_unitario) || 0) : (Number(it.valor_unitario_lido) || 0); }
function medImpUsarTodos(modo){
  const st = _medImp; if(!st) return;
  st.itens.forEach((it, i) => {
    if(it.removido) return;
    if(modo === "app" && !it.cascata) return;
    it.usar = modo;
    const r = document.querySelector(`input[name="med-imp-usar-${i}"][value="${modo}"]`); if(r) r.checked = true;
  });
  medImpAtualizarTotais();
}
function medImpChecarDuplicado(){
  const st = _medImp; if(!st) return false;
  const n = ($("med-imp-h-numero")?.value || "").trim().toLowerCase();
  const dup = !!n && st.numerosExistentes.includes(n);
  const el = $("med-imp-dup");
  if(el){
    el.style.display = dup ? "" : "none";
    if(dup) el.innerHTML = `Já existe a medição <strong>${esc(n)}</strong> nesta obra. Altere o número ou pule este arquivo: a importação não duplica.`;
  }
  return dup;
}

/* Mesma conta de recalcularTotaisMedicao: (subtotal − sinal + acréscimo) × multiplicador; retenção e ISS
   pelo % a menos que o valor tenha sido digitado; líquido = final − retenção − ISS retido na fonte */
function medImpCalcular(){
  const st = _medImp; if(!st || !st.cab) return null;
  const ativos = st.itens.filter(it => !it.removido);
  const subtotal = +ativos.reduce((s, it) => s + it.quantidade * medImpUnitarioEscolhido(it), 0).toFixed(2);
  const tipo = $("med-imp-h-tipo")?.value || "quinzenal";
  const descSinal = parseFloat($("med-imp-h-sinal")?.value) || 0;
  const acresc = parseFloat($("med-imp-h-acresc")?.value) || 0;
  let mult = 100;
  if(tipo === "sinal_contratual"){
    const vf = Number(st.cab.valor_final_lido);
    mult = (vf > 0 && subtotal > 0) ? +(vf / subtotal * 100).toFixed(2) : 30; // o boletim do sinal lista os itens cheios e o sinal (30%) no fim
    if(!(mult > 0 && mult <= 100)) mult = 30; // leitura inconsistente (sinal maior que os itens): volta ao padrão
  }
  const valorFinal = +((subtotal - descSinal + acresc) * mult / 100).toFixed(2);
  const retPct = parseFloat($("med-imp-h-ret-pct")?.value);
  const retEl = $("med-imp-h-ret-valor");
  if(retEl && retEl.dataset.manual !== "1") retEl.value = (isFinite(retPct) && retPct > 0) ? (valorFinal * retPct / 100).toFixed(2) : "";
  const issPct = parseFloat($("med-imp-h-iss-pct")?.value);
  const issEl = $("med-imp-h-iss-valor");
  if(issEl && issEl.dataset.manual !== "1") issEl.value = (isFinite(issPct) && issPct > 0) ? (valorFinal * issPct / 100).toFixed(2) : "";
  const retV = parseFloat(retEl?.value) || 0;
  const issV = parseFloat(issEl?.value) || 0;
  const issRetido = ($("med-imp-h-iss-retido")?.value || "true") !== "false";
  const liquido = +(valorFinal - retV - (issRetido ? issV : 0)).toFixed(2);
  return { subtotal, descSinal, acresc, mult, valorFinal, retPct: isFinite(retPct) ? retPct : null, retV, issPct: isFinite(issPct) ? issPct : null, issV, issRetido, liquido, tipo, itens: ativos.length };
}
function medImpAtualizarTotais(){
  const st = _medImp; if(!st || !st.cab) return;
  const t = medImpCalcular(); if(!t) return;
  const cont = $("med-imp-totais"); if(!cont) return;
  const vfLido = Number(st.cab.valor_final_lido);
  const subLido = st.cab.subtotal_lido != null ? Number(st.cab.subtotal_lido) : null;
  const difVF = (isFinite(vfLido) && vfLido > 0) ? t.valorFinal - vfLido : null;
  const difSub = subLido != null ? t.subtotal - subLido : null;
  const destaque = (d) => (d != null && Math.abs(d) > 0.5) ? ' style="color:var(--aviso-txt);"' : "";
  cont.innerHTML = `
    <div class="ind"><div class="num">${brl(t.subtotal)}<small>${t.itens} item(ns)${subLido != null ? ` · PDF ${brl(subLido)}` : ""}</small></div><div class="rot"${destaque(difSub)}>${(difSub != null && Math.abs(difSub) > 0.5) ? `Subtotal · dif. ${brl(difSub)} contra o PDF` : "Subtotal"}</div></div>
    <div class="ind"><div class="num">${t.descSinal ? "− " + brl(t.descSinal) : "—"}</div><div class="rot">Desconto do sinal</div></div>
    <div class="ind"><div class="num">${t.acresc ? "+ " + brl(t.acresc) : "—"}</div><div class="rot">Acréscimos</div></div>
    <div class="ind"><div class="num">${brl(t.valorFinal)}<small>${t.mult !== 100 ? `${num(t.mult)}% do subtotal · ` : ""}${(isFinite(vfLido) && vfLido > 0) ? `PDF ${brl(vfLido)}` : "PDF sem valor final"}</small></div><div class="rot"${destaque(difVF)}>${(difVF != null && Math.abs(difVF) > 0.5) ? `Valor final · dif. ${brl(difVF)} contra o PDF` : "Valor final"}</div></div>
    <div class="ind"><div class="num">${brl(t.liquido)}<small>− retenção ${brl(t.retV)} − ISS ${t.issRetido ? brl(t.issV) : "não retido"}</small></div><div class="rot">Líquido a receber</div></div>`;
}

/* ---- confirmar: PDF no bucket, medição aprovada e itens; desfaz tudo se os itens falharem ---- */
async function medImpConfirmar(){
  const st = _medImp; if(!st || !st.cab || !st.atual) return;
  const arq = st.atual;
  const numero = ($("med-imp-h-numero")?.value || "").trim();
  if(!numero){ aviso("med-imp-aviso", "Informe o número da medição.", "erro"); $("med-imp-h-numero")?.focus(); return; }
  if(medImpChecarDuplicado()){ aviso("med-imp-aviso", `Já existe a medição ${numero} nesta obra. Altere o número ou pule o arquivo.`, "erro"); return; }
  const t = medImpCalcular();
  if(!t || !t.itens){ aviso("med-imp-aviso", "Nenhum item para gravar.", "erro"); return; }
  const semDesc = st.itens.filter(it => !it.removido && !it.descricao).length;
  if(semDesc){ aviso("med-imp-aviso", `${semDesc} item(ns) sem descrição.`, "erro"); return; }
  const naoConf = st.itens.filter(it => !it.removido && !it.conferido).length;
  if(naoConf && !confirm(`${naoConf} item(ns) ainda sem o ✓ de conferido. Gravar a medição aprovada mesmo assim?`)) return;
  const o = st.obra || {};
  const valorObra = Number(o.financeiro?.valor_contratado) || 0;   // obras_financeiro (fase 90)
  const tipo = $("med-imp-h-tipo")?.value || "quinzenal";
  const dataMed = $("med-imp-h-data")?.value || hojeISO();
  const ini = $("med-imp-h-ini")?.value || null, fim = $("med-imp-h-fim")?.value || null;
  if(tipo !== "sinal_contratual" && (!ini || !fim) && !confirm("Medição sem período (início e fim). Gravar assim mesmo?")) return;

  medImpLimparAviso();
  // 1) PDF no bucket privado obras-documentos (supabase-js ignora contentType com File: reembala em Blob)
  let storagePath = null, avisoAnexo = "";
  const caminho = `medicoes/${st.obraId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
  try {
    const corpo = new Blob([arq.file], { type: "application/pdf" });
    const up = await sb.storage.from("obras-documentos").upload(caminho, corpo, { cacheControl: "3600", contentType: "application/pdf", upsert: false });
    if(up.error) throw up.error;
    storagePath = caminho;
  } catch(e){
    avisoAnexo = `PDF não anexado (${e.message || e}). Anexe pela aba Documentos da obra.`;
  }

  // 2) medição aprovada
  const duvidas = (st.resp?.duvidas || []);
  const obs = [($("med-imp-h-obs")?.value || "").trim(),
               `Importada do boletim "${arq.nome}" em ${dataBR(hojeISO())}${duvidas.length ? " · pontos conferidos: " + duvidas.join("; ") : ""}`].filter(Boolean);
  const reg = {
    numero, obra_id: st.obraId, contrato_id: o.contrato_id || null,
    tipo_medicao: tipo, multiplicador_pct: t.mult,
    status: "aprovada", origem: "importada_pdf", arquivo_origem_url: storagePath, importada_em: new Date().toISOString(),
    data_medicao: dataMed, periodo_inicio: ini, periodo_fim: fim,
    percentual: valorObra > 0 ? Math.min(999.999, +(t.valorFinal / valorObra * 100).toFixed(3)) : 0,
    valor_medido: t.valorFinal, subtotal: t.subtotal,
    desconto_sinal: t.descSinal, desconto_descricao: ($("med-imp-h-sinal-obs")?.value || "").trim() || null,
    acrescimo: t.acresc, acrescimo_descricao: ($("med-imp-h-acresc-obs")?.value || "").trim() || null,
    retencao_percentual: t.retPct, retencao_valor: t.retV || null,
    iss_percentual: t.issPct, iss_valor: t.issV || null, iss_retido_fonte: t.issRetido,
    observacoes: obs.join("\n") || null
    // valor_final vem do gatilho trg_medicoes_valor_final
  };
  const ins = await sb.from("medicoes").insert(reg).select("id").single();
  if(ins.error){
    if(storagePath) await sb.storage.from("obras-documentos").remove([storagePath]);
    aviso("med-imp-aviso", "Não foi possível gravar a medição: " + ins.error.message, "erro");
    return;
  }
  const medId = ins.data.id;

  // 3) itens: unitário escolhido (lido ou do app) e o que o PDF trazia, para comparar depois
  const itens = st.itens.filter(it => !it.removido).map((it, i) => {
    const usaApp = it.usar === "app" && it.cascata;
    const tagNorm = it.tag ? medImpNormalizarTexto(it.tag).replace(/\s+/g, "") : "";
    const eq = tagNorm ? st.equipamentos.find(e => medImpNormalizarTexto(e.codigo).replace(/\s+/g, "") === tagNorm) : null;
    return {
      medicao_id: medId, ordem: i + 1, descricao: it.descricao,
      variante_id: it.cascata?.variante_id || null, orcamento_item_id: it.cascata?.orcamento_item_id || null,
      quantidade: it.quantidade, unidade: MED_IMP_UNIDADES_VALIDAS.includes(it.unidade) ? it.unidade : "un",
      valor_unitario: medImpUnitarioEscolhido(it),
      preco_origem: usaApp ? it.cascata.fonte : "manual",
      preco_origem_obs: usaApp
        ? `Cascata do app (${(PRECO_ORIGEM_INFO[it.cascata.fonte] || {}).lbl || it.cascata.fonte}); o boletim trazia ${brl(it.valor_unitario_lido)}`
        : `Lido do boletim importado (PDF)${it.cascata ? "; o app calcularia " + brl(it.cascata.valor_unitario) : ""}`,
      equipamento_id: eq ? eq.id : null, equipamento_tag: it.tag,
      quantidade_lida: it.quantidade_lida, valor_unitario_lido: it.valor_unitario_lido, conferido: it.conferido === true
    };
  });
  const insIt = await sb.from("medicao_itens").insert(itens);
  if(insIt.error){
    await sb.from("medicoes").delete().eq("id", medId);
    if(storagePath) await sb.storage.from("obras-documentos").remove([storagePath]);
    aviso("med-imp-aviso", "Não foi possível gravar os itens (a medição foi desfeita): " + insIt.error.message, "erro");
    return;
  }

  arq.status = "feito"; arq.medicaoId = medId;
  st.numerosExistentes.push(numero.toLowerCase());
  medImpRenderFila();
  aviso("med-imp-aviso", `Medição ${numero} gravada aprovada (${brl(t.valorFinal)}).${avisoAnexo ? " " + avisoAnexo : ""}`, avisoAnexo ? "aviso" : "ok");
  if(_medRegistros.length) carregarMedicoes();
  if(typeof carregarMedicoesDaObra === "function" && typeof obraEditId !== "undefined" && obraEditId === st.obraId) carregarMedicoesDaObra(st.obraId);
  st.atual = null; st.cab = null; st.resp = null; st.itens = [];
  medImpProcessarProximo();
}

/* ---- ficha: chip de origem e PDF do boletim importado ---- */
function medAtualizarOrigemFicha(med){
  const chip = $("med-ficha-origem"), txt = $("med-ficha-origem-txt"), btn = $("btn-med-boletim");
  _medBoletimPath = (med && med.arquivo_origem_url) ? med.arquivo_origem_url : null;
  const importada = !!med && med.origem === "importada_pdf";
  if(chip) chip.style.display = importada ? "" : "none";
  if(txt) txt.textContent = importada ? `Boletim importado${med.importada_em ? " em " + dataBR(String(med.importada_em).slice(0, 10)) : ""}` : "—";
  if(btn) btn.style.display = _medBoletimPath ? "" : "none";
}
async function medAbrirBoletimImportado(){
  if(!_medBoletimPath) return;
  const { data, error } = await sb.storage.from("obras-documentos").createSignedUrl(_medBoletimPath, 120);
  if(error){ aviso("app-aviso", "Não foi possível abrir o PDF do boletim: " + error.message, "erro"); return; }
  window.open(data.signedUrl, "_blank");
}

/* ---------- Listeners ---------- */
function ligarMedicoes(){
  document.querySelectorAll("#med-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#med-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _medView = b.dataset.view;
      renderMedicoes();
    });
  });
  ["med-busca","med-f-status","med-f-obra","med-f-origem"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "med-busca" ? "input" : "change", id === "med-busca" ? debounce(renderMedicoes) : renderMedicoes);
  });
  $("med-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirMedicao(tr.dataset.id);
  });

  $("btn-nova-medicao")?.addEventListener("click", novaMedicao);
  $("btn-voltar-med")?.addEventListener("click", mostrarPainelMed);
  $("btn-salvar-med")?.addEventListener("click", () => comBotaoTravado("btn-salvar-med", () => salvarMedicao()));
  $("btn-gerar-pdf-med")?.addEventListener("click", gerarPDFMedicao);
  $("btn-excluir-med")?.addEventListener("click", excluirMedicao);
  $("btn-med-boletim")?.addEventListener("click", medAbrirBoletimImportado); // fase 88

  // fase 88: modal "Importar boletim (PDF)" — aberto pela aba Medições da obra (obra_abas.js)
  $("btn-med-imp-fechar")?.addEventListener("click", fecharImportBoletimPDF);
  $("btn-med-imp-escolher")?.addEventListener("click", () => $("med-imp-arquivo")?.click());
  $("med-imp-arquivo")?.addEventListener("change", (e) => { medImpAdicionarArquivos(e.target.files); e.target.value = ""; });
  const zonaImp = $("med-imp-zona");
  if(zonaImp){
    ["dragenter","dragover"].forEach(ev => zonaImp.addEventListener(ev, (e) => { e.preventDefault(); zonaImp.classList.add("arrastando"); }));
    ["dragleave","drop"].forEach(ev => zonaImp.addEventListener(ev, (e) => { e.preventDefault(); zonaImp.classList.remove("arrastando"); }));
    zonaImp.addEventListener("drop", (e) => medImpAdicionarArquivos(e.dataTransfer?.files));
  }
  $("btn-med-imp-pular")?.addEventListener("click", medImpPular);
  $("btn-med-imp-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-med-imp-confirmar", medImpConfirmar));

  // Aba Itens: sugerir, compor sinal e adicionar manual
  $("btn-med-sugerir")?.addEventListener("click", sugerirItensMedicao);
  $("btn-med-compor-sinal")?.addEventListener("click", comporMedicaoSinal);
  $("btn-med-add-item")?.addEventListener("click", adicionarItemMedicaoManual);

  // Tipo da medição → ajusta UI do Sinal Contratual
  $("med-tipo")?.addEventListener("change", ajustarUISinalContratual);

  // Obra → sugere número automático (só pra nova medição com número vazio)
  $("med-obra")?.addEventListener("change", sugerirNumeroMedicao);

  // Aba Resumo: recalcula valor final quando desc/acresc/multiplicador mudam
  ["med-desc-sinal","med-acrescimo","med-multiplicador","med-valor-final"].forEach(id => {
    $(id)?.addEventListener("input", recalcularTotaisMedicao);
  });
  // Retenção: % recalcula o valor; digitar o valor à mão desliga o automático
  $("med-ret-pct")?.addEventListener("input", () => { if($("med-ret-valor")) $("med-ret-valor").dataset.manual = "0"; recalcularTotaisMedicao(); });
  $("med-ret-valor")?.addEventListener("input", () => { $("med-ret-valor").dataset.manual = "1"; recalcularTotaisMedicao(); });
  // ISS: % recalcula o valor; valor à mão desliga o automático; tudo recalcula o líquido a receber
  $("med-iss-pct")?.addEventListener("input", () => { if($("med-iss-valor")) $("med-iss-valor").dataset.manual = "0"; recalcularTotaisMedicao(); });
  $("med-iss-valor")?.addEventListener("input", () => { $("med-iss-valor").dataset.manual = "1"; recalcularTotaisMedicao(); });
  $("med-iss-retido")?.addEventListener("change", recalcularTotaisMedicao);
  $("med-obra")?.addEventListener("change", () => medPreencherIssDaObra($("med-obra").value, true));

  // Cálculos automáticos de Hora Extra e Faturamento Mínimo
  $("btn-med-calc-he")?.addEventListener("click", calcularHoraExtraMedicao);
  $("btn-med-sugerir-abat")?.addEventListener("click", () => comBotaoTravado("btn-med-sugerir-abat", sugerirAbatimentoSinal));
  $("btn-med-calc-fatmin")?.addEventListener("click", calcularFatMinimoMedicao);

  document.querySelectorAll("#med-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabMed(b.dataset.tab));
  });
  document.querySelectorAll("#med-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!medEditId){
        $("med-status").value = novo;
        atualizarStatusbarMed(novo);
        return;
      }
      if(novo === $("med-status").value) return;
      await salvarMedicao(novo);
    });
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarMedicoes);
} else {
  ligarMedicoes();
}

/* ====================================================================
   Módulo: Medições
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   Fluxo: rascunho → enviada → aprovada → faturada (rejeitada = lateral).
   ==================================================================== */

let _medRegistros = [];
let _medView      = "lista";
let medEditId     = null;

const MED_STAGES = ["rascunho","enviada","aprovada","faturada","recebida"];   // fase 91: recebida nasce no banco (recebimentos)

/* ---------- Carga ---------- */
async function carregarMedicoes(){
  const { data, error } = await sb.from("medicoes")
    .select("id,numero,obra_id,data_medicao,percentual,status,valor_medido,periodo_inicio,periodo_fim,descricao,observacoes,nf_numero,doc_tipo,nf_vencimento,origem,valor_final,retencao_valor,iss_valor,iss_retido_fonte,recebido_valor,recebida_em,permuta_percentual,permuta_valor,obra:obras(codigo,nome,cliente_id)")   // fase 91: líquido, recebido e cliente (indicadores e visão por cliente); fase 98: permuta
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
  const fReceb = $("med-f-receb")?.value || "";   // fase 91: situação do recebimento da NF
  return _medRegistros.filter(m => {
    if(fStatus && m.status !== fStatus) return false;
    if(fReceb && !medRecebSituacaoOk(m, fReceb)) return false;
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
  medAplicarVisao();                                        // fase 91: filtros e "+ Nova" conforme a visão
  if(_medView === "caucao"){ renderMedCaucao(); return; }   // fase 91: visão Caução (retenções por NF)
  if(_medView === "permutas"){ renderMedPermutas(); return; }   // fase 98: visão Permutas (imóvel, crédito, saldo)
  const dados = medFiltradas();
  const cont = $("med-contador");
  if(cont) cont.textContent = `${dados.length} de ${_medRegistros.length}`;
  if(_medView === "kanban") renderMedKanban(dados);
  else                       renderMedLista(dados);
  medRecebRenderIndicadores();                              // fase 91: A receber / Vencidas / Recebido no mês

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
    <td>${esc(medDocTxt(m))}${medRecebMarca(m)}${typeof medPmMarca === "function" ? medPmMarca(m) : ""}</td>
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
  if($("med-pm-ficha")) $("med-pm-ficha").style.display = "none";   // fase 98: ficha da permuta
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
  medRecebCarregarFicha(med);   // fase 91: aba NF/Recebimento
  medCauCarregarFicha(med);     // fase 91: aba Caução
  if(typeof medPmCarregarFicha === "function") medPmCarregarFicha(med);   // fase 98: % e crédito de permuta (aba Geral)
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
  if(typeof medPmRecalcular === "function") medPmRecalcular(valorFinal);   // fase 98: crédito de permuta = % × valor final
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
    // fase 91: retencao_liberada / retencao_data_liberacao são espelho da caução (gatilho no banco); não vão mais daqui
    // ISS (financeiro, 16/09/2026)
    iss_percentual: $("med-iss-pct")?.value ? Number($("med-iss-pct").value) : null,
    iss_valor: $("med-iss-valor")?.value ? Number($("med-iss-valor").value) : null,
    iss_retido_fonte: $("med-iss-retido")?.value !== "false",
    observacoes: $("med-obs").value.trim() || null
    // valor_final é recalculado por trigger no banco
  };
  if(typeof medPmLerCampos === "function") Object.assign(reg, medPmLerCampos());   // fase 98: só financeiro/admin/diretor mandam a permuta
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
  h:"h", hs:"h", hr:"h", hrs:"h", hora:"h", horas:"h"   // lote S45 (L8): "h" entrou no enum unidade_medida (20261020_loteS45_unidade_h); antes virava "un"
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
  if(map) return { valor: map, aviso: null };
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
    ${resp.aviso ? `<div class="ia-duvidas">⚠️ ${esc(resp.aviso)}: itens e totais foram lidos, as estacas executadas deste boletim não. Confira os itens.</div>` : ""}
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
  const duvidas = [...(st.resp?.aviso ? [st.resp.aviso] : []), ...(st.resp?.duvidas || [])];   // lote S46 (#105): aviso da v1.3 vai para as observações
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

  // 4) lote S45 (L8): o mesmo PDF também entra na aba Documentos da obra (categoria boletim_medicao, origem
  //    medicao_importada; policy obras_doc_boletim_medicao). A medição já está gravada: falha aqui só avisa.
  if(storagePath){
    const doc = await sb.from("obras_documentos").insert({
      obra_id: st.obraId, categoria: "boletim_medicao", nome: arq.nome, descricao: `Boletim da medição ${numero} importado`,
      storage_path: storagePath, mime_type: "application/pdf", tamanho_bytes: arq.file.size || null,
      enviado_por: usuarioAtual?.id || null, origem: "medicao_importada"
    });
    if(doc.error) avisoAnexo = (avisoAnexo ? avisoAnexo + " " : "") + `O PDF ficou na medição, mas não entrou na aba Documentos da obra (${doc.error.message}).`;
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
  ["med-busca","med-f-status","med-f-obra","med-f-origem","med-f-receb"].forEach(id => {
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
      if(novo === "recebida"){ medRecebIrParaAba(); return; }   // fase 91: "recebida" nasce dos recebimentos confirmados
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

/* ====================================================================
   FASE 91 — Caução contratual e recebimentos (20/10/2026)
   Spec: docs/specs/fase-91-caucao.md. Tudo desta fase fica neste bloco (prefixo med-cau- / med-receb-).
   - Visão "Caução" no toggle do painel: uma linha por NF com retenção (tabela caucoes, lida pela
     vw_caucoes), com indicadores, filtros, agrupamento por cliente e exportação para planilha.
     Inclui o histórico da planilha CAIXA CAUÇÃO (origem planilha): essas linhas abrem numa ficha
     reduzida (modal), porque não têm medição no app. Caução de medição abre na aba da medição.
   - Aba "Caução" da ficha da medição: statusbar própria (aberta → parcial → devolvida; baixada),
     chips e o registro da devolução. O status nasce no gatilho (fn_caucoes_antes); a medição
     espelha retencao_liberada / retencao_data_liberacao por gatilho.
   - Aba "NF/Recebimento": lançamentos de medicao_recebimentos; a medição vira "recebida" no banco
     quando a soma atinge o líquido (valor final − retenção − ISS retido; fase 47).
   - Indicadores do painel: A receber, Vencidas, Recebido no mês (lista e kanban).
   - Presets chamados pela Sala de Comando (dashboard.js): medCauAbrirPreset / medRecebAbrirPreset.
   Quem grava: diretor, admin e financeiro (policies has_role('admin','financeiro')); auditor só lê.
   ==================================================================== */
const MED_CAU_STAGES = ["aberta", "parcial", "devolvida"];
const MED_CAU_STATUS = {
  aberta:    { label: "Aberta",    cor: "ambar" },
  parcial:   { label: "Parcial",   cor: "azul"  },
  devolvida: { label: "Devolvida", cor: "verde" },
  baixada:   { label: "Baixada",   cor: "cinza" }
};
const MED_RECEB_FORMAS = { transferencia: "Transferência", boleto: "Boleto", pix: "Pix", outro: "Outro" };
let _medCauRegistros = null;   // vw_caucoes (carregada na primeira visão Caução; null = recarregar)
let _medCauAgrupar   = "nf";   // "nf" | "cliente"
let _medCauPreset    = null;   // filtro de status pedido pela Sala de Comando antes da carga
let _medCauFicha     = null;   // caução da medição aberta
let _medRecebLista   = [];     // recebimentos da medição aberta
let _medRecebMes     = null;   // { ini, total, n } recebido no mês corrente (indicador)

function medCauPodeOperar(){ return !!usuarioAtual && ["diretor", "admin", "financeiro"].includes(usuarioAtual.cargo) && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()); }
function medTagCau(st){ const o = MED_CAU_STATUS[st] || { label: st || "—", cor: "cinza" }; return `<span class="tag ${o.cor}">${esc(o.label)}</span>`; }
/* Líquido a receber da medição (fase 47): valor final − retenção contratual − ISS retido na fonte. Igual a medicao_liquido() no banco. */
function medLiquido(m){
  const vf = Number(m.valor_final) || Number(m.valor_medido) || 0;
  const iss = (m.iss_retido_fonte === false) ? 0 : (Number(m.iss_valor) || 0);
  return Math.round((vf - (Number(m.retencao_valor) || 0) - iss) * 100) / 100;
}
function medRecebSaldo(m){ return Math.max(0, Math.round((medLiquido(m) - (Number(m.recebido_valor) || 0)) * 100) / 100); }
/* Situação do recebimento: sem_nf | a_receber | parcial | vencida | recebida */
function medRecebSituacao(m){
  if(m.status === "recebida") return "recebida";
  if(!m.nf_numero || ["rascunho", "enviada", "rejeitada"].includes(m.status)) return "sem_nf";
  if(m.nf_vencimento && m.nf_vencimento < hojeISO()) return "vencida";
  return (Number(m.recebido_valor) || 0) > 0 ? "parcial" : "a_receber";
}
function medRecebSituacaoOk(m, f){
  const s = medRecebSituacao(m);
  if(f === "a_receber") return ["a_receber", "parcial", "vencida"].includes(s);
  return s === f;
}
function medRecebMarca(m){
  const s = medRecebSituacao(m);
  if(s === "recebida") return ` <span class="meta" title="Recebimento completo confirmado pelo financeiro">· recebida${m.recebida_em ? " " + dataBR(m.recebida_em) : ""}</span>`;
  if(s === "vencida")  return ` <span class="meta txt-perigo" title="NF vencida sem recebimento completo">· vencida</span>`;
  if(s === "parcial")  return ` <span class="meta" title="Recebida em parte">· parcial</span>`;
  return "";
}

/* ---------- visão: filtros e botão "+ Nova" conforme a visão ---------- */
function medAplicarVisao(){
  const cau = _medView === "caucao";
  document.querySelectorAll("#med-painel .serv-filtros").forEach(f => { if(f.id !== "med-cau-filtros") f.style.display = cau ? "none" : ""; });
  if($("med-cau-filtros")) $("med-cau-filtros").style.display = cau ? "" : "none";
  if($("btn-nova-medicao")) $("btn-nova-medicao").style.display = cau ? "none" : "";
  const h3 = document.querySelector("#med-painel .lista-topo h3");
  if(h3 && h3.firstChild && h3.firstChild.nodeType === 3) h3.firstChild.textContent = cau ? "Caução contratual por NF " : "Medições cadastradas ";
  // fase 98: visão Permutas esconde os filtros das medições e da caução e mostra os seus
  const pm = _medView === "permutas";
  const btnPm = document.querySelector('#med-painel .serv-view-btn[data-view="permutas"]');
  if(btnPm) btnPm.style.display = (typeof podeVerPermutas === "function" && podeVerPermutas()) ? "" : "none";
  if(pm) document.querySelectorAll("#med-painel .serv-filtros").forEach(f => { if(f.id !== "med-pm-filtros") f.style.display = "none"; });
  if($("med-pm-filtros")) $("med-pm-filtros").style.display = pm ? "" : "none";
  if(pm && $("btn-nova-medicao")) $("btn-nova-medicao").style.display = "none";
  if(pm && h3 && h3.firstChild && h3.firstChild.nodeType === 3) h3.firstChild.textContent = "Permutas: obras pagas em imóvel ";
}
function medAtivarView(view){
  document.querySelectorAll("#med-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === view));
  _medView = view;
  renderMedicoes();
}
/* Sala de Comando → visão Caução já filtrada ("vencidas" | "vence30" | "em_aberto") */
function medCauAbrirPreset(preset){
  mostrarPainelMed();
  _medCauPreset = preset || "";
  if($("med-cau-f-status")) $("med-cau-f-status").value = _medCauPreset;
  medAtivarView("caucao");
}
/* Sala de Comando → lista filtrada pela situação do recebimento ("vencida" | "a_receber") */
function medRecebAbrirPreset(sit){
  mostrarPainelMed();
  if($("med-f-receb")) $("med-f-receb").value = sit || "";
  medAtivarView("lista");
}
function medRecebIrParaAba(){
  if(!medEditId){ aviso("app-aviso", "Salve a medição primeiro; a medição fica recebida quando o financeiro confirma os recebimentos.", "erro"); return; }
  ativarTabMed("recebimento");
  aviso("app-aviso", "\"Recebida\" nasce dos recebimentos confirmados: lance-os nesta aba e a medição muda sozinha quando a soma atingir o líquido.", "aviso");
}

/* ---------- indicadores: A receber / Vencidas / Recebido no mês (lista e kanban) ---------- */
async function medRecebRenderIndicadores(){
  const cont = $("med-indicadores");
  if(!cont) return;
  // fase 99b (decisão 4): somatórios financeiros só para quem vê KPI (diretor, admin, financeiro, auditor); o engenheiro
  // e o comercial seguem vendo o valor de cada medição na lista e na ficha
  if(typeof podeVerKpiFinanceiro === "function" && !podeVerKpiFinanceiro(() => true)){ cont.style.display = "none"; cont.innerHTML = ""; return; }
  const base = _medRegistros;
  const aRec = base.filter(m => ["a_receber", "parcial", "vencida"].includes(medRecebSituacao(m)));
  const venc = base.filter(m => medRecebSituacao(m) === "vencida");
  const iniMes = hojeISO().slice(0, 7) + "-01";
  if(!_medRecebMes || _medRecebMes.ini !== iniMes){
    const { data } = await sb.from("medicao_recebimentos").select("valor").gte("data", iniMes);
    if(_medView === "caucao" || _medView === "permutas") return;   // trocou de visão enquanto carregava
    _medRecebMes = { ini: iniMes, total: (data || []).reduce((s, r) => s + (Number(r.valor) || 0), 0), n: (data || []).length };
  }
  const soma = (lst) => lst.reduce((s, m) => s + medRecebSaldo(m), 0);
  const fAtivo = $("med-f-receb")?.value || "";
  cont.style.display = "";
  cont.innerHTML = `
    <div class="ind ind-click${fAtivo === "a_receber" ? " ativo" : ""}" data-receb="a_receber" title="Medições com NF emitida e ainda não recebidas, pelo líquido a receber (valor final − retenção − ISS retido) menos o já recebido. Clique para filtrar."><div class="num">${brl(soma(aRec))}</div><div class="rot">A receber · ${aRec.length} NF(s)</div></div>
    <div class="ind ind-click${fAtivo === "vencida" ? " ativo" : ""}" data-receb="vencida" title="Vencimento da NF já passou e o recebimento não está completo. Clique para filtrar."><div class="num" style="color:var(--perigo);">${brl(soma(venc))}</div><div class="rot">Vencidas · ${venc.length} NF(s)</div></div>
    <div class="ind" title="Recebimentos confirmados pelo financeiro no mês corrente (aba NF/Recebimento das medições)"><div class="num" style="color:var(--sucesso);">${brl(_medRecebMes.total)}</div><div class="rot">Recebido no mês · ${_medRecebMes.n} lançamento(s)</div></div>`;
}

/* ---------- visão Caução ---------- */
async function medCauCarregar(forcar){
  if(_medCauRegistros && !forcar) return _medCauRegistros;
  const { data, error } = await sb.from("vw_caucoes").select("*").order("nf_data", { ascending: false, nullsFirst: false }).limit(5000);
  if(error){ aviso("app-aviso", "Não foi possível ler as cauções: " + error.message, "erro"); _medCauRegistros = []; return _medCauRegistros; }
  _medCauRegistros = data || [];
  return _medCauRegistros;
}
const medCauClienteChave = (c) => c.cliente_id || ("nome:" + (c.cliente || "").trim().toUpperCase());
function medCauPreencherFiltros(){
  const regs = _medCauRegistros || [];
  const fill = (id, itens, placeholder) => {
    const sel = $(id); if(!sel) return;
    const atual = sel.value;
    sel.innerHTML = `<option value="">${esc(placeholder)}</option>` + itens.map(i => `<option value="${esc(i.v)}">${esc(i.t)}</option>`).join("");
    sel.value = atual;
    if(sel.value !== atual) sel.value = "";
  };
  const anos = [...new Set(regs.map(c => c.ano).filter(Boolean))].sort((a, b) => b - a);
  fill("med-cau-f-ano", anos.map(a => ({ v: String(a), t: String(a) })), "Todos os anos");
  const clientes = new Map();
  regs.forEach(c => { const k = medCauClienteChave(c); if(!clientes.has(k)) clientes.set(k, c.cliente || "(sem nome)"); });
  fill("med-cau-f-cliente", [...clientes.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([v, t]) => ({ v, t })), "Todos os clientes");
  const obras = new Map();
  regs.forEach(c => { if(c.obra_id && !obras.has(c.obra_id)) obras.set(c.obra_id, `${c.obra_codigo || ""} — ${c.obra_nome || ""}`.trim()); });
  fill("med-cau-f-obra", [...obras.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR", { numeric: true })).map(([v, t]) => ({ v, t })), "Todas as obras");
  const bancos = [...new Set(regs.map(c => c.banco).filter(Boolean))].sort();
  fill("med-cau-f-banco", bancos.map(b => ({ v: b, t: b })), "Todos os bancos");
  if(_medCauPreset != null){ const st = $("med-cau-f-status"); if(st) st.value = _medCauPreset; _medCauPreset = null; }
  if($("med-cau-agrupar")) $("med-cau-agrupar").value = _medCauAgrupar;
}
function medCauAberta(c){ return ["aberta", "parcial"].includes(c.status); }
function medCauFiltradas(){
  const termo = ($("med-cau-busca")?.value || "").trim().toLowerCase();
  const ano = $("med-cau-f-ano")?.value || "";
  const st = $("med-cau-f-status")?.value || "";
  const cli = $("med-cau-f-cliente")?.value || "";
  const obra = $("med-cau-f-obra")?.value || "";
  const banco = $("med-cau-f-banco")?.value || "";
  const hoje = hojeISO(), lim30 = addDiasISO(30);
  return (_medCauRegistros || []).filter(c => {
    if(ano && String(c.ano) !== ano) return false;
    if(st === "em_aberto"){ if(!medCauAberta(c)) return false; }
    else if(st === "vencidas"){ if(!c.vencida) return false; }
    else if(st === "vence30"){ if(!(medCauAberta(c) && c.data_prevista && c.data_prevista >= hoje && c.data_prevista <= lim30)) return false; }
    else if(st && c.status !== st) return false;
    if(cli && medCauClienteChave(c) !== cli) return false;
    if(obra && c.obra_id !== obra) return false;
    if(banco && (c.banco || "") !== banco) return false;
    if(termo){
      const alvo = `${c.nf_numero || ""} ${c.cliente || ""} ${c.obra_codigo || ""} ${c.obra_nome || ""} ${c.medicao_numero || ""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}
async function renderMedCaucao(){
  const cont = $("med-conteudo");
  if(!cont) return;
  if(!_medCauRegistros){
    cont.innerHTML = `<p class="vazio">Carregando cauções…</p>`;
    await medCauCarregar();
    if(_medView !== "caucao") return;
  }
  medCauPreencherFiltros();
  const dados = medCauFiltradas();
  const contador = $("med-contador");
  if(contador) contador.textContent = `${dados.length} de ${_medCauRegistros.length} NFs`;
  medCauRenderIndicadores();
  if(_medCauAgrupar === "cliente") renderMedCauPorCliente(dados);
  else renderMedCauLista(dados);
}
function medCauRenderIndicadores(){
  const cont = $("med-indicadores");
  if(!cont) return;
  // fase 99b (decisão 4): totais da caução só para quem vê KPI financeiro
  if(typeof podeVerKpiFinanceiro === "function" && !podeVerKpiFinanceiro(() => true)){ cont.style.display = "none"; cont.innerHTML = ""; return; }
  const regs = _medCauRegistros || [];
  const anoSel = $("med-cau-f-ano")?.value || String(new Date().getFullYear());
  const retidoAno = regs.filter(c => String(c.ano) === anoSel).reduce((s, c) => s + (Number(c.valor_retido) || 0), 0);
  const devAno = regs.filter(c => c.data_devolucao && c.data_devolucao.slice(0, 4) === anoSel).reduce((s, c) => s + (Number(c.credito) || 0), 0);
  const abertas = regs.filter(medCauAberta), vencidas = regs.filter(c => c.vencida);
  const saldo = (lst) => lst.reduce((s, c) => s + Math.max(0, Number(c.saldo) || 0), 0);
  const stAtivo = $("med-cau-f-status")?.value || "";
  cont.style.display = "";
  cont.innerHTML = `
    <div class="ind" title="Retenção lançada nas NFs do ano ${esc(anoSel)} (DÉBITO da planilha + medições com retenção)"><div class="num">${brl(retidoAno)}</div><div class="rot">Retido em ${esc(anoSel)} · ${regs.filter(c => String(c.ano) === anoSel).length} NF(s)</div></div>
    <div class="ind" title="Devolvido pelos clientes em ${esc(anoSel)} (crédito = devolvido + juros − descontos, pela data da devolução)"><div class="num" style="color:var(--sucesso);">${brl(devAno)}</div><div class="rot">Devolvido em ${esc(anoSel)}</div></div>
    <div class="ind ind-click${stAtivo === "em_aberto" ? " ativo" : ""}" data-cau-st="em_aberto" title="Saldo a receber das cauções abertas e parciais, todos os anos. Clique para filtrar."><div class="num" style="color:var(--aviso);">${brl(saldo(abertas))}</div><div class="rot">Em aberto · ${abertas.length} NF(s) · ${new Set(abertas.map(medCauClienteChave)).size} cliente(s)</div></div>
    <div class="ind ind-click${stAtivo === "vencidas" ? " ativo" : ""}" data-cau-st="vencidas" title="Previsão de devolução (NF + prazo da obra ou da empresa) já passou. Clique para filtrar."><div class="num" style="color:var(--perigo);">${brl(saldo(vencidas))}</div><div class="rot">Vencidas · ${vencidas.length} NF(s)</div></div>`;
}
function renderMedCauLista(dados){
  const cont = $("med-conteudo");
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhuma caução com esses filtros.</p>`; return; }
  const linhas = dados.map(c => `<tr class="linha-clicavel" data-cau="${esc(c.id)}" title="${c.medicao_id ? "Abrir a medição na aba Caução" : "Histórico da planilha (sem medição no app): abrir a ficha da caução"}">
    <td><strong>${esc(c.nf_numero)}</strong>${c.origem === "planilha" ? ' <span class="meta" title="Importada da planilha CAIXA CAUÇÃO">planilha</span>' : ""}</td>
    <td>${c.nf_data ? dataBR(c.nf_data) : "—"}</td>
    <td title="${esc(c.cliente || "")}">${esc(c.cliente || "—")}${c.cliente_id ? "" : ' <span class="meta" title="Cliente sem cadastro no app (nome como veio da planilha)">?</span>'}</td>
    <td>${c.obra_id ? linkObra(c.obra_id, c.obra_codigo || "obra") : "—"}</td>
    <td>${esc(c.medicao_numero || "—")}</td>
    <td class="num">${brl(c.valor_retido)}</td>
    <td class="num" title="devolvido ${brl(c.valor_devolvido)}${Number(c.juros) ? " + juros " + brl(c.juros) : ""}${Number(c.descontos) ? " − descontos " + brl(c.descontos) : ""}">${brl(c.credito)}</td>
    <td class="num"><strong>${brl(c.saldo)}</strong></td>
    <td>${c.data_prevista ? dataBR(c.data_prevista) : "—"}</td>
    <td class="num">${c.dias_atraso > 0 ? `<span class="txt-perigo" title="dias além da previsão">${c.dias_atraso}</span>` : (medCauAberta(c) && c.dias_em_aberto != null ? `<span class="meta" title="dias desde a NF">${c.dias_em_aberto}</span>` : "—")}</td>
    <td>${medTagCau(c.status)}${c.banco ? ` <span class="meta">${esc(c.banco)}</span>` : ""}</td>
  </tr>`).join("");
  const tot = (f) => dados.reduce((s, c) => s + (Number(f(c)) || 0), 0);
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>NF</th><th>Data</th><th>Cliente</th><th>Obra</th><th>Medição</th>
      <th class="num">Retido</th><th class="num" title="devolvido + juros − descontos">Devolvido</th><th class="num">Saldo</th>
      <th title="NF + prazo da obra (ou 90 dias da empresa)">Previsão</th><th class="num" title="dias de atraso (ou em aberto)">Atraso</th><th>Status</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot><tr><th colspan="5">${dados.length} NF(s)</th><th class="num">${brl(tot(c => c.valor_retido))}</th><th class="num">${brl(tot(c => c.credito))}</th><th class="num">${brl(tot(c => c.saldo))}</th><th colspan="3"></th></tr></tfoot>
  </table></div>`;
}
/* Saldo por cliente (como a tabela de maiores saldos da spec), com o a receber das NFs ao lado */
function renderMedCauPorCliente(dados){
  const cont = $("med-conteudo");
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhuma caução com esses filtros.</p>`; return; }
  const grupos = new Map();
  dados.forEach(c => {
    const k = medCauClienteChave(c);
    const g = grupos.get(k) || { k, cliente: c.cliente || "(sem nome)", cliente_id: c.cliente_id, nfs: 0, retido: 0, credito: 0, saldo: 0, abertas: 0, vencidas: 0, aRec: 0, venc: 0 };
    g.nfs++; g.retido += Number(c.valor_retido) || 0; g.credito += Number(c.credito) || 0;
    if(medCauAberta(c)){ g.abertas++; g.saldo += Math.max(0, Number(c.saldo) || 0); }
    if(c.vencida) g.vencidas++;
    grupos.set(k, g);
  });
  // a receber e vencido das NFs (medições com NF não recebidas), pelo cliente da obra
  _medRegistros.forEach(m => {
    const cid = m.obra && m.obra.cliente_id; if(!cid) return;
    const s = medRecebSituacao(m); if(!["a_receber", "parcial", "vencida"].includes(s)) return;
    const g = grupos.get(cid); if(!g) return;
    const sal = medRecebSaldo(m); g.aRec += sal; if(s === "vencida") g.venc += sal;
  });
  const lista = [...grupos.values()].sort((a, b) => b.saldo - a.saldo || b.retido - a.retido);
  const linhas = lista.map(g => `<tr class="linha-clicavel" data-cau-cli="${esc(g.k)}" title="Ver as NFs deste cliente">
    <td title="${esc(g.cliente)}">${esc(g.cliente)}${g.cliente_id ? "" : ' <span class="meta" title="Cliente sem cadastro no app">?</span>'}</td>
    <td class="num">${g.nfs}</td>
    <td class="num">${brl(g.retido)}</td>
    <td class="num">${brl(g.credito)}</td>
    <td class="num"><strong>${brl(g.saldo)}</strong>${g.abertas ? ` <span class="meta">${g.abertas} NF(s)</span>` : ""}</td>
    <td class="num">${g.vencidas ? `<span class="txt-perigo">${g.vencidas}</span>` : "—"}</td>
    <td class="num">${g.aRec ? brl(g.aRec) : "—"}</td>
    <td class="num">${g.venc ? `<span class="txt-perigo">${brl(g.venc)}</span>` : "—"}</td>
  </tr>`).join("");
  const tot = (f) => lista.reduce((s, g) => s + f(g), 0);
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Cliente</th><th class="num">NFs</th><th class="num">Retido</th><th class="num">Devolvido</th><th class="num" title="saldo das cauções abertas e parciais">Saldo caução</th><th class="num" title="cauções com previsão vencida">Vencidas</th>
      <th class="num" title="NFs das medições deste cliente ainda não recebidas (líquido − recebido)">A receber (NF)</th><th class="num" title="NFs vencidas sem recebimento completo">Vencido (NF)</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot><tr><th>${lista.length} cliente(s)</th><th class="num">${tot(g => g.nfs)}</th><th class="num">${brl(tot(g => g.retido))}</th><th class="num">${brl(tot(g => g.credito))}</th><th class="num">${brl(tot(g => g.saldo))}</th><th class="num">${tot(g => g.vencidas) || "—"}</th><th class="num">${brl(tot(g => g.aRec))}</th><th class="num">${brl(tot(g => g.venc))}</th></tr></tfoot>
  </table></div>`;
}
function medCauExportar(){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
  const dados = medCauFiltradas();
  if(!dados.length){ aviso("app-aviso", "Nada para exportar com esses filtros.", "erro"); return; }
  const aoa = [["Ano", "NF", "Data NF", "Cliente", "Obra", "Medição", "Retido", "Devolvido", "Juros", "Descontos", "Crédito", "Saldo", "Data devolução", "Banco", "Previsão", "Dias de atraso", "Status", "Origem", "Motivo da baixa", "Observações"]]
    .concat(dados.map(c => [c.ano, c.nf_numero, c.nf_data ? dataBR(c.nf_data) : "", c.cliente || "", c.obra_codigo || "", c.medicao_numero || "",
      Number(c.valor_retido) || 0, Number(c.valor_devolvido) || 0, Number(c.juros) || 0, Number(c.descontos) || 0, Number(c.credito) || 0, Number(c.saldo) || 0,
      c.data_devolucao ? dataBR(c.data_devolucao) : "", c.banco || "", c.data_prevista ? dataBR(c.data_prevista) : "", c.dias_atraso || 0,
      (MED_CAU_STATUS[c.status] || {}).label || c.status, c.origem, c.motivo_baixa || "", c.observacoes || ""]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CAUÇÃO");
  XLSX.writeFile(wb, `caucao-${hojeISO()}.xlsx`);
}
/* Abre uma caução: de medição → ficha da medição na aba Caução; da planilha → modal com a ficha reduzida */
async function medCauAbrir(id){
  const c = (_medCauRegistros || []).find(x => x.id === id);
  if(!c) return;
  if(c.medicao_id){ await abrirMedicao(c.medicao_id); ativarTabMed("caucao"); return; }
  medCauAbrirModal(c);
}

/* ---------- ficha da caução (aba da medição e modal) ---------- */
function medCauFormHTML(c, pref){
  const podeOp = medCauPodeOperar();
  const idxAtual = MED_CAU_STAGES.indexOf(c.status);
  const stages = MED_CAU_STAGES.map((s, i) => {
    let cls = "";
    if(c.status === "baixada"){ if(s === "devolvida") cls = "cancelada"; }
    else if(i === idxAtual) cls = "atual";
    else if(i < idxAtual) cls = "passada";
    return `<div class="stage ${cls}" title="Status calculado no banco a partir dos valores">${s === "devolvida" && c.status === "baixada" ? "Baixada" : MED_CAU_STATUS[s].label}</div>`;
  }).join("");
  const chip = (lbl, val, title) => `<div class="chip"${title ? ` title="${esc(title)}"` : ""}><span>${lbl}</span><strong>${val}</strong></div>`;
  return `
    <div class="odoo-statusbar" style="border:1px solid var(--border-color);border-radius:var(--radius-md);overflow:hidden;">${stages}</div>
    <div class="odoo-contexto" style="padding:12px 0;">
      ${chip("NF", `${esc(c.nf_numero)}${c.nf_data ? " · " + dataBR(c.nf_data) : ""}`)}
      ${chip("Cliente", esc(c.cliente || "—") + (c.cliente_id ? "" : ' <span class="meta">(sem cadastro)</span>'))}
      ${chip("Obra", c.obra_id ? linkObra(c.obra_id, c.obra_codigo || "obra") : "—")}
      ${c.medicao_numero ? chip("Medição", esc(c.medicao_numero)) : chip("Origem", "planilha CAIXA CAUÇÃO", "Histórico importado; sem medição no app")}
      ${chip("Retido", brl(c.valor_retido))}
      ${chip("Devolvido", brl(c.credito), `devolvido ${brl(c.valor_devolvido)} + juros ${brl(c.juros)} − descontos ${brl(c.descontos)}`)}
      ${chip("Saldo", `<span class="${Number(c.saldo) > 0.009 ? "txt-perigo" : ""}">${brl(c.saldo)}</span>`)}
      ${chip("Previsão", c.data_prevista ? dataBR(c.data_prevista) + (c.dias_atraso > 0 ? ` <span class="txt-perigo">(${c.dias_atraso} d de atraso)</span>` : "") : "—", "NF + prazo da obra (ou 90 dias da empresa)")}
      ${chip("Status", medTagCau(c.status))}
    </div>
    <h4 class="titulo-bloco">Devolução</h4>
    <div class="grade">
      <div class="campo"><label>Valor devolvido (acumulado, R$)</label><input id="${pref}-devolvido" type="number" step="0.01" min="0" value="${Number(c.valor_devolvido) || 0}" ${podeOp ? "" : "readonly"} title="Soma do que o cliente já devolveu desta NF (devolução parcial: atualize o acumulado)" /></div>
      <div class="campo"><label>Juros recebidos (R$)</label><input id="${pref}-juros" type="number" step="0.01" min="0" value="${Number(c.juros) || 0}" ${podeOp ? "" : "readonly"} /></div>
      <div class="campo"><label>Descontos do cliente (R$)</label><input id="${pref}-descontos" type="number" step="0.01" min="0" value="${Number(c.descontos) || 0}" ${podeOp ? "" : "readonly"} title="Alimentação, glosa parcial etc.: reduz o que volta" /></div>
      <div class="campo"><label>Data da devolução</label><input id="${pref}-data" type="date" value="${esc(c.data_devolucao || "")}" ${podeOp ? "" : "readonly"} /></div>
      <div class="campo"><label>Banco</label><input id="${pref}-banco" list="med-cau-bancos" value="${esc(c.banco || "")}" placeholder="Itaú, Caixa…" ${podeOp ? "" : "readonly"} /></div>
      <div class="campo"><label>Previsão de devolução</label><input id="${pref}-prevista" type="date" value="${esc(c.data_prevista || "")}" ${podeOp ? "" : "readonly"} title="Calculada pela NF + prazo; pode ser ajustada quando o cliente negociar outra data" /></div>
      <div class="campo largo"><label>Observações</label><textarea id="${pref}-obs" rows="2" ${podeOp ? "" : "readonly"}>${esc(c.observacoes || "")}</textarea></div>
    </div>
    ${c.motivo_baixa ? `<p class="nota">Baixada: ${esc(c.motivo_baixa)}</p>` : ""}
    ${podeOp ? `<div class="form-acoes compacta" style="justify-content:flex-start;">
      <button type="button" class="btn" id="${pref}-salvar">💾 Registrar devolução</button>
      ${c.status === "baixada"
        ? `<button type="button" class="btn-sec" id="${pref}-reabrir" title="Volta a cobrar: limpa o motivo da baixa">↩ Reabrir</button>`
        : `<button type="button" class="btn-sec acao-perigo" id="${pref}-baixar" title="Encerra sem devolução: não é caução, glosa, não precisa cobrar">⛔ Baixar</button>`}
    </div>` : `<p class="nota">Só o financeiro, o admin e a diretoria registram devolução e baixa.</p>`}
    <div id="${pref}-chatter" class="historico"></div>`;
}
async function medCauSalvar(c, pref, extra){
  const n = (id) => { const v = $(id)?.value; return v === "" || v == null ? 0 : Number(v); };
  const reg = {
    valor_devolvido: n(pref + "-devolvido"), juros: n(pref + "-juros"), descontos: n(pref + "-descontos"),
    data_devolucao: $(pref + "-data")?.value || null, banco: ($(pref + "-banco")?.value || "").trim() || null,
    data_prevista: $(pref + "-prevista")?.value || null, observacoes: ($(pref + "-obs")?.value || "").trim() || null,
    ...(extra || {})
  };
  if(reg.valor_devolvido > 0 && !reg.data_devolucao){ aviso("app-aviso", "Informe a data da devolução.", "erro"); return false; }
  if(reg.valor_devolvido > Number(c.valor_retido) + 0.005 && !confirm(`Devolvido ${brl(reg.valor_devolvido)} acima do retido ${brl(c.valor_retido)}. A diferença não é juros? Gravar assim mesmo?`)) return false;
  const { error } = await sb.from("caucoes").update(reg).eq("id", c.id);
  if(error){ aviso("app-aviso", "Não foi possível gravar a caução: " + error.message, "erro"); return false; }
  aviso("app-aviso", extra && extra.motivo_baixa ? "Caução baixada." : (extra && "motivo_baixa" in extra ? "Caução reaberta." : "Devolução registrada. O status e a medição foram atualizados no banco."), "ok");
  _medCauRegistros = null;   // a visão Caução relê na próxima vez
  return true;
}
function medCauLigarForm(c, pref, depois){
  $(pref + "-salvar")?.addEventListener("click", () => comBotaoTravado(pref + "-salvar", async () => { if(await medCauSalvar(c, pref)) await depois(); }));
  $(pref + "-baixar")?.addEventListener("click", () => comBotaoTravado(pref + "-baixar", async () => {
    const motivo = prompt("Motivo da baixa (ex.: não é caução, glosa, não precisa cobrar):", c.motivo_baixa || "");
    if(motivo == null || !motivo.trim()) return;
    if(await medCauSalvar(c, pref, { motivo_baixa: motivo.trim() })) await depois();
  }));
  $(pref + "-reabrir")?.addEventListener("click", () => comBotaoTravado(pref + "-reabrir", async () => { if(await medCauSalvar(c, pref, { motivo_baixa: null })) await depois(); }));
}
/* Aba Caução da ficha da medição */
async function medCauCarregarFicha(med){
  const cont = $("med-cau-conteudo"), badge = $("med-cau-badge");
  if(!cont) return;
  _medCauFicha = null;
  if(badge) badge.textContent = "";
  if(typeof ocultarHistorico === "function") ocultarHistorico("med-cau-chatter");
  if(!med || !med.id){ cont.innerHTML = `<p class="vazio">Salve a medição com o <strong>Nº do documento</strong> e a <strong>retenção contratual</strong> (aba Geral): a caução nasce sozinha e aparece aqui.</p>`; return; }
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  const { data, error } = await sb.from("vw_caucoes").select("*").eq("medicao_id", med.id).maybeSingle();
  if(medEditId !== med.id) return;
  if(error){ cont.innerHTML = `<p class="vazio">Não foi possível ler a caução (${esc(error.message)}).</p>`; return; }
  if(!data){ cont.innerHTML = `<p class="vazio">Sem retenção nesta medição. Informe o <strong>Nº do documento</strong> e a <strong>retenção contratual</strong> na aba Geral e salve: a caução nasce sozinha (status no banco).</p>`; return; }
  _medCauFicha = data;
  if(badge) badge.textContent = (MED_CAU_STATUS[data.status] || {}).label || "";
  cont.innerHTML = medCauFormHTML(data, "med-cau");
  medCauLigarForm(data, "med-cau", async () => { await carregarMedicoes(); await abrirMedicao(med.id); ativarTabMed("caucao"); });
  if(typeof montarHistorico === "function") montarHistorico("caucoes", data.id, "med-cau-chatter");
}
/* Ficha reduzida (modal) para o histórico da planilha, sem medição no app */
function medCauAbrirModal(c){
  const modal = $("med-cau-modal"), cont = $("med-cau-modal-conteudo");
  if(!modal || !cont) return;
  if(typeof ocultarHistorico === "function") ocultarHistorico("med-cau-chatter");
  if($("med-cau-modal-titulo")) $("med-cau-modal-titulo").textContent = `🔒 Caução NF ${c.nf_numero}${c.nf_data ? " · " + dataBR(c.nf_data) : ""}${c.cliente ? " · " + c.cliente : ""}`;
  cont.innerHTML = medCauFormHTML(c, "med-caum");
  medCauLigarForm(c, "med-caum", async () => {
    await medCauCarregar(true);
    const n = _medCauRegistros.find(x => x.id === c.id);
    if(n) medCauAbrirModal(n); else medCauFecharModal();
    renderMedicoes();
  });
  modal.style.display = "flex";
  if(typeof montarHistorico === "function") montarHistorico("caucoes", c.id, "med-caum-chatter");
}
function medCauFecharModal(){
  const m = $("med-cau-modal");
  if(m) m.style.display = "none";
  if(typeof ocultarHistorico === "function") ocultarHistorico("med-caum-chatter");
}
/* Medição nova: sugere o % de retenção negociado na obra (obras_financeiro.caucao_percentual) quando o campo está vazio */
async function medCauSugerirPctDaObra(obraId){
  const el = $("med-ret-pct");
  if(!el || !obraId || medEditId || el.value !== "") return;
  const { data } = await sb.from("obras_financeiro").select("caucao_percentual").eq("obra_id", obraId).maybeSingle();
  if(data && data.caucao_percentual != null && el.value === ""){
    el.value = data.caucao_percentual;
    if($("med-ret-valor")) $("med-ret-valor").dataset.manual = "0";
    recalcularTotaisMedicao();
  }
}

/* ---------- aba NF/Recebimento ---------- */
async function medRecebCarregarFicha(med){
  const cont = $("med-receb-conteudo"), badge = $("med-receb-badge");
  if(!cont) return;
  _medRecebLista = [];
  if(badge) badge.textContent = "";
  if(!med || !med.id){ cont.innerHTML = `<p class="vazio">Salve a medição para registrar recebimentos.</p>`; return; }
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  const { data, error } = await sb.from("medicao_recebimentos")
    .select("id,data,valor,forma,banco,observacoes,confirmado_por,created_at,quem:confirmado_por(nome)")
    .eq("medicao_id", med.id).order("data").order("created_at");
  if(medEditId !== med.id) return;
  if(error){ cont.innerHTML = `<p class="vazio">Não foi possível ler os recebimentos (${esc(error.message)}).</p>`; return; }
  _medRecebLista = data || [];
  if(badge) badge.textContent = _medRecebLista.length || "";
  renderMedRecebFicha(med);
}
function renderMedRecebFicha(med){
  const cont = $("med-receb-conteudo");
  if(!cont) return;
  const podeOp = medCauPodeOperar();
  const liq = medLiquido(med), recebido = _medRecebLista.reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const saldo = Math.max(0, Math.round((liq - recebido) * 100) / 100);
  const sit = medRecebSituacao({ ...med, recebido_valor: recebido });
  const SIT = { sem_nf: ["Sem documento fiscal", "cinza"], a_receber: ["A receber", "ambar"], parcial: ["Recebida em parte", "azul"], vencida: ["Vencida", "vermelho"], recebida: ["Recebida", "verde"] };
  const chip = (lbl, val, title) => `<div class="chip"${title ? ` title="${esc(title)}"` : ""}><span>${lbl}</span><strong>${val}</strong></div>`;
  const temNf = !!med.nf_numero;
  const linhas = _medRecebLista.map(r => `<tr>
      <td>${dataBR(r.data)}</td>
      <td class="num">${brl(r.valor)}</td>
      <td>${r.forma === "permuta" ? '<span class="tag ambar" title="Fase 98: crédito do imóvel em permuta, gerado pela medição (muda pelo % de permuta na aba Geral)">Permuta</span>' : esc(MED_RECEB_FORMAS[r.forma] || r.forma || "—")}</td>
      <td>${esc(r.banco || "—")}</td>
      <td>${esc(r.observacoes || "")}</td>
      <td class="meta">${esc((r.quem && r.quem.nome) || "—")}</td>
      <td class="col-acao">${podeOp && r.forma !== "permuta" ? `<button type="button" class="btn-sec btn-sm txt-perigo" data-receb-del="${esc(r.id)}" title="Apagar este lançamento (a soma e o status da medição são refeitos no banco)">×</button>` : ""}</td>
    </tr>`).join("");
  cont.innerHTML = `
    <div class="odoo-contexto" style="padding:0 0 12px;">
      ${chip("Documento", temNf ? esc(medDocTxt(med)) : "—", "Nº do documento fiscal (aba Geral)")}
      ${chip("Emissão", med.nf_data_emissao ? dataBR(med.nf_data_emissao) : "—")}
      ${chip("Vencimento", med.nf_vencimento ? dataBR(med.nf_vencimento) + (sit === "vencida" ? ' <span class="txt-perigo">(vencida)</span>' : "") : "—")}
      ${chip("Valor final", brl(Number(med.valor_final) || Number(med.valor_medido) || 0))}
      ${chip("Retenção", brl(med.retencao_valor || 0), "Caução que o cliente segura (aba Caução)")}
      ${chip("ISS retido", med.iss_retido_fonte === false ? "não" : brl(med.iss_valor || 0), "ISS retido na fonte pelo cliente")}
      ${chip("Líquido a receber", `<span style="color:var(--sucesso-txt);">${brl(liq)}</span>`, "valor final − retenção − ISS retido (fase 47)")}
      ${chip("Recebido", brl(recebido))}
      ${chip("Saldo", `<span class="${saldo > 0.009 ? "txt-perigo" : ""}">${brl(saldo)}</span>`)}
      ${chip("Situação", `<span class="tag ${SIT[sit][1]}">${SIT[sit][0]}</span>`)}
    </div>
    <h4 class="titulo-bloco">Recebimentos confirmados <small class="meta">(a medição fica "recebida" sozinha quando a soma atinge o líquido)</small></h4>
    ${_medRecebLista.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Data</th><th class="num">Valor</th><th>Forma</th><th>Banco</th><th>Observações</th><th>Confirmado por</th><th class="col-acao"></th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><th>Total</th><th class="num">${brl(recebido)}</th><th colspan="5"></th></tr></tfoot>
    </table></div>` : `<p class="vazio">Nenhum recebimento confirmado ainda.</p>`}
    ${podeOp && temNf && !["rascunho", "enviada", "rejeitada"].includes(med.status) ? `
    <h4 class="titulo-bloco" style="margin-top:14px;">Confirmar recebimento</h4>
    <div class="grade">
      <div class="campo"><label>Data</label><input id="med-receb-data" type="date" value="${hojeISO()}" /></div>
      <div class="campo"><label>Valor (R$)</label><input id="med-receb-valor" type="number" step="0.01" min="0.01" value="${saldo > 0 ? saldo.toFixed(2) : ""}" placeholder="parcial é comum" /></div>
      <div class="campo"><label>Forma</label><select id="med-receb-forma">${Object.entries(MED_RECEB_FORMAS).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div>
      <div class="campo"><label>Banco</label><input id="med-receb-banco" list="med-cau-bancos" placeholder="Itaú, Caixa…" /></div>
      <div class="campo largo"><label>Observações</label><input id="med-receb-obs" placeholder="ex.: 2ª parcela, desconto de alimentação…" /></div>
    </div>
    <div class="form-acoes compacta" style="justify-content:flex-start;">
      <button type="button" class="btn btn-sucesso" id="btn-med-receb-confirmar">✅ Confirmar recebimento</button>
    </div>` : (podeOp && !temNf ? `<p class="nota">Informe o documento fiscal na aba Geral para confirmar recebimentos.</p>`
             : (podeOp ? `<p class="nota">Medição ${esc((STATUS.medicao[med.status] || {}).label || med.status)}: só medição aprovada ou faturada recebe.</p>`
             : `<p class="nota">Só o financeiro, o admin e a diretoria confirmam recebimentos.</p>`))}`;
  $("btn-med-receb-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-med-receb-confirmar", () => medRecebConfirmar(med)));
  cont.querySelectorAll("[data-receb-del]").forEach(b => b.addEventListener("click", () => medRecebApagar(med, b.dataset.recebDel)));
}
async function medRecebConfirmar(med){
  const valor = Number($("med-receb-valor")?.value);
  const data = $("med-receb-data")?.value;
  if(!(valor > 0)){ aviso("app-aviso", "Informe o valor recebido.", "erro"); return; }
  if(!data){ aviso("app-aviso", "Informe a data do recebimento.", "erro"); return; }
  const saldo = Math.max(0, medLiquido(med) - _medRecebLista.reduce((s, r) => s + (Number(r.valor) || 0), 0));
  if(valor > saldo + 0.005 && !confirm(`Valor ${brl(valor)} acima do saldo a receber ${brl(saldo)}. Confirmar assim mesmo?`)) return;
  const reg = { medicao_id: med.id, data, valor, forma: $("med-receb-forma")?.value || "transferencia",
    banco: ($("med-receb-banco")?.value || "").trim() || null, observacoes: ($("med-receb-obs")?.value || "").trim() || null };
  const { error } = await sb.from("medicao_recebimentos").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível confirmar o recebimento: " + error.message, "erro"); return; }
  _medRecebMes = null;
  aviso("app-aviso", "Recebimento confirmado. Soma e status da medição refeitos no banco.", "ok");
  await carregarMedicoes();
  await abrirMedicao(med.id);
  ativarTabMed("recebimento");
}
async function medRecebApagar(med, id){
  const r = _medRecebLista.find(x => x.id === id);
  if(!r || !confirm(`Apagar o recebimento de ${brl(r.valor)} em ${dataBR(r.data)}?`)) return;
  const { error } = await sb.from("medicao_recebimentos").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível apagar: " + error.message, "erro"); return; }
  _medRecebMes = null;
  await carregarMedicoes();
  await abrirMedicao(med.id);
  ativarTabMed("recebimento");
}

/* ---------- ligações da fase 91 ---------- */
function ligarMedCaucao(){
  ["med-cau-busca", "med-cau-f-ano", "med-cau-f-status", "med-cau-f-cliente", "med-cau-f-obra", "med-cau-f-banco", "med-cau-agrupar"].forEach(id => {
    const el = $(id);
    if(!el) return;
    if(id === "med-cau-busca") el.addEventListener("input", debounce(renderMedicoes));
    else el.addEventListener("change", () => { if(id === "med-cau-agrupar") _medCauAgrupar = el.value; renderMedicoes(); });
  });
  $("btn-med-cau-exportar")?.addEventListener("click", medCauExportar);
  $("btn-med-cau-atualizar")?.addEventListener("click", () => comBotaoTravado("btn-med-cau-atualizar", async () => { await medCauCarregar(true); renderMedicoes(); }));
  // linhas da visão Caução (data-cau) e do agrupamento por cliente (data-cau-cli); o handler antigo só reage a data-id
  $("med-conteudo")?.addEventListener("click", (e) => {
    const r = e.target.closest("[data-cau]");
    if(r){ medCauAbrir(r.dataset.cau); return; }
    const g = e.target.closest("[data-cau-cli]");
    if(g){
      if($("med-cau-f-cliente")) $("med-cau-f-cliente").value = g.dataset.cauCli;
      _medCauAgrupar = "nf";
      renderMedicoes();
    }
  });
  // indicadores clicáveis filtram (clicar de novo limpa)
  $("med-indicadores")?.addEventListener("click", (e) => {
    const r = e.target.closest("[data-receb]");
    if(r){ const f = $("med-f-receb"); if(f){ f.value = f.value === r.dataset.receb ? "" : r.dataset.receb; renderMedicoes(); } return; }
    const c = e.target.closest("[data-cau-st]");
    if(c){ const f = $("med-cau-f-status"); if(f){ f.value = f.value === c.dataset.cauSt ? "" : c.dataset.cauSt; renderMedicoes(); } }
  });
  $("btn-med-cau-modal-fechar")?.addEventListener("click", medCauFecharModal);
  $("med-cau-modal")?.addEventListener("click", (e) => { if(e.target === $("med-cau-modal")) medCauFecharModal(); });
  $("med-obra")?.addEventListener("change", () => medCauSugerirPctDaObra($("med-obra").value));
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarMedCaucao);
} else {
  ligarMedCaucao();
}

/* ====================================================================
   FASE 98 — Permutas: obras pagas em imóvel (21/10/2026)
   Spec: docs/specs/fase-98-permutas.md. Tudo desta fase fica neste bloco (prefixo med-pm- / pm-).
   - Visão "Permutas" no toggle do painel (irmã da Caução): uma linha por permuta (vw_permutas) com
     cliente, imóvel, teto, crédito (medições do app + histórico da planilha), saldo, %, prazo e pendências.
   - Ficha da permuta no padrão Odoo (statusbar pelo status do dia, chips, smart-buttons, abas Geral,
     Lançamentos, Contratos, Documentos e Pendências) em #med-pm-ficha.
   - Medição: "% permuta" e "crédito de permuta" ao lado do líquido (aba Geral). O crédito vira um
     recebimento forma = 'permuta' no banco quando a medição é aprovada/faturada (gatilho); a parte em
     dinheiro segue a aba NF/Recebimento (fase 91). Chip "permuta NN%" na lista.
   - Funções usadas por outros módulos (só se existirem): medPmAbrirPreset (Sala de Comando),
     medPmAbrirPorId (aba Contrato da obra), pmPatCarregar / pmPatChip (Patrimônio).
   Quem lê: podeVerPermutas() (diretor, admin, financeiro, auditor; = pode_ler_permutas() no banco).
   Quem grava: diretor, admin e financeiro; auditor só lê.
   ==================================================================== */
const MED_PM_STATUS = {
  a_formalizar: { label: "A formalizar", cor: "cinza"    },
  em_execucao:  { label: "Em execução",  cor: "azul"     },
  quitada:      { label: "Quitada",      cor: "verde"    },
  excedida:     { label: "Excedida",     cor: "vermelho" },
  vencida:      { label: "Vencida",      cor: "vermelho" }
};
const MED_PM_STAGES = ["a_formalizar", "em_execucao", "quitada"];
const MED_PM_SENTIDO = { recebemos_imovel: "Recebemos o imóvel", invertida: "Invertida (pagamos imóvel com serviço)" };
const MED_PM_PEND_ROT = {
  credito_excedente: "crédito acima do imóvel", prazo_vencido: "prazo vencido", prazo_90_dias: "prazo em 90 dias",
  termo_nao_assinado: "sem assinatura", imovel_nao_identificado: "imóvel não identificado", sem_documento: "sem PDF",
  nf_a_emitir: "NF a emitir"
};
const MED_PM_BUCKET = "permutas";
const MED_PM_MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
let _medPmRegistros = null;   // vw_permutas (null = recarregar)
let _medPmPend      = [];     // vw_permuta_pendencias
let _medPmSemPermuta = [];    // histórico sem permuta definida (Marca Brasil)
let _medPmFicha     = null;   // permuta aberta (linha da vw_permutas)
let _medPmLanc      = [];     // lançamentos da permuta aberta
let _medPmContratos = [];     // permuta_contratos da permuta aberta
let _medPmPreset    = null;   // { id, filtro } pedido pela Sala de Comando antes da carga
let _medPmPatMapa   = null;   // patrimonio_bem_id → permuta (Patrimônio)

function medPmPodeVer(){ return typeof podeVerPermutas === "function" ? podeVerPermutas() : (!!usuarioAtual && ["diretor", "admin", "financeiro", "auditor"].includes(usuarioAtual.cargo)); }
function medPmPodeOperar(){ return !!usuarioAtual && ["diretor", "admin", "financeiro"].includes(usuarioAtual.cargo) && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()); }
function medTagPm(st){ const o = MED_PM_STATUS[st] || { label: st || "—", cor: "cinza" }; return `<span class="tag ${o.cor}">${esc(o.label)}</span>`; }
const medPmNum = (v) => (v === "" || v == null) ? null : Number(v);
function medPmPrazoTxt(p){
  if(!p.executar_ate) return "—";
  const d = Number(p.dias_prazo);
  const extra = !isFinite(d) ? "" : (d < 0 ? ` <span class="txt-perigo">(${-d} d atrás)</span>` : (d <= 90 ? ` <span class="txt-aviso" title="prazo em até 90 dias">(${d} d)</span>` : ` <span class="meta">(${d} d)</span>`));
  return dataBR(p.executar_ate) + extra;
}

/* ---------- carga ---------- */
async function medPmCarregar(forcar){
  if(_medPmRegistros && !forcar) return _medPmRegistros;
  const [rp, rpe, rsp] = await Promise.all([
    sb.from("vw_permutas").select("*").order("numero"),
    sb.from("vw_permuta_pendencias").select("*"),
    sb.from("vw_permuta_lancamentos").select("cliente,contrato_numero,credito,valor_medicao").is("permuta_id", null)
  ]);
  const erro = [rp, rpe, rsp].find(r => r.error);
  if(erro){ aviso("app-aviso", "Não foi possível ler as permutas: " + erro.error.message, "erro"); _medPmRegistros = []; _medPmPend = []; _medPmSemPermuta = []; return _medPmRegistros; }
  _medPmRegistros = rp.data || [];
  _medPmPend = rpe.data || [];
  _medPmSemPermuta = rsp.data || [];
  return _medPmRegistros;
}
function medPmPendDe(id){ return _medPmPend.filter(x => x.permuta_id === id); }

/* ---------- visão Permutas ---------- */
function medPmFiltradas(){
  const termo = ($("med-pm-busca")?.value || "").trim().toLowerCase();
  const st = $("med-pm-f-status")?.value || "";
  const pend = $("med-pm-f-pend")?.value || "";
  return (_medPmRegistros || []).filter(p => {
    if(st && p.status !== st) return false;
    if(pend && !medPmPendDe(p.id).some(x => x.tipo === pend)) return false;
    if(termo){
      const alvo = `${p.numero || ""} ${p.cliente || ""} ${p.cliente_nome || ""} ${p.imovel_descricao || ""} ${p.instrumento_tipo || ""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}
async function renderMedPermutas(){
  const cont = $("med-conteudo");
  if(!cont) return;
  if(!medPmPodeVer()){ cont.innerHTML = `<p class="vazio">Permutas: só diretoria, admin, financeiro e auditor.</p>`; return; }
  if(!_medPmRegistros){
    cont.innerHTML = `<p class="vazio">Carregando permutas…</p>`;
    await medPmCarregar();
    if(_medView !== "permutas") return;
  }
  if(_medPmPreset){
    const pr = _medPmPreset; _medPmPreset = null;
    if(pr.filtro && $("med-pm-f-pend")) $("med-pm-f-pend").value = pr.filtro;
    if(pr.id && _medPmRegistros.some(p => p.id === pr.id)){ medPmAbrir(pr.id); return; }
  }
  if($("btn-med-pm-nova")) $("btn-med-pm-nova").style.display = medPmPodeOperar() ? "" : "none";
  const dados = medPmFiltradas();
  const contador = $("med-contador");
  if(contador) contador.textContent = `${dados.length} de ${_medPmRegistros.length} permutas`;
  medPmRenderIndicadores();
  if(!dados.length && !_medPmSemPermuta.length){ cont.innerHTML = `<p class="vazio">Nenhuma permuta com esses filtros.</p>`; return; }
  const linhas = dados.map(p => {
    const pend = medPmPendDe(p.id);
    const pendTxt = [...new Set(pend.map(x => MED_PM_PEND_ROT[x.tipo] || x.tipo))];
    const critico = pend.some(x => x.nivel === "critico");
    return `<tr class="linha-clicavel" data-pm="${esc(p.id)}" title="Abrir a ficha da permuta">
      <td><strong>${esc(p.numero)}</strong></td>
      <td title="${esc(p.cliente || "")}">${esc(p.cliente_nome || p.cliente || "—")}${p.sentido === "invertida" ? ' <span class="tag ambar" title="Permuta invertida: a CGL (ou a holding) compra o imóvel e paga parte do preço em serviços">invertida</span>' : ""}</td>
      <td title="${esc(p.imovel_descricao || "")}">${esc(p.imovel_descricao ? (p.imovel_descricao.length > 60 ? p.imovel_descricao.slice(0, 60) + "…" : p.imovel_descricao) : "—")}${p.imovel_identificado ? "" : ' <span class="meta txt-aviso">(a identificar)</span>'}</td>
      <td class="num">${p.percentual_padrao != null ? num(p.percentual_padrao) + "%" : "—"}</td>
      <td class="num">${p.valor_imovel != null ? brl(p.valor_imovel) : "—"}</td>
      <td class="num" title="medições do app ${brl(p.credito_app)} + histórico ${brl(p.credito_historico)}${Number(p.credito_previsto) ? " · previsto (medições ainda não aprovadas) " + brl(p.credito_previsto) : ""}">${brl(p.credito)}</td>
      <td class="num"><strong class="${Number(p.saldo) < -1 ? "txt-perigo" : ""}">${p.saldo != null ? brl(p.saldo) : "—"}</strong></td>
      <td class="num">${p.pct_concluido != null ? num(p.pct_concluido) + "%" : "—"}</td>
      <td>${medPmPrazoTxt(p)}</td>
      <td>${medTagPm(p.status)}</td>
      <td>${pendTxt.length ? `<span class="${critico ? "txt-perigo" : "meta"}" title="${esc(pend.map(x => x.titulo).join("\n"))}">${esc(pendTxt.join(", "))}</span>` : '<span class="meta">—</span>'}</td>
    </tr>`;
  }).join("");
  const tot = (f) => dados.reduce((s, p) => s + (Number(f(p)) || 0), 0);
  // histórico executado em permuta sem imóvel definido (Marca Brasil): fica visível para não sumir do saldo
  const semG = new Map();
  _medPmSemPermuta.forEach(l => { const k = l.cliente || "(sem cliente)"; const g = semG.get(k) || { n: 0, cred: 0, contratos: new Set() }; g.n++; g.cred += Number(l.credito) || 0; if(l.contrato_numero) g.contratos.add(l.contrato_numero); semG.set(k, g); });
  const semLinhas = [...semG.entries()].map(([cli, g]) => `<tr>
      <td class="meta">—</td><td>${esc(cli)}</td>
      <td colspan="3" class="meta">Histórico em permuta sem imóvel definido · ${g.n} lançamento(s) · ${esc([...g.contratos].join(", "))}</td>
      <td class="num">${brl(g.cred)}</td><td colspan="4"></td><td><span class="txt-aviso">revisar: sem permuta</span></td></tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nº</th><th>Cliente</th><th>Imóvel</th><th class="num" title="% padrão da medição pago em permuta">%</th>
      <th class="num" title="Valor do imóvel (teto da permuta)">Teto</th><th class="num" title="Medições do app (aprovadas, faturadas, recebidas) + histórico da planilha">Crédito</th>
      <th class="num" title="Teto − crédito (negativo = crédito acima do imóvel)">Saldo</th><th class="num">%&nbsp;concl.</th><th>Prazo</th><th>Status</th><th>Pendências</th>
    </tr></thead>
    <tbody>${linhas}${semLinhas}</tbody>
    <tfoot><tr><th colspan="4">${dados.length} permuta(s)</th><th class="num">${brl(tot(p => p.valor_imovel))}</th><th class="num">${brl(tot(p => p.credito))}</th><th class="num">${brl(tot(p => p.saldo))}</th><th colspan="4"></th></tr></tfoot>
  </table></div>`;
}
function medPmRenderIndicadores(){
  const cont = $("med-indicadores");
  if(!cont) return;
  const regs = _medPmRegistros || [];
  const abertas = regs.filter(p => !["quitada", "excedida"].includes(p.status));
  const saldo = abertas.reduce((s, p) => s + Math.max(0, Number(p.saldo) || 0), 0);
  const exced = regs.reduce((s, p) => s + (Number(p.excedente) || 0), 0);
  const prazo = regs.filter(p => p.executar_ate && Number(p.dias_prazo) <= 90 && !["quitada", "excedida"].includes(p.status));
  const nfs = _medPmPend.filter(x => x.tipo === "nf_a_emitir");
  const pAtivo = $("med-pm-f-pend")?.value || "";
  cont.style.display = "";
  cont.innerHTML = `
    <div class="ind" title="Soma dos tetos das permutas (valor dos imóveis ou parte do preço paga em serviços)"><div class="num">${brl(regs.reduce((s, p) => s + (Number(p.valor_imovel) || 0), 0))}</div><div class="rot">Imóveis · ${regs.length} permuta(s)</div></div>
    <div class="ind" title="Crédito de serviços gerado: medições do app aprovadas/faturadas/recebidas + histórico da planilha"><div class="num" style="color:var(--sucesso);">${brl(regs.reduce((s, p) => s + (Number(p.credito) || 0), 0))}</div><div class="rot">Crédito gerado</div></div>
    <div class="ind" title="Teto − crédito das permutas ainda não quitadas"><div class="num" style="color:var(--aviso);">${brl(saldo)}</div><div class="rot">Saldo a executar · ${abertas.length} permuta(s)</div></div>
    <div class="ind ind-click${pAtivo === "credito_excedente" ? " ativo" : ""}" data-pm-pend="credito_excedente" title="Crédito acima do valor do imóvel: negociar o acerto. Clique para filtrar."><div class="num" style="color:var(--perigo);">${brl(exced)}</div><div class="rot">Excedente</div></div>
    <div class="ind ind-click${pAtivo === "prazo_90_dias" ? " ativo" : ""}" data-pm-pend="prazo_90_dias" title="Prazo para executar vencido ou em até 90 dias. Clique para filtrar."><div class="num">${prazo.length}</div><div class="rot">Prazo em 90 dias</div></div>
    <div class="ind ind-click${pAtivo === "nf_a_emitir" ? " ativo" : ""}" data-pm-pend="nf_a_emitir" title="Medições e lançamentos com crédito de permuta sem NF. Clique para filtrar."><div class="num">${nfs.length}</div><div class="rot">NF a emitir · ${brl(nfs.reduce((s, x) => s + (Number(x.valor) || 0), 0))}</div></div>`;
}
function medPmExportar(){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
  const dados = medPmFiltradas();
  if(!dados.length){ aviso("app-aviso", "Nada para exportar com esses filtros.", "erro"); return; }
  const aoa = [["Nº", "Cliente", "Imóvel", "Sentido", "Instrumento", "Assinado", "% padrão", "Teto", "Crédito app", "Crédito histórico", "Crédito", "Saldo", "% concluído", "Executar até", "Status", "Pendências"]]
    .concat(dados.map(p => [p.numero, p.cliente_nome || p.cliente || "", p.imovel_descricao || "", MED_PM_SENTIDO[p.sentido] || p.sentido, p.instrumento_tipo || "", p.instrumento_assinado ? "sim" : "não",
      p.percentual_padrao != null ? Number(p.percentual_padrao) : "", Number(p.valor_imovel) || 0, Number(p.credito_app) || 0, Number(p.credito_historico) || 0, Number(p.credito) || 0,
      p.saldo != null ? Number(p.saldo) : "", p.pct_concluido != null ? Number(p.pct_concluido) : "", p.executar_ate ? dataBR(p.executar_ate) : "",
      (MED_PM_STATUS[p.status] || {}).label || p.status, medPmPendDe(p.id).map(x => x.titulo).join("; ")]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PERMUTAS");
  XLSX.writeFile(wb, `permutas-${hojeISO()}.xlsx`);
}

/* ---------- ficha da permuta ---------- */
function medPmMostrarFicha(){
  if($("med-painel")) $("med-painel").style.display = "none";
  if($("med-ficha")) $("med-ficha").style.display = "none";
  if($("med-pm-ficha")) $("med-pm-ficha").style.display = "";
}
function medPmVoltar(){
  if(typeof ocultarHistorico === "function") ocultarHistorico("med-pm-chatter");
  _medPmFicha = null;
  if($("med-pm-ficha")) $("med-pm-ficha").style.display = "none";
  if($("med-painel")) $("med-painel").style.display = "";
  if($("med-ficha")) $("med-ficha").style.display = "none";
  medAtivarView("permutas");
}
async function medPmAbrir(id, aba){
  if(!medPmPodeVer()) return;
  if(!_medPmRegistros || !_medPmRegistros.some(p => p.id === id)) await medPmCarregar(true);
  const p = (_medPmRegistros || []).find(x => x.id === id);
  if(!p){ aviso("app-aviso", "Permuta não encontrada (ou sem permissão para ler).", "erro"); return; }
  _medPmFicha = p;
  medPmMostrarFicha();
  const box = $("med-pm-ficha");
  box.innerHTML = `<div class="odoo-sheet"><p class="vazio">Carregando ${esc(p.numero)}…</p></div>`;
  const [rl, rc] = await Promise.all([
    sb.from("vw_permuta_lancamentos").select("*").eq("permuta_id", id).order("data", { ascending: true, nullsFirst: true }),
    sb.from("permuta_contratos").select("id,obra_id,contrato_numero,obra_descricao,percentual,observacoes,obra:obras(codigo,nome)").eq("permuta_id", id).order("contrato_numero")
  ]);
  if(!_medPmFicha || _medPmFicha.id !== id) return;
  _medPmLanc = rl.error ? [] : (rl.data || []);
  _medPmContratos = rc.error ? [] : (rc.data || []);
  medPmRenderFicha(aba || "geral");
}
/* Atalho para outros módulos (aba Contrato da obra): vai para Medições › Permutas e abre a ficha */
async function medPmAbrirPorId(id){
  if(typeof irParaSecao === "function" && !irParaSecao("medicoes")) return;
  mostrarPainelMed();
  document.querySelectorAll("#med-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === "permutas"));
  _medView = "permutas";
  await medPmAbrir(id);
}
/* Sala de Comando → visão Permutas (registro_id = uma permuta abre a ficha; filtro = pendência) */
function medPmAbrirPreset(id, filtro){
  mostrarPainelMed();
  const MAP = { permuta_termo: "termo_nao_assinado", permuta_imovel: "imovel_nao_identificado", permuta_nf: "nf_a_emitir" };
  _medPmPreset = { id: id || null, filtro: MAP[filtro] || filtro || "" };
  _medPmRegistros = null;
  medAtivarView("permutas");
}

function medPmRenderFicha(aba){
  const p = _medPmFicha, box = $("med-pm-ficha");
  if(!p || !box) return;
  const podeOp = medPmPodeOperar();
  const pend = medPmPendDe(p.id);
  const lateral = ["excedida", "vencida"].includes(p.status);
  const idx = MED_PM_STAGES.indexOf(p.status);
  const stages = MED_PM_STAGES.map((s, i) => {
    let cls = "";
    if(lateral){ if(s !== "quitada" || p.status === "excedida") cls = "passada"; }
    else if(i === idx) cls = "atual";
    else if(i < idx) cls = "passada";
    return `<div class="stage ${cls}" title="Status calculado no banco: crédito × teto, prazo, assinatura e imóvel">${esc(MED_PM_STATUS[s].label)}</div>`;
  }).join("") + (lateral ? `<div class="stage atual cancelada" title="${p.status === "excedida" ? "Crédito acima do valor do imóvel" : "Prazo para executar passou com saldo"}">${esc(MED_PM_STATUS[p.status].label)}</div>` : "");
  const chip = (lbl, val, title) => `<div class="chip"${title ? ` title="${esc(title)}"` : ""}><span>${lbl}</span><strong>${val}</strong></div>`;
  const nMed = _medPmLanc.filter(l => l.origem === "medicao").length, nHist = _medPmLanc.filter(l => l.origem === "historico").length;
  const sb_ = (id, n, ic, lbl, tab) => `<button type="button" class="sb-btn" data-pm-tab="${tab}" id="${id}"><span class="sb-num">${n}</span><span class="sb-icon">${ic}</span><span class="sb-lbl">${lbl}</span></button>`;
  const abas = [["geral", "📋 Geral"], ["lancamentos", `📊 Lançamentos <span class="conf-badge">${_medPmLanc.length || ""}</span>`], ["contratos", `📑 Contratos <span class="conf-badge">${_medPmContratos.length || ""}</span>`],
    ["documentos", "📎 Documentos"], ["pendencias", `⚠️ Pendências <span class="conf-badge">${pend.length || ""}</span>`]];
  box.innerHTML = `<div class="odoo-sheet">
    <div class="odoo-actions-header">
      <div class="actions-left">
        <button type="button" class="btn-sec" id="btn-med-pm-voltar">&larr; Voltar</button>
        ${podeOp ? `<button type="button" class="btn" id="btn-med-pm-salvar">💾 Salvar</button>` : ""}
        ${podeOp && !_medPmLanc.length && !_medPmContratos.length ? `<button type="button" class="btn-sec acao-perigo" id="btn-med-pm-excluir" title="Só permuta sem contratos nem lançamentos">🗑️ Excluir</button>` : ""}
      </div>
      <div class="actions-right"><strong class="ficha-titulo">Permuta ${esc(p.numero)}</strong></div>
    </div>
    <div class="odoo-statusbar">${stages}</div>
    <div class="odoo-contexto">
      ${chip("Cliente", esc(p.cliente_nome || p.cliente || "—"), p.cliente || "")}
      ${chip("Imóvel", esc(p.imovel_descricao ? (p.imovel_descricao.length > 48 ? p.imovel_descricao.slice(0, 48) + "…" : p.imovel_descricao) : "—") + (p.imovel_identificado ? "" : ' <span class="txt-aviso">(a identificar)</span>'), p.imovel_descricao || "")}
      ${chip("Sentido", esc(p.sentido === "invertida" ? "Invertida" : "Recebemos o imóvel"), MED_PM_SENTIDO[p.sentido])}
      ${chip("Instrumento", esc(p.instrumento_tipo || "—") + (p.instrumento_assinado ? "" : ' <span class="txt-perigo">(sem assinatura)</span>'), p.instrumento_data ? "Data " + dataBR(p.instrumento_data) : "")}
      ${chip("Teto", p.valor_imovel != null ? brl(p.valor_imovel) : "—", p.valor_imovel_total ? "Preço cheio do imóvel " + brl(p.valor_imovel_total) : "Valor do imóvel")}
      ${chip("Crédito", brl(p.credito), `medições do app ${brl(p.credito_app)} + histórico ${brl(p.credito_historico)}`)}
      ${chip("Saldo", `<span class="${Number(p.saldo) < -1 ? "txt-perigo" : ""}">${p.saldo != null ? brl(p.saldo) : "—"}</span>`, "Teto − crédito")}
      ${chip("Concluído", p.pct_concluido != null ? num(p.pct_concluido) + "%" : "—")}
      ${chip("Prazo", medPmPrazoTxt(p), "Executar até")}
      ${chip("Status", medTagPm(p.status))}
    </div>
    <div class="odoo-smart-buttons">
      ${sb_("sb-med-pm-contratos", _medPmContratos.length, "📑", "contratos", "contratos")}
      ${sb_("sb-med-pm-medicoes", nMed, "📊", "medições do app", "lancamentos")}
      ${sb_("sb-med-pm-historico", nHist, "🗂️", "histórico", "lancamentos")}
      ${sb_("sb-med-pm-pend", pend.length, "⚠️", "pendências", "pendencias")}
    </div>
    <div class="odoo-notebook" id="med-pm-notebook">${abas.map(([t, l]) => `<button type="button" data-tab="${t}">${l}</button>`).join("")}</div>
    <div class="odoo-body">
      <div class="odoo-tab" data-tab="geral">${medPmGeralHTML(p, podeOp)}</div>
      <div class="odoo-tab" data-tab="lancamentos">${medPmLancHTML(p, podeOp)}</div>
      <div class="odoo-tab" data-tab="contratos">${medPmContratosHTML(p, podeOp)}</div>
      <div class="odoo-tab" data-tab="documentos"><div id="med-pm-docs"><p class="vazio">Carregando documentos…</p></div></div>
      <div class="odoo-tab" data-tab="pendencias">${medPmPendHTML(pend)}</div>
    </div>
    <div id="med-pm-chatter" class="historico"></div>
  </div>`;
  medPmLigarFicha(p, podeOp);
  medPmAtivarTab(aba || "geral");
  medPmCarregarDocs(p, podeOp);
  if(typeof montarHistorico === "function") montarHistorico("permutas", p.id, "med-pm-chatter");
}
function medPmAtivarTab(nome){
  document.querySelectorAll("#med-pm-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#med-pm-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
function medPmGeralHTML(p, podeOp){
  const ro = podeOp ? "" : "disabled";
  const cli = Object.entries(mapaClientes || {}).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR"));
  const sel = (id, opts, v) => `<select id="${id}" ${ro}>${opts.map(([k, l]) => `<option value="${esc(k)}"${String(v ?? "") === String(k) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return `<div class="grade">
      <div class="campo"><label>Cliente (como o financeiro chama) *</label><input id="med-pm-cliente-nome" value="${esc(p.cliente_nome || "")}" ${ro} placeholder="ex.: SAGA" /></div>
      <div class="campo"><label>Cliente no cadastro</label>${sel("med-pm-cliente", [["", "— sem cadastro —"]].concat(cli), p.cliente_id || "")}</div>
      <div class="campo"><label>Sentido</label>${sel("med-pm-sentido", Object.entries(MED_PM_SENTIDO), p.sentido)}</div>
      <div class="campo"><label>% padrão da medição em permuta</label><input id="med-pm-pct-padrao" type="number" step="0.01" min="0" max="100" value="${p.percentual_padrao ?? ""}" ${ro} title="Herdado pelas medições novas das obras ligadas (o contrato pode ter o seu)" /></div>
      <div class="campo largo"><label>Imóvel</label><input id="med-pm-imovel" value="${esc(p.imovel_descricao || "")}" ${ro} placeholder="unidade, empreendimento, endereço" /></div>
      <div class="campo"><label>Imóvel identificado?</label>${sel("med-pm-identificado", [["true", "Sim"], ["false", "Não (a identificar)"]], String(!!p.imovel_identificado))}</div>
      <div class="campo"><label>Teto da permuta (R$)</label><input id="med-pm-teto" type="number" step="0.01" min="0" value="${p.valor_imovel ?? ""}" ${ro} title="Valor do imóvel, ou a parte do preço paga em serviços (invertida)" /></div>
      <div class="campo"><label>Preço cheio do imóvel (R$)</label><input id="med-pm-total" type="number" step="0.01" min="0" value="${p.valor_imovel_total ?? ""}" ${ro} title="Só quando a permuta cobre parte do preço (ex.: Katz)" /></div>
      <div class="campo"><label>Executar até</label><input id="med-pm-prazo" type="date" value="${esc(p.executar_ate || "")}" ${ro} /></div>
      <div class="campo largo"><label>Instrumento</label><input id="med-pm-instr" value="${esc(p.instrumento_tipo || "")}" ${ro} placeholder="contrato de adesão, SCP, CPCV, contrato da obra…" /></div>
      <div class="campo"><label>Data do instrumento</label><input id="med-pm-instr-data" type="date" value="${esc(p.instrumento_data || "")}" ${ro} /></div>
      <div class="campo"><label>Instrumento assinado?</label>${sel("med-pm-assinado", [["true", "Sim"], ["false", "Não"]], String(!!p.instrumento_assinado))}</div>
      <div class="campo largo"><label>Observações</label><textarea id="med-pm-obs" rows="3" ${ro}>${esc(p.observacoes || "")}</textarea></div>
    </div>
    ${p.patrimonio_bem_id ? `<p class="nota">Imóvel no Patrimônio (titularidade "permuta"). Quando a permuta quitar, a diretoria passa a titularidade para "empresa" na ficha do bem.</p>` : (p.sentido === "invertida" ? `<p class="nota">Permuta invertida: o imóvel não entra no patrimônio da CGL Fundações (decisão da fase 98).</p>` : "")}
    ${podeOp ? "" : `<p class="nota">Só o financeiro, o admin e a diretoria alteram a permuta.</p>`}`;
}
function medPmLancHTML(p, podeOp){
  const linhas = _medPmLanc.map(l => `<tr${l.origem === "medicao" ? ` class="linha-clicavel" data-pm-med="${esc(l.medicao_id)}" title="Abrir a medição"` : ""}>
      <td>${l.origem === "medicao" ? '<span class="tag azul">App</span>' : '<span class="tag cinza" title="Histórico da planilha consolidada">Histórico</span>'}</td>
      <td>${esc(l.contrato_numero || "—")}</td>
      <td>${l.obra_id ? linkObra(l.obra_id, l.obra_codigo || "obra") : esc(l.obra_descricao || "—")}</td>
      <td>${esc(l.medicao || "—")}</td>
      <td class="meta">${esc(l.periodo || (l.data ? dataBR(l.data) : "—"))}</td>
      <td class="num">${l.valor_medicao != null ? brl(l.valor_medicao) : "—"}</td>
      <td class="num">${l.percentual != null ? num(l.percentual) + "%" : "—"}</td>
      <td class="num"><strong>${brl(l.credito)}</strong>${l.credito_manual ? ' <span class="meta" title="Crédito fixado à mão pelo financeiro">✎</span>' : ""}</td>
      <td>${esc(l.nf_numero || "—")}</td>
      <td>${l.origem === "medicao" ? tagStatus("medicao", l.status) + (l.conta ? "" : ' <span class="meta" title="Só entra no crédito quando aprovada">previsto</span>') : `<span class="meta" title="${esc(l.termo || "")}">${esc(l.termo ? (l.termo.length > 24 ? l.termo.slice(0, 24) + "…" : l.termo) : "—")}</span>`}</td>
      <td class="col-acao">${podeOp && l.origem === "historico" ? `<button type="button" class="btn-sec btn-sm txt-perigo" data-pm-lanc-del="${esc(l.id)}" title="Apagar este lançamento histórico">×</button>` : ""}</td>
    </tr>`).join("");
  const conta = _medPmLanc.filter(l => l.conta);
  const tot = (f, lst) => lst.reduce((s, l) => s + (Number(f(l)) || 0), 0);
  return `${_medPmLanc.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Origem</th><th>Contrato</th><th>Obra</th><th>Medição</th><th>Período</th><th class="num">Valor</th><th class="num">%</th><th class="num">Crédito</th><th>NF</th><th>Status / termo</th><th class="col-acao"></th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><th colspan="5">${_medPmLanc.length} lançamento(s) · ${conta.length} no crédito</th><th class="num">${brl(tot(l => l.valor_medicao, conta))}</th><th></th><th class="num">${brl(tot(l => l.credito, conta))}</th><th colspan="3"></th></tr></tfoot>
    </table></div>` : `<p class="vazio">Nenhum lançamento. As medições das obras ligadas (aba Contratos) entram aqui sozinhas.</p>`}
    ${podeOp ? `<h4 class="titulo-bloco" style="margin-top:14px;">Lançamento histórico <small class="meta">(medição sem obra no app; as do app nascem da medição)</small></h4>
    <div class="grade">
      <div class="campo"><label>Contrato</label><input id="med-pm-l-contrato" placeholder="ex.: 4421/2023" /></div>
      <div class="campo"><label>Obra (texto)</label><input id="med-pm-l-obra" /></div>
      <div class="campo"><label>Medição</label><input id="med-pm-l-medicao" placeholder="ex.: 1, Única" /></div>
      <div class="campo"><label>Data de referência</label><input id="med-pm-l-data" type="date" /></div>
      <div class="campo"><label>Valor da medição (R$)</label><input id="med-pm-l-valor" type="number" step="0.01" min="0" /></div>
      <div class="campo"><label>Crédito de permuta (R$)</label><input id="med-pm-l-credito" type="number" step="0.01" min="0" /></div>
      <div class="campo"><label>NF</label><input id="med-pm-l-nf" /></div>
      <div class="campo largo"><label>Autorização / termo</label><input id="med-pm-l-termo" placeholder="termo assinado, e-mail…" /></div>
    </div>
    <div class="form-acoes compacta" style="justify-content:flex-start;"><button type="button" class="btn-sec" id="btn-med-pm-l-add">+ Lançar</button></div>` : ""}`;
}
function medPmContratosHTML(p, podeOp){
  const linhas = _medPmContratos.map(c => `<tr>
      <td><strong>${esc(c.contrato_numero)}</strong></td>
      <td>${c.obra_id ? linkObra(c.obra_id, c.obra ? `${c.obra.codigo} — ${c.obra.nome || ""}` : "obra") : `<span class="meta">sem obra no app${c.obra_descricao ? " · " + esc(c.obra_descricao) : ""}</span>`}</td>
      <td class="num">${c.percentual != null ? num(c.percentual) + "%" : `<span class="meta">${p.percentual_padrao != null ? num(p.percentual_padrao) + "% (padrão)" : "—"}</span>`}</td>
      <td class="meta">${esc(c.observacoes || "")}</td>
      <td class="col-acao">${podeOp ? `<button type="button" class="btn-sec btn-sm" data-pm-ctr-pct="${esc(c.id)}" title="Mudar o % deste contrato">%</button> <button type="button" class="btn-sec btn-sm txt-perigo" data-pm-ctr-del="${esc(c.id)}" title="Desligar o contrato da permuta (as medições já lançadas mantêm o % gravado)">×</button>` : ""}</td>
    </tr>`).join("");
  const obrasLivres = Object.entries(mapaObras || {}).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR", { numeric: true }));
  return `${_medPmContratos.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Contrato</th><th>Obra</th><th class="num">% em permuta</th><th>Observações</th><th class="col-acao"></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>` : `<p class="vazio">Nenhum contrato ligado.</p>`}
    ${podeOp ? `<h4 class="titulo-bloco" style="margin-top:14px;">Ligar contrato</h4>
    <div class="grade">
      <div class="campo largo"><label>Obra do app</label><select id="med-pm-c-obra"><option value="">— contrato antigo, sem obra no app —</option>${obrasLivres.map(([id, t]) => `<option value="${esc(id)}">${esc(t)}</option>`).join("")}</select></div>
      <div class="campo"><label>Nº do contrato *</label><input id="med-pm-c-numero" placeholder="ex.: 8290/2026" /></div>
      <div class="campo"><label>% em permuta</label><input id="med-pm-c-pct" type="number" step="0.01" min="0" max="100" placeholder="vazio = padrão" /></div>
    </div>
    <div class="form-acoes compacta" style="justify-content:flex-start;"><button type="button" class="btn-sec" id="btn-med-pm-c-add">+ Ligar</button>
      <span class="meta">As medições já lançadas da obra sem % recebem o % na hora (o crédito e o recebimento nascem no banco).</span></div>` : ""}`;
}
function medPmPendHTML(pend){
  if(!pend.length) return `<p class="vazio">Sem pendências.</p>`;
  const cor = { critico: "vermelho", atencao: "ambar", observar: "cinza" };
  return `<div class="tabela-rola"><table>
    <thead><tr><th>Nível</th><th>Pendência</th><th>Detalhe</th><th class="num">Valor</th></tr></thead>
    <tbody>${pend.map(x => `<tr><td><span class="tag ${cor[x.nivel] || "cinza"}">${esc(x.nivel === "critico" ? "Crítico" : x.nivel === "atencao" ? "Atenção" : "Observar")}</span></td>
      <td>${esc(x.titulo)}</td><td class="meta">${esc(x.detalhe || "")}</td><td class="num">${x.valor != null ? brl(x.valor) : "—"}</td></tr>`).join("")}</tbody>
  </table></div>`;
}
function medPmLigarFicha(p, podeOp){
  $("btn-med-pm-voltar")?.addEventListener("click", medPmVoltar);
  document.querySelectorAll("#med-pm-notebook button").forEach(b => b.addEventListener("click", () => medPmAtivarTab(b.dataset.tab)));
  document.querySelectorAll("#med-pm-ficha [data-pm-tab]").forEach(b => b.addEventListener("click", () => medPmAtivarTab(b.dataset.pmTab)));
  document.querySelectorAll("#med-pm-ficha [data-pm-med]").forEach(tr => tr.addEventListener("click", (e) => {
    if(e.target.closest("a, button")) return;
    if(tr.dataset.pmMed){ $("med-pm-ficha").style.display = "none"; abrirMedicao(tr.dataset.pmMed); }
  }));
  if(!podeOp) return;
  $("btn-med-pm-salvar")?.addEventListener("click", () => comBotaoTravado("btn-med-pm-salvar", () => medPmSalvar(p)));
  $("btn-med-pm-excluir")?.addEventListener("click", () => comBotaoTravado("btn-med-pm-excluir", () => medPmExcluir(p)));
  $("btn-med-pm-l-add")?.addEventListener("click", () => comBotaoTravado("btn-med-pm-l-add", () => medPmLancar(p)));
  document.querySelectorAll("#med-pm-ficha [data-pm-lanc-del]").forEach(b => b.addEventListener("click", () => medPmApagarLanc(p, b.dataset.pmLancDel)));
  $("btn-med-pm-c-add")?.addEventListener("click", () => comBotaoTravado("btn-med-pm-c-add", () => medPmLigarContrato(p)));
  $("med-pm-c-obra")?.addEventListener("change", () => {
    const t = (mapaObras || {})[$("med-pm-c-obra").value] || "";
    if(t && $("med-pm-c-numero") && !$("med-pm-c-numero").value) $("med-pm-c-numero").value = String(t).split(" — ")[0];
  });
  document.querySelectorAll("#med-pm-ficha [data-pm-ctr-del]").forEach(b => b.addEventListener("click", () => medPmDesligarContrato(p, b.dataset.pmCtrDel)));
  document.querySelectorAll("#med-pm-ficha [data-pm-ctr-pct]").forEach(b => b.addEventListener("click", () => medPmPctContrato(p, b.dataset.pmCtrPct)));
}
async function medPmRecarregar(p, aba){ _medPmRegistros = null; await medPmCarregar(true); await medPmAbrir(p.id, aba); }

/* Nova permuta: grava o mínimo e abre a ficha para completar */
async function medPmNova(){
  if(!medPmPodeOperar()) return;
  const nome = prompt("Cliente da permuta (como o financeiro chama, ex.: SAGA):");
  if(nome == null || !nome.trim()) return;
  const { data, error } = await sb.from("permutas").insert({ cliente_nome: nome.trim(), numero: "", instrumento_assinado: false }).select("id").single();
  if(error){ aviso("app-aviso", "Não foi possível criar a permuta: " + error.message, "erro"); return; }
  aviso("app-aviso", "Permuta criada. Complete o imóvel, o teto e os contratos.", "ok");
  _medPmRegistros = null;
  await medPmCarregar(true);
  await medPmAbrir(data.id);
}
async function medPmSalvar(p){
  const reg = {
    cliente_nome: ($("med-pm-cliente-nome")?.value || "").trim(),
    cliente_id: $("med-pm-cliente")?.value || null,
    sentido: $("med-pm-sentido")?.value || "recebemos_imovel",
    percentual_padrao: medPmNum($("med-pm-pct-padrao")?.value),
    imovel_descricao: ($("med-pm-imovel")?.value || "").trim() || null,
    imovel_identificado: $("med-pm-identificado")?.value === "true",
    valor_imovel: medPmNum($("med-pm-teto")?.value),
    valor_imovel_total: medPmNum($("med-pm-total")?.value),
    executar_ate: $("med-pm-prazo")?.value || null,
    instrumento_tipo: ($("med-pm-instr")?.value || "").trim() || null,
    instrumento_data: $("med-pm-instr-data")?.value || null,
    instrumento_assinado: $("med-pm-assinado")?.value === "true",
    observacoes: ($("med-pm-obs")?.value || "").trim() || null
  };
  if(!reg.cliente_nome){ aviso("app-aviso", "Informe o cliente da permuta.", "erro"); return; }
  if(reg.percentual_padrao != null && (reg.percentual_padrao < 0 || reg.percentual_padrao > 100)){ aviso("app-aviso", "% padrão entre 0 e 100.", "erro"); return; }
  const { error } = await sb.from("permutas").update(reg).eq("id", p.id);
  if(error){ aviso("app-aviso", "Não foi possível salvar a permuta: " + error.message, "erro"); return; }
  aviso("app-aviso", "Permuta salva. O status é recalculado no banco.", "ok");
  await medPmRecarregar(p, "geral");
}
async function medPmExcluir(p){
  if(!confirm(`Excluir a permuta ${p.numero}? Só vale para lançamento errado (sem contratos nem lançamentos).`)) return;
  const { error } = await sb.from("permutas").delete().eq("id", p.id);
  if(error){ aviso("app-aviso", "Não foi possível excluir: " + error.message, "erro"); return; }
  aviso("app-aviso", `Permuta ${p.numero} excluída.`, "ok");
  _medPmRegistros = null;
  medPmVoltar();
}
async function medPmLancar(p){
  const credito = medPmNum($("med-pm-l-credito")?.value);
  if(!(credito >= 0) || credito == null){ aviso("app-aviso", "Informe o crédito de permuta do lançamento (0 quando foi só em NF).", "erro"); return; }
  const reg = {
    permuta_id: p.id, cliente_id: p.cliente_id || null, origem: "manual",
    contrato_numero: ($("med-pm-l-contrato")?.value || "").trim() || null,
    obra_descricao: ($("med-pm-l-obra")?.value || "").trim() || null,
    medicao: ($("med-pm-l-medicao")?.value || "").trim() || null,
    data: $("med-pm-l-data")?.value || null,
    valor_medicao: medPmNum($("med-pm-l-valor")?.value),
    credito,
    nf_numero: ($("med-pm-l-nf")?.value || "").trim() || null,
    termo: ($("med-pm-l-termo")?.value || "").trim() || null
  };
  const { error } = await sb.from("permuta_lancamentos").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível lançar: " + error.message, "erro"); return; }
  aviso("app-aviso", "Lançamento histórico gravado.", "ok");
  await medPmRecarregar(p, "lancamentos");
}
async function medPmApagarLanc(p, id){
  const l = _medPmLanc.find(x => x.id === id);
  if(!l || !confirm(`Apagar o lançamento histórico de ${brl(l.credito)} (${l.contrato_numero || "sem contrato"} · ${l.medicao || "—"})?`)) return;
  const { error } = await sb.from("permuta_lancamentos").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível apagar: " + error.message, "erro"); return; }
  await medPmRecarregar(p, "lancamentos");
}
async function medPmLigarContrato(p){
  const obra_id = $("med-pm-c-obra")?.value || null;
  const contrato_numero = ($("med-pm-c-numero")?.value || "").trim();
  const percentual = medPmNum($("med-pm-c-pct")?.value);
  if(!contrato_numero){ aviso("app-aviso", "Informe o número do contrato.", "erro"); return; }
  if(percentual != null && (percentual < 0 || percentual > 100)){ aviso("app-aviso", "% entre 0 e 100.", "erro"); return; }
  const { error } = await sb.from("permuta_contratos").insert({ permuta_id: p.id, obra_id, contrato_numero, percentual });
  if(error){ aviso("app-aviso", "Não foi possível ligar o contrato: " + (/permuta_contratos_obra_uk|duplicate/i.test(error.message) ? "esta obra já está em outra permuta (ou o contrato já foi ligado)." : error.message), "erro"); return; }
  await medPmAplicarPctNasMedicoes(obra_id, percentual ?? p.percentual_padrao);
  aviso("app-aviso", "Contrato ligado.", "ok");
  await medPmRecarregar(p, "contratos");
}
/* Medições já lançadas da obra, sem %: recebem o % (o gatilho calcula o crédito e grava o recebimento em permuta) */
async function medPmAplicarPctNasMedicoes(obraId, pct){
  if(!obraId || pct == null) return;
  const { data } = await sb.from("medicoes").select("id").eq("obra_id", obraId).is("permuta_percentual", null);
  if(!data || !data.length) return;
  if(!confirm(`A obra tem ${data.length} medição(ões) sem % de permuta. Aplicar ${num(pct)}% a elas agora? (o crédito e o recebimento em permuta nascem no banco)`)) return;
  const { error } = await sb.from("medicoes").update({ permuta_percentual: pct }).eq("obra_id", obraId).is("permuta_percentual", null);
  if(error) aviso("app-aviso", "Contrato ligado, mas o % não foi aplicado às medições: " + error.message, "erro");
}
async function medPmDesligarContrato(p, id){
  const c = _medPmContratos.find(x => x.id === id);
  if(!c || !confirm(`Desligar o contrato ${c.contrato_numero} da permuta? As medições já lançadas mantêm o % gravado (mude na medição, se for o caso).`)) return;
  const { error } = await sb.from("permuta_contratos").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível desligar: " + error.message, "erro"); return; }
  await medPmRecarregar(p, "contratos");
}
async function medPmPctContrato(p, id){
  const c = _medPmContratos.find(x => x.id === id);
  if(!c) return;
  const v = prompt(`% em permuta do contrato ${c.contrato_numero} (vazio = padrão da permuta). Vale para as medições novas; as já lançadas mudam na própria medição.`, c.percentual ?? "");
  if(v === null) return;
  const pct = v.trim() === "" ? null : Number(v.replace(",", "."));
  if(pct != null && !(pct >= 0 && pct <= 100)){ aviso("app-aviso", "% entre 0 e 100.", "erro"); return; }
  const { error } = await sb.from("permuta_contratos").update({ percentual: pct }).eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível mudar o %: " + error.message, "erro"); return; }
  await medPmRecarregar(p, "contratos");
}

/* ---------- documentos (bucket privado permutas: <permuta_id>/<carimbo>-<nome>) ---------- */
async function medPmCarregarDocs(p, podeOp){
  const box = $("med-pm-docs");
  if(!box) return;
  const { data, error } = await sb.storage.from(MED_PM_BUCKET).list(p.id, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if(!_medPmFicha || _medPmFicha.id !== p.id) return;
  const arqs = error ? [] : (data || []).filter(f => f.name && !f.name.startsWith("."));
  const linhas = arqs.map(f => {
    const caminho = `${p.id}/${f.name}`, principal = caminho === p.documento_path;
    return `<tr>
      <td>${principal ? '<span class="tag verde" title="Instrumento da permuta">instrumento</span> ' : ""}<a href="#" data-pm-doc="${esc(caminho)}">${esc(f.name.replace(/^\d+-/, ""))}</a></td>
      <td class="meta">${f.created_at ? dataBR(String(f.created_at).slice(0, 10)) : "—"}</td>
      <td class="col-acao">${podeOp && !principal ? `<button type="button" class="btn-sec btn-sm" data-pm-doc-principal="${esc(caminho)}" title="Marcar como o instrumento da permuta">★</button>` : ""}</td>
    </tr>`;
  }).join("");
  box.innerHTML = `${error ? `<p class="vazio">Não foi possível listar os documentos (${esc(error.message)}).</p>` : (arqs.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Arquivo</th><th>Enviado em</th><th class="col-acao"></th></tr></thead><tbody>${linhas}</tbody></table></div>` : `<p class="vazio">Nenhum documento. Anexe o instrumento (contrato de adesão, SCP, CPCV, termo) em PDF.</p>`)}
    ${podeOp ? `<div class="form-acoes compacta" style="justify-content:flex-start;margin-top:10px;">
      <input type="file" id="med-pm-doc-arquivo" accept=".pdf,.jpg,.jpeg,.png" style="display:none;" />
      <button type="button" class="btn-sec" id="btn-med-pm-doc-enviar">📎 Anexar documento</button>
      <span class="meta">PDF, JPG ou PNG até 20 MB. O primeiro documento vira o instrumento da permuta.</span></div>` : ""}`;
  box.querySelectorAll("[data-pm-doc]").forEach(a => a.addEventListener("click", async (e) => {
    e.preventDefault();
    const r = await sb.storage.from(MED_PM_BUCKET).createSignedUrl(a.dataset.pmDoc, 120);
    if(r.error || !r.data?.signedUrl){ aviso("app-aviso", "Não foi possível abrir: " + (r.error?.message || "sem link"), "erro"); return; }
    window.open(r.data.signedUrl, "_blank", "noopener");
  }));
  box.querySelectorAll("[data-pm-doc-principal]").forEach(b => b.addEventListener("click", async () => {
    const { error: e2 } = await sb.from("permutas").update({ documento_path: b.dataset.pmDocPrincipal }).eq("id", p.id);
    if(e2){ aviso("app-aviso", "Não foi possível marcar: " + e2.message, "erro"); return; }
    await medPmRecarregar(p, "documentos");
  }));
  $("btn-med-pm-doc-enviar")?.addEventListener("click", () => $("med-pm-doc-arquivo")?.click());
  $("med-pm-doc-arquivo")?.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if(!file) return;
    try { await medPmEnviarDoc(p, file); aviso("app-aviso", "Documento anexado.", "ok"); await medPmRecarregar(p, "documentos"); }
    catch(err){ aviso("app-aviso", "Não foi possível anexar: " + (err.message || err), "erro"); }
  });
}
/* supabase-js ignora contentType quando o corpo é File: o MIME vem da extensão e o arquivo é reembalado em Blob */
async function medPmEnviarDoc(p, file){
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  const mime = MED_PM_MIME[ext];
  if(!mime) throw new Error("envie PDF, JPG ou PNG");
  if(file.size > 20 * 1024 * 1024) throw new Error("arquivo acima de 20 MB");
  const nome = String(file.name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
  const caminho = `${p.id}/${Date.now()}-${nome}`;
  const up = await sb.storage.from(MED_PM_BUCKET).upload(caminho, new Blob([file], { type: mime }), { cacheControl: "3600", contentType: mime, upsert: false });
  if(up.error) throw up.error;
  if(!p.documento_path){
    const { error } = await sb.from("permutas").update({ documento_path: caminho }).eq("id", p.id);
    if(error) throw error;
  }
}

/* ---------- medição: % e crédito de permuta (aba Geral, ao lado do líquido) ---------- */
function medPmMarca(m){
  const pct = Number(m.permuta_percentual) || 0, val = Number(m.permuta_valor) || 0;
  if(!(pct > 0 || val > 0)) return "";
  return ` <span class="tag ambar" title="Em permuta: crédito ${brl(val)} abatido no imóvel (fase 98)">permuta${pct ? " " + num(pct) + "%" : ""}</span>`;
}
function medPmCarregarFicha(med){
  const cP = $("campo-med-pm-pct"), cV = $("campo-med-pm-valor");
  const ver = medPmPodeVer();
  if(cP) cP.style.display = ver ? "" : "none";
  if(cV) cV.style.display = ver ? "" : "none";
  if(!ver) return;
  const pode = medPmPodeOperar();
  const iP = $("med-pm-pct"), iV = $("med-pm-valor");
  if(iP){ iP.value = med && med.permuta_percentual != null ? med.permuta_percentual : ""; iP.readOnly = !pode; }
  if(iV){
    iV.value = med && med.permuta_valor != null ? Number(med.permuta_valor).toFixed(2) : "";
    iV.dataset.manual = med && med.permuta_valor_manual ? "1" : "0";
    iV.readOnly = !pode;
    iV.title = med && med.permuta_valor_manual ? "Fixado à mão pelo financeiro (apague para voltar ao cálculo % × valor final)" : "Calculado: % de permuta × valor final. Digitar fixa o valor à mão.";
  }
}
function medPmRecalcular(valorFinal){
  const iP = $("med-pm-pct"), iV = $("med-pm-valor");
  if(!iP || !iV || iV.dataset.manual === "1") return;
  const pct = parseFloat(iP.value);
  iV.value = (isFinite(pct) && pct > 0) ? (Number(valorFinal || 0) * pct / 100).toFixed(2) : "";
}
/* Campos que vão no salvarMedicao: só para quem pode (o banco recusa os outros) */
function medPmLerCampos(){
  if(!medPmPodeVer() || !medPmPodeOperar()) return {};
  const iP = $("med-pm-pct"), iV = $("med-pm-valor");
  if(!iP || !iV) return {};
  const pct = iP.value === "" ? null : Number(iP.value);
  const manual = iV.dataset.manual === "1" && iV.value !== "";
  const out = {};
  if(medEditId || pct != null) out.permuta_percentual = pct;   // medição nova sem %: o banco herda o da obra
  out.permuta_valor_manual = manual;
  if(manual) out.permuta_valor = Number(iV.value);
  return out;
}
/* Medição nova: sugere o % da permuta da obra (permuta_contratos) quando o campo está vazio */
async function medPmSugerirPctDaObra(obraId){
  const iP = $("med-pm-pct");
  if(!iP || !obraId || medEditId || iP.value !== "" || !medPmPodeVer()) return;
  const { data } = await sb.from("permuta_contratos").select("percentual,permuta:permutas(percentual_padrao,numero)").eq("obra_id", obraId).maybeSingle();
  if(!data) return;
  const pct = data.percentual ?? (data.permuta && data.permuta.percentual_padrao);
  if(pct != null && iP.value === ""){
    iP.value = pct;
    if($("med-pm-valor")) $("med-pm-valor").dataset.manual = "0";
    recalcularTotaisMedicao();
    aviso("app-aviso", `Obra em permuta (${data.permuta ? data.permuta.numero : ""}): ${num(pct)}% de cada medição vira crédito do imóvel.`, "aviso");
  }
}

/* ---------- Patrimônio (fase 97): saldo a executar do imóvel em permuta ---------- */
async function pmPatCarregar(){
  _medPmPatMapa = new Map();
  if(!medPmPodeVer()) return;
  const { data, error } = await sb.from("vw_permutas").select("id,numero,patrimonio_bem_id,saldo,credito,valor_imovel,status").not("patrimonio_bem_id", "is", null);
  if(error) return;
  (data || []).forEach(p => _medPmPatMapa.set(p.patrimonio_bem_id, p));
}
function pmPatChip(bemId){
  const p = _medPmPatMapa && _medPmPatMapa.get(bemId);
  if(!p) return "";
  if(p.status === "quitada" || p.status === "excedida")
    return `<div class="meta" title="Permuta ${esc(p.numero)} quitada: passar a titularidade para Empresa">${esc(p.numero)} · ${p.status === "excedida" ? "crédito acima do imóvel" : "quitada"}</div>`;
  return `<div class="meta" title="Permuta ${esc(p.numero)}: teto ${brl(p.valor_imovel)}, crédito ${brl(p.credito)}">${esc(p.numero)} · saldo a executar ${brl(p.saldo)}</div>`;
}

/* ---------- ligações da fase 98 ---------- */
function ligarMedPermutas(){
  const btnV = document.querySelector('#med-painel .serv-view-btn[data-view="permutas"]');
  const mostrarBotao = () => { if(btnV) btnV.style.display = medPmPodeVer() ? "" : "none"; };
  mostrarBotao();
  document.querySelector('nav button[data-secao="medicoes"]')?.addEventListener("click", () => {
    mostrarBotao();
    if($("med-pm-ficha") && $("med-pm-ficha").style.display !== "none") medPmVoltar();
  });
  ["med-pm-busca", "med-pm-f-status", "med-pm-f-pend"].forEach(id => {
    const el = $(id);
    if(!el) return;
    el.addEventListener(id === "med-pm-busca" ? "input" : "change", id === "med-pm-busca" ? debounce(renderMedicoes) : renderMedicoes);
  });
  $("btn-med-pm-nova")?.addEventListener("click", () => comBotaoTravado("btn-med-pm-nova", medPmNova));
  $("btn-med-pm-exportar")?.addEventListener("click", medPmExportar);
  $("btn-med-pm-atualizar")?.addEventListener("click", () => comBotaoTravado("btn-med-pm-atualizar", async () => { await medPmCarregar(true); renderMedicoes(); }));
  $("med-conteudo")?.addEventListener("click", (e) => {
    if(_medView !== "permutas") return;
    if(e.target.closest("a, button")) return;
    const r = e.target.closest("[data-pm]");
    if(r) medPmAbrir(r.dataset.pm);
  });
  $("med-indicadores")?.addEventListener("click", (e) => {
    const c = e.target.closest("[data-pm-pend]");
    if(!c) return;
    const f = $("med-pm-f-pend");
    if(f){ f.value = f.value === c.dataset.pmPend ? "" : c.dataset.pmPend; renderMedicoes(); }
  });
  // medição: % recalcula o crédito; digitar o crédito fixa à mão; apagar volta ao automático
  $("med-pm-pct")?.addEventListener("input", () => { if($("med-pm-valor")) $("med-pm-valor").dataset.manual = "0"; recalcularTotaisMedicao(); });
  $("med-pm-valor")?.addEventListener("input", () => { const v = $("med-pm-valor"); v.dataset.manual = v.value === "" ? "0" : "1"; if(v.value === "") recalcularTotaisMedicao(); });
  $("med-obra")?.addEventListener("change", () => medPmSugerirPctDaObra($("med-obra").value));
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarMedPermutas);
} else {
  ligarMedPermutas();
}

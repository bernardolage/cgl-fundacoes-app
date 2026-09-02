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
    .select("id,numero,obra_id,data_medicao,percentual,status,valor_medido,periodo_inicio,periodo_fim,descricao,observacoes")
    .order("data_medicao", { ascending: false });
  _medRegistros = error ? [] : (data || []);
  renderMedicoes();
}

/* ---------- Filtros ---------- */
function medFiltradas(){
  const termo = ($("med-busca")?.value || "").trim().toLowerCase();
  const fStatus = $("med-f-status")?.value || "";
  const fObra = $("med-f-obra")?.value || "";
  return _medRegistros.filter(m => {
    if(fStatus && m.status !== fStatus) return false;
    if(fObra && m.obra_id !== fObra) return false;
    if(termo){
      const alvo = `${m.numero||""} ${mapaObras[m.obra_id]||""}`.toLowerCase();
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

function renderMedLista(dados){
  const cont = $("med-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhuma medição encontrada.</p>`;
    return;
  }
  const linhas = dados.map(m => `<tr class="linha-clicavel" data-id="${esc(m.id)}">
    <td>${esc(m.numero)}</td>
    <td>${esc(mapaObras[m.obra_id] || "—")}</td>
    <td>${dataBR(m.data_medicao)}</td>
    <td>${num(m.percentual)}%</td>
    <td>${tagStatus("medicao", m.status)}</td>
    <td class="num">${brl(m.valor_medido)}</td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nº</th><th>Obra</th><th>Data</th><th>%</th><th>Status</th><th class="num">Valor medido</th>
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
        <div class="serv-kan-card-nome">${esc(m.numero)} · ${esc(mapaObras[m.obra_id]||"—")}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${num(m.percentual)}% · ${dataBR(m.data_medicao)}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span></span>
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
      .select("id,ordem,descricao,variante_id,execucao_id,orcamento_item_id,quantidade,unidade,valor_unitario,valor_total,preco_origem,preco_origem_obs")
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
  $("med-numero").value = data.numero || "";
  $("med-obra").value = data.obra_id || "";
  if($("med-tipo")) $("med-tipo").value = data.tipo_medicao || "quinzenal";
  if($("med-multiplicador")) $("med-multiplicador").value = data.multiplicador_pct ?? 100;
  ajustarUISinalContratual();
  $("med-status").value = data.status || "rascunho";
  $("med-data").value = data.data_medicao || "";
  $("med-inicio").value = data.periodo_inicio || "";
  $("med-fim").value = data.periodo_fim || "";
  $("med-percentual").value = data.percentual || 0;
  if($("med-subtotal"))      $("med-subtotal").value = data.subtotal ?? 0;
  if($("med-desc-sinal"))    $("med-desc-sinal").value = data.desconto_sinal ?? 0;
  if($("med-desc-sinal-obs"))$("med-desc-sinal-obs").value = data.desconto_descricao || "";
  if($("med-acrescimo"))     $("med-acrescimo").value = data.acrescimo ?? 0;
  if($("med-acrescimo-obs")) $("med-acrescimo-obs").value = data.acrescimo_descricao || "";
  if($("med-valor-final"))   $("med-valor-final").value = data.valor_final ?? 0;
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
  $("med-ficha-obra-chip").textContent = mapaObras[med.obra_id] || "—";
  $("med-ficha-status-chip").innerHTML = tagStatus("medicao", med.status);
  if($("med-ficha-subtotal-chip")) $("med-ficha-subtotal-chip").textContent = brl(med.subtotal||0);
  $("med-ficha-valor-chip").textContent = brl(med.valor_final || med.valor_medido || 0);
  $("med-ficha-titulo").textContent = med.numero ? `Medição ${med.numero}` : "Nova medição";

  atualizarStatusbarMed(med.status);
  ativarTabMed("geral");
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
    return `<tr data-idx="${idx}">
      <td><strong>${idx+1}</strong></td>
      <td><input type="text" class="mi-desc" value="${esc(it.descricao||"")}" style="min-width:220px;" placeholder="ex.: Estaca Ø400 18-24m" /></td>
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

function recalcularTotaisMedicao(){
  const subtotal = _medItens.reduce((s, it) => s + (Number(it.valor_total) || 0), 0);
  const descSinal = parseFloat($("med-desc-sinal")?.value)   || 0;
  const acresc    = parseFloat($("med-acrescimo")?.value)    || 0;
  const mult      = parseFloat($("med-multiplicador")?.value);
  const multiplicador = (isFinite(mult) && mult > 0) ? mult : 100;
  const valorFinal = ((subtotal - descSinal + acresc) * multiplicador / 100);

  if($("med-subtotal"))      $("med-subtotal").value = subtotal.toFixed(2);
  if($("med-valor-final"))   $("med-valor-final").value = valorFinal.toFixed(2);
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
          preco_origem_obs: it.preco_origem_obs || null
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

    await html2pdf().set({
      margin:       [12, 12, 12, 12],
      filename:     nomeArq,
      image:        { type: "jpeg", quality: 0.95 },
      html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
      jsPDF:        { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak:    { mode: ["css","legacy"] }
    }).from(container.firstElementChild).save();

    document.body.removeChild(container);
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
        <div style="font-size:18px;font-weight:700;letter-spacing:1.5px;color:#1A2E44;">CGL FUNDAÇÕES</div>
        <div style="font-size:10px;margin-top:4px;color:#444;">RELATÓRIO DE MEDIÇÃO</div>
      </td>
      <td style="padding:5px 8px;border:1px solid #000;"><strong>RG 11.4 — IT 11.3</strong></td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #000;"><strong>Revisão</strong><br>01 — 03/06/2024</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #000;"><strong>Página</strong><br>1 de 1</td>
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
  ["med-busca","med-f-status","med-f-obra"].forEach(id => {
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

  // Aba Itens: sugerir, compor sinal e adicionar manual
  $("btn-med-sugerir")?.addEventListener("click", sugerirItensMedicao);
  $("btn-med-compor-sinal")?.addEventListener("click", comporMedicaoSinal);
  $("btn-med-add-item")?.addEventListener("click", adicionarItemMedicaoManual);

  // Tipo da medição → ajusta UI do Sinal Contratual
  $("med-tipo")?.addEventListener("change", ajustarUISinalContratual);

  // Obra → sugere número automático (só pra nova medição com número vazio)
  $("med-obra")?.addEventListener("change", sugerirNumeroMedicao);

  // Aba Resumo: recalcula valor final quando desc/acresc/multiplicador mudam
  ["med-desc-sinal","med-acrescimo","med-multiplicador"].forEach(id => {
    $(id)?.addEventListener("input", recalcularTotaisMedicao);
  });

  // Cálculos automáticos de Hora Extra e Faturamento Mínimo
  $("btn-med-calc-he")?.addEventListener("click", calcularHoraExtraMedicao);
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

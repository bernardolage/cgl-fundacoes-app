/* ====================================================================
   VENDA DE BENS (fase 96, 20/10/2026) — prefixo vb-
   Equipamento ou veículo vendido: comprador (livre ou cliente da casa), valor, entrada, plano de parcelas,
   contrato em PDF (bucket privado vendas-bens), NF, checklist de transferência do veículo e o saldo a receber.
   Tabelas vendas_bens / vendas_bens_parcelas; views vw_vendas_bens e vw_vendas_parcelas (status do dia, saldo,
   próxima parcela, dias de atraso, encargo sugerido, resultado contra o valor de aquisição, pendências).
   Tudo que é regra nasce no banco (migration 20261020_fase96b): numeração VB-AAAA-NNNNN, parcelas do plano, status
   da venda, baixa do bem (status vendido, ativo = false, localização "vendido", plano preventivo desligado), volta do
   bem no cancelamento. O front só desenha e grava o que a pessoa digitou.
   Onde aparece:
     - ficha do equipamento (js/equipamentos.js): botão "Registrar venda", etapa "Vendido" da statusbar, aba Venda;
     - Logística › veículo (js/frota.js): botão "Registrar venda" no modal do veículo; a venda abre no modal vb-ficha;
     - painel de Equipamentos, visão Vendas (filtros, indicadores, exportação .xlsx);
     - Sala de Comando (js/dashboard.js): KPI "A receber" = medições + vendas; alertas de parcela pelo vw_sc_*_fin;
     - Carteira (js/carteira.js): bloco "Bens vendidos no ano".
   Permissões (espelho das policies): registrar e editar = diretor, admin e financeiro; gestor de frota nos veículos e
   caminhões. Confirmar e estornar recebimento = diretor, admin e financeiro. Valores: quem lê financeiro
   (podeVerValorObra = pode_ler_financeiro no banco) e o gestor de frota nos veículos; os demais veem só "vendido".
   ==================================================================== */
const VB_STATUS = {
  em_andamento: { label: "Em andamento", cor: "azul" },
  atrasada:     { label: "Atrasada",     cor: "vermelho" },
  quitada:      { label: "Quitada",      cor: "verde" },
  cancelada:    { label: "Cancelada",    cor: "cinza" }
};
const VB_PARC_STATUS = {
  aberta:    { label: "Aberta",    cor: "cinza" },
  parcial:   { label: "Parcial",   cor: "azul" },
  atrasada:  { label: "Atrasada",  cor: "vermelho" },
  recebida:  { label: "Recebida",  cor: "verde" },
  cancelada: { label: "Cancelada", cor: "cinza" }
};
const VB_FORMAS_REC = { transferencia: "Transferência", pix: "Pix", boleto: "Boleto", dinheiro: "Dinheiro", cheque: "Cheque", outro: "Outro" };
const VB_PERIOD = { mensal: "Mensal", quinzenal: "Quinzenal", personalizada: "A cada N dias" };
const VB_PEND = {
  sem_comprador: "sem comprador", sem_valor: "sem valor", sem_data: "sem data", sem_parcelas: "sem parcelas",
  sem_contrato: "sem contrato", sem_transferencia: "sem comunicação de venda / CRV", sem_valor_aquisicao: "sem valor de aquisição"
};
const VB_TIPO_LBL = { perfuratriz: "Perfuratriz", bate_estaca: "Bate-estaca", escavadeira: "Escavadeira", retroescavadeira: "Retroescavadeira", guindaste: "Guindaste",
  caminhao: "Caminhão", compressor: "Compressor", gerador: "Gerador", bomba: "Bomba", ferramenta: "Ferramenta", veiculo: "Veículo", outro: "Outro" };
const VB_BUCKET = "vendas-bens";
const VB_VEICULO = ["veiculo", "caminhao"];
const VB_MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const VB_CAMPOS_PLANO = ["valor_venda", "valor_entrada", "forma", "n_parcelas", "primeiro_vencimento", "periodicidade", "intervalo_dias"];

let _vbVendas = null;        // { soStatus, lista, erro } do painel (null = recarregar)
let _vbPreset = null;        // filtro pedido pela Sala de Comando antes do painel desenhar
let _vbAlvo = null;          // { equipId, contId } onde a aba Venda está desenhada
let _vbVendaAtual = null;    // venda aberta (vw_vendas_bens)
let _vbParcelas = [];        // parcelas da venda aberta (vw_vendas_parcelas)
let _vbEquipModal = null;    // bem do modal "Registrar venda"
let _vbEditVenda = null;     // venda em edição no modal (null = nova)
let _vbParcAtual = null;     // parcela do modal { modo: receber | editar | nova, p }
let _vbClientes = null;      // clientes para o comprador da casa

/* ---------- permissões (espelho das policies da 96b) ---------- */
function vbEhVeiculo(e){ return !!e && VB_VEICULO.includes(e.tipo); }
function vbCargo(){ return (typeof usuarioAtual !== "undefined" && usuarioAtual && usuarioAtual.cargo) || ""; }
function vbSoLeitura(){ return typeof ehSomenteLeitura === "function" && ehSomenteLeitura(); }
function vbPodeRegistrar(e){
  if(!vbCargo() || vbSoLeitura()) return false;
  return ["diretor", "admin", "financeiro"].includes(vbCargo()) || (vbCargo() === "gestor_frota" && vbEhVeiculo(e));
}
function vbPodeReceber(){ return !!vbCargo() && !vbSoLeitura() && ["diretor", "admin", "financeiro"].includes(vbCargo()); }
/* valores da venda: pode_ler_financeiro() no banco (podeVerValorObra no front) e o gestor de frota nos veículos.
   e = null: "lê alguma venda?" (gestor de frota lê as dos veículos) */
function vbPodeLer(e){
  if(!vbCargo()) return false;
  if(typeof podeVerValorObra === "function" && podeVerValorObra()) return true;
  return vbCargo() === "gestor_frota" && (e == null || vbEhVeiculo(e));
}

/* ---------- utilidades ---------- */
const vbR2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
function vbTag(st){ const o = VB_STATUS[st] || { label: st || "—", cor: "cinza" }; return `<span class="tag ${o.cor}">${esc(o.label)}</span>`; }
function vbTagParc(st){ const o = VB_PARC_STATUS[st] || { label: st || "—", cor: "cinza" }; return `<span class="tag ${o.cor}">${esc(o.label)}</span>`; }
function vbPendTags(v, so){
  const lst = (v.pendencias || []).filter(p => !so || so.includes(p));
  return lst.map(p => `<span class="tag ${p === "sem_valor_aquisicao" || p === "sem_contrato" ? "cinza" : "ambar"}" title="pendência da venda">${esc(VB_PEND[p] || p)}</span>`).join(" ");
}
function vbBemTxt(v){ return `${v.codigo || ""}${v.equipamento_nome ? " · " + v.equipamento_nome : ""}${v.placa ? " · " + v.placa : ""}`; }
function vbPlanoTxt(v){
  if(v.forma === "parcelado") return `${v.valor_entrada > 0 ? "entrada + " : ""}${v.n_parcelas || "?"} parcela(s) ${v.periodicidade === "personalizada" ? `a cada ${v.intervalo_dias || "?"} dias` : (VB_PERIOD[v.periodicidade] || "").toLowerCase()}`;
  return v.valor_entrada > 0 ? "entrada + saldo à vista" : "à vista";
}
function vbAvisoModal(id, msg, tipo){
  aviso("app-aviso", msg, tipo);
  const el = $(id); if(!el) return;
  el.textContent = msg; el.className = "aviso " + (tipo === "aviso" ? "atencao" : tipo);
  if(tipo === "ok") setTimeout(() => { el.className = "aviso"; el.textContent = ""; }, 4000);
}
function vbLimparAviso(id){ const el = $(id); if(el){ el.className = "aviso"; el.textContent = ""; } }
function vbMsgErro(error){
  const m = String(error?.message || error || "");
  if(/vendas_bens_equipamento_ativa_uk/.test(m)) return "Este bem já tem uma venda registrada.";
  return m;
}

/* ====================================================================
   Painel de Equipamentos › visão Vendas
   ==================================================================== */
async function vbCarregarVendas(forcar){
  if(_vbVendas && !forcar) return _vbVendas;
  if(!vbPodeLer(null)){
    // quem não lê financeiro vê só que o bem foi vendido (equipamentos é legível por todos)
    const { data, error } = await sb.from("equipamentos").select("id,codigo,nome,tipo,placa,baixa_em,status").eq("status", "vendido").order("codigo");
    _vbVendas = { soStatus: true, lista: data || [], erro: error };
    return _vbVendas;
  }
  const { data, error } = await sb.from("vw_vendas_bens").select("*").order("data_venda", { ascending: false, nullsFirst: true }).limit(2000);
  _vbVendas = { soStatus: false, lista: data || [], erro: error };
  return _vbVendas;
}
function vbPreencherFiltros(lista){
  const manter = (sel, html) => { if(!sel) return; const v = sel.value; sel.innerHTML = html; if([...sel.options].some(o => o.value === v)) sel.value = v; };
  const anos = [...new Set(lista.map(v => v.ano).filter(Boolean))].sort((a, b) => b - a);
  const semData = lista.some(v => !v.data_venda);
  manter($("vb-f-ano"), `<option value="">Todos os anos</option>${anos.map(a => `<option value="${a}">${a}</option>`).join("")}${semData ? `<option value="sem_data">Sem data (a completar)</option>` : ""}`);
  manter($("vb-f-status"), `<option value="">Status (menos canceladas)</option><option value="abertas">Em aberto (a receber)</option>${Object.entries(VB_STATUS).map(([k, o]) => `<option value="${k}">${esc(o.label)}</option>`).join("")}`);
  const comps = [...new Set(lista.map(v => v.comprador).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  manter($("vb-f-comprador"), `<option value="">Todos os compradores</option>${comps.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}`);
  manter($("vb-f-pend"), `<option value="">Pendência</option>${Object.entries(VB_PEND).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}`);
}
function vbAplicarPreset(){
  if(!_vbPreset) return;
  const p = _vbPreset; _vbPreset = null;
  const set = (id, v) => { const el = $(id); if(el) el.value = v || ""; };
  set("vb-f-status", p.status); set("vb-f-pend", p.pend); set("vb-f-ano", p.ano); set("vb-f-comprador", ""); set("vb-busca", p.busca);
}
function vbFiltradas(lista){
  const ano = $("vb-f-ano")?.value || "", st = $("vb-f-status")?.value || "", comp = $("vb-f-comprador")?.value || "", pend = $("vb-f-pend")?.value || "";
  const q = ($("vb-busca")?.value || "").trim().toLowerCase();
  return lista.filter(v => {
    if(ano === "sem_data"){ if(v.data_venda) return false; }
    else if(ano && String(v.ano || "") !== ano) return false;
    if(st === "abertas"){ if(["quitada", "cancelada"].includes(v.status)) return false; }
    else if(st){ if(v.status !== st) return false; }
    else if(v.status === "cancelada") return false;   // canceladas só pelo filtro de status
    if(comp && (v.comprador || "") !== comp) return false;
    if(pend && !(v.pendencias || []).includes(pend)) return false;
    if(q){
      const alvo = [v.numero, v.codigo, v.equipamento_nome, v.placa, v.marca, v.modelo, v.comprador, v.comprador_cpf_cnpj, v.nf_numero, v.observacoes].filter(Boolean).join(" ").toLowerCase();
      if(!alvo.includes(q)) return false;
    }
    return true;
  });
}
function vbRenderIndicadores(lista){
  const el = $("vb-indicadores"); if(!el) return;
  // fase 99b (decisão 4): Vendido / A receber / Vencido são somatórios financeiros: só quem vê KPI (diretor, admin,
  // financeiro, auditor); quem lê o valor de cada venda (engenharia, comercial, gestor de frota) segue vendo na lista
  if(typeof podeVerKpiFinanceiro === "function" && !podeVerKpiFinanceiro(() => true)){ el.innerHTML = ""; el.style.display = "none"; return; }
  const anoSel = $("vb-f-ano")?.value;
  const ano = /^\d{4}$/.test(anoSel || "") ? Number(anoSel) : new Date().getFullYear();
  const vivas = lista.filter(v => v.status !== "cancelada");
  const doAno = vivas.filter(v => Number(v.ano) === ano);
  const abertas = vivas.filter(v => v.status !== "quitada");
  const venc = vivas.filter(v => Number(v.valor_vencido) > 0.009);
  const quit = vivas.filter(v => v.status === "quitada");
  const soma = (l, k) => l.reduce((s, v) => s + (Number(v[k]) || 0), 0);
  const st = $("vb-f-status")?.value || "";
  el.innerHTML = `
    <div class="ind ind-click${anoSel === String(ano) ? " ativo" : ""}" data-vb-kpi="ano" data-ano="${ano}" title="Valor das vendas com data em ${ano} (canceladas fora). Clique para filtrar o ano."><div class="num">${brl(soma(doAno, "valor_venda"))}</div><div class="rot">Vendido em ${ano} · ${doAno.length} bem(ns)</div></div>
    <div class="ind ind-click${st === "abertas" ? " ativo" : ""}" data-vb-kpi="abertas" title="Valor da venda menos o recebido, nas vendas em andamento e atrasadas. Clique para filtrar."><div class="num">${brl(soma(abertas, "saldo"))}</div><div class="rot">A receber · ${abertas.length} venda(s)</div></div>
    <div class="ind ind-click${st === "atrasada" ? " ativo" : ""}" data-vb-kpi="atrasada" title="Parcelas com vencimento passado e sem recebimento completo. Clique para filtrar."><div class="num" style="color:var(--perigo);">${brl(soma(venc, "valor_vencido"))}</div><div class="rot">Vencido · ${venc.length} venda(s)</div></div>
    <div class="ind ind-click${st === "quitada" ? " ativo" : ""}" data-vb-kpi="quitada" title="Vendas com o valor inteiro recebido. Clique para filtrar."><div class="num" style="color:var(--sucesso);">${quit.length}</div><div class="rot">Quitadas · ${quit.filter(v => Number(v.ano) === ano).length} em ${ano}</div></div>`;
}
async function vbRenderPainel(){
  const cont = $("eqp-conteudo"); if(!cont) return;
  if(!_vbVendas) cont.innerHTML = `<p class="vazio">Carregando vendas…</p>`;
  const r = await vbCarregarVendas(false);
  if(typeof _eqpView !== "undefined" && _eqpView !== "vendas") return;   // trocou de visão enquanto carregava
  if(r.erro){ cont.innerHTML = `<p class="vazio">Erro ao carregar as vendas: ${esc(r.erro.message)}</p>`; return; }
  const ehStatus = r.soStatus;
  ["vb-f-status", "vb-f-comprador", "vb-f-pend", "btn-vb-exportar"].forEach(id => { const el = $(id); if(el) el.style.display = ehStatus ? "none" : ""; });
  const ind = $("vb-indicadores"); if(ind) ind.style.display = ehStatus ? "none" : "";
  if(ehStatus){
    const ano = $("vb-f-ano"); if(ano) ano.style.display = "none";
    const q = ($("vb-busca")?.value || "").trim().toLowerCase();
    const lista = r.lista.filter(e => !q || `${e.codigo} ${e.nome || ""} ${e.placa || ""}`.toLowerCase().includes(q));
    if($("eqp-contador")) $("eqp-contador").textContent = `${lista.length} vendido(s)`;
    cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">Bens vendidos. Comprador, valores e parcelas ficam com o financeiro.</p>` + (lista.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>TAG</th><th>Bem</th><th>Tipo</th><th>Placa</th><th>Vendido em</th></tr></thead>
      <tbody>${lista.map(e => `<tr class="${vbEhVeiculo(e) ? "" : "linha-clicavel"}" data-vb-eq="${esc(e.id)}"><td><strong>${esc(e.codigo)}</strong></td><td>${esc(e.nome || "")}</td>
        <td>${esc(VB_TIPO_LBL[e.tipo] || e.tipo)}</td><td>${esc(e.placa || "—")}</td><td>${dataBR(e.baixa_em)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="vazio">Nenhum bem vendido.</p>`);
    return;
  }
  vbPreencherFiltros(r.lista);
  vbAplicarPreset();
  const lista = vbFiltradas(r.lista);
  vbRenderIndicadores(r.lista);
  if($("eqp-contador")) $("eqp-contador").textContent = `${lista.length} de ${r.lista.filter(v => v.status !== "cancelada").length}`;
  if(!lista.length){ cont.innerHTML = `<p class="vazio">${r.lista.length ? "Nenhuma venda com esses filtros." : "Nenhuma venda registrada. Na ficha do bem, use \"Registrar venda\"."}</p>`; return; }
  const tot = { valor: 0, rec: 0, saldo: 0, venc: 0 };
  lista.forEach(v => { tot.valor += Number(v.valor_venda) || 0; tot.rec += Number(v.recebido) || 0; tot.saldo += Number(v.saldo) || 0; tot.venc += Number(v.valor_vencido) || 0; });
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Venda</th><th>Data</th><th>Bem</th><th>Comprador</th><th class="num">Valor</th><th class="num">Recebido</th><th class="num">Saldo</th><th>Próx. vencimento</th><th class="num">Vencido</th><th>Status</th><th class="num" title="Valor da venda − valor de aquisição">Resultado</th><th>Pendências</th></tr></thead>
    <tbody>${lista.map(v => `<tr class="linha-clicavel" data-vb-venda="${esc(v.id)}">
      <td style="white-space:nowrap;"><strong>${esc(v.numero)}</strong>${v.origem === "planilha" ? '<div class="meta" title="carga da planilha de avaliação">carga</div>' : ""}</td>
      <td>${dataBR(v.data_venda)}</td>
      <td>${esc(vbBemTxt(v))}<div class="meta">${esc(VB_TIPO_LBL[v.tipo] || v.tipo || "")}</div></td>
      <td>${esc(v.comprador || "—")}</td>
      <td class="num">${v.valor_venda != null ? brl(v.valor_venda) : "—"}</td>
      <td class="num">${brl(v.recebido)}</td>
      <td class="num">${v.saldo != null ? brl(v.saldo) : "—"}</td>
      <td>${v.proximo_vencimento ? dataBR(v.proximo_vencimento) : "—"}</td>
      <td class="num">${Number(v.valor_vencido) > 0.009 ? `<span class="txt-perigo">${brl(v.valor_vencido)}</span> <span class="meta">${v.dias_atraso} d</span>` : "—"}</td>
      <td>${vbTag(v.status)}</td>
      <td class="num">${v.resultado != null ? `<span class="${v.resultado < 0 ? "txt-perigo" : ""}">${brl(v.resultado)}</span>` : '<span class="meta" title="Informe o valor de aquisição do bem">sem aquisição</span>'}</td>
      <td>${vbPendTags(v, ["sem_comprador", "sem_valor", "sem_data", "sem_parcelas", "sem_contrato", "sem_transferencia"]) || '<span class="meta">—</span>'}</td>
    </tr>`).join("")}</tbody>
    <tfoot><tr><th colspan="4">Total (${lista.length})</th><th class="num">${brl(tot.valor)}</th><th class="num">${brl(tot.rec)}</th><th class="num">${brl(tot.saldo)}</th><th></th><th class="num">${brl(tot.venc)}</th><th colspan="3"></th></tr></tfoot>
  </table></div>`;
}
/* Exportação .xlsx da visão (vendas filtradas + parcelas delas) */
async function vbExportar(){
  const r = await vbCarregarVendas(false);
  if(r.soStatus || typeof XLSX === "undefined"){ aviso("app-aviso", "Exportação indisponível.", "erro"); return; }
  const lista = vbFiltradas(r.lista);
  if(!lista.length){ aviso("app-aviso", "Nada para exportar com esses filtros.", "erro"); return; }
  const ids = lista.map(v => v.id);
  const parcelas = [];
  for(let i = 0; i < ids.length; i += 100){
    const { data, error } = await sb.from("vw_vendas_parcelas").select("*").in("venda_id", ids.slice(i, i + 100)).order("venda_numero").order("numero");
    if(error){ aviso("app-aviso", "Não foi possível ler as parcelas: " + error.message, "erro"); return; }
    parcelas.push(...(data || []));
  }
  const vendas = lista.map(v => ({
    "Venda": v.numero, "Data da venda": v.data_venda || "", "TAG": v.codigo, "Bem": v.equipamento_nome || "", "Tipo": VB_TIPO_LBL[v.tipo] || v.tipo, "Placa": v.placa || "",
    "Comprador": v.comprador || "", "CPF/CNPJ": v.comprador_cpf_cnpj || "", "Contato": v.comprador_contato || "",
    "Valor da venda": v.valor_venda, "Entrada": v.valor_entrada, "Forma": v.forma === "parcelado" ? "Parcelado" : "À vista", "Nº de parcelas": v.n_parcelas,
    "Recebido": v.recebido, "Juros/multa recebidos": v.encargos_recebidos, "Saldo": v.saldo, "Vencido": v.valor_vencido, "Dias de atraso": v.dias_atraso,
    "Próximo vencimento": v.proximo_vencimento || "", "Status": VB_STATUS[v.status]?.label || v.status,
    "Valor de aquisição": v.valor_aquisicao, "Resultado": v.resultado, "NF": v.nf_numero || "", "Data da NF": v.nf_data || "",
    "Contrato anexado": v.contrato_path ? "sim" : "não", "Transferência concluída": v.eh_veiculo ? (v.transferencia_concluida ? "sim" : "não") : "",
    "Pendências": (v.pendencias || []).map(p => VB_PEND[p] || p).join(", "), "Observações": v.observacoes || ""
  }));
  const parc = parcelas.map(p => ({
    "Venda": p.venda_numero, "TAG": p.codigo, "Comprador": p.comprador || "", "Nº": p.numero, "Descrição": p.descricao || "", "Vencimento": p.vencimento,
    "Valor": p.valor, "Recebido": p.valor_recebido, "Juros/multa": p.encargos, "Saldo": p.saldo, "Recebido em": p.recebido_em || "",
    "Forma": VB_FORMAS_REC[p.forma_recebimento] || p.forma_recebimento || "", "Banco": p.banco || "", "Status": VB_PARC_STATUS[p.status]?.label || p.status,
    "Dias de atraso": p.dias_atraso, "Encargo sugerido": p.encargo_sugerido, "Observação": p.observacao || ""
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vendas), "Vendas");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(parc.length ? parc : [{ "Venda": "sem parcelas" }]), "Parcelas");
  XLSX.writeFile(wb, `vendas-de-bens-${hojeISO()}.xlsx`);
}
/* Sala de Comando / Para regularizar → painel de Equipamentos na visão Vendas, já filtrado */
function vbAbrirPainel(preset){
  _vbPreset = preset || {};
  _vbVendas = null;
  if(typeof _eqpView === "undefined") return;
  _eqpView = "vendas";
  if(!irParaSecao("equipamentos")) return;
  if(typeof mostrarPainelEquipamentos === "function") mostrarPainelEquipamentos();
}
async function vbAbrirVendaPorId(id){
  const { data, error } = await sb.from("vw_vendas_bens").select("id,equipamento_id,tipo,eh_veiculo").eq("id", id).maybeSingle();
  if(error || !data){ vbAbrirPainel({}); return; }
  vbAbrirVenda(data);
}
/* uma venda: máquina abre a ficha na aba Venda; veículo (sem ficha própria) abre o modal da venda */
async function vbAbrirVenda(v){
  if(v.eh_veiculo || VB_VEICULO.includes(v.tipo)){ await vbAbrirVendaDoBem(v.equipamento_id); return; }
  if(!irParaSecao("equipamentos") || typeof abrirEquipamento !== "function") return;
  await abrirEquipamento(v.equipamento_id);
  if(typeof ativarTabEquipamento === "function") ativarTabEquipamento("venda");
}

/* ====================================================================
   Aba Venda (ficha do equipamento) e modal da venda (veículo)
   ==================================================================== */
async function vbAbrirVendaDoBem(equipId){
  const { data: e, error } = await sb.from("equipamentos").select("id,codigo,nome,tipo,placa,status,ativo,venda_id,baixa_em,valor_aquisicao").eq("id", equipId).maybeSingle();
  if(error || !e){ aviso("app-aviso", "Bem não encontrado.", "erro"); return; }
  $("vb-ficha-titulo").textContent = `💰 Venda · ${e.codigo}${e.nome ? " · " + e.nome : ""}`;
  $("vb-ficha-modal").style.display = "flex";
  await vbRenderAba(e, "vb-ficha-conteudo");
}
function vbFecharFicha(){ $("vb-ficha-modal").style.display = "none"; if(_vbAlvo?.contId === "vb-ficha-conteudo") _vbAlvo = null; }

const VB_HIST_SELECT = "id,numero,data_venda,comprador,valor_venda,status,cancelada_em,cancelamento_motivo";
function vbHistHTML(hist){
  const canc = (hist || []).filter(h => h.status === "cancelada");
  if(!canc.length) return "";
  return `<h4 class="titulo-bloco" style="margin-top:16px;">Vendas canceladas deste bem</h4><div class="tabela-rola"><table>
    <thead><tr><th>Venda</th><th>Data</th><th>Comprador</th><th class="num">Valor</th><th>Cancelada em</th><th>Motivo</th></tr></thead>
    <tbody>${canc.map(h => `<tr><td>${esc(h.numero)}</td><td>${dataBR(h.data_venda)}</td><td>${esc(h.comprador || "—")}</td><td class="num">${h.valor_venda != null ? brl(h.valor_venda) : "—"}</td><td>${dataBR(h.cancelada_em)}</td><td>${esc(h.cancelamento_motivo || "")}</td></tr>`).join("")}</tbody></table></div>`;
}
async function vbRenderAba(e, contId){
  const cont = $(contId);
  if(!cont || !e?.id) return;
  _vbAlvo = { equipId: e.id, contId, equip: e };
  const vendido = e.status === "vendido" || !!e.venda_id;
  const podeReg = vbPodeRegistrar(e);
  if(!vendido){
    let hist = [];
    if(vbPodeLer(e)){ const { data } = await sb.from("vw_vendas_bens").select(VB_HIST_SELECT).eq("equipamento_id", e.id).order("created_at", { ascending: false }); hist = data || []; }
    if(_vbAlvo?.contId !== contId || _vbAlvo?.equipId !== e.id) return;
    cont.innerHTML = `<p class="vazio">Bem da casa: nenhuma venda registrada.</p>
      ${podeReg ? `<div class="form-acoes compacta" style="justify-content:flex-start;"><button type="button" class="btn" id="btn-vb-aba-registrar">💰 Registrar venda</button></div>
      <p class="meta">A venda dá baixa no bem (status Vendido, sai da frota, da manutenção e da mobilização) e abre o acompanhamento das parcelas até a quitação. Aceita data no passado e parcelas já recebidas.</p>` : ""}
      ${vbHistHTML(hist)}`;
    $("btn-vb-aba-registrar")?.addEventListener("click", () => vbAbrirRegistro(e, null));
    return;
  }
  if(!vbPodeLer(e)){
    cont.innerHTML = `<div class="odoo-contexto" style="padding:0 0 12px;">
        <div class="chip"><span>Situação</span><strong>${tagStatus("equipamento", "vendido")}</strong></div>
        <div class="chip"><span>Vendido em</span><strong>${dataBR(e.baixa_em)}</strong></div></div>
      <p class="nota">Comprador, valores e parcelas da venda ficam com o financeiro.</p>`;
    return;
  }
  cont.innerHTML = `<p class="vazio">Carregando a venda…</p>`;
  const [vr, pr, hr] = await Promise.all([
    sb.from("vw_vendas_bens").select("*").eq("id", e.venda_id).maybeSingle(),
    sb.from("vw_vendas_parcelas").select("*").eq("venda_id", e.venda_id).order("numero"),
    sb.from("vw_vendas_bens").select(VB_HIST_SELECT).eq("equipamento_id", e.id).eq("status", "cancelada").order("created_at", { ascending: false })
  ]);
  if(_vbAlvo?.contId !== contId || _vbAlvo?.equipId !== e.id) return;
  if(vr.error || !vr.data){ cont.innerHTML = `<p class="vazio">Não foi possível ler a venda${vr.error ? ": " + esc(vr.error.message) : ""}.</p>`; return; }
  _vbVendaAtual = vr.data;
  _vbParcelas = pr.data || [];
  cont.innerHTML = vbHTMLVenda(_vbVendaAtual, _vbParcelas, e) + vbHistHTML(hr.data || []);
  vbLigarAba(cont, e);
}
function vbHTMLVenda(v, parcelas, e){
  const podeReg = vbPodeRegistrar(e) && v.status !== "cancelada";
  const podeRec = vbPodeReceber() && v.status !== "cancelada";
  const chip = (lbl, val, title, cls) => `<div class="chip${cls ? " " + cls : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${lbl}</span><strong>${val}</strong></div>`;
  const temRecebido = parcelas.some(p => Number(p.valor_recebido) > 0 || Number(p.encargos) > 0);
  const resultado = v.resultado != null
    ? `<span class="${v.resultado < 0 ? "txt-perigo" : ""}">${brl(v.resultado)}</span>`
    : `<span class="meta">sem valor de aquisição</span>`;
  const encargoTxt = (v.juros_mora_pct != null || v.multa_atraso_pct != null)
    ? `Pelo contrato: juros de mora de ${num(v.juros_mora_pct || 0)}% ao mês e multa de ${num(v.multa_atraso_pct || 0)}% por atraso. A parcela atrasada mostra o encargo sugerido (multa + juros pro rata dia), que o financeiro confirma ou ajusta ao receber.`
    : `Sem juros e multa contratuais: o que vier a mais numa parcela atrasada é registrado em "juros/multa recebidos".`;
  const linhas = parcelas.map(p => {
    const recebida = p.status === "recebida";
    const acoes = [
      podeRec && !recebida ? `<button type="button" class="btn-sec btn-sm" data-vb-receber="${esc(p.id)}" title="Confirmar o recebimento desta parcela">✅ Receber</button>` : "",
      (podeRec || (podeReg && !(Number(p.valor_recebido) > 0))) && !recebida ? `<button type="button" class="btn-sec btn-sm" data-vb-editar="${esc(p.id)}" title="Editar vencimento e valor negociados">✏️</button>` : "",
      podeRec && (Number(p.valor_recebido) > 0 || Number(p.encargos) > 0) ? `<button type="button" class="btn-sec btn-sm" data-vb-estornar="${esc(p.id)}" title="Estornar o recebimento (a parcela volta a aberta)">↩️ Estornar</button>` : "",
      podeReg && !(Number(p.valor_recebido) > 0) && !(Number(p.encargos) > 0) ? `<button type="button" class="btn-sec btn-sm txt-perigo" data-vb-apagar="${esc(p.id)}" title="Apagar a parcela">×</button>` : ""
    ].filter(Boolean).join(" ");
    return `<tr>
      <td>${p.numero === 0 ? "Entrada" : esc(p.numero)}</td><td>${esc(p.descricao || "")}</td>
      <td>${dataBR(p.vencimento)}${p.dias_atraso > 0 ? ` <span class="meta txt-perigo">${p.dias_atraso} d</span>` : ""}</td>
      <td class="num">${brl(p.valor)}</td><td class="num">${Number(p.valor_recebido) > 0 ? brl(p.valor_recebido) : "—"}</td>
      <td class="num">${Number(p.encargos) > 0 ? brl(p.encargos) : (p.encargo_sugerido ? `<span class="meta" title="encargo sugerido pelo contrato (multa + juros pro rata dia)">sug. ${brl(p.encargo_sugerido)}</span>` : "—")}</td>
      <td>${dataBR(p.recebido_em)}</td><td>${esc(VB_FORMAS_REC[p.forma_recebimento] || p.forma_recebimento || "—")}${p.banco ? ` · ${esc(p.banco)}` : ""}</td>
      <td>${vbTagParc(p.status)}</td><td class="meta">${esc(p.observacao || "")}${p.confirmado_por_nome ? `<div>${esc(p.confirmado_por_nome)}</div>` : ""}</td>
      <td class="col-acao" style="white-space:nowrap;">${acoes}</td></tr>`;
  }).join("");
  const somaP = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const difPlano = v.valor_venda != null && parcelas.length && Math.abs(vbR2(somaP) - vbR2(v.valor_venda)) > 0.01;
  const veic = e && vbEhVeiculo(e);
  return `
    ${podeReg ? `<div class="form-acoes compacta" style="justify-content:flex-start;margin:0 0 10px;flex-wrap:wrap;">
      <button type="button" class="btn-sec" id="btn-vb-editar-venda">✏️ Editar venda</button>
      <button type="button" class="btn-sec" id="btn-vb-contrato-enviar">📎 ${v.contrato_path ? "Trocar contrato" : "Anexar contrato"}</button>
      <input type="file" id="vb-contrato-arquivo" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" style="display:none;" />
      <button type="button" class="btn-sec" id="btn-vb-cancelar-venda" title="O bem volta ao cadastro; a venda fica no histórico">↩️ Cancelar venda</button>
      ${!temRecebido ? `<button type="button" class="btn-sec txt-perigo" id="btn-vb-apagar-venda" title="Só sem recebimento confirmado">🗑️ Apagar</button>` : ""}
    </div>` : ""}
    <div class="odoo-contexto" style="padding:0 0 12px;">
      ${chip("Venda", esc(v.numero))}
      ${chip("Status", vbTag(v.status))}
      ${chip("Comprador", esc(v.comprador || "—") + (v.comprador_cpf_cnpj ? ` <span class="meta">${esc(v.comprador_cpf_cnpj)}</span>` : ""), v.comprador_contato || "")}
      ${chip("Data da venda", dataBR(v.data_venda))}
      ${chip("Valor", v.valor_venda != null ? brl(v.valor_venda) : "—")}
      ${chip("Plano", esc(vbPlanoTxt(v)) + (v.valor_entrada > 0 ? ` <span class="meta">entrada ${brl(v.valor_entrada)}</span>` : ""))}
      ${chip("Recebido", brl(v.recebido) + (Number(v.encargos_recebidos) > 0 ? ` <span class="meta">+ ${brl(v.encargos_recebidos)} juros/multa</span>` : ""))}
      ${chip("Saldo", v.saldo != null ? `<span class="${Number(v.saldo) > 0.009 ? "txt-perigo" : ""}">${brl(v.saldo)}</span>` : "—")}
      ${chip("Vencido", Number(v.valor_vencido) > 0.009 ? `<span class="txt-perigo">${brl(v.valor_vencido)}</span> <span class="meta">${v.dias_atraso} d</span>` : "—")}
      ${chip("Próximo vencimento", v.proximo_vencimento ? dataBR(v.proximo_vencimento) : (v.status === "quitada" ? `quitada ${dataBR(v.quitada_em)}` : "—"))}
      ${chip("Resultado", resultado, "Valor da venda − valor de aquisição do bem (resultado simples, sem depreciação)", v.resultado == null ? "chip-aviso" : "")}
      ${chip("NF", v.nf_numero ? esc(v.nf_numero) + (v.nf_data ? ` <span class="meta">${dataBR(v.nf_data)}</span>` : "") : "—")}
      ${chip("Contrato", v.contrato_path ? `<a href="#" id="vb-contrato-abrir">📄 ${esc(v.contrato_nome || "abrir")}</a>` : '<span class="meta">não anexado</span>', null, v.contrato_path ? "" : "chip-aviso")}
    </div>
    ${(v.pendencias || []).length ? `<p class="meta">Pendências: ${vbPendTags(v)}</p>` : ""}
    ${v.resultado == null ? `<p class="nota">O resultado da venda é calculado contra o valor de aquisição do bem, que está vazio. Informe-o na aba Geral da ficha (ou peça a quem cadastra equipamentos).</p>` : ""}
    <p class="meta">${esc(encargoTxt)}</p>
    <div class="lista-topo compacta"><h4 class="titulo-bloco" style="margin:0;">Entrada e parcelas</h4>
      ${podeReg ? `<button type="button" class="btn-sec btn-sm" id="btn-vb-parc-nova" style="margin-left:auto;">+ Parcela</button>` : ""}</div>
    ${difPlano ? `<p class="nota">A soma das parcelas (${brl(somaP)}) difere do valor da venda (${brl(v.valor_venda)}). A venda fica quitada quando o recebido atinge o valor da venda.</p>` : ""}
    ${parcelas.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Descrição</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Recebido</th><th class="num">Juros/multa</th><th>Recebido em</th><th>Forma</th><th>Status</th><th>Observação</th><th class="col-acao"></th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><th colspan="3">Total</th><th class="num">${brl(somaP)}</th><th class="num">${brl(v.recebido)}</th><th class="num">${Number(v.encargos_recebidos) > 0 ? brl(v.encargos_recebidos) : ""}</th><th colspan="5"></th></tr></tfoot>
    </table></div>` : `<p class="vazio">${v.valor_venda > 0 ? "Sem parcelas: informe o 1º vencimento em \"Editar venda\" ou lance as parcelas uma a uma (+ Parcela)." : "Sem valor de venda: complete em \"Editar venda\"."}</p>`}
    ${veic ? `<h4 class="titulo-bloco" style="margin-top:16px;">Transferência do veículo ${v.transferencia_concluida ? '<span class="tag verde">concluída</span>' : '<span class="tag ambar">pendente</span>'}</h4>
      <div class="grade grade-3">
        <div class="campo"><label>Comunicação de venda ao Detran em</label><input type="date" id="vb-tr-comunic" value="${esc(v.comunicacao_venda_em || "")}" ${podeReg ? "" : "disabled"} /></div>
        <div class="campo"><label>CRV / ATPV-e entregue ao comprador em</label><input type="date" id="vb-tr-crv" value="${esc(v.crv_entregue_em || "")}" ${podeReg ? "" : "disabled"} /></div>
        ${podeReg ? `<div class="campo"><label>&nbsp;</label><button type="button" class="btn-sec" id="btn-vb-tr-salvar">💾 Salvar checklist</button></div>` : ""}
      </div>
      <p class="meta">Enquanto as duas datas não estiverem preenchidas, o veículo aparece no "Para regularizar" do financeiro e do gestor de frota (multa e IPVA continuam no nome da CGL até a comunicação).</p>` : ""}
    ${v.observacoes ? `<h4 class="titulo-bloco" style="margin-top:16px;">Observações</h4><p style="white-space:pre-wrap;margin:0;">${esc(v.observacoes)}</p>` : ""}`;
}
function vbLigarAba(cont, e){
  const v = _vbVendaAtual;
  $("btn-vb-editar-venda")?.addEventListener("click", () => vbAbrirRegistro(e, v));
  $("btn-vb-contrato-enviar")?.addEventListener("click", () => $("vb-contrato-arquivo")?.click());
  $("vb-contrato-arquivo")?.addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if(f) comBotaoTravado("btn-vb-contrato-enviar", async () => {
      try { await vbEnviarContrato(v, f); aviso("app-aviso", "Contrato anexado.", "ok"); await vbAposGravar(e.id); }
      catch(err){ aviso("app-aviso", "Não foi possível anexar o contrato: " + vbMsgErro(err), "erro"); }
    });
  });
  $("vb-contrato-abrir")?.addEventListener("click", (ev) => { ev.preventDefault(); vbAbrirContrato(v.contrato_path); });
  $("btn-vb-cancelar-venda")?.addEventListener("click", () => vbCancelarVenda(v, e));
  $("btn-vb-apagar-venda")?.addEventListener("click", () => vbApagarVenda(v, e));
  $("btn-vb-parc-nova")?.addEventListener("click", () => vbAbrirParcela("nova", null));
  $("btn-vb-tr-salvar")?.addEventListener("click", () => comBotaoTravado("btn-vb-tr-salvar", async () => {
    const reg = { comunicacao_venda_em: $("vb-tr-comunic").value || null, crv_entregue_em: $("vb-tr-crv").value || null };
    const { error } = await sb.from("vendas_bens").update(reg).eq("id", v.id);
    if(error){ aviso("app-aviso", "Não foi possível salvar o checklist: " + vbMsgErro(error), "erro"); return; }
    aviso("app-aviso", reg.comunicacao_venda_em && reg.crv_entregue_em ? "Transferência concluída." : "Checklist salvo.", "ok");
    await vbAposGravar(e.id);
  }));
  cont.querySelectorAll("[data-vb-receber]").forEach(b => b.addEventListener("click", () => vbAbrirParcela("receber", _vbParcelas.find(p => p.id === b.dataset.vbReceber))));
  cont.querySelectorAll("[data-vb-editar]").forEach(b => b.addEventListener("click", () => vbAbrirParcela("editar", _vbParcelas.find(p => p.id === b.dataset.vbEditar))));
  cont.querySelectorAll("[data-vb-estornar]").forEach(b => b.addEventListener("click", () => vbEstornar(_vbParcelas.find(p => p.id === b.dataset.vbEstornar))));
  cont.querySelectorAll("[data-vb-apagar]").forEach(b => b.addEventListener("click", () => vbApagarParcela(_vbParcelas.find(p => p.id === b.dataset.vbApagar))));
}
async function vbAbrirContrato(path){
  if(!path) return;
  const { data, error } = await sb.storage.from(VB_BUCKET).createSignedUrl(path, 120);
  if(error || !data?.signedUrl){ aviso("app-aviso", "Não foi possível abrir o contrato: " + (error?.message || "sem link"), "erro"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
/* supabase-js ignora contentType quando o corpo é File: o MIME vem da extensão e o arquivo é reembalado em Blob */
async function vbEnviarContrato(venda, file){
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  const mime = VB_MIME[ext];
  if(!mime) throw new Error("envie o contrato em PDF, JPG ou PNG");
  if(file.size > 20 * 1024 * 1024) throw new Error("arquivo acima de 20 MB");
  const nome = String(file.name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
  const caminho = `${venda.equipamento_id}/${venda.id}/${Date.now()}-${nome}`;
  const corpo = new Blob([file], { type: mime });
  const up = await sb.storage.from(VB_BUCKET).upload(caminho, corpo, { cacheControl: "3600", contentType: mime, upsert: false });
  if(up.error) throw up.error;
  // o arquivo anterior fica no bucket (histórico); a venda passa a apontar para o novo
  const { error } = await sb.from("vendas_bens").update({ contrato_path: caminho, contrato_nome: file.name }).eq("id", venda.id);
  if(error){ await sb.storage.from(VB_BUCKET).remove([caminho]); throw error; }
}
async function vbCancelarVenda(v, e){
  const motivo = prompt(`Cancelar a venda ${v.numero}? O bem ${e.codigo} volta ao cadastro como estava antes da venda (status, ativo e plano preventivo) e a venda fica no histórico.\n\nMotivo do cancelamento:`);
  if(motivo === null) return;
  if(!motivo.trim()){ aviso("app-aviso", "Informe o motivo do cancelamento.", "erro"); return; }
  const { error } = await sb.from("vendas_bens").update({ status: "cancelada", cancelamento_motivo: motivo.trim() }).eq("id", v.id);
  if(error){ aviso("app-aviso", "Não foi possível cancelar: " + vbMsgErro(error), "erro"); return; }
  aviso("app-aviso", `Venda ${v.numero} cancelada; ${e.codigo} voltou ao cadastro.`, "ok");
  await vbAposGravar(e.id);
}
async function vbApagarVenda(v, e){
  if(!confirm(`Apagar a venda ${v.numero}? Use só para lançamento errado: o bem ${e.codigo} volta ao cadastro e a venda some (com recebimento confirmado, cancele em vez de apagar).`)) return;
  const { error } = await sb.from("vendas_bens").delete().eq("id", v.id);
  if(error){ aviso("app-aviso", "Não foi possível apagar: " + vbMsgErro(error), "erro"); return; }
  aviso("app-aviso", `Venda ${v.numero} apagada.`, "ok");
  await vbAposGravar(e.id);
}

/* ---------- parcela: receber, editar, nova, estornar, apagar ---------- */
function vbAbrirParcela(modo, p){
  const v = _vbVendaAtual; if(!v) return;
  if(modo !== "nova" && !p) return;
  _vbParcAtual = { modo, p };
  vbLimparAviso("vb-parc-aviso");
  const receber = modo === "receber";
  $("vb-parc-receb").style.display = receber ? "" : "none";
  $("vb-parc-edit").style.display = receber ? "none" : "";
  $("btn-vb-parc-salvar").textContent = receber ? "✅ Confirmar recebimento" : "💾 Salvar parcela";
  if(receber){
    const saldo = vbR2(Number(p.valor) - Number(p.valor_recebido));
    $("vb-parc-titulo").textContent = `Receber ${p.numero === 0 ? "a entrada" : "a parcela " + p.numero} · ${v.numero}`;
    $("vb-parc-info").innerHTML = `Vencimento ${dataBR(p.vencimento)} · valor ${brl(p.valor)}${Number(p.valor_recebido) > 0 ? ` · já recebido ${brl(p.valor_recebido)}` : ""} · saldo <strong>${brl(saldo)}</strong>`
      + (p.encargo_sugerido ? `<br>Encargo sugerido pelo contrato: <strong>${brl(p.encargo_sugerido)}</strong> (${p.dias_atraso} dia(s) de atraso; multa ${num(v.multa_atraso_pct || 0)}% + juros ${num(v.juros_mora_pct || 0)}% a.m. pro rata). Confirme ou ajuste.` : "");
    $("vb-pr-data").value = hojeISO();
    $("vb-pr-valor").value = saldo > 0 ? saldo.toFixed(2) : "";
    $("vb-pr-encargos").value = p.encargo_sugerido ? Number(p.encargo_sugerido).toFixed(2) : "";
    $("vb-pr-forma").innerHTML = Object.entries(VB_FORMAS_REC).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
    $("vb-pr-forma").value = p.forma_recebimento || "transferencia";
    $("vb-pr-banco").value = p.banco || "";
    $("vb-pr-obs").value = p.observacao || "";
  } else {
    $("vb-parc-titulo").textContent = modo === "nova" ? `Nova parcela · ${v.numero}` : `Editar ${p.numero === 0 ? "a entrada" : "a parcela " + p.numero} · ${v.numero}`;
    $("vb-parc-info").innerHTML = modo === "nova" ? "Parcela lançada à mão (valor e vencimento negociados). Ela entra no saldo; o plano gerado não muda." : "Vencimento e valor negociados com o comprador. A venda fica quitada quando o recebido atinge o valor da venda.";
    $("vb-pe-desc").value = p?.descricao || "";
    $("vb-pe-venc").value = p?.vencimento || "";
    $("vb-pe-valor").value = p?.valor ?? "";
    $("vb-pe-obs").value = p?.observacao || "";
  }
  $("vb-parc-modal").style.display = "flex";
}
function vbFecharParcela(){ $("vb-parc-modal").style.display = "none"; _vbParcAtual = null; }
async function vbSalvarParcela(){
  const ctx = _vbParcAtual, v = _vbVendaAtual;
  if(!ctx || !v) return;
  const equipId = _vbAlvo?.equipId || v.equipamento_id;
  if(ctx.modo === "receber"){
    const p = ctx.p;
    const valor = Number($("vb-pr-valor").value || 0), enc = Number($("vb-pr-encargos").value || 0), data = $("vb-pr-data").value;
    if(!(valor > 0) && !(enc > 0)){ vbAvisoModal("vb-parc-aviso", "Informe o valor recebido.", "erro"); return; }
    if(!data){ vbAvisoModal("vb-parc-aviso", "Informe a data do recebimento.", "erro"); return; }
    if(valor < 0 || enc < 0){ vbAvisoModal("vb-parc-aviso", "Valores não podem ser negativos.", "erro"); return; }
    const saldo = vbR2(Number(p.valor) - Number(p.valor_recebido));
    if(valor > saldo + 0.005 && !confirm(`Valor ${brl(valor)} acima do saldo da parcela (${brl(saldo)}). O excedente de juros e multa vai no campo "juros/multa". Confirmar assim mesmo?`)) return;
    const reg = { valor_recebido: vbR2(Number(p.valor_recebido) + valor), encargos: vbR2(Number(p.encargos) + enc), recebido_em: data,
      forma_recebimento: $("vb-pr-forma").value || "transferencia", banco: $("vb-pr-banco").value.trim() || null, observacao: $("vb-pr-obs").value.trim() || null };
    const { data: ok, error } = await sb.from("vendas_bens_parcelas").update(reg).eq("id", p.id).select("id");
    if(error){ vbAvisoModal("vb-parc-aviso", "Não foi possível confirmar: " + vbMsgErro(error), "erro"); return; }
    if(!ok || !ok.length){ vbAvisoModal("vb-parc-aviso", "Seu perfil não confirma recebimento (financeiro, admin e diretoria).", "erro"); return; }
    vbFecharParcela();
    aviso("app-aviso", "Recebimento confirmado. Saldo e status da venda refeitos no banco.", "ok");
  } else {
    const valor = Number($("vb-pe-valor").value), venc = $("vb-pe-venc").value;
    if(!(valor > 0)){ vbAvisoModal("vb-parc-aviso", "Informe o valor da parcela.", "erro"); return; }
    if(!venc){ vbAvisoModal("vb-parc-aviso", "Informe o vencimento.", "erro"); return; }
    const reg = { vencimento: venc, valor: vbR2(valor), descricao: $("vb-pe-desc").value.trim() || null, observacao: $("vb-pe-obs").value.trim() || null };
    let r;
    if(ctx.modo === "nova") r = await sb.from("vendas_bens_parcelas").insert({ ...reg, venda_id: v.id }).select("id");
    else r = await sb.from("vendas_bens_parcelas").update(reg).eq("id", ctx.p.id).select("id");
    if(r.error){ vbAvisoModal("vb-parc-aviso", "Não foi possível salvar: " + vbMsgErro(r.error), "erro"); return; }
    if(!r.data || !r.data.length){ vbAvisoModal("vb-parc-aviso", "Seu perfil não altera esta parcela.", "erro"); return; }
    vbFecharParcela();
    aviso("app-aviso", ctx.modo === "nova" ? "Parcela lançada." : "Parcela atualizada.", "ok");
  }
  await vbAposGravar(equipId);
}
async function vbEstornar(p){
  if(!p) return;
  if(!confirm(`Estornar o recebimento de ${brl(p.valor_recebido)}${Number(p.encargos) > 0 ? ` + ${brl(p.encargos)} de juros/multa` : ""} (${p.numero === 0 ? "entrada" : "parcela " + p.numero})? A parcela volta a aberta.`)) return;
  const { data, error } = await sb.from("vendas_bens_parcelas").update({ valor_recebido: 0, encargos: 0 }).eq("id", p.id).select("id");
  if(error || !data?.length){ aviso("app-aviso", "Não foi possível estornar: " + (error ? vbMsgErro(error) : "sem permissão"), "erro"); return; }
  aviso("app-aviso", "Recebimento estornado.", "ok");
  await vbAposGravar(_vbAlvo?.equipId || _vbVendaAtual?.equipamento_id);
}
async function vbApagarParcela(p){
  if(!p || !confirm(`Apagar ${p.numero === 0 ? "a entrada" : "a parcela " + p.numero} de ${brl(p.valor)} (vencimento ${dataBR(p.vencimento)})?`)) return;
  const { data, error } = await sb.from("vendas_bens_parcelas").delete().eq("id", p.id).select("id");
  if(error || !data?.length){ aviso("app-aviso", "Não foi possível apagar: " + (error ? vbMsgErro(error) : "sem permissão"), "erro"); return; }
  aviso("app-aviso", "Parcela apagada.", "ok");
  await vbAposGravar(_vbAlvo?.equipId || _vbVendaAtual?.equipamento_id);
}

/* ====================================================================
   Modal "Registrar venda" (nova ou edição)
   ==================================================================== */
async function vbCarregarClientes(){
  if(_vbClientes) return _vbClientes;
  const { data } = await sb.from("clientes").select("id,nome,cpf_cnpj").order("nome");
  _vbClientes = data || [];
  return _vbClientes;
}
async function vbAbrirRegistro(e, venda){
  if(!e?.id){ aviso("app-aviso", "Salve o bem antes de registrar a venda.", "erro"); return; }
  if(!vbPodeRegistrar(e)){ aviso("app-aviso", vbEhVeiculo(e) ? "Só o financeiro, o admin, a diretoria e o gestor de frota registram a venda de veículos." : "Só o financeiro, o admin e a diretoria registram a venda de equipamentos.", "erro"); return; }
  if(!venda && (e.status === "vendido" || e.venda_id)){ aviso("app-aviso", `${e.codigo} já está vendido. Abra a aba Venda.`, "erro"); return; }
  _vbEquipModal = e; _vbEditVenda = venda || null;
  vbLimparAviso("vb-aviso");
  const cli = await vbCarregarClientes();
  $("vb-cliente").innerHTML = `<option value="">— comprador não é cliente da casa —</option>` + cli.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.cpf_cnpj ? " · " + esc(c.cpf_cnpj) : ""}</option>`).join("");
  const v = venda || {};
  $("vb-titulo").textContent = venda ? `✏️ Editar venda ${venda.numero}` : "💰 Registrar venda";
  $("vb-bem-txt").innerHTML = `Bem: <strong>${esc(e.codigo)}</strong>${e.nome ? " · " + esc(e.nome) : ""}${e.placa ? " · " + esc(e.placa) : ""}${venda ? "" : " — a venda dá baixa no bem (status Vendido) e desliga o plano preventivo; o histórico (OS, custos, viagens, RDOs) continua ligado."}`;
  $("vb-cliente").value = v.cliente_id || "";
  $("vb-comprador-nome").value = v.comprador_nome || "";
  $("vb-comprador-doc").value = v.comprador_cpf_cnpj || "";
  $("vb-comprador-contato").value = v.comprador_contato || "";
  $("vb-data").value = v.data_venda || (venda ? "" : hojeISO());
  $("vb-valor").value = v.valor_venda ?? "";
  $("vb-entrada").value = v.valor_entrada ? v.valor_entrada : "";
  $("vb-forma").value = v.forma || "a_vista";
  $("vb-n").value = v.n_parcelas ?? "";
  $("vb-venc").value = v.primeiro_vencimento || "";
  $("vb-period").innerHTML = Object.entries(VB_PERIOD).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  $("vb-period").value = v.periodicidade || "mensal";
  $("vb-intervalo").value = v.intervalo_dias ?? "";
  $("vb-juros").value = v.juros_mora_pct ?? "";
  $("vb-multa").value = v.multa_atraso_pct ?? "";
  $("vb-nf").value = v.nf_numero || "";
  $("vb-nf-data").value = v.nf_data || "";
  $("vb-obs").value = v.observacoes || "";
  $("vb-comunic").value = v.comunicacao_venda_em || "";
  $("vb-crv").value = v.crv_entregue_em || "";
  $("vb-bloco-veic").style.display = vbEhVeiculo(e) ? "" : "none";
  $("vb-contrato").value = "";
  $("vb-contrato-campo").style.display = venda ? "none" : "";
  $("vb-ja-recebidas").checked = false;
  $("vb-ja-recebidas-campo").style.display = (!venda && vbPodeReceber()) ? "" : "none";
  $("btn-vb-salvar").textContent = venda ? "💾 Salvar venda" : "💰 Registrar venda";
  vbToggleForma();
  $("vb-modal").style.display = "flex";
}
function vbFecharRegistro(){ $("vb-modal").style.display = "none"; _vbEquipModal = null; _vbEditVenda = null; }
function vbToggleForma(){
  const parc = $("vb-forma").value === "parcelado";
  document.querySelectorAll("#vb-modal .vb-so-parc").forEach(el => el.style.display = parc ? "" : "none");
  document.querySelectorAll("#vb-modal .vb-so-pers").forEach(el => el.style.display = parc && $("vb-period").value === "personalizada" ? "" : "none");
  $("vb-venc-lbl").textContent = parc ? "1º vencimento *" : "Vencimento do saldo *";
  vbPrevia();
}
/* prévia do plano, com a mesma regra do gatilho fn_vendas_bens_gerar_parcelas */
function vbPrevia(){
  const el = $("vb-previa"); if(!el) return;
  const valor = Number($("vb-valor").value || 0), ent = Number($("vb-entrada").value || 0), venc = $("vb-venc").value;
  const parc = $("vb-forma").value === "parcelado", n = Math.max(1, parseInt($("vb-n").value || "1", 10) || 1);
  if(!(valor > 0) || !venc){ el.textContent = valor > 0 ? "Sem vencimento: as parcelas não são geradas (a venda fica com a pendência \"sem parcelas\")." : ""; return; }
  const saldo = vbR2(valor - ent);
  if(saldo < 0){ el.innerHTML = `<span class="txt-perigo">A entrada é maior que o valor da venda.</span>`; return; }
  const per = $("vb-period").value, intv = parseInt($("vb-intervalo").value || "30", 10) || 30;
  const add = (iso, i) => {
    const d = new Date(iso + "T12:00:00");
    if(!parc || per === "mensal") d.setMonth(d.getMonth() + i);
    else d.setDate(d.getDate() + i * (per === "quinzenal" ? 15 : intv));
    return dataLocalISO(d);
  };
  const partes = [];
  if(ent > 0) partes.push(`entrada ${brl(ent)} em ${dataBR($("vb-data").value || venc)}`);
  if(saldo > 0){
    if(!parc) partes.push(`saldo ${brl(saldo)} em ${dataBR(venc)}`);
    else { const p = vbR2(saldo / n); partes.push(`${n} × ${brl(p)}${vbR2(p * n) !== saldo ? ` (a última ${brl(vbR2(saldo - p * (n - 1)))})` : ""} de ${dataBR(venc)} a ${dataBR(add(venc, n - 1))}`); }
  }
  el.textContent = "Plano: " + partes.join(" + ") + (_vbEditVenda ? ". Mudar valor, entrada ou plano refaz as parcelas." : ".");
}
const vbIgual = (a, b) => {
  const va = a == null || a === "" ? null : a, vb = b == null || b === "" ? null : b;
  if(va == null || vb == null) return va == null && vb == null;
  if(typeof va === "number" || typeof vb === "number") return Math.abs(Number(va) - Number(vb)) < 0.005;
  return String(va) === String(vb);
};
async function vbSalvarRegistro(){
  const e = _vbEquipModal, ed = _vbEditVenda;
  if(!e) return;
  const n = (id) => { const x = $(id).value; return x === "" ? null : Number(x); };
  const forma = $("vb-forma").value;
  const reg = {
    cliente_id: $("vb-cliente").value || null,
    comprador_nome: $("vb-comprador-nome").value.trim() || null,
    comprador_cpf_cnpj: $("vb-comprador-doc").value.trim() || null,
    comprador_contato: $("vb-comprador-contato").value.trim() || null,
    data_venda: $("vb-data").value || null,
    valor_venda: n("vb-valor"),
    valor_entrada: n("vb-entrada") || 0,
    forma,
    n_parcelas: forma === "parcelado" ? n("vb-n") : null,
    primeiro_vencimento: $("vb-venc").value || null,
    periodicidade: forma === "parcelado" ? $("vb-period").value : null,
    intervalo_dias: forma === "parcelado" && $("vb-period").value === "personalizada" ? n("vb-intervalo") : null,
    juros_mora_pct: n("vb-juros"), multa_atraso_pct: n("vb-multa"),
    nf_numero: $("vb-nf").value.trim() || null, nf_data: $("vb-nf-data").value || null,
    observacoes: $("vb-obs").value.trim() || null
  };
  if(vbEhVeiculo(e)){ reg.comunicacao_venda_em = $("vb-comunic").value || null; reg.crv_entregue_em = $("vb-crv").value || null; }
  const ehCarga = ed && ed.origem === "planilha";
  if(!reg.comprador_nome && !reg.cliente_id && !ehCarga){ vbAvisoModal("vb-aviso", "Informe o comprador (nome ou cliente da casa).", "erro"); $("vb-comprador-nome").focus(); return; }
  if(!reg.data_venda && !ehCarga){ vbAvisoModal("vb-aviso", "Informe a data da venda.", "erro"); return; }
  if(!(reg.valor_venda > 0) && !ehCarga){ vbAvisoModal("vb-aviso", "Informe o valor da venda.", "erro"); return; }
  if(reg.valor_venda != null && reg.valor_entrada > reg.valor_venda){ vbAvisoModal("vb-aviso", "A entrada é maior que o valor da venda.", "erro"); return; }
  if(forma === "parcelado" && !(reg.n_parcelas >= 1)){ vbAvisoModal("vb-aviso", "Informe o número de parcelas.", "erro"); return; }
  if(reg.intervalo_dias == null && reg.periodicidade === "personalizada"){ vbAvisoModal("vb-aviso", "Informe o intervalo em dias.", "erro"); return; }
  if(reg.valor_venda > 0 && !reg.primeiro_vencimento && !ehCarga){ vbAvisoModal("vb-aviso", forma === "parcelado" ? "Informe o 1º vencimento." : "Informe o vencimento do saldo (a data da venda, se foi pago no ato).", "erro"); return; }
  if(ed){
    const mudaPlano = VB_CAMPOS_PLANO.some(k => !vbIgual(reg[k], ed[k]));
    if(mudaPlano && ed.n_parcelas_geradas > 0 && !confirm("Mudar valor, entrada ou plano refaz as parcelas pelo novo plano (as editadas uma a uma voltam ao plano). Com parcela já recebida o banco recusa: aí ajuste as parcelas uma a uma. Continuar?")) return;
    const { data, error } = await sb.from("vendas_bens").update(reg).eq("id", ed.id).select("id");
    if(error){ vbAvisoModal("vb-aviso", "Não foi possível salvar: " + vbMsgErro(error), "erro"); return; }
    if(!data || !data.length){ vbAvisoModal("vb-aviso", "Seu perfil não altera esta venda.", "erro"); return; }
    vbFecharRegistro();
    aviso("app-aviso", `Venda ${ed.numero} salva.`, "ok");
    await vbAposGravar(e.id);
    return;
  }
  const arquivo = $("vb-contrato").files && $("vb-contrato").files[0];
  if(arquivo && !VB_MIME[String(arquivo.name).split(".").pop().toLowerCase()]){ vbAvisoModal("vb-aviso", "Contrato em PDF, JPG ou PNG.", "erro"); return; }
  const jaRecebidas = $("vb-ja-recebidas").checked && vbPodeReceber();
  const { data: nova, error } = await sb.from("vendas_bens").insert({ ...reg, equipamento_id: e.id }).select("id,numero,equipamento_id").single();
  if(error){ vbAvisoModal("vb-aviso", "Não foi possível registrar a venda: " + vbMsgErro(error), "erro"); return; }
  const avisos = [];
  if(arquivo){
    try { await vbEnviarContrato(nova, arquivo); } catch(err){ avisos.push("o contrato não subiu (" + vbMsgErro(err) + "): anexe na aba Venda"); }
  }
  if(jaRecebidas){
    const { data: ps } = await sb.from("vendas_bens_parcelas").select("id,valor,vencimento").eq("venda_id", nova.id).lte("vencimento", hojeISO());
    let falhas = 0;
    for(const p of (ps || [])){
      const { error: ep } = await sb.from("vendas_bens_parcelas").update({ valor_recebido: p.valor, recebido_em: p.vencimento, forma_recebimento: "transferencia" }).eq("id", p.id);
      if(ep) falhas++;
    }
    if(falhas) avisos.push(`${falhas} parcela(s) não foram marcadas como recebidas`);
  }
  vbFecharRegistro();
  aviso("app-aviso", `Venda ${nova.numero} registrada: ${e.codigo} saiu do cadastro operacional.${avisos.length ? " Atenção: " + avisos.join("; ") + "." : ""}`, avisos.length ? "aviso" : "ok");
  await vbAposGravar(e.id);
  // veículo não tem ficha própria: mostra a venda recém-criada (parcelas geradas, checklist de transferência)
  if(vbEhVeiculo(e) && $("vb-ficha-modal")?.style.display !== "flex") await vbAbrirVendaDoBem(e.id);
}

/* Depois de gravar: redesenha onde a venda estiver na tela (ficha do equipamento, modal do veículo, painel, Logística) */
async function vbAposGravar(equipId){
  _vbVendas = null;
  const fichaEqp = $("eqp-ficha");
  if(fichaEqp && fichaEqp.style.display !== "none" && typeof _eqpAtual !== "undefined" && _eqpAtual?.id === equipId && typeof carregarEquipamentos === "function"){
    await carregarEquipamentos(true);
    await abrirEquipamento(equipId);
    if(typeof ativarTabEquipamento === "function") ativarTabEquipamento("venda");
  }
  if($("vb-ficha-modal")?.style.display === "flex" && _vbAlvo?.contId === "vb-ficha-conteudo") await vbAbrirVendaDoBem(equipId);
  if($("sec-equipamentos")?.classList.contains("ativa") && typeof _eqpView !== "undefined" && _eqpView === "vendas" && $("eqp-painel")?.style.display !== "none") vbRenderPainel();
  if($("sec-frota")?.classList.contains("ativa") && typeof carregarFrota === "function") carregarFrota(true);
}

/* ====================================================================
   Sala de Comando (KPI "A receber") e Carteira ("Bens vendidos no ano")
   ==================================================================== */
async function vbResumoAReceber(){
  if(!vbPodeLer(null)) return null;
  const { data, error } = await sb.from("vw_vendas_bens").select("saldo,valor_vencido,status").not("status", "in", "(quitada,cancelada)");
  if(error) return { erro: error };
  const lst = data || [];
  return { total: lst.reduce((s, v) => s + (Number(v.saldo) || 0), 0), vencido: lst.reduce((s, v) => s + (Number(v.valor_vencido) || 0), 0), n: lst.length };
}
async function vbRenderCarteira(contId){
  const cont = $(contId); if(!cont) return;
  const card = cont.closest(".card");
  if(!vbPodeLer(null)){ if(card) card.style.display = "none"; return; }
  if(card) card.style.display = "";
  const ano = new Date().getFullYear();
  if($("cart-vb-ano")) $("cart-vb-ano").textContent = String(ano);
  const { data, error } = await sb.from("vw_vendas_bens").select("*").neq("status", "cancelada").order("data_venda", { ascending: false, nullsFirst: false });
  if(error){ cont.innerHTML = `<p class="vazio">Não foi possível ler as vendas: ${esc(error.message)}</p>`; return; }
  const todas = data || [];
  const doAno = todas.filter(v => Number(v.ano) === ano);
  const semData = todas.filter(v => !v.data_venda);
  const soma = (l, k) => l.reduce((s, v) => s + (Number(v[k]) || 0), 0);
  const comRes = doAno.filter(v => v.resultado != null);
  cont.innerHTML = `
    <div class="indicadores" style="margin-bottom:12px;">
      <div class="ind"><div class="num">${doAno.length}</div><div class="rot">Bens vendidos em ${ano}</div></div>
      <div class="ind"><div class="num">${brl(soma(doAno, "valor_venda"))}</div><div class="rot">Valor vendido</div></div>
      <div class="ind"><div class="num" style="color:var(--sucesso);">${brl(soma(doAno, "recebido"))}</div><div class="rot">Recebido</div></div>
      <div class="ind"><div class="num" style="color:var(--aviso-txt);">${brl(soma(doAno, "saldo"))}</div><div class="rot">Saldo a receber</div></div>
      <div class="ind" title="Valor da venda − valor de aquisição, só nas vendas com os dois valores"><div class="num">${brl(soma(comRes, "resultado"))}</div><div class="rot">Resultado contra a aquisição${doAno.length - comRes.length ? ` · ${doAno.length - comRes.length} sem valor de aquisição` : ""}</div></div>
    </div>
    ${doAno.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Venda</th><th>Data</th><th>Bem</th><th>Comprador</th><th class="num">Valor</th><th class="num">Recebido</th><th class="num">Saldo</th><th class="num">Aquisição</th><th class="num">Resultado</th><th>Status</th></tr></thead>
      <tbody>${doAno.map(v => `<tr class="linha-clicavel" data-vb-venda="${esc(v.id)}"><td>${esc(v.numero)}</td><td>${dataBR(v.data_venda)}</td><td>${esc(vbBemTxt(v))}</td><td>${esc(v.comprador || "—")}</td>
        <td class="num">${v.valor_venda != null ? brl(v.valor_venda) : "—"}</td><td class="num">${brl(v.recebido)}</td><td class="num">${v.saldo != null ? brl(v.saldo) : "—"}</td>
        <td class="num">${v.valor_aquisicao != null ? brl(v.valor_aquisicao) : '<span class="meta">—</span>'}</td>
        <td class="num">${v.resultado != null ? `<span class="${v.resultado < 0 ? "txt-perigo" : ""}">${brl(v.resultado)}</span>` : '<span class="meta">sem aquisição</span>'}</td><td>${vbTag(v.status)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vazio">Nenhuma venda com data em ${ano}.</p>`}
    ${semData.length ? `<p class="meta" style="margin-top:8px;">${semData.length} venda(s) sem data da venda (carga a completar pelo financeiro): ${semData.map(v => esc(v.codigo)).join(", ")}. <a href="#" id="cart-vb-sem-data">ver</a></p>` : ""}`;
  cont.querySelectorAll("tr[data-vb-venda]").forEach(tr => tr.addEventListener("click", () => { const v = todas.find(x => x.id === tr.dataset.vbVenda); if(v) vbAbrirVenda(v); }));
  $("cart-vb-sem-data")?.addEventListener("click", (ev) => { ev.preventDefault(); vbAbrirPainel({ ano: "sem_data" }); });
}

/* ---------- ligação ---------- */
function ligarVendasBens(){
  ["vb-f-ano", "vb-f-status", "vb-f-comprador", "vb-f-pend"].forEach(id => $(id)?.addEventListener("change", () => vbRenderPainel()));
  $("vb-busca")?.addEventListener("input", debounce(() => vbRenderPainel()));
  $("btn-vb-exportar")?.addEventListener("click", () => comBotaoTravado("btn-vb-exportar", vbExportar));
  $("btn-eqp-atualizar")?.addEventListener("click", () => { _vbVendas = null; });   // "Atualizar" do painel também relê as vendas
  $("vb-indicadores")?.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-vb-kpi]"); if(!k) return;
    if(k.dataset.vbKpi === "ano"){ const s = $("vb-f-ano"); if(s){ s.value = s.value === k.dataset.ano ? "" : k.dataset.ano; } }
    else { const s = $("vb-f-status"); if(s) s.value = s.value === k.dataset.vbKpi ? "" : k.dataset.vbKpi; }
    vbRenderPainel();
  });
  // linhas do painel (o clique delegado de #eqp-conteudo em equipamentos.js só reage a data-id)
  $("eqp-conteudo")?.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-vb-venda]");
    if(tr){ const v = (_vbVendas?.lista || []).find(x => x.id === tr.dataset.vbVenda); if(v) vbAbrirVenda(v); return; }
    const te = ev.target.closest("tr[data-vb-eq]");
    if(te && typeof abrirEquipamento === "function"){
      const e = (_vbVendas?.lista || []).find(x => x.id === te.dataset.vbEq);
      if(e && !vbEhVeiculo(e)){ abrirEquipamento(e.id).then(() => { if(typeof ativarTabEquipamento === "function") ativarTabEquipamento("venda"); }); }
    }
  });
  $("btn-vb-fechar")?.addEventListener("click", vbFecharRegistro);
  $("btn-vb-salvar")?.addEventListener("click", () => comBotaoTravado("btn-vb-salvar", vbSalvarRegistro));
  $("vb-forma")?.addEventListener("change", vbToggleForma);
  $("vb-period")?.addEventListener("change", vbToggleForma);
  ["vb-valor", "vb-entrada", "vb-n", "vb-venc", "vb-intervalo", "vb-data"].forEach(id => $(id)?.addEventListener("input", vbPrevia));
  $("vb-cliente")?.addEventListener("change", () => {
    const c = (_vbClientes || []).find(x => x.id === $("vb-cliente").value);
    if(c && !$("vb-comprador-nome").value.trim()) $("vb-comprador-nome").value = c.nome || "";
    if(c && !$("vb-comprador-doc").value.trim()) $("vb-comprador-doc").value = c.cpf_cnpj || "";
  });
  $("btn-vb-parc-fechar")?.addEventListener("click", vbFecharParcela);
  $("btn-vb-parc-salvar")?.addEventListener("click", () => comBotaoTravado("btn-vb-parc-salvar", vbSalvarParcela));
  $("btn-vb-ficha-fechar")?.addEventListener("click", vbFecharFicha);
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarVendasBens);
else ligarVendasBens();

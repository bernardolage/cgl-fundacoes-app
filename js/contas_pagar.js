/* ====================================================================
   Módulo: Contas a pagar (fase 55 — plano "Compras e Custos", §12, etapa A)
   Vive dentro da seção Contratos ("Contratos & Contas a pagar"): as visões A pagar e
   Lançamentos avulsos, os indicadores do painel e a exportação para o Compor 90.
   Os títulos nascem em Compras (recebimento_confirmar) e, na etapa B, nos contratos
   recorrentes; aqui o financeiro os vê e exporta. O pagamento em si fica no Compor 90.
   Depende dos cadastros de apoio de compras.js (cmpCarregarBase, cmpForn, cmpObra, cmpEq,
   abrirCustoAvulso, CMP_CAT_LBL) e de contratos.js (_contratos, contratoEmAlerta).
   Prefixo: cap-.
   ==================================================================== */

let _capTitulos = [];
let _capFiltroVenc = "";        // "" | "vencidos" | "30"
let _capFiltroOrigem = "";      // "" | nf_compra | contrato | avulso (fase 56)
const CAP_ORIGEM_LBL = { nf_compra: "NF de compra", contrato: "Contrato", avulso: "Avulso" };
let _capIncluirExp = false;
let _capLote = null;            // fase 58: lote de exportação em foco (id) — mostra só os títulos daquele arquivo

function capPodeExportar(){ return !!usuarioAtual && ["admin","diretor","financeiro","comprador"].includes(usuarioAtual.cargo); }
function capSoma(lista){ return lista.reduce((s, t) => s + Number(t.valor || 0), 0); }
function capDaqui(dias){ const d = new Date(); d.setDate(d.getDate() + dias); return dataLocalISO(d); }

/* indicadores do painel (títulos pendentes de exportação + contratos em alerta) */
async function capKpis(){
  const bloco = $("cap-indicadores"); if(!bloco) return;
  if(!podeVerContasPagar()){ bloco.style.display = "none"; return; }
  bloco.style.display = "";
  const hoje = hojeISO(), lim = capDaqui(30);
  const { data } = await sb.from("titulos_pagar").select("valor,vencimento").is("exportado_em", null).limit(5000);
  const pend = data || [];
  const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  set("cap-kpi-titulos", pend.length);
  set("cap-kpi-titulos-valor", brl(capSoma(pend)));
  set("cap-kpi-vencidos", pend.filter(t => t.vencimento < hoje).length);
  set("cap-kpi-30", brl(capSoma(pend.filter(t => t.vencimento >= hoje && t.vencimento <= lim))));
  set("cap-kpi-contratos", (typeof _contratos === "object" && _contratos ? _contratos : []).filter(c => typeof contratoEmAlerta === "function" && contratoEmAlerta(c)).length);
}

/* troca a visão do painel de Contratos (botões .serv-view-btn) e renderiza */
function capAtivarView(view){
  document.querySelectorAll("#con-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === view));
  _conView = view;
  renderContratos();
}

/* ---------- A pagar ---------- */
async function renderTitulosPagar(){
  const cont = $("con-conteudo"); if(!cont) return;
  if($("con-lista-titulo")) $("con-lista-titulo").textContent = "A pagar";
  if(!podeVerContasPagar()){ cont.innerHTML = `<p class="vazio">Seu perfil não tem acesso às contas a pagar.</p>`; return; }
  await cmpCarregarBase(false); // nomes de fornecedor, obra e TAG
  const hoje = hojeISO();
  let q = sb.from("titulos_pagar").select("*, recebimento:recebimentos(pedido_id, pedido:pedidos_compra(numero)), contrato:contratos(numero)").order("vencimento").limit(1000);
  if(_capFiltroOrigem) q = q.eq("origem", _capFiltroOrigem);
  if(_capLote) q = q.eq("exportacao_id", _capLote.id);
  else if(!_capIncluirExp) q = q.is("exportado_em", null);
  if(_capFiltroVenc === "vencidos") q = q.lt("vencimento", hoje);
  if(_capFiltroVenc === "30") q = q.gte("vencimento", hoje).lte("vencimento", capDaqui(30));
  const { data, error } = await q;
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  _capTitulos = data || [];
  const pend = _capTitulos.filter(t => !t.exportado_em);
  if($("con-contador")) $("con-contador").textContent = `${_capTitulos.length} título(s)`;
  const podeExp = capPodeExportar();
  cont.innerHTML = `<div class="lista-topo compacta">
      <span class="meta">Títulos gerados no recebimento das notas (Compras) e pelos contratos recorrentes. O pagamento é feito no Compor 90; daqui sai o arquivo do que pagar.</span>
      <select id="cap-f-origem" style="margin-left:auto;"><option value="">Todas as origens</option>${Object.entries(CAP_ORIGEM_LBL).map(([k, v]) => `<option value="${k}"${_capFiltroOrigem === k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
      <select id="cap-f-venc">
        <option value=""${_capFiltroVenc === "" ? " selected" : ""}>Qualquer vencimento</option>
        <option value="vencidos"${_capFiltroVenc === "vencidos" ? " selected" : ""}>Já vencidos</option>
        <option value="30"${_capFiltroVenc === "30" ? " selected" : ""}>Vencem em até 30 dias</option>
      </select>
      <label class="check-inline"><input type="checkbox" id="cap-incluir-exp" ${_capIncluirExp ? "checked" : ""}/> mostrar já exportados</label>
      ${_capLote ? `<span class="tag azul">Lote de ${esc(capDataHora(_capLote.gerado_em))} <button type="button" class="btn-sec btn-sm" id="btn-cap-lote-sair" title="voltar para todos os títulos">✕</button></span> <button type="button" class="btn-sec" id="btn-cap-lote-baixar">⬇️ Baixar este lote de novo</button>` : ""}
      ${podeExp && !_capLote ? `<button type="button" class="btn" id="btn-cap-exportar" ${pend.length ? "" : "disabled"}>⬇️ Exportar ${pend.length} não exportado(s) (CSV)</button>` : ""}
    </div>
    ${!_capTitulos.length ? `<p class="vazio">Nenhum título ${_capIncluirExp ? "" : "pendente de exportação"}${_capFiltroVenc ? " nesse vencimento" : ""}.</p>` : `<div class="tabela-rola"><table>
    <thead><tr><th>Vencimento</th><th>Origem</th><th>Fornecedor</th><th>Documento</th><th>Pedido</th><th>Parcela</th><th class="num">Valor</th><th>Obra</th><th>TAG</th><th>Exportado</th></tr></thead>
    <tbody>${_capTitulos.map(t => { const venc = !t.exportado_em && t.vencimento < hoje; const ped = t.recebimento?.pedido;
      const doc = t.origem === "contrato" ? `<a href="#" class="cap-contrato" data-contrato-id="${esc(t.contrato_id)}">${esc(t.contrato?.numero || "contrato")}</a>${t.competencia ? ` <span class="meta">${String(t.competencia).slice(5, 7)}/${String(t.competencia).slice(0, 4)}</span>` : ""}` : t.origem === "avulso" ? esc(t.nf_numero || t.observacoes || "—") : esc(t.nf_numero || "—");
      return `<tr><td class="${venc ? "txt-perigo" : ""}"><strong>${dataBR(t.vencimento)}</strong>${venc ? " ⚠" : ""}</td><td><span class="tag ${t.origem === "contrato" ? "verde" : t.origem === "avulso" ? "ambar" : "azul"}">${esc(CAP_ORIGEM_LBL[t.origem] || t.origem)}</span></td><td>${esc(cmpForn(t.fornecedor_id) || "—")}</td><td>${doc}</td>
      <td>${ped ? `<a href="#" class="cap-pedido" data-pedido-id="${esc(t.recebimento.pedido_id)}">${esc(ped.numero)}</a>` : '<span class="meta">sem pedido</span>'}</td><td>${t.parcela}/${t.total_parcelas}</td>
      <td class="num">${brl(t.valor)}</td><td>${t.obra_id ? linkObra(t.obra_id, cmpObra(t.obra_id)) : "—"}</td><td>${t.equipamento_id ? esc(cmpEq(t.equipamento_id)) : "—"}</td>
      <td>${t.exportado_em ? `<span class="tag verde">${dataBR(String(t.exportado_em).slice(0, 10))}</span>` : '<span class="tag ambar">pendente</span>'}</td></tr>`; }).join("")}</tbody>
    <tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="num"><strong>${brl(capSoma(_capTitulos))}</strong></td><td colspan="3"></td></tr></tfoot></table></div>`}`;
  $("cap-f-origem")?.addEventListener("change", e => { _capFiltroOrigem = e.target.value; renderTitulosPagar(); });
  cont.querySelectorAll("a.cap-contrato").forEach(a => a.addEventListener("click", e => { e.preventDefault(); abrirContrato(a.dataset.contratoId); }));
  $("cap-f-venc")?.addEventListener("change", e => { _capFiltroVenc = e.target.value; renderTitulosPagar(); });
  $("cap-incluir-exp")?.addEventListener("change", e => { _capIncluirExp = e.target.checked; renderTitulosPagar(); });
  $("btn-cap-exportar")?.addEventListener("click", () => comBotaoTravado("btn-cap-exportar", exportarTitulos));
  $("btn-cap-lote-sair")?.addEventListener("click", () => { _capLote = null; _capIncluirExp = false; renderTitulosPagar(); });
  $("btn-cap-lote-baixar")?.addEventListener("click", () => capBaixarCsv(_capTitulos, _capLote.arquivo || `titulos_a_pagar_${String(_capLote.gerado_em).slice(0, 10)}.csv`));
  cont.querySelectorAll("a.cap-pedido").forEach(a => a.addEventListener("click", e => {
    e.preventDefault();
    if(irParaSecao("compras") && typeof abrirPedido === "function") abrirPedido(a.dataset.pedidoId);
  }));
}

function capDataHora(ts){ return ts ? new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }

/* CSV genérico (o leiaute de importação do Compor 90 entra quando chegar o arquivo de exemplo — plano §7) */
function capBaixarCsv(lista, nomeArquivo){
  const cel = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num2 = v => Number(v || 0).toFixed(2).replace(".", ",");
  const cab = ["Fornecedor","CNPJ/CPF","Documento","Parcela","Total parcelas","Emissao","Vencimento","Valor","Obra","TAG","Observacoes","Origem"];
  const linhas = lista.map(t => { const f = _cmpFornMap[t.fornecedor_id] || {}; const o = _cmpObraMap[t.obra_id];
    const doc = t.origem === "contrato" ? `Contrato ${t.contrato?.numero || ""}${t.competencia ? " " + String(t.competencia).slice(5, 7) + "/" + String(t.competencia).slice(0, 4) : ""}` : (t.nf_numero || "");
    return [f.razao_social || "", f.cpf_cnpj || "", doc, t.parcela, t.total_parcelas, dataBR(t.emissao), dataBR(t.vencimento), num2(t.valor), o ? `${o.codigo} — ${o.nome}` : "", cmpEq(t.equipamento_id), t.observacoes || "", CAP_ORIGEM_LBL[t.origem] || t.origem || ""].map(cel).join(";"); });
  const csv = "\uFEFF" + cab.join(";") + "\n" + linhas.join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = nomeArquivo; a.click();
}

/* Fase 58: a exportação vira um lote (quem, quando, quantos, arquivo); cada título aponta para o lote */
async function exportarTitulos(){
  const pend = _capTitulos.filter(t => !t.exportado_em);
  if(!pend.length) return;
  const arquivo = `titulos_a_pagar_${hojeISO()}_${new Date().toTimeString().slice(0, 5).replace(":", "")}.csv`;
  capBaixarCsv(pend, arquivo);
  if(!confirm(`Arquivo ${arquivo} gerado com ${pend.length} título(s). Marcar como exportados? (Ficam registrados como um lote na visão Exportações.)`)) return;
  const { data: lote, error: eLote } = await sb.from("titulos_exportacoes").insert({ quantidade: pend.length, valor_total: Number(capSoma(pend).toFixed(2)), arquivo }).select("id").single();
  if(eLote){ aviso("app-aviso", "Arquivo gerado, mas o lote não foi registrado: " + eLote.message, "erro"); return; }
  const { error } = await sb.from("titulos_pagar").update({ exportado_em: new Date().toISOString(), exportacao_id: lote.id }).in("id", pend.map(t => t.id));
  if(error){ aviso("app-aviso", "Arquivo gerado, mas não marcou como exportado: " + error.message, "erro"); return; }
  aviso("app-aviso", `${pend.length} título(s) exportado(s) no lote ${arquivo}.`, "ok");
  renderContratos();
}

/* ---------- Exportações (lotes) ---------- */
async function renderExportacoes(){
  const cont = $("con-conteudo"); if(!cont) return;
  if($("con-lista-titulo")) $("con-lista-titulo").textContent = "Exportações";
  if(!podeVerContasPagar()){ cont.innerHTML = `<p class="vazio">Seu perfil não tem acesso às contas a pagar.</p>`; return; }
  const { data, error } = await sb.from("titulos_exportacoes").select("*, autor:profiles(nome)").order("gerado_em", { ascending: false }).limit(300);
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  const lotes = data || [];
  if($("con-contador")) $("con-contador").textContent = `${lotes.length} lote(s)`;
  if(!lotes.length){ cont.innerHTML = `<p class="vazio">Nenhuma exportação ainda. Na visão "A pagar", o botão Exportar gera o arquivo e registra o lote aqui.</p>`; return; }
  cont.innerHTML = `<p class="meta">Cada exportação para o Compor 90 fica registrada como um lote. Clique no lote para ver os títulos e baixar o mesmo arquivo de novo.</p>
    <div class="tabela-rola"><table><thead><tr><th>Gerado em</th><th>Por</th><th class="num">Títulos</th><th class="num">Valor</th><th>Arquivo</th></tr></thead>
    <tbody>${lotes.map(l => `<tr class="cap-lote" data-lote="${esc(l.id)}" style="cursor:pointer;"><td><strong>${esc(capDataHora(l.gerado_em))}</strong></td><td>${esc(l.autor?.nome || "—")}</td><td class="num">${l.quantidade}</td><td class="num">${brl(l.valor_total)}</td><td class="meta">${esc(l.arquivo || "—")}</td></tr>`).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr.cap-lote").forEach(tr => tr.addEventListener("click", () => {
    _capLote = lotes.find(l => l.id === tr.dataset.lote) || null; _capFiltroVenc = ""; _capFiltroOrigem = "";
    capAtivarView("titulos");
  }));
}
/* ---------- Lançamentos avulsos (multa, IPVA, seguro, locação sem NF de produto) ---------- */
async function renderCustosAvulsosCap(){
  const cont = $("con-conteudo"); if(!cont) return;
  if($("con-lista-titulo")) $("con-lista-titulo").textContent = "Lançamentos avulsos";
  await cmpCarregarBase(false);
  const { data, error } = await sb.from("custos_avulsos").select("*").order("data", { ascending: false }).limit(500);
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  if($("con-contador")) $("con-contador").textContent = `${(data || []).length} lançamento(s)`;
  if(!data?.length){ cont.innerHTML = `<p class="vazio">Nenhum lançamento avulso. Use "＋ Custo avulso" para multa, IPVA, seguro, locação… Com vencimento, o lançamento vira também título a pagar.</p>`; return; }
  const podeApagar = !!usuarioAtual && ["admin","diretor","financeiro"].includes(usuarioAtual.cargo);
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>TAG</th><th>Obra</th><th>Fornecedor</th><th>Documento</th><th>Vencimento</th><th class="num">Valor</th>${podeApagar ? "<th></th>" : ""}</tr></thead>
    <tbody>${data.map(c => `<tr><td>${dataBR(c.data)}</td><td>${esc(CMP_CAT_LBL[c.categoria] || c.categoria)}</td><td>${esc(c.descricao)}</td><td>${esc(cmpEq(c.equipamento_id) || "—")}</td>
      <td>${c.obra_id ? linkObra(c.obra_id, cmpObra(c.obra_id)) : "—"}</td><td>${esc(cmpForn(c.fornecedor_id) || "—")}</td><td>${esc(c.documento || "—")}</td><td>${c.vencimento ? dataBR(c.vencimento) : '<span class="meta">sem título</span>'}</td><td class="num">${brl(c.valor)}</td>
      ${podeApagar ? `<td><button type="button" class="btn-sec btn-sm" data-del-av="${esc(c.id)}" title="excluir">✕</button></td>` : ""}</tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="8"><strong>Total</strong></td><td class="num"><strong>${brl(data.reduce((s, c) => s + Number(c.valor || 0), 0))}</strong></td>${podeApagar ? "<td></td>" : ""}</tr></tfoot></table></div>`;
  cont.querySelectorAll("[data-del-av]").forEach(b => b.addEventListener("click", async () => {
    if(!confirm("Excluir este custo avulso?")) return;
    const { error } = await sb.from("custos_avulsos").delete().eq("id", b.dataset.delAv);
    if(error){ aviso("app-aviso", "Não foi possível excluir: " + error.message, "erro"); return; }
    renderCustosAvulsosCap();
  }));
}

/* ---------- ligação ---------- */
function ligarContasPagar(){
  if(!$("con-painel")) return;
  document.querySelectorAll("#cap-indicadores .ind[data-kpi]").forEach(el => el.addEventListener("click", () => {
    const k = el.dataset.kpi;
    if(k === "contratos"){ if($("con-f-vencimento")) $("con-f-vencimento").value = "30"; capAtivarView("lista"); return; }
    _capFiltroVenc = k === "vencidos" ? "vencidos" : k === "30" ? "30" : "";
    _capIncluirExp = false; _capFiltroOrigem = ""; _capLote = null;
    capAtivarView("titulos");
  }));
  $("btn-cap-custo-avulso")?.addEventListener("click", () => abrirCustoAvulso({}, () => capAtivarView("avulsos")));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarContasPagar);
else ligarContasPagar();

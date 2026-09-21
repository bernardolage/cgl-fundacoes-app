/* ====================================================================
   Módulo: Estoque por quantidade (fase 51 — plano de acessórios §4.6)
   - Registrar movimento: entrada (compra), saída (consumo em obra/TAG), ajuste (inventário).
     O gatilho aplicar_movimentacao_estoque atualiza produtos.estoque_atual / custo_ultimo.
   - Reposição: só SKUs com controle_reposicao (atual · mínimo · ideal · a comprar) + lista de compra.
   - Últimos movimentos.
   ==================================================================== */

let _estTipo = "entrada";          // tipo do movimento em edição
let _estProd = null;               // produto escolhido no formulário
let _estHist = [];                 // últimos movimentos
let _estHistTipo = "";             // filtro do histórico
let _estRep = [];                  // itens controlados
let _estProdMap = {};              // id -> produto (para o histórico)
let _estObras = [];
let _estEquips = [];
let _estCtrlProd = null;           // produto escolhido no modal "controlar"
let _estCarregado = false;

const EST_TIPO_LBL = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", devolucao: "Devolução", transferencia: "Transferência" };
const EST_TIPO_COR = { entrada: "verde", saida: "ambar", ajuste: "azul", devolucao: "verde", transferencia: "cinza" };
const EST_AJUDA = {
  entrada: "Compra ou recebimento: soma ao estoque e atualiza o custo do produto.",
  saida: "Consumo ou envio para obra: desconta do estoque. Informe a obra e a TAG quando souber — é o que mostra onde o material foi parar.",
  ajuste: "Inventário: informe a quantidade CONTADA; o sistema lança a diferença para o estoque ficar igual à contagem."
};

function estPodeEditar(){
  return !!usuarioAtual && ["admin","diretor","almoxarife","comprador","gestor_acessorios"].includes(usuarioAtual.cargo);
}
function estProdTxt(p){ return p ? `${p.codigo} — ${p.nome}` : "—"; }

/* ---------- carga ---------- */
async function carregarEstoque(force){
  if(!$("est-reposicao")) return;
  if(force || !_estCarregado){
    const [fo, ob, eq] = await Promise.all([
      sb.from("fornecedores").select("id,razao_social").eq("ativo", true).order("razao_social"),
      sb.from("obras").select("id,codigo,nome,status").in("status", ["em_andamento","planejada","paralisada"]).order("codigo", { ascending: false }),
      sb.from("equipamentos").select("id,codigo,nome,tipo").eq("ativo", true).not("tipo", "in", "(caminhao,veiculo)").order("codigo")
    ]);
    $("ent-fornecedor").innerHTML = '<option value="">— não informado —</option>' + (fo.data || []).map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}</option>`).join("");
    _estObras = ob.data || []; _estEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
    $("est-obra").innerHTML = '<option value="">— nenhuma —</option>' + _estObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("");
    $("est-equip").innerHTML = '<option value="">— nenhum —</option>' + _estEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
    _estCarregado = true;
  }
  const pode = estPodeEditar();
  ["btn-registrar-entrada","btn-est-controlar"].forEach(id => { const b = $(id); if(b) b.style.display = pode ? "" : "none"; });
  estAplicarTipo();
  await Promise.all([carregarReposicao(), carregarUltimasEntradas()]);
}
/* compat: core.js (carga inicial) e fornecedores.js chamam carregarFornecedores() — só o select */
async function carregarFornecedores(){
  const sel = $("ent-fornecedor"); if(!sel) return;
  const { data } = await sb.from("fornecedores").select("id,razao_social").eq("ativo", true).order("razao_social");
  sel.innerHTML = '<option value="">— não informado —</option>' + (data || []).map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}</option>`).join("");
}

/* ---------- formulário de movimento ---------- */
function estAplicarTipo(){
  document.querySelectorAll("#est-tipos .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.tipo === _estTipo));
  $("est-tipo-ajuda").textContent = EST_AJUDA[_estTipo] || "";
  document.querySelectorAll(".est-so-entrada").forEach(el => el.style.display = _estTipo === "entrada" ? "" : "none");
  document.querySelectorAll(".est-so-saida").forEach(el => el.style.display = _estTipo === "saida" ? "" : "none");
  $("est-qtd-label").textContent = _estTipo === "ajuste" ? "Quantidade contada *" : "Quantidade *";
  $("btn-registrar-entrada").textContent = _estTipo === "entrada" ? "💾 Registrar entrada" : _estTipo === "saida" ? "💾 Registrar saída" : "💾 Lançar contagem";
  estMostrarProdInfo();
}
function estMostrarProdInfo(){
  const el = $("est-prod-info"); if(!el) return;
  if(!_estProd){ el.textContent = ""; return; }
  const p = _estProd;
  el.innerHTML = `<strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} · estoque atual <strong>${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}</strong>` +
    (p.custo_ultimo ? ` · último custo ${brl(p.custo_ultimo)}` : "") +
    (p.controle_reposicao ? ` · <span class="tag azul">reposição</span> mín. ${num(p.estoque_minimo || 0)} · ideal ${p.estoque_ideal != null ? num(p.estoque_ideal) : "—"}` : "") +
    (_estTipo === "ajuste" ? ` · <span class="meta">a contagem substitui o atual</span>` : "");
}
async function estBuscarProdutos(termo){
  if(!termo || termo.length < 2) return [];
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data } = await sb.from("produtos")
    .select("id,codigo,nome,unidade,estoque_atual,estoque_minimo,estoque_ideal,controle_reposicao,custo_ultimo")
    .eq("ativo", true).or(`nome.ilike.%${t}%,codigo.ilike.%${t}%`).order("nome").limit(25);
  return data || [];
}
function estLigarBuscaProduto(inpId, listaId, aoEscolher){
  const inp = $(inpId), lista = $(listaId); if(!inp || !lista) return;
  let t = null;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = inp.value.trim();
      if(termo.length < 2){ lista.innerHTML = ""; lista.style.display = "none"; return; }
      const res = await estBuscarProdutos(termo);
      lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}${p.controle_reposicao ? " · reposição" : ""}</span></div>`).join("")
        : `<div class="resultado-item vazio">Nenhum produto encontrado. Cadastre em Produtos.</div>`;
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => {
        const p = res.find(x => x.id === d.dataset.id);
        inp.value = estProdTxt(p); lista.innerHTML = ""; lista.style.display = "none";
        aoEscolher(p);
      }));
    }, 250);
  });
}
function estSelecionarProduto(p){
  _estProd = p || null;
  const sel = $("ent-produto");
  if(sel){ sel.innerHTML = p ? `<option value="${esc(p.id)}" selected>${esc(estProdTxt(p))}</option>` : ""; }
  estMostrarProdInfo();
}
/* atalho da Reposição: prepara o formulário para o item */
function estPrepararMovimento(tipo, p){
  _estTipo = tipo; estAplicarTipo();
  $("est-busca-prod").value = estProdTxt(p); estSelecionarProduto(p);
  $("ent-qtd").value = tipo === "ajuste" ? (p.estoque_atual ?? "") : "";
  $("ent-qtd").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function registrarEntrada(){
  if(!estPodeEditar()){ aviso("app-aviso", "Seu perfil não movimenta estoque.", "erro"); return; }
  if(!_estProd){ aviso("app-aviso", "Escolha um produto.", "erro"); $("est-busca-prod").focus(); return; }
  const qtdInformada = Number($("ent-qtd").value);
  if($("ent-qtd").value === "" || isNaN(qtdInformada) || qtdInformada < 0){ aviso("app-aviso", "Informe a quantidade.", "erro"); return; }
  const reg = {
    produto_id: _estProd.id, tipo: _estTipo, quantidade: qtdInformada,
    custo_unitario: 0, fornecedor_id: null, obra_id: null, equipamento_id: null,
    documento: $("ent-doc").value.trim() || null, observacoes: $("est-mov-obs").value.trim() || null
  };
  if(_estTipo === "entrada"){
    if(qtdInformada <= 0){ aviso("app-aviso", "Informe a quantidade.", "erro"); return; }
    reg.custo_unitario = Number($("ent-custo").value);
    if(!(reg.custo_unitario >= 0) || $("ent-custo").value === ""){ aviso("app-aviso", "Informe o custo unitário.", "erro"); return; }
    reg.fornecedor_id = $("ent-fornecedor").value || null;
  } else if(_estTipo === "saida"){
    if(qtdInformada <= 0){ aviso("app-aviso", "Informe a quantidade.", "erro"); return; }
    if(qtdInformada > Number(_estProd.estoque_atual || 0) && !confirm(`Saída de ${num(qtdInformada)} com estoque atual ${num(_estProd.estoque_atual || 0)}. O saldo vai ficar negativo. Continuar?`)) return;
    reg.obra_id = $("est-obra").value || null;
    reg.equipamento_id = $("est-equip").value || null;
    reg.custo_unitario = Number(_estProd.custo_ultimo || 0);
  } else { // ajuste: delta = contado - atual
    const delta = qtdInformada - Number(_estProd.estoque_atual || 0);
    if(delta === 0){ aviso("app-aviso", "A contagem é igual ao estoque atual. Nada a lançar.", "ok"); return; }
    reg.quantidade = delta;
    reg.documento = reg.documento || "Inventário";
    reg.observacoes = [`Contagem: ${num(qtdInformada)} (antes ${num(_estProd.estoque_atual || 0)})`, reg.observacoes].filter(Boolean).join(" · ");
  }
  const { error } = await sb.from("movimentacoes_estoque").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível registrar: " + error.message, "erro"); return; }
  aviso("app-aviso", _estTipo === "entrada" ? "Entrada registrada — estoque e custo atualizados." : _estTipo === "saida" ? "Saída registrada." : "Contagem lançada — estoque ajustado.", "ok");
  ["ent-qtd","ent-custo","ent-doc","est-mov-obs","est-busca-prod"].forEach(id => { const el = $(id); if(el) el.value = ""; });
  $("est-obra").value = ""; $("est-equip").value = "";
  estSelecionarProduto(null);
  if(typeof carregarProdutos === "function") await carregarProdutos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  await Promise.all([carregarReposicao(), carregarUltimasEntradas()]);
}

async function criarNovoFornecedorRapido(){
  const nome = prompt("Razão social do novo fornecedor:");
  if(!nome) return;
  const { error } = await sb.from("fornecedores").insert({ razao_social: nome.trim() });
  if(error){ aviso("app-aviso", "Erro ao criar fornecedor: " + error.message, "erro"); return; }
  _estCarregado = false; await carregarEstoque(true);
  aviso("app-aviso", "Fornecedor criado.", "ok");
}

/* ---------- Reposição ---------- */
function estAComprar(p){
  const alvo = p.estoque_ideal != null ? Number(p.estoque_ideal) : Number(p.estoque_minimo || 0);
  return Math.max(0, alvo - Number(p.estoque_atual || 0));
}
function estSituacao(p){
  const atual = Number(p.estoque_atual || 0), min = Number(p.estoque_minimo || 0), ideal = p.estoque_ideal != null ? Number(p.estoque_ideal) : null;
  if(atual <= 0 && (ideal > 0 || min > 0)) return ["zerado", "vermelho"];
  if(min > 0 && atual <= min) return ["abaixo do mínimo", "vermelho"];
  if(ideal != null && atual < ideal) return ["abaixo do ideal", "ambar"];
  return ["ok", "verde"];
}
async function carregarReposicao(){
  const cont = $("est-reposicao"); if(!cont) return;
  const { data, error } = await sb.from("produtos")
    .select("id,codigo,nome,unidade,estoque_atual,estoque_minimo,estoque_ideal,controle_reposicao,custo_ultimo,localizacao")
    .eq("controle_reposicao", true).eq("ativo", true).order("nome");
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  _estRep = data || [];
  renderReposicao();
}
function estRepFiltrados(){
  const q = ($("est-rep-busca")?.value || "").trim().toLowerCase();
  const soFalta = !!$("est-rep-so-falta")?.checked;
  return _estRep.filter(p => (!q || `${p.codigo} ${p.nome}`.toLowerCase().includes(q)) && (!soFalta || estAComprar(p) > 0));
}
function renderReposicao(){
  const cont = $("est-reposicao"); if(!cont) return;
  const lista = estRepFiltrados();
  const falta = _estRep.filter(p => estAComprar(p) > 0).length;
  $("est-rep-contador").textContent = `${_estRep.length} item(ns) · ${falta} a repor`;
  if(!_estRep.length){ cont.innerHTML = `<p class="vazio">Nenhum item controlado. Use <em>+ Controlar item</em> ou marque "Controlar na lista de reposição" na ficha do produto.</p>`; return; }
  if(!lista.length){ cont.innerHTML = `<p class="vazio">Nada com esse filtro.</p>`; return; }
  const pode = estPodeEditar();
  cont.innerHTML = `<div class="tabela-rola"><table class="est-rep-tabela">
    <thead><tr><th>Código</th><th>Item</th><th class="num">Atual</th><th class="num">Mínimo</th><th class="num">Ideal</th><th class="num">A comprar</th><th>Situação</th>${pode ? "<th></th>" : ""}</tr></thead>
    <tbody>${lista.map(p => { const [sit, cor] = estSituacao(p); const ac = estAComprar(p); return `<tr class="${cor === "vermelho" ? "est-rep-critico" : ""}" data-id="${esc(p.id)}">
      <td><strong>${esc(p.codigo)}</strong></td>
      <td>${esc(p.nome)}${p.localizacao ? ` <span class="meta">· ${esc(p.localizacao)}</span>` : ""}</td>
      <td class="num"><strong>${num(p.estoque_atual || 0)}</strong> <span class="meta">${esc(p.unidade || "un")}</span></td>
      <td class="num">${pode ? `<input type="number" class="est-rep-min" data-id="${esc(p.id)}" value="${esc(p.estoque_minimo ?? 0)}" min="0" step="1" style="width:64px;text-align:right;" />` : num(p.estoque_minimo || 0)}</td>
      <td class="num">${pode ? `<input type="number" class="est-rep-ideal" data-id="${esc(p.id)}" value="${p.estoque_ideal ?? ""}" min="0" step="1" style="width:64px;text-align:right;" />` : (p.estoque_ideal != null ? num(p.estoque_ideal) : "—")}</td>
      <td class="num">${ac > 0 ? `<strong>${num(ac)}</strong>` : "—"}</td>
      <td><span class="tag ${cor}">${esc(sit)}</span></td>
      ${pode ? `<td style="white-space:nowrap;"><button type="button" class="btn-sec btn-sm" data-mov="entrada" data-id="${esc(p.id)}" title="registrar entrada">＋</button> <button type="button" class="btn-sec btn-sm" data-mov="saida" data-id="${esc(p.id)}" title="registrar saída">－</button> <button type="button" class="btn-sec btn-sm" data-mov="ajuste" data-id="${esc(p.id)}" title="lançar contagem">📋</button> <button type="button" class="btn-sec btn-sm" data-mov="tirar" data-id="${esc(p.id)}" title="tirar da lista de reposição">✕</button></td>` : ""}
    </tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll(".est-rep-min, .est-rep-ideal").forEach(inp => inp.addEventListener("change", async () => {
    const campo = inp.classList.contains("est-rep-min") ? "estoque_minimo" : "estoque_ideal";
    const v = inp.value === "" ? (campo === "estoque_minimo" ? 0 : null) : Number(inp.value);
    const { error } = await sb.from("produtos").update({ [campo]: v }).eq("id", inp.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
    const p = _estRep.find(x => x.id === inp.dataset.id); if(p) p[campo] = v;
    renderReposicao();
  }));
  cont.querySelectorAll("button[data-mov]").forEach(b => b.addEventListener("click", async () => {
    const p = _estRep.find(x => x.id === b.dataset.id); if(!p) return;
    if(b.dataset.mov === "tirar"){
      if(!confirm(`Tirar ${p.codigo} da lista de reposição? O produto continua no cadastro.`)) return;
      const { error } = await sb.from("produtos").update({ controle_reposicao: false }).eq("id", p.id);
      if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
      await carregarReposicao(); return;
    }
    estPrepararMovimento(b.dataset.mov, p);
  }));
}
function estGerarListaCompra(){
  const itens = _estRep.filter(p => estAComprar(p) > 0).map(p => ({
    "Código": p.codigo, "Item": p.nome, "Un": p.unidade || "un", "Estoque atual": Number(p.estoque_atual || 0),
    "Mínimo": Number(p.estoque_minimo || 0), "Ideal": p.estoque_ideal != null ? Number(p.estoque_ideal) : "", "A comprar": estAComprar(p),
    "Último custo": Number(p.custo_ultimo || 0), "Estimativa": Number(((p.custo_ultimo || 0) * estAComprar(p)).toFixed(2))
  }));
  if(!itens.length){ aviso("app-aviso", "Nada a comprar: todos os itens controlados estão no ideal.", "ok"); return; }
  const nome = `lista_compra_${hojeISO()}`;
  if(typeof XLSX !== "undefined"){
    const ws = XLSX.utils.json_to_sheet(itens);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "LISTA DE COMPRA");
    XLSX.writeFile(wb, nome + ".xlsx");
  } else {
    const cab = Object.keys(itens[0]);
    const csv = [cab.join(";"), ...itens.map(i => cab.map(k => String(i[k]).replace(/;/g, ",")).join(";"))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })); a.download = nome + ".csv"; a.click();
  }
  aviso("app-aviso", `Lista de compra gerada: ${itens.length} item(ns), ${brl(itens.reduce((s, i) => s + i["Estimativa"], 0))} estimados pelo último custo.`, "ok");
}

/* modal: controlar item */
function abrirControlarItem(){
  if(!estPodeEditar()) return;
  _estCtrlProd = null;
  $("est-ctrl-busca").value = ""; $("est-ctrl-res").innerHTML = ""; $("est-ctrl-res").style.display = "none";
  $("est-ctrl-info").textContent = "Nenhum produto escolhido.";
  $("est-ctrl-min").value = ""; $("est-ctrl-ideal").value = ""; $("est-ctrl-contagem").value = "";
  $("est-ctrl-modal").style.display = "flex";
}
function fecharControlarItem(){ $("est-ctrl-modal").style.display = "none"; }
async function salvarControlarItem(){
  const p = _estCtrlProd;
  if(!p){ aviso("app-aviso", "Escolha o produto.", "erro"); return; }
  const min = $("est-ctrl-min").value === "" ? 0 : Number($("est-ctrl-min").value);
  const ideal = $("est-ctrl-ideal").value === "" ? null : Number($("est-ctrl-ideal").value);
  const { error } = await sb.from("produtos").update({ controle_reposicao: true, estoque_minimo: min, estoque_ideal: ideal }).eq("id", p.id);
  if(error){ aviso("app-aviso", "Não foi possível controlar o item: " + error.message, "erro"); return; }
  if($("est-ctrl-contagem").value !== ""){
    const delta = Number($("est-ctrl-contagem").value) - Number(p.estoque_atual || 0);
    if(delta !== 0){
      const { error: e2 } = await sb.from("movimentacoes_estoque").insert({ produto_id: p.id, tipo: "ajuste", quantidade: delta, custo_unitario: 0, documento: "Inventário inicial", observacoes: `Contagem: ${num(Number($("est-ctrl-contagem").value))} (antes ${num(p.estoque_atual || 0)})` });
      if(e2) aviso("app-aviso", "Item controlado, mas a contagem não foi lançada: " + e2.message, "erro");
    }
  }
  aviso("app-aviso", `${p.codigo} entrou na lista de reposição.`, "ok");
  fecharControlarItem();
  if(typeof carregarProdutos === "function") carregarProdutos();
  await Promise.all([carregarReposicao(), carregarUltimasEntradas()]);
}

/* ---------- Últimos movimentos ---------- */
async function carregarUltimasEntradas(){
  let q = sb.from("movimentacoes_estoque")
    .select("id,produto_id,tipo,quantidade,custo_unitario,custo_total,fornecedor_id,obra_id,equipamento_id,documento,observacoes,data_movimentacao,produto:produtos(codigo,nome,unidade)")
    .order("data_movimentacao", { ascending: false }).limit(100);
  if(_estHistTipo) q = q.eq("tipo", _estHistTipo);
  const { data, error } = await q;
  _estHist = error ? [] : (data || []);
  if(error) console.warn("movimentos de estoque:", error.message);
  renderUltimasEntradas();
}
function renderUltimasEntradas(){
  const cont = $("ent-historico"); if(!cont) return;
  document.querySelectorAll("#est-hist-tipos .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.tipo === _estHistTipo));
  const termo = ($("ent-busca")?.value || "").trim().toLowerCase();
  const obraTxt = id => { const o = _estObras.find(x => x.id === id); return o ? `${o.codigo} — ${o.nome}` : ((typeof mapaObras === "object" && mapaObras && mapaObras[id]) || ""); };
  const eqTxt = id => { const e = _estEquips.find(x => x.id === id); return e ? e.codigo : ""; };
  const prodTxt = m => m.produto ? `${m.produto.codigo} — ${m.produto.nome}` : (_estProdMap[m.produto_id] || "—");
  const filtradas = _estHist.filter(m => {
    if(!termo) return true;
    return [prodTxt(m), mapaFornecedores[m.fornecedor_id], obraTxt(m.obra_id), m.equipamento_id ? "tag " + eqTxt(m.equipamento_id) : "", EST_TIPO_LBL[m.tipo], m.documento, m.observacoes].filter(Boolean).join(" ").toLowerCase().includes(termo);
  });
  if(!filtradas.length){ cont.innerHTML = `<p class="vazio">Nenhum movimento.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th class="num">Qtd</th><th class="num">Custo unit.</th><th>Fornecedor / destino</th><th>Documento</th><th>Obs.</th></tr></thead>
    <tbody>${filtradas.map(m => {
      const d = new Date(m.data_movimentacao);
      const destino = m.tipo === "entrada" ? (mapaFornecedores[m.fornecedor_id] || "—")
        : [m.obra_id ? linkObra(m.obra_id, obraTxt(m.obra_id) || "obra") : "", m.equipamento_id ? "TAG " + esc(eqTxt(m.equipamento_id)) : ""].filter(Boolean).join(" · ") || "—";
      const q = Number(m.quantidade || 0);
      return `<tr>
        <td>${isNaN(d) ? "—" : d.toLocaleDateString("pt-BR")}</td>
        <td><span class="tag ${EST_TIPO_COR[m.tipo] || "cinza"}">${esc(EST_TIPO_LBL[m.tipo] || m.tipo)}</span></td>
        <td>${esc(prodTxt(m))}</td>
        <td class="num">${m.tipo === "saida" || q < 0 ? "−" : (m.tipo === "ajuste" ? "+" : "")}${num(Math.abs(q))} <span class="meta">${esc(m.produto?.unidade || "")}</span></td>
        <td class="num">${m.custo_unitario ? brl(m.custo_unitario) : "—"}</td>
        <td>${m.tipo === "entrada" ? esc(destino) : destino}</td>
        <td>${esc(m.documento || "—")}</td>
        <td class="meta">${esc(m.observacoes || "")}</td>
      </tr>`; }).join("")}</tbody></table></div>`;
}

/* ---------- Listeners ---------- */
function ligarEstoque(){
  if(!$("sec-estoque")) return;
  $("btn-registrar-entrada")?.addEventListener("click", () => comBotaoTravado("btn-registrar-entrada", registrarEntrada));
  $("btn-novo-forn")?.addEventListener("click", criarNovoFornecedorRapido);
  $("ent-busca")?.addEventListener("input", debounce(renderUltimasEntradas));
  document.querySelectorAll("#est-tipos .serv-view-btn").forEach(b => b.addEventListener("click", () => { _estTipo = b.dataset.tipo; estAplicarTipo(); }));
  document.querySelectorAll("#est-hist-tipos .serv-view-btn").forEach(b => b.addEventListener("click", () => { _estHistTipo = b.dataset.tipo; carregarUltimasEntradas(); }));
  estLigarBuscaProduto("est-busca-prod", "est-res-prod", estSelecionarProduto);
  estLigarBuscaProduto("est-ctrl-busca", "est-ctrl-res", p => {
    _estCtrlProd = p;
    $("est-ctrl-info").innerHTML = `<strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} · atual ${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}${p.controle_reposicao ? " · já controlado (vai atualizar mínimo/ideal)" : ""}`;
    $("est-ctrl-min").value = p.estoque_minimo ?? ""; $("est-ctrl-ideal").value = p.estoque_ideal ?? "";
  });
  $("est-busca-prod")?.addEventListener("input", () => { if(_estProd && $("est-busca-prod").value !== estProdTxt(_estProd)) estSelecionarProduto(null); });
  $("est-rep-busca")?.addEventListener("input", debounce(renderReposicao));
  $("est-rep-so-falta")?.addEventListener("change", renderReposicao);
  $("btn-est-lista-compra")?.addEventListener("click", estGerarListaCompra);
  $("btn-est-controlar")?.addEventListener("click", abrirControlarItem);
  $("btn-est-ctrl-fechar")?.addEventListener("click", fecharControlarItem);
  $("btn-est-ctrl-salvar")?.addEventListener("click", () => comBotaoTravado("btn-est-ctrl-salvar", salvarControlarItem));
  document.querySelector('nav button[data-secao="estoque"]')?.addEventListener("click", () => carregarEstoque(false));
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarEstoque);
} else {
  ligarEstoque();
}

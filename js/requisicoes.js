/* ====================================================================
   Módulo: Requisições (fase 60 — plano Compras §6 fase 3)
   Quem precisa pede (campo, oficina, almoxarifado, engenharia): item, quantidade, obra ou TAG,
   urgência e justificativa. O comprador junta requisições pendentes e gera o pedido de compra
   (RPC requisicoes_gerar_pedido); o almoxarife pode atender direto do estoque. Vive dentro de
   Compras (visão "Requisições" + indicador) e na lista de Reposição do Estoque ("Requisitar o
   que falta"). Depende de compras.js (cmpCarregarBase, cmpObra, cmpEq, cmpLigarBusca, abrirPedido).
   Prefixo: req-.
   ==================================================================== */

let _reqLista = [];
let _reqSel = new Set();          // requisições marcadas para virar pedido
let _reqAtual = null;             // requisição aberta no modal (null = nova)
let _reqItens = [];               // itens em edição (nova)
let _reqFiltroSt = "pendente";
let _reqBuscaLigada = false;

const REQ_STATUS = {
  pendente:  ["Pendente",              "ambar"],
  aprovada:  ["Em compra",             "azul"],
  separada:  ["Atendida pelo estoque", "verde"],
  atendida:  ["Atendida",              "verde"],
  rejeitada: ["Rejeitada",             "vermelho"],
  cancelada: ["Cancelada",             "cinza"]
};
const REQ_PRIORIDADE = { normal: "Normal", urgente: "Urgente" };

function reqPodePedir(){
  return !!usuarioAtual && ["admin","diretor","comprador","almoxarife","encarregado","engenheiro","assistente_engenharia","mecanico","operador","logistica","gestor_acessorios","financeiro"].includes(usuarioAtual.cargo);
}
function reqPodeDecidir(){ return typeof cmpPodeOperar === "function" && cmpPodeOperar(); }
function reqTag(st){ const o = REQ_STATUS[st] || [st, "cinza"]; return `<span class="tag ${o[1]}">${esc(o[0])}</span>`; }
function reqDestino(r){ return r.equipamento_id ? "TAG " + (cmpEq(r.equipamento_id) || "?") : r.obra_id ? (cmpObra(r.obra_id) || "obra") : "Estoque (base)"; }
function reqItemNome(it){ return it.produto ? `${it.produto.codigo} — ${it.produto.nome}` : (it.descricao || "item"); }

/* ---------- visão dentro de Compras ---------- */
async function renderRequisicoes(){
  const cont = $("cmp-conteudo"); if(!cont) return;
  await cmpCarregarBase(false);
  let q = sb.from("requisicoes")
    .select("*, solicitante:profiles!requisicoes_solicitado_por_fkey(nome), pedido:pedidos_compra(id,numero,status), itens:requisicao_itens(id,produto_id,descricao,unidade,quantidade_solicitada,quantidade_atendida,produto:produtos(codigo,nome,unidade,fornecedor_padrao_id))")
    .order("created_at", { ascending: false }).limit(500);
  if(_reqFiltroSt) q = q.eq("status", _reqFiltroSt);
  const { data, error } = await q;
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  _reqLista = data || [];
  _reqSel = new Set([..._reqSel].filter(id => _reqLista.some(r => r.id === id && r.status === "pendente")));
  $("cmp-contador").textContent = `${_reqLista.length} requisição(ões)`;
  const decide = reqPodeDecidir();
  cont.innerHTML = `<div class="lista-topo compacta">
      <span class="meta">Quem precisa pede aqui; o comprador junta as pendentes do mesmo fornecedor e gera o pedido. Pedido recebido = requisição atendida.</span>
      <select id="req-f-status" style="margin-left:auto;"><option value="">Todos os status</option>${Object.entries(REQ_STATUS).map(([k, v]) => `<option value="${k}"${_reqFiltroSt === k ? " selected" : ""}>${esc(v[0])}</option>`).join("")}</select>
      ${decide ? `<button type="button" class="btn" id="btn-req-gerar" ${_reqSel.size ? "" : "disabled"}>🛒 Gerar pedido com ${_reqSel.size} selecionada(s)</button>` : ""}
    </div>
    ${!_reqLista.length ? `<p class="vazio">Nenhuma requisição${_reqFiltroSt ? " " + (REQ_STATUS[_reqFiltroSt] || [""])[0].toLowerCase() : ""}. Use "+ Requisição" para pedir material ou serviço.</p>` : `<div class="tabela-rola"><table>
    <thead><tr>${decide ? "<th></th>" : ""}<th>Número</th><th>Data</th><th>Quem pediu</th><th>Destino</th><th>Prioridade</th><th>Itens</th><th>Status</th><th>Pedido</th></tr></thead>
    <tbody>${_reqLista.map(r => { const its = r.itens || []; const resumo = its.slice(0, 2).map(i => `${num(i.quantidade_solicitada)} ${esc(i.unidade || i.produto?.unidade || "un")} ${esc(reqItemNome(i))}`).join(" · ") + (its.length > 2 ? ` · +${its.length - 2}` : "");
      return `<tr class="linha-clicavel" data-req="${esc(r.id)}">${decide ? `<td>${r.status === "pendente" ? `<input type="checkbox" class="req-sel" data-id="${esc(r.id)}" ${_reqSel.has(r.id) ? "checked" : ""}/>` : ""}</td>` : ""}
      <td><strong>${esc(r.numero || "—")}</strong></td><td>${dataBR(r.data_requisicao)}</td><td>${esc(r.solicitante?.nome || "—")}</td>
      <td>${r.obra_id && !r.equipamento_id ? linkObra(r.obra_id, cmpObra(r.obra_id)) : esc(reqDestino(r))}</td>
      <td>${r.prioridade === "urgente" ? '<span class="tag vermelho">Urgente</span>' : '<span class="meta">normal</span>'}</td>
      <td class="meta" title="${esc(its.map(i => `${num(i.quantidade_solicitada)} ${reqItemNome(i)}`).join("\n"))}">${its.length} · ${resumo}</td>
      <td>${reqTag(r.status)}</td><td>${r.pedido ? `<a href="#" class="req-pedido" data-pedido="${esc(r.pedido.id)}">${esc(r.pedido.numero)}</a>` : "—"}</td></tr>`; }).join("")}</tbody></table></div>`}`;
  $("req-f-status")?.addEventListener("change", e => { _reqFiltroSt = e.target.value; renderRequisicoes(); });
  $("btn-req-gerar")?.addEventListener("click", reqAbrirGerarPedido);
  cont.querySelectorAll(".req-sel").forEach(cb => cb.addEventListener("change", () => { if(cb.checked) _reqSel.add(cb.dataset.id); else _reqSel.delete(cb.dataset.id); const b = $("btn-req-gerar"); if(b){ b.disabled = !_reqSel.size; b.textContent = `🛒 Gerar pedido com ${_reqSel.size} selecionada(s)`; } }));
  cont.querySelectorAll("a.req-pedido").forEach(a => a.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); abrirPedido(a.dataset.pedido); }));
}

/* ---------- modal: nova requisição / detalhe ---------- */
async function abrirRequisicao(r){
  if(!r && !reqPodePedir()){ aviso("app-aviso", "Seu perfil não abre requisições.", "erro"); return; }
  await cmpCarregarBase(false);
  _reqAtual = r || null; _reqItens = r ? (r.itens || []).map(i => ({ ...i })) : [];
  const nova = !r;
  const set = (id, html) => { const el = $(id); if(el){ const v = el.value; el.innerHTML = html; el.value = v; } };
  set("req-obra", `<option value="">— nenhuma —</option>` + _cmpObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join(""));
  set("req-equip", `<option value="">— nenhuma —</option>` + _cmpEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join(""));
  $("req-titulo").textContent = nova ? "Nova requisição" : `${r.numero} · ${(REQ_STATUS[r.status] || [r.status])[0]}`;
  $("req-obra").value = r?.obra_id || ""; $("req-equip").value = r?.equipamento_id || "";
  $("req-prioridade").value = r?.prioridade || "normal"; $("req-just").value = r?.justificativa || "";
  ["req-obra","req-equip","req-prioridade","req-just"].forEach(id => $(id).disabled = !nova);
  $("req-itens-add").style.display = nova ? "" : "none";
  $("req-meta").innerHTML = nova ? "" : `Pedido por <strong>${esc(r.solicitante?.nome || "—")}</strong> em ${dataBR(r.data_requisicao)}${r.pedido ? ` · pedido <strong>${esc(r.pedido.numero)}</strong>` : ""}${r.motivo_rejeicao ? ` · <span class="txt-perigo">rejeitada: ${esc(r.motivo_rejeicao)}</span>` : ""}`;
  const decide = reqPodeDecidir(), minha = r && usuarioAtual && r.solicitado_por === usuarioAtual.id;
  $("btn-req-salvar").style.display = nova ? "" : "none";
  $("btn-req-rejeitar").style.display = !nova && decide && r.status === "pendente" ? "" : "none";
  $("btn-req-estoque").style.display = !nova && decide && r.status === "pendente" ? "" : "none";
  $("btn-req-pedido").style.display = !nova && decide && r.status === "pendente" ? "" : "none";
  $("btn-req-cancelar").style.display = !nova && (decide || minha) && r.status === "pendente" ? "" : "none";
  reqRenderItens();
  if(nova && !_reqBuscaLigada){ cmpLigarBusca("req-busca", "req-res", p => reqAddItem(p)); _reqBuscaLigada = true; }
  $("cmp-req-modal").style.display = "flex";
}
function fecharRequisicao(){ $("cmp-req-modal").style.display = "none"; _reqAtual = null; _reqItens = []; }
function reqRenderItens(){
  const tb = $("req-itens"); if(!tb) return;
  const nova = !_reqAtual;
  if(!_reqItens.length){ tb.innerHTML = `<tr><td colspan="4" class="vazio">Nenhum item. Busque o produto acima ou adicione um item livre.</td></tr>`; return; }
  tb.innerHTML = _reqItens.map((it, idx) => `<tr data-idx="${idx}">
    <td>${it.produto_id ? `<strong>${esc(it.produto?.codigo || "")}</strong> ${esc(it.produto?.nome || it.descricao || "")}` : nova ? `<input type="text" data-f="descricao" value="${esc(it.descricao || "")}" placeholder="descrição do item ou serviço" style="min-width:260px;" />` : esc(it.descricao || "item")}</td>
    <td class="num">${nova ? `<input type="number" data-f="quantidade_solicitada" value="${it.quantidade_solicitada ?? 1}" min="0" step="0.001" style="width:90px;text-align:right;" />` : num(it.quantidade_solicitada)}${!nova && it.quantidade_atendida ? ` <span class="meta">(atendido ${num(it.quantidade_atendida)})</span>` : ""}</td>
    <td>${nova ? `<input type="text" data-f="unidade" value="${esc(it.unidade || it.produto?.unidade || "un")}" style="width:60px;" />` : esc(it.unidade || "un")}</td>
    <td class="col-acao">${nova ? `<button type="button" class="btn-sec btn-sm txt-perigo" data-rem="${idx}">×</button>` : ""}</td></tr>`).join("");
  if(!nova) return;
  tb.querySelectorAll("input[data-f]").forEach(inp => inp.addEventListener("input", () => { const it = _reqItens[Number(inp.closest("tr").dataset.idx)]; it[inp.dataset.f] = inp.type === "number" ? Number(inp.value) : inp.value; }));
  tb.querySelectorAll("button[data-rem]").forEach(b => b.addEventListener("click", () => { _reqItens.splice(Number(b.dataset.rem), 1); reqRenderItens(); }));
}
function reqAddItem(p){
  if(p && _reqItens.some(i => i.produto_id === p.id)){ aviso("app-aviso", "Esse produto já está na requisição.", "erro"); return; }
  _reqItens.push({ produto_id: p?.id || null, produto: p ? { codigo: p.codigo, nome: p.nome, unidade: p.unidade } : null, descricao: p ? `${p.codigo} — ${p.nome}` : "", unidade: p?.unidade || "un", quantidade_solicitada: 1 });
  reqRenderItens();
  if($("req-busca")) $("req-busca").value = "";
  if(!p){ const inp = $("req-itens").querySelector(`tr[data-idx="${_reqItens.length - 1}"] input[data-f=descricao]`); if(inp) inp.focus(); }
}
async function salvarRequisicao(){
  if(_reqAtual) return;
  const itens = _reqItens.filter(i => Number(i.quantidade_solicitada) > 0 && (i.produto_id || (i.descricao || "").trim()));
  if(!itens.length){ aviso("app-aviso", "Adicione ao menos um item com quantidade.", "erro"); return; }
  const reg = { obra_id: $("req-obra").value || null, equipamento_id: $("req-equip").value || null, prioridade: $("req-prioridade").value || "normal", justificativa: $("req-just").value.trim() || null, status: "pendente" };
  const { data: r, error } = await sb.from("requisicoes").insert(reg).select("id,numero").single();
  if(error){ aviso("app-aviso", "Não foi possível abrir a requisição: " + error.message, "erro"); return; }
  const { error: eIt } = await sb.from("requisicao_itens").insert(itens.map(i => ({ requisicao_id: r.id, produto_id: i.produto_id || null, descricao: i.produto_id ? null : i.descricao.trim(), unidade: (i.unidade || "un").trim(), quantidade_solicitada: Number(i.quantidade_solicitada) })));
  if(eIt){ await sb.from("requisicoes").delete().eq("id", r.id); aviso("app-aviso", "Erro nos itens: " + eIt.message, "erro"); return; }
  aviso("app-aviso", `Requisição ${r.numero} aberta. O comprador vê em Compras › Requisições.`, "ok");
  fecharRequisicao();
  if(typeof _cmpView !== "undefined" && $("sec-compras")?.classList.contains("ativa")){ _cmpView = "requisicoes"; await cmpFetchPedidos(); renderCompras(); }
}
async function reqMudarStatus(status){
  const r = _reqAtual; if(!r) return;
  const upd = { status };
  if(status === "rejeitada"){ const m = prompt("Motivo da rejeição (vai para quem pediu):"); if(m === null) return; upd.motivo_rejeicao = m.trim() || null; }
  if(status === "cancelada" && !confirm(`Cancelar a requisição ${r.numero}?`)) return;
  if(status === "separada" && !confirm(`Marcar ${r.numero} como atendida pelo estoque? Registre a saída em Estoque para baixar o saldo.`)) return;
  const { error } = await sb.from("requisicoes").update(upd).eq("id", r.id);
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
  aviso("app-aviso", `Requisição ${r.numero}: ${(REQ_STATUS[status] || [status])[0].toLowerCase()}.`, "ok");
  fecharRequisicao();
  await cmpFetchPedidos(); renderCompras();
}

/* ---------- gerar pedido a partir das pendentes ---------- */
function reqFornecedorSugerido(ids){
  const cont = {};
  _reqLista.filter(r => ids.includes(r.id)).forEach(r => (r.itens || []).forEach(i => { const f = i.produto?.fornecedor_padrao_id; if(f) cont[f] = (cont[f] || 0) + 1; }));
  return Object.entries(cont).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
function reqAbrirGerarPedido(){
  const ids = [..._reqSel]; if(!ids.length) return;
  const sel = $("req-ped-forn");
  sel.innerHTML = `<option value="">— escolha o fornecedor —</option>` + _cmpForns.map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}</option>`).join("");
  sel.value = reqFornecedorSugerido(ids);
  const reqs = _reqLista.filter(r => ids.includes(r.id));
  $("req-ped-resumo").innerHTML = `<p class="meta">${reqs.length} requisição(ões): ${reqs.map(r => esc(r.numero)).join(", ")} · ${reqs.reduce((s, r) => s + (r.itens || []).length, 0)} item(ns). O pedido nasce em rascunho, com preço = último custo do produto, para o comprador ajustar e enviar para aprovação.</p>`;
  $("cmp-req-ped-modal").style.display = "flex";
}
async function reqGerarPedido(){
  const forn = $("req-ped-forn").value;
  if(!forn){ aviso("app-aviso", "Escolha o fornecedor do pedido.", "erro"); return; }
  const { data: pedidoId, error } = await sb.rpc("requisicoes_gerar_pedido", { p_ids: [..._reqSel], p_fornecedor: forn });
  if(error){ aviso("app-aviso", "Não foi possível gerar o pedido: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  $("cmp-req-ped-modal").style.display = "none"; _reqSel = new Set();
  aviso("app-aviso", "Pedido gerado em rascunho. Confira preços e destino e envie para aprovação.", "ok");
  await cmpFetchPedidos();
  await abrirPedido(pedidoId);
}

/* ---------- Estoque › Reposição: requisitar o que falta ---------- */
async function reqCriarDaReposicao(){
  if(!reqPodePedir()){ aviso("app-aviso", "Seu perfil não abre requisições.", "erro"); return; }
  const faltam = (typeof _estRep === "object" ? _estRep : []).filter(p => typeof estAComprar === "function" && estAComprar(p) > 0);
  if(!faltam.length){ aviso("app-aviso", "Nada abaixo do ideal na lista de reposição.", "ok"); return; }
  if(!confirm(`Abrir uma requisição de reposição com ${faltam.length} item(ns) abaixo do ideal?`)) return;
  const { data: r, error } = await sb.from("requisicoes").insert({ status: "pendente", prioridade: "normal", justificativa: "Reposição do estoque: itens abaixo do ideal na lista de reposição" }).select("id,numero").single();
  if(error){ aviso("app-aviso", "Não foi possível abrir a requisição: " + error.message, "erro"); return; }
  const { error: eIt } = await sb.from("requisicao_itens").insert(faltam.map(p => ({ requisicao_id: r.id, produto_id: p.id, unidade: p.unidade || "un", quantidade_solicitada: estAComprar(p) })));
  if(eIt){ await sb.from("requisicoes").delete().eq("id", r.id); aviso("app-aviso", "Erro nos itens: " + eIt.message, "erro"); return; }
  aviso("app-aviso", `Requisição ${r.numero} aberta com ${faltam.length} item(ns). O comprador vê em Compras › Requisições.`, "ok");
}

/* ---------- ligação ---------- */
function ligarRequisicoes(){
  if(!$("cmp-req-modal")) return;
  $("btn-cmp-req-nova")?.addEventListener("click", () => abrirRequisicao(null));
  $("btn-req-fechar")?.addEventListener("click", fecharRequisicao);
  $("btn-req-salvar")?.addEventListener("click", () => comBotaoTravado("btn-req-salvar", salvarRequisicao));
  $("btn-req-livre")?.addEventListener("click", () => reqAddItem(null));
  $("btn-req-rejeitar")?.addEventListener("click", () => reqMudarStatus("rejeitada"));
  $("btn-req-estoque")?.addEventListener("click", () => reqMudarStatus("separada"));
  $("btn-req-cancelar")?.addEventListener("click", () => reqMudarStatus("cancelada"));
  $("btn-req-pedido")?.addEventListener("click", () => { if(_reqAtual){ _reqSel = new Set([_reqAtual.id]); fecharRequisicao(); reqAbrirGerarPedido(); } });
  $("btn-req-ped-fechar")?.addEventListener("click", () => { $("cmp-req-ped-modal").style.display = "none"; });
  $("btn-req-ped-gerar")?.addEventListener("click", () => comBotaoTravado("btn-req-ped-gerar", reqGerarPedido));
  $("btn-est-requisitar")?.addEventListener("click", () => comBotaoTravado("btn-est-requisitar", reqCriarDaReposicao));
  // linha da lista abre o detalhe (o clique geral de cmp-conteudo abre pedidos por data-id; aqui é data-req)
  $("cmp-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("input,a,button")) return;
    const tr = e.target.closest("tr[data-req]"); if(!tr) return;
    const r = _reqLista.find(x => x.id === tr.dataset.req); if(r) abrirRequisicao(r);
  });
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarRequisicoes);
else ligarRequisicoes();

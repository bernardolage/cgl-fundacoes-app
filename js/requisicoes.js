/* ====================================================================
   Módulo: Requisições (fase 60 — plano Compras §6 fase 3)
   Quem precisa pede (campo, oficina, almoxarifado, engenharia): item, quantidade, obra ou TAG,
   urgência e justificativa. O comprador junta requisições pendentes e gera o pedido de compra
   (RPC requisicoes_gerar_pedido); o almoxarife pode atender direto do estoque. Vive dentro de
   Compras (visão "Requisições" + indicador) e na lista de Reposição do Estoque ("Requisitar o
   que falta"). Depende de compras.js (cmpCarregarBase, cmpObra, cmpEq, cmpLigarBusca, abrirPedido).
   Prefixo: req-.
   Fase 102 (26/10/2026, #91 e #143): apropriação obrigatória (obra, TAG, setor ou "reposição do estoque"; o setor é
   novo, requisicoes.centro_custo_id). "Aprovar" consulta o estoque item a item (RPC requisicoes_aprovar, prévia em
   requisicoes_previa): item com produto e saldo disponível para a quantidade toda vira separação no almoxarifado
   (fase 83) e o resto vira pedido de compra em rascunho, com fornecedor opcional (as cotações definem); a mesma
   requisição pode gerar os dois. "Só compra" manda tudo para o pedido (o "Gerar pedido" da fase 60). A requisição
   mostra os destinos e a etapa de cada um (requisicoes_destinos, que também serve a quem não lê Compras) e, quando o
   almoxarifado recebe, quem pediu confere: "Recebi e conferi" (requisicao_conferir). A requisição só fica atendida
   quando todos os destinos terminaram.
   ==================================================================== */

let _reqLista = [];
let _reqSel = new Set();          // requisições marcadas para aprovar / virar pedido
let _reqAtual = null;             // requisição aberta no modal (null = nova)
let _reqItens = [];               // itens em edição (nova)
let _reqFiltroSt = "pendente";
let _reqBuscaLigada = false;
let _reqDestinos = {};            // fase 102: requisicao_id -> destinos (separação / pedido) com a etapa
let _reqPrevia = {};              // fase 102: requisicao_item_id -> linha de requisicoes_previa (modal)
let _reqPedModo = "aprovar";      // fase 102: "aprovar" (o estoque decide) | "compra" (tudo para o pedido)
let _reqPedIds = [];              // fase 102: requisições do modal de aprovação

const REQ_STATUS = {
  pendente:  ["Pendente",              "ambar"],
  aprovada:  ["Em atendimento",        "azul"],    // fase 102: separação e/ou pedido em andamento (era "Em compra")
  separada:  ["Atendida pelo estoque", "verde"],
  atendida:  ["Atendida",              "verde"],
  rejeitada: ["Rejeitada",             "vermelho"],
  cancelada: ["Cancelada",             "cinza"]
};
const REQ_PRIORIDADE = { normal: "Normal", urgente: "Urgente" };
const REQ_FILTRO_CONFERIR = "_conferir";   // fase 102: requisições com recebimento esperando a minha conferência
const REQ_SEP_STATUS = { aberta: ["separação aberta", "azul"], em_separacao: ["em separação", "ambar"], separada: ["separada: pronta para retirar", "verde"],
  entregue: ["entregue", "verde"], cancelada: ["cancelada", "cinza"] };

/* = policy requisicoes_write; lote S48 (#123): + gestor_manutencao (a fase 92c já o pôs no banco) */
function reqPodePedir(){
  return !!usuarioAtual && ["admin","diretor","comprador","almoxarife","encarregado","engenheiro","assistente_engenharia","mecanico","operador","logistica","gestor_acessorios","financeiro","gestor_frota","gestor_manutencao"].includes(usuarioAtual.cargo);
}
function reqPodeDecidir(){ return typeof cmpPodeOperar === "function" && cmpPodeOperar(); }
function reqTag(st){ const o = REQ_STATUS[st] || [st, "cinza"]; return `<span class="tag ${o[1]}">${esc(o[0])}</span>`; }
function reqDestino(r){
  if(r.centro_custo_id) return (typeof cmpCentro === "function" && cmpCentro(r.centro_custo_id)) || "Setor";   // fase 102
  return r.equipamento_id ? "TAG " + (cmpEq(r.equipamento_id) || "?") : r.obra_id ? (cmpObra(r.obra_id) || "obra") : "Estoque (reposição da base)";
}
function reqItemNome(it){ return it.produto ? `${it.produto.codigo} — ${it.produto.nome}` : (it.descricao || "item"); }
/* fase 102: a seção está no menu deste cargo? (abrir o pedido ou a separação a partir da requisição) */
function reqPodeAbrirSecao(sec){ const b = document.querySelector(`.sidebar-nav button[data-secao="${sec}"]`); return !!b && b.style.display !== "none"; }
function reqLePedidos(){ return reqPodeDecidir() || (typeof ehSomenteLeitura === "function" && ehSomenteLeitura()); }

/* ---------- destinos (fase 102) ---------- */
async function reqCarregarDestinos(ids){
  const out = {};
  for(let i = 0; i < ids.length; i += 200){
    const { data, error } = await sb.rpc("requisicoes_destinos", { p_ids: ids.slice(i, i + 200) });
    if(error){ console.warn("requisicoes_destinos:", error.message); break; }   // antes da migration da fase 102
    (data || []).forEach(d => { (out[d.requisicao_id] = out[d.requisicao_id] || []).push(d); });
  }
  return out;
}
function reqDestinoHTML(d){
  if(d.tipo === "separacao"){
    const s = REQ_SEP_STATUS[d.status] || [d.status, "cinza"];
    const rot = `${esc(d.numero)} · ${esc(s[0])}`;
    return `<span class="tag ${s[1]}" title="separação do almoxarifado (${d.itens} item(ns))">📦 ${reqPodeAbrirSecao("separacoes") ? `<a href="#" class="req-sep" data-sep="${esc(d.destino_id)}">${rot}</a>` : rot}</span>`;
  }
  const et = (typeof CMP_ETAPA === "object" && CMP_ETAPA[d.etapa]) || { label: d.etapa || d.status, cor: "cinza" };
  const rot = `${esc(d.numero)} · ${esc(et.label)}`;
  return `<span class="tag ${et.cor}" title="pedido de compra (${d.itens} item(ns))">🛒 ${reqLePedidos() ? `<a href="#" class="req-pedido" data-pedido="${esc(d.destino_id)}">${rot}</a>` : rot}</span>`
    + (d.pode_conferir ? ` <span class="tag ambar" title="o almoxarifado recebeu: confira o material">confira o recebimento</span>` : "")
    + (Number(d.conferencias_vencidas) > 0 ? ` <span class="tag vermelho" title="recebimento sem conferência no prazo">sem conferência</span>` : "")
    + (d.conferido_em ? ` <span class="meta">conferido por ${esc(d.conferido_por_nome || "?")} em ${dataBR(dataLocalISO(new Date(d.conferido_em)))}</span>` : "");
}
function reqLigarLinksDestino(cont){
  cont.querySelectorAll("a.req-pedido").forEach(a => a.addEventListener("click", e => {
    e.preventDefault(); e.stopPropagation();
    if($("cmp-req-modal")?.style.display === "flex") fecharRequisicao();
    abrirPedido(a.dataset.pedido);
  }));
  cont.querySelectorAll("a.req-sep").forEach(a => a.addEventListener("click", e => {
    e.preventDefault(); e.stopPropagation();
    if($("cmp-req-modal")?.style.display === "flex") fecharRequisicao();
    if(irParaSecao("separacoes") && typeof abrirSeparacao === "function") abrirSeparacao(a.dataset.sep);
  }));
}

/* ---------- visão dentro de Compras ---------- */
async function renderRequisicoes(){
  const cont = $("cmp-conteudo"); if(!cont) return;
  await cmpCarregarBase(false);
  const conferir = _reqFiltroSt === REQ_FILTRO_CONFERIR;
  // fase 102: itens com "*" (pedido_item_id e separacao_item_id quando a migration estiver aplicada)
  let q = sb.from("requisicoes")
    .select("*, solicitante:profiles!requisicoes_solicitado_por_fkey(nome), pedido:pedidos_compra(id,numero,status), itens:requisicao_itens(*, produto:produtos(codigo,nome,unidade,fornecedor_padrao_id,estoque_atual))")
    .order("created_at", { ascending: false }).limit(500);
  if(conferir) q = q.eq("status", "aprovada");
  else if(_reqFiltroSt) q = q.eq("status", _reqFiltroSt);
  const { data, error } = await q;
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  let lista = data || [];
  _reqDestinos = await reqCarregarDestinos(lista.filter(r => !["rejeitada", "cancelada"].includes(r.status)).map(r => r.id));
  if(conferir) lista = lista.filter(r => (_reqDestinos[r.id] || []).some(d => d.pode_conferir));
  _reqLista = lista;
  _reqSel = new Set([..._reqSel].filter(id => _reqLista.some(r => r.id === id && r.status === "pendente")));
  $("cmp-contador").textContent = `${_reqLista.length} requisição(ões)`;
  const decide = reqPodeDecidir() && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
  const filtros = Object.entries(REQ_STATUS).map(([k, v]) => `<option value="${k}"${_reqFiltroSt === k ? " selected" : ""}>${esc(v[0])}</option>`).join("")
    + `<option value="${REQ_FILTRO_CONFERIR}"${conferir ? " selected" : ""}>Aguardando a minha conferência</option>`;
  cont.innerHTML = `<div class="lista-topo compacta">
      <span class="meta">Quem precisa pede aqui. Aprovar consulta o estoque: o que tem saldo vira separação no almoxarifado e o resto vira pedido de compra. Quando o almoxarifado recebe, quem pediu confere.</span>
      <select id="req-f-status" style="margin-left:auto;"><option value="">Todos os status</option>${filtros}</select>
      ${decide ? `<button type="button" class="btn-sec" id="btn-req-gerar" ${_reqSel.size ? "" : "disabled"} title="Tudo para compra, mesmo o que tem no estoque">🛒 Só compra (${_reqSel.size})</button>
        <button type="button" class="btn" id="btn-req-aprovar-sel" ${_reqSel.size ? "" : "disabled"}>✅ Aprovar ${_reqSel.size} selecionada(s)</button>` : ""}
    </div>
    ${!_reqLista.length ? `<p class="vazio">${conferir ? "Nenhum recebimento esperando a sua conferência." : `Nenhuma requisição${_reqFiltroSt && REQ_STATUS[_reqFiltroSt] ? " " + REQ_STATUS[_reqFiltroSt][0].toLowerCase() : ""}. Use "+ Requisição" para pedir material ou serviço.`}</p>` : `<div class="tabela-rola"><table>
    <thead><tr>${decide ? "<th></th>" : ""}<th>Número</th><th>Data</th><th>Quem pediu</th><th>Destino do custo</th><th>Prioridade</th><th>Itens</th><th>Status</th><th>Separação / pedido</th></tr></thead>
    <tbody>${_reqLista.map(r => { const its = r.itens || []; const resumo = its.slice(0, 2).map(i => `${num(i.quantidade_solicitada)} ${esc(i.unidade || i.produto?.unidade || "un")} ${esc(reqItemNome(i))}`).join(" · ") + (its.length > 2 ? ` · +${its.length - 2}` : "");
      const dest = _reqDestinos[r.id] || [];
      return `<tr class="linha-clicavel" data-req="${esc(r.id)}">${decide ? `<td>${r.status === "pendente" ? `<input type="checkbox" class="req-sel" data-id="${esc(r.id)}" ${_reqSel.has(r.id) ? "checked" : ""}/>` : ""}</td>` : ""}
      <td><strong>${esc(r.numero || "—")}</strong></td><td>${dataBR(r.data_requisicao)}</td><td>${esc(r.solicitante?.nome || "—")}</td>
      <td>${r.obra_id && !r.equipamento_id ? linkObra(r.obra_id, cmpObra(r.obra_id)) : esc(reqDestino(r))}</td>
      <td>${r.prioridade === "urgente" ? '<span class="tag vermelho">Urgente</span>' : '<span class="meta">normal</span>'}</td>
      <td class="meta" title="${esc(its.map(i => `${num(i.quantidade_solicitada)} ${reqItemNome(i)}`).join("\n"))}">${its.length} · ${resumo}</td>
      <td>${reqTag(r.status)}</td>
      <td>${dest.length ? dest.map(reqDestinoHTML).join(" ") : r.pedido ? (reqLePedidos() ? `<a href="#" class="req-pedido" data-pedido="${esc(r.pedido.id)}">${esc(r.pedido.numero)}</a>` : esc(r.pedido.numero)) : "—"}</td></tr>`; }).join("")}</tbody></table></div>`}`;
  $("req-f-status")?.addEventListener("change", e => { _reqFiltroSt = e.target.value; renderRequisicoes(); });
  $("btn-req-gerar")?.addEventListener("click", () => reqAbrirAprovar([..._reqSel], "compra"));
  $("btn-req-aprovar-sel")?.addEventListener("click", () => reqAbrirAprovar([..._reqSel], "aprovar"));
  cont.querySelectorAll(".req-sel").forEach(cb => cb.addEventListener("change", () => {
    if(cb.checked) _reqSel.add(cb.dataset.id); else _reqSel.delete(cb.dataset.id);
    const n = _reqSel.size, bg = $("btn-req-gerar"), ba = $("btn-req-aprovar-sel");
    if(bg){ bg.disabled = !n; bg.textContent = `🛒 Só compra (${n})`; }
    if(ba){ ba.disabled = !n; ba.textContent = `✅ Aprovar ${n} selecionada(s)`; }
  }));
  reqLigarLinksDestino(cont);
}

/* ---------- modal: nova requisição / detalhe ---------- */
async function abrirRequisicao(r){
  if(!r && !reqPodePedir()){ aviso("app-aviso", "Seu perfil não abre requisições.", "erro"); return; }
  await cmpCarregarBase(false);
  _reqAtual = r || null; _reqItens = r ? (r.itens || []).map(i => ({ ...i })) : [];
  _reqPrevia = {};
  const nova = !r;
  const set = (id, html) => { const el = $(id); if(el){ const v = el.value; el.innerHTML = html; el.value = v; } };
  set("req-obra", `<option value="">— nenhuma —</option>` + _cmpObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join(""));
  set("req-equip", `<option value="">— nenhuma —</option>` + _cmpEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join(""));
  // fase 102: setor / obra interna (centros de custo ativos; o da requisição aparece mesmo inativo)
  set("req-centro", `<option value="">— nenhum —</option>` + _cmpCentros.filter(c => c.ativo || c.id === r?.centro_custo_id)
    .map(c => `<option value="${esc(c.id)}">${esc((typeof CMP_CENTRO_TIPO === "object" && CMP_CENTRO_TIPO[c.tipo]) || c.tipo)}: ${esc(c.nome)}</option>`).join(""));
  $("req-titulo").textContent = nova ? "Nova requisição" : `${r.numero} · ${(REQ_STATUS[r.status] || [r.status])[0]}`;
  $("req-obra").value = r?.obra_id || ""; $("req-equip").value = r?.equipamento_id || ""; $("req-centro").value = r?.centro_custo_id || "";
  $("req-reposicao").checked = !nova && !r.obra_id && !r.equipamento_id && !r.centro_custo_id;
  $("req-prioridade").value = r?.prioridade || "normal"; $("req-just").value = r?.justificativa || "";
  ["req-obra","req-equip","req-centro","req-reposicao","req-prioridade","req-just"].forEach(id => $(id).disabled = !nova);
  $("req-itens-add").style.display = nova ? "" : "none";
  $("req-meta").innerHTML = nova ? "" : `Pedido por <strong>${esc(r.solicitante?.nome || "—")}</strong> em ${dataBR(r.data_requisicao)} · custo em <strong>${esc(reqDestino(r))}</strong>${r.motivo_rejeicao ? ` · <span class="txt-perigo">rejeitada: ${esc(r.motivo_rejeicao)}</span>` : ""}`;
  const leitura = typeof ehSomenteLeitura === "function" && ehSomenteLeitura();
  const decide = reqPodeDecidir() && !leitura, minha = r && usuarioAtual && r.solicitado_por === usuarioAtual.id;
  const pend = !nova && r.status === "pendente";
  $("btn-req-salvar").style.display = nova ? "" : "none";
  ["btn-req-rejeitar", "btn-req-estoque", "btn-req-pedido", "btn-req-aprovar"].forEach(id => { if($(id)) $(id).style.display = decide && pend ? "" : "none"; });
  $("btn-req-cancelar").style.display = !nova && !leitura && (decide || minha) && pend ? "" : "none";
  if($("btn-req-conferir")) $("btn-req-conferir").style.display = "none";
  if($("req-destinos")){ $("req-destinos").style.display = "none"; $("req-destinos").innerHTML = ""; }
  reqRenderItens();
  if(nova && !_reqBuscaLigada){ cmpLigarBusca("req-busca", "req-res", p => reqAddItem(p)); _reqBuscaLigada = true; }
  $("cmp-req-modal").style.display = "flex";
  if(nova) return;
  // fase 102: destinos (separação / pedido) e, pendente para quem decide, a prévia do que o estoque cobre
  const id = r.id;
  const [dest, prev] = await Promise.all([
    reqCarregarDestinos([id]),
    pend && decide ? sb.rpc("requisicoes_previa", { p_ids: [id], p_somente_compra: false }) : Promise.resolve({ data: [] })
  ]);
  if(_reqAtual?.id !== id) return;
  _reqDestinos[id] = dest[id] || [];
  _reqPrevia = {}; (prev.data || []).forEach(l => { _reqPrevia[l.requisicao_item_id] = l; });
  reqRenderDestinos();
  reqRenderItens();
}
function fecharRequisicao(){ $("cmp-req-modal").style.display = "none"; _reqAtual = null; _reqItens = []; _reqPrevia = {}; }
/* fase 102: bloco "Separação / pedido" no topo do modal + "Recebi e conferi" para quem pediu */
function reqRenderDestinos(){
  const el = $("req-destinos"), r = _reqAtual; if(!el || !r) return;
  const dest = _reqDestinos[r.id] || [];
  if(!dest.length){ el.style.display = "none"; el.innerHTML = ""; }
  else {
    el.innerHTML = `<div class="con-alerta"><span class="con-alerta-icone">🧭</span><div><strong>Destinos da requisição</strong><div style="margin-top:4px;">${dest.map(reqDestinoHTML).join(" ")}</div></div></div>`;
    el.style.display = "";
    reqLigarLinksDestino(el);
  }
  const b = $("btn-req-conferir");
  if(b) b.style.display = dest.some(d => d.pode_conferir) && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()) ? "" : "none";
}
/* coluna "Estoque e destino": saldo do produto (nova) ou a prévia da aprovação (pendente) ou o destino que ele teve */
function reqItemDestinoTxt(it){
  const pv = _reqPrevia[it.id];
  if(pv){
    // o motivo já diz o disponível quando conta; o saldo do cadastro aparece quando difere (reservado em outra separação)
    const temDisp = /dispon/.test(pv.motivo || "");
    const saldo = pv.estoque_atual !== null && pv.estoque_atual !== undefined && (!temDisp || Number(pv.disponivel) !== Number(pv.estoque_atual)) ? `saldo ${num(pv.estoque_atual)}` : "";
    const dest = pv.destino === "separacao" ? '<span class="tag verde">separação</span>' : pv.destino === "pedido" ? '<span class="tag azul">compra</span>' : '<span class="tag cinza">atendido</span>';
    return `${dest} <span class="meta">${esc([saldo, pv.motivo].filter(Boolean).join(" · "))}</span>`;
  }
  if(it.separacao_item_id) return '<span class="tag verde">separação</span>';
  if(it.pedido_item_id) return '<span class="tag azul">compra</span>';
  if(it.produto && it.produto.estoque_atual !== undefined && it.produto.estoque_atual !== null) return `<span class="meta">saldo ${num(it.produto.estoque_atual)}</span>`;
  return it.produto_id ? "" : '<span class="meta">item livre: vai para compra</span>';
}
function reqRenderItens(){
  const tb = $("req-itens"); if(!tb) return;
  const nova = !_reqAtual;
  if(!_reqItens.length){ tb.innerHTML = `<tr><td colspan="5" class="vazio">Nenhum item. Busque o produto acima ou adicione um item livre.</td></tr>`; return; }
  tb.innerHTML = _reqItens.map((it, idx) => `<tr data-idx="${idx}">
    <td>${it.produto_id ? `<strong>${esc(it.produto?.codigo || "")}</strong> ${esc(it.produto?.nome || it.descricao || "")}` : nova ? `<input type="text" data-f="descricao" value="${esc(it.descricao || "")}" placeholder="descrição do item ou serviço" style="min-width:260px;" />` : esc(it.descricao || "item")}</td>
    <td class="num">${nova ? `<input type="number" data-f="quantidade_solicitada" value="${it.quantidade_solicitada ?? 1}" min="0" step="0.001" style="width:90px;text-align:right;" />` : num(it.quantidade_solicitada)}${!nova && it.quantidade_atendida ? ` <span class="meta">(atendido ${num(it.quantidade_atendida)})</span>` : ""}</td>
    <td>${nova ? `<input type="text" data-f="unidade" value="${esc(it.unidade || it.produto?.unidade || "un")}" style="width:60px;" />` : esc(it.unidade || "un")}</td>
    <td>${reqItemDestinoTxt(it)}</td>
    <td class="col-acao">${nova ? `<button type="button" class="btn-sec btn-sm txt-perigo" data-rem="${idx}">×</button>` : ""}</td></tr>`).join("");
  if(!nova) return;
  tb.querySelectorAll("input[data-f]").forEach(inp => inp.addEventListener("input", () => { const it = _reqItens[Number(inp.closest("tr").dataset.idx)]; it[inp.dataset.f] = inp.type === "number" ? Number(inp.value) : inp.value; }));
  tb.querySelectorAll("button[data-rem]").forEach(b => b.addEventListener("click", () => { _reqItens.splice(Number(b.dataset.rem), 1); reqRenderItens(); }));
}
function reqAddItem(p){
  if(p && _reqItens.some(i => i.produto_id === p.id)){ aviso("app-aviso", "Esse produto já está na requisição.", "erro"); return; }
  _reqItens.push({ produto_id: p?.id || null, produto: p ? { codigo: p.codigo, nome: p.nome, unidade: p.unidade, estoque_atual: p.estoque_atual } : null, descricao: p ? `${p.codigo} — ${p.nome}` : "", unidade: p?.unidade || "un", quantidade_solicitada: 1 });
  reqRenderItens();
  if($("req-busca")) $("req-busca").value = "";
  if(!p){ const inp = $("req-itens").querySelector(`tr[data-idx="${_reqItens.length - 1}"] input[data-f=descricao]`); if(inp) inp.focus(); }
}
/* fase 102: obra/TAG, setor e reposição se excluem (requisicoes_apropriacao_chk no banco) */
function reqApropriacaoMudou(origem){
  if(_reqAtual) return;
  if(origem === "centro" && $("req-centro").value){ $("req-obra").value = ""; $("req-equip").value = ""; $("req-reposicao").checked = false; }
  if((origem === "obra" && $("req-obra").value) || (origem === "equip" && $("req-equip").value)){ $("req-centro").value = ""; $("req-reposicao").checked = false; }
  if(origem === "reposicao" && $("req-reposicao").checked){ $("req-obra").value = ""; $("req-equip").value = ""; $("req-centro").value = ""; }
}
async function salvarRequisicao(){
  if(_reqAtual) return;
  const itens = _reqItens.filter(i => Number(i.quantidade_solicitada) > 0 && (i.produto_id || (i.descricao || "").trim()));
  if(!itens.length){ aviso("app-aviso", "Adicione ao menos um item com quantidade.", "erro"); return; }
  const reg = { obra_id: $("req-obra").value || null, equipamento_id: $("req-equip").value || null, centro_custo_id: $("req-centro").value || null,
    prioridade: $("req-prioridade").value || "normal", justificativa: $("req-just").value.trim() || null, status: "pendente" };
  // fase 102 (#91, etapa 1): apropriação obrigatória
  if(!reg.obra_id && !reg.equipamento_id && !reg.centro_custo_id && !$("req-reposicao").checked){
    aviso("app-aviso", "Diga para onde vai o custo: obra, TAG ou setor. Se for para repor o estoque da base, marque \"Reposição do estoque\".", "erro"); return;
  }
  if(reg.centro_custo_id && (reg.obra_id || reg.equipamento_id)){ aviso("app-aviso", "Escolha obra/TAG ou setor, não os dois.", "erro"); return; }
  if(!reg.centro_custo_id) delete reg.centro_custo_id;   // banco sem a migration da fase 102 continua aceitando
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
  if(status === "separada" && !confirm(`Marcar ${r.numero} como atendida pelo estoque sem separação? Use só quando o material já saiu pelo balcão (Estoque › Saída); para o almoxarifado separar, use "Aprovar".`)) return;
  const { error } = await sb.from("requisicoes").update(upd).eq("id", r.id);
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
  aviso("app-aviso", `Requisição ${r.numero}: ${(REQ_STATUS[status] || [status])[0].toLowerCase()}.`, "ok");
  fecharRequisicao();
  await cmpFetchPedidos(); renderCompras();
}

/* ---------- aprovar (estoque decide) ou só compra (fase 102, #143; era "gerar pedido" da fase 60) ---------- */
/* fornecedor padrão mais frequente entre os itens (fase 102: só os que vão para o pedido, quando a prévia diz quais) */
function reqFornecedorSugerido(ids, itensPedido){
  const cont = {};
  _reqLista.filter(r => ids.includes(r.id)).forEach(r => (r.itens || []).forEach(i => {
    if(itensPedido && !itensPedido.includes(i.id)) return;
    const f = i.produto?.fornecedor_padrao_id; if(f) cont[f] = (cont[f] || 0) + 1;
  }));
  return Object.entries(cont).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}
async function reqAbrirAprovar(ids, modo){
  if(!ids.length) return;
  _reqPedIds = ids; _reqPedModo = modo === "compra" ? "compra" : "aprovar";
  const compra = _reqPedModo === "compra";
  const sel = $("req-ped-forn");
  sel.innerHTML = `<option value="">— sem fornecedor (definir nas cotações) —</option>` + _cmpForns.map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}</option>`).join("");
  sel.value = reqFornecedorSugerido(ids);
  $("req-ped-titulo").textContent = compra ? "Mandar para compra" : (ids.length > 1 ? `Aprovar ${ids.length} requisições` : "Aprovar requisição");
  _reqPedNPed = null;
  reqPedTextos();
  sel.onchange = reqPedTextos;   // lote S53 (#163): o botão e a ajuda seguem o fornecedor escolhido
  const reqs = _reqLista.filter(r => ids.includes(r.id));
  $("req-ped-resumo").innerHTML = `<p class="meta">Carregando o que o estoque cobre…</p>`;
  $("cmp-req-ped-modal").style.display = "flex";
  const { data, error } = await sb.rpc("requisicoes_previa", { p_ids: ids, p_somente_compra: compra });
  if(_reqPedIds !== ids) return;
  if(error){ $("req-ped-resumo").innerHTML = `<p class="vazio">Prévia indisponível: ${esc(error.message)}</p>`; return; }
  const linhas = (data || []).filter(l => l.novo);
  const nSep = linhas.filter(l => l.destino === "separacao").length, nPed = linhas.length - nSep;
  sel.value = reqFornecedorSugerido(ids, linhas.filter(l => l.destino === "pedido").map(l => l.requisicao_item_id));
  const nomeItem = l => { const r = reqs.find(x => x.id === l.requisicao_id); const it = (r?.itens || []).find(i => i.id === l.requisicao_item_id); return it ? reqItemNome(it) : "item"; };
  const numReq = l => (reqs.find(x => x.id === l.requisicao_id) || {}).numero || "";
  $("req-ped-resumo").innerHTML = `<p class="meta">${reqs.length} requisição(ões): ${reqs.map(r => esc(r.numero)).join(", ")}. ${compra ? "Todos os itens pendentes vão para um pedido de compra." : `${nSep} item(ns) vão para a <strong>separação</strong> do almoxarifado (têm saldo) e ${nPed} para um <strong>pedido de compra</strong>.`} Sem fornecedor o pedido nasce <strong>em cotação</strong> (o fornecedor sai da cotação escolhida); com fornecedor nasce em rascunho. O preço começa no último custo do produto; o comprador ajusta, cota e envia para aprovação.</p>
    ${linhas.length ? `<div class="tabela-rola"><table><thead><tr><th>Requisição</th><th>Item</th><th class="num">Qtd</th><th class="num">Disponível</th><th>Destino</th></tr></thead><tbody>${linhas.map(l => `<tr>
      <td>${esc(numReq(l))}</td><td>${esc(nomeItem(l))}</td><td class="num">${num(l.quantidade)}</td>
      <td class="num">${l.disponivel === null || l.disponivel === undefined ? "—" : num(l.disponivel)}</td>
      <td>${l.destino === "separacao" ? '<span class="tag verde">separação</span>' : '<span class="tag azul">compra</span>'} <span class="meta">${esc(l.motivo || "")}</span></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vazio">Nenhum item pendente.</p>`}`;
  _reqPedNPed = nPed;
  reqPedTextos();
}
/* lote S53 (#163): sem fornecedor o pedido gerado nasce em cotação (requisicoes_aprovar); com fornecedor, em rascunho.
   O botão e a ajuda do modal dizem qual dos dois vai acontecer. _reqPedNPed = itens que vão para compra (null = prévia
   ainda carregando). */
let _reqPedNPed = null;
function reqPedTextos(){
  const compra = _reqPedModo === "compra", semForn = !$("req-ped-forn").value, vaiPedido = compra || _reqPedNPed === null || _reqPedNPed > 0;
  $("btn-req-ped-gerar").textContent = compra ? (semForn ? "🛒 Mandar para cotação" : "🛒 Gerar pedido em rascunho") : "✅ Aprovar";
  $("req-ped-forn-ajuda").textContent = !vaiPedido ? "Nada vai para compra: o fornecedor não é usado."
    : semForn ? "Sem fornecedor: o pedido nasce em cotação; o fornecedor sai da cotação escolhida (aba Cotações do pedido)."
    : "Com fornecedor (sugerido pelo fornecedor padrão dos produtos): o pedido nasce em rascunho; confira os preços e envie para aprovação.";
}
async function reqConfirmarAprovar(){
  const ids = _reqPedIds; if(!ids.length) return;
  const forn = $("req-ped-forn").value || null;
  const { data, error } = await sb.rpc("requisicoes_aprovar", { p_ids: ids, p_fornecedor: forn, p_somente_compra: _reqPedModo === "compra" });
  if(error){ aviso("app-aviso", "Não foi possível aprovar: " + (error.message || "").replace(/^(?:ERROR|ERRO|[0-9A-Z]{5})\s*:\s*/, ""), "erro"); return; }
  $("cmp-req-ped-modal").style.display = "none"; _reqSel = new Set(); _reqPedIds = [];
  const seps = (data?.separacoes || []).map(s => s.numero).join(", ");
  const emCot = data?.pedido_status === "em_cotacao";   // lote S53 (#163)
  const partes = [data?.itens_separacao ? `${data.itens_separacao} item(ns) na separação ${seps} (almoxarifado)` : "",
    data?.itens_pedido ? `${data.itens_pedido} no pedido ${data.pedido_numero} (${emCot ? "em cotação: registre as propostas na aba Cotações e feche com o fornecedor escolhido" : "rascunho: confira preços, cote e envie para aprovação"})` : ""].filter(Boolean);
  aviso("app-aviso", "Aprovado: " + (partes.join(" e ") || "os destinos que já existiam continuam") + ".", "ok");
  await cmpFetchPedidos();
  if(data?.pedido_id){ await abrirPedido(data.pedido_id); if(emCot && typeof ativarTabPedido === "function") ativarTabPedido("cotacoes"); }
}
/* fase 102 (#91, etapa 5): quem pediu confere o que o almoxarifado recebeu */
async function reqConferir(){
  const r = _reqAtual; if(!r) return;
  const obs = prompt(`Conferir o material recebido da requisição ${r.numero}.\nObservação (opcional; diga aqui se faltou algo ou veio com defeito):`, "");
  if(obs === null) return;
  const { data, error } = await sb.rpc("requisicao_conferir", { p_requisicao: r.id, p_obs: obs || null });
  if(error){ aviso("app-aviso", "Conferência não registrada: " + (error.message || "").replace(/^(?:ERROR|ERRO|[0-9A-Z]{5})\s*:\s*/, ""), "erro"); return; }
  aviso("app-aviso", `Conferência registrada (${data} recebimento(s)). Obrigado.`, "ok");
  fecharRequisicao();
  await cmpFetchPedidos(); renderCompras();
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
  // fase 102: aprovar (o estoque decide) e "só compra" (tudo para o pedido)
  $("btn-req-aprovar")?.addEventListener("click", () => { if(_reqAtual){ const id = _reqAtual.id; fecharRequisicao(); reqAbrirAprovar([id], "aprovar"); } });
  $("btn-req-pedido")?.addEventListener("click", () => { if(_reqAtual){ const id = _reqAtual.id; fecharRequisicao(); reqAbrirAprovar([id], "compra"); } });
  $("btn-req-conferir")?.addEventListener("click", () => comBotaoTravado("btn-req-conferir", reqConferir));
  [["req-obra", "obra"], ["req-equip", "equip"], ["req-centro", "centro"], ["req-reposicao", "reposicao"]].forEach(([id, o]) => $(id)?.addEventListener("change", () => reqApropriacaoMudou(o)));
  $("btn-req-ped-fechar")?.addEventListener("click", () => { $("cmp-req-ped-modal").style.display = "none"; _reqPedIds = []; });
  $("btn-req-ped-gerar")?.addEventListener("click", () => comBotaoTravado("btn-req-ped-gerar", reqConfirmarAprovar));
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

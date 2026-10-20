/* ====================================================================
   Módulo: Reparos (fase 82, 16/10/2026)
   Reparo de acessório ou TAG na oficina, como no Odoo: quem trabalhou (horas por funcionário, com
   início e fim), as peças consumidas (baixa no estoque pela RPC reparo_consumir_pecas) e o custo
   real que sai disso (gatilhos recalculam custo_pecas, custo_horas e custo_real, salvo custo manual).
   Painel no padrão Serviços (lista / por status), ficha no padrão Odoo. Prefixo rep-.
   A condição e o local da peça seguem o status do reparo (gatilho fn_reparo_sync_acessorio).
   ==================================================================== */

let _repView = "lista";
let _repLista = [];
let _repAtual = null;          // reparo aberto
let _repItens = [];
let _repHoras = [];
let _repEquips = [];
let _repFuncs = [];
let _repCustoHora = 0;
let _repAce = null;            // acessório escolhido na ficha
let _repCarregado = false;

const REP_STATUS = { aberto: ["Aberto", "azul"], em_execucao: ["Em execução", "ambar"], concluido: ["Concluído", "verde"], cancelado: ["Cancelado", "cinza"] };
const REP_STAGES = ["aberto", "em_execucao", "concluido"];
const REP_SETOR = { caldeiraria: "Caldeiraria", usinagem: "Usinagem", mecanica: "Mecânica", eletrica: "Elétrica", pintura: "Pintura", externo: "Externo" };
const REP_SELECT = "id,numero,status,descricao,motivo,setor,tipo_servico,acessorio_id,equipamento_id,responsavel_id,data_abertura,data_inicio,data_conclusao,custo_estimado,custo_real,custo_pecas,custo_horas,custo_manual,observacoes,codigo_externo,codigo_externo_origem,acessorio:acessorios(marcacao,familia,tipo,diametro_mm),equipamento:equipamentos(codigo,nome)";

/* lote S45 (L7): `logistica` registra reparo como registra fabricação (fabPodeEditar / fabricacao_pode_operar);
   espelha reparos_caldeiraria_write, reparo_horas_write e reparo_itens_write da migration 20261020_loteS45_hoje_br. */
function repPodeEditar(){ return !!usuarioAtual && ["admin", "diretor", "mecanico", "engenheiro", "gestor_acessorios", "logistica"].includes(usuarioAtual.cargo); }
/* lote S43 (L10, pedido do Julio em 18/10): o almoxarife lança as peças consumidas e dá a baixa, como no Odoo;
   status, horas, motivo e o resto da ficha seguem repPodeEditar(). Espelha reparo_itens_write e reparo_consumir_pecas.
   Fase 90: o auxiliar de almoxarifado (equipe do Julio) faz o mesmo que ele na aba Peças. */
function repPodeItens(){ return repPodeEditar() || (!!usuarioAtual && ["almoxarife", "auxiliar_almoxarifado"].includes(usuarioAtual.cargo)); }
function repTag(st){ const o = REP_STATUS[st] || [st, "cinza"]; return `<span class="tag ${o[1]}">${esc(o[0])}</span>`; }
function repAlvoTxt(r){ return r.acessorio ? r.acessorio.marcacao : r.equipamento ? "TAG " + r.equipamento.codigo : "—"; }
function repAlvoLink(r){ return r.acessorio_id ? linkAcessorio(r.acessorio_id, r.acessorio?.marcacao || "peça") : r.equipamento_id ? linkEquipamento(r.equipamento_id, "TAG " + (r.equipamento?.codigo || "")) : "—"; }
function repResp(id){ const f = _repFuncs.find(x => x.id === id); return f ? f.nome : ""; }   // responsavel_id → funcionarios
function repDias(r){
  if(!r.data_abertura) return null;
  const fim = r.data_conclusao || hojeISO();
  return Math.max(0, Math.round((new Date(fim + "T00:00:00") - new Date(r.data_abertura + "T00:00:00")) / 864e5));
}

/* ---------- carga ---------- */
async function carregarReparos(force){
  const cont = $("rep-conteudo"); if(!cont) return;
  if(force || !_repCarregado){
    const [eq, fu, cfg] = await Promise.all([
      sb.from("equipamentos").select("id,codigo,nome,tipo").eq("ativo", true).order("codigo"),
      sb.from("funcionarios").select("id,nome,funcao").eq("ativo", true).order("nome"),
      sb.from("empresa_config").select("custo_hora_oficina").eq("id", 1).maybeSingle()
    ]);
    _repEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
    _repFuncs = fu.data || []; _repCustoHora = Number(cfg.data?.custo_hora_oficina || 0);
    $("rep-equip").innerHTML = `<option value="">— nenhuma —</option>` + _repEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
    const respOpts = `<option value="">— responsável —</option>` + _repFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.funcao ? " · " + esc(f.funcao) : ""}</option>`).join("");
    $("rep-resp").innerHTML = respOpts;
    $("rep-f-resp").innerHTML = `<option value="">Responsável</option>` + _repFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
    $("rep-h-func").innerHTML = `<option value="">— funcionário —</option>` + _repFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.funcao ? " · " + esc(f.funcao) : ""}</option>`).join("");
    _repCarregado = true;
  }
  $("btn-rep-novo").style.display = repPodeEditar() ? "" : "none";
  repRenderCustoHora();
  await repFetch();
  renderReparos();
}
async function repFetch(){
  const dias = Number($("rep-f-periodo")?.value || 0);
  const corte = dias ? dataLocalISO(new Date(Date.now() - dias * 864e5)) : null;
  const out = [];
  for(let de = 0; out.length === de; de += 1000){
    let q = sb.from("reparos_caldeiraria").select(REP_SELECT).order("data_abertura", { ascending: false }).order("numero", { ascending: false }).range(de, de + 999);
    if(corte) q = q.or(`data_abertura.gte.${corte},status.in.(aberto,em_execucao)`);
    const r = await q;
    if(r.error){ aviso("app-aviso", "Erro ao carregar reparos: " + r.error.message, "erro"); break; }
    out.push(...(r.data || []));
  }
  _repLista = out;
}
/* custo da hora da oficina (empresa_config): diretoria define; 0 até lá */
function repRenderCustoHora(){
  const el = $("rep-custo-hora"); if(!el) return;
  const pode = !!usuarioAtual && ["diretor", "admin"].includes(usuarioAtual.cargo);
  el.innerHTML = `Hora da oficina: <strong>${_repCustoHora ? brl(_repCustoHora) + "/h" : "não definida"}</strong>${pode ? ` <a href="#" id="rep-custo-hora-ed">alterar</a>` : ""}`;
  $("rep-custo-hora-ed")?.addEventListener("click", async e => {
    e.preventDefault();
    const v = prompt("Custo da hora da oficina (R$/h). Vale para os lançamentos de horas daqui em diante e para o recálculo dos reparos abertos:", _repCustoHora || "");
    if(v === null) return;
    const n = Number(String(v).replace(",", "."));
    if(!(n >= 0)){ aviso("app-aviso", "Valor inválido.", "erro"); return; }
    const { error } = await sb.from("empresa_config").update({ custo_hora_oficina: n }).eq("id", 1);
    if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
    _repCustoHora = n; repRenderCustoHora();
    aviso("app-aviso", "Custo da hora da oficina salvo. Ele entra no custo quando as horas de cada reparo forem lançadas ou alteradas.", "ok");
  });
}

/* ---------- painel ---------- */
function repFiltrados(){
  const q = ($("rep-busca")?.value || "").trim().toLowerCase();
  const st = $("rep-f-status")?.value || "", se = $("rep-f-setor")?.value || "", rs = $("rep-f-resp")?.value || "";
  return _repLista.filter(r => {
    if(st === "_abertos"){ if(!["aberto", "em_execucao"].includes(r.status)) return false; }
    else if(st && r.status !== st) return false;
    if(se && r.setor !== se) return false;
    if(rs && r.responsavel_id !== rs) return false;
    if(q && ![r.numero, r.codigo_externo, r.descricao, r.motivo, r.acessorio?.marcacao, r.equipamento?.codigo, r.observacoes].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderReparos(){
  const cont = $("rep-conteudo"); if(!cont) return;
  document.querySelectorAll("#rep-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _repView));
  const dados = repFiltrados();
  $("rep-contador").textContent = `${dados.length} de ${_repLista.length}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhum reparo com esses filtros.</p>`; return; }
  if(_repView === "kanban"){
    const cols = REP_STAGES.concat(dados.some(r => r.status === "cancelado") ? ["cancelado"] : []);
    cont.innerHTML = `<div class="serv-kanban">${cols.map(st => { const its = dados.filter(r => r.status === st);
      return `<div class="serv-kan-col"><div class="serv-kan-col-head">${repTag(st)} <span class="contador">${its.length}</span></div>
        ${its.slice(0, 200).map(r => `<div class="serv-kan-card" data-id="${esc(r.id)}">
          <div class="serv-kan-card-nome"><strong>${esc(r.numero || "")}</strong> <span class="meta">${dataBR(r.data_abertura)}${r.codigo_externo ? " · " + esc(r.codigo_externo) : ""}</span></div>
          <div>${esc(repAlvoTxt(r))}</div><div class="meta">${esc(r.descricao || "")}</div>
          <div class="meta" style="display:flex;justify-content:space-between;"><span>${esc(REP_SETOR[r.setor] || "")}</span><strong>${brl(r.custo_real)}</strong></div>
        </div>`).join("") || `<p class="vazio">—</p>`}${its.length > 200 ? `<p class="meta">… e mais ${its.length - 200}</p>` : ""}</div>`; }).join("")}</div>`;
  } else {
    cont.innerHTML = `<div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Abertura</th><th>Peça / TAG</th><th>Descrição</th><th>Setor</th><th>Responsável</th><th class="num">Dias</th><th class="num">Custo</th><th>Status</th></tr></thead>
      <tbody>${dados.map(r => `<tr class="linha-clicavel" data-id="${esc(r.id)}">
        <td><strong>${esc(r.numero || "")}</strong>${r.codigo_externo ? ` <span class="meta">${esc(r.codigo_externo)}</span>` : ""}</td><td>${dataBR(r.data_abertura)}</td>
        <td>${repAlvoLink(r)}</td><td>${esc(r.descricao || "")}</td><td>${esc(REP_SETOR[r.setor] || "—")}</td><td class="meta">${esc(repResp(r.responsavel_id))}</td>
        <td class="num">${repDias(r) ?? "—"}</td><td class="num">${brl(r.custo_real)}</td><td>${repTag(r.status)}</td></tr>`).join("")}</tbody></table></div>`;
  }
}

/* ---------- ficha ---------- */
function novoReparo(pre){
  if(!repPodeEditar()){ aviso("app-aviso", "Seu perfil não registra reparos.", "erro"); return; }
  abrirFichaReparo(Object.assign({ id: null, numero: "(novo)", status: "aberto", setor: "caldeiraria", tipo_servico: "recuperacao_estrutural", data_abertura: hojeISO() }, pre || {}), [], []);
}
async function abrirReparo(id){
  if(!_repCarregado) await carregarReparos(false);
  const [r, it, hs] = await Promise.all([
    sb.from("reparos_caldeiraria").select(REP_SELECT).eq("id", id).maybeSingle(),
    sb.from("reparo_itens").select("*").eq("reparo_id", id).order("created_at"),
    sb.from("reparo_horas").select("*").eq("reparo_id", id).order("data").order("inicio")
  ]);
  if(r.error || !r.data){ aviso("app-aviso", "Não foi possível abrir o reparo" + (r.error ? ": " + r.error.message : "."), "erro"); return; }
  abrirFichaReparo(r.data, it.data || [], hs.data || []);
}
function abrirFichaReparo(r, itens, horas){
  _repAtual = r; _repItens = itens; _repHoras = horas;
  _repAce = r.acessorio_id ? { id: r.acessorio_id, marcacao: r.acessorio?.marcacao || "" } : null;
  $("rep-painel").style.display = "none"; $("rep-ficha").style.display = "";
  const novo = !r.id, pode = repPodeEditar();
  $("rep-ficha-titulo").textContent = novo ? "Novo reparo" : `${r.numero} · ${repAlvoTxt(r)}`;
  $("rep-ace-busca").value = _repAce ? _repAce.marcacao : ""; $("rep-ace-info").textContent = "";
  $("rep-equip").value = r.equipamento_id || ""; $("rep-setor").value = r.setor || "caldeiraria"; $("rep-tipo").value = r.tipo_servico || "outro";
  $("rep-resp").value = r.responsavel_id || ""; $("rep-desc").value = r.descricao || ""; $("rep-motivo").value = r.motivo || "";
  $("rep-abertura").value = r.data_abertura || ""; $("rep-inicio").value = r.data_inicio || ""; $("rep-conclusao").value = r.data_conclusao || ""; $("rep-obs").value = r.observacoes || "";
  $("rep-ficha").querySelectorAll(".odoo-tab[data-tab=geral] input, .odoo-tab[data-tab=geral] select, .odoo-tab[data-tab=geral] textarea").forEach(el => el.disabled = !pode);
  $("rep-h-data").value = hojeISO();
  repAtualizarCabecalho();
  repRenderItens(); repRenderHoras(); repRenderCustos();
  repAtivarTab(novo ? "geral" : "geral");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function repAtualizarCabecalho(){
  const r = _repAtual; if(!r) return;
  const st = r.status || "aberto", novo = !r.id, pode = repPodeEditar();
  document.querySelectorAll("#rep-statusbar .stage").forEach(el => {
    el.classList.remove("atual", "passada");
    const i = REP_STAGES.indexOf(st), j = REP_STAGES.indexOf(el.dataset.status);
    if(st !== "cancelado"){ if(j === i) el.classList.add("atual"); else if(j < i) el.classList.add("passada"); }
  });
  $("rep-chip-num").textContent = r.numero || "(novo)";
  $("rep-chip-alvo").innerHTML = repAlvoLink(r);
  $("rep-chip-setor").textContent = REP_SETOR[r.setor] || "—";
  $("rep-chip-resp").textContent = repResp(r.responsavel_id) || "—";
  $("rep-chip-dias").textContent = repDias(r) ?? "—";
  $("rep-chip-odoo").style.display = r.codigo_externo ? "" : "none"; $("rep-chip-odoo-txt").textContent = r.codigo_externo || "";
  const pendBaixa = _repItens.some(i => i.tipo === "consumo" && !i.movimentacao_estoque_id && !i.codigo_externo && i.produto_id);
  const mostra = { "btn-rep-salvar": pode && st !== "cancelado", "btn-rep-iniciar": pode && !novo && st === "aberto", "btn-rep-concluir": pode && !novo && ["aberto", "em_execucao"].includes(st),
    "btn-rep-cancelar": pode && !novo && ["aberto", "em_execucao"].includes(st), "btn-rep-baixa": repPodeItens() && !novo && st !== "cancelado" && pendBaixa };
  Object.entries(mostra).forEach(([id, on]) => { const b = $(id); if(b) b.style.display = on ? "" : "none"; });
  const sb2 = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !n || n === "R$ 0,00"); } };
  sb2("sb-rep-pecas", _repItens.length); sb2("sb-rep-horas", num(_repHoras.reduce((t, h) => t + Number(h.horas || 0), 0)));
  sb2("sb-rep-custo", brl(r.custo_real || 0));
  $("rep-itens-add").style.display = repPodeItens() && !novo && st !== "cancelado" ? "" : "none";   // lote S43: almoxarife também
  $("rep-horas-add").style.display = pode && !novo && st !== "cancelado" ? "" : "none";
}
function repAtivarTab(nome){
  document.querySelectorAll("#rep-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#rep-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
function mostrarPainelReparos(){ $("rep-ficha").style.display = "none"; $("rep-painel").style.display = ""; _repAtual = null; renderReparos(); }

async function salvarReparo(){
  if(!repPodeEditar() || !_repAtual) return null;
  const reg = { acessorio_id: _repAce ? _repAce.id : null, equipamento_id: $("rep-equip").value || null, setor: $("rep-setor").value || null, tipo_servico: $("rep-tipo").value,
    responsavel_id: $("rep-resp").value || null, descricao: $("rep-desc").value.trim(), motivo: $("rep-motivo").value.trim() || null,
    data_abertura: $("rep-abertura").value || hojeISO(), data_inicio: $("rep-inicio").value || null, data_conclusao: $("rep-conclusao").value || null, observacoes: $("rep-obs").value.trim() || null };
  if(!reg.descricao){ aviso("app-aviso", "Informe a descrição do reparo.", "erro"); repAtivarTab("geral"); return null; }
  if(!reg.acessorio_id && !reg.equipamento_id){ aviso("app-aviso", "Informe o acessório ou a TAG.", "erro"); repAtivarTab("geral"); return null; }
  let id = _repAtual.id;
  if(id){ const { error } = await sb.from("reparos_caldeiraria").update(reg).eq("id", id); if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return null; } }
  else { const { data, error } = await sb.from("reparos_caldeiraria").insert({ ...reg, status: "aberto" }).select("id").single(); if(error){ aviso("app-aviso", "Erro ao criar: " + error.message, "erro"); return null; } id = data.id; }
  aviso("app-aviso", "Reparo salvo.", "ok");
  if(typeof aceInvalidar === "function") aceInvalidar();
  await abrirReparo(id);
  return id;
}
async function repAcao(acao){
  const r = _repAtual; if(!r?.id) return;
  if(acao === "baixa"){
    const { data, error } = await sb.rpc("reparo_consumir_pecas", { p_reparo_id: r.id });
    if(error){ aviso("app-aviso", "Baixa não feita: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
    aviso("app-aviso", `${data || 0} peça(s) com baixa no estoque.`, "ok");
    if(typeof carregarProdutos === "function") carregarProdutos();
    return abrirReparo(r.id);
  }
  if(acao === "cancelado" && !confirm("Cancelar este reparo?")) return;
  const upd = { status: acao };
  if(acao === "em_execucao" && !r.data_inicio) upd.data_inicio = hojeISO();
  if(acao === "concluido"){
    upd.data_conclusao = r.data_conclusao || hojeISO();
    const pend = _repItens.filter(i => i.tipo === "consumo" && !i.movimentacao_estoque_id && !i.codigo_externo && i.produto_id).length;
    if(pend && !confirm(`${pend} peça(s) consumida(s) ainda sem baixa no estoque. Concluir assim mesmo? (dá para dar baixa depois)`)) return;
  }
  const { error } = await sb.from("reparos_caldeiraria").update(upd).eq("id", r.id);
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
  aviso("app-aviso", `Reparo: ${REP_STATUS[acao][0].toLowerCase()}.`, "ok");
  if(typeof aceInvalidar === "function") aceInvalidar();
  await abrirReparo(r.id);
}

/* peças */
function repRenderItens(){
  const tb = $("rep-itens"), pode = repPodeItens() && _repAtual?.status !== "cancelado";   // lote S43: almoxarife remove item sem baixa
  if(!_repItens.length){ tb.innerHTML = `<tr><td colspan="8" class="vazio">${_repAtual?.id ? "Nenhuma peça lançada." : "Salve o reparo para lançar peças."}</td></tr>`; return; }
  tb.innerHTML = _repItens.map(i => {
    const baixa = i.movimentacao_estoque_id ? '<span class="tag verde">baixada no estoque</span>' : i.codigo_externo ? '<span class="tag cinza">baixa no Odoo</span>'
      : i.tipo === "retirada" ? '<span class="meta">—</span>' : !i.produto_id ? '<span class="meta">sem produto</span>' : '<span class="tag ambar">pendente</span>';
    return `<tr><td>${i.produto_id ? linkProduto(i.produto_id, i.descricao) : esc(i.descricao)}</td><td>${esc(i.unidade || "un")}</td><td class="num">${num(i.quantidade)}</td>
      <td class="num">${brl(i.custo_unitario)}</td><td class="num">${brl(Number(i.quantidade) * Number(i.custo_unitario))}</td><td>${i.tipo === "retirada" ? "Retirada" : "Consumo"}</td><td>${baixa}</td>
      <td>${pode && !i.movimentacao_estoque_id && !i.codigo_externo ? `<button type="button" class="btn-sec btn-sm rep-item-rem" data-id="${esc(i.id)}" title="remover">×</button>` : ""}</td></tr>`; }).join("");
  tb.querySelectorAll(".rep-item-rem").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("reparo_itens").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await abrirReparo(_repAtual.id); repAtivarTab("pecas");
  }));
}
async function repAddItem(p){
  if(!_repAtual?.id || !p) return;
  const qtd = Number($("rep-prod-qtd").value || 1);
  if(!(qtd > 0)){ aviso("app-aviso", "Informe a quantidade.", "erro"); return; }
  const { error } = await sb.from("reparo_itens").insert({ reparo_id: _repAtual.id, produto_id: p.id, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || "un",
    quantidade: qtd, custo_unitario: Number(p.custo_ultimo || 0), tipo: $("rep-prod-tipo").value });
  if(error){ aviso("app-aviso", "Não foi possível lançar a peça: " + error.message, "erro"); return; }
  $("rep-prod-qtd").value = 1;
  await abrirReparo(_repAtual.id); repAtivarTab("pecas");
}

/* horas */
function repRenderHoras(){
  const tb = $("rep-horas"), pode = repPodeEditar() && _repAtual?.status !== "cancelado";
  const nomeF = id => (_repFuncs.find(f => f.id === id) || {}).nome || "";
  if(!_repHoras.length){ tb.innerHTML = `<tr><td colspan="7" class="vazio">${_repAtual?.id ? "Nenhuma hora lançada." : "Salve o reparo para lançar horas."}</td></tr>`; $("rep-horas-total").textContent = ""; return; }
  tb.innerHTML = _repHoras.map(h => `<tr><td>${esc(nomeF(h.funcionario_id) || "—")}</td><td>${dataBR(h.data)}</td><td>${h.inicio ? esc(String(h.inicio).slice(0, 5)) : "—"}</td><td>${h.fim ? esc(String(h.fim).slice(0, 5)) : "—"}</td>
    <td class="num">${num(h.horas)}</td><td class="meta">${esc(h.observacao || "")}${h.codigo_externo ? " · Odoo" : ""}</td>
    <td>${pode && !h.codigo_externo ? `<button type="button" class="btn-sec btn-sm rep-h-rem" data-id="${esc(h.id)}" title="remover">×</button>` : ""}</td></tr>`).join("");
  const porF = {}; _repHoras.forEach(h => { const n = nomeF(h.funcionario_id) || "sem funcionário"; porF[n] = (porF[n] || 0) + Number(h.horas || 0); });
  $("rep-horas-total").innerHTML = `Total: <strong>${num(_repHoras.reduce((t, h) => t + Number(h.horas || 0), 0))} h</strong> · ` + Object.entries(porF).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${esc(n)} ${num(v)} h`).join(" · ");
  tb.querySelectorAll(".rep-h-rem").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("reparo_horas").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await abrirReparo(_repAtual.id); repAtivarTab("horas");
  }));
}
async function repAddHoras(){
  if(!_repAtual?.id) return;
  const reg = { reparo_id: _repAtual.id, funcionario_id: $("rep-h-func").value || null, data: $("rep-h-data").value || hojeISO(),
    inicio: $("rep-h-inicio").value || null, fim: $("rep-h-fim").value || null, horas: $("rep-h-horas").value === "" ? null : Number($("rep-h-horas").value), observacao: $("rep-h-obs").value.trim() || null };
  if(!reg.funcionario_id){ aviso("app-aviso", "Escolha o funcionário.", "erro"); return; }
  if(!(reg.inicio && reg.fim) && reg.horas == null){ aviso("app-aviso", "Informe início e fim (o sistema calcula as horas) ou as horas.", "erro"); return; }
  if(reg.inicio && reg.fim) reg.horas = 0;   // o gatilho calcula
  const { error } = await sb.from("reparo_horas").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível lançar: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  ["rep-h-inicio", "rep-h-fim", "rep-h-horas", "rep-h-obs"].forEach(id => $(id).value = "");
  await abrirReparo(_repAtual.id); repAtivarTab("horas");
}

/* custos */
function repRenderCustos(){
  const r = _repAtual, c = $("rep-custos"); if(!r || !c) return;
  const pode = repPodeEditar() && !!r.id;
  const horas = _repHoras.reduce((t, h) => t + Number(h.horas || 0), 0);
  c.innerHTML = `<div class="custos-resumo">
      <div><div class="mov-ace-sug-grupo-t">Composição</div>
        <div class="custos-linha"><span>Peças consumidas</span><strong>${brl(r.custo_pecas || 0)}</strong></div>
        <div class="custos-linha"><span>Mão de obra (${num(horas)} h × ${_repCustoHora ? brl(_repCustoHora) : "hora não definida"})</span><strong>${brl(r.custo_horas || 0)}</strong></div>
        <div class="custos-linha"><span><strong>Custo real</strong>${r.custo_manual ? " <span class=\"tag ambar\">digitado</span>" : ""}</span><strong>${brl(r.custo_real || 0)}</strong></div>
      </div>
      <div><div class="mov-ace-sug-grupo-t">Custo digitado à mão</div>
        <p class="meta">Use quando o custo real não sai das peças e das horas (serviço externo, reparo antigo da planilha).</p>
        ${pode ? `<label class="check-inline"><input type="checkbox" id="rep-custo-manual"${r.custo_manual ? " checked" : ""} /> custo manual</label>
          <input type="number" id="rep-custo-valor" min="0" step="0.01" value="${esc(r.custo_real || 0)}" style="width:140px;"${r.custo_manual ? "" : " disabled"} />
          <button type="button" class="btn-sec btn-sm" id="btn-rep-custo-salvar">💾 Salvar custo</button>` : ""}
      </div></div>
    <p class="meta">Concluído, o reparo entra em Custos da TAG em duas linhas: peças e mão de obra. A baixa das peças no estoque não conta de novo.</p>`;
  $("rep-custo-manual")?.addEventListener("change", e => { $("rep-custo-valor").disabled = !e.target.checked; });
  $("btn-rep-custo-salvar")?.addEventListener("click", async () => {
    const manual = $("rep-custo-manual").checked;
    const upd = manual ? { custo_manual: true, custo_real: Number($("rep-custo-valor").value || 0) } : { custo_manual: false };
    const { error } = await sb.from("reparos_caldeiraria").update(upd).eq("id", r.id);
    if(error){ aviso("app-aviso", "Não foi possível salvar o custo: " + error.message, "erro"); return; }
    aviso("app-aviso", manual ? "Custo manual salvo." : "Custo volta a ser peças + horas.", "ok");
    await abrirReparo(r.id); repAtivarTab("custos");
  });
}

/* buscas */
function repLigarBuscaAcessorio(){
  const inp = $("rep-ace-busca"), lista = $("rep-ace-res"); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(async () => {
    const t = inp.value.trim().replace(/[%,()]/g, " ");
    if(!t){ _repAce = null; lista.style.display = "none"; return; }
    if(t.length < 2){ lista.style.display = "none"; return; }
    const { data } = await sb.from("acessorios").select("id,marcacao,familia,tipo,diametro_mm,condicao,local_tipo,jogo").ilike("marcacao", `%${t}%`).eq("ativo", true).order("marcacao").limit(25);
    const res = data || [];
    lista.innerHTML = res.map(a => `<div class="resultado-item" data-id="${esc(a.id)}"><strong>${esc(a.marcacao)}</strong> <span class="meta">${esc([a.familia, a.tipo, a.diametro_mm ? "Ø" + a.diametro_mm : "", a.jogo ? "jogo " + a.jogo : ""].filter(Boolean).join(" · "))}</span></div>`).join("")
      || `<div class="resultado-item vazio">Nenhuma peça com essa marcação.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("mousedown", ev => {
      ev.preventDefault(); const a = res.find(x => x.id === d.dataset.id); _repAce = a; inp.value = a.marcacao; lista.style.display = "none";
      $("rep-ace-info").textContent = [a.familia, a.tipo, a.condicao, a.local_tipo].filter(Boolean).join(" · ");
    }));
  }, 250));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 150));
}
function repLigarBuscaProduto(){
  const inp = $("rep-prod-busca"), lista = $("rep-prod-res"); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(async () => {
    const t = inp.value.trim().replace(/[%,()]/g, " ");
    if(t.length < 2){ lista.style.display = "none"; return; }
    const { data } = await sb.from("produtos").select("id,codigo,nome,unidade,estoque_atual,custo_ultimo").eq("ativo", true).or(`nome.ilike.%${t}%,codigo.ilike.%${t}%,codigo_barras.eq.${t}`).order("nome").limit(25);
    const res = data || [];
    lista.innerHTML = res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")} · ${brl(p.custo_ultimo || 0)}</span></div>`).join("")
      || `<div class="resultado-item vazio">Nenhum produto.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("mousedown", ev => { ev.preventDefault(); inp.value = ""; lista.style.display = "none"; repAddItem(res.find(x => x.id === d.dataset.id)); }));
  }, 250));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 150));
}

/* ---------- ligação ---------- */
function ligarReparos(){
  if(!$("sec-reparos")) return;
  document.querySelector('nav button[data-secao="reparos"]')?.addEventListener("click", () => carregarReparos(false));
  document.querySelectorAll("#rep-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _repView = b.dataset.view; renderReparos(); }));
  $("rep-busca")?.addEventListener("input", debounce(renderReparos));
  ["rep-f-status", "rep-f-setor", "rep-f-resp"].forEach(id => $(id)?.addEventListener("change", renderReparos));
  $("rep-f-periodo")?.addEventListener("change", async () => { await repFetch(); renderReparos(); });
  $("btn-rep-atualizar")?.addEventListener("click", () => carregarReparos(true));
  $("btn-rep-novo")?.addEventListener("click", () => novoReparo());
  $("rep-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a")) return;
    const el = e.target.closest("[data-id]"); if(el) abrirReparo(el.dataset.id);
  });
  $("btn-rep-voltar")?.addEventListener("click", mostrarPainelReparos);
  $("btn-rep-salvar")?.addEventListener("click", () => comBotaoTravado("btn-rep-salvar", salvarReparo));
  document.querySelectorAll("#rep-ficha .rep-acao").forEach(b => b.addEventListener("click", () => comBotaoTravado(b.id, () => repAcao(b.dataset.acao))));
  document.querySelectorAll("#rep-notebook button").forEach(b => b.addEventListener("click", () => repAtivarTab(b.dataset.tab)));
  document.querySelectorAll("#rep-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => repAtivarTab(b.dataset.gotoTab)));
  $("btn-rep-h-add")?.addEventListener("click", () => comBotaoTravado("btn-rep-h-add", repAddHoras));
  repLigarBuscaAcessorio();
  repLigarBuscaProduto();
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarReparos);
else ligarReparos();

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
let _estCentros = [];              // fase 76: setores e obras internas
let _balItens = [];                // fase 78: itens da saída no balcão [{ p, quantidade, observacoes }]
let _balRetirante = null;          // funcionário que retira
let _balFuncs = null;              // funcionários ativos (busca do retirante)
let _balHoje = [];                 // saídas de hoje

const EST_TIPO_LBL = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", devolucao: "Devolução", transferencia: "Transferência" };
const EST_TIPO_COR = { entrada: "verde", saida: "ambar", ajuste: "azul", devolucao: "verde", transferencia: "cinza" };
const EST_AJUDA = {
  entrada: "Compra ou recebimento: soma ao estoque e atualiza o custo do produto.",
  saida: "Consumo ou envio para obra: desconta do estoque. Informe a obra, a TAG ou o setor / obra interna: é aí que o custo do material entra.",
  ajuste: "Inventário: informe a quantidade CONTADA; o sistema lança a diferença para o estoque ficar igual à contagem."
};

function estPodeEditar(){
  // fase 78: logistica (Fabrício, dono de Compras e do balcão) também movimenta
  return !!usuarioAtual && ["admin","diretor","almoxarife","comprador","gestor_acessorios","logistica"].includes(usuarioAtual.cargo);
}
function estProdTxt(p){ return p ? `${p.codigo} — ${p.nome}` : "—"; }
/* fase 81: saldo acertado pela sincronização com o Odoo (scripts/importar-odoo-compras.js estoque) */
function estChipOdoo(p){
  if(!p || !p.odoo_saldo_em) return "";
  const d = new Date(p.odoo_saldo_em);
  return ` <span class="tag azul" title="saldo copiado do Odoo (WH/Estoque, SESMT, Usinagem) até o corte">saldo do Odoo em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>`;
}

/* ---------- carga ---------- */
async function carregarEstoque(force){
  if(!$("est-reposicao")) return;
  if(force || !_estCarregado){
    const [fo, ob, eq, cc] = await Promise.all([
      sb.from("fornecedores").select("id,razao_social").eq("ativo", true).order("razao_social"),
      sb.from("obras").select("id,codigo,nome,status").in("status", ["em_andamento","planejada","paralisada"]).order("codigo", { ascending: false }),
      sb.from("equipamentos").select("id,codigo,nome,tipo").eq("ativo", true).not("tipo", "in", "(caminhao,veiculo)").order("codigo"),
      sb.from("centros_custo").select("id,nome,tipo").eq("ativo", true).order("tipo", { ascending: false }).order("nome")   // fase 76
    ]);
    const centros = cc.data || [], grp = t => centros.filter(c => c.tipo === t).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
    _estCentros = centros;
    if($("est-centro")) $("est-centro").innerHTML = '<option value="">— nenhum —</option>' + `<optgroup label="Setores">${grp("setor")}</optgroup><optgroup label="Obras internas">${grp("obra_interna")}</optgroup>`;
    $("ent-fornecedor").innerHTML = '<option value="">— não informado —</option>' + (fo.data || []).map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}</option>`).join("");
    _estObras = ob.data || []; _estEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
    $("est-obra").innerHTML = '<option value="">— nenhuma —</option>' + _estObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("");
    $("est-equip").innerHTML = '<option value="">— nenhum —</option>' + _estEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
    balPreencherDestino();
    _estCarregado = true;
  }
  const pode = estPodeEditar();
  ["btn-registrar-entrada","btn-est-controlar"].forEach(id => { const b = $(id); if(b) b.style.display = pode ? "" : "none"; });
  if($("bal-card")) $("bal-card").style.display = pode ? "" : "none";
  if($("est-dev-card")) $("est-dev-card").style.display = pode ? "" : "none";   // fase 83
  estAplicarTipo();
  await Promise.all([carregarReposicao(), carregarUltimasEntradas(), pode ? carregarSaidasHoje() : null]);
}

/* ---------- Saída no balcão (fase 78) ----------
   Material entregue a uma pessoa (retirante, de funcionarios) com destino obra, TAG ou setor / obra interna.
   Vários itens numa transação (RPC estoque_saida_registrar); o banco só recusa saldo insuficiente em item com
   controle de reposição (o saldo herdado do Odoo não é confiável). Desfazer em 10 min = devolução com estorno_de. */
function balPreencherDestino(){
  const sel = $("bal-destino"); if(!sel) return;
  const obras = _estObras.filter(o => o.status === "em_andamento");
  const grupo = t => _estCentros.filter(c => c.tipo === t).map(c => `<option value="cc:${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  sel.innerHTML = `<option value="">— obra, TAG ou setor —</option>`
    + `<optgroup label="Obra em andamento">${obras.map(o => `<option value="obra:${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("")}</optgroup>`
    + `<optgroup label="TAG">${_estEquips.map(e => `<option value="eq:${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("")}</optgroup>`
    + `<optgroup label="Setor">${grupo("setor")}</optgroup><optgroup label="Obra interna">${grupo("obra_interna")}</optgroup>`;
}
function balDestinoTxt(m){
  if(m.obra_id){ const o = _estObras.find(x => x.id === m.obra_id); return "Obra " + (o ? o.codigo : ((typeof mapaObras === "object" && mapaObras && mapaObras[m.obra_id]) || "")); }
  if(m.equipamento_id){ const e = _estEquips.find(x => x.id === m.equipamento_id); return "TAG " + (e ? e.codigo : ""); }
  if(m.centro_custo_id){ const c = _estCentros.find(x => x.id === m.centro_custo_id); return c ? c.nome : "Setor"; }
  return "—";
}
async function balCarregarFuncionarios(){
  if(_balFuncs) return _balFuncs;
  const { data, error } = await sb.from("funcionarios").select("id,nome,funcao,matricula").eq("ativo", true).order("nome");
  if(error){ aviso("app-aviso", "Funcionários não carregaram: " + error.message, "erro"); return []; }
  _balFuncs = data || [];
  return _balFuncs;
}
function balLigarRetirante(){
  const inp = $("bal-retirante"), lista = $("bal-retirante-res"); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(async () => {
    _balRetirante = null;
    const q = semAcentoBal(inp.value.trim());
    if(q.length < 2){ lista.style.display = "none"; return; }
    const fs = (await balCarregarFuncionarios()).filter(f => semAcentoBal(`${f.nome} ${f.matricula || ""}`).includes(q)).slice(0, 15);
    lista.innerHTML = fs.length ? fs.map(f => `<div class="resultado-item" data-id="${esc(f.id)}"><strong>${esc(f.nome)}</strong> <span class="meta">${esc(f.funcao || "")}${f.matricula ? " · mat. " + esc(f.matricula) : ""}</span></div>`).join("")
      : `<div class="resultado-item vazio">Nenhum funcionário ativo com esse nome.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => {
      _balRetirante = fs.find(f => f.id === d.dataset.id) || null;
      inp.value = _balRetirante ? _balRetirante.nome : ""; lista.style.display = "none";
      $("bal-item")?.focus();
    }));
  }, 200));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 200));
}
function semAcentoBal(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
const BAL_COLS = "id,codigo,nome,unidade,estoque_atual,controle_reposicao,custo_ultimo,codigo_barras";
async function balBuscar(termo){
  const t = termo.replace(/[%,()]/g, " ").trim(); if(t.length < 2) return [];
  const { data } = await sb.from("produtos").select(BAL_COLS).eq("ativo", true)
    .or(`nome.ilike.%${t}%,codigo.ilike.%${t}%,codigo_barras.eq.${t}`).order("nome").limit(25);
  return data || [];
}
/* Enter no campo (leitor de código de barras manda Enter): código ou código de barras exato adiciona direto */
async function balEnter(){
  const inp = $("bal-item"), t = inp.value.trim(); if(!t) return;
  const { data } = await sb.from("produtos").select(BAL_COLS).eq("ativo", true).or(`codigo.eq.${t.replace(/[,()]/g, " ")},codigo_barras.eq.${t.replace(/[,()]/g, " ")}`).limit(2);
  let p = (data || []).length === 1 ? data[0] : null;
  if(!p){ const res = await balBuscar(t); if(res.length === 1) p = res[0]; else { balMostrarLista(res); return; } }
  balAddItem(p);
}
function balMostrarLista(res){
  const lista = $("bal-item-res"); if(!lista) return;
  lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}${p.controle_reposicao ? " · reposição" : ""}</span></div>`).join("")
    : `<div class="resultado-item vazio">Nenhum produto com esse código ou nome.</div>`;
  lista.style.display = "";
  lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => balAddItem(res.find(x => x.id === d.dataset.id))));
}
function balAddItem(p){
  if(!p) return;
  const ja = _balItens.find(i => i.p.id === p.id);
  if(ja) ja.quantidade = Number(ja.quantidade || 0) + 1; else _balItens.push({ p, quantidade: 1, observacoes: "" });
  const inp = $("bal-item"); inp.value = ""; $("bal-item-res").style.display = "none"; inp.focus();
  renderBalItens();
}
function renderBalItens(){
  const tb = $("bal-itens"); if(!tb) return;
  $("bal-contador").textContent = _balItens.length ? `${_balItens.length} item(ns)` : "";
  if(!_balItens.length){ tb.innerHTML = `<tr><td colspan="6" class="vazio">Nenhum item. Bipe ou busque acima.</td></tr>`; return; }
  tb.innerHTML = _balItens.map((it, i) => { const saldo = Number(it.p.estoque_atual || 0), falta = Number(it.quantidade || 0) > saldo;
    return `<tr data-i="${i}" class="${falta && it.p.controle_reposicao ? "est-rep-critico" : ""}">
      <td><strong>${esc(it.p.codigo)}</strong></td><td>${esc(it.p.nome)}</td>
      <td class="num">${num(saldo)} <span class="meta">${esc(it.p.unidade || "un")}</span>${falta ? `<div class="meta ${it.p.controle_reposicao ? "txt-perigo" : ""}">${it.p.controle_reposicao ? "saldo insuficiente" : "vai ficar negativo"}</div>` : ""}</td>
      <td><input type="number" class="bal-q" step="0.001" min="0.001" value="${esc(it.quantidade)}" style="width:86px;text-align:right;" /></td>
      <td><input class="bal-o" value="${esc(it.observacoes || "")}" placeholder="opcional" style="width:100%;" /></td>
      <td><button type="button" class="btn-sec btn-sm bal-rem" title="tirar">×</button></td></tr>`; }).join("");
  tb.querySelectorAll(".bal-q").forEach(el => el.addEventListener("change", e => { _balItens[Number(e.target.closest("tr").dataset.i)].quantidade = Number(e.target.value || 0); renderBalItens(); }));
  tb.querySelectorAll(".bal-o").forEach(el => el.addEventListener("input", e => { _balItens[Number(e.target.closest("tr").dataset.i)].observacoes = e.target.value; }));
  tb.querySelectorAll(".bal-rem").forEach(el => el.addEventListener("click", e => { _balItens.splice(Number(e.target.closest("tr").dataset.i), 1); renderBalItens(); }));
}
async function registrarSaidaBalcao(){
  if(!estPodeEditar()){ aviso("app-aviso", "Seu perfil não movimenta estoque.", "erro"); return; }
  if(!_balRetirante){ aviso("app-aviso", "Escolha quem está retirando o material.", "erro"); $("bal-retirante").focus(); return; }
  const dv = $("bal-destino").value;
  if(!dv){ aviso("app-aviso", "Escolha o destino: obra, TAG ou setor.", "erro"); $("bal-destino").focus(); return; }
  if(!_balItens.length){ aviso("app-aviso", "Adicione pelo menos um item.", "erro"); $("bal-item").focus(); return; }
  if(_balItens.some(i => !(Number(i.quantidade) > 0))){ aviso("app-aviso", "Há item sem quantidade.", "erro"); return; }
  const destino = dv.startsWith("obra:") ? { obra_id: dv.slice(5) } : dv.startsWith("eq:") ? { equipamento_id: dv.slice(3) } : { centro_custo_id: dv.slice(3) };
  const { data, error } = await sb.rpc("estoque_saida_registrar", {
    p_retirante_id: _balRetirante.id, p_destino: destino,
    p_itens: _balItens.map(i => ({ produto_id: i.p.id, quantidade: Number(i.quantidade), observacoes: i.observacoes || null })),
    p_documento: $("bal-doc").value.trim() || null
  });
  if(error){ aviso("app-aviso", "Saída não registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  const n = (data || []).length;
  aviso("app-aviso", `Saída registrada: ${n} item(ns) para ${_balRetirante.nome} · ${$("bal-destino").selectedOptions[0]?.textContent || ""}.`, "ok");
  _balItens = []; _balRetirante = null; $("bal-retirante").value = ""; $("bal-doc").value = ""; $("bal-destino").value = "";
  renderBalItens();
  if(typeof carregarProdutos === "function") carregarProdutos();
  await Promise.all([carregarSaidasHoje(), carregarReposicao(), carregarUltimasEntradas()]);
}
async function carregarSaidasHoje(){
  const cont = $("bal-hoje"); if(!cont) return;
  const desde = new Date(hojeISO() + "T00:00:00").toISOString();
  const [sa, es] = await Promise.all([
    sb.from("movimentacoes_estoque").select("id,quantidade,custo_unitario,obra_id,equipamento_id,centro_custo_id,documento,observacoes,created_at,registrado_por,produto:produtos(codigo,nome,unidade),retirante:funcionarios!movimentacoes_estoque_responsavel_id_fkey(nome)")
      .eq("tipo", "saida").gte("created_at", desde).order("created_at", { ascending: false }).limit(300),
    sb.from("movimentacoes_estoque").select("estorno_de").not("estorno_de", "is", null).gte("created_at", desde)
  ]);
  if(sa.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(sa.error.message)}</p>`; return; }
  const estornadas = new Set((es.data || []).map(e => e.estorno_de));
  _balHoje = (sa.data || []).map(m => ({ ...m, estornada: estornadas.has(m.id) }));
  renderSaidasHoje();
}
function renderSaidasHoje(){
  const cont = $("bal-hoje"); if(!cont) return;
  const valendo = _balHoje.filter(m => !m.estornada);
  $("bal-hoje-contador").textContent = _balHoje.length ? `${valendo.length} · ${brl(valendo.reduce((s, m) => s + Number(m.quantidade || 0) * Number(m.custo_unitario || 0), 0))}` : "";
  if(!_balHoje.length){ cont.innerHTML = `<p class="vazio">Nenhuma saída hoje.</p>`; return; }
  const admin = !!usuarioAtual && ["admin","diretor"].includes(usuarioAtual.cargo);
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Hora</th><th>Retirante</th><th>Item</th><th class="num">Qtd</th><th class="num">Custo</th><th>Destino</th><th>Documento / obs.</th><th></th></tr></thead>
    <tbody>${_balHoje.map(m => { const d = new Date(m.created_at), min = (Date.now() - d.getTime()) / 60000;
      const podeDesfazer = !m.estornada && min < 10 && (m.registrado_por === usuarioAtual?.id || admin);
      return `<tr${m.estornada ? ' class="meta" style="text-decoration:line-through;"' : ""}>
        <td>${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td><td>${esc(m.retirante?.nome || "—")}</td>
        <td>${esc(m.produto ? m.produto.codigo + " — " + m.produto.nome : "—")}</td>
        <td class="num">${num(Math.abs(m.quantidade || 0))} <span class="meta">${esc(m.produto?.unidade || "")}</span></td>
        <td class="num">${brl(Math.abs(Number(m.quantidade || 0)) * Number(m.custo_unitario || 0))}</td>
        <td>${esc(balDestinoTxt(m))}</td><td class="meta">${esc([m.documento, m.observacoes].filter(Boolean).join(" · "))}</td>
        <td>${m.estornada ? '<span class="tag cinza">desfeita</span>' : podeDesfazer ? `<button type="button" class="btn-sec btn-sm bal-desfazer" data-id="${esc(m.id)}" title="desfazer (até 10 min)">↩ Desfazer</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll(".bal-desfazer").forEach(b => b.addEventListener("click", () => comBotaoTravado(b, async () => {
    if(!confirm("Desfazer esta saída? O material volta ao estoque e o custo sai do destino.")) return;
    const { error } = await sb.rpc("estoque_saida_desfazer", { p_id: b.dataset.id });
    if(error){ aviso("app-aviso", "Não foi possível desfazer: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
    aviso("app-aviso", "Saída desfeita: material de volta ao estoque.", "ok");
    if(typeof carregarProdutos === "function") carregarProdutos();
    await Promise.all([carregarSaidasHoje(), carregarReposicao(), carregarUltimasEntradas()]);
  })));
}
/* ---------- Devolução de obra (fase 83) ----------
   Material que volta da obra entra como `devolucao` com origem obra (RPC estoque_devolucao_registrar): soma ao
   estoque e o custo sai da obra em vw_custos. "Ver o que foi para a obra" lista as saídas dos últimos 180 dias
   menos o que já voltou, para não digitar de novo. Vale para obra em qualquer status (a devolução costuma
   vir da obra concluída). */
let _devItens = [], _devQuem = null, _devObras = null;
async function devAbrir(){
  const b = $("est-dev-body"); if(!b) return;
  const abre = b.style.display === "none"; b.style.display = abre ? "" : "none";
  $("btn-est-dev-toggle").textContent = abre ? "▾ fechar" : "▸ registrar devolução";
  if(abre && !_devObras){
    const { data } = await sb.from("obras").select("id,codigo,nome,status").order("codigo", { ascending: false });
    _devObras = data || [];
    $("est-dev-obra").innerHTML = `<option value="">— obra —</option>` + _devObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}${o.status && o.status !== "em_andamento" ? " (" + esc(String(o.status).replace(/_/g, " ")) + ")" : ""}</option>`).join("");
  }
  if(abre) $("est-dev-obra").focus();
}
function devMostrarLista(res){
  const lista = $("est-dev-item-res"); if(!lista) return;
  lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}</span></div>`).join("")
    : `<div class="resultado-item vazio">Nenhum produto com esse código ou nome.</div>`;
  lista.style.display = "";
  lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => devAddItem(res.find(x => x.id === d.dataset.id))));
}
function devAddItem(p, qtd){
  if(!p) return;
  const ja = _devItens.find(i => i.p.id === p.id);
  if(ja) ja.quantidade = Number(ja.quantidade || 0) + Number(qtd || 1); else _devItens.push({ p, quantidade: Number(qtd || 1), observacoes: "" });
  const inp = $("est-dev-item"); if(inp){ inp.value = ""; $("est-dev-item-res").style.display = "none"; }
  renderDevItens();
}
function renderDevItens(){
  const tb = $("est-dev-itens"); if(!tb) return;
  $("est-dev-contador").textContent = _devItens.length ? `${_devItens.length} item(ns)` : "";
  if(!_devItens.length){ tb.innerHTML = `<tr><td colspan="6" class="vazio">Nenhum item. Bipe, busque acima ou use "Ver o que foi para a obra".</td></tr>`; return; }
  tb.innerHTML = _devItens.map((it, i) => `<tr data-i="${i}">
      <td><strong>${esc(it.p.codigo)}</strong></td><td>${esc(it.p.nome)}</td>
      <td class="num">${num(it.p.estoque_atual || 0)} <span class="meta">${esc(it.p.unidade || "un")}</span></td>
      <td><input type="number" class="dev-q" step="0.001" min="0.001" value="${esc(it.quantidade)}" style="width:86px;text-align:right;" /></td>
      <td><input class="dev-o" value="${esc(it.observacoes || "")}" placeholder="opcional" style="width:100%;" /></td>
      <td><button type="button" class="btn-sec btn-sm dev-rem" title="tirar">×</button></td></tr>`).join("");
  tb.querySelectorAll(".dev-q").forEach(el => el.addEventListener("change", e => { _devItens[Number(e.target.closest("tr").dataset.i)].quantidade = Number(e.target.value || 0); }));
  tb.querySelectorAll(".dev-o").forEach(el => el.addEventListener("input", e => { _devItens[Number(e.target.closest("tr").dataset.i)].observacoes = e.target.value; }));
  tb.querySelectorAll(".dev-rem").forEach(el => el.addEventListener("click", e => { _devItens.splice(Number(e.target.closest("tr").dataset.i), 1); renderDevItens(); }));
}
/* saídas para a obra nos últimos 180 dias, menos o que já voltou (devoluções, inclusive estornos do balcão) */
async function devVerSaidas(){
  const obra = $("est-dev-obra").value, box = $("est-dev-saidas");
  if(!obra){ aviso("app-aviso", "Escolha a obra.", "erro"); $("est-dev-obra").focus(); return; }
  const desde = dataLocalISO(new Date(Date.now() - 180 * 864e5));
  const { data, error } = await sb.from("movimentacoes_estoque").select("produto_id,tipo,quantidade,produto:produtos(" + BAL_COLS + ")")
    .eq("obra_id", obra).in("tipo", ["saida", "devolucao"]).gte("created_at", desde + "T00:00:00").limit(3000);
  box.style.display = "";
  if(error){ box.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  const por = {};
  (data || []).forEach(m => { const o = por[m.produto_id] || (por[m.produto_id] = { p: m.produto, enviado: 0, voltou: 0 }); o[m.tipo === "saida" ? "enviado" : "voltou"] += Math.abs(Number(m.quantidade || 0)); });
  const lista = Object.values(por).filter(o => o.p && o.enviado - o.voltou > 0).sort((a, b) => String(a.p.nome).localeCompare(String(b.p.nome), "pt-BR"));
  box.innerHTML = lista.length ? `<p class="meta">Foi para a obra nos últimos 180 dias e ainda não voltou (saídas menos devoluções): clique para devolver.</p><div class="tabela-rola"><table class="itens-tabela"><thead><tr><th>Código</th><th>Item</th><th class="num">Enviado</th><th class="num">Voltou</th><th class="num">Em obra</th><th class="col-acao"></th></tr></thead>
    <tbody>${lista.map((o, i) => `<tr><td><strong>${esc(o.p.codigo)}</strong></td><td>${esc(o.p.nome)}</td><td class="num">${num(o.enviado)}</td><td class="num">${num(o.voltou)}</td><td class="num">${num(o.enviado - o.voltou)} <span class="meta">${esc(o.p.unidade || "un")}</span></td><td><button type="button" class="btn-sec btn-sm dev-sai-add" data-i="${i}">+ devolver</button></td></tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Nenhuma saída de estoque registrada para esta obra nos últimos 180 dias (ou tudo já voltou).</p>`;
  box.querySelectorAll(".dev-sai-add").forEach(b => b.addEventListener("click", () => { const o = lista[Number(b.dataset.i)]; devAddItem(o.p, o.enviado - o.voltou); }));
}
async function registrarDevolucaoObra(){
  if(!estPodeEditar()){ aviso("app-aviso", "Seu perfil não movimenta estoque.", "erro"); return; }
  const obra = $("est-dev-obra").value;
  if(!obra){ aviso("app-aviso", "Escolha a obra de onde o material voltou.", "erro"); $("est-dev-obra").focus(); return; }
  if(!_devItens.length){ aviso("app-aviso", "Adicione pelo menos um item.", "erro"); $("est-dev-item").focus(); return; }
  if(_devItens.some(i => !(Number(i.quantidade) > 0))){ aviso("app-aviso", "Há item sem quantidade.", "erro"); return; }
  const { data, error } = await sb.rpc("estoque_devolucao_registrar", {
    p_obra_id: obra, p_quem_trouxe: _devQuem ? _devQuem.id : null,
    p_itens: _devItens.map(i => ({ produto_id: i.p.id, quantidade: Number(i.quantidade), observacoes: i.observacoes || null }))
  });
  if(error){ aviso("app-aviso", "Devolução não registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", `Devolução registrada: ${(data || []).length} item(ns) de volta ao estoque${_devQuem ? " (trouxe " + _devQuem.nome + ")" : ""}.`, "ok");
  _devItens = []; _devQuem = null; $("est-dev-quem").value = ""; $("est-dev-saidas").style.display = "none";
  renderDevItens();
  if($("sec-produtos")?.classList.contains("ativa") && typeof carregarProdutos === "function") carregarProdutos();
  await Promise.all([carregarReposicao(), carregarUltimasEntradas()]);
}
function devLigar(){
  const inp = $("est-dev-quem"), lista = $("est-dev-quem-res"); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(async () => {
    _devQuem = null;
    const q = semAcentoBal(inp.value.trim()); if(q.length < 2){ lista.style.display = "none"; return; }
    const fs = (await balCarregarFuncionarios()).filter(f => semAcentoBal(`${f.nome} ${f.matricula || ""}`).includes(q)).slice(0, 15);
    lista.innerHTML = fs.length ? fs.map(f => `<div class="resultado-item" data-id="${esc(f.id)}"><strong>${esc(f.nome)}</strong> <span class="meta">${esc(f.funcao || "")}</span></div>`).join("")
      : `<div class="resultado-item vazio">Nenhum funcionário ativo com esse nome.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => { _devQuem = fs.find(f => f.id === d.dataset.id) || null; inp.value = _devQuem ? _devQuem.nome : ""; lista.style.display = "none"; $("est-dev-item")?.focus(); }));
  }, 200));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 200));
  $("btn-est-dev-toggle")?.addEventListener("click", devAbrir);
  $("est-dev-item")?.addEventListener("keydown", async e => {
    if(e.key !== "Enter") return; e.preventDefault();
    const t = $("est-dev-item").value.trim(); if(!t) return;
    const res = await balBuscar(t), exato = res.filter(p => p.codigo === t || p.codigo_barras === t);
    const p = exato.length === 1 ? exato[0] : res.length === 1 ? res[0] : null;
    if(p) devAddItem(p); else devMostrarLista(res);
  });
  $("est-dev-item")?.addEventListener("input", debounce(async () => { const t = $("est-dev-item").value.trim(); if(t.length < 2){ $("est-dev-item-res").style.display = "none"; return; } devMostrarLista(await balBuscar(t)); }, 250));
  $("est-dev-item")?.addEventListener("blur", () => setTimeout(() => { if($("est-dev-item-res")) $("est-dev-item-res").style.display = "none"; }, 200));
  $("btn-est-dev-saidas")?.addEventListener("click", () => comBotaoTravado("btn-est-dev-saidas", devVerSaidas));
  $("btn-est-dev-registrar")?.addEventListener("click", () => comBotaoTravado("btn-est-dev-registrar", registrarDevolucaoObra));
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
    estChipOdoo(p) +
    (_estTipo === "ajuste" ? ` · <span class="meta">a contagem substitui o atual</span>` : "");
}
async function estBuscarProdutos(termo){
  if(!termo || termo.length < 2) return [];
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data } = await sb.from("produtos")
    .select("id,codigo,nome,unidade,estoque_atual,estoque_minimo,estoque_ideal,controle_reposicao,custo_ultimo,odoo_saldo_em")
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
  if(p) estSugerirCentro(p.id);
}
/* fase 76: na saída, sugere o setor / obra interna que pediu a última compra do item (editável) */
async function estSugerirCentro(produtoId){
  const sel = $("est-centro"); if(!sel || sel.value) return;
  const { data } = await sb.from("pedido_compra_itens").select("centro_custo_id").eq("produto_id", produtoId).not("centro_custo_id", "is", null).order("created_at", { ascending: false }).limit(1);
  const c = data && data[0] && data[0].centro_custo_id;
  if(c && _estProd?.id === produtoId && !sel.value && [...sel.options].some(o => o.value === c)) sel.value = c;
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
    reg.centro_custo_id = $("est-centro")?.value || null;
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
  $("est-obra").value = ""; $("est-equip").value = ""; if($("est-centro")) $("est-centro").value = "";
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
    .select("id,codigo,nome,unidade,estoque_atual,estoque_minimo,estoque_ideal,controle_reposicao,custo_ultimo,localizacao,odoo_saldo_em")
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
      <td>${esc(p.nome)}${p.localizacao ? ` <span class="meta">· ${esc(p.localizacao)}</span>` : ""}${estChipOdoo(p)}</td>
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
    .order("data_movimentacao", { ascending: false }).limit(_estHistTipo === "odoo" ? 1000 : 100);
  // fase 81: "Ajustados pelo Odoo hoje" = ajustes da sincronização de hoje
  if(_estHistTipo === "odoo") q = q.eq("tipo", "ajuste").eq("documento", "Odoo sync " + hojeISO());
  else if(_estHistTipo) q = q.eq("tipo", _estHistTipo);
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
  // fase 78: saída no balcão
  balLigarRetirante();
  $("bal-item")?.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); balEnter(); } });
  $("bal-item")?.addEventListener("input", debounce(async () => { const t = $("bal-item").value.trim(); if(t.length < 2){ $("bal-item-res").style.display = "none"; return; } balMostrarLista(await balBuscar(t)); }, 250));
  $("bal-item")?.addEventListener("blur", () => setTimeout(() => { if($("bal-item-res")) $("bal-item-res").style.display = "none"; }, 200));
  $("btn-bal-registrar")?.addEventListener("click", () => comBotaoTravado("btn-bal-registrar", registrarSaidaBalcao));
  devLigar();   // fase 83: devolução de obra
  document.querySelector('nav button[data-secao="estoque"]')?.addEventListener("click", () => carregarEstoque(false));
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarEstoque);
} else {
  ligarEstoque();
}

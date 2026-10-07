/* ====================================================================
   Módulo: Centros de custo internos (fase 76, 06/10/2026)
   Terceiro dono de custo, além de obra e TAG: setores da empresa (ligados a um departamento, para ver
   custo e equipe juntos) e obras internas (construção civil bancada pela CGL, só para controle de custo).
   O custo vem de vw_custos (compra com NF, saída de estoque, custo avulso, pedido importado do Odoo).
   Compra para o almoxarifado leva o centro só como identificação: o custo nasce na saída.
   Prefixo: ccu-. Escrita do cadastro: admin/diretor (RLS).
   ==================================================================== */

let _ccuLista = [];          // centros_custo
let _ccuCustos = [];         // linhas de vw_custos com centro (período atual + anterior)
let _ccuDeps = [];           // departamentos (árvore)
let _ccuFuncs = [];          // funcionários ativos (só id, nome, função, matrícula, departamento)
let _ccuView = "setor";
let _ccuAtual = null;
let _ccuCarregado = false;

const CCU_TIPO_LBL = { setor: "Setor", obra_interna: "Obra interna" };

function ccuPodeEditar(){ return !!usuarioAtual && ["diretor","admin"].includes(usuarioAtual.cargo); }
function ccuRotulo(c){ return c ? `${CCU_TIPO_LBL[c.tipo] || c.tipo}: ${c.nome}` : ""; }

/* período escolhido → [início, fim] e o período anterior de mesmo tamanho */
function ccuPeriodo(){
  const v = $("ccu-periodo")?.value || "mes";
  const hoje = new Date(); const y = hoje.getFullYear(), m = hoje.getMonth();
  let ini, fim;
  if(v === "mes"){ ini = new Date(y, m, 1); fim = new Date(y, m + 1, 0); }
  else if(v === "mes_ant"){ ini = new Date(y, m - 1, 1); fim = new Date(y, m, 0); }
  else if(v === "ano"){ ini = new Date(y, 0, 1); fim = new Date(y, 11, 31); }
  else { fim = hoje; ini = new Date(hoje.getTime() - 89 * 864e5); }
  const dias = Math.round((fim - ini) / 864e5) + 1;
  const antFim = new Date(ini.getTime() - 864e5), antIni = new Date(antFim.getTime() - (dias - 1) * 864e5);
  return { ini: dataLocalISO(ini), fim: dataLocalISO(fim), antIni: dataLocalISO(antIni), antFim: dataLocalISO(antFim) };
}
/* departamento e todos os filhos */
function ccuDepsDe(depId){
  if(!depId) return [];
  const out = [depId];
  for(let i = 0; i < out.length; i++) _ccuDeps.filter(d => d.parent_id === out[i]).forEach(d => out.push(d.id));
  return out;
}
function ccuDepNome(depId){
  const d = _ccuDeps.find(x => x.id === depId); if(!d) return "";
  const p = _ccuDeps.find(x => x.id === d.parent_id);
  return (p ? p.nome + " / " : "") + d.nome;
}
function ccuEquipe(c){ const deps = ccuDepsDe(c.departamento_id); return _ccuFuncs.filter(f => deps.includes(f.departamento_id)); }

/* ---------- carga ---------- */
async function carregarCentrosCusto(force){
  const cont = $("ccu-conteudo"); if(!cont) return;
  if(force || !_ccuCarregado){
    cont.innerHTML = `<p class="vazio">Carregando centros de custo…</p>`;
    const [cc, dp, fu] = await Promise.all([
      sb.from("centros_custo").select("*").order("tipo", { ascending: false }).order("codigo"),
      sb.from("departamentos").select("id,nome,parent_id").eq("ativo", true),
      sb.from("funcionarios").select("id,nome,funcao,matricula,departamento_id").eq("ativo", true).order("nome")
    ]);
    if(cc.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(cc.error.message)}</p>`; return; }
    _ccuLista = cc.data || []; _ccuDeps = dp.data || []; _ccuFuncs = fu.data || [];
    _ccuCarregado = true;
  }
  $("btn-ccu-novo").style.display = ccuPodeEditar() ? "" : "none";
  await ccuFetchCustos();
  renderCentrosCusto();
}
async function ccuFetchCustos(){
  const p = ccuPeriodo();
  const out = [];
  for(let de = 0; out.length === de; de += 1000){
    const { data, error } = await sb.from("vw_custos").select("centro_custo_id,data,valor,origem")
      .not("centro_custo_id", "is", null).gte("data", p.antIni).lte("data", p.fim).order("data").range(de, de + 999);
    if(error){ aviso("app-aviso", "Erro ao carregar custos: " + error.message, "erro"); break; }
    out.push(...(data || []));
  }
  _ccuCustos = out;
}
function ccuSomas(){
  const p = ccuPeriodo(); const s = {};
  for(const l of _ccuCustos){
    const k = l.centro_custo_id; s[k] = s[k] || { atual: 0, ant: 0 };
    if(l.data >= p.ini && l.data <= p.fim) s[k].atual += Number(l.valor || 0);
    else if(l.data >= p.antIni && l.data <= p.antFim) s[k].ant += Number(l.valor || 0);
  }
  return s;
}

/* ---------- painel ---------- */
function renderCentrosCusto(){
  const cont = $("ccu-conteudo"); if(!cont) return;
  document.querySelectorAll("#ccu-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _ccuView));
  const somas = ccuSomas();
  const q = ($("ccu-busca")?.value || "").trim().toLowerCase();
  const inativos = $("ccu-inativos")?.checked;
  const dados = _ccuLista.filter(c => (_ccuView === "todos" || c.tipo === _ccuView) && (inativos || c.ativo || (somas[c.id]?.atual || 0) > 0)
    && (!q || [c.codigo, c.nome, ccuDepNome(c.departamento_id)].join(" ").toLowerCase().includes(q)));
  const tot = t => _ccuLista.filter(c => c.tipo === t).reduce((s, c) => s + (somas[c.id]?.atual || 0), 0);
  const totAnt = _ccuLista.reduce((s, c) => s + (somas[c.id]?.ant || 0), 0), totAtual = tot("setor") + tot("obra_interna");
  const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  set("ccu-kpi-setores", brl(tot("setor"))); set("ccu-kpi-obras", brl(tot("obra_interna")));
  set("ccu-kpi-ant", brl(totAnt)); set("ccu-kpi-var", totAnt ? ((totAtual - totAnt) / totAnt * 100).toFixed(0).replace("-", "−") + "%" : "—");
  $("ccu-contador").textContent = `${dados.length} de ${_ccuLista.length}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhum centro de custo com esses filtros.</p>`; return; }
  const ordenados = [...dados].sort((a, b) => (somas[b.id]?.atual || 0) - (somas[a.id]?.atual || 0) || a.codigo.localeCompare(b.codigo));
  const linha = c => {
    const s = somas[c.id] || { atual: 0, ant: 0 };
    const v = s.ant ? (s.atual - s.ant) / s.ant * 100 : null;
    return `<tr class="linha-clicavel" data-id="${esc(c.id)}">
      <td><strong>${esc(c.codigo)}</strong></td><td>${esc(c.nome)}${c.ativo ? "" : ' <span class="tag cinza">inativo</span>'}</td><td>${esc(CCU_TIPO_LBL[c.tipo] || c.tipo)}</td>
      <td class="meta">${esc(ccuDepNome(c.departamento_id) || "—")}</td><td class="num">${c.departamento_id ? ccuEquipe(c).length : "—"}</td>
      <td class="num"><strong>${brl(s.atual)}</strong></td><td class="num meta">${brl(s.ant)}</td>
      <td class="num ${v == null ? "meta" : v > 0 ? "txt-perigo" : ""}">${v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(0) + "%"}</td></tr>`;
  };
  const soma = arr => arr.reduce((t, c) => ({ a: t.a + (somas[c.id]?.atual || 0), b: t.b + (somas[c.id]?.ant || 0) }), { a: 0, b: 0 });
  const t = soma(ordenados);
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Código</th><th>Nome</th><th>Tipo</th><th>Departamento</th><th class="num" title="funcionários ativos do departamento e dos subdepartamentos">Equipe</th>
      <th class="num">Custo no período</th><th class="num">Período anterior</th><th class="num">Variação</th></tr></thead>
    <tbody>${ordenados.map(linha).join("")}</tbody>
    <tfoot><tr><td colspan="5"><strong>Total</strong></td><td class="num"><strong>${brl(t.a)}</strong></td><td class="num meta">${brl(t.b)}</td><td></td></tr></tfoot>
  </table></div>`;
}

/* ---------- ficha ---------- */
function mostrarPainelCentros(){
  $("ccu-ficha").style.display = "none"; $("ccu-painel").style.display = "";
  _ccuAtual = null;
  if(typeof ocultarHistorico === "function") ocultarHistorico("ccu-chatter");
  renderCentrosCusto();
}
function novoCentroCusto(){
  if(!ccuPodeEditar()){ aviso("app-aviso", "Só a diretoria cadastra centros de custo.", "erro"); return; }
  abrirFichaCentro({ id: null, codigo: "", nome: "", tipo: _ccuView === "obra_interna" ? "obra_interna" : "setor", ativo: true, odoo_nomes: [], odoo_naturezas: [] });
}
function abrirCentroCusto(id){ const c = _ccuLista.find(x => x.id === id); if(c) abrirFichaCentro(c); }
function abrirFichaCentro(c){
  _ccuAtual = c;
  const novo = !c.id, ed = ccuPodeEditar();
  $("ccu-painel").style.display = "none"; $("ccu-ficha").style.display = "";
  $("ccu-ficha-titulo").textContent = novo ? "Novo centro de custo" : `${c.codigo} · ${c.nome}`;
  $("ccu-codigo").value = c.codigo || ""; $("ccu-nome").value = c.nome || ""; $("ccu-tipo").value = c.tipo || "setor";
  $("ccu-dep").innerHTML = `<option value="">— nenhum —</option>` + [..._ccuDeps].map(d => ({ id: d.id, nome: ccuDepNome(d.id) })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map(d => `<option value="${esc(d.id)}">${esc(d.nome)}</option>`).join("");
  $("ccu-dep").value = c.departamento_id || "";
  $("ccu-resp").value = c.responsavel_id || "";
  $("ccu-odoo").value = (c.odoo_nomes || []).join("\n"); $("ccu-naturezas").value = (c.odoo_naturezas || []).join("\n");
  $("ccu-obs").value = c.observacoes || "";
  $("ccu-ficha").querySelectorAll('.odoo-tab[data-tab="geral"] input, .odoo-tab[data-tab="geral"] select, .odoo-tab[data-tab="geral"] textarea').forEach(el => el.disabled = !ed);
  $("ccu-codigo").disabled = !ed || !novo;
  $("btn-ccu-salvar").style.display = ed ? "" : "none";
  $("btn-ccu-avulso").style.display = !novo && typeof cmpPodeOperar === "function" && cmpPodeOperar() ? "" : "none";
  document.querySelectorAll("#ccu-statusbar .stage").forEach(el => { el.classList.remove("atual"); if((el.dataset.status === "ativo") === !!c.ativo) el.classList.add("atual"); });
  const somas = ccuSomas(); const s = somas[c.id] || { atual: 0 };
  $("ccu-chip-tipo").textContent = CCU_TIPO_LBL[c.tipo] || "—";
  $("ccu-chip-dep").textContent = ccuDepNome(c.departamento_id) || "—";
  $("ccu-chip-resp").textContent = $("ccu-resp").selectedOptions[0]?.value ? $("ccu-resp").selectedOptions[0].textContent : "—";
  $("ccu-chip-custo").textContent = brl(s.atual) + " · " + ($("ccu-periodo").selectedOptions[0]?.textContent || "").toLowerCase();
  const equipe = c.departamento_id ? ccuEquipe(c) : [];
  const setSb = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); } };
  setSb("sb-ccu-equipe", equipe.length); setSb("sb-ccu-pedidos", 0);
  $("sb-ccu-custos").querySelector(".sb-num").textContent = brl(s.atual);
  $("ccu-equipe").innerHTML = !c.departamento_id ? `<p class="vazio">${c.tipo === "obra_interna" ? "Obra interna não tem departamento." : "Ligue um departamento na aba Geral para ver a equipe do setor."}</p>`
    : !equipe.length ? `<p class="vazio">Nenhum funcionário ativo em ${esc(ccuDepNome(c.departamento_id))}.</p>`
    : `<div class="tabela-rola"><table><thead><tr><th>Nome</th><th>Função</th><th>Matrícula</th><th>Departamento</th></tr></thead><tbody>${equipe.map(f =>
        `<tr><td>${esc(f.nome)}</td><td>${esc(f.funcao || "—")}</td><td>${esc(f.matricula || "—")}</td><td class="meta">${esc(ccuDepNome(f.departamento_id))}</td></tr>`).join("")}</tbody></table></div>`;
  $("ccu-custos").innerHTML = novo ? `<p class="vazio">Salve o centro para lançar custos.</p>` : "";
  $("ccu-pedidos").innerHTML = novo ? `<p class="vazio">—</p>` : `<p class="vazio">Carregando…</p>`;
  if(!novo){
    if(typeof custosRender === "function") custosRender("ccu-custos", { centro_custo_id: c.id });
    ccuCarregarPedidos(c.id);
    if(typeof montarHistorico === "function") montarHistorico("centros_custo", c.id, "ccu-chatter");
  } else if(typeof ocultarHistorico === "function") ocultarHistorico("ccu-chatter");
  ativarTabCentro(novo ? "geral" : "custos");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function ativarTabCentro(nome){
  document.querySelectorAll("#ccu-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#ccu-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
async function ccuCarregarPedidos(id){
  const { data, error } = await sb.from("pedido_compra_itens")
    .select("id,descricao,quantidade,valor_total,destino,pedido:pedidos_compra!inner(id,numero,codigo_externo,data_pedido,status,fornecedor:fornecedores(razao_social))")
    .eq("centro_custo_id", id).order("created_at", { ascending: false }).limit(500);
  if(_ccuAtual?.id !== id) return;
  const sb1 = $("sb-ccu-pedidos");
  if(error){ $("ccu-pedidos").innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  const itens = (data || []).sort((a, b) => String(b.pedido?.data_pedido || "").localeCompare(String(a.pedido?.data_pedido || "")));
  if(sb1){ sb1.querySelector(".sb-num").textContent = itens.length; sb1.classList.toggle("zero", !itens.length); }
  $("ccu-pedidos").innerHTML = !itens.length ? `<p class="vazio">Nenhum item de pedido com este centro.</p>` :
    `<p class="meta">Itens com destino "almoxarifado" levam o centro só como identificação de quem pediu: o custo entra quando o material sai do estoque.</p>
    <div class="tabela-rola"><table><thead><tr><th>Data</th><th>Pedido</th><th>Fornecedor</th><th>Item</th><th class="num">Qtd</th><th class="num">Valor</th><th>Destino</th><th>Status</th></tr></thead>
    <tbody>${itens.map(i => `<tr class="linha-clicavel" data-pedido="${esc(i.pedido?.id || "")}"><td>${dataBR(i.pedido?.data_pedido)}</td>
      <td><strong>${esc(i.pedido?.numero || "")}</strong>${i.pedido?.codigo_externo ? ` <span class="meta">${esc(i.pedido.codigo_externo)}</span>` : ""}</td>
      <td>${esc(i.pedido?.fornecedor?.razao_social || "—")}</td><td>${esc(i.descricao)}</td><td class="num">${num(i.quantidade)}</td><td class="num">${brl(i.valor_total)}</td>
      <td>${i.destino === "estoque" ? '<span class="tag cinza">almoxarifado</span>' : '<span class="tag azul">custo</span>'}</td>
      <td>${typeof cmpTag === "function" ? cmpTag(i.pedido?.status) : esc(i.pedido?.status || "")}</td></tr>`).join("")}</tbody></table></div>
    ${itens.length === 500 ? `<p class="meta">Mostrando os 500 mais recentes.</p>` : ""}`;
}
async function salvarCentroCusto(){
  if(!ccuPodeEditar()) return;
  const linhas = id => $(id).value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const reg = { codigo: $("ccu-codigo").value.trim().toUpperCase(), nome: $("ccu-nome").value.trim(), tipo: $("ccu-tipo").value,
    departamento_id: $("ccu-dep").value || null, responsavel_id: $("ccu-resp").value || null,
    odoo_nomes: linhas("ccu-odoo"), odoo_naturezas: linhas("ccu-naturezas"), observacoes: $("ccu-obs").value.trim() || null };
  if(!reg.codigo || !reg.nome){ aviso("app-aviso", "Informe código e nome.", "erro"); ativarTabCentro("geral"); return; }
  let res;
  if(_ccuAtual?.id){ delete reg.codigo; res = await sb.from("centros_custo").update(reg).eq("id", _ccuAtual.id).select("*").single(); }
  else res = await sb.from("centros_custo").insert({ ...reg, ativo: true }).select("*").single();
  if(res.error){ aviso("app-aviso", "Erro ao salvar: " + res.error.message, "erro"); return; }
  aviso("app-aviso", "Centro de custo salvo.", "ok");
  const i = _ccuLista.findIndex(x => x.id === res.data.id); if(i >= 0) _ccuLista[i] = res.data; else _ccuLista.push(res.data);
  if(typeof cmpCarregarBase === "function") cmpCarregarBase(true);   // selects de destino em Compras
  abrirFichaCentro(res.data);
}
async function ccuMudarAtivo(ativo){
  if(!ccuPodeEditar() || !_ccuAtual?.id || _ccuAtual.ativo === ativo) return;
  if(!ativo && !confirm(`Inativar ${_ccuAtual.nome}? O histórico continua; o centro some das listas de lançamento novo.`)) return;
  const { data, error } = await sb.from("centros_custo").update({ ativo }).eq("id", _ccuAtual.id).select("*").single();
  if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
  const i = _ccuLista.findIndex(x => x.id === data.id); if(i >= 0) _ccuLista[i] = data;
  if(typeof cmpCarregarBase === "function") cmpCarregarBase(true);
  abrirFichaCentro(data);
}
async function ccuPreencherResponsaveis(){
  const sel = $("ccu-resp"); if(!sel || sel.options.length > 1) return;
  const { data } = await sb.from("profiles").select("id,nome").eq("ativo", true).order("nome");
  sel.innerHTML = `<option value="">— ninguém —</option>` + (data || []).map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join("");
}

/* ---------- ligação ---------- */
function ligarCentrosCusto(){
  if(!$("sec-centros")) return;
  document.querySelector('nav button[data-secao="centros"]')?.addEventListener("click", async () => { await ccuPreencherResponsaveis(); carregarCentrosCusto(false); });
  document.querySelectorAll("#ccu-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _ccuView = b.dataset.view; renderCentrosCusto(); }));
  $("ccu-busca")?.addEventListener("input", debounce(renderCentrosCusto));
  $("ccu-inativos")?.addEventListener("change", renderCentrosCusto);
  $("ccu-periodo")?.addEventListener("change", async () => { $("ccu-conteudo").innerHTML = `<p class="vazio">Carregando…</p>`; await ccuFetchCustos(); renderCentrosCusto(); });
  $("btn-ccu-atualizar")?.addEventListener("click", () => carregarCentrosCusto(true));
  $("btn-ccu-novo")?.addEventListener("click", novoCentroCusto);
  $("ccu-conteudo")?.addEventListener("click", e => { const tr = e.target.closest("tr[data-id]"); if(tr) abrirCentroCusto(tr.dataset.id); });
  $("btn-ccu-voltar")?.addEventListener("click", mostrarPainelCentros);
  $("btn-ccu-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ccu-salvar", salvarCentroCusto));
  $("btn-ccu-avulso")?.addEventListener("click", () => { if(_ccuAtual?.id && typeof abrirCustoAvulso === "function") abrirCustoAvulso({ centro_custo_id: _ccuAtual.id }, () => abrirFichaCentro(_ccuAtual)); });
  document.querySelectorAll("#ccu-statusbar .stage").forEach(el => el.addEventListener("click", () => ccuMudarAtivo(el.dataset.status === "ativo")));
  document.querySelectorAll("#ccu-notebook button").forEach(b => b.addEventListener("click", () => ativarTabCentro(b.dataset.tab)));
  document.querySelectorAll("#ccu-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => ativarTabCentro(b.dataset.gotoTab)));
  $("ccu-pedidos")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-pedido]"); if(!tr || !tr.dataset.pedido) return;
    if(irParaSecao("compras") && typeof abrirPedido === "function") setTimeout(() => abrirPedido(tr.dataset.pedido), 300);
  });
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarCentrosCusto);
else ligarCentrosCusto();

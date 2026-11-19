/* ====================================================================
   Módulo: Ferramentas (fase 191a, #217) — estoque de ferramentas, empréstimo a funcionário e ocorrências
   Cada ferramenta tem o código da planilha (CGL068, CC10), a quantidade e aponta para um produto do catálogo (D1, D4).
   O saldo vem da vw_ferramentas_saldo (D5): o front não calcula disponível. Empréstimo, devolução e ocorrência só pelas
   RPCs (D6): o banco recusa empréstimo sem disponível e gera a ocorrência da parte danificada ou perdida.
   Lê: todo usuário ativo. Grava: quem opera o almoxarifado (almoxarifado_pode_operar no banco), nunca o auditor.
   O valor unitário só aparece para quem vê Produtos (onde o custo do produto já aparece) (D8).
   Prefixo: frm-.
   ==================================================================== */

let _frmSaldos = [];       // vw_ferramentas_saldo
let _frmProdutos = {};     // id -> { id, codigo, nome }
let _frmFuncs = [];        // funcionários (id, nome, matricula, ativo)
let _frmEqps = {};         // id -> rótulo da máquina
let _frmEqpNomes = {};     // id -> nome da máquina (folha do kit)
let _frmAbertos = [];      // ferramenta_emprestimos com situação aberto ou parcial
let _frmOcorr = [];        // ferramenta_ocorrencias
let _frmView = "ferramentas";
let _frmCarregado = false;
let _frmFunc = null;       // filtro por funcionário (vindo do smart-button da ficha do funcionário)
let _frmAtual = null;      // { reg (ferramentas), saldo, emprestimos, ocorrencias } da ficha aberta; reg.id null = nova
let _frmDev = [];          // empréstimos no modal de devolução

const FRM_OCORR = { danificada: "Danificada", perdida: "Perdida", reparo: "Voltou do conserto", ajuste: "Ajuste de inventário" };
const FRM_OPERA = ["diretor", "admin", "comprador", "almoxarife", "gestor_acessorios", "gestor_manutencao", "engenheiro", "logistica", "financeiro",
  "mecanico", "gestor_frota", "gestor_manutencao", "auxiliar_almoxarifado"];   // espelha almoxarifado_pode_operar()

function frmPodeOperar(){ return !!usuarioAtual && FRM_OPERA.includes(usuarioAtual.cargo); }
/* D8: o valor segue a regra de custo de Produtos: aparece para quem tem Produtos no menu (onde o custo já aparece) */
function frmPodeVerValor(){
  const b = document.querySelector('.sidebar-nav button[data-secao="produtos"]');
  return !!usuarioAtual && !!b && b.style.display !== "none";
}
function frmQ(n){ return Number(n || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); }
function frmSemAcento(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
function frmProdRotulo(id){ const p = _frmProdutos[id]; return p ? `${p.codigo || "—"} — ${p.nome}` : "—"; }
function frmFuncNome(id){ const f = _frmFuncs.find(x => x.id === id); return f ? f.nome : "—"; }
function frmFuncRotulo(f){ return f.nome + (f.matricula ? ` · ${f.matricula}` : ""); }
function frmFuncPorTexto(t){
  const v = String(t || "").trim(); if(!v) return null;
  return _frmFuncs.find(f => frmFuncRotulo(f) === v) || _frmFuncs.find(f => frmSemAcento(f.nome) === frmSemAcento(v)) || null;
}
function frmSaldoPorCodigo(t){
  const v = String(t || "").trim(); if(!v) return null;
  const cod = v.split(" — ")[0].trim().toUpperCase();
  return _frmSaldos.find(s => String(s.codigo).toUpperCase() === cod) || null;
}
function frmDestino(e){ return e.destino === "equipamento" ? "Máquina " + (_frmEqps[e.equipamento_id] || "—") : frmFuncNome(e.funcionario_id); }
function frmDias(data){ return data ? Math.floor((new Date(hojeISO()) - new Date(String(data).slice(0, 10))) / 86400000) : 0; }
function frmAberto(e){ return Number(e.quantidade) - Number(e.quantidade_devolvida); }

/* ---------- carga ---------- */
async function carregarFerramentas(force){
  const cont = $("frm-conteudo"); if(!cont) return;
  if(force || !_frmCarregado){
    cont.innerHTML = `<p class="vazio">Carregando…</p>`;
    const erro = await frmCarregarBase();
    if(erro){ cont.innerHTML = `<p class="vazio">Erro: ${esc(erro)}</p>`; return; }
  }
  const opera = frmPodeOperar();
  $("btn-frm-nova").style.display = opera ? "" : "none";
  $("btn-frm-emprestar").style.display = opera ? "" : "none";
  renderFerramentas();
}
/* lê saldos, catálogo, funcionários, máquinas, abertos e ocorrências; devolve a mensagem de erro ou null */
async function frmCarregarBase(){
  {
    const [sal, pr, fu, eq, ab, oc] = await Promise.all([
      lerTudo(() => sb.from("vw_ferramentas_saldo").select("*"), "ferramenta_id"),
      lerTudo(() => sb.from("produtos").select("id,codigo,nome,ativo"), "id"),
      lerTudo(() => sb.from("funcionarios").select("id,nome,matricula,ativo"), "id"),
      lerTudo(() => sb.from("equipamentos").select("id,codigo,nome"), "id"),
      lerTudo(() => sb.from("ferramenta_emprestimos").select("*").neq("situacao", "devolvido"), "id"),
      lerTudo(() => sb.from("ferramenta_ocorrencias").select("*"), "id")
    ]);
    const erro = [sal, pr, fu, eq, ab, oc].find(r => r.error);
    if(erro) return erro.error.message;
    _frmSaldos = sal.data;
    _frmProdutos = {}; pr.data.forEach(p => { _frmProdutos[p.id] = p; });
    _frmFuncs = fu.data.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    _frmEqps = {}; _frmEqpNomes = {}; eq.data.forEach(e => { _frmEqps[e.id] = e.codigo || e.nome; _frmEqpNomes[e.id] = e.nome || ""; });
    _frmAbertos = ab.data; _frmOcorr = oc.data;
    _frmCarregado = true;
    frmPreencherListas();
  }
  return null;
}
function frmPreencherListas(){
  $("frm-funcs-dl").innerHTML = _frmFuncs.filter(f => f.ativo)
    .map(f => `<option value="${esc(frmFuncRotulo(f))}"></option>`).join("");
  $("frm-produtos-dl").innerHTML = Object.values(_frmProdutos).filter(p => p.ativo !== false)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"))
    .map(p => `<option value="${esc(frmProdRotulo(p.id))}"></option>`).join("");
  $("frm-ferramentas-dl").innerHTML = _frmSaldos.filter(s => s.ativo && Number(s.disponivel) > 0)
    .map(s => `<option value="${esc(s.codigo + " — " + (_frmProdutos[s.produto_id]?.nome || "") + (s.descricao ? " " + s.descricao : ""))}">${esc(frmQ(s.disponivel) + " disponível")}</option>`).join("");
}

/* ---------- painel ---------- */
function frmTextoBusca(s){ return frmSemAcento([s.codigo, s.descricao, _frmProdutos[s.produto_id]?.nome, _frmProdutos[s.produto_id]?.codigo].join(" ")); }
function frmFiltroFuncHTML(){
  const box = $("frm-filtro-func"); if(!box) return;
  if(!_frmFunc){ box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "";
  box.innerHTML = `<span class="tag azul">Funcionário: ${esc(frmFuncNome(_frmFunc))} <button type="button" class="btn-sec btn-sm" id="btn-frm-limpar-func" aria-label="Tirar o filtro do funcionário">×</button></span>`;
}
function renderFerramentas(){
  const cont = $("frm-conteudo"); if(!cont) return;
  document.querySelectorAll("#frm-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _frmView));
  const ativas = _frmSaldos.filter(s => s.ativo);
  const soma = (arr, f) => arr.reduce((t, s) => t + Number(f(s) || 0), 0);
  $("frm-kpi-unidades").textContent = frmQ(soma(ativas, s => Number(s.quantidade) + Number(s.ajuste)));
  $("frm-kpi-emprestadas").textContent = frmQ(soma(ativas, s => Number(s.emprestado) + Number(s.em_equipamento)));
  $("frm-kpi-danificadas").textContent = frmQ(soma(ativas, s => s.danificado));
  $("frm-kpi-perdidas").textContent = frmQ(soma(ativas, s => s.perdido));
  const veValor = frmPodeVerValor();
  $("frm-kpi-valor-box").style.display = veValor ? "" : "none";
  $("frm-kpi-valor").textContent = veValor ? brl(soma(ativas, s => (Number(s.quantidade) + Number(s.ajuste) - Number(s.perdido)) * Number(s.valor_unitario || 0))) : "—";
  frmFiltroFuncHTML();
  if(_frmView === "emprestimos") return renderFrmEmprestimos(cont);
  if(_frmView === "ocorrencias") return renderFrmOcorrencias(cont);
  $("frm-titulo-lista").firstChild.textContent = "Ferramentas ";
  const q = frmSemAcento($("frm-busca")?.value || "").trim();
  const sit = $("frm-situacao")?.value || "";
  const at = $("frm-ativo")?.value || "";
  const limite = new Date(); limite.setDate(limite.getDate() - 30);
  const lim = dataLocalISO(limite);
  const funcFer = _frmFunc ? new Set(_frmAbertos.filter(e => e.funcionario_id === _frmFunc).map(e => e.ferramenta_id)) : null;
  const dados = _frmSaldos.filter(s => (!q || frmTextoBusca(s).includes(q))
    && (at === "" || (at === "ativo") === !!s.ativo)
    && (!funcFer || funcFer.has(s.ferramenta_id))
    && (sit === "" || (sit === "disponivel" && Number(s.disponivel) > 0) || (sit === "emprestada" && Number(s.emprestado) + Number(s.em_equipamento) > 0)
      || (sit === "danificada" && Number(s.danificado) > 0) || (sit === "perdida" && Number(s.perdido) > 0)
      || (sit === "atrasada" && s.saida_mais_antiga && String(s.saida_mais_antiga) < lim)))
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
  $("frm-contador").textContent = `${dados.length} de ${_frmSaldos.length}`;
  if(!_frmSaldos.length){ cont.innerHTML = uiVazio(frmPodeOperar() ? "Nenhuma ferramenta cadastrada. Use ＋ Nova ferramenta." : "Nenhuma ferramenta cadastrada."); return; }
  if(!dados.length){ cont.innerHTML = uiVazio("Nenhuma ferramenta com esses filtros."); return; }
  const n = (v, cls) => Number(v) ? `<span class="tag ${esc(cls)}">${esc(frmQ(v))}</span>` : "—";
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Código</th><th>Ferramenta</th><th class="num">Qtd.</th><th class="num" title="Pronta para emprestar">Disponível</th>
      <th class="num" title="Com funcionário">Emprestada</th><th class="num" title="No kit de uma máquina">Em máquina</th>
      <th class="num">Danificada</th><th class="num">Perdida</th>${veValor ? '<th class="num">Valor unit.</th>' : ""}<th title="Saída mais antiga ainda aberta">Aberto desde</th></tr></thead>
    <tbody>${dados.map(s => `<tr class="linha-clicavel" data-id="${esc(s.ferramenta_id)}" tabindex="0">
      <td>${/* html */ uiCodigo(s.codigo)}${s.ativo ? "" : ' <span class="tag cinza">inativa</span>'}</td>
      <td><strong>${esc(_frmProdutos[s.produto_id]?.nome || "—")}</strong>${s.descricao ? `<br><span class="meta">${esc(s.descricao)}</span>` : ""}</td>
      <td class="num">${esc(frmQ(Number(s.quantidade) + Number(s.ajuste)))}</td>
      <td class="num"><strong>${esc(frmQ(s.disponivel))}</strong></td>
      <td class="num">${/* html */ n(s.emprestado, "azul")}</td><td class="num">${/* html */ n(s.em_equipamento, "azul")}</td>
      <td class="num">${/* html */ n(s.danificado, "ambar")}</td><td class="num">${/* html */ n(s.perdido, "vermelho")}</td>
      ${veValor ? `<td class="num" data-val-sens>${brl(s.valor_unitario || 0)}</td>` : ""}
      <td>${s.saida_mais_antiga ? `${dataBR(s.saida_mais_antiga)}${String(s.saida_mais_antiga) < lim ? ' <span class="tag ambar">+30 dias</span>' : ""}` : "—"}</td></tr>`).join("")}</tbody>
  </table></div>`;
}
function renderFrmEmprestimos(cont){
  $("frm-titulo-lista").firstChild.textContent = "Empréstimos em aberto ";
  const q = frmSemAcento($("frm-busca")?.value || "").trim();
  const sit = $("frm-situacao")?.value || "";
  const limite = new Date(); limite.setDate(limite.getDate() - 30);
  const lim = dataLocalISO(limite);
  const porId = {}; _frmSaldos.forEach(s => { porId[s.ferramenta_id] = s; });
  const dados = _frmAbertos.filter(e => (!_frmFunc || e.funcionario_id === _frmFunc)
    && (!q || frmSemAcento(frmDestino(e) + " " + (porId[e.ferramenta_id] ? frmTextoBusca(porId[e.ferramenta_id]) : "")).includes(q))
    && (sit !== "atrasada" || String(e.data_saida) < lim))
    .sort((a, b) => String(a.data_saida).localeCompare(String(b.data_saida)) || frmDestino(a).localeCompare(frmDestino(b), "pt-BR"));
  $("frm-contador").textContent = `${dados.length} de ${_frmAbertos.length}`;
  if(!dados.length){ cont.innerHTML = uiVazio(_frmAbertos.length ? "Nenhum empréstimo aberto com esses filtros." : "Nenhum empréstimo em aberto."); return; }
  const opera = frmPodeOperar();
  const extra = opera && _frmFunc ? `<p><button type="button" class="btn-sec" data-frm-dev-func="${esc(_frmFunc)}">Devolver tudo de ${esc(frmFuncNome(_frmFunc))}</button></p>` : "";
  cont.innerHTML = extra + `<div class="tabela-rola"><table>
    <thead><tr><th>Saída</th><th>Com</th><th>Ferramenta</th><th class="num">Emprestada</th><th class="num">Já voltou</th><th class="num">Em aberto</th><th>Situação</th><th>Observação</th><th></th></tr></thead>
    <tbody>${dados.map(e => { const s = porId[e.ferramenta_id] || {}; const d = frmDias(e.data_saida); return `<tr>
      <td>${dataBR(e.data_saida)}${d > 30 ? ` <span class="tag ambar">${esc(d)} dias</span>` : ""}</td>
      <td>${e.destino === "funcionario" ? `<a href="#" data-frm-func="${esc(e.funcionario_id)}" title="Só os empréstimos deste funcionário">${esc(frmFuncNome(e.funcionario_id))}</a>` : esc(frmDestino(e))}</td>
      <td><a href="#" data-frm-abrir="${esc(e.ferramenta_id)}">${/* html */ uiCodigo(s.codigo || "—")}</a> ${esc(_frmProdutos[s.produto_id]?.nome || "")}</td>
      <td class="num">${esc(frmQ(e.quantidade))}</td><td class="num">${esc(frmQ(e.quantidade_devolvida))}</td><td class="num"><strong>${esc(frmQ(frmAberto(e)))}</strong></td>
      <td>${e.situacao === "parcial" ? '<span class="tag ambar">parcial</span>' : '<span class="tag azul">aberto</span>'}</td>
      <td class="meta">${esc(e.observacao || "")}</td>
      <td>${opera ? `<button type="button" class="btn-sec btn-sm" data-frm-devolver="${esc(e.id)}">Devolver</button>` : ""}</td></tr>`; }).join("")}</tbody>
  </table></div>`;
}
function renderFrmOcorrencias(cont){
  $("frm-titulo-lista").firstChild.textContent = "Ocorrências ";
  const q = frmSemAcento($("frm-busca")?.value || "").trim();
  const porId = {}; _frmSaldos.forEach(s => { porId[s.ferramenta_id] = s; });
  const dados = _frmOcorr.filter(o => (!_frmFunc || o.funcionario_id === _frmFunc)
    && (!q || frmSemAcento((o.funcionario_id ? frmFuncNome(o.funcionario_id) : "") + " " + (porId[o.ferramenta_id] ? frmTextoBusca(porId[o.ferramenta_id]) : "") + " " + (o.observacao || "")).includes(q)))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.created_at).localeCompare(String(a.created_at)));
  $("frm-contador").textContent = `${dados.length} de ${_frmOcorr.length}`;
  if(!dados.length){ cont.innerHTML = uiVazio("Nenhuma ocorrência."); return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Data</th><th>Tipo</th><th>Ferramenta</th><th class="num">Qtd.</th><th>Funcionário</th><th>Origem</th><th>Observação</th></tr></thead>
    <tbody>${dados.map(o => { const s = porId[o.ferramenta_id] || {}; return `<tr>
      <td>${dataBR(o.data)}</td><td>${/* html */ frmTagOcorr(o.tipo)}</td>
      <td><a href="#" data-frm-abrir="${esc(o.ferramenta_id)}">${/* html */ uiCodigo(s.codigo || "—")}</a> ${esc(_frmProdutos[s.produto_id]?.nome || "")}</td>
      <td class="num">${esc(frmQ(o.quantidade))}</td><td>${esc(o.funcionario_id ? frmFuncNome(o.funcionario_id) : "—")}</td>
      <td>${o.emprestimo_id ? "Devolução" : "Lançada à mão"}</td><td class="meta">${esc(o.observacao || "")}</td></tr>`; }).join("")}</tbody>
  </table></div>`;
}
function frmTagOcorr(tipo){
  const cls = { danificada: "ambar", perdida: "vermelho", reparo: "verde", ajuste: "cinza" }[tipo] || "cinza";
  return `<span class="tag ${esc(cls)}">${esc(FRM_OCORR[tipo] || tipo)}</span>`;
}

/* ---------- ficha ---------- */
function mostrarPainelFerramentas(){
  $("frm-ficha").style.display = "none"; $("frm-painel").style.display = "";
  _frmAtual = null;
  renderFerramentas();
}
async function abrirFerramenta(id){
  $("frm-painel").style.display = "none"; $("frm-ficha").style.display = "";
  if(!id){
    _frmAtual = { reg: { id: null, codigo: "", produto_id: null, quantidade: 1, ativo: true, origem: "app" }, saldo: null, emprestimos: [], ocorrencias: [] };
    renderFichaFerramenta("dados"); return;
  }
  $("frm-ficha-titulo").textContent = "Carregando…";
  const [fe, sal, em, oc] = await Promise.all([
    sb.from("ferramentas").select("*").eq("id", id).maybeSingle(),
    sb.from("vw_ferramentas_saldo").select("*").eq("ferramenta_id", id).maybeSingle(),
    lerTudo(() => sb.from("ferramenta_emprestimos").select("*").eq("ferramenta_id", id), ["data_saida", "id"]),
    lerTudo(() => sb.from("ferramenta_ocorrencias").select("*").eq("ferramenta_id", id), ["data", "id"])
  ]);
  const erro = [fe, sal, em, oc].find(r => r.error);
  if(erro || !fe.data){ aviso("app-aviso", "Erro ao abrir a ferramenta: " + (erro ? erro.error.message : "não encontrada"), "erro"); mostrarPainelFerramentas(); return; }
  _frmAtual = { reg: fe.data, saldo: sal.data, emprestimos: em.data.reverse(), ocorrencias: oc.data.reverse() };
  renderFichaFerramenta();
}
function renderFichaFerramenta(aba){
  const a = _frmAtual; if(!a) return;
  const r = a.reg, s = a.saldo || { quantidade: r.quantidade, ajuste: 0, disponivel: r.quantidade, emprestado: 0, em_equipamento: 0, danificado: 0, perdido: 0 };
  const opera = frmPodeOperar(), novo = !r.id, veValor = frmPodeVerValor();
  $("frm-ficha-codigo").innerHTML = r.codigo ? uiCodigo(r.codigo) : "";
  $("frm-ficha-titulo").textContent = novo ? "Nova ferramenta" : (_frmProdutos[r.produto_id]?.nome || "Ferramenta") + (r.descricao ? " · " + r.descricao : "");
  $("btn-frm-salvar").style.display = opera ? "" : "none";
  $("btn-frm-f-emprestar").style.display = opera && !novo && r.ativo ? "" : "none";
  $("btn-frm-ocorrencia").style.display = opera && !novo ? "" : "none";
  $("btn-frm-excluir").style.display = opera && !novo && !a.emprestimos.length && !a.ocorrencias.length ? "" : "none";
  $("frm-statusbar").innerHTML = uiStatusbar([["ativa", "Ativa"], ["inativa", "Fora do cadastro"]], r.ativo ? "ativa" : "inativa");
  $("frm-chip-qtd").textContent = frmQ(Number(s.quantidade) + Number(s.ajuste || 0));
  $("frm-chip-disp").textContent = frmQ(s.disponivel);
  $("frm-chip-emp").textContent = frmQ(s.emprestado);
  $("frm-chip-eqp").textContent = frmQ(s.em_equipamento);
  $("frm-chip-dan").textContent = frmQ(s.danificado);
  $("frm-chip-per").textContent = frmQ(s.perdido);
  $("frm-chip-valor-box").style.display = veValor ? "" : "none";
  $("frm-chip-valor").textContent = veValor ? brl(r.valor_unitario || 0) : "—";
  const abertos = a.emprestimos.filter(e => e.situacao !== "devolvido");
  const setSb = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !n); } };
  setSb("sb-frm-emprestimos", abertos.length); setSb("sb-frm-ocorrencias", a.ocorrencias.length);
  $("sb-frm-produto").style.display = r.produto_id ? "" : "none";
  // aba Dados (formulário)
  $("frm-f-codigo").value = r.codigo || "";
  $("frm-f-produto").value = r.produto_id ? frmProdRotulo(r.produto_id) : "";
  $("frm-f-descricao").value = r.descricao || "";
  $("frm-f-qtd").value = r.quantidade ?? "";
  $("frm-f-valor-campo").style.display = veValor ? "" : "none";
  $("frm-f-valor").value = r.valor_unitario ?? "";
  $("frm-f-local").value = r.localizacao || "";
  $("frm-f-obs").value = r.observacao || "";
  ["frm-f-codigo", "frm-f-produto", "frm-f-descricao", "frm-f-qtd", "frm-f-valor", "frm-f-local", "frm-f-obs"].forEach(id => { $(id).disabled = !opera; });
  $("frm-f-origem").textContent = novo ? "" : (r.origem === "planilha" ? `Veio da planilha (linha ${r.linha_planilha || "—"}). ` : "") + `Cadastrada em ${dataHoraBR(r.created_at)}.`;
  // aba Empréstimos
  $("frm-emprestimos").innerHTML = !a.emprestimos.length ? uiVazio("Nenhum empréstimo.") : `<div class="tabela-rola"><table>
    <thead><tr><th>Saída</th><th>Com</th><th class="num">Qtd.</th><th class="num">Já voltou</th><th>Situação</th><th>Devolução</th><th>Observação</th><th></th></tr></thead>
    <tbody>${a.emprestimos.map(e => `<tr${e.situacao === "devolvido" ? ' class="meta"' : ""}>
      <td>${dataBR(e.data_saida)}</td><td>${esc(frmDestino(e))}</td><td class="num">${esc(frmQ(e.quantidade))}</td><td class="num">${esc(frmQ(e.quantidade_devolvida))}</td>
      <td>${/* html */ { aberto: '<span class="tag azul">aberto</span>', parcial: '<span class="tag ambar">parcial</span>', devolvido: '<span class="tag cinza">devolvido</span>' }[e.situacao] || ""}</td>
      <td>${e.data_devolucao ? dataBR(e.data_devolucao) : "—"}</td><td class="meta">${esc(e.observacao || "")}</td>
      <td>${opera && e.situacao !== "devolvido" ? `<button type="button" class="btn-sec btn-sm" data-frm-devolver="${esc(e.id)}">Devolver</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  // aba Ocorrências
  $("frm-ocorrencias").innerHTML = !a.ocorrencias.length ? uiVazio("Nenhuma ocorrência.") : `<div class="tabela-rola"><table>
    <thead><tr><th>Data</th><th>Tipo</th><th class="num">Qtd.</th><th>Funcionário</th><th>Origem</th><th>Observação</th><th></th></tr></thead>
    <tbody>${a.ocorrencias.map(o => `<tr><td>${dataBR(o.data)}</td><td>${/* html */ frmTagOcorr(o.tipo)}</td><td class="num">${esc(frmQ(o.quantidade))}</td>
      <td>${esc(o.funcionario_id ? frmFuncNome(o.funcionario_id) : "—")}</td><td>${o.emprestimo_id ? "Devolução" : "Lançada à mão"}</td>
      <td class="meta">${esc(o.observacao || "")}</td>
      <td>${opera && !o.emprestimo_id ? `<button type="button" class="btn-sec btn-sm acao-perigo" data-frm-oco-excluir="${esc(o.id)}">Excluir</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  ativarTabFerramenta(aba || document.querySelector("#frm-notebook button.ativo")?.dataset.tab || "dados");
}
function ativarTabFerramenta(nome){
  document.querySelectorAll("#frm-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#frm-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
/* depois de gravar: a ficha (se aberta) e as listas do painel voltam do banco */
async function frmRecarregar(aba){
  const id = _frmAtual?.reg?.id;
  await carregarFerramentas(true);
  if(id && $("frm-ficha").style.display !== "none"){ await abrirFerramenta(id); if(aba) ativarTabFerramenta(aba); }
}

async function salvarFerramenta(){
  const a = _frmAtual; if(!a || !frmPodeOperar()) return;
  const codigo = $("frm-f-codigo").value.trim();
  const ptxt = $("frm-f-produto").value.trim();
  const prod = Object.values(_frmProdutos).find(p => frmProdRotulo(p.id) === ptxt);
  const qtd = Number($("frm-f-qtd").value);
  if(!codigo){ aviso("app-aviso", "Informe o código.", "erro"); return; }
  if(!prod){ aviso("app-aviso", "Escolha o produto na lista (código — nome). Se não existir, cadastre antes em Produtos.", "erro"); return; }
  if(!(qtd > 0)){ aviso("app-aviso", "A quantidade tem de ser maior que zero.", "erro"); return; }
  const reg = { codigo, produto_id: prod.id, descricao: $("frm-f-descricao").value.trim() || null, quantidade: qtd,
    localizacao: $("frm-f-local").value.trim() || null, observacao: $("frm-f-obs").value.trim() || null };
  if(frmPodeVerValor()){ const v = $("frm-f-valor").value; reg.valor_unitario = v === "" ? null : Number(v); }
  const q = a.reg.id ? sb.from("ferramentas").update(reg).eq("id", a.reg.id).select("id").single()
                     : sb.from("ferramentas").insert(reg).select("id").single();
  const { data, error } = await q;
  if(error){ aviso("app-aviso", error.code === "23505" ? "Já existe ferramenta com este código." : error.message, "erro"); return; }
  aviso("app-aviso", "Ferramenta gravada.", "ok");
  _frmAtual.reg.id = data.id;
  await frmRecarregar("dados");
}
async function frmMudarAtivo(stage){
  const a = _frmAtual; if(!a || !a.reg.id || !frmPodeOperar()) return;
  const ativo = stage === "ativa"; if(ativo === !!a.reg.ativo) return;
  if(!ativo && !confirm("Tirar a ferramenta do cadastro? Ela some da lista de empréstimo, mas o histórico fica.")) return;
  const { error } = await sb.from("ferramentas").update({ ativo }).eq("id", a.reg.id);
  if(error){ aviso("app-aviso", error.message, "erro"); return; }
  await frmRecarregar();
}
async function excluirFerramenta(){
  const a = _frmAtual; if(!a || !a.reg.id || !frmPodeOperar()) return;
  if(!confirm(`Excluir a ferramenta ${a.reg.codigo}? Só sai quem não tem empréstimo nem ocorrência.`)) return;
  const { error } = await sb.from("ferramentas").delete().eq("id", a.reg.id);
  if(error){ aviso("app-aviso", error.code === "23503" ? "A ferramenta tem histórico: tire do cadastro em vez de excluir." : error.message, "erro"); return; }
  aviso("app-aviso", "Ferramenta excluída.", "ok");
  _frmAtual = null;
  await carregarFerramentas(true);
  mostrarPainelFerramentas();
}

/* ---------- emprestar (uma ou várias ao mesmo funcionário) ---------- */
function frmLinhaItem(valor){
  return `<div class="grade frm-e-item"><div class="campo largo"><label>Ferramenta *</label><input class="frm-e-fer" list="frm-ferramentas-dl" autocomplete="off" placeholder="código ou nome" value="${esc(valor || "")}" /></div>
    <div class="campo"><label>Quantidade *</label><input class="frm-e-qtd" type="number" min="0.01" step="1" inputmode="decimal" value="1" /></div></div>`;
}
function abrirEmprestimoFrm(ferramentaId){
  if(!frmPodeOperar()) return;
  frmPreencherListas();
  const s = ferramentaId ? _frmSaldos.find(x => x.ferramenta_id === ferramentaId) : null;
  $("frm-e-func").value = _frmFunc ? (() => { const f = _frmFuncs.find(x => x.id === _frmFunc); return f ? frmFuncRotulo(f) : ""; })() : "";
  $("frm-e-obs").value = "";
  $("frm-e-itens").innerHTML = frmLinhaItem(s ? s.codigo + " — " + (_frmProdutos[s.produto_id]?.nome || "") + (s.descricao ? " " + s.descricao : "") : "");
  $("frm-e-aviso").textContent = "";
  $("frm-emp-modal").style.display = "flex";
  $("frm-e-func").focus();
}
async function confirmarEmprestimoFrm(){
  const f = frmFuncPorTexto($("frm-e-func").value);
  if(!f){ aviso("frm-e-aviso", "Escolha o funcionário na lista.", "erro"); return; }
  const itens = [];
  for(const div of document.querySelectorAll("#frm-e-itens .frm-e-item")){
    const t = div.querySelector(".frm-e-fer").value.trim(); if(!t) continue;
    const s = frmSaldoPorCodigo(t);
    const qtd = Number(div.querySelector(".frm-e-qtd").value);
    if(!s){ aviso("frm-e-aviso", `Ferramenta não encontrada: ${t}`, "erro"); return; }
    if(!(qtd > 0)){ aviso("frm-e-aviso", `Quantidade inválida em ${s.codigo}.`, "erro"); return; }
    itens.push({ ferramenta_id: s.ferramenta_id, quantidade: qtd });
  }
  if(!itens.length){ aviso("frm-e-aviso", "Escolha ao menos uma ferramenta.", "erro"); return; }
  const { data, error } = await sb.rpc("ferramenta_emprestar_lote", { p_funcionario: f.id, p_itens: itens, p_obs: $("frm-e-obs").value.trim() || null });
  if(error){ aviso("frm-e-aviso", error.message, "erro"); return; }
  $("frm-emp-modal").style.display = "none";
  aviso("app-aviso", `${data} empréstimo(s) registrado(s) para ${f.nome}.`, "ok");
  await frmRecarregar("emprestimos");
}

/* ---------- devolver (um empréstimo ou todos os de um funcionário) ---------- */
function abrirDevolucaoFrm(emprestimos, titulo){
  if(!frmPodeOperar() || !emprestimos.length) return;
  _frmDev = emprestimos;
  const porId = {}; _frmSaldos.forEach(s => { porId[s.ferramenta_id] = s; });
  $("frm-d-titulo").textContent = titulo;
  $("frm-d-obs").value = ""; $("frm-d-aviso").textContent = "";
  const um = emprestimos.length === 1;
  $("frm-d-itens").innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Ferramenta</th><th>Saída</th><th class="num">Em aberto</th><th class="num">Voltou ok</th><th class="num">Danificada</th><th class="num">Perdida</th></tr></thead>
    <tbody>${emprestimos.map((e, i) => { const s = porId[e.ferramenta_id] || {}; return `<tr>
      <td>${/* html */ uiCodigo(s.codigo || "—")} ${esc(_frmProdutos[s.produto_id]?.nome || "")}</td><td>${dataBR(e.data_saida)}</td>
      <td class="num">${esc(frmQ(frmAberto(e)))}</td>
      <td class="num"><input type="number" min="0" step="1" inputmode="decimal" style="width:80px;" data-frm-d="ok" data-i="${esc(i)}" value="${um ? esc(frmAberto(e)) : ""}" /></td>
      <td class="num"><input type="number" min="0" step="1" inputmode="decimal" style="width:80px;" data-frm-d="dan" data-i="${esc(i)}" /></td>
      <td class="num"><input type="number" min="0" step="1" inputmode="decimal" style="width:80px;" data-frm-d="per" data-i="${esc(i)}" /></td></tr>`; }).join("")}</tbody></table></div>`;
  $("frm-dev-modal").style.display = "flex";
}
async function confirmarDevolucaoFrm(){
  const val = (i, k) => Number(document.querySelector(`#frm-d-itens input[data-frm-d="${k}"][data-i="${i}"]`)?.value || 0);
  const linhas = _frmDev.map((e, i) => ({ e, ok: val(i, "ok"), dan: val(i, "dan"), per: val(i, "per") }))
    .filter(l => l.ok + l.dan + l.per > 0);
  if(!linhas.length){ aviso("frm-d-aviso", "Informe quanto voltou em ao menos uma linha.", "erro"); return; }
  for(const l of linhas){
    if(l.ok < 0 || l.dan < 0 || l.per < 0 || l.ok + l.dan + l.per > frmAberto(l.e)){
      aviso("frm-d-aviso", "A soma de ok, danificada e perdida não pode passar do que está em aberto.", "erro"); return;
    }
  }
  const obs = $("frm-d-obs").value.trim() || null;
  let feitos = 0;
  for(const l of linhas){
    const { error } = await sb.rpc("ferramenta_devolver", { p_emprestimo: l.e.id, p_qtd_ok: l.ok, p_qtd_danificada: l.dan, p_qtd_perdida: l.per, p_obs: obs });
    if(error){ aviso("frm-d-aviso", `${feitos} devolução(ões) gravada(s); parou em uma linha: ${error.message}`, "erro"); await frmRecarregar(); return; }
    feitos++;
  }
  $("frm-dev-modal").style.display = "none";
  aviso("app-aviso", `${feitos} devolução(ões) registrada(s).`, "ok");
  await frmRecarregar("emprestimos");
}

/* ---------- ocorrência lançada à mão ---------- */
function abrirOcorrenciaFrm(){
  const a = _frmAtual; if(!a || !a.reg.id || !frmPodeOperar()) return;
  $("frm-o-titulo").textContent = "Lançar ocorrência · " + a.reg.codigo;
  $("frm-o-tipo").value = "danificada"; $("frm-o-qtd").value = "1"; $("frm-o-data").value = hojeISO();
  $("frm-o-func").value = ""; $("frm-o-obs").value = ""; $("frm-o-aviso").textContent = "";
  $("frm-oco-modal").style.display = "flex";
}
async function salvarOcorrenciaFrm(){
  const a = _frmAtual; if(!a) return;
  const qtd = Number($("frm-o-qtd").value), tipo = $("frm-o-tipo").value;
  if(!qtd || (tipo !== "ajuste" && qtd < 0)){ aviso("frm-o-aviso", tipo === "ajuste" ? "Informe o ajuste (negativo baixa, positivo soma)." : "Informe a quantidade.", "erro"); return; }
  const ftxt = $("frm-o-func").value.trim(), f = ftxt ? frmFuncPorTexto(ftxt) : null;
  if(ftxt && !f){ aviso("frm-o-aviso", "Escolha o funcionário na lista ou deixe em branco.", "erro"); return; }
  const { error } = await sb.rpc("ferramenta_ocorrencia_lancar", { p_ferramenta: a.reg.id, p_tipo: tipo, p_qtd: qtd,
    p_funcionario: f ? f.id : null, p_emprestimo: null, p_obs: $("frm-o-obs").value.trim() || null, p_data: $("frm-o-data").value || null });
  if(error){ aviso("frm-o-aviso", error.message, "erro"); return; }
  $("frm-oco-modal").style.display = "none";
  aviso("app-aviso", "Ocorrência lançada.", "ok");
  await frmRecarregar("ocorrencias");
}
async function excluirOcorrenciaFrm(id){
  if(!frmPodeOperar() || !confirm("Excluir esta ocorrência lançada à mão? O saldo volta ao que era antes dela.")) return;
  const { error } = await sb.from("ferramenta_ocorrencias").delete().eq("id", id);
  if(error){ aviso("app-aviso", error.message, "erro"); return; }
  await frmRecarregar("ocorrencias");
}

/* ---------- smart-button "Ferramentas" na ficha do funcionário (D9) ---------- */
async function frmSmartFuncionario(funcId){
  const b = $("func-sb-ferramentas"); if(!b) return;
  b.style.display = "none"; b.dataset.id = funcId || "";
  if(!funcId) return;
  const { count, error } = await sb.from("ferramenta_emprestimos").select("id", { count: "exact", head: true })
    .eq("funcionario_id", funcId).neq("situacao", "devolvido");
  if(error || b.dataset.id !== funcId) return;
  $("func-sb-ferramentas-num").textContent = count || 0;
  b.classList.toggle("zero", !count);
  b.style.display = "";
}
async function frmAbrirDoFuncionario(funcId){
  if(!funcId || !irParaSecao("ferramentas")) return;
  _frmFunc = funcId; _frmView = "emprestimos";
  mostrarPainelFerramentas();
  await carregarFerramentas(false);
}

/* ====================================================================
   Fase 191b: kit de ferramentas da máquina (D7)
   O modelo do kit fica em ferramenta_kit_itens (aba "Kit de ferramentas" da ficha do equipamento). Na ficha da
   mobilização, "Enviar kit" chama ferramenta_kit_enviar (cria os empréstimos da máquina; o que não tem disponível vai
   para a lista "faltou no envio") e "Receber kit" chama ferramenta_kit_receber (ok, danificado, faltando, pela mesma
   regra da devolução). O kit não mexe em status nem em localização da mobilização (§8).
   ==================================================================== */
let _frmKitEqp = null;   // { e, itens, abertos } da ficha do equipamento
let _frmKitMob = null;   // { m, tags, eqpId, itens, emps, ocorr, faltou, recebendo } da ficha da mobilização

function frmSaldoDe(id){ return _frmSaldos.find(x => x.ferramenta_id === id) || null; }
function frmCodFer(id){ return frmSaldoDe(id)?.codigo || "—"; }
function frmNomeFer(id){ const s = frmSaldoDe(id); return s ? (_frmProdutos[s.produto_id]?.nome || "") + (s.descricao ? " · " + s.descricao : "") : ""; }
function frmOrdCod(a, b){ return String(frmCodFer(a)).localeCompare(String(frmCodFer(b)), "pt-BR", { numeric: true }); }
function frmQtdOuVazio(v){ return Number(v) ? frmQ(v) : ""; }

/* ---------- folha de conferência (leiaute da planilha: saída, local, operador, entrada e os dois responsáveis) ---------- */
async function frmKitImprimir(ctx){
  const td = "border:1px solid;padding:3px 4px;";
  const linhas = ctx.linhas.map((l, i) => `<tr><td style="${td}text-align:center;">${esc(i + 1)}</td><td style="${td}">${esc(l.codigo)}</td><td style="${td}">${esc(l.nome)}</td>
    <td style="${td}text-align:right;">${esc(frmQtdOuVazio(l.kit))}</td><td style="${td}text-align:right;">${esc(frmQtdOuVazio(l.saida))}</td>
    <td style="${td}text-align:right;">${esc(frmQtdOuVazio(l.ok))}</td><td style="${td}text-align:right;">${esc(frmQtdOuVazio(l.dan))}</td>
    <td style="${td}text-align:right;">${esc(frmQtdOuVazio(l.falt))}</td><td style="${td}width:120px;"></td></tr>`).join("");
  const campo = (rot, val) => `<td style="padding:3px;width:50%;"><b>${esc(rot)}:</b> ${esc(val || "______________________________")}</td>`;
  const html = `<div style="font-family:'Outfit',Arial,sans-serif;font-size:11px;">
    ${typeof pdfCabecalhoHTML === "function" ? pdfCabecalhoHTML("Kit de ferramentas", ctx.tag + (ctx.nome ? " · " + ctx.nome : "")) : `<h2>Kit de ferramentas ${esc(ctx.tag)}</h2>`}
    <table style="width:100%;border-collapse:collapse;margin:8px 0 12px;">
      <tr>${/* html */ campo("Saída", ctx.saida ? dataBR(ctx.saida) : "")}${/* html */ campo("Local", ctx.local)}</tr>
      <tr>${/* html */ campo("Operador", ctx.operador)}${/* html */ campo("Entrada", ctx.entrada ? dataBR(ctx.entrada) : "")}</tr>
    </table>
    <table style="width:100%;border-collapse:collapse;"><thead>
      <tr><th style="${td}" rowspan="2">#</th><th style="${td}" rowspan="2">Código</th><th style="${td}text-align:left;" rowspan="2">Ferramenta</th>
        <th style="${td}" rowspan="2">Qtd. kit</th><th style="${td}" rowspan="2">Saída</th><th style="${td}" colspan="3">Entrada</th><th style="${td}" rowspan="2">Observação</th></tr>
      <tr><th style="${td}">OK</th><th style="${td}">Danif.</th><th style="${td}">Falta</th></tr>
    </thead><tbody>${/* html */ linhas || `<tr><td style="${td}" colspan="9">Kit vazio.</td></tr>`}</tbody></table>
    <table style="width:100%;border-collapse:collapse;margin-top:28px;"><tr>
      <td style="padding:3px;width:50%;"><b>Responsável carga:</b> ______________________________</td>
      <td style="padding:3px;width:50%;"><b>Responsável vistoria:</b> ______________________________</td></tr></table>
  </div>`;
  const arquivo = "Kit_ferramentas_" + String(ctx.tag || "maquina").replace(/[^A-Za-z0-9_-]/g, "_");
  const wrap = document.createElement("div"); wrap.innerHTML = html;
  if(typeof html2pdf === "undefined" || typeof pdfGerar !== "function"){
    const w = window.open("", "_blank"); if(!w){ aviso("app-aviso", "Permita pop-ups para imprimir.", "erro"); return; }
    w.document.write(`<html><head><title>${esc(arquivo)}</title><style>@page { size: A4; margin: 12mm; }</style></head><body>${/* html */ html}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); return;
  }
  try { await pdfGerar(wrap, { filename: arquivo + ".pdf", largura: 186, topo: 12 }); }
  catch(e){ aviso("app-aviso", "Não foi possível gerar o PDF: " + (e.message || e), "erro"); }
}

/* ---------- aba "Kit de ferramentas" da ficha do equipamento ---------- */
async function frmKitEquipamento(e){
  const cont = $("eqp-frm-kit"), sbb = $("sb-eqp-kitfrm");
  if(sbb){ sbb.querySelector(".sb-num").textContent = "0"; sbb.classList.add("zero"); }
  if(!cont) return;
  _frmKitEqp = null;
  if(!e || !e.id){ cont.innerHTML = uiVazio("Salve o equipamento para montar o kit de ferramentas."); return; }
  cont.innerHTML = uiVazio("Carregando o kit…");
  const id = e.id;
  const [erroBase, ki, ab] = await Promise.all([
    _frmCarregado ? Promise.resolve(null) : frmCarregarBase(),
    lerTudo(() => sb.from("ferramenta_kit_itens").select("*").eq("equipamento_id", id), "id"),
    lerTudo(() => sb.from("ferramenta_emprestimos").select("*").eq("equipamento_id", id).neq("situacao", "devolvido"), "id")
  ]);
  if(typeof _eqpAtual !== "undefined" && _eqpAtual?.id !== id) return;
  const erro = erroBase || ki.error?.message || ab.error?.message;
  if(erro){ cont.innerHTML = uiVazio("Erro ao ler o kit: " + erro); return; }
  _frmKitEqp = { e, itens: ki.data, abertos: ab.data };
  renderFrmKitEquipamento();
}
function renderFrmKitEquipamento(){
  const k = _frmKitEqp, cont = $("eqp-frm-kit"); if(!k || !cont) return;
  const opera = frmPodeOperar();
  const sbb = $("sb-eqp-kitfrm");
  if(sbb){ sbb.querySelector(".sb-num").textContent = k.itens.length; sbb.classList.toggle("zero", !k.itens.length); }
  const itens = [...k.itens].sort((a, b) => frmOrdCod(a.ferramenta_id, b.ferramenta_id));
  const emMaquina = {}; k.abertos.forEach(x => { emMaquina[x.ferramenta_id] = (emMaquina[x.ferramenta_id] || 0) + frmAberto(x); });
  const modelo = !itens.length ? uiVazio(opera ? "Nenhuma ferramenta no kit. Adicione abaixo." : "Nenhuma ferramenta no kit desta máquina.") : `<div class="tabela-rola"><table>
    <thead><tr><th>Código</th><th>Ferramenta</th><th class="num">Qtd. no kit</th><th class="num" title="Pronta para emprestar no almoxarifado">Disponível</th><th class="num" title="Empréstimos abertos para esta máquina">Na máquina</th><th>Observação</th><th></th></tr></thead>
    <tbody>${itens.map(i => `<tr>
      <td>${/* html */ uiCodigo(frmCodFer(i.ferramenta_id))}</td><td>${esc(frmNomeFer(i.ferramenta_id))}</td>
      <td class="num">${opera ? `<input type="number" min="0.01" step="1" inputmode="decimal" style="width:80px;" data-frm-kit-qtd="${esc(i.id)}" value="${esc(i.quantidade)}" aria-label="Quantidade no kit" />` : esc(frmQ(i.quantidade))}</td>
      <td class="num">${esc(frmQ(frmSaldoDe(i.ferramenta_id)?.disponivel))}</td><td class="num">${esc(frmQtdOuVazio(emMaquina[i.ferramenta_id]) || "—")}</td>
      <td>${opera ? `<input data-frm-kit-obs="${esc(i.id)}" value="${esc(i.observacao || "")}" aria-label="Observação do item" />` : `<span class="meta">${esc(i.observacao || "")}</span>`}</td>
      <td>${opera ? `<button type="button" class="btn-sec btn-sm acao-perigo" data-frm-kit-rem="${esc(i.id)}" title="Tira a ferramenta do modelo do kit (os empréstimos abertos continuam)">Tirar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  const naKit = new Set(k.itens.map(i => i.ferramenta_id));
  const opcoes = _frmSaldos.filter(s => s.ativo && !naKit.has(s.ferramenta_id)).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }))
    .map(s => `<option value="${esc(s.codigo + " — " + frmNomeFer(s.ferramenta_id))}"></option>`).join("");
  const adicionar = opera ? `<div class="grade" style="margin-top:8px;">
      <div class="campo largo"><label for="frm-kit-nova">Adicionar ferramenta ao kit</label><input id="frm-kit-nova" list="frm-kit-dl" autocomplete="off" placeholder="código ou nome" /><datalist id="frm-kit-dl">${/* html */ opcoes}</datalist></div>
      <div class="campo"><label for="frm-kit-nova-qtd">Quantidade</label><input id="frm-kit-nova-qtd" type="number" min="0.01" step="1" inputmode="decimal" value="1" /></div>
      <div class="campo"><label>&nbsp;</label><button type="button" class="btn-sec" id="btn-frm-kit-add">Adicionar</button></div></div>` : "";
  const abertos = [...k.abertos].sort((a, b) => String(a.data_saida).localeCompare(String(b.data_saida)));
  const naMaquina = !abertos.length ? uiVazio("Nenhuma ferramenta emprestada a esta máquina agora.") : `<div class="tabela-rola"><table>
    <thead><tr><th>Saída</th><th>Ferramenta</th><th class="num">Em aberto</th><th>Origem</th><th>Observação</th></tr></thead>
    <tbody>${abertos.map(x => `<tr><td>${dataBR(x.data_saida)}</td><td>${/* html */ uiCodigo(frmCodFer(x.ferramenta_id))} ${esc(frmNomeFer(x.ferramenta_id))}</td>
      <td class="num">${esc(frmQ(frmAberto(x)))}</td><td>${x.mobilizacao_id ? "Kit da mobilização" : "Empréstimo avulso"}${x.obra_id && typeof linkObra === "function" ? " · " + linkObra(x.obra_id, (typeof mapaObras === "object" && mapaObras && mapaObras[x.obra_id]) || "obra") : ""}</td>
      <td class="meta">${esc(x.observacao || "")}</td></tr>`).join("")}</tbody></table></div>`;
  cont.innerHTML = `<div class="lista-topo compacta"><p class="meta" style="margin:0;">O kit é o que a máquina leva em toda mobilização. Enviar e receber ficam na ficha da mobilização (aba Kit).</p>
      <button type="button" class="btn-sec btn-sm" id="btn-frm-kit-folha" style="margin-left:auto;" title="Folha de conferência do kit em branco, no leiaute da planilha">Imprimir folha do kit</button></div>`
    + uiSecao("documento", "Modelo do kit", modelo + adicionar, `${itens.length} item(ns)`)
    + uiSecao("maquina", "Na máquina agora", naMaquina, `${abertos.length}`);
  $("btn-frm-kit-folha")?.addEventListener("click", () => comBotaoTravado("btn-frm-kit-folha", () => frmKitImprimir({
    tag: k.e.codigo || "", nome: k.e.nome || "", saida: null, entrada: null, local: "", operador: "",
    linhas: itens.map(i => ({ codigo: frmCodFer(i.ferramenta_id), nome: frmNomeFer(i.ferramenta_id), kit: i.quantidade }))
  })));
  if(!opera) return;
  $("btn-frm-kit-add")?.addEventListener("click", () => comBotaoTravado("btn-frm-kit-add", frmKitAdicionar));
  cont.querySelectorAll("[data-frm-kit-qtd]").forEach(inp => inp.addEventListener("change", () => frmKitAtualizar(inp.dataset.frmKitQtd, { quantidade: Number(inp.value) })));
  cont.querySelectorAll("[data-frm-kit-obs]").forEach(inp => inp.addEventListener("change", () => frmKitAtualizar(inp.dataset.frmKitObs, { observacao: inp.value.trim() || null })));
  cont.querySelectorAll("[data-frm-kit-rem]").forEach(b => b.addEventListener("click", () => frmKitRemover(b.dataset.frmKitRem)));
}
async function frmKitAdicionar(){
  const k = _frmKitEqp; if(!k || !frmPodeOperar()) return;
  const s = frmSaldoPorCodigo($("frm-kit-nova").value), qtd = Number($("frm-kit-nova-qtd").value);
  if(!s){ aviso("app-aviso", "Escolha a ferramenta na lista (código — nome).", "erro"); return; }
  if(!(qtd > 0)){ aviso("app-aviso", "A quantidade tem de ser maior que zero.", "erro"); return; }
  const { error } = await sb.from("ferramenta_kit_itens").insert({ equipamento_id: k.e.id, ferramenta_id: s.ferramenta_id, quantidade: qtd });
  if(error){ aviso("app-aviso", error.code === "23505" ? "A ferramenta já está no kit desta máquina." : error.message, "erro"); return; }
  await frmKitEquipamento(k.e);
}
async function frmKitAtualizar(id, campos){
  const k = _frmKitEqp; if(!k || !frmPodeOperar()) return;
  if("quantidade" in campos && !(campos.quantidade > 0)){ aviso("app-aviso", "A quantidade tem de ser maior que zero.", "erro"); renderFrmKitEquipamento(); return; }
  const { error } = await sb.from("ferramenta_kit_itens").update(campos).eq("id", id);
  if(error){ aviso("app-aviso", error.message, "erro"); }
  await frmKitEquipamento(k.e);
}
async function frmKitRemover(id){
  const k = _frmKitEqp; if(!k || !frmPodeOperar()) return;
  if(!confirm("Tirar esta ferramenta do modelo do kit? O que já está emprestado à máquina continua aberto.")) return;
  const { error } = await sb.from("ferramenta_kit_itens").delete().eq("id", id);
  if(error){ aviso("app-aviso", error.message, "erro"); return; }
  await frmKitEquipamento(k.e);
}

/* ---------- ficha da mobilização: Enviar kit e Receber kit ---------- */
async function frmKitMobRender(m){
  const cont = $("mob-frm-kit"); if(!cont || !m) return;
  const tags = [m.equipamento_id, ...(m.equipamentos_apoio || [])].filter(Boolean);
  if(!tags.length){ cont.innerHTML = uiVazio("Defina a TAG principal para enviar o kit de ferramentas."); return; }
  const mesma = _frmKitMob && _frmKitMob.m.id === m.id;
  const eqpId = mesma && tags.includes(_frmKitMob.eqpId) ? _frmKitMob.eqpId : tags[0];
  cont.innerHTML = uiVazio("Carregando o kit de ferramentas…");
  const [erroBase, ki, em] = await Promise.all([
    _frmCarregado ? Promise.resolve(null) : frmCarregarBase(),
    lerTudo(() => sb.from("ferramenta_kit_itens").select("*").in("equipamento_id", tags), "id"),
    lerTudo(() => sb.from("ferramenta_emprestimos").select("*").eq("mobilizacao_id", m.id), "id")
  ]);
  const erro = erroBase || ki.error?.message || em.error?.message;
  if(erro){ cont.innerHTML = uiVazio("Erro ao ler o kit: " + erro); return; }
  const ids = em.data.map(x => x.id);
  const oc = ids.length ? await lerTudo(() => sb.from("ferramenta_ocorrencias").select("id,emprestimo_id,tipo,quantidade").in("emprestimo_id", ids), "id") : { data: [] };
  if(typeof _mobAberta !== "undefined" && _mobAberta && _mobAberta.id !== m.id) return;
  _frmKitMob = { m, tags, eqpId, itens: ki.data, emps: em.data, ocorr: oc.data || [], faltou: mesma ? _frmKitMob.faltou : null, recebendo: false };
  renderFrmKitMob();
}
/* uma linha por ferramenta (kit da TAG escolhida + o que saiu nesta mobilização) */
function frmKitMobLinhas(){
  const k = _frmKitMob;
  const emps = k.emps.filter(x => x.equipamento_id === k.eqpId);
  const porFer = {};
  const linha = id => porFer[id] || (porFer[id] = { ferramenta_id: id, codigo: frmCodFer(id), nome: frmNomeFer(id), kit: 0, saida: 0, ok: 0, dan: 0, falt: 0, aberto: 0 });
  k.itens.filter(i => i.equipamento_id === k.eqpId).forEach(i => { linha(i.ferramenta_id).kit = Number(i.quantidade); });
  emps.forEach(x => {
    const l = linha(x.ferramenta_id);
    const dan = k.ocorr.filter(o => o.emprestimo_id === x.id && o.tipo === "danificada").reduce((t, o) => t + Number(o.quantidade), 0);
    const per = k.ocorr.filter(o => o.emprestimo_id === x.id && o.tipo === "perdida").reduce((t, o) => t + Number(o.quantidade), 0);
    l.saida += Number(x.quantidade); l.dan += dan; l.falt += per; l.ok += Number(x.quantidade_devolvida) - dan - per; l.aberto += frmAberto(x);
  });
  return Object.values(porFer).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
}
function renderFrmKitMob(){
  const k = _frmKitMob, cont = $("mob-frm-kit"); if(!k || !cont) return;
  const m = k.m, opera = frmPodeOperar();
  const linhas = frmKitMobLinhas();
  const abertos = k.emps.filter(x => x.equipamento_id === k.eqpId && x.situacao !== "devolvido")
    .sort((a, b) => frmOrdCod(a.ferramenta_id, b.ferramenta_id));
  const temKit = k.itens.some(i => i.equipamento_id === k.eqpId);
  const podeEnviar = opera && temKit && !["cancelada", "desmobilizada"].includes(m.status);
  const seletor = k.tags.length > 1 ? `<select id="frm-kit-mob-tag" aria-label="Máquina do kit">${k.tags.map(t => `<option value="${esc(t)}"${t === k.eqpId ? " selected" : ""}>${esc(_frmEqps[t] || "?")}${t === m.equipamento_id ? " (principal)" : " (apoio)"}</option>`).join("")}</select>` : "";
  const faltou = k.faltou && k.faltou.eqpId === k.eqpId && k.faltou.lista.length
    ? `<p class="aviso atencao mob-aviso-bloco"><strong>Faltou no envio:</strong> ${k.faltou.lista.map(f => `${esc(f.codigo)} (faltou ${esc(frmQ(f.faltou))} de ${esc(frmQ(f.pedido))})`).join(", ")}. O resto do kit saiu; quando houver disponível, "Enviar kit" de novo completa só o que faltou.</p>` : "";
  const tabela = !linhas.length ? uiVazio(temKit ? "Kit ainda não enviado." : "Esta máquina não tem kit de ferramentas. Monte o modelo na ficha do equipamento, aba Kit de ferramentas.") : `<div class="tabela-rola"><table>
    <thead><tr><th>Código</th><th>Ferramenta</th><th class="num">No kit</th><th class="num">Saiu</th><th class="num">Voltou ok</th><th class="num">Danificada</th><th class="num">Faltou</th><th class="num">Em aberto</th></tr></thead>
    <tbody>${linhas.map(l => `<tr><td>${/* html */ uiCodigo(l.codigo)}</td><td>${esc(l.nome)}</td><td class="num">${esc(frmQtdOuVazio(l.kit) || "—")}</td>
      <td class="num">${esc(frmQtdOuVazio(l.saida) || "—")}</td><td class="num">${esc(frmQtdOuVazio(l.ok))}</td>
      <td class="num">${l.dan ? `<span class="tag ambar">${esc(frmQ(l.dan))}</span>` : ""}</td><td class="num">${l.falt ? `<span class="tag vermelho">${esc(frmQ(l.falt))}</span>` : ""}</td>
      <td class="num">${l.aberto ? `<strong>${esc(frmQ(l.aberto))}</strong>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  const receber = k.recebendo && abertos.length ? uiSecao("check", "Receber kit: conferir item por item", `<div class="tabela-rola"><table>
      <thead><tr><th>Ferramenta</th><th>Saída</th><th class="num">Em aberto</th><th class="num">Voltou ok</th><th class="num">Danificada</th><th class="num">Faltando</th></tr></thead>
      <tbody>${abertos.map((x, i) => `<tr><td>${/* html */ uiCodigo(frmCodFer(x.ferramenta_id))} ${esc(frmNomeFer(x.ferramenta_id))}</td><td>${dataBR(x.data_saida)}</td><td class="num">${esc(frmQ(frmAberto(x)))}</td>
        <td class="num"><input type="number" min="0" step="1" inputmode="decimal" style="width:80px;" data-frm-kr="ok" data-i="${esc(i)}" value="${esc(frmAberto(x))}" aria-label="Voltou ok" /></td>
        <td class="num"><input type="number" min="0" step="1" inputmode="decimal" style="width:80px;" data-frm-kr="dan" data-i="${esc(i)}" aria-label="Danificada" /></td>
        <td class="num"><input type="number" min="0" step="1" inputmode="decimal" style="width:80px;" data-frm-kr="fal" data-i="${esc(i)}" aria-label="Faltando" /></td></tr>`).join("")}</tbody></table></div>
      <p class="meta">Danificada e faltando viram ocorrência da ferramenta. Linha em branco fica aberta.</p>
      <div class="mob-acoes"><button type="button" class="btn" id="btn-frm-kit-receber-ok">Confirmar recebimento</button><button type="button" class="btn-sec" id="btn-frm-kit-receber-cancelar">Cancelar</button></div>`) : "";
  cont.innerHTML = `<div class="mob-acoes">
      ${seletor}
      ${podeEnviar ? `<button type="button" class="btn-sec btn-sm" id="btn-frm-kit-enviar" title="Empresta à máquina cada item do kit que tem disponível; o que faltar aparece na lista">Enviar kit</button>` : ""}
      ${opera && abertos.length && !k.recebendo ? `<button type="button" class="btn-sec btn-sm" id="btn-frm-kit-receber" title="Confere a volta do kit item por item: ok, danificada ou faltando">Receber kit</button>` : ""}
      <button type="button" class="btn-sec btn-sm" id="btn-frm-kit-mob-folha" title="Folha de conferência no leiaute da planilha: saída, local, operador, entrada e os responsáveis">Imprimir folha</button>
      <span class="meta">O kit não muda o status nem a localização da máquina.</span>
    </div>${/* html */ faltou}${/* html */ tabela}${/* html */ receber}`;
  $("frm-kit-mob-tag")?.addEventListener("change", ev => { k.eqpId = ev.target.value; k.recebendo = false; renderFrmKitMob(); });
  $("btn-frm-kit-enviar")?.addEventListener("click", () => comBotaoTravado("btn-frm-kit-enviar", frmKitEnviar));
  $("btn-frm-kit-receber")?.addEventListener("click", () => { k.recebendo = true; renderFrmKitMob(); });
  $("btn-frm-kit-receber-cancelar")?.addEventListener("click", () => { k.recebendo = false; renderFrmKitMob(); });
  $("btn-frm-kit-receber-ok")?.addEventListener("click", () => comBotaoTravado("btn-frm-kit-receber-ok", () => frmKitReceber(abertos)));
  $("btn-frm-kit-mob-folha")?.addEventListener("click", () => comBotaoTravado("btn-frm-kit-mob-folha", () => frmKitMobImprimir(linhas)));
}
async function frmKitEnviar(){
  const k = _frmKitMob; if(!k || !frmPodeOperar()) return;
  const tag = _frmEqps[k.eqpId] || "?";
  if(!confirm(`Enviar o kit de ferramentas da ${tag} nesta mobilização? Cada item com disponível vira empréstimo à máquina.`)) return;
  const { data, error } = await sb.rpc("ferramenta_kit_enviar", { p_equipamento: k.eqpId, p_mobilizacao: k.m.id, p_obs: null });
  if(error){ aviso("app-aviso", error.message, "erro"); return; }
  const lista = (data && data.faltou) || [];
  aviso("app-aviso", `${data?.enviados || 0} item(ns) do kit enviados${lista.length ? `; ${lista.length} faltou(aram) no envio` : ""}.`, lista.length ? "aviso" : "ok");
  k.faltou = { eqpId: k.eqpId, lista };
  _frmCarregado = false;   // saldos mudaram
  await frmKitMobRender(k.m);
}
async function frmKitReceber(abertos){
  const k = _frmKitMob; if(!k || !frmPodeOperar()) return;
  const val = (i, c) => Number(document.querySelector(`#mob-frm-kit input[data-frm-kr="${c}"][data-i="${i}"]`)?.value || 0);
  const itens = [];
  for(let i = 0; i < abertos.length; i++){
    const x = abertos[i], ok = val(i, "ok"), dan = val(i, "dan"), fal = val(i, "fal");
    if(ok < 0 || dan < 0 || fal < 0){ aviso("app-aviso", "Quantidades não podem ser negativas.", "erro"); return; }
    if(ok + dan + fal > frmAberto(x)){ aviso("app-aviso", `${frmCodFer(x.ferramenta_id)}: a soma passa do que está em aberto (${frmQ(frmAberto(x))}).`, "erro"); return; }
    if(ok + dan + fal > 0) itens.push({ emprestimo_id: x.id, ok, danificado: dan, faltando: fal });
  }
  if(!itens.length){ aviso("app-aviso", "Informe o que voltou em ao menos uma linha.", "erro"); return; }
  const { data, error } = await sb.rpc("ferramenta_kit_receber", { p_mobilizacao: k.m.id, p_itens: itens });
  if(error){ aviso("app-aviso", error.message, "erro"); return; }
  aviso("app-aviso", `${data?.recebidos || 0} item(ns) recebidos${data?.abertos ? `; ${data.abertos} continua(m) em aberto` : ""}.`, "ok");
  _frmCarregado = false;
  k.recebendo = false;
  await frmKitMobRender(k.m);
}
async function frmKitMobImprimir(linhas){
  const k = _frmKitMob; if(!k) return;
  const m = k.m;
  const { data: obra } = await sb.from("obras").select("codigo,nome,cidade").eq("id", m.obra_id).maybeSingle();
  const operador = typeof mobEquipeDe === "function"
    ? mobEquipeDe(m.id).filter(x => /operador/i.test(x.funcao || "") && !/caminh/i.test(x.funcao || "")).map(x => (x.funcionario && x.funcionario.nome) || "").filter(Boolean).join(", ")
    : "";
  const emps = k.emps.filter(x => x.equipamento_id === k.eqpId);
  const saidas = emps.map(x => x.data_saida).filter(Boolean).sort();
  const voltas = emps.filter(x => x.situacao === "devolvido").map(x => x.data_devolucao).filter(Boolean).sort();
  const tudoVoltou = emps.length && emps.every(x => x.situacao === "devolvido");
  await frmKitImprimir({
    tag: _frmEqps[k.eqpId] || "", nome: _frmEqpNomes[k.eqpId] || "",
    saida: m.data_saida_real || saidas[0] || null,
    entrada: m.data_desmob_real || (tudoVoltou ? voltas[voltas.length - 1] : null),
    local: obra ? [obra.codigo, obra.nome, obra.cidade].filter(Boolean).join(" · ") : "",
    operador,
    linhas
  });
}

/* ---------- ligação ---------- */
function ligarFerramentas(){
  if(!$("sec-ferramentas")) return;
  document.querySelector('nav button[data-secao="ferramentas"]')?.addEventListener("click", () => { mostrarPainelFerramentas(); carregarFerramentas(false); });
  document.querySelectorAll("#frm-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _frmView = b.dataset.view; renderFerramentas(); }));
  $("frm-busca")?.addEventListener("input", debounce(renderFerramentas));
  ["frm-situacao", "frm-ativo"].forEach(id => $(id)?.addEventListener("change", renderFerramentas));
  $("btn-frm-atualizar")?.addEventListener("click", () => carregarFerramentas(true));
  $("btn-frm-nova")?.addEventListener("click", () => abrirFerramenta(null));
  $("btn-frm-emprestar")?.addEventListener("click", () => abrirEmprestimoFrm(null));
  $("frm-painel")?.addEventListener("click", e => {
    const t = e.target.closest("[data-frm-abrir],[data-frm-func],[data-frm-devolver],[data-frm-dev-func],#btn-frm-limpar-func,tr[data-id]");
    if(!t) return;
    if(t.id === "btn-frm-limpar-func"){ _frmFunc = null; renderFerramentas(); return; }
    e.preventDefault();
    if(t.dataset.frmAbrir) abrirFerramenta(t.dataset.frmAbrir);
    else if(t.dataset.frmFunc){ _frmFunc = t.dataset.frmFunc; renderFerramentas(); }
    else if(t.dataset.frmDevolver){ const em = _frmAbertos.find(x => x.id === t.dataset.frmDevolver); if(em) abrirDevolucaoFrm([em], "Devolver · " + frmDestino(em)); }
    else if(t.dataset.frmDevFunc){ const id = t.dataset.frmDevFunc; abrirDevolucaoFrm(_frmAbertos.filter(x => x.funcionario_id === id), "Devolver · " + frmFuncNome(id)); }
    else if(t.dataset.id) abrirFerramenta(t.dataset.id);
  });
  $("frm-conteudo")?.addEventListener("keydown", e => { const tr = e.target.closest("tr[data-id]"); if(tr && e.key === "Enter") abrirFerramenta(tr.dataset.id); });
  $("btn-frm-voltar")?.addEventListener("click", mostrarPainelFerramentas);
  $("btn-frm-salvar")?.addEventListener("click", () => comBotaoTravado("btn-frm-salvar", salvarFerramenta));
  $("btn-frm-f-emprestar")?.addEventListener("click", () => abrirEmprestimoFrm(_frmAtual?.reg?.id));
  $("btn-frm-ocorrencia")?.addEventListener("click", abrirOcorrenciaFrm);
  $("btn-frm-excluir")?.addEventListener("click", excluirFerramenta);
  $("frm-statusbar")?.addEventListener("click", e => { const st = e.target.closest(".stage"); if(st) frmMudarAtivo(st.dataset.status); });
  document.querySelectorAll("#frm-notebook button").forEach(b => b.addEventListener("click", () => ativarTabFerramenta(b.dataset.tab)));
  document.querySelectorAll("#frm-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => ativarTabFerramenta(b.dataset.gotoTab)));
  $("sb-frm-produto")?.addEventListener("click", () => {
    const id = _frmAtual?.reg?.produto_id; if(!id) return;
    if(irParaSecao("produtos") && typeof abrirProduto === "function") abrirProduto(id);
  });
  $("frm-ficha")?.addEventListener("click", e => {
    const t = e.target.closest("button"); if(!t) return;
    if(t.dataset.frmDevolver){ const em = _frmAtual?.emprestimos.find(x => x.id === t.dataset.frmDevolver); if(em) abrirDevolucaoFrm([em], "Devolver · " + frmDestino(em)); }
    else if(t.dataset.frmOcoExcluir) excluirOcorrenciaFrm(t.dataset.frmOcoExcluir);
  });
  $("btn-frm-e-mais")?.addEventListener("click", () => { $("frm-e-itens").insertAdjacentHTML("beforeend", frmLinhaItem("")); });
  $("btn-frm-e-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-frm-e-confirmar", confirmarEmprestimoFrm));
  $("btn-frm-d-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-frm-d-confirmar", confirmarDevolucaoFrm));
  $("btn-frm-o-salvar")?.addEventListener("click", () => comBotaoTravado("btn-frm-o-salvar", salvarOcorrenciaFrm));
  ["frm-emp-modal", "frm-dev-modal", "frm-oco-modal"].forEach(id => {
    const m = $(id); if(!m) return;
    m.querySelector(".modal-topo button")?.addEventListener("click", () => { m.style.display = "none"; });
    m.addEventListener("click", e => { if(e.target === m) m.style.display = "none"; });
  });
  $("func-sb-ferramentas")?.addEventListener("click", () => frmAbrirDoFuncionario($("func-sb-ferramentas").dataset.id));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarFerramentas);
else ligarFerramentas();

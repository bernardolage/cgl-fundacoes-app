/* ====================================================================
   js/sesmt_treinamentos.js — fase 185a (#213, #243, #313): treinamentos do SESMT. Prefixo trn-.
   - Visão "Treinamentos" no painel SESMT (lista, kanban pendente → agendado → realizado → vencido, turmas) e visão
     "Custo SST" (relatório por obra e sede; fora de vw_custos, D10). As duas entram pelo #sst-views do js/sesmt.js.
   - Ficha da turma (#trn-ficha, padrão Odoo): Concluir turma (RPC sst_turma_concluir, que gera os documentos) e Cancelar;
     abas Dados, Participantes (presença, nota, aprovado, certificado anexado) e Anexos (sst-documentos/<turma>/anexos).
   - Aba Segurança do funcionário: "Lançar treinamento" (RPC sst_treinamento_lancar = turma de 1 pessoa com o padrão do
     catálogo) e a lista dos treinamentos da pessoa com o status calculado (RPC sst_treinamentos, D7).
   Status: nenhum é digitado; pendente = matriz exige e não há turma; agendado = turma planejada; realizado = documento
   válido; vencido = validade passou. Leitura por sst_pode_ler() (SESMT, extra, rh, auditor); gravação por
   sst_pode_operar() (o banco confere; aqui só se escondem os botões).
   ==================================================================== */
let _trnSub = "lista";          // lista | kanban | turmas
let _trnStatus = [];            // retorno de sst_treinamentos (pessoa × treinamento)
let _trnTurmas = [];            // sst_turmas (+ participantes)
let _trnFornecedores = [];      // fornecedores ativos (id, nome)
let _trnCarregado = false;
let _trnEditId = null;          // turma aberta na ficha
let _trnTurma = null;
let _trnParts = [];
let _trnAnexos = [];

const TRN_STATUS = {
  pendente:  { label: "Pendente",  cor: "ambar" },
  agendado:  { label: "Agendado",  cor: "azul" },
  realizado: { label: "Realizado", cor: "verde" },
  vencido:   { label: "Vencido",   cor: "vermelho" }
};
const TRN_TURMA_STATUS = { planejada: "Planejada", realizada: "Realizada", cancelada: "Cancelada" };
const TRN_MODALIDADE = { interna: "Interna (CGL)", terceira: "Empresa terceira" };
const TRN_MOTIVO = { admissao: "Admissão", renovacao: "Renovação", capacitacao: "Capacitação", mudanca_funcao: "Mudança de função", exigencia_cliente: "Exigência do cliente" };
const TRN_TIPO = { formacao: "Formação", reciclagem: "Reciclagem" };
const TRN_DESTINO = { sesmt: "Centro SESMT (sede)", obra: "Obra" };

function trnTag(st){ const o = TRN_STATUS[st]; return o ? `<span class="tag ${esc(o.cor)}">${esc(o.label)}</span>` : `<span class="tag cinza">${esc(st || "—")}</span>`; }
function trnTagTurma(st){ return `<span class="tag ${st === "realizada" ? "verde" : st === "cancelada" ? "cinza" : "azul"}">${esc(TRN_TURMA_STATUS[st] || st || "—")}</span>`; }
function trnReqs(){ return (_sstReqs || []).filter(r => r.natureza === "treinamento"); }
function trnFuncNome(id){ const f = (_sstFuncs || []).find(x => x.id === id); return f ? f.nome : "—"; }
function trnFornNome(id){ const f = _trnFornecedores.find(x => x.id === id); return f ? f.nome : "—"; }
function trnEquipCodigo(id){ const e = (_sstEquipamentos || []).find(x => x.id === id); return e ? e.codigo : "—"; }
function trnObraRot(id){ return id ? sstObraRotulo((_sstObras || []).find(o => o.id === id)) : "—"; }
function trnTurmaPorId(id){ return _trnTurmas.find(t => t.id === id); }
function trnDataTurma(t){ return t ? (t.data_fim || t.data_inicio) : null; }

/* ---------- carga ---------- */
async function trnCarregarFornecedores(){
  if(_trnFornecedores.length) return;
  const { data } = await lerTudo(() => sb.from("fornecedores").select("id,razao_social,nome_fantasia").eq("ativo", true));
  _trnFornecedores = (data || []).map(f => ({ id: f.id, nome: f.nome_fantasia || f.razao_social || "—" })).sort((a, b) => a.nome.localeCompare(b.nome));
}
async function trnCarregar(forcar){
  if(_trnCarregado && !forcar) return true;
  const [st, tu] = await Promise.all([
    lerTudo(() => sb.rpc("sst_treinamentos", { p_funcionarios: null, p_data: hojeISO() }), ["funcionario_id", "requisito_id"]),
    lerTudo(() => sb.from("sst_turmas").select("*, participantes:sst_turma_participantes(id,funcionario_id,presente,aprovado,documento_id)"))
  ]);
  if(st.error || tu.error){ aviso("app-aviso", "Erro ao carregar os treinamentos: " + (st.error || tu.error).message, "erro"); return false; }
  _trnStatus = st.data || []; _trnTurmas = tu.data || [];
  await trnCarregarFornecedores();
  _trnCarregado = true;
  return true;
}

/* ---------- visão Treinamentos (pelo renderSesmt) ---------- */
function trnFiltrosHTML(){
  const reqs = trnReqs().filter(r => r.ativo);
  return `<div class="serv-filtros" id="trn-filtros">
    <div class="serv-views" id="trn-sub" title="Como mostrar: uma linha por pessoa e treinamento, colunas por situação ou as turmas">
      <button type="button" class="serv-view-btn${_trnSub === "lista" ? " ativo" : ""}" data-sub="lista" title="Pessoa × treinamento com o status calculado">Lista</button>
      <button type="button" class="serv-view-btn${_trnSub === "kanban" ? " ativo" : ""}" data-sub="kanban" title="Colunas pendente, agendado, realizado e vencido">Kanban</button>
      <button type="button" class="serv-view-btn${_trnSub === "turmas" ? " ativo" : ""}" data-sub="turmas" title="Turmas planejadas, realizadas e canceladas">Turmas</button>
    </div>
    <select id="trn-f-req" title="Filtrar por treinamento do catálogo"><option value="">Treinamento</option>${reqs.map(r => `<option value="${esc(r.id)}">${esc(r.codigo)} · ${esc(r.nome)}</option>`).join("")}</select>
    <select id="trn-f-obra" title="Filtrar pela obra da turma"><option value="">Obra</option>${(_sstObras || []).map(o => `<option value="${esc(o.id)}">${esc(sstObraRotulo(o))}</option>`).join("")}</select>
    <select id="trn-f-equip" title="Filtrar pela máquina (TAG) da turma"><option value="">Equipamento</option>${(_sstEquipamentos || []).map(e => `<option value="${esc(e.id)}">${esc(e.codigo)}</option>`).join("")}</select>
    <select id="trn-f-modal" title="Filtrar por quem ministra"><option value="">Modalidade</option>${Object.entries(TRN_MODALIDADE).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>
    <select id="trn-f-sit" title="Filtrar pela situação calculada"><option value="">Situação</option>${Object.entries(TRN_STATUS).map(([v, o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("")}</select>
    ${sstPodeOperar() ? `<button type="button" class="btn" id="btn-trn-nova" style="margin-left:auto;" title="Turma com uma ou várias pessoas; para uma pessoa só, use também Lançar treinamento na ficha do funcionário">+ Turma</button>` : ""}
  </div><div id="trn-conteudo"><p class="vazio">Carregando…</p></div>`;
}
function trnLerFiltros(){
  return { req: $("trn-f-req")?.value || "", obra: $("trn-f-obra")?.value || "", equip: $("trn-f-equip")?.value || "",
    modal: $("trn-f-modal")?.value || "", sit: $("trn-f-sit")?.value || "", busca: ($("sst-busca")?.value || "").trim().toLowerCase() };
}
async function renderSstTreinamentos(){
  const cont = $("sst-conteudo"); if(!cont) return;
  const f0 = trnLerFiltros();
  cont.innerHTML = trnFiltrosHTML();
  ["trn-f-req", "trn-f-obra", "trn-f-equip", "trn-f-modal", "trn-f-sit"].forEach(id => { const k = { "trn-f-req": "req", "trn-f-obra": "obra", "trn-f-equip": "equip", "trn-f-modal": "modal", "trn-f-sit": "sit" }[id]; $(id).value = f0[k]; $(id).addEventListener("change", trnRenderConteudo); });
  cont.querySelectorAll("#trn-sub .serv-view-btn").forEach(b => b.addEventListener("click", () => { _trnSub = b.dataset.sub; cont.querySelectorAll("#trn-sub .serv-view-btn").forEach(x => x.classList.toggle("ativo", x === b)); trnRenderConteudo(); }));
  $("btn-trn-nova")?.addEventListener("click", () => trnNovaTurma(null));
  if(!(await trnCarregar(false))) return;
  trnRenderConteudo();
}
/* linhas pessoa × treinamento com a turma de referência (agendada ou a que gerou o documento) */
function trnLinhas(){
  const f = trnLerFiltros();
  return _trnStatus.map(s => ({ ...s, turma: trnTurmaPorId(s.turma_id), req: sstReqPorId(s.requisito_id), nome: trnFuncNome(s.funcionario_id) }))
    .filter(l => {
      if(f.req && l.requisito_id !== f.req) return false;
      if(f.sit && l.status !== f.sit) return false;
      if(f.obra && (!l.turma || l.turma.obra_id !== f.obra)) return false;
      if(f.equip && (!l.turma || l.turma.equipamento_id !== f.equip)) return false;
      if(f.modal && (!l.turma || l.turma.modalidade !== f.modal)) return false;
      if(f.busca && !`${l.nome} ${l.req ? l.req.codigo + " " + l.req.nome : ""}`.toLowerCase().includes(f.busca)) return false;
      return true;
    })
    .sort((a, b) => a.nome.localeCompare(b.nome) || String(a.req?.codigo || "").localeCompare(String(b.req?.codigo || "")));
}
function trnRenderConteudo(){
  const cont = $("trn-conteudo"); if(!cont) return;
  if(_trnSub === "turmas") return trnRenderTurmas(cont);
  const linhas = trnLinhas();
  if($("sst-contador")) $("sst-contador").textContent = `${linhas.length} pessoa(s) × treinamento`;
  if(!linhas.length){ cont.innerHTML = uiVazio("Nenhum treinamento exigido, agendado ou registrado com estes filtros. A matriz diz o que cada função exige (visão Matriz)."); return; }
  if(_trnSub === "kanban"){
    const LIM = 60;
    cont.innerHTML = `<div class="serv-kanban">${Object.keys(TRN_STATUS).map(st => {
      const itens = linhas.filter(l => l.status === st);
      const cards = itens.slice(0, LIM).map(l => `<div class="serv-kan-card linha-clicavel" data-func="${esc(l.funcionario_id)}" data-turma="${esc(l.turma_id || "")}" title="${l.turma_id ? "Abrir a turma" : "Abrir a aba Segurança do funcionário"}">
          <div class="serv-kan-card-nome">${esc(l.nome)}</div>
          <div class="serv-kan-card-meta">${esc(l.req ? l.req.codigo : "—")}${l.valido_ate ? " · até " + dataBR(l.valido_ate) : ""}</div>
          <div class="serv-kan-card-rod">${l.turma ? esc(l.turma.numero) + (l.turma.obra_id ? " · " + esc(trnObraRot(l.turma.obra_id)) : "") : (l.exigido ? "exigido pela matriz" : "—")}</div>
        </div>`).join("");
      return `<div class="serv-kan-col"><div class="serv-kan-col-head">${esc(TRN_STATUS[st].label)}<span>${itens.length}</span></div>${cards || '<div class="kan-vazio">—</div>'}${itens.length > LIM ? `<div class="kan-vazio">+ ${itens.length - LIM} na lista</div>` : ""}</div>`;
    }).join("")}</div>`;
  } else {
    cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Pessoa</th><th>Treinamento</th><th>Situação</th><th>Válido até</th><th>Turma</th><th>Obra</th><th>Equipamento</th><th>Modalidade</th><th>Matriz</th></tr></thead>
      <tbody>${linhas.map(l => `<tr class="linha-clicavel" data-func="${esc(l.funcionario_id)}" data-turma="${esc(l.turma_id || "")}">
        <td>${esc(l.nome)}</td>
        <td>${l.req ? uiCodigo(l.req.codigo) + " " + esc(l.req.nome) : "—"}</td>
        <td>${trnTag(l.status)}</td><td>${dataBR(l.valido_ate)}</td>
        <td>${l.turma ? uiCodigo(l.turma.numero) + " " + trnTagTurma(l.turma.status) : "—"}</td>
        <td>${esc(l.turma && l.turma.obra_id ? trnObraRot(l.turma.obra_id) : "—")}</td>
        <td>${esc(l.turma && l.turma.equipamento_id ? trnEquipCodigo(l.turma.equipamento_id) : "—")}</td>
        <td>${esc(l.turma ? TRN_MODALIDADE[l.turma.modalidade] || "—" : "—")}</td>
        <td>${l.exigido ? '<span class="tag verde" title="Obrigatório pela matriz">exigido</span>' : '<span class="meta">—</span>'}</td>
      </tr>`).join("")}</tbody></table></div>`;
  }
  cont.querySelectorAll("[data-func]").forEach(el => el.addEventListener("click", () => {
    if(el.dataset.turma) trnAbrirTurma(el.dataset.turma);
    else if(typeof sstAbrirFuncionarioSeguranca === "function") sstAbrirFuncionarioSeguranca(el.dataset.func);
  }));
}
function trnRenderTurmas(cont){
  const f = trnLerFiltros();
  const turmas = _trnTurmas.filter(t => {
    if(f.req && t.requisito_id !== f.req) return false;
    if(f.obra && t.obra_id !== f.obra) return false;
    if(f.equip && t.equipamento_id !== f.equip) return false;
    if(f.modal && t.modalidade !== f.modal) return false;
    if(f.busca){ const r = sstReqPorId(t.requisito_id); if(!`${t.numero} ${r ? r.codigo + " " + r.nome : ""}`.toLowerCase().includes(f.busca)) return false; }
    return true;
  }).sort((a, b) => String(trnDataTurma(b) || "9999").localeCompare(String(trnDataTurma(a) || "9999")));
  if($("sst-contador")) $("sst-contador").textContent = `${turmas.length} turma(s)`;
  if(!turmas.length){ cont.innerHTML = uiVazio("Nenhuma turma com estes filtros."); return; }
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Turma</th><th>Treinamento</th><th>Data</th><th>Situação</th><th>Pessoas</th><th>Modalidade</th><th>Empresa</th><th>Obra</th><th>Valor</th></tr></thead>
    <tbody>${turmas.map(t => { const r = sstReqPorId(t.requisito_id); return `<tr class="linha-clicavel" data-id="${esc(t.id)}">
      <td>${uiCodigo(t.numero || "—")}</td><td>${esc(r ? r.codigo + " · " + r.nome : "—")}</td>
      <td>${dataBR(t.data_inicio)}${t.data_fim && t.data_fim !== t.data_inicio ? " → " + dataBR(t.data_fim) : ""}</td>
      <td>${trnTagTurma(t.status)}</td><td>${(t.participantes || []).length}</td>
      <td>${esc(TRN_MODALIDADE[t.modalidade] || "—")}</td><td>${esc(t.fornecedor_id ? trnFornNome(t.fornecedor_id) : "—")}</td>
      <td>${esc(trnObraRot(t.obra_id))}</td><td data-val-sens>${t.valor != null ? brl(t.valor) : "—"}</td>
    </tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => trnAbrirTurma(tr.dataset.id)));
}

/* ---------- relatório Custo SST (D10): por obra e sede, mês e treinamento ---------- */
async function renderSstCustoSst(){
  const cont = $("sst-conteudo"); if(!cont) return;
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  if(!(await trnCarregar(false))) return;
  const grupos = new Map();
  _trnTurmas.filter(t => t.status !== "cancelada" && t.valor != null).forEach(t => {
    const mes = String(trnDataTurma(t) || "").slice(0, 7) || "sem data";
    const dest = t.destino === "obra" && t.obra_id ? trnObraRot(t.obra_id) : "Sede (centro SESMT)";
    const r = sstReqPorId(t.requisito_id);
    const k = `${dest}|${mes}|${t.requisito_id}`;
    const g = grupos.get(k) || { dest, mes, req: r ? `${r.codigo} · ${r.nome}` : "—", turmas: 0, pessoas: 0, valor: 0, planejado: 0 };
    g.turmas++; g.pessoas += (t.participantes || []).length; g.valor += Number(t.valor) || 0;
    if(t.status === "planejada") g.planejado += Number(t.valor) || 0;
    grupos.set(k, g);
  });
  // fase 185b: os ASO entram agregados (mês, destino, obra e tipo; sem pessoa nem exame)
  const asos = typeof asoCustoLinhas === "function" ? await asoCustoLinhas() : [];
  const linhas = [...grupos.values()].concat(asos).sort((a, b) => a.dest.localeCompare(b.dest) || b.mes.localeCompare(a.mes) || a.req.localeCompare(b.req));
  if($("sst-contador")) $("sst-contador").textContent = `${linhas.length} linha(s)`;
  const total = linhas.reduce((s, l) => s + l.valor, 0), plan = linhas.reduce((s, l) => s + l.planejado, 0);
  const mesTxt = m => /^\d{4}-\d{2}$/.test(m) ? `${m.slice(5, 7)}/${m.slice(0, 4)}` : m;
  cont.innerHTML = `<p class="texto-apoio">Custo dos treinamentos pelas turmas (valor de cada turma, não cancelada) e dos ASO (soma dos exames pelo preço da clínica, ou o valor digitado). <strong>Só relatório:</strong> não entra no custo da obra (vw_custos), porque a cobrança do instrutor, da empresa ou da clínica chega por NF em Compras e contaria duas vezes. Destino = a obra quando a turma é exigência do cliente ou o ASO é admissional por obra; senão a sede (centro SESMT).</p>
    ${linhas.length ? `<div class="tabela-rola"><table><thead><tr><th>Destino</th><th>Mês</th><th>Treinamento ou ASO</th><th>Turmas / ASO</th><th>Pessoas</th><th>Valor</th><th>Ainda planejado</th></tr></thead>
      <tbody>${linhas.map(l => `<tr><td>${esc(l.dest)}</td><td>${esc(mesTxt(l.mes))}</td><td>${esc(l.req)}</td><td>${Number(l.turmas)}</td><td>${Number(l.pessoas)}</td><td data-val-sens>${brl(l.valor)}</td><td data-val-sens>${l.planejado ? brl(l.planejado) : "—"}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="5"><strong>Total</strong></td><td data-val-sens><strong>${brl(total)}</strong></td><td data-val-sens>${plan ? brl(plan) : "—"}</td></tr></tfoot></table></div>`
      : uiVazio("Nenhuma turma nem ASO com valor ainda.")}`;
}

/* ---------- ficha da turma ---------- */
function trnMostrarFicha(){
  ["sst-painel", "sst-ficha-req", "sst-ficha-prog", "aso-ficha"].forEach(id => { if($(id)) $(id).style.display = "none"; });
  $("trn-ficha").style.display = "";
}
function trnFecharFicha(){
  $("trn-ficha").style.display = "none";
  _trnEditId = null; _trnTurma = null;
  if(typeof sstMostrarPainel === "function") sstMostrarPainel();
  _sstView = "treinamentos";
  renderSesmt();
}
function trnPreencherSelects(){
  const opts = (sel, lista, ph) => { if(sel) preencherSelect(sel, lista, "id", "t", ph); };
  opts($("trn-requisito"), trnReqs().filter(r => r.ativo || (_trnTurma && r.id === _trnTurma.requisito_id)).map(r => ({ id: r.id, t: `${r.codigo} · ${r.nome}` })), "Escolha o treinamento");
  opts($("trn-obra"), (_sstObras || []).map(o => ({ id: o.id, t: sstObraRotulo(o) })), "— nenhuma (sede)");
  opts($("trn-equip"), (_sstEquipamentos || []).map(e => ({ id: e.id, t: `${e.codigo}${e.nome ? " · " + e.nome : ""}` })), "— nenhum");
  opts($("trn-fornecedor"), _trnFornecedores.map(f => ({ id: f.id, t: f.nome })), "— nenhuma");
  const fill = (id, dic, ph) => { const s = $(id); if(s) s.innerHTML = (ph != null ? `<option value="">${esc(ph)}</option>` : "") + Object.entries(dic).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(""); };
  fill("trn-tipo", TRN_TIPO); fill("trn-motivo", TRN_MOTIVO, "—"); fill("trn-modalidade", TRN_MODALIDADE); fill("trn-destino", TRN_DESTINO);
  opts($("trn-add-func"), (_sstFuncs || []).map(f => ({ id: f.id, t: f.nome })), "Acrescentar pessoa…");
}
async function trnNovaTurma(reqId){
  if(!irParaSecao("sesmt")) return;
  await carregarSesmt(false);
  await trnCarregarFornecedores();
  _trnEditId = null; _trnTurma = null; _trnParts = []; _trnAnexos = [];
  trnPreencherSelects();
  trnPreencherForm({ status: "planejada", tipo: "formacao", modalidade: "terceira", destino: "sesmt", requisito_id: reqId || "" });
  if(reqId) trnAplicarPadrao(true);
  trnRenderFichaVisual();
}
async function trnAbrirTurma(id){
  if(!irParaSecao("sesmt")) return;
  await carregarSesmt(false);
  await trnCarregarFornecedores();
  const [t, p] = await Promise.all([
    sb.from("sst_turmas").select("*").eq("id", id).maybeSingle(),
    sb.from("sst_turma_participantes").select("*").eq("turma_id", id).order("created_at")
  ]);
  if(t.error || !t.data){ aviso("app-aviso", "Turma não encontrada" + (t.error ? ": " + t.error.message : "."), "erro"); return; }
  _trnEditId = id; _trnTurma = t.data; _trnParts = p.data || [];
  trnPreencherSelects();
  trnPreencherForm(_trnTurma);
  trnRenderFichaVisual();
  trnCarregarAnexos();
}
function trnValidadeTxt(iv){ return iv ? sstValidadeTxt(iv) : ""; }
function trnPreencherForm(t){
  const v = (id, x) => { if($(id)) $(id).value = x ?? ""; };
  v("trn-requisito", t.requisito_id); v("trn-tipo", t.tipo || "formacao"); v("trn-motivo", t.motivo);
  v("trn-inicio", t.data_inicio); v("trn-fim", t.data_fim); v("trn-carga", t.carga_horaria); v("trn-local", t.local);
  v("trn-obra", t.obra_id); v("trn-equip", t.equipamento_id); v("trn-modalidade", t.modalidade || "terceira");
  v("trn-fornecedor", t.fornecedor_id); v("trn-instrutor", t.instrutor_nome); v("trn-valor", t.valor);
  v("trn-destino", t.destino || "sesmt"); v("trn-validade", trnValidadeTxt(t.validade)); v("trn-obs", t.observacoes);
  trnPlaceholderValidade();
}
function trnPlaceholderValidade(){
  const r = sstReqPorId($("trn-requisito")?.value); const inp = $("trn-validade"); if(!inp) return;
  inp.placeholder = r && r.validade ? `vazio = pela matriz ou o catálogo (${sstValidadeTxt(r.validade)})` : "vazio = pela matriz ou o catálogo";
}
/* padrão do catálogo (D5): carga, valor, modalidade e empresa; só preenche o que está vazio, a menos que forçar */
function trnAplicarPadrao(forcar){
  const r = sstReqPorId($("trn-requisito")?.value); if(!r) return;
  const set = (id, x) => { if($(id) && (forcar || !$(id).value) && x != null) $(id).value = x; };
  set("trn-carga", r.carga_horaria); set("trn-valor", r.custo_referencia); set("trn-modalidade", r.modalidade_padrao); set("trn-fornecedor", r.fornecedor_padrao_id);
  trnPlaceholderValidade();
}
function trnRenderFichaVisual(){
  trnMostrarFicha();
  const t = _trnTurma || { status: "planejada" };
  const r = sstReqPorId($("trn-requisito").value);
  const opera = sstPodeOperar();
  const aberta = t.status === "planejada";
  $("trn-titulo").textContent = _trnEditId ? `${t.numero} · ${r ? r.nome : ""}` : "Nova turma";
  $("trn-breadcrumb").innerHTML = uiBreadcrumb([{ texto: "SESMT", id: "painel" }, { texto: "Treinamentos", id: "painel" }, { texto: _trnEditId ? t.numero : "Nova turma" }]);
  $("trn-breadcrumb").querySelectorAll("[data-trilha]").forEach(b => b.addEventListener("click", trnFecharFicha));
  const etapas = [["planejada", "Planejada"], ["realizada", "Realizada"]].concat(t.status === "cancelada" ? [["cancelada", "Cancelada"]] : []);
  $("trn-statusbar").innerHTML = uiStatusbar(etapas, t.status);
  $("trn-statusbar").querySelectorAll(".stage").forEach(s => s.addEventListener("click", () => { if(s.dataset.status === "realizada" && aberta && _trnEditId && opera) trnConcluir(); }));
  $("trn-chip-numero").textContent = t.numero || "(nova)";
  $("trn-chip-req").textContent = r ? r.codigo : "—";
  $("trn-chip-obra").textContent = trnObraRot($("trn-obra").value || null);
  $("trn-chip-equip").textContent = $("trn-equip").value ? trnEquipCodigo($("trn-equip").value) : "—";
  $("trn-chip-modal").textContent = TRN_MODALIDADE[$("trn-modalidade").value] || "—";
  $("sb-trn-parts").querySelector(".sb-num").textContent = String(_trnParts.length);
  $("sb-trn-anexos").querySelector(".sb-num").textContent = String(_trnAnexos.length);
  $("btn-trn-salvar").style.display = opera && aberta ? "" : "none";
  $("btn-trn-concluir").style.display = opera && aberta && _trnEditId ? "" : "none";
  $("btn-trn-cancelar").style.display = opera && aberta && _trnEditId ? "" : "none";
  $("trn-ficha-mais").style.display = opera && aberta && _trnEditId ? "" : "none";
  document.querySelectorAll("#trn-ficha .odoo-tab[data-tab='dados'] input, #trn-ficha .odoo-tab[data-tab='dados'] select, #trn-ficha .odoo-tab[data-tab='dados'] textarea")
    .forEach(el => { el.disabled = !(opera && aberta); });
  sstAtivarTab("trn-ficha", "trn-notebook", _trnEditId ? "participantes" : "dados");
  trnRenderParticipantes();
  trnRenderAnexos();
}
function trnLerForm(){
  const num = id => { const x = $(id).value; return x === "" ? null : Number(x); };
  const val = $("trn-validade").value.trim();
  let validade = null;
  if(val){ validade = sstValidadeParaBanco(val); if(validade === undefined || validade === null){ return { erro: "Validade não entendida: use, por exemplo, 24 meses ou 2 anos." }; } }
  const obra = $("trn-obra").value || null;
  return {
    requisito_id: $("trn-requisito").value || null, tipo: $("trn-tipo").value, motivo: $("trn-motivo").value || null,
    data_inicio: $("trn-inicio").value || null, data_fim: $("trn-fim").value || $("trn-inicio").value || null,
    carga_horaria: num("trn-carga"), local: $("trn-local").value.trim() || null, obra_id: obra, equipamento_id: $("trn-equip").value || null,
    cliente_id: obra ? ((_sstObras || []).find(o => o.id === obra)?.cliente_id || null) : null,
    modalidade: $("trn-modalidade").value, fornecedor_id: $("trn-fornecedor").value || null, instrutor_nome: $("trn-instrutor").value.trim() || null,
    valor: num("trn-valor"), destino: $("trn-destino").value, validade, observacoes: $("trn-obs").value.trim() || null
  };
}
async function salvarTrnTurma(){
  const reg = trnLerForm();
  if(reg.erro){ aviso("app-aviso", reg.erro, "erro"); return; }
  if(!reg.requisito_id){ aviso("app-aviso", "Escolha o treinamento.", "erro"); return; }
  if(reg.destino === "obra" && !reg.obra_id){ aviso("app-aviso", "Destino do custo = obra pede a obra.", "erro"); return; }
  const q = _trnEditId ? sb.from("sst_turmas").update(reg).eq("id", _trnEditId).select().single() : sb.from("sst_turmas").insert(reg).select().single();
  const { data, error } = await q;
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não grava turma do SESMT."), "erro"); return; }
  aviso("app-aviso", _trnEditId ? "Turma salva." : `Turma ${data.numero} criada. Acrescente os participantes.`, "ok");
  _trnCarregado = false;
  await trnAbrirTurma(data.id);
}
async function trnConcluir(){
  if(!_trnEditId) return;
  const presentes = _trnParts.filter(p => p.presente && p.aprovado);
  const semCert = presentes.filter(p => !p.certificado_path).length;
  const msg = `Concluir a turma ${_trnTurma.numero}? ${presentes.length} participante(s) presente(s) e aprovado(s) recebem o documento do treinamento` +
    (semCert ? ` (${semCert} sem certificado anexado).` : ".") + " Depois de concluída a turma não volta.";
  if(!presentes.length && !confirm("Nenhum participante presente e aprovado: concluir mesmo assim, sem gerar documento?")) return;
  if(presentes.length && !confirm(msg)) return;
  const { data, error } = await sb.rpc("sst_turma_concluir", { p_turma: _trnEditId });
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não conclui turma do SESMT."), "erro"); return; }
  aviso("app-aviso", `Turma concluída: ${Number(data) || 0} documento(s) gerado(s).`, "ok");
  _trnCarregado = false; _sstSituacao = null;
  await trnAbrirTurma(_trnEditId);
}
async function trnCancelar(){
  if(!_trnEditId || !confirm(`Cancelar a turma ${_trnTurma.numero}? Ninguém recebe documento.`)) return;
  const { error } = await sb.from("sst_turmas").update({ status: "cancelada" }).eq("id", _trnEditId);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não cancela turma do SESMT."), "erro"); return; }
  aviso("app-aviso", "Turma cancelada.", "ok");
  _trnCarregado = false;
  await trnAbrirTurma(_trnEditId);
}

/* ---------- participantes ---------- */
function trnRenderParticipantes(){
  const cont = $("trn-parts"); if(!cont) return;
  const opera = sstPodeOperar() && _trnTurma && _trnTurma.status === "planejada";
  $("trn-add-linha").style.display = opera ? "" : "none";
  if(!_trnEditId){ cont.innerHTML = uiVazio("Salve a turma para acrescentar participantes."); return; }
  if(!_trnParts.length){ cont.innerHTML = uiVazio("Nenhum participante ainda."); return; }
  const r = sstReqPorId(_trnTurma.requisito_id);
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Pessoa</th><th title="Esteve na turma">Presente</th>${r && r.exige_prova ? `<th title="Nota mínima ${esc(String(r.nota_minima ?? 0))}">Nota</th>` : ""}<th title="Só quem está presente e aprovado recebe o documento">Aprovado</th><th>Nº do certificado</th><th>Certificado</th><th>Documento</th>${opera ? "<th></th>" : ""}</tr></thead>
    <tbody>${_trnParts.map((p, i) => `<tr data-i="${i}">
      <td>${uiAvatar(trnFuncNome(p.funcionario_id))} ${esc(trnFuncNome(p.funcionario_id))}</td>
      <td><input type="checkbox" class="trn-p-presente" ${p.presente ? "checked" : ""} ${opera ? "" : "disabled"} title="Presente na turma" /></td>
      ${r && r.exige_prova ? `<td><input type="number" class="trn-p-nota" min="0" max="100" step="1" value="${esc(p.nota ?? "")}" ${opera ? "" : "disabled"} style="width:5em;" title="Nota da avaliação (0 a 100)" /></td>` : ""}
      <td><input type="checkbox" class="trn-p-aprovado" ${p.aprovado ? "checked" : ""} ${opera ? "" : "disabled"} title="Aprovado" /></td>
      <td><input class="trn-p-numero" value="${esc(p.certificado_numero || "")}" ${opera ? "" : "disabled"} placeholder="nº no certificado" title="Número que está no certificado anexado" /></td>
      <td>${p.certificado_path ? `<a href="#" class="trn-p-abrir" title="Abrir o certificado anexado">Abrir</a>` : '<span class="meta">—</span>'}
        ${opera ? `<label class="btn-sec btn-sm" title="Anexar o certificado (PDF, JPG ou PNG, até 20 MB)">Anexar<input type="file" class="trn-p-arquivo" accept="application/pdf,image/jpeg,image/png" style="display:none;" /></label>` : ""}</td>
      <td>${p.documento_id ? '<span class="tag verde" title="Documento gerado na aba Segurança do funcionário">gerado</span>' : '<span class="meta">—</span>'}</td>
      ${opera ? `<td class="col-acao"><button type="button" class="btn-sec btn-sm trn-p-del" title="Tirar da turma">Tirar</button></td>` : ""}
    </tr>`).join("")}</tbody></table></div>`;
  const parte = el => _trnParts[Number(el.closest("tr").dataset.i)];
  cont.querySelectorAll(".trn-p-presente").forEach(el => el.addEventListener("change", () => trnAtualizarPart(parte(el), { presente: el.checked, ...(el.checked ? {} : { aprovado: false }) })));
  cont.querySelectorAll(".trn-p-aprovado").forEach(el => el.addEventListener("change", () => trnAtualizarPart(parte(el), { aprovado: el.checked })));
  cont.querySelectorAll(".trn-p-nota").forEach(el => el.addEventListener("change", () => {
    const n = el.value === "" ? null : Number(el.value);
    const min = Number(r?.nota_minima ?? 0);
    trnAtualizarPart(parte(el), { nota: n, aprovado: n != null && n >= min });
  }));
  cont.querySelectorAll(".trn-p-numero").forEach(el => el.addEventListener("change", () => trnAtualizarPart(parte(el), { certificado_numero: el.value.trim() || null })));
  cont.querySelectorAll(".trn-p-abrir").forEach(a => a.addEventListener("click", async e => { e.preventDefault(); await sstAbrirArquivo("sst-documentos", parte(a).certificado_path); }));
  cont.querySelectorAll(".trn-p-arquivo").forEach(inp => inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; inp.value = ""; if(f) trnAnexarCertificado(parte(inp), f); }));
  cont.querySelectorAll(".trn-p-del").forEach(b => b.addEventListener("click", () => trnTirarPart(parte(b))));
}
async function trnAtualizarPart(p, campos){
  if(!p) return;
  const { error } = await sb.from("sst_turma_participantes").update(campos).eq("id", p.id);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não altera participante."), "erro"); }
  else Object.assign(p, campos);
  trnRenderParticipantes();
}
async function trnAcrescentarPart(){
  const fid = $("trn-add-func").value; if(!fid || !_trnEditId) return;
  if(_trnParts.some(p => p.funcionario_id === fid)){ aviso("app-aviso", "Essa pessoa já está na turma.", "erro"); return; }
  const { data, error } = await sb.from("sst_turma_participantes").insert({ turma_id: _trnEditId, funcionario_id: fid }).select().single();
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não acrescenta participante."), "erro"); return; }
  _trnParts.push(data); $("trn-add-func").value = ""; _trnCarregado = false;
  trnRenderFichaVisual(); sstAtivarTab("trn-ficha", "trn-notebook", "participantes");
}
async function trnTirarPart(p){
  if(!p || !confirm(`Tirar ${trnFuncNome(p.funcionario_id)} da turma?`)) return;
  const { error } = await sb.from("sst_turma_participantes").delete().eq("id", p.id);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não tira participante."), "erro"); return; }
  if(p.certificado_path) await sb.storage.from("sst-documentos").remove([p.certificado_path]);
  _trnParts = _trnParts.filter(x => x.id !== p.id); _trnCarregado = false;
  trnRenderFichaVisual(); sstAtivarTab("trn-ficha", "trn-notebook", "participantes");
}
async function trnAnexarCertificado(p, file){
  if(file.size > 20971520){ aviso("app-aviso", "Arquivo maior que 20 MB.", "erro"); return; }
  const r = sstReqPorId(_trnTurma.requisito_id);
  const ext = extensaoArquivo(file); const mime = mimeDoArquivo(file, ext);
  const path = `${p.funcionario_id}/${r ? r.codigo : "TREINAMENTO"}/${crypto.randomUUID()}.${ext}`;
  const { error: eUp } = await sb.storage.from("sst-documentos").upload(path, corpoComMime(file, mime), { contentType: mime, upsert: false });
  if(eUp){ aviso("app-aviso", sstErroMsg(eUp, "Seu perfil não anexa certificado."), "erro"); return; }
  const antigo = p.certificado_path;
  const { error } = await sb.from("sst_turma_participantes").update({ certificado_path: path }).eq("id", p.id);
  if(error){ await sb.storage.from("sst-documentos").remove([path]); aviso("app-aviso", sstErroMsg(error, "Seu perfil não anexa certificado."), "erro"); return; }
  if(antigo) await sb.storage.from("sst-documentos").remove([antigo]);
  p.certificado_path = path;
  aviso("app-aviso", "Certificado anexado.", "ok");
  trnRenderParticipantes();
}

/* ---------- anexos da turma (lista de presença, conteúdo, NF da empresa...) ---------- */
async function trnCarregarAnexos(){
  if(!_trnEditId){ _trnAnexos = []; trnRenderAnexos(); return; }
  const { data, error } = await sb.storage.from("sst-documentos").list(`${_trnEditId}/anexos`, { limit: 200, sortBy: { column: "name", order: "asc" } });
  _trnAnexos = error ? [] : (data || []).filter(f => f.id);
  $("sb-trn-anexos").querySelector(".sb-num").textContent = String(_trnAnexos.length);
  trnRenderAnexos();
}
function trnRenderAnexos(){
  const cont = $("trn-anexos"); if(!cont) return;
  const opera = sstPodeOperar() && !!_trnEditId && _trnTurma && _trnTurma.status !== "cancelada";
  $("trn-anexo-linha").style.display = opera ? "" : "none";
  if(!_trnEditId){ cont.innerHTML = uiVazio("Salve a turma para anexar arquivos."); return; }
  cont.innerHTML = _trnAnexos.length ? `<div class="tabela-rola"><table><thead><tr><th>Arquivo</th><th>Enviado em</th>${opera ? "<th></th>" : ""}</tr></thead>
    <tbody>${_trnAnexos.map((a, i) => `<tr data-i="${i}"><td><a href="#" class="trn-a-abrir">${esc(a.name.replace(/^[0-9a-f-]{36}_/, ""))}</a></td><td>${dataBR(String(a.created_at || "").slice(0, 10))}</td>
      ${opera ? `<td class="col-acao"><button type="button" class="btn-sec btn-sm trn-a-del">Excluir</button></td>` : ""}</tr>`).join("")}</tbody></table></div>`
    : uiVazio("Nenhum anexo (lista de presença, conteúdo, proposta da empresa…).");
  const item = el => _trnAnexos[Number(el.closest("tr").dataset.i)];
  cont.querySelectorAll(".trn-a-abrir").forEach(a => a.addEventListener("click", async e => { e.preventDefault(); await sstAbrirArquivo("sst-documentos", `${_trnEditId}/anexos/${item(a).name}`); }));
  cont.querySelectorAll(".trn-a-del").forEach(b => b.addEventListener("click", async () => {
    const a = item(b); if(!a || !confirm("Excluir este anexo?")) return;
    const { error } = await sb.storage.from("sst-documentos").remove([`${_trnEditId}/anexos/${a.name}`]);
    if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não exclui anexo."), "erro"); return; }
    await trnCarregarAnexos();
  }));
}
async function trnEnviarAnexo(file){
  if(!_trnEditId || !file) return;
  if(file.size > 20971520){ aviso("app-aviso", "Arquivo maior que 20 MB.", "erro"); return; }
  const ext = extensaoArquivo(file); const mime = mimeDoArquivo(file, ext);
  const nome = String(file.name || `anexo.${ext}`).replace(/[^\w.\- ]+/g, "_").slice(-80);
  const { error } = await sb.storage.from("sst-documentos").upload(`${_trnEditId}/anexos/${crypto.randomUUID()}_${nome}`, corpoComMime(file, mime), { contentType: mime, upsert: false });
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não anexa arquivo."), "erro"); return; }
  aviso("app-aviso", "Anexo enviado.", "ok");
  await trnCarregarAnexos();
}

/* ---------- aba Segurança do funcionário: Lançar treinamento + lista com status ---------- */
async function trnFichaFuncCarregar(fid){
  const cont = $("func-trn-bloco"); if(!cont || !fid) return;
  if(!podeVerSesmt()){ cont.innerHTML = ""; return; }
  const [st, tu] = await Promise.all([
    sb.rpc("sst_treinamentos", { p_funcionarios: [fid], p_data: hojeISO() }),
    sb.from("sst_turma_participantes").select("turma:sst_turmas(id,numero,requisito_id,status,data_inicio,data_fim,obra_id)").eq("funcionario_id", fid)
  ]);
  if(typeof funcEditId !== "undefined" && fid !== funcEditId) return;
  const status = st.data || [];
  const turmas = (tu.data || []).map(x => x.turma).filter(Boolean);
  const opera = sstPodeOperar();
  const linhas = status.map(s => ({ ...s, req: sstReqPorId(s.requisito_id), turma: turmas.find(t => t.id === s.turma_id) }))
    .sort((a, b) => String(a.req?.codigo || "").localeCompare(String(b.req?.codigo || "")));
  const outras = turmas.filter(t => t.status !== "planejada" && !linhas.some(l => l.turma_id === t.id));
  const corpo = (linhas.length ? `<div class="tabela-rola"><table><thead><tr><th>Treinamento</th><th>Situação</th><th>Válido até</th><th>Turma</th><th>Matriz</th></tr></thead>
      <tbody>${linhas.map(l => `<tr${l.turma_id ? ` class="linha-clicavel" data-turma="${esc(l.turma_id)}" title="Abrir a turma"` : ""}>
        <td>${l.req ? uiCodigo(l.req.codigo) + " " + esc(l.req.nome) : "—"}</td><td>${trnTag(l.status)}</td><td>${dataBR(l.valido_ate)}</td>
        <td>${l.turma ? uiCodigo(l.turma.numero) + " " + dataBR(trnDataTurma(l.turma)) : "—"}</td>
        <td>${l.exigido ? '<span class="tag verde">exigido</span>' : '<span class="meta">—</span>'}</td></tr>`).join("")}</tbody></table></div>`
    : uiVazio("Nenhum treinamento exigido pela matriz nem registrado para esta pessoa."))
    + (outras.length ? `<p class="meta" style="margin-top:var(--esp-2);">Outras turmas: ${outras.map(t => `<a href="#" class="trn-ff-turma" data-turma="${esc(t.id)}">${esc(t.numero)}</a> ${trnTagTurma(t.status)}`).join(" · ")}</p>` : "");
  cont.innerHTML = uiSecao("documento", "Treinamentos", `
    ${opera ? `<div class="form-acoes" style="margin:0 0 var(--esp-2);"><button type="button" class="btn-sec" id="btn-trn-lancar" title="Cria uma turma desta pessoa com carga, valor, modalidade e empresa do cadastro do treinamento; tudo editável">Lançar treinamento</button></div>
    <div id="trn-lancar-form" class="func-doc-inline-form" style="display:none;">
      <div class="grade">
        <div class="campo largo"><label>Treinamento *</label><select id="trn-l-req" title="Só requisitos de natureza treinamento do catálogo"><option value="">Escolha…</option>${trnReqs().filter(r => r.ativo).map(r => `<option value="${esc(r.id)}">${esc(r.codigo)} · ${esc(r.nome)}</option>`).join("")}</select></div>
        <div class="campo"><label>Início</label><input id="trn-l-inicio" type="date" title="Data da turma; futura = agendado" /></div>
        <div class="campo"><label>Fim</label><input id="trn-l-fim" type="date" title="Vazio = mesmo dia do início" /></div>
        <div class="campo"><label>Carga horária (h)</label><input id="trn-l-carga" type="number" step="0.5" min="0" /></div>
        <div class="campo"><label>Valor (R$)</label><input id="trn-l-valor" type="number" step="0.01" min="0" title="Só para o relatório Custo SST; não entra no custo da obra" /></div>
        <div class="campo"><label>Modalidade</label><select id="trn-l-modal">${Object.entries(TRN_MODALIDADE).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></div>
        <div class="campo"><label>Empresa</label><select id="trn-l-forn" title="Fornecedor que ministra (modalidade terceira)"><option value="">— nenhuma</option>${_trnFornecedores.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("")}</select></div>
        <div class="campo"><label>Validade</label><input id="trn-l-validade" title="Preenchida pelo cadastro; mude só se esta turma tiver validade própria" placeholder="ex.: 24 meses" /></div>
        <div class="campo"><label>Obra</label><select id="trn-l-obra" title="Obra que pediu o treinamento (exigência do cliente leva o custo para a obra)"><option value="">— nenhuma (sede)</option>${(_sstObras || []).map(o => `<option value="${esc(o.id)}">${esc(sstObraRotulo(o))}</option>`).join("")}</select></div>
        <div class="campo"><label>Motivo</label><select id="trn-l-motivo"><option value="">—</option>${Object.entries(TRN_MOTIVO).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></div>
      </div>
      <div class="form-acoes"><button type="button" class="btn" id="btn-trn-l-salvar" title="Cria a turma de 1 pessoa; anexe o certificado e conclua na ficha da turma">Lançar</button><button type="button" class="btn-sec" id="btn-trn-l-cancelar">Cancelar</button></div>
    </div>` : ""}
    ${/* html */ corpo}`, `${linhas.length}`);
  cont.querySelectorAll("tr[data-turma], .trn-ff-turma").forEach(el => el.addEventListener("click", e => { e.preventDefault(); trnAbrirTurma(el.dataset.turma); }));
  if(!opera) return;
  let validadeCadastro = "";
  $("btn-trn-lancar").addEventListener("click", async () => {
    await trnCarregarFornecedores();
    const sel = $("trn-l-forn"); if(sel && sel.options.length <= 1) sel.innerHTML = `<option value="">— nenhuma</option>` + _trnFornecedores.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
    $("trn-lancar-form").style.display = "";
  });
  $("btn-trn-l-cancelar").addEventListener("click", () => { $("trn-lancar-form").style.display = "none"; });
  $("trn-l-req").addEventListener("change", () => {
    const r = sstReqPorId($("trn-l-req").value); if(!r) return;
    $("trn-l-carga").value = r.carga_horaria ?? ""; $("trn-l-valor").value = r.custo_referencia ?? "";
    $("trn-l-modal").value = r.modalidade_padrao || "terceira"; $("trn-l-forn").value = r.fornecedor_padrao_id || "";
    validadeCadastro = r.validade ? sstValidadeTxt(r.validade) : ""; $("trn-l-validade").value = validadeCadastro;
  });
  $("btn-trn-l-salvar").addEventListener("click", e => comBotaoTravado(e.currentTarget, async () => {
    const req = $("trn-l-req").value; if(!req){ aviso("app-aviso", "Escolha o treinamento.", "erro"); return; }
    const dados = {
      data_inicio: $("trn-l-inicio").value || "", data_fim: $("trn-l-fim").value || "", carga_horaria: $("trn-l-carga").value,
      valor: $("trn-l-valor").value, modalidade: $("trn-l-modal").value, fornecedor_id: $("trn-l-forn").value,
      obra_id: $("trn-l-obra").value, motivo: $("trn-l-motivo").value
    };
    // validade: só vai quando a pessoa mudou o que veio do cadastro (vazio = matriz ou catálogo na conclusão)
    const vTxt = $("trn-l-validade").value.trim();
    if(vTxt && vTxt !== validadeCadastro){
      const iv = sstValidadeParaBanco(vTxt);
      if(!iv){ aviso("app-aviso", "Validade não entendida: use, por exemplo, 24 meses ou 2 anos.", "erro"); return; }
      dados.validade = iv;
    }
    const { data, error } = await sb.rpc("sst_treinamento_lancar", { p_funcionario: fid, p_requisito: req, p_dados: dados });
    if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não lança treinamento."), "erro"); return; }
    aviso("app-aviso", "Treinamento lançado: anexe o certificado e conclua na ficha da turma.", "ok");
    _trnCarregado = false; _sstSituacao = null;
    await trnAbrirTurma(data);
  }));
}

/* ---------- ligação ---------- */
function ligarSesmtTreinamentos(){
  if(!$("trn-ficha")) return;
  $("btn-trn-voltar")?.addEventListener("click", trnFecharFicha);
  $("btn-trn-salvar")?.addEventListener("click", e => comBotaoTravado(e.currentTarget, salvarTrnTurma));
  $("btn-trn-concluir")?.addEventListener("click", e => comBotaoTravado(e.currentTarget, trnConcluir));
  $("btn-trn-cancelar")?.addEventListener("click", trnCancelar);
  $("btn-trn-add")?.addEventListener("click", e => comBotaoTravado(e.currentTarget, trnAcrescentarPart));
  $("trn-anexo-arquivo")?.addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if(f) trnEnviarAnexo(f); });
  $("trn-requisito")?.addEventListener("change", () => { trnAplicarPadrao(true); if($("trn-chip-req")) $("trn-chip-req").textContent = sstReqPorId($("trn-requisito").value)?.codigo || "—"; });
  $("trn-obra")?.addEventListener("change", () => { $("trn-chip-obra").textContent = trnObraRot($("trn-obra").value || null); });
  $("trn-equip")?.addEventListener("change", () => { $("trn-chip-equip").textContent = $("trn-equip").value ? trnEquipCodigo($("trn-equip").value) : "—"; });
  $("trn-modalidade")?.addEventListener("change", () => { $("trn-chip-modal").textContent = TRN_MODALIDADE[$("trn-modalidade").value] || "—"; });
  document.querySelectorAll("#trn-notebook button").forEach(b => b.addEventListener("click", () => sstAtivarTab("trn-ficha", "trn-notebook", b.dataset.tab)));
  document.querySelectorAll("#trn-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => sstAtivarTab("trn-ficha", "trn-notebook", b.dataset.gotoTab)));
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarSesmtTreinamentos);
else ligarSesmtTreinamentos();

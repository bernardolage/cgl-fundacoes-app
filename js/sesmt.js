/* ====================================================================
   SESMT — fase 109a (27/10/2026): catálogo de requisitos, matriz de exigência, GHE, programas legais e a aba
   Segurança da ficha do funcionário. Spec: docs/specs/fase-109-sesmt.md (decisões D1–D21 de 27/10/2026).
   Prefixo sst-. Quem vê o módulo: podeVerSesmt() (SESMT por cargo ou módulo extra, rh, admin/diretor, auditor);
   quem grava: sstPodeOperar() (cargo sesmt, admin/diretor, módulo extra sesmt; nunca auditor) — espelhos de
   sst_pode_ler()/sst_pode_operar() do banco (core.js). Documento sensível (ASO, exame) só em sessão com MFA
   (sst_pode_ler_saude no banco): o front só evita a tentativa; a RLS é quem recusa.
   Padrão Serviços/Odoo (.claude/skills/padrao-modulo-obra-completo): painel com .lista-topo + .serv-views +
   .serv-filtros + #sst-conteudo; fichas (requisito, programa) com header de ações, chips e notebook.
   ==================================================================== */

let _sstView = "vencimentos";
let _sstCarregado = false;
let _sstReqs = [];          // sst_requisitos
let _sstGhes = [];          // sst_ghe
let _sstGheFuncoes = [];    // sst_ghe_funcoes
let _sstMatriz = [];        // sst_matriz
let _sstProgramas = [];     // sst_programas (+ obra, requisito)
let _sstFuncs = [];         // funcionários ativos (id, nome, funcao, departamento_id)
let _sstDeptos = [];
let _sstObras = [];         // obras planejadas/em andamento (id, codigo, nome, cliente_id, status)
let _sstClientes = [];
let _sstEquipamentos = [];
let _sstSituacao = null;    // último retorno de sst_situacao
let _sstSituacaoChave = ""; // ids + obra do último cálculo (evita recalcular a cada filtro)
let _sstMatrizAlvo = "funcao";
let _sstMatrizImport = null;  // resumo da planilha conferida à espera do "Aplicar"
let sstReqEditId = null;
let sstProgEditId = null;
let _sstProgObraPre = null;   // obra pré-selecionada ao abrir "+ Programa legal" pela ficha da obra
let _sstFichaFuncDocs = [];

const SST_NATUREZA = { treinamento: "Treinamento", exame: "Exame", documento: "Documento", programa: "Programa" };
const SST_GRUPO = { pessoal: "Pessoal", saude: "Saúde", nr: "NR", cliente: "Cliente", termo: "Termo", autorizacao: "Autorização",
  ordem_servico: "Ordem de serviço", epi: "EPI", programa_legal: "Programa legal", empresa: "Empresa" };
const SST_EMISSOR = { interno: "Interno (CGL)", externo: "Externo", cliente: "Cliente" };
const SST_STATUS = {
  ok:         { label: "ok",           cor: "verde" },
  vence_30:   { label: "vence em 30 d", cor: "ambar" },
  vence_7:    { label: "vence em 7 d",  cor: "ambar" },
  vencido:    { label: "vencido",      cor: "vermelho" },
  falta:      { label: "falta",        cor: "vermelho" },
  nao_aplica: { label: "não se aplica", cor: "cinza" }
};
const SST_ALVO = { funcao: "Função", ghe: "GHE", metodo: "Método", equipamento: "Equipamento (TAG)", cliente: "Cliente", obra: "Obra" };
const SST_METODO = { helice_continua: "Hélice contínua", secante: "Hélice secante", raiz: "Estaca raiz", escavada: "Escavada / trado",
  pre_moldada: "Pré-moldada", strauss: "Strauss", metalica: "Metálica", franki: "Franki", hsa: "HSA", barrete: "Barrete", outro: "Outro" };
const SST_ORIGEM_DOC = { manual: "manual", carga: "carga", turma: "turma", aso: "ASO", gerado: "gerado pelo app" };
const SST_PENDENTES = ["vence_30", "vence_7", "vencido", "falta"];

/* ---------- utilidades ---------- */
function sstTagStatus(st){
  const o = SST_STATUS[st] || { label: st || "—", cor: "cinza" };
  return `<span class="tag ${esc(o.cor)}">${esc(o.label)}</span>`;
}
function sstValidadeTxt(iv){
  if(!iv) return "—";
  const s = String(iv);
  let m = s.match(/^(\d+)\s*mon/); if(m) return `${m[1]} meses`;
  m = s.match(/^(\d+)\s*year/);    if(m) return `${Number(m[1]) * 12} meses`;
  m = s.match(/^(\d+)\s*day/);     if(m) return `${m[1]} dias`;
  m = s.match(/^(\d+):00:00$/);    if(m) return `${m[1]} h`;
  return s;
}
/* "24 meses" / "912 dias" / "24" → interval em texto para o banco; vazio → null */
function sstValidadeParaBanco(txt){
  const t = String(txt || "").trim().toLowerCase();
  if(!t) return null;
  const m = t.match(/^(\d+)\s*(m|mes|meses|d|dia|dias|a|ano|anos)?$/);
  if(!m) return undefined;
  const n = Number(m[1]); const u = m[2] || "m";
  if(u.startsWith("d")) return `${n} days`;
  if(u.startsWith("a")) return `${n * 12} months`;
  return `${n} months`;
}
function sstFuncaoChave(f){
  // espelho aproximado de fn_funcao_chave(): a chave que vale é a do banco; aqui só para casar funções da tela
  return String(f || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/treinee/g, "trainee").replace(/equipamentos/g, "equipamento").replace(/maquinas/g, "maquina")
    .replace(/ de /g, " ").replace(/  /g, " ").replace(/[^a-z0-9 ]+/g, "").trim() || null;
}
/* a chave que vale é a do banco (fn_funcao_chave, exposta pela 109a); o espelho JS só entra se a RPC falhar */
async function sstChaveBanco(funcao){
  try { const { data, error } = await sb.rpc("fn_funcao_chave", { p: funcao }); if(!error && data) return data; } catch(_){}
  return sstFuncaoChave(funcao);
}
function sstDeptoNome(id){ const d = _sstDeptos.find(x => x.id === id); return d ? d.nome : "—"; }
function sstObraRotulo(o){ return o ? `${o.codigo}${o.nome ? " · " + o.nome : ""}` : "—"; }
function sstReqPorId(id){ return _sstReqs.find(r => r.id === id); }
function sstHojeMais(dias){ const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dias); return dataLocalISO(d); }
function sstDiasAte(iso){
  if(!iso) return null;
  const v = new Date(String(iso).slice(0, 10) + "T00:00:00"); const h = new Date(); h.setHours(0, 0, 0, 0);
  return Math.round((v - h) / 86400000);
}
async function sstSessaoAal2(){
  try { const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); return !!data && data.currentLevel === "aal2"; }
  catch(_){ return false; }
}
function sstPodeGravarDoc(){   // func_docs_write: sst_pode_operar() ou rh
  if(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()) return false;
  return sstPodeOperar() || (!!usuarioAtual && usuarioAtual.cargo === "rh");
}
function sstErroMsg(err, padrao){
  return (typeof ehErroDePermissao === "function" && ehErroDePermissao(err)) ? padrao : "Erro: " + (err?.message || err);
}

/* ---------- carga ---------- */
async function carregarSesmt(forcar){
  if(!$("sst-painel")) return;
  if(!podeVerSesmt()){ $("sst-conteudo").innerHTML = `<p class="vazio">Seu perfil não tem acesso ao SESMT.</p>`; return; }
  if(_sstCarregado && !forcar){ renderSesmt(); return; }
  $("sst-conteudo").innerHTML = `<p class="vazio">Carregando…</p>`;
  const [reqs, ghes, gfs, mat, progs, funcs, deps, obras, clis, eqps] = await Promise.all([
    sb.from("sst_requisitos").select("*").order("ordem").order("codigo"),
    sb.from("sst_ghe").select("*").order("codigo"),
    sb.from("sst_ghe_funcoes").select("*").order("funcao_nome"),
    sb.from("sst_matriz").select("*").eq("ativo", true),
    sb.from("sst_programas").select("*, obra:obras(id,codigo,nome,status), requisito:sst_requisitos(id,codigo,nome)").eq("ativo", true).order("vigencia_fim", { ascending: true, nullsFirst: false }),
    sb.from("funcionarios").select("id,nome,funcao,departamento_id").eq("ativo", true).order("nome"),
    sb.from("departamentos").select("id,nome").order("nome"),
    sb.from("obras").select("id,codigo,nome,cliente_id,status").in("status", ["planejada", "em_andamento", "paralisada"]).order("codigo"),
    sb.from("clientes").select("id,nome").order("nome"),
    sb.from("equipamentos").select("id,codigo,nome,tipo").eq("ativo", true).in("tipo", ["perfuratriz", "bate_estaca", "guindaste", "caminhao", "escavadeira", "retroescavadeira", "bomba", "compressor", "gerador"]).order("codigo")
  ]);
  const erro = [reqs, ghes, gfs, mat, progs, funcs, deps, obras].find(r => r.error);
  if(erro){ $("sst-conteudo").innerHTML = `<p class="vazio">Erro ao carregar: ${esc(erro.error.message)}</p>`; return; }
  _sstReqs = reqs.data || []; _sstGhes = ghes.data || []; _sstGheFuncoes = gfs.data || []; _sstMatriz = mat.data || [];
  _sstProgramas = progs.data || []; _sstFuncs = funcs.data || []; _sstDeptos = deps.data || []; _sstObras = obras.data || [];
  _sstClientes = clis.data || []; _sstEquipamentos = eqps.data || [];
  _sstSituacao = null; _sstSituacaoChave = "";
  _sstCarregado = true;
  preencherFiltrosSesmt();
  sstAplicarPermissoes();
  renderSesmt();
}

function preencherFiltrosSesmt(){
  const fDep = $("sst-f-depto"), fFun = $("sst-f-funcao"), fGhe = $("sst-f-ghe"), fObra = $("sst-f-obra");
  const vDep = fDep.value, vFun = fFun.value, vGhe = fGhe.value, vObra = fObra.value;
  preencherSelect(fDep, _sstDeptos, "id", "nome", "Departamento"); fDep.value = vDep;
  const funcoes = [...new Set(_sstFuncs.map(f => f.funcao).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(f => ({ v: f, t: f }));
  preencherSelect(fFun, funcoes, "v", "t", "Função"); fFun.value = vFun;
  preencherSelect(fGhe, _sstGhes.map(g => ({ id: g.id, t: `${g.codigo} · ${g.nome}` })), "id", "t", "GHE"); fGhe.value = vGhe;
  preencherSelect(fObra, _sstObras.map(o => ({ id: o.id, t: sstObraRotulo(o) })), "id", "t", "Obra (situação na obra)"); fObra.value = vObra;
}

function sstAplicarPermissoes(){
  const opera = sstPodeOperar();
  ["btn-sst-novo-req", "btn-sst-novo-prog", "btn-sst-importar"].forEach(id => { const b = $(id); if(b) b.style.display = opera ? "" : "none"; });
}

function sstFiltros(){
  return {
    busca: ($("sst-busca")?.value || "").trim().toLowerCase(),
    depto: $("sst-f-depto")?.value || "", funcao: $("sst-f-funcao")?.value || "", ghe: $("sst-f-ghe")?.value || "",
    obra: $("sst-f-obra")?.value || "", natureza: $("sst-f-natureza")?.value || "", status: $("sst-f-status")?.value || "pendente"
  };
}

/* funcionários que passam nos filtros de pessoa (departamento, função, GHE, busca por nome) */
function sstFuncsFiltrados(f){
  const chavesGhe = f.ghe ? new Set(_sstGheFuncoes.filter(g => g.ghe_id === f.ghe).map(g => g.funcao_chave)) : null;
  return _sstFuncs.filter(p => {
    if(f.depto && p.departamento_id !== f.depto) return false;
    if(f.funcao && p.funcao !== f.funcao) return false;
    if(chavesGhe && !chavesGhe.has(sstFuncaoChave(p.funcao))) return false;
    return true;
  });
}

function renderSesmt(){
  const cont = $("sst-conteudo"); if(!cont) return;
  document.querySelectorAll("#sst-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _sstView));
  // filtros que só valem em algumas visões
  const soPessoas = ["vencimentos", "pessoas"].includes(_sstView);
  ["sst-f-depto", "sst-f-funcao", "sst-f-ghe"].forEach(id => { $(id).style.display = soPessoas || _sstView === "matriz" ? "" : "none"; });
  $("sst-f-obra").style.display = soPessoas || _sstView === "programas" ? "" : "none";
  $("sst-f-status").style.display = _sstView === "vencimentos" ? "" : "none";
  $("sst-f-natureza").style.display = ["vencimentos", "matriz", "catalogo"].includes(_sstView) ? "" : "none";
  if(_sstView === "vencimentos") renderSstVencimentos();
  else if(_sstView === "pessoas") renderSstPessoas();
  else if(_sstView === "programas") renderSstProgramas();
  else if(_sstView === "matriz") renderSstMatriz();
  else if(_sstView === "ghe") renderSstGhe();
  else renderSstCatalogo();
}

/* ---------- situação (sst_situacao) ---------- */
async function sstCarregarSituacao(ids, obraId){
  const chave = ids.join(",") + "|" + (obraId || "");
  if(_sstSituacao && _sstSituacaoChave === chave) return _sstSituacao;
  if(!ids.length){ _sstSituacao = []; _sstSituacaoChave = chave; return _sstSituacao; }
  const { data, error } = await sb.rpc("sst_situacao", { p_funcionarios: ids, p_obra: obraId || null, p_data: hojeISO() });
  if(error){ aviso("app-aviso", "Erro ao calcular a situação: " + error.message, "erro"); return []; }
  _sstSituacao = data || []; _sstSituacaoChave = chave;
  return _sstSituacao;
}

async function renderSstVencimentos(){
  const cont = $("sst-conteudo"); const f = sstFiltros();
  const pessoas = sstFuncsFiltrados(f);
  cont.innerHTML = `<p class="vazio">Calculando a situação de ${pessoas.length} pessoa(s)…</p>`;
  const sit = await sstCarregarSituacao(pessoas.map(p => p.id), f.obra);
  if(_sstView !== "vencimentos") return;
  const porId = Object.fromEntries(_sstFuncs.map(p => [p.id, p]));
  let linhas = sit.filter(s => {
    if(f.natureza && s.natureza !== f.natureza) return false;
    if(f.status === "pendente" && !SST_PENDENTES.includes(s.status)) return false;
    if(f.status === "vencendo" && !["vence_30", "vence_7"].includes(s.status)) return false;
    if(f.status && !["pendente", "vencendo"].includes(f.status) && s.status !== f.status) return false;
    if(f.busca){
      const p = porId[s.funcionario_id] || {};
      const txt = `${p.nome || ""} ${p.funcao || ""} ${s.codigo} ${s.nome}`.toLowerCase();
      if(!txt.includes(f.busca)) return false;
    }
    return true;
  });
  const ordem = { vencido: 0, falta: 1, vence_7: 2, vence_30: 3, ok: 4, nao_aplica: 5 };
  linhas.sort((a, b) => (ordem[a.status] - ordem[b.status]) || String(a.valido_ate || "9").localeCompare(String(b.valido_ate || "9")) || (porId[a.funcionario_id]?.nome || "").localeCompare(porId[b.funcionario_id]?.nome || ""));
  $("sst-contador").textContent = `${linhas.length} de ${sit.length}`;
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">Nenhum vencimento nos filtros. ${_sstMatriz.length ? "" : "A matriz ainda está vazia: preencha-a na visão Matriz ou importe a planilha conferida."}</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Funcionário</th><th>Função</th><th>Requisito</th><th>Natureza</th><th>Origem</th><th>Situação</th><th>Válido até</th></tr></thead>
    <tbody>${linhas.map(s => { const p = porId[s.funcionario_id] || {}; const dias = sstDiasAte(s.valido_ate); return `
      <tr class="linha-clicavel" data-func="${esc(s.funcionario_id)}">
        <td><strong>${esc(p.nome || "—")}</strong></td><td>${esc(p.funcao || "—")}</td>
        <td>${esc(s.codigo)} · ${esc(s.nome)}${s.sensivel ? ' <span class="tag cinza" title="Dado de saúde: só SESMT e RH com MFA veem o arquivo">saúde</span>' : ""}</td>
        <td>${esc(SST_NATUREZA[s.natureza] || s.natureza)}</td><td class="meta">${esc(s.origem || "")}</td>
        <td>${/* html */ sstTagStatus(s.status)}${s.exigencia === "eventual" ? ' <span class="meta">eventual</span>' : ""}</td>
        <td>${dataBR(s.valido_ate)}${dias != null && s.status !== "ok" && s.status !== "falta" ? ` <span class="meta">(${dias < 0 ? `há ${-dias} d` : `em ${Number(dias)} d`})</span>` : ""}</td>
      </tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-func]").forEach(tr => tr.addEventListener("click", () => sstAbrirFuncionarioSeguranca(tr.dataset.func)));
}

async function renderSstPessoas(){
  const cont = $("sst-conteudo"); const f = sstFiltros();
  const pessoas = sstFuncsFiltrados(f).filter(p => !f.busca || `${p.nome} ${p.funcao || ""}`.toLowerCase().includes(f.busca));
  cont.innerHTML = `<p class="vazio">Calculando a situação de ${pessoas.length} pessoa(s)…</p>`;
  const sit = await sstCarregarSituacao(sstFuncsFiltrados(f).map(p => p.id), f.obra);
  if(_sstView !== "pessoas") return;
  const agg = {};
  sit.forEach(s => { const a = agg[s.funcionario_id] = agg[s.funcionario_id] || { ok: 0, vencendo: 0, vencido: 0, falta: 0, exigidos: 0 }; if(s.status !== "nao_aplica") a.exigidos++; if(s.status === "ok") a.ok++; else if(s.status === "vencido") a.vencido++; else if(s.status === "falta") a.falta++; else if(s.status !== "nao_aplica") a.vencendo++; });
  $("sst-contador").textContent = `${pessoas.length} de ${_sstFuncs.length}`;
  if(!pessoas.length){ cont.innerHTML = `<p class="vazio">Nenhum funcionário nos filtros.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Funcionário</th><th>Função</th><th>Departamento</th><th>GHE</th><th>Exigidos</th><th>OK</th><th>Vencendo</th><th>Vencidos</th><th>Faltam</th></tr></thead>
    <tbody>${pessoas.map(p => { const a = agg[p.id] || { ok: 0, vencendo: 0, vencido: 0, falta: 0, exigidos: 0 }; const g = _sstGheFuncoes.find(x => x.funcao_chave === sstFuncaoChave(p.funcao)); const ghe = g ? _sstGhes.find(x => x.id === g.ghe_id) : null; return `
      <tr class="linha-clicavel" data-func="${esc(p.id)}">
        <td><strong>${esc(p.nome)}</strong></td><td>${esc(p.funcao || "—")}</td><td>${esc(sstDeptoNome(p.departamento_id))}</td>
        <td>${ghe ? esc(ghe.codigo) : '<span class="tag cinza">sem GHE</span>'}</td>
        <td>${Number(a.exigidos)}</td><td>${a.ok ? `<span class="tag verde">${Number(a.ok)}</span>` : "—"}</td>
        <td>${a.vencendo ? `<span class="tag ambar">${Number(a.vencendo)}</span>` : "—"}</td>
        <td>${a.vencido ? `<span class="tag vermelho">${Number(a.vencido)}</span>` : "—"}</td>
        <td>${a.falta ? `<span class="tag vermelho">${Number(a.falta)}</span>` : "—"}</td>
      </tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-func]").forEach(tr => tr.addEventListener("click", () => sstAbrirFuncionarioSeguranca(tr.dataset.func)));
}

async function sstAbrirFuncionarioSeguranca(funcionarioId){
  if(typeof abrirFuncionario !== "function" || !irParaSecao("funcionarios")) return;
  await abrirFuncionario(funcionarioId);
  if(typeof ativarTabFunc === "function") ativarTabFunc("seguranca");
  sstFichaFuncCarregar();
}

/* ---------- programas legais ---------- */
function sstProgFarol(p){
  if(!p.vigencia_fim) return `<span class="tag cinza">sem vigência</span>`;
  const d = sstDiasAte(p.vigencia_fim);
  if(d < 0) return `<span class="tag vermelho">vencido há ${-d} d</span>`;
  if(d <= 30) return `<span class="tag ambar">vence em ${Number(d)} d</span>`;
  return `<span class="tag verde">vigente</span>`;
}
function renderSstProgramas(){
  const cont = $("sst-conteudo"); const f = sstFiltros();
  const linhas = _sstProgramas.filter(p => {
    if(f.obra && p.obra_id !== f.obra) return false;
    if(f.busca){ const txt = `${p.requisito?.codigo || ""} ${p.requisito?.nome || ""} ${p.obra?.codigo || "sede"} ${p.obra?.nome || ""} ${p.responsavel_tecnico || ""} ${p.art_numero || ""}`.toLowerCase(); if(!txt.includes(f.busca)) return false; }
    return true;
  });
  $("sst-contador").textContent = `${linhas.length} de ${_sstProgramas.length}`;
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">Nenhum programa legal cadastrado${f.obra ? " nesta obra" : ""}.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Escopo</th><th>Programa</th><th>Revisão</th><th>Vigência</th><th>Situação</th><th>Resp. técnico</th><th>ART (CREA)</th><th>Entregue à contratante</th></tr></thead>
    <tbody>${linhas.map(p => `
      <tr class="linha-clicavel" data-id="${esc(p.id)}">
        <td>${p.escopo === "sede" ? "Sede" : (p.obra ? (typeof linkObra === "function" ? /* html */ linkObra(p.obra.id, esc(p.obra.codigo)) : esc(p.obra.codigo)) : "—")}</td>
        <td><strong>${esc(p.requisito?.codigo || "—")}</strong> · ${esc(p.requisito?.nome || "")}</td>
        <td>${esc(p.revisao || "—")}</td>
        <td>${dataBR(p.vigencia_inicio)} → ${dataBR(p.vigencia_fim)}</td>
        <td>${/* html */ sstProgFarol(p)}</td>
        <td>${esc(p.responsavel_tecnico || "—")}</td>
        <td>${esc(p.art_numero || "—")}${p.art_numero ? (p.art_baixada ? ' <span class="tag cinza">baixada</span>' : "") : ""}</td>
        <td>${dataBR(p.entregue_contratante_em)}</td>
      </tr>`).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => abrirSstPrograma(tr.dataset.id)));
}

/* ---------- catálogo ---------- */
function renderSstCatalogo(){
  const cont = $("sst-conteudo"); const f = sstFiltros();
  const linhas = _sstReqs.filter(r => (!f.natureza || r.natureza === f.natureza)
    && (!f.busca || `${r.codigo} ${r.nome} ${(r.sinonimos || []).join(" ")}`.toLowerCase().includes(f.busca)));
  $("sst-contador").textContent = `${linhas.length} de ${_sstReqs.length}`;
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">Nenhum requisito nos filtros.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Código</th><th>Nome</th><th>Natureza</th><th>Grupo</th><th>Validade</th><th>Carga (h)</th><th>Emissor</th><th>Na matriz</th><th>Situação</th></tr></thead>
    <tbody>${linhas.map(r => `
      <tr class="linha-clicavel" data-id="${esc(r.id)}">
        <td><strong>${esc(r.codigo)}</strong></td><td>${esc(r.nome)}${r.sensivel ? ' <span class="tag cinza" title="Dado de saúde">saúde</span>' : ""}</td>
        <td>${esc(SST_NATUREZA[r.natureza] || r.natureza)}</td><td>${esc(SST_GRUPO[r.grupo] || r.grupo)}</td>
        <td>${esc(sstValidadeTxt(r.validade))}</td><td>${r.carga_horaria != null ? esc(String(r.carga_horaria).replace(".", ",")) : "—"}</td>
        <td>${esc(SST_EMISSOR[r.emissor] || r.emissor)}</td>
        <td>${_sstMatriz.filter(m => m.requisito_id === r.id).length || "—"}</td>
        <td>${/* html */ tagSituacao(r.ativo)}</td>
      </tr>`).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => abrirSstRequisito(tr.dataset.id)));
}

/* ---------- GHE ---------- */
function renderSstGhe(){
  const cont = $("sst-conteudo"); const f = sstFiltros(); const opera = sstPodeOperar();
  const funcoesAtivas = [...new Set(_sstFuncs.map(p => p.funcao).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const comGhe = new Set(_sstGheFuncoes.map(g => g.funcao_chave));
  const semGhe = funcoesAtivas.filter(fu => !comGhe.has(sstFuncaoChave(fu)));
  $("sst-contador").textContent = `${_sstGhes.length} GHE · ${semGhe.length} função(ões) sem GHE`;
  const grupos = _sstGhes.filter(g => !f.busca || `${g.codigo} ${g.nome} ${g.descricao || ""}`.toLowerCase().includes(f.busca));
  const optFuncoes = funcoesAtivas.map(fu => `<option value="${esc(fu)}">${esc(fu)}</option>`).join("");
  cont.innerHTML = `
    ${opera ? `<div style="margin-bottom:var(--esp-3);"><button type="button" class="btn-sec" id="btn-sst-novo-ghe">+ GHE</button></div>` : ""}
    ${grupos.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>GHE</th><th>Nome</th><th>Funções</th>${opera ? "<th></th>" : ""}</tr></thead>
      <tbody>${grupos.map(g => { const fs = _sstGheFuncoes.filter(x => x.ghe_id === g.id); return `
        <tr>
          <td><strong>${esc(g.codigo)}</strong></td>
          <td>${esc(g.nome)}${g.descricao ? `<div class="meta">${esc(g.descricao)}</div>` : ""}</td>
          <td>${fs.length ? fs.map(x => `<span class="tag cinza">${esc(x.funcao_nome)}${opera ? ` <button type="button" class="btn-sec btn-sm sst-ghe-del" data-id="${esc(x.id)}" title="Tirar a função deste GHE">×</button>` : ""}</span>`).join(" ") : '<span class="meta">nenhuma</span>'}</td>
          ${opera ? `<td class="col-acao"><select class="sst-ghe-add" data-ghe="${esc(g.id)}" title="Acrescentar função a este GHE"><option value="">+ função…</option>${/* html */ optFuncoes}</select></td>` : ""}
        </tr>`; }).join("")}</tbody></table></div>` : `<p class="vazio">Nenhum GHE cadastrado. A carga do RG 4.38.5 vem por <code>scripts/importar-sst.js ghe</code> depois da conferência da Iasmym; ou cadastre aqui.</p>`}
    <h4 style="margin:var(--esp-4) 0 var(--esp-2);">Funções sem GHE (${semGhe.length})</h4>
    ${semGhe.length ? `<p class="meta">${semGhe.map(esc).join(" · ")}</p>` : `<p class="vazio">Toda função de funcionário ativo tem GHE.</p>`}`;
  $("btn-sst-novo-ghe")?.addEventListener("click", sstNovoGhe);
  cont.querySelectorAll(".sst-ghe-add").forEach(sel => sel.addEventListener("change", () => sstGheAddFuncao(sel.dataset.ghe, sel.value, sel)));
  cont.querySelectorAll(".sst-ghe-del").forEach(b => b.addEventListener("click", () => sstGheDelFuncao(b.dataset.id)));
}
async function sstNovoGhe(){
  const codigo = (prompt("Código do GHE (ex.: GHE-05):") || "").trim(); if(!codigo) return;
  const nome = (prompt("Nome do GHE (ex.: Operação I):") || "").trim(); if(!nome) return;
  const { error } = await sb.from("sst_ghe").insert({ codigo, nome });
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não grava GHE."), "erro"); return; }
  await carregarSesmt(true); aviso("app-aviso", "GHE criado.", "ok");
}
async function sstGheAddFuncao(gheId, funcao, sel){
  if(!funcao) return;
  const chave = sstFuncaoChave(funcao);
  const outra = _sstGheFuncoes.find(g => g.funcao_chave === chave);
  if(outra){ aviso("app-aviso", `"${funcao}" já está no GHE ${_sstGhes.find(g => g.id === outra.ghe_id)?.codigo || ""}: uma função pertence a um só GHE. Tire de lá primeiro.`, "erro"); sel.value = ""; return; }
  const { error } = await sb.from("sst_ghe_funcoes").insert({ ghe_id: gheId, funcao_chave: await sstChaveBanco(funcao), funcao_nome: funcao });
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não grava GHE."), "erro"); sel.value = ""; return; }
  await carregarSesmt(true);
}
async function sstGheDelFuncao(id){
  const { error } = await sb.from("sst_ghe_funcoes").delete().eq("id", id);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não grava GHE."), "erro"); return; }
  await carregarSesmt(true);
}

/* ---------- matriz ---------- */
function sstMatrizLinhas(alvo, f){
  // cada linha: { key, label, campo: { coluna: valor } } — o que a célula grava em sst_matriz
  if(alvo === "funcao"){
    const nomes = new Map();
    _sstFuncs.forEach(p => { if(p.funcao){ const k = sstFuncaoChave(p.funcao); if(k && !nomes.has(k)) nomes.set(k, p.funcao); } });
    _sstGheFuncoes.forEach(g => { if(!nomes.has(g.funcao_chave)) nomes.set(g.funcao_chave, g.funcao_nome); });
    _sstMatriz.filter(m => m.alvo === "funcao" && m.funcao_chave && !nomes.has(m.funcao_chave)).forEach(m => nomes.set(m.funcao_chave, m.funcao_chave));
    let rows = [...nomes.entries()].map(([k, n]) => ({ key: k, label: n, campo: { funcao_chave: k } }));
    if(f.funcao) rows = rows.filter(r => r.key === sstFuncaoChave(f.funcao));
    if(f.ghe){ const ks = new Set(_sstGheFuncoes.filter(g => g.ghe_id === f.ghe).map(g => g.funcao_chave)); rows = rows.filter(r => ks.has(r.key)); }
    if(f.depto){ const ks = new Set(_sstFuncs.filter(p => p.departamento_id === f.depto).map(p => sstFuncaoChave(p.funcao))); rows = rows.filter(r => ks.has(r.key)); }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }
  if(alvo === "ghe") return _sstGhes.filter(g => !f.ghe || g.id === f.ghe).map(g => ({ key: g.id, label: `${g.codigo} · ${g.nome}`, campo: { ghe_id: g.id } }));
  if(alvo === "metodo") return Object.entries(SST_METODO).map(([k, l]) => ({ key: k, label: l, campo: { metodo: k } }));
  if(alvo === "equipamento") return _sstEquipamentos.map(e => ({ key: e.id, label: `${e.codigo} · ${e.nome}`, campo: { equipamento_id: e.id } }));
  if(alvo === "cliente"){
    const comObra = new Set(_sstObras.map(o => o.cliente_id)); const naMatriz = new Set(_sstMatriz.filter(m => m.alvo === "cliente").map(m => m.cliente_id));
    return _sstClientes.filter(c => comObra.has(c.id) || naMatriz.has(c.id)).map(c => ({ key: c.id, label: c.nome, campo: { cliente_id: c.id } }));
  }
  return _sstObras.filter(o => !f.obra || o.id === f.obra).map(o => ({ key: o.id, label: sstObraRotulo(o), campo: { obra_id: o.id } }));
}
function sstMatrizCelula(alvo, key, reqId){
  return _sstMatriz.find(m => m.alvo === alvo && m.requisito_id === reqId && (
    (alvo === "funcao" && m.funcao_chave === key) || (alvo === "ghe" && m.ghe_id === key) || (alvo === "metodo" && m.metodo === key) ||
    (alvo === "equipamento" && m.equipamento_id === key) || (alvo === "cliente" && m.cliente_id === key) || (alvo === "obra" && m.obra_id === key)));
}
function sstMatrizColunas(f){
  return _sstReqs.filter(r => r.ativo && (f.natureza ? r.natureza === f.natureza : ["treinamento", "documento"].includes(r.natureza) && !r.sensivel)
    && (!f.busca || `${r.codigo} ${r.nome}`.toLowerCase().includes(f.busca)));
}
function renderSstMatriz(){
  const cont = $("sst-conteudo"); const f = sstFiltros(); const opera = sstPodeOperar();
  const linhas = sstMatrizLinhas(_sstMatrizAlvo, f); const cols = sstMatrizColunas(f);
  $("sst-contador").textContent = `${_sstMatriz.filter(m => m.alvo === _sstMatrizAlvo).length} exigência(s) por ${SST_ALVO[_sstMatrizAlvo].toLowerCase()}`;
  const seletor = `<div class="serv-filtros" style="margin-bottom:var(--esp-2);">
      <select id="sst-matriz-alvo" title="Alvo da exigência">${Object.entries(SST_ALVO).map(([k, l]) => `<option value="${esc(k)}" ${k === _sstMatrizAlvo ? "selected" : ""}>Por ${esc(l.toLowerCase())}</option>`).join("")}</select>
      <span class="meta">Clique na célula: vazio → <strong>X</strong> obrigatório → <strong>E</strong> eventual → vazio. ${_sstMatrizAlvo === "cliente" || _sstMatrizAlvo === "obra" ? "Requisito de cliente/obra só é cobrado de quem está alocado ou no dossiê daquela obra (D6); a validade do cliente, quando menor, vale só lá (edite na ficha do requisito pela coluna Na matriz)." : ""}${opera ? "" : " Modo leitura."}</span>
    </div>`;
  if(!linhas.length || !cols.length){ cont.innerHTML = seletor + `<p class="vazio">${!cols.length ? "Nenhum requisito nas colunas (ajuste o filtro de natureza/busca)." : "Nenhuma linha para este alvo."}</p>`; sstLigarMatrizAlvo(); return; }
  cont.innerHTML = seletor + `<div class="tabela-rola"><table class="sst-matriz">
    <thead><tr><th>${esc(SST_ALVO[_sstMatrizAlvo])}</th>${cols.map(r => `<th title="${esc(r.nome)}${r.validade ? " · " + esc(sstValidadeTxt(r.validade)) : ""}" style="writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-size:var(--txt-xs);">${esc(r.codigo)}</th>`).join("")}</tr></thead>
    <tbody>${linhas.map(l => `<tr><td style="white-space:nowrap;"><strong>${esc(l.label)}</strong></td>${cols.map(r => { const c = sstMatrizCelula(_sstMatrizAlvo, l.key, r.id); const marca = c ? (c.exigencia === "eventual" ? "E" : "X") : ""; return `<td class="${opera ? "linha-clicavel" : ""} sst-mcel" data-key="${esc(l.key)}" data-req="${esc(r.id)}" style="text-align:center;" title="${esc(l.label)} × ${esc(r.codigo)}${c && c.validade ? " · validade " + esc(sstValidadeTxt(c.validade)) : ""}">${marca ? `<span class="tag ${marca === "X" ? "verde" : "ambar"}">${marca}</span>` : '<span class="meta">·</span>'}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
  sstLigarMatrizAlvo();
  if(opera) cont.querySelectorAll(".sst-mcel").forEach(td => td.addEventListener("click", () => sstMatrizAlternar(td.dataset.key, td.dataset.req, linhas)));
}
function sstLigarMatrizAlvo(){ $("sst-matriz-alvo")?.addEventListener("change", e => { _sstMatrizAlvo = e.target.value; renderSstMatriz(); }); }
async function sstMatrizAlternar(key, reqId, linhas){
  const linha = linhas.find(l => l.key === key); if(!linha) return;
  const atual = sstMatrizCelula(_sstMatrizAlvo, key, reqId);
  let erro = null;
  if(!atual){
    const campo = _sstMatrizAlvo === "funcao" ? { funcao_chave: await sstChaveBanco(linha.label) } : linha.campo;
    const { error } = await sb.from("sst_matriz").insert({ alvo: _sstMatrizAlvo, requisito_id: reqId, exigencia: "obrigatorio", ...campo }); erro = error;
  } else if(atual.exigencia === "obrigatorio"){
    const { error } = await sb.from("sst_matriz").update({ exigencia: "eventual" }).eq("id", atual.id); erro = error;
  } else {
    const { error } = await sb.from("sst_matriz").delete().eq("id", atual.id); erro = error;
  }
  if(erro){ aviso("app-aviso", sstErroMsg(erro, "Seu perfil não edita a matriz."), "erro"); return; }
  const { data } = await sb.from("sst_matriz").select("*").eq("ativo", true);
  _sstMatriz = data || _sstMatriz; _sstSituacao = null;
  renderSstMatriz();
}

/* exportação para conferência (D5): uma aba por alvo função e GHE, X/E nas células, aba Requisitos */
function sstExportarMatriz(){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
  const cols = _sstReqs.filter(r => r.ativo && ["treinamento", "documento"].includes(r.natureza) && !r.sensivel);
  const wb = XLSX.utils.book_new();
  ["funcao", "ghe"].forEach(alvo => {
    const linhas = sstMatrizLinhas(alvo, { busca: "", depto: "", funcao: "", ghe: "", obra: "" });
    const aoa = [[SST_ALVO[alvo], ...cols.map(r => r.codigo)]];
    linhas.forEach(l => aoa.push([l.label, ...cols.map(r => { const c = sstMatrizCelula(alvo, l.key, r.id); return c ? (c.exigencia === "eventual" ? "E" : "X") : ""; })]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), alvo === "funcao" ? "Funcao" : "GHE");
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Código", "Nome", "Natureza", "Grupo", "Validade", "Carga (h)"],
    ...cols.map(r => [r.codigo, r.nome, SST_NATUREZA[r.natureza], SST_GRUPO[r.grupo], sstValidadeTxt(r.validade), r.carga_horaria ?? ""])]), "Requisitos");
  XLSX.writeFile(wb, `matriz-sst-conferencia-${hojeISO()}.xlsx`);
}
/* importação da planilha conferida: lê as abas Funcao e GHE, compara com a matriz e mostra o resumo; grava só no "Aplicar" */
async function sstImportarMatriz(file){
  if(!file || typeof XLSX === "undefined") return;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const porCodigo = Object.fromEntries(_sstReqs.map(r => [r.codigo.toUpperCase(), r]));
  const funcoes = sstMatrizLinhas("funcao", { busca: "", depto: "", funcao: "", ghe: "", obra: "" });
  const ghes = sstMatrizLinhas("ghe", { busca: "", depto: "", funcao: "", ghe: "", obra: "" });
  const novas = [], removidas = [], alteradas = [], desconhecidos = new Set(), semPar = new Set(); let lidas = 0;
  [["Funcao", "funcao", funcoes], ["GHE", "ghe", ghes]].forEach(([aba, alvo, linhas]) => {
    const ws = wb.Sheets[aba] || wb.Sheets[aba.toLowerCase()] || wb.Sheets[aba.toUpperCase()]; if(!ws) return;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }); if(!aoa.length) return;
    const cab = aoa[0].map(c => String(c || "").trim().toUpperCase());
    const vistas = new Set();
    aoa.slice(1).forEach(row => {
      const rotulo = String(row[0] || "").trim(); if(!rotulo) return; lidas++;
      const linha = alvo === "funcao" ? linhas.find(l => l.key === sstFuncaoChave(rotulo) || l.label.toLowerCase() === rotulo.toLowerCase())
                                     : linhas.find(l => l.label.toLowerCase() === rotulo.toLowerCase() || l.label.split(" · ")[0].toLowerCase() === rotulo.toLowerCase());
      if(!linha){ semPar.add(rotulo); return; }
      cab.slice(1).forEach((cod, i) => {
        if(!cod) return; const req = porCodigo[cod]; if(!req){ desconhecidos.add(cod); return; }
        const marca = String(row[i + 1] || "").trim().toUpperCase(); const exig = marca === "X" ? "obrigatorio" : marca === "E" ? "eventual" : null;
        vistas.add(linha.key + "|" + req.id);
        const atual = sstMatrizCelula(alvo, linha.key, req.id);
        if(exig && !atual) novas.push({ alvo, requisito_id: req.id, exigencia: exig, ...linha.campo, _rotulo: `${linha.label} × ${cod}` });
        else if(exig && atual && atual.exigencia !== exig) alteradas.push({ id: atual.id, exigencia: exig, _rotulo: `${linha.label} × ${cod}` });
        else if(!exig && atual) removidas.push({ id: atual.id, _rotulo: `${linha.label} × ${cod}` });
      });
    });
  });
  _sstMatrizImport = { novas, removidas, alteradas };
  const cont = $("sst-conteudo");
  cont.innerHTML = `<div class="card" style="margin-bottom:var(--esp-3);">
    <h4 style="margin:0 0 var(--esp-2);">Planilha conferida: ${esc(file.name)}</h4>
    <p class="meta">${lidas} linha(s) lida(s) · <strong>${novas.length}</strong> marcação(ões) nova(s) · <strong>${alteradas.length}</strong> alterada(s) (X↔E) · <strong>${removidas.length}</strong> removida(s)
      ${desconhecidos.size ? ` · códigos desconhecidos (ignorados): ${[...desconhecidos].map(esc).join(", ")}` : ""}
      ${semPar.size ? ` · linhas sem par no app (ignoradas): ${[...semPar].map(esc).join(", ")}` : ""}</p>
    ${novas.length || alteradas.length || removidas.length ? `<ul class="meta" style="max-height:240px;overflow:auto;">${novas.map(n => `<li>+ ${esc(n._rotulo)} (${n.exigencia === "eventual" ? "E" : "X"})</li>`).join("")}${alteradas.map(a => `<li>~ ${esc(a._rotulo)} → ${a.exigencia === "eventual" ? "E" : "X"}</li>`).join("")}${removidas.map(r => `<li>− ${esc(r._rotulo)}</li>`).join("")}</ul>
      <div class="form-acoes"><button type="button" class="btn" id="btn-sst-import-aplicar">Aplicar na matriz</button><button type="button" class="btn-sec" id="btn-sst-import-cancelar">Cancelar</button></div>` : `<p class="vazio">Nada a mudar: a planilha bate com a matriz.</p><div class="form-acoes"><button type="button" class="btn-sec" id="btn-sst-import-cancelar">Voltar</button></div>`}
  </div>`;
  $("btn-sst-import-cancelar")?.addEventListener("click", () => { _sstMatrizImport = null; renderSstMatriz(); });
  $("btn-sst-import-aplicar")?.addEventListener("click", async (e) => {
    await comBotaoTravado(e.currentTarget, async () => {
      const imp = _sstMatrizImport; if(!imp) return;
      let erro = null;
      if(imp.novas.length){ const { error } = await sb.from("sst_matriz").insert(imp.novas.map(({ _rotulo, ...n }) => n)); erro = erro || error; }
      for(const a of imp.alteradas){ const { error } = await sb.from("sst_matriz").update({ exigencia: a.exigencia }).eq("id", a.id); erro = erro || error; }
      if(imp.removidas.length){ const { error } = await sb.from("sst_matriz").delete().in("id", imp.removidas.map(r => r.id)); erro = erro || error; }
      if(erro){ aviso("app-aviso", sstErroMsg(erro, "Seu perfil não edita a matriz."), "erro"); return; }
      _sstMatrizImport = null;
      await carregarSesmt(true);
      aviso("app-aviso", "Matriz atualizada pela planilha conferida.", "ok");
    });
  });
}

/* ---------- ficha do requisito ---------- */
function sstMostrarPainel(){
  $("sst-painel").style.display = ""; $("sst-ficha-req").style.display = "none"; $("sst-ficha-prog").style.display = "none";
  sstReqEditId = null; sstProgEditId = null;
}
function sstPreencherSelectsFicha(){
  const nat = $("sst-req-natureza"); if(nat && !nat.options.length) nat.innerHTML = Object.entries(SST_NATUREZA).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  const gru = $("sst-req-grupo"); if(gru && !gru.options.length) gru.innerHTML = Object.entries(SST_GRUPO).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  const emi = $("sst-req-emissor"); if(emi && !emi.options.length) emi.innerHTML = Object.entries(SST_EMISSOR).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  const leg = $("sst-req-legado"); if(leg && !leg.options.length) leg.innerHTML = `<option value="">—</option>` + ["aso", "nr35", "nr18", "cipa", "nr10", "nr33", "cnh", "crea", "cau"].map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
}
function novoSstRequisito(){
  sstPreencherSelectsFicha();
  sstReqEditId = null;
  ["sst-req-codigo", "sst-req-nome", "sst-req-validade", "sst-req-carga", "sst-req-nota", "sst-req-custo", "sst-req-guarda", "sst-req-rg", "sst-req-conteudo", "sst-req-normas", "sst-req-sinonimos", "sst-req-obs"].forEach(id => { if($(id)) $(id).value = ""; });
  $("sst-req-natureza").value = "treinamento"; $("sst-req-grupo").value = "nr"; $("sst-req-emissor").value = "interno"; $("sst-req-legado").value = "";
  $("sst-req-sensivel").checked = false; $("sst-req-prova").checked = false; $("sst-req-ativo").checked = true; $("sst-req-nota").value = "70"; $("sst-req-ordem").value = "100";
  $("sst-req-codigo").disabled = false;
  sstAbrirFichaReqVisual({ codigo: "(novo)", natureza: "treinamento", grupo: "nr", ativo: true });
}
function abrirSstRequisito(id){
  const r = sstReqPorId(id); if(!r){ aviso("app-aviso", "Requisito não encontrado.", "erro"); return; }
  sstPreencherSelectsFicha();
  sstReqEditId = id;
  $("sst-req-codigo").value = r.codigo; $("sst-req-codigo").disabled = true;
  $("sst-req-nome").value = r.nome || ""; $("sst-req-natureza").value = r.natureza; $("sst-req-grupo").value = r.grupo;
  $("sst-req-validade").value = r.validade ? sstValidadeTxt(r.validade) : ""; $("sst-req-carga").value = r.carga_horaria ?? "";
  $("sst-req-emissor").value = r.emissor || "interno"; $("sst-req-sensivel").checked = !!r.sensivel; $("sst-req-prova").checked = !!r.exige_prova;
  $("sst-req-nota").value = r.nota_minima ?? 70; $("sst-req-custo").value = r.custo_referencia ?? ""; $("sst-req-guarda").value = r.guarda_anos ?? "";
  $("sst-req-rg").value = r.rg_formulario || ""; $("sst-req-legado").value = r.doc_tipo_legado || ""; $("sst-req-ordem").value = r.ordem ?? 100;
  $("sst-req-conteudo").value = r.conteudo || ""; $("sst-req-normas").value = r.normas || ""; $("sst-req-sinonimos").value = (r.sinonimos || []).join("\n");
  $("sst-req-obs").value = r.observacoes || ""; $("sst-req-ativo").checked = r.ativo !== false;
  sstAbrirFichaReqVisual(r);
}
function sstAbrirFichaReqVisual(r){
  $("sst-painel").style.display = "none"; $("sst-ficha-prog").style.display = "none"; $("sst-ficha-req").style.display = "";
  $("sst-req-titulo").textContent = sstReqEditId ? `${r.codigo} · ${r.nome}` : "Novo requisito";
  $("sst-req-chip-codigo").textContent = r.codigo || "—"; $("sst-req-chip-natureza").textContent = SST_NATUREZA[r.natureza] || "—";
  $("sst-req-chip-grupo").textContent = SST_GRUPO[r.grupo] || "—"; $("sst-req-chip-validade").textContent = sstValidadeTxt(r.validade);
  $("sst-req-chip-matriz").textContent = sstReqEditId ? String(_sstMatriz.filter(m => m.requisito_id === sstReqEditId).length) : "0";
  $("sst-req-chip-situacao").innerHTML = tagSituacao(r.ativo);
  const opera = sstPodeOperar();
  ["btn-sst-req-salvar", "btn-sst-req-excluir"].forEach(id => { $(id).style.display = opera ? "" : "none"; });
  $("btn-sst-req-excluir").style.display = opera && sstReqEditId ? "" : "none";
  sstAtivarTab("sst-ficha-req", "sst-req-notebook", "dados");
  sstRenderReqMatriz();
}
function sstRenderReqMatriz(){
  const cont = $("sst-req-matriz"); if(!cont) return;
  const usos = _sstMatriz.filter(m => m.requisito_id === sstReqEditId);
  if(!usos.length){ cont.innerHTML = `<p class="vazio">Este requisito ainda não está na matriz. Marque-o na visão Matriz do painel.</p>`; return; }
  const rot = (m) => m.alvo === "funcao" ? m.funcao_chave : m.alvo === "ghe" ? (_sstGhes.find(g => g.id === m.ghe_id)?.codigo || "GHE") : m.alvo === "metodo" ? (SST_METODO[m.metodo] || m.metodo)
    : m.alvo === "equipamento" ? (_sstEquipamentos.find(e => e.id === m.equipamento_id)?.codigo || "TAG") : m.alvo === "cliente" ? (_sstClientes.find(c => c.id === m.cliente_id)?.nome || "cliente") : (sstObraRotulo(_sstObras.find(o => o.id === m.obra_id)) || "obra");
  const opera = sstPodeOperar();
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Alvo</th><th>Quem</th><th>Exigência</th><th>Validade própria</th><th>Tipos de ASO</th><th>Observação</th>${opera ? "<th></th>" : ""}</tr></thead>
    <tbody>${usos.map(m => `<tr>
      <td>${esc(SST_ALVO[m.alvo] || m.alvo)}</td><td><strong>${esc(rot(m))}</strong></td>
      <td>${m.exigencia === "eventual" ? '<span class="tag ambar">E eventual</span>' : '<span class="tag verde">X obrigatório</span>'}</td>
      <td>${opera ? `<input class="sst-mat-val" data-id="${esc(m.id)}" value="${esc(m.validade ? sstValidadeTxt(m.validade) : "")}" placeholder="ex.: 12 meses" style="width:110px;" title="Validade só para este alvo (D6); vazio = a do catálogo" />` : esc(m.validade ? sstValidadeTxt(m.validade) : "—")}</td>
      <td>${esc((m.tipos_aso || []).join(", ") || "—")}</td>
      <td>${opera ? `<input class="sst-mat-obs" data-id="${esc(m.id)}" value="${esc(m.observacao || "")}" style="width:160px;" />` : esc(m.observacao || "—")}</td>
      ${opera ? `<td class="col-acao"><button type="button" class="btn-sec btn-sm sst-mat-del" data-id="${esc(m.id)}">Tirar</button></td>` : ""}
    </tr>`).join("")}</tbody></table></div>`;
  cont.querySelectorAll(".sst-mat-val").forEach(inp => inp.addEventListener("change", async () => {
    const iv = sstValidadeParaBanco(inp.value); if(iv === undefined){ aviso("app-aviso", "Validade: use \"24 meses\", \"912 dias\" ou \"2 anos\".", "erro"); return; }
    const { error } = await sb.from("sst_matriz").update({ validade: iv }).eq("id", inp.dataset.id);
    if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não edita a matriz."), "erro"); return; }
    const m = _sstMatriz.find(x => x.id === inp.dataset.id); if(m) m.validade = iv; _sstSituacao = null;
  }));
  cont.querySelectorAll(".sst-mat-obs").forEach(inp => inp.addEventListener("change", async () => {
    const { error } = await sb.from("sst_matriz").update({ observacao: inp.value.trim() || null }).eq("id", inp.dataset.id);
    if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não edita a matriz."), "erro"); return; }
    const m = _sstMatriz.find(x => x.id === inp.dataset.id); if(m) m.observacao = inp.value.trim() || null;
  }));
  cont.querySelectorAll(".sst-mat-del").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("sst_matriz").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não edita a matriz."), "erro"); return; }
    _sstMatriz = _sstMatriz.filter(x => x.id !== b.dataset.id); _sstSituacao = null; sstRenderReqMatriz();
    $("sst-req-chip-matriz").textContent = String(_sstMatriz.filter(m => m.requisito_id === sstReqEditId).length);
  }));
}
async function salvarSstRequisito(){
  const codigo = $("sst-req-codigo").value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if(!/^[A-Z0-9_]+$/.test(codigo)){ aviso("app-aviso", "Código só com letras maiúsculas, dígitos e _ (ex.: NR12_HELICE).", "erro"); return; }
  const nome = $("sst-req-nome").value.trim(); if(!nome){ aviso("app-aviso", "Informe o nome.", "erro"); return; }
  const validade = sstValidadeParaBanco($("sst-req-validade").value);
  if(validade === undefined){ aviso("app-aviso", "Validade: use \"24 meses\", \"912 dias\" ou \"2 anos\" (vazio = sem validade).", "erro"); return; }
  const num = (id) => { const v = $(id).value.trim().replace(",", "."); return v === "" ? null : Number(v); };
  const reg = {
    codigo, nome, natureza: $("sst-req-natureza").value, grupo: $("sst-req-grupo").value, validade,
    carga_horaria: num("sst-req-carga"), emissor: $("sst-req-emissor").value, sensivel: $("sst-req-sensivel").checked,
    exige_prova: $("sst-req-prova").checked, nota_minima: num("sst-req-nota") ?? 70, custo_referencia: num("sst-req-custo"),
    guarda_anos: num("sst-req-guarda"), rg_formulario: $("sst-req-rg").value.trim() || null, doc_tipo_legado: $("sst-req-legado").value || null,
    ordem: num("sst-req-ordem") ?? 100, conteudo: $("sst-req-conteudo").value.trim() || null, normas: $("sst-req-normas").value.trim() || null,
    sinonimos: $("sst-req-sinonimos").value.split(/\n|;/).map(s => s.trim()).filter(Boolean), observacoes: $("sst-req-obs").value.trim() || null,
    ativo: $("sst-req-ativo").checked
  };
  const q = sstReqEditId ? sb.from("sst_requisitos").update(reg).eq("id", sstReqEditId) : sb.from("sst_requisitos").insert(reg);
  const { error } = await q;
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não grava o catálogo."), "erro"); return; }
  aviso("app-aviso", "Requisito salvo.", "ok");
  await carregarSesmt(true);
  sstMostrarPainel();
}
async function excluirSstRequisito(){
  if(!sstReqEditId) return;
  if(_sstMatriz.some(m => m.requisito_id === sstReqEditId)){ aviso("app-aviso", "Tire o requisito da matriz antes de excluir; ou só desative.", "erro"); return; }
  if(!confirm("Excluir este requisito? Se já houver documento ligado a ele, o banco recusa (use Inativo).")) return;
  const { error } = await sb.from("sst_requisitos").delete().eq("id", sstReqEditId);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não grava o catálogo."), "erro"); return; }
  aviso("app-aviso", "Requisito excluído.", "ok");
  await carregarSesmt(true);
  sstMostrarPainel();
}

/* ---------- ficha do programa legal ---------- */
function sstPreencherSelectsProg(){
  const req = $("sst-prog-requisito");
  req.innerHTML = `<option value="">—</option>` + _sstReqs.filter(r => r.natureza === "programa" && r.ativo).map(r => `<option value="${esc(r.id)}">${esc(r.codigo)} · ${esc(r.nome)}</option>`).join("");
  preencherSelect($("sst-prog-obra"), _sstObras.map(o => ({ id: o.id, t: sstObraRotulo(o) })), "id", "t", "— (sede)");
}
function novoSstPrograma(obraId){
  sstPreencherSelectsProg();
  sstProgEditId = null;
  ["sst-prog-revisao", "sst-prog-inicio", "sst-prog-fim", "sst-prog-resp", "sst-prog-art", "sst-prog-entregue", "sst-prog-valor", "sst-prog-obs"].forEach(id => { $(id).value = ""; });
  $("sst-prog-requisito").value = ""; $("sst-prog-obra").value = obraId || _sstProgObraPre || "";
  $("sst-prog-escopo").value = $("sst-prog-obra").value ? "obra" : "sede"; $("sst-prog-art-baixada").checked = false; $("sst-prog-destino").value = "sesmt";
  _sstProgObraPre = null;
  sstAbrirFichaProgVisual({ requisito: null, obra: _sstObras.find(o => o.id === $("sst-prog-obra").value) || null, escopo: $("sst-prog-escopo").value });
}
function abrirSstPrograma(id){
  const p = _sstProgramas.find(x => x.id === id); if(!p){ aviso("app-aviso", "Programa não encontrado.", "erro"); return; }
  sstPreencherSelectsProg();
  sstProgEditId = id;
  $("sst-prog-requisito").value = p.requisito_id || ""; $("sst-prog-escopo").value = p.escopo; $("sst-prog-obra").value = p.obra_id || "";
  $("sst-prog-revisao").value = p.revisao || ""; $("sst-prog-inicio").value = p.vigencia_inicio || ""; $("sst-prog-fim").value = p.vigencia_fim || "";
  $("sst-prog-resp").value = p.responsavel_tecnico || ""; $("sst-prog-art").value = p.art_numero || ""; $("sst-prog-art-baixada").checked = !!p.art_baixada;
  $("sst-prog-entregue").value = p.entregue_contratante_em || ""; $("sst-prog-valor").value = p.valor ?? ""; $("sst-prog-destino").value = p.custo_destino || "sesmt";
  $("sst-prog-obs").value = p.observacoes || "";
  sstAbrirFichaProgVisual(p);
}
function sstAbrirFichaProgVisual(p){
  $("sst-painel").style.display = "none"; $("sst-ficha-req").style.display = "none"; $("sst-ficha-prog").style.display = "";
  $("sst-prog-titulo").textContent = sstProgEditId ? `${p.requisito?.codigo || "Programa"} · ${p.escopo === "sede" ? "Sede" : (p.obra?.codigo || "obra")}` : "Novo programa legal";
  $("sst-prog-chip-programa").textContent = p.requisito ? p.requisito.codigo : "—";
  $("sst-prog-chip-escopo").textContent = p.escopo === "sede" ? "Sede" : (p.obra ? sstObraRotulo(p.obra) : "Obra");
  $("sst-prog-chip-vigencia").textContent = p.vigencia_fim ? `${dataBR(p.vigencia_inicio)} → ${dataBR(p.vigencia_fim)}` : "—";
  $("sst-prog-chip-situacao").innerHTML = sstProgEditId ? sstProgFarol(p) : "—";
  $("sst-prog-chip-art").textContent = p.art_numero ? `${p.art_numero}${p.art_baixada ? " (baixada)" : ""}` : "—";
  const opera = sstPodeOperar();
  $("btn-sst-prog-salvar").style.display = opera ? "" : "none";
  $("btn-sst-prog-excluir").style.display = opera && sstProgEditId ? "" : "none";
  $("sst-prog-arquivo-bloco").style.display = sstProgEditId ? "" : "none";
  $("sst-prog-arquivo").style.display = opera ? "" : "none";
  sstRenderProgArquivo(p);
  sstAtivarTab("sst-ficha-prog", "sst-prog-notebook", "dados");
}
function sstRenderProgArquivo(p){
  const cont = $("sst-prog-arquivo-atual"); if(!cont) return;
  if(!p.storage_path){ cont.innerHTML = `<p class="vazio">Sem arquivo.</p>`; return; }
  cont.innerHTML = `<p><a href="#" id="sst-prog-abrir">Abrir o arquivo</a> <span class="meta">${esc(p.storage_path.split("/").pop())}</span></p>`;
  $("sst-prog-abrir").addEventListener("click", async (e) => { e.preventDefault(); await sstAbrirArquivo("sst-documentos", p.storage_path); });
}
async function sstAbrirArquivo(bucket, path){
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 60);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não abre este arquivo."), "erro"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
async function salvarSstPrograma(){
  const requisito_id = $("sst-prog-requisito").value; if(!requisito_id){ aviso("app-aviso", "Escolha o programa (requisito de natureza programa).", "erro"); return; }
  const escopo = $("sst-prog-escopo").value; const obra_id = $("sst-prog-obra").value || null;
  if(escopo === "obra" && !obra_id){ aviso("app-aviso", "Programa de obra precisa da obra.", "erro"); return; }
  const obra = _sstObras.find(o => o.id === obra_id);
  const reg = {
    requisito_id, escopo, obra_id: escopo === "obra" ? obra_id : null, cliente_id: escopo === "obra" && obra ? obra.cliente_id : null,
    revisao: $("sst-prog-revisao").value.trim() || null, vigencia_inicio: $("sst-prog-inicio").value || null, vigencia_fim: $("sst-prog-fim").value || null,
    responsavel_tecnico: $("sst-prog-resp").value.trim() || null, art_numero: $("sst-prog-art").value.trim() || null, art_baixada: $("sst-prog-art-baixada").checked,
    entregue_contratante_em: $("sst-prog-entregue").value || null, valor: $("sst-prog-valor").value ? Number(String($("sst-prog-valor").value).replace(",", ".")) : null,
    custo_destino: $("sst-prog-destino").value, observacoes: $("sst-prog-obs").value.trim() || null
  };
  const q = sstProgEditId ? sb.from("sst_programas").update(reg).eq("id", sstProgEditId).select("id") : sb.from("sst_programas").insert(reg).select("id");
  const { data, error } = await q;
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não grava programas legais."), "erro"); return; }
  const id = data?.[0]?.id || sstProgEditId;
  // arquivo (PDF): bucket sst-documentos, pasta = obra (ou o próprio programa, na sede)
  const inp = $("sst-prog-arquivo");
  if(inp && inp.files && inp.files[0] && id){
    const file = inp.files[0];
    try {
      const ext = extensaoArquivo(file); const mime = mimeDoArquivo(file, ext);
      const path = `${reg.obra_id || id}/${sstReqPorId(requisito_id)?.codigo || "PROGRAMA"}/${crypto.randomUUID()}.${ext}`;
      const { error: eUp } = await sb.storage.from("sst-documentos").upload(path, corpoComMime(file, mime), { contentType: mime, upsert: false });
      if(eUp) throw eUp;
      const { error: eUpd } = await sb.from("sst_programas").update({ storage_path: path }).eq("id", id);
      if(eUpd) throw eUpd;
      inp.value = "";
    } catch(err){ aviso("app-aviso", sstErroMsg(err, "Seu perfil não anexa arquivo do SESMT."), "erro"); }
  }
  aviso("app-aviso", "Programa legal salvo.", "ok");
  await carregarSesmt(true);
  sstMostrarPainel();
  if(typeof obraEditId !== "undefined" && obraEditId === reg.obra_id && $("obr-sst-programas")) sstObraProgramasRender(obraEditId);
}
async function excluirSstPrograma(){
  if(!sstProgEditId || !confirm("Excluir este programa legal?")) return;
  const p = _sstProgramas.find(x => x.id === sstProgEditId);
  const { error } = await sb.from("sst_programas").delete().eq("id", sstProgEditId);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não grava programas legais."), "erro"); return; }
  if(p?.storage_path) await sb.storage.from("sst-documentos").remove([p.storage_path]);
  aviso("app-aviso", "Programa excluído.", "ok");
  await carregarSesmt(true);
  sstMostrarPainel();
}
function sstAtivarTab(fichaId, notebookId, nome){
  document.querySelectorAll(`#${notebookId} button`).forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll(`#${fichaId} .odoo-tab`).forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}

/* ---------- ficha da obra: smart-button e bloco "Programas legais" ---------- */
async function sstObraSmartButton(obraId){
  const btn = $("sb-sst"); if(!btn) return;
  const { count, error } = await sb.from("sst_programas").select("id", { count: "exact", head: true }).eq("obra_id", obraId).eq("ativo", true);
  if(typeof obraEditId !== "undefined" && obraId !== obraEditId) return;
  btn.querySelector(".sb-num").textContent = error ? "—" : (count || 0);
  btn.classList.toggle("zero", !count);
}
async function sstObraProgramasRender(obraId){
  const cont = $("obr-sst-programas"); if(!cont || !obraId) return;
  const { data, error } = await sb.from("sst_programas").select("*, requisito:sst_requisitos(codigo,nome)").eq("obra_id", obraId).eq("ativo", true).order("vigencia_fim", { ascending: true, nullsFirst: false });
  if(typeof obraEditId !== "undefined" && obraId !== obraEditId) return;
  if(error){ cont.innerHTML = ""; return; }
  const opera = sstPodeOperar();
  cont.innerHTML = `<div class="card" style="margin-bottom:var(--esp-4);">
    <div class="lista-topo compacta"><h3>Programas legais (SESMT) <span class="contador">${(data || []).length}</span></h3>
      ${opera ? `<button type="button" class="btn-sec btn-sm" id="btn-obr-sst-novo" style="margin-left:auto;">+ Programa legal</button>` : ""}</div>
    ${(data || []).length ? `<div class="tabela-rola"><table><thead><tr><th>Programa</th><th>Revisão</th><th>Vigência</th><th>Situação</th><th>ART (CREA)</th><th>Entregue à contratante</th></tr></thead>
      <tbody>${data.map(p => `<tr class="linha-clicavel" data-id="${esc(p.id)}"><td><strong>${esc(p.requisito?.codigo || "")}</strong> · ${esc(p.requisito?.nome || "")}</td><td>${esc(p.revisao || "—")}</td>
        <td>${dataBR(p.vigencia_inicio)} → ${dataBR(p.vigencia_fim)}</td><td>${/* html */ sstProgFarol(p)}</td><td>${esc(p.art_numero || "—")}${p.art_baixada ? ' <span class="tag cinza">baixada</span>' : ""}</td><td>${dataBR(p.entregue_contratante_em)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vazio">Nenhum programa legal (PGR, PCMSO, LTCAT…) cadastrado para esta obra.</p>`}
  </div>`;
  $("btn-obr-sst-novo")?.addEventListener("click", async () => { if(!irParaSecao("sesmt")) return; await carregarSesmt(false); novoSstPrograma(obraId); });
  cont.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", async () => { if(!irParaSecao("sesmt")) return; await carregarSesmt(false); abrirSstPrograma(tr.dataset.id); }));
}
async function sstAbrirPainelObra(obraId){
  if(!irParaSecao("sesmt")) return;
  await carregarSesmt(false);
  _sstView = "programas"; if($("sst-f-obra")) $("sst-f-obra").value = obraId || "";
  renderSesmt();
}

/* ---------- ficha do funcionário: aba Segurança ---------- */
function sstFichaFuncAplicarVisibilidade(){
  const b = document.querySelector('#func-notebook button[data-tab="seguranca"]');
  if(b) b.style.display = typeof funcEditId !== "undefined" && funcEditId ? "" : "none";
}
async function sstFichaFuncCarregar(){
  const cont = $("func-sst-conteudo"); if(!cont) return;
  const fid = typeof funcEditId !== "undefined" ? funcEditId : null;
  if(!fid){ cont.innerHTML = `<p class="vazio">Salve o funcionário primeiro.</p>`; return; }
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  if(!_sstReqs.length){ const { data } = await sb.from("sst_requisitos").select("*").order("ordem").order("codigo"); _sstReqs = data || []; }
  if(!_sstObras.length){ const { data } = await sb.from("obras").select("id,codigo,nome,cliente_id,status").in("status", ["planejada", "em_andamento", "paralisada"]).order("codigo"); _sstObras = data || []; }
  const obraSel = $("func-sst-obra");
  const obraAtual = obraSel ? obraSel.value : "";
  const le = podeVerSesmt();
  const [sit, docs] = await Promise.all([
    sb.rpc("sst_situacao", { p_funcionarios: [fid], p_obra: obraAtual || null, p_data: hojeISO() }),
    le ? sb.from("funcionario_documentos").select("*").eq("funcionario_id", fid).not("tipo", "like", "admissao\\_%").order("emissao", { ascending: false, nullsFirst: false }) : Promise.resolve({ data: [] })
  ]);
  if(fid !== funcEditId) return;
  _sstFichaFuncDocs = docs.data || [];
  const linhas = sit.data || [];
  const chips = linhas.length ? linhas.map(s => `<div class="chip" title="${esc(s.nome)} · ${esc(s.origem || "")}${s.valido_ate ? " · válido até " + dataBR(s.valido_ate) : ""}"><span>${esc(s.codigo)}</span><strong>${/* html */ sstTagStatus(s.status)}</strong></div>`).join("")
    : `<p class="vazio">Nenhum requisito exigido para a função${obraAtual ? " nesta obra" : ""}: a matriz ainda não cobre esta função (SESMT › Matriz).</p>`;
  const opera = sstPodeGravarDoc();
  const docsHtml = !le ? `<p class="meta">Seu perfil vê só a situação; os arquivos ficam com o SESMT e o RH.</p>` : (_sstFichaFuncDocs.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Requisito</th><th>Descrição</th><th>Número</th><th>Emissão</th><th>Validade</th><th>Origem</th><th>Arquivo</th>${opera ? "<th></th>" : ""}</tr></thead>
      <tbody>${_sstFichaFuncDocs.map((d, i) => { const r = sstReqPorId(d.requisito_id); const dias = sstDiasAte(d.validade); const anterior = _sstFichaFuncDocs.findIndex(x => x.requisito_id === d.requisito_id && d.requisito_id) < i; return `
        <tr class="${anterior ? "meta" : ""}">
          <td><strong>${esc(r ? r.codigo : (d.tipo || "—"))}</strong>${r ? ` <span class="meta">${esc(r.nome)}</span>` : ""}${d.sensivel ? ' <span class="tag cinza" title="Dado de saúde (bucket sst-saude, só com MFA)">saúde</span>' : ""}${anterior ? ' <span class="tag cinza">versão anterior</span>' : ""}</td>
          <td>${esc(d.descricao || "—")}</td><td>${esc(d.numero || "—")}</td><td>${dataBR(d.emissao)}</td>
          <td class="${dias == null ? "" : dias < 0 ? "func-doc-vencido" : dias <= 30 ? "func-doc-vencendo" : "func-doc-ok"}">${dataBR(d.validade)}</td>
          <td>${esc(SST_ORIGEM_DOC[d.origem] || d.origem || "—")}${d.obra_id ? ' <span class="meta">(obra)</span>' : ""}</td>
          <td>${d.storage_path ? `<a href="#" class="sst-doc-abrir" data-i="${i}">Abrir</a>` : (d.arquivo_url ? `<a href="${esc(d.arquivo_url)}" target="_blank" rel="noopener">Link</a>` : "—")}</td>
          ${opera ? `<td class="col-acao"><button type="button" class="btn-sec btn-sm sst-doc-del" data-i="${i}">Excluir</button></td>` : ""}
        </tr>`; }).join("")}</tbody></table></div>` : `<p class="vazio">Nenhum documento de segurança.</p>`);
  const reqOpts = _sstReqs.filter(r => r.ativo && r.natureza !== "programa").map(r => `<option value="${esc(r.id)}" data-sensivel="${r.sensivel ? 1 : 0}">${esc(r.codigo)} · ${esc(r.nome)}${r.sensivel ? " (saúde, exige MFA)" : ""}</option>`).join("");
  cont.innerHTML = `
    <div class="serv-filtros" style="margin-bottom:var(--esp-3);">
      <select id="func-sst-obra" title="Situação na obra: entram método, equipamento, cliente e requisitos da obra"><option value="">Situação geral (função e GHE)</option>${_sstObras.map(o => `<option value="${esc(o.id)}" ${o.id === obraAtual ? "selected" : ""}>${esc(sstObraRotulo(o))}</option>`).join("")}</select>
      ${opera ? `<button type="button" class="btn-sec" id="btn-func-sst-novo" style="margin-left:auto;">+ Documento</button>` : ""}
    </div>
    <div class="odoo-contexto" style="flex-wrap:wrap;">${/* html */ chips}</div>
    <div id="func-sst-form" style="display:none;" class="func-doc-inline-form">
      <div class="grade">
        <div class="campo largo"><label>Requisito *</label><select id="func-sst-req">${/* html */ reqOpts}</select></div>
        <div class="campo"><label>Emissão</label><input id="func-sst-emissao" type="date" /></div>
        <div class="campo"><label>Validade <span class="meta">(vazio = pela validade do requisito/matriz)</span></label><input id="func-sst-validade" type="date" /></div>
        <div class="campo"><label>Número / certificado</label><input id="func-sst-numero" /></div>
        <div class="campo"><label>Descrição</label><input id="func-sst-desc" placeholder="ex.: reciclagem 2026, centro de treinamento X" /></div>
        <div class="campo"><label>Só para a obra <span class="meta">(ex.: OS no modelo do cliente)</span></label><select id="func-sst-doc-obra"><option value="">— vale para toda obra</option>${_sstObras.map(o => `<option value="${esc(o.id)}">${esc(sstObraRotulo(o))}</option>`).join("")}</select></div>
        <div class="campo largo"><label>Arquivo (PDF, JPG ou PNG, até 20 MB)</label><input id="func-sst-arquivo" type="file" accept="application/pdf,image/jpeg,image/png" /></div>
      </div>
      <div class="form-acoes"><button type="button" class="btn" id="btn-func-sst-salvar">Salvar documento</button><button type="button" class="btn-sec" id="btn-func-sst-cancelar">Cancelar</button></div>
    </div>
    <h4 style="margin:var(--esp-4) 0 var(--esp-2);">Documentos de segurança</h4>
    ${/* html */ docsHtml}`;
  $("func-sst-obra").addEventListener("change", sstFichaFuncCarregar);
  $("btn-func-sst-novo")?.addEventListener("click", () => { $("func-sst-form").style.display = ""; });
  $("btn-func-sst-cancelar")?.addEventListener("click", () => { $("func-sst-form").style.display = "none"; });
  $("btn-func-sst-salvar")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, () => sstFichaFuncSalvarDoc(fid)));
  cont.querySelectorAll(".sst-doc-abrir").forEach(a => a.addEventListener("click", async (e) => { e.preventDefault(); const d = _sstFichaFuncDocs[Number(a.dataset.i)]; if(d) await sstAbrirArquivo(d.sensivel ? "sst-saude" : "sst-documentos", d.storage_path); }));
  cont.querySelectorAll(".sst-doc-del").forEach(b => b.addEventListener("click", () => sstFichaFuncExcluirDoc(_sstFichaFuncDocs[Number(b.dataset.i)])));
}
async function sstFichaFuncSalvarDoc(fid){
  const reqId = $("func-sst-req").value; const r = sstReqPorId(reqId);
  if(!r){ aviso("app-aviso", "Escolha o requisito.", "erro"); return; }
  if(r.sensivel && !(await sstSessaoAal2())){ aviso("app-aviso", "Documento de saúde (ASO, exame) exige sessão com MFA: entre de novo com o autenticador.", "erro"); return; }
  const inp = $("func-sst-arquivo"); const file = inp.files && inp.files[0];
  if(file && file.size > 20971520){ aviso("app-aviso", "Arquivo maior que 20 MB.", "erro"); return; }
  const bucket = r.sensivel ? "sst-saude" : "sst-documentos";
  let path = null;
  if(file){
    const ext = extensaoArquivo(file); const mime = mimeDoArquivo(file, ext);
    path = `${fid}/${r.codigo}/${crypto.randomUUID()}.${ext}`;
    const { error: eUp } = await sb.storage.from(bucket).upload(path, corpoComMime(file, mime), { contentType: mime, upsert: false });
    if(eUp){ aviso("app-aviso", sstErroMsg(eUp, r.sensivel ? "Só SESMT e RH com MFA guardam documento de saúde." : "Seu perfil não anexa documento de segurança."), "erro"); return; }
  }
  const reg = {
    funcionario_id: fid, tipo: "outro", requisito_id: reqId, descricao: $("func-sst-desc").value.trim() || null, numero: $("func-sst-numero").value.trim() || null,
    emissao: $("func-sst-emissao").value || null, validade: $("func-sst-validade").value || null, obra_id: $("func-sst-doc-obra").value || null,
    storage_path: path, origem: "manual"
  };
  const { error } = await sb.from("funcionario_documentos").insert(reg);
  if(error){
    if(path) await sb.storage.from(bucket).remove([path]);
    aviso("app-aviso", sstErroMsg(error, r.sensivel ? "Só SESMT e RH com MFA gravam documento de saúde." : "Seu perfil não grava documento de segurança."), "erro"); return;
  }
  aviso("app-aviso", "Documento salvo.", "ok");
  _sstSituacao = null;
  await sstFichaFuncCarregar();
  if(typeof carregarDocsFuncionario === "function") carregarDocsFuncionario();
}
async function sstFichaFuncExcluirDoc(d){
  if(!d || !confirm("Excluir este documento (e o arquivo)?")) return;
  const { error } = await sb.from("funcionario_documentos").delete().eq("id", d.id);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não exclui documento de segurança."), "erro"); return; }
  if(d.storage_path) await sb.storage.from(d.sensivel ? "sst-saude" : "sst-documentos").remove([d.storage_path]);
  _sstSituacao = null;
  await sstFichaFuncCarregar();
  if(typeof carregarDocsFuncionario === "function") carregarDocsFuncionario();
}

/* ---------- ligação ---------- */
function ligarSesmt(){
  if(!$("sec-sesmt")) return;
  document.querySelector('nav button[data-secao="sesmt"]')?.addEventListener("click", () => carregarSesmt(false));
  document.querySelectorAll("#sst-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _sstView = b.dataset.view; renderSesmt(); }));
  $("sst-busca")?.addEventListener("input", debounce(renderSesmt));
  ["sst-f-depto", "sst-f-funcao", "sst-f-ghe", "sst-f-obra", "sst-f-natureza", "sst-f-status"].forEach(id => $(id)?.addEventListener("change", renderSesmt));
  $("btn-sst-atualizar")?.addEventListener("click", () => carregarSesmt(true));
  $("btn-sst-novo-req")?.addEventListener("click", novoSstRequisito);
  $("btn-sst-novo-prog")?.addEventListener("click", () => novoSstPrograma(null));
  $("btn-sst-exportar")?.addEventListener("click", sstExportarMatriz);
  $("btn-sst-importar")?.addEventListener("click", () => $("sst-importar-arquivo")?.click());
  $("sst-importar-arquivo")?.addEventListener("change", async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if(f){ _sstView = "matriz"; renderSesmt(); await sstImportarMatriz(f); } });
  // ficha do requisito
  $("btn-sst-req-voltar")?.addEventListener("click", () => { sstMostrarPainel(); renderSesmt(); });
  $("btn-sst-req-salvar")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, salvarSstRequisito));
  $("btn-sst-req-excluir")?.addEventListener("click", excluirSstRequisito);
  document.querySelectorAll("#sst-req-notebook button").forEach(b => b.addEventListener("click", () => sstAtivarTab("sst-ficha-req", "sst-req-notebook", b.dataset.tab)));
  $("sst-req-natureza")?.addEventListener("change", () => { if($("sst-req-natureza").value === "exame"){ $("sst-req-sensivel").checked = true; $("sst-req-grupo").value = "saude"; } });
  // ficha do programa
  $("btn-sst-prog-voltar")?.addEventListener("click", () => { sstMostrarPainel(); renderSesmt(); });
  $("btn-sst-prog-salvar")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, salvarSstPrograma));
  $("btn-sst-prog-excluir")?.addEventListener("click", excluirSstPrograma);
  document.querySelectorAll("#sst-prog-notebook button").forEach(b => b.addEventListener("click", () => sstAtivarTab("sst-ficha-prog", "sst-prog-notebook", b.dataset.tab)));
  $("sst-prog-escopo")?.addEventListener("change", () => { if($("sst-prog-escopo").value === "sede") $("sst-prog-obra").value = ""; });
  $("sst-prog-obra")?.addEventListener("change", () => { $("sst-prog-escopo").value = $("sst-prog-obra").value ? "obra" : "sede"; });
  // ficha do funcionário: aba Segurança
  document.querySelector('#func-notebook button[data-tab="seguranca"]')?.addEventListener("click", sstFichaFuncCarregar);
  // ficha da obra: smart-button → painel SESMT filtrado pela obra
  $("sb-sst")?.addEventListener("click", () => { if(typeof obraEditId !== "undefined" && obraEditId) sstAbrirPainelObra(obraEditId); });
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarSesmt);
} else {
  ligarSesmt();
}

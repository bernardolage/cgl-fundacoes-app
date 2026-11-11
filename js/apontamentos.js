/* ====================================================================
   Módulo: Apontamentos da oficina (fase 156a, #262, 10/11/2026)
   Horas de RP (reparo), OS (manutenção) e OF (fabricação) numa tela só. Cada linha grava na tabela de horas do
   próprio documento (reparo_horas, manutencao_horas, fabricacao_horas), pela policy dela: a tela não abre permissão
   nova. Sábado, domingo e feriado não gravam direto: vão para apontamento_aprovacoes e só entram (e viram custo)
   quando o responsável do setor aprova (RPC apontamento_aprovar). OS = gestor de manutenção; RP e OF = gestor de
   acessórios; o diretor aprova qualquer uma; quem lançou nunca aprova a própria.
   Documento concluído ou cancelado não aceita hora pela tela única. Prefixo: apt-.
   ==================================================================== */

let _aptHoras = [];        // vw_apontamentos no período
let _aptAprov = [];        // apontamento_aprovacoes (aguardando + decididas no período)
let _aptDocs = [];         // documentos abertos (para a busca da grade)
let _aptDocNum = {};       // id → { tipo, numero, status, equipamento } (abertos e os que aparecem nas aprovações)
let _aptFuncs = [];        // funcionários ativos
let _aptCentros = [];      // centros de trabalho ativos
let _aptGrade = [];        // linhas da grade de lançamento
let _aptView = "horas";
let _aptDiaAprov = {};     // data → exige aprovação (cache do apontamento_dia_aprovacao)
let _aptAtiv = {};         // manutencao_id → atividades pendentes da OS

const APT_TIPO = {
  RP: { rotulo: "RP (reparo)", tabela: "reparo_horas", col: "reparo_id", secao: "reparos" },
  OS: { rotulo: "OS (manutenção)", tabela: "manutencao_horas", col: "manutencao_id", secao: "manutencao" },
  OF: { rotulo: "OF (fabricação)", tabela: "fabricacao_horas", col: "ordem_id", secao: "fabricacao" }
};
const APT_STATUS_DOC = { aberto: "aberto", em_execucao: "em execução", concluido: "concluído", cancelado: "cancelado",
  agendada: "agendada", em_andamento: "em andamento", concluida: "concluída", cancelada: "cancelada",
  rascunho: "rascunho", planejada: "planejada", confirmada: "confirmada", em_producao: "em produção", pausada: "pausada" };
const APT_DOC_ABERTO = { RP: ["aberto", "em_execucao"], OS: ["agendada", "em_andamento"], OF: ["rascunho", "planejada", "confirmada", "em_producao", "pausada"] };
const APT_DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/* Quem grava hora em cada tipo: espelha as policies de reparo_horas, manutencao_horas (manutencao_pode_operar) e
   fabricacao_horas (fabricacao_pode_operar). Listas em core.js (APT_CARGOS_GRAVAM), usadas também pelo menu. */
function aptPodeGravar(tipo){
  if(!usuarioAtual || ehSomenteLeitura()) return false;
  return (APT_CARGOS_GRAVAM[tipo] || []).includes(usuarioAtual.cargo);
}
function aptPodeLancar(){ return ["RP", "OS", "OF"].some(aptPodeGravar); }
/* Quem decide a hora de fim de semana: espelha apontamento_conferir_decisor (has_role cobre o diretor) */
function aptPodeDecidir(a){
  if(!usuarioAtual || ehSomenteLeitura() || !a || a.status !== "aguardando" || a.lancado_por === usuarioAtual.id) return false;
  if(usuarioAtual.cargo === "diretor") return true;
  return a.tipo === "OS" ? usuarioAtual.cargo === "gestor_manutencao" : usuarioAtual.cargo === "gestor_acessorios";
}

function aptDiaSemana(d){ return d ? APT_DIA_SEMANA[new Date(d + "T12:00:00").getDay()] : ""; }
function aptHora(t){ return t ? String(t).slice(0, 5) : ""; }
function aptNomeFunc(id){ return (_aptFuncs.find(f => f.id === id) || {}).nome || ""; }
function aptStatusDoc(s){ return APT_STATUS_DOC[s] || String(s || "").replace(/_/g, " "); }
function aptRotuloDoc(d){
  return [d.numero, d.equipamento, d.codigo_externo && d.codigo_externo !== d.numero ? d.codigo_externo : null, d.descricao ? d.descricao.slice(0, 40) : null]
    .filter(Boolean).join(" · ");
}

/* ---------- carga ---------- */
async function carregarApontamentos(){
  if(!$("apt-de").value){ $("apt-de").value = hojeISO(); $("apt-ate").value = hojeISO(); }
  $("btn-apt-lancar").style.display = aptPodeLancar() ? "" : "none";
  $("apt-conteudo").innerHTML = `<p class="vazio">Carregando…</p>`;
  await aptCarregarCadastros();
  const fSel = $("apt-func"), fVal = fSel.value;
  preencherSelect(fSel, _aptFuncs, "id", "nome", "Todos os funcionários"); fSel.value = fVal;
  await Promise.all([aptCarregarHoras(), aptCarregarAprovacoes()]);
  aptRender();
}
/* funcionários e centros de trabalho; erro de leitura vira aviso (antes a lista vinha vazia sem dizer nada) e a próxima
   abertura da grade tenta de novo */
async function aptCarregarCadastros(){
  const [f, c] = await Promise.all([
    _aptFuncs.length ? { data: _aptFuncs } : lerTudo(() => sb.from("funcionarios").select("id,nome,funcao").eq("ativo", true), "id"),
    _aptCentros.length ? { data: _aptCentros } : sb.from("centros_trabalho").select("id,nome,setor,ativo,ordem").eq("ativo", true).order("ordem").order("nome")
  ]);
  if(f.error) aviso("app-aviso", "Não foi possível carregar a lista de funcionários: " + f.error.message + ". Clique em Atualizar.", "erro");
  else _aptFuncs = (f.data || []).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  if(c.error) aviso("app-aviso", "Não foi possível carregar os centros de trabalho: " + c.error.message + ". Clique em Atualizar.", "erro");
  else _aptCentros = c.data || [];
}
async function aptCarregarHoras(){
  const de = $("apt-de").value || hojeISO(), ate = $("apt-ate").value || de, tipo = $("apt-tipo").value, func = $("apt-func").value;
  const { data, error } = await lerTudo(() => {
    let q = sb.from("vw_apontamentos").select("*").gte("data", de).lte("data", ate);
    if(tipo) q = q.eq("tipo", tipo);
    if(func) q = q.eq("funcionario_id", func);
    return q;
  }, ["data", "id"]);
  if(error){ aviso("app-aviso", "Não foi possível carregar as horas: " + error.message, "erro"); _aptHoras = []; return; }
  _aptHoras = data;
}
async function aptCarregarAprovacoes(){
  const de = $("apt-de").value || hojeISO(), ate = $("apt-ate").value || de;
  const sel = "*, lancado:profiles!apontamento_aprovacoes_lancado_por_fkey(nome), decidido:profiles!apontamento_aprovacoes_decidido_por_fkey(nome)";
  const [ag, dec] = await Promise.all([
    lerTudo(() => sb.from("apontamento_aprovacoes").select(sel).eq("status", "aguardando"), "id"),
    lerTudo(() => sb.from("apontamento_aprovacoes").select(sel).neq("status", "aguardando").gte("data", de).lte("data", ate), "id")
  ]);
  if(ag.error || dec.error){ aviso("app-aviso", "Não foi possível carregar as aprovações: " + (ag.error || dec.error).message, "erro"); _aptAprov = []; return; }
  _aptAprov = ag.data.concat(dec.data);
  await aptNumerosDocs(_aptAprov.map(a => ({ tipo: a.tipo, id: a.documento_id })));
}
/* número e status dos documentos citados nas aprovações (aberto ou não) */
async function aptNumerosDocs(lista){
  const falta = { RP: [], OS: [], OF: [] };
  lista.forEach(x => { if(!_aptDocNum[x.id] && !falta[x.tipo].includes(x.id)) falta[x.tipo].push(x.id); });
  const tab = { RP: "reparos_caldeiraria", OS: "manutencoes", OF: "ordens_fabricacao" };
  await Promise.all(Object.keys(falta).filter(t => falta[t].length).map(async t => {
    for(let i = 0; i < falta[t].length; i += 200){
      const { data } = await sb.from(tab[t]).select("id,numero,status").in("id", falta[t].slice(i, i + 200));
      (data || []).forEach(d => { _aptDocNum[d.id] = { tipo: t, numero: d.numero, status: d.status }; });
    }
  }));
}
/* documentos abertos para a busca da grade: número do app, código do Odoo e TAG */
async function aptCarregarDocs(){
  const eq = "equipamento:equipamentos!{T}_equipamento_id_fkey(codigo)";
  const ac = "acessorio:acessorios!{T}_acessorio_id_fkey(marcacao)";
  const [rp, os, of] = await Promise.all([
    lerTudo(() => sb.from("reparos_caldeiraria").select(`id,numero,status,codigo_externo,descricao,${eq.replace("{T}", "reparos_caldeiraria")},${ac.replace("{T}", "reparos_caldeiraria")}`).in("status", APT_DOC_ABERTO.RP), "id"),
    lerTudo(() => sb.from("manutencoes").select(`id,numero,status,codigo_externo,descricao,${eq.replace("{T}", "manutencoes")},${ac.replace("{T}", "manutencoes")}`).in("status", APT_DOC_ABERTO.OS), "id"),
    lerTudo(() => sb.from("ordens_fabricacao").select(`id,numero,status,codigo_externo,descricao,${eq.replace("{T}", "ordens_fabricacao")}`).in("status", APT_DOC_ABERTO.OF), "id")
  ]);
  const erro = rp.error || os.error || of.error;
  if(erro){ aviso("app-aviso", "Não foi possível carregar os documentos abertos: " + erro.message, "erro"); return; }
  const norm = (t, d) => ({ tipo: t, id: d.id, numero: d.numero, status: d.status, codigo_externo: d.codigo_externo, descricao: d.descricao,
    equipamento: d.equipamento?.codigo || d.acessorio?.marcacao || "" });
  _aptDocs = rp.data.map(d => norm("RP", d)).concat(os.data.map(d => norm("OS", d)), of.data.map(d => norm("OF", d)))
    .filter(d => aptPodeGravar(d.tipo)).sort((a, b) => String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true }));
  _aptDocs.forEach(d => { _aptDocNum[d.id] = d; });
  $("apt-docs").innerHTML = _aptDocs.map(d => `<option value="${esc(aptRotuloDoc(d))}"></option>`).join("");
}

/* ---------- painel ---------- */
function aptRender(){
  const nAg = _aptAprov.filter(a => a.status === "aguardando").length;
  $("apt-n-aguardando").textContent = nAg ? `(${nAg})` : "";
  document.querySelectorAll("#apt-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _aptView));
  if(_aptView === "aprovacao") aptRenderAprovacoes(); else aptRenderHoras();
}
function aptFiltroBusca(txt){
  const b = ($("apt-busca").value || "").trim().toLowerCase();
  return !b || String(txt || "").toLowerCase().includes(b);
}
function aptRenderHoras(){
  const linhas = _aptHoras.filter(h => aptFiltroBusca([h.numero, h.equipamento, h.funcionario, h.observacao, h.centro].join(" ")))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(a.funcionario || "").localeCompare(String(b.funcionario || ""), "pt-BR") || String(a.inicio || "").localeCompare(String(b.inicio || "")));
  $("apt-contador").textContent = `(${linhas.length})`;
  // total de horas por funcionário e dia, sem R$
  const tot = {};
  linhas.forEach(h => { const k = (h.funcionario || "sem funcionário") + "|" + h.data; tot[k] = (tot[k] || 0) + Number(h.horas || 0); });
  const totTxt = Object.entries(tot).sort((a, b) => a[0].localeCompare(b[0], "pt-BR")).map(([k, v]) => {
    const [n, d] = k.split("|"); return `${esc(n)} ${esc(dataBR(d))}: <strong>${esc(num(v))} h</strong>`; });
  $("apt-totais").innerHTML = totTxt.length ? `Total por funcionário e dia: ${/* html */ totTxt.join(" · ")}` : "";
  if(!linhas.length){ $("apt-conteudo").innerHTML = `<p class="vazio">Nenhuma hora lançada no período.</p>`; return; }
  $("apt-conteudo").innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Documento</th><th>TAG</th><th>Funcionário</th><th>Início</th><th>Fim</th><th class="num">Horas</th><th>Observação</th><th>Origem</th></tr></thead><tbody>
    ${linhas.map(h => `<tr><td>${esc(dataBR(h.data))} <span class="meta">${esc(aptDiaSemana(h.data))}</span></td>
      <td><a href="#" class="apt-abrir-doc" data-tipo="${esc(h.tipo)}" data-id="${esc(h.documento_id)}">${esc(h.numero || h.tipo)}</a>${["concluido", "concluida", "cancelado", "cancelada"].includes(h.documento_status) ? ` <span class="tag cinza">${esc(aptStatusDoc(h.documento_status))}</span>` : ""}</td>
      <td>${esc(h.equipamento || "—")}</td><td>${esc(h.funcionario || "—")}</td><td>${esc(aptHora(h.inicio))}</td><td>${esc(aptHora(h.fim))}</td>
      <td class="num">${esc(num(h.horas))}${h.hora_extra ? ' <span class="tag ambar" title="hora extra">HE</span>' : ""}</td>
      <td>${esc(h.observacao || "")}${h.centro ? ` <span class="meta">${esc(h.centro)}</span>` : ""}</td>
      <td class="meta">${esc({ ficha: "ficha", apontamento: "apontamento", quadro: "quadro" }[h.origem] || h.origem || "")}</td></tr>`).join("")}
  </tbody></table></div>`;
}
function aptRenderAprovacoes(){
  const tipo = $("apt-tipo").value, func = $("apt-func").value;
  const linhas = _aptAprov.filter(a => (!tipo || a.tipo === tipo) && (!func || a.funcionario_id === func)
      && aptFiltroBusca([_aptDocNum[a.documento_id]?.numero, aptNomeFunc(a.funcionario_id), a.observacao].join(" ")))
    .sort((a, b) => (a.status === "aguardando" ? 0 : 1) - (b.status === "aguardando" ? 0 : 1) || String(a.data).localeCompare(String(b.data)));
  $("apt-contador").textContent = `(${linhas.length})`;
  $("apt-totais").innerHTML = `Sábado, domingo e feriado só entram na ficha do documento (e no custo) depois de aprovados. OS: gestor de manutenção; RP e OF: gestor de acessórios.`;
  if(!linhas.length){ $("apt-conteudo").innerHTML = `<p class="vazio">Nenhuma hora aguardando aprovação.</p>`; return; }
  const algumDecide = linhas.some(aptPodeDecidir);
  const tagSt = { aguardando: "ambar", aprovada: "verde", recusada: "vermelho" };
  $("apt-conteudo").innerHTML = `${algumDecide ? `<div class="form-acoes" style="justify-content:flex-start;margin-bottom:8px;">
      <button type="button" class="btn" id="btn-apt-aprovar-lote">Aprovar selecionadas</button>
      <button type="button" class="btn-sec txt-perigo" id="btn-apt-recusar-lote">Recusar selecionadas</button></div>` : ""}
    <div class="tabela-rola"><table><thead><tr>${algumDecide ? '<th class="col-acao"><input type="checkbox" id="apt-sel-todas" aria-label="selecionar todas" /></th>' : ""}<th>Data</th><th>Documento</th><th>Funcionário</th><th>Início</th><th>Fim</th><th>Observação</th><th>Lançado por</th><th>Situação</th><th class="col-acao"></th></tr></thead><tbody>
    ${linhas.map(a => {
      const d = _aptDocNum[a.documento_id] || {}, pode = aptPodeDecidir(a);
      const meu = usuarioAtual && a.lancado_por === usuarioAtual.id && a.status === "aguardando";
      return `<tr>${algumDecide ? `<td>${pode ? `<input type="checkbox" class="apt-sel" data-id="${esc(a.id)}" aria-label="selecionar" />` : ""}</td>` : ""}
        <td>${esc(dataBR(a.data))} <span class="meta">${esc(aptDiaSemana(a.data))}</span></td>
        <td><a href="#" class="apt-abrir-doc" data-tipo="${esc(a.tipo)}" data-id="${esc(a.documento_id)}">${esc(d.numero || a.tipo)}</a></td>
        <td>${esc(aptNomeFunc(a.funcionario_id) || "—")}</td><td>${esc(aptHora(a.inicio))}</td><td>${esc(aptHora(a.fim))}</td>
        <td>${esc(a.observacao || "")}${a.hora_extra ? ' <span class="tag ambar">HE</span>' : ""}</td>
        <td>${esc(a.lancado?.nome || "—")}</td>
        <td><span class="tag ${esc(tagSt[a.status] || "cinza")}">${esc(a.status)}</span>${a.decidido?.nome ? ` <span class="meta">${esc(a.decidido.nome)}</span>` : ""}${a.motivo_recusa ? `<div class="meta">${esc(a.motivo_recusa)}</div>` : ""}</td>
        <td>${pode ? `<button type="button" class="btn-sec btn-sm apt-aprovar" data-id="${esc(a.id)}">Aprovar</button> <button type="button" class="btn-sec btn-sm txt-perigo apt-recusar" data-id="${esc(a.id)}">Recusar</button>`
          : meu ? `<button type="button" class="btn-sec btn-sm apt-desfazer" data-id="${esc(a.id)}" title="apagar o lançamento enquanto espera">Desfazer</button>` : ""}</td></tr>`; }).join("")}
  </tbody></table></div>`;
}
async function aptAprovar(ids){
  let ok = 0; const erros = [];
  for(const id of ids){
    const { error } = await sb.rpc("apontamento_aprovar", { p_id: id });
    if(error) erros.push(error.message); else ok++;
  }
  aviso("app-aviso", erros.length ? `${ok} aprovada(s); ${erros.length} não: ${erros.join(" | ")}` : `${ok} aprovada(s): as horas entraram na ficha do documento.`, erros.length ? "erro" : "ok");
  await aptCarregarAprovacoes(); await aptCarregarHoras(); aptRender();
}
async function aptRecusar(ids){
  const motivo = prompt(`Recusar ${ids.length} hora(s) de fim de semana ou feriado.\n\nMotivo (obrigatório; quem lançou vê):`, "");
  if(motivo === null) return;
  if(!motivo.trim()){ aviso("app-aviso", "Informe o motivo da recusa.", "erro"); return; }
  let ok = 0; const erros = [];
  for(const id of ids){
    const { error } = await sb.rpc("apontamento_recusar", { p_id: id, p_motivo: motivo.trim() });
    if(error) erros.push(error.message); else ok++;
  }
  aviso("app-aviso", erros.length ? `${ok} recusada(s); ${erros.length} não: ${erros.join(" | ")}` : `${ok} recusada(s).`, erros.length ? "erro" : "ok");
  await aptCarregarAprovacoes(); aptRender();
}
async function aptDesfazer(id){
  const { error } = await sb.from("apontamento_aprovacoes").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível desfazer: " + error.message, "erro"); return; }
  await aptCarregarAprovacoes(); aptRender();
}
function aptAbrirDoc(tipo, id){
  const t = APT_TIPO[tipo]; if(!t || !irParaSecao(t.secao)) return;
  if(tipo === "RP" && typeof abrirReparo === "function") abrirReparo(id);
  else if(tipo === "OS" && typeof abrirManutencao === "function") abrirManutencao(id);
  else if(tipo === "OF" && typeof abrirOrdemFabricacao === "function") abrirOrdemFabricacao(id);
}
/* atalho do "Para regularizar" (dashboard.js) */
async function aptAbrirAguardando(filtro){
  _aptView = "aprovacao";
  $("apt-tipo").value = filtro === "aprovacao_os" ? "OS" : "";
  await carregarApontamentos();
}

/* ---------- grade de lançamento ---------- */
function aptLinhaNova(base){
  return { doc: null, docTxt: "", funcionario_id: base?.funcionario_id || "", data: base?.data || $("apt-de").value || hojeISO(),
    inicio: "", fim: "", observacao: "", centro_trabalho_id: base?.centro_trabalho_id || "", hora_extra: false,
    atividade_id: "", concluir_atividade: false, estado: "", msg: "", existente: null };
}
async function aptAbrirGrade(){
  $("apt-grade-box").style.display = "";
  if(!_aptDocs.length) await aptCarregDocsComAviso();
  if(!_aptFuncs.length || !_aptCentros.length) await aptCarregarCadastros();
  if(!_aptGrade.length) _aptGrade = [aptLinhaNova(), aptLinhaNova(), aptLinhaNova()];
  aptRenderGrade();
}
async function aptCarregDocsComAviso(){
  $("apt-grade").innerHTML = `<tr><td colspan="9" class="vazio">Carregando documentos abertos…</td></tr>`;
  await aptCarregarDocs();
}
/* "RP 734", "RP-2026-00734", "OS 1410", código do Odoo ou o rótulo escolhido na lista → documento */
async function aptResolverDoc(txt){
  const t = String(txt || "").trim(); if(!t) return { doc: null };
  if(!_aptDocs.length) await aptCarregarDocs();   // "Atualizar" com a grade aberta esvazia a lista
  const porRotulo = _aptDocs.find(d => aptRotuloDoc(d) === t);
  if(porRotulo) return { doc: porRotulo };
  const up = t.toUpperCase().replace(/\s+/g, " ");
  const exato = _aptDocs.filter(d => String(d.numero).toUpperCase() === up || String(d.codigo_externo || "").toUpperCase() === up);
  if(exato.length === 1) return { doc: exato[0] };
  const m = up.match(/^(RP|OS|OF|OR|OP)?[\s-]*(?:(\d{4})[\s-]+)?0*(\d{1,6})$/);
  if(m){
    const tipos = m[1] === "RP" || m[1] === "OS" || m[1] === "OF" ? [m[1]] : ["RP", "OS", "OF"];   // OR/OP do quadro antigo: qualquer tipo
    const casa = d => { const p = String(d.numero || "").match(/^(\w+)-(\d{4})-0*(\d+)$/); return p && tipos.includes(d.tipo) && Number(p[3]) === Number(m[3]) && (!m[2] || p[2] === m[2]); };
    const abertos = _aptDocs.filter(casa), comPrefixo = tipos.length === 1;
    if(abertos.length === 1 && comPrefixo) return { doc: abertos[0] };
    if(abertos.length > 1) return { doc: null, msg: `Mais de um documento possível (${abertos.map(d => d.numero).join(", ")}): escolha na lista.` };
    if(abertos.length === 1) return { doc: null, msg: `Sem o prefixo RP, OS ou OF o número não basta (candidato: ${abertos[0].numero}): escolha na lista.` };
    // nenhum aberto: procura fechado para dizer o porquê
    const fechado = await aptProcurarFechado(tipos, m[3], m[2]);
    if(fechado && aptDocAberto(fechado))
      return { doc: null, msg: `${fechado.numero} está aberto, mas não está na sua lista: seu perfil não lança hora nesse documento.` };
    if(fechado && !comPrefixo)
      return { doc: null, msg: `Sem o prefixo RP, OS ou OF o número não basta (achado: ${fechado.numero}, ${aptStatusDoc(fechado.status)}): escolha na lista.` };
    if(fechado) return { doc: fechado };
  }
  return { doc: null, msg: "Documento não encontrado entre os abertos que você pode lançar." };
}
async function aptProcurarFechado(tipos, numero, ano){
  const tab = { RP: "reparos_caldeiraria", OS: "manutencoes", OF: "ordens_fabricacao" };
  for(const t of tipos){
    const n = String(numero).padStart(5, "0");
    const { data } = await sb.from(tab[t]).select("id,numero,status").like("numero", `${t}-${ano || "____"}-${n}`).order("numero", { ascending: false }).range(0, 0);
    if(data && data[0]) return { tipo: t, id: data[0].id, numero: data[0].numero, status: data[0].status, equipamento: "" };
  }
  return null;
}
function aptDocAberto(d){ return !!d && (APT_DOC_ABERTO[d.tipo] || []).includes(d.status); }
async function aptCarregarAtividades(manId){
  if(_aptAtiv[manId]) return;
  const { data } = await sb.from("manutencao_atividades").select("id,ordem,atividade,situacao").eq("manutencao_id", manId).eq("situacao", "pendente").order("ordem");
  _aptAtiv[manId] = data || [];
}
/* sugestão da atividade pela observação digitada: a de mais palavras em comum (marcar como executada é escolha de quem aponta) */
function aptSugerirAtividade(l){
  const ativ = l.doc?.tipo === "OS" ? (_aptAtiv[l.doc.id] || []) : [];
  const pal = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 3);
  const obs = new Set(pal(l.observacao)); if(!obs.size) return "";
  let melhor = "", pontos = 0;
  ativ.forEach(a => { const n = pal(a.atividade).filter(w => obs.has(w)).length; if(n > pontos){ pontos = n; melhor = a.id; } });
  return melhor;
}
function aptRenderGrade(){
  const funcs = `<option value="">— funcionário —</option>` + _aptFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
  const centros = `<option value="">— centro de trabalho * —</option>` + _aptCentros.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  const tagEst = { gravada: "verde", aguardando: "ambar", recusada: "vermelho", repetida: "cinza" };
  $("apt-grade").innerHTML = _aptGrade.map((l, i) => {
    const d = l.doc;
    let extra = "";
    const he = d ? `<label class="meta" title="hora extra, custa ×2; sábado, domingo e feriado vêm marcados"><input type="checkbox" data-i="${i}" data-c="hora_extra" ${l.hora_extra ? "checked" : ""} /> HE</label>` : "";
    if(d?.tipo === "OF") extra = `<select data-i="${i}" data-c="centro_trabalho_id">${/* html */ centros}</select>
      ${/* html */ he}`;
    else if(d?.tipo === "OS"){
      const at = _aptAtiv[d.id] || [];
      extra = at.length ? `<select data-i="${i}" data-c="atividade_id" title="atividade da OS (sugerida pela observação)"><option value="">— atividade da OS —</option>${at.map(a => `<option value="${esc(a.id)}">${esc(a.atividade)}</option>`).join("")}</select>
        <label class="meta"><input type="checkbox" data-i="${i}" data-c="concluir_atividade" ${l.concluir_atividade ? "checked" : ""} /> marcar executada</label>` : `<span class="meta">sem atividade pendente</span>`;
      extra += ` ${/* html */ he}`;
    } else if(d?.tipo === "RP") extra = he;
    const docInfo = d ? `<div class="meta">${esc(APT_TIPO[d.tipo].rotulo)}${d.equipamento ? " · " + esc(d.equipamento) : ""}${aptDocAberto(d) ? "" : ` · <span class="txt-perigo">${esc(aptStatusDoc(d.status))}</span>`}</div>` : "";
    return `<tr data-i="${i}">
      <td><input list="apt-docs" data-i="${i}" data-c="docTxt" value="${esc(l.docTxt)}" placeholder="RP 734, OS 1410, TAG…" style="min-width:200px;" />${/* html */ docInfo}</td>
      <td><select data-i="${i}" data-c="funcionario_id">${/* html */ funcs}</select></td>
      <td><input type="date" data-i="${i}" data-c="data" value="${esc(l.data)}" /></td>
      <td><input type="time" data-i="${i}" data-c="inicio" value="${esc(l.inicio)}" /></td>
      <td><input type="time" data-i="${i}" data-c="fim" value="${esc(l.fim)}" /></td>
      <td><input data-i="${i}" data-c="observacao" value="${esc(l.observacao)}" placeholder="atividade" /></td>
      <td>${/* html */ extra}</td>
      <td>${l.estado ? `<span class="tag ${esc(tagEst[l.estado] || "cinza")}">${esc({ gravada: "gravada", aguardando: "aguardando aprovação", recusada: "não gravou", repetida: "já lançada" }[l.estado])}</span>` : ""}
        ${l.msg ? `<div class="meta">${esc(l.msg)}</div>` : ""}
        ${l.estado === "repetida" && l.existente && aptHora(l.existente.fim) !== l.fim ? `<button type="button" class="btn-sec btn-sm apt-atualizar-fim" data-i="${i}">Atualizar o fim para ${esc(l.fim)}</button>` : ""}</td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm txt-perigo apt-linha-rem" data-i="${i}" title="tirar a linha" aria-label="tirar a linha">×</button></td></tr>`;
  }).join("") || `<tr><td colspan="9" class="vazio">Sem linhas. Use "+ Linha".</td></tr>`;
  _aptGrade.forEach((l, i) => {
    const tr = $("apt-grade").querySelector(`tr[data-i="${i}"]`); if(!tr) return;
    tr.querySelector('[data-c="funcionario_id"]').value = l.funcionario_id || "";
    const c = tr.querySelector('[data-c="centro_trabalho_id"]'); if(c) c.value = l.centro_trabalho_id || "";
    const a = tr.querySelector('[data-c="atividade_id"]'); if(a) a.value = l.atividade_id || "";
  });
}
async function aptGradeMudou(el){
  const i = Number(el.dataset.i), c = el.dataset.c, l = _aptGrade[i]; if(!l) return;
  l[c] = el.type === "checkbox" ? el.checked : el.value;
  if(l.estado && l.estado !== "gravada"){ l.estado = ""; l.msg = ""; l.existente = null; }
  if(c === "docTxt"){
    const r = await aptResolverDoc(l.docTxt);
    l.doc = r.doc; l.msg = r.msg || ""; l.atividade_id = ""; l.concluir_atividade = false;
    if(r.doc && aptDocAberto(r.doc)) l.docTxt = aptRotuloDoc(r.doc);
    if(l.doc?.tipo === "OS") await aptCarregarAtividades(l.doc.id);
    if(l.doc && !l.hora_extra) l.hora_extra = await aptExigeAprovacao(l.data);   // HE em RP, OS e OF: fim de semana e feriado vêm marcados
    l.atividade_id = aptSugerirAtividade(l);
    aptRenderGrade();
  } else if(c === "observacao" && l.doc?.tipo === "OS" && !l.atividade_id){
    l.atividade_id = aptSugerirAtividade(l);
    const a = $("apt-grade").querySelector(`tr[data-i="${i}"] [data-c="atividade_id"]`); if(a) a.value = l.atividade_id;
  } else if(c === "data" && l.doc){
    l.hora_extra = await aptExigeAprovacao(l.data); aptRenderGrade();
  }
}
async function aptExigeAprovacao(d){
  if(!d) return false;
  if(!(d in _aptDiaAprov)){
    const { data, error } = await sb.rpc("apontamento_dia_aprovacao", { p_data: d });
    if(error) throw new Error("Não foi possível conferir se " + dataBR(d) + " é dia útil: " + error.message);
    _aptDiaAprov[d] = !!data;
  }
  return _aptDiaAprov[d];
}
/* Uma linha: confere, procura repetida e grava na tabela do documento (dia útil) ou em apontamento_aprovacoes (fim de semana e feriado) */
async function aptGravarLinha(l){
  const d = l.doc;
  const recusa = msg => { l.estado = "recusada"; l.msg = msg; };
  if(!d) return recusa(l.msg || "Escolha o documento.");
  if(!aptDocAberto(d)) return recusa(`${d.numero} está ${aptStatusDoc(d.status)} e não aceita hora nova. Quem pode reabrir o documento decide.`);
  if(!aptPodeGravar(d.tipo)) return recusa(`Seu perfil não lança hora em ${APT_TIPO[d.tipo].rotulo}.`);
  if(!l.funcionario_id) return recusa("Escolha o funcionário.");
  if(!l.data || !l.inicio || !l.fim) return recusa("Informe data, início e fim.");
  if(l.fim <= l.inicio) return recusa("O fim precisa ser depois do início (hora que passa da meia-noite: uma linha por dia).");
  if(d.tipo === "OF" && !l.centro_trabalho_id) return recusa("Escolha o centro de trabalho da OF.");
  const t = APT_TIPO[d.tipo];
  const aprovar = await aptExigeAprovacao(l.data);
  // repetida: mesma hora já gravada no documento ou já esperando aprovação
  const { data: ja, error: eJa } = await sb.from(t.tabela).select("id,fim").eq(t.col, d.id).eq("funcionario_id", l.funcionario_id).eq("data", l.data).eq("inicio", l.inicio).range(0, 0);
  if(eJa) return recusa("Não foi possível conferir repetição: " + eJa.message);
  if(ja && ja[0]){ l.estado = "repetida"; l.existente = ja[0]; l.msg = `Já lançada em ${d.numero} (fim ${aptHora(ja[0].fim)}).`; return; }
  if(aprovar){
    const { data: jaAp } = await sb.from("apontamento_aprovacoes").select("id").eq("documento_id", d.id).eq("funcionario_id", l.funcionario_id).eq("data", l.data).eq("inicio", l.inicio).eq("status", "aguardando").range(0, 0);
    if(jaAp && jaAp[0]){ l.estado = "repetida"; l.existente = null; l.msg = "Já está aguardando aprovação."; return; }
    const reg = { tipo: d.tipo, documento_id: d.id, funcionario_id: l.funcionario_id, data: l.data, inicio: l.inicio, fim: l.fim,
      observacao: l.observacao.trim() || null, lancado_por: usuarioAtual.id, origem: "apontamento" };
    reg.hora_extra = !!l.hora_extra;
    if(d.tipo === "OF") reg.centro_trabalho_id = l.centro_trabalho_id;
    const { error } = await sb.from("apontamento_aprovacoes").insert(reg);
    if(error) return recusa(error.message.replace(/^.*?: /, ""));
    l.estado = "aguardando";
    l.msg = `${aptDiaSemana(l.data) === "sáb" || aptDiaSemana(l.data) === "dom" ? "Fim de semana" : "Feriado"}: espera o ${d.tipo === "OS" ? "gestor de manutenção" : "gestor de acessórios"} aprovar.`
      + (l.atividade_id && l.concluir_atividade ? " A atividade da OS não foi marcada: marque na ficha depois da aprovação." : "");
    return;
  }
  const reg = { [t.col]: d.id, funcionario_id: l.funcionario_id, data: l.data, inicio: l.inicio, fim: l.fim, horas: 0,   // o gatilho calcula
    observacao: l.observacao.trim() || null, origem: "apontamento" };
  if(d.tipo === "OS") reg.funcionario_nome = aptNomeFunc(l.funcionario_id) || null;
  reg.hora_extra = !!l.hora_extra;   // HE nas três tabelas; sábado, domingo e feriado o banco marca de qualquer jeito
  if(d.tipo === "OF") reg.centro_trabalho_id = l.centro_trabalho_id;
  const { error } = await sb.from(t.tabela).insert(reg);
  if(error) return recusa(error.message.replace(/^.*?: /, ""));
  l.estado = "gravada"; l.msg = "";
  if(d.tipo === "OS" && l.atividade_id && l.concluir_atividade){
    const { error: eA } = await sb.from("manutencao_atividades").update({ situacao: "executado", executante_id: l.funcionario_id, data_fim: l.data, fim: l.fim }).eq("id", l.atividade_id);
    if(eA) l.msg = "Hora gravada; a atividade não foi marcada: " + eA.message;
    else { _aptAtiv[d.id] = (_aptAtiv[d.id] || []).filter(a => a.id !== l.atividade_id); l.msg = "Hora gravada e atividade marcada executada."; }
  }
}
async function aptGravarGrade(){
  const usadas = _aptGrade.filter(l => l.docTxt || l.funcionario_id && (l.inicio || l.fim));
  if(!usadas.length){ aviso("app-aviso", "Preencha pelo menos uma linha.", "erro"); return; }
  for(const l of usadas){
    if(l.estado === "gravada" || l.estado === "aguardando") continue;
    try { await aptGravarLinha(l); } catch(e){ l.estado = "recusada"; l.msg = e.message; }
  }
  const n = st => usadas.filter(l => l.estado === st).length;
  const gravadas = n("gravada"), aguardando = n("aguardando"), presas = usadas.filter(l => !["gravada", "aguardando"].includes(l.estado)).length;
  // as que gravaram saem da grade; as recusadas e repetidas ficam com o motivo
  _aptGrade = _aptGrade.filter(l => !["gravada", "aguardando"].includes(l.estado) || (l.estado === "gravada" && l.msg));
  if(!_aptGrade.length) _aptGrade = [aptLinhaNova(usadas[usadas.length - 1])];
  aptRenderGrade();
  aviso("app-aviso", `${gravadas} gravada(s) na ficha do documento${aguardando ? `, ${aguardando} aguardando aprovação` : ""}${presas ? `; ${presas} ficaram na grade com o motivo` : ""}.`, presas ? "aviso" : "ok");
  await Promise.all([aptCarregarHoras(), aptCarregarAprovacoes()]); aptRender();
}
async function aptAtualizarFim(i){
  const l = _aptGrade[i]; if(!l?.existente || !l.doc) return;
  if(l.fim <= l.inicio){ aviso("app-aviso", "O fim precisa ser depois do início.", "erro"); return; }
  const t = APT_TIPO[l.doc.tipo];
  const { error } = await sb.from(t.tabela).update({ fim: l.fim, horas: 0 }).eq("id", l.existente.id);
  if(error){ aviso("app-aviso", "Não foi possível atualizar o fim: " + error.message, "erro"); return; }
  _aptGrade.splice(i, 1); if(!_aptGrade.length) _aptGrade = [aptLinhaNova(l)];
  aptRenderGrade();
  aviso("app-aviso", `Fim atualizado em ${l.doc.numero}.`, "ok");
  await aptCarregarHoras(); aptRender();
}

/* ---------- ligações ---------- */
function ligarApontamentos(){
  const nav = document.querySelector('nav button[data-secao="apontamentos"]');
  if(!nav) return;
  nav.addEventListener("click", () => carregarApontamentos());
  $("btn-apt-atualizar").addEventListener("click", () => comBotaoTravado("btn-apt-atualizar", async () => {
    _aptDocs = []; _aptAtiv = {}; await carregarApontamentos();
    if($("apt-grade-box").style.display !== "none") await aptCarregarDocs();   // grade aberta: a lista de documentos volta já
  }));
  ["apt-de", "apt-ate", "apt-tipo", "apt-func"].forEach(id => $(id).addEventListener("change", async () => {
    if(id === "apt-de" && $("apt-ate").value < $("apt-de").value) $("apt-ate").value = $("apt-de").value;
    await Promise.all([aptCarregarHoras(), aptCarregarAprovacoes()]); aptRender();
  }));
  $("apt-busca").addEventListener("input", debounce(aptRender, 250));
  $("apt-views").addEventListener("click", e => { const b = e.target.closest(".serv-view-btn"); if(!b) return; _aptView = b.dataset.view; aptRender(); });
  $("btn-apt-lancar").addEventListener("click", () => comBotaoTravado("btn-apt-lancar", aptAbrirGrade));
  $("btn-apt-fechar-grade").addEventListener("click", () => { $("apt-grade-box").style.display = "none"; });
  $("btn-apt-linha").addEventListener("click", () => { _aptGrade.push(aptLinhaNova(_aptGrade[_aptGrade.length - 1])); aptRenderGrade(); });
  $("btn-apt-gravar").addEventListener("click", () => comBotaoTravado("btn-apt-gravar", aptGravarGrade));
  const grade = $("apt-grade");
  grade.addEventListener("change", e => { const el = e.target.closest("[data-c]"); if(el) aptGradeMudou(el).catch(err => aviso("app-aviso", err.message, "erro")); });
  grade.addEventListener("click", e => {
    const rem = e.target.closest(".apt-linha-rem");
    if(rem){ _aptGrade.splice(Number(rem.dataset.i), 1); aptRenderGrade(); return; }
    const up = e.target.closest(".apt-atualizar-fim");
    if(up) comBotaoTravado(up, () => aptAtualizarFim(Number(up.dataset.i)));
  });
  $("apt-conteudo").addEventListener("click", e => {
    const a = e.target.closest(".apt-abrir-doc");
    if(a){ e.preventDefault(); aptAbrirDoc(a.dataset.tipo, a.dataset.id); return; }
    const ap = e.target.closest(".apt-aprovar");
    if(ap){ comBotaoTravado(ap, () => aptAprovar([ap.dataset.id])); return; }
    const rc = e.target.closest(".apt-recusar");
    if(rc){ comBotaoTravado(rc, () => aptRecusar([rc.dataset.id])); return; }
    const df = e.target.closest(".apt-desfazer");
    if(df){ comBotaoTravado(df, () => aptDesfazer(df.dataset.id)); return; }
    const sel = () => [...document.querySelectorAll("#apt-conteudo .apt-sel:checked")].map(x => x.dataset.id);
    if(e.target.id === "apt-sel-todas"){ document.querySelectorAll("#apt-conteudo .apt-sel").forEach(x => { x.checked = e.target.checked; }); return; }
    if(e.target.id === "btn-apt-aprovar-lote"){ const ids = sel(); if(!ids.length){ aviso("app-aviso", "Selecione as horas.", "erro"); return; } comBotaoTravado(e.target, () => aptAprovar(ids)); return; }
    if(e.target.id === "btn-apt-recusar-lote"){ const ids = sel(); if(!ids.length){ aviso("app-aviso", "Selecione as horas.", "erro"); return; } comBotaoTravado(e.target, () => aptRecusar(ids)); }
  });
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarApontamentos);
else ligarApontamentos();

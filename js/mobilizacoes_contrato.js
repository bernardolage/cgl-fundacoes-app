/* ====================================================================
   Módulo: Mobilizações — quadro por contrato, ficha com abas e equipe (fase 157d)
   Carregado depois de js/mobilizacoes.js (usa o estado e as funções de lá).

   - O cartão é o contrato (obra): vw_mobilizacoes_contrato, uma linha por obra com mobilização viva, na coluna onde
     precisa de ação (D5). O registro continua por máquina (mobilizacoes); o cartão lista as máquinas.
   - Visões: Quadro (contratos) | Por máquina (onde está cada TAG e para onde vai) | Lista (uma linha por máquina).
   - Ficha do contrato: máquinas do contrato numa faixa; a escolhida é a "_mobAberta" e as abas Kit, Escopo, Viagens e
     Conversa mostram a dela. Contato e condições gravam em todas as máquinas em andamento do contrato.
   - Equipe e SESMT (mobilizacao_equipe): pessoas por máquina com a situação de liberação, sugeridas pela alocação ativa
     na TAG. Nada entra sozinho: a sugestão só grava quando alguém confirma (D10, também na troca de máquina).
   ==================================================================== */

let _mobContratos = [];   // linhas de vw_mobilizacoes_contrato
let _mobLive      = [];   // mobilizacoes (menos canceladas) com os campos que o quadro não traz
let _mobEquipe    = [];   // mobilizacao_equipe (null = tabela indisponível)
let _mobOS        = [];   // manutencoes abertas (agendada, em andamento) por TAG
let _mobPendObra  = [];   // pendências de nível contrato da obra aberta
let _mobSugAloc   = [];   // alocações ativas nas TAGs do contrato aberto
let _mobAba       = "maquinas";
const _mobColapsadasCtr = new Set(["encerradas"]);

const MOB_COLUNAS_CTR = [
  { k: "prevista",       label: "Prevista",             cor: "var(--info)",          dica: "Todas as máquinas do contrato ainda previstas." },
  { k: "mobilizando",    label: "Mobilizando",          cor: "var(--aviso)",         dica: "Alguma máquina em preparação ou em trânsito, mesmo com outras já em obra." },
  { k: "em_obra",        label: "Em obra",              cor: "var(--marca-600)",     dica: "Máquinas em obra e nenhuma em movimento." },
  { k: "desmobilizando", label: "Desmobilizando",       cor: "var(--marca-laranja)", dica: "Alguma máquina em obra com desmobilização prevista em até 10 dias." },
  { k: "encerradas",     label: "Encerradas (30 dias)", cor: "var(--txt-fraco)",     dica: "Todas as máquinas desmobilizadas nos últimos 30 dias." }
];
const MOB_ETAPAS = [["prevista", "Prevista"], ["em_preparacao", "Em preparação"], ["em_transito", "Em trânsito"], ["em_obra", "Em obra"], ["desmobilizada", "Desmobilizada"]];
const MOB_TIPO_LBL = { helice: "Hélice contínua", secante: "Hélice secante", raiz: "Estaca raiz", trado: "Trado mecanizado", outro: "Outro" };
// situação de liberação do SESMT por pessoa (check em mobilizacao_equipe.situacao)
const MOB_EQ_SITUACAO = {
  pendente:            { rot: "Pendente",            cls: "perigo" },
  documentos_enviados: { rot: "Documentos enviados", cls: "aviso" },
  cracha_aprovado:     { rot: "Crachá aprovado",     cls: "aviso" },
  em_treinamento:      { rot: "Em treinamento",      cls: "aviso" },
  liberado:            { rot: "Liberado",            cls: "ok" },
  nao_se_aplica:       { rot: "Não se aplica",       cls: "" }
};
/* quem monta a equipe e muda a situação: espelha as policies de mobilizacao_equipe (has_role cobre diretor no banco;
   aqui a lista precisa trazê-lo). Auditor fica de fora pela policy restritiva. */
const MOB_EQ_CARGOS = ["diretor", "sesmt", "rh", "logistica", "engenheiro", "assistente_engenharia", "encarregado"];
function mobEquipePodeEditar(){ return !!usuarioAtual && MOB_EQ_CARGOS.includes(usuarioAtual.cargo); }
function mobEqLiberado(e){ return e.situacao === "liberado" || e.situacao === "nao_se_aplica"; }

/* ---------- Carga (chamada por carregarMobilizacoes) ---------- */
const MOB_LIVE_SELECT = "id,obra_id,equipamento_id,status,data_mobilizacao_prev,data_saida_real,data_chegada_real,data_desmob_prev,data_desmob_real,viagem_ida_id,viagem_volta_id,acessorios_ids,desmob_motivo,volta_prevista,origem_mobilizacao_id,created_at";
const MOB_EQ_SELECT = "id,mobilizacao_id,funcionario_id,funcao,situacao,observacao,atualizado_em,funcionario:funcionarios(nome)";
async function mobCarregarContratos(){
  const [kRes, lRes, eqRes, osRes] = await Promise.all([
    sb.from("vw_mobilizacoes_contrato").select("*"),
    lerTudo(() => sb.from("mobilizacoes").select(MOB_LIVE_SELECT).neq("status", "cancelada")),
    lerTudo(() => sb.from("mobilizacao_equipe").select(MOB_EQ_SELECT)),
    lerTudo(() => sb.from("manutencoes").select("id,numero,equipamento_id,status,data_prevista").in("status", ["agendada", "em_andamento"]).not("equipamento_id", "is", null))
  ]);
  _mobContratos = kRes.error ? [] : (kRes.data || []);
  _mobLive      = lRes.error ? [] : (lRes.data || []);
  _mobEquipe    = eqRes.error ? [] : (eqRes.data || []);
  _mobOS        = osRes.error ? [] : (osRes.data || []);
}

/* ---------- Ajudantes ---------- */
function mobLiveDe(id){ return _mobLive.find(x => x.id === id) || null; }
function mobCardDe(id){ return _mobCards.find(c => c.id === id) || {}; }
function mobTagDe(m){
  if(!m || !m.equipamento_id) return "";
  return (_mobEquips.find(e => e.id === m.equipamento_id) || {}).codigo || mobCardDe(m.id).equipamento_tag || "?";
}
function mobObraCodDe(m){ return mobCardDe(m.id).obra_codigo || (_mobObras.find(o => o.id === m.obra_id) || {}).codigo || "?"; }
function mobEquipeDe(mobId){ return _mobEquipe.filter(e => e.mobilizacao_id === mobId); }
function mobNomeEq(e){ return (e.funcionario && e.funcionario.nome) || "?"; }
/* data ISO ± n dias (o addDiasISO do core.js conta só a partir de hoje) */
function mobSomarDias(iso, n){ const [a, m, d] = String(iso).split("-").map(Number); return dataLocalISO(new Date(a, m - 1, d + n)); }
const MOB_ORDEM_ST = ["em_preparacao", "em_transito", "prevista", "em_obra", "desmobilizada"];
function mobOrdemMaq(a, b){
  return MOB_ORDEM_ST.indexOf(a.status) - MOB_ORDEM_ST.indexOf(b.status)
    || String(mobTagDe(a) || "zz").localeCompare(String(mobTagDe(b) || "zz"), "pt-BR", { numeric: true });
}
/* máquinas do contrato: as vivas; se todas já saíram, as desmobilizadas dos últimos 30 dias */
function mobsDoContrato(obraId){
  const todas = _mobLive.filter(m => m.obra_id === obraId);
  const vivas = todas.filter(m => m.status !== "desmobilizada");
  const limite = addDiasISO(-30);
  return (vivas.length ? vivas : todas.filter(m => (m.data_desmob_real || "") >= limite)).sort(mobOrdemMaq);
}
function mobTipoContrato(k){
  const t = _mobCards.find(c => c.obra_id === k.obra_id && c.tipo_servico);
  return (t && t.tipo_servico) || k.tipo_proposta || "";
}
/* o que a linha da máquina diz de data: sai, saiu, chegou, desmobilização prevista */
function mobDataMaquina(m){
  switch(m.status){
    case "prevista": case "em_preparacao": return m.data_mobilizacao_prev ? "sai " + dataBR(m.data_mobilizacao_prev) : "sem data de saída";
    case "em_transito": return m.data_saida_real ? "saiu " + dataBR(m.data_saida_real) : "em trânsito";
    case "em_obra": return m.data_desmob_prev ? "desmob. prevista " + dataBR(m.data_desmob_prev) : (m.data_chegada_real ? "chegou " + dataBR(m.data_chegada_real) : "em obra");
    case "desmobilizada": return m.data_desmob_real ? "desmob. " + dataBR(m.data_desmob_real) : "desmobilizada";
    default: return "";
  }
}
/* selos da máquina: [texto, classe, explicação] */
function mobSelosMaquina(m){
  const s = [];
  if(mobEhNova(m.id)) s.push(["nova", "ok", "Mobilização prevista criada nos últimos 7 dias."]);
  const eq = mobEquipeDe(m.id);
  if(eq.length){
    const lib = eq.filter(mobEqLiberado).length;
    s.push([`equipe ${lib} de ${eq.length} liberados`, lib === eq.length ? "ok" : "aviso", "Situação do SESMT de cada pessoa na aba Equipe e SESMT."]);
  } else if(["prevista", "em_preparacao"].includes(m.status)) s.push(["equipe a definir", "", "Ninguém na equipe desta máquina ainda."]);
  const os = m.equipamento_id ? _mobOS.filter(o => o.equipamento_id === m.equipamento_id) : [];
  if(os.length) s.push([`${os[0].numero || "OS"} aberta${os.length > 1 ? ` (+${os.length - 1})` : ""}`, "perigo", `Ordem de serviço de manutenção ${os[0].status === "em_andamento" ? "em andamento" : "agendada"} nesta TAG.`]);
  if(["prevista", "em_preparacao"].includes(m.status)){
    if(!(m.acessorios_ids || []).length) s.push(["kit vazio", "aviso", "Nenhuma peça no kit desta mobilização."]);
    if(!m.viagem_ida_id) s.push(["viagem não planejada", "aviso", "A viagem de ida ainda não foi programada em Logística."]);
  }
  if(m.status === "em_obra" && m.data_desmob_prev && m.data_desmob_prev <= addDiasISO(10) && !m.viagem_volta_id)
    s.push(["volta sem viagem", "aviso", "Desmobilização em até 10 dias e a viagem de volta não foi programada."]);
  if(m.origem_mobilizacao_id){
    const o = mobLiveDe(m.origem_mobilizacao_id);
    s.push([`voltou para reparo${o && o.data_desmob_real ? " " + dataBR(o.data_desmob_real).slice(0, 5) : ""}${m.data_mobilizacao_prev ? " · volta " + dataBR(m.data_mobilizacao_prev).slice(0, 5) : ""}`, "st", "Ciclo de manutenção na sede: esta mobilização é a volta da máquina à obra."]);
  }
  if(m.status === "desmobilizada" && m.desmob_motivo) s.push([MOB_DESMOB_MOTIVOS[m.desmob_motivo] || m.desmob_motivo, "", "Motivo da desmobilização."]);
  return s;
}
function mobSelosHTML(m){
  return mobSelosMaquina(m).map(([t, cls, d]) => `<span class="mob-chip ${esc(cls)}" title="${esc(d)}">${esc(t)}</span>`).join("");
}

/* ---------- Filtros ---------- */
function mobPreencherFiltrosCtr(){
  const selTipo = $("mob-f-tipo"), selResp = $("mob-f-resp");
  if(selTipo){
    const v = selTipo.value;
    const tipos = [...new Set(_mobContratos.map(mobTipoContrato).filter(Boolean))].sort();
    selTipo.innerHTML = '<option value="">Todos os tipos</option>' + tipos.map(t => `<option value="${esc(t)}">${esc(MOB_TIPO_LBL[t] || t)}</option>`).join("");
    selTipo.value = tipos.includes(v) ? v : "";
  }
  if(selResp){
    const v = selResp.value;
    const ids = [...new Set(_mobContratos.map(k => k.responsavel_id).filter(Boolean))];
    const pessoas = ids.map(id => _mobProfiles.find(p => p.id === id)).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    selResp.innerHTML = '<option value="">Todos os responsáveis</option>' + pessoas.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join("");
    selResp.value = ids.includes(v) ? v : "";
  }
}
function mobCtrFiltrados(){
  const termo = ($("mob-busca")?.value || "").trim().toLowerCase();
  const cli = $("mob-f-cliente")?.value || "", tag = $("mob-f-tag")?.value || "", tipo = $("mob-f-tipo")?.value || "", resp = $("mob-f-resp")?.value || "";
  return _mobContratos.filter(k => {
    if(cli && k.cliente !== cli) return false;
    if(resp && k.responsavel_id !== resp) return false;
    if(tipo && mobTipoContrato(k) !== tipo) return false;
    const ms = mobsDoContrato(k.obra_id);
    if(tag && !ms.some(m => mobTagDe(m) === tag)) return false;
    if(termo && !`${k.obra_codigo || ""} ${k.obra_nome || ""} ${k.cliente || ""} ${k.contrato_numero || ""} ${k.cidade || ""} ${ms.map(mobTagDe).join(" ")}`.toLowerCase().includes(termo)) return false;
    return true;
  });
}

/* ---------- Visão Quadro: um cartão por contrato ---------- */
function mobLinhaCardHTML(m){
  return `<div class="mob-ctr-maq">
    <div class="mob-ctr-maq-cab">${uiCodigo(mobTagDe(m) || "a definir")}<span class="mob-chip st">${esc(MOB_STATUS[m.status] || m.status)}</span><span class="meta">${esc(mobDataMaquina(m))}</span></div>
    <div class="mob-card-chips">${mobSelosHTML(m)}</div>
  </div>`;
}
function cardContratoMobHTML(k){
  const ms = mobsDoContrato(k.obra_id);
  const col = MOB_COLUNAS_CTR.find(x => x.k === k.coluna) || {};
  const tipo = mobTipoContrato(k);
  const local = [k.cidade && k.uf ? `${k.cidade}/${String(k.uf).toUpperCase()}` : (k.cidade || ""), MOB_TIPO_LBL[tipo] || tipo].filter(Boolean).join(" · ");
  const pendMaq = ms.reduce((s, m) => s + (Number(mobCardDe(m.id).pendencias_abertas) || 0), 0);
  const pendCtr = Number(k.pend_contrato_abertas) || 0;
  return `<div class="mob-card mob-ctr" data-obra="${esc(k.obra_id)}" style="border-left-color:${esc(col.cor || "var(--sup-3)")}" tabindex="0" role="button" aria-label="Abrir o contrato ${esc(k.obra_codigo || "")}">
    <div class="mob-ctr-topo">${uiCodigo(k.obra_codigo || "?")}<span class="mob-col-n" title="Máquinas deste contrato">${esc(k.n_maquinas)} máq.</span></div>
    <div class="mob-card-titulo">${esc(k.cliente || k.obra_nome || "")}</div>
    ${local ? `<div class="meta">${esc(local)}</div>` : ""}
    <div class="mob-ctr-maqs">${ms.map(mobLinhaCardHTML).join("") || '<span class="meta">sem máquina</span>'}</div>
    <div class="mob-card-rodape">
      <span class="mob-badge ${pendCtr ? (k.pend_contrato_atrasada ? "perigo" : "aviso") : "ok"}" title="Pendências do contrato (integração, hospedagem, projeto): uma por obra">${pendCtr ? `${esc(pendCtr)} do contrato` : "contrato em dia"}</span>
      ${pendMaq ? `<span class="mob-badge aviso" title="Pendências abertas das máquinas (equipe, kit, transporte, revisão)">${esc(pendMaq)} das máquinas</span>` : ""}
    </div>
  </div>`;
}
function renderQuadroMob(){
  const cont = $("mob-conteudo");
  if(!cont) return;
  if(!_mobContratos.length){
    cont.innerHTML = `<p class="vazio">Nenhuma mobilização em andamento.${mobPodeEditar() ? " Clique em <strong>+ Nova mobilização</strong>." : ""}</p>`;
    return;
  }
  const dados = mobCtrFiltrados();
  const porCol = {};
  MOB_COLUNAS_CTR.forEach(c => { porCol[c.k] = []; });
  dados.forEach(k => (porCol[k.coluna] || (porCol[k.coluna] = [])).push(k));
  Object.values(porCol).forEach(l => l.sort((a, b) => String(a.proxima_saida || a.proxima_desmob || "9999").localeCompare(String(b.proxima_saida || b.proxima_desmob || "9999")) || String(a.obra_codigo || "").localeCompare(String(b.obra_codigo || ""), "pt-BR", { numeric: true })));
  cont.innerHTML = `<div class="mob-quadro">${MOB_COLUNAS_CTR.map(col => {
    const cards = porCol[col.k] || [];
    const colapsada = _mobColapsadasCtr.has(col.k);
    return `<div class="mob-col${colapsada ? " colapsada" : ""}" data-col="${esc(col.k)}">
      <div class="mob-col-titulo" style="border-top-color:${esc(col.cor)}" title="${esc(col.dica)}">
        <span>${esc(col.label)}</span><span class="mob-col-n">${cards.length}</span>
        <button type="button" class="mob-col-toggle" aria-label="${colapsada ? "Mostrar" : "Recolher"} a coluna ${esc(col.label)}">${colapsada ? "▸" : "▾"}</button>
      </div>
      ${colapsada ? "" : (cards.length ? cards.map(cardContratoMobHTML).join("") : `<p class="vazio mob-vazio">—</p>`)}
    </div>`;
  }).join("")}</div>`;
  cont.querySelectorAll(".mob-ctr").forEach(el => {
    el.addEventListener("click", e => { if(e.target.closest("a")) return; abrirContratoMob(el.dataset.obra); });
    el.addEventListener("keydown", e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); abrirContratoMob(el.dataset.obra); } });
  });
  cont.querySelectorAll(".mob-col-toggle").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const k = b.closest(".mob-col").dataset.col;
    if(_mobColapsadasCtr.has(k)) _mobColapsadasCtr.delete(k); else _mobColapsadasCtr.add(k);
    renderQuadroMob();
  }));
}

/* ---------- Visão Por máquina: onde está cada TAG hoje e para onde vai ---------- */
function renderPorMaquinaMob(){
  const cont = $("mob-conteudo");
  if(!cont) return;
  const termo = ($("mob-busca")?.value || "").trim().toLowerCase(), tagF = $("mob-f-tag")?.value || "";
  const ids = new Set(_mobLive.filter(m => m.equipamento_id && m.status !== "desmobilizada").map(m => m.equipamento_id));
  _mobEquips.filter(e => ["obra", "em_transito"].includes(e.localizacao_tipo)).forEach(e => ids.add(e.id));
  const linhas = [...ids].map(id => {
    const e = _mobEquips.find(x => x.id === id) || { id, codigo: (_mobCards.find(c => c.equipamento_id === id) || {}).equipamento_tag || "?", nome: "" };
    const ms = _mobLive.filter(m => m.equipamento_id === id);
    const atual = ms.find(m => ["em_obra", "em_transito"].includes(m.status)) || null;
    const proximas = ms.filter(m => ["prevista", "em_preparacao"].includes(m.status)).sort((a, b) => String(a.data_mobilizacao_prev || "9999").localeCompare(String(b.data_mobilizacao_prev || "9999")));
    const os = _mobOS.filter(o => o.equipamento_id === id);
    return { e, atual, proximas, os };
  }).filter(l => (!tagF || l.e.codigo === tagF)
    && (!termo || `${l.e.codigo} ${l.e.nome || ""} ${l.atual ? mobObraCodDe(l.atual) : ""} ${l.proximas.map(mobObraCodDe).join(" ")}`.toLowerCase().includes(termo)))
    .sort((a, b) => String(a.e.codigo).localeCompare(String(b.e.codigo), "pt-BR", { numeric: true }));
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">Nenhuma máquina em obra ou com mobilização prevista.</p>`; return; }
  const linkMob = (m, txt) => `<a href="#" data-mob="${esc(m.id)}">${uiCodigo(mobObraCodDe(m))}</a> <span class="meta">${esc(txt)}</span>`;
  cont.innerHTML = `<p class="meta">Uma linha por TAG em obra, em trânsito ou com mobilização prevista: onde está hoje (pelo status da mobilização) e as próximas obras em ordem de data.</p>
    <div class="tabela-rola"><table>
    <thead><tr><th>TAG</th><th>Onde está hoje</th><th>Próximas mobilizações</th><th>OS aberta</th></tr></thead>
    <tbody>${linhas.map(l => `<tr>
      <td>${uiCodigo(l.e.codigo)}${l.e.nome ? ` <span class="meta">${esc(l.e.nome)}</span>` : ""}</td>
      <td>${l.atual ? `${esc(MOB_STATUS[l.atual.status] || l.atual.status)} · ${linkMob(l.atual, mobDataMaquina(l.atual))}` : esc(mobEquipOnde(l.e))}</td>
      <td>${l.proximas.length ? l.proximas.map(m => linkMob(m, m.data_mobilizacao_prev ? dataBR(m.data_mobilizacao_prev) : "sem data")).join("<br>") : '<span class="meta">—</span>'}</td>
      <td>${l.os.length ? l.os.map(o => `<span class="mob-chip perigo" title="${esc(o.status === "em_andamento" ? "Em andamento" : "Agendada")}${o.data_prevista ? " para " + esc(dataBR(o.data_prevista)) : ""}">${esc(o.numero || "OS")}</span>`).join(" ") : '<span class="meta">—</span>'}</td>
    </tr>`).join("")}</tbody></table></div>`;
  cont.querySelectorAll("a[data-mob]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); abrirMobilizacao(a.dataset.mob); }));
}

/* ---------- Visão Lista: uma linha por máquina ---------- */
function renderListaMob(){
  const cont = $("mob-conteudo");
  if(!cont) return;
  const obras = new Set(mobCtrFiltrados().map(k => k.obra_id));
  const linhas = _mobLive.filter(m => obras.has(m.obra_id) && mobsDoContrato(m.obra_id).includes(m))
    .sort((a, b) => String(mobObraCodDe(a)).localeCompare(String(mobObraCodDe(b)), "pt-BR", { numeric: true }) || mobOrdemMaq(a, b));
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">Nenhuma máquina com esses filtros.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Obra</th><th>Cliente</th><th>TAG</th><th>Status</th><th>Data</th><th>Pendências</th><th>Situação</th></tr></thead>
    <tbody>${linhas.map(m => { const c = mobCardDe(m.id); return `<tr class="mob-linha-click" data-mob="${esc(m.id)}" tabindex="0">
      <td>${uiCodigo(mobObraCodDe(m))}</td>
      <td>${esc(c.cliente || "")}</td>
      <td>${uiCodigo(mobTagDe(m) || "a definir")}</td>
      <td><span class="mob-chip st">${esc(MOB_STATUS[m.status] || m.status)}</span></td>
      <td>${esc(mobDataMaquina(m))}</td>
      <td>${mobBadgePend(c)}</td>
      <td><div class="mob-card-chips">${mobSelosHTML(m)}</div></td>
    </tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-mob]").forEach(tr => {
    tr.addEventListener("click", e => { if(e.target.closest("a")) return; abrirMobilizacao(tr.dataset.mob); });
    tr.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); abrirMobilizacao(tr.dataset.mob); } });
  });
}

/* ---------- Minhas pendências: pessoas a liberar (SESMT), de todas as obras, em ordem de saída ---------- */
function mobPessoasALiberarHTML(){
  const vivos = new Set(["prevista", "em_preparacao", "em_transito", "em_obra"]);
  const lista = _mobEquipe.filter(e => !mobEqLiberado(e)).map(e => ({ e, m: mobLiveDe(e.mobilizacao_id) }))
    .filter(x => x.m && vivos.has(x.m.status))
    .sort((a, b) => String(a.m.data_mobilizacao_prev || "9999").localeCompare(String(b.m.data_mobilizacao_prev || "9999")) || mobNomeEq(a.e).localeCompare(mobNomeEq(b.e), "pt-BR"));
  if(!lista.length) return "";
  const pode = mobEquipePodeEditar();
  return uiSecao("equipe", "Pessoas a liberar (SESMT)", `<div class="mob-pend-lista">${lista.map(({ e, m }) => `
    <div class="mob-pend mob-eq-linha">
      ${uiAvatar(mobNomeEq(e))}
      <span class="mob-pend-txt">
        <span class="mob-pend-titulo">${esc(mobNomeEq(e))}${e.funcao ? ` <span class="meta">${esc(e.funcao)}</span>` : ""}</span>
        <span class="meta"><a href="#" data-mob-eq="${esc(m.id)}">${esc(mobObraCodDe(m))} · ${esc(mobTagDe(m) || "a definir")}</a> · ${esc(mobDataMaquina(m))}</span>
      </span>
      ${pode ? mobEqSituacaoSelect(e) : mobEqSituacaoChip(e)}
    </div>`).join("")}</div>`, `${lista.length}`);
}
function mobLigarPessoasALiberar(cont){
  cont.querySelectorAll("a[data-mob-eq]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); abrirMobilizacao(a.dataset.mobEq, "equipe"); }));
  cont.querySelectorAll("select[data-eq-sit]").forEach(s => s.addEventListener("change", () => mobEquipeAtualizar(s.dataset.eqSit, { situacao: s.value }, s)));
}

/* ---------- Ficha do contrato ---------- */
function abrirContratoMob(obraId, aba){
  const ms = mobsDoContrato(obraId);
  const m = ms[0] || _mobLive.find(x => x.obra_id === obraId);
  if(!m){ aviso("app-aviso", "Este contrato não tem mobilização em andamento.", "erro"); return; }
  return abrirMobilizacao(m.id, aba);
}
async function mobCarregarSugestoesEquipe(obraId){
  const tags = [...new Set(mobsDoContrato(obraId).map(m => m.equipamento_id).filter(Boolean))];
  if(!tags.length){ _mobSugAloc = []; return; }
  const { data } = await sb.from("alocacoes").select("funcionario_id,equipamento_id,obra_id,funcionario:funcionarios(nome,funcao)").eq("status", "ativa").in("equipamento_id", tags);
  _mobSugAloc = data || [];
}
/* D10: na troca de máquina a equipe e o kit da máquina que saiu são só sugestão; alguém confirma */
function mobTrocaAnterior(m){
  if(!m || !["prevista", "em_preparacao"].includes(m.status)) return null;
  return _mobLive.filter(x => x.obra_id === m.obra_id && x.id !== m.id && x.status === "desmobilizada" && x.desmob_motivo === "troca_maquina")
    .sort((a, b) => String(b.data_desmob_real || "").localeCompare(String(a.data_desmob_real || "")))[0] || null;
}
function mobRespOpts(sel){ return '<option value="">— responsável —</option>' + _mobProfiles.map(p => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.nome)}</option>`).join(""); }
function mobPendLinhasHTML(lista){
  const porSetor = {};
  lista.forEach(p => (porSetor[p.setor] = porSetor[p.setor] || []).push(p));
  return Object.keys(MOB_SETOR).filter(s => porSetor[s]).map(s => `
    <div class="mob-pend-setor">
      <div class="mob-pend-setor-titulo">${esc(MOB_SETOR[s])} <span class="meta">${porSetor[s].filter(p => !p.concluida).length} aberta(s)</span></div>
      ${porSetor[s].map(p => {
        const atras = p.prazo && !p.concluida && p.prazo < hojeISO();
        return `<div class="mob-pend${atras ? " atrasada" : ""}${p.concluida ? " feita" : ""}" data-pend-row="${esc(p.id)}">
          <input type="checkbox" data-pend="${esc(p.id)}" ${p.concluida ? "checked" : ""} title="concluir" />
          <span class="mob-pend-txt"><span class="mob-pend-titulo">${esc(p.titulo)}</span>${p.concluida && p.concluida_em ? `<span class="meta">concluída em ${dataBR(String(p.concluida_em).slice(0, 10))}</span>` : ""}</span>
          <select class="mob-pend-resp" data-pend="${esc(p.id)}" title="responsável">${mobRespOpts(p.responsavel_id)}</select>
          <input type="date" class="mob-pend-prazo" data-pend="${esc(p.id)}" value="${esc(p.prazo || "")}" title="prazo" />
          <input type="text" class="mob-pend-obs" data-pend="${esc(p.id)}" value="${esc(p.observacao || "")}" placeholder="observação" />
        </div>`; }).join("")}
    </div>`).join("") || uiVazio("Sem pendências.");
}
const MOB_ABAS = [["maquinas", "Máquinas"], ["equipe", "Equipe e SESMT"], ["kit", "Kit e materiais"], ["escopo", "Escopo"], ["condicoes", "Condições e contato"], ["pendencias", "Pendências"], ["viagens", "Viagens e notas"], ["conversa", "Conversa"]];

function renderDrawerMob(){
  const m = _mobAberta, c = _mobAbertaCard || {};
  const cont = $("mob-modal-conteudo");
  if(!cont || !m) return;
  const k = _mobContratos.find(x => x.obra_id === m.obra_id) || { obra_id: m.obra_id, obra_codigo: c.obra_codigo, cliente: c.cliente, cidade: c.cidade, uf: c.uf, contrato_numero: c.contrato_numero, coluna: "" };
  const ms = mobsDoContrato(m.obra_id);
  if(!ms.some(x => x.id === m.id)) ms.push(mobLiveDe(m.id) || m);
  const tag = mobTagDe(m) || "a definir";
  const col = MOB_COLUNAS_CTR.find(x => x.k === k.coluna) || {};
  const tipo = mobTipoContrato(k);
  const est = Array.isArray(m.estacas_resumo) ? m.estacas_resumo : [];
  const podeEditar = mobPodeEditar();
  const porQuem = (id, v) => `<select id="${esc(id)}"><option value="">—</option><option value="cgl"${v === "cgl" ? " selected" : ""}>CGL</option><option value="cliente"${v === "cliente" ? " selected" : ""}>Cliente</option></select>`;
  const simNao = (id, v) => `<select id="${esc(id)}"><option value="">—</option><option value="true"${v === true ? " selected" : ""}>Sim</option><option value="false"${v === false ? " selected" : ""}>Não</option></select>`;
  _mobApoioSel.mob = [...(m.equipamentos_apoio || [])];
  const transicoesDe = (x, sm) => podeEditar ? (MOB_TRANSICOES[x.status] || []).map(([st, lbl, cls]) => `<button type="button" class="${esc(cls)}${sm ? " btn-sm" : ""}" data-mob-tr="${esc(st)}" data-mob-id="${esc(x.id)}">${esc(lbl)}</button>`).join("") : "";
  const abaAtual = MOB_ABAS.some(a => a[0] === _mobAba) ? _mobAba : "maquinas";
  const pane = (k2, html) => `<div class="mob-aba" data-aba="${esc(k2)}"${k2 === abaAtual ? "" : " hidden"}>${/* html */ html}</div>`;
  const nEq = mobEquipeDe(m.id), nLib = nEq.filter(mobEqLiberado).length;
  const pendAbCtr = _mobPendObra.filter(p => !p.concluida).length, pendAbMaq = _mobPendAberta.filter(p => !p.concluida).length;
  const anterior = mobTrocaAnterior(m);

  const tabMaquinas = `<div class="tabela-rola"><table>
      <thead><tr><th>TAG</th><th>Status</th><th>Data</th><th>Situação</th><th></th></tr></thead>
      <tbody>${ms.map(x => `<tr class="${x.id === m.id ? "mob-maq-sel" : ""}">
        <td><button type="button" class="mob-link-btn" data-mob-sel="${esc(x.id)}" title="Mostrar esta máquina nas abas">${uiCodigo(mobTagDe(x) || "a definir")}</button></td>
        <td><span class="mob-chip st">${esc(MOB_STATUS[x.status] || x.status)}</span></td>
        <td>${esc(mobDataMaquina(x))}</td>
        <td><div class="mob-card-chips">${mobSelosHTML(x)}</div></td>
        <td class="mob-maq-acoes">${transicoesDe(x, true)}</td>
      </tr>`).join("")}</tbody></table></div>`;

  cont.innerHTML = `
    <div class="mob-drawer-topo">
      <div>
        ${uiBreadcrumb([{ texto: "Mobilizações" }, { texto: "Contrato " + (k.obra_codigo || "?") }])}
        <div class="mob-drawer-titulo">${uiCodigo(k.obra_codigo || "?")} ${esc(k.cliente || k.obra_nome || "")}</div>
        <div class="mob-drawer-sub">
          ${col.label ? `<span class="mob-chip" style="border-color:${esc(col.cor)}" title="${esc(col.dica)}">${esc(col.label)}</span>` : ""}
          ${tipo ? `<span class="mob-chip">${esc(MOB_TIPO_LBL[tipo] || tipo)}</span>` : ""}
          ${k.cidade ? `<span class="mob-chip">${esc(k.cidade)}${k.uf ? "/" + esc(String(k.uf).toUpperCase()) : ""}</span>` : ""}
          ${k.contrato_numero ? `<span class="mob-chip" title="Contrato do cliente">contrato ${esc(k.contrato_numero)}</span>` : ""}
          <span class="mob-chip">${esc(ms.length)} máquina(s)</span>
          ${linkObra(m.obra_id, "abrir a obra")}
          ${m.trello_card_url ? `<a href="${esc(m.trello_card_url)}" target="_blank" rel="noopener" class="meta">card no Trello</a>` : ""}
        </div>
      </div>
      <button type="button" class="btn-sec" id="btn-mob-fechar" aria-label="Fechar">×</button>
    </div>

    <div class="mob-acoes">
      ${podeEditar ? `<button type="button" class="btn" id="btn-mob-salvar" title="Grava a máquina escolhida; contato e condições valem para todas as máquinas em andamento do contrato">Salvar alterações</button>
        <button type="button" class="btn-sec" id="btn-mob-ctr-maquina" title="Nova mobilização (outra máquina) para esta obra">+ Máquina neste contrato</button>` : `<span class="meta">Só leitura para o seu cargo.</span>`}
    </div>

    <div class="mob-ctr-faixa" role="group" aria-label="Máquinas do contrato">
      ${ms.map(x => `<button type="button" class="mob-ctr-sel${x.id === m.id ? " ativo" : ""}" data-mob-sel="${esc(x.id)}" aria-pressed="${x.id === m.id ? "true" : "false"}">${uiCodigo(mobTagDe(x) || "a definir")} <span class="meta">${esc(MOB_STATUS[x.status] || x.status)}</span></button>`).join("")}
    </div>

    <div class="mob-ctr-maquina">
      <div class="odoo-statusbar informativa" aria-label="Status da máquina ${esc(tag)}">${uiStatusbar(MOB_ETAPAS, m.status)}</div>
      <div class="mob-acoes">
        <span class="rotulo-caps">Máquina ${esc(tag)}</span>
        ${transicoesDe(m, false) || `<span class="meta">Sem ações de status disponíveis.</span>`}
        ${m.movimentacao_remessa_id ? `<span class="mob-chip ok">remessa gerada</span>` : ""}${m.movimentacao_retorno_id ? `<span class="mob-chip ok">retorno gerado</span>` : ""}
        ${m.desmob_motivo ? `<span class="mob-chip" title="Motivo informado na desmobilização">${esc(MOB_DESMOB_MOTIVOS[m.desmob_motivo] || m.desmob_motivo)}</span>` : ""}
        ${m.volta_prevista ? `<span class="mob-chip aviso" title="A máquina volta à obra depois da manutenção na sede">volta prevista</span>` : ""}
        ${m.origem_mobilizacao_id ? `<a href="#" class="mob-chip" id="mob-ver-origem" title="Esta mobilização nasceu da volta da sede de outra mobilização">origem: volta da sede</a>` : ""}
      </div>
    </div>

    <div class="odoo-notebook" id="mob-notebook" role="tablist">
      ${MOB_ABAS.map(([k2, rot]) => `<button type="button" role="tab" data-aba="${esc(k2)}" class="${k2 === abaAtual ? "ativo" : ""}" aria-selected="${k2 === abaAtual ? "true" : "false"}">${esc(rot)}${k2 === "equipe" && nEq.length ? ` <span class="conf-badge">${esc(nLib)}/${esc(nEq.length)}</span>` : ""}${k2 === "pendencias" && (pendAbCtr + pendAbMaq) ? ` <span class="conf-badge">${esc(pendAbCtr + pendAbMaq)}</span>` : ""}</button>`).join("")}
    </div>

    ${pane("maquinas",
      uiSecao("maquina", "Máquinas do contrato", tabMaquinas, `${ms.length}`)
      + uiSecao("maquina", `Máquina ${tag}`, `<div class="grade">
          <div class="campo"><label for="mob-data-prev">Mobilização prevista</label><input type="date" id="mob-data-prev" value="${esc(m.data_mobilizacao_prev || "")}" /></div>
          <div class="campo"><label for="mob-data-inicio">Início de obra previsto</label><input type="date" id="mob-data-inicio" value="${esc(m.data_inicio_obra_prev || "")}" /></div>
          <div class="campo"><label for="mob-equip">TAG principal</label><select id="mob-equip">${mobEquipOpts(m.equipamento_id)}</select></div>
          <div class="campo"><label for="mob-data-saida">Saída real</label><input type="date" id="mob-data-saida" value="${esc(m.data_saida_real || "")}" /></div>
          <div class="campo"><label for="mob-data-chegada">Chegada real</label><input type="date" id="mob-data-chegada" value="${esc(m.data_chegada_real || "")}" /></div>
          <div class="campo"><label for="mob-data-desmob-prev">Desmobilização prevista</label><input type="date" id="mob-data-desmob-prev" value="${esc(m.data_desmob_prev || "")}" title="Data em que a máquina deve sair da obra. A Logística recebe o aviso 10 dias antes para programar a volta." />
            <span class="meta" id="mob-desmob-sug"></span></div>
          <div class="campo"><label for="mob-data-desmob">Desmobilização real</label><input type="date" id="mob-data-desmob" value="${esc(m.data_desmob_real || "")}" /></div>
          <div class="campo largo"><label>TAGs de apoio (bomba, compressor, gerador)</label>${mobApoioHTML("mob")}</div>
        </div>`)
      + uiSecao("check", "Observações técnicas", `<div class="grade">
          <div class="campo"><label for="mob-concreto">Concreto usinado</label>${simNao("mob-concreto", m.concreto_usinado)}</div>
          <div class="campo"><label for="mob-martelo">Martelo</label>${simNao("mob-martelo", m.martelo)}</div>
          <div class="campo"><label for="mob-tricone">Tricone</label>${simNao("mob-tricone", m.tricone)}</div>
          <div class="campo"><label for="mob-torre">Torre baixa</label>${simNao("mob-torre", m.torre_baixa)}</div>
        </div>`)
      + uiSecao("check", "Checklist do equipamento (antes de mobilizar; só avisa)", `<div id="mob-checklist">${uiVazio("Carregando…")}</div>`))}

    ${pane("equipe", `<div id="mob-equipe"></div>`)}

    ${pane("kit",
      (anterior && mobKitEditavel() && (anterior.acessorios_ids || []).length ? `<p class="aviso atencao mob-aviso-bloco" id="mob-kit-troca">Troca de máquina: a ${esc(mobTagDe(anterior) || "máquina anterior")} saiu com ${esc((anterior.acessorios_ids || []).length)} peça(s) no kit. <button type="button" class="btn-sec btn-sm" id="btn-mob-kit-troca" title="Coloca as peças do kit da máquina trocada como sugestão; confira e salve o kit">Usar como sugestão</button></p>` : "")
      + uiSecao("documento", `Separação · ${tag}`, `<div id="mob-sep" class="mob-card-chips"></div>`)
      + uiSecao("documento", `Acessórios (kit) · ${tag}`, `<div id="mob-kit">${uiVazio("Carregando peças…")}</div>`)
      + uiSecao("documento", `Materiais · ${tag}`, `<p class="meta">Consumíveis e peças sem marcação; viram itens da separação.</p><div id="mob-materiais">${uiVazio("Carregando…")}</div>`))}

    ${pane("escopo", uiSecao("documento", `Estacas · ${tag}`, `<p class="meta">Resumo do projeto para a máquina; o detalhe fica na aba Estacas da obra.</p>
      <div class="tabela-rola"><table class="itens-tabela mob-est-tabela">
        <thead><tr><th>Qtd.</th><th>Ø (mm)</th><th>Prof. mín. (m)</th><th>Prof. máx. (m)</th><th>Obs.</th><th></th></tr></thead>
        <tbody id="mob-est-tbody">${est.map(e => mobEstacaLinhaHTML(e)).join("")}</tbody>
      </table></div>
      <button type="button" class="btn-sec btn-sm" id="btn-mob-est-add">+ linha</button>`))}

    ${pane("condicoes",
      `<p class="meta">Contato e condições valem para o contrato: ao salvar, gravam em todas as máquinas em andamento desta obra.</p>`
      + uiSecao("nota", "Contato na obra", `<div class="grade">
          <div class="campo"><label for="mob-contato-nome">Contato na obra</label><input id="mob-contato-nome" value="${esc(m.contato_obra_nome || "")}" /></div>
          <div class="campo"><label for="mob-contato-tel">Telefone</label><input id="mob-contato-tel" value="${esc(m.contato_obra_telefone || "")}" /></div>
        </div>`)
      + uiSecao("nota", "Condições", `<div class="grade">
          <div class="campo"><label for="mob-alim">Alimentação interna por</label>${porQuem("mob-alim", m.alimentacao_interna_por)}</div>
          <div class="campo"><label for="mob-diesel">Diesel por</label>${porQuem("mob-diesel", m.diesel_por)}</div>
          <div class="campo"><label for="mob-hosp">Hospedagem por</label>${porQuem("mob-hosp", m.hospedagem_por)}</div>
          <div class="campo largo"><label for="mob-obs">Observações</label><textarea id="mob-obs" rows="2">${esc(m.observacoes || "")}</textarea></div>
        </div>`))}

    ${pane("pendencias",
      uiSecao("check", "Do contrato (uma vez por obra)", mobPendLinhasHTML(_mobPendObra), `${pendAbCtr} aberta(s)`)
      + uiSecao("check", `Da máquina ${tag}`, mobPendLinhasHTML(_mobPendAberta), `${pendAbMaq} aberta(s)`))}

    ${pane("viagens",
      uiSecao("maquina", `Viagens · ${tag}`, `<div id="mob-viagens" class="mob-card-chips">${uiVazio("Carregando viagens…")}</div>`)
      + uiSecao("documento", `Notas · ${tag}`, (m.movimentacao_remessa_id || m.movimentacao_retorno_id)
          ? `<div class="mob-card-chips">${m.movimentacao_remessa_id ? linkMovimentacao(m.movimentacao_remessa_id, "Nota de remessa") : ""} ${m.movimentacao_retorno_id ? linkMovimentacao(m.movimentacao_retorno_id, "Nota de retorno") : ""}</div>`
          : uiVazio("A remessa nasce na saída para a obra; o retorno, na desmobilização.")))}

    ${pane("conversa", `<p class="meta">Conversa da máquina ${esc(tag)} (cada máquina tem a sua).</p><div id="mob-chatter"></div>`)}
  `;

  $("btn-mob-fechar")?.addEventListener("click", fecharMobilizacao);
  $("btn-mob-salvar")?.addEventListener("click", () => comBotaoTravado("btn-mob-salvar", salvarMobilizacao));
  $("btn-mob-ctr-maquina")?.addEventListener("click", () => { const obra = m.obra_id; fecharMobilizacao(); abrirNovaMobilizacao(obra); });
  $("btn-mob-est-add")?.addEventListener("click", () => $("mob-est-tbody").insertAdjacentHTML("beforeend", mobEstacaLinhaHTML({})));
  cont.querySelectorAll("#mob-notebook button[data-aba]").forEach(b => b.addEventListener("click", () => {
    _mobAba = b.dataset.aba;
    cont.querySelectorAll("#mob-notebook button[data-aba]").forEach(x => { x.classList.toggle("ativo", x === b); x.setAttribute("aria-selected", x === b ? "true" : "false"); });
    cont.querySelectorAll(".mob-aba").forEach(p => { p.hidden = p.dataset.aba !== _mobAba; });
  }));
  cont.querySelectorAll("[data-mob-sel]").forEach(b => b.addEventListener("click", () => { if(b.dataset.mobSel !== m.id) abrirMobilizacao(b.dataset.mobSel); }));
  cont.querySelectorAll("[data-mob-tr]").forEach(b => b.addEventListener("click", async () => {
    const id = b.dataset.mobId, st = b.dataset.mobTr;
    if(id !== _mobAberta?.id){ await abrirMobilizacao(id); mudarStatusMobilizacao(st, null); }
    else mudarStatusMobilizacao(st, b);
  }));
  cont.querySelectorAll("input[type=checkbox][data-pend]").forEach(cb => cb.addEventListener("change", () => concluirPendenciaMob(cb.dataset.pend, cb.checked, cb)));
  cont.querySelectorAll(".mob-pend-resp").forEach(s => s.addEventListener("change", () => atualizarPendenciaMob(s.dataset.pend, { responsavel_id: s.value || null })));
  cont.querySelectorAll(".mob-pend-prazo").forEach(i => i.addEventListener("change", () => atualizarPendenciaMob(i.dataset.pend, { prazo: i.value || null })));
  cont.querySelectorAll(".mob-pend-obs").forEach(i => i.addEventListener("change", () => atualizarPendenciaMob(i.dataset.pend, { observacao: i.value.trim() || null })));
  cont.addEventListener("click", (e) => { if(e.target.classList.contains("mob-est-rem")) e.target.closest("tr").remove(); });
  $("btn-mob-kit-troca")?.addEventListener("click", () => { mobKitAdicionar([...(anterior?.acessorios_ids || [])]); });
  if(typeof montarHistorico === "function") montarHistorico("mobilizacoes", m.id, "mob-chatter");
  mobLigarApoio("mob", m.obra_id, "mob-equip");
  mobRenderEquipeFicha();
  mobRenderKit();
  mobRenderMateriais();
  mobRenderSeparacao();
  mobRenderViagens();
  if(typeof manRenderChecklistMob === "function") manRenderChecklistMob(m, "mob-checklist");
  $("mob-ver-origem")?.addEventListener("click", e => { e.preventDefault(); abrirMobilizacao(m.origem_mobilizacao_id); });
  mobSugerirDesmobPrev(m);
}

/* ---------- Aba Equipe e SESMT ---------- */
function mobEqSituacaoChip(e){
  const s = MOB_EQ_SITUACAO[e.situacao] || { rot: e.situacao, cls: "" };
  return `<span class="mob-chip ${esc(s.cls)}">${esc(s.rot)}</span>`;
}
function mobEqSituacaoSelect(e){
  return `<select data-eq-sit="${esc(e.id)}" aria-label="Situação no SESMT de ${esc(mobNomeEq(e))}">${Object.entries(MOB_EQ_SITUACAO).map(([k, s]) => `<option value="${esc(k)}"${k === e.situacao ? " selected" : ""}>${esc(s.rot)}</option>`).join("")}</select>`;
}
function mobRenderEquipeFicha(){
  const box = $("mob-equipe"); const m = _mobAberta;
  if(!box || !m) return;
  const pode = mobEquipePodeEditar();
  const ms = mobsDoContrato(m.obra_id);
  if(!ms.some(x => x.id === m.id)) ms.push(mobLiveDe(m.id) || m);
  box.innerHTML = `<p class="meta">Por máquina, quem vai e a situação de liberação no SESMT. A sugestão vem da alocação ativa na TAG e só entra quando alguém confirma. "Saiu para a obra" com alguém não liberado pede confirmação e fica registrado na conversa.</p>`
    + ms.map(x => {
      const eq = mobEquipeDe(x.id).sort((a, b) => mobNomeEq(a).localeCompare(mobNomeEq(b), "pt-BR"));
      const naEq = new Set(eq.map(e => e.funcionario_id));
      const sug = [];
      _mobSugAloc.filter(a => a.equipamento_id && a.equipamento_id === x.equipamento_id && !naEq.has(a.funcionario_id))
        .forEach(a => { if(!sug.some(s => s.funcionario_id === a.funcionario_id)) sug.push({ funcionario_id: a.funcionario_id, nome: a.funcionario?.nome || "?", funcao: a.funcionario?.funcao || "", origem: "alocação ativa na TAG" }); });
      const ant = mobTrocaAnterior(x);
      if(ant) mobEquipeDe(ant.id).filter(e => !naEq.has(e.funcionario_id) && !sug.some(s => s.funcionario_id === e.funcionario_id))
        .forEach(e => sug.push({ funcionario_id: e.funcionario_id, nome: mobNomeEq(e), funcao: e.funcao || "", origem: `equipe da ${mobTagDe(ant) || "máquina"} trocada` }));
      const lib = eq.filter(mobEqLiberado).length;
      const corpo = (eq.length && x.status === "em_obra" && mobPodeMoverAlocacao()
          ? `<div class="mob-eq-sug"><button type="button" class="btn-sec btn-sm" data-eq-aloc="${esc(x.id)}" title="Lista a equipe desta máquina e move a alocação de quem você marcar para esta obra e TAG, desde a data da chegada">Mover a alocação da equipe</button></div>` : "")
        + (eq.length ? `<div class="mob-pend-lista">${eq.map(e => `<div class="mob-pend mob-eq-linha">
          ${uiAvatar(mobNomeEq(e))}
          <span class="mob-pend-txt"><span class="mob-pend-titulo">${esc(mobNomeEq(e))}${e.funcao ? ` <span class="meta">${esc(e.funcao)}</span>` : ""}</span>${e.atualizado_em ? `<span class="meta">atualizado em ${esc(dataHoraBR(e.atualizado_em))}</span>` : ""}</span>
          ${pode ? mobEqSituacaoSelect(e) : mobEqSituacaoChip(e)}
          ${pode ? `<input type="text" class="mob-eq-obs" data-eq-obs="${esc(e.id)}" value="${esc(e.observacao || "")}" placeholder="observação" />
            <button type="button" class="btn-rem" data-eq-rem="${esc(e.id)}" title="Tirar da equipe desta máquina" aria-label="Tirar ${esc(mobNomeEq(e))} da equipe">&times;</button>` : (e.observacao ? `<span class="meta">${esc(e.observacao)}</span>` : "")}
        </div>`).join("")}</div>` : uiVazio("Ninguém na equipe desta máquina."))
        + (pode && sug.length ? `<div class="mob-eq-sug">
            <span class="rotulo-caps">Sugestão para confirmar</span>
            ${sug.map(s => `<span class="mob-chip" title="${esc(s.origem)}">${esc(s.nome)}${s.funcao ? ` · ${esc(s.funcao)}` : ""} <button type="button" class="mob-link-btn" data-eq-add="${esc(x.id)}" data-func="${esc(s.funcionario_id)}" data-funcao="${esc(s.funcao)}">confirmar</button></span>`).join("")}
            ${sug.length > 1 ? `<button type="button" class="btn-sec btn-sm" data-eq-add-todos="${esc(x.id)}">Confirmar todos (${esc(sug.length)})</button>` : ""}
          </div>` : "")
        + (pode ? `<div class="mob-eq-busca"><input type="text" data-eq-busca="${esc(x.id)}" placeholder="adicionar pessoa pelo nome…" autocomplete="off" aria-label="Adicionar pessoa à equipe da ${esc(mobTagDe(x) || "máquina")}" />
            <div class="autocomplete-lista" data-eq-res="${esc(x.id)}" style="display:none;"></div></div>` : "");
      box._sug = box._sug || {}; box._sug[x.id] = sug;
      return uiSecao("equipe", `${mobTagDe(x) || "a definir"} · ${MOB_STATUS[x.status] || x.status} · ${mobDataMaquina(x)}`, corpo, eq.length ? `${lib} de ${eq.length} liberados` : "");
    }).join("");
  box.querySelectorAll("select[data-eq-sit]").forEach(s => s.addEventListener("change", () => mobEquipeAtualizar(s.dataset.eqSit, { situacao: s.value }, s)));
  box.querySelectorAll("input[data-eq-obs]").forEach(i => i.addEventListener("change", () => mobEquipeAtualizar(i.dataset.eqObs, { observacao: i.value.trim() || null })));
  box.querySelectorAll("[data-eq-rem]").forEach(b => b.addEventListener("click", () => mobEquipeRemover(b.dataset.eqRem)));
  box.querySelectorAll("[data-eq-add]").forEach(b => b.addEventListener("click", () => mobEquipeAdicionar(b.dataset.eqAdd, [{ funcionario_id: b.dataset.func, funcao: b.dataset.funcao || null }])));
  box.querySelectorAll("[data-eq-add-todos]").forEach(b => b.addEventListener("click", () => mobEquipeAdicionar(b.dataset.eqAddTodos, (box._sug[b.dataset.eqAddTodos] || []).map(s => ({ funcionario_id: s.funcionario_id, funcao: s.funcao || null })))));
  box.querySelectorAll("[data-eq-aloc]").forEach(b => b.addEventListener("click", () => mobOferecerMoverAlocacao(b.dataset.eqAloc)));   // fase 157e
  box.querySelectorAll("input[data-eq-busca]").forEach(inp => mobLigarBuscaPessoa(inp, box.querySelector(`[data-eq-res="${inp.dataset.eqBusca}"]`), inp.dataset.eqBusca));
  mobAtualizarBadgeEquipe();
}
function mobAtualizarBadgeEquipe(){
  const b = document.querySelector('#mob-notebook button[data-aba="equipe"]'); if(!b || !_mobAberta) return;
  const eq = mobEquipeDe(_mobAberta.id);
  b.innerHTML = `Equipe e SESMT${eq.length ? ` <span class="conf-badge">${esc(eq.filter(mobEqLiberado).length)}/${esc(eq.length)}</span>` : ""}`;
}
function mobLigarBuscaPessoa(inp, lista, mobId){
  if(!inp || !lista) return;
  const buscar = debounce(async () => {
    const termo = inp.value.trim();
    if(termo.length < 2){ lista.style.display = "none"; lista.innerHTML = ""; return; }
    const { data, error } = await sb.from("funcionarios").select("id,nome,funcao").eq("ativo", true).ilike("nome", `%${termo.replace(/[%_,()]/g, " ")}%`).order("nome").limit(15);
    if(error){ lista.innerHTML = `<div class="resultado-item vazio">${esc(error.message)}</div>`; lista.style.display = ""; return; }
    const ja = new Set(mobEquipeDe(mobId).map(e => e.funcionario_id));
    lista.innerHTML = (data || []).map(f => `<div class="resultado-item${ja.has(f.id) ? " ja" : ""}" data-id="${esc(f.id)}" data-funcao="${esc(f.funcao || "")}"><strong>${esc(f.nome)}</strong>${f.funcao ? ` <span class="meta">${esc(f.funcao)}</span>` : ""}${ja.has(f.id) ? ' <span class="meta">· já na equipe</span>' : ""}</div>`).join("")
      || `<div class="resultado-item vazio">Ninguém com esse nome.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("mousedown", ev => {
      ev.preventDefault();
      if(ja.has(d.dataset.id)) return;
      inp.value = ""; lista.style.display = "none";
      mobEquipeAdicionar(mobId, [{ funcionario_id: d.dataset.id, funcao: d.dataset.funcao || null }]);
    }));
  }, 250);
  inp.addEventListener("input", buscar);
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 150));
}
async function mobEquipeAdicionar(mobId, pessoas){
  if(!mobEquipePodeEditar()){ aviso("app-aviso", "Seu cargo não monta a equipe da mobilização.", "erro"); return; }
  const regs = pessoas.filter(p => p.funcionario_id).map(p => ({ mobilizacao_id: mobId, funcionario_id: p.funcionario_id, funcao: p.funcao || null, situacao: "pendente" }));
  if(!regs.length) return;
  const { data, error } = await sb.from("mobilizacao_equipe").insert(regs).select(MOB_EQ_SELECT);
  if(error){ aviso("app-aviso", "Não foi possível pôr na equipe: " + (/duplicate|unique/i.test(error.message) ? "essa pessoa já está na equipe desta máquina." : error.message), "erro"); return; }
  _mobEquipe.push(...(data || []));
  aviso("app-aviso", `${(data || []).length} pessoa(s) na equipe, com a situação pendente no SESMT.`, "ok");
  mobRenderEquipeFicha();
}
async function mobEquipeAtualizar(id, campos, sel){
  const antes = _mobEquipe.find(e => e.id === id);
  const { data, error } = await sb.from("mobilizacao_equipe").update(campos).eq("id", id).select("id,atualizado_em");
  if(error || !data?.length){
    aviso("app-aviso", "Não foi possível atualizar: " + (error ? error.message : "seu cargo não muda a equipe da mobilização."), "erro");
    if(sel && antes) sel.value = antes.situacao;
    return;
  }
  if(antes) Object.assign(antes, campos, { atualizado_em: data[0].atualizado_em });
  if(campos.situacao) aviso("app-aviso", `${antes ? mobNomeEq(antes) : "Pessoa"}: ${(MOB_EQ_SITUACAO[campos.situacao] || {}).rot || campos.situacao}.`, "ok");
  if($("mob-equipe") && _mobAberta) mobRenderEquipeFicha();
  else if(_mobView === "pendencias") renderMobilizacoes();
}
async function mobEquipeRemover(id){
  const e = _mobEquipe.find(x => x.id === id);
  if(!confirm(`Tirar ${e ? mobNomeEq(e) : "esta pessoa"} da equipe desta máquina?`)) return;
  const { data, error } = await sb.from("mobilizacao_equipe").delete().eq("id", id).select("id");
  if(error || !data?.length){ aviso("app-aviso", "Não foi possível tirar da equipe: " + (error ? error.message : "seu cargo não muda a equipe da mobilização."), "erro"); return; }
  _mobEquipe = _mobEquipe.filter(x => x.id !== id);
  mobRenderEquipeFicha();
}
/* D6: quem ainda não foi liberado pelo SESMT na equipe desta máquina */
function mobEquipeNaoLiberados(mobId){ return mobEquipeDe(mobId).filter(e => !mobEqLiberado(e)); }
async function mobRegistrarSaidaSemLiberacao(mobId, pessoas){
  const txt = "Saída para a obra registrada com equipe não liberada pelo SESMT (confirmado na tela): "
    + pessoas.map(e => `${mobNomeEq(e)} (${(MOB_EQ_SITUACAO[e.situacao] || {}).rot || e.situacao})`).join(", ") + ".";
  const { error } = await sb.rpc("chatter_publicar", { p_entidade: "mobilizacoes", p_registro_id: mobId, p_tipo: "nota", p_texto: txt, p_mencionados: [] });
  if(error) aviso("app-aviso", "A saída foi registrada, mas a nota na conversa não: " + error.message, "erro");
}

/* ---------- Fase 157e: equipe ligada à Alocação ----------
   Na chegada da máquina ("Chegou na obra"), ou depois pela aba Equipe e SESMT, quem pode movimentar funcionário
   (lotacaoPodeOperar: diretor, admin, logística, RH) confirma pessoa a pessoa quem passa a ficar alocado na obra e na
   TAG desde a data da chegada. Grava pela RPC mobilizacao_mover_equipe, que chama a funcionario_movimentar da fase 151
   (mesma regra e mesmo histórico). D7: desmobilizar não mexe na alocação. */
let _mobAlocCtx = null;
function mobPodeMoverAlocacao(){ return typeof lotacaoPodeOperar === "function" && lotacaoPodeOperar(); }
function mobAlocRotulo(obra, tag){ return `${obra || "sem obra"}${tag ? "/" + tag : ""}`; }
async function mobOferecerMoverAlocacao(mobId){
  if(!mobPodeMoverAlocacao()) return;
  const { data: m, error } = await sb.from("mobilizacoes").select("id,obra_id,equipamento_id,status,data_chegada_real").eq("id", mobId).maybeSingle();
  if(error || !m || m.status !== "em_obra" || !m.data_chegada_real || !m.equipamento_id) return;
  const { data: eq } = await sb.from("mobilizacao_equipe").select("funcionario_id,funcao,funcionario:funcionarios(nome)").eq("mobilizacao_id", mobId);
  if(!(eq || []).length) return;
  const ids = eq.map(e => e.funcionario_id);
  const [{ data: alocs }, { data: obra }, { data: equip }] = await Promise.all([
    sb.from("alocacoes").select("funcionario_id,obra_id,equipamento_id,data_inicio,obra:obras(codigo),equipamento:equipamentos(codigo)").eq("status", "ativa").in("funcionario_id", ids),
    sb.from("obras").select("codigo").eq("id", m.obra_id).maybeSingle(),
    sb.from("equipamentos").select("codigo").eq("id", m.equipamento_id).maybeSingle()
  ]);
  const destino = mobAlocRotulo(obra?.codigo, equip?.codigo);
  const pessoas = eq.map(e => {
    const a = (alocs || []).find(x => x.funcionario_id === e.funcionario_id);
    const nome = e.funcionario?.nome || "?";
    if(a && a.obra_id === m.obra_id && a.equipamento_id === m.equipamento_id)
      return { id: e.funcionario_id, nome, pode: false, txt: `já alocado em ${destino} desde ${dataBR(a.data_inicio)}` };
    if(a && a.data_inicio >= m.data_chegada_real)
      return { id: e.funcionario_id, nome, pode: false, txt: `período atual em ${mobAlocRotulo(a.obra?.codigo, a.equipamento?.codigo)} começou em ${dataBR(a.data_inicio)}, depois da chegada: corrija pela ficha do funcionário` };
    const saida = mobSomarDias(m.data_chegada_real, -1);
    return { id: e.funcionario_id, nome, pode: true,
      txt: (a ? `sai de ${mobAlocRotulo(a.obra?.codigo, a.equipamento?.codigo)} em ${dataBR(saida)}, ` : "sem alocação ativa, ") + `entra em ${destino} em ${dataBR(m.data_chegada_real)}` };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if(!pessoas.some(p => p.pode)) return;
  _mobAlocCtx = { mobId };
  $("mobal-texto").textContent = `A máquina chegou em ${dataBR(m.data_chegada_real)}. Marque quem passa a ficar alocado em ${destino} a partir dessa data. Quem não for marcado continua onde está.`;
  $("mobal-lista").innerHTML = pessoas.map(p => `<label class="mob-pend mob-eq-linha">
      <input type="checkbox" data-mobal="${esc(p.id)}" ${p.pode ? "checked" : "disabled"} />
      <span class="mob-pend-txt"><span class="mob-pend-titulo">${esc(p.nome)}</span><span class="meta">${esc(p.txt)}</span></span>
    </label>`).join("");
  $("mob-aloc-modal").style.display = "flex";
}
function fecharMoverAlocacaoMob(){ $("mob-aloc-modal").style.display = "none"; _mobAlocCtx = null; }
async function confirmarMoverAlocacaoMob(){
  if(!_mobAlocCtx) return;
  if(!mobPodeMoverAlocacao()){ aviso("app-aviso", "Seu cargo não movimenta funcionário.", "erro"); return; }
  const ids = [...document.querySelectorAll("#mobal-lista input[data-mobal]:checked")].map(i => i.dataset.mobal);
  if(!ids.length){ fecharMoverAlocacaoMob(); return; }
  const { data, error } = await sb.rpc("mobilizacao_mover_equipe", { p_mobilizacao: _mobAlocCtx.mobId, p_funcionarios: ids });
  if(error){ aviso("app-aviso", "Não foi possível mover a alocação: " + error.message, "erro"); return; }
  const recus = (data?.pessoas || []).filter(p => p.resultado === "recusado");
  aviso("app-aviso", `Alocação movida para ${data?.movidos || 0} pessoa(s) desde ${dataBR(data?.data)}.`
    + (recus.length ? ` Não movidos: ${recus.map(p => `${p.nome || "?"} (${p.mensagem})`).join("; ")}.` : ""), recus.length ? "erro" : "ok");
  fecharMoverAlocacaoMob();
  if(_mobAberta && $("mob-equipe")){ await mobCarregarSugestoesEquipe(_mobAberta.obra_id); mobRenderEquipeFicha(); }
}

/* ====================================================================
   Módulo: Equipamentos (fase 50 — plano de acessórios §4.1)
   Máquinas de produção: tipo not in (caminhao, veiculo) — esses são da Frota.
   Painel (kanban por status / lista / Vendas) + ficha Odoo (Geral · Ficha técnica ·
   Acessórios por Ø · Mobilizações · Movimentações · Reparos & manutenções · Custos · Venda · Timeline).
   Localização vem do trigger de movimentação; aqui só se corrige o cadastro.
   Fase 96: venda do bem (botão "Registrar venda", etapa Vendido, aba Venda, visão Vendas) em js/vendas_bens.js;
   bem vendido sai do kanban/lista e a ficha fica só para consulta.
   ==================================================================== */

let _eqpView = "kanban";
let _eqpKpi = "";
let _eqpRegistros = [];
let _eqpObras = [];
let _eqpObraMap = {};
let _eqpCarregado = false;
let _eqpAtual = null;          // registro aberto
let _eqpEditId = null;         // null = novo
let _eqpAceModo = "";          // filtro da aba Acessórios
let _eqpAceCache = { id: null, na: [], pertence: [], compat: [] };
// valor e data de aquisição: moram em equipamentos_financeiro (leem diretoria, financeiro e auditor; gravam diretoria e financeiro)
let _eqpValorBem = null;             // da ficha aberta: { equipId, disponivel, valor, data }
let _eqpValorBemSemTabela = false;   // o banco ainda não tem a tabela: não pergunta de novo nesta página

const EQP_TIPOS = ["perfuratriz","bate_estaca","escavadeira","retroescavadeira","guindaste","compressor","gerador","bomba","ferramenta","outro"];
const EQP_TIPO_LBL = { perfuratriz: "Perfuratriz", bate_estaca: "Bate-estaca", escavadeira: "Escavadeira", retroescavadeira: "Retroescavadeira", guindaste: "Guindaste", compressor: "Compressor", gerador: "Gerador", bomba: "Bomba", ferramenta: "Ferramenta", outro: "Outro" };
const EQP_LOCAL_LBL = { base: "Base", obra: "Obra", em_transito: "Em trânsito", fornecedor_manutencao: "Fornecedor / manutenção", cliente: "Cliente", vendido: "Vendido" };
const EQP_LOCAL_COR = { base: "verde", obra: "azul", em_transito: "ambar", fornecedor_manutencao: "ambar", cliente: "azul", vendido: "cinza" };
/* fase 96: bem vendido (status e localização "vendido", nascidos do registro da venda) sai das visões operacionais
   (kanban, lista, filtros, KPIs) e fica só na visão Vendas e na própria ficha, para consulta */
const EQP_FORA_OPERACAO = ["vendido"];
const EQP_MOB_ATIVA = ["em_preparacao","em_transito","em_obra"];

function eqpPodeEditar(){
  return !!usuarioAtual && ["admin","diretor","mecanico","engenheiro","logistica","rh","gestor_acessorios","gestor_frota"].includes(usuarioAtual.cargo);
}
function eqpLbl(v){ const o = (STATUS.equipamento || {})[v]; return o ? o.label : (v || "—"); }
function eqpObra(id){ const o = _eqpObraMap[id]; return o ? `${o.codigo} — ${o.nome}` : ((typeof mapaObras === "object" && mapaObras && mapaObras[id]) || ""); }
function eqpOnde(e){
  const d = e.localizacao_descricao ? ` · ${e.localizacao_descricao}` : "";
  switch(e.localizacao_tipo){
    case "obra":        return (e.localizacao_obra_id ? eqpObra(e.localizacao_obra_id) : "Obra") + d;
    case "em_transito": return "Em trânsito" + (e.localizacao_obra_id ? " → " + eqpObra(e.localizacao_obra_id) : "") + d;
    case "fornecedor_manutencao": return "Fornecedor / manutenção" + d;
    case "cliente":     return "Cliente" + d;
    case "vendido":     return "Vendido" + (e.baixa_em ? " em " + dataBR(e.baixa_em) : "");   // fase 96
    default:            return "Base" + d;
  }
}
function eqpOndeHTML(e){
  const t = e.localizacao_tipo || "base";
  const txt = e.localizacao_obra_id && (t === "obra" || t === "em_transito")
    ? `${t === "em_transito" ? "Em trânsito → " : ""}${linkObra(e.localizacao_obra_id, eqpObra(e.localizacao_obra_id) || "Obra")}${e.localizacao_descricao ? " · " + esc(e.localizacao_descricao) : ""}`
    : esc(eqpOnde(e));
  return `<span class="tag ${esc(EQP_LOCAL_COR[t] || "cinza")}">${esc(EQP_LOCAL_LBL[t] || t)}</span> ${txt}`;
}
function eqpTag(e){ return `${e.codigo}${e.nome ? " · " + e.nome : ""}`; }
function eqpOrd(a, b){ return String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }); }
function eqpNumAce(e){ return Number(e._ace) || 0; }

/* ---------- carga ---------- */
/* ---------- visão Horímetro semanal (lote S58, #232) ----------
   Grava em equipamento_leituras com origem "semanal", que só sobe (fn_equipamento_leitura_aplicar): valor menor fica marcado e
   não é gravado; a correção para baixo segue pelo Ajustar, com motivo. Inclui caminhões e veículos, que o resto do painel não lista. */
let _eqpSem = [], _eqpSemOk = false, _eqpSemUltima = {}, _eqpSemOperador = {}, _eqpSemValores = {};
function eqpSemUsaKm(e){ return ["caminhao", "veiculo"].includes(e.tipo) || (e.km != null && e.horimetro == null); }
function eqpSemPode(){ return eqpPodeManutencao() && !ehSomenteLeitura(); }
function eqpSemAtual(e){ return eqpSemUsaKm(e) ? e.km : e.horimetro; }

/* lote S63-f (#283): partes puras da visão, testadas em scripts/testar-loteS63f.mjs (o teste lê o bloco entre os marcadores). */
// S63F-INICIO
function eqpSemTxtNorm(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase(); }
// mais recente primeiro: data do registro e, no mesmo dia, o que foi lançado por último
function eqpSemMaisRecente(a, b){ return String(b.data || "").localeCompare(String(a.data || "")) || String(b.created_at || "").localeCompare(String(a.created_at || "")); }
/* Último lançamento de cada máquina em equipamento_leituras: a leitura mais recente que tem o campo da máquina (horímetro ou km,
   campoDe(equipamento_id) diz qual). Devolve { equipamento_id: { data, valor } }. */
function eqpSemUltimaLeitura(leituras, campoDe){
  const out = {};
  [...(leituras || [])].sort(eqpSemMaisRecente).forEach(l => {
    if(!l || !l.equipamento_id || out[l.equipamento_id]) return;
    const v = l[campoDe(l.equipamento_id)];
    if(v == null || v === "") return;
    out[l.equipamento_id] = { data: l.data, valor: Number(v) };
  });
  return out;
}
/* Operador pela função do RH (funcionarios.funcao), como o funcaoRdoDoCargo do RDO: "Operador de Caminhão" é motorista. */
function eqpSemEhOperador(funcao){ const f = eqpSemTxtNorm(funcao); return f.includes("OPERADOR") && !f.includes("CAMINHAO"); }
function eqpSemOperaMaquina(funcao){ const f = eqpSemTxtNorm(funcao); return f.includes("MAQUINA") || f.includes("PERFURATRIZ"); }
/* Operador do último RDO de cada máquina (rdo.equipamento_id) que tem operador na equipe (rdo_equipe → funcionarios). RDO sem
   operador na equipe é pulado e vale o anterior da mesma máquina. Com operador de máquinas e outro operador (betoneira, bomba),
   fica o de máquinas; dois de máquinas no mesmo RDO saem os dois. Devolve { equipamento_id: { nomes: [...], data } }. */
function eqpSemUltimoOperador(rdos){
  const out = {};
  [...(rdos || [])].sort(eqpSemMaisRecente).forEach(r => {
    if(!r || !r.equipamento_id || out[r.equipamento_id]) return;
    const ops = (r.rdo_equipe || []).map(q => q && q.funcionarios).filter(f => f && f.nome && eqpSemEhOperador(f.funcao));
    if(!ops.length) return;
    const maq = ops.filter(f => eqpSemOperaMaquina(f.funcao));
    const nomes = [...new Set((maq.length ? maq : ops).map(f => f.nome))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    out[r.equipamento_id] = { nomes, data: r.data };
  });
  return out;
}
// S63F-FIM

/* lote S63-g (#284): equipamento vinculado (munck no caminhão) logo abaixo do principal. As linhas vêm da
   vw_equipamentos_horimetro_semanal: grupo_codigo = TAG do principal (ou a própria) e nivel = 0 principal, 1 vinculado.
   Testado em scripts/testar-loteS63g.mjs (o teste lê o bloco entre os marcadores). */
// S63G-INICIO
function eqpSemOrdenar(lista){
  const cmp = (a, b) => String(a || "").localeCompare(String(b || ""), "pt-BR", { numeric: true });
  return [...(lista || [])].sort((a, b) => cmp(a.grupo_codigo || a.codigo, b.grupo_codigo || b.codigo) || ((Number(a.nivel) || 0) - (Number(b.nivel) || 0)) || cmp(a.codigo, b.codigo));
}
// S63G-FIM

async function eqpSemCarregar(){
  const cont = $("eqp-conteudo"); if(!cont) return;
  cont.innerHTML = `<p class="vazio">Carregando leituras…</p>`;
  // lote S63-g (#284): a view traz o principal de cada vinculado (munck no caminhão), que sai logo abaixo dele
  const { data, error } = await sb.from("vw_equipamentos_horimetro_semanal").select("id,codigo,nome,tipo,horimetro,km,status,equipamento_principal_id,principal_codigo,principal_tipo,grupo_codigo,nivel").eq("ativo", true);
  if(_eqpView !== "semanal") return;   // trocou de visão enquanto carregava
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  _eqpSem = eqpSemOrdenar((data || []).filter(e => !EQP_FORA_OPERACAO.includes(e.status)));
  // lote S63-f (#283): último lançamento (data e valor) e operador do último RDO, uma leitura de cada tabela; as duas passam de 1.000 linhas
  const porId = Object.fromEntries(_eqpSem.map(e => [e.id, e]));
  const [lei, rdos] = await Promise.all([
    lerTudo(() => sb.from("equipamento_leituras").select("id,equipamento_id,data,horimetro,km,created_at")),
    lerTudo(() => sb.from("rdo").select("id,equipamento_id,data,created_at,rdo_equipe(funcionarios(nome,funcao))").not("equipamento_id", "is", null))
  ]);
  if(_eqpView !== "semanal") return;
  _eqpSemUltima = eqpSemUltimaLeitura(lei.data, id => (porId[id] && eqpSemUsaKm(porId[id])) ? "km" : "horimetro");
  _eqpSemOperador = rdos.error ? {} : eqpSemUltimoOperador(rdos.data);
  if(lei.error || rdos.error) aviso("app-aviso", "Parte da lista não carregou: " + (lei.error || rdos.error).message, "erro");
  _eqpSemOk = true;
  if(_eqpView === "semanal") eqpSemRender();
}
function eqpSemMarcar(linha, e){
  const v = _eqpSemValores[e.id], atual = eqpSemAtual(e);
  const menor = v !== undefined && v !== "" && atual != null && Number(v) < Number(atual);
  const msg = linha.querySelector(".eqp-sem-msg"); if(msg) msg.textContent = menor ? "menor que a atual: não será gravada; use Ajustar" : "";
}
// lote S63-f (#283): o botão Salvar, fixo acima da lista, mostra quantas leituras estão preenchidas
function eqpSemContarPreenchidas(){
  const b = $("btn-eqp-sem-salvar"); if(!b) return;
  const n = Object.values(_eqpSemValores).filter(v => v !== undefined && v !== "").length;
  b.textContent = n ? `Salvar leituras (${n})` : "Salvar leituras";
}
function eqpSemRender(){
  const cont = $("eqp-conteudo"); if(!cont) return;
  const q = ($("eqp-sem-busca")?.value || "").trim().toLowerCase(), grupo = $("eqp-sem-grupo")?.value || "";
  // lote S63-g (#284): o vinculado segue o grupo e a busca do principal (filtrar "47" traz o caminhão e o munck)
  const veic = e => ["caminhao", "veiculo"].includes(e.principal_tipo || e.tipo);
  const linhas = _eqpSem.filter(e => (!grupo || (grupo === "veiculos") === veic(e)) && (!q || `${e.codigo} ${e.nome || ""} ${e.principal_codigo || ""}`.toLowerCase().includes(q)));
  $("eqp-contador").textContent = `${linhas.length} de ${_eqpSem.length}`;
  const pode = eqpSemPode();
  const bs = $("btn-eqp-sem-salvar"); if(bs) bs.style.display = pode ? "" : "none";
  eqpSemContarPreenchidas();
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">Nenhuma máquina com esses filtros.</p>`; return; }
  const tipoTxt = t => ({ caminhao: "Caminhão", veiculo: "Veículo" })[t] || EQP_TIPO_LBL[t] || t || "";
  /* lote S63-f (#283): a lista rola dentro da caixa (.eqp-sem-rola), então o cabeçalho e o botão Salvar, logo acima, ficam à vista */
  cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">Preencha só as máquinas lidas na semana. A leitura só sobe; valor menor que o atual não é gravado e a correção é pelo Ajustar, com motivo.</p>
    <div class="tabela-rola eqp-sem-rola"><table><thead><tr><th>TAG</th><th>Equipamento</th><th title="Operador do último RDO desta máquina que tem operador na equipe">Operador</th><th class="num" title="Valor atual da máquina; a leitura nova não pode ser menor">Atual</th><th title="Data e valor do último registro de horímetro ou km desta máquina (RDO, OS, checklist, viagem ou semanal)">Último lançamento</th><th>Leitura nova</th><th class="col-acao"></th></tr></thead>
    <tbody>${linhas.map(e => { const km = eqpSemUsaKm(e), un = km ? "km" : "h", atual = eqpSemAtual(e), ult = _eqpSemUltima[e.id], op = _eqpSemOperador[e.id]; return `<tr data-eq="${esc(e.id)}">
      <td>${e.principal_codigo ? `<span class="meta" title="Montado em ${esc(e.principal_codigo)}">↳</span> ` : ""}<strong>${esc(e.codigo)}</strong></td><td>${esc(e.nome || "")} <span class="meta">${esc(tipoTxt(e.tipo))}${e.principal_codigo ? ` · no ${esc(e.principal_codigo)}` : ""}</span></td>
      <td>${op ? `${esc(op.nomes.join(", "))} <span class="meta">RDO ${esc(dataBR(op.data))}</span>` : '<span class="meta">—</span>'}</td>
      <td class="num">${atual != null ? esc(num(atual)) + " " + esc(un) : "—"}</td>
      <td>${ult ? `<span class="meta">${esc(dataBR(ult.data))}</span> · ${esc(num(ult.valor))} ${esc(un)}` : '<span class="meta">—</span>'}</td>
      <td><input type="number" class="eqp-sem-val" min="0" step="0.1" style="width:110px;text-align:right;" value="${esc(_eqpSemValores[e.id] ?? "")}" ${pode ? "" : "disabled"} /> <span class="meta">${esc(un)}</span> <span class="meta txt-perigo eqp-sem-msg"></span></td>
      <td class="col-acao">${pode ? '<button type="button" class="btn-sec btn-sm eqp-sem-ajustar" title="Correção com motivo, inclusive para baixo">Ajustar</button>' : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-eq]").forEach(tr => {
    const e = _eqpSem.find(x => x.id === tr.dataset.eq); if(!e) return;
    eqpSemMarcar(tr, e);
    tr.querySelector(".eqp-sem-val")?.addEventListener("input", ev => { _eqpSemValores[e.id] = ev.target.value; eqpSemMarcar(tr, e); eqpSemContarPreenchidas(); });
    tr.querySelector(".eqp-sem-ajustar")?.addEventListener("click", () => { if(typeof manLeituraAbrir === "function") manLeituraAbrir(e); });
  });
}
async function eqpSemSalvar(){
  if(!eqpSemPode()){ aviso("app-aviso", "Seu perfil não lança leitura de horímetro.", "erro"); return; }
  const novas = [], menores = [], salvos = [];
  _eqpSem.forEach(e => {
    const v = _eqpSemValores[e.id];
    if(v === undefined || v === "") return;
    const n = Number(v), atual = eqpSemAtual(e), km = eqpSemUsaKm(e);
    if(!(n >= 0)) return;
    if(atual != null && n < Number(atual)){ menores.push(e.codigo); return; }
    novas.push({ equipamento_id: e.id, data: hojeISO(), horimetro: km ? null : n, km: km ? n : null, origem: "semanal", autor_id: usuarioAtual.id });
    salvos.push(e.id);
  });
  if(!novas.length){ aviso("app-aviso", menores.length ? `Nada gravado: valor menor que o atual em ${menores.join(", ")}. Use Ajustar.` : "Preencha ao menos uma leitura.", "erro"); return; }
  const { error } = await sb.from("equipamento_leituras").insert(novas);
  if(error){ aviso("app-aviso", "Leituras não gravadas: " + error.message, "erro"); return; }
  salvos.forEach(id => { delete _eqpSemValores[id]; });
  aviso("app-aviso", `${novas.length} leitura(s) gravada(s).${menores.length ? ` Não gravadas, valor menor que o atual: ${menores.join(", ")}. Use Ajustar.` : ""}`, menores.length ? "aviso" : "ok");
  await carregarEquipamentos(true);
}

/* ---------- visão Valor para remessa (hotfix 11/11/2026) ----------
   A diretoria e o financeiro definem uma vez o valor declarado na NF-e de remessa de cada máquina: o valor contábil (da
   contabilidade), digitado aqui ou importado da planilha da contabilidade; sem valor contábil, o valor que eles digitarem. Primeiro as máquinas em obra ou em trânsito, depois as que já foram mobilizadas. Como referência,
   a aquisição (quem lê o valor do bem) e a avaliação de mercado (quem lê o Patrimônio); nunca para outros. Grava pela RPC
   equipamentos_definir_valor_remessa, que o banco só aceita da diretoria e do financeiro. */
let _eqpVrm = { ok: false, mobilizadas: new Set(), aquisicao: {}, avaliacao: {}, valores: {} };
const EQP_VRM_SIT = { 1: { txt: "Em obra", cor: "azul" }, 2: { txt: "Em mobilização", cor: "ambar" }, 3: { txt: "Já mobilizada", cor: "verde" }, 4: { txt: "Nunca mobilizada", cor: "cinza" } };
function eqpVrmPode(){ return typeof podeGravarValorBem === "function" && podeGravarValorBem(); }
function eqpVrmMaquinas(){ return _eqpRegistros.filter(e => e.ativo !== false && !EQP_FORA_OPERACAO.includes(e.status)); }
function eqpVrmSituacao(e){
  const t = e.localizacao_tipo || "base";
  if(t === "obra" || (e._mob && e._mob.status === "em_obra")) return 1;
  if(t === "em_transito" || e._mob) return 2;
  return _eqpVrm.mobilizadas.has(e.id) ? 3 : 4;
}
async function eqpVrmCarregar(){
  const cont = $("eqp-conteudo"); if(!cont) return;
  if(!eqpVrmPode()){ cont.innerHTML = uiVazio("Só a diretoria e o financeiro definem o valor para remessa."); return; }
  cont.innerHTML = `<p class="vazio">Carregando valores para remessa…</p>`;
  if(!_eqpCarregado){ carregarEquipamentos(false); return; }   // carregarEquipamentos volta para esta visão ao terminar
  const mob = await lerTudo(() => sb.from("mobilizacoes").select("id,equipamento_id,equipamentos_apoio"));
  const aq = podeVerValorBem() ? await lerTudo(() => sb.from("equipamentos_financeiro").select("equipamento_id,valor_aquisicao"), "equipamento_id") : { data: [] };
  const av = (typeof podeVerPatrimonio === "function" && podeVerPatrimonio())
    ? await lerTudo(() => sb.from("patrimonio_avaliacoes").select("id,bem_id,valor,ano_referencia").eq("bem_tipo", "equipamento")) : { data: [] };
  if(_eqpView !== "remessa") return;   // trocou de visão enquanto carregava
  if(mob.error){ cont.innerHTML = `<p class="vazio">Erro ao carregar as mobilizações: ${esc(mob.error.message || mob.error)}</p>`; return; }
  const mobilizadas = new Set();
  (mob.data || []).forEach(m => [m.equipamento_id, ...(m.equipamentos_apoio || [])].filter(Boolean).forEach(id => mobilizadas.add(id)));
  const aquisicao = {}; (aq.data || []).forEach(r => { if(Number(r.valor_aquisicao) > 0) aquisicao[r.equipamento_id] = Number(r.valor_aquisicao); });
  const avaliacao = {}; (av.data || []).forEach(r => { const a = avaliacao[r.bem_id]; if(!a || r.ano_referencia > a.ano) avaliacao[r.bem_id] = { valor: Number(r.valor), ano: r.ano_referencia }; });
  _eqpVrm = { ok: true, mobilizadas, aquisicao, avaliacao, verAquisicao: !aq.error && podeVerValorBem(), verAvaliacao: !av.error && typeof podeVerPatrimonio === "function" && podeVerPatrimonio(), valores: _eqpVrm.valores || {} };
  eqpVrmRender();
}
function eqpVrmRender(){
  const cont = $("eqp-conteudo"); if(!cont) return;
  const q = ($("eqp-vrm-busca")?.value || "").trim().toLowerCase(), fSit = $("eqp-vrm-f-situacao")?.value || "", fVal = $("eqp-vrm-f-valor")?.value || "";
  const todas = eqpVrmMaquinas();
  const comValor = todas.filter(e => Number(e.valor_remessa) > 0).length;
  const linhas = todas.map(e => ({ e, sit: eqpVrmSituacao(e) }))
    .filter(({ e, sit }) => {
      if(fSit === "ativa" && sit > 2) return false;
      if(fSit === "mobilizada" && sit > 3) return false;
      if(fSit === "nunca" && sit !== 4) return false;
      if(fVal === "sem" && Number(e.valor_remessa) > 0) return false;
      if(fVal === "com" && !(Number(e.valor_remessa) > 0)) return false;
      return !q || `${e.codigo} ${e.nome || ""} ${EQP_TIPO_LBL[e.tipo] || ""}`.toLowerCase().includes(q);
    })
    .sort((a, b) => a.sit - b.sit || eqpOrd(a.e, b.e));
  $("eqp-contador").textContent = `${comValor} de ${todas.length} máquinas com valor para remessa`;
  // durante a prévia da planilha, os filtros e os botões da lista saem de cena (não valem para a prévia)
  ["btn-eqp-vrm-salvar", "eqp-vrm-imp-rotulo", "eqp-vrm-busca", "eqp-vrm-f-situacao", "eqp-vrm-f-valor"].forEach(id => { const el = $(id); if(el) el.style.display = _eqpVrm.imp ? "none" : ""; });
  if(_eqpVrm.imp){ eqpVrmImpRender(cont); return; }
  if(!linhas.length){ cont.innerHTML = uiVazio("Nenhuma máquina com esses filtros."); return; }
  const verAq = !!_eqpVrm.verAquisicao, verAv = !!_eqpVrm.verAvaliacao;
  cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">Valor contábil (da contabilidade) da máquina, declarado na NF-e de remessa. Digite aqui ou use "Importar planilha da contabilidade"; sem valor contábil, digite o valor a declarar; ${verAq || verAv ? "a aquisição e a avaliação servem só de referência" : "cada alteração fica registrada"}. Vazio = a nota ainda usa o valor sugerido.</p>
    <div class="tabela-rola"><table class="eqp-vrm-tabela"><thead><tr><th>TAG</th><th>Máquina</th><th title="Valor contábil (da contabilidade) da máquina, declarado na NF-e de remessa">Valor contábil (R$)</th><th>Situação</th>${verAv ? '<th class="num">Avaliação de mercado</th>' : ""}${verAq ? '<th class="num">Aquisição</th>' : ""}</tr></thead>
    <tbody>${linhas.map(({ e, sit }) => { const s = EQP_VRM_SIT[sit], av = _eqpVrm.avaliacao[e.id], aq = _eqpVrm.aquisicao[e.id]; const pend = _eqpVrm.valores[e.id];
      return `<tr data-vrm="${esc(e.id)}">
      <td class="linha-clicavel" data-id="${esc(e.id)}" title="Abrir a ficha da máquina">${uiCodigo(e.codigo)}</td>
      <td>${esc(e.nome || "")} <span class="meta">${esc(EQP_TIPO_LBL[e.tipo] || e.tipo || "")}</span></td>
      <td><input type="number" class="eqp-vrm-val" min="0.01" step="0.01" inputmode="decimal" style="width:120px;text-align:right;" aria-label="Valor contábil para remessa de ${esc(e.codigo)}" value="${esc(pend !== undefined ? pend : (e.valor_remessa ?? ""))}" /> <span class="meta eqp-vrm-msg"></span></td>
      <td><span class="tag ${esc(s.cor)}">${esc(s.txt)}</span></td>
      ${verAv ? `<td class="num" data-val-sens>${av ? `${esc(brl(av.valor))} <span class="meta">${esc(av.ano)}</span>` : "—"}</td>` : ""}
      ${verAq ? `<td class="num" data-val-sens>${aq ? esc(brl(aq)) : "—"}</td>` : ""}
    </tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-vrm]").forEach(tr => {
    const e = todas.find(x => x.id === tr.dataset.vrm); if(!e) return;
    const inp = tr.querySelector(".eqp-vrm-val");
    eqpVrmMarcar(tr, e);
    inp?.addEventListener("input", () => { _eqpVrm.valores[e.id] = inp.value; eqpVrmMarcar(tr, e); });
  });
}
/* a linha mostra se o valor digitado difere do gravado (e se é válido) */
function eqpVrmMarcar(tr, e){
  const msg = tr.querySelector(".eqp-vrm-msg"), v = _eqpVrm.valores[e.id];
  if(!msg) return;
  msg.classList.remove("txt-perigo");
  if(v === undefined){ msg.textContent = ""; return; }
  const n = String(v).trim() === "" ? null : Number(String(v).replace(",", "."));
  if(n != null && !(n > 0)){ msg.textContent = "maior que zero"; msg.classList.add("txt-perigo"); return; }
  msg.textContent = fiscalValorIgual(n, e.valor_remessa) ? "" : (n == null ? "apagar ao salvar" : "a salvar");
}
async function eqpVrmSalvar(){
  if(!eqpVrmPode()){ aviso("app-aviso", "Só a diretoria e o financeiro definem o valor para remessa.", "erro"); return; }
  const mudancas = [], invalidas = [];
  eqpVrmMaquinas().forEach(e => {
    const v = _eqpVrm.valores[e.id]; if(v === undefined) return;
    const n = String(v).trim() === "" ? null : Number(String(v).replace(",", "."));
    if(n != null && !(n > 0)){ invalidas.push(e.codigo); return; }
    if(!fiscalValorIgual(n, e.valor_remessa)) mudancas.push({ id: e.id, valor: n });
  });
  if(invalidas.length){ aviso("app-aviso", `Valor para remessa tem de ser maior que zero (ou vazio): ${invalidas.join(", ")}.`, "erro"); return; }
  if(!mudancas.length){ aviso("app-aviso", "Nada para salvar: nenhum valor mudou.", "aviso"); return; }
  const r = await fiscalRemessaGravar(mudancas);
  if(r.erro){ aviso("app-aviso", "Valores para remessa não gravados: " + r.erro, "erro"); return; }
  mudancas.forEach(m => { const e = _eqpRegistros.find(x => x.id === m.id); if(e) e.valor_remessa = m.valor; delete _eqpVrm.valores[m.id]; });
  aviso("app-aviso", `${mudancas.length} valor(es) para remessa salvo(s).`, "ok");
  eqpVrmRender();
}

/* ---------- importação da planilha da contabilidade (decisão de 11/11/2026: valor para remessa = valor contábil) ----------
   A planilha (relação de bens do imobilizado, .xlsx ou .csv) é lida no navegador; cada linha casa com UMA máquina ativa pela
   TAG, código externo, número de série ou placa (sem acento, espaço nem pontuação). A prévia separa casadas, divergentes (a
   máquina já tem outro valor: só troca se marcar) e não casadas; nada vai ao banco antes de "Confirmar e gravar". A origem
   ("planilha da contabilidade: <arquivo>") fica no log junto de cada mudança. */
function eqpVrmNorm(s){ return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
/* número da planilha: 1234.5 | "1.234,56" | "1234,56" | "R$ 1.234" | "1,234.56"; vazio = null; ilegível = NaN */
function eqpVrmNumero(v){
  if(v == null) return null;
  if(typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let t = String(v).replace(/R\$|\s| /gi, "").trim();
  if(t === "" || t === "-") return null;
  const neg = /^\(.*\)$/.test(t); if(neg) t = t.slice(1, -1);
  const ultV = t.lastIndexOf(","), ultP = t.lastIndexOf(".");
  if(ultV >= 0 && ultP >= 0) t = ultV > ultP ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if(ultV >= 0) t = (t.match(/,/g).length > 1) ? t.replace(/,/g, "") : t.replace(",", ".");
  else if(/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if(!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  const n = Number(t);
  return neg ? -n : n;
}
/* matriz da 1ª aba: acha o cabeçalho (1ª linha, entre as 15 primeiras, com 2+ textos) e devolve { cab, dados, linhaCab } */
function eqpVrmLerMatriz(matriz){
  const linhas = (matriz || []).map(l => (l || []).map(c => c == null ? "" : c));
  let iCab = linhas.slice(0, 15).findIndex(l => l.filter(c => typeof c === "string" && c.trim() !== "" && Number.isNaN(Number(c))).length >= 2);
  if(iCab < 0) iCab = 0;
  const cab = (linhas[iCab] || []).map((c, i) => String(c).trim() || `Coluna ${i + 1}`);
  const dados = linhas.slice(iCab + 1).filter(l => l.some(c => String(c).trim() !== ""));
  return { cab, dados, linhaCab: iCab + 1 };
}
/* colunas sugeridas: identificação (TAG, patrimônio, código, placa, série) e valor contábil (contábil > residual > líquido > valor) */
function eqpVrmSugerirColunas(cab){
  const n = cab.map(c => String(c).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
  const achar = res => { for(const re of res){ const i = n.findIndex(c => re.test(c)); if(i >= 0) return i; } return -1; };
  return {
    id: achar([/\btag\b/, /patrim|plaqueta/, /\bcod/, /placa/, /serie/, /ident/]),
    valor: achar([/contab/, /residual/, /liquid/, /\bvalor\b|\bvlr\b/])
  };
}
/* índice: chave normalizada -> ids das máquinas que a usam (TAG, código externo, número de série, placa) */
function eqpVrmIndice(maquinas){
  const idx = new Map();
  maquinas.forEach(e => [e.codigo, e.codigo_externo, e.numero_serie, e.placa].forEach(v => {
    const k = eqpVrmNorm(v); if(k.length < 2) return;
    if(!idx.has(k)) idx.set(k, new Set());
    idx.get(k).add(e.id);
  }));
  return idx;
}
/* casa as linhas: status casada (máquina sem valor), igual, divergente, sem_maquina, ambigua, valor_invalido, repetida */
function eqpVrmCasar(dados, colId, colValor, maquinas, linhaCab){
  const idx = eqpVrmIndice(maquinas), porId = new Map(maquinas.map(e => [e.id, e]));
  const res = dados.map((l, i) => {
    const ident = String(l[colId] ?? "").trim(), valor = eqpVrmNumero(l[colValor]);
    const r = { linha: (linhaCab || 1) + i + 1, ident, valor, eq: null, status: "" };
    let ids = idx.get(eqpVrmNorm(ident));
    if(!ids){   // a célula pode trazer mais de um código ("HC-07 / série 123"): vale o pedaço que casar
      const achados = new Set();
      ident.split(/[\s/;|]+/).map(eqpVrmNorm).filter(k => k.length >= 2).forEach(k => (idx.get(k) || []).forEach(id => achados.add(id)));
      ids = achados.size ? achados : null;
    }
    if(!ident || !ids){ r.status = "sem_maquina"; return r; }
    if(ids.size > 1){ r.status = "ambigua"; return r; }
    r.eq = porId.get([...ids][0]);
    if(valor == null || !(valor > 0)){ r.status = "valor_invalido"; return r; }
    r.valor = Math.round(valor * 100) / 100;
    r.status = !(Number(r.eq.valor_remessa) > 0) ? "casada" : fiscalValorIgual(r.valor, r.eq.valor_remessa) ? "igual" : "divergente";
    return r;
  });
  const vezes = new Map(); res.forEach(r => { if(r.eq && r.status !== "valor_invalido") vezes.set(r.eq.id, (vezes.get(r.eq.id) || 0) + 1); });
  res.forEach(r => { if(r.eq && vezes.get(r.eq.id) > 1 && r.status !== "valor_invalido") r.status = "repetida"; });
  return res;
}
const EQP_VRM_IMP_MOTIVO = { sem_maquina: "nenhuma máquina ativa com esse código", ambigua: "o código serve a mais de uma máquina", valor_invalido: "valor contábil vazio, zero ou ilegível", repetida: "a máquina aparece em mais de uma linha" };
async function eqpVrmImportarArquivo(file){
  if(!file) return;
  if(!eqpVrmPode()){ aviso("app-aviso", "Só a diretoria e o financeiro importam o valor contábil das máquinas.", "erro"); return; }
  let matriz;
  try {
    const csv = /\.csv$/i.test(file.name);
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, raw: csv });   // csv: texto cru ("1.234,56" não vira outro número)
    matriz = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
  } catch(e){ aviso("app-aviso", "Não consegui ler a planilha: " + (e.message || e), "erro"); return; }
  const { cab, dados, linhaCab } = eqpVrmLerMatriz(matriz);
  if(!dados.length){ aviso("app-aviso", "A planilha não tem linhas abaixo do cabeçalho.", "erro"); return; }
  const sug = eqpVrmSugerirColunas(cab);
  _eqpVrm.imp = { arquivo: file.name, cab, dados, linhaCab, colId: sug.id >= 0 ? sug.id : 0, colValor: sug.valor >= 0 ? sug.valor : Math.min(1, cab.length - 1), trocar: new Set() };
  eqpVrmImpCasar();
  eqpVrmRender();
}
function eqpVrmImpCasar(){ const imp = _eqpVrm.imp; if(imp){ imp.res = eqpVrmCasar(imp.dados, imp.colId, imp.colValor, eqpVrmMaquinas(), imp.linhaCab); imp.trocar = new Set(); } }
/* o que a confirmação grava: casadas novas + divergentes marcadas */
function eqpVrmImpAGravar(imp){
  return (imp?.res || []).filter(r => r.status === "casada" || (r.status === "divergente" && imp.trocar.has(r.eq.id))).map(r => ({ id: r.eq.id, valor: r.valor }));
}
function eqpVrmImpRender(cont){
  const imp = _eqpVrm.imp, res = imp.res || [];
  const grupo = st => res.filter(r => st.includes(r.status));
  const casadas = grupo(["casada", "igual"]), diverg = grupo(["divergente"]), nao = grupo(["sem_maquina", "ambigua", "valor_invalido", "repetida"]);
  const naPlanilha = new Set(res.filter(r => r.eq).map(r => r.eq.id));
  const semLinha = eqpVrmMaquinas().filter(e => !naPlanilha.has(e.id)).length;
  const nGravar = eqpVrmImpAGravar(imp).length;
  const opc = sel => imp.cab.map((c, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(c)}</option>`).join("");
  const maq = e => `${uiCodigo(e.codigo)} <span class="meta">${esc(e.nome || "")}</span>`;
  const tab = (cols, linhas) => `<div class="tabela-rola"><table class="eqp-vrm-imp-tabela"><thead><tr>${cols.map(c => `<th${c.num ? ' class="num"' : ""}>${esc(c.t)}</th>`).join("")}</tr></thead><tbody>${/* html */ linhas}</tbody></table></div>`;
  const tabCasadas = casadas.length ? tab([{ t: "Linha" }, { t: "Na planilha" }, { t: "Máquina" }, { t: "Valor contábil", num: true }, { t: "" }],
    casadas.map(r => `<tr><td>${esc(r.linha)}</td><td>${esc(r.ident)}</td><td>${maq(r.eq)}</td><td class="num" data-val-sens>${esc(brl(r.valor))}</td><td class="meta">${r.status === "igual" ? "já igual" : "a gravar"}</td></tr>`).join("")) : uiVazio("Nenhuma linha casou com uma máquina.");
  const tabDiverg = diverg.length ? `<p class="meta" style="margin:0 0 6px;">A máquina já tem outro valor para remessa. Marque as que devem receber o valor da planilha.</p>` + tab([{ t: "Trocar" }, { t: "Linha" }, { t: "Máquina" }, { t: "Hoje", num: true }, { t: "Planilha", num: true }],
    diverg.map(r => `<tr><td><input type="checkbox" class="eqp-vrm-imp-trocar" data-id="${esc(r.eq.id)}"${imp.trocar.has(r.eq.id) ? " checked" : ""} aria-label="Trocar o valor de ${esc(r.eq.codigo)} pelo da planilha" /></td><td>${esc(r.linha)}</td><td>${maq(r.eq)}</td><td class="num" data-val-sens>${esc(brl(r.eq.valor_remessa))}</td><td class="num" data-val-sens>${esc(brl(r.valor))}</td></tr>`).join("")) : uiVazio("Nenhuma divergência.");
  const tabNao = nao.length ? tab([{ t: "Linha" }, { t: "Na planilha" }, { t: "Valor", num: true }, { t: "Motivo" }],
    nao.map(r => `<tr><td>${esc(r.linha)}</td><td>${esc(r.ident || "(vazio)")}${r.eq && eqpVrmNorm(r.eq.codigo) !== eqpVrmNorm(r.ident) ? ` <span class="meta">${esc(r.eq.codigo)}</span>` : ""}</td><td class="num" data-val-sens>${r.valor == null || Number.isNaN(r.valor) ? "—" : esc(brl(r.valor))}</td><td class="meta">${esc(EQP_VRM_IMP_MOTIVO[r.status] || r.status)}</td></tr>`).join("")) : uiVazio("Todas as linhas casaram.");
  cont.innerHTML = `
    <div class="eqp-vrm-imp">
      <p class="meta" style="margin:0 0 8px;">Planilha da contabilidade <strong>${esc(imp.arquivo)}</strong>: ${esc(res.length)} linha(s). Confira a prévia; nada foi gravado ainda.</p>
      <div class="serv-filtros">
        <label class="rotulo-caps">Coluna da identificação <select id="eqp-vrm-imp-col-id" title="Coluna com a TAG, o código externo, o número de série ou a placa da máquina">${opc(imp.colId)}</select></label>
        <label class="rotulo-caps">Coluna do valor contábil <select id="eqp-vrm-imp-col-valor" title="Coluna com o valor contábil (da contabilidade) de cada bem">${opc(imp.colValor)}</select></label>
      </div>
      <div class="eqp-vrm-imp-resumo" style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;">${uiKpi(casadas.length, "casadas", `${grupo(["casada"]).length} a gravar, ${grupo(["igual"]).length} já iguais`)}${uiKpi(diverg.length, "divergentes", "só trocam se marcar")}${uiKpi(nao.length, "não casadas", "não são gravadas")}${uiKpi(semLinha, "máquinas fora da planilha", "continuam como estão")}</div>
      ${uiSecao("check", `Casadas (${casadas.length})`, tabCasadas)}
      ${uiSecao("nota", `Divergentes (${diverg.length})`, tabDiverg)}
      ${uiSecao("documento", `Não casadas (${nao.length})`, tabNao)}
      <div class="form-acoes" style="margin-top:10px;">
        <button type="button" class="btn" id="btn-eqp-vrm-imp-gravar"${nGravar ? "" : " disabled"} title="Grava o valor contábil das casadas e das divergentes marcadas; cada mudança fica registrada com o nome da planilha">Confirmar e gravar ${esc(nGravar)} valor(es)</button>
        <button type="button" class="btn-sec" id="btn-eqp-vrm-imp-cancelar" title="Descarta a prévia sem gravar nada">Cancelar</button>
      </div>
    </div>`;
  $("eqp-vrm-imp-col-id")?.addEventListener("change", ev => { imp.colId = Number(ev.target.value); eqpVrmImpCasar(); eqpVrmRender(); });
  $("eqp-vrm-imp-col-valor")?.addEventListener("change", ev => { imp.colValor = Number(ev.target.value); eqpVrmImpCasar(); eqpVrmRender(); });
  cont.querySelectorAll(".eqp-vrm-imp-trocar").forEach(cb => cb.addEventListener("change", () => { if(cb.checked) imp.trocar.add(cb.dataset.id); else imp.trocar.delete(cb.dataset.id); eqpVrmRender(); }));
  $("btn-eqp-vrm-imp-gravar")?.addEventListener("click", () => comBotaoTravado("btn-eqp-vrm-imp-gravar", eqpVrmImpGravar));
  $("btn-eqp-vrm-imp-cancelar")?.addEventListener("click", () => { _eqpVrm.imp = null; eqpVrmRender(); });
}
async function eqpVrmImpGravar(){
  const imp = _eqpVrm.imp; if(!imp) return;
  if(!eqpVrmPode()){ aviso("app-aviso", "Só a diretoria e o financeiro importam o valor contábil das máquinas.", "erro"); return; }
  const itens = eqpVrmImpAGravar(imp);
  if(!itens.length){ aviso("app-aviso", "Nada para gravar: nenhuma linha casada nova nem divergente marcada.", "aviso"); return; }
  const r = await fiscalRemessaGravar(itens, `planilha da contabilidade: ${imp.arquivo}`);
  if(r.erro){ aviso("app-aviso", "Valores contábeis não gravados: " + r.erro, "erro"); return; }
  itens.forEach(m => { const e = _eqpRegistros.find(x => x.id === m.id); if(e) e.valor_remessa = m.valor; delete _eqpVrm.valores[m.id]; });
  _eqpVrm.imp = null;
  aviso("app-aviso", `${itens.length} valor(es) contábil(eis) gravado(s) da planilha ${imp.arquivo}.`, "ok");
  eqpVrmRender();
}

async function carregarEquipamentos(force){
  if(force){ _eqpSemOk = false; _eqpVrm.ok = false; }
  const cont = $("eqp-conteudo");
  if(!cont) return;
  if(force || !_eqpCarregado){
    cont.innerHTML = `<p class="vazio">Carregando equipamentos…</p>`;
    try {
      const [eq, ob, mob] = await Promise.all([
        sb.from("equipamentos").select("*").not("tipo", "in", "(caminhao,veiculo)").order("codigo"),
        sb.from("obras").select("id,codigo,nome,status").not("status", "in", "(cancelada)").order("codigo", { ascending: false }),
        sb.from("mobilizacoes").select("id,obra_id,equipamento_id,equipamentos_apoio,status").in("status", EQP_MOB_ATIVA)
      ]);
      if(eq.error) throw eq.error;
      _eqpRegistros = (eq.data || []).map(semValorBem).sort(eqpOrd);   // valor e data de aquisição não ficam na lista
      _eqpObras = ob.data || [];
      _eqpObraMap = {}; _eqpObras.forEach(o => _eqpObraMap[o.id] = o);
      // mobilização ativa por equipamento (principal ou apoio)
      const mobPor = {};
      (mob.data || []).forEach(m => { [m.equipamento_id, ...(m.equipamentos_apoio || [])].filter(Boolean).forEach(id => { if(!mobPor[id]) mobPor[id] = m; }); });
      _eqpRegistros.forEach(e => e._mob = mobPor[e.id] || null);
      // contagem de acessórios por máquina (catálogo do módulo Acessórios; falha não derruba a tela)
      try {
        const cat = typeof aceCatalogo === "function" ? await aceCatalogo() : [];
        const na = {};
        cat.forEach(a => { if(a.ativo !== false && a.local_tipo === "equipamento" && a.local_equipamento_id) na[a.local_equipamento_id] = (na[a.local_equipamento_id] || 0) + 1; });
        _eqpRegistros.forEach(e => e._ace = na[e.id] || 0);
      } catch(err){ console.warn("acessórios por máquina:", err.message || err); }
      _eqpCarregado = true;
      eqpPreencherSelectsFixos();
    } catch(e){
      cont.innerHTML = `<p class="vazio">Erro ao carregar equipamentos: ${esc(e.message || e)}</p>`;
      return;
    }
  }
  eqpPreencherFiltros();
  renderEquipamentos();
}

function eqpPreencherSelectsFixos(){
  const tipo = $("eqp-tipo");
  if(tipo) tipo.innerHTML = EQP_TIPOS.map(t => `<option value="${esc(t)}">${esc(EQP_TIPO_LBL[t])}</option>`).join("");
  const ac = $("eqp-acopl");
  if(ac && typeof ACE_ACOPL_LBL === "object") ac.innerHTML = `<option value="">—</option>` + Object.entries(ACE_ACOPL_LBL).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
  const lo = $("eqp-local-obra");
  if(lo) preencherSelect(lo, _eqpObras.map(o => ({ id: o.id, txt: `${o.codigo} — ${o.nome}` })), "id", "txt", "— obra —");
  const fs = $("eqp-f-status");
  if(fs) fs.innerHTML = `<option value="">Status</option>` + Object.entries(STATUS.equipamento || {}).filter(([k]) => !EQP_FORA_OPERACAO.includes(k)).map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join("");
  const fl = $("eqp-f-local");
  if(fl) fl.innerHTML = `<option value="">Onde está</option>` + Object.entries(EQP_LOCAL_LBL).filter(([k]) => !EQP_FORA_OPERACAO.includes(k)).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
}
function eqpPreencherFiltros(){
  const keep = (sel, itens, ph) => { if(!sel) return; const v = sel.value; sel.innerHTML = `<option value="">${esc(ph)}</option>` + itens.map(i => `<option value="${esc(i.v)}">${esc(i.t)}</option>`).join(""); sel.value = v; };
  const tipos = [...new Set(_eqpRegistros.map(e => e.tipo).filter(Boolean))].sort((a, b) => (EQP_TIPO_LBL[a] || a).localeCompare(EQP_TIPO_LBL[b] || b));
  keep($("eqp-f-tipo"), tipos.map(t => ({ v: t, t: EQP_TIPO_LBL[t] || t })), "Todos os tipos");
  const obras = [...new Set(_eqpRegistros.map(e => e.localizacao_obra_id).filter(Boolean))];
  keep($("eqp-f-obra"), obras.map(id => ({ v: id, t: eqpObra(id) || id })).sort((a, b) => a.t.localeCompare(b.t)), "Obra");
}

/* ---------- filtros + render ---------- */
function eqpFiltradas(){
  const q = ($("eqp-busca")?.value || "").trim().toLowerCase();
  const fTipo = $("eqp-f-tipo")?.value || "", fSt = $("eqp-f-status")?.value || "", fLoc = $("eqp-f-local")?.value || "", fObra = $("eqp-f-obra")?.value || "";
  const inativos = !!$("eqp-f-inativos")?.checked;
  return _eqpRegistros.filter(e => {
    if(EQP_FORA_OPERACAO.includes(e.status)) return false;   // fase 96: vendidos só na visão Vendas
    if(!inativos && e.ativo === false) return false;
    if(fTipo && e.tipo !== fTipo) return false;
    if(fSt && e.status !== fSt) return false;
    if(fLoc && (e.localizacao_tipo || "base") !== fLoc) return false;
    if(fObra && e.localizacao_obra_id !== fObra) return false;
    switch(_eqpKpi){
      case "obra":       if(e.localizacao_tipo !== "obra") return false; break;
      case "base":       if((e.localizacao_tipo || "base") !== "base") return false; break;
      case "transito":   if(e.localizacao_tipo !== "em_transito") return false; break;
      case "manutencao": if(e.status !== "em_manutencao" && e.localizacao_tipo !== "fornecedor_manutencao") return false; break;
      case "acessorios": if(!eqpNumAce(e)) return false; break;
      case "sem_cod_ext": if(!eqpSemCodExt(e)) return false; break;
      case "sem_ncm":    if(!eqpSemNcm(e)) return false; break;   // fase 105a
    }
    if(q){
      const alvo = [e.codigo, e.nome, e.marca, e.modelo, e.numero_serie, e.codigo_externo, EQP_TIPO_LBL[e.tipo], eqpOnde(e)].filter(Boolean).join(" ").toLowerCase();
      if(!alvo.includes(q)) return false;
    }
    return true;
  });
}
function renderEquipamentos(){
  const cont = $("eqp-conteudo"); if(!cont) return;
  // fase 96: visão Vendas (js/vendas_bens.js) troca indicadores, filtros e título do painel
  const ehSem = _eqpView === "semanal";   // lote S58 (#232)
  if(_eqpView === "vendas" && typeof vbRenderPainel !== "function") _eqpView = "kanban";
  if(_eqpView === "cpb" && typeof cpbRenderPainel !== "function") _eqpView = "kanban";   // fase 107a: js/computadores_bordo.js
  // valor para remessa: a visão só existe para quem grava (diretoria e financeiro)
  const bVrm = $("eqp-view-remessa"); if(bVrm) bVrm.style.display = eqpVrmPode() ? "" : "none";
  if(_eqpView === "remessa" && !eqpVrmPode()) _eqpView = "kanban";
  const ehVendas = _eqpView === "vendas", ehCpb = _eqpView === "cpb", ehVrm = _eqpView === "remessa";
  [["eqp-indicadores", !ehVendas && !ehCpb && !ehSem && !ehVrm], ["eqp-filtros", !ehVendas && !ehCpb && !ehSem && !ehVrm], ["eqp-sem-filtros", ehSem], ["eqp-vrm-filtros", ehVrm], ["vb-indicadores", ehVendas], ["vb-filtros", ehVendas], ["cpb-filtros", ehCpb]].forEach(([id, ver]) => { const el = $(id); if(el) el.style.display = ver ? "" : "none"; });
  const tit = $("eqp-painel-titulo"); if(tit) tit.textContent = ehVendas ? "Vendas de bens" : ehCpb ? "Computadores de bordo" : ehSem ? "Horímetro semanal" : ehVrm ? "Valor para remessa" : "Máquinas";
  const bn = $("btn-eqp-novo"); if(bn) bn.style.display = (!ehVendas && !ehCpb && !ehSem && !ehVrm && eqpPodeEditar()) ? "" : "none";
  if(!ehCpb){ ["btn-cpb-novo", "btn-cpb-descobrir"].forEach(id => { const el = $(id); if(el) el.style.display = "none"; }); }
  document.querySelectorAll("#eqp-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _eqpView));
  if(ehVendas){ vbRenderPainel(); return; }
  if(ehCpb){ cpbRenderPainel(); return; }
  if(ehSem){ if(_eqpSemOk) eqpSemRender(); else eqpSemCarregar(); return; }
  if(ehVrm){ if(_eqpVrm.ok) eqpVrmRender(); else eqpVrmCarregar(); return; }
  eqpRenderKpis();
  document.querySelectorAll("#eqp-painel .ind[data-kpi]").forEach(el => el.classList.toggle("ativo", el.dataset.kpi === _eqpKpi));
  const dados = eqpFiltradas();
  $("eqp-contador").textContent = `${dados.length} de ${_eqpRegistros.filter(e => e.ativo !== false && !EQP_FORA_OPERACAO.includes(e.status)).length}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhum equipamento com esses filtros.</p>`; return; }
  if(_eqpView === "lista") renderEquipamentosLista(dados); else renderEquipamentosKanban(dados);
}
function eqpRenderKpis(){
  const at = _eqpRegistros.filter(e => e.ativo !== false);
  const set = (id, n) => { const el = $(id); if(el) el.textContent = n; };
  set("eqp-kpi-total", at.length);
  set("eqp-kpi-obra", at.filter(e => e.localizacao_tipo === "obra").length);
  set("eqp-kpi-base", at.filter(e => (e.localizacao_tipo || "base") === "base").length);
  set("eqp-kpi-transito", at.filter(e => e.localizacao_tipo === "em_transito").length);
  set("eqp-kpi-manut", at.filter(e => e.status === "em_manutencao" || e.localizacao_tipo === "fornecedor_manutencao").length);
  set("eqp-kpi-ace", at.reduce((s, e) => s + eqpNumAce(e), 0));
  set("eqp-kpi-semext", at.filter(eqpSemCodExt).length);
  // fase 105a: o indicador só aparece com a coluna ncm no banco (select("*") traz a chave)
  const temNcm = _eqpRegistros.length > 0 && Object.prototype.hasOwnProperty.call(_eqpRegistros[0], "ncm");
  const box = $("eqp-kpi-semncm-box"); if(box) box.style.display = temNcm ? "" : "none";
  if(temNcm) set("eqp-kpi-semncm", _eqpRegistros.filter(eqpSemNcm).length);
  if(typeof cpbAtualizarKpi === "function") cpbAtualizarKpi();   // fase 107a: CPU com calibração vencida
}
/* fase 75: perfuratriz ou bate-estaca sem o código do Geodigitus/Maya ("Para regularizar") */
function eqpSemCodExt(e){ return ["perfuratriz", "bate_estaca"].includes(e.tipo) && !String(e.codigo_externo || "").trim(); }
/* fase 105a: máquina em mobilização ativa sem NCM (a NF-e de remessa exige; mesma regra do "Para regularizar") */
function eqpSemNcm(e){ return !!e._mob && Object.prototype.hasOwnProperty.call(e, "ncm") && !String(e.ncm || "").trim(); }
function eqpCardHTML(e){
  const mob = e._mob;
  return `<div class="serv-kan-card eqp-card" data-id="${esc(e.id)}">
    <div class="serv-kan-card-nome"><strong>${esc(e.codigo)}</strong> ${esc(e.nome || "")}</div>
    <div class="meta">${esc(EQP_TIPO_LBL[e.tipo] || e.tipo)}${e.marca || e.modelo ? " · " + esc([e.marca, e.modelo].filter(Boolean).join(" ")) : ""}</div>
    <div class="meta" style="margin-top:4px;">${eqpOndeHTML(e)}</div>
    <div class="meta eqp-card-rodape">
      ${eqpNumAce(e) ? `<span title="acessórios registrados nesta máquina">⚙️ ${eqpNumAce(e)}</span>` : ""}
      ${mob ? `<span title="mobilização ativa">🏗️ ${esc(MOB_LBL_SAFE(mob.status))}</span>` : ""}
      ${e.horimetro != null ? `<span>⏱ ${num(e.horimetro)} h</span>` : ""}
    </div>
  </div>`;
}
function MOB_LBL_SAFE(st){ return (typeof MOB_STATUS === "object" && MOB_STATUS && MOB_STATUS[st]) || st || ""; }
function renderEquipamentosKanban(dados){
  const cols = Object.keys(STATUS.equipamento || {}).filter(st => !EQP_FORA_OPERACAO.includes(st));
  $("eqp-conteudo").innerHTML = `<div class="serv-kanban">${cols.map(st => {
    const its = dados.filter(e => (e.status || "disponivel") === st);
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${tagStatus("equipamento", st)} <span class="contador">${its.length}</span></div>
      ${its.map(eqpCardHTML).join("") || `<p class="vazio">—</p>`}
    </div>`; }).join("")}</div>`;
}
function renderEquipamentosLista(dados){
  $("eqp-conteudo").innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>TAG</th><th>Nome</th><th>Tipo</th><th>Marca / modelo</th><th>Status</th><th>Onde está</th><th>Mobilização</th><th class="num">Acessórios</th><th class="num">Horímetro</th></tr></thead>
    <tbody>${dados.map(e => `<tr class="linha-clicavel" data-id="${esc(e.id)}">
      <td><strong>${esc(e.codigo)}</strong>${e.ativo === false ? ' <span class="tag cinza">inativo</span>' : ""}</td>
      <td>${esc(e.nome || "")}</td>
      <td>${esc(EQP_TIPO_LBL[e.tipo] || e.tipo)}</td>
      <td>${esc([e.marca, e.modelo].filter(Boolean).join(" ") || "—")}</td>
      <td>${tagStatus("equipamento", e.status || "disponivel")}</td>
      <td>${eqpOndeHTML(e)}</td>
      <td>${e._mob ? `${esc(MOB_LBL_SAFE(e._mob.status))} · ${linkObra(e._mob.obra_id, eqpObra(e._mob.obra_id) || "obra")}` : "—"}</td>
      <td class="num">${eqpNumAce(e) || "—"}</td>
      <td class="num">${e.horimetro != null ? num(e.horimetro) : "—"}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

/* ---------- ficha ---------- */
function mostrarPainelEquipamentos(){
  $("eqp-ficha").style.display = "none";
  if($("cpb-ficha")) $("cpb-ficha").style.display = "none";   // fase 107a
  $("eqp-painel").style.display = "";
  _eqpAtual = null; _eqpEditId = null; _eqpValorBem = null;
  if(typeof ocultarHistorico === "function") ocultarHistorico("eqp-chatter");
  renderEquipamentos();
}
function novoEquipamento(){
  if(!eqpPodeEditar()){ aviso("app-aviso", "Seu perfil não cadastra equipamentos.", "erro"); return; }
  abrirFichaEquipamento({ id: null, codigo: "", nome: "", tipo: "perfuratriz", status: "disponivel", ativo: true, localizacao_tipo: "base", localizacao_descricao: "Base Itabira" });
}
async function abrirEquipamento(id){
  if(!_eqpCarregado) await carregarEquipamentos(false);
  let e = _eqpRegistros.find(x => x.id === id);
  if(!e){
    const { data } = await sb.from("equipamentos").select("*").eq("id", id).maybeSingle();
    if(!data){ aviso("app-aviso", "Equipamento não encontrado.", "erro"); return; }
    e = semValorBem(data);
  }
  abrirFichaEquipamento(e);
}
/* ---------- valor e data de aquisição (equipamentos_financeiro) ----------
   Decisão da diretoria (11/11/2026): leem diretoria, financeiro e auditor; gravam diretoria e financeiro. O valor saiu do
   registro de equipamentos: a ficha lê e grava à parte, e o que vai para a tabela equipamentos nunca leva esses dois campos
   (quem salva a ficha sem ver o valor não escreve vazio por cima dele). */
/* disponivel = false quando o banco não tem a tabela ou a leitura falhou: a ficha esconde os campos e não grava nada */
async function eqpValorBemLer(equipId){
  const vazio = { disponivel: false, valor: null, data: null, alteradoEm: null };
  if(typeof podeVerValorBem !== "function" || !podeVerValorBem() || _eqpValorBemSemTabela) return vazio;
  const q = sb.from("equipamentos_financeiro").select("equipamento_id,valor_aquisicao,data_aquisicao,alterado_em");
  const { data, error } = await (equipId ? q.eq("equipamento_id", equipId).maybeSingle() : q.limit(1));   // sem id (equipamento novo): só confere que a tabela existe
  if(error){
    if(error.code === "PGRST205" || error.code === "42P01" || /equipamentos_financeiro/.test(error.message || "")) _eqpValorBemSemTabela = true;
    else console.warn("valor de aquisição:", error.message || error);
    return vazio;
  }
  const r = (equipId && data) || {};
  return { disponivel: true, valor: r.valor_aquisicao ?? null, data: r.data_aquisicao || null, alteradoEm: r.alterado_em || null };
}
function eqpValorBemEditavel(){
  return !!_eqpValorBem && _eqpValorBem.disponivel === true && typeof podeGravarValorBem === "function" && podeGravarValorBem();
}
/* os dois campos nascem ocultos e vazios; aparecem só depois de lidos, e ficam editáveis só para quem grava */
async function eqpValorBemPreencher(e){
  const est = _eqpValorBem = { equipId: (e && e.id) || null, disponivel: false, valor: null, data: null };
  const cv = $("eqp-valor-campo"), cd = $("eqp-aquisicao-campo"), iv = $("eqp-valor"), idt = $("eqp-aquisicao");
  if(!iv || !idt) return;
  if(cv) cv.style.display = "none";
  if(cd) cd.style.display = "none";
  iv.value = ""; idt.value = ""; iv.disabled = true; idt.disabled = true; iv.title = ""; idt.title = "";
  const lido = await eqpValorBemLer(est.equipId);
  if(_eqpValorBem !== est) return;   // a ficha mudou enquanto lia
  est.disponivel = lido.disponivel; est.valor = lido.valor; est.data = lido.data;
  if(!est.disponivel) return;
  iv.value = est.valor ?? ""; idt.value = est.data || "";
  const edita = eqpValorBemEditavel();
  iv.disabled = !edita; idt.disabled = !edita;
  const dia = lido.alteradoEm ? dataBR(typeof dataLocalISO === "function" ? dataLocalISO(new Date(lido.alteradoEm)) : String(lido.alteradoEm).slice(0, 10)) : "";
  iv.title = idt.title = (edita ? "Só a diretoria e o financeiro alteram; cada alteração fica registrada." : "Só a diretoria e o financeiro alteram.") + (dia ? ` Última alteração em ${dia}.` : "");
  if(cv) cv.style.display = "";
  if(cd) cd.style.display = "";
  if(edita && $("btn-eqp-salvar")) $("btn-eqp-salvar").style.display = "";   // o financeiro grava o valor sem gravar o cadastro
  // bem vendido: o aviso diz que o cadastro é só para consulta, e o botão Salvar aparece por causa destes dois campos
  const notaV = $("eqp-nota-vendido");
  if(edita && notaV && notaV.style.display !== "none" && notaV.textContent && !/aquisição/.test(notaV.textContent))
    notaV.textContent += " O valor e a data de aquisição continuam editáveis pela diretoria e pelo financeiro, na aba Geral.";
}
function eqpValorBemCampos(){
  const v = $("eqp-valor").value, d = $("eqp-aquisicao").value;
  return { valor: v === "" || v == null ? null : Number(v), data: d || null };
}
/* só quem grava, só com a tabela lida, e só se o que está nos campos difere do que foi lido */
function eqpValorBemMudou(){
  if(!eqpValorBemEditavel()) return false;
  const c = eqpValorBemCampos();
  const igual = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005);
  return !igual(c.valor, _eqpValorBem.valor) || (c.data || null) !== (_eqpValorBem.data || null);
}
/* a linha nasce por gatilho junto com o equipamento; upsert cobre a que faltar. Devolve o erro, ou null. */
async function eqpValorBemGravar(equipId){
  const c = eqpValorBemCampos();
  if(c.valor != null && !(c.valor >= 0)) return { message: "informe um valor maior ou igual a zero" };
  const { error } = await sb.from("equipamentos_financeiro")
    .upsert({ equipamento_id: equipId, valor_aquisicao: c.valor, data_aquisicao: c.data }, { onConflict: "equipamento_id" });
  if(!error && _eqpValorBem){ _eqpValorBem.valor = c.valor; _eqpValorBem.data = c.data; }
  return error || null;
}
function eqpToggleLocalObra(){
  const t = $("eqp-local-tipo").value;
  $("eqp-local-obra-campo").style.display = (t === "obra" || t === "em_transito" || t === "cliente") ? "" : "none";
}
/* lote S63-g (#284): campo "Equipamento principal" da ficha. O vínculo é de um nível só: a lista não traz quem já está
   vinculado a outro, e quem já é principal de algum fica travado com a lista dos seus vinculados. Só aparece com a coluna no
   banco (equipamentos.equipamento_principal_id). Caminhões e veículos entram na lista, embora o painel não os mostre. */
let _eqpPrincipalSeq = 0;
async function eqpPrincipalPreencher(e, pode){
  const campo = $("eqp-principal-campo"), sel = $("eqp-principal"), info = $("eqp-principal-info");
  if(!campo || !sel) return;
  const seq = ++_eqpPrincipalSeq;
  sel.dataset.carregado = "0"; sel.dataset.travado = "0";
  const temCol = Object.prototype.hasOwnProperty.call(e, "equipamento_principal_id") || (_eqpRegistros[0] && Object.prototype.hasOwnProperty.call(_eqpRegistros[0], "equipamento_principal_id"));
  campo.style.display = temCol ? "" : "none";
  if(!temCol) return;
  sel.innerHTML = `<option value="">Carregando…</option>`; sel.disabled = true;
  if(info) info.textContent = "";
  const { data, error } = await sb.from("equipamentos").select("id,codigo,nome,ativo,equipamento_principal_id");
  if(seq !== _eqpPrincipalSeq) return;   // abriu outra ficha enquanto carregava
  if(error){ sel.innerHTML = `<option value="">—</option>`; if(info) info.textContent = "Lista não carregou: " + error.message; return; }
  const todos = (data || []).sort(eqpOrd);
  const vinculados = e.id ? todos.filter(x => x.equipamento_principal_id === e.id) : [];
  const atual = e.equipamento_principal_id || "";
  const opcoes = todos.filter(x => x.id !== e.id && !x.equipamento_principal_id && (x.ativo !== false || x.id === atual));
  sel.innerHTML = `<option value="">— nenhum (equipamento independente) —</option>` + opcoes.map(x => `<option value="${esc(x.id)}">${esc(eqpTag(x))}</option>`).join("");
  sel.value = atual;
  sel.dataset.carregado = "1";
  if(vinculados.length){
    sel.dataset.travado = "1"; sel.disabled = true;
    if(info) info.textContent = `Principal de ${vinculados.map(x => x.codigo).join(", ")}: não pode ser vinculado a outro.`;
  } else sel.disabled = !pode;
}
function abrirFichaEquipamento(e){
  _eqpAtual = e; _eqpEditId = e.id || null;
  const novo = !e.id;
  $("eqp-painel").style.display = "none";
  if($("cpb-ficha")) $("cpb-ficha").style.display = "none";   // fase 107a
  $("eqp-ficha").style.display = "";
  $("eqp-ficha-titulo").textContent = novo ? "Novo equipamento" : eqpTag(e);
  // fase 96: bem vendido fica só para consulta (o estado volta só cancelando a venda, na aba Venda)
  const vendido = e.status === "vendido" || !!e.venda_id;
  document.querySelectorAll("#eqp-ficha .eqp-so-existente").forEach(b => b.style.display = (novo || vendido) ? "none" : "");
  const pode = eqpPodeEditar() && !vendido;
  const bVend = $("btn-eqp-vender");
  if(bVend) bVend.style.display = (!novo && !vendido && typeof vbPodeRegistrar === "function" && vbPodeRegistrar(e)) ? "" : "none";
  const notaV = $("eqp-nota-vendido");
  if(notaV){
    notaV.style.display = vendido ? "" : "none";
    notaV.textContent = vendido ? `Bem vendido${e.baixa_em ? " em " + dataBR(e.baixa_em) : ""}: cadastro só para consulta. OS, custos, viagens, mobilizações e RDOs continuam nas abas; a venda (comprador, parcelas, saldo) fica na aba Venda.` : "";
  }
  $("btn-eqp-salvar").style.display = pode ? "" : "none";
  $("eqp-ficha").querySelectorAll("input,select,textarea").forEach(el => el.disabled = !pode);
  $("eqp-codigo").disabled = !pode || !novo;

  $("eqp-codigo").value = e.codigo || "";
  $("eqp-nome").value = e.nome || "";
  $("eqp-tipo").value = EQP_TIPOS.includes(e.tipo) ? e.tipo : "outro";
  $("eqp-marca").value = e.marca || ""; $("eqp-modelo").value = e.modelo || "";
  $("eqp-ano").value = e.ano_fabricacao ?? ""; $("eqp-serie").value = e.numero_serie || "";
  $("eqp-horimetro").value = e.horimetro ?? ""; $("eqp-cod-ext").value = e.codigo_externo || "";
  eqpValorBemPreencher(e);   // valor e data de aquisição: lidos à parte, só para quem pode ver
  $("eqp-ativo").checked = e.ativo !== false;
  $("eqp-local-tipo").value = e.localizacao_tipo || "base";
  $("eqp-local-obra").value = e.localizacao_obra_id || "";
  $("eqp-local-desc").value = e.localizacao_descricao || "";
  eqpToggleLocalObra();
  $("eqp-obs").value = e.observacoes || "";
  $("eqp-encaixe").value = e.encaixe_trado || ""; $("eqp-acopl").value = e.acoplamento_trado || "";
  $("eqp-diam-max").value = e.diametro_max_mm ?? ""; $("eqp-prof-max").value = e.profundidade_max_m ?? "";
  $("eqp-pino").value = e.pino_trado_mm ?? ""; $("eqp-obs-ace").value = e.obs_acessorios || "";
  if(typeof fiscalItemPreencher === "function") fiscalItemPreencher("eqp", "equipamento", e, pode);   // fase 105a: aba Fiscal (NCM)
  // fase 107a: tipo de serviço do diário (equipamentos.tipo_servico_padrao; o campo só aparece com a coluna no banco)
  const temTipoServ = Object.prototype.hasOwnProperty.call(e, "tipo_servico_padrao") || (_eqpRegistros[0] && Object.prototype.hasOwnProperty.call(_eqpRegistros[0], "tipo_servico_padrao"));
  if($("eqp-tipo-servico-campo")) $("eqp-tipo-servico-campo").style.display = temTipoServ ? "" : "none";
  if(temTipoServ && $("eqp-tipo-servico") && typeof TIPO_SERVICO === "object"){
    $("eqp-tipo-servico").innerHTML = `<option value="">— sem tipo (não recebe estacas do Geodigitus) —</option>` + Object.entries(TIPO_SERVICO).map(([v, o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("");
    $("eqp-tipo-servico").value = e.tipo_servico_padrao || "";
  }
  if(typeof cpbPreencherMaquina === "function") cpbPreencherMaquina(e);   // fase 107a: chip CPU e bloco Computador de bordo
  eqpPrincipalPreencher(e, pode);   // lote S63-g (#284): equipamento principal (munck no caminhão)

  // chips
  $("eqp-chip-tag").textContent = e.codigo || "—";
  $("eqp-chip-tipo").textContent = EQP_TIPO_LBL[e.tipo] || e.tipo || "—";
  $("eqp-chip-onde").textContent = novo ? "—" : eqpOnde(e);
  $("eqp-chip-mob").textContent = e._mob ? `${MOB_LBL_SAFE(e._mob.status)} · ${eqpObra(e._mob.obra_id) || "obra"}` : "—";
  $("eqp-chip-hor").textContent = e.horimetro != null ? `${num(e.horimetro)} h` : "—";
  const tec = [e.encaixe_trado, e.acoplamento_trado ? (ACE_ACOPL_LBL?.[e.acoplamento_trado] || e.acoplamento_trado) : null, e.diametro_max_mm ? `Ø máx. ${e.diametro_max_mm}` : null, e.profundidade_max_m ? `${e.profundidade_max_m} m` : null].filter(Boolean).join(" · ");
  $("eqp-chip-tec").textContent = tec || "—";
  atualizarStatusbarEquipamento(e.status || "disponivel");

  // smart-buttons zerados até carregar
  ["sb-eqp-ace","sb-eqp-mob","sb-eqp-rdo","sb-eqp-mov","sb-eqp-rep","sb-eqp-man"].forEach(id => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = "0"; b.classList.add("zero"); } });
  $("eqp-ace-lista").innerHTML = `<p class="vazio">${novo ? "Salve o equipamento para ver os acessórios." : "Carregando…"}</p>`;
  ["eqp-mob-lista","eqp-rdo-lista","eqp-mov-lista","eqp-rep-lista"].forEach(id => { const el = $(id); if(el) el.innerHTML = `<p class="vazio">${novo ? "—" : "Carregando…"}</p>`; });
  if($("eqp-chip-trab-box")) $("eqp-chip-trab-box").style.display = "none";   // fase 101: preenchido em eqpCarregarTrabalho
  $("eqp-man-lista").innerHTML = "";

  if(!novo){ eqpCarregarFilhas(e); eqpCarregarRdos(e); eqpCarregarTrabalho(e); }   // fase 101: RDOs da máquina; obra e condutor do vínculo
  // fase 96: aba Venda (js/vendas_bens.js)
  const vCont = $("eqp-venda");
  if(vCont){ if(novo || typeof vbRenderAba !== "function") vCont.innerHTML = `<p class="vazio">—</p>`; else vbRenderAba(e, "eqp-venda"); }
  if(!novo && typeof montarHistorico === "function") montarHistorico("equipamentos", e.id, "eqp-chatter");
  else if(typeof ocultarHistorico === "function") ocultarHistorico("eqp-chatter");
  ativarTabEquipamento("geral");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function atualizarStatusbarEquipamento(st){
  document.querySelectorAll("#eqp-statusbar .stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    if(el.dataset.status === st) el.classList.add(st === "inativo" ? "cancelada" : "atual");
  });
}
function ativarTabEquipamento(nome){
  document.querySelectorAll("#eqp-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#eqp-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}

async function eqpCarregarFilhas(e){
  const id = e.id;
  const [mob, mov, rep, man, comp, cat, vgs] = await Promise.all([
    sb.from("mobilizacoes").select("id,obra_id,status,data_mobilizacao_prev,data_saida_real,data_chegada_real,data_desmob_real,equipamento_id,equipamentos_apoio").or(`equipamento_id.eq.${id},equipamentos_apoio.cs.{${id}}`).order("data_mobilizacao_prev", { ascending: false }),
    // fase 89: a nota traz a viagem que a levou; a TAG também aparece como caminhão ou equipamento atendido da viagem (consulta abaixo)
    sb.from("movimentacao_itens").select("movimentacao_id,movimentacao:movimentacoes_ativos(id,numero,tipo,status,data_emissao,data_recebimento,origem_tipo,origem_descricao,destino_tipo,destino_descricao,destino_obra_id,nf_numero,interna,viagem_id,viagem:viagens(id,numero,data,status,finalidade,caminhao_id,km_total,origem_tipo,origem_obra_id,origem_descricao,destino_tipo,destino_obra_id,destino_descricao,caminhao:equipamentos!caminhao_id(codigo)))").eq("equipamento_id", id),
    sb.from("reparos_caldeiraria").select("id,status,descricao,tipo_servico,data_abertura,data_conclusao,custo_estimado,custo_real,acessorio_id").eq("equipamento_id", id).order("data_abertura", { ascending: false }).limit(200),
    sb.from("manutencoes").select("id,numero,tipo,status,descricao,data_prevista,data_inicio,data_conclusao,custo,custo_real,horimetro_km,fornecedor_id,responsavel_id,observacoes,pedido_id,codigo_externo").eq("equipamento_id", id).order("data_prevista", { ascending: false }).limit(200),
    sb.from("acessorio_equipamentos").select("acessorio_id").eq("equipamento_id", id),
    (typeof aceCatalogo === "function" ? aceCatalogo() : Promise.resolve([])).catch(() => []),
    sb.from("viagens").select("id,numero,data,status,finalidade,caminhao_id,equipamento_atendido_id,km_total,origem_tipo,origem_obra_id,origem_descricao,destino_tipo,destino_obra_id,destino_descricao,caminhao:equipamentos!caminhao_id(codigo)").or(`caminhao_id.eq.${id},equipamento_atendido_id.eq.${id}`).order("data", { ascending: false }).limit(300)
  ]);
  if(_eqpAtual?.id !== id) return;
  const setSb = (bid, n) => { const b = $(bid); if(!b) return; b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); };

  // acessórios
  const compIds = new Set((comp.data || []).map(c => c.acessorio_id));
  const vivos = cat.filter(a => a.ativo !== false);
  _eqpAceCache = {
    id,
    na: vivos.filter(a => a.local_equipamento_id === id && ["equipamento","obra","em_transito"].includes(a.local_tipo)),
    pertence: vivos.filter(a => a.equipamento_padrao_id === id),
    compat: vivos.filter(a => compIds.has(a.id) && a.equipamento_padrao_id !== id),
    cat: vivos
  };
  const todos = eqpAceTodos();
  setSb("sb-eqp-ace", todos.length);
  eqpRenderAcessorios();

  // mobilizações
  const mobs = mob.data || [];
  setSb("sb-eqp-mob", mobs.length);
  $("eqp-mob-lista").innerHTML = mob.error ? `<p class="vazio">Erro: ${esc(mob.error.message)}</p>` : !mobs.length ? `<p class="vazio">Nenhuma mobilização com esta TAG.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>Obra</th><th>Papel</th><th>Status</th><th>Prevista</th><th>Saída</th><th>Chegada</th><th>Desmobilização</th></tr></thead>
    <tbody>${mobs.map(m => `<tr class="linha-clicavel" data-mob="${esc(m.id)}">
      <td>${linkObra(m.obra_id, eqpObra(m.obra_id) || "obra")}</td><td>${m.equipamento_id === id ? "Principal" : "Apoio"}</td>
      <td><span class="tag ${EQP_MOB_ATIVA.includes(m.status) ? "azul" : m.status === "cancelada" ? "cinza" : "verde"}">${esc(MOB_LBL_SAFE(m.status))}</span></td>
      <td>${dataBR(m.data_mobilizacao_prev)}</td><td>${dataBR(m.data_saida_real)}</td><td>${dataBR(m.data_chegada_real)}</td><td>${dataBR(m.data_desmob_real)}</td></tr>`).join("")}</tbody></table></div>`;

  // viagens (fase 89): a TAG como caminhão ou equipamento atendido da viagem, ou como item de uma nota levada por
  // uma viagem; a nota aparece ao lado. Nota sem viagem (antes da fase 89) continua listada embaixo.
  const movs = (mov.data || []).map(i => i.movimentacao).filter(Boolean);
  const viagens = new Map();
  (vgs.data || []).forEach(v => viagens.set(v.id, { ...v, papel: v.caminhao_id === id ? "caminhão" : "equipamento atendido", notas: [] }));
  movs.forEach(m => {
    if(!m.viagem) return;
    const v = viagens.get(m.viagem.id) || { ...m.viagem, papel: "item da carga", notas: [] };
    if(!m.interna) v.notas.push(m);
    viagens.set(v.id, v);
  });
  const soltas = movs.filter(m => !m.viagem && !m.interna).sort((a, b) => String(b.data_emissao || "").localeCompare(String(a.data_emissao || "")));
  const listaVg = [...viagens.values()].sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
  setSb("sb-eqp-mov", listaVg.length + soltas.length);
  const locLbl = (t) => (typeof LOC_TIPOS === "object" && LOC_TIPOS && LOC_TIPOS[t]) || EQP_LOCAL_LBL[t] || t || "";
  const ladoVg = (v, lado) => typeof vgLado === "function" ? vgLado(v, lado) : (v[lado + "_descricao"] || locLbl(v[lado + "_tipo"]));
  const erroLista = mov.error || vgs.error;
  $("eqp-mov-lista").innerHTML = erroLista ? `<p class="vazio">Erro: ${esc(erroLista.message)}</p>` : !(listaVg.length || soltas.length) ? `<p class="vazio">Nenhuma viagem com esta TAG.</p>` :
    `${listaVg.length ? `<div class="tabela-rola"><table><thead><tr><th>Viagem</th><th>Data</th><th>Status</th><th>Papel da TAG</th><th>Caminhão</th><th>Origem → destino</th><th>Notas</th><th class="num">km</th></tr></thead>
    <tbody>${listaVg.map(v => `<tr class="linha-clicavel" data-vg="${esc(v.id)}">
      <td><strong>${esc(v.numero)}</strong> <span class="meta">${esc((typeof VG_FINALIDADES === "object" && VG_FINALIDADES && VG_FINALIDADES[v.finalidade]) || "")}</span></td><td>${dataBR(v.data)}</td>
      <td>${tagStatus("viagem", v.status)}</td><td>${esc(v.papel)}</td><td>${esc(v.caminhao?.codigo || "—")}</td>
      <td>${esc(ladoVg(v, "origem"))} → ${v.destino_obra_id ? linkObra(v.destino_obra_id, ladoVg(v, "destino")) : esc(ladoVg(v, "destino"))}</td>
      <td>${v.notas.length ? v.notas.map(m => linkMovimentacao(m.id, m.nf_numero ? "NF " + m.nf_numero : m.numero)).join(", ") : '<span class="meta">—</span>'}</td>
      <td class="num">${v.km_total != null ? num(v.km_total) : "—"}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${soltas.length ? `<h3 class="titulo-bloco">Notas sem viagem</h3><div class="tabela-rola"><table><thead><tr><th>Nº</th><th>Tipo</th><th>Status</th><th>Emissão</th><th>Origem</th><th>Destino</th><th>Recebida</th></tr></thead>
    <tbody>${soltas.map(m => `<tr class="linha-clicavel" data-mov="${esc(m.id)}">
      <td><strong>${esc(m.numero || "—")}</strong></td><td>${esc((typeof MOV_TIPOS === "object" && MOV_TIPOS && MOV_TIPOS[m.tipo]) || m.tipo)}</td>
      <td>${typeof MOV_STATUS === "object" && MOV_STATUS && MOV_STATUS[m.status] ? `<span class="tag ${esc(MOV_STATUS[m.status].cor)}">${esc(MOV_STATUS[m.status].label)}</span>` : esc(m.status)}</td>
      <td>${dataBR(m.data_emissao)}</td><td>${esc(m.origem_descricao || locLbl(m.origem_tipo))}</td>
      <td>${m.destino_obra_id ? linkObra(m.destino_obra_id, m.destino_descricao || eqpObra(m.destino_obra_id)) : esc(m.destino_descricao || locLbl(m.destino_tipo))}</td>
      <td>${dataBR(m.data_recebimento)}</td></tr>`).join("")}</tbody></table></div>` : ""}`;

  // custos (view unificada, módulo Compras)
  if(typeof custosRender === "function") custosRender("eqp-custos", { equipamento_id: id }, (total) => { const b = $("sb-eqp-custos"); if(b){ b.querySelector(".sb-num").textContent = brl(total).replace(",00", ""); b.classList.toggle("zero", !total); } });

  // reparos e manutenções
  const reps = rep.data || [], mans = man.data || [];
  _eqpMans = mans; // fase 59: OS abre pela linha
  setSb("sb-eqp-rep", reps.length); setSb("sb-eqp-man", mans.length);
  const repSt = { aberto: "ambar", em_execucao: "ambar", concluido: "verde", cancelado: "cinza" };
  const repLbl = (typeof ACE_REPARO_STATUS === "object" && ACE_REPARO_STATUS) || {};
  $("eqp-rep-lista").innerHTML = `<h3 class="titulo-bloco">Reparos de caldeiraria</h3>` + (rep.error ? `<p class="vazio">Erro: ${esc(rep.error.message)}</p>` : !reps.length ? `<p class="vazio">Nenhum reparo aberto para esta TAG.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>Abertura</th><th>Status</th><th>Descrição</th><th>Conclusão</th><th class="num">Custo</th></tr></thead>
    <tbody>${reps.map(r => `<tr><td>${dataBR(r.data_abertura)}</td><td><span class="tag ${esc(repSt[r.status] || "cinza")}">${esc(repLbl[r.status] || r.status)}</span></td>
      <td>${r.acessorio_id ? "⚙️ " : ""}${linkReparo(r.id, r.descricao || "reparo")}</td><td>${dataBR(r.data_conclusao)}</td>
      <td class="num">${r.custo_real != null ? brl(r.custo_real) : r.custo_estimado != null ? brl(r.custo_estimado) + " (est.)" : "—"}</td></tr>`).join("")}</tbody></table></div>`);
  const manTipo = { preventiva: "Preventiva", corretiva: "Corretiva", preditiva: "Preditiva" };
  const manSt = { agendada: ["Aberta","azul"], em_andamento: ["Em execução","ambar"], concluida: ["Concluída","verde"], cancelada: ["Cancelada","cinza"] };
  const podeOs = eqpPodeManutencao();
  // fase 92: a OS tem ficha própria no módulo Manutenção (atividades, mão de obra, peças, checklist); aqui fica a lista com link
  $("eqp-man-lista").innerHTML = `<div class="lista-topo compacta"><h3 class="titulo-bloco" style="margin:0;">Ordens de serviço (manutenção)</h3>${podeOs ? `<button type="button" class="btn btn-sm" id="btn-eqp-os-nova" style="margin-left:auto;">+ Nova OS</button>` : ""}</div>
    <p class="meta">Preventiva, corretiva ou preditiva, com atividades, mão de obra e peças (baixa no estoque) na ficha da OS em Manutenção. OS concluída com horímetro/km atualiza a máquina.</p>` + (man.error ? `<p class="vazio">Erro: ${esc(man.error.message)}</p>` : !mans.length ? `<p class="vazio">Nenhuma OS registrada para esta TAG.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>OS</th><th>Prevista</th><th>Tipo</th><th>Status</th><th>Descrição</th><th>Início</th><th>Conclusão</th><th class="num">Horímetro</th><th class="num">Custo</th></tr></thead>
    <tbody>${mans.map(m => `<tr data-os="${esc(m.id)}"><td><strong>${linkManutencao(m.id, m.numero || "OS")}</strong>${m.codigo_externo ? ` <span class="meta">${esc(m.codigo_externo)}</span>` : ""}</td><td>${dataBR(m.data_prevista)}</td><td>${esc(manTipo[m.tipo] || m.tipo)}</td>
      <td><span class="tag ${esc((manSt[m.status] || [])[1] || "cinza")}">${esc((manSt[m.status] || [])[0] || m.status)}</span></td>
      <td>${esc(m.descricao || "")}</td><td>${dataBR(m.data_inicio)}</td><td>${dataBR(m.data_conclusao)}</td>
      <td class="num">${m.horimetro_km != null ? num(m.horimetro_km) : "—"}</td><td class="num">${m.custo_real != null ? brl(m.custo_real) : m.custo != null ? brl(m.custo) : "—"}</td></tr>`).join("")}</tbody></table></div>`);
  $("btn-eqp-os-nova")?.addEventListener("click", () => {
    if(typeof manNovaOS === "function" && irParaSecao("manutencao")) manNovaOS({ equipamento_id: e.id });
    else abrirOsManutencao(null);
  });
  // fase 92: plano preventivo (semáforo) e leituras de horímetro/km da TAG
  if(typeof manRenderResumoEquipamento === "function") manRenderResumoEquipamento(e, "eqp-man-plano");
}

/* ---------- fase 101 (#85): histórico de RDOs da máquina (diário com a máquina no cabeçalho ou execução dela) ---------- */
const EQP_RDO_TIPO = { helice_continua: "Hélice contínua", trado_mecanizado: "Trado mecanizado", estaca_raiz: "Estaca raiz", helice_secante: "Hélice secante" };
async function eqpCarregarRdos(e){
  const id = e.id, cont = $("eqp-rdo-lista");
  if(!cont) return;
  const [cab, ex] = await Promise.all([
    sb.from("vw_rdo_resumo").select("id,obra_id,data,tipo_servico,status,qtd_estacas_executadas,metragem_total,concreto_total_m3").eq("equipamento_id", id).order("data", { ascending: false }).limit(500),
    // execuções desta máquina em diário de outra máquina ou sem máquina (antes da fase 94 o diário era por obra)
    sb.from("rdo_execucao_estaca").select("rdo_id,profundidade_executada,rdo:rdo_id!inner(id,obra_id,data,tipo_servico,status,equipamento_id)").eq("equipamento_id", id).limit(3000)
  ]);
  if(_eqpAtual?.id !== id) return;
  if(cab.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(cab.error.message)}</p>`; return; }
  const linhas = new Map((cab.data || []).map(r => [r.id, { ...r, origem: "diário" }]));
  (ex.data || []).forEach(x => {
    if(!x.rdo || linhas.has(x.rdo.id)) return;
    const l = linhas.get("x" + x.rdo.id) || { ...x.rdo, id: x.rdo.id, qtd_estacas_executadas: 0, metragem_total: 0, concreto_total_m3: null, origem: "execução" };
    l.qtd_estacas_executadas++; l.metragem_total = Number(l.metragem_total || 0) + Number(x.profundidade_executada || 0);
    linhas.set("x" + x.rdo.id, l);
  });
  const lista = [...linhas.values()].sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const b = $("sb-eqp-rdo"); if(b){ b.querySelector(".sb-num").textContent = lista.length; b.classList.toggle("zero", !lista.length); }
  if(!lista.length){ cont.innerHTML = `<p class="vazio">Nenhum RDO com esta máquina.</p>`; return; }
  const porObra = {};
  lista.forEach(r => { const o = porObra[r.obra_id] || (porObra[r.obra_id] = { n: 0, m: 0, ini: r.data, fim: r.data }); o.n++; o.m += Number(r.metragem_total || 0); if(r.data < o.ini) o.ini = r.data; if(r.data > o.fim) o.fim = r.data; });
  const resumo = Object.entries(porObra).sort((a, b) => String(b[1].fim).localeCompare(String(a[1].fim)))
    .map(([oid, o]) => `<span class="mob-chip">${linkObra(oid, eqpObra(oid) || "obra")} · ${esc(o.n)} RDO${o.n === 1 ? "" : "s"} · ${num(o.m)} m · ${dataBR(o.ini)}–${dataBR(o.fim)}</span>`).join(" ");
  cont.innerHTML = `<div class="lista-topo compacta"><h3 class="titulo-bloco" style="margin:0;">RDOs desta máquina <span class="contador">${lista.length}</span></h3>
      <span class="meta" style="margin-left:auto;">Total ${num(lista.reduce((s, r) => s + Number(r.metragem_total || 0), 0))} m</span></div>
    <div style="margin:6px 0 10px;">${resumo}</div>
    <div class="tabela-rola"><table><thead><tr><th>Data</th><th>Obra</th><th>Tipo</th><th title="diário = máquina no cabeçalho; execução = linha desta máquina em diário de outra (ou sem máquina)">Vínculo</th><th class="num">Estacas</th><th class="num">Metragem</th><th class="num">Concreto</th><th>Status</th></tr></thead>
    <tbody>${lista.map(r => `<tr class="linha-clicavel" data-rdo="${esc(r.id)}"><td>${dataBR(r.data)}</td><td>${linkObra(r.obra_id, eqpObra(r.obra_id) || "obra")}</td>
      <td>${esc(EQP_RDO_TIPO[r.tipo_servico] || r.tipo_servico || "")}</td><td>${esc(r.origem)}</td><td class="num">${esc(r.qtd_estacas_executadas || 0)}</td>
      <td class="num">${num(r.metragem_total || 0)} m</td><td class="num">${r.concreto_total_m3 != null ? num(r.concreto_total_m3) + " m³" : "—"}</td><td>${tagStatus("rdo", r.status)}</td></tr>`).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-rdo]").forEach(tr => tr.addEventListener("click", ev => {
    if(ev.target.closest("a")) return;
    if(irParaSecao("rdo") && typeof abrirRDO === "function") abrirRDO(tr.dataset.rdo);
  }));
}
/* fase 101 (#109): obra e condutor atuais do vínculo de trabalho (obra_equipamentos, aba Máquinas da obra) */
async function eqpCarregarTrabalho(e){
  const box = $("eqp-chip-trab-box");
  if(!box) return;
  const { data, error } = await sb.from("obra_equipamentos").select("obra_id,de,ate,condutor:funcionarios(nome)").eq("equipamento_id", e.id)
    .or(`ate.is.null,ate.gte.${hojeISO()}`).order("de", { ascending: false }).limit(5);
  if(_eqpAtual?.id !== e.id) return;
  if(error || !data || !data.length){ box.style.display = "none"; return; }
  $("eqp-chip-trab").innerHTML = data.map(v => `${linkObra(v.obra_id, eqpObra(v.obra_id) || "obra")}${v.condutor?.nome ? " · " + esc(v.condutor.nome) : ""}`).join("; ");
  box.style.display = "";
}

/* ---------- Fase 59: OS de manutenção (tabela manutencoes, sem tela até aqui) ---------- */
let _eqpMans = [];
let _eqpOsId = null;
const EQP_OS_TIPO = { preventiva: "Preventiva", corretiva: "Corretiva", preditiva: "Preditiva" };
const EQP_OS_STATUS = { agendada: "Agendada", em_andamento: "Em andamento", concluida: "Concluída", cancelada: "Cancelada" };
/* fase 92: espelha manutencao_pode_operar() (admin, engenheiro, mecânico, gestor_frota, logística, gestor_manutencao; diretor por has_role) */
function eqpPodeManutencao(){
  return !!usuarioAtual && ["admin","diretor","mecanico","engenheiro","gestor_frota","logistica","gestor_manutencao"].includes(usuarioAtual.cargo);
}
function abrirOsManutencao(m){
  if(!_eqpAtual?.id){ aviso("app-aviso", "Salve o equipamento antes de abrir uma OS.", "erro"); return; }
  if(!eqpPodeManutencao()){ aviso("app-aviso", "Seu perfil não abre OS de manutenção.", "erro"); return; }
  _eqpOsId = m?.id || null;
  const fornSel = $("eqp-os-forn");
  if(fornSel && fornSel.options.length <= 1){
    fornSel.innerHTML = `<option value="">— interno / sem fornecedor —</option>` + Object.entries(typeof mapaFornecedores === "object" ? mapaFornecedores : {}).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR")).map(([id, nome]) => `<option value="${esc(id)}">${esc(nome)}</option>`).join("");
  }
  $("eqp-os-titulo").textContent = m ? `${m.numero || "OS"} · TAG ${_eqpAtual.codigo}` : `Nova OS · TAG ${_eqpAtual.codigo}`;
  $("eqp-os-tipo").value = m?.tipo || "corretiva"; $("eqp-os-status").value = m?.status || "agendada";
  $("eqp-os-desc").value = m?.descricao || ""; $("eqp-os-prev").value = m?.data_prevista || hojeISO();
  $("eqp-os-ini").value = m?.data_inicio || ""; $("eqp-os-fim").value = m?.data_conclusao || "";
  $("eqp-os-hor").value = m?.horimetro_km ?? (_eqpAtual.horimetro ?? ""); $("eqp-os-forn").value = m?.fornecedor_id || "";
  $("eqp-os-custo").value = m?.custo ?? ""; $("eqp-os-obs").value = m?.observacoes || "";
  $("eqp-os-modal").style.display = "flex";
}
function fecharOsManutencao(){ $("eqp-os-modal").style.display = "none"; _eqpOsId = null; }
async function salvarOsManutencao(){
  if(!_eqpAtual?.id) return;
  const reg = { equipamento_id: _eqpAtual.id, tipo: $("eqp-os-tipo").value, status: $("eqp-os-status").value, descricao: $("eqp-os-desc").value.trim() || null,
    data_prevista: $("eqp-os-prev").value || null, data_inicio: $("eqp-os-ini").value || null, data_conclusao: $("eqp-os-fim").value || null,
    horimetro_km: $("eqp-os-hor").value === "" ? null : Number($("eqp-os-hor").value), fornecedor_id: $("eqp-os-forn").value || null,
    custo: $("eqp-os-custo").value === "" ? null : Number($("eqp-os-custo").value), observacoes: $("eqp-os-obs").value.trim() || null };
  if(!reg.descricao){ aviso("app-aviso", "Descreva o serviço da OS.", "erro"); return; }
  if(reg.status === "concluida" && reg.fornecedor_id && (reg.custo == null) && !confirm("OS concluída com fornecedor e sem custo: o serviço não vai aparecer no custo da máquina. Salvar assim mesmo?")) return;
  const q = _eqpOsId ? sb.from("manutencoes").update(reg).eq("id", _eqpOsId) : sb.from("manutencoes").insert(reg) // aberto_por = auth.uid() no banco (responsavel_id é funcionário, não usuário);
  const { error } = await q;
  if(error){ aviso("app-aviso", "Não foi possível salvar a OS: " + error.message, "erro"); return; }
  aviso("app-aviso", _eqpOsId ? "OS atualizada." : "OS aberta.", "ok");
  fecharOsManutencao();
  const e = _eqpAtual;
  if(reg.status === "concluida" && reg.horimetro_km != null && (e.horimetro == null || e.horimetro < reg.horimetro_km)){ e.horimetro = reg.horimetro_km; if($("eqp-horimetro")) $("eqp-horimetro").value = reg.horimetro_km; }
  eqpCarregarFilhas(e);
}

/* ---------- aba Acessórios (a GERAL da planilha de hélice) ---------- */
function eqpAceTodos(){
  const m = new Map();
  [..._eqpAceCache.na, ..._eqpAceCache.pertence, ..._eqpAceCache.compat].forEach(a => m.set(a.id, a));
  return [...m.values()];
}
function eqpAceOrigem(a){
  const t = [];
  if(_eqpAceCache.na.some(x => x.id === a.id)) t.push("na máquina");
  if(_eqpAceCache.pertence.some(x => x.id === a.id)) t.push("pertence");
  if(_eqpAceCache.compat.some(x => x.id === a.id)) t.push("compatível");
  return t.join(" · ");
}
function eqpRenderAcessorios(){
  const c = $("eqp-ace-lista"); if(!c) return;
  document.querySelectorAll("#eqp-ace-modo .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.modo === _eqpAceModo));
  const base = _eqpAceModo === "na" ? _eqpAceCache.na : _eqpAceModo === "pertence" ? _eqpAceCache.pertence : _eqpAceModo === "compat" ? _eqpAceCache.compat : eqpAceTodos();
  if(!base.length){
    c.innerHTML = `<p class="vazio">${_eqpAceModo ? "Nenhuma peça nesta visão." : "Nenhuma peça ligada a esta máquina. Na ficha do acessório, informe <em>Pertence à TAG</em> ou marque como compatível; peças movidas para a máquina aparecem aqui sozinhas."}</p>`;
    return;
  }
  // jogo separado: irmãos do jogo (no catálogo inteiro) em lugares diferentes
  const cat = _eqpAceCache.cat || [];
  const jogoLocais = {};
  cat.forEach(a => { if(!a.jogo) return; const k = `${a.familia}|${a.jogo}`; const loc = (typeof aceColKey === "function") ? aceColKey(a) : (a.local_tipo + ":" + (a.local_equipamento_id || a.local_obra_id || "")); (jogoLocais[k] = jogoLocais[k] || new Set()).add(loc); });
  const separado = a => a.jogo && (jogoLocais[`${a.familia}|${a.jogo}`]?.size || 0) > 1;
  const descr = a => (typeof aceDescr === "function" ? aceDescr(a) : (a.tipo || ""));
  const onde = a => (typeof aceOnde === "function" ? aceOnde(a) : (a.local_tipo || ""));
  // grupos por Ø (desc), peças sem Ø no fim; dentro: jogo, seq, marcação
  const porDiam = new Map();
  base.forEach(a => { const k = a.diametro_mm ? Number(a.diametro_mm) : 0; (porDiam.get(k) || porDiam.set(k, []).get(k)).push(a); });
  const chaves = [...porDiam.keys()].sort((x, y) => (x === 0) - (y === 0) || y - x);
  const ordem = (x, y) => String(x.jogo || "").localeCompare(String(y.jogo || ""), "pt-BR", { numeric: true }) || (Number(x.seq_no_jogo) || 0) - (Number(y.seq_no_jogo) || 0) || String(x.marcacao).localeCompare(String(y.marcacao), "pt-BR", { numeric: true });
  c.innerHTML = chaves.map(k => {
    const ps = porDiam.get(k).sort(ordem);
    const jogos = new Set(ps.filter(a => a.jogo).map(a => a.jogo));
    return `<div class="eqp-diam-bloco">
      <div class="eqp-diam-titulo">${k ? `Ø ${esc(k)} mm` : "Sem Ø (guias, prolongas, caixas, bombas…)"} <span class="meta">${ps.length} peça(s)${jogos.size ? ` · ${jogos.size} jogo(s)` : ""}</span></div>
      <div class="tabela-rola"><table>
        <thead><tr><th>Jogo</th><th>Marcação</th><th>Peça</th><th class="num">Passo</th><th class="num">Compr.</th><th>Condição</th><th>Onde está</th><th>Vínculo</th></tr></thead>
        <tbody>${ps.map(a => `<tr class="linha-clicavel" data-ace="${esc(a.id)}">
          <td>${a.jogo ? `<strong>${esc(a.jogo)}</strong>${a.seq_no_jogo != null ? ` <span class="meta">#${esc(a.seq_no_jogo)}</span>` : ""}${separado(a) ? ` <span class="tag vermelho" title="peças deste jogo estão em lugares diferentes">jogo separado</span>` : ""}` : "—"}</td>
          <td><strong>${esc(a.marcacao)}</strong></td>
          <td>${esc(descr(a))}</td>
          <td class="num">${a.passo_mm ? esc(a.passo_mm) : "—"}</td>
          <td class="num">${a.comprimento_m ? esc(a.comprimento_m) + " m" : "—"}</td>
          <td>${tagStatus("acessorio", a.condicao)}</td>
          <td>${esc(onde(a))}</td>
          <td class="meta">${esc(eqpAceOrigem(a))}</td>
        </tr>`).join("")}</tbody></table></div>
    </div>`;
  }).join("");
}

/* ---------- salvar ---------- */
async function salvarEquipamento(){
  const vendido = !!_eqpAtual && (_eqpAtual.status === "vendido" || !!_eqpAtual.venda_id);
  const podeCadastro = eqpPodeEditar() && !vendido;   // fase 96: bem vendido fica só para consulta
  const mudouValor = eqpValorBemMudou();              // valor e data de aquisição: diretoria e financeiro, também em bem vendido
  // valor para remessa: só diretoria e financeiro, pela RPC (nunca no update do cadastro)
  const remessa = typeof fiscalItemRemessaMudou === "function" ? fiscalItemRemessaMudou("eqp") : null;
  if(remessa && remessa.erro){ aviso("app-aviso", remessa.erro, "erro"); ativarTabEquipamento("fiscal"); return; }
  if(!podeCadastro){
    if((mudouValor || remessa) && _eqpEditId){
      const idBem = _eqpEditId;
      if(mudouValor){
        const erroValor = await eqpValorBemGravar(idBem);
        if(erroValor){ aviso("app-aviso", "O valor de aquisição não foi gravado: " + erroValor.message, "erro"); return; }
      }
      if(remessa){
        const r = await fiscalRemessaGravar([{ id: idBem, valor: remessa.valor }]);
        if(r.erro){ aviso("app-aviso", "O valor para remessa não foi gravado: " + r.erro, "erro"); return; }
      }
      aviso("app-aviso", mudouValor && remessa ? "Valor de aquisição e valor para remessa salvos." : mudouValor ? "Valor de aquisição salvo." : "Valor para remessa salvo.", "ok");
      await carregarEquipamentos(true);
      await abrirEquipamento(idBem);
    } else if(vendido && eqpPodeEditar()) aviso("app-aviso", "Bem vendido: o cadastro fica só para consulta.", "erro");
    else if(eqpValorBemEditavel()) aviso("app-aviso", "Nada para salvar: o valor de aquisição e o valor para remessa não mudaram.", "aviso");
    return;
  }
  const n = v => v === "" ? null : Number(v);
  const localTipo = $("eqp-local-tipo").value;
  const reg = {
    nome: $("eqp-nome").value.trim(), tipo: $("eqp-tipo").value,
    marca: $("eqp-marca").value.trim() || null, modelo: $("eqp-modelo").value.trim() || null,
    ano_fabricacao: n($("eqp-ano").value), numero_serie: $("eqp-serie").value.trim() || null,
    horimetro: n($("eqp-horimetro").value),   // valor e data de aquisição não entram aqui: vão por eqpValorBemGravar()
    codigo_externo: $("eqp-cod-ext").value.trim() || null, ativo: $("eqp-ativo").checked,
    localizacao_tipo: localTipo,
    localizacao_obra_id: ["obra","em_transito","cliente"].includes(localTipo) ? ($("eqp-local-obra").value || null) : null,
    localizacao_descricao: $("eqp-local-desc").value.trim() || null,
    observacoes: $("eqp-obs").value.trim() || null,
    encaixe_trado: $("eqp-encaixe").value.trim() || null, acoplamento_trado: $("eqp-acopl").value || null,
    diametro_max_mm: n($("eqp-diam-max").value), profundidade_max_m: n($("eqp-prof-max").value), pino_trado_mm: n($("eqp-pino").value),
    obs_acessorios: $("eqp-obs-ace").value.trim() || null
  };
  if(!reg.nome){ aviso("app-aviso", "Informe o nome do equipamento.", "erro"); $("eqp-nome").focus(); return; }
  if(reg.localizacao_tipo === "obra" && !reg.localizacao_obra_id){ aviso("app-aviso", "Escolha a obra em que a máquina está.", "erro"); return; }
  // fase 105a: NCM, unidade comercial e valor da remessa (só com as colunas no banco)
  const fis = typeof fiscalItemValores === "function" ? fiscalItemValores("eqp") : null;
  if(fis && fis.erro){ aviso("app-aviso", fis.erro, "erro"); ativarTabEquipamento("fiscal"); return; }
  if(fis) Object.assign(reg, fis);
  if($("eqp-tipo-servico-campo") && $("eqp-tipo-servico-campo").style.display !== "none") reg.tipo_servico_padrao = $("eqp-tipo-servico").value || null;   // fase 107a
  // lote S63-g (#284): vínculo com o principal; quem já é principal de outro fica travado (o banco também recusa)
  const selPrin = $("eqp-principal");
  if($("eqp-principal-campo") && $("eqp-principal-campo").style.display !== "none" && selPrin && selPrin.dataset.carregado === "1" && selPrin.dataset.travado !== "1") reg.equipamento_principal_id = selPrin.value || null;
  const atual = _eqpAtual || {};
  const mudouLocal = _eqpEditId && (atual.localizacao_tipo !== reg.localizacao_tipo || (atual.localizacao_obra_id || null) !== reg.localizacao_obra_id || (atual.localizacao_descricao || null) !== reg.localizacao_descricao);
  if(mudouLocal) reg.localizacao_atualizada_em = new Date().toISOString();
  let id = _eqpEditId;
  if(id){
    const { error } = await sb.from("equipamentos").update(reg).eq("id", id);
    if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return; }
  } else {
    const codigo = $("eqp-codigo").value.trim().toUpperCase();
    if(!codigo){ aviso("app-aviso", "Informe a TAG.", "erro"); $("eqp-codigo").focus(); return; }
    if(_eqpRegistros.some(e => String(e.codigo).toUpperCase() === codigo)){ aviso("app-aviso", `Já existe a TAG ${codigo}.`, "erro"); return; }
    const { data, error } = await sb.from("equipamentos").insert({ ...reg, codigo, status: "disponivel" }).select("id").single();
    if(error){ aviso("app-aviso", "Erro ao cadastrar: " + error.message, "erro"); return; }
    id = data.id;
  }
  const erroValor = mudouValor ? await eqpValorBemGravar(id) : null;
  const erroRemessa = remessa ? (await fiscalRemessaGravar([{ id, valor: remessa.valor }])).erro : null;
  if(erroValor) aviso("app-aviso", "Cadastro salvo, mas o valor de aquisição não foi gravado: " + erroValor.message, "erro");
  else if(erroRemessa) aviso("app-aviso", "Cadastro salvo, mas o valor para remessa não foi gravado: " + erroRemessa, "erro");
  else aviso("app-aviso", "Equipamento salvo.", "ok");
  await carregarEquipamentos(true);
  await abrirEquipamento(id);
}
async function eqpMudarStatus(novo){
  if(!_eqpEditId) return;
  if(novo === (_eqpAtual.status || "disponivel")) return;
  // fase 96: "Vendido" nasce do registro da venda (modal); sair de vendido só cancelando a venda
  if(_eqpAtual.status === "vendido" || _eqpAtual.venda_id){ aviso("app-aviso", `${_eqpAtual.codigo} foi vendido. Para devolvê-lo ao cadastro, cancele a venda na aba Venda.`, "erro"); ativarTabEquipamento("venda"); return; }
  if(novo === "vendido"){ if(typeof vbAbrirRegistro === "function") vbAbrirRegistro(_eqpAtual, null); return; }
  if(!eqpPodeEditar()) return;
  const lbl = eqpLbl(novo);
  if(novo === "inativo" && !confirm(`Marcar ${_eqpAtual.codigo} como INATIVO? A TAG some das listas de mobilização e remessa.`)) return;
  const { error } = await sb.from("equipamentos").update({ status: novo }).eq("id", _eqpEditId);
  if(error){ aviso("app-aviso", "Não foi possível mudar o status: " + error.message, "erro"); return; }
  aviso("app-aviso", `${_eqpAtual.codigo}: ${lbl}.`, "ok");
  await carregarEquipamentos(true);
  await abrirEquipamento(_eqpEditId);
}

/* ---------- atalhos para outros módulos ---------- */
function eqpNovaRemessa(){
  const e = _eqpAtual; if(!e?.id) return;
  if(!irParaSecao("movimentacoes") || typeof novaMovimentacao !== "function") return;
  setTimeout(() => {
    novaMovimentacao();
    const sel = $("mov-add-equip");
    if(sel && typeof adicionarEquipamento === "function"){
      if(![...sel.options].some(o => o.value === e.id)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`);
      if(!mapaEquipamentos[e.id]) mapaEquipamentos[e.id] = e;
      sel.value = e.id; adicionarEquipamento();
    }
    if(e.localizacao_tipo === "obra" && e.localizacao_obra_id && typeof movDefinirObra === "function"){
      $("mov-tipo").value = "retorno"; movDefinirObra("origem", e.localizacao_obra_id);
      $("mov-destino-tipo").value = "base"; $("mov-destino-descricao").value = "Base Itabira"; $("mov-destino-uf").value = "mg";
      if(typeof toggleObraCampos === "function") toggleObraCampos();
    }
    if(typeof ativarTab === "function") ativarTab("itens");
    aviso("app-aviso", `Movimentação pré-preenchida com a TAG ${e.codigo}. Revise origem/destino e as peças sugeridas.`, "ok");
  }, 250);
}
function eqpVerAcessorios(){
  const e = _eqpAtual; if(!e?.id) return;
  if(!irParaSecao("acessorios")) return;
  const aplicar = () => {
    const f = $("ace-f-equip"); if(!f) return;
    if(![...f.options].some(o => o.value === e.id)) f.insertAdjacentHTML("beforeend", `<option value="${esc(e.id)}">${esc(e.codigo)}</option>`);
    f.value = e.id;
    if(typeof _aceFamilia !== "undefined"){ _aceFamilia = ""; document.querySelectorAll("#ace-familias .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.familia === "")); }
    if(typeof renderAcessorios === "function") renderAcessorios();
  };
  if(typeof carregarAcessorios === "function") carregarAcessorios(false).then(aplicar); else setTimeout(aplicar, 400);
}
async function eqpAbrirAcessorio(id){
  if(!irParaSecao("acessorios")) return;
  if(typeof carregarAcessorios === "function") await carregarAcessorios(false);
  if(typeof abrirAcessorio === "function") abrirAcessorio(id);
}
async function eqpAbrirMobilizacao(id){
  if(!irParaSecao("mobilizacoes")) return;
  if(typeof carregarMobilizacoes === "function") await carregarMobilizacoes(false);
  if(typeof abrirMobilizacao === "function") abrirMobilizacao(id);
}
async function eqpAbrirMovimentacao(id){
  if(!irParaSecao("movimentacoes")) return;
  if(typeof carregarMovimentacoes === "function" && !(typeof _movRegistros !== "undefined" && _movRegistros.length)) await carregarMovimentacoes();
  if(typeof abrirMovimentacao === "function") abrirMovimentacao(id);
}

/* ---------- ligação ---------- */
function ligarEquipamentos(){
  if(!$("sec-equipamentos")) return;
  document.querySelector('nav button[data-secao="equipamentos"]')?.addEventListener("click", () => carregarEquipamentos(false));
  document.querySelectorAll("#eqp-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _eqpView = b.dataset.view; renderEquipamentos(); }));
  document.querySelectorAll("#eqp-painel .ind[data-kpi]").forEach(el => el.addEventListener("click", () => { _eqpKpi = (_eqpKpi === el.dataset.kpi) ? "" : el.dataset.kpi; renderEquipamentos(); }));
  ["eqp-f-tipo","eqp-f-status","eqp-f-local","eqp-f-obra","eqp-f-inativos"].forEach(id => $(id)?.addEventListener("change", renderEquipamentos));
  $("eqp-busca")?.addEventListener("input", debounce(renderEquipamentos));
  $("btn-eqp-atualizar")?.addEventListener("click", () => carregarEquipamentos(true));
  $("btn-eqp-novo")?.addEventListener("click", novoEquipamento);
  $("eqp-sem-busca")?.addEventListener("input", debounce(eqpSemRender));   // lote S58 (#232)
  $("eqp-sem-grupo")?.addEventListener("change", eqpSemRender);
  $("btn-eqp-sem-salvar")?.addEventListener("click", () => comBotaoTravado("btn-eqp-sem-salvar", eqpSemSalvar));
  $("eqp-vrm-busca")?.addEventListener("input", debounce(eqpVrmRender));   // valor para remessa
  ["eqp-vrm-f-situacao", "eqp-vrm-f-valor"].forEach(id => $(id)?.addEventListener("change", eqpVrmRender));
  $("btn-eqp-vrm-salvar")?.addEventListener("click", () => comBotaoTravado("btn-eqp-vrm-salvar", eqpVrmSalvar));
  $("eqp-vrm-imp-arquivo")?.addEventListener("change", e => { const f = e.target.files?.[0]; e.target.value = ""; eqpVrmImportarArquivo(f); });
  $("eqp-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a.link-obra")) return;
    const el = e.target.closest("[data-id]");
    if(el) abrirEquipamento(el.dataset.id);
  });

  // ficha
  $("btn-eqp-voltar")?.addEventListener("click", mostrarPainelEquipamentos);
  $("btn-eqp-salvar")?.addEventListener("click", () => comBotaoTravado("btn-eqp-salvar", salvarEquipamento));
  $("btn-eqp-remessa")?.addEventListener("click", eqpNovaRemessa);
  $("btn-eqp-acessorios")?.addEventListener("click", eqpVerAcessorios);
  $("btn-eqp-vender")?.addEventListener("click", () => { if(_eqpAtual && typeof vbAbrirRegistro === "function") vbAbrirRegistro(_eqpAtual, null); });   // fase 96
  $("eqp-local-tipo")?.addEventListener("change", eqpToggleLocalObra);
  document.querySelectorAll("#eqp-notebook button").forEach(b => b.addEventListener("click", () => ativarTabEquipamento(b.dataset.tab)));
  document.querySelectorAll("#eqp-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => ativarTabEquipamento(b.dataset.gotoTab)));
  document.querySelectorAll("#eqp-statusbar .stage").forEach(st => st.addEventListener("click", () => eqpMudarStatus(st.dataset.status)));
  document.querySelectorAll("#eqp-ace-modo .serv-view-btn").forEach(b => b.addEventListener("click", () => { _eqpAceModo = b.dataset.modo; eqpRenderAcessorios(); }));
  $("eqp-ace-lista")?.addEventListener("click", e => { const tr = e.target.closest("tr[data-ace]"); if(tr) eqpAbrirAcessorio(tr.dataset.ace); });
  $("eqp-mob-lista")?.addEventListener("click", e => { if(e.target.closest("a.link-obra")) return; const tr = e.target.closest("tr[data-mob]"); if(tr) eqpAbrirMobilizacao(tr.dataset.mob); });
  $("eqp-mov-lista")?.addEventListener("click", e => {
    if(e.target.closest("a.link-obra, a.link-cad")) return;
    const tv = e.target.closest("tr[data-vg]");   // fase 89: linha da viagem abre a ficha em Logística
    if(tv){ if(irParaSecao("frota") && typeof abrirViagem === "function") abrirViagem(tv.dataset.vg, null); return; }
    const tr = e.target.closest("tr[data-mov]"); if(tr) eqpAbrirMovimentacao(tr.dataset.mov);
  });
  // fase 59: OS de manutenção
  // fase 92: a linha abre a ficha da OS em Manutenção (o modal da fase 59 fica só como reserva, sem o módulo carregado)
  $("eqp-man-lista")?.addEventListener("click", e => {
    if(e.target.closest("button") || e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-os]"); if(!tr) return;
    if(typeof abrirManutencao === "function"){ if(irParaSecao("manutencao")) abrirManutencao(tr.dataset.os); }
    else if(eqpPodeManutencao()) abrirOsManutencao(_eqpMans.find(m => m.id === tr.dataset.os) || null);
  });
  $("btn-eqp-os-fechar")?.addEventListener("click", fecharOsManutencao);
  $("btn-eqp-os-salvar")?.addEventListener("click", () => comBotaoTravado("btn-eqp-os-salvar", salvarOsManutencao));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarEquipamentos);
else ligarEquipamentos();

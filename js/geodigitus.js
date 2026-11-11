/* ====================================================================
   Módulo: Geodigitus pelo S3 — fase 107a
   - Visão "Chegadas do Geodigitus" no painel do RDO (#sec-rdo, toggle data-view="geo", prefixo geo-): desde a fase 134a,
     uma linha por grupo (dia + máquina + obra), com Ver estacas, Definir ou Trocar obra, Vincular estacas, Abrir RDO,
     Resolver de novo e Ignorar; Ver estacas abre as linhas com as ações de cada estaca. Fase 134b: Mudar período do grupo
     (diurno/noturno, com prévia e motivo, RPCs geodigitus_periodo_previa e geodigitus_definir_periodo_grupo), situação
     "Aguardando o turno" (pendente_turno: a noite ainda não se decidiu; Resolver de novo chama geodigitus_turnos_reavaliar)
     e a etiqueta do período no grupo e na estaca. Fase 141: chegada "a confirmar" (vw_geodigitus_estacas), com o bloco
     "O que foi?" e chips (geodigitus_confirmar, prévia em geodigitus_confirmar_previa).
     Tudo grava pelas RPCs geodigitus_* (rdo_pode_operar() no banco: admin, engenheiro, assistente de engenharia,
     encarregado; diretor). As tabelas geodigitus_* só a service role grava.
   - Badge "Geodigitus" e sobreconsumo na execução do RDO (geoBadgeExec, chamado por renderExecucoes em rdo.js).
   - Fase 162: a ação "Perfil" de cada estaca das Chegadas e o selo do RDO, agora clicável, abrem o perfil e o replay da
     estaca (abrirPerfilEstaca, em js/estaca_perfil.js). É leitura: aparece para todo usuário que vê a tela.
   - Card "Geodigitus" na Sala de Comando (geoCarregarCardSala, chamado por dashboard.js).
   - Bloco Geodigitus em Usuários › parâmetros da empresa (empresa_config.geodigitus_*, só diretor e admin).
   Regra 1 da fase: o Geodigitus é a fonte primária das estacas de hélice e secante; o Maya complementa.
   Sem a migration da 107a aplicada, cada parte some ou avisa, sem erro na tela.
   ==================================================================== */

let _geoDados = null;          // geodigitus_estacas com arquivo, máquina, obra e estaca
let _geoExecs = {};            // rdo_execucao_id → { sobreconsumo_pct, situacao }
let _geoIndisponivel = false;
let _geoModal = null;          // { tipo: "obra" | "estaca", geo } ou { tipo: "grupo_obra" | "grupo_estaca" | "grupo_ignorar" | "grupo_periodo", grupo, geos }
let _geoGrupos = [];           // grupos da última tela
const _geoAbertos = new Set(); // chaves dos grupos com as estacas abertas

const GEO_SITUACAO_LBL = {
  pendente_maquina: "Sem máquina", pendente_obra: "Sem obra", pendente_estaca: "Estaca a vincular",
  pendente_rdo_finalizado: "Diário finalizado", pendente_turno: "Aguardando o turno", vinculada: "No diário", conciliada: "Conciliada", ignorada: "Ignorada"
};
const GEO_SITUACAO_COR = {
  pendente_maquina: "vermelho", pendente_obra: "vermelho", pendente_estaca: "ambar", pendente_rdo_finalizado: "ambar", pendente_turno: "cinza",
  vinculada: "verde", conciliada: "verde", ignorada: "cinza"
};
// fase 134b: pendente_turno fica fora de GEO_PENDENTES de propósito: aguardar a noite não é pendência (nem em Para regularizar)
const GEO_TURNO_LBL = { diurno: "Diurno", noturno: "Noturno" };
const GEO_PENDENTES = ["pendente_maquina", "pendente_obra", "pendente_estaca", "pendente_rdo_finalizado"];
const GEO_FILTRO_SIT = { geodigitus_estaca_sem_maquina: "pendente_maquina", geodigitus_estaca_sem_obra: "pendente_obra",
  geodigitus_estaca_sem_cadastro: "pendente_estaca", geodigitus_rdo_finalizado: "pendente_rdo_finalizado", geodigitus_estaca_a_confirmar: "a_confirmar" };
// fase 141: o que a chegada pode ter sido e por que ela pede confirmação
const GEO_CONFIRMACOES = [
  { valor: "refuro", rotulo: "Refuro" }, { valor: "teste", rotulo: "Teste de máquina" }, { valor: "ok_arquivo", rotulo: "Está certa" },
  { valor: "duplicada", rotulo: "Duplicada" }, { valor: "outro", rotulo: "Outro" }
];
const GEO_RAZAO_LBL = { arquivo_incompleto: "arquivo sem o fim da perfuração", refuro: "número de refuro", raso: "menos de 1 m", repetida: "mesmo número no dia" };
const geoRazoesTxt = (g) => (g.razoes || []).map(r => GEO_RAZAO_LBL[r] || r).join(", ");
const geoConfirmacaoLbl = (g) => (GEO_CONFIRMACOES.find(c => c.valor === g.confirmacao)?.rotulo || g.confirmacao) + (g.confirmacao_motivo ? " · " + motivoRefuradaLbl(g.confirmacao_motivo) : "");

/* espelha rdo_pode_operar() do banco */
function geoPodeOperar(){
  return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "admin", "engenheiro", "assistente_engenharia", "encarregado"].includes(usuarioAtual.cargo);
}
const geoIndisp = (err) => !!err && ["42P01", "PGRST205", "PGRST200", "42703", "PGRST202", "42883"].includes(err.code);
const geoNum = (v, casas = 2) => v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const geoHora = (ts) => ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";
function geoTagSobre(pct){
  if(pct == null) return "";
  const alerta = Number(pct) > (window._geoAlertaPct ?? 15);
  return `<span class="tag ${alerta ? "ambar" : "cinza"}" title="Sobreconsumo de concreto sobre o volume teórico (Ø × profundidade)">${Number(pct) > 0 ? "+" : ""}${esc(geoNum(pct, 1))}%</span>`;
}

/* ---------- Chegadas do Geodigitus ---------- */
async function geoCarregar(force){
  if(_geoDados && !force) return _geoDados;
  const { data, error } = await sb.from("geodigitus_estacas")
    .select("id,situacao,obra_inferida,obra_regra,obra_sugerida_id,candidatos,contrato_txt,obra_txt,numero_txt,refuro,diametro_mm,profundidade_m,volume_concreto_m3,volume_teorico_m3,sobreconsumo_pct,torque_max_bar,perfuracao_inicio,perfuracao_fim,concretagem_inicio,concretagem_fim,avisos,ignorado_motivo,rdo_id,rdo_execucao_id,obra_id,equipamento_id,estaca_id,computador_id,turno_manual,created_at," +
            "arquivo:geodigitus_arquivos(id,data_arquivo,hora,imei,chave),equipamento:equipamentos(codigo),obra:obras!geodigitus_estacas_obra_id_fkey(codigo,nome),obra_sugerida:obras!geodigitus_estacas_obra_sugerida_id_fkey(codigo,nome),estaca:estacas(numero,local),rdo:rdo(turno_campo,data)")
    .order("created_at", { ascending: false }).limit(1500);
  if(error){ _geoIndisponivel = geoIndisp(error); _geoDados = []; if(!_geoIndisponivel) aviso("app-aviso", "Não foi possível carregar as chegadas do Geodigitus: " + error.message, "erro"); return _geoDados; }
  _geoIndisponivel = false;
  _geoDados = data || [];
  // fase 141: a leitura é à parte; sem a migration, a tela segue sem a confirmação
  const conf = await lerTudo(() => sb.from("vw_geodigitus_estacas").select("id,a_confirmar,razoes,confirmacao,confirmacao_motivo,confirmacao_obs").or("a_confirmar.eq.true,confirmacao.not.is.null"));
  if(!conf.error){
    const porId = new Map(conf.data.map(c => [c.id, c]));
    _geoDados.forEach(g => { const c = porId.get(g.id); if(c) Object.assign(g, c); });
  }
  geoPreencherFiltroMaquina();
  return _geoDados;
}
function geoPreencherFiltroMaquina(){
  const sel = $("geo-f-maq"); if(!sel) return;
  const atual = sel.value;
  const maqs = [...new Map((_geoDados || []).filter(g => g.equipamento_id).map(g => [g.equipamento_id, g.equipamento?.codigo || "?"])).entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR", { numeric: true }));
  sel.innerHTML = `<option value="">Todas as máquinas</option><option value="sem">Sem máquina</option>` + maqs.map(([id, cod]) => `<option value="${esc(id)}">${esc(cod)}</option>`).join("");
  if(atual) sel.value = atual;
}
function geoFiltradas(){
  const dia = $("geo-f-dia")?.value || "", maq = $("geo-f-maq")?.value || "", sit = $("geo-f-sit")?.value || "";
  const q = ($("geo-busca")?.value || "").trim().toLowerCase();
  return (_geoDados || []).filter(g => {
    if(dia && geoDia(g) !== dia) return false;
    if(maq === "sem" ? g.equipamento_id : (maq && g.equipamento_id !== maq)) return false;
    if(sit === "a_confirmar" ? !g.a_confirmar : sit === "pendentes" ? !GEO_PENDENTES.includes(g.situacao) : (sit && g.situacao !== sit)) return false;
    if(!q) return true;
    return `${g.numero_txt || ""} ${g.obra_txt || ""} ${g.contrato_txt || ""} ${g.obra?.codigo || ""} ${g.obra?.nome || ""} ${g.obra_sugerida?.codigo || ""} ${g.equipamento?.codigo || ""} ${g.arquivo?.imei || ""}`.toLowerCase().includes(q);
  });
}
function geoAcoesHTML(g){
  const pode = geoPodeOperar(), b = [];
  // fase 162: leitura, vale para todo usuário que vê a tela (inclusive o só leitura)
  b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="perfil" data-geo="${esc(g.id)}" title="Gráfico por profundidade e replay da execução, com o que o computador de bordo gravou">Perfil</button>`);
  if(pode && g.situacao === "pendente_obra") b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="obra" data-geo="${esc(g.id)}">Definir obra</button>`);
  if(pode && (g.situacao === "pendente_estaca" || (["vinculada", "conciliada"].includes(g.situacao) && !g.estaca_id))) b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="estaca" data-geo="${esc(g.id)}">Vincular estaca</button>`);
  if(pode && ["pendente_maquina", "pendente_obra", "pendente_rdo_finalizado"].includes(g.situacao)) b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="resolver" data-geo="${esc(g.id)}" title="Depois de corrigir o vínculo da CPU, a mobilização ou reabrir o diário">Resolver de novo</button>`);
  if(pode && g.situacao === "pendente_turno") b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="resolver" data-geo="${esc(g.id)}" title="Fase 134b: a noite ainda não se decidiu entre diurno e noturno; reavalia agora (noite encerrada e curta vai para o diurno). Para escolher o período, use Mudar período no grupo.">Reavaliar turno</button>`);
  if(g.situacao === "pendente_maquina" && g.computador_id) b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="cpu" data-geo="${esc(g.id)}">Abrir CPU</button>`);
  if(g.rdo_id) b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="rdo" data-geo="${esc(g.id)}">Abrir RDO</button>`);
  if(pode && g.situacao !== "ignorada" && !g.rdo_execucao_id) b.push(`<button type="button" class="btn-sec btn-sm acao-perigo" data-geo-acao="ignorar" data-geo="${esc(g.id)}">Ignorar</button>`);
  return b.join(" ");
}
/* ---------- Chegadas por grupo (fase 134a): dia + máquina (sem máquina, a CPU) + obra; agrupa no navegador, sem view ---------- */
const GEO_SIT_GRUPO = { vinculada: "no diário", conciliada: "no diário", pendente_estaca: "a vincular", pendente_obra: "sem obra",
  pendente_maquina: "sem máquina", pendente_rdo_finalizado: "com diário finalizado", pendente_turno: "aguardando o turno", ignorada: "ignorada(s)" };
const geoParaVincular = (g) => !!g.obra_id && !g.estaca_id && ["pendente_estaca", "vinculada", "conciliada"].includes(g.situacao);
const geoParaResolver = (g) => ["pendente_maquina", "pendente_obra", "pendente_rdo_finalizado", "pendente_turno"].includes(g.situacao);
// fase 134b: período da estaca = o do diário em que está (nulo = diurno); sem diário, o decidido à mão, se houver
const geoTurno = (g) => g.rdo ? (g.rdo.turno_campo === "noturno" ? "noturno" : "diurno") : (g.turno_manual || null);
const geoParaPeriodo = (g) => g.situacao !== "ignorada" && (!!g.rdo_execucao_id || g.situacao === "pendente_turno");
function geoTagTurno(turno, extra){
  if(!turno) return "";
  return `<span class="tag ${turno === "noturno" ? "azul" : "cinza"}" title="Período do diário (fase 134b)">${esc(GEO_TURNO_LBL[turno] || turno)}${extra ? " " + esc(extra) : ""}</span>`;
}
const geoDistintos = (lista) => [...new Set(lista.filter(Boolean))];
/* o mesmo dia do resolver: início da perfuração em Brasília; senão a pasta do arquivo */
function geoDia(g){
  return g.perfuracao_inicio ? new Date(g.perfuracao_inicio).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : (g.arquivo?.data_arquivo || "");
}
function geoGrupos(dados){
  const mapa = new Map();
  dados.forEach(g => {
    const dia = geoDia(g), imei = g.arquivo?.imei || "?";
    const chave = dia + "|" + (g.equipamento_id || "cpu:" + imei) + "|" + (g.obra_id || "sem");
    if(!mapa.has(chave)) mapa.set(chave, { chave, dia, maquina: g.equipamento?.codigo || "", imei, obra_id: g.obra_id, obra: g.obra, estacas: [] });
    mapa.get(chave).estacas.push(g);
  });
  const grupos = [...mapa.values()].sort((a, b) => b.dia.localeCompare(a.dia) || (a.maquina || a.imei).localeCompare(b.maquina || b.imei, "pt-BR", { numeric: true }));
  grupos.forEach(gr => gr.estacas.sort((a, b) => String(a.perfuracao_inicio || "").localeCompare(String(b.perfuracao_inicio || "")) || String(a.numero_txt || "").localeCompare(String(b.numero_txt || ""), "pt-BR", { numeric: true })));
  return grupos;
}
/* a obra que a CPU aponta, quando não é a gravada; com mais de uma, a de mais estacas */
function geoSugestaoGrupo(lista){
  const n = new Map();
  lista.forEach(g => {
    if(!g.obra_sugerida_id || g.obra_sugerida_id === g.obra_id) return;
    const s = n.get(g.obra_sugerida_id) || { id: g.obra_sugerida_id, obra: g.obra_sugerida, qtd: 0 };
    s.qtd++; n.set(g.obra_sugerida_id, s);
  });
  return [...n.values()].sort((a, b) => b.qtd - a.qtd)[0] || null;
}
function geoSituacaoGrupo(lista){
  const n = new Map();
  lista.forEach(g => { const r = GEO_SIT_GRUPO[g.situacao] || g.situacao; n.set(r, (n.get(r) || 0) + 1); });
  const cor = lista.some(g => ["pendente_maquina", "pendente_obra"].includes(g.situacao)) ? "vermelho"
    : lista.some(g => GEO_PENDENTES.includes(g.situacao)) ? "ambar"
    : lista.every(g => g.situacao === "ignorada") ? "cinza" : "verde";
  return { texto: [...n.entries()].map(([r, q]) => q + " " + r).join(", "), cor };
}
function geoObraGrupoHTML(gr){
  const sug = geoSugestaoGrupo(gr.estacas);
  const conferir = gr.obra_id && (sug || gr.estacas.some(g => g.obra_regra === "conferencia"));
  const txts = geoDistintos(gr.estacas.map(g => g.obra_txt));
  return `${gr.obra_id ? linkObra(gr.obra_id, gr.obra?.codigo || "obra") : `<span class="tag vermelho">Sem obra</span>`}${gr.estacas.some(g => g.obra_inferida) ? ` <span class="tag cinza" title="Obra vinda da mobilização ou do vínculo da máquina, com o que o operador digitou na CPU compatível">pela máquina</span>` : ""}${conferir ? ` <span class="tag ambar" title="O que a CPU traz não confirma esta obra">conferir obra</span>` : ""}
    ${sug ? `<div class="meta">CPU aponta <strong>${esc(sug.obra?.codigo || "?")}</strong>${sug.obra?.nome ? " — " + esc(sug.obra.nome) : ""}</div>` : ""}
    <div class="meta">CPU: "${esc(txts.length > 1 ? txts.length + " textos" : (txts[0] || "—"))}"</div>`;
}
function geoAcoesGrupoHTML(gr){
  const pode = geoPodeOperar(), b = [];
  const n = gr.estacas.length, vivas = gr.estacas.filter(g => g.situacao !== "ignorada");
  const botao = (acao, rotulo, perigo) => `<button type="button" class="btn-sec btn-sm${perigo ? " acao-perigo" : ""}" data-geo-acao="${esc(acao)}" data-geo-grupo="${esc(gr.chave)}">${esc(rotulo)}</button>`;
  b.push(botao("g-ver", (_geoAbertos.has(gr.chave) ? "Fechar estacas" : "Ver estacas") + " (" + n + ")"));
  if(pode && vivas.length) b.push(botao("g-obra", gr.obra_id ? "Trocar obra" : "Definir obra"));
  const vincular = gr.estacas.filter(geoParaVincular).length;
  if(pode && vincular) b.push(botao("g-estaca", "Vincular estacas (" + vincular + ")"));
  const aConfirmar = gr.estacas.filter(g => g.a_confirmar).length;
  if(pode && aConfirmar) b.push(botao("g-confirmar", "O que foi? (" + aConfirmar + ")"));   // fase 141
  if(gr.estacas.some(g => g.rdo_id)) b.push(botao("g-rdo", "Abrir RDO"));
  if(pode && vivas.some(geoParaPeriodo)) b.push(botao("g-periodo", "Mudar período"));   // fase 134b
  if(pode && gr.estacas.some(geoParaResolver)) b.push(botao("g-resolver", "Resolver de novo"));
  if(pode && vivas.some(g => !g.rdo_execucao_id)) b.push(botao("g-ignorar", "Ignorar", true));
  return b.join(" ");
}
function geoLinhasEstacasHTML(gr){
  return `<div class="tabela-rola"><table>
    <thead><tr><th>Estaca</th><th class="num">Ø (mm)</th><th class="num">Prof. (m)</th><th class="num">Volume (m³)</th><th>Sobreconsumo</th><th>Perfuração</th><th>Concretagem</th><th>Situação</th><th></th></tr></thead>
    <tbody>${gr.estacas.map(g => `<tr data-geo-linha="${esc(g.id)}">
      <td><strong>${esc(g.numero_txt || "—")}</strong>${g.refuro ? ` <span class="tag ambar">Refurada</span>` : ""}${g.profundidade_m != null && Number(g.profundidade_m) < 1 ? ` <span class="tag ambar" title="Profundidade abaixo de 1 m. Nada é ignorado sozinho.">conferir: parece teste</span>` : ""}${g.a_confirmar ? ` <span class="tag ambar" title="${esc(geoRazoesTxt(g))}">a confirmar</span>` : ""}${g.confirmacao ? `<div class="meta" title="${esc(g.confirmacao_obs || "")}">Confirmada: ${esc(geoConfirmacaoLbl(g))}</div>` : ""}${g.estaca?.numero ? `<div class="meta">${esc(g.estaca.numero)}${g.estaca.local ? " · " + esc(g.estaca.local) : ""}</div>` : (g.candidatos?.length > 1 ? `<div class="meta">${esc(g.candidatos.length)} candidatas</div>` : "")}</td>
      <td class="num">${esc(geoNum(g.diametro_mm, 0))}</td>
      <td class="num">${esc(geoNum(g.profundidade_m))}</td>
      <td class="num">${esc(geoNum(g.volume_concreto_m3, 3))}</td>
      <td>${/* html */ geoTagSobre(g.sobreconsumo_pct)}</td>
      <td>${esc(geoHora(g.perfuracao_inicio))}–${esc(geoHora(g.perfuracao_fim))}</td>
      <td>${esc(geoHora(g.concretagem_inicio))}–${esc(geoHora(g.concretagem_fim))}</td>
      <td><span class="tag ${esc(GEO_SITUACAO_COR[g.situacao] || "cinza")}">${esc(GEO_SITUACAO_LBL[g.situacao] || g.situacao)}</span>${g.rdo && g.rdo.turno_campo === "noturno" ? " " + /* html */ geoTagTurno("noturno", g.rdo.data && g.rdo.data !== geoDia(g) ? "de " + dataBR(g.rdo.data) : "") : ""}${g.turno_manual ? ` <span class="meta" title="Período decidido por uma pessoa (Mudar período do grupo)">período manual</span>` : ""}
        ${(g.avisos || []).length ? `<div class="meta" title="${esc((g.avisos || []).join("\n"))}">⚠️ ${esc(g.avisos.length)} aviso(s)</div>` : ""}${g.ignorado_motivo ? `<div class="meta">${esc(g.ignorado_motivo)}</div>` : ""}</td>
      <td class="col-acao">${/* html */ geoAcoesHTML(g)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}
async function geoRenderPainel(){
  const cont = $("rdo-conteudo"); if(!cont) return;
  if(!_geoDados) cont.innerHTML = `<p class="vazio">Carregando chegadas do Geodigitus…</p>`;
  await geoCarregar(false);
  if(typeof _rdoView !== "undefined" && _rdoView !== "geo") return;
  if(_geoIndisponivel){ cont.innerHTML = `<p class="vazio">Chegadas do Geodigitus ainda não disponíveis (a migration da fase 134a não foi aplicada).</p>`; return; }
  const dados = geoFiltradas();
  _geoGrupos = geoGrupos(dados);
  const pend = (_geoDados || []).filter(g => GEO_PENDENTES.includes(g.situacao)).length;
  const c = $("rdo-contador"); if(c) c.textContent = `${_geoGrupos.length} grupo(s) · ${dados.length} de ${_geoDados.length} estaca(s)${pend ? ` · ${pend} pendente(s)` : ""}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhuma estaca do Geodigitus com esses filtros.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Data</th><th>Obra</th><th>Contrato</th><th>Máquina</th><th class="num">Estacas</th><th class="num">Metragem (m)</th><th class="num">Volume (m³)</th><th>Situação</th><th></th></tr></thead>
    <tbody>${_geoGrupos.map(gr => {
      const contratos = geoDistintos(gr.estacas.map(g => g.contrato_txt));
      const avisos = geoDistintos(gr.estacas.flatMap(g => g.avisos || []));
      const teste = gr.estacas.filter(g => g.profundidade_m != null && Number(g.profundidade_m) < 1).length;
      const aConfirmar = gr.estacas.filter(g => g.a_confirmar).length;
      const sit = geoSituacaoGrupo(gr.estacas);
      const soma = (campo) => gr.estacas.reduce((s, g) => s + Number(g[campo] || 0), 0);
      // fase 134b: período dos diários do grupo (o mesmo dia pode ter diurno e noturno)
      const nNot = gr.estacas.filter(g => geoTurno(g) === "noturno").length, nDiu = gr.estacas.filter(g => geoTurno(g) === "diurno").length;
      const periodo = nNot && nDiu ? geoTagTurno("diurno", nDiu) + " " + geoTagTurno("noturno", nNot) : nNot ? geoTagTurno("noturno") : "";
      return `<tr data-geo-grupo-linha="${esc(gr.chave)}">
        <td>${dataBR(gr.dia)}${periodo ? `<div>${/* html */ periodo}</div>` : ""}</td>
        <td>${/* html */ geoObraGrupoHTML(gr)}</td>
        <td>${esc(contratos.length > 1 ? contratos.length + " contratos" : (contratos[0] || "—"))}</td>
        <td>${gr.maquina ? `<strong>${esc(gr.maquina)}</strong>` : `<span class="meta">CPU ${esc(gr.imei)}</span>`}</td>
        <td class="num">${esc(gr.estacas.length)}</td>
        <td class="num">${esc(geoNum(soma("profundidade_m")))}</td>
        <td class="num">${esc(geoNum(soma("volume_concreto_m3"), 3))}</td>
        <td><span class="tag ${esc(sit.cor)}">${esc(sit.texto)}</span>
          ${teste ? `<div><span class="tag ambar" title="Profundidade abaixo de 1 m. Nada é ignorado sozinho.">conferir: parece teste (${esc(teste)})</span></div>` : ""}
          ${aConfirmar ? `<div><span class="tag ambar" title="Arquivo sem o fim da perfuração, número de refuro, menos de 1 m ou o mesmo número no dia">a confirmar (${esc(aConfirmar)})</span></div>` : ""}
          ${avisos.length ? `<div class="meta">⚠️ ${esc(avisos.join(" · "))}</div>` : ""}</td>
        <td class="col-acao">${/* html */ geoAcoesGrupoHTML(gr)}</td>
      </tr>${_geoAbertos.has(gr.chave) ? `<tr data-geo-grupo-aberto="${esc(gr.chave)}"><td colspan="9">${/* html */ geoLinhasEstacasHTML(gr)}</td></tr>` : ""}`;
    }).join("")}</tbody></table></div>`;
}
/* Para regularizar (dashboard.js): Chegadas filtrada pela situação; uma estaca só, com diário, abre o RDO */
async function geoAbrirPreset(filtro, geoId){
  if(typeof _rdoView !== "undefined") _rdoView = "geo";
  document.querySelectorAll("#rdo-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === "geo"));
  if(typeof mostrarPainelRDO === "function" && $("rdo-ficha") && $("rdo-ficha").style.display !== "none") mostrarPainelRDO();
  if($("geo-f-dia")) $("geo-f-dia").value = "";
  if($("geo-f-maq")) $("geo-f-maq").value = "";
  if($("geo-busca")) $("geo-busca").value = "";
  if($("geo-f-sit")) $("geo-f-sit").value = GEO_FILTRO_SIT[filtro] || "pendentes";
  _geoDados = null;
  if(typeof renderRDO === "function") renderRDO();
  if(geoId){
    await geoCarregar(false);
    const g = (_geoDados || []).find(x => x.id === geoId);
    if(filtro === "geodigitus_estaca_a_confirmar"){   // fase 141: uma só abre direto o "O que foi?"
      await geoRenderPainel();
      const gr = (_geoGrupos || []).find(x => x.estacas.some(e => e.id === geoId));
      if(gr && geoPodeOperar()) geoAbrirModalGrupo("g-confirmar", gr);
    } else if(g?.rdo_id && g.situacao === "pendente_rdo_finalizado" && typeof abrirRDO === "function") abrirRDO(g.rdo_id);
  }
}

/* ---------- ações do grupo (fase 134a) ---------- */
async function geoAcaoGrupo(acao, chave){
  const gr = (_geoGrupos || []).find(x => x.chave === chave); if(!gr) return;
  if(acao === "g-ver"){
    if(_geoAbertos.has(chave)) _geoAbertos.delete(chave); else _geoAbertos.add(chave);
    return geoRenderPainel();
  }
  if(acao === "g-rdo"){
    const rdo = gr.estacas.find(g => g.rdo_id)?.rdo_id;
    if(rdo && typeof abrirRDO === "function") abrirRDO(rdo);
    return;
  }
  if(acao === "g-resolver"){
    let n = 0, erros = 0, ultimoErro = "";
    for(const g of gr.estacas.filter(g => geoParaResolver(g) && g.situacao !== "pendente_turno")){
      const { data, error } = await sb.rpc("geodigitus_estaca_resolver", { p_geo: g.id, p_origem: "geodigitus_manual" });
      if(error){ erros++; ultimoErro = error.message; }
      else if(data?.situacao !== g.situacao) n++;
    }
    // fase 134b: quem aguarda a noite passa pela reavaliação (noite encerrada e curta vai para o diurno; aberta continua)
    const turnos = gr.estacas.filter(g => g.situacao === "pendente_turno").map(g => g.id);
    let aguardando = 0;
    if(turnos.length){
      const { data, error } = await sb.rpc("geodigitus_turnos_reavaliar", { p_origem: "geodigitus_manual", p_geos: turnos });
      if(error){ erros++; ultimoErro = error.message; }
      else { n += Number(data?.decididas || 0); aguardando = Number(data?.aguardando || 0); if(data?.erros){ erros += Number(data.erros); ultimoErro = data.ultimo_erro || ultimoErro; } }
    }
    aviso("app-aviso", `${n} estaca(s) mudaram de situação${aguardando ? ` · ${aguardando} seguem aguardando a noite fechar (use Mudar período para decidir já)` : ""}${erros ? ` · ${erros} com erro: ${ultimoErro}` : ""}.`, erros ? "erro" : (n ? "ok" : "aviso"));
    _geoDados = null; return geoRenderPainel();
  }
  return geoAbrirModalGrupo(acao, gr);
}
async function geoAbrirModalGrupo(acao, gr){
  const vivas = gr.estacas.filter(g => g.situacao !== "ignorada");
  const rotulo = dataBR(gr.dia) + " · " + (gr.maquina || "CPU " + gr.imei);
  const corpo = $("geo-modal-corpo");
  corpo.innerHTML = `<p class="vazio">Carregando…</p>`;
  $("geo-modal").style.display = "";
  if(acao === "g-obra"){
    _geoModal = { tipo: "grupo_obra", grupo: gr, geos: vivas.map(g => g.id), impedido: false, comExecucao: false };
    $("geo-modal-titulo").textContent = (gr.obra_id ? "Trocar obra" : "Definir obra") + " · " + vivas.length + " estaca(s)";
    const { data } = await sb.from("obras").select("id,codigo,nome,status").in("status", ["em_andamento", "planejada", "paralisada"]).order("codigo");
    const sug = geoSugestaoGrupo(vivas);
    const txts = geoDistintos(vivas.map(g => g.obra_txt)), contratos = geoDistintos(vivas.map(g => g.contrato_txt));
    corpo.innerHTML = `<p class="meta">${esc(rotulo)}. Na CPU: obra <strong>"${esc(txts.join(" / ") || "—")}"</strong>, contrato <strong>"${esc(contratos.join(" / ") || "—")}"</strong>.${gr.obra_id ? ` Obra atual: <strong>${esc(gr.obra?.codigo || "?")}</strong>.` : ""}</p>
      <div class="grade"><div class="campo largo"><label>Obra</label><select id="geo-modal-obra"><option value="">Escolha a obra</option>${(data || []).map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("")}</select></div>
      <div class="campo largo" id="geo-modal-previa"></div>
      <div class="campo largo" id="geo-modal-motivo-campo" style="display:none;"><label>Motivo da troca</label><input id="geo-modal-motivo" placeholder="Ex.: a CPU traz o contrato de outra obra" /></div>
      ${txts.length ? `<div class="campo largo"><label class="check-inline"><input type="checkbox" id="geo-modal-depara" /> Salvar de-para: as próximas estacas com este texto vão direto para esta obra (as paradas também)</label></div>` : ""}</div>`;
    const sel = $("geo-modal-obra");
    sel.addEventListener("change", geoPreviaTroca);
    if(sug && (data || []).some(o => o.id === sug.id)){ sel.value = sug.id; geoPreviaTroca(); }
    return;
  }
  if(acao === "g-estaca"){
    const lista = gr.estacas.filter(geoParaVincular);
    _geoModal = { tipo: "grupo_estaca", grupo: gr };
    $("geo-modal-titulo").textContent = "Vincular estacas · " + lista.length;
    const { data, error } = await sb.rpc("geodigitus_sugerir_estacas", { p_geos: lista.map(g => g.id) });
    if(error){ corpo.innerHTML = `<p class="vazio">Não foi possível sugerir: ${esc(error.message)}</p>`; return; }
    corpo.innerHTML = `<p class="meta">${esc(rotulo)}. Só vem escolhida a candidata única sem execução; o resto fica para você decidir. Só as linhas escolhidas são gravadas.</p>
      <div class="tabela-rola"><table><thead><tr><th>Estaca na CPU</th><th>Estaca da obra</th></tr></thead><tbody>${(data || []).map(s => {
        const cands = s.candidatas || [];
        const executadas = cands.filter(k => k.ultima_execucao);
        return `<tr><td><strong>${esc(s.numero || "—")}</strong>${s.refuro ? ` <span class="tag ambar">Refurada</span>` : ""}</td>
          <td><select data-geo-lote="${esc(s.geo)}"><option value="">${cands.length ? "Não vincular agora" : "Nenhuma candidata"}</option>${cands.map(k => `<option value="${esc(k.estaca_id)}"${k.estaca_id === s.pre ? " selected" : ""}>${esc(k.numero)}${k.local ? " · " + esc(k.local) : ""}${k.pelo_prefixo ? " · pelo prefixo" : ""}${k.ultima_execucao ? " · executada em " + esc(dataBR(k.ultima_execucao)) : ""}</option>`).join("")}</select>
          ${executadas.length ? `<div class="meta">⚠️ Já executada em ${esc(executadas.map(k => dataBR(k.ultima_execucao)).join(", "))}: confira antes de vincular.</div>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>`;
    return;
  }
  if(acao === "g-confirmar"){
    // fase 141: "O que foi?". Tudo ou nada; teste e duplicada desfazem a execução da chegada, com prévia antes
    const lista = gr.estacas.filter(g => g.a_confirmar);
    _geoModal = { tipo: "grupo_confirmar", grupo: gr, geos: lista.map(g => g.id), impedido: false };
    $("geo-modal-titulo").textContent = "O que foi? · " + lista.length + " estaca(s)";
    corpo.innerHTML = `<p class="meta">${esc(rotulo)}. Marque as estacas que tiveram o mesmo motivo; as outras continuam a confirmar.</p>
      <div class="grade">
        <div class="campo largo">${lista.map(g => `<label class="check-inline"><input type="checkbox" data-geo-conf="${esc(g.id)}" checked /> <strong>${esc(g.numero_txt || "—")}</strong> <span class="meta">${esc(geoNum(g.profundidade_m))} m · ${esc(geoRazoesTxt(g))}</span></label>`).join("")}</div>
        <div class="campo largo"><label id="geo-conf-lbl">O que foi?</label><div id="geo-conf-chips" aria-labelledby="geo-conf-lbl"></div></div>
        <div class="campo largo" id="geo-conf-motivo-campo" style="display:none;"><label id="geo-conf-motivo-lbl">Motivo do refuro</label><div id="geo-conf-motivo" aria-labelledby="geo-conf-motivo-lbl"></div></div>
        <div class="campo largo"><label>Observação</label><input id="geo-conf-obs" placeholder="Com a opção Outro, escreva o que houve" /></div>
        <div class="campo largo" id="geo-modal-previa"></div>
      </div>`;
    const m = _geoModal;
    m.chipMotivo = chipsMotivo($("geo-conf-motivo"), MOTIVOS_REFURADA, null, geoPreviaConfirmar);
    m.chipConf = chipsMotivo($("geo-conf-chips"), GEO_CONFIRMACOES, null, (v) => {
      $("geo-conf-motivo-campo").style.display = v === "refuro" ? "" : "none";
      geoPreviaConfirmar();
    });
    corpo.querySelectorAll("[data-geo-conf]").forEach(c => c.addEventListener("change", geoPreviaConfirmar));
    return;
  }
  if(acao === "g-periodo"){
    // fase 134b: Mudar período do grupo. Mesmas travas da troca de obra; a data de cada estaca segue a regra do período
    // (noturno: início antes do fim da noite pertence ao dia anterior; diurno: a data do próprio início).
    const lista = vivas.filter(geoParaPeriodo);
    const nNot = lista.filter(g => geoTurno(g) === "noturno").length, nDiu = lista.filter(g => geoTurno(g) === "diurno").length, nAg = lista.filter(g => g.situacao === "pendente_turno").length;
    const sugerido = nNot > nDiu ? "diurno" : "noturno";
    _geoModal = { tipo: "grupo_periodo", grupo: gr, geos: lista.map(g => g.id), impedido: false, comExecucao: false };
    $("geo-modal-titulo").textContent = "Mudar período · " + lista.length + " estaca(s)";
    corpo.innerHTML = `<p class="meta">${esc(rotulo)}. Hoje: ${nDiu ? `<strong>${esc(nDiu)}</strong> no diurno` : ""}${nDiu && nNot ? ", " : ""}${nNot ? `<strong>${esc(nNot)}</strong> no noturno` : ""}${(nDiu || nNot) && nAg ? ", " : ""}${nAg ? `<strong>${esc(nAg)}</strong> aguardando a noite` : ""}.
        A regra da sync chama de noturno a noite que passa de ${esc(window._geoNoturnoMinH ?? 2)} h a partir das ${esc(window._geoNoturnoIni || "18:00")}; hora extra da mesma equipe se corrige aqui.</p>
      <div class="grade"><div class="campo largo"><label>Período</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;">
          <label class="check-inline"><input type="radio" name="geo-modal-turno" value="diurno"${sugerido === "diurno" ? " checked" : ""} /> Diurno (data do início de cada estaca)</label>
          <label class="check-inline"><input type="radio" name="geo-modal-turno" value="noturno"${sugerido === "noturno" ? " checked" : ""} /> Noturno (noite do dia em que começou)</label>
        </div></div>
      <div class="campo largo" id="geo-modal-previa"></div>
      <div class="campo largo" id="geo-modal-motivo-campo" style="display:none;"><label>Motivo</label><input id="geo-modal-motivo" placeholder="Ex.: hora extra da mesma equipe, não segundo turno" /></div></div>`;
    corpo.querySelectorAll('input[name="geo-modal-turno"]').forEach(r => r.addEventListener("change", geoPreviaPeriodo));
    geoPreviaPeriodo();
    return;
  }
  if(acao === "g-ignorar"){
    const sem = vivas.filter(g => !g.rdo_execucao_id), noDiario = vivas.length - sem.length;
    _geoModal = { tipo: "grupo_ignorar", grupo: gr, geos: sem.map(g => g.id) };
    $("geo-modal-titulo").textContent = "Ignorar · " + sem.length + " estaca(s)";
    corpo.innerHTML = `<p class="meta">${esc(rotulo)}. <strong>${esc(sem.length)}</strong> estaca(s) não entram em diário: ${esc(sem.map(g => g.numero_txt || "?").join(", "))}.${noDiario ? ` ${esc(noDiario)} já no diário não mudam.` : ""}</p>
      <div class="grade"><div class="campo largo"><label>Motivo</label><input id="geo-modal-motivo" placeholder="Ex.: marcador de início e fim, estaca de teste" /></div></div>`;
  }
}
/* prévia da troca: não grava; refeita a cada obra escolhida */
async function geoPreviaTroca(){
  const m = _geoModal, alvo = $("geo-modal-previa"), obra = $("geo-modal-obra")?.value;
  if(!m || !alvo) return;
  m.impedido = false; m.comExecucao = false;
  $("geo-modal-motivo-campo").style.display = "none";
  if(!obra){ alvo.innerHTML = ""; return; }
  alvo.innerHTML = `<p class="meta">Conferindo…</p>`;
  const { data, error } = await sb.rpc("geodigitus_troca_previa", { p_geos: m.geos, p_obra: obra });
  if(_geoModal !== m || $("geo-modal-obra")?.value !== obra) return;
  if(error){ m.impedido = true; alvo.innerHTML = `<p class="vazio">Não foi possível conferir: ${esc(error.message)}</p>`; return; }
  const vazios = data.diarios_vazios || [], imp = data.impedimentos || [];
  m.impedido = imp.length > 0; m.comExecucao = Number(data.execucoes) > 0;
  $("geo-modal-motivo-campo").style.display = m.comExecucao ? "" : "none";
  alvo.innerHTML = `<p class="meta"><strong>${esc(data.estacas)}</strong> estaca(s) · <strong>${esc(data.execucoes)}</strong> execução(ões) mudam de diário · ${esc(data.diarios_origem)} diário(s) de origem${data.ja_na_obra ? ` · ${esc(data.ja_na_obra)} já nesta obra` : ""}.
      ${vazios.length ? `Ficam vazios e saem: ${esc(vazios.map(d => dataBR(d.data) + " (" + d.obra + ")").join(", "))}.` : "Nenhum diário sai."}</p>
    ${imp.length ? `<p class="meta"><span class="tag vermelho">Nada será gravado</span> enquanto houver impedimento:</p><ul class="meta">${imp.map(i => `<li><strong>${esc(i.numero || "?")}</strong>: ${esc(i.motivo)}</li>`).join("")}</ul>` : ""}`;
}
/* fase 134b: prévia de Mudar período: não grava; refeita a cada período escolhido */
const geoTurnoEscolhido = () => document.querySelector('#geo-modal-corpo input[name="geo-modal-turno"]:checked')?.value || "";
async function geoPreviaPeriodo(){
  const m = _geoModal, alvo = $("geo-modal-previa"), turno = geoTurnoEscolhido();
  if(!m || !alvo) return;
  m.impedido = false; m.comExecucao = false;
  $("geo-modal-motivo-campo").style.display = "none";
  if(!turno){ alvo.innerHTML = ""; return; }
  alvo.innerHTML = `<p class="meta">Conferindo…</p>`;
  const { data, error } = await sb.rpc("geodigitus_periodo_previa", { p_geos: m.geos, p_turno: turno });
  if(_geoModal !== m || geoTurnoEscolhido() !== turno) return;
  if(error){ m.impedido = true; alvo.innerHTML = `<p class="vazio">Não foi possível conferir: ${esc(error.message)}</p>`; return; }
  const vazios = data.diarios_vazios || [], imp = data.impedimentos || [], destinos = data.destinos || [];
  m.impedido = imp.length > 0; m.comExecucao = Number(data.execucoes) > 0;
  $("geo-modal-motivo-campo").style.display = m.comExecucao ? "" : "none";
  alvo.innerHTML = `<p class="meta"><strong>${esc(data.execucoes)}</strong> execução(ões) mudam para o diário ${esc(String(GEO_TURNO_LBL[turno] || turno).toLowerCase())}${destinos.length ? ` de ${esc(destinos.map(d => dataBR(d)).join(", "))}` : ""} · ${esc(data.diarios_origem)} diário(s) de origem${data.ja_no_periodo ? ` · ${esc(data.ja_no_periodo)} já nesse período` : ""}${data.sem_execucao ? ` · ${esc(data.sem_execucao)} sem diário recebem o período e entram agora` : ""}.
      ${vazios.length ? `Ficam vazios e saem: ${esc(vazios.map(d => dataBR(d.data) + " " + (GEO_TURNO_LBL[d.turno] || d.turno).toLowerCase() + " (" + d.obra + ")").join(", "))}.` : "Nenhum diário sai."}</p>
    ${imp.length ? `<p class="meta"><span class="tag vermelho">Nada será gravado</span> enquanto houver impedimento:</p><ul class="meta">${imp.map(i => `<li><strong>${esc(i.numero || "?")}</strong>: ${esc(i.motivo)}</li>`).join("")}</ul>` : ""}`;
}
/* fase 141: prévia do "O que foi?": não grava; refeita a cada escolha */
const geoConfMarcadas = () => [...document.querySelectorAll("#geo-modal-corpo [data-geo-conf]:checked")].map(c => c.dataset.geoConf);
async function geoPreviaConfirmar(){
  const m = _geoModal, alvo = $("geo-modal-previa");
  if(!m || !alvo) return;
  const conf = m.chipConf?.valor, geos = geoConfMarcadas(), chave = conf + "|" + geos.join(",");
  m.impedido = false; m.chavePrevia = chave;
  if(!conf || !geos.length){ alvo.innerHTML = ""; return; }
  alvo.innerHTML = `<p class="meta">Conferindo…</p>`;
  const { data, error } = await sb.rpc("geodigitus_confirmar_previa", { p_geos: geos, p_confirmacao: conf, p_motivo: m.chipMotivo?.valor || null });
  if(_geoModal !== m || m.chavePrevia !== chave) return;
  if(error){ m.impedido = true; alvo.innerHTML = `<p class="vazio">Não foi possível conferir: ${esc(error.message)}</p>`; return; }
  const imp = data.impedimentos || [], vazios = data.diarios_vazios || [];
  m.impedido = imp.length > 0;
  const partes = [`<strong>${esc(data.estacas)}</strong> estaca(s)`];
  if(["teste", "duplicada"].includes(conf)) partes.push(`saem da conta: <strong>${esc(data.execucoes_apagar)}</strong> execução(ões) apagada(s)`, vazios.length ? `ficam vazios e saem: ${esc(vazios.map(d => dataBR(d.data) + " (" + d.obra + ")").join(", "))}` : "nenhum diário sai");
  if(conf === "refuro") partes.push(`motivo gravado em <strong>${esc(data.execucoes_motivo)}</strong> execução(ões)`);
  if(conf === "ok_arquivo" || conf === "outro") partes.push("só fica registrado; o diário não muda");
  alvo.innerHTML = `<p class="meta">${/* html */ partes.join(" · ")}.</p>
    ${Number(data.refuro_sem_modalidade) ? `<p class="meta">⚠️ ${esc(data.refuro_sem_modalidade)} execução(ões) seguem como furo normal no diário; a modalidade não muda por aqui.</p>` : ""}
    ${imp.length ? `<p class="meta"><span class="tag vermelho">Nada será gravado</span> enquanto houver impedimento:</p><ul class="meta">${imp.map(i => `<li><strong>${esc(i.numero || "?")}</strong>: ${esc(i.motivo)}</li>`).join("")}</ul>` : ""}`;
}
async function geoConfirmarGrupo(){
  const m = _geoModal;
  let r, msg;
  if(m.tipo === "grupo_confirmar"){
    const conf = m.chipConf?.valor, motivo = m.chipMotivo?.valor || null, obs = ($("geo-conf-obs")?.value || "").trim(), geos = geoConfMarcadas();
    if(!geos.length){ aviso("app-aviso", "Marque ao menos uma estaca.", "erro"); return; }
    if(!conf){ aviso("app-aviso", "Escolha o que foi.", "erro"); return; }
    if(conf === "refuro" && !motivo){ aviso("app-aviso", "Escolha o motivo do refuro.", "erro"); return; }
    if((conf === "outro" || (conf === "refuro" && motivo === "outro")) && obs.length < 5){ aviso("app-aviso", "Com a opção Outro, escreva o que houve (ao menos 5 caracteres).", "erro"); return; }
    if(m.impedido){ aviso("app-aviso", "Há impedimentos na prévia: nada foi gravado.", "erro"); return; }
    r = await sb.rpc("geodigitus_confirmar", { p_geos: geos, p_confirmacao: conf, p_motivo: conf === "refuro" ? motivo : null, p_obs: obs || null });
    const d = r.data || {};
    msg = `${d.confirmadas || 0} estaca(s) confirmada(s)${d.execucoes_apagadas ? ` · ${d.execucoes_apagadas} execução(ões) saíram da conta` : ""}${d.motivos_gravados ? ` · motivo em ${d.motivos_gravados} execução(ões)` : ""}${d.diarios_removidos ? ` · ${d.diarios_removidos} diário(s) vazio(s) removido(s)` : ""}.`;
    if(!r.error && d.sugerir_retirada?.length && typeof aceSugerirRetirada === "function") setTimeout(() => aceSugerirRetirada(d.sugerir_retirada), 0);
  } else if(m.tipo === "grupo_periodo"){
    const turno = geoTurnoEscolhido();
    if(!turno){ aviso("app-aviso", "Escolha o período.", "erro"); return; }
    if(m.impedido){ aviso("app-aviso", "Há impedimentos na prévia: nada foi gravado.", "erro"); return; }
    const motivo = ($("geo-modal-motivo")?.value || "").trim();
    if(m.comExecucao && motivo.length < 5){ aviso("app-aviso", "Informe o motivo da mudança de período (ao menos 5 caracteres).", "erro"); return; }
    r = await sb.rpc("geodigitus_definir_periodo_grupo", { p_geos: m.geos, p_turno: turno, p_motivo: motivo || null });
    const d = r.data || {};
    msg = `${d.movidas || 0} execução(ões) mudaram para o ${(GEO_TURNO_LBL[turno] || turno).toLowerCase()} · ${d.definidas || 0} estaca(s) sem diário receberam o período${d.diarios_removidos ? ` · ${d.diarios_removidos} diário(s) vazio(s) removido(s)` : ""}.`;
  } else if(m.tipo === "grupo_obra"){
    const obra = $("geo-modal-obra")?.value;
    if(!obra){ aviso("app-aviso", "Escolha a obra.", "erro"); return; }
    if(m.impedido){ aviso("app-aviso", "Há impedimentos na prévia: nada foi gravado.", "erro"); return; }
    const motivo = ($("geo-modal-motivo")?.value || "").trim();
    if(m.comExecucao && motivo.length < 5){ aviso("app-aviso", "Informe o motivo da troca (ao menos 5 caracteres).", "erro"); return; }
    r = await sb.rpc("geodigitus_definir_obra_grupo", { p_geos: m.geos, p_obra: obra, p_motivo: motivo || null, p_salvar_depara: !!$("geo-modal-depara")?.checked });
    const d = r.data || {};
    msg = `${d.movidas || 0} estaca(s) trocadas de obra · ${d.definidas || 0} definidas${d.diarios_removidos ? ` · ${d.diarios_removidos} diário(s) vazio(s) removido(s)` : ""}${d.outras_resolvidas ? ` · ${d.outras_resolvidas} outra(s) seguiram o de-para` : ""}.`;
  } else if(m.tipo === "grupo_estaca"){
    const pares = [...document.querySelectorAll("#geo-modal-corpo [data-geo-lote]")].filter(s => s.value).map(s => ({ geo: s.dataset.geoLote, estaca: s.value }));
    if(!pares.length){ aviso("app-aviso", "Escolha ao menos uma estaca.", "erro"); return; }
    r = await sb.rpc("geodigitus_vincular_lote", { p_pares: pares });
    msg = `${r.data?.vinculadas || 0} estaca(s) vinculada(s).`;
  } else {
    r = await sb.rpc("geodigitus_ignorar_grupo", { p_geos: m.geos, p_motivo: $("geo-modal-motivo")?.value || "" });
    msg = `${r.data?.ignoradas || 0} estaca(s) ignorada(s).`;
  }
  if(r.error){ aviso("app-aviso", "Não foi possível gravar: " + r.error.message, "erro"); return; }
  aviso("app-aviso", msg, "ok");
  geoFecharModal();
  _geoDados = null; geoRenderPainel();
}

/* ---------- ações ---------- */
async function geoAcao(acao, id){
  const g = (_geoDados || []).find(x => x.id === id); if(!g) return;
  if(acao === "perfil"){ if(typeof abrirPerfilEstaca === "function") await abrirPerfilEstaca(id); return; }   // fase 162: só lê, não recarrega as chegadas
  if(acao === "rdo"){ if(g.rdo_id && typeof abrirRDO === "function") abrirRDO(g.rdo_id); return; }
  if(acao === "cpu"){ if(typeof cpbAbrir === "function") cpbAbrir(g.computador_id); return; }
  if(acao === "obra") return geoAbrirModal("obra", g);
  if(acao === "estaca") return geoAbrirModal("estaca", g);
  if(acao === "resolver" && g.situacao === "pendente_turno"){
    // fase 134b: a estaca que aguarda a noite passa pela reavaliação (decide se a noite fechou)
    const { data, error } = await sb.rpc("geodigitus_turnos_reavaliar", { p_origem: "geodigitus_manual", p_geos: [id] });
    if(error){ aviso("app-aviso", "Não foi possível reavaliar: " + error.message, "erro"); return; }
    aviso("app-aviso", data?.decididas ? "Período decidido: a estaca entrou no diário." : "A noite ainda não fechou: a estaca continua aguardando. Use Mudar período no grupo para decidir já.", data?.decididas ? "ok" : "aviso");
  } else if(acao === "resolver"){
    const { data, error } = await sb.rpc("geodigitus_estaca_resolver", { p_geo: id, p_origem: "geodigitus_manual" });
    if(error){ aviso("app-aviso", "Não foi possível resolver: " + error.message, "erro"); return; }
    aviso("app-aviso", `Situação: ${GEO_SITUACAO_LBL[data?.situacao] || data?.situacao || "—"}${data?.rdo_criado ? " (diário criado em rascunho)" : ""}${data?.turno === "noturno" ? " · diário noturno" : ""}.`, GEO_PENDENTES.includes(data?.situacao) || data?.situacao === "pendente_turno" ? "aviso" : "ok");
  }
  if(acao === "ignorar"){
    const motivo = prompt(`Ignorar a estaca "${g.numero_txt || "?"}" do Geodigitus (ela não entra em diário). Motivo (ex.: estaca de teste, furo abortado):`);
    if(motivo == null) return;
    const { error } = await sb.rpc("geodigitus_ignorar", { p_geo: id, p_motivo: motivo });
    if(error){ aviso("app-aviso", "Não foi possível ignorar: " + error.message, "erro"); return; }
    aviso("app-aviso", "Estaca ignorada.", "ok");
  }
  _geoDados = null; geoRenderPainel();
}
async function geoAbrirModal(tipo, g){
  _geoModal = { tipo, geo: g };
  $("geo-modal-titulo").textContent = tipo === "obra" ? `Definir obra · estaca ${g.numero_txt || "?"}` : `Vincular estaca · ${g.numero_txt || "?"}`;
  const corpo = $("geo-modal-corpo");
  corpo.innerHTML = `<p class="vazio">Carregando…</p>`;
  $("geo-modal").style.display = "";
  if(tipo === "obra"){
    const { data } = await sb.from("obras").select("id,codigo,nome,status").in("status", ["em_andamento", "planejada", "paralisada"]).order("codigo");
    corpo.innerHTML = `<p class="meta">Na CPU o operador digitou a obra <strong>"${esc(g.obra_txt || "—")}"</strong>${g.contrato_txt ? ` e o contrato <strong>"${esc(g.contrato_txt)}"</strong>` : ""}. Máquina: ${esc(g.equipamento?.codigo || "—")}.</p>
      <div class="grade"><div class="campo largo"><label>Obra</label><select id="geo-modal-obra"><option value="">Escolha a obra</option>${(data || []).map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("")}</select></div>
      <div class="campo largo"><label class="check-inline"><input type="checkbox" id="geo-modal-depara" checked /> Salvar de-para: as próximas estacas com "${esc(g.obra_txt || "")}"${g.contrato_txt ? ` / "${esc(g.contrato_txt)}"` : ""} vão direto para esta obra (as paradas também)</label></div></div>`;
  } else {
    const obra = g.obra_id;
    if(!obra){ corpo.innerHTML = `<p class="vazio">Defina a obra antes de vincular a estaca.</p>`; return; }
    const { data } = await lerTudo(() => sb.from("estacas").select("id,numero,local,bloco,status,diametro_mm").eq("obra_id", obra).order("numero"));
    const cands = new Set(g.candidatos || []);
    const lista = (data || []).sort((a, b) => (cands.has(b.id) - cands.has(a.id)) || String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true }));
    corpo.innerHTML = `<p class="meta">Número no computador de bordo: <strong>${esc(g.numero_txt || "—")}</strong>${g.refuro ? " (Refurada: vincule à estaca original)" : ""}. ${cands.size > 1 ? `${esc(cands.size)} estacas com esse número em locais diferentes da obra: escolha o local certo.` : ""}</p>
      <div class="grade"><div class="campo largo"><label>Estaca cadastrada na obra</label><select id="geo-modal-estaca"><option value="">Escolha a estaca</option>${lista.map(e => `<option value="${esc(e.id)}">${cands.has(e.id) ? "★ " : ""}${esc(e.numero)}${e.local ? " · " + esc(e.local) : ""}${e.bloco ? " · bloco " + esc(e.bloco) : ""}${e.diametro_mm ? " · Ø " + esc(e.diametro_mm) : ""}</option>`).join("")}</select></div></div>`;
  }
}
function geoFecharModal(){ $("geo-modal").style.display = "none"; _geoModal = null; }
async function geoConfirmarModal(){
  if(!_geoModal || !geoPodeOperar()) return;
  if(_geoModal.tipo.startsWith("grupo_")) return geoConfirmarGrupo();
  const g = _geoModal.geo;
  let r;
  if(_geoModal.tipo === "obra"){
    const obra = $("geo-modal-obra")?.value;
    if(!obra){ aviso("app-aviso", "Escolha a obra.", "erro"); return; }
    r = await sb.rpc("geodigitus_definir_obra", { p_geo: g.id, p_obra: obra, p_salvar_depara: !!$("geo-modal-depara")?.checked });
  } else {
    const est = $("geo-modal-estaca")?.value;
    if(!est){ aviso("app-aviso", "Escolha a estaca.", "erro"); return; }
    r = await sb.rpc("geodigitus_vincular_estaca", { p_geo: g.id, p_estaca: est });
  }
  if(r.error){ aviso("app-aviso", "Não foi possível gravar: " + r.error.message, "erro"); return; }
  const d = r.data || {};
  aviso("app-aviso", `Situação: ${GEO_SITUACAO_LBL[d.situacao] || d.situacao || "—"}${d.rdo_criado ? " · diário criado em rascunho" : ""}${d.outras_resolvidas ? ` · ${d.outras_resolvidas} outra(s) estaca(s) seguiram o de-para` : ""}.`, "ok");
  geoFecharModal();
  _geoDados = null; geoRenderPainel();
}
async function geoSincronizarTudo(){
  if(!geoPodeOperar()) return;
  const { data, error } = await sb.functions.invoke("geodigitus-sync", { body: { acao: "sincronizar" } });
  if(error){
    let msg = error.message;
    try { const j = await error.context?.json?.(); if(j?.error) msg = j.error; } catch(_){ /* corpo não é JSON */ }
    aviso("app-aviso", "Sincronização: " + msg, "erro"); return;
  }
  aviso("app-aviso", `Sincronização: ${data?.cpus || 0} CPU(s), ${data?.arquivos_novos || 0} arquivo(s) novo(s), ${data?.estacas_novas || 0} estaca(s), ${data?.erros || 0} erro(s)${data?.teto_atingido ? " — teto da rodada atingido" : ""}.`, data?.erros ? "aviso" : "ok");
  _geoDados = null; geoRenderPainel();
}

/* ---------- na execução do RDO: badge Geodigitus e sobreconsumo ---------- */
async function geoCarregarExecs(execs){
  _geoExecs = {};
  const ids = (execs || []).map(e => e.id).filter(Boolean);
  if(!ids.length) return false;
  const { data, error } = await sb.from("geodigitus_estacas").select("id,rdo_execucao_id,sobreconsumo_pct,situacao,arquivo:geodigitus_arquivos(imei)").in("rdo_execucao_id", ids);
  if(error) return false;
  (data || []).forEach(g => { _geoExecs[g.rdo_execucao_id] = g; });
  return (data || []).length > 0;
}
function geoBadgeExec(e){
  const g = e && e.id ? _geoExecs[e.id] : null;
  if(!g && e?.origem_dados !== "geodigitus_s3") return "";
  const titulo = g ? `Do computador de bordo (CPU ${g.arquivo?.imei || "?"})${g.situacao === "conciliada" ? ": conciliada com o que já estava digitado" : ""}` : "Do computador de bordo (Geodigitus)";
  // fase 162: com a chegada lida (geoCarregarExecs), o selo abre o perfil da estaca (clique ligado em js/estaca_perfil.js)
  const selo = g?.id
    ? `<button type="button" class="tag azul epf-selo" data-epf-perfil="${esc(g.id)}" title="${esc(titulo)}. Clique para ver o perfil e o replay da estaca.">Geodigitus</button>`
    : `<span class="tag azul" title="${esc(titulo)}">Geodigitus</span>`;
  return `<span data-geo-badge="1"> ${/* html */ selo}${g ? geoTagSobre(g.sobreconsumo_pct) : ""}</span>`;
}
/* depois da consulta, só acrescenta os badges na grade já desenhada (não redesenha: não perde o que o usuário digitou) */
function geoAplicarBadgesExec(execs){
  (execs || []).forEach((e, idx) => {
    const td = document.querySelector(`#rdo-execs tr[data-idx="${idx}"] td`);
    if(!td) return;
    td.querySelectorAll("[data-geo-badge]").forEach(x => x.remove());
    td.insertAdjacentHTML("beforeend", geoBadgeExec(e));
  });
}

/* ---------- Sala de Comando: card Geodigitus ---------- */
function geoPodeVerCard(){
  return !!usuarioAtual && ["diretor", "admin", "auditor", "engenheiro", "assistente_engenharia", "encarregado", "gestor_frota", "gestor_manutencao"].includes(usuarioAtual.cargo);
}
async function geoCarregarCardSala(){
  const card = $("dash-geo-card"), cont = $("dash-geo");
  if(!card || !cont) return;
  const hoje = hojeISO(), mes = hoje.slice(0, 8) + "01";
  const [cfg, rod, est, pend, cpus] = await Promise.all([
    sb.from("empresa_config").select("geodigitus_sync_ativo,geodigitus_cota_mb_mes,geodigitus_sobreconsumo_alerta_pct,campo_inicio_turno_noturno,campo_turno_noturno_min_h").eq("id", 1).maybeSingle(),
    sb.from("geodigitus_sync_execucoes").select("iniciado_em,origem,bytes,erros").gte("iniciado_em", mes + "T00:00:00-03:00").order("iniciado_em", { ascending: false }).limit(5000),
    sb.from("geodigitus_estacas").select("id,arquivo:geodigitus_arquivos!inner(data_arquivo)", { count: "exact", head: true }).eq("arquivo.data_arquivo", hoje),
    sb.from("geodigitus_estacas").select("id", { count: "exact", head: true }).in("situacao", GEO_PENDENTES),
    sb.from("vw_computadores_bordo").select("status,sync_estado,calibracao_situacao").eq("status", "ativo")
  ]);
  if(cfg.error || rod.error){
    if(geoIndisp(cfg.error) || geoIndisp(rod.error)){ card.style.display = "none"; return; }
    cont.innerHTML = `<p class="vazio">Não foi possível carregar (${esc((cfg.error || rod.error).message || "erro")}).</p>`; card.style.display = ""; return;
  }
  card.style.display = "";
  const c = cfg.data || {};
  window._geoAlertaPct = Number(c.geodigitus_sobreconsumo_alerta_pct ?? 15);
  window._geoNoturnoIni = String(c.campo_inicio_turno_noturno || "18:00").slice(0, 5);   // fase 134b: texto do modal Mudar período
  window._geoNoturnoMinH = Number(c.campo_turno_noturno_min_h ?? 2);
  const rodadas = rod.data || [];
  const mb = rodadas.reduce((s, r) => s + Number(r.bytes || 0), 0) / 1048576;
  const ultima = rodadas[0];
  const cs = cpus.data || [];
  const falha = cs.filter(x => ["falha", "configurando_acesso"].includes(x.sync_estado)).length;
  const calib = cs.filter(x => ["vencida", "sem_certificado"].includes(x.calibracao_situacao)).length;
  const cota = Number(c.geodigitus_cota_mb_mes || 0);
  const item = (rot, valor, sub, alvo, cor) => `<div class="dash-card${alvo ? " clicavel" : ""}"${alvo ? ` data-geo-card="${esc(alvo)}"` : ""}>
      <div class="dash-card-rot">${esc(rot)}</div><div class="dash-card-num">${cor ? `<span class="tag ${esc(cor)}">${esc(valor)}</span>` : esc(valor)}</div><div class="dash-card-sub">${esc(sub)}</div></div>`;
  cont.innerHTML = `<div class="dash-epi-grade">
      ${item("Última sincronização", ultima ? geoHora(ultima.iniciado_em) : "—", ultima ? `${dataHoraBR(ultima.iniciado_em)} · ${ultima.origem}` : (c.geodigitus_sync_ativo ? "nenhuma rodada no mês" : "sincronização desligada"), "cpb", c.geodigitus_sync_ativo ? "" : "cinza")}
      ${item("Estacas de hoje", String(est.count ?? 0), "chegadas do computador de bordo", "chegadas")}
      ${item("Pendências", String(pend.count ?? 0), "sem máquina, obra, estaca ou diário", "pendentes", pend.count ? "ambar" : "")}
      ${item("CPUs", String(cs.length), `${falha} com falha · ${calib} calibração vencida`, "cpb", (falha || calib) ? "vermelho" : "")}
      ${item("Tráfego no mês", `${geoNum(mb, 1)} MB`, cota ? `cota ${geoNum(cota, 0)} MB (${geoNum(mb / cota * 100, 0)}%)` : "cota não informada", null, cota && mb > cota * 0.8 ? "ambar" : "")}
    </div>
    <p class="meta geo-card-rodape"><button type="button" class="dash-origem" data-geo-card="maquinas" title="Aba Máquinas hoje da Sala de Comando (fase 139)">Máquinas hoje ›</button></p>`;
}
function geoCliqueCard(alvo){
  if(alvo === "cpb"){ if(irParaSecao("equipamentos") && typeof cpbAbrirPainel === "function") cpbAbrirPainel(""); return; }
  if(alvo === "maquinas"){ if(typeof dmhAbrirAba === "function") dmhAbrirAba(); return; }   // fase 139: link para a aba Máquinas hoje
  if(irParaSecao("rdo")) geoAbrirPreset(alvo === "pendentes" ? "" : "todas", null).then(() => {
    if(alvo === "chegadas"){ if($("geo-f-sit")) $("geo-f-sit").value = ""; if($("geo-f-dia")) $("geo-f-dia").value = hojeISO(); geoRenderPainel(); }
  });
}

/* ---------- Usuários › parâmetros da empresa: bloco Geodigitus (empresa_config_admin_write = diretor e admin) ---------- */
async function geoEmpresaCarregarCard(){
  const card = $("usr-geo-card"); if(!card) return;
  const pode = !!usuarioAtual && ["diretor", "admin"].includes(usuarioAtual.cargo);
  if(!pode){ card.style.display = "none"; return; }
  const { data, error } = await sb.from("empresa_config")
    .select("geodigitus_sync_ativo,geodigitus_usuario,geodigitus_regiao,geodigitus_dias_retro,geodigitus_max_req_rodada,geodigitus_cota_mb_mes,geodigitus_sobreconsumo_alerta_pct,campo_fim_turno_noturno,campo_inicio_turno_noturno,campo_turno_noturno_min_h")
    .eq("id", 1).maybeSingle();
  if(error){ card.style.display = "none"; return; }   // sem a migration da 107a (ou da 134b)
  card.style.display = "";
  // fase 134b: parâmetros da regra do noturno
  if($("usr-geo-noturno-ini")) $("usr-geo-noturno-ini").value = String(data?.campo_inicio_turno_noturno || "18:00").slice(0, 5);
  if($("usr-geo-noturno-minh")) $("usr-geo-noturno-minh").value = data?.campo_turno_noturno_min_h ?? 2;
  $("usr-geo-ativo").checked = !!data?.geodigitus_sync_ativo;
  $("usr-geo-usuario").value = data?.geodigitus_usuario || "cgl";
  $("usr-geo-regiao").value = data?.geodigitus_regiao || "sa-east-1";
  $("usr-geo-dias").value = data?.geodigitus_dias_retro ?? 2;
  $("usr-geo-maxreq").value = data?.geodigitus_max_req_rodada ?? 150;
  $("usr-geo-cota").value = data?.geodigitus_cota_mb_mes ?? "";
  $("usr-geo-alerta").value = data?.geodigitus_sobreconsumo_alerta_pct ?? 15;
  $("usr-geo-noturno").value = String(data?.campo_fim_turno_noturno || "07:00").slice(0, 5);
}
async function geoEmpresaSalvar(){
  const n = (id, min, max) => { const v = Number($(id).value); return Number.isFinite(v) && v >= min && v <= max ? v : null; };
  const reg = {
    geodigitus_sync_ativo: $("usr-geo-ativo").checked,
    geodigitus_usuario: $("usr-geo-usuario").value.trim() || "cgl",
    geodigitus_regiao: $("usr-geo-regiao").value.trim() || "sa-east-1",
    geodigitus_dias_retro: n("usr-geo-dias", 0, 30),
    geodigitus_max_req_rodada: n("usr-geo-maxreq", 5, 2000),
    geodigitus_cota_mb_mes: $("usr-geo-cota").value === "" ? null : n("usr-geo-cota", 0, 1000000),
    geodigitus_sobreconsumo_alerta_pct: n("usr-geo-alerta", 0, 500),
    campo_fim_turno_noturno: $("usr-geo-noturno").value || "07:00",
    campo_inicio_turno_noturno: $("usr-geo-noturno-ini")?.value || "18:00",   // fase 134b
    campo_turno_noturno_min_h: $("usr-geo-noturno-minh") ? n("usr-geo-noturno-minh", 0, 12) : 2,
    updated_at: new Date().toISOString()
  };
  if(reg.geodigitus_dias_retro == null || reg.geodigitus_max_req_rodada == null || reg.geodigitus_sobreconsumo_alerta_pct == null || reg.campo_turno_noturno_min_h == null){
    aviso("app-aviso", "Valores inválidos: dias retro de 0 a 30, teto de 5 a 2000 requisições, alerta de 0 a 500%, noturno acima de 0 a 12 horas.", "erro"); return;
  }
  if(reg.geodigitus_sync_ativo && !confirm("Ligar a sincronização automática? Confirme antes: chaves e segredo do sync nos secrets da function e no vault, CPUs vinculadas às máquinas e o tipo de serviço das máquinas conferido. A partir daí o cron cria diários em rascunho.")) return;
  const { error } = await sb.from("empresa_config").update(reg).eq("id", 1);
  if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  aviso("app-aviso", "Parâmetros do Geodigitus salvos.", "ok");
}

/* ---------- eventos ---------- */
function ligarGeodigitus(){
  ["geo-f-dia", "geo-f-maq", "geo-f-sit"].forEach(id => $(id)?.addEventListener("change", () => { if(_rdoView === "geo") geoRenderPainel(); }));
  $("geo-busca")?.addEventListener("input", debounce(() => { if(_rdoView === "geo") geoRenderPainel(); }));
  $("btn-geo-atualizar")?.addEventListener("click", () => { _geoDados = null; geoRenderPainel(); });
  $("btn-geo-sincronizar")?.addEventListener("click", () => comBotaoTravado("btn-geo-sincronizar", geoSincronizarTudo));
  const bs = $("btn-geo-sincronizar"); if(bs) bs.style.display = "none";
  $("rdo-conteudo")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-geo-acao]");
    if(!b) return;
    ev.stopPropagation(); ev.preventDefault();
    comBotaoTravado(b, () => b.dataset.geoGrupo ? geoAcaoGrupo(b.dataset.geoAcao, b.dataset.geoGrupo) : geoAcao(b.dataset.geoAcao, b.dataset.geo));
  }, true);
  $("btn-geo-modal-fechar")?.addEventListener("click", geoFecharModal);
  $("btn-geo-modal-ok")?.addEventListener("click", () => comBotaoTravado("btn-geo-modal-ok", geoConfirmarModal));
  $("dash-geo")?.addEventListener("click", (ev) => { const el = ev.target.closest("[data-geo-card]"); if(el) geoCliqueCard(el.dataset.geoCard); });
  $("btn-dash-geo-abrir")?.addEventListener("click", () => geoCliqueCard("pendentes"));
  $("btn-usr-geo-salvar")?.addEventListener("click", () => comBotaoTravado("btn-usr-geo-salvar", geoEmpresaSalvar));
  // o botão "Sincronizar agora" da visão só aparece para quem opera o RDO (o usuário chega depois do login)
  document.querySelectorAll('#rdo-painel .serv-view-btn[data-view="geo"]').forEach(b => b.addEventListener("click", () => {
    const s = $("btn-geo-sincronizar"); if(s) s.style.display = geoPodeOperar() ? "" : "none";
  }));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarGeodigitus);
else ligarGeodigitus();

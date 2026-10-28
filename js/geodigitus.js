/* ====================================================================
   Módulo: Geodigitus pelo S3 — fase 107a
   - Visão "Chegadas do Geodigitus" no painel do RDO (#sec-rdo, toggle data-view="geo", prefixo geo-): uma linha por
     estaca que chegou do computador de bordo, com obra, número, Ø, profundidade, volume, sobreconsumo, horários e
     situação; ações Definir obra (com "salvar de-para"), Vincular estaca, Ignorar, Resolver de novo e Abrir RDO.
     Tudo grava pelas RPCs geodigitus_* (rdo_pode_operar() no banco: admin, engenheiro, assistente de engenharia,
     encarregado; diretor). As tabelas geodigitus_* só a service role grava.
   - Badge "Geodigitus" e sobreconsumo na execução do RDO (geoBadgeExec, chamado por renderExecucoes em rdo.js).
   - Card "Geodigitus" na Sala de Comando (geoCarregarCardSala, chamado por dashboard.js).
   - Bloco Geodigitus em Usuários › parâmetros da empresa (empresa_config.geodigitus_*, só diretor e admin).
   Regra 1 da fase: o Geodigitus é a fonte primária das estacas de hélice e secante; o Maya complementa.
   Sem a migration da 107a aplicada, cada parte some ou avisa, sem erro na tela.
   ==================================================================== */

let _geoDados = null;          // geodigitus_estacas com arquivo, máquina, obra e estaca
let _geoExecs = {};            // rdo_execucao_id → { sobreconsumo_pct, situacao }
let _geoIndisponivel = false;
let _geoModal = null;          // { tipo: "obra" | "estaca", geo }

const GEO_SITUACAO_LBL = {
  pendente_maquina: "Sem máquina", pendente_obra: "Sem obra", pendente_estaca: "Estaca a vincular",
  pendente_rdo_finalizado: "Diário finalizado", vinculada: "No diário", conciliada: "Conciliada", ignorada: "Ignorada"
};
const GEO_SITUACAO_COR = {
  pendente_maquina: "vermelho", pendente_obra: "vermelho", pendente_estaca: "ambar", pendente_rdo_finalizado: "ambar",
  vinculada: "verde", conciliada: "verde", ignorada: "cinza"
};
const GEO_PENDENTES = ["pendente_maquina", "pendente_obra", "pendente_estaca", "pendente_rdo_finalizado"];
const GEO_FILTRO_SIT = { geodigitus_estaca_sem_maquina: "pendente_maquina", geodigitus_estaca_sem_obra: "pendente_obra",
  geodigitus_estaca_sem_cadastro: "pendente_estaca", geodigitus_rdo_finalizado: "pendente_rdo_finalizado" };

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
    .select("id,situacao,obra_inferida,candidatos,contrato_txt,obra_txt,numero_txt,refuro,diametro_mm,profundidade_m,volume_concreto_m3,volume_teorico_m3,sobreconsumo_pct,torque_max_bar,perfuracao_inicio,perfuracao_fim,concretagem_inicio,concretagem_fim,avisos,ignorado_motivo,rdo_id,rdo_execucao_id,obra_id,equipamento_id,estaca_id,computador_id,created_at," +
            "arquivo:geodigitus_arquivos(id,data_arquivo,hora,imei,chave),equipamento:equipamentos(codigo),obra:obras(codigo,nome),estaca:estacas(numero,local)")
    .order("created_at", { ascending: false }).limit(1500);
  if(error){ _geoIndisponivel = geoIndisp(error); _geoDados = []; if(!_geoIndisponivel) aviso("app-aviso", "Não foi possível carregar as chegadas do Geodigitus: " + error.message, "erro"); return _geoDados; }
  _geoIndisponivel = false;
  _geoDados = data || [];
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
    if(dia && g.arquivo?.data_arquivo !== dia) return false;
    if(maq === "sem" ? g.equipamento_id : (maq && g.equipamento_id !== maq)) return false;
    if(sit === "pendentes" ? !GEO_PENDENTES.includes(g.situacao) : (sit && g.situacao !== sit)) return false;
    if(!q) return true;
    return `${g.numero_txt || ""} ${g.obra_txt || ""} ${g.contrato_txt || ""} ${g.obra?.codigo || ""} ${g.obra?.nome || ""} ${g.equipamento?.codigo || ""} ${g.arquivo?.imei || ""}`.toLowerCase().includes(q);
  });
}
function geoAcoesHTML(g){
  const pode = geoPodeOperar(), b = [];
  if(pode && g.situacao === "pendente_obra") b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="obra" data-geo="${esc(g.id)}">Definir obra</button>`);
  if(pode && (g.situacao === "pendente_estaca" || (["vinculada", "conciliada"].includes(g.situacao) && !g.estaca_id))) b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="estaca" data-geo="${esc(g.id)}">Vincular estaca</button>`);
  if(pode && ["pendente_maquina", "pendente_obra", "pendente_rdo_finalizado"].includes(g.situacao)) b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="resolver" data-geo="${esc(g.id)}" title="Depois de corrigir o vínculo da CPU, a mobilização ou reabrir o diário">Resolver de novo</button>`);
  if(g.situacao === "pendente_maquina" && g.computador_id) b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="cpu" data-geo="${esc(g.id)}">Abrir CPU</button>`);
  if(g.rdo_id) b.push(`<button type="button" class="btn-sec btn-sm" data-geo-acao="rdo" data-geo="${esc(g.id)}">Abrir RDO</button>`);
  if(pode && g.situacao !== "ignorada" && !g.rdo_execucao_id) b.push(`<button type="button" class="btn-sec btn-sm acao-perigo" data-geo-acao="ignorar" data-geo="${esc(g.id)}">Ignorar</button>`);
  return b.join(" ");
}
async function geoRenderPainel(){
  const cont = $("rdo-conteudo"); if(!cont) return;
  if(!_geoDados) cont.innerHTML = `<p class="vazio">Carregando chegadas do Geodigitus…</p>`;
  await geoCarregar(false);
  if(typeof _rdoView !== "undefined" && _rdoView !== "geo") return;
  if(_geoIndisponivel){ cont.innerHTML = `<p class="vazio">Chegadas do Geodigitus ainda não disponíveis (a migration da fase 107a não foi aplicada).</p>`; return; }
  const dados = geoFiltradas();
  const pend = (_geoDados || []).filter(g => GEO_PENDENTES.includes(g.situacao)).length;
  const c = $("rdo-contador"); if(c) c.textContent = `${dados.length} de ${_geoDados.length}${pend ? ` · ${pend} pendente(s)` : ""}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhuma estaca do Geodigitus com esses filtros.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Dia</th><th>Máquina</th><th>Obra</th><th>Estaca</th><th class="num">Ø (mm)</th><th class="num">Prof. (m)</th><th class="num">Volume (m³)</th><th>Sobreconsumo</th><th>Perfuração</th><th>Concretagem</th><th>Situação</th><th></th></tr></thead>
    <tbody>${dados.map(g => `<tr data-geo-linha="${esc(g.id)}">
      <td>${dataBR(g.arquivo?.data_arquivo)}</td>
      <td>${g.equipamento?.codigo ? `<strong>${esc(g.equipamento.codigo)}</strong>` : `<span class="meta">CPU ${esc(g.arquivo?.imei || "?")}</span>`}</td>
      <td>${g.obra_id ? linkObra(g.obra_id, g.obra?.codigo || "obra") + (g.obra_inferida ? ` <span class="tag cinza" title="Obra vinda da mobilização/vínculo da máquina, não do que o operador digitou na CPU">pela máquina</span>` : "") : ""}
        <div class="meta">CPU: "${esc(g.obra_txt || "—")}"${g.contrato_txt ? ` · ${esc(g.contrato_txt)}` : ""}</div></td>
      <td><strong>${esc(g.numero_txt || "—")}</strong>${g.refuro ? ` <span class="tag ambar">Refurada</span>` : ""}${g.estaca?.numero ? `<div class="meta">${esc(g.estaca.numero)}${g.estaca.local ? " · " + esc(g.estaca.local) : ""}</div>` : (g.candidatos?.length > 1 ? `<div class="meta">${esc(g.candidatos.length)} candidatas</div>` : "")}</td>
      <td class="num">${esc(geoNum(g.diametro_mm, 0))}</td>
      <td class="num">${esc(geoNum(g.profundidade_m))}</td>
      <td class="num">${esc(geoNum(g.volume_concreto_m3, 3))}</td>
      <td>${/* html */ geoTagSobre(g.sobreconsumo_pct)}</td>
      <td>${esc(geoHora(g.perfuracao_inicio))}–${esc(geoHora(g.perfuracao_fim))}</td>
      <td>${esc(geoHora(g.concretagem_inicio))}–${esc(geoHora(g.concretagem_fim))}</td>
      <td><span class="tag ${esc(GEO_SITUACAO_COR[g.situacao] || "cinza")}">${esc(GEO_SITUACAO_LBL[g.situacao] || g.situacao)}</span>
        ${(g.avisos || []).length ? `<div class="meta" title="${esc((g.avisos || []).join("\n"))}">⚠️ ${esc(g.avisos.length)} aviso(s)</div>` : ""}${g.ignorado_motivo ? `<div class="meta">${esc(g.ignorado_motivo)}</div>` : ""}</td>
      <td class="col-acao">${/* html */ geoAcoesHTML(g)}</td>
    </tr>`).join("")}</tbody></table></div>`;
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
    if(g?.rdo_id && g.situacao === "pendente_rdo_finalizado" && typeof abrirRDO === "function") abrirRDO(g.rdo_id);
  }
}

/* ---------- ações ---------- */
async function geoAcao(acao, id){
  const g = (_geoDados || []).find(x => x.id === id); if(!g) return;
  if(acao === "rdo"){ if(g.rdo_id && typeof abrirRDO === "function") abrirRDO(g.rdo_id); return; }
  if(acao === "cpu"){ if(typeof cpbAbrir === "function") cpbAbrir(g.computador_id); return; }
  if(acao === "obra") return geoAbrirModal("obra", g);
  if(acao === "estaca") return geoAbrirModal("estaca", g);
  if(acao === "resolver"){
    const { data, error } = await sb.rpc("geodigitus_estaca_resolver", { p_geo: id, p_origem: "geodigitus_manual" });
    if(error){ aviso("app-aviso", "Não foi possível resolver: " + error.message, "erro"); return; }
    aviso("app-aviso", `Situação: ${GEO_SITUACAO_LBL[data?.situacao] || data?.situacao || "—"}${data?.rdo_criado ? " (diário criado em rascunho)" : ""}.`, GEO_PENDENTES.includes(data?.situacao) ? "aviso" : "ok");
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
    const { data } = await sb.from("estacas").select("id,numero,local,bloco,status,diametro_mm").eq("obra_id", obra).order("numero").limit(5000);
    const cands = new Set(g.candidatos || []);
    const lista = (data || []).sort((a, b) => (cands.has(b.id) - cands.has(a.id)) || String(a.numero).localeCompare(String(b.numero), "pt-BR", { numeric: true }));
    corpo.innerHTML = `<p class="meta">Número no computador de bordo: <strong>${esc(g.numero_txt || "—")}</strong>${g.refuro ? " (Refurada: vincule à estaca original)" : ""}. ${cands.size > 1 ? `${esc(cands.size)} estacas com esse número em locais diferentes da obra: escolha o local certo.` : ""}</p>
      <div class="grade"><div class="campo largo"><label>Estaca cadastrada na obra</label><select id="geo-modal-estaca"><option value="">Escolha a estaca</option>${lista.map(e => `<option value="${esc(e.id)}">${cands.has(e.id) ? "★ " : ""}${esc(e.numero)}${e.local ? " · " + esc(e.local) : ""}${e.bloco ? " · bloco " + esc(e.bloco) : ""}${e.diametro_mm ? " · Ø " + esc(e.diametro_mm) : ""}</option>`).join("")}</select></div></div>`;
  }
}
function geoFecharModal(){ $("geo-modal").style.display = "none"; _geoModal = null; }
async function geoConfirmarModal(){
  if(!_geoModal || !geoPodeOperar()) return;
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
  const { data, error } = await sb.from("geodigitus_estacas").select("rdo_execucao_id,sobreconsumo_pct,situacao,arquivo:geodigitus_arquivos(imei)").in("rdo_execucao_id", ids);
  if(error) return false;
  (data || []).forEach(g => { _geoExecs[g.rdo_execucao_id] = g; });
  return (data || []).length > 0;
}
function geoBadgeExec(e){
  const g = e && e.id ? _geoExecs[e.id] : null;
  if(!g && e?.origem_dados !== "geodigitus_s3") return "";
  const titulo = g ? `Do computador de bordo (CPU ${g.arquivo?.imei || "?"})${g.situacao === "conciliada" ? ": conciliada com o que já estava digitado" : ""}` : "Do computador de bordo (Geodigitus)";
  return `<span data-geo-badge="1"> <span class="tag azul" title="${esc(titulo)}">Geodigitus</span>${g ? geoTagSobre(g.sobreconsumo_pct) : ""}</span>`;
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
    sb.from("empresa_config").select("geodigitus_sync_ativo,geodigitus_cota_mb_mes,geodigitus_sobreconsumo_alerta_pct").eq("id", 1).maybeSingle(),
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
    </div>`;
}
function geoCliqueCard(alvo){
  if(alvo === "cpb"){ if(irParaSecao("equipamentos") && typeof cpbAbrirPainel === "function") cpbAbrirPainel(""); return; }
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
    .select("geodigitus_sync_ativo,geodigitus_usuario,geodigitus_regiao,geodigitus_dias_retro,geodigitus_max_req_rodada,geodigitus_cota_mb_mes,geodigitus_sobreconsumo_alerta_pct,campo_fim_turno_noturno")
    .eq("id", 1).maybeSingle();
  if(error){ card.style.display = "none"; return; }   // sem a migration da 107a
  card.style.display = "";
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
    updated_at: new Date().toISOString()
  };
  if(reg.geodigitus_dias_retro == null || reg.geodigitus_max_req_rodada == null || reg.geodigitus_sobreconsumo_alerta_pct == null){
    aviso("app-aviso", "Valores inválidos: dias retro de 0 a 30, teto de 5 a 2000 requisições, alerta de 0 a 500%.", "erro"); return;
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
    comBotaoTravado(b, () => geoAcao(b.dataset.geoAcao, b.dataset.geo));
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

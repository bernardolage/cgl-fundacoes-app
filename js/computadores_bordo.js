/* ====================================================================
   Módulo: Computadores de bordo Geodigitus (CPU Saci) — fase 107a
   Visão "Computadores de bordo" no painel de Equipamentos (toggle #eqp-views, data-view="cpb") e ficha Odoo própria
   (#cpb-ficha): statusbar ativo → reserva → manutenção → baixado, chips IMEI / máquina atual / calibração até /
   sincronização, smart-buttons (estacas, vínculos, certificados) e abas Dados · Vínculos · Calibração · Sincronização.
   O IMEI identifica a CPU; a estaca é atribuída à máquina vigente na data pelo vínculo por período (o gatilho do banco
   recusa sobreposição). Certificados no bucket privado computadores-bordo (pasta = id da CPU).
   Quem cadastra CPU, vínculo e certificado: computador_bordo_pode_operar() no banco (admin, engenheiro, assistente de
   engenharia, gestor de frota, gestor de manutenção; diretor); "Sincronizar agora" cria RDO e exige rdo_pode_operar()
   (decisão 7), conferido pela function geodigitus-sync. Nada de IMEI cadastrado sozinho: IMEI do balde sem cadastro
   aparece na lista "IMEIs no balde sem cadastro" para alguém cadastrar ou ignorar com motivo.
   Sem a migration da 107a aplicada (vw_computadores_bordo inexistente), a visão avisa e o KPI some.
   ==================================================================== */

let _cpbRegistros = null;      // vw_computadores_bordo
let _cpbImeisBalde = [];       // geodigitus_imeis_bucket sem cadastro
let _cpbAtual = null;          // registro aberto
let _cpbEditId = null;         // null = nova
let _cpbFiltroCal = "";        // filtro de calibração vindo do KPI ou do Para regularizar
let _cpbIndisponivel = false;  // migration da 107a não aplicada

const CPB_STATUS = {
  ativo:      { label: "Ativo",          cor: "verde" },
  reserva:    { label: "Reserva",        cor: "azul" },
  manutencao: { label: "Em manutenção",  cor: "ambar" },
  baixado:    { label: "Baixado",        cor: "cinza" }
};
const CPB_CAL = {
  vigente:         { label: "Vigente",            cor: "verde" },
  vence_30_dias:   { label: "Vence em 30 dias",   cor: "ambar" },
  vencida:         { label: "Vencida",            cor: "vermelho" },
  sem_certificado: { label: "Sem certificado",    cor: "vermelho" }
};
const CPB_SYNC = {
  aguardando:          { label: "Aguardando",           cor: "cinza" },
  configurando_acesso: { label: "Configurando acesso",  cor: "ambar" },
  sincronizando:       { label: "Sincronizando",        cor: "azul" },
  faltam_arquivos:     { label: "Ainda faltam arquivos", cor: "ambar" },
  pronto:              { label: "Pronto",               cor: "verde" },
  falha:               { label: "Falha",                cor: "vermelho" }
};
const CPB_ARQ = { novo: "Novo", baixado: "Baixado", decodificado: "Decodificado", vinculado: "Vinculado", ignorado: "Ignorado", erro: "Erro" };
const CPB_MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

const cpbTag = (mapa, v) => { const o = mapa[v]; return `<span class="tag ${esc(o ? o.cor : "cinza")}">${esc(o ? o.label : (v || "—"))}</span>`; };
/* espelha computador_bordo_pode_operar() do banco */
function cpbPodeOperar(){
  return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "admin", "engenheiro", "assistente_engenharia", "gestor_frota", "gestor_manutencao"].includes(usuarioAtual.cargo);
}
/* espelha rdo_pode_operar(): sincronizar cria RDO (decisão 7) */
function cpbPodeSincronizar(){
  return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "admin", "engenheiro", "assistente_engenharia", "encarregado"].includes(usuarioAtual.cargo);
}
const cpbIndisp = (err) => !!err && ["42P01", "PGRST205", "PGRST200", "42703"].includes(err.code);

/* ---------- carga ---------- */
async function carregarComputadoresBordo(force){
  if(_cpbRegistros && !force) return _cpbRegistros;
  const [v, b] = await Promise.all([
    sb.from("vw_computadores_bordo").select("*").order("imei"),
    sb.from("geodigitus_imeis_bucket").select("*").is("ignorado_em", null).order("ultimo_dia", { ascending: false, nullsFirst: false })
  ]);
  if(v.error){
    _cpbIndisponivel = cpbIndisp(v.error);
    _cpbRegistros = [];
    if(!_cpbIndisponivel) aviso("app-aviso", "Não foi possível carregar os computadores de bordo: " + v.error.message, "erro");
    return _cpbRegistros;
  }
  _cpbIndisponivel = false;
  _cpbRegistros = v.data || [];
  const cad = new Set(_cpbRegistros.map(c => c.imei));
  _cpbImeisBalde = (b.data || []).filter(x => !cad.has(x.imei));
  return _cpbRegistros;
}

/* KPI do painel de Equipamentos: CPU ativa com calibração vencida ou sem certificado */
async function cpbAtualizarKpi(){
  const box = $("eqp-kpi-cpu-box"); if(!box) return;
  await carregarComputadoresBordo(false);
  box.style.display = _cpbIndisponivel ? "none" : "";
  const n = (_cpbRegistros || []).filter(c => c.status === "ativo" && ["vencida", "sem_certificado"].includes(c.calibracao_situacao)).length;
  const el = $("eqp-kpi-cpu"); if(el) el.textContent = n;
}

/* ---------- painel (dentro do card de Equipamentos) ---------- */
function cpbFiltradas(){
  const q = ($("cpb-busca")?.value || "").trim().toLowerCase();
  const st = $("cpb-f-status")?.value || "";
  const cal = $("cpb-f-cal")?.value || _cpbFiltroCal || "";
  return (_cpbRegistros || []).filter(c => {
    if(st && c.status !== st) return false;
    if(cal === "vencida" ? !["vencida", "sem_certificado"].includes(c.calibracao_situacao) : (cal && c.calibracao_situacao !== cal)) return false;
    if(!q) return true;
    return `${c.imei} ${c.numero_serie || ""} ${c.equipamento_atual_codigo || ""} ${c.equipamento_atual_nome || ""} ${c.observacoes || ""}`.toLowerCase().includes(q);
  });
}
async function cpbRenderPainel(){
  const cont = $("eqp-conteudo"); if(!cont) return;
  if(!_cpbRegistros) cont.innerHTML = `<p class="vazio">Carregando computadores de bordo…</p>`;
  await carregarComputadoresBordo(false);
  if(typeof _eqpView !== "undefined" && _eqpView !== "cpb") return;   // trocou de visão enquanto carregava
  const bn = $("btn-cpb-novo"); if(bn) bn.style.display = cpbPodeOperar() && !_cpbIndisponivel ? "" : "none";
  const bd = $("btn-cpb-descobrir"); if(bd) bd.style.display = cpbPodeOperar() && !_cpbIndisponivel ? "" : "none";
  const fc = $("cpb-f-cal"); if(fc && _cpbFiltroCal && !fc.value) fc.value = _cpbFiltroCal;
  if(_cpbIndisponivel){ cont.innerHTML = `<p class="vazio">Computadores de bordo ainda não disponíveis (a migration da fase 107a não foi aplicada).</p>`; return; }
  const dados = cpbFiltradas();
  $("eqp-contador").textContent = `${dados.length} de ${_cpbRegistros.length}`;
  const linhas = dados.map(c => `<tr class="linha-clicavel" data-cpb="${esc(c.id)}">
      <td><strong>${esc(c.imei)}</strong></td>
      <td>${esc(c.numero_serie || "—")}</td>
      <td>${cpbTag(CPB_STATUS, c.status)}</td>
      <td>${c.equipamento_atual_codigo ? `<strong>${esc(c.equipamento_atual_codigo)}</strong> ${esc(c.equipamento_atual_nome || "")}${c.vinculo_inicio ? `<div class="meta">desde ${dataBR(c.vinculo_inicio)}</div>` : ""}` : (c.status === "ativo" ? `<span class="tag vermelho">sem máquina</span>` : "—")}</td>
      <td>${cpbTag(CPB_CAL, c.calibracao_situacao)}${c.calibracao_valido_ate ? `<div class="meta">até ${dataBR(c.calibracao_valido_ate)}</div>` : ""}</td>
      <td>${c.ultimo_dia_sincronizado ? dataBR(c.ultimo_dia_sincronizado) : "—"}</td>
      <td>${cpbTag(CPB_SYNC, c.sync_estado)}</td>
      <td class="num">${esc(c.estacas)}${c.estacas_pendentes ? ` <span class="tag ambar" title="estacas com pendência">${esc(c.estacas_pendentes)}</span>` : ""}</td>
    </tr>`).join("");
  const balde = _cpbImeisBalde.length ? `<h3 class="titulo-bloco">IMEIs no balde sem cadastro <span class="contador">${esc(_cpbImeisBalde.length)}</span></h3>
    <p class="meta">A sincronização não cadastra CPU sozinha. Cadastre (e vincule à máquina com o Pedro e o Isaque) ou ignore com motivo, por exemplo CPU antiga baixada.</p>
    <div class="tabela-rola"><table>
      <thead><tr><th>Pasta</th><th>IMEI</th><th>Anos</th><th>Último dia</th><th class="num">Arquivos no último dia</th><th></th></tr></thead>
      <tbody>${_cpbImeisBalde.map(x => `<tr>
        <td>${esc(x.pasta)}</td><td><strong>${esc(x.imei)}</strong></td><td>${esc(x.anos || "—")}</td><td>${x.ultimo_dia ? dataBR(x.ultimo_dia) : "—"}</td>
        <td class="num">${esc(x.arquivos_ultimo_dia ?? "—")}</td>
        <td class="col-acao">${cpbPodeOperar() ? `<button type="button" class="btn-sec btn-sm" data-cpb-cadastrar="${esc(x.imei)}" data-pasta="${esc(x.pasta)}">Cadastrar</button>
          <button type="button" class="btn-sec btn-sm" data-cpb-ignorar="${esc(x.imei)}" data-pasta="${esc(x.pasta)}">Ignorar</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>` : "";
  cont.innerHTML = `${dados.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>IMEI</th><th>Nº de série</th><th>Status</th><th>Máquina atual</th><th>Calibração</th><th>Último dia sincronizado</th><th>Sincronização</th><th class="num">Estacas</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>` : `<p class="vazio">Nenhum computador de bordo com esses filtros.</p>`}${balde}`;
}

/* chamado pelo KPI e pelo Para regularizar (dashboard.js) */
function cpbAbrirPainel(filtro){
  _cpbFiltroCal = filtro === "cpu_calibracao_vencida" ? "vencida" : "";
  if(typeof _eqpView !== "undefined") _eqpView = "cpb";
  if(typeof mostrarPainelEquipamentos === "function" && $("eqp-painel") && $("eqp-painel").style.display === "none") mostrarPainelEquipamentos();
  cpbFecharFicha(false);
  const fs = $("cpb-f-status"); if(fs) fs.value = filtro === "cpu_sem_vinculo" ? "ativo" : "";
  const fc = $("cpb-f-cal"); if(fc) fc.value = _cpbFiltroCal;
  _cpbRegistros = null;
  if(typeof renderEquipamentos === "function") renderEquipamentos();
}

/* ---------- ficha ---------- */
function cpbFecharFicha(render = true){
  const f = $("cpb-ficha"); if(f) f.style.display = "none";
  const p = $("eqp-painel"); if(p) p.style.display = "";
  _cpbAtual = null; _cpbEditId = null;
  if(render && typeof renderEquipamentos === "function"){ _cpbRegistros = null; renderEquipamentos(); }
}
function cpbNova(imei, pasta){
  if(!cpbPodeOperar()){ aviso("app-aviso", "Seu perfil não cadastra computadores de bordo.", "erro"); return; }
  cpbAbrirFicha({ id: null, imei: imei || "", status: "ativo", pasta_bucket: pasta || "h", fabricante: "Geodigitus", modelo: "Saci", sync_estado: "aguardando" });
}
async function cpbAbrir(id){
  if(!id) return;
  if(typeof irParaSecao === "function" && $("sec-equipamentos") && !$("sec-equipamentos").classList.contains("ativa")) { if(!irParaSecao("equipamentos")) return; }
  await carregarComputadoresBordo(false);
  let c = (_cpbRegistros || []).find(x => x.id === id);
  if(!c){
    const { data } = await sb.from("vw_computadores_bordo").select("*").eq("id", id).maybeSingle();
    if(!data){ aviso("app-aviso", "Computador de bordo não encontrado.", "erro"); return; }
    c = data;
  }
  cpbAbrirFicha(c);
}
function cpbAtivarTab(nome){
  document.querySelectorAll("#cpb-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#cpb-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
function cpbAtualizarStatusbar(st){
  document.querySelectorAll("#cpb-statusbar .stage").forEach(el => {
    el.classList.remove("atual", "passada", "cancelada");
    if(el.dataset.status === st) el.classList.add(st === "baixado" ? "cancelada" : "atual");
  });
}
function cpbAbrirFicha(c){
  _cpbAtual = c; _cpbEditId = c.id || null;
  const nova = !c.id, pode = cpbPodeOperar();
  if($("eqp-ficha")) $("eqp-ficha").style.display = "none";
  $("eqp-painel").style.display = "none";
  $("cpb-ficha").style.display = "";
  $("cpb-ficha-titulo").textContent = nova ? "Novo computador de bordo" : `CPU ${c.imei}`;
  $("btn-cpb-salvar").style.display = pode ? "" : "none";
  document.querySelectorAll("#cpb-ficha .cpb-so-existente").forEach(el => el.style.display = nova ? "none" : "");
  const podeSync = !nova && cpbPodeSincronizar() && c.status !== "baixado";
  ["btn-cpb-sincronizar", "btn-cpb-sincronizar2"].forEach(id => { const b = $(id); if(b) b.style.display = podeSync ? "" : "none"; });
  $("cpb-ficha").querySelectorAll("input,select,textarea").forEach(el => el.disabled = !pode);
  $("cpb-imei").disabled = !pode || !nova;
  $("cpb-imei").value = c.imei || "";
  $("cpb-serie").value = c.numero_serie || "";
  $("cpb-fabricante").value = c.fabricante || "Geodigitus";
  $("cpb-modelo").value = c.modelo || "Saci";
  $("cpb-pasta").value = c.pasta_bucket || "h";
  $("cpb-obs").value = c.observacoes || "";
  cpbAtualizarStatusbar(c.status || "ativo");
  $("cpb-chip-imei").textContent = c.imei || "—";
  $("cpb-chip-maq").textContent = c.equipamento_atual_codigo ? `${c.equipamento_atual_codigo}${c.vinculo_inicio ? " desde " + dataBR(c.vinculo_inicio) : ""}` : (nova ? "—" : "sem máquina");
  $("cpb-chip-cal").innerHTML = nova ? "—" : `${cpbTag(CPB_CAL, c.calibracao_situacao)}${c.calibracao_valido_ate ? " " + dataBR(c.calibracao_valido_ate) : ""}`;
  $("cpb-chip-sync").innerHTML = nova ? "—" : `${cpbTag(CPB_SYNC, c.sync_estado)}${c.ultimo_dia_sincronizado ? " " + dataBR(c.ultimo_dia_sincronizado) : ""}`;
  const sb3 = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !Number(n)); } };
  sb3("sb-cpb-est", c.estacas || 0); sb3("sb-cpb-vinc", 0); sb3("sb-cpb-cert", 0);
  ["cpb-vinc-lista", "cpb-cal-lista", "cpb-sync-info"].forEach(id => { const el = $(id); if(el) el.innerHTML = `<p class="vazio">${nova ? "Salve a CPU primeiro." : "Carregando…"}</p>`; });
  $("cpb-vinc-fim-data").value = hojeISO(); $("cpb-vinc-inicio").value = hojeISO();
  ["cpb-vinc-motivo", "cpb-vinc-fim-motivo", "cpb-cal-numero", "cpb-cal-lab", "cpb-cal-emitido", "cpb-cal-valido", "cpb-cal-obs"].forEach(id => { const el = $(id); if(el) el.value = ""; });
  if($("cpb-cal-arquivo")) $("cpb-cal-arquivo").value = "";
  if(!nova) cpbCarregarFilhas(c);
  if(!nova && typeof montarHistorico === "function") montarHistorico("computadores_bordo", c.id, "cpb-chatter");
  cpbAtivarTab("dados");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function cpbCarregarFilhas(c){
  const id = c.id;
  const [vinc, cal, arqs, maqs, ests] = await Promise.all([
    sb.from("computador_bordo_vinculos").select("id,equipamento_id,inicio,fim,motivo,created_at,equipamento:equipamentos(codigo,nome)").eq("computador_id", id).order("inicio", { ascending: false }),
    sb.from("computador_bordo_calibracoes").select("*").eq("computador_id", id).order("valido_ate", { ascending: false }),
    sb.from("geodigitus_arquivos").select("id,chave,data_arquivo,hora,nome_obra,nome_estaca,status,erro,tentativas,tamanho_bytes,baixado_em").eq("computador_id", id).order("data_arquivo", { ascending: false }).limit(300),
    sb.from("equipamentos").select("id,codigo,nome,tipo_servico_padrao").eq("ativo", true).in("tipo", ["perfuratriz", "bate_estaca"]).order("codigo"),
    sb.from("geodigitus_estacas").select("situacao").eq("computador_id", id).limit(5000)
  ]);
  if(_cpbAtual?.id !== id) return;
  // vínculos
  const vs = vinc.data || [];
  const pode = cpbPodeOperar();
  const atual = vs.find(v => !v.fim);
  $("cpb-vinc-atual-bloco").style.display = atual && pode ? "" : "none";
  $("cpb-vinc-novo-bloco").style.display = !atual && pode && c.status !== "baixado" ? "" : "none";
  preencherSelect($("cpb-vinc-maq"), (maqs.data || []).map(m => ({ id: m.id, txt: `${m.codigo} — ${m.nome}${m.tipo_servico_padrao ? "" : " (sem tipo de serviço)"}` })), "id", "txt", "Escolha a máquina");
  $("cpb-vinc-lista").innerHTML = vs.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Máquina</th><th>Início</th><th>Fim</th><th>Motivo</th></tr></thead>
      <tbody>${vs.map(v => `<tr><td><strong>${esc(v.equipamento?.codigo || "?")}</strong> ${esc(v.equipamento?.nome || "")}</td><td>${dataBR(v.inicio)}</td>
        <td>${v.fim ? dataBR(v.fim) : `<span class="tag verde">atual</span>`}</td><td>${esc(v.motivo || "—")}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Sem vínculo: as estacas desta CPU ficam "sem máquina" até alguém vincular.</p>`;
  // certificados
  const cs = cal.data || [];
  $("cpb-cal-lista").innerHTML = cs.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Certificado</th><th>Laboratório</th><th>Emitido em</th><th>Válido até</th><th>Arquivo</th><th>Observações</th></tr></thead>
      <tbody>${cs.map(k => `<tr><td><strong>${esc(k.numero_certificado || "—")}</strong></td><td>${esc(k.laboratorio || "—")}</td><td>${k.emitido_em ? dataBR(k.emitido_em) : "—"}</td>
        <td>${dataBR(k.valido_ate)} ${k.valido_ate < hojeISO() ? `<span class="tag vermelho">vencido</span>` : ""}</td>
        <td>${k.arquivo_url ? `<button type="button" class="btn-sec btn-sm" data-cpb-cert="${esc(k.arquivo_url)}">Abrir</button>` : "—"}</td><td>${esc(k.observacoes || "")}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Nenhum certificado de calibração: a CPU aparece em "Para regularizar".</p>`;
  $("cpb-cal-form").style.display = pode ? "" : "none";
  // sincronização
  const as = arqs.data || [];
  const porSt = {}; as.forEach(a => { porSt[a.status] = (porSt[a.status] || 0) + 1; });
  const porSit = {}; (ests.data || []).forEach(g => { porSit[g.situacao] = (porSit[g.situacao] || 0) + 1; });
  const erros = as.filter(a => a.status === "erro" || a.erro);
  $("cpb-sync-info").innerHTML = `<div class="grade">
      <div class="campo"><label>Estado</label><div>${cpbTag(CPB_SYNC, c.sync_estado)}</div></div>
      <div class="campo"><label>Último dia sincronizado</label><div>${c.ultimo_dia_sincronizado ? dataBR(c.ultimo_dia_sincronizado) : "—"}</div></div>
      <div class="campo"><label>Última sincronização</label><div>${c.ultima_sincronizacao_em ? esc(dataHoraBR(c.ultima_sincronizacao_em)) : "—"}</div></div>
      <div class="campo"><label>Pasta no balde</label><div>${esc(c.pasta_bucket || "h")}</div></div>
      ${c.sync_proxima_em ? `<div class="campo"><label>Recuo após falha</label><div>${esc(c.sync_recuo_s)} s · próxima tentativa ${esc(dataHoraBR(c.sync_proxima_em))}</div></div>` : ""}
      ${c.sync_erro ? `<div class="campo largo"><label>Último erro</label><div class="txt-perigo">${esc(c.sync_erro)}</div></div>` : ""}
    </div>
    <p class="meta">Arquivos por status: ${Object.keys(CPB_ARQ).filter(k => porSt[k]).map(k => `${esc(CPB_ARQ[k])} ${esc(porSt[k])}`).join(" · ") || "nenhum ainda"}.
      Estacas: ${Object.entries(porSit).map(([k, n]) => `${esc((typeof GEO_SITUACAO_LBL === "object" ? GEO_SITUACAO_LBL : {})[k] || k)} ${esc(n)}`).join(" · ") || "nenhuma"}.</p>
    ${erros.length ? `<h3 class="titulo-bloco">Erros (${esc(erros.length)})</h3><div class="tabela-rola"><table>
      <thead><tr><th>Dia</th><th>Arquivo</th><th>Erro</th><th class="num">Tentativas</th></tr></thead>
      <tbody>${erros.slice(0, 50).map(a => `<tr><td>${dataBR(a.data_arquivo)}</td><td>${esc((a.chave || "").split("/").pop())}</td><td>${esc(a.erro || "—")}</td><td class="num">${esc(a.tentativas)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <h3 class="titulo-bloco">Últimos arquivos</h3>
    ${as.length ? `<div class="tabela-rola"><table><thead><tr><th>Dia</th><th>Hora</th><th>Obra (CPU)</th><th>Estaca (nome)</th><th>Status</th><th class="num">Bytes</th></tr></thead>
      <tbody>${as.slice(0, 60).map(a => `<tr><td>${dataBR(a.data_arquivo)}</td><td>${esc(a.hora || "—")}</td><td>${esc(a.nome_obra || "—")}</td><td>${esc(a.nome_estaca || "—")}</td>
        <td><span class="tag ${a.status === "erro" ? "vermelho" : a.status === "vinculado" ? "verde" : "cinza"}">${esc(CPB_ARQ[a.status] || a.status)}</span></td><td class="num">${esc(a.tamanho_bytes ?? "—")}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vazio">Nenhum arquivo sincronizado ainda.</p>`}`;
  const sb3 = (bid, n) => { const b = $(bid); if(b){ b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !Number(n)); } };
  sb3("sb-cpb-vinc", vs.length); sb3("sb-cpb-cert", cs.length); sb3("sb-cpb-est", (ests.data || []).length);
}

async function cpbSalvar(){
  if(!cpbPodeOperar()) return;
  const imei = $("cpb-imei").value.replace(/\D/g, "");
  if(!/^\d{15}$/.test(imei)){ aviso("app-aviso", "O IMEI tem 15 dígitos.", "erro"); $("cpb-imei").focus(); return; }
  const reg = {
    numero_serie: $("cpb-serie").value.trim() || null, fabricante: $("cpb-fabricante").value.trim() || "Geodigitus",
    modelo: $("cpb-modelo").value.trim() || "Saci", pasta_bucket: $("cpb-pasta").value.trim() || "h", observacoes: $("cpb-obs").value.trim() || null
  };
  let res;
  if(_cpbEditId) res = await sb.from("computadores_bordo").update(reg).eq("id", _cpbEditId).select("id").single();
  else res = await sb.from("computadores_bordo").insert({ ...reg, imei, status: _cpbAtual?.status || "ativo" }).select("id").single();
  if(res.error){ aviso("app-aviso", "Não foi possível salvar: " + (res.error.code === "23505" ? "este IMEI já está cadastrado." : res.error.message), "erro"); return; }
  aviso("app-aviso", "Computador de bordo salvo.", "ok");
  _cpbRegistros = null;
  await cpbAbrir(res.data.id);
  if(!_cpbAtual?.equipamento_atual_id && _cpbAtual?.status === "ativo") cpbAtivarTab("vinculos");
}
async function cpbMudarStatus(st){
  if(!_cpbEditId || !cpbPodeOperar() || !CPB_STATUS[st] || st === _cpbAtual?.status) return;
  if(st === "baixado" && !confirm("Baixar este computador de bordo? Ele sai da sincronização (o histórico fica).")) return;
  const { error } = await sb.from("computadores_bordo").update({ status: st }).eq("id", _cpbEditId);
  if(error){ aviso("app-aviso", "Não foi possível mudar o status: " + error.message, "erro"); return; }
  _cpbRegistros = null;
  await cpbAbrir(_cpbEditId);
}
async function cpbIniciarVinculo(){
  if(!_cpbEditId || !cpbPodeOperar()) return;
  const eq = $("cpb-vinc-maq").value, inicio = $("cpb-vinc-inicio").value, motivo = $("cpb-vinc-motivo").value.trim();
  if(!eq || !inicio){ aviso("app-aviso", "Escolha a máquina e a data de início.", "erro"); return; }
  const { error } = await sb.from("computador_bordo_vinculos").insert({ computador_id: _cpbEditId, equipamento_id: eq, inicio, motivo: motivo || null });
  if(error){ aviso("app-aviso", "Não foi possível vincular: " + error.message, "erro"); return; }
  if(_cpbAtual?.status === "reserva" && confirm("A CPU estava como reserva. Marcar como ativa?")) await sb.from("computadores_bordo").update({ status: "ativo" }).eq("id", _cpbEditId);
  aviso("app-aviso", "Vínculo iniciado.", "ok");
  _cpbRegistros = null; await cpbAbrir(_cpbEditId); cpbAtivarTab("vinculos");
}
async function cpbEncerrarVinculo(){
  if(!_cpbEditId || !cpbPodeOperar()) return;
  const fim = $("cpb-vinc-fim-data").value, motivo = $("cpb-vinc-fim-motivo").value.trim();
  if(!fim){ aviso("app-aviso", "Informe a data de fim.", "erro"); return; }
  const { data: atual } = await sb.from("computador_bordo_vinculos").select("id,motivo").eq("computador_id", _cpbEditId).is("fim", null).maybeSingle();
  if(!atual){ aviso("app-aviso", "Não há vínculo aberto.", "erro"); return; }
  const { error } = await sb.from("computador_bordo_vinculos").update({ fim, motivo: [atual.motivo, motivo ? "encerrado: " + motivo : null].filter(Boolean).join(" · ") || null }).eq("id", atual.id);
  if(error){ aviso("app-aviso", "Não foi possível encerrar: " + error.message, "erro"); return; }
  aviso("app-aviso", "Vínculo encerrado.", "ok");
  _cpbRegistros = null; await cpbAbrir(_cpbEditId); cpbAtivarTab("vinculos");
}
async function cpbSalvarCertificado(){
  if(!_cpbEditId || !cpbPodeOperar()) return;
  const valido = $("cpb-cal-valido").value;
  if(!valido){ aviso("app-aviso", "Informe a validade do certificado.", "erro"); return; }
  let arquivo_url = null;
  const f = $("cpb-cal-arquivo")?.files?.[0];
  if(f){
    const ext = (f.name.split(".").pop() || "").toLowerCase(), tipo = CPB_MIME[ext];
    if(!tipo){ aviso("app-aviso", "Arquivo do certificado: PDF, JPG, PNG ou WEBP.", "erro"); return; }
    // supabase-js ignora contentType quando o corpo é File: reembalar em Blob com o MIME da extensão
    const caminho = `${_cpbEditId}/${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from("computadores-bordo").upload(caminho, new Blob([await f.arrayBuffer()], { type: tipo }), { contentType: tipo });
    if(upErr){ aviso("app-aviso", "Não foi possível enviar o arquivo: " + upErr.message, "erro"); return; }
    arquivo_url = caminho;
  }
  const { error } = await sb.from("computador_bordo_calibracoes").insert({
    computador_id: _cpbEditId, numero_certificado: $("cpb-cal-numero").value.trim() || null, laboratorio: $("cpb-cal-lab").value.trim() || null,
    emitido_em: $("cpb-cal-emitido").value || null, valido_ate: valido, arquivo_url, observacoes: $("cpb-cal-obs").value.trim() || null
  });
  if(error){ aviso("app-aviso", "Não foi possível salvar o certificado: " + error.message, "erro"); return; }
  aviso("app-aviso", "Certificado registrado.", "ok");
  _cpbRegistros = null; await cpbAbrir(_cpbEditId); cpbAtivarTab("calibracao");
}
async function cpbAbrirCertificado(caminho){
  const { data, error } = await sb.storage.from("computadores-bordo").createSignedUrl(caminho, 300);
  if(error || !data?.signedUrl){ aviso("app-aviso", "Não foi possível abrir o certificado" + (error ? ": " + error.message : "."), "erro"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
/* "Sincronizar agora" (uma CPU) e "Descobrir IMEIs": function geodigitus-sync com o JWT do usuário */
async function cpbInvocarSync(corpo, rotulo){
  const { data, error } = await sb.functions.invoke("geodigitus-sync", { body: corpo });
  if(error){
    let msg = error.message;
    try { const j = await error.context?.json?.(); if(j?.error) msg = j.error; } catch(_){ /* corpo não é JSON */ }
    aviso("app-aviso", `${rotulo}: ${msg}`, "erro"); return null;
  }
  return data;
}
async function cpbSincronizarAgora(){
  if(!_cpbAtual?.imei || !cpbPodeSincronizar()) return;
  const d = await cpbInvocarSync({ acao: "sincronizar", imei: _cpbAtual.imei }, "Sincronização");
  if(!d) return;
  aviso("app-aviso", `Sincronização: ${d.arquivos_novos || 0} arquivo(s) novo(s), ${d.estacas_novas || 0} estaca(s), ${d.erros || 0} erro(s), ${d.requisicoes || 0} requisição(ões) (${((d.bytes || 0) / 1024).toFixed(1)} KB)${d.teto_atingido ? " — teto da rodada atingido, o resto fica para a próxima" : ""}.`, d.erros ? "aviso" : "ok");
  _cpbRegistros = null; await cpbAbrir(_cpbAtual.id); cpbAtivarTab("sincronizacao");
}
async function cpbDescobrir(){
  if(!cpbPodeOperar()) return;
  const d = await cpbInvocarSync({ acao: "descobrir" }, "Descobrir IMEIs");
  if(!d) return;
  aviso("app-aviso", `Balde lido: ${d.vistos || 0} IMEI(s), ${(d.desconhecidos || []).length} sem cadastro (${d.requisicoes || 0} requisições).`, "ok");
  _cpbRegistros = null; renderEquipamentos();
}
async function cpbIgnorarImei(pasta, imei){
  const motivo = prompt(`Ignorar o IMEI ${imei} (pasta ${pasta}) na lista do balde. Motivo (ex.: CPU antiga baixada, não é da CGL):`);
  if(motivo == null) return;
  const { error } = await sb.rpc("geodigitus_imei_ignorar", { p_pasta: pasta, p_imei: imei, p_motivo: motivo });
  if(error){ aviso("app-aviso", "Não foi possível ignorar: " + error.message, "erro"); return; }
  _cpbRegistros = null; renderEquipamentos();
}

/* ---------- na ficha da máquina: chip "CPU <imei>" e bloco Computador de bordo ---------- */
async function cpbPreencherMaquina(e){
  const box = $("eqp-chip-cpu-box"), bloco = $("eqp-cpb-bloco");
  if(box) box.style.display = "none";
  if(bloco) bloco.innerHTML = "";
  if(!e?.id) return;
  const { data, error } = await sb.from("vw_computadores_bordo").select("id,imei,status,vinculo_inicio,calibracao_situacao,calibracao_valido_ate,ultimo_dia_sincronizado,sync_estado").eq("equipamento_atual_id", e.id);
  if(error || (typeof _eqpAtual !== "undefined" && _eqpAtual?.id !== e.id)) return;
  const cpus = data || [];
  if(box && cpus.length){ box.style.display = ""; $("eqp-chip-cpu").textContent = cpus.map(c => "CPU " + c.imei).join(", "); }
  if(!bloco) return;
  bloco.innerHTML = cpus.length ? cpus.map(c => `<div class="meta clicavel" data-cpb-abrir="${esc(c.id)}" title="Abrir a ficha do computador de bordo">
      🖥️ <strong>CPU ${esc(c.imei)}</strong> desde ${dataBR(c.vinculo_inicio)} · calibração ${cpbTag(CPB_CAL, c.calibracao_situacao)}${c.calibracao_valido_ate ? " até " + dataBR(c.calibracao_valido_ate) : ""}
      · sincronização ${cpbTag(CPB_SYNC, c.sync_estado)}${c.ultimo_dia_sincronizado ? " (último dia " + dataBR(c.ultimo_dia_sincronizado) + ")" : ""}</div>`).join("")
    : `<p class="meta">Sem computador de bordo vinculado (a Geodigitus equipa só hélice contínua e secante).</p>`;
}

/* ---------- eventos ---------- */
function ligarComputadoresBordo(){
  if(!$("sec-equipamentos")) return;
  ["cpb-f-status", "cpb-f-cal"].forEach(id => $(id)?.addEventListener("change", () => { if(id === "cpb-f-cal") _cpbFiltroCal = $(id).value; if(_eqpView === "cpb") cpbRenderPainel(); }));
  $("cpb-busca")?.addEventListener("input", debounce(() => { if(_eqpView === "cpb") cpbRenderPainel(); }));
  $("btn-cpb-novo")?.addEventListener("click", () => cpbNova());
  $("btn-cpb-descobrir")?.addEventListener("click", () => comBotaoTravado("btn-cpb-descobrir", cpbDescobrir));
  $("eqp-kpi-cpu-box")?.addEventListener("click", () => cpbAbrirPainel("cpu_calibracao_vencida"));
  $("eqp-conteudo")?.addEventListener("click", (ev) => {
    if(typeof _eqpView === "undefined" || _eqpView !== "cpb") return;
    const cad = ev.target.closest("[data-cpb-cadastrar]");
    if(cad){ ev.stopPropagation(); cpbNova(cad.dataset.cpbCadastrar, cad.dataset.pasta); return; }
    const ign = ev.target.closest("[data-cpb-ignorar]");
    if(ign){ ev.stopPropagation(); cpbIgnorarImei(ign.dataset.pasta, ign.dataset.cpbIgnorar); return; }
    const tr = ev.target.closest("tr[data-cpb]");
    if(tr){ ev.stopPropagation(); cpbAbrir(tr.dataset.cpb); }
  }, true);
  $("eqp-cpb-bloco")?.addEventListener("click", (ev) => { const el = ev.target.closest("[data-cpb-abrir]"); if(el) cpbAbrir(el.dataset.cpbAbrir); });
  $("btn-cpb-voltar")?.addEventListener("click", () => cpbFecharFicha(true));
  $("btn-cpb-salvar")?.addEventListener("click", () => comBotaoTravado("btn-cpb-salvar", cpbSalvar));
  $("btn-cpb-sincronizar")?.addEventListener("click", () => comBotaoTravado("btn-cpb-sincronizar", cpbSincronizarAgora));
  $("btn-cpb-sincronizar2")?.addEventListener("click", () => comBotaoTravado("btn-cpb-sincronizar2", cpbSincronizarAgora));
  $("btn-cpb-vinc-iniciar")?.addEventListener("click", () => comBotaoTravado("btn-cpb-vinc-iniciar", cpbIniciarVinculo));
  $("btn-cpb-vinc-encerrar")?.addEventListener("click", () => comBotaoTravado("btn-cpb-vinc-encerrar", cpbEncerrarVinculo));
  $("btn-cpb-cal-salvar")?.addEventListener("click", () => comBotaoTravado("btn-cpb-cal-salvar", cpbSalvarCertificado));
  $("cpb-cal-lista")?.addEventListener("click", (ev) => { const b = ev.target.closest("[data-cpb-cert]"); if(b) cpbAbrirCertificado(b.dataset.cpbCert); });
  document.querySelectorAll("#cpb-notebook button").forEach(b => b.addEventListener("click", () => cpbAtivarTab(b.dataset.tab)));
  document.querySelectorAll("#cpb-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => cpbAtivarTab(b.dataset.gotoTab)));
  document.querySelectorAll("#cpb-statusbar .stage").forEach(st => st.addEventListener("click", () => cpbMudarStatus(st.dataset.status)));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarComputadoresBordo);
else ligarComputadoresBordo();

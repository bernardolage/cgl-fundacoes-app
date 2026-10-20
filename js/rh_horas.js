/* ====================================================================
   RH · HORAS E ALOCAÇÃO (fase 93c, 20/10/2026) — chamados #73, #74 e #76 da Jucirlene.
   Duas seções:
     sec-rhh "Horas e alocação" (prefixo rhh-): A liberar · Fechamento do mês · Alocação por obra
     sec-rhv "Minhas horas de viagem" (prefixo rhv-): o próprio funcionário lança (celular); o RH lança por ele
   Tudo que é regra nasce no banco (migration 20261020_fase93c_b_horas_alocacao.sql):
     rdo_equipe.horas_noturnas (gatilho, 22h–5h), liberado_em/liberado_por (RPCs rh_liberar_horas /
     rh_estornar_liberacao, quem pode = rh_horas_liberar(obra): engenheiro responsável, gestor do serviço,
     diretoria), horas_viagem (horas no gatilho; RPCs rh_liberar_horas_viagem / rh_estornar_liberacao_viagem),
     vw_rh_horas_mes (só liberadas; rh e diretor), rh_lancar_horas_folha (rh com MFA), vw_rh_alocacao_mes +
     rh_alocacoes (rh_alocacoes_materializar / rh_alocacoes_conferir).
   Aqui só leitura, seleção, chamada de RPC e exportação (.xlsx pelo SheetJS).
   ==================================================================== */

let _rhhView = "liberar";
let _rhhEquipe = [];        // rdo_equipe do período (rdo e funcionário embutidos)
let _rhhViagens = [];       // horas_viagem do período
let _rhhMes = [];           // vw_rh_horas_mes da competência
let _rhhAloc = [];          // vw_rh_alocacao_mes da competência
let _rhhPendMes = 0;        // linhas do RDO do mês ainda sem liberação (aviso no fechamento)
let _rhhPodeLiberar = {};   // obra_id → boolean (rh_horas_liberar no banco)
let _rhhSel = new Set();    // "e:<id>" (rdo_equipe) · "v:<id>" (horas_viagem) · "a:<alocacao_id ou func|obra>"
let _rhhPreset = null;      // vindo da Sala de Comando (rhhAbrirPreset)
let _rhhCarregando = false;

const RHH_LIBERAR_CARGOS = ["diretor", "admin", "engenheiro", "assistente_engenharia"];  // candidatos; a obra decide (rh_horas_liberar)
const RHH_CONFERIR_CARGOS = ["diretor", "admin", "rh", "logistica", "engenheiro", "assistente_engenharia"];
const RHH_FOLHA_CARGOS = ["diretor", "rh"];                                               // rh_lancar_horas_folha exige has_role('rh') + MFA
const RHV_RASTREIO_CARGOS = ["diretor", "admin", "rh", "logistica", "gestor_frota"];

function rhhCargo(){ return usuarioAtual?.cargo || ""; }
function rhhEhRhOuAdmin(){ return ["diretor", "admin", "rh"].includes(rhhCargo()); }
function rhhH(n){ const v = Number(n || 0); return v ? v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "—"; }
function rhhHz(n){ return Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function rhhHHMM(t){ return t ? String(t).slice(0, 5) : ""; }
function rhhMesAtual(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function rhhObraTxt(id, cod, nome){ return cod ? `${cod}${nome ? " — " + nome : ""}` : (id ? (mapaObras?.[id] || "obra") : "sem obra"); }

/* Período dos filtros: mês + quinzena (ou últimos 60 dias). Devolve { ini, fim, mesIni } em ISO. */
function rhhPeriodo(){
  const q = $("rhh-f-quinzena")?.value || "";
  if(q === "60"){
    const fim = hojeISO(); const d = new Date(fim + "T12:00:00"); d.setDate(d.getDate() - 60);
    return { ini: dataLocalISO(d), fim, mesIni: fim.slice(0, 7) + "-01" };
  }
  const mes = $("rhh-f-mes")?.value || rhhMesAtual();
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  const dd = (n) => `${mes}-${String(n).padStart(2, "0")}`;
  if(q === "1") return { ini: dd(1), fim: dd(15), mesIni: dd(1) };
  if(q === "2") return { ini: dd(16), fim: dd(ultimo), mesIni: dd(1) };
  return { ini: dd(1), fim: dd(ultimo), mesIni: dd(1) };
}

/* PostgREST pagina em 1.000 linhas: lê tudo em páginas. ajustar(q) recebe sb.from(tabela) e devolve a consulta. */
async function rhhLerTudo(tabela, ajustar, passo = 1000){
  const tudo = [];
  for(let de = 0; ; de += passo){
    const { data, error } = await ajustar(sb.from(tabela)).range(de, de + passo - 1);
    if(error) throw error;
    tudo.push(...(data || []));
    if(!data || data.length < passo) break;
  }
  return tudo;
}

/* ---------- filtros ---------- */
function rhhPreencherObras(){
  const sel = $("rhh-f-obra"); if(!sel) return;
  const atual = sel.value;
  const lista = (typeof _obrRegistros !== "undefined" && _obrRegistros.length ? _obrRegistros : [])
    .filter(o => ["em_andamento", "planejada", "paralisada", "concluida"].includes(o.status))
    .sort((a, b) => (a.status === "em_andamento" ? 0 : 1) - (b.status === "em_andamento" ? 0 : 1) || String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
  sel.innerHTML = `<option value="">Todas as obras</option>` + lista.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}${o.status !== "em_andamento" ? " (" + esc(STATUS.obra?.[o.status]?.label || o.status) + ")" : ""}</option>`).join("");
  if(atual) sel.value = atual;
}

/* Atalho da Sala de Comando ("Horas aguardando liberação há mais de 15 dias"): últimos 60 dias, só pendentes, a obra do aviso */
function rhhAbrirPreset(p){ _rhhPreset = p || null; }
function rhhAplicarPreset(){
  if(!_rhhPreset) return;
  const p = _rhhPreset; _rhhPreset = null;
  _rhhView = "liberar"; rhhMarcarView();
  if($("rhh-f-quinzena")) $("rhh-f-quinzena").value = "60";
  if($("rhh-f-situacao")) $("rhh-f-situacao").value = p.pendentes ? "pendente" : "";
  if($("rhh-f-extras")) $("rhh-f-extras").checked = true;
  if($("rhh-f-obra")) $("rhh-f-obra").value = (p.obraIds || []).length === 1 ? p.obraIds[0] : "";
}

function rhhMarcarView(){
  document.querySelectorAll("#rhh-painel .serv-view-btn[data-view]").forEach(b => b.classList.toggle("ativo", b.dataset.view === _rhhView));
  const mostra = (id, sim) => { const el = $(id); if(el) el.style.display = sim ? "" : "none"; };
  const leitura = typeof ehSomenteLeitura === "function" && ehSomenteLeitura();
  const liberar = _rhhView === "liberar", aloc = _rhhView === "alocacao", fech = _rhhView === "fechamento";
  mostra("btn-rhh-liberar", liberar && !leitura);
  mostra("btn-rhh-estornar", liberar && !leitura);
  mostra("btn-rhh-materializar", aloc && !leitura && RHH_CONFERIR_CARGOS.includes(rhhCargo()));
  mostra("btn-rhh-conferir", aloc && !leitura && RHH_CONFERIR_CARGOS.includes(rhhCargo()));
  mostra("btn-rhh-desconferir", aloc && !leitura && RHH_CONFERIR_CARGOS.includes(rhhCargo()));
  mostra("btn-rhh-folha", fech && !leitura && RHH_FOLHA_CARGOS.includes(rhhCargo()));
  // quinzena só faz sentido em "A liberar"; fechamento e alocação são por competência
  const q = $("rhh-f-quinzena"); if(q){ q.disabled = !liberar; if(!liberar && q.value) q.value = ""; }
  const s = $("rhh-f-situacao"); if(s) s.disabled = !liberar;
  const x = $("rhh-f-extras"); if(x) x.disabled = !liberar;
}

/* ---------- carga ---------- */
async function carregarRhh(){
  if(_rhhCarregando) return;
  _rhhCarregando = true;
  const cont = $("rhh-conteudo");
  try{
    if($("rhh-f-mes") && !$("rhh-f-mes").value) $("rhh-f-mes").value = rhhMesAtual();
    rhhPreencherObras();
    rhhAplicarPreset();
    rhhMarcarView();
    _rhhSel.clear();
    if(cont) cont.innerHTML = `<p class="vazio">Carregando…</p>`;
    if(_rhhView === "liberar") await rhhCarregarLiberar();
    else if(_rhhView === "fechamento") await rhhCarregarFechamento();
    else await rhhCarregarAlocacao();
  }catch(e){
    console.error("Horas e alocação:", e);
    if(cont) cont.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(e.message || "erro")}).</p>`;
  }finally{ _rhhCarregando = false; }
}

async function rhhCarregarLiberar(){
  const { ini, fim } = rhhPeriodo();
  const obraId = $("rhh-f-obra")?.value || "";
  const [eq, vg] = await Promise.all([
    rhhLerTudo("rdo_equipe", q => {
      let x = q.select("id,funcionario_id,funcao_no_dia,hora_entrada,hora_saida,intervalo_minutos,horas_normais,horas_100,horas_noturnas,horas_noturnas_manual,liberado_em,liberado_por,rdo:rdo!inner(id,data,obra_id,feriado,tipo_servico),funcionario:funcionarios(nome,matricula,funcao)")
        .gte("rdo.data", ini).lte("rdo.data", fim).not("funcionario_id", "is", null).order("id");
      if(obraId) x = x.eq("rdo.obra_id", obraId);
      return x;
    }),
    rhhLerTudo("horas_viagem", q => {
      let x = q.select("id,funcionario_id,data,origem,destino,obra_id,hora_saida,hora_chegada,horas,veiculo_id,viagem_id,sozinho,rastreio_conferido,liberado_em,liberado_por,observacoes,funcionario:funcionarios(nome,matricula,funcao),veiculo:equipamentos(codigo,placa)")
        .gte("data", ini).lte("data", fim).order("data");
      if(obraId) x = x.eq("obra_id", obraId);
      return x;
    })
  ]);
  _rhhEquipe = eq; _rhhViagens = vg;
  // quem pode liberar em cada obra do período (uma pergunta ao banco por obra, guardada)
  const obras = [...new Set(eq.map(e => e.rdo?.obra_id).concat(vg.map(v => v.obra_id)).filter(Boolean))];
  await Promise.all(obras.filter(o => _rhhPodeLiberar[o] === undefined).map(async o => {
    const { data } = await sb.rpc("rh_horas_liberar", { p_obra: o });
    _rhhPodeLiberar[o] = !!data;
  }));
  renderRhhLiberar();
}

/* Linhas unificadas (RDO + viagem) do período, já filtradas pela tela */
function rhhLinhas(){
  const busca = ($("rhh-busca")?.value || "").trim().toLowerCase();
  const sit = $("rhh-f-situacao")?.value || "";
  const soExtras = !!$("rhh-f-extras")?.checked;
  const linhas = _rhhEquipe.map(e => ({
    k: "e:" + e.id, tipo: "rdo", id: e.id, funcionario_id: e.funcionario_id,
    nome: e.funcionario?.nome || "?", matricula: e.funcionario?.matricula || "", funcao: e.funcionario?.funcao || "",
    data: e.rdo?.data, obra_id: e.rdo?.obra_id, feriado: !!e.rdo?.feriado,
    horario: e.hora_entrada && e.hora_saida ? `${rhhHHMM(e.hora_entrada)}–${rhhHHMM(e.hora_saida)}${rhhHHMM(e.hora_saida) <= rhhHHMM(e.hora_entrada) ? " (+1 dia)" : ""}` : "—",
    normais: Number(e.horas_normais || 0), he: Number(e.horas_100 || 0), noturnas: Number(e.horas_noturnas || 0), viagem: 0,
    manual: !!e.horas_noturnas_manual, liberado_em: e.liberado_em,
    podeLiberar: !!_rhhPodeLiberar[e.rdo?.obra_id]
  })).concat(_rhhViagens.map(v => ({
    k: "v:" + v.id, tipo: "viagem", id: v.id, funcionario_id: v.funcionario_id,
    nome: v.funcionario?.nome || "?", matricula: v.funcionario?.matricula || "", funcao: v.funcionario?.funcao || "",
    data: v.data, obra_id: v.obra_id, feriado: false,
    horario: `${rhhHHMM(v.hora_saida)}–${rhhHHMM(v.hora_chegada)} · ${v.origem || "?"} → ${v.destino || (v.obra_id ? (mapaObras?.[v.obra_id] || "obra") : "?")}${v.veiculo ? " · " + v.veiculo.codigo : ""}`,
    normais: 0, he: 0, noturnas: 0, viagem: Number(v.horas || 0),
    rastreio: !!v.rastreio_conferido, sozinho: v.sozinho !== false, liberado_em: v.liberado_em,
    podeLiberar: v.obra_id ? (!!_rhhPodeLiberar[v.obra_id] || rhhEhRhOuAdmin()) : rhhEhRhOuAdmin()
  })));
  return linhas.filter(l => {
    if(sit === "pendente" && l.liberado_em) return false;
    if(sit === "liberada" && !l.liberado_em) return false;
    if(soExtras && !(l.he > 0 || l.noturnas > 0 || l.viagem > 0)) return false;
    if(busca){
      const alvo = `${l.nome} ${l.matricula} ${l.funcao} ${mapaObras?.[l.obra_id] || ""} ${l.horario}`.toLowerCase();
      if(!alvo.includes(busca)) return false;
    }
    return true;
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || String(a.data).localeCompare(String(b.data)) || (a.tipo === "rdo" ? -1 : 1));
}

function rhhSituacaoTag(l){
  if(l.liberado_em) return `<span class="tag verde" title="Liberada para a folha">liberada ${esc(dataBR(String(l.liberado_em).slice(0, 10)))}</span>`;
  const dias = Math.floor((new Date(hojeISO() + "T12:00:00") - new Date(l.data + "T12:00:00")) / 86400000);
  return `<span class="tag ${dias > 15 ? "vermelho" : "ambar"}" title="${dias > 15 ? "Há mais de 15 dias sem liberação" : "Aguardando liberação"}">a liberar${dias > 15 ? " · " + dias + " d" : ""}</span>`;
}

function renderRhhLiberar(){
  const cont = $("rhh-conteudo"); if(!cont) return;
  const linhas = rhhLinhas();
  const total = _rhhEquipe.length + _rhhViagens.length;
  if($("rhh-contador")) $("rhh-contador").textContent = `${linhas.length} de ${total}`;
  const soma = (f) => linhas.reduce((s, l) => s + f(l), 0);
  const kpi = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  kpi("rhh-kpi-linhas", linhas.length);
  kpi("rhh-kpi-he", rhhHz(soma(l => l.he)));
  kpi("rhh-kpi-not", rhhHz(soma(l => l.noturnas)));
  kpi("rhh-kpi-viag", rhhHz(soma(l => l.viagem)));
  kpi("rhh-kpi-pend", linhas.filter(l => !l.liberado_em).length);
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">Nenhuma hora no período com esses filtros. As horas vêm da equipe do Diário de Obra (entrada e saída) e de "Minhas horas de viagem".</p>`; return; }
  const leitura = typeof ehSomenteLeitura === "function" && ehSomenteLeitura();
  const semPermissao = linhas.some(l => !l.podeLiberar);
  // agrupado por funcionário, com subtotal e caixa que seleciona o grupo
  const grupos = new Map();
  linhas.forEach(l => { if(!grupos.has(l.funcionario_id)) grupos.set(l.funcionario_id, []); grupos.get(l.funcionario_id).push(l); });
  let html = `<div class="tabela-rola"><table><thead><tr>
    <th style="width:28px;"><input type="checkbox" id="rhh-sel-todos" title="Selecionar tudo que você pode liberar/estornar" /></th>
    <th>Funcionário</th><th>Dia</th><th>Obra</th><th>Horário / trajeto</th>
    <th class="num" title="Horas normais da linha do diário (quando gravadas)">Normais</th><th class="num">HE 100 %</th><th class="num" title="22h–5h">Noturnas</th><th class="num">Viagem</th><th>Situação</th>
  </tr></thead><tbody>`;
  for(const [fid, ls] of grupos){
    const g = ls[0];
    const selecionaveis = ls.filter(l => l.podeLiberar);
    html += `<tr class="rhh-grupo"><td>${selecionaveis.length ? `<input type="checkbox" class="rhh-sel-grupo" data-fid="${esc(fid)}" title="Selecionar as linhas de ${esc(g.nome)}" />` : ""}</td>
      <td colspan="4"><strong>${esc(g.nome)}</strong> <span class="meta">${esc([g.matricula, g.funcao].filter(Boolean).join(" · "))}</span> <span class="meta">· ${ls.length} linha(s), ${ls.filter(l => !l.liberado_em).length} a liberar</span></td>
      <td class="num"><strong>${rhhH(ls.reduce((s, l) => s + l.normais, 0))}</strong></td><td class="num"><strong>${rhhH(ls.reduce((s, l) => s + l.he, 0))}</strong></td>
      <td class="num"><strong>${rhhH(ls.reduce((s, l) => s + l.noturnas, 0))}</strong></td><td class="num"><strong>${rhhH(ls.reduce((s, l) => s + l.viagem, 0))}</strong></td><td></td></tr>`;
    ls.forEach(l => {
      html += `<tr data-k="${esc(l.k)}" class="${l.liberado_em ? "rhh-liberada" : ""}">
        <td>${l.podeLiberar ? `<input type="checkbox" class="rhh-sel" data-k="${esc(l.k)}" data-fid="${esc(fid)}" ${_rhhSel.has(l.k) ? "checked" : ""} />` : `<span title="Você não libera horas desta obra (engenheiro responsável, gestor do serviço ou diretoria)">·</span>`}</td>
        <td class="meta">${l.tipo === "viagem" ? '<span class="tag azul" title="Hora de viagem lançada pelo funcionário">viagem</span>' : (l.feriado ? '<span class="tag cinza">feriado</span>' : "")}</td>
        <td>${esc(dataBR(l.data))}</td>
        <td>${linkObra(l.obra_id, l.obra_id ? (mapaObras?.[l.obra_id] || "obra") : "—")}</td>
        <td>${esc(l.horario)}${l.manual ? ' <span class="meta" title="Noturnas corrigidas à mão no diário">✎</span>' : ""}${l.tipo === "viagem" && l.rastreio ? ' <span class="tag verde" title="Rastreio do veículo conferido">rastreio ok</span>' : ""}${l.tipo === "viagem" && !l.sozinho ? ' <span class="tag cinza">equipe</span>' : ""}</td>
        <td class="num">${rhhH(l.normais)}</td><td class="num">${rhhH(l.he)}</td><td class="num">${rhhH(l.noturnas)}</td><td class="num">${rhhH(l.viagem)}</td>
        <td>${rhhSituacaoTag(l)}</td></tr>`;
    });
  }
  html += `</tbody></table></div>`;
  if(semPermissao && !leitura) html += `<p class="nota">Linhas com "·" são de obras que você não libera: só o engenheiro responsável da obra, o gestor do serviço (Sergio para raiz; Pedro para hélice, secante e trado) ou a diretoria liberam.</p>`;
  cont.innerHTML = html;
  // seleção
  cont.querySelectorAll(".rhh-sel").forEach(cb => cb.addEventListener("change", () => { if(cb.checked) _rhhSel.add(cb.dataset.k); else _rhhSel.delete(cb.dataset.k); rhhAtualizarBotoes(); }));
  cont.querySelectorAll(".rhh-sel-grupo").forEach(cb => cb.addEventListener("change", () => {
    cont.querySelectorAll(`.rhh-sel[data-fid="${cb.dataset.fid}"]`).forEach(x => { x.checked = cb.checked; if(cb.checked) _rhhSel.add(x.dataset.k); else _rhhSel.delete(x.dataset.k); });
    rhhAtualizarBotoes();
  }));
  $("rhh-sel-todos")?.addEventListener("change", (e) => {
    cont.querySelectorAll(".rhh-sel").forEach(x => { x.checked = e.target.checked; if(e.target.checked) _rhhSel.add(x.dataset.k); else _rhhSel.delete(x.dataset.k); });
    cont.querySelectorAll(".rhh-sel-grupo").forEach(x => x.checked = e.target.checked);
    rhhAtualizarBotoes();
  });
  rhhAtualizarBotoes();
}

function rhhAtualizarBotoes(){
  const linhas = _rhhView === "liberar" ? rhhLinhas() : [];
  const sel = linhas.filter(l => _rhhSel.has(l.k));
  const pend = sel.filter(l => !l.liberado_em).length, lib = sel.filter(l => l.liberado_em).length;
  const b1 = $("btn-rhh-liberar"), b2 = $("btn-rhh-estornar");
  if(b1){ b1.disabled = !pend; b1.textContent = pend ? `✅ Liberar ${pend} selecionada(s)` : "✅ Liberar selecionadas"; }
  if(b2){ b2.disabled = !lib; b2.textContent = lib ? `↩ Estornar ${lib}` : "↩ Estornar"; }
  if(_rhhView === "alocacao"){
    const n = [..._rhhSel].filter(k => k.startsWith("a:")).length;
    const c = $("btn-rhh-conferir"), d = $("btn-rhh-desconferir");
    if(c){ c.disabled = !n; c.textContent = n ? `✅ Conferir ${n} selecionada(s)` : "✅ Conferir selecionadas"; }
    if(d) d.disabled = !n;
  }
}

/* Libera (ou estorna) as linhas selecionadas: RPCs do RDO e das viagens, cada uma com sua checagem no banco */
async function rhhLiberar(estornar){
  const linhas = rhhLinhas().filter(l => _rhhSel.has(l.k) && (estornar ? !!l.liberado_em : !l.liberado_em));
  if(!linhas.length){ aviso("app-aviso", estornar ? "Selecione linhas já liberadas para estornar." : "Selecione linhas pendentes para liberar.", "erro"); return; }
  const eIds = linhas.filter(l => l.tipo === "rdo").map(l => l.id);
  const vIds = linhas.filter(l => l.tipo === "viagem").map(l => l.id);
  const horas = linhas.reduce((s, l) => s + l.he + l.noturnas + l.viagem, 0);
  const txt = `${estornar ? "Estornar a liberação de" : "Liberar para a folha"} ${linhas.length} linha(s) (${rhhHz(horas)} h de HE, noturnas e viagem) de ${new Set(linhas.map(l => l.funcionario_id)).size} funcionário(s)?`;
  if(!confirm(txt)) return;
  let n = 0, erro = null;
  if(eIds.length){
    const r = await sb.rpc(estornar ? "rh_estornar_liberacao" : "rh_liberar_horas", { p_ids: eIds });
    if(r.error) erro = r.error; else n += Number(r.data || 0);
  }
  if(!erro && vIds.length){
    const r = await sb.rpc(estornar ? "rh_estornar_liberacao_viagem" : "rh_liberar_horas_viagem", { p_ids: vIds });
    if(r.error) erro = r.error; else n += Number(r.data || 0);
  }
  if(erro){ aviso("app-aviso", (estornar ? "Não foi possível estornar: " : "Não foi possível liberar: ") + erro.message, "erro"); }
  else aviso("app-aviso", `${n} linha(s) ${estornar ? "estornada(s)" : "liberada(s) para a folha"}.`, "ok");
  _rhhSel.clear();
  await carregarRhh();
  if(typeof carregarDashPendencias === "function") carregarDashPendencias().catch(() => {});
}

/* ---------- Fechamento do mês (vw_rh_horas_mes: só liberadas) ---------- */
async function rhhCarregarFechamento(){
  const { mesIni } = rhhPeriodo();
  const obraId = $("rhh-f-obra")?.value || "";
  if(!["diretor", "rh"].includes(rhhCargo())){   // vw_rh_horas_mes é has_role('rh'): diretor e rh (o auditor não lê folha)
    _rhhMes = [];
    $("rhh-conteudo").innerHTML = `<p class="vazio">O fechamento do mês (horas liberadas por funcionário e obra) é do RH e da diretoria. Use "A liberar" para ver e liberar as horas das suas obras.</p>`;
    if($("rhh-contador")) $("rhh-contador").textContent = "";
    return;
  }
  const [mes, pend] = await Promise.all([
    rhhLerTudo("vw_rh_horas_mes", q => { let x = q.select("*").eq("competencia", mesIni).order("funcionario"); if(obraId) x = x.eq("obra_id", obraId); return x; }),
    (async () => {
      const [a, m] = mesIni.split("-").map(Number); const fim = `${mesIni.slice(0, 7)}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
      let x = sb.from("rdo_equipe").select("id,rdo:rdo!inner(data,obra_id)", { count: "exact", head: true }).gte("rdo.data", mesIni).lte("rdo.data", fim).is("liberado_em", null).not("funcionario_id", "is", null);
      if(obraId) x = x.eq("rdo.obra_id", obraId);
      const r = await x; return r.count || 0;
    })()
  ]);
  _rhhMes = mes; _rhhPendMes = pend;
  renderRhhFechamento();
}

function rhhMesFiltrado(){
  const busca = ($("rhh-busca")?.value || "").trim().toLowerCase();
  return _rhhMes.filter(r => !busca || `${r.funcionario} ${r.matricula || ""} ${r.funcao || ""} ${r.obra_codigo || ""} ${r.obra_nome || ""} ${r.cno || ""}`.toLowerCase().includes(busca))
    .sort((a, b) => String(a.funcionario).localeCompare(String(b.funcionario), "pt-BR") || String(a.obra_codigo || "").localeCompare(String(b.obra_codigo || ""), "pt-BR", { numeric: true }));
}

function renderRhhFechamento(){
  const cont = $("rhh-conteudo"); if(!cont) return;
  const linhas = rhhMesFiltrado();
  if($("rhh-contador")) $("rhh-contador").textContent = `${linhas.length} de ${_rhhMes.length}`;
  const soma = (c) => linhas.reduce((s, r) => s + Number(r[c] || 0), 0);
  const kpi = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  kpi("rhh-kpi-linhas", linhas.length); kpi("rhh-kpi-he", rhhHz(soma("horas_100"))); kpi("rhh-kpi-not", rhhHz(soma("horas_noturnas"))); kpi("rhh-kpi-viag", rhhHz(soma("horas_viagem"))); kpi("rhh-kpi-pend", _rhhPendMes);
  const { mesIni } = rhhPeriodo();
  const comp = new Date(mesIni + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  let html = _rhhPendMes ? `<div class="aviso atencao" style="display:block;">⚠️ ${_rhhPendMes} linha(s) da equipe do RDO de ${esc(comp)} ainda sem liberação não entram aqui nem em "Lançar na folha". Peça a liberação em "A liberar".</div>` : "";
  if(!linhas.length){ cont.innerHTML = html + `<p class="vazio">Nenhuma hora liberada em ${esc(comp)}.</p>`; return; }
  html += `<div class="tabela-rola"><table><thead><tr><th>Funcionário</th><th>Matr.</th><th>Função</th><th>Obra</th><th title="Cadastro Nacional de Obras do cliente">CNO</th><th class="num">Dias</th><th class="num">Normais</th><th class="num">HE 100 %</th><th class="num">Noturnas</th><th class="num">Viagem</th></tr></thead><tbody>`;
  let ultimo = null;
  linhas.forEach(r => {
    const primeiro = r.funcionario_id !== ultimo; ultimo = r.funcionario_id;
    html += `<tr><td>${primeiro ? `<strong>${esc(r.funcionario)}</strong>` : ""}</td><td class="meta">${primeiro ? esc(r.matricula || "") : ""}</td><td class="meta">${primeiro ? esc(r.funcao || "") : ""}</td>
      <td>${linkObra(r.obra_id, rhhObraTxt(r.obra_id, r.obra_codigo, r.obra_nome))}</td><td>${r.cno ? esc(r.cno) : (r.obra_id ? '<span class="tag ambar" title="Obra sem CNO: preencha em Obra › Parâmetros">sem CNO</span>' : "—")}</td>
      <td class="num">${r.dias || "—"}</td><td class="num">${rhhH(r.horas_normais)}</td><td class="num">${rhhH(r.horas_100)}</td><td class="num">${rhhH(r.horas_noturnas)}</td><td class="num">${rhhH(r.horas_viagem)}</td></tr>`;
  });
  html += `</tbody><tfoot><tr><th colspan="5">Total · ${new Set(linhas.map(r => r.funcionario_id)).size} funcionário(s)</th><th class="num">${soma("dias") || "—"}</th><th class="num">${rhhHz(soma("horas_normais"))}</th><th class="num">${rhhHz(soma("horas_100"))}</th><th class="num">${rhhHz(soma("horas_noturnas"))}</th><th class="num">${rhhHz(soma("horas_viagem"))}</th></tr></tfoot></table></div>`;
  cont.innerHTML = html;
}

/* "Lançar na folha": rh_lancar_horas_folha(competência) grava he_100, adicional_noturno e horas_viagem em folha_lancamentos
   (origem rh_horas, substituído a cada clique; lançamento manual não é tocado). Exige rh com MFA na sessão. */
async function rhhLancarFolha(){
  const { mesIni } = rhhPeriodo();
  const comp = new Date(mesIni + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const funcs = new Set(_rhhMes.map(r => r.funcionario_id)).size;
  if(!_rhhMes.length){ aviso("app-aviso", `Nenhuma hora liberada em ${comp} para lançar.`, "erro"); return; }
  if(!confirm(`Lançar na folha de ${comp} as horas liberadas de ${funcs} funcionário(s)?\n\nRubricas HE 100 %, adicional noturno e horas de viagem, por funcionário e obra. O que este botão gerou antes para esta competência é substituído; lançamento manual não muda.${_rhhPendMes ? `\n\nAtenção: ${_rhhPendMes} linha(s) do RDO ainda sem liberação ficam de fora.` : ""}`)) return;
  await comBotaoTravado("btn-rhh-folha", async () => {
    const { data, error } = await sb.rpc("rh_lancar_horas_folha", { p_competencia: mesIni });
    if(error){
      if(/dois fatores|mfa/i.test(error.message || "") || error.hint === "mfa_obrigatorio") aviso("app-aviso", "Lançar na folha exige autenticação em dois fatores nesta sessão: saia e entre de novo concluindo o MFA.", "erro");
      else aviso("app-aviso", "Não foi possível lançar na folha: " + error.message, "erro");
      return;
    }
    const d = data || {};
    aviso("app-aviso", `Folha de ${comp}: ${d.lancamentos || 0} lançamento(s) para ${d.funcionarios || 0} funcionário(s) — HE ${rhhHz(d.horas_100)} h, noturnas ${rhhHz(d.horas_noturnas)} h, viagem ${rhhHz(d.horas_viagem)} h${d.sem_salario ? ` · ${d.sem_salario} sem salário cadastrado (valor zerado, horas gravadas)` : ""}.`, "ok");
  });
}

/* ---------- Alocação por obra (vw_rh_alocacao_mes + rh_alocacoes) ---------- */
async function rhhCarregarAlocacao(){
  const { mesIni } = rhhPeriodo();
  const obraId = $("rhh-f-obra")?.value || "";
  _rhhAloc = await rhhLerTudo("vw_rh_alocacao_mes", q => { let x = q.select("*").eq("competencia", mesIni).order("obra_codigo").order("funcionario"); if(obraId) x = x.eq("obra_id", obraId); return x; });
  renderRhhAlocacao();
}

function rhhAlocKey(r){ return "a:" + (r.alocacao_id || `${r.funcionario_id}|${r.obra_id}`); }
function rhhAlocFiltrada(){
  const busca = ($("rhh-busca")?.value || "").trim().toLowerCase();
  return _rhhAloc.filter(r => !busca || `${r.funcionario} ${r.matricula || ""} ${r.funcao || ""} ${r.obra_codigo || ""} ${r.obra_nome || ""} ${r.cno || ""} ${r.equipamento_codigo || ""}`.toLowerCase().includes(busca))
    .sort((a, b) => String(a.obra_codigo || "").localeCompare(String(b.obra_codigo || ""), "pt-BR", { numeric: true }) || String(a.funcionario).localeCompare(String(b.funcionario), "pt-BR"));
}
function rhhDivergencias(r){
  const t = [];
  if(Number(r.dias_duas_obras) > 0) t.push(`<span class="tag ambar" title="Dias do mês em que o funcionário aparece em diários de duas obras">${r.dias_duas_obras} dia(s) em 2 obras</span>`);
  if(Number(r.dias_uteis_sem_diario) > 0) t.push(`<span class="tag cinza" title="Dias úteis entre o primeiro e o último diário do mês sem presença em nenhum diário">${r.dias_uteis_sem_diario} dia(s) útil(eis) sem diário</span>`);
  return t.join(" ") || "—";
}

function renderRhhAlocacao(){
  const cont = $("rhh-conteudo"); if(!cont) return;
  const linhas = rhhAlocFiltrada();
  if($("rhh-contador")) $("rhh-contador").textContent = `${linhas.length} de ${_rhhAloc.length}`;
  const kpi = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  kpi("rhh-kpi-linhas", linhas.length); kpi("rhh-kpi-he", "—"); kpi("rhh-kpi-not", "—"); kpi("rhh-kpi-viag", "—");
  kpi("rhh-kpi-pend", linhas.filter(r => !r.conferido_em).length);
  const { mesIni } = rhhPeriodo();
  const comp = new Date(mesIni + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">Nenhuma presença em diário em ${esc(comp)}. A alocação nasce da equipe do Diário de Obra.</p>`; return; }
  const podeConferir = RHH_CONFERIR_CARGOS.includes(rhhCargo()) && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
  const naoMaterializadas = linhas.filter(r => !r.alocacao_id).length;
  let html = naoMaterializadas && podeConferir ? `<p class="nota">${naoMaterializadas} linha(s) ainda não gravadas em rh_alocacoes: "Conferir" grava a competência antes de marcar (ou use "Recalcular alocação").</p>` : "";
  html += `<div class="tabela-rola"><table><thead><tr>
    <th style="width:28px;">${podeConferir ? '<input type="checkbox" id="rhh-sel-todos" title="Selecionar tudo" />' : ""}</th>
    <th>Funcionário</th><th>Matr.</th><th>Função</th><th>Período na obra</th><th class="num">Dias</th><th>Equipamento</th><th>Divergências</th><th>Conferido</th>
  </tr></thead><tbody>`;
  const grupos = new Map();
  linhas.forEach(r => { const k = r.obra_id || "sem"; if(!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); });
  for(const [oid, ls] of grupos){
    const g = ls[0];
    html += `<tr class="rhh-grupo"><td>${podeConferir ? `<input type="checkbox" class="rhh-sel-grupo" data-fid="${esc(oid)}" title="Selecionar a obra inteira" />` : ""}</td>
      <td colspan="8"><strong>${linkObra(g.obra_id, rhhObraTxt(g.obra_id, g.obra_codigo, g.obra_nome))}</strong>
        · CNO ${g.cno ? `<strong>${esc(g.cno)}</strong>` : '<span class="tag ambar" title="Preencha em Obra › Parâmetros">sem CNO</span>'}
        <span class="meta">· ${ls.length} funcionário(s), ${ls.filter(r => r.conferido_em).length} conferido(s)</span></td></tr>`;
    ls.forEach(r => {
      const k = rhhAlocKey(r);
      html += `<tr data-k="${esc(k)}">
        <td>${podeConferir ? `<input type="checkbox" class="rhh-sel" data-k="${esc(k)}" data-fid="${esc(oid)}" ${_rhhSel.has(k) ? "checked" : ""} />` : ""}</td>
        <td><strong>${esc(r.funcionario)}</strong></td><td class="meta">${esc(r.matricula || "")}</td><td class="meta">${esc(r.funcao || "")}</td>
        <td>${esc(dataBR(r.primeiro_dia))}${r.ultimo_dia !== r.primeiro_dia ? " – " + esc(dataBR(r.ultimo_dia)) : ""}</td>
        <td class="num">${r.dias}</td><td>${esc(r.equipamento_codigo || "—")}</td><td>${rhhDivergencias(r)}</td>
        <td>${r.conferido_em ? `<span class="tag verde" title="${esc(r.conferido_por_nome || "")}">conferida ${esc(dataBR(String(r.conferido_em).slice(0, 10)))}</span>` : '<span class="tag cinza">a conferir</span>'}</td></tr>`;
    });
  }
  html += `</tbody></table></div>`;
  cont.innerHTML = html;
  cont.querySelectorAll(".rhh-sel").forEach(cb => cb.addEventListener("change", () => { if(cb.checked) _rhhSel.add(cb.dataset.k); else _rhhSel.delete(cb.dataset.k); rhhAtualizarBotoes(); }));
  cont.querySelectorAll(".rhh-sel-grupo").forEach(cb => cb.addEventListener("change", () => {
    cont.querySelectorAll(`.rhh-sel[data-fid="${cb.dataset.fid}"]`).forEach(x => { x.checked = cb.checked; if(cb.checked) _rhhSel.add(x.dataset.k); else _rhhSel.delete(x.dataset.k); });
    rhhAtualizarBotoes();
  }));
  $("rhh-sel-todos")?.addEventListener("change", (e) => {
    cont.querySelectorAll(".rhh-sel").forEach(x => { x.checked = e.target.checked; if(e.target.checked) _rhhSel.add(x.dataset.k); else _rhhSel.delete(x.dataset.k); });
    cont.querySelectorAll(".rhh-sel-grupo").forEach(x => x.checked = e.target.checked);
    rhhAtualizarBotoes();
  });
  rhhAtualizarBotoes();
}

async function rhhMaterializar(silencioso){
  const { mesIni } = rhhPeriodo();
  const { data, error } = await sb.rpc("rh_alocacoes_materializar", { p_competencia: mesIni });
  if(error){ aviso("app-aviso", "Não foi possível recalcular a alocação: " + error.message, "erro"); return null; }
  if(!silencioso) aviso("app-aviso", `Alocação recalculada: ${data?.linhas || 0} linha(s), ${data?.conferidas || 0} conferida(s), ${data?.sem_cno || 0} sem CNO${data?.removidas ? `, ${data.removidas} removida(s)` : ""}.`, "ok");
  return data;
}

/* Conferir (ou desfazer) as linhas selecionadas; linhas ainda não materializadas são gravadas antes */
async function rhhConferir(desfazer){
  const sel = rhhAlocFiltrada().filter(r => _rhhSel.has(rhhAlocKey(r)));
  if(!sel.length){ aviso("app-aviso", "Selecione as linhas da alocação.", "erro"); return; }
  if(sel.some(r => !r.alocacao_id)){
    const m = await rhhMaterializar(true); if(!m) return;
    const { mesIni } = rhhPeriodo();
    const { data, error } = await sb.from("rh_alocacoes").select("id,funcionario_id,obra_id").eq("competencia", mesIni);
    if(error){ aviso("app-aviso", "Não foi possível ler a alocação gravada: " + error.message, "erro"); return; }
    const mapa = new Map((data || []).map(a => [`${a.funcionario_id}|${a.obra_id}`, a.id]));
    sel.forEach(r => { if(!r.alocacao_id) r.alocacao_id = mapa.get(`${r.funcionario_id}|${r.obra_id}`) || null; });
  }
  const ids = sel.map(r => r.alocacao_id).filter(Boolean);
  if(!ids.length){ aviso("app-aviso", "Nada para conferir.", "erro"); return; }
  const { data, error } = await sb.rpc("rh_alocacoes_conferir", { p_ids: ids, p_desfazer: !!desfazer });
  if(error){ aviso("app-aviso", "Não foi possível conferir: " + error.message, "erro"); return; }
  aviso("app-aviso", `${data || 0} linha(s) ${desfazer ? "voltaram para 'a conferir'" : "conferida(s)"}.`, "ok");
  _rhhSel.clear();
  await carregarRhh();
}

/* ---------- exportação (.xlsx) ---------- */
function rhhExportar(){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
  const { ini, fim, mesIni } = rhhPeriodo();
  const mes = mesIni.slice(0, 7);
  const num = (v) => Number(v || 0);
  let aoa, nome, aba;
  if(_rhhView === "liberar"){
    const linhas = rhhLinhas();
    if(!linhas.length){ aviso("app-aviso", "Nada para exportar.", "erro"); return; }
    aoa = [["Funcionário", "Matrícula", "Função", "Dia", "Obra", "Origem", "Horário / trajeto", "Normais", "HE 100 %", "Noturnas", "Viagem", "Situação", "Liberada em"]]
      .concat(linhas.map(l => [l.nome, l.matricula, l.funcao, dataBR(l.data), l.obra_id ? (mapaObras?.[l.obra_id] || "") : "", l.tipo === "viagem" ? "Viagem" : "RDO", l.horario, num(l.normais), num(l.he), num(l.noturnas), num(l.viagem), l.liberado_em ? "liberada" : "a liberar", l.liberado_em ? dataBR(String(l.liberado_em).slice(0, 10)) : ""]));
    nome = `horas-a-liberar-${ini}-a-${fim}.xlsx`; aba = "HORAS";
  } else if(_rhhView === "fechamento"){
    const linhas = rhhMesFiltrado();
    if(!linhas.length){ aviso("app-aviso", "Nada para exportar.", "erro"); return; }
    aoa = [["Competência", "Matrícula", "Funcionário", "Função", "Obra", "CNO", "Dias", "Normais", "HE 100 %", "Noturnas", "Viagem"]]
      .concat(linhas.map(r => [mes, r.matricula || "", r.funcionario, r.funcao || "", rhhObraTxt(r.obra_id, r.obra_codigo, r.obra_nome), r.cno || "", num(r.dias), num(r.horas_normais), num(r.horas_100), num(r.horas_noturnas), num(r.horas_viagem)]));
    nome = `fechamento-horas-${mes}.xlsx`; aba = "FECHAMENTO";
  } else {
    const linhas = rhhAlocFiltrada();
    if(!linhas.length){ aviso("app-aviso", "Nada para exportar.", "erro"); return; }
    aoa = [["Competência", "Matrícula", "Funcionário", "Função", "Obra", "CNO", "Primeiro dia", "Último dia", "Dias", "Equipamento", "Dias em 2 obras", "Dias úteis sem diário", "Conferido em", "Conferido por"]]
      .concat(linhas.map(r => [mes, r.matricula || "", r.funcionario, r.funcao || "", rhhObraTxt(r.obra_id, r.obra_codigo, r.obra_nome), r.cno || "", dataBR(r.primeiro_dia), dataBR(r.ultimo_dia), num(r.dias), r.equipamento_codigo || "", num(r.dias_duas_obras), num(r.dias_uteis_sem_diario), r.conferido_em ? dataBR(String(r.conferido_em).slice(0, 10)) : "", r.conferido_por_nome || ""]));
    nome = `alocacao-obras-${mes}.xlsx`; aba = "ALOCAÇÃO";
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba);
  XLSX.writeFile(wb, nome);
}

/* ---------- ligação ---------- */
function ligarRhh(){
  if(!$("rhh-painel")) return;
  document.querySelector('nav button[data-secao="rhh"]')?.addEventListener("click", () => carregarRhh());
  document.querySelectorAll("#rhh-painel .serv-view-btn[data-view]").forEach(b => b.addEventListener("click", () => { _rhhView = b.dataset.view; carregarRhh(); }));
  $("btn-rhh-atualizar")?.addEventListener("click", () => { _rhhPodeLiberar = {}; carregarRhh(); });
  $("btn-rhh-xlsx")?.addEventListener("click", rhhExportar);
  $("btn-rhh-liberar")?.addEventListener("click", () => comBotaoTravado("btn-rhh-liberar", () => rhhLiberar(false)));
  $("btn-rhh-estornar")?.addEventListener("click", () => comBotaoTravado("btn-rhh-estornar", () => rhhLiberar(true)));
  $("btn-rhh-materializar")?.addEventListener("click", () => comBotaoTravado("btn-rhh-materializar", async () => { await rhhMaterializar(false); await carregarRhh(); }));
  $("btn-rhh-conferir")?.addEventListener("click", () => comBotaoTravado("btn-rhh-conferir", () => rhhConferir(false)));
  $("btn-rhh-desconferir")?.addEventListener("click", () => comBotaoTravado("btn-rhh-desconferir", () => rhhConferir(true)));
  $("btn-rhh-folha")?.addEventListener("click", rhhLancarFolha);
  ["rhh-f-mes", "rhh-f-quinzena", "rhh-f-obra"].forEach(id => $(id)?.addEventListener("change", () => carregarRhh()));
  // situação, extras e busca filtram o que já está na memória
  const refiltrar = () => { if(_rhhView === "liberar") renderRhhLiberar(); else if(_rhhView === "fechamento") renderRhhFechamento(); else renderRhhAlocacao(); };
  ["rhh-f-situacao", "rhh-f-extras"].forEach(id => $(id)?.addEventListener("change", refiltrar));
  $("rhh-busca")?.addEventListener("input", debounce(refiltrar, 150));
  $("rhh-kpi-card-pend")?.addEventListener("click", () => { if(_rhhView !== "liberar") return; const s = $("rhh-f-situacao"); if(s){ s.value = s.value === "pendente" ? "" : "pendente"; refiltrar(); } });
}

/* ====================================================================
   MINHAS HORAS DE VIAGEM (sec-rhv) — o funcionário logado lança as próprias (profiles.funcionario_id, 93b, ou
   funcionarios.profile_id); RH, diretoria e admin escolhem o funcionário. Funciona no celular (campos empilham).
   ==================================================================== */
let _rhvMeuFunc = null;      // funcionário do login
let _rhvFuncs = [];          // lista para o RH escolher
let _rhvLista = [];          // viagens carregadas
let _rhvEditId = null;
let _rhvPronto = false;

function rhvFuncionarioAlvo(){ return rhhEhRhOuAdmin() ? ($("rhv-func")?.value || _rhvMeuFunc || "") : (_rhvMeuFunc || ""); }
function rhvAviso(msg, tipo){ const el = $("rhv-aviso"); if(!el) return; el.textContent = msg; el.className = "aviso " + (tipo === "aviso" ? "atencao" : tipo); if(tipo === "ok") setTimeout(() => { el.className = "aviso"; el.textContent = ""; }, 4000); }
function rhvHorasPrev(){
  const s = $("rhv-saida")?.value, c = $("rhv-chegada")?.value, el = $("rhv-horas-prev");
  if(!el) return;
  const ms = minutosHHMM(s), mc = minutosHHMM(c);
  if(ms == null || mc == null){ el.textContent = ""; return; }
  let min = mc - ms; if(min < 0) min += 1440;
  el.textContent = `${rhhHz(Math.round(min / 60 * 100) / 100)} h de viagem${mc < ms ? " (chegada no dia seguinte)" : ""}`;
}

async function rhvPreparar(){
  if(_rhvPronto) return;
  const { data: meu } = await sb.rpc("rh_meu_funcionario_id");
  _rhvMeuFunc = meu || null;
  const [veic, obras, funcs] = await Promise.all([
    sb.from("equipamentos").select("id,codigo,nome,placa,tipo").in("tipo", ["veiculo", "caminhao"]).eq("ativo", true).order("codigo"),
    sb.from("obras").select("id,codigo,nome,status").in("status", ["em_andamento", "planejada", "paralisada"]).order("codigo"),
    rhhEhRhOuAdmin() ? sb.from("funcionarios").select("id,nome,matricula").eq("ativo", true).neq("status", "demitido").order("nome") : Promise.resolve({ data: [] })
  ]);
  const sv = $("rhv-veiculo");
  if(sv) sv.innerHTML = `<option value="">— sem veículo / não sei —</option>` + (veic.data || []).map(v => `<option value="${esc(v.id)}">${esc(v.codigo)} · ${esc(v.nome || "")}${v.placa ? " · " + esc(v.placa) : ""}</option>`).join("");
  const so = $("rhv-obra");
  if(so) so.innerHTML = `<option value="">— base / outro lugar —</option>` + (obras.data || []).map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("");
  _rhvFuncs = funcs.data || [];
  const sf = $("rhv-func"), campo = $("rhv-func-campo");
  if(rhhEhRhOuAdmin() && sf && campo){
    campo.style.display = "";
    sf.innerHTML = `<option value="">— escolha o funcionário —</option>` + _rhvFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.matricula ? " · " + esc(f.matricula) : ""}</option>`).join("");
    if(_rhvMeuFunc) sf.value = _rhvMeuFunc;
  }
  if($("rhv-data") && !$("rhv-data").value) $("rhv-data").value = hojeISO();
  if($("rhv-f-mes") && !$("rhv-f-mes").value) $("rhv-f-mes").value = rhhMesAtual();
  _rhvPronto = true;
}

async function carregarRhv(){
  const cont = $("rhv-conteudo"); if(!cont) return;
  try{
    await rhvPreparar();
    const alvo = rhvFuncionarioAlvo();
    if(!alvo){
      _rhvLista = [];
      cont.innerHTML = rhhEhRhOuAdmin()
        ? `<p class="vazio">Escolha o funcionário para ver e lançar as viagens dele.</p>`
        : `<p class="vazio">Seu usuário ainda não está ligado a um funcionário do cadastro. Peça ao RH (Jucirlene) para ligar o login à sua ficha; enquanto isso ela lança as viagens por você.</p>`;
      if($("rhv-contador")) $("rhv-contador").textContent = "";
      $("rhv-form-card").style.display = rhhEhRhOuAdmin() ? "" : "none";
      return;
    }
    $("rhv-form-card").style.display = "";
    const mes = $("rhv-f-mes")?.value || rhhMesAtual();
    const [a, m] = mes.split("-").map(Number);
    const ini = `${mes}-01`, fim = `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
    const { data, error } = await sb.from("horas_viagem")
      .select("id,funcionario_id,data,origem,destino,obra_id,hora_saida,hora_chegada,horas,veiculo_id,viagem_id,sozinho,rastreio_conferido,liberado_em,observacoes,obra:obras(codigo,nome),veiculo:equipamentos(codigo,placa)")
      .eq("funcionario_id", alvo).gte("data", ini).lte("data", fim).order("data", { ascending: false }).order("hora_saida", { ascending: false }).limit(1000);
    if(error) throw error;
    _rhvLista = data || [];
    renderRhv();
  }catch(e){
    console.error("Minhas horas de viagem:", e);
    cont.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(e.message || "erro")}).</p>`;
  }
}

function renderRhv(){
  const cont = $("rhv-conteudo"); if(!cont) return;
  if($("rhv-contador")) $("rhv-contador").textContent = `${_rhvLista.length} · ${rhhHz(_rhvLista.reduce((s, v) => s + Number(v.horas || 0), 0))} h`;
  if(!_rhvLista.length){ cont.innerHTML = `<p class="vazio">Nenhuma viagem lançada neste mês.</p>`; return; }
  const podeRastreio = RHV_RASTREIO_CARGOS.includes(rhhCargo()) && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
  const leitura = typeof ehSomenteLeitura === "function" && ehSomenteLeitura();
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Trajeto</th><th>Saída–chegada</th><th class="num">Horas</th><th>Veículo</th><th>Situação</th><th class="col-acao"></th></tr></thead><tbody>` +
    _rhvLista.map(v => {
      const destino = v.destino || (v.obra ? `${v.obra.codigo} — ${v.obra.nome}` : "?");
      const sit = v.liberado_em
        ? `<span class="tag verde" title="Liberada para a folha em ${esc(dataBR(String(v.liberado_em).slice(0, 10)))}">liberada</span>`
        : '<span class="tag ambar">aguardando liberação</span>';
      const rastreio = podeRastreio
        ? `<label class="check-inline" title="Conferido no rastreio do veículo (RH/logística)"><input type="checkbox" class="rhv-rastreio" data-id="${esc(v.id)}" ${v.rastreio_conferido ? "checked" : ""} /> rastreio</label>`
        : (v.rastreio_conferido ? '<span class="tag verde" title="Rastreio do veículo conferido">rastreio ok</span>' : "");
      return `<tr>
        <td>${esc(dataBR(v.data))}</td>
        <td>${esc(v.origem || "?")} → ${esc(destino)}${v.sozinho === false ? ' <span class="tag cinza">equipe</span>' : ""}${v.observacoes ? `<div class="meta">${esc(v.observacoes)}</div>` : ""}</td>
        <td>${esc(rhhHHMM(v.hora_saida))}–${esc(rhhHHMM(v.hora_chegada))}</td>
        <td class="num"><strong>${rhhHz(v.horas)}</strong></td>
        <td>${v.veiculo ? esc(v.veiculo.codigo) + (v.veiculo.placa ? ` <span class="meta">${esc(v.veiculo.placa)}</span>` : "") : "—"}${v.viagem_id ? ' <span class="tag azul" title="Casada com uma viagem da Logística (mesmo veículo e dia)">viagem</span>' : ""}</td>
        <td>${sit} ${rastreio}</td>
        <td class="col-acao">${v.liberado_em || leitura ? "" : `<button type="button" class="btn-sec btn-sm rhv-editar" data-id="${esc(v.id)}" title="Editar">✏️</button> <button type="button" class="btn-sec btn-sm rhv-excluir txt-perigo" data-id="${esc(v.id)}" title="Excluir">×</button>`}</td>
      </tr>`;
    }).join("") + `</tbody></table></div>`;
  cont.querySelectorAll(".rhv-editar").forEach(b => b.addEventListener("click", () => rhvEditar(b.dataset.id)));
  cont.querySelectorAll(".rhv-excluir").forEach(b => b.addEventListener("click", () => rhvExcluir(b.dataset.id)));
  cont.querySelectorAll(".rhv-rastreio").forEach(cb => cb.addEventListener("change", async () => {
    const { error } = await sb.from("horas_viagem").update({ rastreio_conferido: cb.checked }).eq("id", cb.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível marcar o rastreio: " + error.message, "erro"); cb.checked = !cb.checked; }
  }));
}

function rhvLimpar(){
  _rhvEditId = null;
  if($("rhv-form-titulo")) $("rhv-form-titulo").textContent = "Nova viagem";
  ["rhv-saida", "rhv-chegada", "rhv-origem", "rhv-destino", "rhv-obs"].forEach(id => { if($(id)) $(id).value = ""; });
  if($("rhv-obra")) $("rhv-obra").value = "";
  if($("rhv-veiculo")) $("rhv-veiculo").value = "";
  if($("rhv-sozinho")) $("rhv-sozinho").value = "true";
  if($("rhv-data")) $("rhv-data").value = hojeISO();
  rhvHorasPrev();
  const el = $("rhv-aviso"); if(el){ el.textContent = ""; el.className = "aviso"; }
  if(typeof appLimparSujo === "function") appLimparSujo();
}

function rhvEditar(id){
  const v = _rhvLista.find(x => x.id === id); if(!v) return;
  _rhvEditId = id;
  if($("rhv-form-titulo")) $("rhv-form-titulo").textContent = `Editar viagem de ${dataBR(v.data)}`;
  $("rhv-data").value = v.data; $("rhv-saida").value = rhhHHMM(v.hora_saida); $("rhv-chegada").value = rhhHHMM(v.hora_chegada);
  $("rhv-origem").value = v.origem || ""; $("rhv-destino").value = v.destino || ""; $("rhv-obs").value = v.observacoes || "";
  $("rhv-obra").value = v.obra_id || ""; $("rhv-veiculo").value = v.veiculo_id || ""; $("rhv-sozinho").value = v.sozinho === false ? "false" : "true";
  rhvHorasPrev();
  $("rhv-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function rhvSalvar(){
  const alvo = rhvFuncionarioAlvo();
  if(!alvo){ rhvAviso(rhhEhRhOuAdmin() ? "Escolha o funcionário." : "Seu login não está ligado a um funcionário.", "erro"); return; }
  const data = $("rhv-data").value, saida = $("rhv-saida").value, chegada = $("rhv-chegada").value;
  if(!data || !saida || !chegada){ rhvAviso("Informe data, saída e chegada.", "erro"); return; }
  if(data > hojeISO()){ rhvAviso("A data da viagem não pode ser futura.", "erro"); return; }
  const obraId = $("rhv-obra").value || null;
  const destino = $("rhv-destino").value.trim() || (obraId ? (mapaObras?.[obraId] || null) : null);
  if(!destino && !obraId){ rhvAviso("Diga para onde foi (obra de destino ou o lugar).", "erro"); return; }
  const reg = {
    funcionario_id: alvo, data, hora_saida: saida, hora_chegada: chegada,
    origem: $("rhv-origem").value.trim() || null, destino, obra_id: obraId,
    veiculo_id: $("rhv-veiculo").value || null, sozinho: $("rhv-sozinho").value !== "false",
    observacoes: $("rhv-obs").value.trim() || null
  };
  const r = _rhvEditId ? await sb.from("horas_viagem").update(reg).eq("id", _rhvEditId) : await sb.from("horas_viagem").insert(reg);
  if(r.error){ rhvAviso("Não foi possível salvar: " + r.error.message, "erro"); return; }
  rhvAviso(_rhvEditId ? "Viagem atualizada." : "Viagem lançada. O engenheiro da obra libera e o RH fecha o mês.", "ok");
  if($("rhv-f-mes")) $("rhv-f-mes").value = data.slice(0, 7);
  rhvLimpar();
  await carregarRhv();
}

async function rhvExcluir(id){
  const v = _rhvLista.find(x => x.id === id); if(!v) return;
  if(!confirm(`Excluir a viagem de ${dataBR(v.data)} (${rhhHz(v.horas)} h)?`)) return;
  const { error } = await sb.from("horas_viagem").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível excluir: " + error.message, "erro"); return; }
  aviso("app-aviso", "Viagem excluída.", "ok");
  if(_rhvEditId === id) rhvLimpar();
  await carregarRhv();
}

function ligarRhv(){
  if(!$("rhv-painel")) return;
  document.querySelector('nav button[data-secao="rhv"]')?.addEventListener("click", () => carregarRhv());
  $("btn-rhv-salvar")?.addEventListener("click", () => comBotaoTravado("btn-rhv-salvar", rhvSalvar));
  $("btn-rhv-limpar")?.addEventListener("click", rhvLimpar);
  $("rhv-f-mes")?.addEventListener("change", () => carregarRhv());
  $("rhv-func")?.addEventListener("change", () => { rhvLimpar(); carregarRhv(); });
  ["rhv-saida", "rhv-chegada"].forEach(id => $(id)?.addEventListener("change", rhvHorasPrev));
  $("rhv-obra")?.addEventListener("change", () => { const d = $("rhv-destino"); if(d && !d.value && $("rhv-obra").value) d.value = mapaObras?.[$("rhv-obra").value] || ""; });
  // fase 86: formulário mexido segura a atualização automática do app até salvar/limpar
  document.querySelectorAll("#rhv-form-card input, #rhv-form-card select").forEach(el => el.addEventListener("input", () => { if(typeof appMarcarSujo === "function") appMarcarSujo(); }));
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", () => { ligarRhh(); ligarRhv(); });
} else {
  ligarRhh(); ligarRhv();
}

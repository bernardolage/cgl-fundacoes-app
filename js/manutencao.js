/* ====================================================================
   Módulo: Manutenção (fase 92, 20/10/2026) — os controles do Bruno no sistema.
   Painel no padrão Serviços com quatro visões: OS (lista / por status), Preventivas (a RG 3.0.3: uma linha por
   TAG com horímetro, itens vencendo e semáforo), Planos (RG 3.14: um por TAG, itens com periodicidade em h, km
   ou dias e o kit de peças) e Checklists (RG 3.12, ligados à mobilização). Ficha da OS no padrão Odoo:
   statusbar aberta → em execução → concluída, chips, smart-buttons, abas Atividades, Mão de obra, Materiais
   (baixa no estoque pela RPC manutencao_consumir_pecas), Checklist, Anexos, Observações (+ chatter), impressão
   no leiaute do modelo de OS. Horímetro e km da máquina vêm de equipamento_leituras (RDO, OS, checklist, viagem,
   ajuste manual pela RPC equipamento_ajustar_leitura). Prefixo man-.
   Permissões espelham o banco: manutencao_pode_operar() (admin, engenheiro, mecânico, gestor_frota,
   logística, gestor_manutencao; diretor sempre); peças também pelo almoxarifado; checklist também pelo campo.
   ==================================================================== */

let _manView = "os";
let _manOS = [];
let _manPrev = [];            // vw_manutencao_preventiva (uma linha por item do plano)
let _manChecks = [];
let _manEquips = [];
let _manFuncs = [];
let _manProfiles = [];
let _manModelos = [];
let _manCfg = { custo_hora_oficina: 0, manutencao_atencao_h: 50, manutencao_atencao_km: 500 };
let _manCarregado = false;
let _manAtual = null;         // OS aberta
let _manAtivs = [];
let _manHoras = [];
let _manMats = [];
let _manAnexos = [];
let _manChecksOS = [];
let _manPlanoEq = null;       // TAG escolhida na visão Planos
let _manPlano = null;
let _manPlanoItens = [];
let _manItemEdit = null;      // item do plano no modal
let _manItemMats = [];
let _manCheckAtual = null;    // checklist no modal
let _manCheckItens = [];
let _manCheckOrigem = null;   // função a chamar ao fechar o modal do checklist (quem abriu redesenha)
let _manLeituraEq = null;
let _manAnexoUrl = {};

const MAN_STATUS = { agendada: ["Aberta", "azul"], em_andamento: ["Em execução", "ambar"], concluida: ["Concluída", "verde"], cancelada: ["Cancelada", "cinza"] };
const MAN_STAGES = ["agendada", "em_andamento", "concluida"];
const MAN_TIPO = { preventiva: "Preventiva", corretiva: "Corretiva", preditiva: "Preditiva" };
const MAN_SETOR = { mecanica: "Mecânica", eletrica: "Elétrica", solda: "Solda", eletronica: "Eletrônica", lubrificacao: "Lubrificação", pintura: "Pintura", externo: "Externo", outros: "Outros" };
const MAN_SITUACAO = { pendente: ["Pendente", "ambar"], executado: ["Executado", "verde"], nao_aplicavel: ["N/A", "cinza"], cancelado: ["Cancelado", "cinza"] };
const MAN_SEMAFORO = { critico: ["CRÍTICO", "vermelho"], atencao: ["ATENÇÃO", "ambar"], ok: ["OK", "verde"], sem_base: ["SEM BASE", "cinza"] };
const MAN_SEM_ORDEM = { critico: 0, atencao: 1, sem_base: 2, ok: 3 };
const MAN_OPERACAO = { trocar: "Trocar", inspecionar: "Inspecionar", verificar: "Verificar", limpar: "Limpar", lubrificar: "Lubrificar", amostra: "Obter amostra", outros: "Outros" };
const MAN_CHECK_RES = { aprovado: ["Aprovado", "verde"], com_pendencias: ["Com pendências", "ambar"], reprovado: ["Reprovado", "vermelho"] };
const MAN_TIPO_EQ = { perfuratriz: "Perfuratriz", bate_estaca: "Bate-estaca", escavadeira: "Escavadeira", retroescavadeira: "Retroescavadeira", guindaste: "Guindaste", caminhao: "Caminhão", compressor: "Compressor", gerador: "Gerador", bomba: "Bomba", ferramenta: "Ferramenta", veiculo: "Veículo", outro: "Outro" };
const MAN_SELECT = "id,numero,tipo,status,descricao,setor,local,prioridade,equipamento_id,responsavel_id,fornecedor_id,data_prevista,data_inicio,data_conclusao,horimetro_km,km,custo,custo_pecas,custo_horas,custo_real,custo_manual,observacoes,plano_item_ids,checklist_id,origem,codigo_externo,created_at,equipamento:equipamentos(codigo,nome,tipo,horimetro,km)";
const MAN_ANEXO_BUCKET = "manutencao-anexos";
const MAN_ANEXO_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel", csv: "text/csv", txt: "text/plain", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword" };

/* ---------- permissões (espelho do banco) ---------- */
function manPodeEditar(){ return !!usuarioAtual && !ehSomenteLeitura() && ["admin", "diretor", "engenheiro", "mecanico", "gestor_frota", "logistica", "gestor_manutencao"].includes(usuarioAtual.cargo); }
/* peças: manutencao_pode_operar() ou almoxarifado_pode_operar() (= compras_pode_operar() ou auxiliar de almoxarifado) */
function manPodeMateriais(){ return manPodeEditar() || (!!usuarioAtual && !ehSomenteLeitura() && ["comprador", "almoxarife", "auxiliar_almoxarifado", "gestor_acessorios", "logistica", "financeiro"].includes(usuarioAtual.cargo)); }
function manPodeChecklist(){ return manPodeEditar() || (!!usuarioAtual && !ehSomenteLeitura() && ["encarregado", "operador", "logistica", "assistente_engenharia", "gestor_acessorios"].includes(usuarioAtual.cargo)); }

/* ---------- utilitários ---------- */
function manTag(st){ const o = MAN_STATUS[st] || [st, "cinza"]; return `<span class="tag ${esc(o[1])}">${esc(o[0])}</span>`; }
function manTagSem(s){ const o = MAN_SEMAFORO[s] || [s || "—", "cinza"]; return `<span class="tag ${esc(o[1])}">${esc(o[0])}</span>`; }
function manTagSit(s){ const o = MAN_SITUACAO[s] || [s, "cinza"]; return `<span class="tag ${esc(o[1])}">${esc(o[0])}</span>`; }
function manTagRes(r){ if(!r) return `<span class="tag azul">Em preenchimento</span>`; const o = MAN_CHECK_RES[r] || [r, "cinza"]; return `<span class="tag ${esc(o[1])}">${esc(o[0])}</span>`; }
function manEq(id){ return _manEquips.find(e => e.id === id) || null; }
function manEqTxt(e){ return e ? `${e.codigo}${e.nome ? " · " + e.nome : ""}` : "—"; }
function manFunc(id){ const f = _manFuncs.find(x => x.id === id); return f ? f.nome : ""; }
function manOrdEq(a, b){ return String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }); }
function manDias(m){
  const ini = m.data_inicio || m.data_prevista || (m.created_at ? String(m.created_at).slice(0, 10) : null);
  if(!ini) return null;
  const fim = m.data_conclusao || hojeISO();
  return Math.max(0, Math.round((new Date(fim + "T00:00:00") - new Date(ini + "T00:00:00")) / 864e5));
}
function manAtrasada(m){ return ["agendada", "em_andamento"].includes(m.status) && m.data_prevista && m.data_prevista < hojeISO(); }
function manRestanteTxt(r){
  if(r == null) return "—";
  const u = r.unidade === "dias" ? "d" : r.unidade;
  const v = Math.abs(Number(r.restante));
  const n = r.unidade === "h" ? num(Math.round(v * 10) / 10) : num(Math.round(v));
  return r.restante < 0 ? `vencido há ${n} ${u}` : `faltam ${n} ${u}`;
}
function manPer(r){ return `${num(r.periodicidade)} ${r.unidade === "dias" ? "dias" : r.unidade}`; }
function manUltTxt(r){
  if(r.unidade === "h") return r.ultima_execucao_h != null ? `${num(r.ultima_execucao_h)} h` : "—";
  if(r.unidade === "km") return r.ultima_execucao_km != null ? `${num(r.ultima_execucao_km)} km` : "—";
  return r.ultima_execucao_data ? dataBR(r.ultima_execucao_data) : "—";
}
function manProxTxt(r){
  if(r.unidade === "h") return r.proxima_h != null ? `${num(r.proxima_h)} h` : "—";
  if(r.unidade === "km") return r.proxima_km != null ? `${num(r.proxima_km)} km` : "—";
  return r.proxima_data ? dataBR(r.proxima_data) : "—";
}
function manAtividadeTxt(r){
  const op = (r.operacao_descricao || MAN_OPERACAO[r.operacao] || "").toUpperCase();
  return (op ? op + " — " : "") + r.componente;
}
async function manTodas(q){   // PostgREST pagina em 1.000: busca em páginas
  const out = [];
  for(let de = 0; out.length === de; de += 1000){
    const r = await q(de, de + 999);
    if(r.error){ aviso("app-aviso", "Erro ao carregar: " + r.error.message, "erro"); break; }
    out.push(...(r.data || []));
  }
  return out;
}

/* ---------- carga ---------- */
async function manCarregarBase(force){
  if(_manCarregado && !force) return;
  const [eq, fu, pr, cfg, mod] = await Promise.all([
    sb.from("equipamentos").select("id,codigo,nome,tipo,horimetro,km,ativo,status,placa,localizacao_tipo").order("codigo"),
    sb.from("funcionarios").select("id,nome,funcao").eq("ativo", true).order("nome"),
    sb.from("profiles").select("id,nome,cargo").eq("ativo", true).order("nome"),
    sb.from("empresa_config").select("custo_hora_oficina,manutencao_atencao_h,manutencao_atencao_km").eq("id", 1).maybeSingle(),
    sb.from("checklist_modelos").select("id,nome,versao,tipo,ativo").eq("ativo", true).order("nome")
  ]);
  _manEquips = (eq.data || []).sort(manOrdEq);
  _manFuncs = fu.data || []; _manProfiles = pr.data || []; _manModelos = mod.data || [];
  if(cfg.data) _manCfg = { ..._manCfg, ...cfg.data };
  const ativos = _manEquips.filter(e => e.ativo);
  const optEq = ativos.map(e => `<option value="${esc(e.id)}">${esc(manEqTxt(e))}</option>`).join("");
  $("man-equip").innerHTML = `<option value="">— escolha a TAG —</option>` + optEq;
  $("man-f-tag").innerHTML = `<option value="">TAG</option>` + ativos.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)}</option>`).join("");
  $("man-plano-tag").innerHTML = `<option value="">— escolha a TAG —</option>` + optEq;
  const optF = _manFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.funcao ? " · " + esc(f.funcao) : ""}</option>`).join("");
  $("man-resp").innerHTML = `<option value="">— responsável —</option>` + optF;
  $("man-f-resp").innerHTML = `<option value="">Responsável</option>` + _manFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
  $("man-h-func").innerHTML = `<option value="">— funcionário —</option>` + optF;
  $("man-p-resp").innerHTML = `<option value="">— responsável no sistema —</option>` + _manProfiles.filter(p => ["diretor", "admin", "engenheiro", "mecanico", "gestor_frota", "logistica", "gestor_manutencao"].includes(p.cargo)).map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join("");
  $("man-forn").innerHTML = `<option value="">— interno / sem fornecedor —</option>` + Object.entries(typeof mapaFornecedores === "object" && mapaFornecedores ? mapaFornecedores : {}).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR")).map(([id, nome]) => `<option value="${esc(id)}">${esc(nome)}</option>`).join("");
  const tipos = [...new Set(ativos.map(e => e.tipo))].sort((a, b) => (MAN_TIPO_EQ[a] || a).localeCompare(MAN_TIPO_EQ[b] || b, "pt-BR"));
  $("man-f-tipo-eq").innerHTML = `<option value="">Tipo de equipamento</option>` + tipos.map(t => `<option value="${esc(t)}">${esc(MAN_TIPO_EQ[t] || t)}</option>`).join("");
  _manCarregado = true;
}
async function carregarManutencao(force){
  if(!$("man-conteudo")) return;
  await manCarregarBase(force);
  manRenderCustoHora();
  await Promise.all([manFetchOS(), manFetchPrev(), manFetchChecks()]);
  manRenderKpis();
  renderManutencao();
}
async function manFetchOS(){
  const dias = Number($("man-f-periodo")?.value || 0);
  const corte = dias ? dataLocalISO(new Date(Date.now() - dias * 864e5)) : null;
  _manOS = await manTodas((de, ate) => {
    let q = sb.from("manutencoes").select(MAN_SELECT).order("data_prevista", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(de, ate);
    if(corte) q = q.or(`data_prevista.gte.${corte},data_inicio.gte.${corte},created_at.gte.${corte},status.in.(agendada,em_andamento)`);
    return q;
  });
}
async function manFetchPrev(){
  _manPrev = await manTodas((de, ate) => sb.from("vw_manutencao_preventiva").select("*").order("codigo").order("ordem").range(de, ate));
}
async function manFetchChecks(){
  _manChecks = await manTodas((de, ate) => sb.from("checklists").select("id,data,equipamento_id,mobilizacao_id,manutencao_id,horimetro,km,resultado,responsavel_id,vistoriador,operador,created_at,equipamento:equipamentos(codigo,nome),mobilizacao:mobilizacoes(obra_id,status,data_mobilizacao_prev),os:manutencoes!checklists_manutencao_id_fkey(numero,status),itens:checklist_itens(situacao,atividade_id)").order("data", { ascending: false }).order("created_at", { ascending: false }).range(de, ate));
}
/* custo da hora da oficina (empresa_config; o mesmo dos reparos e da fabricação) */
function manRenderCustoHora(){
  const el = $("man-custo-hora"); if(!el) return;
  const pode = !!usuarioAtual && ["diretor", "admin"].includes(usuarioAtual.cargo);
  el.innerHTML = `Hora da oficina: <strong>${_manCfg.custo_hora_oficina ? brl(_manCfg.custo_hora_oficina) + "/h" : "não definida"}</strong> · atenção a <strong>${num(_manCfg.manutencao_atencao_h)} h</strong> / <strong>${num(_manCfg.manutencao_atencao_km)} km</strong>${pode ? ` <a href="#" id="man-cfg-ed">alterar</a>` : ""}`;
  $("man-cfg-ed")?.addEventListener("click", async e => {
    e.preventDefault();
    const h = prompt("Limite de ATENÇÃO para itens por horímetro (horas antes de vencer):", _manCfg.manutencao_atencao_h);
    if(h === null) return;
    const k = prompt("Limite de ATENÇÃO para itens por quilometragem (km antes de vencer):", _manCfg.manutencao_atencao_km);
    if(k === null) return;
    const nh = Number(h), nk = Number(k);
    if(!(nh > 0) || !(nk > 0)){ aviso("app-aviso", "Informe números maiores que zero.", "erro"); return; }
    const { error } = await sb.from("empresa_config").update({ manutencao_atencao_h: nh, manutencao_atencao_km: nk }).eq("id", 1);
    if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
    _manCfg.manutencao_atencao_h = nh; _manCfg.manutencao_atencao_km = nk;
    aviso("app-aviso", "Limites salvos. O semáforo usa os novos valores na próxima carga.", "ok");
    carregarManutencao(false);
  });
}

/* ---------- indicadores ---------- */
function manRenderKpis(){
  const hoje = hojeISO(), mes = hoje.slice(0, 7);
  const abertas = _manOS.filter(m => ["agendada", "em_andamento"].includes(m.status));
  const concl = _manOS.filter(m => m.status === "concluida" && String(m.data_conclusao || "").slice(0, 7) === mes);
  const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  set("man-kpi-abertas", abertas.length);
  set("man-kpi-atrasadas", abertas.filter(manAtrasada).length);
  set("man-kpi-concluidas", concl.length);
  set("man-kpi-custo", brl(concl.reduce((t, m) => t + Number(m.custo_real || 0), 0)));
  const porTag = manPrevPorTag();
  set("man-kpi-critico", porTag.filter(t => t.n.critico > 0).length);
  set("man-kpi-atencao", porTag.filter(t => !t.n.critico && t.n.atencao > 0).length);
}

/* ---------- painel: dispatcher ---------- */
function renderManutencao(){
  const cont = $("man-conteudo"); if(!cont) return;
  document.querySelectorAll("#man-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _manView));
  ["os", "prev", "planos", "check"].forEach(k => { const f = $("man-filtros-" + k); if(f) f.style.display = "none"; });
  const filtro = { os: "man-filtros-os", preventivas: "man-filtros-prev", planos: "man-filtros-planos", checklists: "man-filtros-check" }[_manView];
  if($(filtro)) $(filtro).style.display = "";
  const pode = manPodeEditar();
  $("btn-man-nova-os").style.display = pode && _manView === "os" ? "" : "none";
  $("btn-man-novo-plano").style.display = pode && _manView === "planos" ? "" : "none";
  $("btn-man-novo-check").style.display = manPodeChecklist() && _manView === "checklists" ? "" : "none";
  const titulo = { os: "Ordens de serviço", preventivas: "Preventivas por TAG", planos: "Plano de manutenção", checklists: "Checklists de mobilização" }[_manView];
  $("man-titulo-lista").innerHTML = `${esc(titulo)} <span id="man-contador" class="contador"></span>`;
  if(_manView === "os") renderManOS();
  else if(_manView === "preventivas") renderManPreventivas();
  else if(_manView === "planos") renderManPlano();
  else renderManChecklists();
}

/* ---------- visão OS ---------- */
function manOSFiltradas(){
  const q = ($("man-busca")?.value || "").trim().toLowerCase();
  const tag = $("man-f-tag")?.value || "", tipo = $("man-f-tipo")?.value || "", setor = $("man-f-setor")?.value || "", st = $("man-f-status")?.value || "", resp = $("man-f-resp")?.value || "";
  return _manOS.filter(m => {
    if(st === "_abertas"){ if(!["agendada", "em_andamento"].includes(m.status)) return false; }
    else if(st === "_atrasadas"){ if(!manAtrasada(m)) return false; }
    else if(st && m.status !== st) return false;
    if(tag && m.equipamento_id !== tag) return false;
    if(tipo && m.tipo !== tipo) return false;
    if(setor && m.setor !== setor) return false;
    if(resp && m.responsavel_id !== resp) return false;
    if(q && ![m.numero, m.codigo_externo, m.descricao, m.local, m.observacoes, m.equipamento?.codigo, m.equipamento?.nome].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderManOS(){
  const cont = $("man-conteudo");
  const dados = manOSFiltradas();
  $("man-contador").textContent = `${dados.length} de ${_manOS.length}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhuma OS com esses filtros.</p>`; return; }
  const kanban = ($("man-f-visao")?.value || "lista") === "kanban";
  if(kanban){
    const cols = MAN_STAGES.concat(dados.some(m => m.status === "cancelada") ? ["cancelada"] : []);
    cont.innerHTML = `<div class="serv-kanban">${cols.map(st => { const its = dados.filter(m => m.status === st);
      return `<div class="serv-kan-col"><div class="serv-kan-col-head">${manTag(st)} <span class="contador">${its.length}</span></div>
        ${its.slice(0, 200).map(m => `<div class="serv-kan-card" data-id="${esc(m.id)}">
          <div class="serv-kan-card-nome"><strong>${esc(m.numero || "")}</strong> <span class="meta">${dataBR(m.data_prevista)}${manAtrasada(m) ? ' · <span class="tag vermelho">atrasada</span>' : ""}</span></div>
          <div>${esc(manEqTxt(m.equipamento ? { codigo: m.equipamento.codigo, nome: m.equipamento.nome } : null))}</div><div class="meta">${esc(m.descricao || "")}</div>
          <div class="meta" style="display:flex;justify-content:space-between;"><span>${esc(MAN_TIPO[m.tipo] || "")}${m.setor ? " · " + esc(MAN_SETOR[m.setor] || m.setor) : ""}</span><strong>${brl(m.custo_real)}</strong></div>
        </div>`).join("") || `<p class="vazio">—</p>`}${its.length > 200 ? `<p class="meta">… e mais ${its.length - 200}</p>` : ""}</div>`; }).join("")}</div>`;
  } else {
    cont.innerHTML = `<div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Prevista</th><th>TAG</th><th>Tipo</th><th>Setor</th><th>Descrição</th><th>Responsável</th><th class="num">Dias</th><th class="num">Custo</th><th>Status</th></tr></thead>
      <tbody>${dados.map(m => `<tr class="linha-clicavel" data-id="${esc(m.id)}">
        <td><strong>${esc(m.numero || "")}</strong>${m.codigo_externo ? ` <span class="meta" title="nº na planilha RG 3.1">${esc(m.codigo_externo)}</span>` : ""}</td>
        <td>${dataBR(m.data_prevista)}${manAtrasada(m) ? ' <span class="tag vermelho" title="data prevista vencida">!</span>' : ""}</td>
        <td>${m.equipamento_id ? linkEquipamento(m.equipamento_id, m.equipamento?.codigo || "TAG") : "—"} <span class="meta">${esc(m.equipamento?.nome || "")}</span></td>
        <td>${esc(MAN_TIPO[m.tipo] || m.tipo)}</td><td>${esc(MAN_SETOR[m.setor] || "—")}</td><td>${esc(m.descricao || "")}</td><td class="meta">${esc(manFunc(m.responsavel_id))}</td>
        <td class="num">${manDias(m) ?? "—"}</td><td class="num">${brl(m.custo_real)}</td><td>${manTag(m.status)}</td></tr>`).join("")}</tbody></table></div>`;
  }
}

/* ---------- visão Preventivas (RG 3.0.3) ---------- */
function manPrevPorTag(){
  const map = new Map();
  _manPrev.forEach(r => {
    if(r.ativo === false) return;
    let t = map.get(r.equipamento_id);
    if(!t){ t = { equipamento_id: r.equipamento_id, codigo: r.codigo, nome: r.nome, tipo: r.tipo, status: r.status, horimetro: r.horimetro_atual, km: r.km_atual, data_leitura: r.data_leitura, plano_id: r.plano_id, itens: [], n: { critico: 0, atencao: 0, ok: 0, sem_base: 0 } }; map.set(r.equipamento_id, t); }
    t.itens.push(r); t.n[r.semaforo] = (t.n[r.semaforo] || 0) + 1;
  });
  map.forEach(t => {
    t.pior = ["critico", "atencao", "sem_base", "ok"].find(s => t.n[s] > 0) || "ok";
    const comRest = t.itens.filter(i => i.restante != null).sort((a, b) => Number(a.restante) - Number(b.restante));
    t.proximo = comRest[0] || null;
  });
  return [...map.values()].sort((a, b) => MAN_SEM_ORDEM[a.pior] - MAN_SEM_ORDEM[b.pior] || manOrdEq(a, b));
}
function renderManPreventivas(){
  const cont = $("man-conteudo");
  const q = ($("man-prev-busca")?.value || "").trim().toLowerCase();
  const sem = $("man-f-semaforo")?.value || "", tipoEq = $("man-f-tipo-eq")?.value || "";
  let linhas;
  if(sem === "_sem_plano"){
    const com = new Set(_manPrev.map(r => r.equipamento_id));
    linhas = _manEquips.filter(e => e.ativo && !com.has(e.id)).map(e => ({ equipamento_id: e.id, codigo: e.codigo, nome: e.nome, tipo: e.tipo, horimetro: e.horimetro, km: e.km, itens: [], n: {}, pior: null, semPlano: true }));
  } else {
    linhas = manPrevPorTag().filter(t => !sem || t.n[sem] > 0);
  }
  linhas = linhas.filter(t => (!tipoEq || t.tipo === tipoEq) && (!q || `${t.codigo} ${t.nome || ""}`.toLowerCase().includes(q)));
  $("man-contador").textContent = `${linhas.length} TAG(s)`;
  if(!linhas.length){ cont.innerHTML = `<p class="vazio">${sem === "_sem_plano" ? "Toda TAG ativa tem plano." : "Nenhuma TAG com plano nesses filtros. Crie o plano na visão Planos."}</p>`; return; }
  const pode = manPodeEditar();
  cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">Semáforo pelo horímetro (ATENÇÃO a ${num(_manCfg.manutencao_atencao_h)} h do vencimento) ou pelo km (ATENÇÃO a ${num(_manCfg.manutencao_atencao_km)} km); CRÍTICO quando vence. O horímetro vem do abastecimento do RDO, da OS concluída, do checklist e do ajuste manual; o km, das viagens.</p>
    <div class="tabela-rola"><table>
    <thead><tr><th>TAG</th><th>Equipamento</th><th class="num">Horímetro</th><th class="num">km</th><th>Leitura</th><th>Itens do plano</th><th>Próximo vencimento</th><th>Semáforo</th><th></th></tr></thead>
    <tbody>${linhas.map(t => `<tr class="linha-clicavel" data-eq="${esc(t.equipamento_id)}">
      <td><strong>${esc(t.codigo)}</strong></td><td>${esc(t.nome || "")} <span class="meta">${esc(MAN_TIPO_EQ[t.tipo] || t.tipo || "")}</span></td>
      <td class="num">${t.horimetro != null ? num(t.horimetro) + " h" : "—"}</td><td class="num">${t.km != null ? num(t.km) + " km" : "—"}</td>
      <td class="meta">${t.data_leitura ? dataBR(t.data_leitura) : "—"}</td>
      <td>${t.semPlano ? '<span class="meta">sem plano</span>' : [["critico", "vermelho"], ["atencao", "ambar"], ["sem_base", "cinza"], ["ok", "verde"]].filter(([k]) => t.n[k]).map(([k, c]) => `<span class="tag ${esc(c)}" title="${esc(MAN_SEMAFORO[k][0])}">${esc(t.n[k])}</span>`).join(" ")} <span class="meta">${t.itens.length ? t.itens.length + " itens" : ""}</span></td>
      <td>${t.proximo ? `${esc(manAtividadeTxt(t.proximo))} <span class="meta">· ${esc(manRestanteTxt(t.proximo))}</span>` : "—"}</td>
      <td>${t.semPlano ? "—" : manTagSem(t.pior)}</td>
      <td class="col-acao" style="white-space:nowrap;">${t.semPlano ? (pode ? `<button type="button" class="btn-sec btn-sm man-prev-plano" data-eq="${esc(t.equipamento_id)}">+ Plano</button>` : "") :
        `${pode && (t.n.critico || t.n.atencao) ? `<button type="button" class="btn btn-sm man-prev-gerar" data-eq="${esc(t.equipamento_id)}" title="Abre a OS preventiva com os itens vencidos e em atenção e o kit de peças">⚙ Gerar OS</button> ` : ""}<button type="button" class="btn-sec btn-sm man-prev-plano" data-eq="${esc(t.equipamento_id)}">Plano</button>`}</td>
    </tr>`).join("")}</tbody></table></div>`;
}
async function manGerarPreventiva(eqId, itemIds){
  if(!manPodeEditar()) return;
  const e = manEq(eqId);
  if(!confirm(`Gerar a OS preventiva da TAG ${e ? e.codigo : ""} com os itens ${itemIds ? "escolhidos" : "vencidos e em atenção"} e o kit de peças de cada um?`)) return;
  const { data, error } = await sb.rpc("manutencao_gerar_preventiva", { p_equipamento_id: eqId, p_item_ids: itemIds || null });
  if(error){ aviso("app-aviso", "Não foi possível gerar a OS: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", "OS preventiva aberta com os itens do plano e o kit de peças.", "ok");
  await manFetchOS(); manRenderKpis();
  abrirManutencao(data);
}

/* ---------- visão Planos (RG 3.14) ---------- */
async function manAbrirPlano(eqId){
  _manPlanoEq = eqId || null; _manView = "planos";
  if($("man-plano-tag")) $("man-plano-tag").value = _manPlanoEq || "";
  renderManutencao();
}
async function renderManPlano(){
  const cont = $("man-conteudo");
  const eqId = _manPlanoEq || $("man-plano-tag")?.value || "";
  _manPlanoEq = eqId || null;
  $("man-contador").textContent = "";
  $("man-plano-info").textContent = "";
  if(!eqId){
    // sem TAG escolhida: resumo de quem tem plano
    const porTag = manPrevPorTag();
    cont.innerHTML = `<p class="meta">Escolha a TAG para ver e editar o plano. ${porTag.length} TAG(s) com plano; ${_manEquips.filter(e => e.ativo).length - porTag.length} ativa(s) sem plano.</p>
      <div class="tabela-rola"><table><thead><tr><th>TAG</th><th>Equipamento</th><th class="num">Itens</th><th>Semáforo</th></tr></thead>
      <tbody>${porTag.map(t => `<tr class="linha-clicavel" data-eq="${esc(t.equipamento_id)}"><td><strong>${esc(t.codigo)}</strong></td><td>${esc(t.nome || "")}</td><td class="num">${t.itens.length}</td><td>${manTagSem(t.pior)}</td></tr>`).join("") || `<tr><td colspan="4" class="vazio">Nenhum plano cadastrado.</td></tr>`}</tbody></table></div>`;
    return;
  }
  const e = manEq(eqId);
  const [pl, it] = await Promise.all([
    sb.from("manutencao_planos").select("*").eq("equipamento_id", eqId).maybeSingle(),
    sb.from("vw_manutencao_preventiva").select("*").eq("equipamento_id", eqId).order("ordem")
  ]);
  if(_manPlanoEq !== eqId) return;
  _manPlano = pl.data || null; _manPlanoItens = it.data || [];
  const pode = manPodeEditar();
  if(!_manPlano){
    cont.innerHTML = `<p class="vazio">A TAG ${esc(e ? e.codigo : "")} não tem plano de manutenção.${pode ? ` <button type="button" class="btn btn-sm" id="btn-man-plano-criar-aqui">+ Criar plano</button>` : ""}</p>`;
    $("btn-man-plano-criar-aqui")?.addEventListener("click", () => manPlanoNovo(eqId));
    return;
  }
  const resp = _manProfiles.find(p => p.id === _manPlano.responsavel_id);
  $("man-plano-info").innerHTML = `${_manPlanoItens.length} item(ns) · horímetro atual <strong>${e && e.horimetro != null ? num(e.horimetro) + " h" : "—"}</strong>${e && e.km != null ? ` · <strong>${num(e.km)} km</strong>` : ""}`;
  cont.innerHTML = `<div class="grade" style="margin-bottom:10px;">
      <div class="campo"><label>TAG</label><div>${linkEquipamento(eqId, manEqTxt(e))}</div></div>
      <div class="campo"><label>Engenheiro responsável</label><input id="man-pl-eng" value="${esc(_manPlano.engenheiro_nome || "")}" ${pode ? "" : "disabled"} /></div>
      <div class="campo"><label>Revisão</label><input id="man-pl-rev" value="${esc(_manPlano.revisao || "")}" ${pode ? "" : "disabled"} /></div>
      <div class="campo"><label>Responsável no sistema</label><select id="man-pl-resp" ${pode ? "" : "disabled"}><option value="">—</option>${_manProfiles.filter(p => ["diretor", "admin", "engenheiro", "mecanico", "gestor_frota", "logistica", "gestor_manutencao"].includes(p.cargo)).map(p => `<option value="${esc(p.id)}"${p.id === _manPlano.responsavel_id ? " selected" : ""}>${esc(p.nome)}</option>`).join("")}</select></div>
      <div class="campo largo"><label>Observações</label><input id="man-pl-obs" value="${esc(_manPlano.observacoes || "")}" ${pode ? "" : "disabled"} /></div>
      ${pode ? `<div class="campo"><label>&nbsp;</label><button type="button" class="btn-sec" id="btn-man-pl-salvar">💾 Salvar cabeçalho</button></div>` : ""}
    </div>
    <div class="lista-topo compacta"><h3 class="titulo-bloco" style="margin:0;">Itens do plano</h3>
      ${pode ? `<button type="button" class="btn btn-sm" id="btn-man-item-novo" style="margin-left:auto;">+ Item</button> ${_manPlanoItens.some(i => ["critico", "atencao"].includes(i.semaforo)) ? `<button type="button" class="btn btn-sm man-prev-gerar" data-eq="${esc(eqId)}">⚙ Gerar OS dos vencidos</button>` : ""}` : ""}
    </div>
    <div class="tabela-rola"><table>
      <thead><tr><th style="width:36px;">#</th><th>Componente</th><th>Operação</th><th>Setor</th><th class="num">Periodicidade</th><th class="num">Última</th><th class="num">Próxima</th><th>Restante</th><th>Semáforo</th><th class="num">Kit</th><th class="col-acao"></th></tr></thead>
      <tbody>${_manPlanoItens.map(i => `<tr data-item="${esc(i.item_id)}">
        <td>${esc(i.ordem)}</td><td>${esc(i.componente)}</td><td>${esc((i.operacao_descricao || MAN_OPERACAO[i.operacao] || "").toUpperCase())}</td><td class="meta">${esc(MAN_SETOR[i.setor] || "—")}</td>
        <td class="num">${esc(manPer(i))}</td><td class="num">${esc(manUltTxt(i))}</td><td class="num">${esc(manProxTxt(i))}</td><td>${esc(manRestanteTxt(i))}</td><td>${manTagSem(i.semaforo)}</td>
        <td class="num">${esc(i.n_materiais || 0)}</td>
        <td class="col-acao" style="white-space:nowrap;">${pode ? `<button type="button" class="btn-sec btn-sm man-item-ed" data-item="${esc(i.item_id)}">✎</button> <button type="button" class="btn-sec btn-sm txt-perigo man-item-rem" data-item="${esc(i.item_id)}" title="remover">×</button>` : `<button type="button" class="btn-sec btn-sm man-item-ed" data-item="${esc(i.item_id)}">ver</button>`}</td>
      </tr>`).join("") || `<tr><td colspan="11" class="vazio">Plano sem itens. Use "+ Item".</td></tr>`}</tbody></table></div>`;
  $("btn-man-pl-salvar")?.addEventListener("click", async () => {
    const upd = { engenheiro_nome: $("man-pl-eng").value.trim() || null, revisao: $("man-pl-rev").value.trim() || null, responsavel_id: $("man-pl-resp").value || null, observacoes: $("man-pl-obs").value.trim() || null };
    const { error } = await sb.from("manutencao_planos").update(upd).eq("id", _manPlano.id);
    if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
    aviso("app-aviso", "Plano salvo.", "ok");
  });
  $("btn-man-item-novo")?.addEventListener("click", () => manItemAbrir(null));
  cont.querySelectorAll(".man-item-ed").forEach(b => b.addEventListener("click", () => manItemAbrir(_manPlanoItens.find(i => i.item_id === b.dataset.item))));
  cont.querySelectorAll(".man-item-rem").forEach(b => b.addEventListener("click", async () => {
    if(!confirm("Remover este item do plano? O kit de peças dele vai junto.")) return;
    const { error } = await sb.from("manutencao_plano_itens").delete().eq("id", b.dataset.item);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await manFetchPrev(); renderManPlano();
  }));
}
function manPlanoNovo(eqPre){
  if(!manPodeEditar()) return;
  const com = new Set(_manPrev.map(r => r.equipamento_id));
  const semPlano = _manEquips.filter(e => e.ativo && !com.has(e.id));
  $("man-p-tag").innerHTML = `<option value="">— TAG sem plano —</option>` + semPlano.map(e => `<option value="${esc(e.id)}"${e.id === eqPre ? " selected" : ""}>${esc(manEqTxt(e))}</option>`).join("");
  const comPlano = _manEquips.filter(e => com.has(e.id));
  $("man-p-copiar").innerHTML = `<option value="">— plano vazio —</option>` + comPlano.map(e => `<option value="eq:${esc(e.id)}">copiar da TAG ${esc(manEqTxt(e))}</option>`).join("");
  sb.from("manutencao_plano_modelos").select("id,nome,tipo,modelo").eq("ativo", true).order("nome").then(({ data }) => {
    (data || []).forEach(m => $("man-p-copiar").insertAdjacentHTML("beforeend", `<option value="mod:${esc(m.id)}">molde: ${esc(m.nome)}</option>`));
  });
  $("man-p-eng").value = ""; $("man-p-rev").value = ""; $("man-p-resp").value = ""; $("man-p-obs").value = "";
  $("man-plano-modal").style.display = "flex";
}
async function manPlanoCriar(){
  const eqId = $("man-p-tag").value;
  if(!eqId){ aviso("app-aviso", "Escolha a TAG.", "erro"); return; }
  const { data: pl, error } = await sb.from("manutencao_planos").insert({ equipamento_id: eqId, engenheiro_nome: $("man-p-eng").value.trim() || null, revisao: $("man-p-rev").value.trim() || null,
    responsavel_id: $("man-p-resp").value || null, observacoes: $("man-p-obs").value.trim() || null }).select("id").single();
  if(error){ aviso("app-aviso", "Não foi possível criar o plano: " + error.message, "erro"); return; }
  const origem = $("man-p-copiar").value;
  if(origem.startsWith("eq:")){
    const { data: src } = await sb.from("manutencao_planos").select("id").eq("equipamento_id", origem.slice(3)).maybeSingle();
    if(src){
      const { data: itens } = await sb.from("manutencao_plano_itens").select("ordem,componente,operacao,operacao_descricao,setor,periodicidade_h,periodicidade_km,periodicidade_dias,observacao").eq("plano_id", src.id).eq("ativo", true).order("ordem");
      if(itens?.length){ const { error: e2 } = await sb.from("manutencao_plano_itens").insert(itens.map(i => ({ ...i, plano_id: pl.id }))); if(e2) aviso("app-aviso", "Plano criado, mas os itens não copiaram: " + e2.message, "erro"); }
    }
  } else if(origem.startsWith("mod:")){
    const { data: mod } = await sb.from("manutencao_plano_modelos").select("itens").eq("id", origem.slice(4)).maybeSingle();
    const itens = Array.isArray(mod?.itens) ? mod.itens : [];
    if(itens.length){ const { error: e2 } = await sb.from("manutencao_plano_itens").insert(itens.map((i, k) => ({ plano_id: pl.id, ordem: i.ordem ?? k + 1, componente: i.componente, operacao: i.operacao || "inspecionar", operacao_descricao: i.operacao_descricao || null, setor: i.setor || null, periodicidade_h: i.periodicidade_h || null, periodicidade_km: i.periodicidade_km || null, periodicidade_dias: i.periodicidade_dias || null }))); if(e2) aviso("app-aviso", "Plano criado, mas os itens do molde não copiaram: " + e2.message, "erro"); }
  }
  $("man-plano-modal").style.display = "none";
  aviso("app-aviso", "Plano criado. Agora informe a última execução de cada item para o semáforo valer.", "ok");
  await manFetchPrev();
  manAbrirPlano(eqId);
}
/* item do plano: modal com o kit de peças */
function manItemAbrir(item){
  _manItemEdit = item || null; _manItemMats = [];
  const pode = manPodeEditar();
  $("man-item-titulo").textContent = item ? `Item ${item.ordem} · ${item.componente}` : "Novo item do plano";
  $("man-i-comp").value = item?.componente || ""; $("man-i-op").value = item?.operacao || "trocar"; $("man-i-opdesc").value = item?.operacao_descricao || "";
  $("man-i-setor").value = item?.setor || ""; $("man-i-unid").value = item?.unidade || "h"; $("man-i-per").value = item?.periodicidade ?? "";
  $("man-i-ult").value = item ? (item.unidade === "h" ? item.ultima_execucao_h ?? "" : item.unidade === "km" ? item.ultima_execucao_km ?? "" : "") : "";
  $("man-i-ult-data").value = item?.ultima_execucao_data || "";
  $("man-i-ordem").value = item?.ordem ?? (_manPlanoItens.length ? Math.max(..._manPlanoItens.map(i => i.ordem)) + 1 : 1);
  $("man-i-obs").value = item?.observacao || "";
  manItemUnidade();
  $("man-item-modal").querySelectorAll("input, select").forEach(el => el.disabled = !pode);
  $("btn-man-item-salvar").style.display = pode ? "" : "none";
  $("man-i-mats-bloco").style.display = item ? "" : "none";
  if(item) manItemMatsCarregar();
  $("man-item-modal").style.display = "flex";
}
function manItemUnidade(){
  const u = $("man-i-unid").value;
  $("man-i-ult-lbl").textContent = u === "h" ? "(horímetro, h)" : u === "km" ? "(km)" : "(use a data ao lado)";
  $("man-i-ult").disabled = u === "dias" || !manPodeEditar();
  $("man-i-ult").placeholder = u === "h" ? "horímetro da última troca" : u === "km" ? "km da última troca" : "—";
}
async function manItemSalvar(){
  if(!_manPlano) return;
  const u = $("man-i-unid").value, per = Number($("man-i-per").value), ult = $("man-i-ult").value === "" ? null : Number($("man-i-ult").value);
  const reg = { plano_id: _manPlano.id, ordem: Number($("man-i-ordem").value || 0), componente: $("man-i-comp").value.trim(), operacao: $("man-i-op").value, operacao_descricao: $("man-i-opdesc").value.trim() || null,
    setor: $("man-i-setor").value || null, periodicidade_h: u === "h" ? per : null, periodicidade_km: u === "km" ? per : null, periodicidade_dias: u === "dias" ? per : null,
    ultima_execucao_h: u === "h" ? ult : null, ultima_execucao_km: u === "km" ? ult : null, ultima_execucao_data: $("man-i-ult-data").value || null, observacao: $("man-i-obs").value.trim() || null };
  if(!reg.componente){ aviso("app-aviso", "Informe o componente.", "erro"); return; }
  if(!(per > 0)){ aviso("app-aviso", "Informe a periodicidade.", "erro"); return; }
  if(u === "dias" && !reg.ultima_execucao_data && !confirm("Item por dias sem a data da última execução fica SEM BASE no semáforo. Salvar assim?")) return;
  if(u !== "dias" && ult == null && !confirm(`Sem a última execução (${u}) o item fica SEM BASE no semáforo. Salvar assim?`)) return;
  let r;
  if(_manItemEdit) r = await sb.from("manutencao_plano_itens").update(reg).eq("id", _manItemEdit.item_id).select("id").single();
  else r = await sb.from("manutencao_plano_itens").insert(reg).select("id").single();
  if(r.error){ aviso("app-aviso", "Não foi possível salvar o item: " + r.error.message, "erro"); return; }
  aviso("app-aviso", "Item salvo.", "ok");
  await manFetchPrev();
  if(!_manItemEdit){ // item novo: fica aberto para o kit
    const novo = _manPrev.find(i => i.item_id === r.data.id);
    if(novo){ manItemAbrir(novo); renderManPlano(); return; }
  }
  $("man-item-modal").style.display = "none";
  renderManPlano();
}
async function manItemMatsCarregar(){
  if(!_manItemEdit) return;
  const { data } = await sb.from("manutencao_plano_materiais").select("id,produto_id,descricao,codigo_peca,quantidade,observacao,produto:produtos(codigo,nome,unidade)").eq("plano_item_id", _manItemEdit.item_id).order("created_at");
  _manItemMats = data || [];
  const pode = manPodeEditar();
  $("man-i-mats").innerHTML = _manItemMats.map(m => `<tr><td>${esc(m.descricao)}</td><td class="meta">${esc(m.codigo_peca || "—")}</td><td class="num">${num(m.quantidade)}</td>
    <td>${m.produto_id ? linkProduto(m.produto_id, m.produto ? `${m.produto.codigo} — ${m.produto.nome}` : "produto") : '<span class="tag ambar" title="sem par no catálogo: não dá baixa no estoque">sem cadastro</span>'}</td>
    <td>${pode ? `<button type="button" class="btn-sec btn-sm txt-perigo man-i-mat-rem" data-id="${esc(m.id)}">×</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="vazio">Sem peças no kit.</td></tr>`;
  $("man-i-mats").querySelectorAll(".man-i-mat-rem").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("manutencao_plano_materiais").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    manItemMatsCarregar();
  }));
}
async function manItemMatAdd(produto){
  if(!_manItemEdit) return;
  const qtd = Number($("man-i-mat-qtd").value || 1);
  const reg = { plano_item_id: _manItemEdit.item_id, quantidade: qtd > 0 ? qtd : 1, produto_id: produto ? produto.id : null,
    descricao: produto ? `${produto.codigo} — ${produto.nome}` : $("man-i-mat-desc").value.trim(), codigo_peca: $("man-i-mat-cod").value.trim() || null };
  if(!reg.descricao){ aviso("app-aviso", "Informe a peça (do catálogo ou a descrição).", "erro"); return; }
  const { error } = await sb.from("manutencao_plano_materiais").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível adicionar: " + error.message, "erro"); return; }
  $("man-i-mat-desc").value = ""; $("man-i-mat-cod").value = ""; $("man-i-mat-qtd").value = 1;
  manItemMatsCarregar();
}

/* ---------- visão Checklists (RG 3.12) ---------- */
function manCheckNaoOk(c){ return (c.itens || []).filter(i => i.situacao === "nao_ok").length; }
function renderManChecklists(){
  const cont = $("man-conteudo");
  const q = ($("man-check-busca")?.value || "").trim().toLowerCase(), res = $("man-f-check-res")?.value || "";
  const dados = _manChecks.filter(c => {
    if(res === "_pendente"){ if(c.resultado) return false; } else if(res && c.resultado !== res) return false;
    if(q && ![c.equipamento?.codigo, c.equipamento?.nome, c.mobilizacao?.obra_id ? (typeof mapaObras === "object" && mapaObras[c.mobilizacao.obra_id]) : "", c.vistoriador, c.operador].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
  $("man-contador").textContent = `${dados.length} de ${_manChecks.length}`;
  // mobilizações a sair sem checklist aprovado (aviso, não bloqueio — decisão 3)
  sb.from("mobilizacoes").select("id,obra_id,equipamento_id,status,data_mobilizacao_prev,equipamento:equipamentos(codigo,nome)").in("status", ["prevista", "em_preparacao", "em_transito"]).not("equipamento_id", "is", null).order("data_mobilizacao_prev", { ascending: true, nullsFirst: false }).then(({ data }) => {
    const aprov = new Set(_manChecks.filter(c => c.resultado === "aprovado" && c.mobilizacao_id).map(c => c.mobilizacao_id));
    const pend = (data || []).filter(m => !aprov.has(m.id));
    const box = $("man-check-pend"); if(!box) return;
    box.innerHTML = pend.length ? `<div class="mov-ace-sug-grupo-t">Mobilizações sem checklist aprovado (${pend.length})</div>
      <div class="tabela-rola"><table><thead><tr><th>Obra</th><th>TAG</th><th>Status</th><th>Prevista</th><th></th></tr></thead><tbody>${pend.map(m => `<tr>
        <td>${linkObra(m.obra_id, (typeof mapaObras === "object" && mapaObras[m.obra_id]) || "obra")}</td><td>${esc(m.equipamento?.codigo || "")} <span class="meta">${esc(m.equipamento?.nome || "")}</span></td>
        <td class="meta">${esc((typeof MOB_STATUS === "object" && MOB_STATUS && MOB_STATUS[m.status]) || m.status)}</td><td>${dataBR(m.data_mobilizacao_prev)}</td>
        <td class="col-acao">${manPodeChecklist() ? `<button type="button" class="btn btn-sm man-check-mob-novo" data-mob="${esc(m.id)}" data-eq="${esc(m.equipamento_id)}">Preencher checklist</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="meta">Nenhuma mobilização a sair sem checklist aprovado.</p>`;
    box.querySelectorAll(".man-check-mob-novo").forEach(b => b.addEventListener("click", () => manCheckCriar({ equipamento_id: b.dataset.eq, mobilizacao_id: b.dataset.mob }, () => carregarManutencao(false))));
  });
  cont.innerHTML = `<div id="man-check-pend" style="margin-bottom:12px;"><p class="meta">Conferindo mobilizações…</p></div>
    <div class="tabela-rola"><table><thead><tr><th>Data</th><th>TAG</th><th>Mobilização</th><th class="num">Horímetro</th><th>Resultado</th><th class="num">Não ok</th><th>OS</th><th>Vistoriador</th></tr></thead>
    <tbody>${dados.map(c => `<tr class="linha-clicavel" data-check="${esc(c.id)}">
      <td>${dataBR(c.data)}</td><td><strong>${esc(c.equipamento?.codigo || "")}</strong> <span class="meta">${esc(c.equipamento?.nome || "")}</span></td>
      <td>${c.mobilizacao?.obra_id ? linkObra(c.mobilizacao.obra_id, (typeof mapaObras === "object" && mapaObras[c.mobilizacao.obra_id]) || "obra") : '<span class="meta">—</span>'}</td>
      <td class="num">${c.horimetro != null ? num(c.horimetro) : "—"}</td><td>${manTagRes(c.resultado)}</td><td class="num">${manCheckNaoOk(c) || "—"}</td>
      <td>${c.manutencao_id ? linkManutencao(c.manutencao_id, c.os?.numero || "OS") : "—"}</td><td class="meta">${esc(c.vistoriador || "")}</td></tr>`).join("") || `<tr><td colspan="8" class="vazio">Nenhum checklist.</td></tr>`}</tbody></table></div>`;
}
/* novo checklist: formulário curto; com pre.mobilizacao_id cria direto */
async function manCheckNovo(pre){
  if(!manPodeChecklist()){ aviso("app-aviso", "Seu perfil não preenche checklist.", "erro"); return; }
  if(!_manCarregado) await manCarregarBase();
  const eqs = _manEquips.filter(e => e.ativo);
  $("man-check-titulo").textContent = "Novo checklist";
  $("man-check-corpo").innerHTML = `<div class="grade">
      <div class="campo largo"><label>TAG *</label><select id="man-c-eq"><option value="">— escolha —</option>${eqs.map(e => `<option value="${esc(e.id)}"${pre?.equipamento_id === e.id ? " selected" : ""}>${esc(manEqTxt(e))}</option>`).join("")}</select></div>
      <div class="campo largo"><label>Mobilização</label><select id="man-c-mob"><option value="">— sem mobilização —</option></select></div>
      <div class="campo"><label>Modelo</label><select id="man-c-mod">${_manModelos.map(m => `<option value="${esc(m.id)}">${esc(m.nome)}${m.versao ? " · rev. " + esc(m.versao) : ""}</option>`).join("")}</select></div>
      <div class="campo"><label>Data</label><input type="date" id="man-c-data" value="${hojeISO()}" /></div>
      <div class="campo"><label>Horímetro (h)</label><input type="number" id="man-c-hor" step="0.1" min="0" /></div>
      <div class="campo"><label>km</label><input type="number" id="man-c-km" step="1" min="0" /></div>
      <div class="campo"><label>Vistoriador</label><input id="man-c-vist" value="${esc(usuarioAtual?.nome || "")}" /></div>
      <div class="campo"><label>Operador</label><input id="man-c-oper" /></div>
    </div>
    <div class="form-acoes compacta"><button type="button" class="btn" id="btn-man-c-criar">Criar e preencher</button></div>`;
  const carregarMobs = async () => {
    const eqId = $("man-c-eq").value; const sel = $("man-c-mob");
    sel.innerHTML = `<option value="">— sem mobilização —</option>`;
    if(!eqId) return;
    const e = manEq(eqId); if(e && e.horimetro != null && !$("man-c-hor").value) $("man-c-hor").value = e.horimetro;
    if(e && e.km != null && !$("man-c-km").value) $("man-c-km").value = e.km;
    const { data } = await sb.from("mobilizacoes").select("id,obra_id,status,data_mobilizacao_prev").eq("equipamento_id", eqId).in("status", ["prevista", "em_preparacao", "em_transito", "em_obra"]).order("data_mobilizacao_prev", { ascending: false, nullsFirst: false });
    (data || []).forEach(m => sel.insertAdjacentHTML("beforeend", `<option value="${esc(m.id)}"${pre?.mobilizacao_id === m.id ? " selected" : ""}>${esc((typeof mapaObras === "object" && mapaObras[m.obra_id]) || "obra")} · ${esc((typeof MOB_STATUS === "object" && MOB_STATUS && MOB_STATUS[m.status]) || m.status)} · ${dataBR(m.data_mobilizacao_prev)}</option>`));
  };
  $("man-c-eq").addEventListener("change", carregarMobs);
  await carregarMobs();
  $("btn-man-c-criar").addEventListener("click", () => comBotaoTravado("btn-man-c-criar", () => manCheckCriar({
    equipamento_id: $("man-c-eq").value, mobilizacao_id: $("man-c-mob").value || null, modelo_id: $("man-c-mod").value, data: $("man-c-data").value || hojeISO(),
    horimetro: $("man-c-hor").value === "" ? null : Number($("man-c-hor").value), km: $("man-c-km").value === "" ? null : Number($("man-c-km").value),
    vistoriador: $("man-c-vist").value.trim() || null, operador: $("man-c-oper").value.trim() || null }, _manCheckOrigem)));
  _manCheckOrigem = pre?.aoFechar || (() => { if(_manView === "checklists") carregarManutencao(false); });
  $("man-check-modal").style.display = "flex";
}
async function manCheckCriar(reg, aoFechar){
  if(!reg.equipamento_id){ aviso("app-aviso", "Escolha a TAG.", "erro"); return; }
  if(!reg.modelo_id){ reg.modelo_id = _manModelos[0]?.id; }
  if(!reg.modelo_id){ aviso("app-aviso", "Nenhum modelo de checklist cadastrado.", "erro"); return; }
  const e = manEq(reg.equipamento_id);
  if(reg.horimetro === undefined) reg.horimetro = e?.horimetro ?? null;
  if(reg.km === undefined) reg.km = e?.km ?? null;
  const { data, error } = await sb.from("checklists").insert(reg).select("id").single();
  if(error){ aviso("app-aviso", "Não foi possível criar o checklist: " + error.message, "erro"); return; }
  _manCheckOrigem = aoFechar || _manCheckOrigem;
  manCheckAbrir(data.id);
}
async function manCheckAbrir(id, aoFechar){
  if(!_manCarregado) await manCarregarBase();
  if(aoFechar) _manCheckOrigem = aoFechar;
  const [c, it] = await Promise.all([
    sb.from("checklists").select("*,equipamento:equipamentos(codigo,nome,horimetro,km),mobilizacao:mobilizacoes(obra_id,status,data_mobilizacao_prev),os:manutencoes!checklists_manutencao_id_fkey(numero,status),modelo:checklist_modelos(nome,versao)").eq("id", id).maybeSingle(),
    sb.from("checklist_itens").select("*").eq("checklist_id", id).order("ordem")
  ]);
  if(c.error || !c.data){ aviso("app-aviso", "Não foi possível abrir o checklist" + (c.error ? ": " + c.error.message : "."), "erro"); return; }
  _manCheckAtual = c.data; _manCheckItens = it.data || [];
  manCheckRender();
  $("man-check-modal").style.display = "flex";
}
function manCheckRender(){
  const c = _manCheckAtual, pode = manPodeChecklist() && c.resultado !== "aprovado" || (manPodeEditar() && manPodeChecklist());
  const podeEd = manPodeChecklist();
  $("man-check-titulo").innerHTML = `Checklist · TAG ${esc(c.equipamento?.codigo || "")} · ${dataBR(c.data)} ${manTagRes(c.resultado)}`;
  const nok = _manCheckItens.filter(i => i.situacao === "nao_ok"), semAtiv = nok.filter(i => !i.atividade_id), semResp = _manCheckItens.filter(i => !i.situacao).length;
  $("man-check-corpo").innerHTML = `<div class="grade" style="margin-bottom:8px;">
      <div class="campo"><label>TAG</label><div>${linkEquipamento(c.equipamento_id, manEqTxt(c.equipamento ? { codigo: c.equipamento.codigo, nome: c.equipamento.nome } : null))}</div></div>
      <div class="campo"><label>Mobilização</label><div>${c.mobilizacao?.obra_id ? linkObra(c.mobilizacao.obra_id, (typeof mapaObras === "object" && mapaObras[c.mobilizacao.obra_id]) || "obra") + ` <span class="meta">${esc((typeof MOB_STATUS === "object" && MOB_STATUS && MOB_STATUS[c.mobilizacao.status]) || "")}</span>` : '<span class="meta">—</span>'}</div></div>
      <div class="campo"><label>Modelo</label><div class="meta">${esc(c.modelo?.nome || "")}${c.modelo?.versao ? " · rev. " + esc(c.modelo.versao) : ""}</div></div>
      <div class="campo"><label>Data</label><input type="date" id="man-ck-data" value="${esc(c.data)}" ${podeEd ? "" : "disabled"} /></div>
      <div class="campo"><label>Horímetro (h)</label><input type="number" id="man-ck-hor" step="0.1" min="0" value="${esc(c.horimetro ?? "")}" ${podeEd ? "" : "disabled"} /></div>
      <div class="campo"><label>km</label><input type="number" id="man-ck-km" step="1" min="0" value="${esc(c.km ?? "")}" ${podeEd ? "" : "disabled"} /></div>
      <div class="campo"><label>Vistoriador</label><input id="man-ck-vist" value="${esc(c.vistoriador || "")}" ${podeEd ? "" : "disabled"} /></div>
      <div class="campo"><label>Operador</label><input id="man-ck-oper" value="${esc(c.operador || "")}" ${podeEd ? "" : "disabled"} /></div>
      <div class="campo"><label>OS de correção</label><div>${c.manutencao_id ? linkManutencao(c.manutencao_id, c.os?.numero || "OS") + ` <span class="meta">${esc((MAN_STATUS[c.os?.status] || [""])[0])}</span>` : '<span class="meta">—</span>'}</div></div>
    </div>
    <p class="meta">OK = em condições · Não ok = precisa de correção (vira atividade de OS) · N/A = não se aplica. ${semResp ? `<strong>${esc(semResp)}</strong> item(ns) sem resposta.` : "Todos respondidos."}</p>
    <div class="tabela-rola" style="max-height:52vh;"><table class="itens-tabela"><thead><tr><th style="width:36px;">#</th><th>Item a verificar</th><th style="width:220px;">Situação</th><th>Observação</th></tr></thead>
      <tbody>${_manCheckItens.map(i => `<tr data-ci="${esc(i.id)}"><td>${esc(i.ordem)}</td><td>${esc(i.descricao)}${i.atividade_id ? ' <span class="tag azul" title="já virou atividade da OS">na OS</span>' : ""}</td>
        <td><div class="serv-views">${[["ok", "OK"], ["nao_ok", "Não ok"], ["nao_aplicavel", "N/A"]].map(([v, l]) => `<button type="button" class="serv-view-btn man-ck-sit${i.situacao === v ? " ativo" : ""}" data-ci="${esc(i.id)}" data-v="${esc(v)}" ${podeEd ? "" : "disabled"}>${esc(l)}</button>`).join("")}</div></td>
        <td><input class="man-ck-obs" data-ci="${esc(i.id)}" value="${esc(i.observacao || "")}" ${podeEd ? "" : "disabled"} /></td></tr>`).join("")}</tbody></table></div>
    <div class="grade" style="margin-top:8px;"><div class="campo largo"><label>Observações gerais</label><input id="man-ck-obsg" value="${esc(c.observacoes || "")}" ${podeEd ? "" : "disabled"} /></div></div>
    <div class="form-acoes compacta" style="display:flex;gap:8px;flex-wrap:wrap;">
      ${podeEd && semAtiv.length ? `<button type="button" class="btn" id="btn-man-ck-os">⚙ Gerar OS corretiva (${semAtiv.length} item(ns) não ok)</button>` : ""}
      ${podeEd && c.resultado !== "reprovado" ? `<button type="button" class="btn-sec acao-perigo" id="btn-man-ck-reprovar" style="color:var(--perigo);">✕ Reprovar equipamento</button>` : ""}
      ${podeEd && c.resultado === "reprovado" ? `<button type="button" class="btn-sec" id="btn-man-ck-reabrir">↩ Reabrir avaliação</button>` : ""}
      <button type="button" class="btn-sec" id="btn-man-ck-fechar2">Fechar</button>
    </div>`;
  const upd = async (campos) => { const { error } = await sb.from("checklists").update(campos).eq("id", c.id); if(error) aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); };
  $("man-ck-data")?.addEventListener("change", e => upd({ data: e.target.value || hojeISO() }));
  $("man-ck-hor")?.addEventListener("change", e => upd({ horimetro: e.target.value === "" ? null : Number(e.target.value) }));
  $("man-ck-km")?.addEventListener("change", e => upd({ km: e.target.value === "" ? null : Number(e.target.value) }));
  $("man-ck-vist")?.addEventListener("change", e => upd({ vistoriador: e.target.value.trim() || null }));
  $("man-ck-oper")?.addEventListener("change", e => upd({ operador: e.target.value.trim() || null }));
  $("man-ck-obsg")?.addEventListener("change", e => upd({ observacoes: e.target.value.trim() || null }));
  document.querySelectorAll(".man-ck-sit").forEach(b => b.addEventListener("click", async () => {
    const atual = _manCheckItens.find(i => i.id === b.dataset.ci);
    const v = atual && atual.situacao === b.dataset.v ? null : b.dataset.v;
    const { error } = await sb.from("checklist_itens").update({ situacao: v }).eq("id", b.dataset.ci);
    if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
    manCheckAbrir(c.id);
  }));
  document.querySelectorAll(".man-ck-obs").forEach(i => i.addEventListener("change", async () => {
    const { error } = await sb.from("checklist_itens").update({ observacao: i.value.trim() || null }).eq("id", i.dataset.ci);
    if(error) aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro");
  }));
  $("btn-man-ck-os")?.addEventListener("click", () => comBotaoTravado("btn-man-ck-os", async () => {
    const { data, error } = await sb.rpc("checklist_gerar_os", { p_checklist_id: c.id });
    if(error){ aviso("app-aviso", "Não foi possível gerar a OS: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
    aviso("app-aviso", "OS corretiva com os itens não ok. Abra a OS para executar.", "ok");
    await manCheckAbrir(c.id);
    if(confirm("Abrir a OS agora?")){ manCheckFechar(); if(irParaSecao("manutencao")) abrirManutencao(data); }
  }));
  $("btn-man-ck-reprovar")?.addEventListener("click", async () => { if(!confirm("Reprovar o equipamento neste checklist? Só avisa na Sala de Comando, não bloqueia a mobilização.")) return; await upd({ resultado: "reprovado" }); manCheckAbrir(c.id); });
  $("btn-man-ck-reabrir")?.addEventListener("click", async () => {
    const res = nok.length ? "com_pendencias" : semResp ? null : "aprovado";
    await upd({ resultado: res }); manCheckAbrir(c.id);
  });
  $("btn-man-ck-fechar2")?.addEventListener("click", manCheckFechar);
}
function manCheckFechar(){
  $("man-check-modal").style.display = "none";
  _manCheckAtual = null;
  const f = _manCheckOrigem; _manCheckOrigem = null;
  if(typeof f === "function") f();
  else if($("sec-manutencao")?.classList.contains("ativa") && _manView === "checklists") carregarManutencao(false);
}
/* seção 8 do drawer da mobilização (js/mobilizacoes.js chama) */
async function manRenderChecklistMob(m, containerId){
  const box = $(containerId); if(!box || !m) return;
  const { data, error } = await sb.from("checklists").select("id,data,horimetro,resultado,manutencao_id,vistoriador,os:manutencoes!checklists_manutencao_id_fkey(numero),itens:checklist_itens(situacao)").eq("mobilizacao_id", m.id).order("data", { ascending: false });
  if(error){ box.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  const lista = data || [];
  const aprovado = lista.some(c => c.resultado === "aprovado");
  const pode = manPodeChecklist() && !!m.equipamento_id && !["desmobilizada", "cancelada"].includes(m.status);
  box.innerHTML = `${!m.equipamento_id ? `<p class="meta">Escolha a TAG principal para preencher o checklist.</p>` : !lista.length ? `<p class="meta">Nenhum checklist desta mobilização${["prevista", "em_preparacao", "em_transito"].includes(m.status) ? ' — <span class="tag ambar">sem checklist aprovado</span>' : ""}.</p>` : ""}
    ${lista.length ? `<div class="tabela-rola"><table><thead><tr><th>Data</th><th class="num">Horímetro</th><th>Resultado</th><th class="num">Não ok</th><th>OS</th><th>Vistoriador</th><th></th></tr></thead>
      <tbody>${lista.map(c => `<tr><td>${dataBR(c.data)}</td><td class="num">${c.horimetro != null ? num(c.horimetro) : "—"}</td><td>${manTagRes(c.resultado)}</td><td class="num">${manCheckNaoOk(c) || "—"}</td>
        <td>${c.manutencao_id ? linkManutencao(c.manutencao_id, c.os?.numero || "OS") : "—"}</td><td class="meta">${esc(c.vistoriador || "")}</td>
        <td class="col-acao"><button type="button" class="btn-sec btn-sm man-mob-ck-abrir" data-id="${esc(c.id)}">Abrir</button></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${!aprovado && ["prevista", "em_preparacao", "em_transito"].includes(m.status) && lista.length ? `<p class="meta"><span class="tag ambar">sem checklist aprovado</span> A Sala de Comando avisa até um checklist ficar aprovado.</p>` : ""}
    ${pode ? `<button type="button" class="btn-sec btn-sm" id="btn-man-mob-ck-novo" style="margin-top:6px;">+ Preencher checklist desta TAG</button>` : ""}`;
  const redesenhar = () => manRenderChecklistMob(m, containerId);
  box.querySelectorAll(".man-mob-ck-abrir").forEach(b => b.addEventListener("click", () => manCheckAbrir(b.dataset.id, redesenhar)));
  $("btn-man-mob-ck-novo")?.addEventListener("click", async () => { if(!_manCarregado) await manCarregarBase(); manCheckCriar({ equipamento_id: m.equipamento_id, mobilizacao_id: m.id }, redesenhar); });
}

/* ---------- ficha da OS ---------- */
async function manNovaOS(pre){
  if(!manPodeEditar()){ aviso("app-aviso", "Seu perfil não abre OS de manutenção.", "erro"); return; }
  if(!_manCarregado) await manCarregarBase();
  const e = pre?.equipamento_id ? manEq(pre.equipamento_id) : null;
  manAbrirFicha(Object.assign({ id: null, numero: "(nova)", status: "agendada", tipo: "corretiva", setor: "mecanica", data_prevista: hojeISO(), origem: "app",
    horimetro_km: e?.horimetro ?? null, km: e?.km ?? null, equipamento: e ? { codigo: e.codigo, nome: e.nome, tipo: e.tipo, horimetro: e.horimetro, km: e.km } : null }, pre || {}), [], [], [], [], []);
}
async function abrirManutencao(id){
  if(!_manCarregado) await manCarregarBase();
  const [m, at, hs, mt, ax, ck] = await Promise.all([
    sb.from("manutencoes").select(MAN_SELECT).eq("id", id).maybeSingle(),
    sb.from("manutencao_atividades").select("*").eq("manutencao_id", id).order("ordem").order("created_at"),
    sb.from("manutencao_horas").select("*").eq("manutencao_id", id).order("data").order("inicio"),
    sb.from("manutencao_materiais").select("*").eq("manutencao_id", id).order("created_at"),
    sb.from("manutencao_anexos").select("*").eq("manutencao_id", id).order("created_at"),
    sb.from("checklists").select("id,data,resultado,horimetro,itens:checklist_itens(situacao)").eq("manutencao_id", id).order("data", { ascending: false })
  ]);
  if(m.error || !m.data){ aviso("app-aviso", "Não foi possível abrir a OS" + (m.error ? ": " + m.error.message : "."), "erro"); return; }
  manAbrirFicha(m.data, at.data || [], hs.data || [], mt.data || [], ax.data || [], ck.data || []);
}
function manAbrirFicha(m, ativs, horas, mats, anexos, checks){
  _manAtual = m; _manAtivs = ativs; _manHoras = horas; _manMats = mats; _manAnexos = anexos; _manChecksOS = checks;
  $("man-painel").style.display = "none"; $("man-ficha").style.display = "";
  const novo = !m.id, pode = manPodeEditar() && m.status !== "cancelada";
  $("man-ficha-titulo").textContent = novo ? "Nova OS" : `${m.numero} · TAG ${m.equipamento?.codigo || ""}`;
  $("man-equip").value = m.equipamento_id || ""; $("man-tipo").value = m.tipo || "corretiva"; $("man-setor").value = m.setor || ""; $("man-prioridade").value = m.prioridade || "";
  $("man-desc").value = m.descricao || ""; $("man-resp").value = m.responsavel_id || ""; $("man-local").value = m.local || "";
  $("man-prev").value = m.data_prevista || ""; $("man-ini").value = m.data_inicio || ""; $("man-fim").value = m.data_conclusao || "";
  $("man-hor").value = m.horimetro_km ?? ""; $("man-km").value = m.km ?? ""; $("man-forn").value = m.fornecedor_id || ""; $("man-custo").value = m.custo ?? ""; $("man-obs").value = m.observacoes || "";
  $("man-ficha").querySelectorAll(".odoo-tab[data-tab=geral] input, .odoo-tab[data-tab=geral] select, #man-obs").forEach(el => el.disabled = !pode);
  $("man-equip").disabled = !pode || (!novo && m.origem === "planilha");
  // lote S50 (#146, parte 1): atividades digitadas no cadastro, uma por linha; só na OS ainda não salva
  $("man-ativs-novas-campo").style.display = novo ? "" : "none";
  $("man-ativs-novas").value = ""; $("man-ativs-novas").disabled = !pode;
  manHorAtual();
  $("man-h-data").value = hojeISO();
  manAtualizarCabecalho();
  manRenderAtivs(); manRenderHoras(); manRenderMats(); manRenderCustos(); manRenderChecklistOS(); manRenderAnexos();
  if(!novo && typeof montarHistorico === "function") montarHistorico("manutencoes", m.id, "man-chatter");
  else if(typeof ocultarHistorico === "function") ocultarHistorico("man-chatter");
  manAtivarTab("geral");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function manHorAtual(){
  const e = manEq($("man-equip").value);
  $("man-hor-atual").textContent = e && e.horimetro != null ? `atual: ${num(e.horimetro)} h` : "";
  $("man-km-atual").textContent = e && e.km != null ? `atual: ${num(e.km)} km` : "";
}
function manAtualizarCabecalho(){
  const m = _manAtual; if(!m) return;
  const st = m.status || "agendada", novo = !m.id, pode = manPodeEditar();
  document.querySelectorAll("#man-statusbar .stage").forEach(el => {
    el.classList.remove("atual", "passada", "cancelada");
    const i = MAN_STAGES.indexOf(st), j = MAN_STAGES.indexOf(el.dataset.status);
    if(st === "cancelada"){ if(j === MAN_STAGES.length - 1) el.classList.add("cancelada"); }
    else if(j === i) el.classList.add("atual"); else if(j < i) el.classList.add("passada");
  });
  const e = m.equipamento || manEq(m.equipamento_id);
  $("man-chip-num").textContent = m.numero || "(nova)";
  $("man-chip-tag").innerHTML = m.equipamento_id ? linkEquipamento(m.equipamento_id, e?.codigo || "TAG") + (e?.nome ? ` <span class="meta">${esc(e.nome)}</span>` : "") : "—";
  $("man-chip-tipo").textContent = MAN_TIPO[m.tipo] || "—";
  $("man-chip-setor").textContent = MAN_SETOR[m.setor] || "—";
  $("man-chip-hor").textContent = [m.horimetro_km != null ? num(m.horimetro_km) + " h" : null, m.km != null ? num(m.km) + " km" : null].filter(Boolean).join(" · ") || "—";
  $("man-chip-resp").textContent = manFunc(m.responsavel_id) || "—";
  $("man-chip-dias").textContent = manDias(m) ?? "—";
  $("man-chip-origem").style.display = m.origem === "planilha" ? "" : "none"; $("man-chip-origem-txt").textContent = m.codigo_externo ? "OS " + m.codigo_externo : "RG 3.1";
  const pendBaixa = _manMats.some(i => i.tipo === "consumo" && i.origem === "app" && !i.movimentacao_estoque_id && i.produto_id);
  const mostra = { "btn-man-salvar": pode && st !== "cancelada", "btn-man-iniciar": pode && !novo && st === "agendada", "btn-man-concluir": pode && !novo && ["agendada", "em_andamento"].includes(st),
    "btn-man-cancelar": pode && !novo && ["agendada", "em_andamento"].includes(st), "btn-man-reabrir": pode && !novo && st === "concluida",
    "btn-man-baixa": manPodeMateriais() && !novo && st !== "cancelada" && m.origem === "app" && pendBaixa, "btn-man-imprimir": !novo };
  Object.entries(mostra).forEach(([id, on]) => { const b = $(id); if(b) b.style.display = on ? "" : "none"; });
  const sb2 = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !n || n === "R$ 0,00" || n === "—"); } };
  sb2("sb-man-equip", e?.codigo || "—"); sb2("sb-man-ativ", _manAtivs.length);
  sb2("sb-man-plano", (m.plano_item_ids || []).length || _manAtivs.filter(a => a.plano_item_id).length);
  sb2("sb-man-check", _manChecksOS.length + (m.checklist_id && !_manChecksOS.some(c => c.id === m.checklist_id) ? 1 : 0));
  sb2("sb-man-custo", brl(m.custo_real || 0));
  $("man-ativ-add").style.display = pode && !novo && st !== "cancelada" ? "" : "none";
  $("man-horas-add").style.display = pode && !novo && st !== "cancelada" ? "" : "none";
  $("man-mats-add").style.display = manPodeMateriais() && !novo && st !== "cancelada" ? "" : "none";
  $("man-anexos-add").style.display = manPodeMateriais() && !novo ? "" : "none";
}
function manAtivarTab(nome){
  document.querySelectorAll("#man-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#man-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
  if(nome === "atividades") document.querySelectorAll("#man-ativs textarea").forEach(manAtivAltura);   // lote S50 (#148): a aba estava oculta no render
}
/* lote S50 (#148): o campo da atividade cresce com o texto (aba oculta não tem altura: mede ao abrir a aba) */
function manAtivAltura(el){
  if(!el || !el.offsetParent) return;
  el.style.height = "auto";
  el.style.height = (el.scrollHeight + 2) + "px";
}
/* lote S50 (#146, parte 1): linhas do campo "Atividades (uma por linha)" da OS nova: aparadas, sem marcador de tópico
   ("- ", "• ", "* "), sem linha vazia e sem repetir (comparação sem diferença de maiúscula e espaço) */
function manAtivsNovasLinhas(){
  const vistas = new Set(), out = [];
  String($("man-ativs-novas")?.value || "").split(/\r?\n/).forEach(l => {
    const t = l.replace(/^\s*[-•*–]\s+/, "").trim();
    const k = t.toLowerCase().replace(/\s+/g, " ");
    if(!t || vistas.has(k)) return;
    vistas.add(k); out.push(t);
  });
  return out;
}
function mostrarPainelManutencao(){ $("man-ficha").style.display = "none"; $("man-painel").style.display = ""; _manAtual = null; carregarManutencao(false); }

async function salvarManutencao(){
  if(!manPodeEditar() || !_manAtual) return null;
  const n = v => v === "" ? null : Number(v);
  const reg = { equipamento_id: $("man-equip").value || null, tipo: $("man-tipo").value, setor: $("man-setor").value || null, prioridade: $("man-prioridade").value || null,
    descricao: $("man-desc").value.trim(), responsavel_id: $("man-resp").value || null, local: $("man-local").value.trim() || null,
    data_prevista: $("man-prev").value || null, data_inicio: $("man-ini").value || null, data_conclusao: $("man-fim").value || null,
    horimetro_km: n($("man-hor").value), km: n($("man-km").value), fornecedor_id: $("man-forn").value || null, custo: n($("man-custo").value), observacoes: $("man-obs").value.trim() || null };
  if(!reg.equipamento_id){ aviso("app-aviso", "Escolha a TAG.", "erro"); manAtivarTab("geral"); return null; }
  if(!reg.descricao){ aviso("app-aviso", "Descreva o serviço da OS.", "erro"); manAtivarTab("geral"); return null; }
  const e = manEq(reg.equipamento_id);
  if(reg.horimetro_km != null && e && e.horimetro != null && reg.horimetro_km < e.horimetro && !confirm(`O horímetro informado (${num(reg.horimetro_km)} h) é menor que o atual da máquina (${num(e.horimetro)} h). O horímetro da máquina não volta para trás ao concluir. Salvar assim mesmo?`)) return null;
  let id = _manAtual.id, msg = "OS salva.", tipoMsg = "ok";
  if(id){ const { error } = await sb.from("manutencoes").update(reg).eq("id", id); if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return null; } }
  else {
    const { data, error } = await sb.from("manutencoes").insert({ ...reg, status: "agendada", origem: "app" }).select("id").single(); if(error){ aviso("app-aviso", "Erro ao abrir a OS: " + error.message, "erro"); return null; } id = data.id;
    // lote S50 (#146, parte 1): cada linha do campo vira uma atividade pendente, na ordem digitada e com o setor da OS.
    // Falha aqui não desfaz a OS: avisa para lançar pela aba Atividades.
    const linhas = manAtivsNovasLinhas();
    if(linhas.length){
      const { error: eA } = await sb.from("manutencao_atividades").insert(linhas.map((t, i) => ({ manutencao_id: id, ordem: i + 1, setor: reg.setor || null, atividade: t, situacao: "pendente" })));
      if(eA){ msg = "OS salva; as atividades não entraram: lance pela aba Atividades. (" + eA.message + ")"; tipoMsg = "aviso"; }
      else msg = `OS salva com ${linhas.length} atividade(s).`;
    }
  }
  aviso("app-aviso", msg, tipoMsg);
  await abrirManutencao(id);
  return id;
}
async function manAcao(acao){
  const m = _manAtual; if(!m?.id) return;
  if(acao === "baixa"){
    const { data, error } = await sb.rpc("manutencao_consumir_pecas", { p_manutencao_id: m.id });
    if(error){ aviso("app-aviso", "Baixa não feita: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
    aviso("app-aviso", `${data || 0} peça(s) com baixa no estoque.`, "ok");
    if(typeof carregarProdutos === "function") carregarProdutos();
    return abrirManutencao(m.id);
  }
  if(acao === "cancelada" && !confirm("Cancelar esta OS?")) return;
  const upd = { status: acao };
  if(acao === "em_andamento" && !m.data_inicio) upd.data_inicio = hojeISO();
  if(acao === "em_andamento" && m.status === "concluida"){ upd.data_conclusao = null; }
  if(acao === "concluida"){
    upd.data_conclusao = m.data_conclusao || hojeISO();
    const pendAt = _manAtivs.filter(a => a.situacao === "pendente").length;
    if(pendAt && !confirm(`${pendAt} atividade(s) ainda pendente(s). Concluir assim mesmo? (os itens do plano só são marcados pelas atividades executadas)`)) return;
    const pend = _manMats.filter(i => i.tipo === "consumo" && i.origem === "app" && !i.movimentacao_estoque_id && i.produto_id).length;
    if(pend && !confirm(`${pend} peça(s) consumida(s) ainda sem baixa no estoque. Concluir assim mesmo? (dá para dar baixa depois)`)) return;
    const hor = $("man-hor").value === "" ? null : Number($("man-hor").value);
    if(hor == null && !confirm("Sem horímetro na OS a máquina não ganha leitura e o plano usa o horímetro atual. Concluir assim mesmo?")) return;
    if(hor != null) upd.horimetro_km = hor;
    if($("man-km").value !== "") upd.km = Number($("man-km").value);
  }
  const { error } = await sb.from("manutencoes").update(upd).eq("id", m.id);
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
  aviso("app-aviso", `OS: ${MAN_STATUS[acao][0].toLowerCase()}.`, "ok");
  if(acao === "concluida"){ await manCarregarBase(true); await manFetchPrev(); }
  await abrirManutencao(m.id);
}

/* atividades */
/* lote S54 (#169): dia (data_inicio/data_fim, date) ao lado da hora (inicio/fim, time) por atividade. Leitura "20/10 07:30",
   "—" quando vazio; sem o dia só a hora, sem a hora só o dia. As horas de mão de obra continuam em manutencao_horas. */
function manAtivDiaHora(dia, hora, vazio){
  const d = dia ? dataBR(dia).slice(0, 5) : "", h = hora ? String(hora).slice(0, 5) : "";
  return [d, h].filter(Boolean).join(" ") || (vazio == null ? "—" : vazio);
}
function manRenderAtivs(){
  const tb = $("man-ativs"), pode = manPodeEditar() && _manAtual && _manAtual.status !== "cancelada" && !!_manAtual.id;
  const optF = `<option value="">—</option>` + _manFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
  const optS = Object.entries(MAN_SETOR).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  const optSit = Object.entries(MAN_SITUACAO).map(([v, l]) => `<option value="${esc(v)}">${esc(l[0])}</option>`).join("");
  if(!_manAtivs.length){ tb.innerHTML = `<tr><td colspan="9" class="vazio">${_manAtual?.id ? "Nenhuma atividade. Use o campo abaixo ou um item do plano." : "Escreva as atividades na aba Geral (uma por linha) ou salve a OS para lançar aqui."}</td></tr>`; }
  else tb.innerHTML = _manAtivs.map(a => pode ? `<tr data-a="${esc(a.id)}">
      <td>${esc(a.ordem)}</td>
      <td><select class="man-a-f" data-c="setor"><option value="">—</option>${optS}</select></td>
      <td><textarea class="man-a-f" data-c="atividade" rows="1">${esc(a.atividade)}</textarea>${a.plano_item_id ? ' <span class="tag azul" title="item do plano: ao concluir a OS com esta atividade executada, a última execução do item é atualizada">plano</span>' : ""}${a.checklist_item_id ? ' <span class="tag cinza" title="veio do checklist">checklist</span>' : ""}</td>
      <td><select class="man-a-f" data-c="situacao">${optSit}</select></td>
      <td><select class="man-a-f" data-c="executante_id">${optF}</select>${a.executante_nome && !a.executante_id ? `<div class="meta" title="nome da planilha, sem par no cadastro">${esc(a.executante_nome)}</div>` : ""}</td>
      <td><input type="date" class="man-a-f" data-c="data_inicio" value="${esc(a.data_inicio || "")}" title="Dia de início" style="width:118px;" /> <input type="time" class="man-a-f" data-c="inicio" value="${a.inicio ? esc(String(a.inicio).slice(0, 5)) : ""}" title="Hora de início" style="width:78px;" /></td>
      <td><input type="date" class="man-a-f" data-c="data_fim" value="${esc(a.data_fim || "")}" title="Dia de conclusão" style="width:118px;" /> <input type="time" class="man-a-f" data-c="fim" value="${a.fim ? esc(String(a.fim).slice(0, 5)) : ""}" title="Hora de conclusão" style="width:78px;" /></td>
      <td><input class="man-a-f" data-c="observacao" value="${esc(a.observacao || "")}" /></td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm txt-perigo man-a-rem" data-a="${esc(a.id)}" title="remover">×</button></td></tr>`
    : `<tr><td>${esc(a.ordem)}</td><td class="meta">${esc(MAN_SETOR[a.setor] || "—")}</td><td>${esc(a.atividade)}</td><td>${manTagSit(a.situacao)}</td><td class="meta">${esc(manFunc(a.executante_id) || a.executante_nome || "—")}</td>
      <td>${esc(manAtivDiaHora(a.data_inicio, a.inicio))}</td><td>${esc(manAtivDiaHora(a.data_fim, a.fim))}</td><td class="meta">${esc(a.observacao || "")}</td><td></td></tr>`).join("");
  if(pode){
    _manAtivs.forEach(a => { const tr = tb.querySelector(`tr[data-a="${a.id}"]`); if(!tr) return;
      tr.querySelector('[data-c="setor"]').value = a.setor || ""; tr.querySelector('[data-c="situacao"]').value = a.situacao; tr.querySelector('[data-c="executante_id"]').value = a.executante_id || ""; });
    tb.querySelectorAll('textarea[data-c="atividade"]').forEach(el => { manAtivAltura(el); el.addEventListener("input", () => manAtivAltura(el)); });   // lote S50 (#148)
    tb.querySelectorAll(".man-a-f").forEach(el => el.addEventListener("change", async () => {
      const id = el.closest("tr").dataset.a, c = el.dataset.c; let v = el.value;
      if(c === "atividade" && !v.trim()){ aviso("app-aviso", "A atividade não pode ficar vazia.", "erro"); return; }
      if(["setor", "executante_id", "inicio", "fim", "observacao", "data_inicio", "data_fim"].includes(c)) v = v.trim ? (v.trim() || null) : (v || null);
      const upd = { [c]: v };
      const atv = _manAtivs.find(x => x.id === id);
      // lote S54 (#169): "Executado" sem fim preenche dia e hora de hoje; hora digitada sem dia assume o início da OS (ou hoje)
      if(c === "situacao" && v === "executado" && atv){ if(!atv.fim) upd.fim = new Date().toTimeString().slice(0, 5); if(!atv.data_fim) upd.data_fim = hojeISO(); }
      if(c === "inicio" && v && atv && !atv.data_inicio) upd.data_inicio = _manAtual?.data_inicio || hojeISO();
      if(c === "fim" && v && atv && !atv.data_fim) upd.data_fim = atv.data_inicio || _manAtual?.data_inicio || hojeISO();
      if((c === "data_inicio" || c === "data_fim") && v && atv){
        const outro = c === "data_inicio" ? atv.data_fim : atv.data_inicio;
        if(outro && (c === "data_inicio" ? v > outro : v < outro)){ aviso("app-aviso", "O dia de fim precisa ser igual ou posterior ao dia de início.", "erro"); el.value = atv[c] || ""; return; }
        const ini = _manAtual?.data_inicio, fim = _manAtual?.data_conclusao;
        if((ini && v < ini) || (fim && v > fim)) aviso("app-aviso", `Dia fora do período da OS (${dataBR(ini)}${fim ? " a " + dataBR(fim) : " em diante"}): gravado assim mesmo.`, "aviso");
      }
      const { error } = await sb.from("manutencao_atividades").update(upd).eq("id", id);
      if(error){ aviso("app-aviso", "Não foi possível salvar a atividade: " + error.message, "erro"); return; }
      if(atv) Object.assign(atv, upd);
      if(c === "situacao" || Object.keys(upd).length > 1) manRenderAtivs();
    }));
    tb.querySelectorAll(".man-a-rem").forEach(b => b.addEventListener("click", async () => {
      const { error } = await sb.from("manutencao_atividades").delete().eq("id", b.dataset.a);
      if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
      await abrirManutencao(_manAtual.id); manAtivarTab("atividades");
    }));
  }
  // itens do plano da TAG que ainda não estão na OS
  const sel = $("man-a-plano");
  const ja = new Set(_manAtivs.map(a => a.plano_item_id).filter(Boolean));
  const itens = _manAtual?.equipamento_id ? _manPrev.filter(i => i.equipamento_id === _manAtual.equipamento_id && !ja.has(i.item_id)).sort((a, b) => MAN_SEM_ORDEM[a.semaforo] - MAN_SEM_ORDEM[b.semaforo] || a.ordem - b.ordem) : [];
  sel.innerHTML = `<option value="">— item do plano —</option>` + itens.map(i => `<option value="${esc(i.item_id)}">${esc(MAN_SEMAFORO[i.semaforo]?.[0] || "")} · ${esc(manAtividadeTxt(i))} (${esc(manRestanteTxt(i))})</option>`).join("");
}
async function manAtivAdd(){
  if(!_manAtual?.id) return;
  const itemId = $("man-a-plano").value || null;
  const it = itemId ? _manPrev.find(i => i.item_id === itemId) : null;
  const texto = $("man-a-texto").value.trim() || (it ? manAtividadeTxt(it) : "");
  if(!texto){ aviso("app-aviso", "Escreva a atividade ou escolha um item do plano.", "erro"); return; }
  const ordem = _manAtivs.length ? Math.max(..._manAtivs.map(a => a.ordem)) + 1 : 1;
  const { error } = await sb.from("manutencao_atividades").insert({ manutencao_id: _manAtual.id, ordem, setor: it?.setor || $("man-a-setor").value || null, atividade: texto, situacao: "pendente", plano_item_id: itemId });
  if(error){ aviso("app-aviso", "Não foi possível adicionar: " + error.message, "erro"); return; }
  if(it){ // kit do item vira material da OS
    const { data: kit } = await sb.from("manutencao_plano_materiais").select("produto_id,descricao,codigo_peca,quantidade,produto:produtos(codigo,nome,unidade,custo_ultimo)").eq("plano_item_id", itemId);
    if(kit?.length) await sb.from("manutencao_materiais").insert(kit.map(k => ({ manutencao_id: _manAtual.id, produto_id: k.produto_id, descricao: k.produto ? `${k.produto.codigo} — ${k.produto.nome}` : k.descricao, unidade: k.produto?.unidade || "un", quantidade: k.quantidade, custo_unitario: Number(k.produto?.custo_ultimo || 0), codigo_peca: k.codigo_peca, plano_item_id: itemId, origem: "app" })));
    const ids = new Set(_manAtual.plano_item_ids || []); ids.add(itemId);
    await sb.from("manutencoes").update({ plano_item_ids: [...ids] }).eq("id", _manAtual.id);
  }
  $("man-a-texto").value = ""; $("man-a-plano").value = "";
  await abrirManutencao(_manAtual.id); manAtivarTab("atividades");
}

/* mão de obra */
function manRenderHoras(){
  const tb = $("man-horas"), pode = manPodeEditar() && _manAtual?.status !== "cancelada";
  if(!_manHoras.length){ tb.innerHTML = `<tr><td colspan="7" class="vazio">${_manAtual?.id ? "Nenhuma hora lançada." : "Salve a OS para lançar horas."}</td></tr>`; $("man-horas-total").textContent = ""; return; }
  tb.innerHTML = _manHoras.map(h => `<tr><td>${esc(manFunc(h.funcionario_id) || h.funcionario_nome || "—")}</td><td>${dataBR(h.data)}</td><td>${h.inicio ? esc(String(h.inicio).slice(0, 5)) : "—"}</td><td>${h.fim ? esc(String(h.fim).slice(0, 5)) : "—"}</td>
    <td class="num">${num(h.horas)}</td><td class="meta">${esc(h.observacao || "")}${h.codigo_externo ? " · planilha" : ""}</td>
    <td>${pode ? `<button type="button" class="btn-sec btn-sm txt-perigo man-h-rem" data-id="${esc(h.id)}" title="remover">×</button>` : ""}</td></tr>`).join("");
  const porF = {}; _manHoras.forEach(h => { const n = manFunc(h.funcionario_id) || h.funcionario_nome || "sem funcionário"; porF[n] = (porF[n] || 0) + Number(h.horas || 0); });
  $("man-horas-total").innerHTML = `Total: <strong>${num(_manHoras.reduce((t, h) => t + Number(h.horas || 0), 0))} h</strong> · ` + Object.entries(porF).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${esc(n)} ${num(v)} h`).join(" · ");
  tb.querySelectorAll(".man-h-rem").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("manutencao_horas").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await abrirManutencao(_manAtual.id); manAtivarTab("horas");
  }));
}
async function manAddHoras(){
  if(!_manAtual?.id) return;
  const reg = { manutencao_id: _manAtual.id, funcionario_id: $("man-h-func").value || null, data: $("man-h-data").value || hojeISO(),
    inicio: $("man-h-inicio").value || null, fim: $("man-h-fim").value || null, horas: $("man-h-horas").value === "" ? null : Number($("man-h-horas").value), observacao: $("man-h-obs").value.trim() || null };
  if(!reg.funcionario_id){ aviso("app-aviso", "Escolha o funcionário.", "erro"); return; }
  if(!(reg.inicio && reg.fim) && reg.horas == null){ aviso("app-aviso", "Informe início e fim (o sistema calcula as horas) ou as horas.", "erro"); return; }
  if(reg.inicio && reg.fim) reg.horas = 0;   // o gatilho calcula
  const { error } = await sb.from("manutencao_horas").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível lançar: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  ["man-h-inicio", "man-h-fim", "man-h-horas", "man-h-obs"].forEach(id => $(id).value = "");
  await abrirManutencao(_manAtual.id); manAtivarTab("horas");
}

/* materiais */
function manRenderMats(){
  const tb = $("man-mats"), pode = manPodeMateriais() && _manAtual?.status !== "cancelada";
  if(!_manMats.length){ tb.innerHTML = `<tr><td colspan="8" class="vazio">${_manAtual?.id ? "Nenhuma peça lançada." : "Salve a OS para lançar peças."}</td></tr>`; return; }
  tb.innerHTML = _manMats.map(i => {
    const baixa = i.movimentacao_estoque_id ? '<span class="tag verde">baixada no estoque</span>' : i.origem === "planilha" ? '<span class="tag cinza" title="histórico da planilha: não mexe no estoque">planilha</span>'
      : i.tipo === "retirada" ? '<span class="meta">—</span>' : !i.produto_id ? '<span class="meta" title="sem produto no catálogo: só texto">sem cadastro</span>' : '<span class="tag ambar">pendente</span>';
    return `<tr><td>${i.produto_id ? linkProduto(i.produto_id, i.descricao) : esc(i.descricao)}${i.codigo_peca ? ` <span class="meta">${esc(i.codigo_peca)}</span>` : ""}${i.plano_item_id ? ' <span class="tag azul" title="kit do item do plano">kit</span>' : ""}</td><td>${esc(i.unidade || "un")}</td><td class="num">${num(i.quantidade)}</td>
      <td class="num">${brl(i.custo_unitario)}</td><td class="num">${brl(Number(i.quantidade) * Number(i.custo_unitario))}</td><td>${i.tipo === "retirada" ? "Retirada" : "Consumo"}</td><td>${baixa}</td>
      <td>${pode && !i.movimentacao_estoque_id ? `<button type="button" class="btn-sec btn-sm txt-perigo man-mat-rem" data-id="${esc(i.id)}" title="remover">×</button>` : ""}</td></tr>`; }).join("");
  tb.querySelectorAll(".man-mat-rem").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("manutencao_materiais").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await abrirManutencao(_manAtual.id); manAtivarTab("materiais");
  }));
}
async function manAddMat(p, textoLivre){
  if(!_manAtual?.id) return;
  const qtd = Number($("man-prod-qtd").value || 1);
  if(!(qtd > 0)){ aviso("app-aviso", "Informe a quantidade.", "erro"); return; }
  const reg = p ? { manutencao_id: _manAtual.id, produto_id: p.id, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || "un", quantidade: qtd, custo_unitario: Number(p.custo_ultimo || 0), tipo: $("man-prod-tipo").value, origem: "app" }
    : { manutencao_id: _manAtual.id, produto_id: null, descricao: textoLivre, unidade: "un", quantidade: qtd, custo_unitario: 0, tipo: $("man-prod-tipo").value, origem: "app" };
  if(!reg.descricao){ aviso("app-aviso", "Informe a peça.", "erro"); return; }
  const { error } = await sb.from("manutencao_materiais").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível lançar a peça: " + error.message, "erro"); return; }
  $("man-prod-qtd").value = 1; $("man-mat-texto").value = "";
  await abrirManutencao(_manAtual.id); manAtivarTab("materiais");
}
function manRenderCustos(){
  const m = _manAtual, c = $("man-custos"); if(!m || !c) return;
  const pode = manPodeEditar() && !!m.id;
  const horas = _manHoras.reduce((t, h) => t + Number(h.horas || 0), 0);
  c.innerHTML = `<div class="custos-resumo">
      <div><div class="mov-ace-sug-grupo-t">Composição do custo</div>
        <div class="custos-linha"><span>Serviço externo (fornecedor)</span><strong>${brl(m.custo || 0)}</strong></div>
        <div class="custos-linha"><span>Peças consumidas</span><strong>${brl(m.custo_pecas || 0)}</strong></div>
        <div class="custos-linha"><span>Mão de obra (${num(horas)} h × ${_manCfg.custo_hora_oficina ? brl(_manCfg.custo_hora_oficina) : "hora não definida"})</span><strong>${brl(m.custo_horas || 0)}</strong></div>
        <div class="custos-linha"><span><strong>Custo real</strong>${m.custo_manual ? " <span class=\"tag ambar\">digitado</span>" : ""}</span><strong>${brl(m.custo_real || 0)}</strong></div>
      </div>
      <div><div class="mov-ace-sug-grupo-t">Custo digitado à mão</div>
        <p class="meta">Use quando o custo real não sai do serviço, das peças e das horas (OS antiga da planilha).</p>
        ${pode ? `<label class="check-inline"><input type="checkbox" id="man-custo-manual"${m.custo_manual ? " checked" : ""} /> custo manual</label>
          <input type="number" id="man-custo-valor" min="0" step="0.01" value="${esc(m.custo_real || 0)}" style="width:140px;"${m.custo_manual ? "" : " disabled"} />
          <button type="button" class="btn-sec btn-sm" id="btn-man-custo-salvar">💾 Salvar custo</button>` : ""}
      </div></div>
    <p class="meta">Concluída, a OS entra em Custos da TAG em até três linhas: serviço externo, peças e mão de obra. A baixa das peças no estoque não conta de novo.</p>`;
  $("man-custo-manual")?.addEventListener("change", e => { $("man-custo-valor").disabled = !e.target.checked; });
  $("btn-man-custo-salvar")?.addEventListener("click", async () => {
    const manual = $("man-custo-manual").checked;
    const upd = manual ? { custo_manual: true, custo_real: Number($("man-custo-valor").value || 0) } : { custo_manual: false };
    const { error } = await sb.from("manutencoes").update(upd).eq("id", m.id);
    if(error){ aviso("app-aviso", "Não foi possível salvar o custo: " + error.message, "erro"); return; }
    aviso("app-aviso", manual ? "Custo manual salvo." : "Custo volta a ser serviço + peças + horas.", "ok");
    await abrirManutencao(m.id); manAtivarTab("materiais");
  });
}

/* checklist da OS */
function manRenderChecklistOS(){
  const m = _manAtual, box = $("man-check-os"); if(!m || !box) return;
  const lista = _manChecksOS.slice();
  const redesenhar = () => abrirManutencao(m.id).then(() => manAtivarTab("checklist"));
  box.innerHTML = `${lista.length ? `<div class="tabela-rola"><table><thead><tr><th>Data</th><th class="num">Horímetro</th><th>Resultado</th><th class="num">Não ok</th><th></th></tr></thead>
      <tbody>${lista.map(c => `<tr><td>${dataBR(c.data)}</td><td class="num">${c.horimetro != null ? num(c.horimetro) : "—"}</td><td>${manTagRes(c.resultado)}</td><td class="num">${manCheckNaoOk(c) || "—"}</td>
        <td class="col-acao"><button type="button" class="btn-sec btn-sm man-os-ck-abrir" data-id="${esc(c.id)}">Abrir</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="vazio">${m.id ? "Nenhum checklist ligado a esta OS." : "Salve a OS antes."}</p>`}
    ${m.id && m.equipamento_id && manPodeChecklist() && m.status !== "cancelada" ? `<button type="button" class="btn-sec btn-sm" id="btn-man-os-ck-novo" style="margin-top:6px;">+ Checklist desta TAG ligado à OS</button>` : ""}
    <p class="meta" style="margin-top:8px;">Item "não ok" do checklist vira atividade desta OS pelo botão "Gerar OS corretiva" dentro do checklist.</p>`;
  box.querySelectorAll(".man-os-ck-abrir").forEach(b => b.addEventListener("click", () => manCheckAbrir(b.dataset.id, redesenhar)));
  $("btn-man-os-ck-novo")?.addEventListener("click", () => manCheckCriar({ equipamento_id: m.equipamento_id, manutencao_id: m.id, horimetro: m.horimetro_km ?? undefined, km: m.km ?? undefined }, redesenhar));
}

/* anexos */
async function manRenderAnexos(){
  const box = $("man-anexos"); if(!box) return;
  if(!_manAnexos.length){ box.innerHTML = `<p class="vazio">${_manAtual?.id ? "Nenhum anexo." : "Salve a OS para anexar fotos e documentos."}</p>`; return; }
  const faltam = _manAnexos.map(a => a.storage_path).filter(p => !_manAnexoUrl[p] || _manAnexoUrl[p].expira < Date.now() + 60000);
  if(faltam.length){
    const { data } = await sb.storage.from(MAN_ANEXO_BUCKET).createSignedUrls(faltam, 3600);
    (data || []).forEach(d => { if(d.signedUrl && d.path) _manAnexoUrl[d.path] = { url: d.signedUrl, expira: Date.now() + 3600 * 1000 }; });
  }
  const pode = manPodeMateriais();
  box.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Arquivo</th><th>Legenda</th><th>Enviado</th><th class="num">Tamanho</th><th class="col-acao"></th></tr></thead>
    <tbody>${_manAnexos.map(a => { const u = _manAnexoUrl[a.storage_path]?.url; const img = /^image\//.test(a.mime_type || "");
      return `<tr><td>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${img ? `<img src="${esc(u)}" alt="" style="height:48px;vertical-align:middle;margin-right:6px;" />` : "📄 "}${esc(a.nome)}</a>` : esc(a.nome)}</td>
        <td class="meta">${esc(a.legenda || "")}</td><td class="meta">${a.created_at ? dataBR(String(a.created_at).slice(0, 10)) : ""}</td><td class="num meta">${a.tamanho_bytes ? num(Math.round(a.tamanho_bytes / 1024)) + " KB" : ""}</td>
        <td class="col-acao">${pode ? `<button type="button" class="btn-sec btn-sm txt-perigo man-anexo-rem" data-id="${esc(a.id)}" data-path="${esc(a.storage_path)}" title="remover">×</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
  box.querySelectorAll(".man-anexo-rem").forEach(b => b.addEventListener("click", async () => {
    if(!confirm("Remover este anexo?")) return;
    const { error } = await sb.from("manutencao_anexos").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await sb.storage.from(MAN_ANEXO_BUCKET).remove([b.dataset.path]);
    await abrirManutencao(_manAtual.id); manAtivarTab("anexos");
  }));
}
async function manEnviarAnexos(){
  const m = _manAtual; if(!m?.id) return;
  const arquivos = [...($("man-anexo-arq").files || [])];
  if(!arquivos.length){ aviso("app-aviso", "Escolha o arquivo.", "erro"); return; }
  const legenda = $("man-anexo-legenda").value.trim() || null;
  const falhas = [];
  for(const f of arquivos){
    const ext = (String(f.name).split(".").pop() || "").toLowerCase();
    const mime = MAN_ANEXO_MIME[ext];
    if(!mime){ falhas.push(`${f.name}: tipo não aceito.`); continue; }
    if(f.size > 20 * 1024 * 1024){ falhas.push(`${f.name}: acima de 20 MB.`); continue; }
    // supabase-js ignora contentType quando o corpo é File: reembala em Blob com o MIME da extensão
    const corpo = f.type === mime ? f : new Blob([f], { type: mime });
    const caminho = `${m.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb.storage.from(MAN_ANEXO_BUCKET).upload(caminho, corpo, { cacheControl: "3600", contentType: mime, upsert: false });
    if(up.error){ falhas.push(`${f.name}: ${up.error.message}`); continue; }
    const ins = await sb.from("manutencao_anexos").insert({ manutencao_id: m.id, storage_path: caminho, nome: f.name, mime_type: mime, tamanho_bytes: f.size, legenda });
    if(ins.error){ await sb.storage.from(MAN_ANEXO_BUCKET).remove([caminho]); falhas.push(`${f.name}: ${ins.error.message}`); }
  }
  $("man-anexo-arq").value = ""; $("man-anexo-legenda").value = "";
  if(falhas.length) aviso("app-aviso", "Não enviado: " + falhas.join(" · "), "erro"); else aviso("app-aviso", "Anexo(s) enviado(s).", "ok");
  await abrirManutencao(m.id); manAtivarTab("anexos");
}

/* impressão no leiaute do modelo de OS do Bruno (html2pdf; estilo inline, fora do CSS do app) */
async function manImprimirOS(){
  const m = _manAtual; if(!m?.id) return;
  const e = m.equipamento || manEq(m.equipamento_id) || {};
  const td = "border:1px solid #444;padding:3px 5px;font-size:10px;vertical-align:top;";
  const th = td + "background:#ddd;font-weight:700;";
  const setores = [...new Set(_manAtivs.map(a => a.setor || "outros"))];
  const ativHTML = setores.map(s => `<tr><td colspan="6" style="${th}text-transform:uppercase;">${esc(MAN_SETOR[s] || s)}</td></tr>` +
    _manAtivs.filter(a => (a.setor || "outros") === s).map(a => `<tr><td style="${td}text-align:center;">${esc(a.ordem)}</td><td style="${td}">${esc(a.atividade)}</td><td style="${td}">${esc(MAN_SITUACAO[a.situacao]?.[0] || "")}</td>
      <td style="${td}">${esc(manFunc(a.executante_id) || a.executante_nome || "")}</td><td style="${td}">${esc(manAtivDiaHora(a.data_inicio, a.inicio, ""))}</td><td style="${td}">${esc(manAtivDiaHora(a.data_fim, a.fim, ""))}</td></tr>`).join("")).join("");   // lote S54 (#169): dia e hora
  const vazias = Math.max(0, 8 - _manAtivs.length);
  const linhasVazias = Array.from({ length: vazias }, (_, i) => `<tr><td style="${td}text-align:center;">${_manAtivs.length + i + 1}</td><td style="${td}">&nbsp;</td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td><td style="${td}"></td></tr>`).join("");
  const mats = _manMats.map((i, k) => `<tr><td style="${td}text-align:center;">${k + 1}</td><td style="${td}">${esc(i.descricao)}${i.codigo_peca ? " · " + esc(i.codigo_peca) : ""}</td><td style="${td}text-align:right;">${num(i.quantidade)} ${esc(i.unidade || "un")}</td><td style="${td}">${i.movimentacao_estoque_id ? "baixado no estoque" : i.tipo === "retirada" ? "retirada" : ""}</td></tr>`).join("")
    + Array.from({ length: Math.max(0, 4 - _manMats.length) }, (_, k) => `<tr><td style="${td}text-align:center;">${_manMats.length + k + 1}</td><td style="${td}">&nbsp;</td><td style="${td}"></td><td style="${td}"></td></tr>`).join("");
  const horas = _manHoras.map(h => `<tr><td style="${td}">${esc(manFunc(h.funcionario_id) || h.funcionario_nome || "")}</td><td style="${td}">${dataBR(h.data)}</td><td style="${td}">${h.inicio ? esc(String(h.inicio).slice(0, 5)) : ""}</td><td style="${td}">${h.fim ? esc(String(h.fim).slice(0, 5)) : ""}</td><td style="${td}text-align:right;">${num(h.horas)}</td></tr>`).join("");
  const el = document.createElement("div");
  el.style.cssText = "font-family:Arial,Helvetica,sans-serif;color:#000;width:100%;";
  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr><td style="${td}font-size:16px;font-weight:700;text-align:center;" colspan="4">ORDEM DE SERVIÇO<br/><span style="font-size:12px;">${esc((MAN_TIPO[m.tipo] || m.tipo).toUpperCase())}</span></td><td style="${td}" colspan="2"><strong>Nº:</strong> ${esc(m.numero || "")}${m.codigo_externo ? `<br/><span style="font-size:9px;">planilha: ${esc(m.codigo_externo)}</span>` : ""}<br/><strong>DATA:</strong> ${dataBR(m.data_inicio || m.data_prevista)}</td></tr>
      <tr><td style="${td}" colspan="4"><strong>EQUIPAMENTO:</strong> ${esc(e.nome || "")}</td><td style="${td}" colspan="2"><strong>STATUS:</strong> ${esc(MAN_STATUS[m.status]?.[0] || m.status)}</td></tr>
      <tr><td style="${th}">LOCAL</td><td style="${th}">TAG</td><td style="${th}">ODÔMETRO (km)</td><td style="${th}">HORÍMETRO</td><td style="${th}">SETOR</td><td style="${th}">RESPONSÁVEL</td></tr>
      <tr><td style="${td}">${esc(m.local || "CGL FUNDAÇÕES")}</td><td style="${td}">${esc(e.codigo || "")}</td><td style="${td}">${m.km != null ? num(m.km) : ""}</td><td style="${td}">${m.horimetro_km != null ? num(m.horimetro_km) : ""}</td><td style="${td}">${esc(MAN_SETOR[m.setor] || "")}</td><td style="${td}">${esc(manFunc(m.responsavel_id))}</td></tr>
      <tr><td style="${th}" colspan="6">DESCRIÇÃO DO SERVIÇO</td></tr>
      <tr><td style="${td}min-height:30px;" colspan="6">${esc(m.descricao || "")}${m.observacoes ? `<br/><span style="font-size:9px;">${esc(m.observacoes)}</span>` : ""}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr><td style="${th}" colspan="2">ITENS PADRÃO</td><td style="${th}width:60px;">SITUAÇÃO</td></tr>
      <tr><td style="${td}width:30px;">P01</td><td style="${td}">VERIFICAR A VALIDADE DO EXTINTOR DE INCÊNDIO, INTEGRIDADE DO LACRE E SELO</td><td style="${td}"></td></tr>
      <tr><td style="${td}">P02</td><td style="${td}">ESTADO GERAL DOS ADESIVOS E DA PINTURA DA MÁQUINA</td><td style="${td}"></td></tr>
      <tr><td style="${td}">P03</td><td style="${td}">VERIFICAR ITENS PENDENTES NO LIVRO DE MANUTENÇÃO DA MÁQUINA</td><td style="${td}"></td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr><td style="${th}width:30px;">ITEM</td><td style="${th}">ATIVIDADE</td><td style="${th}width:70px;">SITUAÇÃO</td><td style="${th}width:110px;">EXECUTANTE</td><td style="${th}width:78px;">INÍCIO (DIA · HORA)</td><td style="${th}width:78px;">CONCLUSÃO (DIA · HORA)</td></tr>
      ${ativHTML}${/* html */ linhasVazias}
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr><td style="${th}" colspan="4">MATERIAIS NECESSÁRIOS / UTILIZADOS</td></tr>
      <tr><td style="${th}width:30px;">ITEM</td><td style="${th}">DESCRIÇÃO</td><td style="${th}width:80px;">QTD</td><td style="${th}width:120px;">ESTOQUE</td></tr>
      ${/* html */ mats}
    </table>
    ${_manHoras.length ? `<table style="width:100%;border-collapse:collapse;margin-bottom:6px;">
      <tr><td style="${th}" colspan="5">APROPRIAÇÃO DE MÃO DE OBRA</td></tr>
      <tr><td style="${th}">NOME</td><td style="${th}width:70px;">DATA</td><td style="${th}width:60px;">INÍCIO</td><td style="${th}width:60px;">FIM</td><td style="${th}width:60px;">HORAS</td></tr>${/* html */ horas}</table>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-top:28px;">
      <tr><td style="${th}" colspan="3">RESPONSÁVEIS TÉCNICOS</td></tr>
      <tr><td style="${td}height:44px;vertical-align:bottom;text-align:center;font-size:9px;">_______________________________<br/>EXECUTANTE</td><td style="${td}height:44px;vertical-align:bottom;text-align:center;font-size:9px;">_______________________________<br/>GESTOR DA MANUTENÇÃO</td><td style="${td}height:44px;vertical-align:bottom;text-align:center;font-size:9px;">_______________________________<br/>OPERADOR / ENCARREGADO</td></tr>
    </table>`;
  try { await pdfGerar(el, { filename: `${m.numero || "OS"}_TAG-${e.codigo || ""}.pdf` }); }
  catch(err){ aviso("app-aviso", "Não foi possível gerar o PDF: " + err.message, "erro"); }
}

/* ---------- ficha do equipamento: plano, semáforo e leituras (js/equipamentos.js chama) ---------- */
async function manRenderResumoEquipamento(e, containerId){
  const box = $(containerId); if(!box || !e?.id) return;
  const [pv, lei] = await Promise.all([
    sb.from("vw_manutencao_preventiva").select("*").eq("equipamento_id", e.id).order("ordem"),
    sb.from("equipamento_leituras").select("id,data,horimetro,km,origem,motivo,created_at").eq("equipamento_id", e.id).order("data", { ascending: false }).order("created_at", { ascending: false }).limit(12)
  ]);
  const itens = pv.data || [], leituras = lei.data || [];
  const n = { critico: 0, atencao: 0, ok: 0, sem_base: 0 }; itens.forEach(i => n[i.semaforo] = (n[i.semaforo] || 0) + 1);
  const pior = ["critico", "atencao", "sem_base", "ok"].find(s => n[s] > 0);
  const pode = manPodeEditar();
  const orig = { rdo_abastecimento: "abastecimento do RDO", os: "OS concluída", checklist: "checklist", manual: "ajuste manual", viagem: "chegada de viagem", planilha: "planilha do Bruno" };
  const prox = itens.filter(i => i.restante != null).sort((a, b) => Number(a.restante) - Number(b.restante)).slice(0, 5);
  box.innerHTML = `<div class="lista-topo compacta"><h3 class="titulo-bloco" style="margin:0;">Plano preventivo</h3>
      <span style="margin-left:8px;">${itens.length ? manTagSem(pior) : '<span class="tag cinza">sem plano</span>'}</span>
      <span class="meta" style="margin-left:8px;">${itens.length ? `${itens.length} itens · ${esc(n.critico)} crítico(s), ${esc(n.atencao)} em atenção` : ""}</span>
      ${pode ? `<button type="button" class="btn-sec btn-sm" id="btn-eqp-man-plano" style="margin-left:auto;">${itens.length ? "Abrir plano" : "+ Criar plano"}</button>${itens.length && (n.critico || n.atencao) ? ` <button type="button" class="btn btn-sm" id="btn-eqp-man-gerar">⚙ Gerar OS preventiva</button>` : ""}` : (itens.length ? `<button type="button" class="btn-sec btn-sm" id="btn-eqp-man-plano" style="margin-left:auto;">Ver plano</button>` : "")}
    </div>
    ${prox.length ? `<div class="tabela-rola"><table><thead><tr><th>Item</th><th class="num">Periodicidade</th><th class="num">Próxima</th><th>Restante</th><th>Semáforo</th></tr></thead>
      <tbody>${prox.map(i => `<tr><td>${esc(manAtividadeTxt(i))}</td><td class="num">${esc(manPer(i))}</td><td class="num">${esc(manProxTxt(i))}</td><td>${esc(manRestanteTxt(i))}</td><td>${manTagSem(i.semaforo)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="lista-topo compacta" style="margin-top:14px;"><h3 class="titulo-bloco" style="margin:0;">Leituras de horímetro e km</h3>
      <span class="meta" style="margin-left:8px;">atual: <strong>${e.horimetro != null ? num(e.horimetro) + " h" : "—"}</strong>${e.km != null ? ` · <strong>${num(e.km)} km</strong>` : ""}</span>
      ${pode ? `<button type="button" class="btn-sec btn-sm" id="btn-eqp-man-ajuste" style="margin-left:auto;">✎ Ajustar leitura</button>` : ""}
    </div>
    ${leituras.length ? `<div class="tabela-rola"><table><thead><tr><th>Data</th><th class="num">Horímetro</th><th class="num">km</th><th>Origem</th><th>Motivo</th></tr></thead>
      <tbody>${leituras.map(l => `<tr><td>${dataBR(l.data)}</td><td class="num">${l.horimetro != null ? num(l.horimetro) : "—"}</td><td class="num">${l.km != null ? num(l.km) : "—"}</td><td class="meta">${esc(orig[l.origem] || l.origem)}</td><td class="meta">${esc(l.motivo || "")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="meta">Nenhuma leitura registrada. O abastecimento do RDO com horímetro, a OS concluída, o checklist e a chegada de viagem alimentam esta lista.</p>`}`;
  $("btn-eqp-man-plano")?.addEventListener("click", async () => { if(!irParaSecao("manutencao")) return; await manCarregarBase(); if(!itens.length && pode){ await manFetchPrev(); manPlanoNovo(e.id); } else manAbrirPlano(e.id); });
  $("btn-eqp-man-gerar")?.addEventListener("click", async () => { await manCarregarBase(); await manGerarPreventiva(e.id, null); if(_manAtual) irParaSecao("manutencao"); });
  $("btn-eqp-man-ajuste")?.addEventListener("click", () => manLeituraAbrir(e, () => { if(typeof abrirEquipamento === "function") abrirEquipamento(e.id); }));
}
function manLeituraAbrir(e, aoSalvar){
  if(!manPodeEditar()){ aviso("app-aviso", "Seu perfil não ajusta horímetro.", "erro"); return; }
  _manLeituraEq = { e, aoSalvar };
  $("man-leitura-titulo").textContent = `Ajustar horímetro / km · TAG ${e.codigo}`;
  $("man-l-hor").value = e.horimetro ?? ""; $("man-l-km").value = e.km ?? ""; $("man-l-motivo").value = "";
  $("man-leitura-modal").style.display = "flex";
}
async function manLeituraSalvar(){
  const ctx = _manLeituraEq; if(!ctx) return;
  const hor = $("man-l-hor").value === "" ? null : Number($("man-l-hor").value), km = $("man-l-km").value === "" ? null : Number($("man-l-km").value), motivo = $("man-l-motivo").value.trim();
  if(!motivo){ aviso("app-aviso", "Informe o motivo do ajuste.", "erro"); return; }
  const { error } = await sb.rpc("equipamento_ajustar_leitura", { p_equipamento_id: ctx.e.id, p_horimetro: hor, p_km: km, p_motivo: motivo });
  if(error){ aviso("app-aviso", "Não foi possível ajustar: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  $("man-leitura-modal").style.display = "none";
  aviso("app-aviso", "Leitura ajustada e registrada.", "ok");
  const eq = manEq(ctx.e.id); if(eq){ if(hor != null) eq.horimetro = hor; if(km != null) eq.km = km; }
  if(typeof ctx.aoSalvar === "function") ctx.aoSalvar();
  if(typeof carregarEquipamentos === "function") carregarEquipamentos(true);
}

/* ---------- atalhos da Sala de Comando ---------- */
async function manAbrirPreset(nome, eqId){
  await manCarregarBase();
  if(nome === "os_atrasadas"){ _manView = "os"; $("man-f-status").value = "_atrasadas"; }
  else if(nome === "preventivas_critico" || nome === "preventivas_atencao"){
    if(eqId){ await manFetchPrev(); manAbrirPlano(eqId); return; }
    _manView = "preventivas"; $("man-f-semaforo").value = nome === "preventivas_critico" ? "critico" : "atencao";
  }
  await carregarManutencao(false);
}

/* ---------- buscas de produto (ficha da OS e kit do item) ---------- */
function manLigarBuscaProduto(inpId, listaId, aoEscolher){
  const inp = $(inpId), lista = $(listaId); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(async () => {
    const t = inp.value.trim().replace(/[%,()]/g, " ");
    if(t.length < 2){ lista.style.display = "none"; return; }
    const { data } = await sb.from("produtos").select("id,codigo,nome,unidade,estoque_atual,custo_ultimo").eq("ativo", true).or(`nome.ilike.%${t}%,codigo.ilike.%${t}%,codigo_barras.eq.${t}`).order("nome").limit(25);
    const res = data || [];
    lista.innerHTML = res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")} · ${brl(p.custo_ultimo || 0)}</span></div>`).join("")
      || `<div class="resultado-item vazio">Nenhum produto.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("mousedown", ev => { ev.preventDefault(); inp.value = ""; lista.style.display = "none"; aoEscolher(res.find(x => x.id === d.dataset.id)); }));
  }, 250));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 150));
}

/* ---------- ligação ---------- */
function ligarManutencao(){
  if(!$("sec-manutencao")) return;
  document.querySelector('nav button[data-secao="manutencao"]')?.addEventListener("click", () => carregarManutencao(false));
  document.querySelectorAll("#man-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _manView = b.dataset.view; renderManutencao(); }));
  ["man-busca", "man-prev-busca", "man-check-busca"].forEach(id => $(id)?.addEventListener("input", debounce(renderManutencao)));
  ["man-f-tag", "man-f-tipo", "man-f-setor", "man-f-status", "man-f-resp", "man-f-visao", "man-f-semaforo", "man-f-tipo-eq", "man-f-check-res"].forEach(id => $(id)?.addEventListener("change", renderManutencao));
  $("man-f-periodo")?.addEventListener("change", async () => { await manFetchOS(); manRenderKpis(); renderManutencao(); });
  $("man-plano-tag")?.addEventListener("change", () => { _manPlanoEq = $("man-plano-tag").value || null; renderManutencao(); });
  $("btn-man-atualizar")?.addEventListener("click", () => carregarManutencao(true));
  $("btn-man-nova-os")?.addEventListener("click", () => manNovaOS(null));
  $("btn-man-novo-plano")?.addEventListener("click", () => manPlanoNovo(null));
  $("btn-man-novo-check")?.addEventListener("click", () => manCheckNovo(null));
  $("man-indicadores")?.addEventListener("click", e => {
    const el = e.target.closest(".ind-click"); if(!el) return;
    const k = el.dataset.kpi;
    if(k === "abertas"){ _manView = "os"; $("man-f-status").value = "_abertas"; }
    else if(k === "atrasadas"){ _manView = "os"; $("man-f-status").value = "_atrasadas"; }
    else if(k === "concluidas_mes"){ _manView = "os"; $("man-f-status").value = "concluida"; }
    else if(k === "prev_critico"){ _manView = "preventivas"; $("man-f-semaforo").value = "critico"; }
    else if(k === "prev_atencao"){ _manView = "preventivas"; $("man-f-semaforo").value = "atencao"; }
    renderManutencao();
  });
  $("man-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a")) return;
    const bGerar = e.target.closest(".man-prev-gerar"); if(bGerar){ manGerarPreventiva(bGerar.dataset.eq, null); return; }
    const bPlano = e.target.closest(".man-prev-plano"); if(bPlano){ manAbrirPlano(bPlano.dataset.eq); return; }
    if(e.target.closest("button")) return;
    const os = e.target.closest("[data-id]"); if(os && _manView === "os"){ abrirManutencao(os.dataset.id); return; }
    const eq = e.target.closest("[data-eq]"); if(eq && (_manView === "preventivas" || _manView === "planos")){ manAbrirPlano(eq.dataset.eq); return; }
    const ck = e.target.closest("[data-check]"); if(ck && _manView === "checklists") manCheckAbrir(ck.dataset.check);
  });
  // ficha
  $("btn-man-voltar")?.addEventListener("click", mostrarPainelManutencao);
  $("btn-man-salvar")?.addEventListener("click", () => comBotaoTravado("btn-man-salvar", salvarManutencao));
  document.querySelectorAll("#man-ficha .man-acao").forEach(b => b.addEventListener("click", () => comBotaoTravado(b.id, () => manAcao(b.dataset.acao))));
  $("btn-man-imprimir")?.addEventListener("click", () => comBotaoTravado("btn-man-imprimir", manImprimirOS));
  document.querySelectorAll("#man-notebook button").forEach(b => b.addEventListener("click", () => manAtivarTab(b.dataset.tab)));
  document.querySelectorAll("#man-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => manAtivarTab(b.dataset.gotoTab)));
  $("sb-man-equip")?.addEventListener("click", () => { if(_manAtual?.equipamento_id && irParaSecao("equipamentos") && typeof abrirEquipamento === "function") abrirEquipamento(_manAtual.equipamento_id); });
  document.querySelectorAll("#man-statusbar .stage").forEach(el => el.addEventListener("click", () => {
    const novo = el.dataset.status; if(!_manAtual || !manPodeEditar()) return;
    if(!_manAtual.id){ aviso("app-aviso", "Salve a OS antes de mudar o status.", "erro"); return; }
    if(novo === _manAtual.status) return;
    if(novo === "concluida") manAcao("concluida"); else if(novo === "em_andamento") manAcao("em_andamento");
    else if(novo === "agendada" && _manAtual.status === "em_andamento") sb.from("manutencoes").update({ status: "agendada" }).eq("id", _manAtual.id).then(() => abrirManutencao(_manAtual.id));
  }));
  $("man-equip")?.addEventListener("change", () => { manHorAtual(); const e = manEq($("man-equip").value); if(e && !_manAtual?.id){ if($("man-hor").value === "" && e.horimetro != null) $("man-hor").value = e.horimetro; if($("man-km").value === "" && e.km != null) $("man-km").value = e.km; } });
  $("btn-man-a-add")?.addEventListener("click", () => comBotaoTravado("btn-man-a-add", manAtivAdd));
  $("man-a-texto")?.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); manAtivAdd(); } });
  $("btn-man-h-add")?.addEventListener("click", () => comBotaoTravado("btn-man-h-add", manAddHoras));
  $("btn-man-mat-texto")?.addEventListener("click", () => manAddMat(null, $("man-mat-texto").value.trim()));
  $("btn-man-anexo-enviar")?.addEventListener("click", () => comBotaoTravado("btn-man-anexo-enviar", manEnviarAnexos));
  manLigarBuscaProduto("man-prod-busca", "man-prod-res", p => manAddMat(p, null));
  // modais
  $("btn-man-item-fechar")?.addEventListener("click", () => { $("man-item-modal").style.display = "none"; renderManPlano(); });
  $("btn-man-item-salvar")?.addEventListener("click", () => comBotaoTravado("btn-man-item-salvar", manItemSalvar));
  $("man-i-unid")?.addEventListener("change", manItemUnidade);
  $("btn-man-i-mat-add")?.addEventListener("click", () => manItemMatAdd(null));
  manLigarBuscaProduto("man-i-prod-busca", "man-i-prod-res", p => manItemMatAdd(p));
  $("btn-man-plano-fechar")?.addEventListener("click", () => { $("man-plano-modal").style.display = "none"; });
  $("btn-man-plano-salvar")?.addEventListener("click", () => comBotaoTravado("btn-man-plano-salvar", manPlanoCriar));
  $("btn-man-check-fechar")?.addEventListener("click", manCheckFechar);
  $("btn-man-leitura-fechar")?.addEventListener("click", () => { $("man-leitura-modal").style.display = "none"; });
  $("btn-man-leitura-salvar")?.addEventListener("click", () => comBotaoTravado("btn-man-leitura-salvar", manLeituraSalvar));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarManutencao);
else ligarManutencao();

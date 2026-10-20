/* ====================================================================
   LOGÍSTICA — painel (fase 37 · Frota, 08/09/2026; fase 89 · viagem única, 19/10/2026)
   A viagem (tabela viagens, antiga tabela de deslocamentos da fase 37) é o registro central da logística:
   caminhão, motorista, data, origem → destino, km e custo (km × R$/km, colunas geradas no
   banco; o km atual do veículo acompanha a maior chegada registrada, por gatilho). Nota de
   remessa ou retorno (movimentacoes_ativos.viagem_id) e MDF-e (manifestos_mdfe.viagem_id)
   são documentos da viagem. Visões: Viagens (lista e kanban por status), Veículos (TAG,
   placa, km, R$/km, FIPE, onde está) e Documentos (notas sem viagem, MDF-e a encerrar).
   A ficha da viagem (prefixo vg-) fica em js/viagens.js, carregado depois deste arquivo.
   Escrita: logistica_pode_operar() no banco = logPodeOperar() aqui; veículos continuam pela
   policy de equipamentos (frotaPodeEditar). Localização de máquina vem da mobilização (fase 34).
   ==================================================================== */
let _frotaView = "viagens";          // viagens | veiculos | documentos
let _frotaModo = "lista";            // lista | kanban (visão Viagens)
let _frotaVeic = [];                 // equipamentos tipo caminhao/veiculo
let _frotaEquipOutros = [];          // demais equipamentos (atendidos, itens)
let _frotaFuncs = [];                // funcionários ativos (motoristas)
let _frotaObras = [];                // obras não canceladas (origem/destino, filtro)
let _frotaViagens = { chave: null, dados: [] };
let _frotaDocs = null;               // visão Documentos: { notas, mdfes, abertas }
let _frotaNotasSemViagem = null;     // indicador "notas sem viagem"
let _frotaVeicEditId = null;
let _frotaUltimaData;                // undefined = ainda não consultado; null = nenhuma viagem

const FROTA_TIPO_LBL = { caminhao: "Caminhão", veiculo: "Veículo" };
const FROTA_STATUS_LBL = { disponivel: "Disponível", em_uso: "Em uso", manutencao: "Manutenção", inativo: "Inativo" };
const VG_STAGES = ["planejada", "em_transito", "concluida"];
const VG_FINALIDADES = { mobilizacao: "Mobilização", desmobilizacao: "Desmobilização", apoio: "Apoio à obra", entrega_material: "Entrega de material", manutencao: "Manutenção", outro: "Outro" };
const VG_LOC = { base: "Base CGL", obra: "Obra", cliente: "Cliente", fornecedor_manutencao: "Fornecedor / manutenção" };
/* Mesma lista de logistica_pode_operar() (migration da fase 89); diretor entra por has_role() lá e aqui na lista. */
const VG_LOGISTICA_CARGOS = ["diretor", "admin", "logistica", "gestor_frota", "encarregado", "almoxarife", "engenheiro", "assistente_engenharia", "mecanico", "rh", "gestor_acessorios", "comercial"];

function logPodeOperar(){ return !!usuarioAtual && !ehSomenteLeitura() && VG_LOGISTICA_CARGOS.includes(usuarioAtual.cargo); }
function frotaPodeEditar(){
  return !!usuarioAtual && !ehSomenteLeitura() && ["admin", "diretor", "rh", "logistica", "encarregado", "engenheiro", "mecanico", "gestor_frota"].includes(usuarioAtual.cargo);
}
function frotaMoeda(v){ return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function frotaNum(v, d = 0){ return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d }); }
function frotaMesAtual(){ return hojeISO().slice(0, 7); }
function vgObraTxt(id){
  if(!id) return "";
  const o = _frotaObras.find(x => x.id === id);
  return o ? `${o.codigo} — ${o.nome}` : ((typeof mapaObras === "object" && mapaObras && mapaObras[id]) || "");
}
/* texto de origem ou destino da viagem: obra do cadastro, senão a descrição, senão o tipo */
function vgLado(v, lado){
  const tipo = v[lado + "_tipo"], obraId = v[lado + "_obra_id"], desc = v[lado + "_descricao"];
  if((tipo === "obra" || tipo === "cliente") && obraId) return vgObraTxt(obraId) || desc || VG_LOC[tipo];
  return desc || VG_LOC[tipo] || tipo || "—";
}
function vgCaminhaoTxt(c){ return c ? `${c.codigo}${c.placa ? " · " + c.placa : ""}` : "—"; }
function vgNotasTxt(v){
  const notas = (v.notas || []).filter(n => !n.interna);
  if(!notas.length) return '<span class="meta">—</span>';
  return notas.map(n => linkMovimentacao(n.id, n.nf_numero ? `NF ${n.nf_numero}` : n.numero)).join(", ");
}

/* ---------- carga ---------- */
async function carregarFrota(force){
  const cont = $("frota-conteudo");
  if(!cont) return;
  if(force || !_frotaVeic.length){
    cont.innerHTML = `<p class="vazio">Carregando logística…</p>`;
    const [eq, fu, ob, ns] = await Promise.all([
      sb.from("equipamentos").select("id,codigo,nome,tipo,placa,km,valor_km,valor_fipe,fipe_referencia,fipe_codigo,status,ativo,localizacao_tipo,localizacao_descricao,localizacao_obra_id,observacoes").order("codigo"),
      sb.from("funcionarios").select("id,nome,funcao").eq("ativo", true).order("nome"),
      sb.from("obras").select("id,codigo,nome,status,uf").not("status", "in", "(cancelada)").order("codigo", { ascending: false }),
      sb.from("movimentacoes_ativos").select("id", { count: "exact", head: true }).is("viagem_id", null).eq("interna", false).in("status", ["rascunho", "emitida", "em_transito"])
    ]);
    if(eq.error){ cont.innerHTML = `<p class="vazio">Erro ao carregar equipamentos: ${esc(eq.error.message)}</p>`; return; }
    const todos = eq.data || [];
    _frotaVeic = todos.filter(e => e.tipo === "caminhao" || e.tipo === "veiculo");
    _frotaEquipOutros = todos.filter(e => e.tipo !== "caminhao" && e.tipo !== "veiculo");
    _frotaFuncs = fu.data || [];
    _frotaObras = ob.data || [];
    _frotaNotasSemViagem = ns.error ? null : (ns.count || 0);
    frotaPreencherSelects();
    _frotaViagens = { chave: null, dados: [] };
    _frotaDocs = null;
  }
  // Mês inicial: o atual só se tiver lançamento; senão o último mês com viagem (a planilha foi importada até
  // jul/2026 e a tela abria em setembro vazio — parecia que nada tinha subido).
  if(!$("frota-f-mes").value){
    if(_frotaUltimaData === undefined){
      const { data } = await sb.from("viagens").select("data").eq("status", "concluida").order("data", { ascending: false }).limit(1);
      _frotaUltimaData = data && data[0] ? data[0].data : null;
    }
    const ultimoMes = _frotaUltimaData ? String(_frotaUltimaData).slice(0, 7) : null;
    $("frota-f-mes").value = (ultimoMes && ultimoMes < frotaMesAtual()) ? ultimoMes : frotaMesAtual();
  }
  renderFrota();
}

function frotaPreencherSelects(){
  const opt = (lista, rot) => lista.map(v => `<option value="${esc(v.id)}">${esc(rot(v))}</option>`).join("");
  const manter = (sel, html, vazio) => { if(!sel) return; const v = sel.value; sel.innerHTML = `<option value="">${vazio}</option>` + html; sel.value = v; };
  manter($("frota-f-caminhao"), opt(_frotaVeic, v => `${v.codigo} · ${v.nome || ""}`), "Todos os caminhões");
  manter($("frota-f-obra"), opt(_frotaObras, o => `${o.codigo} — ${o.nome}`), "Todas as obras");
  manter($("frota-f-finalidade"), Object.entries(VG_FINALIDADES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(""), "Toda finalidade");
  manter($("frota-f-status"), Object.entries(STATUS.viagem).map(([k, o]) => `<option value="${k}">${esc(o.label)}</option>`).join(""), "Todo status");
}

/* ---------- render ---------- */
function renderFrota(){
  document.querySelectorAll("#sec-frota .serv-view-btn[data-view]").forEach(b => b.classList.toggle("ativo", b.dataset.view === _frotaView));
  document.querySelectorAll("#frota-modos .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.modo === _frotaModo));
  const ehViagens = _frotaView === "viagens";
  const filtros = $("frota-filtros-viagens"); if(filtros) filtros.style.display = ehViagens ? "contents" : "none";
  const modos = $("frota-modos"); if(modos) modos.style.display = ehViagens ? "" : "none";
  const btnNova = $("btn-frota-nova-viagem"); if(btnNova) btnNova.style.display = (ehViagens && logPodeOperar()) ? "" : "none";
  const btnVeic = $("btn-frota-novo-veic"); if(btnVeic) btnVeic.style.display = (_frotaView === "veiculos" && frotaPodeEditar()) ? "" : "none";
  frotaKpisFixos();
  if(_frotaView === "veiculos") renderFrotaVeiculos();
  else if(_frotaView === "documentos") renderFrotaDocumentos();
  else renderFrotaViagens();
}
function frotaKpi(id, v){ const el = $(id); if(el) el.textContent = v; }
function frotaKpisFixos(){
  frotaKpi("frota-kpi-caminhoes", _frotaVeic.filter(v => v.tipo === "caminhao" && v.ativo !== false).length);
  frotaKpi("frota-kpi-veiculos", _frotaVeic.filter(v => v.tipo === "veiculo" && v.ativo !== false).length);
  frotaKpi("frota-kpi-notas", _frotaNotasSemViagem == null ? "—" : _frotaNotasSemViagem);
}

function frotaOndeEsta(v){
  if(v.localizacao_tipo === "obra" && v.localizacao_obra_id) return mapaObras?.[v.localizacao_obra_id] || "Em obra";
  if(v.localizacao_descricao) return v.localizacao_descricao;
  return v.localizacao_tipo === "base" ? "Pátio" : (v.localizacao_tipo || "—");
}

function renderFrotaVeiculos(){
  const cont = $("frota-conteudo");
  const termo = ($("frota-busca")?.value || "").trim().toLowerCase();
  const lista = _frotaVeic.filter(v => !termo || `${v.codigo} ${v.nome || ""} ${v.placa || ""}`.toLowerCase().includes(termo));
  const c = $("frota-contador"); if(c) c.textContent = `${lista.length} de ${_frotaVeic.length}`;
  const ativos = _frotaVeic.filter(v => v.ativo !== false);
  const comFipe = ativos.filter(v => v.valor_fipe != null);
  const totalFipe = comFipe.reduce((s, v) => s + Number(v.valor_fipe || 0), 0);
  const fipeRef = v => v.fipe_referencia ? ` <span class="meta" title="referência FIPE">${String(v.fipe_referencia).slice(5, 7)}/${String(v.fipe_referencia).slice(0, 4)}</span>` : "";
  cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">${(typeof ehDiretoria === "function" && ehDiretoria()) ? `Valor FIPE da frota ativa: <strong>${frotaMoeda(totalFipe)}</strong> ` : "FIPE "}(${comFipe.length} de ${ativos.length} com FIPE informada${ativos.length - comFipe.length ? ` · ${ativos.length - comFipe.length} sem valor` : ""})</p>
  <div class="tabela-rola"><table>
    <thead><tr><th>TAG</th><th>Tipo</th><th>Descrição</th><th>Placa</th><th class="num">km atual</th><th class="num">R$/km</th><th class="num">FIPE</th><th>Onde está</th><th>Status</th></tr></thead>
    <tbody>${lista.map(v => `<tr class="linha-clicavel" data-veic="${v.id}" ${v.ativo === false ? 'style="opacity:.55"' : ""}>
        <td><strong>${esc(v.codigo)}</strong></td><td>${FROTA_TIPO_LBL[v.tipo] || esc(v.tipo)}</td><td>${esc(v.nome || "")}</td><td>${esc(v.placa || "—")}</td>
        <td class="num">${v.km != null ? frotaNum(v.km) : "—"}</td><td class="num">${v.valor_km != null ? frotaNum(v.valor_km, 2) : "—"}</td>
        <td class="num">${v.valor_fipe != null ? frotaMoeda(v.valor_fipe) + fipeRef(v) : '<span class="tag ambar" title="sem valor FIPE">—</span>'}</td>
        <td>${esc(frotaOndeEsta(v))}</td><td>${FROTA_STATUS_LBL[v.status] || esc(v.status || "")}</td></tr>`).join("") || `<tr><td colspan="9" class="vazio">Nenhum veículo cadastrado.</td></tr>`}</tbody>
  </table></div>`;
}

/* ---------- visão Viagens ---------- */
const VG_SELECT_LISTA = "id,numero,data,status,finalidade,km_saida,km_chegada,km_total,valor_km,valor_total,observacoes,funcionario_id,obra_id,origem_tipo,origem_obra_id,origem_descricao,destino_tipo,destino_obra_id,destino_descricao,equipamento_atendido_id,caminhao_id,mobilizacao_id,data_saida,data_chegada,"
  + "funcionario:funcionarios(nome),caminhao:equipamentos!caminhao_id(codigo,nome,placa),equip:equipamentos!equipamento_atendido_id(codigo,nome),notas:movimentacoes_ativos(id,numero,tipo,status,nf_numero,interna)";

async function frotaBuscarViagens(mes, camId){
  let q = sb.from("viagens").select(VG_SELECT_LISTA).order("data", { ascending: false }).order("numero", { ascending: false }).limit(2000);
  // planejadas e em trânsito aparecem sempre; o período filtra só as concluídas e canceladas
  if(mes){
    const ini = mes + "-01";
    const fim = dataLocalISO(new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0));
    q = q.or(`and(data.gte.${ini},data.lte.${fim}),status.in.(planejada,em_transito)`);
  } else {
    const d = new Date(); d.setMonth(d.getMonth() - 12);
    q = q.or(`data.gte.${dataLocalISO(d)},status.in.(planejada,em_transito)`);
  }
  if(camId) q = q.eq("caminhao_id", camId);
  return q;
}

function frotaViagensFiltradas(){
  const termo = ($("frota-busca")?.value || "").trim().toLowerCase();
  const obra = $("frota-f-obra")?.value || "", fin = $("frota-f-finalidade")?.value || "", st = $("frota-f-status")?.value || "";
  const comNota = !!$("frota-f-nota")?.checked;
  return _frotaViagens.dados.filter(v => {
    if(obra && !(v.obra_id === obra || v.origem_obra_id === obra || v.destino_obra_id === obra)) return false;
    if(fin && v.finalidade !== fin) return false;
    if(st && v.status !== st) return false;
    if(comNota && !(v.notas || []).some(n => !n.interna)) return false;
    if(termo){
      const alvo = `${v.numero} ${v.funcionario?.nome || ""} ${vgLado(v, "origem")} ${vgLado(v, "destino")} ${v.caminhao?.codigo || ""} ${v.caminhao?.placa || ""} ${v.equip?.codigo || ""} ${(v.notas || []).map(n => `${n.numero} ${n.nf_numero || ""}`).join(" ")} ${v.observacoes || ""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

async function renderFrotaViagens(){
  const cont = $("frota-conteudo");
  const mes = $("frota-f-mes")?.value || "";
  const camId = $("frota-f-caminhao")?.value || "";
  const chave = mes + "|" + camId;
  if(_frotaViagens.chave !== chave){
    cont.innerHTML = `<p class="vazio">Buscando viagens…</p>`;
    const { data, error } = await frotaBuscarViagens(mes, camId);
    if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
    _frotaViagens = { chave, dados: data || [] };
  }
  const linhas = frotaViagensFiltradas();
  const c = $("frota-contador"); if(c) c.textContent = `${linhas.length} de ${_frotaViagens.dados.length}`;
  const fechadas = linhas.filter(v => v.status !== "cancelada");
  const tot = fechadas.reduce((s, d) => ({ km: s.km + (Number(d.km_total) || 0), val: s.val + (Number(d.valor_total) || 0) }), { km: 0, val: 0 });
  frotaKpi("frota-kpi-viagens", linhas.length);
  frotaKpi("frota-kpi-km", frotaNum(tot.km));
  frotaKpi("frota-kpi-valor", frotaMoeda(tot.val));
  frotaKpi("frota-kpi-transito", _frotaViagens.dados.filter(v => v.status === "em_transito").length);
  if(_frotaModo === "kanban") renderFrotaKanban(linhas);
  else renderFrotaLista(linhas, mes, tot);
}

function renderFrotaLista(linhas, mes, tot){
  const cont = $("frota-conteudo");
  const obraTxt = v => vgLado(v, v.destino_tipo === "base" && v.origem_tipo !== "base" ? "origem" : "destino");
  const agrupar = (rot) => { const g = new Map(); linhas.filter(v => v.status !== "cancelada").forEach(d => { const k = rot(d); const a = g.get(k) || { k, n: 0, km: 0, val: 0 }; a.n++; a.km += Number(d.km_total) || 0; a.val += Number(d.valor_total) || 0; g.set(k, a); }); return [...g.values()].sort((a, b) => b.val - a.val); };
  const porCam = agrupar(d => d.caminhao ? `${d.caminhao.codigo} · ${d.caminhao.nome || ""}` : "Sem caminhão");
  const porObra = agrupar(obraTxt);
  const resumo = (titulo, lista) => `<div class="card" style="flex:1 1 320px;min-width:280px;"><h4 style="margin:0 0 8px;">${titulo}</h4><div class="tabela-rola"><table>
      <thead><tr><th>${titulo.includes("obra") ? "Obra / destino" : "Caminhão"}</th><th class="num">Viagens</th><th class="num">km</th><th class="num">R$</th></tr></thead>
      <tbody>${lista.slice(0, 12).map(a => `<tr><td>${esc(a.k)}</td><td class="num">${a.n}</td><td class="num">${frotaNum(a.km)}</td><td class="num">${frotaMoeda(a.val)}</td></tr>`).join("") || `<tr><td colspan="4" class="vazio">—</td></tr>`}</tbody></table></div></div>`;

  cont.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">${resumo("Por caminhão", porCam)}${resumo("Por obra atendida", porObra)}</div>
    <div class="meta" style="margin:0 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${linhas.length} viagem(ns)${mes ? " em " + esc(mes.slice(5, 7) + "/" + mes.slice(0, 4)) : " nos últimos 12 meses"} (planejadas e em trânsito aparecem sempre)
      ${_frotaUltimaData ? `· última concluída em <strong>${dataBR(_frotaUltimaData)}</strong>` : ""}${_frotaUltimaData && String(_frotaUltimaData).slice(0, 7) < frotaMesAtual() ? ` <span class="tag ambar" title="as viagens depois dessa data ainda não foram lançadas no sistema">sem lançamentos depois disso</span>` : ""}
      ${mes && mes !== frotaMesAtual() ? `<button type="button" class="btn-sec btn-sm" id="btn-frota-mes-atual">Mês atual</button>` : ""}
      <button type="button" class="btn-sec btn-sm" id="btn-frota-12m">Últimos 12 meses</button>
      <button type="button" class="btn-sec btn-sm" id="btn-frota-csv" style="margin-left:auto;">⬇️ CSV</button></div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Viagem</th><th>Data</th><th>Status</th><th>Finalidade</th><th>Caminhão</th><th>Motorista</th><th>Origem → destino</th><th>Notas</th><th class="num">km</th><th class="num">R$/km</th><th class="num">Valor</th></tr></thead>
      <tbody>${linhas.map(d => `<tr class="linha-clicavel" data-vg="${esc(d.id)}">
          <td><strong>${esc(d.numero)}</strong>${d.mobilizacao_id ? ' <span class="meta" title="gerada pela mobilização">mob.</span>' : ""}</td>
          <td>${dataBR(d.data)}</td><td>${tagStatus("viagem", d.status)}</td><td>${esc(VG_FINALIDADES[d.finalidade] || d.finalidade || "")}</td>
          <td>${esc(d.caminhao ? d.caminhao.codigo : "—")}</td><td>${esc(d.funcionario?.nome || "—")}</td>
          <td title="${esc(d.observacoes || "")}">${esc(vgLado(d, "origem"))} → ${esc(vgLado(d, "destino"))}${d.equip ? ` <span class="meta">· atende ${esc(d.equip.codigo)}</span>` : ""}</td>
          <td>${vgNotasTxt(d)}</td>
          <td class="num">${d.km_total != null ? frotaNum(d.km_total) : "—"}</td><td class="num">${d.valor_km != null ? frotaNum(d.valor_km, 2) : "—"}</td><td class="num">${d.valor_total != null ? frotaMoeda(d.valor_total) : "—"}</td></tr>`).join("") || `<tr><td colspan="11" class="vazio">Nenhuma viagem no período.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="8"><strong>Total</strong></td><td class="num"><strong>${frotaNum(tot.km)}</strong></td><td></td><td class="num"><strong>${frotaMoeda(tot.val)}</strong></td></tr></tfoot>
    </table></div>`;
  $("btn-frota-mes-atual")?.addEventListener("click", () => { $("frota-f-mes").value = frotaMesAtual(); renderFrota(); });
  $("btn-frota-12m")?.addEventListener("click", () => { $("frota-f-mes").value = ""; renderFrota(); });
  $("btn-frota-csv")?.addEventListener("click", () => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Viagem;Data;Status;Finalidade;Motorista;Caminhao;Equipamento;Origem;Destino;Notas;Km_saida;Km_chegada;Km;Valor_km;Valor"]
      .concat(linhas.map(d => [d.numero, dataBR(d.data), STATUS.viagem[d.status]?.label || d.status, VG_FINALIDADES[d.finalidade] || d.finalidade, d.funcionario?.nome || "", d.caminhao?.codigo || "", d.equip?.codigo || "", vgLado(d, "origem"), vgLado(d, "destino"), (d.notas || []).filter(n => !n.interna).map(n => n.nf_numero ? "NF " + n.nf_numero : n.numero).join(" "), d.km_saida, d.km_chegada, d.km_total, d.valor_km, d.valor_total].map(cel).join(";"))).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = `viagens-${mes || "12m"}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  });
}

function renderFrotaKanban(linhas){
  const cont = $("frota-conteudo");
  const colunas = VG_STAGES.concat(["cancelada"]).map(st => {
    const itens = linhas.filter(v => v.status === st);
    if(!itens.length && st === "cancelada") return "";
    const meta = STATUS.viagem[st];
    const cards = itens.map(v => `
      <div class="serv-kan-card linha-clicavel" data-vg="${esc(v.id)}">
        <div class="serv-kan-card-nome">${esc(v.numero)} · ${esc(v.caminhao ? v.caminhao.codigo : "sem caminhão")}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${esc(VG_FINALIDADES[v.finalidade] || v.finalidade || "")} · → ${esc(vgLado(v, "destino"))}</span><br>
          <span class="meta">${esc(v.funcionario?.nome || "sem motorista")}${(v.notas || []).some(n => !n.interna) ? " · 🧾 " + (v.notas || []).filter(n => !n.interna).length : ""}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${dataBR(v.data)}</span>
          <strong>${v.valor_total != null ? frotaMoeda(v.valor_total) : (v.km_total != null ? frotaNum(v.km_total) + " km" : "—")}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(meta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">O status muda na ficha da viagem (Iniciar, Concluir), onde o km fecha o custo.</p><div class="serv-kanban">${colunas}</div>`;
}

/* ---------- visão Documentos: notas sem viagem e MDF-e em aberto ---------- */
async function renderFrotaDocumentos(){
  const cont = $("frota-conteudo");
  if(!_frotaDocs){
    cont.innerHTML = `<p class="vazio">Buscando documentos…</p>`;
    const [n, m, a] = await Promise.all([
      sb.from("movimentacoes_ativos").select("id,numero,tipo,status,nf_numero,data_emissao,origem_tipo,origem_obra_id,origem_descricao,destino_tipo,destino_obra_id,destino_descricao,valor_total_produtos,transp_placa,motorista")
        .is("viagem_id", null).eq("interna", false).neq("status", "cancelada").order("data_emissao", { ascending: false }).limit(300),
      sb.from("manifestos_mdfe").select("id,numero,status,data_emissao,placa,motorista_nome,uf_origem,uf_destino,viagem_id,viagem:viagens(numero,status)")
        .in("status", ["rascunho", "emitido", "em_transito"]).order("data_emissao", { ascending: false }).limit(200),
      sb.from("viagens").select("id,numero,data,status,caminhao:equipamentos!caminhao_id(codigo)").in("status", ["planejada", "em_transito"]).order("data", { ascending: false }).limit(200)
    ]);
    if(n.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(n.error.message)}</p>`; return; }
    _frotaDocs = { notas: n.data || [], mdfes: m.error ? [] : (m.data || []), abertas: a.error ? [] : (a.data || []) };
    _frotaNotasSemViagem = _frotaDocs.notas.filter(x => x.status !== "recebida").length;
    frotaKpisFixos();
  }
  const termo = ($("frota-busca")?.value || "").trim().toLowerCase();
  const notas = _frotaDocs.notas.filter(x => !termo || `${x.numero} ${x.nf_numero || ""} ${x.origem_descricao || ""} ${x.destino_descricao || ""} ${x.motorista || ""} ${x.transp_placa || ""}`.toLowerCase().includes(termo));
  const mdfes = _frotaDocs.mdfes.filter(x => !termo || `${x.numero || ""} ${x.placa} ${x.motorista_nome} ${x.viagem?.numero || ""}`.toLowerCase().includes(termo));
  const c = $("frota-contador"); if(c) c.textContent = `${notas.length} nota(s) · ${mdfes.length} MDF-e`;
  const pode = logPodeOperar();
  const movLbl = (typeof MOV_TIPOS === "object" && MOV_TIPOS) || {};
  const movSt = (typeof MOV_STATUS === "object" && MOV_STATUS) || {};
  const lado = (tipo, obraId, desc) => (tipo === "obra" || tipo === "cliente") && obraId ? (vgObraTxt(obraId) || desc || "obra") : (desc || VG_LOC[tipo] || tipo || "—");
  const optViagens = `<option value="">— vincular a uma viagem aberta —</option>` + _frotaDocs.abertas.map(v => `<option value="${esc(v.id)}">${esc(v.numero)} · ${dataBR(v.data)} · ${esc(v.caminhao?.codigo || "sem caminhão")} · ${esc(STATUS.viagem[v.status]?.label || v.status)}</option>`).join("");
  cont.innerHTML = `
    <div class="lista-topo compacta" style="border:none;padding:0;"><h4 style="margin:0;font-size:var(--txt-md);">🧾 Notas sem viagem <span class="contador">${notas.length}</span></h4>
      <span class="meta">Nota de remessa ou retorno em rascunho, emitida ou em trânsito que ainda não pertence a nenhuma viagem. O lugar certo de criar a nota é a aba Documentos da viagem.</span>
      ${typeof podeVerMovimentacoes === "function" && podeVerMovimentacoes() && pode ? `<button type="button" class="btn-sec btn-sm" id="btn-frota-nota-avulsa" style="margin-left:auto;">📄 Nota sem viagem</button>` : ""}
    </div>
    ${notas.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Nota</th><th>Tipo</th><th>Status</th><th>NF</th><th>Emissão</th><th>Origem → destino</th><th>Placa · motorista</th><th class="num">Valor</th>${pode ? '<th style="min-width:260px;">Viagem</th>' : ""}</tr></thead>
      <tbody>${notas.map(x => `<tr>
        <td><strong>${linkMovimentacao(x.id, x.numero)}</strong></td><td>${esc(movLbl[x.tipo] || x.tipo)}</td>
        <td>${movSt[x.status] ? `<span class="tag ${movSt[x.status].cor}">${esc(movSt[x.status].label)}</span>` : esc(x.status)}</td>
        <td>${esc(x.nf_numero || "—")}</td><td>${dataBR(x.data_emissao)}</td>
        <td>${esc(lado(x.origem_tipo, x.origem_obra_id, x.origem_descricao))} → ${esc(lado(x.destino_tipo, x.destino_obra_id, x.destino_descricao))}</td>
        <td class="meta">${esc([x.transp_placa, x.motorista].filter(Boolean).join(" · ") || "—")}</td>
        <td class="num">${brl(x.valor_total_produtos)}</td>
        ${pode ? `<td><div style="display:flex;gap:4px;"><select data-vinc-nota="${esc(x.id)}" style="flex:1;">${optViagens}</select><button type="button" class="btn-sec btn-sm btn-frota-vincular" data-nota="${esc(x.id)}">Vincular</button></div></td>` : ""}
      </tr>`).join("")}</tbody></table></div>` : `<p class="vazio">Nenhuma nota solta: todas as notas pertencem a uma viagem.</p>`}
    <hr style="border:none;border-top:1px solid var(--borda);margin:14px 0;">
    <div class="lista-topo compacta" style="border:none;padding:0;"><h4 style="margin:0;font-size:var(--txt-md);">📑 MDF-e em aberto <span class="contador">${mdfes.length}</span></h4>
      <span class="meta">Manifesto em rascunho, emitido ou em trânsito; encerra na ficha da viagem, ao concluir.</span></div>
    ${mdfes.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>MDF-e</th><th>Status</th><th>Emissão</th><th>Placa</th><th>Motorista</th><th>UF</th><th>Viagem</th></tr></thead>
      <tbody>${mdfes.map(x => `<tr>
        <td><strong>${esc(x.numero || "—")}</strong></td><td><span class="tag ${x.status === "rascunho" ? "cinza" : "ambar"}">${esc(x.status)}</span></td><td>${dataBR(x.data_emissao)}</td>
        <td>${esc(x.placa)}</td><td>${esc(x.motorista_nome)}</td><td>${esc(String(x.uf_origem).toUpperCase())} → ${esc(String(x.uf_destino).toUpperCase())}</td>
        <td>${x.viagem_id ? linkViagem(x.viagem_id, x.viagem?.numero || "viagem") : '<span class="meta">sem viagem</span>'}</td></tr>`).join("")}</tbody></table></div>` : `<p class="vazio">Nenhum MDF-e em aberto.</p>`}`;
  $("btn-frota-nota-avulsa")?.addEventListener("click", async () => {
    if(!irParaSecao("movimentacoes")) return;
    if(typeof carregarMovimentacoes === "function" && !(typeof _movRegistros !== "undefined" && _movRegistros.length)) await carregarMovimentacoes();
    if(typeof _movVoltarPara !== "undefined") _movVoltarPara = () => { if(irParaSecao("frota")){ _frotaDocs = null; _frotaView = "documentos"; renderFrota(); } };
    if(typeof novaMovimentacao === "function") novaMovimentacao();
  });
  cont.querySelectorAll(".btn-frota-vincular").forEach(b => b.addEventListener("click", () => comBotaoTravado(b, async () => {
    const sel = cont.querySelector(`select[data-vinc-nota="${b.dataset.nota}"]`);
    const vid = sel?.value;
    if(!vid){ aviso("app-aviso", "Escolha a viagem.", "erro"); return; }
    const { error } = await sb.from("movimentacoes_ativos").update({ viagem_id: vid }).eq("id", b.dataset.nota);
    if(error){ aviso("app-aviso", "Não foi possível vincular: " + error.message, "erro"); return; }
    aviso("app-aviso", "Nota vinculada à viagem.", "ok");
    _frotaDocs = null; _frotaViagens.chave = null;
    renderFrota();
  })));
}

/* ---------- veículo: novo / editar ---------- */
function abrirVeiculo(id){
  if(!frotaPodeEditar()) return;
  _frotaVeicEditId = id || null;
  const v = id ? _frotaVeic.find(x => x.id === id) : null;
  $("fveic-titulo").textContent = v ? `Veículo ${v.codigo}` : "Novo veículo";
  // lote S44 (L1, #59): a TAG pode ser corrigida depois de criada (viagens, documentos e custos seguem pelo id)
  $("fveic-codigo").value = v?.codigo || ""; $("fveic-codigo").disabled = false;
  $("fveic-tipo").value = v?.tipo || "caminhao";
  $("fveic-nome").value = v?.nome || "";
  $("fveic-placa").value = v?.placa || "";
  $("fveic-km").value = v?.km ?? "";
  $("fveic-valor-km").value = v?.valor_km ?? "";
  $("fveic-fipe").value = v?.valor_fipe ?? "";
  $("fveic-fipe-ref").value = v?.fipe_referencia ? String(v.fipe_referencia).slice(0, 7) : "";
  $("fveic-fipe-cod").value = v?.fipe_codigo || "";
  $("fveic-status").value = v?.status || "disponivel";
  $("fveic-ativo").checked = v ? v.ativo !== false : true;
  $("fveic-obs").value = v?.observacoes || "";
  $("frota-veic-modal").style.display = "flex";
}
function fecharVeiculo(){ $("frota-veic-modal").style.display = "none"; _frotaVeicEditId = null; }

/* Aviso dentro do modal (o app-aviso do topo fica atrás do modal e a pessoa não vê) */
function frotaAvisoVeic(msg, tipo){
  aviso("app-aviso", msg, tipo);
  const el = $("fveic-aviso"); if(!el) return;
  el.textContent = msg; el.className = "aviso " + tipo;
  if(tipo === "ok") setTimeout(() => { el.className = "aviso"; el.textContent = ""; }, 4000);
}
const frotaSoAlfaNum = s => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
async function salvarVeiculo(){
  // lote S43 (L1): TAG e Descrição são obrigatórias no banco (equipamentos.nome not null); antes o insert
  // voltava 400 cru e o modal não dizia o que faltava. Placa e TAG repetidas também avisam antes de gravar.
  const codigo = $("fveic-codigo").value.trim().toUpperCase();
  const nome = $("fveic-nome").value.trim();
  const placa = frotaSoAlfaNum($("fveic-placa").value) || null;
  if(!codigo){ frotaAvisoVeic("Informe a TAG (ex.: 26-CM).", "erro"); $("fveic-codigo").focus(); return; }
  if(!nome){ frotaAvisoVeic("Informe a descrição do veículo (ex.: VW 24250).", "erro"); $("fveic-nome").focus(); return; }
  // lote S44 (L1, #59): a TAG também é editável; a unicidade (equipamentos.codigo) vale contra todos os
  // equipamentos (caminhões, veículos, perfuratrizes…), menos o próprio registro
  const atual = _frotaVeicEditId ? _frotaVeic.find(x => x.id === _frotaVeicEditId) : null;
  const tagMudou = !atual || String(atual.codigo || "").toUpperCase() !== codigo;
  if(tagMudou){
    const dupTag = [..._frotaVeic, ..._frotaEquipOutros].find(e => e.id !== _frotaVeicEditId && String(e.codigo || "").toUpperCase() === codigo);
    if(dupTag){ frotaAvisoVeic(`A TAG ${codigo} já é usada por ${dupTag.nome || FROTA_TIPO_LBL[dupTag.tipo] || dupTag.tipo}${dupTag.placa ? " · " + dupTag.placa : ""}. Escolha outra.`, "erro"); $("fveic-codigo").focus(); return; }
  }
  if(placa){
    const dupPlaca = _frotaVeic.find(v => v.id !== _frotaVeicEditId && frotaSoAlfaNum(v.placa) === placa);
    if(dupPlaca){ frotaAvisoVeic(`A placa ${placa} já está no veículo ${dupPlaca.codigo}${dupPlaca.nome ? " · " + dupPlaca.nome : ""}.`, "erro"); $("fveic-placa").focus(); return; }
  }
  const reg = {
    nome, tipo: $("fveic-tipo").value, placa,
    km: $("fveic-km").value === "" ? null : Number($("fveic-km").value), valor_km: $("fveic-valor-km").value === "" ? null : Number($("fveic-valor-km").value),
    valor_fipe: $("fveic-fipe").value === "" ? null : Number($("fveic-fipe").value),
    fipe_referencia: $("fveic-fipe-ref").value ? $("fveic-fipe-ref").value + "-01" : null,
    fipe_codigo: $("fveic-fipe-cod").value.trim() || null,
    status: $("fveic-status").value, ativo: $("fveic-ativo").checked, observacoes: $("fveic-obs").value.trim() || null,
  };
  let r;
  if(_frotaVeicEditId) r = await sb.from("equipamentos").update(tagMudou ? { ...reg, codigo } : reg).eq("id", _frotaVeicEditId);
  else r = await sb.from("equipamentos").insert({ ...reg, codigo, localizacao_tipo: "base" });
  if(r.error){
    // 23505 = chave duplicada (TAG já usada por equipamento que não estava na lista); 23502 = coluna obrigatória vazia
    const msg = r.error.code === "23505" ? `A TAG ${codigo} já é usada por outro equipamento. Escolha outra.`
      : r.error.code === "23502" ? "Faltou um campo obrigatório (TAG ou descrição)."
      : r.error.message;
    frotaAvisoVeic("Erro ao salvar veículo: " + msg, "erro"); return;
  }
  if($("fveic-aviso")){ $("fveic-aviso").className = "aviso"; $("fveic-aviso").textContent = ""; }
  aviso("app-aviso", "Veículo salvo.", "ok");
  fecharVeiculo();
  await carregarFrota(true);
}

/* volta da ficha da viagem para o painel (js/viagens.js chama) */
function mostrarPainelFrota(recarregar){
  const f = $("vg-ficha"); if(f) f.style.display = "none";
  const p = $("frota-painel"); if(p) p.style.display = "";
  if(recarregar){ _frotaViagens.chave = null; _frotaDocs = null; }
  if(!_frotaVeic.length) carregarFrota(false);   // ficha aberta por link antes do painel: carrega as listas primeiro
  else renderFrota();
}

/* ---------- ligação ---------- */
function ligarFrota(){
  document.querySelectorAll("#sec-frota .serv-view-btn[data-view]").forEach(b => b.addEventListener("click", () => { _frotaView = b.dataset.view; renderFrota(); }));
  document.querySelectorAll("#frota-modos .serv-view-btn").forEach(b => b.addEventListener("click", () => { _frotaModo = b.dataset.modo; renderFrota(); }));
  ["frota-f-mes", "frota-f-caminhao", "frota-f-obra", "frota-f-finalidade", "frota-f-status", "frota-f-nota"].forEach(id => $(id)?.addEventListener("change", renderFrota));
  $("frota-busca")?.addEventListener("input", debounce(renderFrota));
  $("btn-frota-atualizar")?.addEventListener("click", () => carregarFrota(true));
  $("btn-frota-nova-viagem")?.addEventListener("click", () => { if(typeof novaViagem === "function") novaViagem(); });
  $("btn-frota-novo-veic")?.addEventListener("click", () => abrirVeiculo(null));
  $("frota-kpi-card-transito")?.addEventListener("click", () => { _frotaView = "viagens"; const s = $("frota-f-status"); if(s) s.value = s.value === "em_transito" ? "" : "em_transito"; renderFrota(); });
  $("frota-kpi-card-notas")?.addEventListener("click", () => { _frotaView = "documentos"; renderFrota(); });
  $("frota-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a.link-cad, a.link-obra, select, button")) return;
    const tv = e.target.closest("[data-vg]"); if(tv){ if(typeof abrirViagem === "function") abrirViagem(tv.dataset.vg, null); return; }
    const tr = e.target.closest("tr[data-veic]"); if(tr) abrirVeiculo(tr.dataset.veic);
  });
  $("btn-fveic-fechar")?.addEventListener("click", fecharVeiculo);
  $("btn-fveic-salvar")?.addEventListener("click", () => comBotaoTravado("btn-fveic-salvar", salvarVeiculo));
  document.querySelector('nav button[data-secao="frota"]')?.addEventListener("click", () => carregarFrota(false));
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarFrota); else ligarFrota();

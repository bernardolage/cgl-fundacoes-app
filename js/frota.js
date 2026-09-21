/* ====================================================================
   FROTA (fase 37 · 08/09/2026)
   Caminhões e veículos saem do módulo Obras e ganham módulo próprio:
   - Veículos: TAG, placa, km atual (alimentado pelos deslocamentos), R$/km, onde está.
   - Deslocamentos: o "KM CAMINHÕES" da RG 8.1 — data, motorista, caminhão,
     equipamento atendido, obra, km saída/chegada. valor_total = km × R$/km
     (colunas geradas no banco). Resumo por caminhão e por obra no mês.
   Escrita: admin, diretor, rh, logistica, encarregado (RLS desloc_write) e
   veículos: admin, mecanico, engenheiro, logistica, rh (fase 37).
   ==================================================================== */
let _frotaView = "desloc";
let _frotaVeic = [];          // equipamentos tipo caminhao/veiculo
let _frotaEquipOutros = [];   // demais equipamentos (atendidos)
let _frotaFuncs = [];         // funcionários ativos (motoristas)
let _frotaDesl = { chave: null, dados: [] };
let _frotaDeslEditId = null;
let _frotaVeicEditId = null;

const FROTA_TIPO_LBL = { caminhao: "Caminhão", veiculo: "Veículo" };
const FROTA_STATUS_LBL = { disponivel: "Disponível", em_uso: "Em uso", manutencao: "Manutenção", inativo: "Inativo" };

function frotaPodeEditar(){
  return ["admin", "diretor", "rh", "logistica", "encarregado", "engenheiro", "mecanico"].includes(usuarioAtual?.cargo);
}
function frotaTag(v){ return v ? `${v.codigo}${v.nome ? " · " + v.nome : ""}` : "—"; }
function frotaMoeda(v){ return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function frotaNum(v, d = 0){ return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d }); }
function frotaMesAtual(){ return hojeISO().slice(0, 7); }

/* ---------- carga ---------- */
async function carregarFrota(force){
  const cont = $("frota-conteudo");
  if(!cont) return;
  if(force || !_frotaVeic.length){
    cont.innerHTML = `<p class="vazio">Carregando frota…</p>`;
    const [eq, fu] = await Promise.all([
      sb.from("equipamentos").select("id,codigo,nome,tipo,placa,km,valor_km,status,ativo,localizacao_tipo,localizacao_descricao,localizacao_obra_id,observacoes").order("codigo"),
      sb.from("funcionarios").select("id,nome,funcao").eq("ativo", true).order("nome"),
    ]);
    if(eq.error){ cont.innerHTML = `<p class="vazio">Erro ao carregar equipamentos: ${esc(eq.error.message)}</p>`; return; }
    const todos = eq.data || [];
    _frotaVeic = todos.filter(e => e.tipo === "caminhao" || e.tipo === "veiculo");
    _frotaEquipOutros = todos.filter(e => e.tipo !== "caminhao" && e.tipo !== "veiculo");
    _frotaFuncs = fu.data || [];
    frotaPreencherSelects();
    _frotaDesl = { chave: null, dados: [] };
  }
  if(!$("frota-f-mes").value) $("frota-f-mes").value = frotaMesAtual();
  renderFrota();
}

function frotaPreencherSelects(){
  const opt = (lista, rot) => lista.map(v => `<option value="${v.id}">${esc(rot(v))}</option>`).join("");
  const caminhoes = _frotaVeic.filter(v => v.tipo === "caminhao");
  const fCam = $("frota-f-caminhao");
  if(fCam) fCam.innerHTML = `<option value="">Todos os caminhões</option>` + opt(_frotaVeic, v => `${v.codigo} · ${v.nome || ""}`);
  const dCam = $("fdesl-caminhao");
  if(dCam) dCam.innerHTML = `<option value="">Selecione…</option>` + opt(caminhoes.concat(_frotaVeic.filter(v => v.tipo !== "caminhao")), v => `${v.codigo} · ${v.nome || ""}${v.placa ? " · " + v.placa : ""}`);
  const dMot = $("fdesl-motorista");
  if(dMot) dMot.innerHTML = `<option value="">Selecione…</option>` + opt(_frotaFuncs, f => f.nome + (f.funcao ? " · " + f.funcao : ""));
  const dEq = $("fdesl-equip");
  if(dEq) dEq.innerHTML = `<option value="">— nenhum —</option>` + opt(_frotaEquipOutros, e => `${e.codigo} · ${e.nome || ""}`);
  const dObra = $("fdesl-obra");
  if(dObra){
    const obras = Object.entries(typeof mapaObras === "object" && mapaObras ? mapaObras : {}).sort((a, b) => String(b[1]).localeCompare(String(a[1]), "pt-BR"));
    dObra.innerHTML = `<option value="">— pátio / sem obra —</option>` + obras.map(([id, rot]) => `<option value="${id}">${esc(rot)}</option>`).join("");
  }
}

/* ---------- render ---------- */
function renderFrota(){
  document.querySelectorAll("#sec-frota .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _frotaView));
  const filtrosDesl = $("frota-filtros-desl"); if(filtrosDesl) filtrosDesl.style.display = _frotaView === "desloc" ? "" : "none";
  const btnNovo = $("btn-frota-novo-desl"); if(btnNovo) btnNovo.style.display = (_frotaView === "desloc" && frotaPodeEditar()) ? "" : "none";
  const btnVeic = $("btn-frota-novo-veic"); if(btnVeic) btnVeic.style.display = (_frotaView === "veiculos" && frotaPodeEditar()) ? "" : "none";
  if(_frotaView === "veiculos") renderFrotaVeiculos();
  else renderFrotaDesloc();
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
  const kpi = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  kpi("frota-kpi-caminhoes", _frotaVeic.filter(v => v.tipo === "caminhao" && v.ativo !== false).length);
  kpi("frota-kpi-veiculos", _frotaVeic.filter(v => v.tipo === "veiculo" && v.ativo !== false).length);
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>TAG</th><th>Tipo</th><th>Descrição</th><th>Placa</th><th class="num">km atual</th><th class="num">R$/km</th><th>Onde está</th><th>Status</th></tr></thead>
    <tbody>${lista.map(v => `<tr class="linha-clicavel" data-veic="${v.id}" ${v.ativo === false ? 'style="opacity:.55"' : ""}>
        <td><strong>${esc(v.codigo)}</strong></td><td>${FROTA_TIPO_LBL[v.tipo] || esc(v.tipo)}</td><td>${esc(v.nome || "")}</td><td>${esc(v.placa || "—")}</td>
        <td class="num">${v.km != null ? frotaNum(v.km) : "—"}</td><td class="num">${v.valor_km != null ? frotaNum(v.valor_km, 2) : "—"}</td>
        <td>${esc(frotaOndeEsta(v))}</td><td>${FROTA_STATUS_LBL[v.status] || esc(v.status || "")}</td></tr>`).join("") || `<tr><td colspan="8" class="vazio">Nenhum veículo cadastrado.</td></tr>`}</tbody>
  </table></div>`;
}

async function renderFrotaDesloc(){
  const cont = $("frota-conteudo");
  const mes = $("frota-f-mes")?.value || "";
  const camId = $("frota-f-caminhao")?.value || "";
  const chave = mes + "|" + camId;
  if(_frotaDesl.chave !== chave){
    cont.innerHTML = `<p class="vazio">Buscando deslocamentos…</p>`;
    let q = sb.from("deslocamentos_caminhao")
      .select("id,data,km_saida,km_chegada,km_total,valor_km,valor_total,observacoes,funcionario_id,obra_id,equipamento_atendido_id,caminhao_id,funcionario:funcionarios(nome),obra:obras(codigo,nome),caminhao:equipamentos!caminhao_id(codigo,nome),equip:equipamentos!equipamento_atendido_id(codigo,nome)")
      .order("data", { ascending: false }).limit(2000);
    if(mes){
      const ini = mes + "-01";
      const fim = dataLocalISO(new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0));
      q = q.gte("data", ini).lte("data", fim);
    } else {
      const d = new Date(); d.setMonth(d.getMonth() - 12);
      q = q.gte("data", dataLocalISO(d));
    }
    if(camId) q = q.eq("caminhao_id", camId);
    const { data, error } = await q;
    if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
    _frotaDesl = { chave, dados: data || [] };
  }
  const termo = ($("frota-busca")?.value || "").trim().toLowerCase();
  const obraTxt = (d) => d.obra ? `${d.obra.codigo || ""} ${d.obra.nome || ""}`.trim() : (d.observacoes || "").replace(/^Importado da RG 8\.1 \(KM Caminhões\) · obra: /, "").trim() || "Pátio";
  const linhas = _frotaDesl.dados.filter(d => !termo || `${d.funcionario?.nome || ""} ${obraTxt(d)} ${d.caminhao?.codigo || ""} ${d.equip?.codigo || ""}`.toLowerCase().includes(termo));
  const tot = linhas.reduce((s, d) => ({ km: s.km + (Number(d.km_total) || 0), val: s.val + (Number(d.valor_total) || 0) }), { km: 0, val: 0 });
  const kpi = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  kpi("frota-kpi-viagens", linhas.length);
  kpi("frota-kpi-km", frotaNum(tot.km));
  kpi("frota-kpi-valor", frotaMoeda(tot.val));
  kpi("frota-kpi-obras", new Set(linhas.map(d => d.obra_id || obraTxt(d))).size);

  // resumos
  const agrupar = (rot) => { const g = new Map(); linhas.forEach(d => { const k = rot(d); const a = g.get(k) || { k, n: 0, km: 0, val: 0 }; a.n++; a.km += Number(d.km_total) || 0; a.val += Number(d.valor_total) || 0; g.set(k, a); }); return [...g.values()].sort((a, b) => b.val - a.val); };
  const porCam = agrupar(d => d.caminhao ? `${d.caminhao.codigo} · ${d.caminhao.nome || ""}` : "Sem caminhão");
  const porObra = agrupar(obraTxt);
  const resumo = (titulo, lista) => `<div class="card" style="flex:1 1 320px;min-width:280px;"><h4 style="margin:0 0 8px;">${titulo}</h4><div class="tabela-rola"><table>
      <thead><tr><th>${titulo.includes("obra") ? "Obra" : "Caminhão"}</th><th class="num">Viagens</th><th class="num">km</th><th class="num">R$</th></tr></thead>
      <tbody>${lista.slice(0, 12).map(a => `<tr><td>${esc(a.k)}</td><td class="num">${a.n}</td><td class="num">${frotaNum(a.km)}</td><td class="num">${frotaMoeda(a.val)}</td></tr>`).join("") || `<tr><td colspan="4" class="vazio">—</td></tr>`}</tbody></table></div></div>`;

  cont.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">${resumo("Por caminhão", porCam)}${resumo("Por obra atendida", porObra)}</div>
    <div class="meta" style="margin:0 0 6px;display:flex;align-items:center;gap:8px;">${linhas.length} deslocamento(s)${mes ? " em " + esc(mes) : " nos últimos 12 meses"}
      <button type="button" class="btn-sec btn-sm" id="btn-frota-csv" style="margin-left:auto;">⬇️ CSV</button></div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Data</th><th>Motorista</th><th>Caminhão</th><th>Equipamento atendido</th><th>Obra</th><th class="num">km saída</th><th class="num">km chegada</th><th class="num">km</th><th class="num">R$/km</th><th class="num">Valor</th></tr></thead>
      <tbody>${linhas.map(d => `<tr class="linha-clicavel" data-desl="${d.id}">
          <td>${dataBR(d.data)}</td><td>${esc(d.funcionario?.nome || "—")}</td><td>${esc(d.caminhao ? d.caminhao.codigo : "—")}</td><td>${esc(d.equip ? d.equip.codigo + " · " + (d.equip.nome || "") : "—")}</td>
          <td title="${esc(d.observacoes || "")}">${esc(obraTxt(d))}${d.obra_id ? "" : ' <span class="meta">(sem obra vinculada)</span>'}</td>
          <td class="num">${frotaNum(d.km_saida)}</td><td class="num">${frotaNum(d.km_chegada)}</td><td class="num">${frotaNum(d.km_total)}</td><td class="num">${d.valor_km != null ? frotaNum(d.valor_km, 2) : "—"}</td><td class="num">${frotaMoeda(d.valor_total)}</td></tr>`).join("") || `<tr><td colspan="10" class="vazio">Nenhum deslocamento no período.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="7"><strong>Total</strong></td><td class="num"><strong>${frotaNum(tot.km)}</strong></td><td></td><td class="num"><strong>${frotaMoeda(tot.val)}</strong></td></tr></tfoot>
    </table></div>`;
  $("btn-frota-csv")?.addEventListener("click", () => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Data;Motorista;Caminhao;Equipamento;Obra;Km_saida;Km_chegada;Km;Valor_km;Valor"]
      .concat(linhas.map(d => [dataBR(d.data), d.funcionario?.nome || "", d.caminhao?.codigo || "", d.equip?.codigo || "", obraTxt(d), d.km_saida, d.km_chegada, d.km_total, d.valor_km, d.valor_total].map(cel).join(";"))).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = `deslocamentos-${mes || "12m"}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  });
}

/* ---------- deslocamento: novo / editar ---------- */
function abrirDeslocamento(id){
  if(!frotaPodeEditar()){ aviso("app-aviso", "Seu perfil não registra deslocamentos.", "erro"); return; }
  _frotaDeslEditId = id || null;
  const d = id ? _frotaDesl.dados.find(x => x.id === id) : null;
  $("fdesl-titulo").textContent = d ? "Editar deslocamento" : "Novo deslocamento";
  $("fdesl-data").value = d ? d.data : hojeISO();
  $("fdesl-motorista").value = d?.funcionario_id || "";
  $("fdesl-caminhao").value = d?.caminhao_id || "";
  $("fdesl-equip").value = d?.equipamento_atendido_id || "";
  $("fdesl-obra").value = d?.obra_id || "";
  $("fdesl-km-saida").value = d?.km_saida ?? "";
  $("fdesl-km-chegada").value = d?.km_chegada ?? "";
  $("fdesl-valor-km").value = d?.valor_km ?? "";
  $("fdesl-obs").value = d?.observacoes || "";
  $("btn-fdesl-excluir").style.display = d ? "" : "none";
  if(!d) frotaSugerirKm();
  $("frota-desl-modal").style.display = "flex";
}
function fecharDeslocamento(){ $("frota-desl-modal").style.display = "none"; _frotaDeslEditId = null; }

function frotaSugerirKm(){
  const v = _frotaVeic.find(x => x.id === $("fdesl-caminhao").value);
  if(!v) return;
  if(!$("fdesl-valor-km").value && v.valor_km != null) $("fdesl-valor-km").value = v.valor_km;
  if(!$("fdesl-km-saida").value && v.km != null && !_frotaDeslEditId) $("fdesl-km-saida").value = v.km;
}

async function salvarDeslocamento(){
  const kmS = Number($("fdesl-km-saida").value), kmC = Number($("fdesl-km-chegada").value);
  const reg = {
    data: $("fdesl-data").value, funcionario_id: $("fdesl-motorista").value || null, caminhao_id: $("fdesl-caminhao").value || null,
    equipamento_atendido_id: $("fdesl-equip").value || null, obra_id: $("fdesl-obra").value || null,
    km_saida: $("fdesl-km-saida").value === "" ? null : kmS, km_chegada: $("fdesl-km-chegada").value === "" ? null : kmC,
    valor_km: $("fdesl-valor-km").value === "" ? null : Number($("fdesl-valor-km").value), observacoes: $("fdesl-obs").value.trim() || null,
  };
  if(!reg.data || !reg.caminhao_id){ aviso("app-aviso", "Informe a data e o caminhão.", "erro"); return; }
  if(reg.km_saida != null && reg.km_chegada != null && reg.km_chegada < reg.km_saida){ aviso("app-aviso", "km de chegada menor que km de saída.", "erro"); return; }
  const r = _frotaDeslEditId ? await sb.from("deslocamentos_caminhao").update(reg).eq("id", _frotaDeslEditId) : await sb.from("deslocamentos_caminhao").insert(reg);
  if(r.error){ aviso("app-aviso", "Erro ao salvar: " + r.error.message, "erro"); return; }
  aviso("app-aviso", "Deslocamento salvo.", "sucesso");
  fecharDeslocamento();
  await carregarFrota(true);
}

async function excluirDeslocamento(){
  if(!_frotaDeslEditId || !confirm("Excluir este deslocamento?")) return;
  const { error } = await sb.from("deslocamentos_caminhao").delete().eq("id", _frotaDeslEditId);
  if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
  fecharDeslocamento();
  await carregarFrota(true);
}

/* ---------- veículo: novo / editar ---------- */
function abrirVeiculo(id){
  if(!frotaPodeEditar()) return;
  _frotaVeicEditId = id || null;
  const v = id ? _frotaVeic.find(x => x.id === id) : null;
  $("fveic-titulo").textContent = v ? `Veículo ${v.codigo}` : "Novo veículo";
  $("fveic-codigo").value = v?.codigo || ""; $("fveic-codigo").disabled = !!v;
  $("fveic-tipo").value = v?.tipo || "caminhao";
  $("fveic-nome").value = v?.nome || "";
  $("fveic-placa").value = v?.placa || "";
  $("fveic-km").value = v?.km ?? "";
  $("fveic-valor-km").value = v?.valor_km ?? "";
  $("fveic-status").value = v?.status || "disponivel";
  $("fveic-ativo").checked = v ? v.ativo !== false : true;
  $("fveic-obs").value = v?.observacoes || "";
  $("frota-veic-modal").style.display = "flex";
}
function fecharVeiculo(){ $("frota-veic-modal").style.display = "none"; _frotaVeicEditId = null; }

async function salvarVeiculo(){
  const reg = {
    nome: $("fveic-nome").value.trim() || null, tipo: $("fveic-tipo").value, placa: ($("fveic-placa").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")) || null,
    km: $("fveic-km").value === "" ? null : Number($("fveic-km").value), valor_km: $("fveic-valor-km").value === "" ? null : Number($("fveic-valor-km").value),
    status: $("fveic-status").value, ativo: $("fveic-ativo").checked, observacoes: $("fveic-obs").value.trim() || null,
  };
  let r;
  if(_frotaVeicEditId) r = await sb.from("equipamentos").update(reg).eq("id", _frotaVeicEditId);
  else {
    const codigo = $("fveic-codigo").value.trim().toUpperCase();
    if(!codigo){ aviso("app-aviso", "Informe a TAG (ex.: 26-CM).", "erro"); return; }
    r = await sb.from("equipamentos").insert({ ...reg, codigo, localizacao_tipo: "base" });
  }
  if(r.error){ aviso("app-aviso", "Erro ao salvar veículo: " + r.error.message, "erro"); return; }
  aviso("app-aviso", "Veículo salvo.", "sucesso");
  fecharVeiculo();
  await carregarFrota(true);
}

/* ---------- ligação ---------- */
function ligarFrota(){
  document.querySelectorAll("#sec-frota .serv-view-btn").forEach(b => b.addEventListener("click", () => { _frotaView = b.dataset.view; renderFrota(); }));
  $("frota-f-mes")?.addEventListener("change", renderFrota);
  $("frota-f-caminhao")?.addEventListener("change", renderFrota);
  $("frota-busca")?.addEventListener("input", debounce(renderFrota));
  $("btn-frota-atualizar")?.addEventListener("click", () => carregarFrota(true));
  $("btn-frota-novo-desl")?.addEventListener("click", () => abrirDeslocamento(null));
  $("btn-frota-novo-veic")?.addEventListener("click", () => abrirVeiculo(null));
  $("frota-conteudo")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-desl]"); if(tr){ abrirDeslocamento(tr.dataset.desl); return; }
    const tv = e.target.closest("tr[data-veic]"); if(tv) abrirVeiculo(tv.dataset.veic);
  });
  $("btn-fdesl-fechar")?.addEventListener("click", fecharDeslocamento);
  $("btn-fdesl-salvar")?.addEventListener("click", () => comBotaoTravado("btn-fdesl-salvar", salvarDeslocamento));
  $("btn-fdesl-excluir")?.addEventListener("click", excluirDeslocamento);
  $("fdesl-caminhao")?.addEventListener("change", frotaSugerirKm);
  $("btn-fveic-fechar")?.addEventListener("click", fecharVeiculo);
  $("btn-fveic-salvar")?.addEventListener("click", () => comBotaoTravado("btn-fveic-salvar", salvarVeiculo));
  document.querySelector('nav button[data-secao="frota"]')?.addEventListener("click", () => carregarFrota(false));
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarFrota); else ligarFrota();

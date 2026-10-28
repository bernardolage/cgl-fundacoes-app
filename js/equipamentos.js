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
async function carregarEquipamentos(force){
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
      _eqpRegistros = (eq.data || []).sort(eqpOrd);
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
  if(_eqpView === "vendas" && typeof vbRenderPainel !== "function") _eqpView = "kanban";
  if(_eqpView === "cpb" && typeof cpbRenderPainel !== "function") _eqpView = "kanban";   // fase 107a: js/computadores_bordo.js
  const ehVendas = _eqpView === "vendas", ehCpb = _eqpView === "cpb";
  [["eqp-indicadores", !ehVendas && !ehCpb], ["eqp-filtros", !ehVendas && !ehCpb], ["vb-indicadores", ehVendas], ["vb-filtros", ehVendas], ["cpb-filtros", ehCpb]].forEach(([id, ver]) => { const el = $(id); if(el) el.style.display = ver ? "" : "none"; });
  const tit = $("eqp-painel-titulo"); if(tit) tit.textContent = ehVendas ? "Vendas de bens" : ehCpb ? "Computadores de bordo" : "Máquinas";
  const bn = $("btn-eqp-novo"); if(bn) bn.style.display = (!ehVendas && !ehCpb && eqpPodeEditar()) ? "" : "none";
  if(!ehCpb){ ["btn-cpb-novo", "btn-cpb-descobrir"].forEach(id => { const el = $(id); if(el) el.style.display = "none"; }); }
  document.querySelectorAll("#eqp-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _eqpView));
  if(ehVendas){ vbRenderPainel(); return; }
  if(ehCpb){ cpbRenderPainel(); return; }
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
  _eqpAtual = null; _eqpEditId = null;
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
    e = data;
  }
  abrirFichaEquipamento(e);
}
function eqpToggleLocalObra(){
  const t = $("eqp-local-tipo").value;
  $("eqp-local-obra-campo").style.display = (t === "obra" || t === "em_transito" || t === "cliente") ? "" : "none";
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
  $("eqp-horimetro").value = e.horimetro ?? ""; $("eqp-aquisicao").value = e.data_aquisicao || "";
  $("eqp-valor").value = e.valor_aquisicao ?? ""; $("eqp-cod-ext").value = e.codigo_externo || "";
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
    .map(([oid, o]) => `<span class="mob-chip">${linkObra(oid, eqpObra(oid) || "obra")} · ${o.n} RDO${o.n === 1 ? "" : "s"} · ${num(o.m)} m · ${dataBR(o.ini)}–${dataBR(o.fim)}</span>`).join(" ");
  cont.innerHTML = `<div class="lista-topo compacta"><h3 class="titulo-bloco" style="margin:0;">RDOs desta máquina <span class="contador">${lista.length}</span></h3>
      <span class="meta" style="margin-left:auto;">Total ${num(lista.reduce((s, r) => s + Number(r.metragem_total || 0), 0))} m</span></div>
    <div style="margin:6px 0 10px;">${resumo}</div>
    <div class="tabela-rola"><table><thead><tr><th>Data</th><th>Obra</th><th>Tipo</th><th title="diário = máquina no cabeçalho; execução = linha desta máquina em diário de outra (ou sem máquina)">Vínculo</th><th class="num">Estacas</th><th class="num">Metragem</th><th class="num">Concreto</th><th>Status</th></tr></thead>
    <tbody>${lista.map(r => `<tr class="linha-clicavel" data-rdo="${esc(r.id)}"><td>${dataBR(r.data)}</td><td>${linkObra(r.obra_id, eqpObra(r.obra_id) || "obra")}</td>
      <td>${esc(EQP_RDO_TIPO[r.tipo_servico] || r.tipo_servico || "")}</td><td>${esc(r.origem)}</td><td class="num">${r.qtd_estacas_executadas || 0}</td>
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
  if(!eqpPodeEditar()) return;
  if(_eqpAtual && (_eqpAtual.status === "vendido" || _eqpAtual.venda_id)){ aviso("app-aviso", "Bem vendido: o cadastro fica só para consulta.", "erro"); return; }   // fase 96
  const n = v => v === "" ? null : Number(v);
  const localTipo = $("eqp-local-tipo").value;
  const reg = {
    nome: $("eqp-nome").value.trim(), tipo: $("eqp-tipo").value,
    marca: $("eqp-marca").value.trim() || null, modelo: $("eqp-modelo").value.trim() || null,
    ano_fabricacao: n($("eqp-ano").value), numero_serie: $("eqp-serie").value.trim() || null,
    horimetro: n($("eqp-horimetro").value), data_aquisicao: $("eqp-aquisicao").value || null, valor_aquisicao: n($("eqp-valor").value),
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
  aviso("app-aviso", "Equipamento salvo.", "ok");
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

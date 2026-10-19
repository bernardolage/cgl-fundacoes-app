/* ====================================================================
   Módulo: Fabricação (fase 84, 19/10/2026)
   Ordem de fabricação da oficina, como no Odoo (mrp.production): o que vai ser feito e quanto, os componentes
   consumidos do estoque (RPC fabricacao_consumir), as horas por funcionário e centro de trabalho (hora extra
   custa ×2) e o custo real que sai disso (gatilhos recalculam custo_componentes, custo_horas e custo_real, salvo
   custo manual). Concluir (RPC fabricacao_concluir) dá entrada no estoque, cria as peças com marcação em
   Acessórios ou lança o custo direto na obra/TAG/centro (vw_custos, ramo fabricacao).
   Painel no padrão Serviços (lista / por status), ficha no padrão Odoo. Prefixo fab-. Desenho copiado de Reparos.
   ==================================================================== */

let _fabView = "lista";
let _fabLista = [];
let _fabAtual = null;          // ordem aberta
let _fabItens = [];
let _fabHoras = [];
let _fabCentros = [];          // centros_trabalho
let _fabFuncs = [];
let _fabModelos = [];          // fabricacao_modelos (listas de materiais)
let _fabAceModelos = [];       // acessorio_modelos ativos (destino acessório)
let _fabEquips = [];
let _fabObras = [];
let _fabCentrosCusto = [];
let _fabProd = null;           // produto produzido escolhido na ficha
let _fabCarregado = false;
let _fabPreset = "";           // filtro de status pedido pela Sala de Comando
let _fabCentroIds = null;      // ids das ordens com horas no centro filtrado (null = sem filtro)
let _fabMd = null;             // lista de materiais aberta no modal
let _fabMdItens = [];
let _fabMdProd = null;

const FAB_STATUS = { rascunho: ["Rascunho", "cinza"], planejada: ["Rascunho", "cinza"], confirmada: ["Confirmada", "azul"], em_producao: ["Em produção", "ambar"],
  pausada: ["Pausada", "cinza"], concluida: ["Concluída", "verde"], cancelada: ["Cancelada", "cinza"] };
const FAB_STAGES = ["rascunho", "confirmada", "em_producao", "concluida"];
const FAB_ABERTAS = ["rascunho", "planejada", "confirmada", "em_producao", "pausada"];
const FAB_DESTINO = { estoque: "Estoque", acessorio: "Acessório", obra: "Obra", equipamento: "TAG", centro_custo: "Centro de custo" };
const FAB_SETOR_CT = { usinagem: "Usinagem", solda: "Solda", corte: "Corte", manual: "Manual", eletrica: "Elétrica", outro: "Outro" };
const FAB_SELECT = "id,numero,status,descricao,produto_id,quantidade,quantidade_produzida,unidade,destino,obra_id,equipamento_id,centro_custo_id,modelo_id,acessorio_modelo_id,responsavel_id,data_abertura,data_inicio_prevista,data_inicio,data_conclusao,custo_estimado,custo_real,custo_componentes,custo_horas,custo_manual,observacoes,codigo_externo,codigo_externo_origem,sincronizado_em,produto:produtos(codigo,nome,unidade,estoque_atual),equipamento:equipamentos(codigo,nome),obra:obras(codigo,nome),centro:centros_custo(codigo,nome)";

function fabPodeEditar(){ return !!usuarioAtual && ["admin", "diretor", "mecanico", "engenheiro", "gestor_acessorios", "logistica", "almoxarife"].includes(usuarioAtual.cargo); }
function fabEhDiretoria(){ return !!usuarioAtual && ["admin", "diretor"].includes(usuarioAtual.cargo); }
function fabSt(st){ return st === "planejada" ? "rascunho" : st; }   // valor antigo do enum (fase 6) lido como rascunho
function fabTag(st){ const o = FAB_STATUS[st] || [st, "cinza"]; return `<span class="tag ${o[1]}">${esc(o[0])}</span>`; }
function fabProdTxt(o){ return o.produto ? `${o.produto.codigo} — ${o.produto.nome}` : (o.descricao || "—"); }
function fabProdLink(o){ return o.produto_id ? linkProduto(o.produto_id, fabProdTxt(o)) : esc(o.descricao || "—"); }
function fabDestinoTxt(o){
  if(o.destino === "obra") return "Obra " + (o.obra ? o.obra.codigo : "—");
  if(o.destino === "equipamento") return "TAG " + (o.equipamento ? o.equipamento.codigo : "—");
  if(o.destino === "centro_custo") return "Centro " + (o.centro ? `${o.centro.codigo} ${o.centro.nome}` : "—");
  return FAB_DESTINO[o.destino] || o.destino || "—";
}
function fabDestinoLink(o){
  if(o.destino === "obra" && o.obra_id && typeof linkObra === "function") return linkObra(o.obra_id, fabDestinoTxt(o));
  if(o.destino === "equipamento" && o.equipamento_id) return linkEquipamento(o.equipamento_id, fabDestinoTxt(o));
  return esc(fabDestinoTxt(o));
}
function fabResp(id){ const f = _fabFuncs.find(x => x.id === id); return f ? f.nome : ""; }
function fabCentroNome(id){ const c = _fabCentros.find(x => x.id === id); return c ? c.nome : ""; }
function fabCentroCusto(id){ const c = _fabCentros.find(x => x.id === id); return c ? Number(c.custo_hora || 0) : 0; }
function fabDias(o){
  const ini = o.data_inicio || o.data_abertura; if(!ini) return null;
  const fim = o.data_conclusao || hojeISO();
  return Math.max(0, Math.round((new Date(fim + "T00:00:00") - new Date(ini + "T00:00:00")) / 864e5));
}
function fabQtd(o){ return Number(o.quantidade_produzida) > 0 ? Number(o.quantidade_produzida) : Number(o.quantidade || 0); }
function fabQtdTxt(o){ const q = Number(o.quantidade || 0), p = Number(o.quantidade_produzida || 0); return `${num(q)} ${esc(o.unidade || "un")}${p && p !== q ? ` <span class="meta">(produzido ${num(p)})</span>` : ""}`; }
function fabAceModeloTxt(m){ return `${(ACE_FAMILIA_LBL || {})[m.familia] || m.familia} · ${m.descricao}${m.medida ? " " + m.medida : ""}`; }
function fabPendentes(){ return _fabItens.filter(i => i.produto_id && !i.movimentacao_estoque_id && !i.codigo_externo && Number(i.quantidade_prevista) > Number(i.quantidade_consumida)); }

/* ---------- carga ---------- */
async function carregarFabricacao(force){
  const cont = $("fab-conteudo"); if(!cont) return;
  if(force || !_fabCarregado){
    const [ct, fu, md, am, eq, ob, cc] = await Promise.all([
      sb.from("centros_trabalho").select("id,nome,setor,custo_hora,ativo,ordem").order("ordem").order("nome"),
      sb.from("funcionarios").select("id,nome,funcao").eq("ativo", true).order("nome"),
      sb.from("fabricacao_modelos").select("id,nome,produto_id,quantidade_base,ativo,codigo_externo,produto:produtos(codigo,nome)").order("nome"),
      sb.from("acessorio_modelos").select("id,familia,tipo,descricao,medida,produto_id").eq("ativo", true).order("familia").order("descricao").order("medida"),
      sb.from("equipamentos").select("id,codigo,nome").eq("ativo", true).order("codigo"),
      sb.from("obras").select("id,codigo,nome,status").not("status", "in", "(concluida,cancelada)").order("codigo", { ascending: false }),
      sb.from("centros_custo").select("id,codigo,nome,tipo").eq("ativo", true).order("codigo")
    ]);
    _fabCentros = ct.data || []; _fabFuncs = fu.data || []; _fabModelos = md.data || []; _fabAceModelos = am.data || [];
    _fabEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
    _fabObras = ob.data || []; _fabCentrosCusto = cc.data || [];
    const ctAtivos = _fabCentros.filter(c => c.ativo !== false);
    $("fab-f-centro").innerHTML = `<option value="">Centro de trabalho</option>` + ctAtivos.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
    $("fab-h-centro").innerHTML = `<option value="">— centro —</option>` + ctAtivos.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.custo_hora > 0 ? " · " + brl(c.custo_hora) + "/h" : ""}</option>`).join("");
    $("fab-f-resp").innerHTML = `<option value="">Responsável</option>` + _fabFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
    const funcOpts = `<option value="">— funcionário —</option>` + _fabFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.funcao ? " · " + esc(f.funcao) : ""}</option>`).join("");
    $("fab-resp").innerHTML = funcOpts.replace("— funcionário —", "— responsável —"); $("fab-h-func").innerHTML = funcOpts;
    $("fab-equip").innerHTML = `<option value="">— TAG —</option>` + _fabEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
    $("fab-obra").innerHTML = `<option value="">— obra —</option>` + _fabObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome || "")}</option>`).join("");
    $("fab-centro").innerHTML = `<option value="">— centro de custo —</option>` + _fabCentrosCusto.map(c => `<option value="${esc(c.id)}">${esc(c.codigo)} — ${esc(c.nome)}</option>`).join("");
    const aceOpts = `<option value="">— modelo de acessório —</option>` + _fabAceModelos.map(m => `<option value="${esc(m.id)}">${esc(fabAceModeloTxt(m))}</option>`).join("");
    $("fab-acemod").innerHTML = aceOpts; $("fab-cc-modelo").innerHTML = aceOpts;
    fabPreencherModelosSelect();
    $("fab-unidade").innerHTML = (typeof UNIDADES !== "undefined" ? UNIDADES : ["un", "pc", "kg", "m"]).map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
    _fabCarregado = true;
  }
  $("btn-fab-novo").style.display = fabPodeEditar() ? "" : "none";
  if(_fabPreset){ $("fab-f-status").value = _fabPreset; _fabPreset = ""; }
  await fabFetch();
  renderFabricacao();
}
function fabPreencherModelosSelect(){
  const ativos = _fabModelos.filter(m => m.ativo !== false);
  $("fab-modelo").innerHTML = `<option value="">— nenhuma —</option>` + ativos.map(m => `<option value="${esc(m.id)}">${esc(m.nome)}${m.produto ? " · " + esc(m.produto.codigo) : ""}</option>`).join("");
}
async function fabFetch(){
  const dias = Number($("fab-f-periodo")?.value || 0);
  const corte = dias ? dataLocalISO(new Date(Date.now() - dias * 864e5)) : null;
  const out = [];
  for(let de = 0; out.length === de; de += 1000){
    let q = sb.from("ordens_fabricacao").select(FAB_SELECT).order("data_abertura", { ascending: false }).order("numero", { ascending: false }).range(de, de + 999);
    if(corte) q = q.or(`data_abertura.gte.${corte},status.in.(${FAB_ABERTAS.join(",")})`);
    const r = await q;
    if(r.error){ aviso("app-aviso", "Erro ao carregar as ordens de fabricação: " + r.error.message, "erro"); break; }
    out.push(...(r.data || []));
  }
  _fabLista = out;
}
/* filtro por centro de trabalho: ordens com pelo menos uma hora lançada nele */
async function fabFiltrarCentro(){
  const ct = $("fab-f-centro")?.value || "";
  if(!ct){ _fabCentroIds = null; renderFabricacao(); return; }
  const { data } = await sb.from("fabricacao_horas").select("ordem_id").eq("centro_trabalho_id", ct).limit(5000);
  _fabCentroIds = new Set((data || []).map(h => h.ordem_id));
  renderFabricacao();
}

/* ---------- painel ---------- */
function fabFiltrados(){
  const q = ($("fab-busca")?.value || "").trim().toLowerCase();
  const st = $("fab-f-status")?.value ?? "_abertas", rs = $("fab-f-resp")?.value || "", ds = $("fab-f-destino")?.value || "";
  return _fabLista.filter(o => {
    if(st === "_abertas"){ if(!FAB_ABERTAS.includes(o.status)) return false; }
    else if(st && fabSt(o.status) !== st) return false;
    if(rs && o.responsavel_id !== rs) return false;
    if(ds && o.destino !== ds) return false;
    if(_fabCentroIds && !_fabCentroIds.has(o.id)) return false;
    if(q && ![o.numero, o.codigo_externo, o.descricao, o.produto?.codigo, o.produto?.nome, o.observacoes, o.equipamento?.codigo, o.obra?.codigo].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderFabricacao(){
  const cont = $("fab-conteudo"); if(!cont) return;
  document.querySelectorAll("#fab-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _fabView));
  const dados = fabFiltrados();
  $("fab-contador").textContent = `${dados.length} de ${_fabLista.length}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhuma ordem de fabricação com esses filtros.</p>`; return; }
  if(_fabView === "kanban"){
    const cols = FAB_STAGES.concat(dados.some(o => o.status === "cancelada") ? ["cancelada"] : []);
    cont.innerHTML = `<div class="serv-kanban">${cols.map(st => { const its = dados.filter(o => fabSt(o.status) === st || (st === "em_producao" && o.status === "pausada"));
      return `<div class="serv-kan-col"><div class="serv-kan-col-head">${fabTag(st)} <span class="contador">${its.length}</span></div>
        ${its.slice(0, 200).map(o => `<div class="serv-kan-card" data-id="${esc(o.id)}">
          <div class="serv-kan-card-nome"><strong>${esc(o.numero || "")}</strong> <span class="meta">${dataBR(o.data_abertura)}${o.codigo_externo ? " · " + esc(o.codigo_externo) : ""}</span></div>
          <div>${esc(fabProdTxt(o))}</div><div class="meta">${fabQtdTxt(o)} · ${esc(fabDestinoTxt(o))}</div>
          <div class="meta" style="display:flex;justify-content:space-between;"><span>${esc(fabResp(o.responsavel_id))}</span><strong>${brl(o.custo_real)}</strong></div>
        </div>`).join("") || `<p class="vazio">—</p>`}${its.length > 200 ? `<p class="meta">… e mais ${its.length - 200}</p>` : ""}</div>`; }).join("")}</div>`;
  } else {
    cont.innerHTML = `<div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Abertura</th><th>Produto / descrição</th><th class="num">Qtd</th><th>Destino</th><th>Responsável</th><th class="num">Dias</th><th class="num">Custo</th><th>Status</th></tr></thead>
      <tbody>${dados.map(o => `<tr class="linha-clicavel" data-id="${esc(o.id)}">
        <td><strong>${esc(o.numero || "")}</strong>${o.codigo_externo ? ` <span class="meta">${esc(o.codigo_externo)}</span>` : ""}</td><td>${dataBR(o.data_abertura)}</td>
        <td>${fabProdLink(o)}${o.produto && o.descricao && o.descricao !== o.produto.nome ? ` <span class="meta">${esc(o.descricao)}</span>` : ""}</td><td class="num">${fabQtdTxt(o)}</td>
        <td>${fabDestinoLink(o)}</td><td class="meta">${esc(fabResp(o.responsavel_id))}</td>
        <td class="num">${fabDias(o) ?? "—"}</td><td class="num">${brl(o.custo_real)}</td><td>${fabTag(o.status)}</td></tr>`).join("")}</tbody></table></div>`;
  }
}

/* ---------- ficha ---------- */
function novaOrdemFabricacao(pre){
  if(!fabPodeEditar()){ aviso("app-aviso", "Seu perfil não registra fabricação.", "erro"); return; }
  abrirFichaFabricacao(Object.assign({ id: null, numero: "(nova)", status: "rascunho", destino: "estoque", quantidade: 1, unidade: "un", data_abertura: hojeISO() }, pre || {}), [], []);
}
async function abrirOrdemFabricacao(id){
  if(!_fabCarregado) await carregarFabricacao(false);
  const [o, it, hs] = await Promise.all([
    sb.from("ordens_fabricacao").select(FAB_SELECT).eq("id", id).maybeSingle(),
    sb.from("fabricacao_itens").select("*").eq("ordem_id", id).order("created_at"),
    sb.from("fabricacao_horas").select("*").eq("ordem_id", id).order("data").order("inicio").order("created_at")
  ]);
  if(o.error || !o.data){ aviso("app-aviso", "Não foi possível abrir a ordem de fabricação" + (o.error ? ": " + o.error.message : "."), "erro"); return; }
  abrirFichaFabricacao(o.data, it.data || [], hs.data || []);
}
function abrirFichaFabricacao(o, itens, horas){
  _fabAtual = o; _fabItens = itens; _fabHoras = horas;
  _fabProd = o.produto_id ? { id: o.produto_id, codigo: o.produto?.codigo || "", nome: o.produto?.nome || "", unidade: o.produto?.unidade || "un" } : null;
  $("fab-painel").style.display = "none"; $("fab-ficha").style.display = "";
  const novo = !o.id, pode = fabPodeEditar(), fechada = ["concluida", "cancelada"].includes(o.status);
  $("fab-ficha-titulo").textContent = novo ? "Nova ordem de fabricação" : `${o.numero} · ${fabProdTxt(o)}`;
  $("fab-prod-busca").value = _fabProd ? `${_fabProd.codigo} — ${_fabProd.nome}` : "";
  $("fab-prod-info").textContent = _fabProd ? `Unidade do catálogo: ${_fabProd.unidade}${o.produto && o.produto.estoque_atual != null ? ` · em estoque: ${num(o.produto.estoque_atual)}` : ""}` : "Sem produto do catálogo, descreva o que vai ser feito.";
  $("fab-desc").value = o.descricao || ""; $("fab-qtd").value = o.quantidade ?? 1; $("fab-qtd-prod").value = Number(o.quantidade_produzida) > 0 ? o.quantidade_produzida : "";
  $("fab-unidade").value = o.unidade || "un"; if($("fab-unidade").value !== (o.unidade || "un")) $("fab-unidade").value = "un";
  $("fab-destino").value = o.destino || "estoque";
  $("fab-obra").value = o.obra_id || ""; $("fab-equip").value = o.equipamento_id || ""; $("fab-centro").value = o.centro_custo_id || ""; $("fab-acemod").value = o.acessorio_modelo_id || "";
  $("fab-resp").value = o.responsavel_id || ""; $("fab-modelo").value = o.modelo_id || "";
  $("fab-abertura").value = o.data_abertura || ""; $("fab-inicio-prev").value = o.data_inicio_prevista || ""; $("fab-inicio").value = o.data_inicio || ""; $("fab-conclusao").value = o.data_conclusao || "";
  $("fab-obs").value = o.observacoes || "";
  fabDestinoCampos();
  $("fab-ficha").querySelectorAll(".odoo-tab[data-tab=geral] input, .odoo-tab[data-tab=geral] select").forEach(el => el.disabled = !pode || fechada);
  $("fab-h-data").value = hojeISO();
  fabAtualizarCabecalho();
  fabRenderItens(); fabRenderHoras(); fabRenderCustos();
  if(o.id && typeof montarHistorico === "function") montarHistorico("ordens_fabricacao", o.id, "fab-chatter");
  else if(typeof ocultarHistorico === "function") ocultarHistorico("fab-chatter");
  fabAtivarTab("geral");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function fabDestinoCampos(){
  const d = $("fab-destino").value;
  $("fab-c-obra").style.display = d === "obra" ? "" : "none";
  $("fab-c-equip").style.display = d === "equipamento" ? "" : "none";
  $("fab-c-centro").style.display = d === "centro_custo" ? "" : "none";
  $("fab-c-acemod").style.display = d === "acessorio" ? "" : "none";
}
function fabAtualizarCabecalho(){
  const o = _fabAtual; if(!o) return;
  const st = fabSt(o.status || "rascunho"), novo = !o.id, pode = fabPodeEditar(), aberta = !["concluida", "cancelada"].includes(st);
  document.querySelectorAll("#fab-statusbar .stage").forEach(el => {
    el.classList.remove("atual", "passada");
    const i = FAB_STAGES.indexOf(st === "pausada" ? "em_producao" : st), j = FAB_STAGES.indexOf(el.dataset.status);
    if(st !== "cancelada"){ if(j === i) el.classList.add("atual"); else if(j < i) el.classList.add("passada"); }
  });
  $("fab-chip-num").textContent = o.numero || "(nova)";
  $("fab-chip-prod").innerHTML = novo ? "—" : fabProdLink(o);
  $("fab-chip-qtd").innerHTML = fabQtdTxt(o);
  $("fab-chip-dest").innerHTML = fabDestinoLink(o);
  $("fab-chip-resp").textContent = fabResp(o.responsavel_id) || "—";
  $("fab-chip-dias").textContent = novo ? "—" : (fabDias(o) ?? "—");
  $("fab-chip-odoo").style.display = o.codigo_externo ? "" : "none"; $("fab-chip-odoo-txt").textContent = o.codigo_externo || "";
  const pend = fabPendentes().length > 0;
  const temLista = !!o.modelo_id || _fabModelos.some(m => m.ativo !== false && (m.produto_id === o.produto_id || !o.produto_id));
  const mostra = { "btn-fab-salvar": pode && aberta, "btn-fab-confirmar": pode && !novo && st === "rascunho", "btn-fab-iniciar": pode && !novo && st === "confirmada",
    "btn-fab-aplicar": pode && !novo && aberta && temLista, "btn-fab-consumir": pode && !novo && ["confirmada", "em_producao", "pausada"].includes(st) && pend,
    "btn-fab-concluir": pode && !novo && ["confirmada", "em_producao", "pausada"].includes(st), "btn-fab-cancelar": pode && !novo && aberta };
  Object.entries(mostra).forEach(([id, on]) => { const b = $(id); if(b) b.style.display = on ? "" : "none"; });
  const sb2 = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !n || n === "R$ 0,00"); } };
  sb2("sb-fab-comp", _fabItens.length); sb2("sb-fab-horas", num(_fabHoras.reduce((t, h) => t + Number(h.horas || 0), 0)));
  sb2("sb-fab-custo", brl(o.custo_real || 0));
  $("fab-itens-add").style.display = pode && !novo && aberta ? "" : "none";
  $("fab-horas-add").style.display = pode && !novo && aberta ? "" : "none";
}
function fabAtivarTab(nome){
  document.querySelectorAll("#fab-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#fab-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
function mostrarPainelFabricacao(){ $("fab-ficha").style.display = "none"; $("fab-painel").style.display = ""; _fabAtual = null; renderFabricacao(); }

async function salvarOrdemFabricacao(){
  if(!fabPodeEditar() || !_fabAtual) return null;
  const destino = $("fab-destino").value;
  const reg = { produto_id: _fabProd ? _fabProd.id : null, descricao: $("fab-desc").value.trim() || null, quantidade: Number($("fab-qtd").value || 0),
    quantidade_produzida: $("fab-qtd-prod").value === "" ? 0 : Number($("fab-qtd-prod").value), unidade: $("fab-unidade").value || "un", destino,
    obra_id: destino === "obra" ? $("fab-obra").value || null : null, equipamento_id: destino === "equipamento" ? $("fab-equip").value || null : null,
    centro_custo_id: destino === "centro_custo" ? $("fab-centro").value || null : null, acessorio_modelo_id: destino === "acessorio" ? $("fab-acemod").value || null : null,
    responsavel_id: $("fab-resp").value || null, modelo_id: $("fab-modelo").value || null,
    data_abertura: $("fab-abertura").value || hojeISO(), data_inicio_prevista: $("fab-inicio-prev").value || null, data_inicio: $("fab-inicio").value || null,
    data_conclusao: $("fab-conclusao").value || null, observacoes: $("fab-obs").value.trim() || null };
  const erro = (m) => { aviso("app-aviso", m, "erro"); fabAtivarTab("geral"); return null; };
  if(!reg.produto_id && !reg.descricao) return erro("Escolha o produto do catálogo ou descreva o que vai ser fabricado.");
  if(!(reg.quantidade > 0)) return erro("Informe a quantidade.");
  if(destino === "obra" && !reg.obra_id) return erro("Escolha a obra que recebe o custo.");
  if(destino === "equipamento" && !reg.equipamento_id) return erro("Escolha a TAG que recebe o custo.");
  if(destino === "centro_custo" && !reg.centro_custo_id) return erro("Escolha o centro de custo.");
  if(destino === "estoque" && !reg.produto_id) return erro("Para dar entrada no estoque a ordem precisa de um produto do catálogo.");
  let id = _fabAtual.id;
  if(id){ const { error } = await sb.from("ordens_fabricacao").update(reg).eq("id", id); if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return null; } }
  else { const { data, error } = await sb.from("ordens_fabricacao").insert({ ...reg, status: "rascunho" }).select("id").single(); if(error){ aviso("app-aviso", "Erro ao criar: " + error.message, "erro"); return null; } id = data.id; }
  aviso("app-aviso", "Ordem de fabricação salva.", "ok");
  await abrirOrdemFabricacao(id);
  return id;
}
async function fabAcao(acao){
  const o = _fabAtual; if(!o?.id) return;
  const rpcErro = (e, prefixo) => aviso("app-aviso", `${prefixo}: ` + String(e.message || e).replace(/^.*?: /, ""), "erro");
  if(acao === "aplicar"){
    const modelo = $("fab-modelo").value || o.modelo_id || null;
    if(!modelo && !_fabModelos.some(m => m.ativo !== false && m.produto_id === o.produto_id)){ aviso("app-aviso", "Escolha a lista de materiais na aba Geral e salve.", "erro"); fabAtivarTab("geral"); return; }
    const { data, error } = await sb.rpc("fabricacao_aplicar_modelo", { p_ordem_id: o.id, p_modelo_id: modelo });
    if(error){ rpcErro(error, "Lista não aplicada"); return; }
    aviso("app-aviso", `${data || 0} componente(s) acrescentado(s) pela lista de materiais.`, "ok");
    await abrirOrdemFabricacao(o.id); fabAtivarTab("componentes"); return;
  }
  if(acao === "consumir"){
    const { data, error } = await sb.rpc("fabricacao_consumir", { p_ordem_id: o.id });
    if(error){ rpcErro(error, "Consumo não feito"); return; }
    aviso("app-aviso", `${data || 0} componente(s) com baixa no estoque.`, "ok");
    if(typeof carregarProdutos === "function") carregarProdutos();
    await abrirOrdemFabricacao(o.id); fabAtivarTab("componentes"); return;
  }
  if(acao === "concluir"){
    if(o.destino === "acessorio"){ await fabAbrirConcluirModal(); return; }
    const pend = fabPendentes().length;
    const txt = o.destino === "estoque" ? `Concluir ${o.numero}: entram ${num(fabQtd(o))} ${o.unidade || "un"} de ${fabProdTxt(o)} no estoque com o custo real da ordem.`
      : `Concluir ${o.numero}: o custo real (${brl(o.custo_real)}) vai para ${fabDestinoTxt(o)}.`;
    if(!confirm(txt + (pend ? `\n${pend} componente(s) ainda sem baixa saem do estoque agora.` : ""))) return;
    const { data, error } = await sb.rpc("fabricacao_concluir", { p_ordem_id: o.id });
    if(error){ rpcErro(error, "Não foi possível concluir"); return; }
    aviso("app-aviso", `Ordem concluída. Custo real ${brl(data?.custo_real || 0)}${o.destino === "estoque" ? ` · entrada no estoque a ${brl(data?.custo_unitario || 0)} por ${o.unidade || "un"}` : ""}.`, "ok");
    if(typeof carregarProdutos === "function") carregarProdutos();
    await abrirOrdemFabricacao(o.id); fabAtivarTab("custos"); return;
  }
  if(acao === "cancelada" && !confirm(`Cancelar a ordem ${o.numero}?${_fabItens.some(i => i.movimentacao_estoque_id) ? "\nComponentes já consumidos não voltam ao estoque sozinhos (use Estoque › Devolução, se for o caso)." : ""}`)) return;
  const upd = { status: acao };
  if(acao === "em_producao" && !o.data_inicio) upd.data_inicio = hojeISO();
  const { error } = await sb.from("ordens_fabricacao").update(upd).eq("id", o.id);
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
  aviso("app-aviso", `Ordem de fabricação: ${FAB_STATUS[acao][0].toLowerCase()}.`, "ok");
  await abrirOrdemFabricacao(o.id);
}

/* concluir com destino acessório: uma marcação por unidade; sugere a próxima da família */
async function fabAbrirConcluirModal(){
  const o = _fabAtual; if(!o) return;
  const n = Math.round(fabQtd(o));
  if(!(n > 0) || n !== fabQtd(o)){ aviso("app-aviso", "Peça com marcação é contada por unidade inteira: ajuste a quantidade.", "erro"); return; }
  if(n > 50){ aviso("app-aviso", "Mais de 50 peças numa ordem: divida em ordens menores para informar as marcações.", "erro"); return; }
  const modeloId = o.acessorio_modelo_id || (_fabAceModelos.filter(m => m.produto_id && m.produto_id === o.produto_id).length === 1 ? _fabAceModelos.find(m => m.produto_id === o.produto_id).id : "");
  $("fab-cc-modelo").value = modeloId || "";
  $("fab-cc-resumo").textContent = `${o.numero} · ${fabProdTxt(o)} · ${n} peça(s). Custo real da ordem ${brl(o.custo_real)}${fabPendentes().length ? " (mais os componentes ainda sem baixa)" : ""}: cada peça nasce no pátio, em bom estado, com "Fabricada na ${o.numero}".`;
  await fabRenderMarcacoes(n);
  $("fab-cc-modal").style.display = "flex";
}
async function fabRenderMarcacoes(n){
  const mod = _fabAceModelos.find(m => m.id === $("fab-cc-modelo").value);
  const atuais = [...document.querySelectorAll("#fab-cc-marcacoes .fab-cc-marc")].map(i => i.value.trim());
  const sug = atuais.some(Boolean) ? atuais : await fabSugerirMarcacoes(mod, n);
  $("fab-cc-marcacoes").innerHTML = Array.from({ length: n }, (_, i) => `<div class="campo"><label>Marcação ${i + 1} *</label><input class="fab-cc-marc" value="${esc(sug[i] || "")}" placeholder="ex.: CGL-PT-160" /></div>`).join("");
}
async function fabSugerirMarcacoes(mod, n){
  if(!mod) return [];
  const { data } = await sb.from("acessorios").select("marcacao").eq("familia", mod.familia).eq("tipo", mod.tipo).limit(3000);
  const grupos = {};
  (data || []).forEach(a => { const m = String(a.marcacao || "").trim().match(/^(.*?)(\d+)$/); if(!m) return; const g = grupos[m[1]] = grupos[m[1]] || { n: 0, max: 0 }; g.n++; g.max = Math.max(g.max, Number(m[2])); });
  const melhor = Object.entries(grupos).sort((a, b) => b[1].n - a[1].n)[0];
  if(!melhor) return [];
  return Array.from({ length: n }, (_, i) => melhor[0] + String(melhor[1].max + 1 + i));
}
async function fabConcluirComMarcacoes(){
  const o = _fabAtual; if(!o?.id) return;
  const modelo = $("fab-cc-modelo").value;
  if(!modelo){ aviso("app-aviso", "Escolha o modelo de acessório (família e tipo) da peça.", "erro"); return; }
  const marcs = [...document.querySelectorAll("#fab-cc-marcacoes .fab-cc-marc")].map(i => i.value.trim().toUpperCase());
  if(marcs.some(m => !m)){ aviso("app-aviso", "Preencha todas as marcações.", "erro"); return; }
  if(new Set(marcs).size !== marcs.length){ aviso("app-aviso", "Há marcação repetida.", "erro"); return; }
  const { data, error } = await sb.rpc("fabricacao_concluir", { p_ordem_id: o.id, p_marcacoes: marcs, p_modelo_id: modelo });
  if(error){ aviso("app-aviso", "Não foi possível concluir: " + String(error.message).replace(/^.*?: /, ""), "erro"); return; }
  $("fab-cc-modal").style.display = "none";
  aviso("app-aviso", `Ordem concluída: ${(data?.acessorios || []).length} peça(s) cadastrada(s) em Acessórios (${marcs.join(", ")}), custo real ${brl(data?.custo_real || 0)} (${brl(data?.custo_unitario || 0)} por peça).`, "ok");
  if(typeof aceInvalidar === "function") aceInvalidar();
  if(typeof carregarProdutos === "function") carregarProdutos();
  await abrirOrdemFabricacao(o.id); fabAtivarTab("custos");
}

/* componentes */
function fabRenderItens(){
  const tb = $("fab-itens"), pode = fabPodeEditar() && !["concluida", "cancelada"].includes(_fabAtual?.status);
  if(!_fabItens.length){ tb.innerHTML = `<tr><td colspan="8" class="vazio">${_fabAtual?.id ? "Nenhum componente lançado. Use \"Aplicar lista\" ou busque no catálogo." : "Salve a ordem para lançar componentes."}</td></tr>`; $("fab-itens-total").textContent = ""; return; }
  tb.innerHTML = _fabItens.map(i => {
    const prev = Number(i.quantidade_prevista || 0), cons = Number(i.quantidade_consumida || 0), cu = Number(i.custo_unitario || 0);
    const baixa = i.movimentacao_estoque_id ? '<span class="tag verde">baixado no estoque</span>' : i.codigo_externo ? '<span class="tag cinza">baixa no Odoo</span>'
      : !i.produto_id ? '<span class="meta">sem produto</span>' : cons >= prev && prev > 0 ? '<span class="tag verde">consumido</span>' : '<span class="tag ambar">pendente</span>';
    return `<tr><td>${i.produto_id ? linkProduto(i.produto_id, i.descricao) : esc(i.descricao)}</td><td>${esc(i.unidade || "un")}</td><td class="num">${num(prev)}</td><td class="num">${num(cons)}</td>
      <td class="num">${brl(cu)}</td><td class="num">${brl((cons > 0 ? cons : prev) * cu)}${cons > 0 ? "" : ' <span class="meta">prev.</span>'}</td><td>${baixa}</td>
      <td>${pode && !i.movimentacao_estoque_id && !i.codigo_externo ? `<button type="button" class="btn-sec btn-sm fab-item-rem" data-id="${esc(i.id)}" title="remover">×</button>` : ""}</td></tr>`; }).join("");
  const prevTot = _fabItens.reduce((t, i) => t + Number(i.quantidade_prevista || 0) * Number(i.custo_unitario || 0), 0);
  $("fab-itens-total").innerHTML = `Consumido: <strong>${brl(_fabAtual?.custo_componentes || 0)}</strong> · previsto pela lista: ${brl(prevTot)}${fabPendentes().length ? ` · <span class="tag ambar">${fabPendentes().length} sem baixa</span>` : ""}`;
  tb.querySelectorAll(".fab-item-rem").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("fabricacao_itens").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await abrirOrdemFabricacao(_fabAtual.id); fabAtivarTab("componentes");
  }));
}
async function fabAddItem(p){
  if(!_fabAtual?.id || !p) return;
  const qtd = Number($("fab-comp-qtd").value || 1);
  if(!(qtd > 0)){ aviso("app-aviso", "Informe a quantidade prevista.", "erro"); return; }
  const { error } = await sb.from("fabricacao_itens").insert({ ordem_id: _fabAtual.id, produto_id: p.id, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || "un",
    quantidade_prevista: qtd, custo_unitario: Number(p.custo_ultimo || 0) });
  if(error){ aviso("app-aviso", "Não foi possível lançar o componente: " + error.message, "erro"); return; }
  $("fab-comp-qtd").value = 1;
  await abrirOrdemFabricacao(_fabAtual.id); fabAtivarTab("componentes");
}

/* horas */
function fabRenderHoras(){
  const tb = $("fab-horas"), pode = fabPodeEditar() && !["concluida", "cancelada"].includes(_fabAtual?.status);
  const nomeF = id => (_fabFuncs.find(f => f.id === id) || {}).nome || "";
  if(!_fabHoras.length){ tb.innerHTML = `<tr><td colspan="9" class="vazio">${_fabAtual?.id ? "Nenhuma hora lançada." : "Salve a ordem para lançar horas."}</td></tr>`; $("fab-horas-total").textContent = ""; return; }
  tb.innerHTML = _fabHoras.map(h => `<tr><td>${esc(nomeF(h.funcionario_id) || "—")}</td><td>${esc(fabCentroNome(h.centro_trabalho_id) || "—")}</td><td>${dataBR(h.data)}</td>
    <td>${h.inicio ? esc(String(h.inicio).slice(0, 5)) : "—"}</td><td>${h.fim ? esc(String(h.fim).slice(0, 5)) : "—"}</td><td>${h.hora_extra ? '<span class="tag ambar">HE</span>' : ""}</td>
    <td class="num">${num(h.horas)}</td><td class="meta">${esc(h.observacao || "")}${h.codigo_externo ? " · Odoo" : ""}</td>
    <td>${pode && !h.codigo_externo ? `<button type="button" class="btn-sec btn-sm fab-h-rem" data-id="${esc(h.id)}" title="remover">×</button>` : ""}</td></tr>`).join("");
  const soma = (f) => _fabHoras.filter(f).reduce((t, h) => t + Number(h.horas || 0), 0);
  const porC = {}; _fabHoras.forEach(h => { const n = fabCentroNome(h.centro_trabalho_id) || "sem centro"; porC[n] = (porC[n] || 0) + Number(h.horas || 0); });
  const porF = {}; _fabHoras.forEach(h => { const n = nomeF(h.funcionario_id) || "sem funcionário"; porF[n] = (porF[n] || 0) + Number(h.horas || 0); });
  const lista = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${esc(n)} ${num(v)} h`).join(" · ");
  $("fab-horas-total").innerHTML = `Total: <strong>${num(soma(() => true))} h</strong>${soma(h => h.hora_extra) ? ` (${num(soma(h => h.hora_extra))} h de hora extra)` : ""}<br>Por centro: ${lista(porC)}<br>Por funcionário: ${lista(porF)}`;
  tb.querySelectorAll(".fab-h-rem").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("fabricacao_horas").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await abrirOrdemFabricacao(_fabAtual.id); fabAtivarTab("horas");
  }));
}
async function fabAddHoras(){
  if(!_fabAtual?.id) return;
  const reg = { ordem_id: _fabAtual.id, funcionario_id: $("fab-h-func").value || null, centro_trabalho_id: $("fab-h-centro").value || null, data: $("fab-h-data").value || hojeISO(),
    inicio: $("fab-h-inicio").value || null, fim: $("fab-h-fim").value || null, horas: $("fab-h-horas").value === "" ? null : Number($("fab-h-horas").value),
    hora_extra: $("fab-h-he").checked, observacao: $("fab-h-obs").value.trim() || null };
  if(!reg.funcionario_id){ aviso("app-aviso", "Escolha o funcionário.", "erro"); return; }
  if(!reg.centro_trabalho_id){ aviso("app-aviso", "Escolha o centro de trabalho.", "erro"); return; }
  if(!(reg.inicio && reg.fim) && reg.horas == null){ aviso("app-aviso", "Informe início e fim (o sistema calcula as horas) ou as horas.", "erro"); return; }
  if(reg.inicio && reg.fim) reg.horas = 0;   // o gatilho calcula
  const { error } = await sb.from("fabricacao_horas").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível lançar: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  ["fab-h-inicio", "fab-h-fim", "fab-h-horas", "fab-h-obs"].forEach(id => $(id).value = ""); $("fab-h-he").checked = false;
  await abrirOrdemFabricacao(_fabAtual.id); fabAtivarTab("horas");
}

/* custos */
function fabRenderCustos(){
  const o = _fabAtual, c = $("fab-custos"); if(!o || !c) return;
  const pode = fabPodeEditar() && !!o.id;
  const horas = _fabHoras.reduce((t, h) => t + Number(h.horas || 0), 0);
  const porC = {};
  _fabHoras.forEach(h => { const k = h.centro_trabalho_id || "_"; const g = porC[k] = porC[k] || { nome: fabCentroNome(h.centro_trabalho_id) || "sem centro", custo: fabCentroCusto(h.centro_trabalho_id), normais: 0, he: 0 }; if(h.hora_extra) g.he += Number(h.horas || 0); else g.normais += Number(h.horas || 0); });
  const linhasC = Object.values(porC).sort((a, b) => (b.normais + b.he) - (a.normais + a.he)).map(g =>
    `<div class="custos-linha"><span>${esc(g.nome)}: ${num(g.normais)} h${g.he ? ` + ${num(g.he)} h HE (×2)` : ""} × ${g.custo ? brl(g.custo) + "/h" : "hora não definida"}</span><strong>${brl((g.normais + 2 * g.he) * g.custo)}</strong></div>`).join("");
  const qtd = fabQtd(o), unit = qtd > 0 ? Number(o.custo_real || 0) / qtd : 0;
  const prevTot = _fabItens.reduce((t, i) => t + Number(i.quantidade_prevista || 0) * Number(i.custo_unitario || 0), 0);
  const destinoTxt = { estoque: "Concluída, dá entrada do produto no estoque pelo custo unitário acima; o custo não entra em Custos de obra/TAG.",
    acessorio: "Concluída, cada peça nasce em Acessórios com este custo; nada entra em Custos de obra/TAG.",
    obra: "Concluída, entra em Custos da obra em duas linhas: componentes (peça) e mão de obra interna.",
    equipamento: "Concluída, entra em Custos da TAG em duas linhas: componentes (peça) e mão de obra interna.",
    centro_custo: "Concluída, entra nos custos do centro em duas linhas: componentes (peça) e mão de obra interna." }[o.destino] || "";
  c.innerHTML = `<div class="custos-resumo">
      <div><div class="mov-ace-sug-grupo-t">Composição</div>
        <div class="custos-linha"><span>Componentes consumidos${prevTot ? ` <span class="meta">(previsto ${brl(prevTot)})</span>` : ""}</span><strong>${brl(o.custo_componentes || 0)}</strong></div>
        ${linhasC || `<div class="custos-linha"><span>Mão de obra (${num(horas)} h)</span><strong>${brl(o.custo_horas || 0)}</strong></div>`}
        ${linhasC ? `<div class="custos-linha"><span>Mão de obra (${num(horas)} h)</span><strong>${brl(o.custo_horas || 0)}</strong></div>` : ""}
        <div class="custos-linha"><span><strong>Custo real</strong>${o.custo_manual ? " <span class=\"tag ambar\">digitado</span>" : ""}</span><strong>${brl(o.custo_real || 0)}</strong></div>
        <div class="custos-linha"><span>Custo unitário (${num(qtd)} ${esc(o.unidade || "un")})</span><strong>${brl(unit)}</strong></div>
      </div>
      <div><div class="mov-ace-sug-grupo-t">Custo digitado à mão</div>
        <p class="meta">Use quando o custo real não sai dos componentes e das horas (serviço externo, ordem antiga).</p>
        ${pode ? `<label class="check-inline"><input type="checkbox" id="fab-custo-manual"${o.custo_manual ? " checked" : ""} /> custo manual</label>
          <input type="number" id="fab-custo-valor" min="0" step="0.01" value="${esc(o.custo_real || 0)}" style="width:140px;"${o.custo_manual ? "" : " disabled"} />
          <button type="button" class="btn-sec btn-sm" id="btn-fab-custo-salvar">💾 Salvar custo</button>` : ""}
      </div></div>
    <p class="meta">${esc(destinoTxt)} Centros sem custo/h definido entram com zero: a diretoria define em "Centros de trabalho".</p>`;
  $("fab-custo-manual")?.addEventListener("change", e => { $("fab-custo-valor").disabled = !e.target.checked; });
  $("btn-fab-custo-salvar")?.addEventListener("click", async () => {
    const manual = $("fab-custo-manual").checked;
    const upd = manual ? { custo_manual: true, custo_real: Number($("fab-custo-valor").value || 0) } : { custo_manual: false };
    const { error } = await sb.from("ordens_fabricacao").update(upd).eq("id", o.id);
    if(error){ aviso("app-aviso", "Não foi possível salvar o custo: " + error.message, "erro"); return; }
    aviso("app-aviso", manual ? "Custo manual salvo." : "Custo volta a ser componentes + horas.", "ok");
    await abrirOrdemFabricacao(o.id); fabAtivarTab("custos");
  });
}

/* ---------- centros de trabalho (configuração; diretoria edita custo/h) ---------- */
async function fabAbrirCentros(){
  if(!_fabCarregado) await carregarFabricacao(false);
  const { data } = await sb.from("centros_trabalho").select("id,nome,setor,custo_hora,ativo,ordem").order("ordem").order("nome");
  _fabCentros = data || _fabCentros;
  const pode = fabEhDiretoria();
  $("fab-ct-novo").style.display = pode ? "" : "none";
  $("fab-ct-lista").innerHTML = _fabCentros.map(c => `<tr data-id="${esc(c.id)}"><td>${esc(c.nome)}</td><td>${esc(FAB_SETOR_CT[c.setor] || c.setor || "")}</td>
      <td class="num">${pode ? `<input type="number" class="fab-ct-custo" min="0" step="0.01" value="${esc(c.custo_hora || 0)}" style="width:110px;text-align:right;" />` : brl(c.custo_hora)}</td>
      <td>${pode ? `<input type="checkbox" class="fab-ct-ativo"${c.ativo !== false ? " checked" : ""} />` : (c.ativo !== false ? "sim" : "não")}</td>
      <td>${pode ? `<button type="button" class="btn-sec btn-sm fab-ct-salvar">💾</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="vazio">Nenhum centro cadastrado.</td></tr>`;
  $("fab-ct-lista").querySelectorAll(".fab-ct-salvar").forEach(b => b.addEventListener("click", async () => {
    const tr = b.closest("tr"), id = tr.dataset.id;
    const custo = Number(String(tr.querySelector(".fab-ct-custo").value).replace(",", "."));
    if(!(custo >= 0)){ aviso("app-aviso", "Custo/h inválido.", "erro"); return; }
    const { error } = await sb.from("centros_trabalho").update({ custo_hora: custo, ativo: tr.querySelector(".fab-ct-ativo").checked }).eq("id", id);
    if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
    aviso("app-aviso", "Centro de trabalho salvo. As ordens abertas com horas nele foram recalculadas.", "ok");
    _fabCarregado = false; await carregarFabricacao(true); await fabAbrirCentros();
  }));
  $("fab-ct-modal").style.display = "flex";
}
async function fabAddCentro(){
  const nome = $("fab-ct-nome").value.trim(); if(!nome){ aviso("app-aviso", "Informe o nome do centro.", "erro"); return; }
  const { error } = await sb.from("centros_trabalho").insert({ nome, setor: $("fab-ct-setor").value, custo_hora: Number($("fab-ct-custo").value || 0), ordem: 1000 });
  if(error){ aviso("app-aviso", "Não foi possível criar: " + error.message, "erro"); return; }
  $("fab-ct-nome").value = ""; $("fab-ct-custo").value = 0;
  _fabCarregado = false; await carregarFabricacao(true); await fabAbrirCentros();
}

/* ---------- listas de materiais (configuração) ---------- */
async function fabAbrirModelos(){
  if(!_fabCarregado) await carregarFabricacao(false);
  const { data } = await sb.from("fabricacao_modelos").select("id,nome,produto_id,quantidade_base,ativo,codigo_externo,observacoes,produto:produtos(codigo,nome,unidade)").order("nome");
  _fabModelos = data || _fabModelos; fabPreencherModelosSelect();
  $("fab-md-sel").innerHTML = `<option value="">— escolha a lista —</option>` + _fabModelos.map(m => `<option value="${esc(m.id)}">${esc(m.nome)}${m.produto ? " · " + esc(m.produto.codigo) : ""}${m.ativo === false ? " (inativa)" : ""}</option>`).join("");
  $("btn-fab-md-nova").style.display = fabPodeEditar() ? "" : "none";
  if(_fabMd?.id && _fabModelos.some(m => m.id === _fabMd.id)){ $("fab-md-sel").value = _fabMd.id; await fabMdAbrir(_fabMd.id); }
  else { _fabMd = null; $("fab-md-form").style.display = "none"; }
  $("fab-md-modal").style.display = "flex";
}
async function fabMdAbrir(id){
  const m = id ? _fabModelos.find(x => x.id === id) : { id: null, nome: "", produto_id: null, quantidade_base: 1, ativo: true };
  _fabMd = m; _fabMdProd = m.produto_id ? { id: m.produto_id, codigo: m.produto?.codigo || "", nome: m.produto?.nome || "" } : null;
  $("fab-md-form").style.display = "";
  $("fab-md-nome").value = m.nome || ""; $("fab-md-base").value = m.quantidade_base || 1; $("fab-md-ativo").checked = m.ativo !== false;
  $("fab-md-prod-busca").value = _fabMdProd ? `${_fabMdProd.codigo} — ${_fabMdProd.nome}` : ""; $("fab-md-prod-info").textContent = m.codigo_externo ? `Lista do Odoo (mrp.bom ${m.codigo_externo})` : "";
  const pode = fabPodeEditar();
  ["fab-md-nome", "fab-md-base", "fab-md-ativo", "fab-md-prod-busca"].forEach(i => $(i).disabled = !pode);
  $("btn-fab-md-salvar").style.display = pode ? "" : "none";
  $("fab-md-add").style.display = pode && m.id ? "" : "none";
  if(m.id){
    const { data } = await sb.from("fabricacao_modelo_itens").select("*").eq("modelo_id", m.id).order("ordem").order("created_at");
    _fabMdItens = data || [];
  } else _fabMdItens = [];
  fabMdRenderItens();
}
function fabMdRenderItens(){
  const tb = $("fab-md-itens"), pode = fabPodeEditar();
  if(!_fabMd?.id){ tb.innerHTML = `<tr><td colspan="4" class="vazio">Salve a lista para acrescentar componentes.</td></tr>`; return; }
  tb.innerHTML = _fabMdItens.map(i => `<tr><td>${i.produto_id ? linkProduto(i.produto_id, i.descricao || "produto") : esc(i.descricao || "")}</td><td>${esc(i.unidade || "un")}</td><td class="num">${num(i.quantidade_por_unidade)}</td>
      <td>${pode ? `<button type="button" class="btn-sec btn-sm fab-md-rem" data-id="${esc(i.id)}" title="remover">×</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="vazio">Nenhum componente na lista.</td></tr>`;
  tb.querySelectorAll(".fab-md-rem").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("fabricacao_modelo_itens").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
    await fabMdAbrir(_fabMd.id);
  }));
}
async function fabMdSalvar(){
  if(!fabPodeEditar() || !_fabMd) return;
  const reg = { nome: $("fab-md-nome").value.trim(), produto_id: _fabMdProd ? _fabMdProd.id : null, quantidade_base: Number($("fab-md-base").value || 1), ativo: $("fab-md-ativo").checked };
  if(!reg.nome){ aviso("app-aviso", "Informe o nome da lista.", "erro"); return; }
  if(!(reg.quantidade_base > 0)){ aviso("app-aviso", "A quantidade base precisa ser maior que zero.", "erro"); return; }
  const r = _fabMd.id ? await sb.from("fabricacao_modelos").update(reg).eq("id", _fabMd.id).select("id").single() : await sb.from("fabricacao_modelos").insert(reg).select("id").single();
  if(r.error){ aviso("app-aviso", "Não foi possível salvar a lista: " + r.error.message, "erro"); return; }
  aviso("app-aviso", "Lista de materiais salva.", "ok");
  _fabMd = { id: r.data.id }; await fabAbrirModelos();
}
async function fabMdAddItem(p){
  if(!_fabMd?.id || !p) return;
  const qtd = Number($("fab-md-comp-qtd").value || 1);
  if(!(qtd > 0)){ aviso("app-aviso", "Informe a quantidade.", "erro"); return; }
  const { error } = await sb.from("fabricacao_modelo_itens").insert({ modelo_id: _fabMd.id, produto_id: p.id, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || "un", quantidade_por_unidade: qtd, ordem: _fabMdItens.length + 1 });
  if(error){ aviso("app-aviso", "Não foi possível acrescentar: " + error.message, "erro"); return; }
  $("fab-md-comp-qtd").value = 1;
  await fabMdAbrir(_fabMd.id);
}

/* ---------- busca de produto (produzido, componente, lista) ---------- */
function fabLigarBuscaProduto(inpId, listaId, aoEscolher, limparAoEscolher){
  const inp = $(inpId), lista = $(listaId); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(async () => {
    const t = inp.value.trim().replace(/[%,()]/g, " ");
    if(t.length < 2){ lista.style.display = "none"; return; }
    const { data } = await sb.from("produtos").select("id,codigo,nome,unidade,estoque_atual,custo_ultimo").eq("ativo", true).or(`nome.ilike.%${t}%,codigo.ilike.%${t}%,codigo_barras.eq.${t}`).order("nome").limit(25);
    const res = data || [];
    lista.innerHTML = res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")} · ${brl(p.custo_ultimo || 0)}</span></div>`).join("")
      || `<div class="resultado-item vazio">Nenhum produto.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("mousedown", ev => {
      ev.preventDefault(); const p = res.find(x => x.id === d.dataset.id); lista.style.display = "none";
      inp.value = limparAoEscolher ? "" : `${p.codigo} — ${p.nome}`; aoEscolher(p);
    }));
  }, 250));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 150));
}

/* ---------- ligação ---------- */
function ligarFabricacao(){
  if(!$("sec-fabricacao")) return;
  document.querySelector('nav button[data-secao="fabricacao"]')?.addEventListener("click", () => carregarFabricacao(false));
  document.querySelectorAll("#fab-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _fabView = b.dataset.view; renderFabricacao(); }));
  $("fab-busca")?.addEventListener("input", debounce(renderFabricacao));
  ["fab-f-status", "fab-f-resp", "fab-f-destino"].forEach(id => $(id)?.addEventListener("change", renderFabricacao));
  $("fab-f-centro")?.addEventListener("change", fabFiltrarCentro);
  $("fab-f-periodo")?.addEventListener("change", async () => { await fabFetch(); renderFabricacao(); });
  $("btn-fab-atualizar")?.addEventListener("click", () => carregarFabricacao(true));
  $("btn-fab-novo")?.addEventListener("click", () => novaOrdemFabricacao());
  $("btn-fab-centros")?.addEventListener("click", fabAbrirCentros);
  $("btn-fab-modelos")?.addEventListener("click", fabAbrirModelos);
  $("fab-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a")) return;
    const el = e.target.closest("[data-id]"); if(el) abrirOrdemFabricacao(el.dataset.id);
  });
  $("btn-fab-voltar")?.addEventListener("click", mostrarPainelFabricacao);
  $("btn-fab-salvar")?.addEventListener("click", () => comBotaoTravado("btn-fab-salvar", salvarOrdemFabricacao));
  document.querySelectorAll("#fab-ficha .fab-acao").forEach(b => b.addEventListener("click", () => comBotaoTravado(b.id, () => fabAcao(b.dataset.acao))));
  document.querySelectorAll("#fab-notebook button").forEach(b => b.addEventListener("click", () => fabAtivarTab(b.dataset.tab)));
  document.querySelectorAll("#fab-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => fabAtivarTab(b.dataset.gotoTab)));
  $("fab-destino")?.addEventListener("change", fabDestinoCampos);
  $("btn-fab-h-add")?.addEventListener("click", () => comBotaoTravado("btn-fab-h-add", fabAddHoras));
  fabLigarBuscaProduto("fab-prod-busca", "fab-prod-res", p => { _fabProd = p; $("fab-prod-info").textContent = `Unidade do catálogo: ${p.unidade || "un"} · em estoque: ${num(p.estoque_atual || 0)}`; if(!$("fab-desc").value.trim()) $("fab-desc").value = p.nome; if($("fab-unidade").querySelector(`option[value="${p.unidade}"]`)) $("fab-unidade").value = p.unidade; }, false);
  $("fab-prod-busca")?.addEventListener("input", () => { if(!$("fab-prod-busca").value.trim()){ _fabProd = null; $("fab-prod-info").textContent = "Sem produto do catálogo, descreva o que vai ser feito."; } });
  fabLigarBuscaProduto("fab-comp-busca", "fab-comp-res", p => fabAddItem(p), true);
  fabLigarBuscaProduto("fab-md-prod-busca", "fab-md-prod-res", p => { _fabMdProd = p; if(!$("fab-md-nome").value.trim()) $("fab-md-nome").value = p.nome; }, false);
  $("fab-md-prod-busca")?.addEventListener("input", () => { if(!$("fab-md-prod-busca").value.trim()) _fabMdProd = null; });
  fabLigarBuscaProduto("fab-md-comp-busca", "fab-md-comp-res", p => fabMdAddItem(p), true);
  // modais
  $("btn-fab-cc-fechar")?.addEventListener("click", () => { $("fab-cc-modal").style.display = "none"; });
  $("fab-cc-modelo")?.addEventListener("change", () => { document.querySelectorAll("#fab-cc-marcacoes .fab-cc-marc").forEach(i => i.value = ""); fabRenderMarcacoes(Math.round(fabQtd(_fabAtual || {}))); });
  $("btn-fab-cc-ok")?.addEventListener("click", () => comBotaoTravado("btn-fab-cc-ok", fabConcluirComMarcacoes));
  $("btn-fab-ct-fechar")?.addEventListener("click", () => { $("fab-ct-modal").style.display = "none"; });
  $("btn-fab-ct-add")?.addEventListener("click", () => comBotaoTravado("btn-fab-ct-add", fabAddCentro));
  $("btn-fab-md-fechar")?.addEventListener("click", () => { $("fab-md-modal").style.display = "none"; });
  $("fab-md-sel")?.addEventListener("change", () => { if($("fab-md-sel").value) fabMdAbrir($("fab-md-sel").value); else { _fabMd = null; $("fab-md-form").style.display = "none"; } });
  $("btn-fab-md-nova")?.addEventListener("click", () => { $("fab-md-sel").value = ""; fabMdAbrir(null); });
  $("btn-fab-md-salvar")?.addEventListener("click", () => comBotaoTravado("btn-fab-md-salvar", fabMdSalvar));
  ["fab-cc-modal", "fab-ct-modal", "fab-md-modal"].forEach(id => $(id)?.addEventListener("click", e => { if(e.target.id === id) $(id).style.display = "none"; }));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarFabricacao);
else ligarFabricacao();

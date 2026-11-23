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
   Fase 130 (27/10/2026, #186): finalidade "Frete terceirizado" = viagem feita por transportador de fora
   (viagens.transportador_id/placa/motorista, sem caminhão nem km). Valor, vencimento e documento ficam
   em viagem_fretes (1:1), que só pode_ler_contas_pagar() lê: o embed frete:viagem_fretes(...) vem nulo
   para os demais e a tela mostra só o frete_status (texto). O custo é direto e gera o título a pagar.
   Fase 118a (04/11/2026): visão Abastecimentos, só leitura, do cartão da PlusFrota (frota_abastecimentos, gravada só pela
   function plusfrota-sync). Não entra em custo nem em km da máquina: isso é a 118b.
   Fase 186c (16/11/2026, #281): notinha dos postos (frota_abastecimentos_posto) na mesma visão, com filtro de origem e
   fechamento do mês por posto (frota_posto_fechamento_salvar). Fora da vw_custos: o custo vem do pedido ao posto com a NF.
   ==================================================================== */
let _frotaView = "viagens";          // viagens | veiculos | documentos | abastecimentos
let _frotaModo = "lista";            // lista | kanban (visão Viagens)
let _frotaVeic = [];                 // equipamentos tipo caminhao/veiculo
let _frotaEquipOutros = [];          // demais equipamentos (atendidos, itens)
let _frotaFuncs = [];                // funcionários ativos (motoristas)
let _frotaObras = [];                // obras não canceladas (origem/destino, filtro)
let _frotaViagens = { chave: null, dados: [] };
let _frotaDocs = null;               // visão Documentos: { notas, mdfes, abertas }
let _frotaNotasSemViagem = null;     // indicador "notas sem viagem"
let _frotaTipoFiltro = "";           // lote S46 (#95): cartão Caminhões ativos / Veículos leves filtra a lista (caminhao | veiculo)
let _frotaVeicEditId = null;
let _frotaUltimaData;                // undefined = ainda não consultado; null = nenhuma viagem

const FROTA_TIPO_LBL = { caminhao: "Caminhão", veiculo: "Veículo" };
const FROTA_STATUS_LBL = { disponivel: "Disponível", em_uso: "Em uso", manutencao: "Manutenção", em_manutencao: "Manutenção", inativo: "Inativo", vendido: "Vendido" };
const VG_STAGES = ["planejada", "em_transito", "concluida"];
const VG_FINALIDADES = { mobilizacao: "Mobilização", desmobilizacao: "Desmobilização", apoio: "Apoio à obra", entrega_material: "Entrega de material", manutencao: "Manutenção", outro: "Outro", frete_terceirizado: "Frete terceirizado" };
/* fase 130: viagens.frete_status (mantido pelo banco; texto sem valor, a logística lê) */
const VG_FRETE_STATUS = { a_informar: ["Frete a informar", "ambar"], a_gerar: ["Pedido na conclusão", "ambar"], pedido: ["Pedido de compra", "azul"], aguardando_aprovacao: ["Aguardando aprovação", "ambar"], reprovado: ["Reprovado", "vermelho"], gerado: ["Título gerado", "azul"], exportado: ["Título exportado", "verde"], cancelado: ["Cancelado", "cinza"] };
function vgEhFrete(v){ return !!v && v.finalidade === "frete_terceirizado"; }
/* viagem_fretes vem como objeto (1:1) ou nulo para quem não lê contas a pagar */
function vgFrete(v){ if(!v || !v.frete) return null; return Array.isArray(v.frete) ? (v.frete[0] || null) : v.frete; }
function vgPodeVerFrete(){ return typeof podeVerContasPagar === "function" && podeVerContasPagar(); }
/* lote travas 09/11/2026 (BAN-05): quem informa o frete. Mesma lista da RPC viagem_frete_gravar (admin, logistica, gestor_frota,
   financeiro, comprador); diretor entra por has_role() lá e aqui na lista. Os demais registram a viagem e deixam o frete para eles. */
function vgPodeInformarFrete(){ return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "admin", "logistica", "gestor_frota", "financeiro", "comprador"].includes(usuarioAtual.cargo); }
/* valor da viagem: frota própria = km × R$/km (valor_total); frete = valor combinado (nulo quando o usuário não lê) */
function vgValorViagem(v){
  if(vgEhFrete(v)){ const f = vgFrete(v); return f && f.valor_frete != null ? Number(f.valor_frete) : null; }
  return v && v.valor_total != null ? Number(v.valor_total) : null;
}
function vgTransportadorTxt(v){
  if(!v) return "—";
  const t = v.transportador;
  const nome = t ? (t.razao_social || t.nome_fantasia || "transportador") : "transportador";
  return nome + (v.transportador_placa ? " · " + v.transportador_placa : "");
}
function vgTagFreteStatus(st){ const m = VG_FRETE_STATUS[st]; return m ? `<span class="tag ${esc(m[1])}">${esc(m[0])}</span>` : ""; }
const VG_LOC = { base: "Base CGL", obra: "Obra", cliente: "Cliente", fornecedor_manutencao: "Fornecedor / manutenção" };
/* Mesma lista de logistica_pode_operar() (migration da fase 89); diretor entra por has_role() lá e aqui na lista. */
const VG_LOGISTICA_CARGOS = ["diretor", "admin", "logistica", "gestor_frota", "encarregado", "almoxarife", "engenheiro", "assistente_engenharia", "mecanico", "rh", "gestor_acessorios", "gestor_manutencao", "comercial"];

function logPodeOperar(){ return !!usuarioAtual && !ehSomenteLeitura() && VG_LOGISTICA_CARGOS.includes(usuarioAtual.cargo); }
function frotaPodeEditar(){
  return !!usuarioAtual && !ehSomenteLeitura() && ["admin", "diretor", "rh", "logistica", "encarregado", "engenheiro", "mecanico", "gestor_frota"].includes(usuarioAtual.cargo);
}
/* fase 118a: mesmas listas de frota_abast_pode_ler() e frota_abast_pode_sync(); diretor entra por has_role() lá e aqui na lista */
function frotaPodeVerAbast(){ return !!usuarioAtual && ["diretor", "admin", "logistica", "gestor_frota", "financeiro", "auditor"].includes(usuarioAtual.cargo); }
function frotaPodeSyncAbast(){ return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "admin", "logistica", "gestor_frota"].includes(usuarioAtual.cargo); }
/* fase 186c: mesma lista de frota_posto_pode_operar() (notinha e fechamento do posto); auditor fica fora pelo ehSomenteLeitura e no banco */
function frotaPodeOperarPosto(){ return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "admin", "logistica", "gestor_frota"].includes(usuarioAtual.cargo); }
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
      sb.from("equipamentos").select("id,codigo,nome,tipo,placa,km,valor_km,valor_fipe,fipe_referencia,fipe_codigo,status,ativo,localizacao_tipo,localizacao_descricao,localizacao_obra_id,observacoes,venda_id,baixa_em").order("codigo"),
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
    _frotaAbast = { chave: null, dados: [], rodadas: [] };
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
  const manter = (sel, html, vazio) => { if(!sel) return; const v = sel.value; sel.innerHTML = `<option value="">${esc(vazio)}</option>` + html; sel.value = v; };
  manter($("frota-f-caminhao"), opt(_frotaVeic, v => `${v.codigo} · ${v.nome || ""}`), "Todos os caminhões");
  manter($("frota-f-obra"), opt(_frotaObras, o => obraRotulo(o)), "Todas as obras");
  manter($("frota-f-finalidade"), Object.entries(VG_FINALIDADES).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join(""), "Toda finalidade");
  manter($("frota-f-status"), Object.entries(STATUS.viagem).map(([k, o]) => `<option value="${esc(k)}">${esc(o.label)}</option>`).join(""), "Todo status");
}

/* ---------- render ---------- */
function renderFrota(){
  document.querySelectorAll("#sec-frota .serv-view-btn[data-view]").forEach(b => b.classList.toggle("ativo", b.dataset.view === _frotaView));
  document.querySelectorAll("#frota-modos .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.modo === _frotaModo));
  const podeAbast = frotaPodeVerAbast();
  if(_frotaView === "abastecimentos" && !podeAbast) _frotaView = "viagens";
  const ehViagens = _frotaView === "viagens", ehAbast = _frotaView === "abastecimentos";
  const btnAbast = $("frota-view-abast"); if(btnAbast) btnAbast.style.display = podeAbast ? "" : "none";
  const filtrosAb = $("frota-filtros-abast"); if(filtrosAb) filtrosAb.style.display = ehAbast ? "contents" : "none";
  const modosAb = $("frota-abast-modos"); if(modosAb) modosAb.style.display = ehAbast ? "" : "none";
  document.querySelectorAll("#frota-abast-modos .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.abmodo === _frotaAbastModo));
  const filtros = $("frota-filtros-viagens"); if(filtros) filtros.style.display = ehViagens ? "contents" : "none";
  const modos = $("frota-modos"); if(modos) modos.style.display = ehViagens ? "" : "none";
  const btnNova = $("btn-frota-nova-viagem"); if(btnNova) btnNova.style.display = (ehViagens && logPodeOperar()) ? "" : "none";
  const btnVeic = $("btn-frota-novo-veic"); if(btnVeic) btnVeic.style.display = (_frotaView === "veiculos" && frotaPodeEditar()) ? "" : "none";
  const btnNot = $("btn-frota-posto-nova"); if(btnNot) btnNot.style.display = (ehAbast && frotaPodeOperarPosto()) ? "" : "none";
  const btnFech = $("btn-frota-posto-fech"); if(btnFech) btnFech.style.display = ehAbast ? "" : "none";
  frotaKpisFixos();
  if(_frotaView === "veiculos") renderFrotaVeiculos();
  else if(_frotaView === "documentos") renderFrotaDocumentos();
  else if(ehAbast) renderFrotaAbast();
  else renderFrotaViagens();
}
function frotaKpi(id, v){ const el = $(id); if(el) el.textContent = v; }
function frotaKpisFixos(){
  frotaKpi("frota-kpi-caminhoes", _frotaVeic.filter(v => v.tipo === "caminhao" && v.ativo !== false).length);
  frotaKpi("frota-kpi-veiculos", _frotaVeic.filter(v => v.tipo === "veiculo" && v.ativo !== false).length);
  frotaKpi("frota-kpi-notas", _frotaNotasSemViagem == null ? "—" : _frotaNotasSemViagem);
  // lote S46 (#95): cartão do filtro em uso fica marcado (como os de Compras)
  $("frota-kpi-card-caminhoes")?.classList.toggle("ativo", _frotaView === "veiculos" && _frotaTipoFiltro === "caminhao");
  $("frota-kpi-card-veiculos")?.classList.toggle("ativo", _frotaView === "veiculos" && _frotaTipoFiltro === "veiculo");
  $("frota-kpi-card-notas")?.classList.toggle("ativo", _frotaView === "documentos");
}
/* lote S46 (#95): clicar no cartão filtra a lista de veículos pelo tipo (ativos); clicar de novo limpa */
function frotaFiltrarTipo(tipo){
  const limpar = _frotaView === "veiculos" && _frotaTipoFiltro === tipo;
  _frotaTipoFiltro = limpar ? "" : tipo;
  _frotaView = "veiculos";
  renderFrota();
}

function frotaOndeEsta(v){
  if(v.localizacao_tipo === "obra" && v.localizacao_obra_id) return mapaObras?.[v.localizacao_obra_id] || "Em obra";
  if(v.localizacao_descricao) return v.localizacao_descricao;
  return v.localizacao_tipo === "base" ? "Pátio" : (v.localizacao_tipo || "—");
}

function renderFrotaVeiculos(){
  const cont = $("frota-conteudo");
  const termo = ($("frota-busca")?.value || "").trim().toLowerCase();
  // fase 96: veículo vendido sai da lista operacional (continua em _frotaVeic para as viagens antigas acharem o caminhão)
  const vendidos = _frotaVeic.filter(v => bemVendido(v));   // fase 180c: inclui reserva de domínio e liberado para retirada
  const lista = _frotaVeic.filter(v => !bemVendido(v) && (!termo || `${v.codigo} ${v.nome || ""} ${v.placa || ""}`.toLowerCase().includes(termo))
    && (!_frotaTipoFiltro || (v.tipo === _frotaTipoFiltro && v.ativo !== false)));   // lote S46 (#95): cartão clicado
  const c = $("frota-contador"); if(c) c.textContent = `${lista.length} de ${_frotaVeic.length - vendidos.length}`;
  const ativos = _frotaVeic.filter(v => v.ativo !== false);
  const comFipe = ativos.filter(v => v.valor_fipe != null);
  const totalFipe = comFipe.reduce((s, v) => s + Number(v.valor_fipe || 0), 0);
  const fipeRef = v => v.fipe_referencia ? ` <span class="meta" title="referência FIPE">${esc(String(v.fipe_referencia).slice(5, 7))}/${esc(String(v.fipe_referencia).slice(0, 4))}</span>` : "";
  cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">${(typeof ehDiretoria === "function" && ehDiretoria()) ? `Valor FIPE da frota ativa: <strong data-val-sens>${frotaMoeda(totalFipe)}</strong> ` : "FIPE "}(${comFipe.length} de ${ativos.length} com FIPE informada${ativos.length - comFipe.length ? ` · ${ativos.length - comFipe.length} sem valor` : ""})</p>
  <div class="tabela-rola"><table>
    <thead><tr><th>TAG</th><th>Tipo</th><th>Descrição</th><th>Placa</th><th class="num">km atual</th><th class="num">R$/km</th><th class="num">FIPE</th><th>Onde está</th><th>Status</th></tr></thead>
    <tbody>${lista.map(v => `<tr class="linha-clicavel" data-veic="${esc(v.id)}" ${v.ativo === false ? 'style="opacity:.55"' : ""}>
        <td><strong>${esc(v.codigo)}</strong></td><td>${esc(FROTA_TIPO_LBL[v.tipo]) || esc(v.tipo)}</td><td>${esc(v.nome || "")}</td><td>${esc(v.placa || "—")}</td>
        <td class="num">${v.km != null ? frotaNum(v.km) : "—"}</td><td class="num">${v.valor_km != null ? frotaNum(v.valor_km, 2) : "—"}</td>
        <td class="num">${v.valor_fipe != null ? frotaMoeda(v.valor_fipe) + fipeRef(v) : '<span class="tag ambar" title="sem valor FIPE">—</span>'}</td>
        <td>${esc(frotaOndeEsta(v))}</td><td>${esc(FROTA_STATUS_LBL[v.status]) || esc(v.status || "")}</td></tr>`).join("") || `<tr><td colspan="9" class="vazio">Nenhum veículo cadastrado.</td></tr>`}</tbody>
  </table></div>
  ${vendidos.length ? `<p class="meta" style="margin:8px 0 0;">${vendidos.length} veículo(s) vendido(s) fora da lista: ${vendidos.map(v => esc(v.codigo)).join(", ")}. ${typeof vbAbrirPainel === "function" ? `<a href="#" id="frota-vendidos-ver">Ver em Equipamentos › Vendas</a>` : ""}</p>` : ""}`;
  $("frota-vendidos-ver")?.addEventListener("click", (e) => { e.preventDefault(); vbAbrirPainel({ busca: "" }); });
}

/* ---------- visão Viagens ---------- */
const VG_SELECT_LISTA = "id,numero,data,status,finalidade,km_saida,km_chegada,km_total,valor_km,valor_total,observacoes,funcionario_id,obra_id,origem_tipo,origem_obra_id,origem_descricao,destino_tipo,destino_obra_id,destino_descricao,equipamento_atendido_id,caminhao_id,mobilizacao_id,data_saida,data_chegada,"
  + "transportador_id,transportador_placa,transportador_motorista,frete_status,frete_reprovado_motivo,frete_sem_cte,"   // fase 130
  + "funcionario:funcionarios(nome),caminhao:equipamentos!caminhao_id(codigo,nome,placa),equip:equipamentos!equipamento_atendido_id(codigo,nome),notas:movimentacoes_ativos(id,numero,tipo,status,nf_numero,interna),"
  + "transportador:fornecedores!transportador_id(razao_social,nome_fantasia),frete:viagem_fretes(valor_frete,frete_vencimento,frete_documento)";   // fase 130: frete vem nulo para quem não lê contas a pagar

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
      const alvo = `${v.numero} ${v.funcionario?.nome || ""} ${vgLado(v, "origem")} ${vgLado(v, "destino")} ${v.caminhao?.codigo || ""} ${v.caminhao?.placa || ""} ${v.equip?.codigo || ""} ${(v.notas || []).map(n => `${n.numero} ${n.nf_numero || ""}`).join(" ")} ${v.observacoes || ""} ${vgEhFrete(v) ? vgTransportadorTxt(v) + " " + (v.transportador_motorista || "") + " frete terceirizado" : ""}`.toLowerCase();
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
  // fase 130: frota própria (km × R$/km) e frete terceirizado (R$ pagos a transportadores) somam separados
  const tot = fechadas.filter(v => !vgEhFrete(v)).reduce((s, d) => ({ km: s.km + (Number(d.km_total) || 0), val: s.val + (Number(d.valor_total) || 0), n: s.n + 1 }), { km: 0, val: 0, n: 0 });
  const fretes = fechadas.filter(vgEhFrete);
  tot.frete = fretes.reduce((s, d) => s + (vgValorViagem(d) || 0), 0);
  tot.nFrete = fretes.length;
  tot.freteSemValor = fretes.filter(d => vgValorViagem(d) == null).length;
  frotaKpi("frota-kpi-viagens", linhas.length);
  frotaKpi("frota-kpi-km", frotaNum(tot.km));
  frotaKpi("frota-kpi-valor", frotaMoeda(tot.val));
  frotaKpi("frota-kpi-frete", tot.nFrete && vgPodeVerFrete() ? `${tot.nFrete} · ${frotaMoeda(tot.frete)}` : String(tot.nFrete));
  frotaKpi("frota-kpi-transito", _frotaViagens.dados.filter(v => v.status === "em_transito").length);
  if(_frotaModo === "kanban") renderFrotaKanban(linhas);
  else renderFrotaLista(linhas, mes, tot);
}

function renderFrotaLista(linhas, mes, tot){
  const cont = $("frota-conteudo");
  const obraTxt = v => vgLado(v, v.destino_tipo === "base" && v.origem_tipo !== "base" ? "origem" : "destino");
  const agrupar = (rot) => { const g = new Map(); linhas.filter(v => v.status !== "cancelada").forEach(d => { const k = rot(d); const a = g.get(k) || { k, n: 0, km: 0, val: 0 }; a.n++; a.km += Number(d.km_total) || 0; a.val += vgValorViagem(d) || 0; g.set(k, a); }); return [...g.values()].sort((a, b) => b.val - a.val); };
  // fase 130: o frete terceirizado agrupa pelo transportador (sem km); o valor só soma para quem lê contas a pagar
  const porCam = agrupar(d => vgEhFrete(d) ? `🚚 ${d.transportador?.razao_social || d.transportador?.nome_fantasia || "Transportador"}` : d.caminhao ? `${d.caminhao.codigo} · ${d.caminhao.nome || ""}` : "Sem caminhão");
  const porObra = agrupar(obraTxt);
  const resumo = (titulo, lista) => `<div class="card" style="flex:1 1 320px;min-width:280px;"><h4 style="margin:0 0 8px;">${esc(titulo)}</h4><div class="tabela-rola"><table>
      <thead><tr><th>${titulo.includes("obra") ? "Obra / destino" : "Caminhão / transportador"}</th><th class="num">Viagens</th><th class="num">km</th><th class="num">R$</th></tr></thead>
      <tbody>${lista.slice(0, 12).map(a => `<tr><td>${esc(a.k)}</td><td class="num">${esc(a.n)}</td><td class="num">${frotaNum(a.km)}</td><td class="num">${frotaMoeda(a.val)}</td></tr>`).join("") || `<tr><td colspan="4" class="vazio">—</td></tr>`}</tbody></table></div></div>`;

  cont.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">${resumo("Por caminhão", porCam)}${resumo("Por obra atendida", porObra)}</div>
    <div class="meta" style="margin:0 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">${linhas.length} viagem(ns)${mes ? " em " + esc(mes.slice(5, 7) + "/" + mes.slice(0, 4)) : " nos últimos 12 meses"} (planejadas e em trânsito aparecem sempre)
      ${tot.nFrete ? `· <strong>${esc(tot.n)}</strong> da frota própria (${frotaNum(tot.km)} km · ${frotaMoeda(tot.val)}) · <strong>${esc(tot.nFrete)}</strong> frete(s) terceirizado(s)${vgPodeVerFrete() ? ` (${frotaMoeda(tot.frete)}${tot.freteSemValor ? `, ${esc(tot.freteSemValor)} sem valor` : ""})` : ""}` : ""}
      ${_frotaUltimaData ? `· última concluída em <strong>${dataBR(_frotaUltimaData)}</strong>` : ""}${_frotaUltimaData && String(_frotaUltimaData).slice(0, 7) < frotaMesAtual() ? ` <span class="tag ambar" title="as viagens depois dessa data ainda não foram lançadas no sistema">sem lançamentos depois disso</span>` : ""}
      ${mes && mes !== frotaMesAtual() ? `<button type="button" class="btn-sec btn-sm" id="btn-frota-mes-atual">Mês atual</button>` : ""}
      <button type="button" class="btn-sec btn-sm" id="btn-frota-12m">Últimos 12 meses</button>
      <button type="button" class="btn-sec btn-sm" id="btn-frota-csv" style="margin-left:auto;">CSV</button></div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Viagem</th><th>Data</th><th>Status</th><th>Finalidade</th><th>Caminhão / transportador</th><th>Motorista</th><th>Origem → destino</th><th>Notas</th><th class="num">km</th><th class="num">R$/km</th><th class="num">Valor</th></tr></thead>
      <tbody>${linhas.map(d => { const frete = vgEhFrete(d), val = vgValorViagem(d); return `<tr class="linha-clicavel" data-vg="${esc(d.id)}">
          <td><strong>${esc(d.numero)}</strong>${d.mobilizacao_id ? ' <span class="meta" title="gerada pela mobilização">mob.</span>' : ""}</td>
          <td>${dataBR(d.data)}</td><td>${tagStatus("viagem", d.status)}</td><td>${frete ? `<span class="tag azul">Frete terceirizado</span>${d.frete_status && d.frete_status !== "gerado" ? " " + vgTagFreteStatus(d.frete_status) : ""}` : esc(VG_FINALIDADES[d.finalidade] || d.finalidade || "")}</td>
          <td>${frete ? `🚚 ${esc(vgTransportadorTxt(d))}` : esc(d.caminhao ? d.caminhao.codigo : "—")}</td><td>${esc(frete ? (d.transportador_motorista || "—") : (d.funcionario?.nome || "—"))}</td>
          <td title="${esc(d.observacoes || "")}">${esc(vgLado(d, "origem"))} → ${esc(vgLado(d, "destino"))}${d.equip ? ` <span class="meta">· atende ${esc(d.equip.codigo)}</span>` : ""}</td>
          <td>${vgNotasTxt(d)}</td>
          <td class="num">${d.km_total != null ? frotaNum(d.km_total) : "—"}</td><td class="num">${d.valor_km != null ? frotaNum(d.valor_km, 2) : "—"}</td><td class="num">${val != null ? frotaMoeda(val) : (frete && !vgPodeVerFrete() ? '<span class="meta" title="valor do frete visível só para quem lê Contas a pagar">restrito</span>' : "—")}</td></tr>`; }).join("") || `<tr><td colspan="11" class="vazio">Nenhuma viagem no período.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="8"><strong>Total</strong>${tot.nFrete ? ` <span class="meta">frota própria${vgPodeVerFrete() ? ` + frete terceirizado ${frotaMoeda(tot.frete)}` : ""}</span>` : ""}</td><td class="num"><strong>${frotaNum(tot.km)}</strong></td><td></td><td class="num"><strong>${frotaMoeda(tot.val + (vgPodeVerFrete() ? tot.frete : 0))}</strong></td></tr></tfoot>
    </table></div>`;
  $("btn-frota-mes-atual")?.addEventListener("click", () => { $("frota-f-mes").value = frotaMesAtual(); renderFrota(); });
  $("btn-frota-12m")?.addEventListener("click", () => { $("frota-f-mes").value = ""; renderFrota(); });
  $("btn-frota-csv")?.addEventListener("click", () => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Viagem;Data;Status;Finalidade;Tipo;Transportador;Placa_transportador;Motorista;Caminhao;Equipamento;Origem;Destino;Notas;Km_saida;Km_chegada;Km;Valor_km;Valor;Status_frete"]
      .concat(linhas.map(d => [d.numero, dataBR(d.data), STATUS.viagem[d.status]?.label || d.status, VG_FINALIDADES[d.finalidade] || d.finalidade, vgEhFrete(d) ? "Frete terceirizado" : "Frota própria",
        vgEhFrete(d) ? (d.transportador?.razao_social || "") : "", d.transportador_placa || "", vgEhFrete(d) ? (d.transportador_motorista || "") : (d.funcionario?.nome || ""), d.caminhao?.codigo || "", d.equip?.codigo || "", vgLado(d, "origem"), vgLado(d, "destino"),
        (d.notas || []).filter(n => !n.interna).map(n => n.nf_numero ? "NF " + n.nf_numero : n.numero).join(" "), d.km_saida, d.km_chegada, d.km_total, d.valor_km, vgValorViagem(d), vgEhFrete(d) ? ((VG_FRETE_STATUS[d.frete_status] || [d.frete_status || ""])[0]) : ""].map(cel).join(";"))).join("\n");   // fase 130: tipo, transportador e valor do frete (vazio para quem não lê)
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
        <div class="serv-kan-card-nome">${esc(v.numero)} · ${esc(vgEhFrete(v) ? "🚚 " + vgTransportadorTxt(v) : v.caminhao ? v.caminhao.codigo : "sem caminhão")}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${esc(VG_FINALIDADES[v.finalidade] || v.finalidade || "")} · → ${esc(vgLado(v, "destino"))}</span><br>
          <span class="meta">${esc(vgEhFrete(v) ? (v.transportador_motorista || "motorista do transportador") : (v.funcionario?.nome || "sem motorista"))}${(v.notas || []).some(n => !n.interna) ? " · 🧾 " + (v.notas || []).filter(n => !n.interna).length : ""}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${dataBR(v.data)}</span>
          <strong>${vgValorViagem(v) != null ? frotaMoeda(vgValorViagem(v)) : (v.km_total != null ? frotaNum(v.km_total) + " km" : vgEhFrete(v) ? vgTagFreteStatus(v.frete_status) || "frete" : "—")}</strong>
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
      sb.from("viagens").select("id,numero,data,status,finalidade,caminhao:equipamentos!caminhao_id(codigo),transportador:fornecedores!transportador_id(razao_social)").in("status", ["planejada", "em_transito"]).order("data", { ascending: false }).limit(200)
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
  const optViagens = `<option value="">— vincular a uma viagem aberta —</option>` + _frotaDocs.abertas.map(v => `<option value="${esc(v.id)}">${esc(v.numero)} · ${dataBR(v.data)} · ${esc(v.caminhao?.codigo || (vgEhFrete(v) ? "frete · " + (v.transportador?.razao_social || "transportador") : "sem caminhão"))} · ${esc(STATUS.viagem[v.status]?.label || v.status)}</option>`).join("");
  cont.innerHTML = `
    <div class="lista-topo compacta" style="border:none;padding:0;"><h4 style="margin:0;font-size:var(--txt-md);">🧾 Notas sem viagem <span class="contador">${notas.length}</span></h4>
      <span class="meta">Nota de remessa ou retorno em rascunho, emitida ou em trânsito que ainda não pertence a nenhuma viagem. O lugar certo de criar a nota é a aba Documentos da viagem.</span>
      ${typeof podeVerMovimentacoes === "function" && podeVerMovimentacoes() && pode ? `<button type="button" class="btn-sec btn-sm" id="btn-frota-nota-avulsa" style="margin-left:auto;">Nota sem viagem</button>` : ""}
    </div>
    ${notas.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Nota</th><th>Tipo</th><th>Status</th><th>NF</th><th>Emissão</th><th>Origem → destino</th><th>Placa · motorista</th><th class="num">Valor</th>${pode ? '<th style="min-width:260px;">Viagem</th>' : ""}</tr></thead>
      <tbody>${notas.map(x => `<tr>
        <td><strong>${linkMovimentacao(x.id, x.numero)}</strong></td><td>${esc(movLbl[x.tipo] || x.tipo)}</td>
        <td>${movSt[x.status] ? `<span class="tag ${esc(movSt[x.status].cor)}">${esc(movSt[x.status].label)}</span>` : esc(x.status)}</td>
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
  // fase 96: venda do veículo (js/vendas_bens.js); vendido não chega aqui (sai da lista)
  const bVend = $("btn-fveic-vender");
  if(bVend) bVend.style.display = (v && !bemVendido(v) && typeof vbPodeRegistrar === "function" && vbPodeRegistrar(v)) ? "" : "none";
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

/* ---------- visão Abastecimentos (fase 118a) ---------- */
let _frotaAbast = { chave: null, dados: [], rodadas: [] };
let _frotaAbastModo = "lancamentos";  // lancamentos | colaborador
let _frotaAbastMesPosto = false;      // o mês atual só é posto na primeira abertura; depois, vazio quer dizer todo o histórico

const FROTA_ABAST_SELECT = "id,data,data_hora,placa,equipamento_id,funcionario_id,motorista_nome,ctipoproduto,cproduto,litros,valor,valor_litro,odometro,km_rodado,km_litro,credenciado,funcionario:funcionarios(nome),veic:equipamentos(codigo)";
/* odômetro digitado errado: fora disto o km não entra em R$/km nem em km/l */
const FROTA_ABAST_KM_MAX = 3000, FROTA_ABAST_KML_MAX = 40;

/* fase 186c: notinha do posto, lida junto e posta no mesmo formato da linha da PlusFrota (origem "posto") */
const FROTA_POSTO_SELECT = "id,data,data_hora,fornecedor_id,equipamento_id,placa,motorista_id,motorista_nome,produto,litros,preco_unitario,desconto,valor,km,horimetro,notinha_numero,foto_path,observacoes,fechamento_id,posto:fornecedores(razao_social,nome_fantasia),funcionario:funcionarios(nome),veic:equipamentos(codigo)";
const FROTA_ORIGEM_ROT = { plusfrota: "PlusFrota", posto: "Postos" };
function frotaPostoNome(f){ return f ? (f.nome_fantasia || f.razao_social || "Posto") : "Posto"; }
function frotaPostoParaLinha(n){
  const litros = Number(n.litros || 0);
  return {
    ...n, origem: "posto", funcionario_id: n.motorista_id, credenciado: frotaPostoNome(n.posto), cproduto: n.produto || null,
    ctipoproduto: /ARLA/i.test(n.produto || "") ? "ARLA" : "COMBUSTÍVEIS",
    valor_litro: n.preco_unitario != null ? Number(n.preco_unitario) : (litros ? Number(n.valor || 0) / litros : null),
    odometro: n.km, km_rodado: null, km_litro: null,
  };
}

function frotaAbastEhCombustivel(l){ return l.ctipoproduto === "COMBUSTÍVEIS"; }
function frotaAbastKmSuspeito(l){ return Number(l.km_rodado) > FROTA_ABAST_KM_MAX || Number(l.km_litro) > FROTA_ABAST_KML_MAX; }
function frotaAbastKmValido(l){ return frotaAbastEhCombustivel(l) && Number(l.km_rodado) > 0 && !frotaAbastKmSuspeito(l); }
function frotaAbastMotorista(l){ return l.funcionario?.nome || l.motorista_nome || "—"; }
function frotaAbastVeiculo(l){ return l.veic?.codigo ? `${l.veic.codigo} · ${l.placa || ""}` : (l.placa || "—"); }

function frotaAbastPreencherFiltros(){
  const manter = (id, vazio, itens) => {
    const sel = $(id); if(!sel) return;
    const v = sel.value;
    sel.innerHTML = `<option value="">${esc(vazio)}</option>` + itens.map(([val, rot]) => `<option value="${esc(val)}">${esc(rot)}</option>`).join("");
    sel.value = itens.some(([val]) => val === v) ? v : "";
  };
  const unicos = (par) => [...new Map(_frotaAbast.dados.map(par).filter(([k]) => k)).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  manter("frota-a-veiculo", "Todos os veículos", unicos(l => [l.placa, frotaAbastVeiculo(l)]));
  manter("frota-a-motorista", "Todos os motoristas", unicos(l => [frotaAbastMotorista(l), frotaAbastMotorista(l)]));
  manter("frota-a-produto", "Todos os produtos", unicos(l => [l.cproduto, l.cproduto]));
}

function frotaAbastFiltrados(){
  const termo = ($("frota-busca")?.value || "").trim().toLowerCase();
  const veic = $("frota-a-veiculo")?.value || "", mot = $("frota-a-motorista")?.value || "", prod = $("frota-a-produto")?.value || "";
  const semVeic = !!$("frota-a-semveic")?.checked;
  const origem = $("frota-a-origem")?.value || "";
  return _frotaAbast.dados.filter(l => {
    if(origem && l.origem !== origem) return false;
    if(veic && l.placa !== veic) return false;
    if(mot && frotaAbastMotorista(l) !== mot) return false;
    if(prod && l.cproduto !== prod) return false;
    if(semVeic && l.equipamento_id) return false;
    if(termo && !`${frotaAbastVeiculo(l)} ${frotaAbastMotorista(l)} ${l.credenciado || ""} ${l.cproduto || ""} ${l.notinha_numero || ""}`.toLowerCase().includes(termo)) return false;
    return true;
  });
}

/* comparação justa (decisão 10 da spec): só combustível com km confiável entra em R$/km e km/l */
function frotaAbastTotais(lista){
  const t = { n: lista.length, litros: 0, valor: 0, comb: 0, kmOk: 0, km: 0, valorKm: 0, litrosKm: 0 };
  lista.forEach(l => {
    t.litros += Number(l.litros || 0);
    t.valor += Number(l.valor || 0);
    if(frotaAbastEhCombustivel(l)) t.comb++;
    if(frotaAbastKmValido(l)){ t.kmOk++; t.km += Number(l.km_rodado); t.valorKm += Number(l.valor || 0); t.litrosKm += Number(l.litros || 0); }
  });
  return t;
}
function frotaAbastPorColaborador(lista){
  const grupos = new Map();
  lista.forEach(l => {
    const k = l.funcionario_id || "";
    if(!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  });
  const linhas = [...grupos.entries()].map(([id, ls]) => {
    const t = frotaAbastTotais(ls);
    return { ...t, id, nome: id ? (ls[0].funcionario?.nome || ls[0].motorista_nome || "Colaborador") : "Sem colaborador no app", rsKm: t.km ? t.valorKm / t.km : null, kmL: t.litrosKm ? t.km / t.litrosKm : null, incompleto: t.kmOk * 2 < t.comb || !t.kmOk };
  });
  // maior R$/km primeiro; km incompleto fica fora da ordenação, abaixo; "Sem colaborador" por último
  const peso = g => !g.id ? 2 : (g.incompleto ? 1 : 0);
  return linhas.sort((a, b) => peso(a) - peso(b) || (peso(a) === 0 ? b.rsKm - a.rsKm : b.valor - a.valor));
}

function frotaAbastRodapeHtml(){
  const boa = _frotaAbast.rodadas.find(r => r.fim && !r.erro);
  const quando = boa ? new Date(boa.fim) : null;
  const atrasada = !quando || (Date.now() - quando.getTime()) > 2 * 86400000;
  const hora = quando ? `${dataBR(dataLocalISO(quando)).slice(0, 5)} ${esc(quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))}` : "—";
  return `<div class="meta" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;">
    <span>Atualizado em ${/* html */ hora}</span>
    ${atrasada ? `<span class="tag ambar">Sem rodada bem-sucedida há mais de 2 dias</span>` : ""}
    ${frotaPodeSyncAbast() ? `<button type="button" class="btn-sec" id="btn-frota-abast-sync" style="margin-left:auto;">Sincronizar agora</button>` : ""}
  </div>`;
}

function frotaAbastKpisHtml(lista){
  const t = frotaAbastTotais(lista);
  const placasSem = new Set(lista.filter(l => !l.equipamento_id && l.placa).map(l => l.placa)).size;
  return `<div class="indicadores">
    <div class="ind"><div class="num">${frotaNum(t.litros)}</div><div class="rot">Litros</div></div>
    <div class="ind"><div class="num">${frotaMoeda(t.valor)}</div><div class="rot">Valor</div></div>
    <div class="ind"><div class="num">${t.litros ? frotaMoeda(t.valor / t.litros) : "—"}</div><div class="rot">R$/litro médio</div></div>
    <div class="ind"><div class="num">${frotaNum(t.n)}</div><div class="rot">Abastecimentos</div></div>
    <div class="ind"><div class="num">${frotaNum(placasSem)}</div><div class="rot">Placas sem veículo no app</div></div>
  </div>`;
}

/* lote S66-d (#325): km atual de cada veículo = a leitura mais recente entre o odômetro informado no PlusFrota
   (frota_abastecimentos.odometro, de qualquer mês) e as leituras do app (equipamento_leituras: semanal, viagem, compra, OS).
   Mesmo dia: vale o maior. Lido uma vez por abertura da visão. */
let _frotaKmAtual = null;   // Map placa -> { km, data, origem, app: { km, data, origem } | null }
const FROTA_KM_ORIGEM = { semanal: "semanal", viagem: "viagem", compra: "pedido de compra", os: "OS", manual: "manual", planilha: "planilha" };
async function frotaAbastCarregarKmAtual(){
  const desde = dataLocalISO(new Date(Date.now() - 180 * 86400000));
  const [ab, le] = await Promise.all([
    lerTudo(() => sb.from("frota_abastecimentos").select("id,placa,equipamento_id,data,odometro").gt("odometro", 0).gte("data", desde)),
    lerTudo(() => sb.from("equipamento_leituras").select("id,equipamento_id,data,km,origem").not("km", "is", null))
  ]);
  const mapa = new Map(), placaDoEquip = new Map();
  const melhor = (a, b) => !a || b.data > a.data || (b.data === a.data && Number(b.km) > Number(a.km)) ? b : a;
  (ab.data || []).forEach(l => {
    if(!l.placa) return;
    if(l.equipamento_id) placaDoEquip.set(l.equipamento_id, l.placa);
    mapa.set(l.placa, melhor(mapa.get(l.placa), { km: Number(l.odometro), data: l.data, origem: "PlusFrota" }));
  });
  const app = new Map();
  (le.data || []).forEach(l => app.set(l.equipamento_id, melhor(app.get(l.equipamento_id), { km: Number(l.km), data: l.data, origem: FROTA_KM_ORIGEM[l.origem] || l.origem || "app" })));
  app.forEach((v, eq) => {
    const placa = placaDoEquip.get(eq); if(!placa) return;
    const pf = mapa.get(placa);
    mapa.set(placa, { ...melhor(pf, v), app: v });
  });
  _frotaKmAtual = mapa;
}
function frotaKmAtualTxt(k){ return k ? `${frotaNum(k.km)} km · ${k.origem} ${dataBR(k.data).slice(0, 5)}` : "—"; }
/* topo da lista quando um veículo está filtrado: km atual, data e origem */
function frotaAbastKmAtualHtml(){
  const placa = $("frota-a-veiculo")?.value || "";
  if(!placa || !_frotaKmAtual) return "";
  const k = _frotaKmAtual.get(placa);
  const outra = k?.app && (k.app.km !== k.km || k.app.data !== k.data)
    ? ` <span class="meta" title="Última leitura registrada no app (semanal, viagem, pedido de compra ou OS)">· no app: ${esc(frotaKmAtualTxt(k.app))}</span>` : "";
  return `<div class="ui-secao" style="margin:0 0 8px;padding:8px 12px;">${uiRotuloValor("Km atual do veículo", k ? `<strong>${esc(frotaNum(k.km))} km</strong> <span class="meta">${esc(k.origem)} · ${esc(dataBR(k.data))}</span>${/* html */ outra}` : "Sem leitura de odômetro")}</div>`;
}

/* fase 186c: com as duas origens na lista, o tfoot traz uma linha por origem e o total */
function frotaAbastPorOrigem(lista){
  const grupos = ["plusfrota", "posto"].map(o => [FROTA_ORIGEM_ROT[o], lista.filter(l => l.origem === o)]).filter(([, ls]) => ls.length);
  return grupos.length > 1 ? [...grupos.map(([r, ls]) => [`Total ${r}`, ls]), ["Total", lista]] : [["Total", lista]];
}
function frotaAbastLancamentosHtml(lista){
  const kmDe = ls => ls.reduce((s, l) => s + (frotaAbastEhCombustivel(l) && !frotaAbastKmSuspeito(l) ? Number(l.km_rodado || 0) : 0), 0);
  const rodape = frotaAbastPorOrigem(lista).map(([rot, ls]) => {
    const t = frotaAbastTotais(ls);
    return `<tr><td colspan="5">${esc(rot)}</td><td class="num">${frotaNum(t.litros, 2)}</td><td class="num">${t.litros ? frotaMoeda(t.valor / t.litros) : "—"}</td><td class="num">${frotaMoeda(t.valor)}</td><td></td><td class="num">${frotaNum(kmDe(ls))}</td><td class="num">${t.litrosKm ? frotaNum(t.km / t.litrosKm, 2) : "—"}</td></tr>`;
  }).join("");
  const podePosto = frotaPodeOperarPosto();
  return `<div class="tabela-rola"><table>
    <thead><tr><th>Data</th><th>Veículo</th><th>Motorista</th><th>Posto</th><th>Produto</th><th class="num">Litros</th><th class="num">R$/l</th><th class="num">Valor</th><th class="num" title="Odômetro informado no abastecimento">Odômetro</th><th class="num">km</th><th class="num">km/l</th></tr></thead>
    <tbody>${lista.map(l => `<tr${l.origem === "posto" ? ` data-abposto="${esc(l.id)}"${podePosto ? ' class="clicavel" title="Abrir a notinha"' : ""}` : ""}>
      <td>${dataBR(l.data)}</td>
      <td title="${esc("Km atual: " + frotaKmAtualTxt(_frotaKmAtual?.get(l.placa)))}">${l.equipamento_id ? esc(frotaAbastVeiculo(l)) : `${esc(l.placa || "—")} <span class="tag ambar">Sem veículo no app</span>`}</td>
      <td>${esc(frotaAbastMotorista(l))}${l.funcionario_id ? "" : ` <span class="meta">(sem colaborador)</span>`}</td>
      <td>${esc(l.credenciado || "—")}${l.origem === "posto" ? ` <span class="tag azul" title="Notinha lançada no app${l.notinha_numero ? " · cupom " + esc(l.notinha_numero) : ""}">Notinha</span>` : ""}</td><td>${esc(l.cproduto || "—")}</td>
      <td class="num">${frotaNum(l.litros, 2)}</td><td class="num">${l.valor_litro != null ? frotaMoeda(l.valor_litro) : "—"}</td><td class="num">${frotaMoeda(l.valor)}</td>
      <td class="num">${Number(l.odometro) > 0 ? frotaNum(l.odometro) : "—"}</td>
      <td class="num">${frotaAbastKmSuspeito(l) ? `<span class="tag ambar" title="Fora da conta de R$/km e km/l">km suspeito</span>` : (Number(l.km_rodado) > 0 ? frotaNum(l.km_rodado) : "—")}</td>
      <td class="num">${!frotaAbastKmSuspeito(l) && Number(l.km_litro) > 0 ? frotaNum(l.km_litro, 2) : "—"}</td>
    </tr>`).join("") || `<tr><td colspan="11" class="vazio">Nenhum abastecimento nesse filtro.</td></tr>`}</tbody>
    <tfoot>${/* html */ rodape}</tfoot>
  </table></div>`;
}

function frotaAbastColaboradorHtml(lista){
  const grupos = frotaAbastPorColaborador(lista);
  return `<p class="meta" style="margin:0 0 8px;">Ordenado pelo maior R$/km. Abastecimento lançado no código de outro motorista conta para o dono do código. Caminhão e veículo leve têm R$/km diferentes: para comparar, filtre o veículo. Odômetro acima de ${frotaNum(FROTA_ABAST_KM_MAX)} km ou ${frotaNum(FROTA_ABAST_KML_MAX)} km/l fica fora da conta.</p>
  <div class="tabela-rola"><table>
    <thead><tr><th>Colaborador</th><th class="num">Abastecimentos</th><th class="num">Litros</th><th class="num">Valor</th><th class="num">km rodado</th><th class="num">R$/km</th><th class="num">km/l</th></tr></thead>
    <tbody>${grupos.map(g => `<tr>
      <td>${esc(g.nome)}${g.id && g.incompleto ? ` <span class="tag ambar" title="km faltando na maioria das linhas de combustível; fora da ordenação">km incompleto</span>` : ""}</td>
      <td class="num">${frotaNum(g.n)}</td><td class="num">${frotaNum(g.litros, 2)}</td><td class="num" data-val-sens>${frotaMoeda(g.valor)}</td>
      <td class="num">${g.km ? frotaNum(g.km) : "—"}</td><td class="num" data-val-sens>${g.rsKm != null ? frotaMoeda(g.rsKm) : "—"}</td><td class="num">${g.kmL != null ? frotaNum(g.kmL, 2) : "—"}</td>
    </tr>`).join("") || `<tr><td colspan="7" class="vazio">Nenhum abastecimento nesse filtro.</td></tr>`}</tbody>
    <tfoot>${frotaAbastPorOrigem(lista).map(([rot, ls]) => { const t = frotaAbastTotais(ls); return `<tr><td>${esc(rot)}</td><td class="num">${frotaNum(t.n)}</td><td class="num">${frotaNum(t.litros, 2)}</td><td class="num">${frotaMoeda(t.valor)}</td><td class="num">${frotaNum(t.km)}</td><td class="num">${t.km ? frotaMoeda(t.valorKm / t.km) : "—"}</td><td class="num">${t.litrosKm ? frotaNum(t.km / t.litrosKm, 2) : "—"}</td></tr>`; }).join("")}</tfoot>
  </table></div>`;
}

async function renderFrotaAbast(){
  const cont = $("frota-conteudo");
  const mesEl = $("frota-a-mes");
  if(mesEl && !_frotaAbastMesPosto){ _frotaAbastMesPosto = true; if(!mesEl.value) mesEl.value = frotaMesAtual(); }
  const mes = mesEl?.value || "";
  const chave = mes || "todos";
  if(_frotaAbast.chave !== chave){
    cont.innerHTML = `<p class="vazio">Carregando abastecimentos…</p>`;
    const fimMes = mes ? dataLocalISO(new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)) : null;
    const [ab, ro, , po] = await Promise.all([
      lerTudo(() => {
        let q = sb.from("frota_abastecimentos").select(FROTA_ABAST_SELECT);
        if(mes) q = q.gte("data", mes + "-01").lte("data", fimMes);
        return q;
      }),
      sb.from("frota_abastecimentos_sync").select("fim,erro").order("inicio", { ascending: false }).limit(30),
      _frotaKmAtual ? null : frotaAbastCarregarKmAtual(),   // lote S66-d (#325)
      lerTudo(() => {   // fase 186c: notinhas dos postos
        let q = sb.from("frota_abastecimentos_posto").select(FROTA_POSTO_SELECT);
        if(mes) q = q.gte("data", mes + "-01").lte("data", fimMes);
        return q;
      })
    ]);
    if(_frotaView !== "abastecimentos" || ($("frota-a-mes")?.value || "todos") !== chave) return;   // o filtro mudou durante a leitura
    if(ab.error){ cont.innerHTML = `<p class="vazio">Erro ao carregar abastecimentos: ${esc(ab.error.message)}</p>`; return; }
    if(po.error) aviso("app-aviso", "Notinhas dos postos: " + po.error.message, "erro");
    const postos = (po.data || []).map(frotaPostoParaLinha);
    _frotaAbast = {
      chave,
      dados: ab.data.map(l => ({ ...l, origem: "plusfrota" })).concat(postos)
        .sort((a, b) => String(b.data_hora || b.data).localeCompare(String(a.data_hora || a.data))),
      rodadas: ro.data || [],
    };
    frotaAbastPreencherFiltros();
  }
  const lista = frotaAbastFiltrados();
  const c = $("frota-contador"); if(c) c.textContent = `${lista.length} de ${_frotaAbast.dados.length}`;
  cont.innerHTML = frotaAbastKpisHtml(lista) + frotaAbastKmAtualHtml()
    + (_frotaAbastModo === "colaborador" ? frotaAbastColaboradorHtml(lista) : frotaAbastLancamentosHtml(lista))
    + frotaAbastRodapeHtml();
  $("btn-frota-abast-sync")?.addEventListener("click", () => comBotaoTravado("btn-frota-abast-sync", frotaAbastSincronizar));
}

async function frotaAbastSincronizar(){
  if(!frotaPodeSyncAbast()) return;
  const { data, error } = await sb.functions.invoke("plusfrota-sync", { body: { acao: "sincronizar" } });
  if(error){
    let msg = error.message;
    try { const j = await error.context?.json?.(); if(j?.error) msg = j.error; } catch(_){ /* corpo não é JSON */ }
    aviso("app-aviso", "Sincronização: " + msg, "erro"); return;
  }
  aviso("app-aviso", `Sincronização: ${Number(data?.lidas || 0)} lida(s), ${Number(data?.novas || 0)} nova(s), ${Number(data?.atualizadas || 0)} atualizada(s)${data?.ok ? "" : ". A rodada teve erro; a próxima cobre os últimos 7 dias"}.`, data?.ok ? "ok" : "aviso");
  _frotaAbast.chave = null; _frotaKmAtual = null;
  renderFrota();
}

/* ---------- notinha do posto e fechamento do mês (fase 186c, #281) ---------- */
const FROTA_POSTO_BUCKET = "viagens-anexos";   // logística grava nesse bucket (logistica_pode_operar); caminho abastecimento-posto/
let _frotaPostos = null;                         // fornecedores que são posto (nome com "posto" ou "combust", categoria diesel/combustível)
/* o nome que só cita um posto ("RESTAURANTE AO LADO DO POSTO ...") não é posto; categoria diesel/combustível sempre entra */
const FROTA_NAO_POSTO = /\b(restaurante|lanchonete|padaria)\b/i;
let _frotaPostoEditId = null;
let _frotaFechPedidos = [];

async function frotaCarregarPostos(){
  if(_frotaPostos) return _frotaPostos;
  const { data, error } = await sb.from("fornecedores").select("id,razao_social,nome_fantasia,categoria,ativo")
    .or("razao_social.ilike.%posto%,nome_fantasia.ilike.%posto%,razao_social.ilike.%combust%,categoria.ilike.%diesel%,categoria.ilike.%combust%")
    .order("nome_fantasia", { ascending: true, nullsFirst: false });
  if(error){ aviso("app-aviso", "Postos: " + error.message, "erro"); return []; }
  _frotaPostos = (data || []).filter(f => f.ativo !== false
      && (/diesel|combust/i.test(f.categoria || "") || !FROTA_NAO_POSTO.test(`${f.razao_social || ""} ${f.nome_fantasia || ""}`)))
    .map(f => ({ id: f.id, nome: f.nome_fantasia && f.nome_fantasia !== f.razao_social ? `${f.nome_fantasia} (${f.razao_social})` : (f.nome_fantasia || f.razao_social) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return _frotaPostos;
}
function frotaPostoOpcoes(sel, valor){
  sel.innerHTML = `<option value="">Escolha o posto</option>` + (_frotaPostos || []).map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join("");
  sel.value = valor || "";
}
function frotaAvisoModal(id, msg, tipo){
  const el = $(id); if(!el) return;
  el.textContent = msg; el.className = "aviso " + tipo;
}

async function abrirNotinhaPosto(id){
  if(!frotaPodeOperarPosto()) return;
  await frotaCarregarPostos();
  const n = id ? _frotaAbast.dados.find(l => l.origem === "posto" && l.id === id) : null;
  _frotaPostoEditId = n ? n.id : null;
  $("fpn-titulo").textContent = n ? `Notinha${n.notinha_numero ? " " + n.notinha_numero : ""}` : "Nova notinha de posto";
  $("fpn-data").value = n?.data || hojeISO();
  frotaPostoOpcoes($("fpn-posto"), n?.fornecedor_id);
  const equips = [..._frotaVeic, ..._frotaEquipOutros].filter(e => e.ativo !== false || e.id === n?.equipamento_id);
  $("fpn-equip").innerHTML = `<option value="">Sem TAG (informe a placa)</option>` + equips.map(e => `<option value="${esc(e.id)}">${esc(`${e.codigo}${e.placa ? " · " + e.placa : ""}${e.nome ? " · " + e.nome : ""}`)}</option>`).join("");
  $("fpn-equip").value = n?.equipamento_id || "";
  $("fpn-placa").value = n?.placa || "";
  $("fpn-motorista").innerHTML = `<option value="">—</option>` + _frotaFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
  $("fpn-motorista").value = n?.motorista_id || "";
  $("fpn-produto").value = n?.produto || "";
  $("fpn-litros").value = n?.litros ?? "";
  $("fpn-preco").value = n?.preco_unitario ?? "";
  $("fpn-desconto").value = n && Number(n.desconto) ? n.desconto : "";
  $("fpn-valor").value = n?.valor ?? "";
  $("fpn-km").value = n?.km ?? "";
  $("fpn-horimetro").value = n?.horimetro ?? "";
  $("fpn-numero").value = n?.notinha_numero || "";
  $("fpn-obs").value = n?.observacoes || "";
  $("fpn-foto").value = "";
  $("fpn-foto-atual").innerHTML = n?.foto_path ? `<a href="#" id="fpn-foto-ver">Ver foto anexada</a>` : "";
  $("btn-fpn-excluir").style.display = n ? "" : "none";
  frotaAvisoModal("fpn-aviso", "", "");
  $("frota-posto-modal").style.display = "flex";
}
function fecharNotinhaPosto(){ $("frota-posto-modal").style.display = "none"; _frotaPostoEditId = null; }

/* litros × preço − desconto preenche o valor; o valor digitado à mão continua valendo */
function frotaPostoCalcularValor(){
  const litros = Number($("fpn-litros").value || 0), preco = Number($("fpn-preco").value || 0), desc = Number($("fpn-desconto").value || 0);
  if(litros > 0 && preco > 0) $("fpn-valor").value = Math.max(0, Math.round((litros * preco - desc) * 100) / 100).toFixed(2);
}

async function salvarNotinhaPosto(){
  if(!frotaPodeOperarPosto()) return;
  const num = id => { const v = $(id).value; return v === "" ? null : Number(v); };
  const reg = {
    data: $("fpn-data").value || null,
    fornecedor_id: $("fpn-posto").value || null,
    equipamento_id: $("fpn-equip").value || null,
    placa: $("fpn-placa").value.trim() || null,
    motorista_id: $("fpn-motorista").value || null,
    produto: $("fpn-produto").value.trim().toUpperCase() || null,
    litros: num("fpn-litros"), preco_unitario: num("fpn-preco"), desconto: num("fpn-desconto") || 0, valor: num("fpn-valor"),
    km: num("fpn-km"), horimetro: num("fpn-horimetro"),
    notinha_numero: $("fpn-numero").value.trim() || null,
    observacoes: $("fpn-obs").value.trim() || null,
  };
  const falta = [];
  if(!reg.data) falta.push("data");
  if(!reg.fornecedor_id) falta.push("posto");
  if(!reg.equipamento_id && !reg.placa) falta.push("veículo ou placa");
  if(!(reg.litros > 0)) falta.push("litros");
  if(reg.valor == null || reg.valor < 0) falta.push("valor");
  if(falta.length){ frotaAvisoModal("fpn-aviso", "Preencha: " + falta.join(", ") + ".", "erro"); return; }
  if(reg.equipamento_id && !$("fpn-placa").value.trim()) reg.placa = null;   // o banco preenche a placa pela TAG

  const arq = $("fpn-foto").files?.[0];
  if(arq){
    const ext = extensaoArquivo(arq), mime = mimeDoArquivo(arq, ext);
    const caminho = `abastecimento-posto/${reg.data.slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from(FROTA_POSTO_BUCKET).upload(caminho, corpoComMime(arq, mime), { cacheControl: "3600", contentType: mime, upsert: false });
    if(up.error){ frotaAvisoModal("fpn-aviso", "Foto não enviada: " + up.error.message, "erro"); return; }
    reg.foto_path = caminho;
  }
  const r = _frotaPostoEditId
    ? await sb.from("frota_abastecimentos_posto").update(reg).eq("id", _frotaPostoEditId)
    : await sb.from("frota_abastecimentos_posto").insert(reg);
  if(r.error){
    if(reg.foto_path) await sb.storage.from(FROTA_POSTO_BUCKET).remove([reg.foto_path]);
    const msg = r.error.code === "23505" ? "Já existe notinha com esse número neste posto." : r.error.message;
    frotaAvisoModal("fpn-aviso", "Não salvou: " + msg, "erro"); return;
  }
  const nova = !_frotaPostoEditId;
  fecharNotinhaPosto();
  aviso("app-aviso", nova ? "Notinha lançada." : "Notinha salva.", "ok");
  _frotaAbast.chave = null;
  renderFrota();
}

async function excluirNotinhaPosto(){
  if(!frotaPodeOperarPosto() || !_frotaPostoEditId) return;
  if(!confirm("Excluir esta notinha? Se o mês do posto já estava conferido, ele volta para aberto.")) return;
  const n = _frotaAbast.dados.find(l => l.origem === "posto" && l.id === _frotaPostoEditId);
  const { error } = await sb.from("frota_abastecimentos_posto").delete().eq("id", _frotaPostoEditId);
  if(error){ frotaAvisoModal("fpn-aviso", "Não excluiu: " + error.message, "erro"); return; }
  if(n?.foto_path) await sb.storage.from(FROTA_POSTO_BUCKET).remove([n.foto_path]);
  fecharNotinhaPosto();
  aviso("app-aviso", "Notinha excluída.", "ok");
  _frotaAbast.chave = null;
  renderFrota();
}

async function frotaPostoVerFoto(){
  const n = _frotaAbast.dados.find(l => l.origem === "posto" && l.id === _frotaPostoEditId);
  if(!n?.foto_path) return;
  const { data, error } = await sb.storage.from(FROTA_POSTO_BUCKET).createSignedUrl(n.foto_path, 120);
  if(error){ frotaAvisoModal("fpn-aviso", "Foto: " + error.message, "erro"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

/* Fechamento do mês: soma das notinhas do posto na competência contra o(s) pedido(s) do posto ou o valor da NF */
async function abrirFechamentoPosto(){
  if(!frotaPodeVerAbast()) return;
  await frotaCarregarPostos();
  frotaPostoOpcoes($("ffc-posto"), $("ffc-posto").value);
  $("ffc-mes").value = $("frota-a-mes")?.value || frotaMesAtual();
  const pode = frotaPodeOperarPosto();
  ["btn-ffc-salvar", "btn-ffc-concluir"].forEach(id => { $(id).style.display = pode ? "" : "none"; });
  ["ffc-nf", "ffc-total-nf", "ffc-obs"].forEach(id => { $(id).disabled = !pode; });
  frotaAvisoModal("ffc-aviso", "", "");
  $("frota-fech-modal").style.display = "flex";
  await carregarFechamentoPosto();
}
function fecharFechamentoPosto(){ $("frota-fech-modal").style.display = "none"; }

async function carregarFechamentoPosto(){
  const posto = $("ffc-posto").value, mes = $("ffc-mes").value;
  const corpo = $("ffc-corpo");
  _frotaFechPedidos = [];
  if(!posto || !mes){
    corpo.innerHTML = `<p class="meta">Escolha o posto e a competência.</p>`;
    $("ffc-resumo").innerHTML = "";
    return;
  }
  corpo.innerHTML = `<p class="vazio">Carregando…</p>`;
  const ini = mes + "-01", fim = dataLocalISO(new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0));
  const [no, pe, fe] = await Promise.all([
    lerTudo(() => sb.from("frota_abastecimentos_posto").select("id,valor,litros").eq("fornecedor_id", posto).gte("data", ini).lte("data", fim)),
    sb.rpc("frota_posto_pedidos", { p_fornecedor: posto, p_competencia: ini }),
    sb.from("frota_abastecimentos_posto_fechamento").select("*").eq("fornecedor_id", posto).eq("competencia", ini).maybeSingle()
  ]);
  if(($("ffc-posto").value !== posto) || ($("ffc-mes").value !== mes)) return;   // mudou durante a leitura
  if(no.error || pe.error || fe.error){ corpo.innerHTML = `<p class="vazio">Erro: ${esc((no.error || pe.error || fe.error).message)}</p>`; return; }
  const notinhas = no.data || [];
  _frotaFechPedidos = pe.data || [];
  const f = fe.data;
  const marcados = new Set(f?.pedido_ids || []);
  const pode = frotaPodeOperarPosto();
  corpo.innerHTML = `${uiSecao("documento", "Pedidos do posto", _frotaFechPedidos.length
      ? `<p class="meta" style="margin:0 0 6px;">Pedidos do mês e do mês seguinte (a NF do mês costuma vir depois). Marque os que pagam estas notinhas.</p>
        <div class="tabela-rola"><table><thead><tr><th></th><th>Pedido</th><th>Data</th><th>Status</th><th>NF</th><th class="num">Total</th></tr></thead>
        <tbody>${_frotaFechPedidos.map(p => `<tr>
          <td><input type="checkbox" class="ffc-ped" value="${esc(p.id)}" aria-label="${esc("Usar o pedido " + p.numero)}"${marcados.has(p.id) ? " checked" : ""}${pode ? "" : " disabled"} /></td>
          <td>${uiCodigo(p.numero)}</td><td>${dataBR(p.data_pedido)}</td><td>${esc(p.status)}</td><td>${esc(p.nf_informada || "—")}</td><td class="num" data-val-sens>${frotaMoeda(p.total)}</td>
        </tr>`).join("")}</tbody></table></div>`
      : uiVazio("Nenhum pedido deste posto no mês nem no seguinte. Informe o valor da NF ou peça o pedido em Compras."))}
    <p class="meta" style="margin:8px 0;">${frotaNum(notinhas.length)} notinha(s) lançada(s) neste posto no mês · ${frotaNum(notinhas.reduce((s, n) => s + Number(n.litros || 0), 0), 2)} litros.
      ${f ? ` Situação: ${frotaFechStatusTag(f.status)}${f.conferido_em ? ` <span class="meta">em ${esc(dataBR(dataLocalISO(new Date(f.conferido_em))))}</span>` : ""}` : " Ainda sem fechamento."}</p>`;
  $("ffc-nf").value = f?.nf_numero || ([...new Set(_frotaFechPedidos.filter(p => marcados.has(p.id)).map(p => p.nf_informada).filter(Boolean))].join(", "));
  $("ffc-total-nf").value = f && f.total_nf != null && (f.pedido_ids || []).length === 0 ? f.total_nf : "";
  $("ffc-obs").value = f?.observacoes || "";
  corpo.dataset.totalNotinhas = String(notinhas.reduce((s, n) => s + Number(n.valor || 0), 0));
  frotaFechResumo();
}
function frotaFechStatusTag(st){
  const m = { aberto: ["cinza", "Aberto"], conferido: ["ok", "Conferido"], com_diferenca: ["ambar", "Com diferença"] }[st] || ["cinza", st];
  return `<span class="tag ${esc(m[0])}">${esc(m[1])}</span>`;
}
function frotaFechPedidosMarcados(){ return [...document.querySelectorAll("#ffc-corpo .ffc-ped:checked")].map(c => c.value); }
function frotaFechResumo(){
  const totNot = Number($("ffc-corpo").dataset.totalNotinhas || 0);
  const ids = new Set(frotaFechPedidosMarcados());
  const totPed = _frotaFechPedidos.filter(p => ids.has(p.id)).reduce((s, p) => s + Number(p.total || 0), 0);
  const nfDig = $("ffc-total-nf").value;
  const ref = nfDig !== "" ? Number(nfDig) : (ids.size ? totPed : null);
  const dif = ref == null ? null : Math.round((ref - totNot) * 100) / 100;
  $("ffc-resumo").innerHTML = `<div class="indicadores">
    <div class="ind"><div class="num">${frotaMoeda(totNot)}</div><div class="rot">Soma das notinhas</div></div>
    <div class="ind"><div class="num">${ref == null ? "—" : frotaMoeda(ref)}</div><div class="rot">${nfDig !== "" ? "Valor da NF" : "Pedidos marcados"}</div></div>
    <div class="ind"><div class="num">${dif == null ? "—" : frotaMoeda(dif)}</div><div class="rot">${dif == null ? "Diferença" : (Math.abs(dif) <= 0.01 ? "Sem diferença" : (dif > 0 ? "NF acima das notinhas" : "Notinhas acima da NF"))}</div></div>
  </div>`;
}

async function salvarFechamentoPosto(concluir){
  if(!frotaPodeOperarPosto()) return;
  const posto = $("ffc-posto").value, mes = $("ffc-mes").value;
  if(!posto || !mes){ frotaAvisoModal("ffc-aviso", "Escolha o posto e a competência.", "erro"); return; }
  const nfDig = $("ffc-total-nf").value;
  const { data, error } = await sb.rpc("frota_posto_fechamento_salvar", {
    p_fornecedor: posto, p_competencia: mes + "-01", p_pedidos: frotaFechPedidosMarcados(),
    p_nf_numero: $("ffc-nf").value.trim() || null, p_total_nf: nfDig === "" ? null : Number(nfDig),
    p_concluir: !!concluir, p_observacoes: $("ffc-obs").value.trim() || null
  });
  if(error){ frotaAvisoModal("ffc-aviso", "Não salvou: " + error.message, "erro"); return; }
  const msg = data?.status === "conferido" ? "Mês conferido: a soma das notinhas bate com o pedido ou a NF."
    : data?.status === "com_diferenca" ? `Mês concluído com diferença de ${frotaMoeda(data.diferenca)}.` : "Fechamento salvo em aberto.";
  frotaAvisoModal("ffc-aviso", msg, data?.status === "com_diferenca" ? "aviso" : "ok");
  await carregarFechamentoPosto();
}

/* ---------- ligação ---------- */
function ligarFrota(){
  document.querySelectorAll("#sec-frota .serv-view-btn[data-view]").forEach(b => b.addEventListener("click", () => { _frotaView = b.dataset.view; _frotaTipoFiltro = ""; renderFrota(); }));
  document.querySelectorAll("#frota-modos .serv-view-btn").forEach(b => b.addEventListener("click", () => { _frotaModo = b.dataset.modo; renderFrota(); }));
  ["frota-f-mes", "frota-f-caminhao", "frota-f-obra", "frota-f-finalidade", "frota-f-status", "frota-f-nota", "frota-a-mes", "frota-a-veiculo", "frota-a-motorista", "frota-a-produto", "frota-a-semveic"].forEach(id => $(id)?.addEventListener("change", renderFrota));
  document.querySelectorAll("#frota-abast-modos .serv-view-btn").forEach(b => b.addEventListener("click", () => { _frotaAbastModo = b.dataset.abmodo; renderFrota(); }));
  $("frota-busca")?.addEventListener("input", debounce(renderFrota));
  $("btn-frota-atualizar")?.addEventListener("click", () => carregarFrota(true));
  $("btn-frota-nova-viagem")?.addEventListener("click", () => { if(typeof novaViagem === "function") novaViagem(); });
  $("btn-frota-novo-veic")?.addEventListener("click", () => abrirVeiculo(null));
  $("frota-kpi-card-transito")?.addEventListener("click", () => { _frotaView = "viagens"; const s = $("frota-f-status"); if(s) s.value = s.value === "em_transito" ? "" : "em_transito"; renderFrota(); });
  $("frota-kpi-card-notas")?.addEventListener("click", () => { _frotaView = _frotaView === "documentos" ? "viagens" : "documentos"; _frotaTipoFiltro = ""; renderFrota(); });   // lote S46 (#95): de novo volta
  $("frota-kpi-card-caminhoes")?.addEventListener("click", () => frotaFiltrarTipo("caminhao"));
  $("frota-kpi-card-veiculos")?.addEventListener("click", () => frotaFiltrarTipo("veiculo"));
  $("frota-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a.link-cad, a.link-obra, select, button")) return;
    const tv = e.target.closest("[data-vg]"); if(tv){ if(typeof abrirViagem === "function") abrirViagem(tv.dataset.vg, null); return; }
    const tp = e.target.closest("tr[data-abposto]"); if(tp){ if(frotaPodeOperarPosto()) abrirNotinhaPosto(tp.dataset.abposto); return; }
    const tr = e.target.closest("tr[data-veic]"); if(tr) abrirVeiculo(tr.dataset.veic);
  });
  // fase 186c: notinha do posto e fechamento do mês
  $("frota-a-origem")?.addEventListener("change", renderFrota);
  $("btn-frota-posto-nova")?.addEventListener("click", () => abrirNotinhaPosto(null));
  $("btn-frota-posto-fech")?.addEventListener("click", abrirFechamentoPosto);
  $("btn-fpn-fechar")?.addEventListener("click", fecharNotinhaPosto);
  $("btn-fpn-salvar")?.addEventListener("click", () => comBotaoTravado("btn-fpn-salvar", salvarNotinhaPosto));
  $("btn-fpn-excluir")?.addEventListener("click", () => comBotaoTravado("btn-fpn-excluir", excluirNotinhaPosto));
  ["fpn-litros", "fpn-preco", "fpn-desconto"].forEach(id => $(id)?.addEventListener("input", frotaPostoCalcularValor));
  $("fpn-foto-atual")?.addEventListener("click", e => { if(e.target.closest("#fpn-foto-ver")){ e.preventDefault(); frotaPostoVerFoto(); } });
  $("btn-ffc-fechar")?.addEventListener("click", fecharFechamentoPosto);
  $("ffc-posto")?.addEventListener("change", carregarFechamentoPosto);
  $("ffc-mes")?.addEventListener("change", carregarFechamentoPosto);
  $("ffc-total-nf")?.addEventListener("input", frotaFechResumo);
  $("ffc-corpo")?.addEventListener("change", e => { if(e.target.classList.contains("ffc-ped")) frotaFechResumo(); });
  $("btn-ffc-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ffc-salvar", () => salvarFechamentoPosto(false)));
  $("btn-ffc-concluir")?.addEventListener("click", () => comBotaoTravado("btn-ffc-concluir", () => salvarFechamentoPosto(true)));
  $("btn-fveic-fechar")?.addEventListener("click", fecharVeiculo);
  $("btn-fveic-salvar")?.addEventListener("click", () => comBotaoTravado("btn-fveic-salvar", salvarVeiculo));
  $("btn-fveic-vender")?.addEventListener("click", () => {   // fase 96
    const v = _frotaVeic.find(x => x.id === _frotaVeicEditId);
    if(!v || typeof vbAbrirRegistro !== "function") return;
    fecharVeiculo();
    vbAbrirRegistro(v, null);
  });
  document.querySelector('nav button[data-secao="frota"]')?.addEventListener("click", () => carregarFrota(false));
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarFrota); else ligarFrota();

/* ====================================================================
   Módulo: Compras (fase 53 — plano "Compras e Custos por Equipamento", fase 1)
   Pedido de compra → aprovação por alçada → enviado → recebimento da NF (manual nesta fase)
   → entrada de estoque (destino base) ou custo direto (obra/TAG) → títulos a pagar.
   Fase 55 (21/09/2026): as visões A pagar, Lançamentos avulsos e a exportação saíram daqui para
   "Contratos & Contas a pagar" (js/contas_pagar.js). Ficam aqui o modal de custo avulso e a aba
   Custos (vw_custos) usada por Equipamentos e Obras.
   Prefixo: cmp-. Regras de negócio ficam nas RPCs (pedido_enviar_aprovacao, pedido_aprovar,
   pedido_mudar_status, recebimento_confirmar).
   Fase 108b (23/10/2026): cada item diz o tipo de compra (Reposição de estoque = entra no almoxarifado e o custo
   aparece na saída; Aplicação direta = obra, TAG ou centro, custo no recebimento), a natureza (naturezas_custo) e o
   método. A aprovação tem duas chaves (alçada por valor + dono do custo de cada destino de aplicação direta, banco da
   108a): a ficha mostra "Falta assinar", o botão diz "Assinar" a quem só assina a chave de dono e "Aprovar" a quem
   fecha o pedido; o painel filtra "para eu aprovar" (vw_pedidos_aprovacao_pendente). O dono do custo fora de Compras
   chega pela Sala de Comando (cmpAbrirParaAssinar).
   Fase 102 (26/10/2026, chamados #91, #92, #143 e #160): o pedido segue as seis etapas do Fabrício (requisição →
   estoque ou compra → cotações → aprovação → recebimento conferido por quem pediu → financeiro). Status novo
   em_cotacao (rascunho → em cotação → rascunho); aba Cotações (comparativo por item, menor preço marcado, "Fechar com
   este fornecedor" = RPC cotacao_fechar); conferência do recebimento pelo solicitante (recebimento_conferir; a etapa
   "aguardando conferência" é calculada em vw_compras_pedido_etapa: o status continua `recebido` quando o almoxarifado
   confirma a NF); chips Etapa, Conferência e Financeiro (este só para podeVerContasPagar); resumo com os cartões da
   sequência do Fabrício (vw_compras_etapas; valores só para quem lê contas a pagar); "Novo produto" no item do pedido
   (produto_cadastro_rapido). Os itens do pedido passam a ser gravados mantendo o id (as cotações apontam para eles).
   Lote S53 (27/10/2026, chamados #163, #166 e #149): o pedido gerado da requisição sem fornecedor nasce em cotação e
   "Fechar com este fornecedor" pode enviar para aprovação na mesma transação (cotacao_fechar com p_enviar; o fornecedor
   só é obrigatório para aprovar); % IPI e % ICMS por item (IPI soma ao total do pedido e ao custo, ICMS só informa;
   fn_pedido_compra_total), descrição do item livre em textarea que cresce, rodapé Itens · IPI · Frete · Desconto · Total;
   rateio de um item com destino TAG entre equipamentos (pedido_item_rateio, RPC pedido_item_rateio_definir, modal ⚖ e
   "+ TAGs" no cabeçalho): vw_custos abre uma linha por TAG e cada TAG pede a chave do seu dono do custo.
   ==================================================================== */

let _cmpView = "kanban";
let _cmpKpi = "";
let _cmpPedidos = [];
let _cmpForns = [];
let _cmpFornMap = {};
let _cmpObras = [];             // obras abertas (planejada, em andamento, paralisada): requisição nova e Contratos leem daqui
let _cmpObrasConcluidas = [];   // lote S54 (#171): concluídas entram nos selects de Compras num grupo "Concluídas" no fim; canceladas ficam fora
let _cmpObraMap = {};           // todas as não canceladas (cmpObra resolve o nome de pedido antigo de obra concluída)
let _cmpProdUn = {};            // lote S54 (#170): produto_id → unidade do cadastro (busca e itens carregados)
let _cmpEquips = [];
let _cmpEqMap = {};
let _cmpCentros = [];             // fase 76: centros de custo internos (setores e obras internas)
let _cmpCentroMap = {};
let _cmpAlcada = -1;              // null = sem limite; -1 = sem alçada
let _cmpCarregado = false;
let _cmpReqPend = 0;              // fase 60: requisições pendentes (indicador)
let _cmpAtual = null;             // pedido aberto
let _cmpEditId = null;
let _cmpItens = [];               // itens em edição na ficha
let _cmpRec = null;               // recebimento em montagem no modal
let _cmpAvPre = null;             // callback após salvar custo avulso
let _cmpParaReceber = {};         // fase 78: pedido_id -> linha de vw_compras_para_receber
let _cmpPerfis = [];              // fase 78: usuários ativos (responsável pelo recebimento)
let _cmpSrv = null;               // fase 78: recebimento de serviço em montagem
let _cmpKpis = null;              // lote S43 (L2): linha de vw_compras_kpis (indicadores numa consulta só)
let _cmpCarga = 0;                // lote S43: token da carga em andamento (trocar o período cancela a anterior)
let _cmpCompleto = false;         // lote S43: o resto do período já chegou? (a 1ª carga é abertos + 30 dias)
let _cmpBuscaServidorIds = null;  // lote S43 → S52: ids de pedidos que casaram no servidor (item, nº da NF do recebimento ou "Ref. Odoo" nas observações; 3+ letras)
let _cmpNfs = {};                 // lote S52 (#162): pedido_id -> ["185", "186/1", …] (recebimentos não cancelados)
let _cmpBasePromessa = null;      // fase 108b: carga dos cadastros em andamento (Sala de Comando e menu chamam juntos)
let _cmpNaturezas = [];           // fase 108b: naturezas_custo (natureza do gasto, códigos do plano do Odoo)
let _cmpNatMap = {};
let _cmpAprovPend = {};           // fase 108b: pedido_id -> chaves pendentes (vw_pedidos_aprovacao_pendente)
let _cmpAprovAtual = { pend: [], assinadas: [], carregado: false };   // fase 108b: chaves do pedido aberto
let _cmpModoDono = false;         // fase 108b: ficha aberta pela Sala de Comando por quem não tem Compras no menu
const _cmpObraMetodo = {};        // fase 108b: obra_id -> método padrão pelo tipo de serviço da obra (null = sem padrão)
let _cmpEtapaEsp = {};            // fase 102: pedido_id -> linha de vw_compras_pedido_etapa (conferência, financeiro, aviso)
let _cmpEtapasResumo = null;      // fase 102: etapa -> { q, v, atr, cv } somados de vw_compras_etapas (null = view ausente)
let _cmpCotacoes = [];            // fase 102: cotações do pedido aberto
let _cmpCotEdit = null;           // fase 102: cotação em edição no formulário (null = fechado; {} = nova)
let _cmpConfAtual = { lista: [], pode: false, etapa: null, carregado: false };   // fase 102: conferências do pedido aberto
let _cmpCategorias = null;        // fase 102 (#160): categorias_produto para o cadastro rápido
let _cmpViewInicial = false;      // fase 102: quem não opera Compras abre direto em Requisições (uma vez)
let _cmpRat = null;               // lote S53 (#149): modal de rateio aberto { idx: índice do item | null = cabeçalho, sel: Map(equipamento_id -> %) }
let _cmpRatPadrao = [];           // lote S53 (#149): TAGs do "+ TAGs" do cabeçalho (itens novos nascem rateados em partes iguais)
let _cmpCotEnviar = true;         // lote S53 (#163): "ao fechar, enviar para aprovação" (caixa da aba Cotações)
/* colunas que o painel usa (a ficha abre o pedido inteiro em abrirPedido) */
const CMP_COLS = "id,numero,status,fornecedor_id,solicitante_id,data_pedido,previsao_entrega,condicao_pagamento,local_entrega,obra_id,equipamento_id,centro_custo_id,total,codigo_externo,codigo_externo_origem,comprador_externo,responsavel_recebimento_id,compra_direta,created_at,observacoes";   // lote S52: observacoes guarda o "Documento de origem" do Odoo ("Ref. Odoo: 10034")
const CMP_PRIMEIRA_CARGA_DIAS = 30;

const CMP_STATUS = {
  rascunho:              { label: "Rascunho",             cor: "cinza" },
  em_cotacao:            { label: "Em cotação",           cor: "ambar" },   // fase 102
  aguardando_aprovacao:  { label: "Aguardando aprovação", cor: "ambar" },
  aprovado:              { label: "Aprovado",             cor: "azul" },
  enviado:               { label: "Enviado",              cor: "azul" },
  parcialmente_recebido: { label: "Parcialmente recebido",cor: "ambar" },
  recebido:              { label: "Recebido",             cor: "verde" },
  cancelado:             { label: "Cancelado",            cor: "vermelho" }
};
const CMP_STAGES = ["rascunho","em_cotacao","aguardando_aprovacao","aprovado","enviado","parcialmente_recebido","recebido"];
const CMP_ABERTOS = ["rascunho","em_cotacao","aguardando_aprovacao","aprovado","enviado","parcialmente_recebido"];
/* fase 102: etapa do fluxo do Fabrício (#91), = vw_compras_pedido_etapa.etapa. O status do pedido continua o mesmo;
   aguardando_conferencia, financeiro e finalizado são calculados sobre o status `recebido`. */
const CMP_ETAPA = {
  rascunho:               { label: "Rascunho",               cor: "cinza" },
  em_cotacao:             { label: "Em cotação",             cor: "ambar" },
  aguardando_aprovacao:   { label: "Aguardando aprovação",   cor: "ambar" },
  aguardando_recebimento: { label: "Aguardando recebimento", cor: "azul" },
  aguardando_conferencia: { label: "Aguardando conferência", cor: "ambar" },
  financeiro:             { label: "Financeiro",             cor: "azul" },
  finalizado:             { label: "Finalizado",             cor: "verde" },
  cancelado:              { label: "Cancelado",              cor: "vermelho" }
};
const CMP_ETAPAS_ABERTAS = ["rascunho","em_cotacao","aguardando_aprovacao","aguardando_recebimento","aguardando_conferencia","financeiro"];
/* cartão do resumo → etapas que ele conta e filtra (#92) */
const CMP_KPI_ETAPAS = { em_cotacao: ["em_cotacao"], aprovar: ["aguardando_aprovacao"], entrega: ["aguardando_recebimento","aguardando_conferencia"],
  financeiro: ["financeiro"], abertos: CMP_ETAPAS_ABERTAS, finalizados: ["finalizado"] };
function cmpEtapa(p){
  const e = _cmpEtapaEsp[p.id];
  if(e && e.etapa) return e.etapa;
  if(p.status === "recebido") return "finalizado";
  if(["aprovado","enviado","parcialmente_recebido"].includes(p.status)) return "aguardando_recebimento";
  return CMP_ETAPA[p.status] ? p.status : "cancelado";
}
function cmpEtapaTag(et){ const o = CMP_ETAPA[et] || {}; return `<span class="tag ${o.cor || "cinza"}">${esc(o.label || et)}</span>`; }
/* tag que vai ao lado do status na lista e no cartão: só o que o status não diz */
function cmpEtapaExtra(p){
  const et = cmpEtapa(p), e = _cmpEtapaEsp[p.id];
  const partes = [];
  if(["aguardando_conferencia","financeiro"].includes(et)) partes.push(cmpEtapaTag(et));
  if(e && Number(e.conferencias_vencidas) > 0) partes.push(`<span class="tag vermelho" title="o solicitante não conferiu o recebimento no prazo; o pedido seguiu com aviso">sem conferência</span>`);
  return partes.join(" ");
}
// Depois de aprovado, o pedido ou aguarda recebimento ou terminou (06/10/2026). Atraso só conta aqui:
// rascunho e cotação não têm entrega a atrasar.
const CMP_AGUARDA_RECEB = ["aprovado","enviado","parcialmente_recebido"];
function cmpAtrasado(p){ return CMP_AGUARDA_RECEB.includes(p.status) && !!p.previsao_entrega && p.previsao_entrega < hojeISO(); }
const CMP_CAT_LBL = { peca: "Peça", pneu: "Pneu", combustivel: "Combustível", lubrificante: "Lubrificante", servico_terceiro: "Serviço de terceiro", mao_obra_interna: "Mão de obra interna", frete: "Frete", locacao: "Locação", multa: "Multa", seguro_ipva: "Seguro / IPVA", deslocamento: "Deslocamento",
  epi: "EPI", uniforme: "Uniforme",   // fase 100 (#100): valores novos do enum categoria_custo (migration 20261021_fase100a)
  outro: "Outro" };
const CMP_ORIGEM_LBL = { compra: "Compra direta", estoque: "Saída de estoque", deslocamento: "Deslocamento", manutencao: "Manutenção", reparo: "Reparo caldeiraria", avulso: "Avulso", contrato: "Contrato", combustivel: "Combustível (RDO)", pedido_externo: "Pedido Odoo" };
const CMP_CENTRO_TIPO = { setor: "Setor", obra_interna: "Obra interna" };
/* fase 108b: tipo de compra do item (compra_tipo; no banco é coluna gerada pelo destino: estoque = reposição) */
const CMP_TIPO_LBL = { reposicao: "Reposição de estoque", aplicacao_direta: "Aplicação direta" };
const CMP_TIPO_CURTO = { reposicao: "reposição", aplicacao_direta: "aplicação direta" };
const CMP_TIPO_COR = { reposicao: "azul", aplicacao_direta: "verde" };
/* fase 108b: método do item (enum tipo_estaca); o padrão vem do tipo de serviço da obra (fn_obras_tipos_servico) */
const CMP_METODO_LBL = { helice_continua: "Hélice contínua", escavada: "Escavada (trado)", raiz: "Estaca raiz", secante: "Hélice secante",
  hsa: "HSA", strauss: "Strauss", pre_moldada: "Pré-moldada", metalica: "Metálica", franki: "Franki", barrete: "Barrete", outro: "Outro" };
const CMP_METODO_POR_SERVICO = { helice_continua: "helice_continua", trado_mecanizado: "escavada", estaca_raiz: "raiz", helice_secante: "secante" };

/* = compras_pode_operar() no banco; lote S48 (#123): + gestor_manutencao (o Bruno; a fase 92c já o pôs no banco) */
function cmpPodeOperar(){
  return !!usuarioAtual && ["admin","diretor","comprador","almoxarife","gestor_acessorios","engenheiro","logistica","financeiro","mecanico","gestor_frota","gestor_manutencao"].includes(usuarioAtual.cargo);
}
function cmpForn(id){ const f = _cmpFornMap[id]; return f ? f.razao_social : ""; }
function cmpObra(id){ const o = _cmpObraMap[id]; return o ? `${o.codigo} — ${o.nome}` : ((typeof mapaObras === "object" && mapaObras && mapaObras[id]) || ""); }
function cmpEq(id){ const e = _cmpEqMap[id]; return e ? e.codigo + (e.nome ? " · " + e.nome : "") : ""; }
function cmpCentro(id){ const c = _cmpCentroMap[id]; return c ? `${CMP_CENTRO_TIPO[c.tipo] || c.tipo}: ${c.nome}` : ""; }
function cmpTag(st){ const o = CMP_STATUS[st] || {}; return `<span class="tag ${o.cor || "cinza"}">${esc(o.label || st)}</span>`; }
/* destino de um ITEM (pedido ou recebimento). O do pedido inteiro (lista, ordenação) é cmpDestinoPedidoTxt. */
function cmpDestinoTxt(it){
  if(it.destino === "obra") return "Obra: " + (cmpObra(it.obra_id) || "?");
  if(it.destino === "equipamento") return "TAG " + (cmpEq(it.equipamento_id) || "?");
  if(it.destino === "centro_custo") return cmpCentro(it.centro_custo_id) || "Centro de custo ?";
  if(!it.destino) return "— escolher —";
  return "Almoxarifado" + (it.centro_custo_id && cmpCentro(it.centro_custo_id) ? " · p/ " + _cmpCentroMap[it.centro_custo_id].nome : "");
}
function cmpDestinoValor(it){ return it.destino === "obra" ? "obra:" + (it.obra_id || "") : it.destino === "equipamento" ? "eq:" + (it.equipamento_id || "") : it.destino === "centro_custo" ? "cc:" + (it.centro_custo_id || "") : it.destino ? "estoque" : ""; }
/* ---------- lote S53 (#166): IPI por item ----------
   valor_total = round(q × unitário, 2) e valor_ipi = round(valor_total × ipi / 100, 2), como as colunas geradas do banco;
   o ICMS é só informativo. Total do pedido = itens + IPI + frete − desconto (fn_pedido_compra_total). */
function cmpItemBase(it){ return Math.round(Number(it.quantidade || 0) * Number(it.valor_unitario || 0) * 100) / 100; }
function cmpItemIpi(it){ return Math.round(cmpItemBase(it) * Number(it.ipi_percentual || 0)) / 100; }
function cmpItemTotal(it){ return Math.round((cmpItemBase(it) + cmpItemIpi(it)) * 100) / 100; }
function cmpSomaItens(itens){ return Math.round((itens || []).reduce((s, i) => s + cmpItemBase(i), 0) * 100) / 100; }
function cmpSomaIpi(itens){ return Math.round((itens || []).reduce((s, i) => s + cmpItemIpi(i), 0) * 100) / 100; }
function cmpPct(v){ return v === null || v === undefined || v === "" || !Number(v) ? "" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"; }
/* ---------- lote S53 (#149): rateio do item entre TAGs ----------
   it._rateio = [{ equipamento_id, fracao }] com 2+ TAGs (nulo = sem rateio), na ordem do código da TAG; it._rateioDirty
   marca o que vai à RPC pedido_item_rateio_definir depois do Salvar. O equipamento_id do item fica = primeira TAG. */
function cmpTemRateio(it){ return it.destino === "equipamento" && Array.isArray(it._rateio) && it._rateio.length >= 2; }
function cmpPctFracao(f){ return (Math.round(Number(f || 0) * 10000) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"; }
function cmpRateioTxt(it){ return cmpTemRateio(it) ? it._rateio.map(r => `TAG ${cmpEq(r.equipamento_id) || "?"} ${cmpPctFracao(r.fracao)}`).join(" · ") : ""; }
function cmpDestinoRateioHTML(it){ return cmpTemRateio(it) ? `<div class="meta" title="${esc(cmpRateioTxt(it))}">+ ${it._rateio.length - 1} TAG(s) (rateio)</div>` : ""; }
function cmpOrdenarRateio(lista){ return lista.sort((a, b) => (cmpEq(a.equipamento_id) || "").localeCompare(cmpEq(b.equipamento_id) || "", "pt-BR")); }
/* fase 108b: tipo de compra do item. _tipo = escolha na tela (rascunho); tipo_compra = coluna gerada do banco */
function cmpItemTipo(it){ return it._tipo || it.tipo_compra || (it.destino === "estoque" ? "reposicao" : "aplicacao_direta"); }
function cmpTipoTag(t){ return `<span class="tag ${CMP_TIPO_COR[t] || "cinza"}">${esc(CMP_TIPO_LBL[t] || t)}</span>`; }
/* "3 reposição · 2 aplicação direta" (chip da ficha) */
function cmpTipoResumo(itens){
  if(!itens || !itens.length) return "";
  const r = itens.filter(i => cmpItemTipo(i) === "reposicao").length, a = itens.length - r;
  return [r ? `${r} reposição` : "", a ? `${a} aplicação direta` : ""].filter(Boolean).join(" · ");
}
/* "reposição", "aplicação direta" ou "reposição + aplicação direta" (lista e cartão); itens null = pedido fechado */
function cmpTipoPedido(p){
  if(!p.itens || !p.itens.length) return "";
  return [...new Set(p.itens.map(cmpItemTipo))].sort((a, b) => (a === "reposicao" ? -1 : 1) - (b === "reposicao" ? -1 : 1)).map(t => CMP_TIPO_CURTO[t]).join(" + ");
}
/* o produto sugere: o do produto vence o da categoria; nulo = aplicação direta (produto_tipo_compra_padrao no banco) */
function cmpTipoPadraoProduto(p){ return (p && (p.tipo_compra_padrao || p.categoria?.tipo_compra_padrao)) || "aplicacao_direta"; }
const CMP_SEM_DESTINO = { destino: null, obra_id: null, equipamento_id: null, centro_custo_id: null };
function cmpDestinoDiretoDoValor(v){ return v ? cmpDestinoDoValor(v) : { ...CMP_SEM_DESTINO }; }
/* natureza do gasto */
function cmpNatRotulo(n){ return n ? (n.codigo ? n.codigo + " · " : "") + n.nome : ""; }
function cmpNatTxt(it){ return cmpNatRotulo(_cmpNatMap[it.natureza_id]) || it.natureza || ""; }
function cmpNatOptions(sel){
  const lst = _cmpNaturezas.filter(n => n.ativo || n.id === sel);
  return `<option value="">— natureza —</option>` + lst.map(n => `<option value="${esc(n.id)}"${n.id === sel ? " selected" : ""}>${esc(cmpNatRotulo(n))}${n.ativo ? "" : " (inativa)"}</option>`).join("");
}
/* padrão da natureza: a única ativa marcada com o tipo (ESTOQUE ALMOXARIFADO para reposição); senão, na aplicação
   direta, a única da categoria de custo do item; senão vazio (o comprador escolhe) */
function cmpNatPadrao(tipo, catCusto){
  const ativos = _cmpNaturezas.filter(n => n.ativo);
  const porTipo = ativos.filter(n => n.tipo_compra_padrao === tipo);
  if(porTipo.length === 1) return porTipo[0].id;
  if(tipo === "aplicacao_direta" && catCusto){
    const porCat = ativos.filter(n => n.categoria_custo === catCusto && n.tipo_compra_padrao !== "reposicao");
    if(porCat.length === 1) return porCat[0].id;
  }
  return null;
}
function cmpMetodoOptions(sel){ return `<option value="">— método —</option>` + Object.entries(CMP_METODO_LBL).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join(""); }
/* método padrão da obra: o tipo de serviço dela (RDO, estacas, mobilização); só quando há um tipo só */
async function cmpMetodoDaObra(obraId){
  if(!obraId) return null;
  if(Object.prototype.hasOwnProperty.call(_cmpObraMetodo, obraId)) return _cmpObraMetodo[obraId];
  const { data, error } = await sb.rpc("fn_obras_tipos_servico", { p_obra_ids: [obraId] });
  const tipos = (!error && Array.isArray(data) && data[0] && Array.isArray(data[0].tipos)) ? data[0].tipos : [];
  _cmpObraMetodo[obraId] = tipos.length === 1 ? (CMP_METODO_POR_SERVICO[tipos[0]] || null) : null;
  return _cmpObraMetodo[obraId];
}
/* aplica o método padrão no item que ainda não teve método escolhido à mão (_metAuto) */
async function cmpAplicarMetodoPadrao(it){
  if(!it || it._metAuto === false) return;
  const m = it.destino === "obra" ? await cmpMetodoDaObra(it.obra_id) : null;
  if(it._metAuto === false || (it.metodo || null) === m) return;
  it.metodo = m; it._metAuto = true;
  if(_cmpItens.includes(it)) renderItensPedido();
}
function cmpDestinoDoValor(v){
  if(v.startsWith("obra:")) return { destino: "obra", obra_id: v.slice(5) || null, equipamento_id: null, centro_custo_id: null };
  if(v.startsWith("eq:")) return { destino: "equipamento", obra_id: null, equipamento_id: v.slice(3) || null, centro_custo_id: null };
  if(v.startsWith("cc:")) return { destino: "centro_custo", obra_id: null, equipamento_id: null, centro_custo_id: v.slice(3) || null };
  return { destino: "estoque", obra_id: null, equipamento_id: null, centro_custo_id: null };
}
function cmpCentroOptions(ph, soAtivos){
  const lst = _cmpCentros.filter(c => !soAtivos || c.ativo);
  const grupo = t => lst.filter(c => c.tipo === t).map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.ativo ? "" : " (inativo)"}</option>`).join("");
  return `<option value="">${ph}</option><optgroup label="Setores">${grupo("setor")}</optgroup><optgroup label="Obras internas">${grupo("obra_interna")}</optgroup>`;
}
/* lote S54 (#171): obras abertas num optgroup + "Concluídas" no fim (NF que chega depois do fim da obra tem onde cair;
   pedido antigo cuja obra foi concluída não perde o destino ao ser editado). Canceladas ficam fora. val(o) = valor da
   option, rot(o) = rótulo; sel = valor selecionado. Requisição nova (req-obra) e Contratos continuam em _cmpObras. */
function cmpObraOptgroups(sel, val, rot, rotuloAbertas){
  const op = (o, conc) => `<option value="${esc(val(o))}"${sel === val(o) ? " selected" : ""}>${esc(rot(o))}${conc ? " · concluída" : ""}</option>`;
  return `<optgroup label="${esc(rotuloAbertas || "Obras")}">${_cmpObras.map(o => op(o, false)).join("")}</optgroup>`
    + (_cmpObrasConcluidas.length ? `<optgroup label="Concluídas">${_cmpObrasConcluidas.map(o => op(o, true)).join("")}</optgroup>` : "");
}
function cmpDestinoOptions(sel){
  const obras = cmpObraOptgroups(sel, o => "obra:" + o.id, o => `Obra: ${o.codigo} — ${o.nome}`, "Aplicação direta na obra");
  const eqs = _cmpEquips.map(e => `<option value="eq:${e.id}"${sel === "eq:" + e.id ? " selected" : ""}>TAG ${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
  const centros = _cmpCentros.filter(c => c.ativo || sel === "cc:" + c.id).map(c => `<option value="cc:${c.id}"${sel === "cc:" + c.id ? " selected" : ""}>${esc(CMP_CENTRO_TIPO[c.tipo] || "")}: ${esc(c.nome)}</option>`).join("");
  return `<option value="estoque"${sel === "estoque" ? " selected" : ""}>Reposição de estoque (almoxarifado)</option>${obras}<optgroup label="Aplicação direta na TAG">${eqs}</optgroup><optgroup label="Aplicação direta no setor / obra interna">${centros}</optgroup>`;
}
/* fase 108b: destino de item de aplicação direta (sem a opção do estoque; vazio = falta escolher) */
function cmpDestinoDiretoOptions(sel){
  const obras = cmpObraOptgroups(sel, o => "obra:" + o.id, o => `${o.codigo} — ${o.nome}`, "Obra");
  const eqs = _cmpEquips.map(e => `<option value="eq:${e.id}"${sel === "eq:" + e.id ? " selected" : ""}>TAG ${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
  const centros = _cmpCentros.filter(c => c.ativo || sel === "cc:" + c.id).map(c => `<option value="cc:${c.id}"${sel === "cc:" + c.id ? " selected" : ""}>${esc(CMP_CENTRO_TIPO[c.tipo] || "")}: ${esc(c.nome)}</option>`).join("");
  return `<option value=""${sel ? "" : " selected"}>— obra, TAG ou centro —</option>${obras}<optgroup label="TAG">${eqs}</optgroup><optgroup label="Setor / obra interna">${centros}</optgroup>`;
}
function cmpCatOptions(sel){ return Object.entries(CMP_CAT_LBL).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join(""); }
/* ---------- lote S54 (#170): unidade na linha do pedido ----------
   Select com as UNIDADES de core.js (catálogo e item livre), a unidade do produto como padrão e "≠" quando a linha difere
   dela; valor fora da lista continua como "(antiga)"; a última opção abre um chamado pedindo a unidade nova (o enum
   unidade_medida só ganha valor por migration própria). Tudo a jusante (recebimento, PDF, XML) segue a unidade da linha. */
function cmpUnidadeOptions(atual){
  const lista = typeof UNIDADES !== "undefined" ? UNIDADES : ["un"];
  const cur = String(atual || "un").trim();
  return lista.map(u => `<option value="${esc(u)}"${u === cur ? " selected" : ""}>${esc(u)}</option>`).join("")
    + (cur && !lista.includes(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)} (antiga)</option>` : "")
    + `<option value="__outra">— outra unidade (pedir cadastro) —</option>`;
}
function cmpUnidadeCelula(it, ed){
  const un = it.unidade || "un", padrao = it.produto_id ? (_cmpProdUn[it.produto_id] || null) : null;
  const difere = padrao && padrao !== un;
  const marca = difere ? ` <span class="meta" title="Cadastro do produto: ${esc(padrao)}">≠</span>` : "";
  if(!ed) return esc(un) + marca;
  return `<select class="cmp-it" data-f="unidade" style="width:74px;"${padrao ? ` title="Cadastro do produto: ${esc(padrao)}"` : ""}>${cmpUnidadeOptions(un)}</select>${marca}`;
}
function cmpPedirUnidadeNova(it){
  const rotulo = String(it.descricao || "item do pedido").trim().slice(0, 80);
  if(typeof abrirNovoChamado !== "function"){ aviso("app-aviso", "Abra um chamado em Chamados pedindo a unidade nova.", "aviso"); return; }
  abrirNovoChamado({ modulo: "compras", modulo_label: "Compras", registro_tipo: "unidade de medida", registro_label: rotulo });
  const t = $("chamn-titulo"), d = $("chamn-descricao");
  if(t) t.value = `Unidade de medida nova para: ${rotulo}`;
  if(d) d.value = `Unidade pedida: (escreva aqui, ex.: "ton", "m³")\nItem: ${rotulo}${_cmpAtual?.numero ? ` · pedido ${_cmpAtual.numero}` : ""}.\n\nDica: a unidade entra no catálogo por migration (enum unidade_medida) e na lista do app; até lá a linha fica com a unidade anterior.`;
}
function cmpAlcadaTxt(){ return _cmpAlcada === null ? "sem limite" : _cmpAlcada < 0 ? "sem alçada de aprovação" : "até " + brl(_cmpAlcada); }
/* fase 78: item de serviço (recebido com evidência, nunca no estoque); mesma regra de compras_categoria_servico() */
const CMP_CAT_SERVICO = ["servico_terceiro", "locacao", "frete"];
const CMP_REC_TIPO = { servico: ["serviço", "azul"], compra_direta: ["compra direta", "verde"] };
function cmpItemServico(it){ return CMP_CAT_SERVICO.includes(it.categoria_custo); }
function cmpSrvAtraso(p){ const r = _cmpParaReceber[p.id]; return !!r && r.tem_servico && !r.tem_evidencia && Number(r.dias_desde_envio || 0) > 7; }
/* anexos do recebimento (bucket privado compras-evidencias, caminho <recebimento>/<arquivo>); MIME pela extensão */
const CMP_ANEXO_MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
  xml: "application/xml", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", txt: "text/plain" };
async function cmpEnviarAnexos(recId, files){
  const out = [];
  for(const f of files){
    const ext = (f.name.split(".").pop() || "").toLowerCase(), mime = CMP_ANEXO_MIME[ext];
    if(!mime){ await cmpRemoverAnexos(out); throw new Error(`"${f.name}": tipo não aceito. Use PDF, foto (JPG, PNG, WEBP, HEIC), Word ou Excel.`); }
    if(f.size > 20 * 1024 * 1024){ await cmpRemoverAnexos(out); throw new Error(`"${f.name}" passa de 20 MB.`); }
    const nome = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
    const caminho = `${recId}/${Date.now()}_${out.length}_${nome}`;
    // supabase-js ignora contentType quando o corpo é File: reembala com o MIME da extensão
    const corpo = f.type === mime ? f : new Blob([f], { type: mime });
    const { error } = await sb.storage.from("compras-evidencias").upload(caminho, corpo, { cacheControl: "3600", contentType: mime, upsert: false });
    if(error){ await cmpRemoverAnexos(out); throw new Error(`Falha ao enviar "${f.name}": ${error.message}`); }
    out.push({ nome: f.name, storage_path: caminho, mime_type: mime, tamanho: f.size });
  }
  return out;
}
async function cmpRemoverAnexos(lista){ if(lista && lista.length) await sb.storage.from("compras-evidencias").remove(lista.map(a => a.storage_path)); }
async function cmpAbrirAnexo(caminho, nome){
  const { data, error } = await sb.storage.from("compras-evidencias").createSignedUrl(caminho, 120, { download: nome || true });
  if(error || !data?.signedUrl){ aviso("app-aviso", "Não foi possível abrir o anexo" + (error ? ": " + error.message : "."), "erro"); return; }
  window.open(data.signedUrl, "_blank");
}

/* ---------- anexos do pedido (lote S48, chamado #117) ----------
   Tabela pedido_compra_anexos + bucket compras-evidencias (pedidos/<pedido>/<arquivo>). Escrita = cmpPodeOperar();
   boleto, NF e fatura só para quem lê contas a pagar (pode_ler_contas_pagar() no banco: admin, financeiro, comprador,
   auditor e diretor), que também são os únicos que enviam esses tipos. A linha entra antes do arquivo: o arquivo do
   pedido só abre para quem enxerga a linha (policy do storage), então upload sem linha viraria arquivo órfão. */
const CMP_ANX_TIPO = { boleto: ["Boleto", "ambar"], nf: ["Nota fiscal", "azul"], fatura: ["Fatura", "ambar"], orcamento: ["Orçamento", "verde"], outro: ["Outro", "cinza"] };
const CMP_ANX_FINANCEIRO = ["boleto", "nf", "fatura"];
let _cmpAnexos = [];
function cmpPodeAnexoFinanceiro(){ return !!usuarioAtual && ["diretor", "admin", "financeiro", "comprador", "auditor"].includes(usuarioAtual.cargo); }
function cmpAnxPodeExcluir(a){ return !!usuarioAtual && (["diretor", "admin"].includes(usuarioAtual.cargo) || (a.enviado_por === usuarioAtual.id && cmpPodeOperar())); }
function cmpAnxPreparar(novo){
  const pode = cmpPodeOperar() && !novo && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
  $("cmp-anx-envio").style.display = pode ? "" : "none";
  const fin = cmpPodeAnexoFinanceiro();
  $("cmp-anx-tipo").innerHTML = Object.entries(CMP_ANX_TIPO).filter(([k]) => fin || !CMP_ANX_FINANCEIRO.includes(k))
    .map(([k, v]) => `<option value="${k}"${k === (fin ? "boleto" : "orcamento") ? " selected" : ""}>${esc(v[0])}</option>`).join("");
  $("cmp-anx-regra").textContent = fin ? "Boleto, nota fiscal e fatura ficam visíveis só para quem acessa Contas a pagar; orçamento e outro, para quem acessa Compras."
    : "Seu perfil anexa orçamento e outros documentos. Boleto, nota fiscal e fatura são do comprador e do financeiro.";
  $("cmp-anx-arquivo").value = "";
  _cmpAnexos = [];
  $("cmp-anx-lista").innerHTML = `<p class="vazio">${novo ? "Salve o pedido para anexar documentos." : "Carregando…"}</p>`;
}
async function cmpCarregarAnexosPedido(id){
  const { data, error } = await sb.from("pedido_compra_anexos").select("id,tipo,nome,storage_path,mime_type,tamanho,enviado_por,created_at,enviado:profiles(nome)").eq("pedido_id", id).order("created_at", { ascending: false });
  if(_cmpEditId !== id) return;
  const b = $("sb-cmp-anexos");
  if(error){
    // antes da migration 20261022_loteS48_b a tabela não existe: a aba avisa e o resto da ficha segue normal
    console.warn("pedido_compra_anexos:", error.message);
    _cmpAnexos = [];
    if(b){ b.querySelector(".sb-num").textContent = 0; b.classList.add("zero"); }
    $("cmp-anx-envio").style.display = "none";
    $("cmp-anx-lista").innerHTML = `<p class="vazio">Anexos do pedido ainda não disponíveis.</p>`;
    return;
  }
  _cmpAnexos = data || [];
  if(b){ b.querySelector(".sb-num").textContent = _cmpAnexos.length; b.classList.toggle("zero", !_cmpAnexos.length); }
  cmpRenderAnexosPedido();
}
function cmpRenderAnexosPedido(){
  const cont = $("cmp-anx-lista"); if(!cont) return;
  if(!_cmpAnexos.length){ cont.innerHTML = `<p class="vazio">Nenhum anexo${cmpPodeAnexoFinanceiro() ? "" : " visível para o seu perfil"}.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Tipo</th><th>Arquivo</th><th>Tamanho</th><th>Enviado por</th><th>Em</th><th class="col-acao"></th></tr></thead><tbody>${
    _cmpAnexos.map(a => { const t = CMP_ANX_TIPO[a.tipo] || [a.tipo, "cinza"]; return `<tr data-id="${esc(a.id)}">
      <td><span class="tag ${t[1]}">${esc(t[0])}</span></td>
      <td>${(a.mime_type || "").startsWith("image/") ? "🖼️" : "📄"} ${esc(a.nome)}</td>
      <td class="meta">${a.tamanho ? Math.max(1, Math.round(Number(a.tamanho) / 1024)) + " KB" : "—"}</td>
      <td class="meta">${esc(a.enviado?.nome || "—")}</td>
      <td class="meta">${dataBR(String(a.created_at || "").slice(0, 10))}</td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm cmp-anx-baixar" title="Baixar">⬇️</button>${cmpAnxPodeExcluir(a) ? ` <button type="button" class="btn-sec btn-sm txt-perigo cmp-anx-excluir" title="Excluir">🗑️</button>` : ""}</td></tr>`; }).join("")
  }</tbody></table></div>`;
  cont.querySelectorAll(".cmp-anx-baixar").forEach(b => b.addEventListener("click", () => { const a = _cmpAnexos.find(x => x.id === b.closest("tr").dataset.id); if(a) cmpAbrirAnexo(a.storage_path, a.nome); }));
  cont.querySelectorAll(".cmp-anx-excluir").forEach(b => b.addEventListener("click", () => cmpExcluirAnexoPedido(b.closest("tr").dataset.id)));
}
async function cmpEnviarAnexosPedido(){
  const pedidoId = _cmpEditId; if(!pedidoId || !cmpPodeOperar()) return;
  const files = [...($("cmp-anx-arquivo").files || [])];
  if(!files.length){ aviso("app-aviso", "Escolha o arquivo.", "erro"); return; }
  const tipo = $("cmp-anx-tipo").value || "outro";
  if(CMP_ANX_FINANCEIRO.includes(tipo) && !cmpPodeAnexoFinanceiro()){ aviso("app-aviso", "Boleto, nota fiscal e fatura são anexados pelo comprador ou pelo financeiro.", "erro"); return; }
  let n = 0;
  for(const [i, f] of files.entries()){
    const ext = (f.name.split(".").pop() || "").toLowerCase(), mime = CMP_ANEXO_MIME[ext];
    if(!mime){ aviso("app-aviso", `"${f.name}": tipo não aceito. Use PDF, foto (JPG, PNG, WEBP, HEIC), XML, Word ou Excel.`, "erro"); break; }
    if(f.size > 20 * 1024 * 1024){ aviso("app-aviso", `"${f.name}" passa de 20 MB.`, "erro"); break; }
    const nome = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
    const caminho = `pedidos/${pedidoId}/${Date.now()}_${i}_${nome}`;
    const { data: lin, error: eIns } = await sb.from("pedido_compra_anexos")
      .insert({ pedido_id: pedidoId, tipo, nome: f.name, storage_path: caminho, mime_type: mime, tamanho: f.size, enviado_por: usuarioAtual.id }).select("id").single();
    if(eIns){ aviso("app-aviso", `Não foi possível anexar "${f.name}": ${eIns.message}`, "erro"); break; }
    // supabase-js ignora contentType quando o corpo é File: reembala com o MIME da extensão
    const corpo = f.type === mime ? f : new Blob([f], { type: mime });
    const { error: eUp } = await sb.storage.from("compras-evidencias").upload(caminho, corpo, { cacheControl: "3600", contentType: mime, upsert: false });
    if(eUp){ await sb.from("pedido_compra_anexos").delete().eq("id", lin.id); aviso("app-aviso", `Falha ao enviar "${f.name}": ${eUp.message}`, "erro"); break; }
    n++;
  }
  if(n){ aviso("app-aviso", `${n} anexo(s) enviado(s).`, "ok"); $("cmp-anx-arquivo").value = ""; }
  await cmpCarregarAnexosPedido(pedidoId);
}
async function cmpExcluirAnexoPedido(id){
  const a = _cmpAnexos.find(x => x.id === id); if(!a || !cmpAnxPodeExcluir(a)) return;
  if(!confirm(`Excluir o anexo "${a.nome}"?`)) return;
  // arquivo antes da linha: depois de apagar a linha o arquivo do pedido deixa de ser visível (e não sairia do bucket)
  const { error: eSt } = await sb.storage.from("compras-evidencias").remove([a.storage_path]);
  if(eSt){ aviso("app-aviso", "Não foi possível excluir o arquivo: " + eSt.message, "erro"); return; }
  const { error } = await sb.from("pedido_compra_anexos").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Arquivo removido, mas o registro não: " + error.message, "erro"); }
  else aviso("app-aviso", "Anexo excluído.", "ok");
  await cmpCarregarAnexosPedido(_cmpEditId);
}

/* ---------- carga ---------- */
/* Cadastros de apoio (fornecedores, obras, TAGs, alçada): painel, ficha, modal de custo avulso e
   também o módulo Contas a pagar (fase 55) usam daqui. */
async function cmpCarregarBase(force){
  if(!force && _cmpCarregado) return;
  // fase 108b: o link da Sala de Comando e o clique no menu podem chamar ao mesmo tempo: uma carga só
  if(!force && _cmpBasePromessa) return _cmpBasePromessa;
  const p = cmpCarregarBaseAgora();
  _cmpBasePromessa = p;
  try { await p; } finally { if(_cmpBasePromessa === p) _cmpBasePromessa = null; }
}
async function cmpCarregarBaseAgora(){
  {
    const [fo, ob, eq, al, cc, pf, nat] = await Promise.all([
      sb.from("fornecedores").select("id,razao_social,nome_fantasia,cpf_cnpj,email,telefone,cidade,uf,condicao_pagamento_padrao,prazo_entrega_dias").eq("ativo", true).order("razao_social"),
      sb.from("obras").select("id,codigo,nome,status").neq("status", "cancelada").order("codigo", { ascending: false }),   // lote S54 (#171): concluídas entram (grupo próprio nos selects)
      sb.from("equipamentos").select("id,codigo,nome,tipo").eq("ativo", true).order("codigo"),
      sb.rpc("compras_alcada_usuario"),
      sb.from("centros_custo").select("id,codigo,nome,tipo,ativo").order("tipo", { ascending: false }).order("nome"),
      sb.from("profiles").select("id,nome,cargo").eq("ativo", true).order("nome"),   // fase 78
      sb.from("naturezas_custo").select("id,codigo,nome,categoria_custo,tipo_compra_padrao,odoo_nome,ativo,ordem").order("ordem").order("nome")   // fase 108b
    ]);
    // fase 108b: sem leitura de naturezas_custo (dono do custo fora de Compras) a lista fica vazia e a tela mostra o texto do Odoo
    _cmpNaturezas = nat.error ? [] : (nat.data || []); _cmpNatMap = {}; _cmpNaturezas.forEach(n => _cmpNatMap[n.id] = n);
    _cmpPerfis = pf.data || [];
    _cmpCentros = cc.data || []; _cmpCentroMap = {}; _cmpCentros.forEach(c => _cmpCentroMap[c.id] = c);
    _cmpForns = fo.data || []; _cmpFornMap = {}; _cmpForns.forEach(f => _cmpFornMap[f.id] = f);
    const todasObras = ob.data || [];
    _cmpObras = todasObras.filter(o => o.status !== "concluida"); _cmpObrasConcluidas = todasObras.filter(o => o.status === "concluida");
    _cmpObraMap = {}; todasObras.forEach(o => _cmpObraMap[o.id] = o);
    _cmpEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
    _cmpEqMap = {}; _cmpEquips.forEach(e => _cmpEqMap[e.id] = e);
    _cmpAlcada = al.error ? -1 : (al.data === null || al.data === undefined ? null : Number(al.data));
    cmpPreencherSelectsFixos();
    _cmpCarregado = true;
  }
}
async function carregarCompras(force){
  const cont = $("cmp-conteudo"); if(!cont) return;
  if(force || !_cmpCarregado){ cont.innerHTML = `<p class="vazio">Carregando compras…</p>`; cmpKpisCarregando(true); }
  // lote S45 (L2): os indicadores (vw_compras_kpis, uma linha) saem já, em paralelo com os cadastros de apoio; antes só
  // eram pedidos depois de cmpCarregarBase (641 fornecedores, obras, TAGs, perfis…) e chegavam em ~3,8 s em vez de < 1 s.
  // Não dependem do período: a troca de período (cmpFetchPedidos) não os refaz; "Atualizar" (force) sim.
  const pKpis = cmpCarregarKpis();
  await cmpCarregarBase(force);
  const pode = cmpPodeOperar();
  ["btn-cmp-novo","btn-cmp-receber-avulso","btn-cmp-compra-direta"].forEach(id => { const b = $(id); if(b) b.style.display = pode ? "" : "none"; });
  if($("btn-cmp-req-nova")) $("btn-cmp-req-nova").style.display = (typeof reqPodePedir === "function" && reqPodePedir()) ? "" : "none"; // fase 60
  if($("cmp-view-naturezas")) $("cmp-view-naturezas").style.display = cmpPodeVerNaturezas() ? "" : "none";   // fase 108b
  // fase 102: quem não opera Compras (encarregado, operador, assistente de engenharia) não lê pedidos; abre uma vez
  // direto nas requisições, que é onde ele pede e confere o que chegou (o atalho da Sala de Comando já escolhe a visão)
  if(!_cmpViewInicial){
    _cmpViewInicial = true;
    if(!pode && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()) && _cmpView === "kanban"){
      _cmpView = "requisicoes";
      if(typeof _reqFiltroSt !== "undefined") _reqFiltroSt = "";
    }
  }
  await cmpFetchPedidos();   // lote S43: 1ª carga renderizada, resto em segundo plano
  await pKpis;
  cmpCarregarSync();   // fase 81
}
/* lote S43 (L2): enquanto a view não respondeu, os sete indicadores mostram "…" e as visões ficam travadas */
function cmpKpisCarregando(on){
  document.querySelectorAll("#cmp-painel .ind").forEach(el => { el.classList.toggle("carregando", on); if(on){ const n = el.querySelector(".num"); if(n) n.textContent = "…"; } });
  document.querySelectorAll("#cmp-views .serv-view-btn").forEach(b => b.disabled = on);
}
async function cmpCarregarKpis(){
  // fase 102: os cartões da sequência do Fabrício vêm de vw_compras_etapas (etapa × setor × mês, somados aqui);
  // vw_compras_kpis continua para "seus para receber" e para a tela antiga se a view nova não existir
  const [k, e] = await Promise.all([
    sb.from("vw_compras_kpis").select("*").maybeSingle(),
    cmpLerEtapas()
  ]);
  if(k.error) console.warn("vw_compras_kpis:", k.error.message);
  _cmpKpis = (!k.error && k.data) ? k.data : null;
  _cmpEtapasResumo = e;
  cmpRenderKpis();
}
async function cmpLerEtapas(){
  const linhas = [];
  for(let de = 0; linhas.length === de; de += 1000){
    const r = await sb.from("vw_compras_etapas").select("etapa,quantidade,valor,atrasados,conferencias_vencidas").range(de, de + 999);
    if(r.error){ console.warn("vw_compras_etapas:", r.error.message); return null; }
    linhas.push(...(r.data || []));
  }
  const res = {};
  linhas.forEach(l => {
    const o = res[l.etapa] = res[l.etapa] || { q: 0, v: null, atr: 0, cv: 0 };
    o.q += Number(l.quantidade || 0); o.atr += Number(l.atrasados || 0); o.cv += Number(l.conferencias_vencidas || 0);
    if(l.valor !== null && l.valor !== undefined) o.v = (o.v || 0) + Number(l.valor);
  });
  return res;
}
/* fase 81: última sincronização com o Odoo (scripts/importar-odoo-compras.js sincronizar, todo dia às 05:30).
   Lote S43 (L3): lê a ÚLTIMA LINHA POR ETAPA (vw_odoo_sync_ultima) em vez das 12 últimas linhas, que
   chamavam de rodada tudo até 3 h da última: tentativa antiga já refeita pintava "erro em reparos" e uma
   rodada manual só de fotos pintava verde com pedidos parados.
   - "sincronizado às" = fim da última rodada de `pedidos` sem erro;
   - vermelho quando a última linha de pedidos, fornecedores, catalogo, precos ou estoque falhou (erro, ou
     começou há mais de 1 h sem terminar) ou quando pedidos não sincroniza há mais de 36 h;
   - fotos e reparos não contam nem para o verde nem para o vermelho;
   - idade de estoque não pinta: a rodada manual com --sem-estoque (decisão do Bernardo em 19/10) é de propósito. */
const CMP_SYNC_ETAPAS = ["pedidos", "fornecedores", "catalogo", "precos", "estoque"];
async function cmpCarregarSync(){
  const el = $("cmp-odoo-sync"); if(!el) return;
  const [ult, boa] = await Promise.all([
    sb.from("vw_odoo_sync_ultima").select("etapa,inicio,fim,criados,alterados,erro").in("etapa", CMP_SYNC_ETAPAS),
    sb.from("odoo_sync").select("fim").eq("etapa", "pedidos").is("erro", null).not("fim", "is", null).order("fim", { ascending: false }).limit(1).maybeSingle()
  ]);
  if(ult.error || !ult.data || !ult.data.length){ el.style.display = "none"; return; }
  const por = {}; ult.data.forEach(r => por[r.etapa] = r);
  const falhou = r => !!r.erro || (!r.fim && Date.now() - new Date(r.inicio).getTime() > 3600e3);
  const comErro = CMP_SYNC_ETAPAS.map(e => por[e]).filter(r => r && falhou(r));
  const fimBoa = boa.data?.fim ? new Date(boa.data.fim) : null;
  const velha = !fimBoa || Date.now() - fimBoa.getTime() > 36 * 3600e3;
  const hh = fimBoa ? fimBoa.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "", dd = fimBoa ? fimBoa.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
  // o que a última rodada boa trouxe: etapas sem erro terminadas até 3 h dela
  const daRodada = e => { const r = por[e]; return r && !falhou(r) && r.fim && fimBoa && Math.abs(new Date(r.fim).getTime() - fimBoa.getTime()) < 3 * 3600e3 ? r : null; };
  const partes = [];
  if(daRodada("pedidos")) partes.push(`${daRodada("pedidos").criados} pedido(s) novo(s)`);
  if(daRodada("fornecedores")) partes.push(`${daRodada("fornecedores").criados} fornecedor(es) novo(s)`);
  if(daRodada("catalogo")) partes.push(`${daRodada("catalogo").criados} produto(s) novo(s)`);
  if(daRodada("estoque")) partes.push(`estoque ajustado em ${daRodada("estoque").criados} item(ns)`);
  const ruim = velha || comErro.length > 0;
  const motivo = comErro.length
    ? `<strong class="txt-perigo">erro em ${esc(comErro.map(r => r.etapa).join(", "))}</strong>${comErro[0].erro ? ` <span title="${esc(comErro[0].erro)}">(${esc(String(comErro[0].erro).slice(0, 80))})</span>` : " (interrompida)"}`
    : `<span title="a tarefa agendada CGL Odoo sync não rodou; até o corte do Odoo a rodada é manual">tarefa parada</span>`;
  el.innerHTML = `<span class="tag ${ruim ? "vermelho" : "verde"}">Odoo</span> `
    + (ruim
      ? `<strong class="txt-perigo">sem sincronizar${fimBoa ? ` desde ${dd} ${hh}` : " (nenhuma rodada de pedidos concluída)"}</strong> · ${motivo}`
      : `sincronizado às ${hh} de ${dd}`)
    + (partes.length ? " · " + esc(partes.join(" · ")) : "");
  el.style.display = "";
}
/* Fase 65: sem teto de 1000 (os pedidos do Odoo passam disso). Carrega em páginas o período escolhido
   (padrão: últimos 90 dias); pedido em aberto entra sempre, para os indicadores ficarem certos.
   Lote S43 (L2): a tela abria com "—" por ~10 s porque baixava os 1.215 pedidos inteiros e os 3.380
   itens antes de qualquer render. Agora: (1) indicadores pela view vw_compras_kpis; (2) 1ª carga =
   pedidos em aberto + últimos 30 dias, só as colunas do painel, já renderizada; (3) o resto do período
   chega em segundo plano e completa a lista; (4) itens só dos pedidos em aberto (recebimento parcial e
   destino por item precisam deles); a busca por descrição de item consulta o servidor (cmpBuscar). */
async function cmpFetchPaginas(filtro){
  const todos = [];
  for(let de = 0; todos.length === de; de += 1000){
    let q = sb.from("pedidos_compra").select(CMP_COLS + ", fornecedor:fornecedores(razao_social)")
      .order("data_pedido", { ascending: false }).order("created_at", { ascending: false }).order("id").range(de, de + 999);
    q = filtro(q);
    const pg = await q;
    if(pg.error) return pg;
    todos.push(...(pg.data || []));
  }
  return { data: todos };
}
/* itens vêm numa consulta à parte e são juntados aqui: embutir itens no pedido (junção por pedido sob RLS)
   custava ~1 s por página de 1000 */
async function cmpFetchItens(ids){
  const lotes = [];
  for(let i = 0; i < ids.length; i += 120) lotes.push(ids.slice(i, i + 120));
  const res = await Promise.all(lotes.map(async lote => {
    const out = [];
    for(let de = 0; out.length === de; de += 1000){
      const r = await sb.from("pedido_compra_itens").select("id,pedido_id,descricao,quantidade,quantidade_recebida,destino,obra_id,equipamento_id").in("pedido_id", lote).order("id").range(de, de + 999);   // fase 108b: destino = tipo na lista
      if(r.error) return r;
      out.push(...(r.data || []));
    }
    return { data: out };
  }));
  const erro = res.find(r => r.error);
  return erro || { data: res.flatMap(r => r.data) };
}
function cmpOrdenar(lista){
  const k = p => `${p.data_pedido || ""}|${p.created_at || ""}`;
  return lista.sort((a, b) => (k(a) < k(b) ? 1 : k(a) > k(b) ? -1 : 0));
}
async function cmpFetchPedidos(){
  const token = ++_cmpCarga;
  const dias = Number($("cmp-f-periodo")?.value || 0);
  const corte = dias ? dataLocalISO(new Date(Date.now() - dias * 864e5)) : null;
  const corte1 = dataLocalISO(new Date(Date.now() - CMP_PRIMEIRA_CARGA_DIAS * 864e5));
  const abertosIn = `status.in.(${CMP_ABERTOS.join(",")})`;
  _cmpCompleto = false;
  // 1ª carga: em aberto + últimos 30 dias
  const [prim] = await Promise.all([
    cmpFetchPaginas(q => q.or(`data_pedido.gte.${corte1},${abertosIn}`)),
    cmpFetchEtapaEsp()   // fase 102
  ]);
  if(token !== _cmpCarga) return;
  if(prim.error){ aviso("app-aviso", "Erro ao carregar pedidos: " + prim.error.message, "erro"); return; }
  const porId = {}; prim.data.forEach(p => { p.itens = null; porId[p.id] = p; });   // null = itens não carregados
  // fase 102: pedido recebido que espera a conferência ou o financeiro entra sempre, como os abertos
  const faltam = Object.keys(_cmpEtapaEsp).filter(id => !porId[id] && CMP_ETAPAS_ABERTAS.includes(_cmpEtapaEsp[id].etapa));
  for(let i = 0; i < faltam.length; i += 100){
    const r = await cmpFetchPaginas(q => q.in("id", faltam.slice(i, i + 100)));
    if(token !== _cmpCarga) return;
    if(!r.error) r.data.forEach(p => { if(!porId[p.id]){ p.itens = null; porId[p.id] = p; prim.data.push(p); } });
  }
  const abertos = prim.data.filter(p => CMP_ABERTOS.includes(p.status));
  const [it, pr, ap, nfs] = await Promise.all([
    cmpFetchItens(abertos.map(p => p.id)),
    cmpFetchNfs(prim.data.map(p => p.id)),   // lote S52 (#162): NFs dos recebimentos da 1ª carga (abertos + 30 dias)
    sb.from("vw_compras_para_receber").select("pedido_id,responsavel_recebimento_id,responsavel_nome,dias_desde_envio,tem_servico,tem_evidencia"),   // fase 78
    sb.from("vw_pedidos_aprovacao_pendente").select("pedido_id,chave,destino_tipo,destino_rotulo,quem_assina,eu_assino,dono_meu")   // fase 108b
  ]);
  if(token !== _cmpCarga) return;
  if(it.error){ aviso("app-aviso", "Erro ao carregar itens dos pedidos: " + it.error.message, "erro"); return; }
  abertos.forEach(p => { p.itens = []; });
  it.data.forEach(i => { const p = porId[i.pedido_id]; if(p) p.itens.push(i); });
  _cmpNfs = nfs;
  _cmpParaReceber = {}; (pr.data || []).forEach(r => _cmpParaReceber[r.pedido_id] = r);
  if(ap.error) console.warn("vw_pedidos_aprovacao_pendente:", ap.error.message);
  _cmpAprovPend = {}; (ap.data || []).forEach(a => (_cmpAprovPend[a.pedido_id] = _cmpAprovPend[a.pedido_id] || []).push(a));
  prim.data.forEach(p => { const r = _cmpParaReceber[p.id]; if(r) p._responsavel = r.responsavel_nome; });
  _cmpPedidos = cmpOrdenar(prim.data);
  const temResto = !dias || dias > CMP_PRIMEIRA_CARGA_DIAS;
  _cmpCompleto = !temResto;
  renderCompras();
  document.querySelectorAll("#cmp-views .serv-view-btn").forEach(b => b.disabled = false);
  // 2ª carga em segundo plano (sem await: quem chamou segue; a lista se completa quando chegar)
  if(temResto) cmpFetchResto(token, corte, corte1, porId);
}
/* fase 102: etapa calculada dos pedidos em que o status não basta (aguardando conferência, financeiro, recebido sem
   conferência no prazo); os outros a tela deduz do status (cmpEtapa). Sem a view (migration não aplicada) fica vazio. */
async function cmpFetchEtapaEsp(){
  const out = {};
  for(let de = 0; ; de += 1000){
    const r = await sb.from("vw_compras_pedido_etapa").select("pedido_id,etapa,conferencias_pendentes,conferencias_vencidas,titulos_pendentes,proximo_vencimento")
      .or("etapa.in.(aguardando_conferencia,financeiro),conferencias_vencidas.gt.0").order("pedido_id").range(de, de + 999);
    if(r.error){ console.warn("vw_compras_pedido_etapa:", r.error.message); break; }
    (r.data || []).forEach(l => { out[l.pedido_id] = l; });
    if((r.data || []).length < 1000) break;
  }
  _cmpEtapaEsp = out;
}
/* o resto do período (fechados antes dos 30 dias), sem itens; mesma paginação */
async function cmpFetchResto(token, corte, corte1, porId){
  const resto = await cmpFetchPaginas(q => { q = q.lt("data_pedido", corte1).not("status", "in", `(${CMP_ABERTOS.join(",")})`); return corte ? q.gte("data_pedido", corte) : q; });
  if(token !== _cmpCarga) return;
  _cmpCompleto = true;
  if(resto.error){ aviso("app-aviso", "O restante do período não carregou: " + resto.error.message, "erro"); renderCompras(); return; }
  const novos = [];
  resto.data.forEach(p => { if(!porId[p.id]){ p.itens = null; porId[p.id] = p; _cmpPedidos.push(p); novos.push(p); } });
  cmpOrdenar(_cmpPedidos);
  if(["kanban","lista"].includes(_cmpView)) renderCompras();   // completa a lista; as outras visões não dependem dela
  // lote S52 (#162): as NFs do resto chegam depois, em segundo plano, para a coluna NF não ficar "—" só nos antigos
  const nfs = await cmpFetchNfs(novos.map(p => p.id));
  if(token !== _cmpCarga || !Object.keys(nfs).length) return;
  Object.assign(_cmpNfs, nfs);
  if(["kanban","lista"].includes(_cmpView)) renderCompras();
}
/* lote S52 (#162, Thayse): a NF do pedido é a dos seus recebimentos (recebimentos.nf_numero/nf_serie, não cancelados).
   Sem campo novo no banco. Lotes de 100 ids (como `faltam`); devolve { pedido_id: ["185", "186/1", …] }. */
async function cmpFetchNfs(ids){
  const out = {};
  for(let i = 0; i < ids.length; i += 100){
    const r = await sb.from("recebimentos").select("pedido_id,nf_numero,nf_serie,data_recebimento").in("pedido_id", ids.slice(i, i + 100))
      .neq("status", "cancelado").not("nf_numero", "is", null).order("data_recebimento").limit(1000);
    if(r.error){ console.warn("recebimentos (NF):", r.error.message); break; }
    (r.data || []).forEach(x => { const nf = String(x.nf_numero).trim() + (x.nf_serie ? "/" + String(x.nf_serie).trim() : ""); const l = out[x.pedido_id] = out[x.pedido_id] || []; if(nf && !l.includes(nf)) l.push(nf); });
  }
  return out;
}
function cmpNfTxt(p){ return (_cmpNfs[p.id] || []).join(", "); }
/* lote S43 (L2): busca com 3+ letras também consulta o servidor (os itens dos pedidos fechados não vêm mais na carga).
   Lote S52 (#162): além da descrição dos itens, o nº da NF dos recebimentos e o "Documento de origem" do Odoo
   (observacoes "Ref. Odoo: 10034"); pedido casado que está fora do período carregado é buscado e entra na lista
   (sem itens), com as suas NFs. */
async function cmpBuscar(){
  const q = ($("cmp-busca")?.value || "").trim();
  if(q.length < 3){ _cmpBuscaServidorIds = null; renderCompras(); return; }
  renderCompras();   // o que casa na memória aparece já
  const t = q.replace(/[%,()]/g, " ").trim();
  const mudou = () => ($("cmp-busca")?.value || "").trim() !== q;   // já digitou outra coisa
  const [it, nf, ob] = await Promise.all([
    sb.from("pedido_compra_itens").select("pedido_id").ilike("descricao", `%${t}%`).limit(2000),
    sb.from("recebimentos").select("pedido_id").ilike("nf_numero", `%${t}%`).neq("status", "cancelado").not("pedido_id", "is", null).limit(500),
    sb.from("pedidos_compra").select("id").ilike("observacoes", `%${t}%`).limit(500)
  ]);
  if(mudou()) return;
  const ids = new Set([...(it.data || []).map(i => i.pedido_id), ...(nf.data || []).map(r => r.pedido_id), ...(ob.data || []).map(p => p.id)].filter(Boolean));
  // pedido antigo (fora do período carregado): busca e entra na memória sem itens (a ficha abre o pedido inteiro)
  const faltam = [...ids].filter(id => !_cmpPedidos.some(p => p.id === id));
  if(faltam.length){
    const novos = [];
    for(let i = 0; i < faltam.length; i += 100){
      const r = await cmpFetchPaginas(x => x.in("id", faltam.slice(i, i + 100)));
      if(!r.error) novos.push(...r.data);
    }
    const nfs = await cmpFetchNfs(novos.map(p => p.id));
    if(mudou()) return;
    novos.forEach(p => { if(!_cmpPedidos.some(x => x.id === p.id)){ p.itens = null; _cmpPedidos.push(p); } });
    Object.assign(_cmpNfs, nfs);
    cmpOrdenar(_cmpPedidos);
  }
  _cmpBuscaServidorIds = ids;
  renderCompras();
}
function cmpPreencherSelectsFixos(){
  const fornOpts = ph => `<option value="">${ph}</option>` + _cmpForns.map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}${f.nome_fantasia && f.nome_fantasia !== f.razao_social ? " (" + esc(f.nome_fantasia) + ")" : ""}</option>`).join("");
  const obraOpts = ph => `<option value="">${ph}</option>` + cmpObraOptgroups("", o => o.id, o => `${o.codigo} — ${o.nome}`, "Obras");   // lote S54 (#171): + grupo Concluídas
  const eqOpts = ph => `<option value="">${ph}</option>` + _cmpEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
  const set = (id, html) => { const el = $(id); if(el){ const v = el.value; el.innerHTML = html; el.value = v; } };
  set("cmp-forn", fornOpts("— escolha o fornecedor —")); set("cmp-f-forn", fornOpts("Fornecedor")); set("cmp-rec-forn", fornOpts("— fornecedor —")); set("cmp-av-forn", fornOpts("— nenhum —"));
  set("cmp-cot-forn", fornOpts("— fornecedor da cotação —"));   // fase 102
  set("cmp-f-etapa", `<option value="">Etapa</option>` + Object.entries(CMP_ETAPA).filter(([k]) => k !== "cancelado").map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")
    + `<option value="_atrasado">Recebimento atrasado</option>`);   // fase 102
  set("cmp-obra", obraOpts("— nenhuma —")); set("cmp-f-obra", obraOpts("Obra")); set("cmp-av-obra", obraOpts("— nenhuma —"));
  set("cmp-equip", eqOpts("— nenhuma —")); set("cmp-f-equip", eqOpts("TAG")); set("cmp-av-equip", eqOpts("— nenhuma —"));
  set("cmp-centro", cmpCentroOptions("— nenhum —", true)); set("cmp-av-centro", cmpCentroOptions("— nenhum —", true));
  set("cmp-resp-receb", `<option value="">— o solicitante —</option>` + _cmpPerfis.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join(""));
  const fs = $("cmp-f-status"); if(fs){ const atual = fs.value || "_abertos"; fs.innerHTML = `<option value="_abertos">Abertos</option><option value="">Todos os status</option>` + Object.entries(CMP_STATUS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join(""); fs.value = atual; }
  const ac = $("cmp-av-cat"); if(ac) ac.innerHTML = cmpCatOptions("outro");
  ["cmp-forn", "cmp-rec-forn", "cmp-av-forn", "cmp-f-forn", "cmp-cot-forn"].forEach(cmpFornAtualizar);   // lote S43 (#53); S45: filtro do painel; fase 102: cotação
}

/* ---------- painel ---------- */
function cmpFiltrados(){
  const q = ($("cmp-busca")?.value || "").trim().toLowerCase();
  const fSt = $("cmp-f-status")?.value || "", fF = $("cmp-f-forn")?.value || "", fO = $("cmp-f-obra")?.value || "", fE = $("cmp-f-equip")?.value || "", fM = $("cmp-f-mes")?.value || "";
  const soMeus = !!$("cmp-f-meus")?.checked, eu = usuarioAtual?.id;
  const soAprovar = !!$("cmp-f-aprovar-eu")?.checked;   // fase 108b: "para eu aprovar" (chave pendente que eu assino)
  const fEt = $("cmp-f-etapa")?.value || "";   // fase 102
  // fase 102: cartão ou etapa escolhidos definem o conjunto; o "Abertos" padrão do status não corta financeiro/finalizado
  const ignoraAbertos = !!CMP_KPI_ETAPAS[_cmpKpi] || !!fEt;
  return _cmpPedidos.filter(p => {
    const casouServidor = !!(q && _cmpBuscaServidorIds && _cmpBuscaServidorIds.has(p.id));   // lote S52: item, NF ou Ref. Odoo
    if(soMeus && !(_cmpParaReceber[p.id] && _cmpParaReceber[p.id].responsavel_recebimento_id === eu)) return false;   // fase 78
    if(soAprovar && !cmpEuAssino(p.id)) return false;
    // fase 102: "Abertos" = o cartão "Pedidos em aberto" (inclui recebido que espera conferência ou o financeiro).
    // Lote S52: o pedido que o servidor achou pela busca (NF de pedido fechado há meses) aparece mesmo no "Abertos" padrão.
    if(fSt === "_abertos"){ if(!ignoraAbertos && !casouServidor && !CMP_ETAPAS_ABERTAS.includes(cmpEtapa(p))) return false; }
    else if(fSt && p.status !== fSt) return false;
    if(!fSt && _cmpKpi === "" && _cmpView === "kanban" && p.status === "cancelado") return false;
    if(fF && p.fornecedor_id !== fF) return false;
    if(fO && p.obra_id !== fO && !(p.itens || []).some(i => i.obra_id === fO)) return false;
    if(fE && p.equipamento_id !== fE && !(p.itens || []).some(i => i.equipamento_id === fE)) return false;
    if(fM && String(p.data_pedido || "").slice(0, 7) !== fM) return false;
    if(fEt === "_atrasado"){ if(!cmpAtrasado(p)) return false; }
    else if(fEt && cmpEtapa(p) !== fEt) return false;
    if(CMP_KPI_ETAPAS[_cmpKpi] && !CMP_KPI_ETAPAS[_cmpKpi].includes(cmpEtapa(p))) return false;   // fase 102 (#92)
    if(q){
      const alvo = [p.numero, p.codigo_externo, p.comprador_externo, p.fornecedor?.razao_social, cmpObra(p.obra_id), cmpEq(p.equipamento_id), p.condicao_pagamento, cmpNfTxt(p), p.observacoes, ...(p.itens || []).map(i => i.descricao)].filter(Boolean).join(" ").toLowerCase();   // lote S52: NF e Ref. Odoo
      if(!alvo.includes(q) && !casouServidor) return false;   // lote S43: item casado no servidor
    }
    return true;
  });
}
/* lote S43 (L2): os indicadores vêm de vw_compras_kpis (uma linha). Sem a view (erro), conta na memória
   como antes, mas só depois que o período inteiro chegou; até lá fica "…". */
/* fase 108b: pedido em que o usuário logado tem chave pendente para assinar */
function cmpEuAssino(pedidoId){ return (_cmpAprovPend[pedidoId] || []).some(a => a.eu_assino); }
/* fase 102 (#92): os cartões seguem a sequência do Fabrício (Requisição pendente · Em cotação · Aguardando aprovação ·
   Aguardando recebimento · Financeiro · Pedidos em aberto · Pedidos finalizados). Os números das etapas em aberto vêm de
   vw_compras_etapas (todos os pedidos abertos); "finalizados" conta a lista carregada (o período escolhido), então só
   aparece quando o período inteiro chegou. Valor só para quem lê contas a pagar (a view já devolve nulo aos outros). */
function cmpRenderKpis(){
  const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  const nAprovar = Object.keys(_cmpAprovPend).filter(cmpEuAssino).length;   // fase 108b
  set("cmp-kpi-aprovar-meus", nAprovar ? `(${nAprovar} para você)` : "");
  const verValor = typeof podeVerContasPagar === "function" && podeVerContasPagar();
  const vTxt = v => verValor && v !== null && v !== undefined ? brl(v) : "";
  const k = _cmpKpis, E = _cmpEtapasResumo;
  const per = $("cmp-f-periodo");
  const perTxt = per && per.value ? per.options[per.selectedIndex].text.toLowerCase() : "todo o período";
  if(_cmpCompleto){
    const fin = _cmpPedidos.filter(p => cmpEtapa(p) === "finalizado");
    set("cmp-kpi-finalizados", fin.length);
    set("cmp-kpi-finalizados-sub", [perTxt, verValor ? brl(fin.reduce((s, p) => s + Number(p.total || 0), 0)) : ""].filter(Boolean).join(" · "));
  } else { set("cmp-kpi-finalizados", "…"); set("cmp-kpi-finalizados-sub", ""); }
  if(E){
    const q = et => (E[et] ? E[et].q : 0), soma = (lst, campo) => lst.reduce((s, et) => s + (E[et] ? Number(E[et][campo] || 0) : 0), 0);
    const val = lst => (verValor && lst.some(et => E[et] && E[et].v !== null)) ? soma(lst, "v") : null;
    set("cmp-kpi-req", q("requisicao_pendente"));
    set("cmp-kpi-cotacao", q("em_cotacao")); set("cmp-kpi-cotacao-sub", vTxt(val(["em_cotacao"])));
    set("cmp-kpi-aprovar", q("aguardando_aprovacao")); set("cmp-kpi-aprovar-sub", vTxt(val(["aguardando_aprovacao"])));
    const nConf = q("aguardando_conferencia"), nAtr = soma(["aguardando_recebimento"], "atr"), meus = k ? Number(k.para_receber_meus || 0) : 0;
    set("cmp-kpi-entrega", q("aguardando_recebimento") + nConf);
    set("cmp-kpi-entrega-sub", [nConf ? `${nConf} a conferir` : "", nAtr ? `${nAtr} atrasado(s)` : "", meus ? `${meus} seus para receber` : ""].filter(Boolean).join(" · "));
    set("cmp-kpi-financeiro", q("financeiro")); set("cmp-kpi-financeiro-sub", vTxt(val(["financeiro"])));
    set("cmp-kpi-abertos", CMP_ETAPAS_ABERTAS.reduce((s, et) => s + q(et), 0)); set("cmp-kpi-valor", vTxt(val(CMP_ETAPAS_ABERTAS)));
    _cmpReqPend = q("requisicao_pendente");
  } else if(k){
    // sem a view da fase 102 (migration não aplicada): os números antigos nos cartões que existiam
    set("cmp-kpi-req", k.requisicoes_pendentes); set("cmp-kpi-cotacao", "—"); set("cmp-kpi-aprovar", k.aguardando_aprovacao);
    set("cmp-kpi-entrega", k.aguardando_entrega); set("cmp-kpi-entrega-sub", k.atrasados ? `${k.atrasados} atrasado(s)` : "");
    set("cmp-kpi-financeiro", "—"); set("cmp-kpi-abertos", k.abertos); set("cmp-kpi-valor", vTxt(k.valor_aberto));
    _cmpReqPend = Number(k.requisicoes_pendentes || 0);
  } else if(_cmpCompleto){
    const conta = lst => _cmpPedidos.filter(p => lst.includes(cmpEtapa(p))).length;
    set("cmp-kpi-req", _cmpReqPend); set("cmp-kpi-cotacao", conta(["em_cotacao"])); set("cmp-kpi-aprovar", conta(["aguardando_aprovacao"]));
    set("cmp-kpi-entrega", conta(CMP_KPI_ETAPAS.entrega)); set("cmp-kpi-financeiro", conta(["financeiro"])); set("cmp-kpi-abertos", conta(CMP_ETAPAS_ABERTAS));
  } else return;
  document.querySelectorAll("#cmp-painel .ind").forEach(el => { if(el.dataset.kpi !== "finalizados" || _cmpCompleto) el.classList.remove("carregando"); });
}
function renderCompras(){
  const cont = $("cmp-conteudo"); if(!cont) return;
  cmpRenderKpis();
  document.querySelectorAll("#cmp-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _cmpView));
  document.querySelectorAll("#cmp-painel .ind[data-kpi]").forEach(el => el.classList.toggle("ativo", el.dataset.kpi === _cmpKpi));
  $("cmp-filtros").style.display = ["kanban","lista"].includes(_cmpView) ? "" : "none";
  if(_cmpView === "recebimentos") return renderRecebimentos();
  if(_cmpView === "requisicoes") return renderRequisicoes(); // fase 60
  if(_cmpView === "naturezas") return renderNaturezas();     // fase 108b
  const dados = cmpFiltrados();
  const per = $("cmp-f-periodo");
  $("cmp-contador").textContent = `${dados.length} de ${_cmpPedidos.length}${per && per.value ? " · " + per.options[per.selectedIndex].text.toLowerCase() + " e abertos" : ""}${_cmpCompleto ? "" : " · carregando o resto…"}`;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhum pedido com esses filtros.</p>`; return; }
  if(_cmpView === "lista") renderComprasLista(dados); else renderComprasKanban(dados);
}
function cmpCardHTML(p){
  const atras = cmpAtrasado(p);
  const dest = p.obra_id ? "🏗️ " + esc(cmpObra(p.obra_id)) : p.equipamento_id ? "🚜 TAG " + esc(cmpEq(p.equipamento_id)) : p.centro_custo_id && cmpCentro(p.centro_custo_id) ? "🏢 " + esc(cmpCentro(p.centro_custo_id)) : "📦 Estoque";
  const it = p.itens;   // null = pedido fechado, itens só na ficha (lote S43)
  const tipo = cmpTipoPedido(p);   // fase 108b
  return `<div class="serv-kan-card${cmpSrvAtraso(p) ? " cmp-srv-atraso" : ""}" data-id="${esc(p.id)}"${cmpSrvAtraso(p) ? ' title="serviço sem evidência há mais de 7 dias"' : ""}>
    <div class="serv-kan-card-nome"><strong>${esc(p.numero)}</strong> <span class="meta">${p.codigo_externo ? esc(p.codigo_externo) + " · " : ""}${dataBR(p.data_pedido)}</span>${cmpEuAssino(p.id) ? ` <span class="tag ambar" title="chave de aprovação pendente que você assina">falta sua assinatura</span>` : ""}${cmpEtapaExtra(p) ? " " + cmpEtapaExtra(p) : ""}</div>
    <div>${esc(p.fornecedor?.razao_social || "— sem fornecedor —")}</div>
    <div class="meta">${dest}${it ? ` · ${it.length} item(ns)` : ""}${tipo ? ` · ${esc(tipo)}` : ""}${cmpNfTxt(p) ? ` · NF ${esc(cmpNfTxt(p))}` : ""}</div>
    <div class="meta" style="display:flex;justify-content:space-between;margin-top:4px;"><strong>${brl(p.total)}</strong>${p.previsao_entrega ? `<span class="${atras ? "txt-perigo" : ""}">${atras ? "⚠ " : "📅 "}${dataBR(p.previsao_entrega)}</span>` : ""}</div>
  </div>`;
}
function renderComprasKanban(dados){
  const cols = CMP_STAGES.concat(dados.some(p => p.status === "cancelado") ? ["cancelado"] : []);
  $("cmp-conteudo").innerHTML = `<div class="serv-kanban">${cols.map(st => {
    const its = dados.filter(p => p.status === st);
    return `<div class="serv-kan-col" data-status="${st}"><div class="serv-kan-col-head">${cmpTag(st)} <span class="contador">${its.length}</span>${its.length ? ` <span class="meta">${brl(its.reduce((s, p) => s + Number(p.total || 0), 0))}</span>` : ""}</div>
      ${its.map(cmpCardHTML).join("") || `<p class="vazio">—</p>`}</div>`; }).join("")}</div>`;
}
/* lote S49 (#132, Fabrício): a lista de pedidos ordena pelo cabeçalho (ordenarTabela do core.js, o mesmo da lista de
   Orçamentos do lote S47): clicar ordena, clicar de novo inverte, e a escolha fica na sessão (sessionStorage
   "cmp-ordem"). Padrão: data mais recente primeiro, como a carga. Status segue a ordem das etapas (rascunho →
   aguardando aprovação → … → recebido; cancelado no fim), o que agrupa os pedidos de cada status. */
const CMP_ORDEM_STATUS = CMP_STAGES.concat(["cancelado"]);
/* fase 108b: era um segundo cmpDestinoTxt, que sobrescrevia o do item (TAG com obra aparecia como obra; estoque com
   setor solicitante aparecia como setor). O do pedido inteiro ganhou nome próprio. */
function cmpDestinoPedidoTxt(p){
  return p.obra_id ? cmpObra(p.obra_id) : p.equipamento_id ? "TAG " + cmpEq(p.equipamento_id)
    : p.centro_custo_id && cmpCentro(p.centro_custo_id) ? cmpCentro(p.centro_custo_id) : "Estoque";
}
const _cmpOrdem = ordenarTabela({
  numero:     { tipo: "texto", valor: p => p.numero || "" },
  data:       { tipo: "data",  valor: p => p.data_pedido || "", dirInicial: "desc" },
  fornecedor: { tipo: "texto", valor: p => p.fornecedor?.razao_social || "" },
  nf:         { tipo: "texto", valor: p => cmpNfTxt(p) },   // lote S52 (#162)
  destino:    { tipo: "texto", valor: p => cmpDestinoPedidoTxt(p) },
  tipo:       { tipo: "texto", valor: p => cmpTipoPedido(p) },   // fase 108b
  total:      { tipo: "num",   valor: p => Number(p.total || 0), dirInicial: "desc" },
  previsao:   { tipo: "data",  valor: p => p.previsao_entrega || "" },
  status:     { tipo: "num",   valor: p => { const i = CMP_ORDEM_STATUS.indexOf(p.status); return i < 0 ? CMP_ORDEM_STATUS.length : i; } }
}, { chave: "cmp-ordem", padrao: { col: "data", dir: "desc" } });
function renderComprasLista(dados){
  dados = _cmpOrdem.aplicar(dados);
  const th = (col, rot, extra) => _cmpOrdem.th(col, rot, extra);
  $("cmp-conteudo").innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>${th("numero", "Número")}${th("data", "Data")}${th("fornecedor", "Fornecedor")}${th("nf", "NF", { title: "nº da NF dos recebimentos do pedido" })}${th("destino", "Destino")}${th("tipo", "Tipo de compra")}<th class="num">Itens</th>${th("total", "Total", { cls: "num" })}${th("previsao", "Previsão")}${th("status", "Status")}<th>Para receber com</th></tr></thead>
    <tbody>${dados.map(p => `<tr class="linha-clicavel${cmpSrvAtraso(p) ? " cmp-srv-atraso" : ""}" data-id="${esc(p.id)}"${cmpSrvAtraso(p) ? ' title="serviço sem evidência há mais de 7 dias"' : ""}>
      <td><strong>${esc(p.numero)}</strong>${p.codigo_externo ? ` <span class="meta">${esc(p.codigo_externo)}</span>` : ""}</td><td>${dataBR(p.data_pedido)}</td><td>${esc(p.fornecedor?.razao_social || "—")}</td><td>${cmpNfTxt(p) ? esc(cmpNfTxt(p)) : '<span class="meta">—</span>'}</td>
      <td>${p.obra_id ? linkObra(p.obra_id, cmpObra(p.obra_id)) : p.equipamento_id ? "TAG " + esc(cmpEq(p.equipamento_id)) : p.centro_custo_id && cmpCentro(p.centro_custo_id) ? esc(cmpCentro(p.centro_custo_id)) : "Estoque"}</td>
      <td class="meta">${esc(cmpTipoPedido(p) || "—")}</td>
      <td class="num">${p.itens ? p.itens.length : "—"}</td><td class="num">${brl(p.total)}</td>
      <td class="${cmpAtrasado(p) ? "txt-perigo" : ""}">${dataBR(p.previsao_entrega)}</td>
      <td>${cmpTag(p.status)}${cmpEuAssino(p.id) ? ` <span class="tag ambar" title="chave de aprovação pendente que você assina">falta sua assinatura</span>` : ""}${cmpEtapaExtra(p) ? " " + cmpEtapaExtra(p) : ""}</td><td class="meta">${esc(p._responsavel || "")}${_cmpParaReceber[p.id]?.tem_servico ? ` <span class="tag ${_cmpParaReceber[p.id].tem_evidencia ? "verde" : "ambar"}">serviço${_cmpParaReceber[p.id].tem_evidencia ? " c/ evidência" : ""}</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

/* recebimentos (visão do painel) */
async function renderRecebimentos(){
  const cont = $("cmp-conteudo");
  const { data, error } = await sb.from("recebimentos").select("id,status,tipo,nf_numero,nf_serie,data_recebimento,total_nf,fornecedor_id,pedido:pedidos_compra(numero),itens:recebimento_itens(id,destino)").order("data_recebimento", { ascending: false }).limit(300);
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  $("cmp-contador").textContent = `${(data || []).length} recebimento(s)`;
  if(!data?.length){ cont.innerHTML = `<p class="vazio">Nenhum recebimento ainda. Use "Receber NF" no pedido ou "Receber NF sem pedido".</p>`; return; }
  const stTag = s => s === "confirmado" ? '<span class="tag verde">Confirmado</span>' : s === "cancelado" ? '<span class="tag cinza">Cancelado</span>' : '<span class="tag ambar">Conferindo</span>';
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>NF</th><th>Fornecedor</th><th>Pedido</th><th class="num">Itens</th><th>Tipo de compra</th><th class="num">Total</th><th>Status</th></tr></thead>
    <tbody>${data.map(r => { const it = r.itens || []; const d = [...new Set(it.map(i => i.destino === "estoque" ? "reposição" : "aplicação direta"))].sort().reverse().join(" + ");   // fase 108b
      return `<tr class="linha-clicavel" data-pedido="${esc(r.pedido ? r.pedido.numero : "")}"><td>${dataBR(r.data_recebimento)}</td><td><strong>${esc(r.nf_numero || "—")}</strong>${r.nf_serie ? "/" + esc(r.nf_serie) : ""}${CMP_REC_TIPO[r.tipo] ? ` <span class="tag ${CMP_REC_TIPO[r.tipo][1]}">${CMP_REC_TIPO[r.tipo][0]}</span>` : ""}</td>
      <td>${esc(cmpForn(r.fornecedor_id) || "—")}</td><td>${r.pedido ? esc(r.pedido.numero) : '<span class="meta">sem pedido</span>'}</td><td class="num">${it.length}</td><td class="meta">${esc(d)}</td><td class="num">${brl(r.total_nf)}</td><td>${stTag(r.status)}</td></tr>`; }).join("")}</tbody></table></div>`;
}

/* ---------- naturezas de custo (fase 108b) ----------
   Cadastro do 2º eixo da distribuição analítica (natureza do gasto, plano "Natureza" do Odoo), carregado pela 108a com
   os 39 nomes do Odoo. Escrita: admin e financeiro (diretor por is_admin), policy naturezas_custo_write da 108a; o
   auditor só consulta. Cada campo grava ao sair dele. */
function cmpPodeEditarNaturezas(){ return !!usuarioAtual && ["diretor", "admin", "financeiro"].includes(usuarioAtual.cargo); }
function cmpPodeVerNaturezas(){ return cmpPodeEditarNaturezas() || (!!usuarioAtual && usuarioAtual.cargo === "auditor"); }
function cmpTipoPadraoOptions(sel){
  return `<option value="">— sem padrão —</option>` + Object.entries(CMP_TIPO_LBL).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
}
function renderNaturezas(){
  const cont = $("cmp-conteudo");
  if(!cmpPodeVerNaturezas()){ cont.innerHTML = `<p class="vazio">As naturezas de custo são cuidadas pelo financeiro e pela administração.</p>`; return; }
  const ed = cmpPodeEditarNaturezas() && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
  const dis = ed ? "" : " disabled";
  $("cmp-contador").textContent = `${_cmpNaturezas.length} natureza(s) · ${_cmpNaturezas.filter(n => n.ativo).length} ativa(s)`;
  const catOpts = sel => `<option value="">—</option>` + Object.entries(CMP_CAT_LBL).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join("");
  cont.innerHTML = `<p class="meta" style="margin:0 0 8px;">Natureza do gasto: o 2º eixo da distribuição de cada item de compra (o 1º é o destino; o 3º, o método). O código segue o plano analítico do Odoo (ex.: 2.06.003); a categoria de custo continua como agrupador dos relatórios; o tipo padrão sugere o tipo de compra da linha.</p>
    <div class="tabela-rola"><table class="itens-tabela"><thead><tr><th style="width:110px;">Código</th><th>Nome</th><th style="width:160px;">Categoria de custo</th><th style="width:180px;">Tipo de compra padrão</th><th style="width:60px;">Ativa</th><th>Nome no Odoo</th></tr></thead>
    <tbody>${_cmpNaturezas.map(n => `<tr data-nat="${esc(n.id)}">
      <td><input class="cmp-nat" data-f="codigo" value="${esc(n.codigo || "")}" placeholder="2.06.003" style="width:100px;"${dis} /></td>
      <td><input class="cmp-nat" data-f="nome" value="${esc(n.nome)}" style="width:100%;min-width:220px;"${dis} /></td>
      <td><select class="cmp-nat" data-f="categoria_custo"${dis}>${catOpts(n.categoria_custo || "")}</select></td>
      <td><select class="cmp-nat" data-f="tipo_compra_padrao"${dis}>${cmpTipoPadraoOptions(n.tipo_compra_padrao || "")}</select></td>
      <td><input type="checkbox" class="cmp-nat" data-f="ativo"${n.ativo ? " checked" : ""}${dis} /></td>
      <td class="meta">${esc(n.odoo_nome || "—")}</td></tr>`).join("") || `<tr><td colspan="6" class="vazio">Nenhuma natureza cadastrada.</td></tr>`}</tbody>
    ${ed ? `<tfoot><tr><td><input id="cmp-nat-novo-cod" placeholder="código" style="width:100px;" /></td><td><input id="cmp-nat-novo-nome" placeholder="nova natureza" style="width:100%;min-width:220px;" /></td>
      <td><select id="cmp-nat-novo-cat">${catOpts("")}</select></td><td><select id="cmp-nat-novo-tipo">${cmpTipoPadraoOptions("")}</select></td>
      <td colspan="2"><button type="button" class="btn-sec btn-sm" id="btn-cmp-nat-add">+ Adicionar</button></td></tr></tfoot>` : ""}</table></div>`;
  if(!ed) return;
  cont.querySelectorAll(".cmp-nat").forEach(el => el.addEventListener("change", () => {
    const id = el.closest("tr").dataset.nat, f = el.dataset.f;
    cmpSalvarNatureza(id, f, el.type === "checkbox" ? el.checked : (el.value.trim() || null));
  }));
  $("btn-cmp-nat-add")?.addEventListener("click", () => comBotaoTravado("btn-cmp-nat-add", cmpNovaNatureza));
}
const CMP_NAT_CODIGO = /^[0-9]+(\.[0-9]+)*$/;   // mesmo formato do check naturezas_custo_codigo_formato
async function cmpSalvarNatureza(id, campo, valor){
  if(campo === "codigo" && valor && !CMP_NAT_CODIGO.test(valor)){ aviso("app-aviso", "Código no formato do plano do Odoo: números separados por ponto (ex.: 2.06.003).", "erro"); renderNaturezas(); return; }
  if(campo === "nome" && !valor){ aviso("app-aviso", "A natureza precisa de nome.", "erro"); renderNaturezas(); return; }
  const { data, error } = await sb.from("naturezas_custo").update({ [campo]: valor }).eq("id", id).select("id,codigo,nome,categoria_custo,tipo_compra_padrao,odoo_nome,ativo,ordem").single();
  if(error){ aviso("app-aviso", "Não foi possível gravar a natureza: " + (/duplicate|unique/i.test(error.message) ? "já existe outra com esse código ou nome." : error.message), "erro"); renderNaturezas(); return; }
  const i = _cmpNaturezas.findIndex(n => n.id === id); if(i >= 0) _cmpNaturezas[i] = data;
  _cmpNatMap[id] = data;
  aviso("app-aviso", `Natureza "${data.nome}" atualizada.`, "ok");
}
async function cmpNovaNatureza(){
  const nome = ($("cmp-nat-novo-nome")?.value || "").trim(), codigo = ($("cmp-nat-novo-cod")?.value || "").trim() || null;
  if(!nome){ aviso("app-aviso", "Informe o nome da natureza.", "erro"); return; }
  if(codigo && !CMP_NAT_CODIGO.test(codigo)){ aviso("app-aviso", "Código no formato do plano do Odoo: números separados por ponto (ex.: 2.06.003).", "erro"); return; }
  const ordem = _cmpNaturezas.reduce((m, n) => Math.max(m, Number(n.ordem || 0)), 0) + 10;
  const { data, error } = await sb.from("naturezas_custo").insert({ nome, codigo, categoria_custo: $("cmp-nat-novo-cat").value || null, tipo_compra_padrao: $("cmp-nat-novo-tipo").value || null, ordem })
    .select("id,codigo,nome,categoria_custo,tipo_compra_padrao,odoo_nome,ativo,ordem").single();
  if(error){ aviso("app-aviso", "Não foi possível criar a natureza: " + (/duplicate|unique/i.test(error.message) ? "já existe outra com esse código ou nome." : error.message), "erro"); return; }
  _cmpNaturezas.push(data); _cmpNatMap[data.id] = data;
  aviso("app-aviso", `Natureza "${data.nome}" criada.`, "ok");
  renderNaturezas();
}

/* ---------- ficha do pedido ---------- */
function mostrarPainelCompras(){
  $("cmp-ficha").style.display = "none"; $("cmp-painel").style.display = "";
  _cmpAtual = null; _cmpEditId = null; _cmpItens = [];
  _cmpAprovAtual = { pend: [], assinadas: [], carregado: false };
  _cmpCotacoes = []; _cmpCotEdit = null; _cmpConfAtual = { lista: [], pode: false, etapa: null, carregado: false };   // fase 102
  if(typeof ocultarHistorico === "function") ocultarHistorico("cmp-chatter");
  // fase 108b: quem chegou pela Sala de Comando sem ter Compras no menu volta para o Início (o painel não é dele)
  if(_cmpModoDono){
    _cmpModoDono = false;
    if(typeof irParaSecao === "function") irParaSecao("inicio");
    if(typeof carregarDashboard === "function") carregarDashboard();
    return;
  }
  renderCompras();
}
/* Fase 108b: o dono do custo (engenheiro da obra, gestor da TAG, responsável do centro) abre o pedido pela Sala de
   Comando para assinar a chave dele. Quem tem Compras no menu entra pelo menu (irParaSecao); quem não tem (o item
   está escondido para o cargo e irParaSecao barra o atalho) entra direto na seção, sem passar pelo menu, só se o
   pedido tiver chave que ele assina ou assinou: a ficha abre em modo leitura com o botão "Assinar" e o "Voltar"
   leva de volta ao Início. A leitura em si é da RLS (policy da 108b: o dono lê o pedido, os itens e as chaves). */
async function cmpAbrirParaAssinar(id){
  if(!id) return false;
  const nav = document.querySelector('.sidebar-nav button[data-secao="compras"]');
  const comMenu = !!nav && nav.style.display !== "none";
  if(comMenu){
    _cmpModoDono = false;
    if(!irParaSecao("compras")) return false;
  } else {
    const eu = usuarioAtual?.id; if(!eu) return false;
    const [{ data: pend }, { data: ass }] = await Promise.all([
      sb.from("vw_pedidos_aprovacao_pendente").select("pedido_id").eq("pedido_id", id).eq("eu_assino", true).limit(1),
      sb.from("pedido_aprovacoes").select("id").eq("pedido_id", id).eq("aprovador_id", eu).limit(1)
    ]);
    if(!(pend || []).length && !(ass || []).length){ aviso("app-aviso", "Este pedido não tem assinatura sua para fazer.", "erro"); return false; }
    _cmpModoDono = true;
    ativarSecao("compras", null);
    if($("app-secao-titulo")) $("app-secao-titulo").textContent = "Compras";
  }
  await cmpCarregarBase(false);
  await abrirPedido(id);
  return true;
}
function novoPedido(pre){
  if(!cmpPodeOperar()){ aviso("app-aviso", "Seu perfil não opera compras.", "erro"); return; }
  _cmpItens = [];
  abrirFichaPedido(Object.assign({ id: null, numero: "(novo)", status: "rascunho", data_pedido: hojeISO(), local_entrega: "base", frete: 0, desconto: 0, total: 0, itens: [] }, pre || {}));
}
async function abrirPedido(id){
  const [{ data: p, error }, it] = await Promise.all([
    sb.from("pedidos_compra").select("*, fornecedor:fornecedores(razao_social), solicitante:profiles!pedidos_compra_solicitante_id_fkey(nome), aprovador:profiles!pedidos_compra_aprovador_id_fkey(nome)").eq("id", id).single(),
    sb.from("pedido_compra_itens").select("*, produto:produtos(unidade)").eq("pedido_id", id).order("ordem").order("created_at")   // lote S54 (#170): unidade do cadastro
  ]);
  if(error || !p){ aviso("app-aviso", "Não foi possível abrir o pedido" + (error ? ": " + error.message : "."), "erro"); return; }
  if(it.error){ aviso("app-aviso", "Itens não carregaram: " + it.error.message, "erro"); return; }
  // fase 108b: natureza e método já gravados não são trocados pelo padrão quando o comprador muda o tipo ou o destino
  const itens = (it.data || []).map(({ produto, ...i }) => {
    if(i.produto_id && produto?.unidade) _cmpProdUn[i.produto_id] = produto.unidade;   // lote S54 (#170)
    return { ...i, _natAuto: !i.natureza_id && !i.natureza, _metAuto: !i.metodo };
  });
  // lote S53 (#149): rateio dos itens com destino TAG (tabela nova; sem a migration a consulta falha e a ficha segue sem rateio)
  const ids = itens.map(i => i.id);
  if(ids.length){
    const { data: rat, error: eRat } = await sb.from("pedido_item_rateio").select("pedido_item_id,equipamento_id,fracao").in("pedido_item_id", ids);
    if(eRat) console.warn("pedido_item_rateio:", eRat.message);
    else {
      const por = {};
      (rat || []).forEach(r => { (por[r.pedido_item_id] = por[r.pedido_item_id] || []).push({ equipamento_id: r.equipamento_id, fracao: Number(r.fracao) }); });
      itens.forEach(i => { const l = por[i.id]; if(l && l.length >= 2) i._rateio = cmpOrdenarRateio(l); });
    }
  }
  _cmpItens = itens;
  abrirFichaPedido(p);
}
function cmpEditavel(){ return cmpPodeOperar() && (_cmpAtual?.status || "rascunho") === "rascunho"; }
function abrirFichaPedido(p){
  _cmpAtual = p; _cmpEditId = p.id || null;
  const novo = !p.id;
  $("cmp-painel").style.display = "none"; $("cmp-ficha").style.display = "";
  $("cmp-ficha-titulo").textContent = novo ? "Novo pedido" : `${p.numero} · ${p.fornecedor?.razao_social || cmpForn(p.fornecedor_id) || "sem fornecedor"}`;
  const ed = cmpEditavel();
  $("cmp-forn").value = p.fornecedor_id || ""; $("cmp-data").value = p.data_pedido || hojeISO(); $("cmp-prev").value = p.previsao_entrega || "";
  $("cmp-cond").value = p.condicao_pagamento || ""; $("cmp-local").value = p.local_entrega || "base";
  $("cmp-obra").value = p.obra_id || ""; $("cmp-equip").value = p.equipamento_id || ""; $("cmp-centro").value = p.centro_custo_id || "";
  $("cmp-frete").value = p.frete ?? 0; $("cmp-desc").value = p.desconto ?? 0; $("cmp-obs").value = p.observacoes || "";
  $("cmp-ficha").querySelectorAll(".odoo-tab[data-tab=cabecalho] input, .odoo-tab[data-tab=cabecalho] select, .odoo-tab[data-tab=cabecalho] textarea").forEach(el => el.disabled = !ed);
  cmpFornAtualizar("cmp-forn");   // lote S43 (#53): chip do fornecedor acompanha o select
  // fase 78: responsável pelo recebimento troca a qualquer momento (comprador do pedido e diretoria)
  $("cmp-resp-receb").value = p.responsavel_recebimento_id || "";
  $("cmp-resp-receb").disabled = !(ed || cmpPodeTrocarResp());
  $("cmp-itens-add").style.display = ed ? "" : "none";
  if($("btn-cmp-prod-novo")) $("btn-cmp-prod-novo").style.display = ed && cmpPodeCadastrarProduto() ? "" : "none";   // fase 102 (#160)
  _cmpRatPadrao = []; _cmpRat = null; cmpRatPadraoTxt();   // lote S53 (#149): o "+ TAGs" do cabeçalho vale só para a ficha aberta
  if($("btn-cmp-rat-padrao")) $("btn-cmp-rat-padrao").style.display = ed ? "" : "none";
  if($("cmp-rat-modal")) $("cmp-rat-modal").style.display = "none";
  _cmpCotacoes = []; _cmpCotEdit = null; _cmpConfAtual = { lista: [], pode: false, etapa: null, carregado: false };   // fase 102
  if($("cmp-cot-form")) $("cmp-cot-form").style.display = "none";
  $("cmp-alcada-info").textContent = cmpPodeOperar()
    ? `Sua alçada de aprovação: ${cmpAlcadaTxt()}. A aprovação tem duas chaves: a alçada pelo valor e, para cada obra, TAG ou centro com item de aplicação direta, o dono do custo (engenheiro responsável da obra, gestor de manutenção ou de frota, responsável do centro). Reposição de estoque só pede a alçada.`
    : `Você vê este pedido porque é dono do custo de um destino dele. Confira os itens e use "Assinar" para a sua chave.`;
  _cmpAprovAtual = { pend: [], assinadas: [], carregado: false };   // fase 108b: chaves chegam em cmpCarregarAprovacoes
  cmpRenderFaltaAssinar();
  cmpAtualizarStatusbar(p.status || "rascunho");
  cmpAtualizarChips();
  cmpAtualizarBotoes();
  renderItensPedido();
  if(!novo) cmpCarregarAprovacoes(p.id);
  const setSb = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); } };
  setSb("sb-cmp-itens", _cmpItens.length); setSb("sb-cmp-rec", 0); setSb("sb-cmp-tit", 0); setSb("sb-cmp-anexos", 0); setSb("sb-cmp-cot", 0);
  $("cmp-rec-lista").innerHTML = `<p class="vazio">${novo ? "Salve o pedido para receber." : "Carregando…"}</p>`;
  $("cmp-tit-lista").innerHTML = `<p class="vazio">—</p>`;
  if($("cmp-cot-lista")) $("cmp-cot-lista").innerHTML = `<p class="vazio">${novo ? "Salve o pedido para registrar cotações." : "Carregando…"}</p>`;   // fase 102
  cmpAnxPreparar(novo);   // lote S48 (#117)
  if(!novo){ cmpCarregarFilhas(p.id); cmpCarregarAnexosPedido(p.id); cmpCarregarCotacoes(p.id); }
  if(!novo && typeof montarHistorico === "function") montarHistorico("pedidos_compra", p.id, "cmp-chatter");
  else if(typeof ocultarHistorico === "function") ocultarHistorico("cmp-chatter");
  ativarTabPedido(novo ? "cabecalho" : (_cmpItens.length ? "itens" : "cabecalho"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function cmpAtualizarStatusbar(st){
  document.querySelectorAll("#cmp-statusbar .stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    const i = CMP_STAGES.indexOf(st), j = CMP_STAGES.indexOf(el.dataset.status);
    if(st === "cancelado") return;
    if(j === i) el.classList.add("atual"); else if(j < i) el.classList.add("passada");
  });
  $("cmp-statusbar").title = st === "cancelado" ? "Pedido cancelado" : "Status do pedido";
}
function cmpAtualizarChips(){
  const p = _cmpAtual; if(!p) return;
  const total = cmpSomaItens(_cmpItens) + cmpSomaIpi(_cmpItens) + Number($("cmp-frete").value || 0) - Number($("cmp-desc").value || 0);   // lote S53 (#166): o IPI entra no total
  cmpRenderRodapeItens();
  $("cmp-chip-num").textContent = p.numero || "(novo)";
  const chOdoo = $("cmp-chip-odoo");   // fase 65: pedido importado do Odoo
  if(chOdoo){ const ext = p.codigo_externo_origem === "odoo"; chOdoo.style.display = ext ? "" : "none";
    if(ext) $("cmp-chip-odoo-txt").textContent = p.codigo_externo + (p.comprador_externo ? " · comprador " + p.comprador_externo : ""); }
  $("cmp-chip-forn").textContent = cmpForn($("cmp-forn").value) || "—";
  const obra = $("cmp-obra").value, eq = $("cmp-equip").value;
  $("cmp-chip-destino").textContent = $("cmp-local").value === "obra" ? "Obra: " + (cmpObra(obra) || "?") : eq ? "TAG " + cmpEq(eq) : obra ? "Base · obra " + cmpObra(obra) : "Base Itabira";
  $("cmp-chip-total").textContent = brl(total);
  $("cmp-chip-prev").textContent = dataBR($("cmp-prev").value) || "—";
  const nPend = _cmpAprovAtual.carregado ? _cmpAprovAtual.pend.length : null;   // fase 108b
  $("cmp-chip-aprov").textContent = p.status === "cancelado" ? "Cancelado" : p.aprovador ? `${p.aprovador.nome}${p.aprovado_em ? " · " + dataBR(String(p.aprovado_em).slice(0, 10)) : ""}`
    : p.status === "aguardando_aprovacao" ? (nPend ? `falta ${nPend} assinatura${nPend > 1 ? "s" : ""}` : "aguardando") : "—";
  if($("cmp-chip-tipo")) $("cmp-chip-tipo").textContent = cmpTipoResumo(_cmpItens) || "—";   // fase 108b
  // fase 102: etapa do fluxo e conferência do solicitante
  const chEt = $("cmp-chip-etapa");
  if(chEt){ const et = p.id ? ((_cmpConfAtual.etapa && _cmpConfAtual.etapa.etapa) || cmpEtapa(p)) : "rascunho"; chEt.textContent = (CMP_ETAPA[et] || {}).label || et; }
  cmpAtualizarChipConferencia();
}
/* ---------- conferência do recebimento pelo solicitante (fase 102, etapa 5 do #91) ----------
   vw_compras_conferencias: recebimentos confirmados desde a publicação de pedidos com requisição; exigida = requisição
   de obra, TAG ou setor (decisão 1); vencida = passou do prazo em dias úteis (decisão 2: o pedido segue com aviso).
   Quem confere: quem fez a requisição, ou a diretoria (compras_pode_conferir); o comprador e o almoxarife não. */
function cmpDataLocal(ts){ return ts ? dataLocalISO(new Date(ts)) : ""; }
function cmpSomarDiasUteis(iso, n){
  if(!iso) return "";
  const d = new Date(iso + "T12:00:00"); let k = 0;
  while(k < n){ d.setDate(d.getDate() + 1); const s = d.getDay(); if(s !== 0 && s !== 6) k++; }
  return dataLocalISO(d);
}
async function cmpCarregarConferencias(id){
  const [lst, pode, et] = await Promise.all([
    sb.from("vw_compras_conferencias").select("recebimento_id,nf_numero,data_recebimento,confirmado_em,recebido_por_nome,conferido_por_nome,conferido_em,conferencia_obs,exigida,pendente,vencida,dias_uteis,prazo_uteis").eq("pedido_id", id).order("confirmado_em"),
    sb.rpc("compras_pode_conferir", { p_pedido: id }),
    sb.from("vw_compras_pedido_etapa").select("etapa,conferencias_pendentes,conferencias_vencidas,titulos_pendentes,proximo_vencimento").eq("pedido_id", id).maybeSingle()
  ]);
  if(_cmpEditId !== id) return;
  if(lst.error) console.warn("vw_compras_conferencias:", lst.error.message);   // antes da migration da fase 102: sem conferência
  _cmpConfAtual = { lista: lst.error ? [] : (lst.data || []), pode: !pode.error && pode.data === true, etapa: et.error ? null : (et.data || null), carregado: !lst.error };
  cmpAtualizarChips();
  cmpAtualizarBotoes();
}
function cmpAtualizarChipConferencia(){
  const ch = $("cmp-chip-conf"), txt = $("cmp-chip-conf-txt"); if(!ch || !txt) return;
  const p = _cmpAtual, c = _cmpConfAtual;
  const feitas = c.lista.filter(r => !r.pendente), pend = c.lista.filter(r => r.pendente);
  if(!p || !p.id || !c.carregado || (!p.exige_conferencia && !feitas.length)){ ch.style.display = "none"; return; }
  let t;
  if(!c.lista.length) t = "do solicitante, quando o almoxarifado receber";
  else if(pend.length){
    const venc = pend.filter(r => r.vencida && r.exigida).length;
    if(venc) t = `vencida: ${venc} recebimento(s) sem conferência (o pedido seguiu com aviso)`;
    else t = `aguardando o solicitante · até ${dataBR(cmpSomarDiasUteis(cmpDataLocal(pend[0].confirmado_em), Number(pend[0].prazo_uteis || 5)))}`;
  } else {
    const u = feitas[feitas.length - 1];
    t = `conferido por ${u.conferido_por_nome || "?"} em ${dataBR(cmpDataLocal(u.conferido_em))}`;
  }
  txt.textContent = t;
  ch.style.display = "";
}
/* "Recebi e conferi" no pedido: confere os recebimentos pendentes deste pedido (um por um, pela RPC) */
async function cmpConferirRecebimentos(){
  const pend = _cmpConfAtual.lista.filter(r => r.pendente);
  if(!pend.length || !_cmpConfAtual.pode){ aviso("app-aviso", "Nada a conferir neste pedido.", "erro"); return; }
  const obs = prompt(`Conferir ${pend.length} recebimento(s) (${pend.map(r => r.nf_numero ? "NF " + r.nf_numero : dataBR(r.data_recebimento)).join(", ")}).\nObservação (opcional; diga aqui se faltou algo ou veio com defeito):`, "");
  if(obs === null) return;
  for(const r of pend){
    const { error } = await sb.rpc("recebimento_conferir", { p_id: r.recebimento_id, p_obs: obs || null });
    if(error){ aviso("app-aviso", "Conferência não registrada: " + (error.message || "").replace(/^(?:ERROR|ERRO|[0-9A-Z]{5})\s*:\s*/, ""), "erro"); break; }
  }
  aviso("app-aviso", "Conferência registrada. Obrigado: o pedido segue para o financeiro.", "ok");
  const id = _cmpEditId;
  await cmpFetchPedidos();
  if(id) await abrirPedido(id);
}
/* ---------- aprovação em duas chaves (fase 108b; banco da 108a) ----------
   Pendentes pela view vw_pedidos_aprovacao_pendente (quem assina, eu_assino); assinadas por pedido_aprovacoes. */
async function cmpCarregarAprovacoes(id){
  const [pend, ass] = await Promise.all([
    sb.from("vw_pedidos_aprovacao_pendente").select("aprovacao_id,chave,destino_tipo,destino_id,destino_rotulo,quem_assina,assinantes_nomes,eu_assino,dono_meu,criado_em").eq("pedido_id", id).order("chave").order("criado_em"),
    sb.from("pedido_aprovacoes").select("id,chave,destino_tipo,destino_id,aprovado_em,aprovador:profiles(nome)").eq("pedido_id", id).not("aprovado_em", "is", null).order("aprovado_em")
  ]);
  if(_cmpEditId !== id) return;
  if(pend.error) console.warn("vw_pedidos_aprovacao_pendente:", pend.error.message);
  if(ass.error) console.warn("pedido_aprovacoes:", ass.error.message);
  _cmpAprovAtual = { pend: pend.data || [], assinadas: ass.data || [], carregado: true };
  _cmpAprovPend[id] = _cmpAprovAtual.pend.map(a => ({ ...a, pedido_id: id }));
  if(!_cmpAprovPend[id].length) delete _cmpAprovPend[id];
  cmpRenderFaltaAssinar();
  cmpAtualizarChips();
  cmpAtualizarBotoes();
}
/* rótulo de uma chave já assinada (a view só traz as pendentes, com o rótulo do banco) */
function cmpChaveRotulo(a){
  if(a.chave === "alcada") return "alçada de valor";
  const d = { destino: a.destino_tipo, obra_id: a.destino_tipo === "obra" ? a.destino_id : null, equipamento_id: a.destino_tipo === "equipamento" ? a.destino_id : null, centro_custo_id: a.destino_tipo === "centro_custo" ? a.destino_id : null };
  return "dono do custo · " + cmpDestinoTxt(d);
}
function cmpNomesCurtos(txt, max){
  const n = String(txt || "").split(", ").filter(Boolean);
  if(!n.length) return "ninguém ativo";
  return n.length > max ? n.slice(0, max).join(", ") + ` e mais ${n.length - max}` : n.join(", ");
}
/* bloco "Falta assinar" logo abaixo dos chips (só em aguardando aprovação) */
function cmpRenderFaltaAssinar(){
  const el = $("cmp-aprov-falta"); if(!el) return;
  const p = _cmpAtual, a = _cmpAprovAtual;
  if(!p || p.status !== "aguardando_aprovacao" || !a.carregado){ el.style.display = "none"; el.innerHTML = ""; return; }
  const pend = a.pend.map(k => `<li><strong>${esc(k.quem_assina || k.chave)}</strong>: ${esc(cmpNomesCurtos(k.assinantes_nomes, 4))}${k.eu_assino ? ' <span class="tag verde">você assina</span>' : ""}</li>`).join("");
  const feitas = a.assinadas.map(k => `${esc(cmpChaveRotulo(k))} (${esc(k.aprovador?.nome || "—")}${k.aprovado_em ? ", " + dataBR(String(k.aprovado_em).slice(0, 10)) : ""})`).join("; ");
  el.innerHTML = `<div class="con-alerta"><span class="con-alerta-icone">✍️</span><div>
    <strong>${a.pend.length ? "Falta assinar" : "Nenhuma chave pendente"}</strong>${a.pend.length ? `<ul>${pend}</ul>` : ""}
    ${feitas ? `<div class="meta">Assinado: ${feitas}</div>` : ""}</div></div>`;
  el.style.display = "";
}
function cmpAtualizarBotoes(){
  const st = _cmpAtual?.status || "rascunho", novo = !_cmpEditId, pode = cmpPodeOperar();
  // fase 108b: o botão aparece para quem assina alguma chave pendente (alçada pelo valor ou dono do custo), opere
  // Compras ou não; "Aprovar" quando a assinatura fecha o pedido, "Assinar" quando sobra chave de outra pessoa
  const pend = _cmpAprovAtual.carregado ? _cmpAprovAtual.pend : [], minhas = pend.filter(k => k.eu_assino);
  const podeAprovar = st === "aguardando_aprovacao" && minhas.length > 0 && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
  const bAp = $("btn-cmp-aprovar");
  if(bAp && podeAprovar){
    const fecha = minhas.length === pend.length;
    bAp.textContent = fecha ? "👍 Aprovar" : "✍️ Assinar";
    bAp.title = (fecha ? "Assina e aprova o pedido: " : "Assina a sua chave (o pedido continua aguardando as outras): ") + minhas.map(k => k.quem_assina).join("; ");
  }
  const leitura = typeof ehSomenteLeitura === "function" && ehSomenteLeitura();
  const mostra = { "btn-cmp-salvar": pode && st === "rascunho", "btn-cmp-enviar-aprov": pode && st === "rascunho" && !novo, "btn-cmp-aprovar": podeAprovar,
    "btn-cmp-cotacao": pode && st === "rascunho" && !novo && !leitura,   // fase 102: rascunho → em cotação
    "btn-cmp-conferir": !novo && !leitura && _cmpConfAtual.pode && _cmpConfAtual.lista.some(r => r.pendente),   // fase 102
    "btn-cmp-enviado": pode && st === "aprovado", "btn-cmp-receber": pode && ["aprovado","enviado","parcialmente_recebido"].includes(st),
    "btn-cmp-receber-servico": cmpPodeReceberServico(),
    "btn-cmp-pdf": !novo && st !== "cancelado", "btn-cmp-voltar-rascunho": pode && ["aguardando_aprovacao","aprovado","em_cotacao"].includes(st),
    "btn-cmp-cancelar": pode && !novo && !["recebido","cancelado"].includes(st) };
  Object.entries(mostra).forEach(([id, on]) => { const b = $(id); if(b) b.style.display = on ? "" : "none"; });
}
function ativarTabPedido(nome){
  document.querySelectorAll("#cmp-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#cmp-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
  if(nome === "itens") $("cmp-itens")?.querySelectorAll("textarea.cmp-it").forEach(cmpCrescerTextarea);   // lote S53 (#166): a aba escondida não media o texto
}
async function cmpCarregarFilhas(id){
  const [rec, tit] = await Promise.all([
    sb.from("recebimentos").select("id,status,tipo,nf_numero,nf_serie,data_recebimento,total_nf,vencimento,parcelas,observacoes,itens:recebimento_itens(id,descricao,quantidade_aceita,valor_unitario_nf,destino,obra_id,equipamento_id,centro_custo_id),anexos:recebimento_anexos(id,nome,storage_path)").eq("pedido_id", id).order("data_recebimento", { ascending: false }),
    sb.from("titulos_pagar").select("*, recebimento:recebimentos!inner(pedido_id)").eq("recebimento.pedido_id", id).order("vencimento"),
    cmpCarregarConferencias(id)   // fase 102: conferência de cada recebimento (linha no cartão abaixo)
  ]);
  if(_cmpEditId !== id) return;
  const setSb = (bid, n) => { const b = $(bid); if(b){ b.querySelector(".sb-num").textContent = n || 0; b.classList.toggle("zero", !n); } };
  const recs = rec.data || [], tits = tit.data || [];
  setSb("sb-cmp-rec", recs.length); setSb("sb-cmp-tit", tits.length);
  $("cmp-rec-lista").innerHTML = rec.error ? `<p class="vazio">Erro: ${esc(rec.error.message)}</p>` : !recs.length ? `<p class="vazio">Nenhum recebimento. Use "Receber NF" quando a mercadoria chegar.</p>` :
    recs.map(r => `<div class="card compacto" style="margin-bottom:10px;"><div class="lista-topo compacta"><h3>${r.tipo === "servico" ? "Serviço" : "NF"} ${esc(r.nf_numero || (r.tipo === "servico" ? "" : "—"))}${r.nf_serie ? "/" + esc(r.nf_serie) : ""} <span class="meta">recebid${r.tipo === "servico" ? "o" : "a"} em ${dataBR(r.data_recebimento)}</span>${CMP_REC_TIPO[r.tipo] ? ` <span class="tag ${CMP_REC_TIPO[r.tipo][1]}">${CMP_REC_TIPO[r.tipo][0]}</span>` : ""}</h3>
      <span style="margin-left:auto;">${r.status === "confirmado" ? '<span class="tag verde">Confirmado</span>' : r.status === "cancelado" ? '<span class="tag cinza">Cancelado</span>' : '<span class="tag ambar">Conferindo</span>'} <strong>${brl(r.total_nf)}</strong></span></div>
      <table><thead><tr><th>Item</th><th class="num">Qtd</th><th class="num">Unit.</th><th>Destino</th></tr></thead><tbody>${(r.itens || []).map(i => `<tr><td>${esc(i.descricao)}</td><td class="num">${num(i.quantidade_aceita)}</td><td class="num">${brl(i.valor_unitario_nf)}</td><td class="meta">${esc(cmpDestinoTxt(i))}</td></tr>`).join("")}</tbody></table>
      ${r.observacoes ? `<p class="meta" style="margin:6px 0 0;">${esc(r.observacoes)}</p>` : ""}
      ${cmpConferenciaLinha(r.id)}
      ${(r.anexos || []).length ? `<div class="meta" style="margin-top:6px;">📎 ${r.anexos.map(a => `<a href="#" class="cmp-anexo" data-path="${esc(a.storage_path)}" data-nome="${esc(a.nome)}">${esc(a.nome)}</a>`).join(" · ")}</div>` : ""}</div>`).join("");
  $("cmp-rec-lista").querySelectorAll(".cmp-anexo").forEach(a => a.addEventListener("click", e => { e.preventDefault(); cmpAbrirAnexo(a.dataset.path, a.dataset.nome); }));
  cmpAtualizarChipFinanceiro(recs, tit.error ? [] : tits);   // fase 102
  $("cmp-tit-lista").innerHTML = !podeVerContasPagar() ? `<p class="vazio">Os títulos deste pedido ficam em Contratos & Contas a pagar; seu perfil não tem acesso a esse módulo.</p>` : tit.error ? `<p class="vazio">Erro: ${esc(tit.error.message)}</p>` : !tits.length ? `<p class="vazio">Nenhum título. Eles nascem no recebimento da NF quando há vencimento informado.</p>` :
    `<div class="tabela-rola"><table><thead><tr><th>Vencimento</th><th>NF</th><th>Parcela</th><th class="num">Valor</th><th>Exportado ao financeiro</th></tr></thead><tbody>${tits.map(t => `<tr><td><strong>${dataBR(t.vencimento)}</strong></td><td>${esc(t.nf_numero || "—")}</td><td>${t.parcela}/${t.total_parcelas}</td><td class="num">${brl(t.valor)}</td><td>${t.exportado_em ? `<span class="tag verde">${dataBR(String(t.exportado_em).slice(0, 10))}</span>` : '<span class="tag ambar">pendente</span>'}</td></tr>`).join("")}</tbody></table></div>`;
}

/* fase 102: linha da conferência no cartão do recebimento */
function cmpConferenciaLinha(recId){
  const c = _cmpConfAtual.lista.find(x => x.recebimento_id === recId);
  if(!c) return "";
  if(!c.pendente) return `<div class="meta" style="margin-top:6px;">✔ Conferido por <strong>${esc(c.conferido_por_nome || "?")}</strong> em ${dataBR(cmpDataLocal(c.conferido_em))}${c.conferencia_obs ? " · " + esc(c.conferencia_obs) : ""}</div>`;
  if(!c.exigida) return `<div class="meta" style="margin-top:6px;">Conferência do solicitante opcional (reposição do estoque).</div>`;
  return c.vencida
    ? `<div class="meta txt-perigo" style="margin-top:6px;">Sem conferência do solicitante há ${Number(c.dias_uteis || 0)} dias úteis: o pedido seguiu com aviso na Sala de Comando.</div>`
    : `<div class="meta txt-aviso" style="margin-top:6px;">Aguardando a conferência de quem pediu (até ${dataBR(cmpSomarDiasUteis(cmpDataLocal(c.confirmado_em), Number(c.prazo_uteis || 5)))}).</div>`;
}
/* fase 102 (#91, etapa 6): chip "Financeiro" com a NF recebida e o próximo vencimento, só para quem lê contas a pagar */
function cmpAtualizarChipFinanceiro(recs, tits){
  const ch = $("cmp-chip-fin"), txt = $("cmp-chip-fin-txt"); if(!ch || !txt) return;
  const conf = (recs || []).filter(r => r.status === "confirmado");
  if(!(typeof podeVerContasPagar === "function" && podeVerContasPagar()) || !conf.length){ ch.style.display = "none"; return; }
  const nfs = [...new Set(conf.map(r => r.nf_numero).filter(Boolean))];
  const pend = (tits || []).filter(t => !t.exportado_em).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  txt.textContent = [nfs.length ? "NF " + nfs.join(", ") : "sem NF",
    pend.length ? `vence ${dataBR(pend[0].vencimento)} (${pend.length} a exportar)` : (tits || []).length ? "títulos exportados" : "sem título a pagar"].join(" · ");
  ch.style.display = "";
}

/* ---------- cotações (fase 102, etapa 3 do #91) ----------
   cotacoes + cotacao_itens: uma por fornecedor, preço por item do pedido, prazo, frete, condição e validade; a
   proposta do fornecedor vai para os anexos do pedido como orçamento (pedido_compra_anexos, mesma regra do lote S48)
   e fica ligada à cotação (anexo_id). Mudam só com o pedido em rascunho ou em cotação (gatilho no banco).
   "Fechar com este fornecedor" = RPC cotacao_fechar: fornecedor, preços, frete, prazo e condição vão para o pedido,
   que volta a rascunho para o comprador conferir e enviar à aprovação. Cotação mínima livre (decisão 3). */
function cmpCotEditavel(){ return cmpPodeOperar() && ["rascunho","em_cotacao"].includes(_cmpAtual?.status) && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()); }
async function cmpCarregarCotacoes(id){
  const { data, error } = await sb.from("cotacoes")
    .select("id,fornecedor_id,status,prazo_entrega_dias,frete,condicao_pagamento,validade,observacoes,anexo_id,escolhida_em,created_at,updated_at,fornecedor:fornecedores(razao_social),itens:cotacao_itens(id,pedido_item_id,valor_unitario,ipi_percentual,icms_percentual),anexo:pedido_compra_anexos(id,nome,storage_path)")   // lote S53 (#166): % IPI / % ICMS cotados
    .eq("pedido_id", id).order("created_at");
  if(_cmpEditId !== id) return;
  const b = $("sb-cmp-cot");
  if(error){
    console.warn("cotacoes:", error.message);   // antes da migration da fase 102
    _cmpCotacoes = [];
    if(b){ b.querySelector(".sb-num").textContent = 0; b.classList.add("zero"); }
    if($("cmp-cot-lista")) $("cmp-cot-lista").innerHTML = `<p class="vazio">Cotações ainda não disponíveis.</p>`;
    return;
  }
  _cmpCotacoes = data || [];
  if(b){ b.querySelector(".sb-num").textContent = _cmpCotacoes.length; b.classList.toggle("zero", !_cmpCotacoes.length); }
  renderCotacoes();
}
function cmpCotItem(c, itemId){ return (c.itens || []).find(x => x.pedido_item_id === itemId) || null; }
function cmpCotPreco(c, itemId){ const i = cmpCotItem(c, itemId); return i && i.valor_unitario !== null && i.valor_unitario !== undefined ? Number(i.valor_unitario) : null; }
/* lote S53 (#166): IPI da cotação por item (o cotado; vazio = o % que o item já tem, que é o que cotacao_fechar mantém) */
function cmpCotIpiItem(c, it){
  const v = cmpCotPreco(c, it.id); if(v === null) return 0;
  const ci = cmpCotItem(c, it.id), pct = ci && ci.ipi_percentual !== null && ci.ipi_percentual !== undefined ? Number(ci.ipi_percentual) : Number(it.ipi_percentual || 0);
  return Math.round(Math.round(v * Number(it.quantidade || 0) * 100) * pct / 100) / 100;
}
function cmpCotIpi(c){ return Math.round(_cmpItens.reduce((s, it) => s + cmpCotIpiItem(c, it), 0) * 100) / 100; }
function cmpCotTotal(c){
  return _cmpItens.reduce((s, it) => { const v = cmpCotPreco(c, it.id); return s + (v === null ? 0 : Math.round(v * Number(it.quantidade || 0) * 100) / 100); }, 0) + cmpCotIpi(c) + Number(c.frete || 0);
}
const CMP_COT_STATUS = { aberta: ["aberta", "azul"], escolhida: ["escolhida", "verde"], descartada: ["descartada", "cinza"] };
function renderCotacoes(){
  const cont = $("cmp-cot-lista"); if(!cont) return;
  const ed = cmpCotEditavel();
  const itens = _cmpItens.filter(it => it.id);
  // lote S53 (#163): ao fechar com o fornecedor, enviar para aprovação na mesma transação (caixa marcada por padrão)
  const topo = `<div class="lista-topo compacta"><h3>Cotações <span class="contador">${_cmpCotacoes.length}</span></h3>
    ${ed ? `<label class="meta" style="display:flex;align-items:center;gap:4px;margin-left:auto;" title="Marcada: 'Fechar com este fornecedor' já manda o pedido para a aprovação (alçada e donos do custo). Desmarcada: o pedido volta a rascunho para você conferir."><input type="checkbox" id="cmp-cot-enviar"${_cmpCotEnviar ? " checked" : ""} /> ao fechar, enviar para aprovação</label>
    <button type="button" class="btn-sec btn-sm" id="btn-cmp-cot-nova">＋ Nova cotação</button>` : ""}</div>`;
  const ligarTopo = () => { $("btn-cmp-cot-nova")?.addEventListener("click", () => cmpAbrirCotacao(null)); $("cmp-cot-enviar")?.addEventListener("change", e => { _cmpCotEnviar = e.target.checked; }); };
  if(!_cmpCotacoes.length){
    cont.innerHTML = topo + `<p class="vazio">${ed ? (itens.length ? "Nenhuma cotação. Registre a proposta de cada fornecedor (1 a N)." : "Salve os itens do pedido antes de cotar.") : "Nenhuma cotação registrada."}</p>`;
    ligarTopo();
    return;
  }
  const vivas = _cmpCotacoes.filter(c => c.status !== "descartada");
  // menor preço por item entre as cotações vivas (abertas e a escolhida)
  const melhor = {};
  itens.forEach(it => { const ps = vivas.map(c => cmpCotPreco(c, it.id)).filter(v => v !== null); if(ps.length) melhor[it.id] = Math.min(...ps); });
  const totais = _cmpCotacoes.map(cmpCotTotal), menorTotal = Math.min(...vivas.map(cmpCotTotal));
  const th = _cmpCotacoes.map(c => { const s = CMP_COT_STATUS[c.status] || [c.status, "cinza"];
    return `<th class="num" style="min-width:150px;"><div>${esc(c.fornecedor?.razao_social || cmpForn(c.fornecedor_id) || "?")}</div><span class="tag ${s[1]}">${esc(s[0])}</span></th>`; }).join("");
  const linhas = itens.map(it => `<tr><td>${esc(it.descricao)}</td><td class="num">${num(it.quantidade)} <span class="meta">${esc(it.unidade || "un")}</span></td>${
    _cmpCotacoes.map(c => { const v = cmpCotPreco(c, it.id); const ehMelhor = v !== null && c.status !== "descartada" && v === melhor[it.id] && vivas.length > 1;
      const ci = cmpCotItem(c, it.id), imp = ci ? [ci.ipi_percentual !== null && ci.ipi_percentual !== undefined ? "IPI " + cmpPct(ci.ipi_percentual) : "", ci.icms_percentual !== null && ci.icms_percentual !== undefined ? "ICMS " + cmpPct(ci.icms_percentual) : ""].filter(Boolean).join(" · ") : "";   // lote S53 (#166)
      return `<td class="num">${v === null ? '<span class="meta">não cotou</span>' : `${brl(v)}<div class="meta">${brl(Math.round(v * Number(it.quantidade || 0) * 100) / 100)}${imp ? " · " + esc(imp) : ""}</div>`}${ehMelhor ? ' <span class="tag verde" title="menor preço deste item entre as cotações">melhor</span>' : ""}</td>`; }).join("")}</tr>`).join("");
  const rodape = (rot, fn) => `<tr><th colspan="2" style="text-align:right;">${rot}</th>${_cmpCotacoes.map(fn).join("")}</tr>`;
  const comIpi = _cmpCotacoes.some(c => cmpCotIpi(c) > 0);
  cont.innerHTML = topo + `<div class="tabela-rola"><table class="itens-tabela"><thead><tr><th>Item</th><th class="num">Qtd</th>${th}</tr></thead><tbody>${linhas}</tbody>
    <tfoot>
      ${comIpi ? rodape("IPI", c => `<td class="num">${brl(cmpCotIpi(c))}</td>`) : ""}
      ${rodape("Frete", c => `<td class="num">${brl(c.frete || 0)}</td>`)}
      ${rodape("Total", (c, i) => `<td class="num"><strong>${brl(totais[i])}</strong>${c.status !== "descartada" && vivas.length > 1 && totais[i] === menorTotal ? ' <span class="tag verde">menor total</span>' : ""}</td>`)}
      ${rodape("Prazo de entrega", c => `<td class="num">${c.prazo_entrega_dias !== null && c.prazo_entrega_dias !== undefined ? esc(c.prazo_entrega_dias) + " dia(s)" : "—"}</td>`)}
      ${rodape("Condição", c => `<td class="num">${esc(c.condicao_pagamento || "—")}</td>`)}
      ${rodape("Validade", c => `<td class="num">${c.validade ? dataBR(c.validade) : "—"}</td>`)}
      ${rodape("Proposta", c => `<td class="num">${c.anexo ? `<a href="#" class="cmp-cot-anexo" data-path="${esc(c.anexo.storage_path)}" data-nome="${esc(c.anexo.nome)}">📎 ${esc(c.anexo.nome)}</a>` : "—"}${c.observacoes ? `<div class="meta">${esc(c.observacoes)}</div>` : ""}</td>`)}
      ${ed ? rodape("", c => `<td class="num" data-cot="${esc(c.id)}">${c.status === "escolhida" ? '<span class="meta">pedido fechado com esta</span><br>' : `<button type="button" class="btn btn-sm cmp-cot-fechar" title="Copia fornecedor, preços, IPI/ICMS, frete, prazo e condição para o pedido; com a caixa 'enviar para aprovação' marcada, já manda para a aprovação">✔ Fechar com este fornecedor</button><br>`}<button type="button" class="btn-sec btn-sm cmp-cot-editar" title="Editar">✏️</button> <button type="button" class="btn-sec btn-sm txt-perigo cmp-cot-excluir" title="Excluir">🗑️</button></td>`) : ""}
    </tfoot></table></div>`;
  ligarTopo();
  cont.querySelectorAll(".cmp-cot-anexo").forEach(a => a.addEventListener("click", e => { e.preventDefault(); cmpAbrirAnexo(a.dataset.path, a.dataset.nome); }));
  cont.querySelectorAll(".cmp-cot-fechar").forEach(b => b.addEventListener("click", () => comBotaoTravado(b, () => cmpFecharCotacao(b.closest("td").dataset.cot))));
  cont.querySelectorAll(".cmp-cot-editar").forEach(b => b.addEventListener("click", () => cmpAbrirCotacao(_cmpCotacoes.find(c => c.id === b.closest("td").dataset.cot))));
  cont.querySelectorAll(".cmp-cot-excluir").forEach(b => b.addEventListener("click", () => cmpExcluirCotacao(b.closest("td").dataset.cot)));
}
function cmpAbrirCotacao(c){
  if(!cmpCotEditavel()) return;
  const itens = _cmpItens.filter(it => it.id);
  if(!itens.length){ aviso("app-aviso", "Salve os itens do pedido antes de cotar.", "erro"); return; }
  _cmpCotEdit = c || {};
  $("cmp-cot-form-titulo").textContent = c ? `Cotação de ${c.fornecedor?.razao_social || cmpForn(c.fornecedor_id) || "?"}` : "Nova cotação";
  $("cmp-cot-forn").value = c?.fornecedor_id || ""; $("cmp-cot-forn").disabled = !!c; cmpFornAtualizar("cmp-cot-forn");
  $("cmp-cot-prazo").value = c?.prazo_entrega_dias ?? ""; $("cmp-cot-frete").value = c?.frete ?? ""; $("cmp-cot-cond").value = c?.condicao_pagamento || "";
  $("cmp-cot-validade").value = c?.validade || ""; $("cmp-cot-obs").value = c?.observacoes || ""; $("cmp-cot-anexo").value = "";
  // lote S53 (#166): % IPI / % ICMS por item (opcionais; vazio mantém o % que o item do pedido já tem, mostrado no placeholder)
  const pctVal = (ci, campo) => ci && ci[campo] !== null && ci[campo] !== undefined ? esc(ci[campo]) : "";
  $("cmp-cot-itens").innerHTML = itens.map(it => { const v = c ? cmpCotPreco(c, it.id) : null, ci = c ? cmpCotItem(c, it.id) : null;
    return `<tr data-item="${esc(it.id)}"><td>${esc(it.descricao)}</td><td class="num">${num(it.quantidade)} <span class="meta">${esc(it.unidade || "un")}</span></td>
      <td><input type="number" class="cmp-cot-preco" step="0.0001" min="0" value="${v === null ? "" : esc(v)}" placeholder="não cotou" style="width:120px;text-align:right;" /></td>
      <td><input type="number" class="cmp-cot-ipi" step="0.01" min="0" max="100" value="${pctVal(ci, "ipi_percentual")}" placeholder="${esc(it.ipi_percentual ?? 0)}" title="% de IPI cotado; vazio mantém o do item" style="width:76px;text-align:right;" /></td>
      <td><input type="number" class="cmp-cot-icms" step="0.01" min="0" max="100" value="${pctVal(ci, "icms_percentual")}" placeholder="${esc(it.icms_percentual ?? 0)}" title="% de ICMS cotado (informativo)" style="width:76px;text-align:right;" /></td>
      <td class="num cmp-cot-tot">${v === null ? "—" : brl(cmpCotLinhaTotal(v, it, ci ? ci.ipi_percentual : null))}</td></tr>`; }).join("");
  $("cmp-cot-itens").querySelectorAll(".cmp-cot-preco, .cmp-cot-ipi").forEach(inp => inp.addEventListener("input", () => {
    const tr = inp.closest("tr"), it = _cmpItens.find(x => x.id === tr.dataset.item), pv = tr.querySelector(".cmp-cot-preco").value, pi = tr.querySelector(".cmp-cot-ipi").value;
    const v = pv === "" ? null : Number(pv);
    tr.querySelector(".cmp-cot-tot").textContent = v === null ? "—" : brl(cmpCotLinhaTotal(v, it || {}, pi === "" ? null : Number(pi)));
  }));
  $("cmp-cot-form").style.display = "";
  $("cmp-cot-form").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
/* total da linha da cotação com IPI (o cotado ou, vazio, o do item) */
function cmpCotLinhaTotal(v, it, ipiCotado){
  const base = Math.round(v * Number(it.quantidade || 0) * 100) / 100, pct = ipiCotado === null || ipiCotado === undefined ? Number(it.ipi_percentual || 0) : Number(ipiCotado);
  return base + Math.round(base * pct) / 100;
}
function cmpFecharFormCotacao(){ _cmpCotEdit = null; if($("cmp-cot-form")) $("cmp-cot-form").style.display = "none"; }
async function cmpSalvarCotacao(){
  const c = _cmpCotEdit, pedidoId = _cmpEditId; if(!c || !pedidoId || !cmpCotEditavel()) return;
  const forn = c.id ? c.fornecedor_id : $("cmp-cot-forn").value;
  if(!forn){ aviso("app-aviso", "Escolha o fornecedor da cotação.", "erro"); return; }
  if(!c.id && _cmpCotacoes.some(x => x.fornecedor_id === forn)){ aviso("app-aviso", "Este fornecedor já tem cotação neste pedido: use ✏️ para editar.", "erro"); return; }
  const prazo = $("cmp-cot-prazo").value === "" ? null : Math.round(Number($("cmp-cot-prazo").value));
  if(prazo !== null && !(prazo >= 0 && prazo <= 365)){ aviso("app-aviso", "Prazo de entrega entre 0 e 365 dias.", "erro"); return; }
  const pct = tr => { const i = tr.querySelector(".cmp-cot-ipi").value, c2 = tr.querySelector(".cmp-cot-icms").value; return { ipi_percentual: i === "" ? null : Number(i), icms_percentual: c2 === "" ? null : Number(c2) }; };   // lote S53 (#166)
  const precos = [...$("cmp-cot-itens").querySelectorAll("tr[data-item]")].map(tr => { const v = tr.querySelector(".cmp-cot-preco").value; return { pedido_item_id: tr.dataset.item, valor_unitario: v === "" ? null : Number(v), ...pct(tr) }; });
  if(precos.some(p => p.valor_unitario !== null && !(p.valor_unitario >= 0))){ aviso("app-aviso", "Preço inválido.", "erro"); return; }
  if(precos.some(p => [p.ipi_percentual, p.icms_percentual].some(x => x !== null && !(x >= 0 && x <= 100)))){ aviso("app-aviso", "% IPI e % ICMS entre 0 e 100.", "erro"); return; }
  if(!precos.some(p => p.valor_unitario !== null)){ aviso("app-aviso", "Informe o preço de pelo menos um item.", "erro"); return; }
  const cab = { prazo_entrega_dias: prazo, frete: Number($("cmp-cot-frete").value || 0), condicao_pagamento: $("cmp-cot-cond").value.trim() || null,
    validade: $("cmp-cot-validade").value || null, observacoes: $("cmp-cot-obs").value.trim() || null };
  let cotId = c.id;
  if(cotId){
    const { error } = await sb.from("cotacoes").update(cab).eq("id", cotId);
    if(error){ aviso("app-aviso", "Cotação não salva: " + error.message, "erro"); return; }
  } else {
    const { data, error } = await sb.from("cotacoes").insert({ pedido_id: pedidoId, fornecedor_id: forn, ...cab }).select("id").single();
    if(error){ aviso("app-aviso", "Cotação não salva: " + (/duplicate|unique/i.test(error.message) ? "este fornecedor já tem cotação neste pedido." : error.message), "erro"); return; }
    cotId = data.id;
  }
  const { error: eIt } = await sb.from("cotacao_itens").upsert(precos.map(p => ({ cotacao_id: cotId, ...p })), { onConflict: "cotacao_id,pedido_item_id" });
  if(eIt){ aviso("app-aviso", "Preços da cotação não salvos: " + eIt.message, "erro"); await cmpCarregarCotacoes(pedidoId); return; }
  // proposta do fornecedor: anexo do pedido (orçamento) ligado à cotação
  const f = ($("cmp-cot-anexo").files || [])[0];
  if(f){
    const ext = (f.name.split(".").pop() || "").toLowerCase(), mime = CMP_ANEXO_MIME[ext];
    if(!mime || f.size > 20 * 1024 * 1024){ aviso("app-aviso", `Cotação salva, mas a proposta "${f.name}" não foi anexada: use PDF, foto, Word ou Excel até 20 MB.`, "erro"); }
    else {
      const nome = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80);
      const caminho = `pedidos/${pedidoId}/${Date.now()}_cot_${nome}`;
      const { data: lin, error: eIns } = await sb.from("pedido_compra_anexos").insert({ pedido_id: pedidoId, tipo: "orcamento", nome: f.name, storage_path: caminho, mime_type: mime, tamanho: f.size, enviado_por: usuarioAtual.id }).select("id").single();
      if(eIns) aviso("app-aviso", "Cotação salva, mas a proposta não foi anexada: " + eIns.message, "erro");
      else {
        // supabase-js ignora contentType quando o corpo é File: reembala com o MIME da extensão
        const corpo = f.type === mime ? f : new Blob([f], { type: mime });
        const { error: eUp } = await sb.storage.from("compras-evidencias").upload(caminho, corpo, { cacheControl: "3600", contentType: mime, upsert: false });
        if(eUp){ await sb.from("pedido_compra_anexos").delete().eq("id", lin.id); aviso("app-aviso", "Cotação salva, mas a proposta não subiu: " + eUp.message, "erro"); }
        else await sb.from("cotacoes").update({ anexo_id: lin.id }).eq("id", cotId);
      }
    }
  }
  if(!appAvisoComErro()) aviso("app-aviso", "Cotação salva.", "ok");
  cmpFecharFormCotacao();
  await cmpCarregarCotacoes(pedidoId);
  cmpCarregarAnexosPedido(pedidoId);
}
async function cmpExcluirCotacao(id){
  const c = _cmpCotacoes.find(x => x.id === id); if(!c || !cmpCotEditavel()) return;
  if(!confirm(`Excluir a cotação de ${c.fornecedor?.razao_social || "?"}? A proposta anexada continua na aba Anexos.`)) return;
  const { error } = await sb.from("cotacoes").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível excluir: " + error.message, "erro"); return; }
  aviso("app-aviso", "Cotação excluída.", "ok");
  await cmpCarregarCotacoes(_cmpEditId);
}
async function cmpFecharCotacao(id){
  const c = _cmpCotacoes.find(x => x.id === id); if(!c) return;
  const semPreco = _cmpItens.filter(it => it.id && cmpCotPreco(c, it.id) === null).length;
  const enviar = $("cmp-cot-enviar") ? !!$("cmp-cot-enviar").checked : _cmpCotEnviar;   // lote S53 (#163)
  if(!confirm(`Fechar o pedido com ${c.fornecedor?.razao_social || "este fornecedor"} (${brl(cmpCotTotal(c))})${enviar ? " e enviar para aprovação" : ""}?\nFornecedor, preços, IPI/ICMS, frete, prazo e condição da cotação vão para o pedido${semPreco ? `; ${semPreco} item(ns) sem preço nesta cotação ficam com o preço atual` : ""}. As outras cotações ficam descartadas.${enviar ? " O pedido segue para a aprovação (alçada e donos do custo)." : " O pedido volta a rascunho para você conferir."}`)) return;
  const pedidoId = _cmpEditId;
  let { data, error } = await sb.rpc("cotacao_fechar", { p_id: id, p_enviar: enviar });
  if(error && /could not find the function|p_enviar/i.test(error.message || "")){ ({ data, error } = await sb.rpc("cotacao_fechar", { p_id: id })); }   // banco ainda sem a migration do lote S53
  if(error){ aviso("app-aviso", (error.message || "").replace(/^(?:ERROR|ERRO|[0-9A-Z]{5})\s*:\s*/, ""), "erro"); return; }
  aviso("app-aviso", data || "Pedido fechado com o fornecedor da cotação.", "ok");
  await cmpFetchPedidos();
  await abrirPedido(pedidoId);
  ativarTabPedido("itens");
}

/* ---------- novo produto a partir do pedido (fase 102, #160) ----------
   Cadastro mínimo (nome, categoria, unidade, NCM opcional; código CGL-NNNNN se vazio) pela RPC produto_cadastro_rapido,
   mesmos cargos da policy produtos_write (admin, almoxarife, comprador, gestor de acessórios; diretor). O tipo de compra
   padrão fica o da categoria; o produto volta já na linha do pedido. O módulo extra do #150 não entra (sem decisão). */
function cmpPodeCadastrarProduto(){ return !!usuarioAtual && ["diretor","admin","almoxarife","comprador","gestor_acessorios"].includes(usuarioAtual.cargo); }
async function cmpAbrirProdutoRapido(){
  if(!cmpPodeCadastrarProduto() || !cmpEditavel()) return;
  if(_cmpCategorias === null){
    const { data } = await sb.from("categorias_produto").select("id,nome,tipo_compra_padrao,ativo").eq("ativo", true).order("nome");
    _cmpCategorias = data || [];
  }
  $("cmp-prod-cat").innerHTML = `<option value="">— sem categoria —</option>` + _cmpCategorias.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  $("cmp-prod-un").innerHTML = (typeof UNIDADES !== "undefined" ? UNIDADES : ["un"]).map(u => `<option value="${esc(u)}"${u === "un" ? " selected" : ""}>${esc(u)}</option>`).join("");
  ["cmp-prod-nome", "cmp-prod-ncm", "cmp-prod-cod"].forEach(id => $(id).value = "");
  const termo = ($("cmp-busca-prod")?.value || "").trim();
  if(termo) $("cmp-prod-nome").value = termo.toUpperCase();
  cmpProdTipoInfo();
  $("cmp-prod-modal").style.display = "flex";
  $("cmp-prod-nome").focus();
}
function cmpProdTipoInfo(){
  const c = (_cmpCategorias || []).find(x => x.id === $("cmp-prod-cat").value);
  const t = c && c.tipo_compra_padrao ? CMP_TIPO_LBL[c.tipo_compra_padrao] : CMP_TIPO_LBL.aplicacao_direta;
  $("cmp-prod-tipo-info").textContent = `Tipo de compra padrão: ${t}${c ? (c.tipo_compra_padrao ? " (pela categoria)" : " (a categoria não define)") : " (sem categoria)"}. O comprador ainda escolhe na linha do pedido.`;
}
function cmpFecharProdutoRapido(){ $("cmp-prod-modal").style.display = "none"; }
async function cmpSalvarProdutoRapido(){
  const nome = $("cmp-prod-nome").value.trim();
  if(!nome){ aviso("app-aviso", "Informe o nome do produto.", "erro"); $("cmp-prod-nome").focus(); return; }
  const ncm = $("cmp-prod-ncm").value.replace(/\D/g, "");
  if(ncm && ncm.length !== 8){ aviso("app-aviso", "NCM tem 8 dígitos (ex.: 8431.43.10).", "erro"); return; }
  const { data, error } = await sb.rpc("produto_cadastro_rapido", { p_nome: nome, p_categoria_id: $("cmp-prod-cat").value || null, p_unidade: $("cmp-prod-un").value || "un",
    p_ncm: ncm || null, p_codigo: $("cmp-prod-cod").value.trim() || null });
  if(error){ aviso("app-aviso", "Produto não cadastrado: " + (error.message || "").replace(/^(?:ERROR|ERRO|[0-9A-Z]{5})\s*:\s*/, ""), "erro"); return; }
  cmpFecharProdutoRapido();
  if($("cmp-busca-prod")){ $("cmp-busca-prod").value = ""; if($("cmp-res-prod")){ $("cmp-res-prod").innerHTML = ""; $("cmp-res-prod").style.display = "none"; } }
  cmpAddItem(data);
  aviso("app-aviso", `Produto ${data.codigo} — ${data.nome} cadastrado e incluído no pedido. Salve o pedido para gravar o item.`, "ok");
}

/* itens */
/* fase 108b: destino padrão de item de APLICAÇÃO DIRETA pelo cabeçalho (TAG, senão obra); sem eles fica para escolher */
function cmpDestinoDiretoPadrao(){
  const obra = $("cmp-obra").value, eq = $("cmp-equip").value;
  if(eq){
    const d = cmpDestinoDoValor("eq:" + eq);
    // lote S53 (#149): "+ TAGs" do cabeçalho → o item novo nasce rateado em partes iguais (a primeira TAG é o equipamento_id)
    if(_cmpRatPadrao.length >= 2 && _cmpRatPadrao[0] === eq){ d._rateio = _cmpRatPadrao.map(id => ({ equipamento_id: id, fracao: 1 / _cmpRatPadrao.length })); d._rateioDirty = true; }
    return d;
  }
  if(obra) return cmpDestinoDoValor("obra:" + obra);
  return { ...CMP_SEM_DESTINO };
}
/* Fase 108b: colunas Tipo de compra (antes do destino), Natureza e Método. Reposição de estoque: o destino é o
   almoxarifado (o custo aparece na saída) e não tem método; Aplicação direta: obra, TAG ou centro obrigatório, natureza
   e método (padrão pela obra). Item sem produto do catálogo não entra no estoque: só aplicação direta. Em rascunho o tipo
   troca livre; depois de aprovado o banco trava (gatilho da 108a) e a tela só mostra. */
function renderItensPedido(){
  const tb = $("cmp-itens"); const ed = cmpEditavel();
  if(!_cmpItens.length){ tb.innerHTML = `<tr><td colspan="14" class="vazio">${ed ? "Adicione produtos do catálogo ou um item livre." : "Sem itens."}</td></tr>`; cmpAtualizarSbItens(); cmpAtualizarChips(); return; }
  tb.innerHTML = _cmpItens.map((it, idx) => {
    const tipo = cmpItemTipo(it), repo = tipo === "reposicao";
    const externo = it.obra_externa || it.centro_custo_externo ? `<div class="meta" title="rateio do Odoo sem cadastro no app">${esc([it.obra_externa, it.centro_custo_externo].filter(Boolean).join(" · "))}</div>` : "";
    const tipoCel = ed
      ? `<select class="cmp-it" data-f="_tipo" style="min-width:140px;max-width:160px;"><option value="reposicao"${repo ? " selected" : ""}${it.produto_id ? "" : ' disabled title="item sem produto do catálogo não entra no estoque"'}>${esc(CMP_TIPO_LBL.reposicao)}</option><option value="aplicacao_direta"${repo ? "" : " selected"}>${esc(CMP_TIPO_LBL.aplicacao_direta)}</option></select>`
      : cmpTipoTag(tipo);
    // lote S53 (#149): destino TAG ganha o botão ⚖ (rateio entre equipamentos) e a linha "+ N TAG(s) (rateio)"
    const destinoCel = repo
      ? `<span class="meta" title="entra no almoxarifado no recebimento; o custo aparece na saída do estoque">${esc(cmpDestinoTxt({ destino: "estoque", centro_custo_id: ed ? $("cmp-centro").value : it.centro_custo_id }))}</span>`
      : ed ? `<select class="cmp-it${it.destino ? "" : " txt-perigo"}" data-f="destino" style="min-width:150px;max-width:190px;">${cmpDestinoDiretoOptions(cmpDestinoValor(it))}</select> <button type="button" class="btn-sec btn-sm cmp-it-rat" title="Ratear este item entre TAGs (partes iguais, ajustáveis)" style="${it.destino === "equipamento" ? "" : "display:none;"}">⚖</button><div class="cmp-it-rat-txt">${cmpDestinoRateioHTML(it)}</div>`
      : esc(cmpDestinoTxt(it)) + cmpDestinoRateioHTML(it);
    const natCel = ed && _cmpNaturezas.length
      ? `<select class="cmp-it" data-f="natureza_id" style="min-width:150px;max-width:190px;"${it.natureza && !_cmpNatMap[it.natureza_id] ? ` title="Odoo: ${esc(it.natureza)}"` : ""}>${cmpNatOptions(it.natureza_id || "")}</select>`
      : `<span class="meta"${it.natureza ? ` title="Odoo: ${esc(it.natureza)}"` : ""}>${esc(cmpNatTxt(it) || "—")}</span>`;
    const metCel = repo ? `<span class="meta" title="o método entra na saída do estoque">—</span>`
      : ed ? `<select class="cmp-it" data-f="metodo" style="min-width:120px;max-width:140px;">${cmpMetodoOptions(it.metodo || "")}</select>`
      : `<span class="meta">${esc(CMP_METODO_LBL[it.metodo] || "—")}</span>`;
    // lote S53 (#166): descrição do item livre em textarea que cresce com o texto; % IPI e % ICMS por item; total com IPI
    return `<tr data-idx="${idx}">
      <td>${it.produto_id ? esc(it.descricao) : (ed ? `<textarea class="cmp-it" data-f="descricao" rows="1" placeholder="descrição do item" style="width:100%;resize:none;overflow:hidden;min-height:34px;">${esc(it.descricao || "")}</textarea>` : esc(it.descricao))}${it.produto_id ? "" : ' <span class="meta">livre</span>'}</td>
      <td>${cmpUnidadeCelula(it, ed)}</td>
      <td>${ed ? `<input type="number" step="0.001" min="0.001" class="cmp-it" data-f="quantidade" value="${esc(it.quantidade ?? 1)}" style="width:80px;text-align:right;" />` : num(it.quantidade)}</td>
      <td>${ed ? `<input type="number" step="0.01" min="0" class="cmp-it" data-f="valor_unitario" value="${esc(it.valor_unitario ?? 0)}" style="width:105px;text-align:right;" />` : brl(it.valor_unitario)}</td>
      <td>${ed ? `<input type="number" step="0.01" min="0" max="100" class="cmp-it" data-f="ipi_percentual" value="${esc(it.ipi_percentual ?? 0)}" title="% de IPI: soma ao total e ao custo" style="width:68px;text-align:right;" />` : `<span class="meta">${esc(cmpPct(it.ipi_percentual) || "—")}</span>`}</td>
      <td>${ed ? `<input type="number" step="0.01" min="0" max="100" class="cmp-it" data-f="icms_percentual" value="${esc(it.icms_percentual ?? 0)}" title="% de ICMS: só informativo" style="width:68px;text-align:right;" />` : `<span class="meta">${esc(cmpPct(it.icms_percentual) || "—")}</span>`}</td>
      <td class="num cmp-it-total">${cmpItemTotalHTML(it)}</td>
      <td>${ed ? `<select class="cmp-it" data-f="categoria_custo">${cmpCatOptions(it.categoria_custo || "peca")}</select>` : esc(CMP_CAT_LBL[it.categoria_custo] || "—")}</td>
      <td>${tipoCel}</td>
      <td>${destinoCel}${!repo && it.destino === "equipamento" && it.obra_id ? `<div class="meta">obra ${esc(cmpObra(it.obra_id))}</div>` : ""}${externo}</td>
      <td>${natCel}</td>
      <td>${metCel}</td>
      <td class="num">${it.quantidade_recebida ? num(it.quantidade_recebida) : "—"}</td>
      <td>${ed ? `<button type="button" class="btn-sec btn-sm cmp-it-rem" title="remover">×</button>` : ""}</td>
    </tr>`; }).join("");
  tb.querySelectorAll(".cmp-it").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", e => {
    const tr = e.target.closest("tr"), it = _cmpItens[Number(tr.dataset.idx)], f = e.target.dataset.f, v = e.target.value;
    if(f === "_tipo"){ cmpTrocarTipoItem(it, v); return; }
    if(f === "destino"){
      const tinhaRateio = cmpTemRateio(it);
      Object.assign(it, cmpDestinoDiretoDoValor(v)); e.target.classList.toggle("txt-perigo", !v);
      if(tinhaRateio){ it._rateio = null; it._rateioDirty = true; }   // lote S53 (#149): trocar a TAG (ou sair dela) desfaz o rateio
      const bRat = tr.querySelector(".cmp-it-rat"), tRat = tr.querySelector(".cmp-it-rat-txt");
      if(bRat) bRat.style.display = it.destino === "equipamento" ? "" : "none";
      if(tRat) tRat.innerHTML = cmpDestinoRateioHTML(it);
      cmpAplicarMetodoPadrao(it); cmpAtualizarChips(); return;
    }
    if(f === "natureza_id"){ it.natureza_id = v || null; it._natAuto = false; return; }
    if(f === "metodo"){ it.metodo = v || null; it._metAuto = false; return; }
    if(f === "unidade"){   // lote S54 (#170): "— outra unidade —" volta à anterior e abre o chamado; o resto regrava a linha (marca ≠)
      if(v === "__outra"){ e.target.value = it.unidade || "un"; cmpPedirUnidadeNova(it); return; }
      it.unidade = v || "un"; renderItensPedido(); return;
    }
    if(f === "categoria_custo" && it._natAuto){   // natureza ainda não escolhida à mão: segue a categoria de custo
      it.categoria_custo = v; it.natureza_id = cmpNatPadrao(cmpItemTipo(it), v); renderItensPedido(); return;
    }
    if(["quantidade", "valor_unitario", "ipi_percentual", "icms_percentual"].includes(f)) it[f] = Number(v || 0);
    else it[f] = v;
    if(e.target.tagName === "TEXTAREA") cmpCrescerTextarea(e.target);
    tr.querySelector(".cmp-it-total").innerHTML = cmpItemTotalHTML(it);
    cmpAtualizarChips();
  }));
  tb.querySelectorAll("textarea.cmp-it").forEach(cmpCrescerTextarea);
  tb.querySelectorAll(".cmp-it-rat").forEach(b => b.addEventListener("click", e => cmpAbrirRateio(Number(e.target.closest("tr").dataset.idx))));
  tb.querySelectorAll(".cmp-it-rem").forEach(b => b.addEventListener("click", e => { _cmpItens.splice(Number(e.target.closest("tr").dataset.idx), 1); renderItensPedido(); }));
  cmpAtualizarSbItens();
  cmpAtualizarChips();
}
function cmpItemTotalHTML(it){ const ipi = cmpItemIpi(it); return brl(cmpItemTotal(it)) + (ipi ? `<div class="meta" title="IPI incluído no total do item">IPI ${brl(ipi)}</div>` : ""); }
/* textarea da descrição cresce com o texto (a aba Itens pode estar escondida na hora do render: ativarTabPedido repete) */
function cmpCrescerTextarea(t){ t.style.height = "auto"; t.style.height = Math.max(34, t.scrollHeight + 2) + "px"; }
/* lote S53 (#166): rodapé Itens · IPI · Frete · Desconto · Total (IPI, frete e desconto só quando há valor) */
function cmpRenderRodapeItens(){
  const tf = $("cmp-itens-rodape"); if(!tf) return;
  if(!_cmpItens.length){ tf.innerHTML = ""; return; }
  const itens = cmpSomaItens(_cmpItens), ipi = cmpSomaIpi(_cmpItens), frete = Number($("cmp-frete").value || 0), desc = Number($("cmp-desc").value || 0);
  const linha = (rot, val, forte) => `<tr><td colspan="6" style="text-align:right;${forte ? "font-weight:700;" : ""}">${rot}</td><td class="num"${forte ? ' style="font-weight:700;"' : ""}>${val}</td><td colspan="7"></td></tr>`;
  tf.innerHTML = linha("Itens", brl(itens)) + (ipi ? linha("IPI", brl(ipi)) : "") + (frete ? linha("Frete", brl(frete)) : "") + (desc ? linha("Desconto", "− " + brl(desc)) : "")
    + linha("Total", brl(itens + ipi + frete - desc), true);
}
function cmpAtualizarSbItens(){ const sbi = $("sb-cmp-itens"); if(sbi){ sbi.querySelector(".sb-num").textContent = _cmpItens.length; sbi.classList.toggle("zero", !_cmpItens.length); } }
/* fase 108b: trocar o tipo em rascunho. Reposição: destino estoque, sem método; aplicação direta: destino pelo
   cabeçalho (ou a escolher) e método pela obra. A natureza só é recalculada enquanto não foi escolhida à mão. */
function cmpTrocarTipoItem(it, tipo){
  it._tipo = tipo;
  if(tipo === "reposicao"){
    Object.assign(it, { destino: "estoque", obra_id: null, equipamento_id: null, centro_custo_id: null, metodo: null });
    it._metAuto = true;
  } else {
    Object.assign(it, cmpDestinoDiretoPadrao());
  }
  if(it._natAuto){ it.natureza_id = cmpNatPadrao(tipo, it.categoria_custo); }
  renderItensPedido();
  if(tipo === "aplicacao_direta") cmpAplicarMetodoPadrao(it);
}
function cmpAddItem(p){
  if(p?.id && p.unidade) _cmpProdUn[p.id] = p.unidade;   // lote S54 (#170): unidade do cadastro = padrão da linha
  // fase 108b: o produto sugere o tipo (produto → categoria → aplicação direta); item livre é aplicação direta
  const tipo = p ? cmpTipoPadraoProduto(p) : "aplicacao_direta";
  const d = tipo === "reposicao" ? { destino: "estoque", obra_id: null, equipamento_id: null, centro_custo_id: null } : cmpDestinoDiretoPadrao();
  const it = { produto_id: p?.id || null, descricao: p ? `${p.codigo} — ${p.nome}` : "", unidade: p?.unidade || "un", quantidade: 1,
    valor_unitario: Number(p?.custo_ultimo || 0), categoria_custo: p?.categoria_custo || "peca", ipi_percentual: 0, icms_percentual: 0, ...d, quantidade_recebida: 0,   // lote S53 (#166)
    _tipo: tipo, natureza_id: null, _natAuto: true, metodo: null, _metAuto: true };
  it.natureza_id = cmpNatPadrao(tipo, it.categoria_custo);
  _cmpItens.push(it);
  renderItensPedido();
  if(tipo === "aplicacao_direta") cmpAplicarMetodoPadrao(it);
  if(!p){ const inp = $("cmp-itens").querySelector(`tr[data-idx="${_cmpItens.length - 1}"] textarea[data-f=descricao]`); if(inp) inp.focus(); }
}
/* ---------- lote S53 (#149): modal de rateio entre TAGs ----------
   idx = índice do item em _cmpItens; null = "+ TAGs" do cabeçalho (TAGs padrão dos itens novos). Marcar/desmarcar uma TAG
   iguala as partes; o % é ajustável à mão e "Igualar" volta a partes iguais. Aplicar normaliza para 100%. */
function cmpAbrirRateio(idx){
  if(!cmpEditavel()) return;
  const it = idx === null ? null : _cmpItens[idx]; if(idx !== null && !it) return;
  const atual = it ? (cmpTemRateio(it) ? it._rateio : (it.equipamento_id ? [{ equipamento_id: it.equipamento_id, fracao: 1 }] : []))
                   : (_cmpRatPadrao.length ? _cmpRatPadrao.map(id => ({ equipamento_id: id, fracao: 1 / _cmpRatPadrao.length })) : ($("cmp-equip").value ? [{ equipamento_id: $("cmp-equip").value, fracao: 1 }] : []));
  _cmpRat = { idx, sel: new Map(atual.map(r => [r.equipamento_id, Math.round(Number(r.fracao) * 10000) / 100])) };
  $("cmp-rat-titulo").textContent = it ? `Rateio entre TAGs — ${(it.descricao || "item").slice(0, 60)}` : "TAGs padrão dos itens novos";
  $("cmp-rat-ajuda").textContent = it
    ? "Marque as TAGs e ajuste os percentuais (partes iguais por padrão). O custo do item cai em cada TAG na proporção e cada TAG pede a assinatura do seu dono do custo. O rateio é gravado no Salvar."
    : "Os itens novos de aplicação direta nascem rateados entre estas TAGs em partes iguais (a primeira vira a TAG padrão do cabeçalho). Ajuste item a item depois, se precisar.";
  $("cmp-rat-busca").value = "";
  cmpRatRender();
  $("cmp-rat-modal").style.display = "flex";
  $("cmp-rat-busca").focus();
}
function cmpRatRender(){
  const r = _cmpRat; if(!r) return;
  const f = cmpNorm($("cmp-rat-busca").value.trim());
  const lista = _cmpEquips.filter(e => r.sel.has(e.id) || !f || cmpNorm(e.codigo + " " + (e.nome || "")).includes(f));
  $("cmp-rat-lista").innerHTML = lista.map(e => { const on = r.sel.has(e.id); return `<tr data-eq="${esc(e.id)}"${on ? ' class="sep-ok"' : ""}>
    <td><input type="checkbox" class="cmp-rat-chk"${on ? " checked" : ""} /></td>
    <td>TAG ${esc(e.codigo)}${e.nome ? ` <span class="meta">${esc(e.nome)}</span>` : ""}</td>
    <td>${on ? `<input type="number" class="cmp-rat-pct" min="0.01" max="100" step="0.01" value="${esc(r.sel.get(e.id))}" style="width:90px;text-align:right;" />` : ""}</td></tr>`; }).join("")
    || `<tr><td colspan="3" class="vazio">Nenhuma TAG com esse texto.</td></tr>`;
  $("cmp-rat-lista").querySelectorAll(".cmp-rat-chk").forEach(cb => cb.addEventListener("change", () => {
    const id = cb.closest("tr").dataset.eq;
    if(cb.checked) r.sel.set(id, 0); else r.sel.delete(id);
    cmpRatIgualar();
  }));
  $("cmp-rat-lista").querySelectorAll(".cmp-rat-pct").forEach(inp => inp.addEventListener("input", () => { r.sel.set(inp.closest("tr").dataset.eq, Number(inp.value || 0)); cmpRatSoma(); }));
  cmpRatSoma();
}
function cmpRatIgualar(){
  const r = _cmpRat; if(!r) return;
  const ids = [...r.sel.keys()], n = ids.length;
  if(n){ const base = Math.floor(10000 / n) / 100, resto = Math.round((100 - base * n) * 100) / 100;
    ids.forEach((id, i) => r.sel.set(id, i === n - 1 ? Math.round((base + resto) * 100) / 100 : base)); }
  cmpRatRender();
}
function cmpRatSoma(){
  const r = _cmpRat; if(!r) return;
  const soma = Math.round([...r.sel.values()].reduce((s, v) => s + Number(v || 0), 0) * 100) / 100;
  $("cmp-rat-soma").innerHTML = r.sel.size
    ? `${r.sel.size} TAG(s) · soma <strong>${soma.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong>${Math.abs(soma - 100) > 0.01 ? ' <span class="txt-aviso">(ao aplicar, as partes são ajustadas para somar 100%)</span>' : ""}`
    : "Nenhuma TAG marcada.";
}
function cmpRatAplicar(){
  const r = _cmpRat; if(!r) return;
  const ids = [...r.sel.keys()].filter(id => Number(r.sel.get(id)) > 0);
  if(r.sel.size && !ids.length){ aviso("app-aviso", "Os percentuais precisam ser maiores que zero.", "erro"); return; }
  const soma = ids.reduce((s, id) => s + Number(r.sel.get(id)), 0);
  const rateio = cmpOrdenarRateio(ids.map(id => ({ equipamento_id: id, fracao: Number(r.sel.get(id)) / soma })));
  if(r.idx === null){
    _cmpRatPadrao = rateio.length >= 2 ? rateio.map(x => x.equipamento_id) : [];
    if(rateio.length) $("cmp-equip").value = rateio[0].equipamento_id;
    cmpRatPadraoTxt(); cmpAtualizarChips();
  } else {
    const it = _cmpItens[r.idx]; if(!it) return;
    if(!ids.length){ aviso("app-aviso", "Marque ao menos uma TAG.", "erro"); return; }
    const tinha = cmpTemRateio(it);
    Object.assign(it, { destino: "equipamento", obra_id: null, equipamento_id: rateio[0].equipamento_id, centro_custo_id: null });
    it._rateio = rateio.length >= 2 ? rateio : null;
    it._rateioDirty = it._rateioDirty || tinha || rateio.length >= 2;
    renderItensPedido();
  }
  cmpRatFechar();
}
function cmpRatLimpar(){
  const r = _cmpRat; if(!r) return;
  if(r.idx === null){ _cmpRatPadrao = []; cmpRatPadraoTxt(); }
  else { const it = _cmpItens[r.idx]; if(it && cmpTemRateio(it)){ it._rateio = null; it._rateioDirty = true; renderItensPedido(); } }
  cmpRatFechar();
}
function cmpRatFechar(){ _cmpRat = null; if($("cmp-rat-modal")) $("cmp-rat-modal").style.display = "none"; }
function cmpRatPadraoTxt(){
  const el = $("cmp-rat-padrao-txt"); if(!el) return;
  if(_cmpRatPadrao.length >= 2){ el.style.display = ""; el.textContent = "Itens novos rateados em partes iguais: " + _cmpRatPadrao.map(id => "TAG " + (cmpEq(id) || "?")).join(" + "); }
  else { el.style.display = "none"; el.textContent = ""; }
}
async function cmpBuscarProdutos(termo){
  if(!termo || termo.length < 2) return [];
  const t = termo.replace(/[%,()]/g, " ").trim();
  // fase 108b: tipo de compra padrão do produto e da categoria (o do produto vence)
  const { data } = await sb.from("produtos").select("id,codigo,nome,unidade,estoque_atual,custo_ultimo,categoria_custo,fornecedor_padrao_id,tipo_compra_padrao,categoria:categorias_produto(nome,tipo_compra_padrao)").eq("ativo", true).or(`nome.ilike.%${t}%,codigo.ilike.%${t}%`).order("nome").limit(25);
  return data || [];
}
function cmpLigarBusca(inpId, listaId, aoEscolher){
  const inp = $(inpId), lista = $(listaId); if(!inp || !lista) return;
  let t = null;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = inp.value.trim();
      if(termo.length < 2){ lista.innerHTML = ""; lista.style.display = "none"; return; }
      const res = await cmpBuscarProdutos(termo);
      lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">estoque ${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}${p.custo_ultimo ? " · último " + brl(p.custo_ultimo) : ""}</span></div>`).join("")
        : `<div class="resultado-item vazio">Nenhum produto. Use "Item livre" ou cadastre em Produtos.</div>`;
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => { const p = res.find(x => x.id === d.dataset.id); inp.value = ""; lista.innerHTML = ""; lista.style.display = "none"; aoEscolher(p); }));
    }, 250);
  });
}

/* ---------- fornecedor com busca (lote S43, chamado #53) ----------
   O <select> com 641 fornecedores continua existindo (escondido, mesmo id e valor): cmpAtualizarChips, a condição
   de pagamento padrão, salvarPedido, o XML da NF e o custo avulso não mudam. Em cima dele entra um campo de busca
   (razão social, fantasia ou CNPJ, até 25 resultados, na memória de _cmpForns) que, ao escolher, vira chip com ×.
   Quem troca o valor do select pelo código chama cmpFornAtualizar(id) para o chip acompanhar.
   Reaproveitável por Contratos: cmpCampoFornecedor("<id do select>") depois de cmpCarregarBase().
   Lote S45 (L2): o filtro do painel (cmp-f-forn) usa o mesmo campo, com placeholder curto (2º parâmetro). */
const _cmpFornCampos = {};
function cmpNorm(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function cmpFornRotulo(f){ return f ? f.razao_social + (f.nome_fantasia && f.nome_fantasia !== f.razao_social ? ` (${f.nome_fantasia})` : "") : ""; }
function cmpCampoFornecedor(idSelect, placeholder){
  if(_cmpFornCampos[idSelect]) return _cmpFornCampos[idSelect];
  const sel = $(idSelect); if(!sel) return null;
  sel.style.display = "none";
  const wrap = document.createElement("div"); wrap.className = "forn-campo"; wrap.id = idSelect + "-busca-wrap";
  wrap.innerHTML = `<span class="forn-chip" style="display:none;"><strong></strong><button type="button" class="forn-chip-x" title="trocar o fornecedor">×</button></span>
    <input class="forn-busca" placeholder="${esc(placeholder || "razão social, fantasia ou CNPJ (≥ 2 letras)…")}" autocomplete="off" />
    <div class="autocomplete-lista" style="display:none;"></div>`;
  sel.insertAdjacentElement("afterend", wrap);
  const chip = wrap.querySelector(".forn-chip"), chipTxt = chip.querySelector("strong"), x = chip.querySelector(".forn-chip-x");
  const inp = wrap.querySelector(".forn-busca"), lista = wrap.querySelector(".autocomplete-lista");
  const fechar = () => { lista.style.display = "none"; lista.innerHTML = ""; };
  function atualizar(){
    const f = _cmpFornMap[sel.value];
    const texto = f ? cmpFornRotulo(f) : (sel.value ? (sel.options[sel.selectedIndex]?.text || sel.value) : "");
    chip.style.display = texto ? "" : "none"; chipTxt.textContent = texto;
    x.style.display = sel.disabled ? "none" : "";
    inp.style.display = texto ? "none" : ""; inp.disabled = sel.disabled;
  }
  const escolher = id => { sel.value = id || ""; inp.value = ""; fechar(); sel.dispatchEvent(new Event("change", { bubbles: true })); atualizar(); if(!id) inp.focus(); };
  inp.addEventListener("input", debounce(() => {
    const t = cmpNorm(inp.value.trim()), dig = t.replace(/\D/g, "");
    if(t.length < 2){ fechar(); return; }
    const res = _cmpForns.filter(f => cmpNorm(f.razao_social).includes(t) || cmpNorm(f.nome_fantasia).includes(t)
      || (dig.length >= 3 && String(f.cpf_cnpj || "").replace(/\D/g, "").includes(dig))).slice(0, 25);
    lista.innerHTML = res.length
      ? res.map(f => `<div class="resultado-item" data-id="${esc(f.id)}"><strong>${esc(f.razao_social)}</strong>${f.nome_fantasia && f.nome_fantasia !== f.razao_social ? ` <span class="meta">${esc(f.nome_fantasia)}</span>` : ""}<span class="meta" style="float:right;">${esc([f.cpf_cnpj, f.cidade].filter(Boolean).join(" · "))}</span></div>`).join("")
      : `<div class="resultado-item vazio">Nenhum fornecedor com esse nome ou CNPJ. Cadastre em Fornecedores.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("mousedown", ev => { ev.preventDefault(); escolher(d.dataset.id); }));
  }, 150));
  inp.addEventListener("keydown", ev => {
    if(ev.key === "Enter"){ const d = lista.querySelector(".resultado-item[data-id]"); if(d){ ev.preventDefault(); escolher(d.dataset.id); } }
    if(ev.key === "Escape") fechar();
  });
  inp.addEventListener("blur", () => setTimeout(fechar, 150));
  x.addEventListener("click", () => escolher(""));
  sel.addEventListener("change", atualizar);
  _cmpFornCampos[idSelect] = { atualizar };
  atualizar();
  return _cmpFornCampos[idSelect];
}
function cmpFornAtualizar(idSelect){ const c = _cmpFornCampos[idSelect]; if(c) c.atualizar(); }

/* salvar / ações */
function cmpColetarCabecalho(){
  return {
    fornecedor_id: $("cmp-forn").value || null, data_pedido: $("cmp-data").value || hojeISO(), previsao_entrega: $("cmp-prev").value || null,
    condicao_pagamento: $("cmp-cond").value.trim() || null, local_entrega: $("cmp-local").value, obra_id: $("cmp-obra").value || null, equipamento_id: $("cmp-equip").value || null,
    centro_custo_id: $("cmp-centro").value || null,
    responsavel_recebimento_id: $("cmp-resp-receb").value || _cmpAtual?.solicitante_id || null,   // fase 78 (pedido novo sem escolha: o gatilho põe o solicitante)
    frete: Number($("cmp-frete").value || 0), desconto: Number($("cmp-desc").value || 0), observacoes: $("cmp-obs").value.trim() || null
  };
}
async function salvarPedido(silencioso){
  if(!cmpEditavel()){ if(!silencioso) aviso("app-aviso", "Este pedido não está em rascunho.", "erro"); return null; }
  const dados = cmpColetarCabecalho();
  if(dados.local_entrega === "obra" && !dados.obra_id){ aviso("app-aviso", "Entrega direto na obra: escolha a obra.", "erro"); ativarTabPedido("cabecalho"); return null; }
  for(const it of _cmpItens){
    if(!it.descricao || !String(it.descricao).trim()){ aviso("app-aviso", "Há item sem descrição.", "erro"); ativarTabPedido("itens"); return null; }
    if(!(Number(it.quantidade) > 0)){ aviso("app-aviso", `Quantidade inválida em "${it.descricao}".`, "erro"); ativarTabPedido("itens"); return null; }
    // fase 108b: aplicação direta exige obra, TAG ou centro; reposição exige produto do catálogo (sem ele não entra no estoque)
    const tipo = cmpItemTipo(it);
    if(tipo === "aplicacao_direta" && (!it.destino || it.destino === "estoque")){ aviso("app-aviso", `"${it.descricao}" é aplicação direta: escolha a obra, a TAG ou o centro de custo.`, "erro"); ativarTabPedido("itens"); return null; }
    if(tipo === "reposicao" && !it.produto_id){ aviso("app-aviso", `"${it.descricao}" não tem produto do catálogo e não entra no estoque: mude para aplicação direta.`, "erro"); ativarTabPedido("itens"); return null; }
    if(it.destino === "obra" && !it.obra_id || it.destino === "equipamento" && !it.equipamento_id || it.destino === "centro_custo" && !it.centro_custo_id){ aviso("app-aviso", `Destino incompleto em "${it.descricao}".`, "erro"); ativarTabPedido("itens"); return null; }
  }
  let id = _cmpEditId;
  if(id){
    const { error } = await sb.from("pedidos_compra").update(dados).eq("id", id);
    if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return null; }
  } else {
    const { data, error } = await sb.from("pedidos_compra").insert(dados).select("id").single();
    if(error){ aviso("app-aviso", "Erro ao criar o pedido: " + error.message, "erro"); return null; }
    id = data.id;
  }
  const linha = (it, i) => ({
      pedido_id: id, ordem: i, produto_id: it.produto_id || null, descricao: String(it.descricao).trim(), unidade: it.unidade || "un", quantidade: Number(it.quantidade),
      valor_unitario: Number(it.valor_unitario || 0), categoria_custo: it.categoria_custo || null, destino: it.destino || "estoque", obra_id: it.obra_id || null, equipamento_id: it.equipamento_id || null,
      // fase 76: centro como custo (destino centro_custo) ou, no item para o almoxarifado, como identificação de quem pediu
      centro_custo_id: it.destino === "centro_custo" ? (it.centro_custo_id || null) : (it.destino || "estoque") === "estoque" ? (dados.centro_custo_id || null) : null,
      // fase 65: item importado do Odoo guarda o rateio original ao ser regravado
      natureza: it.natureza || null, centro_custo_externo: it.centro_custo_externo || null, obra_externa: it.obra_externa || null, codigo_externo: it.codigo_externo || null, observacoes: it.observacoes || null,
      // fase 108b: natureza (cadastro) e método; reposição não leva método (entra na saída do estoque). tipo_compra é gerada pelo destino
      natureza_id: it.natureza_id || null, metodo: (it.destino || "estoque") === "estoque" ? null : (it.metodo || null),
      // lote S53 (#166): % IPI (soma ao total) e % ICMS (informativo)
      ipi_percentual: Number(it.ipi_percentual || 0), icms_percentual: Number(it.icms_percentual || 0)
    });
  // fase 102: os itens são gravados mantendo o id (as cotações e o item da requisição apontam para eles). Antes apagava
  // e reinseria tudo, e o vínculo requisicao_item_id do item se perdia no primeiro "Salvar".
  const { data: atuais, error: eSel } = await sb.from("pedido_compra_itens").select("id").eq("pedido_id", id);
  if(eSel){ aviso("app-aviso", "Erro ao ler os itens gravados: " + eSel.message, "erro"); return null; }
  const gravados = new Set((atuais || []).map(r => r.id));
  const manter = new Set(_cmpItens.filter(it => it.id && gravados.has(it.id)).map(it => it.id));
  const remover = [...gravados].filter(x => !manter.has(x));
  if(remover.length){
    const { error: eDel } = await sb.from("pedido_compra_itens").delete().in("id", remover);
    if(eDel){ aviso("app-aviso", "Erro ao tirar itens do pedido: " + eDel.message, "erro"); return null; }
  }
  const comId = _cmpItens.map((it, i) => ({ it, i })).filter(x => manter.has(x.it.id));
  const res = await Promise.all(comId.map(x => sb.from("pedido_compra_itens").update(linha(x.it, x.i)).eq("id", x.it.id)));
  const eUpd = res.find(r => r.error);
  if(eUpd){ aviso("app-aviso", "Erro ao salvar itens: " + eUpd.error.message, "erro"); return null; }
  const novos = _cmpItens.map((it, i) => ({ it, i })).filter(x => !manter.has(x.it.id));
  if(novos.length){
    // lote S53 (#149): o insert devolve os ids (por ordem) para o rateio apontar para o item novo
    const { data: ins, error: eIns } = await sb.from("pedido_compra_itens").insert(novos.map(x => linha(x.it, x.i))).select("id,ordem");
    if(eIns){ aviso("app-aviso", "Erro ao salvar itens: " + eIns.message, "erro"); return null; }
    (ins || []).forEach(r => { const x = novos.find(n => n.i === r.ordem); if(x) x.it.id = r.id; });
  }
  // lote S53 (#149): rateio dos itens que mudaram (RPC pedido_item_rateio_definir; lista com uma TAG só ou vazia apaga o rateio)
  for(const it of _cmpItens.filter(x => x.id && x._rateioDirty)){
    const eqs = cmpTemRateio(it) ? it._rateio.map(r => r.equipamento_id) : (it.destino === "equipamento" && it.equipamento_id ? [it.equipamento_id] : []);
    const frs = cmpTemRateio(it) ? it._rateio.map(r => r.fracao) : null;
    const { error: eRat } = await sb.rpc("pedido_item_rateio_definir", { p_item: it.id, p_equipamentos: eqs, p_fracoes: frs });
    if(eRat){ aviso("app-aviso", `Pedido salvo, mas o rateio de "${it.descricao}" não foi gravado: ` + (eRat.message || "").replace(/^(?:ERROR|ERRO|[0-9A-Z]{5})\s*:\s*/, ""), "erro"); }
    else it._rateioDirty = false;
  }
  if(!silencioso && !appAvisoComErro()) aviso("app-aviso", "Pedido salvo.", "ok");
  _cmpEditId = id;
  return id;
}
async function cmpAcao(acao){
  if(acao === "pdf"){ return cmpPdfPedido(); }
  if(acao === "receber"){ return abrirRecebimento(_cmpAtual); }
  if(acao === "receber_servico"){ return abrirReceberServico(); }   // fase 78
  if(acao === "conferir"){ return cmpConferirRecebimentos(); }      // fase 102
  let id = _cmpEditId;
  try {
    if(acao === "em_cotacao"){
      // fase 102: grava o rascunho antes (as cotações apontam para os itens gravados) e manda para cotação
      id = await salvarPedido(true); if(!id) return;
      if(!_cmpItens.length){ aviso("app-aviso", "Adicione os itens antes de pedir cotações.", "erro"); return; }
      const { error } = await sb.rpc("pedido_mudar_status", { p_id: id, p_status: "em_cotacao" }); if(error) throw error;
      aviso("app-aviso", "Pedido em cotação. Registre as propostas na aba Cotações e feche com o fornecedor escolhido.", "ok");
      await cmpFetchPedidos();
      await abrirPedido(id);
      ativarTabPedido("cotacoes");
      return;
    } else if(acao === "enviar_aprovacao"){
      // fase 108b: natureza é o 2º eixo da distribuição; sem ela o envio segue, mas o comprador confirma
      const semNat = _cmpItens.filter(i => cmpItemTipo(i) === "aplicacao_direta" && !i.natureza_id && !i.natureza).length;
      if(semNat && !confirm(`${semNat} item(ns) de aplicação direta sem natureza do gasto. Enviar para aprovação assim mesmo?`)){ ativarTabPedido("itens"); return; }
      id = await salvarPedido(true); if(!id) return;
      const { data, error } = await sb.rpc("pedido_enviar_aprovacao", { p_id: id }); if(error) throw error;
      if(data === "aprovado") aviso("app-aviso", "Pedido aprovado: a sua assinatura fechou todas as chaves. Marque como enviado quando mandar ao fornecedor.", "ok");
      else {
        const { data: falta } = await sb.from("vw_pedidos_aprovacao_pendente").select("quem_assina").eq("pedido_id", id).order("chave");
        aviso("app-aviso", "Pedido enviado para aprovação." + ((falta || []).length ? " Falta assinar: " + falta.map(f => f.quem_assina).join("; ") + "." : ""), "ok");
      }
    } else if(acao === "aprovar"){
      // fase 108b: a RPC assina todas as chaves que o usuário pode e devolve o que assinou e o que falta
      const { data, error } = await sb.rpc("pedido_aprovar", { p_id: id }); if(error) throw error;
      aviso("app-aviso", typeof data === "string" && data ? data : "Assinatura registrada.", "ok");
    } else if(acao === "enviado"){
      const { error } = await sb.rpc("pedido_mudar_status", { p_id: id, p_status: "enviado" }); if(error) throw error;
      aviso("app-aviso", "Pedido marcado como enviado ao fornecedor.", "ok");
    } else if(acao === "rascunho"){
      const { error } = await sb.rpc("pedido_mudar_status", { p_id: id, p_status: "rascunho" }); if(error) throw error;
      aviso("app-aviso", "Pedido voltou para rascunho.", "ok");
    } else if(acao === "cancelar"){
      const motivo = prompt("Motivo do cancelamento:"); if(motivo === null) return;
      const { error } = await sb.rpc("pedido_mudar_status", { p_id: id, p_status: "cancelado", p_motivo: motivo || null }); if(error) throw error;
      aviso("app-aviso", "Pedido cancelado.", "ok");
    }
  } catch(e){
    // fase 108b: só tira prefixo técnico ("ERROR: ", SQLSTATE); antes cortava até o 1º ": " e a mensagem da RPC
    // ("Você não tem assinatura pendente neste pedido. Falta: …") virava só o fim
    aviso("app-aviso", (e.message || String(e)).replace(/^(?:ERROR|ERRO|[0-9A-Z]{5})\s*:\s*/, ""), "erro"); return;
  }
  await cmpFetchPedidos();
  await abrirPedido(id);
}

/* ---------- recebimento ---------- */
function abrirRecebimento(pedido, modo){
  if(!cmpPodeOperar()) return;
  const semPedido = !pedido;
  const direta = modo === "compra_direta";   // fase 78
  _cmpRec = { pedido: pedido || null, itens: [], xml: null, duplicatas: null, modo: direta ? "compra_direta" : "nf" };
  $("cmp-rec-anexos-campo").style.display = direta ? "" : "none"; $("cmp-rec-anexos").value = "";
  $("cmp-rec-th-pend").textContent = direta ? "Categoria" : "Pendente";
  $("btn-cmp-rec-confirmar").textContent = direta ? "🧾 Registrar compra" : "✅ Confirmar recebimento";
  $("cmp-rec-ajuda").textContent = direta
    ? "Compra já feita, com a nota na mão. Registrar cria o pedido já recebido, dá entrada no almoxarifado (reposição de estoque) ou lança o custo no destino (aplicação direta: obra, TAG ou setor) e gera os títulos a pagar. Acima da sua alçada, vai para aprovação."
    : "Confirmar dá entrada no almoxarifado (reposição de estoque) ou lança o custo no destino (aplicação direta), baixa o pedido e cria os títulos a pagar. O tipo de compra dos itens do pedido vem aprovado e não muda aqui.";
  $("cmp-rec-xml").value = "";
  $("cmp-rec-xml-info").textContent = "Clique ou arraste o XML aqui. Preenche cabeçalho, duplicatas e itens; casa os produtos por código do fornecedor, EAN e pedido.";
  $("cmp-rec-titulo").textContent = direta ? "Compra direta (nota na mão)" : semPedido ? "Receber NF sem pedido" : `Receber NF — pedido ${pedido.numero}`;
  $("cmp-rec-forn").value = pedido?.fornecedor_id || ""; $("cmp-rec-forn").disabled = !semPedido; cmpFornAtualizar("cmp-rec-forn");
  if($("cmp-rec-contrato")) $("cmp-rec-contrato").value = "";
  cmpRecPreencherContratos(); // fase 57: NF de contrato recorrente (só sem pedido)
  ["cmp-rec-nf","cmp-rec-chave","cmp-rec-emissao","cmp-rec-frete","cmp-rec-venc","cmp-rec-total","cmp-rec-obs"].forEach(id => $(id).value = "");
  $("cmp-rec-serie").value = "1"; $("cmp-rec-parc").value = "1"; $("cmp-rec-data").value = hojeISO();
  if(pedido && pedido.condicao_pagamento && /(\d+)\s*dias?/i.test(pedido.condicao_pagamento)){
    const dias = Number(RegExp.$1); const d = new Date(); d.setDate(d.getDate() + dias); $("cmp-rec-venc").value = d.toISOString().slice(0, 10);
    const parc = (pedido.condicao_pagamento.match(/\d+/g) || []).length; if(parc > 1) $("cmp-rec-parc").value = parc;
  }
  if(pedido){
    _cmpItens.forEach(it => {
      const pend = Number(it.quantidade || 0) - Number(it.quantidade_recebida || 0);
      if(pend <= 0) return;
      _cmpRec.itens.push({ pedido_item_id: it.id, produto_id: it.produto_id, descricao: it.descricao, unidade: it.unidade, pendente: pend, quantidade_nf: pend, valor_unitario_nf: Number(it.valor_unitario || 0),
        categoria_custo: it.categoria_custo, destino: it.destino, obra_id: it.obra_id, equipamento_id: it.equipamento_id, centro_custo_id: it.centro_custo_id || null,
        ipi_percentual: Number(it.ipi_percentual || 0), icms_percentual: Number(it.icms_percentual || 0) });   // lote S53 (#166): copiados do item do pedido (o XML sobrepõe)
    });
  }
  renderItensRecebimento();
  $("cmp-rec-modal").style.display = "flex";
}
function fecharRecebimento(){ $("cmp-rec-modal").style.display = "none"; _cmpRec = null; }
/* Fase 57: NF de contrato recorrente (aluguel, locação, seguro…) recebida sem pedido aponta o contrato; em
   recebimento_confirmar o título previsto do mês é substituído pelo da nota, sem duplicar. A lista traz só
   os contratos vigentes que o perfil enxerga (RLS); para quem não vê contratos o campo fica oculto. */
let _cmpContratosForn = null;
async function cmpRecPreencherContratos(){
  const campo = $("cmp-rec-contrato-campo"), sel = $("cmp-rec-contrato"); if(!campo || !sel) return;
  if(_cmpRec?.pedido || _cmpRec?.modo === "compra_direta"){ campo.style.display = "none"; sel.value = ""; return; }
  if(_cmpContratosForn === null){
    const { data } = await sb.from("contratos").select("id,numero,descricao,fornecedor_id,categoria").eq("natureza", "fornecedor").in("status", ["vigente","renovado"]).order("numero");
    _cmpContratosForn = data || [];
  }
  const forn = $("cmp-rec-forn").value;
  const lista = _cmpContratosForn.filter(c => !forn || c.fornecedor_id === forn);
  const atual = sel.value;
  sel.innerHTML = `<option value="">— não é NF de contrato —</option>` + lista.map(c => `<option value="${esc(c.id)}">${esc(c.numero)} — ${esc(c.descricao || (typeof CONTRATO_CATEGORIA === "object" && CONTRATO_CATEGORIA[c.categoria]) || "")}</option>`).join("");
  if([...sel.options].some(o => o.value === atual)) sel.value = atual;
  campo.style.display = lista.length ? "" : "none";
}
function renderItensRecebimento(){
  const tb = $("cmp-rec-itens"); const its = _cmpRec?.itens || [];
  if(!its.length){ tb.innerHTML = `<tr><td colspan="9" class="vazio">${_cmpRec?.pedido ? "Tudo deste pedido já foi recebido. Adicione itens fora do pedido se a nota trouxer." : "Adicione os itens da nota."}</td></tr>`; }
  else tb.innerHTML = its.map((it, idx) => `<tr data-idx="${idx}">
      <td>${it.livre && !it.produto_id ? `<input class="cmp-ri" data-f="descricao" value="${esc(it.descricao || "")}" placeholder="descrição na nota" style="width:100%;" />` : `<strong>${esc(it.descricao)}</strong>`}${it.codigo_fornecedor ? ` <span class="meta">cód. ${esc(it.codigo_fornecedor)}</span>` : ""}${cmpRiBadge(it)}
        ${it.pedido_item_id && it.casamento !== "manual" && it.produto_id ? (it.produto_txt && it.produto_txt !== it.descricao ? `<div class="meta">→ ${esc(it.produto_txt)}</div>` : "") : `<div class="cmp-ri-pick"><input class="cmp-ri-prod" placeholder="casar com produto do catálogo…" value="${esc(it.produto_txt || "")}" autocomplete="off" /><div class="autocomplete-lista" style="display:none;"></div></div>`}</td>
      <td>${esc(it.unidade || "un")}</td>
      <td class="num">${_cmpRec?.modo === "compra_direta" ? `<select class="cmp-ri" data-f="categoria_custo" style="max-width:120px;">${cmpCatOptions(it.categoria_custo || "peca")}</select>` : it.pendente != null ? num(it.pendente) : "—"}</td>
      <td><input type="number" step="0.001" min="0" class="cmp-ri" data-f="quantidade_nf" value="${esc(it.quantidade_nf ?? 0)}" style="width:80px;text-align:right;" /></td>
      <td><input type="number" step="0.0001" min="0" class="cmp-ri" data-f="valor_unitario_nf" value="${esc(it.valor_unitario_nf ?? 0)}" style="width:100px;text-align:right;" /></td>
      <td class="num cmp-ri-total">${cmpRiTotalHTML(it)}</td>
      ${cmpRecTipoDestinoCel(it)}
      <td><button type="button" class="btn-sec btn-sm cmp-ri-rem" title="tirar da nota">×</button></td>
    </tr>`).join("");
  tb.querySelectorAll(".cmp-ri").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", e => {
    const tr = e.target.closest("tr"), it = _cmpRec.itens[Number(tr.dataset.idx)], f = e.target.dataset.f;
    if(f === "destino"){ Object.assign(it, cmpDestinoDoValor(e.target.value)); renderItensRecebimento(); return; }   // fase 108b: o tipo acompanha
    else if(f === "descricao" || f === "categoria_custo") it[f] = e.target.value; else it[f] = Number(e.target.value || 0);
    tr.querySelector(".cmp-ri-total").innerHTML = cmpRiTotalHTML(it);
    cmpRecSoma();
  }));
  tb.querySelectorAll(".cmp-ri-rem").forEach(b => b.addEventListener("click", e => { _cmpRec.itens.splice(Number(e.target.closest("tr").dataset.idx), 1); renderItensRecebimento(); }));
  tb.querySelectorAll("tr[data-idx]").forEach(tr => { const inp = tr.querySelector(".cmp-ri-prod"); if(inp) cmpRiPicker(tr, inp); });
  cmpRecSoma();
}
/* Fase 108b: tipo de compra e destino na linha da nota. Item ligado ao pedido mostra o tipo aprovado e não deixa
   trocar; item fora do pedido (nota sem pedido, compra direta, item a mais no XML) escolhe o destino. Reposição sem
   produto do catálogo avisa já na linha (a confirmação recusa, como a RPC). */
/* lote S53 (#166): total da linha da nota e, abaixo, o % de IPI do item (do pedido ou do XML), que entra no custo em vw_custos */
function cmpRiTotalHTML(it){ return brl(Number(it.quantidade_nf || 0) * Number(it.valor_unitario_nf || 0)) + (Number(it.ipi_percentual) ? `<div class="meta" title="IPI do item (do pedido ou do XML da NF): entra no custo">IPI ${esc(cmpPct(it.ipi_percentual))}</div>` : ""); }
function cmpRecTipoDestinoCel(it){
  const tipo = it.destino === "estoque" ? "reposicao" : "aplicacao_direta";
  const alerta = tipo === "reposicao" && !it.produto_id ? '<div class="meta txt-perigo">reposição sem produto do catálogo: case com um produto</div>'
    : !it.produto_id ? '<div class="meta" title="item sem produto casado não entra no estoque">só aplicação direta</div>' : "";
  if(it.pedido_item_id) return `<td>${cmpTipoTag(tipo)}</td><td><span class="meta" title="tipo de compra e destino aprovados no pedido">${esc(cmpDestinoTxt(it))}</span>${alerta}</td>`;
  // item livre fora do pedido nasce como aplicação direta sem destino ("obra:" sem obra): o select mostra que falta escolher
  const v = cmpDestinoValor(it), incompleto = /:$/.test(v);
  return `<td>${cmpTipoTag(tipo)}</td><td><select class="cmp-ri${incompleto ? " txt-perigo" : ""}" data-f="destino" style="max-width:280px;">${incompleto ? `<option value="${esc(v)}" selected>— escolha obra, TAG ou centro —</option>` : ""}${cmpDestinoOptions(v)}</select>${alerta}</td>`;
}
function cmpRiBadge(it){
  const m = { codigo: ["casado por código", "verde"], ean: ["casado por EAN", "verde"], pedido: ["do pedido", "azul"], manual: ["casado à mão", "verde"] };
  if(it.casamento && m[it.casamento]) return ` <span class="tag ${m[it.casamento][1]} cmp-ri-badge">${m[it.casamento][0]}</span>`;
  if(it.produto_id) return "";
  return ` <span class="tag ambar cmp-ri-badge">sem produto</span>`;
}
/* casamento de produto na linha do recebimento (XML ou item livre) */
function cmpRiPicker(tr, inp){
  const lista = tr.querySelector(".cmp-ri-pick .autocomplete-lista"); let t = null;
  const it = () => _cmpRec.itens[Number(tr.dataset.idx)];
  inp.addEventListener("input", () => {
    clearTimeout(t);
    const x = it(); if(!x) return;
    if(!inp.value.trim() && x.produto_id){ x.produto_id = null; x.produto_txt = ""; x.casamento = null; if(x.destino === "estoque" && !x.pedido_item_id){ /* fica para o usuário decidir */ } renderItensRecebimento(); return; }
    t = setTimeout(async () => {
      const termo = inp.value.trim(); if(termo.length < 2){ lista.style.display = "none"; return; }
      const res = await cmpBuscarProdutos(termo);
      lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}</span></div>`).join("") : `<div class="resultado-item vazio">Nenhum produto. Cadastre em Produtos ou mande para obra, TAG ou setor (aplicação direta).</div>`;
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => {
        const p = res.find(y => y.id === d.dataset.id); const x2 = it(); if(!p || !x2) return;
        x2.produto_id = p.id; x2.produto_txt = `${p.codigo} — ${p.nome}`; x2.casamento = "manual"; if(!x2.categoria_custo || x2.categoria_custo === "peca") x2.categoria_custo = p.categoria_custo || "peca";
        if(x2.livre && (!x2.descricao || !x2.descricao.trim())) x2.descricao = x2.produto_txt;
        if(_cmpRec.pedido && !x2.pedido_item_id) cmpLigarItemAoPedido(x2, cmpPedidoPendentes());
        renderItensRecebimento();
      }));
    }, 250);
  });
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 200));
}
function cmpRecSoma(){
  const s = (_cmpRec?.itens || []).reduce((a, it) => a + Number(it.quantidade_nf || 0) * Number(it.valor_unitario_nf || 0), 0) + Number($("cmp-rec-frete").value || 0);
  $("cmp-rec-soma").textContent = `Total dos itens + frete: ${brl(s)}`;
}
function cmpRecAddItem(p){
  const d = _cmpRec.pedido ? cmpDestinoDoValor(cmpDestinoPadraoDe(_cmpRec.pedido)) : { destino: "estoque", obra_id: null, equipamento_id: null };
  _cmpRec.itens.push({ pedido_item_id: null, produto_id: p?.id || null, produto_txt: p ? `${p.codigo} — ${p.nome}` : "", casamento: p ? "manual" : null, livre: !p, descricao: p ? `${p.codigo} — ${p.nome}` : "", unidade: p?.unidade || "un", pendente: null, quantidade_nf: 1,
    valor_unitario_nf: Number(p?.custo_ultimo || 0), categoria_custo: p?.categoria_custo || "peca", ...(p ? d : { destino: d.destino === "estoque" ? "obra" : d.destino, obra_id: d.obra_id, equipamento_id: d.equipamento_id }) });
  renderItensRecebimento();
}
function cmpDestinoPadraoDe(p){ return p.equipamento_id ? "eq:" + p.equipamento_id : (p.local_entrega === "obra" && p.obra_id) ? "obra:" + p.obra_id : "estoque"; }
async function confirmarRecebimento(){
  const r = _cmpRec; if(!r) return;
  if(r.modo === "compra_direta") return registrarCompraDireta();   // fase 78
  const forn = $("cmp-rec-forn").value;
  if(!forn){ aviso("app-aviso", "Informe o fornecedor.", "erro"); return; }
  const itens = r.itens.filter(it => Number(it.quantidade_nf) > 0);
  if(!itens.length){ aviso("app-aviso", "Nenhum item com quantidade.", "erro"); return; }
  for(const it of itens){
    if(!it.descricao || !it.descricao.trim()){ aviso("app-aviso", "Há item sem descrição.", "erro"); return; }
    if(it.destino === "estoque" && !it.produto_id){ aviso("app-aviso", it.pedido_item_id ? `"${it.descricao}" é reposição de estoque e não tem produto do catálogo: case com um produto (campo abaixo do item) antes de confirmar.` : `"${it.descricao}" não tem produto do catálogo e não entra no estoque: case com um produto ou mande para obra, TAG ou setor (aplicação direta).`, "erro"); return; }
    if(it.destino === "obra" && !it.obra_id || it.destino === "equipamento" && !it.equipamento_id || it.destino === "centro_custo" && !it.centro_custo_id){ aviso("app-aviso", `Destino incompleto em "${it.descricao}".`, "erro"); return; }
    if(it.pendente != null && Number(it.quantidade_nf) > it.pendente * 1.1 && !confirm(`"${it.descricao}": a nota traz ${num(it.quantidade_nf)} e o pedido tem ${num(it.pendente)} pendente. Receber assim mesmo?`)) return;
  }
  const venc = $("cmp-rec-venc").value || null;
  const dups = Array.isArray(r.duplicatas) && r.duplicatas.length ? r.duplicatas : null;
  if(!venc && !dups && !confirm("Sem vencimento não é gerado título a pagar para o financeiro. Continuar mesmo assim?")) return;
  const cab = {
    pedido_id: r.pedido?.id || null, fornecedor_id: forn, nf_numero: $("cmp-rec-nf").value.trim() || null, nf_serie: $("cmp-rec-serie").value.trim() || null,
    nf_chave: $("cmp-rec-chave").value.replace(/\D/g, "") || null, nf_data_emissao: $("cmp-rec-emissao").value || null, data_recebimento: $("cmp-rec-data").value || hojeISO(),
    frete: Number($("cmp-rec-frete").value || 0), vencimento: venc, parcelas: Math.max(1, Number($("cmp-rec-parc").value || 1)), total_nf: Number($("cmp-rec-total").value || 0), observacoes: $("cmp-rec-obs").value.trim() || null,
    duplicatas: dups, xml_texto: r.xml?.texto || null,
    contrato_id: (!r.pedido && $("cmp-rec-contrato")?.value) || null // fase 57
  };
  const { data: rec, error } = await sb.from("recebimentos").insert(cab).select("id").single();
  if(error){ aviso("app-aviso", "Erro ao criar o recebimento: " + error.message, "erro"); return; }
  const { error: eIt } = await sb.from("recebimento_itens").insert(itens.map(it => ({
    recebimento_id: rec.id, pedido_item_id: it.pedido_item_id || null, produto_id: it.produto_id || null, descricao: it.descricao.trim(), unidade: it.unidade || "un",
    quantidade_nf: Number(it.quantidade_nf), valor_unitario_nf: Number(it.valor_unitario_nf || 0), quantidade_aceita: Number(it.quantidade_nf),
    categoria_custo: it.categoria_custo || null, destino: it.destino || "estoque", obra_id: it.obra_id || null, equipamento_id: it.equipamento_id || null,
    centro_custo_id: it.centro_custo_id || null,
    codigo_fornecedor: it.codigo_fornecedor || null, ean: it.ean || null, ncm: it.ncm || null, cfop: it.cfop || null, casamento: it.casamento || null,
    ipi_percentual: Number(it.ipi_percentual || 0), icms_percentual: Number(it.icms_percentual || 0)   // lote S53 (#166)
  })));
  if(eIt){ await sb.from("recebimentos").delete().eq("id", rec.id); aviso("app-aviso", "Erro nos itens do recebimento: " + eIt.message, "erro"); return; }
  const { error: eRpc } = await sb.rpc("recebimento_confirmar", { p_id: rec.id });
  if(eRpc){ await sb.from("recebimentos").delete().eq("id", rec.id); aviso("app-aviso", "Recebimento não confirmado: " + eRpc.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", "Recebimento confirmado: estoque/custos atualizados" + (venc ? " e títulos gerados." : ".")
    + (r.pedido?.exige_conferencia ? " Falta quem fez a requisição conferir o material (\"Recebi e conferi\")." : ""), "ok");   // fase 102
  fecharRecebimento();
  if(typeof aceInvalidar === "function") aceInvalidar();
  if(typeof carregarProdutos === "function") carregarProdutos();
  await cmpFetchPedidos();
  if(r.pedido?.id) await abrirPedido(r.pedido.id); else renderCompras();
}

/* ---------- compra direta (fase 78) ----------
   Mesmo modal do recebimento da NF, em modo "compra_direta": a compra já foi feita e a nota está na mão.
   Exige o XML, ou o número da NF com o PDF/foto anexado. A RPC compra_direta_registrar cria pedido, itens,
   recebimento e anexos numa transação e confirma (estoque, custo, títulos) se couber na alçada de quem
   registra; acima dela, o pedido vai para aprovação e a aprovação confirma o recebimento. */
function abrirCompraDireta(){
  if(!cmpPodeOperar()){ aviso("app-aviso", "Seu perfil não opera compras.", "erro"); return; }
  _cmpItens = [];
  abrirRecebimento(null, "compra_direta");
}
async function registrarCompraDireta(){
  const r = _cmpRec; if(!r) return;
  const forn = $("cmp-rec-forn").value;
  if(!forn){ aviso("app-aviso", "Informe o fornecedor (o XML preenche; emitente novo: \"Cadastrar a partir da NF\").", "erro"); return; }
  const itens = r.itens.filter(it => Number(it.quantidade_nf) > 0);
  if(!itens.length){ aviso("app-aviso", "Nenhum item com quantidade.", "erro"); return; }
  for(const it of itens){
    if(!it.descricao || !it.descricao.trim()){ aviso("app-aviso", "Há item sem descrição.", "erro"); return; }
    if(it.destino === "estoque" && !it.produto_id){ aviso("app-aviso", `"${it.descricao}" não tem produto do catálogo e não entra no estoque: case com um produto ou mande para obra, TAG ou setor (aplicação direta).`, "erro"); return; }
    if(it.destino === "estoque" && cmpItemServico(it)){ aviso("app-aviso", `"${it.descricao}" é serviço: o custo vai para obra, TAG ou setor, não para o estoque.`, "erro"); return; }
    if(it.destino === "obra" && !it.obra_id || it.destino === "equipamento" && !it.equipamento_id || it.destino === "centro_custo" && !it.centro_custo_id){ aviso("app-aviso", `Destino incompleto em "${it.descricao}".`, "erro"); return; }
  }
  const nf = $("cmp-rec-nf").value.trim(), files = [...($("cmp-rec-anexos")?.files || [])];
  if(!r.xml && (!nf || !files.length)){ aviso("app-aviso", "Compra direta exige a nota: importe o XML, ou informe o número da NF e anexe o PDF ou a foto. Sem nota, lance como custo avulso.", "erro"); return; }
  const venc = $("cmp-rec-venc").value || null;
  const dups = Array.isArray(r.duplicatas) && r.duplicatas.length ? r.duplicatas : null;
  if(!venc && !dups && !confirm("Sem vencimento não é gerado título a pagar para o financeiro. Continuar mesmo assim?")) return;
  const recId = crypto.randomUUID();
  let anexos = [];
  try { anexos = await cmpEnviarAnexos(recId, files); } catch(e){ aviso("app-aviso", e.message || String(e), "erro"); return; }
  const frete = Number($("cmp-rec-frete").value || 0), obs = $("cmp-rec-obs").value.trim() || null;
  const cab = { fornecedor_id: forn, data_pedido: $("cmp-rec-emissao").value || $("cmp-rec-data").value || hojeISO(), frete, observacoes: obs };
  const its = itens.map(it => ({ produto_id: it.produto_id || null, descricao: it.descricao.trim(), unidade: it.unidade || "un", quantidade: Number(it.quantidade_nf),
    valor_unitario: Number(it.valor_unitario_nf || 0), categoria_custo: it.categoria_custo || null, destino: it.destino || "estoque", obra_id: it.obra_id || null,
    equipamento_id: it.equipamento_id || null, centro_custo_id: it.centro_custo_id || null, codigo_fornecedor: it.codigo_fornecedor || null, ean: it.ean || null,
    ncm: it.ncm || null, cfop: it.cfop || null, casamento: it.casamento || null }));
  const rec = { id: recId, nf_numero: nf || null, nf_serie: $("cmp-rec-serie").value.trim() || null, nf_chave: $("cmp-rec-chave").value.replace(/\D/g, "") || null,
    nf_data_emissao: $("cmp-rec-emissao").value || null, data_recebimento: $("cmp-rec-data").value || hojeISO(), frete, vencimento: venc,
    parcelas: Math.max(1, Number($("cmp-rec-parc").value || 1)), total_nf: Number($("cmp-rec-total").value || 0), observacoes: obs, duplicatas: dups,
    xml_texto: r.xml?.texto || null, anexos };
  const { data, error } = await sb.rpc("compra_direta_registrar", { p_cabecalho: cab, p_itens: its, p_recebimento: rec });
  if(error){ await cmpRemoverAnexos(anexos); aviso("app-aviso", "Compra não registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  if(data?.status === "aguardando_aprovacao")
    aviso("app-aviso", `Compra registrada acima da sua alçada (${cmpAlcadaTxt()}): o pedido foi para aprovação. Estoque, custo e títulos entram quando quem tem alçada aprovar.`, "ok");
  else aviso("app-aviso", "Compra direta registrada: pedido recebido, estoque/custos atualizados" + (venc || dups ? " e títulos gerados." : "."), "ok");
  fecharRecebimento();
  if(typeof aceInvalidar === "function") aceInvalidar();
  if(typeof carregarProdutos === "function") carregarProdutos();
  await cmpFetchPedidos();
  if(data?.pedido_id) await abrirPedido(data.pedido_id); else renderCompras();
}

/* ---------- recebimento de serviço com evidência (fase 78) ----------
   Sem regra de prazo: quem responde pelo recebimento (padrão: o solicitante) registra o que foi executado e
   anexa a evidência. recebimento_confirmar recusa serviço sem anexo e serviço no estoque. */
function cmpPodeTrocarResp(){
  const p = _cmpAtual; if(!p || !cmpPodeOperar() || p.status === "cancelado") return false;
  return ["admin","diretor","comprador"].includes(usuarioAtual?.cargo) || (!!p.criado_por && p.criado_por === usuarioAtual?.id);
}
function cmpServicosPendentes(){ return _cmpItens.filter(i => i.id && cmpItemServico(i) && Number(i.quantidade_recebida || 0) < Number(i.quantidade || 0)); }
function cmpPodeReceberServico(){
  const p = _cmpAtual; if(!p?.id || !cmpPodeOperar()) return false;
  if(!["aprovado","enviado","parcialmente_recebido"].includes(p.status) || !cmpServicosPendentes().length) return false;
  const eu = usuarioAtual?.id;
  return eu === p.responsavel_recebimento_id || eu === p.criado_por || ["admin","diretor"].includes(usuarioAtual?.cargo)
    || _cmpAlcada === null || (_cmpAlcada >= 0 && Number(p.total || 0) <= _cmpAlcada);
}
function abrirReceberServico(){
  const p = _cmpAtual; if(!cmpPodeReceberServico()) return;
  _cmpSrv = { pedido: p, itens: cmpServicosPendentes().map(i => {
    const pend = Number(i.quantidade || 0) - Number(i.quantidade_recebida || 0);
    let d = { destino: i.destino, obra_id: i.obra_id || null, equipamento_id: i.equipamento_id || null, centro_custo_id: i.centro_custo_id || null };
    if(d.destino === "estoque") d = cmpDestinoDoValor(cmpDestinoPadraoDe(p));
    return { pedido_item_id: i.id, descricao: i.descricao, unidade: i.unidade || "un", pendente: pend, quantidade: pend,
      valor: Math.round(pend * Number(i.valor_unitario || 0) * 100) / 100, categoria_custo: i.categoria_custo, ...d };
  }) };
  $("cmp-srv-titulo").textContent = `Receber serviço — pedido ${p.numero}`;
  $("cmp-srv-data").value = hojeISO(); $("cmp-srv-nf").value = ""; $("cmp-srv-desc").value = ""; $("cmp-srv-anexos").value = "";
  $("cmp-srv-venc").value = "";
  if(p.condicao_pagamento && /(\d+)\s*dias?/i.test(p.condicao_pagamento)){ const d = new Date(); d.setDate(d.getDate() + Number(RegExp.$1)); $("cmp-srv-venc").value = dataLocalISO(d); }
  renderServicoItens();
  $("cmp-srv-modal").style.display = "flex";
}
function fecharReceberServico(){ $("cmp-srv-modal").style.display = "none"; _cmpSrv = null; }
function renderServicoItens(){
  const tb = $("cmp-srv-itens"); const its = _cmpSrv?.itens || [];
  tb.innerHTML = its.map((it, i) => `<tr data-i="${i}">
    <td><strong>${esc(it.descricao)}</strong> <span class="meta">${esc(CMP_CAT_LBL[it.categoria_custo] || "")}</span></td>
    <td class="num">${num(it.pendente)} <span class="meta">${esc(it.unidade)}</span></td>
    <td><input type="number" class="cmp-srv-q" step="0.001" min="0" value="${esc(it.quantidade)}" style="width:80px;text-align:right;" /></td>
    <td><input type="number" class="cmp-srv-v" step="0.01" min="0" value="${esc(it.valor)}" style="width:110px;text-align:right;" /></td>
    <td><select class="cmp-srv-d" style="max-width:230px;">${cmpDestinoOptions(cmpDestinoValor(it))}</select>${it.destino === "estoque" ? '<div class="meta txt-perigo">escolha obra, TAG ou setor</div>' : ""}</td></tr>`).join("")
    || `<tr><td colspan="5" class="vazio">Nenhum serviço pendente neste pedido.</td></tr>`;
  tb.querySelectorAll(".cmp-srv-q").forEach(el => el.addEventListener("input", e => { const it = _cmpSrv.itens[Number(e.target.closest("tr").dataset.i)]; it.quantidade = Number(e.target.value || 0); cmpSrvSoma(); }));
  tb.querySelectorAll(".cmp-srv-v").forEach(el => el.addEventListener("input", e => { const it = _cmpSrv.itens[Number(e.target.closest("tr").dataset.i)]; it.valor = Number(e.target.value || 0); cmpSrvSoma(); }));
  tb.querySelectorAll(".cmp-srv-d").forEach(el => el.addEventListener("change", e => { Object.assign(_cmpSrv.itens[Number(e.target.closest("tr").dataset.i)], cmpDestinoDoValor(e.target.value)); renderServicoItens(); }));
  cmpSrvSoma();
}
function cmpSrvSoma(){ $("cmp-srv-soma").textContent = "Total: " + brl((_cmpSrv?.itens || []).filter(i => i.quantidade > 0).reduce((s, i) => s + Number(i.valor || 0), 0)); }
async function confirmarServico(){
  const s = _cmpSrv; if(!s) return;
  const p = s.pedido, desc = $("cmp-srv-desc").value.trim(), files = [...($("cmp-srv-anexos").files || [])];
  const itens = s.itens.filter(i => Number(i.quantidade) > 0);
  if(!itens.length){ aviso("app-aviso", "Informe a quantidade recebida de pelo menos um serviço.", "erro"); return; }
  if(!desc){ aviso("app-aviso", "Descreva o que foi executado.", "erro"); $("cmp-srv-desc").focus(); return; }
  if(!files.length){ aviso("app-aviso", "Serviço sem evidência não é recebido: anexe a foto ou o documento do que foi executado.", "erro"); return; }
  for(const it of itens){
    if(it.destino === "estoque"){ aviso("app-aviso", `"${it.descricao}": serviço não entra no estoque. Escolha a obra, a TAG ou o setor.`, "erro"); return; }
    if(it.destino === "obra" && !it.obra_id || it.destino === "equipamento" && !it.equipamento_id || it.destino === "centro_custo" && !it.centro_custo_id){ aviso("app-aviso", `Destino incompleto em "${it.descricao}".`, "erro"); return; }
    if(Number(it.quantidade) > it.pendente * 1.1 && !confirm(`"${it.descricao}": recebendo ${num(it.quantidade)} e o pedido tem ${num(it.pendente)} pendente. Continuar?`)) return;
  }
  const venc = $("cmp-srv-venc").value || null;
  if(!venc && !confirm("Sem vencimento não é gerado título a pagar para o financeiro. Continuar mesmo assim?")) return;
  const recId = crypto.randomUUID();
  let anexos = [];
  try { anexos = await cmpEnviarAnexos(recId, files); } catch(e){ aviso("app-aviso", e.message || String(e), "erro"); return; }
  const total = Math.round(itens.reduce((t, i) => t + Number(i.valor || 0), 0) * 100) / 100;
  const desfazer = async () => { await sb.from("recebimentos").delete().eq("id", recId); await cmpRemoverAnexos(anexos); };
  const { error } = await sb.from("recebimentos").insert({ id: recId, pedido_id: p.id, fornecedor_id: p.fornecedor_id, tipo: "servico",
    nf_numero: $("cmp-srv-nf").value.trim() || null, data_recebimento: $("cmp-srv-data").value || hojeISO(), vencimento: venc, parcelas: 1, total_nf: total, observacoes: desc });
  if(error){ await cmpRemoverAnexos(anexos); aviso("app-aviso", "Erro ao criar o recebimento: " + error.message, "erro"); return; }
  const { error: eIt } = await sb.from("recebimento_itens").insert(itens.map(it => ({
    recebimento_id: recId, pedido_item_id: it.pedido_item_id, descricao: it.descricao, unidade: it.unidade, quantidade_nf: Number(it.quantidade),
    valor_unitario_nf: Math.round(Number(it.valor || 0) / Number(it.quantidade) * 10000) / 10000, quantidade_aceita: Number(it.quantidade),
    categoria_custo: it.categoria_custo || null, destino: it.destino, obra_id: it.obra_id || null, equipamento_id: it.equipamento_id || null,
    centro_custo_id: it.destino === "centro_custo" ? it.centro_custo_id : null })));
  if(eIt){ await desfazer(); aviso("app-aviso", "Erro nos itens do recebimento: " + eIt.message, "erro"); return; }
  const { error: eAn } = await sb.from("recebimento_anexos").insert(anexos.map(a => ({ recebimento_id: recId, ...a })));
  if(eAn){ await desfazer(); aviso("app-aviso", "Erro ao registrar a evidência: " + eAn.message, "erro"); return; }
  const { error: eRpc } = await sb.rpc("recebimento_confirmar", { p_id: recId });
  if(eRpc){ await desfazer(); aviso("app-aviso", "Serviço não recebido: " + eRpc.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", "Serviço recebido com evidência: custo lançado" + (venc ? " e título gerado." : "."), "ok");
  fecharReceberServico();
  await cmpFetchPedidos();
  await abrirPedido(p.id);
}

/* ---------- XML da NF-e ---------- */
function cmpLerXmlNfe(text){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if(doc.getElementsByTagName("parsererror").length) throw new Error("O arquivo não é um XML válido.");
  const first = (el, tag) => el ? el.getElementsByTagNameNS("*", tag)[0] : null;
  const g = (el, tag) => { const n = first(el, tag); return n ? n.textContent.trim() : ""; };
  const inf = first(doc, "infNFe");
  if(!inf) throw new Error("Não é um XML de NF-e (infNFe não encontrado). Eventos e cancelamentos não servem aqui.");
  const ide = first(inf, "ide"), emit = first(inf, "emit"), dest = first(inf, "dest"), tot = first(inf, "ICMSTot"), ender = first(emit, "enderEmit");
  const chave = (inf.getAttribute("Id") || "").replace(/^NFe/i, "") || g(doc, "chNFe");
  const itens = [...inf.getElementsByTagNameNS("*", "det")].map(d => { const p = first(d, "prod"), imp = first(d, "imposto"); return {
    nItem: d.getAttribute("nItem"), cProd: g(p, "cProd"), cEAN: g(p, "cEAN") || g(p, "cEANTrib"), xProd: g(p, "xProd"), ncm: g(p, "NCM"), cfop: g(p, "CFOP"),
    uCom: g(p, "uCom"), qCom: Number(g(p, "qCom") || 0), vUnCom: Number(g(p, "vUnCom") || 0), vProd: Number(g(p, "vProd") || 0),
    pIPI: Number(g(first(imp, "IPI"), "pIPI") || 0), pICMS: Number(g(first(imp, "ICMS"), "pICMS") || 0) }; });   // lote S53 (#166): % por item (IPITrib / ICMSxx)
  const duplicatas = [...inf.getElementsByTagNameNS("*", "dup")].map(d => ({ n: g(d, "nDup"), vencimento: g(d, "dVenc"), valor: Number(g(d, "vDup") || 0) })).filter(d => d.vencimento && d.valor > 0);
  return {
    chave, numero: g(ide, "nNF"), serie: g(ide, "serie"), emissao: (g(ide, "dhEmi") || g(ide, "dEmi")).slice(0, 10), natureza: g(ide, "natOp"),
    emit: { cnpj: (g(emit, "CNPJ") || g(emit, "CPF")).replace(/\D/g, ""), nome: g(emit, "xNome"), fantasia: g(emit, "xFant"), ie: g(emit, "IE"), fone: g(ender, "fone"), cidade: g(ender, "xMun"), uf: g(ender, "UF"), cep: g(ender, "CEP"), logradouro: g(ender, "xLgr"), numero: g(ender, "nro"), bairro: g(ender, "xBairro") },
    dest_cnpj: (g(dest, "CNPJ") || g(dest, "CPF")).replace(/\D/g, ""),
    totais: { vNF: Number(g(tot, "vNF") || 0), vProd: Number(g(tot, "vProd") || 0), vFrete: Number(g(tot, "vFrete") || 0), vDesc: Number(g(tot, "vDesc") || 0), vIPI: Number(g(tot, "vIPI") || 0), vST: Number(g(tot, "vST") || 0) },
    itens, duplicatas
  };
}
function cmpPedidoPendentes(){
  if(!_cmpRec?.pedido) return [];
  if(!_cmpRec._pend) _cmpRec._pend = _cmpItens.filter(it => Number(it.quantidade || 0) - Number(it.quantidade_recebida || 0) > 0).map(it => ({ ...it, _usado: _cmpRec.itens.some(x => x.pedido_item_id === it.id) }));
  return _cmpRec._pend;
}
function cmpTokens(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 2); }
/* liga um item da nota a um item pendente do pedido: mesmo produto, ou descrição parecida quando o item do pedido é livre */
function cmpLigarItemAoPedido(it, pend){
  if(!pend || !pend.length || it.pedido_item_id) return false;
  let p = it.produto_id ? pend.find(x => !x._usado && x.produto_id === it.produto_id) : null;
  if(!p){
    const tk = cmpTokens(it.descricao); if(tk.length){
      let melhor = null, score = 0;
      pend.filter(x => !x._usado && !x.produto_id).forEach(x => { const t2 = cmpTokens(x.descricao); const inter = tk.filter(w => t2.includes(w)).length; if(inter >= Math.min(2, t2.length) && inter > score){ score = inter; melhor = x; } });
      p = melhor;
    }
  }
  if(!p) return false;
  it.pedido_item_id = p.id; it.pendente = Number(p.quantidade || 0) - Number(p.quantidade_recebida || 0);
  it.destino = p.destino || it.destino; it.obra_id = p.obra_id || null; it.equipamento_id = p.equipamento_id || null;
  if(p.categoria_custo) it.categoria_custo = p.categoria_custo;
  if(!Number(it.ipi_percentual)) it.ipi_percentual = Number(p.ipi_percentual || 0);     // lote S53 (#166): XML sem o imposto → o do pedido
  if(!Number(it.icms_percentual)) it.icms_percentual = Number(p.icms_percentual || 0);
  if(!it.produto_id && p.produto_id){ it.produto_id = p.produto_id; it.produto_txt = p.descricao; it.casamento = "pedido"; }
  if(!it.casamento) it.casamento = "pedido";
  p._usado = true;
  return true;
}
async function cmpImportarXml(file){
  if(!_cmpRec || !file) return;
  const info = $("cmp-rec-xml-info");
  let texto, nf;
  try { texto = await file.text(); nf = cmpLerXmlNfe(texto); } catch(e){ aviso("app-aviso", e.message || String(e), "erro"); return; }
  info.textContent = "Lendo a nota…";
  _cmpRec.xml = { texto, chave: nf.chave, nome: file.name }; _cmpRec._pend = null;
  // cabeçalho
  $("cmp-rec-nf").value = nf.numero; $("cmp-rec-serie").value = nf.serie || "1"; $("cmp-rec-chave").value = nf.chave; $("cmp-rec-emissao").value = nf.emissao;
  $("cmp-rec-frete").value = nf.totais.vFrete || ""; $("cmp-rec-total").value = nf.totais.vNF || "";
  if(nf.duplicatas.length){ _cmpRec.duplicatas = nf.duplicatas; $("cmp-rec-venc").value = nf.duplicatas[0].vencimento; $("cmp-rec-parc").value = nf.duplicatas.length; }
  else { _cmpRec.duplicatas = null; }
  // fornecedor pelo CNPJ
  const forn = _cmpForns.find(f => (f.cpf_cnpj || "").replace(/\D/g, "") === nf.emit.cnpj);
  const avisos = [];
  if(forn){
    if(_cmpRec.pedido && _cmpRec.pedido.fornecedor_id && _cmpRec.pedido.fornecedor_id !== forn.id) avisos.push(`⚠ a nota é de <strong>${esc(forn.razao_social)}</strong>, mas o pedido é de ${esc(cmpForn(_cmpRec.pedido.fornecedor_id))}`);
    if(!_cmpRec.pedido){ $("cmp-rec-forn").value = forn.id; cmpFornAtualizar("cmp-rec-forn"); cmpRecPreencherContratos(); }
  }
  // já foi recebida?
  if(nf.chave){ const { data: dupNf } = await sb.from("recebimentos").select("id,status").eq("nf_chave", nf.chave).neq("status", "cancelado").limit(1); if(dupNf?.length) avisos.push(`⚠ <strong>esta chave de acesso já tem um recebimento registrado</strong>. Confira antes de confirmar de novo`); }
  // casamento de produtos: código do fornecedor → EAN → pedido
  const [cod, ean] = await Promise.all([
    forn ? sb.from("produto_fornecedor_codigos").select("codigo_fornecedor,produto:produtos(id,codigo,nome,unidade,custo_ultimo,categoria_custo)").eq("fornecedor_id", forn.id) : Promise.resolve({ data: [] }),
    (() => { const eans = nf.itens.map(i => i.cEAN).filter(e => e && !/sem\s*gtin/i.test(e)); return eans.length ? sb.from("produtos").select("id,codigo,nome,unidade,custo_ultimo,categoria_custo,codigo_barras").in("codigo_barras", eans) : Promise.resolve({ data: [] }); })()
  ]);
  const mapCod = {}; (cod.data || []).forEach(c => { if(c.produto) mapCod[c.codigo_fornecedor] = c.produto; });
  const mapEan = {}; (ean.data || []).forEach(p => mapEan[p.codigo_barras] = p);
  const destPadrao = cmpDestinoDoValor(_cmpRec.pedido ? cmpDestinoPadraoDe(_cmpRec.pedido) : "estoque");
  _cmpRec.itens = nf.itens.map(d => {
    let prod = mapCod[d.cProd] || null, cas = prod ? "codigo" : null;
    const eanOk = d.cEAN && !/sem\s*gtin/i.test(d.cEAN) ? d.cEAN : null;
    if(!prod && eanOk && mapEan[eanOk]){ prod = mapEan[eanOk]; cas = "ean"; }
    return { pedido_item_id: null, produto_id: prod?.id || null, produto_txt: prod ? `${prod.codigo} — ${prod.nome}` : "", casamento: cas, livre: false,
      descricao: d.xProd, codigo_fornecedor: d.cProd || null, ean: eanOk, ncm: d.ncm || null, cfop: d.cfop || null,
      unidade: (d.uCom || "un").toLowerCase().slice(0, 8), pendente: null, quantidade_nf: d.qCom, valor_unitario_nf: d.vUnCom,
      categoria_custo: prod?.categoria_custo || "peca", ipi_percentual: d.pIPI || 0, icms_percentual: d.pICMS || 0, ...destPadrao };   // lote S53 (#166)
  });
  const pend = cmpPedidoPendentes(); pend.forEach(p => p._usado = false);
  _cmpRec.itens.forEach(it => cmpLigarItemAoPedido(it, pend));
  const naoVieram = pend.filter(p => !p._usado).length;
  const casados = _cmpRec.itens.filter(i => i.produto_id).length, semProd = _cmpRec.itens.length - casados;
  const somaItens = _cmpRec.itens.reduce((s, i) => s + i.quantidade_nf * i.valor_unitario_nf, 0);
  const dif = nf.totais.vNF - somaItens - (nf.totais.vFrete || 0);
  info.innerHTML = `✔ NF <strong>${esc(nf.numero)}</strong> de <strong>${esc(nf.emit.nome)}</strong> (${esc(nf.emit.cnpj)}) · ${nf.itens.length} item(ns): ${casados} casado(s) com o catálogo${semProd ? `, <strong>${semProd} para casar</strong> (ou mandar como aplicação direta)` : ""}`
    + (nf.duplicatas.length ? ` · ${nf.duplicatas.length} duplicata(s)` : " · sem duplicatas no XML: informe o vencimento")
    + (naoVieram ? ` · ${naoVieram} item(ns) do pedido não vieram nesta nota (ficam pendentes)` : "")
    + (Math.abs(dif) >= 0.05 ? ` · total da NF ${brl(nf.totais.vNF)} difere dos itens + frete em ${brl(dif)} (IPI/ST/desconto)` : "")
    + (!forn ? `<br>⚠ Emitente não está no cadastro de fornecedores. <button type="button" class="btn-sec btn-sm" id="btn-cmp-rec-criar-forn">Cadastrar a partir da NF</button>` : "")
    + (avisos.length ? "<br>" + avisos.join("<br>") : "");
  $("btn-cmp-rec-criar-forn")?.addEventListener("click", () => comBotaoTravado("btn-cmp-rec-criar-forn", () => cmpCriarFornecedorDaNf(nf.emit)));
  renderItensRecebimento();
}
async function cmpCriarFornecedorDaNf(e){
  const reg = { razao_social: e.nome || "Fornecedor da NF", nome_fantasia: e.fantasia || null, cpf_cnpj: e.cnpj || null, inscricao_estadual: e.ie || null, telefone: e.fone || null,
    cidade: e.cidade || null, uf: e.uf ? e.uf.toLowerCase() : null, cep: e.cep || null, logradouro: e.logradouro || null, numero: e.numero || null, bairro: e.bairro || null,
    tipo_pessoa: (e.cnpj || "").length === 11 ? "fisica" : "juridica", observacoes: "Cadastrado a partir do XML da NF-e em " + dataBR(hojeISO()) };
  const { data, error } = await sb.from("fornecedores").insert(reg).select("id,razao_social,nome_fantasia,cpf_cnpj,email,telefone,cidade,uf,condicao_pagamento_padrao,prazo_entrega_dias").single();
  if(error){ aviso("app-aviso", "Não foi possível cadastrar o fornecedor: " + error.message, "erro"); return; }
  _cmpForns.push(data); _cmpFornMap[data.id] = data; _cmpForns.sort((a, b) => a.razao_social.localeCompare(b.razao_social));
  cmpPreencherSelectsFixos();
  if(!_cmpRec?.pedido){ $("cmp-rec-forn").value = data.id; cmpFornAtualizar("cmp-rec-forn"); }
  if(typeof mapaFornecedores === "object" && mapaFornecedores) mapaFornecedores[data.id] = data.razao_social;
  $("btn-cmp-rec-criar-forn")?.closest("span, div")?.querySelector("#btn-cmp-rec-criar-forn")?.remove();
  aviso("app-aviso", `Fornecedor ${data.razao_social} cadastrado.`, "ok");
}

/* ---------- custo avulso ---------- */
async function abrirCustoAvulso(pre, depois){
  if(!cmpPodeOperar()){ aviso("app-aviso", "Seu perfil não lança custos.", "erro"); return; }
  _cmpAvPre = depois || null;
  await cmpCarregarBase(false);
  $("cmp-av-data").value = hojeISO(); $("cmp-av-cat").value = pre?.categoria || "outro"; $("cmp-av-valor").value = "";
  $("cmp-av-equip").value = pre?.equipamento_id || ""; $("cmp-av-obra").value = pre?.obra_id || ""; if($("cmp-av-centro")) $("cmp-av-centro").value = pre?.centro_custo_id || ""; $("cmp-av-forn").value = ""; cmpFornAtualizar("cmp-av-forn"); if($("cmp-av-jogo")) $("cmp-av-jogo").value = pre?.acessorio_jogo || "";
  $("cmp-av-desc").value = ""; $("cmp-av-doc").value = ""; if($("cmp-av-venc")) $("cmp-av-venc").value = "";
  $("cmp-av-modal").style.display = "flex";
  setTimeout(() => { if(pre?.equipamento_id && $("cmp-av-equip")) $("cmp-av-equip").value = pre.equipamento_id; if(pre?.obra_id && $("cmp-av-obra")) $("cmp-av-obra").value = pre.obra_id; if(pre?.centro_custo_id && $("cmp-av-centro")) $("cmp-av-centro").value = pre.centro_custo_id; }, 300);
}
function fecharCustoAvulso(){ $("cmp-av-modal").style.display = "none"; }
async function salvarCustoAvulso(){
  const reg = { data: $("cmp-av-data").value || hojeISO(), categoria: $("cmp-av-cat").value, valor: Number($("cmp-av-valor").value), equipamento_id: $("cmp-av-equip").value || null, obra_id: $("cmp-av-obra").value || null,
    centro_custo_id: $("cmp-av-centro")?.value || null,
    fornecedor_id: $("cmp-av-forn").value || null, acessorio_jogo: ($("cmp-av-jogo")?.value || "").trim().toUpperCase() || null, descricao: $("cmp-av-desc").value.trim(), documento: $("cmp-av-doc").value.trim() || null,
    vencimento: $("cmp-av-venc")?.value || null }; // com vencimento vira também título a pagar
  if(!(reg.valor >= 0) || $("cmp-av-valor").value === ""){ aviso("app-aviso", "Informe o valor.", "erro"); return; }
  if(!reg.descricao){ aviso("app-aviso", "Informe a descrição.", "erro"); return; }
  if(!reg.equipamento_id && !reg.obra_id && !reg.acessorio_jogo && !reg.centro_custo_id){ aviso("app-aviso", "Informe a TAG, a obra, o setor / obra interna ou o jogo de acessórios.", "erro"); return; }
  const { error } = await sb.from("custos_avulsos").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível lançar: " + error.message, "erro"); return; }
  aviso("app-aviso", reg.vencimento ? "Custo lançado e título a pagar gerado." : "Custo lançado (sem vencimento: não gera título a pagar).", "ok");
  fecharCustoAvulso();
  if(_cmpAvPre) _cmpAvPre();
}

/* ---------- aba Custos (equipamento / obra) — lê vw_custos ---------- */
async function custosRender(containerId, filtro, cbTotal){
  const c = $(containerId); if(!c) return;
  // 22/09/2026: custos por TAG/obra só para quem opera compras (mesmos cargos que leem as tabelas de custo no banco)
  const abaBtn = c.closest(".odoo-body")?.previousElementSibling?.querySelector?.('button[data-tab="custos"]');
  if(!cmpPodeOperar()){ if(abaBtn) abaBtn.style.display = "none"; c.innerHTML = `<p class="vazio">Seu perfil não vê custos.</p>`; return; }
  if(abaBtn) abaBtn.style.display = "";
  c.innerHTML = `<p class="vazio">Carregando custos…</p>`;
  let q = sb.from("vw_custos").select("*").order("data", { ascending: false }).limit(2000);
  if(filtro.equipamento_id) q = q.eq("equipamento_id", filtro.equipamento_id);
  if(filtro.obra_id) q = q.eq("obra_id", filtro.obra_id);
  if(filtro.centro_custo_id) q = q.eq("centro_custo_id", filtro.centro_custo_id);   // fase 76
  const { data, error } = await q;
  if(error){ c.innerHTML = `<p class="vazio">Erro ao carregar custos: ${esc(error.message)}</p>`; return; }
  const linhas = data || [];
  const total = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  if(cbTotal) cbTotal(total);
  const pode = cmpPodeOperar();
  const porCat = {}; linhas.forEach(l => porCat[l.categoria] = (porCat[l.categoria] || 0) + Number(l.valor || 0));
  const porMes = {}; linhas.forEach(l => { const m = String(l.data || "").slice(0, 7); porMes[m] = (porMes[m] || 0) + Number(l.valor || 0); });
  const meses = Object.keys(porMes).sort().reverse().slice(0, 12);
  const nomeForn = id => (typeof _cmpFornMap === "object" && _cmpFornMap[id]?.razao_social) || (typeof mapaFornecedores === "object" && mapaFornecedores && mapaFornecedores[id]) || "";
  const nomeObra = id => cmpObra(id) || "";
  const nomeEq = id => cmpEq(id) || (typeof aceEqTag === "function" ? aceEqTag(id) : "");
  c.innerHTML = `
    <div class="lista-topo compacta"><h3>Custos <span class="meta">${linhas.length} lançamento(s)</span></h3>
      <strong style="margin-left:auto;">Total ${brl(total)}</strong>
      ${pode ? `<button type="button" class="btn-sec btn-sm" id="${containerId}-av">＋ Custo avulso</button>` : ""}
      ${linhas.length ? `<button type="button" class="btn-sec btn-sm" id="${containerId}-xls">📊 Excel</button>` : ""}
    </div>
    ${linhas.length ? `<div class="custos-resumo">
      <div><div class="mov-ace-sug-grupo-t">Por categoria</div>${Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="custos-linha"><span>${esc(CMP_CAT_LBL[k] || k)}</span><strong>${brl(v)}</strong></div>`).join("")}</div>
      <div><div class="mov-ace-sug-grupo-t">Por mês</div>${meses.map(m => `<div class="custos-linha"><span>${m.slice(5, 7)}/${m.slice(0, 4)}</span><strong>${brl(porMes[m])}</strong></div>`).join("")}</div>
    </div>
    <div class="tabela-rola"><table><thead><tr><th>Data</th><th>Origem</th><th>Categoria</th><th>Descrição</th><th>${filtro.equipamento_id ? "Obra" : filtro.centro_custo_id ? "Obra / TAG" : "TAG"}</th><th>Fornecedor</th><th>Doc.</th><th class="num">Valor</th></tr></thead>
      <tbody>${linhas.slice(0, 500).map(l => `<tr><td>${dataBR(l.data)}</td><td><span class="tag ${l.origem === "avulso" ? "ambar" : l.origem === "compra" ? "azul" : l.origem === "contrato" ? "verde" : l.origem === "combustivel" ? "ambar" : "cinza"}">${esc(CMP_ORIGEM_LBL[l.origem] || l.origem)}</span></td>
        <td>${esc(CMP_CAT_LBL[l.categoria] || l.categoria)}</td><td>${esc(l.descricao || "")}</td>
        <td>${filtro.equipamento_id ? (l.obra_id ? linkObra(l.obra_id, nomeObra(l.obra_id) || "obra") : "—") : filtro.centro_custo_id ? (l.obra_id ? linkObra(l.obra_id, nomeObra(l.obra_id) || "obra") : esc(nomeEq(l.equipamento_id) || "—")) : esc(nomeEq(l.equipamento_id) || "—")}</td>
        <td>${esc(nomeForn(l.fornecedor_id) || "—")}</td><td class="meta">${esc(l.documento || "")}</td><td class="num">${brl(l.valor)}</td></tr>`).join("")}</tbody></table></div>
    ${linhas.length > 500 ? `<p class="meta">Mostrando 500 de ${linhas.length}. Use o Excel para a lista completa.</p>` : ""}`
    : `<p class="vazio">Nenhum custo registrado${filtro.equipamento_id ? " para esta TAG" : filtro.centro_custo_id ? " para este centro" : " para esta obra"}. Os custos nascem do recebimento de compra direta, da saída de estoque, de deslocamentos, manutenções, reparos e lançamentos avulsos.</p>`}`;
  $(`${containerId}-av`)?.addEventListener("click", () => abrirCustoAvulso({ equipamento_id: filtro.equipamento_id || "", obra_id: filtro.obra_id || "", centro_custo_id: filtro.centro_custo_id || "" }, () => custosRender(containerId, filtro, cbTotal)));
  $(`${containerId}-xls`)?.addEventListener("click", () => {
    const rows = linhas.map(l => ({ Data: dataBR(l.data), Origem: CMP_ORIGEM_LBL[l.origem] || l.origem, Categoria: CMP_CAT_LBL[l.categoria] || l.categoria, Descrição: l.descricao || "", TAG: nomeEq(l.equipamento_id), Obra: nomeObra(l.obra_id), Fornecedor: nomeForn(l.fornecedor_id), Documento: l.documento || "", Quantidade: Number(l.quantidade || 0), Valor: Number(l.valor || 0) }));
    if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "CUSTOS"); XLSX.writeFile(wb, `custos_${hojeISO()}.xlsx`);
  });
}

/* ---------- PDF do pedido ---------- */
async function cmpPdfPedido(){
  const p = _cmpAtual; if(!p?.id) return;
  const f = _cmpFornMap[p.fornecedor_id] || {};
  const itens = _cmpItens;
  // lote S53 (#166): total com IPI (itens + IPI + frete − desconto, como o banco); colunas % IPI / % ICMS e a linha do IPI
  const totItens = cmpSomaItens(itens), totIpi = cmpSomaIpi(itens);
  const total = totItens + totIpi + Number(p.frete || 0) - Number(p.desconto || 0);
  const cel = (txt, extra) => `<td style="border:1px solid #ccd;padding:5px;${extra || ""}">${txt}</td>`;
  // lote S41 (#36): logo oficial e selo ISO pelo helper do core.js; a margem passou do padding para o html2pdf
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;">
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #1B5FA8;padding-bottom:8px;">
      <div>${pdfCabecalhoHTML("", "Itabira/MG")}</div>
      <div style="text-align:right;"><div style="font-size:16px;font-weight:700;">PEDIDO DE COMPRA ${esc(p.numero)}</div><div>Data: ${dataBR(p.data_pedido)}</div>${p.previsao_entrega ? `<div>Entrega prevista: ${dataBR(p.previsao_entrega)}</div>` : ""}</div>
    </div>
    <table style="width:100%;margin:10px 0;font-size:12px;"><tr>
      <td style="vertical-align:top;width:50%;"><strong>Fornecedor</strong><br>${esc(f.razao_social || "")}<br>${f.cpf_cnpj ? "CNPJ/CPF: " + esc(f.cpf_cnpj) + "<br>" : ""}${[f.cidade, f.uf].filter(Boolean).join("/")}<br>${esc(f.telefone || "")} ${esc(f.email || "")}</td>
      <td style="vertical-align:top;"><strong>Entrega</strong><br>${p.local_entrega === "obra" ? "Direto na obra: " + esc(cmpObra(p.obra_id)) : "Base CGL — Itabira/MG"}${p.equipamento_id ? "<br>Equipamento: TAG " + esc(cmpEq(p.equipamento_id)) : ""}<br><strong>Condição de pagamento:</strong> ${esc(p.condicao_pagamento || "a combinar")}</td>
    </tr></table>
    <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
      <thead><tr style="background:#eef3fa;"><th style="border:1px solid #ccd;padding:5px;text-align:left;">#</th><th style="border:1px solid #ccd;padding:5px;text-align:left;">Descrição</th><th style="border:1px solid #ccd;padding:5px;">Un</th><th style="border:1px solid #ccd;padding:5px;text-align:right;">Qtd</th><th style="border:1px solid #ccd;padding:5px;text-align:right;">Unitário</th><th style="border:1px solid #ccd;padding:5px;text-align:right;">% IPI</th><th style="border:1px solid #ccd;padding:5px;text-align:right;">% ICMS</th><th style="border:1px solid #ccd;padding:5px;text-align:right;">Total com IPI</th></tr></thead>
      <tbody>${itens.map((i, k) => `<tr>${cel(k + 1)}${cel(esc(i.descricao) + (cmpTemRateio(i) ? `<div style="font-size:10px;color:#444;">Rateio: ${esc(cmpRateioTxt(i))}</div>` : ""))}${cel(esc(i.unidade || "un"), "text-align:center;")}${cel(num(i.quantidade), "text-align:right;")}${cel(brl(i.valor_unitario), "text-align:right;")}${cel(cmpPct(i.ipi_percentual) || "—", "text-align:right;")}${cel(cmpPct(i.icms_percentual) || "—", "text-align:right;")}${cel(brl(cmpItemTotal(i)), "text-align:right;")}</tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="7" style="padding:4px;text-align:right;">Itens</td><td style="padding:4px;text-align:right;">${brl(totItens)}</td></tr>${totIpi ? `<tr><td colspan="7" style="padding:4px;text-align:right;">IPI</td><td style="padding:4px;text-align:right;">${brl(totIpi)}</td></tr>` : ""}${Number(p.frete) ? `<tr><td colspan="7" style="padding:4px;text-align:right;">Frete</td><td style="padding:4px;text-align:right;">${brl(p.frete)}</td></tr>` : ""}${Number(p.desconto) ? `<tr><td colspan="7" style="padding:4px;text-align:right;">Desconto</td><td style="padding:4px;text-align:right;">− ${brl(p.desconto)}</td></tr>` : ""}
        <tr><td colspan="7" style="padding:6px;text-align:right;font-weight:700;">TOTAL</td><td style="padding:6px;text-align:right;font-weight:700;">${brl(total)}</td></tr></tfoot>
    </table>
    ${p.observacoes ? `<p style="margin-top:10px;"><strong>Observações:</strong> ${esc(p.observacoes).replace(/\n/g, "<br>")}</p>` : ""}
    <p style="margin-top:14px;font-size:11px;color:#444;">Favor mencionar o número do pedido na nota fiscal. Entregas na base: seg–sex 7h–17h. ${p.aprovador ? "Aprovado por " + esc(p.aprovador.nome) + (p.aprovado_em ? " em " + dataBR(String(p.aprovado_em).slice(0, 10)) : "") + "." : ""}</p>
    ${pdfRodapeHTML()}
  </div>`;
  const wrap = document.createElement("div"); wrap.innerHTML = html;
  if(typeof html2pdf === "undefined"){
    const w = window.open("", "_blank"); if(!w){ aviso("app-aviso", "Permita pop-ups para imprimir.", "erro"); return; }
    w.document.write(`<html><head><title>${esc(p.numero)}</title><style>@page { size: A4; margin: 14mm; }</style></head><body>${html}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); return;
  }
  try {
    await pdfGerar(wrap, { filename: `Pedido_${p.numero}.pdf`, largura: 182, topo: 14 });
  } catch(e){ aviso("app-aviso", "Erro ao gerar o PDF: " + (e.message || e), "erro"); }
}

/* ---------- ligação ---------- */
function ligarCompras(){
  if(!$("sec-compras")) return;
  document.querySelector('nav button[data-secao="compras"]')?.addEventListener("click", () => carregarCompras(false));
  document.querySelectorAll("#cmp-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _cmpView = b.dataset.view; renderCompras(); }));
  document.querySelectorAll("#cmp-painel .ind[data-kpi]").forEach(el => el.addEventListener("click", () => {
    const k = el.dataset.kpi;
    if(k === "requisicoes"){ _cmpView = "requisicoes"; _reqFiltroSt = "pendente"; renderCompras(); return; } // fase 60
    _cmpKpi = (_cmpKpi === k) ? "" : k; if(!["kanban","lista"].includes(_cmpView)) _cmpView = "kanban"; renderCompras();
  }));
  ["cmp-f-status","cmp-f-forn","cmp-f-obra","cmp-f-equip","cmp-f-mes","cmp-f-etapa"].forEach(id => $(id)?.addEventListener("change", renderCompras));   // fase 102: etapa
  $("cmp-f-periodo")?.addEventListener("change", async () => { $("cmp-conteudo").innerHTML = `<p class="vazio">Carregando compras…</p>`; await cmpFetchPedidos(); });   // cmpFetchPedidos renderiza
  $("cmp-busca")?.addEventListener("input", debounce(cmpBuscar, 250));   // lote S43: itens no servidor com 3+ letras
  $("btn-cmp-atualizar")?.addEventListener("click", () => carregarCompras(true));
  $("btn-cmp-novo")?.addEventListener("click", () => novoPedido());
  $("btn-cmp-receber-avulso")?.addEventListener("click", () => { _cmpItens = []; abrirRecebimento(null); });
  // fase 78: compra direta, receber serviço, responsável pelo recebimento, "só os meus"
  $("btn-cmp-compra-direta")?.addEventListener("click", abrirCompraDireta);
  $("cmp-f-meus")?.addEventListener("change", renderCompras);
  $("cmp-f-aprovar-eu")?.addEventListener("change", renderCompras);   // fase 108b: "para eu aprovar"
  $("btn-cmp-srv-fechar")?.addEventListener("click", fecharReceberServico);
  $("btn-cmp-srv-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-srv-confirmar", confirmarServico));
  $("cmp-resp-receb")?.addEventListener("change", async () => {
    if(!_cmpEditId || cmpEditavel()) return;   // rascunho grava no Salvar
    const v = $("cmp-resp-receb").value || _cmpAtual?.solicitante_id || null;
    const { error } = await sb.from("pedidos_compra").update({ responsavel_recebimento_id: v }).eq("id", _cmpEditId);
    if(error){ aviso("app-aviso", "Não foi possível trocar o responsável: " + error.message, "erro"); return; }
    if(_cmpAtual) _cmpAtual.responsavel_recebimento_id = v;
    aviso("app-aviso", "Responsável pelo recebimento atualizado.", "ok");
    cmpAtualizarBotoes(); await cmpFetchPedidos();
  });
  _cmpOrdem.ligar("cmp-conteudo", renderCompras);   // lote S49 (#132): cabeçalho da lista ordena
  $("cmp-conteudo")?.addEventListener("click", e => {
    if(e.target.closest("a.link-obra") || e.target.closest("button") || e.target.closest("input,label")) return;
    if(e.target.closest("tr[data-req]")) return; // fase 60: requisições têm o próprio clique
    const el = e.target.closest("[data-id]"); if(el){ abrirPedido(el.dataset.id); return; }
    const tr = e.target.closest("tr[data-pedido]"); if(tr && tr.dataset.pedido){ const p = _cmpPedidos.find(x => x.numero === tr.dataset.pedido); if(p) abrirPedido(p.id); }
  });

  // ficha
  $("btn-cmp-voltar")?.addEventListener("click", mostrarPainelCompras);
  $("btn-cmp-salvar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-salvar", async () => { const id = await salvarPedido(false); if(id){ await cmpFetchPedidos(); await abrirPedido(id); } }));
  document.querySelectorAll("#cmp-ficha .cmp-acao").forEach(b => b.addEventListener("click", () => comBotaoTravado(b.id, () => cmpAcao(b.dataset.acao))));
  document.querySelectorAll("#cmp-notebook button").forEach(b => b.addEventListener("click", () => ativarTabPedido(b.dataset.tab)));
  document.querySelectorAll("#cmp-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => ativarTabPedido(b.dataset.gotoTab)));
  $("btn-cmp-anx-enviar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-anx-enviar", cmpEnviarAnexosPedido));   // lote S48 (#117)
  ["cmp-forn","cmp-local","cmp-obra","cmp-equip","cmp-prev"].forEach(id => $(id)?.addEventListener("change", cmpAtualizarChips));
  ["cmp-frete","cmp-desc"].forEach(id => $(id)?.addEventListener("input", cmpAtualizarChips));
  $("cmp-forn")?.addEventListener("change", () => { const f = _cmpFornMap[$("cmp-forn").value]; if(f?.condicao_pagamento_padrao && !$("cmp-cond").value) $("cmp-cond").value = f.condicao_pagamento_padrao;
    if(f?.prazo_entrega_dias && !$("cmp-prev").value){ const d = new Date(); d.setDate(d.getDate() + Number(f.prazo_entrega_dias)); $("cmp-prev").value = d.toISOString().slice(0, 10); cmpAtualizarChips(); } });
  cmpLigarBusca("cmp-busca-prod", "cmp-res-prod", p => cmpAddItem(p));
  $("btn-cmp-item-livre")?.addEventListener("click", () => cmpAddItem(null));
  // lote S53 (#149): rateio entre TAGs (modal) e "+ TAGs" do cabeçalho; trocar a TAG do cabeçalho à mão desfaz o padrão
  $("btn-cmp-rat-padrao")?.addEventListener("click", () => cmpAbrirRateio(null));
  $("cmp-equip")?.addEventListener("change", () => { if(_cmpRatPadrao.length && _cmpRatPadrao[0] !== $("cmp-equip").value){ _cmpRatPadrao = []; cmpRatPadraoTxt(); } });
  $("btn-cmp-rat-fechar")?.addEventListener("click", cmpRatFechar);
  $("btn-cmp-rat-ok")?.addEventListener("click", cmpRatAplicar);
  $("btn-cmp-rat-igualar")?.addEventListener("click", cmpRatIgualar);
  $("btn-cmp-rat-limpar")?.addEventListener("click", cmpRatLimpar);
  $("cmp-rat-busca")?.addEventListener("input", debounce(cmpRatRender, 150));
  $("cmp-rat-modal")?.addEventListener("click", e => { if(e.target.id === "cmp-rat-modal") cmpRatFechar(); });
  ["cmp-forn", "cmp-rec-forn", "cmp-av-forn", "cmp-cot-forn"].forEach(id => cmpCampoFornecedor(id));   // lote S43 (#53): fornecedor com busca e chip; fase 102: cotação
  // fase 102: cotações e novo produto a partir do pedido (#160)
  $("btn-cmp-cot-salvar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-cot-salvar", cmpSalvarCotacao));
  $("btn-cmp-cot-cancelar")?.addEventListener("click", cmpFecharFormCotacao);
  $("btn-cmp-prod-novo")?.addEventListener("click", cmpAbrirProdutoRapido);
  $("btn-cmp-prod-fechar")?.addEventListener("click", cmpFecharProdutoRapido);
  $("btn-cmp-prod-salvar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-prod-salvar", cmpSalvarProdutoRapido));
  $("cmp-prod-cat")?.addEventListener("change", cmpProdTipoInfo);
  cmpCampoFornecedor("cmp-f-forn", "Fornecedor (nome ou CNPJ)…");   // lote S45 (L2): o filtro do painel deixa de ser um select com 641 opções

  // recebimento
  $("btn-cmp-rec-fechar")?.addEventListener("click", fecharRecebimento);
  $("btn-cmp-rec-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-rec-confirmar", confirmarRecebimento));
  $("cmp-rec-frete")?.addEventListener("input", cmpRecSoma);
  $("cmp-rec-forn")?.addEventListener("change", cmpRecPreencherContratos); // fase 57
  $("btn-cmp-rec-xml")?.addEventListener("click", () => $("cmp-rec-xml").click());
  $("cmp-rec-xml")?.addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if(f) cmpImportarXml(f); });
  const zona = $("cmp-rec-xml-zona");
  if(zona){
    ["dragenter","dragover"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("arrastando"); }));
    ["dragleave","drop"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("arrastando"); }));
    zona.addEventListener("drop", e => { const f = e.dataTransfer?.files && e.dataTransfer.files[0]; if(f) cmpImportarXml(f); });
  }
  cmpLigarBusca("cmp-rec-busca", "cmp-rec-res", p => cmpRecAddItem(p));
  $("btn-cmp-rec-livre")?.addEventListener("click", () => cmpRecAddItem(null));

  // custo avulso
  $("btn-cmp-av-fechar")?.addEventListener("click", fecharCustoAvulso);
  $("btn-cmp-av-salvar")?.addEventListener("click", () => comBotaoTravado("btn-cmp-av-salvar", salvarCustoAvulso));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarCompras);
else ligarCompras();

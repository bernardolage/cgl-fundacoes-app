/* ====================================================================
   Módulo: Produtos e Categorias
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   Sem statusbar (produto é ativo/inativo, sem fluxo).
   ==================================================================== */

let _produtos     = [];
let _prodView     = "lista";
let prodEditId    = null;
let _prodCategorias = {};   // id -> nome
// lote S42 (L1, Julio): o catálogo tem 11,7 mil produtos e a tela carregava os 2.000 primeiros por nome (tudo depois
// do "C" sumia). A lista passou a ser uma consulta no servidor: busca por nome, código e código de barras, filtros na
// consulta, no máximo PROD_PAGINA linhas por vez e contador "N de M" com count exato.
let _prodTotalAtivos = null;  // M: produtos ativos
let _prodTotalFiltro = 0;     // N: linhas que a consulta atual acha
let _prodTodos = false;       // "mostrar todos": sem o corte de saldo, paginado
let _prodPagina = 0;
const PROD_PAGINA = 300;
const PROD_COLS = "id,codigo,nome,unidade,categoria_id,estoque_atual,estoque_minimo,estoque_ideal,controle_reposicao,custo_ultimo,inventario_conferido,ativo,tipo_item";   // lote S55 (#175): tipo_item
/* Lote S55 (#175, decisão do Bernardo de 27/10/2026): serviço consumido (frete, hospedagem, locação, serviço de terceiro) é
   produto com tipo_item = "servico": sem estoque, sem reposição e sempre aplicação direta (o banco força pelo gatilho
   trg_produtos_tipo_item). Não confundir com o módulo Serviços (js/servicos.js), catálogo do que a CGL executa. */
/* Lote S56b (29/10/2026): #197 código automático no produto novo = iniciais do nome + número global (RPC produto_gerar_codigo,
   sequência a partir de 6721, padrão da planilha do almoxarifado: MPB6692, FHD6720); a pessoa troca as letras, nunca o número;
   códigos existentes não mudam e o banco barra código repetido. #199 NCM (8 dígitos) obrigatório no produto novo do tipo
   produto (serviço consumido dispensa); produto antigo sem NCM salva com aviso. Importações não passam por aqui. */
let _prodCodNum = null;        // número reservado pelo gerador para o produto novo (texto, ex.: "6721")
let _prodCodManual = false;    // gerador indisponível (banco sem a migration do lote S56b): código digitado como antes
function prodCodLetras(v){ return String(v || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\d+$/, "").replace(/[^A-Z]/g, "").slice(0, 6); }
function prodCodInfo(){
  const el = $("prod-codigo-info"); if(!el) return;
  el.textContent = prodEditId ? "" : _prodCodManual ? "Gerador indisponível até a atualização do banco: digite o código."
    : _prodCodNum ? `Número ${_prodCodNum} reservado: troque só as letras, se quiser.` : "Automático: iniciais do nome + próximo número (gera ao salvar ou no Gerar).";
}
/* no produto novo com número reservado, o campo é sempre letras + número */
function prodCodNormalizar(){
  if(prodEditId || _prodCodNum == null) return;
  const el = $("prod-codigo"); if(!el) return;
  el.value = (prodCodLetras(el.value) || "P") + _prodCodNum;
}
/* reserva o número (ou, com número já reservado, só refaz as letras pelo nome). novo = true descarta o número (colisão). */
async function prodGerarCodigo(novo){
  if(prodEditId) return false;
  const nome = ($("prod-nome")?.value || "").trim();
  if(!nome){ aviso("app-aviso", "Informe o nome antes de gerar o código.", "erro"); ativarTabProd("geral"); return false; }
  const cat = $("prod-categoria")?.value || null;
  if(_prodCodNum != null && !novo){
    const { data, error } = await sb.rpc("produto_codigo_letras", { p_nome: nome, p_categoria_id: cat });
    if(!error && data) $("prod-codigo").value = String(data) + _prodCodNum;
    prodCodNormalizar(); prodCodInfo();
    return true;
  }
  const digitadas = novo ? prodCodLetras($("prod-codigo").value) : "";
  const { data, error } = await sb.rpc("produto_gerar_codigo", { p_categoria_id: cat, p_nome: nome });
  if(error){
    if(error.code === "PGRST202" || /produto_gerar_codigo/.test(error.message || "")){
      _prodCodManual = true; prodCodInfo();
      aviso("app-aviso", "O gerador de código chega com a atualização do banco: digite o código.", "aviso");
      return false;
    }
    aviso("app-aviso", "Não foi possível gerar o código: " + error.message, "erro");
    return false;
  }
  const m = String(data || "").match(/^([A-Z]*)(\d+)$/);
  if(!m){ aviso("app-aviso", "O gerador devolveu um código inesperado: " + String(data || ""), "erro"); return false; }
  _prodCodNum = m[2];
  $("prod-codigo").value = (digitadas || m[1]) + m[2];
  prodCodInfo();
  return true;
}
/* código do produto novo na hora de gravar: gera se ainda não tem número; nunca aceita número digitado */
async function prodCodigoParaSalvar(){
  const el = $("prod-codigo");
  const txt = (el.value || "").trim().toUpperCase();
  if(_prodCodManual){
    if(!txt){ aviso("app-aviso", "Informe o código.", "erro"); ativarTabProd("geral"); return null; }
    return txt;
  }
  if(_prodCodNum == null){
    if(/\d/.test(txt)){ aviso("app-aviso", "O número do código é automático: deixe só as letras (ou apague) e salve.", "erro"); ativarTabProd("geral"); return null; }
    if(txt) el.value = prodCodLetras(txt);
    const digitadas = prodCodLetras(el.value);
    if(!(await prodGerarCodigo(false))) return null;   // sem gerador: a pessoa digita o código e salva de novo
    if(digitadas){ el.value = digitadas + _prodCodNum; prodCodInfo(); }
  } else prodCodNormalizar();
  return el.value.trim();
}
function prodTagServico(p){ return p && p.tipo_item === "servico" ? ' <span class="tag azul" title="Serviço consumido: aplicação direta, sem estoque">serviço</span>' : ""; }

/* ---------- Categorias ---------- */
let _prodCatTipo = {};   // fase 108b: id da categoria -> tipo de compra padrão (reposicao | aplicacao_direta | null)
async function carregarCategorias(){
  const { data } = await sb.from("categorias_produto").select("id,nome,tipo_compra_padrao").order("nome");
  _prodCategorias = {}; _prodCatTipo = {};
  (data || []).forEach(c => { _prodCategorias[c.id] = c.nome; _prodCatTipo[c.id] = c.tipo_compra_padrao || null; });
  const opc = '<option value="">— sem categoria —</option>' +
    (data||[]).map(c=>`<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  const sel = $("prod-categoria");
  if(sel) sel.innerHTML = opc;
}

/* Lote S51 (#150, Bernardo 26/10/2026): o SESMT (cargo sesmt ou módulo extra "produtos_sesmt", como a Iasmym) cadastra e
   edita só produtos das categorias do SESMT; não exclui, não cria categoria e não mexe em saldo nem custo. Espelha
   produtos_write (cadastro inteiro) e produtos_sesmt_insert/update + categoria_produto_eh_sesmt() do banco. */
const PROD_CATEGORIAS_SESMT = ["EPI", "EPI / UNIFORMES", "UNIFORMES", "DOCUMENTACAO SESMT", "EXAMES SESMT"];
const PROD_MSG_SO_SESMT = "Seu perfil edita só produtos do SESMT (EPI, uniformes, documentação e exames).";
let _prodCatOriginal = null;   // categoria do produto aberto, como veio do banco (o SESMT só grava se ela for do SESMT)
function prodCategoriaEhSesmt(catId){
  return !!catId && PROD_CATEGORIAS_SESMT.includes(String(_prodCategorias[catId] || "").trim().toUpperCase());
}
/* Lote S55 (#173 Thayse, #182 Maria Eduarda): módulo extra "produtos" = perfil "cadastro": cadastra e edita produto de
   qualquer categoria, sem saldo, custo nem situação (ativo) — o gatilho fn_produtos_sesmt_guarda recusa — e não exclui
   nem cria categoria. Espelha produto_pode_cadastrar() e as policies produtos_extra_insert/update. */
const PROD_MSG_SO_CADASTRO = "Seu perfil edita o cadastro do produto, não o saldo, o custo nem a situação.";
/* "tudo" (produtos_write: admin, almoxarife, comprador, gestor de acessórios; diretor), "cadastro" (módulo extra produtos),
   "sesmt" ou "" (só consulta) */
function prodPerfilEdicao(){
  if(!usuarioAtual || (typeof ehSomenteLeitura === "function" && ehSomenteLeitura())) return "";
  if(["diretor", "admin", "almoxarife", "comprador", "gestor_acessorios"].includes(usuarioAtual.cargo)) return "tudo";
  if(typeof temModuloExtra === "function" && temModuloExtra("produtos")) return "cadastro";   // lote S55
  if(usuarioAtual.cargo === "sesmt" || (typeof temModuloExtra === "function" && temModuloExtra("produtos_sesmt"))) return "sesmt";
  return "";
}
/* select de categoria da ficha: o SESMT vê só as categorias dele (e a do produto aberto, marcada, se for de outra) */
function prodMontarSelectCategoria(atual){
  const sel = $("prod-categoria"); if(!sel) return;
  const cats = Object.entries(_prodCategorias).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if(prodPerfilEdicao() === "sesmt"){
    const doSesmt = cats.filter(c => prodCategoriaEhSesmt(c.id));
    const fora = atual && !prodCategoriaEhSesmt(atual) ? cats.find(c => c.id === atual) : null;
    sel.innerHTML = `<option value="">— escolha a categoria do SESMT —</option>` +
      doSesmt.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("") +
      (fora ? `<option value="${esc(fora.id)}">${esc(fora.nome)} (fora do SESMT)</option>` : "");
  } else {
    sel.innerHTML = `<option value="">— sem categoria —</option>` + cats.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  }
  sel.value = atual || "";
}
/* botões da ficha e do painel conforme o perfil: Salvar para quem grava, Excluir só no cadastro inteiro, "+ nova"
   categoria só para quem grava em categorias_produto (prodPodeEditarCategoria) */
function prodAplicarPerfil(){
  const perfil = prodPerfilEdicao();
  const novo = $("btn-novo-produto"); if(novo) novo.style.display = perfil ? "" : "none";
  const salvar = $("btn-salvar-prod"); if(salvar) salvar.style.display = perfil ? "" : "none";
  const excluir = $("btn-excluir-prod"); if(excluir) excluir.style.display = (perfil === "tudo" && prodEditId) ? "" : "none";
  const novaCat = $("btn-nova-cat"); if(novaCat) novaCat.style.display = prodPodeEditarCategoria() && !ehSomenteLeitura() ? "" : "none";
}

/* ---------- Produtos ---------- */
function prodTermo(){ return ($("prod-busca")?.value || "").trim().replace(/[%,()]/g, " ").trim(); }
function prodModoPadrao(){ return !prodTermo() && !($("prod-f-categoria")?.value) && !($("prod-f-estoque")?.value) && !($("prod-f-tipo")?.value) && !_prodTodos; }
async function carregarProdutos(){
  const termo = prodTermo(), fCat = $("prod-f-categoria")?.value || "", fEst = $("prod-f-estoque")?.value || "", fTipo = $("prod-f-tipo")?.value || "";
  const baixo = fEst === "baixo";
  let q = sb.from("produtos").select(PROD_COLS, { count: "exact" }).eq("ativo", fEst !== "inativos").order("nome");
  if(termo) q = q.or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%,codigo_barras.eq.${termo}`);
  if(fCat) q = q.eq("categoria_id", fCat);
  if(fTipo) q = q.eq("tipo_item", fTipo);   // lote S55 (#175): Produtos / Serviços consumidos
  if(fEst === "zero") q = q.lte("estoque_atual", 0);
  else if(fEst === "positivo") q = q.gt("estoque_atual", 0);
  else if(baixo) q = q.gt("estoque_minimo", 0);           // o banco não compara duas colunas: traz os que têm mínimo e filtra abaixo
  else if(prodModoPadrao()) q = q.gt("estoque_atual", 0);  // sem busca nem filtro: os que giram (com saldo)
  const paginado = _prodTodos && !termo;
  const de = paginado ? _prodPagina * PROD_PAGINA : 0;
  q = baixo ? q.limit(1000) : q.range(de, de + PROD_PAGINA - 1);
  const [res, tot] = await Promise.all([q, _prodTotalAtivos == null ? sb.from("produtos").select("id", { count: "exact", head: true }).eq("ativo", true) : null]);
  if(tot) _prodTotalAtivos = tot.count || 0;
  if(res.error){ aviso("app-aviso", "Erro ao carregar produtos: " + res.error.message, "erro"); _produtos = []; _prodTotalFiltro = 0; }
  else {
    _produtos = res.data || [];
    if(baixo) _produtos = _produtos.filter(p => Number(p.estoque_atual) <= Number(p.estoque_minimo));
    _prodTotalFiltro = baixo ? _produtos.length : (res.count || 0);
  }
  renderProdutos();
  // o select escondido da entrada de estoque (#ent-produto) é preenchido por estSelecionarProduto (estoque.js),
  // que já busca no servidor; não é mais alimentado daqui
}

/* ---------- Filtros ---------- */
/* lote S42: os filtros vão na consulta (carregarProdutos); aqui só o que veio do servidor */
function prodFiltrados(){ return _produtos; }
/* linha acima da lista: o modo (com saldo / todos paginado) e a navegação */
function renderProdModo(){
  const el = $("prod-modo"); if(!el) return;
  const termo = prodTermo(), total = _prodTotalFiltro, n = _produtos.length;
  if(termo || $("prod-f-categoria")?.value || $("prod-f-estoque")?.value || $("prod-f-tipo")?.value){
    el.innerHTML = total > n ? `Mostrando ${n} de ${num(total)} resultado(s): refine a busca para ver os outros.` : "";
    return;
  }
  const off = 'style="opacity:.5;pointer-events:none;"';
  if(!_prodTodos){
    el.innerHTML = `Mostrando os produtos com saldo em estoque. <a href="#" data-prod-modo="todos">Mostrar todos os ${num(_prodTotalAtivos || 0)} ativos (${PROD_PAGINA} por página)</a>`;
  } else {
    const paginas = Math.max(1, Math.ceil(total / PROD_PAGINA)), pag = _prodPagina + 1;
    el.innerHTML = `Todos os produtos ativos · página ${esc(pag)} de ${paginas} (${num(_prodPagina * PROD_PAGINA + 1)}–${num(_prodPagina * PROD_PAGINA + n)} de ${num(total)}) ·
      <a href="#" data-prod-modo="ant" ${pag <= 1 ? off : ""}>‹ anterior</a> · <a href="#" data-prod-modo="prox" ${pag >= paginas ? off : ""}>próxima ›</a> ·
      <a href="#" data-prod-modo="saldo">só com saldo</a>`;
  }
}

function preencherFiltrosProd(){
  const sel = $("prod-f-categoria");
  if(sel){
    // Preserva o valor escolhido: este render roda a cada tecla/filtro e
    // substituir o innerHTML zerava a seleção ANTES de prodFiltrados ler
    // (o filtro por categoria nunca chegava a filtrar).
    const atual = sel.value;
    const cats = Object.entries(_prodCategorias)
      .map(([id, nome]) => ({ id, nome }))
      .sort((a,b) => a.nome.localeCompare(b.nome,"pt-BR"));
    sel.innerHTML = `<option value="">Todas as categorias</option>` +
      cats.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
    sel.value = atual;
  }
}

/* ---------- Render ---------- */
function renderProdutos(){
  preencherFiltrosProd();
  prodAplicarPerfil();   // lote S51: "+ Novo" só para quem grava
  const dados = prodFiltrados();
  const cont = $("prod-contador");
  if(cont) cont.textContent = `${num(_prodTotalFiltro)} de ${num(_prodTotalAtivos ?? _prodTotalFiltro)}`;   // N da consulta, de M ativos
  renderProdModo();
  if(_prodView === "kanban") renderProdKanban(dados);
  else                       renderProdLista(dados);
  const legacy = $("tab-produtos");
  if(legacy) legacy.innerHTML = "";
}

function renderProdLista(dados){
  const cont = $("prod-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum produto encontrado.</p>`;
    return;
  }
  // Limita a 500 visíveis pra performance
  const max = 500;
  const exibidos = dados.slice(0, max);
  const aviso_lim = dados.length > max
    ? `<p style="font-size:var(--txt-xs);color:var(--txt-sutil);margin:6px 0;">Mostrando primeiros ${max} de ${dados.length} — refine a busca pra ver os outros.</p>`
    : "";
  const linhas = exibidos.map(p => {
    const baixo = Number(p.estoque_atual) <= Number(p.estoque_minimo);
    const conf = p.inventario_conferido || p.tipo_item === "servico" ? "" : ' <span class="tag ambar" title="Inventário a conferir">⚠</span>';
    return `<tr class="linha-clicavel" data-id="${esc(p.id)}">
      <td>${esc(p.codigo)}</td>
      <td>${esc(p.nome)}${prodTagServico(p)}${conf}</td>
      <td>${esc(_prodCategorias[p.categoria_id] || "—")}</td>
      <td>${esc(p.unidade)}</td>
      <td class="num">${num(p.estoque_atual)}</td>
      <td class="num">${num(p.estoque_minimo)}</td>
      <td class="num">${brl(p.custo_ultimo)}</td>
      <td><span class="tag ${baixo?"vermelho":"verde"}">${baixo?"▲ Abaixo do mínimo":"● OK"}</span></td>
    </tr>`;
  }).join("");
  cont.innerHTML = `${aviso_lim}<div class="tabela-rola"><table>
    <thead><tr>
      <th>Código</th><th>Nome</th><th>Categoria</th><th>Un.</th>
      <th class="num">Estoque</th><th class="num">Mínimo</th><th class="num">Custo</th><th>Status</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderProdKanban(dados){
  const cont = $("prod-conteudo");
  if(!cont) return;
  // Agrupa por categoria (top 12 maiores)
  const grupos = {};
  dados.forEach(p => {
    const k = _prodCategorias[p.categoria_id] || "Sem categoria";
    if(!grupos[k]) grupos[k] = [];
    grupos[k].push(p);
  });
  const nomes = Object.keys(grupos).sort((a,b) => grupos[b].length - grupos[a].length).slice(0, 12);
  const colunas = nomes.map(nome => {
    const itens = grupos[nome].slice(0, 30); // max 30 cards por coluna
    const cards = itens.map(p => {
      const baixo = Number(p.estoque_atual) <= Number(p.estoque_minimo);
      return `<div class="serv-kan-card linha-clicavel" data-id="${esc(p.id)}">
        <div class="serv-kan-card-nome">${esc(p.codigo)} · ${esc(p.nome)}${prodTagServico(p)}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${num(p.estoque_atual)} ${esc(p.unidade)}</span>
          ${baixo ? '<span class="tag vermelho" style="font-size:var(--txt-xs);">baixo</span>' : ''}
        </div>
        <div class="serv-kan-card-rod">
          <span class="meta">${esc(p.codigo||"")}</span>
          <strong>${brl(p.custo_ultimo)}</strong>
        </div>
      </div>`;
    }).join("");
    const extra = grupos[nome].length > 30
      ? `<div style="padding:6px;font-size:var(--txt-xs);color:var(--txt-sutil);">+${grupos[nome].length - 30} mais</div>`
      : "";
    return `<div class="serv-kan-col">
      <div class="serv-kan-col-head">${esc(nome)}<span>${grupos[nome].length}</span></div>
      ${cards}${extra}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelProd(){
  $("prod-painel").style.display = "";
  $("prod-ficha").style.display = "none";
  prodEditId = null;
}

/* Fase 100 (#100): categoria de custo do produto (EPI e Uniforme entram na ficha de EPI do colaborador), CA e troca
   do EPI. As colunas ca / epi_validade_dias só existem depois da migration 20261021_fase100b: até lá os dois campos
   ficam escondidos e não vão no salvar (_prodTemEpi vem do select("*") da ficha aberta). */
let _prodTemEpi = false;
function prodPreencherCatCusto(valor){
  const sel = $("prod-cat-custo"); if(!sel) return;
  const lbl = typeof CMP_CAT_LBL === "object" ? CMP_CAT_LBL : {};
  sel.innerHTML = `<option value="">— não definida —</option>` + Object.entries(lbl).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  sel.value = valor || "";
}
function prodAplicarCamposEpi(){
  document.querySelectorAll("#prod-ficha .prod-epi").forEach(el => { el.style.display = _prodTemEpi ? "" : "none"; });
}
/* Fase 108b: tipo de compra padrão (Reposição de estoque / Aplicação direta). O do produto vence o da categoria; sem
   nenhum, o item nasce como aplicação direta (produto_tipo_compra_padrao no banco). O da categoria grava na hora, com
   confirmação, e só para quem escreve em categorias_produto (admin, almoxarife, comprador; diretor). */
const PROD_TIPO_COMPRA_LBL = { reposicao: "Reposição de estoque", aplicacao_direta: "Aplicação direta" };
function prodPodeEditarCategoria(){ return !!usuarioAtual && ["diretor", "admin", "almoxarife", "comprador"].includes(usuarioAtual.cargo); }
function prodAtualizarTipoCompra(){
  const sel = $("prod-tipo-compra"), selCat = $("prod-cat-tipo-compra"); if(!sel || !selCat) return;
  const cat = $("prod-categoria")?.value || "";
  const tCat = cat ? _prodCatTipo[cat] || null : null;
  const op = sel.querySelector('option[value=""]');
  if(op) op.textContent = "Pela categoria: " + (tCat ? PROD_TIPO_COMPRA_LBL[tCat] : "aplicação direta").toLowerCase();
  selCat.value = tCat || "";
  selCat.disabled = !cat || !prodPodeEditarCategoria() || (typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
  selCat.title = !cat ? "Escolha a categoria do produto" : `Vale para os produtos de ${_prodCategorias[cat] || "esta categoria"} que não têm tipo próprio`;
}
async function prodSalvarTipoCategoria(){
  const cat = $("prod-categoria")?.value || "", selCat = $("prod-cat-tipo-compra");
  if(!cat || !selCat) return;
  const novo = selCat.value || null, nomeCat = _prodCategorias[cat] || "a categoria";
  if(!confirm(`Trocar o tipo de compra padrão de ${nomeCat} para "${novo ? PROD_TIPO_COMPRA_LBL[novo] : "sem padrão (aplicação direta)"}"? Vale para os produtos dela que não têm tipo próprio.`)){ prodAtualizarTipoCompra(); return; }
  const { error } = await sb.from("categorias_produto").update({ tipo_compra_padrao: novo }).eq("id", cat);
  if(error){ aviso("app-aviso", "Não foi possível gravar o tipo da categoria: " + error.message, "erro"); prodAtualizarTipoCompra(); return; }
  _prodCatTipo[cat] = novo;
  prodAtualizarTipoCompra();
  aviso("app-aviso", `Tipo de compra padrão de ${nomeCat} atualizado.`, "ok");
}

function novoProduto(){
  prodEditId = null;
  prodPreencherCatCusto(""); if($("prod-ca")) $("prod-ca").value = ""; if($("prod-epi-validade")) $("prod-epi-validade").value = "";
  prodAplicarCamposEpi();
  ["prod-codigo","prod-nome","prod-codbarras","prod-refext","prod-localizacao","prod-descricao"
  ].forEach(k => { const el = $(k); if(el) el.value = ""; });
  _prodCatOriginal = null;
  _prodCodNum = null; _prodCodManual = false;   // lote S56b (#197)
  if($("prod-codigo")) $("prod-codigo").placeholder = "automático";
  if($("btn-prod-gerar-cod")) $("btn-prod-gerar-cod").style.display = "";
  prodMontarSelectCategoria("");   // lote S51: o SESMT escolhe entre as categorias dele
  if($("prod-tipo-compra")) $("prod-tipo-compra").value = "";   // fase 108b
  prodAtualizarTipoCompra();
  $("prod-unidade").value = "un";
  $("prod-minimo").value = 0;
  $("prod-ideal").value = "";
  $("prod-reposicao").checked = false;
  $("prod-conferido").checked = true;
  if($("prod-tipo-item")) $("prod-tipo-item").value = "produto";   // lote S55 (#175)
  prodAplicarTipoItem();
  prodAplicarPerfil();   // lote S51 (produto novo: sem Excluir)
  if(typeof fiscalItemPreencher === "function") fiscalItemPreencher("prod", "produto", { unidade: "un" });   // fase 105a
  abrirFichaProdVisual({ codigo: "(novo)", nome: "Novo produto", estoque_atual: 0, custo_ultimo: 0 });
  prodCodInfo();
}

async function abrirProduto(id){
  prodEditId = id;
  const { data, error } = await sb.from("produtos").select("*").eq("id",id).single();
  if(error){ aviso("app-aviso","Erro ao abrir produto: "+error.message,"erro"); return; }
  $("prod-codigo").value      = data.codigo || "";
  _prodCodNum = null; _prodCodManual = false;   // lote S56b (#197): código existente não muda pelo gerador
  $("prod-codigo").placeholder = "";
  if($("btn-prod-gerar-cod")) $("btn-prod-gerar-cod").style.display = "none";
  prodCodInfo();
  $("prod-nome").value        = data.nome || "";
  _prodCatOriginal = data.categoria_id || null;
  prodMontarSelectCategoria(data.categoria_id || "");   // lote S51 (SESMT: só as categorias dele + a do produto)
  if($("prod-tipo-compra")) $("prod-tipo-compra").value = data.tipo_compra_padrao || "";   // fase 108b
  prodAtualizarTipoCompra();
  $("prod-unidade").value     = data.unidade || "un";
  $("prod-minimo").value      = data.estoque_minimo || 0;
  $("prod-ideal").value       = data.estoque_ideal ?? "";
  $("prod-reposicao").checked = data.controle_reposicao === true;
  $("prod-codbarras").value   = data.codigo_barras || "";
  $("prod-refext").value      = data.ref_externa || "";
  $("prod-localizacao").value = data.localizacao || "";
  $("prod-descricao").value   = data.descricao || "";
  $("prod-conferido").checked = data.inventario_conferido === true;
  if($("prod-tipo-item")) $("prod-tipo-item").value = data.tipo_item === "servico" ? "servico" : "produto";   // lote S55 (#175)
  prodAplicarTipoItem();
  // fase 100: categoria de custo, CA e troca do EPI
  _prodTemEpi = Object.prototype.hasOwnProperty.call(data, "ca");
  prodPreencherCatCusto(data.categoria_custo);
  if($("prod-ca")) $("prod-ca").value = data.ca || "";
  if($("prod-epi-validade")) $("prod-epi-validade").value = data.epi_validade_dias ?? "";
  prodAplicarCamposEpi();
  if(typeof fiscalItemPreencher === "function") fiscalItemPreencher("prod", "produto", data);   // fase 105a: aba Fiscal (NCM)
  prodAplicarPerfil();   // lote S51: Excluir só no cadastro inteiro
  abrirFichaProdVisual(data);
  prodCarregarFabricacoes(id);
}

/* fase 84: aba "Fabricações" do produto: ordens em que ele é o produzido e ordens em que entra como componente */
async function prodCarregarFabricacoes(id){
  const c = $("prod-fabricacoes"); if(!c) return;
  c.innerHTML = `<p class="vazio">Carregando…</p>`;
  const sel = "id,numero,status,descricao,quantidade,quantidade_produzida,unidade,destino,data_abertura,data_conclusao,custo_real";
  const [prod, comp] = await Promise.all([
    sb.from("ordens_fabricacao").select(sel).eq("produto_id", id).order("data_abertura", { ascending: false }).limit(200),
    sb.from("fabricacao_itens").select("id,quantidade_prevista,quantidade_consumida,unidade,custo_unitario,ordem:ordens_fabricacao(" + sel + ")").eq("produto_id", id).limit(300)
  ]);
  if(prodEditId !== id) return;
  const st = s => (typeof fabTag === "function") ? fabTag(s) : esc(s);
  const lnk = (o) => (typeof linkFabricacao === "function") ? linkFabricacao(o.id, o.numero) : esc(o.numero);
  const prodRows = (prod.data || []);
  const compRows = (comp.data || []).filter(i => i.ordem).sort((a, b) => String(b.ordem.data_abertura || "").localeCompare(String(a.ordem.data_abertura || "")));
  const sb2 = $("sb-prod-fab"); if(sb2){ sb2.querySelector(".sb-num").textContent = prodRows.length + compRows.length; sb2.classList.toggle("zero", !(prodRows.length + compRows.length)); }
  c.innerHTML = `<h4 style="margin:0 0 6px;">Produzido por ordem de fabricação <span class="contador">${prodRows.length}</span></h4>` +
    (prodRows.length ? `<div class="tabela-rola"><table><thead><tr><th>Nº</th><th>Abertura</th><th>Descrição</th><th class="num">Qtd</th><th>Destino</th><th class="num">Custo real</th><th>Status</th></tr></thead><tbody>` +
      prodRows.map(o => `<tr><td>${lnk(o)}</td><td>${dataBR(o.data_abertura)}</td><td>${esc(o.descricao || "")}</td><td class="num">${num(o.quantidade_produzida > 0 ? o.quantidade_produzida : o.quantidade)} ${esc(o.unidade || "")}</td><td>${esc(o.destino || "")}</td><td class="num">${brl(o.custo_real)}</td><td>${st(o.status)}</td></tr>`).join("") + `</tbody></table></div>`
      : `<p class="vazio">Nenhuma ordem de fabricação produz este item.</p>`) +
    `<h4 style="margin:14px 0 6px;">Consumido como componente <span class="contador">${compRows.length}</span></h4>` +
    (compRows.length ? `<div class="tabela-rola"><table><thead><tr><th>Nº</th><th>Abertura</th><th>Ordem</th><th class="num">Previsto</th><th class="num">Consumido</th><th class="num">Custo unit.</th><th>Status</th></tr></thead><tbody>` +
      compRows.map(i => `<tr><td>${lnk(i.ordem)}</td><td>${dataBR(i.ordem.data_abertura)}</td><td>${esc(i.ordem.descricao || "")}</td><td class="num">${num(i.quantidade_prevista)} ${esc(i.unidade || "")}</td><td class="num">${num(i.quantidade_consumida)}</td><td class="num">${brl(i.custo_unitario)}</td><td>${st(i.ordem.status)}</td></tr>`).join("") + `</tbody></table></div>`
      : `<p class="vazio">Não entra como componente em nenhuma ordem.</p>`);
}

function abrirFichaProdVisual(p){
  $("prod-painel").style.display = "none";
  $("prod-ficha").style.display = "";

  $("prod-ficha-codigo").textContent = p.codigo || "(novo)";
  $("prod-ficha-nome-chip").textContent = p.nome || "—";
  $("prod-ficha-categoria-chip").textContent = _prodCategorias[p.categoria_id] || "—";
  $("prod-ficha-estoque-chip").textContent = `${num(p.estoque_atual||0)} ${p.unidade||"un"}`;
  $("prod-ficha-custo-chip").textContent = brl(p.custo_ultimo||0);
  const conf = p.inventario_conferido;
  $("prod-ficha-conf-chip").innerHTML = conf
    ? '<span class="tag verde">Conferido</span>'
    : '<span class="tag ambar">⚠ A conferir</span>';
  $("prod-ficha-titulo").textContent = (prodEditId ? `${p.codigo} — ${p.nome}` : "Novo produto") + (p.tipo_item === "servico" ? " · serviço consumido" : "");   // lote S55 (#175)

  ativarTabProd("geral");
}

/* Lote S55 (#175): escolher "Serviço consumido" trava o tipo de compra em Aplicação direta, desmarca e desabilita a
   reposição, o mínimo e o ideal (o banco força o mesmo pelo gatilho) e sugere a unidade vb quando ainda é "un". */
function prodAplicarTipoItem(){
  const sel = $("prod-tipo-item"); if(!sel) return;
  const servico = sel.value === "servico";
  const tc = $("prod-tipo-compra");
  if(tc){
    if(!tc.dataset.titulo) tc.dataset.titulo = tc.title;   // guarda a dica original do campo
    if(servico) tc.value = "aplicacao_direta";
    tc.disabled = servico;
    tc.title = servico ? "Serviço consumido é sempre aplicação direta (obra, TAG ou setor): não entra no estoque" : tc.dataset.titulo;
  }
  [["prod-reposicao", "Serviço consumido não entra na lista de reposição"], ["prod-minimo", "Serviço consumido não tem estoque mínimo"], ["prod-ideal", "Serviço consumido não tem estoque ideal"]].forEach(([id, dica]) => {
    const el = $(id); if(!el) return;
    if(servico){ if(el.type === "checkbox") el.checked = false; else el.value = el.id === "prod-minimo" ? 0 : ""; }
    el.disabled = servico;
    el.title = servico ? dica : "";
  });
  const un = $("prod-unidade");
  if(servico && un && (un.value === "un" || !un.value) && [...un.options].some(o => o.value === "vb")) un.value = "vb";
  const info = $("prod-tipo-item-info");
  if(info) info.textContent = servico ? "Serviço que a CGL consome (frete, hospedagem, locação, serviço de terceiro): aplicação direta, sem estoque. Não é o módulo Serviços (o que a CGL executa)." : "";
}

function ativarTabProd(nome){
  document.querySelectorAll("#prod-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#prod-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Salvar / excluir ---------- */
async function salvarProduto(){
  // lote S56b (#197): no produto novo o código sai do gerador (só o nome é obrigatório aqui)
  if(!$("prod-nome").value.trim() || (prodEditId && !$("prod-codigo").value.trim())){
    aviso("app-aviso", prodEditId ? "Informe código e nome." : "Informe o nome (o código sai das iniciais dele).", "erro");
    ativarTabProd("geral");
    return;
  }
  const reg = {
    codigo:        $("prod-codigo").value.trim(),
    nome:          $("prod-nome").value.trim(),
    categoria_id:  $("prod-categoria").value || null,
    unidade:       $("prod-unidade").value,
    estoque_minimo: Number($("prod-minimo").value || 0),
    estoque_ideal: $("prod-ideal").value === "" ? null : Number($("prod-ideal").value),
    controle_reposicao: $("prod-reposicao").checked,
    codigo_barras: $("prod-codbarras").value.trim() || null,
    ref_externa:   $("prod-refext").value.trim() || null,
    localizacao:   $("prod-localizacao").value.trim() || null,
    descricao:     $("prod-descricao").value.trim() || null,
    inventario_conferido: $("prod-conferido").checked
  };
  // fase 100: categoria de custo sempre (coluna da fase 53); CA e troca só com a migration da fase 100 aplicada
  if($("prod-cat-custo")) reg.categoria_custo = $("prod-cat-custo").value || null;
  if($("prod-tipo-compra")) reg.tipo_compra_padrao = $("prod-tipo-compra").value || null;   // fase 108b (nulo = pela categoria)
  if($("prod-tipo-item")) reg.tipo_item = $("prod-tipo-item").value === "servico" ? "servico" : "produto";   // lote S55 (#175)
  if(reg.tipo_item === "servico"){ reg.tipo_compra_padrao = "aplicacao_direta"; reg.controle_reposicao = false; reg.estoque_minimo = 0; reg.estoque_ideal = null; }
  if(_prodTemEpi){
    reg.ca = ($("prod-ca")?.value || "").trim() || null;
    const val = $("prod-epi-validade")?.value || "";
    reg.epi_validade_dias = val === "" ? null : Math.round(Number(val));
    if(reg.epi_validade_dias != null && !(reg.epi_validade_dias >= 1 && reg.epi_validade_dias <= 3650)){
      aviso("app-aviso", "Troca do EPI: entre 1 e 3650 dias (ou vazio).", "erro"); ativarTabProd("geral"); return;
    }
  }
  // fase 105a: NCM, unidade comercial e valor da remessa (só com as colunas no banco)
  const fis = typeof fiscalItemValores === "function" ? fiscalItemValores("prod") : null;
  if(fis && fis.erro){ aviso("app-aviso", fis.erro, "erro"); ativarTabProd("fiscal"); return; }
  // lote S56b (#199, D-199a): produto novo exige NCM; serviço consumido dispensa; produto antigo sem NCM salva com aviso
  if(fis && !prodEditId && reg.tipo_item !== "servico" && !fis.ncm){
    aviso("app-aviso", "Informe o NCM do produto (8 dígitos, ex.: 8431.43.10): é obrigatório no cadastro novo. Serviço consumido dispensa.", "erro");
    ativarTabProd("fiscal"); $("prod-ncm")?.focus(); return;
  }
  const semNcm = !!fis && !!prodEditId && reg.tipo_item !== "servico" && !fis.ncm;
  if(fis) Object.assign(reg, fis);
  // lote S51 (#150): o SESMT grava só produto que era e continua numa categoria do SESMT (o banco confere igual)
  const perfil = prodPerfilEdicao();
  if(!perfil){ aviso("app-aviso", "Seu perfil só consulta o cadastro de produtos.", "erro"); return; }
  if(perfil === "sesmt" && (!prodCategoriaEhSesmt(reg.categoria_id) || (prodEditId && !prodCategoriaEhSesmt(_prodCatOriginal)))){
    aviso("app-aviso", PROD_MSG_SO_SESMT, "erro"); ativarTabProd("geral"); return;
  }
  if(!prodEditId){   // lote S56b (#197): reserva o número só depois de tudo validado
    const cod = await prodCodigoParaSalvar();
    if(!cod) return;
    reg.codigo = cod;
  }
  let result;
  if(prodEditId){
    result = await sb.from("produtos").update(reg).eq("id", prodEditId).select().single();
  } else {
    result = await sb.from("produtos").insert(reg).select().single();
  }
  if(result.error && !prodEditId && !_prodCodManual && result.error.code === "23505" && /codigo/i.test(result.error.message || "")){
    // lote S56b (#197): número tomado entre a reserva e o insert — gera outro e pede para salvar de novo
    _prodCodNum = null;
    if(await prodGerarCodigo(true)) aviso("app-aviso", `Código já existe: gerei outro (${$("prod-codigo").value}). Confira e salve de novo.`, "aviso");
    return;
  }
  if(result.error){
    // recusa da policy do SESMT: no insert vem 42501; no update de produto fora do SESMT nenhuma linha volta (PGRST116).
    // lote S55: para o perfil "cadastro" a recusa é da guarda de saldo/custo/ativo (a ficha não manda esses campos; se
    // vier 42501 é o banco dizendo que o módulo expirou ou que algo mudou saldo/custo)
    const recusa = result.error.code === "42501" || result.error.code === "PGRST116" || /row-level security/i.test(result.error.message || "");
    const msgBanco = /^Seu perfil/.test(result.error.message || "");
    aviso("app-aviso", perfil === "sesmt" && recusa && !msgBanco ? PROD_MSG_SO_SESMT
      : perfil === "cadastro" && recusa && !msgBanco ? PROD_MSG_SO_CADASTRO
      : "Não foi possível salvar: " + result.error.message, "erro");
    return;
  }
  prodEditId = result.data.id;
  _prodCatOriginal = result.data.categoria_id || null;
  prodAplicarPerfil();
  aviso("app-aviso", semNcm ? "Produto salvo. Sem NCM: preencha quando souber (aba Fiscal)." : "Produto salvo.", semNcm ? "aviso" : "ok");   // lote S56b (#199)
  await carregarProdutos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  await abrirProduto(prodEditId);
}

async function excluirProduto(){
  if(!prodEditId) return;
  if(prodPerfilEdicao() !== "tudo"){ aviso("app-aviso", "Seu perfil não exclui produtos: peça ao almoxarifado.", "erro"); return; }   // lote S51
  if(!confirm("Excluir este produto? A ação não pode ser desfeita.")) return;
  const { error } = await sb.from("produtos").delete().eq("id", prodEditId);
  if(error){
    aviso("app-aviso","Não foi possível excluir: o produto pode estar vinculado a movimentações ou requisições.","erro");
    return;
  }
  aviso("app-aviso","Produto excluído.","ok");
  await carregarProdutos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  mostrarPainelProd();
}

async function criarNovaCategoria(){
  if(!prodPodeEditarCategoria()){ aviso("app-aviso", "Categoria nova é pedida ao almoxarifado ou à diretoria.", "erro"); return; }   // lote S51
  const nome = prompt("Nome da nova categoria:");
  if(!nome) return;
  const { error } = await sb.from("categorias_produto").insert({ nome: nome.trim() });
  if(error){ aviso("app-aviso","Erro ao criar categoria: "+error.message,"erro"); return; }
  await carregarCategorias();
  aviso("app-aviso","Categoria criada.","ok");
}

/* ---------- Listeners ---------- */
function ligarProdutos(){
  document.querySelectorAll("#prod-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#prod-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _prodView = b.dataset.view;
      renderProdutos();
    });
  });
  // lote S42: busca e filtros consultam o servidor
  const recarregar = () => { _prodPagina = 0; carregarProdutos(); };
  $("prod-busca")?.addEventListener("input", debounce(recarregar, 250));
  ["prod-f-categoria","prod-f-estoque","prod-f-tipo"].forEach(id => $(id)?.addEventListener("change", recarregar));   // lote S55: filtro Tipo
  $("prod-tipo-item")?.addEventListener("change", prodAplicarTipoItem);   // lote S55 (#175)
  $("prod-modo")?.addEventListener("click", e => {
    const a = e.target.closest("[data-prod-modo]"); if(!a) return;
    e.preventDefault();
    const m = a.dataset.prodModo;
    if(m === "todos"){ _prodTodos = true; _prodPagina = 0; }
    else if(m === "saldo"){ _prodTodos = false; _prodPagina = 0; }
    else if(m === "ant"){ if(_prodPagina > 0) _prodPagina--; }
    else if(m === "prox"){ if((_prodPagina + 1) * PROD_PAGINA < _prodTotalFiltro) _prodPagina++; }
    carregarProdutos();
  });
  $("prod-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirProduto(tr.dataset.id);
  });

  $("btn-novo-produto")?.addEventListener("click", novoProduto);
  $("btn-voltar-prod")?.addEventListener("click", mostrarPainelProd);
  $("btn-salvar-prod")?.addEventListener("click", () => comBotaoTravado("btn-salvar-prod", salvarProduto));
  $("btn-excluir-prod")?.addEventListener("click", excluirProduto);
  $("btn-nova-cat")?.addEventListener("click", criarNovaCategoria);
  $("btn-prod-gerar-cod")?.addEventListener("click", () => comBotaoTravado("btn-prod-gerar-cod", () => prodGerarCodigo(false)));   // lote S56b (#197)
  $("prod-codigo")?.addEventListener("blur", prodCodNormalizar);
  $("prod-categoria")?.addEventListener("change", prodAtualizarTipoCompra);   // fase 108b
  $("prod-cat-tipo-compra")?.addEventListener("change", () => prodSalvarTipoCategoria());

  document.querySelectorAll("#prod-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabProd(b.dataset.tab));
  });

  const navProd = document.querySelector('nav button[data-secao="produtos"]');
  if(navProd) navProd.addEventListener("click", mostrarPainelProd);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarProdutos);
} else {
  ligarProdutos();
}

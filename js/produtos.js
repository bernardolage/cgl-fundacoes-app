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
let _prodAtivo = true;         // lote S58 (#237): situação do produto aberto; decide entre Arquivar e Reativar
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
  const arq = $("btn-arquivar-prod");   // lote S58 (#237)
  if(arq){ arq.style.display = (perfil === "tudo" && prodEditId) ? "" : "none"; arq.textContent = _prodAtivo ? "📦 Arquivar" : "♻️ Reativar"; }
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
  else if(fEst === "sem_custo") q = q.gt("estoque_atual", 0).lte("custo_ultimo", 0);   // hotfix saída sem custo: o saneamento
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
  prodContarSaidasSemCusto();   // hotfix saída sem custo: contador da visão "Saídas sem custo"
  prodContarSaidasSemVinculo(); // fase 137: contador da visão "Saídas sem vínculo"
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
    // hotfix saída sem custo: a lista do saneamento sai em .xlsx (com a coluna Custo em branco) e volta pela importação
    if($("prod-f-estoque")?.value === "sem_custo"){
      el.innerHTML += `${el.innerHTML ? " " : ""}${num(total)} produto(s) com saldo sem custo · <a href="#" data-prod-modo="sc-xlsx">⬇ Baixar .xlsx para preencher</a>` +
        (prodPodeDefinirCusto() ? ` · <a href="#" data-prod-modo="sc-importar">⬆ Importar custos (.xlsx)</a>` : "");
    }
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

/* lote S60 (#261): atalho do Estoque para todo o inventário com saldo, por categoria. Só leitura. */
async function prodAbrirInventario(categoriaId){
  const sel = $("prod-f-categoria");
  if(sel && categoriaId && ![...sel.options].some(o => o.value === categoriaId)){
    const nome = _estRep.find(p => p.categoria_id === categoriaId)?.categoria?.nome || "";
    sel.insertAdjacentHTML("beforeend", `<option value="${esc(categoriaId)}">${esc(nome)}</option>`);
  }
  if(sel) sel.value = categoriaId;
  if($("prod-f-estoque")) $("prod-f-estoque").value = "positivo";
  if($("prod-busca")) $("prod-busca").value = "";
  if(!irParaSecao("produtos")) return;
  _prodPagina = 0;
  await carregarProdutos();
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
  // hotfix saída sem custo: a visão das saídas não usa a busca nem os filtros de produto
  const ssc = _prodView === "saidas_sem_custo", ssv = _prodView === "saidas_sem_vinculo";   // fase 137: idem "Saídas sem vínculo"
  document.querySelectorAll("#prod-painel .serv-filtros, #prod-modo").forEach(el => { el.style.display = ssc || ssv ? "none" : ""; });
  if(ssc){ prodRenderSaidasSemCusto(); return; }
  if(ssv){ prodRenderSaidasSemVinculo(); return; }
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
        <div class="serv-kan-card-nome">${esc(prodTxt(p))}${prodTagServico(p)}</div>
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

/* ---------- Hotfix saída sem custo (29/10/2026, decisões do Bernardo D-1 e D-2) ----------
   A saída de estoque de produto sem custo gravava R$ 0,00. Quem pode (produtos_write: diretor, admin, almoxarife, comprador,
   gestor de acessórios; espelha produto_pode_definir_custo()) define o custo do produto sem custo e o banco revalora as saídas a
   R$ 0,00 dele. Visão "Saídas sem custo" (vw_estoque_saidas_sem_custo); filtro "Sem custo (com saldo)" com .xlsx para preencher e
   importação da planilha (produto_definir_custo_lote). Sem a migration a visão não aparece. */
let _prodSsc = [];          // linhas de vw_estoque_saidas_sem_custo
let _prodSscTem = null;     // a view existe? (null = ainda não consultou)
function prodPodeDefinirCusto(){ return prodPerfilEdicao() === "tudo"; }
/* "12,50", "R$ 1.234,56" ou 12.5 → número; vazio ou texto → NaN */
function prodNumeroBR(v){
  if(typeof v === "number") return v;
  let t = String(v ?? "").replace(/R\$|\s/g, "");
  if(t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return t === "" ? NaN : Number(t);
}
/* pede o custo unitário e grava pela RPC; true quando gravou. Usada pela ficha, pela visão e pelo balcão (estoque.js) */
async function prodDefinirCusto(p){
  if(!p || !p.id) return false;
  if(!prodPodeDefinirCusto()){ aviso("app-aviso", `${prodTxt(p)} está sem custo. Peça ao almoxarife ou a Compras o custo dele.`, "erro"); return false; }
  const resp = prompt(`Custo unitário de ${prodTxt(p)} (R$ por ${p.unidade || "un"}).\nAs saídas a R$ 0,00 deste produto passam a usar este custo.`, "");
  if(resp === null) return false;
  const custo = prodNumeroBR(resp);
  if(!(custo > 0)){ aviso("app-aviso", "Informe um custo unitário maior que zero (ex.: 12,50).", "erro"); return false; }
  const { data, error } = await sb.rpc("produto_definir_custo", { p_produto: p.id, p_custo: Math.round(custo * 100) / 100, p_obs: null });
  if(error){ aviso("app-aviso", "Custo não gravado: " + error.message, "erro"); return false; }
  const n = Number(data?.revaloradas || 0);
  aviso("app-aviso", `Custo de ${p.codigo || "?"} gravado: ${brl(data?.custo ?? custo)}` + (n ? ` · ${n} saída(s) a R$ 0,00 revalorada(s).` : "."), "ok");
  return true;
}
async function prodContarSaidasSemCusto(){
  const btn = $("prod-view-ssc"); if(!btn || _prodSscTem === false) return;
  const { count, error } = await sb.from("vw_estoque_saidas_sem_custo").select("id", { count: "exact", head: true });
  if(error){ _prodSscTem = false; btn.style.display = "none"; return; }   // migration do hotfix ainda não aplicada
  _prodSscTem = true; btn.style.display = "";
  $("prod-ssc-cont").textContent = count ? `(${num(count)})` : "";
}
/* atalho da Sala de Comando ("Saídas de estoque sem custo"). Fase 146: o cartão da Minha fila passa o produto e a lista abre filtrada */
let _prodSscFiltro = null;
function prodAbrirSaidasSemCusto(produtoId){
  _prodSscFiltro = produtoId || null;
  mostrarPainelProd();
  document.querySelectorAll("#prod-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === "saidas_sem_custo"));
  _prodView = "saidas_sem_custo";
  renderProdutos();
  prodContarSaidasSemCusto();
}
async function prodRenderSaidasSemCusto(){
  const cont = $("prod-conteudo"); if(!cont) return;
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  let qSsc = sb.from("vw_estoque_saidas_sem_custo").select("*").order("data", { ascending: false }).limit(1000);
  if(_prodSscFiltro) qSsc = qSsc.eq("produto_id", _prodSscFiltro);   // fase 146
  const { data, error } = await qSsc;
  if(_prodView !== "saidas_sem_custo") return;
  if(error){ cont.innerHTML = `<p class="vazio">Não foi possível ler as saídas sem custo: ${esc(error.message)}</p>`; return; }
  _prodSsc = data || [];
  const vinculos = await carregarVinculosSaida(_prodSsc.map(r => r.id));   // lote S59
  if(_prodView !== "saidas_sem_custo") return;
  const pode = prodPodeDefinirCusto();
  const nProd = new Set(_prodSsc.map(r => r.produto_id)).size;
  const nComCusto = new Set(_prodSsc.filter(r => r.produto_tem_custo).map(r => r.produto_id)).size;
  if(!_prodSscFiltro && $("prod-ssc-cont")) $("prod-ssc-cont").textContent = _prodSsc.length ? `(${num(_prodSsc.length)})` : "";
  const faixaFiltro = _prodSscFiltro ? `<div class="meta" style="margin:0 0 8px;">Filtrando um produto · <a href="#" data-ssc-acao="ver-todos">ver todos</a></div>` : "";   // fase 146
  const revTodos = pode && nComCusto && !_prodSscFiltro ?` · <a href="#" data-ssc-acao="revalorar-todos" title="Esses produtos ganharam custo depois da saída">Revalorar ${num(nComCusto)} produto(s) que já têm custo</a>` : "";
  const topo = faixaFiltro + `<div class="meta" style="margin:0 0 8px;">${num(_prodSsc.length)} saída(s) a R$ 0,00 · ${num(nProd)} produto(s)` +
    (_prodSsc.length ? ` · <a href="#" data-ssc-acao="xlsx">⬇ Exportar .xlsx</a>` : "") + revTodos +
    (pode ? "" : ` · quem define o custo é o almoxarife ou Compras`) + `</div>`;
  if(!_prodSsc.length){ cont.innerHTML = topo + `<p class="vazio">✅ ${_prodSscFiltro ? "Este produto não tem mais saída a R$ 0,00." : "Nenhuma saída de estoque a R$ 0,00."}</p>`; return; }
  const linhasSsc = _prodSsc.map(r => {
    const acao = !pode ? "" : r.produto_tem_custo
      ? `<button type="button" class="btn-sec btn-sm" data-ssc-revalorar="${esc(r.produto_id)}" title="O produto já tem custo: grava o custo atual nas saídas a R$ 0,00 dele">Revalorar</button>`
      : `<button type="button" class="btn-sec btn-sm" data-ssc-definir="${esc(r.produto_id)}">Definir custo</button>`;
    return `<tr>
      <td>${dataBR(dataLocalISO(r.data))}</td>
      <td><strong>${esc(r.codigo)}</strong> — ${esc(r.produto)}${r.produto_tem_custo ? ' <span class="tag verde" title="O produto já tem custo; falta revalorar a saída">tem custo</span>' : ""}</td>
      <td class="num">${num(r.quantidade)} <span class="meta">${esc(r.unidade || "un")}</span></td>
      <td>${esc(r.destino || "—")}</td>
      <td>${esc(r.retirante || "—")}</td>
      <td>${linkDocumentoSaida(r, vinculos.get(r.id)) || "—"}</td>
      <td>${esc(r.registrado_por_nome || "—")}</td>
      <td>${/* html */ acao}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = topo + (_prodSsc.length >= 1000 ? `<p class="meta">Mostrando as 1.000 mais recentes.</p>` : "") +
    `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Produto</th><th class="num">Qtd</th><th>Destino</th><th>Retirou</th><th>Documento</th><th>Registrado por</th><th></th></tr></thead>
    <tbody>${/* html */ linhasSsc}</tbody></table></div>`;
}
async function prodSscDefinir(id){
  const r = _prodSsc.find(x => x.produto_id === id); if(!r) return;
  if(await prodDefinirCusto({ id, codigo: r.codigo, nome: r.produto, unidade: r.unidade })) await prodRenderSaidasSemCusto();
}
async function prodSscRevalorar(id){
  const { data, error } = await sb.rpc("estoque_revalorar_saidas_sem_custo", { p_produto: id || null });
  if(error){ aviso("app-aviso", "Não revalorou: " + error.message, "erro"); return; }
  aviso("app-aviso", `${num(data?.revaloradas || 0)} saída(s) revalorada(s) pelo custo atual (${num(data?.produtos || 0)} produto(s)).`, "ok");
  await prodRenderSaidasSemCusto();
}
function prodSscExportar(){
  const rows = _prodSsc.map(r => ({ "Data": dataBR(dataLocalISO(r.data)), "Código": r.codigo, "Produto": r.produto, "Unidade": r.unidade,
    "Quantidade": Number(r.quantidade || 0), "Destino": r.destino || "", "Retirou": r.retirante || "", "Documento": r.documento || "",
    "Registrado por": r.registrado_por_nome || "", "Produto já tem custo": r.produto_tem_custo ? "sim" : "não" }));
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "SAIDAS SEM CUSTO");
  XLSX.writeFile(wb, `saidas-sem-custo-${hojeISO()}.xlsx`);
}
/* todos os produtos ativos com saldo e sem custo (páginas de 1.000), com a coluna Custo em branco para a importação */
async function prodSemCustoExportar(){
  const lista = [];
  for(let de = 0; ; de += 1000){
    const { data, error } = await sb.from("produtos").select("codigo,nome,unidade,estoque_atual,categoria_id").eq("ativo", true)
      .gt("estoque_atual", 0).lte("custo_ultimo", 0).order("codigo").range(de, de + 999);
    if(error){ aviso("app-aviso", "Não consegui listar os produtos sem custo: " + error.message, "erro"); return; }
    lista.push(...(data || []));
    if(!data || data.length < 1000) break;
  }
  const rows = lista.map(p => ({ "Código": p.codigo, "Nome": p.nome, "Unidade": p.unidade, "Saldo": Number(p.estoque_atual || 0),
    "Categoria": _prodCategorias[p.categoria_id] || "", "Custo": "" }));
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "SEM CUSTO");
  XLSX.writeFile(wb, `produtos-sem-custo-${hojeISO()}.xlsx`);
}
/* planilha com as colunas Código e Custo (a do "Baixar .xlsx" serve); só produto sem custo recebe, o resto volta no resumo */
async function prodImportarCustos(file){
  if(!file) return;
  if(!prodPodeDefinirCusto()){ aviso("app-aviso", "Seu perfil não define o custo do produto.", "erro"); return; }
  let planilha;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    planilha = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  } catch(e){ aviso("app-aviso", "Não consegui ler a planilha: " + e.message, "erro"); return; }
  const norm = k => String(k || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const campo = (o, nomes) => { const k = Object.keys(o).find(x => nomes.includes(norm(x))); return k ? o[k] : ""; };
  const itens = planilha.map(o => ({ codigo: String(campo(o, ["codigo", "cod"]) ?? "").trim(), custo: campo(o, ["custo", "custo unitario", "valor unitario"]) }))
    .filter(i => i.codigo && String(i.custo).trim() !== "")
    .map(i => { const n = prodNumeroBR(i.custo); return { codigo: i.codigo, custo: isNaN(n) ? String(i.custo) : String(n) }; });
  if(!itens.length){ aviso("app-aviso", "A planilha não tem linhas com Código e Custo preenchidos.", "erro"); return; }
  if(!confirm(`Gravar o custo de ${itens.length} produto(s)?\nSó os que estão sem custo recebem; as saídas a R$ 0,00 deles são revaloradas.`)) return;
  const tot = { definidos: 0, revaloradas: 0, ignorados: [], nao_achados: [], invalidos: [] };
  for(let i = 0; i < itens.length; i += 2000){
    const { data, error } = await sb.rpc("produto_definir_custo_lote", { p_itens: itens.slice(i, i + 2000) });
    if(error){ aviso("app-aviso", `A importação parou na linha ${i + 1}: ${error.message}`, "erro"); break; }
    tot.definidos += Number(data?.definidos || 0); tot.revaloradas += Number(data?.revaloradas || 0);
    ["ignorados", "nao_achados", "invalidos"].forEach(k => tot[k].push(...(data?.[k] || [])));
  }
  const resumo = (t, a) => a.length ? ` · ${t} (${a.length}): ${a.slice(0, 15).join(", ")}${a.length > 15 ? "…" : ""}` : "";
  aviso("app-aviso", `Custos gravados em ${tot.definidos} produto(s), ${tot.revaloradas} saída(s) revalorada(s)` + resumo("já tinham custo", tot.ignorados) +
    resumo("código não achado", tot.nao_achados) + resumo("custo inválido", tot.invalidos), tot.nao_achados.length || tot.invalidos.length ? "aviso" : "ok");
  await carregarProdutos();
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
  sel.innerHTML = `<option value="">— não definida —</option>` + Object.entries(lbl).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
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
  _prodAtivo = true;
  prodAplicarPerfil();   // lote S51 (produto novo: sem Excluir)
  if(typeof fiscalItemPreencher === "function") fiscalItemPreencher("prod", "produto", { unidade: "un" });   // fase 105a
  abrirFichaProdVisual({ codigo: "(novo)", nome: "Novo produto", estoque_atual: 0, custo_ultimo: 0 });
  prodCodInfo();
  _prodMov = null;   // lote S61 (#268)
  if($("prod-movimentos")) $("prod-movimentos").innerHTML = '<p class="vazio">Salve o produto para ver os movimentos.</p>';
  if($("prod-mov-badge")) $("prod-mov-badge").textContent = "";
}

async function abrirProduto(id){
  prodEditId = id;
  const { data, error } = await sb.from("produtos").select("*").eq("id",id).single();
  if(prodEditId !== id) return;   // fase 142: abriu outra ficha enquanto esta carregava
  if(error){ aviso("app-aviso","Erro ao abrir produto: "+error.message,"erro"); return; }
  _prodAtivo = data.ativo !== false;   // lote S58 (#237)
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
  prodCarregarMovimentos(id, data);   // lote S61 (#268)
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

/* ---------- Lote S61 (#268): movimentos do produto ----------
   Todos os movimentos de movimentacoes_estoque (lerTudo, sem o corte de 1.000), da mais nova para a mais antiga. O efeito de cada um é o do
   gatilho aplicar_movimentacao_estoque: entrada e devolução +abs, saída −abs, transferência 0, ajuste com o sinal. D-268a: o saldo de cada
   linha é calculado de trás para frente a partir do saldo atual (em boa parte dos produtos a soma dos movimentos não bate com o saldo, por
   carga ou inventário gravado direto); o topo mostra a diferença. D-268b: só quantidade, sem custo. */
const PROD_MOV_LBL = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", devolucao: "Devolução", transferencia: "Transferência" };
const PROD_MOV_COR = { entrada: "verde", saida: "ambar", ajuste: "azul", devolucao: "verde", transferencia: "cinza" };
let _prodMov = null;   // { id, produto, linhas, soma, saldo, vinc, tipo, termo }
function prodMovDelta(m){
  const q = Number(m.quantidade || 0);
  return m.tipo === "saida" ? -Math.abs(q) : m.tipo === "transferencia" ? 0 : m.tipo === "ajuste" ? q : Math.abs(q);
}
/* texto (busca e planilha) e html (célula, com links já escapados) de "De onde / para onde" */
function prodMovOrigem(m){
  if(m.tipo === "entrada" && m.fornecedor) return { txt: m.fornecedor.razao_social || "Fornecedor", html: esc(m.fornecedor.razao_social || "Fornecedor") };
  const partes = [], txt = [];
  if(m.obra){ const t = `Obra ${m.obra.codigo || ""}`; partes.push(linkObra(m.obra_id, t)); txt.push(t); }
  if(m.equipamento){ const t = `TAG ${m.equipamento.codigo || ""}`; partes.push(linkEquipamento(m.equipamento_id, t)); txt.push(t); }
  if(m.centro){ partes.push(esc(m.centro.nome || "Setor")); txt.push(m.centro.nome || "Setor"); }
  if(m.acessorio){ const t = `Peça ${m.acessorio.numero_serie || m.acessorio.tipo || ""}`.trim(); partes.push(linkAcessorio(m.destino_acessorio_id, t)); txt.push(t); }
  if(m.funcionario){ partes.push(esc(m.funcionario.nome || "")); txt.push(m.funcionario.nome || ""); }
  if(!partes.length && m.fornecedor){ partes.push(esc(m.fornecedor.razao_social || "")); txt.push(m.fornecedor.razao_social || ""); }
  return { txt: txt.join(" · ") || "—", html: partes.join(" · ") || "—" };
}
async function prodCarregarMovimentos(id, produto){
  const c = $("prod-movimentos"); if(!c) return;
  c.innerHTML = `<p class="vazio">Carregando…</p>`;
  const bd0 = $("prod-mov-badge"); if(bd0) bd0.textContent = "";
  const sel = "id,tipo,quantidade,documento,observacoes,data_movimentacao,created_at,obra_id,equipamento_id,centro_custo_id,destino_acessorio_id,fornecedor_id,funcionario_id,estorno_de,"
    + "fornecedor:fornecedores(razao_social),obra:obras!fk_mov_estoque_obra(codigo,nome),equipamento:equipamentos!movimentacoes_estoque_equipamento_id_fkey(codigo),"
    + "centro:centros_custo!movimentacoes_estoque_centro_custo_id_fkey(nome),acessorio:acessorios!movimentacoes_estoque_destino_acessorio_id_fkey(numero_serie,tipo),"
    + "funcionario:funcionarios!movimentacoes_estoque_funcionario_id_fkey(nome),registrador:profiles!movimentacoes_estoque_registrado_por_fkey(nome)";
  const r = await lerTudo(() => sb.from("movimentacoes_estoque").select(sel).eq("produto_id", id).order("data_movimentacao").order("created_at"), "id");
  if(prodEditId !== id) return;   // abriu outra ficha enquanto esta carregava
  if(r.error){ c.innerHTML = `<p class="vazio">Não foi possível carregar os movimentos: ${esc(r.error.message)}</p>`; return; }
  const asc = r.data || [];
  const saldo = Number(produto?.estoque_atual || 0);
  const soma = asc.reduce((t, m) => t + prodMovDelta(m), 0);
  // de trás para frente: a mais nova termina no saldo atual
  let depois = saldo;
  const linhas = asc.slice().reverse().map(m => { const l = { m, delta: prodMovDelta(m), depois }; depois -= l.delta; return l; });
  const vinc = await carregarVinculosSaida(asc.filter(m => m.tipo === "saida").map(m => m.id));
  if(prodEditId !== id) return;
  _prodMov = { id, produto, linhas, soma, saldo, vinc, tipo: "", termo: "" };
  const bd = $("prod-mov-badge"); if(bd) bd.textContent = asc.length ? String(asc.length) : "";
  prodRenderMovimentos();
}
function prodMovFiltradas(){
  const x = _prodMov; if(!x) return [];
  const termo = (x.termo || "").trim().toLowerCase();
  return x.linhas.filter(l => (!x.tipo || l.m.tipo === x.tipo)
    && (!termo || [PROD_MOV_LBL[l.m.tipo], prodMovOrigem(l.m).txt, l.m.documento, x.vinc.get(l.m.id)?.numero, l.m.observacoes, l.m.registrador?.nome]
      .filter(Boolean).join(" ").toLowerCase().includes(termo)));
}
function prodMovSinal(v){ return (v > 0 ? "+" : v < 0 ? "−" : "") + num(Math.abs(v)); }
function prodMovTabelaHTML(){
  const x = _prodMov, un = x.produto?.unidade || "un", fil = prodMovFiltradas();
  if(!x.linhas.length) return `<p class="vazio">Nenhum movimento registrado para este produto.</p>`;
  if(!fil.length) return `<p class="vazio">Nenhum movimento para o filtro.</p>`;
  return `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Tipo</th><th class="num">Quantidade</th><th class="num">Saldo depois</th><th>De onde / para onde</th><th>Documento</th><th>Registrado por</th><th>Obs.</th></tr></thead><tbody>`
    + fil.map(l => { const m = l.m, d = new Date(m.data_movimentacao);
      return `<tr><td>${isNaN(d) ? "—" : esc(d.toLocaleDateString("pt-BR"))}</td>
        <td><span class="tag ${esc(PROD_MOV_COR[m.tipo] || "cinza")}">${esc(PROD_MOV_LBL[m.tipo] || m.tipo)}</span>${m.estorno_de ? ' <span class="meta">estorno</span>' : ""}</td>
        <td class="num">${m.tipo === "transferencia" ? "0 (transferência)" : esc(prodMovSinal(l.delta))} <span class="meta">${esc(un)}</span></td>
        <td class="num">${esc(num(l.depois))}</td>
        <td>${/* html */ prodMovOrigem(m).html}</td>
        <td>${/* html */ linkDocumentoSaida(m, x.vinc.get(m.id)) || "—"}</td>
        <td>${esc(m.registrador?.nome || "")}</td>
        <td class="meta">${esc(m.observacoes || "")}</td></tr>`; }).join("") + `</tbody></table></div>`;
}
function prodRenderMovimentos(){
  const c = $("prod-movimentos"), x = _prodMov; if(!c || !x) return;
  const un = x.produto?.unidade || "un";
  const dif = Math.round((x.saldo - x.soma) * 1000) / 1000;
  const tipos = [["", "Todos"], ["entrada", "Entradas"], ["saida", "Saídas"], ["ajuste", "Ajustes"], ["devolucao", "Devoluções"]];
  c.innerHTML = `<div class="lista-topo compacta">
      <span>Saldo atual <strong>${esc(num(x.saldo))} ${esc(un)}</strong> · soma dos movimentos <strong>${esc(prodMovSinal(x.soma))} ${esc(un)}</strong></span>
      <div class="serv-views" id="prod-mov-tipos" style="margin-left:auto;">${tipos.map(([v, t]) => `<button type="button" class="serv-view-btn${x.tipo === v ? " ativo" : ""}" data-tipo="${esc(v)}">${esc(t)}</button>`).join("")}</div>
      <button type="button" class="btn-sec btn-sm" id="btn-prod-mov-exportar"${x.linhas.length ? "" : " disabled"}>Exportar</button>
    </div>
    ${Math.abs(dif) >= 0.001 ? `<div class="dist-aviso neutro">Diferença <strong>${esc(prodMovSinal(dif))} ${esc(un)}</strong>: saldo gravado sem movimento (carga, inventário ou acerto direto). O saldo de cada linha é contado de trás para frente a partir do saldo atual.</div>` : ""}
    <div class="serv-filtros"><input id="prod-mov-busca" placeholder="Buscar por obra, TAG, pessoa, documento ou observação…" value="${esc(x.termo)}" /></div>
    <div id="prod-mov-tabela">${/* html */ prodMovTabelaHTML()}</div>`;
  c.querySelectorAll("#prod-mov-tipos .serv-view-btn").forEach(b => b.addEventListener("click", () => { x.tipo = b.dataset.tipo; prodRenderMovimentos(); }));
  const busca = $("prod-mov-busca");
  // só a tabela muda na busca, para o campo não perder o foco
  busca?.addEventListener("input", debounce(() => { x.termo = busca.value; const t = $("prod-mov-tabela"); if(t) t.innerHTML = prodMovTabelaHTML(); }));
  $("btn-prod-mov-exportar")?.addEventListener("click", prodExportarMovimentos);
}
function prodExportarMovimentos(){
  const x = _prodMov; if(!x || typeof XLSX === "undefined") return;
  const un = x.produto?.unidade || "un";
  const rows = prodMovFiltradas().map(l => ({
    Data: (l.m.data_movimentacao || "").slice(0, 10), Tipo: PROD_MOV_LBL[l.m.tipo] || l.m.tipo, Quantidade: l.delta, Unidade: un, "Saldo depois": l.depois,
    "De onde / para onde": prodMovOrigem(l.m).txt, Documento: x.vinc.get(l.m.id)?.numero || l.m.documento || "", "Registrado por": l.m.registrador?.nome || "",
    "Observação": l.m.observacoes || "" }));
  const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "MOVIMENTOS");
  XLSX.writeFile(wb, `movimentos-${String(x.produto?.codigo || "produto").replace(/[^\w.-]+/g, "_")}-${hojeISO()}.xlsx`);
}

function abrirFichaProdVisual(p){
  $("prod-painel").style.display = "none";
  $("prod-ficha").style.display = "";

  $("prod-ficha-codigo").textContent = p.codigo || "(novo)";
  $("prod-ficha-nome-chip").textContent = p.nome || "—";
  $("prod-ficha-categoria-chip").textContent = _prodCategorias[p.categoria_id] || "—";
  $("prod-ficha-estoque-chip").textContent = `${num(p.estoque_atual||0)} ${p.unidade||"un"}`;
  $("prod-ficha-custo-chip").textContent = brl(p.custo_ultimo||0);
  const bdc = $("btn-prod-definir-custo");   // hotfix saída sem custo: só produto salvo, sem custo, e quem pode
  if(bdc) bdc.style.display = prodEditId && !(Number(p.custo_ultimo) > 0) && p.tipo_item !== "servico" && prodPodeDefinirCusto() ? "" : "none";
  const conf = p.inventario_conferido;
  $("prod-ficha-conf-chip").innerHTML = conf
    ? '<span class="tag verde">Conferido</span>'
    : '<span class="tag ambar">⚠ A conferir</span>';
  $("prod-ficha-titulo").textContent = (prodEditId ? `${prodTxt(p)}` : "Novo produto") + (p.tipo_item === "servico" ? " · serviço consumido" : "") + (p.ativo === false ? " · arquivado" : "");   // lote S55 (#175); lote S58 (#237)

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
  // lote S58 (#238): NCM opcional no cadastro, com aviso ao salvar; a cobrança é na emissão. Serviço consumido dispensa
  const semNcm = !!fis && reg.tipo_item !== "servico" && !fis.ncm;
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
  aviso("app-aviso", semNcm ? "Produto salvo sem NCM: a nota fiscal só sai com o código (aba Fiscal ou na linha da movimentação)." : "Produto salvo.", semNcm ? "aviso" : "ok");   // lote S56b (#199)
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

/* lote S58 (#237): arquivar tira o produto das buscas e mantém o histórico; pedido antigo continua mostrando o nome.
   Com saldo não arquiva (o saldo sumiria das listas de estoque). O saldo é relido do banco na hora. */
async function arquivarProduto(){
  if(!prodEditId) return;
  if(prodPerfilEdicao() !== "tudo"){ aviso("app-aviso", "Seu perfil não arquiva produtos: peça ao almoxarifado.", "erro"); return; }
  const id = prodEditId;
  if(!_prodAtivo){
    const { error } = await sb.from("produtos").update({ ativo: true }).eq("id", id);
    if(error){ aviso("app-aviso", "Não foi possível reativar: " + error.message, "erro"); return; }
    _prodTotalAtivos = null;
    aviso("app-aviso", "Produto reativado: volta às buscas de Compras, Separação e Movimentações.", "ok");
    await carregarProdutos();
    await abrirProduto(id);
    return;
  }
  const { data: p, error: e1 } = await sb.from("produtos").select("codigo,nome,unidade,estoque_atual").eq("id", id).single();
  if(e1){ aviso("app-aviso", "Não foi possível conferir o saldo: " + e1.message, "erro"); return; }
  if(Number(p.estoque_atual || 0) !== 0){
    aviso("app-aviso", `Não arquivado: ${p.codigo} tem ${num(p.estoque_atual)} ${p.unidade || "un"} em estoque. Zere o saldo antes de arquivar.`, "erro");
    return;
  }
  if(!confirm(`Arquivar ${p.codigo} — ${p.nome}?\n\nSai das buscas de Compras, Separação e Movimentações. Pedidos antigos continuam mostrando o nome, e dá para reativar depois.`)) return;
  const { error } = await sb.from("produtos").update({ ativo: false }).eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível arquivar: " + error.message, "erro"); return; }
  _prodTotalAtivos = null;
  aviso("app-aviso", "Produto arquivado. Ele aparece no filtro de inativos.", "ok");
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

/* ---------- Fase 137 (D10): Saídas sem vínculo ----------
   Saídas de estoque com destino, sem EPI, não desfeitas e sem OS, reparo, fabricação nem separação (vw_estoque_saidas_sem_vinculo).
   "Vincular" liga a saída de TAG ou acessório a uma OS ou reparo (estoque_saida_vincular), com a OS do período como sugestão e
   confirmação. Nada automático. Sem a migration o botão da visão não aparece. */
let _prodSsv = [];            // linhas de vw_estoque_saidas_sem_vinculo do período
let _prodSsvTem = null;       // a view existe? (null = ainda não consultou)
let _prodSsvPeriodo = "90";   // "30" | "90" | "tudo"
let _prodSsvDestino = "";     // "" ou um destino_tipo
const PROD_SSV_DESTINOS = { equipamento: "TAG", acessorio: "Acessório", obra: "Obra", centro_custo: "Setor" };
/* espelha estoque_saida_vincular: almoxarifado_baixa_pecas() ou manutencao_pode_operar(), nunca o auditor */
function prodPodeVincularSaida(){
  return !!usuarioAtual && !ehSomenteLeitura() &&
    ["diretor", "admin", "almoxarife", "auxiliar_almoxarifado", "engenheiro", "mecanico", "gestor_frota", "logistica", "gestor_manutencao"].includes(usuarioAtual.cargo);
}
async function prodContarSaidasSemVinculo(){
  const btn = $("prod-view-ssv"); if(!btn || _prodSsvTem === false) return;
  const { count, error } = await sb.from("vw_estoque_saidas_sem_vinculo").select("id", { count: "exact", head: true });
  if(error){ _prodSsvTem = false; btn.style.display = "none"; return; }   // migration da fase 137 ainda não aplicada
  _prodSsvTem = true; btn.style.display = "";
  $("prod-ssv-cont").textContent = count ? `(${num(count)})` : "";
}
function prodSsvRotulo(v){ return `${v.numero || (v.tipo === "reparo" ? "Reparo" : "OS") + " sem número"}${v.descricao ? " · " + v.descricao : ""}${v.fim ? (v.tipo === "reparo" ? " (concluído)" : " (concluída)") : ""}`; }
async function prodRenderSaidasSemVinculo(){
  const cont = $("prod-conteudo"); if(!cont) return;
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  let desde = null;
  if(_prodSsvPeriodo !== "tudo"){ const d = new Date(); d.setDate(d.getDate() - Number(_prodSsvPeriodo)); desde = dataLocalISO(d); }
  const { data, error } = await lerTudo(() => {
    let q = sb.from("vw_estoque_saidas_sem_vinculo").select("*");
    if(desde) q = q.gte("data", desde);
    return q;
  }, "id");
  if(_prodView !== "saidas_sem_vinculo") return;
  if(error){ cont.innerHTML = `<p class="vazio">Não foi possível ler as saídas sem vínculo: ${esc(error.message)}</p>`; return; }
  _prodSsv = (data || []).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const porDest = {};
  let total = 0;
  _prodSsv.forEach(r => {
    const k = r.destino_tipo; porDest[k] = porDest[k] || { n: 0, v: 0 };
    porDest[k].n++; porDest[k].v += Number(r.valor || 0); total += Number(r.valor || 0);
  });
  const lista = _prodSsvDestino ? _prodSsv.filter(r => r.destino_tipo === _prodSsvDestino) : _prodSsv;
  const pode = prodPodeVincularSaida();
  const optPer = [["30", "Últimos 30 dias"], ["90", "Últimos 90 dias"], ["tudo", "Todo o período"]]
    .map(([v, t]) => `<option value="${esc(v)}"${v === _prodSsvPeriodo ? " selected" : ""}>${esc(t)}</option>`).join("");
  const optDest = `<option value="">Todos os destinos</option>` + Object.entries(PROD_SSV_DESTINOS)
    .map(([v, t]) => `<option value="${esc(v)}"${v === _prodSsvDestino ? " selected" : ""}>${esc(t)} (${num(porDest[v]?.n || 0)})</option>`).join("");
  const resumo = Object.entries(PROD_SSV_DESTINOS).filter(([k]) => porDest[k])
    .map(([k, t]) => `${esc(t)} ${num(porDest[k].n)} · <span data-val-sens>${brl(porDest[k].v)}</span>`).join(" · ");
  const topo = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px;">
      <select id="prod-ssv-periodo" aria-label="Período das saídas">${/* html */ optPer}</select>
      <select id="prod-ssv-destino" aria-label="Destino das saídas">${/* html */ optDest}</select>
    </div>
    <div class="meta" style="margin:0 0 8px;">${num(_prodSsv.length)} saída(s) sem OS, reparo, fabricação nem separação · <span data-val-sens>${brl(total)}</span>` +
    (resumo ? ` · ${/* html */ resumo}` : "") +
    (pode ? " · a sugestão é a OS ou o reparo do mesmo destino no período; confira antes de vincular" : " · quem vincula é o almoxarifado ou a manutenção") + `</div>`;
  if(!lista.length){ cont.innerHTML = topo + `<p class="vazio">✅ Nenhuma saída sem vínculo ${_prodSsvDestino ? "neste destino e " : ""}neste período.</p>`; return; }
  const linhasSsv = lista.map(r => {
    const sug = r.candidato_id
      ? esc(r.candidato_numero || (r.candidato_tipo === "reparo" ? "Reparo sem número" : "OS sem número")) + (r.candidatos > 1 ? ` <span class="meta" title="Outras OS ou reparos no período">+${num(r.candidatos - 1)}</span>` : "")
      : `<span class="meta">—</span>`;
    const acao = pode && (r.equipamento_id || r.destino_acessorio_id)
      ? `<button type="button" class="btn-sec btn-sm" data-ssv-vincular="${esc(r.id)}">Vincular</button>` : "";
    return `<tr data-ssv-linha="${esc(r.id)}">
      <td>${dataBR(dataLocalISO(r.data))}</td>
      <td><strong>${esc(r.codigo)}</strong> — ${esc(r.produto)}</td>
      <td class="num">${num(r.quantidade)} <span class="meta">${esc(r.unidade || "un")}</span></td>
      <td class="num">${brl(r.valor)}</td>
      <td>${esc(r.destino || "—")}</td>
      <td>${esc(r.retirante || "—")}</td>
      <td>${esc(r.documento || "—")}</td>
      <td>${/* html */ sug}</td>
      <td>${/* html */ acao}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = topo +
    `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Produto</th><th class="num">Qtd</th><th class="num">Valor</th><th>Destino</th><th>Retirou</th><th>Documento</th><th>Sugestão</th><th></th></tr></thead>
    <tbody>${/* html */ linhasSsv}</tbody></table></div>`;
}
/* "Vincular": linha embutida logo abaixo da saída, com as OS e os reparos do destino que cobrem a data (sugestão já marcada) */
async function prodSsvAbrirVincular(id){
  const r = _prodSsv.find(x => x.id === id); if(!r) return;
  document.querySelectorAll("#prod-conteudo tr.ssv-vinc").forEach(t => t.remove());
  const tr = [...document.querySelectorAll("#prod-conteudo tr[data-ssv-linha]")].find(t => t.dataset.ssvLinha === id); if(!tr) return;
  const nova = document.createElement("tr");
  nova.className = "ssv-vinc";
  nova.innerHTML = `<td colspan="9"><span class="meta">Carregando OS e reparos…</span></td>`;
  tr.after(nova);
  const { data, error } = await sb.rpc("estoque_saida_vinculos_abertos",
    { p_equipamento: r.equipamento_id || null, p_acessorio: r.destino_acessorio_id || null, p_data: dataLocalISO(r.data) });
  if(!nova.isConnected) return;
  const fechar = `<button type="button" class="btn-sec btn-sm" data-ssv-cancelar>Fechar</button>`;
  if(error){ nova.innerHTML = `<td colspan="9"><span class="meta">Não foi possível ler as OS e os reparos: ${esc(error.message)}</span> ${/* html */ fechar}</td>`; return; }
  const ops = data || [];
  if(!ops.length){ nova.innerHTML = `<td colspan="9"><span class="meta">Nenhuma OS nem reparo de ${esc(r.destino)} cobre a data desta saída.</span> ${/* html */ fechar}</td>`; return; }
  const marcado = ops.some(v => v.id === r.candidato_id) ? r.candidato_id : null;
  const opts = (marcado ? "" : `<option value="">— escolha —</option>`) + ops.map(v =>
    `<option value="${esc(v.tipo)}:${esc(v.id)}"${v.id === marcado ? " selected" : ""}>${esc(prodSsvRotulo(v))}</option>`).join("");
  nova.innerHTML = `<td colspan="9">
      <label for="prod-ssv-sel" class="meta">Vincular a</label>
      <select id="prod-ssv-sel">${/* html */ opts}</select>
      <button type="button" class="btn btn-sm" id="prod-ssv-ok" data-ssv-confirmar="${esc(id)}">Vincular</button>
      <button type="button" class="btn-sec btn-sm" data-ssv-cancelar>Cancelar</button>
    </td>`;
}
async function prodSsvConfirmar(id){
  const r = _prodSsv.find(x => x.id === id); const sel = $("prod-ssv-sel"); if(!r || !sel) return;
  if(!sel.value){ aviso("app-aviso", "Escolha a OS ou o reparo desta saída.", "erro"); return; }
  const [tipo, alvo] = sel.value.split(":");
  const rot = sel.selectedOptions[0]?.textContent || "";
  const ehRep = tipo === "reparo";
  const de = ehRep ? "do reparo" : "da OS", pelo = ehRep ? "pelo reparo" : "pela OS";
  const concluido = /\(concluíd[ao]\)$/.test(rot);
  if(!confirm(`Vincular a saída de ${r.codigo} (${num(r.quantidade)} ${r.unidade || "un"}, ${dataBR(dataLocalISO(r.data))}, ${r.destino}) a ${rot}?\n\n` +
    `A peça entra na lista ${de} e o custo dela passa a contar ${pelo}. ` +
    (concluido ? `Como já está concluíd${ehRep ? "o" : "a"}, o custo sai do custo direto de ${r.destino} e entra ${de} agora.`
               : `Ele só entra no custo quando ${ehRep ? "o reparo" : "a OS"} concluir; até lá sai do custo direto de ${r.destino}.`))) return;
  await comBotaoTravado("prod-ssv-ok", async () => {
    const { error } = await sb.rpc("estoque_saida_vincular", { p_mov: id, p_tipo: tipo, p_id: alvo });
    if(error){ aviso("app-aviso", "Não vinculou: " + error.message, "erro"); return; }
    aviso("app-aviso", `Saída de ${r.codigo} vinculada a ${rot}.`, "ok");
    await prodRenderSaidasSemVinculo();
    prodContarSaidasSemVinculo();
  });
}

/* ---------- Listeners ---------- */
function ligarProdutos(){
  document.querySelectorAll("#prod-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#prod-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _prodView = b.dataset.view;
      _prodSscFiltro = null;   // fase 146: clicar na aba sempre mostra a lista inteira
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
    else if(m === "sc-xlsx"){ prodSemCustoExportar(); return; }          // hotfix saída sem custo
    else if(m === "sc-importar"){ $("prod-custo-arq")?.click(); return; }
    carregarProdutos();
  });
  $("prod-custo-arq")?.addEventListener("change", async e => { const f = e.target.files?.[0]; e.target.value = ""; await prodImportarCustos(f); });
  $("btn-prod-definir-custo")?.addEventListener("click", () => comBotaoTravado("btn-prod-definir-custo", async () => {
    const p = { id: prodEditId, codigo: $("prod-codigo").value, nome: $("prod-nome").value, unidade: $("prod-unidade").value };
    if(await prodDefinirCusto(p)) await abrirProduto(prodEditId);
  }));
  // fase 137: filtros de período e destino da visão "Saídas sem vínculo"
  $("prod-conteudo")?.addEventListener("change", (e) => {
    if(e.target.id === "prod-ssv-periodo"){ _prodSsvPeriodo = e.target.value; prodRenderSaidasSemVinculo(); }
    else if(e.target.id === "prod-ssv-destino"){ _prodSsvDestino = e.target.value; prodRenderSaidasSemVinculo(); }
  });
  $("prod-conteudo")?.addEventListener("click", (e) => {
    // fase 137: ações da visão "Saídas sem vínculo"
    const sv = e.target.closest("[data-ssv-vincular]"); if(sv){ prodSsvAbrirVincular(sv.dataset.ssvVincular); return; }
    const sk = e.target.closest("[data-ssv-confirmar]"); if(sk){ prodSsvConfirmar(sk.dataset.ssvConfirmar); return; }
    if(e.target.closest("[data-ssv-cancelar]")){ e.target.closest("tr.ssv-vinc")?.remove(); return; }
    // hotfix saída sem custo: ações da visão "Saídas sem custo"
    const sd = e.target.closest("[data-ssc-definir]"); if(sd){ prodSscDefinir(sd.dataset.sscDefinir); return; }
    const sr = e.target.closest("[data-ssc-revalorar]"); if(sr){ prodSscRevalorar(sr.dataset.sscRevalorar); return; }
    const sa = e.target.closest("[data-ssc-acao]");
    if(sa){
      e.preventDefault();
      if(sa.dataset.sscAcao === "xlsx") prodSscExportar();
      else if(sa.dataset.sscAcao === "ver-todos"){ _prodSscFiltro = null; prodRenderSaidasSemCusto(); prodContarSaidasSemCusto(); }   // fase 146
      else if(sa.dataset.sscAcao === "revalorar-todos" && confirm("Gravar o custo atual nas saídas a R$ 0,00 de todos os produtos que já têm custo?")) prodSscRevalorar(null);
      return;
    }
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirProduto(tr.dataset.id);
  });

  $("btn-novo-produto")?.addEventListener("click", novoProduto);
  $("btn-voltar-prod")?.addEventListener("click", mostrarPainelProd);
  $("btn-salvar-prod")?.addEventListener("click", () => comBotaoTravado("btn-salvar-prod", salvarProduto));
  $("btn-excluir-prod")?.addEventListener("click", excluirProduto);
  $("btn-arquivar-prod")?.addEventListener("click", () => comBotaoTravado("btn-arquivar-prod", arquivarProduto));   // lote S58 (#237)
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

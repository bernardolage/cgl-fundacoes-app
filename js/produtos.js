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
const PROD_COLS = "id,codigo,nome,unidade,categoria_id,estoque_atual,estoque_minimo,estoque_ideal,controle_reposicao,custo_ultimo,inventario_conferido,ativo";

/* ---------- Categorias ---------- */
async function carregarCategorias(){
  const { data } = await sb.from("categorias_produto").select("id,nome").order("nome");
  _prodCategorias = {};
  (data || []).forEach(c => { _prodCategorias[c.id] = c.nome; });
  const opc = '<option value="">— sem categoria —</option>' +
    (data||[]).map(c=>`<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  const sel = $("prod-categoria");
  if(sel) sel.innerHTML = opc;
}

/* ---------- Produtos ---------- */
function prodTermo(){ return ($("prod-busca")?.value || "").trim().replace(/[%,()]/g, " ").trim(); }
function prodModoPadrao(){ return !prodTermo() && !($("prod-f-categoria")?.value) && !($("prod-f-estoque")?.value) && !_prodTodos; }
async function carregarProdutos(){
  const termo = prodTermo(), fCat = $("prod-f-categoria")?.value || "", fEst = $("prod-f-estoque")?.value || "";
  const baixo = fEst === "baixo";
  let q = sb.from("produtos").select(PROD_COLS, { count: "exact" }).eq("ativo", fEst !== "inativos").order("nome");
  if(termo) q = q.or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%,codigo_barras.eq.${termo}`);
  if(fCat) q = q.eq("categoria_id", fCat);
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
  if(termo || $("prod-f-categoria")?.value || $("prod-f-estoque")?.value){
    el.innerHTML = total > n ? `Mostrando ${n} de ${num(total)} resultado(s): refine a busca para ver os outros.` : "";
    return;
  }
  const off = 'style="opacity:.5;pointer-events:none;"';
  if(!_prodTodos){
    el.innerHTML = `Mostrando os produtos com saldo em estoque. <a href="#" data-prod-modo="todos">Mostrar todos os ${num(_prodTotalAtivos || 0)} ativos (${PROD_PAGINA} por página)</a>`;
  } else {
    const paginas = Math.max(1, Math.ceil(total / PROD_PAGINA)), pag = _prodPagina + 1;
    el.innerHTML = `Todos os produtos ativos · página ${pag} de ${paginas} (${num(_prodPagina * PROD_PAGINA + 1)}–${num(_prodPagina * PROD_PAGINA + n)} de ${num(total)}) ·
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
    const conf = p.inventario_conferido ? "" : ' <span class="tag ambar" title="Inventário a conferir">⚠</span>';
    return `<tr class="linha-clicavel" data-id="${esc(p.id)}">
      <td>${esc(p.codigo)}</td>
      <td>${esc(p.nome)}${conf}</td>
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
        <div class="serv-kan-card-nome">${esc(p.codigo)} · ${esc(p.nome)}</div>
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

function novoProduto(){
  prodEditId = null;
  prodPreencherCatCusto(""); if($("prod-ca")) $("prod-ca").value = ""; if($("prod-epi-validade")) $("prod-epi-validade").value = "";
  prodAplicarCamposEpi();
  ["prod-codigo","prod-nome","prod-codbarras","prod-refext","prod-localizacao","prod-descricao"
  ].forEach(k => { const el = $(k); if(el) el.value = ""; });
  $("prod-categoria").value = "";
  $("prod-unidade").value = "un";
  $("prod-minimo").value = 0;
  $("prod-ideal").value = "";
  $("prod-reposicao").checked = false;
  $("prod-conferido").checked = true;
  $("btn-excluir-prod").style.display = "none";
  abrirFichaProdVisual({ codigo: "(novo)", nome: "Novo produto", estoque_atual: 0, custo_ultimo: 0 });
}

async function abrirProduto(id){
  prodEditId = id;
  const { data, error } = await sb.from("produtos").select("*").eq("id",id).single();
  if(error){ aviso("app-aviso","Erro ao abrir produto: "+error.message,"erro"); return; }
  $("prod-codigo").value      = data.codigo || "";
  $("prod-nome").value        = data.nome || "";
  $("prod-categoria").value   = data.categoria_id || "";
  $("prod-unidade").value     = data.unidade || "un";
  $("prod-minimo").value      = data.estoque_minimo || 0;
  $("prod-ideal").value       = data.estoque_ideal ?? "";
  $("prod-reposicao").checked = data.controle_reposicao === true;
  $("prod-codbarras").value   = data.codigo_barras || "";
  $("prod-refext").value      = data.ref_externa || "";
  $("prod-localizacao").value = data.localizacao || "";
  $("prod-descricao").value   = data.descricao || "";
  $("prod-conferido").checked = data.inventario_conferido === true;
  // fase 100: categoria de custo, CA e troca do EPI
  _prodTemEpi = Object.prototype.hasOwnProperty.call(data, "ca");
  prodPreencherCatCusto(data.categoria_custo);
  if($("prod-ca")) $("prod-ca").value = data.ca || "";
  if($("prod-epi-validade")) $("prod-epi-validade").value = data.epi_validade_dias ?? "";
  prodAplicarCamposEpi();
  $("btn-excluir-prod").style.display = "";
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
  $("prod-ficha-titulo").textContent = prodEditId ? `${p.codigo} — ${p.nome}` : "Novo produto";

  ativarTabProd("geral");
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
  if(!$("prod-codigo").value.trim() || !$("prod-nome").value.trim()){
    aviso("app-aviso","Informe código e nome.","erro");
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
  if(_prodTemEpi){
    reg.ca = ($("prod-ca")?.value || "").trim() || null;
    const val = $("prod-epi-validade")?.value || "";
    reg.epi_validade_dias = val === "" ? null : Math.round(Number(val));
    if(reg.epi_validade_dias != null && !(reg.epi_validade_dias >= 1 && reg.epi_validade_dias <= 3650)){
      aviso("app-aviso", "Troca do EPI: entre 1 e 3650 dias (ou vazio).", "erro"); ativarTabProd("geral"); return;
    }
  }
  let result;
  if(prodEditId){
    result = await sb.from("produtos").update(reg).eq("id", prodEditId).select().single();
  } else {
    result = await sb.from("produtos").insert(reg).select().single();
  }
  if(result.error){
    aviso("app-aviso","Não foi possível salvar: "+result.error.message,"erro");
    return;
  }
  prodEditId = result.data.id;
  $("btn-excluir-prod").style.display = "";
  aviso("app-aviso","Produto salvo.","ok");
  await carregarProdutos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  await abrirProduto(prodEditId);
}

async function excluirProduto(){
  if(!prodEditId) return;
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
  ["prod-f-categoria","prod-f-estoque"].forEach(id => $(id)?.addEventListener("change", recarregar));
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

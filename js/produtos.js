/* ====================================================================
   Módulo: Produtos e Categorias
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   Sem statusbar (produto é ativo/inativo, sem fluxo).
   ==================================================================== */

let _produtos     = [];
let _prodView     = "lista";
let prodEditId    = null;
let _prodCategorias = {};   // id -> nome

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
async function carregarProdutos(){
  const { data, error } = await sb.from("produtos")
    .select("id,codigo,nome,unidade,categoria_id,estoque_atual,estoque_minimo,custo_ultimo,inventario_conferido,ativo")
    .order("nome").limit(2000);
  _produtos = error ? [] : (data || []);
  renderProdutos();

  // Alimenta select da entrada de estoque (compat com modulo estoque)
  const sel = $("ent-produto");
  if(sel){
    sel.innerHTML = `<option value="">selecione...</option>` +
      _produtos.map(p=>`<option value="${esc(p.id)}">${esc(p.codigo)} — ${esc(p.nome)}</option>`).join("");
  }
}

/* ---------- Filtros ---------- */
function prodFiltrados(){
  const termo = ($("prod-busca")?.value || "").trim().toLowerCase();
  const fCat = $("prod-f-categoria")?.value || "";
  const fEst = $("prod-f-estoque")?.value || "";
  return _produtos.filter(p => {
    if(fCat && p.categoria_id !== fCat) return false;
    if(fEst === "baixo" && !(Number(p.estoque_atual) <= Number(p.estoque_minimo))) return false;
    if(fEst === "zero" && Number(p.estoque_atual) > 0) return false;
    if(fEst === "positivo" && Number(p.estoque_atual) <= 0) return false;
    if(termo){
      const alvo = `${p.codigo||""} ${p.nome||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function preencherFiltrosProd(){
  const sel = $("prod-f-categoria");
  if(sel){
    const cats = Object.entries(_prodCategorias)
      .map(([id, nome]) => ({ id, nome }))
      .sort((a,b) => a.nome.localeCompare(b.nome,"pt-BR"));
    sel.innerHTML = `<option value="">Todas as categorias</option>` +
      cats.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  }
}

/* ---------- Render ---------- */
function renderProdutos(){
  preencherFiltrosProd();
  const dados = prodFiltrados();
  const cont = $("prod-contador");
  if(cont) cont.textContent = `${dados.length} de ${_produtos.length}`;
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
    ? `<p style="font-size:11px;color:var(--txt-sutil);margin:6px 0;">Mostrando primeiros ${max} de ${dados.length} — refine a busca pra ver os outros.</p>`
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
      <td><span class="tag ${baixo?"vermelho":"verde"}">${baixo?"Abaixo do mínimo":"OK"}</span></td>
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
          ${baixo ? '<span class="tag vermelho" style="font-size:10px;">baixo</span>' : ''}
        </div>
        <div class="serv-kan-card-rod">
          <span></span>
          <strong>${brl(p.custo_ultimo)}</strong>
        </div>
      </div>`;
    }).join("");
    const extra = grupos[nome].length > 30
      ? `<div style="padding:6px;font-size:11px;color:var(--txt-sutil);">+${grupos[nome].length - 30} mais</div>`
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

function novoProduto(){
  prodEditId = null;
  ["prod-codigo","prod-nome","prod-codbarras","prod-refext","prod-localizacao","prod-descricao"
  ].forEach(k => { const el = $(k); if(el) el.value = ""; });
  $("prod-categoria").value = "";
  $("prod-unidade").value = "un";
  $("prod-minimo").value = 0;
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
  $("prod-codbarras").value   = data.codigo_barras || "";
  $("prod-refext").value      = data.ref_externa || "";
  $("prod-localizacao").value = data.localizacao || "";
  $("prod-descricao").value   = data.descricao || "";
  $("prod-conferido").checked = data.inventario_conferido === true;
  $("btn-excluir-prod").style.display = "";
  abrirFichaProdVisual(data);
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
    : '<span class="tag ambar">A conferir</span>';
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
    codigo_barras: $("prod-codbarras").value.trim() || null,
    ref_externa:   $("prod-refext").value.trim() || null,
    localizacao:   $("prod-localizacao").value.trim() || null,
    descricao:     $("prod-descricao").value.trim() || null,
    inventario_conferido: $("prod-conferido").checked
  };
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
  ["prod-busca","prod-f-categoria","prod-f-estoque"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "prod-busca" ? "input" : "change", renderProdutos);
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

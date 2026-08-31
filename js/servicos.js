/* ====================================================================
   Módulo: Catálogo de Serviços
   Visualização e edição do catálogo de serviços da CGL:
   categorias (3 níveis) -> serviços -> variantes precificáveis.
   Três visões: Lista, Catálogo (por categoria) e Kanban.
   Carregamento sob demanda: só busca o catálogo ao abrir a aba.
   ==================================================================== */

/* ---------- Estado do módulo ---------- */
let _servCarregado = false;     /* catálogo já buscado do banco? */
let _servCategorias = [];       /* categorias_servico */
let _servServicos   = [];       /* servicos */
let _servVariantes  = [];       /* servico_variantes */
let _servPrecos     = {};       /* variante_id -> registro de preço vigente */
let _servView       = "lista";  /* visão atual: lista | catalogo | kanban */
let servEditId      = null;     /* id da variante em edição */

/* ---------- Rótulos ---------- */
const SERV_NATUREZA = {
  mobilizacao:        "Mobilização",
  verba:              "Verba administrativa",
  execucao:           "Execução",
  execucao_acessoria: "Execução acessória",
  locacao_equipto:    "Locação de equipamento",
  insumo:             "Insumo",
  imposto:            "Imposto",
  item_diario:        "Item diário"
};
const SERV_NAT_COR = {
  execucao:"azul", execucao_acessoria:"azul", mobilizacao:"ambar",
  locacao_equipto:"verde", verba:"cinza", insumo:"cinza",
  imposto:"vermelho", item_diario:"ambar"
};
const SERV_TIPO_OBRA = {
  convencional:"Convencional", industrial:"Industrial", especial:"Especial"
};
function corTipoObra(t){
  return t === "industrial" ? "ambar" : t === "especial" ? "azul" : "cinza";
}

/* ---------- Helpers de hierarquia ---------- */
const servCatById = (id) => _servCategorias.find(c => c.id === id);
const servById    = (id) => _servServicos.find(s => s.id === id);

/* sobe a hierarquia de categorias até o nível 1 (categoria principal) */
function servCatRaiz(catId){
  let c = servCatById(catId), guarda = 0;
  while(c && c.parent_id && guarda < 6){ c = servCatById(c.parent_id); guarda++; }
  return c || null;
}
/* caminho legível "Principal > Subcategoria > Tipo" */
function servCatCaminho(catId){
  const partes = []; let c = servCatById(catId), guarda = 0;
  while(c && guarda < 6){
    partes.unshift(c.nome);
    c = c.parent_id ? servCatById(c.parent_id) : null;
    guarda++;
  }
  return partes.join(" › ");
}
/* preço de referência de uma variante (ou null) */
function precoVariante(id){
  const p = _servPrecos[id];
  return p && p.preco_referencia != null ? Number(p.preco_referencia) : null;
}

/* ---------- Carga do catálogo ---------- */
async function carregarCatalogoServicos(){
  const cont = $("serv-conteudo");
  if(cont) cont.innerHTML = `<p class="vazio">Carregando catálogo...</p>`;
  const [cat, srv, vrt, prc] = await Promise.all([
    sb.from("categorias_servico").select("*").order("ordem_exibicao"),
    sb.from("servicos").select("*").order("codigo"),
    sb.from("servico_variantes").select("*").order("codigo"),
    sb.from("servico_precos").select("*").order("vigente_desde", { ascending:false })
  ]);
  if(cat.error || srv.error || vrt.error){
    if(cont) cont.innerHTML = `<p class="vazio">Erro ao carregar o catálogo de serviços.</p>`;
    return;
  }
  _servCategorias = cat.data || [];
  _servServicos   = srv.data || [];
  _servVariantes  = vrt.data || [];
  _servPrecos = {};
  /* mantém apenas o preço mais recente de cada variante */
  (prc.data || []).forEach(p => { if(!_servPrecos[p.variante_id]) _servPrecos[p.variante_id] = p; });
  _servCarregado = true;
  preencherFiltrosServ();
  renderServicos();
}

/* ---------- Filtros ---------- */
function preencherFiltrosServ(){
  const raizes = _servCategorias
    .filter(c => c.nivel === 1)
    .sort((a,b) => (a.ordem_exibicao||0) - (b.ordem_exibicao||0));
  $("serv-f-categoria").innerHTML = `<option value="">Todas as categorias</option>` +
    raizes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  $("serv-f-natureza").innerHTML = `<option value="">Todas as naturezas</option>` +
    Object.entries(SERV_NATUREZA).map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  $("serv-f-tipoobra").innerHTML = `<option value="">Todos os tipos de obra</option>` +
    Object.entries(SERV_TIPO_OBRA).map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join("");
}

/* devolve as variantes que passam pelos filtros, já com serviço e raiz resolvidos */
function variantesFiltradas(){
  const termo = ($("serv-busca").value || "").trim().toLowerCase();
  const fCat  = $("serv-f-categoria").value;
  const fNat  = $("serv-f-natureza").value;
  const fObra = $("serv-f-tipoobra").value;
  return _servVariantes
    .map(v => {
      const s = servById(v.servico_id);
      const raiz = s ? servCatRaiz(s.categoria_id) : null;
      return { v, s, raiz };
    })
    .filter(({ v, s, raiz }) => {
      if(!s) return false;
      if(fCat  && (!raiz || raiz.id !== fCat)) return false;
      if(fNat  && s.natureza !== fNat) return false;
      if(fObra && v.tipo_obra !== fObra) return false;
      if(termo){
        const alvo = `${v.codigo} ${v.nome} ${s.nome}`.toLowerCase();
        if(!alvo.includes(termo)) return false;
      }
      return true;
    });
}

/* ---------- Render: despachante ---------- */
function renderServicos(){
  if(!_servCarregado) return;
  const dados = variantesFiltradas();
  $("serv-contador").textContent = `${dados.length} de ${_servVariantes.length}`;
  if(_servView === "kanban")        renderServKanban(dados);
  else if(_servView === "catalogo") renderServCatalogo(dados);
  else                              renderServLista(dados);
}

/* ---------- Render: Lista ---------- */
function renderServLista(dados){
  const cont = $("serv-conteudo");
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum serviço encontrado para os filtros.</p>`;
    return;
  }
  const linhas = dados.map(({ v, s, raiz }) => {
    const preco = precoVariante(v.id);
    return `<tr class="linha-clicavel" data-id="${esc(v.id)}">
      <td>${esc(v.codigo)}</td>
      <td>${esc(v.nome)}${v.ativo===false?' <span class="tag cinza">inativa</span>':''}</td>
      <td>${esc(s.nome)}</td>
      <td>${esc(raiz ? raiz.nome : "—")}</td>
      <td><span class="tag ${corTipoObra(v.tipo_obra)}">${esc(SERV_TIPO_OBRA[v.tipo_obra]||v.tipo_obra||"—")}</span></td>
      <td>${esc(s.unidade||"—")}</td>
      <td class="num">${preco!=null ? brl(preco) : '<span class="tag cinza">sem preço</span>'}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Código</th><th>Variante</th><th>Serviço</th><th>Categoria</th>
      <th>Tipo de obra</th><th>Un.</th><th class="num">Preço ref.</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

/* agrupa as variantes filtradas por serviço */
function agruparPorServico(dados){
  const grupos = {};
  dados.forEach(d => {
    if(!grupos[d.v.servico_id]) grupos[d.v.servico_id] = { s:d.s, raiz:d.raiz, vars:[] };
    grupos[d.v.servico_id].vars.push(d.v);
  });
  return grupos;
}

/* faixa de preço de uma lista de variantes, como texto */
function faixaPreco(vars){
  const precos = vars.map(v => precoVariante(v.id)).filter(x => x != null);
  if(!precos.length) return "sem preço";
  const min = Math.min(...precos), max = Math.max(...precos);
  return min === max ? brl(min) : `${brl(min)} – ${brl(max)}`;
}

/* ---------- Render: Kanban (colunas = categorias principais) ---------- */
function renderServKanban(dados){
  const cont = $("serv-conteudo");
  const grupos = agruparPorServico(dados);
  const raizes = _servCategorias
    .filter(c => c.nivel === 1)
    .sort((a,b) => (a.ordem_exibicao||0) - (b.ordem_exibicao||0));
  const colunas = raizes.map(r => {
    const servs = Object.values(grupos).filter(g => g.raiz && g.raiz.id === r.id);
    if(!servs.length) return "";
    const cards = servs.map(g => `
      <div class="serv-kan-card">
        <div class="serv-kan-card-nome">${esc(g.s.nome)}</div>
        <div class="serv-kan-card-meta">
          <span class="tag ${SERV_NAT_COR[g.s.natureza]||'cinza'}">${esc(SERV_NATUREZA[g.s.natureza]||g.s.natureza)}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${g.vars.length} variante${g.vars.length>1?'s':''}</span>
          <strong>${faixaPreco(g.vars)}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col">
      <div class="serv-kan-col-head">${esc(r.nome)}<span>${servs.length}</span></div>
      ${cards}
    </div>`;
  }).join("");
  cont.innerHTML = colunas.trim()
    ? `<div class="serv-kanban">${colunas}</div>`
    : `<p class="vazio">Nenhum serviço encontrado para os filtros.</p>`;
}

/* ---------- Render: Catálogo (agrupado por categoria principal) ---------- */
function renderServCatalogo(dados){
  const cont = $("serv-conteudo");
  const grupos = agruparPorServico(dados);
  const raizes = _servCategorias
    .filter(c => c.nivel === 1)
    .sort((a,b) => (a.ordem_exibicao||0) - (b.ordem_exibicao||0));
  let html = "";
  raizes.forEach(r => {
    const servs = Object.values(grupos).filter(g => g.raiz && g.raiz.id === r.id);
    if(!servs.length) return;
    html += `<div class="serv-cat-grupo">
      <div class="serv-cat-head">${esc(r.nome)}<span>${servs.length} serviço${servs.length>1?'s':''}</span></div>`;
    servs.forEach(g => {
      const linhas = g.vars.map(v => {
        const preco = precoVariante(v.id);
        return `<tr class="linha-clicavel" data-id="${esc(v.id)}">
          <td>${esc(v.codigo)}</td>
          <td>${esc(v.nome)}</td>
          <td><span class="tag ${corTipoObra(v.tipo_obra)}">${esc(SERV_TIPO_OBRA[v.tipo_obra]||v.tipo_obra||"—")}</span></td>
          <td class="num">${preco!=null ? brl(preco) : '<span class="tag cinza">—</span>'}</td>
        </tr>`;
      }).join("");
      html += `<div class="serv-serv-card">
        <div class="serv-serv-head">
          <div>
            <strong>${esc(g.s.nome)}</strong>
            <span class="serv-caminho">${esc(servCatCaminho(g.s.categoria_id))} · ${esc(g.s.unidade||"")}</span>
          </div>
          <span class="tag ${SERV_NAT_COR[g.s.natureza]||'cinza'}">${esc(SERV_NATUREZA[g.s.natureza]||g.s.natureza)}</span>
        </div>
        <div class="tabela-rola"><table>
          <thead><tr><th>Código</th><th>Variante</th><th>Tipo de obra</th><th class="num">Preço ref.</th></tr></thead>
          <tbody>${linhas}</tbody></table></div>
      </div>`;
    });
    html += `</div>`;
  });
  cont.innerHTML = html || `<p class="vazio">Nenhum serviço encontrado para os filtros.</p>`;
}

/* ---------- Alternância painel x ficha ---------- */
function mostrarPainelServ(){
  $("serv-ficha").style.display = "none";
  $("serv-painel").style.display = "block";
}

function abrirFichaServ(id){
  const v = _servVariantes.find(x => x.id === id);
  if(!v) return;
  servEditId = id;
  const s = servById(v.servico_id);
  const p = _servPrecos[id] || {};

  $("serv-tipoobra").innerHTML = Object.entries(SERV_TIPO_OBRA)
    .map(([val,l]) => `<option value="${val}">${esc(l)}</option>`).join("");

  $("serv-ficha-contexto").innerHTML = s ? `
    <div><span>Serviço</span><strong>${esc(s.nome)}</strong></div>
    <div><span>Categoria</span><strong>${esc(servCatCaminho(s.categoria_id))}</strong></div>
    <div><span>Natureza</span><strong>${esc(SERV_NATUREZA[s.natureza]||s.natureza)}</strong></div>
    <div><span>Unidade</span><strong>${esc(s.unidade||"—")}</strong></div>` : "";

  $("serv-codigo").value   = v.codigo || "";
  $("serv-nome").value     = v.nome || "";
  $("serv-tipoobra").value = v.tipo_obra || "convencional";
  $("serv-diam").value     = v.diametro_mm ?? "";
  $("serv-profmin").value  = v.faixa_prof_min ?? "";
  $("serv-profmax").value  = v.faixa_prof_max ?? "";
  $("serv-desc").value     = v.descricao || "";
  $("serv-preco").value    = p.preco_referencia ?? "";
  $("serv-custo").value    = p.custo_estimado ?? "";
  $("serv-margem").value   = p.margem_minima_pct ?? "";
  $("serv-obs").value      = v.observacoes || "";
  $("serv-ativo").checked  = v.ativo !== false;
  $("serv-ficha-titulo").textContent = v.nome || "Editar serviço";

  $("serv-painel").style.display = "none";
  $("serv-ficha").style.display = "block";
  $("serv-nome").focus();
}

/* ---------- Eventos ---------- */
document.querySelectorAll(".serv-view-btn").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".serv-view-btn").forEach(x => x.classList.remove("ativo"));
    b.classList.add("ativo");
    _servView = b.dataset.view;
    renderServicos();
  });
});

["serv-busca","serv-f-categoria","serv-f-natureza","serv-f-tipoobra"].forEach(id => {
  const el = $(id);
  if(el) el.addEventListener(id === "serv-busca" ? "input" : "change", renderServicos);
});

$("serv-conteudo").addEventListener("click", (e) => {
  const tr = e.target.closest("tr.linha-clicavel");
  if(tr) abrirFichaServ(tr.dataset.id);
});

$("btn-voltar-serv").addEventListener("click", mostrarPainelServ);

/* ao clicar na aba Serviços: volta ao painel e carrega o catálogo na 1ª vez */
const navServicos = document.querySelector('nav button[data-secao="servicos"]');
if(navServicos) navServicos.addEventListener("click", () => {
  mostrarPainelServ();
  if(!_servCarregado) carregarCatalogoServicos();
});

/* ---------- Salvar (edição da variante + preço de referência) ---------- */
$("form-servico").addEventListener("submit", async (e) => {
  e.preventDefault();
  if(!servEditId) return;

  /* valida a faixa de profundidade (regra do banco: ambas ou nenhuma) */
  const pmin = $("serv-profmin").value !== "" ? Number($("serv-profmin").value) : null;
  const pmax = $("serv-profmax").value !== "" ? Number($("serv-profmax").value) : null;
  if((pmin === null) !== (pmax === null)){
    aviso("app-aviso","Preencha as duas profundidades (mínima e máxima) ou deixe ambas em branco.","erro");
    return;
  }
  if(pmin !== null && pmax !== null && pmin >= pmax){
    aviso("app-aviso","A profundidade mínima deve ser menor que a máxima.","erro");
    return;
  }

  /* 1. atualiza a variante */
  const regVar = {
    nome:           $("serv-nome").value.trim(),
    descricao:      $("serv-desc").value.trim() || null,
    tipo_obra:      $("serv-tipoobra").value,
    diametro_mm:    $("serv-diam").value !== "" ? Number($("serv-diam").value) : null,
    faixa_prof_min: pmin,
    faixa_prof_max: pmax,
    observacoes:    $("serv-obs").value.trim() || null,
    ativo:          $("serv-ativo").checked
  };
  const rv = await sb.from("servico_variantes").update(regVar).eq("id", servEditId);
  if(rv.error){
    aviso("app-aviso","Não foi possível salvar a variante: "+rv.error.message,"erro");
    return;
  }

  /* 2. grava o preço de referência (atualiza o vigente ou cria o primeiro) */
  const preco  = $("serv-preco").value  !== "" ? Number($("serv-preco").value)  : null;
  const custo  = $("serv-custo").value  !== "" ? Number($("serv-custo").value)  : null;
  const margem = $("serv-margem").value !== "" ? Number($("serv-margem").value) : null;
  const { data:{ user } } = await sb.auth.getUser();
  const uid = user ? user.id : null;
  const precoAtual = _servPrecos[servEditId];
  let rp = { error:null };
  if(precoAtual){
    rp = await sb.from("servico_precos").update({
      preco_referencia: preco,
      custo_estimado:   custo,
      margem_minima_pct: margem,
      atualizado_por:   uid
    }).eq("id", precoAtual.id);
  } else if(preco !== null){
    rp = await sb.from("servico_precos").insert({
      variante_id:      servEditId,
      preco_referencia: preco,
      custo_estimado:   custo,
      margem_minima_pct: margem,
      moeda:            "BRL",
      vigente_desde:    hojeISO(),
      atualizado_por:   uid
    });
  }
  if(rp.error){
    aviso("app-aviso","Variante salva, mas houve erro ao gravar o preço: "+rp.error.message,"erro");
  } else {
    aviso("app-aviso","Serviço atualizado com sucesso.","ok");
  }

  await carregarCatalogoServicos();
  mostrarPainelServ();
});

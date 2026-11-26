








let _servCarregado = false;
let _servCategorias = [];
let _servServicos   = [];
let _servVariantes  = [];
let _servPrecos     = {};
let _servView       = "lista";
let servEditId      = null;


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


const servCatById = (id) => _servCategorias.find(c => c.id === id);
const servById    = (id) => _servServicos.find(s => s.id === id);


function servCatRaiz(catId){
  let c = servCatById(catId), guarda = 0;
  while(c && c.parent_id && guarda < 6){ c = servCatById(c.parent_id); guarda++; }
  return c || null;
}

function servCatCaminho(catId){
  const partes = []; let c = servCatById(catId), guarda = 0;
  while(c && guarda < 6){
    partes.unshift(c.nome);
    c = c.parent_id ? servCatById(c.parent_id) : null;
    guarda++;
  }
  return partes.join(" › ");
}

function precoVariante(id){
  const p = _servPrecos[id];
  return p && p.preco_referencia != null ? Number(p.preco_referencia) : null;
}


async function carregarCatalogoServicos(){
  const cont = $("serv-conteudo");
  if(cont) cont.innerHTML = `<p class="vazio">Carregando catálogo...</p>`;
  const [cat, srv, vrt, prc] = await Promise.all([
    sb.from("categorias_servico").select("*").order("ordem_exibicao"),
    sb.from("servicos").select("*").order("ordem_exibicao", { nullsFirst: false }).order("codigo"),
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

  (prc.data || []).forEach(p => { if(!_servPrecos[p.variante_id]) _servPrecos[p.variante_id] = p; });
  _servCarregado = true;
  preencherFiltrosServ();
  renderServicos();
}


function preencherFiltrosServ(){
  const raizes = _servCategorias
    .filter(c => c.nivel === 1)
    .sort((a,b) => (a.ordem_exibicao||0) - (b.ordem_exibicao||0));
  $("serv-f-categoria").innerHTML = `<option value="">Todas as categorias</option>` +
    raizes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  $("serv-f-natureza").innerHTML = `<option value="">Todas as naturezas</option>` +
    Object.entries(SERV_NATUREZA).map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  $("serv-f-tipoobra").innerHTML = `<option value="">Todos os tipos de obra</option>` +
    Object.entries(SERV_TIPO_OBRA).map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
}


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






function servOrdenar(grupos){
  const o = s => s.ordem_exibicao == null ? Infinity : Number(s.ordem_exibicao);
  return grupos.sort((a, b) => (o(a.s) - o(b.s)) || String(a.s.codigo || "").localeCompare(String(b.s.codigo || ""), "pt-BR"));
}
function servPodeOrdenar(){
  return !!usuarioAtual && ["diretor", "comercial"].includes(usuarioAtual.cargo) && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
}
async function servMoverOrdem(servId, passo){
  if(!servPodeOrdenar()) return;
  const s = servById(servId); if(!s) return;
  const rOrd = x => { const r = servCatRaiz(x.categoria_id); return r ? Number(r.ordem_exibicao || 0) : Infinity; };
  const rId = x => servCatRaiz(x.categoria_id)?.id || "";
  const o = x => x.ordem_exibicao == null ? Infinity : Number(x.ordem_exibicao);
  const todos = _servServicos.slice().sort((a, b) => (rOrd(a) - rOrd(b)) || String(rId(a)).localeCompare(String(rId(b))) || (o(a) - o(b)) || String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR"));
  const i = todos.findIndex(x => x.id === servId), j = i + passo;
  if(i < 0 || j < 0 || j >= todos.length || rId(todos[j]) !== rId(s)) return;
  [todos[i], todos[j]] = [todos[j], todos[i]];
  const mudar = todos.map((x, k) => ({ x, nova: (k + 1) * 10 })).filter(m => Number(m.x.ordem_exibicao) !== m.nova);
  const res = await Promise.all(mudar.map(m => sb.from("servicos").update({ ordem_exibicao: m.nova }).eq("id", m.x.id).select("id")));
  const erro = res.find(r => r.error || !(r.data || []).length);
  if(erro){ aviso("app-aviso", "Não foi possível gravar a ordem" + (erro.error ? ": " + erro.error.message : " (sem permissão para gravar o catálogo).") , "erro"); await carregarCatalogoServicos(); return; }
  mudar.forEach(m => { m.x.ordem_exibicao = m.nova; });
  renderServicos();
  document.querySelector(`[data-serv="${CSS.escape(servId)}"][data-serv-ordem="${passo}"]`)?.focus();
}


function renderServicos(){
  if(!_servCarregado) return;
  const dados = variantesFiltradas();
  $("serv-contador").textContent = `${dados.length} de ${_servVariantes.length}`;
  if(_servView === "kanban")        renderServKanban(dados);
  else if(_servView === "catalogo") renderServCatalogo(dados);
  else                              renderServLista(dados);
}



function servUnidadeVarHtml(v, s){
  if(v.unidade) return esc(v.unidade);
  const su = s && s.unidade;
  return su ? `${esc(su)} <span class="u-txt-fraco">(do serviço)</span>` : "—";
}


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
      <td>${  servUnidadeVarHtml(v, s)}</td>
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


function agruparPorServico(dados){
  const grupos = {};
  dados.forEach(d => {
    if(!grupos[d.v.servico_id]) grupos[d.v.servico_id] = { s:d.s, raiz:d.raiz, vars:[] };
    grupos[d.v.servico_id].vars.push(d.v);
  });
  return grupos;
}


function faixaPreco(vars){
  const precos = vars.map(v => precoVariante(v.id)).filter(x => x != null);
  if(!precos.length) return "sem preço";
  const min = Math.min(...precos), max = Math.max(...precos);
  return min === max ? brl(min) : `${brl(min)} – ${brl(max)}`;
}


function renderServKanban(dados){
  const cont = $("serv-conteudo");
  const grupos = agruparPorServico(dados);
  const raizes = _servCategorias
    .filter(c => c.nivel === 1)
    .sort((a,b) => (a.ordem_exibicao||0) - (b.ordem_exibicao||0));
  const colunas = raizes.map(r => {
    const servs = servOrdenar(Object.values(grupos).filter(g => g.raiz && g.raiz.id === r.id));
    if(!servs.length) return "";
    const cards = servs.map(g => `
      <div class="serv-kan-card">
        <div class="serv-kan-card-nome">${esc(g.s.nome)}</div>
        <div class="serv-kan-card-meta">
          <span class="tag ${esc(SERV_NAT_COR[g.s.natureza]||'cinza')}">${esc(SERV_NATUREZA[g.s.natureza]||g.s.natureza)}</span>
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


function renderServCatalogo(dados){
  const cont = $("serv-conteudo");
  const grupos = agruparPorServico(dados);
  const raizes = _servCategorias
    .filter(c => c.nivel === 1)
    .sort((a,b) => (a.ordem_exibicao||0) - (b.ordem_exibicao||0));
  let html = "";
  raizes.forEach(r => {
    const servs = servOrdenar(Object.values(grupos).filter(g => g.raiz && g.raiz.id === r.id));
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
          <td>${  servUnidadeVarHtml(v, g.s)}</td>
          <td class="num">${preco!=null ? brl(preco) : '<span class="tag cinza">—</span>'}</td>
        </tr>`;
      }).join("");
      html += `<div class="serv-serv-card">
        <div class="serv-serv-head">
          <div>
            ${servPodeOrdenar() ? `<span class="serv-ordem"><button type="button" class="btn-ordem" data-serv-ordem="-1" data-serv="${esc(g.s.id)}" title="Subir este serviço na ordem padrão (vale para o seletor do orçamento)" aria-label="Subir serviço">▲</button><button type="button" class="btn-ordem" data-serv-ordem="1" data-serv="${esc(g.s.id)}" title="Descer este serviço na ordem padrão (vale para o seletor do orçamento)" aria-label="Descer serviço">▼</button></span>` : ""}
            <strong>${esc(g.s.nome)}</strong>
            <span class="serv-caminho" title="Unidade do serviço: vale para as variantes sem unidade própria">${esc(servCatCaminho(g.s.categoria_id))} · ${esc(g.s.unidade||"")}</span>
          </div>
          <span class="tag ${esc(SERV_NAT_COR[g.s.natureza]||'cinza')}">${esc(SERV_NATUREZA[g.s.natureza]||g.s.natureza)}</span>
        </div>
        <div class="tabela-rola"><table>
          <thead><tr><th>Código</th><th>Variante</th><th>Tipo de obra</th><th>Un.</th><th class="num">Preço ref.</th></tr></thead>
          <tbody>${linhas}</tbody></table></div>
      </div>`;
    });
    html += `</div>`;
  });
  cont.innerHTML = html || `<p class="vazio">Nenhum serviço encontrado para os filtros.</p>`;
}


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
    .map(([val,l]) => `<option value="${esc(val)}">${esc(l)}</option>`).join("");

  $("serv-ficha-contexto").innerHTML = s ? `
    <div><span>Serviço</span><strong>${esc(s.nome)}</strong></div>
    <div><span>Categoria</span><strong>${esc(servCatCaminho(s.categoria_id))}</strong></div>
    <div><span>Natureza</span><strong>${esc(SERV_NATUREZA[s.natureza]||s.natureza)}</strong></div>
    <div><span>Unidade</span><strong>${  servUnidadeVarHtml(v, s)}</strong></div>` : "";


  const listaUn = (typeof UNIDADES !== "undefined" ? UNIDADES : []).slice();
  if(v.unidade && !listaUn.includes(v.unidade)) listaUn.push(v.unidade);
  $("serv-unidade").innerHTML = `<option value="">— a do serviço (${esc((s && s.unidade) || "sem unidade")}) —</option>`
    + listaUn.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
  $("serv-unidade").value = v.unidade || "";

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

  $("serv-obs-proposta").value = (s && s.observacoes_padrao) || "";
  $("serv-nota-interna").value = (s && s.nota_interna) || "";
  ["serv-obs-proposta", "serv-nota-interna"].forEach(idc => { $(idc).disabled = !s || !servPodeOrdenar(); });
  servPreencherEstrutura(s);
  $("serv-ativo").checked  = v.ativo !== false;
  $("serv-ficha-titulo").textContent = v.nome || "Editar serviço";

  $("serv-painel").style.display = "none";
  $("serv-ficha").style.display = "block";
  $("serv-nome").focus();
}


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
  const seta = e.target.closest("[data-serv-ordem]");
  if(seta){ servMoverOrdem(seta.dataset.serv, Number(seta.dataset.servOrdem)); return; }
  const tr = e.target.closest("tr.linha-clicavel");
  if(tr) abrirFichaServ(tr.dataset.id);
});

$("btn-voltar-serv").addEventListener("click", mostrarPainelServ);


const navServicos = document.querySelector('nav button[data-secao="servicos"]');
if(navServicos) navServicos.addEventListener("click", () => {
  mostrarPainelServ();
  if(!_servCarregado) carregarCatalogoServicos();
});


$("form-servico").addEventListener("submit", async (e) => {
  e.preventDefault();
  if(!servEditId) return;


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


  const regVar = {
    nome:           $("serv-nome").value.trim(),
    descricao:      $("serv-desc").value.trim() || null,
    tipo_obra:      $("serv-tipoobra").value,
    unidade:        $("serv-unidade").value || null,
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


  const varAtual = _servVariantes.find(x => x.id === servEditId);
  const servAtual = varAtual ? servById(varAtual.servico_id) : null;
  if(servAtual && servPodeOrdenar()){
    const obsProp = $("serv-obs-proposta").value.trim() || null;
    const nota    = $("serv-nota-interna").value.trim() || null;
    if(obsProp !== (servAtual.observacoes_padrao || null) || nota !== (servAtual.nota_interna || null)){
      const rs = await sb.from("servicos").update({ observacoes_padrao: obsProp, nota_interna: nota }).eq("id", servAtual.id).select("id");
      if(rs.error || !(rs.data || []).length){
        aviso("app-aviso","Variante salva, mas os textos do serviço não foram gravados: "+(rs.error ? rs.error.message : "sem permissão"),"erro");
        return;
      }
    }
  }


  if(servAtual && servPodeEstrutura()){
    const est = servEstruturaValores();
    if(!est.nome){ aviso("app-aviso", "Variante salva; informe o nome do serviço para gravar a estrutura.", "erro"); return; }
    if(est.nome !== (servAtual.nome || "") || est.categoria_id !== (servAtual.categoria_id || null) || est.natureza !== servAtual.natureza || est.unidade !== servAtual.unidade){
      const re = await sb.from("servicos").update(est).eq("id", servAtual.id).select("id");
      if(re.error || !(re.data || []).length){
        aviso("app-aviso", "Variante salva, mas a estrutura do serviço não foi gravada: " + (re.error ? re.error.message : "sem permissão"), "erro");
        return;
      }
    }
  }


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








function servPodeEstrutura(){
  if(!servPodeOrdenar()) return false;
  return usuarioAtual.cargo === "diretor" || (typeof temModuloExtra === "function" && temModuloExtra("catalogo_estrutura"));
}
function servPreencherEstrutura(s){
  const box = $("serv-estrutura"); if(!box) return;
  const cats = _servCategorias.filter(c => c.ativo !== false || (s && c.id === s.categoria_id))
    .map(c => ({ id: c.id, txt: servCatCaminho(c.id) })).sort((a, b) => a.txt.localeCompare(b.txt, "pt-BR"));
  $("serv-s-categoria").innerHTML = cats.map(c => `<option value="${esc(c.id)}">${esc(c.txt)}</option>`).join("");
  $("serv-s-natureza").innerHTML = Object.entries(SERV_NATUREZA).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  $("serv-s-unidade").innerHTML = (typeof UNIDADES !== "undefined" ? UNIDADES : []).map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join("");
  $("serv-s-nome").value = s?.nome || "";
  $("serv-s-categoria").value = s?.categoria_id || "";
  $("serv-s-natureza").value = s?.natureza || "";
  $("serv-s-unidade").value = s?.unidade || "";
  const pode = !!s && servPodeEstrutura();
  ["serv-s-nome", "serv-s-categoria", "serv-s-natureza", "serv-s-unidade"].forEach(id => { $(id).disabled = !pode; });
  box.title = pode ? "Nome, categoria e natureza do serviço valem para todas as variantes; a unidade do serviço vale para as variantes sem unidade própria"
    : "Só o diretor ou quem tem o acesso extra Estrutura do catálogo (liberado pela diretoria em Configurações › Usuários e acessos) muda estes campos";
}
function servEstruturaValores(){
  return { nome: $("serv-s-nome").value.trim(), categoria_id: $("serv-s-categoria").value || null,
    natureza: $("serv-s-natureza").value, unidade: $("serv-s-unidade").value };
}

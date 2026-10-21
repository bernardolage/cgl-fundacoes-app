/* ====================================================================
   Módulo: Fornecedores
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   ==================================================================== */

let _fornecedores = [];
let _fornView     = "lista";
let fornEditId    = null;

/* ---------- Carga ---------- */
async function carregarListaFornecedores(){
  const { data, error } = await sb.from("fornecedores")
    .select("id,razao_social,nome_fantasia,cpf_cnpj,tipo_pessoa,categoria,cidade,uf,telefone,email,ativo")
    .order("razao_social");
  _fornecedores = error ? [] : (data || []);
  renderFornecedores();
}

/* ---------- Filtros ---------- */
function fornFiltrados(){
  const termo = ($("forn-busca")?.value || "").trim().toLowerCase();
  const fAtivo = $("forn-f-ativo")?.value || "";
  const fCat = ($("forn-f-categoria")?.value || "").trim().toLowerCase();
  return _fornecedores.filter(f => {
    if(fAtivo === "ativos" && f.ativo === false) return false;
    if(fAtivo === "inativos" && f.ativo !== false) return false;
    if(fCat && (f.categoria||"").toLowerCase() !== fCat) return false;
    if(termo){
      const alvo = `${f.razao_social||""} ${f.nome_fantasia||""} ${f.cpf_cnpj||""} ${f.cidade||""} ${f.categoria||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function preencherFiltrosForn(){
  const sel = $("forn-f-categoria");
  if(sel){
    const atual = sel.value; // preserva a seleção (o render roda a cada tecla)
    const cats = [...new Set(_fornecedores.map(f => f.categoria).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">Todas as categorias</option>` +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    sel.value = atual;
  }
}

/* ---------- Render ---------- */
function renderFornecedores(){
  preencherFiltrosForn();
  const dados = fornFiltrados();
  const cont = $("forn-contador");
  if(cont) cont.textContent = `${dados.length} de ${_fornecedores.length}`;
  if(_fornView === "kanban") renderFornKanban(dados);
  else                       renderFornLista(dados);
  const legacy = $("tab-fornecedores");
  if(legacy) legacy.innerHTML = "";
}

function renderFornLista(dados){
  const cont = $("forn-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum fornecedor encontrado.</p>`;
    return;
  }
  const linhas = dados.map(f => `<tr class="linha-clicavel" data-id="${esc(f.id)}">
    <td>${esc(f.razao_social)} ${tagSituacao(f.ativo)}</td>
    <td>${esc(f.cpf_cnpj||"—")}</td>
    <td>${esc([f.cidade,(f.uf||"").toUpperCase()].filter(Boolean).join("/")||"—")}</td>
    <td>${esc(f.categoria||"—")}</td>
    <td>${esc(f.telefone||"—")}</td>
    <td>${esc(f.email||"—")}</td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Razão social</th><th>CPF / CNPJ</th><th>Cidade/UF</th><th>Categoria</th><th>Telefone</th><th>E-mail</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderFornKanban(dados){
  const cont = $("forn-conteudo");
  if(!cont) return;
  // Agrupa por categoria
  const grupos = {};
  dados.forEach(f => {
    const k = f.categoria || "Sem categoria";
    if(!grupos[k]) grupos[k] = [];
    grupos[k].push(f);
  });
  const nomes = Object.keys(grupos).sort();
  const colunas = nomes.map(nome => {
    const itens = grupos[nome];
    const cards = itens.map(f => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(f.id)}">
        <div class="serv-kan-card-nome">${esc(f.razao_social)}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${esc(f.cpf_cnpj || "—")}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${esc(f.cidade || "—")}</span>
          ${tagSituacao(f.ativo)}
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col">
      <div class="serv-kan-col-head">${esc(nome)}<span>${itens.length}</span></div>
      ${cards}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelForn(){
  $("forn-painel").style.display = "";
  $("forn-ficha").style.display = "none";
  fornEditId = null;
}

function novoFornecedor(){
  fornEditId = null;
  ["forn-razao","forn-fantasia","forn-doc","forn-ie","forn-email","forn-tel","forn-contato",
   "forn-categoria","forn-cep","forn-logradouro","forn-numero","forn-complemento",
   "forn-bairro","forn-cidade","forn-uf","forn-obs"].forEach(k => { const el = $(k); if(el) el.value = ""; });
  $("forn-tipo").value = "juridica";
  $("forn-ativo").checked = true;
  $("btn-excluir-forn").style.display = "none";
  abrirFichaFornVisual({ razao_social: "(novo)", tipo_pessoa: "juridica", ativo: true });
  if(typeof ocultarHistorico === "function") ocultarHistorico("forn-historico");
}

async function abrirFornecedor(id){
  fornEditId = id;
  const { data, error } = await sb.from("fornecedores").select("*").eq("id",id).single();
  if(error){ aviso("app-aviso","Erro ao abrir fornecedor: "+error.message,"erro"); return; }
  $("forn-tipo").value        = data.tipo_pessoa || "juridica";
  $("forn-razao").value       = data.razao_social || "";
  $("forn-fantasia").value    = data.nome_fantasia || "";
  $("forn-doc").value         = data.cpf_cnpj || "";
  $("forn-ie").value          = data.inscricao_estadual || "";
  $("forn-email").value       = data.email || "";
  $("forn-tel").value         = data.telefone || "";
  $("forn-contato").value     = data.contato_nome || "";
  $("forn-categoria").value   = data.categoria || "";
  $("forn-cep").value         = data.cep || "";
  $("forn-logradouro").value  = data.logradouro || "";
  $("forn-numero").value      = data.numero || "";
  $("forn-complemento").value = data.complemento || "";
  $("forn-bairro").value      = data.bairro || "";
  $("forn-cidade").value      = data.cidade || "";
  $("forn-uf").value          = data.uf || "";
  $("forn-obs").value         = data.observacoes || "";
  $("forn-ativo").checked     = data.ativo !== false;
  $("btn-excluir-forn").style.display = "";
  abrirFichaFornVisual(data);
  if(typeof montarHistorico === "function") montarHistorico("fornecedores", id, "forn-historico");
}

function abrirFichaFornVisual(f){
  $("forn-painel").style.display = "none";
  $("forn-ficha").style.display = "";

  $("forn-ficha-nome").textContent = f.razao_social || "(novo)";
  $("forn-ficha-doc-chip").textContent = f.cpf_cnpj || "—";
  $("forn-ficha-categoria-chip").textContent = f.categoria || "—";
  $("forn-ficha-cidade-chip").textContent = f.cidade
    ? `${f.cidade}${f.uf ? "/" + f.uf.toUpperCase() : ""}`
    : "—";
  $("forn-ficha-tel-chip").textContent = f.telefone || "—";
  $("forn-ficha-ativo-chip").innerHTML = (f.ativo === false)
    ? '<span class="tag cinza">Inativo</span>'
    : '<span class="tag verde">Ativo</span>';
  $("forn-ficha-titulo").textContent = fornEditId ? f.razao_social : "Novo fornecedor";

  ativarTabForn("geral");
  carregarContratosDoFornecedor(fornEditId);
  _fornPag = { pedidos: 0, notas: 0, titulos: 0 };   // lote S46 (#106)
  carregarPedidosDoFornecedor(fornEditId);
  carregarNotasDoFornecedor(fornEditId);
}

/* ====================================================================
   ABA CONTRATOS — contratos deste fornecedor (fase 21)
   ==================================================================== */
async function carregarContratosDoFornecedor(fornecedorId){
  const cont = $("forn-contratos-conteudo");
  if(!cont) return;
  const setSB = (n) => {
    const el = $("sb-forn-contratos");
    if(!el) return;
    el.querySelector(".sb-num").textContent = n || 0;
    el.classList.toggle("zero", !n);
  };

  if(!fornecedorId){
    cont.innerHTML = `<p class="vazio">Salve o fornecedor primeiro.</p>`;
    setSB(0);
    return;
  }

  const { data, error } = await sb.from("contratos")
    .select("id,numero,categoria,status,valor_total,data_inicio,data_fim_prevista,aviso_vencimento_dias")
    .eq("natureza","fornecedor")
    .eq("fornecedor_id", fornecedorId)
    .order("data_inicio", { ascending:false, nullsFirst:false });
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; setSB(0); return; }
  setSB((data||[]).length);

  if(!data || !data.length){
    cont.innerHTML = `<p class="vazio">Nenhum contrato com este fornecedor.</p>`;
    return;
  }

  const temTagDias = typeof tagDias === "function";
  const linhas = data.map(c => `<tr class="linha-clicavel" data-id="${esc(c.id)}">
    <td><strong>${esc(c.numero)}</strong></td>
    <td>${esc(CONTRATO_CATEGORIA[c.categoria] || c.categoria || "—")}</td>
    <td>${dataBR(c.data_inicio)}</td>
    <td>${dataBR(c.data_fim_prevista)}${temTagDias ? tagDias(c) : ""}</td>
    <td>${tagStatus("contrato", c.status)}</td>
    <td class="num">${brl(c.valor_total)}</td>
  </tr>`).join("");
  const total = data.reduce((s,c) => s + (Number(c.valor_total)||0), 0);

  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Número</th><th>Categoria</th><th>Início</th><th>Fim da vigência</th><th>Status</th><th class="num">Valor</th></tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot><tr><td colspan="5"><strong>Total</strong></td><td class="num"><strong>${brl(total)}</strong></td></tr></tfoot>
  </table></div>`;

  cont.querySelectorAll(".linha-clicavel").forEach(tr => {
    tr.addEventListener("click", () => {
      const nav = document.querySelector('nav button[data-secao="contratos"]');
      if(nav) nav.click();
      setTimeout(() => {
        if(typeof abrirContrato === "function") abrirContrato(tr.dataset.id);
      }, 120);
    });
  });
}

/* ====================================================================
   ABAS PEDIDOS DE COMPRA e NOTAS E TÍTULOS (lote S46, #106) — no molde da aba Contratos.
   Leitura pela RLS (pedidos e notas: pode_ler_compras(); títulos: pode_ler_contas_pagar()); valores só para
   podeVerContasPagar(). Paginação de 100 em 100; a linha abre a ficha do pedido em Compras.
   ==================================================================== */
const FORN_PAG = 100;
let _fornPag = { pedidos: 0, notas: 0, titulos: 0 };
function fornSmartButton(id, n){
  const el = $(id); if(!el) return;
  el.querySelector(".sb-num").textContent = n || 0;
  el.classList.toggle("zero", !n);
}
function fornPaginacao(chave, total){
  if(total <= FORN_PAG) return "";
  const p = _fornPag[chave], de = p * FORN_PAG + 1, ate = Math.min(total, (p + 1) * FORN_PAG);
  return `<div class="meta" style="display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:8px;">
    <button type="button" class="btn-sec btn-sm" data-forn-pag="${chave}" data-dir="-1" ${p === 0 ? "disabled" : ""}>‹ anteriores</button>
    <span>${de}–${ate} de ${total}</span>
    <button type="button" class="btn-sec btn-sm" data-forn-pag="${chave}" data-dir="1" ${ate >= total ? "disabled" : ""}>próximos ›</button></div>`;
}
function fornLigarPaginacao(cont, recarregar){
  cont.querySelectorAll("[data-forn-pag]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.fornPag; _fornPag[k] = Math.max(0, _fornPag[k] + Number(b.dataset.dir)); recarregar();
  }));
}
function fornAbrirPedido(id){
  if(id && irParaSecao("compras") && typeof abrirPedido === "function") setTimeout(() => abrirPedido(id), 300);
}
function fornLigarLinksPedido(cont){
  cont.querySelectorAll("[data-pedido-id]").forEach(el => el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fornAbrirPedido(el.dataset.pedidoId); }));
}
const fornPedidoLink = (id, numero) => id ? `<a href="#" data-pedido-id="${esc(id)}">${esc(numero || "pedido")}</a>` : "—";

async function carregarPedidosDoFornecedor(fornecedorId){
  const cont = $("forn-pedidos-conteudo");
  if(!cont) return;
  if(!fornecedorId){ cont.innerHTML = `<p class="vazio">Salve o fornecedor primeiro.</p>`; fornSmartButton("sb-forn-pedidos", 0); return; }
  const verValor = typeof podeVerContasPagar === "function" && podeVerContasPagar();
  const ini = _fornPag.pedidos * FORN_PAG;
  const { data, error, count } = await sb.from("pedidos_compra")
    .select("id,numero,status,data_pedido,previsao_entrega,total,obra:obras(codigo)", { count: "exact" })
    .eq("fornecedor_id", fornecedorId)
    .order("data_pedido", { ascending: false, nullsFirst: false }).order("numero", { ascending: false })
    .range(ini, ini + FORN_PAG - 1);
  if(fornEditId !== fornecedorId) return;   // trocou de fornecedor enquanto carregava
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; fornSmartButton("sb-forn-pedidos", 0); return; }
  fornSmartButton("sb-forn-pedidos", count || 0);
  if(!data || !data.length){ cont.innerHTML = `<p class="vazio">Nenhum pedido de compra deste fornecedor.</p>`; return; }
  const tag = (st) => typeof cmpTag === "function" ? cmpTag(st) : esc(st || "—");
  const linhas = data.map(p => `<tr class="linha-clicavel" data-id="${esc(p.id)}">
    <td><strong>${esc(p.numero)}</strong></td>
    <td>${dataBR(p.data_pedido)}</td>
    <td>${tag(p.status)}</td>
    <td>${esc(p.obra?.codigo || "—")}</td>
    <td>${dataBR(p.previsao_entrega)}</td>
    ${verValor ? `<td class="num">${brl(p.total)}</td>` : ""}
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Número</th><th>Data</th><th>Status</th><th>Obra</th><th>Previsão de entrega</th>${verValor ? '<th class="num">Total</th>' : ""}</tr></thead>
    <tbody>${linhas}</tbody></table></div>${fornPaginacao("pedidos", count || 0)}`;
  cont.querySelectorAll("tr.linha-clicavel").forEach(tr => tr.addEventListener("click", () => fornAbrirPedido(tr.dataset.id)));
  fornLigarPaginacao(cont, () => carregarPedidosDoFornecedor(fornecedorId));
}

async function carregarNotasDoFornecedor(fornecedorId){
  const cont = $("forn-notas-conteudo");
  if(!cont) return;
  const verValor = typeof podeVerContasPagar === "function" && podeVerContasPagar();
  const sbTit = $("sb-forn-titulos"); if(sbTit) sbTit.style.display = verValor ? "" : "none";
  if(!fornecedorId){ cont.innerHTML = `<p class="vazio">Salve o fornecedor primeiro.</p>`; fornSmartButton("sb-forn-notas", 0); fornSmartButton("sb-forn-titulos", 0); return; }
  const iniN = _fornPag.notas * FORN_PAG, iniT = _fornPag.titulos * FORN_PAG;
  const [rn, rt] = await Promise.all([
    sb.from("recebimentos")
      .select("id,pedido_id,nf_numero,nf_serie,nf_data_emissao,data_recebimento,total_nf,status,pedido:pedidos_compra(numero),contrato:contratos(numero)", { count: "exact" })
      .eq("fornecedor_id", fornecedorId)
      .order("nf_data_emissao", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false })
      .range(iniN, iniN + FORN_PAG - 1),
    verValor
      ? sb.from("titulos_pagar")
          .select("id,nf_numero,parcela,total_parcelas,valor,vencimento,exportado_em,origem,recebimento:recebimentos(pedido_id,pedido:pedidos_compra(numero)),contrato:contratos(numero)", { count: "exact" })
          .eq("fornecedor_id", fornecedorId)
          .order("vencimento", { ascending: false, nullsFirst: false })
          .range(iniT, iniT + FORN_PAG - 1)
      : Promise.resolve({ data: [], count: 0, error: null })
  ]);
  if(fornEditId !== fornecedorId) return;
  fornSmartButton("sb-forn-notas", rn.error ? 0 : (rn.count || 0));
  fornSmartButton("sb-forn-titulos", rt.error ? 0 : (rt.count || 0));
  const docPedido = (x) => x.pedido_id ? fornPedidoLink(x.pedido_id, x.pedido?.numero) : (x.contrato?.numero ? `contrato ${esc(x.contrato.numero)}` : "—");
  const STATUS_REC = { rascunho: "Rascunho", confirmado: "Confirmada", cancelado: "Cancelada" };
  let html = `<h4 class="titulo-bloco" style="margin-top:0;">Notas fiscais recebidas (${rn.count || 0})</h4>`;
  if(rn.error) html += `<p class="vazio">Erro: ${esc(rn.error.message)}</p>`;
  else if(!(rn.data || []).length) html += `<p class="vazio">Nenhuma nota fiscal recebida deste fornecedor.</p>`;
  else html += `<div class="tabela-rola"><table>
    <thead><tr><th>NF</th><th>Emissão</th><th>Recebida em</th><th>Pedido / contrato</th><th>Status</th>${verValor ? '<th class="num">Valor da NF</th>' : ""}</tr></thead>
    <tbody>${rn.data.map(r => `<tr>
      <td><strong>${esc(r.nf_numero || "—")}</strong>${r.nf_serie ? ` <span class="meta">série ${esc(r.nf_serie)}</span>` : ""}</td>
      <td>${dataBR(r.nf_data_emissao)}</td><td>${dataBR(r.data_recebimento)}</td>
      <td>${docPedido(r)}</td><td>${esc(STATUS_REC[r.status] || r.status || "—")}</td>
      ${verValor ? `<td class="num">${brl(r.total_nf)}</td>` : ""}</tr>`).join("")}</tbody></table></div>${fornPaginacao("notas", rn.count || 0)}`;
  if(verValor){
    const docTit = (t) => t.recebimento?.pedido_id ? fornPedidoLink(t.recebimento.pedido_id, t.recebimento.pedido?.numero) : (t.contrato?.numero ? `contrato ${esc(t.contrato.numero)}` : esc(t.origem || "—"));
    html += `<h4 class="titulo-bloco">Títulos a pagar (${rt.count || 0})</h4>`;
    if(rt.error) html += `<p class="vazio">Erro: ${esc(rt.error.message)}</p>`;
    else if(!(rt.data || []).length) html += `<p class="vazio">Nenhum título deste fornecedor.</p>`;
    else html += `<div class="tabela-rola"><table>
      <thead><tr><th>NF</th><th>Parcela</th><th>Vencimento</th><th>Origem</th><th>Exportado</th><th class="num">Valor</th></tr></thead>
      <tbody>${rt.data.map(t => `<tr>
        <td>${esc(t.nf_numero || "—")}</td><td>${t.parcela ? `${t.parcela}/${t.total_parcelas || "?"}` : "—"}</td>
        <td>${dataBR(t.vencimento)}</td><td>${docTit(t)}</td>
        <td>${t.exportado_em ? dataBR(String(t.exportado_em).slice(0, 10)) : '<span class="tag ambar">a exportar</span>'}</td>
        <td class="num">${brl(t.valor)}</td></tr>`).join("")}</tbody></table></div>${fornPaginacao("titulos", rt.count || 0)}`;
  }
  cont.innerHTML = html;
  fornLigarLinksPedido(cont);
  fornLigarPaginacao(cont, () => carregarNotasDoFornecedor(fornecedorId));
}

function ativarTabForn(nome){
  document.querySelectorAll("#forn-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#forn-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Salvar / excluir ---------- */
async function salvarFornecedor(){
  if(!$("forn-razao").value.trim()){ aviso("app-aviso","Informe a razão social.","erro"); ativarTabForn("geral"); return; }
  const reg = {
    tipo_pessoa:        $("forn-tipo").value,
    razao_social:       $("forn-razao").value.trim(),
    nome_fantasia:      $("forn-fantasia").value.trim() || null,
    cpf_cnpj:           $("forn-doc").value.trim() || null,
    inscricao_estadual: $("forn-ie").value.trim() || null,
    email:              $("forn-email").value.trim() || null,
    telefone:           $("forn-tel").value.trim() || null,
    contato_nome:       $("forn-contato").value.trim() || null,
    categoria:          $("forn-categoria").value.trim() || null,
    cep:                $("forn-cep").value.trim() || null,
    logradouro:         $("forn-logradouro").value.trim() || null,
    numero:             $("forn-numero").value.trim() || null,
    complemento:        $("forn-complemento").value.trim() || null,
    bairro:             $("forn-bairro").value.trim() || null,
    cidade:             $("forn-cidade").value.trim() || null,
    uf:                 $("forn-uf").value || null,
    observacoes:        $("forn-obs").value.trim() || null,
    ativo:              $("forn-ativo").checked
  };
  let result;
  if(fornEditId){
    result = await sb.from("fornecedores").update(reg).eq("id", fornEditId).select().single();
  } else {
    result = await sb.from("fornecedores").insert(reg).select().single();
  }
  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    if(m.includes("duplicate") || m.includes("unique"))
      aviso("app-aviso","Já existe um fornecedor com esse CPF/CNPJ.","erro");
    else
      aviso("app-aviso","Não foi possível salvar: "+result.error.message,"erro");
    return;
  }
  fornEditId = result.data.id;
  $("btn-excluir-forn").style.display = "";
  aviso("app-aviso","Fornecedor salvo.","ok");
  await carregarListaFornecedores();
  if(typeof carregarFornecedores === "function") carregarFornecedores();
  if(typeof carregarFornecedoresSelects === "function") carregarFornecedoresSelects();
  await abrirFornecedor(fornEditId);
}

async function excluirFornecedor(){
  if(!fornEditId) return;
  if(!confirm("Excluir este fornecedor?")) return;
  const { error } = await sb.from("fornecedores").delete().eq("id", fornEditId);
  if(error){ aviso("app-aviso","Não foi possível excluir: "+error.message,"erro"); return; }
  aviso("app-aviso","Fornecedor excluído.","ok");
  await carregarListaFornecedores();
  if(typeof carregarFornecedores === "function") carregarFornecedores();
  if(typeof carregarFornecedoresSelects === "function") carregarFornecedoresSelects();
  mostrarPainelForn();
}

/* ---------- Listeners ---------- */
function ligarFornecedores(){
  document.querySelectorAll("#forn-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#forn-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _fornView = b.dataset.view;
      renderFornecedores();
    });
  });
  ["forn-busca","forn-f-ativo","forn-f-categoria"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "forn-busca" ? "input" : "change", id === "forn-busca" ? debounce(renderFornecedores) : renderFornecedores);
  });
  $("forn-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirFornecedor(tr.dataset.id);
  });

  $("btn-novo-fornecedor")?.addEventListener("click", novoFornecedor);
  $("btn-voltar-forn")?.addEventListener("click", mostrarPainelForn);
  $("btn-salvar-forn")?.addEventListener("click", () => comBotaoTravado("btn-salvar-forn", salvarFornecedor));
  $("btn-excluir-forn")?.addEventListener("click", excluirFornecedor);

  document.querySelectorAll("#forn-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabForn(b.dataset.tab));
  });
  $("sb-forn-contratos")?.addEventListener("click", () => ativarTabForn("contratos"));
  $("sb-forn-pedidos")?.addEventListener("click", () => ativarTabForn("pedidos"));     // lote S46 (#106)
  $("sb-forn-notas")?.addEventListener("click", () => ativarTabForn("notas"));
  $("sb-forn-titulos")?.addEventListener("click", () => ativarTabForn("notas"));

  const navForn = document.querySelector('nav button[data-secao="fornecedores"]');
  if(navForn) navForn.addEventListener("click", mostrarPainelForn);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarFornecedores);
} else {
  ligarFornecedores();
}

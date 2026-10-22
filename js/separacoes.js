/* ====================================================================
   Módulo: Separações (fase 83, 16/10/2026)
   Pedido do Julio (almoxarifado): a mobilização pré-configura tudo que vai levar (kit de acessórios +
   materiais), a separação é atribuída a uma pessoa e, quando ela marca "separado", o sistema dá a baixa
   sozinho (RPC separacao_marcar: produto → saída de estoque; acessório → vai para a obra/TAG). O que a
   obra pede depois (hoje pelo grupo do WhatsApp) segue o mesmo caminho: pedido → separação → baixa.
   "Entregar" registra quem levou. A saída direta do balcão (fase 78) continua para a urgência sem lista.
   Painel no padrão Serviços (lista / por status), ficha no padrão Odoo. Prefixo sep-.
   ==================================================================== */

let _sepView = "lista";
let _sepLista = [];
let _sepAtual = null;            // separação aberta na ficha
let _sepItens = [];
let _sepObras = [], _sepEquips = [], _sepPerfis = [], _sepFuncs = [];
let _sepCarregado = false;
let _sepPreset = "";             // filtro vindo da Sala de Comando: "vencidas" | "sem_resp"
let _sepRetirante = null;        // funcionário escolhido na entrega
let _sepPed = null;              // modal "pedido da obra": { itens: [{ produto, descricao, unidade, quantidade }] }
let _sepPlantao = null;          // empresa_config.almoxarife_padrao_id
let _sepCentros = [];            // lote S48 (#107): centros de custo (setor / obra interna) para o destino do item

const SEP_STATUS = { aberta: ["Aberta", "azul"], em_separacao: ["Em separação", "ambar"], separada: ["Separada", "verde"], entregue: ["Entregue", "cinza"], cancelada: ["Cancelada", "cinza"] };
const SEP_STAGES = ["aberta", "em_separacao", "separada", "entregue"];
const SEP_ORIGEM = { mobilizacao: "Mobilização", pedido_obra: "Pedido da obra" };
// lote S48 (#107): "*" traz valor_total quando a migration 20261022_loteS48_b estiver aplicada (sem ela, a tela segue sem valor)
const SEP_SELECT = "*,"
  + "solicitante:profiles!separacoes_solicitante_id_fkey(nome),responsavel:profiles!separacoes_responsavel_id_fkey(nome),retirante:funcionarios(nome),itens:separacao_itens(id,separado)";
const SEP_ITEM_SELECT = "*,produto:produtos(codigo,nome,unidade,estoque_atual,controle_reposicao),acessorio:acessorios(marcacao,tipo,local_tipo,local_obra_id)";
const SEP_PROD_COLS = "id,codigo,nome,unidade,estoque_atual,controle_reposicao,codigo_barras";

/* quem separa e entrega = quem opera compras/estoque + auxiliar de almoxarifado (almoxarifado_pode_operar() no banco, fase 90) */
function sepPodeOperar(){ return !!usuarioAtual && ["admin", "diretor", "comprador", "almoxarife", "gestor_acessorios", "engenheiro", "logistica", "financeiro", "mecanico", "gestor_frota", "auxiliar_almoxarifado"].includes(usuarioAtual.cargo); }
/* quem pede material para a obra (separacoes_pode_pedir() no banco); lote S48 (#124): + gestor_manutencao */
function sepPodePedir(){ return !!usuarioAtual && ["admin", "diretor", "comprador", "almoxarife", "encarregado", "engenheiro", "assistente_engenharia", "mecanico", "operador", "logistica", "gestor_acessorios", "financeiro", "gestor_frota", "gestor_manutencao"].includes(usuarioAtual.cargo); }
function sepTag(st){ const o = SEP_STATUS[st] || [st, "cinza"]; return `<span class="tag ${o[1]}">${esc(o[0])}</span>`; }
function sepObra(id){ const o = _sepObras.find(x => x.id === id); return o ? o.codigo : ((typeof mapaObras === "object" && mapaObras && mapaObras[id]) || ""); }
function sepObraNome(id){ const o = _sepObras.find(x => x.id === id); return o ? o.nome : ""; }
function sepEq(id){ const e = _sepEquips.find(x => x.id === id); return e ? e.codigo : ""; }
function sepPerfil(id){ const p = _sepPerfis.find(x => x.id === id); return p ? p.nome : ""; }
function sepProgresso(s){ const its = s.itens || []; return { n: its.length, ok: its.filter(i => i.separado).length }; }
function sepAberta(s){ return ["aberta", "em_separacao", "separada"].includes(s.status); }
function sepVencida(s){ return !!s.prazo && s.prazo < hojeISO() && sepAberta(s); }
function sepMinha(s){ return !!usuarioAtual && (s.responsavel_id === usuarioAtual.id || s.solicitante_id === usuarioAtual.id); }
/* o solicitante mexe na própria separação enquanto está aberta (policy separacoes_update) */
function sepPodeEditar(s){ return !!s && (sepPodeOperar() || (!!usuarioAtual && s.solicitante_id === usuarioAtual.id && s.status === "aberta")); }
function sepSemAcento(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }

/* ---------- lote S48 (#107): valor total e destino por item ----------
   separacao_itens.obra_id / equipamento_id / centro_custo_id (um deles; os três nulos = herda obra e TAG da separação) e
   custo_unitario (custo do produto ao entrar na lista; o da saída ao marcar); separacoes.valor_total por gatilho. A saída
   de estoque grava o destino do item e vw_custos mostra cada parte no seu destino. Peça de acessório vai sempre para a
   obra/TAG da separação. Valor só para quem vê contas a pagar ou a diretoria (o auxiliar de almoxarifado não vê). */
function sepPodeVerValor(){
  return (typeof podeVerContasPagar === "function" && podeVerContasPagar()) || (typeof ehDiretoria === "function" && ehDiretoria());
}
function sepTemDestino(){ return !_sepItens.length || Object.prototype.hasOwnProperty.call(_sepItens[0], "centro_custo_id"); }
function sepCentro(id){ const c = _sepCentros.find(x => x.id === id); return c ? c.nome : ""; }
function sepItemTemDestino(i){ return !!(i.obra_id || i.equipamento_id || i.centro_custo_id); }
function sepDestinoValor(i){ return i.obra_id ? "obra:" + i.obra_id : i.equipamento_id ? "eq:" + i.equipamento_id : i.centro_custo_id ? "cc:" + i.centro_custo_id : ""; }
function sepDestinoDoValor(v){
  return { obra_id: v.startsWith("obra:") ? v.slice(5) : null, equipamento_id: v.startsWith("eq:") ? v.slice(3) : null, centro_custo_id: v.startsWith("cc:") ? v.slice(3) : null };
}
function sepDestinoSeparacao(s){ return [s.obra_id ? "obra " + (sepObra(s.obra_id) || "?") : "", s.equipamento_id ? "TAG " + (sepEq(s.equipamento_id) || "?") : ""].filter(Boolean).join(" · ") || "—"; }
function sepDestinoTxt(i, s){
  if(i.obra_id) return "Obra " + (sepObra(i.obra_id) || "?");
  if(i.equipamento_id) return "TAG " + (sepEq(i.equipamento_id) || "?");
  if(i.centro_custo_id) return "Setor: " + (sepCentro(i.centro_custo_id) || "?");
  return "da separação (" + sepDestinoSeparacao(s) + ")";
}
function sepItemValor(i){
  const q = i.separado ? Number(i.quantidade_separada || 0) : Number(i.quantidade_pedida || 0);
  return Math.round(q * Number(i.custo_unitario || 0) * 100) / 100;
}
function sepDestinoOptions(i, s){
  const sel = sepDestinoValor(i);
  const ob = _sepObras.filter(o => ["em_andamento", "planejada", "paralisada"].includes(o.status) || sel === "obra:" + o.id)
    .map(o => `<option value="obra:${esc(o.id)}"${sel === "obra:" + o.id ? " selected" : ""}>Obra ${esc(o.codigo)} — ${esc(o.nome || "")}</option>`).join("");
  const eq = _sepEquips.map(e => `<option value="eq:${esc(e.id)}"${sel === "eq:" + e.id ? " selected" : ""}>TAG ${esc(e.codigo)}${e.nome ? " — " + esc(e.nome) : ""}</option>`).join("");
  const cc = _sepCentros.filter(c => c.ativo || sel === "cc:" + c.id).map(c => `<option value="cc:${esc(c.id)}"${sel === "cc:" + c.id ? " selected" : ""}>${esc(c.nome)}</option>`).join("");
  return `<option value=""${sel ? "" : " selected"}>da separação (${esc(sepDestinoSeparacao(s))})</option>`
    + (ob ? `<optgroup label="Outra obra">${ob}</optgroup>` : "") + (eq ? `<optgroup label="TAG">${eq}</optgroup>` : "")
    + (cc ? `<optgroup label="Setor / obra interna">${cc}</optgroup>` : "");
}
async function sepMudarDestino(itemId, valor){
  const { error } = await sb.from("separacao_itens").update(sepDestinoDoValor(valor || "")).eq("id", itemId);
  if(error){ aviso("app-aviso", "Destino não alterado: " + error.message, "erro"); }
  await abrirSeparacao(_sepAtual.id);
}
/* rodapé da ficha: quanto vai para cada destino (valor só para quem vê) */
function sepRenderResumoDestino(){
  const el = $("sep-resumo-destino"); if(!el) return;
  const s = _sepAtual;
  if(!s || !sepTemDestino() || !_sepItens.length){ el.innerHTML = ""; return; }
  const valor = sepPodeVerValor();
  const grupos = new Map();
  _sepItens.forEach(i => {
    const k = i.acessorio_id ? "" : sepDestinoValor(i);
    const g = grupos.get(k) || { txt: i.acessorio_id ? sepDestinoTxt({}, s) : sepDestinoTxt(i, s), n: 0, v: 0 };
    g.n++; g.v += sepItemValor(i); grupos.set(k, g);
  });
  if(grupos.size < 2 && !valor){ el.innerHTML = ""; return; }
  el.innerHTML = `<div class="card compacto" style="margin-top:12px;"><h4 style="margin:0 0 6px;font-size:var(--txt-md);">Por destino</h4>
    <table><thead><tr><th>Destino</th><th class="num">Itens</th>${valor ? '<th class="num">Valor</th>' : ""}</tr></thead><tbody>
    ${[...grupos.values()].map(g => `<tr><td>${esc(g.txt)}</td><td class="num">${g.n}</td>${valor ? `<td class="num">${brl(g.v)}</td>` : ""}</tr>`).join("")}
    </tbody>${valor ? `<tfoot><tr><th>Total</th><th class="num">${_sepItens.length}</th><th class="num">${brl(Number(s.valor_total ?? [...grupos.values()].reduce((t, g) => t + g.v, 0)))}</th></tr></tfoot>` : ""}</table></div>`;
}

/* ---------- carga ---------- */
async function sepCarregarBase(force){
  if(_sepCarregado && !force) return;
  const [ob, eq, pf, fu, cfg, cc] = await Promise.all([
    sb.from("obras").select("id,codigo,nome,status").order("codigo", { ascending: false }),
    sb.from("equipamentos").select("id,codigo,nome").eq("ativo", true).order("codigo"),
    sb.from("profiles").select("id,nome,cargo").eq("ativo", true).order("nome"),
    sb.from("funcionarios").select("id,nome,funcao,matricula").eq("ativo", true).order("nome"),
    sb.from("empresa_config").select("almoxarife_padrao_id").eq("id", 1).maybeSingle(),
    sb.from("centros_custo").select("id,nome,tipo,ativo").order("nome")   // lote S48 (#107): destino do item
  ]);
  _sepCentros = cc.data || [];
  _sepObras = ob.data || [];
  _sepEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
  _sepPerfis = pf.data || []; _sepFuncs = fu.data || []; _sepPlantao = cfg.data?.almoxarife_padrao_id || null;
  const opResp = _sepPerfis.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join("");
  if($("sep-f-resp")) $("sep-f-resp").innerHTML = `<option value="">Responsável</option>` + opResp;
  if($("sep-resp")) $("sep-resp").innerHTML = `<option value="">— sem responsável —</option>` + opResp;
  if($("sep-f-obra")) $("sep-f-obra").innerHTML = `<option value="">Obra</option>` + _sepObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("");
  _sepCarregado = true;
}
async function carregarSeparacoes(force){
  const cont = $("sep-conteudo"); if(!cont) return;
  await sepCarregarBase(force);
  $("btn-sep-novo").style.display = sepPodePedir() ? "" : "none";
  sepRenderPlantao();
  await sepFetch();
  renderSeparacoes();
}
async function sepFetch(){
  const st = $("sep-f-status") ? $("sep-f-status").value : "_abertas";
  let q = sb.from("separacoes").select(SEP_SELECT).order("created_at", { ascending: false }).limit(500);
  if(st === "_abertas") q = q.in("status", ["aberta", "em_separacao", "separada"]); else if(st) q = q.eq("status", st);
  const { data, error } = await q;
  if(error){ aviso("app-aviso", "Erro ao carregar separações: " + error.message, "erro"); _sepLista = []; return; }
  _sepLista = data || [];
}
/* almoxarife de plantão = responsável padrão dos pedidos da obra (empresa_config.almoxarife_padrao_id); diretoria altera */
function sepRenderPlantao(){
  const el = $("sep-plantao"); if(!el) return;
  const pode = !!usuarioAtual && ["diretor", "admin"].includes(usuarioAtual.cargo);
  el.innerHTML = `Almoxarife de plantão: <strong>${_sepPlantao ? esc(sepPerfil(_sepPlantao) || "?") : "não definido"}</strong>${pode ? ` <a href="#" id="sep-plantao-ed">alterar</a>` : ""}`;
  $("sep-plantao-ed")?.addEventListener("click", e => {
    e.preventDefault();
    const nomes = _sepPerfis.filter(p => ["almoxarife", "logistica", "comprador", "gestor_acessorios", "admin"].includes(p.cargo));
    el.innerHTML = `Almoxarife de plantão: <select id="sep-plantao-sel"><option value="">— ninguém —</option>${nomes.map(p => `<option value="${esc(p.id)}"${p.id === _sepPlantao ? " selected" : ""}>${esc(p.nome)}</option>`).join("")}</select> <button type="button" class="btn-sec btn-sm" id="sep-plantao-ok">ok</button>`;
    $("sep-plantao-ok").addEventListener("click", async () => {
      const id = $("sep-plantao-sel").value || null;
      const { error } = await sb.from("empresa_config").update({ almoxarife_padrao_id: id }).eq("id", 1);
      if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
      _sepPlantao = id; sepRenderPlantao();
      aviso("app-aviso", id ? `${sepPerfil(id)} passa a receber os pedidos da obra.` : "Pedidos da obra ficam sem responsável até alguém assumir na tela Separações.", "ok");
    });
  });
}

/* ---------- painel ---------- */
function sepFiltrados(){
  const q = ($("sep-busca")?.value || "").trim().toLowerCase();
  const or = $("sep-f-origem")?.value || "", rs = $("sep-f-resp")?.value || "", ob = $("sep-f-obra")?.value || "", minhas = !!$("sep-f-minhas")?.checked;
  return _sepLista.filter(s => {
    if(or && s.origem_tipo !== or) return false;
    if(rs && s.responsavel_id !== rs) return false;
    if(ob && s.obra_id !== ob) return false;
    if(minhas && !sepMinha(s)) return false;
    if(_sepPreset === "vencidas" && !sepVencida(s)) return false;
    if(_sepPreset === "sem_resp" && (s.responsavel_id || !sepAberta(s))) return false;
    if(q && ![s.numero, sepObra(s.obra_id), sepObraNome(s.obra_id), sepEq(s.equipamento_id), s.responsavel?.nome, s.solicitante?.nome, s.observacoes].filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
    return true;
  });
}
function renderSeparacoes(){
  const cont = $("sep-conteudo"); if(!cont) return;
  document.querySelectorAll("#sep-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _sepView));
  const dados = sepFiltrados();
  const verValor = sepPodeVerValor() && _sepLista.some(s => s.valor_total != null);   // lote S48 (#107)
  $("sep-contador").textContent = `${dados.length} de ${_sepLista.length}`;
  const preset = _sepPreset ? `<p class="meta">Filtro da Sala de Comando: <strong>${_sepPreset === "vencidas" ? "prazo vencido" : "sem responsável"}</strong> · <a href="#" id="sep-preset-off">limpar</a></p>` : "";
  if(!dados.length){
    cont.innerHTML = preset + `<p class="vazio">Nenhuma separação com esses filtros.${sepPodePedir() ? ' Use "+ Pedido da obra" ou "Gerar separação" na mobilização.' : ""}</p>`;
  } else if(_sepView === "kanban"){
    const cols = SEP_STAGES.concat(dados.some(s => s.status === "cancelada") ? ["cancelada"] : []);
    cont.innerHTML = preset + `<div class="serv-kanban">${cols.map(st => { const its = dados.filter(s => s.status === st);
      return `<div class="serv-kan-col"><div class="serv-kan-col-head">${sepTag(st)} <span class="contador">${its.length}</span></div>
        ${its.slice(0, 200).map(s => { const p = sepProgresso(s); return `<div class="serv-kan-card" data-id="${esc(s.id)}">
          <div class="serv-kan-card-nome"><strong>${esc(s.numero)}</strong> <span class="meta">${esc(SEP_ORIGEM[s.origem_tipo] || "")}</span></div>
          <div>${esc(sepObra(s.obra_id) || "—")}${s.equipamento_id ? ` · TAG ${esc(sepEq(s.equipamento_id))}` : ""}</div>
          <div class="meta">${p.ok} de ${p.n} separado(s)${s.responsavel ? " · " + esc(s.responsavel.nome) : " · sem responsável"}</div>
          ${verValor && s.valor_total != null ? `<div class="meta">valor ${brl(s.valor_total)}</div>` : ""}
          ${s.prazo ? `<div class="meta">prazo ${dataBR(s.prazo)}${sepVencida(s) ? ' <span class="tag vermelho">vencido</span>' : ""}</div>` : ""}
        </div>`; }).join("") || `<p class="vazio">—</p>`}${its.length > 200 ? `<p class="meta">… e mais ${its.length - 200}</p>` : ""}</div>`; }).join("")}</div>`;
  } else {
    cont.innerHTML = preset + `<div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Criada</th><th>Origem</th><th>Obra</th><th>TAG</th><th>Pedido por</th><th>Responsável</th><th>Prazo</th><th class="num">Itens</th>${verValor ? '<th class="num">Valor</th>' : ""}<th>Status</th></tr></thead>
      <tbody>${dados.map(s => { const p = sepProgresso(s); return `<tr class="linha-clicavel" data-id="${esc(s.id)}">
        <td><strong>${esc(s.numero)}</strong></td><td>${dataBR(s.created_at)}</td><td>${esc(SEP_ORIGEM[s.origem_tipo] || s.origem_tipo)}</td>
        <td>${linkObra(s.obra_id, sepObra(s.obra_id) || "—")}</td><td>${s.equipamento_id ? linkEquipamento(s.equipamento_id, sepEq(s.equipamento_id)) : '<span class="meta">—</span>'}</td>
        <td class="meta">${esc(s.solicitante?.nome || "—")}</td><td>${s.responsavel ? esc(s.responsavel.nome) : '<span class="tag ambar">sem responsável</span>'}</td>
        <td>${s.prazo ? dataBR(s.prazo) : "—"}${sepVencida(s) ? ' <span class="tag vermelho">vencido</span>' : ""}</td>
        <td class="num">${p.ok} / ${p.n}</td>${verValor ? `<td class="num">${s.valor_total != null ? brl(s.valor_total) : "—"}</td>` : ""}<td>${sepTag(s.status)}</td></tr>`; }).join("")}</tbody></table></div>`;
  }
  $("sep-preset-off")?.addEventListener("click", e => { e.preventDefault(); _sepPreset = ""; renderSeparacoes(); });
  cont.querySelectorAll("[data-id]").forEach(el => el.addEventListener("click", () => abrirSeparacao(el.dataset.id)));
}

/* ---------- ficha ---------- */
async function abrirSeparacao(id){
  await sepCarregarBase(false);
  const [s, it] = await Promise.all([
    sb.from("separacoes").select(SEP_SELECT).eq("id", id).maybeSingle(),
    sb.from("separacao_itens").select(SEP_ITEM_SELECT).eq("separacao_id", id).order("ordem").order("created_at")
  ]);
  if(s.error || !s.data){ aviso("app-aviso", "Não foi possível abrir a separação" + (s.error ? ": " + s.error.message : "."), "erro"); return; }
  _sepAtual = s.data; _sepItens = it.data || [];
  $("sep-painel").style.display = "none"; $("sep-ficha").style.display = "";
  $("sep-entrega").style.display = "none"; _sepRetirante = null; $("sep-retirante").value = "";
  $("sep-resp").value = _sepAtual.responsavel_id || ""; $("sep-prazo").value = _sepAtual.prazo || ""; $("sep-obs").value = _sepAtual.observacoes || "";
  sepAtualizarCabecalho();
  sepRenderItens();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function sepAtualizarCabecalho(){
  const s = _sepAtual; if(!s) return;
  const st = s.status, pode = sepPodeEditar(s), opera = sepPodeOperar(), ok = _sepItens.filter(i => i.separado).length, fim = ["entregue", "cancelada"].includes(st);
  $("sep-ficha-titulo").textContent = `${s.numero} · ${sepObra(s.obra_id) || ""}${st === "cancelada" ? " · cancelada" : ""}`;
  document.querySelectorAll("#sep-statusbar .stage").forEach(el => {
    el.classList.remove("atual", "passada");
    const i = SEP_STAGES.indexOf(st), j = SEP_STAGES.indexOf(el.dataset.status);
    if(st !== "cancelada"){ if(j === i) el.classList.add("atual"); else if(j < i) el.classList.add("passada"); }
  });
  $("sep-chip-origem").innerHTML = s.origem_tipo === "mobilizacao" && s.mobilizacao_id ? `<a href="#" id="sep-chip-mob-link" title="abrir a mobilização">Mobilização</a>` : esc(SEP_ORIGEM[s.origem_tipo] || "—");
  $("sep-chip-mob-link")?.addEventListener("click", e => { e.preventDefault(); if(irParaSecao("mobilizacoes") && typeof abrirMobilizacao === "function") abrirMobilizacao(s.mobilizacao_id); });
  $("sep-chip-obra").innerHTML = linkObra(s.obra_id, sepObra(s.obra_id) || "—");
  $("sep-chip-tag").innerHTML = s.equipamento_id ? linkEquipamento(s.equipamento_id, sepEq(s.equipamento_id)) : "—";
  $("sep-chip-solic").textContent = s.solicitante?.nome || "—";
  $("sep-chip-prazo").innerHTML = s.prazo ? `${dataBR(s.prazo)}${sepVencida(s) ? ' <span class="tag vermelho">vencido</span>' : ""}` : "—";
  $("sep-chip-retirante-box").style.display = s.retirante ? "" : "none";
  $("sep-chip-retirante").textContent = s.retirante ? `${s.retirante.nome}${s.entregue_em ? " · " + dataBR(s.entregue_em) : ""}` : "—";
  // lote S48 (#107): valor total (gatilho no banco) para quem vê valor
  const verTotal = sepPodeVerValor() && s.valor_total != null;
  if($("sep-chip-total-box")){ $("sep-chip-total-box").style.display = verTotal ? "" : "none"; if(verTotal) $("sep-chip-total").textContent = brl(s.valor_total); }
  const sbn = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !n); } };
  sbn("sb-sep-itens", _sepItens.length); sbn("sb-sep-sep", ok);
  const mostra = { "btn-sep-salvar": pode && !fim, "btn-sep-iniciar": opera && st === "aberta", "btn-sep-entregar": opera && st === "separada",
    "btn-sep-cancelar": pode && !fim && !ok, "btn-sep-imprimir": true };
  Object.entries(mostra).forEach(([id, on]) => { const b = $(id); if(b) b.style.display = on ? "" : "none"; });
  ["sep-resp", "sep-prazo", "sep-obs"].forEach(id => { $(id).disabled = !(pode && !fim); });
  $("sep-itens-add").style.display = pode && !fim ? "" : "none";
}
function sepItemNome(i){
  if(i.produto_id) return `${linkProduto(i.produto_id, i.produto ? i.produto.codigo : "produto")} ${esc(i.produto ? i.produto.nome : i.descricao)}`;
  if(i.acessorio_id) return `${linkAcessorio(i.acessorio_id, i.acessorio?.marcacao || "peça")} <span class="meta">${esc(i.descricao)}</span>`;
  return `${esc(i.descricao)} <span class="tag ambar" title="pedido sem produto do catálogo: case com um produto antes de separar">item livre</span>`;
}
function sepBaixaTxt(i){
  if(!i.separado){
    if(i.produto){ const falta = Number(i.quantidade_pedida) > Number(i.produto.estoque_atual || 0);
      return `<span class="meta">saldo ${num(i.produto.estoque_atual || 0)} ${esc(i.produto.unidade || "un")}${falta ? (i.produto.controle_reposicao ? ' · <span class="txt-perigo">insuficiente</span>' : " · vai ficar negativo") : ""}</span>`; }
    if(i.acessorio) return `<span class="meta">${esc(typeof aceOnde === "function" ? aceOnde(i.acessorio) : (i.acessorio.local_tipo || ""))}</span>`;
    return "";
  }
  if(i.movimentacao_estoque_id) return `<span class="tag verde">saída registrada</span> <span class="meta">${dataBR(i.separado_em)}</span>`;
  if(i.acessorio_evento_id) return `<span class="tag verde">peça na obra</span> <span class="meta">${dataBR(i.separado_em)}</span>`;
  return `<span class="tag cinza">separado</span>`;
}
function sepRenderItens(){
  const tb = $("sep-itens"); if(!tb) return;
  const s = _sepAtual, pode = sepPodeEditar(s), opera = sepPodeOperar(), fim = ["entregue", "cancelada"].includes(s.status);
  // lote S48 (#107): colunas Destino e Valor (sem a migration, os itens não trazem as colunas novas e elas somem)
  const comDestino = sepTemDestino(), verValor = comDestino && sepPodeVerValor();
  if($("sep-th-destino")) $("sep-th-destino").style.display = comDestino ? "" : "none";
  if($("sep-th-valor")) $("sep-th-valor").style.display = verValor ? "" : "none";
  sepRenderResumoDestino();
  if(!_sepItens.length){ tb.innerHTML = `<tr><td colspan="9" class="vazio">Nenhum item. Adicione abaixo.</td></tr>`; return; }
  const colDestino = (i) => {
    if(!comDestino) return "";
    if(i.acessorio_id) return `<td class="meta" title="Peça de acessório vai para a obra/TAG da separação">${esc(sepDestinoSeparacao(s))}</td>`;
    if(pode && !fim && !i.separado) return `<td><select class="sep-destino" style="max-width:220px;" title="Para onde vai o custo deste item (padrão: o da separação)">${sepDestinoOptions(i, s)}</select></td>`;
    return `<td class="${sepItemTemDestino(i) ? "" : "meta"}">${esc(sepDestinoTxt(i, s))}</td>`;
  };
  const colValor = (i) => !verValor ? "" : `<td class="num" title="${i.custo_unitario != null ? "custo unitário " + brl(i.custo_unitario) : "sem custo"}">${i.produto_id ? brl(sepItemValor(i)) : "—"}</td>`;
  tb.innerHTML = _sepItens.map(i => `<tr data-id="${esc(i.id)}" class="${i.separado ? "sep-ok" : ""}">
    <td><input type="checkbox" class="sep-marca" ${i.separado ? "checked" : ""} ${opera && !fim ? "" : "disabled"} title="${i.separado ? "desmarcar estorna a baixa" : "marcar dá a baixa na hora"}" /></td>
    <td>${sepItemNome(i)}${!i.produto_id && !i.acessorio_id && opera && !fim ? `<div class="campo sep-casar"><input class="sep-casar-busca" placeholder="casar com produto do catálogo…" autocomplete="off" /><div class="autocomplete-lista sep-casar-res" style="display:none;"></div></div>` : ""}${i.observacoes ? `<div class="meta">${esc(i.observacoes)}</div>` : ""}</td>
    <td>${esc(i.unidade || "un")}</td>
    <td class="num">${num(i.quantidade_pedida)}</td>
    <td>${i.separado ? num(i.quantidade_separada) : i.acessorio_id ? "1" : `<input type="number" class="sep-qtd" value="${esc(i.quantidade_pedida)}" min="0.001" step="0.001" style="width:86px;text-align:right;" ${opera && !fim ? "" : "disabled"} title="quantidade que vai sair ao marcar" />`}</td>
    ${colDestino(i)}${colValor(i)}
    <td>${sepBaixaTxt(i)}</td>
    <td class="col-acao">${!i.separado && pode && !fim ? `<button type="button" class="btn-sec btn-sm sep-rem" title="tirar da lista">×</button>` : ""}</td></tr>`).join("");
  tb.querySelectorAll(".sep-destino").forEach(sel => sel.addEventListener("change", () => sepMudarDestino(sel.closest("tr").dataset.id, sel.value)));   // lote S48 (#107)
  tb.querySelectorAll(".sep-marca").forEach(cb => cb.addEventListener("change", () => sepMarcar(cb.closest("tr").dataset.id, cb)));
  tb.querySelectorAll(".sep-rem").forEach(b => b.addEventListener("click", () => sepRemoverItem(b.closest("tr").dataset.id)));
  tb.querySelectorAll(".sep-casar-busca").forEach(inp => sepLigarBusca(inp, inp.nextElementSibling, p => sepCasarItem(inp.closest("tr").dataset.id, p)));
}
/* marcar = baixa na hora (RPC); desmarcar = estorno. A ficha é recarregada para mostrar saldo e situação novos. */
async function sepMarcar(itemId, cb){
  const i = _sepItens.find(x => x.id === itemId); if(!i) return;
  cb.disabled = true;
  if(!i.separado){
    if(!i.produto_id && !i.acessorio_id){ aviso("app-aviso", `"${i.descricao}" é item livre: case com um produto do catálogo antes de marcar.`, "erro"); cb.checked = false; cb.disabled = false; return; }
    const q = Number(cb.closest("tr").querySelector(".sep-qtd")?.value || i.quantidade_pedida);
    const { error } = await sb.rpc("separacao_marcar", { p_item_id: itemId, p_quantidade: i.acessorio_id ? null : q });
    if(error){ aviso("app-aviso", "Não marcado: " + error.message.replace(/^.*?: /, ""), "erro"); cb.checked = false; cb.disabled = false; return; }
  } else {
    if(!confirm("Desmarcar estorna a baixa: o material volta ao estoque (ou a peça volta de onde saiu). Continuar?")){ cb.checked = true; cb.disabled = false; return; }
    const { error } = await sb.rpc("separacao_desmarcar", { p_item_id: itemId });
    if(error){ aviso("app-aviso", "Não desmarcado: " + error.message.replace(/^.*?: /, ""), "erro"); cb.checked = true; cb.disabled = false; return; }
  }
  if(typeof aceInvalidar === "function" && i.acessorio_id) aceInvalidar();
  if($("sec-produtos")?.classList.contains("ativa") && typeof carregarProdutos === "function") carregarProdutos();
  await abrirSeparacao(_sepAtual.id);
}
async function sepAddProduto(p){
  const s = _sepAtual; if(!s || !p) return;
  const q = Number($("sep-prod-qtd").value || 1); if(!(q > 0)){ aviso("app-aviso", "Quantidade inválida.", "erro"); return; }
  const ja = _sepItens.find(i => i.produto_id === p.id && !i.separado);
  const r = ja ? await sb.from("separacao_itens").update({ quantidade_pedida: Number(ja.quantidade_pedida) + q }).eq("id", ja.id)
               : await sb.from("separacao_itens").insert({ separacao_id: s.id, produto_id: p.id, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || "un", quantidade_pedida: q, ordem: 2000 + _sepItens.length });
  if(r.error){ aviso("app-aviso", "Item não adicionado: " + r.error.message, "erro"); return; }
  $("sep-prod-qtd").value = 1;
  await abrirSeparacao(s.id);
}
async function sepAddLivre(){
  const s = _sepAtual; if(!s) return;
  const d = $("sep-livre-desc").value.trim(), q = Number($("sep-livre-qtd").value || 0), un = $("sep-livre-un").value.trim() || "un";
  if(!d){ $("sep-livre-desc").focus(); return; }
  if(!(q > 0)){ aviso("app-aviso", "Quantidade inválida.", "erro"); return; }
  const { error } = await sb.from("separacao_itens").insert({ separacao_id: s.id, descricao: d, unidade: un, quantidade_pedida: q, ordem: 2000 + _sepItens.length });
  if(error){ aviso("app-aviso", "Item não adicionado: " + error.message, "erro"); return; }
  $("sep-livre-desc").value = ""; $("sep-livre-qtd").value = 1; $("sep-livre-un").value = "un";
  await abrirSeparacao(s.id);
}
/* item livre → produto do catálogo (o texto pedido fica na observação) */
async function sepCasarItem(itemId, p){
  const i = _sepItens.find(x => x.id === itemId); if(!i || !p) return;
  const { error } = await sb.from("separacao_itens").update({ produto_id: p.id, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || i.unidade || "un",
    observacoes: [i.observacoes, "pedido como: " + i.descricao].filter(Boolean).join(" · ") }).eq("id", itemId);
  if(error){ aviso("app-aviso", "Não foi possível casar o item: " + error.message, "erro"); return; }
  await abrirSeparacao(_sepAtual.id);
}
async function sepRemoverItem(itemId){
  const i = _sepItens.find(x => x.id === itemId); if(!i || i.separado) return;
  if(!confirm(`Tirar "${i.descricao}" da lista?`)) return;
  const { error } = await sb.from("separacao_itens").delete().eq("id", itemId);
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
  await abrirSeparacao(_sepAtual.id);
}
async function salvarSeparacao(){
  const s = _sepAtual; if(!s || !sepPodeEditar(s)) return;
  const { error } = await sb.from("separacoes").update({ responsavel_id: $("sep-resp").value || null, prazo: $("sep-prazo").value || null, observacoes: $("sep-obs").value.trim() || null }).eq("id", s.id);
  if(error){ aviso("app-aviso", "Erro ao salvar: " + error.message, "erro"); return; }
  aviso("app-aviso", "Separação salva.", "ok");
  await abrirSeparacao(s.id);
}
async function sepIniciar(){
  const s = _sepAtual; if(!s || !sepPodeOperar()) return;
  const upd = { status: "em_separacao" }; if(!s.responsavel_id) upd.responsavel_id = usuarioAtual.id;
  const { error } = await sb.from("separacoes").update(upd).eq("id", s.id);
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
  aviso("app-aviso", upd.responsavel_id ? "Separação iniciada e atribuída a você." : "Separação iniciada.", "ok");
  await abrirSeparacao(s.id);
}
function sepPedirRetirante(){ $("sep-entrega").style.display = ""; $("sep-retirante").focus(); }
function sepLigarRetirante(){
  const inp = $("sep-retirante"), lista = $("sep-retirante-res"); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(() => {
    _sepRetirante = null;
    const q = sepSemAcento(inp.value.trim()); if(q.length < 2){ lista.style.display = "none"; return; }
    const fs = _sepFuncs.filter(f => sepSemAcento(`${f.nome} ${f.matricula || ""}`).includes(q)).slice(0, 15);
    lista.innerHTML = fs.length ? fs.map(f => `<div class="resultado-item" data-id="${esc(f.id)}"><strong>${esc(f.nome)}</strong> <span class="meta">${esc(f.funcao || "")}${f.matricula ? " · mat. " + esc(f.matricula) : ""}</span></div>`).join("")
      : `<div class="resultado-item vazio">Nenhum funcionário ativo com esse nome.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => { _sepRetirante = fs.find(f => f.id === d.dataset.id) || null; inp.value = _sepRetirante ? _sepRetirante.nome : ""; lista.style.display = "none"; }));
  }, 200));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 200));
}
async function sepEntregar(){
  const s = _sepAtual; if(!s) return;
  if(!_sepRetirante){ aviso("app-aviso", "Escolha quem levou o material.", "erro"); $("sep-retirante").focus(); return; }
  const { error } = await sb.rpc("separacao_entregar", { p_id: s.id, p_retirante_id: _sepRetirante.id });
  if(error){ aviso("app-aviso", "Não entregue: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", `${s.numero} entregue a ${_sepRetirante.nome}.`, "ok");
  await abrirSeparacao(s.id);
}
async function sepCancelar(){
  const s = _sepAtual; if(!s || !sepPodeEditar(s)) return;
  if(_sepItens.some(i => i.separado)){ aviso("app-aviso", "Desmarque os itens separados antes de cancelar (a baixa é estornada).", "erro"); return; }
  if(!confirm(`Cancelar a separação ${s.numero}?`)) return;
  const { error } = await sb.from("separacoes").update({ status: "cancelada" }).eq("id", s.id);
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
  aviso("app-aviso", "Separação cancelada.", "ok");
  await abrirSeparacao(s.id);
}
/* lista impressa para quem separa no galpão (pdfGerar do core; sem html2pdf cai na impressão do navegador) */
async function sepImprimir(){
  const s = _sepAtual; if(!s) return;
  const td = "border:1px solid;padding:4px;";
  const linhas = _sepItens.map((i, n) => `<tr><td style="${td}text-align:center;">${i.separado ? "☑" : "☐"}</td><td style="${td}text-align:center;">${n + 1}</td>
    <td style="${td}">${esc(i.acessorio ? i.acessorio.marcacao + " · " : "")}${esc(i.produto ? i.produto.codigo + " — " + i.produto.nome : i.descricao)}${i.observacoes ? `<br><small>${esc(i.observacoes)}</small>` : ""}${sepItemTemDestino(i) ? `<br><small>destino: ${esc(sepDestinoTxt(i, s))}</small>` : ""}</td>
    <td style="${td}text-align:right;">${num(i.quantidade_pedida)} ${esc(i.unidade || "un")}</td><td style="${td}width:70px;"></td></tr>`).join("");
  const html = `<div style="font-family:'Open Sans',Arial,sans-serif;font-size:11px;">
    ${typeof pdfCabecalhoHTML === "function" ? pdfCabecalhoHTML("Lista de separação", s.numero) : `<h2>Lista de separação ${esc(s.numero)}</h2>`}
    <table style="width:100%;border-collapse:collapse;margin:8px 0 12px;"><tr>
      <td style="padding:3px;"><b>Obra:</b> ${esc(sepObra(s.obra_id))} ${esc(sepObraNome(s.obra_id))}</td>
      <td style="padding:3px;"><b>TAG:</b> ${esc(sepEq(s.equipamento_id) || "—")}</td>
      <td style="padding:3px;"><b>Origem:</b> ${esc(SEP_ORIGEM[s.origem_tipo] || "")}</td></tr><tr>
      <td style="padding:3px;"><b>Pedido por:</b> ${esc(s.solicitante?.nome || "—")} em ${dataBR(s.created_at)}</td>
      <td style="padding:3px;"><b>Responsável:</b> ${esc(s.responsavel?.nome || "—")}</td>
      <td style="padding:3px;"><b>Prazo:</b> ${s.prazo ? dataBR(s.prazo) : "—"}</td></tr></table>
    ${s.observacoes ? `<p><b>Obs.:</b> ${esc(s.observacoes)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;"><thead><tr><th style="${td}width:28px;">✔</th><th style="${td}width:28px;">#</th><th style="${td}text-align:left;">Item</th><th style="${td}width:90px;">Qtd</th><th style="${td}">Separado</th></tr></thead><tbody>${linhas}</tbody></table>
    <p style="margin-top:24px;">Separado por: ______________________________ &nbsp;&nbsp; Retirado por: ______________________________ &nbsp;&nbsp; Data: ____/____/______</p>
  </div>`;
  const wrap = document.createElement("div"); wrap.innerHTML = html;
  if(typeof html2pdf === "undefined" || typeof pdfGerar !== "function"){
    const w = window.open("", "_blank"); if(!w){ aviso("app-aviso", "Permita pop-ups para imprimir.", "erro"); return; }
    w.document.write(`<html><head><title>${esc(s.numero)}</title><style>@page { size: A4; margin: 14mm; }</style></head><body>${html}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); return;
  }
  try { await pdfGerar(wrap, { filename: `Separacao_${s.numero}.pdf`, largura: 182, topo: 14 }); }
  catch(e){ aviso("app-aviso", "Não foi possível gerar o PDF: " + (e.message || e), "erro"); }
}
function mostrarPainelSeparacoes(){ $("sep-ficha").style.display = "none"; $("sep-painel").style.display = ""; _sepAtual = null; }

/* ---------- busca no catálogo (ficha, modal e materiais da mobilização) ---------- */
async function sepBuscarProduto(termo){
  const t = termo.replace(/[%,()]/g, " ").trim(); if(t.length < 2) return [];
  const { data } = await sb.from("produtos").select(SEP_PROD_COLS).eq("ativo", true).or(`nome.ilike.%${t}%,codigo.ilike.%${t}%,codigo_barras.eq.${t}`).order("nome").limit(25);
  return data || [];
}
/* Enter no campo (leitor de código de barras manda Enter): código ou código de barras exato escolhe direto */
function sepLigarBusca(inp, lista, aoEscolher){
  if(!inp || !lista || inp.dataset.ligado) return; inp.dataset.ligado = "1";
  let res = [];
  const mostrar = () => {
    lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}</span></div>`).join("")
      : `<div class="resultado-item vazio">Nenhum produto com esse código ou nome.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => { const p = res.find(x => x.id === d.dataset.id); lista.style.display = "none"; inp.value = ""; aoEscolher(p); }));
  };
  inp.addEventListener("input", debounce(async () => { const t = inp.value.trim(); if(t.length < 2){ lista.style.display = "none"; return; } res = await sepBuscarProduto(t); mostrar(); }, 250));
  inp.addEventListener("keydown", async e => {
    if(e.key !== "Enter") return; e.preventDefault();
    const t = inp.value.trim(); if(!t) return;
    const x = t.replace(/[,()]/g, " ");
    const { data } = await sb.from("produtos").select(SEP_PROD_COLS).eq("ativo", true).or(`codigo.eq.${x},codigo_barras.eq.${x}`).limit(2);
    let p = (data || []).length === 1 ? data[0] : null;
    if(!p){ res = await sepBuscarProduto(t); if(res.length === 1) p = res[0]; else { mostrar(); return; } }
    lista.style.display = "none"; inp.value = ""; aoEscolher(p);
  });
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 200));
}

/* ---------- pedido da obra (ficha da obra, RDO, "+ Pedido da obra") ---------- */
async function abrirPedidoMaterial(pre){
  if(!sepPodePedir()){ aviso("app-aviso", "Seu perfil não pede material ao almoxarifado.", "erro"); return; }
  await sepCarregarBase(false);
  _sepPed = { itens: [] };
  const obraPre = pre?.obra_id || "";
  $("sep-ped-obra").innerHTML = `<option value="">— obra —</option>` + _sepObras.filter(o => ["em_andamento", "planejada", "paralisada"].includes(o.status) || o.id === obraPre).map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("");
  $("sep-ped-equip").innerHTML = `<option value="">— nenhuma —</option>` + _sepEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
  $("sep-ped-obra").value = obraPre; $("sep-ped-equip").value = pre?.equipamento_id || "";
  $("sep-ped-prazo").value = ""; $("sep-ped-obs").value = ""; $("sep-ped-livre").value = ""; $("sep-ped-busca").value = "";
  $("sep-ped-resp").textContent = _sepPlantao ? sepPerfil(_sepPlantao) : "ninguém definido (o almoxarifado assume na tela Separações)";
  sepPedRenderItens();
  $("sep-ped-modal").style.display = "flex";
  $("sep-ped-busca").focus();
}
function fecharPedidoMaterial(){ $("sep-ped-modal").style.display = "none"; _sepPed = null; }
function sepPedRenderItens(){
  const tb = $("sep-ped-itens"); if(!tb || !_sepPed) return;
  if(!_sepPed.itens.length){ tb.innerHTML = `<tr><td colspan="4" class="vazio">Nenhum item. Busque no catálogo ou escreva um item livre.</td></tr>`; return; }
  tb.innerHTML = _sepPed.itens.map((i, idx) => `<tr data-idx="${idx}">
    <td>${i.produto ? `<strong>${esc(i.produto.codigo)}</strong> ${esc(i.produto.nome)} <span class="meta">saldo ${num(i.produto.estoque_atual || 0)}</span>` : `${esc(i.descricao)} <span class="meta">(item livre)</span>`}</td>
    <td><input class="sep-ped-un" value="${esc(i.unidade)}" style="width:56px;" ${i.produto ? "disabled" : ""} /></td>
    <td><input type="number" class="sep-ped-q" value="${esc(i.quantidade)}" min="0.001" step="0.001" style="width:86px;text-align:right;" /></td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm sep-ped-rem" title="tirar">×</button></td></tr>`).join("");
  tb.querySelectorAll(".sep-ped-q").forEach(el => el.addEventListener("change", e => { _sepPed.itens[Number(e.target.closest("tr").dataset.idx)].quantidade = Number(e.target.value || 0); }));
  tb.querySelectorAll(".sep-ped-un").forEach(el => el.addEventListener("input", e => { _sepPed.itens[Number(e.target.closest("tr").dataset.idx)].unidade = e.target.value; }));
  tb.querySelectorAll(".sep-ped-rem").forEach(el => el.addEventListener("click", e => { _sepPed.itens.splice(Number(e.target.closest("tr").dataset.idx), 1); sepPedRenderItens(); }));
}
function sepPedAddProduto(p){
  if(!p || !_sepPed) return;
  const ja = _sepPed.itens.find(i => i.produto && i.produto.id === p.id);
  if(ja) ja.quantidade = Number(ja.quantidade || 0) + 1; else _sepPed.itens.push({ produto: p, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || "un", quantidade: 1 });
  sepPedRenderItens();
}
function sepPedAddLivre(){
  const d = $("sep-ped-livre").value.trim(); if(!d || !_sepPed) return;
  _sepPed.itens.push({ produto: null, descricao: d, unidade: "un", quantidade: 1 });
  $("sep-ped-livre").value = ""; sepPedRenderItens();
  const q = $("sep-ped-itens").querySelector(`tr[data-idx="${_sepPed.itens.length - 1}"] .sep-ped-q`); if(q){ q.focus(); q.select(); }
}
async function salvarPedidoMaterial(){
  if(!_sepPed) return;
  const obra = $("sep-ped-obra").value; if(!obra){ aviso("app-aviso", "Escolha a obra.", "erro"); $("sep-ped-obra").focus(); return; }
  const itens = _sepPed.itens.filter(i => Number(i.quantidade) > 0);
  if(!itens.length){ aviso("app-aviso", "Adicione ao menos um item com quantidade.", "erro"); return; }
  const reg = { origem_tipo: "pedido_obra", obra_id: obra, equipamento_id: $("sep-ped-equip").value || null, prazo: $("sep-ped-prazo").value || null,
    observacoes: $("sep-ped-obs").value.trim() || null, responsavel_id: _sepPlantao || null, solicitante_id: usuarioAtual.id };
  const { data: s, error } = await sb.from("separacoes").insert(reg).select("id,numero").single();
  if(error){ aviso("app-aviso", "Pedido não enviado: " + error.message, "erro"); return; }
  const { error: eIt } = await sb.from("separacao_itens").insert(itens.map((i, n) => ({ separacao_id: s.id, produto_id: i.produto ? i.produto.id : null, descricao: i.descricao, unidade: (i.unidade || "un").trim() || "un", quantidade_pedida: Number(i.quantidade), ordem: n + 1 })));
  if(eIt){ await sb.from("separacoes").update({ status: "cancelada", observacoes: "itens não gravados: " + eIt.message }).eq("id", s.id); aviso("app-aviso", "Erro nos itens: " + eIt.message, "erro"); return; }
  aviso("app-aviso", `Pedido ${s.numero} enviado ao almoxarifado${_sepPlantao ? " (" + sepPerfil(_sepPlantao) + ")" : ""}.`, "ok");
  fecharPedidoMaterial();
  if($("sec-separacoes")?.classList.contains("ativa")){ await sepFetch(); renderSeparacoes(); }
}
/* chamada da ficha da mobilização (mobilizacoes.js): cria a separação do kit + materiais, ou devolve a que já está aberta */
async function sepGerarDeMobilizacao(mobId){
  const { data, error } = await sb.rpc("separacao_de_mobilizacao", { p_mobilizacao_id: mobId });
  if(error){ aviso("app-aviso", "Separação não gerada: " + error.message.replace(/^.*?: /, ""), "erro"); return null; }
  return data;
}

/* ---------- listeners ---------- */
function ligarSeparacoes(){
  if(!$("sec-separacoes")) return;
  document.querySelector('nav button[data-secao="separacoes"]')?.addEventListener("click", () => { mostrarPainelSeparacoes(); carregarSeparacoes(false); });
  document.querySelectorAll("#sep-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _sepView = b.dataset.view; renderSeparacoes(); }));
  $("sep-busca")?.addEventListener("input", debounce(renderSeparacoes));
  ["sep-f-origem", "sep-f-resp", "sep-f-obra", "sep-f-minhas"].forEach(id => $(id)?.addEventListener("change", renderSeparacoes));
  $("sep-f-status")?.addEventListener("change", async () => { await sepFetch(); renderSeparacoes(); });
  $("btn-sep-atualizar")?.addEventListener("click", () => carregarSeparacoes(true));
  $("btn-sep-novo")?.addEventListener("click", () => abrirPedidoMaterial());
  $("btn-sep-voltar")?.addEventListener("click", async () => { mostrarPainelSeparacoes(); await sepFetch(); renderSeparacoes(); });
  $("btn-sep-salvar")?.addEventListener("click", () => comBotaoTravado("btn-sep-salvar", salvarSeparacao));
  $("btn-sep-iniciar")?.addEventListener("click", () => comBotaoTravado("btn-sep-iniciar", sepIniciar));
  $("btn-sep-entregar")?.addEventListener("click", sepPedirRetirante);
  $("btn-sep-entregar-ok")?.addEventListener("click", () => comBotaoTravado("btn-sep-entregar-ok", sepEntregar));
  $("btn-sep-entregar-nao")?.addEventListener("click", () => { $("sep-entrega").style.display = "none"; });
  $("btn-sep-cancelar")?.addEventListener("click", sepCancelar);
  $("btn-sep-imprimir")?.addEventListener("click", () => comBotaoTravado("btn-sep-imprimir", sepImprimir));
  sepLigarRetirante();
  sepLigarBusca($("sep-prod-busca"), $("sep-prod-res"), p => sepAddProduto(p));
  $("btn-sep-livre-add")?.addEventListener("click", sepAddLivre);
  $("sep-livre-desc")?.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); sepAddLivre(); } });
  // modal: pedido da obra
  sepLigarBusca($("sep-ped-busca"), $("sep-ped-res"), p => sepPedAddProduto(p));
  $("btn-sep-ped-livre")?.addEventListener("click", sepPedAddLivre);
  $("sep-ped-livre")?.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); sepPedAddLivre(); } });
  $("btn-sep-ped-fechar")?.addEventListener("click", fecharPedidoMaterial);
  $("btn-sep-ped-salvar")?.addEventListener("click", () => comBotaoTravado("btn-sep-ped-salvar", salvarPedidoMaterial));
  $("sep-ped-modal")?.addEventListener("click", e => { if(e.target.id === "sep-ped-modal") fecharPedidoMaterial(); });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarSeparacoes);
} else {
  ligarSeparacoes();
}

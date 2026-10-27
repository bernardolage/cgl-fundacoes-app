/* ====================================================================
   Módulo: Estoque por quantidade (fase 51 — plano de acessórios §4.6)
   - Registrar movimento: entrada (compra), saída (consumo em obra/TAG), ajuste (inventário).
     Fase 100 (#97): a saída ficou só na "Saída de material" (balcão, com quem retira; obrigatório para EPI).
     O gatilho aplicar_movimentacao_estoque atualiza produtos.estoque_atual / custo_ultimo.
   - Reposição: só SKUs com controle_reposicao (atual · mínimo · ideal · a comprar) + lista de compra.
   - Últimos movimentos.
   ==================================================================== */

let _estTipo = "entrada";          // tipo do movimento em edição
let _estProd = null;               // produto escolhido no formulário
let _estHist = [];                 // últimos movimentos
let _estHistTipo = "";             // filtro do histórico
let _estRep = [];                  // itens controlados
let _estProdMap = {};              // id -> produto (para o histórico)
let _estObras = [];
let _estEquips = [];
let _estCtrlProd = null;           // produto escolhido no modal "controlar"
let _estCarregado = false;
let _estCentros = [];              // fase 76: setores e obras internas
let _balItens = [];                // fase 78: itens da saída no balcão [{ p, quantidade, observacoes }]
let _balRetirante = null;          // funcionário que retira
let _balFuncs = null;              // funcionários ativos (busca do retirante)
let _balHoje = [];                 // saídas de hoje
let _balDestinoOrigem = "";        // fase 108c: quem preencheu o destino ("", "sugestao", "alocacao", "manual")
let _balAlocCache = {};            // fase 108c: funcionario_id -> resposta de estoque_destino_epi

const EST_TIPO_LBL = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", devolucao: "Devolução", transferencia: "Transferência" };
const EST_TIPO_COR = { entrada: "verde", saida: "ambar", ajuste: "azul", devolucao: "verde", transferencia: "cinza" };
const EST_AJUDA = {
  entrada: "Compra ou recebimento: soma ao estoque e atualiza o custo do produto. Saída é no quadro \"Saída de material\", acima.",
  ajuste: "Inventário: informe a quantidade CONTADA; o sistema lança a diferença para o estoque ficar igual à contagem."
};

function estPodeEditar(){
  // fase 78: logistica (Fabrício, dono de Compras e do balcão) também movimenta
  // fase 90: auxiliar de almoxarifado (equipe do Julio) dá baixa, devolve e conta (movimentacoes_estoque_write no banco)
  return !!usuarioAtual && ["admin","diretor","almoxarife","comprador","gestor_acessorios","logistica","auxiliar_almoxarifado"].includes(usuarioAtual.cargo);
}
function estProdTxt(p){ return p ? `${p.codigo} — ${p.nome}` : "—"; }
/* fase 81: saldo acertado pela sincronização com o Odoo (scripts/importar-odoo-compras.js estoque) */
function estChipOdoo(p){
  if(!p || !p.odoo_saldo_em) return "";
  const d = new Date(p.odoo_saldo_em);
  return ` <span class="tag azul" title="saldo copiado do Odoo (WH/Estoque, SESMT, Usinagem) até o corte">saldo do Odoo em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>`;
}

/* ---------- carga ---------- */
async function carregarEstoque(force){
  if(!$("est-reposicao")) return;
  if(force || !_estCarregado){
    const [fo, ob, eq, cc] = await Promise.all([
      sb.from("fornecedores").select("id,razao_social").eq("ativo", true).order("razao_social"),
      sb.from("obras").select("id,codigo,nome,status").in("status", ["em_andamento","planejada","paralisada"]).order("codigo", { ascending: false }),
      sb.from("equipamentos").select("id,codigo,nome,tipo").eq("ativo", true).not("tipo", "in", "(caminhao,veiculo)").order("codigo"),
      sb.from("centros_custo").select("id,nome,tipo").eq("ativo", true).order("tipo", { ascending: false }).order("nome")   // fase 76
    ]);
    _estCentros = cc.data || [];
    $("ent-fornecedor").innerHTML = '<option value="">— não informado —</option>' + (fo.data || []).map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}</option>`).join("");
    _estObras = ob.data || []; _estEquips = (eq.data || []).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
    // fase 100 (#97): obra / TAG / setor da saída ficam só no destino da "Saída de material"
    balPreencherDestino();
    _estCarregado = true;
  }
  const pode = estPodeEditar();
  ["btn-registrar-entrada","btn-est-controlar"].forEach(id => { const b = $(id); if(b) b.style.display = pode ? "" : "none"; });
  if($("bal-card")) $("bal-card").style.display = pode ? "" : "none";
  if($("est-dev-card")) $("est-dev-card").style.display = pode ? "" : "none";   // fase 83
  estAplicarTipo();
  // fase 100: relatório de EPI por colaborador e por obra (js/epi.js), só para quem vê
  if(typeof epiAplicarVisibilidade === "function"){ epiAplicarVisibilidade(); if(podeVerEpi()) epiRenderRelatorio("epi-conteudo"); }
  await Promise.all([carregarReposicao(), carregarUltimasEntradas(), pode ? carregarSaidasHoje() : null]);
}

/* ---------- Saída no balcão (fase 78) ----------
   Material entregue a uma pessoa (retirante, de funcionarios) com destino obra, TAG ou setor / obra interna.
   Vários itens numa transação (RPC estoque_saida_registrar); o banco só recusa saldo insuficiente em item com
   controle de reposição (o saldo herdado do Odoo não é confiável). Desfazer em 10 min = devolução com estorno_de.
   Fase 100 (#97): é a tela única de saída ("Registrar movimento" ficou só com entrada e inventário). Quem retira
   é obrigatório só quando a lista tem EPI ou uniforme (decisão 1 do Bernardo; hotfix 168: pela categoria do produto,
   como produto_eh_epi() no banco, não só pela marcação categoria_custo) e vai para
   movimentacoes_estoque.funcionario_id; com EPI e retirante, a assinatura do recebimento abre em seguida
   (js/epi.js).
   Fase 108c: com EPI na lista e quem retira escolhido, o destino vem da alocação vigente do funcionário (obra) ou,
   sem ela, do centro SESMT (RPC estoque_destino_epi, a mesma regra do banco); o almoxarife troca à mão e a troca vence.
   Método (opcional) só com destino obra; vai para movimentacoes_estoque.metodo e vw_custos. */
const BAL_METODOS = [["helice_continua", "Hélice contínua"], ["escavada", "Trado mecanizado (escavada)"], ["raiz", "Raiz"],
  ["secante", "Hélice secante"], ["hsa", "HSA"], ["strauss", "Strauss"], ["pre_moldada", "Pré-moldada"], ["outro", "Outro"]];
function balPreencherDestino(){
  const sel = $("bal-destino"); if(!sel) return;
  const obras = _estObras.filter(o => o.status === "em_andamento");
  const grupo = t => _estCentros.filter(c => c.tipo === t).map(c => `<option value="cc:${esc(c.id)}">${esc(c.nome)}</option>`).join("");
  sel.innerHTML = `<option value="">— obra, TAG ou setor —</option>`
    + `<optgroup label="Obra em andamento">${obras.map(o => `<option value="obra:${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("")}</optgroup>`
    + `<optgroup label="TAG">${_estEquips.map(e => `<option value="eq:${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("")}</optgroup>`
    + `<optgroup label="Setor">${grupo("setor")}</optgroup><optgroup label="Obra interna">${grupo("obra_interna")}</optgroup>`;
  const met = $("bal-metodo");   // fase 108c
  if(met) met.innerHTML = `<option value="">— sem método —</option>` + BAL_METODOS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("");
  balAplicarMetodo();
}
/* fase 108c: método só faz sentido com destino obra */
function balAplicarMetodo(){
  const met = $("bal-metodo"), dv = $("bal-destino")?.value || ""; if(!met) return;
  const obra = dv.startsWith("obra:");
  met.disabled = !obra;
  if(!obra) met.value = "";
}
/* fase 108c: EPI para o destino pela alocação = categoria EPI / UNIFORMES ou EPI, ou categoria de custo epi/uniforme
   (produto_eh_epi no banco). A obrigatoriedade de quem retira e a ficha de EPI seguem por balEhEpi (fase 100). */
const BAL_CATEGORIAS_EPI = ["EPI / UNIFORMES", "EPI", "UNIFORMES"];   // hotfix 151 (UNIFORMES) · hotfix 168
function balEhEpiAloc(p){
  if(!p) return false;
  if(p.categoria_custo === "epi" || p.categoria_custo === "uniforme") return true;
  return BAL_CATEGORIAS_EPI.includes(String(p.categoria?.nome || "").trim().toUpperCase());
}
async function balDestinoEpi(funcId){
  if(!funcId) return null;
  if(Object.prototype.hasOwnProperty.call(_balAlocCache, funcId)) return _balAlocCache[funcId];
  const { data, error } = await sb.rpc("estoque_destino_epi", { p_funcionario_id: funcId });
  if(error) return null;   // migration da 108c ainda não aplicada: sem sugestão, o almoxarife escolhe o destino
  _balAlocCache[funcId] = data || null;
  return _balAlocCache[funcId];
}
/* a obra da alocação pode não estar "em andamento" (ou o SESMT inativo): a opção entra num grupo próprio */
function balGarantirOpcao(valor, rotulo){
  const sel = $("bal-destino"); if(!sel || [...sel.options].some(o => o.value === valor)) return;
  let g = sel.querySelector("optgroup[data-aloc]");
  if(!g){ g = document.createElement("optgroup"); g.label = "Pela alocação"; g.dataset.aloc = "1"; sel.insertBefore(g, sel.children[1] || null); }
  const o = document.createElement("option"); o.value = valor; o.textContent = rotulo; g.appendChild(o);
}
function balDiaMes(iso){ const s = String(iso || ""); return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s; }
async function balAtualizarDestinoAloc(){
  const box = $("bal-destino-aloc"), sel = $("bal-destino"); if(!box || !sel) return;
  const ret = _balRetirante;
  if(!ret || !_balItens.some(i => balEhEpiAloc(i.p))){
    box.style.display = "none"; box.innerHTML = "";
    if(_balDestinoOrigem === "alocacao"){ sel.value = ""; _balDestinoOrigem = ""; balAplicarMetodo(); }
    return;
  }
  const d = await balDestinoEpi(ret.id);
  if(_balRetirante !== ret) return;   // trocou quem retira durante a consulta
  if(!d){ box.style.display = "none"; box.innerHTML = ""; return; }
  let valor = "", rotulo = "", txt = "";
  if(d.origem === "alocacao"){
    valor = "obra:" + d.obra_id; rotulo = `${d.obra_codigo || ""} — ${d.obra_nome || ""}`;
    txt = `destino pela alocação: <strong>${esc(ret.nome)} · obra ${esc(d.obra_codigo || "?")} desde ${esc(balDiaMes(d.desde))}</strong>`;
  } else if(d.origem === "sesmt"){
    valor = "cc:" + d.centro_custo_id; rotulo = d.centro_nome || "SESMT";
    const semObra = d.alocacao_id && d.equipamento_codigo;
    txt = `destino: <strong>${esc(d.centro_nome || "SESMT")} (sem alocação${semObra ? " em obra" : ""})</strong>`
      + ` <span class="txt-aviso">· ${esc(ret.nome)} ${semObra ? "está alocado só na TAG " + esc(d.equipamento_codigo) : "não tem alocação vigente"}</span>`;
  } else {
    txt = `<span class="txt-aviso">${esc(ret.nome)} sem alocação vigente e sem centro SESMT cadastrado: escolha o destino</span>`;
  }
  const manual = _balDestinoOrigem === "manual" && !!sel.value && sel.value !== valor;
  if(valor && !manual){
    balGarantirOpcao(valor, rotulo);
    sel.value = valor; _balDestinoOrigem = "alocacao"; balAplicarMetodo();
  }
  box.innerHTML = txt + (manual ? ' · <span class="txt-aviso">destino trocado à mão</span>' : "");
  box.style.display = "";
}
function balDestinoTxt(m){
  if(m.obra_id){ const o = _estObras.find(x => x.id === m.obra_id); return "Obra " + (o ? o.codigo : ((typeof mapaObras === "object" && mapaObras && mapaObras[m.obra_id]) || "")); }
  if(m.equipamento_id){ const e = _estEquips.find(x => x.id === m.equipamento_id); return "TAG " + (e ? e.codigo : ""); }
  if(m.centro_custo_id){ const c = _estCentros.find(x => x.id === m.centro_custo_id); return c ? c.nome : "Setor"; }
  return "—";
}
async function balCarregarFuncionarios(){
  if(_balFuncs) return _balFuncs;
  const { data, error } = await sb.from("funcionarios").select("id,nome,funcao,matricula").eq("ativo", true).order("nome");
  if(error){ aviso("app-aviso", "Funcionários não carregaram: " + error.message, "erro"); return []; }
  _balFuncs = data || [];
  return _balFuncs;
}
function balLigarRetirante(){
  const inp = $("bal-retirante"), lista = $("bal-retirante-res"); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(async () => {
    const tinha = !!_balRetirante;
    _balRetirante = null;
    if(tinha) balAtualizarDestinoAloc();   // fase 108c: sem quem retira, o destino pela alocação sai
    const q = semAcentoBal(inp.value.trim());
    if(q.length < 2){ lista.style.display = "none"; return; }
    const fs = (await balCarregarFuncionarios()).filter(f => semAcentoBal(`${f.nome} ${f.matricula || ""}`).includes(q)).slice(0, 15);
    lista.innerHTML = fs.length ? fs.map(f => `<div class="resultado-item" data-id="${esc(f.id)}"><strong>${esc(f.nome)}</strong> <span class="meta">${esc(f.funcao || "")}${f.matricula ? " · mat. " + esc(f.matricula) : ""}</span></div>`).join("")
      : `<div class="resultado-item vazio">Nenhum funcionário ativo com esse nome.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => {
      _balRetirante = fs.find(f => f.id === d.dataset.id) || null;
      inp.value = _balRetirante ? _balRetirante.nome : ""; lista.style.display = "none";
      balAtualizarDestinoAloc();   // fase 108c
      $("bal-item")?.focus();
    }));
  }, 200));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 200));
}
function semAcentoBal(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
const BAL_COLS = "id,codigo,nome,unidade,estoque_atual,controle_reposicao,custo_ultimo,codigo_barras,categoria_custo,categoria:categorias_produto(nome)";   // fase 108c: categoria para o EPI
function balEhEpi(p){ return balEhEpiAloc(p); }   // fase 100 → hotfix 168 (#168): a mesma regra do produto_eh_epi() do banco
/* hotfix 168: na lista de hoje a movimentação já traz a categoria gravada pela RPC (epi/uniforme); a marcação do produto é reserva */
function balMovEhEpi(m){ return !!m && (["epi", "uniforme"].includes(m.categoria_custo) || ["epi", "uniforme"].includes(m.produto?.categoria_custo)); }
async function balBuscar(termo){
  const t = termo.replace(/[%,()]/g, " ").trim(); if(t.length < 2) return [];
  const { data } = await sb.from("produtos").select(BAL_COLS).eq("ativo", true).eq("tipo_item", "produto")   // lote S55 (#175): serviço consumido não passa pelo balcão
    .or(`nome.ilike.%${t}%,codigo.ilike.%${t}%,codigo_barras.eq.${t}`).order("nome").limit(25);
  return data || [];
}
/* Enter no campo (leitor de código de barras manda Enter): código ou código de barras exato adiciona direto */
async function balEnter(){
  const inp = $("bal-item"), t = inp.value.trim(); if(!t) return;
  const { data } = await sb.from("produtos").select(BAL_COLS).eq("ativo", true).eq("tipo_item", "produto").or(`codigo.eq.${t.replace(/[,()]/g, " ")},codigo_barras.eq.${t.replace(/[,()]/g, " ")}`).limit(2);   // lote S55 (#175)
  let p = (data || []).length === 1 ? data[0] : null;
  if(!p){ const res = await balBuscar(t); if(res.length === 1) p = res[0]; else { balMostrarLista(res); return; } }
  balAddItem(p);
}
function balMostrarLista(res){
  const lista = $("bal-item-res"); if(!lista) return;
  lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}${p.controle_reposicao ? " · reposição" : ""}</span></div>`).join("")
    : `<div class="resultado-item vazio">Nenhum produto com esse código ou nome.</div>`;
  lista.style.display = "";
  lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => balAddItem(res.find(x => x.id === d.dataset.id))));
}
function balAddItem(p){
  if(!p) return;
  const ja = _balItens.find(i => i.p.id === p.id);
  if(ja) ja.quantidade = Number(ja.quantidade || 0) + 1; else _balItens.push({ p, quantidade: 1, observacoes: "" });
  const inp = $("bal-item"); inp.value = ""; $("bal-item-res").style.display = "none"; inp.focus();
  renderBalItens();
  estSugerirCentro(p.id);   // fase 76 → 100: destino vazio recebe o setor da última compra do item
}
function renderBalItens(){
  const tb = $("bal-itens"); if(!tb) return;
  $("bal-contador").textContent = _balItens.length ? `${_balItens.length} item(ns)` : "";
  balAtualizarDestinoAloc();   // fase 108c: EPI entrou ou saiu da lista
  if(!_balItens.length){ tb.innerHTML = `<tr><td colspan="6" class="vazio">Nenhum item. Bipe ou busque acima.</td></tr>`; return; }
  tb.innerHTML = _balItens.map((it, i) => { const saldo = Number(it.p.estoque_atual || 0), falta = Number(it.quantidade || 0) > saldo;
    return `<tr data-i="${i}" class="${falta && it.p.controle_reposicao ? "est-rep-critico" : ""}">
      <td><strong>${esc(it.p.codigo)}</strong></td><td>${esc(it.p.nome)}${balEhEpi(it.p) ? (it.p.categoria_custo === "uniforme" ? ' <span class="tag cinza" title="uniforme: exige quem retira e entra na ficha do colaborador">uniforme</span>' : ' <span class="tag azul" title="EPI: exige quem retira e entra na ficha de EPI do colaborador">EPI</span>') : ""}</td>
      <td class="num">${num(saldo)} <span class="meta">${esc(it.p.unidade || "un")}</span>${falta ? `<div class="meta ${it.p.controle_reposicao ? "txt-perigo" : ""}">${it.p.controle_reposicao ? "saldo insuficiente" : "vai ficar negativo"}</div>` : ""}</td>
      <td><input type="number" class="bal-q" step="0.001" min="0.001" value="${esc(it.quantidade)}" style="width:86px;text-align:right;" /></td>
      <td><input class="bal-o" value="${esc(it.observacoes || "")}" placeholder="opcional" style="width:100%;" /></td>
      <td><button type="button" class="btn-sec btn-sm bal-rem" title="tirar">×</button></td></tr>`; }).join("");
  tb.querySelectorAll(".bal-q").forEach(el => el.addEventListener("change", e => { _balItens[Number(e.target.closest("tr").dataset.i)].quantidade = Number(e.target.value || 0); renderBalItens(); }));
  tb.querySelectorAll(".bal-o").forEach(el => el.addEventListener("input", e => { _balItens[Number(e.target.closest("tr").dataset.i)].observacoes = e.target.value; }));
  tb.querySelectorAll(".bal-rem").forEach(el => el.addEventListener("click", e => { _balItens.splice(Number(e.target.closest("tr").dataset.i), 1); renderBalItens(); }));
}
async function registrarSaidaBalcao(){
  if(!estPodeEditar()){ aviso("app-aviso", "Seu perfil não movimenta estoque.", "erro"); return; }
  // fase 100: quem retira só é obrigatório com EPI na lista (o banco confere de novo)
  const epis = _balItens.filter(i => balEhEpi(i.p));
  if(!_balRetirante && $("bal-retirante").value.trim()){ aviso("app-aviso", "Escolha quem retira na lista de nomes (ou apague o campo).", "erro"); $("bal-retirante").focus(); return; }
  if(!_balRetirante && epis.length){ aviso("app-aviso", `Informe quem retira: ${epis.map(i => i.p.codigo).join(", ")} ${epis.length > 1 ? "são EPI ou uniforme" : "é EPI ou uniforme"} e a entrega vai para a ficha do colaborador.`, "erro"); $("bal-retirante").focus(); return; }
  const dv = $("bal-destino").value;
  if(!dv){ aviso("app-aviso", "Escolha o destino: obra, TAG ou setor.", "erro"); $("bal-destino").focus(); return; }
  if(!_balItens.length){ aviso("app-aviso", "Adicione pelo menos um item.", "erro"); $("bal-item").focus(); return; }
  if(_balItens.some(i => !(Number(i.quantidade) > 0))){ aviso("app-aviso", "Há item sem quantidade.", "erro"); return; }
  const destino = dv.startsWith("obra:") ? { obra_id: dv.slice(5) } : dv.startsWith("eq:") ? { equipamento_id: dv.slice(3) } : { centro_custo_id: dv.slice(3) };
  const met = $("bal-metodo")?.value || "";
  if(met && destino.obra_id) destino.metodo = met;   // fase 108c: método opcional, só com obra
  const itens = _balItens.slice(), retirante = _balRetirante;
  const { data, error } = await sb.rpc("estoque_saida_registrar", {
    p_retirante_id: retirante ? retirante.id : null, p_destino: destino,
    p_itens: itens.map(i => ({ produto_id: i.p.id, quantidade: Number(i.quantidade), observacoes: i.observacoes || null })),
    p_documento: $("bal-doc").value.trim() || null
  });
  if(error){ aviso("app-aviso", "Saída não registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  const ids = data || [], n = ids.length;
  aviso("app-aviso", `Saída registrada: ${n} item(ns)${retirante ? " para " + retirante.nome : ""} · ${$("bal-destino").selectedOptions[0]?.textContent || ""}.`, "ok");
  _balItens = []; _balRetirante = null; $("bal-retirante").value = ""; $("bal-doc").value = ""; $("bal-destino").value = "";
  _balDestinoOrigem = ""; _balAlocCache = {}; $("bal-destino").querySelector("optgroup[data-aloc]")?.remove(); balAplicarMetodo();   // fase 108c
  renderBalItens();
  // fase 100: EPI entregue a uma pessoa → assinatura do recebimento na tela (o RPC devolve os ids na ordem dos itens)
  const assinar = retirante ? itens.map((it, k) => ({ it, id: ids[k] })).filter(x => x.id && balEhEpi(x.it.p)) : [];
  if(assinar.length && typeof epiAbrirAssinatura === "function"){
    epiAbrirAssinatura({ funcionarioId: retirante.id, funcionarioNome: retirante.nome,
      itens: assinar.map(x => ({ id: x.id, descricao: `${num(x.it.quantidade)} ${x.it.p.unidade || "un"} · ${x.it.p.codigo} — ${x.it.p.nome}` })),
      aoConcluir: () => carregarSaidasHoje() });
  }
  if(typeof carregarProdutos === "function") carregarProdutos();
  await Promise.all([carregarSaidasHoje(), carregarReposicao(), carregarUltimasEntradas()]);
}
async function carregarSaidasHoje(){
  const cont = $("bal-hoje"); if(!cont) return;
  const desde = new Date(hojeISO() + "T00:00:00").toISOString();
  const COLS = "id,quantidade,custo_unitario,obra_id,equipamento_id,centro_custo_id,documento,observacoes,categoria_custo,created_at,registrado_por,produto:produtos(codigo,nome,unidade,categoria_custo),retirante:funcionarios!movimentacoes_estoque_responsavel_id_fkey(nome)";
  const saidas = cols => sb.from("movimentacoes_estoque").select(cols).eq("tipo", "saida").gte("created_at", desde).order("created_at", { ascending: false }).limit(300);
  const semColuna = r => r.error && ["42703", "PGRST204"].includes(r.error.code);
  let [sa, es] = await Promise.all([
    saidas(COLS + ",funcionario_id,assinatura_em,corrige_de"),   // fase 100: quem recebeu e assinatura do EPI; lote S52: correção
    sb.from("movimentacoes_estoque").select("estorno_de").not("estorno_de", "is", null).gte("created_at", desde)
  ]);
  if(semColuna(sa)) sa = await saidas(COLS + ",funcionario_id,assinatura_em");   // migration do lote S52 ainda não aplicada
  if(semColuna(sa)) sa = await saidas(COLS);   // migration da fase 100 ainda não aplicada
  if(sa.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(sa.error.message)}</p>`; return; }
  const estornadas = new Set((es.data || []).map(e => e.estorno_de));
  const corrigidas = new Set((sa.data || []).map(m => m.corrige_de).filter(Boolean));   // lote S52 (#167): original de uma correção de hoje
  _balHoje = (sa.data || []).map(m => ({ ...m, estornada: estornadas.has(m.id), corrigida: corrigidas.has(m.id) }));
  if(_balEdit && !_balHoje.some(m => m.id === _balEdit)) _balEdit = null;
  renderSaidasHoje();
}
/* lote S52 (#167, Julio): "✎ Editar" a saída em até 10 min, nas mesmas condições do Desfazer (e não para EPI já assinado).
   Troca a linha por quantidade, destino (as opções do balcão, sem o grupo da alocação), documento e observação; Salvar chama
   estoque_saida_corrigir (estorno da original + saída nova com corrige_de). Retirante não muda: para trocar quem retirou,
   desfazer e lançar de novo. */
let _balEdit = null;   // id da saída em edição na lista de hoje
function balDestinoValor(m){ return m.obra_id ? "obra:" + m.obra_id : m.equipamento_id ? "eq:" + m.equipamento_id : m.centro_custo_id ? "cc:" + m.centro_custo_id : ""; }
function balDestinoOptions(atual, rotuloAtual){
  const sel = $("bal-destino"); if(!sel) return "";
  const clone = sel.cloneNode(true);
  clone.querySelector("optgroup[data-aloc]")?.remove();
  if(atual && ![...clone.options].some(o => o.value === atual)){   // obra fora de "em andamento": entra para não perder o destino atual
    const o = document.createElement("option"); o.value = atual; o.textContent = rotuloAtual || "destino atual";
    clone.insertBefore(o, clone.children[1] || null);
  }
  [...clone.options].forEach(o => { if(o.value === atual) o.setAttribute("selected", ""); else o.removeAttribute("selected"); });   // atributo: innerHTML não leva a propriedade
  return clone.innerHTML;
}
function balEditarHTML(m){
  const atual = balDestinoValor(m);
  return `<td colspan="6">
      <div class="grade grade-3" style="margin:2px 0;">
        <div class="campo"><label>Item</label><div><strong>${esc(m.produto?.codigo || "")}</strong> — ${esc(m.produto?.nome || "")}${m.retirante?.nome ? ` <span class="meta">· retirante ${esc(m.retirante.nome)} (não muda)</span>` : ""}</div></div>
        <div class="campo"><label>Quantidade <span class="meta">(${esc(m.produto?.unidade || "un")})</span></label><input type="number" id="bal-ed-qtd" step="0.001" min="0.001" value="${esc(Math.abs(m.quantidade || 0))}" style="width:110px;text-align:right;" /></div>
        <div class="campo"><label>Destino</label><select id="bal-ed-destino">${balDestinoOptions(atual, balDestinoTxt(m))}</select></div>
        <div class="campo"><label>Documento</label><input id="bal-ed-doc" value="${esc(m.documento || "")}" placeholder="Saída no balcão" /></div>
        <div class="campo largo"><label>Observação</label><input id="bal-ed-obs" value="${esc(m.observacoes || "")}" placeholder="opcional" /></div>
      </div></td>
    <td><button type="button" class="btn btn-sm bal-ed-salvar" data-id="${esc(m.id)}">💾 Salvar</button> <button type="button" class="btn-sec btn-sm bal-ed-cancelar">Cancelar</button></td>`;
}
async function balSalvarEdicao(id){
  const m = _balHoje.find(x => x.id === id); if(!m) return;
  const qtd = Number($("bal-ed-qtd")?.value || 0);
  if(!(qtd > 0)){ aviso("app-aviso", "Informe a quantidade.", "erro"); $("bal-ed-qtd")?.focus(); return; }
  const dv = $("bal-ed-destino")?.value || "";
  if(!dv){ aviso("app-aviso", "Escolha o destino: obra, TAG ou setor.", "erro"); $("bal-ed-destino")?.focus(); return; }
  const destino = dv.startsWith("obra:") ? { obra_id: dv.slice(5) } : dv.startsWith("eq:") ? { equipamento_id: dv.slice(3) } : { centro_custo_id: dv.slice(3) };
  const { error } = await sb.rpc("estoque_saida_corrigir", { p_id: id, p_quantidade: qtd, p_destino: destino,
    p_documento: ($("bal-ed-doc")?.value || "").trim(), p_observacoes: ($("bal-ed-obs")?.value || "").trim() });
  if(error){ aviso("app-aviso", "Não foi possível corrigir: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  _balEdit = null;
  aviso("app-aviso", "Saída corrigida: a original ficou estornada e a nova vale no estoque e no custo.", "ok");
  if(typeof carregarProdutos === "function") carregarProdutos();
  await Promise.all([carregarSaidasHoje(), carregarReposicao(), carregarUltimasEntradas()]);
}
function renderSaidasHoje(){
  const cont = $("bal-hoje"); if(!cont) return;
  const valendo = _balHoje.filter(m => !m.estornada);
  $("bal-hoje-contador").textContent = _balHoje.length ? `${valendo.length} · ${brl(valendo.reduce((s, m) => s + Number(m.quantidade || 0) * Number(m.custo_unitario || 0), 0))}` : "";
  if(!_balHoje.length){ cont.innerHTML = `<p class="vazio">Nenhuma saída hoje.</p>`; return; }
  const admin = !!usuarioAtual && ["admin","diretor"].includes(usuarioAtual.cargo);
  const hora = m => new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  // fase 100: EPI entregue a uma pessoa sem assinatura ainda → botão "assinar" (a mesma tela de assinatura do balcão).
  // Lote S52: assinado não se edita (desfazer e lançar de novo, colhendo nova assinatura).
  const assinaTag = m => (m.estornada || !balMovEhEpi(m) || !m.funcionario_id) ? ""
    : m.assinatura_em ? ' <span class="tag verde" title="recebimento assinado · para corrigir, desfaça e lance de novo, colhendo nova assinatura">assinado</span>'
    : ` <button type="button" class="btn-sec btn-sm bal-assinar" data-id="${esc(m.id)}" title="colher a assinatura do recebimento">✍ assinar</button>`;
  // lote S52: a original riscada diz "corrigida"; a nova, "correção" apontando para a hora da original
  const marca = m => {
    if(m.estornada) return `<span class="tag cinza">${m.corrigida ? "corrigida" : "desfeita"}</span>`;
    if(!m.corrige_de) return "";
    const o = _balHoje.find(x => x.id === m.corrige_de);
    return ` <span class="tag azul" title="corrige a saída das ${o ? hora(o) : "—"}">correção</span>`;
  };
  cont.innerHTML = `<div class="tabela-rola"><table><thead><tr><th>Hora</th><th>Retirante</th><th>Item</th><th class="num">Qtd</th><th class="num">Custo</th><th>Destino</th><th>Documento / obs.</th><th></th></tr></thead>
    <tbody>${_balHoje.map(m => { const min = (Date.now() - new Date(m.created_at).getTime()) / 60000;
      const podeDesfazer = !m.estornada && min < 10 && (m.registrado_por === usuarioAtual?.id || admin);
      const podeEditar = podeDesfazer && !m.assinatura_em;
      if(_balEdit === m.id && podeEditar) return `<tr><td>${hora(m)}</td>${balEditarHTML(m)}</tr>`;
      return `<tr${m.estornada ? ' class="meta" style="text-decoration:line-through;"' : ""}>
        <td>${hora(m)}</td><td>${esc(m.retirante?.nome || "—")}</td>
        <td>${esc(m.produto ? m.produto.codigo + " — " + m.produto.nome : "—")}${balMovEhEpi(m) ? (m.categoria_custo === "uniforme" ? ' <span class="tag cinza">uniforme</span>' : ' <span class="tag azul">EPI</span>') : ""}${assinaTag(m)}${m.estornada ? "" : marca(m)}</td>
        <td class="num">${num(Math.abs(m.quantidade || 0))} <span class="meta">${esc(m.produto?.unidade || "")}</span></td>
        <td class="num">${brl(Math.abs(Number(m.quantidade || 0)) * Number(m.custo_unitario || 0))}</td>
        <td>${esc(balDestinoTxt(m))}</td><td class="meta">${esc([m.documento, m.observacoes].filter(Boolean).join(" · "))}</td>
        <td style="white-space:nowrap;">${m.estornada ? marca(m) : podeDesfazer ? `${podeEditar ? `<button type="button" class="btn-sec btn-sm bal-editar" data-id="${esc(m.id)}" title="corrigir quantidade, destino, documento ou observação (até 10 min)">✎ Editar</button> ` : ""}<button type="button" class="btn-sec btn-sm bal-desfazer" data-id="${esc(m.id)}" title="desfazer (até 10 min)">↩ Desfazer</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll(".bal-editar").forEach(b => b.addEventListener("click", () => { _balEdit = b.dataset.id; renderSaidasHoje(); $("bal-ed-qtd")?.focus(); }));
  cont.querySelectorAll(".bal-ed-cancelar").forEach(b => b.addEventListener("click", () => { _balEdit = null; renderSaidasHoje(); }));
  cont.querySelectorAll(".bal-ed-salvar").forEach(b => b.addEventListener("click", () => comBotaoTravado(b, () => balSalvarEdicao(b.dataset.id))));
  cont.querySelectorAll(".bal-assinar").forEach(b => b.addEventListener("click", () => {
    const m = _balHoje.find(x => x.id === b.dataset.id); if(!m || typeof epiAbrirAssinatura !== "function") return;
    // junta as entregas de EPI do mesmo colaborador ainda sem assinatura (uma assinatura para o lote do dia)
    const lote = _balHoje.filter(x => !x.estornada && x.funcionario_id === m.funcionario_id && balMovEhEpi(x) && !x.assinatura_em);
    epiAbrirAssinatura({ funcionarioId: m.funcionario_id, funcionarioNome: m.retirante?.nome,
      itens: lote.map(x => ({ id: x.id, descricao: `${num(Math.abs(x.quantidade || 0))} ${x.produto?.unidade || ""} · ${x.produto?.codigo} — ${x.produto?.nome}` })),
      aoConcluir: () => carregarSaidasHoje() });
  }));
  cont.querySelectorAll(".bal-desfazer").forEach(b => b.addEventListener("click", () => comBotaoTravado(b, async () => {
    if(!confirm("Desfazer esta saída? O material volta ao estoque e o custo sai do destino.")) return;
    const { error } = await sb.rpc("estoque_saida_desfazer", { p_id: b.dataset.id });
    if(error){ aviso("app-aviso", "Não foi possível desfazer: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
    aviso("app-aviso", "Saída desfeita: material de volta ao estoque.", "ok");
    if(typeof carregarProdutos === "function") carregarProdutos();
    await Promise.all([carregarSaidasHoje(), carregarReposicao(), carregarUltimasEntradas()]);
  })));
}
/* ---------- Devolução de obra (fase 83) ----------
   Material que volta da obra entra como `devolucao` com origem obra (RPC estoque_devolucao_registrar): soma ao
   estoque e o custo sai da obra em vw_custos. "Ver o que foi para a obra" lista as saídas dos últimos 180 dias
   menos o que já voltou, para não digitar de novo. Vale para obra em qualquer status (a devolução costuma
   vir da obra concluída). */
let _devItens = [], _devQuem = null, _devObras = null;
async function devAbrir(){
  const b = $("est-dev-body"); if(!b) return;
  const abre = b.style.display === "none"; b.style.display = abre ? "" : "none";
  $("btn-est-dev-toggle").textContent = abre ? "▾ fechar" : "▸ registrar devolução";
  if(abre && !_devObras){
    const { data } = await sb.from("obras").select("id,codigo,nome,status").order("codigo", { ascending: false });
    _devObras = data || [];
    $("est-dev-obra").innerHTML = `<option value="">— obra —</option>` + _devObras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}${o.status && o.status !== "em_andamento" ? " (" + esc(String(o.status).replace(/_/g, " ")) + ")" : ""}</option>`).join("");
  }
  if(abre) $("est-dev-obra").focus();
}
function devMostrarLista(res){
  const lista = $("est-dev-item-res"); if(!lista) return;
  lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}</span></div>`).join("")
    : `<div class="resultado-item vazio">Nenhum produto com esse código ou nome.</div>`;
  lista.style.display = "";
  lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => devAddItem(res.find(x => x.id === d.dataset.id))));
}
function devAddItem(p, qtd){
  if(!p) return;
  const ja = _devItens.find(i => i.p.id === p.id);
  if(ja) ja.quantidade = Number(ja.quantidade || 0) + Number(qtd || 1); else _devItens.push({ p, quantidade: Number(qtd || 1), observacoes: "" });
  const inp = $("est-dev-item"); if(inp){ inp.value = ""; $("est-dev-item-res").style.display = "none"; }
  renderDevItens();
}
function renderDevItens(){
  const tb = $("est-dev-itens"); if(!tb) return;
  $("est-dev-contador").textContent = _devItens.length ? `${_devItens.length} item(ns)` : "";
  if(!_devItens.length){ tb.innerHTML = `<tr><td colspan="6" class="vazio">Nenhum item. Bipe, busque acima ou use "Ver o que foi para a obra".</td></tr>`; return; }
  tb.innerHTML = _devItens.map((it, i) => `<tr data-i="${i}">
      <td><strong>${esc(it.p.codigo)}</strong></td><td>${esc(it.p.nome)}</td>
      <td class="num">${num(it.p.estoque_atual || 0)} <span class="meta">${esc(it.p.unidade || "un")}</span></td>
      <td><input type="number" class="dev-q" step="0.001" min="0.001" value="${esc(it.quantidade)}" style="width:86px;text-align:right;" /></td>
      <td><input class="dev-o" value="${esc(it.observacoes || "")}" placeholder="opcional" style="width:100%;" /></td>
      <td><button type="button" class="btn-sec btn-sm dev-rem" title="tirar">×</button></td></tr>`).join("");
  tb.querySelectorAll(".dev-q").forEach(el => el.addEventListener("change", e => { _devItens[Number(e.target.closest("tr").dataset.i)].quantidade = Number(e.target.value || 0); }));
  tb.querySelectorAll(".dev-o").forEach(el => el.addEventListener("input", e => { _devItens[Number(e.target.closest("tr").dataset.i)].observacoes = e.target.value; }));
  tb.querySelectorAll(".dev-rem").forEach(el => el.addEventListener("click", e => { _devItens.splice(Number(e.target.closest("tr").dataset.i), 1); renderDevItens(); }));
}
/* saídas para a obra nos últimos 180 dias, menos o que já voltou (devoluções, inclusive estornos do balcão) */
async function devVerSaidas(){
  const obra = $("est-dev-obra").value, box = $("est-dev-saidas");
  if(!obra){ aviso("app-aviso", "Escolha a obra.", "erro"); $("est-dev-obra").focus(); return; }
  const desde = dataLocalISO(new Date(Date.now() - 180 * 864e5));
  const { data, error } = await sb.from("movimentacoes_estoque").select("produto_id,tipo,quantidade,produto:produtos(" + BAL_COLS + ")")
    .eq("obra_id", obra).in("tipo", ["saida", "devolucao"]).gte("created_at", desde + "T00:00:00").limit(3000);
  box.style.display = "";
  if(error){ box.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  const por = {};
  (data || []).forEach(m => { const o = por[m.produto_id] || (por[m.produto_id] = { p: m.produto, enviado: 0, voltou: 0 }); o[m.tipo === "saida" ? "enviado" : "voltou"] += Math.abs(Number(m.quantidade || 0)); });
  const lista = Object.values(por).filter(o => o.p && o.enviado - o.voltou > 0).sort((a, b) => String(a.p.nome).localeCompare(String(b.p.nome), "pt-BR"));
  box.innerHTML = lista.length ? `<p class="meta">Foi para a obra nos últimos 180 dias e ainda não voltou (saídas menos devoluções): clique para devolver.</p><div class="tabela-rola"><table class="itens-tabela"><thead><tr><th>Código</th><th>Item</th><th class="num">Enviado</th><th class="num">Voltou</th><th class="num">Em obra</th><th class="col-acao"></th></tr></thead>
    <tbody>${lista.map((o, i) => `<tr><td><strong>${esc(o.p.codigo)}</strong></td><td>${esc(o.p.nome)}</td><td class="num">${num(o.enviado)}</td><td class="num">${num(o.voltou)}</td><td class="num">${num(o.enviado - o.voltou)} <span class="meta">${esc(o.p.unidade || "un")}</span></td><td><button type="button" class="btn-sec btn-sm dev-sai-add" data-i="${i}">+ devolver</button></td></tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Nenhuma saída de estoque registrada para esta obra nos últimos 180 dias (ou tudo já voltou).</p>`;
  box.querySelectorAll(".dev-sai-add").forEach(b => b.addEventListener("click", () => { const o = lista[Number(b.dataset.i)]; devAddItem(o.p, o.enviado - o.voltou); }));
}
async function registrarDevolucaoObra(){
  if(!estPodeEditar()){ aviso("app-aviso", "Seu perfil não movimenta estoque.", "erro"); return; }
  const obra = $("est-dev-obra").value;
  if(!obra){ aviso("app-aviso", "Escolha a obra de onde o material voltou.", "erro"); $("est-dev-obra").focus(); return; }
  if(!_devItens.length){ aviso("app-aviso", "Adicione pelo menos um item.", "erro"); $("est-dev-item").focus(); return; }
  if(_devItens.some(i => !(Number(i.quantidade) > 0))){ aviso("app-aviso", "Há item sem quantidade.", "erro"); return; }
  const { data, error } = await sb.rpc("estoque_devolucao_registrar", {
    p_obra_id: obra, p_quem_trouxe: _devQuem ? _devQuem.id : null,
    p_itens: _devItens.map(i => ({ produto_id: i.p.id, quantidade: Number(i.quantidade), observacoes: i.observacoes || null }))
  });
  if(error){ aviso("app-aviso", "Devolução não registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", `Devolução registrada: ${(data || []).length} item(ns) de volta ao estoque${_devQuem ? " (trouxe " + _devQuem.nome + ")" : ""}.`, "ok");
  _devItens = []; _devQuem = null; $("est-dev-quem").value = ""; $("est-dev-saidas").style.display = "none";
  renderDevItens();
  if($("sec-produtos")?.classList.contains("ativa") && typeof carregarProdutos === "function") carregarProdutos();
  await Promise.all([carregarReposicao(), carregarUltimasEntradas()]);
}
function devLigar(){
  const inp = $("est-dev-quem"), lista = $("est-dev-quem-res"); if(!inp || !lista) return;
  inp.addEventListener("input", debounce(async () => {
    _devQuem = null;
    const q = semAcentoBal(inp.value.trim()); if(q.length < 2){ lista.style.display = "none"; return; }
    const fs = (await balCarregarFuncionarios()).filter(f => semAcentoBal(`${f.nome} ${f.matricula || ""}`).includes(q)).slice(0, 15);
    lista.innerHTML = fs.length ? fs.map(f => `<div class="resultado-item" data-id="${esc(f.id)}"><strong>${esc(f.nome)}</strong> <span class="meta">${esc(f.funcao || "")}</span></div>`).join("")
      : `<div class="resultado-item vazio">Nenhum funcionário ativo com esse nome.</div>`;
    lista.style.display = "";
    lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => { _devQuem = fs.find(f => f.id === d.dataset.id) || null; inp.value = _devQuem ? _devQuem.nome : ""; lista.style.display = "none"; $("est-dev-item")?.focus(); }));
  }, 200));
  inp.addEventListener("blur", () => setTimeout(() => { lista.style.display = "none"; }, 200));
  $("btn-est-dev-toggle")?.addEventListener("click", devAbrir);
  $("est-dev-item")?.addEventListener("keydown", async e => {
    if(e.key !== "Enter") return; e.preventDefault();
    const t = $("est-dev-item").value.trim(); if(!t) return;
    const res = await balBuscar(t), exato = res.filter(p => p.codigo === t || p.codigo_barras === t);
    const p = exato.length === 1 ? exato[0] : res.length === 1 ? res[0] : null;
    if(p) devAddItem(p); else devMostrarLista(res);
  });
  $("est-dev-item")?.addEventListener("input", debounce(async () => { const t = $("est-dev-item").value.trim(); if(t.length < 2){ $("est-dev-item-res").style.display = "none"; return; } devMostrarLista(await balBuscar(t)); }, 250));
  $("est-dev-item")?.addEventListener("blur", () => setTimeout(() => { if($("est-dev-item-res")) $("est-dev-item-res").style.display = "none"; }, 200));
  $("btn-est-dev-saidas")?.addEventListener("click", () => comBotaoTravado("btn-est-dev-saidas", devVerSaidas));
  $("btn-est-dev-registrar")?.addEventListener("click", () => comBotaoTravado("btn-est-dev-registrar", registrarDevolucaoObra));
}
/* compat: core.js (carga inicial) e fornecedores.js chamam carregarFornecedores() — só o select */
async function carregarFornecedores(){
  const sel = $("ent-fornecedor"); if(!sel) return;
  const { data } = await sb.from("fornecedores").select("id,razao_social").eq("ativo", true).order("razao_social");
  sel.innerHTML = '<option value="">— não informado —</option>' + (data || []).map(f => `<option value="${esc(f.id)}">${esc(f.razao_social)}</option>`).join("");
}

/* ---------- formulário de movimento ---------- */
function estAplicarTipo(){
  document.querySelectorAll("#est-tipos .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.tipo === _estTipo));
  $("est-tipo-ajuda").textContent = EST_AJUDA[_estTipo] || "";
  document.querySelectorAll(".est-so-entrada").forEach(el => el.style.display = _estTipo === "entrada" ? "" : "none");
  $("est-qtd-label").textContent = _estTipo === "ajuste" ? "Quantidade contada *" : "Quantidade *";
  $("btn-registrar-entrada").textContent = _estTipo === "entrada" ? "💾 Registrar entrada" : "💾 Lançar contagem";
  estMostrarProdInfo();
}
function estMostrarProdInfo(){
  const el = $("est-prod-info"); if(!el) return;
  if(!_estProd){ el.textContent = ""; return; }
  const p = _estProd;
  el.innerHTML = `<strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} · estoque atual <strong>${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}</strong>` +
    (p.custo_ultimo ? ` · último custo ${brl(p.custo_ultimo)}` : "") +
    (p.controle_reposicao ? ` · <span class="tag azul">reposição</span> mín. ${num(p.estoque_minimo || 0)} · ideal ${p.estoque_ideal != null ? num(p.estoque_ideal) : "—"}` : "") +
    estChipOdoo(p) +
    (_estTipo === "ajuste" ? ` · <span class="meta">a contagem substitui o atual</span>` : "");
}
async function estBuscarProdutos(termo){
  if(!termo || termo.length < 2) return [];
  const t = termo.replace(/[%,()]/g, " ").trim();
  const { data } = await sb.from("produtos")
    .select("id,codigo,nome,unidade,estoque_atual,estoque_minimo,estoque_ideal,controle_reposicao,custo_ultimo,odoo_saldo_em")
    .eq("ativo", true).eq("tipo_item", "produto").or(`nome.ilike.%${t}%,codigo.ilike.%${t}%`).order("nome").limit(25);
  return data || [];
}
function estLigarBuscaProduto(inpId, listaId, aoEscolher){
  const inp = $(inpId), lista = $(listaId); if(!inp || !lista) return;
  let t = null;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = inp.value.trim();
      if(termo.length < 2){ lista.innerHTML = ""; lista.style.display = "none"; return; }
      const res = await estBuscarProdutos(termo);
      lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <span class="meta" style="float:right;">${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}${p.controle_reposicao ? " · reposição" : ""}</span></div>`).join("")
        : `<div class="resultado-item vazio">Nenhum produto encontrado. Cadastre em Produtos.</div>`;
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => {
        const p = res.find(x => x.id === d.dataset.id);
        inp.value = estProdTxt(p); lista.innerHTML = ""; lista.style.display = "none";
        aoEscolher(p);
      }));
    }, 250);
  });
}
function estSelecionarProduto(p){
  _estProd = p || null;
  const sel = $("ent-produto");
  if(sel){ sel.innerHTML = p ? `<option value="${esc(p.id)}" selected>${esc(estProdTxt(p))}</option>` : ""; }
  estMostrarProdInfo();
}
/* fase 76 → 100: na saída, sugere o setor / obra interna que pediu a última compra do item (editável); desde a fase
   100 vale para o destino da "Saída de material", quando ainda está vazio */
async function estSugerirCentro(produtoId){
  const sel = $("bal-destino"); if(!sel || sel.value) return;
  const { data } = await sb.from("pedido_compra_itens").select("centro_custo_id").eq("produto_id", produtoId).not("centro_custo_id", "is", null).order("created_at", { ascending: false }).limit(1);
  const c = data && data[0] && data[0].centro_custo_id;
  if(c && !sel.value && [...sel.options].some(o => o.value === "cc:" + c)){ sel.value = "cc:" + c; _balDestinoOrigem = "sugestao"; balAplicarMetodo(); }
}
/* atalho da Reposição: prepara o formulário para o item; saída vai para a "Saída de material" (fase 100, #97) */
function estPrepararMovimento(tipo, p){
  if(tipo === "saida"){
    balAddItem(p);
    $("bal-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  _estTipo = tipo; estAplicarTipo();
  $("est-busca-prod").value = estProdTxt(p); estSelecionarProduto(p);
  $("ent-qtd").value = tipo === "ajuste" ? (p.estoque_atual ?? "") : "";
  $("ent-qtd").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function registrarEntrada(){
  if(!estPodeEditar()){ aviso("app-aviso", "Seu perfil não movimenta estoque.", "erro"); return; }
  if(!_estProd){ aviso("app-aviso", "Escolha um produto.", "erro"); $("est-busca-prod").focus(); return; }
  const qtdInformada = Number($("ent-qtd").value);
  if($("ent-qtd").value === "" || isNaN(qtdInformada) || qtdInformada < 0){ aviso("app-aviso", "Informe a quantidade.", "erro"); return; }
  const reg = {
    produto_id: _estProd.id, tipo: _estTipo, quantidade: qtdInformada,
    custo_unitario: 0, fornecedor_id: null, obra_id: null, equipamento_id: null,
    documento: $("ent-doc").value.trim() || null, observacoes: $("est-mov-obs").value.trim() || null
  };
  if(_estTipo === "entrada"){
    if(qtdInformada <= 0){ aviso("app-aviso", "Informe a quantidade.", "erro"); return; }
    reg.custo_unitario = Number($("ent-custo").value);
    if(!(reg.custo_unitario >= 0) || $("ent-custo").value === ""){ aviso("app-aviso", "Informe o custo unitário.", "erro"); return; }
    reg.fornecedor_id = $("ent-fornecedor").value || null;
  } else { // ajuste: delta = contado - atual (fase 100: saída só pela "Saída de material")
    const delta = qtdInformada - Number(_estProd.estoque_atual || 0);
    if(delta === 0){ aviso("app-aviso", "A contagem é igual ao estoque atual. Nada a lançar.", "ok"); return; }
    reg.quantidade = delta;
    reg.documento = reg.documento || "Inventário";
    reg.observacoes = [`Contagem: ${num(qtdInformada)} (antes ${num(_estProd.estoque_atual || 0)})`, reg.observacoes].filter(Boolean).join(" · ");
  }
  const { error } = await sb.from("movimentacoes_estoque").insert(reg);
  if(error){ aviso("app-aviso", "Não foi possível registrar: " + error.message, "erro"); return; }
  aviso("app-aviso", _estTipo === "entrada" ? "Entrada registrada — estoque e custo atualizados." : "Contagem lançada — estoque ajustado.", "ok");
  ["ent-qtd","ent-custo","ent-doc","est-mov-obs","est-busca-prod"].forEach(id => { const el = $(id); if(el) el.value = ""; });
  estSelecionarProduto(null);
  if(typeof carregarProdutos === "function") await carregarProdutos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  await Promise.all([carregarReposicao(), carregarUltimasEntradas()]);
}

async function criarNovoFornecedorRapido(){
  const nome = prompt("Razão social do novo fornecedor:");
  if(!nome) return;
  const { error } = await sb.from("fornecedores").insert({ razao_social: nome.trim() });
  if(error){ aviso("app-aviso", "Erro ao criar fornecedor: " + error.message, "erro"); return; }
  _estCarregado = false; await carregarEstoque(true);
  aviso("app-aviso", "Fornecedor criado.", "ok");
}

/* ---------- Reposição ---------- */
function estAComprar(p){
  const alvo = p.estoque_ideal != null ? Number(p.estoque_ideal) : Number(p.estoque_minimo || 0);
  return Math.max(0, alvo - Number(p.estoque_atual || 0));
}
function estSituacao(p){
  const atual = Number(p.estoque_atual || 0), min = Number(p.estoque_minimo || 0), ideal = p.estoque_ideal != null ? Number(p.estoque_ideal) : null;
  if(atual <= 0 && (ideal > 0 || min > 0)) return ["zerado", "vermelho"];
  if(min > 0 && atual <= min) return ["abaixo do mínimo", "vermelho"];
  if(ideal != null && atual < ideal) return ["abaixo do ideal", "ambar"];
  return ["ok", "verde"];
}
async function carregarReposicao(){
  const cont = $("est-reposicao"); if(!cont) return;
  const { data, error } = await sb.from("produtos")
    .select("id,codigo,nome,unidade,estoque_atual,estoque_minimo,estoque_ideal,controle_reposicao,custo_ultimo,localizacao,odoo_saldo_em,codigo_barras,categoria_custo,categoria:categorias_produto(nome)")
    .eq("controle_reposicao", true).eq("ativo", true).eq("tipo_item", "produto").order("nome");   // lote S55 (#175): serviço nunca entra na reposição
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  _estRep = data || [];
  renderReposicao();
}
function estRepFiltrados(){
  const q = ($("est-rep-busca")?.value || "").trim().toLowerCase();
  const soFalta = !!$("est-rep-so-falta")?.checked;
  return _estRep.filter(p => (!q || `${p.codigo} ${p.nome}`.toLowerCase().includes(q)) && (!soFalta || estAComprar(p) > 0));
}
function renderReposicao(){
  const cont = $("est-reposicao"); if(!cont) return;
  const lista = estRepFiltrados();
  const falta = _estRep.filter(p => estAComprar(p) > 0).length;
  $("est-rep-contador").textContent = `${_estRep.length} item(ns) · ${falta} a repor`;
  if(!_estRep.length){ cont.innerHTML = `<p class="vazio">Nenhum item controlado. Use <em>+ Controlar item</em> ou marque "Controlar na lista de reposição" na ficha do produto.</p>`; return; }
  if(!lista.length){ cont.innerHTML = `<p class="vazio">Nada com esse filtro.</p>`; return; }
  const pode = estPodeEditar();
  cont.innerHTML = `<div class="tabela-rola"><table class="est-rep-tabela">
    <thead><tr><th>Código</th><th>Item</th><th class="num">Atual</th><th class="num">Mínimo</th><th class="num">Ideal</th><th class="num">A comprar</th><th>Situação</th>${pode ? "<th></th>" : ""}</tr></thead>
    <tbody>${lista.map(p => { const [sit, cor] = estSituacao(p); const ac = estAComprar(p); return `<tr class="${cor === "vermelho" ? "est-rep-critico" : ""}" data-id="${esc(p.id)}">
      <td><strong>${esc(p.codigo)}</strong></td>
      <td>${esc(p.nome)}${p.localizacao ? ` <span class="meta">· ${esc(p.localizacao)}</span>` : ""}${estChipOdoo(p)}</td>
      <td class="num"><strong>${num(p.estoque_atual || 0)}</strong> <span class="meta">${esc(p.unidade || "un")}</span></td>
      <td class="num">${pode ? `<input type="number" class="est-rep-min" data-id="${esc(p.id)}" value="${esc(p.estoque_minimo ?? 0)}" min="0" step="1" style="width:64px;text-align:right;" />` : num(p.estoque_minimo || 0)}</td>
      <td class="num">${pode ? `<input type="number" class="est-rep-ideal" data-id="${esc(p.id)}" value="${esc(p.estoque_ideal ?? "")}" min="0" step="1" style="width:64px;text-align:right;" />` : (p.estoque_ideal != null ? num(p.estoque_ideal) : "—")}</td>
      <td class="num">${ac > 0 ? `<strong>${num(ac)}</strong>` : "—"}</td>
      <td><span class="tag ${esc(cor)}">${esc(sit)}</span></td>
      ${pode ? `<td style="white-space:nowrap;"><button type="button" class="btn-sec btn-sm" data-mov="entrada" data-id="${esc(p.id)}" title="registrar entrada">＋</button> <button type="button" class="btn-sec btn-sm" data-mov="saida" data-id="${esc(p.id)}" title="registrar saída">－</button> <button type="button" class="btn-sec btn-sm" data-mov="ajuste" data-id="${esc(p.id)}" title="lançar contagem">📋</button> <button type="button" class="btn-sec btn-sm" data-mov="tirar" data-id="${esc(p.id)}" title="tirar da lista de reposição">✕</button></td>` : ""}
    </tr>`; }).join("")}</tbody></table></div>`;
  cont.querySelectorAll(".est-rep-min, .est-rep-ideal").forEach(inp => inp.addEventListener("change", async () => {
    const campo = inp.classList.contains("est-rep-min") ? "estoque_minimo" : "estoque_ideal";
    const v = inp.value === "" ? (campo === "estoque_minimo" ? 0 : null) : Number(inp.value);
    const { error } = await sb.from("produtos").update({ [campo]: v }).eq("id", inp.dataset.id);
    if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
    const p = _estRep.find(x => x.id === inp.dataset.id); if(p) p[campo] = v;
    renderReposicao();
  }));
  cont.querySelectorAll("button[data-mov]").forEach(b => b.addEventListener("click", async () => {
    const p = _estRep.find(x => x.id === b.dataset.id); if(!p) return;
    if(b.dataset.mov === "tirar"){
      if(!confirm(`Tirar ${p.codigo} da lista de reposição? O produto continua no cadastro.`)) return;
      const { error } = await sb.from("produtos").update({ controle_reposicao: false }).eq("id", p.id);
      if(error){ aviso("app-aviso", "Não foi possível: " + error.message, "erro"); return; }
      await carregarReposicao(); return;
    }
    estPrepararMovimento(b.dataset.mov, p);
  }));
}
function estGerarListaCompra(){
  const itens = _estRep.filter(p => estAComprar(p) > 0).map(p => ({
    "Código": p.codigo, "Item": p.nome, "Un": p.unidade || "un", "Estoque atual": Number(p.estoque_atual || 0),
    "Mínimo": Number(p.estoque_minimo || 0), "Ideal": p.estoque_ideal != null ? Number(p.estoque_ideal) : "", "A comprar": estAComprar(p),
    "Último custo": Number(p.custo_ultimo || 0), "Estimativa": Number(((p.custo_ultimo || 0) * estAComprar(p)).toFixed(2))
  }));
  if(!itens.length){ aviso("app-aviso", "Nada a comprar: todos os itens controlados estão no ideal.", "ok"); return; }
  const nome = `lista_compra_${hojeISO()}`;
  if(typeof XLSX !== "undefined"){
    const ws = XLSX.utils.json_to_sheet(itens);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "LISTA DE COMPRA");
    XLSX.writeFile(wb, nome + ".xlsx");
  } else {
    const cab = Object.keys(itens[0]);
    const csv = [cab.join(";"), ...itens.map(i => cab.map(k => String(i[k]).replace(/;/g, ",")).join(";"))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })); a.download = nome + ".csv"; a.click();
  }
  aviso("app-aviso", `Lista de compra gerada: ${itens.length} item(ns), ${brl(itens.reduce((s, i) => s + i["Estimativa"], 0))} estimados pelo último custo.`, "ok");
}

/* modal: controlar item */
function abrirControlarItem(){
  if(!estPodeEditar()) return;
  _estCtrlProd = null;
  $("est-ctrl-busca").value = ""; $("est-ctrl-res").innerHTML = ""; $("est-ctrl-res").style.display = "none";
  $("est-ctrl-info").textContent = "Nenhum produto escolhido.";
  $("est-ctrl-min").value = ""; $("est-ctrl-ideal").value = ""; $("est-ctrl-contagem").value = "";
  $("est-ctrl-modal").style.display = "flex";
}
function fecharControlarItem(){ $("est-ctrl-modal").style.display = "none"; }
async function salvarControlarItem(){
  const p = _estCtrlProd;
  if(!p){ aviso("app-aviso", "Escolha o produto.", "erro"); return; }
  const min = $("est-ctrl-min").value === "" ? 0 : Number($("est-ctrl-min").value);
  const ideal = $("est-ctrl-ideal").value === "" ? null : Number($("est-ctrl-ideal").value);
  const { error } = await sb.from("produtos").update({ controle_reposicao: true, estoque_minimo: min, estoque_ideal: ideal }).eq("id", p.id);
  if(error){ aviso("app-aviso", "Não foi possível controlar o item: " + error.message, "erro"); return; }
  if($("est-ctrl-contagem").value !== ""){
    const delta = Number($("est-ctrl-contagem").value) - Number(p.estoque_atual || 0);
    if(delta !== 0){
      const { error: e2 } = await sb.from("movimentacoes_estoque").insert({ produto_id: p.id, tipo: "ajuste", quantidade: delta, custo_unitario: 0, documento: "Inventário inicial", observacoes: `Contagem: ${num(Number($("est-ctrl-contagem").value))} (antes ${num(p.estoque_atual || 0)})` });
      if(e2) aviso("app-aviso", "Item controlado, mas a contagem não foi lançada: " + e2.message, "erro");
    }
  }
  aviso("app-aviso", `${p.codigo} entrou na lista de reposição.`, "ok");
  fecharControlarItem();
  if(typeof carregarProdutos === "function") carregarProdutos();
  await Promise.all([carregarReposicao(), carregarUltimasEntradas()]);
}

/* ---------- Últimos movimentos ---------- */
async function carregarUltimasEntradas(){
  let q = sb.from("movimentacoes_estoque")
    .select("id,produto_id,tipo,quantidade,custo_unitario,custo_total,fornecedor_id,obra_id,equipamento_id,documento,observacoes,data_movimentacao,produto:produtos(codigo,nome,unidade)")
    .order("data_movimentacao", { ascending: false }).limit(_estHistTipo === "odoo" ? 1000 : 100);
  // fase 81: "Ajustados pelo Odoo hoje" = ajustes da sincronização de hoje
  if(_estHistTipo === "odoo") q = q.eq("tipo", "ajuste").eq("documento", "Odoo sync " + hojeISO());
  else if(_estHistTipo) q = q.eq("tipo", _estHistTipo);
  const { data, error } = await q;
  _estHist = error ? [] : (data || []);
  if(error) console.warn("movimentos de estoque:", error.message);
  renderUltimasEntradas();
}
function renderUltimasEntradas(){
  const cont = $("ent-historico"); if(!cont) return;
  document.querySelectorAll("#est-hist-tipos .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.tipo === _estHistTipo));
  const termo = ($("ent-busca")?.value || "").trim().toLowerCase();
  const obraTxt = id => { const o = _estObras.find(x => x.id === id); return o ? `${o.codigo} — ${o.nome}` : ((typeof mapaObras === "object" && mapaObras && mapaObras[id]) || ""); };
  const eqTxt = id => { const e = _estEquips.find(x => x.id === id); return e ? e.codigo : ""; };
  const prodTxt = m => m.produto ? `${m.produto.codigo} — ${m.produto.nome}` : (_estProdMap[m.produto_id] || "—");
  const filtradas = _estHist.filter(m => {
    if(!termo) return true;
    return [prodTxt(m), mapaFornecedores[m.fornecedor_id], obraTxt(m.obra_id), m.equipamento_id ? "tag " + eqTxt(m.equipamento_id) : "", EST_TIPO_LBL[m.tipo], m.documento, m.observacoes].filter(Boolean).join(" ").toLowerCase().includes(termo);
  });
  if(!filtradas.length){ cont.innerHTML = `<p class="vazio">Nenhum movimento.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th class="num">Qtd</th><th class="num">Custo unit.</th><th>Fornecedor / destino</th><th>Documento</th><th>Obs.</th></tr></thead>
    <tbody>${filtradas.map(m => {
      const d = new Date(m.data_movimentacao);
      const destino = m.tipo === "entrada" ? (mapaFornecedores[m.fornecedor_id] || "—")
        : [m.obra_id ? linkObra(m.obra_id, obraTxt(m.obra_id) || "obra") : "", m.equipamento_id ? "TAG " + esc(eqTxt(m.equipamento_id)) : ""].filter(Boolean).join(" · ") || "—";
      const q = Number(m.quantidade || 0);
      return `<tr>
        <td>${isNaN(d) ? "—" : esc(d.toLocaleDateString("pt-BR"))}</td>
        <td><span class="tag ${esc(EST_TIPO_COR[m.tipo] || "cinza")}">${esc(EST_TIPO_LBL[m.tipo] || m.tipo)}</span></td>
        <td>${esc(prodTxt(m))}</td>
        <td class="num">${m.tipo === "saida" || q < 0 ? "−" : (m.tipo === "ajuste" ? "+" : "")}${num(Math.abs(q))} <span class="meta">${esc(m.produto?.unidade || "")}</span></td>
        <td class="num">${m.custo_unitario ? brl(m.custo_unitario) : "—"}</td>
        <td>${m.tipo === "entrada" ? esc(destino) : esc(destino)}</td>
        <td>${esc(m.documento || "—")}</td>
        <td class="meta">${esc(m.observacoes || "")}</td>
      </tr>`; }).join("")}</tbody></table></div>`;
}

/* ---------- Listeners ---------- */
function ligarEstoque(){
  if(!$("sec-estoque")) return;
  $("btn-registrar-entrada")?.addEventListener("click", () => comBotaoTravado("btn-registrar-entrada", registrarEntrada));
  $("btn-novo-forn")?.addEventListener("click", criarNovoFornecedorRapido);
  $("ent-busca")?.addEventListener("input", debounce(renderUltimasEntradas));
  document.querySelectorAll("#est-tipos .serv-view-btn").forEach(b => b.addEventListener("click", () => { _estTipo = b.dataset.tipo; estAplicarTipo(); }));
  document.querySelectorAll("#est-hist-tipos .serv-view-btn").forEach(b => b.addEventListener("click", () => { _estHistTipo = b.dataset.tipo; carregarUltimasEntradas(); }));
  estLigarBuscaProduto("est-busca-prod", "est-res-prod", estSelecionarProduto);
  estLigarBuscaProduto("est-ctrl-busca", "est-ctrl-res", p => {
    _estCtrlProd = p;
    $("est-ctrl-info").innerHTML = `<strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} · atual ${num(p.estoque_atual || 0)} ${esc(p.unidade || "un")}${p.controle_reposicao ? " · já controlado (vai atualizar mínimo/ideal)" : ""}`;
    $("est-ctrl-min").value = p.estoque_minimo ?? ""; $("est-ctrl-ideal").value = p.estoque_ideal ?? "";
  });
  $("est-busca-prod")?.addEventListener("input", () => { if(_estProd && $("est-busca-prod").value !== estProdTxt(_estProd)) estSelecionarProduto(null); });
  $("est-rep-busca")?.addEventListener("input", debounce(renderReposicao));
  $("est-rep-so-falta")?.addEventListener("change", renderReposicao);
  $("btn-est-lista-compra")?.addEventListener("click", estGerarListaCompra);
  $("btn-est-controlar")?.addEventListener("click", abrirControlarItem);
  $("btn-est-ctrl-fechar")?.addEventListener("click", fecharControlarItem);
  $("btn-est-ctrl-salvar")?.addEventListener("click", () => comBotaoTravado("btn-est-ctrl-salvar", salvarControlarItem));
  // fase 78: saída no balcão
  balLigarRetirante();
  // fase 108c: destino escolhido à mão vence o da alocação; método só com obra
  $("bal-destino")?.addEventListener("change", () => { _balDestinoOrigem = "manual"; balAplicarMetodo(); balAtualizarDestinoAloc(); });
  $("bal-item")?.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); balEnter(); } });
  $("bal-item")?.addEventListener("input", debounce(async () => { const t = $("bal-item").value.trim(); if(t.length < 2){ $("bal-item-res").style.display = "none"; return; } balMostrarLista(await balBuscar(t)); }, 250));
  $("bal-item")?.addEventListener("blur", () => setTimeout(() => { if($("bal-item-res")) $("bal-item-res").style.display = "none"; }, 200));
  $("btn-bal-registrar")?.addEventListener("click", () => comBotaoTravado("btn-bal-registrar", registrarSaidaBalcao));
  devLigar();   // fase 83: devolução de obra
  document.querySelector('nav button[data-secao="estoque"]')?.addEventListener("click", () => carregarEstoque(false));
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarEstoque);
} else {
  ligarEstoque();
}

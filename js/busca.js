/* ====================================================================
   js/busca.js — busca da barra superior (Ctrl K), fase 193b. Prefixo bus-.
   Acha tela (itens visíveis do menu) e registro: obra por código, nome ou cliente; máquina por TAG ou nome; funcionário
   por nome; pedido de compra por número. Uma consulta por tipo, até 8 resultados cada, e só nos tipos cuja tela o
   perfil enxerga no menu (o banco ainda filtra por RLS). O desenho vem de uiBuscaResultados (js/ui.js).
   ==================================================================== */
const BUS_MAX = 8;
let _busSeq = 0;
let _busItens = [];   // itens da última lista, na ordem da tela: { tipo, id }

/* tela visível no menu para este perfil (o mesmo critério do irParaSecao) */
function busTelaVisivel(secao){
  const b = document.querySelector(`.sidebar-nav button[data-secao="${secao}"]`);
  return !!b && b.style.display !== "none";
}
function busNormal(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }

function busTelas(termo){
  const t = busNormal(termo);
  return [...document.querySelectorAll(".sidebar-nav button[data-secao]")]
    .filter(b => b.style.display !== "none")
    .map(b => ({ texto: (b.querySelector("span")?.textContent || "").trim(), detalhe: b.closest(".nav-grupo")?.getAttribute("aria-label") || "", tipo: "tela", id: b.dataset.secao }))
    .filter(i => i.texto && (busNormal(i.texto).includes(t) || busNormal(i.detalhe).includes(t)))
    .slice(0, BUS_MAX);
}

/* uma consulta por tipo; erro de um tipo não derruba os outros */
async function busRegistros(termo){
  // vírgula, parênteses e curinga quebrariam o filtro "or" do PostgREST
  const limpo = String(termo).replace(/[,()*%\\:"']/g, " ").trim();
  if(limpo.length < 2) return [];
  const p = `%${limpo}%`;
  const tarefas = [];
  if(busTelaVisivel("obras")) tarefas.push(Promise.all([
    sb.from("obras").select("id,codigo,nome,status,cliente:cliente_id(nome)").or(`codigo.ilike.${p},nome.ilike.${p}`).order("codigo", { ascending: false }).limit(BUS_MAX),
    sb.from("obras").select("id,codigo,nome,status,cliente:cliente_id!inner(nome)").ilike("cliente.nome", p).order("codigo", { ascending: false }).limit(BUS_MAX)
  ]).then(([a, b]) => {
    const vistos = new Set(), itens = [];
    for(const o of [...(a.data || []), ...(b.data || [])]){
      if(vistos.has(o.id) || itens.length >= BUS_MAX) continue;
      vistos.add(o.id);
      itens.push({ texto: [o.codigo, o.nome].filter(Boolean).join(" · "), detalhe: o.cliente?.nome || "", tipo: "obra", id: o.id });
    }
    return { titulo: "Obras", itens, erro: a.error && b.error ? a.error.message : "" };
  }));
  if(busTelaVisivel("equipamentos")) tarefas.push(
    sb.from("equipamentos").select("id,codigo,nome").not("tipo", "in", "(caminhao,veiculo)").or(`codigo.ilike.${p},nome.ilike.${p}`).order("codigo").limit(BUS_MAX)
      .then(({ data, error }) => ({ titulo: "Máquinas", itens: (data || []).map(e => ({ texto: [e.codigo, e.nome].filter(Boolean).join(" · "), tipo: "maquina", id: e.id })), erro: error ? error.message : "" })));
  if(busTelaVisivel("funcionarios")) tarefas.push(
    sb.from("funcionarios").select("id,nome,funcao,status").ilike("nome", p).order("nome").limit(BUS_MAX)
      .then(({ data, error }) => ({ titulo: "Funcionários", itens: (data || []).map(f => ({ texto: f.nome, detalhe: [f.funcao, f.status && f.status !== "ativo" ? f.status : ""].filter(Boolean).join(" · "), tipo: "funcionario", id: f.id })), erro: error ? error.message : "" })));
  if(busTelaVisivel("compras")) tarefas.push(
    sb.from("pedidos_compra").select("id,numero,status,fornecedor:fornecedores(razao_social)").ilike("numero", p).order("created_at", { ascending: false }).limit(BUS_MAX)
      .then(({ data, error }) => ({ titulo: "Pedidos de compra", itens: (data || []).map(x => ({ texto: x.numero, detalhe: x.fornecedor?.razao_social || "", tipo: "pedido", id: x.id })), erro: error ? error.message : "" })));
  const res = await Promise.all(tarefas.map(t => t.catch(e => ({ titulo: "", itens: [], erro: String(e?.message || e) }))));
  return res;
}

function busRender(grupos, opcoes){
  const box = $("bus-resultados");
  if(!box) return;
  box.innerHTML = uiBuscaResultados(grupos, opcoes);
  _busItens = [...box.querySelectorAll(".ui-busca-item")];
  busMarcar(0);
}
function busMarcar(i){
  _busItens.forEach((b, k) => b.setAttribute("aria-selected", k === i ? "true" : "false"));
  const b = _busItens[i];
  if(b) b.scrollIntoView({ block: "nearest" });
}
function busIndiceAtual(){ return _busItens.findIndex(b => b.getAttribute("aria-selected") === "true"); }

async function busBuscar(){
  const termo = $("bus-texto")?.value || "";
  const seq = ++_busSeq;
  if(!termo.trim()){ busRender([], {}); return; }
  const telas = { titulo: "Telas", itens: busTelas(termo) };
  busRender([telas], { termo, carregando: termo.trim().length >= 2 });
  if(termo.trim().length < 2) return;
  const regs = await busRegistros(termo);
  if(seq !== _busSeq) return;   // chegou resposta de uma busca antiga
  const erros = regs.filter(r => r.erro && !r.itens.length).map(r => r.titulo).filter(Boolean);
  busRender([telas, ...regs], { termo, vazio: erros.length ? "Nada encontrado. Sem resposta de: " + erros.join(", ") + "." : "" });
}
const busBuscarAtrasado = typeof debounce === "function" ? debounce(busBuscar, 250) : busBuscar;

function abrirBusca(){
  const dlg = $("bus-dialogo");
  if(!dlg || dlg.open) return;
  if(document.body.classList.contains("mfa-obrigatorio") || document.body.classList.contains("senha-provisoria")) return;
  $("bus-texto").value = "";
  busRender([], {});
  dlg.showModal();
  $("bus-texto").focus();
}
function fecharBusca(){ const d = $("bus-dialogo"); if(d?.open) d.close(); }

/* abre o resultado: tela pelo menu; registro pela tela dele e pela função de abrir de cada módulo */
function abrirResultadoBusca(tipo, id){
  fecharBusca();
  const ABRIR = {
    tela:        () => irParaSecao(id),
    obra:        () => irParaSecao("obras") && typeof abrirObra === "function" && abrirObra(id),
    maquina:     () => irParaSecao("equipamentos") && typeof abrirEquipamento === "function" && abrirEquipamento(id),
    funcionario: () => irParaSecao("funcionarios") && typeof abrirFuncionario === "function" && abrirFuncionario(id),
    pedido:      () => irParaSecao("compras") && typeof abrirPedido === "function" && abrirPedido(id)
  };
  if(ABRIR[tipo]) ABRIR[tipo]();
}

function ligarBusca(){
  const dlg = $("bus-dialogo");
  if(!dlg || dlg.dataset.ligado) return;
  dlg.dataset.ligado = "1";
  $("btn-busca")?.addEventListener("click", abrirBusca);
  document.addEventListener("keydown", ev => {
    if((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && String(ev.key).toLowerCase() === "k"){
      if(!$("tela-app") || getComputedStyle($("tela-app")).display === "none") return;   // só com o app aberto (fora do login)
      ev.preventDefault();
      if(dlg.open) fecharBusca(); else abrirBusca();
    }
  });
  $("bus-texto").addEventListener("input", busBuscarAtrasado);
  $("bus-texto").addEventListener("keydown", ev => {
    const i = busIndiceAtual();
    if(ev.key === "ArrowDown"){ ev.preventDefault(); busMarcar(Math.min(i + 1, _busItens.length - 1)); }
    else if(ev.key === "ArrowUp"){ ev.preventDefault(); busMarcar(Math.max(i - 1, 0)); }
    else if(ev.key === "Enter"){ ev.preventDefault(); const b = _busItens[i]; if(b) abrirResultadoBusca(b.dataset.busTipo, b.dataset.busId); }
  });
  $("bus-resultados").addEventListener("click", ev => {
    const b = ev.target.closest(".ui-busca-item");
    if(b) abrirResultadoBusca(b.dataset.busTipo, b.dataset.busId);
  });
  // clique fora da caixa (no fundo do diálogo) fecha
  dlg.addEventListener("click", ev => { if(ev.target === dlg) fecharBusca(); });
}
ligarBusca();

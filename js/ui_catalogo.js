/* ====================================================================
   js/ui_catalogo.js — monta o catálogo vivo ui.html (fase 193a). Só é carregado pelo ui.html, nunca pelo app.
   Dado de exemplo inventado (nenhuma obra, pessoa ou valor real) e nenhuma chamada de rede.
   Cada item: nome da função, para que serve, trecho de uso e o exemplo renderizado (normal, vazio e erro).
   ==================================================================== */
/* o app tem esc() no core.js; o catálogo não carrega o core (que abriria o Supabase), então traz a mesma função */
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const CAT_DIAS = ["05/11", "06/11", "07/11", "10/11", "11/11", "12/11", "13/11", "14/11", "17/11", "18/11"];
const CAT_ITENS = [
  {
    fn: "uiPagina", titulo: "Cabeçalho de página",
    para: "Topo único de toda página e ficha: trilha, título, uma ação primária, menu Ações e paginador.",
    uso: `uiPagina({
  trilha: [{ texto: "Obras", id: "obras" }, { texto: "8242 · Residencial Exemplo" }],
  titulo: "Residencial Exemplo",
  sub: "Hélice contínua · Cliente Exemplo Ltda",
  acoes: [{ id: "rdo", texto: "Novo RDO", primaria: true }, { id: "editar", texto: "Editar" }],
  menuAcoes: [{ id: "duplicar", texto: "Duplicar" }, { id: "excluir", texto: "Excluir", perigo: true }],
  paginador: { pos: 3, total: 41 }
})`,
    exemplos: () => [
      ["Normal", uiPagina({ trilha: [{ texto: "Obras", id: "obras" }, { texto: "8242 · Residencial Exemplo" }], titulo: "Residencial Exemplo",
        sub: "Hélice contínua · Cliente Exemplo Ltda", acoes: [{ id: "rdo", texto: "Novo RDO", primaria: true }, { id: "editar", texto: "Editar" }],
        menuAcoes: [{ id: "duplicar", texto: "Duplicar" }, { id: "excluir", texto: "Excluir", perigo: true }], paginador: { pos: 3, total: 41 } })],
      ["Sem dado", uiPagina({})],
      ["Erro", uiPagina({ titulo: "Obra", erro: "Não foi possível carregar a obra. Tente de novo." })]
    ]
  },
  {
    fn: "uiFaixaSituacao", titulo: "Faixa de situação",
    para: "A frase do topo da ficha: como o registro está, em uma linha. A primeira frase sai em negrito.",
    uso: `uiFaixaSituacao(["Em execução", "87% concluída", "parada há 11 dias", "término previsto 28/11"], "aviso")`,
    exemplos: () => [
      ["Em dia", uiFaixaSituacao(["Em execução", "62% concluída", "ritmo 12% acima da média", "término previsto 05/12"], "ok")],
      ["Atenção", uiFaixaSituacao(["Em execução", "87% concluída", "parada há 11 dias", "término previsto 28/11"], "aviso")],
      ["Vazio", uiFaixaSituacao([], "ok")],
      ["Erro", uiFaixaSituacao(null, null, { erro: "Andamento indisponível." })]
    ]
  },
  {
    fn: "uiKpi", titulo: "KPI com comparação",
    para: "Número grande, rótulo e uma linha de contexto; a comparação diz se subir é bom ou ruim.",
    uso: `uiKpi("142 m", "Produção do dia", "3 estacas", { delta: -0.13, texto: "vs média" })
uiKpi("4", "Refuradas", "", { delta: 0.5, texto: "vs semana passada", melhor: "menor" })`,
    exemplos: () => [
      ["Normal", `<div class="ui-kpis">${uiKpi("142 m", "Produção do dia", "3 estacas", { delta: -0.13, texto: "vs média" })}${uiKpi("38", "Executadas", "de 44 previstas", { delta: 0.08, texto: "vs semana passada" })}${uiKpi("4", "Refuradas", "", { delta: 0.5, texto: "vs semana passada", melhor: "menor" })}</div>`],
      ["Vazio", uiKpi(null, "Produção do dia", "sem RDO no dia")],
      ["Erro", uiKpi(null, "Produção do dia", "", { erro: "Falha ao ler os RDOs." })]
    ]
  },
  {
    fn: "uiAbas", titulo: "Abas com resumo",
    para: "Cada aba mostra embaixo do nome um número ou estado; abas de cadastro se agrupam em um item com menu.",
    uso: `uiAbas([
  { id: "painel", rotulo: "Painel", resumo: "87%" },
  { id: "estacas", rotulo: "Estacas", resumo: "38/44" },
  { id: "rdo", rotulo: "RDOs", resumo: "21" },
  { id: "geral", rotulo: "Geral", grupo: "Cadastro" },
  { id: "contrato", rotulo: "Contrato", grupo: "Cadastro" }
], { ativa: "painel", rotulo: "Abas da obra" })`,
    exemplos: () => [
      ["Normal", uiAbas([{ id: "painel", rotulo: "Painel", resumo: "87%" }, { id: "estacas", rotulo: "Estacas", resumo: "38/44" }, { id: "rdo", rotulo: "RDOs", resumo: "21" },
        { id: "medicoes", rotulo: "Medições", resumo: "2 abertas" }, { id: "geral", rotulo: "Geral", grupo: "Cadastro" }, { id: "contrato", rotulo: "Contrato", grupo: "Cadastro" },
        { id: "docs", rotulo: "Documentos", grupo: "Cadastro", resumo: "6" }], { ativa: "painel", rotulo: "Abas da obra" })],
      ["Vazio", uiAbas([])],
      ["Erro", uiAbas(null, { erro: "Não foi possível montar as abas." })]
    ]
  },
  {
    fn: "uiFiltros", titulo: "Busca e filtros",
    para: "Busca, filtros ativos removíveis e o contador do que está na tela.",
    uso: `uiFiltros({
  placeholder: "Buscar obra, cliente ou cidade",
  filtros: [{ id: "situacao", rotulo: "Situação", valor: "Em andamento" }, { id: "metodo", rotulo: "Método", valor: "Hélice contínua" }],
  total: 12, unidade: ["obra", "obras"]
})`,
    exemplos: () => [
      ["Normal", uiFiltros({ placeholder: "Buscar obra, cliente ou cidade", filtros: [{ id: "situacao", rotulo: "Situação", valor: "Em andamento" }, { id: "metodo", rotulo: "Método", valor: "Hélice contínua" }], total: 12, unidade: ["obra", "obras"], id: "cat-busca-1" })],
      ["Sem filtro", uiFiltros({ total: 0, unidade: ["obra", "obras"], id: "cat-busca-2" })],
      ["Erro", uiFiltros({ erro: "Contagem indisponível.", id: "cat-busca-3" })]
    ]
  },
  {
    fn: "uiTabela", titulo: "Tabela densa",
    para: "Densidade de ERP: linha de 28 px, cabeçalho fixo ao rolar, número à direita e tabular, código em mono.",
    uso: `uiTabela({
  colunas: [
    { chave: "codigo", rotulo: "Obra", tipo: "codigo" },
    { chave: "nome", rotulo: "Nome" },
    { chave: "inicio", rotulo: "Início", tipo: "data" },
    { chave: "metros", rotulo: "Metros", tipo: "num" },
    { chave: "avanco", rotulo: "Avanço", tipo: "pct" }
  ],
  linhas, chaveLinha: "codigo", vazio: "Nenhuma obra em execução.",
  rodape: { metros: 2310.5 }
})`,
    exemplos: () => {
      const colunas = [{ chave: "codigo", rotulo: "Obra", tipo: "codigo" }, { chave: "nome", rotulo: "Nome" }, { chave: "inicio", rotulo: "Início", tipo: "data" },
        { chave: "metros", rotulo: "Metros", tipo: "num" }, { chave: "avanco", rotulo: "Avanço", tipo: "pct" }];
      const linhas = [
        { codigo: "8242", nome: "Residencial Exemplo", inicio: "2026-10-20", metros: 1204.5, avanco: 0.87 },
        { codigo: "8250", nome: "Galpão Modelo <b>sem negrito</b>", inicio: "2026-11-03", metros: 640, avanco: 0.42 },
        { codigo: "8255", nome: "Ponte Fictícia", inicio: "2026-11-10", metros: 466, avanco: 0.12 }
      ];
      return [
        ["Normal (o nome com tag sai escapado)", uiTabela({ colunas, linhas, chaveLinha: "codigo", rodape: { metros: 2310.5 } })],
        ["Carregando", uiTabela({ colunas, carregando: "Carregando obras…" })],
        ["Vazio", uiTabela({ colunas, linhas: [], vazio: "Nenhuma obra em execução." })],
        ["Erro", uiTabela({ colunas, erro: "Não foi possível ler as obras." })]
      ];
    }
  },
  {
    fn: "uiCampo", titulo: "Campo de formulário",
    para: "Rótulo, controle, ajuda e erro, ligados por aria-describedby. Para o cadastro (Editar), nunca para o painel.",
    uso: `uiCampo({ id: "obr-cidade", rotulo: "Cidade", valor: "Itabira", ajuda: "Cidade da obra, não do cliente.", obrigatorio: true })
uiCampo({ id: "obr-metodo", rotulo: "Método", tipo: "select", opcoes: [["helice", "Hélice contínua"], ["raiz", "Estaca raiz"]], valor: "helice" })`,
    exemplos: () => [
      ["Normal", `<div class="cat-grade">${uiCampo({ id: "cat-cidade", rotulo: "Cidade", valor: "Itabira", ajuda: "Cidade da obra, não do cliente.", obrigatorio: true })}${uiCampo({ id: "cat-metodo", rotulo: "Método", tipo: "select", opcoes: [["helice", "Hélice contínua"], ["raiz", "Estaca raiz"], ["trado", "Trado mecanizado"]], valor: "helice" })}${uiCampo({ id: "cat-obs", rotulo: "Observação", tipo: "textarea", placeholder: "Opcional" })}</div>`],
      ["Vazio", uiCampo({ id: "cat-equipe", rotulo: "Equipe", tipo: "select", opcoes: [] })],
      ["Erro", uiCampo({ id: "cat-iss", rotulo: "ISS (%)", tipo: "number", valor: "120", erro: "O ISS vai de 0 a 5%." })]
    ]
  },
  {
    fn: "uiLinhaTempo", titulo: "Linha do tempo",
    para: "Eventos por dia e hora, do mais novo para o mais antigo, com filtro por tipo. Parada é observação, não cobrança.",
    uso: `uiLinhaTempo(eventos, {
  tipos: [{ id: "estaca", rotulo: "Estacas", tom: "ok" }, { id: "parada", rotulo: "Ocorrências", tom: "aviso" }, { id: "rdo", rotulo: "RDO", tom: "info" }],
  filtro: ""
})`,
    exemplos: () => {
      const tipos = [{ id: "estaca", rotulo: "Estacas", tom: "ok" }, { id: "parada", rotulo: "Ocorrências", tom: "aviso" }, { id: "rdo", rotulo: "RDO", tom: "info" }];
      const eventos = [
        { quando: "2026-11-18T16:40", tipo: "rdo", titulo: "RDO 18/11 assinado", detalhe: "Encarregado: Fulano de Tal" },
        { quando: "2026-11-18T14:05", tipo: "estaca", titulo: "Estaca P12 executada", detalhe: "Ø 40 cm · 14,5 m" },
        { quando: "2026-11-18T10:20", tipo: "parada", titulo: "Ocorrência: chuva", detalhe: "Obra paralisada? Não · em razão do cliente? Não" },
        { quando: "2026-11-17T15:30", tipo: "estaca", titulo: "Estaca P11 executada", detalhe: "Ø 40 cm · 14,0 m" }
      ];
      return [["Normal", uiLinhaTempo(eventos, { tipos, filtro: "" })], ["Vazio", uiLinhaTempo([], { tipos })], ["Erro", uiLinhaTempo(null, { erro: "Linha do tempo indisponível." })]];
    }
  },
  {
    fn: "uiPulso", titulo: "Pulso da produção",
    para: "Barras da produção por dia contra a média (linha laranja tracejada). Cor por classe, sem estilo inline.",
    uso: `uiPulso([120, 96, 0, 142, 130, 88, 151, 0, 117, 142], null, { rotulos: dias, unidade: "m" })`,
    exemplos: () => [
      ["10 dias", uiPulso([120, 96, 0, 142, 130, 88, 151, 0, 117, 142], null, { rotulos: CAT_DIAS, unidade: "m" })],
      ["1 dia", uiPulso([64], null, { rotulos: ["18/11"], unidade: "m" })],
      ["Vazio", uiPulso([], null)],
      ["Erro", uiPulso(null, null, { erro: "Produção indisponível." })]
    ]
  },
  {
    fn: "uiProgresso", titulo: "Progresso",
    para: "Barra ou anel. Total zero vira estado vazio; acima de 100% o desenho para no cheio e o número mostra o real.",
    uso: `uiProgresso(38, 44, "Estacas")
uiProgresso(38, 44, "concluída", { forma: "anel" })`,
    exemplos: () => [
      ["Barra e anel", `<div class="cat-grade">${uiProgresso(38, 44, "Estacas")}${uiProgresso(38, 44, "concluída", { forma: "anel" })}${uiProgresso(47, 44, "Estacas (com refuro)")}</div>`],
      ["Vazio", uiProgresso(0, 0, "Estacas")],
      ["Erro", uiProgresso(0, 0, "Estacas", { erro: "Avanço indisponível." })]
    ]
  },
  {
    fn: "uiModal · uiConfirmar · uiAvisar", titulo: "Diálogos",
    para: "Um só modal, uma só confirmação e um só aviso no canto, no lugar de alert/confirm do navegador e dos modais espalhados.",
    uso: `const acao = await uiModal({ titulo: "Encerrar obra", texto: "A obra sai da lista de execução.", acoes: [{ id: "nao", texto: "Voltar" }, { id: "sim", texto: "Encerrar", primaria: true }] });
if(await uiConfirmar({ titulo: "Excluir RDO", texto: "O RDO 18/11 será excluído.", confirmar: "Excluir", perigo: true })) { /* ... */ }
uiAvisar("RDO salvo.", "ok");   // ok e info somem em 4 s; aviso e perigo ficam`,
    exemplos: () => [
      ["Abrir", `<div class="cat-linha"><button type="button" class="ui-btn" data-cat="modal">Abrir modal</button><button type="button" class="ui-btn" data-cat="confirmar">Confirmação de exclusão</button><button type="button" class="ui-btn" data-cat="aviso-ok">Aviso de sucesso</button><button type="button" class="ui-btn" data-cat="aviso-perigo">Aviso de erro</button></div>`],
      ["Modal (desenho)", `<div class="cat-modal-amostra">${uiModalHTML({ titulo: "Encerrar obra", texto: "A obra sai da lista de execução.", acoes: [{ id: "nao", texto: "Voltar" }, { id: "sim", texto: "Encerrar", primaria: true }] })}</div>`],
      ["Erro no modal", `<div class="cat-modal-amostra">${uiModalHTML({ titulo: "Encerrar obra", erro: "Não foi possível encerrar." })}</div>`],
      ["Avisos (desenho)", `<div class="cat-linha">${uiAvisoHTML("RDO salvo.", "ok")}${uiAvisoHTML("Falta a assinatura do encarregado.", "aviso")}${uiAvisoHTML("Não foi possível salvar.", "erro")}</div>`]
    ]
  },
  {
    fn: "uiSecao · uiLinhaItem · uiRotuloValor · uiAvatar · uiCodigo · uiStatusbar · uiBreadcrumb · uiVazio", titulo: "Componentes da fase 161",
    para: "Continuam valendo: cartão de seção, linha de item, rótulo e valor, avatar de iniciais, código, barra de etapas, trilha e vazio.",
    uso: `uiSecao("equipe", "Equipe", uiLinhaItem("Fulano de Tal", "Operador", "8,5", "h"), "3 pessoas")
uiRotuloValor("Cliente", esc(cliente))
'<div class="odoo-statusbar">' + uiStatusbar([["orcamento", "Orçamento"], ["execucao", "Em execução"], ["concluida", "Concluída"]], "execucao") + "</div>"`,
    exemplos: () => [
      ["Seção com itens", uiSecao("equipe", "Equipe", uiLinhaItem("Fulano de Tal", "Operador", "8,5", "h") + uiLinhaItem("Beltrano Exemplo", "Ajudante", "8,5", "h"), "2 pessoas")],
      ["Rótulo e valor, avatar e código", `<div class="cat-linha">${uiRotuloValor("Cliente", esc("Cliente Exemplo Ltda"))}${uiAvatar("Fulano de Tal")}${uiAvatar("Beltrano Exemplo")}${uiCodigo("RDO-2026-0418")}</div>`],
      ["Etapas", `<div class="odoo-statusbar">${uiStatusbar([["orcamento", "Orçamento"], ["execucao", "Em execução"], ["concluida", "Concluída"]], "execucao")}</div>`],
      ["Vazio", uiVazio("Nenhum registro no período.")]
    ]
  }
];

function catIdDe(fn){ return "cat-" + fn.split(" ")[0].toLowerCase(); }

function catRender(){
  document.getElementById("cat-indice").innerHTML = CAT_ITENS.map(it => `<a href="#${esc(catIdDe(it.fn))}">${esc(it.titulo)}</a>`).join("");
  document.getElementById("cat-corpo").innerHTML = CAT_ITENS.map(it => `<section class="cat-item" id="${esc(catIdDe(it.fn))}">
    <header class="cat-item-cab"><h2>${esc(it.titulo)}</h2><code>${esc(it.fn)}</code></header>
    <p class="cat-item-para">${esc(it.para)}</p>
    <div class="cat-exemplos">${it.exemplos().map(([rot, html]) => `<div class="cat-exemplo"><span class="rotulo-caps">${esc(rot)}</span><div class="cat-palco">${/* html */ html}</div></div>`).join("")}</div>
    <details class="cat-uso"><summary>Trecho de uso</summary><pre><code>${esc(it.uso)}</code></pre></details>
  </section>`).join("");
}

function catLigar(){
  const raiz = document.documentElement;
  const btnTema = document.getElementById("cat-tema");
  const atualizarTema = () => { const e = raiz.dataset.theme === "escuro"; btnTema.setAttribute("aria-pressed", String(e)); btnTema.textContent = e ? "Tema claro" : "Tema escuro"; };
  btnTema.addEventListener("click", () => {
    if(raiz.dataset.theme === "escuro") delete raiz.dataset.theme; else raiz.dataset.theme = "escuro";
    try { localStorage.setItem("cgl-tema", raiz.dataset.theme === "escuro" ? "escuro" : "claro"); } catch(_){ /* sem storage */ }
    atualizarTema();
  });
  atualizarTema();
  const btnLarg = document.getElementById("cat-largura");
  btnLarg.addEventListener("click", () => {
    const on = document.body.classList.toggle("cat-estreito");
    btnLarg.setAttribute("aria-pressed", String(on));
  });
  const corpo = document.getElementById("cat-corpo");
  corpo.addEventListener("click", async ev => {
    const aba = ev.target.closest(".ui-abas [data-aba]");
    if(aba){
      const barra = aba.closest(".ui-abas");
      barra.querySelectorAll("[data-aba]").forEach(b => { const on = b === aba; b.classList.toggle("ativa", on); b.setAttribute("aria-selected", String(on)); });
      barra.querySelectorAll(".ui-abas-grupo").forEach(g => { g.classList.toggle("ativa", g.contains(aba)); g.open = false; });
      return;
    }
    const rem = ev.target.closest("[data-remover]");
    if(rem){ const lista = rem.closest(".ui-filtros-ativos"); if(rem.dataset.remover === "*") lista.remove(); else rem.remove(); return; }
    const tipo = ev.target.closest(".ui-tempo-filtros [data-tipo]");
    if(tipo){
      const ex = CAT_ITENS.find(i => i.fn === "uiLinhaTempo").exemplos;
      const palco = tipo.closest(".cat-palco");
      const tipos = [{ id: "estaca", rotulo: "Estacas", tom: "ok" }, { id: "parada", rotulo: "Ocorrências", tom: "aviso" }, { id: "rdo", rotulo: "RDO", tom: "info" }];
      const eventos = [
        { quando: "2026-11-18T16:40", tipo: "rdo", titulo: "RDO 18/11 assinado", detalhe: "Encarregado: Fulano de Tal" },
        { quando: "2026-11-18T14:05", tipo: "estaca", titulo: "Estaca P12 executada", detalhe: "Ø 40 cm · 14,5 m" },
        { quando: "2026-11-18T10:20", tipo: "parada", titulo: "Ocorrência: chuva", detalhe: "Obra paralisada? Não · em razão do cliente? Não" },
        { quando: "2026-11-17T15:30", tipo: "estaca", titulo: "Estaca P11 executada", detalhe: "Ø 40 cm · 14,0 m" }
      ];
      if(ex && palco) palco.innerHTML = uiLinhaTempo(eventos, { tipos, filtro: tipo.dataset.tipo });
      return;
    }
    const b = ev.target.closest("[data-cat]");
    if(!b) return;
    if(b.dataset.cat === "modal"){
      const r = await uiModal({ titulo: "Encerrar obra", texto: "A obra sai da lista de execução.", acoes: [{ id: "nao", texto: "Voltar" }, { id: "sim", texto: "Encerrar", primaria: true }] });
      uiAvisar(r === "sim" ? "Obra encerrada (exemplo)." : "Nada foi feito.", "info");
    } else if(b.dataset.cat === "confirmar"){
      const ok = await uiConfirmar({ titulo: "Excluir RDO", texto: "O RDO 18/11 será excluído.", confirmar: "Excluir", perigo: true });
      uiAvisar(ok ? "RDO excluído (exemplo)." : "Exclusão cancelada.", ok ? "ok" : "info");
    } else if(b.dataset.cat === "aviso-ok") uiAvisar("RDO salvo.", "ok");
    else if(b.dataset.cat === "aviso-perigo") uiAvisar("Não foi possível salvar o RDO.", "perigo");
  });
}

catRender();
catLigar();

/* ====================================================================
   js/ui.js — componentes de apresentação da base visual (fase 161, redesign lote 1; catálogo na fase 193a).
   Carregado logo depois do core.js. Catálogo vivo de todos eles, com o trecho de uso: ui.html (raiz).
   Os componentes de tela só devolvem HTML: nenhuma função aqui lê o banco ou guarda estado. As exceções são as três
   de diálogo (uiModal, uiAvisar, uiConfirmar), que montam o elemento na página e ligam o próprio clique.
   Estados: todo componente da fase 193a aceita { erro } (mostra uiErro no lugar do conteúdo) e tem estado vazio próprio;
   uiCarregando(texto) é o estado de espera de qualquer bloco.
   Todo texto recebido passa por esc(); o que já chega como HTML pronto está no nome do parâmetro (corpoHTML, valorHTML)
   e é responsabilidade de quem chama. Estilo em css/estilo.css (classes .ui-*), sem cor fixa e sem estilo inline.
   Ícones em SVG de traço (nunca emoji), na cor do texto ao redor.
   ==================================================================== */
const UI_ICONES = {
  check:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  equipe:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7"/></svg>',
  foto:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>',
  relogio:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  clima:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  maquina:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 16V8h9l4 4h5v4"/><circle cx="7.5" cy="17" r="2"/><circle cx="17.5" cy="17" r="2"/><path d="M9.5 17h6"/></svg>',
  assinatura: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16"/><path d="m6 16 9.5-9.5a2.1 2.1 0 0 1 3 3L9 19l-4 1z"/></svg>',
  documento:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  nota:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  local:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'   // lote S69-g: bloco Endereço da obra
};
/* ícone conhecido, ou nada: o nome vem do código, nunca do banco */
function uiIcone(nome){ return Object.prototype.hasOwnProperty.call(UI_ICONES, nome) ? UI_ICONES[nome] : ""; }

/* Cartão de seção: ícone + título pequeno em caixa alta, contador opcional à direita, corpo com o mesmo respiro em todos */
function uiSecao(icone, titulo, corpoHTML, extra){
  return `<section class="ui-secao"><header class="ui-secao-cab">${/* html */ uiIcone(icone)}<span class="rotulo-caps">${esc(titulo)}</span>${extra ? `<span class="ui-secao-extra">${esc(extra)}</span>` : ""}</header><div class="ui-secao-corpo">${/* html */ corpoHTML || ""}</div></section>`;
}
/* Linha de item: título e subtítulo à esquerda; à direita o número forte e a unidade embaixo */
function uiLinhaItem(titulo, sub, valor, unidade){
  return `<div class="ui-linha"><div class="ui-linha-txt"><div class="ui-linha-titulo">${esc(titulo)}</div>${sub ? `<div class="ui-linha-sub">${esc(sub)}</div>` : ""}</div>${valor != null && valor !== "" ? `<div class="ui-linha-valor"><strong>${esc(valor)}</strong>${unidade ? `<span>${esc(unidade)}</span>` : ""}</div>` : ""}</div>`;
}
/* KPI: número grande, rótulo pequeno em caixa alta e uma linha de contexto (comparação ou consequência) */
/* fase 193a: comparacao = { delta, texto, melhor } acrescenta a linha "▼ 13% vs média". delta é a variação em fração
   (-0.13 = 13% abaixo); melhor = "maior" (padrão) ou "menor" diz se subir é bom (verde) ou ruim (vermelho).
   comparacao = { erro } mostra o erro no lugar do número; valor vazio vira "—". */
function uiKpi(valor, rotulo, contexto, comparacao){
  const c = comparacao || {};
  if(c.erro) return `<div class="ui-kpi ui-kpi-erro"><div class="ui-kpi-valor">—</div><div class="rotulo-caps">${esc(rotulo)}</div>${uiErro(c.erro)}</div>`;
  const v = valor == null || valor === "" ? "—" : valor;
  let cmp = "";
  if(c.delta != null && Number.isFinite(Number(c.delta))){
    const d = Number(c.delta), pct = Math.round(Math.abs(d) * 100);
    const seta = pct === 0 ? "=" : d > 0 ? "▲" : "▼";
    const bom = pct === 0 ? "igual" : (d > 0) === (c.melhor !== "menor") ? "bom" : "ruim";
    cmp = `<div class="ui-kpi-cmp ${bom}"><span aria-hidden="true">${seta}</span> ${pct}%${c.texto ? ` ${esc(c.texto)}` : ""}</div>`;
  }
  return `<div class="ui-kpi"><div class="ui-kpi-valor">${esc(v)}</div><div class="rotulo-caps">${esc(rotulo)}</div>${contexto ? `<div class="ui-kpi-contexto">${esc(contexto)}</div>` : ""}${/* html */ cmp}</div>`;
}
/* Iniciais de um nome ("Marcos Vinícius Silva" = "MS"; um nome só = as duas primeiras letras) */
function uiIniciais(nome){
  const p = String(nome || "").trim().split(/\s+/).filter(x => /^[A-Za-zÀ-ÿ]/.test(x));
  if(!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}
/* Avatar de iniciais. O tom (1 a 6) sai do nome, então a mesma pessoa tem sempre a mesma cor; os seis são pares
   fundo/texto de estado que já existem no :root e no tema escuro (contraste conferido pelo checar-contraste) */
function uiAvatar(nome){
  let h = 0; for(const c of String(nome || "")) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return `<span class="ui-avatar t${h % 6 + 1}" aria-hidden="true">${esc(uiIniciais(nome))}</span>`;
}
/* Barra de etapas no padrão .odoo-statusbar: etapas = [[valor, rótulo]], atual = valor da etapa em que o registro está */
function uiStatusbar(etapas, atual){
  const i = (etapas || []).findIndex(e => e[0] === atual);
  return (etapas || []).map((e, k) => `<div class="stage${k === i ? " atual" : k < i ? " passada" : ""}" data-status="${esc(e[0])}"${k === i ? ' aria-current="step"' : ""}>${esc(e[1])}</div>`).join("");
}
/* Trilha: itens = [{ texto, id }]. Item com id vira botão (data-trilha), o último é a página atual. Quem chama liga o clique.
   opcoes.tituloId (193b): o último item sai como <h1 id> — é a trilha da barra superior (#app-secao-titulo). */
function uiBreadcrumb(itens, opcoes){
  const l = (itens || []).filter(x => x && x.texto);
  const tid = opcoes && opcoes.tituloId ? uiId(opcoes.tituloId) : "";
  return `<nav class="ui-trilha" aria-label="Você está em">${l.map((x, k) => (k ? '<span class="sep" aria-hidden="true">›</span>' : "")
    + (k === l.length - 1 ? (tid ? `<h1 id="${esc(tid)}" class="atual" aria-current="page">${esc(x.texto)}</h1>` : `<span class="atual" aria-current="page">${esc(x.texto)}</span>`)
      : x.id ? `<button type="button" data-trilha="${esc(x.id)}">${esc(x.texto)}</button>` : `<span>${esc(x.texto)}</span>`)).join("")}</nav>`;
}
/* Código ou número de documento, em fonte mono */
function uiCodigo(texto){ return `<span class="ui-codigo">${esc(texto)}</span>`; }
/* Linha de rótulo e valor da ficha-documento. valorHTML já vem pronto (link, texto escapado por quem chama) */
function uiRotuloValor(rotulo, valorHTML){
  return `<div class="ui-rv"><span class="rotulo-caps">${esc(rotulo)}</span><div class="ui-rv-valor">${/* html */ valorHTML || "—"}</div></div>`;
}
/* Estado vazio de um bloco: uma frase discreta, sem quebrar o desenho do cartão */
function uiVazio(texto){ return `<p class="ui-vazio">${esc(texto)}</p>`; }
/* Hotfix 347: aviso de valores ocultos (lote S59) dentro de um bloco de valores, com o botão que os mostra. Só aparece
   enquanto o body tem .valores-ocultos; o clique em [data-val-mostrar] é ligado uma vez no core.js (ligarValSens). */
function uiValoresOcultos(texto){
  return `<p class="ui-val-ocultos" role="note"><span>${esc(texto || "Os valores estão ocultos nesta tela.")}</span><button type="button" class="ui-btn" data-val-mostrar title="Mostra os valores em dinheiro (o mesmo que o olho no topo da tela)">Mostrar valores</button></p>`;
}

/* ====================================================================
   FASE 193a — componentes da base (catálogo em ui.html)
   Convenções:
   - Todo texto vindo do banco passa por esc() aqui dentro; parâmetro que já chega como HTML pronto tem "HTML" no nome.
   - Classes de tom só de lista fechada (uiTom); nada vindo do banco vira classe ou atributo sem esc().
   - Cor em SVG por classe CSS (fill e stroke com token na camada componentes); nenhum estilo inline.
   - Clique: o componente só marca data-* (data-acao, data-aba, data-remover, data-tipo...); quem chama liga o evento.
   ==================================================================== */
const UI_TONS = ["ok", "aviso", "perigo", "info", "neutro"];
/* classe de tom ("tom-ok", "tom-aviso"...; desconhecido = "tom-neutro"): nunca devolve texto de fora da lista.
   O prefixo evita colidir com .aviso/.ok do legado (o .aviso do legado tem display:none). */
function uiTom(t){ return "tom-" + (UI_TONS.includes(t) ? esc(t) : "neutro"); }
/* id seguro para atributo id/for (letras, números, _ e -) */
function uiId(id){ return String(id ?? "").replace(/[^A-Za-z0-9_-]/g, ""); }

/* Estado de erro de um bloco: frase em tom de perigo, com papel de alerta para o leitor de tela */
function uiErro(texto){ return `<p class="ui-erro" role="alert">${esc(texto || "Não foi possível carregar.")}</p>`; }
/* Estado de espera de um bloco */
function uiCarregando(texto){ return `<p class="ui-carregando" role="status">${esc(texto || "Carregando…")}</p>`; }

/* Formata valor de célula ou KPI por tipo: "num", "int", "brl", "pct" (fração: 0.42 = 42%), "data", "texto".
   Sempre devolve texto escapado. */
function uiFmt(v, tipo){
  if(v == null || v === "") return "—";
  const n = Number(v);
  if(tipo === "num" && Number.isFinite(n)) return esc(n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }));
  if(tipo === "int" && Number.isFinite(n)) return esc(Math.round(n).toLocaleString("pt-BR"));
  if(tipo === "brl" && Number.isFinite(n)) return esc(n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  if(tipo === "pct" && Number.isFinite(n)) return esc(Math.round(n * 100) + "%");
  if(tipo === "data"){ const p = String(v).slice(0, 10).split("-"); return esc(p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : v); }
  return esc(v);
}

/* ---- Cabeçalho de página: trilha, título, uma ação primária, menu "Ações ▾" e paginador ----
   cfg = { trilha:[{texto,id}], titulo, sub, acoes:[{id,texto,primaria,titulo}], menuAcoes:[{id,texto,perigo}],
           paginador:{ pos, total }, erro }
   Só a primeira ação com primaria:true sai como botão primário (uma por página). O menu é <details>, abre sem JS. */
function uiPagina(cfg){
  const c = cfg || {};
  let prim = false;
  const acoes = (c.acoes || []).filter(a => a && a.texto).map(a => {
    const ehPrim = a.primaria && !prim; if(ehPrim) prim = true;
    return `<button type="button" class="${ehPrim ? "ui-btn ui-btn-prim" : "ui-btn"}" data-acao="${esc(a.id)}"${a.titulo ? ` title="${esc(a.titulo)}"` : ""}>${esc(a.texto)}</button>`;
  }).join("");
  const menu = (c.menuAcoes || []).filter(a => a && a.texto);
  const menuHTML = menu.length ? `<details class="ui-menu"><summary class="ui-btn">Ações <span aria-hidden="true">▾</span></summary><div class="ui-menu-lista" role="menu">${menu.map(a =>
    `<button type="button" role="menuitem" class="${a.perigo ? "ui-menu-item perigo" : "ui-menu-item"}" data-acao="${esc(a.id)}">${esc(a.texto)}</button>`).join("")}</div></details>` : "";
  const p = c.paginador;
  const pos = p ? Math.trunc(Number(p.pos)) || 0 : 0, tot = p ? Math.trunc(Number(p.total)) || 0 : 0;
  const pagHTML = tot > 0 ? `<div class="ui-pag" role="group" aria-label="Registro ${Number(pos)} de ${Number(tot)}"><button type="button" class="ui-btn" data-pag="ant"${pos <= 1 ? " disabled" : ""} aria-label="Anterior">‹</button><span>${Number(pos)} / ${Number(tot)}</span><button type="button" class="ui-btn" data-pag="prox"${pos >= tot ? " disabled" : ""} aria-label="Próximo">›</button></div>` : "";
  return `<header class="ui-pagina">${c.trilha && c.trilha.length ? uiBreadcrumb(c.trilha) : ""}<div class="ui-pagina-linha"><div class="ui-pagina-tit"><h1>${esc(c.titulo || "Sem título")}</h1>${c.sub ? `<p>${esc(c.sub)}</p>` : ""}</div><div class="ui-pagina-acoes">${/* html */ acoes}${/* html */ menuHTML}${/* html */ pagHTML}</div></div>${c.erro ? uiErro(c.erro) : ""}</header>`;
}

/* ---- Faixa de situação: a frase do topo da ficha ("Em execução · 87% concluída · parada há 11 dias") ----
   frases = lista de textos (vazios saem); tom = ok | aviso | perigo | info | neutro; opcoes = { erro, vazio, acoes }
   acoes = [{ id, texto, primaria, title }]: botões no fim da faixa (button[data-faixa-acao=id]); quem chama liga o clique. */
function uiFaixaSituacao(frases, tom, opcoes){
  const o = opcoes || {};
  if(o.erro) return `<div class="ui-faixa tom-perigo">${uiErro(o.erro)}</div>`;
  const l = (Array.isArray(frases) ? frases : [frases]).filter(x => x != null && String(x).trim() !== "");
  if(!l.length) return `<div class="ui-faixa tom-neutro"><span class="ui-faixa-txt">${esc(o.vazio || "Sem situação calculada.")}</span></div>`;
  const acoes = (o.acoes || []).filter(a => a && a.id).map(a => `<button type="button" class="ui-btn${a.primaria ? " ui-btn-prim" : ""}" data-faixa-acao="${esc(a.id)}"${a.title ? ` title="${esc(a.title)}"` : ""}>${esc(a.texto || a.id)}</button>`).join("");
  return `<div class="ui-faixa ${uiTom(tom)}" role="status"><span class="ui-faixa-marca" aria-hidden="true"></span><span class="ui-faixa-txt">${l.map((x, i) => (i ? '<span class="sep" aria-hidden="true"> · </span>' : "") + (i === 0 ? `<strong>${esc(x)}</strong>` : `<span>${esc(x)}</span>`)).join("")}</span>${acoes ? `<span class="ui-faixa-acoes">${/* html */ acoes}</span>` : ""}</div>`;
}

/* ---- Abas com resumo embaixo do nome ----
   abas = [{ id, rotulo, resumo, grupo }]; abas com o mesmo grupo viram um item "Grupo ▾" (<details>) no fim da barra.
   opcoes = { ativa, erro, rotulo } (rotulo = aria-label da barra). Cada aba é button[role=tab][data-aba]. */
function uiAbas(abas, opcoes){
  const o = opcoes || {};
  if(o.erro) return uiErro(o.erro);
  const l = (abas || []).filter(a => a && a.id != null && a.rotulo);
  if(!l.length) return uiVazio("Nenhuma aba disponível.");
  const btn = a => `<button type="button" role="tab" class="ui-aba${a.id === o.ativa ? " ativa" : ""}" data-aba="${esc(a.id)}" aria-selected="${a.id === o.ativa ? "true" : "false"}"><span class="ui-aba-nome">${esc(a.rotulo)}</span>${a.resumo != null && a.resumo !== "" ? `<span class="ui-aba-resumo">${esc(a.resumo)}</span>` : ""}</button>`;
  const soltas = l.filter(a => !a.grupo);
  const grupos = [...new Set(l.filter(a => a.grupo).map(a => a.grupo))];
  const gruposHTML = grupos.map(g => {
    const dentro = l.filter(a => a.grupo === g);
    const temAtiva = dentro.some(a => a.id === o.ativa);
    return `<details class="ui-abas-grupo${temAtiva ? " ativa" : ""}"><summary class="ui-aba"><span class="ui-aba-nome">${esc(g)} <span aria-hidden="true">▾</span></span><span class="ui-aba-resumo">${dentro.length} ${dentro.length === 1 ? "aba" : "abas"}</span></summary><div class="ui-abas-grupo-lista">${dentro.map(btn).join("")}</div></details>`;
  }).join("");
  return `<div class="ui-abas" role="tablist" aria-label="${esc(o.rotulo || "Abas")}">${soltas.map(btn).join("")}${/* html */ gruposHTML}</div>`;
}

/* ---- Tabela densa de ERP ----
   cfg = { colunas:[{ chave, rotulo, tipo, html }], linhas:[{...}], vazio, erro, carregando, rodape:{chave: valor}, chaveLinha }
   tipo "num" | "int" | "brl" | "pct" alinha à direita com números tabulares; "data" formata; "codigo" sai em mono.
   html(linha) devolve HTML pronto (quem escreve escapa); chaveLinha sai em data-id de cada <tr>. Cabeçalho fixo ao rolar. */
function uiTabela(cfg){
  const c = cfg || {};
  const cols = (c.colunas || []).filter(x => x && x.chave != null);
  const num = t => ["num", "int", "brl", "pct"].includes(t);
  const cls = x => num(x.tipo) ? ' class="num"' : x.tipo === "codigo" ? ' class="cod"' : "";
  const cab = `<thead><tr>${cols.map(x => `<th scope="col"${cls(x)}>${esc(x.rotulo ?? x.chave)}</th>`).join("")}</tr></thead>`;
  const n = Math.max(cols.length, 1);
  const linhas = c.linhas || [];
  const celula = (x, l) => typeof x.html === "function" ? /* html */ (x.html(l) ?? "") : uiFmt(l[x.chave], num(x.tipo) || x.tipo === "data" ? x.tipo : "texto");
  let corpo;
  if(c.erro) corpo = `<tr class="ui-tabela-estado"><td colspan="${n}">${uiErro(c.erro)}</td></tr>`;
  else if(c.carregando) corpo = `<tr class="ui-tabela-estado"><td colspan="${n}">${uiCarregando(typeof c.carregando === "string" ? c.carregando : "")}</td></tr>`;
  else if(!linhas.length) corpo = `<tr class="ui-tabela-estado"><td colspan="${n}">${uiVazio(c.vazio || "Nenhum registro.")}</td></tr>`;
  else corpo = linhas.map(l => `<tr${c.chaveLinha && l[c.chaveLinha] != null ? ` data-id="${esc(l[c.chaveLinha])}"` : ""}>${cols.map(x => `<td${cls(x)}>${/* html */ celula(x, l)}</td>`).join("")}</tr>`).join("");
  const rod = c.rodape && !c.erro && linhas.length ? `<tfoot><tr>${cols.map(x => `<td${cls(x)}>${c.rodape[x.chave] != null ? uiFmt(c.rodape[x.chave], num(x.tipo) ? x.tipo : "texto") : ""}</td>`).join("")}</tr></tfoot>` : "";
  return `<div class="ui-tabela-rola"><table class="ui-tabela">${/* html */ cab}<tbody>${/* html */ corpo}</tbody>${/* html */ rod}</table></div>`;
}

/* ---- Filtros: busca + filtros removíveis + contador ----
   cfg = { busca, placeholder, filtros:[{ id, rotulo, valor }], total, unidade:["obra","obras"], erro, id }
   O campo de busca tem data-filtro="busca"; cada filtro ativo é um botão data-remover="<id>"; "Limpar" tem data-remover="*". */
function uiFiltros(cfg){
  const c = cfg || {};
  const fs = (c.filtros || []).filter(f => f && f.valor != null && f.valor !== "");
  const un = c.unidade || ["registro", "registros"];
  const tot = Number(c.total);
  const temTot = c.total != null && c.total !== "" && Number.isFinite(tot);
  const cont = c.erro ? uiErro(c.erro) : temTot ? `<span class="ui-filtros-cont" role="status">${esc(tot.toLocaleString("pt-BR"))} ${esc(tot === 1 ? un[0] : un[1])}</span>` : "";
  const ativos = fs.length ? `<div class="ui-filtros-ativos">${fs.map(f =>
    `<button type="button" class="ui-filtro" data-remover="${esc(f.id)}" aria-label="Remover filtro ${esc(f.rotulo)}: ${esc(f.valor)}"><span>${esc(f.rotulo)}:</span> <strong>${esc(f.valor)}</strong> <span aria-hidden="true">×</span></button>`).join("")}${fs.length > 1 ? '<button type="button" class="ui-filtro-limpar" data-remover="*">Limpar</button>' : ""}</div>` : "";
  return `<div class="ui-filtros"><label class="ui-filtros-busca"><span class="sr-only">Buscar</span><input type="search" id="${esc(uiId(c.id || "ui-busca"))}" data-filtro="busca" value="${esc(c.busca || "")}" placeholder="${esc(c.placeholder || "Buscar")}" autocomplete="off"></label>${/* html */ ativos}${/* html */ cont}</div>`;
}

/* ---- Campo de formulário: rótulo, controle, ajuda e erro ----
   cfg = { id, rotulo, tipo ("text","number","date","email","tel","time","month","textarea","select"), valor, ajuda, erro,
           obrigatorio, opcoes:[[valor, rótulo]], placeholder, somenteLeitura, linhas }. Select sem opção mostra o estado vazio.
   linhas = altura do textarea em linhas (padrão 3; fase 180e, editor de modelo). */
function uiCampo(cfg){
  const c = cfg || {};
  const id = uiId(c.id || "campo");
  const desc = [c.ajuda ? `${id}-ajuda` : "", c.erro ? `${id}-erro` : ""].filter(Boolean).join(" ");
  const attrs = `id="${esc(id)}" name="${esc(id)}"${c.obrigatorio ? " required" : ""}${c.somenteLeitura ? " readonly" : ""}${c.erro ? ' aria-invalid="true"' : ""}${desc ? ` aria-describedby="${esc(desc)}"` : ""}`;
  let ctl;
  if(c.tipo === "textarea") ctl = `<textarea ${/* html */ attrs} rows="${Math.max(2, Math.min(60, Math.trunc(Number(c.linhas)) || 3))}" placeholder="${esc(c.placeholder || "")}">${esc(c.valor ?? "")}</textarea>`;
  else if(c.tipo === "select"){
    const op = c.opcoes || [];
    ctl = op.length ? `<select ${/* html */ attrs}><option value="">${esc(c.placeholder || "Selecione")}</option>${op.map(o => `<option value="${esc(o[0])}"${String(o[0]) === String(c.valor ?? "") ? " selected" : ""}>${esc(o[1] ?? o[0])}</option>`).join("")}</select>`
      : `<select ${/* html */ attrs} disabled><option value="">Nenhuma opção cadastrada</option></select>`;
  } else {
    const tipo = ["text", "number", "date", "email", "tel", "time", "month"].includes(c.tipo) ? c.tipo : "text";
    ctl = `<input type="${esc(tipo)}" ${/* html */ attrs} value="${esc(c.valor ?? "")}" placeholder="${esc(c.placeholder || "")}">`;
  }
  return `<div class="ui-campo${c.erro ? " com-erro" : ""}"><label for="${esc(id)}">${esc(c.rotulo || "")}${c.obrigatorio ? ' <span class="ui-campo-obrig" aria-hidden="true">*</span>' : ""}</label>${/* html */ ctl}${c.ajuda ? `<p class="ui-campo-ajuda" id="${esc(id)}-ajuda">${esc(c.ajuda)}</p>` : ""}${c.erro ? `<p class="ui-campo-erro" id="${esc(id)}-erro" role="alert">${esc(c.erro)}</p>` : ""}</div>`;
}

/* ---- Linha do tempo por dia e hora, com filtro por tipo ----
   eventos = [{ quando (ISO "2026-11-18T14:30" ou só a data), tipo, titulo, detalhe }]; sai do mais novo para o mais antigo.
   opcoes = { tipos:[{ id, rotulo, tom }], filtro (id do tipo visível; vazio = todos), erro, vazio }.
   Os filtros são button[data-tipo]; o tom do marcador vem do tipo (lista fechada). */
function uiLinhaTempo(eventos, opcoes){
  const o = opcoes || {};
  if(o.erro) return `<div class="ui-tempo">${uiErro(o.erro)}</div>`;
  const tipos = o.tipos || [];
  const tomDe = t => uiTom((tipos.find(x => x.id === t) || {}).tom);
  const filtros = tipos.length ? `<div class="ui-tempo-filtros" role="group" aria-label="Filtrar por tipo"><button type="button" class="ui-filtro${!o.filtro ? " ativo" : ""}" data-tipo="" aria-pressed="${!o.filtro ? "true" : "false"}">Todos</button>${tipos.map(t =>
    `<button type="button" class="ui-filtro${o.filtro === t.id ? " ativo" : ""}" data-tipo="${esc(t.id)}" aria-pressed="${o.filtro === t.id ? "true" : "false"}">${esc(t.rotulo)}</button>`).join("")}</div>` : "";
  const l = (eventos || []).filter(e => e && e.quando && (!o.filtro || e.tipo === o.filtro))
    .slice().sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
  if(!l.length) return `<div class="ui-tempo">${/* html */ filtros}${uiVazio(o.vazio || "Nenhum evento no período.")}</div>`;
  const dias = [];
  for(const e of l){
    const d = String(e.quando).slice(0, 10);
    if(!dias.length || dias[dias.length - 1].d !== d) dias.push({ d, itens: [] });
    dias[dias.length - 1].itens.push(e);
  }
  const hora = q => { const m = /T(\d{2}:\d{2})/.exec(String(q)); return m ? m[1] : ""; };
  const item = e => `<li class="ui-tempo-item ${tomDe(e.tipo)}"><span class="ui-tempo-hora">${esc(hora(e.quando))}</span><span class="ui-tempo-marca" aria-hidden="true"></span><div class="ui-tempo-txt"><div class="ui-tempo-titulo">${esc(e.titulo || "")}</div>${e.detalhe ? `<div class="ui-tempo-detalhe">${esc(e.detalhe)}</div>` : ""}</div></li>`;
  return `<div class="ui-tempo">${/* html */ filtros}${dias.map(g => `<section class="ui-tempo-dia"><h4 class="rotulo-caps">${uiFmt(g.d, "data")}</h4><ol>${g.itens.map(item).join("")}</ol></section>`).join("")}</div>`;
}

/* ---- Pulso: barras da produção por dia contra a média ----
   valores = números, um por dia, do mais antigo ao mais novo; media = linha de referência (padrão: média dos dias > 0).
   opcoes = { rotulos (um por barra, ex.: "12/11"), unidade ("m"), erro, vazio }. SVG sem estilo inline: a cor vem das
   classes .acima / .abaixo / .zero (fill com token na camada componentes). */
function uiPulso(valores, media, opcoes){
  const o = opcoes || {};
  if(o.erro) return `<div class="ui-pulso">${uiErro(o.erro)}</div>`;
  const v = (valores || []).map(x => Number(x) || 0);
  if(!v.length) return `<div class="ui-pulso">${uiVazio(o.vazio || "Sem produção no período.")}</div>`;
  const pos = v.filter(x => x > 0);
  const med = media != null && media !== "" && Number.isFinite(Number(media)) ? Number(media) : pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0;
  const max = Math.max(...v, med, 1);
  const W = 100, H = 40, gap = v.length > 1 ? 1 : 0, bw = (W - gap * (v.length - 1)) / v.length;
  const un = o.unidade ? " " + o.unidade : "";
  const rot = o.rotulos || [];
  const fmt = x => Number(x).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const barras = v.map((x, i) => {
    const h = x > 0 ? Math.max(1, x / max * H) : 1;
    const classe = x <= 0 ? "zero" : x >= med ? "acima" : "abaixo";
    return `<rect class="${classe}" x="${(i * (bw + gap)).toFixed(2)}" y="${(H - h).toFixed(2)}" width="${bw.toFixed(2)}" height="${h.toFixed(2)}"><title>${esc((rot[i] ? rot[i] + ": " : "") + fmt(x) + un)}</title></rect>`;
  }).join("");
  const ym = (H - med / max * H).toFixed(2);
  const linha = med > 0 ? `<line class="ui-pulso-media" x1="0" x2="${W}" y1="${ym}" y2="${ym}"/>` : "";
  const resumo = `${v.length} ${v.length === 1 ? "dia" : "dias"}, média ${fmt(med)}${un}`;
  return `<figure class="ui-pulso"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(resumo)}">${/* html */ barras}${/* html */ linha}</svg><figcaption>${rot.length ? `<span>${esc(rot[0])}</span>` : ""}<span class="ui-pulso-leg">média ${esc(fmt(med) + un)}</span>${rot.length > 1 ? `<span>${esc(rot[rot.length - 1])}</span>` : ""}</figcaption></figure>`;
}

/* ---- Progresso: barra ou anel ----
   uiProgresso(feito, total, rotulo, { forma: "barra" | "anel", erro, vazio }). Total 0 ou vazio = estado vazio
   ("Sem previsto"); acima de 100% o desenho para no cheio e o número mostra o real. */
function uiProgresso(feito, total, rotulo, opcoes){
  const o = opcoes || {};
  const anel = o.forma === "anel";
  if(o.erro) return `<div class="ui-prog${anel ? " anel" : ""}">${uiErro(o.erro)}</div>`;
  const f = Number(feito) || 0, t = Number(total) || 0;
  if(t <= 0) return `<div class="ui-prog sem-dado${anel ? " anel" : ""}"><span class="rotulo-caps">${esc(rotulo || "")}</span>${uiVazio(o.vazio || "Sem previsto.")}</div>`;
  const pct = f / t, p = Math.max(0, Math.min(1, pct)), txt = Math.round(pct * 100) + "%";
  const meta = `${f.toLocaleString("pt-BR")} de ${t.toLocaleString("pt-BR")}`;
  const aria = `role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}" aria-label="${esc((rotulo ? rotulo + ": " : "") + txt)}"`;
  if(anel){
    const C = 2 * Math.PI * 16;
    return `<div class="ui-prog anel" ${/* html */ aria}><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="trilho" cx="20" cy="20" r="16"/><circle class="feito" cx="20" cy="20" r="16" stroke-dasharray="${(p * C).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 20 20)"/></svg><div class="ui-prog-anel-txt"><strong>${esc(txt)}</strong><span>${esc(rotulo || "")}</span><span class="ui-prog-meta">${esc(meta)}</span></div></div>`;
  }
  return `<div class="ui-prog" ${/* html */ aria}><div class="ui-prog-cab"><span class="rotulo-caps">${esc(rotulo || "")}</span><strong>${esc(txt)}</strong></div><svg class="ui-prog-barra" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="trilho" width="100" height="6" rx="3"/><rect class="feito" width="${(p * 100).toFixed(2)}" height="6" rx="3"/></svg><div class="ui-prog-meta">${esc(meta)}</div></div>`;
}

/* ---- Diálogos: modal, aviso (toast) e confirmação — no lugar dos espalhados e de alert/confirm nativos ----
   uiModalHTML monta o HTML (testável); uiModal abre num <dialog> e devolve Promise com o id da ação clicada (null = fechou).
   cfg = { titulo, corpoHTML, texto, acoes:[{ id, texto, primaria, perigo }], largura: "p" | "m" | "g", erro,
           comValores (true = resolve { acao, valores }, com os [name] do corpo lidos antes de fechar) } */
function uiModalHTML(cfg){
  const c = cfg || {};
  const larg = ["p", "m", "g"].includes(c.largura) ? c.largura : "m";
  const corpo = c.erro ? uiErro(c.erro) : c.corpoHTML ? /* html */ c.corpoHTML : c.texto ? `<p>${esc(c.texto)}</p>` : uiVazio("Nada a mostrar.");
  const acoes = (c.acoes && c.acoes.length ? c.acoes : [{ id: "fechar", texto: "Fechar" }]).map(a =>
    `<button type="button" class="ui-btn${a.primaria ? " ui-btn-prim" : ""}${a.perigo ? " ui-btn-perigo" : ""}" data-acao="${esc(a.id)}">${esc(a.texto)}</button>`).join("");
  return `<div class="ui-modal-caixa ${esc(larg)}"><header class="ui-modal-cab"><h2>${esc(c.titulo || "")}</h2><button type="button" class="ui-modal-x" data-acao="" aria-label="Fechar">×</button></header><div class="ui-modal-corpo">${/* html */ corpo}</div><footer class="ui-modal-acoes">${/* html */ acoes}</footer></div>`;
}
function uiModal(cfg){
  return new Promise(resolve => {
    const d = document.createElement("dialog");
    d.className = "ui-modal";
    d.setAttribute("aria-label", String((cfg && cfg.titulo) || "Diálogo"));
    d.innerHTML = uiModalHTML(cfg);
    let res = null;
    d.addEventListener("click", ev => {
      const b = ev.target.closest("[data-acao]");
      if(b){ res = b.dataset.acao || null; d.close(); }
      else if(ev.target === d){ d.close(); }   // clique no véu fecha
    });
    const comValores = !!(cfg && cfg.comValores);
    if(comValores){   // Enter num campo aciona o botão principal (textarea continua quebrando linha)
      d.addEventListener("keydown", ev => {
        if(ev.key !== "Enter" || !ev.target.matches(".ui-modal-corpo input")) return;
        const prim = d.querySelector(".ui-modal-acoes .ui-btn-prim");
        if(prim){ ev.preventDefault(); prim.click(); }
      });
    }
    d.addEventListener("close", () => {
      let valores = null;
      if(comValores){   // lê os campos antes de o diálogo sair da página
        valores = {};
        d.querySelectorAll(".ui-modal-corpo [name]").forEach(el => { valores[el.name] = el.type === "checkbox" ? el.checked : el.value; });
      }
      d.remove();
      resolve(comValores ? { acao: res, valores } : res);
    });
    document.body.appendChild(d);
    d.showModal();
    const campo = comValores ? d.querySelector(".ui-modal-corpo input, .ui-modal-corpo select, .ui-modal-corpo textarea") : null;
    const foco = campo || d.querySelector(".ui-btn-prim") || d.querySelector(".ui-modal-acoes .ui-btn");
    if(foco) foco.focus();
    if(campo && campo.select) campo.select();
  });
}
/* Confirmação: Promise<boolean>. cfg = { titulo, texto, confirmar ("Confirmar"), cancelar ("Cancelar"), perigo } */
function uiConfirmar(cfg){
  const c = cfg || {};
  return uiModal({ titulo: c.titulo || "Confirmar", texto: c.texto, largura: "p", acoes: [
    { id: "nao", texto: c.cancelar || "Cancelar" },
    { id: "sim", texto: c.confirmar || "Confirmar", primaria: !c.perigo, perigo: !!c.perigo }
  ] }).then(r => r === "sim");
}
/* Pedir valores: modal com campos do uiCampo, no lugar do prompt() nativo.
   cfg = { titulo, texto, campos:[cfg do uiCampo, com id], confirmar ("Confirmar"), cancelar ("Cancelar") }.
   Promise<null (cancelou ou fechou) | { <id do campo>: valor em texto }>. A validação fica com quem chama. */
function uiPedirValoresHTML(cfg){
  const c = cfg || {};
  const campos = (c.campos || []).map(f => uiCampo(Object.assign({}, f, { id: "uipv-" + uiId(f.id) }))).join("");
  return `${c.texto ? `<p>${esc(c.texto)}</p>` : ""}<div class="ui-pedir-campos">${/* html */ campos || uiVazio("Nada a preencher.")}</div>`;
}
function uiPedirValores(cfg){
  const c = cfg || {};
  return uiModal({ titulo: c.titulo || "Informar", corpoHTML: uiPedirValoresHTML(c), largura: "p", comValores: true, acoes: [
    { id: "nao", texto: c.cancelar || "Cancelar" },
    { id: "sim", texto: c.confirmar || "Confirmar", primaria: true }
  ] }).then(r => {
    if(!r || r.acao !== "sim") return null;
    const out = {};
    (c.campos || []).forEach(f => { const k = uiId(f.id); out[k] = (r.valores || {})["uipv-" + k] ?? ""; });
    return out;
  });
}
/* Aviso (toast): HTML testável + função que mostra no canto. tipo = ok | aviso | perigo (ou "erro") | info.
   "ok" e "info" somem sozinhos em 4 s; "aviso" e "perigo" ficam até fechar. */
function uiAvisoHTML(msg, tipo){
  const t = uiTom(tipo === "erro" ? "perigo" : tipo);   // "tom-..."
  return `<div class="ui-aviso ${esc(t)}" role="${t === "tom-perigo" ? "alert" : "status"}"><span class="ui-aviso-txt">${esc(msg || "")}</span><button type="button" class="ui-aviso-x" aria-label="Fechar aviso">×</button></div>`;
}
function uiAvisar(msg, tipo){
  let pilha = document.getElementById("ui-avisos");
  if(!pilha){ pilha = document.createElement("div"); pilha.id = "ui-avisos"; pilha.className = "ui-avisos"; document.body.appendChild(pilha); }
  const tmp = document.createElement("div");
  tmp.innerHTML = uiAvisoHTML(msg, tipo);
  const el = tmp.firstElementChild;
  el.querySelector(".ui-aviso-x").addEventListener("click", () => el.remove());
  pilha.appendChild(el);
  if(!el.classList.contains("tom-aviso") && !el.classList.contains("tom-perigo")) setTimeout(() => el.remove(), 4000);
  return el;
}

/* ====================================================================
   FASE 193b — resultados da busca (Ctrl K). grupos = [{ titulo, itens: [{ texto, detalhe, tipo, id }] }].
   Cada item vira um botão role="option" com data-bus-tipo e data-bus-id; quem chama (js/busca.js) liga o clique e o
   teclado. opcoes: { termo, erro, carregando, vazio }. Sem termo, mostra a dica; termo sem resultado, o estado vazio.
   ==================================================================== */
function uiBuscaResultados(grupos, opcoes){
  const o = opcoes || {};
  if(o.erro) return uiErro(o.erro);
  const gs = (grupos || []).filter(g => g && g.itens && g.itens.length);
  const espera = o.carregando ? uiCarregando("Buscando…") : "";
  if(!gs.length){
    if(o.carregando) return espera;
    return uiVazio(o.termo ? (o.vazio || "Nada encontrado para essa busca.") : "Digite o nome de uma tela, o código ou nome de uma obra, a TAG de uma máquina, um funcionário ou o número de um pedido.");
  }
  return gs.map(g => `<div class="ui-busca-grupo" role="group" aria-label="${esc(g.titulo)}"><div class="ui-busca-grupo-tit" aria-hidden="true">${esc(g.titulo)}</div>${g.itens.map(i =>
    `<button type="button" class="ui-busca-item" role="option" aria-selected="false" data-bus-tipo="${esc(i.tipo || "")}" data-bus-id="${esc(i.id ?? "")}"><span class="ui-busca-item-txt">${esc(i.texto)}</span>${i.detalhe ? `<span class="ui-busca-item-det">${esc(i.detalhe)}</span>` : ""}</button>`).join("")}</div>`).join("") + espera;
}

/* ====================================================================
   FASE 180e — texto longo e comparação de versões (modelos de contrato e de proposta).
   ==================================================================== */
/* Texto longo de leitura (cláusulas, modelo), em fonte fixa com quebra preservada. opcoes = { erro, vazio, numerar }.
   numerar = número da linha à esquerda (o jurídico cita a linha do erro). */
function uiTextoBloco(texto, opcoes){
  const o = opcoes || {};
  if(o.erro) return uiErro(o.erro);
  const t = String(texto ?? "");
  if(!t.trim()) return uiVazio(o.vazio || "Sem texto.");
  if(!o.numerar) return `<pre class="ui-texto">${esc(t)}</pre>`;
  const linhas = t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return `<ol class="ui-texto numerado">${linhas.map(l => `<li>${l ? esc(l) : "&nbsp;"}</li>`).join("")}</ol>`;
}

/* Diferença por linha entre duas versões de um texto (LCS). opcoes = { rotuloAntes, rotuloDepois, contexto (linhas
   iguais mantidas em volta de cada mudança, padrão 2), erro, vazio }. Linha removida em tom de perigo com "−", incluída
   em tom ok com "+"; trecho igual longo vira "… N linhas iguais". Sem diferença, o estado vazio. */
function uiDiffLinhas(antes, depois, opcoes){
  const o = opcoes || {};
  if(o.erro) return `<div class="ui-diff">${uiErro(o.erro)}</div>`;
  const quebra = s => String(s ?? "").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").filter((x, k, l) => l.length > 1 || x !== "");
  const a = quebra(antes), b = quebra(depois), qa = a.length, qb = b.length;
  // tabela LCS de baixo para cima (texto de modelo: algumas centenas de linhas)
  const L = Array.from({ length: qa + 1 }, () => new Uint16Array(qb + 1));
  for(let i = qa - 1; i >= 0; i--) for(let j = qb - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while(i < qa || j < qb){
    if(i < qa && j < qb && a[i] === b[j]){ ops.push({ k: "=", t: a[i], na: ++i, nb: ++j }); }
    else if(i < qa && (j >= qb || L[i + 1][j] >= L[i][j + 1])){ ops.push({ k: "-", t: a[i], na: ++i }); }   // removida antes da incluída
    else { ops.push({ k: "+", t: b[j], nb: ++j }); }
  }
  const mais = ops.filter(x => x.k === "+").length, menos = ops.filter(x => x.k === "-").length;
  if(!mais && !menos) return `<div class="ui-diff">${uiVazio(o.vazio || "As duas versões têm o mesmo texto.")}</div>`;
  const ctx = Number.isFinite(Number(o.contexto)) ? Math.max(0, Number(o.contexto)) : 2;
  const perto = ops.map((x, k) => x.k !== "=" || ops.slice(Math.max(0, k - ctx), k + ctx + 1).some(y => y.k !== "="));
  const linhas = [];
  for(let k = 0; k < ops.length; k++){
    if(perto[k]){
      const x = ops[k];
      const cls = x.k === "+" ? "mais" : x.k === "-" ? "menos" : "igual";
      const sinal = x.k === "+" ? "+" : x.k === "-" ? "−" : " ";
      linhas.push(`<li class="ui-diff-linha ${cls}"><span class="ui-diff-num">${x.na ? Number(x.na) : ""}</span><span class="ui-diff-num">${x.nb ? Number(x.nb) : ""}</span><span class="ui-diff-sinal" aria-hidden="true">${sinal}</span><span class="ui-diff-txt">${x.t ? esc(x.t) : "&nbsp;"}</span></li>`);
    } else {
      let q = 0; while(k < ops.length && !perto[k]){ q++; k++; } k--;
      linhas.push(`<li class="ui-diff-linha pulo"><span class="ui-diff-txt">… ${q} ${q === 1 ? "linha igual" : "linhas iguais"}</span></li>`);
    }
  }
  const rot = `<div class="ui-diff-cab"><span class="ui-diff-leg menos">− ${esc(o.rotuloAntes || "antes")}: ${Number(menos)} ${menos === 1 ? "linha" : "linhas"}</span><span class="ui-diff-leg mais">+ ${esc(o.rotuloDepois || "depois")}: ${Number(mais)} ${mais === 1 ? "linha" : "linhas"}</span></div>`;
  return `<div class="ui-diff">${/* html */ rot}<ol class="ui-diff-lista">${/* html */ linhas.join("")}</ol></div>`;
}

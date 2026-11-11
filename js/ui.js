/* ====================================================================
   js/ui.js — componentes de apresentação da base visual (fase 161, redesign lote 1).
   Carregado logo depois do core.js. Só devolve HTML: nenhuma função aqui lê o banco, guarda estado ou liga evento.
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
  nota:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>'
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
function uiKpi(valor, rotulo, contexto){
  return `<div class="ui-kpi"><div class="ui-kpi-valor">${esc(valor)}</div><div class="rotulo-caps">${esc(rotulo)}</div>${contexto ? `<div class="ui-kpi-contexto">${esc(contexto)}</div>` : ""}</div>`;
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
/* Trilha: itens = [{ texto, id }]. Item com id vira botão (data-trilha), o último é a página atual. Quem chama liga o clique. */
function uiBreadcrumb(itens){
  const l = (itens || []).filter(x => x && x.texto);
  return `<nav class="ui-trilha" aria-label="Você está em">${l.map((x, k) => (k ? '<span class="sep" aria-hidden="true">›</span>' : "")
    + (k === l.length - 1 ? `<span class="atual" aria-current="page">${esc(x.texto)}</span>`
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

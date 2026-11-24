/* ====================================================================
   Mobilizações: visão Gráfico (fase 189b, chamado 230). Prefixo mgr-.
   Gantt de equipamentos do Word "Cronograma e gráfico de equipamentos": uma linha por TAG, agrupada como no
   Cronograma (mcrGrupos, js/mobilizacoes_cronograma.js), lendo as views da 189a:
   - vw_equipamentos_cronograma (linhas, pelos filtros do Cronograma) e vw_equipamentos_cronograma_barras (barras).
   - Barra da mobilização sólida com a cor da metodologia (tokens --metodo-*); reserva tracejada; linha "hoje";
     dias livres entre duas barras da mesma máquina (para encaixar obra pequena).
   - Escala dia, semana ou mês (guardada no localStorage, com try/catch). Imprime em A3 paisagem numa janela própria.
   - SVG desenhado aqui, sem biblioteca. Cor só por elemento.style.fill / style.stroke com token do :root (CLAUDE.md).
   - Término da mobilização sem desmobilização: previsão da obra pelo ritmo (fase 140) ou data prevista da obra; sem
     nenhuma, a barra vai até o fim da janela ("sem término previsto"). Reserva sem término idem.
   - Lote S68-f (chamado 366, Bruno): OS de manutenção aberta (tipo_barra 'manutencao') vira barra cinza (--mgr-manutencao) até a
     data_prevista da OS (atrasada vai até hoje, já na view); conta como ocupada em mgrLivres; o clique abre a OS só para
     quem tem o item Manutenção no menu (mgrVeManutencao); os demais veem só o título.
   ==================================================================== */

let _mgrBarras    = [];       // linhas de vw_equipamentos_cronograma_barras
let _mgrBaseLinhas = null;    // _mcrLinhas da última leitura (quando o Cronograma relê, as barras também são relidas)
let _mgrDesloc    = 0;        // deslocamento da janela, em passos de navegação
let _mgrEscala    = (() => { try { const v = localStorage.getItem("cgl.mgr.escala"); return ["dia", "semana", "mes"].includes(v) ? v : "semana"; } catch(e){ return "semana"; } })();

const MGR_SVG_NS = "http://www.w3.org/2000/svg";
// px por dia, dias na janela, dias antes de hoje e passo da navegação (dias)
const MGR_ESCALAS = {
  dia:    { rot: "Dia",    px: 26,  dias: 42,  antes: 7,  passo: 21 },
  semana: { rot: "Semana", px: 8,   dias: 182, antes: 28, passo: 91 },
  mes:    { rot: "Mês",    px: 2.6, dias: 365, antes: 61, passo: 182 }
};
const MGR_GEO = { rotulo: 190, topo: 38, linha: 26, grupo: 22, barra: 18 };
const MGR_MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/* ---------- Datas em dias inteiros (UTC, sem fuso) ---------- */
function mgrDia(iso){ const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
function mgrISO(n){ return new Date(n * 864e5).toISOString().slice(0, 10); }

/* Janela da escala: { ini, dias } em dias inteiros, a partir de hoje e do deslocamento */
function mgrJanela(escala, hoje, desloc){
  const e = MGR_ESCALAS[escala] || MGR_ESCALAS.semana;
  let ini = mgrDia(hoje) - e.antes + (desloc || 0) * e.passo;
  if(escala === "semana"){ const dow = new Date(ini * 864e5).getUTCDay(); ini -= (dow + 6) % 7; }   // começa na segunda
  if(escala === "mes"){ const d = new Date(ini * 864e5); ini = Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 864e5); }
  return { ini, dias: e.dias, px: e.px };
}

/* Barra da view -> { inicio, fim, aberta, estimada } (ISO). prevObra: obra_id -> previsão de término pelo ritmo */
function mgrNormalizar(b, prevObra){
  if(!b.inicio) return null;
  let fim = b.termino || null, estimada = false;
  if(!fim && b.tipo_barra === "mobilizacao"){
    fim = (prevObra && prevObra[b.obra_id]) || b.obra_fim_prevista || null;
    estimada = !!fim;
  }
  if(fim && fim < b.inicio) fim = b.inicio;
  return { ...b, inicio: String(b.inicio).slice(0, 10), fim: fim ? String(fim).slice(0, 10) : null, aberta: !fim, estimada };
}

/* Dias livres entre barras consecutivas de UMA máquina: [{ de, ate, dias }] (ISO, inclusivo).
   Barra aberta (sem término) encerra a conta: depois dela não se sabe quando a máquina fica livre.
   Toda barra conta como ocupada: mobilização, reserva e OS de manutenção aberta (lote S68-f). */
function mgrLivres(barras){
  const ord = barras.filter(Boolean).slice().sort((a, b) => a.inicio.localeCompare(b.inicio));
  const out = [];
  let fimMax = null;
  for(const b of ord){
    if(fimMax !== null){
      const dias = mgrDia(b.inicio) - fimMax - 1;
      if(dias > 0) out.push({ de: mgrISO(fimMax + 1), ate: mgrISO(mgrDia(b.inicio) - 1), dias });
    }
    if(b.aberta) return out;
    fimMax = fimMax === null ? mgrDia(b.fim) : Math.max(fimMax, mgrDia(b.fim));
  }
  return out;
}

/* Geometria do Gantt, sem DOM (testada em scripts/testar-fase189b.mjs).
   grupos: [{ grupo, metodo, linhas: [{ equipamento_id, codigo, nome, metodologia, operadores, mob_id }] }]
   barras: barras já normalizadas (mgrNormalizar). */
function mgrLayout({ grupos, barras, escala, hoje, desloc }){
  const G = MGR_GEO;
  const jan = mgrJanela(escala, hoje, desloc);
  const jFim = jan.ini + jan.dias - 1;
  const x = d => G.rotulo + (d - jan.ini) * jan.px;
  const porEq = new Map();
  (barras || []).filter(Boolean).forEach(b => { if(!porEq.has(b.equipamento_id)) porEq.set(b.equipamento_id, []); porEq.get(b.equipamento_id).push(b); });

  const lay = { largura: Math.ceil(G.rotulo + jan.dias * jan.px) + 1, altura: 0, janela: { ini: mgrISO(jan.ini), fim: mgrISO(jFim) },
    escala, px: jan.px, linhas: [], barras: [], livres: [], ticks: [], meses: [], fds: [], hojeX: null };
  let y = G.topo;
  grupos.forEach(g => {
    lay.linhas.push({ tipo: "grupo", y, h: G.grupo, rotulo: g.grupo, metodo: g.metodo, qtd: g.linhas.length });
    y += G.grupo;
    g.linhas.forEach(l => {
      lay.linhas.push({ tipo: "maq", y, h: G.linha, rotulo: l.codigo, nome: l.nome || "", metodo: l.metodologia || "", equipamento_id: l.equipamento_id });
      const yb = y + (G.linha - G.barra) / 2;
      const minhas = porEq.get(l.equipamento_id) || [];
      minhas.forEach(b => {
        const di = mgrDia(b.inicio), df = b.aberta ? jFim : mgrDia(b.fim);
        if(df < jan.ini || di > jFim) return;
        const a = Math.max(di, jan.ini), z = Math.min(df, jFim);
        lay.barras.push({ x: x(a), w: (z - a + 1) * jan.px, y: yb, h: G.barra, metodo: l.metodologia || "", reserva: b.tipo_barra === "reserva",
          manutencao: b.tipo_barra === "manutencao",
          prevista: b.tipo_barra === "mobilizacao" && ["prevista", "em_preparacao"].includes(b.status), barra: b,
          operadores: b.tipo_barra === "mobilizacao" && b.barra_id === l.mob_id ? (l.operadores || "") : "" });
      });
      mgrLivres(minhas).forEach(v => {
        const di = mgrDia(v.de), df = mgrDia(v.ate);
        if(df < jan.ini || di > jFim) return;
        const a = Math.max(di, jan.ini), z = Math.min(df, jFim);
        lay.livres.push({ x: x(a), w: (z - a + 1) * jan.px, y, h: G.linha, dias: v.dias, de: v.de, ate: v.ate });
      });
      y += G.linha;
    });
  });
  lay.altura = y + 1;

  // Régua: dia = cada dia (e o mês acima); semana = cada segunda (e o mês acima); mês = cada mês (e o ano acima)
  for(let d = jan.ini; d <= jFim; d++){
    const dt = new Date(d * 864e5), dia = dt.getUTCDate(), dow = dt.getUTCDay(), mes = dt.getUTCMonth();
    if(escala === "dia"){
      lay.ticks.push({ x: x(d), rotulo: String(dia) });
      if(dow === 0 || dow === 6) lay.fds.push({ x: x(d), w: jan.px });
    } else if(escala === "semana"){
      if(dow === 1) lay.ticks.push({ x: x(d), rotulo: `${String(dia).padStart(2, "0")}/${String(mes + 1).padStart(2, "0")}` });
    } else if(dia === 1){
      lay.ticks.push({ x: x(d), rotulo: MGR_MESES[mes] });
    }
    if(escala === "mes" ? (d === jan.ini || (dia === 1 && mes === 0)) : (d === jan.ini || dia === 1))
      lay.meses.push({ x: x(d), rotulo: escala === "mes" ? String(dt.getUTCFullYear()) : `${MGR_MESES[mes]}/${String(dt.getUTCFullYear()).slice(2)}` });
  }
  const dh = mgrDia(hoje);
  if(dh >= jan.ini && dh <= jFim) lay.hojeX = x(dh) + jan.px / 2;
  return lay;
}

/* ---------- Desenho em SVG (DOM; cor só por style com token do :root) ---------- */
function mgrEl(tag, attrs, estilo){
  const el = document.createElementNS(MGR_SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => { if(v !== null && v !== undefined) el.setAttribute(k, String(v)); });
  Object.entries(estilo || {}).forEach(([k, v]) => { el.style[k] = v; });
  return el;
}
function mgrTexto(attrs, estilo, txt){ const t = mgrEl("text", attrs, estilo); t.textContent = txt; return t; }
function mgrCorte(txt, largura, pxChar){ const n = Math.floor(largura / (pxChar || 6.2)); return !txt || n < 2 ? "" : (txt.length <= n ? txt : txt.slice(0, Math.max(1, n - 1)) + "…"); }
const MGR_COR = { helice: "var(--metodo-helice)", secante: "var(--metodo-secante)", raiz: "var(--metodo-raiz)", trado: "var(--metodo-trado)",
  bomba: "var(--metodo-bomba)", compressor: "var(--metodo-compressor)", gerador: "var(--metodo-gerador)" };
function mgrCor(metodo){ return MGR_COR[metodo] || "var(--txt-sec)"; }

function mgrTitulo(b){
  const r = b.barra, linhas = [];
  const datas = `${dataBR(r.inicio)} a ${r.aberta ? "sem término previsto" : dataBR(r.fim)}${r.estimada ? " (previsão da obra; sem desmobilização prevista)" : ""}`;
  if(b.manutencao){
    const situacao = { agendada: "Agendada", em_andamento: "Em andamento" }[r.status] || r.status;
    const tipo = { preventiva: "preventiva", corretiva: "corretiva", preditiva: "preditiva" }[r.cliente] || r.cliente || "";
    linhas.push(`${r.obra_nome || "OS"} · prevista até ${dataBR(r.fim)}`);
    linhas.push(`Manutenção ${tipo}`.trim());
    linhas.push(`Desde ${dataBR(r.inicio)}${r.fim === hojeISO() ? " (vai até hoje: prevista vencida ou para hoje)" : ""}`);
    linhas.push(`Situação: ${situacao}`);
  } else if(b.reserva){
    linhas.push(`Reserva: ${r.obra_nome || "obra em negociação"}`);
    if(r.cliente) linhas.push(r.cliente);
    linhas.push(datas);
  } else {
    linhas.push([r.obra_codigo, r.obra_nome].filter(Boolean).join(" · "));
    if(r.cliente) linhas.push(r.cliente);
    linhas.push(datas);
    linhas.push(`Operador: ${b.operadores || "—"}`);
    linhas.push(`Situação: ${(typeof MOB_STATUS === "object" && MOB_STATUS[r.status]) || r.status}${r.como === "apoio" ? " (apoio)" : ""}`);
  }
  return linhas.join("\n");
}

function mgrDesenhar(lay){
  const G = MGR_GEO;
  const svg = mgrEl("svg", { xmlns: MGR_SVG_NS, width: lay.largura, height: lay.altura, viewBox: `0 0 ${lay.largura} ${lay.altura}`,
    class: "mgr-svg", role: "img", "aria-label": `Gráfico de equipamentos de ${dataBR(lay.janela.ini)} a ${dataBR(lay.janela.fim)}` });
  const fundo = mgrEl("g"), grade = mgrEl("g"), frente = mgrEl("g");
  svg.appendChild(fundo); svg.appendChild(grade); svg.appendChild(frente);

  lay.fds.forEach(f => fundo.appendChild(mgrEl("rect", { x: f.x, y: G.topo, width: f.w, height: lay.altura - G.topo }, { fill: "var(--sup-2)" })));
  lay.linhas.filter(l => l.tipo === "grupo").forEach(l => fundo.appendChild(mgrEl("rect", { x: 0, y: l.y, width: lay.largura, height: l.h }, { fill: "var(--sup-2)" })));
  // régua
  lay.meses.forEach(m => frente.appendChild(mgrTexto({ x: Math.max(m.x, G.rotulo) + 3, y: 13, class: "mgr-txt-mes" }, { fill: "var(--txt)" }, m.rotulo)));
  lay.ticks.forEach(t => {
    grade.appendChild(mgrEl("line", { x1: t.x, x2: t.x, y1: 18, y2: lay.altura }, { stroke: "var(--borda)" }));
    frente.appendChild(mgrTexto({ x: t.x + (lay.escala === "dia" ? lay.px / 2 : 3), y: 31, class: "mgr-txt-tick", "text-anchor": lay.escala === "dia" ? "middle" : "start" }, { fill: "var(--txt-sec)" }, t.rotulo));
  });
  grade.appendChild(mgrEl("line", { x1: 0, x2: lay.largura, y1: G.topo - 0.5, y2: G.topo - 0.5 }, { stroke: "var(--borda-forte)" }));
  grade.appendChild(mgrEl("line", { x1: G.rotulo - 0.5, x2: G.rotulo - 0.5, y1: 0, y2: lay.altura }, { stroke: "var(--borda-forte)" }));
  // coluna das TAGs: grupo próprio, desenhado por último; na tela acompanha a rolagem horizontal (mgrLigarSvg)
  const rotulos = mgrEl("g", { class: "mgr-rotulos" });
  rotulos.appendChild(mgrEl("rect", { x: 0, y: 0, width: G.rotulo, height: lay.altura }, { fill: "var(--sup-1)" }));
  rotulos.appendChild(mgrEl("line", { x1: G.rotulo - 0.5, x2: G.rotulo - 0.5, y1: 0, y2: lay.altura }, { stroke: "var(--borda-forte)" }));
  lay.linhas.forEach(l => {
    grade.appendChild(mgrEl("line", { x1: 0, x2: lay.largura, y1: l.y + l.h - 0.5, y2: l.y + l.h - 0.5 }, { stroke: "var(--borda)" }));
    rotulos.appendChild(mgrEl("line", { x1: 0, x2: G.rotulo - 1, y1: l.y + l.h - 0.5, y2: l.y + l.h - 0.5 }, { stroke: "var(--borda)" }));
    if(l.tipo === "grupo"){
      rotulos.appendChild(mgrEl("rect", { x: 0, y: l.y, width: G.rotulo - 1, height: l.h - 1 }, { fill: "var(--sup-2)" }));
      rotulos.appendChild(mgrEl("rect", { x: 0, y: l.y, width: 4, height: l.h }, { fill: mgrCor(l.metodo) }));
      rotulos.appendChild(mgrTexto({ x: 10, y: l.y + 15, class: "mgr-txt-grupo" }, { fill: "var(--txt)" }, mgrCorte(`${l.rotulo} (${l.qtd})`, G.rotulo - 14, 6.4)));
    } else {
      rotulos.appendChild(mgrTexto({ x: 10, y: l.y + 17, class: "mgr-txt-tag" }, { fill: "var(--txt)" }, l.rotulo));
      const nome = mgrCorte(l.nome, G.rotulo - 70, 5.6);
      if(nome) rotulos.appendChild(mgrTexto({ x: 62, y: l.y + 17, class: "mgr-txt-nome" }, { fill: "var(--txt-sec)" }, nome));
    }
  });
  rotulos.appendChild(mgrTexto({ x: 10, y: 31, class: "mgr-txt-tick" }, { fill: "var(--txt-sec)" }, "Equipamento"));
  // dias livres
  lay.livres.forEach(v => {
    const g = mgrEl("g", { class: "mgr-livre" });
    const t = mgrEl("title"); t.textContent = `${v.dias} ${v.dias === 1 ? "dia livre" : "dias livres"}: ${dataBR(v.de)} a ${dataBR(v.ate)}`; g.appendChild(t);
    const ym = v.y + v.h / 2;
    g.appendChild(mgrEl("line", { x1: v.x + 1, x2: v.x + v.w - 1, y1: ym, y2: ym, "stroke-dasharray": "2 3" }, { stroke: "var(--sucesso)" }));
    const rot = v.w >= 46 ? `${v.dias} d livres` : (v.w >= 18 ? `${v.dias} d` : "");
    if(rot){
      g.appendChild(mgrEl("rect", { x: v.x + v.w / 2 - rot.length * 3.1 - 3, y: ym - 7, width: rot.length * 6.2 + 6, height: 14, rx: 3 }, { fill: "var(--sup-1)" }));
      g.appendChild(mgrTexto({ x: v.x + v.w / 2, y: ym + 4, "text-anchor": "middle", class: "mgr-txt-livre" }, { fill: "var(--sucesso-txt)" }, rot));
    }
    frente.appendChild(g);
  });
  // barras
  const veOS = mgrVeManutencao();
  lay.barras.forEach(b => {
    const r = b.barra;
    const semLink = b.manutencao && !veOS;   // OS sem o item Manutenção no menu: só o título, sem clique
    const g = mgrEl("g", { class: "mgr-barra" + (b.reserva ? " mgr-reserva" : "") + (b.manutencao ? " mgr-manutencao" : "") + (semLink ? " mgr-sem-link" : ""),
      tabindex: semLink ? null : 0, role: semLink ? "img" : "button",
      "data-mgr-tipo": r.tipo_barra, "data-mgr-id": semLink ? null : r.barra_id, "data-mgr-eq": r.equipamento_id });
    const t = mgrEl("title"); t.textContent = mgrTitulo(b); g.appendChild(t);
    const cor = b.manutencao ? "var(--mgr-manutencao)" : mgrCor(b.metodo);
    if(b.manutencao){
      g.appendChild(mgrEl("rect", { x: b.x, y: b.y, width: Math.max(b.w, 2), height: b.h, rx: 3 }, { fill: cor }));
    } else if(b.reserva){
      g.appendChild(mgrEl("rect", { x: b.x + 0.5, y: b.y + 0.5, width: Math.max(b.w - 1, 2), height: b.h - 1, rx: 3, "fill-opacity": 0.18, "stroke-dasharray": "5 3", "stroke-width": 1.5 }, { fill: cor, stroke: cor }));
    } else {
      g.appendChild(mgrEl("rect", { x: b.x, y: b.y, width: Math.max(b.w, 2), height: b.h, rx: 3, "fill-opacity": b.prevista ? 0.55 : 1 }, { fill: cor }));
    }
    const rot = mgrCorte(b.reserva ? `Reserva: ${r.obra_nome || ""}` : b.manutencao ? `Manutenção · ${r.obra_nome || "OS"}`
      : [r.obra_codigo, r.cliente].filter(Boolean).join(" · "), b.w - 8);
    if(rot) g.appendChild(mgrTexto({ x: b.x + 4, y: b.y + 13, class: "mgr-txt-barra" }, { fill: b.reserva || b.prevista ? "var(--txt)" : "var(--txt-sobre)" }, rot));
    if(r.aberta) g.appendChild(mgrTexto({ x: b.x + b.w - 4, y: b.y + 13, "text-anchor": "end", class: "mgr-txt-barra" }, { fill: b.reserva || b.prevista ? "var(--txt)" : "var(--txt-sobre)" }, "›"));
    frente.appendChild(g);
  });
  // hoje
  if(lay.hojeX !== null){
    frente.appendChild(mgrEl("line", { x1: lay.hojeX, x2: lay.hojeX, y1: 18, y2: lay.altura, "stroke-width": 1.5 }, { stroke: "var(--perigo)" }));
    frente.appendChild(mgrTexto({ x: lay.hojeX + 3, y: G.topo + 10, class: "mgr-txt-hoje" }, { fill: "var(--perigo-txt)" }, "hoje"));
  }
  svg.appendChild(rotulos);
  return svg;
}

/* ---------- Carga ---------- */
async function mgrCarregar(){
  if(typeof mcrCarregar === "function") await mcrCarregar(false);
  if(_mgrBaseLinhas === _mcrLinhas) return;
  const r = await lerTudo(() => sb.from("vw_equipamentos_cronograma_barras").select("*"), ["barra_id", "equipamento_id"]);
  if(r.error) aviso("app-aviso", "Não foi possível carregar as barras do gráfico: " + r.error.message, "erro");
  _mgrBarras = r.error ? [] : r.data;
  _mgrBaseLinhas = _mcrLinhas;
}

/* ---------- Render ---------- */
function renderGraficoMob(){
  const cont = $("mob-conteudo");
  if(!cont) return;
  if(!_mcrCarregado || _mgrBaseLinhas !== _mcrLinhas){
    cont.innerHTML = `<p class="vazio">Carregando gráfico…</p>`;
    mgrCarregar().then(() => { if(_mobView === "grafico") renderGraficoMob(); });
    return;
  }
  const linhas = mcrFiltradas();
  const grupos = mcrGrupos(linhas);
  const barras = _mgrBarras.map(b => mgrNormalizar(b, _mcrPrevObra)).filter(Boolean);
  const semData = _mgrBarras.filter(b => !b.inicio && linhas.some(l => l.equipamento_id === b.equipamento_id)).length;
  const lay = mgrLayout({ grupos, barras, escala: _mgrEscala, hoje: hojeISO(), desloc: _mgrDesloc });
  const metodos = MCR_ORDEM.filter(m => _mcrLinhas.some(l => l.metodologia === m));
  const opt = (v, rot, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(rot)}</option>`;

  cont.innerHTML = `
    <p class="meta">Gráfico de equipamentos tirado das mobilizações: a barra sólida é a mobilização (mais clara quando ainda prevista), a tracejada é a reserva para obra em negociação, a cinza é a máquina em manutenção (OS aberta, até a data prevista), e o vão entre duas barras mostra os dias livres da máquina. Passe o mouse para ver datas, operador e situação; clique para abrir.</p>
    <div class="mcr-filtros">
      <div class="serv-views" role="group" aria-label="Escala">${Object.keys(MGR_ESCALAS).map(k => `<button type="button" class="serv-view-btn${k === _mgrEscala ? " ativo" : ""}" data-mgr-escala="${esc(k)}">${esc(MGR_ESCALAS[k].rot)}</button>`).join("")}</div>
      <button type="button" class="btn-sec btn-sm" id="btn-mgr-ant" title="Período anterior" aria-label="Período anterior">‹</button>
      <button type="button" class="btn-sec btn-sm" id="btn-mgr-hoje" title="Volta a janela para hoje">Hoje</button>
      <button type="button" class="btn-sec btn-sm" id="btn-mgr-prox" title="Próximo período" aria-label="Próximo período">›</button>
      <span class="meta">${esc(dataBR(lay.janela.ini))} a ${esc(dataBR(lay.janela.fim))}</span>
      <select id="mgr-f-metodo" aria-label="Metodologia"><option value="">Todas as metodologias</option>${metodos.map(m => opt(m, MCR_METODO[m], _mcrFiltro.metodo)).join("")}</select>
      <span class="contador">${linhas.length} de ${_mcrLinhas.length} máquinas</span>
      ${semData ? `<span class="meta mcr-aviso" title="Mobilização prevista sem nenhuma data: não aparece no gráfico. Informe a data na ficha da mobilização.">${semData} prevista(s) sem data</span>` : ""}
      <button type="button" class="btn-sec btn-sm" id="btn-mgr-imprimir" style="margin-left:auto;" title="Abre o gráfico numa janela para imprimir em A3 paisagem">Imprimir A3</button>
    </div>
    <div class="mgr-legenda" id="mgr-legenda">${MCR_ORDEM.map(m => `<span><i data-metodo="${esc(m)}"></i>${esc(MCR_METODO[m])}</span>`).join("")}<span><i class="mgr-leg-reserva"></i>Reserva</span><span><i class="mgr-leg-manutencao"></i>Em manutenção</span><span><i class="mgr-leg-livre"></i>Dias livres</span><span><i class="mgr-leg-hoje"></i>Hoje</span></div>
    ${grupos.length ? `<div class="mgr-rola" id="mgr-rola"></div>` : uiVazio("Nenhuma máquina com esses filtros.")}`;
  if(grupos.length){
    const svg = mgrDesenhar(lay);
    $("mgr-rola").appendChild(svg);
    mgrLigarSvg(svg);
    const rola = $("mgr-rola"), rot = svg.querySelector(".mgr-rotulos");
    rola.addEventListener("scroll", () => rot.setAttribute("transform", `translate(${rola.scrollLeft},0)`));
    if(lay.hojeX !== null) rola.scrollLeft = Math.max(0, lay.hojeX - MGR_GEO.rotulo - 120);
  }
  mgrLigar(cont);
}

/* Lote S68-f: o item Manutenção do menu está visível para este perfil (mesmo critério de irParaSecao) */
function mgrVeManutencao(){
  if(typeof document === "undefined" || !document.querySelector) return false;
  const b = document.querySelector('.sidebar-nav button[data-secao="manutencao"]');
  return !!b && b.style.display !== "none";
}
function mgrAbrirBarra(g){
  if(!g) return;
  const id = g.getAttribute("data-mgr-id"), eq = g.getAttribute("data-mgr-eq"), tipo = g.getAttribute("data-mgr-tipo");
  if(!id) return;
  if(tipo === "reserva") mcrAbrirReserva(eq, id);
  else if(tipo === "manutencao"){
    if(!mgrVeManutencao() || !irParaSecao("manutencao")) return;
    if(typeof abrirManutencao === "function") abrirManutencao(id);
  }
  else abrirMobilizacao(id);
}
function mgrLigarSvg(svg){
  svg.addEventListener("click", e => mgrAbrirBarra(e.target.closest("[data-mgr-id]")));
  svg.addEventListener("keydown", e => {
    if(e.key !== "Enter" && e.key !== " ") return;
    const g = e.target.closest("[data-mgr-id]");
    if(g){ e.preventDefault(); mgrAbrirBarra(g); }
  });
}
function mgrLigar(cont){
  cont.querySelectorAll("button[data-mgr-escala]").forEach(b => b.addEventListener("click", () => {
    _mgrEscala = b.dataset.mgrEscala; _mgrDesloc = 0;
    try { localStorage.setItem("cgl.mgr.escala", _mgrEscala); } catch(e){ /* sem localStorage: vale só nesta tela */ }
    renderGraficoMob();
  }));
  $("btn-mgr-ant")?.addEventListener("click", () => { _mgrDesloc--; renderGraficoMob(); });
  $("btn-mgr-prox")?.addEventListener("click", () => { _mgrDesloc++; renderGraficoMob(); });
  $("btn-mgr-hoje")?.addEventListener("click", () => { _mgrDesloc = 0; renderGraficoMob(); });
  $("mgr-f-metodo")?.addEventListener("change", () => { _mcrFiltro.metodo = $("mgr-f-metodo").value || ""; renderGraficoMob(); });
  $("btn-mgr-imprimir")?.addEventListener("click", mgrImprimir);
}

/* ---------- Impressão em A3 paisagem (D10) ---------- */
function mgrImprimir(){
  const svg = document.querySelector("#mgr-rola svg");
  if(!svg){ aviso("app-aviso", "Nenhuma máquina no gráfico para imprimir.", "erro"); return; }
  const w = window.open("", "_blank");
  if(!w){ aviso("app-aviso", "O navegador bloqueou a janela de impressão. Libere pop-ups para este site.", "erro"); return; }
  const copia = svg.cloneNode(true);
  copia.querySelector(".mgr-rotulos")?.removeAttribute("transform");   // na folha a coluna das TAGs fica no lugar
  const css = new URL("css/estilo.css", location.href).href;
  const periodo = document.querySelector("#mob-conteudo .mcr-filtros .meta")?.textContent || "";
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>RG 11.15 · Gráfico de equipamentos</title>
    <link rel="stylesheet" href="${esc(css)}">
    <style>@page { size: A3 landscape; margin: 8mm; } body { margin: 0; padding: 0; background: var(--sup-1); -webkit-print-color-adjust: exact; print-color-adjust: exact; } .mgr-svg { width: 100%; height: auto; } .mgr-imp-topo { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4mm; font-family: var(--font-family); }</style></head>
    <body><div class="mgr-imp-topo"><strong>CGL FUNDAÇÕES · RG 11.15 · GRÁFICO DE EQUIPAMENTOS</strong><span>${esc(periodo)} · emitido em ${esc(dataBR(hojeISO()))}</span></div>
    ${/* html */ $("mgr-legenda").outerHTML}${/* html */ copia.outerHTML}</body></html>`);
  w.document.close();
  let foi = false;
  const imprimir = () => { if(foi) return; foi = true; w.focus(); w.print(); };
  w.document.querySelector("link")?.addEventListener("load", () => setTimeout(imprimir, 100));
  setTimeout(imprimir, 1500);
}

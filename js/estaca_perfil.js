/* ====================================================================
   Módulo: perfil e replay da estaca do Geodigitus — fase 162 (prefixo epf-)
   Carregado depois de js/geodigitus.js. Só leitura: uma linha de geodigitus_estacas por vez, pelo id.
   - abrirPerfilEstaca(geoEstacaId): abre a janela #epf-modal com o cabeçalho, o resumo, o gráfico por profundidade
     (SVG, dois painéis: perfuração e concretagem) e o replay (tocar/pausar, barra de arrastar, 1×, 4× e 16×).
   - Entradas: ação "Perfil" de cada estaca em Chegadas (geoAcoesHTML) e o selo "Geodigitus" da execução no RDO
     (geoBadgeExec), os dois em js/geodigitus.js.
   - epfLinhaDoTempo, epfResumo, epfSeries, epfAvancar e epfQuadro são puras (sem tela nem banco) e testadas por
     scripts/testar-fase162.mjs.
   Unidades como o computador de bordo grava (saci.mjs): torque e pressão em bar, uma fatia a cada 8 cm. Nada é
   inventado: sem volume da fatia ou sem diâmetro, o sobreconsumo fica nulo e a tela diz "não medido".
   O SVG é montado por createElementNS e a cor de token entra só por elemento.style (regra do checar-paleta).
   ==================================================================== */

const EPF_FATIA_M = 0.08;   // espessura da fatia do computador de bordo (SACI.FATIA_M)
const EPF_COLUNAS = "id,numero_txt,refuro,diametro_mm,profundidade_m,volume_concreto_m3,volume_teorico_m3,sobreconsumo_pct," +
  "torque_max_bar,torque_medio_bar,rotacao_media_rpm,pressao_media_bar,tempo_perfuracao_s,tempo_concretagem_s,inclinacao_x,inclinacao_y," +
  "perfuracao_inicio,perfuracao_fim,concretagem_inicio,concretagem_fim,obra_id,equipamento_id,perfil," +
  "equipamento:equipamentos(codigo),obra:obras!geodigitus_estacas_obra_id_fkey(codigo,nome)";
// curvas do gráfico: cada uma na escala do máximo da própria estaca. Cor por token de texto (vale nos dois temas).
const EPF_SERIES = [
  { chave: "torque_bar", fase: "perfuracao", nome: "Torque", unidade: "bar", casas: 0, cor: "var(--info-txt)" },
  { chave: "velocidade_m_h", fase: "perfuracao", nome: "Velocidade de avanço", unidade: "m/h", casas: 0, cor: "var(--sucesso-txt)" },
  { chave: "rotacao_rpm", fase: "perfuracao", nome: "Rotação", unidade: "rpm", casas: 1, cor: "var(--neutro-txt)", tracejada: true },
  { chave: "pressao_bar", fase: "concretagem", nome: "Pressão", unidade: "bar", casas: 1, cor: "var(--acao-txt)" },
  { chave: "sobreconsumo_pct", fase: "concretagem", nome: "Sobreconsumo da fatia", unidade: "%", casas: 0, cor: "var(--lilas-txt)" }
];
const EPF_FASE_LBL = { perfuracao: "Perfuração", concretagem: "Concretagem" };
const EPF_VELOCIDADES = [1, 4, 16];

/* ---------- funções puras ---------- */
function epfN(v){
  if(v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/* volume teórico de uma fatia, em litros: π × (Ø ÷ 2)² × 0,08 m. Sem diâmetro, nulo. */
function epfTeoricoFatiaL(diametroMm){
  const d = epfN(diametroMm);
  return d != null && d > 0 ? Math.PI * (d / 2000) ** 2 * EPF_FATIA_M * 1000 : null;
}
/* Passos na ordem da execução: a perfuração do topo ao fundo e depois a concretagem do fundo ao topo.
   tempo_s é o acumulado ao fim do passo (segue o tempo de cada fatia; a espera entre as duas fases não está no perfil). */
function epfLinhaDoTempo(perfil, diametroMm){
  let p = perfil;
  if(typeof p === "string"){ try { p = JSON.parse(p); } catch(_){ p = null; } }
  const lista = (x) => (Array.isArray(x) ? x : []).filter(f => f && typeof f === "object").map((f, i) => ({ f, i }));
  const prof = (x) => epfN(x.f.profundidade_m);
  const perf = lista(p?.perfuracao).sort((a, b) => ((prof(a) ?? Infinity) - (prof(b) ?? Infinity)) || (a.i - b.i));
  const conc = lista(p?.concretagem).sort((a, b) => {
    const oa = epfN(a.f.ordem), ob = epfN(b.f.ordem);
    if(oa != null && ob != null && oa !== ob) return oa - ob;
    return ((prof(b) ?? -Infinity) - (prof(a) ?? -Infinity)) || (a.i - b.i);
  });
  const teoricoL = epfTeoricoFatiaL(diametroMm);
  const passos = [];
  let tempo = 0, volAcum = null;
  const base = (fase, f) => {
    const dur = Math.max(0, epfN(f.tempo_s) ?? 0);
    tempo += dur;
    return { fase, indice: passos.length, profundidade_m: epfN(f.profundidade_m), duracao_s: dur, tempo_s: tempo,
      velocidade_m_h: dur > 0 ? EPF_FATIA_M / dur * 3600 : null,
      torque_bar: null, rotacao_rpm: null, pressao_bar: null, volume_l: null, volume_acum_l: volAcum, sobreconsumo_pct: null };
  };
  perf.forEach(({ f }) => {
    const s = base("perfuracao", f);
    s.torque_bar = epfN(f.torque_bar); s.rotacao_rpm = epfN(f.rotacao_rpm);
    passos.push(s);
  });
  conc.forEach(({ f }) => {
    const s = base("concretagem", f), vol = epfN(f.volume_l);
    s.pressao_bar = epfN(f.pressao_bar); s.volume_l = vol;
    if(vol != null) volAcum = (volAcum ?? 0) + vol;
    s.volume_acum_l = volAcum;
    s.sobreconsumo_pct = vol != null && teoricoL ? (vol / teoricoL - 1) * 100 : null;
    passos.push(s);
  });
  return passos;
}
/* Resumo da estaca: o que a linha traz no cabeçalho vale; o que faltar sai dos passos; o que não foi medido fica nulo. */
function epfResumo(linha, passos){
  const l = linha || {}, ps = passos || [];
  const perf = ps.filter(p => p.fase === "perfuracao"), conc = ps.filter(p => p.fase === "concretagem");
  const valores = (arr, c) => arr.map(p => p[c]).filter(v => v != null);
  const maximo = (arr, c) => { const v = valores(arr, c); return v.length ? Math.max(...v) : null; };
  const minimo = (arr, c) => { const v = valores(arr, c); return v.length ? Math.min(...v) : null; };
  const soma = (arr, c) => valores(arr, c).reduce((s, v) => s + v, 0);
  const diametro = epfN(l.diametro_mm);
  const profundidade = epfN(l.profundidade_m) ?? maximo(ps, "profundidade_m");
  const medidos = valores(conc, "volume_l");
  const volume = epfN(l.volume_concreto_m3) ?? (medidos.length ? soma(conc, "volume_l") / 1000 : null);
  const teorico = epfN(l.volume_teorico_m3) ?? (diametro && profundidade ? Math.PI * (diametro / 2000) ** 2 * profundidade : null);
  return {
    diametro_mm: diametro, profundidade_m: profundidade,
    tempo_perfuracao_s: epfN(l.tempo_perfuracao_s) ?? (perf.length ? soma(perf, "duracao_s") : null),
    tempo_concretagem_s: epfN(l.tempo_concretagem_s) ?? (conc.length ? soma(conc, "duracao_s") : null),
    tempo_total_s: ps.length ? ps[ps.length - 1].tempo_s : 0,
    volume_m3: volume, volume_teorico_m3: teorico,
    sobreconsumo_pct: epfN(l.sobreconsumo_pct) ?? (volume != null && teorico ? (volume / teorico - 1) * 100 : null),
    torque_max_bar: epfN(l.torque_max_bar) ?? maximo(perf, "torque_bar"),
    rotacao_max_rpm: maximo(perf, "rotacao_rpm"),
    pressao_max_bar: maximo(conc, "pressao_bar"),
    velocidade_max_m_h: maximo(perf, "velocidade_m_h"),
    velocidade_subida_max_m_h: maximo(conc, "velocidade_m_h"),
    sobreconsumo_fatia_min_pct: minimo(conc, "sobreconsumo_pct"), sobreconsumo_fatia_max_pct: maximo(conc, "sobreconsumo_pct"),
    passos_perfuracao: perf.length, passos_concretagem: conc.length
  };
}
/* Curvas que a estaca tem (rotação e sobreconsumo podem não ter sido medidos), com a faixa de cada uma: de zero ao máximo
   da própria estaca; valor abaixo de zero (sobreconsumo negativo) estica a faixa para baixo. */
function epfSeries(passos){
  return EPF_SERIES.map(s => {
    const v = (passos || []).filter(p => p.fase === s.fase).map(p => p[s.chave]).filter(x => x != null);
    return v.length ? { ...s, min: Math.min(0, ...v), max: Math.max(0, ...v) } : null;
  }).filter(Boolean);
}
/* Replay: com t segundos decorridos, a partir do passo i, em que passo a execução está e se chegou ao fim.
   O passo vale enquanto t está antes do fim dele; fatia de tempo zero é atravessada na hora. */
function epfAvancar(passos, i, t){
  const n = (passos || []).length;
  if(!n) return { i: 0, fim: true };
  let k = Math.max(0, Math.min(n - 1, i | 0));
  while(k < n - 1 && passos[k].tempo_s <= t) k++;
  return { i: k, fim: k === n - 1 && t >= passos[k].tempo_s };
}
const epfNum = (v, casas = 2) => v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const epfPct = (v, casas = 1) => v == null ? "—" : (Number(v) > 0 ? "+" : "") + epfNum(v, casas) + "%";
function epfTempo(s){
  const n = epfN(s);
  if(n == null) return "—";
  const t = Math.round(n), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), seg = t % 60;
  return h ? h + " h " + m + " min" : m ? m + " min " + seg + " s" : seg + " s";
}
/* Texto de cada campo do quadro do replay no passo atual. Grandeza de outra fase sai "—"; a que o computador não mediu, "não medido". */
function epfQuadro(p, totalS){
  if(!p) return { fase: "—", prof: "—", tempo: "—", torque: "—", rot: "—", vel: "—", pressao: "—", vol: "—", sobre: "—" };
  const perf = p.fase === "perfuracao";
  const un = (v, casas, u, semValor) => v == null ? semValor : epfNum(v, casas) + " " + u;
  return {
    fase: EPF_FASE_LBL[p.fase] || p.fase,
    prof: un(p.profundidade_m, 2, "m", "—"),
    tempo: epfTempo(p.tempo_s) + (totalS ? " de " + epfTempo(totalS) : ""),
    torque: perf ? un(p.torque_bar, 1, "bar", "não medido") : "—",
    rot: perf ? un(p.rotacao_rpm, 1, "rpm", "não medida") : "—",
    vel: un(p.velocidade_m_h, 0, "m/h", "—"),
    pressao: perf ? "—" : un(p.pressao_bar, 2, "bar", "não medida"),
    vol: perf ? "—" : (p.volume_acum_l == null ? "não medido" : epfNum(p.volume_acum_l / 1000, 3) + " m³"),
    sobre: perf ? "—" : (p.sobreconsumo_pct == null ? "não medido" : epfPct(p.sobreconsumo_pct, 0))
  };
}

/* ---------- tela ---------- */
let _epf = null;        // { linha, passos, resumo, series, i, t, vel, tocando, timer, ultimo, y, profMax, profFuro, el: {...} }
let _epfPedido = 0;     // descarta a leitura que voltar depois de fechar ou de abrir outra estaca
let _epfFocoAntes = null;
let _epfSujoAntes = false;   // "formulário alterado" (core.js) de quando a janela abriu

/* A janela só lê e pode abrir por cima de um diário em edição. O core marca "alterado" a cada input dentro de modal (a barra do
   replay) e limpa a marca quando um modal fecha; aqui a marca volta ao que era quando a janela abriu, para a atualização
   automática do app não recarregar um diário com alteração por salvar nem segurar a recarga por causa da barra. */
function epfRestaurarSujo(){
  if(typeof appFormSujo !== "function") return;
  if(_epfSujoAntes && !appFormSujo()) appMarcarSujo();
  else if(!_epfSujoAntes && appFormSujo()) appLimparSujo();
}

// o horário do Geodigitus é hora de Brasília: exibe como o geodigitus.js (geoHora, geoDia)
const epfHora = (ts) => ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";
const epfData = (ts) => ts ? new Date(ts).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";

function epfCabecalhoHTML(l){
  const obra = l.obra ? [l.obra.codigo, l.obra.nome].filter(Boolean).join(" — ") : "";
  const partes = [
    obra ? "Obra " + obra : "Sem obra definida",
    l.equipamento?.codigo ? "Máquina " + l.equipamento.codigo : "Sem máquina",
    l.perfuracao_inicio ? epfData(l.perfuracao_inicio) + " · perfuração " + epfHora(l.perfuracao_inicio) + "–" + epfHora(l.perfuracao_fim) : "",
    l.concretagem_inicio ? "concretagem " + epfHora(l.concretagem_inicio) + "–" + epfHora(l.concretagem_fim) : ""
  ].filter(Boolean);
  return `<div class="epf-cab"><span class="epf-numero">${esc(l.numero_txt || "sem número")}</span>${l.refuro ? `<span class="tag ambar" title="O número digitado no computador de bordo termina em R: a estaca foi furada de novo">Refuro</span>` : ""}<span class="epf-cab-meta">${esc(partes.join(" · "))}</span></div>`;
}
function epfResumoHTML(r, l){
  const un = (v, casas, u, semValor) => esc(v == null ? semValor : epfNum(v, casas) + " " + u);
  const grau = (v) => v == null ? "—" : epfNum(Number(v) / 10, 1) + "°";   // a linha guarda décimos de grau
  const sobre = r.sobreconsumo_pct == null ? "não medido" : geoTagSobre(r.sobreconsumo_pct);
  return `<div class="epf-resumo">
    ${/* html */ uiRotuloValor("Ø", un(r.diametro_mm, 0, "mm", "—"))}
    ${/* html */ uiRotuloValor("Profundidade", un(r.profundidade_m, 2, "m", "—"))}
    ${/* html */ uiRotuloValor("Perfuração", esc(epfTempo(r.tempo_perfuracao_s)))}
    ${/* html */ uiRotuloValor("Concretagem", esc(epfTempo(r.tempo_concretagem_s)))}
    ${/* html */ uiRotuloValor("Vol. executado", un(r.volume_m3, 3, "m³", "não medido"))}
    ${/* html */ uiRotuloValor("Vol. teórico", un(r.volume_teorico_m3, 3, "m³", "—"))}
    ${/* html */ uiRotuloValor("Sobreconsumo", sobre)}
    ${/* html */ uiRotuloValor("Torque máx.", un(r.torque_max_bar, 1, "bar", "—"))}
    ${/* html */ uiRotuloValor("Inclinação X / Y", esc(l.inclinacao_x == null && l.inclinacao_y == null ? "—" : grau(l.inclinacao_x) + " / " + grau(l.inclinacao_y)))}
  </div>`;
}
function epfRotuloSerie(s){
  const faixa = s.min < 0 ? "de " + epfNum(s.min, s.casas) + " a " + epfNum(s.max, s.casas) : "máx. " + epfNum(s.max, s.casas);
  return s.nome + " (" + s.unidade + ") · " + faixa;
}
function epfAreaHTML(e){
  const legenda = (fase) => {
    const itens = e.series.filter(s => s.fase === fase);
    return `<div class="epf-leg"><span class="rotulo-caps">${esc(EPF_FASE_LBL[fase])}</span>${itens.map(s => `<span class="epf-leg-item" title="Curva na escala do maior valor desta estaca"><span class="epf-leg-cor" data-epf-cor="${esc(s.chave)}"></span>${esc(epfRotuloSerie(s))}</span>`).join("")}${fase === "concretagem" && !itens.some(s => s.chave === "sobreconsumo_pct") ? `<span class="epf-leg-item">Sobreconsumo da fatia: não medido</span>` : ""}</div>`;
  };
  const campo = (rotulo, id) => uiRotuloValor(rotulo, `<span id="epf-v-${esc(id)}">—</span>`);
  return `<div class="epf-area">
    <div class="epf-col">
      <div class="epf-legendas">${/* html */ legenda("perfuracao")}${/* html */ legenda("concretagem")}</div>
      <div class="epf-grafico" id="epf-grafico"></div>
    </div>
    <div class="epf-replay">
      <div class="epf-controles">
        <button type="button" class="btn-sec btn-sm" id="btn-epf-tocar" title="Percorre a execução na ordem em que aconteceu: a perfuração do topo ao fundo e depois a concretagem do fundo ao topo">Tocar</button>
        <div class="serv-views" role="group" aria-label="Velocidade do replay">${EPF_VELOCIDADES.map(v => `<button type="button" class="serv-view-btn${v === e.vel ? " ativo" : ""}" data-epf-vel="${esc(v)}" aria-pressed="${v === e.vel ? "true" : "false"}" title="${v === 1 ? "No tempo real da execução" : esc(v) + " vezes mais rápido que a execução"}">${esc(v)}×</button>`).join("")}</div>
      </div>
      <input type="range" class="epf-barra" id="epf-barra" min="0" max="${esc(e.passos.length - 1)}" step="1" value="0" aria-label="Posição do replay" title="Arraste para ir a qualquer ponto da execução" />
      <div class="epf-pos" id="epf-pos"></div>
      <div class="epf-quadro">
        ${/* html */ campo("Fase", "fase")}
        ${/* html */ campo("Profundidade", "prof")}
        ${/* html */ campo("Tempo decorrido", "tempo")}
        ${/* html */ campo("Velocidade", "vel")}
        ${/* html */ campo("Torque", "torque")}
        ${/* html */ campo("Rotação", "rot")}
        ${/* html */ campo("Pressão", "pressao")}
        ${/* html */ campo("Volume acumulado", "vol")}
        ${/* html */ campo("Sobreconsumo da fatia", "sobre")}
      </div>
    </div>
  </div>`;
}

/* ---------- gráfico (SVG por DOM; cor só por style) ---------- */
const EPF_NS = "http://www.w3.org/2000/svg";
const EPF_GEO = { larg: 860, esq: 34, dir: 6, vao: 42, furo: 16, topo: 8, base: 8, altMin: 216, pxPorM: 24 };
function epfSvg(tag, attrs, estilo){
  const el = document.createElementNS(EPF_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  Object.assign(el.style, estilo || {});
  return el;
}
function epfDesenharGrafico(e){
  const alvo = $("epf-grafico"); if(!alvo) return;
  const G = EPF_GEO, painel = (G.larg - G.esq - G.dir - G.vao) / 2;
  const x0 = { perfuracao: G.esq, concretagem: G.esq + painel + G.vao };
  const altura = Math.max(G.altMin, Math.round(e.profMax * G.pxPorM)), H = G.topo + altura + G.base;
  const y = (prof) => G.topo + (e.profMax > 0 ? Math.max(0, Math.min(prof, e.profMax)) / e.profMax : 0) * altura;
  const svg = epfSvg("svg", { viewBox: "0 0 " + G.larg + " " + H, class: "epf-svg", role: "img",
    "aria-label": "Gráfico por profundidade da estaca " + (e.linha.numero_txt || "") + ": perfuração à esquerda e concretagem à direita" });
  const fundos = {};
  ["perfuracao", "concretagem"].forEach(fase => {
    fundos[fase] = svg.appendChild(epfSvg("rect", { x: x0[fase], y: G.topo, width: painel, height: altura }, { fill: "transparent", stroke: "var(--borda)" }));
    [0.25, 0.5, 0.75].forEach(f => svg.appendChild(epfSvg("line", { x1: x0[fase] + f * painel, x2: x0[fase] + f * painel, y1: G.topo, y2: G.topo + altura }, { stroke: "var(--borda)", strokeDasharray: "2 4" })));
  });
  // eixo da profundidade: 0 no topo; uma linha a cada meio metro, 1, 2 ou 5 m conforme o comprimento
  const passoM = e.profMax <= 6 ? 0.5 : e.profMax <= 14 ? 1 : e.profMax <= 30 ? 2 : 5;
  for(let k = 0; k * passoM <= e.profMax + 1e-9; k++){
    const d = k * passoM, yy = y(d);
    if(k) ["perfuracao", "concretagem"].forEach(fase => svg.appendChild(epfSvg("line", { x1: x0[fase], x2: x0[fase] + painel, y1: yy, y2: yy }, { stroke: "var(--borda)" })));
    const t = svg.appendChild(epfSvg("text", { x: G.esq - 5, y: yy, "text-anchor": "end", "dominant-baseline": "middle", "font-size": 10 }, { fill: "var(--txt-fraco)" }));
    t.textContent = epfNum(d, 1) + (k ? "" : " m");
  }
  // o furo, entre os dois painéis: no replay enche de cima para baixo (perfuração) e de baixo para cima (concreto)
  const xf = G.esq + painel + (G.vao - G.furo) / 2;
  svg.appendChild(epfSvg("rect", { x: xf, y: G.topo, width: G.furo, height: altura }, { fill: "var(--sup-2)", stroke: "var(--borda-forte)" }));
  const furo = svg.appendChild(epfSvg("rect", { x: xf, y: G.topo, width: G.furo, height: 0 }, { fill: "var(--sup-3)" }));
  const concreto = svg.appendChild(epfSvg("rect", { x: xf, y: G.topo + altura, width: G.furo, height: 0 }, { fill: "var(--txt-fraco)" }));
  // curvas
  ["perfuracao", "concretagem"].forEach(fase => {
    const ps = e.passos.filter(p => p.fase === fase);
    if(!ps.length){
      const t = svg.appendChild(epfSvg("text", { x: x0[fase] + painel / 2, y: G.topo + 24, "text-anchor": "middle", "font-size": 11 }, { fill: "var(--txt-fraco)" }));
      t.textContent = "O arquivo não traz a " + EPF_FASE_LBL[fase].toLowerCase() + " desta estaca";
      return;
    }
    e.series.filter(s => s.fase === fase).forEach(s => {
      const x = (v) => x0[fase] + (s.max > s.min ? (v - s.min) / (s.max - s.min) : 0) * painel;
      if(s.min < 0) svg.appendChild(epfSvg("line", { x1: x(0), x2: x(0), y1: G.topo, y2: G.topo + altura }, { stroke: s.cor, strokeDasharray: "4 3", opacity: "0.5" }));
      let d = "", solto = true;
      ps.forEach(p => {
        const v = p[s.chave];
        if(v == null || p.profundidade_m == null){ solto = true; return; }
        d += (solto ? "M" : "L") + x(v).toFixed(1) + " " + y(p.profundidade_m).toFixed(1);
        solto = false;
      });
      if(d) svg.appendChild(epfSvg("path", { d }, { fill: "none", stroke: s.cor, strokeWidth: "1.6", strokeLinejoin: "round", strokeLinecap: "round", strokeDasharray: s.tracejada ? "5 3" : "" }));
    });
  });
  const marcador = svg.appendChild(epfSvg("line", { x1: G.esq, x2: G.larg - G.dir, y1: G.topo, y2: G.topo }, { stroke: "var(--txt)", strokeWidth: "1.2" }));
  alvo.replaceChildren(svg);
  Object.assign(e, { y, altSvg: H, el: { svg, alvo, fundos, furo, concreto, marcador } });
}

/* ---------- replay ---------- */
function epfDesenharPasso(){
  const e = _epf; if(!e || !e.passos.length || !e.el) return;
  const p = e.passos[e.i], perf = p.fase === "perfuracao", G = EPF_GEO;
  const yy = e.y(p.profundidade_m ?? 0), topo = e.y(0), fundo = e.y(e.profFuro);
  e.el.marcador.setAttribute("y1", yy); e.el.marcador.setAttribute("y2", yy);
  e.el.furo.setAttribute("height", Math.max(0, (perf ? yy : fundo) - topo));
  const yConcreto = perf ? fundo : Math.min(fundo, e.y(Math.max(0, (p.profundidade_m ?? 0) - EPF_FATIA_M)));
  e.el.concreto.setAttribute("y", yConcreto); e.el.concreto.setAttribute("height", Math.max(0, fundo - yConcreto));
  e.el.fundos.perfuracao.style.fill = perf ? "var(--sup-2)" : "transparent";
  e.el.fundos.concretagem.style.fill = perf ? "transparent" : "var(--sup-2)";
  const q = epfQuadro(p, e.resumo.tempo_total_s);
  Object.keys(q).forEach(k => { const el = $("epf-v-" + k); if(el) el.textContent = q[k]; });
  const barra = $("epf-barra"); if(barra && Number(barra.value) !== e.i) barra.value = e.i;
  const pos = $("epf-pos"); if(pos) pos.textContent = "Fatia " + (e.i + 1) + " de " + e.passos.length;
  // gráfico de estaca funda rola: mantém o marcador à vista
  const cx = e.el.alvo, escala = e.el.svg.clientWidth / G.larg, px = yy * escala;
  if(escala > 0 && cx.scrollHeight > cx.clientHeight && (px < cx.scrollTop + 16 || px > cx.scrollTop + cx.clientHeight - 16)) cx.scrollTop = Math.max(0, px - cx.clientHeight / 2);
}
function epfAtualizarControles(){
  const e = _epf, b = $("btn-epf-tocar");
  if(b) b.textContent = e?.tocando ? "Pausar" : "Tocar";
  document.querySelectorAll("#epf-corpo [data-epf-vel]").forEach(x => {
    const ativo = !!e && Number(x.dataset.epfVel) === e.vel;
    x.classList.toggle("ativo", ativo); x.setAttribute("aria-pressed", ativo ? "true" : "false");
  });
}
function epfPararReplay(){
  const e = _epf;
  if(e){ if(e.timer) clearInterval(e.timer); e.timer = null; e.tocando = false; }
  epfAtualizarControles();
}
function epfTique(){
  const e = _epf;
  if(!e || !e.tocando || $("epf-modal")?.style.display === "none") return epfPararReplay();
  const agora = performance.now();
  e.t += Math.min(0.5, (agora - e.ultimo) / 1000) * e.vel;   // aba em segundo plano não faz o replay saltar
  e.ultimo = agora;
  const r = epfAvancar(e.passos, e.i, e.t);
  if(r.i !== e.i){ e.i = r.i; epfDesenharPasso(); }
  if(r.fim) epfPararReplay();   // chegou ao fim: para na última fatia
}
function epfTocarPausar(){
  const e = _epf; if(!e || !e.passos.length) return;
  if(e.tocando) return epfPararReplay();
  if(e.i >= e.passos.length - 1){ e.i = 0; e.t = 0; epfDesenharPasso(); }   // do fim, recomeça
  e.tocando = true; e.ultimo = performance.now();
  e.timer = setInterval(epfTique, 60);
  epfAtualizarControles();
}
function epfIrPara(i){
  const e = _epf; if(!e || !e.passos.length) return;
  e.i = Math.max(0, Math.min(e.passos.length - 1, Number(i) || 0));
  e.t = e.passos[e.i].tempo_s - e.passos[e.i].duracao_s;   // começo da fatia
  e.ultimo = performance.now();
  epfDesenharPasso();
}

/* ---------- abrir e fechar ---------- */
async function abrirPerfilEstaca(geoEstacaId){
  const modal = $("epf-modal"), corpo = $("epf-corpo");
  if(!geoEstacaId || !modal || !corpo) return;
  epfPararReplay(); _epf = null;
  const pedido = ++_epfPedido;
  if(modal.style.display === "none"){
    _epfFocoAntes = document.activeElement;
    _epfSujoAntes = typeof appFormSujo === "function" && appFormSujo();
  }
  corpo.innerHTML = `<p class="vazio">Carregando o perfil…</p>`;
  modal.style.display = "flex";
  $("btn-epf-fechar")?.focus();
  const { data, error } = await sb.from("geodigitus_estacas").select(EPF_COLUNAS).eq("id", geoEstacaId).maybeSingle();
  if(pedido !== _epfPedido) return;
  if(error || !data){
    corpo.innerHTML = uiVazio(error ? "Não foi possível ler o perfil desta estaca: " + error.message : "Esta estaca não está mais nas chegadas do Geodigitus.");
    return;
  }
  const passos = epfLinhaDoTempo(data.perfil, data.diametro_mm), resumo = epfResumo(data, passos);
  const profPassos = passos.map(p => p.profundidade_m).filter(v => v != null);
  const profFuro = Math.max(0, ...passos.filter(p => p.fase === "perfuracao").map(p => p.profundidade_m || 0));
  const profMax = Math.max(0, resumo.profundidade_m || 0, ...profPassos);
  _epf = { linha: data, passos, resumo, series: epfSeries(passos), i: 0, t: 0, vel: 16, tocando: false, timer: null, ultimo: 0,
    profMax, profFuro: profFuro || profMax, el: null };
  const area = passos.length ? epfAreaHTML(_epf) : uiVazio("O computador de bordo não mandou o perfil desta estaca: sem as fatias não há gráfico nem replay.");
  corpo.innerHTML = `${/* html */ epfCabecalhoHTML(data)}${/* html */ epfResumoHTML(resumo, data)}${/* html */ area}`;
  if(!passos.length) return;
  corpo.querySelectorAll("[data-epf-cor]").forEach(el => { const s = _epf.series.find(x => x.chave === el.dataset.epfCor); if(s) el.style.background = s.cor; });
  epfDesenharGrafico(_epf);
  epfDesenharPasso();
}
function epfFechar(){
  epfPararReplay();
  _epfPedido++; _epf = null;
  const modal = $("epf-modal"); if(!modal || modal.style.display === "none") return;
  modal.style.display = "none";
  $("epf-corpo").replaceChildren();
  setTimeout(epfRestaurarSujo, 0);   // depois de o core reagir ao fechamento do modal
  if(_epfFocoAntes && document.contains(_epfFocoAntes)) _epfFocoAntes.focus();
  _epfFocoAntes = null;
}

/* ---------- eventos ---------- */
function ligarEstacaPerfil(){
  $("btn-epf-fechar")?.addEventListener("click", epfFechar);
  $("epf-modal")?.addEventListener("click", (ev) => { if(ev.target === ev.currentTarget) epfFechar(); });   // clique no fundo fecha: a janela só lê
  document.addEventListener("keydown", (ev) => { if(ev.key === "Escape" && $("epf-modal") && $("epf-modal").style.display !== "none") epfFechar(); });
  $("epf-corpo")?.addEventListener("click", (ev) => {
    if(ev.target.closest("#btn-epf-tocar")) return epfTocarPausar();
    const v = ev.target.closest("[data-epf-vel]");
    if(v && _epf){ _epf.vel = Number(v.dataset.epfVel) || 1; epfAtualizarControles(); }
  });
  $("epf-corpo")?.addEventListener("input", (ev) => { if(ev.target.id === "epf-barra"){ epfIrPara(ev.target.value); epfRestaurarSujo(); } });
  // RDO: o selo "Geodigitus" da execução (geoBadgeExec) abre o perfil
  $("rdo-execs")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-epf-perfil]");
    if(b){ ev.preventDefault(); abrirPerfilEstaca(b.dataset.epfPerfil); }
  });
}

if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarEstacaPerfil);
  else ligarEstacaPerfil();
}
// teste em Node (scripts/testar-fase162.mjs): as funções puras também saem por module.exports
if(typeof module === "object" && module && module.exports){
  module.exports = { EPF_FATIA_M, epfTeoricoFatiaL, epfLinhaDoTempo, epfResumo, epfSeries, epfAvancar, epfQuadro, epfTempo };
}

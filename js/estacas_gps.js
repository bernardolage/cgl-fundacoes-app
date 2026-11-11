/* ====================================================================
   Módulo: croqui das estacas pelo GPS do computador de bordo — fase 168a (prefixo egp-)
   Carregado depois de js/estaca_perfil.js. Só leitura: nada é gravado, e nada sai para host de fora (sem fundo de mapa e sem
   biblioteca; o fundo de satélite é a 168b, que espera decisão).
   - Visão "GPS" da aba Estacas da obra, ao lado de Lista e Planta. renderEstacas (js/estacas.js) chama egpVisao a cada
     desenho: ela mostra ou esconde o bloco, decide se o botão aparece (só em obra com chegada com GPS) e desenha o croqui.
   - A POSIÇÃO É APROXIMADA. O teste de precisão da spec (11/11/2026) deu erro de metros, igual ou maior que a distância
     entre estacas. Por isso a tela diz isso sempre, o círculo tem tamanho fixo (não está em escala), não há rótulo, cota,
     distância entre estacas nem conflito, o zoom para em 40 m de largura e a barra de escala não desce de 5 m.
   - Estaca sem GPS não é desenhada e entra na contagem "sem posição": nenhuma posição é inventada. Estaca a mais de 300 m
     do centro da obra sai do desenho (achataria a escala) e vai para a lista "Longe do canteiro". Nada muda de obra sozinho.
   - Centro = mediana de latitude e de longitude; a estaca ignorada aparece apagada e não entra no centro.
   - Projeção: Mercator da web (a dos ladrilhos de mapa, para a 168b encaixar), levada a metros em volta do centro.
   - Cor do SVG só por token e por elemento.style; cada classe tem também um contorno diferente.
   egpTemGps, egpMercator, egpMediana, egpProjetar, egpDia, as três classificações (egpClasseDiario, egpFaixasProfundidade e
   egpClasseProfundidade, egpClasseRecencia), egpClasse, egpLegenda, egpResumo, egpResumoTexto, egpDistanciaTexto, egpTitulo,
   egpEnquadrar, egpZoom, egpArrastar, egpBarraEscala e egpCorpoHTML são puras (sem tela nem banco) e testadas por
   scripts/testar-fase168a.mjs.
   ==================================================================== */

const EGP_LONGE_M = 300;          // decisão da spec: acima disso a estaca está "longe do canteiro"
const EGP_AVISO = "Posição aproximada do computador de bordo: o erro é de alguns metros, às vezes maior que a distância entre estacas. Não é locação nem como executado.";
const EGP_VAZIO = "Nenhuma estaca desta obra chegou com a posição do computador de bordo. O croqui aparece quando a máquina manda o GPS junto com a estaca; estaca lançada à mão, por planilha ou por foto não tem posição.";
const EGP_TODAS_LONGE = "Nenhuma estaca ficou a menos de 300 m do centro das posições: não há canteiro para desenhar. Todas estão na lista abaixo.";
const EGP_COLUNAS = "id,numero_txt,diametro_mm,profundidade_m,perfuracao_inicio,situacao,refuro,latitude,longitude,equipamento_id,rdo_id,equipamento:equipamentos(codigo),arquivo:geodigitus_arquivos(data_arquivo)";
const EGP_RAIO_MERCATOR = 6378137;         // raio da projeção de Mercator da web (EPSG:3857)
const EGP_E2 = 0.00669437999014;           // excentricidade ao quadrado do elipsoide WGS84
const EGP_VAO_MIN_M = 40;                  // obra de uma estaca só (ou todas na mesma coordenada) abre com 40 m, não com zoom infinito
const EGP_LARGURA_MIN_M = 40;              // o zoom não mostra menos que isso de largura: abaixo, o desenho sugeriria precisão que o GPS não tem
const EGP_LARGURA_MAX_M = 1500;
const EGP_BARRAS_M = [5, 10, 20, 50, 100, 200, 500, 1000];
const EGP_RAIO_PX = 6;                     // círculo de tamanho fixo na tela
const EGP_MAX_LONGE_NA_LISTA = 100;
const EGP_VALIDADE_MS = 60000;             // a leitura vale um minuto; depois disso, voltar à visão lê de novo

const EGP_MODOS = [
  ["diario", "Diário", "Cor pela situação do diário: com diário, sem diário ou ignorada"],
  ["profundidade", "Profundidade", "Cor pela profundidade, em quatro faixas iguais entre a menor e a maior da obra"],
  ["recencia", "Recência", "Cor por quando a estaca foi feita: hoje, nos últimos 7 dias ou antes"]
];
/* aparência de cada classe: preenchimento e contorno por token (aplicados por style) e traço próprio, para a classe não depender só da cor */
const EGP_ESTILO = {
  com_diario: { fill: "var(--sucesso)",   stroke: "var(--txt)",       largura: 1.5, traco: "" },
  sem_diario: { fill: "var(--aviso)",     stroke: "var(--txt)",       largura: 1.5, traco: "3 2" },
  ignorada:   { fill: "var(--sup-0)",     stroke: "var(--txt-fraco)", largura: 1.5, traco: "1 2", opacidade: 0.75 },
  p1:         { fill: "var(--info)",      stroke: "var(--info-txt)",  largura: 1,   traco: "", opacidadeFundo: 0.25 },
  p2:         { fill: "var(--info)",      stroke: "var(--info-txt)",  largura: 1.5, traco: "", opacidadeFundo: 0.5 },
  p3:         { fill: "var(--info)",      stroke: "var(--info-txt)",  largura: 2,   traco: "", opacidadeFundo: 0.75 },
  p4:         { fill: "var(--info)",      stroke: "var(--info-txt)",  largura: 2.5, traco: "", opacidadeFundo: 1 },
  sem_prof:   { fill: "var(--sup-0)",     stroke: "var(--txt-fraco)", largura: 1.5, traco: "3 2" },
  hoje:       { fill: "var(--acao)",      stroke: "var(--txt)",       largura: 2.5, traco: "" },
  semana:     { fill: "var(--info)",      stroke: "var(--txt)",       largura: 1.5, traco: "3 2" },
  antes:      { fill: "var(--txt-fraco)", stroke: "var(--sup-0)",     largura: 1,   traco: "" },
  sem_data:   { fill: "var(--sup-0)",     stroke: "var(--txt-fraco)", largura: 1.5, traco: "3 2" }
};
const EGP_ROTULO = { com_diario: "com diário", sem_diario: "sem diário", ignorada: "ignorada", sem_prof: "sem profundidade",
  hoje: "hoje", semana: "últimos 7 dias", antes: "antes disso", sem_data: "sem data" };
const EGP_ORDEM = { diario: ["com_diario", "sem_diario"], profundidade: ["p1", "p2", "p3", "p4", "sem_prof"], recencia: ["hoje", "semana", "antes", "sem_data"] };

/* ---------- números e datas ---------- */
/* número de verdade, ou nulo: texto vazio, booleano, lista e lixo não viram zero */
function egpNumero(v){
  if(typeof v === "number") return Number.isFinite(v) ? v : null;
  if(typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const egpFmt = (v, casas = 1) => (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const egpPlural = (n, um, varios) => `${egpFmt(n, 0)} ${Number(n) === 1 ? um : varios}`;
const egpDataBR = (iso) => { const p = String(iso || "").slice(0, 10).split("-"); return p.length === 3 && p[2] ? `${p[2]}/${p[1]}/${p[0]}` : ""; };
function egpDiaUTC(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if(!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === m[0] ? t : null;
}
/* o mesmo dia de geoDia (js/geodigitus.js): início da perfuração em Brasília; senão a pasta do arquivo. Sem nenhum dos dois, sem dia. */
function egpDia(p){
  if(!p || typeof p !== "object") return "";
  if(p.perfuracao_inicio){
    const d = new Date(p.perfuracao_inicio);
    if(!isNaN(d.getTime())) return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  }
  const pasta = p.arquivo && p.arquivo.data_arquivo ? String(p.arquivo.data_arquivo).slice(0, 10) : "";
  return egpDiaUTC(pasta) != null ? pasta : "";
}

/* ---------- posição ---------- */
/* A estaca tem GPS? Latitude e longitude têm de ser números dentro da faixa. Sem isso ela não tem posição, e nenhuma é inventada. */
function egpTemGps(p){
  if(!p || typeof p !== "object") return false;
  const la = egpNumero(p.latitude), lo = egpNumero(p.longitude);
  return la != null && lo != null && Math.abs(la) < 90 && Math.abs(lo) <= 180;
}
/* Mercator da web, em metros da projeção (o mesmo x, y dos ladrilhos de mapa) */
function egpMercator(lat, lng){
  const rad = Math.PI / 180;
  return { mx: EGP_RAIO_MERCATOR * lng * rad, my: EGP_RAIO_MERCATOR * Math.log(Math.tan(Math.PI / 4 + lat * rad / 2)) };
}
function egpMediana(valores){
  const v = (Array.isArray(valores) ? valores : []).filter(x => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if(!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}
/* Projeção local das estacas com GPS.
   pontos: linhas de geodigitus_estacas (latitude, longitude, situacao e o resto que a tela usa).
   Devolve { centro, pontos, semGps, longe, caixa, escala }:
   - centro: mediana de latitude e de longitude das estacas com GPS que não estão ignoradas (só ignoradas: a mediana delas);
   - pontos: cada estaca com GPS, com mx, my (Mercator da web), x e y em metros a partir do centro (x para leste, y para
     norte), distancia_centro_m e longe (mais de 300 m do centro);
   - semGps: quantas linhas não têm posição; longe: quantas estão longe;
   - caixa: limites, em metros, dos pontos que não estão longe (nula quando todos estão);
   - escala: metros de terreno por metro da projeção em cada eixo, na latitude do centro (o cosseno da latitude, com o
     ajuste do elipsoide: sem ele o eixo norte-sul sairia 0,6% maior e uma estaca a 299 m viraria "longe"). */
function egpProjetar(pontos){
  const linhas = (Array.isArray(pontos) ? pontos : []).filter(p => p && typeof p === "object");
  const comGps = linhas.filter(egpTemGps);
  const vazio = { centro: null, pontos: [], semGps: linhas.length - comGps.length, longe: 0, caixa: null, escala: null };
  if(!comGps.length) return vazio;
  const validas = comGps.filter(p => p.situacao !== "ignorada");
  const base = validas.length ? validas : comGps;
  const lat0 = egpMediana(base.map(p => egpNumero(p.latitude))), lng0 = egpMediana(base.map(p => egpNumero(p.longitude)));
  const c = egpMercator(lat0, lng0), rad = Math.PI / 180;
  const s2 = Math.sin(lat0 * rad) ** 2, w = 1 - EGP_E2 * s2, cos0 = Math.cos(lat0 * rad);
  const kx = cos0 / Math.sqrt(w), ky = cos0 * (1 - EGP_E2) / Math.pow(w, 1.5);
  const out = comGps.map(p => {
    const m = egpMercator(egpNumero(p.latitude), egpNumero(p.longitude));
    const x = (m.mx - c.mx) * kx, y = (m.my - c.my) * ky, d = Math.hypot(x, y);
    return { ...p, mx: m.mx, my: m.my, x, y, distancia_centro_m: d, longe: d > EGP_LONGE_M };
  });
  const perto = out.filter(p => !p.longe);
  const caixa = !perto.length ? null : perto.reduce((b, p) => ({ minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  if(caixa){ caixa.largura = caixa.maxX - caixa.minX; caixa.altura = caixa.maxY - caixa.minY; }
  return { centro: { latitude: lat0, longitude: lng0, mx: c.mx, my: c.my }, pontos: out, semGps: vazio.semGps, longe: out.length - perto.length,
    caixa, escala: { x: kx, y: ky } };
}

/* ---------- cor por ---------- */
function egpClasseDiario(p){
  if(p && p.situacao === "ignorada") return "ignorada";
  return p && p.rdo_id ? "com_diario" : "sem_diario";
}
/* Quatro faixas iguais entre a menor e a maior profundidade. Profundidade nula ou zero não entra na conta. Sem nenhuma, nulo. */
function egpFaixasProfundidade(pontos){
  const v = (Array.isArray(pontos) ? pontos : []).map(p => egpNumero(p && p.profundidade_m)).filter(x => x != null && x > 0);
  if(!v.length) return null;
  const min = Math.min(...v), max = Math.max(...v), passo = (max - min) / 4;
  return { min, max, unica: min === max, limites: [min, min + passo, min + 2 * passo, min + 3 * passo, max] };
}
/* p1 (mais rasa) a p4 (mais funda); o limite entre duas faixas é da faixa de cima e a maior profundidade é da última */
function egpClasseProfundidade(prof, faixas){
  const v = egpNumero(prof);
  if(v == null || v <= 0 || !faixas) return "sem_prof";
  if(faixas.unica) return "p4";
  const i = Math.floor((v - faixas.min) / (faixas.max - faixas.min) * 4 + 1e-9);
  return "p" + (Math.max(0, Math.min(3, i)) + 1);
}
/* hoje, últimos 7 dias (de ontem a sete dias atrás) ou antes. Dia inválido ou adiante de hoje (relógio do computador errado) é "sem data". */
function egpClasseRecencia(dia, hoje){
  const a = egpDiaUTC(dia), b = egpDiaUTC(hoje);
  if(a == null || b == null) return "sem_data";
  const n = Math.round((b - a) / 86400000);
  if(n < 0) return "sem_data";
  return n === 0 ? "hoje" : n <= 7 ? "semana" : "antes";
}
/* A classe da estaca no modo escolhido. A ignorada é "ignorada" nos três modos: sempre apagada. ctx = { hoje, faixas } */
function egpClasse(p, modo, ctx){
  if(p && p.situacao === "ignorada") return "ignorada";
  if(modo === "profundidade") return egpClasseProfundidade(p && p.profundidade_m, ctx && ctx.faixas);
  if(modo === "recencia") return egpClasseRecencia(egpDia(p), ctx && ctx.hoje);
  return egpClasseDiario(p);
}
/* Linhas da legenda do modo, com a contagem do que está desenhado: [{ classe, rotulo, qtd }]. Classe sem estaca não aparece, fora
   as faixas de profundidade, que mostram sempre os limites. */
function egpLegenda(visiveis, modo, ctx){
  const m = EGP_ORDEM[modo] ? modo : "diario", f = ctx && ctx.faixas, qtd = {};
  (Array.isArray(visiveis) ? visiveis : []).forEach(p => { const c = egpClasse(p, m, ctx); qtd[c] = (qtd[c] || 0) + 1; });
  const rotulo = (c) => {
    if(!/^p[1-4]$/.test(c)) return EGP_ROTULO[c] || c;
    if(!f) return "";
    if(f.unica) return `${egpFmt(f.min)} m`;
    const i = Number(c[1]) - 1;
    return `${egpFmt(f.limites[i])} a ${egpFmt(f.limites[i + 1])} m`;
  };
  return EGP_ORDEM[m].concat("ignorada")
    .filter(c => qtd[c] || (/^p[1-4]$/.test(c) && f && !f.unica))
    .map(c => ({ classe: c, rotulo: rotulo(c), qtd: qtd[c] || 0 }));
}

/* ---------- resumo e textos ---------- */
/* Contagens da linha de resumo e o intervalo de dias das estacas com GPS */
function egpResumo(proj){
  const pts = proj && Array.isArray(proj.pontos) ? proj.pontos : [];
  const dias = pts.map(egpDia).filter(Boolean).sort();
  return { comGps: pts.length, semGps: (proj && proj.semGps) || 0, longe: (proj && proj.longe) || 0,
    ignoradas: pts.filter(p => p.situacao === "ignorada" && !p.longe).length, de: dias[0] || "", ate: dias[dias.length - 1] || "" };
}
function egpResumoTexto(r){
  const x = r || {}, partes = [`${egpPlural(x.comGps || 0, "estaca com GPS", "estacas com GPS")}`,
    `${egpFmt(x.semGps || 0, 0)} sem posição (sem GPS)`, `${egpFmt(x.longe || 0, 0)} longe do canteiro`];
  if(x.de && x.ate){
    const ano = x.de.slice(0, 4) !== x.ate.slice(0, 4), d = (iso) => ano ? egpDataBR(iso) : egpDataBR(iso).slice(0, 5);
    partes.push(x.de === x.ate ? `em ${d(x.de)}` : `de ${d(x.de)} a ${d(x.ate)}`);
  }
  return partes.join(" · ");
}
/* Distância ao centro, sempre arredondada e com "cerca de": o GPS não dá mais que isso */
function egpDistanciaTexto(m){
  const v = egpNumero(m);
  if(v == null || v < 0) return "";
  if(v < 1000) return `cerca de ${egpFmt(Math.round(v / 10) * 10, 0)} m`;
  return `cerca de ${egpFmt(v / 1000, v < 100000 ? 1 : 0)} km`;
}
const egpMaquina = (p) => (p && p.equipamento && p.equipamento.codigo) || (p && p.equipamento_id ? "máquina sem código" : "sem máquina");
/* Texto do title e do aria-label do círculo: número, Ø, profundidade, data e máquina, e a situação do diário */
function egpTitulo(p){
  if(!p) return "";
  const dia = egpDia(p), d = egpNumero(p.diametro_mm), prof = egpNumero(p.profundidade_m);
  const partes = [`Estaca ${p.numero_txt || "sem número"}${p.refuro ? " (Refurada)" : ""}`, d != null && d > 0 ? `Ø ${egpFmt(d, 0)} mm` : "Ø não informado",
    prof != null && prof > 0 ? `${egpFmt(prof, 2)} m` : "sem profundidade", dia ? egpDataBR(dia) : "sem data", egpMaquina(p), EGP_ROTULO[egpClasseDiario(p)]];
  return partes.join(" · ") + "\nPosição aproximada. Clique para ver o perfil.";
}

/* ---------- visor: o que do terreno aparece no desenho ---------- */
/* v = { cx, cy, mpp }: centro em metros (cx para leste, cy para SUL, que é o sentido do y da tela) e metros por pixel */
function egpLimitesMpp(largPx){
  const w = Math.max(1, Number(largPx) || 0);
  return { min: EGP_LARGURA_MIN_M / w, max: EGP_LARGURA_MAX_M / w };
}
/* Enquadra a caixa dos pontos com folga. Caixa nula, de um ponto só ou de pontos iguais abre com 40 m. */
function egpEnquadrar(caixa, largPx, altPx){
  const w = Math.max(1, Number(largPx) || 0), h = Math.max(1, Number(altPx) || 0);
  const c = caixa || { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const larg = Math.max(c.maxX - c.minX, EGP_VAO_MIN_M), alt = Math.max(c.maxY - c.minY, EGP_VAO_MIN_M), lim = egpLimitesMpp(w);
  const mpp = Math.max(lim.min, Math.min(lim.max, Math.max(larg / (w * 0.84), alt / (h * 0.84))));
  return { cx: (c.minX + c.maxX) / 2, cy: -(c.minY + c.maxY) / 2, mpp };
}
/* Zoom com o ponto sob o cursor parado. fator > 1 aproxima. fx, fy em pixels a partir do canto do desenho. */
function egpZoom(v, fator, fx, fy, largPx, altPx){
  const w = Math.max(1, Number(largPx) || 0), h = Math.max(1, Number(altPx) || 0), lim = egpLimitesMpp(w);
  const f = Number(fator) > 0 ? Number(fator) : 1;
  const mpp = Math.max(lim.min, Math.min(lim.max, v.mpp / f));
  const dx = (fx == null ? w / 2 : fx) - w / 2, dy = (fy == null ? h / 2 : fy) - h / 2;
  return { cx: v.cx + dx * (v.mpp - mpp), cy: v.cy + dy * (v.mpp - mpp), mpp };
}
function egpArrastar(v, dxPx, dyPx){ return { cx: v.cx - dxPx * v.mpp, cy: v.cy - dyPx * v.mpp, mpp: v.mpp }; }
/* Barra de escala: a maior das medidas redondas que cabe em maxPx; nunca menor que 5 m */
function egpBarraEscala(mpp, maxPx = 140){
  const m = Number(mpp) > 0 ? Number(mpp) : 1;
  const metros = EGP_BARRAS_M.filter(b => b / m <= maxPx).pop() || EGP_BARRAS_M[0];
  return { metros, px: metros / m };
}

/* ---------- HTML ---------- */
function egpAvisoHTML(){ return `<p class="egp-aviso" role="note">${esc(EGP_AVISO)}</p>`; }
function egpLegendaHTML(itens){
  return (itens || []).map(l => `<span class="egp-leg"><svg class="egp-leg-svg" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" data-egp-classe="${esc(l.classe)}"></circle></svg>${esc(l.rotulo)} (${esc(egpFmt(l.qtd, 0))})</span>`).join("");
}
function egpLongeHTML(longe){
  const l = (longe || []).slice().sort((a, b) => (a.situacao === "ignorada") - (b.situacao === "ignorada") || b.distancia_centro_m - a.distancia_centro_m);
  if(!l.length) return "";
  const linhas = l.slice(0, EGP_MAX_LONGE_NA_LISTA).map(p => uiLinhaItem(`${p.numero_txt || "sem número"}${p.refuro ? " (Refurada)" : ""}`,
    [egpDataBR(egpDia(p)) || "sem data", egpMaquina(p), p.situacao === "ignorada" ? "ignorada" : ""].filter(Boolean).join(" · "), egpDistanciaTexto(p.distancia_centro_m), "do centro")).join("");
  const resto = l.length > EGP_MAX_LONGE_NA_LISTA ? `<p class="egp-nota">E mais ${esc(egpFmt(l.length - EGP_MAX_LONGE_NA_LISTA, 0))}, mais perto que estas.</p>` : "";
  const corpo = `<p class="egp-nota egp-nota-topo">Confira se a chegada é mesmo desta obra, em Diário de Obra › Chegadas do Geodigitus (procure pelo código da obra). Pode ser estaca de outra obra ou GPS sem sinal. Estas estacas não entram no desenho, e nada muda de obra sozinho.</p>${/* html */ linhas}${/* html */ resto}`;
  return `<div class="egp-longe">${uiSecao("nota", `Longe do canteiro (${egpFmt(l.length, 0)})`, corpo, "a mais de 300 m do centro")}</div>`;
}
/* O bloco inteiro. e = { proj, modo, esconderIgn, erro }. O aviso de posição aproximada abre o bloco em todos os estados. */
function egpCorpoHTML(e){
  const x = e || {}, proj = x.proj || egpProjetar([]), r = egpResumo(proj), modo = EGP_ORDEM[x.modo] ? x.modo : "diario";
  if(x.erro) return `${egpAvisoHTML()}${uiVazio("Não foi possível ler as posições do computador de bordo: " + x.erro)}`;
  if(!r.comGps){
    return `${egpAvisoHTML()}${uiVazio(EGP_VAZIO)}${r.semGps ? `<p class="egp-nota">${esc(egpPlural(r.semGps, "estaca do computador de bordo desta obra veio", "estacas do computador de bordo desta obra vieram"))} sem GPS: sem posição, não há o que desenhar, e nenhuma posição é inventada.</p>` : ""}`;
  }
  const perto = proj.pontos.filter(p => !p.longe), longe = proj.pontos.filter(p => p.longe);
  const botoes = EGP_MODOS.map(m => `<button type="button" class="serv-view-btn${m[0] === modo ? " ativo" : ""}" data-egp-cor="${esc(m[0])}" aria-pressed="${m[0] === modo ? "true" : "false"}" title="${esc(m[2])}">${esc(m[1])}</button>`).join("");
  const caixaIgn = r.ignoradas ? `<label class="egp-check" title="A estaca ignorada nas Chegadas aparece apagada: pode ser furo de teste no mesmo canteiro"><input type="checkbox" id="egp-ign"${x.esconderIgn ? " checked" : ""} /> Esconder ignoradas (${esc(egpFmt(r.ignoradas, 0))})</label>` : "";
  const desenho = perto.length ? `<div class="planta-toolbar egp-barra">
      <div class="egp-modos"><span class="rotulo-caps">Cor por</span><div class="serv-views" role="group" aria-label="Cor por">${/* html */ botoes}</div></div>
      ${/* html */ caixaIgn}
      <div class="planta-zoom">
        <button type="button" class="btn-sec btn-sm" data-egp-zoom="mais" title="Aproximar" aria-label="Aproximar">+</button>
        <button type="button" class="btn-sec btn-sm" data-egp-zoom="menos" title="Afastar" aria-label="Afastar">−</button>
        <button type="button" class="btn-sec btn-sm" data-egp-zoom="tudo" title="Ver todas as estacas do canteiro" aria-label="Ver todas as estacas do canteiro">⛶</button>
      </div>
    </div>
    <div class="egp-legenda" id="egp-legenda"></div>
    <div class="egp-area" id="egp-area">
      <svg id="egp-svg" role="group" aria-label="Croqui das estacas pela posição aproximada do computador de bordo, norte para cima"></svg>
      <div class="egp-norte" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V4M6 10l6-6 6 6"/></svg><span>N</span></div>
      <div class="egp-escala" aria-hidden="true"><span class="egp-escala-barra" id="egp-escala-barra"></span><span id="egp-escala-txt"></span></div>
    </div>
    <p class="egp-nota">Norte para cima. Cada círculo é uma estaca registrada pelo computador de bordo. O círculo tem tamanho fixo e não está em escala, e duas estacas vizinhas podem aparecer uma sobre a outra ou trocadas de lugar. Clique numa estaca para ver o perfil.</p>`
    : uiVazio(EGP_TODAS_LONGE);
  return `${egpAvisoHTML()}<p class="egp-resumo">${esc(egpResumoTexto(r))}</p>${/* html */ desenho}${/* html */ egpLongeHTML(longe)}`;
}

/* ---------- tela ---------- */
function egpEstadoNovo(obraId){
  return { obraId: obraId || null, tem: false, linhas: null, proj: null, erro: "", lidoEm: 0, montado: 0, lendo: false,
    modo: "diario", esconderIgn: false, visor: null, mexeu: false, tam: null, raio: 0, obs: null };
}
let _egp = egpEstadoNovo(null);   // trocado inteiro a cada obra: leitura que volta depois da troca confere a obra e é descartada

/* Chamada por renderEstacas (js/estacas.js) a cada desenho da aba. visao = a visão atual; outros = os blocos das outras visões.
   Devolve true quando a visão GPS cuidou do desenho (renderEstacas para ali). */
function egpVisao(visao, outros){
  const wrap = $("est-gps-wrap"), obraId = typeof obraEditId !== "undefined" && obraEditId ? obraEditId : null;
  if(obraId !== _egp.obraId){
    egpTrocarObra(obraId);
    // obra nova abre na Lista (ou no Acompanhamento raiz): o botão GPS só volta se esta obra tiver estaca com posição
    const lista = visao === "gps" ? document.querySelector('[data-est-view="lista"]') : null;
    if(lista){ lista.click(); return true; }
  }
  const ativa = visao === "gps";
  if(wrap) wrap.style.display = ativa ? "" : "none";
  egpFiltros(!ativa);
  egpBotao();
  if(!ativa) return false;
  (outros || []).forEach(el => { if(el) el.style.display = "none"; });
  egpRender();
  return true;
}
/* os filtros da aba (busca, status, tipo, local) são das estacas do projeto e não filtram o croqui: somem enquanto a visão é a GPS */
function egpFiltros(mostrar){
  const f = $("est-gps-wrap")?.parentElement?.querySelector(".serv-filtros");
  if(f) f.style.display = mostrar ? "" : "none";
}
function egpBotao(){
  const b = $("btn-est-view-gps");
  if(b) b.style.display = _egp.tem || b.classList.contains("ativo") ? "" : "none";
}
function egpTrocarObra(obraId){
  if(_egp.obs) _egp.obs.disconnect();
  _egp = egpEstadoNovo(obraId);
  const cont = $("egp-conteudo");
  if(cont) cont.replaceChildren();
  egpBotao();
  if(obraId) egpContar(obraId);
}
/* O botão só aparece na obra que tem ao menos uma chegada com GPS: uma contagem, sem trazer linha */
async function egpContar(obraId){
  const { count, error } = await Promise.resolve(sb.from("geodigitus_estacas").select("id", { count: "exact", head: true })
    .eq("obra_id", obraId).not("latitude", "is", null).not("longitude", "is", null)).catch(e => ({ count: 0, error: e }));
  if(obraId !== _egp.obraId) return;
  if(error) console.error("Croqui pelo GPS, contagem:", error);
  _egp.tem = !error && Number(count) > 0;
  egpBotao();
}

/* Lê as chegadas da obra (uma vez por minuto, no máximo) e desenha. A obra pode passar de 1.000 chegadas: lerTudo, com a chave id. */
async function egpRender(){
  const cont = $("egp-conteudo"), obraId = _egp.obraId;
  if(!cont) return;
  if(!obraId){ cont.innerHTML = `${egpAvisoHTML()}${uiVazio("Salve a obra para ver as posições do computador de bordo.")}`; return; }
  const fresco = _egp.linhas && Date.now() - _egp.lidoEm < EGP_VALIDADE_MS;
  if(_egp.linhas) egpMontar();
  if(fresco || _egp.lendo) return;
  if(!_egp.linhas) cont.innerHTML = `${egpAvisoHTML()}${uiVazio("Carregando as posições do computador de bordo…")}`;
  _egp.lendo = true;
  const r = await lerTudo(() => sb.from("geodigitus_estacas").select(EGP_COLUNAS).eq("obra_id", obraId), "id").catch(e => ({ data: [], error: e }));   // sem rede: a tela diz, não fica em "Carregando"
  if(obraId !== _egp.obraId) return;
  _egp.lendo = false;
  if(r.error){
    console.error("Croqui pelo GPS, leitura:", r.error);
    if(!_egp.linhas){ _egp.erro = r.error.message || "erro de leitura"; cont.innerHTML = egpCorpoHTML({ erro: _egp.erro }); }
    return;
  }
  _egp.erro = "";
  _egp.linhas = r.data || [];
  _egp.proj = egpProjetar(_egp.linhas);
  _egp.lidoEm = Date.now();
  if(egpResumo(_egp.proj).comGps){ _egp.tem = true; egpBotao(); }
  egpMontar();
}
/* Monta o bloco uma vez por leitura; redesenhos da aba (filtro, busca) não refazem nada */
function egpMontar(){
  const cont = $("egp-conteudo");
  if(!cont || !_egp.proj) return;
  if(_egp.montado === _egp.lidoEm && cont.firstChild) return;
  _egp.montado = _egp.lidoEm;
  if(_egp.obs){ _egp.obs.disconnect(); _egp.obs = null; }
  cont.innerHTML = egpCorpoHTML({ proj: _egp.proj, modo: _egp.modo, esconderIgn: _egp.esconderIgn });
  if(cont.dataset.egpLigado !== "1"){
    cont.dataset.egpLigado = "1";
    cont.addEventListener("click", egpCliqueBarra);
    cont.addEventListener("change", (ev) => { if(ev.target && ev.target.id === "egp-ign"){ _egp.esconderIgn = !!ev.target.checked; egpDesenhar(); } });
  }
  const svg = $("egp-svg"), area = $("egp-area");
  if(!svg || !area) return;
  egpLigarDesenho(svg);
  if(typeof ResizeObserver === "function"){
    _egp.obs = new ResizeObserver(() => egpAplicarVisor());
    _egp.obs.observe(area);
  }
  egpDesenhar();
}
function egpVisiveis(){
  return (_egp.proj ? _egp.proj.pontos : []).filter(p => !p.longe && !(_egp.esconderIgn && p.situacao === "ignorada"));
}
function egpContexto(){
  const base = (_egp.proj ? _egp.proj.pontos : []).filter(p => !p.longe && p.situacao !== "ignorada");
  return { hoje: typeof hojeISO === "function" ? hojeISO() : "", faixas: egpFaixasProfundidade(base) };
}
/* cor e contorno do círculo (do desenho e da legenda): sempre por style, que é onde o SVG aceita token */
function egpPintar(el, classe){
  const s = EGP_ESTILO[classe] || EGP_ESTILO.sem_data;
  el.style.fill = s.fill;
  el.style.fillOpacity = s.opacidadeFundo != null ? String(s.opacidadeFundo) : "";
  el.style.stroke = s.stroke;
  el.style.strokeWidth = s.largura + "px";
  el.style.strokeDasharray = s.traco || "";
  el.style.opacity = s.opacidade != null ? String(s.opacidade) : "";
}
/* Os círculos: ignoradas por baixo, depois da mais antiga para a mais nova */
function egpDesenhar(){
  const svg = $("egp-svg");
  if(!svg) return;
  const ns = "http://www.w3.org/2000/svg", ctx = egpContexto();
  const pts = egpVisiveis().sort((a, b) => (b.situacao === "ignorada") - (a.situacao === "ignorada") || String(a.perfuracao_inicio || "").localeCompare(String(b.perfuracao_inicio || "")));
  const frag = document.createDocumentFragment();
  pts.forEach(p => {
    const c = document.createElementNS(ns, "circle"), titulo = egpTitulo(p);
    c.setAttribute("class", "egp-ponto");
    c.setAttribute("cx", p.x);
    c.setAttribute("cy", -p.y);
    c.setAttribute("role", "button");
    c.setAttribute("tabindex", "0");
    c.setAttribute("aria-label", titulo);
    c.dataset.egpId = p.id;
    const t = document.createElementNS(ns, "title");
    t.textContent = titulo;
    c.appendChild(t);
    c.dataset.egpClasse = egpClasse(p, _egp.modo, ctx);
    egpPintar(c, c.dataset.egpClasse);
    frag.appendChild(c);
  });
  svg.replaceChildren(frag);
  egpLegendaDesenhar(pts, ctx);
  _egp.raio = 0;
  egpAplicarVisor();
}
/* Troca de "cor por": os círculos ficam onde estão e só muda a aparência de quem mudou de classe */
function egpRepintar(){
  const svg = $("egp-svg");
  if(!svg) return;
  const ctx = egpContexto(), pts = egpVisiveis(), porId = new Map(pts.map(p => [String(p.id), p]));
  svg.querySelectorAll("circle.egp-ponto").forEach(c => {
    const p = porId.get(c.dataset.egpId), k = p ? egpClasse(p, _egp.modo, ctx) : "";
    if(k && c.dataset.egpClasse !== k){ c.dataset.egpClasse = k; egpPintar(c, k); }
  });
  egpLegendaDesenhar(pts, ctx);
}
function egpLegendaDesenhar(pts, ctx){
  const leg = $("egp-legenda");
  if(!leg) return;
  leg.innerHTML = egpLegendaHTML(egpLegenda(pts, _egp.modo, ctx));
  leg.querySelectorAll("[data-egp-classe]").forEach(el => egpPintar(el, el.dataset.egpClasse));
}
/* Aplica o visor: viewBox em metros, raio do círculo fixo em pixels e barra de escala. Sem tamanho (aba escondida), espera o ResizeObserver. */
function egpAplicarVisor(){
  const svg = $("egp-svg");
  if(!svg || !_egp.proj) return;
  const w = svg.clientWidth, h = svg.clientHeight;
  if(!w || !h) return;
  if(!_egp.visor || !_egp.mexeu) _egp.visor = egpEnquadrar(_egp.proj.caixa, w, h);
  _egp.tam = { w, h };
  const v = _egp.visor;
  svg.setAttribute("viewBox", `${v.cx - w * v.mpp / 2} ${v.cy - h * v.mpp / 2} ${w * v.mpp} ${h * v.mpp}`);
  const r = EGP_RAIO_PX * v.mpp;
  if(r !== _egp.raio){ _egp.raio = r; svg.querySelectorAll("circle.egp-ponto").forEach(c => c.setAttribute("r", r)); }   // arrastar não mexe no raio
  const b = egpBarraEscala(v.mpp), barra = $("egp-escala-barra"), txt = $("egp-escala-txt");
  if(barra) barra.style.width = Math.round(b.px) + "px";
  if(txt) txt.textContent = `${egpFmt(b.metros, 0)} m`;
}
function egpMexer(visor){ _egp.visor = visor; _egp.mexeu = true; egpAplicarVisor(); }
/* Botões da barra: cor por e zoom */
function egpCliqueBarra(ev){
  const cor = ev.target.closest("[data-egp-cor]"), zoom = ev.target.closest("[data-egp-zoom]");
  if(cor){
    _egp.modo = cor.dataset.egpCor;
    cor.parentElement.querySelectorAll("[data-egp-cor]").forEach(b => { const on = b === cor; b.classList.toggle("ativo", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    egpRepintar();
    return;
  }
  if(!zoom || !_egp.visor || !_egp.tam) return;
  if(zoom.dataset.egpZoom === "tudo"){ _egp.mexeu = false; egpAplicarVisor(); return; }
  egpMexer(egpZoom(_egp.visor, zoom.dataset.egpZoom === "mais" ? 1.4 : 1 / 1.4, null, null, _egp.tam.w, _egp.tam.h));
}
/* Arrasto, roda do mouse, pinça e o clique na estaca (que abre o perfil da fase 162). O desenho só captura o ponteiro depois
   que o arrasto começa, para o clique continuar chegando ao círculo. */
function egpLigarDesenho(svg){
  const dedos = new Map();
  let arrastou = false, pinca = 0;
  const pos = (ev) => { const r = svg.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  svg.addEventListener("pointerdown", (ev) => {
    if(ev.pointerType === "mouse" && ev.button !== 0) return;
    dedos.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY });
    if(dedos.size === 1) arrastou = false;
    if(dedos.size === 2){ const [a, b] = [...dedos.values()]; pinca = Math.hypot(a.x - b.x, a.y - b.y); arrastou = true; }
  });
  svg.addEventListener("pointermove", (ev) => {
    const d = dedos.get(ev.pointerId);
    if(!d || !_egp.visor || !_egp.tam) return;
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if(dedos.size === 1){
      if(!arrastou && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 5) return;
      if(!arrastou){ arrastou = true; svg.classList.add("egp-arrastando"); try { svg.setPointerCapture(ev.pointerId); } catch(e){ /* ponteiro já solto */ } }
      d.x = ev.clientX; d.y = ev.clientY;
      egpMexer(egpArrastar(_egp.visor, dx, dy));
      return;
    }
    d.x = ev.clientX; d.y = ev.clientY;
    if(dedos.size === 2 && pinca > 0){
      const [a, b] = [...dedos.values()], dist = Math.hypot(a.x - b.x, a.y - b.y), r = svg.getBoundingClientRect();
      if(dist > 0) egpMexer(egpZoom(_egp.visor, dist / pinca, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, _egp.tam.w, _egp.tam.h));
      pinca = dist;
    }
  });
  const soltar = (ev) => { dedos.delete(ev.pointerId); if(!dedos.size) svg.classList.remove("egp-arrastando"); if(dedos.size < 2) pinca = 0; };
  svg.addEventListener("pointerup", soltar);
  svg.addEventListener("pointercancel", soltar);
  svg.addEventListener("wheel", (ev) => {
    if(!_egp.visor || !_egp.tam) return;
    ev.preventDefault();
    const p = pos(ev);
    egpMexer(egpZoom(_egp.visor, ev.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y, _egp.tam.w, _egp.tam.h));
  }, { passive: false });
  const abrir = (alvo) => {
    const c = alvo && alvo.closest ? alvo.closest("circle.egp-ponto") : null;
    if(c && c.dataset.egpId && typeof abrirPerfilEstaca === "function") abrirPerfilEstaca(c.dataset.egpId);
  };
  svg.addEventListener("click", (ev) => { if(arrastou){ arrastou = false; return; } abrir(ev.target); });
  svg.addEventListener("keydown", (ev) => { if(ev.key === "Enter" || ev.key === " "){ const c = ev.target.closest && ev.target.closest("circle.egp-ponto"); if(c){ ev.preventDefault(); abrir(c); } } });
}

// teste em Node (scripts/testar-fase168a.mjs): as funções puras também saem por module.exports
if(typeof module === "object" && module && module.exports){
  module.exports = { EGP_LONGE_M, EGP_AVISO, EGP_VAZIO, EGP_COLUNAS, EGP_ESTILO, EGP_LARGURA_MIN_M, egpNumero, egpTemGps, egpMercator, egpMediana, egpProjetar, egpDia,
    egpClasseDiario, egpFaixasProfundidade, egpClasseProfundidade, egpClasseRecencia, egpClasse, egpLegenda, egpResumo, egpResumoTexto,
    egpDistanciaTexto, egpTitulo, egpEnquadrar, egpZoom, egpArrastar, egpBarraEscala, egpCorpoHTML };
}

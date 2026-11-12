// =====================================================================
// Leitura da planta do projeto do cliente: regras puras (prefixo ppl-), sem tela e sem banco.
// Ladrilhos, junção do que a IA leu em cada ladrilho, puxar o nome para o centro do símbolo (js/planta_detector.js),
// casar com as estacas da obra e o caso do pilar cadastrado como estaca. A tela fica em js/planta_leitura.js.
// Testado em scripts/testar-fase175b.mjs (Node) e medido em scripts/testar-fase175-leitura.html.
// =====================================================================

const PPL_LADO_PX = 1092;          // lado do ladrilho: a IA de imagem vê até ~1,15 MP sem reduzir
const PPL_SOBRA_PX = 160;          // sobreposição entre ladrilhos vizinhos (um nome cortado num aparece inteiro no outro)
const PPL_RAIO_ALVO_PX = 22;       // a escala do desenho deixa o símbolo da estaca com ~22 px de raio
const PPL_ESCALA_MIN = 2;          // pixels por ponto do PDF
const PPL_ESCALA_MAX = 6;
const PPL_PUXAR_RAIOS = 2.5;       // nome lido a até 2,5 raios de um símbolo vai para o centro dele
const PPL_MESMO_RAIOS = 1.2;       // dois itens a menos de 1,2 raio (vindos de ladrilhos diferentes) são a mesma estaca
const PPL_MAX_LADRILHOS = 80;      // folha que pede mais ladrilhos que isso é lida em escala menor

const pplNome = (s) => String(s == null ? "" : s).trim().toUpperCase().replace(/\s+/g, "");

// Escala (pixels por ponto) para o símbolo mais comum ficar com ~22 px de raio. raioPt: raio do símbolo em pontos do PDF.
function pplEscala(raioPt){
  const r = Number(raioPt);
  if(!(r > 0)) return 3;
  return Math.max(PPL_ESCALA_MIN, Math.min(PPL_ESCALA_MAX, PPL_RAIO_ALVO_PX / r));
}

// Séries que entram na leitura. Nota em traço SHX desenha "o", "0" e "6" como círculos pequenos e numerosos (8506 bloco 01:
// 176 de r 3,4 pt contra 73 estacas de r 17 pt): a série de referência da escala é a de maior área (n × r²), não a mais
// numerosa, e série com raio abaixo de 35% do dela sai (letra, não estaca; Ø 25 ao lado de Ø 60 ainda fica).
const PPL_SERIE_RAIO_MIN = 0.35;
function pplSeriesDaLeitura(series){
  const lista = (series || []).filter(s => s && s.r > 0 && s.n > 0);
  if(!lista.length) return { referencia: null, series: [] };
  const referencia = lista.reduce((a, b) => (b.n * b.r * b.r > a.n * a.r * a.r ? b : a));
  return { referencia, series: lista.filter(s => s.r >= referencia.r * PPL_SERIE_RAIO_MIN) };
}

// Ladrilhos sobre a imagem de W x H pixels. Com `formas` (fração da imagem), só os ladrilhos que têm algum símbolo
// (com folga de 1 símbolo da borda). Devolve [{i, x, y, w, h}] em pixels, na ordem de leitura (linhas, esquerda→direita).
function pplLadrilhos(W, H, formas, lado, sobra){
  const L = Number(lado) || PPL_LADO_PX, S = Number(sobra) || PPL_SOBRA_PX;
  if(!(W > 0 && H > 0)) return [];
  const passo = Math.max(1, L - S);
  const xs = [], ys = [];
  for(let x = 0; ; x += passo){ xs.push(Math.min(x, Math.max(0, W - L))); if(x + L >= W) break; }
  for(let y = 0; ; y += passo){ ys.push(Math.min(y, Math.max(0, H - L))); if(y + L >= H) break; }
  const uniq = (a) => [...new Set(a)];
  const lista = [];
  for(const y of uniq(ys)) for(const x of uniq(xs)) lista.push({ x, y, w: Math.min(L, W - x), h: Math.min(L, H - y) });
  const comSimbolo = Array.isArray(formas) && formas.length
    ? lista.filter(t => formas.some(f => {
        const px = f.x * W, py = f.y * H, m = Math.max(W, H) * (f.r || 0);
        return px >= t.x + m && px <= t.x + t.w - m && py >= t.y + m && py <= t.y + t.h - m;
      }))
    : lista;
  return comSimbolo.map((t, i) => ({ i, ...t }));
}

// Junta o que cada ladrilho devolveu ({ladrilho, estacas:[{nome,x,y,w,h,c}]}, pixels do ladrilho) em fração da imagem
// inteira. O mesmo símbolo lido em dois ladrilhos (sobreposição) vira um só: fica o de maior confiança; se os nomes
// divergem, o item guarda os dois em `outros`.
function pplJuntar(respostas, ladrilhos, W, H){
  const porI = new Map((ladrilhos || []).map(t => [t.i, t]));
  const brutos = [];
  for(const r of respostas || []){
    const t = porI.get(r && r.ladrilho);
    if(!t || !Array.isArray(r.estacas)) continue;
    for(const e of r.estacas){
      const x = Number(e.x), y = Number(e.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
      // item colado na borda interna do ladrilho é duvidoso (o vizinho vê melhor); perde para o outro na junção
      const borda = Math.min(x, y, t.w - x, t.h - y);
      const raioPx = Math.max(Number(e.w) || 0, Number(e.h) || 0) / 2;
      brutos.push({ nome: pplNome(e.nome) || null, x: (t.x + x) / W, y: (t.y + y) / H,
        r: raioPx > 0 ? raioPx / Math.max(W, H) : 0, c: Number(e.c) || 0, borda, ladrilho: t.i });
    }
  }
  brutos.sort((a, b) => (b.c - a.c) || (b.borda - a.borda));
  const fica = [];
  const lado = Math.max(W, H);
  for(const b of brutos){
    const rr = Math.max(b.r, 8 / lado);
    const igual = fica.find(f => Math.hypot((f.x - b.x) * W / lado, (f.y - b.y) * H / lado) < Math.max(f.r, rr) * PPL_MESMO_RAIOS * 2);
    if(igual){
      if(b.nome && b.nome !== igual.nome && !igual.outros.includes(b.nome)) igual.outros.push(b.nome);
      continue;
    }
    fica.push({ ...b, r: rr, outros: [] });
  }
  return fica;
}

// Puxa cada item lido para o centro do símbolo mais perto (até 2,5 raios do símbolo). Dois nomes no mesmo símbolo: fica
// o de maior confiança e o outro vira "a conferir" na posição do texto. Devolve:
//  { estacas: [{nome, x, y, r, c, simbolo: idx|null, conferir: bool, motivo}], semNome: [{x, y, r, simbolo}] }
// `formas` são as do detector; `series` (opcional) restringe "ponto sem nome" às séries em que a leitura achou estacas.
function pplPuxar(itens, formas, W, H){
  const lado = Math.max(W, H);
  const dist = (a, b) => Math.hypot((a.x - b.x) * W / lado, (a.y - b.y) * H / lado);
  const simbolos = (formas || []).map((f, idx) => ({ ...f, idx }));
  const usado = new Map();
  const lista = (itens || []).slice();
  const par = new Map();   // item → símbolo
  // Atribuição gulosa pela menor distância (a IA erra a posição, não a ordem de confiança): primeiro até 2,5 raios;
  // quem sobrar tenta de novo até 5 raios, só com símbolo livre.
  for(const limite of [PPL_PUXAR_RAIOS, PPL_PUXAR_RAIOS * 2]){
    const pares = [];
    for(let i = 0; i < lista.length; i++){
      if(par.has(i)) continue;
      for(const s of simbolos){
        if(usado.has(s.idx)) continue;
        const d = dist(lista[i], s);
        if(d <= s.r * limite) pares.push({ i, s, d: d / s.r });
      }
    }
    pares.sort((a, b) => a.d - b.d || (lista[b.i].c - lista[a.i].c));
    for(const p of pares){
      if(par.has(p.i) || usado.has(p.s.idx)) continue;
      par.set(p.i, p.s); usado.set(p.s.idx, lista[p.i]);
    }
  }
  const saida = [];
  lista.forEach((it, i) => {
    const s = par.get(i);
    if(s){
      saida.push({ nome: it.nome, x: s.x, y: s.y, r: s.r, c: it.c, outros: it.outros || [], simbolo: s.idx,
        serie: s.serie ?? null, conferir: !it.nome || (it.outros || []).length > 0, motivo: !it.nome ? "sem nome" : ((it.outros || []).length ? "leituras diferentes" : "") });
    } else {
      const perto = simbolos.some(q => dist(it, q) <= q.r * PPL_PUXAR_RAIOS);
      saida.push({ nome: it.nome, x: it.x, y: it.y, r: it.r, c: it.c, outros: it.outros || [], simbolo: null, serie: null,
        conferir: true, motivo: perto ? "outro nome no mesmo símbolo" : "sem símbolo perto" });
    }
  });
  // Fora do símbolo e sobrando: (a) o rótulo do pilar ("P19") quando as estacas dele ("P19A", "P19B") estão nos símbolos;
  // (b) a mesma estaca lida duas vezes (o nome já está num símbolo). Saem da lista e vão para `descartados`.
  const noSimbolo = new Set(saida.filter(e => e.simbolo != null && e.nome).map(e => e.nome));
  const ehRotuloDePilar = (n) => /\d$/.test(n) && [...noSimbolo].some(m => m.length === n.length + 1 && m.startsWith(n) && /[A-Z]$/.test(m));
  const descartados = [];
  for(let k = saida.length - 1; k >= 0; k--){
    const e = saida[k];
    if(e.simbolo != null || !e.nome) continue;
    if(noSimbolo.has(e.nome) || ehRotuloDePilar(e.nome)){ descartados.push(e); saida.splice(k, 1); }
  }
  // séries que são de estaca: as que receberam algum nome lido em pelo menos 1/3 dos símbolos
  const lidosPorSerie = new Map(), totalPorSerie = new Map();
  for(const s of simbolos){ totalPorSerie.set(s.serie, (totalPorSerie.get(s.serie) || 0) + 1); }
  for(const idx of usado.keys()){ const s = simbolos[idx]; lidosPorSerie.set(s.serie, (lidosPorSerie.get(s.serie) || 0) + 1); }
  const seriesEstaca = new Set([...totalPorSerie.keys()].filter(k => (lidosPorSerie.get(k) || 0) >= (totalPorSerie.get(k) || 1) / 3));
  const semNome = simbolos.filter(s => !usado.has(s.idx) && seriesEstaca.has(s.serie)).map(s => ({ x: s.x, y: s.y, r: s.r, simbolo: s.idx, serie: s.serie ?? null }));
  return { estacas: saida, semNome, descartados };
}

// Nome repetido na folha: todas as ocorrências viram ambíguas (só clique manual).
function pplRepetidos(estacas){
  const cont = new Map();
  for(const e of estacas || []) if(e.nome) cont.set(e.nome, (cont.get(e.nome) || 0) + 1);
  return new Set([...cont].filter(([, n]) => n > 1).map(([k]) => k));
}

// Pilar cadastrado como estaca (8506): `P10` prevista, sem execução, sem medida e sem posição, e a folha leu `P10A`, `P10B`.
// estacasObra: [{id, nome, status, temExecucao, temMedida, temPosicao, local, bloco}]. Devolve [{estaca, filhas:[nomes]}].
function pplPilares(nomesLidos, estacasObra){
  const lidos = [...new Set((nomesLidos || []).map(pplNome).filter(Boolean))];
  const existentes = new Set((estacasObra || []).map(e => pplNome(e.nome)));
  const saida = [];
  for(const e of estacasObra || []){
    const base = pplNome(e.nome);
    if(!base || lidos.includes(base)) continue;
    const filhas = lidos.filter(n => n.length === base.length + 1 && n.startsWith(base) && /[A-Z]$/.test(n) && /\d$/.test(base) && !existentes.has(n));
    if(filhas.length < 2) continue;
    const livre = e.status === "prevista" && !e.temExecucao && !e.temMedida && !e.temPosicao;
    saida.push({ estaca: e, filhas: filhas.sort(), livre });
  }
  return saida;
}

// Classifica a leitura contra a obra: existentes (só posiciona), novas (cria), ambíguas (nome repetido na folha ou em mais
// de uma estaca da obra no local), a conferir (sem nome, sem símbolo, nomes divergentes). estacasObra no mesmo formato
// de pplPilares; local: o local da folha (vazio = qualquer). Nome é igual só se for igual inteiro (BB1.1 ≠ B1.1).
function pplClassificar(puxado, estacasObra, local){
  const rep = pplRepetidos(puxado.estacas);
  const loc = pplNome(local || "");
  const daObra = (estacasObra || []).filter(e => !loc || pplNome(e.local) === loc || !pplNome(e.local));
  const porNome = new Map();
  for(const e of daObra){ const k = pplNome(e.nome); if(!porNome.has(k)) porNome.set(k, []); porNome.get(k).push(e); }
  const res = { existentes: [], novas: [], ambiguas: [], conferir: [], semNome: puxado.semNome || [] };
  for(const it of puxado.estacas){
    if(!it.nome){ res.conferir.push(it); continue; }
    if(rep.has(it.nome)){ res.ambiguas.push({ ...it, motivo: "nome repetido na folha" }); continue; }
    const achadas = porNome.get(it.nome) || [];
    if(achadas.length > 1){ res.ambiguas.push({ ...it, motivo: "mais de uma estaca com este nome na obra" }); continue; }
    if(it.simbolo == null){ res.conferir.push(it); continue; }
    if(achadas.length === 1) res.existentes.push({ ...it, estaca: achadas[0] });
    else res.novas.push(it);
  }
  return res;
}

// Ø mais comum entre as estacas da obra (padrão da prévia). Sem estaca com Ø: null.
function pplDiametroComum(estacasObra){
  const c = new Map();
  for(const e of estacasObra || []){ const d = Number(e.diametro_mm); if(d > 0) c.set(d, (c.get(d) || 0) + 1); }
  let melhor = null, n = 0;
  for(const [d, k] of c) if(k > n || (k === n && d < melhor)){ melhor = d; n = k; }
  return melhor;
}

// Fração da imagem girada: um ponto (x, y) na imagem sem giro vai para onde na imagem girada `giro` graus (horário)?
function pplGirar(x, y, giro){
  const g = ((Number(giro) || 0) % 360 + 360) % 360;
  if(g === 90) return { x: 1 - y, y: x };
  if(g === 180) return { x: 1 - x, y: 1 - y };
  if(g === 270) return { x: y, y: 1 - x };
  return { x, y };
}

// Medição contra um gabarito [{nome, x, y, r}] (fração; r pelo lado maior). Acerto = nome igual e posição a até 1 raio.
// Nome do gabarito com alternativas "P40C|P36C" (estaca de dois pilares no mesmo bloco) aceita qualquer uma delas.
function pplComparar(estacas, gabarito, W, H){
  const lado = Math.max(W, H);
  const porNome = new Map();
  for(const g of gabarito || []) for(const n of String(g.nome).split("|")) porNome.set(pplNome(n), g);
  let certos = 0, nomeCertoLonge = 0, errados = 0;
  const achados = new Set(), lista = [];
  for(const e of estacas || []){
    const g = e.nome ? porNome.get(e.nome) : null;
    if(!g){ errados++; lista.push({ nome: e.nome, situacao: "fora do gabarito" }); continue; }
    if(achados.has(g)){ errados++; lista.push({ nome: e.nome, situacao: "repetido" }); continue; }
    achados.add(g);
    // gabarito só com nome (sem posição): conta o nome; a posição é conferida à vista
    const d = Number.isFinite(g.x) && Number.isFinite(g.y) ? Math.hypot((e.x - g.x) * W / lado, (e.y - g.y) * H / lado) : 0;
    if(d <= (g.r || e.r)) certos++; else { nomeCertoLonge++; lista.push({ nome: e.nome, situacao: "longe do símbolo" }); }
  }
  const faltaram = (gabarito || []).filter(g => !achados.has(g)).map(g => g.nome);
  const total = (gabarito || []).length;
  return { total, certos, nomeCertoLonge, errados, faltaram, lista,
    pctNomes: total ? (certos + nomeCertoLonge) / total : 0,
    pctLonge: (certos + nomeCertoLonge) ? nomeCertoLonge / (certos + nomeCertoLonge) : 0 };
}

if(typeof module === "object" && module && module.exports){
  Object.assign(module.exports, { PPL_LADO_PX, PPL_SOBRA_PX, PPL_PUXAR_RAIOS, PPL_MAX_LADRILHOS, pplNome, pplEscala, pplSeriesDaLeitura, pplLadrilhos,
    pplJuntar, pplPuxar, pplRepetidos, pplPilares, pplClassificar, pplDiametroComum, pplGirar, pplComparar });
}

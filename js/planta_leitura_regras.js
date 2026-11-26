






const PPL_LADO_PX = 1092;
const PPL_SOBRA_PX = 160;
const PPL_RAIO_ALVO_PX = 22;
const PPL_ESCALA_MIN = 2;
const PPL_ESCALA_MAX = 6;
const PPL_PUXAR_RAIOS = 2.5;
const PPL_MESMO_RAIOS = 1.2;
const PPL_MAX_LADRILHOS = 80;

const pplNome = (s) => String(s == null ? "" : s).trim().toUpperCase().replace(/\s+/g, "");


function pplEscala(raioPt){
  const r = Number(raioPt);
  if(!(r > 0)) return 3;
  return Math.max(PPL_ESCALA_MIN, Math.min(PPL_ESCALA_MAX, PPL_RAIO_ALVO_PX / r));
}




const PPL_SERIE_RAIO_MIN = 0.35;
function pplSeriesDaLeitura(series){
  const lista = (series || []).filter(s => s && s.r > 0 && s.n > 0);
  if(!lista.length) return { referencia: null, series: [] };
  const referencia = lista.reduce((a, b) => (b.n * b.r * b.r > a.n * a.r * a.r ? b : a));
  return { referencia, series: lista.filter(s => s.r >= referencia.r * PPL_SERIE_RAIO_MIN) };
}



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




function pplJuntar(respostas, ladrilhos, W, H){
  const porI = new Map((ladrilhos || []).map(t => [t.i, t]));
  const brutos = [];
  for(const r of respostas || []){
    const t = porI.get(r && r.ladrilho);
    if(!t || !Array.isArray(r.estacas)) continue;
    for(const e of r.estacas){
      const x = Number(e.x), y = Number(e.y);
      if(!Number.isFinite(x) || !Number.isFinite(y)) continue;

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





function pplPuxar(itens, formas, W, H){
  const lado = Math.max(W, H);
  const dist = (a, b) => Math.hypot((a.x - b.x) * W / lado, (a.y - b.y) * H / lado);
  const simbolos = (formas || []).map((f, idx) => ({ ...f, idx }));
  const usado = new Map();
  const lista = (itens || []).slice();
  const par = new Map();


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


  const noSimbolo = new Set(saida.filter(e => e.simbolo != null && e.nome).map(e => e.nome));
  const ehRotuloDePilar = (n) => /\d$/.test(n) && [...noSimbolo].some(m => m.length === n.length + 1 && m.startsWith(n) && /[A-Z]$/.test(m));
  const descartados = [];
  for(let k = saida.length - 1; k >= 0; k--){
    const e = saida[k];
    if(e.simbolo != null || !e.nome) continue;
    if(noSimbolo.has(e.nome) || ehRotuloDePilar(e.nome)){ descartados.push(e); saida.splice(k, 1); }
  }

  const lidosPorSerie = new Map(), totalPorSerie = new Map();
  for(const s of simbolos){ totalPorSerie.set(s.serie, (totalPorSerie.get(s.serie) || 0) + 1); }
  for(const idx of usado.keys()){ const s = simbolos[idx]; lidosPorSerie.set(s.serie, (lidosPorSerie.get(s.serie) || 0) + 1); }
  const seriesEstaca = new Set([...totalPorSerie.keys()].filter(k => (lidosPorSerie.get(k) || 0) >= (totalPorSerie.get(k) || 1) / 3));
  const semNome = simbolos.filter(s => !usado.has(s.idx) && seriesEstaca.has(s.serie)).map(s => ({ x: s.x, y: s.y, r: s.r, simbolo: s.idx, serie: s.serie ?? null }));
  return { estacas: saida, semNome, descartados };
}


function pplRepetidos(estacas){
  const cont = new Map();
  for(const e of estacas || []) if(e.nome) cont.set(e.nome, (cont.get(e.nome) || 0) + 1);
  return new Set([...cont].filter(([, n]) => n > 1).map(([k]) => k));
}



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


function pplDiametroComum(estacasObra){
  const c = new Map();
  for(const e of estacasObra || []){ const d = Number(e.diametro_mm); if(d > 0) c.set(d, (c.get(d) || 0) + 1); }
  let melhor = null, n = 0;
  for(const [d, k] of c) if(k > n || (k === n && d < melhor)){ melhor = d; n = k; }
  return melhor;
}


function pplGirar(x, y, giro){
  const g = ((Number(giro) || 0) % 360 + 360) % 360;
  if(g === 90) return { x: 1 - y, y: x };
  if(g === 180) return { x: 1 - x, y: 1 - y };
  if(g === 270) return { x: y, y: 1 - x };
  return { x, y };
}



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

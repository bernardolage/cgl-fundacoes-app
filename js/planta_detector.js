








const PPD_OPS = { save: 10, restore: 11, transform: 12, moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17,
  closePath: 18, rectangle: 19, constructPath: 91, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };
const PPD_REDONDO_TOL = 0.12;
const PPD_RAIO_MIN_PX = 3;
const PPD_RAIO_MAX_FRAC = 0.05;
const PPD_SERIE_PASSO = 0.05;
const PPD_SERIE_MIN = 5;

function ppdMult(m1, m2){
  return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
}
function ppdAplicar(m, x, y){ return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }


function ppdCirculo(pts, curvas){
  if(!Array.isArray(pts) || pts.length < 4) return null;
  const ini = pts[0], fim = pts[pts.length - 1];
  let cx = 0, cy = 0;
  const unicos = Math.hypot(ini[0] - fim[0], ini[1] - fim[1]) < 1e-6 ? pts.slice(0, -1) : pts;
  if(unicos.length < 4) return null;
  for(const p of unicos){ cx += p[0]; cy += p[1]; }
  cx /= unicos.length; cy /= unicos.length;
  const ds = unicos.map(p => Math.hypot(p[0] - cx, p[1] - cy));
  const rmax = Math.max(...ds), rmin = Math.min(...ds);
  if(!(rmax > 0) || (rmax - rmin) / rmax > PPD_REDONDO_TOL) return null;
  const r = ds.reduce((s, d) => s + d, 0) / ds.length;

  if(Math.hypot(ini[0] - fim[0], ini[1] - fim[1]) > r * 0.25) return null;

  if(!curvas && unicos.length < 8) return null;
  return { cx, cy, r };
}



function ppdFormas(operacoes, viewport){
  const fn = operacoes && operacoes.fnArray, args = operacoes && operacoes.argsArray;
  if(!Array.isArray(fn) && !(fn && typeof fn.length === "number")) return [];
  const W = Number(viewport && viewport.width) || 0, H = Number(viewport && viewport.height) || 0;
  const vt = viewport && Array.isArray(viewport.transform) ? viewport.transform : [1, 0, 0, 1, 0, 0];
  if(!(W > 0 && H > 0)) return [];
  const lado = Math.max(W, H);
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilha = [];
  const achados = [];
  const pedacos = [];
  const paraTela = (x, y) => { const p = ppdAplicar(ctm, x, y); return ppdAplicar(vt, p[0], p[1]); };
  const guardarPedaco = (arco) => { if(arco && arco.r >= PPD_RAIO_MIN_PX && arco.r / lado <= PPD_RAIO_MAX_FRAC) pedacos.push(arco); };
  for(let i = 0; i < fn.length; i++){
    const op = fn[i], a = args[i];
    if(op === PPD_OPS.save){ pilha.push(ctm); continue; }
    if(op === PPD_OPS.restore){ if(pilha.length) ctm = pilha.pop(); continue; }
    if(op === PPD_OPS.transform){ if(Array.isArray(a) && a.length >= 6) ctm = ppdMult(ctm, a.map(Number)); continue; }
    if(op === PPD_OPS.paintFormXObjectBegin){
      pilha.push(ctm);
      if(Array.isArray(a) && Array.isArray(a[0]) && a[0].length >= 6) ctm = ppdMult(ctm, a[0].map(Number));
      continue;
    }
    if(op === PPD_OPS.paintFormXObjectEnd){ if(pilha.length) ctm = pilha.pop(); continue; }
    if(op !== PPD_OPS.constructPath || !Array.isArray(a)) continue;
    const ops = a[0] || [], co = a[1] || [];
    let k = 0, sub = null, curvas = 0, atual = [0, 0], beziers = [];
    const fechar = () => {
      let inteiro = null;
      if(sub && sub.length >= 4){
        inteiro = ppdCirculo(sub, curvas >= 4);
        if(inteiro && inteiro.r >= PPD_RAIO_MIN_PX && inteiro.r / lado <= PPD_RAIO_MAX_FRAC) achados.push({ x: inteiro.cx / W, y: inteiro.cy / H, r: inteiro.r / lado });
      }
      if(!inteiro && sub){
        for(const b of beziers) guardarPedaco(ppdArcoBezier(b));
        if(!curvas && sub.length >= 4) guardarPedaco(ppdArcoPoligono(sub));
      }
      sub = null; curvas = 0; beziers = [];
    };
    for(const o of ops){
      if(o === PPD_OPS.moveTo){
        fechar();
        atual = [co[k], co[k + 1]]; k += 2;
        sub = [paraTela(atual[0], atual[1])];
      } else if(o === PPD_OPS.lineTo){
        atual = [co[k], co[k + 1]]; k += 2;
        if(sub) sub.push(paraTela(atual[0], atual[1]));
      } else if(o === PPD_OPS.curveTo){
        const p0 = sub ? sub[sub.length - 1] : null;
        const p1 = paraTela(co[k], co[k + 1]), p2 = paraTela(co[k + 2], co[k + 3]);
        atual = [co[k + 4], co[k + 5]]; k += 6;
        if(sub){ const p3 = paraTela(atual[0], atual[1]); beziers.push([p0, p1, p2, p3]); sub.push(p3); curvas++; }
      } else if(o === PPD_OPS.curveTo2 || o === PPD_OPS.curveTo3){
        const p0 = sub ? sub[sub.length - 1] : null, q = paraTela(co[k], co[k + 1]);
        atual = [co[k + 2], co[k + 3]]; k += 4;
        if(sub){
          const p3 = paraTela(atual[0], atual[1]);

          beziers.push(o === PPD_OPS.curveTo2 ? [p0, p0, q, p3] : [p0, q, p3, p3]);
          sub.push(p3); curvas++;
        }
      } else if(o === PPD_OPS.closePath){
        if(sub && sub.length) sub.push(sub[0]);
        fechar();
      } else if(o === PPD_OPS.rectangle){
        fechar(); k += 4;
      }
    }
    fechar();
  }
  for(const c of ppdJuntarPedacos(pedacos)) achados.push({ x: c.cx / W, y: c.cy / H, r: c.r / lado });
  return ppdSemRepetidos(achados);
}


const PPD_GOMOS = 36;
const PPD_COBERTURA_MIN = 30;
function ppdCirculo3(a, b, c){
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if(Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}
function ppdBezier(b, t){
  const u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, D = t * t * t;
  return [A * b[0][0] + B * b[1][0] + C * b[2][0] + D * b[3][0], A * b[0][1] + B * b[1][1] + C * b[2][1] + D * b[3][1]];
}

function ppdGomos(c, pts){
  const g = new Set(), ang = (p) => Math.atan2(p[1] - c.cy, p[0] - c.cx);
  for(let i = 0; i + 1 < pts.length; i++){
    let a0 = ang(pts[i]), a1 = ang(pts[i + 1]), d = a1 - a0;
    while(d > Math.PI) d -= 2 * Math.PI;
    while(d < -Math.PI) d += 2 * Math.PI;
    const passos = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 36)));
    for(let s = 0; s <= passos; s++){
      const a = a0 + d * s / passos;
      g.add(((Math.floor((a + Math.PI) / (2 * Math.PI) * PPD_GOMOS) % PPD_GOMOS) + PPD_GOMOS) % PPD_GOMOS);
    }
  }
  return g;
}

function ppdArcoBezier(b){
  if(!b || !b[0]) return null;
  const c = ppdCirculo3(b[0], ppdBezier(b, 0.5), b[3]);
  if(!c || !(c.r > 0)) return null;
  const amostra = [0, 0.25, 0.5, 0.75, 1].map(t => ppdBezier(b, t));
  if(amostra.some(p => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) > c.r * 0.04)) return null;
  return { ...c, gomos: ppdGomos(c, amostra) };
}

function ppdArcoPoligono(pts){
  const c = ppdCirculo3(pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]);
  if(!c || !(c.r > 0)) return null;
  if(pts.some(p => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) > c.r * 0.04)) return null;
  return { ...c, gomos: ppdGomos(c, pts) };
}

function ppdJuntarPedacos(pedacos){
  const grupos = [], grade = new Map();
  for(const p of pedacos || []){
    const cel = Math.max(1, p.r * 0.25), gx = Math.round(p.cx / cel), gy = Math.round(p.cy / cel);
    let alvo = null;
    for(let dx = -1; dx <= 1 && !alvo; dx++) for(let dy = -1; dy <= 1 && !alvo; dy++){
      for(const g of grade.get((gx + dx) + ":" + (gy + dy)) || []){
        if(Math.abs(g.r - p.r) <= g.r * 0.05 && Math.hypot(g.cx - p.cx, g.cy - p.cy) <= g.r * 0.05){ alvo = g; break; }
      }
    }
    if(alvo){ for(const k of p.gomos) alvo.gomos.add(k); continue; }
    const g = { cx: p.cx, cy: p.cy, r: p.r, gomos: new Set(p.gomos) };
    grupos.push(g);
    const chave = gx + ":" + gy;
    if(!grade.has(chave)) grade.set(chave, []);
    grade.get(chave).push(g);
  }
  return grupos.filter(g => g.gomos.size >= PPD_COBERTURA_MIN);
}



function ppdSemRepetidos(formas){
  const lista = (formas || []).slice().sort((a, b) => b.r - a.r);
  const cel = 0.01, grade = new Map(), fica = [];
  const chave = (x, y) => Math.floor(x / cel) + ":" + Math.floor(y / cel);
  for(const f of lista){
    const gx = Math.floor(f.x / cel), gy = Math.floor(f.y / cel);
    let repetido = false;
    for(let dx = -1; dx <= 1 && !repetido; dx++) for(let dy = -1; dy <= 1 && !repetido; dy++){
      for(const g of grade.get((gx + dx) + ":" + (gy + dy)) || []){
        if(Math.hypot(g.x - f.x, g.y - f.y) < g.r * 0.5){ repetido = true; break; }
      }
    }
    if(repetido) continue;
    fica.push(f);
    const c = chave(f.x, f.y);
    if(!grade.has(c)) grade.set(c, []);
    grade.get(c).push(f);
  }
  return fica;
}



function ppdSeries(formas){
  const ord = (formas || []).slice().sort((a, b) => a.r - b.r);
  const grupos = [];
  for(const f of ord){
    const g = grupos[grupos.length - 1];
    if(g && f.r <= g.base * (1 + PPD_SERIE_PASSO)) g.formas.push(f);
    else grupos.push({ base: f.r, formas: [f] });
  }
  return grupos.filter(g => g.formas.length >= PPD_SERIE_MIN)
    .map(g => ({ r: g.formas.reduce((s, f) => s + f.r, 0) / g.formas.length, n: g.formas.length, formas: g.formas }))
    .sort((a, b) => b.n - a.n)
    .map((g, i) => ({ serie: i + 1, ...g, formas: g.formas.map(f => ({ ...f, serie: i + 1 })) }));
}

if(typeof module === "object" && module && module.exports){
  Object.assign(module.exports, { PPD_OPS, ppdMult, ppdAplicar, ppdCirculo, ppdFormas, ppdSemRepetidos, ppdSeries,
    ppdCirculo3, ppdArcoBezier, ppdArcoPoligono, ppdJuntarPedacos });
}

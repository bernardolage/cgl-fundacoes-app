





















const RGD_CATEGORIAS = { disposicao: "À disposição", producao: "Produção", manutencao: "Manutenção", outros: "Outros" };
const RGD_TIPOS = { prof: "Perfuração", ref: "Refuro", sim: "Injeção" };
const RGD_FERRAMENTAS = { revestimento: "Revestimento", tricone: "Tricone", martelo: "Martelo", trado: "Trado", outro: "Outro" };

const RGD_COLUNAS = ["h_inicial", "h_final", "descricao", "categoria", "tipo", "estaca", "diametro", "inicial", "final",
  "inclinacao", "solo", "ferramenta", "sacos", "volume", "pressao"];
const RGD_NUMERICAS = ["diametro", "inicial", "final", "sacos", "volume", "pressao"];
const RGD_ROTULO = { h_inicial: "início", h_final: "fim", diametro: "Ø", inicial: "inicial", final: "final", sacos: "sacos", volume: "volume", pressao: "pressão" };


const rgdSemAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const rgdChave = (s) => rgdSemAcento(s).toLowerCase().replace(/[^a-z0-9]/g, "");


function rgdHora(v){
  const t = String(v ?? "").trim();
  if(!t) return null;
  if(/^0?[.,]\d+$/.test(t) || t === "0"){
    const min = Math.round(Number(t.replace(",", ".")) * 1440);
    if(!(min >= 0 && min < 1440)) return null;
    return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
  }
  const m = t.match(/^(\d{1,2})[:hH](\d{2})(?::\d{2})?$/);
  if(!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if(h > 23 || mi > 59) return null;
  return String(h).padStart(2, "0") + ":" + m[2];
}
const rgdMin = (hhmm) => { const h = rgdHora(hhmm); return h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3)) : null; };

function rgdDuracao(hi, hf){
  const a = rgdMin(hi), b = rgdMin(hf);
  if(a == null || b == null) return null;
  return b >= a ? b - a : b + 1440 - a;
}

function rgdNum(v){
  if(v == null) return null;
  if(typeof v === "number") return isFinite(v) ? v : NaN;
  let t = String(v).trim().replace(/\s/g, "");
  if(!t) return null;
  if(t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return isFinite(n) ? n : NaN;
}
function rgdCategoria(v){
  const k = rgdChave(v);
  if(!k) return null;
  if(k === "d" || k.startsWith("disp") || k.startsWith("adisp")) return "disposicao";
  if(k === "p" || k.startsWith("prod")) return "producao";
  if(k === "m" || k.startsWith("manut")) return "manutencao";
  if(k === "o" || k.startsWith("outr")) return "outros";
  return undefined;
}
function rgdTipo(v){
  const k = rgdChave(v);
  if(!k) return null;
  if(k.startsWith("prof") || k.startsWith("perf")) return "prof";
  if(k.startsWith("ref")) return "ref";
  if(k === "sim" || k.startsWith("inj")) return "sim";
  return undefined;
}
function rgdFerramenta(v){
  const k = rgdChave(v);
  if(!k) return null;
  if(k.startsWith("revest") || k === "tubo") return "revestimento";
  if(k.startsWith("tric")) return "tricone";
  if(k.startsWith("mart")) return "martelo";
  if(k.startsWith("trado")) return "trado";
  return "outro";
}

const RGD_CABECALHO = {
  inicio: "h_inicial", horainicio: "h_inicial", hinicial: "h_inicial", horainicial: "h_inicial",
  fim: "h_final", horafim: "h_final", hfinal: "h_final", horafinal: "h_final",
  descricao: "descricao", atividade: "descricao", descricaodaatividade: "descricao",
  dpmo: "categoria", categoria: "categoria", tipo: "tipo",
  saco: "sacos", sacos: "sacos", volume: "volume", volumem3: "volume", pressao: "pressao",
  estaca: "estaca", diametro: "diametro", diam: "diametro",
  inicial: "inicial", final: "final", inclinacao: "inclinacao",
  classificacao: "solo", solo: "solo", classificacaodosolo: "solo", material: "ferramenta", ferramenta: "ferramenta",
  data: "data"
};
function rgdDataISO(v){
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}



function rgdColar(texto, dataISO){
  const brutas = String(texto ?? "").replace(/\r\n?/g, "\n").split("\n").filter(l => l.replace(/\t/g, "").trim() !== "");
  const out = { linhas: [], erros: [], avisos: [], cabecalho: false };
  if(!brutas.length) return out;
  let mapa = RGD_COLUNAS.slice();
  const primeira = brutas[0].split("\t").map(rgdChave);
  if(primeira.includes("inicio") && primeira.includes("fim") || primeira.includes("horainicio")){
    mapa = primeira.map(k => RGD_CABECALHO[k] || null);
    out.cabecalho = true;
    brutas.shift();
  }
  brutas.forEach((bruta, i) => {
    const n = i + 1, cel = bruta.split("\t"), c = {};
    mapa.forEach((campo, j) => { if(campo && c[campo] == null) c[campo] = (cel[j] ?? "").trim(); });
    const l = { h_inicial: null, h_final: null, descricao: c.descricao || null, categoria: null, tipo: null, estaca: c.estaca || null,
      diametro: null, inicial: null, final: null, inclinacao: c.inclinacao || null, solo: c.solo || null, ferramenta: rgdFerramenta(c.ferramenta),
      sacos: null, volume: null, pressao: null };
    for(const k of ["h_inicial", "h_final"]){
      if(c[k]){ l[k] = rgdHora(c[k]); if(!l[k]) out.erros.push(`Linha ${n}: hora inválida no ${RGD_ROTULO[k]} ("${c[k]}").`); }
    }
    const cat = rgdCategoria(c.categoria), tipo = rgdTipo(c.tipo);
    if(cat === undefined) out.erros.push(`Linha ${n}: categoria "${c.categoria}" não reconhecida (À disposição, Produção, Manutenção ou Outros).`);
    if(tipo === undefined) out.erros.push(`Linha ${n}: tipo "${c.tipo}" não reconhecido (Perfuração, Refuro ou Injeção).`);
    l.categoria = cat || null; l.tipo = tipo || null;
    if(l.tipo && !l.categoria) l.categoria = "producao";
    for(const k of RGD_NUMERICAS){
      const v = rgdNum(c[k]);
      if(Number.isNaN(v)) out.erros.push(`Linha ${n}: número inválido em ${RGD_ROTULO[k]} ("${c[k]}").`);
      else l[k] = v;
    }
    const d = c.data ? rgdDataISO(c.data) : null;
    if(d && dataISO && d !== dataISO) out.avisos.push(`Linha ${n} é de ${d.split("-").reverse().join("/")}, não do dia deste diário.`);
    out.linhas.push(l);
  });
  return out;
}

const rgdNormEstaca = (s) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
const rgdR2 = (n) => Math.round(Number(n) * 100) / 100;
const rgdTs = (dataISO, hhmm, diaSeguinte) => {
  if(!dataISO || !hhmm) return null;
  if(!diaSeguinte) return `${dataISO}T${hhmm}`;
  const d = new Date(dataISO + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T${hhmm}`;
};
const rgdTemInjecao = (e) => !!(e && (e.concretagem_inicio || e.volume_injetado_m3 != null || (e.consumo_cimento_raiz != null && e.consumo_cimento_raiz !== "") || e.pressao_injecao_kgcm2 != null));


function rgdParaRdo(linhas, dataISO){
  const erros = [], execs = new Map(), ordem = [], atividades = [];
  const execDe = (l, tipo) => {
    const mod = tipo === "ref" ? "refuro" : "furo_normal";
    const k = rgdNormEstaca(l.estaca) + "|" + mod;
    if(!execs.has(k)){
      execs.set(k, { estaca_numero: String(l.estaca).trim(), diametro_mm: null, inclinacao: null, modalidade_execucao: mod,
        _solo: [], _just: [], _semTrecho: null, _sims: [], _ini: [], _fim: [] });
      ordem.push(k);
    }
    const e = execs.get(k);
    if(e.diametro_mm == null && l.diametro != null && !Number.isNaN(Number(l.diametro))) e.diametro_mm = Number(l.diametro);
    if(!e.inclinacao && l.inclinacao) e.inclinacao = String(l.inclinacao).trim();
    return e;
  };
  (linhas || []).forEach((l, i) => {
    const n = i + 1;
    const hi = l.h_inicial ? rgdHora(l.h_inicial) : null, hf = l.h_final ? rgdHora(l.h_final) : null;
    if((l.h_inicial && !hi) || (l.h_final && !hf)) erros.push(`Linha ${n}: hora inválida.`);
    const prod = l.categoria === "producao", tipo = prod ? (l.tipo || null) : null;
    const temEstaca = !!String(l.estaca ?? "").trim();
    let soloRef = null;
    if(prod && (tipo === "prof" || tipo === "ref")){
      if(!temEstaca) erros.push(`Linha ${n}: ${RGD_TIPOS[tipo]} sem estaca.`);
      else if(l.inicial == null || l.final == null) erros.push(`Linha ${n}: ${RGD_TIPOS[tipo]} sem inicial ou final.`);
      else if(Number(l.final) < Number(l.inicial)) erros.push(`Linha ${n}: o final (${l.final}) é menor que o inicial (${l.inicial}).`);
      else {
        const e = execDe(l, tipo);
        const legado = l._semTrecho && !l.solo && !l.ferramenta && !hi && !hf;
        if(legado) e._semTrecho = { de: Number(l.inicial), ate: Number(l.final), pe: l._pe };
        else {
          soloRef = { ...(l._soloRef || {}), inicio_ml: Number(l.inicial), final_ml: Number(l.final),
            classificacao: l.solo ? String(l.solo).trim() : null, ferramenta: l.ferramenta || null };
          e._solo.push(soloRef);
          const a = rgdMin(hi), b = rgdMin(hf);
          if(a != null){ e._ini.push(a); if(b != null) e._fim.push(b >= a ? b : b + 1440); }
        }
      }
    } else if(prod && tipo === "sim"){
      if(!temEstaca) erros.push(`Linha ${n}: Injeção sem estaca.`);
      else execDe(l, "prof")._sims.push({ hi, hf, sacos: l.sacos, volume: l.volume, pressao: l.pressao, cimento: l._cimento || null });
    } else if(prod && temEstaca){
      execDe(l, "prof");
    }
    if(hi || hf || (l.descricao && String(l.descricao).trim())){
      atividades.push({ h_inicial: hi, h_final: hf, motivo: l.descricao ? String(l.descricao).trim() : null,
        categoria: l.categoria || null, tipo_linha: tipo, _soloRef: soloRef });
    }
  });
  const execucoes = ordem.map(k => {
    const e = execs.get(k);
    const out = { estaca_numero: e.estaca_numero, diametro_mm: e.diametro_mm, inclinacao: e.inclinacao, modalidade_execucao: e.modalidade_execucao,
      _solo: e._solo, _just: [] };
    if(e._solo.length){
      const de = Math.min(...e._solo.map(s => s.inicio_ml)), ate = Math.max(...e._solo.map(s => s.final_ml));
      Object.assign(out, { perfuracao_de_m: de, perfuracao_ate_m: ate, profundidade_executada: rgdR2(ate - de) });
    } else if(e._semTrecho){
      const st = e._semTrecho;
      Object.assign(out, { perfuracao_de_m: st.de, perfuracao_ate_m: st.ate, profundidade_executada: st.pe != null ? st.pe : rgdR2(st.ate - st.de) });
    } else out._semPerf = true;
    if(e._ini.length){
      const a = Math.min(...e._ini), b = e._fim.length ? Math.max(...e._fim) : null;
      const hh = (m) => String(Math.floor((m % 1440) / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
      out.perfuracao_inicio = rgdTs(dataISO, hh(a));
      out.perfuracao_fim = b != null ? rgdTs(dataISO, hh(b), b >= 1440) : null;
    }
    if(e._sims.length){
      const s = e._sims, his = s.map(x => rgdMin(x.hi)).filter(x => x != null);
      const soma = (k) => { const v = s.map(x => x[k]).filter(x => x != null && !Number.isNaN(Number(x))); return v.length ? rgdR2(v.reduce((t, x) => t + Number(x), 0)) : null; };
      const sacos = soma("sacos"), cim = s.find(x => x.cimento);
      const hi0 = his.length ? Math.min(...his) : null;
      const fins = s.map(x => { const a = rgdMin(x.hi), b = rgdMin(x.hf); return b == null ? null : (a != null && b < a ? b + 1440 : b); }).filter(x => x != null);
      const hf0 = fins.length ? Math.max(...fins) : null;
      const hh = (m) => String(Math.floor((m % 1440) / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
      Object.assign(out, {
        concretagem_inicio: hi0 != null ? rgdTs(dataISO, hh(hi0)) : null,
        concretagem_fim: hf0 != null ? rgdTs(dataISO, hh(hf0), hf0 >= 1440) : null,
        consumo_cimento_raiz: sacos != null ? String(sacos) : (cim ? cim.cimento.valor : null),
        consumo_cimento_unidade: sacos != null ? "saco" : (cim ? cim.cimento.unidade : null),
        volume_injetado_m3: soma("volume"), pressao_injecao_kgcm2: soma("pressao") != null ? Math.max(...s.map(x => Number(x.pressao)).filter(x => isFinite(x))) : null,
        observacoes: "Injeção"
      });
    } else out._semSim = true;
    return out;
  });
  return { execucoes, atividades, erros };
}



function rgdDeRdo(execucoes, atividades){
  const linhas = [], soloDe = new Map(), usadoSolo = new Set(), usadaSim = new Set(), citada = new Set();
  (execucoes || []).forEach(e => (e._solo || []).forEach(s => { if(s.id) soloDe.set(s.id, { s, e }); }));
  const achaSolo = (a) => {
    if(a._soloRef) for(const e of execucoes || []) if((e._solo || []).includes(a._soloRef)) return { s: a._soloRef, e };
    return a.solo_id ? soloDe.get(a.solo_id) || null : null;
  };
  const base = (e) => ({ estaca: e.estaca_numero || null, diametro: e.diametro_mm ?? null, inclinacao: e.inclinacao || null });
  const tipoDe = (e) => e.modalidade_execucao === "refuro" ? "ref" : "prof";
  const simDe = (e) => {
    const un = e.consumo_cimento_unidade, val = e.consumo_cimento_raiz;
    const sacos = un === "saco" && val != null && val !== "" ? rgdNum(val) : null;
    return { sacos: Number.isNaN(sacos) ? null : sacos, volume: e.volume_injetado_m3 ?? null, pressao: e.pressao_injecao_kgcm2 ?? null,
      _cimento: (sacos == null && val != null && val !== "") ? { valor: val, unidade: un || null } : null };
  };
  const hhmm = (ts) => ts ? String(ts).slice(11, 16) : null;
  (atividades || []).forEach(a => {
    const l = { h_inicial: a.h_inicial || null, h_final: a.h_final || null, descricao: a.motivo || null, categoria: a.categoria || null,
      tipo: a.tipo_linha || null, estaca: null, diametro: null, inicial: null, final: null, inclinacao: null, solo: null,
      ferramenta: null, sacos: null, volume: null, pressao: null };
    if(a.tipo_linha === "prof" || a.tipo_linha === "ref"){
      const x = achaSolo(a);
      if(x && !usadoSolo.has(x.s)){
        usadoSolo.add(x.s); citada.add(x.e);
        Object.assign(l, base(x.e), { inicial: x.s.inicio_ml ?? null, final: x.s.final_ml ?? null, solo: x.s.classificacao || null,
          ferramenta: x.s.ferramenta || null, _soloRef: x.s });
      }
    } else if(a.tipo_linha === "sim" && a.h_inicial){
      const e = (execucoes || []).find(x => !usadaSim.has(x) && hhmm(x.concretagem_inicio) === a.h_inicial);
      if(e){ usadaSim.add(e); citada.add(e); Object.assign(l, base(e), simDe(e)); }
    }
    linhas.push(l);
  });
  (execucoes || []).forEach(e => {
    const sobra = (e._solo || []).filter(s => !usadoSolo.has(s));
    sobra.forEach(s => linhas.push({ h_inicial: null, h_final: null, descricao: null, categoria: "producao", tipo: tipoDe(e), ...base(e),
      inicial: s.inicio_ml ?? null, final: s.final_ml ?? null, solo: s.classificacao || null, ferramenta: s.ferramenta || null,
      sacos: null, volume: null, pressao: null, _soloRef: s }));
    if(!(e._solo || []).length && (Number(e.perfuracao_ate_m) > 0 || Number(e.profundidade_executada) > 0)){
      linhas.push({ h_inicial: null, h_final: null, descricao: null, categoria: "producao", tipo: tipoDe(e), ...base(e),
        inicial: e.perfuracao_de_m ?? 0, final: e.perfuracao_ate_m ?? rgdR2((Number(e.perfuracao_de_m) || 0) + (Number(e.profundidade_executada) || 0)),
        solo: null, ferramenta: null, sacos: null, volume: null, pressao: null, _semTrecho: true, _pe: e.profundidade_executada ?? null });
    }
    if(rgdTemInjecao(e) && !usadaSim.has(e)){
      linhas.push({ h_inicial: hhmm(e.concretagem_inicio), h_final: hhmm(e.concretagem_fim), descricao: null, categoria: "producao", tipo: "sim",
        ...base(e), inicial: null, final: null, solo: null, ferramenta: null, ...simDe(e), _semAtividade: true });
    }
    if(!sobra.length && !citada.has(e) && !(Number(e.perfuracao_ate_m) > 0 || Number(e.profundidade_executada) > 0) && !rgdTemInjecao(e)
       && !(e._solo || []).length){
      linhas.push({ h_inicial: null, h_final: null, descricao: null, categoria: "producao", tipo: null, ...base(e), inicial: null, final: null,
        solo: null, ferramenta: null, sacos: null, volume: null, pressao: null });
    }
  });

  return linhas.map(l => { if(l._semAtividade){ const c = { ...l }; delete c._semAtividade; if(!c.descricao && !c.h_inicial) c._semAtividade = true; return c; } return l; });
}




function rgdMesclar(atuais, novos){
  const chave = (e) => rgdNormEstaca(e.estaca_numero) + "|" + (e.modalidade_execucao === "refuro" ? "refuro" : "n");
  const usados = new Set(), execucoes = [];
  const lista = atuais || [];
  (novos || []).forEach(n => {
    const at = lista.find(a => !usados.has(a) && chave(a) === chave(n));
    if(!at){
      const novo = { ...n, _just: n._just || [] };
      delete novo._semPerf; delete novo._semSim;
      execucoes.push(novo);
      return;
    }
    usados.add(at);
    const o = { ...at };
    if(n.diametro_mm != null) o.diametro_mm = n.diametro_mm;
    if(n.inclinacao) o.inclinacao = n.inclinacao;
    o._solo = n._solo;
    o._just = at._just || [];
    if(!n._semPerf){
      o.perfuracao_de_m = n.perfuracao_de_m; o.perfuracao_ate_m = n.perfuracao_ate_m; o.profundidade_executada = n.profundidade_executada;
      if(String(o.profundidade_executada) !== String(at.profundidade_executada)) o._pexecAuto = String(o.profundidade_executada);
    } else if((at._solo || []).length){
      o.perfuracao_de_m = null; o.perfuracao_ate_m = null; o.profundidade_executada = null;
    }
    if(n.perfuracao_inicio !== undefined){ o.perfuracao_inicio = n.perfuracao_inicio; o.perfuracao_fim = n.perfuracao_fim; }
    if(!n._semSim){
      Object.assign(o, { concretagem_inicio: n.concretagem_inicio, concretagem_fim: n.concretagem_fim, consumo_cimento_raiz: n.consumo_cimento_raiz,
        consumo_cimento_unidade: n.consumo_cimento_unidade, volume_injetado_m3: n.volume_injetado_m3, pressao_injecao_kgcm2: n.pressao_injecao_kgcm2 });
      if(!/inje/i.test(rgdSemAcento(o.observacoes || ""))) o.observacoes = o.observacoes ? `${o.observacoes} · Injeção` : "Injeção";
    } else if(rgdTemInjecao(at)){
      Object.assign(o, { concretagem_inicio: null, concretagem_fim: null, consumo_cimento_raiz: null, consumo_cimento_unidade: null,
        volume_injetado_m3: null, pressao_injecao_kgcm2: null });
    }
    execucoes.push(o);
  });
  return { execucoes, removidas: lista.filter(a => !usados.has(a)) };
}


function rgdHorasPorCategoria(linhas){
  const t = { disposicao: 0, producao: 0, manutencao: 0, outros: 0, sem: 0, total: 0 };
  (linhas || []).forEach(l => {
    const d = rgdDuracao(l.h_inicial, l.h_final);
    if(d == null) return;
    t[RGD_CATEGORIAS[l.categoria] ? l.categoria : "sem"] += d;
    t.total += d;
  });
  return t;
}


let _rgdLinhas = [];
let _rgdColagem = null;
let _rgdErros = [];

function rgdFmt(min){
  if(!min) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}
const rgdTxtNum = (v) => v == null || Number.isNaN(v) ? "" : String(v).replace(".", ",");


function abrirGradeRDO(){
  _rgdLinhas = rgdDeRdo(typeof _rdoExecucoes !== "undefined" ? _rdoExecucoes : [], typeof _rdoAtividades !== "undefined" ? _rdoAtividades : []);
  _rgdColagem = null;
  _rgdErros = rgdParaRdo(_rgdLinhas, $("rdo-data")?.value || null).erros;
  renderGradeRDO();
}

function rgdOpcoes(mapa, atual, vazio){
  return `<option value="">${esc(vazio || "—")}</option>` + Object.entries(mapa).map(([v, l]) => `<option value="${esc(v)}"${atual === v ? " selected" : ""}>${esc(l)}</option>`).join("");
}
function rgdLinhaHTML(l, idx){
  const prod = l.categoria === "producao", trecho = prod && (l.tipo === "prof" || l.tipo === "ref"), inj = prod && l.tipo === "sim";
  const dis = (ok) => ok ? "" : " disabled";
  const dur = rgdDuracao(l.h_inicial, l.h_final);
  return `<tr data-idx="${esc(idx)}"${l._semAtividade || (!l.h_inicial && !l.h_final && prod) ? ' class="rgd-sem-hora"' : ""}>
    <td><input type="text" class="rgd-c col-xs" data-campo="h_inicial" value="${esc(l.h_inicial || "")}" placeholder="HH:MM" inputmode="numeric" /></td>
    <td><input type="text" class="rgd-c col-xs" data-campo="h_final" value="${esc(l.h_final || "")}" placeholder="HH:MM" inputmode="numeric" /></td>
    <td><input type="text" class="rgd-c" data-campo="descricao" value="${esc(l.descricao || "")}" style="min-width:220px;" /></td>
    <td><select class="rgd-c" data-campo="categoria">${  rgdOpcoes(RGD_CATEGORIAS, l.categoria)}</select></td>
    <td><select class="rgd-c" data-campo="tipo"${dis(prod)}>${  rgdOpcoes(RGD_TIPOS, l.tipo)}</select></td>
    <td><input type="text" class="rgd-c col-sm" data-campo="estaca" value="${esc(l.estaca || "")}"${dis(prod)} /></td>
    <td><input type="text" class="rgd-c col-xs" data-campo="diametro" value="${esc(rgdTxtNum(l.diametro))}" inputmode="decimal"${dis(prod)} /></td>
    <td><input type="text" class="rgd-c col-xs" data-campo="inicial" value="${esc(rgdTxtNum(l.inicial))}" inputmode="decimal"${dis(trecho)} /></td>
    <td><input type="text" class="rgd-c col-xs" data-campo="final" value="${esc(rgdTxtNum(l.final))}" inputmode="decimal"${dis(trecho)} /></td>
    <td><input type="text" class="rgd-c col-xs" data-campo="inclinacao" value="${esc(l.inclinacao || "")}" list="rgd-inclinacoes"${dis(prod)} /></td>
    <td><input type="text" class="rgd-c" data-campo="solo" value="${esc(l.solo || "")}" list="rdo-solo-classif-lista" style="min-width:150px;"${dis(trecho)} /></td>
    <td><select class="rgd-c" data-campo="ferramenta"${dis(trecho)}>${  rgdOpcoes(RGD_FERRAMENTAS, l.ferramenta)}</select></td>
    <td><input type="text" class="rgd-c col-xs" data-campo="sacos" value="${esc(rgdTxtNum(l.sacos))}" inputmode="decimal"${dis(inj)} /></td>
    <td><input type="text" class="rgd-c col-xs" data-campo="volume" value="${esc(rgdTxtNum(l.volume))}" inputmode="decimal"${dis(inj)} /></td>
    <td><input type="text" class="rgd-c col-xs" data-campo="pressao" value="${esc(rgdTxtNum(l.pressao))}" inputmode="decimal"${dis(inj)} /></td>
    <td class="num rgd-dur">${esc(dur == null ? "—" : rgdFmt(dur))}</td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm txt-perigo rgd-rem" data-idx="${esc(idx)}" title="Tirar esta linha da grade (só sai do banco ao salvar o diário)">×</button></td>
  </tr>`;
}

function renderGradeRDO(){
  const tb = $("rgd-corpo");
  if(!tb) return;
  tb.innerHTML = _rgdLinhas.length ? _rgdLinhas.map(rgdLinhaHTML).join("")
    : `<tr><td colspan="17" class="vazio">Sem linhas. Use "+ Linha" ou cole as linhas do dia da planilha (Ctrl+V).</td></tr>`;
  rgdRenderTotais();
  rgdRenderAvisos();
}

function rgdRenderTotais(){
  const el = $("rgd-totais");
  if(!el) return;
  const t = rgdHorasPorCategoria(_rgdLinhas);
  const r = rgdParaRdo(_rgdLinhas, $("rdo-data")?.value || null);
  const nTrechos = r.execucoes.reduce((s, e) => s + e._solo.length, 0);
  const pct = (m) => t.total ? Math.round(100 * m / t.total) + "% do dia" : "";
  el.innerHTML = Object.entries(RGD_CATEGORIAS).map(([k, l]) => uiKpi(rgdFmt(t[k]), l, pct(t[k]))).join("")
    + (t.sem ? uiKpi(rgdFmt(t.sem), "Sem categoria", "linhas com hora e sem categoria") : "")
    + uiKpi(rgdFmt(t.total), "Total", `${r.execucoes.length} estaca(s) · ${nTrechos} trecho(s) · ${r.atividades.length} atividade(s)`);
}

function rgdRenderAvisos(){
  const el = $("rgd-avisos");
  if(!el) return;
  if(_rgdColagem){
    const c = _rgdColagem, r = rgdParaRdo(c.linhas, $("rdo-data")?.value || null), t = rgdHorasPorCategoria(c.linhas);
    const nTr = r.execucoes.reduce((s, e) => s + e._solo.length, 0), errs = [...c.erros, ...r.erros];
    el.className = "aviso " + (errs.length ? "erro" : "atencao");
    el.innerHTML = `<strong>Conferir a colagem:</strong> ${esc(c.linhas.length)} linha(s) lidas${c.cabecalho ? " (com cabeçalho)" : ""}: `
      + `${esc(r.execucoes.length)} estaca(s), ${esc(nTr)} trecho(s), ${esc(r.atividades.length)} atividade(s); `
      + Object.entries(RGD_CATEGORIAS).map(([k, l]) => `${esc(l)} ${esc(rgdFmt(t[k]))}`).join(", ") + "."
      + (errs.length || c.avisos.length ? `<ul>${[...errs, ...c.avisos].slice(0, 12).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "")
      + `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">`
      + `<button type="button" class="btn-sec btn-sm" id="rgd-col-subst" title="Troca as linhas da grade pelas coladas">Substituir a grade</button>`
      + `<button type="button" class="btn-sec btn-sm" id="rgd-col-acresc" title="Põe as linhas coladas no fim da grade">Acrescentar no fim</button>`
      + `<button type="button" class="btn-sec btn-sm" id="rgd-col-cancelar">Cancelar</button></div>`;
    $("rgd-col-subst")?.addEventListener("click", () => rgdAceitarColagem(true));
    $("rgd-col-acresc")?.addEventListener("click", () => rgdAceitarColagem(false));
    $("rgd-col-cancelar")?.addEventListener("click", () => { _rgdColagem = null; rgdRenderAvisos(); });
    return;
  }
  if(_rgdErros.length){
    el.className = "aviso erro";
    el.innerHTML = `<strong>Corrija antes de salvar:</strong><ul>${_rgdErros.slice(0, 12).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
  } else { el.className = "aviso"; el.innerHTML = ""; }
}


function rgdAplicar(){
  const r = rgdParaRdo(_rgdLinhas, $("rdo-data")?.value || null);
  _rgdErros = r.erros;
  if(typeof _rdoExecucoes !== "undefined"){
    const m = rgdMesclar(_rdoExecucoes, r.execucoes);
    _rdoExecucoes = m.execucoes.map(e => { const x = { ...e }; delete x._semPerf; delete x._semSim; return x; });
  }
  if(typeof _rdoAtividades !== "undefined") _rdoAtividades = r.atividades;
  if(typeof renderRdoAtividades === "function") renderRdoAtividades();
  if(typeof atualizarChipsExec === "function") atualizarChipsExec();
  if(typeof appMarcarSujo === "function") appMarcarSujo();
  rgdRenderTotais();
  rgdRenderAvisos();
}


function rgdConferirAntesDeSalvar(){
  if(!document.querySelector('#rdo-notebook button[data-tab="grade"].ativo')) return null;
  return _rgdErros.length ? "A grade do dia tem erro: " + _rgdErros[0] : null;
}

function rgdNovaLinha(ant){
  return { h_inicial: ant && ant.h_final ? ant.h_final : null, h_final: null, descricao: null, categoria: ant ? ant.categoria : null,
    tipo: ant && ant.categoria === "producao" && (ant.tipo === "prof" || ant.tipo === "ref") ? ant.tipo : null,
    inicial: ant && (ant.tipo === "prof" || ant.tipo === "ref") ? ant.final : null, final: null, inclinacao: ant ? ant.inclinacao : null,
    solo: null, ferramenta: ant ? ant.ferramenta : null, sacos: null, volume: null, pressao: null };
}
function rgdAdicionarLinha(focar){
  _rgdLinhas.push(rgdNovaLinha(_rgdLinhas[_rgdLinhas.length - 1]));
  renderGradeRDO();
  rgdAplicar();
  if(focar){
    const tr = $("rgd-corpo")?.querySelector(`tr[data-idx="${_rgdLinhas.length - 1}"]`);
    tr?.querySelector(`[data-campo="${focar}"]`)?.focus();
  }
}

function rgdAceitarColagem(substituir){
  if(!_rgdColagem) return;
  const novas = _rgdColagem.linhas;
  if(substituir && _rgdLinhas.length && !confirm(`Trocar as ${_rgdLinhas.length} linha(s) da grade pelas ${novas.length} coladas?\nAs estacas que não estiverem nas linhas coladas saem do diário ao salvar.`)) return;
  _rgdLinhas = substituir ? novas : [..._rgdLinhas, ...novas];
  _rgdColagem = null;
  renderGradeRDO();
  rgdAplicar();
}

function rgdLerCampo(el){
  const idx = Number(el.closest("tr")?.dataset.idx), campo = el.dataset.campo, l = _rgdLinhas[idx];
  if(!l || !campo) return null;
  let v = el.value;
  if(campo === "h_inicial" || campo === "h_final"){
    const h = rgdHora(v);
    el.classList.toggle("rgd-invalido", !!v.trim() && !h);
    l[campo] = h || (v.trim() ? v.trim() : null);
  } else if(RGD_NUMERICAS.includes(campo)){
    const n = rgdNum(v);
    el.classList.toggle("rgd-invalido", Number.isNaN(n));
    l[campo] = Number.isNaN(n) ? null : n;
  } else l[campo] = v.trim() ? v.trim() : null;
  if(campo === "inicial" || campo === "final" || campo === "solo" || campo === "ferramenta") delete l._semTrecho;
  if(campo === "categoria" && l.categoria !== "producao") l.tipo = null;
  return { idx, campo, l };
}

function ligarGradeRDO(){
  const tb = $("rgd-corpo");
  if(!tb || tb.dataset.ligado) return;
  tb.dataset.ligado = "1";
  $("btn-rgd-linha")?.addEventListener("click", () => rgdAdicionarLinha("h_final"));
  tb.addEventListener("input", (ev) => {
    const el = ev.target.closest(".rgd-c");
    if(!el || el.tagName === "SELECT") return;
    const r = rgdLerCampo(el);
    if(!r) return;
    const tr = el.closest("tr"), dur = rgdDuracao(r.l.h_inicial, r.l.h_final);
    if(tr && tr.querySelector(".rgd-dur")) tr.querySelector(".rgd-dur").textContent = dur == null ? "—" : rgdFmt(dur);
    rgdAplicar();
  });
  tb.addEventListener("change", (ev) => {
    const el = ev.target.closest(".rgd-c");
    if(!el) return;
    const r = rgdLerCampo(el);
    if(!r) return;
    if(el.tagName === "SELECT"){
      const tr = el.closest("tr");
      if(tr){ tr.outerHTML = rgdLinhaHTML(r.l, r.idx); $("rgd-corpo")?.querySelector(`tr[data-idx="${r.idx}"] [data-campo="${r.campo}"]`)?.focus(); }
    } else if(r.campo === "h_inicial" || r.campo === "h_final"){
      const h = rgdHora(el.value); if(h) el.value = h;
    }
    rgdAplicar();
  });
  tb.addEventListener("click", (ev) => {
    const b = ev.target.closest(".rgd-rem");
    if(!b) return;
    _rgdLinhas.splice(Number(b.dataset.idx), 1);
    renderGradeRDO();
    rgdAplicar();
  });

  tb.addEventListener("keydown", (ev) => {
    if(ev.key !== "Enter" || ev.shiftKey || ev.ctrlKey || ev.altKey) return;
    const el = ev.target.closest(".rgd-c");
    if(!el) return;
    ev.preventDefault();
    el.dispatchEvent(new Event("change", { bubbles: true }));
    const idx = Number(el.closest("tr")?.dataset.idx), campo = el.dataset.campo;
    if(idx >= _rgdLinhas.length - 1){ rgdAdicionarLinha(campo === "h_inicial" ? "h_final" : campo); return; }
    $("rgd-corpo")?.querySelector(`tr[data-idx="${idx + 1}"] [data-campo="${campo}"]`)?.focus();
  });

  $("rgd-tabela")?.addEventListener("paste", (ev) => {
    const txt = ev.clipboardData ? ev.clipboardData.getData("text/plain") : "";
    if(!txt || (!txt.includes("\t") && !/\n./.test(txt.trim()))) return;
    ev.preventDefault();
    _rgdColagem = rgdColar(txt, $("rdo-data")?.value || null);
    rgdRenderAvisos();
    $("rgd-avisos")?.scrollIntoView({ block: "nearest" });
  });
}
if(typeof document !== "undefined" && document.addEventListener && typeof window !== "undefined")
  document.addEventListener("DOMContentLoaded", ligarGradeRDO);

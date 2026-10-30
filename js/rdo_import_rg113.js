/* ====================================================================
   Import da planilha RG 11.3 (diário de estaca raiz, .xlsx) — lote S57 (#220)
   A planilha da obra tem uma aba "SEPARADOS" (cabeçalho na linha 9, colunas B:AA) com uma linha por
   atividade do dia:
     DATA | INÍCIO | FIM | DESCRIÇÃO | D P M O | INJEÇÃO | SACO | VOLUME | PRESSÃO (kg/cm²) | LOCAL | BLOCO |
     NOME ESTACA | DIÂMETRO | INICIAL | FINAL | PROF. (M) | INCLINAÇÃO | CLASSIFICAÇÃO DO SOLO | MATERIAL | RDO |
     MEDIÇÃO | HORA INICIAL/FINAL | EQUIPE | EQUIPAMENTO | PERÍODO | ABASTECIMENTO
   Vira o MESMO contrato v3 (dias[]) do import por IA e da planilha do Maya, consumido por montarPreviewDias
   (rdo.js): prévia e conferência antes de gravar. A IA não entra.
     • linha com INÍCIO/FIM            → atividade hora a hora (justificativa) "[D P M O] DESCRIÇÃO"
     • HORA INICIAL/FINAL Inicio/Fim   → entrada e saída da equipe; almoço → intervalo
     • EQUIPE (nomes distintos do dia) → equipe (casada com o cadastro em montarPreviewDias)
     • INJEÇÃO = PROF                  → trecho de perfuração da estaca (de, até, solo, ferramenta)
     • INJEÇÃO = sim                   → injeção da estaca (saco, volume e pressão em 0 = sem consumo)
     • outro texto em INJEÇÃO          → observação da estaca
     • ABASTECIMENTO > 0               → abastecimento do dia (litros)
   Fica fora: MEDIÇÃO (é da medição), as abas Planilha1 e DADOS. Período diferente de DIURNO só avisa.
   Depende de SheetJS (XLSX) e dos utilitários de rdo_import_maya.js (mayaNorm, mayaDataISO, mayaIntervaloAlmoco),
   usados só em tempo de execução.
   ==================================================================== */
const RG113_ABA = "separados";
const RG113_FERRAMENTAS = ["revestimento", "martelo", "tricone", "trado"];

/* Procura o cabeçalho (linha com "NOME ESTACA" e "D P M O") nas primeiras linhas de uma aba */
function rg113AcharCabecalho(linhas){
  for(let i = 0; i < Math.min(40, linhas.length); i++){
    const cab = (linhas[i] || []).map(c => mayaNorm(c));
    if(cab.includes("nome estaca") && cab.includes("d p m o")) return { linha: i, cab };
  }
  return null;
}
function rg113Linhas(ws){
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}
/* wb (SheetJS) → { aba, linhas, cab, linhaCab } quando é um RG 11.3; senão null */
function rg113Detectar(wb){
  if(!wb || !Array.isArray(wb.SheetNames)) return null;
  const nomes = [...wb.SheetNames].sort((a, b) => (mayaNorm(b) === RG113_ABA ? 1 : 0) - (mayaNorm(a) === RG113_ABA ? 1 : 0));
  for(const n of nomes){
    if(["planilha1", "dados"].includes(mayaNorm(n))) continue;
    const linhas = rg113Linhas(wb.Sheets[n]);
    const c = rg113AcharCabecalho(linhas);
    if(c) return { aba: n, linhas, cab: c.cab, linhaCab: c.linha };
  }
  return null;
}

const rg113EhData = (v) => Object.prototype.toString.call(v) === "[object Date]";
/* Texto da célula: 0, "-" e vazio contam como vazio */
function rg113Txt(v){
  if(v == null) return "";
  if(typeof v === "number") return v === 0 ? "" : String(v);
  if(rg113EhData(v)) return "";
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "-" || t === "0" ? "" : t;
}
function rg113Num(v){
  if(v == null || v === "") return null;
  if(typeof v === "number") return isFinite(v) ? v : null;
  return mayaNum(v);
}
const rg113Pos = (v) => { const n = rg113Num(v); return n != null && n > 0 ? n : null; };
const rg113R2 = (n) => n == null ? null : Math.round(n * 100) / 100;
const rg113HHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/* Hora: Date (cellDates), fração do dia (número) ou texto "07:30"; "-" e 0:00 contam como vazio */
function rg113Hora(v){
  let min = null;
  if(rg113EhData(v)){
    if(isNaN(v.getTime())) return null;
    min = Math.round(v.getHours() * 60 + v.getMinutes() + v.getSeconds() / 60);
  } else if(typeof v === "number"){
    if(!isFinite(v) || v < 0) return null;
    min = Math.round((v % 1) * 1440);
  } else {
    const m = String(v == null ? "" : v).trim().match(/^(\d{1,2})[:h](\d{2})/);
    if(!m) return null;
    min = Number(m[1]) * 60 + Number(m[2]);
  }
  if(min == null || min <= 0 || min >= 1440) return null;
  return rg113HHMM(min);
}
/* Data local (Date do cellDates, número de série ou texto dd/mm/aaaa); 00/01/1900 e vazio → null */
function rg113Data(v){
  if(rg113EhData(v)){
    if(isNaN(v.getTime()) || v.getFullYear() < 1901) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if(typeof v === "number"){
    if(!(v > 1) || typeof XLSX === "undefined") return null;
    const p = XLSX.SSF.parse_date_code(v);
    if(!p || p.y < 1901) return null;
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  }
  const iso = mayaDataISO(v);
  return iso && iso >= "1901-01-01" ? iso : null;
}
const rg113DataBR = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const rg113M = (n) => String(rg113R2(n)).replace(".", ",");
/* Metragem coberta pelos trechos (união dos intervalos): reperfuração no mesmo trecho não soma duas vezes */
function rg113Uniao(trechos){
  const iv = trechos.filter(t => t.de != null && t.ate != null && t.ate > t.de).map(t => [t.de, t.ate]).sort((a, b) => a[0] - b[0]);
  let total = 0, ini = null, fim = null, sobrepoe = false;
  iv.forEach(([a, b]) => {
    if(fim == null || a >= fim - 0.001){ if(fim != null) total += fim - ini; ini = a; fim = b; }
    else { sobrepoe = true; if(b > fim) fim = b; }
  });
  if(fim != null) total += fim - ini;
  return { metros: iv.length ? rg113R2(total) : null, sobrepoe };
}

/* wb (SheetJS lido com cellDates: true) → { dias[], ... } no contrato v3 */
function rg113ParaDias(wb){
  const det = rg113Detectar(wb);
  if(!det) throw new Error("Não encontrei a aba SEPARADOS (cabeçalho com \"NOME ESTACA\" e \"D P M O\") na planilha RG 11.3.");
  const { linhas, cab, linhaCab } = det;
  const col = (...nomes) => { for(const n of nomes){ const i = cab.indexOf(n); if(i >= 0) return i; } return -1; };
  const colPref = (p) => cab.findIndex(h => h.startsWith(p));
  const C = {
    data: col("data"), ini: col("inicio"), fim: col("fim"), desc: colPref("descric"), dpmo: col("d p m o"),
    inj: colPref("injec"), saco: col("saco"), vol: colPref("volume"), pressao: colPref("pressao"),
    local: col("local"), bloco: col("bloco"), estaca: col("nome estaca"), diam: colPref("diametro"),
    de: col("inicial"), ate: col("final"), incl: colPref("inclinac"), solo: colPref("classificac"), material: col("material"),
    rdo: col("rdo"), hif: colPref("hora inicial"), equipe: col("equipe"), equip: col("equipamento"), periodo: colPref("periodo"),
    abast: colPref("abastec")
  };
  if(C.data < 0 || C.estaca < 0) throw new Error("A aba SEPARADOS não tem as colunas DATA e NOME ESTACA.");
  const cel = (r, k) => C[k] >= 0 ? r[C[k]] : null;

  const dias = {};
  const dia = (iso) => (dias[iso] = dias[iso] || { data: iso, obra: "", tipo_servico: "estaca_raiz", maquina: null, tempo_manha: null, tempo_tarde: null,
    responsavel: null, atividades: null, observacoes: null, almoco_inicio: null, almoco_fim: null, intervalo_minutos: null,
    equipe: [], injecao: [], estacas: [], abastecimentos: [], justificativa: [], raiz_dados: null,
    _nomes: [], _obs: [], _ent: null, _sai: null, _ests: {}, _bol: [], _locais: [], _blocos: [], _periodos: [] });
  const addU = (arr, v) => { if(v && !arr.includes(v)) arr.push(v); };
  let nLinhas = 0, nFora = 0;

  for(let i = linhaCab + 1; i < linhas.length; i++){
    const r = linhas[i] || [];
    const iso = rg113Data(cel(r, "data"));
    // linha-modelo da planilha (data 00/01/1900, fórmula sem lançamento) sai calada; sem data e com conteúdo, avisa
    if(!iso){ if(!rg113Txt(cel(r, "data")) && !rg113EhData(cel(r, "data")) && r.some(c => rg113Txt(c))) nFora++; continue; }
    nLinhas++;
    const d = dia(iso);
    const hi = rg113Hora(cel(r, "ini")), hf = rg113Hora(cel(r, "fim"));
    const desc = rg113Txt(cel(r, "desc")), dpmo = rg113Txt(cel(r, "dpmo"));
    const per = rg113Txt(cel(r, "periodo"));
    if(per && mayaNorm(per) !== "diurno") addU(d._periodos, per);
    const eqp = rg113Txt(cel(r, "equip"));
    if(eqp && !d.maquina) d.maquina = eqp;
    if(hi || hf){
      d.justificativa.push({ h_inicial: hi, h_final: hf, motivo: (dpmo ? `[${dpmo}] ` : "") + desc || null });
      if(/almo[çc]o/i.test(desc) && hi && hf && !d.almoco_inicio){
        d.almoco_inicio = hi; d.almoco_fim = hf;
        // mesma regra do Maya: tempo real do almoço (o piso de 30 min fica para o cálculo das horas)
        d.intervalo_minutos = mayaIntervaloAlmoco(`Das ${hi.replace(":", "h")} às ${hf.replace(":", "h")}: almoço`);
      }
    } else if(desc){
      d._obs.push(desc);
    }
    const marca = mayaNorm(rg113Txt(cel(r, "hif")));
    if(marca === "inicio" && hi && !d._ent) d._ent = hi;
    if(marca === "fim" && hf) d._sai = hf;
    addU(d._nomes, rg113Txt(cel(r, "equipe")));
    addU(d._bol, rg113Txt(cel(r, "rdo")));
    const litros = rg113Pos(cel(r, "abast"));
    if(litros != null) d.abastecimentos.push({ maquina: eqp || d.maquina || null, combustivel: "diesel", quantidade: litros, unidade: "L", horimetro: null, observacao: null });

    const numero = rg113Txt(cel(r, "estaca")).toUpperCase();
    if(!numero) continue;
    const bloco = rg113Txt(cel(r, "bloco")) || null, local = rg113Txt(cel(r, "local")) || null;
    addU(d._locais, local); addU(d._blocos, bloco);
    const e = d._ests[numero] || (d._ests[numero] = { numero, agrupamento: bloco, trechos: [], hIni: [], hFim: [], diams: [], inclinacao: null,
      boletim: null, obs: [], inj: [], perf: false });
    if(!e.agrupamento && bloco) e.agrupamento = bloco;
    const injTxt = rg113Txt(cel(r, "inj")), injN = mayaNorm(injTxt);
    const de = rg113Num(cel(r, "de")), ate = rg113Num(cel(r, "ate"));
    if(injN === "prof" || (!injN && ate != null && ate > 0)){
      e.perf = true;
      const mat = mayaNorm(rg113Txt(cel(r, "material")));
      e.trechos.push({ de: rg113R2(de ?? 0), ate: rg113R2(ate), solo: rg113Txt(cel(r, "solo")) || null,
        ferramenta: mat ? (RG113_FERRAMENTAS.includes(mat) ? mat : "outro") : null });
      if(hi) e.hIni.push(hi);
      if(hf) e.hFim.push(hf);
      addU(e.diams, rg113Pos(cel(r, "diam")));
      const inc = rg113Txt(cel(r, "incl"));
      if(inc && !e.inclinacao) e.inclinacao = inc;
      if(!e.boletim) e.boletim = rg113Txt(cel(r, "rdo")) || null;
    } else if(injN === "sim"){
      e.inj.push({ ini: hi, fim: hf, saco: rg113Pos(cel(r, "saco")), volume: rg113Pos(cel(r, "vol")), pressao: rg113Pos(cel(r, "pressao")) });
      if(!e.boletim) e.boletim = rg113Txt(cel(r, "rdo")) || null;
    } else if(injTxt){
      e.obs.push(injTxt);
      if(!e.boletim) e.boletim = rg113Txt(cel(r, "rdo")) || null;
    }
  }

  const lista = Object.values(dias).sort((a, b) => a.data.localeCompare(b.data));
  if(!lista.length) throw new Error("A aba SEPARADOS não tem linhas com data.");
  const duvidas = [];
  const injSemConsumo = [];
  const maxAnterior = {};   // estaca → { ate, dia }: maior profundidade já perfurada em dia anterior (reperfuração)
  lista.forEach(d => {
    d.equipe = d._nomes.map(nome => ({ nome, funcao: null, hora_entrada: d._ent, hora_saida: d._sai, horas_normais: null, horas_50: null, horas_100: null }));
    if(d._periodos.length) duvidas.push(`${rg113DataBR(d.data)}: período ${d._periodos.join("/")} (o leitor foi conferido só com o diurno)`);
    Object.values(d._ests).forEach(e => {
      const u = rg113Uniao(e.trechos);
      if(u.sobrepoe) duvidas.push(`${e.numero} em ${rg113DataBR(d.data)}: trechos sobrepostos (reperfuração); metragem do dia pela união (${rg113M(u.metros)} m)`);
      const ant = maxAnterior[e.numero];
      const minDe = e.trechos.reduce((m, t) => t.de != null && (m == null || t.de < m) ? t.de : m, null);
      if(e.perf && ant && minDe != null && minDe < ant.ate - 0.001)
        duvidas.push(`${e.numero} em ${rg113DataBR(d.data)}: trecho a partir de ${rg113M(minDe)} m repete o que já foi perfurado até ${rg113M(ant.ate)} m em ${rg113DataBR(ant.dia)} (reperfuração?)`);
      const maxAte = e.trechos.reduce((m, t) => t.ate != null && (m == null || t.ate > m) ? t.ate : m, null);
      if(maxAte != null && (!ant || maxAte > ant.ate)) maxAnterior[e.numero] = { ate: maxAte, dia: d.data };
      if(e.diams.length > 1) duvidas.push(`${e.numero} em ${rg113DataBR(d.data)}: mais de um diâmetro (${e.diams.join(", ")} mm)`);
      e.trechos.filter(t => t.ferramenta === "outro").forEach(() => duvidas.push(`${e.numero} em ${rg113DataBR(d.data)}: material fora da lista (revestimento, martelo, tricone, trado)`));
      const obs = [];
      e.inj.forEach(j => {
        const sem = j.saco == null && j.volume == null && j.pressao == null;
        obs.push(`Injeção${j.ini || j.fim ? ` ${j.ini || "?"}–${j.fim || "?"}` : ""}${sem ? " (injeção sem consumo na planilha)" : ""}`);
        if(sem) injSemConsumo.push(`${e.numero} em ${rg113DataBR(d.data)}`);
        d.injecao.push({ estaca: e.numero, agrupamento: e.agrupamento, consumo_cimento: j.saco, consumo_areia: null, consumo_areia_unidade: null,
          agua_l: null, volume_injetado_m3: j.volume, pressao_kgcm2: j.pressao });
      });
      e.obs.forEach(t => { obs.push(t); duvidas.push(`${e.numero} em ${rg113DataBR(d.data)}: coluna INJEÇÃO com texto "${t.slice(0, 60)}" (foi para a observação da estaca)`); });
      const hIni = [...e.hIni].sort(), hFim = [...e.hFim].sort();
      d.estacas.push({
        numero: e.numero, agrupamento: e.agrupamento, refuro: false,
        diametro_mm: e.diams[0] ?? null, profundidade_projeto: null,
        profundidade_executada: e.perf ? u.metros : null,
        trechos: e.trechos, perfuracao_de_m: null, perfuracao_ate_m: null,
        perfuracao_inicio: hIni[0] || null, perfuracao_fim: hFim[hFim.length - 1] || null,
        concretagem_inicio: null, concretagem_fim: null, torque: null, volume_concreto_m3: null,
        inclinacao: e.inclinacao, maquina: d.maquina, observacoes: obs.join(" · ") || null,
        numero_boletim_fisico: e.boletim
      });
    });
    const perfs = d.estacas.filter(e => e.profundidade_executada), injs = d.estacas.filter(e => /^Injeção/.test(e.observacoes || ""));
    d.observacoes = [d._bol.length ? `Boletim físico (RDO) nº ${d._bol.join(", ")}` : null, ...d._obs].filter(Boolean).join("\n") || null;
    if(d.estacas.length){
      d.atividades = [perfs.length ? `Perfuração de ${perfs.map(e => `${e.numero} (${rg113M(e.profundidade_executada)} m)`).join(", ")}` : null,
        injs.length ? `injeção de ${injs.map(e => e.numero).join(", ")}` : null].filter(Boolean).join("; ") + (d.maquina ? ` com ${d.maquina}` : "") + " — planilha RG 11.3.";
    } else {
      d.atividades = "Sem execução de estacas neste dia (ver atividades hora a hora).";
      d.sem_estacas = true;
    }
    d.raiz_dados = (d._locais.length || d._blocos.length) ? { local_obra: d._locais.join(", ") || null, bloco: d._blocos.join(", ") || null } : null;
    ["_nomes", "_obs", "_ent", "_sai", "_ests", "_bol", "_locais", "_blocos", "_periodos"].forEach(k => delete d[k]);
  });
  if(injSemConsumo.length) duvidas.push(`${injSemConsumo.length} injeção(ões) sem consumo na planilha (saco, volume e pressão em 0): ${injSemConsumo.join(", ")}`);

  const nEst = lista.reduce((s, d) => s + d.estacas.length, 0);
  const nAbast = lista.reduce((s, d) => s + d.abastecimentos.length, 0);
  const nSem = lista.filter(d => d.sem_estacas).length;
  return {
    dias: lista, manuscrito: false, confianca: "alta", duvidas,
    origem_label: "📊 Planilha RG 11.3 (diário de estaca raiz, aba SEPARADOS)",
    observacoes: `${nLinhas} linha(s) em ${lista.length} dia(s), de ${dataBRrg(lista[0].data)} a ${dataBRrg(lista[lista.length - 1].data)}; ` +
      `${nEst} estaca(s)-dia em ${lista.length - nSem} dia(s)` +
      (nSem ? `, ${nSem} dia(s) sem estaca (viram RDO só com atividades e equipe)` : "") +
      (nAbast ? `, ${nAbast} abastecimento(s)` : "") +
      (nFora ? ` · ${nFora} linha(s) sem data válida ignoradas` : "") + ". MEDIÇÃO fica de fora (é da medição)."
  };
}
const dataBRrg = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/* Lê o .xlsx; se for um RG 11.3 monta a prévia e devolve true; senão devolve false (segue para o leitor do Maya) */
async function processarArquivoXlsxRG113(file){
  if(typeof XLSX === "undefined") return false;
  let wb;
  try { wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true }); }
  catch(_){ return false; }
  if(!rg113Detectar(wb)) return false;
  const btn = $("btn-csv-processar");
  const txtBtn = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "📊 Lendo o RG 11.3…"; }
  try {
    const data = rg113ParaDias(wb);
    _iaOrigem = "xlsx_rg113";
    const obraSel = $("rdo-obra")?.value || null;
    await montarPreviewDias(data, "xlsx_rg113", obraSel);
  } catch(err){
    aviso("app-aviso", "Planilha RG 11.3: " + err.message, "erro");
    if($("csv-aviso")) aviso("csv-aviso", "Planilha RG 11.3: " + err.message, "erro");
    console.error("Planilha RG 11.3:", err);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = txtBtn; }
  }
  return true;
}

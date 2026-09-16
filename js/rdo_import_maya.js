/* ====================================================================
   Import do "Relatório Diário" do Maya (.xlsx) — fase 46 (16/09/2026)
   O Maya (sistema de gerenciamento usado hoje) exporta uma planilha com:
     • Estacas            — Item | Estaca | Data | Diâmetro | Prof. exec. | Perfuração (h) | Concretagem (h) | Torque | Operador | Máquina
     • Resumo das Estacas — ignorado (é derivado)
     • Observações        — Estaca | Observação  (texto por estaca)
     • Ocorrências        — Item | Data | Ocorrência | Paralisado? | Em Razão do Cliente? | Período (h) | Operador | Máquina | Descrição
   Blocos COMPLEMENTARES (o Maya não traz; a equipe acrescenta na mesma planilha,
   em qualquer aba, com o mesmo padrão "título na coluna A + cabeçalho + linhas"):
     • Abastecimento      — Data | Máquina | Combustível | Quantidade (L) | Horímetro | Observação
     • Fim do Expediente  — Data | Hora | Descrição   (também aceita "Encerramento")
   Tudo vira o MESMO contrato v3 (dias[]) que a Edge Function extrair-rdo-arquivo
   devolve e segue pelo preview de conferência do import por IA (montarPreviewDias
   em rdo.js). Dias só com ocorrência (manutenção, paralisação) também viram RDO —
   sem estacas, com equipe, observações e abastecimento.
   Depende de SheetJS (XLSX) já carregado no index.html.
   ==================================================================== */
function _ehArquivoXlsx(file){
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return ext === "xlsx" || ext === "xls" || /spreadsheetml|ms-excel/i.test(file.type || "");
}
function mayaNorm(s){
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
function mayaDataISO(s){
  const t = String(s == null ? "" : s).trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if(m) return `20${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
}
function mayaHora(s){
  const m = String(s == null ? "" : s).match(/(\d{1,2})[:h](\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}
function mayaPeriodo(s){
  const m = String(s == null ? "" : s).match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  return m ? { ini: `${m[1].padStart(2, "0")}:${m[2]}`, fim: `${m[3].padStart(2, "0")}:${m[4]}` } : { ini: null, fim: null };
}
function mayaNum(s){
  if(s == null || s === "") return null;
  let t = String(s).trim().replace(/[^0-9,.\-]/g, "");
  if(t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return isFinite(n) ? n : null;
}
/* "PC.110 - REF" / "PC.101 - REFORÇO" / "E12R" → { numero: "PC.110", refuro: true } */
function mayaEstaca(raw){
  const t = String(raw == null ? "" : raw).trim();
  const m = t.match(/^(.*?)\s*[-–]\s*(REF\S*|R)\s*$/i); // " - REF", " - REFORÇO", " - REFURO"…
  if(m) return { numero: m[1].trim(), refuro: true, raw: t };
  const r = t.match(/^(.*\d)\s*R$/i); // "E12R" (padrão dos boletins)
  if(r) return { numero: r[1].trim(), refuro: true, raw: t };
  return { numero: t, refuro: false, raw: t };
}
/* "Das 12h30 às 13h30: Horário de almoço" → minutos de intervalo (regra RH: tempo real, piso 30 no cálculo) */
function mayaIntervaloAlmoco(descricao){
  const m = String(descricao || "").match(/(\d{1,2})h(\d{2})?\s*(?:às|as|a|-)\s*(\d{1,2})h(\d{2})?\s*:?\s*[^.]*almo[çc]o/i);
  if(!m) return null;
  const ini = Number(m[1]) * 60 + Number(m[2] || 0), fim = Number(m[3]) * 60 + Number(m[4] || 0);
  const d = fim - ini;
  return d > 0 && d <= 240 ? d : null;
}
/* Localiza um bloco pelo título na coluna A (em qualquer aba) e devolve as linhas como objetos pelo cabeçalho normalizado */
function mayaBloco(abas, titulos){
  const alvos = (Array.isArray(titulos) ? titulos : [titulos]).map(mayaNorm);
  for(const linhas of abas){
    const i = linhas.findIndex(r => alvos.includes(mayaNorm(r[0])));
    if(i < 0 || !linhas[i + 1]) continue;
    const cab = linhas[i + 1].map(mayaNorm);
    const regs = [];
    for(let k = i + 2; k < linhas.length; k++){
      const r = linhas[k] || [];
      const vazia = r.every(c => String(c == null ? "" : c).trim() === "");
      if(vazia) break;
      const a = mayaNorm(r[0]);
      if(a === "total:" || a === "total" || /^(resumo|observac|ocorrenc|abastec|fim do exp|fim de exp|encerramento|estacas$)/.test(a)) break;
      const o = {};
      cab.forEach((h, ci) => { if(h) o[h] = r[ci] == null ? "" : String(r[ci]).trim(); });
      regs.push(o);
    }
    return regs;
  }
  return null;
}
const mayaCampo = (o, ...prefixos) => {
  for(const p of prefixos){ const k = Object.keys(o).find(h => h.startsWith(p)); if(k) return o[k]; }
  return "";
};

/* Abas (array de arrays de arrays) → { dias[], ... } no contrato v3 */
function mayaParaDias(abas){
  const estacasBl = mayaBloco(abas, "Estacas");
  if(!estacasBl) throw new Error("Não encontrei o bloco \"Estacas\" na planilha. Exporte o Relatório Diário do Maya em .xlsx sem alterar o layout.");
  const obsBl   = mayaBloco(abas, ["Observações", "Observacoes"]) || [];
  const ocorBl  = mayaBloco(abas, ["Ocorrências", "Ocorrencias"]) || [];
  const abastBl = mayaBloco(abas, ["Abastecimento", "Abastecimentos"]) || [];
  const fimBl   = mayaBloco(abas, ["Fim do Expediente", "Fim de Expediente", "Encerramento", "Fim do expediente / Encerramento"]) || [];

  // Obra: qualquer linha antes de "Estacas" (1ª aba) com "Obra: xxx"
  let obra = "";
  const primeira = abas[0] || [];
  const iEst = primeira.findIndex(r => mayaNorm(r[0]) === "estacas");
  for(let k = 0; k < Math.max(0, iEst); k++){
    const txt = (primeira[k] || []).map(c => String(c == null ? "" : c)).join(" ");
    const m = txt.match(/obra\s*[:\-]\s*(.+)/i);
    if(m){ obra = m[1].trim(); break; }
  }

  const dias = {};
  const dia = (iso) => (dias[iso] = dias[iso] || { data: iso, obra, tipo_servico: null, maquina: null, tempo_manha: null, tempo_tarde: null,
    responsavel: null, atividades: null, observacoes: null, almoco_inicio: null, almoco_fim: null, intervalo_minutos: null,
    equipe: [], injecao: [], estacas: [], abastecimentos: [], _ops: {}, _ocorr: [], _fim: [] });
  const addOperador = (d, nome, periodo) => {
    const n = String(nome || "").trim(); if(!n) return;
    const p = d._ops[n] || (d._ops[n] = { nome: n, funcao: "operador", hora_entrada: null, hora_saida: null, horas_normais: null, horas_50: null, horas_100: null });
    if(periodo && periodo.ini && !p.hora_entrada){ p.hora_entrada = periodo.ini; p.hora_saida = periodo.fim; }
  };

  const duvidas = [];
  let temTorque = false;
  estacasBl.forEach(o => {
    const iso = mayaDataISO(mayaCampo(o, "data"));
    const est = mayaEstaca(mayaCampo(o, "estaca"));
    if(!iso || !est.numero){ duvidas.push(`Linha de estaca sem data ou número: ${JSON.stringify(o).slice(0, 80)}`); return; }
    const d = dia(iso);
    const perf = mayaPeriodo(mayaCampo(o, "perfuracao")), conc = mayaPeriodo(mayaCampo(o, "concretagem"));
    const torque = mayaNum(mayaCampo(o, "torque"));
    if(torque != null) temTorque = true;
    const maq = String(mayaCampo(o, "maquina") || "").trim() || null;
    if(maq && !d.maquina) d.maquina = maq;
    addOperador(d, mayaCampo(o, "operador"), null);
    if(!d.responsavel && mayaCampo(o, "operador")) d.responsavel = String(mayaCampo(o, "operador")).trim();
    d.estacas.push({
      numero: est.numero, _raw: est.raw, agrupamento: null, refuro: est.refuro,
      diametro_mm: mayaNum(mayaCampo(o, "diametro")),
      profundidade_projeto: null, profundidade_executada: mayaNum(mayaCampo(o, "profundidade")),
      trechos: [], perfuracao_de_m: null, perfuracao_ate_m: null,
      perfuracao_inicio: perf.ini, perfuracao_fim: perf.fim, concretagem_inicio: conc.ini, concretagem_fim: conc.fim,
      torque, volume_concreto_m3: null, inclinacao: null, maquina: maq, observacoes: null
    });
  });

  // Observações por estaca: casa pelo nome cru (inclui " - REF") em todos os dias em que a estaca aparece
  obsBl.forEach(o => {
    const raw = String(mayaCampo(o, "estaca") || "").trim(), txt = String(mayaCampo(o, "observac") || "").trim();
    if(!raw || !txt) return;
    let achou = false;
    Object.values(dias).forEach(d => d.estacas.forEach(e => {
      if(mayaNorm(e._raw) === mayaNorm(raw)){ e.observacoes = e.observacoes ? e.observacoes + " · " + txt : txt; achou = true; }
    }));
    if(!achou) duvidas.push(`Observação da estaca "${raw}" sem estaca correspondente: "${txt.slice(0, 60)}${txt.length > 60 ? "…" : ""}"`);
  });

  // Ocorrências por dia: viram observações do RDO + entrada/saída do operador + intervalo de almoço
  ocorBl.forEach(o => {
    const iso = mayaDataISO(mayaCampo(o, "data"));
    if(!iso) return;
    const d = dia(iso);
    const periodo = mayaPeriodo(mayaCampo(o, "periodo"));
    const desc = String(mayaCampo(o, "descric") || "").trim();
    const tipo = String(mayaCampo(o, "ocorrencia") || "").trim();
    const paralisado = /^s/i.test(mayaCampo(o, "paralisado"));
    const cliente = /^s/i.test(mayaCampo(o, "em razao", "razao"));
    const cab = [tipo ? `Ocorrência: ${tipo}` : null, paralisado ? "Paralisado: sim" : null, cliente ? "Em razão do cliente: sim" : null,
      periodo.ini ? `Período ${periodo.ini}–${periodo.fim}` : null].filter(Boolean).join(" · ");
    d._ocorr.push((cab ? `[${cab}] ` : "") + desc);
    const maq = String(mayaCampo(o, "maquina") || "").trim() || null;
    if(maq && !d.maquina) d.maquina = maq;
    addOperador(d, mayaCampo(o, "operador"), periodo);
    if(!d.responsavel && mayaCampo(o, "operador")) d.responsavel = String(mayaCampo(o, "operador")).trim();
    const iv = mayaIntervaloAlmoco(desc);
    if(iv != null && d.intervalo_minutos == null) d.intervalo_minutos = iv;
  });

  // Fim do expediente / encerramento (bloco complementar): observação do dia + saída da equipe quando faltar
  fimBl.forEach(o => {
    const iso = mayaDataISO(mayaCampo(o, "data"));
    if(!iso) return;
    const d = dia(iso);
    const hora = mayaHora(mayaCampo(o, "hora"));
    const desc = String(mayaCampo(o, "descric", "observac", "texto") || "").trim();
    if(!hora && !desc) return;
    d._fim.push(`Fim do expediente${hora ? " às " + hora : ""}${desc ? ": " + desc : ""}`);
    if(hora) Object.values(d._ops).forEach(p => { if(!p.hora_saida) p.hora_saida = hora; });
  });

  // Abastecimento (bloco complementar, vem do diário do operador): por dia e máquina
  abastBl.forEach(o => {
    const iso = mayaDataISO(mayaCampo(o, "data"));
    if(!iso) return;
    const d = dia(iso);
    const maq = String(mayaCampo(o, "maquina", "equipamento", "tag") || "").trim() || d.maquina || null;
    const qtd = mayaNum(mayaCampo(o, "quantidade", "litros", "qtd"));
    const comb = String(mayaCampo(o, "combustivel", "tipo") || "").trim().toLowerCase() || "diesel";
    const hor = mayaNum(mayaCampo(o, "horimetro", "hora maq", "horas maq"));
    const obs = String(mayaCampo(o, "observac", "obs") || "").trim() || null;
    if(qtd == null && hor == null && !obs) return;
    d.abastecimentos.push({ maquina: maq, combustivel: comb, quantidade: qtd, unidade: "L", horimetro: hor, observacao: obs });
    if(maq && !d.maquina) d.maquina = maq;
  });

  const lista = Object.values(dias).sort((a, b) => a.data.localeCompare(b.data));
  lista.forEach(d => {
    d.equipe = Object.values(d._ops);
    d.observacoes = [...d._ocorr, ...d._fim].join("\n") || null;
    if(d.estacas.length){
      const diams = [...new Set(d.estacas.map(e => e.diametro_mm).filter(Boolean))].sort((a, b) => a - b);
      const ref = d.estacas.filter(e => e.refuro).length;
      d.atividades = `Execução de ${d.estacas.length} estaca(s)${diams.length ? " Ø " + diams.join("/") + " mm" : ""}${d.maquina ? " com " + d.maquina : ""}${ref ? ` (${ref} refuro${ref > 1 ? "s" : ""})` : ""} — Relatório Diário do Maya.`;
      const temConc = d.estacas.some(e => e.concretagem_inicio || e.concretagem_fim);
      d.tipo_servico = temConc ? "helice_continua" : (temTorque ? "helice_continua" : "trado_mecanizado");
    } else {
      d.atividades = "Sem execução de estacas neste dia (ver ocorrências).";
      d.sem_estacas = true;
    }
    d.estacas.forEach(e => delete e._raw);
    delete d._ops; delete d._ocorr; delete d._fim;
  });
  if(!lista.length) throw new Error("A planilha não tem linhas de estacas nem ocorrências com data.");
  const nAbast = lista.reduce((s, d) => s + d.abastecimentos.length, 0);
  return {
    dias: lista, manuscrito: false, confianca: "alta", duvidas,
    origem_label: "📊 <strong>Planilha do Maya</strong> (Relatório Diário .xlsx)",
    observacoes: `${estacasBl.length} estaca(s) em ${lista.filter(d => d.estacas.length).length} dia(s), ${ocorBl.length} ocorrência(s), ${obsBl.length} observação(ões) por estaca` +
      (fimBl.length ? `, ${fimBl.length} registro(s) de fim do expediente` : "") +
      (nAbast ? `, ${nAbast} abastecimento(s)` : ", sem bloco de Abastecimento (acrescente na planilha ou lance na ficha do RDO)") +
      (lista.some(d => d.sem_estacas) ? ` · ${lista.filter(d => d.sem_estacas).length} dia(s) só com ocorrência (viram RDO sem estacas)` : "") + "."
  };
}

async function processarArquivoXlsxMaya(file){
  const btn = $("btn-csv-processar");
  const txtBtn = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "📊 Lendo a planilha…"; }
  try {
    if(typeof XLSX === "undefined") throw new Error("Biblioteca de planilhas não carregou. Recarregue a página e tente de novo.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    // 1ª aba = a que tem "Relatório" no nome (export do Maya); as demais podem trazer os blocos complementares
    const nomes = [...wb.SheetNames].sort((a, b) => (/relat/i.test(b) ? 1 : 0) - (/relat/i.test(a) ? 1 : 0));
    const abas = nomes.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" }));
    const data = mayaParaDias(abas);
    _iaOrigem = "xlsx_maya";
    const obraSel = $("rdo-obra")?.value || null;
    await montarPreviewDias(data, "xlsx_maya", obraSel);
  } catch(err){
    aviso("app-aviso", "Planilha do Maya: " + err.message, "erro");
    if($("csv-aviso")) aviso("csv-aviso", "Planilha do Maya: " + err.message, "erro"); // o modal cobre o aviso geral
    console.error("Planilha do Maya:", err);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = txtBtn; }
  }
}

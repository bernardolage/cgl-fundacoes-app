/* ====================================================================
   APROPRIAÇÕES (fase 37 · 08/09/2026) — vista "Apropriações" do módulo Funcionários.
   Import mensal da planilha FINANCEIRO – APROPRIAÇÕES feito DIRETO NO NAVEGADOR
   (SheetJS): os dados bancários e salários nunca passam por servidor nosso nem por
   terceiros — vão do arquivo para o Supabase com a sessão do diretor/RH (RLS).
   - CONTROLE FINANCEIRO → funcionarios_sensiveis (banco/agência/operação/conta,
     salário contábil e particular) + folha_apropriacoes (uma linha por rubrica,
     centro_custo GERAL).
   - CÁLCULO APROPRIAÇÃO → folha_apropriacoes rubrica salario_contabil rateada por
     obra × equipamento (blocos de 4 colunas: nome | banco | dias | valor).
   Leitura: vw_custo_mao_obra_por_obra (salários / benefícios / encargos por obra).
   ==================================================================== */
let _aprop = { comp: null, comps: [], custo: [], folha: [], parse: null };

const APROP_RUBRICA_LBL = {
  salario_contabil: "Salário contábil", salario_particular: "Salário particular", unimed: "Unimed", unimed_copart: "Unimed copart.", metlife: "MetLife",
  seguro_vida: "Seguro de vida", vale_transporte: "Vale-transporte", vr: "VR", flash: "Flash", inss: "INSS", irrf: "IRRF", fgts: "FGTS",
  contribuicao_sindical: "Contrib. sindical", consignado: "Consignado", decimo_terceiro_1: "13º 1ª parcela", decimo_terceiro_2: "13º 2ª parcela", ferias: "Férias", rescisao: "Rescisão", outro: "Outros",
};
const APROP_GRUPO = { salario_contabil: "sal", salario_particular: "sal", decimo_terceiro_1: "sal", decimo_terceiro_2: "sal", ferias: "sal", rescisao: "sal",
  unimed: "ben", unimed_copart: "ben", metlife: "ben", seguro_vida: "ben", vale_transporte: "ben", vr: "ben", flash: "ben",
  inss: "enc", irrf: "enc", fgts: "enc", contribuicao_sindical: "enc", consignado: "enc", outro: "ben" };

function apropMoeda(v){ return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function apropNorm(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }
function apropCompLabel(c){ if(!c) return "—"; const d = new Date(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1, 1); return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); }

/* ---------- leitura ---------- */
async function apropCarregarCompetencias(){
  const { data } = await sb.from("folha_apropriacoes").select("competencia").order("competencia", { ascending: false }).limit(5000);
  _aprop.comps = [...new Set((data || []).map(r => r.competencia))];
  if(!_aprop.comp || !_aprop.comps.includes(_aprop.comp)) _aprop.comp = _aprop.comps[0] || null;
}

async function apropCarregar(comp){
  if(!comp){ _aprop.custo = []; _aprop.folha = []; return; }
  const [c, f] = await Promise.all([
    sb.from("vw_custo_mao_obra_por_obra").select("competencia,obra_id,centro_custo,salarios,beneficios,encargos,total").eq("competencia", comp),
    sb.from("folha_apropriacoes").select("funcionario_id,obra_id,centro_custo,equipamento_id,rubrica,valor,origem_import").eq("competencia", comp).limit(20000),
  ]);
  _aprop.custo = c.data || [];
  _aprop.folha = f.data || [];
}

async function renderFuncAprop(){
  const cont = $("func-conteudo");
  if(!cont) return;
  if(!funcVeSensivel()){ cont.innerHTML = `<p class="vazio">Apropriações da folha: acesso restrito à diretoria e ao RH.</p>`; return; }
  cont.innerHTML = `<p class="vazio">Carregando apropriações…</p>`;
  if(!_aprop.comps.length) await apropCarregarCompetencias();
  await apropCarregar(_aprop.comp);
  const nomeDe = (id) => (_funcs.find(f => f.id === id) || {}).nome || "?";
  const obraDe = (r) => r.obra_id ? (mapaObras?.[r.obra_id] || "Obra") : (r.centro_custo || "—");

  const tot = _aprop.custo.reduce((s, r) => ({ sal: s.sal + Number(r.salarios || 0), ben: s.ben + Number(r.beneficios || 0), enc: s.enc + Number(r.encargos || 0), total: s.total + Number(r.total || 0) }), { sal: 0, ben: 0, enc: 0, total: 0 });
  const funcs = new Set(_aprop.folha.map(r => r.funcionario_id));
  const rateado = _aprop.folha.filter(r => r.obra_id && r.rubrica === "salario_contabil").reduce((s, r) => s + Number(r.valor || 0), 0);
  const salGeral = _aprop.folha.filter(r => !r.obra_id && r.centro_custo === "GERAL" && r.rubrica === "salario_contabil").reduce((s, r) => s + Number(r.valor || 0), 0);

  // por funcionário
  const porFunc = new Map();
  _aprop.folha.forEach(r => {
    const a = porFunc.get(r.funcionario_id) || { id: r.funcionario_id, nome: nomeDe(r.funcionario_id), sal: 0, ben: 0, enc: 0, part: 0, obras: new Set() };
    const v = Number(r.valor || 0);
    if(r.obra_id || (r.centro_custo && r.centro_custo !== "GERAL")){ if(r.obra_id) a.obras.add(mapaObras?.[r.obra_id] || r.centro_custo || "obra"); else a.obras.add(r.centro_custo); }
    else if(r.rubrica === "salario_particular") a.part += v;
    else { const g = APROP_GRUPO[r.rubrica] || "ben"; a[g] += v; }
    porFunc.set(r.funcionario_id, a);
  });
  const listaFunc = [...porFunc.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const termo = ($("func-busca")?.value || "").trim().toLowerCase();
  const listaFiltrada = listaFunc.filter(a => !termo || a.nome.toLowerCase().includes(termo));

  cont.innerHTML = `
    <div class="meta" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;">
      <label>Competência <select id="aprop-comp">${_aprop.comps.map(c => `<option value="${c}" ${c === _aprop.comp ? "selected" : ""}>${apropCompLabel(c)}</option>`).join("") || `<option value="">— nenhuma importada —</option>`}</select></label>
      <label class="btn-sec btn-sm" style="cursor:pointer;">⬆️ Importar planilha (.xlsx)<input type="file" id="aprop-arquivo" accept=".xlsx,.xlsm" style="display:none;" /></label>
      <button type="button" class="btn-sec btn-sm" id="btn-aprop-csv" ${listaFunc.length ? "" : "disabled"}>⬇️ CSV</button>
      <span style="margin-left:auto;">Fonte: planilha FINANCEIRO – APROPRIAÇÕES (Google Drive → Arquivo → Baixar → .xlsx)</span>
    </div>
    <div id="aprop-preview"></div>
    <div class="indicadores" style="margin-bottom:12px;">
      <div class="ind"><div class="num">${funcs.size}</div><div class="rot">Funcionários na folha</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.sal || salGeral)}</div><div class="rot">Salários</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.ben)}</div><div class="rot">Benefícios</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.enc)}</div><div class="rot">Encargos</div></div>
      <div class="ind"><div class="num">${apropMoeda(rateado)}</div><div class="rot">Salário rateado por obra</div></div>
    </div>
    <h4 style="margin:0 0 6px;">Custo de mão de obra por obra / centro de custo</h4>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Obra / centro de custo</th><th class="num">Salários</th><th class="num">Benefícios</th><th class="num">Encargos</th><th class="num">Total</th></tr></thead>
      <tbody>${_aprop.custo.slice().sort((a, b) => Number(b.total) - Number(a.total)).map(r => `<tr><td>${esc(obraDe(r))}</td><td class="num">${apropMoeda(r.salarios)}</td><td class="num">${apropMoeda(r.beneficios)}</td><td class="num">${apropMoeda(r.encargos)}</td><td class="num"><strong>${apropMoeda(r.total)}</strong></td></tr>`).join("") || `<tr><td colspan="5" class="vazio">Nenhuma apropriação nesta competência. Importe a planilha do mês.</td></tr>`}</tbody>
    </table></div>
    <h4 style="margin:0 0 6px;">Por funcionário <span class="meta">(${listaFiltrada.length})</span></h4>
    <div class="tabela-rola"><table>
      <thead><tr><th>Funcionário</th><th class="num">Salário contábil</th><th class="num">Benefícios</th><th class="num">Encargos/descontos</th><th class="num">Particular</th><th>Obras (rateio)</th></tr></thead>
      <tbody>${listaFiltrada.map(a => `<tr><td>${esc(a.nome)}</td><td class="num">${apropMoeda(a.sal)}</td><td class="num">${apropMoeda(a.ben)}</td><td class="num">${apropMoeda(a.enc)}</td><td class="num">${apropMoeda(a.part)}</td><td class="meta">${esc([...a.obras].join(" · ") || "—")}</td></tr>`).join("") || `<tr><td colspan="6" class="vazio">—</td></tr>`}</tbody>
    </table></div>`;

  $("aprop-comp")?.addEventListener("change", async e => { _aprop.comp = e.target.value; await renderFuncAprop(); });
  $("aprop-arquivo")?.addEventListener("change", e => { const f = e.target.files[0]; if(f) apropLerArquivo(f); e.target.value = ""; });
  $("btn-aprop-csv")?.addEventListener("click", () => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Funcionario;Salario_contabil;Beneficios;Encargos;Particular;Obras"].concat(listaFunc.map(a => [a.nome, a.sal.toFixed(2), a.ben.toFixed(2), a.enc.toFixed(2), a.part.toFixed(2), [...a.obras].join(" | ")].map(cel).join(";"))).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = `apropriacoes-${_aprop.comp || ""}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  });
}

/* ---------- parse da planilha (no navegador) ---------- */
function apropNum(v){
  if(v == null || v === "" || v === " ") return null;
  if(typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/R\$\s?/, "");
  const n = Number(s); if(isFinite(n)) return n;
  const n2 = Number(s.replace(/\./g, "").replace(",", ".")); return isFinite(n2) ? n2 : null;
}
function apropSerialData(v){
  if(v instanceof Date) return v.toISOString().slice(0, 10);
  const n = Number(v); if(!isFinite(n) || n < 30000) return null;
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
}

function apropParse(wb){
  const nomeAba = (pref) => wb.SheetNames.find(n => apropNorm(n) === apropNorm(pref)) || wb.SheetNames.find(n => apropNorm(n).startsWith(apropNorm(pref)) && !/JUNHO|MAIO|ABRIL|MARCO|FEV|JAN|JUL|AGO|SET|OUT|NOV|DEZ/i.test(n)) || wb.SheetNames.find(n => apropNorm(n).startsWith(apropNorm(pref)));
  const linhas = (nome) => nome ? XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: "" }).map(r => r.map(c => typeof c === "string" ? c.trim() : c)) : [];
  const abaCF = nomeAba("CONTROLE FINANCEIRO"), abaCalc = nomeAba("CÁLCULO APROPRIAÇÃO");
  if(!abaCF) throw new Error("Aba CONTROLE FINANCEIRO não encontrada.");
  const cf = linhas(abaCF), calc = linhas(abaCalc);

  // competência: "Data Inicial" do CÁLCULO; senão, mês/ano do título do CONTROLE FINANCEIRO
  let competencia = null;
  const rDt = calc.find(r => /^Data Inicial/i.test(String(r[0] || "")));
  if(rDt){ const d = apropSerialData(rDt[1]); if(d) competencia = d.slice(0, 7) + "-01"; }
  if(!competencia){
    const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
    for(const r of cf.slice(0, 6)){ const t = apropNorm(r.join(" ")); const m = t.match(/(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s*\/\s*(20\d{2})/); if(m){ competencia = `${m[2]}-${String(MESES.indexOf(m[1]) + 1).padStart(2, "0")}-01`; break; } }
  }

  // CONTROLE FINANCEIRO
  const cab = cf.find(r => apropNorm(r[0]) === "FUNCIONARIO");
  if(!cab) throw new Error("Cabeçalho 'Funcionário' não encontrado no CONTROLE FINANCEIRO.");
  const H = cab.map(x => apropNorm(x));
  const col = (re, depois = -1) => H.findIndex((h, i) => i > depois && re.test(h));
  const iBanco = col(/^BANCO/), iAg = col(/^AGENCIA/), iOp = col(/^OPERACAO/), iConta = col(/^CONTA/), iSal = col(/^SALARIO CONTABIL/);
  const iUniC = col(/^UNIMED.*COPART/), iUni = H.findIndex(h => /^UNIMED/.test(h) && !/COPART/.test(h)), iMet = col(/^METLIFE/), iSeg = col(/^SEGURO/), iVT = col(/^(VT|VALE.?TRANSP)/), iVR = col(/^(VR|VALE.?REF)/);
  const iINSS = col(/^INSS/), iIR = col(/^IR/), iFGTS = col(/^FGTS/), iSind = col(/^CONTRIB/), iSalP = col(/^SALARIO PARTICULAR/);
  const iBancoP = col(/^BANCO/, iSalP), iAgP = col(/^AGENCIA/, iSalP), iOpP = col(/^OPERACAO/, iSalP), iContaP = col(/^CONTA/, iSalP);
  const iCX = col(/^CX/), iPremio = col(/^PREMIO/), iHEP = col(/^H\.?E/), iFlash = col(/^FLASH/), iCons = col(/^CONSIGNADO/), i13 = col(/2ª PARCELA|13/);
  const idx = cf.indexOf(cab);
  const sens = [], rubricas = [];
  cf.slice(idx + 1).forEach(r => {
    const nome = String(r[0] || "").trim();
    if(!nome || /^TOTAL/i.test(nome)) return;
    const g = (i) => (i >= 0 ? r[i] : null);
    const txt = (v) => (v == null || v === "") ? null : String(v).replace(/\.0$/, "").trim();
    sens.push({ nome, banco: txt(g(iBanco)), agencia: txt(g(iAg)), operacao: txt(g(iOp)), conta: txt(g(iConta)), salario_contabil: apropNum(g(iSal)), salario_particular: apropNum(g(iSalP)),
      particular: [g(iBancoP), g(iAgP), g(iOpP), g(iContaP)].map(txt).filter(Boolean).join(" · ") || null });
    const add = (rub, v) => { const n = apropNum(v); if(n != null && n !== 0) rubricas.push({ nome, rubrica: rub, valor: n }); };
    add("salario_contabil", g(iSal)); add("unimed", g(iUni)); add("metlife", g(iMet)); add("unimed_copart", g(iUniC)); add("seguro_vida", g(iSeg));
    add("vale_transporte", g(iVT)); add("vr", g(iVR)); add("inss", g(iINSS)); add("irrf", g(iIR)); add("fgts", g(iFGTS)); add("contribuicao_sindical", g(iSind));
    add("salario_particular", g(iSalP)); add("outro", g(iCX)); add("outro", g(iPremio)); add("outro", g(iHEP)); add("flash", g(iFlash)); add("consignado", g(iCons)); add("decimo_terceiro_2", g(i13));
  });

  // CÁLCULO APROPRIAÇÃO: blocos horizontais de 4 colunas
  const rateio = [];
  const linhaEq = calc.find(r => /^\d{2,3}\s*-\s*/.test(String(r[0] || "")) && /^\d{2,3}\s*-/.test(String(r[4] || "")));
  if(linhaEq){
    const blocos = [];
    for(let i = 0; i < linhaEq.length; i += 4){ const t = String(linhaEq[i] || "").trim(); if(t) blocos.push({ col: i, equip: t, cod: ((t.match(/^(\d{1,3})/) || [])[1] || "").padStart(2, "0") }); }
    const inicio = calc.indexOf(linhaEq);
    blocos.forEach(b => {
      let obraAtual = null;
      calc.slice(inicio + 1).forEach(r => {
        const a = String(r[b.col] || "").trim(); const val = r[b.col + 3];
        if(/^Equipe:/i.test(a)){ obraAtual = a.replace(/^Equipe:\s*/i, "").trim() || null; return; }
        if(!a || /^(Total|Local:)/i.test(a)) return;
        const n = apropNum(val);
        if(obraAtual && n != null && n !== 0 && !/^\d{4}\/\d{4}/.test(a)){
          const ctr = obraAtual.match(/(\d{4})\s*[\/-]\s*(20\d{2})/);
          rateio.push({ nome: a, equip_cod: b.cod, obra_txt: obraAtual, contrato: ctr ? ctr[1] + "/" + ctr[2] : null, dias: apropNum(r[b.col + 2]), valor: n });
        }
      });
    });
  }
  return { competencia, sens, rubricas, rateio, abaCF, abaCalc, temCalc: !!linhaEq };
}

async function apropLerArquivo(file){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de leitura de planilhas não carregou. Recarregue a página.", "erro"); return; }
  const prev = $("aprop-preview");
  prev.innerHTML = `<p class="vazio">Lendo ${esc(file.name)}…</p>`;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const p = apropParse(wb);
    // casamento com o sistema
    const [ct, ob, eq] = await Promise.all([
      sb.from("contratos").select("id,numero"),
      sb.from("obras").select("id,codigo,contrato_id,created_at").order("created_at", { ascending: false }),
      sb.from("equipamentos").select("id,codigo"),
    ]);
    const obraPorContrato = new Map();
    (ct.data || []).forEach(c => { const o = (ob.data || []).find(x => x.contrato_id === c.id); if(o) obraPorContrato.set(c.numero, o.id); });
    (ob.data || []).forEach(o => { if(o.codigo && /^\d{4}-\d{4}$/.test(o.codigo)){ const n = o.codigo.replace("-", "/"); if(!obraPorContrato.has(n)) obraPorContrato.set(n, o.id); } });
    const equipPorCod = new Map(); (eq.data || []).forEach(e => { const c = String(e.codigo || "").split("-")[0].padStart(2, "0"); if(!equipPorCod.has(c)) equipPorCod.set(c, e.id); });
    const funcPorNome = new Map(); _funcs.forEach(f => funcPorNome.set(apropNorm(f.nome), f.id));
    const semFunc = [...new Set(p.sens.map(s => s.nome).concat(p.rateio.map(r => r.nome)).filter(n => !funcPorNome.has(apropNorm(n))))];
    const semContrato = [...new Set(p.rateio.filter(r => r.contrato && !obraPorContrato.has(r.contrato)).map(r => r.obra_txt))];
    _aprop.parse = { ...p, funcPorNome, obraPorContrato, equipPorCod, semFunc, semContrato, arquivo: file.name };
    const totSal = p.rubricas.filter(r => r.rubrica === "salario_contabil").reduce((s, r) => s + r.valor, 0);
    prev.innerHTML = `<div class="card" style="border-left:4px solid var(--marca-600);margin-bottom:12px;">
      <h4 style="margin:0 0 6px;">Conferência do import — ${esc(file.name)}</h4>
      <div class="grade">
        <div class="campo"><label>Competência</label><input type="month" id="aprop-comp-import" value="${p.competencia ? p.competencia.slice(0, 7) : ""}" /></div>
        <div class="campo"><label>Funcionários na planilha</label><input value="${p.sens.length} (${p.sens.filter(s => s.banco).length} com banco · ${p.sens.filter(s => s.salario_contabil != null).length} com salário)" disabled /></div>
        <div class="campo"><label>Rubricas × funcionário</label><input value="${p.rubricas.length} · salários ${apropMoeda(totSal)}" disabled /></div>
        <div class="campo"><label>Rateio por obra (CÁLCULO)</label><input value="${p.temCalc ? p.rateio.length + " linhas · " + p.rateio.filter(r => r.contrato).length + " com contrato" : "aba não encontrada"}" disabled /></div>
      </div>
      ${semFunc.length ? `<p class="txt-perigo" style="margin:6px 0;">⚠️ ${semFunc.length} nome(s) sem cadastro em Funcionários (ficam de fora): ${esc(semFunc.slice(0, 15).join(", "))}${semFunc.length > 15 ? "…" : ""}</p>` : ""}
      ${semContrato.length ? `<p style="margin:6px 0;color:var(--aviso-txt);">ℹ️ Contratos não encontrados (rateio fica só com o centro de custo em texto): ${esc(semContrato.slice(0, 8).join(" | "))}${semContrato.length > 8 ? "…" : ""}</p>` : ""}
      <p class="meta" style="margin:6px 0;">Ao confirmar: dados bancários/salários atualizam a ficha sensível de cada funcionário; a folha desta competência importada anteriormente é substituída.</p>
      <div class="form-acoes compacta"><button type="button" class="btn-sec" id="btn-aprop-cancelar">Cancelar</button><button type="button" class="btn" id="btn-aprop-confirmar">Confirmar import</button></div>
    </div>`;
    $("btn-aprop-cancelar").addEventListener("click", () => { _aprop.parse = null; prev.innerHTML = ""; });
    $("btn-aprop-confirmar").addEventListener("click", () => comBotaoTravado("btn-aprop-confirmar", apropConfirmar));
  } catch(e){
    prev.innerHTML = `<p class="txt-perigo">Não consegui ler a planilha: ${esc(e.message || e)}</p>`;
  }
}

async function apropConfirmar(){
  const p = _aprop.parse; if(!p) return;
  const compMes = $("aprop-comp-import")?.value;
  if(!compMes){ aviso("app-aviso", "Informe a competência.", "erro"); return; }
  const comp = compMes + "-01";
  const origem = "apropriacoes_" + compMes.replace("-", "_");
  const fid = (nome) => p.funcPorNome.get(apropNorm(nome));

  // 1) sensíveis
  const sens = p.sens.filter(s => fid(s.nome)).map(s => ({
    funcionario_id: fid(s.nome), banco: s.banco, agencia: s.agencia, operacao: s.operacao, conta: s.conta,
    salario_contabil: s.salario_contabil, salario_particular: s.salario_particular,
    observacoes: s.particular ? "Conta salário particular: " + s.particular : undefined, updated_at: new Date().toISOString(),
  }));
  sens.forEach(s => { if(s.observacoes === undefined) delete s.observacoes; });
  for(let i = 0; i < sens.length; i += 200){
    const { error } = await sb.from("funcionarios_sensiveis").upsert(sens.slice(i, i + 200), { onConflict: "funcionario_id" });
    if(error){ aviso("app-aviso", "Erro ao gravar dados sensíveis: " + error.message, "erro"); return; }
  }

  // 2) folha: substitui a competência importada anteriormente
  const del = await sb.from("folha_apropriacoes").delete().eq("competencia", comp).in("origem_import", [origem, origem + "_rateio"]);
  if(del.error){ aviso("app-aviso", "Erro ao limpar competência: " + del.error.message, "erro"); return; }
  const soma = new Map();
  p.rubricas.forEach(r => { const id = fid(r.nome); if(!id) return; const k = id + "|" + r.rubrica; soma.set(k, (soma.get(k) || 0) + r.valor); });
  const linhas = [...soma.entries()].map(([k, v]) => { const [funcionario_id, rubrica] = k.split("|"); return { competencia: comp, funcionario_id, obra_id: null, centro_custo: "GERAL", equipamento_id: null, rubrica, valor: Math.round(v * 100) / 100, origem_import: origem }; });
  const somaR = new Map();
  p.rateio.forEach(r => { const id = fid(r.nome); if(!id) return; const obra = r.contrato ? (p.obraPorContrato.get(r.contrato) || null) : null; const eqid = p.equipPorCod.get(r.equip_cod) || null;
    const k = [id, obra || "", r.obra_txt.slice(0, 80), eqid || ""].join("|"); const a = somaR.get(k) || { funcionario_id: id, obra_id: obra, centro_custo: r.obra_txt.slice(0, 80), equipamento_id: eqid, valor: 0 }; a.valor += r.valor; somaR.set(k, a); });
  somaR.forEach(a => linhas.push({ competencia: comp, funcionario_id: a.funcionario_id, obra_id: a.obra_id, centro_custo: a.centro_custo, equipamento_id: a.equipamento_id, rubrica: "salario_contabil", valor: Math.round(a.valor * 100) / 100, origem_import: origem + "_rateio" }));
  for(let i = 0; i < linhas.length; i += 500){
    const { error } = await sb.from("folha_apropriacoes").insert(linhas.slice(i, i + 500));
    if(error){ aviso("app-aviso", "Erro ao gravar folha: " + error.message, "erro"); return; }
  }
  aviso("app-aviso", `Apropriações de ${apropCompLabel(comp)} importadas: ${sens.length} fichas atualizadas, ${linhas.length} linhas de folha.`, "sucesso");
  _aprop = { comp, comps: [], custo: [], folha: [], parse: null };
  await renderFuncAprop();
}

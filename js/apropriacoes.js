/* ====================================================================
   APROPRIAÇÕES (fase 38 · 08/09/2026) — vista "Apropriações" do módulo Funcionários.
   O SISTEMA calcula a apropriação da folha (substitui a planilha FINANCEIRO – APROPRIAÇÕES):
   base mensal de cada funcionário = salário contábil + salário particular + benefícios fixos
   (ficha sensível) + encargos por % (apropriacao_parametros) + lançamentos variáveis do mês
   (folha_lancamentos). O rateio por obra usa os DIAS DE PRESENÇA NO RDO; sem RDO usa a
   alocação vigente; sem nada vai para ADM/PÁTIO. Tudo roda em fn_apropriar_competencia().
   Competência pode ser fechada (fn_fechar_competencia); só diretor reabre.
   A leitura da planilha antiga fica só como CARGA INICIAL da ficha (banco/salário/benefícios),
   lida no navegador com SheetJS — dados sensíveis não passam por servidor nosso.
   Acesso: diretor e rh (RLS + fn_funcionario_sensivel).
   ==================================================================== */
let _aprop = { comp: null, folha: [], custo: [], pres: [], lanc: [], params: [], fech: null, parse: null, res: null };

const APROP_RUBRICA_LBL = {
  salario_contabil: "Salário contábil", salario_particular: "Salário particular", unimed: "Unimed", unimed_copart: "Unimed copart.", metlife: "MetLife",
  seguro_vida: "Seguro de vida", vale_transporte: "Vale-transporte", vr: "VR", flash: "Flash", inss: "INSS patronal", irrf: "IRRF", fgts: "FGTS",
  contribuicao_sindical: "Contrib. sindical", consignado: "Consignado", decimo_terceiro_1: "13º 1ª parcela", decimo_terceiro_2: "13º 2ª parcela", ferias: "Férias / provisão", rescisao: "Rescisão", outro: "Outros (HE, prêmio…)",
};
const APROP_GRUPO = { salario_contabil: "sal", salario_particular: "sal", decimo_terceiro_1: "sal", decimo_terceiro_2: "sal", ferias: "sal", rescisao: "sal",
  unimed: "ben", unimed_copart: "ben", metlife: "ben", seguro_vida: "ben", vale_transporte: "ben", vr: "ben", flash: "ben", outro: "ben",
  inss: "enc", irrf: "enc", fgts: "enc", contribuicao_sindical: "enc", consignado: "enc" };
const APROP_SENS_BENEF = ["unimed", "metlife", "unimed_copart", "seguro_vida", "vale_transporte", "vr", "flash", "consignado"];

function apropMoeda(v){ return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function apropNorm(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }
function apropCompLabel(c){ if(!c) return "—"; const d = new Date(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1, 1); return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); }
function apropCompPadrao(){ const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }

/* ---------- leitura ---------- */
async function apropCarregar(comp){
  const mes = comp.slice(0, 7);
  const [f, c, p, l, pa, fe] = await Promise.all([
    sb.from("folha_apropriacoes").select("funcionario_id,obra_id,centro_custo,rubrica,valor,origem_import").eq("competencia", comp).limit(20000),
    sb.from("vw_custo_mao_obra_por_obra").select("obra_id,centro_custo,salarios,beneficios,encargos,total").eq("competencia", comp),
    sb.from("vw_presencas_rdo_mes").select("funcionario_id,obra_id,dias").eq("competencia", comp),
    sb.from("folha_lancamentos").select("id,funcionario_id,rubrica,valor,obra_id,observacoes").eq("competencia", comp).order("created_at"),
    sb.from("apropriacao_parametros").select("chave,valor,descricao").order("chave"),
    sb.from("folha_fechamentos").select("competencia,fechada_em,resumo").eq("competencia", comp).maybeSingle(),
  ]);
  _aprop.comp = comp; _aprop.folha = f.data || []; _aprop.custo = c.data || []; _aprop.pres = p.data || []; _aprop.lanc = l.data || []; _aprop.params = pa.data || []; _aprop.fech = fe.data || null;
  void mes;
}

async function renderFuncAprop(){
  const cont = $("func-conteudo");
  if(!cont) return;
  if(!funcVeSensivel()){ cont.innerHTML = `<p class="vazio">Apropriações da folha: acesso restrito à diretoria e ao RH.</p>`; return; }
  if(!_aprop.comp) _aprop.comp = apropCompPadrao();
  cont.innerHTML = `<p class="vazio">Carregando apropriação de ${apropCompLabel(_aprop.comp)}…</p>`;
  await apropCarregar(_aprop.comp);
  const nomeDe = (id) => (_funcs.find(f => f.id === id) || {}).nome || "?";
  const obraDe = (r) => r.obra_id ? (mapaObras?.[r.obra_id] || "Obra") : (r.centro_custo || "—");
  const fechada = !!_aprop.fech;
  const ehDiretor = usuarioAtual?.cargo === "diretor";

  const tot = _aprop.custo.reduce((s, r) => ({ sal: s.sal + Number(r.salarios || 0), ben: s.ben + Number(r.beneficios || 0), enc: s.enc + Number(r.encargos || 0), total: s.total + Number(r.total || 0) }), { sal: 0, ben: 0, enc: 0, total: 0 });
  const funcs = new Set(_aprop.folha.map(r => r.funcionario_id));
  const semObra = _aprop.folha.filter(r => !r.obra_id).reduce((s, r) => s + Number(r.valor || 0), 0);

  // por funcionário: valores + obras com dias
  const presPorFunc = new Map();
  _aprop.pres.forEach(p => { const a = presPorFunc.get(p.funcionario_id) || []; a.push(`${mapaObras?.[p.obra_id] || "obra"} (${p.dias}d)`); presPorFunc.set(p.funcionario_id, a); });
  const porFunc = new Map();
  _aprop.folha.forEach(r => {
    const a = porFunc.get(r.funcionario_id) || { id: r.funcionario_id, nome: nomeDe(r.funcionario_id), sal: 0, ben: 0, enc: 0, total: 0, fonte: new Set(), destinos: new Set() };
    const v = Number(r.valor || 0); const g = APROP_GRUPO[r.rubrica] || "ben"; a[g] += v; a.total += v;
    a.fonte.add((r.origem_import || "").replace("sistema:", "")); a.destinos.add(obraDe(r));
    porFunc.set(r.funcionario_id, a);
  });
  const listaFunc = [...porFunc.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const termo = ($("func-busca")?.value || "").trim().toLowerCase();
  const listaFiltrada = listaFunc.filter(a => !termo || a.nome.toLowerCase().includes(termo));
  const FONTE_LBL = { rdo: "RDO", alocacao: "alocação", sem_obra: "sem obra", lancamento: "lançamento" };

  // cobertura do cadastro: ativos sem ficha de folha (não entraram na apropriação)
  const ativos = _funcs.filter(f => f.ativo !== false && f.status !== "demitido");
  const semFicha = _aprop.folha.length ? ativos.filter(f => !funcs.has(f.id)) : [];

  const opcoesMes = []; { const d = new Date(); d.setDate(1); for(let i = 0; i < 18; i++){ const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; opcoesMes.push(`<option value="${v}" ${v === _aprop.comp ? "selected" : ""}>${apropCompLabel(v)}</option>`); d.setMonth(d.getMonth() - 1); } }
  const res = _aprop.res;

  cont.innerHTML = `
    <div class="meta" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;">
      <label>Competência <select id="aprop-comp">${opcoesMes.join("")}</select></label>
      ${fechada ? `<span class="conf-badge" style="background:var(--sucesso);">Fechada em ${dataBR((_aprop.fech.fechada_em || "").slice(0, 10))}</span>` : `<span class="conf-badge" style="background:var(--aviso);color:var(--aviso-txt);">Aberta</span>`}
      ${fechada ? (ehDiretor ? `<button type="button" class="btn-sec btn-sm" id="btn-aprop-reabrir">🔓 Reabrir</button>` : "") :
        `<button type="button" class="btn btn-sm" id="btn-aprop-calcular">⚙️ Calcular apropriação</button>
         <button type="button" class="btn-sec btn-sm" id="btn-aprop-fechar" ${_aprop.folha.length ? "" : "disabled"}>🔒 Fechar competência</button>`}
      <button type="button" class="btn-sec btn-sm" id="btn-aprop-csv" ${listaFunc.length ? "" : "disabled"}>⬇️ CSV</button>
      <span style="margin-left:auto;">Rateio pelos dias de presença no RDO → alocação vigente → ADM/PÁTIO</span>
    </div>
    ${res ? `<p class="meta" style="margin:0 0 10px;">Último cálculo: ${res.funcionarios} funcionários · ${res.com_rdo} com presença em RDO · ${res.por_alocacao} pela alocação · ${res.sem_obra} sem obra (ADM/PÁTIO) · ${res.linhas} linhas · total ${apropMoeda(res.total)}${res.sem_ficha ? ` · <span class="txt-perigo">${res.sem_ficha} ativo(s) sem salário na ficha</span>` : ""}${res.presencas_sem_cadastro ? ` · <span class="txt-perigo">${res.presencas_sem_cadastro} nome(s) no RDO sem cadastro</span>` : ""}</p>` : ""}
    <div id="aprop-preview"></div>
    <div class="indicadores" style="margin-bottom:12px;">
      <div class="ind"><div class="num">${funcs.size}</div><div class="rot">Funcionários apropriados</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.sal)}</div><div class="rot">Salários</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.ben)}</div><div class="rot">Benefícios</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.enc)}</div><div class="rot">Encargos</div></div>
      <div class="ind"><div class="num" style="color:var(--marca-600);">${apropMoeda(tot.total)}</div><div class="rot">Custo total da folha</div></div>
      <div class="ind"><div class="num" style="color:${semObra ? "var(--aviso-txt)" : "inherit"};">${apropMoeda(semObra)}</div><div class="rot">Sem obra (ADM/PÁTIO)</div></div>
    </div>
    ${semFicha.length ? `<p class="txt-perigo" style="margin:0 0 10px;">⚠️ ${semFicha.length} funcionário(s) ativo(s) ficaram fora por não terem salário na ficha: ${semFicha.slice(0, 12).map(f => `<a href="#" class="aprop-abrir-func" data-id="${f.id}">${esc(f.nome)}</a>`).join(", ")}${semFicha.length > 12 ? "…" : ""}</p>` : ""}

    <h4 style="margin:0 0 6px;">Custo de mão de obra por obra / centro de custo</h4>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Obra / centro de custo</th><th class="num">Salários</th><th class="num">Benefícios</th><th class="num">Encargos</th><th class="num">Total</th><th class="num">%</th></tr></thead>
      <tbody>${_aprop.custo.slice().sort((a, b) => Number(b.total) - Number(a.total)).map(r => `<tr><td>${esc(obraDe(r))}</td><td class="num">${apropMoeda(r.salarios)}</td><td class="num">${apropMoeda(r.beneficios)}</td><td class="num">${apropMoeda(r.encargos)}</td><td class="num"><strong>${apropMoeda(r.total)}</strong></td><td class="num">${tot.total ? (100 * Number(r.total) / tot.total).toFixed(1) : "0"}%</td></tr>`).join("") || `<tr><td colspan="6" class="vazio">Nenhuma apropriação nesta competência. Clique em <strong>Calcular apropriação</strong>.</td></tr>`}</tbody>
    </table></div>

    <h4 style="margin:0 0 6px;">Por funcionário <span class="meta">(${listaFiltrada.length})</span></h4>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Funcionário</th><th class="num">Salários</th><th class="num">Benefícios</th><th class="num">Encargos</th><th class="num">Total</th><th>Rateio</th><th>Presença no RDO</th></tr></thead>
      <tbody>${listaFiltrada.map(a => `<tr><td>${esc(a.nome)}</td><td class="num">${apropMoeda(a.sal)}</td><td class="num">${apropMoeda(a.ben)}</td><td class="num">${apropMoeda(a.enc)}</td><td class="num"><strong>${apropMoeda(a.total)}</strong></td>
          <td class="meta">${esc([...a.destinos].join(" · "))} <em>(${[...a.fonte].map(f => FONTE_LBL[f] || f).join(", ")})</em></td><td class="meta">${esc((presPorFunc.get(a.id) || []).join(" · ") || "—")}</td></tr>`).join("") || `<tr><td colspan="7" class="vazio">—</td></tr>`}</tbody>
    </table></div>

    <details style="margin-bottom:12px;"><summary style="cursor:pointer;"><strong>Lançamentos do mês</strong> <span class="meta">(${_aprop.lanc.length}) — HE, prêmio, 13º, férias, rescisão, descontos…</span></summary>
      <div class="grade" style="margin-top:8px;">
        <div class="campo largo"><label>Funcionário</label><select id="lanc-func"><option value="">Selecione…</option>${_funcs.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join("")}</select></div>
        <div class="campo"><label>Rubrica</label><select id="lanc-rubrica">${Object.entries(APROP_RUBRICA_LBL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <div class="campo"><label>Valor (R$) — negativo = desconto</label><input type="number" step="0.01" id="lanc-valor" /></div>
        <div class="campo largo"><label>Obra (opcional — vazio segue o rateio do funcionário)</label><select id="lanc-obra"><option value="">— rateio normal —</option>${Object.entries(mapaObras || {}).sort((a, b) => String(b[1]).localeCompare(String(a[1]), "pt-BR")).map(([id, rot]) => `<option value="${id}">${esc(rot)}</option>`).join("")}</select></div>
        <div class="campo largo"><label>Observação</label><input id="lanc-obs" /></div>
      </div>
      <div class="form-acoes compacta"><button type="button" class="btn btn-sm" id="btn-lanc-add" ${fechada ? "disabled" : ""}>+ Lançar</button></div>
      <div class="tabela-rola"><table><thead><tr><th>Funcionário</th><th>Rubrica</th><th class="num">Valor</th><th>Obra</th><th>Obs.</th><th></th></tr></thead>
        <tbody>${_aprop.lanc.map(l => `<tr><td>${esc(nomeDe(l.funcionario_id))}</td><td>${APROP_RUBRICA_LBL[l.rubrica] || l.rubrica}</td><td class="num">${apropMoeda(l.valor)}</td><td>${esc(l.obra_id ? (mapaObras?.[l.obra_id] || "obra") : "rateio")}</td><td class="meta">${esc(l.observacoes || "")}</td><td>${fechada ? "" : `<button type="button" class="btn-sec btn-sm aprop-lanc-del" data-id="${l.id}">🗑️</button>`}</td></tr>`).join("") || `<tr><td colspan="6" class="vazio">Nenhum lançamento neste mês.</td></tr>`}</tbody></table></div>
    </details>

    <details style="margin-bottom:12px;"><summary style="cursor:pointer;"><strong>Parâmetros de encargos</strong> <span class="meta">(% sobre o salário contábil)</span></summary>
      <div class="grade" style="margin-top:8px;">${_aprop.params.map(p => `<div class="campo"><label>${esc(p.descricao || p.chave)}</label><input type="number" step="0.01" class="aprop-param" data-chave="${p.chave}" value="${p.valor}" /></div>`).join("")}</div>
      <div class="form-acoes compacta"><button type="button" class="btn-sec btn-sm" id="btn-aprop-params">💾 Salvar parâmetros</button></div>
    </details>

    <details><summary style="cursor:pointer;"><strong>Carga inicial da ficha</strong> <span class="meta">— só uma vez: lê a planilha antiga (.xlsx) e preenche banco, salário e benefícios de cada funcionário. Depois disso a planilha não é mais necessária.</span></summary>
      <p class="meta" style="margin:8px 0;"><label class="btn-sec btn-sm" style="cursor:pointer;">⬆️ Escolher planilha FINANCEIRO – APROPRIAÇÕES (.xlsx)<input type="file" id="aprop-arquivo" accept=".xlsx,.xlsm" style="display:none;" /></label> A leitura é feita no seu navegador; os dados vão direto para a ficha sensível.</p>
    </details>`;

  $("aprop-comp")?.addEventListener("change", async e => { _aprop.comp = e.target.value; _aprop.res = null; await renderFuncAprop(); });
  $("btn-aprop-calcular")?.addEventListener("click", () => comBotaoTravado("btn-aprop-calcular", apropCalcular));
  $("btn-aprop-fechar")?.addEventListener("click", () => comBotaoTravado("btn-aprop-fechar", () => apropFechar(false)));
  $("btn-aprop-reabrir")?.addEventListener("click", () => comBotaoTravado("btn-aprop-reabrir", () => apropFechar(true)));
  $("btn-lanc-add")?.addEventListener("click", () => comBotaoTravado("btn-lanc-add", apropLancar));
  $("btn-aprop-params")?.addEventListener("click", () => comBotaoTravado("btn-aprop-params", apropSalvarParams));
  $("aprop-arquivo")?.addEventListener("change", e => { const f = e.target.files[0]; if(f) apropLerArquivo(f); e.target.value = ""; });
  cont.querySelectorAll(".aprop-lanc-del").forEach(b => b.addEventListener("click", async () => {
    if(!confirm("Excluir este lançamento?")) return;
    const { error } = await sb.from("folha_lancamentos").delete().eq("id", b.dataset.id);
    if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
    await renderFuncAprop();
  }));
  cont.querySelectorAll(".aprop-abrir-func").forEach(a => a.addEventListener("click", e => { e.preventDefault(); abrirFuncionario(a.dataset.id); }));
  $("btn-aprop-csv")?.addEventListener("click", () => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Funcionario;Salarios;Beneficios;Encargos;Total;Rateio"].concat(listaFunc.map(a => [a.nome, a.sal.toFixed(2), a.ben.toFixed(2), a.enc.toFixed(2), a.total.toFixed(2), [...a.destinos].join(" | ")].map(cel).join(";"))).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = `apropriacoes-${_aprop.comp.slice(0, 7)}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  });
}

/* ---------- ações ---------- */
async function apropCalcular(){
  const { data, error } = await sb.rpc("fn_apropriar_competencia", { p_comp: _aprop.comp });
  if(error){ aviso("app-aviso", "Erro ao apropriar: " + error.message, "erro"); return; }
  _aprop.res = data;
  aviso("app-aviso", `Apropriação de ${apropCompLabel(_aprop.comp)} calculada: ${data.funcionarios} funcionários, ${apropMoeda(data.total)}.`, "sucesso");
  await renderFuncAprop();
}
async function apropFechar(reabrir){
  if(!reabrir && !confirm(`Fechar a competência ${apropCompLabel(_aprop.comp)}? Depois disso só a diretoria reabre.`)) return;
  const { error } = await sb.rpc("fn_fechar_competencia", { p_comp: _aprop.comp, p_reabrir: !!reabrir });
  if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
  aviso("app-aviso", reabrir ? "Competência reaberta." : "Competência fechada.", "sucesso");
  await renderFuncAprop();
}
async function apropLancar(){
  const reg = { competencia: _aprop.comp, funcionario_id: $("lanc-func").value || null, rubrica: $("lanc-rubrica").value, valor: Number($("lanc-valor").value), obra_id: $("lanc-obra").value || null, observacoes: $("lanc-obs").value.trim() || null };
  if(!reg.funcionario_id || !reg.valor){ aviso("app-aviso", "Informe funcionário e valor.", "erro"); return; }
  const { error } = await sb.from("folha_lancamentos").insert(reg);
  if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
  aviso("app-aviso", "Lançamento gravado. Recalcule a apropriação para refletir.", "sucesso");
  await renderFuncAprop();
}
async function apropSalvarParams(){
  const regs = [...document.querySelectorAll(".aprop-param")].map(i => ({ chave: i.dataset.chave, valor: Number(i.value) || 0, updated_at: new Date().toISOString() }));
  const { error } = await sb.from("apropriacao_parametros").upsert(regs, { onConflict: "chave" });
  if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
  aviso("app-aviso", "Parâmetros salvos. Recalcule a apropriação para aplicar.", "sucesso");
}

/* ---------- carga inicial: leitura da planilha antiga (só ficha sensível) ---------- */
function apropNum(v){
  if(v == null || v === "" || v === " ") return null;
  if(typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/R\$\s?/, "");
  const n = Number(s); if(isFinite(n)) return n;
  const n2 = Number(s.replace(/\./g, "").replace(",", ".")); return isFinite(n2) ? n2 : null;
}

function apropParseFicha(wb){
  const nomeAba = (pref) => wb.SheetNames.find(n => apropNorm(n) === apropNorm(pref)) || wb.SheetNames.find(n => apropNorm(n).startsWith(apropNorm(pref)) && !/JUNHO|MAIO|ABRIL|MARCO|FEV|JAN|JUL|AGO|SET|OUT|NOV|DEZ/i.test(n)) || wb.SheetNames.find(n => apropNorm(n).startsWith(apropNorm(pref)));
  const abaCF = nomeAba("CONTROLE FINANCEIRO");
  if(!abaCF) throw new Error("Aba CONTROLE FINANCEIRO não encontrada.");
  const cf = XLSX.utils.sheet_to_json(wb.Sheets[abaCF], { header: 1, raw: true, defval: "" }).map(r => r.map(c => typeof c === "string" ? c.trim() : c));
  const cab = cf.find(r => apropNorm(r[0]) === "FUNCIONARIO");
  if(!cab) throw new Error("Cabeçalho 'Funcionário' não encontrado.");
  const H = cab.map(x => apropNorm(x));
  const col = (re, depois = -1) => H.findIndex((h, i) => i > depois && re.test(h));
  const iBanco = col(/^BANCO/), iAg = col(/^AGENCIA/), iOp = col(/^OPERACAO/), iConta = col(/^CONTA/), iSal = col(/^SALARIO CONTABIL/);
  const iUniC = col(/^UNIMED.*COPART/), iUni = H.findIndex(h => /^UNIMED/.test(h) && !/COPART/.test(h)), iMet = col(/^METLIFE/), iSeg = col(/^SEGURO/), iVT = col(/^(VT|VALE.?TRANSP)/), iVR = col(/^(VR|VALE.?REF)/);
  const iSalP = col(/^SALARIO PARTICULAR/), iFlash = col(/^FLASH/), iCons = col(/^CONSIGNADO/);
  const iBancoP = col(/^BANCO/, iSalP), iAgP = col(/^AGENCIA/, iSalP), iOpP = col(/^OPERACAO/, iSalP), iContaP = col(/^CONTA/, iSalP);
  const txt = (v) => (v == null || v === "") ? null : String(v).replace(/\.0$/, "").trim();
  const fichas = [];
  cf.slice(cf.indexOf(cab) + 1).forEach(r => {
    const nome = String(r[0] || "").trim(); if(!nome || /^TOTAL/i.test(nome)) return;
    const g = (i) => (i >= 0 ? r[i] : null);
    fichas.push({ nome, banco: txt(g(iBanco)), agencia: txt(g(iAg)), operacao: txt(g(iOp)), conta: txt(g(iConta)),
      salario_contabil: apropNum(g(iSal)), salario_particular: apropNum(g(iSalP)),
      unimed: apropNum(g(iUni)), metlife: apropNum(g(iMet)), unimed_copart: apropNum(g(iUniC)), seguro_vida: apropNum(g(iSeg)), vale_transporte: apropNum(g(iVT)), vr: apropNum(g(iVR)), flash: apropNum(g(iFlash)), consignado: apropNum(g(iCons)),
      particular: [g(iBancoP), g(iAgP), g(iOpP), g(iContaP)].map(txt).filter(Boolean).join(" · ") || null });
  });
  return fichas;
}

async function apropLerArquivo(file){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de leitura de planilhas não carregou. Recarregue a página.", "erro"); return; }
  const prev = $("aprop-preview");
  prev.innerHTML = `<p class="vazio">Lendo ${esc(file.name)}…</p>`;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const fichas = apropParseFicha(wb);
    const funcPorNome = new Map(); _funcs.forEach(f => funcPorNome.set(apropNorm(f.nome), f.id));
    const semFunc = fichas.filter(s => !funcPorNome.has(apropNorm(s.nome))).map(s => s.nome);
    _aprop.parse = { fichas, funcPorNome, semFunc };
    prev.innerHTML = `<div class="card" style="border-left:4px solid var(--marca-600);margin-bottom:12px;">
      <h4 style="margin:0 0 6px;">Carga inicial da ficha — ${esc(file.name)}</h4>
      <p class="meta" style="margin:4px 0;">${fichas.length} nomes na planilha · ${fichas.filter(s => funcPorNome.has(apropNorm(s.nome))).length} casam com o cadastro · ${fichas.filter(s => s.salario_contabil != null).length} com salário · ${fichas.filter(s => s.banco).length} com banco.</p>
      ${semFunc.length ? `<p class="txt-perigo" style="margin:4px 0;">⚠️ Sem cadastro em Funcionários (ficam de fora): ${esc(semFunc.slice(0, 15).join(", "))}${semFunc.length > 15 ? "…" : ""}</p>` : ""}
      <p class="meta" style="margin:4px 0;">Ao confirmar, banco/agência/conta, salário contábil, salário particular e benefícios fixos são gravados na ficha sensível de cada funcionário (sobrescreve o que existir).</p>
      <div class="form-acoes compacta"><button type="button" class="btn-sec" id="btn-aprop-cancelar">Cancelar</button><button type="button" class="btn" id="btn-aprop-confirmar">Gravar nas fichas</button></div></div>`;
    $("btn-aprop-cancelar").addEventListener("click", () => { _aprop.parse = null; prev.innerHTML = ""; });
    $("btn-aprop-confirmar").addEventListener("click", () => comBotaoTravado("btn-aprop-confirmar", apropConfirmarFicha));
  } catch(e){ prev.innerHTML = `<p class="txt-perigo">Não consegui ler a planilha: ${esc(e.message || e)}</p>`; }
}

async function apropConfirmarFicha(){
  const p = _aprop.parse; if(!p) return;
  const regs = p.fichas.filter(s => p.funcPorNome.has(apropNorm(s.nome))).map(s => {
    const r = { funcionario_id: p.funcPorNome.get(apropNorm(s.nome)), banco: s.banco, agencia: s.agencia, operacao: s.operacao, conta: s.conta,
      salario_contabil: s.salario_contabil, salario_particular: s.salario_particular, updated_at: new Date().toISOString() };
    APROP_SENS_BENEF.forEach(k => r[k] = s[k]);
    if(s.particular) r.observacoes = "Conta salário particular: " + s.particular;
    return r;
  });
  for(let i = 0; i < regs.length; i += 200){
    const { error } = await sb.from("funcionarios_sensiveis").upsert(regs.slice(i, i + 200), { onConflict: "funcionario_id" });
    if(error){ aviso("app-aviso", "Erro ao gravar fichas: " + error.message, "erro"); return; }
  }
  aviso("app-aviso", `${regs.length} fichas atualizadas. Agora clique em "Calcular apropriação".`, "sucesso");
  _aprop.parse = null;
  await renderFuncAprop();
}

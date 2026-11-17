/* ====================================================================
   APROPRIAÇÕES (fase 38 · 08/09/2026) — vista "Apropriações" do módulo Funcionários.
   O SISTEMA calcula a apropriação da folha (substitui a planilha FINANCEIRO – APROPRIAÇÕES):
   base mensal de cada funcionário = salário contábil + salário particular + gratificação e
   adicionais + benefícios fixos (ficha sensível) + encargos por % sobre salário contábil,
   gratificação e adicionais (apropriacao_parametros) + lançamentos variáveis do mês
   (folha_lancamentos). O rateio por obra usa os DIAS DE PRESENÇA NO RDO; sem RDO usa a
   alocação vigente; sem nada vai para ADM/PÁTIO. Tudo roda em fn_apropriar_competencia().
   Quadro do mês (hotfix quadro-competencia): presença no RDO do mês, ou admissão e demissão que caem no mês (sem data de demissão,
   vale estar ativo hoje). Os valores são os da ficha de hoje e do mês inteiro: não há histórico de salário.
   Competência pode ser fechada (fn_fechar_competencia); só diretor reabre.
   A leitura da planilha antiga fica só como CARGA INICIAL da ficha (banco/salário/benefícios),
   lida no navegador com SheetJS — dados sensíveis não passam por servidor nosso.
   Acesso: diretor e rh (RLS + fn_funcionario_sensivel).
   Lote S51 (#141): o admin vê só os totais por obra/centro e competência (renderFuncApropTotais, lidos por
   fn_apropriacao_totais_obra com MFA) e roda a apuração; nada por funcionário.
   ==================================================================== */
let _aprop = { comp: null, folha: [], custo: [], pres: [], lanc: [], params: [], fech: null, parse: null, res: null };

const APROP_RUBRICA_LBL = {
  salario_contabil: "Salário contábil", salario_particular: "Salário particular",
  gratificacao: "Gratificação", insalubridade: "Insalubridade", periculosidade: "Periculosidade", ajuda_mensal: "Ajuda mensal (238)", unimed: "Unimed (desconto do funcionário)", unimed_empresa: "Unimed (paga pela empresa)", unimed_copart: "Unimed copart.", metlife: "MetLife",
  seguro_vida: "Seguro de vida", vale_transporte: "Vale-transporte", vr: "VR", flash: "Flash", inss: "INSS patronal", gps: "GPS", irrf: "IRRF", fgts: "FGTS",
  contribuicao_sindical: "Contrib. sindical", consignado: "Consignado", decimo_terceiro_1: "13º 1ª parcela", decimo_terceiro_2: "13º 2ª parcela", ferias: "Férias / provisão", rescisao: "Rescisão", outro: "Outros (HE, prêmio…)",
};
// Grupos iguais aos de vw_custo_mao_obra_por_obra (carga do RH, 16/10: adicionais e gratificação são salário; ajuda mensal é benefício)
const APROP_GRUPO = { salario_contabil: "sal", salario_particular: "sal", gratificacao: "sal", insalubridade: "sal", periculosidade: "sal", ajuda_mensal: "ben", decimo_terceiro_1: "sal", decimo_terceiro_2: "sal", ferias: "sal", rescisao: "sal",
  unimed: "ben", unimed_empresa: "ben", unimed_copart: "ben", metlife: "ben", seguro_vida: "ben", vale_transporte: "ben", vr: "ben", flash: "ben", outro: "ben",
  inss: "enc", gps: "enc", irrf: "enc", fgts: "enc", contribuicao_sindical: "enc", consignado: "enc" };
const APROP_SENS_BENEF = ["unimed", "metlife", "unimed_copart", "seguro_vida", "vale_transporte", "vr", "flash", "consignado"];
// Rubricas geradas por "Lançar na folha" (fase 93c; lote S54 #178: débito de folga, valor negativo). Só rótulo de leitura: não
// entram no select do lançamento manual (o botão do RH as regrava a cada clique).
const APROP_RUBRICA_AUTO = { he_100: "HE 100 % (RDO)", adicional_noturno: "Adicional noturno (RDO)", horas_viagem: "Horas de viagem", debito_folga: "Débito de folga (desconto)" };

function apropMoeda(v){ return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function apropNorm(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim(); }
function apropCompLabel(c){ if(!c) return "—"; const d = new Date(Number(c.slice(0, 4)), Number(c.slice(5, 7)) - 1, 1); return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); }
function apropCompPadrao(){ const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
/* <option> dos últimos 18 meses (competência), com a atual marcada */
function apropOpcoesMes(){
  const opcoes = []; const d = new Date(); d.setDate(1);
  for(let i = 0; i < 18; i++){ const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; opcoes.push(`<option value="${esc(v)}" ${v === _aprop.comp ? "selected" : ""}>${apropCompLabel(v)}</option>`); d.setMonth(d.getMonth() - 1); }
  return /* html */ opcoes.join("");
}
/* linha "Último cálculo" (só contagens e o total da competência) */
function apropResumoCalculo(res){
  if(!res) return "";
  // lote S54 (#178): ausencias_rdo = linhas do RDO com Falta, Folga, DSR ou Atestado, que não contam como presença
  return `<p class="meta" style="margin:0 0 10px;">Último cálculo: ${esc(res.funcionarios)} funcionários · ${esc(res.com_rdo)} com presença em RDO · ${esc(res.por_alocacao)} pela alocação · ${esc(res.sem_obra)} sem obra (ADM/PÁTIO) · ${esc(res.linhas)} linhas · total ${apropMoeda(res.total)}${res.sem_ficha ? ` · <span class="txt-perigo">${esc(res.sem_ficha)} no quadro do mês sem salário na ficha</span>` : ""}${res.presencas_sem_cadastro ? ` · <span class="txt-perigo">${esc(res.presencas_sem_cadastro)} nome(s) no RDO sem cadastro</span>` : ""}${res.ausencias_rdo ? ` · ${Number(res.ausencias_rdo)} ausência(s) no RDO (Falta, Folga, DSR, Atestado) não contadas` : ""}${res.fora_admissao ? ` · ${Number(res.fora_admissao)} fora por admissão depois do mês` : ""}${res.presenca_inativos ? ` · ${Number(res.presenca_inativos)} inativo(s) incluído(s) pela presença no RDO` : ""}${res.sem_admissao ? ` · <span class="txt-perigo">${Number(res.sem_admissao)} incluído(s) sem data de admissão no cadastro</span>` : ""}${res.inativos_sem_data ? ` · <span class="txt-perigo">${Number(res.inativos_sem_data)} inativo(s) fora por falta da data de demissão no cadastro</span>` : ""}</p>`;
}
/* tabela "Custo de mão de obra por obra / centro de custo" (linhas de vw_custo_mao_obra_por_obra) */
function apropTabelaObras(linhas, tot, obraDe){
  return `<h4 style="margin:0 0 6px;">Custo de mão de obra por obra / centro de custo</h4>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Obra / centro de custo</th><th class="num">Salários</th><th class="num">Benefícios</th><th class="num">Encargos</th><th class="num">Total</th><th class="num">%</th></tr></thead>
      <tbody>${linhas.slice().sort((a, b) => Number(b.total) - Number(a.total)).map(r => `<tr><td>${esc(obraDe(r))}</td><td class="num">${apropMoeda(r.salarios)}</td><td class="num">${apropMoeda(r.beneficios)}</td><td class="num">${apropMoeda(r.encargos)}</td><td class="num"><strong>${apropMoeda(r.total)}</strong></td><td class="num">${tot.total ? (100 * Number(r.total) / tot.total).toFixed(1) : "0"}%</td></tr>`).join("") || `<tr><td colspan="6" class="vazio">Nenhuma apropriação nesta competência. Clique em <strong>Calcular apropriação</strong>.</td></tr>`}</tbody>
    </table></div>`;
}
function apropSomaObras(linhas){
  return linhas.reduce((s, r) => ({ sal: s.sal + Number(r.salarios || 0), ben: s.ben + Number(r.beneficios || 0), enc: s.enc + Number(r.encargos || 0), total: s.total + Number(r.total || 0) }), { sal: 0, ben: 0, enc: 0, total: 0 });
}

/* ---------- leitura ---------- */
async function apropCarregar(comp){
  const mes = comp.slice(0, 7);
  const [f, c, p, l, pa, fe] = await Promise.all([
    lerTudo(() => sb.from("folha_apropriacoes").select("funcionario_id,obra_id,centro_custo,rubrica,valor,origem_import").eq("competencia", comp)),
    sb.from("vw_custo_mao_obra_por_obra").select("*").eq("competencia", comp),   // fase 187b: + uma coluna por rubrica (r_*)
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
  if(!funcVeSensivel()){
    if(typeof funcVeApropriacao === "function" && funcVeApropriacao()) return renderFuncApropTotais();   // lote S51: admin
    cont.innerHTML = `<p class="vazio">Apropriações da folha: acesso restrito à diretoria, ao RH e à administração.</p>`; return;
  }
  if(!_aprop.comp) _aprop.comp = apropCompPadrao();
  cont.innerHTML = `<p class="vazio">Carregando apropriação de ${apropCompLabel(_aprop.comp)}…</p>`;
  await apropCarregar(_aprop.comp);
  const nomeDe = (id) => (_funcs.find(f => f.id === id) || {}).nome || "?";
  const obraDe = (r) => r.obra_id ? (mapaObras?.[r.obra_id] || "Obra") : (r.centro_custo || "—");
  const fechada = !!_aprop.fech;
  const ehDiretor = usuarioAtual?.cargo === "diretor";

  const tot = apropSomaObras(_aprop.custo);
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

  cont.innerHTML = `
    <div class="meta" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;">
      <label>Competência <select id="aprop-comp">${apropOpcoesMes()}</select></label>
      ${fechada ? `<span class="conf-badge" style="background:var(--sucesso);">Fechada em ${dataBR((_aprop.fech.fechada_em || "").slice(0, 10))}</span>` : `<span class="conf-badge" style="background:var(--aviso);color:var(--aviso-txt);">Aberta</span>`}
      ${fechada ? (ehDiretor ? `<button type="button" class="btn-sec btn-sm" id="btn-aprop-reabrir">Reabrir</button>` : "") :
        `<button type="button" class="btn btn-sm" id="btn-aprop-calcular">Calcular apropriação</button>
         <button type="button" class="btn-sec btn-sm" id="btn-aprop-fechar" ${_aprop.folha.length ? "" : "disabled"}>Fechar competência</button>`}
      <button type="button" class="btn-sec btn-sm" id="btn-aprop-csv" ${listaFunc.length ? "" : "disabled"}>CSV</button>
      <span style="margin-left:auto;">Rateio pelos dias de presença no RDO → alocação vigente → ADM/PÁTIO</span>
    </div>
    ${apropResumoCalculo(_aprop.res)}
    <div id="aprop-preview"></div>
    <div class="indicadores" style="margin-bottom:12px;">
      <div class="ind"><div class="num">${funcs.size}</div><div class="rot">Funcionários apropriados</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.sal)}</div><div class="rot">Salários</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.ben)}</div><div class="rot">Benefícios</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.enc)}</div><div class="rot">Encargos</div></div>
      <div class="ind"><div class="num" style="color:var(--acao-txt);">${apropMoeda(tot.total)}</div><div class="rot">Custo total da folha</div></div>
      <div class="ind"><div class="num" style="color:${semObra ? "var(--aviso-txt)" : "inherit"};">${apropMoeda(semObra)}</div><div class="rot">Sem obra (ADM/PÁTIO)</div></div>
    </div>
    ${semFicha.length ? `<p class="txt-perigo" style="margin:0 0 10px;">⚠️ ${semFicha.length} funcionário(s) ativo(s) ficaram fora por não terem salário na ficha: ${semFicha.slice(0, 12).map(f => `<a href="#" class="aprop-abrir-func" data-id="${esc(f.id)}">${esc(f.nome)}</a>`).join(", ")}${semFicha.length > 12 ? "…" : ""}</p>` : ""}

    ${apropTabelaObras(_aprop.custo, tot, obraDe)}
    ${apropTabelaRubricas(_aprop.custo, obraDe)}

    <h4 style="margin:0 0 6px;">Por funcionário <span class="meta">(${listaFiltrada.length})</span></h4>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Funcionário</th><th class="num">Salários</th><th class="num">Benefícios</th><th class="num">Encargos</th><th class="num">Total</th><th>Rateio</th><th>Presença no RDO</th></tr></thead>
      <tbody>${listaFiltrada.map(a => `<tr><td>${esc(a.nome)}</td><td class="num">${apropMoeda(a.sal)}</td><td class="num">${apropMoeda(a.ben)}</td><td class="num">${apropMoeda(a.enc)}</td><td class="num"><strong>${apropMoeda(a.total)}</strong></td>
          <td class="meta">${esc([...a.destinos].join(" · "))} <em>(${[...a.fonte].map(f => esc(FONTE_LBL[f] || f)).join(", ")})</em></td><td class="meta">${esc((presPorFunc.get(a.id) || []).join(" · ") || "—")}</td></tr>`).join("") || `<tr><td colspan="7" class="vazio">—</td></tr>`}</tbody>
    </table></div>

    <details style="margin-bottom:12px;"><summary style="cursor:pointer;"><strong>Lançamentos do mês</strong> <span class="meta">(${_aprop.lanc.length}) — HE, prêmio, 13º, férias, rescisão, descontos…</span></summary>
      <div class="grade" style="margin-top:8px;">
        <div class="campo largo"><label>Funcionário</label><select id="lanc-func"><option value="">Selecione…</option>${_funcs.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("")}</select></div>
        <div class="campo"><label>Rubrica</label><select id="lanc-rubrica">${Object.entries(APROP_RUBRICA_LBL).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("")}</select></div>
        <div class="campo"><label>Valor (R$) — negativo = desconto</label><input type="number" step="0.01" id="lanc-valor" /></div>
        <div class="campo largo"><label>Obra (opcional — vazio segue o rateio do funcionário)</label><select id="lanc-obra"><option value="">— rateio normal —</option>${Object.entries(mapaObras || {}).sort((a, b) => String(b[1]).localeCompare(String(a[1]), "pt-BR")).map(([id, rot]) => `<option value="${esc(id)}">${esc(rot)}</option>`).join("")}</select></div>
        <div class="campo largo"><label>Observação</label><input id="lanc-obs" /></div>
      </div>
      <div class="form-acoes compacta"><button type="button" class="btn btn-sm" id="btn-lanc-add" ${fechada ? "disabled" : ""}>+ Lançar</button></div>
      <div class="tabela-rola"><table><thead><tr><th>Funcionário</th><th>Rubrica</th><th class="num">Valor</th><th>Obra</th><th>Obs.</th><th></th></tr></thead>
        <tbody>${_aprop.lanc.map(l => `<tr><td>${esc(nomeDe(l.funcionario_id))}</td><td>${esc(APROP_RUBRICA_LBL[l.rubrica] || APROP_RUBRICA_AUTO[l.rubrica] || l.rubrica)}</td><td class="num">${Number(l.valor) < 0 ? `<span class="txt-perigo" title="Desconto (valor negativo)">${apropMoeda(l.valor)}</span>` : apropMoeda(l.valor)}</td><td>${esc(l.obra_id ? (mapaObras?.[l.obra_id] || "obra") : "rateio")}</td><td class="meta">${esc(l.observacoes || "")}</td><td>${fechada ? "" : `<button type="button" class="btn-sec btn-sm aprop-lanc-del" data-id="${esc(l.id)}">Excluir</button>`}</td></tr>`).join("") || `<tr><td colspan="6" class="vazio">Nenhum lançamento neste mês.</td></tr>`}</tbody></table></div>
    </details>

    <details style="margin-bottom:12px;"><summary style="cursor:pointer;"><strong>Parâmetros de encargos</strong> <span class="meta">(% sobre o salário contábil)</span></summary>
      <div class="grade" style="margin-top:8px;">${_aprop.params.map(p => `<div class="campo"><label>${esc(p.descricao || p.chave)}</label><input type="number" step="0.01" class="aprop-param" data-chave="${esc(p.chave)}" value="${esc(p.valor)}" /></div>`).join("")}</div>
      <div class="form-acoes compacta"><button type="button" class="btn-sec btn-sm" id="btn-aprop-params">Salvar parâmetros</button></div>
    </details>

    ${apropImportarBloco(fechada)}

    <details><summary style="cursor:pointer;"><strong>Carga inicial da ficha</strong> <span class="meta">— só uma vez: lê a planilha antiga (.xlsx) e preenche banco, salário e benefícios de cada funcionário. Depois disso a planilha não é mais necessária.</span></summary>
      <p class="meta" style="margin:8px 0;"><label class="btn-sec btn-sm" style="cursor:pointer;">Escolher planilha FINANCEIRO – APROPRIAÇÕES (.xlsx)<input type="file" id="aprop-arquivo" accept=".xlsx,.xlsm" style="display:none;" /></label> A leitura é feita no seu navegador; os dados vão direto para a ficha sensível.</p>
    </details>`;

  $("aprop-comp")?.addEventListener("change", async e => { _aprop.comp = e.target.value; _aprop.res = null; await renderFuncAprop(); });
  $("btn-aprop-calcular")?.addEventListener("click", () => comBotaoTravado("btn-aprop-calcular", apropCalcular));
  $("btn-aprop-fechar")?.addEventListener("click", () => comBotaoTravado("btn-aprop-fechar", () => apropFechar(false)));
  $("btn-aprop-reabrir")?.addEventListener("click", () => comBotaoTravado("btn-aprop-reabrir", () => apropFechar(true)));
  $("btn-lanc-add")?.addEventListener("click", () => comBotaoTravado("btn-lanc-add", apropLancar));
  $("btn-aprop-params")?.addEventListener("click", () => comBotaoTravado("btn-aprop-params", apropSalvarParams));
  $("aprop-arquivo")?.addEventListener("change", e => { const f = e.target.files[0]; if(f) apropLerArquivo(f); e.target.value = ""; });
  $("aprop-imp-arquivo")?.addEventListener("change", e => { const fs = [...e.target.files]; if(fs.length) apropImpLer(fs); e.target.value = ""; });
  $("btn-aprop-rub-xlsx")?.addEventListener("click", () => apropRubricasXlsx(obraDe));
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

/* ---------- lote S51 (#141): visão do admin ----------
   Só os totais por obra/centro de custo da competência, lidos por fn_apropriacao_totais_obra() (security definer, sem linha
   por funcionário, exige MFA nesta sessão), e o botão Calcular apropriação (fn_apropriar_competencia, que devolve só
   contagens e o total). Ficam com o RH e a diretoria: a tabela por funcionário, os lançamentos do mês, os parâmetros de
   encargos, fechar/reabrir a competência e a carga inicial da ficha (que grava a ficha sensível). */
async function renderFuncApropTotais(){
  const cont = $("func-conteudo");
  if(!cont) return;
  if(!_aprop.comp) _aprop.comp = apropCompPadrao();
  cont.innerHTML = `<p class="vazio">Carregando apropriação de ${apropCompLabel(_aprop.comp)}…</p>`;
  const { data, error } = await sb.rpc("fn_apropriacao_totais_obra", { p_comp: _aprop.comp });
  if(error){
    const mfa = error.hint === "mfa_obrigatorio" || /dois fatores|mfa/i.test(error.message || "");
    cont.innerHTML = `<p class="vazio">${mfa ? "Apropriações exigem autenticação em dois fatores nesta sessão: saia e entre de novo concluindo o MFA."
      : "Não foi possível carregar a apropriação: " + esc(error.message || "")}</p>`;
    return;
  }
  const linhas = Array.isArray(data?.linhas) ? data.linhas : [];
  const fechadaEm = data?.fechada_em || null;
  const obraDe = (r) => r.obra_id ? (mapaObras?.[r.obra_id] || "Obra") : (r.centro_custo || "—");
  const tot = apropSomaObras(linhas);
  const semObra = linhas.filter(r => !r.obra_id).reduce((s, r) => s + Number(r.total || 0), 0);
  const nFunc = Number(data?.funcionarios || 0);

  cont.innerHTML = `
    <div class="meta" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px;">
      <label>Competência <select id="aprop-comp">${apropOpcoesMes()}</select></label>
      ${fechadaEm ? `<span class="conf-badge" style="background:var(--sucesso);">Fechada em ${dataBR(String(fechadaEm).slice(0, 10))}</span>` : `<span class="conf-badge" style="background:var(--aviso);color:var(--aviso-txt);">Aberta</span>`}
      ${fechadaEm ? "" : `<button type="button" class="btn btn-sm" id="btn-aprop-calcular">Calcular apropriação</button>`}
      <button type="button" class="btn-sec btn-sm" id="btn-aprop-csv" ${linhas.length ? "" : "disabled"}>CSV</button>
      <span style="margin-left:auto;">Rateio pelos dias de presença no RDO → alocação vigente → ADM/PÁTIO</span>
    </div>
    ${apropResumoCalculo(_aprop.res)}
    <div class="indicadores" style="margin-bottom:12px;">
      <div class="ind"><div class="num">${nFunc}</div><div class="rot">Funcionários apropriados</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.sal)}</div><div class="rot">Salários</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.ben)}</div><div class="rot">Benefícios</div></div>
      <div class="ind"><div class="num">${apropMoeda(tot.enc)}</div><div class="rot">Encargos</div></div>
      <div class="ind"><div class="num" style="color:var(--acao-txt);">${apropMoeda(tot.total)}</div><div class="rot">Custo total da folha</div></div>
      <div class="ind"><div class="num" style="color:${semObra ? "var(--aviso-txt)" : "inherit"};">${apropMoeda(semObra)}</div><div class="rot">Sem obra (ADM/PÁTIO)</div></div>
    </div>
    ${apropTabelaObras(linhas, tot, obraDe)}
    <p class="meta" style="margin:0;">🔒 Valores por funcionário, lançamentos do mês, parâmetros de encargos, fechamento da competência e a ficha de cada funcionário ficam com o RH e a diretoria.</p>`;

  $("aprop-comp")?.addEventListener("change", async e => { _aprop.comp = e.target.value; _aprop.res = null; await renderFuncAprop(); });
  $("btn-aprop-calcular")?.addEventListener("click", () => comBotaoTravado("btn-aprop-calcular", apropCalcular));
  $("btn-aprop-csv")?.addEventListener("click", () => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Obra/centro de custo;Salarios;Beneficios;Encargos;Total"].concat(linhas.map(r => [obraDe(r), Number(r.salarios || 0).toFixed(2), Number(r.beneficios || 0).toFixed(2), Number(r.encargos || 0).toFixed(2), Number(r.total || 0).toFixed(2)].map(cel).join(";"))).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = `apropriacoes-por-obra-${_aprop.comp.slice(0, 7)}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  });
}

/* ---------- ações ---------- */
async function apropCalcular(){
  // não há histórico de salário: mês passado é calculado com a ficha de hoje e substitui as linhas gravadas
  if(_aprop.comp < hojeISO().slice(0, 7) + "-01"
     && !confirm(`Os salários e benefícios usados são os de hoje, não os de ${apropCompLabel(_aprop.comp)}. As linhas atuais do mês serão substituídas. Calcular?`)) return;
  const { data, error } = await sb.rpc("fn_apropriar_competencia", { p_comp: _aprop.comp });
  if(error){ aviso("app-aviso", "Erro ao apropriar: " + error.message, "erro"); return; }
  _aprop.res = data;
  aviso("app-aviso", `Apropriação de ${apropCompLabel(_aprop.comp)} calculada: ${data.funcionarios} funcionários, ${apropMoeda(data.total)}.`, "ok");
  await renderFuncAprop();
}
async function apropFechar(reabrir){
  if(!reabrir && !confirm(`Fechar a competência ${apropCompLabel(_aprop.comp)}? Depois disso só a diretoria reabre.`)) return;
  const { error } = await sb.rpc("fn_fechar_competencia", { p_comp: _aprop.comp, p_reabrir: !!reabrir });
  if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
  aviso("app-aviso", reabrir ? "Competência reaberta." : "Competência fechada.", "ok");
  await renderFuncAprop();
}
async function apropLancar(){
  const reg = { competencia: _aprop.comp, funcionario_id: $("lanc-func").value || null, rubrica: $("lanc-rubrica").value, valor: Number($("lanc-valor").value), obra_id: $("lanc-obra").value || null, observacoes: $("lanc-obs").value.trim() || null };
  if(!reg.funcionario_id || !reg.valor){ aviso("app-aviso", "Informe funcionário e valor.", "erro"); return; }
  const { error } = await sb.from("folha_lancamentos").insert(reg);
  if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
  aviso("app-aviso", "Lançamento gravado. Recalcule a apropriação para refletir.", "ok");
  await renderFuncAprop();
}
async function apropSalvarParams(){
  const regs = [...document.querySelectorAll(".aprop-param")].map(i => ({ chave: i.dataset.chave, valor: Number(i.value) || 0, updated_at: new Date().toISOString() }));
  const { error } = await sb.from("apropriacao_parametros").upsert(regs, { onConflict: "chave" });
  if(error){ aviso("app-aviso", "Erro: " + error.message, "erro"); return; }
  aviso("app-aviso", "Parâmetros salvos. Recalcule a apropriação para aplicar.", "ok");
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
  aviso("app-aviso", `${regs.length} fichas atualizadas. Agora clique em "Calcular apropriação".`, "ok");
  _aprop.parse = null;
  await renderFuncAprop();
}

/* ---------- fase 187b (#291): importação dos relatórios do mês e apropriação por rubrica ----------
   A Jucirlene sobe os relatórios da folha do mês (.xlsx, .xls ou .csv). A leitura é toda no navegador (SheetJS): nome,
   CPF e salário não passam por servidor nosso nem pelo chat. O app acha o cabeçalho (coluna de nome do funcionário),
   sugere a rubrica de cada coluna pelo título (dá para trocar), casa cada pessoa com o cadastro pela matrícula ou pelo
   nome e mostra a conferência antes de gravar: total por rubrica do arquivo, total que será gravado e quem ficou sem
   casamento. Os totais da empresa (GPS, contribuição sindical patronal, seguro de vida) são digitados e o banco divide
   pela proporção do salário de cada pessoa (folha_importar_competencia, RH/diretoria em aal2). A competência fica
   aberta: o app não fecha. Depois de gravar, "Calcular apropriação" rateia pelos dias de RDO, como sempre (D6). */
const APROP_IMP_SUGESTAO = [
  [/SALARIO.*PARTICULAR/, "salario_particular"], [/GRATIFICA/, "gratificacao"], [/INSALUBR/, "insalubridade"],
  [/PERICULOS/, "periculosidade"], [/^(SALARIO|SAL\.? BASE|VENCIMENTO)/, "salario_contabil"],
  [/GPS/, "gps"], [/FGTS/, "fgts"], [/IRRF|IMPOSTO DE RENDA/, "irrf"], [/INSS/, "inss"],
  [/COPART/, "unimed_copart"], [/UNIMED.*(EMPRESA|PATRONAL)/, "unimed_empresa"], [/UNIMED|PLANO DE SAUDE/, "unimed"],
  [/METLIFE/, "metlife"], [/SEGURO/, "seguro_vida"], [/VALE.?TRANSP|^VT\b/, "vale_transporte"],
  [/^VR\b|VALE.?REFEI/, "vr"], [/FLASH/, "flash"], [/SINDICA/, "contribuicao_sindical"], [/CONSIGNADO/, "consignado"],
  [/RESCIS/, "rescisao"],
];
// rubricas que o relatório traz só como total da empresa (D7): digitadas, divididas pela proporção do salário
const APROP_IMP_EMPRESA = [["gps", "GPS (total da guia)"], ["contribuicao_sindical", "Contribuição sindical patronal"], ["seguro_vida", "Seguro de vida (total da apólice)"]];
const APROP_IMP_NOME = /^(NOME|FUNCIONARIO|EMPREGADO|COLABORADOR)/;
const APROP_IMP_MAT = /^(MATRIC|CHAPA|COD(IGO)?\b|COD\.)/;

function apropImpSugerir(titulo){
  const t = apropNorm(titulo);
  if(!t || /^(TOTAL|LIQUIDO|BRUTO|DESCONTOS?$|PROVENTOS?$)/.test(t)) return "";
  const s = APROP_IMP_SUGESTAO.find(([re]) => re.test(t));
  return s ? s[1] : "";
}
function apropImpMat(v){ return String(v ?? "").trim().replace(/\.0$/, "").replace(/^0+/, ""); }

function apropImportarBloco(fechada){
  const res = _aprop.impRes && _aprop.impRes.competencia === _aprop.comp ? _aprop.impRes : null;
  const conf = res ? `<div class="card" style="border-left:4px solid var(--sucesso);margin:8px 0;">
      <h4 style="margin:0 0 6px;">Importação gravada: ${Number(res.funcionarios || 0)} funcionário(s), ${Number(res.linhas || 0)} linha(s)</h4>
      <div class="tabela-rola"><table><thead><tr><th>Rubrica</th><th class="num">No arquivo</th><th class="num">Gravado</th><th class="num">Diferença</th></tr></thead>
        <tbody>${(res.por_rubrica || []).map(r => `<tr><td>${esc(APROP_RUBRICA_LBL[r.rubrica] || APROP_RUBRICA_AUTO[r.rubrica] || r.rubrica)}${r.empresa ? " <span class=\"meta\">(total da empresa)</span>" : ""}</td><td class="num" data-val-sens>${apropMoeda(r.arquivo)}</td><td class="num" data-val-sens>${apropMoeda(r.gravado)}</td><td class="num" data-val-sens>${Math.abs(Number(r.arquivo) - Number(r.gravado)) > 0.005 ? `<span class="txt-perigo">${apropMoeda(Number(r.arquivo) - Number(r.gravado))}</span>` : "—"}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="meta" style="margin:6px 0 0;">Agora clique em <strong>Calcular apropriação</strong> para ratear pelos dias de RDO. A competência continua aberta.</p></div>` : "";
  return `<details style="margin-bottom:12px;" ${res ? "open" : ""}><summary style="cursor:pointer;"><strong>Importar relatórios do mês</strong> <span class="meta">— os valores de cada rubrica vêm da folha do mês, não da ficha</span></summary>
      <p class="meta" style="margin:8px 0;">${fechada ? "Competência fechada: não se importa em mês fechado." : `<label class="btn-sec btn-sm" style="cursor:pointer;" title="Relatórios da folha do mês em .xlsx, .xls ou .csv; pode escolher vários">Escolher relatórios (.xlsx, .xls, .csv)<input type="file" id="aprop-imp-arquivo" accept=".xlsx,.xls,.xlsm,.csv" multiple style="display:none;" /></label> A leitura é feita no seu navegador. Reimportar substitui a importação anterior desta competência.`}</p>
      ${/* html */ conf}
      <div id="aprop-imp-area"></div>
    </details>`;
}

async function apropImpLer(files){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de leitura de planilhas não carregou. Recarregue a página.", "erro"); return; }
  const area = $("aprop-imp-area"); if(!area) return;
  area.innerHTML = `<p class="vazio">Lendo ${files.length} arquivo(s)…</p>`;
  const tabelas = []; const semCab = [];
  for(const file of files){
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      wb.SheetNames.forEach(aba => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: "" });
        const iCab = rows.slice(0, 40).findIndex(r => r.some(c => APROP_IMP_NOME.test(apropNorm(c))));
        if(iCab < 0){ semCab.push(`${file.name} / ${aba}`); return; }
        const cab = rows[iCab].map(c => String(c ?? "").trim());
        const iNome = cab.findIndex(c => APROP_IMP_NOME.test(apropNorm(c)));
        const iMat = cab.findIndex(c => APROP_IMP_MAT.test(apropNorm(c)));
        const linhas = rows.slice(iCab + 1).filter(r => { const n = String(r[iNome] ?? "").trim(); return n && !/^TOTA/.test(apropNorm(n)); });
        const cols = cab.map((titulo, i) => ({ i, titulo, rubrica: apropImpSugerir(titulo) }))
          .filter(c => c.i !== iNome && c.i !== iMat && c.titulo && linhas.some(r => apropNum(r[c.i]) != null));
        tabelas.push({ arquivo: file.name, aba, iNome, iMat, linhas, cols });
      });
    } catch(e){ semCab.push(`${file.name} (${e.message || e})`); }
  }
  _aprop.imp = { tabelas, semCab, empresa: {} };
  apropImpRender();
}

/* monta as linhas da RPC e a conferência; nada sai do navegador até "Gravar importação" */
function apropImpLinhas(){
  const imp = _aprop.imp; const porMat = new Map(); const porNome = new Map();
  _funcs.forEach(f => { if(f.matricula) porMat.set(apropImpMat(f.matricula), f.id); porNome.set(apropNorm(f.nome), f.id); });
  const linhas = []; const semCasamento = new Set(); const conf = new Map();
  const somar = (rub, campo, v) => { const c = conf.get(rub) || { arquivo: 0, gravar: 0, empresa: false }; c[campo] += v; conf.set(rub, c); };
  imp.tabelas.forEach(t => t.linhas.forEach(r => {
    const nome = String(r[t.iNome] ?? "").trim();
    const fid = (t.iMat >= 0 && porMat.get(apropImpMat(r[t.iMat]))) || porNome.get(apropNorm(nome)) || null;
    t.cols.filter(c => c.rubrica).forEach(c => {
      const v = apropNum(r[c.i]); if(v == null || v === 0) return;
      somar(c.rubrica, "arquivo", v);
      if(fid){ somar(c.rubrica, "gravar", v); linhas.push({ funcionario_id: fid, rubrica: c.rubrica, valor: Math.round(v * 100) / 100 }); }
    });
    if(!fid && t.cols.some(c => c.rubrica && apropNum(r[c.i]))) semCasamento.add(nome);
  }));
  APROP_IMP_EMPRESA.forEach(([rub]) => {
    const v = apropNum(imp.empresa[rub]); if(v == null || v === 0) return;
    somar(rub, "arquivo", v); somar(rub, "gravar", v); conf.get(rub).empresa = true;
    linhas.push({ funcionario_id: null, rubrica: rub, valor: Math.round(v * 100) / 100 });
  });
  return { linhas, semCasamento: [...semCasamento].sort((a, b) => a.localeCompare(b, "pt-BR")), conf };
}

function apropImpRender(){
  const area = $("aprop-imp-area"); const imp = _aprop.imp; if(!area || !imp) return;
  const opcoes = (sel) => `<option value="">— ignorar —</option>` + Object.entries(APROP_RUBRICA_LBL).map(([k, v]) => `<option value="${esc(k)}" ${k === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
  const { linhas, semCasamento, conf } = apropImpLinhas();
  const temSal = linhas.some(l => l.funcionario_id && l.rubrica === "salario_contabil");
  const temEmp = linhas.some(l => !l.funcionario_id);
  area.innerHTML = `
    ${imp.semCab.length ? `<p class="txt-perigo" style="margin:4px 0;">Sem cabeçalho com a coluna do nome do funcionário (ignorados): ${esc(imp.semCab.join("; "))}</p>` : ""}
    ${imp.tabelas.length ? "" : `<p class="vazio">Nenhum relatório reconhecido. O cabeçalho precisa de uma coluna Nome, Funcionário, Empregado ou Colaborador.</p>`}
    ${imp.tabelas.map((t, ti) => `<div class="card" style="margin:8px 0;">
      <h4 style="margin:0 0 6px;"><span style="font-family:var(--font-mono);">${esc(t.arquivo)}</span> · ${esc(t.aba)} <span class="meta">(${t.linhas.length} linhas${t.iMat >= 0 ? ", casa pela matrícula e pelo nome" : ", casa pelo nome"})</span></h4>
      <div class="tabela-rola"><table><thead><tr><th>Coluna do relatório</th><th>Rubrica</th><th class="num">Total da coluna</th></tr></thead>
        <tbody>${t.cols.map((c, ci) => `<tr><td>${esc(c.titulo)}</td><td><select class="aprop-imp-rub" data-t="${ti}" data-c="${ci}" title="Rubrica em que esta coluna é gravada; ignorar deixa a coluna de fora">${opcoes(c.rubrica)}</select></td><td class="num" data-val-sens>${apropMoeda(t.linhas.reduce((s, r) => s + (apropNum(r[c.i]) || 0), 0))}</td></tr>`).join("") || `<tr><td colspan="3" class="vazio">Nenhuma coluna com valor.</td></tr>`}</tbody>
      </table></div></div>`).join("")}
    <div class="card" style="margin:8px 0;">
      <h4 style="margin:0 0 6px;">Totais da empresa <span class="meta">— divididos pela proporção do salário contábil importado de cada pessoa e depois pelos dias em cada obra</span></h4>
      <div class="grade">${APROP_IMP_EMPRESA.map(([rub, rot]) => `<div class="campo"><label>${esc(rot)}</label><input type="number" step="0.01" class="aprop-imp-emp" data-rub="${esc(rub)}" value="${esc(imp.empresa[rub] ?? "")}" /></div>`).join("")}</div>
      ${temEmp && !temSal ? `<p class="txt-perigo" style="margin:4px 0;">Para dividir os totais da empresa, uma coluna precisa estar como Salário contábil.</p>` : ""}
    </div>
    <h4 style="margin:8px 0 6px;">Conferência antes de gravar</h4>
    <div class="tabela-rola"><table><thead><tr><th>Rubrica</th><th class="num">No arquivo</th><th class="num">Será gravado</th><th class="num">Fica de fora</th></tr></thead>
      <tbody>${[...conf.entries()].map(([rub, c]) => `<tr><td>${esc(APROP_RUBRICA_LBL[rub] || rub)}${c.empresa ? " <span class=\"meta\">(total da empresa)</span>" : ""}</td><td class="num" data-val-sens>${apropMoeda(c.arquivo)}</td><td class="num" data-val-sens>${apropMoeda(c.gravar)}</td><td class="num" data-val-sens>${Math.abs(c.arquivo - c.gravar) > 0.005 ? `<span class="txt-perigo">${apropMoeda(c.arquivo - c.gravar)}</span>` : "—"}</td></tr>`).join("") || `<tr><td colspan="4" class="vazio">Nenhuma coluna marcada com rubrica.</td></tr>`}</tbody>
    </table></div>
    ${semCasamento.length ? `<p class="txt-perigo" style="margin:6px 0;">${semCasamento.length} pessoa(s) sem casamento com o cadastro (ficam de fora): ${esc(semCasamento.slice(0, 30).join(", "))}${semCasamento.length > 30 ? "…" : ""}</p>` : `<p class="meta" style="margin:6px 0;">Todas as pessoas com valor casaram com o cadastro.</p>`}
    <div class="form-acoes compacta"><button type="button" class="btn-sec" id="btn-aprop-imp-cancelar">Cancelar</button><button type="button" class="btn" id="btn-aprop-imp-gravar" ${linhas.length && (!temEmp || temSal) ? "" : "disabled"} title="Grava em ${esc(apropCompLabel(_aprop.comp))}, substituindo a importação anterior desta competência">Gravar importação</button></div>`;
  area.querySelectorAll(".aprop-imp-rub").forEach(s => s.addEventListener("change", () => { imp.tabelas[Number(s.dataset.t)].cols[Number(s.dataset.c)].rubrica = s.value; apropImpRender(); }));
  area.querySelectorAll(".aprop-imp-emp").forEach(i => i.addEventListener("change", () => { imp.empresa[i.dataset.rub] = i.value; apropImpRender(); }));
  $("btn-aprop-imp-cancelar")?.addEventListener("click", () => { _aprop.imp = null; area.innerHTML = ""; });
  $("btn-aprop-imp-gravar")?.addEventListener("click", () => comBotaoTravado("btn-aprop-imp-gravar", apropImpGravar));
}

async function apropImpGravar(){
  const { linhas, semCasamento } = apropImpLinhas();
  if(!linhas.length){ aviso("app-aviso", "Nada para gravar: marque ao menos uma coluna com rubrica.", "erro"); return; }
  if(!confirm(`Gravar a importação em ${apropCompLabel(_aprop.comp)}? A importação anterior desta competência é substituída.${semCasamento.length ? `\n\n${semCasamento.length} pessoa(s) sem casamento ficam de fora.` : ""}`)) return;
  const { data, error } = await sb.rpc("folha_importar_competencia", { p_comp: _aprop.comp, p_linhas: linhas });
  if(error){
    const mfa = error.hint === "mfa_obrigatorio" || /dois fatores/i.test(error.message || "");
    aviso("app-aviso", mfa ? "Importar a folha exige autenticação em dois fatores nesta sessão: saia e entre de novo concluindo o MFA." : "Erro ao importar: " + error.message, "erro");
    return;
  }
  _aprop.imp = null; _aprop.impRes = data;
  aviso("app-aviso", `Importação gravada em ${apropCompLabel(_aprop.comp)}. Agora clique em "Calcular apropriação".`, "ok");
  await renderFuncAprop();
}

/* tabela obra × rubrica (colunas r_* de vw_custo_mao_obra_por_obra) e exportação .xlsx */
function apropRubricasPresentes(linhas){
  const rotulos = { ...APROP_RUBRICA_LBL, ...APROP_RUBRICA_AUTO };
  return Object.keys(rotulos).filter(k => linhas.some(r => Number(r["r_" + k] || 0) !== 0)).map(k => [k, rotulos[k]]);
}
function apropTabelaRubricas(linhas, obraDe){
  const rubs = apropRubricasPresentes(linhas);
  if(!rubs.length) return "";
  const ord = linhas.slice().sort((a, b) => Number(b.total) - Number(a.total));
  const totCol = (k) => linhas.reduce((s, r) => s + Number(r["r_" + k] || 0), 0);
  return `<div style="display:flex;align-items:center;gap:8px;margin:0 0 6px;"><h4 style="margin:0;">Custo por obra e rubrica</h4>
      <button type="button" class="btn-sec btn-sm" id="btn-aprop-rub-xlsx" style="margin-left:auto;" title="Planilha .xlsx com a mesma tabela (obra × rubrica)">Exportar .xlsx</button></div>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Obra / centro de custo</th>${rubs.map(([, rot]) => `<th class="num">${esc(rot)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${ord.map(r => `<tr><td>${esc(obraDe(r))}</td>${rubs.map(([k]) => `<td class="num" data-val-sens>${Number(r["r_" + k] || 0) ? apropMoeda(r["r_" + k]) : "—"}</td>`).join("")}<td class="num" data-val-sens><strong>${apropMoeda(r.total)}</strong></td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td>${rubs.map(([k]) => `<td class="num" data-val-sens>${apropMoeda(totCol(k))}</td>`).join("")}<td class="num" data-val-sens>${apropMoeda(linhas.reduce((s, r) => s + Number(r.total || 0), 0))}</td></tr></tfoot>
    </table></div>`;
}
function apropRubricasXlsx(obraDe){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilhas não carregou. Recarregue a página.", "erro"); return; }
  const linhas = _aprop.custo; const rubs = apropRubricasPresentes(linhas);
  const ord = linhas.slice().sort((a, b) => Number(b.total) - Number(a.total));
  const aoa = [["Obra / centro de custo", ...rubs.map(([, rot]) => rot), "Total"]]
    .concat(ord.map(r => [obraDe(r), ...rubs.map(([k]) => Number(r["r_" + k] || 0)), Number(r.total || 0)]));
  const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Obra x rubrica");
  XLSX.writeFile(wb, `apropriacao-por-rubrica-${_aprop.comp.slice(0, 7)}.xlsx`);
}

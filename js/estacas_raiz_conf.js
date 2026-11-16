/* ====================================================================
   js/estacas_raiz_conf.js — fase 184a (#293 e #241): a estaca raiz pelo histórico de trechos.
   Carregado depois do js/estacas.js. Não grava nada.

   1) Vista "Trechos" da aba Estacas (prefixo ert-): uma linha por trecho de rdo_raiz_solo, nas colunas da aba
      ESTACAS DO PERÍODO da RG 11.1, com filtros, o resumo por estaca (profundidade máxima e equipamento) e a planilha.
   2) Conferência da raiz (prefixo crz-): na aba Alteradas, a estaca raiz deixa de ser "SUSPEITO" só por ter várias
      execuções e passa a ter a situação pelo histórico, numa função só (confRaizClassificar):
        normal      (verde)    várias execuções em dias ou ferramentas diferentes, com avanço coerente;
        etapa       (amarelo)  trechos sobrepostos com a mesma ferramenta e sem etapa; início maior que o fim;
                               trecho sem início ou sem fim;
        duplicidade (laranja)  duas linhas com a mesma data, RDO, máquina, ferramenta, início e fim;
        vinculo     (vermelho) execução de outra obra, ou dois nomes de campo na mesma estaca do projeto sem
                               vínculo confirmado.
      Medida da engenharia (aba TRAVESSIA da RG 11.1): profundidade máxima = o maior "final" (nunca a soma);
      revestimento e rocha (tricone + martelo) são somas, porque são serviços diferentes; refuro à parte.
      Hélice não muda: continua a regra antiga (confClassificarGrupo).
   As funções de cálculo (confRaizLinhas, confRaizClassificar, confClassificarGrupo, ertMontar) não leem a tela
   nem o banco: o teste scripts/testar-fase184a.mjs as roda no Node.
   ==================================================================== */

const CRZ_SITUACOES = {
  normal:      { rotulo: "Histórico normal",     dica: "Várias execuções em dias ou ferramentas diferentes, com avanço coerente" },
  etapa:       { rotulo: "Verificar etapa",      dica: "Trecho sobreposto com a mesma ferramenta e sem etapa, início maior que o fim, ou trecho sem início ou sem fim" },
  duplicidade: { rotulo: "Possível duplicidade", dica: "Duas linhas com a mesma data, RDO, máquina, ferramenta, início e fim" },
  vinculo:     { rotulo: "Corrigir vínculo",     dica: "Execução de outra obra, ou dois nomes de campo na mesma estaca do projeto sem vínculo confirmado" }
};
const CRZ_ORDEM = ["vinculo", "duplicidade", "etapa", "normal"];
const ERT_FERRAMENTAS = { revestimento: "Revestimento", tricone: "Tricone", martelo: "Martelo" };

function _crzNum(v){ if(v == null || v === "") return null; const n = Number(v); return isFinite(n) ? n : null; }
function _crzNorm(s){ return String(s || "").toUpperCase().trim().replace(/\s+/g, " "); }
function _crzR2(v){ return Math.round(v * 100) / 100; }

/* Uma linha por trecho de solo; execução sem trecho vira uma linha com o "de / até" da execução (ou só a metragem do
   dia); execução sem metragem (injeção, armação) vira uma linha que não é de perfuração e não entra nas contas. */
function confRaizLinhas(execs){
  const linhas = [];
  (execs || []).forEach(x => {
    const base = {
      exec_id: x.id, rdo_id: x.rdo_id || null, rdo_num: x.rdo_num || x.numero_boletim_fisico || "", data: x.data || "",
      obra_id: x.obra_id || null, maquina: x.maquina || "", etapa: x.etapa_final || null,
      refuro: (x.modalidade_execucao || "furo_normal") === "refuro",
      campo: x.estaca_numero || "", corrigido: x.estaca_numero_corrigido || null
    };
    const solo = (x._solo || []).slice().sort((a, b) => (_crzNum(a.ordem) ?? 0) - (_crzNum(b.ordem) ?? 0) || (_crzNum(a.inicio_ml) ?? 0) - (_crzNum(b.inicio_ml) ?? 0));
    if(solo.length){
      solo.forEach(s => {
        const ini = _crzNum(s.inicio_ml), fim = _crzNum(s.final_ml);
        linhas.push({ ...base, perfuracao: true, trecho: true, ferramenta: s.ferramenta || null, classificacao: s.classificacao || "",
          inicio: ini, fim, metragem: ini != null && fim != null ? _crzR2(fim - ini) : null });
      });
      return;
    }
    const de = _crzNum(x.perfuracao_de_m), ate = _crzNum(x.perfuracao_ate_m), prof = _crzNum(x.profundidade_executada);
    if(de != null || ate != null || (prof || 0) > 0){
      linhas.push({ ...base, perfuracao: true, trecho: de != null || ate != null, ferramenta: x.ferramental || null, classificacao: "",
        inicio: de, fim: ate, metragem: de != null && ate != null ? _crzR2(ate - de) : prof });
      return;
    }
    linhas.push({ ...base, perfuracao: false, trecho: false, ferramenta: null, classificacao: "", inicio: null, fim: null, metragem: null });
  });
  return linhas.sort((a, b) => String(a.data).localeCompare(String(b.data)) || (a.inicio ?? 0) - (b.inicio ?? 0));
}

/* Situação de uma estaca raiz pelas linhas do histórico. ctx = { obraId, estaca }. Marca em cada linha o alerta dela. */
function confRaizClassificar(linhas, ctx){
  const obraId = ctx && ctx.obraId, est = (ctx && ctx.estaca) || {};
  const motivos = { vinculo: [], duplicidade: [], etapa: [] };
  const perf = (linhas || []).filter(l => l.perfuracao);
  const furos = perf.filter(l => !l.refuro);
  perf.forEach(l => { l.alerta = null; });
  const marcar = (l, sit) => { if(!l.alerta || CRZ_ORDEM.indexOf(sit) < CRZ_ORDEM.indexOf(l.alerta)) l.alerta = sit; };

  // vínculo: execução de outra obra
  (linhas || []).forEach(l => {
    if(obraId && l.obra_id && l.obra_id !== obraId){
      marcar(l, "vinculo");
      motivos.vinculo.push(`Execução de outra obra (${l.data ? l.data.split("-").reverse().join("/") : "sem data"}${l.rdo_num ? ", RDO " + l.rdo_num : ""})`);
    }
  });
  // vínculo: dois nomes de campo na mesma estaca do projeto, algum sem vínculo confirmado
  const campos = [...new Set((linhas || []).map(l => _crzNorm(l.campo)).filter(Boolean))];
  const semVinculo = (linhas || []).filter(l => l.campo && !l.corrigido && _crzNorm(l.campo) !== _crzNorm(est.numero));
  if(campos.length > 1 && semVinculo.length){
    semVinculo.forEach(l => marcar(l, "vinculo"));
    motivos.vinculo.push(`${campos.length} nomes de campo (${campos.join(", ")}) na estaca ${est.numero || "do projeto"} sem vínculo confirmado`);
  }
  // duplicidade: mesma data, RDO, máquina, ferramenta, início e fim
  const chaves = new Map();
  perf.filter(l => l.inicio != null || l.fim != null).forEach(l => {
    const k = [l.data, l.rdo_id, _crzNorm(l.maquina), l.ferramenta || "", l.inicio, l.fim, l.refuro].join("|");
    if(!chaves.has(k)) chaves.set(k, []);
    chaves.get(k).push(l);
  });
  chaves.forEach(g => {
    if(g.length < 2) return;
    g.forEach(l => marcar(l, "duplicidade"));
    const l = g[0];
    motivos.duplicidade.push(`${g.length} linhas iguais em ${l.data.split("-").reverse().join("/")}: ${l.inicio ?? "?"} a ${l.fim ?? "?"} m${l.ferramenta ? " (" + l.ferramenta + ")" : ""}`);
  });
  // etapa: início maior que o fim; trecho sem início ou sem fim
  perf.forEach(l => {
    if(l.inicio != null && l.fim != null && l.inicio > l.fim){ marcar(l, "etapa"); motivos.etapa.push(`Início maior que o fim em ${l.data.split("-").reverse().join("/")} (${l.inicio} a ${l.fim} m)`); }
    else if(l.trecho && (l.inicio == null || l.fim == null)){ marcar(l, "etapa"); motivos.etapa.push(`Trecho sem ${l.inicio == null ? "início" : "fim"} em ${l.data.split("-").reverse().join("/")}`); }
  });
  // etapa: trechos sobrepostos com a mesma ferramenta e sem etapa (repetido idêntico já é duplicidade)
  const validos = perf.filter(l => l.inicio != null && l.fim != null && l.inicio < l.fim);
  for(let i = 0; i < validos.length; i++){
    for(let j = i + 1; j < validos.length; j++){
      const a = validos[i], b = validos[j];
      if(a.refuro !== b.refuro || (a.ferramenta || "") !== (b.ferramenta || "")) continue;
      if(!(a.inicio < b.fim && b.inicio < a.fim)) continue;
      if(a.etapa && b.etapa) continue;
      if(a.alerta === "duplicidade" && b.alerta === "duplicidade" && a.inicio === b.inicio && a.fim === b.fim) continue;
      marcar(a, "etapa"); marcar(b, "etapa");
      motivos.etapa.push(`Trechos sobrepostos sem etapa: ${a.inicio}–${a.fim} m e ${b.inicio}–${b.fim} m${a.ferramenta ? " (" + a.ferramenta + ")" : ""}`);
    }
  }

  const alcance = (l) => (l.fim != null ? l.fim : (l.metragem || 0));
  const soma = (lst) => _crzR2(lst.reduce((s, l) => s + Math.max(0, l.metragem || 0), 0));
  const situacao = motivos.vinculo.length ? "vinculo" : motivos.duplicidade.length ? "duplicidade" : motivos.etapa.length ? "etapa" : "normal";
  return {
    situacao,
    motivos: [...new Set([...motivos.vinculo, ...motivos.duplicidade, ...motivos.etapa])],
    profMax: furos.length ? Math.max(...furos.map(alcance)) : null,
    revestimento: soma(furos.filter(l => l.ferramenta === "revestimento")),
    rocha: soma(furos.filter(l => l.ferramenta === "tricone" || l.ferramenta === "martelo")),
    refuro: soma(perf.filter(l => l.refuro)),
    dias: new Set(perf.map(l => l.data).filter(Boolean)).size,
    registros: perf.length,
    maquinas: [...new Set((linhas || []).map(l => l.maquina).filter(m => m && m !== "—"))],
    campos,
    camposTxt: campos.join(", "),
    ferramentas: [...new Set(furos.map(l => l.ferramenta).filter(Boolean))],
    linhas: linhas || []
  };
}

/* Despachante: estaca raiz pelo histórico; as outras pela regra de sempre (2+ execuções sem refuro marcado = suspeita) */
function confClassificarGrupo(g, obraId){
  if(g && g.estaca && g.estaca.tipo === "raiz"){
    const r = confRaizClassificar(confRaizLinhas(g.execs), { obraId, estaca: g.estaca });
    return { regra: "raiz", ...r, suspeita: r.situacao !== "normal" };
  }
  return { regra: "helice", suspeita: !((g && g.execs) || []).some(e => e.modalidade_execucao === "refuro") };
}

/* Vista Trechos: uma linha por trecho de solo. estacaDe(id) devolve a estaca do projeto; opts.tag/bm/periodo(execução). */
function ertMontar(execs, estacaDe, opts){
  const o = opts || {};
  const linhas = [];
  (execs || []).forEach(x => {
    const est = (x.estaca_id && estacaDe ? estacaDe(x.estaca_id) : null) || null;
    const solo = (x._solo || []).slice().sort((a, b) => (_crzNum(a.ordem) ?? 0) - (_crzNum(b.ordem) ?? 0) || (_crzNum(a.inicio_ml) ?? 0) - (_crzNum(b.inicio_ml) ?? 0));
    if(!solo.length) return;
    const eqp = o.tag ? o.tag(x) || "" : (x.maquina || "");
    const bm = o.bm ? o.bm(x) || "" : "";
    const periodo = o.periodo ? o.periodo(x) || "" : "";
    solo.forEach(s => {
      const ini = _crzNum(s.inicio_ml), fim = _crzNum(s.final_ml);
      linhas.push({
        exec_id: x.id, rdo_id: x.rdo_id || null, estaca_id: x.estaca_id || null,
        data: x.data || "", campo: x.estaca_numero || (est && est.numero) || "", projeto: est ? est.numero || "" : "",
        diametro: _crzNum(est && est.diametro_mm != null ? est.diametro_mm : x.diametro_mm),
        inicial: ini, final: fim, prof: ini != null && fim != null ? _crzR2(fim - ini) : null,
        inclinacao: x.inclinacao || "", classificacao: s.classificacao || "", ferramenta: s.ferramenta || "",
        rdo: String(x.rdo_num || x.numero_boletim_fisico || ""), bm, bloco: est ? est.bloco || "" : "", local: est ? est.local || "" : "",
        eqp, periodo, refuro: (x.modalidade_execucao || "furo_normal") === "refuro"
      });
    });
  });
  linhas.sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.campo).localeCompare(String(b.campo), "pt-BR", { numeric: true }) || (a.inicial ?? 0) - (b.inicial ?? 0));
  // resumo por estaca (colunas S a U da planilha): maior "final" entre os trechos de furo e o equipamento desse trecho
  const porEst = new Map();
  linhas.forEach(l => {
    const k = l.estaca_id || "n:" + _crzNorm(l.campo);
    if(!porEst.has(k)) porEst.set(k, { estaca_id: l.estaca_id, campo: l.campo, projeto: l.projeto, bloco: l.bloco, local: l.local, profMax: null, eqp: "", trechos: 0 });
    const r = porEst.get(k);
    r.trechos++;
    if(!l.refuro && l.final != null && (r.profMax == null || l.final > r.profMax)){ r.profMax = l.final; r.eqp = l.eqp; }
  });
  const resumo = [...porEst.values()].sort((a, b) => String(a.campo).localeCompare(String(b.campo), "pt-BR", { numeric: true }));
  return { linhas, resumo };
}

/* ====================================================================
   VISTA TRECHOS (tela)
   ==================================================================== */
let _ertLinhas = [];   // linhas depois dos filtros (planilha)
let _ertResumo = [];

/* Botão ao lado do "Acompanhamento raiz": só em obra com estaca raiz (atualizarBotaoRaiz chama) */
function ertBotao(tem){
  const b = $("btn-est-view-trechos");
  if(b) b.style.display = tem ? "" : "none";
}
/* Chamado pelo renderEstacas: mostra a vista Trechos e esconde as outras (e os filtros das estacas, que não valem aqui) */
function ertVisao(visao, outros){
  const wrap = $("est-trechos-wrap");
  const ativa = visao === "trechos";
  if(wrap) wrap.style.display = ativa ? "" : "none";
  const filtros = wrap && wrap.parentElement ? wrap.parentElement.querySelector(":scope > .serv-filtros") : null;
  if(filtros) filtros.style.display = ativa ? "none" : "";
  if(!ativa) return false;
  (outros || []).forEach(el => { if(el) el.style.display = "none"; });
  ertRender();
  return true;
}

function _ertFiltros(){
  return {
    de: $("ert-f-de")?.value || "", ate: $("ert-f-ate")?.value || "",
    estaca: ($("ert-f-estaca")?.value || "").trim().toUpperCase(),
    bloco: $("ert-f-bloco")?.value || "", maq: $("ert-f-maq")?.value || "", ferr: $("ert-f-ferr")?.value || ""
  };
}
function _ertBm(x){
  if(typeof _raizMedicoes !== "function") return "";
  return [...new Set(_raizMedicoes([x]).map(m => String(m.numero || "").split(" · ")[0]).filter(Boolean))].join(", ");
}

async function ertRender(){
  const cont = $("ert-conteudo");
  if(!cont) return;
  if(typeof _raizDados === "undefined" || !_raizDados){
    cont.innerHTML = `<p class="vazio">Carregando os trechos do RDO…</p>`;
    if(typeof carregarAcompanhamentoRaiz !== "function" || !(await carregarAcompanhamentoRaiz())) return;
    if(_estView !== "trechos") return;
  }
  const execs = [];
  _raizDados.porEstaca.forEach(lst => lst.forEach(x => execs.push(x)));
  const estPorId = new Map((_estacas || []).map(e => [e.id, e]));
  const m = ertMontar(execs, (id) => estPorId.get(id), { tag: _raizTag, bm: _ertBm, periodo: (x) => x._periodo || "" });

  // monta a barra de filtros uma vez por obra; os valores escolhidos ficam
  if(!$("ert-filtros") || cont.dataset.obra !== String(obraEditId)){
    const ops = (lst) => lst.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    const ord = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true });
    const blocos = [...new Set(m.linhas.map(l => l.bloco).filter(Boolean))].sort(ord);
    const maqs = [...new Set(m.linhas.map(l => l.eqp).filter(Boolean))].sort(ord);
    cont.dataset.obra = String(obraEditId);
    cont.innerHTML = `<div class="serv-filtros" id="ert-filtros">
        <label class="ert-periodo" title="Período dos trechos, como as células F6:G6 da planilha">De <input type="date" id="ert-f-de"></label>
        <label class="ert-periodo">até <input type="date" id="ert-f-ate"></label>
        <input id="ert-f-estaca" placeholder="Estaca de campo ou do projeto..." title="Parte do nome da estaca de campo ou do projeto">
        <select id="ert-f-bloco"><option value="">Todos os blocos</option>${/* html */ ops(blocos)}</select>
        <select id="ert-f-maq"><option value="">Todos os equipamentos</option>${/* html */ ops(maqs)}</select>
        <select id="ert-f-ferr"><option value="">Todas as ferramentas</option><option value="revestimento">Revestimento</option><option value="tricone">Tricone</option><option value="martelo">Martelo</option></select>
        <button type="button" class="btn-sec btn-sm" id="btn-ert-csv" title="Planilha com as colunas desta tela">CSV</button>
        <button type="button" class="btn-sec btn-sm" id="btn-ert-xlsx" title="Planilha com as colunas desta tela e o resumo por estaca">Excel</button>
      </div>
      <div id="ert-corpo"></div>`;
    ["ert-f-de", "ert-f-ate", "ert-f-bloco", "ert-f-maq", "ert-f-ferr"].forEach(id => $(id)?.addEventListener("change", ertRender));
    $("ert-f-estaca")?.addEventListener("input", typeof debounce === "function" ? debounce(ertRender) : ertRender);
    $("btn-ert-csv")?.addEventListener("click", ertExportarCSV);
    $("btn-ert-xlsx")?.addEventListener("click", ertExportarExcel);
  }
  const f = _ertFiltros();
  const linhas = m.linhas.filter(l => (!f.de || l.data >= f.de) && (!f.ate || l.data <= f.ate)
    && (!f.estaca || `${l.campo} ${l.projeto}`.toUpperCase().includes(f.estaca))
    && (!f.bloco || l.bloco === f.bloco) && (!f.maq || l.eqp === f.maq) && (!f.ferr || l.ferramenta === f.ferr));
  const visiveis = new Set(linhas.map(l => l.estaca_id || "n:" + _crzNorm(l.campo)));
  // resumo pelo histórico inteiro da estaca (a profundidade máxima não depende do período escolhido)
  const resumo = m.resumo.filter(r => visiveis.has(r.estaca_id || "n:" + _crzNorm(r.campo)));
  _ertLinhas = linhas; _ertResumo = resumo;
  const corpo = $("ert-corpo");
  if(!corpo) return;
  if(!m.linhas.length){ corpo.innerHTML = `<p class="vazio">Nenhum trecho de solo lançado nos RDOs desta obra. Os trechos vêm da aba Dados Raiz do RDO.</p>`; return; }
  if(!linhas.length){ corpo.innerHTML = `<p class="vazio">Nenhum trecho para os filtros.</p>`; return; }

  const f2 = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const f0 = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 }));
  const somaProf = _crzR2(linhas.reduce((s, l) => s + (l.prof || 0), 0));
  const trs = linhas.map(l => `<tr class="${l.refuro ? "ert-refuro" : ""}">
      <td>${esc(l.data ? dataBR(l.data) : "—")}</td>
      <td><strong>${esc(l.campo || "—")}</strong>${l.projeto && _crzNorm(l.projeto) !== _crzNorm(l.campo) ? ` <span class="meta" title="Estaca do projeto">${esc(l.projeto)}</span>` : ""}${l.refuro ? ` <span class="badge-alterado" title="Execução de refuro">refuro</span>` : ""}</td>
      <td class="num">${esc(f0(l.diametro))}</td>
      <td class="num">${esc(f2(l.inicial))}</td>
      <td class="num">${esc(f2(l.final))}</td>
      <td class="num">${esc(f2(l.prof))}</td>
      <td>${esc(l.inclinacao || "—")}</td>
      <td>${esc(l.classificacao || "—")}</td>
      <td>${esc(ERT_FERRAMENTAS[l.ferramenta] || l.ferramenta || "—")}</td>
      <td><span class="ui-codigo">${esc(l.rdo || "—")}</span></td>
      <td>${esc(l.bm || "—")}</td>
      <td>${esc(l.bloco || "—")}</td>
      <td>${esc(l.eqp || "—")}</td>
      <td>${esc(l.periodo || "—")}</td>
    </tr>`).join("");
  const trsRes = resumo.map(r => `<tr>
      <td><strong>${esc(r.campo || "—")}</strong>${r.projeto && _crzNorm(r.projeto) !== _crzNorm(r.campo) ? ` <span class="meta">${esc(r.projeto)}</span>` : ""}</td>
      <td class="num">${esc(f2(r.profMax))}</td>
      <td>${esc(r.eqp || "—")}</td>
    </tr>`).join("");
  corpo.innerHTML = `<div class="raiz-resumo">
      <span><strong>${esc(linhas.length)}</strong> trechos</span>
      <span><strong>${esc(resumo.length)}</strong> estacas</span>
      <span><strong>${esc(f2(somaProf))} m</strong> somados nos trechos (operações; a profundidade de cada estaca é a máxima, ao lado)</span>
    </div>
    <div class="ert-layout">
      <div class="tabela-rola"><table class="raiz-tabela ert-tabela">
        <thead><tr><th>Data</th><th>Estaca</th><th class="num">Diâmetro (mm)</th><th class="num">Inicial (m)</th><th class="num">Final (m)</th><th class="num">Prof. (m)</th>
          <th>Inclinação</th><th>Classificação</th><th>Ferramenta</th><th>RDO</th><th>BM</th><th>Bloco</th><th>Equipamento</th><th>Período</th></tr></thead>
        <tbody>${/* html */ trs}</tbody>
      </table></div>
      <div class="tabela-rola ert-resumo"><table class="raiz-tabela">
        <thead><tr><th>Estaca</th><th class="num" title="Maior final entre os trechos de furo da estaca (nunca a soma)">Prof. máx. (m)</th><th>Equipamento</th></tr></thead>
        <tbody>${/* html */ trsRes}</tbody>
      </table></div>
    </div>`;
}

const ERT_COLUNAS = ["Data", "Estaca", "Estaca do projeto", "Diâmetro (mm)", "Inicial (m)", "Final (m)", "Prof. (m)", "Inclinação", "Classificação",
  "Ferramenta", "RDO", "BM", "Bloco", "Equipamento", "Período"];
function _ertValores(l){
  return [l.data, l.campo, l.projeto, l.diametro, l.inicial, l.final, l.prof, l.inclinacao, l.classificacao,
    ERT_FERRAMENTAS[l.ferramenta] || l.ferramenta, l.rdo, l.bm, l.bloco, l.eqp, l.periodo];
}
function _ertArquivo(ext){ return `trechos-raiz-${String(obraEditId || "obra").slice(0, 8)}-${hojeISO()}.${ext}`; }
function ertExportarCSV(){
  const cel = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const csv = [ERT_COLUNAS.map(cel).join(";")].concat(_ertLinhas.map(l => _ertValores(l).map(cel).join(";"))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = _ertArquivo("csv");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function ertExportarExcel(){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "A biblioteca de planilhas não carregou; use o CSV.", "erro"); return; }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([ERT_COLUNAS.slice()].concat(_ertLinhas.map(_ertValores)));
  ws["!cols"] = ERT_COLUNAS.map(t => ({ wch: Math.max(9, Math.min(24, t.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, "Trechos");
  const wr = XLSX.utils.aoa_to_sheet([["Estaca", "Estaca do projeto", "Prof. máx. (m)", "Equipamento"]].concat(_ertResumo.map(r => [r.campo, r.projeto, r.profMax, r.eqp])));
  XLSX.utils.book_append_sheet(wb, wr, "Resumo por estaca");
  XLSX.writeFile(wb, _ertArquivo("xlsx"));
}

/* ====================================================================
   CONFERÊNCIA DA RAIZ (aba Alteradas)
   ==================================================================== */
let _crzFiltro = "todas";
let _crzBusca = "";

/* Lê o que a conferência da raiz precisa além das execuções da obra: os trechos de solo e as execuções de outra obra
   ligadas a estacas desta. Só roda em obra com estaca raiz. */
async function crzCarregarExtras(obraId){
  const [sRes, oRes] = await Promise.all([
    lerTudo(() => sb.from("rdo_raiz_solo").select("id,execucao_id,ordem,inicio_ml,final_ml,ferramenta,classificacao,rdo:rdo_id!inner(obra_id)").eq("rdo.obra_id", obraId)),
    lerTudo(() => sb.from("rdo_execucao_estaca")
      .select("id,estaca_id,estaca_numero,estaca_numero_corrigido,perfuracao_inicio,perfuracao_de_m,perfuracao_ate_m,profundidade_executada,volume_concreto_m3,modalidade_execucao,etapa_final,ferramental,numero_boletim_fisico,equipamento_id,maquina_codigo,rdo:rdo_id!inner(id,obra_id,data,equipamento_id),estaca:estaca_id!inner(obra_id)")
      .eq("estaca.obra_id", obraId).neq("rdo.obra_id", obraId))
  ]);
  const solo = new Map();
  (sRes.error ? [] : (sRes.data || [])).forEach(s => { if(!solo.has(s.execucao_id)) solo.set(s.execucao_id, []); solo.get(s.execucao_id).push(s); });
  const outras = (oRes.error ? [] : (oRes.data || [])).map(x => ({ ...x, rdo_id: x.rdo?.id, obra_id: x.rdo?.obra_id, data: x.rdo?.data, rdo_equipamento_id: x.rdo?.equipamento_id }));
  return { solo, outras, erro: sRes.error || oRes.error || null };
}
/* Prepara a execução para a classificação: máquina, RDO e trechos */
function crzPrepararExec(x, solo){
  x.maquina = typeof estvMaquina === "function" ? estvMaquina(x) : (x.maquina_codigo || "");
  x.rdo_num = x.numero_boletim_fisico || "";
  x._solo = (solo && solo.get(x.id)) || [];
  return x;
}

function crzRender(cont, grupos){
  if(!cont) return;
  const ordSit = (g) => CRZ_ORDEM.indexOf(g.raiz.situacao);
  const lista = grupos.slice().sort((a, b) => ordSit(a) - ordSit(b) || String(a.estaca.numero || "").localeCompare(String(b.estaca.numero || ""), "pt-BR", { numeric: true }));
  const cont1 = (s) => lista.filter(g => g.raiz.situacao === s).length;
  const kpis = `<div class="ui-kpis crz-kpis">
      ${uiKpi(String(lista.length), "Estacas analisadas", "raiz com 2 ou mais execuções ou com alerta")}
      ${uiKpi(String(cont1("normal")), "Histórico normal")}
      ${uiKpi(String(cont1("etapa")), "Verificar etapa")}
      ${uiKpi(String(cont1("duplicidade")), "Possível duplicidade")}
      ${uiKpi(String(cont1("vinculo")), "Corrigir vínculo")}
    </div>`;
  const filtros = [["todas", "Todas"], ["atencao", "Precisam de atenção"], ["normal", "Histórico normal"], ["etapa", "Verificar etapa"], ["duplicidade", "Possível duplicidade"], ["vinculo", "Corrigir vínculo"]];
  const barra = `<div class="crz-barra">
      <div class="serv-views">${filtros.map(([v, t]) => `<button type="button" class="serv-view-btn${_crzFiltro === v ? " ativo" : ""}" data-crz-filtro="${esc(v)}">${esc(t)}</button>`).join("")}</div>
      <input id="crz-busca" placeholder="Buscar estaca..." value="${esc(_crzBusca)}" title="Parte do nome de campo ou do projeto">
    </div>`;
  cont.innerHTML = `<p class="nota crz-nota">Estaca raiz: várias execuções na mesma estaca são normais (dias, ferramentas e etapas diferentes). A profundidade é a <strong>máxima</strong> entre os trechos, nunca a soma; revestimento e rocha são somas.</p>
    ${/* html */ kpis}${/* html */ barra}<div id="crz-cartoes"></div>`;
  cont.querySelectorAll("[data-crz-filtro]").forEach(b => b.addEventListener("click", () => { _crzFiltro = b.dataset.crzFiltro; crzRender(cont, grupos); }));
  const busca = $("crz-busca");
  if(busca) busca.addEventListener("input", (typeof debounce === "function" ? debounce : (fn) => fn)(() => { _crzBusca = busca.value; crzRenderCartoes(lista); }));
  crzRenderCartoes(lista);
}

function crzRenderCartoes(lista){
  const box = $("crz-cartoes");
  if(!box) return;
  const termo = _crzNorm(_crzBusca);
  const vis = lista.filter(g => (_crzFiltro === "todas" || (_crzFiltro === "atencao" ? g.raiz.situacao !== "normal" : g.raiz.situacao === _crzFiltro))
    && (!termo || `${g.raiz.camposTxt} ${_crzNorm(g.estaca.numero)}`.includes(termo)));
  if(!vis.length){ box.innerHTML = `<p class="vazio">Nenhuma estaca raiz neste filtro.</p>`; return; }
  const f2 = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const prevs = (typeof _recPrevs !== "undefined" ? _recPrevs : []) || [];
  box.innerHTML = vis.map(g => {
    const r = g.raiz, e = g.estaca, sit = CRZ_SITUACOES[r.situacao];
    const optsPrev = prevs.filter(p => p.id !== e.id && p.status === "prevista").map(p => `<option value="${esc(p.id)}">${esc(p.numero)}</option>`).join("");
    // histórico por dia: data, RDO, máquina, etapa, ferramenta, início, fim, metragem; ações na primeira linha da execução
    const dias = new Map();
    r.linhas.forEach(l => { const d = l.data || ""; if(!dias.has(d)) dias.set(d, []); dias.get(d).push(l); });
    const vistas = new Set();
    const linhasHist = [...dias.entries()].map(([d, ls]) => {
      const tot = _crzR2(ls.filter(l => l.perfuracao).reduce((s, l) => s + Math.max(0, l.metragem || 0), 0));
      return `<tr class="crz-dia"><td colspan="9"><strong>${esc(d ? dataBR(d) : "Sem data")}</strong> <span class="meta">${esc(ls.length)} registro(s)${tot ? " · " + esc(f2(tot)) + " m" : ""}</span></td></tr>`
        + ls.map(l => {
          const prim = !vistas.has(l.exec_id); vistas.add(l.exec_id);
          const acoes = prim ? `${l.rdo_id ? `<button type="button" class="btn-sec btn-sm crz-abrir-rdo" data-rdo="${esc(l.rdo_id)}">Abrir RDO</button>` : ""}
              ${optsPrev ? `<select class="alt-realoc-sel" data-exec-id="${esc(l.exec_id)}" title="Estaca prevista para onde levar esta execução"><option value="">— manter aqui —</option>${/* html */ optsPrev}</select>
                <button type="button" class="btn-sec btn-sm btn-alt-realocar" data-exec-id="${esc(l.exec_id)}" data-estaca-orig="${esc(e.id)}">Realocar</button>` : ""}
              <details class="crz-menu"><summary title="Mais ações">⋯</summary><button type="button" class="btn-sec btn-sm btn-alt-marcar-refuro" data-exec-id="${esc(l.exec_id)}" title="Só quando esta execução for um refuro de verdade">Marcar refuro</button></details>` : "";
          return `<tr class="${l.alerta ? "crz-alerta-" + esc(l.alerta) : ""}">
            <td>${esc(l.refuro ? "Refuro" : l.perfuracao ? "Perfuração" : "Sem metragem")}</td>
            <td><span class="ui-codigo">${esc(l.rdo_num || "—")}</span></td>
            <td>${esc(l.maquina || "—")}</td>
            <td>${esc(l.etapa || "—")}</td>
            <td>${esc(ERT_FERRAMENTAS[l.ferramenta] || l.ferramenta || "—")}</td>
            <td class="num">${esc(f2(l.inicio))}</td>
            <td class="num">${esc(f2(l.fim))}</td>
            <td class="num">${esc(f2(l.metragem))}</td>
            <td>${acoes ? `<div class="crz-acoes">${/* html */ acoes}</div>` : ""}</td>
          </tr>`;
        }).join("");
    }).join("");
    return `<div class="crz-card crz-${esc(r.situacao)}">
      <div class="crz-cab">
        <strong>${esc(r.camposTxt || e.numero)}</strong>
        <span class="crz-sit crz-sit-${esc(r.situacao)}" title="${esc(sit.dica)}">${esc(sit.rotulo)}</span>
        <span class="meta">projeto <strong>${esc(e.numero || "—")}</strong>${e.bloco ? " · " + esc(e.bloco) : ""}${e.local ? " · " + esc(e.local) : ""}</span>
      </div>
      <div class="crz-nums">
        <span>${esc(r.maquinas.join(", ") || "sem máquina")}</span>
        <span><strong>${esc(r.dias)}</strong> dia(s)</span>
        <span><strong>${esc(r.registros)}</strong> registro(s)</span>
        <span title="Maior final entre os trechos de furo (nunca a soma)">prof. máx. <strong>${esc(f2(r.profMax))} m</strong></span>
        <span>revestimento <strong>${esc(f2(r.revestimento))} m</strong></span>
        <span title="Tricone e martelo">rocha <strong>${esc(f2(r.rocha))} m</strong></span>
        <span>refuro <strong>${esc(f2(r.refuro))} m</strong></span>
      </div>
      ${r.motivos.length ? `<ul class="crz-motivos">${r.motivos.map(m => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
      <details class="crz-hist"${r.situacao !== "normal" ? " open" : ""}>
        <summary>Histórico por dia (${esc(r.linhas.length)} linha(s))</summary>
        <div class="tabela-rola"><table class="raiz-tabela crz-tabela">
          <thead><tr><th>Tipo</th><th>RDO</th><th>Máquina</th><th>Etapa</th><th>Ferramenta</th><th class="num">Início (m)</th><th class="num">Fim (m)</th><th class="num">Metragem (m)</th><th>Ações</th></tr></thead>
          <tbody>${/* html */ linhasHist}</tbody>
        </table></div>
      </details>
    </div>`;
  }).join("");
  ligarAcoesAlteradas(box);
}

/* Abrir RDO dos cartões da raiz (Realocar e Marcar refuro usam os mesmos botões da aba, ligados pelo renderizarAlteradas) */
function ligarAcoesAlteradas(cont){
  if(!cont) return;
  cont.querySelectorAll(".crz-abrir-rdo").forEach(b => b.addEventListener("click", () => {
    if(typeof fecharModalReconciliacao === "function") fecharModalReconciliacao();
    if(typeof abrirRdoExistente === "function") abrirRdoExistente(b.dataset.rdo);
  }));
  cont.querySelectorAll(".btn-alt-realocar").forEach(b => b.addEventListener("click", () => realocarExecucao(b.dataset.execId, b.dataset.estacaOrig)));
  cont.querySelectorAll(".btn-alt-marcar-refuro").forEach(b => b.addEventListener("click", () => marcarComoRefuro(b.dataset.execId)));
}

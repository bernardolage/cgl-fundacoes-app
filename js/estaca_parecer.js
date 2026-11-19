/* ====================================================================
   Módulo: leitura automática do perfil da estaca do Geodigitus — fase 171a (prefixo epp-)
   Carregado depois de js/estaca_perfil.js. Só leitura: nada é gravado, nada é bloqueado. A leitura é recalculada a cada
   abertura; mudar uma regra (EPP_REGRAS, com versão) muda a leitura de todas.
   - Na janela do perfil (abrirPerfilEstaca): bloco #epp-leitura entre o resumo e o gráfico, com a situação
     (sem indícios, com indícios, não dá para avaliar, furo raso), os indícios e o botão "ver no gráfico" (leva o replay
     ao trecho). Para a regra das vizinhas, uma leitura a mais: chegadas da mesma obra e Ø, só colunas do cabeçalho.
   - Nas Chegadas (js/geodigitus.js): eppFaixaSobre dá a etiqueta "não medido" ou "fora do plausível" no lugar do
     sobreconsumo, e eppMaquinasHTML o bloco #epp-maquinas ("Medição de concreto por máquina").
   eppAvaliacao, eppIndicios, eppLeitura, eppPorMaquina e eppFaixaSobre são puras e testadas por scripts/testar-fase171a.mjs.
   As regras são provisórias (pergunta 1 da spec 171): valem pelo padrão do "Se não responder" desde 18/11/2026.
   ==================================================================== */

const EPP_REGRAS = {
  versao: 1,
  furoRasoM: 2,              // abaixo disso é furo de teste: sem leitura
  plausivelMin: -5,          // sobreconsumo abaixo disso (%) = volume fora do plausível (medição ruim)
  plausivelMax: 60,          // acima disso (%) = volume fora do plausível
  naoMedidoPct: -99.95,      // volume zero dá −100%
  inicioAcimaFundoM: 0.5,    // concretagem começou mais de 0,5 m acima do fundo perfurado
  fundoDifereM: 0.16,        // fundo do perfil × profundidade do cabeçalho (aviso de registro)
  vizinhasMin: 5,            // mínimo de vizinhas (mesma obra e Ø) para a regra 1
  vizinhasPontos: 20,        // distância da mediana, em pontos percentuais (20 exatos não apontam)
  janelaFatias: 12,          // cerca de 1 m de fatias de 8 cm
  janelaPct: 50,             // trecho com volume abaixo de 50% do teórico
  sobreBaixoPct: 5,          // sobreconsumo abaixo de 5%
  esperaMin: 30,             // espera entre o fim da perfuração e o começo da concretagem
  maquinaMin: 3,             // bloco por máquina: 3 ou mais chegadas sem medição ou fora do plausível...
  maquinaPct: 30             // ... e 30% ou mais das chegadas dela
};
const EPP_SITUACAO = {
  sem_indicios: { rotulo: "Sem indícios", cor: "cinza" },
  com_indicios: { rotulo: "Com indícios", cor: "ambar" },
  nao_avaliavel: { rotulo: "Não dá para avaliar", cor: "azul" },
  furo_raso: { rotulo: "Sem leitura", cor: "cinza" }
};

/* ---------- funções puras ---------- */
function eppN(v){
  if(v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function eppMediana(valores){
  const v = valores.filter(x => x != null).slice().sort((a, b) => a - b);
  if(!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
/* faixa do sobreconsumo do cabeçalho: "nao_medido" (volume zero), "implausivel" (fora de −5% a +60%), "ok" ou null */
function eppFaixaSobre(pct, volumeM3){
  const p = eppN(pct), v = eppN(volumeM3);
  if(v === 0 || (p != null && p <= EPP_REGRAS.naoMedidoPct)) return "nao_medido";
  if(p == null) return null;
  if(p < EPP_REGRAS.plausivelMin || p > EPP_REGRAS.plausivelMax) return "implausivel";
  return "ok";
}
function eppProfundidade(linha, passos){
  const l = linha || {};
  return eppN(l.profundidade_m) ?? Math.max(0, ...(passos || []).map(p => p.profundidade_m || 0));
}
function eppSobre(linha, passos){
  const l = linha || {};
  const p = eppN(l.sobreconsumo_pct);
  if(p != null) return p;
  const vol = eppVolume(linha, passos);
  const d = eppN(l.diametro_mm), prof = eppProfundidade(linha, passos);
  return vol != null && d && prof ? (vol / (Math.PI * (d / 2000) ** 2 * prof) - 1) * 100 : null;
}
function eppVolume(linha, passos){
  const v = eppN((linha || {}).volume_concreto_m3);
  if(v != null) return v;
  const medidos = (passos || []).filter(p => p.fase === "concretagem" && p.volume_l != null);
  return medidos.length ? medidos.reduce((s, p) => s + p.volume_l, 0) / 1000 : null;
}
/* fundo perfurado e começo da concretagem (o ponto mais fundo de cada fase) */
function eppFundos(passos){
  const prof = (fase) => (passos || []).filter(p => p.fase === fase && p.profundidade_m != null).map(p => p.profundidade_m);
  const perf = prof("perfuracao"), conc = prof("concretagem");
  return { furo: perf.length ? Math.max(...perf) : null, concreto: conc.length ? Math.max(...conc) : null };
}
const eppM = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";
const eppPct = (v, casas = 1) => (v > 0 ? "+" : "") + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: casas }) + "%";

/* Avaliação: dá para ler esta estaca? Primeiro furo raso (ou chegada ignorada), depois o concreto medido. */
function eppAvaliacao(linha, passos){
  const l = linha || {}, R = EPP_REGRAS;
  const prof = eppProfundidade(l, passos);
  const r = { avaliavel: false, furo_raso: false, concreto_nao_medido: false, volume_implausivel: false, motivos: [], avisos: [],
    sobreconsumo_pct: eppSobre(l, passos), profundidade_m: prof };
  if(l.situacao === "ignorada"){ r.furo_raso = true; r.motivos.push("Chegada ignorada: não entra na leitura."); return r; }
  if(prof == null || prof < R.furoRasoM){
    r.furo_raso = true;
    r.motivos.push(`Furo de ${prof == null ? "profundidade desconhecida" : eppM(prof)}, abaixo de ${eppM(R.furoRasoM)}: parece teste de máquina, sem leitura.`);
    return r;
  }
  const faixa = eppFaixaSobre(r.sobreconsumo_pct, eppVolume(l, passos));
  if(faixa === "nao_medido"){
    r.concreto_nao_medido = true;
    r.motivos.push("Nenhum litro de concreto foi medido. Confira o sensor de pulsos da bomba desta máquina.");
  } else if(faixa === "implausivel"){
    r.volume_implausivel = true;
    r.motivos.push(`Sobreconsumo de ${eppPct(r.sobreconsumo_pct)}, fora da faixa plausível (${eppPct(R.plausivelMin, 0)} a ${eppPct(R.plausivelMax, 0)}). Confira os litros por pulso da bomba e o Ø digitado no computador de bordo.`);
  } else if(faixa == null){
    r.concreto_nao_medido = true;
    r.motivos.push("Sem volume nem sobreconsumo no registro: não dá para comparar com o teórico.");
  }
  // registro incompleto: aparece como motivo junto dos de cima, ou como aviso quando a estaca é avaliável
  const f = eppFundos(passos);
  const notas = [];
  if(f.furo != null && f.concreto != null && f.furo - f.concreto > R.inicioAcimaFundoM){
    notas.push(`A concretagem começou ${eppM(f.furo - f.concreto)} acima do fundo perfurado.`);
  }
  const lprof = eppN(l.profundidade_m);
  if(f.furo != null && lprof != null && Math.abs(f.furo - lprof) > R.fundoDifereM){
    notas.push(`O fundo do perfil (${eppM(f.furo)}) difere da profundidade do cabeçalho (${eppM(lprof)}).`);
  }
  r.avaliavel = !r.concreto_nao_medido && !r.volume_implausivel;
  if(r.avaliavel) r.avisos = notas.filter(n => n.startsWith("O fundo"));
  else r.motivos.push(...notas.map(n => "Registro incompleto: " + n.charAt(0).toLowerCase() + n.slice(1)));
  return r;
}

/* Trechos com pouco concreto: janelas de 12 fatias seguidas da concretagem com volume abaixo de 50% do teórico.
   Fatia sem volume conta zero (o pulso cai na fatia vizinha); janelas que se encostam viram um trecho só. */
function eppTrechos(passos, diametroMm){
  const R = EPP_REGRAS, d = eppN(diametroMm);
  if(!d) return [];
  const teoricoFatia = Math.PI * (d / 2000) ** 2 * 0.08 * 1000;
  const conc = (passos || []).filter(p => p.fase === "concretagem" && p.profundidade_m != null)
    .slice().sort((a, b) => b.profundidade_m - a.profundidade_m);   // do fundo ao topo
  const n = R.janelaFatias, trechos = [];
  if(conc.length < n) return trechos;
  let atual = null;
  for(let i = 0; i + n <= conc.length; i++){
    const janela = conc.slice(i, i + n);
    const vol = janela.reduce((s, p) => s + (p.volume_l || 0), 0);
    const pct = vol / (teoricoFatia * n) * 100;
    if(pct < R.janelaPct){
      if(atual && i <= atual.fim){ atual.fim = i + n - 1; atual.minPct = Math.min(atual.minPct, pct); }
      else { atual = { ini: i, fim: i + n - 1, minPct: pct }; trechos.push(atual); }
    }
  }
  return trechos.map(t => {
    const fundo = conc[t.ini], topo = conc[t.fim];
    return { de_m: topo.profundidade_m, ate_m: fundo.profundidade_m, menor_pct: t.minPct, indice: fundo.indice };
  });
}
/* vizinhas: chegadas da mesma obra e Ø (sem a própria), só as avaliáveis entram na mediana */
function eppVizinhas(linha, vizinhas){
  const R = EPP_REGRAS, l = linha || {};
  const validas = (vizinhas || []).filter(v => v && v.id !== l.id && v.situacao !== "ignorada"
    && (eppN(v.profundidade_m) ?? 0) >= R.furoRasoM && eppFaixaSobre(v.sobreconsumo_pct, v.volume_concreto_m3) === "ok");
  const mediana = eppMediana(validas.map(v => eppN(v.sobreconsumo_pct)));
  return { n: validas.length, mediana, avaliado: !!l.obra_id && validas.length >= R.vizinhasMin };
}

/* Indícios (só para estaca avaliável): cada um com a regra, o valor medido, o limite e, quando houver, o trecho. */
function eppIndicios(linha, passos, vizinhas){
  const R = EPP_REGRAS, l = linha || {}, lista = [];
  const sobre = eppSobre(l, passos);
  const viz = eppVizinhas(l, vizinhas);
  if(viz.avaliado && sobre != null && Math.abs(sobre - viz.mediana) > R.vizinhasPontos){
    lista.push({ regra: "vizinhas", nome: "Fora do padrão das vizinhas", valor: `${eppPct(sobre)} contra a mediana de ${eppPct(viz.mediana)} (${viz.n} vizinhas da mesma obra e Ø)`,
      limite: `${R.vizinhasPontos} pontos da mediana` });
  }
  eppTrechos(passos, l.diametro_mm).forEach(t => {
    lista.push({ regra: "trecho", nome: "Trecho com pouco concreto", valor: `de ${eppM(t.de_m)} a ${eppM(t.ate_m)}: ${Number(t.menor_pct).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% do teórico`,
      limite: `abaixo de ${R.janelaPct}% em ${R.janelaFatias} fatias seguidas (cerca de 1 m)`, trecho: t, indice: t.indice });
  });
  if(sobre != null && sobre < R.sobreBaixoPct){
    lista.push({ regra: "sobre_baixo", nome: "Sobreconsumo baixo", valor: eppPct(sobre), limite: `abaixo de ${eppPct(R.sobreBaixoPct, 0)}` });
  }
  const f = eppFundos(passos);
  if(f.furo != null && f.concreto != null && f.furo - f.concreto > R.inicioAcimaFundoM){
    const ini = (passos || []).find(p => p.fase === "concretagem");
    lista.push({ regra: "inicio_acima", nome: "Concretagem começou acima do fundo", valor: `${eppM(f.furo - f.concreto)} acima do fundo perfurado (${eppM(f.furo)})`,
      limite: `mais de ${eppM(R.inicioAcimaFundoM)}`, indice: ini ? ini.indice : null });
  }
  const fimPerf = Date.parse(l.perfuracao_fim || ""), iniConc = Date.parse(l.concretagem_inicio || "");
  if(Number.isFinite(fimPerf) && Number.isFinite(iniConc)){
    const min = (iniConc - fimPerf) / 60000;
    if(min > R.esperaMin) lista.push({ regra: "espera", nome: "Espera longa entre perfuração e concretagem", valor: `${Math.round(min)} min`, limite: `mais de ${R.esperaMin} min` });
  }
  return lista;
}

/* Leitura: junta avaliação e indícios. "Não dá para avaliar" vem antes de qualquer indício e não conta como indício. */
function eppLeitura(linha, passos, vizinhas){
  const avaliacao = eppAvaliacao(linha, passos);
  const vizinhasInfo = eppVizinhas(linha, vizinhas);
  if(avaliacao.furo_raso) return { situacao: "furo_raso", versao: EPP_REGRAS.versao, avaliacao, indicios: [], vizinhas: vizinhasInfo };
  if(!avaliacao.avaliavel) return { situacao: "nao_avaliavel", versao: EPP_REGRAS.versao, avaliacao, indicios: [], vizinhas: vizinhasInfo };
  const indicios = eppIndicios(linha, passos, vizinhas);
  return { situacao: indicios.length ? "com_indicios" : "sem_indicios", versao: EPP_REGRAS.versao, avaliacao, indicios, vizinhas: vizinhasInfo };
}

/* Por computador de bordo: quantas chegadas (fora as ignoradas e o furo raso), quantas sem medição e quantas fora do
   plausível. Só lista a máquina com 3 ou mais nessas duas situações e que sejam 30% ou mais das chegadas dela. */
function eppPorMaquina(chegadas){
  const R = EPP_REGRAS, mapa = new Map();
  (chegadas || []).forEach(g => {
    if(!g || g.situacao === "ignorada" || (eppN(g.profundidade_m) ?? 0) < R.furoRasoM) return;
    const chave = g.equipamento_id || "cpu:" + (g.arquivo?.imei || g.computador_id || "?");
    const nome = g.equipamento?.codigo || "CPU " + (g.arquivo?.imei || "?");
    const m = mapa.get(chave) || { chave, nome, total: 0, sem_medicao: 0, fora: 0 };
    m.total++;
    const faixa = eppFaixaSobre(g.sobreconsumo_pct, g.volume_concreto_m3);
    if(faixa === "nao_medido") m.sem_medicao++;
    else if(faixa === "implausivel") m.fora++;
    mapa.set(chave, m);
  });
  return [...mapa.values()]
    .filter(m => m.sem_medicao + m.fora >= R.maquinaMin && (m.sem_medicao + m.fora) * 100 / m.total >= R.maquinaPct)
    .sort((a, b) => (b.sem_medicao + b.fora) - (a.sem_medicao + a.fora) || a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
}

/* ---------- tela ---------- */
function eppTagSituacao(situacao){
  const s = EPP_SITUACAO[situacao] || EPP_SITUACAO.nao_avaliavel;
  return `<span class="tag ${esc(s.cor)}">${esc(s.rotulo)}</span>`;
}
function eppLeituraHTML(lt){
  const R = EPP_REGRAS;
  const linhas = [];
  if(lt.situacao === "furo_raso" || lt.situacao === "nao_avaliavel"){
    lt.avaliacao.motivos.forEach(m => linhas.push(`<div class="epp-item">${/* html */ uiLinhaItem(lt.situacao === "furo_raso" ? "Sem leitura" : "Não dá para avaliar", m)}</div>`));
  } else if(!lt.indicios.length){
    linhas.push(uiVazio("Nenhuma regra apontou indício nesta estaca."));
  } else {
    lt.indicios.forEach(i => linhas.push(`<div class="epp-item">${/* html */ uiLinhaItem(i.nome, i.valor)}
      <div class="epp-item-pe"><span class="meta">${esc("Limite: " + i.limite)}</span>${i.indice != null ? `<button type="button" class="btn-sec btn-sm" data-epp-ir="${esc(i.indice)}" title="Leva o marcador do replay ao começo do trecho">Ver no gráfico</button>` : ""}</div></div>`));
  }
  (lt.avaliacao.avisos || []).forEach(a => linhas.push(`<p class="meta">Aviso de registro: ${esc(a)}</p>`));
  if(lt.situacao === "sem_indicios" || lt.situacao === "com_indicios"){
    const v = lt.vizinhas;
    linhas.push(`<p class="meta">${v.avaliado
      ? esc(`Vizinhas: ${v.n} chegadas avaliáveis da mesma obra e Ø, mediana de ${eppPct(v.mediana)}.`)
      : esc(`Regra das vizinhas não avaliada: ${v.n} chegada(s) avaliável(is) da mesma obra e Ø, são precisas ${R.vizinhasMin}${(v.n === 0) ? " (ou a chegada está sem obra)" : ""}.`)}</p>`);
  }
  linhas.push(`<p class="meta epp-aviso">Leitura automática por regras provisórias (versão ${esc(lt.versao)}). Não substitui a conferência do engenheiro e não muda nada no diário nem na estaca.</p>`);
  return uiSecao("check", "Leitura automática do perfil", `<div class="epp-situacao">${/* html */ eppTagSituacao(lt.situacao)}</div>${/* html */ linhas.join("")}`);
}
let _eppPedido = 0;
/* chamada por abrirPerfilEstaca depois de desenhar a janela; lê as vizinhas (só colunas do cabeçalho) e preenche #epp-leitura */
async function eppMostrarLeitura(linha, passos){
  const alvo = $("epp-leitura"); if(!alvo || !linha) return;
  const pedido = ++_eppPedido;
  let vizinhas = [];
  const precisaVizinhas = linha.obra_id && linha.diametro_mm != null && eppAvaliacao(linha, passos).avaliavel;
  if(precisaVizinhas){
    alvo.innerHTML = `<p class="meta">Lendo as vizinhas da mesma obra e Ø…</p>`;
    const r = await lerTudo(() => sb.from("geodigitus_estacas").select("id,sobreconsumo_pct,profundidade_m,situacao,volume_concreto_m3")
      .eq("obra_id", linha.obra_id).eq("diametro_mm", linha.diametro_mm), { chave: "id" });
    if(pedido !== _eppPedido || !$("epp-leitura")) return;
    if(r.error){ alvo.innerHTML = uiSecao("check", "Leitura automática do perfil", uiErro("Não foi possível ler as vizinhas: " + r.error.message)); return; }
    vizinhas = r.data || [];
  }
  alvo.innerHTML = eppLeituraHTML(eppLeitura(linha, passos, vizinhas));
}

/* bloco "Medição de concreto por máquina" nas Chegadas (só com o que a lista já leu) */
function eppMaquinasHTML(chegadas){
  const lista = eppPorMaquina(chegadas);
  if(!lista.length) return "";
  const linhas = lista.map(m => {
    const partes = [];
    if(m.sem_medicao) partes.push(`${m.sem_medicao} sem medição de concreto`);
    if(m.fora) partes.push(`${m.fora} com volume fora do plausível`);
    return `<div class="epp-maquina">${/* html */ uiCodigo(m.nome)}<span>${esc(`${partes.join(" e ")}, de ${m.total} estaca(s). Confira o sensor de pulsos e os litros por pulso da bomba.`)}</span></div>`;
  }).join("");
  return `<div id="epp-maquinas">${/* html */ uiSecao("maquina", "Medição de concreto por máquina", linhas + `<p class="meta">Leitura automática por regras provisórias (versão ${esc(EPP_REGRAS.versao)}): o problema é da máquina, não da estaca.</p>`)}</div>`;
}

function ligarEstacaParecer(){
  $("epf-corpo")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-epp-ir]");
    if(b && typeof epfIrPara === "function"){ epfPararReplay(); epfIrPara(Number(b.dataset.eppIr)); $("epf-barra")?.focus(); }
  });
}
if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarEstacaParecer);
  else ligarEstacaParecer();
}
// teste em Node (scripts/testar-fase171a.mjs)
if(typeof module === "object" && module && module.exports){
  module.exports = { EPP_REGRAS, eppFaixaSobre, eppAvaliacao, eppIndicios, eppLeitura, eppPorMaquina, eppTrechos, eppVizinhas, eppMediana };
}

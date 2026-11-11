/* ====================================================================
   js/estacas_prof_projeto.js — profundidade de projeto das estacas: por onde o dado entra (prefixo epj-).
   Carregado depois do js/estacas.js, que chama três ganchos daqui:
     - renderEstacas          -> epjLinha(_estacas): a linha de estado abaixo dos indicadores da aba Estacas;
     - renderImportPreview    -> epjImportBloco(contId): a caixa "Atualizar a profundidade de projeto das que já existem";
     - confirmarImportEstacas -> epjImportMarcado() e epjImportGravar(): a gravação dessa caixa.
   Duas portas, uma fonte só (estacas.profundidade_m):
     1. a janela "Profundidade de projeto": um valor por grupo de estacas (Ø, Ø e local, ou Ø, local e bloco);
     2. a lista da importação (planilha, colar do Excel ou leitura do PDF): um valor por estaca que já existe.
   Este arquivo não lê nem grava tabela: usa as estacas que a aba já carregou (_estacas) e grava só pelas RPCs
   estacas_definir_profundidade_projeto e estacas_atualizar_profundidade_lista, sempre com a prévia do banco na tela antes.
   Sem a RPC no banco, o botão avisa que o recurso ainda não está disponível e nada quebra.
   Estaca Refurada fica fora de todas as contas. Valor "a confirmar" (a executada copiada) não conta como projeto.
   Estaca executada sem profundidade executada nunca recebe o valor em lote (o banco pula): a profundidade real dela ainda vai
   ser lançada, e o projeto por cima faria a metragem executada contar um número que não foi medido. A prévia diz quantas são.
   As funções puras saem também por module.exports, para o teste em Node (scripts/testar-fase170a.mjs).
   ==================================================================== */
const EPJ_CARGOS_EDITAM = ["diretor", "admin", "engenheiro", "assistente_engenharia"];   // a mesma lista da RPC (a diretoria entra por has_role no banco)
const EPJ_MODOS = [["vazias", "Só as vazias"], ["vazias_e_a_confirmar", "Vazias e a confirmar"], ["todas", "Todas do grupo"]];
const EPJ_AGRUPAR = ["diametro", "local", "bloco"];
const EPJ_INDISPONIVEL = "Informar a profundidade de projeto em lote ainda não está disponível. Tente de novo depois da próxima atualização do sistema.";
const EPJ_LIMITE_LISTA = 2000;      // itens por chamada da RPC da lista
const EPJ_AVISO_EXECUCOES = 20;     // acima disso, a prévia manda conferir com a diretoria antes de gravar
const EPJ_MAX_DIFERENTES = 50;      // linhas da tabela de valores diferentes na importação

/* ---------- quem pode ---------- */
function epjPodeEditarCargo(cargo, somenteLeitura){
  return !somenteLeitura && EPJ_CARGOS_EDITAM.includes(String(cargo || ""));
}
function epjPodeEditar(){
  if(typeof usuarioAtual === "undefined" || !usuarioAtual) return false;
  return epjPodeEditarCargo(usuarioAtual.cargo, typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
}

/* ---------- números e textos ---------- */
function epjNumero(v){
  if(v == null || typeof v === "boolean" || typeof v === "object") return null;
  if(typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).trim().replace(",", ".");
  if(t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/* profundidade aceita: maior que zero e de até 100 m, com duas casas (a mesma regra da RPC); senão, null */
function epjValidarProfundidade(v){
  const n = epjNumero(v);
  if(n == null || n > 100) return null;
  const r = Number(n.toFixed(2));
  return r > 0 ? r : null;
}
function epjInt(n){ return Number(n || 0).toLocaleString("pt-BR"); }
function epjMetros(v){ return Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " m"; }
function epjPl(n, um, varios){ return Number(n) === 1 ? um : varios; }
function epjTemProjeto(e){ const n = epjNumero(e && e.profundidade_m); return n != null && n > 0; }
/* a mesma regra do banco: status executada e profundidade executada nula (zero é execução lançada sem profundidade, não entra) */
function epjSemExecutada(e){ return !!e && e.status === "executada" && e.profundidade_executada_m == null; }
function epjNormNumero(s){ return String(s || "").toUpperCase().trim().replace(/\s+/g, " "); }
const _epjOrdem = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/* ---------- linha de estado ---------- */
/* Refurada fora; "a confirmar" não é projeto (decisão 3 da spec) */
function epjEstado(estacas){
  const s = { total: 0, comProjeto: 0, aConfirmar: 0, semProjeto: 0, pct: 0 };
  for(const e of (Array.isArray(estacas) ? estacas : [])){
    if(!e || e.status === "refugada") continue;
    s.total++;
    if(!epjTemProjeto(e)) s.semProjeto++;
    else if(e.projeto_pendente) s.aConfirmar++;
    else s.comProjeto++;
  }
  s.pct = s.total ? Math.round(s.comProjeto / s.total * 100) : 0;
  return s;
}
function epjEstadoTexto(s){
  if(!s || !s.total) return "";
  return `Profundidade de projeto: ${epjInt(s.comProjeto)} de ${epjInt(s.total)} ${epjPl(s.total, "estaca", "estacas")} (${s.pct}%)${s.aConfirmar ? ` · ${epjInt(s.aConfirmar)} a confirmar` : ""}`;
}

/* ---------- grupos da janela ---------- */
/* modo: "diametro" (padrão), "local" (Ø e local) ou "bloco" (Ø, local e bloco). Espaço nas pontas não separa grupo.
   Cada grupo: total, com projeto, a confirmar, vazias e o menor e o maior valor confirmado que já existem. */
function epjAgrupar(estacas, modo){
  const nivel = modo === "bloco" ? 2 : modo === "local" ? 1 : 0;
  const mapa = new Map();
  for(const e of (Array.isArray(estacas) ? estacas : [])){
    if(!e || e.status === "refugada") continue;
    const d = epjNumero(e.diametro_mm), diam = d != null && d > 0 ? d : null;
    const local = nivel >= 1 ? String(e.local || "").trim() : null;
    const bloco = nivel >= 2 ? String(e.bloco || "").trim() : null;
    const chave = JSON.stringify([diam, local, bloco]);
    let g = mapa.get(chave);
    if(!g){
      g = { chave, diametro: diam == null ? "" : diam, semDiametro: diam == null, local, bloco, total: 0, comProjeto: 0, aConfirmar: 0, vazias: 0, min: null, max: null };
      mapa.set(chave, g);
    }
    g.total++;
    if(!epjTemProjeto(e)) g.vazias++;
    else if(e.projeto_pendente) g.aConfirmar++;
    else {
      const p = epjNumero(e.profundidade_m);
      g.comProjeto++;
      g.min = g.min == null ? p : Math.min(g.min, p);
      g.max = g.max == null ? p : Math.max(g.max, p);
    }
  }
  const txt = (a, b) => (a === b ? 0 : a === "" ? 1 : b === "" ? -1 : _epjOrdem.compare(a, b));   // vazio (sem local, sem bloco) por último
  return [...mapa.values()].sort((a, b) =>
    (a.semDiametro - b.semDiametro) || (Number(a.diametro) - Number(b.diametro)) || txt(a.local || "", b.local || "") || txt(a.bloco || "", b.bloco || ""));
}
/* o filtro que a RPC recebe: chave ausente = qualquer; texto vazio = sem local ou sem bloco; Ø nulo = sem Ø */
function epjFiltroDoGrupo(g){
  const f = { diametro_mm: g.semDiametro ? null : Number(g.diametro) };
  if(g.local != null) f.local = g.local;
  if(g.bloco != null) f.bloco = g.bloco;
  return f;
}
function epjRotuloBloco(rotBloco){ return String(rotBloco || "Bloco"); }
function epjRotuloGrupo(g, rotBloco){
  const rb = epjRotuloBloco(rotBloco);
  const partes = [g.semDiametro ? "sem Ø" : `Ø ${epjInt(g.diametro)} mm`];
  if(g.local != null) partes.push(g.local || "sem local");
  if(g.bloco != null) partes.push(g.bloco ? `${rb} ${g.bloco}` : `sem ${rb.toLowerCase()}`);
  return partes.join(" · ");
}
function epjModoPadrao(g){ return g && g.aConfirmar > 0 ? "vazias_e_a_confirmar" : "vazias"; }

/* ---------- prévia (resposta da RPC em palavras) ---------- */
/* "de quanto": os valores de hoje das estacas que mudam, do mais comum para o menos; "vazia" não entra */
function epjValoresDeHoje(valores){
  return Object.entries(valores && typeof valores === "object" ? valores : {})
    .filter(([k]) => k !== "vazia" && epjNumero(k) != null)
    .sort((a, b) => (Number(b[1]) - Number(a[1])) || (Number(a[0]) - Number(b[0])))
    .map(([k, q]) => `${epjInt(q)} de ${epjMetros(Number(k))}`);
}
/* frases comuns às duas portas: o que a mudança faz fora da lista de estacas */
function epjFrasesEfeito(r){
  const n = (k) => Number(r[k]) || 0, frases = [];
  const ex = n("execucoes_sem_profundidade");
  if(ex) frases.push(`${epjInt(ex)} ${epjPl(ex, "execução sem profundidade executada passa", "execuções sem profundidade executada passam")} a contar esta profundidade na prévia da medição.`
    + (ex > EPJ_AVISO_EXECUCOES ? " É bastante: confira com a diretoria antes de gravar." : ""));
  return frases;
}
/* estaca executada sem profundidade executada: o banco pula em qualquer modo; a frase diz quantas e por quê */
function epjFraseSemExecutada(r){
  const ee = Number(r && r.executadas_sem_profundidade) || 0;
  return ee ? `${epjInt(ee)} ${epjPl(ee, "executada sem profundidade executada fica de fora", "executadas sem profundidade executada ficam de fora")}: falta lançar a profundidade real.` : "";
}
/* prévia da janela: quantas mudam, de quanto para quanto, quantas ficam como estão e por quê */
function epjPreviaFrases(r){
  if(!r || typeof r !== "object") return [];
  const n = (k) => Number(r[k]) || 0;
  const af = n("afetadas"), vaz = n("vazias"), cor = n("a_confirmar_corrigidas"), tro = n("trocadas"), ja = n("ja_preenchidas"), ref = n("refuradas_fora");
  const fica = Math.max(n("a_confirmar") - cor, 0), para = epjMetros(r.profundidade_m), frases = [];
  if(!af) frases.push("Nenhuma estaca muda com esta escolha.");
  if(vaz) frases.push(`Vai preencher ${epjInt(vaz)} ${epjPl(vaz, "estaca", "estacas")} sem profundidade de projeto com ${para}.`);
  if(cor) frases.push(`${epjInt(cor)} ${epjPl(cor, 'está "a confirmar" e será corrigida', 'estão "a confirmar" e serão corrigidas')} para ${para}.`);
  if(tro) frases.push(`${epjInt(tro)} que já ${epjPl(tro, "tem valor será trocada", "têm valor serão trocadas")} para ${para}.`);
  const de = epjValoresDeHoje(r.valores_anteriores);
  if(de.length && (cor || tro)) frases.push(`Valores de hoje que mudam para ${para}: ${de.join(", ")}.`);
  if(ja) frases.push(r.modo === "todas"
    ? `${epjInt(ja)} já ${epjPl(ja, "tem", "têm")} ${para} e ${epjPl(ja, "fica como está", "ficam como estão")}.`
    : `${epjInt(ja)} já ${epjPl(ja, "tem", "têm")} outro valor e ${epjPl(ja, "fica como está", "ficam como estão")}.`);
  if(fica) frases.push(`${epjInt(fica)} ${epjPl(fica, 'está "a confirmar" e fica como está', 'estão "a confirmar" e ficam como estão')} (para corrigir, escolha "Vazias e a confirmar").`);
  if(ref) frases.push(`${epjInt(ref)} ${epjPl(ref, "Refurada fica fora", "Refuradas ficam fora")}.`);
  if(epjFraseSemExecutada(r)) frases.push(epjFraseSemExecutada(r));
  return af ? frases.concat(epjFrasesEfeito(r)) : frases;
}
/* prévia da lista (importação), com os números do banco */
function epjListaFrases(r){
  if(!r || typeof r !== "object") return [];
  const n = (k) => Number(r[k]) || 0;
  const vaz = n("vazias"), cor = n("a_confirmar_corrigidas"), tro = n("trocadas"), ja = n("ja_preenchidas"), ig = n("iguais"), ref = n("refuradas_fora"), frases = [];
  if(!n("afetadas")) frases.push("Nenhuma estaca que já existe muda.");
  if(vaz) frases.push(`${epjInt(vaz)} ${epjPl(vaz, "recebe", "recebem")} a profundidade de projeto da lista (${epjPl(vaz, "estava", "estavam")} sem valor).`);
  if(cor) frases.push(`${epjInt(cor)} ${epjPl(cor, 'está "a confirmar" e é corrigida', 'estão "a confirmar" e são corrigidas')}.`);
  if(tro) frases.push(`${epjInt(tro)} com valor diferente ${epjPl(tro, "é trocada", "são trocadas")}.`);
  const de = epjValoresDeHoje(r.valores_anteriores);
  if(de.length && (cor || tro)) frases.push(`Valores de hoje que mudam: ${de.join(", ")}.`);
  if(ja) frases.push(`${epjInt(ja)} com valor diferente ${epjPl(ja, "fica como está", "ficam como estão")} (só ${epjPl(ja, "troca", "trocam")} com "sobrescrever").`);
  if(ig) frases.push(`${epjInt(ig)} já ${epjPl(ig, "tem", "têm")} o mesmo valor.`);
  if(ref) frases.push(`${epjInt(ref)} ${epjPl(ref, "Refurada fica fora", "Refuradas ficam fora")}.`);
  if(epjFraseSemExecutada(r)) frases.push(epjFraseSemExecutada(r));
  return n("afetadas") ? frases.concat(epjFrasesEfeito(r)) : frases;
}

/* ---------- lista da importação × estacas que já existem ---------- */
/* A mesma identidade da importação e do banco: local, bloco e número (caixa e espaço nas pontas não separam; BB1.1 e B1.1
   são estacas diferentes). Só entram linhas de estaca que JÁ existe e com profundidade válida; a nova continua com a
   importação. Refurada e executada sem profundidade executada ficam fora. Devolve os itens da RPC (vazias, a confirmar e
   diferentes; as iguais não vão) e as contagens da caixa. */
function epjChaveLista(local, bloco, numero){
  return String(local || "").trim().toUpperCase() + "|" + String(bloco || "").trim().toUpperCase() + "|" + epjNormNumero(numero);
}
function epjCasarLista(lista, estacas){
  const r = { itens: [], existentes: 0, vazias: 0, aConfirmar: 0, diferentes: [], iguais: 0, refuradas: 0, semExecutada: 0, semProfundidade: 0, repetidas: 0, ambiguas: 0 };
  const porChave = new Map();
  for(const e of (Array.isArray(estacas) ? estacas : [])){
    if(!e || !e.id) continue;
    const k = epjChaveLista(e.local, e.bloco, e.numero);
    if(porChave.has(k)) porChave.get(k).push(e); else porChave.set(k, [e]);
  }
  const vistos = new Set();
  for(const l of (Array.isArray(lista) ? lista : [])){
    if(!l || !epjNormNumero(l.numero)) continue;
    const k = epjChaveLista(l.local, l.bloco, l.numero), achadas = porChave.get(k);
    if(!achadas) continue;                                   // estaca nova: entra pela importação de sempre
    if(achadas.length > 1){ r.ambiguas++; continue; }        // dois cadastros que só diferem por caixa ou espaço: não adivinha
    const e = achadas[0];
    if(e.status === "refugada"){ r.refuradas++; continue; }
    if(epjSemExecutada(e)){ r.semExecutada++; continue; }  // executada sem profundidade executada: o banco pula
    const para = epjValidarProfundidade(l.profundidade_m);
    if(para == null){ r.semProfundidade++; continue; }
    if(vistos.has(k)){ r.repetidas++; continue; }            // a mesma estaca duas vezes na lista: vale a primeira
    vistos.add(k);
    r.existentes++;
    if(!epjTemProjeto(e)){ r.vazias++; r.itens.push({ id: e.id, profundidade_m: para }); }
    else if(e.projeto_pendente){ r.aConfirmar++; r.itens.push({ id: e.id, profundidade_m: para }); }
    else if(Number(Number(e.profundidade_m).toFixed(2)) === para) r.iguais++;
    else {
      r.diferentes.push({ id: e.id, numero: e.numero, local: e.local || "", bloco: e.bloco || "", de: Number(e.profundidade_m), para });
      r.itens.push({ id: e.id, profundidade_m: para });
    }
  }
  return r;
}
function epjImportResumo(c, sobrescrever){
  const d = c.diferentes.length, partes = [];
  if(c.vazias) partes.push(`${epjInt(c.vazias)} ${epjPl(c.vazias, "recebe valor (estava", "recebem valor (estavam")} sem profundidade de projeto)`);
  if(c.aConfirmar) partes.push(`${epjInt(c.aConfirmar)} ${epjPl(c.aConfirmar, "está a confirmar e é corrigida", "estão a confirmar e são corrigidas")}`);
  if(d) partes.push(sobrescrever
    ? `${epjInt(d)} ${epjPl(d, "tem valor diferente e é trocada", "têm valor diferente e são trocadas")}`
    : `${epjInt(d)} ${epjPl(d, "tem valor diferente e fica como está", "têm valor diferente e ficam como estão")}`);
  if(c.iguais) partes.push(`${epjInt(c.iguais)} já ${epjPl(c.iguais, "tem", "têm")} o mesmo valor`);
  if(c.refuradas) partes.push(`${epjInt(c.refuradas)} ${epjPl(c.refuradas, "Refurada fica fora", "Refuradas ficam fora")}`);
  if(c.semExecutada) partes.push(`${epjInt(c.semExecutada)} ${epjPl(c.semExecutada, "executada sem profundidade executada fica de fora", "executadas sem profundidade executada ficam de fora")} (falta lançar a profundidade real)`);
  if(c.ambiguas) partes.push(`${epjInt(c.ambiguas)} com nome repetido no cadastro ${epjPl(c.ambiguas, "fica fora", "ficam fora")}`);
  return partes.join(" · ");
}
function epjLotes(itens, tamanho){
  const n = tamanho || EPJ_LIMITE_LISTA, lista = Array.isArray(itens) ? itens : [], lotes = [];
  for(let i = 0; i < lista.length; i += n) lotes.push(lista.slice(i, i + n));
  return lotes;
}
/* soma as respostas da RPC da lista quando a lista foi em mais de um lote */
function epjSomarRespostas(resps){
  const soma = { valores_anteriores: {} };
  for(const r of (Array.isArray(resps) ? resps : [])){
    if(!r || typeof r !== "object") continue;
    for(const [k, v] of Object.entries(r)){
      if(k === "valores_anteriores"){
        for(const [val, q] of Object.entries(v && typeof v === "object" ? v : {})) soma.valores_anteriores[val] = (soma.valores_anteriores[val] || 0) + (Number(q) || 0);
      } else if(typeof v === "number") soma[k] = (soma[k] || 0) + v;
      else if(!(k in soma)) soma[k] = v;
    }
  }
  return soma;
}
/* RPC ainda não existe no banco (migration não aplicada) */
function epjRpcAusente(err){
  return !!err && /PGRST202|42883|Could not find the function|schema cache/i.test(String(err.message || "") + " " + String(err.code || ""));
}

/* ---------- HTML ---------- */
function epjLinhaHTML(estado, pode){
  const txt = epjEstadoTexto(estado);
  if(!txt) return "";
  return `<span class="epj-linha-txt">${esc(txt)}</span>${pode
    ? '<button type="button" class="btn-sec btn-sm" id="btn-epj-informar" title="Informar a profundidade de projeto de várias estacas de uma vez, por diâmetro, local e bloco">Informar</button>'
    : ""}`;
}
/* célula do grupo: Ø e bloco em fonte de código; o grupo sem Ø leva o atalho para o filtro "Sem diâmetro" da lista */
function epjGrupoHTML(g, rotBloco){
  const rb = epjRotuloBloco(rotBloco);
  const partes = [g.semDiametro
    ? '<span class="tag ambar">sem Ø</span> <button type="button" class="btn-sec btn-sm" data-epj-sem-diametro="1" title="Fecha esta janela e mostra na lista as estacas sem diâmetro, para completar o cadastro">ver na lista</button>'
    : uiCodigo(`Ø ${epjInt(g.diametro)} mm`)];
  if(g.local != null) partes.push(g.local ? `<span>${esc(g.local)}</span>` : '<span class="meta">sem local</span>');
  if(g.bloco != null) partes.push(g.bloco ? `<span>${esc(rb)} ${/* html */ uiCodigo(g.bloco)}</span>` : `<span class="meta">sem ${esc(rb.toLowerCase())}</span>`);
  return partes.join(' <span class="meta">·</span> ');
}
function epjModoOpcoes(sel){
  return EPJ_MODOS.map(m => `<option value="${esc(m[0])}"${m[0] === sel ? " selected" : ""}>${esc(m[1])}</option>`).join("");
}
function epjJanelaHTML(estacas, modo, rotBloco){
  const agrupar = EPJ_AGRUPAR.includes(modo) ? modo : "diametro", rb = epjRotuloBloco(rotBloco);
  const s = epjEstado(estacas), grupos = epjAgrupar(estacas, agrupar);
  if(!s.total) return uiVazio("Nenhuma estaca cadastrada nesta obra (sem contar Refurada). Cadastre ou importe as estacas antes de informar a profundidade de projeto.");
  const rot = { diametro: "Ø", local: "Ø e local", bloco: `Ø, local e ${rb.toLowerCase()}` };
  const botoes = EPJ_AGRUPAR.map(a => `<button type="button" class="serv-view-btn${a === agrupar ? " ativo" : ""}" data-epj-agrupar="${esc(a)}" title="Um valor para cada grupo de estacas com o mesmo ${esc(rot[a].toLowerCase())}">${esc(rot[a])}</button>`).join("");
  const linhas = grupos.map((g, i) => `<tr data-epj-grupo="${i}">
      <td>${/* html */ epjGrupoHTML(g, rb)}</td>
      <td class="num">${esc(epjInt(g.total))}</td>
      <td class="num">${esc(epjInt(g.comProjeto))}</td>
      <td class="num">${g.aConfirmar ? `<span class="tag ambar" title="Valor copiado da profundidade executada: ainda não é o projeto">${esc(epjInt(g.aConfirmar))}</span>` : "0"}</td>
      <td class="num">${g.min == null ? '<span class="meta">—</span>' : esc(g.min === g.max ? epjMetros(g.min) : `${epjMetros(g.min).replace(" m", "")} a ${epjMetros(g.max)}`)}</td>
      <td><input type="number" class="epj-prof col-md" min="0.01" max="100" step="0.01" inputmode="decimal" placeholder="ex.: 12,5" aria-label="Profundidade de projeto, em metros, de ${esc(epjRotuloGrupo(g, rb))}" /></td>
      <td><select class="epj-modo" aria-label="Quais estacas de ${esc(epjRotuloGrupo(g, rb))} recebem o valor" title="Só as vazias: quem ainda não tem valor. Vazias e a confirmar: também corrige o valor copiado da executada. Todas do grupo: troca também o valor que já foi informado.">${/* html */ epjModoOpcoes(epjModoPadrao(g))}</select></td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm epj-aplicar" title="Mostra quantas estacas mudam antes de gravar">Aplicar</button></td>
    </tr>`).join("");
  return `<div class="epj-resumo">
      ${/* html */ uiRotuloValor("Estacas", esc(epjInt(s.total)))}
      ${/* html */ uiRotuloValor("Com profundidade de projeto", esc(`${epjInt(s.comProjeto)} (${s.pct}%)`))}
      ${/* html */ uiRotuloValor("A confirmar", esc(epjInt(s.aConfirmar)))}
      ${/* html */ uiRotuloValor("Sem valor", esc(epjInt(s.semProjeto)))}
    </div>
    <div class="epj-barra">
      <span class="rotulo-caps">Agrupar por</span>
      <div class="serv-views" id="epj-agrupar">${/* html */ botoes}</div>
    </div>
    <div id="epj-previa" class="epj-previa" aria-live="polite"></div>
    <div class="tabela-rola" id="epj-grade"><table>
      <thead><tr>
        <th>Grupo</th><th class="num">Estacas</th><th class="num" title="Estacas com profundidade de projeto informada e confirmada">Com projeto</th>
        <th class="num" title="Estacas em que o valor de projeto é a profundidade executada copiada: precisam do valor certo">A confirmar</th>
        <th class="num" title="Menor e maior profundidade de projeto que o grupo já tem">Valores de hoje</th>
        <th>Profundidade de projeto (m)</th><th>Gravar em</th><th class="col-acao"></th>
      </tr></thead>
      <tbody>${/* html */ linhas}</tbody></table></div>
    <p class="nota">O valor vale para as estacas do grupo, sem contar Refurada. Onde o projeto muda de estaca para estaca, agrupe por ${esc(rb.toLowerCase())} ou use a importação da lista, que atualiza a profundidade de projeto das estacas que já existem.</p>`;
}
function epjPreviaHTML(resp, rotulo){
  const frases = epjPreviaFrases(resp), af = Number(resp && resp.afetadas) || 0;
  return `<div class="epj-previa-caixa">
      <div class="rotulo-caps">Prévia</div>
      <p class="epj-previa-titulo">${esc(rotulo)}: ${esc(epjMetros(resp && resp.profundidade_m))}</p>
      <ul class="epj-previa-lista">${frases.map(f => `<li>${esc(f)}</li>`).join("")}</ul>
      <div class="form-acoes compacta">
        ${af ? `<button type="button" class="btn" id="btn-epj-gravar">Gravar em ${esc(epjInt(af))} ${esc(epjPl(af, "estaca", "estacas"))}</button>` : ""}
        <button type="button" class="btn-sec" id="btn-epj-previa-cancelar">${af ? "Cancelar" : "Fechar a prévia"}</button>
      </div>
    </div>`;
}
/* caixa da importação: desmarcada por padrão; marcada, mostra o que muda e lista os valores diferentes */
function epjImportHTML(c, estado){
  if(!c || !c.itens.length) return "";
  const st = estado || {}, d = c.diferentes.length;
  const linhas = c.diferentes.slice(0, EPJ_MAX_DIFERENTES).map(x => `<tr>
      <td>${esc(x.numero)}</td><td class="meta">${esc([x.local, x.bloco].filter(Boolean).join(" · ") || "—")}</td>
      <td class="num">${esc(epjMetros(x.de))}</td><td class="num">${esc(epjMetros(x.para))}</td></tr>`).join("");
  const detalhe = !st.marcado ? "" : `<div class="epj-imp-detalhe">
      <p class="epj-imp-resumo">${esc(epjImportResumo(c, !!st.sobrescrever))}.</p>
      ${d ? `<label class="epj-check"><input type="checkbox" id="epj-imp-sobrescrever"${st.sobrescrever ? " checked" : ""} /> Sobrescrever ${esc(epjPl(d, "a estaca", `as ${epjInt(d)} estacas`))} com valor diferente</label>
      <div class="tabela-rola"><table>
        <thead><tr><th>Nº</th><th>Local · bloco</th><th class="num">Hoje</th><th class="num">Na lista</th></tr></thead>
        <tbody>${/* html */ linhas}</tbody></table></div>
      ${d > EPJ_MAX_DIFERENTES ? `<p class="nota">e mais ${esc(epjInt(d - EPJ_MAX_DIFERENTES))} com valor diferente.</p>` : ""}` : ""}
      <p class="nota" id="epj-imp-previa">${esc(st.textoPrevia || "")}</p>
    </div>`;
  return `<div class="epj-import" id="epj-import">
      <label class="epj-check" title="As estacas novas da lista entram como sempre. Marcada, esta caixa também leva a profundidade de projeto da lista para as estacas que já estão cadastradas (mesmo local, bloco e número).">
        <input type="checkbox" id="epj-imp-atualizar"${st.marcado ? " checked" : ""}${st.indisponivel ? " disabled" : ""} />
        Atualizar a profundidade de projeto ${esc(epjPl(c.existentes, "da estaca que já existe", `das ${epjInt(c.existentes)} que já existem`))}
      </label>
      ${st.indisponivel ? `<p class="nota">${esc(EPJ_INDISPONIVEL)}</p>` : ""}
      ${/* html */ detalhe}
    </div>`;
}

/* ====================================================================
   Daqui para baixo: tela (lê o DOM, chama as RPCs). Nada disto roda no teste em Node.
   ==================================================================== */
let _epj = { agrupar: "diametro", grupos: [], previa: null };
let _epjImp = { lista: null, contId: null, marcado: false, sobrescrever: false, indisponivel: false, textoPrevia: "", seq: 0 };

function epjRotBloco(){ return typeof rotuloAgrupamento === "function" ? rotuloAgrupamento() : "Bloco"; }
function epjEstacasDaAba(){ return typeof _estacas !== "undefined" && Array.isArray(_estacas) ? _estacas : []; }
function epjObra(){ return typeof obraEditId !== "undefined" ? obraEditId : null; }
function epjAviso(msg, tipo){
  const el = $("epj-aviso");
  if(!el) return;
  el.textContent = msg || "";
  el.className = "aviso" + (msg ? " " + (tipo === "aviso" ? "atencao" : tipo || "erro") : "");
  if(msg) el.scrollIntoView({ block: "nearest" });
}
function epjErroTexto(error){
  if(epjRpcAusente(error)) return EPJ_INDISPONIVEL;
  if(typeof ehErroDePermissao === "function" && ehErroDePermissao(error)) return "Seu perfil não informa profundidade de projeto em lote.";
  return "Não foi possível concluir: " + ((error && error.message) || "erro sem mensagem");
}

/* gancho de renderEstacas: a linha de estado, com o botão Informar só para quem pode */
function epjLinha(estacas){
  const el = $("epj-linha");
  if(!el) return;
  el.innerHTML = epjLinhaHTML(epjEstado(estacas), epjPodeEditar());
}

/* ---------- janela "Profundidade de projeto" ---------- */
function epjRenderJanela(){
  const corpo = $("epj-corpo");
  if(!corpo) return;
  _epj.previa = null;
  _epj.grupos = epjAgrupar(epjEstacasDaAba(), _epj.agrupar);
  corpo.innerHTML = epjJanelaHTML(epjEstacasDaAba(), _epj.agrupar, epjRotBloco());
}
function epjAbrirJanela(){
  const modal = $("epj-modal");
  if(!modal || !epjPodeEditar() || !epjObra()) return;
  epjAviso("");
  epjRenderJanela();
  modal.style.display = "flex";
  $("btn-epj-fechar")?.focus();
}
function epjFecharJanela(){
  const modal = $("epj-modal");
  if(!modal || modal.style.display === "none") return;
  modal.style.display = "none";
  _epj.previa = null;
  $("epj-corpo")?.replaceChildren();
}
function epjLimparPrevia(){
  _epj.previa = null;
  $("epj-previa")?.replaceChildren();
}
/* Aplicar de um grupo: valida o campo e pede a prévia ao banco. Nada é gravado aqui. */
async function epjPedirPrevia(linha){
  const g = _epj.grupos[Number(linha.dataset.epjGrupo)];
  if(!g || !epjObra()) return;
  const prof = epjValidarProfundidade(linha.querySelector(".epj-prof")?.value);
  if(prof == null){ epjAviso("Informe a profundidade de projeto do grupo: maior que zero e de até 100 m.", "erro"); linha.querySelector(".epj-prof")?.focus(); return; }
  const pedido = { obra: epjObra(), filtro: epjFiltroDoGrupo(g), prof, modo: linha.querySelector(".epj-modo")?.value || "vazias", rotulo: epjRotuloGrupo(g, epjRotBloco()) };
  epjAviso("");
  const { data, error } = await sb.rpc("estacas_definir_profundidade_projeto", { p_obra: pedido.obra, p_filtro: pedido.filtro, p_profundidade: pedido.prof, p_modo: pedido.modo, p_previa: true });
  if(error){ epjLimparPrevia(); epjAviso(epjErroTexto(error), "erro"); return; }
  const caixa = $("epj-previa");
  if(!caixa || pedido.obra !== epjObra()) return;
  _epj.previa = { ...pedido, resp: data || {} };
  caixa.innerHTML = epjPreviaHTML(data || {}, pedido.rotulo);
  caixa.scrollIntoView({ block: "nearest" });
  ($("btn-epj-gravar") || $("btn-epj-previa-cancelar"))?.focus();
}
/* Gravar da prévia: a mesma chamada, agora gravando. "Todas do grupo" pede confirmação com o número de valores trocados. */
async function epjGravar(){
  const p = _epj.previa;
  if(!p || p.obra !== epjObra()) return;
  const trocadas = Number(p.resp.trocadas) || 0, execs = Number(p.resp.execucoes_sem_profundidade) || 0;
  if(p.modo === "todas" && trocadas > 0
     && !confirm(`${epjInt(trocadas)} ${epjPl(trocadas, "estaca que já tem profundidade de projeto vai ter o valor trocado", "estacas que já têm profundidade de projeto vão ter o valor trocado")} para ${epjMetros(p.prof)}. Trocar?`)) return;
  if(execs > EPJ_AVISO_EXECUCOES
     && !confirm(`${epjInt(execs)} execuções sem profundidade executada passam a contar esta profundidade na prévia da medição. A diretoria precisa saber antes. Gravar mesmo assim?`)) return;
  const { data, error } = await sb.rpc("estacas_definir_profundidade_projeto", { p_obra: p.obra, p_filtro: p.filtro, p_profundidade: p.prof, p_modo: p.modo, p_previa: false });
  if(error){ epjAviso(epjErroTexto(error), "erro"); return; }
  const n = Number(data && data.afetadas) || 0;
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(p.obra);
  if($("epj-modal") && $("epj-modal").style.display !== "none") epjRenderJanela();
  epjAviso(n ? `${p.rotulo}: ${epjInt(n)} ${epjPl(n, "estaca ficou", "estacas ficaram")} com ${epjMetros(p.prof)} de profundidade de projeto.` : "Nenhuma estaca precisou mudar.", n ? "ok" : "aviso");
}

/* ---------- importação: "atualizar as que já existem" ---------- */
function epjImportLista(){ return typeof _importPreview !== "undefined" && Array.isArray(_importPreview) ? _importPreview : []; }
function epjImportCasar(){ return epjCasarLista(epjImportLista(), epjEstacasDaAba()); }
/* gancho de renderImportPreview: põe a caixa no fim da prévia. Lista nova = caixa desmarcada. */
function epjImportBloco(contId){
  const cont = $(contId);
  document.querySelectorAll("#epj-import").forEach(x => x.remove());
  if(!cont || !epjPodeEditar() || !epjObra()) return;
  if(_epjImp.lista !== epjImportLista()) _epjImp = { ..._epjImp, lista: epjImportLista(), marcado: false, sobrescrever: false, indisponivel: false, textoPrevia: "" };
  _epjImp.contId = contId;
  if(!cont.dataset.epjLigado){
    cont.dataset.epjLigado = "1";
    // a pessoa corrige nº, local, bloco ou profundidade na prévia: a caixa refaz a conta (sem redesenhar a prévia)
    cont.addEventListener("input", debounce((ev) => { if(!ev.target.closest("#epj-import")) epjImportAtualizar(); }, 300));
    cont.addEventListener("change", (ev) => {
      if(ev.target.id === "epj-imp-atualizar"){ _epjImp.marcado = ev.target.checked; _epjImp.textoPrevia = ""; epjImportAtualizar(); }
      else if(ev.target.id === "epj-imp-sobrescrever"){ _epjImp.sobrescrever = ev.target.checked; _epjImp.textoPrevia = ""; epjImportAtualizar(); }
    });
  }
  epjImportAtualizar();
}
function epjImportAtualizar(){
  const cont = $(_epjImp.contId);
  if(!cont) return;
  const c = epjImportCasar();
  if(!c.itens.length) _epjImp.marcado = false;
  if(!c.itens.length || !c.diferentes.length) _epjImp.sobrescrever = false;   // sem valor diferente na lista, "sobrescrever" volta a nascer desmarcado
  const html = epjImportHTML(c, _epjImp), atual = cont.querySelector("#epj-import");
  if(atual) atual.remove();
  if(html) cont.insertAdjacentHTML("beforeend", /* html */ html);
  if(_epjImp.marcado && c.itens.length) epjImportPrevia(c);
}
/* as duas chamadas da lista (prévia e gravação), em lotes de 2.000 */
async function epjImportChamar(itens, previa){
  const resps = [];
  for(const lote of epjLotes(itens)){
    const { data, error } = await sb.rpc("estacas_atualizar_profundidade_lista", { p_obra: epjObra(), p_itens: lote, p_sobrescrever: !!_epjImp.sobrescrever, p_previa: !!previa });
    if(error) return { error, parcial: epjSomarRespostas(resps) };
    resps.push(data || {});
  }
  return { data: epjSomarRespostas(resps) };
}
/* prévia do banco embaixo da caixa marcada; resposta atrasada de uma conta antiga é descartada */
async function epjImportPrevia(c){
  const seq = ++_epjImp.seq;
  const r = await epjImportChamar(c.itens, true);
  if(seq !== _epjImp.seq) return;
  if(r.error && epjRpcAusente(r.error)){ _epjImp.indisponivel = true; _epjImp.marcado = false; epjImportAtualizar(); return; }
  _epjImp.textoPrevia = r.error ? epjErroTexto(r.error) : "Conferido no banco: " + epjListaFrases(r.data).join(" ");
  const el = $("epj-imp-previa");
  if(el) el.textContent = _epjImp.textoPrevia;
}
/* gancho de confirmarImportEstacas: a caixa está marcada e tem o que atualizar? */
function epjImportMarcado(){
  return !!_epjImp.marcado && !_epjImp.indisponivel && _epjImp.lista === epjImportLista() && epjPodeEditar() && epjImportCasar().itens.length > 0;
}
/* gancho de confirmarImportEstacas: refaz a conta, mostra a prévia do banco e só grava com o "sim" da pessoa.
   Devolve { ok, msg }: a mensagem entra no aviso da importação. */
async function epjImportGravar(){
  const c = epjImportCasar();
  if(!c.itens.length) return { ok: true, msg: "Nenhuma estaca que já existe precisou de profundidade de projeto." };
  const previa = await epjImportChamar(c.itens, true);
  if(previa.error) return { ok: false, msg: "A profundidade de projeto das estacas que já existem não foi atualizada. " + epjErroTexto(previa.error) };
  const n = Number(previa.data.afetadas) || 0;
  if(!n) return { ok: true, msg: "Nenhuma estaca que já existe precisou de profundidade de projeto." };
  if(!confirm("Atualizar a profundidade de projeto das estacas que já existem?\n\n" + epjListaFrases(previa.data).join("\n")))
    return { ok: false, msg: "A profundidade de projeto das estacas que já existem não foi alterada." };
  const r = await epjImportChamar(c.itens, false);
  if(r.error){
    const feitas = Number(r.parcial && r.parcial.afetadas) || 0;
    return { ok: false, msg: `A atualização da profundidade de projeto parou${feitas ? ` depois de ${epjInt(feitas)} ${epjPl(feitas, "estaca", "estacas")}` : ""}. ` + epjErroTexto(r.error) };
  }
  const feitas = Number(r.data.afetadas) || 0;
  _epjImp = { ..._epjImp, lista: null, marcado: false, sobrescrever: false, textoPrevia: "" };
  return { ok: true, msg: `Profundidade de projeto atualizada em ${epjInt(feitas)} ${epjPl(feitas, "estaca que já existia", "estacas que já existiam")}.` };
}

/* ---------- eventos ---------- */
function ligarEpj(){
  $("epj-linha")?.addEventListener("click", (ev) => { if(ev.target.closest("#btn-epj-informar")) epjAbrirJanela(); });
  $("btn-epj-fechar")?.addEventListener("click", epjFecharJanela);
  document.addEventListener("keydown", (ev) => { if(ev.key === "Escape" && $("epj-modal") && $("epj-modal").style.display !== "none") epjFecharJanela(); });
  const corpo = $("epj-corpo");
  if(!corpo) return;
  corpo.addEventListener("click", (ev) => {
    const alvo = ev.target;
    const agr = alvo.closest("[data-epj-agrupar]");
    if(agr){ _epj.agrupar = agr.dataset.epjAgrupar; epjAviso(""); epjRenderJanela(); return; }
    const aplicar = alvo.closest(".epj-aplicar");
    if(aplicar){ comBotaoTravado(aplicar, () => epjPedirPrevia(aplicar.closest("tr"))); return; }
    const gravar = alvo.closest("#btn-epj-gravar");
    if(gravar){ comBotaoTravado(gravar, epjGravar); return; }
    if(alvo.closest("#btn-epj-previa-cancelar")){ epjLimparPrevia(); return; }
    if(alvo.closest("[data-epj-sem-diametro]")){
      epjFecharJanela();
      if(typeof estDefinirFiltroProf === "function") estDefinirFiltroProf("sem_diametro");
      if(typeof renderEstacas === "function") renderEstacas();
    }
  });
  // Enter no campo do grupo = Aplicar do grupo (mostra a prévia; não grava)
  corpo.addEventListener("keydown", (ev) => {
    if(ev.key !== "Enter" || !ev.target.classList || !ev.target.classList.contains("epj-prof")) return;
    ev.preventDefault();
    ev.target.closest("tr")?.querySelector(".epj-aplicar")?.click();
  });
  // mexer no valor ou no modo de um grupo invalida a prévia que estava na tela
  corpo.addEventListener("input", (ev) => { if(_epj.previa && ev.target.closest("#epj-grade")) epjLimparPrevia(); });
}
if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarEpj);
  else ligarEpj();
}

// teste em Node (scripts/testar-fase170a.mjs): as funções puras também saem por module.exports
if(typeof module === "object" && module && module.exports){
  module.exports = { EPJ_CARGOS_EDITAM, EPJ_MODOS, EPJ_AGRUPAR, EPJ_INDISPONIVEL, EPJ_LIMITE_LISTA, epjPodeEditarCargo, epjNumero, epjValidarProfundidade, epjEstado, epjEstadoTexto,
    epjAgrupar, epjFiltroDoGrupo, epjRotuloGrupo, epjModoPadrao, epjPreviaFrases, epjListaFrases, epjChaveLista, epjCasarLista, epjImportResumo, epjLotes, epjSomarRespostas,
    epjRpcAusente, epjLinhaHTML, epjJanelaHTML, epjPreviaHTML, epjImportHTML, epjSemExecutada };
}

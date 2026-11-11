/* ====================================================================
   Módulo: executadas sem vínculo, na folha do projeto — fase 169a (continua o prefixo ppj-; funções ppjVin*)
   Carregado depois de js/planta_posicoes.js, que chama este arquivo por ganchos guardados por typeof (ppjVinExtraBarra,
   ppjVinResumoFolha, ppjVinPintar e ppjVinCliqueEstaca). Sem este arquivo, a folha fica como na fase 167b.
   - É a aba "Vincular estacas" (fase 94) levada para o desenho: as execuções do diário que ainda não têm estaca
     (vw_rdo_execucoes_obra, estaca_id nulo), num painel ao lado da folha. O painel abre pelo botão "Executadas sem
     vínculo (N)" da barra da folha, que só existe quando a folha tem estaca posicionada e a obra tem execução solta.
   - Clicar numa execução acende no desenho as estacas parecidas: as MESMAS da aba (estvSugestoes de js/estacas.js, com a
     mesma etiqueta de confiança), até 8. A que não está nesta folha aparece só na lista.
   - Clicar numa estaca prevista, sem execução escolhida, põe no topo da lista as execuções mais parecidas com o nome dela.
   - NADA é vinculado sozinho. Com uma execução escolhida, clicar numa estaca acesa (ou em qualquer prevista) abre a
     confirmação no painel; só o botão "Vincular" grava, pela mesma RPC da aba (estvGravarVinculo → rdo_exec_vincular_estaca,
     que registra em registros_log). Estaca já medida (RPC estacas_medidas) é avisada antes. O status da estaca nasce no
     banco: depois de vincular, a tela relê as estacas da obra.
   - Todos veem a lista e as sugestões. Vincular é de quem edita estaca (ppjPodeEditar), nunca do usuário de revisão. O
     banco decide: a recusa aparece na caixa de aviso acima da folha.
   - "Vincular as de confiança alta", trocar prefixo, desvincular e "nova do campo" continuam só na aba.
   As funções ppjVinConf, ppjVinComExec, ppjVinSugestoes, ppjVinPodeAlvo, ppjVinOrdenar, ppjVinResumo, ppjVinPergunta,
   ppjVinSub e as que montam HTML são puras (sem tela nem banco) e testadas por scripts/testar-fase169a.mjs.
   ==================================================================== */

const PPJ_VIN_VIEW = "vw_rdo_execucoes_obra";
const PPJ_VIN_COLUNAS = "id,estaca_id,estaca_numero,profundidade_executada,perfuracao_ate_m,equipamento_id,maquina_codigo,modalidade_execucao,rdo_id,obra_id,data,rdo_equipamento_id";
const PPJ_VIN_MOTIVO = "vinculo_estaca";   // o mesmo tipo de registro do vínculo feito na aba
const PPJ_VIN_SUG_MAX = 8;                 // as mesmas 8 sugestões da aba
const PPJ_VIN_LISTA_MAX = 200;             // execuções desenhadas no painel (o resto, pela busca)
const PPJ_VIN_ANEL = 5;                    // quanto o anel da estaca acesa passa do marcador, em pixels de tela
/* as mesmas etiquetas da aba Vincular (ESTV_CONF em js/estacas.js); esta cópia só vale se aquela tabela não existir */
const PPJ_VIN_CONF = { igual: { lbl: "igual", nivel: "alta" }, virgula: { lbl: "só vírgula/espaço", nivel: "alta" }, prefixo: { lbl: "só prefixo", nivel: "alta" },
  zeros: { lbl: "só zeros", nivel: "alta" }, prefixo_zeros: { lbl: "prefixo e zeros", nivel: "media" }, parecida: { lbl: "parecida", nivel: "baixa" } };
const PPJ_VIN_NIVEL = { alta: 0, media: 1, baixa: 2 };

/* ---------- regra (pura) ---------- */
function ppjVinConf(conf){
  const tabela = typeof ESTV_CONF !== "undefined" && ESTV_CONF ? ESTV_CONF : PPJ_VIN_CONF;
  const c = tabela[conf] || PPJ_VIN_CONF[conf];
  return c ? { lbl: String(c.lbl), nivel: Object.prototype.hasOwnProperty.call(PPJ_VIN_NIVEL, c.nivel) ? c.nivel : "baixa" } : { lbl: "parecida", nivel: "baixa" };
}
const ppjVinNome = (x) => String((x && x.estaca_numero) || "").trim() || "(sem nome)";
const ppjVinNumero = (e) => String((e && e.numero) || "").trim() || "(sem nº)";
function ppjVinData(d){
  const p = String(d || "").slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "";
}
function ppjVinMaquina(x, equips){
  const id = x && (x.equipamento_id || x.rdo_equipamento_id), q = id ? (Array.isArray(equips) ? equips : []).find(e => e && e.id === id) : null;
  return q ? String(q.codigo || q.nome || "") : String((x && x.maquina_codigo) || "");
}
function ppjVinMetros(x){
  const m = Number(x && x.profundidade_executada) || 0, ate = Number(x && x.perfuracao_ate_m) || 0;
  const f = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return m > 0 ? `${f(m)} m` : ate > 0 ? `até ${f(ate)} m` : "";
}
/* a linha de baixo de uma execução: data, máquina e profundidade */
function ppjVinSub(x, equips){ return [ppjVinData(x && x.data), ppjVinMaquina(x, equips), ppjVinMetros(x)].filter(Boolean).join(" · "); }
/* estacas que já têm execução vinculada (js/estacas.js anexa a contagem em _execs_total ao ler a obra) */
function ppjVinComExec(estacas){
  return new Set((Array.isArray(estacas) ? estacas : []).filter(e => e && Number(e._execs_total) > 0).map(e => e.id));
}
/* As sugestões de estaca para uma execução: as mesmas da aba Vincular (estvSugestoes), na mesma ordem, com o que a folha
   acrescenta: a estaca está posicionada nesta folha (mapa)? Tem marcador com os filtros da aba (visiveis)?
   Devolve [{ id, estaca, conf, rotulo, nivel, mesma, naFolha, visivel }]. Sem a função da aba, nenhuma sugestão. */
function ppjVinSugestoes(exec, estacas, mapa, visiveis){
  if(!exec || typeof estvSugestoes !== "function") return [];
  const lista = (Array.isArray(estacas) ? estacas : []).filter(Boolean);
  const tem = (m, id) => !!m && typeof m.has === "function" && m.has(id);
  return estvSugestoes(exec, ppjVinComExec(lista), lista, "").slice(0, PPJ_VIN_SUG_MAX).map(s => {
    const c = ppjVinConf(s.conf);
    return { id: s.p.id, estaca: s.p, conf: s.conf, rotulo: c.lbl, nivel: c.nivel, mesma: !!s.mesma, naFolha: tem(mapa, s.p.id), visivel: tem(visiveis, s.p.id) };
  });
}
/* Com uma execução escolhida, o clique no desenho vale para a estaca acesa (sugerida) ou para qualquer estaca prevista */
function ppjVinPodeAlvo(estaca, sugestoes){
  if(!estaca || !estaca.id) return false;
  return estaca.status === "prevista" || (Array.isArray(sugestoes) ? sugestoes : []).some(s => s && s.id === estaca.id);
}
/* A lista do painel. o = { termo: busca pelo nome do campo, foco: estaca clicada no desenho }. Com foco, as execuções
   mais parecidas com o nome dela sobem (pela mesma regra de confiança da aba). Devolve [{ x, conf }]. */
function ppjVinOrdenar(execs, o){
  const p = o || {}, termo = String(p.termo || "").trim().toLowerCase(), foco = p.foco && p.foco.id ? p.foco : null;
  const conf = (x) => {
    if(!foco || typeof estvSugestoes !== "function") return null;
    const s = estvSugestoes(x, new Set(), [foco], "")[0];
    return s ? s.conf : null;
  };
  const nivel = (c) => c ? PPJ_VIN_NIVEL[ppjVinConf(c).nivel] : 3;
  return (Array.isArray(execs) ? execs : []).filter(x => x && (!termo || ppjVinNome(x).toLowerCase().includes(termo)))
    .map(x => ({ x, conf: conf(x) }))
    .sort((a, b) => nivel(a.conf) - nivel(b.conf) || String(a.x.data || "").localeCompare(String(b.x.data || ""))
      || ppjPosCompararNomes(a.x.estaca_numero, b.x.estaca_numero) || (String(a.x.id) < String(b.x.id) ? -1 : String(a.x.id) > String(b.x.id) ? 1 : 0));
}
/* o que a legenda da folha ganha */
function ppjVinResumo(n){
  const q = Math.max(0, Math.trunc(Number(n) || 0));
  return q ? ` · ${q} executada${q === 1 ? "" : "s"} sem vínculo nesta obra` : "";
}
const ppjVinRotuloBloco = () => (typeof rotuloAgrupamento === "function" ? String(rotuloAgrupamento() || "Bloco") : "Bloco").toLowerCase();
/* a pergunta da confirmação: "Vincular a execução X (data) à estaca Y (bloco Z, local W)?" */
function ppjVinPergunta(exec, estaca, rotuloBloco){
  const bloco = String((estaca && estaca.bloco) || "").trim(), local = String((estaca && estaca.local) || "").trim(), data = ppjVinData(exec && exec.data);
  const onde = [bloco ? `${rotuloBloco || "bloco"} ${bloco}` : "", local].filter(Boolean).join(", ");
  return `Vincular a execução ${ppjVinNome(exec)}${data ? ` (${data})` : ""} à estaca ${ppjVinNumero(estaca)}${onde ? ` (${onde})` : ""}?`;
}

/* ---------- HTML (puro) ---------- */
/* s = { n: execuções sem vínculo, aberto }. O botão que entra na barra da folha. */
function ppjVinBotaoHTML(s){
  const p = s || {}, n = Math.max(0, Math.trunc(Number(p.n) || 0));
  if(!n) return "";
  return `<button type="button" class="btn-sec btn-sm" data-ppj-vin="abrir" aria-pressed="${p.aberto ? "true" : "false"}" title="Execuções do diário que ainda não estão ligadas a uma estaca. Abra para ver no desenho as estacas parecidas com cada uma.">Executadas sem vínculo (${n})</button>`;
}
/* o esqueleto do painel; contador, foco e lista são preenchidos depois, sem recriar o campo de busca */
function ppjVinPainelHTML(){
  return `<div class="ppj-vin-topo"><span class="rotulo-caps" id="ppj-vin-conta">Executadas sem vínculo</span><button type="button" class="btn-sec btn-sm" data-ppj-vin="fechar" title="Fechar este painel. A contagem continua na barra da folha." aria-label="Fechar o painel de executadas sem vínculo">×</button></div>
    <div class="ppj-vin-foco" id="ppj-vin-foco"></div>
    <input id="ppj-vin-busca" type="search" placeholder="Buscar pelo nome do campo…" aria-label="Buscar execução sem vínculo pelo nome do campo" autocomplete="off" />
    <div class="ppj-lista" id="ppj-vin-lista" role="group" aria-label="Execuções do diário sem estaca vinculada"></div>`;
}
/* itens = [{ x, conf }] (ppjVinOrdenar). Clicar numa execução acende as estacas parecidas no desenho. */
function ppjVinListaHTML(itens, escolhida, equips, buscando){
  const l = Array.isArray(itens) ? itens : [];
  if(!l.length) return uiVazio(buscando ? "Nenhuma execução sem vínculo com esse nome. Confira a busca." : "Nenhuma execução sem vínculo nesta obra.");
  return l.slice(0, PPJ_VIN_LISTA_MAX).map(({ x, conf }) => {
    const c = conf ? ppjVinConf(conf) : null, sub = ppjVinSub(x, equips), ativa = x.id === escolhida;
    return `<div class="ppj-item ppj-vin-item${ativa ? " ativo" : ""}" role="button" tabindex="0" data-ppj-vin-exec="${esc(x.id)}" aria-pressed="${ativa ? "true" : "false"}" title="Ver no desenho as estacas parecidas com este nome"><span class="ppj-vin-linha"><span class="ppj-item-nome">${esc(ppjVinNome(x))}</span>${x.modalidade_execucao === "refuro" ? `<span class="tag cinza">Refuro</span>` : ""}${c ? `<span class="rec-badge rec-badge-${esc(c.nivel)}">${esc(c.lbl)}</span>` : ""}</span>${sub ? `<span class="ppj-item-sub">${esc(sub)}</span>` : ""}</div>`;
  }).join("") + (l.length > PPJ_VIN_LISTA_MAX ? `<p class="ppj-item-mais">e mais ${l.length - PPJ_VIN_LISTA_MAX}: use a busca para achar.</p>` : "");
}
/* uma sugestão na lista do painel. A que tem marcador na folha é clicável (leva o desenho até ela); a que não tem só informa. */
function ppjVinSugestaoHTML(s, alvoId){
  const e = s.estaca || {}, clicavel = s.naFolha && s.visivel;
  const sub = [String(e.local || "").trim(), String(e.bloco || "").trim(), ppjPosStatusRotulo(e.status), Number(e._execs_total) > 0 ? "já tem execução" : "",
    !s.naFolha ? "sem posição nesta folha" : !s.visivel ? "fora do filtro da aba" : ""].filter(Boolean).join(" · ");
  const miolo = `<span class="ppj-vin-linha"><span class="ppj-item-nome">${esc(ppjVinNumero(e))}</span><span class="rec-badge rec-badge-${esc(s.nivel)}">${esc(s.rotulo)}</span>${s.mesma ? `<span class="rec-badge rec-badge-alta" title="O local ou o bloco da estaca tem o mesmo número do nome do campo">mesma travessia</span>` : ""}</span>${sub ? `<span class="ppj-item-sub">${esc(sub)}</span>` : ""}`;
  return clicavel
    ? `<div class="ppj-item ppj-vin-sug${s.id === alvoId ? " ativo" : ""}" role="button" tabindex="0" data-ppj-vin-estaca="${esc(s.id)}" title="Levar o desenho até esta estaca">${/* html */ miolo}</div>`
    : `<div class="ppj-item ppj-vin-sug ppj-vin-fora">${/* html */ miolo}</div>`;
}
/* c = { exec, estaca, medida: true | false | null (ainda conferindo) | "?" (não deu para conferir), gravando, rotuloBloco }.
   A confirmação: nada é gravado antes do botão Vincular. */
function ppjVinConfirmacaoHTML(c){
  const e = c.estaca || {}, x = c.exec || {}, execs = Math.max(0, Math.trunc(Number(e._execs_total) || 0));
  const nomeDifere = typeof normalizarNumeroEstacaEstacas === "function" ? normalizarNumeroEstacaEstacas(x.estaca_numero) !== normalizarNumeroEstacaEstacas(e.numero) : false;
  const alertas = [
    c.medida === true ? `<p class="ppj-vin-alerta">A estaca ${esc(ppjVinNumero(e))} já entrou em medição. Se vincular mesmo assim, fica registrado no histórico.</p>` : "",
    c.medida === "?" ? `<p class="ppj-vin-alerta">Não foi possível conferir se esta estaca já entrou em medição.</p>` : "",
    execs ? `<p class="ppj-vin-alerta">Esta estaca já tem ${execs} ${execs === 1 ? "execução vinculada" : "execuções vinculadas"}.</p>` : "",
    e.status && e.status !== "prevista" ? `<p class="ppj-vin-nota">Status de hoje: ${esc(ppjPosStatusRotulo(e.status))}.</p>` : "",
    nomeDifere ? `<p class="ppj-vin-nota">O nome do campo (${esc(ppjVinNome(x))}) é diferente do nome da estaca: fica guardado como nome corrigido.</p>` : ""
  ].join("");
  const espera = c.medida === null;
  return `<div class="ppj-vin-confirma" role="group" aria-label="Confirmar o vínculo">
      <p><strong>${esc(ppjVinPergunta(x, e, c.rotuloBloco))}</strong></p>${/* html */ alertas}
      <p class="ppj-vin-nota">O status e a medição da estaca são refeitos pelo banco. Fica registrado no histórico da estaca e da execução.</p>
      <div class="ppj-vin-acoes"><button type="button" class="btn btn-sm" data-ppj-vin="confirmar" title="Gravar o vínculo desta execução com esta estaca"${c.gravando || espera ? " disabled" : ""}>${c.gravando ? "Vinculando…" : espera ? "Conferindo a medição…" : c.medida === true ? "Vincular mesmo assim" : "Vincular"}</button>
      <button type="button" class="btn-sec btn-sm" data-ppj-vin="cancelar" title="Não vincular agora"${c.gravando ? " disabled" : ""}>Cancelar</button></div>
    </div>`;
}
/* s = { exec, equips, sugestoes, podeEditar, confirmar (ou nulo), foco: estaca clicada no desenho, ok: última gravação feita }.
   O bloco de cima do painel: a execução escolhida com as estacas parecidas, ou a estaca em foco, ou a dica. */
function ppjVinFocoHTML(s){
  const p = s || {}, ok = p.ok ? `<p class="ppj-vin-ok" role="status">${esc(p.ok)}</p>` : "";
  if(!p.exec){
    if(p.foco) return `${/* html */ ok}<div class="ppj-vin-escolhida"><span>Mais parecidas com a estaca ${/* html */ uiCodigo(ppjVinNumero(p.foco))} no topo da lista.</span><button type="button" class="btn-sec btn-sm" data-ppj-vin="limpar-foco" title="Voltar a lista à ordem de data">Limpar</button></div>`;
    return `${/* html */ ok}<p class="ppj-vin-dica">Clique numa execução para ver no desenho as estacas parecidas com o nome dela. Clique numa estaca prevista do desenho para ver primeiro as execuções parecidas com ela.</p>`;
  }
  const x = p.exec, sugs = Array.isArray(p.sugestoes) ? p.sugestoes : [], sub = ppjVinSub(x, p.equips), alvoId = p.confirmar && p.confirmar.estaca ? p.confirmar.estaca.id : null;
  const cab = `<div class="ppj-vin-escolhida"><span>Execução ${/* html */ uiCodigo(ppjVinNome(x))}${x.modalidade_execucao === "refuro" ? ` <span class="tag cinza">Refuro</span>` : ""}${sub ? ` <span class="ppj-item-sub">${esc(sub)}</span>` : ""}</span><button type="button" class="btn-sec btn-sm" data-ppj-vin="soltar" title="Deixar de procurar a estaca desta execução (Esc)">Soltar</button></div>`;
  const lista = sugs.length ? `<div class="rotulo-caps">Estacas parecidas (${sugs.length})</div><div class="ppj-vin-sugs">${sugs.map(g => ppjVinSugestaoHTML(g, alvoId)).join("")}</div>`
    : uiVazio("Nenhuma estaca da obra tem nome parecido com o desta execução.");
  const acesas = sugs.some(g => g.naFolha && g.visivel);
  const fim = p.confirmar ? ppjVinConfirmacaoHTML(p.confirmar)
    : `<p class="ppj-vin-dica">${!p.podeEditar ? (acesas ? "As estacas parecidas estão destacadas no desenho. Só quem edita estaca vincula." : "Nenhuma estaca parecida aparece nesta folha. Só quem edita estaca vincula.")
      : acesas ? "As estacas parecidas estão destacadas no desenho. Clique numa delas, ou em qualquer estaca prevista, para vincular: nada é gravado antes de você confirmar."
      : "Nenhuma estaca parecida aparece nesta folha. Clique em qualquer estaca prevista do desenho para vincular: nada é gravado antes de você confirmar."}</p>`;
  return `${/* html */ ok}${/* html */ cab}${/* html */ lista}${/* html */ fim}`;
}

/* ====================================================================
   Tela
   ==================================================================== */
function ppjVinEstadoNovo(obraId){
  return { obraId: obraId || null, execs: null, erro: "", lendo: false, lidoEm: 0, tentouEm: 0, medidas: null, lendoMedidas: false, aberto: false, termo: "",
    escolhida: null, foco: null, confirmar: null, gravando: false, sugestoes: [], ok: "", painel: null, chaveFoco: null, chaveLista: null };
}
let _ppjVin = ppjVinEstadoNovo(null);   // trocado inteiro a cada obra

function ppjVinEstado(){
  const obraId = _ppj.obraId || null;
  if(_ppjVin.obraId !== obraId){
    if(_ppjVin.painel) _ppjVin.painel.remove();
    _ppjVin = ppjVinEstadoNovo(obraId);
  }
  return _ppjVin;
}
const ppjVinEquips = () => (typeof _equipamentosCache !== "undefined" && Array.isArray(_equipamentosCache) ? _equipamentosCache : []);
/* o painel e o botão existem nesta folha? Só fora do modo de edição das posições, em folha com estaca posicionada, em obra com execução solta. */
function ppjVinDisponivel(st){
  const v = _ppjVin;
  return !!st && st.disponivel && !st.editando && st.mapa.size > 0 && Array.isArray(v.execs) && v.execs.length > 0;
}
const ppjVinRepintar = () => { if(_ppjPos.disponivel) ppjPosPintar(_ppjPos); };

/* ---------- leitura ----------
   Só as execuções sem estaca da obra. Pode passar de 1.000 linhas (há obra com mais de mil soltas): lerTudo, com a chave id. */
async function ppjVinLer(){
  const v = ppjVinEstado(), obraId = v.obraId;
  if(!obraId || v.lendo) return;
  v.lendo = true;
  v.tentouEm = Date.now();
  const r = await Promise.resolve().then(() => lerTudo(() => sb.from(PPJ_VIN_VIEW).select(PPJ_VIN_COLUNAS).eq("obra_id", obraId).is("estaca_id", null), "id"))
    .catch(e => ({ data: [], error: e }));
  if(v !== _ppjVin) return;
  v.lendo = false;
  if(r.error){
    console.error("Executadas sem vínculo, leitura:", r.error);
    v.erro = r.error.message || "erro de leitura";
    ppjVinRepintar();
    return;
  }
  v.erro = "";
  v.execs = (r.data || []).filter(x => x && x.id && x.obra_id === obraId && !x.estaca_id);
  v.lidoEm = Date.now();
  if(v.escolhida && !v.execs.some(x => x.id === v.escolhida)) ppjVinSoltar(v);   // outra pessoa vinculou a execução escolhida
  ppjVinRepintar();
}
/* estacas já medidas: só para avisar na confirmação. Falha na leitura não impede o vínculo, mas a confirmação diz. */
async function ppjVinLerMedidas(){
  const v = _ppjVin, obraId = v.obraId;
  if(!obraId || v.medidas !== null || v.lendoMedidas) return;
  v.lendoMedidas = true;
  let r;
  try { r = await sb.rpc("estacas_medidas", { p_obra: obraId }); }
  catch(e){ r = { data: null, error: e }; }
  if(v !== _ppjVin) return;
  v.lendoMedidas = false;
  if(r.error) console.error("Executadas sem vínculo, estacas medidas:", r.error);
  v.medidas = r.error ? false : new Set(r.data || []);
  ppjVinRepintar();
}

/* ---------- ganchos de js/planta_posicoes.js ---------- */
/* o botão "Executadas sem vínculo (N)" na barra da folha */
function ppjVinExtraBarra(st){
  ppjVinEstado();
  return ppjVinDisponivel(st) ? ppjVinBotaoHTML({ n: _ppjVin.execs.length, aberto: _ppjVin.aberto }) : "";
}
/* o que a legenda da folha ganha: "N executadas sem vínculo nesta obra" */
function ppjVinResumoFolha(st){
  const v = ppjVinEstado();
  if(!st || !st.disponivel || !st.mapa.size) return "";
  if(v.erro && !v.execs) return " · não foi possível ler as executadas sem vínculo";
  return ppjVinResumo(Array.isArray(v.execs) ? v.execs.length : 0);
}
/* depois de a folha ser pintada: lê as execuções soltas (uma vez), desenha o painel e acende as estacas sugeridas */
function ppjVinPintar(st){
  const v = ppjVinEstado();
  if(st && st.disponivel && st.mapa.size > 0 && !v.execs && !v.lendo && Date.now() - v.tentouEm > PPJ_NOVA_TENTATIVA_MS) ppjVinLer();
  if(st && st.editando && (v.escolhida || v.confirmar)) ppjVinSoltar(v);   // o modo de edição das posições fica com o clique
  ppjVinPainel(st);
  ppjVinAcender(st);
}
/* clique (ou Enter) numa estaca do desenho, fora do modo de edição. Devolve true quando o painel ficou com o clique;
   false deixa a folha abrir a execução da estaca, como sempre. */
function ppjVinCliqueEstaca(id){
  const st = _ppjPos, v = _ppjVin;
  if(!v.aberto || !ppjVinDisponivel(st) || v.gravando) return false;
  const e = ppjEstacas().find(x => x.id === id);
  if(!e) return false;
  if(v.escolhida){
    if(!ppjPodeEditar() || !ppjVinPodeAlvo(e, v.sugestoes)) return false;
    ppjVinPedirConfirmacao(v, id);
    return true;
  }
  if(e.status !== "prevista") return false;
  v.foco = v.foco === id ? null : id;
  v.ok = "";
  ppjVinRepintar();
  return true;
}

/* ---------- ações ---------- */
function ppjVinSoltar(v){ v.escolhida = null; v.confirmar = null; v.sugestoes = []; }
function ppjVinAbrir(liga){
  const v = ppjVinEstado(), st = _ppjPos;
  v.aberto = !!liga && ppjVinDisponivel(st);
  if(!v.aberto){ ppjVinSoltar(v); v.foco = null; v.ok = ""; }
  else {
    if(ppjPodeEditar()) ppjVinLerMedidas();
    if(Date.now() - v.lidoEm > PPJ_VALIDADE_MS) ppjVinLer();   // outra pessoa pode ter vinculado
  }
  ppjVinRepintar();
}
function ppjVinEscolher(execId){
  const v = _ppjVin;
  if(v.gravando || !Array.isArray(v.execs)) return;
  if(v.escolhida === execId || !v.execs.some(x => x.id === execId)) ppjVinSoltar(v);
  else { v.escolhida = execId; v.confirmar = null; v.foco = null; }
  v.ok = "";
  ppjPosAvisar("");
  ppjVinRepintar();
}
function ppjVinPedirConfirmacao(v, estacaId){
  if(!v.escolhida || v.gravando || !ppjPodeEditar()) return;
  v.confirmar = { execId: v.escolhida, estacaId };
  v.ok = "";
  ppjPosAvisar("");
  ppjVinLerMedidas();
  ppjVinRepintar();
}
/* sugestão clicada na lista: o desenho vai até a estaca e, para quem vincula, abre a confirmação */
function ppjVinIrPara(estacaId){
  const v = _ppjVin, st = _ppjPos, p = st.mapa.get(estacaId), t = ppjTamanho();
  if(!v.escolhida || !p || !st.marcas.has(estacaId)) return;
  if(t && _ppj.visor) ppjMexer(ppjPosCentrar(_ppj.visor, p.x, p.y, t.lw, t.lh, t.W, t.H));
  if(ppjPodeEditar()) ppjVinPedirConfirmacao(v, estacaId);
}
/* Grava o vínculo confirmado, pela mesma RPC da aba Vincular. Se o banco recusar, nada muda na tela e o motivo aparece
   na caixa acima da folha. Depois de gravar, as estacas da obra são relidas: o status nasce no banco. */
async function ppjVinConfirmar(){
  const v = _ppjVin, c = v.confirmar, obraId = v.obraId;
  if(!c || v.gravando || !ppjPodeEditar() || typeof estvGravarVinculo !== "function") return;
  const x = (v.execs || []).find(e => e.id === c.execId), alvo = ppjEstacas().find(e => e.id === c.estacaId);
  if(!x || !alvo){ v.confirmar = null; ppjVinRepintar(); return; }
  v.gravando = true;
  ppjPosAvisar("");
  ppjVinRepintar();
  let r;
  try { r = await estvGravarVinculo(c.execId, c.estacaId, PPJ_VIN_MOTIVO); }
  catch(e){ r = { error: e }; }
  if(v !== _ppjVin) return;
  v.gravando = false;
  if(!r || r.error){
    const erro = (r && r.error) || { message: "sem resposta do banco" };
    console.error("Executadas sem vínculo, gravação:", erro);
    v.confirmar = null;
    const msg = typeof ehErroDePermissao === "function" && ehErroDePermissao(erro) && !/diário/i.test(String(erro.message || ""))
      ? "Seu cargo não vincula execuções a estacas nesta obra. Nada foi gravado."
      : `Não foi possível vincular ${ppjVinNome(x)} à estaca ${ppjVinNumero(alvo)}: ${String(erro.message || erro).replace(/[.\s]+$/, "")}. Nada foi gravado.`;
    ppjPosAvisar(msg);
    aviso("app-aviso", msg, "erro");
    ppjVinRepintar();
    return;
  }
  v.execs = v.execs.filter(e => e.id !== c.execId);
  const irmas = v.execs.filter(e => ppjVinNome(e).toUpperCase() === ppjVinNome(x).toUpperCase()).length;
  ppjVinSoltar(v);
  v.foco = null;
  v.ok = `Execução ${ppjVinNome(x)} vinculada à estaca ${ppjVinNumero(alvo)}.` + (irmas ? ` O mesmo nome aparece em mais ${irmas} ${irmas === 1 ? "execução" : "execuções"} sem vínculo, que ${irmas === 1 ? "continua" : "continuam"} na lista.` : "");
  aviso("app-aviso", `Execução ${ppjVinNome(x)} vinculada à estaca ${ppjVinNumero(alvo)}.`, "ok");
  if(!v.execs.length) v.aberto = false;
  ppjVinRepintar();
  // a estaca muda de cor: o status é refeito pelo banco, e a tela relê as estacas da obra
  if(typeof carregarEstacasDaObra === "function" && obraId === ppjObraId()){
    try { await carregarEstacasDaObra(obraId); }
    catch(e){ console.error("Executadas sem vínculo, releitura das estacas:", e); }
  }
  if(v === _ppjVin) ppjVinLer();
}

/* ---------- desenho ---------- */
function ppjVinPainel(st){
  const v = _ppjVin, area = $("ppj-area");
  if(v.aberto && !ppjVinDisponivel(st) && !(st && st.editando)){ v.aberto = false; ppjVinSoltar(v); }   // a obra ficou sem execução solta, ou a folha sem estaca
  const mostra = v.aberto && ppjVinDisponivel(st) && !!area;
  if(!mostra){
    if(v.painel){ v.painel.remove(); v.painel = null; }
    return;
  }
  if(!v.painel || v.painel.parentNode !== area){
    if(v.painel) v.painel.remove();
    const a = document.createElement("aside");
    a.setAttribute("class", "ppj-painel ppj-vin");
    a.setAttribute("id", "ppj-vin-painel");
    a.setAttribute("aria-label", "Executadas sem vínculo");
    a.innerHTML = ppjVinPainelHTML();
    area.appendChild(a);
    v.painel = a; v.chaveFoco = null; v.chaveLista = null;
    const busca = $("ppj-vin-busca");
    if(busca) busca.value = v.termo;
  }
  const estacas = ppjEstacas(), equips = ppjVinEquips();
  const x = v.escolhida ? v.execs.find(e => e.id === v.escolhida) : null;
  if(v.escolhida && !x) ppjVinSoltar(v);
  const foco = v.foco ? estacas.find(e => e.id === v.foco && e.status === "prevista") : null;
  if(v.foco && !foco) v.foco = null;
  v.sugestoes = x ? ppjVinSugestoes(x, estacas, st.mapa, st.marcas) : [];
  let confirmar = null;
  if(x && v.confirmar){
    const alvo = estacas.find(e => e.id === v.confirmar.estacaId);
    if(!alvo || !ppjPodeEditar()) v.confirmar = null;
    else confirmar = { exec: x, estaca: alvo, gravando: v.gravando, rotuloBloco: ppjVinRotuloBloco(),
      medida: v.medidas === null ? null : v.medidas === false ? "?" : v.medidas.has(alvo.id) };
  }
  const conta = $("ppj-vin-conta"), blocoFoco = $("ppj-vin-foco"), lista = $("ppj-vin-lista");
  if(conta) conta.textContent = `Executadas sem vínculo (${v.execs.length})`;
  const htmlFoco = ppjVinFocoHTML({ exec: x, equips, sugestoes: v.sugestoes, podeEditar: ppjPodeEditar(), confirmar, foco, ok: v.ok });
  if(blocoFoco && htmlFoco !== v.chaveFoco){
    blocoFoco.innerHTML = htmlFoco; v.chaveFoco = htmlFoco;
    // a pergunta tem de estar à vista de quem acabou de clicar no desenho (em tela estreita o painel fica abaixo da folha)
    const pergunta = confirmar && blocoFoco.querySelector ? blocoFoco.querySelector(".ppj-vin-confirma") : null;
    if(pergunta && pergunta.scrollIntoView) pergunta.scrollIntoView({ block: "nearest" });
  }
  const htmlLista = ppjVinListaHTML(ppjVinOrdenar(v.execs, { termo: v.termo, foco }), v.escolhida, equips, !!v.termo);
  if(lista && htmlLista !== v.chaveLista){ lista.innerHTML = htmlLista; v.chaveLista = htmlLista; }
}
/* acende no desenho as estacas sugeridas: um anel em volta do marcador (cheio, tracejado ou pontilhado conforme a
   confiança) e a etiqueta por cima. A estaca da confirmação fica com o contorno da seleção. */
function ppjVinAcender(st){
  if(!st || !st.marcas) return;
  const v = _ppjVin, ativo = v.aberto && ppjVinDisponivel(st) && !!v.escolhida;
  const sugs = new Map(ativo ? v.sugestoes.map(s => [s.id, s]) : []), alvo = ativo && v.confirmar ? v.confirmar.estacaId : null;
  for(const [id, no] of st.marcas){
    const s = sugs.get(id) || null, chave = (s ? s.conf : "") + (alvo === id ? "|alvo" : "");
    if((no.ppjVinChave || "") === chave) continue;
    no.ppjVinChave = chave;
    for(const filho of Array.from(no.children)) if(filho.classList.contains("ppj-vin-anel") || filho.classList.contains("ppj-vin-etq")) filho.remove();
    no.classList.toggle("ppj-vin-sugerida", !!s);
    no.classList.toggle("ppj-vin-alvo", alvo === id);
    if(!s) continue;
    const anel = document.createElementNS(PPJ_POS_NS, "circle"), etq = document.createElementNS(PPJ_POS_NS, "text");
    anel.setAttribute("class", `ppj-vin-anel ppj-vin-anel-${s.nivel}`);
    anel.setAttribute("r", String(PPJ_POS_RAIO + PPJ_VIN_ANEL));
    etq.setAttribute("class", "ppj-vin-etq");
    etq.setAttribute("y", String(-(PPJ_POS_RAIO + PPJ_VIN_ANEL + 4)));
    etq.textContent = s.rotulo;
    no.insertBefore(anel, no.children[0] || null);
    no.appendChild(etq);
  }
}

/* ---------- eventos do visor (delegados: a barra e o painel são redesenhados) ---------- */
function ppjVinClique(ev){
  const alvo = ev.target;
  if(!alvo || !alvo.closest) return;
  const acao = alvo.closest("[data-ppj-vin]");
  if(acao){
    if(acao.disabled) return;
    const v = _ppjVin, qual = acao.dataset.ppjVin;
    if(qual === "abrir") ppjVinAbrir(!v.aberto);
    else if(qual === "fechar") ppjVinAbrir(false);
    else if(qual === "soltar"){ if(!v.gravando){ ppjVinSoltar(v); ppjVinRepintar(); } }
    else if(qual === "limpar-foco"){ v.foco = null; ppjVinRepintar(); }
    else if(qual === "cancelar"){ if(!v.gravando){ v.confirmar = null; ppjVinRepintar(); } }
    else if(qual === "confirmar") ppjVinConfirmar();
    return;
  }
  const exec = alvo.closest("[data-ppj-vin-exec]");
  if(exec) return void ppjVinEscolher(exec.dataset.ppjVinExec);
  const estaca = alvo.closest("[data-ppj-vin-estaca]");
  if(estaca) ppjVinIrPara(estaca.dataset.ppjVinEstaca);
}
function ppjVinTecla(ev){
  const v = _ppjVin, alvo = ev.target, tecla = String(ev.key || "");
  if(!v.aberto || !alvo || !alvo.closest) return;
  if(tecla === "Escape" && !v.gravando && (v.confirmar || v.escolhida)){
    ev.preventDefault();
    if(v.confirmar) v.confirmar = null; else ppjVinSoltar(v);
    ppjVinRepintar();
    return;
  }
  if(tecla !== "Enter" && tecla !== " ") return;
  const exec = alvo.closest("[data-ppj-vin-exec]"), estaca = alvo.closest("[data-ppj-vin-estaca]");
  if(exec){ ev.preventDefault(); ppjVinEscolher(exec.dataset.ppjVinExec); }
  else if(estaca){ ev.preventDefault(); ppjVinIrPara(estaca.dataset.ppjVinEstaca); }
}
function ligarPlantaVinculo(){
  if(typeof $ !== "function") return;
  const visor = $("ppj-visor");
  if(!visor) return;
  visor.addEventListener("click", ppjVinClique);
  visor.addEventListener("keydown", ppjVinTecla);
  visor.addEventListener("input", (ev) => {
    if(!ev.target || ev.target.id !== "ppj-vin-busca") return;
    _ppjVin.termo = String(ev.target.value || "").trim();
    ppjVinPainel(_ppjPos);
  });
}

if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarPlantaVinculo);
  else ligarPlantaVinculo();
}

// teste em Node (scripts/testar-fase169a.mjs): as funções puras saem pelo mesmo module.exports de js/planta_projeto.js
if(typeof module === "object" && module && module.exports){
  Object.assign(module.exports, { PPJ_VIN_VIEW, PPJ_VIN_COLUNAS, PPJ_VIN_MOTIVO, PPJ_VIN_SUG_MAX, PPJ_VIN_LISTA_MAX,
    ppjVinConf, ppjVinComExec, ppjVinSugestoes, ppjVinPodeAlvo, ppjVinOrdenar, ppjVinResumo, ppjVinPergunta, ppjVinSub,
    ppjVinBotaoHTML, ppjVinPainelHTML, ppjVinListaHTML, ppjVinSugestaoHTML, ppjVinConfirmacaoHTML, ppjVinFocoHTML });
}

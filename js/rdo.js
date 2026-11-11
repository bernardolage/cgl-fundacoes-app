/* ====================================================================
   Módulo: RDO unificado por categoria
   Tipos: helice_continua, trado_mecanizado, estaca_raiz, helice_secante
   1 RDO por dia/obra com execuções por estaca (rdo_execucao_estaca).
   Layout: padrão Serviços + Odoo.
   ==================================================================== */

let _rdos     = [];
let _rdoView  = "lista";
let rdoEditId = null;
let _rdoExecucoes  = [];      // execuções do RDO atual
let _rdoEquipe     = [];   // equipe do dia (genérico, todos os tipos de RDO)
let _rdoVoltarPara = null; // chamado #8 (Isaque, 16/09/2026): obra_id quando o RDO foi aberto pela aba RDOs da obra — o Voltar devolve para lá
let _rdoAbast      = [];   // abastecimento do dia (fase 46, 16/09/2026): litros/horímetro do diário do operador
let _rdoEquipes    = [];   // cache equipes cadastradas (pra modal "Importar equipe")
let _rdoRaizSolo   = [];
let _rdoAtividades = [];   // chamado #5: atividades hora-a-hora do dia (rdo_raiz_justificativa, execucao_id nulo)
let _rdoRaizEquipe = [];
let _rdoRaizDados  = null;
let _rdoFuncs = [];           // cache funcionários
/* fase 129c: o que a ficha leu do banco (cabeçalho e linhas de execução, equipe e abastecimento, uma cópia em texto por id).
   Salvar confere de novo antes de gravar e só apaga as linhas que a ficha leu e o usuário tirou da tela: o que o app do campo,
   a sync do Geodigitus ou outra pessoa gravou depois fica no diário. */
let _rdoSnap = null;
const RDO_CAB_CONFERE = ["obra_id", "data", "tipo_servico", "equipamento_id", "turno_campo", "status", "responsavel_id", "local",
  "tempo_manha", "tempo_tarde", "feriado", "efetivo_proprio", "efetivo_terceiro", "atividades", "observacoes", "enviado_em", "devolvido_em"];
let _rdoCampo = { rdo: null, fotos: [], paradas: [], pendencias: [], origens: null, nomes: {} };   // fase 129c: o que veio do app do campo
const FERRAMENTAS_RAIZ = { revestimento:"Revestimento", martelo:"Martelo", tricone:"Tricone", trado:"Trado", outro:"Outro" };
/* fase 101 (#99): volume injetado (m³) e água (L) por estaca. As colunas nascem na migration da fase 101: só entram no
   insert quando preenchidas, para o front não quebrar se for publicado antes dela. */
function rdoCamposInjecao(e){
  const o = {};
  const vi = numOrNull(e && e.volume_injetado_m3), ag = numOrNull(e && e.agua_l);
  if(vi != null) o.volume_injetado_m3 = vi;
  if(ag != null) o.agua_l = ag;
  return o;
}
const RDO_SOLO_CLASSIF_PADRAO = ["Aterro", "Argila", "Argila arenosa", "Argila siltosa", "Argiloso c/ cascalho", "Areia", "Areia argilosa",
  "Silte", "Silte arenoso", "Cascalho", "Alteração de rocha", "Rocha alterada", "Rocha sã", "Matacão"];
let _rdoSoloClassif = null;   // empresa_config.rdo_solo_classificacoes (fase 101); null = ainda não lida
async function rdoCarregarSoloClassif(){
  if(_rdoSoloClassif) return _rdoSoloClassif;
  const { data, error } = await sb.from("empresa_config").select("rdo_solo_classificacoes").eq("id", 1).maybeSingle();
  const lista = !error && data && Array.isArray(data.rdo_solo_classificacoes) ? data.rdo_solo_classificacoes.filter(Boolean) : [];
  _rdoSoloClassif = lista.length ? lista : RDO_SOLO_CLASSIF_PADRAO;
  const dl = $("rdo-solo-classif-lista");
  if(dl) dl.innerHTML = _rdoSoloClassif.map(c => `<option value="${esc(c)}"></option>`).join("");
  return _rdoSoloClassif;
}
const RDO_UN_CIM = { saco: "sc", kg: "kg", m3: "m³" };
const RDO_UN_AREIA = { m3: "m³", kg: "kg", padiola: "padiola" };
// "cimento 10 sc · areia 2 padiola · água 400 L · 3 m³ injetados · 3 kg/cm²"
function rdoResumoInjecao(e){
  const p = [];
  if(String(e.consumo_cimento_raiz || "").trim()) p.push(`cimento ${e.consumo_cimento_raiz}${e.consumo_cimento_unidade ? " " + (RDO_UN_CIM[e.consumo_cimento_unidade] || e.consumo_cimento_unidade) : ""}`);
  if(String(e.consumo_areia_raiz || "").trim()) p.push(`areia ${e.consumo_areia_raiz}${e.consumo_areia_unidade ? " " + (RDO_UN_AREIA[e.consumo_areia_unidade] || e.consumo_areia_unidade) : ""}`);
  if(numOrNull(e.agua_l) != null) p.push(`água ${num(numOrNull(e.agua_l))} L`);
  if(numOrNull(e.volume_injetado_m3) != null) p.push(`${num(numOrNull(e.volume_injetado_m3))} m³ injetados`);
  if(numOrNull(e.pressao_injecao_kgcm2) != null) p.push(`${num(numOrNull(e.pressao_injecao_kgcm2))} kg/cm²`);
  return p.join(" · ");
}
// texto da sub-linha da estaca de raiz: camadas + injeção (vazio = "sem camadas")
function rdoResumoLinhaRaizHTML(e){
  const cam = rdoResumoCamadas(e), inj = rdoResumoInjecao(e);
  return `${cam ? "⛏️ " + esc(cam) : '<span class="rdo-camadas-vazio">⛏️ sem camadas de solo</span>'}${inj ? " &nbsp;·&nbsp; 💧 " + esc(inj) : ""}`;
}
function rdoAtualizarResumoLinha(idx){
  const e = _rdoExecucoes[idx]; if(!e) return;
  const td = document.querySelector(`#rdo-execs tr[data-resumo-idx="${idx}"] td`);
  if(td) td.innerHTML = rdoResumoLinhaRaizHTML(e);
  const b = document.querySelector(`#rdo-execs .btn-boletim-toggle[data-idx="${idx}"]`);
  if(b) b.textContent = `Camadas${(e._solo || []).length ? " (" + e._solo.length + ")" : ""}`;
  rdoRenderTotaisRaiz();
}
/* totais do dia (raiz): cimento e areia por unidade, água e m³ injetado — rodapé da aba Execuções */
function rdoTotaisInjecao(execs){
  const t = { cimento: {}, areia: {}, agua: 0, vol: 0, temAgua: false, temVol: false };
  (execs || []).forEach(e => {
    const c = numOrNull(e.consumo_cimento_raiz), a = numOrNull(e.consumo_areia_raiz);
    if(c != null){ const u = e.consumo_cimento_unidade || "saco"; t.cimento[u] = (t.cimento[u] || 0) + c; }
    if(a != null){ const u = e.consumo_areia_unidade || "m3"; t.areia[u] = (t.areia[u] || 0) + a; }
    if(numOrNull(e.agua_l) != null){ t.agua += numOrNull(e.agua_l); t.temAgua = true; }
    if(numOrNull(e.volume_injetado_m3) != null){ t.vol += numOrNull(e.volume_injetado_m3); t.temVol = true; }
  });
  return t;
}
function rdoTotaisInjecaoTxt(t){
  const un = (o, mapa) => Object.entries(o).map(([u, v]) => `${num(v)} ${mapa[u] || u}`).join(" + ");
  return [Object.keys(t.cimento).length ? ["Cimento", un(t.cimento, RDO_UN_CIM)] : null,
          Object.keys(t.areia).length ? ["Areia", un(t.areia, RDO_UN_AREIA)] : null,
          t.temAgua ? ["Água", `${num(t.agua)} L`] : null,
          t.temVol ? ["Injetado", `${num(t.vol)} m³`] : null].filter(Boolean);
}
function rdoRenderTotaisRaiz(){
  const box = $("rdo-raiz-totais");
  if(!box) return;
  const ehRaiz = $("rdo-tipo-servico")?.value === "estaca_raiz";
  const itens = ehRaiz ? rdoTotaisInjecaoTxt(rdoTotaisInjecao(_rdoExecucoes)) : [];
  box.style.display = itens.length ? "" : "none";
  box.innerHTML = itens.length ? `<span>💧 <strong>Injeção do dia</strong></span>` + itens.map(([l, v]) => `<span>${esc(l)}: <strong>${esc(v)}</strong></span>`).join("") : "";
}
// "0–5 m argiloso c/ cascalho · revestimento; 5–12 m rocha · martelo" (linha da estaca, visível sem expandir)
function rdoResumoCamadas(e){
  const fmt = (v) => v == null ? "?" : num(v);
  return (e._solo || []).filter(s => s.inicio_ml != null || s.final_ml != null || s.classificacao || s.ferramenta)
    .map(s => `${fmt(s.inicio_ml)}–${fmt(s.final_ml)} m${s.classificacao ? " " + s.classificacao : ""}${s.ferramenta ? " · " + (FERRAMENTAS_RAIZ[s.ferramenta] || s.ferramenta).toLowerCase() : ""}`)
    .join("; ");
}
let _rdoEquipsCache = [];     // cache equipamentos
let _rdoVizinhos = { anterior: null, proximo: null, indice: 0, total: 0 };
let _rdoBoletimAberto = null;
let _rdoObraParams = null;    // obras.concretagem_tipo_padrao/traco/peso_saco/fator_perda/jornada_* da obra da ficha
let _rdoMaqOriginal = null;   // fase 101: máquina gravada do diário aberto (a troca vai para registros_log pelo gatilho)

const RDO_STAGES = ["rascunho","finalizado"];

/* fase 94 (#75): etapa final reconhecida. Espelho de fn_rdo_exec_etapa_final: quem GRAVA etapa_final é o gatilho
   trg_rdo_exec_antes no banco; aqui só se mostra, na grade e na prévia de importação, o que vai acontecer ao salvar.
   metragem (no dia ou acumulado) → "metragem"; senão, nome de estaca + palavra de empresa_config.rdo_palavras_etapa_final
   na observação → injeção/concretagem/argamassado pela raiz da palavra. Sem etapa, a linha fica vinculada à estaca
   mas não muda o status dela (locação, marcação, descida de armação). */
const RDO_ETAPA_LBL = { metragem: "metragem", injecao: "injeção", concretagem: "concretagem", argamassado: "argamassado", outra: "outra etapa" };
const RDO_PALAVRAS_PADRAO = ["injeção", "injetada", "concretagem", "concretada", "argamassado", "argamassa"];
let _rdoPalavrasEtapa = null;   // null = ainda não lidas do banco
function rdoSemAcento(s){ return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
async function rdoCarregarPalavrasEtapa(){
  if(_rdoPalavrasEtapa) return _rdoPalavrasEtapa;
  const { data } = await sb.from("empresa_config").select("rdo_palavras_etapa_final").eq("id", 1).maybeSingle();
  const lista = data && Array.isArray(data.rdo_palavras_etapa_final) ? data.rdo_palavras_etapa_final.filter(Boolean) : [];
  _rdoPalavrasEtapa = lista.length ? lista : RDO_PALAVRAS_PADRAO;
  return _rdoPalavrasEtapa;
}
function rdoEtapaFinal(e){
  if((Number(e.profundidade_executada) || 0) > 0 || (Number(e.perfuracao_ate_m) || 0) > 0) return "metragem";
  if(!String(e.estaca_numero || "").trim() || !String(e.observacoes || "").trim()) return null;
  const obs = rdoSemAcento(e.observacoes);
  for(const p0 of (_rdoPalavrasEtapa || RDO_PALAVRAS_PADRAO)){
    const p = rdoSemAcento(p0).trim();
    if(p && obs.includes(p)) return /inje/.test(p) ? "injecao" : /concret/.test(p) ? "concretagem" : /argamass/.test(p) ? "argamassado" : "outra";
  }
  return null;
}
function rdoEtapaHTML(e){
  const et = rdoEtapaFinal(e);
  if(!et) return `<span class="meta" title="Sem metragem e sem palavra de etapa final na observação: a linha fica ligada à estaca, mas não muda o status dela">—</span>`;
  const porObs = et !== "metragem";
  return `<span class="tag ${porObs ? "ambar" : "verde"}" title="${porObs ? "Reconhecida pela observação: a estaca conta como executada neste dia (fica duas semanas em Para regularizar para conferência)" : "Há metragem: a estaca conta como executada"}">${esc(RDO_ETAPA_LBL[et] || et)}</span>`;
}

/* lote S42 (L5): texto do diário → equipamento. Aceita o código externo, o código (com ou sem espaço/hífen), o nome
   e os apelidos TAG-NN, TAG NN, EQP-NN, EQ NN e NN (o número da TAG: equipamentos.codigo começa com "NN-"; com
   letra, "55B" casa "55B-CM"). Devolve o equipamento ou null; número que serve a mais de uma TAG também devolve null. */
function rdoCasarMaquina(texto){
  const t = String(texto || "").trim().toUpperCase(); if(!t) return null;
  const chaves = [t, t.replace(/\s/g, ""), t.replace(/-/g, "")];
  const eq = _rdoEquipsCache.find(e => [e.codigo_externo, e.codigo, (e.codigo || "").replace(/\s/g, ""), (e.codigo || "").replace(/-/g, ""), e.nome]
    .filter(Boolean).some(c => chaves.includes(String(c).toUpperCase())));
  if(eq) return eq;
  const m = t.match(/^(?:TAG|EQP|EQ|M[ÁA]Q(?:UINA)?)?[\s\-.:]*(\d{1,3})([A-Z]?)$/);
  if(!m) return null;
  const re = new RegExp("^" + m[1] + m[2] + "-");
  const cands = _rdoEquipsCache.filter(e => re.test(String(e.codigo || "").toUpperCase()));
  return cands.length === 1 ? cands[0] : null;
}

const TIPO_SERVICO = {
  helice_continua:   { label: "Hélice contínua", cor: "azul",     icone: "🌀" },
  trado_mecanizado:  { label: "Trado mecanizado", cor: "ambar",   icone: "🔩" },
  estaca_raiz:       { label: "Estaca raiz",     cor: "verde",    icone: "🌱" },
  helice_secante:    { label: "Hélice secante",  cor: "vermelho", icone: "🛡️" }
};

/* ---------- Selects fixos ---------- */
function rdoMontarSelectsFixos(){
  const optTempo = '<option value="">—</option>' +
    Object.entries(CONDICAO_TEMPO).map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join("");
  $("rdo-tempo-manha").innerHTML = optTempo;
  $("rdo-tempo-tarde").innerHTML = optTempo;
  $("rdo-status").innerHTML = opcoesStatus("rdo");
  $("rdo-tipo-servico").innerHTML = Object.entries(TIPO_SERVICO)
    .map(([v,o]) => `<option value="${esc(v)}">${esc(o.icone)} ${esc(o.label)}</option>`).join("");
}

function rdoPreencherObras(){
  const obras = Object.entries(mapaObras).map(([id,nome])=>({ id, nome }));
  obras.sort((a,b)=> a.nome.localeCompare(b.nome,"pt-BR"));
  const optObras = obras.map(o=>`<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join("");
  $("rdo-f-obra").innerHTML = '<option value="">Todas as obras</option>' + optObras;
  $("rdo-obra").innerHTML   = '<option value="">— selecione —</option>'  + optObras;
}

async function rdoCarregarAuxiliares(){
  const [f, e, p] = await Promise.all([
    sb.from("funcionarios").select("id,nome,matricula,funcao").eq("ativo",true).order("nome"),
    sb.from("equipamentos").select("id,codigo,nome,codigo_externo,tipo,horimetro").eq("ativo",true).order("codigo"),   // fase 92: horímetro atual no bloco de abastecimento
    sb.from("profiles").select("id,nome").eq("ativo",true).order("nome")
  ]);
  _rdoFuncs = f.data || [];
  _rdoEquipsCache = e.data || [];
  // chamado #30: rdo.responsavel_id aponta para profiles, não para funcionarios
  preencherSelect($("rdo-responsavel"), p.data || [], "id", "nome", "— não informado —");
  // fase 94 (#77): máquina do diário no cabeçalho e filtro por máquina na lista (perfuratriz e bate-estaca primeiro)
  const ehPerf = (q) => ["perfuratriz", "bate_estaca"].includes(q.tipo) ? 0 : 1;
  const maqs = [..._rdoEquipsCache].sort((a, b) => ehPerf(a) - ehPerf(b) || String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR", { numeric: true }));
  const optMaq = maqs.map(q => `<option value="${esc(q.id)}">${esc(q.codigo || "")}${q.nome ? " — " + esc(q.nome) : ""}</option>`).join("");
  const selEq = $("rdo-equipamento");
  if(selEq){ const v = selEq.value; selEq.innerHTML = '<option value="">— sem máquina (equipe de apoio) —</option>' + optMaq; selEq.value = v; }
  const selF = $("rdo-f-maquina");
  if(selF){ const v = selF.value; selF.innerHTML = '<option value="">Todas as máquinas</option><option value="sem">Sem máquina</option>' + optMaq; selF.value = v; }
  rdoCarregarPalavrasEtapa();
  rdoCarregarSoloClassif();   // fase 101 (#99): sugestões da classificação do solo
}

/* fase 101 (#85): o campo Equipamento do cabeçalho lista primeiro as máquinas da obra (vw_obra_equipamentos: mobilização
   ativa, RDO recente, vínculo manual) e depois as demais; na obra com rdo_exige_equipamento o aviso diz que é obrigatório
   (quem recusa é o gatilho trg_rdo_exige_equipamento). Sem a migration aplicada, a lista fica como na fase 94. */
let _rdoMaqObraIds = [];
let _rdoObraExige = false;
async function rdoMontarSelectMaquina(obraId){
  const sel = $("rdo-equipamento");
  if(!sel) return;
  _rdoMaqObraIds = []; _rdoObraExige = false;
  if(obraId){
    const [v, o] = await Promise.all([
      sb.from("vw_obra_equipamentos").select("equipamento_id").eq("obra_id", obraId),
      sb.from("obras").select("rdo_exige_equipamento").eq("id", obraId).maybeSingle()
    ]);
    if(($("rdo-obra")?.value || null) !== obraId) return;   // trocou de obra enquanto lia
    if(!v.error) _rdoMaqObraIds = [...new Set((v.data || []).map(x => x.equipamento_id))];
    if(!o.error) _rdoObraExige = !!o.data?.rdo_exige_equipamento;
  }
  const atual = sel.value;
  const ehPerf = (q) => ["perfuratriz", "bate_estaca"].includes(q.tipo) ? 0 : 1;
  const ord = (a, b) => ehPerf(a) - ehPerf(b) || String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR", { numeric: true });
  const daObra = new Set(_rdoMaqObraIds);
  const opt = (q) => `<option value="${esc(q.id)}">${esc(q.codigo || "")}${q.nome ? " — " + esc(q.nome) : ""}</option>`;
  const lst1 = _rdoEquipsCache.filter(q => daObra.has(q.id)).sort(ord), lst2 = _rdoEquipsCache.filter(q => !daObra.has(q.id)).sort(ord);
  sel.innerHTML = `<option value="">${_rdoObraExige ? "— escolha a máquina (obrigatório nesta obra) —" : "— sem máquina (equipe de apoio) —"}</option>`
    + (lst1.length ? `<optgroup label="Máquinas da obra">${lst1.map(opt).join("")}</optgroup><optgroup label="Demais máquinas">${lst2.map(opt).join("")}</optgroup>` : lst2.map(opt).join(""));
  sel.value = atual;
  if(atual && sel.value !== atual){   // máquina inativa (fora do cache): mantém o valor gravado
    sel.insertAdjacentHTML("beforeend", `<option value="${esc(atual)}">máquina inativa</option>`); sel.value = atual;
  }
  rdoAtualizarChipMaquina(sel.value || null);
}

/* ---------- Carga lista ---------- */
async function carregarRDO(){
  rdoMontarSelectsFixos();
  rdoPreencherObras();
  await rdoCarregarAuxiliares();
  const sel = $("rdo-f-status");
  if(sel && !sel.options.length){
    sel.innerHTML = `<option value="">Todos os status</option>` + opcoesStatus("rdo")
      // fase 129c: diários do app do campo (enviados e ainda não finalizados; devolvidos esperando o operador)
      + `<option value="campo_enviado">Enviados pelo campo</option><option value="campo_devolvido">Devolvidos ao campo</option>`;
  }
  if(_rdoPreset){   // fase 129c: filtro pedido pelo Para regularizar
    if(sel) sel.value = _rdoPreset.status || "";
    if($("rdo-f-obra")) $("rdo-f-obra").value = _rdoPreset.obra || "";
    _rdoPreset = null;
  }
  const selT = $("rdo-f-tipo");
  if(selT && !selT.options.length){
    selT.innerHTML = `<option value="">Todos os tipos</option>` +
      Object.entries(TIPO_SERVICO).map(([v,o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("");
  }
  // Busca RDOs + execuções agregadas via view
  // fase 129c: envio e devolução do campo vêm da própria rdo (vw_rdo_resumo não tem as colunas; nada de mexer na view)
  const [res, campo] = await Promise.all([
    lerTudo(() => sb.from("vw_rdo_resumo").select("*").order("data", { ascending:false })),
    lerTudo(() => sb.from("rdo").select("id,enviado_em,devolvido_em").or("enviado_em.not.is.null,devolvido_em.not.is.null"))
  ]);
  const { data, error } = res;
  const porId = new Map((campo.error ? [] : campo.data || []).map(c => [c.id, c]));
  _rdos = error ? [] : (data || []).map(r => porId.has(r.id) ? { ...r, ...porId.get(r.id) } : r);
  renderRDO();
}

/* ---------- Filtros ---------- */
function rdoFiltrados(){
  const termo  = ($("rdo-busca")?.value || "").trim().toLowerCase();
  const fObra  = $("rdo-f-obra")?.value || "";
  const fStat  = $("rdo-f-status")?.value || "";
  const fTipo  = $("rdo-f-tipo")?.value || "";
  const fMaq   = $("rdo-f-maquina")?.value || "";   // fase 94: "" todas · "sem" diário sem máquina · uuid
  return _rdos.filter(r => {
    if(fObra && r.obra_id !== fObra) return false;
    if(fStat === "campo_enviado"){ if(!(r.enviado_em && r.status === "rascunho" && !rdoDevolvidoAberto(r))) return false; }   // fase 129c
    else if(fStat === "campo_devolvido"){ if(!(r.status === "rascunho" && rdoDevolvidoAberto(r))) return false; }
    else if(fStat && r.status !== fStat) return false;
    if(fTipo && r.tipo_servico !== fTipo) return false;
    if(fMaq === "sem" ? r.equipamento_id : (fMaq && r.equipamento_id !== fMaq)) return false;
    if(!termo) return true;
    const alvo = `${mapaObras[r.obra_id]||""} ${dataBR(r.data)} ${(TIPO_SERVICO[r.tipo_servico]||{}).label||""} ${r.maquina || ""}`.toLowerCase();
    return alvo.includes(termo);
  });
}

/* ---------- Render ---------- */
function renderRDO(){
  // fase 107a: visão "Chegadas do Geodigitus" (js/geodigitus.js) troca os filtros e o conteúdo do painel
  const ehGeo = _rdoView === "geo" && typeof geoRenderPainel === "function";
  if($("rdo-filtros")) $("rdo-filtros").style.display = ehGeo ? "none" : "";
  if($("geo-filtros")) $("geo-filtros").style.display = ehGeo ? "" : "none";
  if(ehGeo){ geoRenderPainel(); return; }
  const dados = rdoFiltrados();
  const cont = $("rdo-contador");
  if(cont) cont.textContent = `${dados.length} de ${_rdos.length}`;
  if(_rdoView === "kanban") renderRDOKanban(dados);
  else                       renderRDOLista(dados);
  const legacy = $("tab-rdo");
  if(legacy) legacy.innerHTML = "";
}

function renderRDOLista(dados){
  const cont = $("rdo-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum RDO cadastrado.</p>`;
    return;
  }
  const linhas = dados.map(r => {
    const t = TIPO_SERVICO[r.tipo_servico] || { label: r.tipo_servico, icone: "" };
    return `<tr class="linha-clicavel" data-id="${esc(r.id)}">
      <td title="${dataBR(r.data)}">${/* html */ rdoCelulaData(r.data)}${/* html */ rdoTagTurno(r)}</td>
      <td>${linkObra(r.obra_id)}</td>
      <td>${esc(t.icone)} ${esc(t.label)}</td>
      <td>${r.equipamento_id ? `<span class="ui-codigo">${rdoCelulaMaquina(r)}</span>` : rdoCelulaMaquina(r)}</td>
      <td class="num">${esc(r.qtd_estacas_executadas || 0)}</td>
      <td class="num">${num(r.metragem_total)} m</td>
      <td class="num">${num(r.concreto_total_m3)} m³</td>
      <td>${tagStatus("rdo", r.status)}${/* html */ rdoTagCampoLista(r)}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Data</th><th>Obra</th><th>Tipo</th><th title="Cada máquina tem o seu diário na mesma obra e data">Máquina</th><th class="num">Estacas</th>
      <th class="num">Metragem</th><th class="num">Concreto</th><th>Status</th>
    </tr></thead>
    <tbody>${/* html */ linhas}</tbody></table></div>`;
}

function renderRDOKanban(dados){
  const cont = $("rdo-conteudo");
  if(!cont) return;
  // Agrupa por tipo → e dentro, por obra (1 card por obra agregando todos os RDOs)
  const colunas = Object.entries(TIPO_SERVICO).map(([tipo, meta]) => {
    const itens = dados.filter(r => r.tipo_servico === tipo);
    // Agrupa por obra
    const porObra = {};
    itens.forEach(r => {
      const oid = r.obra_id || "_sem_obra";
      if(!porObra[oid]) porObra[oid] = { obra_id: r.obra_id, rdos: [] };
      porObra[oid].rdos.push(r);
    });
    // Ordena obras por nome
    const grupos = Object.values(porObra).sort((a,b) => {
      const na = mapaObras[a.obra_id] || "";
      const nb = mapaObras[b.obra_id] || "";
      return na.localeCompare(nb, "pt-BR");
    });
    const cards = grupos.map(g => {
      const r = g.rdos;
      const qtdEstacas = r.reduce((s,x) => s + (Number(x.qtd_estacas_executadas) || 0), 0);
      const metragem = r.reduce((s,x) => s + (Number(x.metragem_total) || 0), 0);
      const concreto = r.reduce((s,x) => s + (Number(x.concreto_total_m3) || 0), 0);
      const datas = r.map(x => x.data).filter(Boolean).sort();
      const periodo = datas.length
        ? (datas[0] === datas[datas.length-1]
            ? dataBR(datas[0])
            : `${dataBR(datas[0])} → ${dataBR(datas[datas.length-1])}`)
        : "";
      const rascunhos = r.filter(x => x.status === "rascunho").length;
      const finalizados = r.filter(x => x.status === "finalizado").length;
      const statusBadges = [];
      if(rascunhos) statusBadges.push(`<span class="tag cinza">${rascunhos} rascunho${rascunhos>1?'s':''}</span>`);
      if(finalizados) statusBadges.push(`<span class="tag verde">${finalizados} final${finalizados>1?'izados':'izado'}</span>`);
      return `
      <div class="serv-kan-card linha-clicavel rdo-obra-grupo" data-obra-id="${esc(g.obra_id||"")}" data-tipo="${esc(tipo)}">
        <div class="serv-kan-card-nome">${esc(mapaObras[g.obra_id]||"(sem obra)")}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">📋 ${r.length} RDO${r.length>1?'s':''} · ${qtdEstacas} estaca${qtdEstacas>1?'s':''}</span>
          <span style="font-size:var(--txt-xs);color:var(--acao-txt);display:block;">${esc(periodo)}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${num(metragem)} m</span>
          <strong>${num(concreto)} m³</strong>
        </div>
        ${statusBadges.length ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${/* html */ statusBadges.join("")}</div>` : ""}
      </div>`;
    }).join("");
    return `<div class="serv-kan-col">
      <div class="serv-kan-col-head">${esc(meta.icone)} ${esc(meta.label)}<span>${grupos.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelRDO(){
  $("rdo-painel").style.display = "";
  $("rdo-ficha").style.display = "none";
  rdoEditId = null;
  // Chamado #8 (Isaque, 16/09/2026): RDO aberto por Obras › RDOs volta para a ficha da obra, na aba RDOs,
  // em vez da lista geral do Diário de Obra. A marca é limpa aqui e em qualquer clique no menu lateral.
  if(_rdoVoltarPara){
    const obraId = _rdoVoltarPara; _rdoVoltarPara = null;
    irParaSecao("obras");
    // hotfix carga do banco: obra já aberta só mostra a aba RDOs e atualiza contagens; reabrir custava cerca de 65 requisições
    if(typeof obraEditId !== "undefined" && obraEditId === obraId && $("obr-ficha")?.style.display !== "none"){
      _obrEstacasDesatualizadas = true;
      ativarTabObra("rdos");
      carregarRDOsDaObra(obraId);
      carregarAbasObra(obraId);
      return;
    }
    if(typeof abrirObra === "function") Promise.resolve(abrirObra(obraId)).then(() => { if(typeof ativarTabObra === "function") ativarTabObra("rdos"); });
  }
}

async function novoRDO(){
  rdoEditId = null;
  _rdoExecucoes = [];
  _rdoEquipe = [];
  _rdoAbast = []; if(typeof renderRdoAbast === "function") renderRdoAbast();
  _rdoRaizSolo = [];
  _rdoAtividades = [];
  _rdoRaizEquipe = [];
  _rdoRaizDados = null;
  $("rdo-obra").value = "";
  $("rdo-data").value = hojeISO();
  if($("rdo-feriado")) $("rdo-feriado").checked = false;
  $("rdo-tipo-servico").value = "helice_continua";
  if($("rdo-equipamento")) $("rdo-equipamento").value = "";   // fase 94
  if($("rdo-turno")) $("rdo-turno").value = "diurno";   // fase 134b
  _rdoMaqOriginal = null;
  $("rdo-status").value = "rascunho";
  $("rdo-responsavel").value = "";
  if($("rdo-local")) $("rdo-local").value = "";
  carregarLocaisRDO(null);
  carregarParamsObraRDO(null); // limpa a jornada/concretagem da ficha anterior e esconde o chip de jornada
  $("rdo-tempo-manha").value = "";
  $("rdo-tempo-tarde").value = "";
  $("rdo-efetivo-proprio").value = 0;
  $("rdo-efetivo-terceiro").value = 0;
  $("rdo-atividades").value = "";
  $("rdo-obs").value = "";
  ["rdo-raiz-folha","rdo-raiz-projeto","rdo-raiz-local","rdo-raiz-bloco"]
    .forEach(k => { const el = $(k); if(el) el.value = ""; });
  _rdoBoletimAberto = null;
  _rdoSnap = null;   // fase 129c: diário novo não tem o que conferir
  _rdoCampo = { rdo: null, fotos: [], paradas: [], pendencias: [], origens: null, nomes: {} };
  $("btn-excluir-rdo").style.display = "none";
  abrirFichaRDOVisual({ status: "rascunho", tipo_servico: "helice_continua" });
}

async function abrirRDO(id){
  rdoEditId = id;
  _rdoBoletimAberto = null;
  const [rdo, execs, dadosRaiz, equipe, abast, ativs] = await Promise.all([
    sb.from("rdo").select("*").eq("id", id).single(),
    sb.from("rdo_execucao_estaca").select("*").eq("rdo_id", id).order("perfuracao_inicio"),
    sb.from("rdo_raiz_dados").select("*").eq("rdo_id", id).maybeSingle(),
    sb.from("rdo_equipe").select("*").eq("rdo_id", id).order("ordem"),
    sb.from("rdo_abastecimento").select("*").eq("rdo_id", id).order("ordem"),
    // chamado #5: atividades hora-a-hora do dia (linhas sem execucao_id; as com execucao_id são as paradas do boletim raiz)
    sb.from("rdo_raiz_justificativa").select("id,ordem,h_inicial,h_final,motivo").eq("rdo_id", id).is("execucao_id", null).order("ordem")
  ]);
  if(rdoEditId !== id) return;   // fase 142: abriu outra ficha enquanto esta carregava
  if(rdo.error){ aviso("app-aviso","Erro: "+rdo.error.message,"erro"); return; }
  // Se a leitura das execuções/equipe falhar (rede, RLS), NÃO abrir a ficha:
  // salvarRDO faz delete+insert dos filhos e reinseriria um array vazio,
  // apagando as execuções do dia. Abortar aqui é o que evita perda de dados.
  const falha = execs.error || equipe.error || dadosRaiz.error || abast.error || ativs.error;
  if(falha){
    rdoEditId = null;
    aviso("app-aviso","Não foi possível carregar as execuções deste RDO ("+falha.message+"). Tente abrir de novo.","erro");
    return;
  }
  _rdoSnap = rdoSnapshot(id, rdo.data, execs.data, equipe.data, abast.data);   // fase 129c: antes de qualquer mudança na tela
  const data = rdo.data;
  $("rdo-obra").value             = data.obra_id || "";
  $("rdo-data").value             = (data.data||"").slice(0,10);
  if($("rdo-feriado")) $("rdo-feriado").checked = !!data.feriado;
  $("rdo-tipo-servico").value     = data.tipo_servico || "helice_continua";
  if($("rdo-equipamento")) $("rdo-equipamento").value = data.equipamento_id || "";   // fase 94
  if($("rdo-turno")) $("rdo-turno").value = data.turno_campo || "diurno";   // fase 134b: período nulo conta como diurno
  _rdoMaqOriginal = data.equipamento_id || null;   // fase 101: trocar a máquina leva junto as execuções que eram dela
  $("rdo-status").value           = data.status || "rascunho";
  $("rdo-responsavel").value      = data.responsavel_id || "";
  if($("rdo-local")) $("rdo-local").value = data.local || "";
  carregarLocaisRDO(data.obra_id);
  carregarParamsObraRDO(data.obra_id);
  $("rdo-tempo-manha").value      = data.tempo_manha || "";
  $("rdo-tempo-tarde").value      = data.tempo_tarde || "";
  $("rdo-efetivo-proprio").value  = data.efetivo_proprio ?? 0;
  $("rdo-efetivo-terceiro").value = data.efetivo_terceiro ?? 0;
  $("rdo-atividades").value       = data.atividades || "";
  $("rdo-obs").value              = data.observacoes || "";

  _rdoExecucoes  = (execs.data || []).map(e => ({ ...e, _solo: [], _just: [] }));
  // fase 107a: badge "Geodigitus" e sobreconsumo das execuções que vieram do computador de bordo
  if(typeof geoCarregarExecs === "function") geoCarregarExecs(_rdoExecucoes).then(tem => { if(tem && rdoEditId === id) geoAplicarBadgesExec(_rdoExecucoes); });
  _rdoEquipe     = equipe.data || [];
  _rdoRaizEquipe = _rdoEquipe.map(e => ({ funcionario_id: e.funcionario_id, nome_avulso: e.nome_avulso }));
  _rdoRaizDados  = dadosRaiz.data || null;
  _rdoRaizSolo   = [];
  _rdoAtividades = (ativs.data || []).map(a => ({ h_inicial: a.h_inicial, h_final: a.h_final, motivo: a.motivo }));
  // fase 46 + correção de 06/10/2026: o abastecimento do dia era lido em abrirFichaRDOVisual, onde `abast` não existe;
  // o RDO aberto ficava sem abastecimento na tela e salvar apagava o que estava gravado
  _rdoAbast = (abast.data || []).map(a => ({ ...a }));

  // Fase 20+: carrega solo/just por execucao_id
  if(data.tipo_servico === "estaca_raiz"){
    const execIds = _rdoExecucoes.map(e => e.id).filter(Boolean);
    if(execIds.length){
      const [sr, jr] = await Promise.all([
        sb.from("rdo_raiz_solo").select("*").in("execucao_id", execIds).order("ordem"),
        sb.from("rdo_raiz_justificativa").select("*").in("execucao_id", execIds).order("ordem")
      ]);
      const solosExec = sr.data || [];
      const justsExec = jr.data || [];
      _rdoExecucoes = _rdoExecucoes.map(e => ({
        ...e,
        _solo: solosExec.filter(s => s.execucao_id === e.id),
        _just: justsExec.filter(j => j.execucao_id === e.id)
      }));
    }
  }

  if(_rdoRaizDados){
    $("rdo-raiz-folha").value   = _rdoRaizDados.folha || "";
    $("rdo-raiz-projeto").value = _rdoRaizDados.projeto || "";
    $("rdo-raiz-local").value   = _rdoRaizDados.local_obra || "";
    $("rdo-raiz-bloco").value   = _rdoRaizDados.bloco || "";
  } else {
    ["rdo-raiz-folha","rdo-raiz-projeto","rdo-raiz-local","rdo-raiz-bloco"]
      .forEach(k => { const el = $(k); if(el) el.value = ""; });
  }
  $("btn-excluir-rdo").style.display = "";
  _rdoCampo = { rdo: null, fotos: [], paradas: [], pendencias: [], origens: null, nomes: {} };   // fase 129c
  abrirFichaRDOVisual(data);
  rdoCarregarCampo(id);
}

function abrirFichaRDOVisual(rdo){
  $("rdo-painel").style.display = "none";
  $("rdo-ficha").style.display = "";

  const t = TIPO_SERVICO[rdo.tipo_servico] || { label: "—", icone: "" };
  $("rdo-ficha-obra-chip").innerHTML = linkObra(rdo.obra_id); // chamado #4: clicável
  $("rdo-ficha-data-chip").textContent = rdo.data ? dataBR(rdo.data) : "—";
  $("rdo-ficha-tipo-chip").textContent = `${t.icone} ${t.label}`;
  $("rdo-ficha-execs-chip").textContent = _rdoExecucoes.length;
  const metragem = _rdoExecucoes.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0);
  $("rdo-ficha-metragem-chip").textContent = `${num(metragem)} m`;
  const maqTit = rdo.equipamento_id ? (_rdoEquipsCache.find(q => q.id === rdo.equipamento_id) || {}).codigo : null;
  const noturno = rdo.turno_campo === "noturno";   // fase 134b: período na ficha
  $("rdo-ficha-titulo").textContent = rdoEditId ? `RDO ${dataBR(rdo.data)}${noturno ? " · Noturno" : ""}${maqTit ? " · " + maqTit : ""}` : "Novo RDO";
  // fase 161: trilha do cabeçalho (Diário de Obra › obra › este diário). O primeiro item é o Voltar de sempre.
  const trObra = $("rdo-trilha-obra"); if(trObra) trObra.innerHTML = rdo.obra_id ? linkObra(rdo.obra_id) : "—";
  const bVoltar = $("btn-voltar-rdo"); if(bVoltar) bVoltar.textContent = _rdoVoltarPara ? "Voltar à obra" : "Diário de Obra";
  const chipTurno = $("rdo-ficha-turno-chip");
  if(chipTurno){ chipTurno.querySelector("strong").textContent = noturno ? "Noturno" : "Diurno"; chipTurno.classList.toggle("chip-aviso", noturno); }
  rdoAtualizarChipMaquina(rdo.equipamento_id || null);   // fase 94: chip da máquina, aviso e botão "Dividir por máquina"
  // fase 83: pedido de material ao almoxarifado a partir do RDO (encarregado em campo)
  const bPed = $("btn-rdo-pedir-material");
  if(bPed) bPed.style.display = rdo.obra_id && typeof sepPodePedir === "function" && sepPodePedir() ? "" : "none";

  _rdoBoletimAberto = null;
  atualizarStatusbarRDO(rdo.status);
  atualizarVisibilidadeAbasRaiz(rdo.tipo_servico);
  // fase 161: diário finalizado ou vindo do campo abre na leitura (aba Resumo); diário novo ou em digitação, no Cabeçalho
  ativarTabRDO(rdoEditId && (rdo.status === "finalizado" || rdo.enviado_em) ? "resumo" : "cabecalho");
  renderExecucoes();
  renderRdoEquipe();
  // (_rdoAbast é carregado em abrirRDO: aqui `abast` não existe e o ReferenceError cortava o fim desta função desde a fase 46)
  renderRdoAbast();
  renderRdoAtividades();
  atualizarVizinhosRDO(rdo);
  rdoRenderCampo(rdoEditId ? rdo : null);   // fase 129c: chip, faixa e botão do campo com o que já veio no cabeçalho
  if(typeof rdoResumoAtualizar === "function") rdoResumoAtualizar();   // fase 161: o Resumo, se for a aba aberta, com tudo já desenhado
}

/* ---------- Fase 129c: o que veio do app do campo (diário do operador) ----------
   Chip "Enviado pelo campo", faixa "Devolvido", Devolver ao campo (RPC rdo_devolver), aba Fotos (bucket privado rdo-fotos,
   URL assinada), paradas lidas de ocorrencias, aviso de relógio divergente (campo_pendencias) e selo "app" nas linhas. */
const RDO_CARGOS_OPERAR = ["diretor", "admin", "engenheiro", "assistente_engenharia", "encarregado"];   // = rdo_pode_operar() no banco
const RDO_MOTIVO_PARADA = { aguardando_liberacao: "Aguardando liberação", aguardando_locacao: "Aguardando locação",
  aguardando_concreto_argamassa: "Aguardando concreto/argamassa", aguardando_frente: "Aguardando frente", chuva: "Chuva",
  manutencao: "Manutenção", preparacao: "Preparação", deslocamento_interno: "Deslocamento interno", outro: "Outro" };
const RDO_FOTO_TIPO = { boletim_assinado: "Boletim assinado", estaca: "Estaca", ocorrencia: "Ocorrência", horimetro: "Horímetro", diario: "Diário" };

/* ---------- Fase 166: as duas respostas da parada ("a obra ficou paralisada?" e "em razão do cliente?") ----------
   Nulo é "não informado": nunca vira "não" na tela nem na soma. Funções puras, conferidas em scripts/testar-fase166.mjs. */
/* Resposta sugerida por motivo. Cópia idêntica à de js/op_parada.js: os dois arquivos não carregam na mesma página, e o
   scripts/testar-fase166.mjs compara as duas. null = sem sugestão: a pergunta aparece sem resposta e salvar exige responder. */
const PARADA_RESPOSTA_PADRAO = {
  aguardando_liberacao: { paralisado: true, em_razao_cliente: true },
  aguardando_locacao: { paralisado: true, em_razao_cliente: true },
  aguardando_concreto_argamassa: { paralisado: true, em_razao_cliente: true },
  aguardando_frente: { paralisado: true, em_razao_cliente: true },
  chuva: { paralisado: true, em_razao_cliente: false },
  manutencao: { paralisado: true, em_razao_cliente: false },
  preparacao: { paralisado: null, em_razao_cliente: null },
  deslocamento_interno: { paralisado: null, em_razao_cliente: null },
  outro: { paralisado: null, em_razao_cliente: null }
};
const PARADA_AVISO_RESPOSTA = "Responda se a obra ficou paralisada e se foi em razão do cliente.";
const RDO_PARADA_COLS = "id,tipo,motivo,descricao,paralisado,em_razao_cliente,periodo_inicio,periodo_fim,horas_paradas,origem,status,autor_id";
/* só verdadeiro e falso são resposta; qualquer outra coisa é "não informado" (nulo) */
const paradaBool = (v) => v === true ? true : v === false ? false : null;
function paradaSugestao(motivo){
  const s = Object.prototype.hasOwnProperty.call(PARADA_RESPOSTA_PADRAO, motivo) ? PARADA_RESPOSTA_PADRAO[motivo] : null;
  return { paralisado: paradaBool(s && s.paralisado), em_razao_cliente: paradaBool(s && s.em_razao_cliente) };
}
/* motivo sem sugestão (ou desconhecido): quem lança tem de responder à mão */
function paradaSemSugestao(motivo){ const s = paradaSugestao(motivo); return s.paralisado === null || s.em_razao_cliente === null; }
/* falta alguma das duas respostas: não dá para salvar parada nova */
function paradaRespostaFalta(r){ return !r || paradaBool(r.paralisado) === null || paradaBool(r.em_razao_cliente) === null; }
/* valor do <select> ↔ valor do banco: "sim" = verdadeiro, "nao" = falso, qualquer outra coisa = nulo */
function paradaDeSimNao(v){ return v === "sim" ? true : v === "nao" ? false : null; }
function paradaParaSimNao(v){ return v === true ? "sim" : v === false ? "nao" : ""; }
/* de quem é a hora parada: "cliente" (sim), "cgl" (não) ou "nao_informado" (nulo) */
function paradaGrupo(p){
  const c = paradaBool(p && p.em_razao_cliente);
  return c === true ? "cliente" : c === false ? "cgl" : "nao_informado";
}
/* Soma das horas paradas nos três grupos. Conta em centésimos de hora (horas_paradas tem duas casas): o total é sempre a soma
   exata das três partes. semResposta = paradas com alguma das duas perguntas sem resposta. */
function paradaSomar(lista){
  const c = { total: 0, cliente: 0, cgl: 0, nao_informado: 0 };
  const s = { n: 0, nCliente: 0, nCgl: 0, nNaoInformado: 0, semResposta: 0 };
  (Array.isArray(lista) ? lista : []).forEach(p => {
    if(!p || typeof p !== "object") return;
    const h = Number(p.horas_paradas), cent = isFinite(h) && h > 0 ? Math.round(h * 100) : 0;
    const g = paradaGrupo(p);
    s.n++; c.total += cent; c[g] += cent;
    if(g === "cliente") s.nCliente++; else if(g === "cgl") s.nCgl++; else s.nNaoInformado++;
    if(paradaRespostaFalta(p)) s.semResposta++;
  });
  return { ...s, total: c.total / 100, cliente: c.cliente / 100, cgl: c.cgl / 100, nao_informado: c.nao_informado / 100 };
}
/* "em razão do cliente Y h · da CGL Z h · não informado W h" (a parte comum do rodapé da ficha e da linha da obra) */
function paradaGruposTxt(s){
  return `em razão do cliente ${num(s.cliente)} h · da CGL ${num(s.cgl)} h · não informado ${num(s.nao_informado)} h`;
}
/* linha da aba RDOs da ficha da obra; sem parada, não há linha */
function paradaObraTxt(s){
  return s && s.n ? `Paradas da obra: ${num(s.n)} · ${num(s.total)} h · ${paradaGruposTxt(s)}` : "";
}
/* Parada lançada na ficha: o que falta para gravar ("" = pode gravar). f = { motivo, inicio, fim, paralisado, em_razao_cliente, descricao } */
function paradaValidarNova(f){
  const x = f || {}, hora = /^\d{2}:\d{2}/;
  if(!x.motivo || !Object.prototype.hasOwnProperty.call(RDO_MOTIVO_PARADA, x.motivo)) return "Escolha o motivo da parada.";
  if(!hora.test(x.inicio || "") || !hora.test(x.fim || "")) return "Informe a hora de início e a hora do fim da parada.";
  if(paradaRespostaFalta(x)) return PARADA_AVISO_RESPOSTA;
  if(x.motivo === "outro" && !String(x.descricao || "").trim()) return "Descreva a parada quando o motivo é Outro.";
  return "";
}
/* linha de `ocorrencias` da parada lançada na ficha (origem 'manual'). A hora é de parede: vai como foi digitada, sem fuso.
   O tipo segue a RPC do campo (chuva = clima; o resto = paralisacao); as horas saem do gatilho do banco. */
function paradaLinhaNova(f, cab, autorId){
  const desc = String(f.descricao || "").trim();
  return { obra_id: cab.obra_id, rdo_id: cab.id, data: cab.data, tipo: f.motivo === "chuva" ? "clima" : "paralisacao", status: "resolvida",
    descricao: desc || RDO_MOTIVO_PARADA[f.motivo], motivo: f.motivo, paralisado: paradaBool(f.paralisado), em_razao_cliente: paradaBool(f.em_razao_cliente),
    periodo_inicio: String(f.inicio).slice(0, 5), periodo_fim: String(f.fim).slice(0, 5), equipamento_id: cab.equipamento_id || null,
    origem: "manual", autor_id: autorId || null };
}

function rdoPodeOperarFront(){
  return !!usuarioAtual && RDO_CARGOS_OPERAR.includes(usuarioAtual.cargo) && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
}
function rdoDevolvidoAberto(r){ return !!(r && r.devolvido_em && (!r.enviado_em || r.devolvido_em > r.enviado_em)); }
function rdoTagCampoLista(r){
  if(!r || r.status !== "rascunho") return "";
  if(rdoDevolvidoAberto(r)) return ' <span class="tag vermelho" title="Devolvido ao campo: espera o operador corrigir e enviar de novo">devolvido</span>';
  return r.enviado_em ? ' <span class="tag azul" title="Enviado pelo app do campo: confira e finalize, ou devolva">do campo</span>' : "";
}
function rdoHoraCampo(ts, diaRdo){
  if(!ts) return "";
  const d = new Date(ts);
  const hh = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const dia = d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return dia === diaRdo ? `às ${hh}` : `em ${dataBR(dia)} às ${hh}`;
}
function rdoNomeCampo(id){ return id ? (_rdoCampo.nomes[id] || "usuário do campo") : "—"; }
function rdoTagApp(tab, l){
  const doApp = tab === "exec" ? l?.origem_dados === "app_operador" : !!(l?.id && _rdoCampo.origens?.[tab]?.has(l.id));
  return doApp ? ' <span class="tag verde" data-app-badge="1" title="Gravado pelo app do campo (diário do operador)">app</span>' : "";
}
/* desenha só a parte do campo, sem redesenhar as grades (não perde o que o usuário digitou) */
function rdoRenderCampo(r){
  if(r !== undefined) _rdoCampo.rdo = r;   // sem argumento: redesenha com o cabeçalho já guardado
  const cab = _rdoCampo.rdo;
  const chip = $("rdo-ficha-campo-chip"), faixa = $("rdo-ficha-devolvido"), bDev = $("btn-rdo-devolver");
  const devolvido = rdoDevolvidoAberto(cab);
  if(chip){
    chip.style.display = cab?.enviado_em ? "" : "none";
    if(cab?.enviado_em){
      chip.querySelector("strong").textContent = `${rdoHoraCampo(cab.enviado_em, cab.data)} por ${rdoNomeCampo(cab.enviado_por)}`;
      chip.classList.toggle("chip-aviso", devolvido);
    }
  }
  if(faixa){
    faixa.style.display = devolvido ? "" : "none";
    if(devolvido) faixa.textContent = `Devolvido ao campo ${rdoHoraCampo(cab.devolvido_em, cab.data)} por ${rdoNomeCampo(cab.devolvido_por)}: ${cab.devolvido_motivo || "sem motivo"}. O operador corrige no app e envia de novo.`;
  }
  if(bDev) bDev.style.display = cab && cab.enviado_em && !devolvido && cab.status === "rascunho" && rdoPodeOperarFront() ? "" : "none";
  // relógio do celular diferente do servidor (pendência aberta pelo app ao abrir o dia)
  const rel = $("rdo-ficha-relogio");
  const pRel = cab ? (_rdoCampo.pendencias || []).find(p => p.tipo === "relogio_divergente") : null;
  if(rel){
    rel.style.display = pRel ? "" : "none";
    if(pRel){
      const min = Number(pRel.detalhe?.minutos) || null;
      $("rdo-ficha-relogio-txt").textContent = `O relógio do celular de quem abriu este dia no campo estava ${min ? min + " min " : ""}diferente do servidor. Confira as horas lançadas pelo app (equipe, paradas e estacas) antes de finalizar.`;
      const bOk = $("btn-rdo-relogio-ok");
      if(bOk){ bOk.dataset.id = pRel.id; bOk.style.display = rdoPodeOperarFront() ? "" : "none"; }
    }
  }
  const nF = (_rdoCampo.fotos || []).length;
  const tabF = document.querySelector('#rdo-notebook button[data-tab="fotos"]');
  if(tabF) tabF.textContent = nF ? `Fotos (${nF})` : "Fotos";
  renderRdoParadas();
}
async function rdoCarregarCampo(id){
  const [fotos, paradas, pend, orig] = await Promise.all([
    sb.from("rdo_fotos").select("id,tipo,storage_path,legenda,tirada_em,autor_id,enviada,desconsiderada_motivo,execucao_id,ocorrencia_id").eq("rdo_id", id).order("tirada_em"),
    sb.from("ocorrencias").select(RDO_PARADA_COLS).eq("rdo_id", id).order("periodo_inicio", { nullsFirst: true }),
    sb.from("campo_pendencias").select("id,tipo,detalhe,aberta_em").eq("rdo_id", id).is("resolvida_em", null),
    sb.rpc("rdo_campo_origens", { p_rdo: id })
  ]);
  if(rdoEditId !== id) return;
  // tabelas da 129a ausentes ou leitura recusada: a ficha segue sem a parte do campo
  _rdoCampo.fotos = fotos.error ? [] : (fotos.data || []);
  _rdoCampo.paradas = paradas.error ? [] : (paradas.data || []);
  _rdoCampo.pendencias = pend.error ? [] : (pend.data || []);
  // RPC da 129c (migration 20261109_fase129c_campo_origens.sql): sem ela, o selo "app" fica só nas execuções
  _rdoCampo.origens = orig.error ? null : { equipe: new Set((orig.data || []).filter(o => o.tabela === "rdo_equipe").map(o => o.linha_id)),
    abast: new Set((orig.data || []).filter(o => o.tabela === "rdo_abastecimento").map(o => o.linha_id)) };
  const c = _rdoCampo.rdo || {};
  const ids = [...new Set([c.enviado_por, c.devolvido_por, ..._rdoCampo.fotos.map(f => f.autor_id), ..._rdoCampo.paradas.map(p => p.autor_id)].filter(Boolean))];
  if(ids.length){
    const { data: pf } = await sb.from("profiles").select("id,nome").in("id", ids);
    (pf || []).forEach(p => { _rdoCampo.nomes[p.id] = p.nome; });
  }
  if(rdoEditId !== id) return;
  rdoRenderCampo();
  rdoAplicarSelosApp();
  if(document.querySelector('#rdo-notebook button[data-tab="fotos"].ativo')) renderRdoFotos();
  if(typeof rdoResumoAtualizar === "function") rdoResumoAtualizar();   // fase 161: fotos e paradas do campo chegaram
}
/* acrescenta o selo nas grades de equipe e abastecimento já desenhadas */
function rdoAplicarSelosApp(){
  [["equipe", "#rdo-equipe-tbody", _rdoEquipe], ["abast", "#rdo-abast-tbody", _rdoAbast]].forEach(([tab, sel, linhas]) => {
    (linhas || []).forEach((l, idx) => {
      const td = document.querySelector(`${sel} tr[data-idx="${idx}"] td`);
      if(!td) return;
      td.querySelectorAll("[data-app-badge]").forEach(x => x.remove());
      td.insertAdjacentHTML("beforeend", rdoTagApp(tab, l));
    });
  });
}
/* ---------- Fase 166: paradas na ficha (aba Observações) ----------
   Quem opera o diário (rdoPodeOperarFront) e com o diário em rascunho: responde e corrige as duas perguntas de qualquer parada
   (grava na hora), lança parada nova (origem 'manual') e exclui só a que foi lançada aqui. Parada do app e do Maya não muda de
   horário nem de motivo nesta tela. Quem só lê, ou com o diário finalizado, vê texto; nulo aparece como "não informado".
   Vale a policy que já existe em `ocorrencias` (os mesmos cargos de RDO_CARGOS_OPERAR): se o banco recusar, o valor volta. */
const RDO_PAR_PERGUNTA = { paralisado: "Obra paralisada?", em_razao_cliente: "Em razão do cliente?" };
let _rdoParForm = null;       // parada sendo lançada: { rdoId, motivo, inicio, fim, paralisado, em_razao_cliente, descricao, guarda }
let _rdoParSelGuarda = null;  // marca de formulário alterado no momento em que o foco entrou num select de resposta
let _rdoParForaSeq = 0;       // conta as edições feitas fora do bloco de paradas
function rdoParPodeEditar(){
  return !!rdoEditId && !!_rdoCampo.rdo && _rdoCampo.rdo.status === "rascunho" && rdoPodeOperarFront();
}
/* Fase 86: gravar uma parada não salva o resto da ficha. Antes de mexer aqui guarda-se a marca de formulário alterado; depois
   de gravar ou desistir ela volta ao que era, a menos que alguém tenha mexido em outro campo nesse meio-tempo. */
function rdoParSujoGuardar(){ return { sujo: typeof appFormSujo === "function" ? appFormSujo() : true, seq: _rdoParForaSeq }; }
function rdoParSujoDevolver(g){
  if(g && g.sujo === false && g.seq === _rdoParForaSeq && !_rdoParForm && typeof appLimparSujo === "function") appLimparSujo();
}
if(typeof document !== "undefined" && document.addEventListener) ["input", "change"].forEach(ev => document.addEventListener(ev, (e) => {
  if(e.target && e.target.closest && !e.target.closest("#rdo-paradas")) _rdoParForaSeq++;
}, true));

function rdoParRespostaHTML(p, campo, edita){
  const v = paradaBool(p[campo]);
  if(!edita) return v === null ? '<span class="tag ambar" title="Ninguém respondeu esta pergunta para esta parada">não informado</span>' : v ? "sim" : "não";
  const atual = paradaParaSimNao(v);
  return `<select class="rdo-par-resp${v === null ? " rdo-par-falta" : ""}" data-par-id="${esc(p.id)}" data-par-campo="${esc(campo)}" aria-label="${esc(RDO_PAR_PERGUNTA[campo])}" title="Trocar grava na hora">${
    [["", "não informado"], ["sim", "sim"], ["nao", "não"]].map(([val, rot]) => `<option value="${esc(val)}"${val === atual ? " selected" : ""}>${esc(rot)}</option>`).join("")}</select>`;
}
function rdoParOrigemHTML(p){
  if(p.origem === "app_operador") return `<span class="tag verde" title="Lançada no app do campo por ${esc(rdoNomeCampo(p.autor_id))}">app</span>`;
  if(p.origem === "maya") return '<span class="tag cinza" title="Importada do Relatório Diário do Maya">Maya</span>';
  if(p.origem === "manual") return `<span class="tag cinza" title="Lançada nesta ficha${_rdoCampo.nomes[p.autor_id] ? " por " + esc(_rdoCampo.nomes[p.autor_id]) : ""}">manual</span>`;
  return esc(p.origem || "manual");
}
function rdoParFormHTML(f){
  const opt = (val, rot, atual) => `<option value="${esc(val)}"${val === atual ? " selected" : ""}>${esc(rot)}</option>`;
  const resposta = (campo, rot) => `<div class="campo"><label for="rdo-par-${esc(campo)}">${esc(rot)}</label>
        <select id="rdo-par-${esc(campo)}" data-par-form="${esc(campo)}">${[["", "responda"], ["sim", "Sim"], ["nao", "Não"]].map(([v, r]) => opt(v, r, paradaParaSimNao(f[campo]))).join("")}</select></div>`;
  const dica = !f.motivo ? "Escolha o motivo: ele sugere as duas respostas, e você confere antes de incluir."
    : paradaSemSugestao(f.motivo) ? "Este motivo não tem resposta sugerida: responda as duas perguntas."
    : "Respostas sugeridas pelo motivo: confira e troque se não for o caso.";
  return `<div class="rdo-par-form" id="rdo-par-form">
    <div class="grade">
      <div class="campo"><label for="rdo-par-motivo">Motivo</label>
        <select id="rdo-par-motivo" data-par-form="motivo">${opt("", "— escolha —", f.motivo || "")}${Object.entries(RDO_MOTIVO_PARADA).map(([v, r]) => opt(v, r, f.motivo || "")).join("")}</select></div>
      <div class="campo"><label for="rdo-par-inicio">Início</label><input type="time" id="rdo-par-inicio" data-par-form="inicio" value="${esc(f.inicio || "")}" /></div>
      <div class="campo"><label for="rdo-par-fim">Fim</label><input type="time" id="rdo-par-fim" data-par-form="fim" value="${esc(f.fim || "")}" /></div>
      ${/* html */ resposta("paralisado", "A obra ficou paralisada?")}
      ${/* html */ resposta("em_razao_cliente", "Em razão do cliente?")}
      <div class="campo largo"><label for="rdo-par-descricao">Descrição${f.motivo === "outro" ? " (obrigatória)" : ""}</label><input type="text" id="rdo-par-descricao" data-par-form="descricao" maxlength="200" value="${esc(f.descricao || "")}" /></div>
    </div>
    <p class="meta">${esc(dica)} As horas saem do início e do fim.</p>
    <div class="form-acoes compacta">
      <button type="button" class="btn btn-sm" id="btn-rdo-par-incluir">Incluir parada</button>
      <button type="button" class="btn-sec btn-sm" id="btn-rdo-par-cancelar">Cancelar</button>
    </div>
  </div>`;
}
function renderRdoParadas(){
  const cont = $("rdo-paradas");
  if(!cont) return;
  rdoParLigar(cont);
  const ps = rdoEditId ? (_rdoCampo.paradas || []) : [];
  const edita = rdoParPodeEditar();
  if(_rdoParForm && (!edita || _rdoParForm.rdoId !== rdoEditId)) _rdoParForm = null;
  const opera = rdoPodeOperarFront();
  const acoes = edita
    ? (_rdoParForm ? rdoParFormHTML(_rdoParForm) : `<p class="rdo-par-acoes"><button type="button" class="btn-sec btn-sm" id="btn-rdo-par-adicionar" title="Lança uma parada neste diário, com início, fim e as duas respostas">+ Adicionar parada</button></p>`)
    : !opera ? "" : !rdoEditId ? `<p class="meta">Salve o diário para lançar paradas.</p>`
    : `<p class="meta">Diário finalizado: para responder ou lançar parada, volte o diário para rascunho.</p>`;
  if(!ps.length){ cont.innerHTML = `<p class="vazio">Nenhuma parada ou ocorrência registrada neste diário.</p>${/* html */ acoes}`; return; }
  const hora = (t) => t ? String(t).slice(0, 5) : "—";
  const s = paradaSomar(ps);
  const semCliente = `não informado ${num(s.nao_informado)} h`;
  cont.innerHTML = `<div class="tabela-rola"><table class="itens-tabela">
    <thead><tr><th>Início</th><th>Fim</th><th class="num">Horas</th><th>Motivo</th><th>Descrição</th><th title="A obra ficou paralisada por causa desta parada?">Obra paralisada?</th><th title="A parada foi em razão do cliente? Sim soma nas horas do cliente; não, nas da CGL.">Em razão do cliente?</th><th>Origem</th>${edita ? "<th></th>" : ""}</tr></thead>
    <tbody>${/* html */ ps.map(p => `<tr>
      <td>${esc(hora(p.periodo_inicio))}</td>
      <td>${p.periodo_inicio && !p.periodo_fim ? '<span class="tag ambar" title="Parada iniciada no campo e ainda não encerrada">em andamento</span>' : esc(hora(p.periodo_fim))}</td>
      <td class="num">${p.horas_paradas != null ? num(p.horas_paradas) : "—"}</td>
      <td>${esc(RDO_MOTIVO_PARADA[p.motivo] || p.tipo || "—")}</td>
      <td>${esc(p.descricao || "")}</td>
      <td>${/* html */ rdoParRespostaHTML(p, "paralisado", edita)}</td>
      <td>${/* html */ rdoParRespostaHTML(p, "em_razao_cliente", edita)}</td>
      <td>${/* html */ rdoParOrigemHTML(p)}</td>
      ${edita ? `<td>${p.origem === "manual" ? `<button type="button" class="btn-sec btn-sm txt-perigo" data-par-excluir="${esc(p.id)}" title="Excluir esta parada, lançada nesta ficha">Excluir</button>` : ""}</td>` : ""}
    </tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="${edita ? 9 : 8}"><strong>Total parado ${num(s.total)} h</strong> · em razão do cliente ${num(s.cliente)} h · da CGL ${num(s.cgl)} h · ${
      s.nNaoInformado ? `<span class="tag ambar" title="${num(s.nNaoInformado)} parada(s) sem resposta para 'em razão do cliente'">${esc(semCliente)}</span>` : esc(semCliente)}</td></tr></tfoot>
  </table></div>${/* html */ acoes}`;
}
/* liga uma vez os eventos do bloco (delegação: o conteúdo é redesenhado a cada mudança) */
function rdoParLigar(cont){
  if(!cont.dataset || cont.dataset.parLigado) return;
  cont.dataset.parLigado = "1";
  cont.addEventListener("focusin", (e) => {
    if(e.target.closest && e.target.closest("select.rdo-par-resp")) _rdoParSelGuarda = rdoParSujoGuardar();
  });
  cont.addEventListener("change", (e) => {
    const sel = e.target.closest ? e.target.closest("select.rdo-par-resp") : null;
    if(sel){ rdoParGravarResposta(sel); return; }
    rdoParFormSincronizar(e.target, "change");
  });
  cont.addEventListener("input", (e) => rdoParFormSincronizar(e.target, "input"));
  cont.addEventListener("click", (e) => {
    const b = e.target.closest ? e.target.closest("button") : null;
    if(!b) return;
    if(b.id === "btn-rdo-par-adicionar") rdoParAbrirForm();
    else if(b.id === "btn-rdo-par-cancelar") rdoParFecharForm();
    else if(b.id === "btn-rdo-par-incluir") comBotaoTravado(b, rdoParIncluir);
    else if(b.dataset.parExcluir) comBotaoTravado(b, () => rdoParExcluir(b.dataset.parExcluir));
  });
}
/* o formulário guarda o que foi digitado em _rdoParForm: redesenhar o bloco não perde nada */
function rdoParFormSincronizar(el, evento){
  const campo = el && el.dataset ? el.dataset.parForm : null;
  if(!campo || !_rdoParForm) return;
  if(el.tagName === "SELECT" && evento !== "change") return;
  if(campo === "motivo"){
    _rdoParForm.motivo = el.value || "";
    Object.assign(_rdoParForm, paradaSugestao(_rdoParForm.motivo));   // o motivo refaz a sugestão, à vista de quem lança
    renderRdoParadas();
    $("rdo-par-motivo")?.focus();
  } else if(campo === "paralisado" || campo === "em_razao_cliente") _rdoParForm[campo] = paradaDeSimNao(el.value);
  else if(campo === "inicio" || campo === "fim" || campo === "descricao") _rdoParForm[campo] = el.value;
}
function rdoParAbrirForm(){
  if(!rdoParPodeEditar()) return;
  _rdoParForm = { rdoId: rdoEditId, motivo: "", inicio: "", fim: "", paralisado: null, em_razao_cliente: null, descricao: "", guarda: rdoParSujoGuardar() };
  renderRdoParadas();
  $("rdo-par-motivo")?.focus();
}
function rdoParFecharForm(){
  const f = _rdoParForm;
  _rdoParForm = null;
  if(f) rdoParSujoDevolver(f.guarda);
  renderRdoParadas();
}
async function rdoParRecarregar(){
  const id = rdoEditId;
  if(!id) return;
  const { data, error } = await sb.from("ocorrencias").select(RDO_PARADA_COLS).eq("rdo_id", id).order("periodo_inicio", { nullsFirst: true });
  if(rdoEditId !== id) return;
  if(error){ aviso("app-aviso", "A alteração foi gravada, mas a lista de paradas não pôde ser relida: " + error.message + ". Reabra o diário.", "erro"); return; }
  _rdoCampo.paradas = data || [];
  if(usuarioAtual && usuarioAtual.id && usuarioAtual.nome) _rdoCampo.nomes[usuarioAtual.id] = usuarioAtual.nome;
  renderRdoParadas();
  if(typeof rdoResumoAtualizar === "function") rdoResumoAtualizar();
}
/* Troca de uma das duas respostas: grava na hora; se o banco recusar ou não devolver a linha, o valor volta e sai aviso */
async function rdoParGravarResposta(sel){
  const id = sel.dataset.parId, campo = sel.dataset.parCampo, guarda = _rdoParSelGuarda, rdoId = rdoEditId;
  _rdoParSelGuarda = null;
  const p = (_rdoCampo.paradas || []).find(x => x.id === id);
  if(!p || !rdoParPodeEditar() || !Object.prototype.hasOwnProperty.call(RDO_PAR_PERGUNTA, campo)){ renderRdoParadas(); return; }
  const novo = paradaDeSimNao(sel.value);
  if(novo === paradaBool(p[campo])){ rdoParSujoDevolver(guarda); return; }
  sel.disabled = true;
  let falha = "";
  try {
    const { data, error } = await sb.from("ocorrencias").update({ [campo]: novo }).eq("id", id).select("id");
    if(error) falha = error.message;
    else if(!data || !data.length) falha = "o banco não aceitou a alteração (o seu perfil pode não ter permissão para alterar paradas)";
  } catch(e){ falha = e && e.message ? e.message : String(e); }
  if(rdoEditId !== rdoId) return;
  if(falha) aviso("app-aviso", "Não foi possível gravar a resposta: " + falha + ". O valor anterior foi mantido.", "erro");
  else p[campo] = novo;
  rdoParSujoDevolver(guarda);
  renderRdoParadas();
  if(!falha && typeof rdoResumoAtualizar === "function") rdoResumoAtualizar();
}
async function rdoParIncluir(){
  const f = _rdoParForm, cab = _rdoCampo.rdo, id = rdoEditId;
  if(!f || !rdoParPodeEditar() || f.rdoId !== id) return;
  const falta = paradaValidarNova(f);
  if(falta){ aviso("app-aviso", falta, "erro"); return; }
  const { data, error } = await sb.from("ocorrencias").insert(paradaLinhaNova(f, cab, usuarioAtual ? usuarioAtual.id : null)).select("id");
  if(error || !data || !data.length){
    aviso("app-aviso", "Não foi possível lançar a parada: " + (error ? error.message : "o banco não devolveu a linha gravada") + ".", "erro");
    return;
  }
  if(rdoEditId !== id) return;
  _rdoParForm = null;
  rdoParSujoDevolver(f.guarda);
  aviso("app-aviso", "Parada lançada no diário.", "ok");
  await rdoParRecarregar();
}
/* só a parada lançada nesta ficha (origem 'manual') é excluída aqui; a do app se corrige no app, a do Maya fica */
async function rdoParExcluir(paradaId){
  const p = (_rdoCampo.paradas || []).find(x => x.id === paradaId), id = rdoEditId;
  if(!p || p.origem !== "manual" || !rdoParPodeEditar()) return;
  const hora = (t) => t ? String(t).slice(0, 5) : "—";
  if(!confirm(`Excluir a parada de ${hora(p.periodo_inicio)} a ${hora(p.periodo_fim)} (${RDO_MOTIVO_PARADA[p.motivo] || "sem motivo"})? Não dá para desfazer.`)) return;
  const { data, error } = await sb.from("ocorrencias").delete().eq("id", paradaId).eq("origem", "manual").select("id");
  if(error || !data || !data.length){
    aviso("app-aviso", "Não foi possível excluir a parada: " + (error ? error.message : "o banco não aceitou a exclusão") + ".", "erro");
    return;
  }
  if(rdoEditId !== id) return;
  aviso("app-aviso", "Parada excluída.", "ok");
  await rdoParRecarregar();
}
async function renderRdoFotos(){
  const cont = $("rdo-fotos");
  if(!cont) return;
  const fs = rdoEditId ? (_rdoCampo.fotos || []) : [];
  if(!fs.length){ cont.innerHTML = `<p class="vazio">Nenhuma foto enviada pelo campo neste diário.</p>`; return; }
  const enviadas = fs.filter(f => f.enviada);
  const urls = {};
  if(enviadas.length){
    const { data } = await sb.storage.from("rdo-fotos").createSignedUrls(enviadas.map(f => f.storage_path), 3600);
    (data || []).forEach(u => { if(u.signedUrl) urls[u.path] = u.signedUrl; });
  }
  const execNum = (id) => (_rdoExecucoes.find(e => e.id === id) || {}).estaca_numero;
  cont.innerHTML = `<div class="rdo-fotos-grade">${/* html */ fs.map(f => {
    const url = urls[f.storage_path];
    const leg = [RDO_FOTO_TIPO[f.tipo] || f.tipo, f.execucao_id && execNum(f.execucao_id) ? "estaca " + execNum(f.execucao_id) : null, f.legenda].filter(Boolean).join(" · ");
    const quando = f.tirada_em ? new Date(f.tirada_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    return `<figure class="rdo-foto${f.desconsiderada_motivo ? " rdo-foto-descons" : ""}">
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="Abrir a foto em tamanho real"><img src="${esc(url)}" alt="${esc(leg)}" loading="lazy" /></a>`
            : `<div class="rdo-foto-falta" title="O celular registrou a foto mas o arquivo ainda não subiu">${f.enviada ? "sem acesso ao arquivo" : "aguardando envio do celular"}</div>`}
      <figcaption><strong>${esc(leg)}</strong><span class="meta">${esc(quando)} · ${esc(rdoNomeCampo(f.autor_id))}${f.desconsiderada_motivo ? " · desconsiderada: " + esc(f.desconsiderada_motivo) : ""}</span></figcaption>
    </figure>`;
  }).join("")}</div>`;
}
/* Para regularizar do campo (vw_sc_regularizar_campo) → o diário (um só) ou a lista filtrada. registro_id é o diário nos
   itens enviado/devolvido e a pendência (campo_pendencias) nos demais. */
let _rdoPreset = null;
async function rdoAbrirPresetCampo(a){
  if(!a || !irParaSecao("rdo")) return;
  if(a.registro_id && /^rdo_(devolvido|enviado_sem_conferencia)$/.test(a.filtro || "")){ await abrirRDO(a.registro_id); return; }
  if(a.registro_id){
    const { data } = await sb.from("campo_pendencias").select("rdo_id").eq("id", a.registro_id).maybeSingle();
    if(data?.rdo_id){ await abrirRDO(data.rdo_id); return; }
  }
  _rdoPreset = { status: a.filtro === "rdo_devolvido" ? "campo_devolvido" : a.filtro === "rdo_enviado_sem_conferencia" ? "campo_enviado" : "",
                 obra: (a.obra_ids || []).length === 1 ? a.obra_ids[0] : "" };
  if(_rdoView === "geo"){ _rdoView = "lista"; document.querySelectorAll("#rdo-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === "lista")); }
  $("rdo-painel").style.display = ""; $("rdo-ficha").style.display = "none"; rdoEditId = null;
  await carregarRDO();
}
async function rdoDevolverCampo(){
  if(!rdoEditId || !rdoPodeOperarFront()) return;
  const motivo = prompt("Devolver este diário ao campo.\nO operador vê o motivo no app, corrige e envia de novo.\n\nMotivo (obrigatório):", "");
  if(motivo === null) return;
  if(motivo.trim().length < 5){ aviso("app-aviso", "Escreva o motivo da devolução (pelo menos 5 letras).", "erro"); return; }
  const { error } = await sb.rpc("rdo_devolver", { p_rdo: rdoEditId, p_motivo: motivo.trim() });
  if(error){ aviso("app-aviso", "Não foi possível devolver: " + error.message, "erro"); return; }
  aviso("app-aviso", "Diário devolvido ao campo. O operador já pode corrigir no app.", "ok");
  await carregarRDO();
  await abrirRDO(rdoEditId);
}
async function rdoRelogioConferido(id){
  if(!id || !rdoPodeOperarFront()) return;
  const { error } = await sb.from("campo_pendencias").update({ resolvida_em: new Date().toISOString(), resolvida_por: usuarioAtual?.id || null }).eq("id", id).is("resolvida_em", null);
  if(error){ aviso("app-aviso", "Não foi possível marcar como conferido: " + error.message, "erro"); return; }
  _rdoCampo.pendencias = (_rdoCampo.pendencias || []).filter(p => p.id !== id);
  rdoRenderCampo();
}

/* Busca RDO anterior e próximo na mesma obra + tipo */
async function atualizarVizinhosRDO(rdo){
  const btnAnt = $("btn-rdo-anterior");
  const btnProx = $("btn-rdo-proximo");
  const posLabel = $("rdo-ficha-posicao");
  if(!btnAnt || !btnProx) return;

  // Reset se for novo RDO
  if(!rdoEditId || !rdo.obra_id){
    btnAnt.style.display = "none";
    btnProx.style.display = "none";
    if(posLabel) posLabel.textContent = "";
    return;
  }

  // Busca todos os RDOs da mesma obra+tipo ordenados por data
  let q = sb.from("rdo").select("id,data,turno_campo").eq("obra_id", rdo.obra_id).eq("tipo_servico", rdo.tipo_servico);
  q = rdo.equipamento_id ? q.eq("equipamento_id", rdo.equipamento_id) : q.is("equipamento_id", null);   // fase 94: anterior/próximo da mesma máquina
  // fase 134b: no mesmo dia o diurno (ou sem período) vem antes do noturno
  const { data, error } = await q.order("data", { ascending: true }).order("turno_campo", { ascending: true, nullsFirst: true });
  if(error || !data){
    btnAnt.style.display = "none";
    btnProx.style.display = "none";
    return;
  }

  const idxAtual = data.findIndex(r => r.id === rdoEditId);
  const total = data.length;
  _rdoVizinhos = {
    anterior: idxAtual > 0 ? data[idxAtual - 1] : null,
    proximo:  idxAtual >= 0 && idxAtual < total - 1 ? data[idxAtual + 1] : null,
    indice: idxAtual + 1,
    total
  };

  btnAnt.style.display = "";
  btnProx.style.display = "";
  btnAnt.disabled = !_rdoVizinhos.anterior;
  btnProx.disabled = !_rdoVizinhos.proximo;
  const rotVz = (v) => `${dataBR(v.data)}${v.turno_campo === "noturno" ? " (noturno)" : ""}`;   // fase 134b
  btnAnt.title = _rdoVizinhos.anterior
    ? `Anterior: ${rotVz(_rdoVizinhos.anterior)}`
    : "Não há RDO anterior";
  btnProx.title = _rdoVizinhos.proximo
    ? `Próximo: ${rotVz(_rdoVizinhos.proximo)}`
    : "Não há próximo RDO";
  if(posLabel) posLabel.textContent = total > 1 ? `${_rdoVizinhos.indice} de ${total}` : "";
}

async function navegarRDO(direcao){
  const alvo = direcao === "anterior" ? _rdoVizinhos.anterior : _rdoVizinhos.proximo;
  if(!alvo){
    aviso("app-aviso", direcao === "anterior" ? "Não há RDO anterior." : "Não há próximo RDO.", "erro");
    return;
  }
  await abrirRDO(alvo.id);
}

/* fase 161: uma ação principal só no cabeçalho. Em rascunho é Finalizar; no diário finalizado, Salvar. Só troca a classe:
   os dois botões e os handlers continuam os mesmos. */
function rdoAplicarAcaoPrincipal(st){
  const bFin = $("btn-finalizar-rdo"), bSal = $("btn-salvar-rdo");
  if(!bFin || !bSal) return;
  const finalizado = st === "finalizado";
  bFin.className = finalizado ? "btn-sec" : "btn";
  bSal.className = finalizado ? "btn" : "btn-sec";
}
function atualizarStatusbarRDO(st){
  rdoAplicarAcaoPrincipal(st);
  const bar = $("rdo-statusbar");
  if(!bar) return;
  const idxAtual = RDO_STAGES.indexOf(st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada");
    el.removeAttribute("aria-current");
    const idx = RDO_STAGES.indexOf(el.dataset.status);
    if(idx === idxAtual){ el.classList.add("atual"); el.setAttribute("aria-current", "step"); }
    else if(idx < idxAtual) el.classList.add("passada");
  });
}

function atualizarVisibilidadeAbasRaiz(tipo){
  const ehRaiz = (tipo === "estaca_raiz");
  document.querySelectorAll("[data-rdo-aba-raiz]").forEach(el => {
    el.style.display = ehRaiz ? "" : "none";
  });
}

function ativarTabRDO(nome){
  document.querySelectorAll("#rdo-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#rdo-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
  // Ao entrar em Execuções, refresca pra pegar mudanças na Equipe (selects de operador)
  if(nome === "execucoes" && typeof renderExecucoes === "function") renderExecucoes();
  if(nome === "fotos") renderRdoFotos();   // fase 129c: URL assinada só quando a aba abre
  if(nome === "resumo" && typeof renderRdoResumo === "function") renderRdoResumo();   // fase 161: leitura do dia, sempre com o que está na ficha
}

/* ---------- Grid de execuções (varia por tipo) ---------- */
function renderExecucoes(){
  const tb = $("rdo-execs");
  if(!tb) return;
  const tipo = $("rdo-tipo-servico").value;
  const ehRaiz = (tipo === "estaca_raiz");
  // Cabeçalho: define visibilidade de colunas via CSS
  document.querySelectorAll("[data-col-tipo]").forEach(th => {
    const tipos = th.dataset.colTipo.split(",");
    th.style.display = tipos.includes(tipo) ? "" : "none";
  });

  // Opções de operador = membros do RDO (equipe do dia) — fallback: cadastro geral de funcionários
  // lote S54 (#178): quem está ausente no dia (Falta, Folga, DSR, Atestado) não opera máquina
  const opsRDO = _rdoEquipe
    .filter(eq => eq.funcionario_id && !rdoStatusDia(eq.status_dia)?.aus)
    .map(eq => _rdoFuncs.find(f => f.id === eq.funcionario_id))
    .filter(Boolean);
  const operadoresDisp = opsRDO.length ? opsRDO : _rdoFuncs;
  const opOpts = '<option value="">—</option>' +
    operadoresDisp.map(f=>`<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");

  // Popula o select da barra "Aplicar a todos" também
  const selMassa = $("rdo-exec-op-massa");
  if(selMassa){
    const prevValor = selMassa.value;
    selMassa.innerHTML = `<option value="">— escolha um operador da equipe —</option>` +
      operadoresDisp.map(f=>`<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
    if(prevValor) selMassa.value = prevValor;
  }

  if(!_rdoExecucoes.length){
    tb.innerHTML = `<tr><td colspan="17" class="vazio">Nenhuma estaca registrada. Adicione manualmente ou importe um CSV.</td></tr>`;
    return;
  }
  const eqOpts = '<option value="">—</option>' +
    _rdoEquipsCache.map(e=>`<option value="${esc(e.id)}">${esc(e.codigo)}</option>`).join("");

  tb.innerHTML = _rdoExecucoes.map((e, idx) => {
    const showHelice = ["helice_continua","helice_secante"].includes(tipo);
    const bltAberto = (_rdoBoletimAberto === idx);
    const bltStyle = bltAberto ? 'background:var(--info-bg);color:var(--acao-txt);border-color:var(--marca-600);font-weight:700;' : '';
    return `<tr data-idx="${idx}">
      <td><input type="text" class="ex-num col-md" value="${esc(e.estaca_numero||"")}" />${/* html */ typeof geoBadgeExec === "function" ? geoBadgeExec(e) : ""}${/* html */ rdoTagApp("exec", e)}</td>
      <td data-col-tipo="helice_continua,trado_mecanizado,estaca_raiz,helice_secante"><input type="number" class="ex-diam" step="0.1" min="0" value="${esc(e.diametro_mm ?? "")}" style="width:75px;" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,estaca_raiz,helice_secante"><input type="number" class="ex-pproj" step="0.01" min="0" value="${esc(e.profundidade_projeto ?? "")}" style="width:75px;" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,estaca_raiz,helice_secante"><input type="number" class="ex-pexec" step="0.01" min="0" value="${esc(e.profundidade_executada ?? "")}" data-auto="${esc(e._pexecAuto ?? "")}" style="width:75px;" title="Metros perfurados neste dia (o que a medição soma) = Acum. − De. Pode corrigir à mão" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,estaca_raiz,helice_secante"><input type="number" class="ex-pde" step="0.01" min="0" value="${esc(e.perfuracao_de_m ?? "")}" style="width:62px;" title="Onde a estaca estava no começo do dia: o sistema traz o acumulado dos RDOs anteriores desta estaca" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,estaca_raiz,helice_secante"><input type="number" class="ex-pate" step="0.01" min="0" value="${esc(e.perfuracao_ate_m ?? "")}" style="width:62px;" title="Acumulado da estaca ao fim do dia (o que está no boletim)" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,helice_secante"${showHelice||tipo==='trado_mecanizado'?'':' style="display:none;"'}><input type="datetime-local" class="ex-perfi col-lg" value="${e.perfuracao_inicio ? esc(String(e.perfuracao_inicio).slice(0,16)) : ""}" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,helice_secante"${showHelice||tipo==='trado_mecanizado'?'':' style="display:none;"'}><input type="datetime-local" class="ex-perff col-lg" value="${e.perfuracao_fim ? esc(String(e.perfuracao_fim).slice(0,16)) : ""}" /></td>
      <td data-col-tipo="helice_continua,helice_secante"${showHelice?'':' style="display:none;"'}><input type="datetime-local" class="ex-conci col-lg" value="${e.concretagem_inicio ? esc(String(e.concretagem_inicio).slice(0,16)) : ""}" /></td>
      <td data-col-tipo="helice_continua,helice_secante"${showHelice?'':' style="display:none;"'}><input type="datetime-local" class="ex-concf col-lg" value="${e.concretagem_fim ? esc(String(e.concretagem_fim).slice(0,16)) : ""}" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,helice_secante"${showHelice||tipo==='trado_mecanizado'?'':' style="display:none;"'}><input type="number" class="ex-torque" step="0.1" value="${esc(e.torque ?? "")}" style="width:70px;" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,helice_secante"${showHelice||tipo==='trado_mecanizado'?'':' style="display:none;"'}><input type="number" class="ex-vol" step="0.001" min="0" value="${esc(e.volume_concreto_m3 ?? "")}" style="width:70px;" /></td>
      <td><select class="ex-equip col-sm">${eqOpts}</select></td>
      <td><input type="text" class="ex-maq col-xs" value="${esc(e.maquina_codigo||"")}" placeholder="ou texto" /></td>
      <td><select class="ex-operador" style="min-width:140px;">${opOpts}</select></td>
      <td><input type="text" class="ex-obs" value="${esc(e.observacoes||"")}" style="min-width:140px;" /></td>
      <td class="ex-etapa">${rdoEtapaHTML(e)}</td>
      <td data-col-tipo="estaca_raiz"><button type="button" class="btn-sec btn-sm btn-boletim-toggle" data-idx="${idx}" style="${bltStyle}" title="Boletim desta estaca: camadas de solo e ferramenta, injeção, paradas">Camadas${(e._solo || []).length ? " (" + e._solo.length + ")" : ""}</button></td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-ex-rem txt-perigo" data-idx="${idx}">×</button></td>
    </tr>${ehRaiz ? `<tr class="rdo-camadas-resumo" data-resumo-idx="${idx}"><td colspan="20">${rdoResumoLinhaRaizHTML(e)}</td></tr>` : ""}`;   // fase 101 (#99): visível sem expandir
  }).join("");

  // pré-seleciona equipamento + operador nos selects
  _rdoExecucoes.forEach((e, idx) => {
    const tr = tb.querySelector(`tr[data-idx="${idx}"]`);
    if(!tr) return;
    if(e.equipamento_id) tr.querySelector(".ex-equip").value = e.equipamento_id;
    if(e.operador_id)    tr.querySelector(".ex-operador").value = e.operador_id;
  });

  // Injeta boletim expandido abaixo da linha correta
  if(ehRaiz && _rdoBoletimAberto !== null && _rdoExecucoes[_rdoBoletimAberto]){
    const mainRow = tb.querySelector(`tr[data-resumo-idx="${_rdoBoletimAberto}"]`) || tb.querySelector(`tr[data-idx="${_rdoBoletimAberto}"]`);   // fase 101: depois do resumo
    if(mainRow){
      mainRow.insertAdjacentHTML("afterend", renderBoletimExpandidoHTML(_rdoBoletimAberto));
      attachBoletimListeners(_rdoBoletimAberto);
    }
  }

  // listeners
  tb.querySelectorAll("tr[data-idx]").forEach(tr => {
    const idx = Number(tr.dataset.idx);
    // hotfix 15: o operador digita o acumulado; "No dia" = Acum. − De (listener no campo roda antes do da linha)
    tr.querySelectorAll(".ex-pate, .ex-pde").forEach(inp => inp.addEventListener("input", () => rdoRecalcularNoDia(tr, idx)));
    tr.querySelector(".ex-pate")?.addEventListener("change", () => rdoPreencherAcumAnterior(tr, idx));
    tr.querySelector(".ex-num")?.addEventListener("change", () => rdoPreencherAcumAnterior(tr, idx));
    tr.addEventListener("input", () => coletarExecucao(tr, idx));
    tr.addEventListener("change", () => coletarExecucao(tr, idx));
  });
  tb.querySelectorAll(".btn-ex-rem").forEach(b => {
    b.addEventListener("click", () => {
      _rdoExecucoes.splice(Number(b.dataset.idx), 1);
      if(_rdoBoletimAberto !== null){
        if(_rdoBoletimAberto >= _rdoExecucoes.length) _rdoBoletimAberto = null;
      }
      renderExecucoes();
      atualizarChipsExec();
    });
  });
  if(ehRaiz){
    tb.querySelectorAll(".btn-boletim-toggle").forEach(b => {
      b.addEventListener("click", () => toggleBoletimEstaca(Number(b.dataset.idx)));
    });
  }
  atualizarChipsExec();
}

/* Hotfix 15 (decisão de 05/10/2026): no lançamento manual o operador digita o ACUMULADO da estaca
   (o "até" do boletim). "De" é onde a estaca estava no começo do dia (acumulado dos RDOs anteriores
   desta estaca na obra, trazido sozinho) e "No dia" = Acum. − De, que é o que a medição soma.
   "No dia" só é recalculado enquanto a pessoa não digitar outro valor (data-auto). */
function rdoRecalcularNoDia(tr, idx){
  const ate = numOrNull(tr.querySelector(".ex-pate")?.value);
  const de  = numOrNull(tr.querySelector(".ex-pde")?.value);
  const inPe = tr.querySelector(".ex-pexec");
  if(ate == null || !inPe) return;
  const dia = Math.round((ate - (de ?? 0)) * 100) / 100;
  if(dia < 0) return; // acumulado menor que o anterior: a pessoa confere
  if(inPe.value === "" || inPe.value === inPe.dataset.auto){
    inPe.value = dia; inPe.dataset.auto = String(dia);
    if(_rdoExecucoes[idx]) _rdoExecucoes[idx]._pexecAuto = String(dia);
  }
}
async function rdoAcumAnteriorDaEstaca(numero){
  const obraId = $("rdo-obra")?.value, data = $("rdo-data")?.value;
  if(!obraId || !data || !numero) return null;
  const padrao = String(numero).trim().replace(/[\\%_]/g, "\\$&"); // ilike sem curinga: \, % e _ literais
  let q = sb.from("vw_rdo_execucoes_obra")
    .select("perfuracao_ate_m,profundidade_executada,modalidade_execucao")
    .eq("obra_id", obraId).lt("data", data).ilike("estaca_numero", padrao);
  if(rdoEditId) q = q.neq("rdo_id", rdoEditId);
  const { data: linhas, error } = await q;
  if(error) return null;
  return (linhas || []).filter(l => l.modalidade_execucao !== "refuro")
    .reduce((m, l) => Math.max(m, Number(l.perfuracao_ate_m) || 0, Number(l.profundidade_executada) || 0), 0);
}
async function rdoPreencherAcumAnterior(tr, idx){
  const inDe = tr.querySelector(".ex-pde");
  const ate = numOrNull(tr.querySelector(".ex-pate")?.value);
  const numero = tr.querySelector(".ex-num")?.value.trim();
  if(!inDe || inDe.value !== "" || ate == null || !numero) return; // só preenche "De" vazio, depois de digitado o acumulado
  const anterior = await rdoAcumAnteriorDaEstaca(numero);
  if(anterior == null || inDe.value !== "") return;
  inDe.value = anterior;
  inDe.title = anterior > 0 ? `Acumulado dos RDOs anteriores desta estaca: ${num(anterior)} m` : "Primeiro dia desta estaca: começa em 0";
  rdoRecalcularNoDia(tr, idx);
  coletarExecucao(tr, idx);
}

function coletarExecucao(tr, idx){
  const e = _rdoExecucoes[idx] || {};
  e.estaca_numero       = tr.querySelector(".ex-num")?.value.trim() || null;
  e.diametro_mm         = numOrNull(tr.querySelector(".ex-diam")?.value);
  e.profundidade_projeto = numOrNull(tr.querySelector(".ex-pproj")?.value);
  e.profundidade_executada = numOrNull(tr.querySelector(".ex-pexec")?.value);
  e.perfuracao_de_m     = numOrNull(tr.querySelector(".ex-pde")?.value);
  e.perfuracao_ate_m    = numOrNull(tr.querySelector(".ex-pate")?.value);
  e.perfuracao_inicio   = tr.querySelector(".ex-perfi")?.value || null;
  e.perfuracao_fim      = tr.querySelector(".ex-perff")?.value || null;
  e.concretagem_inicio  = tr.querySelector(".ex-conci")?.value || null;
  e.concretagem_fim     = tr.querySelector(".ex-concf")?.value || null;
  e.torque              = numOrNull(tr.querySelector(".ex-torque")?.value);
  e.volume_concreto_m3  = numOrNull(tr.querySelector(".ex-vol")?.value);
  e.equipamento_id      = tr.querySelector(".ex-equip")?.value || null;
  e.maquina_codigo      = tr.querySelector(".ex-maq")?.value.trim() || null;
  e.operador_id         = tr.querySelector(".ex-operador")?.value || null;
  e.observacoes         = tr.querySelector(".ex-obs")?.value.trim() || null;
  _rdoExecucoes[idx] = e;
  const tdEt = tr.querySelector(".ex-etapa");   // fase 94: etapa final prevista para a linha
  if(tdEt) tdEt.innerHTML = rdoEtapaHTML(e);
  atualizarChipsExec();
}

/* Aplica o operador escolhido na barra a TODAS as execuções da aba */
function aplicarOperadorEmMassa(){
  const sel = $("rdo-exec-op-massa");
  const opId = sel?.value;
  if(!opId){ aviso("app-aviso","Escolha um operador antes.","erro"); return; }
  if(!_rdoExecucoes.length){ aviso("app-aviso","Não há execuções nesta aba.","erro"); return; }
  _rdoExecucoes.forEach(e => { e.operador_id = opId; });
  renderExecucoes();
  const nome = _rdoFuncs.find(f => f.id === opId)?.nome || "operador";
  aviso("app-aviso", `Operador "${nome}" aplicado a ${_rdoExecucoes.length} execução(ões). Não esqueça de salvar.`, "ok");
}

function numOrNull(v){
  if(v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
}

function adicionarExecucao(){
  _rdoExecucoes.push({
    estaca_numero: "",
    diametro_mm: 400,
    profundidade_projeto: null,
    profundidade_executada: null,
    _solo: [],
    _just: []
  });
  renderExecucoes();
}

function atualizarChipsExec(){
  $("rdo-ficha-execs-chip").textContent = _rdoExecucoes.length;
  const metragem = _rdoExecucoes.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0);
  $("rdo-ficha-metragem-chip").textContent = `${num(metragem)} m`;
  rdoRenderTotaisRaiz();   // fase 101 (#99)
}

/* ---------- Boletim por estaca (Estaca Raiz) ---------- */
function toggleBoletimEstaca(idx){
  _rdoBoletimAberto = (_rdoBoletimAberto === idx) ? null : idx;
  renderExecucoes();
}

function renderBoletimSoloRows(idx){
  const solos = (_rdoExecucoes[idx]?._solo) || [];
  if(!solos.length)
    return `<tr><td colspan="5" class="vazio" style="font-size:var(--txt-xs);">Sem camadas. Clique em "+ Camada de solo".</td></tr>`;
  return solos.map((s, si) => `<tr data-solo-idx="${si}">
    <td><input type="number" step="0.01" min="0" class="blt-solo-ini col-sm" value="${esc(s.inicio_ml??'')}" /></td>
    <td><input type="number" step="0.01" min="0" class="blt-solo-fim col-sm" value="${esc(s.final_ml??'')}" /></td>
    <td><input type="text" class="blt-solo-class" list="rdo-solo-classif-lista" value="${esc(s.classificacao||'')}" style="min-width:200px;" title="Sugestões em Usuários › Parâmetros do RDO; aceita texto livre" /></td>
    <td><select class="blt-solo-ferr"><option value="">—</option>${Object.entries(FERRAMENTAS_RAIZ).map(([v,l]) => `<option value="${esc(v)}"${s.ferramenta===v?' selected':''}>${esc(l)}</option>`).join('')}</select></td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-blt-solo-rem txt-perigo" data-si="${si}">×</button></td>
  </tr>`).join('');
}

function renderBoletimJustRows(idx){
  const justs = (_rdoExecucoes[idx]?._just) || [];
  if(!justs.length)
    return `<tr><td colspan="4" class="vazio" style="font-size:var(--txt-xs);">Sem justificativas.</td></tr>`;
  return justs.map((j, ji) => `<tr data-just-idx="${ji}">
    <td><input type="text" class="blt-just-hi col-xs" placeholder="HH:MM" value="${esc(j.h_inicial||'')}" /></td>
    <td><input type="text" class="blt-just-hf col-xs" placeholder="HH:MM" value="${esc(j.h_final||'')}" /></td>
    <td><input type="text" class="blt-just-mot" value="${esc(j.motivo||'')}" style="min-width:220px;" /></td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-blt-just-rem txt-perigo" data-ji="${ji}">×</button></td>
  </tr>`).join('');
}

function renderBoletimExpandidoHTML(idx){
  const e = _rdoExecucoes[idx] || {};
  const incOpts = ['Vertical','5°','10°','15°','20°','Outro'].map(v =>
    `<option value="${esc(v)}"${e.inclinacao===v?' selected':''}>${esc(v)}</option>`).join('');
  const combOpts = ['Diesel','Gasolina','GNV','Elétrico','Outro'].map(v =>
    `<option value="${esc(v)}"${e.abastecimento_tipo===v?' selected':''}>${esc(v)}</option>`).join('');
  const cimUn = [['saco','Sacos'],['kg','kg'],['m3','m³']].map(([v,l]) =>
    `<option value="${esc(v)}"${e.consumo_cimento_unidade===v?' selected':''}>${esc(l)}</option>`).join('');
  const arUn  = [['m3','m³'],['kg','kg'],['padiola','padiola']].map(([v,l]) =>   // fase 101 (#99): padiola
    `<option value="${esc(v)}"${e.consumo_areia_unidade===v?' selected':''}>${esc(l)}</option>`).join('');

  return `<tr class="rdo-boletim-row" data-boletim-idx="${esc(idx)}">
    <td colspan="20" class="rdo-boletim-cell">
      <div class="rdo-boletim-conteudo">
        <div class="rdo-boletim-titulo">📋 Boletim de Perfuração — Estaca ${esc(e.estaca_numero||'?')}</div>

        <div class="grade">
          <div class="campo"><label>Nº Boletim Físico</label>
            <input class="blt-num-fisico" value="${esc(e.numero_boletim_fisico||'')}" placeholder="000001" style="width:110px;" /></div>
          <div class="campo"><label>Inclinação</label>
            <select class="blt-inclinacao"><option value="">—</option>${incOpts}</select></div>
          <div class="campo"><label>Tipo de combustível</label>
            <select class="blt-combustivel"><option value="">—</option>${combOpts}</select></div>
          <div class="campo"><label>Quantidade abastecida</label>
            <input class="blt-abst-qtd" value="${esc(e.abastecimento_quantidade||'')}" placeholder="ex: 80L" style="width:120px;" /></div>
        </div>

        <div class="rdo-boletim-secao">Característica da Estaca (Solo)</div>
        <div class="tabela-rola">
          <table class="itens-tabela" id="blt-solo-tbl-${esc(idx)}">
            <thead><tr><th>Início (ml)</th><th>Final (ml)</th><th>Classificação do Solo</th><th>Ferramenta</th><th class="col-acao"></th></tr></thead>
            <tbody>${renderBoletimSoloRows(idx)}</tbody>
          </table>
        </div>
        <button type="button" class="btn-sec btn-sm btn-blt-add-solo" style="margin:4px 0 14px;">+ Camada de solo</button>

        <div class="rdo-boletim-secao">Injeção de Argamassa</div>
        <div class="grade" style="align-items:flex-end;">
          <div class="campo"><label>Consumo de Cimento</label>
            <div style="display:flex;gap:4px;">
              <input class="blt-cim-val col-xs" value="${esc(e.consumo_cimento_raiz||'')}" />
              <select class="blt-cim-un" style="width:72px;"><option value="">un.</option>${cimUn}</select>
            </div></div>
          <div class="campo"><label>Consumo de Areia</label>
            <div style="display:flex;gap:4px;">
              <input class="blt-ar-val col-xs" value="${esc(e.consumo_areia_raiz||'')}" />
              <select class="blt-ar-un" style="width:72px;"><option value="">un.</option>${arUn}</select>
            </div></div>
          <div class="campo"><label>Pressão (kg/cm²)</label>
            <input type="number" step="0.01" class="blt-pressao col-sm" value="${esc(e.pressao_injecao_kgcm2??'')}" /></div>
          <div class="campo"><label>Volume injetado (m³)</label>
            <input type="number" step="0.01" min="0" class="blt-vol-inj col-sm" value="${esc(e.volume_injetado_m3??'')}" /></div>
          <div class="campo"><label>Água (L)</label>
            <input type="number" step="1" min="0" class="blt-agua col-sm" value="${esc(e.agua_l??'')}" /></div>
        </div>
        <div class="campo" style="max-width:420px;margin-bottom:14px;">
          <label>Identificação dos Acessórios</label>
          <input class="blt-acessorios" value="${esc(e.identificacao_acessorios||'')}" /></div>

        <div class="rdo-boletim-secao">Justificativas (paradas)</div>
        <div class="tabela-rola">
          <table class="itens-tabela" id="blt-just-tbl-${esc(idx)}">
            <thead><tr><th>H Inicial</th><th>H Final</th><th>Motivo</th><th class="col-acao"></th></tr></thead>
            <tbody>${renderBoletimJustRows(idx)}</tbody>
          </table>
        </div>
        <button type="button" class="btn-sec btn-sm btn-blt-add-just" style="margin-top:4px;">+ Justificativa</button>
      </div>
    </td>
  </tr>`;
}

function attachBoletimListeners(idx){
  const row = document.querySelector(`.rdo-boletim-row[data-boletim-idx="${idx}"]`);
  if(!row) return;
  const e = _rdoExecucoes[idx];
  if(!e) return;
  if(!e._solo) e._solo = [];
  if(!e._just) e._just = [];

  const syncCampos = () => {
    e.numero_boletim_fisico    = row.querySelector('.blt-num-fisico')?.value.trim()   || null;
    e.inclinacao               = row.querySelector('.blt-inclinacao')?.value           || null;
    e.abastecimento_tipo       = row.querySelector('.blt-combustivel')?.value          || null;
    e.abastecimento_quantidade = row.querySelector('.blt-abst-qtd')?.value.trim()     || null;
    e.consumo_cimento_raiz     = row.querySelector('.blt-cim-val')?.value.trim()      || null;
    e.consumo_cimento_unidade  = row.querySelector('.blt-cim-un')?.value              || null;
    e.consumo_areia_raiz       = row.querySelector('.blt-ar-val')?.value.trim()       || null;
    e.consumo_areia_unidade    = row.querySelector('.blt-ar-un')?.value               || null;
    e.pressao_injecao_kgcm2    = numOrNull(row.querySelector('.blt-pressao')?.value);
    e.volume_injetado_m3       = numOrNull(row.querySelector('.blt-vol-inj')?.value);   // fase 101 (#99)
    e.agua_l                   = numOrNull(row.querySelector('.blt-agua')?.value);
    e.identificacao_acessorios = row.querySelector('.blt-acessorios')?.value.trim()   || null;
    rdoAtualizarResumoLinha(idx);
  };
  row.addEventListener('input',  syncCampos);
  row.addEventListener('change', syncCampos);

  const rebindSolo = () => {
    const tb2 = document.querySelector(`#blt-solo-tbl-${idx} tbody`);
    if(!tb2) return;
    tb2.querySelectorAll('tr[data-solo-idx]').forEach(tr => {
      const si = Number(tr.dataset.soloIdx);
      tr.addEventListener('input', () => {
        if(!e._solo[si]) e._solo[si] = {};
        e._solo[si].inicio_ml     = numOrNull(tr.querySelector('.blt-solo-ini').value);
        e._solo[si].final_ml      = numOrNull(tr.querySelector('.blt-solo-fim').value);
        e._solo[si].classificacao = tr.querySelector('.blt-solo-class').value.trim() || null;
        e._solo[si].ferramenta    = tr.querySelector('.blt-solo-ferr')?.value || null;
        sincronizarTrechoDaEstaca(idx);
        rdoAtualizarResumoLinha(idx);   // fase 101: resumo da linha acompanha
      });
      tr.querySelector('.blt-solo-ferr')?.addEventListener('change', () => tr.dispatchEvent(new Event('input')));
    });
    tb2.querySelectorAll('.btn-blt-solo-rem').forEach(b => {
      b.addEventListener('click', () => {
        e._solo.splice(Number(b.dataset.si), 1);
        const tb3 = document.querySelector(`#blt-solo-tbl-${idx} tbody`);
        if(tb3){ tb3.innerHTML = renderBoletimSoloRows(idx); rebindSolo(); }
        rdoAtualizarResumoLinha(idx);
      });
    });
  };
  rebindSolo();

  row.querySelector('.btn-blt-add-solo')?.addEventListener('click', () => {
    // fase 101: a camada nova começa onde a anterior terminou
    const ult = e._solo[e._solo.length - 1];
    e._solo.push(ult && ult.final_ml != null ? { inicio_ml: ult.final_ml } : {});
    const tb2 = document.querySelector(`#blt-solo-tbl-${idx} tbody`);
    if(tb2){ tb2.innerHTML = renderBoletimSoloRows(idx); rebindSolo(); }
    rdoAtualizarResumoLinha(idx);
  });

  const rebindJust = () => {
    const tb2 = document.querySelector(`#blt-just-tbl-${idx} tbody`);
    if(!tb2) return;
    tb2.querySelectorAll('tr[data-just-idx]').forEach(tr => {
      const ji = Number(tr.dataset.justIdx);
      tr.addEventListener('input', () => {
        if(!e._just[ji]) e._just[ji] = {};
        e._just[ji].h_inicial = tr.querySelector('.blt-just-hi').value.trim() || null;
        e._just[ji].h_final   = tr.querySelector('.blt-just-hf').value.trim() || null;
        e._just[ji].motivo    = tr.querySelector('.blt-just-mot').value.trim() || null;
      });
    });
    tb2.querySelectorAll('.btn-blt-just-rem').forEach(b => {
      b.addEventListener('click', () => {
        e._just.splice(Number(b.dataset.ji), 1);
        const tb3 = document.querySelector(`#blt-just-tbl-${idx} tbody`);
        if(tb3){ tb3.innerHTML = renderBoletimJustRows(idx); rebindJust(); }
      });
    });
  };
  rebindJust();

  row.querySelector('.btn-blt-add-just')?.addEventListener('click', () => {
    e._just.push({});
    const tb2 = document.querySelector(`#blt-just-tbl-${idx} tbody`);
    if(tb2){ tb2.innerHTML = renderBoletimJustRows(idx); rebindJust(); }
  });
}

/* Trecho do dia (de–até) derivado das camadas de solo do boletim: menor início → De,
   maior final → Acum. "No dia" = Acum. − De (hotfix 15), só quando estava vazio ou ainda era
   o valor calculado antes — se a pessoa digitou outro valor, fica como está. */
function sincronizarTrechoDaEstaca(idx){
  const e = _rdoExecucoes[idx];
  if(!e) return;
  const camadas = (e._solo || []).filter(s => s.inicio_ml != null || s.final_ml != null);
  if(!camadas.length) return;
  const de  = camadas.reduce((m, s) => (s.inicio_ml != null && (m == null || s.inicio_ml < m)) ? s.inicio_ml : m, null);
  const ate = camadas.reduce((m, s) => (s.final_ml  != null && (m == null || s.final_ml  > m)) ? s.final_ml  : m, null);
  e.perfuracao_de_m = de; e.perfuracao_ate_m = ate;
  const noDia = ate != null ? Math.round((ate - (de ?? 0)) * 100) / 100 : null;
  if(noDia != null && noDia >= 0 && (e.profundidade_executada == null || String(e.profundidade_executada) === String(e._pexecAuto ?? ""))){
    e.profundidade_executada = noDia; e._pexecAuto = String(noDia);
  }
  const tr = $("rdo-execs")?.querySelector(`tr[data-idx="${idx}"]`);
  if(tr){
    const set = (cls, v) => { const el = tr.querySelector(cls); if(el) el.value = v ?? ""; };
    set(".ex-pde", de); set(".ex-pate", ate); set(".ex-pexec", e.profundidade_executada);
  }
  atualizarChipsExec();
}

/* ---------- Concretagem: volume automático (mesma fórmula de fn_volume_concreto no banco) ----------
   saco:    peso_saco × qtd_sacos ÷ traço (kg cimento/m³)
   usinado: (Ø/2000)² × π × profundidade × fator de perda
   Parâmetros vêm da obra (obras.concretagem_tipo_padrao, traco_kg_cimento_m3, peso_saco_kg,
   fator_perda_concreto); os defaults são os mesmos do banco. */
function volumeConcretoJS(tipo, diametroMm, profMaxM, qtdSacos, params){
  const p = params || {};
  const peso  = Number(p.peso_saco_kg ?? 50) || 50;
  const traco = Number(p.traco_kg_cimento_m3 ?? 750) || 750;
  const perda = Number(p.fator_perda_concreto ?? 1.20) || 1.20;
  if(tipo === "saco"){
    if(qtdSacos == null || !(traco > 0)) return null;
    return Math.round(peso * qtdSacos / traco * 1000) / 1000;
  }
  if(tipo === "usinado"){
    if(diametroMm == null || profMaxM == null) return null;
    return Math.round(Math.pow(diametroMm / 2000, 2) * Math.PI * profMaxM * perda * 1000) / 1000;
  }
  return null;
}
async function carregarParamsObraRDO(obraId){
  _rdoObraParams = null;
  rdoMontarSelectMaquina(obraId);   // fase 101: máquinas da obra primeiro (não bloqueia a jornada)
  if(!obraId){ atualizarChipJornadaRDO(null); rdoMostrarPeriodo(); return null; }
  const [{ data }] = await Promise.all([
    sb.from("obras")
      .select("concretagem_tipo_padrao,concreto_fornecedor,traco_kg_cimento_m3,peso_saco_kg,fator_perda_concreto,jornada_entrada,jornada_saida,jornada_sexta_entrada,jornada_sexta_saida,dois_turnos,jornada_noturno_entrada,jornada_noturno_saida,jornada_noturno_sexta_entrada,jornada_noturno_sexta_saida")
      .eq("id", obraId).maybeSingle(),
    carregarJornadaEmpresa()
  ]);
  _rdoObraParams = data || null;
  rdoMostrarPeriodo();
  atualizarChipJornadaRDO(obraId);   // fase 155b: depois do período, que pode voltar a diurno em obra de um turno
  return _rdoObraParams;
}
/* Fase 155a: o Período só aparece em obra de dois turnos, ou no diário que já é noturno (para poder corrigir).
   Diário novo em obra de um turno nasce diurno. */
function rdoMostrarPeriodo(){
  const sel = $("rdo-turno");
  if(!sel) return;
  const campo = sel.closest(".campo") || sel;
  const dois = !!(_rdoObraParams && _rdoObraParams.dois_turnos);
  if(!dois && !rdoEditId) sel.value = "diurno";
  campo.style.display = dois || sel.value === "noturno" ? "" : "none";
}
/* Lote S40 (#31): chip amarelo na ficha quando a obra não tem jornada e o cálculo usa a da empresa.
   Fase 155b: no diário noturno, o chip avisa a obra sem jornada noturna (HE zero até preencher). */
function atualizarChipJornadaRDO(obraId){
  const chip = $("rdo-ficha-jornada-chip");
  if(!chip) return;
  const j = obraId ? jornadaEfetiva(_rdoObraParams, $("rdo-turno")?.value) : null;
  const txt = $("rdo-ficha-jornada-txt");
  if(txt) txt.textContent = j && j.sem_jornada_noturna ? "Obra sem jornada noturna; HE zero até preencher" : "Obra sem jornada; usando padrão da empresa";
  chip.style.display = j && (j.padrao_empresa || j.sem_jornada_noturna) ? "" : "none";
  chip.dataset.obraId = obraId || "";
}
/* Preenche Vol. m³ das execuções pela parametrização da obra. Só as vazias, a menos
   que a pessoa confirme sobrescrever. Raiz em saco usa o consumo de cimento do boletim. */
async function calcularConcretoExecucoes(){
  const obraId = $("rdo-obra")?.value;
  if(!obraId){ aviso("app-aviso","Selecione a obra antes.","erro"); return; }
  if(!_rdoObraParams) await carregarParamsObraRDO(obraId);
  const p = _rdoObraParams || {};
  const tipo = p.concretagem_tipo_padrao || "usinado";
  if(!p.concretagem_tipo_padrao){
    aviso("app-aviso","A obra não tem tipo de concretagem cadastrado (Obra › Parâmetros). Calculando como usinado com os padrões (traço 750, perda 1,20).","erro");
  }
  const preenchidas = _rdoExecucoes.filter(e => e.volume_concreto_m3 != null).length;
  const sobrescrever = preenchidas ? confirm(`${preenchidas} execução(ões) já têm volume. Sobrescrever também essas? (Cancelar = só preencher as vazias)`) : false;
  let n = 0, semDados = 0;
  _rdoExecucoes.forEach(e => {
    if(e.volume_concreto_m3 != null && !sobrescrever) return;
    let qtdSacos = null;
    if(tipo === "saco"){
      const un = e.consumo_cimento_unidade || "saco";
      const q = numOrNull(e.consumo_cimento_raiz);
      if(q != null) qtdSacos = un === "kg" ? q / (Number(p.peso_saco_kg ?? 50) || 50) : un === "saco" ? q : null;
    }
    // hotfix 15: o volume usa a profundidade acumulada da estaca (até), nunca a metragem do dia;
    // profundidade_executada só entra na estaca de um dia, sem trecho informado.
    const prof = numOrNull(e.perfuracao_ate_m) ?? (e.perfuracao_de_m == null ? numOrNull(e.profundidade_executada) : null);
    const v = volumeConcretoJS(tipo, e.diametro_mm, prof, qtdSacos, p);
    if(v == null){ semDados++; return; }
    e.volume_concreto_m3 = v; n++;
  });
  renderExecucoes();
  const forn = p.concreto_fornecedor === "cliente" ? " Concreto fornecido pelo cliente: o volume é só controle, não entra em custo da CGL." : "";
  aviso("app-aviso", `Volume calculado em ${n} execução(ões) (${tipo === "saco" ? "cimento em saco" : "usinado"}).${semDados ? ` ${semDados} sem dados suficientes (Ø/profundidade ou sacos).` : ""}${forn} Não esqueça de salvar.`, n ? "ok" : "erro");
}

/* ---------- Sub-grades Raiz ---------- */
function renderRaizSolo(){
  const tb = $("rdo-raiz-solo");
  if(!tb) return;
  if(!_rdoRaizSolo.length){
    tb.innerHTML = `<tr><td colspan="4" class="vazio">Adicione trechos de solo.</td></tr>`;
    return;
  }
  tb.innerHTML = _rdoRaizSolo.map((s, idx) => `<tr data-idx="${idx}">
    <td><input type="number" step="0.01" min="0" class="rs-ini col-md" value="${esc(s.inicio_ml ?? "")}" /></td>
    <td><input type="number" step="0.01" min="0" class="rs-fim col-md" value="${esc(s.final_ml ?? "")}" /></td>
    <td><input type="text" class="rs-class" value="${esc(s.classificacao||"")}" /></td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-rs-rem txt-perigo" data-idx="${idx}">×</button></td>
  </tr>`).join("");
  tb.querySelectorAll("tr").forEach(tr => {
    const idx = Number(tr.dataset.idx);
    tr.addEventListener("input", () => {
      _rdoRaizSolo[idx] = {
        inicio_ml: numOrNull(tr.querySelector(".rs-ini").value),
        final_ml: numOrNull(tr.querySelector(".rs-fim").value),
        classificacao: tr.querySelector(".rs-class").value.trim() || null
      };
    });
  });
  tb.querySelectorAll(".btn-rs-rem").forEach(b => {
    b.addEventListener("click", () => { _rdoRaizSolo.splice(Number(b.dataset.idx),1); renderRaizSolo(); });
  });
}

function adicionarRaizSolo(){
  _rdoRaizSolo.push({});
  renderRaizSolo();
}

/* ---------- Chamado #5 (Arthur, 15/09/2026): atividades hora a hora do dia ----------
   Grade na aba "Clima & efetivo", abaixo do resumo de atividades: hora início, hora fim,
   descrição e duração calculada (fim − início), com total do dia. Gravada em
   rdo_raiz_justificativa com execucao_id nulo (tabela já existente; as linhas com
   execucao_id são as paradas por estaca do boletim raiz e não passam por aqui).
   A importação de diário por IA (v3.2) preenche esta lista a partir da JUSTIFICATIVA. */
function rdoDuracaoMin(hi, hf){
  const a = minutosHHMM(hi), b = minutosHHMM(hf);
  if(a == null || b == null) return null;
  let d = b - a;
  if(d < 0) d += 1440;
  return d;
}
function rdoFmtDuracao(min){
  if(min == null) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h${esc(String(m).padStart(2, "0"))}` : `${esc(m)} min`;
}
function renderRdoAtividades(){
  const tb = $("rdo-atividades-grade");
  if(!tb) return;
  const tot = $("rdo-atividades-total");
  if(!_rdoAtividades.length){
    tb.innerHTML = `<tr><td colspan="5" class="vazio">Sem atividades hora a hora. Importe o diário ou use "+ Atividade".</td></tr>`;
    if(tot) tot.textContent = "—";
    return;
  }
  let total = 0, algum = false;
  tb.innerHTML = _rdoAtividades.map((a, idx) => {
    const d = rdoDuracaoMin(a.h_inicial, a.h_final);
    if(d != null){ total += d; algum = true; }
    return `<tr data-idx="${idx}">
      <td><input type="time" class="ra-hi" value="${esc(a.h_inicial || "")}" /></td>
      <td><input type="time" class="ra-hf" value="${esc(a.h_final || "")}" /></td>
      <td><input type="text" class="ra-mot" value="${esc(a.motivo || "")}" placeholder="descrição da atividade" /></td>
      <td class="num ra-dur">${rdoFmtDuracao(d)}</td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-ra-rem txt-perigo" data-idx="${idx}" title="remover">×</button></td>
    </tr>`;
  }).join("");
  if(tot) tot.textContent = algum ? rdoFmtDuracao(total) : "—";
  tb.querySelectorAll("tr").forEach(tr => {
    const idx = Number(tr.dataset.idx);
    tr.addEventListener("input", () => {
      _rdoAtividades[idx] = {
        h_inicial: tr.querySelector(".ra-hi").value || null,
        h_final:   tr.querySelector(".ra-hf").value || null,
        motivo:    tr.querySelector(".ra-mot").value.trim() || null
      };
      const d = rdoDuracaoMin(_rdoAtividades[idx].h_inicial, _rdoAtividades[idx].h_final);
      tr.querySelector(".ra-dur").textContent = rdoFmtDuracao(d);
      let t = 0, ok = false;
      _rdoAtividades.forEach(x => { const dd = rdoDuracaoMin(x.h_inicial, x.h_final); if(dd != null){ t += dd; ok = true; } });
      if(tot) tot.textContent = ok ? rdoFmtDuracao(t) : "—";
    });
  });
  tb.querySelectorAll(".btn-ra-rem").forEach(b => {
    b.addEventListener("click", () => { _rdoAtividades.splice(Number(b.dataset.idx), 1); renderRdoAtividades(); });
  });
}
function adicionarRdoAtividade(){
  // hora inicial sugerida = hora final da última linha
  const ult = _rdoAtividades[_rdoAtividades.length - 1];
  _rdoAtividades.push({ h_inicial: (ult && ult.h_final) || null, h_final: null, motivo: null });
  renderRdoAtividades();
  const tb = $("rdo-atividades-grade");
  tb?.querySelector("tr:last-child .ra-mot")?.focus();
}

/* ====================================================================
   ABA EQUIPE — genérica (todos os tipos de RDO)
   ==================================================================== */

const RDO_FUNCOES = [
  { v:"encarregado",  l:"Encarregado" },
  { v:"operador",     l:"Operador" },
  { v:"ajudante",     l:"Ajudante" },
  { v:"sondador",     l:"Sondador" },
  { v:"motorista",    l:"Motorista" },
  { v:"soldador",     l:"Soldador" },
  { v:"apontador",    l:"Apontador" },
  { v:"tecnico",      l:"Técnico" },
  { v:"engenheiro",   l:"Engenheiro" },
  { v:"seguranca",    l:"Segurança" },
  { v:"terceirizado", l:"Terceirizado" },
  { v:"outro",        l:"Outro" }
];

/* Fase 103 (#23): status do funcionário no dia (rdo_equipe.status_dia; vazio = presente), os dez status do chamado.
   A regra de horas é do banco (gatilho trg_rdo_equipe_status_dia): ausência zera as horas e apaga o horário; treinamento
   e viagem ficam sem HE; a viagem vira horas de viagem no fechamento do mês (vw_rh_horas_mes, rubrica horas_viagem);
   "Revisar informação" segura a liberação para a folha até alguém corrigir e trocar o status. A tela só espelha a regra:
   esconde o horário da ausência, trava a HE de treinamento e viagem e mostra as horas de viagem.
   Lote S54 (#178): "Folga meio período" (meio:true) é presença com o horário trabalhado obrigatório (débito de meia jornada
   sai no fechamento do mês); treinamento só perde a HE em dia útil não feriado (rdoSemHE: sábado, domingo e feriado pagam). */
const RDO_STATUS_DIA = [
  { v:"atestado",            l:"Atestado",            aus:true },
  { v:"dsr",                 l:"DSR",                 aus:true },
  { v:"em_treinamento",      l:"Em Treinamento",      semHE:true },
  { v:"em_viagem",           l:"Em Viagem",           semHE:true, viagem:true },
  { v:"falta",               l:"Falta",               aus:true },
  { v:"folga",               l:"Folga",               aus:true },
  { v:"folga_meio_periodo",  l:"Folga meio período",  meio:true },
  { v:"manutencao",          l:"Manutenção" },
  { v:"noturno",             l:"Noturno" },
  { v:"revisar_informacao",  l:"Revisar Informação",  revisar:true },
  { v:"viagem_retorno_casa", l:"Viagem Retorno Casa", semHE:true, viagem:true }
];
function rdoStatusDia(v){ return RDO_STATUS_DIA.find(s => s.v === v) || null; }
/* Lote S54 (#178, decisão 4): o status tira a HE neste dia? Viagem sempre; treinamento só em dia útil não feriado (em
   sábado, domingo e feriado toda hora trabalhada é HE 100 % e fica). Sem data vale a regra da 103 (sem HE). Mesma conta do
   gatilho fn_rdo_equipe_status_dia e de vw_rh_horas_mes. */
function rdoSemHE(st, dataISO, feriado){
  if(!st?.semHE) return false;
  if(st.viagem) return true;
  const m = String(dataISO || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return true;
  const dow = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
  return dow !== 0 && dow !== 6 && !feriado;
}
function rdoDiaFormulario(){ return { data: $("rdo-data")?.value || null, feriado: !!$("rdo-feriado")?.checked }; }
/* Limpa na linha o que o status não admite (o gatilho do banco faz o mesmo ao gravar). dataISO/feriado: o dia do RDO (padrão:
   o do formulário), porque a HE do treinamento depende do dia (lote S54) */
function rdoAplicarStatusDia(l, dataISO, feriado){
  const s = l ? rdoStatusDia(l.status_dia) : null;
  if(!s) return l;
  if(dataISO === undefined){ const d = rdoDiaFormulario(); dataISO = d.data; feriado = d.feriado; }
  if(s.aus) Object.assign(l, { hora_entrada: null, hora_saida: null, intervalo_minutos: null, horas_normais: null,
    horas_50: null, horas_100: null, horas_noturnas: null, horas_noturnas_manual: false });
  else if(rdoSemHE(s, dataISO, feriado)){
    l.horas_50 = null; l.horas_100 = null;
    if(s.viagem){ l.horas_noturnas = null; l.horas_noturnas_manual = false; }
  }
  return l;
}
/* Lote S54 (#178): status do dia a partir do texto do boletim (import por IA; a function só transcreve, o usuário confere
   na tabela de conferência). Sinônimos: FALTA, FOLGA, ½ FOLGA / MEIO PERÍODO, DSR, ATESTADO, TREINAMENTO, VIAGEM, RETORNO,
   MANUTENÇÃO, NOTURNO, REVISAR. Sem correspondência (ou "presente") → null. */
function rdoStatusDiaDeTexto(txt){
  const t = rdoSemAcento(txt).toUpperCase().replace(/\s+/g, " ").trim();
  if(!t) return null;
  if(/PRESENTE|TRABALHOU|NORMAL/.test(t)) return null;
  if(/MEIO|MEIA|1\/2|½/.test(t) && /FOLGA|PERIODO|EXPEDIENTE|DIA/.test(t)) return "folga_meio_periodo";
  if(/FALTA|FALTOU|AUSENTE/.test(t)) return "falta";
  if(/FOLGA/.test(t)) return "folga";
  if(/\bDSR\b|DESCANSO/.test(t)) return "dsr";
  if(/ATESTADO|MEDICO|AFASTAD/.test(t)) return "atestado";
  if(/TREINAMENTO|TREINO|CURSO/.test(t)) return "em_treinamento";
  if(/RETORNO/.test(t)) return "viagem_retorno_casa";
  if(/VIAGEM|VIAJANDO/.test(t)) return "em_viagem";
  if(/MANUTEN/.test(t)) return "manutencao";
  if(/NOTURNO|NOITE/.test(t)) return "noturno";
  if(/REVISAR|CONFERIR|VERIFICAR/.test(t)) return "revisar_informacao";
  return null;
}
/* Horas do dia de quem está em viagem: saída − entrada − intervalo (vazio = 60 min, piso 30), com virada de dia. É o que o
   fechamento do mês soma em horas de viagem (fn_horas_equipe: normais + HE), salvo hora de viagem da 93c no mesmo dia. */
function rdoHorasViagemLinha(l){
  const e = minutosHHMM(l?.hora_entrada), s = minutosHHMM(l?.hora_saida);
  if(e == null || s == null) return null;
  let bruto = s - e; if(bruto < 0) bruto += 24 * 60;
  const iv = (l.intervalo_minutos == null || l.intervalo_minutos === "") ? 60 : Math.max(30, Number(l.intervalo_minutos) || 0);
  return Math.round(Math.max(0, bruto - iv) / 60 * 100) / 100;
}
function rdoTxtHorasViagem(l){ const h = rdoHorasViagemLinha(l); return h == null ? "viagem: —" : `viagem ${num(h)} h`; }
/* Resumo do dia abaixo da tabela: presentes, em viagem, ausentes por status e linhas a revisar */
function renderRdoEquipeResumo(){
  const el = $("rdo-equipe-resumo");
  if(!el) return;
  const linhas = _rdoEquipe.filter(e => e.funcionario_id || (e.nome_avulso && String(e.nome_avulso).trim()));
  if(!linhas.length){ el.innerHTML = ""; return; }
  const cont = {};
  linhas.forEach(e => { const k = rdoStatusDia(e.status_dia) ? e.status_dia : ""; cont[k] = (cont[k] || 0) + 1; });
  const filtra = (f) => RDO_STATUS_DIA.filter(s => f(s) && cont[s.v]);
  const soma = (f) => filtra(f).reduce((t, s) => t + cont[s.v], 0);
  // lote S54 (#178): a folga de meio período conta entre os presentes, com a nota "(½)"
  const detalhe = (f) => filtra(f).map(s => `${esc(s.l)}${s.meio ? " (½)" : ""} ${Number(cont[s.v])}`).join(" · ");
  const ehPresente = (s) => !s.aus && !s.viagem && !s.revisar;
  const presentes = (cont[""] || 0) + soma(ehPresente), viagem = soma(s => s.viagem), ausentes = soma(s => s.aus), revisar = soma(s => s.revisar);
  el.innerHTML = [
    `<strong>${linhas.length}</strong> na equipe:`,
    `<span class="tag verde">${Number(presentes)} presente(s)</span>${soma(ehPresente) ? ` (${detalhe(ehPresente)})` : ""}`,
    viagem ? `<span class="tag azul">${Number(viagem)} em viagem</span> (${detalhe(s => s.viagem)})` : "",
    ausentes ? `<span class="tag cinza">${Number(ausentes)} ausente(s)</span> (${detalhe(s => s.aus)})` : "",
    revisar ? `<span class="tag ambar" title="A liberação dessas horas para a folha fica bloqueada até alguém corrigir e trocar o status">${Number(revisar)} a revisar</span>` : ""
  ].filter(Boolean).join(" ");
}

function renderRdoEquipe(){
  // Renderiza nova tabela genérica
  const tb = $("rdo-equipe-tbody");
  if(!tb) return;
  renderRdoEquipeResumo();   // fase 103
  if(!_rdoEquipe.length){
    tb.innerHTML = `<tr><td colspan="13" class="vazio">Nenhum integrante. Use "+ integrante" ou "📥 Importar equipe".</td></tr>`;
    return;
  }
  const optFunc = '<option value="">— do cadastro —</option>' +
    _rdoFuncs.map(f=>`<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
  const optFuncao = '<option value="">—</option>' +
    RDO_FUNCOES.map(o=>`<option value="${esc(o.v)}">${esc(o.l)}</option>`).join("");
  const optStatus = '<option value="">Presente</option>' +
    RDO_STATUS_DIA.map(s => `<option value="${esc(s.v)}">${esc(s.l)}</option>`).join("");   // fase 103
  // fase 103: ausência esconde horário e horas (inputs ficam, vazios e ocultos, para o sync); "—" no lugar
  const semHorario = '<span class="meta" title="Ausência: sem horário e sem horas no dia">—</span>';

  // fase 93c: linha já liberada para a folha (rdo_equipe.liberado_em) fica travada: o banco recusa alterar ou apagar e o
  // salvar do RDO pula essas linhas (delete só do que não foi liberado). Estorno em "Horas e alocação".
  // fase 103: "Revisar informação" pinta a linha de amarelo (a liberação fica recusada no banco até trocar o status)
  // lote S54 (#178): a HE do treinamento depende do dia do RDO (rdoSemHE); trocar a data ou o feriado redesenha a tabela
  const dia = rdoDiaFormulario();
  tb.innerHTML = _rdoEquipe.map((e, idx) => {
    const st = rdoStatusDia(e.status_dia);
    const aus = !!st?.aus, semHE = rdoSemHE(st, dia.data, dia.feriado), viagem = !!st?.viagem;
    const classes = [e.liberado_em ? "eq-liberada" : "", st?.revisar ? "con-vencendo" : ""].filter(Boolean).join(" ");
    const titulo = e.liberado_em ? "Horas liberadas para a folha em " + dataBR(String(e.liberado_em).slice(0, 10)) + ": estorne em Horas e alocação para alterar"
      : st?.revisar ? "Revisar informação: corrija a linha e troque o status; enquanto isso as horas não são liberadas para a folha"
      : st?.meio ? "Folga meio período: informe a entrada e a saída trabalhadas; o fechamento do mês debita metade da jornada do dia" : "";
    const tituloHE = semHE ? `${st.l}: sem HE (regra do status do dia${st.semHE && !st.viagem ? "; em sábado, domingo e feriado a HE fica" : ""})` : "";
    return `<tr data-idx="${idx}"${classes ? ` class="${esc(classes)}"` : ""}${titulo ? ` title="${esc(titulo)}"` : ""}>
    <td><strong>${idx+1}</strong>${/* html */ rdoTagApp("equipe", e)}</td>
    <td><select class="eq-func">${optFunc}</select></td>
    <td><input type="text" class="eq-nome" placeholder="terceiro sem cadastro" value="${esc(e.nome_avulso||"")}" style="min-width:140px;" /></td>
    <td><select class="eq-funcao">${optFuncao}</select></td>
    <td><select class="eq-status" style="min-width:150px;" title="Status do funcionário no dia (fase 103). Falta, Folga, DSR e Atestado zeram as horas; Em Treinamento (dia útil) e viagem ficam sem HE; Folga meio período exige o horário trabalhado; Revisar Informação bloqueia a liberação para a folha">${optStatus}</select></td>
    <td>${aus ? semHorario : ""}<input type="time" class="eq-entrada" value="${aus ? "" : esc(e.hora_entrada||"")}"${aus ? " hidden" : ""} /></td>
    <td>${aus ? semHorario : ""}<input type="time" class="eq-saida" value="${aus ? "" : esc(e.hora_saida||"")}"${aus ? " hidden" : ""} /></td>
    <td>${aus ? semHorario : ""}<input type="number" class="eq-interv" step="5" min="0" max="240" value="${aus ? "" : esc(e.intervalo_minutos ?? "")}" style="width:60px;" placeholder="60" title="Intervalo real de almoço (min). Vazio = 60; piso 30"${aus ? " hidden" : ""} /></td>
    <td>${aus ? semHorario : ""}<input type="number" class="eq-h50" step="0.5" min="0" value="${aus || semHE ? "" : esc(e.horas_50 ?? "")}" style="width:60px;"${aus ? " hidden" : ""}${semHE ? ` disabled title="${esc(tituloHE)}"` : ""} /></td>
    <td>${aus ? semHorario : ""}${viagem ? `<span class="meta eq-viagem-h" style="white-space:nowrap;" title="Sem HE: as horas do dia (saída − entrada − intervalo) vão para o fechamento do mês como horas de viagem">${esc(rdoTxtHorasViagem(e))}</span>` : ""}<input type="number" class="eq-h100" step="0.5" min="0" value="${aus || semHE ? "" : esc(e.horas_100 ?? "")}" style="width:60px;"${aus || viagem ? " hidden" : ""}${semHE ? ` disabled title="${esc(tituloHE)}"` : ""} /></td>
    <td>${aus ? semHorario : ""}<input type="number" class="eq-hnot" step="0.25" min="0" max="24" value="${aus || viagem ? "" : esc(e.horas_noturnas ?? "")}" style="width:60px;"${aus ? " hidden" : ""}${viagem ? ` disabled title="${esc(st.l)}: viagem não tem adicional noturno"` : ` title="Horas entre 22h e 5h, calculadas da entrada e saída (com virada de dia). Digite para corrigir à mão${e.horas_noturnas_manual ? " · corrigida à mão" : ""}"`} /></td>
    <td><input type="text" class="eq-obs" value="${esc(e.observacoes||"")}" style="min-width:120px;" /></td>
    <td class="col-acao">${e.liberado_em ? '<span title="Liberada para a folha">🔒</span>' : `<button type="button" class="btn-sec btn-sm btn-eq-rem txt-perigo" data-idx="${idx}">×</button>`}</td>
  </tr>`;
  }).join("");

  // Aplica valores de select (que não funcionam via innerHTML value)
  _rdoEquipe.forEach((e, idx) => {
    const tr = tb.querySelector(`tr[data-idx="${idx}"]`);
    if(!tr) return;
    if(e.funcionario_id) tr.querySelector(".eq-func").value = e.funcionario_id;
    if(e.funcao_no_dia)  tr.querySelector(".eq-funcao").value = e.funcao_no_dia;
    if(rdoStatusDia(e.status_dia)) tr.querySelector(".eq-status").value = e.status_dia;   // fase 103
    if(e.liberado_em) tr.querySelectorAll("input,select").forEach(i => { if(!i.classList.contains("eq-obs")) i.disabled = true; });
  });

  // Listener único: sincroniza qualquer mudança pro array
  tb.querySelectorAll("tr").forEach(tr => {
    const idx = Number(tr.dataset.idx);
    const sync = () => {
      _rdoEquipe[idx] = {
        ..._rdoEquipe[idx],   // preserva id se vier do banco
        funcionario_id: tr.querySelector(".eq-func").value || null,
        nome_avulso:    tr.querySelector(".eq-nome").value.trim() || null,
        funcao_no_dia:  tr.querySelector(".eq-funcao").value || null,
        status_dia:     tr.querySelector(".eq-status").value || null,   // fase 103
        hora_entrada:   tr.querySelector(".eq-entrada").value || null,
        hora_saida:     tr.querySelector(".eq-saida").value || null,
        intervalo_minutos: tr.querySelector(".eq-interv").value === "" ? null : Number(tr.querySelector(".eq-interv").value),
        horas_50:       parseFloat(tr.querySelector(".eq-h50").value)  || null,
        horas_100:      parseFloat(tr.querySelector(".eq-h100").value) || null,
        horas_noturnas: tr.querySelector(".eq-hnot").value === "" ? null : (parseFloat(tr.querySelector(".eq-hnot").value) || 0),   // fase 93c
        observacoes:    tr.querySelector(".eq-obs").value.trim() || null,
        ordem:          idx
      };
    };
    tr.addEventListener("input", sync);
    // fase 103: trocar o status limpa o que ele não admite (horário na ausência, HE no treinamento e na viagem) e redesenha
    // a tabela (horário escondido, HE travada, horas de viagem, amarelo do "Revisar informação") e o resumo do dia
    tr.addEventListener("change", ev => {
      sync();
      if(ev.target.classList.contains("eq-status")){ rdoAplicarStatusDia(_rdoEquipe[idx]); renderRdoEquipe(); }
      else if(ev.target.matches(".eq-func, .eq-nome")) renderRdoEquipeResumo();
    });
    // Noturnas digitadas à mão valem (horas_noturnas_manual): o gatilho do banco não recalcula
    tr.querySelector(".eq-hnot")?.addEventListener("input", () => { _rdoEquipe[idx] = { ..._rdoEquipe[idx], horas_noturnas_manual: true }; });
    // Entrada/saída/intervalo → HE 100 calculada pela jornada da obra (regra RH 11/09/2026); a pessoa pode ajustar depois.
    // Fase 93c: noturnas (22h–5h, com virada de dia) recalculadas junto, salvo quando corrigidas à mão
    [".eq-entrada", ".eq-saida", ".eq-interv"].forEach(cls => tr.querySelector(cls)?.addEventListener("change", async () => {
      const obraId = $("rdo-obra")?.value;
      if(obraId && !_rdoObraParams) await carregarParamsObraRDO(obraId);
      const l = _rdoEquipe[idx] || {};
      const st = rdoStatusDia(l.status_dia);   // fase 103
      if(st?.aus) return;                      // ausência não tem horário
      if(!l.horas_noturnas_manual && !st?.viagem){
        const n = calcularHorasNoturnas(l.hora_entrada, l.hora_saida);
        tr.querySelector(".eq-hnot").value = n == null ? "" : n;
      }
      if(rdoSemHE(st, $("rdo-data")?.value, !!$("rdo-feriado")?.checked)){   // lote S54: treinamento só em dia útil
        // fase 103: treinamento e viagem sem HE; na viagem, as horas do dia aparecem como horas de viagem
        const vh = tr.querySelector(".eq-viagem-h");
        if(vh) vh.textContent = rdoTxtHorasViagem(l);
      } else {
        const r = calcularHorasEquipe($("rdo-data")?.value, l.hora_entrada, l.hora_saida, jornadaEfetiva(_rdoObraParams, $("rdo-turno")?.value), l.intervalo_minutos, !!$("rdo-feriado")?.checked);
        if(r){
          tr.querySelector(".eq-h100").value = r.horas_100 || "";
          tr.querySelector(".eq-h50").value = "";
        }
      }
      sync();
    }));
  });
  tb.querySelectorAll(".btn-eq-rem").forEach(b => {
    b.addEventListener("click", () => { _rdoEquipe.splice(Number(b.dataset.idx),1); renderRdoEquipe(); });
  });
}

/* ---------- Abastecimento do dia (fase 46, 16/09/2026) — vem do diário preenchido à mão pelo operador ---------- */
const RDO_COMBUSTIVEIS = ["diesel", "gasolina", "arla", "oleo_hidraulico", "graxa", "outro"];
function renderRdoAbast(){
  const tb = $("rdo-abast-tbody");
  if(!tb) return;
  if(!_rdoAbast.length){
    tb.innerHTML = `<tr><td colspan="6" class="vazio">Nenhum abastecimento. Use "+ abastecimento" para lançar litros e horímetro do diário do operador.</td></tr>`;
    return;
  }
  const optMaq = '<option value="">— máquina —</option>' + _rdoEquipsCache.map(e => `<option value="${esc(e.id)}">${esc(e.codigo || "")}${e.nome ? " · " + esc(e.nome) : ""}</option>`).join("");
  const optComb = RDO_COMBUSTIVEIS.map(c => `<option value="${esc(c)}">${esc(c.replace("_", " "))}</option>`).join("");
  tb.innerHTML = _rdoAbast.map((a, idx) => `<tr data-idx="${idx}">
    <td><select class="ab-maq">${optMaq}</select>${/* html */ rdoTagApp("abast", a)}${a.maquina_codigo && !a.equipamento_id ? `<div class="meta">no diário: ${esc(a.maquina_codigo)}</div>` : ""}</td>
    <td><select class="ab-comb">${optComb}</select></td>
    <td><input type="number" class="ab-qtd" step="0.01" min="0" value="${esc(a.quantidade ?? "")}" style="width:90px;" /></td>
    <td><input type="number" class="ab-hor" step="0.1" min="0" value="${esc(a.horimetro ?? "")}" style="width:100px;" /><div class="meta ab-hor-atual"></div></td>
    <td><input type="text" class="ab-obs" value="${esc(a.observacao || "")}" style="min-width:140px;" /></td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-ab-rem txt-perigo" data-idx="${idx}">×</button></td>
  </tr>`).join("");
  _rdoAbast.forEach((a, idx) => {
    const tr = tb.querySelector(`tr[data-idx="${idx}"]`); if(!tr) return;
    if(a.equipamento_id) tr.querySelector(".ab-maq").value = a.equipamento_id;
    tr.querySelector(".ab-comb").value = RDO_COMBUSTIVEIS.includes(a.combustivel) ? a.combustivel : "outro";
  });
  tb.querySelectorAll("tr").forEach(tr => {
    const idx = Number(tr.dataset.idx);
    const sync = () => {
      const eqId = tr.querySelector(".ab-maq").value || null;
      const eq = eqId ? _rdoEquipsCache.find(e => e.id === eqId) : null;
      _rdoAbast[idx] = { ..._rdoAbast[idx],
        equipamento_id: eqId, maquina_codigo: eq ? eq.codigo : (_rdoAbast[idx].maquina_codigo || null),
        combustivel: tr.querySelector(".ab-comb").value || "diesel",
        quantidade: tr.querySelector(".ab-qtd").value === "" ? null : Number(tr.querySelector(".ab-qtd").value),
        horimetro:  tr.querySelector(".ab-hor").value === "" ? null : Number(tr.querySelector(".ab-hor").value),
        observacao: tr.querySelector(".ab-obs").value.trim() || null };
      rdoAbastAvisoHorimetro(tr);
    };
    tr.addEventListener("input", sync);
    tr.addEventListener("change", sync);
    rdoAbastAvisoHorimetro(tr);
  });
  tb.querySelectorAll(".btn-ab-rem").forEach(b => b.addEventListener("click", () => { _rdoAbast.splice(Number(b.dataset.idx), 1); renderRdoAbast(); }));
}
/* Fase 92 (decisão 7): o horímetro do abastecimento atualiza a máquina (gatilho em rdo_abastecimento). O operador vê o
   horímetro atual da TAG embaixo do campo e um aviso quando digita um número menor — erro de digitação é corrigido aqui,
   antes de salvar; o banco nunca retrocede sozinho. */
function rdoAbastAvisoHorimetro(tr){
  const info = tr.querySelector(".ab-hor-atual"); if(!info) return;
  const eqId = tr.querySelector(".ab-maq")?.value || null;
  const eq = eqId ? _rdoEquipsCache.find(e => e.id === eqId) : null;
  const atual = eq && eq.horimetro != null ? Number(eq.horimetro) : null;
  const digitado = tr.querySelector(".ab-hor")?.value;
  if(atual == null){ info.textContent = eq ? "sem horímetro na máquina" : ""; info.className = "meta ab-hor-atual"; return; }
  if(digitado !== "" && Number(digitado) < atual){
    info.innerHTML = `<span class="tag ambar" title="O horímetro da máquina não volta para trás: confira o diário">menor que o atual (${esc(num(atual))} h)</span>`;
  } else {
    info.textContent = `atual: ${num(atual)} h`;
    info.className = "meta ab-hor-atual";
  }
}
function adicionarRdoAbast(){
  _rdoAbast.push({ combustivel: "diesel" });
  renderRdoAbast();
}

function adicionarRdoEquipe(){
  _rdoEquipe.push({ ordem: _rdoEquipe.length });
  renderRdoEquipe();
}

async function importarEquipeCadastrada(){
  // Carrega equipes ativas (cache na 1ª vez)
  if(!_rdoEquipes.length){
    const { data } = await sb.from("equipes")
      .select("id,nome,encarregado_id,equipe_membros(funcionario_id,funcao_na_equipe,ativo)")
      .eq("ativo", true).order("nome");
    _rdoEquipes = data || [];
  }
  if(!_rdoEquipes.length){
    aviso("app-aviso","Nenhuma equipe ativa cadastrada. Cadastre em Funcionários > Equipes.","erro");
    return;
  }
  // Modal simples via prompt: lista equipes pelo número
  const lista = _rdoEquipes.map((e,i) => `${i+1}. ${e.nome}`).join("\n");
  const escolha = prompt(`Digite o número da equipe a importar:\n\n${lista}`);
  const idx = parseInt(escolha, 10) - 1;
  if(isNaN(idx) || idx < 0 || idx >= _rdoEquipes.length) return;
  const eq = _rdoEquipes[idx];
  const membros = (eq.equipe_membros || []).filter(m => m.ativo);
  // Adiciona encarregado primeiro (se houver)
  const novos = [];
  if(eq.encarregado_id && !_rdoEquipe.find(x => x.funcionario_id === eq.encarregado_id)){
    novos.push({ funcionario_id: eq.encarregado_id, funcao_no_dia: "encarregado", ordem: _rdoEquipe.length });
  }
  membros.forEach(m => {
    if(_rdoEquipe.find(x => x.funcionario_id === m.funcionario_id)) return; // dedup
    novos.push({
      funcionario_id: m.funcionario_id,
      funcao_no_dia: (m.funcao_na_equipe || "outro").toLowerCase(),
      ordem: _rdoEquipe.length + novos.length
    });
  });
  _rdoEquipe.push(...novos);
  renderRdoEquipe();
  aviso("app-aviso", `+${novos.length} integrante(s) importado(s) da equipe "${eq.nome}".`, "ok");
}

/* lote S46 (#96): o Ø precifica a estaca. Diâmetros do serviço da obra (itens do orçamento, filtrados pelo tipo de
   estaca) pela RPC obra_diametros_servico; sem a RPC ou sem orçamento, lista vazia. */
const RDO_TIPO_ESTACA = { estaca_raiz: "raiz", helice_secante: "secante", trado_mecanizado: "escavada", helice_continua: "helice_continua" };
async function rdoDiametrosServico(obraId, tipoServico){
  if(!obraId) return [];
  const { data, error } = await sb.rpc("obra_diametros_servico", { p_obra: obraId, p_tipo: RDO_TIPO_ESTACA[tipoServico] || null });
  return error ? [] : (data || []).map(Number).filter(d => d > 0);
}
/* Antes de gravar: execução sem Ø herda o da estaca cadastrada, senão o Ø único do serviço, senão pergunta.
   Devolve false se o usuário cancelar (não grava). Em branco grava sem Ø (vai para "Para regularizar"). */
async function rdoGarantirDiametros(obraId, tipoServico, execs){
  const falta = () => execs.filter(e => e.estaca_numero && e.modalidade_execucao !== "refuro" && !(Number(e.diametro_mm) > 0));
  if(!falta().length) return true;
  const { data: ests } = await lerTudo(() => sb.from("estacas").select("id,numero,diametro_mm").eq("obra_id", obraId));
  const porId = new Map((ests || []).map(s => [s.id, s]));
  const porNum = new Map();
  (ests || []).forEach(s => { const k = normalizarNumeroEstaca(s.numero || ""); porNum.set(k, porNum.has(k) ? null : s); }); // número repetido em locais diferentes: não adivinha
  falta().forEach(e => {
    const s = (e.estaca_id && porId.get(e.estaca_id)) || porNum.get(normalizarNumeroEstaca(e.estaca_numero));
    if(s && Number(s.diametro_mm) > 0) e.diametro_mm = Number(s.diametro_mm);
  });
  if(!falta().length) return true;
  const diams = await rdoDiametrosServico(obraId, tipoServico);
  if(diams.length === 1){ falta().forEach(e => { e.diametro_mm = diams[0]; }); return true; }
  const lista = falta().map(e => e.estaca_numero);
  const resp = prompt(`${lista.length} estaca(s) sem diâmetro: ${lista.slice(0, 12).join(", ")}${lista.length > 12 ? "…" : ""}.\n` +
    `O Ø precifica a estaca na medição. Informe o Ø em mm para elas` +
    (diams.length ? ` (serviço da obra: ${diams.join(", ")})` : "") +
    `.\nDeixe em branco para gravar sem Ø (a obra fica em "Para regularizar"); Cancelar não grava.`, "");
  if(resp === null) return false;
  const d = Number(String(resp).replace(",", "."));
  if(String(resp).trim() !== ""){
    if(!(d > 0)){ aviso("app-aviso", "Diâmetro inválido: informe em mm (ex.: 400).", "erro"); return false; }
    falta().forEach(e => { e.diametro_mm = d; });
  }
  return true;
}

/* ---------- Salvar / excluir ---------- */
/* Fase 142 (UX-01): uma gravação por vez, porque ela apaga e reinsere os filhos. Salvar, Finalizar e a statusbar passam por aqui;
   quem chega com outra em andamento espera a mesma, sem gravar de novo. Não cobre duas abas nem duas pessoas (DAD-01). */
let _rdoSalvando = null;
function salvarRDO(novoStatus){
  if(!_rdoSalvando) _rdoSalvando = rdoSalvarAgora(novoStatus).finally(() => { _rdoSalvando = null; });
  return _rdoSalvando;
}
async function rdoSalvarAgora(novoStatus){
  const obra_id = $("rdo-obra").value;
  if(!obra_id){ aviso("app-aviso","Selecione a obra.","erro"); ativarTabRDO("cabecalho"); return; }
  const dataRDO = $("rdo-data").value;
  if(!dataRDO){ aviso("app-aviso","Informe a data.","erro"); ativarTabRDO("cabecalho"); return; }

  const tipo = $("rdo-tipo-servico").value;
  // lote S46 (#96): execução sem Ø herda o da estaca/serviço ou o usuário informa antes de gravar
  if(!(await rdoGarantirDiametros(obra_id, tipo, _rdoExecucoes))){ ativarTabRDO("execucoes"); return; }

  const reg = {
    obra_id,
    data:             dataRDO,
    tipo_servico:     tipo,
    equipamento_id:   $("rdo-equipamento")?.value || null,   // fase 94 (#77): um diário por máquina
    turno_campo:      $("rdo-turno")?.value || "diurno",      // fase 134b: período na chave do diário (nulo = diurno)
    status:           novoStatus || $("rdo-status").value || "rascunho",
    responsavel_id:   $("rdo-responsavel").value || null,
    local:            $("rdo-local")?.value.trim() || null,
    tempo_manha:      $("rdo-tempo-manha").value || null,
    tempo_tarde:      $("rdo-tempo-tarde").value || null,
    feriado:          !!$("rdo-feriado")?.checked,
    efetivo_proprio:  Number($("rdo-efetivo-proprio").value || 0),
    efetivo_terceiro: Number($("rdo-efetivo-terceiro").value || 0),
    producao_dia_m:   _rdoExecucoes.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0),
    atividades:       $("rdo-atividades").value.trim() || null,
    observacoes:      $("rdo-obs").value.trim() || null
  };
  // fase 101 (#85): obra que exige máquina recusa o diário sem ela (o gatilho do banco é quem garante)
  if(_rdoObraExige && !reg.equipamento_id){
    aviso("app-aviso", "Esta obra exige a máquina do diário. Escolha o equipamento no cabeçalho (as máquinas da obra vêm primeiro).", "erro");
    ativarTabRDO("cabecalho"); $("rdo-equipamento")?.focus(); return;
  }
  // lote S54 (#178, decisão 3): folga de meio período é presença e precisa das horas trabalhadas (o banco não exige)
  const semMeio = _rdoEquipe.filter(e => !e.liberado_em && rdoStatusDia(e.status_dia)?.meio
    && (e.funcionario_id || (e.nome_avulso && e.nome_avulso.trim())) && !(e.hora_entrada && e.hora_saida));
  if(semMeio.length){
    const nomes = semMeio.map(e => (_rdoFuncs.find(f => f.id === e.funcionario_id) || {}).nome || e.nome_avulso || "?");
    aviso("app-aviso", `Folga meio período precisa das horas trabalhadas: informe entrada e saída de ${nomes.map(esc).join(", ")}.`, "erro");
    ativarTabRDO("equipe"); return;
  }
  // fase 101: trocou a máquina do diário → as execuções que eram da máquina antiga passam para a nova
  if(rdoEditId && _rdoMaqOriginal && reg.equipamento_id && _rdoMaqOriginal !== reg.equipamento_id){
    const n = _rdoExecucoes.filter(e => e.equipamento_id === _rdoMaqOriginal).length;
    if(n && confirm(`Trocar a máquina do diário também nas ${n} execução(ões) que estavam com a máquina anterior?`))
      _rdoExecucoes.forEach(e => { if(e.equipamento_id === _rdoMaqOriginal) e.equipamento_id = reg.equipamento_id; });
  }

  // fase 129c: cada linha mantém o id (o celular, as fotos, a medição e o Geodigitus apontam para ele). Linha nova da tela
  // ganha id aqui; quem fica na tela é gravado por upsert; só sai do banco a linha que a ficha leu e o usuário tirou.
  const novoIdLinha = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : null;
  const execsParaSalvar = _rdoExecucoes.filter(e => e.estaca_numero);
  const eqFica = (e) => !e.liberado_em && (e.funcionario_id || (e.nome_avulso && e.nome_avulso.trim()));
  const abFica = (a) => a.equipamento_id || a.maquina_codigo || a.quantidade != null || a.horimetro != null;
  for(const l of [...execsParaSalvar, ..._rdoEquipe.filter(eqFica), ..._rdoAbast.filter(abFica)]){
    if(!l.id) l.id = novoIdLinha();
    if(!l.id){ aviso("app-aviso", "Este navegador não gera o identificador das linhas novas. Atualize o navegador e tente de novo; nada foi gravado.", "erro"); return; }
  }
  let savedId = rdoEditId;
  let novosDoCampo = 0;
  if(rdoEditId){
    // fase 129c: confere, antes de gravar qualquer coisa, se o diário mudou depois que a ficha leu
    if(!_rdoSnap || _rdoSnap.id !== rdoEditId){ aviso("app-aviso", "Reabra o diário antes de salvar; nada foi gravado.", "erro"); return; }
    const cf = await rdoConferirMudancas(rdoEditId);
    if(cf.erro){ aviso("app-aviso", "Não foi possível conferir o diário antes de gravar (" + cf.erro + "). Nada foi gravado.", "erro"); return; }
    const naTelaEq = new Map(_rdoEquipe.filter(eqFica).filter(e => e.funcionario_id).map(e => [e.funcionario_id, e.id]));
    const dupEq = cf.novos.equipe.filter(n => n.funcionario_id && naTelaEq.has(n.funcionario_id) && naTelaEq.get(n.funcionario_id) !== n.id)
      .map(n => (_rdoFuncs.find(f => f.id === n.funcionario_id) || {}).nome || "um funcionário");
    if(cf.mudou.length || dupEq.length){
      const oque = cf.mudou.length ? `mudou depois que você abriu a ficha (${cf.mudou.join(", ")})` : `ganhou ${dupEq.join(", ")} na equipe, que também está na sua tela`;
      aviso("app-aviso", `Nada foi gravado: este diário ${oque}, pelo app do campo, pela sync ou por outra pessoa. Reabra a ficha para ver o que está gravado e refaça a alteração.`, "erro");
      if(confirm("Este diário mudou depois que você abriu a ficha. Reabrir agora?\nO que você alterou nesta tela e ainda não foi gravado se perde.")) await abrirRDO(rdoEditId);
      return;
    }
    novosDoCampo = cf.novos.exec.length + cf.novos.equipe.length + cf.novos.abast.length;
    const { error } = await sb.from("rdo").update(reg).eq("id", rdoEditId);
    if(error){
      const m = (error.message||"").toLowerCase();
      if(m.includes("duplicate"))
        aviso("app-aviso",`Já existe um diário ${$("rdo-turno")?.value === "noturno" ? "noturno" : "diurno"} desta máquina (ou sem máquina) nesta obra, data e tipo de serviço. Abra o existente pela lista, troque a máquina ou o período.`,"erro");
      else
        aviso("app-aviso","Erro ao salvar: "+error.message,"erro");
      return;
    }
    // Cada delete é checado: se um falhar, paramos ANTES de gravar as linhas para não deixar o RDO pela metade.
    // Fase 129c: execução, equipe e abastecimento perdem só as linhas que a ficha leu e não estão mais na tela
    // (`.in('id', …)` no lugar de `.eq('rdo_id', …)`); as tabelas de raiz, que só a ficha grava, continuam limpas
    // por diário (se o tipo mudou de raiz para outro, o boletim antigo não pode ficar órfão).
    const saiu = (mapa, fica) => { const ids = new Set(fica.map(x => x.id)); return [...mapa.keys()].filter(i => !ids.has(i)); };
    const saiuExec = saiu(_rdoSnap.exec, execsParaSalvar);
    // fase 93c: linha liberada para a folha fica (o banco recusaria o delete) e não é regravada
    const saiuEq = saiu(_rdoSnap.equipe, _rdoEquipe.filter(e => eqFica(e) || e.liberado_em));
    const saiuAb = saiu(_rdoSnap.abast, _rdoAbast.filter(abFica));
    const dels = [
      ...(saiuExec.length ? [["rdo_execucao_estaca", sb.from("rdo_execucao_estaca").delete().eq("rdo_id", rdoEditId).in("id", saiuExec)]] : []),
      ...(saiuEq.length ? [["rdo_equipe", sb.from("rdo_equipe").delete().eq("rdo_id", rdoEditId).in("id", saiuEq).is("liberado_em", null)]] : []),
      ...(saiuAb.length ? [["rdo_abastecimento", sb.from("rdo_abastecimento").delete().eq("rdo_id", rdoEditId).in("id", saiuAb)]] : []),
      ["rdo_raiz_solo",         sb.from("rdo_raiz_solo").delete().eq("rdo_id", rdoEditId)],
      ["rdo_raiz_justificativa",sb.from("rdo_raiz_justificativa").delete().eq("rdo_id", rdoEditId)],
      ["rdo_raiz_dados",        sb.from("rdo_raiz_dados").delete().eq("rdo_id", rdoEditId)]
    ];
    for(const [tabela, req] of dels){
      const { error: errDel } = await req;
      if(errDel){
        aviso("app-aviso",`Erro ao substituir ${tabela}: ${errDel.message}. Nada foi reinserido — reabra o RDO e tente de novo.`,"erro");
        return;
      }
    }
  } else {
    const { data: novo, error } = await sb.from("rdo").insert(reg).select("id").single();
    if(error){
      const m = (error.message||"").toLowerCase();
      if(m.includes("duplicate"))
        aviso("app-aviso",`Já existe um diário ${$("rdo-turno")?.value === "noturno" ? "noturno" : "diurno"} desta máquina (ou sem máquina) nesta obra, data e tipo de serviço. Abra o existente pela lista, troque a máquina ou o período.`,"erro");
      else if(m.includes("row-level security") && usuarioAtual?.cargo === "encarregado")   // fase 159a: encarregado só cria diário em obra em que já está
        aviso("app-aviso","Você ainda não está na equipe desta obra. Peça ao engenheiro para abrir o primeiro diário dela ou para incluir você na equipe.","erro");
      else
        aviso("app-aviso","Erro ao salvar: "+error.message,"erro");
      return;
    }
    savedId = novo.id;
    rdoEditId = savedId;
  }

  // Grava execuções (fase 129c: upsert pelo id; coluna que a ficha não mostra, como a etapa do campo, fica como está)
  let insertedExecs = null;
  if(execsParaSalvar.length){
    const temColDesv = execsParaSalvar.some(e => Object.prototype.hasOwnProperty.call(e, "desvinculo_manual"));   // lote S49 (#130)
    const insertExecs = execsParaSalvar.map(e => {
      const base = {
        id: e.id,
        rdo_id: savedId,
        estaca_id: e.estaca_id || null,
        estaca_numero: e.estaca_numero,
        estaca_numero_corrigido: e.estaca_numero_corrigido || null,   // fase 94: vínculo com nome diferente do campo
        diametro_mm: e.diametro_mm,
        profundidade_projeto: e.profundidade_projeto,
        profundidade_executada: e.profundidade_executada,
        perfuracao_de_m: numOrNull(e.perfuracao_de_m),
        perfuracao_ate_m: numOrNull(e.perfuracao_ate_m),
        perfuracao_inicio: e.perfuracao_inicio || null,
        perfuracao_fim: e.perfuracao_fim || null,
        concretagem_inicio: e.concretagem_inicio || null,
        concretagem_fim: e.concretagem_fim || null,
        torque: e.torque,
        volume_concreto_m3: e.volume_concreto_m3,
        equipamento_id: e.equipamento_id || reg.equipamento_id || null,   // fase 94: linha sem máquina herda a do diário
        maquina_codigo: e.maquina_codigo || null,
        operador_id: e.operador_id || null,
        observacoes: e.observacoes || null,
        origem_dados: e.origem_dados || "manual"
      };
      if(tipo === "estaca_raiz"){
        Object.assign(base, {
          numero_boletim_fisico:    e.numero_boletim_fisico    || null,
          inclinacao:               e.inclinacao               || null,
          abastecimento_tipo:       e.abastecimento_tipo       || null,
          abastecimento_quantidade: e.abastecimento_quantidade || null,
          consumo_cimento_raiz:     e.consumo_cimento_raiz     || null,
          consumo_cimento_unidade:  e.consumo_cimento_unidade  || null,
          consumo_areia_raiz:       e.consumo_areia_raiz       || null,
          consumo_areia_unidade:    e.consumo_areia_unidade    || null,
          pressao_injecao_kgcm2:    numOrNull(e.pressao_injecao_kgcm2),
          identificacao_acessorios: e.identificacao_acessorios || null,
          ...rdoCamposInjecao(e)   // fase 101 (#99): m³ injetado e água
        });
      }
      // lote S49 (#130): regravar o RDO não religa pelo nome a execução desvinculada à mão. A coluna só vem do banco
      // depois da migration 20261022_loteS49_vincular_estacas; o insert em lote manda a mesma chave em todas as linhas
      // (chave ausente vira null e a coluna é not null), então só entra quando alguma linha lida do banco a trouxe.
      if(temColDesv) base.desvinculo_manual = e.desvinculo_manual === true && !e.estaca_id;
      return base;
    });
    const { error: errExec } = await sb.from("rdo_execucao_estaca").upsert(insertExecs, { onConflict: "id" });
    if(errExec){ aviso("app-aviso","Erro ao salvar execuções: "+errExec.message,"erro"); return; }
    insertedExecs = insertExecs.map(x => ({ id: x.id }));   // mesma ordem de execsParaSalvar

    // Raiz: insere solo/just por execucao_id
    if(tipo === "estaca_raiz" && insertedExecs){
      const solosAll = [], justsAll = [];
      execsParaSalvar.forEach((e, i) => {
        const execId = insertedExecs[i]?.id;
        if(!execId) return;
        (e._solo || []).filter(s => s.inicio_ml!=null || s.final_ml!=null || s.classificacao)
          .forEach((s, si) => solosAll.push({
            execucao_id: execId, rdo_id: savedId,
            inicio_ml: s.inicio_ml, final_ml: s.final_ml,
            classificacao: s.classificacao || null, ferramenta: s.ferramenta || null, ordem: si + 1
          }));
        (e._just || []).filter(j => j.h_inicial || j.h_final || j.motivo)
          .forEach((j, ji) => justsAll.push({
            execucao_id: execId, rdo_id: savedId,
            h_inicial: j.h_inicial || null, h_final: j.h_final || null,
            motivo: j.motivo || null, ordem: ji + 1
          }));
      });
      if(solosAll.length){
        const { error: errSolo } = await sb.from("rdo_raiz_solo").insert(solosAll);
        if(errSolo){ aviso("app-aviso","Erro ao salvar solo: "+errSolo.message,"erro"); return; }
      }
      if(justsAll.length){
        const { error: errJust } = await sb.from("rdo_raiz_justificativa").insert(justsAll);
        if(errJust){ aviso("app-aviso","Erro ao salvar justificativas: "+errJust.message,"erro"); return; }
      }
    }
  }

  // Chamado #5: atividades hora a hora do dia (todos os tipos de RDO; execucao_id nulo).
  // O delete de rdo_raiz_justificativa por rdo_id acima removeu as antigas: reinsere a lista da tela.
  const ativLimpa = _rdoAtividades
    .filter(a => a.h_inicial || a.h_final || a.motivo)
    .map((a, i) => ({ rdo_id: savedId, execucao_id: null, ordem: i + 1,
      h_inicial: a.h_inicial || null, h_final: a.h_final || null, motivo: a.motivo || null }));
  if(ativLimpa.length){
    const { error: errAtiv } = await sb.from("rdo_raiz_justificativa").insert(ativLimpa);
    if(errAtiv){ aviso("app-aviso","Erro ao salvar as atividades do dia: "+errAtiv.message,"erro"); return; }
  }

  // Fase 103: o que o status do dia não admite sai antes de gravar (o gatilho do banco faz o mesmo)
  // lote S54 (#178): com o dia e o feriado do diário (treinamento em fim de semana ou feriado mantém a HE)
  _rdoEquipe.forEach(e => { if(!e.liberado_em) rdoAplicarStatusDia(e, dataRDO, reg.feriado); });
  // Lote S40 (#31): ao salvar, calcula a HE das linhas com entrada e saída e HE ainda vazia
  // (fase 103: menos treinamento e viagem, que não têm HE; lote S54: treinamento só em dia útil não feriado)
  const precisaHE = (e) => e.hora_entrada && e.hora_saida && e.horas_100 == null && !rdoSemHE(rdoStatusDia(e.status_dia), dataRDO, reg.feriado);
  if(_rdoEquipe.some(precisaHE)){
    if(!_rdoObraParams) await carregarParamsObraRDO(obra_id);
    const jornada = jornadaEfetiva(_rdoObraParams, reg.turno_campo);   // fase 155b: jornada do período do diário
    _rdoEquipe.forEach(e => {
      if(!precisaHE(e)) return;
      const r = calcularHorasEquipe(dataRDO, e.hora_entrada, e.hora_saida, jornada, e.intervalo_minutos, reg.feriado);
      if(r){ e.horas_100 = r.horas_100 || null; e.horas_50 = null; }
    });
  }
  // Insere equipe do dia (genérico, todos os tipos de RDO). Fase 93c: linha já liberada para a folha não é
  // reinserida (ficou no banco); noturnas vão só quando corrigidas à mão, senão o gatilho calcula (22h–5h)
  // fase 129c: upsert pelo id; status_dia vai sempre (nulo = presente), porque no update a chave ausente manteria o antigo.
  // Colunas que só o campo grava (chegada real) ficam como estão.
  // Hotfix das horas normais: horas_normais vai sempre nulo. A ficha não mostra nem edita essa coluna; sem a chave, o upsert
  // mantinha a hora gravada antes (gatilho, app ou Falta) e o gatilho não recalcula coluna preenchida, então corrigir o
  // horário ou o status deixava a hora antiga para a folha. Nulo = como era antes da 129c (a linha nascia de novo): o gatilho
  // recalcula quando a HE está vazia, e com HE digitada a folha calcula as normais na leitura (vw_rh_horas_mes).
  const eqLimpa = _rdoEquipe
    .filter(eqFica)
    .map((e,i) => ({
      id:             e.id,
      rdo_id:         savedId,
      funcionario_id: e.funcionario_id || null,
      nome_avulso:    e.nome_avulso || null,
      funcao_no_dia:  e.funcao_no_dia || null,
      hora_entrada:   e.hora_entrada || null,
      hora_saida:     e.hora_saida || null,
      intervalo_minutos: e.intervalo_minutos ?? null,
      horas_normais:  null,
      horas_50:       e.horas_50 || null,
      horas_100:      e.horas_100 || null,
      horas_noturnas: e.horas_noturnas_manual ? (e.horas_noturnas ?? 0) : (e.hora_entrada && e.hora_saida ? null : (e.horas_noturnas ?? null)),
      horas_noturnas_manual: !!e.horas_noturnas_manual,
      observacoes:    e.observacoes || null,
      ordem:          i + 1,
      status_dia:     rdoStatusDia(e.status_dia) ? e.status_dia : null
    }));
  if(eqLimpa.length){
    const { error: errEq } = await sb.from("rdo_equipe").upsert(eqLimpa, { onConflict: "id" });
    if(errEq){ aviso("app-aviso","Erro ao salvar equipe: "+errEq.message,"erro"); return; }
  }
  // Abastecimento do dia (fase 46; fase 129c: upsert pelo id, a origem do diesel informada no campo fica)
  const abLimpo = _rdoAbast
    .filter(abFica)
    .map((a, i) => ({ id: a.id, rdo_id: savedId, equipamento_id: a.equipamento_id || null, maquina_codigo: a.maquina_codigo || null,
      combustivel: a.combustivel || "diesel", quantidade: a.quantidade ?? null, unidade: "L", horimetro: a.horimetro ?? null,
      observacao: a.observacao || null, ordem: i + 1 }));
  if(abLimpo.length){
    const { error: errAb } = await sb.from("rdo_abastecimento").upsert(abLimpo, { onConflict: "id" });
    if(errAb){ aviso("app-aviso","Erro ao salvar abastecimento: "+errAb.message,"erro"); return; }
  }

  // Insere cabeçalho do dia (Raiz)
  let rdoRaizErro = null;   // fase 142 (EST-04): falha aqui não pode virar "salvo com sucesso"
  if(tipo === "estaca_raiz"){
    const folha   = $("rdo-raiz-folha")?.value.trim()   || null;
    const projeto = $("rdo-raiz-projeto")?.value.trim() || null;
    const local   = $("rdo-raiz-local")?.value.trim()   || null;
    const bloco   = $("rdo-raiz-bloco")?.value.trim()   || null;
    if(folha || projeto || local || bloco){
      ({ error: rdoRaizErro } = await sb.from("rdo_raiz_dados").insert({
        rdo_id: savedId, folha, projeto, local_obra: local, bloco
      }));
    }
    // solo/just já inseridos por execucao_id na seção acima
  }

  $("btn-excluir-rdo").style.display = "";
  $("rdo-status").value = reg.status;
  if(rdoRaizErro) aviso("app-aviso", "RDO salvo, mas os dados da raiz não foram gravados: " + rdoRaizErro.message, "erro");
  else aviso("app-aviso", novosDoCampo
    ? `RDO salvo. ${novosDoCampo} linha(s) gravada(s) pelo campo ou pela sync depois que você abriu a ficha continuam no diário: confira.`
    : "RDO salvo com sucesso.", "ok");
  await carregarRDO();
  await abrirRDO(savedId);
}

/* fase 129c: cópia do que a ficha leu (texto por id) e a conferência antes de gravar */
function rdoSnapshot(id, cab, execs, equipe, abast){
  const mapa = (l) => new Map((l || []).map(x => [x.id, JSON.stringify(x)]));
  return { id, cab: JSON.stringify(RDO_CAB_CONFERE.map(k => cab?.[k] ?? null)), exec: mapa(execs), equipe: mapa(equipe), abast: mapa(abast) };
}
async function rdoConferirMudancas(id){
  const [cab, ex, eq, ab] = await Promise.all([
    sb.from("rdo").select(RDO_CAB_CONFERE.join(",")).eq("id", id).single(),
    sb.from("rdo_execucao_estaca").select("*").eq("rdo_id", id),
    sb.from("rdo_equipe").select("*").eq("rdo_id", id),
    sb.from("rdo_abastecimento").select("*").eq("rdo_id", id)]);
  const falha = cab.error || ex.error || eq.error || ab.error;
  if(falha) return { erro: falha.message };
  const mudou = [], novos = { exec: [], equipe: [], abast: [] };
  if(JSON.stringify(RDO_CAB_CONFERE.map(k => cab.data?.[k] ?? null)) !== _rdoSnap.cab) mudou.push("cabeçalho");
  [["exec", "execução de estaca", ex.data], ["equipe", "equipe", eq.data], ["abast", "abastecimento", ab.data]].forEach(([k, rot, linhas]) => {
    const vistos = new Set();
    (linhas || []).forEach(r => {
      vistos.add(r.id);
      const antes = _rdoSnap[k].get(r.id);
      if(antes === undefined) novos[k].push(r);
      else if(antes !== JSON.stringify(r)) mudou.push(rot + " alterada");
    });
    _rdoSnap[k].forEach((_, i) => { if(!vistos.has(i)) mudou.push(rot + " apagada"); });
  });
  return { mudou: [...new Set(mudou)], novos };
}

/* fase 94 (#77): chip da máquina do diário, aviso de "sem máquina" e botão "Dividir por máquina" */
/* fase 134b: etiqueta do diário noturno nas listas (período nulo = diurno, sem etiqueta) */
function rdoTagTurno(r){
  return r && r.turno_campo === "noturno" ? ' <span class="tag azul" title="Diário do período noturno (fase 134b): a mesma máquina pode ter o diurno no mesmo dia">Noturno</span>' : "";
}
/* fase 161: data da lista como "17 set · qui" (o ano aparece quando não é o corrente). Sem o js/rdo_resumo.js, dd/mm/aaaa. */
function rdoCelulaData(iso){
  if(typeof rdoDataCurta !== "function") return dataBR(iso);
  const ano = String(iso || "").slice(0, 4), corrente = String(hojeISO()).slice(0, 4);
  const [dia, sem] = rdoDataCurta(iso).split(" · ");
  return `<span class="rdo-data-curta">${esc(dia)}${ano && ano !== corrente ? " " + esc(ano) : ""}${sem ? ` <span class="meta">· ${esc(sem)}</span>` : ""}</span>`;
}
function rdoCelulaMaquina(r){
  return r.equipamento_id
    ? esc(r.maquina || (_rdoEquipsCache.find(q => q.id === r.equipamento_id) || {}).codigo || "?")
    : '<span class="tag ambar" title="Diário sem máquina: abra e informe a máquina no cabeçalho (entra em Para regularizar)">sem máquina</span>';
}
function rdoAtualizarChipMaquina(eqId){
  const chip = $("rdo-ficha-maquina-chip");
  if(chip){
    const q = eqId ? _rdoEquipsCache.find(x => x.id === eqId) : null;
    chip.classList.toggle("chip-aviso", !eqId);
    chip.querySelector("strong").textContent = q ? `${q.codigo}${q.nome ? " — " + q.nome : ""}` : (eqId ? "máquina inativa" : "sem máquina · informe no cabeçalho");
  }
  const av = $("rdo-equipamento-aviso");
  if(av) av.textContent = eqId ? "" : _rdoObraExige
    ? "Esta obra exige a máquina do diário: sem ela o RDO não é salvo."   // fase 101 (#85)
    : "Diário sem máquina entra em \"Para regularizar\" do responsável da obra até alguém informar.";
  const maqs = new Set(_rdoExecucoes.map(e => e.equipamento_id).filter(Boolean));
  const b = $("btn-rdo-dividir");
  if(b) b.style.display = rdoEditId && maqs.size > 1 && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()) ? "" : "none";
}
async function rdoDividirPorMaquina(){
  if(!rdoEditId) return;
  const maqs = [...new Set(_rdoExecucoes.map(e => e.equipamento_id).filter(Boolean))]
    .map(id => (_rdoEquipsCache.find(q => q.id === id) || {}).codigo || "?");
  if(maqs.length < 2){ aviso("app-aviso", "Este diário tem execuções de uma máquina só.", "erro"); return; }
  if(!confirm(`Dividir este diário em um por máquina (${maqs.join(", ")})?\nAs execuções de cada máquina vão para o diário dela; equipe, abastecimento, observações e atividades ficam no diário da máquina principal. Alterações não salvas desta tela são perdidas.`)) return;
  const { data, error } = await sb.rpc("rdo_dividir_por_maquina", { p_rdo: rdoEditId });
  if(error){ aviso("app-aviso", "Não foi possível dividir: " + error.message, "erro"); return; }
  aviso("app-aviso", `${Number(data) || 0} diário(s) criado(s). Abra cada um pela lista para conferir.`, "ok");
  await carregarRDO();
  await abrirRDO(rdoEditId);
}

async function excluirRDO(){
  if(!rdoEditId) return;
  if(!confirm("Excluir este RDO? Esta ação não pode ser desfeita.")) return;
  const { error } = await sb.from("rdo").delete().eq("id", rdoEditId);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  aviso("app-aviso","RDO excluído.","ok");
  await carregarRDO();
  mostrarPainelRDO();
}

/* ---------- Listeners ---------- */
function ligarRDO(){
  document.querySelectorAll("#rdo-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#rdo-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _rdoView = b.dataset.view;
      renderRDO();
    });
  });
  ["rdo-busca","rdo-f-obra","rdo-f-status","rdo-f-tipo","rdo-f-maquina"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "rdo-busca" ? "input" : "change", renderRDO);
  });
  $("rdo-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(!tr) return;
    // Card agregado do kanban: clica e filtra pra lista da obra+tipo
    if(tr.classList.contains("rdo-obra-grupo")){
      const obraId = tr.dataset.obraId || "";
      const tipo   = tr.dataset.tipo || "";
      // Aplica filtros + volta pra visão Lista
      $("rdo-f-obra").value = obraId;
      $("rdo-f-tipo").value = tipo;
      $("rdo-busca").value = "";
      document.querySelectorAll("#rdo-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      const btnLista = document.querySelector('#rdo-painel .serv-view-btn[data-view="lista"]');
      if(btnLista) btnLista.classList.add("ativo");
      _rdoView = "lista";
      renderRDO();
      return;
    }
    if(tr.dataset.id) abrirRDO(tr.dataset.id);
  });

  $("btn-novo-rdo")?.addEventListener("click", novoRDO);
  $("btn-voltar-rdo")?.addEventListener("click", mostrarPainelRDO);
  document.querySelectorAll(".sidebar-nav button[data-secao]").forEach(b => b.addEventListener("click", () => { _rdoVoltarPara = null; })); // chamado #8: navegação manual esquece a obra de origem
  $("btn-salvar-rdo")?.addEventListener("click", () => comBotaoTravado("btn-salvar-rdo", () => salvarRDO()));
  $("btn-finalizar-rdo")?.addEventListener("click", () => comBotaoTravado("btn-finalizar-rdo", () => salvarRDO("finalizado")));
  $("btn-excluir-rdo")?.addEventListener("click", excluirRDO);
  $("btn-rdo-devolver")?.addEventListener("click", () => comBotaoTravado("btn-rdo-devolver", rdoDevolverCampo));   // fase 129c
  $("btn-rdo-relogio-ok")?.addEventListener("click", (ev) => rdoRelogioConferido(ev.currentTarget.dataset.id));
  $("btn-add-execucao")?.addEventListener("click", adicionarExecucao);
  $("btn-add-raiz-solo")?.addEventListener("click", adicionarRaizSolo);
  $("btn-add-rdo-atividade")?.addEventListener("click", adicionarRdoAtividade);
  $("btn-add-rdo-equipe")?.addEventListener("click", adicionarRdoEquipe);
  $("btn-add-rdo-abast")?.addEventListener("click", adicionarRdoAbast);
  $("btn-rdo-equipe-do-time")?.addEventListener("click", importarEquipeCadastrada);
  $("btn-rdo-aplicar-op")?.addEventListener("click", aplicarOperadorEmMassa);
  $("btn-rdo-calc-concreto")?.addEventListener("click", calcularConcretoExecucoes);
  $("rdo-obra")?.addEventListener("change", () => carregarParamsObraRDO($("rdo-obra").value));
  $("rdo-equipamento")?.addEventListener("change", () => rdoAtualizarChipMaquina($("rdo-equipamento").value || null));   // fase 94
  // lote S54 (#178): a data e o feriado decidem se o treinamento tem HE; a equipe é redesenhada
  $("rdo-data")?.addEventListener("change", renderRdoEquipe);
  $("rdo-feriado")?.addEventListener("change", renderRdoEquipe);
  // fase 155b: o período escolhe a jornada (diurna ou noturna) da HE
  $("rdo-turno")?.addEventListener("change", () => { atualizarChipJornadaRDO($("rdo-obra")?.value || null); renderRdoEquipe(); });
  $("rdo-ficha-jornada-link")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    const id = $("rdo-ficha-jornada-chip")?.dataset.obraId || $("rdo-obra")?.value;
    if(id && typeof dashAbrirObra === "function") dashAbrirObra(id, "parametros");
  });

  $("rdo-tipo-servico")?.addEventListener("change", (e) => {
    atualizarVisibilidadeAbasRaiz(e.target.value);
    renderExecucoes();
  });

  document.querySelectorAll("#rdo-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabRDO(b.dataset.tab));
  });
  document.querySelectorAll("#rdo-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!rdoEditId){
        $("rdo-status").value = novo;
        atualizarStatusbarRDO(novo);
        return;
      }
      if(novo === $("rdo-status").value) return;
      await salvarRDO(novo);
    });
  });


  const navRDO = document.querySelector('nav button[data-secao="rdo"]');
  if(navRDO) navRDO.addEventListener("click", mostrarPainelRDO);

  // Event delegation — não depende de timing entre JS e DOM
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if(!t || !t.id) return;
    switch(t.id){
      case "btn-importar-csv-painel":
      case "btn-importar-csv":
        abrirModalImportCSV();
        break;
      case "btn-fechar-csv":
        fecharModalImportCSV();
        break;
      case "btn-csv-processar":
        processarCSV();
        break;
      case "btn-csv-confirmar":
        confirmarImportCSV();
        break;
      case "btn-rdo-pedir-material":   // fase 83
        if(typeof abrirPedidoMaterial === "function") abrirPedidoMaterial({ obra_id: $("rdo-obra")?.value || null });
        break;
      case "btn-rdo-dividir":   // fase 94 (#77)
        rdoDividirPorMaquina();
        break;
      case "btn-rdo-anterior":
        navegarRDO("anterior");
        break;
      case "btn-rdo-proximo":
        navegarRDO("proximo");
        break;
    }
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarRDO);
} else {
  ligarRDO();
}

/* ====================================================================
   IMPORTAÇÃO CSV (Geodigitus) — auto-identifica obra e tipo
   ==================================================================== */

let _csvParsed = null;
let _csvObraDetectada = null;     // { id, nome, casamento: "exato"|"parcial"|null }
let _csvTipoDetectado = null;     // tipo_servico inferido pelos campos
let _csvMaquinasSemMatch = [];    // ["HC-66", ...] sem equipamento_id
let _csvMapaManual = {};          // { "HC-66": equipamento_id } resolvidos manualmente
let _csvSalvarMapeamento = {};    // { "HC-66": true } user quer salvar permanente
/* fase 101 (#85): no import por IA a máquina nunca vincula sozinha. Só o código (ou código externo / nome) idêntico ao
   cadastro casa direto; "TAG 99", "Máquina 107", "HC-66" viram SUGESTÃO no bloco de máquinas da prévia (eqCasarTexto, exata
   ou mais próxima, as máquinas da obra primeiro) e a pessoa confirma com "usar". CSV, SoftSaci e Maya seguem o lote S42. */
let _csvMaqEstrito = false;
let _csvMaqObraIds = [];          // máquinas da obra (vw_obra_equipamentos) para ordenar e sugerir
function rdoCasarMaquinaEstrito(texto){
  const t = String(texto || "").trim().toUpperCase().replace(/\s+/g, ""); if(!t) return null;
  return _rdoEquipsCache.find(e => [e.codigo_externo, e.codigo, e.nome].filter(Boolean).some(c => String(c).toUpperCase().replace(/\s+/g, "") === t)) || null;
}
function rdoCasarMaquinaImport(texto){ return _csvMaqEstrito ? rdoCasarMaquinaEstrito(texto) : rdoCasarMaquina(texto); }
async function rdoCarregarMaqObraImport(obraId){
  _csvMaqObraIds = [];
  if(!obraId) return _csvMaqObraIds;
  const { data, error } = await sb.from("vw_obra_equipamentos").select("equipamento_id").eq("obra_id", obraId);
  if(!error) _csvMaqObraIds = [...new Set((data || []).map(x => x.equipamento_id))];
  return _csvMaqObraIds;
}
// <option>s com as máquinas da obra primeiro (optgroup) e as demais depois
function rdoOptsMaquinas(idsObra, selecionado){
  const obra = new Set(idsObra || []);
  const opt = (e) => `<option value="${esc(e.id)}"${e.id === selecionado ? " selected" : ""}>${esc(e.codigo)}${e.nome ? " — " + esc(e.nome) : ""}</option>`;
  const daObra = _rdoEquipsCache.filter(e => obra.has(e.id)), outras = _rdoEquipsCache.filter(e => !obra.has(e.id));
  return daObra.length ? `<optgroup label="Máquinas da obra">${daObra.map(opt).join("")}</optgroup><optgroup label="Demais máquinas">${outras.map(opt).join("")}</optgroup>` : outras.map(opt).join("");
}

function abrirModalImportCSV(){
  // Pode ser chamado tanto da ficha quanto do painel — não exige obra prévia
  $("csv-arquivo").value = "";
  $("csv-preview").style.display = "none";
  $("csv-preview-conteudo").innerHTML = "";
  _csvParsed = null;
  _csvObraDetectada = null;
  _csvTipoDetectado = null;
  _iaExtras = null; _iaOrigem = null;
  _csvMaqSugerida = null;   // fase 94
  $("csv-modal").style.display = "flex";
}

function fecharModalImportCSV(){
  $("csv-modal").style.display = "none";
}

/* Match de obra pelo nome do CSV contra tabela obras */
function detectarObraPeloNome(nomeCSV){
  if(!nomeCSV) return null;
  const alvo = nomeCSV.trim().toLowerCase();
  const obrasArr = Object.entries(mapaObras).map(([id, nome]) => ({ id, nome }));
  // 1. casamento exato (case-insensitive)
  let achada = obrasArr.find(o => (o.nome || "").toLowerCase() === alvo);
  if(achada) return { ...achada, casamento: "exato" };
  // 2. casamento parcial — alvo contém ou está contido no nome cadastrado
  achada = obrasArr.find(o => {
    const n = (o.nome || "").toLowerCase();
    return n.includes(alvo) || alvo.includes(n);
  });
  if(achada) return { ...achada, casamento: "parcial" };
  // 3. casamento por palavras-chave (50%+ das palavras do CSV aparecem no nome)
  const palavrasCSV = alvo.split(/[\s\-_/]+/).filter(p => p.length >= 3);
  if(palavrasCSV.length){
    let melhor = null, melhorScore = 0;
    obrasArr.forEach(o => {
      const n = (o.nome || "").toLowerCase();
      const hits = palavrasCSV.filter(p => n.includes(p)).length;
      const score = hits / palavrasCSV.length;
      if(score > melhorScore && score >= 0.5){
        melhorScore = score;
        melhor = o;
      }
    });
    if(melhor) return { ...melhor, casamento: "parcial" };
  }
  return null;
}

/* Normaliza o nome da estaca pra um formato canônico
   - UPPER + trim
   - Remove espaços duplos
   - NÃO mexe no BB: BB12 e B12 são estacas distintas (confirmado em 2026-05-26).
   - NÃO força inserir ponto (B66 fica B66 — caso ambíguo, vai pra reconciliação)
*/
function normalizarNumeroEstaca(s){
  if(!s) return "";
  return s.toUpperCase().trim().replace(/\s+/g, " ");
}

/* Detecta REFURO: nomes terminados com R (ex: B12R, BB6.1R).
   Retorna { nomeBase, isRefuro } onde nomeBase é sem o R (vincula à estaca pai).
   Cuidado pra não pegar nomes que naturalmente terminam em R (raros — alertar se ambíguo). */
function detectarRefuro(nome){
  const n = (nome||"").trim().toUpperCase();
  if(/[0-9.]R$/.test(n)){
    return { nomeBase: n.replace(/R$/, ""), isRefuro: true };
  }
  return { nomeBase: n, isRefuro: false };
}

/* Detecta tipo de serviço pelos campos presentes na primeira linha */
function detectarTipoServico(registros){
  if(!registros.length) return "helice_continua";
  const r = registros[0];
  const temConcretagem = !!(r.concretagem_inicio || r.concretagem_fim);
  const temTorque = r.torque != null;
  const temPerfuracao = !!(r.perfuracao_inicio || r.perfuracao_fim);
  // Hélice tem concretagem + torque
  if(temConcretagem && temTorque) return "helice_continua";
  // Sem concretagem mas com torque/perfuração = trado
  if(temPerfuracao && !temConcretagem) return "trado_mecanizado";
  // Default
  return "helice_continua";
}

function parseDataBR(s){
  // "2026-05-22 10:55:00" → ISO
  if(!s) return null;
  s = s.replace(/^"|"$/g, "").trim();
  if(!s) return null;
  return s.replace(" ", "T");
}

function parseNum(s){
  if(!s) return null;
  s = String(s).replace(/^"|"$/g, "").replace(",", ".").trim();
  if(!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/* Detecta o formato do arquivo importado pelo conteúdo
   Retorna: "geodigitus" (CSV ;), "softsaci" (TXT colunas fixas) ou null */
function detectarFormatoArquivo(text){
  const head = text.slice(0, 1000);
  if(/SoftSaci/i.test(head) && /Relat.rio de Estacas/i.test(head)) return "softsaci";
  if(/^DATA;.*ESTACA/im.test(head)) return "geodigitus";
  // fallback: se tem ; nas primeiras linhas é Geodigitus, senão SoftSaci
  return head.includes(";") ? "geodigitus" : "softsaci";
}

/* Parser do relatório SoftSaci (TXT com colunas alinhadas por espaços).
   Cabeçalho típico: "Contrato Obra Estaca Data Ini.P Ini.C Fim C Diam Comp V.Conc Supercon Incli"
   Retorna array no MESMO formato dos registros do Geodigitus pra reusar o resto do pipeline. */
function parseSoftSaci(text){
  const linhas = text.split(/\r?\n/);
  // Regex que captura as 12 colunas conhecidas
  const re = /^(\S+)\s+(\S+)\s+(\S+)\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+(.+)$/;
  const registros = [];
  let contrato = "", obraTxt = "";
  for(const linha of linhas){
    if(!linha.trim()) continue;
    if(/^-{5,}/.test(linha)) continue;       // separadores ----
    if(/^Pag:|Emiss.o:|SoftSaci|Construtora|Cliente|Quantidade de estacas|Contrato\s+Obra\s+Estaca/i.test(linha)) continue;
    const m = linha.match(re);
    if(!m) continue;
    contrato = m[1];
    obraTxt = m[2];
    const estaca = m[3];
    const [dd, mm, yy] = m[4].split("/");
    const ano = "20" + yy; // assume séc XXI
    const dataDia = `${ano}-${mm}-${dd}`;
    const iniP = m[5];     // perfuração início
    const iniC = m[6];     // concretagem início
    const fimC = m[7];     // concretagem fim
    const diametroM = parseNum(m[8]);       // está em metros
    const comp     = parseNum(m[9]);
    const volConc  = parseNum(m[10]);
    // supercon (m[11]) e inclinação (m[12]) viram observação enriquecida
    const observ = `Sobreconsumo: ${m[11]}% · Inclinação (X;Y): ${m[12].trim()}`;
    const refInfo = detectarRefuro(normalizarNumeroEstaca(estaca));
    registros.push({
      data_dia: dataDia,
      obra_csv: obraTxt,
      contrato_csv: contrato,
      estaca_numero: refInfo.nomeBase,
      modalidade_execucao: refInfo.isRefuro ? "refuro" : "furo_normal",
      profundidade_executada: comp,
      profundidade_projeto: null,
      perfuracao_inicio:  `${dataDia}T${iniP}:00`,
      perfuracao_fim:     `${dataDia}T${iniC}:00`,
      concretagem_inicio: `${dataDia}T${iniC}:00`,
      concretagem_fim:    `${dataDia}T${fimC}:00`,
      torque: null,                          // SoftSaci não traz torque
      volume_concreto_m3: volConc,
      diametro_mm: diametroM != null ? Math.round(diametroM * 1000) : null,  // m → mm
      maquina_codigo: "",                    // SoftSaci não traz máquina
      equipamento_id: null,
      observacoes: observ
    });
  }
  return { registros, obraTxt, contrato };
}

async function processarCSV(){
  const inp = $("csv-arquivo");
  if($("csv-aviso")){ $("csv-aviso").textContent = ""; $("csv-aviso").className = "aviso"; }
  if(!inp.files || !inp.files[0]){ aviso("app-aviso","Selecione um arquivo.","erro"); if($("csv-aviso")) aviso("csv-aviso","Selecione um arquivo (PDF, foto, XLSX do Maya ou RG 11.3 da raiz, CSV ou TXT).","erro"); return; }
  const file = inp.files[0];
  const mediaIA = _ehArquivoIA(file);
  if(mediaIA){ await processarArquivoIA(file, mediaIA); return; }
  if(typeof _ehArquivoXlsx === "function" && _ehArquivoXlsx(file)){
    // lote S57 (#220): a planilha RG 11.3 da estaca raiz (aba SEPARADOS) tem leitor próprio; o resto segue para o Maya
    if(typeof processarArquivoXlsxRG113 === "function" && await processarArquivoXlsxRG113(file)) return;
    await processarArquivoXlsxMaya(file); return; // Relatório Diário do Maya (.xlsx)
  }
  _iaExtras = null; _iaOrigem = null;
  const text = await file.text();
  const formato = detectarFormatoArquivo(text);

  let registros, obraTxtFonte;
  if(formato === "softsaci"){
    const parsed = parseSoftSaci(text);
    if(!parsed.registros.length){
      aviso("app-aviso","Arquivo SoftSaci sem linhas de estacas reconhecidas.","erro");
      return;
    }
    registros = parsed.registros;
    obraTxtFonte = parsed.obraTxt;
  } else {
    // === Pipeline Geodigitus (CSV) ===
    const linhas = text.split(/\r?\n/).filter(l => l.trim());
    if(linhas.length < 2){ aviso("app-aviso","CSV vazio.","erro"); return; }
    registros = parseCsvGeodigitus(linhas);
    obraTxtFonte = registros[0]?.obra_csv || "";
    if(!registros){ return; }
  }

  _csvMaqEstrito = false;   // fase 101: CSV e SoftSaci continuam casando apelidos sozinhos (lote S42)
  await continuarProcessamentoImport(registros, obraTxtFonte, formato);
}

/* ====================================================================
   IMPORTAÇÃO POR IA — PDF digital ou foto/scan de diário feito à mão.
   A Edge Function extrair-rdo-arquivo devolve dias → cabeçalho, equipe e
   estacas. Aqui convertemos para o MESMO formato de registros do Geodigitus
   (reaproveita detecção de obra/tipo/máquinas e a gravação) e mostramos uma
   tabela de conferência editável: a pessoa confere/corrige e só então grava.
   ==================================================================== */
let _iaExtras = null;   // { [data_dia]: { tempo_manha, tempo_tarde, responsavel, atividades, observacoes, equipe:[...] } }
let _iaOrigem = null;   // "ia_pdf" | "ia_foto"

function _ehArquivoIA(file){
  const t = (file.type || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if(t === "application/pdf" || ext === "pdf") return "application/pdf";
  if(t.startsWith("image/") || ["jpg","jpeg","png","webp","gif"].includes(ext)){
    return t.startsWith("image/") ? t : ({ jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png", webp:"image/webp", gif:"image/gif" })[ext];
  }
  return null;
}

// Foto de celular vem com 4–12 MB; reduz para no máx. 2200 px (JPEG 85%) antes de enviar
function _imagemParaBase64Reduzida(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 2200;
      const fator = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * fator), h = Math.round(img.height * fator);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const dataUrl = cv.toDataURL("image/jpeg", 0.85);
      resolve({ base64: dataUrl.split(",")[1], media_type: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível abrir a imagem (formato não suportado pelo navegador — use JPG ou PNG).")); };
    img.src = url;
  });
}
function _pdfParaBase64(file){
  return new Promise((resolve, reject) => {
    if(file.size > 20 * 1024 * 1024){ reject(new Error("PDF acima de 20 MB. Envie só as páginas do diário.")); return; }
    const fr = new FileReader();
    fr.onload = () => resolve({ base64: String(fr.result).split(",")[1], media_type: "application/pdf" });
    fr.onerror = () => reject(new Error("Não foi possível ler o PDF."));
    fr.readAsDataURL(file);
  });
}

async function processarArquivoIA(file, mediaType){
  const btn = $("btn-csv-processar");
  const txtBtn = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "Lendo o diário…"; }
  try {
    const arq = mediaType === "application/pdf" ? await _pdfParaBase64(file) : await _imagemParaBase64Reduzida(file);
    _iaOrigem = mediaType === "application/pdf" ? "ia_pdf" : "ia_foto";

    // Contexto: obra escolhida na ficha (se houver), estacas cadastradas nela e TAGs das máquinas
    const obraSel = $("rdo-obra")?.value || null;
    const contexto = { maquinas: _rdoEquipsCache.map(e => e.codigo).filter(Boolean) };
    if(obraSel){
      contexto.obra_nome = mapaObras[obraSel] || null;
      contexto.tipo_servico = $("rdo-tipo-servico")?.value || null;
      const { data: ests } = await sb.from("estacas").select("numero").eq("obra_id", obraSel).limit(400);
      contexto.estacas = (ests || []).map(e => e.numero).filter(Boolean);
    }

    // lote S48 (#128): a v3.6 lê até 32.000 tokens de saída (PDF de muitos dias leva mais de 150 s): espera até 400 s,
    // o teto de parede das edge functions no plano pago do Supabase
    const { data, error } = await iaInvocarComLimite("extrair-rdo-arquivo", { arquivo_base64: arq.base64, media_type: arq.media_type, contexto },
      "A leitura demorou demais. Envie até ~6 dias do diário por vez (ou uma foto por dia) e tente de novo.", 400000);
    if(error){
      let detalhe = error.message || "";
      try {
        if(error.context && typeof error.context.json === "function"){
          const b = await error.context.json();
          if(b){ detalhe = b.error || JSON.stringify(b); if(b.sugestao) detalhe += " 💡 " + b.sugestao; }
        }
      } catch(_){ /* segue */ }
      throw new Error(detalhe || "Falha ao chamar a leitura por IA.");
    }
    if(data && data.error) throw new Error(data.error + (data.sugestao ? " 💡 " + data.sugestao : ""));
    await montarPreviewDias(data, _iaOrigem, obraSel);
    // lote S48 (#128): leitura cortada por tamanho — a prévia fica com os dias completos e o aviso diz até onde chegou
    if(data && data.parcial){
      const msgParcial = `⚠️ Leitura parcial: ${data.dias_lidos || 0} dia(s) lido(s); o resto do documento ficou de fora. ${data.sugestao || "Envie o restante separado, até ~6 dias por vez."}`;
      if($("csv-aviso")) aviso("csv-aviso", msgParcial, "aviso"); else aviso("app-aviso", msgParcial, "aviso");
    }
  } catch(err){
    const msgErro = "Leitura por IA: " + (err?.message || "falha sem mensagem");
    aviso("app-aviso", msgErro, "erro");
    if($("csv-aviso")) aviso("csv-aviso", msgErro, "erro"); // o modal cobre o aviso geral
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = txtBtn; }
  }
}

/* Dias já estruturados (contrato v3 — vindos da IA ou da planilha do Maya) → registros do pipeline
   + tabela de conferência. Lança erro quando não há o que importar (o chamador mostra o aviso). */
async function montarPreviewDias(data, origem, obraSel){
    const dias = (data && Array.isArray(data.dias)) ? data.dias : [];
    if(!dias.length){
      throw new Error("A IA não reconheceu um diário de obra neste arquivo. " + (data?.observacoes || "Tente uma foto mais nítida ou um PDF com as páginas do diário."));
    }

    // Converte para o formato de registros do pipeline (1 registro por estaca por dia)
    // lote S42 (L5): a máquina casa por rdoCasarMaquina (apelidos TAG-NN etc.); obra com uma única mobilização ativa
    // empresta a TAG principal ao dia que veio sem máquina no diário
    let maqSugerida = null;
    if(obraSel){
      const { data: mobs } = await sb.from("mobilizacoes").select("equipamento_id").eq("obra_id", obraSel).in("status", ["em_preparacao", "em_transito", "em_obra"]).not("equipamento_id", "is", null);
      if(mobs && mobs.length === 1) maqSugerida = _rdoEquipsCache.find(e => e.id === mobs[0].equipamento_id) || null;
    }
    _csvMaqSugerida = maqSugerida;   // fase 94: oferecida na prévia para as linhas que ficarem sem máquina
    // fase 101 (#85): leitura por IA só sugere a máquina (confirmação na prévia); planilha do Maya segue o lote S42
    _csvMaqEstrito = /^ia_/.test(origem || "");
    await rdoCarregarMaqObraImport(obraSel);
    const ts = (dia, hhmm) => hhmm ? `${dia}T${hhmm}:00` : null;
    const registros = [];
    _iaExtras = {};
    dias.forEach(d => {
      // v3: equipe casada com o cadastro (função vem de funcionarios.funcao), injeção por estaca,
      // responsável = operador/encarregado. Campos ausentes (função v2) degradam para vazio.
      const injecao = Array.isArray(d.injecao) ? d.injecao : [];
      const ex = {
        tempo_manha: d.tempo_manha || null, tempo_tarde: d.tempo_tarde || null,
        responsavel: d.responsavel || null, atividades: d.atividades || null, observacoes: d.observacoes || null,
        tipo_servico: d.tipo_servico || null,
        intervalo_minutos: d.intervalo_minutos ?? null, almoco_inicio: d.almoco_inicio || null, almoco_fim: d.almoco_fim || null, feriado: false,
        sem_estacas: d.sem_estacas === true, // dia só com ocorrência (planilha do Maya): vira RDO sem execuções
        abastecimentos: Array.isArray(d.abastecimentos) ? d.abastecimentos : [], // bloco Abastecimento da planilha (diário do operador)
        paradas: Array.isArray(d.paradas) ? d.paradas : [],   // fase 129c: ocorrências do Maya → tabela ocorrencias
        equipe: (Array.isArray(d.equipe) ? d.equipe : []).map(iaCasarIntegrante),
        // v3.2 (chamado #5): lista hora-a-hora da justificativa; função v3.1 não manda → []
        justificativa: (Array.isArray(d.justificativa) ? d.justificativa : [])
          .map(j => ({ h_inicial: j.h_inicial || null, h_final: j.h_final || null, motivo: (j.motivo || "").trim() || null }))
          .filter(j => j.h_inicial || j.h_final || j.motivo),
        injecao, responsavel_diario: d.responsavel || null, responsavel_sugerido_id: null,
        raiz_dados: d.raiz_dados || null,   // lote S57 (#220): local e bloco do RG 11.3 → rdo_raiz_dados
        maquina_dia: (d.equipamento_texto || d.maquina || "").trim() || null   // lote S57: máquina do dia sem estaca (só o RG 11.3 usa)
      };
      // chamado #30: rdo.responsavel_id aponta para profiles; o funcionário sugerido só pré-seleciona o nome
      // no select da conferência, e o nome escolhido vai para as observações do RDO
      ex.responsavel_sugerido_id = iaSugerirResponsavel(ex);
      // fase 134b: o RG 11.3 manda turno_campo por dia; dia noturno vira chave própria (um diário para cada período)
      ex.turno_campo = d.turno_campo === "noturno" ? "noturno" : "diurno";
      const chaveDia = rdoDiaChave(d.data, ex.turno_campo);
      _iaExtras[chaveDia] = ex;
      (d.estacas || []).forEach(e => {
        // fase 101: v3.5 manda equipamento_texto (como está no documento); v3.4 só maquina
        const maq = (e.equipamento_texto || e.maquina || d.equipamento_texto || d.maquina || "").trim();
        const ref = detectarRefuro(normalizarNumeroEstaca(e.numero || ""));
        const trechos = (Array.isArray(e.trechos) ? e.trechos : [])
          .map(t => ({ de: numOrNull(t.de), ate: numOrNull(t.ate), ferramenta: t.ferramenta || null, solo: t.solo || null }))
          .filter(t => t.de != null || t.ate != null || t.solo || t.ferramenta);
        const inj = iaInjecaoDaEstaca(injecao, ref.nomeBase, e.agrupamento);
        const maxAte = iaMaxAte(trechos);
        // hotfix 15: profundidade_executada = metros perfurados NO DIA (o que a medição soma);
        // perfuracao_ate_m = acumulado da estaca ao fim do dia (profundidade_acumulada_m da v3.3).
        // maxAte só vira metragem do dia quando os trechos não têm "de" (estaca de um dia, a partir de 0).
        const acumulada = numOrNull(e.profundidade_acumulada_m) ?? maxAte;
        registros.push({
          data_dia: chaveDia,
          turno_campo: ex.turno_campo,   // fase 134b
          obra_csv: d.obra || "",
          estaca_numero: ref.nomeBase,
          agrupamento: (e.agrupamento || "").trim() || null,
          modalidade_execucao: (e.refuro || ref.isRefuro) ? "refuro" : "furo_normal",
          profundidade_executada: numOrNull(e.profundidade_executada) ?? iaMetragemDia(trechos) ?? maxAte,
          profundidade_acumulada_m: acumulada,
          profundidade_projeto: e.profundidade_projeto,
          perfuracao_de_m: numOrNull(e.perfuracao_de_m) ?? iaMinDe(trechos),
          perfuracao_ate_m: acumulada ?? numOrNull(e.perfuracao_ate_m),
          trechos,
          inclinacao: e.inclinacao != null && String(e.inclinacao).trim() ? String(e.inclinacao).trim() : null,
          consumo_cimento_raiz: inj && inj.consumo_cimento != null ? String(inj.consumo_cimento) : null,
          consumo_areia_raiz:   inj && inj.consumo_areia   != null ? String(inj.consumo_areia)   : null,
          pressao_injecao_kgcm2: inj ? (inj.pressao_kgcm2 ?? null) : null,
          // fase 101 (#99): v3.5 lê volume injetado (m³), água (L) e a unidade da areia (padiola) quando o boletim traz
          volume_injetado_m3: inj ? numOrNull(inj.volume_injetado_m3) : null,
          agua_l: inj ? numOrNull(inj.agua_l) : null,
          consumo_areia_unidade: inj && inj.consumo_areia_unidade ? String(inj.consumo_areia_unidade) : null,
          perfuracao_inicio: ts(d.data, e.perfuracao_inicio),
          perfuracao_fim: ts(d.data, e.perfuracao_fim),
          concretagem_inicio: ts(d.data, e.concretagem_inicio),
          concretagem_fim: ts(d.data, e.concretagem_fim),
          torque: e.torque,
          volume_concreto_m3: e.volume_concreto_m3,
          diametro_mm: e.diametro_mm,
          // fase 101: no import por IA a mobilização única também é só sugestão (select "sem máquina" da prévia)
          maquina_codigo: maq || (maqSugerida && !_csvMaqEstrito ? maqSugerida.codigo : ""),
          equipamento_id: (rdoCasarMaquinaImport(maq) || (!maq && !_csvMaqEstrito ? maqSugerida : null) || {}).id || null,
          observacoes: e.observacoes || null,
          // lote S57 (#220): nº do boletim físico (coluna RDO do RG 11.3)
          numero_boletim_fisico: e.numero_boletim_fisico != null && String(e.numero_boletim_fisico).trim() ? String(e.numero_boletim_fisico).trim() : null,
          origem_dados: origem
        });
      });
    });
    // Lote S40 (#34): dia sem estaca (mobilização, chuva, manutenção, aguardando frente...) também é
    // RDO válido. Vira RDO só com cabeçalho, equipe, ocorrências e abastecimento, sem execução.
    const diasComEstaca = new Set(registros.map(r => r.data_dia));
    dias.forEach(d => { const k = rdoDiaChave(d.data, d.turno_campo); if(d.data && !diasComEstaca.has(k) && _iaExtras[k]) _iaExtras[k].sem_estacas = true; });

    await continuarProcessamentoImport(registros, dias[0].obra || "", origem);

    // Obra: se a ficha já tinha obra escolhida e a detecção não foi exata, pré-seleciona
    const selObra = $("csv-obra-select");
    if(selObra && obraSel && !selObra.value){ selObra.value = obraSel; rdoRenderSugestoesEstacas(obraSel); }   // lote S44 (L5): sugestões para a obra da ficha
    // Tipo: o que a IA leu, se veio
    const tipoIA = dias.find(d => d.tipo_servico)?.tipo_servico;
    if(tipoIA && $("csv-tipo-select")) $("csv-tipo-select").value = tipoIA;

    // Jornada da obra (horas extras da equipe) — da obra escolhida no preview
    await iaCarregarJornadaObra((selObra && selObra.value) || (_csvObraDetectada && _csvObraDetectada.id) || obraSel || null);
    // fase 173b: estaca raiz só com injeção no arquivo e sem perfuração em nenhum diário da obra (RG 11.3 e leitura por IA)
    await rdoAvisoSoInjecao(data, origem, (selObra && selObra.value) || (_csvObraDetectada && _csvObraDetectada.id) || obraSel || null);
    renderConferenciaIA(data);
    selObra?.addEventListener("change", async () => {
      await iaCarregarJornadaObra(selObra.value); iaRecalcularHorasNoDOM(false);
      await rdoAvisoSoInjecao(data, origem, selObra.value || null);
    });
}
/* fase 173b: aviso da prévia (não bloqueia). Calcula em data.aviso_so_injecao e, se a conferência já está na tela, troca o texto. */
async function rdoAvisoSoInjecao(data, origem, obraId){
  if(origem !== "xlsx_rg113" && !/^ia_/.test(origem || "")) return;
  try { data.aviso_so_injecao = await rg113AvisoSoInjecao(data.dias, obraId); }
  catch(err){ console.warn("Aviso de estaca só com injeção:", err.message); data.aviso_so_injecao = null; }
  const el = $("csv-aviso-so-injecao");
  if(el){ el.textContent = data.aviso_so_injecao ? "⚠️ " + data.aviso_so_injecao : ""; el.style.display = data.aviso_so_injecao ? "" : "none"; }
}

const CONDICAO_TEMPO_IA = { bom:"Bom", nublado:"Nublado", chuva_fraca:"Chuva fraca", chuva_forte:"Chuva forte", impraticavel:"Impraticável" };
const FUNCOES_RDO_IA = ["encarregado","operador","ajudante","sondador","motorista","soldador","apontador","tecnico","engenheiro","seguranca","terceirizado","outro"];
const FERRAMENTAS_TRECHO_IA = { revestimento:"Revestimento", martelo:"Martelo", tricone:"Tricone" };

/* ---------- Import por IA: casamento com o cadastro (fase 42) ----------
   Regras decididas em 10/09: o NOME do boletim casa com funcionarios (mesma regra do
   fn_funcionario_por_nome do banco: exato, senão prefixo único ≥ 8 caracteres); a
   FUNÇÃO exibida vem SEMPRE do cadastro (funcionarios.funcao); funcao_no_dia só quando
   o boletim diz explicitamente outra função; sem correspondência → nome_avulso + aviso.
   Responsável do dia = operador da máquina ou encarregado presente — nunca o 1º da lista. */
function normalizarNomePessoa(s){
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\(.*?\)\s*$/, "").replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}
// funcionarios.funcao (texto do RH: "Operador de Máquinas Pleno", "Encarregado de Fundações Junior"…) → enum funcao_rdo
function funcaoRdoDoCargo(funcao){
  const f = normalizarNomePessoa(funcao);
  if(!f) return null;
  if(f.includes("ENCARREGADO") || f.includes("FEITOR") || f.includes("SUPERVISOR DE OBRA")) return "encarregado";
  if(f.includes("SEGURANCA")) return "seguranca";
  if(f.includes("OPERADOR DE CAMINHAO") || f.includes("MOTORISTA")) return "motorista";
  if(f.includes("OPERADOR")) return "operador";
  if(f.includes("AJUDANTE") || f.includes("SERVENTE")) return "ajudante";
  if(f.includes("SONDADOR")) return "sondador";
  if(f.includes("SOLDADOR")) return "soldador";
  if(f.includes("APONTADOR")) return "apontador";
  if(f.includes("ENGENHEIRO")) return "engenheiro";
  if(f.includes("TECNICO")) return "tecnico";
  if(f.includes("TERCEIRIZADO") || f === "PJ") return "terceirizado";
  return "outro";
}
function casarFuncionarioPorNome(nome){
  const n = normalizarNomePessoa(nome);
  if(!n) return null;
  const norm = (f) => normalizarNomePessoa(f.nome);
  const exato = _rdoFuncs.filter(f => norm(f) === n);
  if(exato.length === 1) return exato[0];
  if(exato.length > 1) return null;
  if(n.length < 8) return null;
  const pref = _rdoFuncs.filter(f => norm(f).startsWith(n + " "));
  if(pref.length === 1) return pref[0];
  // "Marcos Vinicius Silva" no papel × "Marcos Vinicius da Silva" no cadastro: primeiro + último nome
  const partes = n.split(" ");
  if(partes.length >= 2){
    const cand = _rdoFuncs.filter(f => { const p = norm(f).split(" "); return p.length >= 2 && p[0] === partes[0] && p[p.length - 1] === partes[partes.length - 1]; });
    if(cand.length === 1) return cand[0];
  }
  return null;
}
function iaCasarIntegrante(p){
  const f = casarFuncionarioPorNome(p.nome);
  const funcaoIA = FUNCOES_RDO_IA.includes(p.funcao) ? p.funcao : null;
  const m = {
    nome: p.nome || "", funcionario_id: f ? f.id : null,
    funcao_ia: funcaoIA, funcao_no_dia: null,
    hora_entrada: p.hora_entrada || null, hora_saida: p.hora_saida || null,
    horas_normais: p.horas_normais ?? null, horas_50: p.horas_50 ?? null, horas_100: p.horas_100 ?? null,
    // lote S54 (#178): status do dia como está no boletim (function v4.0 devolve `status`; a 3.x não manda → presente)
    status_texto: typeof p.status === "string" && p.status.trim() ? p.status.trim() : null,
    status_dia: rdoStatusDiaDeTexto(p.status)
  };
  iaAplicarCadastroIntegrante(m);
  return m;
}
/* Recalcula os campos derivados do cadastro (chamado ao casar e quando a pessoa troca o funcionário) */
function iaAplicarCadastroIntegrante(m){
  const f = m.funcionario_id ? _rdoFuncs.find(x => x.id === m.funcionario_id) : null;
  m.nome_cadastro = f ? f.nome : null;
  m.funcao_cadastro = f ? (f.funcao || null) : null;
  m.funcao_cadastro_rdo = funcaoRdoDoCargo(m.funcao_cadastro);
  if(f) m.funcao_no_dia = (m.funcao_ia && m.funcao_ia !== m.funcao_cadastro_rdo) ? m.funcao_ia : null;
  else  m.funcao_no_dia = m.funcao_ia || "outro";
  return m;
}
const iaFuncaoEfetiva = (m) => m.funcao_no_dia || m.funcao_cadastro_rdo || m.funcao_ia || null;
function iaSugerirResponsavel(ex){
  const equipe = (ex.equipe || []).filter(m => m.funcionario_id);
  if(ex.responsavel){
    const f = casarFuncionarioPorNome(ex.responsavel);
    if(f) return f.id; // o boletim nomeou operador/encarregado e a pessoa existe no cadastro
  }
  const enc = equipe.find(m => iaFuncaoEfetiva(m) === "encarregado");
  if(enc) return enc.funcionario_id;
  const op = equipe.find(m => iaFuncaoEfetiva(m) === "operador");
  if(op) return op.funcionario_id;
  return null;
}
/* "BL-03", "BL 3", "Bloco 3", "BL3" → "BL3" (identidade do agrupamento para casar estaca e injeção) */
function normalizarAgrupamento(s){
  let t = String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim()
    .replace(/^BLOCO\s*/, "BL").replace(/^ANEL\s*/, "AN").replace(/^PILAR\s*/, "P");
  t = t.replace(/[^A-Z0-9]+/g, "");
  return t.replace(/(\D|^)0+(\d)/g, "$1$2");
}
function iaInjecaoDaEstaca(injecao, numero, agrupamento){
  const n = normalizarNumeroEstaca(numero || "");
  const cands = (injecao || []).filter(j => detectarRefuro(normalizarNumeroEstaca(j.estaca || "")).nomeBase === n);
  if(!cands.length) return null;
  if(cands.length === 1) return cands[0];
  const a = normalizarAgrupamento(agrupamento);
  return cands.find(j => normalizarAgrupamento(j.agrupamento) === a) || cands[0];
}
/* Dias da importação: os que têm estacas + os marcados como "só ocorrência" (planilha do Maya) */
/* fase 134b: a chave do dia na importação leva o período ("AAAA-MM-DD" = diurno, "AAAA-MM-DD@noturno" = noturno), para a
   planilha RG 11.3 com os dois períodos abrir um diário para cada um. Tudo que trata a chave como data passa por rdoDiaData. */
const rdoDiaChave = (data, turno) => turno === "noturno" ? data + "@noturno" : data;
const rdoDiaData = (chave) => String(chave || "").slice(0, 10);
const rdoDiaTurno = (chave) => String(chave || "").endsWith("@noturno") ? "noturno" : "diurno";
function diasImportacao(){
  const s = new Set(Object.keys(_csvParsed || {}));
  Object.entries(_iaExtras || {}).forEach(([d, ex]) => { if(ex && ex.sem_estacas) s.add(d); });
  return [...s].sort();
}

/* fase 94 (#77): a importação grava um diário por dia E máquina. A máquina da linha é o equipamento casado
   (código externo, TAG, apelido), o escolhido no bloco "máquinas sem cadastro" ou, para as linhas que ficarem sem,
   o select "csv-maq-sem" da prévia (pré-selecionado com a única mobilização ativa da obra). Linha sem nada vai para
   o diário sem máquina do dia, que entra em "Para regularizar". */
let _csvMaqSugerida = null;
function rdoMaqDaLinhaImport(r){
  if(r.equipamento_id) return r.equipamento_id;
  if(r.maquina_codigo && _csvMapaManual[r.maquina_codigo]) return _csvMapaManual[r.maquina_codigo];
  const sel = $("csv-maq-sem");
  return (sel && sel.value) || null;
}
// -> [{ dia, eq (uuid ou null), linhas:[registros] }], um por dia e máquina; dia só com ocorrência vira grupo sem linhas
function rdoDiariosImport(){
  const out = [];
  diasImportacao().forEach(dia => {
    const grupos = {};
    (_csvParsed[dia] || []).forEach(r => {
      const eq = rdoMaqDaLinhaImport(r);
      (grupos[eq || ""] = grupos[eq || ""] || { dia, eq, linhas: [] }).linhas.push(r);
    });
    if(!Object.keys(grupos).length){
      // lote S57 (#220): no RG 11.3 a máquina é a do diário inteiro (coluna EQUIPAMENTO): o dia sem estaca vai para o diário
      // dela, e não para um diário sem máquina em "Para regularizar"
      const maqDia = _iaOrigem === "xlsx_rg113" ? (_iaExtras?.[dia]?.maquina_dia || "") : "";
      const eqDia = maqDia ? ((rdoCasarMaquinaImport(maqDia) || {}).id || _csvMapaManual[maqDia] || null) : null;
      grupos[""] = { dia, eq: eqDia, linhas: [] };
    }
    Object.values(grupos).forEach(g => out.push(g));
  });
  return out;
}
// "🚜 55-HC 8 · 🚜 60-HC 4 · ⚠️ 2 sem máquina" para o título do dia na prévia
function rdoResumoMaquinasDia(dia){
  const grupos = rdoDiariosImport().filter(g => g.dia === dia && g.linhas.length);
  if(!grupos.length) return "";
  return grupos.map(g => g.eq
      ? `🚜 ${esc((_rdoEquipsCache.find(q => q.id === g.eq) || {}).codigo || "?")} ${g.linhas.length}`
      : `<span style="color:var(--aviso-txt);">⚠️ ${g.linhas.length} sem máquina</span>`).join(" · ");
}
const iaMinDe  = (ts) => (ts || []).reduce((m, t) => (t.de  != null && (m == null || t.de  < m)) ? t.de  : m, null);
const iaMaxAte = (ts) => (ts || []).reduce((m, t) => (t.ate != null && (m == null || t.ate > m)) ? t.ate : m, null);
/* Metragem DO DIA pelos trechos (hotfix 15, mesma regra da extrair-rdo-arquivo v3.3):
   Σ (ate − de); sem soma, maior ate − menor de; sem trecho com de e ate, null. */
const iaMetragemDia = (ts) => {
  const soma = (ts || []).reduce((s, t) => (t.de != null && t.ate != null && t.ate > t.de) ? s + (t.ate - t.de) : s, 0);
  if(soma > 0) return Math.round(soma * 100) / 100;
  const de = iaMinDe(ts), ate = iaMaxAte(ts);
  return (de != null && ate != null && ate > de) ? Math.round((ate - de) * 100) / 100 : null;
};

/* ---------- Horas da equipe pela jornada da obra (espelha fn_horas_equipe do banco) ----------
   Regra RH (Ju, 11/09/2026) + decisão do Bernardo: toda HE é 100%; seg-qui o que passar da
   jornada da obra (descontada 1h de almoço) é HE; sexta tem jornada própria quando cadastrada
   (16/09/2026); sábado, domingo e feriado: tudo HE 100.
   Intervalo: sem registro = 60 min; registrado = tempo REAL com piso de 30 min.
   Obra sem jornada → jornada padrão da empresa (empresa_config, lote S40 #31: seg-qui
   07:00–17:00, sexta 07:00–16:00, intervalo 60 min). */
let _iaJornadaObra = null;
let _rdoJornadaEmpresa;          // undefined = não carregada; null = sem empresa_config
async function carregarJornadaEmpresa(){
  if(_rdoJornadaEmpresa !== undefined) return _rdoJornadaEmpresa;
  const { data } = await sb.from("empresa_config")
    .select("jornada_entrada,jornada_saida,jornada_sexta_entrada,jornada_sexta_saida,jornada_intervalo_min")
    .eq("id", 1).maybeSingle();
  _rdoJornadaEmpresa = data && data.jornada_entrada && data.jornada_saida ? data : null;
  return _rdoJornadaEmpresa;
}
/* Jornada que vale para o cálculo: a da obra quando cadastrada; senão a da empresa (padrao_empresa=true).
   Fase 155b: o diário noturno usa a jornada noturna da obra (espelho de campo_jornada_dia no banco), sem padrão da
   empresa; sem ela devolve { sem_jornada_noturna } e as horas trabalhadas vão como normais, HE zero. */
function jornadaEfetiva(obra, turno){
  if(turno === "noturno"){
    if(obra && obra.jornada_noturno_entrada && obra.jornada_noturno_saida) return {
      jornada_entrada: obra.jornada_noturno_entrada, jornada_saida: obra.jornada_noturno_saida,
      jornada_sexta_entrada: obra.jornada_noturno_sexta_entrada, jornada_sexta_saida: obra.jornada_noturno_sexta_saida,
      noturno: true
    };
    return { sem_jornada_noturna: true, noturno: true };
  }
  if(obra && obra.jornada_entrada && obra.jornada_saida) return obra;
  return _rdoJornadaEmpresa ? { ..._rdoJornadaEmpresa, padrao_empresa: true } : null;
}
let _iaObraJornadas = null;   // fase 155b: linha da obra (diurna, noturna e dois_turnos) para a jornada de cada dia
async function iaCarregarJornadaObra(obraId){
  _iaJornadaObra = null; _iaObraJornadas = null;
  if(!obraId) return null;
  const [{ data }] = await Promise.all([
    sb.from("obras").select("jornada_entrada,jornada_saida,jornada_sexta_entrada,jornada_sexta_saida,dois_turnos,jornada_noturno_entrada,jornada_noturno_saida,jornada_noturno_sexta_entrada,jornada_noturno_sexta_saida").eq("id", obraId).maybeSingle(),
    carregarJornadaEmpresa()
  ]);
  _iaObraJornadas = data || null;
  _iaJornadaObra = jornadaEfetiva(data);
  return _iaJornadaObra;
}
/* Fase 155b: o dia noturno da planilha usa a jornada noturna só em obra de dois turnos; nas outras ele grava diurno (155a) */
function iaJornadaDoDia(dia){
  return _iaObraJornadas && _iaObraJornadas.dois_turnos && rdoDiaTurno(dia) === "noturno"
    ? jornadaEfetiva(_iaObraJornadas, "noturno")
    : _iaJornadaObra;
}
function minutosHHMM(s){ const m = String(s || "").match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
/* Fase 93c: horas entre 22h e 5h de um turno (espelho de rh_horas_noturnas no banco). Saída menor ou igual à entrada
   é no dia seguinte; saída igual à entrada vale 0. 20h→6h = 7; 7h→17h = 0; 22h→2h = 4. Em quartos de hora. */
function calcularHorasNoturnas(entrada, saida){
  const e = minutosHHMM(entrada), s0 = minutosHHMM(saida);
  if(e == null || s0 == null) return null;
  if(s0 === e) return 0;
  const s = s0 > e ? s0 : s0 + 1440;
  const janelas = [[0, 300], [1320, 1740], [2760, 3180]];
  const min = janelas.reduce((t, [ini, fim]) => t + Math.max(0, Math.min(s, fim) - Math.max(e, ini)), 0);
  return Math.round(min / 60 * 4) / 4;
}
function calcularHorasEquipe(dataISO, entrada, saida, jornada, intervaloMin, feriado){
  const e = minutosHHMM(entrada), sd = minutosHHMM(saida);
  if(e == null || sd == null) return null;
  let bruto = sd - e; if(bruto < 0) bruto += 24 * 60;
  const iv = (intervaloMin == null || intervaloMin === "") ? 60 : Math.max(30, Number(intervaloMin) || 0);
  const trab = Math.max(0, bruto - iv);
  const dow = new Date(dataISO + "T12:00:00").getDay();
  const h = (m) => Math.round(m / 60 * 4) / 4; // quartos de hora
  if(dow === 0 || dow === 6 || feriado) return { horas_normais: 0, horas_50: 0, horas_100: h(trab) };
  if(!jornada) return null;
  if(jornada.sem_jornada_noturna) return { horas_normais: h(trab), horas_50: 0, horas_100: 0 };   // fase 155b
  // seg-qui usam a jornada padrão; sexta usa a própria quando cadastrada (decisão de 16/09/2026)
  const usaSexta = dow === 5 && minutosHHMM(jornada.jornada_sexta_entrada) != null && minutosHHMM(jornada.jornada_sexta_saida) != null;
  const je = minutosHHMM(usaSexta ? jornada.jornada_sexta_entrada : jornada.jornada_entrada);
  const js = minutosHHMM(usaSexta ? jornada.jornada_sexta_saida   : jornada.jornada_saida);
  if(je == null || js == null) return null;
  let jor = js - je; if(jor < 0) jor += 24 * 60;
  jor = Math.max(0, jor - (Number(jornada.jornada_intervalo_min) || 60)); // jornada do dia já descontado o almoço (1h; mesma regra do banco)
  const normais = Math.min(trab, jor);
  return { horas_normais: h(normais), horas_50: 0, horas_100: h(Math.max(0, trab - normais)) };
}
function iaTextoAvisoJornada(){
  const j = _iaJornadaObra;
  const hm = (s) => String(s || "").slice(0, 5);
  const faixa = (x) => `seg-qui ${hm(x.jornada_entrada)}–${hm(x.jornada_saida)}${x.jornada_sexta_entrada && x.jornada_sexta_saida ? `, sexta ${hm(x.jornada_sexta_entrada)}–${hm(x.jornada_sexta_saida)}` : ""}`;
  const dois = !!(_iaObraJornadas && _iaObraJornadas.dois_turnos);
  let t;
  if(!j) t = "⏱️ A obra não tem jornada cadastrada (Obra › Parâmetros) e não há jornada padrão da empresa: as horas extras dos dias úteis ficam em branco até alguém preencher.";
  else if(!j.padrao_empresa) t = `⏱️ Diurno: jornada da obra (${faixa(j)}).`;
  else t = `⏱️ A obra não tem jornada cadastrada (Obra › Parâmetros): usando o padrão da empresa (${faixa(j)}).`;
  // fase 155b: obra de dois turnos diz também a jornada dos dias noturnos
  if(dois){
    const n = jornadaEfetiva(_iaObraJornadas, "noturno");
    t += n.sem_jornada_noturna ? " Noturno: obra sem jornada noturna; preencha na aba Parâmetros (HE zero até lá)." : ` Noturno: jornada noturna da obra (${faixa(n)}; saída depois da meia-noite é no dia seguinte).`;
  }
  return t;
}
/* Fase 155b: o aviso aparece sem jornada própria da obra ou em obra de dois turnos (para dizer as duas jornadas) */
function iaMostrarAvisoJornada(){
  return !(_iaJornadaObra && !_iaJornadaObra.padrao_empresa) || !!(_iaObraJornadas && _iaObraJornadas.dois_turnos);
}
/* Feriado marcado no cabeçalho do dia (preview da IA) */
function iaDiaFeriado(dia){
  const cb = document.querySelector(`.ia-dia[data-dia="${dia}"] [data-cab="feriado"]`);
  return !!(cb && cb.checked);
}
/* Aplica a jornada nas linhas da equipe do preview. soVazias=true não mexe no que a pessoa já digitou. */
function iaRecalcularHorasNoDOM(soVazias){
  document.querySelectorAll(".ia-dia").forEach(bloco => {
    const dia = bloco.dataset.dia;
    bloco.querySelectorAll(".ia-equipe tbody tr").forEach(tr => iaRecalcularHorasLinha(tr, dia, soVazias));
  });
  const aviso_ = document.querySelector(".ia-jornada-aviso");
  if(aviso_){
    aviso_.style.display = iaMostrarAvisoJornada() ? "" : "none";
    aviso_.textContent = iaTextoAvisoJornada();
  }
}
function iaRecalcularHorasLinha(tr, dia, soVazias){
  const g = (c) => tr.querySelector(`[data-e="${c}"]`);
  // lote S54 (#178): o status do dia manda nas horas, como no RDO (ausência sem horas; treinamento em dia útil e viagem sem HE)
  const st = rdoStatusDia(g("status_dia")?.value);
  if(st?.aus){
    ["hora_entrada","hora_saida","horas_normais","horas_50","horas_100"].forEach(k => { const el = g(k); if(el){ el.value = ""; el.dataset.auto = "1"; } });
    return;
  }
  // fase 134b: a chave do bloco pode levar o período; a jornada e o feriado olham a data
  const r = calcularHorasEquipe(rdoDiaData(dia), g("hora_entrada")?.value, g("hora_saida")?.value, iaJornadaDoDia(dia), g("intervalo_minutos")?.value, iaDiaFeriado(dia));
  if(r && rdoSemHE(st, rdoDiaData(dia), iaDiaFeriado(dia))) r.horas_100 = 0;
  ["horas_normais","horas_50","horas_100"].forEach(k => {
    const el = g(k); if(!el) return;
    if(soVazias && el.value !== "" && el.dataset.auto !== "1") return;
    el.value = r ? r[k] : ""; el.dataset.auto = "1";
  });
}

/* Tabela de conferência: tudo editável; o que estiver aqui é o que será gravado */
function renderConferenciaIA(resp){
  const cont = $("csv-preview-conteudo");
  if(!cont || !_csvParsed) return;
  const hh = (iso) => iso ? esc(String(iso).slice(11, 16)) : "";
  const v  = (x) => (x == null ? "" : x);
  const tempoOpts = (sel) => '<option value="">—</option>' + Object.entries(CONDICAO_TEMPO_IA).map(([k,l]) => `<option value="${esc(k)}"${k===sel?" selected":""}>${esc(l)}</option>`).join("");
  const funcOpts  = (sel, comCadastro) => (comCadastro ? '<option value="">— do cadastro —</option>' : "") + FUNCOES_RDO_IA.map(f => `<option value="${esc(f)}"${f===sel?" selected":""}>${esc(f)}</option>`).join("");
  const ferrOpts  = (sel) => '<option value="">—</option>' + Object.entries(FERRAMENTAS_TRECHO_IA).map(([k,l]) => `<option value="${esc(k)}"${k===sel?" selected":""}>${esc(l)}</option>`).join("");
  const funcOptsCadastro = '<option value="">— sem cadastro (avulso) —</option>' + _rdoFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");

  const conf = resp?.confianca || "media";
  const corConf = conf === "alta" ? "var(--sucesso)" : conf === "baixa" ? "var(--perigo)" : "var(--aviso)";
  const duvidas = (resp?.duvidas || []);
  const temJornada = !iaMostrarAvisoJornada();   // fase 155b: nome antigo; esconde o aviso só com jornada própria e um turno
  let html = `<div class="ia-conf-topo">
    <div>${resp?.origem_label ? esc(resp.origem_label) : `🤖 <strong>Lido por IA</strong> ${resp?.manuscrito ? "(diário manuscrito)" : "(PDF digital)"}`} · confiança <strong style="color:${corConf}">${esc(conf)}</strong>
      ${resp?.observacoes ? `<div class="meta">${esc(resp.observacoes)}</div>` : ""}</div>
    ${duvidas.length ? `<div class="ia-duvidas">⚠️ Pontos para conferir: ${duvidas.map(esc).join(" · ")}</div>` : ""}
    <div class="ia-duvidas" id="csv-aviso-so-injecao" style="${resp?.aviso_so_injecao ? "" : "display:none;"}">${esc(resp?.aviso_so_injecao ? "⚠️ " + resp.aviso_so_injecao : "")}</div>
    <div class="ia-duvidas ia-jornada-aviso" style="${temJornada ? "display:none;" : ""}">${esc(iaTextoAvisoJornada())}</div>
    <div class="meta">Confira e corrija abaixo. O que estiver na tabela é exatamente o que será gravado. Linhas removidas com ✕ não entram. A função da equipe vem do cadastro de funcionários; "Função no dia" só quando o boletim disser outra.</div>
  </div>`;

  diasImportacao().forEach(dia => {
    const ex = _iaExtras?.[dia] || { equipe: [] };
    const ests = _csvParsed[dia] || [];
    const semCadastro = ex.equipe.filter(m => !m.funcionario_id).length;
    // Responsável: integrantes casados primeiro, depois o restante do cadastro
    const idsEquipe = new Set(ex.equipe.map(m => m.funcionario_id).filter(Boolean));
    // O valor do select é o nome (vai para as observações); nunca id de funcionário (chamado #30)
    const respDiario = ex.responsavel_diario || ex.responsavel || null;
    // O nome do diário que não está no cadastro vence a sugestão da equipe (encarregado/operador)
    const respForaCadastro = respDiario && !casarFuncionarioPorNome(respDiario) ? respDiario : null;
    const idSugerido = respForaCadastro ? null : ex.responsavel_sugerido_id;
    const respOpts = '<option value="">— não informado —</option>' +
      (respForaCadastro ? `<option value="${esc(respForaCadastro)}" selected>${esc(respForaCadastro)} (fora do cadastro)</option>` : "") +
      (idsEquipe.size ? `<optgroup label="Equipe do dia">${_rdoFuncs.filter(f => idsEquipe.has(f.id)).map(f => `<option value="${esc(f.nome)}"${f.id===idSugerido?" selected":""}>${esc(f.nome)}${f.funcao ? " · " + esc(f.funcao) : ""}</option>`).join("")}</optgroup>` : "") +
      `<optgroup label="Outros do cadastro">${_rdoFuncs.filter(f => !idsEquipe.has(f.id)).map(f => `<option value="${esc(f.nome)}"${f.id===idSugerido?" selected":""}>${esc(f.nome)}</option>`).join("")}</optgroup>`;
    const maqDia = rdoResumoMaquinasDia(dia);   // fase 94: um diário por máquina
    html += `<div class="ia-dia" data-dia="${esc(dia)}">
      <div class="ia-dia-titulo">📅 ${dataBR(rdoDiaData(dia))}${rdoDiaTurno(dia) === "noturno" ? ` <span class="tag azul" title="Fase 134b: período noturno da planilha; vira um diário próprio no mesmo dia">Noturno</span>` : ""}${maqDia ? ` <span class="meta csv-maq-dia" data-dia="${esc(dia)}" style="font-weight:400;">· ${maqDia}</span>` : ""}</div>
      <div class="grade ia-cab">
        <div class="campo"><label>Tempo manhã</label><select data-cab="tempo_manha">${tempoOpts(ex.tempo_manha)}</select></div>
        <div class="campo"><label>Tempo tarde</label><select data-cab="tempo_tarde">${tempoOpts(ex.tempo_tarde)}</select></div>
        <div class="campo"><label>Feriado?</label><label class="meta" style="display:flex;align-items:center;gap:6px;min-height:34px;cursor:pointer;"><input type="checkbox" data-cab="feriado" ${ex.feriado ? "checked" : ""} /> tudo HE 100%</label></div>
        <div class="campo"><label>Responsável do dia <small class="meta">(operador/encarregado, vai para as observações)</small></label><select data-cab="responsavel">${respOpts}</select>
          ${respDiario ? `<div class="meta">No diário: "${esc(respDiario)}"</div>` : ""}</div>
        <div class="campo largo"><label>Atividades</label><input data-cab="atividades" value="${esc(v(ex.atividades))}" /></div>
        <div class="campo largo"><label>Observações / ocorrências</label><input data-cab="observacoes" value="${esc(v(ex.observacoes))}" /></div>
      </div>
      <details class="ia-just" ${(ex.justificativa || []).length ? "open" : ""}>
        <summary>⏱️ Atividades hora a hora (${(ex.justificativa || []).length})<span class="meta"> · justificativa do diário; duração = fim − início</span></summary>
        <table class="itens-tabela ia-tabela ia-just-tbl"><thead><tr><th>Início</th><th>Fim</th><th>Atividade</th><th class="num">Duração</th><th></th></tr></thead>
        <tbody>${(ex.justificativa || []).map(j => `<tr>
          <td><input type="time" data-j="h_inicial" value="${esc(v(j.h_inicial))}" /></td>
          <td><input type="time" data-j="h_final" value="${esc(v(j.h_final))}" /></td>
          <td><input data-j="motivo" value="${esc(v(j.motivo))}" style="min-width:220px" /></td>
          <td class="num ia-just-dur">${rdoFmtDuracao(rdoDuracaoMin(j.h_inicial, j.h_final))}</td>
          <td class="col-acao"><button type="button" class="btn-rem ia-rem-just" title="remover">&times;</button></td>
        </tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="3"><strong>Total do dia</strong></td><td class="num"><strong class="ia-just-total">—</strong></td><td></td></tr></tfoot></table>
        <button type="button" class="btn-sec btn-sm ia-add-just" style="margin-top:6px;">+ atividade</button>
      </details>
      <div class="tabela-rola"><table class="itens-tabela ia-tabela ia-estacas">
        <thead><tr><th>Estaca</th><th title="Bloco / anel / pilar">Agrup.</th><th>Refuro</th><th>Ø mm</th><th>Prof. proj.</th><th title="Metros perfurados neste dia (o que a medição soma)">No dia (m)</th><th title="Início do trecho perfurado no dia">De (m)</th><th title="Até onde a estaca chegou ao fim do dia: profundidade acumulada">Acum. (m)</th><th>Perf. início</th><th>Perf. fim</th><th>Conc. início</th><th>Conc. fim</th><th>Concreto m³</th><th>Torque</th><th>Máquina</th><th>Obs.</th><th title="Fase 94: por que a estaca conta como executada neste dia (metragem, ou injeção/concretagem/argamassado na observação). Vazio = não muda o status da estaca">Etapa</th><th></th></tr></thead>
        <tbody>${ests.map((e, i) => {
          const trechos = e.trechos || [];
          return `<tr data-idx="${i}">
          <td><input data-c="estaca_numero" value="${esc(v(e.estaca_numero))}" style="width:70px" /></td>
          <td><input data-c="agrupamento" value="${esc(v(e.agrupamento))}" style="width:60px" placeholder="BL3" /></td>
          <td><input type="checkbox" data-c="refuro" ${e.modalidade_execucao === "refuro" ? "checked" : ""} /></td>
          <td><input type="number" step="1" data-c="diametro_mm" value="${esc(v(e.diametro_mm))}" style="width:64px" /></td>
          <td><input type="number" step="0.01" data-c="profundidade_projeto" value="${esc(v(e.profundidade_projeto))}" style="width:70px" /></td>
          <td><input type="number" step="0.01" data-c="profundidade_executada" value="${esc(v(e.profundidade_executada))}" data-auto="${esc(v(e.profundidade_executada))}" style="width:70px" title="Metros perfurados neste dia" /></td>
          <td><input type="number" step="0.01" data-c="perfuracao_de_m" value="${esc(v(e.perfuracao_de_m))}" style="width:62px" /></td>
          <td><input type="number" step="0.01" data-c="perfuracao_ate_m" value="${esc(v(e.perfuracao_ate_m ?? e.profundidade_acumulada_m))}" style="width:62px" title="Profundidade acumulada da estaca ao fim do dia" /></td>
          <td><input type="time" data-c="perfuracao_inicio" value="${hh(e.perfuracao_inicio)}" /></td>
          <td><input type="time" data-c="perfuracao_fim" value="${hh(e.perfuracao_fim)}" /></td>
          <td><input type="time" data-c="concretagem_inicio" value="${hh(e.concretagem_inicio)}" /></td>
          <td><input type="time" data-c="concretagem_fim" value="${hh(e.concretagem_fim)}" /></td>
          <td><input type="number" step="0.01" data-c="volume_concreto_m3" value="${esc(v(e.volume_concreto_m3))}" style="width:70px" /></td>
          <td><input type="number" step="0.1" data-c="torque" value="${esc(v(e.torque))}" style="width:60px" /></td>
          <td><input data-c="maquina_codigo" value="${esc(v(e.maquina_codigo))}" style="width:80px" /></td>
          <td><input data-c="observacoes" value="${esc(v(e.observacoes))}" style="width:140px" /></td>
          <td class="ia-etapa">${rdoEtapaHTML(e)}</td>
          <td class="col-acao"><button type="button" class="btn-rem ia-rem" title="não importar esta linha">&times;</button></td>
        </tr>
        <tr class="ia-sub" data-sub="${i}"><td colspan="18">
          <details class="ia-trechos" ${trechos.length ? "open" : ""}>
            <summary>⛏️ Trechos de solo / ferramenta (${trechos.length})${e.inclinacao ? ` · inclinação ${esc(e.inclinacao)}` : ""}${(e.consumo_cimento_raiz || e.pressao_injecao_kgcm2 != null) ? ` · injeção: cimento ${esc(v(e.consumo_cimento_raiz))} · areia ${esc(v(e.consumo_areia_raiz))} · ${esc(v(e.pressao_injecao_kgcm2))} kg/cm²` : ""}</summary>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:4px 0;">
              <label class="meta">Inclinação <input data-c="inclinacao" value="${esc(v(e.inclinacao))}" style="width:60px" placeholder="90" /></label>
              <label class="meta">Cimento <input data-c="consumo_cimento_raiz" value="${esc(v(e.consumo_cimento_raiz))}" style="width:56px" /></label>
              <label class="meta">Areia <input data-c="consumo_areia_raiz" value="${esc(v(e.consumo_areia_raiz))}" style="width:56px" /></label>
              <label class="meta">Pressão kg/cm² <input type="number" step="0.01" data-c="pressao_injecao_kgcm2" value="${esc(v(e.pressao_injecao_kgcm2))}" style="width:62px" /></label>
              <label class="meta" title="Fase 101 (#99): volume injetado na estaca no dia">m³ injetado <input type="number" step="0.01" min="0" data-c="volume_injetado_m3" value="${esc(v(e.volume_injetado_m3))}" style="width:62px" /></label>
              <label class="meta" title="Fase 101 (#99): água consumida na estaca no dia">Água (L) <input type="number" step="1" min="0" data-c="agua_l" value="${esc(v(e.agua_l))}" style="width:62px" /></label>
              <button type="button" class="btn-sec btn-sm ia-add-trecho">+ trecho</button>
            </div>
            <table class="itens-tabela ia-tabela ia-trechos-tbl"><thead><tr><th>De (m)</th><th>Até (m)</th><th>Ferramenta</th><th>Classificação do solo</th><th></th></tr></thead>
            <tbody>${trechos.map(t => `<tr>
              <td><input type="number" step="0.01" data-t="de" value="${esc(v(t.de))}" style="width:62px" /></td>
              <td><input type="number" step="0.01" data-t="ate" value="${esc(v(t.ate))}" style="width:62px" /></td>
              <td><select data-t="ferramenta">${ferrOpts(t.ferramenta)}</select></td>
              <td><input data-t="solo" list="rdo-solo-classif-lista" value="${esc(v(t.solo))}" style="min-width:180px" /></td>
              <td class="col-acao"><button type="button" class="btn-rem ia-rem-trecho" title="remover trecho">&times;</button></td>
            </tr>`).join("")}</tbody></table>
          </details>
        </td></tr>`; }).join("")}</tbody>
      </table></div>
      <details class="ia-equipe" ${ex.equipe.length ? "open" : ""}>
        <summary>👷 Equipe do dia (${ex.equipe.length})${semCadastro ? ` <span style="color:var(--aviso-txt);">· ⚠️ ${semCadastro} sem correspondência no cadastro → entram como avulsos</span>` : ""}</summary>
        <table class="itens-tabela ia-tabela"><thead><tr><th>Nome no diário</th><th>Funcionário (cadastro)</th><th>Função (cadastro)</th><th title="Só quando o boletim disser outra função">Função no dia</th><th title="Lote S54 (#178): status do dia lido do boletim (FALTA, FOLGA, ½ FOLGA, DSR, ATESTADO, TREINAMENTO, VIAGEM…); vazio = presente. Confira: a IA só transcreve">Status do dia</th><th>Entrada</th><th>Saída</th><th title="Intervalo real de almoço (min). Vazio = 60; piso 30">Interv. (min)</th><th>H. normais</th><th title="Sem uso: toda HE é 100% (regra RH 11/09/2026)">H. 50%</th><th>H. 100%</th><th></th></tr></thead>
        <tbody>${ex.equipe.map(p => `<tr${p.funcionario_id ? "" : ' class="ia-sem-cadastro"'}>
          <td><input data-e="nome" value="${esc(v(p.nome))}" /></td>
          <td><select data-e="funcionario_id">${funcOptsCadastro}</select></td>
          <td class="ia-funcao-cadastro meta">${p.funcionario_id ? esc(p.funcao_cadastro || "—") : "⚠️ sem cadastro"}</td>
          <td><select data-e="funcao">${funcOpts(p.funcao_no_dia || "", !!p.funcionario_id)}</select></td>
          <td><select data-e="status_dia" style="min-width:130px;"${p.status_texto ? ` title="No boletim: ${esc(p.status_texto)}"` : ""}><option value="">Presente</option>${RDO_STATUS_DIA.map(s => `<option value="${esc(s.v)}"${s.v === p.status_dia ? " selected" : ""}>${esc(s.l)}</option>`).join("")}</select>${p.status_texto && !p.status_dia ? `<div class="meta" title="Texto do boletim sem correspondência: escolha o status">“${esc(p.status_texto)}”</div>` : ""}</td>
          <td><input type="time" data-e="hora_entrada" value="${esc(v(p.hora_entrada))}" /></td>
          <td><input type="time" data-e="hora_saida" value="${esc(v(p.hora_saida))}" /></td>
          <td><input type="number" step="5" min="0" max="240" data-e="intervalo_minutos" value="${esc(v(p.intervalo_minutos ?? ex.intervalo_minutos))}" style="width:60px" placeholder="60" /></td>
          <td><input type="number" step="0.25" data-e="horas_normais" value="${esc(v(p.horas_normais))}" style="width:60px" /></td>
          <td><input type="number" step="0.25" data-e="horas_50" value="${esc(v(p.horas_50))}" style="width:60px" /></td>
          <td><input type="number" step="0.25" data-e="horas_100" value="${esc(v(p.horas_100))}" style="width:60px" /></td>
          <td class="col-acao"><button type="button" class="btn-rem ia-rem" title="remover">&times;</button></td>
        </tr>`).join("")}</tbody></table>
      </details>
      ${(ex.abastecimentos && ex.abastecimentos.length) ? `<details class="ia-abast" open>
        <summary>⛽ Abastecimento do dia (${ex.abastecimentos.length}) <span class="meta">— do diário do operador</span></summary>
        <table class="itens-tabela ia-tabela"><thead><tr><th>Máquina</th><th>Combustível</th><th>Quantidade (L)</th><th>Horímetro</th><th>Obs.</th><th></th></tr></thead>
        <tbody>${ex.abastecimentos.map(a => `<tr>
          <td><input data-a="maquina" value="${esc(v(a.maquina))}" style="width:90px" /></td>
          <td><input data-a="combustivel" value="${esc(v(a.combustivel))}" style="width:90px" /></td>
          <td><input type="number" step="0.01" data-a="quantidade" value="${esc(v(a.quantidade))}" style="width:80px" /></td>
          <td><input type="number" step="0.1" data-a="horimetro" value="${esc(v(a.horimetro))}" style="width:90px" /></td>
          <td><input data-a="observacao" value="${esc(v(a.observacao))}" style="min-width:160px" /></td>
          <td class="col-acao"><button type="button" class="btn-rem ia-rem" title="não importar">&times;</button></td>
        </tr>`).join("")}</tbody></table>
      </details>` : ""}
    </div>`;
  });
  cont.insertAdjacentHTML("beforeend", html);

  // fase 94: a etapa da linha acompanha o que a pessoa digita (metragem ou observação)
  cont.querySelectorAll("table.ia-estacas > tbody > tr[data-idx]").forEach(tr => tr.addEventListener("input", () => {
    const g = (c) => tr.querySelector(`[data-c="${c}"]`);
    const td = tr.querySelector(".ia-etapa");
    if(td) td.innerHTML = rdoEtapaHTML({ estaca_numero: g("estaca_numero")?.value, observacoes: g("observacoes")?.value,
      profundidade_executada: g("profundidade_executada")?.value, perfuracao_ate_m: g("perfuracao_ate_m")?.value });
  }));

  // selects (valor via innerHTML não funciona): funcionário casado por linha
  cont.querySelectorAll(".ia-dia").forEach(bloco => {
    const ex = _iaExtras?.[bloco.dataset.dia];
    // feriado do dia → recalcula as horas de toda a equipe do dia (tudo vira HE 100)
    bloco.querySelector('[data-cab="feriado"]')?.addEventListener("change", () => bloco.querySelectorAll(".ia-equipe tbody tr").forEach(tr => iaRecalcularHorasLinha(tr, bloco.dataset.dia, false)));
    bloco.querySelectorAll(".ia-equipe tbody tr").forEach((tr, i) => {
      const m = ex?.equipe?.[i];
      const sel = tr.querySelector('[data-e="funcionario_id"]');
      if(sel && m?.funcionario_id) sel.value = m.funcionario_id;
      // horas: se o boletim não trouxe, calcula pela jornada da obra (campos ficam editáveis)
      iaRecalcularHorasLinha(tr, bloco.dataset.dia, true);
      tr.querySelector('[data-e="hora_entrada"]')?.addEventListener("change", () => iaRecalcularHorasLinha(tr, bloco.dataset.dia, false));
      tr.querySelector('[data-e="hora_saida"]')?.addEventListener("change", () => iaRecalcularHorasLinha(tr, bloco.dataset.dia, false));
      tr.querySelector('[data-e="intervalo_minutos"]')?.addEventListener("change", () => iaRecalcularHorasLinha(tr, bloco.dataset.dia, false));
      tr.querySelector('[data-e="status_dia"]')?.addEventListener("change", () => iaRecalcularHorasLinha(tr, bloco.dataset.dia, false));   // lote S54
      ["horas_normais","horas_50","horas_100"].forEach(k => tr.querySelector(`[data-e="${k}"]`)?.addEventListener("input", (ev) => { ev.target.dataset.auto = "0"; }));
      // troca de funcionário → função do cadastro e "Função no dia" voltam a seguir o cadastro
      sel?.addEventListener("change", () => {
        const f = _rdoFuncs.find(x => x.id === sel.value);
        tr.querySelector(".ia-funcao-cadastro").textContent = f ? (f.funcao || "—") : "⚠️ sem cadastro";
        tr.classList.toggle("ia-sem-cadastro", !f);
        const selFun = tr.querySelector('[data-e="funcao"]');
        selFun.innerHTML = funcOpts(f ? "" : "outro", !!f);
      });
    });
  });

  // atividades hora a hora (chamado #5): duração por linha + total do dia, remover, adicionar
  const recalcJust = (det) => {
    let total = 0, ok = false;
    det.querySelectorAll(".ia-just-tbl tbody tr").forEach(tr => {
      const d = rdoDuracaoMin(tr.querySelector('[data-j="h_inicial"]').value, tr.querySelector('[data-j="h_final"]').value);
      tr.querySelector(".ia-just-dur").textContent = rdoFmtDuracao(d);
      if(d != null){ total += d; ok = true; }
    });
    const n = det.querySelectorAll(".ia-just-tbl tbody tr").length;
    det.querySelector(".ia-just-total").textContent = ok ? rdoFmtDuracao(total) : "—";
    det.querySelector("summary").firstChild.textContent = `⏱️ Atividades hora a hora (${n})`;
  };
  const ligarJust = (det) => {
    det.querySelectorAll(".ia-just-tbl tbody tr").forEach(tr => {
      if(tr.dataset.ligado) return; tr.dataset.ligado = "1";
      tr.addEventListener("input", () => recalcJust(det));
      tr.querySelector(".ia-rem-just").addEventListener("click", () => { tr.remove(); recalcJust(det); });
    });
  };
  cont.querySelectorAll(".ia-just").forEach(det => {
    ligarJust(det); recalcJust(det);
    det.querySelector(".ia-add-just").addEventListener("click", () => {
      const tb = det.querySelector(".ia-just-tbl tbody");
      const ult = tb.querySelector("tr:last-child");
      const hi = ult ? (ult.querySelector('[data-j="h_final"]').value || "") : "";
      tb.insertAdjacentHTML("beforeend", `<tr>
        <td><input type="time" data-j="h_inicial" value="${esc(hi)}" /></td>
        <td><input type="time" data-j="h_final" value="" /></td>
        <td><input data-j="motivo" value="" style="min-width:220px" /></td>
        <td class="num ia-just-dur">—</td>
        <td class="col-acao"><button type="button" class="btn-rem ia-rem-just" title="remover">&times;</button></td></tr>`);
      det.open = true;
      ligarJust(det); recalcJust(det);
    });
  });

  // trechos: editar De/Acum./No dia da linha principal conforme os trechos
  const sincronizarTrechos = (sub) => {
    const idx = sub.dataset.sub;
    const main = sub.parentElement.querySelector(`tr[data-idx="${idx}"]`);
    if(!main) return;
    const ts = [...sub.querySelectorAll(".ia-trechos-tbl tbody tr")].map(tr => ({ de: numOrNull(tr.querySelector('[data-t="de"]').value), ate: numOrNull(tr.querySelector('[data-t="ate"]').value) }));
    const de = iaMinDe(ts), ate = iaMaxAte(ts);
    if(!ts.length) return;
    const inDe = main.querySelector('[data-c="perfuracao_de_m"]'), inAte = main.querySelector('[data-c="perfuracao_ate_m"]'), inPe = main.querySelector('[data-c="profundidade_executada"]');
    inDe.value = de ?? ""; inAte.value = ate ?? "";
    // hotfix 15: "No dia" acompanha a metragem dos trechos enquanto a pessoa não digitar outro valor
    const noDia = iaMetragemDia(ts) ?? ate;
    if(noDia != null && (inPe.value === "" || inPe.value === inPe.dataset.auto)){ inPe.value = noDia; inPe.dataset.auto = String(noDia); }
    sub.querySelector("summary").firstChild.textContent = `⛏️ Trechos de solo / ferramenta (${ts.length})`;
  };
  const ligarTrechos = (sub) => {
    sub.querySelectorAll(".ia-trechos-tbl tbody tr").forEach(tr => {
      if(tr.dataset.ligado) return; tr.dataset.ligado = "1";
      tr.addEventListener("input", () => sincronizarTrechos(sub));
      tr.querySelector(".ia-rem-trecho").addEventListener("click", () => { tr.remove(); sincronizarTrechos(sub); });
    });
  };
  cont.querySelectorAll(".ia-sub").forEach(sub => {
    ligarTrechos(sub);
    sub.querySelector(".ia-add-trecho").addEventListener("click", () => {
      const tb = sub.querySelector(".ia-trechos-tbl tbody");
      const ult = tb.querySelector("tr:last-child");
      const deIni = ult ? (ult.querySelector('[data-t="ate"]').value || "") : "0";
      tb.insertAdjacentHTML("beforeend", `<tr>
        <td><input type="number" step="0.01" data-t="de" value="${esc(deIni)}" style="width:62px" /></td>
        <td><input type="number" step="0.01" data-t="ate" value="" style="width:62px" /></td>
        <td><select data-t="ferramenta">${ferrOpts("")}</select></td>
        <td><input data-t="solo" list="rdo-solo-classif-lista" value="" style="min-width:180px" /></td>
        <td class="col-acao"><button type="button" class="btn-rem ia-rem-trecho" title="remover trecho">&times;</button></td></tr>`);
      sub.querySelector("details").open = true;
      ligarTrechos(sub);
    });
  });
  cont.querySelectorAll(".ia-rem").forEach(b => b.addEventListener("click", () => {
    const tr = b.closest("tr");
    const prox = tr.nextElementSibling;
    if(prox && prox.classList.contains("ia-sub") && prox.dataset.sub === tr.dataset.idx) prox.remove();
    tr.remove();
  }));
}

/* Lê a tabela de conferência de volta para _csvParsed/_iaExtras (o que será gravado) */
function lerConferenciaIA(){
  if(!_iaExtras) return;
  const num = (x) => (x === "" || x == null) ? null : (isFinite(Number(x)) ? Number(x) : null);
  const ts = (dia, hhmm) => hhmm ? `${rdoDiaData(dia)}T${hhmm}:00` : null;   // fase 134b: a chave pode levar o período
  document.querySelectorAll(".ia-dia").forEach(bloco => {
    const dia = bloco.dataset.dia;
    const orig = _csvParsed[dia] || [];
    const ex = _iaExtras[dia] || (_iaExtras[dia] = { equipe: [] });
    bloco.querySelectorAll("[data-cab]").forEach(el => { ex[el.dataset.cab] = el.type === "checkbox" ? el.checked : (el.value.trim() || null); });
    // atividades hora a hora (chamado #5): o que está na tabela é o que vai para rdo_raiz_justificativa
    ex.justificativa = [...bloco.querySelectorAll(".ia-just-tbl tbody tr")].map(tr => ({
      h_inicial: tr.querySelector('[data-j="h_inicial"]').value || null,
      h_final:   tr.querySelector('[data-j="h_final"]').value || null,
      motivo:    tr.querySelector('[data-j="motivo"]').value.trim() || null
    })).filter(j => j.h_inicial || j.h_final || j.motivo);
    const novos = [];
    bloco.querySelectorAll("table.ia-estacas > tbody > tr[data-idx]").forEach(tr => {
      const base = orig[Number(tr.dataset.idx)] || {};
      const g = (c) => tr.querySelector(`[data-c="${c}"]`);
      const numero = normalizarNumeroEstaca(g("estaca_numero").value.trim());
      if(!numero) return;
      const maq = g("maquina_codigo").value.trim();
      const eq = rdoCasarMaquinaImport(maq);   // lote S42: apelidos TAG-NN; fase 101: no import por IA só o código idêntico (o resto é sugestão)
      // sub-linha (trechos, inclinação, injeção)
      const sub = tr.nextElementSibling && tr.nextElementSibling.classList.contains("ia-sub") ? tr.nextElementSibling : null;
      const gs = (c) => sub ? sub.querySelector(`[data-c="${c}"]`) : null;
      const trechos = sub ? [...sub.querySelectorAll(".ia-trechos-tbl tbody tr")].map((r, i) => ({
        ordem: i + 1,
        de: num(r.querySelector('[data-t="de"]').value), ate: num(r.querySelector('[data-t="ate"]').value),
        ferramenta: r.querySelector('[data-t="ferramenta"]').value || null,
        solo: r.querySelector('[data-t="solo"]').value.trim() || null
      })).filter(t => t.de != null || t.ate != null || t.solo || t.ferramenta) : (base.trechos || []);
      const de  = num(g("perfuracao_de_m").value)  ?? iaMinDe(trechos);
      const ate = num(g("perfuracao_ate_m").value) ?? iaMaxAte(trechos);
      novos.push({ ...base,
        estaca_numero: numero,
        agrupamento: g("agrupamento").value.trim() || null,
        modalidade_execucao: g("refuro").checked ? "refuro" : "furo_normal",
        diametro_mm: num(g("diametro_mm").value),
        profundidade_projeto: num(g("profundidade_projeto").value),
        profundidade_executada: num(g("profundidade_executada").value) ?? iaMetragemDia(trechos) ?? ate,
        perfuracao_de_m: de, perfuracao_ate_m: ate, trechos,
        inclinacao: gs("inclinacao") ? (gs("inclinacao").value.trim() || null) : (base.inclinacao || null),
        consumo_cimento_raiz: gs("consumo_cimento_raiz") ? (gs("consumo_cimento_raiz").value.trim() || null) : (base.consumo_cimento_raiz || null),
        consumo_areia_raiz:   gs("consumo_areia_raiz")   ? (gs("consumo_areia_raiz").value.trim()   || null) : (base.consumo_areia_raiz   || null),
        pressao_injecao_kgcm2: gs("pressao_injecao_kgcm2") ? num(gs("pressao_injecao_kgcm2").value) : (base.pressao_injecao_kgcm2 ?? null),
        volume_injetado_m3: gs("volume_injetado_m3") ? num(gs("volume_injetado_m3").value) : (base.volume_injetado_m3 ?? null),   // fase 101
        agua_l: gs("agua_l") ? num(gs("agua_l").value) : (base.agua_l ?? null),
        perfuracao_inicio: ts(dia, g("perfuracao_inicio").value), perfuracao_fim: ts(dia, g("perfuracao_fim").value),
        concretagem_inicio: ts(dia, g("concretagem_inicio").value), concretagem_fim: ts(dia, g("concretagem_fim").value),
        volume_concreto_m3: num(g("volume_concreto_m3").value),
        torque: num(g("torque").value),
        maquina_codigo: maq,
        equipamento_id: eq ? eq.id : (base.maquina_codigo === maq ? base.equipamento_id : null),
        observacoes: g("observacoes").value.trim() || null
      });
    });
    if(novos.length) _csvParsed[dia] = novos; else delete _csvParsed[dia];
    const equipeAnt = ex.equipe || [];
    ex.equipe = [];
    bloco.querySelectorAll(".ia-equipe tbody tr").forEach((tr, i) => {
      const g = (c) => tr.querySelector(`[data-e="${c}"]`);
      const nome = g("nome").value.trim();
      if(!nome) return;
      const m = { ...(equipeAnt[i] || {}), nome,
        funcionario_id: g("funcionario_id")?.value || null,
        status_dia: g("status_dia")?.value || null,   // lote S54 (#178)
        hora_entrada: g("hora_entrada").value || null, hora_saida: g("hora_saida").value || null,
        intervalo_minutos: num(g("intervalo_minutos")?.value),
        horas_normais: num(g("horas_normais").value), horas_50: num(g("horas_50").value), horas_100: num(g("horas_100").value) };
      iaAplicarCadastroIntegrante(m);
      // select "Função no dia": vazio = segue o cadastro; preenchido = o boletim disse outra função
      const fSel = g("funcao").value || null;
      m.funcao_no_dia = m.funcionario_id ? fSel : (fSel || "outro");
      ex.equipe.push(m);
    });
    // abastecimento do dia (planilha do Maya, bloco complementar)
    ex.abastecimentos = [...bloco.querySelectorAll(".ia-abast tbody tr")].map(tr => {
      const ga = (c) => tr.querySelector(`[data-a="${c}"]`);
      return { maquina: ga("maquina").value.trim() || null, combustivel: ga("combustivel").value.trim().toLowerCase() || "diesel",
        quantidade: num(ga("quantidade").value), horimetro: num(ga("horimetro").value), unidade: "L", observacao: ga("observacao").value.trim() || null };
    }).filter(a => a.quantidade != null || a.horimetro != null || a.observacao);
  });
  // máquinas sem match após a edição
  const regs = Object.values(_csvParsed).flat();
  const maqs = [...new Set(regs.map(r => (r.maquina_codigo||"").trim()).filter(Boolean))];
  _csvMaquinasSemMatch = maqs.filter(m => !regs.find(r => r.maquina_codigo === m && r.equipamento_id));
}

/* lote S44 (L5, chamado #78, Isaque): sugestão de vínculo entre a estaca do arquivo e a cadastrada quando o
   nome só difere em prefixo, vírgula ou zeros à esquerda (T1.85 → E1.85, P081 → E81; chave em
   estNormalizarNome, js/estacas.js). Só sugere: a pessoa marca o que aceita; nome exato continua
   vinculando sozinho (resolverEstacaImport); mais de uma candidata = sem sugestão; BB1.1 ≠ B1.1 segue. */
let _csvSugestoes = {};   // nome no arquivo (normalizado) -> { id, numero } da estaca sugerida
async function rdoRenderSugestoesEstacas(obraId){
  const box = $("csv-sugestoes");
  _csvSugestoes = {};
  if(!box) return;
  box.innerHTML = "";
  if(!obraId || !_csvParsed || typeof estNormalizarNome !== "function") return;
  const { data: ests } = await lerTudo(() => sb.from("estacas").select("id,numero,bloco").eq("obra_id", obraId));
  const lista = ests || [];
  if(!lista.length) return;
  const exatos = new Set(lista.map(e => normalizarNumeroEstaca(e.numero || "")));
  const porChave = {};
  lista.forEach(e => { const k = estNormalizarNome(e.numero); if(k) (porChave[k] = porChave[k] || []).push(e); });
  const nomes = [...new Set(Object.values(_csvParsed).flat().map(r => normalizarNumeroEstaca(r.estaca_numero || "")).filter(Boolean))];
  const linhas = [], ambiguas = [];
  nomes.forEach(n => {
    if(exatos.has(n)) return;
    const cands = porChave[estNormalizarNome(n)] || [];
    if(cands.length === 1){ _csvSugestoes[n] = { id: cands[0].id, numero: cands[0].numero }; linhas.push([n, cands[0]]); }
    else if(cands.length > 1) ambiguas.push([n, cands]);
  });
  if(!linhas.length && !ambiguas.length) return;
  box.innerHTML = `<div style="background:var(--info-bg);border-left:3px solid var(--marca-600);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
    💡 <strong>${linhas.length} estaca${linhas.length === 1 ? "" : "s"} do arquivo sem cadastro exato</strong> <span class="badge-alterado">sugestão</span>
    <div class="meta">O nome do arquivo fica como está; marque para vincular a execução à estaca cadastrada (prefixo, vírgula e zeros à esquerda ignorados; BB1.1 e B1.1 continuam estacas diferentes).</div>
    ${linhas.length ? `<table class="itens-tabela" style="margin-top:6px;"><thead><tr><th>No arquivo</th><th>No cadastro</th><th>Vincular</th></tr></thead><tbody>${linhas.map(([n, e]) => `<tr><td><code>${esc(n)}</code></td><td><strong>${esc(e.numero)}</strong>${e.bloco ? ` <span class="meta">· ${esc(e.bloco)}</span>` : ""}</td><td><input type="checkbox" data-sug="${esc(n)}" /></td></tr>`).join("")}</tbody></table>
    <label class="meta" style="display:inline-flex;gap:6px;align-items:center;margin-top:6px;cursor:pointer;"><input type="checkbox" id="csv-sug-todas" /> marcar todas</label>` : ""}
    ${ambiguas.length ? `<div class="meta" style="margin-top:6px;">⚠️ Sem sugestão (mais de uma estaca possível): ${ambiguas.map(([n, c]) => `<code>${esc(n)}</code> → ${c.map(e => esc(e.numero)).join(" / ")}`).join(" · ")}</div>` : ""}
  </div>`;
  $("csv-sug-todas")?.addEventListener("change", ev => box.querySelectorAll("input[data-sug]").forEach(cb => { cb.checked = ev.target.checked; }));
}
// sugestões marcadas na prévia: nome no arquivo -> estaca_id
function rdoSugestoesAceitas(){
  const out = {};
  document.querySelectorAll("#csv-sugestoes input[data-sug]:checked").forEach(cb => { const s = _csvSugestoes[cb.dataset.sug]; if(s) out[cb.dataset.sug] = s.id; });
  return out;
}

/* Vínculo estaca ↔ cadastro no import: número normalizado + agrupamento (bloco) quando
   o boletim trouxer. A trigger do banco só desempata por local; com bloco resolvido aqui
   ela recebe estaca_id pronto. Ambíguo (mesmo número em vários blocos, sem agrupamento) → null. */
function resolverEstacaImport(estacasObra, numero, agrupamento){
  const n = normalizarNumeroEstaca(numero || "");
  const cands = estacasObra.filter(e => normalizarNumeroEstaca(e.numero || "") === n);
  if(!cands.length) return null;
  if(cands.length === 1) return cands[0].id;
  const a = normalizarAgrupamento(agrupamento);
  if(a){
    const porBloco = cands.filter(e => normalizarAgrupamento(e.bloco) === a);
    if(porBloco.length === 1) return porBloco[0].id;
  }
  return null;
}

/* Pipeline CSV Geodigitus extraído de processarCSV (separado pra coexistir com SoftSaci) */
function parseCsvGeodigitus(linhas){
  const header = linhas[0].split(";").map(h => h.trim());
  const idx = {};
  header.forEach((h,i) => { idx[h.toUpperCase()] = i; });

  const obrigatorios = ["DATA","ESTACA"];
  for(const c of obrigatorios){
    if(!(c in idx)){ aviso("app-aviso",`Coluna obrigatória ausente no CSV: ${c}`,"erro"); return null; }
  }

  // Mapeia máquinas: prioridade codigo_externo > codigo > nome
  const mapaMaq = {};
  _rdoEquipsCache.forEach(e => {
    if(e.codigo_externo){
      mapaMaq[e.codigo_externo.toUpperCase()] = e.id;
    }
  });
  // Fallback secundário (sem sobrescrever match por codigo_externo)
  _rdoEquipsCache.forEach(e => {
    const codes = [e.codigo, e.codigo.replace(/\s/g,""), e.codigo.replace(/-/g,""), e.nome];
    codes.forEach(c => {
      if(c){
        const k = c.toUpperCase();
        if(!(k in mapaMaq)) mapaMaq[k] = e.id;
      }
    });
  });

  const registros = [];
  for(let i = 1; i < linhas.length; i++){
    const partes = parseCSVLine(linhas[i]);
    if(partes.length < 3) continue;
    const dataStr = partes[idx["DATA"]]?.replace(/^"|"$/g,"").trim();
    if(!dataStr) continue;
    const dataDia = dataStr.split(" ")[0]; // YYYY-MM-DD
    const maq = partes[idx["MAQUINA"]]?.replace(/^"|"$/g,"").trim() || "";
    const equipId = mapaMaq[maq.toUpperCase()] || (rdoCasarMaquina(maq) || {}).id || null;   // lote S42: apelidos TAG-NN
    const obraCsv = idx["OBRA"] != null ? (partes[idx["OBRA"]]?.replace(/^"|"$/g,"").trim() || "") : "";
    const estacaRaw = partes[idx["ESTACA"]]?.replace(/^"|"$/g,"").trim() || "";
    const refInfoCsv = detectarRefuro(normalizarNumeroEstaca(estacaRaw));
    registros.push({
      data_dia: dataDia,
      obra_csv: obraCsv,
      estaca_numero: refInfoCsv.nomeBase,
      modalidade_execucao: refInfoCsv.isRefuro ? "refuro" : "furo_normal",
      profundidade_executada: parseNum(partes[idx["PROFUNDIDADE_EXECUTADA"]]),
      profundidade_projeto: parseNum(partes[idx["PROFUNDIDADE_PROJETO"]]),
      perfuracao_inicio: parseDataBR(partes[idx["PERFURACAO_INICIO"]]),
      perfuracao_fim:    parseDataBR(partes[idx["PERFURACAO_FIM"]]),
      concretagem_inicio: parseDataBR(partes[idx["CONCRETAGEM_INICIO"]]),
      concretagem_fim:    parseDataBR(partes[idx["CONCRETAGEM_FIM"]]),
      torque: parseNum(partes[idx["TORQUE"]]),
      volume_concreto_m3: parseNum(partes[idx["VOLUME_CONCRETO"]]),
      diametro_mm: parseNum(partes[idx["DIAMETRO"]]),
      maquina_codigo: maq,
      equipamento_id: equipId,
      observacoes: partes[idx["OBSERVACAO"]]?.replace(/^"|"$/g,"").trim() || null
    });
  }

  return registros;
}

/* Pipeline comum após o parsing (Geodigitus ou SoftSaci):
   agrupa por dia, detecta obra/tipo/máquinas, renderiza preview. */
async function continuarProcessamentoImport(registros, obraTxtFonte, formato){
  // Agrupa por data_dia
  const porDia = {};
  registros.forEach(r => {
    if(!porDia[r.data_dia]) porDia[r.data_dia] = [];
    porDia[r.data_dia].push(r);
  });
  _csvParsed = porDia;

  // Detecta obra a partir do texto da fonte (Geodigitus: campo OBRA, SoftSaci: 2ª coluna)
  const obraCSV = obraTxtFonte || registros[0]?.obra_csv || "";
  _csvObraDetectada = detectarObraPeloNome(obraCSV);

  // Detecta tipo de serviço
  _csvTipoDetectado = detectarTipoServico(registros);
  // fase 101: máquinas da obra (da ficha ou detectada) vêm primeiro nos selects e orientam a sugestão
  await rdoCarregarMaqObraImport($("rdo-obra")?.value || (_csvObraDetectada && _csvObraDetectada.id) || null);

  // Detecta máquinas (códigos únicos no CSV) sem match em equipamentos
  const maquinasNoCSV = [...new Set(registros.map(r => (r.maquina_codigo||"").trim()).filter(Boolean))];
  _csvMaquinasSemMatch = maquinasNoCSV.filter(m => !registros.find(r => r.maquina_codigo === m && r.equipamento_id));
  _csvMapaManual = {};  // codigo CSV -> equipamento_id escolhido manualmente

  // Preview
  const dias = [...new Set([...Object.keys(porDia), ...Object.entries(_iaExtras || {}).filter(([, ex]) => ex && ex.sem_estacas).map(([d]) => d)])].sort().reverse();
  const totalEstacas = registros.length;

  // Bloco de identificação de obra
  let blocoObra = "";
  if(_csvObraDetectada && _csvObraDetectada.casamento === "exato"){
    blocoObra = `<div style="background:var(--sucesso-bg);border-left:3px solid var(--sucesso);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
      ✅ <strong>Obra identificada automaticamente:</strong> ${esc(_csvObraDetectada.nome)}
      <div style="font-size:var(--txt-xs);color:var(--txt-fraco);margin-top:2px;">CSV trouxe "${esc(obraCSV)}" — casamento exato.</div>
    </div>`;
  } else if(_csvObraDetectada){
    blocoObra = `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
      ⚠️ <strong>Obra identificada (casamento parcial):</strong>
      <div style="margin-top:6px;">
        CSV: "${esc(obraCSV)}" → cadastrada: <strong>${esc(_csvObraDetectada.nome)}</strong>
      </div>
      <div style="margin-top:6px;">
        <label class="meta">Confirme a obra ou escolha outra:</label>
        <select id="csv-obra-select" style="width:100%;margin-top:4px;"></select>
      </div>
    </div>`;
  } else {
    blocoObra = `<div style="background:var(--perigo-bg);border-left:3px solid var(--perigo);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
      ❌ <strong>Obra não identificada</strong> — o CSV trouxe "${esc(obraCSV)}" mas não casa com nenhuma obra cadastrada.
      <div style="margin-top:6px;">
        <label class="meta">Escolha a obra manualmente:</label>
        <select id="csv-obra-select" style="width:100%;margin-top:4px;"></select>
      </div>
    </div>`;
  }

  // Bloco de tipo de serviço
  const blocoTipo = `<div style="background:var(--sup-2);border-left:3px solid var(--marca-600);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
    🔧 <strong>Tipo de serviço detectado:</strong> ${esc((TIPO_SERVICO[_csvTipoDetectado]||{}).label || _csvTipoDetectado)}
    <div style="margin-top:6px;">
      <label class="meta">Confirme ou altere:</label>
      <select id="csv-tipo-select" style="width:100%;margin-top:4px;">
        ${Object.entries(TIPO_SERVICO).map(([v,o]) => `<option value="${esc(v)}" ${v===_csvTipoDetectado?"selected":""}>${esc(o.icone)} ${esc(o.label)}</option>`).join("")}
      </select>
    </div>
  </div>`;

  // Bloco de mapeamento de máquinas (códigos sem match)
  let blocoMaq = "";
  if(_csvMaquinasSemMatch.length){
    const equipOpts = '<option value="">— escolha o equipamento —</option>' + rdoOptsMaquinas(_csvMaqObraIds, null);
    // fase 101 (#85): sugestão pela TAG do texto (exata quando o número bate, senão a mais próxima); nunca pré-seleciona
    const linhasMaq = _csvMaquinasSemMatch.map(maq => {
      const sug = typeof eqCasarTexto === "function" ? eqCasarTexto(maq, _rdoEquipsCache, _csvMaqObraIds) : null;
      const alvo = sug && (sug.exato || sug.proximo);
      return `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
        <code style="background:var(--sup-0);padding:2px 8px;border-radius:3px;border:1px solid var(--borda-forte);min-width:80px;text-align:center;"><strong>${esc(maq)}</strong></code>
        <span style="color:var(--txt-fraco);font-size:var(--txt-xs);">→</span>
        <select class="csv-maq-select" data-maq="${esc(maq)}" style="flex:1;min-width:240px;">${equipOpts}</select>
        ${alvo ? `<button type="button" class="btn-sec btn-sm csv-maq-usar" data-maq="${esc(maq)}" data-eq="${esc(alvo.id)}" title="${sug.exato ? "O número do documento bate com esta TAG" : "Nenhuma TAG com esse número: esta é a mais próxima"}${_csvMaqObraIds.includes(alvo.id) ? " (máquina da obra)" : ""}. Confira antes de usar.">${esc(eqSugestaoTxt(sug))} · usar</button>` : ""}
        <label style="font-size:var(--txt-xs);color:var(--txt-fraco);display:flex;align-items:center;gap:4px;">
          <input type="checkbox" class="csv-maq-salvar" data-maq="${esc(maq)}"${_csvMaqEstrito ? "" : " checked"} />
          Salvar como código externo
        </label>
      </div>`; }).join("");
    blocoMaq = `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
      ⚠️ <strong>${_csvMaquinasSemMatch.length} máquina${_csvMaquinasSemMatch.length>1?'s':''} ${_csvMaqEstrito ? "do documento a confirmar" : "sem equipamento cadastrado"}:</strong>
      <div style="font-size:var(--txt-xs);color:var(--txt-fraco);margin-top:2px;">${_csvMaqEstrito
        ? "A leitura por IA não vincula a máquina sozinha: confira a sugestão (💡) e clique em \"usar\", ou escolha outra TAG. As máquinas da obra vêm primeiro na lista."
        : "Vincule cada código do CSV ao equipamento correspondente. Marque \"salvar\" para o sistema reconhecer automaticamente nas próximas importações."}</div>
      <div style="margin-top:10px;">${linhasMaq}</div>
    </div>`;
  }

  const fmtLbl = formato === "softsaci"
    ? "📄 <strong>Formato detectado:</strong> SoftSaci V7.x (TXT colunas fixas)"
    : formato === "ia_pdf" ? "🤖 <strong>Lido por IA</strong> de um PDF — confira a tabela abaixo antes de importar"
    : formato === "ia_foto" ? "🤖 <strong>Lido por IA</strong> de uma foto/scan — confira a tabela abaixo antes de importar"
    : formato === "xlsx_maya" ? "📊 <strong>Planilha do Maya</strong> (Relatório Diário .xlsx) — estacas, observações e ocorrências; confira a tabela abaixo antes de importar"
    : formato === "xlsx_rg113" ? "📊 <strong>Planilha RG 11.3</strong> (diário de estaca raiz .xlsx, aba SEPARADOS) — trechos, injeção, atividades hora a hora e equipe; confira a tabela abaixo antes de importar"
    : "📄 <strong>Formato detectado:</strong> Geodigitus (CSV)";
  const blocoFormato = `<div style="background:#eef2f6;border-left:3px solid var(--txt-fraco);padding:8px 12px;margin-bottom:10px;font-size:var(--txt-xs);color:#495057;">${fmtLbl}</div>`;

  // fase 94 (#77): um diário por dia e máquina; linhas sem máquina identificada avisam e podem receber uma máquina aqui
  const semMaq = registros.filter(r => !r.equipamento_id && !(r.maquina_codigo && _csvMaquinasSemMatch.includes(r.maquina_codigo))).length;
  const blocoSemMaq = semMaq ? `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
      ⚠️ <strong>${semMaq} linha${semMaq>1?"s":""} sem máquina identificada</strong> — vão para o diário sem máquina do dia (que entra em "Para regularizar"), a menos que você escolha a máquina:
      <select id="csv-maq-sem" style="width:100%;margin-top:6px;"><option value="">— deixar sem máquina —</option>${rdoOptsMaquinas(_csvMaqObraIds, _csvMaqSugerida && !_csvMaqEstrito ? _csvMaqSugerida.id : null)}</select>
      ${_csvMaqSugerida ? `<div class="meta">Sugerida: ${esc(_csvMaqSugerida.codigo)} (única mobilização ativa da obra).${_csvMaqEstrito ? ` <button type="button" class="btn-sec btn-sm" id="csv-maq-sem-usar" data-eq="${esc(_csvMaqSugerida.id)}">usar</button>` : ""}</div>` : ""}
    </div>` : "";
  const nDiarios = rdoDiariosImport().length;
  // lote S44 (L5, #78): sugestões de vínculo estaca do arquivo ↔ cadastro entram aqui (rdoRenderSugestoesEstacas)
  let html = blocoFormato + blocoObra + blocoTipo + blocoMaq + blocoSemMaq + `<div id="csv-sugestoes"></div>` + `<div style="background:var(--info-bg);border-left:3px solid var(--marca-600);padding:10px 14px;margin-bottom:10px;font-size:var(--txt-sm);">
    📊 <strong>${totalEstacas}</strong> estacas em <strong>${dias.length}</strong> dia${dias.length>1?"s":""} — vão gerar <strong id="csv-n-diarios">${nDiarios}</strong> diário${nDiarios>1?"s":""} (um por dia e máquina).
    Total metragem: <strong>${num(registros.reduce((s,r) => s + (r.profundidade_executada||0), 0))} m</strong>.
    Total concreto: <strong>${num(registros.reduce((s,r) => s + (r.volume_concreto_m3||0), 0))} m³</strong>.
  </div>`;
  dias.forEach(d => {
    const ests = porDia[d] || []; // dia só com ocorrência (planilha do Maya) não tem estacas
    html += `<div style="margin-bottom:8px;border:1px solid var(--borda-forte);border-radius:4px;padding:8px 10px;">
      <div style="font-weight:600;font-size:var(--txt-sm);color:var(--acao-txt);">📅 ${dataBR(rdoDiaData(d))}${rdoDiaTurno(d) === "noturno" ? " · noturno" : ""} — ${ests.length ? `${ests.length} estaca${ests.length>1?"s":""}` : "sem estacas (só ocorrência/equipe)"} <span class="meta csv-maq-dia" data-dia="${esc(d)}" style="font-weight:400;">${ests.length ? "· " + rdoResumoMaquinasDia(d) : ""}</span></div>
      <div class="meta">${ests.map(e=>esc(e.estaca_numero)).slice(0,10).join(", ")}${ests.length>10?` +${ests.length-10}`:""}</div>
    </div>`;
  });
  $("csv-preview-conteudo").innerHTML = html;
  $("csv-preview").style.display = "";

  // Popula select de obras (se foi renderizado)
  const selObra = $("csv-obra-select");
  if(selObra){
    const obrasArr = Object.entries(mapaObras).map(([id, nome]) => ({ id, nome }))
      .sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
    selObra.innerHTML = `<option value="">— selecione —</option>` +
      obrasArr.map(o => `<option value="${esc(o.id)}" ${_csvObraDetectada && o.id===_csvObraDetectada.id?"selected":""}>${esc(o.nome)}</option>`).join("");
    selObra.addEventListener("change", () => rdoRenderSugestoesEstacas(selObra.value));   // lote S44 (L5)
  }
  // fase 94: trocar a máquina das linhas sem máquina refaz a contagem de diários e o resumo por dia
  const recontarDiarios = () => {
    const n = rdoDiariosImport().length;
    if($("csv-n-diarios")) $("csv-n-diarios").textContent = n;
    document.querySelectorAll(".csv-maq-dia").forEach(el => { const r = rdoResumoMaquinasDia(el.dataset.dia); el.innerHTML = r ? "· " + r : ""; });
  };
  $("csv-maq-sem")?.addEventListener("change", recontarDiarios);
  $("csv-maq-sem-usar")?.addEventListener("click", (ev) => { $("csv-maq-sem").value = ev.target.dataset.eq; recontarDiarios(); });
  // fase 101 (#85): a máquina escolhida (ou a sugestão confirmada com "usar") já vale para a contagem de diários
  document.querySelectorAll(".csv-maq-select").forEach(sel => sel.addEventListener("change", () => {
    if(sel.value) _csvMapaManual[sel.dataset.maq] = sel.value; else delete _csvMapaManual[sel.dataset.maq];
    recontarDiarios();
  }));
  document.querySelectorAll(".csv-maq-usar").forEach(b => b.addEventListener("click", () => {
    const sel = document.querySelector(`.csv-maq-select[data-maq="${CSS.escape(b.dataset.maq)}"]`);
    if(!sel) return;
    sel.value = b.dataset.eq; sel.dispatchEvent(new Event("change"));
    b.textContent = "✓ " + b.textContent.replace(/^💡\s*/, "").replace(/ · usar$/, ""); b.disabled = true;
  }));
  // lote S44 (L5, #78): sugestões de vínculo para a obra já conhecida (o import por IA refaz ao pré-selecionar a obra da ficha)
  rdoRenderSugestoesEstacas(selObra ? selObra.value : (_csvObraDetectada && _csvObraDetectada.casamento === "exato" ? _csvObraDetectada.id : null));

  aviso("app-aviso", registros.length
    ? `${registros.length} estacas extraídas. Confirme obra e tipo antes de importar.`
    : `${dias.length} dia(s) sem estacas (só ocorrência/equipe). Confirme obra e tipo antes de importar.`, "ok");
}

function parseCSVLine(linha){
  // Handle CSV com aspas
  const result = [];
  let curr = "";
  let inQuotes = false;
  for(let i = 0; i < linha.length; i++){
    const c = linha[i];
    if(c === '"'){
      inQuotes = !inQuotes;
      curr += c;
    } else if(c === ";" && !inQuotes){
      result.push(curr);
      curr = "";
    } else {
      curr += c;
    }
  }
  result.push(curr);
  return result;
}

/* fase 107a: grava as execuções do import uma a uma pela RPC rdo_import_execucao_conciliar (regra 1: o Geodigitus é a fonte
   primária de hélice e secante; o Maya, o CSV e a IA complementam). Devolve os ids alinhados às linhas (null = não inserida).
   Sem a migration da 107a (RPC inexistente), cai no insert em lote de antes. */
async function rdoGravarExecucoesImport(rdoId, exs, dia){
  const out = { ids: [], inseridas: 0, puladasGeo: 0, conciliadas: 0 };
  for(const linha of exs){
    const { rdo_id, ...resto } = linha;
    const { data, error } = await sb.rpc("rdo_import_execucao_conciliar", { p_rdo: rdoId, p_linha: resto });
    if(error){
      if(["PGRST202", "42883"].includes(error.code) && !out.ids.length){
        const r = await sb.from("rdo_execucao_estaca").insert(exs).select("id");
        if(r.error) throw new Error(`Execuções de ${dia}: ${r.error.message}`);
        return { ids: (r.data || []).map(x => x.id), inseridas: exs.length, puladasGeo: 0, conciliadas: 0 };
      }
      throw new Error(`Estaca ${linha.estaca_numero || "?"} de ${dia}: ${error.message}`);
    }
    if(data?.acao === "inserida"){ out.ids.push(data.id); out.inseridas++; }
    else { out.ids.push(null); if(data?.acao === "pulada_geodigitus") out.puladasGeo++; else out.conciliadas++; }
  }
  return out;
}

/* lote S57 (#220) / fase 173b: rdoRg113ConciliarExistentes (conciliação do RG 11.3 por diário) está em js/rdo_import_rg113.js */
/* fase 129c: import (Maya, CSV, SoftSaci, IA) sobre um diário que já existe. A execução do arquivo com o mesmo número (e a mesma
   modalidade) de uma lançada pelo app do campo nesse diário não vira uma segunda linha: a do app só recebe o que está vazio nela.
   Um para um: cada linha do app casa uma vez só, então dois trechos da mesma estaca raiz no arquivo contra um no app dão duas linhas,
   como antes. Linhas de outras origens seguem para a RPC rdo_import_execucao_conciliar (que pula a do Geodigitus). */
const RDO_CAMPOS_COMPLETAR = ["estaca_id", "diametro_mm", "profundidade_projeto", "profundidade_executada", "perfuracao_de_m", "perfuracao_ate_m",
  "perfuracao_inicio", "perfuracao_fim", "concretagem_inicio", "concretagem_fim", "torque", "volume_concreto_m3", "inclinacao",
  "numero_boletim_fisico", "equipamento_id", "maquina_codigo", "consumo_cimento_raiz", "consumo_cimento_unidade", "consumo_areia_raiz",
  "consumo_areia_unidade", "pressao_injecao_kgcm2", "volume_injetado_m3", "agua_l"];
async function rdoConciliarComCampo(rdoId, exs, ests, dia, jaFeitas){
  const out = { indices: new Set(), conciliadas: 0, trechos: 0 };
  const { data: app, error } = await sb.from("rdo_execucao_estaca")
    .select("id,estaca_numero,estaca_numero_corrigido,modalidade_execucao,observacoes," + RDO_CAMPOS_COMPLETAR.join(","))
    .eq("rdo_id", rdoId).eq("origem_dados", "app_operador");
  if(error) throw new Error(`Execuções do campo em ${dia}: ${error.message}`);
  if(!app || !app.length) return out;
  const chave = (n, m) => normalizarNumeroEstaca(n || "") + "|" + (m || "furo_normal");
  const usadas = new Set();
  for(let i = 0; i < exs.length; i++){
    if(jaFeitas && jaFeitas.has(i)) continue;
    const x = exs[i];
    const alvo = app.find(a => !usadas.has(a.id) && chave(a.estaca_numero_corrigido || a.estaca_numero, a.modalidade_execucao) === chave(x.estaca_numero, x.modalidade_execucao));
    if(!alvo) continue;
    usadas.add(alvo.id);
    const upd = {};
    RDO_CAMPOS_COMPLETAR.forEach(c => { if((alvo[c] == null || alvo[c] === "") && x[c] != null && x[c] !== "") upd[c] = x[c]; });
    if(x.observacoes && !String(alvo.observacoes || "").includes(x.observacoes)) upd.observacoes = alvo.observacoes ? alvo.observacoes + "\n" + x.observacoes : x.observacoes;
    if(Object.keys(upd).length){
      const { error: eUp } = await sb.from("rdo_execucao_estaca").update(upd).eq("id", alvo.id);
      if(eUp) throw new Error(`Estaca ${x.estaca_numero} de ${dia} (lançada no campo): ${eUp.message}`);
    }
    const trechos = (ests[i] && ests[i].trechos) || [];
    if(trechos.length){
      const { count } = await sb.from("rdo_raiz_solo").select("id", { count: "exact", head: true }).eq("execucao_id", alvo.id);
      if(count === 0){
        const { error: eSolo } = await sb.from("rdo_raiz_solo").insert(trechos.map((t, ti) => ({ rdo_id: rdoId, execucao_id: alvo.id, ordem: ti + 1,
          inicio_ml: t.de ?? null, final_ml: t.ate ?? null, classificacao: t.solo || null, ferramenta: t.ferramenta || null })));
        if(eSolo) console.warn(`Trechos de ${x.estaca_numero} de ${dia} não gravados:`, eSolo.message);
        else out.trechos += trechos.length;
      }
    }
    out.indices.add(i); out.conciliadas++;
  }
  return out;
}
/* fase 129c: ocorrências do Relatório Diário do Maya → ocorrencias (origem 'maya'). Reimportar o mesmo arquivo não duplica
   (mesma descrição e mesmo início no diário). Período só vai inteiro (início sem fim abriria uma parada "em andamento").
   O motivo sai do texto quando ele é claro; senão fica nulo e a descrição leva o tipo do Maya. Se o banco recusar
   (perfil que importa diário mas não grava ocorrências), o texto volta às observações do diário, como antes da 129c. */
const RDO_MAYA_MOTIVO = [[/chuv/, "chuva"], [/manuten|quebr|mecanic/, "manutencao"], [/libera/, "aguardando_liberacao"],
  [/locac/, "aguardando_locacao"], [/concret|argamass/, "aguardando_concreto_argamassa"], [/frente/, "aguardando_frente"],
  [/prepar/, "preparacao"], [/desloc|mudanca de (plato|frente)/, "deslocamento_interno"]];
async function rdoGravarParadasImport(rdoId, obraId, diaData, eqId, paradas, dia){
  const out = { gravadas: 0, texto: 0 };
  const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const descr = (p) => { const d = String(p.descricao || "").trim(), t = String(p.tipo || "").trim();
    return (t && d && norm(d) !== norm(t) ? `${t}: ${d}` : (d || t)) || "Ocorrência do Maya"; };
  const chave = (d, ini) => norm(d).trim() + "|" + String(ini || "").slice(0, 5);
  const { data: ja } = await sb.from("ocorrencias").select("descricao,periodo_inicio").eq("rdo_id", rdoId);
  const vistos = new Set((ja || []).map(o => chave(o.descricao, o.periodo_inicio)));
  const linhas = [];
  paradas.forEach(p => {
    const inteiro = !!(p.periodo_inicio && p.periodo_fim);
    const desc = descr(p), k = chave(desc, inteiro ? p.periodo_inicio : null);
    if(vistos.has(k)) return;
    vistos.add(k);
    const alvo = norm((p.tipo || "") + " " + (p.descricao || ""));
    const mot = (RDO_MAYA_MOTIVO.find(([re]) => re.test(alvo)) || [])[1] || null;
    linhas.push({ obra_id: obraId, rdo_id: rdoId, data: diaData, status: "resolvida", descricao: desc, origem: "maya",
      tipo: mot === "chuva" ? "clima" : (p.paralisado ? "paralisacao" : "outro"), motivo: mot,
      // fase 166: o valor vai como veio; em branco na planilha fica nulo (não informado), nunca "não". Para o tipo, nulo conta como não paralisado.
      paralisado: paradaBool(p.paralisado), em_razao_cliente: paradaBool(p.em_razao_cliente),
      periodo_inicio: inteiro ? p.periodo_inicio : null, periodo_fim: inteiro ? p.periodo_fim : null, equipamento_id: eqId || null });
  });
  if(!linhas.length) return out;
  const { error } = await sb.from("ocorrencias").insert(linhas);
  if(!error){ out.gravadas = linhas.length; return out; }
  console.warn("Ocorrências de " + dia + " não gravadas na tabela (vão para as observações):", error.message);
  const { data: r } = await sb.from("rdo").select("observacoes").eq("id", rdoId).maybeSingle();
  const atual = String(r?.observacoes || "");
  const novos = paradas.map(p => p.texto).filter(t => t && !atual.includes(t));
  if(novos.length){
    const { error: eObs } = await sb.from("rdo").update({ observacoes: [atual || null, ...novos].filter(Boolean).join("\n") }).eq("id", rdoId);
    if(eObs) console.warn("Observações de " + dia + " não gravadas:", eObs.message);
    else out.texto = novos.length;
  }
  return out;
}
/* lote S57 (#220): rdo_raiz_dados (1 por diário) recebe local e bloco da planilha; o que já está preenchido fica */
async function rdoCompletarRaizDados(rdoId, rd, dia){
  const { data: atual, error } = await sb.from("rdo_raiz_dados").select("id,local_obra,bloco").eq("rdo_id", rdoId).maybeSingle();
  if(error){ console.warn("Dados da raiz de " + dia + ":", error.message); return; }
  if(!atual){
    const { error: eIns } = await sb.from("rdo_raiz_dados").insert({ rdo_id: rdoId, local_obra: rd.local_obra || null, bloco: rd.bloco || null });
    if(eIns) console.warn("Dados da raiz de " + dia + " não gravados:", eIns.message);
    return;
  }
  const upd = {};
  if(!atual.local_obra && rd.local_obra) upd.local_obra = rd.local_obra;
  if(!atual.bloco && rd.bloco) upd.bloco = rd.bloco;
  if(Object.keys(upd).length){
    const { error: eUp } = await sb.from("rdo_raiz_dados").update(upd).eq("id", atual.id);
    if(eUp) console.warn("Dados da raiz de " + dia + " não completados:", eUp.message);
  }
}

async function confirmarImportCSV(){
  if(!_csvParsed){ aviso("app-aviso","Processe o arquivo primeiro.","erro"); return; }
  lerConferenciaIA(); // import por IA: o que está na tabela de conferência é o que vale
  if(!diasImportacao().length){ aviso("app-aviso","Nenhuma linha para importar.","erro"); return; }

  // Obra: pega do select do preview se houver, senão da obra detectada exata
  let obra_id = null;
  const selObra = $("csv-obra-select");
  if(selObra) obra_id = selObra.value;
  else if(_csvObraDetectada && _csvObraDetectada.casamento === "exato") obra_id = _csvObraDetectada.id;
  if(!obra_id){
    aviso("app-aviso","Selecione a obra no preview antes de importar.","erro");
    return;
  }

  // Tipo: pega do select do preview, senão do detectado
  const tipo = $("csv-tipo-select")?.value || _csvTipoDetectado || "helice_continua";
  // chamado #30: responsavel_id tem FK para profiles; o RDO importado fica em nome de quem importou
  const responsavel = usuarioAtual?.id || null;

  // Coleta mapeamentos manuais de máquinas (selects + checkboxes)
  _csvMapaManual = {};
  _csvSalvarMapeamento = {};
  document.querySelectorAll(".csv-maq-select").forEach(sel => {
    const maq = sel.dataset.maq;
    if(sel.value){
      _csvMapaManual[maq] = sel.value;
    }
  });
  document.querySelectorAll(".csv-maq-salvar").forEach(cb => {
    _csvSalvarMapeamento[cb.dataset.maq] = cb.checked;
  });

  const semMatch = _csvMaquinasSemMatch.filter(m => !_csvMapaManual[m]);
  if(semMatch.length){
    if(!confirm(`Atenção: ${semMatch.length} máquina(s) sem equipamento vinculado (${semMatch.join(", ")}).\nElas serão importadas só com o código texto. Continuar mesmo assim?`)) return;
  }

  // fase 94 (#77): um diário por dia e máquina (as máquinas resolvidas acima entram na chave)
  const gruposPrev = rdoDiariosImport();
  const semMaqPrev = gruposPrev.filter(g => !g.eq && g.linhas.length).length;
  // fase 101 (#85): obra que exige máquina não aceita diário sem ela (o gatilho recusaria no meio da gravação)
  const semMaqTodos = gruposPrev.filter(g => !g.eq).length;
  // fase 155a: obra de um turno não tem diário noturno; o noturno da planilha entra no diurno do dia (sem a coluna, nada muda)
  const { data: oEx, error: eEx } = await sb.from("obras").select("rdo_exige_equipamento,dois_turnos").eq("id", obra_id).maybeSingle();
  const obraDoisTurnos = eEx ? true : !!oEx?.dois_turnos;
  const noturnosNoDiurno = obraDoisTurnos ? 0 : gruposPrev.filter(g => rdoDiaTurno(g.dia) === "noturno").length;
  if(semMaqTodos){
    if(!eEx && oEx?.rdo_exige_equipamento){
      aviso("app-aviso", `Esta obra exige a máquina do diário: ${semMaqTodos} diário(s) ficariam sem máquina. Confirme a TAG no bloco de máquinas (💡 usar) ou escolha a máquina das linhas sem máquina.`, "erro");
      if($("csv-aviso")) aviso("csv-aviso", "Obra exige máquina: escolha a TAG antes de importar.", "erro");
      return;
    }
  }
  if(!confirm(`Importar ${Object.values(_csvParsed).reduce((s,v) => s+v.length, 0)} estacas em ${diasImportacao().length} dia(s) como ${TIPO_SERVICO[tipo]?.label || tipo}?\n${gruposPrev.length} diário(s), um por dia e máquina${semMaqPrev ? ` — ${semMaqPrev} sem máquina (vão para "Para regularizar")` : ""}.${noturnosNoDiurno ? `\n⚠️ ${noturnosNoDiurno} diário(s) noturno(s) da planilha entram no diurno do mesmo dia: a obra trabalha em um turno (Obra › Parâmetros).` : ""}`)) return;

  const btn = $("btn-csv-confirmar");
  btn.disabled = true;
  const txt = btn.textContent;
  btn.textContent = "Importando...";

  try {
    // 1. Salva codigo_externo nos equipamentos marcados
    for(const [maq, equipId] of Object.entries(_csvMapaManual)){
      if(_csvSalvarMapeamento[maq]){
        const { error } = await sb.from("equipamentos").update({
          codigo_externo: maq,
          codigo_externo_origem: "geodigitus"
        }).eq("id", equipId);
        if(error){
          console.warn("Não foi possível salvar codigo_externo de "+maq+":", error.message);
        } else {
          // Atualiza cache local
          const e = _rdoEquipsCache.find(x => x.id === equipId);
          if(e){ e.codigo_externo = maq; }
        }
      }
    }
    // Estacas cadastradas na obra: vínculo por número + agrupamento (bloco) feito aqui
    const { data: estacasObra } = await lerTudo(() => sb.from("estacas").select("id,numero,bloco,local").eq("obra_id", obra_id));
    const estsObra = estacasObra || [];
    // lote S46 (#96): execução importada sem Ø recebe o Ø do serviço da obra quando ele é único
    const diamsServ = await rdoDiametrosServico(obra_id, tipo);
    const diamUnico = diamsServ.length === 1 ? diamsServ[0] : null;
    const sugAceitas = rdoSugestoesAceitas();   // lote S44 (L5, #78): só as sugestões marcadas na prévia viram vínculo
    const dias = diasImportacao();
    // fase 94 (#77): um diário por dia e máquina. Equipe, observações, atividades e abastecimento sem máquina
    // ficam no diário "principal" do dia (a máquina com mais linhas; sem máquina só se não houver outra).
    const grupos = rdoDiariosImport();
    const principalDoDia = {};
    grupos.forEach(g => {
      const atual = principalDoDia[g.dia];
      if(!atual || g.linhas.length > atual.n || (g.linhas.length === atual.n && g.eq && !atual.eq)) principalDoDia[g.dia] = { k: g.eq || "", eq: g.eq, n: g.linhas.length };
    });
    let totalRdos = 0, totalExecs = 0, totalTrechos = 0, totalAtiv = 0, totalSemMaq = 0, totalGeo = 0, totalConc = 0;
    let totalParadas = 0, totalParadasTexto = 0;   // fase 129c
    for(const g of grupos){
      const dia = g.dia, ests = g.linhas, eqId = g.eq;
      // fase 134b: a chave do dia leva o período; o diário é procurado por obra + data + tipo + máquina + período
      const diaData = rdoDiaData(dia), turnoDia = obraDoisTurnos ? rdoDiaTurno(dia) : "diurno";   // fase 155a
      const porTurno = (q) => turnoDia === "noturno" ? q.eq("turno_campo", "noturno") : q.or("turno_campo.is.null,turno_campo.eq.diurno");
      const ehPrincipal = (principalDoDia[dia] || {}).k === (eqId || "");
      // Upsert do RDO (cria se não existe): chave obra + data + tipo + máquina + período. Com dois diários no dia o maybeSingle
      // falharia sem o período na busca.
      let qEx = porTurno(sb.from("rdo").select("id").eq("obra_id", obra_id).eq("data", diaData).eq("tipo_servico", tipo));
      qEx = eqId ? qEx.eq("equipamento_id", eqId) : qEx.is("equipamento_id", null);
      let { data: rdoExist } = await qEx.maybeSingle();
      // lote S57 (#220): no RG 11.3, o diário do dia lido antes (PDF) sem máquina é o mesmo diário da TAG da planilha:
      // reaproveita e completa a máquina, em vez de abrir um segundo diário no dia
      if(!rdoExist && eqId && _iaOrigem === "xlsx_rg113"){
        const { data: rdoSemMaqDia } = await porTurno(sb.from("rdo").select("id").eq("obra_id", obra_id).eq("data", diaData).eq("tipo_servico", tipo)).is("equipamento_id", null).limit(1);
        if(rdoSemMaqDia && rdoSemMaqDia.length){
          rdoExist = rdoSemMaqDia[0];
          const { error: eMaq } = await sb.from("rdo").update({ equipamento_id: eqId }).eq("id", rdoExist.id).is("equipamento_id", null);
          if(eMaq) console.warn("Máquina do diário de " + dia + " não completada:", eMaq.message);
        }
      }
      let rdoId;
      if(rdoExist){
        rdoId = rdoExist.id;
      } else {
        const ex = _iaExtras?.[dia];
        const reg = {
          obra_id, data: diaData, tipo_servico: tipo, equipamento_id: eqId,
          turno_campo: turnoDia,   // fase 134b
          status: "rascunho", responsavel_id: responsavel,
          producao_dia_m: ests.reduce((s,e) => s + (e.profundidade_executada||0), 0),
          ...(ex && ehPrincipal ? {
            tempo_manha: ex.tempo_manha || null, tempo_tarde: ex.tempo_tarde || null,
            atividades: ex.atividades || null,
            feriado: !!ex.feriado,
            observacoes: [ex.observacoes, ex.responsavel ? "Responsável no diário: " + ex.responsavel : null].filter(Boolean).join("\n") || null,
            // chamado #6: boletim sem efetivo = 0 (coluna NOT NULL default 0; null explícito quebrava o insert).
            // Regra da varredura de 16/09: nunca mandar null para coluna NOT NULL com default — ou o valor, ou omitir a chave.
            efetivo_proprio: ex.equipe.length,
            efetivo_terceiro: 0
          } : {})
        };
        const { data: novo, error } = await sb.from("rdo").insert(reg).select("id").single();
        if(error){ throw new Error(`Dia ${dia}: ${error.message}`); }
        rdoId = novo.id;
        totalRdos++;
        if(!eqId && ests.length) totalSemMaq++;
      }
      // Insere execuções (aplicando mapa manual de máquinas)
      const exs = ests.map(e => {
        let equipId = e.equipamento_id;
        if(!equipId && e.maquina_codigo && _csvMapaManual[e.maquina_codigo]){
          equipId = _csvMapaManual[e.maquina_codigo];
        }
        return {
          rdo_id: rdoId,
          estaca_id: resolverEstacaImport(estsObra, e.estaca_numero, e.agrupamento) || sugAceitas[normalizarNumeroEstaca(e.estaca_numero || "")] || null,
          estaca_numero: e.estaca_numero,
          diametro_mm: Number(e.diametro_mm) > 0 ? e.diametro_mm : diamUnico,
          profundidade_projeto: e.profundidade_projeto,
          profundidade_executada: e.profundidade_executada,
          perfuracao_de_m: e.perfuracao_de_m ?? null,
          perfuracao_ate_m: e.perfuracao_ate_m ?? null,
          inclinacao: e.inclinacao || null,
          consumo_cimento_raiz: e.consumo_cimento_raiz || null,
          consumo_cimento_unidade: e.consumo_cimento_raiz ? "saco" : null,
          consumo_areia_raiz: e.consumo_areia_raiz || null,
          consumo_areia_unidade: e.consumo_areia_raiz ? (e.consumo_areia_unidade || "m3") : null,
          pressao_injecao_kgcm2: e.pressao_injecao_kgcm2 ?? null,
          ...rdoCamposInjecao(e),   // fase 101 (#99): m³ injetado e água, só quando vieram (colunas novas)
          perfuracao_inicio: e.perfuracao_inicio,
          perfuracao_fim: e.perfuracao_fim,
          concretagem_inicio: e.concretagem_inicio,
          concretagem_fim: e.concretagem_fim,
          torque: e.torque,
          volume_concreto_m3: e.volume_concreto_m3,
          equipamento_id: equipId || eqId,   // fase 94: a linha herda a máquina do diário
          maquina_codigo: e.maquina_codigo,
          observacoes: e.observacoes,
          numero_boletim_fisico: e.numero_boletim_fisico || null,   // lote S57 (#220)
          modalidade_execucao: e.modalidade_execucao || "furo_normal",
          origem_dados: e.origem_dados || "csv_geodigitus"
        };
      });
      // lote S57 (#220): o RG 11.3 concilia antes com a execução que o dia já tem (lida por PDF ou lançada à mão)
      // fase 173b: concilia só com a linha do mesmo diário (mesma máquina e período) ou de diário sem máquina do mesmo período;
      // a de outra máquina ou de outro período fica como está e a do arquivo entra como linha nova neste diário
      const rc = _iaOrigem === "xlsx_rg113" ? await rdoRg113ConciliarExistentes(obra_id, diaData, exs, ests, { rdoId, eqId, turno: turnoDia }) : { indices: new Set(), conciliadas: 0, trechos: 0 };
      // fase 129c: diário que já existe (aberto pelo app do campo): a estaca que o operador lançou não ganha uma segunda linha
      if(rdoExist){
        const cc = await rdoConciliarComCampo(rdoId, exs, ests, dia, rc.indices);
        cc.indices.forEach(i => rc.indices.add(i)); rc.conciliadas += cc.conciliadas; rc.trechos += cc.trechos;
      }
      const idxNovos = exs.map((_, i) => i).filter(i => !rc.indices.has(i));
      // fase 107a: cada execução pela RPC rdo_import_execucao_conciliar (a mesma da sync do Geodigitus): concilia com a da
      // obra no mesmo dia e número, pula a que já veio do Geodigitus; só a inserida agora recebe os trechos de solo
      const gx = await rdoGravarExecucoesImport(rdoId, idxNovos.map(i => exs[i]), dia);
      const execIds = [];
      idxNovos.forEach((i, k) => { execIds[i] = gx.ids[k] ? { id: gx.ids[k] } : null; });
      totalExecs += gx.inseridas; totalGeo += gx.puladasGeo; totalConc += gx.conciliadas + rc.conciliadas; totalTrechos += rc.trechos;
      // lote S57 (#220): local e bloco do RG 11.3 → rdo_raiz_dados do diário principal do dia (só completa o que está vazio)
      const rdIA = _iaExtras?.[dia]?.raiz_dados;
      if(rdIA && ehPrincipal && (rdIA.local_obra || rdIA.bloco)) await rdoCompletarRaizDados(rdoId, rdIA, dia);
      // Trechos de solo/ferramenta → rdo_raiz_solo (por execução)
      const solos = [];
      ests.forEach((e, i) => {
        const execId = execIds?.[i]?.id;
        if(!execId) return;
        (e.trechos || []).forEach((t, ti) => solos.push({
          rdo_id: rdoId, execucao_id: execId, ordem: ti + 1,
          inicio_ml: t.de ?? null, final_ml: t.ate ?? null,
          classificacao: t.solo || null, ferramenta: t.ferramenta || null
        }));
      });
      if(solos.length){
        const { error: errSolo } = await sb.from("rdo_raiz_solo").insert(solos);
        if(errSolo) throw new Error(`Trechos de solo de ${dia}: ${errSolo.message}`);
        totalTrechos += solos.length;
      }
      // Atividades hora a hora lidas pela IA (chamado #5) → rdo_raiz_justificativa (execucao_id nulo).
      // Só em RDO criado agora, pela mesma razão da equipe (não duplicar num RDO existente).
      const justIA = _iaExtras?.[dia]?.justificativa || [];
      if(justIA.length && !rdoExist && ehPrincipal){
        const linhasJ = justIA.map((j, i) => ({ rdo_id: rdoId, execucao_id: null, ordem: i + 1,
          h_inicial: j.h_inicial || null, h_final: j.h_final || null, motivo: j.motivo || null }));
        const { error: errJ } = await sb.from("rdo_raiz_justificativa").insert(linhasJ);
        if(errJ) console.warn("Atividades de " + dia + " não gravadas:", errJ.message);
        else totalAtiv += linhasJ.length;
      }
      // Equipe lida pela IA (só em RDO criado agora, para não duplicar num RDO existente).
      // Casada com o cadastro: funcionario_id quando há correspondência; senão nome_avulso.
      const eqIA = _iaExtras?.[dia]?.equipe || [];
      if(eqIA.length && !rdoExist && ehPrincipal){
        // lote S54 (#178): o status do dia conferido vai junto (só quando há; presente = sem a chave, como o RDO grava) e
        // o que ele não admite sai antes (ausência sem horário e horas; treinamento em dia útil e viagem sem HE)
        const feriadoDia = !!_iaExtras?.[dia]?.feriado;
        const linhas = eqIA.map((p, i) => rdoAplicarStatusDia({ rdo_id: rdoId,
          funcionario_id: p.funcionario_id || null,
          nome_avulso: p.funcionario_id ? null : p.nome,
          funcao_no_dia: p.funcao_no_dia || (p.funcionario_id ? null : "outro"),
          hora_entrada: p.hora_entrada || null, hora_saida: p.hora_saida || null, intervalo_minutos: p.intervalo_minutos ?? null,
          horas_normais: p.horas_normais, horas_50: p.horas_50, horas_100: p.horas_100, ordem: i + 1,
          ...(rdoStatusDia(p.status_dia) ? { status_dia: p.status_dia } : {}) }, diaData, feriadoDia));
        const { error: errEq } = await sb.from("rdo_equipe").insert(linhas);
        if(errEq) console.warn("Equipe de " + dia + " não gravada:", errEq.message);
      }
      // Abastecimento lido da planilha do Maya (só em RDO criado agora)
      // fase 94: cada abastecimento vai para o diário da sua máquina; sem máquina (ou máquina sem diário no dia) → principal
      const maqAbast = (a) => { const cod = String(a.maquina || "").trim(); return (rdoCasarMaquina(cod) || {}).id || (cod && _csvMapaManual[cod]) || null; };
      const abIA = (_iaExtras?.[dia]?.abastecimentos || []).filter(a => {
        const eqA = maqAbast(a);
        if(eqA) return eqA === eqId || (ehPrincipal && !grupos.some(x => x.dia === dia && x.eq === eqA));
        return ehPrincipal;
      });
      // lote S57 (#220): no RG 11.3 o diário reaproveitado (lido por PDF) sem nenhum abastecimento recebe o da planilha
      let abNoReaproveitado = false;
      if(abIA.length && rdoExist && _iaOrigem === "xlsx_rg113"){
        const { count: nAb } = await sb.from("rdo_abastecimento").select("id", { count: "exact", head: true }).eq("rdo_id", rdoId);
        abNoReaproveitado = nAb === 0;
      }
      if(abIA.length && (!rdoExist || abNoReaproveitado)){
        const linhasAb = abIA.map((a, i) => {
          return { rdo_id: rdoId, equipamento_id: maqAbast(a) || eqId || null, maquina_codigo: a.maquina || null,
            combustivel: a.combustivel || "diesel", quantidade: a.quantidade ?? null, unidade: a.unidade || "L", horimetro: a.horimetro ?? null,
            observacao: a.observacao || null, ordem: i + 1 };
        });
        const { error: errAb } = await sb.from("rdo_abastecimento").insert(linhasAb);
        if(errAb) console.warn("Abastecimento de " + dia + " não gravado:", errAb.message);
      }
      // fase 129c: ocorrências da planilha do Maya → tabela ocorrencias, cada uma no diário da sua máquina (sem máquina → principal)
      const parIA = (_iaExtras?.[dia]?.paradas || []).filter(p => {
        const eqP = maqAbast(p);
        if(eqP) return eqP === eqId || (ehPrincipal && !grupos.some(x => x.dia === dia && x.eq === eqP));
        return ehPrincipal;
      });
      if(parIA.length){
        const gp = await rdoGravarParadasImport(rdoId, obra_id, diaData, eqId, parIA, dia);
        totalParadas += gp.gravadas; totalParadasTexto += gp.texto;
      }
    }
    aviso("app-aviso", `✅ Importado: ${totalRdos} diário(s) novo(s) em ${dias.length} dia(s), ${totalExecs} execuções de estaca${totalTrechos ? `, ${totalTrechos} trechos de solo` : ""}${totalAtiv ? `, ${totalAtiv} atividades hora a hora` : ""}.${totalGeo ? ` ${totalGeo} estaca(s) já vieram do Geodigitus (não duplicadas).` : ""}${totalConc ? ` ${totalConc} estaca(s) conciliada(s) com o que já estava no diário.` : ""}${totalParadas ? ` ${totalParadas} ocorrência(s) gravada(s) nas paradas do diário.` : ""}${totalParadasTexto ? ` ⚠️ ${totalParadasTexto} ocorrência(s) foram para as observações (seu perfil não grava ocorrências).` : ""}${totalSemMaq ? ` ⚠️ ${totalSemMaq} diário(s) sem máquina — informe a máquina no cabeçalho (Para regularizar).` : ""}${noturnosNoDiurno ? ` ⚠️ ${noturnosNoDiurno} diário(s) noturno(s) da planilha foram para o diurno: a obra trabalha em um turno.` : ""}`, "ok");
    fecharModalImportCSV();
    await carregarRDO();
  } catch(err){
    aviso("app-aviso","Erro: "+err.message,"erro");
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
}

/* ---------- Local / frente do RDO (fase 36) ----------
   Mesmo valor de estacas.local: desempata a execução quando o número da estaca se
   repete entre locais da obra. O datalist sugere os locais já cadastrados nas estacas. */
async function carregarLocaisRDO(obraId){
  const dl = $("rdo-local-lista");
  if(!dl) return;
  dl.innerHTML = "";
  if(!obraId) return;
  const { data } = await sb.from("estacas").select("local").eq("obra_id", obraId).not("local", "is", null).limit(500);
  const locais = [...new Set((data || []).map(e => (e.local || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  dl.innerHTML = locais.map(l => `<option value="${esc(l)}"></option>`).join("");
}
(function(){
  const f = () => $("rdo-obra")?.addEventListener("change", () => carregarLocaisRDO($("rdo-obra").value));
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", f); else f();
})();

/* ====================================================================
   App do operador (fase 129b) — op_parada.js
   Tela 7: paradas do dia (Iniciar / Encerrar, linha do tempo, lançar à mão).
   As horas paradas saem do gatilho do banco. Fase 166: "A obra ficou paralisada?" e "Em razão do cliente?" são perguntas com
   Sim e Não. O motivo só sugere a resposta, à vista de quem lança; salvar exige as duas respondidas e o envio leva sempre sim
   ou não explícito. Sem resposta nunca vira "não".
   ==================================================================== */

const MOTIVOS_PARADA = [
  ["aguardando_liberacao", "Aguardando liberação"], ["aguardando_locacao", "Aguardando locação"],
  ["aguardando_concreto_argamassa", "Aguardando concreto/argamassa"], ["aguardando_frente", "Aguardando frente"],
  ["chuva", "Chuva"], ["manutencao", "Manutenção"], ["preparacao", "Preparação"],
  ["deslocamento_interno", "Deslocamento interno"], ["outro", "Outro"]
];
const ROTULO_MOTIVO = Object.fromEntries(MOTIVOS_PARADA);
/* Resposta sugerida por motivo (fase 166). Cópia idêntica à de js/rdo.js: os dois arquivos não carregam na mesma página, e o
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
const PARADA_PERGUNTAS = [["paralisado", "A obra ficou paralisada?"], ["em_razao_cliente", "Em razão do cliente?"]];
/* só verdadeiro e falso são resposta; qualquer outra coisa é "sem resposta" (nulo) */
const paradaBool = (v) => v === true ? true : v === false ? false : null;
function paradaSugestao(motivo){
  const s = Object.prototype.hasOwnProperty.call(PARADA_RESPOSTA_PADRAO, motivo) ? PARADA_RESPOSTA_PADRAO[motivo] : null;
  return { paralisado: paradaBool(s && s.paralisado), em_razao_cliente: paradaBool(s && s.em_razao_cliente) };
}
/* motivo sem sugestão (ou desconhecido): quem lança tem de responder à mão */
function paradaSemSugestao(motivo){ const s = paradaSugestao(motivo); return s.paralisado === null || s.em_razao_cliente === null; }
/* falta alguma das duas respostas: não dá para salvar */
function paradaRespostaFalta(r){ return !r || paradaBool(r.paralisado) === null || paradaBool(r.em_razao_cliente) === null; }

let _parModo = null;      // null | "iniciar" | "lancar" | id da parada em correção
let _parMotivo = null;
let _parResp = { paralisado: null, em_razao_cliente: null };   // as duas respostas do formulário aberto (null = sem resposta)

function horasEntre(ini, fim){
  const a = minutos(ini), b = minutos(fim);
  if(a == null || b == null) return null;
  return ((b - a + 1440) % 1440) / 60;
}

OP.telas.parada = async function(){
  const s = OP.snap, box = $("op-parada-conteudo");
  const ed = diaEditavel();
  const aberta = paradaAberta();
  const lista = s.paradas || [];
  const total = lista.reduce((t, p) => t + (Number(p.horas_paradas) || horasEntre(p.periodo_inicio, p.periodo_fim) || 0), 0);
  box.innerHTML = `
    ${aberta ? `<div class="op-alerta op-alerta-aviso">
      <p><strong>⏸ Parada em andamento desde ${esc(hhmm(aberta.periodo_inicio))}</strong><br>${esc(ROTULO_MOTIVO[aberta.motivo] || aberta.descricao || "")}</p>
      ${ed ? `<label class="op-campo">Hora do fim<input type="time" step="60" id="op-par-fim" value="${esc(horaAgora(1))}"></label>
      <button type="button" class="op-btn op-btn-primario op-btn-grande" data-par-encerrar="${esc(aberta.id)}">▶ Encerrar a parada</button>` : ""}
    </div>` : ""}
    ${ed && !aberta && _parModo == null ? `<div class="op-acoes">
      <button type="button" class="op-btn op-btn-primario op-btn-grande" id="op-btn-par-iniciar">⏸ Iniciar parada agora</button>
      <button type="button" class="op-btn" id="op-btn-par-lancar">Lançar parada que já acabou</button>
    </div>` : ""}
    ${_parModo != null ? formularioParada() : ""}
    <p class="op-meta">Total parado no dia: <strong>${num(total, 2)} h</strong></p>
    ${!lista.length ? `<div class="op-vazio">Nenhuma parada hoje.</div>` : ""}
    <ol class="op-lista-simples">${lista.map(p => {
      const doApp = p.origem === "app_operador";
      const h = Number(p.horas_paradas) || horasEntre(p.periodo_inicio, p.periodo_fim);
      return `<li class="op-card">
        <div class="op-card-topo"><strong>${esc(hhmm(p.periodo_inicio))}–${p.periodo_fim ? esc(hhmm(p.periodo_fim)) : "em andamento"}</strong>${doApp ? seloEstado(p.id) : `<span class="op-selo">${esc(p.origem || "outra origem")}</span>`}</div>
        <p>${esc(ROTULO_MOTIVO[p.motivo] || "Parada")}${h != null && p.periodo_fim ? " · " + num(h, 2) + " h" : ""}${p.paralisado === true ? " · obra paralisada" : ""}${p.em_razao_cliente === true ? " · em razão do cliente" : ""}${p.paralisado == null || p.em_razao_cliente == null ? " · resposta não informada" : ""}</p>
        ${p.descricao && p.descricao !== ROTULO_MOTIVO[p.motivo] ? `<p class="op-meta">${esc(p.descricao)}</p>` : ""}
        ${ed && doApp && p.periodo_fim ? `<div class="op-acoes">
          <button type="button" class="op-btn" data-par-corrigir="${esc(p.id)}">Corrigir</button>
          <button type="button" class="op-btn op-btn-perigo" data-par-remover="${esc(p.id)}">Remover</button>
        </div>` : ""}
      </li>`;
    }).join("")}</ol>`;
};

/* abre o formulário: parada nova começa sem resposta (o motivo sugere depois); em correção vale o que está gravado */
function abrirFormularioParada(modo){
  const p = (modo !== "iniciar" && modo !== "lancar") ? (OP.snap.paradas || []).find(x => x.id === modo) : null;
  _parModo = modo; _parMotivo = null;
  _parResp = { paralisado: paradaBool(p && p.paralisado), em_razao_cliente: paradaBool(p && p.em_razao_cliente) };
}
function fecharFormularioParada(){ _parModo = null; _parMotivo = null; _parResp = { paralisado: null, em_razao_cliente: null }; }
function marcarRespostasParada(){
  document.querySelectorAll("[data-par-resp]").forEach(b => {
    const ativo = _parResp[b.dataset.parResp] === (b.dataset.parValor === "sim");
    b.classList.toggle("ativo", ativo); b.setAttribute("aria-pressed", String(ativo));
  });
}

function formularioParada(){
  const p = (_parModo !== "iniciar" && _parModo !== "lancar") ? (OP.snap.paradas || []).find(x => x.id === _parModo) : null;
  const iniciar = _parModo === "iniciar";
  const m = _parMotivo || p?.motivo || null;
  return `<section class="op-bloco" id="op-par-form">
    <h2>${iniciar ? "Iniciar parada" : p ? "Corrigir parada" : "Lançar parada"}</h2>
    <p class="op-meta">Motivo</p>
    <div class="op-chips">${MOTIVOS_PARADA.map(([v, r]) =>
      `<button type="button" class="op-chip-btn${m === v ? " ativo" : ""}" data-par-motivo="${esc(v)}" aria-pressed="${m === v}">${esc(r)}</button>`).join("")}</div>
    <label class="op-campo">${iniciar ? "Começou às" : "Início"}<input type="time" step="${iniciar ? 60 : 300}" id="op-par-ini" value="${esc(p ? hhmm(p.periodo_inicio) : horaAgora(iniciar ? 1 : 5))}"></label>
    ${iniciar ? "" : `<label class="op-campo">Fim<input type="time" step="300" id="op-par-fim-mao" value="${esc(p ? hhmm(p.periodo_fim) : "")}"></label>`}
    ${PARADA_PERGUNTAS.map(([campo, texto]) => `<p class="op-meta" id="op-par-perg-${esc(campo)}">${esc(texto)}</p>
    <div class="op-chips" role="group" aria-labelledby="op-par-perg-${esc(campo)}">${[["sim", "Sim", true], ["nao", "Não", false]].map(([v, r, b]) =>
      `<button type="button" class="op-chip-btn${_parResp[campo] === b ? " ativo" : ""}" data-par-resp="${esc(campo)}" data-par-valor="${esc(v)}" aria-pressed="${_parResp[campo] === b}">${esc(r)}</button>`).join("")}</div>`).join("")}
    <label class="op-campo">Descrição${m === "outro" ? " (obrigatória)" : ""}<input type="text" id="op-par-desc" maxlength="200" value="${esc(p && p.descricao !== ROTULO_MOTIVO[p.motivo] ? p.descricao : "")}"></label>
    ${p ? `<label class="op-campo">Motivo da correção (obrigatório)<input type="text" id="op-par-correcao" maxlength="200"></label>` : ""}
    <div class="op-acoes">
      <button type="button" class="op-btn op-btn-primario" id="op-btn-par-salvar">${iniciar ? "Iniciar" : "Salvar"}</button>
      <button type="button" class="op-btn" id="op-btn-par-cancelar">Cancelar</button>
    </div>
  </section>`;
}

async function salvarParada(){
  const m = _parMotivo || (OP.snap.paradas || []).find(x => x.id === _parModo)?.motivo;
  if(!m){ avisar("Escolha o motivo.", "aviso"); return; }
  const ini = $("op-par-ini").value;
  if(!ini){ avisar("Informe a hora de início.", "aviso"); return; }
  const desc = $("op-par-desc").value.trim();
  if(m === "outro" && !desc){ avisar("Descreva a parada quando o motivo é Outro.", "aviso"); return; }
  if(paradaRespostaFalta(_parResp)){ avisar(PARADA_AVISO_RESPOSTA, "aviso"); return; }
  const paralisado = _parResp.paralisado, cliente = _parResp.em_razao_cliente;   // sempre sim ou não explícito
  const lista = OP.snap.paradas || (OP.snap.paradas = []);
  if(_parModo === "iniciar"){
    if(paradaAberta()){ avisar("Já há uma parada em andamento.", "aviso"); return; }
    const id = novoId();
    lista.push({ id, motivo: m, periodo_inicio: ini, periodo_fim: null, paralisado, em_razao_cliente: cliente, descricao: desc || ROTULO_MOTIVO[m], origem: "app_operador" });
    await enfileirar("rdo_campo_parada_iniciar", { p_rdo: OP.rdoId, p_id: id, p_motivo: m, p_inicio: ini, p_paralisado: paralisado,
      p_em_razao_cliente: cliente, p_descricao: desc || null }, { rotulo: "Parada: " + ROTULO_MOTIVO[m], linha_id: id });
    avisar(`Parada iniciada às ${ini}.`, "ok");
  } else {
    const fim = $("op-par-fim-mao").value;
    if(!fim){ avisar("Informe a hora do fim.", "aviso"); return; }
    const p = _parModo === "lancar" ? null : lista.find(x => x.id === _parModo);
    const correcao = p ? $("op-par-correcao").value.trim() : null;
    if(p && correcao.length < 5){ avisar("Escreva o motivo da correção.", "aviso"); return; }
    const campos = { motivo: m, periodo_inicio: ini, periodo_fim: fim, paralisado, em_razao_cliente: cliente, descricao: desc || null };
    const id = p?.id || novoId();
    if(p) Object.assign(p, campos, { descricao: desc || ROTULO_MOTIVO[m], horas_paradas: null });
    else lista.push(Object.assign({ id, origem: "app_operador" }, campos, { descricao: desc || ROTULO_MOTIVO[m] }));
    await enfileirar("rdo_campo_parada_lancar", { p_rdo: OP.rdoId, p_id: id, p_campos: campos, p_motivo_correcao: correcao },
      { rotulo: (p ? "Correção da parada " : "Parada ") + ini + "–" + fim, linha_id: id });
    avisar("Parada guardada.", "ok");
  }
  fecharFormularioParada();
  renderTelaAtual();
}

async function encerrarParada(id){
  const fim = $("op-par-fim").value;
  if(!fim){ avisar("Informe a hora do fim.", "aviso"); return; }
  const p = (OP.snap.paradas || []).find(x => x.id === id);
  if(!p) return;
  p.periodo_fim = fim;
  await enfileirar("rdo_campo_parada_encerrar", { p_rdo: OP.rdoId, p_id: id, p_fim: fim }, { rotulo: "Fim da parada " + hhmm(p.periodo_inicio), linha_id: id });
  avisar(`Parada encerrada às ${fim}.`, "ok");
  renderTelaAtual();
}

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button");
  if(!el || el.disabled) return;
  const d = el.dataset;
  if(d.parMotivo){
    _parMotivo = d.parMotivo;
    document.querySelectorAll("[data-par-motivo]").forEach(b => { b.classList.toggle("ativo", b.dataset.parMotivo === _parMotivo); b.setAttribute("aria-pressed", String(b.dataset.parMotivo === _parMotivo)); });
    // parada nova: o motivo refaz a sugestão, à vista do operador, que pode trocar; em correção vale o que está gravado
    if(!_parModo || _parModo === "iniciar" || _parModo === "lancar"){ _parResp = paradaSugestao(_parMotivo); marcarRespostasParada(); }
    return;
  }
  if(d.parResp){
    if(d.parResp === "paralisado" || d.parResp === "em_razao_cliente"){ _parResp[d.parResp] = d.parValor === "sim"; marcarRespostasParada(); }
    return;
  }
  if(d.parEncerrar){ el.disabled = true; try { await encerrarParada(d.parEncerrar); } finally { el.disabled = false; } return; }
  if(d.parCorrigir){ abrirFormularioParada(d.parCorrigir); renderTelaAtual(); return; }
  if(d.parRemover){
    const p = (OP.snap.paradas || []).find(x => x.id === d.parRemover);
    if(!p) return;
    const motivo = prompt(`Remover a parada ${hhmm(p.periodo_inicio)}–${hhmm(p.periodo_fim)}? Escreva o motivo:`);
    if(motivo == null) return;
    if(motivo.trim().length < 5){ avisar("O motivo precisa ter pelo menos 5 letras.", "aviso"); return; }
    OP.snap.paradas = OP.snap.paradas.filter(x => x.id !== p.id);
    await enfileirar("rdo_campo_parada_remover", { p_rdo: OP.rdoId, p_id: p.id, p_motivo: motivo.trim() }, { rotulo: "Remover parada " + hhmm(p.periodo_inicio), linha_id: p.id });
    renderTelaAtual(); return;
  }
  switch(el.id){
    case "op-fab-parada": irPara("parada"); break;
    case "op-btn-par-iniciar": abrirFormularioParada("iniciar"); renderTelaAtual(); break;
    case "op-btn-par-lancar": abrirFormularioParada("lancar"); renderTelaAtual(); break;
    case "op-btn-par-cancelar": fecharFormularioParada(); renderTelaAtual(); break;
    case "op-btn-par-salvar": el.disabled = true; try { await salvarParada(); } finally { el.disabled = false; } break;
  }
});

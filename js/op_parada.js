/* ====================================================================
   App do operador (fase 129b) — op_parada.js
   Tela 7: paradas do dia (Iniciar / Encerrar, linha do tempo, lançar à mão).
   As horas paradas saem do gatilho do banco; paralisado e "em razão do cliente" seguem o motivo, e o operador pode trocar.
   ==================================================================== */

const MOTIVOS_PARADA = [
  ["aguardando_liberacao", "Aguardando liberação"], ["aguardando_locacao", "Aguardando locação"],
  ["aguardando_concreto_argamassa", "Aguardando concreto/argamassa"], ["aguardando_frente", "Aguardando frente"],
  ["chuva", "Chuva"], ["manutencao", "Manutenção"], ["preparacao", "Preparação"],
  ["deslocamento_interno", "Deslocamento interno"], ["outro", "Outro"]
];
const ROTULO_MOTIVO = Object.fromEntries(MOTIVOS_PARADA);
const motivoParalisa = (m) => ["aguardando_liberacao", "aguardando_locacao", "aguardando_concreto_argamassa", "aguardando_frente", "chuva", "manutencao"].includes(m);
const motivoDoCliente = (m) => ["aguardando_liberacao", "aguardando_locacao", "aguardando_concreto_argamassa", "aguardando_frente"].includes(m);

let _parModo = null;      // null | "iniciar" | "lancar" | id da parada em correção
let _parMotivo = null;

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
        <p>${esc(ROTULO_MOTIVO[p.motivo] || "Parada")}${h != null && p.periodo_fim ? " · " + num(h, 2) + " h" : ""}${p.paralisado ? " · máquina parada" : ""}${p.em_razao_cliente ? " · por conta do cliente" : ""}</p>
        ${p.descricao && p.descricao !== ROTULO_MOTIVO[p.motivo] ? `<p class="op-meta">${esc(p.descricao)}</p>` : ""}
        ${ed && doApp && p.periodo_fim ? `<div class="op-acoes">
          <button type="button" class="op-btn" data-par-corrigir="${esc(p.id)}">Corrigir</button>
          <button type="button" class="op-btn op-btn-perigo" data-par-remover="${esc(p.id)}">Remover</button>
        </div>` : ""}
      </li>`;
    }).join("")}</ol>`;
};

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
    <label class="op-check"><input type="checkbox" id="op-par-paralisado" ${(p ? p.paralisado : motivoParalisa(m)) ? "checked" : ""}> A máquina ficou parada</label>
    <label class="op-check"><input type="checkbox" id="op-par-cliente" ${(p ? p.em_razao_cliente : motivoDoCliente(m)) ? "checked" : ""}> Por conta do cliente</label>
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
  const paralisado = $("op-par-paralisado").checked, cliente = $("op-par-cliente").checked;
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
  _parModo = null; _parMotivo = null;
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
    // ao trocar o motivo, os padrões acompanham (o operador ainda pode mudar)
    if(!_parModo || _parModo === "iniciar" || _parModo === "lancar"){
      $("op-par-paralisado").checked = motivoParalisa(_parMotivo);
      $("op-par-cliente").checked = motivoDoCliente(_parMotivo);
    }
    return;
  }
  if(d.parEncerrar){ el.disabled = true; try { await encerrarParada(d.parEncerrar); } finally { el.disabled = false; } return; }
  if(d.parCorrigir){ _parModo = d.parCorrigir; _parMotivo = null; renderTelaAtual(); return; }
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
    case "op-btn-par-iniciar": _parModo = "iniciar"; _parMotivo = null; renderTelaAtual(); break;
    case "op-btn-par-lancar": _parModo = "lancar"; _parMotivo = null; renderTelaAtual(); break;
    case "op-btn-par-cancelar": _parModo = null; _parMotivo = null; renderTelaAtual(); break;
    case "op-btn-par-salvar": el.disabled = true; try { await salvarParada(); } finally { el.disabled = false; } break;
  }
});

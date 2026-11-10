/* ====================================================================
   App do operador (fase 129b) — op_dia.js
   Telas: Minha máquina (2), Meu dia (3), Enviar o dia (10), Meus dias (11), Eu (12) e o menu Mais.
   ==================================================================== */

/* ---------- 2. Minha máquina ---------- */
let _maquinas = null;   // última lista (também guardada em cache para abrir sem sinal)
OP.telas.maquina = async function(){
  const box = $("op-maquina-conteudo");
  const ehEnc = OP.perfil?.cargo !== "operador";
  if(navigator.onLine){
    const { data, error } = await sb.rpc("rdo_campo_minhas_maquinas", { p_data: dataLocalISO() });
    if(error){
      if(ehErroDeSessao(error)) pedirSenhaDeNovo();
      box.innerHTML = `<div class="op-vazio">⚠ ${esc(mensagemDoBanco(error))}</div>`;
      return;
    }
    _maquinas = data || [];
    await idbPut("cache", { chave: "maquinas", dia: dataLocalISO(), lista: _maquinas });
  } else {
    const c = await idbGet("cache", "maquinas");
    _maquinas = c && c.dia === dataLocalISO() ? c.lista : null;
  }
  if(!_maquinas){
    box.innerHTML = `<div class="op-vazio">📶 Sem sinal. Abrir o dia pela primeira vez precisa de sinal; o que você lançar depois fica no aparelho até o sinal voltar.</div>`;
    return;
  }
  if(!_maquinas.length){
    box.innerHTML = `<div class="op-vazio">Nenhuma máquina ligada a você hoje.<br>${ehEnc ? "Nenhuma máquina em obra nas suas obras." : "Fale com o encarregado ou com a engenharia para ligar a máquina ao seu nome."}</div>`;
    return;
  }
  box.innerHTML = _maquinas.map(m => {
    const hoje = (m.diarios_hoje || []);
    const turno = m.turno_ontem || "diurno";   // fase 155a: o turno só aparece em obra de dois turnos (m.dois_turnos); nas outras o dia abre diurno
    const pend = m.pendencia
      ? `<p class="op-alerta op-alerta-perigo">⚠ ${m.pendencia === "rdo_tipo_nao_confirmado" ? "Máquina sem tipo de serviço" : "Máquina sem obra nesta data"}: fale com a engenharia.</p>` : "";
    const diarios = hoje.map(d => `<li>${d.turno === "noturno" ? "🌙 Noturno" : "☀ Diurno"} · ${d.status === "finalizado" ? "🔒 Finalizado" : d.enviado_em ? "📤 Enviado" : "✏ Rascunho"}</li>`).join("");
    return `<article class="op-card">
      <div class="op-card-topo"><strong class="op-tag">${esc(m.codigo)}</strong><span class="op-chip">${esc(ROTULO_TIPO[m.tipo_servico] || "sem tipo")}</span></div>
      <p class="op-card-linha">${esc(m.obra_codigo || "sem obra")} · ${esc(m.obra_nome || "")}${m.cidade ? " · " + esc(m.cidade) : ""}</p>
      ${pend}
      ${diarios ? `<ul class="op-lista-simples">${diarios}</ul>` : ""}
      ${m.pendencia ? "" : `${m.dois_turnos ? `<div class="op-turno" role="group" aria-label="Turno">
        <label class="op-radio"><input type="radio" name="turno-${esc(m.equipamento_id)}" value="diurno" ${turno === "diurno" ? "checked" : ""}> ☀ Diurno</label>
        <label class="op-radio"><input type="radio" name="turno-${esc(m.equipamento_id)}" value="noturno" ${turno === "noturno" ? "checked" : ""}> 🌙 Noturno</label>
      </div>` : ""}
      <p class="op-pergunta">A obra é <strong>${esc(m.obra_codigo || "")}</strong>?</p>
      <div class="op-acoes">
        <button type="button" class="op-btn op-btn-primario" data-abrir="${esc(m.equipamento_id)}" data-confirmada="1">Sim, abrir o dia</button>
        <button type="button" class="op-btn" data-abrir="${esc(m.equipamento_id)}" data-confirmada="0">Não é esta obra</button>
      </div>`}
    </article>`;
  }).join("");
};

async function abrirDia(equipamentoId, confirmada){
  if(!navigator.onLine){ avisar("Abrir o dia precisa de sinal.", "aviso"); return; }
  const turno = document.querySelector(`input[name="turno-${CSS.escape(equipamentoId)}"]:checked`)?.value || "diurno";
  if(!confirmada && !confirm("O dia abre mesmo assim, e a engenharia recebe o aviso de que a obra está diferente. Continuar?")) return;
  const { data, error } = await sb.rpc("rdo_campo_abrir_dia", {
    p_equipamento: equipamentoId, p_data: dataLocalISO(), p_turno: turno, p_obra_confirmada: !!confirmada, p_agora_aparelho: new Date().toISOString()
  });
  if(error){ if(ehErroDeSessao(error)) pedirSenhaDeNovo(); avisar(mensagemDoBanco(error), "erro"); return; }
  if(!data?.ok){ avisar(data?.mensagem || "Não foi possível abrir o dia.", "erro"); return; }
  await guardarSnapshot(data.snapshot);
  prefGravar("turno_" + equipamentoId, turno);
  if(!confirmada) avisar("Dia aberto. A engenharia foi avisada sobre a obra.", "aviso");
  irPara("dia");
}

/* ---------- 3. Meu dia ---------- */
function situacaoDoDia(r){
  if(!r) return { cls: "", txt: "" };
  if(r.status === "finalizado") return { cls: "op-alerta-neutro", txt: "🔒 Finalizado pela engenharia (só leitura)" };
  const devolvido = r.devolvido_em && (!r.enviado_em || r.devolvido_em > r.enviado_em);
  if(devolvido) return { cls: "op-alerta-perigo", txt: "↩ Devolvido: " + (r.devolvido_motivo || "veja com a engenharia") };
  if(r.enviado_em) return { cls: "op-alerta-ok", txt: "📤 Enviado às " + horaDeTimestamp(r.enviado_em) + (r.enviado_por_nome ? " por " + r.enviado_por_nome : "") };
  return { cls: "op-alerta-info", txt: "✏ Rascunho: lance durante o dia e envie no fim do expediente" };
}
function numerosDoDia(s){
  const exec = (s.execucoes || []).filter(x => x.modalidade_execucao !== "nao_aplica");
  const metros = exec.reduce((t, x) => t + (Number(x.profundidade_executada) || 0), 0);
  const horas = (s.paradas || []).reduce((t, p) => t + (Number(p.horas_paradas) || 0), 0);
  return { estacas: exec.length, metros, horas };
}
OP.telas.dia = async function(){
  const s = OP.snap, r = s.rdo, box = $("op-dia-conteudo");
  const sit = situacaoDoDia(r);
  const n = numerosDoDia(s);
  const par = paradaAberta();
  const ed = diaEditavel();
  const tipoRT = ehRaizOuTrado(r.tipo_servico);
  const chipsTempo = (campo) => Object.entries(ROTULO_TEMPO).map(([v, rot]) =>
    `<button type="button" class="op-chip-btn${r[campo] === v ? " ativo" : ""}" data-tempo="${esc(campo)}" data-valor="${esc(v)}" ${ed ? "" : "disabled"} aria-pressed="${r[campo] === v ? "true" : "false"}">${esc(rot)}</button>`).join("");
  const visto = OP.snapVistoEm ? horaDeTimestamp(OP.snapVistoEm) : "";
  box.innerHTML = `
    <p class="op-alerta ${esc(sit.cls)}">${esc(sit.txt)}</p>
    ${par ? `<button type="button" class="op-alerta op-alerta-aviso op-alerta-botao" data-ir="parada">⏸ Parada em andamento desde ${esc(hhmm(par.periodo_inicio))}: ${esc(par.descricao || "")}. Toque para encerrar.</button>` : ""}
    <div class="op-numeros">
      <div><strong>${esc(n.estacas)}</strong><span>Estacas</span></div>
      <div><strong>${num(n.metros, 1)}</strong><span>Metros</span></div>
      <div><strong>${num(n.horas, 2)}</strong><span>Horas paradas</span></div>
    </div>
    <p class="op-meta">${esc(ROTULO_TIPO[r.tipo_servico] || "")} · ${esc(s.obra?.nome || "")}${visto ? " · visto às " + esc(visto) : ""}</p>
    <div class="op-grade">
      <button type="button" class="op-cartao" data-ir="equipe"><span aria-hidden="true">👷</span><strong>Equipe</strong><span>${esc((s.equipe || []).length)} pessoa(s)</span></button>
      <button type="button" class="op-cartao" data-ir="abast"><span aria-hidden="true">⛽</span><strong>Abastecimento</strong><span>${esc((s.abastecimentos || []).length)} lançamento(s)</span></button>
      <button type="button" class="op-cartao" data-ir="${tipoRT ? "estacas" : "geo"}"><span aria-hidden="true">📍</span><strong>Estacas</strong><span>${tipoRT ? "lançadas por você" : "do computador de bordo"}</span></button>
      <button type="button" class="op-cartao" data-ir="parada"><span aria-hidden="true">⏸</span><strong>Paradas</strong><span>${esc((s.paradas || []).length)} no dia</span></button>
      <button type="button" class="op-cartao" data-ir="foto"><span aria-hidden="true">📷</span><strong>Fotos</strong><span>${esc((s.fotos || []).length)} registrada(s)</span></button>
      <button type="button" class="op-cartao" data-ir="enviar"><span aria-hidden="true">📤</span><strong>Enviar o dia</strong><span>fim do expediente</span></button>
    </div>
    <section class="op-bloco">
      <h2>Clima da manhã</h2><div class="op-chips">${chipsTempo("tempo_manha")}</div>
      <h2>Clima da tarde</h2><div class="op-chips">${chipsTempo("tempo_tarde")}</div>
      <label class="op-check"><input type="checkbox" id="op-dds" ${r.dds_feito ? "checked" : ""} ${ed ? "" : "disabled"}> DDS feito hoje</label>
      <label class="op-campo">Local / frente de serviço<input type="text" id="op-local" maxlength="120" value="${esc(r.local || "")}" ${ed ? "" : "disabled"}></label>
      <label class="op-campo">Observações do dia<textarea id="op-obs" rows="3" maxlength="2000" ${ed ? "" : "disabled"}>${esc(r.observacoes || "")}</textarea></label>
      ${ed ? `<button type="button" class="op-btn" id="op-btn-cab-salvar">Salvar local e observações</button>` : ""}
    </section>`;
};

async function gravarCabecalho(campos){
  const r = OP.snap.rdo;
  const ant = anteriores(r, campos);
  Object.assign(r, campos);
  await enfileirar("rdo_campo_cabecalho", { p_rdo: OP.rdoId, p_campos: campos, p_anteriores: ant }, { rotulo: "Cabeçalho do dia", linha_id: OP.rdoId });
  renderTelaAtual();
}

/* ---------- 10. Enviar o dia ---------- */
OP.telas.enviar = async function(){
  const s = OP.snap, r = s.rdo, box = $("op-enviar-conteudo");
  const n = numerosDoDia(s);
  const ed = diaEditavel();
  const ruins = _filaCache.filter(o => o.rdo_id === OP.rdoId && (o.situacao === "rejeitada" || o.situacao === "conflito"));
  const enviando = _filaCache.some(o => o.rdo_id === OP.rdoId && o.rpc === "rdo_campo_enviar" && o.situacao === "pendente");
  const bloqueios = [], avisos = [];
  if(paradaAberta()) bloqueios.push("Há uma parada em andamento: encerre antes de enviar.");
  if(ruins.length) bloqueios.push(`${ruins.length} registro(s) recusado(s): resolva em Eu › Pendências.`);
  if(r.status === "finalizado") bloqueios.push("O dia já foi finalizado pela engenharia.");
  const semStatus = (s.equipe || []).filter(e => !e.hora_entrada && !e.status_dia);
  if(!(s.equipe || []).length) avisos.push("Nenhuma pessoa na equipe.");
  if(semStatus.length) avisos.push(`${semStatus.length} pessoa(s) sem entrada nem situação do dia.`);
  if(!(s.abastecimentos || []).some(a => Number(a.horimetro) > 0)) avisos.push("Sem horímetro de hoje.");
  if(!r.tempo_tarde) avisos.push("Clima da tarde não marcado.");
  const fotosPend = _filaCache.filter(o => o.rdo_id === OP.rdoId && o.rpc === "upload_foto").length;
  if(fotosPend) avisos.push(`${fotosPend} foto(s) ainda no aparelho: sobem depois, mesmo com o dia enviado.`);
  if(ehRaizOuTrado(r.tipo_servico) && !n.estacas) avisos.push("Nenhuma estaca lançada hoje.");
  const sit = situacaoDoDia(r);
  const podeEnviar = ed && !bloqueios.length && !enviando;
  box.innerHTML = `
    <p class="op-alerta ${esc(sit.cls)}">${esc(sit.txt)}</p>
    ${enviando ? `<p class="op-alerta op-alerta-aviso">⏳ Envio na fila: sobe assim que tiver sinal, depois dos outros registros.</p>` : ""}
    <div class="op-numeros">
      <div><strong>${esc(n.estacas)}</strong><span>Estacas</span></div>
      <div><strong>${num(n.metros, 1)}</strong><span>Metros</span></div>
      <div><strong>${num(n.horas, 2)}</strong><span>Horas paradas</span></div>
    </div>
    <p class="op-meta">${esc((s.equipe || []).length)} pessoa(s) · ${esc((s.abastecimentos || []).length)} abastecimento(s) · ${esc((s.fotos || []).length)} foto(s)</p>
    ${bloqueios.length ? `<ul class="op-lista-alerta op-lista-perigo">${bloqueios.map(b => `<li>⛔ ${esc(b)}</li>`).join("")}</ul>` : ""}
    ${avisos.length ? `<ul class="op-lista-alerta">${avisos.map(a => `<li>⚠ ${esc(a)}</li>`).join("")}</ul>` : ""}
    ${ed ? `<section class="op-bloco">
      <label class="op-campo">Fim do expediente (preenche a saída de quem está sem)
        <input type="time" id="op-fim-exp" step="900" value="${esc(horaAgora(15))}"></label>
      <div class="op-acoes"><button type="button" class="op-btn" id="op-fim-agora">Agora</button></div>
      <label class="op-campo">Observações do dia<textarea id="op-enviar-obs" rows="3" maxlength="2000">${esc(r.observacoes || "")}</textarea></label>
      <button type="button" class="op-btn op-btn-primario op-btn-grande" id="op-btn-enviar" ${podeEnviar ? "" : "disabled"}>📤 Enviar para conferência</button>
      <p class="op-meta">Depois de enviar, o dia fica só leitura no celular até a engenharia devolver ou finalizar.</p>
      <button type="button" class="op-btn" data-ir="dia">Salvar e enviar depois</button>
    </section>` : ""}`;
};

async function enviarDia(){
  const fim = $("op-fim-exp")?.value || null;
  const obs = $("op-enviar-obs")?.value || null;
  if(!confirm("Enviar o dia para a engenharia conferir? Depois disso você só altera se a engenharia devolver.")) return;
  await enfileirar("rdo_campo_enviar", { p_rdo: OP.rdoId, p_fim_expediente: fim || null, p_observacoes: obs || null }, { rotulo: "Enviar o dia", linha_id: OP.rdoId });
  avisar("Envio na fila. Sobe depois dos outros registros.", "ok");
  agendarDrenagem(0);
  irPara("dia");
}

/* ---------- 11. Meus dias (últimos 30, devolvidos primeiro) ---------- */
let _filtroDias = "pendentes";
OP.telas.dias = async function(){
  const box = $("op-dias-conteudo");
  let lista = null;
  if(navigator.onLine){
    // fase 159a: a lista vem pronta da RPC campo_meus_dias (com obra, máquina e resumo). Sem a migration, a leitura antiga.
    const rd = await sb.rpc("campo_meus_dias", { p_dias: 30 });
    if(!rd.error) lista = rd.data || [];
    else if(!opRpcAusente(rd.error)){ box.innerHTML = `<div class="op-vazio">⚠ ${esc(mensagemDoBanco(rd.error))}</div>`; return; }
    else {
      const me = OP.perfil.id;
      const { data, error } = await sb.from("rdo")
        .select("id,data,turno_campo,status,tipo_servico,enviado_em,devolvido_em,devolvido_motivo,obra:obras(codigo,nome),equipamento:equipamentos(codigo)")
        .gte("data", addDiasISO(dataLocalISO(), -30))
        .or(`aberto_campo_por.eq.${me},criado_por.eq.${me},enviado_por.eq.${me}`)
        .order("data", { ascending: false }).limit(200);
      if(error){ box.innerHTML = `<div class="op-vazio">⚠ ${esc(mensagemDoBanco(error))}</div>`; return; }
      lista = data || [];
      if(lista.length){
        const { data: res } = await sb.from("vw_rdo_resumo").select("id,qtd_estacas_executadas,metragem_total").in("id", lista.map(d => d.id));
        const m = new Map((res || []).map(x => [x.id, x]));
        lista.forEach(d => { d.resumo = m.get(d.id) || null; });
      }
    }
    await idbPut("cache", { chave: "meus_dias", lista, em: new Date().toISOString() });
  } else {
    const c = await idbGet("cache", "meus_dias");
    lista = c?.lista || [];
  }
  const noAparelho = new Set((await idbTodos("dia")).map(d => d.rdo_id));
  const devolvido = (d) => d.devolvido_em && (!d.enviado_em || d.devolvido_em > d.enviado_em);
  const filtrada = lista.filter(d => _filtroDias === "todos" ? true
    : _filtroDias === "devolvidos" ? devolvido(d)
    : d.status === "rascunho" && (!d.enviado_em || devolvido(d)));
  filtrada.sort((a, b) => (devolvido(b) - devolvido(a)) || String(b.data).localeCompare(String(a.data)));
  const chip = (v, rot) => `<button type="button" class="op-chip-btn${_filtroDias === v ? " ativo" : ""}" data-filtro-dias="${esc(v)}" aria-pressed="${_filtroDias === v ? "true" : "false"}">${esc(rot)}</button>`;
  box.innerHTML = `<div class="op-chips">${chip("pendentes", "Pendentes")}${chip("devolvidos", "Devolvidos")}${chip("todos", "Todos")}</div>
    ${!filtrada.length ? `<div class="op-vazio">Nenhum dia neste filtro.</div>` : filtrada.map(d => {
      const sit = situacaoDoDia(d);
      const semCopia = !navigator.onLine && !noAparelho.has(d.id);
      return `<button type="button" class="op-card op-card-botao${semCopia ? " op-card-apagado" : ""}" data-abrir-rdo="${esc(d.id)}" ${semCopia ? "disabled" : ""}>
        <span class="op-card-topo"><strong>${dataBR(d.data)}</strong><span class="op-chip">${esc(d.equipamento?.codigo || "")}${d.turno_campo === "noturno" ? " · noturno" : ""}</span></span>
        <span class="op-card-linha">${esc(d.obra?.codigo || "")} · ${esc(d.obra?.nome || "")}</span>
        <span class="op-card-linha">${esc(d.resumo?.qtd_estacas_executadas ?? 0)} estacas · ${num(d.resumo?.metragem_total, 1)} m</span>
        <span class="op-card-linha">${esc(sit.txt)}</span>
        ${semCopia ? `<span class="op-card-linha">📶 precisa de sinal</span>` : ""}
      </button>`;
    }).join("")}`;
};

async function abrirDiaExistente(rdoId){
  if(navigator.onLine){
    const { data, error } = await sb.rpc("rdo_campo_snapshot", { p_rdo: rdoId });
    if(error){ avisar(mensagemDoBanco(error), "erro"); return; }
    await guardarSnapshot(data);
  } else if(!(await carregarDiaDoAparelho(rdoId))){ avisar("Este dia não está no aparelho: precisa de sinal.", "aviso"); return; }
  prefGravar("rdo_atual", rdoId);
  irPara("dia");
}

/* ---------- 12. Eu ---------- */
OP.telas.eu = async function(){
  const box = $("op-eu-conteudo");
  await atualizarFaixaFila();
  const p = OP.perfil || {};
  const s = OP.snap;
  const ruins = _filaCache.filter(o => o.situacao === "rejeitada" || o.situacao === "conflito");
  const pend = _filaCache.filter(o => o.situacao === "pendente");
  const pode = p.cargo === "operador" ? "Lançar e enviar o diário da sua máquina. Não finaliza o RDO nem cadastra obra, máquina ou funcionário."
    : "Lançar e enviar o diário das máquinas das suas obras. Finalizar continua na ficha do RDO.";
  const tetoMB = Number(OP.snap?.config?.fotos_auto_mb || prefLer("fotos_auto_mb", "20")) || 20;
  box.innerHTML = `
    <section class="op-bloco">
      <h2>${esc(OP.funcionario?.nome || p.nome || "")}</h2>
      <p class="op-meta">${esc(OP.funcionario?.funcao || "")}</p>
      ${s ? `<p>${esc(s.equipamento?.codigo || "")} · ${esc(s.obra?.codigo || "")} · ${s.rdo?.turno_campo === "noturno" ? "noturno" : "diurno"}</p>` : ""}
      <p class="op-meta">${esc(pode)}</p>
    </section>
    <section class="op-bloco">
      <h2>Pendências de envio</h2>
      ${!ruins.length && !pend.length ? `<p class="op-meta">✓ Nada aguardando no aparelho.</p>` : ""}
      ${pend.length ? `<p class="op-meta">⏳ ${esc(pend.length)} aguardando sinal.</p>` : ""}
      ${ruins.map(o => `<article class="op-card op-card-perigo">
        <p><strong>${esc(o.rotulo)}</strong> · ${esc(horaDeTimestamp(o.criado_em))} de ${dataBR(o.criado_em)}</p>
        <p>${o.situacao === "conflito" ? "⇄ Conflito" : "⚠ Recusado"}: ${esc(o.erro || "")}</p>
        ${o.situacao === "conflito" ? `<p class="op-meta">No servidor: ${esc(JSON.stringify(o.servidor || {}))}</p>` : ""}
        <div class="op-acoes">
          ${o.situacao === "conflito" ? `<button type="button" class="op-btn" data-pend-manter="${esc(o.seq)}">Manter o meu</button>` : `<button type="button" class="op-btn" data-pend-tentar="${esc(o.seq)}">Tentar de novo</button>`}
          <button type="button" class="op-btn op-btn-perigo" data-pend-descartar="${esc(o.seq)}">Descartar</button>
        </div></article>`).join("")}
      ${pend.length ? `<button type="button" class="op-btn" id="op-btn-sync">Enviar agora</button>` : ""}
    </section>
    <section class="op-bloco">
      <h2>Aparelho</h2>
      <p class="op-meta">Versão do app: ${esc(versaoAtual())}</p>
      <p class="op-meta">Última sincronização: ${OP.ultimaSync ? esc(horaDeTimestamp(OP.ultimaSync.toISOString())) : "—"}</p>
      <p class="op-meta">Relógio do celular × servidor: ${Math.abs(OP.difRelogioMin) <= 1 ? "certo" : esc(OP.difRelogioMin) + " min de diferença"}</p>
      <p class="op-meta">Fotos enviadas hoje: ${num(fotosEnviadasHojeMB(), 1)} de ${num(tetoMB, 0)} MB automáticos</p>
    </section>
    <section class="op-bloco">
      <div class="op-acoes op-acoes-coluna">
        <button type="button" class="op-btn" id="op-btn-trocar-senha">Trocar senha</button>
        <a class="op-btn" href="index.html">Abrir o sistema completo</a>
        <button type="button" class="op-btn op-btn-perigo" id="op-btn-sair">Sair</button>
      </div>
      <p class="op-meta">Sair apaga do celular o diário e o CPF lembrado. O que ainda não subiu fica guardado e sobe no próximo acesso.</p>
    </section>`;
};

async function pendenciaTentar(seq, manter){
  const o = (await lerFila()).find(x => x.seq === seq);
  if(!o) return;
  // nova operação no fim da fila, com novo op_id (a recusada fica registrada em campo_ops)
  await idbDel("outbox", seq);
  const args = Object.assign({}, o.args, { p_op: novoId(), p_em_aparelho: new Date().toISOString() });
  if(manter && "p_anteriores" in args) args.p_anteriores = o.servidor || null;
  await enfileirar(o.rpc, args, { rotulo: o.rotulo, linha_id: o.linha_id });
  agendarDrenagem(0);
  renderTelaAtual();
}
async function pendenciaDescartar(seq){
  const o = (await lerFila()).find(x => x.seq === seq);
  if(!o) return;
  if(!confirm(`Descartar "${o.rotulo}"? O que foi lançado nesta operação não vai para o diário.`)) return;
  await idbDel("outbox", seq);
  if(o.rpc === "rdo_campo_foto_registrar"){
    const up = (await lerFila()).find(x => x.rpc === "upload_foto" && x.args?.foto_id === o.args.p_id);
    if(up){ await idbDel("outbox", up.seq); await idbDel("fotos", o.args.p_id); }
  }
  console.info("[campo] operação descartada pelo usuário:", o.rpc, o.op_id);
  await recarregarDia(true);
  await atualizarFaixaFila();
  renderTelaAtual();
}

/* ---------- Mais ---------- */
OP.telas.mais = async function(){
  const s = OP.snap;
  const tipoRT = s && ehRaizOuTrado(s.rdo?.tipo_servico);
  const itens = s ? [
    ["abast", "⛽", "Abastecimento e horímetro"],
    tipoRT ? ["equipe", "👷", "Equipe do dia"] : ["geo", "📍", "Estacas de hoje"],
    ["foto", "📷", "Fotos"], ["enviar", "📤", "Enviar o dia"], ["maquina", "🚜", "Trocar de máquina"],
    ["dias", "📅", "Meus dias"], ["eu", "👤", "Eu"]
  ] : [["maquina", "🚜", "Minha máquina"], ["dias", "📅", "Meus dias"], ["eu", "👤", "Eu"]];
  $("op-mais-conteudo").innerHTML = itens.map(([t, ic, rot]) =>
    `<button type="button" class="op-item-menu" data-ir="${esc(t)}"><span aria-hidden="true">${esc(ic)}</span>${esc(rot)}</button>`).join("");
};

/* ---------- Eventos (delegação: a CSP não roda handler inline) ---------- */
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button, a");
  if(!el || el.disabled) return;
  const d = el.dataset;
  if(d.ir){ irPara(d.ir); return; }
  if(d.abrir){ el.disabled = true; try { await abrirDia(d.abrir, d.confirmada === "1"); } finally { el.disabled = false; } return; }
  if(d.abrirRdo){ await abrirDiaExistente(d.abrirRdo); return; }
  if(d.filtroDias){ _filtroDias = d.filtroDias; renderTelaAtual(); return; }
  if(d.tempo){ await gravarCabecalho({ [d.tempo]: OP.snap.rdo[d.tempo] === d.valor ? "" : d.valor }); return; }
  if(d.pendTentar){ await pendenciaTentar(Number(d.pendTentar), false); return; }
  if(d.pendManter){ await pendenciaTentar(Number(d.pendManter), true); return; }
  if(d.pendDescartar){ await pendenciaDescartar(Number(d.pendDescartar)); return; }
  switch(el.id){
    case "op-btn-cab-salvar": await gravarCabecalho({ local: $("op-local").value, observacoes: $("op-obs").value }); avisar("Guardado.", "ok"); break;
    case "op-fim-agora": $("op-fim-exp").value = horaAgora(15); break;
    case "op-btn-enviar": await enviarDia(); break;
    case "op-btn-sync": OP.forcarFotos = false; agendarDrenagem(0); avisar("Enviando…"); break;
    case "op-btn-sair": await sair(); break;
    case "op-btn-trocar-senha": mostrarTrocaSenha(false); break;
  }
});
document.addEventListener("change", async (ev) => {
  if(ev.target.id === "op-dds") await gravarCabecalho({ dds_feito: ev.target.checked });
});

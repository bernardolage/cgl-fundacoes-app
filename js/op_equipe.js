/* ====================================================================
   App do operador (fase 129b) — op_equipe.js
   Telas: Equipe do dia (4) e Abastecimento e horímetro (5).
   O app nunca manda horas: o gatilho do banco calcula pela mesma regra da ficha (fase 129a).
   ==================================================================== */

/* espelho local da regra do banco ("Chegamos"/"Saída" pela tolerância do ponto), só para mostrar até sincronizar */
function entradaPelaTolerancia(real){
  const j = minutos(OP.snap?.jornada?.entrada), r = minutos(real), tol = Number(OP.snap?.config?.tolerancia_ponto_min) || 15;
  return j != null && r != null && r < j && j - r <= tol ? hhmm(OP.snap.jornada.entrada) : real;
}
function saidaPelaTolerancia(real){
  const j = minutos(OP.snap?.jornada?.saida), r = minutos(real), tol = Number(OP.snap?.config?.tolerancia_ponto_min) || 15;
  return j != null && r != null && r > j && r - j <= tol ? hhmm(OP.snap.jornada.saida) : real;
}

/* aplica no snapshot o que vai para a fila (a tela mostra na hora, com o selo "no aparelho") */
async function equipeGravar(linha, campos){
  const eq = OP.snap.equipe || (OP.snap.equipe = []);
  let l = linha ? eq.find(x => x.id === linha.id) : null;
  const ant = anteriores(l, campos);
  const id = l?.id || novoId();
  if(!l){
    l = { id, funcionario_id: campos.funcionario_id || null, nome: campos.nome_avulso || "", funcao: null, liberado: false };
    const f = (OP.snap.funcionarios_obra || []).find(x => x.id === campos.funcionario_id);
    if(f){ l.nome = f.nome; l.funcao = f.funcao; }
    eq.push(l);
  }
  for(const [k, v] of Object.entries(campos)){
    if(k === "saida_real") l.hora_saida = saidaPelaTolerancia(v);
    else if(k === "hora_chegada_real"){ l.hora_chegada_real = v; if(!("hora_entrada" in campos)) l.hora_entrada = entradaPelaTolerancia(v); }
    else l[k] = v;
  }
  if("hora_entrada" in campos || "hora_saida" in campos || "saida_real" in campos || "hora_chegada_real" in campos || "intervalo_minutos" in campos){
    l.horas_normais = null; l.horas_100 = null;
  }
  await enfileirar("rdo_campo_equipe_upsert", { p_rdo: OP.rdoId, p_id: id, p_campos: campos, p_anteriores: ant },
    { rotulo: "Equipe: " + (l.nome || "pessoa"), linha_id: id });
}

OP.telas.equipe = async function(){
  const s = OP.snap, box = $("op-equipe-conteudo");
  const ed = diaEditavel();
  const eq = s.equipe || [];
  const naEquipe = new Set(eq.map(e => e.funcionario_id).filter(Boolean));
  const disponiveis = (s.funcionarios_obra || []).filter(f => !naEquipe.has(f.id));
  const opStatus = (v) => `<option value="">Trabalhando</option>` + Object.entries(ROTULO_STATUS_DIA).map(([k, rot]) =>
    `<option value="${esc(k)}" ${v === k ? "selected" : ""}>${esc(rot)}</option>`).join("");
  const opFuncao = (v) => `<option value="">Função da CTPS</option>` + Object.entries(ROTULO_FUNCAO).map(([k, rot]) =>
    `<option value="${esc(k)}" ${v === k ? "selected" : ""}>${esc(rot)}</option>`).join("");
  const jornada = s.jornada?.entrada ? `Jornada ${hhmm(s.jornada.entrada)}–${hhmm(s.jornada.saida)}` : "Jornada não cadastrada na obra";
  box.innerHTML = `
    <p class="op-meta">${esc(jornada)} · as horas são calculadas pelo sistema</p>
    ${ed ? `<div class="op-acoes">
      <button type="button" class="op-btn op-btn-primario" id="op-btn-chegamos">✅ Chegamos</button>
      <button type="button" class="op-btn" id="op-btn-saida-equipe">🏁 Saída da equipe</button>
      <button type="button" class="op-btn" id="op-btn-copiar-ontem">Copiar equipe de ontem</button>
    </div>` : ""}
    <div id="op-folha-chegada" class="op-folha" hidden>
      <h2>Chegada da equipe</h2>
      <label class="op-campo">Hora da chegada<input type="time" id="op-chegada-hora" step="60"></label>
      <p class="op-meta">Clima da manhã</p>
      <div class="op-chips">${Object.entries(ROTULO_TEMPO).map(([v, rot]) => `<button type="button" class="op-chip-btn" data-chegada-tempo="${esc(v)}" aria-pressed="false">${esc(rot)}</button>`).join("")}</div>
      <label class="op-check"><input type="checkbox" id="op-chegada-dds"> DDS feito</label>
      <div class="op-acoes"><button type="button" class="op-btn op-btn-primario" id="op-btn-chegada-ok">Confirmar chegada</button><button type="button" class="op-btn" id="op-btn-chegada-cancelar">Cancelar</button></div>
    </div>
    ${!eq.length ? `<div class="op-vazio">Ninguém na equipe ainda. Adicione as pessoas abaixo ou copie a equipe de ontem.</div>` : ""}
    ${eq.map(e => `<article class="op-card" data-linha="${esc(e.id)}">
      <div class="op-card-topo"><strong>${esc(e.nome || "")}</strong>${seloEstado(e.id, e)}</div>
      <p class="op-meta">${esc(e.funcao || "")}${e.hora_chegada_real ? " · chegou " + esc(hhmm(e.hora_chegada_real)) : ""}${e.horas_normais != null ? " · " + num(e.horas_normais) + " h normais" + (Number(e.horas_100) ? " + " + num(e.horas_100) + " h a 100%" : "") : ""}</p>
      <div class="op-linha-campos">
        <label class="op-campo">Situação<select data-eq-campo="status_dia" ${ed && !e.liberado ? "" : "disabled"}>${opStatus(e.status_dia)}</select></label>
        ${e.status_dia && e.status_dia !== "noturno" && e.status_dia !== "revisar_informacao" ? "" : `
        <label class="op-campo">Entrada<input type="time" step="900" data-eq-campo="hora_entrada" value="${esc(hhmm(e.hora_entrada))}" ${ed && !e.liberado ? "" : "disabled"}></label>
        <label class="op-campo">Saída<input type="time" step="900" data-eq-campo="hora_saida" value="${esc(hhmm(e.hora_saida))}" ${ed && !e.liberado ? "" : "disabled"}></label>
        <label class="op-campo">Intervalo (min)<input type="number" inputmode="numeric" min="0" max="240" step="5" placeholder="60" data-eq-campo="intervalo_minutos" value="${esc(e.intervalo_minutos ?? "")}" ${ed && !e.liberado ? "" : "disabled"}></label>`}
        <label class="op-campo">Função no dia<select data-eq-campo="funcao_no_dia" ${ed && !e.liberado ? "" : "disabled"}>${opFuncao(e.funcao_no_dia)}</select></label>
      </div>
      ${ed && !e.liberado ? `<div class="op-acoes">
        ${e.hora_entrada ? "" : `<button type="button" class="op-btn" data-eq-cheguei="${esc(e.id)}">Cheguei</button>`}
        ${e.hora_entrada && !e.hora_saida ? `<button type="button" class="op-btn" data-eq-sai="${esc(e.id)}">Saí</button>` : ""}
        <button type="button" class="op-btn op-btn-perigo" data-eq-remover="${esc(e.id)}">Remover</button>
      </div>` : ""}
    </article>`).join("")}
    ${ed ? `<section class="op-bloco">
      <h2>Adicionar pessoa</h2>
      <label class="op-campo">Funcionário da obra<select id="op-eq-novo">
        <option value="">Escolha…</option>
        ${disponiveis.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.funcao ? " · " + esc(f.funcao) : ""}</option>`).join("")}
      </select></label>
      <label class="op-campo">Ou nome de quem não está na lista (terceiro)<input type="text" id="op-eq-avulso" maxlength="80"></label>
      <button type="button" class="op-btn op-btn-primario" id="op-btn-eq-add">Adicionar</button>
    </section>` : ""}`;
};

let _chegadaTempo = null;
async function confirmarChegada(){
  const hora = $("op-chegada-hora").value;
  if(!hora){ avisar("Informe a hora da chegada.", "aviso"); return; }
  const semEntrada = (OP.snap.equipe || []).filter(e => !e.hora_entrada && !e.status_dia && !e.liberado);
  if(!semEntrada.length){ avisar("Todos já têm entrada. Adicione as pessoas antes de marcar a chegada.", "aviso"); return; }
  for(const e of semEntrada) await equipeGravar(e, { hora_chegada_real: hora });
  const cab = {};
  if(_chegadaTempo) cab.tempo_manha = _chegadaTempo;
  if($("op-chegada-dds").checked) cab.dds_feito = true;
  if(Object.keys(cab).length) await gravarCabecalho(cab);
  $("op-folha-chegada").hidden = true;
  avisar(`Chegada marcada para ${semEntrada.length} pessoa(s).`, "ok");
  renderTelaAtual();
}
async function saidaDaEquipe(){
  const hora = horaAgora(1);
  const abertos = (OP.snap.equipe || []).filter(e => e.hora_entrada && !e.hora_saida && !e.liberado);
  if(!abertos.length){ avisar("Ninguém com entrada e sem saída.", "aviso"); return; }
  if(!confirm(`Marcar saída às ${hora} para ${abertos.length} pessoa(s)? Dentro da tolerância, a saída fica no horário da jornada.`)) return;
  for(const e of abertos) await equipeGravar(e, { saida_real: hora });
  renderTelaAtual();
}
async function copiarEquipeDeOntem(){
  if(!navigator.onLine){ avisar("Copiar a equipe de ontem precisa de sinal.", "aviso"); return; }
  const r = OP.snap.rdo;
  const { data: dias, error } = await sb.from("rdo").select("id,data").eq("equipamento_id", r.equipamento_id).lt("data", r.data)
    .order("data", { ascending: false }).limit(1);
  if(error || !dias?.length){ avisar(error ? mensagemDoBanco(error) : "Não achei o dia anterior desta máquina.", "aviso"); return; }
  const { data: linhas } = await sb.from("rdo_equipe").select("funcionario_id,nome_avulso,funcao_no_dia").eq("rdo_id", dias[0].id);
  const ja = new Set((OP.snap.equipe || []).map(e => e.funcionario_id).filter(Boolean));
  let n = 0;
  for(const l of linhas || []){
    if(l.funcionario_id && ja.has(l.funcionario_id)) continue;
    if(!l.funcionario_id && !l.nome_avulso) continue;
    const campos = l.funcionario_id ? { funcionario_id: l.funcionario_id } : { nome_avulso: l.nome_avulso };
    if(l.funcao_no_dia) campos.funcao_no_dia = l.funcao_no_dia;
    await equipeGravar(null, campos);
    n++;
  }
  avisar(n ? `${n} pessoa(s) copiadas de ${dataBR(dias[0].data)}, sem horário.` : "A equipe de ontem já está toda aqui.", "ok");
  renderTelaAtual();
}

/* ---------- 5. Abastecimento e horímetro ---------- */
OP.telas.abast = async function(){
  const s = OP.snap, box = $("op-abast-conteudo");
  const ed = diaEditavel();
  const atual = Number(s.equipamento?.horimetro) || null;
  const lista = s.abastecimentos || [];
  box.innerHTML = `
    <p class="op-meta">${esc(s.equipamento?.codigo || "")} · horímetro atual: <strong>${atual ? num(atual, 1) + " h" : "sem leitura"}</strong></p>
    ${!lista.length ? `<div class="op-vazio">Nenhum abastecimento hoje. Dá para lançar só o horímetro.</div>` : ""}
    ${lista.map(a => `<article class="op-card">
      <div class="op-card-topo"><strong>${esc(a.maquina_codigo || s.equipamento?.codigo || "")}</strong>${seloEstado(a.id)}</div>
      <p>${a.quantidade ? num(a.quantidade, 1) + " " + esc(a.unidade || "L") + " de " + esc(a.combustivel || "diesel") : "Só horímetro"}${a.horimetro ? " · " + num(a.horimetro, 1) + " h" : ""}${a.diesel_origem ? " · diesel " + (a.diesel_origem === "cliente" ? "do cliente" : "da CGL") : ""}</p>
      ${a.observacao ? `<p class="op-meta">${esc(a.observacao)}</p>` : ""}
      ${ed ? `<div class="op-acoes"><button type="button" class="op-btn op-btn-perigo" data-ab-remover="${esc(a.id)}">Remover</button></div>` : ""}
    </article>`).join("")}
    ${ed && lista.length < 3 ? `<section class="op-bloco">
      <h2>Novo lançamento</h2>
      <label class="op-campo">Litros<input type="number" inputmode="decimal" min="0" step="0.1" id="op-ab-litros"></label>
      <label class="op-campo">Horímetro (h)<input type="number" inputmode="decimal" min="0" step="0.1" id="op-ab-horimetro"></label>
      <p id="op-ab-alerta" class="op-alerta op-alerta-perigo" hidden></p>
      <p class="op-meta">Diesel de onde?</p>
      <div class="op-chips">
        <label class="op-radio"><input type="radio" name="op-ab-origem" value="cgl" checked> Posto da CGL</label>
        <label class="op-radio"><input type="radio" name="op-ab-origem" value="cliente"> Do cliente</label>
      </div>
      <label class="op-campo">Observação<input type="text" id="op-ab-obs" maxlength="200"></label>
      <button type="button" class="op-btn op-btn-primario" id="op-btn-ab-salvar">Salvar</button>
      <p class="op-meta">Foto do visor: em Fotos, escolha "Abastecimento".</p>
    </section>` : ""}`;
};
async function abastSalvar(){
  const litros = $("op-ab-litros").value, hor = $("op-ab-horimetro").value;
  if(!litros && !hor){ avisar("Informe os litros ou o horímetro.", "aviso"); return; }
  const atual = Number(OP.snap.equipamento?.horimetro) || 0;
  if(hor && Number(hor) < atual){ avisar(`Horímetro menor que o atual (${num(atual, 1)} h): a máquina nunca volta.`, "erro"); return; }
  const lista = OP.snap.abastecimentos || (OP.snap.abastecimentos = []);
  const ordem = lista.reduce((m, a) => Math.max(m, Number(a.ordem) || 0), 0) + 1;
  const campos = { ordem, diesel_origem: document.querySelector('input[name="op-ab-origem"]:checked')?.value || "cgl" };
  if(litros) campos.quantidade = Number(litros);
  if(hor) campos.horimetro = Number(hor);
  if($("op-ab-obs").value.trim()) campos.observacao = $("op-ab-obs").value.trim();
  const id = novoId();
  lista.push(Object.assign({ id, maquina_codigo: OP.snap.equipamento?.codigo, unidade: "L", combustivel: "diesel" }, campos));
  if(hor) OP.snap.equipamento.horimetro = Number(hor);
  await enfileirar("rdo_campo_abastecimento_upsert", { p_rdo: OP.rdoId, p_id: id, p_campos: campos, p_anteriores: null }, { rotulo: "Abastecimento", linha_id: id });
  avisar("Guardado.", "ok");
  renderTelaAtual();
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button");
  if(!el || el.disabled) return;
  const d = el.dataset;
  const linha = (id) => (OP.snap?.equipe || []).find(e => e.id === id);
  if(d.eqCheguei){ await equipeGravar(linha(d.eqCheguei), { hora_chegada_real: horaAgora(1) }); renderTelaAtual(); return; }
  if(d.eqSai){ await equipeGravar(linha(d.eqSai), { saida_real: horaAgora(1) }); renderTelaAtual(); return; }
  if(d.eqRemover){
    const l = linha(d.eqRemover);
    if(!l || !confirm(`Remover ${l.nome || "esta pessoa"} da equipe de hoje?`)) return;
    OP.snap.equipe = OP.snap.equipe.filter(e => e.id !== l.id);
    await enfileirar("rdo_campo_equipe_remover", { p_rdo: OP.rdoId, p_id: l.id }, { rotulo: "Remover da equipe: " + (l.nome || ""), linha_id: l.id });
    renderTelaAtual(); return;
  }
  if(d.abRemover){
    if(!confirm("Remover este lançamento?")) return;
    OP.snap.abastecimentos = (OP.snap.abastecimentos || []).filter(a => a.id !== d.abRemover);
    await enfileirar("rdo_campo_abastecimento_remover", { p_rdo: OP.rdoId, p_id: d.abRemover }, { rotulo: "Remover abastecimento", linha_id: d.abRemover });
    renderTelaAtual(); return;
  }
  if(d.chegadaTempo){
    _chegadaTempo = _chegadaTempo === d.chegadaTempo ? null : d.chegadaTempo;
    document.querySelectorAll("[data-chegada-tempo]").forEach(b => { b.classList.toggle("ativo", b.dataset.chegadaTempo === _chegadaTempo); b.setAttribute("aria-pressed", String(b.dataset.chegadaTempo === _chegadaTempo)); });
    return;
  }
  switch(el.id){
    case "op-btn-chegamos": _chegadaTempo = OP.snap.rdo.tempo_manha || null; $("op-chegada-hora").value = horaAgora(1); $("op-chegada-dds").checked = !!OP.snap.rdo.dds_feito; $("op-folha-chegada").hidden = false; break;
    case "op-btn-chegada-cancelar": $("op-folha-chegada").hidden = true; break;
    case "op-btn-chegada-ok": await confirmarChegada(); break;
    case "op-btn-saida-equipe": await saidaDaEquipe(); break;
    case "op-btn-copiar-ontem": el.disabled = true; try { await copiarEquipeDeOntem(); } finally { el.disabled = false; } break;
    case "op-btn-eq-add": {
      const f = $("op-eq-novo").value, av = $("op-eq-avulso").value.trim();
      if(!f && !av){ avisar("Escolha a pessoa ou escreva o nome.", "aviso"); return; }
      await equipeGravar(null, f ? { funcionario_id: f } : { nome_avulso: av });
      renderTelaAtual(); break;
    }
    case "op-btn-ab-salvar": await abastSalvar(); break;
  }
});
document.addEventListener("change", async (ev) => {
  const el = ev.target;
  if(el.dataset.eqCampo){
    const id = el.closest("[data-linha]")?.dataset.linha;
    const l = (OP.snap?.equipe || []).find(e => e.id === id);
    if(!l) return;
    let v = el.value;
    if(el.dataset.eqCampo === "intervalo_minutos") v = v === "" ? null : Number(v);
    await equipeGravar(l, { [el.dataset.eqCampo]: v === "" ? null : v });
    renderTelaAtual();
  }
});
document.addEventListener("input", (ev) => {
  if(ev.target.id !== "op-ab-horimetro") return;
  const atual = Number(OP.snap?.equipamento?.horimetro) || 0, v = Number(ev.target.value);
  const al = $("op-ab-alerta");
  if(!al) return;
  al.hidden = !(ev.target.value && v < atual);
  al.textContent = `⚠ Menor que o atual (${num(atual, 1)} h): a máquina nunca volta.`;
});

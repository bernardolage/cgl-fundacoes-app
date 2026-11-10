/* ====================================================================
   App do operador (fase 129b) — op_estacas.js
   Tela 6a: estacas do dia em estaca raiz e trado (o campo lança, linha do app_operador).
   Tela 6b: estacas de hoje em hélice contínua e secante (só leitura: chegam do computador de bordo).
   ==================================================================== */

const ETAPAS = {
  estaca_raiz: [["perfurando", "Perfurando"], ["injetada", "Injetada"], ["argamassada", "Argamassada"]],
  trado_mecanizado: [["perfurando", "Perfurando"], ["concretada", "Concretada"]]
};
const ROTULO_REFURO = { obstrucao: "Obstrução", desmoronamento: "Desmoronamento", desvio_locacao: "Desvio de locação",
  ferramenta_quebrou: "Ferramenta quebrou", maquina_parou: "Máquina parou", projeto_alterado: "Projeto alterado",
  erro_operacional: "Erro operacional", teste: "Teste", outro: "Outro" };
const ROTULO_CONTESTAR = { nao_e_minha: "Não é minha", numero_errado: "Número errado", outro: "Outro" };

function etapaDaExecucao(x){
  const m = /\[etapa: ([a-z]+)\]/.exec(x?.observacoes || "");
  return m ? m[1] : (x?.etapa_final || null);
}
function obsSemEtapa(t){ return String(t || "").replace(/\[etapa: [a-z]+\]\s*/g, "").trim(); }
function proximaEstacaPrevista(){
  const feitas = new Set((OP.snap.execucoes || []).map(x => String(x.estaca_numero || "").toUpperCase()));
  return (OP.snap.estacas_previstas || []).find(e => !feitas.has(String(e.numero).toUpperCase()) && e.status !== "executada" && e.status !== "concretada") || null;
}

let _estEditando = null;   // id da execução em edição ou "nova"
let _estEtapa = null;

/* ---------- 6a. Raiz e trado ---------- */
OP.telas.estacas = async function(){
  const s = OP.snap, box = $("op-estacas-conteudo");
  const tipo = s.rdo.tipo_servico;
  if(!ehRaizOuTrado(tipo)){ irPara("geo"); return; }
  const ed = diaEditavel();
  const lista = s.execucoes || [];
  const metros = lista.filter(x => x.modalidade_execucao !== "refuro").reduce((t, x) => t + (Number(x.profundidade_executada) || 0), 0);
  box.innerHTML = `
    <p class="op-meta">${esc(lista.length)} estaca(s) · ${num(metros, 2)} m de avanço${lista.some(x => x.modalidade_execucao === "refuro") ? " · Refurada não conta no avanço" : ""}</p>
    ${ed && _estEditando == null ? `<button type="button" class="op-btn op-btn-primario op-btn-grande" id="op-btn-est-nova">+ Nova estaca</button>` : ""}
    ${_estEditando != null ? formularioEstaca(tipo) : ""}
    ${!lista.length && _estEditando == null ? `<div class="op-vazio">Nenhuma estaca lançada hoje.</div>` : ""}
    ${lista.map(x => {
      const doApp = x.origem_dados === "app_operador";
      const et = etapaDaExecucao(x);
      return `<article class="op-card${x.modalidade_execucao === "refuro" ? " op-card-apagado" : ""}">
        <div class="op-card-topo"><strong>${esc(x.estaca_numero || "")}</strong>${doApp ? seloEstado(x.id) : `<span class="op-selo">${esc(x.origem_dados || "outra origem")}</span>`}</div>
        <p>${x.profundidade_executada != null ? num(x.profundidade_executada, 2) + " m" : "sem profundidade"}${x.diametro_mm ? " · Ø " + esc(x.diametro_mm) : ""}${et ? " · " + esc(et) : ""}${x.modalidade_execucao === "refuro" ? " · Refurada" : ""}</p>
        ${x.numero_boletim_fisico ? `<p class="op-meta">Boletim nº ${esc(x.numero_boletim_fisico)}</p>` : ""}
        ${obsSemEtapa(x.observacoes) ? `<p class="op-meta">${esc(obsSemEtapa(x.observacoes))}</p>` : ""}
        ${ed && doApp ? `<div class="op-acoes">
          <button type="button" class="op-btn" data-est-editar="${esc(x.id)}">Editar</button>
          ${x.estaca_id ? "" : `<button type="button" class="op-btn" data-est-fora="${esc(x.id)}">Estaca fora do projeto</button>`}
          <button type="button" class="op-btn op-btn-perigo" data-est-remover="${esc(x.id)}">Remover</button>
        </div>` : ""}
        ${!doApp ? `<p class="op-meta">Lançada por outra origem: a correção é na ficha do engenheiro.</p>` : ""}
      </article>`;
    }).join("")}`;
};

function formularioEstaca(tipo){
  const x = _estEditando === "nova" ? null : (OP.snap.execucoes || []).find(e => e.id === _estEditando);
  const prox = x ? null : proximaEstacaPrevista();
  const v = (k, padrao = "") => esc(x?.[k] ?? padrao);
  const refuro = x?.modalidade_execucao === "refuro";
  const raiz = tipo === "estaca_raiz";
  const prev = (OP.snap.estacas_previstas || []);
  return `<section class="op-bloco" id="op-est-form">
    <h2>${x ? "Editar estaca " + esc(x.estaca_numero) : "Nova estaca"}</h2>
    <label class="op-campo">Número da estaca<input type="text" id="op-est-numero" list="op-est-previstas" autocomplete="off" maxlength="30"
      value="${x ? v("estaca_numero") : esc(prox?.numero || "")}"></label>
    <datalist id="op-est-previstas">${prev.map(e => `<option value="${esc(e.numero)}">${esc(e.local || "")}${e.diametro_mm ? " · Ø " + esc(e.diametro_mm) : ""}</option>`).join("")}</datalist>
    ${prox ? `<p class="op-meta">Sugestão: a próxima prevista é ${esc(prox.numero)}${prox.profundidade_m ? " (" + num(prox.profundidade_m, 2) + " m de projeto)" : ""}.</p>` : ""}
    <p class="op-meta">Etapa</p>
    <div class="op-chips">${(ETAPAS[tipo] || []).map(([val, rot]) =>
      `<button type="button" class="op-chip-btn${_estEtapa === val ? " ativo" : ""}" data-est-etapa="${esc(val)}" aria-pressed="${_estEtapa === val}">${esc(rot)}</button>`).join("")}</div>
    <label class="op-campo">Profundidade executada (m)<input type="number" inputmode="decimal" min="0" step="0.01" id="op-est-prof" value="${v("profundidade_executada")}"></label>
    <label class="op-campo">Nº do boletim em papel<input type="text" id="op-est-boletim" maxlength="30" value="${v("numero_boletim_fisico")}"></label>
    <label class="op-check"><input type="checkbox" id="op-est-refuro" ${refuro ? "checked" : ""}> Refurada (refuro)</label>
    <div id="op-est-refuro-campos" ${refuro ? "" : "hidden"}>
      <label class="op-campo">Motivo da Refurada<select id="op-est-refuro-motivo"><option value="">Escolha…</option>
        ${Object.entries(ROTULO_REFURO).map(([k, r]) => `<option value="${esc(k)}" ${x?.refuro_motivo === k ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></label>
    </div>
    <details class="op-detalhes">
      <summary>Mais dados</summary>
      ${raiz ? `
      <label class="op-campo">Perfuração de (m)<input type="number" inputmode="decimal" step="0.01" id="op-est-de" value="${v("perfuracao_de_m")}"></label>
      <label class="op-campo">Perfuração até (m)<input type="number" inputmode="decimal" step="0.01" id="op-est-ate" value="${v("perfuracao_ate_m")}"></label>
      <label class="op-campo">Cimento<input type="text" id="op-est-cimento" maxlength="30" value="${v("consumo_cimento_raiz")}"></label>
      <label class="op-campo">Areia<input type="text" id="op-est-areia" maxlength="30" value="${v("consumo_areia_raiz")}"></label>
      <label class="op-campo">Água (L)<input type="number" inputmode="decimal" step="1" id="op-est-agua" value="${v("agua_l")}"></label>
      <label class="op-campo">Volume injetado (m³)<input type="number" inputmode="decimal" step="0.01" id="op-est-volinj" value="${v("volume_injetado_m3")}"></label>
      <label class="op-campo">Pressão de injeção (kgf/cm²)<input type="number" inputmode="decimal" step="0.1" id="op-est-pressao" value="${v("pressao_injecao_kgcm2")}"></label>
      <label class="op-campo">Inclinação<input type="text" id="op-est-inclinacao" maxlength="20" value="${v("inclinacao")}"></label>
      <label class="op-campo">Ferramental (coroa, tubos)<input type="text" id="op-est-ferramental" maxlength="120" value="${v("identificacao_acessorios")}"></label>` : `
      <label class="op-campo">Ø (mm)<input type="number" inputmode="numeric" step="10" id="op-est-diam" value="${v("diametro_mm")}"></label>
      <label class="op-campo">Volume de concreto (m³)<input type="number" inputmode="decimal" step="0.01" id="op-est-vol" value="${v("volume_concreto_m3")}"></label>
      <div class="op-acoes">
        <button type="button" class="op-btn" data-est-agora="perfuracao_inicio">Início da perfuração: agora</button>
        <button type="button" class="op-btn" data-est-agora="concretagem_fim">Fim da concretagem: agora</button>
      </div>
      <p class="op-meta" id="op-est-horas">${x?.perfuracao_inicio ? "Início " + esc(horaDeParede(x.perfuracao_inicio)) : ""}${x?.concretagem_fim ? " · fim " + esc(horaDeParede(x.concretagem_fim)) : ""}</p>`}
      <label class="op-campo">Observação<input type="text" id="op-est-obs" maxlength="300" value="${esc(obsSemEtapa(x?.observacoes))}"></label>
    </details>
    <div class="op-acoes">
      <button type="button" class="op-btn op-btn-primario" id="op-btn-est-salvar">Salvar</button>
      <button type="button" class="op-btn" id="op-btn-est-cancelar">Cancelar</button>
    </div>
  </section>`;
}

let _estHoras = {};
async function salvarEstaca(){
  const s = OP.snap, tipo = s.rdo.tipo_servico;
  const x = _estEditando === "nova" ? null : (s.execucoes || []).find(e => e.id === _estEditando);
  const numero = $("op-est-numero").value.trim().toUpperCase();
  if(!numero){ avisar("Informe o número da estaca.", "aviso"); return; }
  const refuro = $("op-est-refuro").checked;
  if(refuro && !$("op-est-refuro-motivo").value){ avisar("Escolha o motivo da Refurada.", "aviso"); return; }
  if(!x && !refuro && (s.execucoes || []).some(e => e.modalidade_execucao !== "refuro" && String(e.estaca_numero).toUpperCase() === numero)){
    if(!confirm(`A estaca ${numero} já está no dia. Atualizar a que existe?`)) return;
  }
  const lidos = {
    estaca_numero: numero,
    profundidade_executada: $("op-est-prof").value,
    numero_boletim_fisico: $("op-est-boletim").value.trim(),
    modalidade_execucao: refuro ? "refuro" : "furo_normal",
    refuro_motivo: refuro ? $("op-est-refuro-motivo").value : "",
    observacoes: $("op-est-obs").value.trim()
  };
  const mapa = tipo === "estaca_raiz"
    ? { perfuracao_de_m: "op-est-de", perfuracao_ate_m: "op-est-ate", consumo_cimento_raiz: "op-est-cimento", consumo_areia_raiz: "op-est-areia",
        agua_l: "op-est-agua", volume_injetado_m3: "op-est-volinj", pressao_injecao_kgcm2: "op-est-pressao", inclinacao: "op-est-inclinacao",
        identificacao_acessorios: "op-est-ferramental" }
    : { diametro_mm: "op-est-diam", volume_concreto_m3: "op-est-vol" };
  for(const [k, id] of Object.entries(mapa)) lidos[k] = $(id).value.trim();
  Object.assign(lidos, _estHoras);
  // só o que mudou vai para o banco (e o que o aparelho via antes, para o conflito)
  const campos = {};
  for(const [k, val] of Object.entries(lidos)){
    const antes = x ? (k === "observacoes" ? obsSemEtapa(x.observacoes) : (x[k] ?? "")) : "";
    if(String(val ?? "") !== String(antes ?? "")) campos[k] = val === "" ? null : val;
  }
  if(!x) campos.estaca_numero = numero;
  if(_estEtapa && _estEtapa !== etapaDaExecucao(x)) campos.etapa = _estEtapa;
  if(x && !Object.keys(campos).length){ _estEditando = null; renderTelaAtual(); return; }
  // observação sem a etapa: o banco recoloca a marca [etapa: …]
  if("observacoes" in campos && !campos.etapa && etapaDaExecucao(x)) campos.etapa = etapaDaExecucao(x);
  const id = x?.id || novoId();
  const ant = x ? anteriores(x, Object.fromEntries(Object.keys(campos).filter(k => k !== "etapa").map(k => [k, 1]))) : null;
  // espelho local
  const linha = x || { id, origem_dados: "app_operador", estaca_id: null };
  for(const [k, val] of Object.entries(campos)) if(k !== "etapa" && k !== "observacoes") linha[k] = val;
  if("observacoes" in campos || campos.etapa){
    const et = campos.etapa || etapaDaExecucao(x);
    const ob = "observacoes" in campos ? (campos.observacoes || "") : obsSemEtapa(x?.observacoes);
    linha.observacoes = (et ? `[etapa: ${et}]` : "") + (ob ? (et ? " " : "") + ob : "");
  }
  if(!x) (s.execucoes || (s.execucoes = [])).push(linha);
  await enfileirar("rdo_campo_execucao_upsert", { p_rdo: OP.rdoId, p_id: id, p_campos: campos, p_anteriores: ant },
    { rotulo: "Estaca " + numero, linha_id: id });
  _estEditando = null; _estEtapa = null; _estHoras = {};
  avisar(`Estaca ${numero} guardada.`, "ok");
  renderTelaAtual();
}

async function estacaForaDoProjeto(execId){
  if(!navigator.onLine){ avisar("Criar a estaca no projeto precisa de sinal.", "aviso"); return; }
  if(estadoDaLinha(execId)){ avisar("Espere a estaca subir antes de criá-la no projeto.", "aviso"); return; }
  const x = (OP.snap.execucoes || []).find(e => e.id === execId);
  if(!confirm(`Criar a estaca ${x?.estaca_numero || ""} no projeto da obra? O engenheiro confere depois.`)) return;
  const { error } = await sb.rpc("estaca_criar_do_campo", { p_exec: execId });
  if(error){ avisar(mensagemDoBanco(error), "erro"); return; }
  avisar("Estaca criada no projeto.", "ok");
  await recarregarDia(true);
  renderTelaAtual();
}

/* ---------- 6b. Hélice contínua e secante ---------- */
OP.telas.geo = async function(){
  const s = OP.snap, box = $("op-geo-conteudo");
  if(ehRaizOuTrado(s.rdo.tipo_servico)){ irPara("estacas"); return; }
  const ed = diaEditavel();
  const lista = s.execucoes || [];
  const comCpu = !!(s.cpu_vinculada && s.sync_ativo);
  const metros = lista.filter(x => x.modalidade_execucao !== "refuro").reduce((t, x) => t + (Number(x.profundidade_executada) || 0), 0);
  box.innerHTML = `
    <p class="op-meta">${esc(lista.length)} estaca(s) · ${num(metros, 2)} m · atualizado ${esc(horaDeTimestamp(OP.snapVistoEm) || "")}</p>
    <div class="op-acoes"><button type="button" class="op-btn" id="op-btn-geo-atualizar">Atualizar</button>
      ${ed && comCpu ? `<button type="button" class="op-btn" id="op-btn-geo-faltou">Faltou estaca</button>` : ""}</div>
    <div id="op-geo-faltou-folha" class="op-folha" hidden>
      <h2>Estaca que não chegou</h2>
      <label class="op-campo">Números (separe por vírgula)<input type="text" id="op-geo-faltou-numeros" maxlength="200"></label>
      <div class="op-acoes"><button type="button" class="op-btn op-btn-primario" id="op-btn-geo-faltou-ok">Avisar o engenheiro</button><button type="button" class="op-btn" id="op-btn-geo-faltou-cancelar">Cancelar</button></div>
    </div>
    ${!lista.length ? `<div class="op-vazio">${comCpu ? "Nenhuma estaca chegou do computador de bordo hoje. Se a máquina trabalhou, toque em Faltou estaca." : "Nesta máquina as estacas entram pelo relatório do Maya ou pelo engenheiro. Aqui você só confere."}</div>` : ""}
    ${lista.map(x => `<article class="op-card${x.modalidade_execucao === "refuro" ? " op-card-apagado" : ""}" data-geo="${esc(x.id)}">
      <div class="op-card-topo"><strong>${esc(x.estaca_numero || "")}</strong>${seloEstado(x.id)}</div>
      <p>${x.profundidade_executada != null ? num(x.profundidade_executada, 2) + " m" : ""}${x.diametro_mm ? " · Ø " + esc(x.diametro_mm) : ""}${x.volume_concreto_m3 ? " · " + num(x.volume_concreto_m3, 2) + " m³" : ""}${x.modalidade_execucao === "refuro" ? " · Refurada" : ""}</p>
      <p class="op-meta">${x.perfuracao_inicio ? esc(horaDeParede(x.perfuracao_inicio)) : ""}${x.concretagem_fim ? "–" + esc(horaDeParede(x.concretagem_fim)) : ""}</p>
      ${x.observacoes ? `<p class="op-meta">${esc(x.observacoes)}</p>` : ""}
      ${ed ? `<div class="op-acoes">
        <button type="button" class="op-btn" data-geo-observar="${esc(x.id)}">Observar</button>
        <button type="button" class="op-btn" data-geo-contestar="${esc(x.id)}">Contestar</button>
      </div>` : ""}
    </article>`).join("")}`;
};

async function geoObservar(id){
  const x = (OP.snap.execucoes || []).find(e => e.id === id);
  const t = prompt(`Observação da estaca ${x?.estaca_numero || ""}:`);
  if(t == null || !t.trim()) return;
  x.observacoes = (x.observacoes ? x.observacoes + "\n" : "") + "[campo] " + t.trim();
  await enfileirar("rdo_campo_execucao_observar", { p_rdo: OP.rdoId, p_id: id, p_texto: t.trim() }, { rotulo: "Observação da estaca " + (x?.estaca_numero || ""), linha_id: id });
  renderTelaAtual();
}
async function geoContestar(id){
  const x = (OP.snap.execucoes || []).find(e => e.id === id);
  const op = prompt(`Contestar a estaca ${x?.estaca_numero || ""}. Digite 1, 2 ou 3:\n1 · ${ROTULO_CONTESTAR.nao_e_minha}\n2 · ${ROTULO_CONTESTAR.numero_errado}\n3 · ${ROTULO_CONTESTAR.outro}`);
  const motivo = { "1": "nao_e_minha", "2": "numero_errado", "3": "outro" }[String(op || "").trim()];
  if(!motivo) return;
  const texto = prompt("Explique em poucas palavras (opcional):") || "";
  await enfileirar("rdo_campo_execucao_contestar", { p_rdo: OP.rdoId, p_id: id, p_motivo: motivo, p_texto: texto.trim() || null },
    { rotulo: "Contestação da estaca " + (x?.estaca_numero || ""), linha_id: id });
  avisar("Contestação guardada: vai para o engenheiro.", "ok");
  renderTelaAtual();
}

/* ---------- Eventos ---------- */
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button");
  if(!el || el.disabled) return;
  const d = el.dataset;
  if(d.estEditar){ _estEditando = d.estEditar; _estEtapa = etapaDaExecucao((OP.snap.execucoes || []).find(e => e.id === d.estEditar)); _estHoras = {}; renderTelaAtual(); return; }
  if(d.estEtapa){
    _estEtapa = _estEtapa === d.estEtapa ? null : d.estEtapa;
    document.querySelectorAll("[data-est-etapa]").forEach(b => { b.classList.toggle("ativo", b.dataset.estEtapa === _estEtapa); b.setAttribute("aria-pressed", String(b.dataset.estEtapa === _estEtapa)); });
    return;
  }
  if(d.estAgora){
    _estHoras[d.estAgora] = horaParedeAgora();   // fase 155a: hora de parede, como a ficha do RDO
    const p = $("op-est-horas");
    if(p) p.textContent = Object.entries(_estHoras).map(([k, v]) => (k === "perfuracao_inicio" ? "Início " : "Fim ") + horaDeParede(v)).join(" · ");
    return;
  }
  if(d.estRemover){
    const x = (OP.snap.execucoes || []).find(e => e.id === d.estRemover);
    if(!x || !confirm(`Remover a estaca ${x.estaca_numero} do dia?`)) return;
    OP.snap.execucoes = OP.snap.execucoes.filter(e => e.id !== x.id);
    await enfileirar("rdo_campo_execucao_remover", { p_rdo: OP.rdoId, p_id: x.id }, { rotulo: "Remover estaca " + x.estaca_numero, linha_id: x.id });
    renderTelaAtual(); return;
  }
  if(d.estFora){ el.disabled = true; try { await estacaForaDoProjeto(d.estFora); } finally { el.disabled = false; } return; }
  if(d.geoObservar){ await geoObservar(d.geoObservar); return; }
  if(d.geoContestar){ await geoContestar(d.geoContestar); return; }
  switch(el.id){
    case "op-btn-est-nova": _estEditando = "nova"; _estEtapa = "perfurando"; _estHoras = {}; renderTelaAtual(); break;
    case "op-btn-est-cancelar": _estEditando = null; _estEtapa = null; _estHoras = {}; renderTelaAtual(); break;
    case "op-btn-est-salvar": el.disabled = true; try { await salvarEstaca(); } finally { el.disabled = false; } break;
    case "op-btn-geo-atualizar": el.disabled = true; try { await drenar(); if(await recarregarDia()) avisar("Atualizado.", "ok"); renderTelaAtual(); } finally { el.disabled = false; } break;
    case "op-btn-geo-faltou": $("op-geo-faltou-folha").hidden = false; $("op-geo-faltou-numeros").focus(); break;
    case "op-btn-geo-faltou-cancelar": $("op-geo-faltou-folha").hidden = true; break;
    case "op-btn-geo-faltou-ok": {
      const n = $("op-geo-faltou-numeros").value.trim();
      if(!n){ avisar("Informe os números.", "aviso"); return; }
      await enfileirar("rdo_campo_faltou_estaca", { p_rdo: OP.rdoId, p_numeros: n, p_foto: null }, { rotulo: "Faltou estaca: " + n });
      avisar("Aviso guardado: vai para o engenheiro conferir.", "ok");
      $("op-geo-faltou-folha").hidden = true;
      break;
    }
  }
});
document.addEventListener("change", (ev) => {
  if(ev.target.id === "op-est-refuro") $("op-est-refuro-campos").hidden = !ev.target.checked;
});

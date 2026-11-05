/* ====================================================================
   Fase 151 (#253 e #131): linha do tempo do funcionário.
   Movimentar (func-mov-), baixada feita ou comprada (func-bx-), aba Linha do tempo e
   correção de período (func-lt-) e visão Conferir alocação (func-lot-).
   A logística lança a obra; o diário só confere. Período errado se corrige, nunca se cancela:
   fn_apropriar_competencia lê alocacoes sem olhar status. Nada aqui gera título: a baixada comprada
   e a feita só guardam a decisão, o título é da fase seguinte.
   ==================================================================== */
const FUNC_LOT_CARGOS  = ["diretor", "admin", "logistica", "rh"];        // lotacao_pode_operar() no banco
const FUNC_AVAL_CARGOS = ["diretor", "logistica", "rh", "auditor"];      // pode_ler_avaliacao() no banco
const FUNC_MOV_MOTIVO = { inicio: "Início", transferencia: "Transferência", retorno: "Retorno à obra", troca_tag: "Troca de TAG", correcao: "Correção", conferencia: "Conferência" };
const FUNC_LOT_SITUACAO = {
  igual:             { label: "Igual ao diário",  cor: "verde" },
  diferente:         { label: "Diário diferente", cor: "ambar" },
  sem_diario:        { label: "Sem diário",       cor: "cinza" },
  obra_encerrada:    { label: "Obra encerrada",   cor: "vermelho" },
  demitido_com_obra: { label: "Demitido com obra", cor: "vermelho" }
};

function lotacaoPodeOperar(){ return !!usuarioAtual && !ehSomenteLeitura() && FUNC_LOT_CARGOS.includes(usuarioAtual.cargo); }
function funcPodeLerAvaliacao(){ return !!usuarioAtual && FUNC_AVAL_CARGOS.includes(usuarioAtual.cargo); }

function funcLotAplicarVisibilidade(){
  const pode = lotacaoPodeOperar();
  const v = document.querySelector('#func-painel .serv-view-btn[data-view="lotacao"]');
  if(v) v.style.display = pode ? "" : "none";
  const acoes = $("func-lt-acoes"); if(acoes) acoes.style.display = pode ? "" : "none";
  const lista = $("func-lt-lista"); if(lista) lista.innerHTML = "";
  const cont = $("func-lt-cont"); if(cont) cont.textContent = "";
}

/* ---------- opções de obra e TAG ---------- */
let _funcLotOpcoes = null;
async function funcLotCarregarOpcoes(){
  if(_funcLotOpcoes) return _funcLotOpcoes;
  const [o, e] = await Promise.all([
    lerTudo(() => sb.from("obras").select("id,codigo,nome").in("status", ["em_andamento", "planejada"])),
    lerTudo(() => sb.from("equipamentos").select("id,codigo").eq("ativo", true))
  ]);
  if(o.error || e.error) return null;
  const porCodigo = (a, b) => String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR", { numeric: true });
  _funcLotOpcoes = {
    obras: (o.data || []).map(x => ({ id: x.id, txt: `${x.codigo || ""} · ${x.nome || ""}`, codigo: x.codigo })).sort(porCodigo),
    tags:  (e.data || []).map(x => ({ id: x.id, txt: x.codigo || "", codigo: x.codigo })).sort(porCodigo)
  };
  return _funcLotOpcoes;
}
/* preenche o select e garante a opção atual, mesmo de obra já encerrada ou TAG inativa */
function funcLotPreencher(sel, itens, vazio, atualId, atualTxt){
  const lista = atualId && !itens.some(i => i.id === atualId) ? [{ id: atualId, txt: atualTxt || "(atual)" }].concat(itens) : itens;
  preencherSelect(sel, lista, "id", "txt", vazio);
  sel.value = atualId || "";
}
function funcLotPeriodoAtual(id){
  return sb.from("alocacoes").select("id,obra_id,equipamento_id,data_inicio,obra:obras(codigo,nome),equipamento:equipamentos(codigo)")
    .eq("funcionario_id", id).eq("status", "ativa").maybeSingle();
}
function funcLotSomarDias(iso, n){
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dataLocalISO(d);
}
function funcLotFichaAberta(id){ return funcEditId === id && $("func-ficha")?.style.display !== "none"; }
/* depois de gravar: as duas visões recarregam; com a ficha aberta, a linha do tempo volta a ser lida */
async function funcLotAposGravar(id, recarregarFicha){
  _funcLog = null; _funcLotConf = null;
  if(recarregarFicha){
    await carregarFuncionarios();
    if(funcLotFichaAberta(id)){ await abrirFuncionario(id); ativarTabFunc("linhatempo"); }
  }
  if(funcLotFichaAberta(id)) await funcLtCarregar(id);
  else renderFuncionarios();
}

/* ---------- Movimentar ---------- */
let _funcMov = null;
async function funcMovAbrir(id, nome, preset){
  if(!lotacaoPodeOperar()) return;
  const [op, at] = await Promise.all([funcLotCarregarOpcoes(), funcLotPeriodoAtual(id)]);
  if(!op || at.error){ aviso("app-aviso", "Não foi possível abrir: " + (at.error?.message || "erro ao ler obras e TAGs."), "erro"); return; }
  const atual = at.data || null, p = preset || {};
  _funcMov = { id, nome, atual };
  $("func-mov-titulo").textContent = `Movimentar: ${nome}`;
  const obraAtualTxt = atual?.obra ? `${atual.obra.codigo || ""} · ${atual.obra.nome || ""}` : "";
  funcLotPreencher($("func-mov-obra"), op.obras, "Sem obra", p.obra_id !== undefined ? p.obra_id : atual?.obra_id, p.obra_txt || obraAtualTxt);
  funcLotPreencher($("func-mov-tag"), op.tags, "Sem TAG", p.equipamento_id !== undefined ? p.equipamento_id : atual?.equipamento_id, p.tag_txt || atual?.equipamento?.codigo);
  $("func-mov-inicio").value = p.inicio || hojeISO();
  $("func-mov-inicio").max = hojeISO();
  $("func-mov-motivo").value = p.motivo || (atual ? "transferencia" : "inicio");
  $("func-mov-obs").value = "";
  aviso("func-mov-aviso", "", "");
  funcMovResumo();
  $("func-mov-modal").style.display = "flex";
}
function funcMovResumo(){
  const m = _funcMov; if(!m) return;
  const ini = $("func-mov-inicio").value;
  const sel = (s) => s.value ? s.options[s.selectedIndex].text : "sem obra";
  const destino = sel($("func-mov-obra")) + ($("func-mov-tag").value ? " (" + $("func-mov-tag").options[$("func-mov-tag").selectedIndex].text + ")" : "");
  const el = $("func-mov-resumo");
  if(!ini){ el.textContent = "Informe a data de início."; return; }
  if(!m.atual){ el.textContent = `Entra em ${destino} em ${dataBR(ini)}.`; return; }
  if(ini <= m.atual.data_inicio){ el.textContent = `A data precisa ser depois de ${dataBR(m.atual.data_inicio)}, início do período atual.`; return; }
  const origem = m.atual.obra?.codigo || "sem obra";
  el.textContent = `Sai de ${origem} em ${dataBR(funcLotSomarDias(ini, -1))} e entra em ${destino} em ${dataBR(ini)}.`;
}
async function funcMovSalvar(){
  const m = _funcMov; if(!m) return;
  const inicio = $("func-mov-inicio").value;
  if(!inicio){ aviso("func-mov-aviso", "Informe a data de início.", "erro"); return; }
  const { error } = await sb.rpc("funcionario_movimentar", {
    p_funcionario: m.id, p_obra: $("func-mov-obra").value || null, p_equipamento: $("func-mov-tag").value || null,
    p_inicio: inicio, p_motivo: $("func-mov-motivo").value, p_obs: $("func-mov-obs").value.trim() || null
  });
  if(error){ aviso("func-mov-aviso", error.message, "erro"); return; }
  $("func-mov-modal").style.display = "none";
  aviso("app-aviso", "Movimentação registrada.", "ok");
  await funcLotAposGravar(m.id);
}

/* ---------- Baixada: feita ou comprada ---------- */
let _funcBx = null;
function funcBxModo(){
  const feita = $("func-bx-decisao").value === "feita";
  $("func-bx-feita").style.display = feita ? "" : "none";
  $("func-bx-comprada").style.display = feita ? "none" : "";
}
/* baixada = linha existente: aberta registra o retorno; com corrigir = true, altera com motivo */
async function funcBxAbrir(id, nome, baixadaId, corrigir){
  if(!lotacaoPodeOperar()) return;
  const [op, at, bx] = await Promise.all([
    funcLotCarregarOpcoes(), funcLotPeriodoAtual(id),
    baixadaId ? sb.from("funcionario_baixadas").select("*").eq("id", baixadaId).single() : Promise.resolve({ data: null })
  ]);
  if(!op || bx.error){ aviso("app-aviso", "Não foi possível abrir a baixada: " + (bx.error?.message || "erro ao ler obras."), "erro"); return; }
  const b = bx.data, retorno = !!b && !corrigir;
  _funcBx = { id, nome, baixadaId: baixadaId || null, corrigir: !!corrigir, retorno };
  $("func-bx-titulo").textContent = `${retorno ? "Registrar retorno" : corrigir ? "Corrigir baixada" : "Baixada"}: ${nome}`;
  const atual = at.data || null;
  const origemId = b ? b.origem_obra_id : atual?.obra_id;
  funcLotPreencher($("func-bx-origem"), op.obras, "Sem obra", origemId, atual?.obra ? `${atual.obra.codigo || ""} · ${atual.obra.nome || ""}` : "");
  $("func-bx-decisao").value = b?.decisao || "feita";
  $("func-bx-saida").value = b?.data_saida || "";
  $("func-bx-prevista").value = b?.data_retorno_prevista || "";
  $("func-bx-real").value = b?.data_retorno_real || (retorno ? hojeISO() : "");
  $("func-bx-data-decisao").value = b?.data_decisao || hojeISO();
  $("func-bx-obs").value = b?.observacoes || "";
  $("func-bx-motivo").value = "";
  $("func-bx-motivo-campo").style.display = corrigir ? "" : "none";
  // no retorno só a data do retorno muda
  ["func-bx-decisao", "func-bx-saida", "func-bx-prevista", "func-bx-origem"].forEach(x => { $(x).disabled = retorno; });
  aviso("func-bx-aviso", "", "");
  funcBxModo();
  $("func-bx-modal").style.display = "flex";
}
async function funcBxSalvar(){
  const x = _funcBx; if(!x) return;
  const decisao = $("func-bx-decisao").value, obs = $("func-bx-obs").value.trim() || null;
  const motivo = $("func-bx-motivo").value.trim();
  if(x.corrigir && !motivo){ aviso("func-bx-aviso", "Informe o motivo da correção.", "erro"); return; }
  let reg;
  if(decisao === "feita"){
    const saida = $("func-bx-saida").value, real = $("func-bx-real").value || null;
    if(!saida){ aviso("func-bx-aviso", "Informe a data de saída.", "erro"); return; }
    if(real && real < saida){ aviso("func-bx-aviso", "O retorno não pode ser antes da saída.", "erro"); return; }
    if(real && real > hojeISO()){ aviso("func-bx-aviso", "O retorno real não pode ser futuro.", "erro"); return; }
    reg = { decisao, data_saida: saida, data_retorno_prevista: $("func-bx-prevista").value || null, data_retorno_real: real,
      data_decisao: null, origem_obra_id: $("func-bx-origem").value || null, observacoes: obs };
  } else {
    const dec = $("func-bx-data-decisao").value;
    if(!dec){ aviso("func-bx-aviso", "Informe a data da decisão.", "erro"); return; }
    reg = { decisao, data_decisao: dec, data_saida: null, data_retorno_prevista: null, data_retorno_real: null, observacoes: obs };
  }
  if(x.corrigir) reg.motivo_alteracao = motivo;
  const { error } = x.baixadaId
    ? await sb.from("funcionario_baixadas").update(reg).eq("id", x.baixadaId)
    : await sb.from("funcionario_baixadas").insert({ ...reg, funcionario_id: x.id });
  if(error){
    aviso("func-bx-aviso", /funcionario_baixadas_aberta_uq/.test(error.message) ? "Esta pessoa já tem uma baixada em aberto: registre o retorno dela antes." : "Erro ao gravar: " + error.message, "erro");
    return;
  }
  $("func-bx-modal").style.display = "none";
  aviso("app-aviso", x.retorno ? "Retorno registrado." : "Baixada registrada.", "ok");
  await funcLotAposGravar(x.id);
}

/* ---------- Avaliação, situação e observação (quem não tem funcionarios_write também grava) ---------- */
let _funcUpd = null;
async function funcUpdAbrir(id, nome){
  if(!lotacaoPodeOperar()) return;
  const { data: f, error } = await sb.from("vw_funcionarios_logistica").select("id,status,avaliacao,observacao_logistica").eq("id", id).maybeSingle();
  if(error || !f){ aviso("app-aviso", "Não foi possível abrir: " + (error?.message || "funcionário fora da vista."), "erro"); return; }
  _funcUpd = { id, antes: f };
  $("func-lt-upd-titulo").textContent = `Atualizar: ${nome}`;
  const demitido = f.status === "demitido", sel = $("func-lt-upd-status");
  sel.value = demitido ? "" : f.status;
  sel.disabled = demitido;
  $("func-lt-upd-demitido").style.display = demitido ? "" : "none";
  $("func-lt-upd-aval-campo").style.display = funcPodeLerAvaliacao() ? "" : "none";
  $("func-lt-upd-aval").value = f.avaliacao || "";
  $("func-lt-upd-obs").value = f.observacao_logistica || "";
  $("func-lt-upd-motivo").value = "";
  aviso("func-lt-upd-aviso", "", "");
  $("func-lt-upd-modal").style.display = "flex";
}
async function funcUpdSalvar(){
  const u = _funcUpd; if(!u) return;
  const campos = {}, a = u.antes;
  const status = $("func-lt-upd-status").value, motivo = $("func-lt-upd-motivo").value.trim();
  if(!$("func-lt-upd-status").disabled && status && status !== a.status) campos.status = status;
  if(funcPodeLerAvaliacao() && ($("func-lt-upd-aval").value || null) !== (a.avaliacao || null)) campos.avaliacao = $("func-lt-upd-aval").value;
  if(($("func-lt-upd-obs").value.trim() || null) !== (a.observacao_logistica || null)) campos.observacao_logistica = $("func-lt-upd-obs").value.trim();
  if(!Object.keys(campos).length){ aviso("func-lt-upd-aviso", "Nada mudou.", "aviso"); return; }
  if(campos.status && !motivo){ aviso("func-lt-upd-aviso", "Informe o motivo da mudança de situação.", "erro"); return; }
  const { error } = await sb.rpc("funcionario_logistica_atualizar", { p_funcionario: u.id, p_campos: campos, p_motivo: motivo || null });
  if(error){ aviso("func-lt-upd-aviso", error.message, "erro"); return; }
  $("func-lt-upd-modal").style.display = "none";
  aviso("app-aviso", "Atualizado. O valor anterior fica na linha do tempo.", "ok");
  await funcLotAposGravar(u.id, true);
}

/* ---------- Corrigir período: motivo obrigatório, vai para registros_log ---------- */
let _funcCor = null;
async function funcCorAbrir(periodoId, presetFim, presetMotivo){
  if(!lotacaoPodeOperar()) return;
  const [op, p] = await Promise.all([
    funcLotCarregarOpcoes(),
    sb.from("alocacoes").select("id,funcionario_id,obra_id,equipamento_id,data_inicio,data_fim,obra:obras(codigo,nome),equipamento:equipamentos(codigo)").eq("id", periodoId).single()
  ]);
  if(!op || p.error){ aviso("app-aviso", "Não foi possível abrir o período: " + (p.error?.message || "erro ao ler obras."), "erro"); return; }
  const r = p.data;
  _funcCor = { id: r.id, funcionario_id: r.funcionario_id };
  funcLotPreencher($("func-lt-cor-obra"), op.obras, "Sem obra", r.obra_id, r.obra ? `${r.obra.codigo || ""} · ${r.obra.nome || ""}` : "");
  funcLotPreencher($("func-lt-cor-tag"), op.tags, "Sem TAG", r.equipamento_id, r.equipamento?.codigo);
  $("func-lt-cor-inicio").value = r.data_inicio || "";
  $("func-lt-cor-fim").value = presetFim || r.data_fim || "";
  $("func-lt-cor-motivo").value = presetMotivo || "";
  aviso("func-lt-cor-aviso", "", "");
  $("func-lt-cor-modal").style.display = "flex";
}
async function funcCorSalvar(){
  const c = _funcCor; if(!c) return;
  const ini = $("func-lt-cor-inicio").value, motivo = $("func-lt-cor-motivo").value.trim();
  if(!ini){ aviso("func-lt-cor-aviso", "Informe o início do período.", "erro"); return; }
  if(!motivo){ aviso("func-lt-cor-aviso", "Informe o motivo da correção.", "erro"); return; }
  const { error } = await sb.rpc("funcionario_periodo_corrigir", {
    p_id: c.id, p_obra: $("func-lt-cor-obra").value || null, p_equipamento: $("func-lt-cor-tag").value || null,
    p_inicio: ini, p_fim: $("func-lt-cor-fim").value || null, p_motivo: motivo
  });
  if(error){
    aviso("func-lt-cor-aviso", /duplicate|unique/i.test(error.message) ? "Já existe um período em aberto para esta pessoa: informe o fim." : error.message, "erro");
    return;
  }
  $("func-lt-cor-modal").style.display = "none";
  aviso("app-aviso", "Período corrigido.", "ok");
  await funcLotAposGravar(c.funcionario_id);
}

/* ---------- aba Linha do tempo ---------- */
async function funcLtCarregar(id){
  const cont = $("func-lt-lista"); if(!cont) return;
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  const le = funcPodeLerAvaliacao();
  const [aloc, bx, fn, hist, aval] = await Promise.all([
    sb.from("alocacoes").select("id,status,data_inicio,data_fim,motivo,observacoes,conferida_em,created_at,obra:obras(codigo,nome),equipamento:equipamentos(codigo)").eq("funcionario_id", id),
    sb.from("funcionario_baixadas").select("*,origem:obras(codigo)").eq("funcionario_id", id),
    sb.from("funcionario_funcoes").select("id,funcao,data_inicio,data_fim,motivo,observacoes,created_at").eq("funcionario_id", id),
    le ? sb.from("funcionario_historico").select("*").eq("funcionario_id", id) : Promise.resolve({ data: [] }),
    le ? sb.from("funcionario_avaliacoes").select("*").eq("funcionario_id", id) : Promise.resolve({ data: [] })
  ]);
  if(funcEditId !== id) return;
  const erro = aloc.error || bx.error || fn.error || hist.error || aval.error;
  if(erro){ cont.innerHTML = `<p class="vazio">Erro: ${esc(erro.message)}</p>`; return; }
  const pode = lotacaoPodeOperar(), ev = [];
  (aloc.data || []).forEach(a => ev.push({
    data: a.data_inicio, em: a.created_at, tipo: "Obra", cor: "azul",
    o_que: (a.obra ? `${a.obra.codigo || ""} · ${a.obra.nome || ""}` : "Sem obra") + (a.equipamento?.codigo ? ` · ${a.equipamento.codigo}` : ""),
    atual: a.status === "ativa",
    detalhe: [`${dataBR(a.data_inicio)} a ${a.data_fim ? dataBR(a.data_fim) : "hoje"}`, FUNC_MOV_MOTIVO[a.motivo], a.conferida_em ? "conferida" : "", a.observacoes].filter(Boolean).join(" · "),
    acao: pode ? `<button type="button" class="btn-sec btn-sm func-lt-corrigir" data-id="${esc(a.id)}">Corrigir</button>` : ""
  }));
  (bx.data || []).forEach(b => ev.push({
    data: b.data_decisao || b.data_saida || b.data_retorno_real, em: b.created_at, tipo: "Baixada", cor: "ambar",
    o_que: b.decisao === "comprada" ? "Baixada comprada" : b.decisao === "feita" ? "Baixada feita" : "Baixada",
    atual: !!b.data_saida && !b.data_retorno_real,
    detalhe: [b.data_saida ? `Saída ${dataBR(b.data_saida)}` : "", b.data_retorno_prevista ? `previsto ${dataBR(b.data_retorno_prevista)}` : "", b.data_retorno_real ? `retorno ${dataBR(b.data_retorno_real)}` : "",
      b.origem?.codigo ? `de ${b.origem.codigo}` : "", b.observacoes, b.motivo_alteracao ? `corrigida: ${b.motivo_alteracao}` : ""].filter(Boolean).join(" · "),
    acao: pode ? `<button type="button" class="btn-sec btn-sm func-lt-bx" data-id="${esc(b.id)}">Corrigir</button>` : ""
  }));
  (fn.data || []).forEach(f => ev.push({
    data: f.data_inicio, em: f.created_at, tipo: "Função", cor: "cinza", o_que: f.funcao, atual: !f.data_fim,
    detalhe: [FUNC_FF_MOTIVO[f.motivo] || f.motivo, f.observacoes].filter(Boolean).join(" · "), acao: ""
  }));
  (hist.data || []).forEach(h => ev.push({
    data: dataLocalISO(new Date(h.created_at)), em: h.created_at, tipo: h.campo === "status" ? "Situação" : "Observação", cor: "cinza",
    o_que: h.campo === "status" ? `${STATUS.funcionario?.[h.valor_anterior]?.label || h.valor_anterior || "—"} → ${STATUS.funcionario?.[h.valor_novo]?.label || h.valor_novo || "—"}` : (h.valor_novo || "(apagada)"),
    atual: false, detalhe: [h.campo === "status" ? "" : (h.valor_anterior ? `antes: ${h.valor_anterior}` : ""), h.motivo].filter(Boolean).join(" · "), acao: ""
  }));
  (aval.data || []).forEach(v => ev.push({
    data: v.data_efeito, em: v.created_at, tipo: "Avaliação", cor: "cinza", o_que: FUNC_AVAL_LBL[v.avaliacao] || "(sem avaliação)", atual: false, detalhe: v.observacao || "", acao: ""
  }));
  // mais recente primeiro; no mesmo dia, pela hora em que foi lançado (Date, porque as colunas vêm em formatos ISO diferentes)
  ev.sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")) || (new Date(b.em || 0) - new Date(a.em || 0)));
  $("func-lt-cont").textContent = ev.length ? `${ev.length}` : "";
  cont.innerHTML = ev.length
    ? `<div class="tabela-rola"><table class="func-docs-table">
        <thead><tr><th>Data</th><th>Tipo</th><th>O que</th><th>Detalhe</th><th></th></tr></thead>
        <tbody>${ev.map(e => `<tr>
          <td>${dataBR(e.data)}</td><td><span class="tag ${esc(e.cor)}">${esc(e.tipo)}</span></td>
          <td><strong>${esc(e.o_que)}</strong>${e.atual ? ' <span class="tag verde">atual</span>' : ""}</td>
          <td class="meta">${esc(e.detalhe)}</td><td>${/* html */ e.acao}</td>
        </tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Sem lançamentos: nenhuma obra, baixada ou mudança registrada.</p>`;
  const nome = $("func-ficha-nome")?.textContent || "";
  cont.querySelectorAll(".func-lt-corrigir").forEach(b => b.addEventListener("click", () => funcCorAbrir(b.dataset.id)));
  cont.querySelectorAll(".func-lt-bx").forEach(b => b.addEventListener("click", () => funcBxAbrir(id, nome, b.dataset.id, true)));
}

/* ---------- visão Conferir alocação: sugestão do último diário, conferida pela logística ---------- */
let _funcLotConf = null;
let _funcLotFiltro = "a_conferir";
const _funcLotSel = new Set();
const FUNC_LOT_FILTROS = { a_conferir: "A conferir", todas: "Todas", igual: "Igual ao diário", diferente: "Diário diferente", sem_lotacao: "No diário sem alocação", sem_diario: "Sem diário", obra_encerrada: "Obra encerrada", demitido_com_obra: "Demitido com obra" };

function funcLotPassaFiltro(r){
  const f = _funcLotFiltro;
  if(f === "todas") return true;
  if(f === "a_conferir") return !r.conferida_em;
  if(f === "sem_lotacao") return !r.alocacao_id && r.situacao === "diferente";
  return r.situacao === f;
}
/* o que "confirmar" faz nesta linha; nulo = a pessoa escolhe em Movimentar */
function funcLotAcao(r){
  if(r.conferida_em) return null;
  if(r.situacao === "diferente") return "diario";
  if(r.alocacao_id && (r.situacao === "igual" || r.situacao === "sem_diario")) return "manter";
  return null;
}
function funcLotUsarDiario(r){
  return sb.rpc("funcionario_movimentar", {
    p_funcionario: r.funcionario_id, p_obra: r.diario_obra_id, p_equipamento: r.diario_equipamento_id,
    p_inicio: r.diario_data, p_motivo: "conferencia", p_obs: null
  });
}
async function renderFuncLotacao(){
  const cont = $("func-conteudo"); if(!cont) return;
  if(!lotacaoPodeOperar()){ cont.innerHTML = `<p class="vazio">Sem acesso à conferência de alocação.</p>`; return; }
  if(!_funcLotConf){
    cont.innerHTML = `<p class="vazio">Carregando conferência…</p>`;
    const { data, error } = await lerTudo(() => sb.from("vw_funcionarios_lotacao_conferir").select("*"), "funcionario_id");
    if(error){ cont.innerHTML = `<p class="vazio">Erro ao carregar: ${esc(error.message)}</p>`; return; }
    if(_funcView !== "lotacao") return;
    _funcLotConf = data || [];
  }
  const termo = ($("func-busca")?.value || "").trim().toLowerCase();
  const ativos = _funcLotConf.filter(r => r.situacao !== "demitido_com_obra");
  const conferidos = ativos.filter(r => r.conferida_em).length;
  const lista = _funcLotConf.filter(funcLotPassaFiltro)
    .filter(r => !termo || `${r.nome} ${r.funcao || ""} ${r.obra_codigo || ""} ${r.tag || ""} ${r.diario_obra_codigo || ""}`.toLowerCase().includes(termo))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  [..._funcLotSel].forEach(id => { if(!lista.some(r => r.funcionario_id === id && funcLotAcao(r))) _funcLotSel.delete(id); });
  cont.innerHTML = `<div class="meta" style="margin:0 0 8px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
      <span><strong>${esc(conferidos)} de ${esc(ativos.length)}</strong> conferidos</span>
      <select id="func-lot-f-situacao">${Object.entries(FUNC_LOT_FILTROS).map(([k, l]) => `<option value="${esc(k)}"${k === _funcLotFiltro ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <button type="button" class="btn btn-sm" id="btn-func-lot-confirmar" disabled>Confirmar selecionadas</button>
      <span>Sugestão do último diário dos últimos 60 dias. Nada é gravado sem confirmar.</span>
    </div>
    <div class="tabela-rola"><table id="func-lot-tabela">
      <thead><tr><th style="width:28px;"><input type="checkbox" id="func-lot-todos" title="Selecionar as linhas com confirmação direta" /></th><th>Nome</th><th>Função</th><th>Alocação atual</th><th>Último diário</th><th>Situação</th><th></th></tr></thead>
      <tbody>${lista.map(r => {
        const acao = funcLotAcao(r), s = FUNC_LOT_SITUACAO[r.situacao] || { label: r.situacao, cor: "cinza" };
        return `<tr data-id="${esc(r.funcionario_id)}">
          <td>${acao ? `<input type="checkbox" class="func-lot-sel" data-id="${esc(r.funcionario_id)}" ${_funcLotSel.has(r.funcionario_id) ? "checked" : ""} />` : ""}</td>
          <td><strong>${esc(r.nome)}</strong></td><td class="meta">${esc(r.funcao || "—")}</td>
          <td>${esc(r.obra_codigo || "—")}${r.tag ? " · " + esc(r.tag) : ""}${r.data_inicio ? ` <span class="meta">desde ${dataBR(r.data_inicio)}</span>` : ""}</td>
          <td>${r.diario_data ? `${esc(r.diario_obra_codigo || "—")}${r.diario_tag ? " · " + esc(r.diario_tag) : ""} <span class="meta">em ${dataBR(r.diario_data)}</span>` : "—"}</td>
          <td><span class="tag ${esc(s.cor)}">${esc(s.label)}</span>${r.conferida_em ? ` <span class="tag verde">conferido ${dataBR(String(r.conferida_em).slice(0, 10))}</span>` : ""}</td>
          <td style="white-space:nowrap;">
            ${acao === "diario" ? `<button type="button" class="btn btn-sm func-lot-diario" title="Abre período novo com a obra e a TAG do diário">Usar diário</button> ` : ""}
            ${acao === "manter" || (acao === "diario" && r.alocacao_id) ? `<button type="button" class="btn-sec btn-sm func-lot-manter" title="Confirma a alocação atual, sem abrir período">Manter</button> ` : ""}
            ${r.situacao === "demitido_com_obra"
              ? (r.alocacao_id ? `<button type="button" class="btn-sec btn-sm func-lot-encerrar">Encerrar</button>` : "")
              : `<button type="button" class="btn-sec btn-sm func-lot-mov">Movimentar</button>`}
          </td>
        </tr>`;
      }).join("") || `<tr><td colspan="7" class="vazio">Ninguém para os filtros.</td></tr>`}</tbody>
    </table></div>`;
  funcLotAtualizarBotao();
  $("func-lot-f-situacao").addEventListener("change", e => { _funcLotFiltro = e.target.value; renderFuncLotacao(); });
  $("btn-func-lot-confirmar").addEventListener("click", () => comBotaoTravado("btn-func-lot-confirmar", () => funcLotConfirmarSelecionadas()));
  $("func-lot-todos").addEventListener("change", e => {
    cont.querySelectorAll(".func-lot-sel").forEach(cb => { cb.checked = e.target.checked; if(cb.checked) _funcLotSel.add(cb.dataset.id); else _funcLotSel.delete(cb.dataset.id); });
    funcLotAtualizarBotao();
  });
  $("func-lot-tabela").addEventListener("change", e => {
    if(!e.target.classList.contains("func-lot-sel")) return;
    if(e.target.checked) _funcLotSel.add(e.target.dataset.id); else _funcLotSel.delete(e.target.dataset.id);
    funcLotAtualizarBotao();
  });
  $("func-lot-tabela").addEventListener("click", e => {
    const b = e.target.closest("button"); if(!b) return;
    const r = _funcLotConf.find(x => x.funcionario_id === b.closest("tr").dataset.id); if(!r) return;
    if(b.classList.contains("func-lot-mov")) funcMovAbrir(r.funcionario_id, r.nome, { motivo: "conferencia" });
    else if(b.classList.contains("func-lot-encerrar")) funcCorAbrir(r.alocacao_id, hojeISO(), "Demitido: encerrado na conferência de alocação");
    else if(b.classList.contains("func-lot-diario")) comBotaoTravado(b, () => funcLotGravar([r]));
    else if(b.classList.contains("func-lot-manter")) comBotaoTravado(b, () => funcLotManter(r));
  });
}
function funcLotAtualizarBotao(){
  const b = $("btn-func-lot-confirmar"); if(!b) return;
  b.disabled = !_funcLotSel.size;
  b.textContent = _funcLotSel.size ? `Confirmar ${_funcLotSel.size} selecionada(s)` : "Confirmar selecionadas";
}
async function funcLotManter(r){
  const { error } = await sb.rpc("funcionario_lotacao_confirmar", { p_ids: [r.alocacao_id] });
  if(error){ aviso("app-aviso", "Não foi possível confirmar: " + error.message, "erro"); return; }
  aviso("app-aviso", `${r.nome}: alocação confirmada.`, "ok");
  _funcLog = null; _funcLotConf = null;
  renderFuncLotacao();
}
/* uma linha por vez: "diferente" abre período pelo diário e "igual" ou "sem diário" só confirma */
async function funcLotGravar(linhas){
  let ok = 0; const erros = [];
  const manter = linhas.filter(r => funcLotAcao(r) === "manter");
  if(manter.length){
    const { data, error } = await sb.rpc("funcionario_lotacao_confirmar", { p_ids: manter.map(r => r.alocacao_id) });
    if(error) erros.push("Confirmar: " + error.message); else ok += Number(data || 0);
  }
  for(const r of linhas.filter(x => funcLotAcao(x) === "diario")){
    const { error } = await funcLotUsarDiario(r);
    if(error) erros.push(`${r.nome}: ${error.message}`); else ok++;
  }
  _funcLotSel.clear(); _funcLog = null; _funcLotConf = null;
  if(erros.length) aviso("app-aviso", `${ok} gravada(s), ${erros.length} com erro. ${erros.slice(0, 3).join(" · ")}`, "erro");
  else aviso("app-aviso", `${ok} conferida(s).`, "ok");
  renderFuncLotacao();
}
async function funcLotConfirmarSelecionadas(){
  const linhas = (_funcLotConf || []).filter(r => _funcLotSel.has(r.funcionario_id) && funcLotAcao(r));
  if(!linhas.length) return;
  const nDiario = linhas.filter(r => funcLotAcao(r) === "diario").length;
  if(!confirm(`Confirmar ${linhas.length} pessoa(s)? ${nDiario} abrem período novo com a obra e a TAG do último diário; as outras ficam como estão.`)) return;
  await funcLotGravar(linhas);
}

/* Sala de Comando → Logística ou Conferir alocação já filtradas */
function funcAbrirLogisticaPreset(filtro){
  const conf = /^lotacao_/.test(filtro || "");
  _funcView = conf ? "lotacao" : "logistica";
  if(conf) _funcLotFiltro = filtro === "lotacao_ausente" ? "sem_lotacao" : "diferente";
  else _funcLogFiltro = filtro === "baixada_vencida" ? "vencida" : "a_vencer";
  document.querySelectorAll("#func-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === _funcView));
  mostrarPainelFunc();
  renderFuncionarios();
}

/* ---------- listeners ---------- */
function ligarFuncLotacao(){
  ["func-mov-modal", "func-bx-modal", "func-lt-upd-modal", "func-lt-cor-modal"].forEach(id => {
    $(id)?.querySelector(".modal-topo button")?.addEventListener("click", () => { $(id).style.display = "none"; });
  });
  ["func-mov-obra", "func-mov-tag", "func-mov-inicio"].forEach(id => $(id)?.addEventListener("change", funcMovResumo));
  $("btn-func-mov-salvar")?.addEventListener("click", () => comBotaoTravado("btn-func-mov-salvar", funcMovSalvar));
  $("func-bx-decisao")?.addEventListener("change", funcBxModo);
  $("func-bx-saida")?.addEventListener("change", e => {
    if(e.target.value && !$("func-bx-prevista").disabled) $("func-bx-prevista").value = funcLotSomarDias(e.target.value, 7);   // 7 dias corridos, editável
  });
  $("btn-func-bx-salvar")?.addEventListener("click", () => comBotaoTravado("btn-func-bx-salvar", funcBxSalvar));
  $("btn-func-lt-upd-salvar")?.addEventListener("click", () => comBotaoTravado("btn-func-lt-upd-salvar", funcUpdSalvar));
  $("btn-func-lt-cor-salvar")?.addEventListener("click", () => comBotaoTravado("btn-func-lt-cor-salvar", funcCorSalvar));
  const nomeFicha = () => $("func-ficha-nome")?.textContent || "";
  $("btn-func-lt-mov")?.addEventListener("click", () => { if(funcEditId) funcMovAbrir(funcEditId, nomeFicha()); });
  $("btn-func-lt-upd")?.addEventListener("click", () => { if(funcEditId) funcUpdAbrir(funcEditId, nomeFicha()); });
  $("btn-func-lt-bx")?.addEventListener("click", async () => {
    if(!funcEditId) return;
    const { data } = await sb.from("funcionario_baixadas").select("id").eq("funcionario_id", funcEditId).not("data_saida", "is", null).is("data_retorno_real", null).maybeSingle();
    funcBxAbrir(funcEditId, nomeFicha(), data?.id || null);
  });
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarFuncLotacao);
else ligarFuncLotacao();

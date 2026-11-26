













let _prcRegistros = [];
let _prcResumo = null;
let _prcAgenda = [];
let _prcErro = null;
let _prcBusca = "";
let _prcSituacao = "abertos";
let prcEditId = null;
let _prcEventos = [];
let _prcAba = "eventos";
let _prcTempoFiltro = "";
let _prcOpcoes = null;

const PRC_SITUACAO = { ativo: ["Ativo", "verde"], suspenso: ["Suspenso", "ambar"], arquivado: ["Arquivado", "cinza"], encerrado: ["Encerrado", "cinza"] };
const PRC_POLO = { ativo: "CGL autora (polo ativo)", passivo: "CGL ré (polo passivo)", terceiro: "CGL terceira interessada" };
const PRC_POLO_CURTO = { ativo: "Autora", passivo: "Ré", terceiro: "Terceira" };
const PRC_AREA = { civel: "Cível", trabalhista: "Trabalhista", tributario: "Tributário", administrativo: "Administrativo", criminal: "Criminal", outro: "Outro" };
const PRC_EVENTO = { audiencia: "Audiência", prazo: "Prazo", decisao: "Decisão" };
const PRC_EVENTO_SIT = { pendente: ["Pendente", "ambar"], realizado: ["Realizado", "verde"], cancelado: ["Cancelado", "cinza"] };
const PRC_ABAS_SIT = [["abertos", "Em andamento", s => s === "ativo" || s === "suspenso"], ["ativo", "Ativos", s => s === "ativo"],
  ["suspenso", "Suspensos", s => s === "suspenso"], ["encerrados", "Arquivados e encerrados", s => s === "arquivado" || s === "encerrado"],
  ["todos", "Todos", () => true]];


function podeVerProcessos(){ return !!usuarioAtual && ["diretor", "juridico", "auditor"].includes(usuarioAtual.cargo); }
function prcPodeEditar(){ return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "juridico"].includes(usuarioAtual.cargo); }


function prcTag(mapa, v){ const s = mapa[v] || [v || "—", "cinza"]; return `<span class="tag ${esc(s[1])}">${esc(s[0])}</span>`; }
function prcHora(h){ return h ? String(h).slice(0, 5) : ""; }
function prcQuando(data, hora){ return data ? dataBR(data) + (hora ? " " + prcHora(hora) : "") : "—"; }
function prcErroMsg(error){
  if(!error) return "";
  if(ehErroDePermissao(error)) return "Seu cargo não pode fazer isso nos processos.";
  return error.message || String(error);
}

function prcMostrar(ativo){
  const p = $("prc-painel"), c = $("con-painel");
  if(p) p.hidden = !ativo;
  if(c) c.hidden = !!ativo;
}
function prcFechar(){ prcEditId = null; prcMostrar(false); }


async function carregarProcessos(){
  _prcErro = null;
  const limite = dataLocalISO(new Date(Date.now() + 30 * 86400000));
  const [rp, rr, ra] = await Promise.all([
    lerTudo(() => sb.from("vw_processos").select("*")),
    sb.from("vw_processos_resumo").select("*").maybeSingle(),
    sb.from("vw_contratos_agenda").select("*").in("tipo", ["audiencia", "prazo_processo"]).lte("data", limite).order("data")
  ]);
  if(rp.error){ _prcErro = prcErroMsg(rp.error); _prcRegistros = []; }
  else _prcRegistros = (rp.data || []).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  _prcResumo = rr.error ? null : rr.data;
  _prcAgenda = ra.error ? [] : (ra.data || []);
}


async function abrirProcessos(){
  if(!podeVerProcessos()) return;
  prcEditId = null;
  prcMostrar(true);
  const cont = $("prc-painel");
  cont.innerHTML = uiPagina({ trilha: [{ texto: "Contratos", id: "contratos" }, { texto: "Processos" }], titulo: "Processos" })
    + uiCarregando("Carregando processos…");
  await carregarProcessos();
  if(prcEditId) return;
  renderProcessos();
}

function prcKpisHTML(){
  const r = _prcResumo;
  if(_prcErro) return `<div class="ui-kpis prc-kpis">${uiKpi(null, "Processos", "", { erro: _prcErro })}</div>`;
  if(!r) return "";
  const soma = podeVerSomaContratos() && r.valor_causa_total != null
    ? `<div class="prc-kpi-sens" data-val-sens>${uiKpi(brl(r.valor_causa_total), "Valor em causa", "soma dos processos ativos e suspensos")}</div>` : "";
  return `<div class="ui-kpis prc-kpis">${uiKpi(String(r.ativos ?? 0), "Ativos", r.suspensos ? `${r.suspensos} suspenso(s)` : "")}`
    + uiKpi(String(r.audiencias_30d ?? 0), "Audiências", "nos próximos 30 dias")
    + uiKpi(String(r.prazos_7d ?? 0), "Prazos", "nos próximos 7 dias")
    + uiKpi(String(r.vencidos ?? 0), "Sem baixa", "audiência ou prazo com a data passada")
    + `${  soma}</div>`;
}

function prcAgendaHTML(){
  const ev = _prcAgenda;
  return uiSecao("relogio", "Agenda: audiências e prazos", uiTabela({
    vazio: "Nenhuma audiência nem prazo pendente nos próximos 30 dias.",
    chaveLinha: "registro_id",
    colunas: [
      { chave: "data", rotulo: "Data", tipo: "data" },
      { chave: "tipo", rotulo: "O quê", html: a => esc(a.tipo === "audiencia" ? "Audiência" : "Prazo") },
      { chave: "titulo", rotulo: "Item" },
      { chave: "detalhe", rotulo: "Detalhe" },
      { chave: "contrato_numero", rotulo: "Contrato", html: a => a.contrato_numero ? uiCodigo(a.contrato_numero) : "—" },
      { chave: "situacao", rotulo: "Situação", html: a => a.situacao === "vencida" ? '<span class="tag vermelho">sem baixa</span>' : '<span class="tag cinza">a vencer</span>' }
    ],
    linhas: ev
  }), String(ev.length));
}

function prcFiltrados(){
  const def = PRC_ABAS_SIT.find(a => a[0] === _prcSituacao) || PRC_ABAS_SIT[0];
  const termo = _prcBusca.trim().toLowerCase();
  return _prcRegistros.filter(p => def[2](p.situacao) && (!termo
    || `${p.numero_cnj} ${p.parte_contraria || ""} ${p.assunto || ""} ${p.vara || ""} ${p.comarca || ""} ${p.contrato_numero || ""}`.toLowerCase().includes(termo)));
}

function renderProcessos(){
  const cont = $("prc-painel");
  if(!cont || prcEditId) return;
  const pode = prcPodeEditar();
  const lista = prcFiltrados();
  const abas = PRC_ABAS_SIT.map(([id, rot, f]) => ({ id, rotulo: rot, resumo: String(_prcRegistros.filter(p => f(p.situacao)).length) }));
  cont.innerHTML = uiPagina({
      trilha: [{ texto: "Contratos", id: "contratos" }, { texto: "Processos" }],
      titulo: "Processos",
      sub: "Processos judiciais e administrativos da CGL, com audiências, prazos e decisões.",
      acoes: [pode ? { id: "novo", texto: "Novo processo", primaria: true } : null, { id: "voltar", texto: "Voltar aos contratos" }].filter(Boolean)
    })
    + prcKpisHTML()
    + prcAgendaHTML()
    + uiAbas(abas, { ativa: _prcSituacao, rotulo: "Situação do processo" })
    + uiFiltros({ id: "prc-busca", busca: _prcBusca, placeholder: "Buscar por número, parte contrária, assunto, vara ou contrato", total: lista.length, unidade: ["processo", "processos"] })
    + `<div class="prc-tabela">${uiTabela({
        erro: _prcErro,
        chaveLinha: "id",
        vazio: _prcRegistros.length ? "Nenhum processo com esse filtro." : "Nenhum processo cadastrado.",
        colunas: [
          { chave: "numero_cnj", rotulo: "Número", html: p => uiCodigo(p.numero_cnj) },
          { chave: "parte_contraria", rotulo: "Parte contrária" },
          { chave: "polo_cgl", rotulo: "CGL", html: p => esc(PRC_POLO_CURTO[p.polo_cgl] || p.polo_cgl) },
          { chave: "area", rotulo: "Área", html: p => esc(PRC_AREA[p.area] || p.area) },
          { chave: "vara", rotulo: "Vara / comarca", html: p => esc([p.vara, p.comarca].filter(Boolean).join(" · ") || "—") },
          { chave: "contrato_numero", rotulo: "Contrato", html: p => p.contrato_numero ? uiCodigo(p.contrato_numero) : "—" },
          { chave: "proximo_data", rotulo: "Próximo evento", html: p => p.proximo_data
              ? `${esc(prcQuando(p.proximo_data, p.proximo_hora))} · ${esc(PRC_EVENTO[p.proximo_tipo] || "")}`
                + (p.eventos_vencidos ? ` <span class="tag vermelho">${esc(p.eventos_vencidos)} sem baixa</span>` : "")
              : (p.eventos_vencidos ? `<span class="tag vermelho">${esc(p.eventos_vencidos)} sem baixa</span>` : "—") },
          { chave: "valor_causa", rotulo: "Valor da causa", tipo: "brl" },
          { chave: "situacao", rotulo: "Situação", html: p => prcTag(PRC_SITUACAO, p.situacao) }
        ],
        linhas: lista
      })}</div>`;
}


async function abrirProcesso(id){
  if(!podeVerProcessos() || !id) return;
  prcEditId = id;
  prcMostrar(true);
  const cont = $("prc-painel");
  cont.innerHTML = uiPagina({ trilha: [{ texto: "Contratos", id: "contratos" }, { texto: "Processos", id: "processos" }, { texto: "…" }], titulo: "Processo" })
    + uiCarregando();
  const [rp, re] = await Promise.all([
    sb.from("vw_processos").select("*").eq("id", id).maybeSingle(),
    sb.from("processo_eventos").select("*").eq("processo_id", id).order("data", { ascending: false }),
    prcCarregarOpcoes()
  ]);
  if(prcEditId !== id) return;
  if(rp.error || !rp.data){
    cont.innerHTML = uiPagina({ trilha: [{ texto: "Contratos", id: "contratos" }, { texto: "Processos", id: "processos" }, { texto: "Processo" }], titulo: "Processo",
      erro: rp.error ? prcErroMsg(rp.error) : "Processo não encontrado (ou seu cargo não o vê)." });
    return;
  }
  const i = _prcRegistros.findIndex(p => p.id === id);
  if(i >= 0) _prcRegistros[i] = rp.data; else _prcRegistros.unshift(rp.data);
  _prcEventos = re.error ? [] : (re.data || []);
  renderFichaProcesso(rp.data, re.error ? prcErroMsg(re.error) : null);
}

function prcFaixa(p){
  const sit = (PRC_SITUACAO[p.situacao] || [p.situacao])[0];
  const pend = _prcEventos.filter(e => e.situacao === "pendente");
  const hoje = hojeISO();
  const venc = pend.filter(e => e.data < hoje).length;
  const prox = pend.filter(e => e.data >= hoje).sort((a, b) => (a.data + (a.hora || "")).localeCompare(b.data + (b.hora || "")))[0];
  const frases = [sit, PRC_POLO[p.polo_cgl] || p.polo_cgl,
    prox ? `${PRC_EVENTO[prox.tipo]} ${prox.data === hoje ? "hoje" : "em " + prcQuando(prox.data, prox.hora)}` : "nenhuma audiência ou prazo pendente",
    venc ? `${venc} sem baixa (data passada)` : ""];
  const tom = venc ? "perigo" : p.situacao === "suspenso" ? "aviso" : p.situacao === "ativo" ? (prox ? "info" : "ok") : "neutro";
  return uiFaixaSituacao(frases, tom);
}

function prcTabelaEventos(){
  const pode = prcPodeEditar();
  return uiTabela({
    chaveLinha: "id",
    vazio: "Nenhuma audiência, prazo ou decisão registrada.",
    colunas: [
      { chave: "data", rotulo: "Data", html: e => esc(prcQuando(e.data, e.hora)) },
      { chave: "tipo", rotulo: "Tipo", html: e => esc(PRC_EVENTO[e.tipo] || e.tipo) },
      { chave: "titulo", rotulo: "Evento", html: e => `${esc(e.titulo)}${e.resultado ? `<div class="meta">${esc(e.resultado)}</div>` : ""}` },
      { chave: "local", rotulo: "Local ou link", html: e => e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">${esc(e.local || "abrir link")}</a>` : esc(e.local || "—") },
      { chave: "responsavel_id", rotulo: "Responsável", html: e => esc(prcNomeResp(e.responsavel_id)) },
      { chave: "documento", rotulo: "Documento", html: e => /^https?:\/\//i.test(e.documento || "") ? `<a href="${esc(e.documento)}" target="_blank" rel="noopener noreferrer">abrir</a>` : esc(e.documento || "—") },
      { chave: "situacao", rotulo: "Situação", html: e => e.situacao === "pendente" && e.data < hojeISO() ? '<span class="tag vermelho">Sem baixa</span>' : prcTag(PRC_EVENTO_SIT, e.situacao) },
      { chave: "acoes", rotulo: "", html: e => {
          if(!pode) return "";
          const b = [];
          if(e.situacao === "pendente"){
            b.push({ acao: "ev-realizado", id: e.id, texto: e.tipo === "audiencia" ? "Realizada" : "Cumprido", titulo: "Dar baixa com o resultado" });
            b.push({ acao: "ev-cancelar", id: e.id, texto: "Cancelar", titulo: "Cancelar com o motivo (redesignada, acordo, suspensão)" });
          }
          if(e.situacao === "pendente" || e.tipo === "decisao"){
            b.push({ acao: "ev-editar", id: e.id, texto: "Editar" });
            b.push({ acao: "ev-excluir", id: e.id, texto: "Excluir" });
          }
          return `<span class="con-acoes-linha">${b.map(a => `<button type="button" class="ui-btn" data-prc-acao="${esc(a.acao)}" data-id="${esc(a.id)}" title="${esc(a.titulo || a.texto)}">${esc(a.texto)}</button>`).join("")}</span>`;
        } }
    ],
    linhas: _prcEventos
  });
}

function prcDadosHTML(p){
  const rv = (r, v) => uiRotuloValor(r, esc(v == null || v === "" ? "—" : v));
  return `<div class="prc-grade">${rv("Número CNJ", p.numero_cnj)}${rv("Área", PRC_AREA[p.area] || p.area)}${rv("Polo da CGL", PRC_POLO[p.polo_cgl])}`
    + rv("Parte contrária", p.parte_contraria) + rv("Vara", p.vara) + rv("Comarca", p.comarca) + rv("Assunto", p.assunto)
    + uiRotuloValor("Contrato ligado", p.contrato_id ? `<button type="button" class="ui-btn" data-prc-acao="abrir-contrato" data-id="${esc(p.contrato_id)}" title="Abrir o contrato">${uiCodigo(p.contrato_numero || "contrato")}</button>` : "—")
    + rv("Valor da causa", p.valor_causa != null ? brl(p.valor_causa) : "") + rv("Distribuído em", p.distribuido_em ? dataBR(p.distribuido_em) : "")
    + rv("Responsável", p.responsavel_nome) + rv("Observação", p.observacao) + `</div>`;
}

function renderFichaProcesso(p, erroEventos){
  const cont = $("prc-painel");
  if(!cont) return;
  const pode = prcPodeEditar();
  const lista = prcFiltrados();
  const pos = lista.findIndex(x => x.id === p.id);
  const pend = _prcEventos.filter(e => e.situacao === "pendente");
  const hoje = hojeISO();
  const tempo = _prcEventos.map(e => ({
    quando: e.data + (e.hora ? "T" + prcHora(e.hora) : ""), tipo: e.tipo,
    titulo: `${PRC_EVENTO[e.tipo] || e.tipo}: ${e.titulo}`,
    detalhe: [(PRC_EVENTO_SIT[e.situacao] || [e.situacao])[0], e.local || e.link || "", e.resultado || ""].filter(Boolean).join(" · ")
  }));
  const abas = [
    { id: "eventos", rotulo: "Eventos", resumo: `${pend.length} pendente(s)` },
    { id: "dados", rotulo: "Dados", resumo: PRC_AREA[p.area] || "" },
    { id: "historico", rotulo: "Histórico", resumo: "alterações e notas" }
  ];
  let corpo = "";
  if(_prcAba === "dados") corpo = prcDadosHTML(p);
  else if(_prcAba === "historico") corpo = `<div id="prc-hist"></div>`;
  else corpo = (pode ? `<div class="prc-acoes"><button type="button" class="ui-btn" data-prc-acao="ev-novo" data-id="audiencia">Nova audiência</button><button type="button" class="ui-btn" data-prc-acao="ev-novo" data-id="prazo">Novo prazo</button><button type="button" class="ui-btn" data-prc-acao="ev-novo" data-id="decisao">Registrar decisão</button></div>` : "")
    + (erroEventos ? uiErro(erroEventos) : prcTabelaEventos());
  cont.innerHTML = uiPagina({
      trilha: [{ texto: "Contratos", id: "contratos" }, { texto: "Processos", id: "processos" }, { texto: p.numero_cnj }],
      titulo: p.numero_cnj,
      sub: `${p.parte_contraria}${p.assunto ? " · " + p.assunto : ""}`,
      acoes: pode ? [{ id: "ev-audiencia", texto: "Nova audiência", primaria: true }, { id: "ev-prazo", texto: "Novo prazo" }] : [],
      menuAcoes: pode ? [{ id: "editar", texto: "Editar cadastro" }, { id: "excluir", texto: "Excluir processo", perigo: true }] : [],
      paginador: pos >= 0 ? { pos: pos + 1, total: lista.length } : null
    })
    + prcFaixa(p)
    + `<div class="ui-kpis prc-kpis">${uiKpi(String(pend.length), "Pendentes", "audiências e prazos")}`
    + uiKpi(String(pend.filter(e => e.data < hoje).length), "Sem baixa", "data passada")
    + uiKpi(String(_prcEventos.filter(e => e.tipo === "decisao").length), "Decisões")
    + uiKpi(p.valor_causa != null ? brl(p.valor_causa) : null, "Valor da causa", "deste processo") + `</div>`
    + uiSecao("relogio", "Linha do tempo", uiLinhaTempo(tempo, {
        tipos: [{ id: "audiencia", rotulo: "Audiências", tom: "info" }, { id: "prazo", rotulo: "Prazos", tom: "aviso" }, { id: "decisao", rotulo: "Decisões", tom: "ok" }],
        filtro: _prcTempoFiltro, erro: erroEventos, vazio: "Nenhum evento registrado." }))
    + uiAbas(abas, { ativa: _prcAba, rotulo: "Abas do processo" })
    + `<div class="prc-aba-corpo">${  corpo}</div>`;
  if(_prcAba === "historico" && typeof montarHistorico === "function") montarHistorico("processos", p.id, "prc-hist");
}


async function prcCarregarOpcoes(){
  if(_prcOpcoes) return _prcOpcoes;
  const [rc, rp] = await Promise.all([
    lerTudo(() => sb.from("contratos").select("id,numero,descricao")),
    sb.from("profiles").select("id,nome,cargo").eq("ativo", true).in("cargo", ["juridico", "diretor"]).order("nome")
  ]);
  _prcOpcoes = {
    contratos: (rc.data || []).slice().sort((a, b) => String(a.numero || "").localeCompare(String(b.numero || ""), "pt-BR", { numeric: true })).map(c => [c.id, `${c.numero}${c.descricao ? " — " + String(c.descricao).slice(0, 60) : ""}`]),
    responsaveis: (rp.data || []).map(u => [u.id, u.nome])
  };
  return _prcOpcoes;
}
function prcNomeResp(id){
  if(!id) return "—";
  const r = (_prcOpcoes?.responsaveis || []).find(x => x[0] === id);
  return r ? r[1] : "—";
}
function prcOpcoesDe(mapa){ return Object.entries(mapa).map(([v, l]) => [v, Array.isArray(l) ? l[0] : l]); }


async function prcAbrirFormProcesso(p){
  const op = await prcCarregarOpcoes();
  const x = p || {};
  const campos = uiCampo({ id: "numero_cnj", rotulo: "Número CNJ", valor: x.numero_cnj || "", obrigatorio: true, placeholder: "0000000-00.0000.0.00.0000", ajuda: "20 dígitos, com ou sem pontuação; o dígito verificador é conferido." })
    + uiCampo({ id: "parte_contraria", rotulo: "Parte contrária", valor: x.parte_contraria || "", obrigatorio: true })
    + uiCampo({ id: "polo_cgl", rotulo: "Polo da CGL", tipo: "select", valor: x.polo_cgl || "passivo", obrigatorio: true, opcoes: prcOpcoesDe(PRC_POLO) })
    + uiCampo({ id: "area", rotulo: "Área", tipo: "select", valor: x.area || "civel", opcoes: prcOpcoesDe(PRC_AREA) })
    + uiCampo({ id: "vara", rotulo: "Vara", valor: x.vara || "", placeholder: "ex.: 1ª Vara do Trabalho" })
    + uiCampo({ id: "comarca", rotulo: "Comarca", valor: x.comarca || "", placeholder: "ex.: Itabira/MG" })
    + uiCampo({ id: "assunto", rotulo: "Assunto", valor: x.assunto || "" })
    + uiCampo({ id: "contrato_id", rotulo: "Contrato ligado", tipo: "select", valor: x.contrato_id || "", placeholder: "Nenhum", opcoes: op.contratos })
    + uiCampo({ id: "valor_causa", rotulo: "Valor da causa (R$)", tipo: "number", valor: x.valor_causa ?? "" })
    + uiCampo({ id: "situacao", rotulo: "Situação", tipo: "select", valor: x.situacao || "ativo", opcoes: prcOpcoesDe(PRC_SITUACAO) })
    + uiCampo({ id: "responsavel_id", rotulo: "Responsável", tipo: "select", valor: x.responsavel_id || "", placeholder: "Nenhum", opcoes: op.responsaveis })
    + uiCampo({ id: "distribuido_em", rotulo: "Distribuído em", tipo: "date", valor: x.distribuido_em || "" })
    + uiCampo({ id: "observacao", rotulo: "Observação", tipo: "textarea", valor: x.observacao || "" });
  conDialogo(p ? "Editar processo" : "Novo processo", campos, async v => {
    const { data, error } = await sb.rpc("processo_salvar", {
      p_numero_cnj: v.numero_cnj, p_parte_contraria: v.parte_contraria, p_polo_cgl: v.polo_cgl || null, p_area: v.area || "civel",
      p_vara: v.vara || null, p_comarca: v.comarca || null, p_assunto: v.assunto || null, p_contrato: v.contrato_id || null,
      p_valor_causa: v.valor_causa === "" ? null : Number(v.valor_causa), p_situacao: v.situacao || "ativo",
      p_responsavel: v.responsavel_id || null, p_distribuido_em: v.distribuido_em || null, p_observacao: v.observacao || null,
      p_processo: p ? p.id : null });
    if(error) return prcErroMsg(error);
    uiAvisar(p ? "Processo salvo." : "Processo cadastrado.", "ok");
    await carregarProcessos();
    await abrirProcesso(data);
    return null;
  }, { largura: "g" });
}


async function prcAbrirFormEvento(tipo, ev){
  const op = await prcCarregarOpcoes();
  const x = ev || {};
  const t = ev ? ev.tipo : tipo;
  let campos = uiCampo({ id: "data", rotulo: "Data", tipo: "date", valor: x.data || "", obrigatorio: true })
    + uiCampo({ id: "titulo", rotulo: t === "audiencia" ? "Audiência" : t === "prazo" ? "Prazo (peça ou ato)" : "Decisão", valor: x.titulo || "", obrigatorio: true,
        placeholder: t === "audiencia" ? "ex.: Audiência de conciliação" : t === "prazo" ? "ex.: Contestação" : "ex.: Sentença" });
  if(t !== "decisao"){
    campos += uiCampo({ id: "hora", rotulo: "Hora", tipo: "time", valor: prcHora(x.hora) })
      + uiCampo({ id: "local", rotulo: "Local", valor: x.local || "", placeholder: t === "audiencia" ? "ex.: Fórum de Itabira, sala 3" : "" })
      + uiCampo({ id: "link", rotulo: "Link", valor: x.link || "", placeholder: "https://…", ajuda: "Sala virtual ou página do processo." })
      + uiCampo({ id: "responsavel_id", rotulo: "Responsável", tipo: "select", valor: x.responsavel_id || usuarioAtual?.id || "", placeholder: "Nenhum", opcoes: op.responsaveis });
  } else {
    campos += uiCampo({ id: "resultado", rotulo: "Teor da decisão", tipo: "textarea", valor: x.resultado || "", obrigatorio: true });
  }
  campos += uiCampo({ id: "documento", rotulo: "Documento", valor: x.documento || "", placeholder: "link do PJe/e-SAJ ou identificação da peça" })
    + uiCampo({ id: "observacao", rotulo: "Observação", tipo: "textarea", valor: x.observacao || "" });
  const titulo = (ev ? "Editar " : t === "decisao" ? "Registrar " : "Nova ") + (PRC_EVENTO[t] || "evento").toLowerCase();
  const procId = prcEditId;
  conDialogo(titulo.charAt(0).toUpperCase() + titulo.slice(1), campos, async v => {
    const { error } = await sb.rpc("processo_evento_salvar", {
      p_processo: procId, p_tipo: t, p_data: v.data || null, p_titulo: v.titulo, p_hora: v.hora || null, p_local: v.local || null,
      p_link: v.link || null, p_responsavel: v.responsavel_id || null, p_documento: v.documento || null,
      p_resultado: v.resultado || null, p_observacao: v.observacao || null, p_evento: ev ? ev.id : null });
    if(error) return prcErroMsg(error);
    uiAvisar(t === "decisao" ? "Decisão registrada." : `${PRC_EVENTO[t]} salva na agenda.`, "ok");
    await abrirProcesso(procId);
    return null;
  });
}

function prcConcluirEvento(ev, situacao){
  const cancelar = situacao === "cancelado";
  const campos = uiCampo({ id: "resultado", rotulo: cancelar ? "Motivo do cancelamento" : "Resultado", tipo: "textarea", obrigatorio: cancelar,
    placeholder: cancelar ? "ex.: redesignada para 10/12; acordo; prazo suspenso" : "ex.: sem acordo, instrução designada" });
  const procId = prcEditId;
  conDialogo(`${cancelar ? "Cancelar" : "Dar baixa"}: ${ev.titulo}`, campos, async v => {
    const { error } = await sb.rpc("processo_evento_concluir", { p_evento: ev.id, p_situacao: situacao, p_resultado: v.resultado || null });
    if(error) return prcErroMsg(error);
    uiAvisar(cancelar ? "Cancelado: saiu da agenda." : "Baixa registrada: saiu da agenda.", "ok");
    await abrirProcesso(procId);
    return null;
  }, { textoSalvar: cancelar ? "Cancelar evento" : "Dar baixa", perigo: cancelar });
}

async function prcExcluirEvento(ev){
  if(!await uiConfirmar({ titulo: "Excluir evento", texto: `Excluir "${ev.titulo}" de ${dataBR(ev.data)}? A exclusão fica no histórico do processo.`, confirmar: "Excluir", perigo: true })) return;
  const { error } = await sb.rpc("processo_evento_excluir", { p_evento: ev.id });
  if(error){ uiAvisar(prcErroMsg(error), "perigo"); return; }
  uiAvisar("Evento excluído.", "ok");
  await abrirProcesso(prcEditId);
}

async function excluirProcesso(p){
  if(!await uiConfirmar({ titulo: "Excluir processo", texto: `Excluir o processo ${p.numero_cnj}? Só sai se não tiver audiência, prazo nem decisão registrada; nos outros casos, mude a situação para Arquivado ou Encerrado.`, confirmar: "Excluir", perigo: true })) return;
  const { error } = await sb.rpc("processo_excluir", { p_processo: p.id });
  if(error){ uiAvisar(prcErroMsg(error), "perigo"); return; }
  uiAvisar("Processo excluído.", "ok");
  await abrirProcessos();
}


async function prcAbrirDaInicio(id){
  if(!irParaSecao("contratos")) return;
  _prcAba = "eventos";
  if(!_prcRegistros.length) await carregarProcessos();
  if(id) await abrirProcesso(id); else await abrirProcessos();
}


function prcProcessoAtual(){ return _prcRegistros.find(p => p.id === prcEditId) || null; }
async function prcClique(e){
  const trilha = e.target.closest("[data-trilha]");
  if(trilha){
    if(trilha.dataset.trilha === "contratos"){ prcFechar(); if(typeof mostrarPainelCon === "function") mostrarPainelCon(); }
    else if(trilha.dataset.trilha === "processos"){ prcEditId = null; renderProcessos(); }
    return;
  }
  const pag = e.target.closest("[data-pag]");
  if(pag && prcEditId){
    const lista = prcFiltrados(), i = lista.findIndex(x => x.id === prcEditId);
    const alvo = lista[i + (pag.dataset.pag === "prox" ? 1 : -1)];
    if(alvo) abrirProcesso(alvo.id);
    return;
  }
  const aba = e.target.closest("[data-aba]");
  if(aba){
    if(prcEditId){ _prcAba = aba.dataset.aba; const p = prcProcessoAtual(); if(p) renderFichaProcesso(p); }
    else { _prcSituacao = aba.dataset.aba; renderProcessos(); }
    return;
  }
  const tipo = e.target.closest(".ui-tempo [data-tipo]");
  if(tipo && prcEditId){ _prcTempoFiltro = tipo.dataset.tipo || ""; const p = prcProcessoAtual(); if(p) renderFichaProcesso(p); return; }
  const rem = e.target.closest("[data-remover]");
  if(rem){ _prcBusca = ""; renderProcessos(); return; }
  const acao = e.target.closest("[data-acao]");
  if(acao){
    const a = acao.dataset.acao, p = prcProcessoAtual();
    acao.closest("details")?.removeAttribute("open");
    if(a === "novo") prcAbrirFormProcesso(null);
    else if(a === "voltar"){ prcFechar(); if(typeof mostrarPainelCon === "function") mostrarPainelCon(); }
    else if(a === "editar" && p) prcAbrirFormProcesso(p);
    else if(a === "excluir" && p) excluirProcesso(p);
    else if(a === "ev-audiencia") prcAbrirFormEvento("audiencia");
    else if(a === "ev-prazo") prcAbrirFormEvento("prazo");
    return;
  }
  const pa = e.target.closest("[data-prc-acao]");
  if(pa){
    const a = pa.dataset.prcAcao, ev = _prcEventos.find(x => x.id === pa.dataset.id);
    if(a === "ev-novo") prcAbrirFormEvento(pa.dataset.id);
    else if(a === "abrir-contrato"){ prcFechar(); if(typeof abrirContrato === "function") abrirContrato(pa.dataset.id); }
    else if(!ev) return;
    else if(a === "ev-realizado") prcConcluirEvento(ev, "realizado");
    else if(a === "ev-cancelar") prcConcluirEvento(ev, "cancelado");
    else if(a === "ev-editar") prcAbrirFormEvento(ev.tipo, ev);
    else if(a === "ev-excluir") prcExcluirEvento(ev);
    return;
  }
  if(e.target.closest("a")) return;
  const tr = e.target.closest(".prc-tabela tr[data-id]");
  if(tr && !prcEditId){ _prcAba = "eventos"; _prcTempoFiltro = ""; abrirProcesso(tr.dataset.id); }
}

function ligarProcessos(){
  const btn = $("btn-con-processos");
  if(btn){
    btn.addEventListener("click", () => { _prcBusca = ""; abrirProcessos(); });

    const ajustar = () => { btn.hidden = !podeVerProcessos(); };
    ajustar();
    document.querySelector('nav button[data-secao="contratos"]')?.addEventListener("click", () => { ajustar(); prcFechar(); });
  }
  const cont = $("prc-painel");
  if(cont){
    cont.addEventListener("click", prcClique);
    cont.addEventListener("input", debounce(e => {
      if(e.target.matches('[data-filtro="busca"]') && !prcEditId){
        _prcBusca = e.target.value || "";
        renderProcessos();
        const campo = $("prc-busca");
        if(campo){ campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
      }
    }));
  }
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarProcessos);
else ligarProcessos();

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
let _rdoEquipes    = [];   // cache equipes cadastradas (pra modal "Importar equipe")
let _rdoRaizSolo   = [];
let _rdoRaizJust   = [];
let _rdoRaizEquipe = [];
let _rdoRaizDados  = null;
let _rdoFuncs = [];           // cache funcionários
let _rdoEquipsCache = [];     // cache equipamentos
let _rdoVizinhos = { anterior: null, proximo: null, indice: 0, total: 0 };
let _rdoBoletimAberto = null;

const RDO_STAGES = ["rascunho","finalizado"];

const TIPO_SERVICO = {
  helice_continua:   { label: "Hélice contínua", cor: "azul",     icone: "🌀" },
  trado_mecanizado:  { label: "Trado mecanizado", cor: "ambar",   icone: "🔩" },
  estaca_raiz:       { label: "Estaca raiz",     cor: "verde",    icone: "🌱" },
  helice_secante:    { label: "Hélice secante",  cor: "vermelho", icone: "🛡️" }
};

/* ---------- Selects fixos ---------- */
function rdoMontarSelectsFixos(){
  const optTempo = '<option value="">—</option>' +
    Object.entries(CONDICAO_TEMPO).map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join("");
  $("rdo-tempo-manha").innerHTML = optTempo;
  $("rdo-tempo-tarde").innerHTML = optTempo;
  $("rdo-status").innerHTML = opcoesStatus("rdo");
  $("rdo-tipo-servico").innerHTML = Object.entries(TIPO_SERVICO)
    .map(([v,o]) => `<option value="${v}">${o.icone} ${esc(o.label)}</option>`).join("");
}

function rdoPreencherObras(){
  const obras = Object.entries(mapaObras).map(([id,nome])=>({ id, nome }));
  obras.sort((a,b)=> a.nome.localeCompare(b.nome,"pt-BR"));
  const optObras = obras.map(o=>`<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join("");
  $("rdo-f-obra").innerHTML = '<option value="">Todas as obras</option>' + optObras;
  $("rdo-obra").innerHTML   = '<option value="">— selecione —</option>'  + optObras;
}

async function rdoCarregarAuxiliares(){
  const [f, e] = await Promise.all([
    sb.from("funcionarios").select("id,nome,matricula").eq("ativo",true).order("nome"),
    sb.from("equipamentos").select("id,codigo,nome,codigo_externo,tipo").eq("ativo",true).order("codigo")
  ]);
  _rdoFuncs = f.data || [];
  _rdoEquipsCache = e.data || [];
  preencherSelect($("rdo-responsavel"), _rdoFuncs.map(x=>({id:x.id,nome:x.nome})), "id", "nome", "— não informado —");
}

/* ---------- Carga lista ---------- */
async function carregarRDO(){
  rdoMontarSelectsFixos();
  rdoPreencherObras();
  await rdoCarregarAuxiliares();
  const sel = $("rdo-f-status");
  if(sel && !sel.options.length){
    sel.innerHTML = `<option value="">Todos os status</option>` + opcoesStatus("rdo");
  }
  const selT = $("rdo-f-tipo");
  if(selT && !selT.options.length){
    selT.innerHTML = `<option value="">Todos os tipos</option>` +
      Object.entries(TIPO_SERVICO).map(([v,o]) => `<option value="${v}">${esc(o.label)}</option>`).join("");
  }
  // Busca RDOs + execuções agregadas via view
  const { data, error } = await sb.from("vw_rdo_resumo").select("*").order("data", { ascending:false });
  _rdos = error ? [] : (data || []);
  renderRDO();
}

/* ---------- Filtros ---------- */
function rdoFiltrados(){
  const termo  = ($("rdo-busca")?.value || "").trim().toLowerCase();
  const fObra  = $("rdo-f-obra")?.value || "";
  const fStat  = $("rdo-f-status")?.value || "";
  const fTipo  = $("rdo-f-tipo")?.value || "";
  return _rdos.filter(r => {
    if(fObra && r.obra_id !== fObra) return false;
    if(fStat && r.status !== fStat) return false;
    if(fTipo && r.tipo_servico !== fTipo) return false;
    if(!termo) return true;
    const alvo = `${mapaObras[r.obra_id]||""} ${dataBR(r.data)} ${(TIPO_SERVICO[r.tipo_servico]||{}).label||""}`.toLowerCase();
    return alvo.includes(termo);
  });
}

/* ---------- Render ---------- */
function renderRDO(){
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
      <td>${dataBR(r.data)}</td>
      <td>${esc(mapaObras[r.obra_id] || "—")}</td>
      <td>${t.icone} ${esc(t.label)}</td>
      <td>${r.qtd_estacas_executadas || 0}</td>
      <td class="num">${num(r.metragem_total)} m</td>
      <td class="num">${num(r.concreto_total_m3)} m³</td>
      <td>${tagStatus("rdo", r.status)}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Data</th><th>Obra</th><th>Tipo</th><th>Estacas</th>
      <th class="num">Metragem</th><th class="num">Concreto</th><th>Status</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
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
          <span style="font-size:11px;color:var(--marca-600);display:block;">${esc(periodo)}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${num(metragem)} m</span>
          <strong>${num(concreto)} m³</strong>
        </div>
        ${statusBadges.length ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${statusBadges.join("")}</div>` : ""}
      </div>`;
    }).join("");
    return `<div class="serv-kan-col">
      <div class="serv-kan-col-head">${meta.icone} ${esc(meta.label)}<span>${grupos.length}</span></div>
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
}

async function novoRDO(){
  rdoEditId = null;
  _rdoExecucoes = [];
  _rdoEquipe = [];
  _rdoRaizSolo = [];
  _rdoRaizJust = [];
  _rdoRaizEquipe = [];
  _rdoRaizDados = null;
  $("rdo-obra").value = "";
  $("rdo-data").value = hojeISO();
  $("rdo-tipo-servico").value = "helice_continua";
  $("rdo-status").value = "rascunho";
  $("rdo-responsavel").value = "";
  $("rdo-tempo-manha").value = "";
  $("rdo-tempo-tarde").value = "";
  $("rdo-efetivo-proprio").value = 0;
  $("rdo-efetivo-terceiro").value = 0;
  $("rdo-atividades").value = "";
  $("rdo-obs").value = "";
  ["rdo-raiz-folha","rdo-raiz-projeto","rdo-raiz-local","rdo-raiz-bloco"]
    .forEach(k => { const el = $(k); if(el) el.value = ""; });
  _rdoBoletimAberto = null;
  $("btn-excluir-rdo").style.display = "none";
  abrirFichaRDOVisual({ status: "rascunho", tipo_servico: "helice_continua" });
}

async function abrirRDO(id){
  rdoEditId = id;
  _rdoBoletimAberto = null;
  const [rdo, execs, dadosRaiz, equipe] = await Promise.all([
    sb.from("rdo").select("*").eq("id", id).single(),
    sb.from("rdo_execucao_estaca").select("*").eq("rdo_id", id).order("perfuracao_inicio"),
    sb.from("rdo_raiz_dados").select("*").eq("rdo_id", id).maybeSingle(),
    sb.from("rdo_equipe").select("*").eq("rdo_id", id).order("ordem")
  ]);
  if(rdo.error){ aviso("app-aviso","Erro: "+rdo.error.message,"erro"); return; }
  const data = rdo.data;
  $("rdo-obra").value             = data.obra_id || "";
  $("rdo-data").value             = (data.data||"").slice(0,10);
  $("rdo-tipo-servico").value     = data.tipo_servico || "helice_continua";
  $("rdo-status").value           = data.status || "rascunho";
  $("rdo-responsavel").value      = data.responsavel_id || "";
  $("rdo-tempo-manha").value      = data.tempo_manha || "";
  $("rdo-tempo-tarde").value      = data.tempo_tarde || "";
  $("rdo-efetivo-proprio").value  = data.efetivo_proprio ?? 0;
  $("rdo-efetivo-terceiro").value = data.efetivo_terceiro ?? 0;
  $("rdo-atividades").value       = data.atividades || "";
  $("rdo-obs").value              = data.observacoes || "";

  _rdoExecucoes  = (execs.data || []).map(e => ({ ...e, _solo: [], _just: [] }));
  _rdoEquipe     = equipe.data || [];
  _rdoRaizEquipe = _rdoEquipe.map(e => ({ funcionario_id: e.funcionario_id, nome_avulso: e.nome_avulso }));
  _rdoRaizDados  = dadosRaiz.data || null;
  _rdoRaizSolo   = [];
  _rdoRaizJust   = [];

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
  abrirFichaRDOVisual(data);
}

function abrirFichaRDOVisual(rdo){
  $("rdo-painel").style.display = "none";
  $("rdo-ficha").style.display = "";

  const t = TIPO_SERVICO[rdo.tipo_servico] || { label: "—", icone: "" };
  $("rdo-ficha-obra-chip").textContent = mapaObras[rdo.obra_id] || "—";
  $("rdo-ficha-data-chip").textContent = rdo.data ? dataBR(rdo.data) : "—";
  $("rdo-ficha-tipo-chip").textContent = `${t.icone} ${t.label}`;
  $("rdo-ficha-status-chip").innerHTML = tagStatus("rdo", rdo.status);
  $("rdo-ficha-execs-chip").textContent = _rdoExecucoes.length;
  const metragem = _rdoExecucoes.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0);
  $("rdo-ficha-metragem-chip").textContent = `${num(metragem)} m`;
  $("rdo-ficha-titulo").textContent = rdoEditId ? `RDO ${dataBR(rdo.data)}` : "Novo RDO";

  _rdoBoletimAberto = null;
  atualizarStatusbarRDO(rdo.status);
  atualizarVisibilidadeAbasRaiz(rdo.tipo_servico);
  ativarTabRDO("cabecalho");
  renderExecucoes();
  renderRdoEquipe();
  atualizarVizinhosRDO(rdo);
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
  const { data, error } = await sb.from("rdo")
    .select("id,data")
    .eq("obra_id", rdo.obra_id)
    .eq("tipo_servico", rdo.tipo_servico)
    .order("data", { ascending: true });
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
  btnAnt.title = _rdoVizinhos.anterior
    ? `Anterior: ${dataBR(_rdoVizinhos.anterior.data)}`
    : "Não há RDO anterior";
  btnProx.title = _rdoVizinhos.proximo
    ? `Próximo: ${dataBR(_rdoVizinhos.proximo.data)}`
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

function atualizarStatusbarRDO(st){
  const bar = $("rdo-statusbar");
  if(!bar) return;
  const idxAtual = RDO_STAGES.indexOf(st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada");
    const idx = RDO_STAGES.indexOf(el.dataset.status);
    if(idx === idxAtual) el.classList.add("atual");
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
  const opsRDO = _rdoEquipe
    .filter(eq => eq.funcionario_id)
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
    tb.innerHTML = `<tr><td colspan="16" class="vazio">Nenhuma estaca registrada. Adicione manualmente ou importe um CSV.</td></tr>`;
    return;
  }
  const eqOpts = '<option value="">—</option>' +
    _rdoEquipsCache.map(e=>`<option value="${esc(e.id)}">${esc(e.codigo)}</option>`).join("");

  tb.innerHTML = _rdoExecucoes.map((e, idx) => {
    const showHelice = ["helice_continua","helice_secante"].includes(tipo);
    const bltAberto = (_rdoBoletimAberto === idx);
    const bltStyle = bltAberto ? 'background:#EBF2FB;color:var(--marca-600);border-color:var(--marca-600);font-weight:700;' : '';
    return `<tr data-idx="${idx}">
      <td><input type="text" class="ex-num col-md" value="${esc(e.estaca_numero||"")}" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,estaca_raiz,helice_secante"><input type="number" class="ex-diam" step="0.1" min="0" value="${esc(e.diametro_mm ?? "")}" style="width:75px;" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,estaca_raiz,helice_secante"><input type="number" class="ex-pproj" step="0.01" min="0" value="${esc(e.profundidade_projeto ?? "")}" style="width:75px;" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,estaca_raiz,helice_secante"><input type="number" class="ex-pexec" step="0.01" min="0" value="${esc(e.profundidade_executada ?? "")}" style="width:75px;" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,helice_secante"${showHelice||tipo==='trado_mecanizado'?'':' style="display:none;"'}><input type="datetime-local" class="ex-perfi col-lg" value="${e.perfuracao_inicio ? new Date(e.perfuracao_inicio).toISOString().slice(0,16) : ""}" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,helice_secante"${showHelice||tipo==='trado_mecanizado'?'':' style="display:none;"'}><input type="datetime-local" class="ex-perff col-lg" value="${e.perfuracao_fim ? new Date(e.perfuracao_fim).toISOString().slice(0,16) : ""}" /></td>
      <td data-col-tipo="helice_continua,helice_secante"${showHelice?'':' style="display:none;"'}><input type="datetime-local" class="ex-conci col-lg" value="${e.concretagem_inicio ? new Date(e.concretagem_inicio).toISOString().slice(0,16) : ""}" /></td>
      <td data-col-tipo="helice_continua,helice_secante"${showHelice?'':' style="display:none;"'}><input type="datetime-local" class="ex-concf col-lg" value="${e.concretagem_fim ? new Date(e.concretagem_fim).toISOString().slice(0,16) : ""}" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,helice_secante"${showHelice||tipo==='trado_mecanizado'?'':' style="display:none;"'}><input type="number" class="ex-torque" step="0.1" value="${esc(e.torque ?? "")}" style="width:70px;" /></td>
      <td data-col-tipo="helice_continua,trado_mecanizado,helice_secante"${showHelice||tipo==='trado_mecanizado'?'':' style="display:none;"'}><input type="number" class="ex-vol" step="0.001" min="0" value="${esc(e.volume_concreto_m3 ?? "")}" style="width:70px;" /></td>
      <td><select class="ex-equip col-sm">${eqOpts}</select></td>
      <td><input type="text" class="ex-maq col-xs" value="${esc(e.maquina_codigo||"")}" placeholder="ou texto" /></td>
      <td><select class="ex-operador" style="min-width:140px;">${opOpts}</select></td>
      <td><input type="text" class="ex-obs" value="${esc(e.observacoes||"")}" style="min-width:140px;" /></td>
      <td data-col-tipo="estaca_raiz"><button type="button" class="btn-sec btn-sm btn-boletim-toggle" data-idx="${idx}" style="${bltStyle}" title="Boletim desta estaca">📋</button></td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-ex-rem txt-perigo" data-idx="${idx}">×</button></td>
    </tr>`;
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
    const mainRow = tb.querySelector(`tr[data-idx="${_rdoBoletimAberto}"]`);
    if(mainRow){
      mainRow.insertAdjacentHTML("afterend", renderBoletimExpandidoHTML(_rdoBoletimAberto));
      attachBoletimListeners(_rdoBoletimAberto);
    }
  }

  // listeners
  tb.querySelectorAll("tr[data-idx]").forEach(tr => {
    const idx = Number(tr.dataset.idx);
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

function coletarExecucao(tr, idx){
  const e = _rdoExecucoes[idx] || {};
  e.estaca_numero       = tr.querySelector(".ex-num")?.value.trim() || null;
  e.diametro_mm         = numOrNull(tr.querySelector(".ex-diam")?.value);
  e.profundidade_projeto = numOrNull(tr.querySelector(".ex-pproj")?.value);
  e.profundidade_executada = numOrNull(tr.querySelector(".ex-pexec")?.value);
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
}

/* ---------- Boletim por estaca (Estaca Raiz) ---------- */
function toggleBoletimEstaca(idx){
  _rdoBoletimAberto = (_rdoBoletimAberto === idx) ? null : idx;
  renderExecucoes();
}

function renderBoletimSoloRows(idx){
  const solos = (_rdoExecucoes[idx]?._solo) || [];
  if(!solos.length)
    return `<tr><td colspan="4" class="vazio" style="font-size:11px;">Sem camadas. Clique em "+ Camada de solo".</td></tr>`;
  return solos.map((s, si) => `<tr data-solo-idx="${si}">
    <td><input type="number" step="0.01" min="0" class="blt-solo-ini col-sm" value="${esc(s.inicio_ml??'')}" /></td>
    <td><input type="number" step="0.01" min="0" class="blt-solo-fim col-sm" value="${esc(s.final_ml??'')}" /></td>
    <td><input type="text" class="blt-solo-class" value="${esc(s.classificacao||'')}" style="min-width:200px;" /></td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-blt-solo-rem txt-perigo" data-si="${si}">×</button></td>
  </tr>`).join('');
}

function renderBoletimJustRows(idx){
  const justs = (_rdoExecucoes[idx]?._just) || [];
  if(!justs.length)
    return `<tr><td colspan="4" class="vazio" style="font-size:11px;">Sem justificativas.</td></tr>`;
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
    `<option value="${v}"${e.inclinacao===v?' selected':''}>${v}</option>`).join('');
  const combOpts = ['Diesel','Gasolina','GNV','Elétrico','Outro'].map(v =>
    `<option value="${v}"${e.abastecimento_tipo===v?' selected':''}>${v}</option>`).join('');
  const cimUn = [['saco','Sacos'],['kg','kg'],['m3','m³']].map(([v,l]) =>
    `<option value="${v}"${e.consumo_cimento_unidade===v?' selected':''}>${l}</option>`).join('');
  const arUn  = [['m3','m³'],['kg','kg']].map(([v,l]) =>
    `<option value="${v}"${e.consumo_areia_unidade===v?' selected':''}>${l}</option>`).join('');

  return `<tr class="rdo-boletim-row" data-boletim-idx="${idx}">
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
          <table class="itens-tabela" id="blt-solo-tbl-${idx}">
            <thead><tr><th>Início (ml)</th><th>Final (ml)</th><th>Classificação do Solo</th><th class="col-acao"></th></tr></thead>
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
        </div>
        <div class="campo" style="max-width:420px;margin-bottom:14px;">
          <label>Identificação dos Acessórios</label>
          <input class="blt-acessorios" value="${esc(e.identificacao_acessorios||'')}" /></div>

        <div class="rdo-boletim-secao">Justificativas (paradas)</div>
        <div class="tabela-rola">
          <table class="itens-tabela" id="blt-just-tbl-${idx}">
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
    e.identificacao_acessorios = row.querySelector('.blt-acessorios')?.value.trim()   || null;
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
      });
    });
    tb2.querySelectorAll('.btn-blt-solo-rem').forEach(b => {
      b.addEventListener('click', () => {
        e._solo.splice(Number(b.dataset.si), 1);
        const tb3 = document.querySelector(`#blt-solo-tbl-${idx} tbody`);
        if(tb3){ tb3.innerHTML = renderBoletimSoloRows(idx); rebindSolo(); }
      });
    });
  };
  rebindSolo();

  row.querySelector('.btn-blt-add-solo')?.addEventListener('click', () => {
    e._solo.push({});
    const tb2 = document.querySelector(`#blt-solo-tbl-${idx} tbody`);
    if(tb2){ tb2.innerHTML = renderBoletimSoloRows(idx); rebindSolo(); }
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

function renderRaizJust(){
  const tb = $("rdo-raiz-just");
  if(!tb) return;
  if(!_rdoRaizJust.length){
    tb.innerHTML = `<tr><td colspan="4" class="vazio">Sem paradas registradas.</td></tr>`;
    return;
  }
  tb.innerHTML = _rdoRaizJust.map((j, idx) => `<tr data-idx="${idx}">
    <td><input type="text" class="rj-hi col-sm" placeholder="HH:MM" value="${esc(j.h_inicial||"")}" /></td>
    <td><input type="text" class="rj-hf col-sm" placeholder="HH:MM" value="${esc(j.h_final||"")}" /></td>
    <td><input type="text" class="rj-mot" value="${esc(j.motivo||"")}" /></td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-rj-rem txt-perigo" data-idx="${idx}">×</button></td>
  </tr>`).join("");
  tb.querySelectorAll("tr").forEach(tr => {
    const idx = Number(tr.dataset.idx);
    tr.addEventListener("input", () => {
      _rdoRaizJust[idx] = {
        h_inicial: tr.querySelector(".rj-hi").value.trim() || null,
        h_final: tr.querySelector(".rj-hf").value.trim() || null,
        motivo: tr.querySelector(".rj-mot").value.trim() || null
      };
    });
  });
  tb.querySelectorAll(".btn-rj-rem").forEach(b => {
    b.addEventListener("click", () => { _rdoRaizJust.splice(Number(b.dataset.idx),1); renderRaizJust(); });
  });
}

function adicionarRaizJust(){
  _rdoRaizJust.push({});
  renderRaizJust();
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

function renderRdoEquipe(){
  // Renderiza nova tabela genérica
  const tb = $("rdo-equipe-tbody");
  if(!tb) return;
  if(!_rdoEquipe.length){
    tb.innerHTML = `<tr><td colspan="10" class="vazio">Nenhum integrante. Use "+ integrante" ou "📥 Importar equipe".</td></tr>`;
    return;
  }
  const optFunc = '<option value="">— do cadastro —</option>' +
    _rdoFuncs.map(f=>`<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
  const optFuncao = '<option value="">—</option>' +
    RDO_FUNCOES.map(o=>`<option value="${o.v}">${o.l}</option>`).join("");

  tb.innerHTML = _rdoEquipe.map((e, idx) => `<tr data-idx="${idx}">
    <td><strong>${idx+1}</strong></td>
    <td><select class="eq-func">${optFunc}</select></td>
    <td><input type="text" class="eq-nome" placeholder="terceiro sem cadastro" value="${esc(e.nome_avulso||"")}" style="min-width:140px;" /></td>
    <td><select class="eq-funcao">${optFuncao}</select></td>
    <td><input type="time" class="eq-entrada" value="${esc(e.hora_entrada||"")}" /></td>
    <td><input type="time" class="eq-saida" value="${esc(e.hora_saida||"")}" /></td>
    <td><input type="number" class="eq-h50" step="0.5" min="0" value="${e.horas_50 ?? ""}" style="width:60px;" /></td>
    <td><input type="number" class="eq-h100" step="0.5" min="0" value="${e.horas_100 ?? ""}" style="width:60px;" /></td>
    <td><input type="text" class="eq-obs" value="${esc(e.observacoes||"")}" style="min-width:120px;" /></td>
    <td class="col-acao"><button type="button" class="btn-sec btn-sm btn-eq-rem txt-perigo" data-idx="${idx}">×</button></td>
  </tr>`).join("");

  // Aplica valores de select (que não funcionam via innerHTML value)
  _rdoEquipe.forEach((e, idx) => {
    const tr = tb.querySelector(`tr[data-idx="${idx}"]`);
    if(!tr) return;
    if(e.funcionario_id) tr.querySelector(".eq-func").value = e.funcionario_id;
    if(e.funcao_no_dia)  tr.querySelector(".eq-funcao").value = e.funcao_no_dia;
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
        hora_entrada:   tr.querySelector(".eq-entrada").value || null,
        hora_saida:     tr.querySelector(".eq-saida").value || null,
        horas_50:       parseFloat(tr.querySelector(".eq-h50").value)  || null,
        horas_100:      parseFloat(tr.querySelector(".eq-h100").value) || null,
        observacoes:    tr.querySelector(".eq-obs").value.trim() || null,
        ordem:          idx
      };
    };
    tr.addEventListener("input", sync);
    tr.addEventListener("change", sync);
  });
  tb.querySelectorAll(".btn-eq-rem").forEach(b => {
    b.addEventListener("click", () => { _rdoEquipe.splice(Number(b.dataset.idx),1); renderRdoEquipe(); });
  });
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

/* ---------- Salvar / excluir ---------- */
async function salvarRDO(novoStatus){
  const obra_id = $("rdo-obra").value;
  if(!obra_id){ aviso("app-aviso","Selecione a obra.","erro"); ativarTabRDO("cabecalho"); return; }
  const dataRDO = $("rdo-data").value;
  if(!dataRDO){ aviso("app-aviso","Informe a data.","erro"); ativarTabRDO("cabecalho"); return; }

  const tipo = $("rdo-tipo-servico").value;

  const reg = {
    obra_id,
    data:             dataRDO,
    tipo_servico:     tipo,
    status:           novoStatus || $("rdo-status").value || "rascunho",
    responsavel_id:   $("rdo-responsavel").value || null,
    tempo_manha:      $("rdo-tempo-manha").value || null,
    tempo_tarde:      $("rdo-tempo-tarde").value || null,
    efetivo_proprio:  Number($("rdo-efetivo-proprio").value || 0),
    efetivo_terceiro: Number($("rdo-efetivo-terceiro").value || 0),
    producao_dia_m:   _rdoExecucoes.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0),
    atividades:       $("rdo-atividades").value.trim() || null,
    observacoes:      $("rdo-obs").value.trim() || null
  };

  let savedId = rdoEditId;
  if(rdoEditId){
    const { error } = await sb.from("rdo").update(reg).eq("id", rdoEditId);
    if(error){
      const m = (error.message||"").toLowerCase();
      if(m.includes("duplicate"))
        aviso("app-aviso","Já existe um RDO pra esta obra nesta data.","erro");
      else
        aviso("app-aviso","Erro ao salvar: "+error.message,"erro");
      return;
    }
    // Substitui execuções e sub-tabelas
    await sb.from("rdo_execucao_estaca").delete().eq("rdo_id", rdoEditId);
    await sb.from("rdo_equipe").delete().eq("rdo_id", rdoEditId);
    if(tipo === "estaca_raiz"){
      await sb.from("rdo_raiz_solo").delete().eq("rdo_id", rdoEditId);
      await sb.from("rdo_raiz_justificativa").delete().eq("rdo_id", rdoEditId);
      await sb.from("rdo_raiz_dados").delete().eq("rdo_id", rdoEditId);
    }
  } else {
    const { data: novo, error } = await sb.from("rdo").insert(reg).select("id").single();
    if(error){
      const m = (error.message||"").toLowerCase();
      if(m.includes("duplicate"))
        aviso("app-aviso","Já existe um RDO pra esta obra nesta data.","erro");
      else
        aviso("app-aviso","Erro ao salvar: "+error.message,"erro");
      return;
    }
    savedId = novo.id;
    rdoEditId = savedId;
  }

  // Insere execuções
  const execsParaSalvar = _rdoExecucoes.filter(e => e.estaca_numero);
  let insertedExecs = null;
  if(execsParaSalvar.length){
    const insertExecs = execsParaSalvar.map(e => {
      const base = {
        rdo_id: savedId,
        estaca_id: e.estaca_id || null,
        estaca_numero: e.estaca_numero,
        diametro_mm: e.diametro_mm,
        profundidade_projeto: e.profundidade_projeto,
        profundidade_executada: e.profundidade_executada,
        perfuracao_inicio: e.perfuracao_inicio || null,
        perfuracao_fim: e.perfuracao_fim || null,
        concretagem_inicio: e.concretagem_inicio || null,
        concretagem_fim: e.concretagem_fim || null,
        torque: e.torque,
        volume_concreto_m3: e.volume_concreto_m3,
        equipamento_id: e.equipamento_id || null,
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
          identificacao_acessorios: e.identificacao_acessorios || null
        });
      }
      return base;
    });
    const { data: ids, error: errExec } = await sb.from("rdo_execucao_estaca").insert(insertExecs).select("id");
    if(errExec){ aviso("app-aviso","Erro ao salvar execuções: "+errExec.message,"erro"); return; }
    insertedExecs = ids;

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
            classificacao: s.classificacao || null, ordem: si + 1
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

  // Insere equipe do dia (genérico, todos os tipos de RDO)
  const eqLimpa = _rdoEquipe
    .filter(e => e.funcionario_id || (e.nome_avulso && e.nome_avulso.trim()))
    .map((e,i) => ({
      rdo_id:         savedId,
      funcionario_id: e.funcionario_id || null,
      nome_avulso:    e.nome_avulso || null,
      funcao_no_dia:  e.funcao_no_dia || null,
      hora_entrada:   e.hora_entrada || null,
      hora_saida:     e.hora_saida || null,
      horas_50:       e.horas_50 || null,
      horas_100:      e.horas_100 || null,
      observacoes:    e.observacoes || null,
      ordem:          i + 1
    }));
  if(eqLimpa.length){
    const { error: errEq } = await sb.from("rdo_equipe").insert(eqLimpa);
    if(errEq){ aviso("app-aviso","Erro ao salvar equipe: "+errEq.message,"erro"); return; }
  }

  // Insere cabeçalho do dia (Raiz)
  if(tipo === "estaca_raiz"){
    const folha   = $("rdo-raiz-folha")?.value.trim()   || null;
    const projeto = $("rdo-raiz-projeto")?.value.trim() || null;
    const local   = $("rdo-raiz-local")?.value.trim()   || null;
    const bloco   = $("rdo-raiz-bloco")?.value.trim()   || null;
    if(folha || projeto || local || bloco){
      await sb.from("rdo_raiz_dados").insert({
        rdo_id: savedId, folha, projeto, local_obra: local, bloco
      });
    }
    // solo/just já inseridos por execucao_id na seção acima
  }

  $("btn-excluir-rdo").style.display = "";
  $("rdo-status").value = reg.status;
  aviso("app-aviso","RDO salvo com sucesso.","ok");
  await carregarRDO();
  await abrirRDO(savedId);
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
  ["rdo-busca","rdo-f-obra","rdo-f-status","rdo-f-tipo"].forEach(id => {
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
  $("btn-salvar-rdo")?.addEventListener("click", () => salvarRDO());
  $("btn-finalizar-rdo")?.addEventListener("click", () => salvarRDO("finalizado"));
  $("btn-excluir-rdo")?.addEventListener("click", excluirRDO);
  $("btn-add-execucao")?.addEventListener("click", adicionarExecucao);
  $("btn-add-raiz-solo")?.addEventListener("click", adicionarRaizSolo);
  $("btn-add-raiz-just")?.addEventListener("click", adicionarRaizJust);
  $("btn-add-rdo-equipe")?.addEventListener("click", adicionarRdoEquipe);
  $("btn-rdo-equipe-do-time")?.addEventListener("click", importarEquipeCadastrada);
  $("btn-rdo-aplicar-op")?.addEventListener("click", aplicarOperadorEmMassa);

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

function abrirModalImportCSV(){
  // Pode ser chamado tanto da ficha quanto do painel — não exige obra prévia
  $("csv-arquivo").value = "";
  $("csv-preview").style.display = "none";
  $("csv-preview-conteudo").innerHTML = "";
  _csvParsed = null;
  _csvObraDetectada = null;
  _csvTipoDetectado = null;
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
  if(!inp.files || !inp.files[0]){ aviso("app-aviso","Selecione um arquivo (CSV ou TXT).","erro"); return; }
  const file = inp.files[0];
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

  await continuarProcessamentoImport(registros, obraTxtFonte, formato);
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
    const equipId = mapaMaq[maq.toUpperCase()] || null;
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

  // Detecta máquinas (códigos únicos no CSV) sem match em equipamentos
  const maquinasNoCSV = [...new Set(registros.map(r => (r.maquina_codigo||"").trim()).filter(Boolean))];
  _csvMaquinasSemMatch = maquinasNoCSV.filter(m => !registros.find(r => r.maquina_codigo === m && r.equipamento_id));
  _csvMapaManual = {};  // codigo CSV -> equipamento_id escolhido manualmente

  // Preview
  const dias = Object.keys(porDia).sort().reverse();
  const totalEstacas = registros.length;

  // Bloco de identificação de obra
  let blocoObra = "";
  if(_csvObraDetectada && _csvObraDetectada.casamento === "exato"){
    blocoObra = `<div style="background:var(--sucesso-bg);border-left:3px solid var(--sucesso);padding:10px 14px;margin-bottom:10px;font-size:12px;">
      ✅ <strong>Obra identificada automaticamente:</strong> ${esc(_csvObraDetectada.nome)}
      <div style="font-size:11px;color:var(--txt-fraco);margin-top:2px;">CSV trouxe "${esc(obraCSV)}" — casamento exato.</div>
    </div>`;
  } else if(_csvObraDetectada){
    blocoObra = `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:12px;">
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
    blocoObra = `<div style="background:var(--perigo-bg);border-left:3px solid var(--perigo);padding:10px 14px;margin-bottom:10px;font-size:12px;">
      ❌ <strong>Obra não identificada</strong> — o CSV trouxe "${esc(obraCSV)}" mas não casa com nenhuma obra cadastrada.
      <div style="margin-top:6px;">
        <label class="meta">Escolha a obra manualmente:</label>
        <select id="csv-obra-select" style="width:100%;margin-top:4px;"></select>
      </div>
    </div>`;
  }

  // Bloco de tipo de serviço
  const blocoTipo = `<div style="background:var(--sup-2);border-left:3px solid var(--marca-600);padding:10px 14px;margin-bottom:10px;font-size:12px;">
    🔧 <strong>Tipo de serviço detectado:</strong> ${esc((TIPO_SERVICO[_csvTipoDetectado]||{}).label || _csvTipoDetectado)}
    <div style="margin-top:6px;">
      <label class="meta">Confirme ou altere:</label>
      <select id="csv-tipo-select" style="width:100%;margin-top:4px;">
        ${Object.entries(TIPO_SERVICO).map(([v,o]) => `<option value="${v}" ${v===_csvTipoDetectado?"selected":""}>${o.icone} ${esc(o.label)}</option>`).join("")}
      </select>
    </div>
  </div>`;

  // Bloco de mapeamento de máquinas (códigos sem match)
  let blocoMaq = "";
  if(_csvMaquinasSemMatch.length){
    const equipOpts = '<option value="">— escolha o equipamento —</option>' +
      _rdoEquipsCache.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome)}</option>`).join("");
    const linhasMaq = _csvMaquinasSemMatch.map(maq => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
        <code style="background:var(--sup-0);padding:2px 8px;border-radius:3px;border:1px solid var(--borda-forte);min-width:80px;text-align:center;"><strong>${esc(maq)}</strong></code>
        <span style="color:var(--txt-fraco);font-size:11px;">→</span>
        <select class="csv-maq-select" data-maq="${esc(maq)}" style="flex:1;min-width:240px;">${equipOpts}</select>
        <label style="font-size:11px;color:var(--txt-fraco);display:flex;align-items:center;gap:4px;">
          <input type="checkbox" class="csv-maq-salvar" data-maq="${esc(maq)}" checked />
          Salvar como código externo
        </label>
      </div>`).join("");
    blocoMaq = `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:12px;">
      ⚠️ <strong>${_csvMaquinasSemMatch.length} máquina${_csvMaquinasSemMatch.length>1?'s':''} sem equipamento cadastrado:</strong>
      <div style="font-size:11px;color:var(--txt-fraco);margin-top:2px;">Vincule cada código do CSV ao equipamento correspondente. Marque "salvar" para o sistema reconhecer automaticamente nas próximas importações.</div>
      <div style="margin-top:10px;">${linhasMaq}</div>
    </div>`;
  }

  const fmtLbl = formato === "softsaci"
    ? "📄 <strong>Formato detectado:</strong> SoftSaci V7.x (TXT colunas fixas)"
    : "📄 <strong>Formato detectado:</strong> Geodigitus (CSV)";
  const blocoFormato = `<div style="background:#eef2f6;border-left:3px solid var(--txt-fraco);padding:8px 12px;margin-bottom:10px;font-size:11px;color:#495057;">${fmtLbl}</div>`;

  let html = blocoFormato + blocoObra + blocoTipo + blocoMaq + `<div style="background:var(--info-bg);border-left:3px solid var(--marca-600);padding:10px 14px;margin-bottom:10px;font-size:12px;">
    📊 <strong>${totalEstacas}</strong> estacas em <strong>${dias.length}</strong> dia${dias.length>1?"s":""} — vão gerar ${dias.length} RDO${dias.length>1?"s":""} novo${dias.length>1?"s":""}.
    Total metragem: <strong>${num(registros.reduce((s,r) => s + (r.profundidade_executada||0), 0))} m</strong>.
    Total concreto: <strong>${num(registros.reduce((s,r) => s + (r.volume_concreto_m3||0), 0))} m³</strong>.
  </div>`;
  dias.forEach(d => {
    const ests = porDia[d];
    html += `<div style="margin-bottom:8px;border:1px solid var(--borda-forte);border-radius:4px;padding:8px 10px;">
      <div style="font-weight:600;font-size:12px;color:var(--marca-600);">📅 ${dataBR(d)} — ${ests.length} estaca${ests.length>1?"s":""}</div>
      <div class="meta">${ests.map(e=>e.estaca_numero).slice(0,10).join(", ")}${ests.length>10?` +${ests.length-10}`:""}</div>
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
  }

  aviso("app-aviso", `${registros.length} estacas extraídas. Confirme obra e tipo antes de importar.`, "ok");
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

async function confirmarImportCSV(){
  if(!_csvParsed){ aviso("app-aviso","Processe o CSV primeiro.","erro"); return; }

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
  const responsavel = $("rdo-responsavel")?.value || null;

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

  if(!confirm(`Importar ${Object.values(_csvParsed).reduce((s,v) => s+v.length, 0)} estacas como ${TIPO_SERVICO[tipo]?.label || tipo}? Cada dia vira 1 RDO novo.`)) return;

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
    const dias = Object.keys(_csvParsed).sort();
    let totalRdos = 0, totalExecs = 0;
    for(const dia of dias){
      const ests = _csvParsed[dia];
      // Upsert do RDO (cria se não existe)
      const { data: rdoExist } = await sb.from("rdo").select("id").eq("obra_id", obra_id).eq("data", dia).maybeSingle();
      let rdoId;
      if(rdoExist){
        rdoId = rdoExist.id;
      } else {
        const reg = {
          obra_id, data: dia, tipo_servico: tipo,
          status: "rascunho", responsavel_id: responsavel,
          producao_dia_m: ests.reduce((s,e) => s + (e.profundidade_executada||0), 0)
        };
        const { data: novo, error } = await sb.from("rdo").insert(reg).select("id").single();
        if(error){ throw new Error(`Dia ${dia}: ${error.message}`); }
        rdoId = novo.id;
        totalRdos++;
      }
      // Insere execuções (aplicando mapa manual de máquinas)
      const exs = ests.map(e => {
        let equipId = e.equipamento_id;
        if(!equipId && e.maquina_codigo && _csvMapaManual[e.maquina_codigo]){
          equipId = _csvMapaManual[e.maquina_codigo];
        }
        return {
          rdo_id: rdoId,
          estaca_numero: e.estaca_numero,
          diametro_mm: e.diametro_mm,
          profundidade_projeto: e.profundidade_projeto,
          profundidade_executada: e.profundidade_executada,
          perfuracao_inicio: e.perfuracao_inicio,
          perfuracao_fim: e.perfuracao_fim,
          concretagem_inicio: e.concretagem_inicio,
          concretagem_fim: e.concretagem_fim,
          torque: e.torque,
          volume_concreto_m3: e.volume_concreto_m3,
          equipamento_id: equipId,
          maquina_codigo: e.maquina_codigo,
          observacoes: e.observacoes,
          modalidade_execucao: e.modalidade_execucao || "furo_normal",
          origem_dados: "csv_geodigitus"
        };
      });
      const { error: errEx } = await sb.from("rdo_execucao_estaca").insert(exs);
      if(errEx){ throw new Error(`Execuções de ${dia}: ${errEx.message}`); }
      totalExecs += exs.length;
    }
    aviso("app-aviso", `✅ Importado: ${totalRdos} RDOs novos, ${totalExecs} execuções de estaca.`, "ok");
    fecharModalImportCSV();
    await carregarRDO();
  } catch(err){
    aviso("app-aviso","Erro: "+err.message,"erro");
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
}

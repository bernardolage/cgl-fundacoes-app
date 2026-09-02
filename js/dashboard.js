/* ====================================================================
   Dashboard (Home) — visão geral do negócio CGL
   ==================================================================== */

let _dashPendNav = [];   // ações de navegação por índice dos itens pendentes

async function carregarDashboard(){
  // Saudação
  const nome = (typeof usuarioAtual !== "undefined" && usuarioAtual?.nome) ? usuarioAtual.nome.split(" ")[0] : "";
  const greeting = $("dash-saudacao");
  const hojeEl   = $("dash-data-hoje");
  if(greeting) greeting.textContent = nome ? `👋 Olá, ${nome} · Visão geral do negócio` : "👋 Visão geral do negócio";
  if(hojeEl){
    const hoje = new Date();
    hojeEl.textContent = hoje.toLocaleDateString("pt-BR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
  }

  // Roda tudo em paralelo
  await Promise.all([
    carregarDashFinanceiro(),
    carregarDashOperacional(),
    carregarDashPendencias(),
    carregarDashGraficoProducao(),
    carregarDashTopObras(),
    carregarDashAtividade()
  ]);

  // A posição de estoque (aba antiga, oculta) NÃO carrega mais no boot: eram
  // 9.479 produtos + 9.479 <tr> a cada login (~60% do payload inicial).
  // Passou a carregar sob demanda ao abrir a seção Estoque (core.js, nav).

  // Cliques dos cards de KPI (os painéis ligam os seus ao renderizar)
  ligarCliquesDashboard();
}

/* ============================================================
   NAVEGAÇÃO CLICÁVEL — cada indicador leva ao seu fluxo
   ============================================================ */
async function dashAbrirObra(obraId, tab){
  irParaSecao("obras");
  if(obraId && typeof abrirObra === "function"){
    await abrirObra(obraId);
    if(tab && typeof ativarTabObra === "function") ativarTabObra(tab);
  }
}
function dashAbrirMedicao(id){ irParaSecao("medicoes"); if(id && typeof abrirMedicao === "function") abrirMedicao(id); }
function dashAbrirOrcamento(id){ irParaSecao("orcamentos"); if(id && typeof abrirOrcamento === "function") abrirOrcamento(id); }
function dashAbrirContrato(id){ irParaSecao("contratos"); if(id && typeof abrirContrato === "function") abrirContrato(id); }
function dashIrObrasAtivas(){
  irParaSecao("obras");
  const f = $("obr-f-status");
  if(f){ f.value = "em_andamento"; if(typeof renderObras === "function") renderObras(); }
}
function dashIrOrcamentos(){ irParaSecao("orcamentos"); }
function dashIrFinanceiro(){
  // diretoria vê a Carteira; demais vão para Medições
  if(usuarioAtual && ["diretor","admin"].includes(usuarioAtual.cargo)) irParaSecao("carteira");
  else irParaSecao("medicoes");
}

function ligarCliquesDashboard(){
  const liga = (id, fn, dica) => {
    const el = $(id); const card = el ? el.closest(".dash-card") : null;
    if(card && !card.dataset.clicavel){
      card.dataset.clicavel = "1";
      card.classList.add("clicavel");
      if(dica) card.title = dica;
      card.addEventListener("click", fn);
    }
  };
  liga("dash-obras-ativas", dashIrObrasAtivas, "Ver obras em andamento");
  liga("dash-orc-abertos",  dashIrOrcamentos,  "Ver orçamentos abertos");
  liga("dash-contratado",   dashIrFinanceiro,  "Ver medições / carteira");
  liga("dash-medido",       dashIrFinanceiro,  "Ver medições / carteira");
  liga("dash-a-medir",      dashIrFinanceiro,  "Ver medições / carteira");
}

/* ============================================================
   KPIs FINANCEIROS — contratado / medido / a medir / %
   ============================================================ */
async function carregarDashFinanceiro(){
  // Contratado: soma de obras com contrato vinculado + valor_contratado > 0
  // (Usa obras.valor_contratado direto — mais simples e robusto)
  const [{ data: obrasAtivas }, { data: medsAprovadas }] = await Promise.all([
    sb.from("obras").select("valor_contratado").in("status", ["em_andamento","planejada","paralisada"]),
    sb.from("medicoes").select("valor_final,valor_medido").in("status",["aprovada","faturada"])
  ]);

  const contratado = (obrasAtivas||[]).reduce((s,o) => s + (Number(o.valor_contratado)||0), 0);
  const medido     = (medsAprovadas||[]).reduce((s,m) => s + (Number(m.valor_final)||Number(m.valor_medido)||0), 0);
  const aMedir     = contratado - medido;
  const pct        = contratado > 0 ? Math.round((medido / contratado) * 100) : 0;

  if($("dash-contratado"))      $("dash-contratado").textContent = brl(contratado);
  if($("dash-contratado-sub"))  $("dash-contratado-sub").textContent = `${(obrasAtivas||[]).length} obra(s) ativa(s)`;
  if($("dash-medido"))          $("dash-medido").textContent = brl(medido);
  if($("dash-medido-sub"))      $("dash-medido-sub").textContent = `${(medsAprovadas||[]).length} medição(ões) aprovada(s)/faturada(s)`;
  if($("dash-a-medir"))         $("dash-a-medir").textContent = brl(Math.max(0, aMedir));
  if($("dash-pct"))             $("dash-pct").textContent = `${pct}%`;
  if($("dash-pct-bar"))         $("dash-pct-bar").style.width = `${Math.min(100, pct)}%`;
}

/* ============================================================
   KPIs OPERACIONAIS — obras / RDOs / estacas / orçamentos
   ============================================================ */
async function carregarDashOperacional(){
  const hoje = new Date();
  const inicioMes = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const fimMes    = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth()+1, 0));

  const [
    { count: cntAtivas },
    { count: cntConcluidasMes },
    { data: rdosMes },
    { data: estacasMes },
    { count: cntOrcAbertos },
    { data: orcAbertos }
  ] = await Promise.all([
    sb.from("obras").select("id",{count:"exact",head:true}).eq("status","em_andamento"),
    sb.from("obras").select("id",{count:"exact",head:true})
      .eq("status","concluida").gte("data_fim_real", inicioMes).lte("data_fim_real", fimMes),
    sb.from("rdo").select("id,producao_dia_m").gte("data", inicioMes).lte("data", fimMes),
    // !inner faz o filtro em rdo.data valer para as linhas-pai (sem ele, o PostgREST
    // devolvia TODAS as execuções e o filtro era só no navegador); lte fecha o mês.
    sb.from("rdo_execucao_estaca").select("profundidade_executada,volume_concreto_m3,rdo:rdo_id!inner(data)").gte("rdo.data", inicioMes).lte("rdo.data", fimMes),
    sb.from("orcamentos").select("id",{count:"exact",head:true}).in("status",["rascunho","enviado","em_negociacao"]),
    sb.from("orcamentos").select("valor_total").in("status",["rascunho","enviado","em_negociacao"])
  ]);

  // Estado "vazio": zero em cinza (não "quebrado") — ver .dash-num-vazio
  const kpiNum = (id, v) => { const n = $(id); if(!n) return; n.textContent = v; n.classList.toggle("dash-num-vazio", !(Number(v) > 0)); };
  kpiNum("dash-obras-ativas", cntAtivas || 0);
  if($("dash-obras-sub"))    $("dash-obras-sub").textContent = `${cntAtivas||0} em andamento · ${cntConcluidasMes||0} concluída(s) este mês`;

  kpiNum("dash-rdos-mes", (rdosMes||[]).length);
  const totalProdRDO = (rdosMes||[]).reduce((s,r) => s + (Number(r.producao_dia_m)||0), 0);
  if($("dash-rdos-sub")) $("dash-rdos-sub").textContent = `${num(totalProdRDO)} m de produção no mês`;

  const execs = (estacasMes||[]).filter(e => e.rdo && e.rdo.data >= inicioMes);
  const totalEstacas = execs.length;
  const totalProf    = execs.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0);
  const totalConc    = execs.reduce((s,e) => s + (Number(e.volume_concreto_m3)||0), 0);
  kpiNum("dash-estacas-mes", totalEstacas);
  if($("dash-estacas-sub")) $("dash-estacas-sub").textContent = `${num(totalProf)} m executados · ${num(totalConc)} m³ concreto`;

  const valorOrcAbertos = (orcAbertos||[]).reduce((s,o) => s + (Number(o.valor_total)||0), 0);
  kpiNum("dash-orc-abertos", cntOrcAbertos || 0);
  if($("dash-orc-sub"))     $("dash-orc-sub").textContent = `${brl(valorOrcAbertos)} em pipeline`;
}

/* ============================================================
   AÇÕES PENDENTES — execuções órfãs / orçamentos vencendo / medições paradas / contratos
   ============================================================ */
async function carregarDashPendencias(){
  const cont = $("dash-pendencias");
  if(!cont) return;

  const hoje = new Date();
  const proximos7  = addDiasISO(7);   // datas em fuso local (ver hojeISO em core.js)
  const hojeISOstr = hojeISO();
  const d5atras    = addDiasISO(-5);

  const [
    { data: orfas },
    { data: orcVenc },
    { data: medParadas },
    { data: comentMarcado }
  ] = await Promise.all([
    sb.from("rdo_execucao_estaca").select("id, rdo:rdo_id(obra_id)").is("estaca_id", null),
    sb.from("orcamentos").select("id,numero,validade,cliente_id").lte("validade", proximos7).gte("validade", hojeISOstr).in("status",["enviado","em_negociacao"]),
    sb.from("medicoes").select("id,numero,updated_at,obra_id").eq("status","rascunho").lte("updated_at", d5atras + "T23:59:59"),
    // comentários de obra em que EU fui marcado como responsável (fase 23)
    usuarioAtual?.id
      ? sb.from("obras_comentarios")
          .select("id,texto,created_at,obra_id,obra:obra_id(codigo,nome)")
          .eq("responsavel_id", usuarioAtual.id).eq("resolvido", false)
          .order("created_at")
      : Promise.resolve({ data: [] })
  ]);

  // Agrupa órfãs por obra
  const orfasPorObra = {};
  (orfas||[]).forEach(o => {
    if(!o.rdo?.obra_id) return;
    orfasPorObra[o.rdo.obra_id] = (orfasPorObra[o.rdo.obra_id] || 0) + 1;
  });
  const obrasComOrfas = Object.keys(orfasPorObra).length;
  const totalOrfas    = Object.values(orfasPorObra).reduce((s,n) => s + n, 0);

  const itens = [];

  // Fui marcado como responsável num comentário de obra — vai no topo
  (comentMarcado || []).forEach(cm => {
    const dias = Math.floor((hoje - new Date(cm.created_at)) / 86400000);
    const resumo = (cm.texto || "").length > 90 ? cm.texto.slice(0, 90) + "…" : cm.texto;
    itens.push({
      icone: "💬", cor: "var(--marca-600)", bg: "var(--info-bg)",
      texto: `Você foi marcado na obra <strong>${esc(cm.obra?.codigo || "?")}</strong>${
        dias > 0 ? ` há ${dias} dia(s)` : ""}: “${esc(resumo)}” — abra a obra → Timeline`,
      nav: () => dashAbrirObra(cm.obra_id, "timeline")
    });
  });

  if(totalOrfas > 0){
    const idsOrfas = Object.keys(orfasPorObra);
    itens.push({
      icone: "🔧", cor: "var(--aviso)", bg: "var(--aviso-bg)",
      texto: `<strong>${totalOrfas} execuções órfãs</strong> em ${obrasComOrfas} obra(s) — abra a obra → Estacas → 🔍 Conferência`,
      nav: idsOrfas.length === 1
        ? () => dashAbrirObra(idsOrfas[0], "estacas")
        : () => irParaSecao("obras")
    });
  }
  (orcVenc||[]).forEach(o => {
    // "T00:00:00" força leitura no fuso local (sem isso, "YYYY-MM-DD" é UTC = 21h do dia anterior no BR)
    const dias = Math.ceil((new Date(String(o.validade).slice(0,10) + "T00:00:00") - hoje) / 86400000);
    itens.push({
      icone: "📄", cor: "var(--perigo)", bg: "var(--perigo-bg)",
      texto: `Orçamento <strong>${esc(o.numero)}</strong> vence em ${dias} dia(s) (${dataBR(o.validade)})`,
      nav: () => dashAbrirOrcamento(o.id)
    });
  });
  (medParadas||[]).forEach(m => {
    const dias = Math.ceil((hoje - new Date(m.updated_at)) / 86400000);
    itens.push({
      icone: "💰", cor: "var(--marca-600)", bg: "var(--info-bg)",
      texto: `Medição <strong>${esc(m.numero)}</strong> parada em rascunho há ${dias} dia(s)`,
      nav: () => dashAbrirMedicao(m.id)
    });
  });

  // Contratos de fornecedor entrando na janela de aviso (fase 21)
  if(typeof contratosVencendo === "function"){
    const contrVenc = await contratosVencendo();
    contrVenc.forEach(c => {
      const dias = diasParaVencer(c);
      const quando = dias < 0
        ? `venceu há ${Math.abs(dias)} dia(s)`
        : dias === 0 ? "vence hoje" : `vence em ${dias} dia(s)`;
      const forn = mapaFornecedores[c.fornecedor_id] || "fornecedor não informado";
      const renova = c.renovacao_automatica ? " — renova automaticamente" : "";
      itens.push({
        icone: dias < 0 ? "⛔" : "📋",
        cor: dias < 0 ? "var(--perigo)" : "var(--aviso)",
        bg:  dias < 0 ? "var(--perigo-bg)" : "var(--aviso-bg)",
        texto: `Contrato <strong>${esc(c.numero)}</strong> (${esc(forn)}) ${quando} (${dataBR(c.data_fim_prevista)})${renova}`,
        nav: () => dashAbrirContrato(c.id)
      });
    });
  }

  if(!itens.length){
    cont.innerHTML = `<p class="vazio" style="font-size:12px;color:var(--sucesso);">✅ Nenhuma pendência. Bom trabalho!</p>`;
    return;
  }
  _dashPendNav = itens.map(it => it.nav || null);
  cont.innerHTML = itens.map((it, idx) => `
    <div class="dash-pendencia-item${it.nav ? " clicavel" : ""}" ${it.nav ? `data-idx="${idx}" title="Ir para o registro"` : ""}>
      <div class="dash-pendencia-icone" style="background:${it.bg};color:${it.cor};">${it.icone}</div>
      <div style="flex:1;">${it.texto}</div>
      ${it.nav ? '<span class="dash-pend-seta">›</span>' : ""}
    </div>`).join("");
  cont.querySelectorAll(".dash-pendencia-item.clicavel").forEach(el => {
    el.addEventListener("click", () => {
      const fn = _dashPendNav[Number(el.dataset.idx)];
      if(typeof fn === "function") fn();
    });
  });
}

/* ============================================================
   GRÁFICO PRODUÇÃO 30 DIAS (mini-barras)
   ============================================================ */
async function carregarDashGraficoProducao(){
  const cont = $("dash-grafico-prod");
  if(!cont) return;
  const hoje = new Date();
  const ini  = addDiasISO(-30);
  const { data } = await sb.from("rdo")
    .select("data,producao_dia_m")
    .gte("data", ini)
    .order("data");
  if(!data || !data.length){
    cont.innerHTML = `<p class="vazio" style="font-size:12px;">Sem RDOs nos últimos 30 dias.</p>`;
    return;
  }
  // Agrupa por dia
  const porDia = {};
  data.forEach(r => { porDia[r.data] = (porDia[r.data]||0) + (Number(r.producao_dia_m)||0); });
  const dias = Object.keys(porDia).sort();
  const max  = Math.max(...Object.values(porDia), 1);
  const barras = dias.map(d => {
    const v = porDia[d];
    const h = Math.round((v / max) * 80);
    return `<div title="${dataBR(d)}: ${num(v)} m" style="display:inline-block;width:10px;height:80px;vertical-align:bottom;margin:0 1px;">
      <div style="background:var(--marca-600);width:100%;height:${h}px;margin-top:${80-h}px;border-radius:2px 2px 0 0;"></div>
    </div>`;
  }).join("");
  const total = Object.values(porDia).reduce((s,v) => s + v, 0);
  cont.innerHTML = `
    <div style="font-size:11px;color:var(--txt-fraco);margin-bottom:6px;">${num(total)} m totais em ${dias.length} dia(s)</div>
    <div style="display:flex;align-items:flex-end;height:82px;overflow-x:auto;">${barras}</div>`;
}

/* ============================================================
   TOP 5 OBRAS (por valor contratado)
   ============================================================ */
async function carregarDashTopObras(){
  const cont = $("dash-top-obras");
  if(!cont) return;
  const { data } = await sb.from("obras")
    .select("id,codigo,nome,valor_contratado,status")
    .in("status",["em_andamento","planejada","paralisada"])
    .order("valor_contratado",{ascending:false})
    .limit(5);
  if(!data || !data.length){
    cont.innerHTML = `<p class="vazio" style="font-size:12px;">Nenhuma obra ativa.</p>`;
    return;
  }
  cont.innerHTML = `<div style="font-size:12px;">${data.map((o,i) => `
    <div class="dash-linha-obra clicavel" data-obra-id="${esc(o.id)}" title="Abrir a obra" style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px;border-bottom:1px solid var(--sup-3);">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <strong>${i+1}.</strong> ${esc(o.codigo)} <span style="color:var(--txt-sutil);">·</span> ${esc((o.nome||"").slice(0,30))}${(o.nome||"").length>30?"…":""}
      </div>
      <strong style="color:var(--sucesso);">${brl(o.valor_contratado)}</strong>
    </div>`).join("")}</div>`;
  cont.querySelectorAll(".dash-linha-obra[data-obra-id]").forEach(el => {
    el.addEventListener("click", () => dashAbrirObra(el.dataset.obraId));
  });
}

/* ============================================================
   ATIVIDADE RECENTE 48h (últimos eventos do sistema)
   ============================================================ */
async function carregarDashAtividade(){
  const cont = $("dash-atividade");
  if(!cont) return;
  const desde = new Date(Date.now() - 48*3600*1000).toISOString();

  const [
    { data: medsNovas },
    { data: rdosNovos },
    { data: estsAlt }
  ] = await Promise.all([
    sb.from("medicoes").select("numero,obra_id,obra:obra_id(codigo,nome),created_at,criado_por").gte("created_at", desde).order("created_at",{ascending:false}).limit(10),
    sb.from("rdo").select("data,tipo_servico,obra_id,obra:obra_id(codigo,nome),created_at,criado_por").gte("created_at", desde).order("created_at",{ascending:false}).limit(10),
    sb.from("estacas").select("numero,obra_id,alterada_em,alterada_por,alteracao_motivo,obra:obra_id(codigo,nome)").not("alterada_em","is",null).gte("alterada_em", desde).order("alterada_em",{ascending:false}).limit(10)
  ]);

  const userIds = new Set();
  (medsNovas||[]).forEach(m => m.criado_por && userIds.add(m.criado_por));
  (rdosNovos||[]).forEach(r => r.criado_por && userIds.add(r.criado_por));
  (estsAlt||[]).forEach(e => e.alterada_por && userIds.add(e.alterada_por));
  const mapaU = {};
  if(userIds.size){
    const { data: profs } = await sb.from("profiles").select("id,nome").in("id",[...userIds]);
    // esc() aqui: profiles.nome é editável pelo próprio usuário e vai para innerHTML
    (profs||[]).forEach(p => { mapaU[p.id] = esc(p.nome); });
  }
  const nomeDe = (uid) => uid ? (mapaU[uid] || "usuário") : "sistema";

  const eventos = [];
  (medsNovas||[]).forEach(m => eventos.push({
    quando: m.created_at, obraId: m.obra_id, tab: "medicoes",
    txt: `💰 ${nomeDe(m.criado_por)} criou medição <strong>${esc(m.numero)}</strong> · ${esc(m.obra?.codigo||"")} ${esc((m.obra?.nome||"").slice(0,25))}`
  }));
  (rdosNovos||[]).forEach(r => eventos.push({
    quando: r.created_at, obraId: r.obra_id, tab: "rdos",
    txt: `📋 ${nomeDe(r.criado_por)} criou RDO ${dataBR(r.data)} (${esc((r.tipo_servico||"").replace("_"," "))}) · ${esc(r.obra?.codigo||"")} ${esc((r.obra?.nome||"").slice(0,25))}`
  }));
  (estsAlt||[]).forEach(e => eventos.push({
    quando: e.alterada_em, obraId: e.obra_id, tab: "estacas",
    txt: `🔄 ${nomeDe(e.alterada_por)} alterou estaca <strong>${esc(e.numero)}</strong> · ${esc((e.alteracao_motivo||"").slice(0,60))}`
  }));
  eventos.sort((a,b) => new Date(b.quando) - new Date(a.quando));

  if(!eventos.length){
    cont.innerHTML = `<p class="vazio" style="font-size:12px;">Nenhuma atividade nas últimas 48h.</p>`;
    return;
  }
  const vis = eventos.slice(0,8);
  cont.innerHTML = `<div style="font-size:12px;">${vis.map((e, idx) => {
    const dt = new Date(e.quando);
    const hora = dt.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
    const cls   = e.obraId ? ' class="dash-ativ-item clicavel"' : "";
    const extra = e.obraId ? `cursor:pointer;` : "";
    const attrs = e.obraId ? ` data-idx="${idx}" title="Abrir a obra"` : "";
    return `<div${cls}${attrs} style="padding:6px 4px;border-bottom:1px solid var(--sup-3);${extra}">
      <span style="color:var(--txt-sutil);font-size:11px;">${hora}</span> · ${e.txt}
    </div>`;
  }).join("")}</div>`;
  cont.querySelectorAll(".dash-ativ-item[data-idx]").forEach(el => {
    el.addEventListener("click", () => {
      const e = vis[Number(el.dataset.idx)];
      if(e && e.obraId) dashAbrirObra(e.obraId, e.tab);
    });
  });
}

/* ============================================================
   POSIÇÃO DE ESTOQUE (mantida pra aba antiga)
   ============================================================ */
async function carregarPosicaoEstoque(){
  const tb = $("tab-estoque");
  if(!tb) return;
  // Só ativos e limitado: esta aba é legada; 9.479 linhas num tbody oculto não faz sentido
  const { data } = await sb.from("produtos").select("codigo,nome,estoque_atual,estoque_minimo,custo_ultimo").eq("ativo", true).order("nome").limit(200);
  const lista = data || [];
  if(!lista.length){ tb.innerHTML = `<tr><td colspan="5" class="vazio">Nenhum produto.</td></tr>`; return; }
  tb.innerHTML = lista.map(p => `<tr>
    <td>${esc(p.codigo)}</td><td>${esc(p.nome)}</td>
    <td>${num(p.estoque_atual)}</td><td>${brl(p.custo_ultimo)}</td>
    <td>${brl(Number(p.estoque_atual)*Number(p.custo_ultimo))}</td></tr>`).join("");
}

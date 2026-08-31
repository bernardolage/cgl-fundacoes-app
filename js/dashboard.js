/* ====================================================================
   Dashboard (Home) — visão geral do negócio CGL
   ==================================================================== */

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

  // Mantém compat: alimenta a aba Estoque antiga
  await carregarPosicaoEstoque();
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
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0,10);
  const fimMes    = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0).toISOString().slice(0,10);

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
    sb.from("rdo_execucao_estaca").select("profundidade_executada,volume_concreto_m3,rdo:rdo_id(data)").gte("rdo.data", inicioMes),
    sb.from("orcamentos").select("id",{count:"exact",head:true}).in("status",["rascunho","enviado","em_negociacao"]),
    sb.from("orcamentos").select("valor_total").in("status",["rascunho","enviado","em_negociacao"])
  ]);

  if($("dash-obras-ativas")) $("dash-obras-ativas").textContent = cntAtivas || 0;
  if($("dash-obras-sub"))    $("dash-obras-sub").textContent = `${cntAtivas||0} em andamento · ${cntConcluidasMes||0} concluída(s) este mês`;

  if($("dash-rdos-mes")) $("dash-rdos-mes").textContent = (rdosMes||[]).length;
  const totalProdRDO = (rdosMes||[]).reduce((s,r) => s + (Number(r.producao_dia_m)||0), 0);
  if($("dash-rdos-sub")) $("dash-rdos-sub").textContent = `${num(totalProdRDO)} m de produção no mês`;

  const execs = (estacasMes||[]).filter(e => e.rdo && e.rdo.data >= inicioMes);
  const totalEstacas = execs.length;
  const totalProf    = execs.reduce((s,e) => s + (Number(e.profundidade_executada)||0), 0);
  const totalConc    = execs.reduce((s,e) => s + (Number(e.volume_concreto_m3)||0), 0);
  if($("dash-estacas-mes")) $("dash-estacas-mes").textContent = totalEstacas;
  if($("dash-estacas-sub")) $("dash-estacas-sub").textContent = `${num(totalProf)} m executados · ${num(totalConc)} m³ concreto`;

  const valorOrcAbertos = (orcAbertos||[]).reduce((s,o) => s + (Number(o.valor_total)||0), 0);
  if($("dash-orc-abertos")) $("dash-orc-abertos").textContent = cntOrcAbertos || 0;
  if($("dash-orc-sub"))     $("dash-orc-sub").textContent = `${brl(valorOrcAbertos)} em pipeline`;
}

/* ============================================================
   AÇÕES PENDENTES — execuções órfãs / orçamentos vencendo / medições paradas / contratos
   ============================================================ */
async function carregarDashPendencias(){
  const cont = $("dash-pendencias");
  if(!cont) return;

  const hoje = new Date();
  const proximos7 = new Date(hoje.getTime() + 7*86400000).toISOString().slice(0,10);
  const hojeISOstr = hoje.toISOString().slice(0,10);
  const d5atras = new Date(hoje.getTime() - 5*86400000).toISOString().slice(0,10);

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
          .select("id,texto,created_at,obra:obra_id(codigo,nome)")
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
        dias > 0 ? ` há ${dias} dia(s)` : ""}: “${esc(resumo)}” — abra a obra → Timeline`
    });
  });

  if(totalOrfas > 0){
    itens.push({
      icone: "🔧", cor: "var(--aviso)", bg: "var(--aviso-bg)",
      texto: `<strong>${totalOrfas} execuções órfãs</strong> em ${obrasComOrfas} obra(s) — abra a obra → Estacas → 🔍 Conferência`
    });
  }
  (orcVenc||[]).forEach(o => {
    const dias = Math.ceil((new Date(o.validade) - hoje) / 86400000);
    itens.push({
      icone: "📄", cor: "var(--perigo)", bg: "var(--perigo-bg)",
      texto: `Orçamento <strong>${esc(o.numero)}</strong> vence em ${dias} dia(s) (${dataBR(o.validade)})`
    });
  });
  (medParadas||[]).forEach(m => {
    const dias = Math.ceil((hoje - new Date(m.updated_at)) / 86400000);
    itens.push({
      icone: "💰", cor: "var(--marca-600)", bg: "var(--info-bg)",
      texto: `Medição <strong>${esc(m.numero)}</strong> parada em rascunho há ${dias} dia(s)`
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
        texto: `Contrato <strong>${esc(c.numero)}</strong> (${esc(forn)}) ${quando} (${dataBR(c.data_fim_prevista)})${renova}`
      });
    });
  }

  if(!itens.length){
    cont.innerHTML = `<p class="vazio" style="font-size:12px;color:var(--sucesso);">✅ Nenhuma pendência. Bom trabalho!</p>`;
    return;
  }
  cont.innerHTML = itens.map(it => `
    <div class="dash-pendencia-item">
      <div class="dash-pendencia-icone" style="background:${it.bg};color:${it.cor};">${it.icone}</div>
      <div style="flex:1;">${it.texto}</div>
    </div>`).join("");
}

/* ============================================================
   GRÁFICO PRODUÇÃO 30 DIAS (mini-barras)
   ============================================================ */
async function carregarDashGraficoProducao(){
  const cont = $("dash-grafico-prod");
  if(!cont) return;
  const hoje = new Date();
  const ini  = new Date(hoje.getTime() - 30*86400000).toISOString().slice(0,10);
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
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px;border-bottom:1px solid var(--sup-3);">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <strong>${i+1}.</strong> ${esc(o.codigo)} <span style="color:var(--txt-sutil);">·</span> ${esc((o.nome||"").slice(0,30))}${(o.nome||"").length>30?"…":""}
      </div>
      <strong style="color:var(--sucesso);">${brl(o.valor_contratado)}</strong>
    </div>`).join("")}</div>`;
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
    sb.from("medicoes").select("numero,obra:obra_id(codigo,nome),created_at,criado_por").gte("created_at", desde).order("created_at",{ascending:false}).limit(10),
    sb.from("rdo").select("data,tipo_servico,obra:obra_id(codigo,nome),created_at,criado_por").gte("created_at", desde).order("created_at",{ascending:false}).limit(10),
    sb.from("estacas").select("numero,alterada_em,alterada_por,alteracao_motivo,obra:obra_id(codigo,nome)").not("alterada_em","is",null).gte("alterada_em", desde).order("alterada_em",{ascending:false}).limit(10)
  ]);

  const userIds = new Set();
  (medsNovas||[]).forEach(m => m.criado_por && userIds.add(m.criado_por));
  (rdosNovos||[]).forEach(r => r.criado_por && userIds.add(r.criado_por));
  (estsAlt||[]).forEach(e => e.alterada_por && userIds.add(e.alterada_por));
  const mapaU = {};
  if(userIds.size){
    const { data: profs } = await sb.from("profiles").select("id,nome").in("id",[...userIds]);
    (profs||[]).forEach(p => { mapaU[p.id] = p.nome; });
  }
  const nomeDe = (uid) => uid ? (mapaU[uid] || "usuário") : "sistema";

  const eventos = [];
  (medsNovas||[]).forEach(m => eventos.push({
    quando: m.created_at,
    txt: `💰 ${nomeDe(m.criado_por)} criou medição <strong>${esc(m.numero)}</strong> · ${esc(m.obra?.codigo||"")} ${esc((m.obra?.nome||"").slice(0,25))}`
  }));
  (rdosNovos||[]).forEach(r => eventos.push({
    quando: r.created_at,
    txt: `📋 ${nomeDe(r.criado_por)} criou RDO ${dataBR(r.data)} (${esc((r.tipo_servico||"").replace("_"," "))}) · ${esc(r.obra?.codigo||"")} ${esc((r.obra?.nome||"").slice(0,25))}`
  }));
  (estsAlt||[]).forEach(e => eventos.push({
    quando: e.alterada_em,
    txt: `🔄 ${nomeDe(e.alterada_por)} alterou estaca <strong>${esc(e.numero)}</strong> · ${esc((e.alteracao_motivo||"").slice(0,60))}`
  }));
  eventos.sort((a,b) => new Date(b.quando) - new Date(a.quando));

  if(!eventos.length){
    cont.innerHTML = `<p class="vazio" style="font-size:12px;">Nenhuma atividade nas últimas 48h.</p>`;
    return;
  }
  cont.innerHTML = `<div style="font-size:12px;">${eventos.slice(0,8).map(e => {
    const dt = new Date(e.quando);
    const hora = dt.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
    return `<div style="padding:6px 4px;border-bottom:1px solid var(--sup-3);">
      <span style="color:var(--txt-sutil);font-size:11px;">${hora}</span> · ${e.txt}
    </div>`;
  }).join("")}</div>`;
}

/* ============================================================
   POSIÇÃO DE ESTOQUE (mantida pra aba antiga)
   ============================================================ */
async function carregarPosicaoEstoque(){
  const tb = $("tab-estoque");
  if(!tb) return;
  const { data } = await sb.from("produtos").select("codigo,nome,estoque_atual,estoque_minimo,custo_ultimo").order("nome");
  const lista = data || [];
  if(!lista.length){ tb.innerHTML = `<tr><td colspan="5" class="vazio">Nenhum produto.</td></tr>`; return; }
  tb.innerHTML = lista.map(p => `<tr>
    <td>${esc(p.codigo)}</td><td>${esc(p.nome)}</td>
    <td>${num(p.estoque_atual)}</td><td>${brl(p.custo_ultimo)}</td>
    <td>${brl(Number(p.estoque_atual)*Number(p.custo_ultimo))}</td></tr>`).join("");
}

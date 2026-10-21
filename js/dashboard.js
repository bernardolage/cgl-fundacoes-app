/* ====================================================================
   Início — Sala de Comando (fase 63, 05/10/2026)
   O Início abre pelo que está errado: faixa do período, "Exige ação hoje",
   "Minha fila" e abas (frota, obras em execução, operadores, produção).
   Tudo calculado no banco nas views vw_sc_* (security_invoker: cada cargo
   vê o que as policies deixam); o front só desenha.
   Carga em duas ondas: 1) faixa + ações + fila; 2) abas e o resumo antigo.
   ==================================================================== */

const DASH_PERIODOS = { hoje: "hoje", "7d": "nos últimos 7 dias", mes: "no mês", mes_ant: "no mês anterior" };
let _dashPeriodo = "mes";
try { const p = localStorage.getItem("dash-periodo"); if(DASH_PERIODOS[p]) _dashPeriodo = p; } catch(_e) { /* sem storage: fica no mês */ }
let _dashProd = [];        // vw_sc_producao_dia do período atual e do anterior
let _dashFrota = [];       // vw_sc_frota
let _dashViagens = [];     // viagens planejadas e em trânsito (fase 89, aba Frota)
let _dashObrasAnd = [];    // vw_sc_obra_andamento
let _dashAcoes = [];       // vw_sc_acoes
let _dashFila = [];        // vw_sc_minha_fila
let _dashReg = [];         // vw_sc_regularizar (fase 75)
let _dashObraMat = {};     // vw_sc_obra_material (fase 83): obra_id → separações abertas
let _dashFrotaFiltro = "todas";
let _dashCargaN = 0;       // descarta resposta de carga antiga quando o período muda no meio
const DASH_NIVEL = {
  critico:      { label: "Crítico",      cor: "vermelho", ordem: 1 },
  atencao:      { label: "Atenção",      cor: "ambar",    ordem: 2 },
  observar:     { label: "Observar",     cor: "azul",     ordem: 3 },
  conformidade: { label: "Conformidade", cor: "cinza",    ordem: 4 }
};
const DASH_SETOR = { obras: "Obras", frota: "Frota", financeiro: "Financeiro", compras: "Compras",
  mobilizacao: "Mobilização", chamados: "Chamados", contratos: "Contratos e propostas", almoxarifado: "Almoxarifado", oficina: "Oficina", manutencao: "Manutenção",
  rh: "RH" };   // fase 93a: plano de cargos (vw_sc_regularizar_rh)
/* Decisão do Bernardo (05/10/2026): alerta vai para o gestor daquele segmento, não vira chamado.
   "Exige ação hoje" mostra a cada cargo só os setores que ele gere; diretor e admin veem todos.
   As policies continuam filtrando por baixo (quem não lê contrato não vê a linha de contrato). */
const DASH_SETOR_GESTORES = {
  obras:       ["engenheiro", "assistente_engenharia", "encarregado"],
  frota:       ["mecanico", "logistica", "gestor_acessorios", "gestor_frota"],
  financeiro:  ["financeiro"],
  compras:     ["comprador", "almoxarife"],
  mobilizacao: ["logistica", "engenheiro"],
  chamados:    [],
  contratos:   ["comercial"],
  almoxarifado: ["almoxarife", "logistica", "comprador", "gestor_acessorios", "auxiliar_almoxarifado"],   // fase 83: separações; fase 90: equipe do Julio
  oficina:     ["mecanico", "gestor_acessorios", "logistica", "almoxarife", "engenheiro"],   // fase 84: ordens de fabricação
  manutencao:  ["gestor_manutencao", "mecanico", "engenheiro", "gestor_frota", "logistica"],   // fase 92: preventivas vencidas e checklist de mobilização
  rh:          ["rh"]   // fase 93a: mudanças de função do plano de cargos
};
function dashGereSetor(setor){
  const cargo = usuarioAtual?.cargo;
  if(["diretor", "admin", "auditor"].includes(cargo)) return true; // fase 79: auditor confere a Sala de Comando inteira
  return (DASH_SETOR_GESTORES[setor] || []).includes(cargo);
}
/* Fase 90: o auxiliar de almoxarifado (equipe do Julio) só tem "Exige ação hoje" (setor almoxarifado) e "Minha fila".
   Faixa do período, "Para regularizar", abas (frota, obras, operadores, produção), financeiro, orçamentos e atividade
   não aparecem nem são consultados; as views vw_sc_* já filtram por pode_ler_* no banco. */
function dashSoAlmoxarifado(){ return !!usuarioAtual && usuarioAtual.cargo === "auxiliar_almoxarifado"; }
const DASH_SITUACAO = {
  produzindo:   { label: "Produzindo hoje",      cor: "verde" },
  parada:       { label: "Parada",               cor: "ambar" },
  sem_producao: { label: "Sem produção (30 d)",  cor: "vermelho" },
  sem_obra:     { label: "Sem obra",             cor: "cinza" }
};

/* Período escolhido → datas (fuso local) e o período anterior de mesmo tamanho */
function dashIntervalo(p){
  const hoje = new Date(hojeISO() + "T12:00:00");
  const soma = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  let ini = hoje, fim = hoje;
  if(p === "7d") ini = soma(hoje, -6);
  else if(p === "mes") ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 12);
  else if(p === "mes_ant"){ ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1, 12); fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0, 12); }
  const dias = Math.round((fim - ini) / 86400000) + 1;
  return { ini: dataLocalISO(ini), fim: dataLocalISO(fim), antIni: dataLocalISO(soma(ini, -dias)), antFim: dataLocalISO(soma(ini, -1)), dias };
}

/* Toda leitura do Início passa por aqui: erro vira mensagem no próprio card, nunca card vazio */
async function dashLer(fonte, ajustar, alvo){
  const q = typeof ajustar === "function" ? ajustar(sb.from(fonte)) : sb.from(fonte).select("*");
  const { data, error } = await q;
  if(error){
    console.error("Início:", fonte, error);
    const el = alvo ? $(alvo) : null;
    if(el) el.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(error.message || "erro")}).</p>`;
    return null;
  }
  return data || [];
}
/* fase 99b (decisão 4): "Medido no período" e "A receber" são somatórios financeiros: podeVerKpiFinanceiro() (core.js) =
   diretor, admin, financeiro e auditor. O argumento é a regra anterior, que volta se KPI_FIN_RESTRITO = false
   (Medido: diretoria + quem vê contas a pagar, inclusive o comprador; A receber: a mesma lista de hoje). */
const dashPodeVerMedido = () => podeVerKpiFinanceiro(() => dashEhDiretoria() || (typeof podeVerContasPagar === "function" && podeVerContasPagar()));
/* fase 96: KPI "A receber" (medições + vendas de bens) — quem gere o setor financeiro: diretor, admin, financeiro e auditor */
const dashPodeVerReceber = () => podeVerKpiFinanceiro(() => !!usuarioAtual && ["diretor", "admin", "financeiro", "auditor"].includes(usuarioAtual.cargo));
/* fase 99b: card Segurança (vw_sc_seguranca) — diretor, admin e auditor; o banco devolve vazio aos demais */
const dashPodeVerSeguranca = () => !!usuarioAtual && ["diretor", "admin", "auditor"].includes(usuarioAtual.cargo);

async function carregarDashboard(){
  const carga = ++_dashCargaN;
  // Saudação
  const nome = (typeof usuarioAtual !== "undefined" && usuarioAtual?.nome) ? usuarioAtual.nome.split(" ")[0] : "";
  if($("dash-saudacao")) $("dash-saudacao").textContent = nome ? `👋 Olá, ${nome} · Sala de Comando` : "👋 Sala de Comando";
  if($("dash-data-hoje")) $("dash-data-hoje").textContent = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
  document.querySelectorAll("#dash-periodo [data-periodo]").forEach(b => b.classList.toggle("ativo", b.dataset.periodo === _dashPeriodo));
  if($("dash-card-medido")) $("dash-card-medido").style.display = dashPodeVerMedido() ? "" : "none";
  if($("dash-card-custo"))  $("dash-card-custo").style.display  = dashEhDiretoria() ? "" : "none";
  if($("dash-card-receber")) $("dash-card-receber").style.display = dashPodeVerReceber() ? "" : "none";   // fase 96
  if($("dash-seguranca-card")) $("dash-seguranca-card").style.display = dashPodeVerSeguranca() ? "" : "none";   // fase 99b
  const finEl = $("dash-financeiro");
  if(finEl) finEl.style.display = dashEhDiretoria() ? "" : "none";
  // fase 90: auxiliar de almoxarifado vê só "Exige ação hoje" e "Minha fila"
  const soAlmox = dashSoAlmoxarifado();
  [$("dash-faixa"), $("dash-periodo"), $("dash-regularizar")?.closest(".card"), document.querySelector("#sec-inicio .dash-abas"), $("dash-card-orc")?.closest(".dash-duas-col")]
    .forEach(el => { if(el) el.style.display = soAlmox ? "none" : ""; });

  // 1ª onda: o que o usuário olha primeiro
  const t0 = performance.now();
  await Promise.all([soAlmox ? null : carregarDashFaixa(carga), dashCarregarAcoes(), dashCarregarFila(), soAlmox ? null : dashCarregarRegularizar()]);
  if(carga !== _dashCargaN) return;
  console.info(`Início: 1ª onda em ${Math.round(performance.now() - t0)} ms`);
  if($("dash-atualizado")) $("dash-atualizado").textContent = "atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if(soAlmox){ ligarCliquesDashboard(); return; }   // fase 90: sem abas, resumo nem atividade para o auxiliar

  // 2ª onda: abas e o resumo do fim da página
  await Promise.all([
    dashCarregarObrasAndamento(),
    carregarDashGraficoProducao(),
    carregarDashTopObras(),
    carregarDashAtividade(),
    carregarDashOrcamentos(),
    dashPodeVerSeguranca() ? dashCarregarSeguranca() : Promise.resolve(),   // fase 99b
    dashEhDiretoria() ? carregarDashFinanceiro() : Promise.resolve(),
    dashEhDiretoria() ? carregarDashIA() : Promise.resolve()
  ]);
  if(carga !== _dashCargaN) return;
  renderDashFrota();
  await renderDashOperadores();

  // A posição de estoque (aba antiga, oculta) NÃO carrega mais no boot: eram
  // 9.479 produtos + 9.479 <tr> a cada login (~60% do payload inicial).
  // Passou a carregar sob demanda ao abrir a seção Estoque (core.js, nav).
  ligarCliquesDashboard();
}

/* ---------- Faixa de indicadores ---------- */
async function carregarDashFaixa(carga){
  const iv = dashIntervalo(_dashPeriodo);
  const verReceber = dashPodeVerReceber();
  const [prod, frota, obras, rdos, meds, custos, viagens, recMed, recVendas] = await Promise.all([
    dashLer("vw_sc_producao_dia", q => q.select("obra_id,equipamento_id,data,estacas,metros,operador_id").gte("data", iv.antIni).lte("data", iv.fim), "dash-k-producao-sub"),
    dashLer("vw_sc_frota", q => q.select("*"), "dash-frota-lista"),
    dashLer("vw_sc_obra_andamento", q => q.select("*"), "dash-k-obras-sub"),
    dashLer("rdo", q => q.select("obra_id").gte("data", iv.ini).lte("data", iv.fim), "dash-k-obras-sub"),
    dashPodeVerMedido() ? dashLer("medicoes", q => q.select("valor_final,valor_medido").in("status", ["aprovada","faturada","recebida"]).gte("data_medicao", iv.ini).lte("data_medicao", iv.fim), "dash-k-medido-sub") : Promise.resolve([]),   // fase 91: recebida conta como medida
    dashEhDiretoria() ? dashLer("vw_custos", q => q.select("valor").gte("data", iv.ini).lte("data", iv.fim), "dash-k-custo-sub") : Promise.resolve([]),
    // fase 89: viagens em trânsito agora e planejadas sem caminhão/motorista (aba Frota)
    dashLer("viagens", q => q.select("id,numero,data,status,finalidade,caminhao_id,funcionario_id,destino_tipo,destino_obra_id,destino_descricao,data_saida,caminhao:equipamentos!caminhao_id(codigo),funcionario:funcionarios(nome)").in("status", ["planejada", "em_transito"]).order("data")),
    // fase 96: "A receber" = NFs de medição não recebidas (mesma regra da fase 91) + saldo das vendas de bens
    verReceber ? dashLer("medicoes", q => q.select("valor_final,valor_medido,retencao_valor,iss_valor,iss_retido_fonte,recebido_valor,nf_numero,nf_vencimento,status").in("status", ["aprovada", "faturada"]).not("nf_numero", "is", null), "dash-k-receber-sub") : Promise.resolve(null),
    verReceber && typeof vbResumoAReceber === "function" ? vbResumoAReceber() : Promise.resolve(null)
  ]);
  if(carga !== _dashCargaN) return;
  _dashProd = prod || []; _dashFrota = frota || []; _dashObrasAnd = obras || []; _dashViagens = viagens || [];
  const set = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  const vazio = (id, cond) => { const el = $(id); if(el) el.classList.toggle("dash-num-vazio", !!cond); };
  const quando = DASH_PERIODOS[_dashPeriodo];

  if(prod){
    const atual = _dashProd.filter(p => p.data >= iv.ini), ant = _dashProd.filter(p => p.data <= iv.antFim);
    const m = atual.reduce((s, p) => s + Number(p.metros || 0), 0), e = atual.reduce((s, p) => s + Number(p.estacas || 0), 0);
    const mAnt = ant.reduce((s, p) => s + Number(p.metros || 0), 0);
    set("dash-k-producao", `${num(m)} m`); vazio("dash-k-producao", !(m > 0));
    const varia = mAnt > 0 ? Math.round((m - mAnt) / mAnt * 100) : null;
    set("dash-k-producao-sub", `${e} estaca(s) ${quando} · ${varia == null ? "sem base no período anterior" : (varia >= 0 ? "▲ " : "▼ ") + Math.abs(varia) + "% vs. anterior"}`);
  }
  // 20/10/2026 (Bernardo): o card "Máquinas ativas" (máquinas com execução ÷ em obra) saiu do Início — era a métrica de
  // cobrança por máquina do Maya e não diz nada para a CGL. A frota continua na lista "Frota" abaixo (_dashFrota).
  if(obras && rdos){
    const ids = new Set(_dashObrasAnd.map(o => o.obra_id));
    const com = new Set((rdos || []).map(r => r.obra_id).filter(id => ids.has(id))).size;
    set("dash-k-obras", `${com} / ${ids.size}`); vazio("dash-k-obras", !com);
    set("dash-k-obras-sub", `com RDO ${quando} ÷ em andamento`);
  }
  if(meds && dashPodeVerMedido()){
    const v = meds.reduce((s, x) => s + (Number(x.valor_final) || Number(x.valor_medido) || 0), 0);
    set("dash-k-medido", brl(v)); vazio("dash-k-medido", !(v > 0));
    set("dash-k-medido-sub", `${meds.length} medição(ões) aprovada(s) ou faturada(s) ${quando}`);
  }
  if(custos && dashEhDiretoria()){
    const v = custos.reduce((s, x) => s + Number(x.valor || 0), 0);
    set("dash-k-custo", brl(v)); vazio("dash-k-custo", !(v > 0));
    set("dash-k-custo-sub", `${custos.length} lançamento(s) ${quando}`);
  }
  // fase 96: A receber (não depende do período: é o saldo de hoje), em duas linhas no detalhe
  if(verReceber && recMed){
    const hoje = hojeISO();
    const liq = (m) => typeof medLiquido === "function" ? medLiquido(m) : (Number(m.valor_final) || Number(m.valor_medido) || 0) - (Number(m.retencao_valor) || 0) - (m.iss_retido_fonte === false ? 0 : (Number(m.iss_valor) || 0));
    const nfs = recMed.filter(m => String(m.nf_numero || "").trim()).map(m => ({ saldo: Math.max(0, Math.round((liq(m) - (Number(m.recebido_valor) || 0)) * 100) / 100), venc: !!m.nf_vencimento && m.nf_vencimento < hoje })).filter(m => m.saldo > 0.009);
    const medTot = nfs.reduce((s, m) => s + m.saldo, 0), medVenc = nfs.filter(m => m.venc).reduce((s, m) => s + m.saldo, 0);
    const vb = recVendas && !recVendas.erro ? recVendas : { total: 0, vencido: 0, n: 0 };
    const total = medTot + vb.total;
    set("dash-k-receber", brl(total)); vazio("dash-k-receber", !(total > 0));
    const sub = $("dash-k-receber-sub");
    if(sub) sub.innerHTML = `<a href="#" data-dash-receber="medicoes" title="Medições › NFs a receber">Medições ${brl(medTot)}</a> · ${nfs.length} NF(s)${medVenc > 0.009 ? ` <span class="txt-perigo">(${brl(medVenc)} vencido)</span>` : ""}<br>`
      + (recVendas?.erro ? `<span class="meta">Vendas de bens: não foi possível ler</span>`
        : `<a href="#" data-dash-receber="vendas" title="Equipamentos › Vendas em aberto">Vendas de bens ${brl(vb.total)}</a> · ${vb.n} venda(s)${vb.vencido > 0.009 ? ` <span class="txt-perigo">(${brl(vb.vencido)} vencido)</span>` : ""}`);
  }
}

/* ---------- Exige ação hoje ---------- */
async function dashCarregarAcoes(){
  const cont = $("dash-acoes");
  if(!cont) return;
  // fase 83: as separações vêm numa view à parte (vw_sc_acoes_sep); fase 84: a fabricação idem (vw_sc_acoes_fab); entram na mesma lista
  // fase 91: caução vencida / a vencer e NF vencida sem recebimento (setor financeiro) em vw_sc_acoes_fin
  // fase 92: preventiva vencida/vencendo e mobilização sem checklist aprovado (setor manutenção) em vw_sc_acoes_man
  const [dados, sep, fab, fin, man] = await Promise.all([dashLer("vw_sc_acoes", q => q.select("*"), "dash-acoes"), dashLer("vw_sc_acoes_sep", q => q.select("*")), dashLer("vw_sc_acoes_fab", q => q.select("*")), dashLer("vw_sc_acoes_fin", q => q.select("*")), dashLer("vw_sc_acoes_man", q => q.select("*"))]);
  if(!dados) return;
  _dashAcoes = dados.concat(sep || [], fab || [], fin || [], man || []).filter(a => dashGereSetor(a.setor))
    .sort((a, b) => (DASH_NIVEL[a.nivel]?.ordem || 9) - (DASH_NIVEL[b.nivel]?.ordem || 9) || a.ordem - b.ordem);
  const porNivel = {};
  _dashAcoes.forEach(a => { porNivel[a.nivel] = (porNivel[a.nivel] || 0) + 1; });
  if($("dash-acoes-cont")) $("dash-acoes-cont").innerHTML = _dashAcoes.length
    ? Object.entries(DASH_NIVEL).filter(([k]) => porNivel[k]).map(([k, o]) => `<span class="tag ${o.cor}">${porNivel[k]} ${esc(o.label.toLowerCase())}</span>`).join(" ")
    : "";
  if(!_dashAcoes.length){ cont.innerHTML = `<p class="vazio">✅ Nada exigindo ação hoje.</p>`; return; }
  // agrupado por setor, setores na ordem do item mais urgente
  const setores = [];
  _dashAcoes.forEach(a => { if(!setores.includes(a.setor)) setores.push(a.setor); });
  cont.innerHTML = setores.map(s => `<div class="dash-setor">
      <div class="dash-setor-tit">${esc(DASH_SETOR[s] || s)}</div>
      ${_dashAcoes.map((a, i) => a.setor !== s ? "" : dashLinhaAcao(a, i, "acao")).join("")}
    </div>`).join("");
}
function dashLinhaAcao(a, i, tipo){
  const n = DASH_NIVEL[a.nivel] || { label: a.nivel, cor: "cinza" };
  return `<div class="dash-pendencia-item clicavel" data-${tipo}="${i}" title="Abrir">
      <span class="tag ${n.cor}">${esc(n.label)}</span>
      <div class="dash-acao-txt"><strong>${esc(dashTituloAcao(a.titulo))}</strong>${a.quantidade > 1 ? ` <span class="contador">(${a.quantidade})</span>` : ""}
        ${a.detalhe ? `<div class="meta">${esc(a.detalhe)}</div>` : ""}</div>
      <span class="dash-pend-seta">›</span>
    </div>`;
}
// tipos de pendência de contrato vêm como texto sem acento do banco (vw_pendencias_contratos)
const DASH_TIPO_CONTRATO = { "composicao divergente": "composição divergente", "quadro parcial": "quadro de orçamento lido em parte",
  "aditivo sem valor": "aditivo sem valor", "valor provisorio": "valor provisório", "sem assinatura": "sem assinatura",
  "saldo negativo": "saldo negativo (precisa aditivo)", "aditivo pendente": "aditivo pendente" };
function dashTituloAcao(t){
  const m = String(t || "").match(/^Contrato: (.+)$/);
  return m ? "Contrato: " + (DASH_TIPO_CONTRATO[m[1]] || m[1]) : t;
}

/* ---------- Minha fila ---------- */
async function dashCarregarFila(){
  const cont = $("dash-fila");
  if(!cont) return;
  const [dados, sep] = await Promise.all([dashLer("vw_sc_minha_fila", q => q.select("*"), "dash-fila"), dashLer("vw_sc_minha_fila_sep", q => q.select("*"))]);   // fase 83
  if(!dados) return;
  _dashFila = dados.concat(sep || []).sort((a, b) => (DASH_NIVEL[a.nivel]?.ordem || 9) - (DASH_NIVEL[b.nivel]?.ordem || 9) || a.ordem - b.ordem);
  if($("dash-fila-cont")) $("dash-fila-cont").textContent = _dashFila.length ? `(${_dashFila.length})` : "";
  cont.innerHTML = _dashFila.length
    ? _dashFila.map((a, i) => dashLinhaAcao(a, i, "fila")).join("")
    : `<p class="vazio">Nada esperando por você.</p>`;
}
// Compatibilidade: a aba Timeline da obra (obra_abas.js) recarrega "pendências" ao resolver comentário
function carregarDashPendencias(){ return Promise.all([dashCarregarAcoes(), dashCarregarFila(), dashCarregarRegularizar()]); }

/* ---------- Para regularizar (fase 75) ----------
   Cadastro incompleto que o responsável corrige quando tiver tempo. O destino vem do banco
   (vw_sc_regularizar + responsaveis_servico): o que é seu primeiro, depois o total da
   diretoria, por último o que você só acompanha (mesmo bloco, com tag). */
const DASH_REG_PAPEL = {
  responsavel: { ordem: 1, tag: "" },
  diretoria:   { ordem: 2, tag: '<span class="tag cinza" title="Total da empresa (diretoria)">todos</span>' },
  acompanha:   { ordem: 3, tag: '<span class="tag azul" title="O responsável é outra pessoa; você acompanha">acompanha</span>' }
};
async function dashCarregarRegularizar(){
  const cont = $("dash-regularizar");
  if(!cont) return;
  // fase 91: cauções com previsão de devolução vencida (financeiro) em vw_sc_regularizar_fin, mesmas colunas
  // fase 92: OS atrasadas e leitura parada (vw_sc_regularizar_man); fase 93a: plano de cargos (vw_sc_regularizar_rh); fase 93c: horas a liberar há 15+ dias (vw_sc_regularizar_rhh); mesmas colunas
  const [dados, fin, man, rh, rhh] = await Promise.all([dashLer("vw_sc_regularizar", q => q.select("*"), "dash-regularizar"), dashLer("vw_sc_regularizar_fin", q => q.select("*")), dashLer("vw_sc_regularizar_man", q => q.select("*")), dashLer("vw_sc_regularizar_rh", q => q.select("*")), dashLer("vw_sc_regularizar_rhh", q => q.select("*"))]);
  if(!dados) return;
  _dashReg = dados.concat(fin || [], man || [], rh || [], rhh || []).sort((a, b) => (DASH_REG_PAPEL[a.papel]?.ordem || 9) - (DASH_REG_PAPEL[b.papel]?.ordem || 9)
    || a.ordem - b.ordem || String(a.titulo).localeCompare(String(b.titulo), "pt-BR", { numeric: true }));
  const n = p => _dashReg.filter(a => a.papel === p).length;
  if($("dash-reg-cont")) $("dash-reg-cont").innerHTML = _dashReg.length
    ? [n("responsavel") && `<span class="tag ambar">${n("responsavel")} seu(s)</span>`,
       n("diretoria") && `<span class="tag cinza">${n("diretoria")} no total</span>`,
       n("acompanha") && `<span class="tag azul">${n("acompanha")} acompanha</span>`].filter(Boolean).join(" ")
    : "";
  cont.innerHTML = _dashReg.length
    ? _dashReg.map((a, i) => `<div class="dash-pendencia-item clicavel" data-reg="${i}" title="Abrir a tela para corrigir">
        <div class="dash-acao-txt"><strong>${esc(a.titulo)}</strong> <span class="contador">(${a.quantidade})</span> ${DASH_REG_PAPEL[a.papel]?.tag || ""}
          ${a.detalhe ? `<div class="meta">${esc(a.detalhe)}</div>` : ""}</div>
        <span class="dash-pend-seta">›</span>
      </div>`).join("")
    : `<p class="vazio">Nada para regularizar.</p>`;
}
/* ---------- Segurança (fase 99b) ----------
   vw_sc_seguranca (security_invoker sobre seguranca_alertas(), que só devolve linhas a diretor, admin e auditor):
   usuários sem MFA em cargo que exige (com o prazo da carência), convites não aceitos há 7+ dias, trocas de cargo
   e sessões encerradas à força nos últimos 30 dias, leituras de ficha sensível acima do limite por dia, webhook
   recusado nas últimas 24 h. Sem a migration aplicada (view inexistente) o card some, sem erro na tela. */
const DASH_SEG_TIPO = {
  sem_mfa:            "Sem MFA",
  convite_pendente:   "Convite pendente",
  troca_cargo:        "Troca de cargo",
  leitura_sensivel:   "Leitura de dado sensível",
  sessoes_encerradas: "Sessões encerradas",
  webhook_recusado:   "Webhook recusado"
};
let _dashSeg = [];
async function dashCarregarSeguranca(){
  const card = $("dash-seguranca-card"), cont = $("dash-seguranca");
  if(!card || !cont) return;
  const { data, error } = await sb.from("vw_sc_seguranca").select("*");
  if(error){
    // 42P01 / PGRST205: a migration da fase 99b ainda não foi aplicada
    if(error.code === "42P01" || error.code === "PGRST205"){ card.style.display = "none"; return; }
    cont.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(error.message || "erro")}).</p>`;
    return;
  }
  _dashSeg = (data || []).sort((a, b) => (DASH_NIVEL[a.nivel]?.ordem || 9) - (DASH_NIVEL[b.nivel]?.ordem || 9) || a.ordem - b.ordem
    || String(b.quando || "").localeCompare(String(a.quando || "")));
  const porTipo = {};
  _dashSeg.forEach(a => { porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1; });
  if($("dash-seg-cont")) $("dash-seg-cont").innerHTML = Object.keys(DASH_SEG_TIPO).filter(t => porTipo[t])
    .map(t => `<span class="tag ${t === "sem_mfa" || t === "leitura_sensivel" ? "ambar" : "cinza"}">${porTipo[t]} ${esc(DASH_SEG_TIPO[t].toLowerCase())}</span>`).join(" ");
  if(!_dashSeg.length){ cont.innerHTML = `<p class="vazio">✅ Nenhum alerta de segurança.</p>`; return; }
  cont.innerHTML = _dashSeg.map((a, i) => {
    const n = DASH_NIVEL[a.nivel] || { label: a.nivel, cor: "cinza" };
    const cargo = a.cargo ? ((typeof CARGOS === "object" && CARGOS[a.cargo]) || a.cargo) : "";
    const quem = [a.nome, cargo].filter(Boolean).join(" · ");
    const clic = !!a.usuario_id && ["sem_mfa", "convite_pendente", "troca_cargo", "sessoes_encerradas"].includes(a.tipo);
    const quando = a.quando ? new Date(a.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="dash-pendencia-item${clic ? " clicavel" : ""}" data-seg="${i}"${clic ? ' title="Abrir em Usuários"' : ""}>
      <span class="tag ${n.cor}">${esc(n.label)}</span>
      <div class="dash-acao-txt"><strong>${esc(DASH_SEG_TIPO[a.tipo] || a.tipo)}</strong>${quem ? ` · ${esc(quem)}` : ""}
        <div class="meta">${esc(a.detalhe || "")}${quando ? ` · ${esc(quando)}` : ""}</div></div>
      ${clic ? '<span class="dash-pend-seta">›</span>' : ""}
    </div>`;
  }).join("");
}
async function dashAbrirSeguranca(a){
  if(!a || !a.usuario_id || !irParaSecao("usuarios") || typeof abrirUsuario !== "function") return;
  if(typeof _usuarios !== "undefined" && !_usuarios.some(u => u.id === a.usuario_id) && typeof carregarUsuarios === "function") await carregarUsuarios();
  abrirUsuario(a.usuario_id);
}

/* Uma linha de "Para regularizar" → a tela de origem, já filtrada */
async function dashAbrirRegularizar(a){
  if(!a) return;
  const ids = a.obra_ids || [];
  // onde corrigir cada pendência de obra: aba e campo da ficha
  const FICHA = { sem_responsavel: { aba: "geral", foco: "obr-responsavel" },
                  responsavel_inativo: { aba: "geral", foco: "obr-responsavel" },
                  sem_jornada:     { aba: "parametros", foco: "obr-jornada-entrada" },
                  sem_estacas:     { aba: "estacas", foco: null } };
  if(a.secao === "obras" && FICHA[a.filtro]){
    const f = FICHA[a.filtro];
    if(ids.length === 1){ await dashAbrirObra(ids[0], f.aba); obrFocarCampo(f.foco); return; }
    irParaSecao("obras");
    if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: f.aba, foco: f.foco });
  } else if(a.secao === "obras" && a.filtro === "rdo_sem_dados"){ // lote S42: RDO em branco → aba RDOs da obra
    if(a.obra_id) await dashAbrirObra(a.obra_id, "rdos");
    else { irParaSecao("obras"); if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: "rdos", foco: null }); }
  } else if(a.secao === "obras" && a.filtro === "rdo_sem_equipamento"){ // fase 94 (#77): diário sem máquina → aba RDOs da obra filtrada em "sem máquina"
    if(typeof _obrRdoFiltroMaq !== "undefined"){ _obrRdoFiltroMaq = "sem"; _obrRdoFiltroObra = a.obra_id || null; }
    if(a.obra_id) await dashAbrirObra(a.obra_id, "rdos");
    else { irParaSecao("obras"); if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: "rdos", foco: null }); }
  } else if(a.secao === "obras" && a.filtro === "estaca_por_observacao"){ // fase 94 (#75): um só → abre o RDO; vários → aba RDOs da obra
    if(a.registro_id && irParaSecao("rdo") && typeof abrirRDO === "function") abrirRDO(a.registro_id);
    else if(a.obra_id) await dashAbrirObra(a.obra_id, "rdos");
    else { irParaSecao("obras"); if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: "rdos", foco: null }); }
  } else if(a.secao === "obras"){ // estacas sem profundidade / projeto a confirmar: uma linha por obra
    if(typeof estDefinirFiltroProf === "function") estDefinirFiltroProf(a.filtro);
    if(a.obra_id) await dashAbrirObra(a.obra_id, "estacas");
  } else if(a.secao === "acessorios"){
    // o clique no menu carrega e desenha (carregarAcessorios): o filtro vai antes
    if(typeof renderAcessoriosContagem !== "function") return;
    _aceFamilia = a.filtro || ""; _aceView = "contagem"; _aceSoSemPreco = true;
    irParaSecao("acessorios");
  } else if(a.secao === "equipamentos" && /^(venda_|veiculo_sem_transferencia|bem_vendido_)/.test(a.filtro || "")){ // fase 96: uma venda abre a aba Venda; várias, a visão Vendas filtrada
    const PEND = { venda_sem_contrato: "sem_contrato", veiculo_sem_transferencia: "sem_transferencia", bem_vendido_sem_valor_aquisicao: "sem_valor_aquisicao" };
    if(a.registro_id && typeof vbAbrirVendaPorId === "function") vbAbrirVendaPorId(a.registro_id);
    else if(typeof vbAbrirPainel === "function") vbAbrirPainel({ pend: PEND[a.filtro] || "", status: a.filtro === "venda_incompleta" ? "abertas" : "" });
  } else if(a.secao === "equipamentos" && a.filtro === "leitura_parada"){ // fase 92: máquina em obra sem leitura de horímetro
    if(irParaSecao("equipamentos") && a.equipamento_id && typeof abrirEquipamento === "function") abrirEquipamento(a.equipamento_id);
  } else if(a.secao === "equipamentos"){
    if(typeof renderEquipamentos === "function") _eqpKpi = "sem_cod_ext"; // idem (carregarEquipamentos)
    if(irParaSecao("equipamentos") && a.equipamento_id && typeof abrirEquipamento === "function") abrirEquipamento(a.equipamento_id);
  } else if(a.secao === "medicoes" && /^permuta_/.test(a.filtro || "")){ // fase 98: visão Permutas filtrada; uma só abre a ficha
    if(irParaSecao("medicoes") && typeof medPmAbrirPreset === "function") medPmAbrirPreset(a.registro_id, a.filtro);
  } else if(a.secao === "medicoes" && a.filtro === "caucao_vencida"){ // fase 91: visão Caução filtrada nas vencidas
    if(irParaSecao("medicoes") && typeof medCauAbrirPreset === "function") medCauAbrirPreset("vencidas");
  } else if(a.secao === "manutencao"){ // fase 92: OS atrasadas → visão OS filtrada; uma só abre a ficha
    if(!irParaSecao("manutencao")) return;
    if(a.registro_id && typeof abrirManutencao === "function") abrirManutencao(a.registro_id);
    else if(typeof manAbrirPreset === "function") manAbrirPreset("os_atrasadas");
  } else if(a.secao === "funcionarios" && /^promocao_/.test(a.filtro || "")){ // fase 93a: visão Funções (plano de cargos) filtrada
    if(irParaSecao("funcionarios") && typeof funcAbrirPromocoes === "function") funcAbrirPromocoes(a.filtro === "promocao_vencida" ? "vencidas" : "60dias");
  } else if(a.secao === "rhh"){ // fase 93c: "Horas e alocação" › A liberar, só pendentes, nas obras do aviso
    if(typeof rhhAbrirPreset === "function") rhhAbrirPreset({ obraIds: ids, pendentes: true });
    irParaSecao("rhh");
  }
}

/* Uma linha de ação ou da fila → a tela de origem */
async function dashAbrirAcao(a){
  if(!a) return;
  const id = a.registro_id;
  switch(a.secao){
    case "obras":
      if(a.obra_id) dashAbrirObra(a.obra_id, a.setor === "contratos" ? "contrato" : /estaca/i.test(a.titulo) ? "estacas" : /marcado/i.test(a.titulo) ? "timeline" : null);
      else dashIrObrasAtivas();
      break;
    case "equipamentos":
      // fase 96: parcela de venda de bem vencida / a vencer → a venda (uma só) ou a visão Vendas filtrada
      if(a.setor === "financeiro" && /venda/i.test(a.titulo || "") && typeof vbAbrirPainel === "function"){
        if(id && typeof vbAbrirVendaPorId === "function") vbAbrirVendaPorId(id);
        else vbAbrirPainel({ status: a.nivel === "critico" ? "atrasada" : "abertas" });
        break;
      }
      if(irParaSecao("equipamentos") && a.equipamento_id && typeof abrirEquipamento === "function") abrirEquipamento(a.equipamento_id);
      break;
    case "medicoes":
      // fase 91: linhas do financeiro abrem a visão Caução ou a lista filtrada em "vencidas" (o título diz qual)
      if(/permuta/i.test(a.titulo || "") && typeof medPmAbrirPreset === "function"){ if(irParaSecao("medicoes")) medPmAbrirPreset(id, a.nivel === "atencao" ? "prazo_90_dias" : ""); }   // fase 98
      else if(/cau[çc][ãa]o/i.test(a.titulo) && typeof medCauAbrirPreset === "function"){ if(irParaSecao("medicoes")) medCauAbrirPreset(/vencid/i.test(a.titulo) ? "vencidas" : "vence30"); }
      else if(/sem recebimento/i.test(a.titulo) && !id && typeof medRecebAbrirPreset === "function"){ if(irParaSecao("medicoes")) medRecebAbrirPreset("vencida"); }
      else if(id) dashAbrirMedicao(id); else irParaSecao("medicoes");
      break;
    case "mobilizacoes":
      if(irParaSecao("mobilizacoes") && id && typeof abrirMobilizacao === "function") abrirMobilizacao(id);
      break;
    case "chamados":
      if(irParaSecao("chamados") && id && typeof abrirChamado === "function"){
        if(typeof carregarChamados === "function") await carregarChamados(true);
        abrirChamado(id);
      }
      break;
    case "contratos":
      if(a.setor === "financeiro"){ // títulos a pagar (fase 56)
        if(irParaSecao("contratos") && typeof capAtivarView === "function"){ _capFiltroVenc = a.nivel === "critico" ? "vencidos" : ""; _capIncluirExp = false; _capFiltroOrigem = ""; capAtivarView("titulos"); }
      } else if(id) dashAbrirContrato(id);
      else irParaSecao("contratos");
      break;
    case "orcamentos":
      if(id) dashAbrirOrcamento(id); else irParaSecao("orcamentos");
      break;
    case "compras":
      if(irParaSecao("compras") && /requisi/i.test(a.titulo) && typeof renderCompras === "function"){
        _cmpView = "requisicoes"; _reqFiltroSt = "pendente"; setTimeout(() => renderCompras(), 400);
      }
      break;
    case "separacoes": // fase 83: uma separação abre a ficha; o grupo abre o painel já filtrado
      if(typeof _sepPreset !== "undefined") _sepPreset = id ? "" : /vencid/i.test(a.titulo) ? "vencidas" : /sem respons/i.test(a.titulo) ? "sem_resp" : "";
      if(irParaSecao("separacoes") && id && typeof abrirSeparacao === "function") abrirSeparacao(id);
      break;
    case "fabricacao": // fase 84: uma ordem abre a ficha; o grupo abre o painel filtrado em "em produção"
      if(typeof _fabPreset !== "undefined") _fabPreset = id ? "" : "em_producao";
      if(irParaSecao("fabricacao") && id && typeof abrirOrdemFabricacao === "function") abrirOrdemFabricacao(id);
      break;
    case "manutencao": // fase 92: preventiva vencida/vencendo → visão Preventivas (uma TAG abre o plano dela)
      if(!irParaSecao("manutencao")) break;
      if(typeof manAbrirPreset === "function") manAbrirPreset(a.nivel === "critico" ? "preventivas_critico" : "preventivas_atencao", a.equipamento_id || null);
      break;
    default:
      irParaSecao(a.secao);
  }
}

/* ---------- Aba Frota ---------- */
function renderDashFrota(){
  const cont = $("dash-frota");
  if(!cont) return;
  const iv = dashIntervalo(_dashPeriodo);
  const prodPer = {};
  _dashProd.filter(p => p.data >= iv.ini && p.equipamento_id).forEach(p => {
    const o = prodPer[p.equipamento_id] || (prodPer[p.equipamento_id] = { m: 0, e: 0 });
    o.m += Number(p.metros || 0); o.e += Number(p.estacas || 0);
  });
  let lista = _dashFrota.filter(f =>
    _dashFrotaFiltro === "com" ? !!prodPer[f.equipamento_id] :
    _dashFrotaFiltro === "sem" ? !prodPer[f.equipamento_id] :
    _dashFrotaFiltro === "manut" ? f.manut_abertas > 0 : true);
  const porNome = ($("dash-frota-ordem")?.value || "atencao") === "nome";
  lista = lista.sort((a, b) => (porNome ? 0 : a.ordem_atencao - b.ordem_atencao) || String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR", { numeric: true }));
  // fase 89: logística — viagens em trânsito agora e planejadas sem caminhão ou motorista a menos de 1 dia da saída
  const amanha = dataLocalISO(new Date(Date.now() + 86400000));
  const transito = _dashViagens.filter(v => v.status === "em_transito");
  const aProgramar = _dashViagens.filter(v => v.status === "planejada" && v.data <= amanha && (!v.caminhao_id || !v.funcionario_id));
  const vgDest = v => v.destino_obra_id ? linkObra(v.destino_obra_id, v.destino_descricao || mapaObras[v.destino_obra_id] || "obra") : esc(v.destino_descricao || v.destino_tipo || "—");
  const blocoVg = (transito.length || aProgramar.length) ? `<div class="meta" style="margin:0 0 6px;"><strong>🚚 Logística:</strong> ${transito.length} viagem(ns) em trânsito agora${aProgramar.length ? ` · <span class="txt-perigo">${aProgramar.length} a programar</span> (sem caminhão ou motorista a menos de 1 dia da saída)` : ""}</div>
    <div class="tabela-rola" style="margin-bottom:12px;"><table class="dash-tabela"><thead><tr><th>Viagem</th><th>Data</th><th>Status</th><th>Caminhão</th><th>Motorista</th><th>Destino</th></tr></thead>
    <tbody>${aProgramar.concat(transito).map(v => `<tr class="linha-clicavel" data-vg="${esc(v.id)}"><td><strong>${esc(v.numero)}</strong></td><td>${dataBR(v.data)}</td><td>${tagStatus("viagem", v.status)}</td>
      <td>${v.caminhao ? esc(v.caminhao.codigo) : '<span class="txt-perigo">sem caminhão</span>'}</td><td>${v.funcionario ? esc(v.funcionario.nome) : '<span class="txt-perigo">sem motorista</span>'}</td><td>${vgDest(v)}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="meta" style="margin:0 0 8px;">🚚 Logística: nenhuma viagem em trânsito agora.</p>`;
  if(!lista.length){ cont.innerHTML = blocoVg + `<p class="vazio">Nenhuma máquina com este filtro.</p>`; return; }
  cont.innerHTML = blocoVg + `<div class="tabela-rola"><table class="dash-tabela">
    <thead><tr><th>Máquina</th><th>Situação</th><th>Obra</th><th>Último lançamento</th><th class="num" title="Intervalo mediano entre estacas: precisa de horário de perfuração nos RDOs">Ritmo</th><th class="num">Período</th><th class="num">Mês</th><th class="num">Horímetro</th><th>Manutenção</th></tr></thead>
    <tbody>${lista.map(f => {
      const s = DASH_SITUACAO[f.situacao] || { label: f.situacao, cor: "cinza" };
      const per = prodPer[f.equipamento_id];
      return `<tr class="linha-clicavel" data-eqp="${esc(f.equipamento_id)}">
        <td><strong>${esc(f.codigo || "—")}</strong> <span class="meta">${esc(f.nome || "")}</span></td>
        <td><span class="tag ${s.cor}">${esc(s.label)}</span>${f.situacao === "parada" && f.dias_sem_lancar != null ? ` <span class="meta">há ${f.dias_sem_lancar} d</span>` : ""}</td>
        <td>${f.obra_id ? linkObra(f.obra_id, f.obra_codigo || mapaObras[f.obra_id]) : '<span class="meta">—</span>'}</td>
        <td>${f.ultimo_lancamento ? `${dataBR(f.ultimo_lancamento)} <span class="meta">(${f.dias_sem_lancar} d)</span>` : '<span class="meta">nunca</span>'}</td>
        <td class="num"><span class="meta">sem horário</span></td>
        <td class="num">${per ? `${num(per.m)} m · ${per.e} est.` : '<span class="meta">—</span>'}</td>
        <td class="num">${Number(f.metros_mes) > 0 ? `${num(f.metros_mes)} m · ${f.estacas_mes} est.` : '<span class="meta">—</span>'}</td>
        <td class="num">${f.horimetro != null ? num(f.horimetro) : '<span class="meta">—</span>'}</td>
        <td>${f.manut_vencidas ? `<span class="tag vermelho">${f.manut_vencidas} vencida(s)</span> ` : ""}${f.manut_abertas ? `<span class="meta">${f.manut_abertas} aberta(s)</span>` : '<span class="meta">—</span>'}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

/* ---------- Aba Obras em execução ---------- */
function dashObrasPin(){ try { return JSON.parse(localStorage.getItem("dash-obras-pin") || "[]"); } catch(_e) { return []; } }
function dashAlternarPin(id){
  const p = new Set(dashObrasPin());
  p.has(id) ? p.delete(id) : p.add(id);
  try { localStorage.setItem("dash-obras-pin", JSON.stringify([...p])); } catch(_e) { /* sem storage: só nesta sessão não guarda */ }
  renderDashObrasAndamento();
}
async function dashCarregarObrasAndamento(){
  if(!_dashObrasAnd.length){
    const [d, mat] = await Promise.all([dashLer("vw_sc_obra_andamento", q => q.select("*"), "dash-obras-and"), dashLer("vw_sc_obra_material", q => q.select("*"))]);   // fase 83
    if(!d) return;
    _dashObrasAnd = d;
    _dashObraMat = {}; (mat || []).forEach(m => { _dashObraMat[m.obra_id] = m; });
  }
  renderDashObrasAndamento();
}
function renderDashObrasAndamento(){
  const cont = $("dash-obras-and");
  if(!cont) return;
  const iv = dashIntervalo(_dashPeriodo);
  const prodPer = {};
  _dashProd.filter(p => p.data >= iv.ini).forEach(p => { prodPer[p.obra_id] = (prodPer[p.obra_id] || 0) + Number(p.metros || 0); });
  const pins = new Set(dashObrasPin());
  const lista = [..._dashObrasAnd].sort((a, b) => (pins.has(b.obra_id) - pins.has(a.obra_id)) || ((a.dias_sem_lancamento ?? 9999) - (b.dias_sem_lancamento ?? 9999)) || String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true }));
  if(!lista.length){ cont.innerHTML = `<p class="vazio">Nenhuma obra em andamento.</p>`; return; }
  cont.innerHTML = `<div class="tabela-rola"><table class="dash-tabela">
    <thead><tr><th style="width:28px;"></th><th>Obra</th><th>Estacas exec. / prev.</th><th class="num">m/dia</th><th class="num">Produção ${esc(DASH_PERIODOS[_dashPeriodo])}</th><th>Previsão de término</th><th>Última atividade</th><th></th></tr></thead>
    <tbody>${lista.map(o => {
      const pct = Math.min(100, Number(o.percentual) || 0);
      const folga = o.folga_dias;
      return `<tr class="linha-clicavel" data-obra="${esc(o.obra_id)}">
        <td><button type="button" class="dash-pin${pins.has(o.obra_id) ? " ativo" : ""}" data-pin="${esc(o.obra_id)}" title="${pins.has(o.obra_id) ? "Desafixar" : "Fixar no topo"}">${pins.has(o.obra_id) ? "★" : "☆"}</button></td>
        <td><strong>${esc(o.codigo || "")}</strong> <span class="meta">${esc((o.nome || "").slice(0, 40))}</span></td>
        <td>${o.previstas > 0 ? `${o.executadas} / ${o.previstas} <span class="meta">(${num(pct)}%)</span><div class="dash-barra"><div style="width:${pct}%"></div></div>` : '<span class="meta">sem previstas</span>'}${o.refuradas ? ` <span class="meta">· ${o.refuradas} refurada(s)</span>` : ""}</td>
        <td class="num">${o.m_dia != null && Number(o.m_dia) > 0 ? num(o.m_dia) : '<span class="meta">—</span>'}</td>
        <td class="num">${prodPer[o.obra_id] ? `${num(prodPer[o.obra_id])} m` : '<span class="meta">—</span>'}</td>
        <td>${o.previsao_termino ? `${dataBR(o.previsao_termino)}${folga != null ? ` <span class="tag ${folga < 0 ? "vermelho" : "verde"}">${folga < 0 ? Math.abs(folga) + " d atrasada" : folga + " d de folga"}</span>` : ""}` : `<span class="meta" title="Precisa de 3 dias com RDO, ritmo maior que zero e metros faltando">sem dados</span>`}</td>
        <td>${o.ultimo_rdo ? dataBR(o.ultimo_rdo) : '<span class="meta">sem RDO</span>'}${o.dias_sem_lancamento != null ? ` <span class="meta">(${o.dias_sem_lancamento} d)</span>` : ""}</td>
        <td>${o.parada ? '<span class="tag ambar">parada</span> ' : ""}${o.pronta_baixa ? '<span class="tag verde">pronta p/ baixa</span> ' : ""}${o.sem_previstas ? '<span class="tag cinza">sem previstas</span> ' : ""}${_dashObraMat[o.obra_id] ? `<span class="tag ambar" title="separações abertas no almoxarifado (fase 83)">material pedido (${_dashObraMat[o.obra_id].itens_pendentes})</span>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

/* ---------- Aba Operadores (ranking do período, a partir de vw_sc_producao_dia) ---------- */
let _dashOperNomes = {};
async function renderDashOperadores(){
  const cont = $("dash-operadores");
  if(!cont) return;
  const iv = dashIntervalo(_dashPeriodo);
  const por = {};
  _dashProd.filter(p => p.data >= iv.ini && p.operador_id).forEach(p => {
    const o = por[p.operador_id] || (por[p.operador_id] = { m: 0, e: 0, dias: new Set(), maq: {} });
    o.m += Number(p.metros || 0); o.e += Number(p.estacas || 0); o.dias.add(p.data);
    if(p.equipamento_id) o.maq[p.equipamento_id] = (o.maq[p.equipamento_id] || 0) + Number(p.metros || 0);
  });
  const ids = Object.keys(por);
  if(!ids.length){ cont.innerHTML = `<p class="vazio">Nenhuma execução com operador ${esc(DASH_PERIODOS[_dashPeriodo])}.</p>`; return; }
  const faltam = ids.filter(id => !_dashOperNomes[id]);
  if(faltam.length){
    const { data } = await sb.from("funcionarios").select("id,nome").in("id", faltam);
    (data || []).forEach(f => { _dashOperNomes[f.id] = f.nome; });
  }
  const codEq = Object.fromEntries(_dashFrota.map(f => [f.equipamento_id, f.codigo]));
  const linhas = ids.map(id => {
    const o = por[id];
    const maq = Object.entries(o.maq).sort((a, b) => b[1] - a[1])[0];
    return { id, nome: _dashOperNomes[id] || "—", m: o.m, e: o.e, dias: o.dias.size, maq: maq ? (codEq[maq[0]] || "—") : "—" };
  }).sort((a, b) => b.m - a.m);
  cont.innerHTML = `<div class="tabela-rola"><table class="dash-tabela">
    <thead><tr><th>#</th><th>Operador</th><th class="num">Metros</th><th class="num">Estacas</th><th class="num">Dias</th><th class="num">m/dia</th><th>Máquina</th></tr></thead>
    <tbody>${linhas.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.nome)}</td><td class="num">${num(l.m)}</td><td class="num">${l.e}</td><td class="num">${l.dias}</td><td class="num">${num(l.dias ? l.m / l.dias : 0)}</td><td>${esc(l.maq)}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

/* ---------- Listeners do Início (uma vez, por delegação) ---------- */
function ligarSalaDeComando(){
  const sec = $("sec-inicio");
  if(!sec || sec.dataset.ligado) return;
  sec.dataset.ligado = "1";
  $("dash-periodo")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-periodo]");
    if(!b || b.dataset.periodo === _dashPeriodo) return;
    _dashPeriodo = b.dataset.periodo;
    try { localStorage.setItem("dash-periodo", _dashPeriodo); } catch(_e) { /* ok */ }
    carregarDashboard();
  });
  $("btn-dash-recarregar")?.addEventListener("click", () => comBotaoTravado("btn-dash-recarregar", () => { _dashObrasAnd = []; return carregarDashboard(); }));
  $("dash-acoes")?.addEventListener("click", (e) => { const el = e.target.closest("[data-acao]"); if(el) dashAbrirAcao(_dashAcoes[Number(el.dataset.acao)]); });
  $("dash-fila")?.addEventListener("click", (e) => { const el = e.target.closest("[data-fila]"); if(el) dashAbrirAcao(_dashFila[Number(el.dataset.fila)]); });
  $("dash-regularizar")?.addEventListener("click", (e) => { const el = e.target.closest("[data-reg]"); if(el) dashAbrirRegularizar(_dashReg[Number(el.dataset.reg)]); });
  $("dash-seguranca")?.addEventListener("click", (e) => { const el = e.target.closest(".clicavel[data-seg]"); if(el) dashAbrirSeguranca(_dashSeg[Number(el.dataset.seg)]); });   // fase 99b
  $("dash-notebook")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if(!b) return;
    document.querySelectorAll("#dash-notebook button").forEach(x => x.classList.toggle("ativo", x === b));
    document.querySelectorAll("#sec-inicio .dash-abas > .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === b.dataset.tab));
  });
  $("dash-frota-filtros")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-filtro]");
    if(!b) return;
    _dashFrotaFiltro = b.dataset.filtro;
    document.querySelectorAll("#dash-frota-filtros [data-filtro]").forEach(x => x.classList.toggle("ativo", x === b));
    renderDashFrota();
  });
  $("dash-frota-ordem")?.addEventListener("change", renderDashFrota);
  $("dash-frota")?.addEventListener("click", (e) => {
    if(e.target.closest("a.link-obra")) return; // o link da obra tem handler global
    const tv = e.target.closest("tr[data-vg]");   // fase 89: viagem abre a ficha em Logística
    if(tv){ if(irParaSecao("frota") && typeof abrirViagem === "function") abrirViagem(tv.dataset.vg, null); return; }
    const tr = e.target.closest("tr[data-eqp]");
    if(tr && irParaSecao("equipamentos") && typeof abrirEquipamento === "function") abrirEquipamento(tr.dataset.eqp);
  });
  $("dash-obras-and")?.addEventListener("click", (e) => {
    const pin = e.target.closest("[data-pin]");
    if(pin){ e.stopPropagation(); dashAlternarPin(pin.dataset.pin); return; }
    const tr = e.target.closest("tr[data-obra]");
    if(tr) dashAbrirObra(tr.dataset.obra);
  });
  sec.addEventListener("click", (e) => {
    // fase 96: as duas linhas do KPI "A receber"
    const r = e.target.closest("[data-dash-receber]");
    if(r){
      e.preventDefault();
      if(r.dataset.dashReceber === "vendas"){ if(typeof vbAbrirPainel === "function") vbAbrirPainel({ status: "abertas" }); }
      else if(irParaSecao("medicoes") && typeof medRecebAbrirPreset === "function") medRecebAbrirPreset("a_receber");
      return;
    }
    const b = e.target.closest(".dash-origem");
    if(!b) return;
    const o = b.dataset.origem;
    if(o === "frota"){ document.querySelector('#dash-notebook button[data-tab="frota"]')?.click(); $("dash-notebook")?.scrollIntoView({ behavior: "smooth" }); }
    else if(o === "obras") dashIrObrasAtivas();
    else irParaSecao(o);
  });
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarSalaDeComando);
else ligarSalaDeComando();

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
  if(typeof _obrFiltroIds !== "undefined") _obrFiltroIds = null; // sai do filtro do "Para regularizar"
  irParaSecao("obras");
  const f = $("obr-f-status");
  if(f){ f.value = "em_andamento"; if(typeof renderObras === "function") renderObras(); }
}
function dashIrOrcamentos(){ irParaSecao("orcamentos"); }
// Só o cargo diretor vê valores consolidados (contratado, medido, a medir, valor por obra); fase 79: e o auditor (só leitura)
function dashEhDiretoria(){
  return !!(usuarioAtual && ["diretor", "auditor"].includes(usuarioAtual.cargo));
}

function dashIrFinanceiro(){
  // diretoria vê a Carteira; demais vão para Medições
  if(dashEhDiretoria()) irParaSecao("carteira");
  else irParaSecao("medicoes");
}

function ligarCliquesDashboard(){
  const liga = (id, fn, dica) => {
    const el = $(id); const card = el ? el.closest(".dash-card, .card") : null;
    if(card && !card.dataset.clicavel){
      card.dataset.clicavel = "1";
      card.classList.add("clicavel");
      if(dica) card.title = dica;
      card.addEventListener("click", fn);
    }
  };
  liga("dash-orc-abertos",  dashIrOrcamentos,  "Ver orçamentos abertos");
  liga("dash-contratado",   dashIrFinanceiro,  "Ver medições / carteira");
  liga("dash-medido",       dashIrFinanceiro,  "Ver medições / carteira");
  liga("dash-a-medir",      dashIrFinanceiro,  "Ver medições / carteira");
}

/* ============================================================
   KPIs FINANCEIROS — contratado / medido / a medir / %
   ============================================================ */
async function carregarDashFinanceiro(){
  // Contratado: soma do valor das obras ativas. Fase 90: o valor vive em obras_financeiro (RLS: só quem lê
  // financeiro; este bloco já é da diretoria), embutido 1:1 na obra.
  const [{ data: obrasAtivas }, { data: medsAprovadas }] = await Promise.all([
    sb.from("obras").select("id,financeiro:obras_financeiro(valor_contratado)").in("status", ["em_andamento","planejada","paralisada"]),
    sb.from("medicoes").select("valor_final,valor_medido").in("status",["aprovada","faturada","recebida"])   // fase 91
  ]);

  const contratado = (obrasAtivas||[]).reduce((s,o) => s + (Number(o.financeiro?.valor_contratado)||0), 0);   // obras_financeiro
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
   ORÇAMENTOS ABERTOS (fim da página; só diretoria e comercial, fase 49)
   ============================================================ */
async function carregarDashOrcamentos(){
  const card = $("dash-card-orc");
  if(card) card.style.display = podeVerComercial() ? "" : "none";
  if(!podeVerComercial()) return;
  const [{ count: cntOrcAbertos }, { data: orcAbertos }] = await Promise.all([
    sb.from("orcamentos").select("id",{count:"exact",head:true}).in("status",["rascunho","enviado","em_negociacao"]),
    sb.from("orcamentos").select("valor_total").in("status",["rascunho","enviado","em_negociacao"])
  ]);
  const n = $("dash-orc-abertos");
  if(n){ n.textContent = cntOrcAbertos || 0; n.classList.toggle("dash-num-vazio", !(cntOrcAbertos > 0)); }
  const valorOrcAbertos = (orcAbertos||[]).reduce((s,o) => s + (Number(o.valor_total)||0), 0);
  // Chamado 1 (14/09/2026): cargo financeiro não vê valores agregados no painel — só a contagem
  const semValores = !!(usuarioAtual && usuarioAtual.cargo === "financeiro");
  if($("dash-orc-sub")) $("dash-orc-sub").textContent = semValores ? `${cntOrcAbertos || 0} em negociação` : `${brl(valorOrcAbertos)} em pipeline`;
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
    cont.innerHTML = `<p class="vazio" style="font-size:var(--txt-sm);">Sem RDOs nos últimos 30 dias.</p>`;
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
    <div style="font-size:var(--txt-xs);color:var(--txt-fraco);margin-bottom:6px;">${num(total)} m totais em ${dias.length} dia(s)</div>
    <div style="display:flex;align-items:flex-end;height:82px;overflow-x:auto;">${barras}</div>`;
}

/* ============================================================
   TOP 5 OBRAS (por valor contratado)
   ============================================================ */
async function carregarDashTopObras(){
  const cont = $("dash-top-obras");
  if(!cont) return;
  const mostraValor = dashEhDiretoria();
  const tit = $("dash-top-obras-titulo");
  if(tit) tit.textContent = mostraValor ? "📈 Top 5 obras (valor)" : "📈 Obras ativas";
  // Fase 90: o valor vive em obras_financeiro (RLS: só quem lê financeiro). Diretoria: as 5 maiores pelo valor (111
  // linhas, ordenadas aqui); os demais cargos não leem valor e veem as 5 obras ativas mais recentes, sem ranking.
  const ATIVAS = ["em_andamento","planejada","paralisada"];
  let data;
  if(mostraValor){
    const r = await sb.from("obras_financeiro").select("valor_contratado,obra:obras(id,codigo,nome,status)");
    data = (r.data||[]).filter(f => f.obra && ATIVAS.includes(f.obra.status)).map(f => ({ ...f.obra, valor: Number(f.valor_contratado)||0 }))   // linha de obras_financeiro + obra embutida
      .sort((a,b) => b.valor - a.valor).slice(0, 5);
  } else {
    const r = await sb.from("obras").select("id,codigo,nome,status").in("status", ATIVAS).order("codigo",{ascending:false}).limit(5);
    data = r.data;
  }
  if(!data || !data.length){
    cont.innerHTML = `<p class="vazio" style="font-size:var(--txt-sm);">Nenhuma obra ativa.</p>`;
    return;
  }
  cont.innerHTML = `<div style="font-size:var(--txt-sm);">${data.map((o,i) => `
    <div class="dash-linha-obra clicavel" data-obra-id="${esc(o.id)}" title="Abrir a obra" style="display:flex;justify-content:space-between;align-items:center;padding:6px 4px;border-bottom:1px solid var(--sup-3);">
      <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <strong>${i+1}.</strong> ${esc(o.codigo)} <span style="color:var(--txt-sutil);">·</span> ${esc((o.nome||"").slice(0,30))}${(o.nome||"").length>30?"…":""}
      </div>
      ${mostraValor ? `<strong style="color:var(--sucesso);">${brl(o.valor)}</strong>` : ""}
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
    cont.innerHTML = `<p class="vazio" style="font-size:var(--txt-sm);">Nenhuma atividade nas últimas 48h.</p>`;
    return;
  }
  const vis = eventos.slice(0,8);
  cont.innerHTML = `<div style="font-size:var(--txt-sm);">${vis.map((e, idx) => {
    const dt = new Date(e.quando);
    const hora = dt.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
    const cls   = e.obraId ? ' class="dash-ativ-item clicavel"' : "";
    const extra = e.obraId ? `cursor:pointer;` : "";
    const attrs = e.obraId ? ` data-idx="${idx}" title="Abrir a obra"` : "";
    return `<div${cls}${attrs} style="padding:6px 4px;border-bottom:1px solid var(--sup-3);${extra}">
      <span style="color:var(--txt-sutil);font-size:var(--txt-xs);">${hora}</span> · ${e.txt}
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

/* ============================================================
   FASE 41 — consumo das leituras por IA no mês (ia_chamadas)
   Só diretoria (RLS: is_admin). Custo estimado em US$ pela tabela
   de preços do modelo, gravado pelas Edge Functions.
   ============================================================ */
async function carregarDashIA(){
  const elNum = $("dash-ia-custo"), elSub = $("dash-ia-sub");
  if(!elNum || !elSub) return;
  const hoje = new Date();
  const inicioMes = dataLocalISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const { data, error } = await sb.from("ia_chamadas")
    .select("funcao,status,tokens_input,tokens_output,custo_usd")
    .gte("created_at", inicioMes + "T00:00:00");
  if(error){ elNum.textContent = "US$ —"; elSub.textContent = "sem acesso ao registro"; return; }
  const linhas = data || [];
  const custo  = linhas.reduce((s, l) => s + Number(l.custo_usd || 0), 0);
  const ok     = linhas.filter(l => l.status === "ok").length;
  const erros  = linhas.length - ok;
  const rdo    = linhas.filter(l => l.funcao === "extrair-rdo-arquivo" && l.status === "ok").length;
  const est    = linhas.filter(l => l.funcao === "extrair-estacas-pdf" && l.status === "ok").length;
  const tokens = linhas.reduce((s, l) => s + Number(l.tokens_input || 0) + Number(l.tokens_output || 0), 0);
  elNum.textContent = "US$ " + custo.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  elNum.classList.toggle("dash-num-vazio", !(linhas.length > 0));
  elSub.textContent = linhas.length
    ? `${ok} leitura(s): ${rdo} RDO · ${est} plantas${erros ? ` · ${erros} erro(s)` : ""} · ${num(Math.round(tokens / 1000))} mil tokens`
    : "nenhuma leitura este mês";
}

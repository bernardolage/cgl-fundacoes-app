








const DASH_PERIODOS = { hoje: "hoje", "7d": "nos últimos 7 dias", mes: "no mês", mes_ant: "no mês anterior" };
let _dashPeriodo = "mes";
try { const p = localStorage.getItem("dash-periodo"); if(DASH_PERIODOS[p]) _dashPeriodo = p; } catch(_e) {   }
let _dashProd = [];
let _dashFrota = [];
let _dashViagens = [];
let _dashObrasAnd = [];
let _dashAcoes = [];
let _dashFila = [];
let _dashMencoes = [];
let _dashReg = [];
let _dashObraMat = {};
let _dashRitmo = {};
let _dashFrotaFiltro = "todas";
let _dashCargaN = 0;
const DASH_NIVEL = {
  critico:      { label: "Crítico",      cor: "vermelho", ordem: 1 },
  atencao:      { label: "Atenção",      cor: "ambar",    ordem: 2 },
  observar:     { label: "Observar",     cor: "azul",     ordem: 3 },
  conformidade: { label: "Conformidade", cor: "cinza",    ordem: 4 }
};
const DASH_SETOR = { obras: "Obras", frota: "Frota", financeiro: "Financeiro", compras: "Compras",
  mobilizacao: "Mobilização", chamados: "Chamados", contratos: "Contratos e propostas", almoxarifado: "Almoxarifado", oficina: "Oficina", manutencao: "Manutenção",
  rh: "RH",
  sesmt: "SESMT",
  logistica: "Logística",
  geodigitus: "Geodigitus",
  campo: "Campo",
  mobilizacoes: "Mobilizações",
  comercial: "Comercial" };



const DASH_SETOR_GESTORES = {
  obras:       ["engenheiro", "assistente_engenharia", "encarregado"],
  frota:       ["mecanico", "logistica", "gestor_acessorios", "gestor_manutencao", "gestor_frota"],
  financeiro:  ["financeiro"],
  compras:     ["comprador", "almoxarife"],
  mobilizacao: ["logistica", "engenheiro"],
  chamados:    [],
  contratos:   ["comercial"],
  almoxarifado: ["almoxarife", "logistica", "comprador", "gestor_acessorios", "gestor_manutencao", "auxiliar_almoxarifado"],
  oficina:     ["mecanico", "gestor_acessorios", "gestor_manutencao", "logistica", "almoxarife", "engenheiro"],
  manutencao:  ["gestor_manutencao", "mecanico", "engenheiro", "gestor_frota", "logistica"],
  rh:          ["rh"],
  sesmt:       ["sesmt", "almoxarife", "rh"]
};
function dashGereSetor(setor){
  const cargo = usuarioAtual?.cargo;
  if(["diretor", "admin", "auditor"].includes(cargo)) return true;
  return (DASH_SETOR_GESTORES[setor] || []).includes(cargo);
}



function dashSoAlmoxarifado(){ return !!usuarioAtual && usuarioAtual.cargo === "auxiliar_almoxarifado"; }
const DASH_SITUACAO = {
  produzindo:   { label: "Produzindo hoje",      cor: "verde" },
  parada:       { label: "Parada",               cor: "ambar" },
  sem_producao: { label: "Sem produção (30 d)",  cor: "vermelho" },
  sem_obra:     { label: "Sem obra",             cor: "cinza" }
};


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


async function dashLer(fonte, ajustar, alvo){
  const q = typeof ajustar === "function" ? ajustar(sb.from(fonte)) : sb.from(fonte).select("*");
  const { data, error } = await q;
  if(error){
    console.error("Início:", fonte, error);
    const el = alvo ? $(alvo) : null;
    if(el) el.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(error.message || "erro")}).</p>`;
    return null;
  }
  if(alvo) dashCarimbo(alvo);
  return data || [];
}

const dashHoraAgora = () => "atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
function dashCarimbo(alvo){
  const el = $(alvo);
  const topo = el?.parentElement?.querySelector(":scope > .dash-bloco-topo");
  if(!topo || el.textContent.includes("Não foi possível carregar")) return;
  let c = topo.querySelector(".dmh-retrato");
  if(!c){ c = document.createElement("span"); c.className = "dmh-retrato"; topo.appendChild(c); }
  c.textContent = dashHoraAgora();
}



const dashPodeVerMedido = () => podeVerKpiFinanceiro(() => dashEhDiretoria() || (typeof podeVerContasPagar === "function" && podeVerContasPagar()));

const dashPodeVerReceber = () => podeVerKpiFinanceiro(() => !!usuarioAtual && ["diretor", "financeiro", "auditor"].includes(usuarioAtual.cargo));

const dashPodeVerSeguranca = () => !!usuarioAtual && ["diretor", "admin", "auditor"].includes(usuarioAtual.cargo);

const dashPodeVerEpi = () => typeof podeVerEpi === "function" && podeVerEpi();


const dashPodeVerSst = () => typeof ssoPodeLerOcorrencias === "function" && ssoPodeLerOcorrencias();

async function carregarDashboard(){
  const carga = ++_dashCargaN;

  const nome = (typeof usuarioAtual !== "undefined" && usuarioAtual?.nome) ? usuarioAtual.nome.split(" ")[0] : "";
  if($("dash-saudacao")) $("dash-saudacao").textContent = nome ? `👋 Olá, ${nome} · Sala de Comando` : "👋 Sala de Comando";
  if($("dash-data-hoje")) $("dash-data-hoje").textContent = new Date().toLocaleDateString("pt-BR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
  document.querySelectorAll("#dash-periodo [data-periodo]").forEach(b => b.classList.toggle("ativo", b.dataset.periodo === _dashPeriodo));
  if($("dash-card-medido")) $("dash-card-medido").style.display = dashPodeVerMedido() ? "" : "none";
  if($("dash-card-custo"))  $("dash-card-custo").style.display  = dashEhDiretoria() ? "" : "none";
  if($("dash-card-receber")) $("dash-card-receber").style.display = dashPodeVerReceber() ? "" : "none";
  if($("dash-seguranca-card")) $("dash-seguranca-card").style.display = dashPodeVerSeguranca() ? "" : "none";
  if($("dash-epi-card")) $("dash-epi-card").style.display = dashPodeVerEpi() ? "" : "none";
  if($("dash-sst-card")) $("dash-sst-card").style.display = dashPodeVerSst() ? "" : "none";
  const finEl = $("dash-financeiro");
  if(finEl) finEl.style.display = dashEhDiretoria() ? "" : "none";

  const soAlmox = dashSoAlmoxarifado();
  [$("dash-faixa"), $("dash-periodo"), $("dash-regularizar")?.closest(".card"), document.querySelector("#sec-inicio .dash-abas"), $("dash-card-orc")?.closest(".dash-duas-col")]
    .forEach(el => { if(el) el.style.display = soAlmox ? "none" : ""; });


  const t0 = performance.now();
  await Promise.all([soAlmox ? null : carregarDashFaixa(carga), dashCarregarAcoes(), dashCarregarFila(), soAlmox ? null : dashCarregarRegularizar()]);
  if(carga !== _dashCargaN) return;
  console.info(`Início: 1ª onda em ${Math.round(performance.now() - t0)} ms`);
  if($("dash-atualizado")) $("dash-atualizado").textContent = dashHoraAgora();
  if(soAlmox){ ligarCliquesDashboard(); return; }


  await Promise.all([
    dmhCarregar(),
    dashCarregarRitmo(),
    dashCarregarObrasAndamento(),
    carregarDashGraficoProducao(),
    carregarDashTopObras(),
    carregarDashAtividade(),
    carregarDashOrcamentos(),
    dashPodeVerSeguranca() ? dashCarregarSeguranca() : Promise.resolve(),
    dashPodeVerEpi() ? dashCarregarEpi() : Promise.resolve(),
    dashPodeVerSst() ? dashCarregarSst() : Promise.resolve(),
    (typeof geoPodeVerCard === "function" && geoPodeVerCard()) ? geoCarregarCardSala() : Promise.resolve(),
    dashEhDiretoria() ? carregarDashFinanceiro() : Promise.resolve(),
    dashEhDiretoria() ? carregarDashIA() : Promise.resolve()
  ]);
  if(carga !== _dashCargaN) return;
  ["dash-seguranca", "dash-epi", "dash-sst", "dash-geo"].forEach(dashCarimbo);
  renderDashFrota();
  await renderDashOperadores();




  ligarCliquesDashboard();
}


async function carregarDashFaixa(carga){
  const iv = dashIntervalo(_dashPeriodo);
  const verReceber = dashPodeVerReceber();

  const retCols = verReceber && typeof fiscalColunaExiste === "function" && await fiscalColunaExiste("medicoes", "ret_irrf")
    ? ",ret_irrf,ret_pis,ret_cofins,ret_csll,ret_inss" : "";
  const [prod, frota, obras, rdos, meds, custos, viagens, recMed, recVendas] = await Promise.all([
    dashLer("vw_sc_producao_dia", q => q.select("obra_id,equipamento_id,data,estacas,metros,operador_id").gte("data", iv.antIni).lte("data", iv.fim), "dash-k-producao-sub"),
    dashLer("vw_sc_frota", q => q.select("*"), "dash-frota-lista"),
    dashLer("vw_sc_obra_andamento", q => q.select("*"), "dash-k-obras-sub"),
    dashLer("rdo", q => q.select("obra_id").gte("data", iv.ini).lte("data", iv.fim), "dash-k-obras-sub"),
    dashPodeVerMedido() ? dashLer("medicoes", q => q.select("valor_final,valor_medido").in("status", ["aprovada","faturada","recebida"]).eq("em_revisao", false).gte("data_medicao", iv.ini).lte("data_medicao", iv.fim), "dash-k-medido-sub") : Promise.resolve([]),
    dashEhDiretoria() ? dashLer("vw_custos", q => q.select("valor").gte("data", iv.ini).lte("data", iv.fim), "dash-k-custo-sub") : Promise.resolve([]),

    dashLer("viagens", q => q.select("id,numero,data,status,finalidade,caminhao_id,funcionario_id,destino_tipo,destino_obra_id,destino_descricao,data_saida,caminhao:equipamentos!caminhao_id(codigo),funcionario:funcionarios(nome)").in("status", ["planejada", "em_transito"]).order("data")),

    verReceber ? dashLer("medicoes", q => q.select("valor_final,valor_medido,retencao_valor,iss_valor,iss_retido_fonte,recebido_valor,nf_numero,nf_vencimento,status" + retCols).in("status", ["aprovada", "faturada"]).not("nf_numero", "is", null), "dash-k-receber-sub") : Promise.resolve(null),
    verReceber && typeof vbResumoAReceber === "function" ? vbResumoAReceber() : Promise.resolve(null)
  ]);
  if(carga !== _dashCargaN) return;
  _dashProd = prod || []; _dashFrota = frota || []; _dashObrasAnd = obras || []; _dashViagens = viagens || [];
  if(frota && $("dash-frota-carimbo")) $("dash-frota-carimbo").textContent = dashHoraAgora();
  if(obras && $("dash-obras-carimbo")) $("dash-obras-carimbo").textContent = dashHoraAgora();
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
        : `<a href="#" data-dash-receber="vendas" title="Equipamentos › Vendas em aberto">Vendas de bens ${brl(vb.total)}</a> · ${esc(vb.n)} venda(s)${vb.vencido > 0.009 ? ` <span class="txt-perigo">(${brl(vb.vencido)} vencido)</span>` : ""}`);
  }
}


async function dashCarregarAcoes(){
  const cont = $("dash-acoes");
  if(!cont) return;










  const [dados, sep, fab, fin, man, ass, cmp, cliFis, psi] = await Promise.all([dashLer("vw_sc_acoes", q => q.select("*"), "dash-acoes"), dashLer("vw_sc_acoes_sep", q => q.select("*")), dashLer("vw_sc_acoes_fab", q => q.select("*")), dashLer("vw_sc_acoes_fin", q => q.select("*")), dashLer("vw_sc_acoes_man", q => q.select("*")),
    dashLer("vw_pedidos_aprovacao_pendente", q => q.select("pedido_id,numero,total,quem_assina,criado_em").eq("dono_meu", true).order("criado_em")),
    dashLer("vw_sc_acoes_cmp", q => q.select("*")),
    dashLer("vw_pendencias_cliente_fiscal", q => q.select("*").eq("tipo", "cliente").order("cliente_nome")),
    dashLer("vw_sc_acoes_psi", q => q.select("*"))]);
  if(!dados) return;

  dashMarcarFonte(dados, "acoes"); dashMarcarFonte(cmp, "acoes"); dashMarcarFonte(psi, "acoes");dashMarcarFonte(sep, "sep"); dashMarcarFonte(fab, "fab"); dashMarcarFonte(fin, "fin"); dashMarcarFonte(man, "man");
  const cliNfe = dashMarcarFonte(dashAcoesClienteFiscal(cliFis || []), "fin");
  _dashAcoes = dados.concat(cmp || [], psi || [], sep || [], fab || [], fin || [], cliNfe, man || []).filter(a => dashGereSetor(a.setor))
    .concat(dashAcoesAssinatura(ass || []))
    .sort((a, b) => (DASH_NIVEL[a.nivel]?.ordem || 9) - (DASH_NIVEL[b.nivel]?.ordem || 9) || a.ordem - b.ordem);
  const porNivel = {};
  _dashAcoes.forEach(a => { porNivel[a.nivel] = (porNivel[a.nivel] || 0) + 1; });
  if($("dash-acoes-cont")) $("dash-acoes-cont").innerHTML = _dashAcoes.length
    ? Object.entries(DASH_NIVEL).filter(([k]) => porNivel[k]).map(([k, o]) => `<span class="tag ${esc(o.cor)}">${esc(porNivel[k])} ${esc(o.label.toLowerCase())}</span>`).join(" ")
    : "";
  if(!_dashAcoes.length){ cont.innerHTML = `<p class="vazio">Nada exigindo ação nos setores que você acompanha.</p>`; return; }

  const setores = [];
  _dashAcoes.forEach(a => { if(!setores.includes(a.setor)) setores.push(a.setor); });
  cont.innerHTML = setores.map(s => `<div class="dash-setor">
      <div class="dash-setor-tit">${esc(DASH_SETOR[s] || s)}</div>
      ${_dashAcoes.map((a, i) => a.setor !== s ? "" : dashLinhaAcao(a, i, "acao")).join("")}
    </div>`).join("");
}



function dashAcoesClienteFiscal(linhas){
  return (linhas || []).map(l => ({
    setor: "financeiro", nivel: "atencao", ordem: 42, quantidade: 1, secao: "clientes", registro_id: l.cliente_id,
    obra_id: l.obra_id || null, _cliFiscal: true,
    titulo: `Cliente sem cadastro fiscal com remessa a caminho: ${l.cliente_nome || "?"}`,
    detalhe: [`falta ${(l.falta || []).join(", ")}`, l.obra_codigo ? `obra ${l.obra_codigo}` : "", (l.motivos || []).join(", ")].filter(Boolean).join(" · ")
  }));
}


function dashRegObraEndereco(linhas){
  const porPapel = {};
  (linhas || []).forEach(l => { (porPapel[l.papel] = porPapel[l.papel] || []).push(l); });
  return Object.entries(porPapel).map(([papel, ls]) => ({
    setor: "obras", secao: "obras", filtro: "obra_endereco_remessa", papel, ordem: 115, quantidade: ls.length,
    titulo: "Endereço da obra incompleto com remessa a caminho",
    detalhe: ls.map(l => `${l.obra_codigo || "?"} (falta ${(l.falta || []).join(", ")})`).join(" · "),
    obra_ids: ls.map(l => l.obra_id), obra_id: ls.length === 1 ? ls[0].obra_id : null
  }));
}



function dashAcoesAssinatura(linhas){
  const porPedido = {};
  linhas.forEach(l => { (porPedido[l.pedido_id] = porPedido[l.pedido_id] || []).push(l); });
  return Object.values(porPedido).map((ls, k) => {
    const l = ls[0], dias = Math.floor((Date.now() - new Date(l.criado_em).getTime()) / 86400000);
    return { setor: "compras", nivel: "atencao", ordem: k, quantidade: 1, secao: "compras", registro_id: l.pedido_id, _assinar: true, _fonte: "assinar",
      titulo: "Compra aguardando a sua assinatura",
      detalhe: [l.numero, brl(l.total), ls.map(x => x.quem_assina).join("; "), dias >= 1 ? `há ${dias} d` : ""].filter(Boolean).join(" · ") };
  });
}
function dashLinhaAcao(a, i, tipo){
  const n = DASH_NIVEL[a.nivel] || { label: a.nivel, cor: "cinza" };
  const chave = dashExplicaDaLinha(a, tipo === "fila" ? "fila" : "acoes");
  return `<div class="dash-pendencia-item clicavel" data-${esc(tipo)}="${i}"${chave ? ` data-explica="${esc(chave)}"` : ""} title="Abrir">
      <span class="tag ${esc(n.cor)}">${esc(n.label)}</span>
      <div class="dash-acao-txt"><strong>${esc(dashTituloAcao(a.titulo))}</strong>${a.quantidade > 1 ? ` <span class="contador">(${esc(a.quantidade)})</span>` : ""}
        ${a.detalhe ? `<div class="meta" title="${esc(a.detalhe)}">${esc(a.detalhe)}</div>` : ""}</div>
      ${  dashBotaoExplica(chave)}<span class="dash-pend-seta">›</span>
    </div>`;
}



function dashMarcarFonte(lista, fonte){ (lista || []).forEach(a => { if(a) a._fonte = fonte; }); return lista; }
const _dashExplicaAvisadas = new Set();
function dashExplicaDaLinha(a, bloco){
  const chave = typeof dashExplicaChave === "function" ? dashExplicaChave(a, bloco) : null;
  if(!chave && a){

    const id = bloco === "regularizar" ? `regularizar:${a.filtro}` : `${a._fonte}:${a.ordem}:${a.nivel}`;
    if(!_dashExplicaAvisadas.has(id)){ _dashExplicaAvisadas.add(id); console.warn("Sala de Comando: pendência sem texto de explicação:", id); }
  }
  return chave;
}
function dashBotaoExplica(chave){
  return chave ? `<button type="button" class="dash-ajuda" data-explica-btn aria-expanded="false" aria-label="O que é este número" title="O que é este número">?</button>` : "";
}
let _dashExplicaSeq = 0;


function dashAlternarExplica(btn, ancora, escopo, html){
  if(!btn || !ancora || !escopo) return;
  const aberto = btn.getAttribute("aria-expanded") === "true";
  escopo.querySelectorAll(".dash-explica").forEach(p => p.remove());
  escopo.querySelectorAll('.dash-ajuda[aria-expanded="true"]').forEach(b => { b.setAttribute("aria-expanded", "false"); b.removeAttribute("aria-controls"); });
  if(aberto || !html) return;
  const p = document.createElement("div");
  p.className = "dash-explica";
  p.id = "dash-explica-" + (++_dashExplicaSeq);
  p.setAttribute("role", "region");
  p.setAttribute("aria-label", "O que é este número");
  p.innerHTML = html;
  ancora.insertAdjacentElement("afterend", p);
  btn.setAttribute("aria-expanded", "true");
  btn.setAttribute("aria-controls", p.id);
}

function dashCliqueExplica(e, escopo){
  const btn = e.target.closest("[data-explica-btn]");
  if(!btn) return !!e.target.closest(".dash-explica");
  e.stopPropagation();
  const linha = btn.closest("[data-explica]");
  if(linha) dashAlternarExplica(btn, linha, escopo, dashExplicaHTML(linha.dataset.explica));
  return true;
}

const DASH_TIPO_CONTRATO = { "composicao divergente": "composição divergente", "quadro parcial": "quadro de orçamento lido em parte",
  "aditivo sem valor": "aditivo sem valor", "valor provisorio": "valor provisório", "sem assinatura": "sem assinatura",
  "saldo negativo": "saldo negativo (precisa aditivo)", "aditivo pendente": "aditivo pendente",
  "medicao producao pendente": "medição de produção pendente" };
function dashTituloAcao(t){
  const m = String(t || "").match(/^Contrato: (.+)$/);
  return m ? "Contrato: " + (DASH_TIPO_CONTRATO[m[1]] || m[1]) : t;
}


async function dashCarregarFila(){
  const cont = $("dash-fila");
  if(!cont) return;






  const lerMdl = typeof ehJuridico === "function" && usuarioAtual && (usuarioAtual.cargo === "diretor" || ehJuridico());
  const lerPrc = usuarioAtual && ["diretor", "juridico"].includes(usuarioAtual.cargo);
  const [dados, sep, menc, custo, sst, ret, mdl, prc] = await Promise.all([dashLer("vw_sc_minha_fila", q => q.select("*"), "dash-fila"), dashLer("vw_sc_minha_fila_sep", q => q.select("*")), dashLer("vw_sc_minha_fila_mencoes", q => q.select("*")), dashLer("vw_sc_minha_fila_custo", q => q.select("*")), dashLer("vw_sc_minha_fila_sst", q => q.select("*")), dashLer("vw_sc_minha_fila_retornos", q => q.select("*")), lerMdl ? dashLer("vw_sc_minha_fila_modelos", q => q.select("*")) : null, lerPrc ? dashLer("vw_sc_minha_fila_prc", q => q.select("*")) : null]);
  if(!dados) return;
  if(typeof histMencoesPendentesDefinir === "function") histMencoesPendentesDefinir((menc || []).map(m => m.registro_id));
  if(menc) dashRenderMencoes(menc);
  dashMarcarFonte(dados, "fila"); dashMarcarFonte(sep, "fila_sep"); dashMarcarFonte(custo, "fila_custo"); dashMarcarFonte(sst, "fila_sst"); dashMarcarFonte(ret, "fila_ret"); dashMarcarFonte(mdl, "fila_mdl"); dashMarcarFonte(prc, "fila_prc");
  _dashFila = dados.concat(sep || [], custo || [], sst || [], ret || [], mdl || [], prc || []).sort((a, b) => (DASH_NIVEL[a.nivel]?.ordem || 9) - (DASH_NIVEL[b.nivel]?.ordem || 9) || a.ordem - b.ordem);
  if($("dash-fila-cont")) $("dash-fila-cont").textContent = _dashFila.length ? `(${_dashFila.length})` : "";
  cont.innerHTML = _dashFila.length
    ? _dashFila.map((a, i) => dashChamadoEsperando(a) || dashChamadoConfirmar(a) ? dashLinhaFilaChamado(a, i) : dashLinhaAcao(a, i, "fila")).join("")
    : `<p class="vazio">Nada no seu nome agora. Aqui entram comentário em que você foi marcado, pendência de mobilização sua, ação de ocorrência SST com você como responsável, requisição para você aprovar, chamado esperando a sua resposta e separação atribuída a você. O que é da empresa está ao lado.</p>`;
}


function dashRenderMencoes(menc){
  _dashMencoes = (menc || []).slice().sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0));
  dashBadgeMencoes(_dashMencoes.length);
  const card = $("dash-mencoes");
  if(!card) return;
  card.style.display = _dashMencoes.length ? "" : "none";
  if($("dash-mencoes-cont")) $("dash-mencoes-cont").textContent = _dashMencoes.length ? `(${_dashMencoes.length})` : "";
  const lista = $("dash-mencoes-lista");
  if(lista) lista.innerHTML = _dashMencoes.map((a, i) => `<div class="dash-pendencia-item clicavel" data-menc="${i}" title="Abrir o registro com a conversa">
      <div class="dash-acao-txt"><strong>${esc(a.titulo)}</strong>${a.detalhe ? `<div class="meta" title="${esc(a.detalhe)}">${esc(a.detalhe)}</div>` : ""}</div>
      <span class="dash-pend-seta">›</span>
    </div>`).join("");
}
function dashBadgeMencoes(n){
  const b = $("nav-inicio-badge");
  if(!b) return;
  b.textContent = n > 0 ? String(n) : "";
  b.title = n > 0 ? `${n} menção(ões) não lida(s)` : "";
}

async function dashAtualizarBadgeMencoes(){
  if(typeof usuarioAtual === "undefined" || !usuarioAtual || typeof sb === "undefined") return;
  const { count, error } = await sb.from("vw_sc_minha_fila_mencoes").select("registro_id", { count: "exact", head: true });
  if(!error) dashBadgeMencoes(count || 0);
}


const dashChamadoEsperando = (a) => !!a && a.secao === "chamados" && Number(a.ordem) === 41 && !!a.registro_id;

const dashChamadoConfirmar = (a) => !!a && a.secao === "chamados" && Number(a.ordem) === 42 && !!a.registro_id;
function dashLinhaFilaChamado(a, i){
  const n = DASH_NIVEL[a.nivel] || { label: a.nivel, cor: "cinza" };
  const leitura = typeof ehSomenteLeitura === "function" && ehSomenteLeitura();
  const sugerida = dashChamadoEsperando(a) && /^Resposta sugerida:/.test(a.detalhe || "") && !leitura;
  const confirmar = dashChamadoConfirmar(a) && !leitura;
  const chave = dashExplicaDaLinha(a, "fila");
  return `<div class="dash-pendencia-item clicavel" data-fila="${i}"${chave ? ` data-explica="${esc(chave)}"` : ""} title="Abrir o chamado">
      <span class="tag ${esc(n.cor)}">${esc(n.label)}</span>
      <div class="dash-acao-txt"><strong>${esc(a.titulo)}</strong>${a.detalhe ? `<div class="meta" title="${esc(a.detalhe)}">${esc(a.detalhe)}</div>` : ""}
        <div class="dash-fila-acoes">
          ${sugerida ? `<button type="button" class="btn btn-sucesso btn-sm" data-fila-aprovar="${i}" title="Envia a resposta sugerida em seu nome">Aprovar</button>` : ""}
          ${confirmar ? `<button type="button" class="btn btn-sucesso btn-sm" data-fila-confirmar="${i}" title="Registra que a correção funcionou">Funcionou</button>` : ""}
          <button type="button" class="btn-sec btn-sm" data-fila-abrir="${i}">Abrir</button>
        </div>
      </div>
      ${  dashBotaoExplica(chave)}
    </div>`;
}
async function dashConfirmarChamadoFila(a){
  if(!a || !a.registro_id) return;
  const { error } = await sb.rpc("chamado_confirmar", { p_id: a.registro_id, p_texto: null });
  if(error){ aviso("app-aviso", "Não foi possível confirmar: " + error.message, "erro"); return; }
  aviso("app-aviso", `${String(a.titulo || "").replace(/^Confira: /, "").replace(/,.*$/, "")}: confirmação registrada. Obrigado!`, "ok");
  await dashCarregarFila();
  if(typeof carregarChamados === "function" && typeof _chamCarregado !== "undefined" && _chamCarregado) carregarChamados(true);
}
async function dashAprovarChamadoFila(btn, a){
  if(!a || !a.registro_id) return;
  const { data, error } = await sb.rpc("chamado_aprovar", { p_id: a.registro_id, p_texto: null });
  if(error){ aviso("app-aviso", "Não foi possível aprovar: " + error.message, "erro"); return; }
  aviso("app-aviso", `${a.titulo.replace(/ espera a sua resposta.*$/, "")}: resposta enviada (${data === "resolvido" ? "resolvido" : data === "recusado" ? "recusado" : "em análise"}).`, "ok");
  await dashCarregarFila();
  if(typeof carregarChamados === "function" && typeof _chamCarregado !== "undefined" && _chamCarregado) carregarChamados(true);
}

function carregarDashPendencias(){ return Promise.all([dashCarregarAcoes(), dashCarregarFila(), dashCarregarRegularizar()]); }







const DASH_REG_PAPEL = { responsavel: { ordem: 1 }, diretoria: { ordem: 2 }, acompanha: { ordem: 3 } };
const DASH_REG_VISAO_TITLE = { meus: "O que está no seu nome", empresa: "O total da empresa", acompanho: "O responsável é outra pessoa; você acompanha" };
let _dashRegVisao = null;
try { _dashRegVisao = sessionStorage.getItem("dash-reg-visao"); } catch(_e) {   }
async function dashCarregarRegularizar(){
  const cont = $("dash-regularizar");
  if(!cont) return;













  const [dados, fin, man, rh, rhh, sesmt, sst, geo, ace, log, campo, apt, mob, est, prod, rdoDia, refuro, ctr, cat, vbol, obraFis, veic] = await Promise.all([dashLer("vw_sc_regularizar", q => q.select("*"), "dash-regularizar"), dashLer("vw_sc_regularizar_fin", q => q.select("*")), dashLer("vw_sc_regularizar_man", q => q.select("*")), dashLer("vw_sc_regularizar_rh", q => q.select("*")), dashLer("vw_sc_regularizar_rhh", q => q.select("*")),
    (dashPodeVerEpi() || (typeof podeVerSesmt === "function" && podeVerSesmt())) ? dashLer("vw_sc_regularizar_sesmt", q => q.select("*")) : null,
    dashLer("vw_sc_regularizar_sst_ocorrencias", q => q.select("*")),
    dashLer("vw_sc_regularizar_geo", q => q.select("*")),
    dashLer("vw_sc_regularizar_ace", q => q.select("*")),
    dashLer("vw_sc_regularizar_log", q => q.select("*")),
    dashLer("vw_sc_regularizar_campo", q => q.select("*")),

    usuarioAtual && ["diretor", "gestor_manutencao", "gestor_acessorios"].includes(usuarioAtual.cargo) ? dashLer("vw_sc_regularizar_apt", q => q.select("*")) : null,
    dashLer("vw_sc_regularizar_mob", q => q.select("*")),

    usuarioAtual && (["diretor", "admin", "almoxarife", "auxiliar_almoxarifado"].includes(usuarioAtual.cargo) || (typeof sstPodeOperar === "function" && sstPodeOperar())) ? dashLer("vw_sc_regularizar_est", q => q.select("*")) : null,

    usuarioAtual && ["diretor", "admin", "almoxarife", "auxiliar_almoxarifado", "logistica"].includes(usuarioAtual.cargo) ? dashLer("vw_sc_regularizar_prod", q => q.select("*")) : null,
    dashLer("vw_sc_regularizar_rdo_dia", q => q.select("*")),
    dashLer("vw_sc_regularizar_refuro", q => q.select("*")),

    typeof podeVerContratos === "function" && podeVerContratos() ? dashLer("vw_sc_regularizar_ctr", q => q.select("*")) : null,
    usuarioAtual?.cargo === "diretor" ? dashLer("vw_sc_regularizar_cat", q => q.select("*")) : null,
    usuarioAtual && ["diretor", "admin", "financeiro"].includes(usuarioAtual.cargo) ? dashLer("vw_sc_regularizar_vbol", q => q.select("*")) : null,

    dashLer("vw_pendencias_cliente_fiscal", q => q.select("*").eq("tipo", "obra").order("obra_codigo")),
    usuarioAtual && ["diretor", "admin", "gestor_frota"].includes(usuarioAtual.cargo) ? dashLer("vw_sc_regularizar_veic", q => q.select("*")) : null]);
  if(!dados) return;
  const obrEnd = dashRegObraEndereco(obraFis || []);
  _dashReg = dados.concat(fin || [], man || [], rh || [], rhh || [], sesmt || [], sst || [], geo || [], ace || [], log || [], campo || [], apt || [], mob || [], est || [], prod || [], rdoDia || [], refuro || [], ctr || [], cat || [], vbol || [], obrEnd, veic || []).sort((a, b) => (DASH_REG_PAPEL[a.papel]?.ordem || 9) - (DASH_REG_PAPEL[b.papel]?.ordem || 9)
    || a.ordem - b.ordem || String(a.titulo).localeCompare(String(b.titulo), "pt-BR", { numeric: true }));
  dashRenderRegularizar();
}

function dashRenderRegularizar(){
  const cont = $("dash-regularizar"), visoes = $("dash-reg-visoes");
  if(!cont) return;
  const n = dashRegContar(_dashReg);
  const visao = dashRegVisaoInicial(n, _dashRegVisao);
  if($("dash-reg-cont")) $("dash-reg-cont").textContent = _dashReg.length ? `(${_dashReg.length})` : "";
  if(visoes){
    visoes.style.display = visao ? "" : "none";
    visoes.innerHTML = DASH_REG_VISOES.filter(([k]) => n[k] > 0).map(([k, rot]) =>
      `<button type="button" class="serv-view-btn${k === visao ? " ativo" : ""}" data-reg-visao="${esc(k)}" aria-pressed="${k === visao ? "true" : "false"}" title="${esc(DASH_REG_VISAO_TITLE[k])}">${esc(rot)} <span class="contador">(${esc(n[k])})</span></button>`).join("");
  }
  if(!visao){ cont.innerHTML = `<p class="vazio">Nada para regularizar: nenhum cadastro no seu nome para completar.</p>`; return; }
  const daVisao = new Set(dashRegFiltrar(_dashReg, visao));
  cont.innerHTML = (n.meus ? "" : `<p class="dash-bloco-dono">Nenhum cadastro no seu nome para completar.</p>`)
    + _dashReg.map((a, i) => {
      if(!daVisao.has(a)) return "";
      const chave = dashExplicaDaLinha(a, "regularizar");
      return `<div class="dash-pendencia-item clicavel" data-reg="${i}"${chave ? ` data-explica="${esc(chave)}"` : ""} title="Abrir a tela para corrigir">
        <div class="dash-acao-txt"><strong>${esc(a.titulo)}</strong> <span class="contador">(${esc(a.quantidade)})</span>
          ${a.detalhe ? `<div class="meta" title="${esc(a.detalhe)}">${esc(a.detalhe)}</div>` : ""}</div>
        ${  dashBotaoExplica(chave)}<span class="dash-pend-seta">›</span>
      </div>`;
    }).join("");
}





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

    if(error.code === "42P01" || error.code === "PGRST205"){ card.style.display = "none"; return; }
    cont.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(error.message || "erro")}).</p>`;
    return;
  }
  _dashSeg = (data || []).sort((a, b) => (DASH_NIVEL[a.nivel]?.ordem || 9) - (DASH_NIVEL[b.nivel]?.ordem || 9) || a.ordem - b.ordem
    || String(b.quando || "").localeCompare(String(a.quando || "")));
  const porTipo = {};
  _dashSeg.forEach(a => { porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1; });
  if($("dash-seg-cont")) $("dash-seg-cont").innerHTML = Object.keys(DASH_SEG_TIPO).filter(t => porTipo[t])
    .map(t => `<span class="tag ${t === "sem_mfa" || t === "leitura_sensivel" ? "ambar" : "cinza"}">${esc(porTipo[t])} ${esc(DASH_SEG_TIPO[t].toLowerCase())}</span>`).join(" ");
  if(!_dashSeg.length){ cont.innerHTML = `<p class="vazio">✅ Nenhum alerta de segurança.</p>`; return; }
  cont.innerHTML = _dashSeg.map((a, i) => {
    const n = DASH_NIVEL[a.nivel] || { label: a.nivel, cor: "cinza" };
    const cargo = a.cargo ? ((typeof CARGOS === "object" && CARGOS[a.cargo]) || a.cargo) : "";
    const quem = [a.nome, cargo].filter(Boolean).join(" · ");
    const clic = !!a.usuario_id && ["sem_mfa", "convite_pendente", "troca_cargo", "sessoes_encerradas"].includes(a.tipo);
    const quando = a.quando ? new Date(a.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="dash-pendencia-item${clic ? " clicavel" : ""}" data-seg="${i}"${clic ? ' title="Abrir em Configurações › Usuários e acessos"' : ""}>
      <span class="tag ${esc(n.cor)}">${esc(n.label)}</span>
      <div class="dash-acao-txt"><strong>${esc(DASH_SEG_TIPO[a.tipo] || a.tipo)}</strong>${quem ? ` · ${esc(quem)}` : ""}
        <div class="meta" title="${esc(a.detalhe || "")}">${esc(a.detalhe || "")}${quando ? ` · ${esc(quando)}` : ""}</div></div>
      ${clic ? '<span class="dash-pend-seta">›</span>' : ""}
    </div>`;
  }).join("");
}



async function dashCarregarEpi(){
  const card = $("dash-epi-card"), cont = $("dash-epi");
  if(!card || !cont) return;
  const btn = $("btn-dash-epi-abrir");
  if(btn && !btn.dataset.ligado){ btn.dataset.ligado = "1"; btn.addEventListener("click", () => { if(typeof epiAbrirRelatorio === "function") epiAbrirRelatorio("pessoa"); }); }
  const { data, error } = await sb.from("vw_sc_epi").select("*");
  if(error){
    if(error.code === "42P01" || error.code === "PGRST205"){ card.style.display = "none"; return; }
    cont.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(error.message || "erro")}).</p>`;
    return;
  }
  const k = (data || [])[0];
  if(!k){ card.style.display = "none"; return; }
  const ant = Number(k.gasto_mes_anterior || 0), mes = Number(k.gasto_mes || 0);
  const item = (rot, valor, sub, visao, cor) => `<div class="dash-card${visao ? " clicavel" : ""}"${visao ? ` data-epi-visao="${esc(visao)}" title="Abrir no relatório de EPI"` : ""}>
      <div class="dash-card-rot">${esc(rot)}</div><div class="dash-card-num">${cor ? `<span class="tag ${esc(cor)}">${esc(valor)}</span>` : esc(valor)}</div><div class="dash-card-sub">${esc(sub)}</div></div>`;
  cont.innerHTML = `<div class="dash-epi-grade">
      ${item("Gasto no mês", brl(mes), ant ? `mês anterior ${brl(ant)}` : "sem gasto no mês anterior", "pessoa")}
      ${item("Entregas no mês", String(k.entregas_mes || 0), `${k.pessoas_mes || 0} colaborador(es)`, "pessoa")}
      ${item("Trocas vencidas", String(k.trocas_vencidas || 0), "EPI além da validade, sem troca", "vencidas", k.trocas_vencidas ? "vermelho" : "")}
      ${item("Saídas de EPI sem pessoa", String(k.sem_pessoa || 0), "desde o início do controle", "sem_pessoa", k.sem_pessoa ? "ambar" : "")}
      ${item("Sem assinatura", String(k.sem_assinatura || 0), "entregas de EPI a assinar", null, k.sem_assinatura ? "ambar" : "")}
    </div>`;
  cont.querySelectorAll("[data-epi-visao]").forEach(el => el.addEventListener("click", () => { if(typeof epiAbrirRelatorio === "function") epiAbrirRelatorio(el.dataset.epiVisao); }));
}



async function dashCarregarSst(){
  const card = $("dash-sst-card"), cont = $("dash-sst");
  if(!card || !cont) return;
  const btn = $("btn-dash-sst-abrir");
  if(btn && !btn.dataset.ligado){ btn.dataset.ligado = "1"; btn.addEventListener("click", () => { if(irParaSecao("sesmt-ocorrencias") && typeof ssoAbrirPreset === "function") ssoAbrirPreset(null, null); }); }
  const { data: k, error } = await sb.rpc("sst_indicadores", { p_ano: new Date().getFullYear() });
  if(error){
    if(["42P01", "PGRST205", "PGRST202", "42883"].includes(error.code)){ card.style.display = "none"; return; }
    cont.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(error.message || "erro")}).</p>`;
    return;
  }
  if(!k){ card.style.display = "none"; return; }
  const t = k.totais || {};
  const item = (rot, valor, sub, filtro, cor) => `<div class="dash-card${filtro != null ? " clicavel" : ""}"${filtro != null ? ` data-sst-filtro="${esc(filtro)}" title="Abrir em Ocorrências SST"` : ""}>
      <div class="dash-card-rot">${esc(rot)}</div><div class="dash-card-num">${cor ? `<span class="tag ${esc(cor)}">${esc(valor)}</span>` : esc(valor)}</div><div class="dash-card-sub">${esc(sub)}</div></div>`;
  cont.innerHTML = `<div class="dash-epi-grade">
      ${item("Acidentes no mês", String(k.acidentes_mes || 0), `${k.ocorrencias_mes || 0} ocorrência(s) no mês`, "", k.acidentes_mes ? "vermelho" : "")}
      ${item("Dias sem acidente", k.dias_sem_acidente == null ? "—" : String(k.dias_sem_acidente), k.ultimo_acidente_em ? "último em " + dataBR(k.ultimo_acidente_em) : "nenhum acidente registrado", null, k.dias_sem_acidente != null && k.dias_sem_acidente < 30 ? "ambar" : "verde")}
      ${item("Acidentes no ano", String(t.acidentes || 0), `${t.com_afastamento || 0} com afastamento · ${t.dias_perdidos || 0} dia(s) perdido(s)`, "indicadores", "")}
      ${item("Abertas", String(k.abertas || 0), `${k.sem_classificacao || 0} sem classificação`, "sem_classificacao", k.sem_classificacao ? "ambar" : "")}
      ${item("Ações vencidas", String(k.acoes_vencidas || 0), "plano de ação fora do prazo", "acao_vencida", k.acoes_vencidas ? "vermelho" : "")}
    </div>`;
  cont.querySelectorAll("[data-sst-filtro]").forEach(el => el.addEventListener("click", () => {
    if(!irParaSecao("sesmt-ocorrencias") || typeof ssoAbrirPreset !== "function") return;
    if(el.dataset.sstFiltro === "indicadores"){ if(typeof _ssoView !== "undefined") _ssoView = "indicadores"; ssoAbrirPreset(null, null); }
    else ssoAbrirPreset(el.dataset.sstFiltro || null, null);
  }));
}
async function dashAbrirSeguranca(a){
  if(!a || !a.usuario_id || !irParaSecao("usuarios") || typeof abrirUsuario !== "function") return;
  if(typeof _usuarios !== "undefined" && !_usuarios.some(u => u.id === a.usuario_id) && typeof carregarUsuarios === "function") await carregarUsuarios();
  abrirUsuario(a.usuario_id);
}


async function dashAbrirRegularizar(a){
  if(!a) return;
  const ids = a.obra_ids || [];

  const FICHA = { sem_responsavel: { aba: "geral", foco: "obr-responsavel" },
                  responsavel_inativo: { aba: "geral", foco: "obr-responsavel" },
                  sem_jornada:     { aba: "parametros", foco: "obr-jornada-entrada" },
                  sem_estacas:     { aba: "estacas", foco: null },
                  sem_contrato:    { aba: "contrato", foco: null },
                  aditivo_sem_assinatura: { aba: "contrato", foco: null },
                  sem_medicao:     { aba: "medicoes", foco: null },
                  obra_sem_ibge:   { aba: "endereco", foco: "obr-cep" },
                  obra_endereco_remessa: { aba: "endereco", foco: "obr-cep" } };


  if(a.setor === "campo"){ if(typeof rdoAbrirPresetCampo === "function") await rdoAbrirPresetCampo(a); return; }
  if(a.setor === "frota" && /crlv/.test(a.filtro || "")){ if(typeof vdocAbrirRegularizar === "function") await vdocAbrirRegularizar(a); return; }

  if(a.filtro === "contrato_obrigacao_vencida"){ if(typeof conAbrirObrigacoesVencidas === "function") await conAbrirObrigacoesVencidas(a); return; }

  if(a.filtro === "refuro_cobranca_pendente"){
    if(ids.length === 1 && typeof confAbrirRefurosDaObra === "function"){ await confAbrirRefurosDaObra(ids[0]); return; }
    irParaSecao("obras");
    if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: "estacas", foco: null });
    return;
  }

  if(a.setor === "mobilizacoes"){

    if(a.filtro === "obra_sem_mobilizacao" && ids.length === 1){ await dashAbrirObra(ids[0]); document.querySelector('#obr-notebook button[data-tab="maquinas"]')?.click(); return; }
    if(typeof mobAbrirRegularizar === "function") await mobAbrirRegularizar(a.filtro);
    return;
  }
  if(a.setor === "apontamentos"){ if(irParaSecao("apontamentos") && typeof aptAbrirAguardando === "function") await aptAbrirAguardando(a.filtro); return; }
  if(a.setor === "geodigitus"){
    if(/^cpu_/.test(a.filtro || "") || a.filtro === "geodigitus_sync_parado"){
      if(!irParaSecao("equipamentos")) return;
      if(a.registro_id && a.filtro !== "cpu_imei_desconhecido" && typeof cpbAbrir === "function") cpbAbrir(a.registro_id);
      else if(typeof cpbAbrirPainel === "function") cpbAbrirPainel(a.filtro);
    } else if(irParaSecao("rdo") && typeof geoAbrirPreset === "function") geoAbrirPreset(a.filtro, a.registro_id || null);
    return;
  }
  if(a.secao === "obras" && FICHA[a.filtro]){
    const f = FICHA[a.filtro];
    if(ids.length === 1){ await dashAbrirObra(ids[0], f.aba); obrFocarCampo(f.foco); return; }
    irParaSecao("obras");
    if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: f.aba, foco: f.foco });
  } else if(a.secao === "obras" && a.filtro === "rdo_sem_dados"){
    if(a.obra_id) await dashAbrirObra(a.obra_id, "rdos");
    else { irParaSecao("obras"); if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: "rdos", foco: null }); }
  } else if(a.secao === "obras" && a.filtro === "rdo_sem_equipamento"){
    if(typeof _obrRdoFiltroMaq !== "undefined"){ _obrRdoFiltroMaq = "sem"; _obrRdoFiltroObra = a.obra_id || null; }
    if(a.obra_id) await dashAbrirObra(a.obra_id, "rdos");
    else { irParaSecao("obras"); if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: "rdos", foco: null }); }
  } else if(a.secao === "obras" && (a.filtro === "estaca_por_observacao" || a.filtro === "rdo_sem_equipe")){
    if(a.registro_id && irParaSecao("rdo") && typeof abrirRDO === "function") abrirRDO(a.registro_id);
    else if(a.obra_id) await dashAbrirObra(a.obra_id, "rdos");
    else { irParaSecao("obras"); if(typeof renderObras === "function") renderObras({ ids, rotulo: a.titulo, aba: "rdos", foco: null }); }
  } else if(a.secao === "obras"){
    if(typeof estDefinirFiltroProf === "function") estDefinirFiltroProf(a.filtro);
    if(a.obra_id) await dashAbrirObra(a.obra_id, "estacas");
  } else if(a.secao === "clientes" && a.filtro === "cliente_sem_fiscal"){
    if(typeof cliAbrirPendenciasFiscais === "function") await cliAbrirPendenciasFiscais(a.registro_id || null);
  } else if(a.filtro === "maquina_sem_ncm" || a.filtro === "acessorio_sem_ncm"){
    if(!a.registro_id){ if(typeof cliAbrirPendenciasFiscais === "function") await cliAbrirPendenciasFiscais(null); return; }
    if(a.filtro === "maquina_sem_ncm"){
      if(irParaSecao("equipamentos") && typeof abrirEquipamento === "function"){ await abrirEquipamento(a.registro_id); if(typeof ativarTabEquipamento === "function") ativarTabEquipamento("fiscal"); }
    } else if(irParaSecao("acessorios") && typeof abrirAcessorio === "function"){
      for(let i = 0; i < 80 && !(typeof _aceCarregado !== "undefined" && _aceCarregado); i++) await new Promise(r => setTimeout(r, 250));
      abrirAcessorio(a.registro_id);
      if(typeof ativarTabAcessorio === "function") ativarTabAcessorio("fiscal");
    }
  } else if(a.filtro === "acessorio_vida_alerta"){
    if(typeof aceRenderVidaUtil !== "function") return;
    _aceFamilia = ""; _aceView = "vida"; _aceVidaAba = "modelo";
    if(!irParaSecao("acessorios") || !a.registro_id) return;
    for(let i = 0; i < 80 && !_aceCarregado; i++) await new Promise(r => setTimeout(r, 250));
    abrirAcessorio(a.registro_id);
    ativarTabAcessorio("vida");
  } else if(a.secao === "acessorios"){

    if(typeof renderAcessoriosContagem !== "function") return;
    _aceFamilia = a.filtro || ""; _aceView = "contagem"; _aceSoSemPreco = true;
    irParaSecao("acessorios");
  } else if(a.secao === "equipamentos" && /^(venda_|veiculo_sem_transferencia|bem_vendido_)/.test(a.filtro || "")){
    const PEND = { venda_sem_contrato: "sem_contrato", veiculo_sem_transferencia: "sem_transferencia", bem_vendido_sem_valor_aquisicao: "sem_valor_aquisicao" };
    if(a.registro_id && typeof vbAbrirVendaPorId === "function") vbAbrirVendaPorId(a.registro_id);
    else if(typeof vbAbrirPainel === "function") vbAbrirPainel({ pend: PEND[a.filtro] || "", status: a.filtro === "venda_incompleta" ? "abertas" : "" });
  } else if(a.secao === "equipamentos" && a.filtro === "leitura_parada"){
    if(irParaSecao("equipamentos") && a.equipamento_id && typeof abrirEquipamento === "function") abrirEquipamento(a.equipamento_id);
  } else if(a.secao === "equipamentos"){
    if(typeof renderEquipamentos === "function") _eqpKpi = "sem_cod_ext";
    if(irParaSecao("equipamentos") && a.equipamento_id && typeof abrirEquipamento === "function") abrirEquipamento(a.equipamento_id);
  } else if(a.secao === "medicoes" && /^permuta_/.test(a.filtro || "")){
    if(irParaSecao("medicoes") && typeof medPmAbrirPreset === "function") medPmAbrirPreset(a.registro_id, a.filtro);
  } else if(a.secao === "medicoes" && a.filtro === "caucao_vencida"){
    if(irParaSecao("medicoes") && typeof medCauAbrirPreset === "function") medCauAbrirPreset("vencidas");
  } else if(a.secao === "produtos" && a.filtro === "produto_pendente"){
    if(a.registro_id){ if(irParaSecao("produtos") && typeof abrirProduto === "function") abrirProduto(a.registro_id); }
    else if(typeof prodAbrirPendentes === "function") await prodAbrirPendentes();
  } else if(a.secao === "manutencao"){
    if(!irParaSecao("manutencao")) return;
    if(a.registro_id && typeof abrirManutencao === "function") abrirManutencao(a.registro_id);
    else if(typeof manAbrirPreset === "function") manAbrirPreset("os_atrasadas");
  } else if(a.secao === "funcionarios" && /^promocao_/.test(a.filtro || "")){
    if(irParaSecao("funcionarios") && typeof funcAbrirPromocoes === "function") funcAbrirPromocoes(a.filtro === "promocao_vencida" ? "vencidas" : "60dias");
  } else if(/^lotacao_/.test(a.filtro || "")){
    if(typeof rhhAbrirConferir === "function") rhhAbrirConferir(a.filtro);
  } else if(a.secao === "funcionarios" && /^baixada_/.test(a.filtro || "")){
    if(irParaSecao("funcionarios") && typeof funcAbrirLogisticaPreset === "function") funcAbrirLogisticaPreset(a.filtro);
  } else if(a.secao === "estoque" && /^estoque_/.test(a.filtro || "")){
    if(typeof estAbrirPendencias === "function") estAbrirPendencias();
  } else if(a.secao === "estoque" && /^epi_/.test(a.filtro || "")){
    if(a.filtro === "epi_vencida" && a.registro_id && typeof epiAbrirFichaFuncionario === "function") epiAbrirFichaFuncionario(a.registro_id);
    else if(typeof epiAbrirRelatorio === "function") epiAbrirRelatorio(a.filtro === "epi_vencida" ? "vencidas" : "sem_pessoa");
  } else if(a.secao === "chamados"){
    if(!irParaSecao("chamados") || typeof carregarChamados !== "function") return;
    await carregarChamados(true);
    if(a.registro_id && typeof abrirChamado === "function"){ abrirChamado(a.registro_id); return; }
    const f = $("cham-f-status");
    if(f && [...f.options].some(o => o.value === "atrasados")){ f.value = "atrasados"; if(typeof renderChamados === "function") renderChamados(); }
  } else if(a.secao === "sesmt_ocorrencias"){
    if(irParaSecao("sesmt-ocorrencias") && typeof ssoAbrirPreset === "function") ssoAbrirPreset(a.filtro, a.registro_id || null);
  } else if(a.secao === "rhh"){


    if(typeof rhhAbrirPreset === "function") rhhAbrirPreset({ obraIds: ids, pendentes: true, filtro: a.filtro });
    irParaSecao("rhh");
  }
}




const DASH_FICHA_POR_SECAO = {
  compras:      async (id) => { if(typeof cmpCarregarBase === "function") await cmpCarregarBase(false); if(typeof abrirPedido === "function") await abrirPedido(id); },
  manutencao:   (id) => { if(typeof abrirManutencao === "function") abrirManutencao(id); },
  mobilizacoes: (id) => { if(typeof abrirMobilizacao === "function") abrirMobilizacao(id); },
  equipamentos: (id) => { if(typeof abrirEquipamento === "function") abrirEquipamento(id); },
  acessorios:   (id) => { if(typeof abrirAcessorio === "function") abrirAcessorio(id); },
  clientes:     (id) => { if(typeof abrirCliente === "function") abrirCliente(id); },
  fornecedores: (id) => { if(typeof abrirFornecedor === "function") abrirFornecedor(id); },
  centros:      (id) => { if(typeof abrirCentroCusto === "function") abrirCentroCusto(id); },
  fabricacao:   (id) => { if(typeof abrirOrdemFabricacao === "function") abrirOrdemFabricacao(id); },


  medicoes:     async (id, a) => {
    if(/permuta/i.test(a.titulo || "")){ if(typeof medPmAbrirPorId === "function") await medPmAbrirPorId(id); return; }
    if(typeof medCauAbrirPreset === "function") medCauAbrirPreset("");
    if(typeof medCauCarregar === "function") await medCauCarregar(true);
    if(typeof medCauAbrir === "function") await medCauAbrir(id);
  }
};
async function dashAbrirMencao(a){
  const abrir = DASH_FICHA_POR_SECAO[a.secao];
  if(a.secao !== "medicoes" || !/permuta/i.test(a.titulo || "")){ if(!irParaSecao(a.secao)) return; }
  if(abrir && a.registro_id) await abrir(a.registro_id, a);
}


async function dashAbrirAcao(a){
  if(!a) return;
  const id = a.registro_id;
  if(Number(a.ordem) === 45 && id){ await dashAbrirMencao(a); return; }
  switch(a.secao){
    case "obras":
      if(a.obra_id) dashAbrirObra(a.obra_id, a.setor === "contratos" ? "contrato" : /estaca/i.test(a.titulo) ? "estacas" : /marcado/i.test(a.titulo) ? "timeline" : null);
      else dashIrObrasAtivas();
      break;
    case "equipamentos":

      if(a.setor === "financeiro" && /venda/i.test(a.titulo || "") && typeof vbAbrirPainel === "function"){
        if(id && typeof vbAbrirVendaPorId === "function") vbAbrirVendaPorId(id);
        else vbAbrirPainel({ status: a.nivel === "critico" ? "atrasada" : "abertas" });
        break;
      }
      if(irParaSecao("equipamentos") && a.equipamento_id && typeof abrirEquipamento === "function") abrirEquipamento(a.equipamento_id);
      break;
    case "medicoes":

      if(/permuta/i.test(a.titulo || "") && typeof medPmAbrirPreset === "function"){ if(irParaSecao("medicoes")) medPmAbrirPreset(id, a.nivel === "atencao" ? "prazo_90_dias" : ""); }
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
      if(a.filtro === "modelo_aprovar" || a.filtro === "modelo_devolvido"){
        if(irParaSecao("contratos") && typeof mdlAbrirVersao === "function") mdlAbrirVersao(id);
      } else if(a.setor === "financeiro"){
        if(irParaSecao("contaspagar") && typeof capAtivarView === "function"){ _capFiltroVenc = a.nivel === "critico" ? "vencidos" : ""; _capIncluirExp = false; _capFiltroOrigem = ""; capAtivarView("titulos"); }
      } else if(id) dashAbrirContrato(id);
      else irParaSecao("contratos");
      break;
    case "processos":
      if(typeof prcAbrirDaInicio === "function") prcAbrirDaInicio(id); else irParaSecao("contratos");
      break;
    case "pedidos_site":
      if(typeof psiAbrirDaInicio === "function") psiAbrirDaInicio(id); else irParaSecao("orcamentos");
      break;
    case "orcamentos":
      if(id) dashAbrirOrcamento(id, a._fonte === "fila_ret" ? "negociacao" : null); else irParaSecao("orcamentos");
      break;
    case "compras":

      if(a._assinar && id && typeof cmpAbrirParaAssinar === "function"){ await cmpAbrirParaAssinar(id); break; }
      if(irParaSecao("compras")){
        if(/requisi/i.test(a.titulo) && typeof renderCompras === "function"){ _cmpView = "requisicoes"; _reqFiltroSt = "pendente"; setTimeout(() => renderCompras(), 400); }

        else if(id && typeof abrirPedido === "function"){ if(typeof cmpCarregarBase === "function") await cmpCarregarBase(false); await abrirPedido(id); }
      }
      break;
    case "separacoes":
      if(typeof _sepPreset !== "undefined") _sepPreset = id ? "" : /vencid/i.test(a.titulo) ? "vencidas" : /sem respons/i.test(a.titulo) ? "sem_resp" : "";
      if(irParaSecao("separacoes") && id && typeof abrirSeparacao === "function") abrirSeparacao(id);
      break;
    case "fabricacao":
      if(typeof _fabPreset !== "undefined") _fabPreset = id ? "" : "em_producao";
      if(irParaSecao("fabricacao") && id && typeof abrirOrdemFabricacao === "function") abrirOrdemFabricacao(id);
      break;
    case "produtos":

      if(irParaSecao("produtos") && /sem custo/i.test(a.titulo || "") && typeof prodAbrirSaidasSemCusto === "function") prodAbrirSaidasSemCusto(/^Produto saiu sem custo/.test(a.titulo || "") ? id : null);
      break;
    case "clientes":
      if(typeof cliAbrirPendenciasFiscais === "function") await cliAbrirPendenciasFiscais(id || null); else irParaSecao("clientes");
      break;
    case "sesmt_ocorrencias":
      if(irParaSecao("sesmt-ocorrencias") && typeof ssoAbrirPreset === "function") ssoAbrirPreset(null, id || null);
      break;
    case "manutencao":
      if(!irParaSecao("manutencao")) break;
      if(typeof manAbrirPreset === "function") manAbrirPreset(a.nivel === "critico" ? "preventivas_critico" : "preventivas_atencao", a.equipamento_id || null);
      break;
    default:
      irParaSecao(a.secao);
  }
}







let _dmh = [];
let _dmhTipo = "";
let _dmhBusca = "";
let _dmhTimer = null;
let _dmhRefreshS = 120;
let _dmhSyncAtivo = false;
let _dmhCargaN = 0;
const DMH_TIPO = { helice_continua: "Hélice contínua", trado_mecanizado: "Trado mecanizado", estaca_raiz: "Estaca raiz", helice_secante: "Hélice secante" };
const DMH_LOCAL = { base: "na base", em_transito: "em trânsito", fornecedor_manutencao: "em manutenção no fornecedor", cliente: "no cliente", vendido: "vendida", obra: "sem obra" };
const DMH_SYNC = { pronto: "sync ok", aguardando: "sync aguardando", sincronizando: "sincronizando", faltam_arquivos: "faltam arquivos", falha: "falha no sync", configurando_acesso: "configurando acesso" };
const DMH_CALIB = { vence_30_dias: "calibração vence em 30 d", vencida: "calibração vencida", sem_certificado: "sem certificado de calibração" };
const dmhHora = (ts) => ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
const dmhDuracao = (min) => min == null ? "—" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;

const dmhOrdem = (m) => m.alerta_sem_chegada ? 0 : m.situacao === "produzindo" ? 1 : m.situacao === "parada" ? 2 : m.situacao === "sem_producao" ? 3 : 4;

async function dmhCarregar(){
  const cont = $("dmh-conteudo");
  if(!cont) return;
  const carga = ++_dmhCargaN;
  const [res, cfg] = await Promise.all([
    sb.from("vw_sc_maquinas_hoje").select("*"),
    sb.from("empresa_config").select("maquinas_hoje_refresh_s,geodigitus_sync_ativo").eq("id", 1).maybeSingle()
  ]);
  if(carga !== _dmhCargaN) return;
  if(res.error){
    const semView = ["42P01", "PGRST205", "PGRST200", "42703"].includes(res.error.code);
    cont.innerHTML = `<p class="vazio">${semView ? "Máquinas hoje ainda não disponível (a migration da fase 139 não foi aplicada)." : "Não foi possível carregar as máquinas: " + esc(res.error.message)}</p>`;
    return;
  }
  _dmh = res.data || [];
  if(!cfg.error && cfg.data){
    _dmhRefreshS = Math.max(30, Number(cfg.data.maquinas_hoje_refresh_s) || 120);
    _dmhSyncAtivo = !!cfg.data.geodigitus_sync_ativo;
  }
  const retrato = _dmh[0]?.retrato_em ? new Date(_dmh[0].retrato_em) : new Date();
  if($("dmh-retrato")) $("dmh-retrato").textContent = "retrato às " + retrato.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  renderDmh();
}

function renderDmh(){
  const cont = $("dmh-conteudo");
  if(!cont) return;
  const busca = _dmhBusca.trim().toLowerCase();
  const lista = _dmh
    .filter(m => !_dmhTipo || m.tipo_servico_padrao === _dmhTipo)
    .filter(m => !busca || `${m.codigo || ""} ${m.nome || ""}`.toLowerCase().includes(busca))
    .sort((a, b) => (dmhOrdem(a) - dmhOrdem(b)) || String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR", { numeric: true }));
  if(!lista.length){ cont.innerHTML = `<p class="vazio">${_dmh.length ? "Nenhuma máquina com este filtro." : "Nenhuma perfuratriz ativa na frota."}</p>`; return; }
  cont.innerHTML = lista.map(dmhCard).join("");
}

function dmhCard(m){
  const s = DASH_SITUACAO[m.situacao] || { label: m.situacao, cor: "cinza" };
  const semObra = !m.obra_id;
  const alerta = !!m.alerta_sem_chegada;
  return `<div class="dash-card dmh-card${alerta ? " dmh-alerta" : ""}${semObra ? " dmh-sem-obra" : ""}" data-eqp="${esc(m.equipamento_id)}" title="Abrir a ficha da máquina">
    <div class="dmh-cab"><span class="dmh-cod">${esc(m.codigo || "—")}</span><span class="meta dmh-nome">${esc(m.nome || "")}</span><span class="tag ${esc(s.cor)}">${esc(alerta ? "Sem chegada" : s.label)}</span></div>
    <div class="dmh-linha dmh-obra">${m.obra_id ? linkObra(m.obra_id, `${m.obra_codigo || ""} · ${m.obra_nome || ""}`) : `<span class="meta">${esc(DMH_LOCAL[m.localizacao_tipo] || "sem obra")}${m.ultimo_lancamento ? ` · último RDO ${dataBR(m.ultimo_lancamento)}` : ""}</span>`}${m.tipo_servico_padrao ? ` <span class="meta">· ${esc(DMH_TIPO[m.tipo_servico_padrao] || m.tipo_servico_padrao)}</span>` : ""}</div>
    ${semObra ? "" : `<div class="dmh-linha"><span class="dmh-rot">hoje</span> ${dmhLinhaHoje(m)}</div>
    <div class="dmh-linha"><span class="dmh-rot">última</span> ${dmhLinhaUltima(m)}</div>
    <div class="dmh-linha"><span class="dmh-rot">próxima</span> ${dmhLinhaProxima(m)}</div>`}
    <div class="dmh-linha"><span class="dmh-rot">operador</span> ${m.operador_nome ? `${esc(m.operador_nome)}${m.operador_origem === "ultimo" ? ` <span class="meta">(último, sem RDO hoje)</span>` : ""}` : `<span class="meta">—</span>`}</div>
    <div class="dmh-rodape">${dmhRodape(m)}</div>
  </div>`;
}
function dmhLinhaHoje(m){
  if(!Number(m.estacas_hoje) && !Number(m.refuros_hoje) && !Number(m.metros_hoje)) return `<span class="meta">sem RDO hoje${m.ultimo_lancamento ? ` · último RDO ${dataBR(m.ultimo_lancamento)}` : ""}</span>`;
  const periodo = m.primeiro_inicio_hoje && m.ultimo_fim_hoje ? ` · ${dmhHora(m.primeiro_inicio_hoje)}–${dmhHora(m.ultimo_fim_hoje)}` : "";
  return `<span class="dmh-num">${esc(m.estacas_hoje)}</span> estaca${Number(m.estacas_hoje) === 1 ? "" : "s"}${Number(m.refuros_hoje) ? ` · ${esc(m.refuros_hoje)} refurada${Number(m.refuros_hoje) === 1 ? "" : "s"}` : ""} · <span class="dmh-num">${num(m.metros_hoje)}</span> m${periodo}`;
}
function dmhLinhaUltima(m){
  if(!m.ultima_estaca_origem) return `<span class="meta">${Number(m.estacas_hoje) ? "estacas do RDO sem horário" : "nenhuma concluída hoje"}</span>`;
  return `<strong>${esc(m.ultima_estaca_numero || "?")}</strong>${m.ultima_estaca_prof_m != null ? ` · ${num(m.ultima_estaca_prof_m)} m` : ""} · concluída às <span class="dmh-num">${dmhHora(m.ultima_estaca_fim)}</span> <span class="meta">(${m.ultima_estaca_origem === "geodigitus" ? "CPU" : "RDO"})</span>`;
}
function dmhLinhaProxima(m){
  if(!m.proxima_estaca_id) return `<span class="meta">nenhuma prevista</span>`;
  return `<strong>${esc(m.proxima_estaca_numero || "?")}</strong>${m.proxima_diametro_mm ? ` · Ø ${num(m.proxima_diametro_mm)}` : ""}${m.proxima_prof_m != null ? ` · ${num(m.proxima_prof_m)} m` : ""} <span class="meta">· faltam ${esc(m.faltam_previstas)}${m.proxima_origem === "obra" ? " · sem sequência da máquina" : ""}</span>`;
}
function dmhRodape(m){
  if(!m.cpu_id) return `<span class="meta">sem computador de bordo</span>`;
  const cpu = `CPU …${esc(String(m.cpu_imei || "").slice(-4))} · ${esc(DMH_SYNC[m.cpu_sync_estado] || m.cpu_sync_estado || "—")}${DMH_CALIB[m.cpu_calibracao_situacao] ? ` · <span class="txt-aviso">${esc(DMH_CALIB[m.cpu_calibracao_situacao])}</span>` : ""}`;
  if(m.alerta_sem_chegada) return `${cpu}<br><span class="dmh-aviso">⚠ sem chegada há ${esc(m.minutos_sem_chegada == null ? "mais de 7 dias" : dmhDuracao(Number(m.minutos_sem_chegada)))}</span>`;
  if(!_dmhSyncAtivo) return `${cpu}<br>sync desligado · última sincronização ${m.cpu_ultima_sync ? esc(dataHoraBR(m.cpu_ultima_sync)) : "nunca"}`;
  return `${cpu}<br>última chegada ${m.ultima_chegada_em ? esc(dataHoraBR(m.ultima_chegada_em)) : "— (nada nos últimos 7 dias)"}`;
}

function dmhAbrirAba(){
  if(!irParaSecao("inicio")) return;
  document.querySelector('#dash-notebook button[data-tab="maquinas"]')?.click();
  $("dash-notebook")?.scrollIntoView({ behavior: "smooth" });
}
function dmhTelaCheia(){
  const el = $("dmh-painel");
  if(!el) return;
  if(document.fullscreenElement){ document.exitFullscreen?.(); return; }
  if(!el.requestFullscreen){ aviso("app-aviso", "Este navegador não permite tela cheia por aqui.", "aviso"); return; }
  el.requestFullscreen().catch(e => aviso("app-aviso", "Tela cheia indisponível: " + e.message, "erro"));
}
function dmhAoMudarTelaCheia(){
  const el = $("dmh-painel");
  if(!el) return;
  const cheia = document.fullscreenElement === el;
  el.classList.toggle("dmh-cheia", cheia);
  if($("dmh-tela-cheia")) $("dmh-tela-cheia").textContent = cheia ? "✕ Sair da tela cheia" : "⛶ Tela cheia";
  if(_dmhTimer){ clearInterval(_dmhTimer); _dmhTimer = null; }
  if(cheia){
    _dmhTimer = setInterval(() => { console.info(`Máquinas hoje: refresh automático em tela cheia (${_dmhRefreshS} s)`); dmhCarregar(); }, _dmhRefreshS * 1000);
    console.info(`Máquinas hoje: tela cheia ligada, refresh a cada ${_dmhRefreshS} s`);
  } else {
    console.info("Máquinas hoje: tela cheia desligada, refresh parado");
  }
}
function ligarDmh(){
  $("dmh-filtros")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tipo]");
    if(!b) return;
    _dmhTipo = b.dataset.tipo || "";
    document.querySelectorAll("#dmh-filtros [data-tipo]").forEach(x => x.classList.toggle("ativo", x === b));
    renderDmh();
  });
  $("dmh-busca")?.addEventListener("input", debounce(() => { _dmhBusca = $("dmh-busca").value || ""; renderDmh(); }, 150));
  $("dmh-atualizar")?.addEventListener("click", () => comBotaoTravado("dmh-atualizar", dmhCarregar));
  $("dmh-tela-cheia")?.addEventListener("click", dmhTelaCheia);
  document.addEventListener("fullscreenchange", dmhAoMudarTelaCheia);
  $("dmh-conteudo")?.addEventListener("click", (e) => {
    if(e.target.closest("a.link-obra")) return;
    const card = e.target.closest("[data-eqp]");
    if(card && irParaSecao("equipamentos") && typeof abrirEquipamento === "function") abrirEquipamento(card.dataset.eqp);
  });
}



async function dashCarregarRitmo(){
  const d = await dashLer("vw_sc_ritmo_maquina", q => q.select("equipamento_id,m_dia,dias_base,primeiro_dia,ultimo_dia").is("tipo_servico", null).is("faixa_diametro", null).not("equipamento_id", "is", null));
  if(!d) return;
  _dashRitmo = {};
  d.forEach(r => { _dashRitmo[r.equipamento_id] = r; });
}
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
    <thead><tr><th>Máquina</th><th>Situação</th><th>Obra</th><th>Último lançamento</th><th class="num" title="Metros perfurados por dia trabalhado, nos últimos dias com RDO finalizado (refuro conta)">Ritmo</th><th class="num">Período</th><th class="num">Mês</th><th class="num">Horímetro</th><th>Manutenção</th></tr></thead>
    <tbody>${lista.map(f => {
      const s = DASH_SITUACAO[f.situacao] || { label: f.situacao, cor: "cinza" };
      const per = prodPer[f.equipamento_id];
      const rit = _dashRitmo[f.equipamento_id];
      return `<tr class="linha-clicavel" data-eqp="${esc(f.equipamento_id)}">
        <td><strong>${esc(f.codigo || "—")}</strong> <span class="meta">${esc(f.nome || "")}</span></td>
        <td><span class="tag ${esc(s.cor)}">${esc(s.label)}</span>${f.situacao === "parada" && f.dias_sem_lancar != null ? ` <span class="meta">há ${esc(f.dias_sem_lancar)} d</span>` : ""}</td>
        <td>${f.obra_id ? linkObra(f.obra_id, f.obra_codigo || mapaObras[f.obra_id]) : '<span class="meta">—</span>'}</td>
        <td>${f.ultimo_lancamento ? `${dataBR(f.ultimo_lancamento)} <span class="meta">(${esc(f.dias_sem_lancar)} d)</span>` : '<span class="meta">nunca</span>'}</td>
        <td class="num">${rit ? `<span title="Base: ${esc(rit.dias_base)} dia(s) com RDO finalizado, de ${dataBR(rit.primeiro_dia)} a ${dataBR(rit.ultimo_dia)}">${num(rit.m_dia)} m/dia <span class="meta">(${esc(rit.dias_base)} d)</span></span>` : '<span class="meta">sem base</span>'}</td>
        <td class="num">${per ? `${num(per.m)} m · ${esc(per.e)} est.` : '<span class="meta">—</span>'}</td>
        <td class="num">${Number(f.metros_mes) > 0 ? `${num(f.metros_mes)} m · ${esc(f.estacas_mes)} est.` : '<span class="meta">—</span>'}</td>
        <td class="num">${f.horimetro != null ? num(f.horimetro) : '<span class="meta">—</span>'}</td>
        <td>${f.manut_vencidas ? `<span class="tag vermelho">${esc(f.manut_vencidas)} vencida(s)</span> ` : ""}${f.manut_abertas ? `<span class="meta">${esc(f.manut_abertas)} aberta(s)</span>` : '<span class="meta">—</span>'}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}


function dashObrasPin(){ try { return JSON.parse(localStorage.getItem("dash-obras-pin") || "[]"); } catch(_e) { return []; } }
function dashAlternarPin(id){
  const p = new Set(dashObrasPin());
  p.has(id) ? p.delete(id) : p.add(id);
  try { localStorage.setItem("dash-obras-pin", JSON.stringify([...p])); } catch(_e) {   }
  renderDashObrasAndamento();
}
async function dashCarregarObrasAndamento(){
  if(!_dashObrasAnd.length){
    const [d, mat] = await Promise.all([dashLer("vw_sc_obra_andamento", q => q.select("*"), "dash-obras-and"), dashLer("vw_sc_obra_material", q => q.select("*"))]);
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
    <thead><tr><th style="width:28px;"></th><th>Obra</th><th>Estacas exec. / prev.</th><th class="num">Faltam</th><th class="num">m/dia</th><th class="num" title="Soma do ritmo das máquinas em obra; sem máquina com histórico, a média da obra">Ritmo (máquinas)</th><th class="num">Produção ${esc(DASH_PERIODOS[_dashPeriodo])}</th><th title="Em dias úteis da obra: pula fim de semana e feriado">Previsão de término</th><th>Última atividade</th><th></th></tr></thead>
    <tbody>${lista.map(o => {
      const pct = Math.min(100, Number(o.percentual) || 0);
      const folga = o.folga_dias;
      return `<tr class="linha-clicavel" data-obra="${esc(o.obra_id)}">
        <td><button type="button" class="dash-pin${pins.has(o.obra_id) ? " ativo" : ""}" data-pin="${esc(o.obra_id)}" title="${pins.has(o.obra_id) ? "Desafixar" : "Fixar no topo"}">${pins.has(o.obra_id) ? "★" : "☆"}</button></td>
        <td><strong>${esc(o.codigo || "")}</strong> <span class="meta">${esc((o.nome || "").slice(0, 40))}</span></td>
        <td>${o.previstas > 0 ? `${esc(o.executadas)} / ${esc(o.previstas)} <span class="meta">(${num(pct)}%)</span><div class="dash-barra"><div style="width:${pct}%"></div></div>` : '<span class="meta">sem previstas</span>'}${o.refuradas ? ` <span class="meta">· ${esc(o.refuradas)} refurada(s)</span>` : ""}</td>
        <td class="num">${Number(o.faltam_estacas) > 0 || Number(o.faltam_metros) > 0 ? `${esc(o.faltam_estacas)} est.${Number(o.faltam_metros) > 0 ? ` · ${num(Math.round(o.faltam_metros))} m` : ""}` : '<span class="meta">—</span>'}</td>
        <td class="num">${o.m_dia != null && Number(o.m_dia) > 0 ? num(o.m_dia) : '<span class="meta">—</span>'}</td>
        <td class="num">${Number(o.m_dia_maquinas) > 0 ? `<span title="${esc(obrRitmoTitulo(o))}">${num(o.m_dia_maquinas)}${o.ritmo_origem === "obra" ? ' <span class="meta">(obra)</span>' : ""}</span>` : '<span class="meta">—</span>'}</td>
        <td class="num">${prodPer[o.obra_id] ? `${num(prodPer[o.obra_id])} m` : '<span class="meta">—</span>'}</td>
        <td>${o.previsao_termino ? `${dataBR(o.previsao_termino)}${folga != null ? ` <span class="tag ${folga < 0 ? "vermelho" : "verde"}">${folga < 0 ? Math.abs(folga) + " d atrasada" : esc(folga) + " d de folga"}</span>` : ""}` : `<span class="meta" title="${esc(obrSemPrevisaoTitulo(o))}">sem dados</span>`}</td>
        <td>${o.ultimo_rdo ? dataBR(o.ultimo_rdo) : '<span class="meta">sem RDO</span>'}${o.dias_sem_lancamento != null ? ` <span class="meta">(${esc(o.dias_sem_lancamento)} d)</span>` : ""}</td>
        <td>${o.parada ? '<span class="tag ambar">parada</span> ' : ""}${o.pronta_baixa ? '<span class="tag verde">pronta p/ baixa</span> ' : ""}${o.sem_previstas ? '<span class="tag cinza">sem previstas</span> ' : ""}${_dashObraMat[o.obra_id] ? `<span class="tag ambar" title="separações abertas no almoxarifado (fase 83)">material pedido (${esc(_dashObraMat[o.obra_id].itens_pendentes)})</span>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}


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
    <tbody>${linhas.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.nome)}</td><td class="num">${num(l.m)}</td><td class="num">${esc(l.e)}</td><td class="num">${esc(l.dias)}</td><td class="num">${num(l.dias ? l.m / l.dias : 0)}</td><td>${esc(l.maq)}</td></tr>`).join("")}</tbody>
  </table></div>`;
}


function ligarSalaDeComando(){
  const sec = $("sec-inicio");
  if(!sec || sec.dataset.ligado) return;
  sec.dataset.ligado = "1";
  $("dash-periodo")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-periodo]");
    if(!b || b.dataset.periodo === _dashPeriodo) return;
    _dashPeriodo = b.dataset.periodo;
    try { localStorage.setItem("dash-periodo", _dashPeriodo); } catch(_e) {   }
    carregarDashboard();
  });
  $("btn-dash-recarregar")?.addEventListener("click", () => comBotaoTravado("btn-dash-recarregar", () => { _dashObrasAnd = []; return carregarDashboard(); }));

  $("dash-acoes")?.addEventListener("click", (e) => { if(dashCliqueExplica(e, e.currentTarget)) return; const el = e.target.closest("[data-acao]"); if(el) dashAbrirAcao(_dashAcoes[Number(el.dataset.acao)]); });
  $("dash-fila")?.addEventListener("click", (e) => {
    if(dashCliqueExplica(e, e.currentTarget)) return;

    const ap = e.target.closest("[data-fila-aprovar]");
    if(ap){ e.stopPropagation(); comBotaoTravado(ap, () => dashAprovarChamadoFila(ap, _dashFila[Number(ap.dataset.filaAprovar)])); return; }

    const cf = e.target.closest("[data-fila-confirmar]");
    if(cf){ e.stopPropagation(); comBotaoTravado(cf, () => dashConfirmarChamadoFila(_dashFila[Number(cf.dataset.filaConfirmar)])); return; }
    const el = e.target.closest("[data-fila]"); if(el) dashAbrirAcao(_dashFila[Number(el.dataset.fila)]);
  });
  $("dash-regularizar")?.addEventListener("click", (e) => { if(dashCliqueExplica(e, e.currentTarget)) return; const el = e.target.closest("[data-reg]"); if(el) dashAbrirRegularizar(_dashReg[Number(el.dataset.reg)]); });
  $("dash-reg-visoes")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-reg-visao]");
    if(!b || b.classList.contains("ativo")) return;
    _dashRegVisao = b.dataset.regVisao;
    try { sessionStorage.setItem("dash-reg-visao", _dashRegVisao); } catch(_e) {   }
    dashRenderRegularizar();
    $("dash-reg-visoes")?.querySelector(".ativo")?.focus();
  });

  $("dash-faixa")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-explica-faixa]");
    if(!b) return;
    dashAlternarExplica(b, b.closest(".dash-card-rot"), e.currentTarget, dashExplicaFaixaHTML(b.dataset.explicaFaixa));
  });
  $("dash-mencoes")?.addEventListener("click", (e) => { const el = e.target.closest("[data-menc]"); if(el) dashAbrirMencao(_dashMencoes[Number(el.dataset.menc)]); });
  $("dash-seguranca")?.addEventListener("click", (e) => { const el = e.target.closest(".clicavel[data-seg]"); if(el) dashAbrirSeguranca(_dashSeg[Number(el.dataset.seg)]); });
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
  ligarDmh();
  $("dash-frota")?.addEventListener("click", (e) => {
    if(e.target.closest("a.link-obra")) return;
    const tv = e.target.closest("tr[data-vg]");
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




async function dashAbrirObra(obraId, tab){
  irParaSecao("obras");
  if(obraId && typeof abrirObra === "function"){
    await abrirObra(obraId);
    if(tab && typeof ativarTabObra === "function") ativarTabObra(tab);
  }
}
function dashAbrirMedicao(id){ irParaSecao("medicoes"); if(id && typeof abrirMedicao === "function") abrirMedicao(id); }
async function dashAbrirOrcamento(id, aba){
  irParaSecao("orcamentos");
  if(!id || typeof abrirOrcamento !== "function") return;
  await abrirOrcamento(id);
  if(aba && orcEditId === id && typeof ativarTabOrc === "function") ativarTabOrc(aba);
}
function dashAbrirContrato(id){ irParaSecao("contratos"); if(id && typeof abrirContrato === "function") abrirContrato(id); }
function dashIrObrasAtivas(){
  if(typeof _obrFiltroIds !== "undefined") _obrFiltroIds = null;
  irParaSecao("obras");
  const f = $("obr-f-status");
  if(f){ f.value = "em_andamento"; if(typeof renderObras === "function") renderObras(); }
}
function dashIrOrcamentos(){ irParaSecao("orcamentos"); }

function dashEhDiretoria(){
  return !!(usuarioAtual && ["diretor", "auditor"].includes(usuarioAtual.cargo));
}

function dashIrFinanceiro(){

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




async function carregarDashFinanceiro(){


  const [{ data: obrasAtivas }, { data: medsAprovadas }] = await Promise.all([
    sb.from("obras").select("id,financeiro:obras_financeiro(valor_contratado)").in("status", ["em_andamento","planejada","paralisada"]),
    sb.from("medicoes").select("valor_final,valor_medido").in("status",["aprovada","faturada","recebida"]).eq("em_revisao", false)
  ]);

  const contratado = (obrasAtivas||[]).reduce((s,o) => s + (Number(o.financeiro?.valor_contratado)||0), 0);
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




async function carregarDashOrcamentos(){
  const card = $("dash-card-orc");
  if(card) card.style.display = podeVerOrcamentos() ? "" : "none";
  if(!podeVerOrcamentos()) return;

  const { data: orcLinhas } = await sb.from("orcamentos").select("numero,numero_revisao,valor_total")
    .in("status",["rascunho","enviado","em_negociacao"]);
  const porNum = new Map();
  (orcLinhas||[]).forEach(o => {
    const a = porNum.get(o.numero);
    if(!a || (parseInt(o.numero_revisao,10)||0) > (parseInt(a.numero_revisao,10)||0)) porNum.set(o.numero, o);
  });
  const orcAbertos = [...porNum.values()];
  const cntOrcAbertos = orcAbertos.length;
  const n = $("dash-orc-abertos");
  if(n){ n.textContent = cntOrcAbertos || 0; n.classList.toggle("dash-num-vazio", !(cntOrcAbertos > 0)); }
  const valorOrcAbertos = (orcAbertos||[]).reduce((s,o) => s + (Number(o.valor_total)||0), 0);

  const semValores = !!(usuarioAtual && usuarioAtual.cargo === "financeiro");
  if($("dash-orc-sub")) $("dash-orc-sub").textContent = semValores ? `${cntOrcAbertos || 0} em negociação` : `${brl(valorOrcAbertos)} em pipeline`;
}




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




async function carregarDashTopObras(){
  const cont = $("dash-top-obras");
  if(!cont) return;
  const mostraValor = dashEhDiretoria();
  const tit = $("dash-top-obras-titulo");
  if(tit) tit.textContent = mostraValor ? "📈 Top 5 obras (valor)" : "📈 Obras ativas";


  const ATIVAS = ["em_andamento","planejada","paralisada"];
  let data;
  if(mostraValor){
    const r = await sb.from("obras_financeiro").select("valor_contratado,obra:obras(id,codigo,nome,status)");
    data = (r.data||[]).filter(f => f.obra && ATIVAS.includes(f.obra.status)).map(f => ({ ...f.obra, valor: Number(f.valor_contratado)||0 }))
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
      ${mostraValor ? `<strong style="color:var(--sucesso-txt);">${brl(o.valor)}</strong>` : ""}
    </div>`).join("")}</div>`;
  cont.querySelectorAll(".dash-linha-obra[data-obra-id]").forEach(el => {
    el.addEventListener("click", () => dashAbrirObra(el.dataset.obraId));
  });
}




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

    (profs||[]).forEach(p => { mapaU[p.id] = esc(p.nome); });
  }
  const nomeDe = (uid) => uid ? (esc(mapaU[uid] || "usuário")) : "sistema";

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
      <span style="color:var(--txt-sutil);font-size:var(--txt-xs);">${hora}</span> · ${  e.txt}
    </div>`;
  }).join("")}</div>`;
  cont.querySelectorAll(".dash-ativ-item[data-idx]").forEach(el => {
    el.addEventListener("click", () => {
      const e = vis[Number(el.dataset.idx)];
      if(e && e.obraId) dashAbrirObra(e.obraId, e.tab);
    });
  });
}




async function carregarPosicaoEstoque(){
  const tb = $("tab-estoque");
  if(!tb) return;

  const { data } = await sb.from("produtos").select("codigo,nome,estoque_atual,estoque_minimo,custo_ultimo").eq("ativo", true).order("nome").limit(200);
  const lista = data || [];
  if(!lista.length){ tb.innerHTML = `<tr><td colspan="5" class="vazio">Nenhum produto.</td></tr>`; return; }
  tb.innerHTML = lista.map(p => `<tr>
    <td>${esc(p.codigo)}</td><td>${esc(p.nome)}</td>
    <td>${num(p.estoque_atual)}</td><td>${brl(p.custo_ultimo)}</td>
    <td>${brl(Number(p.estoque_atual)*Number(p.custo_ultimo))}</td></tr>`).join("");
}






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

  const leit   = linhas.filter(l => l.funcao !== "assistente");
  const ast    = linhas.filter(l => l.funcao === "assistente");
  const custoAst = ast.reduce((s, l) => s + Number(l.custo_usd || 0), 0);
  const ok     = leit.filter(l => l.status === "ok").length;
  const erros  = linhas.filter(l => l.status !== "ok").length;
  const rdo    = linhas.filter(l => l.funcao === "extrair-rdo-arquivo" && l.status === "ok").length;
  const est    = linhas.filter(l => l.funcao === "extrair-estacas-pdf" && l.status === "ok").length;
  const tokens = linhas.reduce((s, l) => s + Number(l.tokens_input || 0) + Number(l.tokens_output || 0), 0);
  elNum.textContent = "US$ " + custo.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  elNum.classList.toggle("dash-num-vazio", !(linhas.length > 0));
  elSub.textContent = linhas.length
    ? `${ok} leitura(s): ${rdo} RDO · ${est} plantas${ast.length ? ` · assistente US$ ${custoAst.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}${erros ? ` · ${erros} erro(s)` : ""} · ${num(Math.round(tokens / 1000))} mil tokens`
    : "nenhuma leitura este mês";
}

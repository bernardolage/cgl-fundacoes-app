/* ====================================================================
   Módulo: Pedidos do site (fase 195c) — prefixo psi-
   1. Aba "Pedidos do site" em Orçamentos: os pedidos que chegam pelo chat do site (site_pedidos, fase 195a), com o
      prazo prometido ao cliente em contagem regressiva, filtros, ficha com as respostas e os anexos (bucket privado
      site-pedidos, por URL assinada), "Criar orçamento", "Descartar" e "Marcar spam".
   2. KPIs do tempo até formalizar (vw_site_pedidos_tempo): mediana e 90% em horas úteis até a primeira proposta
      enviada, % do selo cumprido, recebidos e % que virou orçamento, contra os 30 dias anteriores.
   3. "Enviar pelo WhatsApp" na ficha do orçamento: baixa o PDF da proposta (o mesmo do envio pela orcamento@), abre o
      wa.me com a mensagem padrão e, se o comercial confirmar, registra o envio (registrar_envio_whatsapp).
   Leitura: pode_ler_comercial() no banco (psiPodeLer no front). Mudar status e criar orçamento: quem edita orçamento.
   A pendência da tela inicial vem de vw_sc_acoes_psi (js/dashboard.js).
   ==================================================================== */

/* Mensagem padrão do WhatsApp que acompanha a proposta (dado 6 da spec; rascunho para o Bernardo aprovar no PR).
   Mesmo tom do e-mail da orcamento@ (fase 192). Marcas trocadas na hora:
   {saudacao} = "Bom dia, Fulano!" (ou "Boa tarde!" sem nome); {proposta} = "a proposta comercial 8833/2026" ou
   "a proposta revisada 8833/2026 Rev 01"; {para_obra} = " para <obra ou cidade>" (vazio quando o orçamento não diz). */
const PSI_WHATSAPP_MSG = [
  "{saudacao}",
  "",
  "Conforme solicitado, segue em anexo {proposta} da CGL Fundações{para_obra}.",
  "",
  "Qualquer dúvida, estamos à disposição por aqui.",
  "",
  "Atenciosamente,",
  "Comercial CGL Fundações"
].join("\n");

const PSI_BUCKET = "site-pedidos";
const PSI_SERVICO = { helice: "Hélice contínua", raiz: "Estaca raiz", secante: "Hélice secante", trado: "Trado mecanizado",
  pre_moldada: "Pré-moldada", bomba: "Locação de bomba de concreto", compressor_gerador: "Locação de compressor ou gerador",
  nao_sei: "Ainda não sabe" };
const PSI_TIPO = { concorrencia: "Concorrência", cotacao: "Cotação / estimativa", contratacao: "Obra confirmada" };
const PSI_SEGMENTO = { industrial: "Industrial ou mineração", comercial: "Comercial ou residencial", infraestrutura: "Infraestrutura",
  casa: "Casa", nao_sei: "Não sabe" };
const PSI_INICIO = { ate_30_dias: "Em até 30 dias", "1_a_3_meses": "De 1 a 3 meses", mais_3_meses: "Mais de 3 meses",
  data: "Data definida", sem_previsao: "Sem previsão" };
const PSI_SOLICITANTE = { dono: "Dono da obra", construtora: "Construtora", projetista: "Projetista ou consultor", outro: "Outro" };
const PSI_CANAL = { whatsapp: "WhatsApp", email: "E-mail", ambos: "WhatsApp e e-mail" };
const PSI_ANEXO = { ficha_cadastral: "Ficha cadastral", sondagem: "Sondagem", projeto: "Projeto" };
const PSI_FALTOU = { servico: "serviço", ficha_cadastral: "ficha cadastral", projeto: "projeto (ou quantidade, diâmetro e profundidade)",
  tipo_obra: "tipo de obra", equipamento: "equipamento", periodo: "período", operador: "operador", volume: "volume de concreto",
  tipo_pedido: "tipo do pedido", cidade: "cidade", inicio: "início da obra", contato: "contato" };
/* rótulos das respostas: os mesmos da site-orcamento (supabase/functions/site-orcamento/nucleo.mjs) */
const PSI_RESPOSTA = { F1a: "Empresa ou planta", F1b: "Exige integração de segurança", F1c: "Horário restrito, noite ou fim de semana",
  F2: "Quantidade de estacas", F3: "Diâmetro (mm)", F4: "Profundidade média", F5: "Projeto", F6: "Sondagem",
  F6a: "SPT acima de 35 ou rocha", F7: "Terreno pronto", F8: "Restrições no local", L1: "Equipamento", L2: "Período",
  L2n: "Período (número)", L3: "Com operador", L4: "Volume de concreto (m³)", N1: "O que vai construir", C6: "Observação" };
const PSI_VALOR = { sim: "Sim", nao: "Não", nao_sei: "Não sabe", ate_20: "até 20", "21_100": "21 a 100", "101_300": "101 a 300",
  mais_300: "mais de 300", ate_10: "até 10 m", "10_20": "10 a 20 m", "20_30": "20 a 30 m", mais_30: "mais de 30 m",
  em_elaboracao: "Em elaboração", nao_existe: "Não existe ainda", pe_direito: "Pé-direito baixo ou área coberta",
  vibracao: "Vizinho sensível a vibração ou barulho", espaco: "Espaço apertado", nenhuma: "Nenhuma", compressor: "Compressor",
  gerador: "Gerador", ambos: "Os dois", dias: "Alguns dias", semanas: "Semanas", meses: "Meses" };
/* status na lista: a cor sai desta lista fechada, nunca do banco */
const PSI_STATUS = { novo: ["Novo", "ambar"], em_analise: ["Em análise", "azul"], virou_orcamento: ["Orçamento criado", "azul"],
  descartado: ["Descartado", "cinza"], spam: ["Spam", "cinza"], formalizado: ["Proposta enviada", "verde"] };
const PSI_FILTRO_STATUS = [["abertos", "A formalizar"], ["formalizados", "Proposta enviada"], ["descartado", "Descartados"], ["spam", "Spam"]];
const PSI_ABERTOS = ["novo", "em_analise", "virou_orcamento"];
const PSI_COLS = "id,protocolo,status,enviado_em,servico,tipo_pedido,data_entrega_proposta,segmento,cidade,uf,inicio_previsto," +
  "inicio_mes,nome,empresa,canal_proposta,selo_mesmo_dia,prazo_prometido,orcamento_id,site_pedido_anexos(count)";
const PSI_COLS_TEMPO = "id,orcamento_numero,orcamento_criado_em,proposta_enviada_em,proposta_canal,formalizado," +
  "horas_uteis_orcamento,horas_uteis_proposta,horas_corridas_proposta,cumpriu_prazo";

let _psiRegistros = [];   // pedidos enviados (site_pedidos) com o tempo da vw_site_pedidos_tempo em ._t
let _psiErro = null;      // mensagem do erro da última leitura
let _psiCarregado = false;
let _psiFiltro = { status: "abertos", tipo: "", busca: "" };
let _psiPendente = null;  // pedido do "Criar orçamento" até o orçamento ser salvo: { id, protocolo, whatsapp }
let _psiRelogio = null;

/* ---------------------------------------------------------------- acesso */
/* espelha pode_ler_comercial() do banco: comercial, financeiro, auditor, diretor (has_role) e o módulo extra "orcamentos" */
function psiPodeLer(){
  if(!usuarioAtual) return false;
  return ["diretor", "comercial", "financeiro", "auditor"].includes(usuarioAtual.cargo) || temModuloExtra("orcamentos");
}
/* mudar status e criar orçamento: quem grava orçamento (orcPodeEditar: diretor, comercial, extra "orcamentos"; nunca o auditor) */
function psiPodeOperar(){ return typeof orcPodeEditar === "function" && orcPodeEditar(); }

/* ---------------------------------------------------------------- formatação */
const psiRot = (mapa, v) => (v != null && v !== "" ? (mapa[v] || String(v)) : "");
function psiDataHora(iso){ return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""; }
function psiHoras(h){
  if(h == null || !Number.isFinite(Number(h))) return null;
  return Number(h).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " h";
}
function psiDuracao(ms){
  const min = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if(d) return `${d} d ${h} h`;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
/* número de WhatsApp: 55 + DDD + número (10 ou 11 dígitos), ou null */
function psiNormalizarWhatsapp(v){
  let d = String(v || "").replace(/\D/g, "");
  if(d.length === 10 || d.length === 11) d = "55" + d;
  return /^55\d{10,11}$/.test(d) ? d : null;
}
/* "5531999990000" -> "(31) 99999-0000" */
function psiFoneBR(v){
  const d = String(v || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if(d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if(d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v || "");
}
function psiValorResposta(chave, v){
  if(v == null || v === "") return "";
  if(Array.isArray(v)) return v.map(x => psiValorResposta(chave, x)).join(", ");
  if(typeof v === "boolean") return v ? "Sim" : "Não";
  if(typeof v === "number") return chave === "F4" ? `${v.toLocaleString("pt-BR")} m` : v.toLocaleString("pt-BR");
  return PSI_VALOR[v] || String(v);
}
function psiTamanho(n){
  if(n == null) return "";
  return n >= 1048576 ? (n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}
const psiAberto = (p) => PSI_ABERTOS.includes(p.status) && !(p._t && p._t.formalizado);

/* prazo prometido: texto e tom da contagem regressiva (pedido sem selo: "2 dias úteis", sem contagem) */
function psiPrazo(p, agora){
  if(!p.selo_mesmo_dia || !p.prazo_prometido) return { texto: "Sem selo · 2 dias úteis", tom: "neutro" };
  const prazo = new Date(p.prazo_prometido).getTime();
  const quando = dataHoraBR(p.prazo_prometido);
  if(p._t && p._t.formalizado){
    return p._t.cumpriu_prazo ? { texto: `Cumprido · ${quando}`, tom: "ok" } : { texto: `Fora do prazo · ${quando}`, tom: "perigo" };
  }
  if(!PSI_ABERTOS.includes(p.status)) return { texto: quando, tom: "neutro" };
  const falta = prazo - (agora || Date.now());
  if(falta < 0) return { texto: `Vencido há ${psiDuracao(falta)} · ${quando}`, tom: "perigo" };
  return { texto: `Faltam ${psiDuracao(falta)} · ${quando}`, tom: falta < 2 * 3600000 ? "aviso" : "info" };
}
function psiPrazoHTML(p, agora){
  const r = psiPrazo(p, agora);
  return `<span class="psi-prazo ${uiTom(r.tom)}" data-psi-prazo="${esc(p.id)}">${esc(r.texto)}</span>`;
}
function psiStatusHTML(p){
  const k = p._t && p._t.formalizado ? "formalizado" : p.status;
  const s = PSI_STATUS[k] || [p.status || "—", "cinza"];
  return `<span class="tag ${esc(s[1])}">${esc(s[0])}</span>`;
}
function psiConcorrencia(p){
  if(p.tipo_pedido !== "concorrencia" || !p.data_entrega_proposta) return "";
  const dias = Math.round((new Date(p.data_entrega_proposta + "T12:00:00") - new Date(hojeISO() + "T12:00:00")) / 86400000);
  const quando = dias < 0 ? `venceu há ${-dias} d` : dias === 0 ? "hoje" : `em ${dias} d`;
  return `${dataBR(p.data_entrega_proposta)} (${quando})`;
}
function psiInicio(p){
  if(p.inicio_previsto === "data" && p.inicio_mes){ const x = String(p.inicio_mes).slice(0, 7).split("-"); return `${x[1]}/${x[0]}`; }
  return psiRot(PSI_INICIO, p.inicio_previsto);
}
const psiNumAnexos = (p) => Number(p.site_pedido_anexos && p.site_pedido_anexos[0] && p.site_pedido_anexos[0].count) || 0;

/* ordem da fila: selo com o prazo mais perto; concorrência com entrega em até 3 dias; o resto, do mais novo ao mais antigo */
function psiGrupoOrdem(p){
  if(!psiAberto(p)) return 2;
  if(p.selo_mesmo_dia && p.prazo_prometido) return 0;
  if(p.tipo_pedido === "concorrencia" && p.data_entrega_proposta && p.data_entrega_proposta <= addDiasISO(3)) return 1;
  return 2;
}
function psiOrdenar(lista){
  return lista.slice().sort((a, b) => {
    const ga = psiGrupoOrdem(a), gb = psiGrupoOrdem(b);
    if(ga !== gb) return ga - gb;
    if(ga === 0) return String(a.prazo_prometido).localeCompare(String(b.prazo_prometido));
    if(ga === 1) return String(a.data_entrega_proposta).localeCompare(String(b.data_entrega_proposta));
    return String(b.enviado_em || "").localeCompare(String(a.enviado_em || ""));
  });
}
function psiFiltrados(){
  const f = _psiFiltro, q = f.busca.trim().toLowerCase();
  return _psiRegistros.filter(p => {
    if(f.status === "abertos" && !psiAberto(p)) return false;
    if(f.status === "formalizados" && !(p._t && p._t.formalizado)) return false;
    if((f.status === "descartado" || f.status === "spam") && p.status !== f.status) return false;
    if(f.tipo && p.tipo_pedido !== f.tipo) return false;
    if(q && ![p.protocolo, p.nome, p.empresa, p.cidade, p.uf].some(x => String(x || "").toLowerCase().includes(q))) return false;
    return true;
  });
}

/* ---------------------------------------------------------------- KPIs */
function psiMediana(v){ return psiPercentil(v, 0.5); }
function psiPercentil(v, p){
  const s = v.filter(x => x != null && Number.isFinite(Number(x))).map(Number).sort((a, b) => a - b);
  if(!s.length) return null;
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
function psiIndicadores(lista){
  const ok = lista.filter(p => p.status !== "spam");
  const horas = ok.map(p => p._t && p._t.horas_uteis_proposta).filter(h => h != null);
  const selo = ok.filter(p => p.selo_mesmo_dia);
  const seloAval = selo.filter(p => p._t && p._t.cumpriu_prazo != null);
  return {
    recebidos: ok.length,
    viraram: ok.filter(p => p.orcamento_id).length,
    propostas: horas.length,
    mediana: psiMediana(horas),
    p90: psiPercentil(horas, 0.9),
    selo: selo.length,
    seloAval: seloAval.length,
    seloOk: seloAval.filter(p => p._t.cumpriu_prazo).length
  };
}
const psiFrac = (a, b) => (b ? a / b : null);
function psiDelta(atual, ant){ return atual == null || ant == null || !ant ? null : (atual - ant) / ant; }
function psiKpisHTML(){
  const rot = ["Até a proposta (mediana)", "90% dos pedidos até", "Selo cumprido", "Recebidos", "Viraram orçamento"];
  if(_psiErro) return `<div class="ui-kpis psi-kpis">${rot.map(r => uiKpi(null, r, "", { erro: _psiErro })).join("")}</div>`;
  const agora = Date.now(), d30 = agora - 30 * 86400000, d60 = agora - 60 * 86400000;
  const t = (p) => new Date(p.enviado_em).getTime();
  const atual = psiIndicadores(_psiRegistros.filter(p => t(p) >= d30));
  const ant = psiIndicadores(_psiRegistros.filter(p => t(p) >= d60 && t(p) < d30));
  const cmp = (a, b, melhor) => { const d = psiDelta(a, b); return d == null ? null : { delta: d, texto: "vs 30 dias anteriores", melhor }; };
  const pctSelo = psiFrac(atual.seloOk, atual.seloAval), pctSeloAnt = psiFrac(ant.seloOk, ant.seloAval);
  const pctVir = psiFrac(atual.viraram, atual.recebidos), pctVirAnt = psiFrac(ant.viraram, ant.recebidos);
  const n90 = atual.p90 == null ? null : Math.ceil(atual.p90);
  const ctx90 = atual.selo >= 30 && n90 != null
    ? `Frase para o site: "em até ${n90} horas úteis"`
    : `${atual.propostas} proposta(s) nos últimos 30 dias`;
  return `<div class="ui-kpis psi-kpis">${/* html */ [
    uiKpi(psiHoras(atual.mediana), rot[0], "horas úteis, últimos 30 dias", cmp(atual.mediana, ant.mediana, "menor")),
    uiKpi(psiHoras(atual.p90), rot[1], ctx90, cmp(atual.p90, ant.p90, "menor")),
    uiKpi(pctSelo == null ? null : Math.round(pctSelo * 100) + "%", rot[2], `${atual.seloOk} de ${atual.seloAval} no prazo (últimos 30 dias)`, cmp(pctSelo, pctSeloAnt, "maior")),
    uiKpi(String(atual.recebidos), rot[3], "últimos 30 dias, sem spam", cmp(atual.recebidos, ant.recebidos, "maior")),
    uiKpi(pctVir == null ? null : Math.round(pctVir * 100) + "%", rot[4], `${atual.viraram} de ${atual.recebidos}`, cmp(pctVir, pctVirAnt, "maior"))
  ].join("")}</div>`;
}

/* ---------------------------------------------------------------- aba na tela de Orçamentos */
/* chamada pelo renderOrcamentos (js/orcamentos.js): mostra ou esconde a aba e carrega quando ela abre */
function psiMostrarAba(ativa){
  const pode = psiPodeLer();
  const btn = $("orc-view-psi");
  if(btn) btn.hidden = !pode;
  const naAba = !!ativa && pode;
  ["orc-filtros", "orc-conteudo", "orc-contador"].forEach(id => { const el = $(id); if(el) el.hidden = naAba; });
  const cont = $("psi-conteudo");
  if(cont) cont.hidden = !naAba;
  if(naAba) carregarPedidosSite();
  else psiPararRelogio();
}
/* contador no botão da aba: pedidos novos ou em análise (o banco só devolve a quem lê comercial) */
async function psiAtualizarBadge(){
  const b = $("psi-badge");
  if(!b || !psiPodeLer()) return;
  const { count, error } = await sb.from("site_pedidos").select("id", { count: "exact", head: true }).in("status", ["novo", "em_analise"]);
  b.textContent = !error && count ? String(count) : "";
}

async function carregarPedidosSite(){
  const cont = $("psi-conteudo");
  if(!cont || !psiPodeLer()) return;
  if(!_psiCarregado) cont.innerHTML = uiCarregando("Carregando os pedidos do site…");
  const [ped, tempo] = await Promise.all([
    lerTudo(() => sb.from("site_pedidos").select(PSI_COLS).neq("status", "rascunho")),
    lerTudo(() => sb.from("vw_site_pedidos_tempo").select(PSI_COLS_TEMPO))
  ]);
  _psiCarregado = true;
  if(ped.error){ _psiErro = "Não foi possível ler os pedidos do site: " + ped.error.message; _psiRegistros = []; }
  else {
    _psiErro = null;
    const porId = {};
    (tempo.error ? [] : tempo.data || []).forEach(t => { porId[t.id] = t; });
    _psiRegistros = (ped.data || []).map(p => ({ ...p, _t: porId[p.id] || null }));
    if(tempo.error) console.warn("Pedidos do site: vw_site_pedidos_tempo indisponível:", tempo.error.message);
  }
  const b = $("psi-badge");
  if(b && !_psiErro){ const n = _psiRegistros.filter(p => p.status === "novo" || p.status === "em_analise").length; b.textContent = n ? String(n) : ""; }
  renderPedidosSite();
}

function renderPedidosSite(){
  const cont = $("psi-conteudo");
  if(!cont) return;
  const focoBusca = document.activeElement && document.activeElement.id === "psi-busca";
  const lista = _psiErro ? [] : psiOrdenar(psiFiltrados());
  const agora = Date.now();
  const colunas = [
    { chave: "protocolo", rotulo: "Protocolo", html: p => `${uiCodigo(p.protocolo || "—")}${p.selo_mesmo_dia ? ' <span class="tag verde" title="Pedido completo: o cliente recebeu a promessa de proposta no mesmo dia">Mesmo dia</span>' : ""}` },
    { chave: "enviado_em", rotulo: "Recebido em", html: p => esc(dataHoraBR(p.enviado_em)) },
    { chave: "prazo_prometido", rotulo: "Prazo prometido", html: p => psiPrazoHTML(p, agora) },
    { chave: "servico", rotulo: "Serviço", html: p => esc(psiRot(PSI_SERVICO, p.servico) || "—") },
    { chave: "tipo_pedido", rotulo: "Tipo do pedido", html: p => esc(psiRot(PSI_TIPO, p.tipo_pedido) || "—") },
    { chave: "data_entrega_proposta", rotulo: "Prazo da concorrência", html: p => esc(psiConcorrencia(p) || "—") },
    { chave: "segmento", rotulo: "Segmento", html: p => esc(psiRot(PSI_SEGMENTO, p.segmento) || "—") },
    { chave: "cidade", rotulo: "Cidade/UF", html: p => esc([p.cidade, p.uf].filter(Boolean).join("/") || "—") },
    { chave: "inicio_previsto", rotulo: "Início", html: p => esc(psiInicio(p) || "—") },
    { chave: "anexos", rotulo: "Anexos", tipo: "int", html: p => esc(String(psiNumAnexos(p))) },
    { chave: "status", rotulo: "Status", html: p => psiStatusHTML(p) }
  ];
  const fs = _psiFiltro;
  const rotStatus = (PSI_FILTRO_STATUS.find(x => x[0] === fs.status) || [])[1] || "";
  cont.innerHTML = `<div class="psi-painel">
    ${/* html */ psiKpisHTML()}
    <div class="psi-controles">
      ${/* html */ uiCampo({ id: "psi-f-status", rotulo: "Status", tipo: "select", placeholder: "Todos", valor: fs.status, opcoes: PSI_FILTRO_STATUS })}
      ${/* html */ uiCampo({ id: "psi-f-tipo", rotulo: "Tipo do pedido", tipo: "select", placeholder: "Todos os tipos", valor: fs.tipo, opcoes: Object.entries(PSI_TIPO) })}
    </div>
    ${/* html */ uiFiltros({ id: "psi-busca", busca: fs.busca, placeholder: "Buscar protocolo, nome, empresa ou cidade",
      filtros: [{ id: "status", rotulo: "Status", valor: rotStatus }, { id: "tipo", rotulo: "Tipo", valor: psiRot(PSI_TIPO, fs.tipo) }],
      total: _psiErro ? null : lista.length, unidade: ["pedido", "pedidos"], erro: _psiErro })}
    <div class="psi-tabela">${/* html */ uiTabela({ colunas, linhas: lista, chaveLinha: "id", erro: _psiErro,
      vazio: fs.status === "abertos" ? "Nenhum pedido do site esperando proposta." : "Nenhum pedido do site neste filtro." })}</div>
  </div>`;
  if(focoBusca){ const i = $("psi-busca"); if(i){ i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  psiLigarRelogio();
}

/* a contagem regressiva anda sozinha a cada minuto enquanto a aba está aberta (só troca o texto dos prazos) */
function psiLigarRelogio(){
  if(_psiRelogio) return;
  _psiRelogio = setInterval(() => {
    const cont = $("psi-conteudo");
    if(!cont || cont.hidden || !cont.offsetParent){ psiPararRelogio(); return; }
    const agora = Date.now();
    cont.querySelectorAll("[data-psi-prazo]").forEach(el => {
      const p = _psiRegistros.find(x => x.id === el.dataset.psiPrazo);
      if(!p) return;
      const r = psiPrazo(p, agora);
      el.textContent = r.texto;
      el.className = "psi-prazo " + uiTom(r.tom);
    });
  }, 60000);
}
function psiPararRelogio(){ if(_psiRelogio){ clearInterval(_psiRelogio); _psiRelogio = null; } }

/* ---------------------------------------------------------------- ficha do pedido */
async function abrirPedidoSite(id){
  if(!id || !psiPodeLer()) return;
  const [{ data: p, error }, anx] = await Promise.all([
    sb.from("site_pedidos").select("*").eq("id", id).single(),
    sb.from("site_pedido_anexos").select("id,tipo,caminho,nome_original,extensao,tamanho").eq("pedido_id", id).order("tipo").order("criado_em")
  ]);
  if(error || !p){ uiAvisar("Não foi possível abrir o pedido: " + (error ? error.message : "não encontrado"), "perigo"); return; }
  const local = _psiRegistros.find(x => x.id === id);
  p._t = local ? local._t : null;
  // primeira abertura por quem opera: o pedido sai de "novo" (deixa de contar como "sem resposta" na tela inicial)
  if(p.status === "novo" && psiPodeOperar()){
    const { data: dSt, error: eSt } = await sb.from("site_pedidos").update({ status: "em_analise", atualizado_em: new Date().toISOString() }).eq("id", id).eq("status", "novo").select("id");
    if(!eSt && dSt && dSt.length){ p.status = "em_analise"; if(local) local.status = "em_analise"; }
  }
  const anexos = anx.error ? null : (anx.data || []);
  const aberto = psiAberto(p);
  const pode = psiPodeOperar();
  const acoes = [{ id: "fechar", texto: "Fechar" }];
  if(pode && p.status !== "spam") acoes.unshift({ id: "spam", texto: "Marcar spam", perigo: true });
  if(pode && aberto && p.status !== "virou_orcamento") acoes.unshift({ id: "descartar", texto: "Descartar" });
  if(pode && aberto && !p.orcamento_id) acoes.push({ id: "criar", texto: "Criar orçamento", primaria: true });
  if(p.orcamento_id) acoes.push({ id: "abrir_orc", texto: "Abrir orçamento", primaria: true });
  const acao = await uiModal({ titulo: `Pedido do site ${p.protocolo || ""}`, corpoHTML: psiFichaHTML(p, anexos, anx.error), largura: "g", acoes });
  if(acao === "criar") await psiCriarOrcamento(p, anexos || []);
  else if(acao === "abrir_orc" && p.orcamento_id && typeof abrirOrcamento === "function"){ mostrarPainelOrc(); await abrirOrcamento(p.orcamento_id); }
  else if(acao === "descartar") await psiMudarStatus(p, "descartado");
  else if(acao === "spam") await psiMudarStatus(p, "spam");
  else if(local) renderPedidosSite();   // o status pode ter mudado para "em análise"
}

function psiFichaHTML(p, anexos, erroAnexos){
  const rv = (r, v) => uiRotuloValor(r, v == null || v === "" ? "" : esc(v));
  const prazo = psiPrazo(p);
  const faixa = uiFaixaSituacao([
    (PSI_STATUS[p._t && p._t.formalizado ? "formalizado" : p.status] || [p.status])[0],
    p.selo_mesmo_dia ? `Prazo prometido: ${prazo.texto}` : "Sem selo: retorno prometido em até 2 dias úteis",
    p.canal_proposta ? `Proposta por ${psiRot(PSI_CANAL, p.canal_proposta)}` : ""
  ], prazo.tom === "neutro" ? "info" : prazo.tom);
  const pedido = `<div class="psi-grade">
    ${/* html */ uiRotuloValor("Protocolo", uiCodigo(p.protocolo || "—"))}
    ${/* html */ rv("Recebido em", psiDataHora(p.enviado_em))}
    ${/* html */ rv("Serviço", psiRot(PSI_SERVICO, p.servico))}
    ${/* html */ rv("Tipo do pedido", psiRot(PSI_TIPO, p.tipo_pedido))}
    ${p.tipo_pedido === "concorrencia" ? rv("Entregar a proposta até", psiConcorrencia(p)) : ""}
    ${p.licitacao_publica != null ? rv("Licitação pública", p.licitacao_publica ? `Sim${p.edital ? " · edital " + p.edital : ""}` : "Não") : ""}
    ${/* html */ rv("Quem pede", psiRot(PSI_SOLICITANTE, p.solicitante_tipo))}
    ${/* html */ rv("Tipo de obra", psiRot(PSI_SEGMENTO, p.segmento))}
    ${/* html */ rv("Cidade/UF", [p.cidade, p.uf].filter(Boolean).join("/"))}
    ${/* html */ rv("Início", psiInicio(p))}
  </div>`;
  const contato = `<div class="psi-grade">
    ${/* html */ rv("Nome", p.nome)}
    ${/* html */ rv("Empresa", p.empresa)}
    ${/* html */ uiRotuloValor("CNPJ", p.cnpj ? uiCodigo(typeof _orcCliMascara === "function" ? _orcCliMascara(p.cnpj) : p.cnpj) : "")}
    ${/* html */ rv("E-mail", p.email)}
    ${/* html */ rv("Telefone", psiFoneBR(p.telefone))}
    ${/* html */ rv("WhatsApp", psiFoneBR(p.whatsapp))}
    ${/* html */ rv("Receber a proposta por", psiRot(PSI_CANAL, p.canal_proposta))}
  </div>`;
  const resp = p.respostas && typeof p.respostas === "object" ? p.respostas : {};
  const chaves = Object.keys(PSI_RESPOSTA).filter(k => resp[k] != null && resp[k] !== "")
    .concat(Object.keys(resp).filter(k => !PSI_RESPOSTA[k] && resp[k] != null && resp[k] !== ""));
  const respostas = chaves.length
    ? `<div class="psi-grade">${chaves.map(k => uiRotuloValor(PSI_RESPOSTA[k] || k, esc(psiValorResposta(k, resp[k])))).join("")}</div>`
    : uiVazio("Sem respostas além das do pedido.");
  const faltou = (p.selo_faltou || []).map(f => PSI_FALTOU[f] || f);
  const selo = p.selo_mesmo_dia
    ? uiLinhaItem("Com selo: proposta prometida até o prazo", `Prazo ${psiDataHora(p.prazo_prometido)}`, "", "")
    : uiLinhaItem("Sem selo", faltou.length ? "Faltou: " + faltou.join(", ") : "Selo desligado no site ou pedido marcado como spam", "", "");
  const listaAnexos = erroAnexos ? uiErro("Não foi possível ler os anexos: " + erroAnexos.message)
    : !anexos.length ? uiVazio("O cliente não mandou anexo.")
    : `<ul class="psi-anexos">${anexos.map(a => `<li><button type="button" class="ui-btn psi-anexo" data-psi-anexo="${esc(a.caminho)}" title="Abre o arquivo numa aba nova (link válido por 10 minutos)">${esc(PSI_ANEXO[a.tipo] || a.tipo)}: ${esc(a.nome_original)}</button> <span class="meta">${esc(String(a.extensao || "").toUpperCase())}${a.tamanho ? " · " + esc(psiTamanho(a.tamanho)) : ""}</span></li>`).join("")}</ul>`;
  const t = p._t;
  const tempo = !t ? uiVazio("Ainda sem orçamento.")
    : `<div class="psi-grade">
      ${/* html */ rv("Orçamento", t.orcamento_numero || "")}
      ${/* html */ rv("Orçamento criado em", psiDataHora(t.orcamento_criado_em))}
      ${/* html */ rv("Até o orçamento", psiHoras(t.horas_uteis_orcamento) ? psiHoras(t.horas_uteis_orcamento) + " úteis" : "")}
      ${/* html */ rv("Primeira proposta enviada", t.proposta_enviada_em ? `${psiDataHora(t.proposta_enviada_em)} · ${t.proposta_canal === "whatsapp" ? "WhatsApp" : "E-mail"}` : "")}
      ${/* html */ rv("Até a proposta", psiHoras(t.horas_uteis_proposta) ? `${psiHoras(t.horas_uteis_proposta)} úteis (${psiHoras(t.horas_corridas_proposta)} corridas)` : "")}
    </div>`;
  return `<div class="psi-ficha">
    ${/* html */ faixa}
    ${/* html */ uiSecao("documento", "Pedido", pedido)}
    ${/* html */ uiSecao("equipe", "Contato", contato)}
    ${/* html */ uiSecao("nota", "Respostas", respostas, chaves.length ? String(chaves.length) : "")}
    ${/* html */ uiSecao("check", "Mesmo dia", selo)}
    ${/* html */ uiSecao("documento", "Anexos", listaAnexos, anexos && anexos.length ? String(anexos.length) : "")}
    ${/* html */ uiSecao("relogio", "Tempo até formalizar", tempo)}
  </div>`;
}

/* anexo: URL assinada de 10 minutos no bucket privado (a policy só deixa quem lê comercial) */
async function psiAbrirAnexo(caminho){
  const { data, error } = await sb.storage.from(PSI_BUCKET).createSignedUrl(caminho, 600);
  if(error || !data?.signedUrl){ uiAvisar("Não foi possível abrir o anexo: " + (error ? error.message : "sem link"), "perigo"); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}

async function psiMudarStatus(p, status){
  if(!psiPodeOperar()) return;
  const spam = status === "spam";
  const ok = await uiConfirmar({
    titulo: spam ? "Marcar como spam" : "Descartar pedido",
    texto: spam ? `O pedido ${p.protocolo || ""} sai da lista e não conta nos indicadores.` : `O pedido ${p.protocolo || ""} sai da lista "A formalizar" sem virar orçamento.`,
    confirmar: spam ? "Marcar spam" : "Descartar", perigo: true
  });
  if(!ok) return;
  const reg = { status, atualizado_em: new Date().toISOString() };
  if(spam) reg.motivo_spam = "Marcado pelo comercial no app";
  const { error } = await sb.from("site_pedidos").update(reg).eq("id", p.id);
  if(error){ uiAvisar("Não foi possível mudar o pedido: " + error.message, "perigo"); return; }
  uiAvisar(spam ? "Pedido marcado como spam." : "Pedido descartado.", "ok");
  await carregarPedidosSite();
}

/* ---------------------------------------------------------------- Criar orçamento */
/* abre o orçamento NOVO preenchido com o pedido; nada é gravado até Salvar. Ao salvar, salvarOrcamento grava o
   whatsapp_cliente e chama psiLigarOrcamento (pedido ligado por orcamento_id, status "virou_orcamento"). */
async function psiCriarOrcamento(p, anexos){
  if(!psiPodeOperar() || typeof novoOrcamento !== "function") return;
  if(!irParaSecao("orcamentos")) return;
  await carregarOrcamentos();   // catálogo e número sugerido
  novoOrcamento();              // limpa o pendente anterior (orcLimparAssistente)
  const set = (id, v) => { const el = $(id); if(el && v != null && v !== "") el.value = v; };
  const setSel = (id, v) => { const el = $(id); if(el && v != null && [...el.options].some(o => o.value === String(v))) el.value = String(v); };
  const r = p.respostas || {};
  // cliente pelo CNPJ; sem cadastro, o cadastro rápido abre com o que o pedido tem
  let clienteId = null;
  if(p.cnpj){
    const docs = [p.cnpj, typeof _orcCliMascara === "function" ? _orcCliMascara(p.cnpj) : p.cnpj];
    const { data: cli } = await sb.from("clientes").select("id").in("cpf_cnpj", docs).limit(1);
    clienteId = cli && cli[0] ? cli[0].id : null;
  }
  setSel("orc-cliente", clienteId);
  if(typeof orcAtualizarChipCliente === "function") orcAtualizarChipCliente();
  const cidade = [p.cidade, p.uf].filter(Boolean).join("/");
  set("orc-ref-obra", r.F1a ? `${r.F1a}${cidade ? " – " + cidade : ""}` : (cidade ? `Obra em ${cidade}` : ""));
  set("orc-local", cidade);
  set("orc-contato-nome", p.nome);
  set("orc-contato-tel", psiFoneBR(p.whatsapp || p.telefone));
  set("orc-contato-email", p.email);
  if(p.inicio_previsto === "data" && p.inicio_mes) set("orc-sim-inicio", String(p.inicio_mes).slice(0, 10));
  if(["helice", "raiz", "secante", "trado"].includes(p.servico)){
    setSel("orc-tipo-proposta", p.servico);
    if(typeof orcTrocarModelo === "function") orcTrocarModelo();
  }
  if(p.segmento === "industrial" && typeof definirTipoObraOrc === "function") definirTipoObraOrc("industrial");
  const temAnexo = (t) => anexos.some(a => a.tipo === t);
  if($("orc-proj-forn")) $("orc-proj-forn").checked = temAnexo("projeto");
  if($("orc-sond-forn")) $("orc-sond-forn").checked = temAnexo("sondagem");
  // o que houver de estacas vai para o simulador de prazo (aba Proposta), que o comercial confere
  if(typeof r.F2 === "number") set("orc-sim-estacas", r.F2);
  if(Array.isArray(r.F3) && typeof r.F3[0] === "number") set("orc-sim-diametro", r.F3[0]);
  if(typeof r.F4 === "number") set("orc-sim-prof", r.F4);
  if(typeof atualizarFiltroCatalogoOrc === "function") atualizarFiltroCatalogoOrc();
  _psiPendente = { id: p.id, protocolo: p.protocolo, whatsapp: p.whatsapp || null };
  if(!clienteId && typeof orcPodeCadastrarCliente === "function" && orcPodeCadastrarCliente() && typeof orcAbrirNovoCliente === "function"){
    orcAbrirNovoCliente();
    set("orc-cli-nome", p.empresa || p.nome);
    set("orc-cli-doc", p.cnpj ? (typeof _orcCliMascara === "function" ? _orcCliMascara(p.cnpj) : p.cnpj) : "");
    set("orc-cli-contato", p.nome);
    set("orc-cli-tel", psiFoneBR(p.whatsapp || p.telefone));
    set("orc-cli-email", p.email);
    set("orc-cli-cidade", p.cidade);
    setSel("orc-cli-uf", p.uf ? p.uf.toLowerCase() : "");
  }
  uiAvisar(`Orçamento preenchido com o pedido ${p.protocolo || ""}: confira os dados e os itens e clique em Salvar. Nada foi gravado.`, "aviso");
}
/* chamadas pelo js/orcamentos.js */
function psiPedidoPendente(){ return _psiPendente; }
function psiLimparPendente(){ _psiPendente = null; }
async function psiLigarOrcamento(pedido, orcId){
  if(!pedido || !orcId) return null;
  const { error } = await sb.from("site_pedidos")
    .update({ orcamento_id: orcId, status: "virou_orcamento", atualizado_em: new Date().toISOString() }).eq("id", pedido.id);
  _psiPendente = null;
  return error ? `O pedido ${pedido.protocolo || ""} não foi ligado ao orçamento (${error.message}).` : null;
}

/* abre a aba a partir da tela inicial (pendência vw_sc_acoes_psi); com id, abre também a ficha do pedido */
async function psiAbrirDaInicio(id){
  if(!irParaSecao("orcamentos")) return;
  if(typeof mostrarPainelOrc === "function") mostrarPainelOrc();
  const btn = $("orc-view-psi");
  if(btn && !btn.classList.contains("ativo")) btn.click();
  if(id){ await carregarPedidosSite(); abrirPedidoSite(id); }
}

/* ---------------------------------------------------------------- Enviar pelo WhatsApp (ficha do orçamento) */
/* botão ao lado do "Enviar proposta": só com o orçamento salvo; destacado quando o pedido do site pediu WhatsApp */
async function psiAtualizarBotaoWhatsapp(){
  const b = $("btn-orc-whatsapp");
  if(!b) return;
  const id = typeof orcEditId !== "undefined" ? orcEditId : null;
  b.hidden = !id || !psiPodeOperar();
  b.classList.remove("psi-wa-destaque");
  if(!id || b.hidden || !psiPodeLer()) return;
  const { data } = await sb.from("site_pedidos").select("canal_proposta").eq("orcamento_id", id).limit(1);
  if(orcEditId !== id) return;
  const canal = data && data[0] ? data[0].canal_proposta : null;
  b.classList.toggle("psi-wa-destaque", canal === "whatsapp" || canal === "ambos");
}

function psiMensagemWhatsapp(o){
  const h = new Date().getHours();
  const primeiro = String(o.contato_nome || "").trim().split(/\s+/)[0] || "";
  const nome = primeiro ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : "";
  const saud = (h < 12 ? "Bom dia" : "Boa tarde") + (nome ? `, ${nome}!` : "!");   // como o e-mail da orcamento@
  const partes = typeof orcNumeroPartes === "function" ? orcNumeroPartes(o.numero, o.data_orcamento) : null;
  const numero = partes && partes.num ? `${partes.num}/${partes.ano}` : String(o.numero || "");
  const rev = String(o.numero_revisao || "00").trim();
  const proposta = rev && !/^0+$/.test(rev) ? `a proposta revisada ${numero} Rev ${rev}` : `a proposta comercial ${numero}`;
  const obra = String(o.referencia_obra || o.local_execucao || "").trim();
  return PSI_WHATSAPP_MSG.replace("{saudacao}", saud).replace("{proposta}", proposta).replace("{para_obra}", obra ? ` para ${obra}` : "");
}

async function psiEnviarWhatsapp(){
  if(!psiPodeOperar()) return;
  if(!orcEditId){ uiAvisar("Salve o orçamento antes de enviar a proposta.", "aviso"); return; }
  if(typeof appFormSujo === "function" && appFormSujo()){ uiAvisar("Salve o orçamento antes de enviar: a proposta sai do que está gravado.", "aviso"); return; }
  const orcId = orcEditId;
  const { data: o, error } = await sb.from("orcamentos")
    .select("id,numero,numero_revisao,data_orcamento,tipo_proposta,contato_nome,contato_telefone,whatsapp_cliente,referencia_obra,local_execucao")
    .eq("id", orcId).single();
  if(error){ uiAvisar("Não foi possível abrir o envio: " + error.message, "perigo"); return; }
  // sem whatsapp_cliente, sugere o telefone do contato quando é celular (11 dígitos); o comercial confere
  const telContato = String(o.contato_telefone || "").replace(/\D/g, "");
  const sugerido = o.whatsapp_cliente || (telContato.length === 11 || (telContato.length === 13 && telContato.startsWith("55")) ? telContato : "");
  const corpo = `<div class="psi-wa">
    ${/* html */ uiCampo({ id: "psi-wa-numero", rotulo: "WhatsApp do cliente", tipo: "tel", valor: sugerido ? psiFoneBR(sugerido) : "", obrigatorio: true,
      placeholder: "(31) 99999-0000", ajuda: o.whatsapp_cliente ? "Número gravado no orçamento." : "Confira o número: DDD e celular." })}
    ${/* html */ uiCampo({ id: "psi-wa-msg", rotulo: "Mensagem", tipo: "textarea", valor: psiMensagemWhatsapp(o) })}
    <p class="psi-wa-passos">Ao clicar em "Baixar PDF e abrir o WhatsApp", o PDF da proposta é baixado no computador e o WhatsApp abre numa aba nova com a mensagem. Anexe o PDF na conversa e envie; depois volte aqui para confirmar.</p>
    <div id="psi-wa-status">${/* html */ uiCarregando("Gerando o PDF da proposta…")}</div>
  </div>`;
  const d = document.createElement("dialog");
  d.className = "ui-modal";
  d.setAttribute("aria-label", "Enviar pelo WhatsApp");
  d.innerHTML = uiModalHTML({ titulo: "Enviar a proposta pelo WhatsApp", corpoHTML: corpo, largura: "m", acoes: [
    { id: "cancelar", texto: "Cancelar" }, { id: "abrir", texto: "Baixar PDF e abrir o WhatsApp", primaria: true }
  ] });
  document.body.appendChild(d);
  const q = (s) => d.querySelector(s);
  const btnAbrir = q('[data-acao="abrir"]');
  btnAbrir.disabled = true;
  let pdfBlob = null, aberto = false, numeroUsado = null;
  const nomePdf = (() => {
    const pt = typeof orcNumeroPartes === "function" ? orcNumeroPartes(o.numero, o.data_orcamento) : { num: o.numero, ano: "" };
    return `Proposta_CGL_${String(`${pt.num || "0000"}_${pt.ano || ""}`).replace(/[^\w.-]+/g, "_")}.pdf`;
  })();
  // o PDF sai já na abertura (o mesmo do envio pela orcamento@): o clique baixa e abre o WhatsApp no mesmo gesto
  gerarPropostaPdfBlob(orcId).then(b => {
    pdfBlob = b;
    if(!d.isConnected) return;
    q("#psi-wa-status").innerHTML = uiLinhaItem(nomePdf, "PDF da proposta pronto", psiTamanho(b.size), "");
    btnAbrir.disabled = false;
  }).catch(err => {
    if(d.isConnected) q("#psi-wa-status").innerHTML = uiErro("Não foi possível gerar o PDF da proposta: " + (err.message || err));
  });
  const fechado = new Promise(resolve => d.addEventListener("close", () => { d.remove(); resolve(); }));
  d.addEventListener("click", ev => {
    const b = ev.target.closest("[data-acao]");
    if(!b){ if(ev.target === d) d.close(); return; }
    if(b.dataset.acao !== "abrir"){ d.close(); return; }
    const num = psiNormalizarWhatsapp(q("#psi-wa-numero").value);
    if(!num){ q("#psi-wa-status").innerHTML = uiErro("Informe o WhatsApp do cliente com DDD (10 ou 11 dígitos)."); q("#psi-wa-numero").focus(); return; }
    if(!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    a.href = url; a.download = nomePdf;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(q("#psi-wa-msg").value)}`, "_blank", "noopener");
    aberto = true; numeroUsado = num;
    d.close();
  });
  d.showModal();
  q("#psi-wa-numero").focus();
  await fechado;
  if(!aberto) return;
  const ok = await uiConfirmar({ titulo: "Envio pelo WhatsApp", texto: `A proposta foi enviada pelo WhatsApp para ${psiFoneBR(numeroUsado)}?`,
    confirmar: "Sim, foi enviada", cancelar: "Não" });
  if(!ok){ uiAvisar("Nada foi registrado. Quando enviar, use o botão de novo e confirme.", "info"); return; }
  // guarda o PDF enviado junto dos da orcamento@ (falha aqui não impede o registro)
  let caminho = `${orcId}/${Date.now()}-whatsapp.pdf`;
  const up = await sb.storage.from("orcamentos-envio").upload(caminho, new Blob([pdfBlob], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
  if(up.error){ console.warn("Envio pelo WhatsApp: PDF não guardado:", up.error.message); caminho = null; }
  const { error: eReg } = await sb.rpc("registrar_envio_whatsapp", { p_orcamento: orcId, p_numero: numeroUsado, p_pdf_path: caminho });
  if(eReg){ uiAvisar("A proposta não foi registrada: " + eReg.message, "perigo"); return; }
  uiAvisar(`Envio pelo WhatsApp registrado para ${psiFoneBR(numeroUsado)}.`, "ok");
  if(orcEditId === orcId && typeof abrirOrcamento === "function") await abrirOrcamento(orcId);
  if(typeof carregarOrcamentos === "function") carregarOrcamentos();
}

/* ---------------------------------------------------------------- eventos */
function ligarPedidosSite(){
  const cont = $("psi-conteudo");
  if(cont){
    cont.addEventListener("change", ev => {
      if(ev.target.id === "psi-f-status"){ _psiFiltro.status = ev.target.value; renderPedidosSite(); }
      else if(ev.target.id === "psi-f-tipo"){ _psiFiltro.tipo = ev.target.value; renderPedidosSite(); }
    });
    cont.addEventListener("input", debounce(ev => {
      if(ev.target.id === "psi-busca"){ _psiFiltro.busca = ev.target.value; renderPedidosSite(); }
    }, 250));
    cont.addEventListener("click", ev => {
      const rem = ev.target.closest("[data-remover]");
      if(rem){
        const k = rem.dataset.remover;
        if(k === "status" || k === "*") _psiFiltro.status = "";
        if(k === "tipo" || k === "*") _psiFiltro.tipo = "";
        renderPedidosSite();
        return;
      }
      const tr = ev.target.closest(".psi-tabela tbody tr[data-id]");
      if(tr) abrirPedidoSite(tr.dataset.id);
    });
  }
  // anexos dentro da ficha (o <dialog> é montado pelo uiModal): delegação no documento
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-psi-anexo]");
    if(b) comBotaoTravado(b, () => psiAbrirAnexo(b.dataset.psiAnexo));
  });
  $("btn-orc-whatsapp")?.addEventListener("click", () => comBotaoTravado("btn-orc-whatsapp", psiEnviarWhatsapp));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarPedidosSite);
else ligarPedidosSite();

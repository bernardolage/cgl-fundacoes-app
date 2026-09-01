/* ====================================================================
   Módulo: Carteira — Controle de Contratos & Pendências
   Porte do componente ControleContratos.tsx (React) para o padrão do
   app. Tela SÓ LEITURA para diretoria/engenharia; a correção das
   pendências é feita nas telas de cadastro.

   Fontes (views security_invoker, respeitam o RLS do usuário):
     vw_controle_contratos    1 linha por contrato de cliente:
                              valor vigente = original + aditivos ASSINADOS
     vw_pendencias_contratos  fila tipificada; some quando o dado é corrigido
   Drill-down ao expandir: contrato_aditivos + orcamentos (1:N).

   Regras de exibição (aprendidas com a carteira real na tela):
   - KPIs em formato compacto ("R$ 59,8 mi") — valores de 8 dígitos
     estouravam o card; o exato fica no title e na tabela.
   - Tabela sem centavos e com badges curtas, para a coluna Pendências
     (a mais importante) caber na tela sem rolagem horizontal.
   - Nº de orçamentos saiu da tabela: está no detalhe expandido.
   ==================================================================== */

let _cartContratos  = [];
let _cartPendencias = [];
let _cartView       = "contratos";
let _cartCarregada  = false;
let _cartExpandido  = null;          // contrato_id da linha aberta
const _cartDetalhes = new Map();     // cache do drill-down por contrato

/* Tipos de pendência: label completa (aba Pendências, tooltips) e
   curta (badges na tabela de contratos, onde a largura é disputada) */
const CART_PEND_META = {
  sem_assinatura:        { label: "Sem assinatura",        curto: "assinatura",     cor: "vermelho" },
  aditivo_pendente:      { label: "Aditivo pendente",      curto: "aditivo",        cor: "vermelho" },
  aditivo_sem_valor:     { label: "Aditivo s/ valor",      curto: "aditivo s/ valor", cor: "ambar"  },
  valor_provisorio:      { label: "Valor provisório",      curto: "provisório",     cor: "ambar"    },
  quadro_parcial:        { label: "Quadro parcial",        curto: "quadro",         cor: "azul"     },
  composicao_divergente: { label: "Composição divergente", curto: "divergência",    cor: "azul"     },
  saldo_negativo:        { label: "Saldo negativo — precisa de aditivo", curto: "precisa aditivo", cor: "vermelho" }
};

/* ---------- Formatação ---------- */
/* R$ compacto para KPIs: 59.825.872,43 -> "R$ 59,8 mi" */
function brlCompacto(v){
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if(abs >= 1e6) return "R$ " + (n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi";
  if(abs >= 1e3) return "R$ " + (n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
  return brl(n);
}

/* R$ sem centavos para a tabela (o exato vai no title da célula) */
function brlInt(v){
  if(v == null) return "—";
  return "R$ " + Math.round(Number(v)).toLocaleString("pt-BR");
}

function cartTagPend(p, curta){
  const m = CART_PEND_META[p.tipo] || { label: p.tipo, curto: p.tipo, cor: "cinza" };
  return `<span class="tag ${m.cor}" title="${esc(m.label)}: ${esc(p.detalhe || "")}">${esc(curta ? m.curto : m.label)}</span>`;
}

/* ---------- Carga ---------- */
async function carregarCarteira(forcar){
  if(_cartCarregada && !forcar) return;
  const cont = $("cart-conteudo");
  if(cont && !_cartCarregada) cont.innerHTML = `<p class="vazio">Carregando carteira…</p>`;

  const [c, p] = await Promise.all([
    sb.from("vw_controle_contratos").select("*")
      .order("valor_vigente", { ascending:false }),
    sb.from("vw_pendencias_contratos").select("*")
      .order("severidade").order("valor_impacto", { ascending:false, nullsFirst:false })
  ]);
  if(c.error || p.error){
    if(cont) cont.innerHTML = `<p class="vazio">Erro ao carregar: ${esc((c.error || p.error).message)}</p>`;
    return;
  }
  _cartContratos  = c.data || [];
  _cartPendencias = p.data || [];
  _cartCarregada  = true;
  _cartDetalhes.clear();
  preencherFiltroTipoPend();
  renderCarteira();
}

function preencherFiltroTipoPend(){
  const sel = $("cart-f-tipo");
  if(!sel) return;
  const atual = sel.value;
  const porTipo = {};
  _cartPendencias.forEach(p => { porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1; });
  sel.innerHTML = `<option value="">Todos os tipos</option>` +
    Object.entries(CART_PEND_META)
      .filter(([t]) => porTipo[t])
      .map(([t, m]) => `<option value="${t}">${esc(m.label)} (${porTipo[t]})</option>`).join("");
  sel.value = atual;
}

/* ---------- Derivados ---------- */
function cartPendPorContrato(){
  const m = new Map();
  _cartPendencias.forEach(p => {
    if(!m.has(p.contrato_id)) m.set(p.contrato_id, []);
    m.get(p.contrato_id).push(p);
  });
  return m;
}

function cartContratosFiltrados(pendMap){
  const termo = ($("cart-busca")?.value || "").trim().toLowerCase();
  const soPend = $("cart-f-pendentes")?.checked;
  const incHist = $("cart-f-historico")?.checked !== false;
  return _cartContratos.filter(c => {
    if(!incHist && c.historico) return false;
    if(soPend && !pendMap.has(c.contrato_id)) return false;
    if(termo){
      const alvo = `${c.numero || ""} ${c.numero_cliente || ""} ${c.cliente || ""} ${c.descricao || ""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/* ---------- Render ---------- */
function renderCarteira(){
  const pendMap = cartPendPorContrato();
  renderCartKpis();
  /* filtro por tipo só faz sentido na fila de pendências */
  const selTipo = $("cart-f-tipo");
  if(selTipo) selTipo.style.display = _cartView === "pendencias" ? "" : "none";

  const dados = cartContratosFiltrados(pendMap);
  const contad = $("cart-contador");
  if(contad) contad.textContent = _cartView === "pendencias"
    ? `${_cartPendencias.length} pendência(s)`
    : `${dados.length} de ${_cartContratos.length}`;
  if(_cartView === "pendencias") renderCartPendencias();
  else                            renderCartContratos(dados, pendMap);
}

function renderCartKpis(){
  const incHist = $("cart-f-historico")?.checked !== false;
  const vis = incHist ? _cartContratos : _cartContratos.filter(c => !c.historico);
  const vigente  = vis.reduce((s,c) => s + (Number(c.valor_vigente)  || 0), 0);
  const assinada = vis.filter(c => c.assinatura_status === "concluida")
                      .reduce((s,c) => s + (Number(c.valor_vigente) || 0), 0);
  const aditPend = vis.reduce((s,c) => s + (Number(c.aditivos_pendentes) || 0), 0);

  const kpi = (id, compacto, exato) => {
    const el = $(id);
    if(!el) return;
    el.textContent = compacto;
    if(exato != null) el.title = exato;
  };
  kpi("cart-kpi-qtd",      String(vis.length));
  kpi("cart-kpi-vigente",  brlCompacto(vigente),            brl(vigente));
  kpi("cart-kpi-assinada", brlCompacto(assinada),           brl(assinada));
  kpi("cart-kpi-sem",      brlCompacto(vigente - assinada), brl(vigente - assinada));
  kpi("cart-kpi-pend",     String(_cartPendencias.length));
  const rot = $("cart-kpi-pend-rot");
  if(rot) rot.textContent = aditPend > 0
    ? `Pendências · ${brlCompacto(aditPend)} em aditivos fora do vigente`
    : "Pendências";
}

function renderCartContratos(dados, pendMap){
  const cont = $("cart-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum contrato encontrado.</p>`;
    return;
  }
  const linhas = dados.map(c => {
    const pend = pendMap.get(c.contrato_id) || [];
    const aberto = _cartExpandido === c.contrato_id;
    let html = `<tr class="linha-clicavel${aberto ? " cart-aberta" : ""}" data-id="${esc(c.contrato_id)}">
      <td><strong>${esc(c.numero)}</strong>${c.historico ? ' <span class="meta">hist.</span>' : ""}</td>
      <td class="cart-numcli" title="${esc(c.numero_cliente || "")}">${esc(c.numero_cliente || "—")}</td>
      <td class="cart-cliente" title="${esc(c.cliente || "")}">${esc(c.cliente || "—")}</td>
      <td>${tagAssinatura(c.assinatura_status)}</td>
      <td class="num" title="${brl(c.valor_original)}">${brlInt(c.valor_original)}</td>
      <td class="num" style="color:var(--sucesso);" title="${brl(c.aditivos_assinados)}">${Number(c.aditivos_assinados) ? brlInt(c.aditivos_assinados) : "—"}</td>
      <td class="num" title="${brl(c.valor_vigente)}"><strong>${brlInt(c.valor_vigente)}</strong>${c.valor_provisorio ? ' <span class="con-dias-tag" title="valor provisório">≈</span>' : ""}</td>
      <td>${pend.map(p => cartTagPend(p, true)).join(" ") || '<span class="meta">—</span>'}</td>
    </tr>`;
    if(aberto) html += `<tr class="cart-detalhe-row"><td colspan="8" id="cart-detalhe-celula">
      <p class="vazio">carregando…</p></td></tr>`;
    return html;
  }).join("");

  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Contrato</th><th>Nº cliente</th><th>Cliente</th><th>Assinatura</th>
      <th class="num">Original</th><th class="num" title="soma dos aditivos assinados">Aditivos ✓</th>
      <th class="num">Vigente</th><th>Pendências</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;

  cont.querySelectorAll("tr.linha-clicavel").forEach(tr => {
    tr.addEventListener("click", () => {
      const id = tr.dataset.id;
      _cartExpandido = (_cartExpandido === id) ? null : id;
      renderCarteira();
      if(_cartExpandido) carregarDetalheCarteira(_cartExpandido);
    });
  });
  if(_cartExpandido) carregarDetalheCarteira(_cartExpandido);
}

/* Drill-down: aditivos + orçamentos vinculados (com cache) */
async function carregarDetalheCarteira(contratoId){
  const cel = $("cart-detalhe-celula");
  if(!cel) return;

  let det = _cartDetalhes.get(contratoId);
  if(!det){
    const [a, o] = await Promise.all([
      sb.from("contrato_aditivos")
        .select("id,numero,tipo,valor_delta,descricao,assinatura_status,data_assinatura,observacoes")
        .eq("contrato_id", contratoId).order("ordem"),
      sb.from("orcamentos")
        .select("id,numero,valor_total,iss_percentual,observacoes")
        .eq("contrato_id", contratoId).order("numero")
    ]);
    det = { aditivos: a.data || [], orcamentos: o.data || [] };
    _cartDetalhes.set(contratoId, det);
    if(_cartExpandido !== contratoId) return; // usuário já fechou/mudou
  }

  const c = _cartContratos.find(x => x.contrato_id === contratoId);
  const blocoAdit = det.aditivos.length
    ? det.aditivos.map(a => `<div class="cart-det-linha" title="${esc(a.descricao || "")}">
        <span><strong>${esc(a.numero)}</strong> · ${esc(a.tipo)}${
          a.assinatura_status !== "concluida" ? ' <span class="txt-perigo">(sem assinatura)</span>' : ""}</span>
        <span class="num">${a.valor_delta == null ? "—" : brl(a.valor_delta)}</span>
      </div>`).join("")
    : `<p class="meta">nenhum</p>`;

  const blocoOrc = det.orcamentos.length
    ? det.orcamentos.map(o => `<div class="cart-det-linha">
        <span>${esc(o.numero)} <span class="meta">ISS ${esc(String(o.iss_percentual ?? "—"))}%</span></span>
        <span class="num">${brl(o.valor_total)}</span>
      </div>`).join("")
    : `<p class="meta">nenhum (contrato sem proposta CGL — ex.: SCT Direcional)</p>`;

  const resumo = c ? `<p class="meta" style="margin:0 0 8px;">
      ${esc(c.descricao || "")}${c.descricao ? " · " : ""}valor exato vigente: <strong>${brl(c.valor_vigente)}</strong>
      · ${c.qtd_obras || 0} obra(s)</p>` : "";

  cel.innerHTML = `${resumo}<div class="cart-detalhe">
    <div><h4>Aditivos (${det.aditivos.length})</h4>${blocoAdit}</div>
    <div><h4>Orçamentos vinculados (${det.orcamentos.length})</h4>${blocoOrc}</div>
  </div>`;
}

function renderCartPendencias(){
  const cont = $("cart-conteudo");
  if(!cont) return;
  const termo = ($("cart-busca")?.value || "").trim().toLowerCase();
  const fTipo = $("cart-f-tipo")?.value || "";
  const dados = _cartPendencias.filter(p =>
    (!fTipo || p.tipo === fTipo) &&
    (!termo
      || (p.numero || "").toLowerCase().includes(termo)
      || (p.cliente || "").toLowerCase().includes(termo)
      || (p.detalhe || "").toLowerCase().includes(termo)));

  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhuma pendência${termo || fTipo ? " para este filtro" : " — carteira em dia"}.</p>`;
    return;
  }
  const linhas = dados.map(p => `<tr class="linha-clicavel" data-id="${esc(p.contrato_id)}" data-numero="${esc(p.numero)}" title="Abrir o contrato ${esc(p.numero)}">
    <td>${cartTagPend(p)}</td>
    <td><strong>${esc(p.numero)}</strong></td>
    <td class="cart-cliente" title="${esc(p.cliente || "")}">${esc(p.cliente || "—")}</td>
    <td>${esc(p.detalhe || "")}</td>
    <td class="num">${p.valor_impacto == null ? "—" : brl(p.valor_impacto)}</td>
  </tr>`).join("");

  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Tipo</th><th>Contrato</th><th>Cliente</th><th>Detalhe</th><th class="num">Impacto</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;

  // Clicar numa pendência abre o contrato correspondente na aba Contratos
  cont.querySelectorAll("tr.linha-clicavel").forEach(tr => {
    tr.addEventListener("click", () => {
      abrirContratoNaCarteira(tr.dataset.id, tr.dataset.numero);
    });
  });
}

/* ---------- Navegação entre abas ---------- */
function cartTrocarAba(view){
  _cartView = view;
  _cartExpandido = null;
  document.querySelectorAll("#sec-carteira .serv-view-btn").forEach(x =>
    x.classList.toggle("ativo", x.dataset.view === view));
  renderCarteira();
}

function abrirContratoNaCarteira(contratoId, numero){
  const busca = $("cart-busca");
  if(busca) busca.value = numero || "";
  cartTrocarAba("contratos");     // zera a expansão e re-renderiza…
  _cartExpandido = contratoId;    // …por isso o alvo é definido DEPOIS
  renderCarteira();
  if(contratoId) carregarDetalheCarteira(contratoId);
}

/* Fila filtrada a partir de um KPI */
function cartIrParaPendencias(tipo){
  const busca = $("cart-busca");
  if(busca) busca.value = "";
  const sel = $("cart-f-tipo");
  if(sel) sel.value = tipo || "";
  cartTrocarAba("pendencias");
}

/* ---------- Listeners ---------- */
function ligarCarteira(){
  document.querySelectorAll("#sec-carteira .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => cartTrocarAba(b.dataset.view));
  });
  $("cart-busca")?.addEventListener("input", renderCarteira);
  $("cart-f-pendentes")?.addEventListener("change", renderCarteira);
  $("cart-f-historico")?.addEventListener("change", renderCarteira);
  $("cart-f-tipo")?.addEventListener("change", renderCarteira);
  $("btn-cart-atualizar")?.addEventListener("click", () => carregarCarteira(true));

  // KPIs clicáveis: viram a porta de entrada da fila de trabalho
  $("cart-card-sem")?.addEventListener("click", () => cartIrParaPendencias("sem_assinatura"));
  $("cart-card-pend")?.addEventListener("click", () => cartIrParaPendencias(""));

  // carga preguiçosa: só quando o menu é aberto pela primeira vez
  document.querySelector('nav button[data-secao="carteira"]')
    ?.addEventListener("click", () => carregarCarteira(false));
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarCarteira);
} else {
  ligarCarteira();
}

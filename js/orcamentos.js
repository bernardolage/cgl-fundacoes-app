/* ====================================================================
   Módulo: Orçamentos
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   Fluxo: rascunho → enviado → em_negociacao → aprovado / rejeitado/cancelado.
   Mantida lógica de itens via catálogo de serviços + cálculo de total.
   ==================================================================== */

let _orcamentos = [];
let _orcView    = "lista";
let orcEditId   = null;

const ORC_STAGES = ["rascunho","enviado","em_negociacao","aprovado"];

/* ---------- Cache do catálogo ---------- */
let _orcCatOptions  = '<option value="">— item livre (digitar) —</option>';
let _orcVarById     = {};
let _orcServUnidade = {};
let _orcServObs     = {};   // servico_id -> observação padrão do item (fase 40: vira "Obs: Item N - …")
let _orcServByCod   = {};   // codigo do serviço -> serviço
let _orcVarByCod    = {};   // codigo da variante -> variante
let _orcPrecos      = {};

let _orcServicos  = [];   // serviços ativos com o "eixo" (helice/raiz/trado/secante/null=comum)
let _orcVariantes = [];   // variantes ativas com tipo_obra, porte, faixa_prof e unidade própria
let _orcCatFiltro = { tipoProp: "helice", tipoObra: "convencional", porte: "", faixa: "" };

const ORC_PORTE_LBL = { pequeno: "Pequeno porte", medio: "Médio porte", grande: "Grande porte" };
const ORC_FAIXA_LBL = { ate18: "até 18 m", "18a24": "18 a 24 m", "24a30": "24 a 30 m", mais30: "> 30 m" };
const ORC_TIPO_LBL  = { helice: "Hélice", trado: "Trado", raiz: "Raiz", secante: "Secante", outro: "Outro" };

/* Fase 40: itens que não podem faltar em cada modelo de proposta (pedido do comercial).
   qtd 0 sai como "-" na proposta (igual à RG 11.8). `var` fixa a variante; sem `var`,
   entra a primeira variante que passa no filtro do Modelo (tipo de obra, porte, faixa). */
const ITENS_PADRAO_ORC = {
  helice: [
    { serv: "MOB.HC.SERV", qtd: 1 },
    { serv: "DIA.MDP.SERV" },
    { serv: "DIA.FM.HC.SERV" },
    { serv: "INS.DI.SERV", var: "INS-DI-HC" },
    { serv: "VRB.ALH.SERV" },
    { serv: "LOC.BO.SERV", var: "LOC-BO-MOB" },
    { serv: "LOC.BO.SERV", var: "LOC-BO-DIA" }
  ],
  raiz: [
    { serv: "MOB.RZ.SERV", qtd: 1 },
    { serv: "DIA.MDP.SERV" },
    { serv: "DIA.FM.RZ.SERV" },
    { serv: "INS.DI.SERV", var: "INS-DI-RZ" },
    { serv: "VRB.ALH.SERV" },
    { serv: "EXEC.RZ.INJ.SERV" }
  ],
  trado: [
    { serv: "MOB.ESC.SERV", var: "MOB-ESC", qtd: 1 },
    { serv: "DIA.MDP.SERV" },
    { serv: "DIA.FM.ESC.SERV" },
    { serv: "INS.DI.SERV", var: "INS-DI-HC" },
    { serv: "VRB.ALH.SERV" }
  ],
  outro: []
};
ITENS_PADRAO_ORC.secante = ITENS_PADRAO_ORC.helice; // secante usa mobilização/fat. mínimo/bomba de hélice

// Eixo do serviço pelo caminho da categoria + nome (servicos.tipo_estaca é nulo em 21/29)
function _eixoServicoOrc(texto){
  const t = (texto || "").toLowerCase();
  if(t.includes("secante")) return "secante";
  if(t.includes("hélice") || t.includes("helice")) return "helice";
  if(t.includes("raiz") || t.includes("raíz")) return "raiz";
  if(t.includes("trado") || t.includes("escavad")) return "trado";
  return null; // comum: diárias, insumos, verbas, bomba/compressor/gerador…
}

async function prepararCatalogoOrc(){
  const [srv, vrt, prc, cat] = await Promise.all([
    sb.from("servicos").select("id,codigo,nome,unidade,categoria_id,ativo,observacoes_padrao").order("codigo"),
    sb.from("servico_variantes").select("id,servico_id,codigo,nome,ativo,tipo_obra,unidade,porte,faixa_prof").order("codigo"),
    sb.from("servico_precos").select("variante_id,preco_referencia,vigente_desde")
      .order("vigente_desde",{ ascending:false }),
    sb.from("categorias_servico").select("id,nome,parent_id")
  ]);
  const cats = {};
  (cat.data || []).forEach(c => { cats[c.id] = c; });
  const caminho = (id) => {
    const partes = []; let c = cats[id]; let guarda = 0;
    while(c && guarda++ < 6){ partes.unshift(c.nome); c = c.parent_id ? cats[c.parent_id] : null; }
    return partes.join(" > ");
  };
  _orcServicos  = (srv.data || []).filter(s => s.ativo !== false)
                    .map(s => ({ ...s, eixo: _eixoServicoOrc(caminho(s.categoria_id) + " " + s.nome) }));
  _orcVariantes = (vrt.data || []).filter(v => v.ativo !== false);

  _orcVarById = {};
  _orcServUnidade = {};
  _orcServObs = {};
  _orcServByCod = {};
  _orcVarByCod = {};
  _orcPrecos = {};
  _orcServicos.forEach(s => {
    _orcServUnidade[s.id] = s.unidade;
    if(s.observacoes_padrao) _orcServObs[s.id] = s.observacoes_padrao;
    if(s.codigo) _orcServByCod[s.codigo] = s;
  });
  _orcVariantes.forEach(v => { _orcVarById[v.id] = v; if(v.codigo) _orcVarByCod[v.codigo] = v; });
  (prc.data || []).forEach(p => {
    if(!(p.variante_id in _orcPrecos)) _orcPrecos[p.variante_id] = p.preco_referencia;
  });
  _orcCatOptions = montarOpcoesCatalogoOrc(null); // catálogo completo
}

function _servicoVisivelOrc(s, tipoProp){
  if(!tipoProp || tipoProp === "outro" || !s.eixo) return true;
  if(s.eixo === tipoProp) return true;
  if(tipoProp === "secante" && s.eixo === "helice") return true; // secante usa mobilização/locação/fat. mínimo de hélice
  return false;
}

// Variantes de um serviço que passam no filtro (tipo de obra, porte, faixa de profundidade).
// Cada critério só é aplicado se sobrar alguma variante — serviço sem variante do tipo/porte/faixa
// escolhido mostra todas (ex.: Mão de Obra Extra só tem industrial). Variante sem porte/faixa
// (nulo) vale para qualquer.
function _variantesFiltradasOrc(s, f){
  let vars = _orcVariantes.filter(v => v.servico_id === s.id);
  if(!vars.length || !f) return vars;
  if(f.tipoObra){
    const d = vars.filter(v => v.tipo_obra === f.tipoObra || v.tipo_obra === "especial");
    if(d.length) vars = d;
  }
  if(f.porte){
    const d = vars.filter(v => !v.porte || v.porte === f.porte);
    if(d.length) vars = d;
  }
  if(f.faixa){
    const d = vars.filter(v => !v.faixa_prof || v.faixa_prof === f.faixa);
    if(d.length) vars = d;
  }
  return vars;
}

// f nulo = catálogo completo; senão { tipoProp, tipoObra, porte, faixa }
function montarOpcoesCatalogoOrc(f){
  let html = '<option value="">— item livre (digitar) —</option>';
  _orcServicos.forEach(s => {
    if(f && !_servicoVisivelOrc(s, f.tipoProp)) return;
    const vars = _variantesFiltradasOrc(s, f);
    if(!vars.length) return;
    html += `<optgroup label="${esc(s.nome)}">`
          + vars.map(v => `<option value="${esc(v.id)}">${esc(v.nome)}</option>`).join("")
          + `</optgroup>`;
  });
  return html;
}
function _opcoesFiltradasOrc(){ return montarOpcoesCatalogoOrc(_orcCatFiltro); }

// Troca as opções do select preservando o item escolhido (mesmo fora do filtro)
function _trocarOpcoesSelect(sel, html){
  const atual = sel.value;
  sel.innerHTML = html;
  if(atual && ![...sel.options].some(o => o.value === atual)){
    const v = _orcVarById[atual];
    sel.insertAdjacentHTML("beforeend", `<option value="${esc(atual)}">${esc(v ? v.nome : "(item)")} · fora do filtro</option>`);
  }
  sel.value = atual;
}

// Muda tipo de proposta / tipo de obra / porte / faixa → refaz o select de cada linha (exceto as
// em "todo o catálogo"). Fase 40: linha cujo item ficou fora do filtro troca sozinha para a variante
// equivalente do mesmo serviço quando ela é única (ex.: Fat. mínimo 24-30m → até 18m) ou quando
// só muda o porte e a distância é a mesma (Mob. Grande (até 100km) → Mob. Médio (até 100km)).
function atualizarFiltroCatalogoOrc(){
  _orcCatFiltro = {
    tipoProp: $("orc-tipo-proposta")?.value || "helice",
    tipoObra: $("orc-tipo-obra")?.value || "convencional",
    porte:    $("orc-porte")?.value || "",
    faixa:    $("orc-faixa")?.value || ""
  };
  const html = _opcoesFiltradasOrc();
  let ajustados = 0;
  document.querySelectorAll("#orc-itens tr").forEach(tr => {
    const sel = tr.querySelector(".it-cat");
    const btn = tr.querySelector(".it-cat-all");
    if(!sel || (btn && btn.classList.contains("ativo"))) return;
    _trocarOpcoesSelect(sel, html);
    const v = _orcVarById[sel.value];
    const opt = sel.selectedOptions && sel.selectedOptions[0];
    if(!v || !opt || !opt.textContent.endsWith("· fora do filtro")) return;
    const s = _orcServicos.find(x => x.id === v.servico_id);
    if(!s || !_servicoVisivelOrc(s, _orcCatFiltro.tipoProp)) return; // mudou o eixo: não troca sozinho
    let cand = _variantesFiltradasOrc(s, _orcCatFiltro).filter(c => c.id !== v.id);
    if(cand.length > 1){
      // mesma distância "(até 100km)" (mobilização por porte) …
      const suf = (v.nome.match(/\(([^)]*)\)\s*$/) || [])[1];
      if(suf) cand = cand.filter(c => c.nome.endsWith(`(${suf})`));
    }
    if(cand.length > 1){
      // … ou mesmo diâmetro em outra faixa ("Hélice Ø 600mm 24 a 30m" → "Hélice Ø 600mm até 18m")
      const faixaRe = /\s*(até 18 ?m|18 a 24 ?m|24 a 30 ?m|> ?30 ?m)\s*$/i;
      const base = v.nome.replace(faixaRe, "").trim();
      const c2 = cand.filter(c => faixaRe.test(c.nome) && c.nome.replace(faixaRe, "").trim() === base);
      if(c2.length) cand = c2;
    }
    if(cand.length === 1){
      sel.value = cand[0].id;
      aplicarItemCatalogo(sel);
      ajustados++;
    }
  });
  if(ajustados) aviso("app-aviso", `${ajustados} item(ns) trocado(s) para a variante do porte/faixa escolhidos no Modelo — confira valores.`, "ok");
  const txt = $("orc-filtro-cat-txt");
  if(txt){
    const nomeProp = { helice:"Hélice", trado:"Trado", raiz:"Raiz", secante:"Secante (+ apoio de hélice)", outro:"Outro — sem filtro de eixo" }[_orcCatFiltro.tipoProp] || _orcCatFiltro.tipoProp;
    const nomeObra = { convencional:"Convencional", industrial:"Industrial", especial:"Especial" }[_orcCatFiltro.tipoObra] || _orcCatFiltro.tipoObra;
    const extras = [ORC_PORTE_LBL[_orcCatFiltro.porte], ORC_FAIXA_LBL[_orcCatFiltro.faixa]].filter(Boolean);
    txt.textContent = [nomeProp, nomeObra].concat(extras).join(" · ");
  }
}

/* Fase 40: adiciona os itens padrão do modelo que ainda não estão no orçamento.
   Não duplica: compara pela variante e (sem `var`) pelo serviço. */
function carregarItensPadraoOrc(silencioso){
  const tipo  = $("orc-tipo-proposta")?.value || "helice";
  const lista = ITENS_PADRAO_ORC[tipo] || [];
  if(!lista.length || !_orcServicos.length) return 0;
  const presentes = new Set([...document.querySelectorAll("#orc-itens .it-cat")].map(s => s.value).filter(Boolean));
  const servPresentes = new Set([...presentes].map(id => _orcVarById[id]?.servico_id).filter(Boolean));
  let n = 0;
  lista.forEach(d => {
    const s = _orcServByCod[d.serv];
    if(!s) return;
    let v = d.var ? _orcVarByCod[d.var] : null;
    if(!v) v = _variantesFiltradasOrc(s, _orcCatFiltro)[0];
    if(!v || presentes.has(v.id)) return;
    if(!d.var && servPresentes.has(s.id)) return;
    adicionarItemPreenchido({
      variante_id:    v.id,
      descricao:      v.nome,
      quantidade:     d.qtd || 0,
      unidade:        v.unidade || _orcServUnidade[s.id] || "un",
      valor_unitario: _orcPrecos[v.id] != null ? Number(_orcPrecos[v.id]) : 0,
      observacao:     _orcServObs[s.id] || ""
    });
    presentes.add(v.id); servPresentes.add(s.id); n++;
  });
  recalcularOrc();
  if(!silencioso){
    aviso("app-aviso", n
      ? `${n} item(ns) padrão do modelo ${ORC_TIPO_LBL[tipo] || tipo} adicionado(s). Quantidade 0 sai como “-” na proposta.`
      : "Todos os itens padrão deste modelo já estão no orçamento.", "ok");
  }
  return n;
}

function definirTipoObraOrc(valor){
  const v = valor || "convencional";
  const sel = $("orc-tipo-obra");
  if(sel) sel.value = v;
  atualizarFiltroCatalogoOrc();
}

// Validade (data) = data do orçamento + validade em dias (aba Modelo). Continua editável.
function recalcularValidadeOrc(){
  const d = $("orc-data")?.value;
  const dias = Number($("orc-validade-dias")?.value || 0);
  const alvo = $("orc-validade");
  if(!alvo || !d || !dias) return;
  const [y, m, dd] = d.split("-").map(Number);
  alvo.value = dataLocalISO(new Date(y, m - 1, dd + dias));
}

/* ---------- Carga ---------- */
async function carregarOrcamentos(){
  if(Object.keys(_orcVarById).length === 0){
    try { await prepararCatalogoOrc(); } catch(_){ /* segue */ }
  }
  const { data, error } = await sb.from("orcamentos")
    .select("id,numero,cliente_id,data_orcamento,status,valor_total,validade,responsavel_id,tipo_proposta,porte_equipamento,faixa_profundidade")
    .order("data_orcamento",{ ascending:false });
  _orcamentos = error ? [] : (data || []);
  renderOrcamentos();

  // Select de orçamento de origem na aba Contrato da obra (fase 21)
  const aprov = _orcamentos.filter(o => ["aprovado","enviado","em_negociacao"].includes(o.status));
  const selectObrOrc = $("obr-con-orcamento");
  if(selectObrOrc){
    const atual = selectObrOrc.value;
    selectObrOrc.innerHTML = '<option value="">— nenhum —</option>' +
      aprov.map(o=>`<option value="${esc(o.id)}">${esc(o.numero)} — ${esc(mapaClientes[o.cliente_id]||"")}</option>`).join("");
    selectObrOrc.value = atual;
  }
}

/* ---------- Filtros ---------- */
function orcFiltrados(){
  const termo = ($("orc-busca")?.value || "").trim().toLowerCase();
  const fStat  = $("orc-f-status")?.value || "";
  const fCli   = $("orc-f-cliente")?.value || "";
  const fPorte = $("orc-f-porte")?.value || "";
  return _orcamentos.filter(o => {
    if(fStat && o.status !== fStat) return false;
    if(fCli && o.cliente_id !== fCli) return false;
    if(fPorte && (o.porte_equipamento || "") !== fPorte) return false;
    if(termo){
      const cli = (mapaClientes[o.cliente_id] || "").toLowerCase();
      if(!((o.numero||"").toLowerCase().includes(termo) || cli.includes(termo))) return false;
    }
    return true;
  });
}

function preencherFiltrosOrc(){
  const selSt = $("orc-f-status");
  if(selSt && !selSt.options.length){
    selSt.innerHTML = `<option value="">Todos os status</option>` + opcoesStatus("orcamento");
  }
  const selPorte = $("orc-f-porte");
  if(selPorte && !selPorte.options.length){
    selPorte.innerHTML = `<option value="">Todos os portes</option>` +
      Object.entries(ORC_PORTE_LBL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  }
  const selCli = $("orc-f-cliente");
  if(selCli){
    const atual = selCli.value; // preserva a seleção (o render roda a cada tecla)
    const lista = Object.entries(mapaClientes).map(([id, nome]) => ({ id, nome }));
    selCli.innerHTML = `<option value="">Todos os clientes</option>` +
      lista.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
    selCli.value = atual;
  }
}

/* ---------- Render ---------- */
// "Hélice · Grande porte · 24 a 30 m" (o que estiver preenchido)
function _orcTipoPorteTxt(o){
  return [ORC_TIPO_LBL[o.tipo_proposta] || "", ORC_PORTE_LBL[o.porte_equipamento], ORC_FAIXA_LBL[o.faixa_profundidade]]
    .filter(Boolean).join(" · ") || "—";
}

function renderOrcamentos(){
  preencherFiltrosOrc();
  const dados = orcFiltrados();
  const cont = $("orc-contador");
  if(cont) cont.textContent = `${dados.length} de ${_orcamentos.length}`;
  if(_orcView === "kanban") renderOrcKanban(dados);
  else                       renderOrcLista(dados);
  const legacy = $("tab-orcamentos");
  if(legacy) legacy.innerHTML = "";
}

function renderOrcLista(dados){
  const cont = $("orc-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum orçamento encontrado.</p>`;
    return;
  }
  const linhas = dados.map(o => `<tr class="linha-clicavel" data-id="${esc(o.id)}">
    <td>${esc(o.numero)}</td>
    <td>${esc(mapaClientes[o.cliente_id]||"—")}</td>
    <td>${esc(_orcTipoPorteTxt(o))}</td>
    <td>${dataBR(o.data_orcamento)}</td>
    <td>${dataBR(o.validade)}</td>
    <td>${tagStatus("orcamento", o.status)}</td>
    <td class="num">${brl(o.valor_total)}</td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Número</th><th>Cliente</th><th>Tipo · Porte</th><th>Data</th><th>Validade</th><th>Status</th><th class="num">Valor</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderOrcKanban(dados){
  const cont = $("orc-conteudo");
  if(!cont) return;
  const colunas = ORC_STAGES.concat(["rejeitado","cancelado"]).map(st => {
    const itens = dados.filter(o => o.status === st);
    if(!itens.length && (st === "rejeitado" || st === "cancelado")) return "";
    const stMeta = (STATUS.orcamento && STATUS.orcamento[st]) || { label: st, cor: "cinza" };
    const cards = itens.map(o => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(o.id)}">
        <div class="serv-kan-card-nome">${esc(o.numero)} · ${esc(mapaClientes[o.cliente_id]||"—")}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${dataBR(o.data_orcamento)}${o.validade ? " · val " + dataBR(o.validade) : ""} · ${esc(_orcTipoPorteTxt(o))}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span></span>
          <strong>${brl(o.valor_total)}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  habilitarDragKanban({
    container: "#orc-conteudo .serv-kanban",
    tabela: "orcamentos",
    onUpdate: async () => { await carregarOrcamentos(); }
  });
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelOrc(){
  $("orc-painel").style.display = "";
  $("orc-ficha").style.display = "none";
  orcEditId = null;
}

function novoOrcamento(){
  orcEditId = null;
  // limpa form
  ["orc-numero","orc-cliente","orc-descricao","orc-validade","orc-responsavel","orc-obs",
   "orc-ref-obra","orc-escopo","orc-equipamento","orc-pagamento","orc-prazo","orc-local",
   "orc-hosp-valor","orc-porte","orc-faixa","orc-contato-nome","orc-contato-tel","orc-contato-email"]
    .forEach(k => { const el = $(k); if(el) el.value = ""; });
  $("orc-itens").innerHTML = "";
  $("orc-status").value = "rascunho";
  $("orc-data").value = hojeISO();
  // próximo número pelo maior sufixo existente (contagem colidia após exclusões)
  const maxN = _orcamentos.reduce((m, o) => { const mm = String(o.numero || "").match(/([0-9]+)$/); return mm ? Math.max(m, Number(mm[1])) : m; }, 0);
  $("orc-numero").value = "ORC-" + String(maxN + 1).padStart(4,"0");
  // Fase 40: responsável = quem está logado (continua editável)
  const selResp = $("orc-responsavel");
  if(selResp && typeof usuarioAtual !== "undefined" && usuarioAtual && [...selResp.options].some(o => o.value === usuarioAtual.id)){
    selResp.value = usuarioAtual.id;
  }
  $("orc-tipo-proposta").value  = "helice";
  $("orc-revisao").value        = "00";
  $("orc-cidade-emissao").value = "Itabira/MG";
  $("orc-validade-dias").value  = 30;
  definirTipoObraOrc("convencional");
  recalcularValidadeOrc();
  $("orc-iss-perc").value       = 5.00;
  $("orc-iss-pdentro").checked  = true;
  $("orc-proj-forn").checked    = false;
  $("orc-sond-forn").checked    = false;
  $("orc-cgl-diesel").checked   = false;
  $("orc-diesel-preco").value   = 8.34;
  $("orc-cgl-hospedagem").checked = false;
  // Fase 40: condição de pagamento já vem com o texto padrão do modelo (edita-se na negociação)
  if(typeof TEXTO_PAGAMENTO_PADRAO !== "undefined") $("orc-pagamento").value = TEXTO_PAGAMENTO_PADRAO;
  $("btn-excluir-orc").style.display = "none";
  abrirFichaOrcVisual({ numero: "(novo)", status: "rascunho", valor_total: 0 });
  carregarItensPadraoOrc(true); // itens que não podem faltar no modelo
}

async function abrirOrcamento(id){
  orcEditId = id;
  const { data:o, error } = await sb.from("orcamentos").select("*").eq("id",id).single();
  if(error){ aviso("app-aviso","Erro ao abrir o orçamento: "+error.message,"erro"); return; }
  $("orc-numero").value         = o.numero || "";
  $("orc-cliente").value        = o.cliente_id || "";
  $("orc-status").value         = o.status || "rascunho";
  $("orc-data").value           = (o.data_orcamento || "").slice(0,10);
  $("orc-validade").value       = (o.validade || "").slice(0,10);
  $("orc-responsavel").value    = o.responsavel_id || "";
  $("orc-descricao").value      = o.descricao || "";
  $("orc-obs").value             = o.observacoes || "";
  $("orc-tipo-proposta").value   = o.tipo_proposta || "helice";
  $("orc-revisao").value         = o.numero_revisao || "00";
  $("orc-cidade-emissao").value  = o.cidade_emissao || "Itabira/MG";
  $("orc-validade-dias").value   = o.validade_dias != null ? o.validade_dias : 30;
  $("orc-porte").value           = o.porte_equipamento || "";
  $("orc-faixa").value           = o.faixa_profundidade || "";
  definirTipoObraOrc(o.tipo_obra || "convencional"); // antes dos itens: define o filtro do catálogo
  if(!o.validade) recalcularValidadeOrc();
  $("orc-iss-perc").value        = o.iss_percentual != null ? o.iss_percentual : 5.00;
  $("orc-iss-pdentro").checked   = o.iss_por_dentro !== false;
  $("orc-proj-forn").checked     = o.projeto_fornecido === true || o.projeto_sondagem_fornecido === true;
  $("orc-sond-forn").checked     = o.sondagem_fornecida === true || o.projeto_sondagem_fornecido === true;
  $("orc-contato-nome").value    = o.contato_nome || "";
  $("orc-contato-tel").value     = o.contato_telefone || "";
  $("orc-contato-email").value   = o.contato_email || "";
  $("orc-ref-obra").value        = o.referencia_obra || "";
  $("orc-escopo").value          = o.escopo_servicos || "";
  $("orc-equipamento").value     = o.equipamento_considerado || "";
  $("orc-pagamento").value       = o.condicoes_pagamento || "";
  $("orc-prazo").value           = o.prazo_execucao || "";
  $("orc-local").value           = o.local_execucao || "";
  $("orc-cgl-diesel").checked      = o.cgl_fornece_diesel === true;
  $("orc-diesel-preco").value      = o.diesel_preco_litro != null ? o.diesel_preco_litro : 8.34;
  $("orc-cgl-hospedagem").checked  = o.cgl_fornece_hospedagem === true;
  $("orc-hosp-valor").value        = o.hospedagem_valor_mensal != null ? o.hospedagem_valor_mensal : "";

  $("orc-itens").innerHTML = "";
  const { data:itens, error: errItens } = await sb.from("orcamento_itens")
    .select("*").eq("orcamento_id",id).order("ordem");
  // Itens não carregaram → não abrir: salvar faria delete+insert com lista vazia.
  if(errItens){
    orcEditId = null;
    aviso("app-aviso","Não foi possível carregar os itens do orçamento ("+errItens.message+"). Tente abrir de novo.","erro");
    return;
  }
  (itens || []).forEach(it => adicionarItemPreenchido(it));

  $("btn-excluir-orc").style.display = "";
  recalcularOrc();
  abrirFichaOrcVisual(o);
}

// Orçamento novo: zera smart-buttons e abas (senão ficam os valores do último aberto)
function zerarAbasOrc(){
  ["sb-orc-contratos","sb-orc-obras","sb-orc-medicoes","sb-orc-revisoes"].forEach(id => {
    const el = $(id); if(!el) return;
    const n = el.querySelector(".sb-num"); if(n) n.textContent = "0";
    el.classList.add("zero");
  });
  if($("orc-rev-badge")) $("orc-rev-badge").textContent = "";
  renderizarRevisoesOrc([], null);
  renderizarVinculosOrc([], [], []);
}

function abrirFichaOrcVisual(o){
  $("orc-painel").style.display = "none";
  $("orc-ficha").style.display = "";

  $("orc-ficha-numero").textContent = o.numero || "(novo)";
  if($("orc-ficha-revisao-chip")) $("orc-ficha-revisao-chip").textContent = `Rev ${o.numero_revisao || "00"}`;
  $("orc-ficha-cliente-chip").textContent = mapaClientes[o.cliente_id] || "—";
  $("orc-ficha-status-chip").innerHTML = tagStatus("orcamento", o.status);
  $("orc-ficha-valor-chip").textContent = brl(o.valor_total || 0);
  if($("orc-ficha-validade-chip")) $("orc-ficha-validade-chip").textContent = dataBR(o.validade);
  $("orc-ficha-titulo").textContent = orcEditId ? `Orçamento ${o.numero} · Rev ${o.numero_revisao||"00"}` : "Novo orçamento";

  atualizarStatusbarOrc(o.status);
  atualizarAcoesOrc(o);
  // Carrega smart-buttons + revisões + vínculos em paralelo
  if(orcEditId) carregarAbasOrc(o);
  else zerarAbasOrc();
  ativarTabOrc("geral");
}

/* Mostra/oculta botão "Criar obra" baseado no status + se já gerou obra.
   Fase 21: o orçamento aprovado gera a OBRA; os dados contratuais ficam
   na aba Contrato dessa obra. */
async function atualizarAcoesOrc(o){
  const btnObra = $("btn-orc-criar-obra");
  const hint    = $("orc-acao-hint");
  if(!btnObra) return;
  btnObra.style.display = "none";
  if(hint) hint.textContent = "";
  if(!orcEditId) return;

  if(o.status !== "aprovado"){
    if(hint) hint.textContent = `Botão "Criar obra" aparece quando status = aprovado (atual: ${o.status}).`;
    return;
  }
  // Já existe obra vinculada (direto ou via contrato deste orçamento)?
  const { data: contrs } = await sb.from("contratos")
    .select("id").eq("orcamento_id", orcEditId);
  const idsContr = (contrs || []).map(c => c.id);
  let temObra = false;
  if(idsContr.length){
    const { count } = await sb.from("obras")
      .select("id", { count:"exact", head:true }).in("contrato_id", idsContr);
    temObra = !!(count && count > 0);
  }
  if(temObra){
    if(hint) hint.textContent = `Este orçamento já gerou obra (aba 🔗 Vínculos).`;
  } else {
    btnObra.style.display = "";
  }
}

/* ============================================================
   SMART-BUTTONS + ABA REVISÕES + ABA VÍNCULOS
   ============================================================ */
async function carregarAbasOrc(o){
  if(!orcEditId || !o) return;
  // Em paralelo: revisões (mesmo número) + contratos + obras + medições que usam preços daqui
  const [revRes, contrRes, medRes] = await Promise.all([
    sb.from("orcamentos")
      .select("id,numero_revisao,status,valor_total,data_orcamento,updated_at")
      .eq("numero", o.numero)
      .order("updated_at", { ascending: false }),
    sb.from("contratos")
      .select("id,numero,status,data_assinatura,valor_total,obras:obras!contrato_id(id,codigo,nome,status)")
      .eq("orcamento_id", orcEditId),
    // Filtra pelo item embutido (!inner) em vez de um await aninhado que
    // serializava as 3 consultas do Promise.all (1 round-trip a menos)
    sb.from("medicao_itens")
      .select("medicao_id, valor_total, orcamento_item:orcamento_item_id!inner(orcamento_id), medicao:medicao_id(id,numero,status,data_medicao,obra:obra_id(codigo,nome))")
      .eq("orcamento_item.orcamento_id", orcEditId)
  ]);

  const revisoes  = revRes.data || [];
  const contratos = contrRes.data || [];
  const obras     = contratos.flatMap(c => c.obras || []);
  // Medições únicas (por medicao_id)
  const medMap = {};
  (medRes.data || []).forEach(mi => {
    if(!mi.medicao) return;
    const m = mi.medicao;
    if(!medMap[m.id]) medMap[m.id] = { ...m, _itens: 0 };
    medMap[m.id]._itens++;
  });
  const medicoes = Object.values(medMap);
  _orcVinculos = { contratos, obras, medicoes };

  // Atualiza smart-buttons
  const setSB = (id, n) => {
    const el = $(id);
    if(!el) return;
    el.querySelector(".sb-num").textContent = n || 0;
    el.classList.toggle("zero", !n);
  };
  setSB("sb-orc-contratos", contratos.length);
  setSB("sb-orc-obras",     obras.length);
  setSB("sb-orc-medicoes",  medicoes.length);
  setSB("sb-orc-revisoes",  Math.max(0, revisoes.length - 1)); // revisões ALÉM da original (Rev 00 não conta)

  // Badge na aba Revisões
  if($("orc-rev-badge")) $("orc-rev-badge").textContent = revisoes.length > 1 ? revisoes.length - 1 : "";

  // Renderiza aba Revisões
  renderizarRevisoesOrc(revisoes, o);
  // Renderiza aba Vínculos
  renderizarVinculosOrc(contratos, obras, medicoes);
}

function renderizarRevisoesOrc(revs, atual){
  const cont = $("orc-revisoes-conteudo");
  if(!cont) return;
  if(!revs.length){
    cont.innerHTML = `<p class="vazio">Apenas a revisão atual.</p>`;
    return;
  }
  // Ordena por numero_revisao (numeric desc)
  revs.sort((a,b) => {
    const av = parseInt(a.numero_revisao,10) || 0;
    const bv = parseInt(b.numero_revisao,10) || 0;
    return bv - av;
  });
  const linhas = revs.map(r => {
    const ehAtual = r.id === atual.id;
    return `<tr class="${ehAtual ? "" : "linha-clicavel"}" data-id="${esc(r.id)}" style="${ehAtual ? "background:var(--info-bg);" : ""}">
      <td><strong>Rev ${esc(r.numero_revisao||"00")}</strong> ${ehAtual ? '<span class="badge-alterado" style="background:var(--marca-600);color:var(--txt-sobre);border-color:var(--marca-600);">ATUAL</span>' : ""}</td>
      <td>${tagStatus("orcamento", r.status)}</td>
      <td class="num">${brl(r.valor_total||0)}</td>
      <td>${dataBR(r.data_orcamento)}</td>
      <td>${new Date(r.updated_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Revisão</th><th>Status</th><th class="num">Valor</th><th>Data</th><th>Atualizado em</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
  cont.querySelectorAll(".linha-clicavel").forEach(tr => {
    tr.addEventListener("click", () => abrirOrcamento(tr.dataset.id));
  });
}

let _orcVinculos = { contratos: [], obras: [], medicoes: [] };
async function orcAbrirVinculo(tipo, id){
  if(tipo === "obra"){ irParaSecao("obras"); if(typeof abrirObra === "function") await abrirObra(id); }
  else if(tipo === "contrato"){ irParaSecao("contratos"); if(typeof abrirContrato === "function") await abrirContrato(id); }
  else if(tipo === "medicao"){ irParaSecao("medicoes"); if(typeof abrirMedicao === "function") await abrirMedicao(id); }
}

function renderizarVinculosOrc(contratos, obras, medicoes){
  const cont = $("orc-vinculos-conteudo");
  if(!cont) return;
  if(!contratos.length && !obras.length && !medicoes.length){
    cont.innerHTML = `<p class="vazio">Este orçamento ainda não está vinculado a contratos / obras / medições.</p>`;
    return;
  }
  const blocoContrat = contratos.length ? `
    <h4>📋 Contratos (${contratos.length})</h4>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Número</th><th>Status</th><th>Data assinatura</th><th class="num">Valor</th></tr></thead>
      <tbody>${contratos.map(c => `<tr class="linha-clicavel" data-abrir="contrato" data-id="${c.id}" title="Abrir contrato">
        <td><strong>${esc(c.numero||"—")}</strong></td>
        <td>${tagStatus("contrato", c.status)}</td>
        <td>${dataBR(c.data_assinatura)}</td>
        <td class="num">${brl(c.valor_total||0)}</td>
      </tr>`).join("")}</tbody></table></div>` : "";

  const blocoObras = obras.length ? `
    <h4>🏗️ Obras (${obras.length})</h4>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Código</th><th>Nome</th><th>Status</th></tr></thead>
      <tbody>${obras.map(o => `<tr class="linha-clicavel" data-abrir="obra" data-id="${o.id}" title="Abrir obra">
        <td><strong>${esc(o.codigo||"—")}</strong></td>
        <td>${esc(o.nome||"—")}</td>
        <td>${tagStatus("obra", o.status)}</td>
      </tr>`).join("")}</tbody></table></div>` : "";

  const blocoMed = medicoes.length ? `
    <h4>💰 Medições (${medicoes.length})</h4>
    <div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Obra</th><th>Status</th><th>Data</th><th class="num">Itens com este orçamento</th></tr></thead>
      <tbody>${medicoes.map(m => `<tr class="linha-clicavel" data-abrir="medicao" data-id="${m.id}" title="Abrir medição">
        <td><strong>${esc(m.numero||"—")}</strong></td>
        <td>${esc(m.obra?.codigo||"")} ${esc(m.obra?.nome||"")}</td>
        <td>${tagStatus("medicao", m.status)}</td>
        <td>${dataBR(m.data_medicao)}</td>
        <td class="num">${m._itens}</td>
      </tr>`).join("")}</tbody></table></div>` : "";

  cont.innerHTML = blocoContrat + blocoObras + blocoMed;
}

/* ============================================================
   AÇÕES: NOVA REVISÃO + CRIAR CONTRATO
   ============================================================ */
async function criarNovaRevisaoOrc(){
  if(!orcEditId){ aviso("app-aviso","Salve o orçamento atual primeiro.","erro"); return; }
  const { data: atual, error: e1 } = await sb.from("orcamentos").select("*").eq("id", orcEditId).single();
  if(e1){ aviso("app-aviso","Erro: "+e1.message,"erro"); return; }
  const revAtual = parseInt(atual.numero_revisao, 10) || 0;
  const novaRev  = String(revAtual + 1).padStart(2, "0");
  if(!confirm(`Criar nova revisão ${novaRev} a partir da atual (Rev ${atual.numero_revisao || "00"})?\n\nVai copiar todos os itens. Status inicial: rascunho.`)) return;

  // Insere novo orçamento com mesmo número, revisão incrementada, status rascunho
  const novo = { ...atual };
  delete novo.id; delete novo.created_at; delete novo.updated_at;
  novo.numero_revisao = novaRev;
  novo.status = "rascunho";
  novo.observacoes = (atual.observacoes ? atual.observacoes + "\n\n" : "") + `Criado a partir da Rev ${atual.numero_revisao || "00"} em ${new Date().toLocaleString("pt-BR")}.`;

  const { data: novoOrc, error: e2 } = await sb.from("orcamentos").insert(novo).select("id").single();
  if(e2){ aviso("app-aviso","Erro ao criar revisão: "+e2.message,"erro"); return; }

  // Copia itens — se a leitura ou a cópia falhar, desfaz a revisão recém-criada
  // (antes ficava uma revisão vazia com "✅ criada").
  const { data: itensAtuais, error: errLer } = await sb.from("orcamento_itens")
    .select("ordem,secao,descricao,variante_id,quantidade,unidade,valor_unitario,observacao")
    .eq("orcamento_id", orcEditId).order("ordem");
  let errCopia = errLer || null;
  if(!errCopia && itensAtuais && itensAtuais.length){
    const novosItens = itensAtuais.map(it => ({ ...it, orcamento_id: novoOrc.id }));
    const { error: errIns } = await sb.from("orcamento_itens").insert(novosItens);
    errCopia = errIns || null;
  }
  if(errCopia){
    await sb.from("orcamentos").delete().eq("id", novoOrc.id);
    aviso("app-aviso","Não foi possível copiar os itens para a nova revisão ("+errCopia.message+"). A revisão não foi criada.","erro");
    return;
  }

  aviso("app-aviso", `✅ Revisão ${novaRev} criada. Abrindo...`, "ok");
  await carregarOrcamentos();
  await abrirOrcamento(novoOrc.id);
}

/* Orçamento aprovado → cria a obra (com o contrato do cliente junto) e
   abre a ficha da obra pra completar endereço, prazos e metas. */
async function criarObraDoOrcamento(){
  if(!orcEditId){ aviso("app-aviso","Salve o orçamento primeiro.","erro"); return; }
  const { data: orc, error } = await sb.from("orcamentos").select("*").eq("id", orcEditId).single();
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  if(orc.status !== "aprovado"){ aviso("app-aviso","Status precisa ser 'aprovado' pra criar a obra.","erro"); return; }

  const sugCodigo = orc.numero.replace(/^ORC-/i, "OB-");
  const codigo = prompt(`Código da obra (sugestão: ${sugCodigo}):`, sugCodigo);
  if(!codigo) return;
  const sugNome = `${mapaClientes[orc.cliente_id] || "Obra"} — ${orc.numero}`;
  const nome = prompt("Nome da obra:", sugNome);
  if(!nome) return;

  const origem = `orçamento ${orc.numero} Rev${orc.numero_revisao || "00"}`;

  // 1) Contrato do cliente (fica sob a aba Contrato da obra)
  const { data: contr, error: eContr } = await sb.from("contratos").insert({
    numero: codigo.trim(),
    orcamento_id: orcEditId,
    cliente_id: orc.cliente_id,
    descricao: `Contrato baseado no ${origem}`,
    status: "em_elaboracao",
    valor_total: orc.valor_total,
    natureza: "cliente",
    categoria: "empreitada",
    usa_template_cliente: false,
    observacoes: `Criado automaticamente a partir do ${origem} em ${new Date().toLocaleString("pt-BR")}.`
  }).select("id").single();
  if(eContr){
    const m = (eContr.message||"").toLowerCase();
    aviso("app-aviso", (m.includes("duplicate") || m.includes("unique"))
      ? `Já existe um contrato com o número ${codigo.trim()}. Escolha outro código.`
      : "Erro ao criar o contrato da obra: "+eContr.message, "erro");
    return;
  }

  // 2) Obra
  const { data: novaObraReg, error: eObra } = await sb.from("obras").insert({
    codigo: codigo.trim(),
    nome: nome.trim(),
    cliente_id: orc.cliente_id,
    contrato_id: contr.id,
    status: "planejada",
    valor_contratado: orc.valor_total,
    descricao: `Obra gerada a partir do ${origem}`
  }).select("id").single();
  if(eObra){
    // desfaz o contrato pra não deixar registro solto
    await sb.from("contratos").delete().eq("id", contr.id);
    const m = (eObra.message||"").toLowerCase();
    aviso("app-aviso", (m.includes("duplicate") || m.includes("unique"))
      ? `Já existe uma obra com o código ${codigo.trim()}. Escolha outro.`
      : "Erro ao criar a obra: "+eObra.message, "erro");
    return;
  }

  aviso("app-aviso", `🏗️ Obra ${codigo} criada (status: planejada).`, "ok");
  if(typeof carregarObras === "function")     await carregarObras();
  if(typeof carregarContratos === "function") await carregarContratos();
  await carregarAbasOrc(orc);
  await atualizarAcoesOrc(orc);

  // Abre a ficha da nova obra pra completar endereço, prazos e metas
  const navObras = document.querySelector('nav button[data-secao="obras"]');
  if(navObras) navObras.click();
  setTimeout(() => {
    if(typeof abrirObra === "function") abrirObra(novaObraReg.id);
  }, 120);
}

function atualizarStatusbarOrc(st){
  const bar = $("orc-statusbar");
  if(!bar) return;
  const idxAtual = ORC_STAGES.indexOf(st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    const idx = ORC_STAGES.indexOf(el.dataset.status);
    if(st === "rejeitado" || st === "cancelado"){
      if(idx === ORC_STAGES.length - 1) el.classList.add("cancelada");
    } else if(idx === idxAtual){
      el.classList.add("atual");
    } else if(idx >= 0 && idx < idxAtual){
      el.classList.add("passada");
    }
  });
}

function ativarTabOrc(nome){
  document.querySelectorAll("#orc-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#orc-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Editor de itens ---------- */
function linhaItemHTML(){
  const uns = UNIDADES.map(u=>`<option value="${u}"${u==="un"?" selected":""}>${u}</option>`).join("");
  return `<tr>
    <td><div class="it-cat-wrap"><select class="it-cat">${_opcoesFiltradasOrc()}</select><button type="button" class="it-cat-all" title="Ver todo o catálogo nesta linha" aria-pressed="false">⋯</button></div></td>
    <td><input type="text" class="it-desc" placeholder="descrição do item" /></td>
    <td><input type="number" class="it-qtd" step="0.001" min="0" value="1" /></td>
    <td><select class="it-un">${uns}</select></td>
    <td><input type="number" class="it-vu" step="0.01" min="0" value="0" /></td>
    <td class="it-total num">R$ 0,00</td>
    <td><input type="text" class="it-obs" placeholder='(opcional) ex.: Obs: Item 3 - ...' /></td>
    <td class="col-acao"><button type="button" class="btn-rem" title="remover">&times;</button></td>
  </tr>`;
}

function adicionarItem(){
  const it = $("orc-itens");
  if(it) it.insertAdjacentHTML("beforeend", linhaItemHTML());
}

function adicionarItemPreenchido(item){
  const it = $("orc-itens");
  if(!it) return;
  it.insertAdjacentHTML("beforeend", linhaItemHTML());
  const tr = it.lastElementChild;
  if(item.variante_id && _orcVarById[item.variante_id]){
    const sel = tr.querySelector(".it-cat");
    if(![...sel.options].some(o => o.value === item.variante_id)){
      sel.insertAdjacentHTML("beforeend", `<option value="${esc(item.variante_id)}">${esc(_orcVarById[item.variante_id].nome)} · fora do filtro</option>`);
    }
    sel.value = item.variante_id;
  }
  tr.querySelector(".it-desc").value  = item.descricao || "";
  tr.querySelector(".it-qtd").value   = item.quantidade != null ? item.quantidade : 1;
  const selUn = tr.querySelector(".it-un");
  if(item.unidade){
    if(![...selUn.options].some(o=>o.value===item.unidade)){
      selUn.insertAdjacentHTML("beforeend", `<option value="${esc(item.unidade)}">${esc(item.unidade)}</option>`);
    }
    selUn.value = item.unidade;
  }
  tr.querySelector(".it-vu").value  = item.valor_unitario != null ? item.valor_unitario : 0;
  tr.querySelector(".it-obs").value = item.observacao || "";
}

function aplicarItemCatalogo(select){
  const tr = select.closest("tr");
  const vid = select.value;
  if(!vid){ recalcularOrc(); return; }
  const v = _orcVarById[vid];
  if(!v) return;
  tr.querySelector(".it-desc").value = v.nome || "";
  const un = v.unidade || _orcServUnidade[v.servico_id]; // fase 40: variante pode ter unidade própria
  if(un){
    const selUn = tr.querySelector(".it-un");
    if(![...selUn.options].some(o=>o.value===un)){
      selUn.insertAdjacentHTML("beforeend", `<option value="${esc(un)}">${esc(un)}</option>`);
    }
    selUn.value = un;
  }
  const preco = _orcPrecos[vid];
  if(preco != null) tr.querySelector(".it-vu").value = Number(preco);
  // fase 40: observação padrão do serviço entra na Obs do item (sai como "Obs: Item N - …")
  const obs = tr.querySelector(".it-obs");
  if(obs && !obs.value.trim() && _orcServObs[v.servico_id]) obs.value = _orcServObs[v.servico_id];
  recalcularOrc();
}

function recalcularOrc(){
  let soma = 0;
  const it = $("orc-itens");
  if(!it) return 0;
  it.querySelectorAll("tr").forEach(tr=>{
    const q = Number(tr.querySelector(".it-qtd").value || 0);
    const v = Number(tr.querySelector(".it-vu").value || 0);
    const t = q * v;
    soma += t;
    tr.querySelector(".it-total").textContent = brl(t);
  });
  const totalEl = $("orc-total");
  if(totalEl) totalEl.textContent = brl(soma);
  const chip = $("orc-ficha-valor-chip");
  if(chip) chip.textContent = brl(soma);
  // Fase 40: ISS da proposta (por dentro = soma × p/(100-p), como na RG 11.8)
  const p  = Number($("orc-iss-perc")?.value || 0);
  const pd = !!$("orc-iss-pdentro")?.checked;
  const iss = p > 0 ? (pd && p < 100 ? soma * (p / (100 - p)) : soma * p / 100) : 0;
  if($("orc-iss-lbl"))   $("orc-iss-lbl").textContent   = `${p}%${pd ? " por dentro" : ""}`;
  if($("orc-iss-valor")) $("orc-iss-valor").textContent = brl(iss);
  if($("orc-total-iss")) $("orc-total-iss").textContent = brl(soma + iss);
  return soma;
}

/* ---------- Salvar / excluir ---------- */
async function salvarOrcamento(novoStatus){
  const cliente_id = $("orc-cliente").value;
  if(!cliente_id){ aviso("app-aviso","Selecione o cliente.","erro"); ativarTabOrc("geral"); return; }

  const itens = [];
  const it = $("orc-itens");
  if(it){
    it.querySelectorAll("tr").forEach((tr)=>{
      const desc = tr.querySelector(".it-desc").value.trim();
      if(!desc) return;
      itens.push({
        ordem:          itens.length + 1,
        secao:          null, // "Seção (agrupador)" saiu da tela em 02/09/2026 (2 de 915 itens usavam; nenhum PDF lê)
        descricao:      desc,
        quantidade:     Number(tr.querySelector(".it-qtd").value || 0),
        unidade:        tr.querySelector(".it-un").value,
        valor_unitario: Number(tr.querySelector(".it-vu").value || 0),
        observacao:     tr.querySelector(".it-obs").value.trim() || null,
        variante_id:    tr.querySelector(".it-cat").value || null
      });
    });
  }
  const valor_total = Number(recalcularOrc().toFixed(2));
  if(!$("orc-validade").value) recalcularValidadeOrc();

  const tipoProp = $("orc-tipo-proposta").value || "helice";
  const codigosRG = { helice:"RG 11.8", trado:"RG 11.9", raiz:"RG 11.10", secante:"RG 11.11", outro:"RG 11.0" };

  const reg = {
    numero:         $("orc-numero").value.trim(),
    cliente_id,
    descricao:      $("orc-descricao").value.trim() || null,
    status:         novoStatus || $("orc-status").value,
    data_orcamento: $("orc-data").value || null,
    validade:       $("orc-validade").value || null,
    valor_total,
    responsavel_id: $("orc-responsavel").value || null,
    observacoes:    $("orc-obs").value.trim() || null,
    tipo_proposta:              tipoProp,
    tipo_obra:                  $("orc-tipo-obra")?.value || "convencional",
    codigo_modelo:              codigosRG[tipoProp] || null,
    numero_revisao:             $("orc-revisao").value.trim() || "00",
    cidade_emissao:             $("orc-cidade-emissao").value.trim() || "Itabira/MG",
    referencia_obra:            $("orc-ref-obra").value.trim() || null,
    escopo_servicos:            $("orc-escopo").value || null,
    equipamento_considerado:    $("orc-equipamento").value.trim() || null,
    iss_percentual:             Number($("orc-iss-perc").value || 5),
    iss_por_dentro:             $("orc-iss-pdentro").checked,
    validade_dias:              Number($("orc-validade-dias").value || 30),
    porte_equipamento:          $("orc-porte").value || null,
    faixa_profundidade:         $("orc-faixa").value || null,
    projeto_fornecido:          $("orc-proj-forn").checked,
    sondagem_fornecida:         $("orc-sond-forn").checked,
    projeto_sondagem_fornecido: $("orc-proj-forn").checked && $("orc-sond-forn").checked, // compat
    contato_nome:               $("orc-contato-nome").value.trim() || null,
    contato_telefone:           $("orc-contato-tel").value.trim() || null,
    contato_email:              $("orc-contato-email").value.trim() || null,
    condicoes_pagamento:        $("orc-pagamento").value.trim() || null,
    prazo_execucao:             $("orc-prazo").value.trim() || null,
    local_execucao:             $("orc-local").value.trim() || null,
    cgl_fornece_diesel:         $("orc-cgl-diesel").checked,
    diesel_preco_litro:         Number($("orc-diesel-preco").value || 8.34),
    cgl_fornece_hospedagem:     $("orc-cgl-hospedagem").checked,
    hospedagem_valor_mensal:    $("orc-hosp-valor").value ? Number($("orc-hosp-valor").value) : null
  };

  let orcId = orcEditId;
  if(orcEditId){
    const { error } = await sb.from("orcamentos").update(reg).eq("id", orcEditId);
    if(error){ aviso("app-aviso","Não foi possível salvar o orçamento: "+error.message,"erro"); return; }
    const { error: errDel } = await sb.from("orcamento_itens").delete().eq("orcamento_id", orcEditId);
    if(errDel){ aviso("app-aviso","Erro ao substituir os itens: "+errDel.message+". Nada foi reinserido — tente salvar de novo.","erro"); return; }
  } else {
    const { data:novo, error } = await sb.from("orcamentos").insert(reg).select("id").single();
    if(error){ aviso("app-aviso","Não foi possível salvar o orçamento: "+error.message,"erro"); return; }
    orcId = novo.id;
    orcEditId = orcId;
  }

  if(itens.length){
    const comId = itens.map(x => ({ ...x, orcamento_id: orcId }));
    const { error:errItens } = await sb.from("orcamento_itens").insert(comId);
    if(errItens){
      aviso("app-aviso","Orçamento salvo, mas houve erro ao gravar os itens: "+errItens.message,"erro");
      await carregarOrcamentos();
      return;
    }
  }

  $("orc-status").value = reg.status;
  $("btn-excluir-orc").style.display = "";
  aviso("app-aviso", "Orçamento salvo com sucesso.", "ok");
  await carregarOrcamentos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  await abrirOrcamento(orcId);
}

async function excluirOrcamento(){
  if(!orcEditId) return;
  if(!confirm("Excluir este orçamento e seus itens?")) return;
  await sb.from("orcamento_itens").delete().eq("orcamento_id", orcEditId);
  const { error } = await sb.from("orcamentos").delete().eq("id", orcEditId);
  if(error){ aviso("app-aviso","Não foi possível excluir: "+error.message,"erro"); return; }
  aviso("app-aviso","Orçamento excluído.","ok");
  await carregarOrcamentos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  mostrarPainelOrc();
}

/* ---------- Listeners ---------- */
function ligarOrcamentos(){
  document.querySelectorAll("#orc-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#orc-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _orcView = b.dataset.view;
      renderOrcamentos();
    });
  });
  ["orc-busca","orc-f-status","orc-f-cliente","orc-f-porte"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "orc-busca" ? "input" : "change", id === "orc-busca" ? debounce(renderOrcamentos) : renderOrcamentos);
  });
  $("orc-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirOrcamento(tr.dataset.id);
  });

  $("btn-novo-orcamento")?.addEventListener("click", novoOrcamento);
  $("btn-voltar-orc")?.addEventListener("click", mostrarPainelOrc);
  $("btn-salvar-orc")?.addEventListener("click", () => comBotaoTravado("btn-salvar-orc", () => salvarOrcamento()));
  $("btn-excluir-orc")?.addEventListener("click", excluirOrcamento);
  $("btn-add-item")?.addEventListener("click", adicionarItem);

  // Filtro do catálogo (aba Modelo → aba Itens) e validade derivada
  ["orc-tipo-proposta","orc-tipo-obra","orc-porte","orc-faixa"].forEach(id => $(id)?.addEventListener("change", atualizarFiltroCatalogoOrc));
  ["orc-data","orc-validade-dias"].forEach(id => $(id)?.addEventListener("change", recalcularValidadeOrc));
  ["orc-iss-perc","orc-iss-pdentro"].forEach(id => $(id)?.addEventListener("change", recalcularOrc));
  $("btn-orc-ir-modelo")?.addEventListener("click", () => ativarTabOrc("proposta"));
  $("btn-orc-itens-padrao")?.addEventListener("click", () => carregarItensPadraoOrc(false));
  // Fase 40: ao escolher o cliente, A/c, telefone e e-mail vêm do cadastro (só se estiverem vazios)
  $("orc-cliente")?.addEventListener("change", async () => {
    const id = $("orc-cliente").value;
    if(!id) return;
    const { data:c } = await sb.from("clientes").select("contato_nome,telefone,email").eq("id", id).maybeSingle();
    if(!c) return;
    const preencher = (k, val) => { const el = $(k); if(el && !el.value.trim() && val) el.value = val; };
    preencher("orc-contato-nome",  c.contato_nome);
    preencher("orc-contato-tel",   c.telefone);
    preencher("orc-contato-email", c.email);
  });

  // Ações novas: nova revisão + criar contrato
  $("btn-orc-nova-revisao")?.addEventListener("click", criarNovaRevisaoOrc);
  $("btn-orc-criar-obra")?.addEventListener("click", criarObraDoOrcamento);

  // Smart-buttons: com um único vínculo abrem a ficha direto; senão vão para a aba
  const SB_ORC_LISTA = { "sb-orc-contratos": ["contratos", "contrato"], "sb-orc-obras": ["obras", "obra"], "sb-orc-medicoes": ["medicoes", "medicao"] };
  document.querySelectorAll(".sb-btn[data-goto-tab]").forEach(b => {
    if(b.id.startsWith("sb-orc-")){
      b.addEventListener("click", () => {
        const cfg = SB_ORC_LISTA[b.id];
        const lista = cfg ? (_orcVinculos[cfg[0]] || []) : [];
        if(lista.length === 1) orcAbrirVinculo(cfg[1], lista[0].id);
        else ativarTabOrc(b.dataset.gotoTab);
      });
    }
  });
  // Aba Vínculos: clique na linha abre a ficha
  $("orc-vinculos-conteudo")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-abrir]");
    if(tr && tr.dataset.id) orcAbrirVinculo(tr.dataset.abrir, tr.dataset.id);
  });

  const orcItens = $("orc-itens");
  if(orcItens){
    orcItens.addEventListener("input", recalcularOrc);
    orcItens.addEventListener("change", (e)=>{
      if(e.target.classList.contains("it-cat")) aplicarItemCatalogo(e.target);
    });
    orcItens.addEventListener("click", (e)=>{
      if(e.target.classList.contains("it-cat-all")){
        const btn = e.target;
        const sel = btn.closest("tr").querySelector(".it-cat");
        const ativo = !btn.classList.contains("ativo");
        btn.classList.toggle("ativo", ativo);
        btn.setAttribute("aria-pressed", ativo ? "true" : "false");
        btn.title = ativo ? "Voltar ao catálogo filtrado" : "Ver todo o catálogo nesta linha";
        _trocarOpcoesSelect(sel, ativo ? _orcCatOptions : _opcoesFiltradasOrc());
        return;
      }
      if(e.target.classList.contains("btn-rem")){
        e.target.closest("tr").remove();
        recalcularOrc();
      }
    });
  }

  document.querySelectorAll("#orc-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabOrc(b.dataset.tab));
  });
  document.querySelectorAll("#orc-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!orcEditId){
        $("orc-status").value = novo;
        atualizarStatusbarOrc(novo);
        return;
      }
      if(novo === $("orc-status").value) return;
      await salvarOrcamento(novo);
    });
  });

  const navOrc = document.querySelector('nav button[data-secao="orcamentos"]');
  if(navOrc) navOrc.addEventListener("click", mostrarPainelOrc);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarOrcamentos);
} else {
  ligarOrcamentos();
}

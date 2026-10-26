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
let _orcServAgrupado = {};  // chamado #2: servico_id -> true quando as variantes ativas têm o mesmo preço (1 opção só)

let _orcServicos  = [];   // serviços ativos com o "eixo" (helice/raiz/trado/secante/null=comum)
let _orcServById  = {};   // servico_id -> serviço (lote S44)
let _orcVariantes = [];   // variantes ativas com tipo_obra, porte, faixa_prof, unidade própria e eixo pelo nome (lote S44)
let _orcMetodos   = {};   // lote S44 (L3, #63): orcamento_id -> Set de eixos dos itens (orçamento misto filtra por cada método)
let _orcCatFiltro = { tipoProp: "helice", tipoObra: "convencional", porte: "", faixa: "" };

const ORC_PORTE_LBL = { pequeno: "Pequeno porte", medio: "Médio porte", grande: "Grande porte" };
const ORC_FAIXA_LBL = { ate18: "até 18 m", "18a24": "18 a 24 m", "24a30": "24 a 30 m", mais30: "> 30 m" };
const ORC_TIPO_LBL  = { helice: "Hélice", trado: "Trado", raiz: "Raiz", secante: "Secante", outro: "Outro" };
// lote S44 (L3, #63): filtro "Método" do painel (terminologia da UI: Hélice contínua, Hélice secante, Estaca raiz, Trado)
const ORC_METODO_LBL = { helice: "Hélice contínua", secante: "Hélice secante", raiz: "Estaca raiz", trado: "Trado" };

/* lote S44 (L4, #66): o número do orçamento é "NNNN/AAAA". O ano é reconhecido no que foi digitado
   ("8832/2026", "6114-2025", "7526-2025-E2", "4599-2023-A") e só entra quando não está lá; a proposta
   e o nome do PDF mostram "NNNN / AAAA" uma vez só (antes "8827/2026" virava "88272026 / 2026"); a
   busca do painel casa com e sem o ano. Um token "20xx" sozinho é número, não ano. */
function orcNumeroPartes(numero, dataOrcamento){
  const bruto  = String(numero || "").trim().toUpperCase().replace(/^ORC[-\s_]*/, "");
  const tokens = bruto.split(/[\/\-\s_]+/).filter(Boolean);
  let ano = null;
  if(tokens.length > 1){
    const i = tokens.findIndex(t => /^(19|20)\d{2}$/.test(t));
    if(i >= 0) ano = tokens.splice(i, 1)[0];
  }
  const anoData = dataOrcamento ? String(dataOrcamento).slice(0, 4) : String(new Date().getFullYear());
  return { num: tokens.join("-"), ano: ano || anoData, temAno: !!ano, bruto };
}
// "8832 / 2026" (proposta); número vazio vira "0000 / AAAA" como antes
function orcNumeroExibicao(numero, dataOrcamento){
  const p = orcNumeroPartes(numero, dataOrcamento);
  return `${p.num || "0000"} / ${p.ano}`;
}
// gravação: acrescenta "/AAAA" (ano da data do orçamento) só quando o número digitado não tem ano
function orcNumeroNormalizado(numero, dataOrcamento){
  const p = orcNumeroPartes(numero, dataOrcamento);
  if(!p.bruto) return "";
  return p.temAno ? String(numero).trim() : `${p.num}/${p.ano}`;
}
/* lote S44 (L8, #65, decisão do Bernardo em 19/10): o ISS "por dentro" é calculado num ponto só, usado pela
   ficha, pela lista, pelo kanban e pela proposta (js/propostas.js): iss = subtotal × p/(100−p), como na RG 11.8;
   `iss_por_dentro` desmarcado = ISS não compõe o total (chamado #18). `valor_total` no banco continua sem ISS
   (é o que vai para obras_financeiro e para a medição); o que muda é o valor exibido. */
function orcIssSobre(subtotal, o){
  const p  = Number((o && o.iss_percentual) ?? 0);
  const pd = !o || o.iss_por_dentro !== false;
  return (pd && p > 0 && p < 100) ? Number(subtotal || 0) * (p / (100 - p)) : 0;
}
function orcTotalComIss(o){
  const sub = Number((o && o.valor_total) || 0);
  return sub + orcIssSobre(sub, o);
}

// busca do painel: "8832", "8832/2026", "8832 2026" e "2026" acham "8832/2026"
function orcNumeroCasa(numero, termo){
  const t = String(termo || "").trim().toLowerCase();
  if(!t) return true;
  const n = String(numero || "").toLowerCase();
  if(n.includes(t)) return true;
  const pn = orcNumeroPartes(numero), pt = orcNumeroPartes(termo);
  if(!pn.num || !pt.num) return false;
  if(pt.temAno && pt.ano !== pn.ano) return false;
  return pn.num.toLowerCase().includes(pt.num.toLowerCase());
}

/* Fase 40: itens que não podem faltar em cada modelo de proposta (pedido do comercial).
   qtd 0 sai como "-" na proposta (igual à RG 11.8). `var` fixa a variante; sem `var`,
   entra a primeira variante que passa no filtro do Modelo (tipo de obra, porte, faixa). */
// lote S45 (L10, decisão do Bernardo em 19/10): alimentação no canteiro (VRB.ALC.SERV, variante ALC-MES, migration
// 20261020_loteS45_alimentacao_canteiro) entra como item de preço quando o adicional "CGL fornece alimentação" está
// marcado, como diesel e hospedagem; a linha de encargos da proposta (S44, L7) continua.
// lote S50 (#157, Frederico): a hélice traz o jogo adicional de trado (qtd 0: o comercial preenche quando passar de 3
// jogos) e a secante passa a ter lista própria (a da hélice + gabarito); antes `secante` era o mesmo objeto da hélice.
// lote S50 (#158): a raiz traz compressor e gerador, mobilização (qtd 1) e mensal (qtd 0). `fim` escolhe, entre as
// variantes que passam no filtro do Modelo (tipo de obra), a de código terminado assim: convencional → LOC-CO-EXT-MOB
// e LOC-CO-EXT-MES, industrial → as IND (sem variante do tipo de obra, a primeira, como na mobilização de raiz).
const ITENS_PADRAO_ORC = {
  helice: [
    { serv: "MOB.HC.SERV", qtd: 1 },
    { serv: "MOB.HC.TRADO.SERV", var: "MOB-HC-TRADO", qtd: 0 },
    { serv: "DIA.MDP.SERV" },
    { serv: "DIA.FM.HC.SERV" },
    { serv: "INS.DI.SERV", var: "INS-DI-HC" },
    { serv: "VRB.ALH.SERV" },
    { serv: "VRB.ALC.SERV" },
    { serv: "LOC.BO.SERV", var: "LOC-BO-MOB" },
    { serv: "LOC.BO.SERV", var: "LOC-BO-DIA" }
  ],
  raiz: [
    { serv: "MOB.RZ.SERV", qtd: 1 },
    { serv: "DIA.MDP.SERV" },
    { serv: "DIA.FM.RZ.SERV" },
    { serv: "INS.DI.SERV", var: "INS-DI-RZ" },
    { serv: "VRB.ALH.SERV" },
    { serv: "VRB.ALC.SERV" },
    { serv: "EXEC.RZ.INJ.SERV" },
    { serv: "LOC.CO.SERV", fim: "-MOB", qtd: 1 },
    { serv: "LOC.CO.SERV", fim: "-MES", qtd: 0 },
    { serv: "LOC.GE.SERV", fim: "-MOB", qtd: 1 },
    { serv: "LOC.GE.SERV", fim: "-MES", qtd: 0 }
  ],
  trado: [
    { serv: "MOB.ESC.SERV", var: "MOB-ESC", qtd: 1 },
    { serv: "DIA.MDP.SERV" },
    { serv: "DIA.FM.ESC.SERV" },
    { serv: "INS.DI.SERV", var: "INS-DI-HC" },
    { serv: "VRB.ALH.SERV" },
    { serv: "VRB.ALC.SERV" }
  ],
  outro: []
};
// secante usa mobilização/fat. mínimo/bomba de hélice; lote S50 (#157): lista própria, com o gabarito só nela
ITENS_PADRAO_ORC.secante = ITENS_PADRAO_ORC.helice.concat([{ serv: "INS.GAB.SERV", var: "GAB-SEC" }]);
// variante do item padrão: fixa (`var`) ou, com `fim`, a de código terminado assim
function _orcPadraoCasaVar(d, v){
  const cod = String(v?.codigo || "");
  return (!d.var || d.var === cod) && (!d.fim || cod.endsWith(d.fim));
}
// lote S50 (#157): variante fixa de um item padrão do modelo nunca some do select por eixo ("Mobilização de jogo
// adicional de trado" tem "trado" no nome e o filtro de eixo da variante a escondia na hélice e na secante)
function _orcVarPadraoFixa(tipoProp, v){
  return !!(tipoProp && v && v.codigo) && (ITENS_PADRAO_ORC[tipoProp] || []).some(d => d.var && d.var === v.codigo);
}

// Chamado #3 (Thales, 15/09/2026): eixo do serviço de execução pelo servicos.tipo_estaca
// (helice → helice_continua/hsa; trado → escavada/strauss; raiz → raiz; secante → secante).
// Serviços auxiliares (tipo_estaca nulo: mobilizações, locações, diesel, verbas…) seguem a
// classificação por caminho da categoria + nome que já existia (fase 40) — assim
// "Mobilização Raiz" continua fora de uma proposta de hélice; o que não tem eixo nenhum
// (diárias, verbas, insumos comuns) fica sempre visível. Quando a planilha do Thales
// classificar os auxiliares por tipo de proposta, esse mapeamento entra aqui.
const EIXO_POR_TIPO_ESTACA = { helice_continua: "helice", hsa: "helice", escavada: "trado", strauss: "trado", raiz: "raiz", secante: "secante" };
function _eixoServicoOrc(texto, tipoEstaca){
  const t = (texto || "").toLowerCase();
  if(t.includes("secante")) return "secante"; // "Estaca Hélice Secante" tem tipo_estaca helice_continua
  if(tipoEstaca && EIXO_POR_TIPO_ESTACA[tipoEstaca]) return EIXO_POR_TIPO_ESTACA[tipoEstaca];
  if(t.includes("hélice") || t.includes("helice")) return "helice";
  if(t.includes("raiz") || t.includes("raíz")) return "raiz";
  if(t.includes("trado") || t.includes("escavad")) return "trado";
  return null; // comum: diárias, insumos, verbas, bomba/compressor/gerador…
}

async function prepararCatalogoOrc(){
  const [srv, vrt, prc, cat] = await Promise.all([
    sb.from("servicos").select("id,codigo,nome,unidade,categoria_id,ativo,observacoes_padrao,tipo_estaca").order("codigo"),
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
                    .map(s => ({ ...s, eixo: _eixoServicoOrc(caminho(s.categoria_id) + " " + s.nome, s.tipo_estaca) }));
  // lote S44 (L2, #61): a variante também ganha eixo pelo nome ("Diária Equipe Raiz", "Diesel para
  // equipamento Raiz"): serviço genérico com variantes por método só mostra as do método da proposta
  _orcVariantes = (vrt.data || []).filter(v => v.ativo !== false).map(v => ({ ...v, eixo: _eixoServicoOrc(v.nome, null) }));
  _orcServById  = {};
  _orcServicos.forEach(s => { _orcServById[s.id] = s; });

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
  // Chamado #2 (Thales, 15/09/2026): serviço com 2+ variantes ativas, todas com preço e o MESMO
  // preço (ex.: Óleo Diesel S10 — "Diesel p/ Hélice" e "Diesel p/ Raiz", R$ 10,01/L), vira UMA
  // opção com o nome do serviço. As variantes continuam no banco (22 itens de orçamentos
  // apontam para elas); ao escolher, grava-se o variante_id da primeira variante que passa
  // no filtro. Se os preços divergirem no futuro, o seletor volta a separar sozinho.
  _orcServAgrupado = {};
  _orcServicos.forEach(s => {
    const vars = _orcVariantes.filter(v => v.servico_id === s.id);
    if(vars.length < 2) return;
    const precos = vars.map(v => _orcPrecos[v.id]);
    if(precos.some(p => p == null)) return;
    if(precos.every(p => Number(p) === Number(precos[0]))) _orcServAgrupado[s.id] = true;
  });
  _orcCatOptions = montarOpcoesCatalogoOrc(null); // catálogo completo
}

// Nome que vai para a descrição do item: nome do serviço quando as variantes estão agrupadas
function _nomeItemCatalogoOrc(v){
  if(!v) return "";
  if(_orcServAgrupado[v.servico_id]){
    const s = _orcServicos.find(x => x.id === v.servico_id);
    if(s) return s.nome || v.nome || "";
  }
  return v.nome || "";
}

// Seleciona a variante no select: opção exata; senão a opção agrupada que a contém (o value
// passa a ser o id guardado no item, preservando o variante_id existente); senão "fora do filtro".
function _selecionarVarianteSelect(sel, vid){
  if(!vid){ sel.value = ""; return; }
  if([...sel.options].some(o => o.value === vid)){ sel.value = vid; return; }
  const grp = [...sel.options].find(o => o.dataset.grupo && o.dataset.grupo.split(",").includes(vid));
  if(grp){ grp.value = vid; sel.value = vid; return; }
  const v = _orcVarById[vid];
  sel.insertAdjacentHTML("beforeend", `<option value="${esc(vid)}">${esc(v ? _nomeItemCatalogoOrc(v) : "(item)")} · fora do filtro</option>`);
  sel.value = vid;
}

function _servicoVisivelOrc(s, tipoProp, f){
  // Chamado #11 (Thales, 16/09/2026): diesel e hospedagem só aparecem na aba Itens quando a CGL fornece (aba Adicionais CGL)
  const cod = String(s.codigo || "");
  if(f && cod.startsWith("INS.DI") && f.cglDiesel === false) return false;
  if(f && cod.startsWith("VRB.ALH") && f.cglHosp === false) return false;
  if(f && cod.startsWith("VRB.ALC") && f.cglAlim === false) return false;   // lote S45 (L10): alimentação no canteiro
  if(!tipoProp || tipoProp === "outro" || !s.eixo) return true;
  if(s.eixo === tipoProp) return true;
  if(tipoProp === "secante" && s.eixo === "helice") return true; // secante usa mobilização/locação/fat. mínimo de hélice
  return false;
}

// Variantes de um serviço que passam no filtro (tipo de obra, porte, faixa de profundidade).
// Cada critério só é aplicado se sobrar alguma variante — serviço sem variante do tipo/porte/faixa
// escolhido mostra todas (ex.: Mão de Obra Extra só tem industrial). Variante sem porte/faixa
// (nulo) vale para qualquer.
// lote S44 (L2, #61): eixos de variante aceitos por tipo de proposta. Secante e trado usam a variante de
// hélice quando não têm a própria (mesma família de equipamento: "Diária Equipe Hélice", "Diesel p/ Hélice").
const ORC_EIXOS_VARIANTE = { helice: ["helice"], secante: ["secante", "helice"], trado: ["trado", "helice"], raiz: ["raiz"] };
// lote S49 (#136): a faixa de profundidade nunca esconde um diâmetro. Ø 900 e 1000 só têm preço de 24 a 30 m e acima
// de 30 m, e Ø 1100 e 1200 só de 24 a 30 m: com o Modelo em "até 18 m" ou "18 a 24 m" o filtro por serviço deixava o
// select da hélice parar no Ø 800. Agora a faixa vale por diâmetro ("Ø 900mm" no nome; sem Ø, o serviço inteiro é um
// grupo, como antes): o diâmetro sem a faixa escolhida mostra a faixa mais próxima, marcada "faixa mais próxima" no
// select, e escolher essa variante avisa para conferir o valor. O porte só existe na mobilização de hélice (conferido em
// 22/10) e não esconde execução.
const ORC_FAIXAS = ["ate18", "18a24", "24a30", "mais30"];
function _orcGrupoFaixa(v){ const m = String(v.nome || "").match(/Ø\s*(\d+)/); return m ? "Ø" + m[1] : "_"; }
function _orcFaixaAproximada(v, f){ return !!(f && f.faixa && v && v.faixa_prof && v.faixa_prof !== f.faixa); }
function _variantesFiltradasOrc(s, f){
  let vars = _orcVariantes.filter(v => v.servico_id === s.id);
  if(!vars.length || !f) return vars;
  if(f.tipoProp && f.tipoProp !== "outro"){
    // variante de outro método nunca aparece (estrito): "Diária Equipe Raiz" some do orçamento de hélice
    const ok = ORC_EIXOS_VARIANTE[f.tipoProp] || [f.tipoProp];
    vars = vars.filter(v => !v.eixo || ok.includes(v.eixo) || _orcVarPadraoFixa(f.tipoProp, v));   // lote S50 (#157)
  }
  if(f.tipoObra){
    const d = vars.filter(v => v.tipo_obra === f.tipoObra || v.tipo_obra === "especial");
    if(d.length) vars = d;
  }
  if(f.porte){
    const d = vars.filter(v => !v.porte || v.porte === f.porte);
    if(d.length) vars = d;
  }
  if(f.faixa){
    // lote S49 (#136): por grupo de diâmetro; variante sem faixa vale para qualquer
    const alvo = ORC_FAIXAS.indexOf(f.faixa);
    const dist = (v) => { const i = ORC_FAIXAS.indexOf(v.faixa_prof); return i < 0 || alvo < 0 ? 99 : Math.abs(i - alvo); };
    const grupos = {};
    vars.forEach(v => { if(v.faixa_prof) (grupos[_orcGrupoFaixa(v)] = grupos[_orcGrupoFaixa(v)] || []).push(v); });
    const fica = new Set(vars.filter(v => !v.faixa_prof).map(v => v.id));
    Object.values(grupos).forEach(g => {
      const menor = Math.min(...g.map(dist));
      g.forEach(v => { if(dist(v) === menor) fica.add(v.id); });
    });
    vars = vars.filter(v => fica.has(v.id));
  }
  return vars;
}

// f nulo = catálogo completo; senão { tipoProp, tipoObra, porte, faixa }
function montarOpcoesCatalogoOrc(f){
  let html = '<option value="">— item livre (digitar) —</option>';
  _orcServicos.forEach(s => {
    if(f && !_servicoVisivelOrc(s, f.tipoProp, f)) return;
    const vars = _variantesFiltradasOrc(s, f);
    if(!vars.length) return;
    if(_orcServAgrupado[s.id]){
      // chamado #2: 1 opção com o nome do serviço; value = 1ª variante do filtro; data-grupo = todas as ativas
      const todas = _orcVariantes.filter(v => v.servico_id === s.id).map(v => v.id).join(",");
      html += `<optgroup label="${esc(s.nome)}"><option value="${esc(vars[0].id)}" data-grupo="${esc(todas)}">${esc(s.nome)}</option></optgroup>`;
      return;
    }
    html += `<optgroup label="${esc(s.nome)}">`
          + vars.map(v => `<option value="${esc(v.id)}">${esc(v.nome)}${_orcFaixaAproximada(v, f) ? " · faixa mais próxima" : ""}</option>`).join("")
          + `</optgroup>`;
  });
  return html;
}
function _opcoesFiltradasOrc(){ return montarOpcoesCatalogoOrc(_orcCatFiltro); }

// Troca as opções do select preservando o item escolhido (mesmo fora do filtro)
function _trocarOpcoesSelect(sel, html){
  const atual = sel.value;
  sel.innerHTML = html;
  _selecionarVarianteSelect(sel, atual);
}

// Muda tipo de proposta / tipo de obra / porte / faixa → refaz o select de cada linha (exceto as
// em "todo o catálogo"). Fase 40: linha cujo item ficou fora do filtro troca sozinha para a variante
// equivalente do mesmo serviço quando ela é única (ex.: Fat. mínimo 24-30m → até 18m) ou quando
// só muda o porte e a distância é a mesma (Mob. Grande (até 100km) → Mob. Médio (até 100km)).
function atualizarFiltroCatalogoOrc(){
  _orcCatFiltro = {
    tipoProp: $("orc-tipo-proposta")?.value || "helice",
    cglDiesel: !!$("orc-cgl-diesel")?.checked,      // chamado #11
    cglHosp:   !!$("orc-cgl-hospedagem")?.checked,  // chamado #11
    cglAlim:   !!$("orc-cgl-alimentacao")?.checked, // lote S45 (L10)
    tipoObra: $("orc-tipo-obra")?.value || "convencional",
    porte:    $("orc-porte")?.value || "",
    faixa:    $("orc-faixa")?.value || ""
  };
  const html = _opcoesFiltradasOrc();
  let ajustados = 0, aproximados = 0;
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
    // lote S50 (#158): compressor/gerador padrão da raiz troca de tipo de obra mantendo mobilização ou mensal
    const dP = (ITENS_PADRAO_ORC[_orcCatFiltro.tipoProp] || [])[_orcPadraoIdx(_orcCatFiltro.tipoProp, v)];
    if(dP && dP.fim) cand = cand.filter(c => _orcPadraoCasaVar(dP, c));
    if(cand.length > 1){
      // mesma distância "(até 100km)" (mobilização por porte) …
      const suf = (v.nome.match(/\(([^)]*)\)\s*$/) || [])[1];
      if(suf) cand = cand.filter(c => c.nome.endsWith(`(${suf})`));
    }
    if(cand.length > 1){
      // … ou mesmo diâmetro em outra faixa ("Hélice Ø 600mm 24 a 30m" → "Hélice Ø 600mm até 18m"; lote S49, #136:
      // pelo Ø do nome, que também pega "acima de 30m" e a faixa mais próxima do Ø 900+)
      const g = _orcGrupoFaixa(v);
      let c2 = g !== "_" ? cand.filter(c => c.faixa_prof && _orcGrupoFaixa(c) === g) : [];
      if(!c2.length){
        const faixaRe = /\s*(até 18 ?m|18 a 24 ?m|24 a 30 ?m|> ?30 ?m|acima de 30 ?m)\s*$/i;
        const base = v.nome.replace(faixaRe, "").trim();
        c2 = cand.filter(c => faixaRe.test(c.nome) && c.nome.replace(faixaRe, "").trim() === base);
      }
      if(c2.length) cand = c2;
    }
    if(cand.length === 1){
      sel.value = cand[0].id;
      aplicarItemCatalogo(sel, true);
      ajustados++;
      if(_orcFaixaAproximada(cand[0], _orcCatFiltro)) aproximados++;
    }
  });
  if(ajustados) aviso("app-aviso", `${ajustados} item(ns) trocado(s) para a variante do porte/faixa escolhidos no Modelo`
    + (aproximados ? ` (${aproximados} na faixa mais próxima: o diâmetro não tem preço na faixa escolhida)` : "")
    + " — confira valores.", aproximados ? "aviso" : "ok");
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
  // Chamado #11: diesel e hospedagem só entram como padrão quando a CGL fornece (aba Adicionais CGL); S45 (L10): alimentação idem
  const cglDiesel = !!$("orc-cgl-diesel")?.checked, cglHosp = !!$("orc-cgl-hospedagem")?.checked, cglAlim = !!$("orc-cgl-alimentacao")?.checked;
  const lista = (ITENS_PADRAO_ORC[tipo] || []).filter(d => !(d.serv.startsWith("INS.DI") && !cglDiesel) && !(d.serv.startsWith("VRB.ALH") && !cglHosp) && !(d.serv.startsWith("VRB.ALC") && !cglAlim));
  if(!lista.length || !_orcServicos.length) return 0;
  const presentes = new Set([...document.querySelectorAll("#orc-itens .it-cat")].map(s => s.value).filter(Boolean));
  const servPresentes = new Set([...presentes].map(id => _orcVarById[id]?.servico_id).filter(Boolean));
  let n = 0;
  lista.forEach(d => {
    const s = _orcServByCod[d.serv];
    if(!s) return;
    let v = d.var ? _orcVarByCod[d.var] : null;
    if(!v) v = _variantesFiltradasOrc(s, _orcCatFiltro).find(x => _orcPadraoCasaVar(d, x));   // lote S50 (#158): `fim`
    if(!v || presentes.has(v.id)) return;
    if(d.fim){   // lote S50 (#158): já tem variante do serviço com o mesmo fim (outro tipo de obra ou distância)? não duplica
      if([...presentes].some(id => _orcVarById[id]?.servico_id === s.id && _orcPadraoCasaVar(d, _orcVarById[id]))) return;
    } else if(!d.var && servPresentes.has(s.id)) return;
    adicionarItemPreenchido({
      variante_id:    v.id,
      descricao:      _nomeItemCatalogoOrc(v),
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

/* Lote S49 (#134, Frederico): "ao fazer proposta raiz, mobilização e desmobilização não aparecem". A proposta nova nasce
   como Hélice e já com os itens padrão de hélice; trocar o Tipo de proposta só refiltrava o catálogo, então a
   Mob./Desmob. Hélice ficava na lista "fora do filtro" e a de raiz (MOB.RZ.SERV), o fat. mínimo e a injeção raiz só
   entravam pelo botão "Itens padrão". Agora trocar o tipo troca os itens padrão: as linhas padrão do modelo anterior
   que ninguém mexeu (mesma variante, quantidade padrão, preço de referência e descrição do catálogo) saem, as do modelo
   novo entram com a variante do tipo de obra escolhido (a distância se escolhe no item: até 100 km, 100-500 km, > 500 km)
   e os itens padrão sobem para o topo na ordem do modelo. Linha editada fica. "Outro" não tira nada. */
function _orcPadraoIdx(tipo, v){
  const s = v && _orcServById[v.servico_id];
  if(!s) return -1;
  return (ITENS_PADRAO_ORC[tipo] || []).findIndex(d => d.serv === s.codigo && _orcPadraoCasaVar(d, v));   // lote S50: + `fim`
}
function orcTrocarModelo(){
  const sel = $("orc-tipo-proposta");
  const novo = sel?.value || "helice";
  const ant = sel?.dataset.anterior || "helice";
  if(sel) sel.dataset.anterior = novo;
  atualizarFiltroCatalogoOrc();
  if(ant === novo || !(ITENS_PADRAO_ORC[novo] || []).length) return;
  const corpo = $("orc-itens");
  if(!corpo) return;
  let removidos = 0, mantidos = 0;
  [...corpo.querySelectorAll("tr")].forEach(tr => {
    const v = _orcVarById[tr.querySelector(".it-cat")?.value];
    const iAnt = _orcPadraoIdx(ant, v);
    if(iAnt < 0 || _orcPadraoIdx(novo, v) >= 0) return;   // não é padrão do anterior, ou é dos dois (platô, hospedagem…)
    const d = ITENS_PADRAO_ORC[ant][iAnt];
    const qtd = Number(tr.querySelector(".it-qtd")?.value || 0);
    const vu = Number(tr.querySelector(".it-vu")?.value || 0);
    const ref = _orcPrecos[v.id] != null ? Number(_orcPrecos[v.id]) : 0;
    const desc = (tr.querySelector(".it-desc")?.value || "").trim();
    if(qtd === Number(d.qtd || 0) && Math.abs(vu - ref) < 0.005 && desc === _nomeItemCatalogoOrc(v)){ tr.remove(); removidos++; }
    else mantidos++;
  });
  const n = carregarItensPadraoOrc(true);
  if(removidos || n){
    // itens padrão do modelo novo no topo, na ordem do modelo; o resto na ordem em que estava
    const linhas = [...corpo.querySelectorAll("tr")].map((tr, i) => {
      const k = _orcPadraoIdx(novo, _orcVarById[tr.querySelector(".it-cat")?.value]);
      return { tr, i, k: k < 0 ? Infinity : k };
    });
    linhas.sort((a, b) => (a.k - b.k) || (a.i - b.i)).forEach(l => corpo.appendChild(l.tr));
    recalcularOrc();
  }
  const lbl = (t) => ORC_TIPO_LBL[t] || t;
  if(removidos || n || mantidos){
    aviso("app-aviso", `Modelo ${lbl(novo)}: ${n} item(ns) padrão incluído(s) (mobilização/desmobilização com a variante do tipo de obra; escolha a distância no item)`
      + (removidos ? `, ${removidos} item(ns) padrão de ${lbl(ant)} retirado(s)` : "")
      + (mantidos ? `; ${mantidos} item(ns) de ${lbl(ant)} editado(s) ficaram, confira` : "") + ".", mantidos ? "aviso" : "ok");
  }
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
  const COLS = "id,numero,cliente_id,data_orcamento,status,valor_total,validade,responsavel_id,tipo_proposta,porte_equipamento,faixa_profundidade,iss_percentual,iss_por_dentro";
  const ler = (cols) => sb.from("orcamentos").select(cols).order("data_orcamento",{ ascending:false });
  let [{ data, error }, itensEixo] = await Promise.all([ler(COLS + ",concorrencia"), orcBuscarItensEixo()]);
  // lote S47 (#111): antes da migration 20261022_loteS47 a coluna não existe; lê sem ela e o campo fica escondido
  if(error && /concorrencia/i.test(error.message || "")) ({ data, error } = await ler(COLS));
  else if(!error) _orcTemConcorrencia = true;
  _orcamentos = error ? [] : (data || []);
  orcAtualizarConcorrencias();
  // lote S44 (L3, #63): métodos de cada orçamento = tipo da proposta + eixo dos serviços dos itens
  // (orçamento misto aparece em cada método que tiver)
  _orcMetodos = {};
  itensEixo.forEach(it => {
    const eixo = _orcEixoVariante(it.variante_id);
    if(!eixo) return;
    (_orcMetodos[it.orcamento_id] = _orcMetodos[it.orcamento_id] || new Set()).add(eixo);
  });
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

/* lote S44 (L3): itens com variante de todos os orçamentos, em páginas de 1000 (limite do PostgREST) */
async function orcBuscarItensEixo(){
  const out = [], passo = 1000;
  for(let de = 0; ; de += passo){
    const { data, error } = await sb.from("orcamento_itens").select("orcamento_id,variante_id")
      .not("variante_id", "is", null).order("id").range(de, de + passo - 1);
    if(error || !data || !data.length) break;
    out.push(...data);
    if(data.length < passo) break;
  }
  return out;
}
// eixo de uma variante: o dela (pelo nome) ou o do serviço
function _orcEixoVariante(vid){
  const v = _orcVarById[vid];
  if(!v) return null;
  if(v.eixo) return v.eixo;
  const s = _orcServById[v.servico_id];
  return s ? (s.eixo || null) : null;
}
// o orçamento "tem" o método quando é o tipo da proposta ou algum item é daquele eixo
function orcTemMetodo(o, metodo){
  if(!metodo) return true;
  if(o.tipo_proposta === metodo) return true;
  const m = _orcMetodos[o.id];
  return !!(m && m.has(metodo));
}

/* ---------- Lote S47 (#111): concorrência ----------
   orcamentos.concorrencia = empreendimento do cliente final (ex.: "Vale – Ramal João Paulo – Itabira/MG"). Várias
   construtoras pedem proposta para a mesma obra: cada uma tem a sua proposta e o seu número; a concorrência só junta.
   Campo na aba Modelo com as já usadas (datalist); ao escolher uma existente, os campos comuns vazios do Modelo vêm
   da proposta mais recente dela. Filtro e agrupamento no painel ("3 propostas · 1 aprovada"). */
let _orcTemConcorrencia = false;
let _orcConcorrencias = [];   // [{ nome, propostas, aprovadas }] por nome (sem diferença de maiúsculas)
const ORC_CONC_AGRUPAR = "__agrupar";
const orcConcChave = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
function orcAtualizarConcorrencias(){
  const mapa = {};
  _orcamentos.forEach(o => {
    const k = orcConcChave(o.concorrencia);
    if(!k) return;
    const g = mapa[k] || (mapa[k] = { nome: String(o.concorrencia).trim(), numeros: new Set(), aprov: new Set() });
    g.numeros.add(o.numero || o.id);   // revisões do mesmo número contam como uma proposta
    if(o.status === "aprovado") g.aprov.add(o.numero || o.id);
  });
  _orcConcorrencias = Object.values(mapa).map(g => ({ nome: g.nome, propostas: g.numeros.size, aprovadas: g.aprov.size }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const dl = $("orc-conc-lista");
  if(dl) dl.innerHTML = _orcConcorrencias.map(c => `<option value="${esc(c.nome)}"></option>`).join("");
  const campo = $("orc-concorrencia")?.closest(".campo");
  if(campo) campo.style.display = _orcTemConcorrencia ? "" : "none";
  const fc = $("orc-f-conc");
  if(fc) fc.style.display = _orcTemConcorrencia ? "" : "none";
}
const orcConcResumo = (g) => `${g.propostas} proposta${g.propostas === 1 ? "" : "s"} · ${g.aprovadas} aprovada${g.aprovadas === 1 ? "" : "s"}`;
// escolheu uma concorrência já usada: grafia dela e campos comuns vazios da proposta mais recente
async function orcAoEscolherConcorrencia(){
  const el = $("orc-concorrencia");
  if(!el || !_orcTemConcorrencia) return;
  const k = orcConcChave(el.value);
  const g = _orcConcorrencias.find(c => orcConcChave(c.nome) === k);
  if(!k || !g) return;
  el.value = g.nome;
  const base = _orcamentos.filter(o => orcConcChave(o.concorrencia) === k && o.id !== orcEditId)
    .sort((a, b) => String(b.data_orcamento || "").localeCompare(String(a.data_orcamento || "")))[0];
  if(!base) return;
  const { data: o } = await sb.from("orcamentos")
    .select("referencia_obra,escopo_servicos,equipamento_considerado,prazo_execucao,local_execucao").eq("id", base.id).maybeSingle();
  if(!o) return;
  const preencher = (id, val) => { const c = $(id); if(c && !String(c.value || "").trim() && val) c.value = val; };
  preencher("orc-ref-obra", o.referencia_obra);
  preencher("orc-escopo", o.escopo_servicos);
  preencher("orc-equipamento", o.equipamento_considerado);
  preencher("orc-prazo", o.prazo_execucao);
  preencher("orc-local", o.local_execucao);
}

/* ---------- Lote S47 (#112): ordenação pelo cabeçalho (ordenarTabela, core.js) ---------- */
const _orcOrdem = ordenarTabela({
  numero:   { tipo: "num",   valor: o => { const p = orcNumeroPartes(o.numero, o.data_orcamento); const n = parseInt(p.num, 10); return Number.isFinite(n) ? Number(p.ano) * 1e6 + n : null; } },
  cliente:  { tipo: "texto", valor: o => mapaClientes[o.cliente_id] || "" },
  tipo:     { tipo: "texto", valor: o => { const t = _orcTipoPorteTxt(o); return t === "—" ? "" : t; } },
  data:     { tipo: "data",  valor: o => o.data_orcamento || "", dirInicial: "desc" },
  validade: { tipo: "data",  valor: o => o.validade || "" },
  status:   { tipo: "texto", valor: o => (STATUS.orcamento && STATUS.orcamento[o.status] ? STATUS.orcamento[o.status].label : o.status) || "" },
  valor:    { tipo: "num",   valor: o => orcTotalComIss(o), dirInicial: "desc" },
  concorrencia: { tipo: "texto", valor: o => o.concorrencia || "" }
}, { chave: "orc-ordem" });

/* ---------- Filtros ---------- */
function orcFiltrados(){
  const termo = ($("orc-busca")?.value || "").trim().toLowerCase();
  const fStat  = $("orc-f-status")?.value || "";
  const fCli   = $("orc-f-cliente")?.value || "";
  const fPorte = $("orc-f-porte")?.value || "";
  const fMet   = $("orc-f-metodo")?.value || "";
  const fConc  = $("orc-f-conc")?.value || "";   // lote S47 (#111)
  return _orcamentos.filter(o => {
    if(fStat && o.status !== fStat) return false;
    if(fCli && o.cliente_id !== fCli) return false;
    if(fPorte && (o.porte_equipamento || "") !== fPorte) return false;
    if(fMet && !orcTemMetodo(o, fMet)) return false;
    if(fConc && fConc !== ORC_CONC_AGRUPAR && orcConcChave(o.concorrencia) !== fConc) return false;
    if(termo){
      const cli = (mapaClientes[o.cliente_id] || "").toLowerCase();
      // lote S44 (L4): com e sem o ano; lote S47: a busca também acha pela concorrência
      if(!(orcNumeroCasa(o.numero, termo) || cli.includes(termo) || orcConcChave(o.concorrencia).includes(termo))) return false;
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
  const selMet = $("orc-f-metodo");   // lote S44 (L3, #63)
  if(selMet && !selMet.options.length){
    selMet.innerHTML = `<option value="">Todos os métodos</option>` +
      Object.entries(ORC_METODO_LBL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  }
  const selConc = $("orc-f-conc");   // lote S47 (#111): agrupar ou escolher uma concorrência
  if(selConc){
    const atual = selConc.value;
    selConc.innerHTML = `<option value="">Todas as concorrências</option><option value="${ORC_CONC_AGRUPAR}">Agrupar por concorrência</option>` +
      _orcConcorrencias.map(c => `<option value="${esc(orcConcChave(c.nome))}">${esc(c.nome)} (${esc(orcConcResumo(c))})</option>`).join("");
    selConc.value = [...selConc.options].some(o => o.value === atual) ? atual : "";
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
  // lote S44 (L3): orçamento misto mostra os outros métodos dos itens ("Hélice · … · + Raiz");
  // o apoio de hélice em secante e trado não conta como outro método
  const apoio = ORC_EIXOS_VARIANTE[o.tipo_proposta] || [o.tipo_proposta];
  const extras = [...(_orcMetodos[o.id] || [])].filter(m => !apoio.includes(m)).map(m => "+ " + (ORC_TIPO_LBL[m] || m));
  return [ORC_TIPO_LBL[o.tipo_proposta] || "", ORC_PORTE_LBL[o.porte_equipamento], ORC_FAIXA_LBL[o.faixa_profundidade], ...extras]
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
  const comConc = _orcTemConcorrencia;   // lote S47 (#111): coluna Concorrência depois da migration
  const nCols = comConc ? 8 : 7;
  const linha = (o) => `<tr class="linha-clicavel" data-id="${esc(o.id)}">
    <td>${esc(o.numero)}</td>
    <td>${esc(mapaClientes[o.cliente_id]||"—")}</td>
    ${comConc ? `<td>${o.concorrencia ? esc(o.concorrencia) : '<span class="meta">—</span>'}</td>` : ""}
    <td>${esc(_orcTipoPorteTxt(o))}</td>
    <td>${dataBR(o.data_orcamento)}</td>
    <td>${dataBR(o.validade)}</td>
    <td>${tagStatus("orcamento", o.status)}</td>
    <td class="num" title="Total da proposta, com ISS por dentro (sem ISS: ${brl(o.valor_total)})">${brl(orcTotalComIss(o))}</td>
  </tr>`;
  // lote S47 (#112): ordenação pelo cabeçalho; (#111) agrupada quando o filtro pede uma concorrência ou o agrupamento
  const ordenados = _orcOrdem.aplicar(dados);
  const fConc = $("orc-f-conc")?.value || "";
  let corpo;
  if(comConc && fConc){
    const grupos = new Map();
    ordenados.forEach(o => {
      const k = orcConcChave(o.concorrencia);
      if(!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(o);
    });
    const chaves = [...grupos.keys()].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b, "pt-BR"));
    corpo = chaves.map(k => {
      const g = _orcConcorrencias.find(c => orcConcChave(c.nome) === k);
      const rot = k ? `${esc(g ? g.nome : grupos.get(k)[0].concorrencia)} · ${esc(g ? orcConcResumo(g) : "")}` : "Sem concorrência";
      return `<tr class="orc-grupo-conc"><td colspan="${nCols}">${rot}</td></tr>` + grupos.get(k).map(linha).join("");
    }).join("");
  } else corpo = ordenados.map(linha).join("");
  const th = (col, rot, extra) => _orcOrdem.th(col, rot, extra);
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      ${th("numero", "Número")}${th("cliente", "Cliente")}${comConc ? th("concorrencia", "Concorrência") : ""}${th("tipo", "Tipo · Porte")}${th("data", "Data")}${th("validade", "Validade")}${th("status", "Status")}${th("valor", "Valor c/ ISS", { cls: "num", title: "Total da proposta com ISS por dentro (lote S44, #65)" })}
    </tr></thead>
    <tbody>${corpo}</tbody></table></div>`;
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
          ${o.concorrencia ? `<span class="meta" title="Concorrência (lote S47, #111)">🏗️ ${esc(o.concorrencia)}</span>` : ""}
        </div>
        <div class="serv-kan-card-rod">
          <span class="meta">c/ ISS</span>
          <strong title="Total da proposta com ISS (sem ISS: ${brl(o.valor_total)})">${brl(orcTotalComIss(o))}</strong>
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
   "orc-hosp-valor","orc-porte","orc-faixa","orc-contato-nome","orc-contato-tel","orc-contato-email","orc-concorrencia"]
    .forEach(k => { const el = $(k); if(el) el.value = ""; });
  $("orc-itens").innerHTML = "";
  $("orc-status").value = "rascunho";
  $("orc-data").value = hojeISO();
  // lote S44 (L4): sugestão = maior número da sequência da CGL + 1, com o ano atual ("8833/2026"); continua editável
  const maxN = _orcamentos.reduce((m, o) => { const n = parseInt(orcNumeroPartes(o.numero, o.data_orcamento).num, 10); return Number.isFinite(n) ? Math.max(m, n) : m; }, 0);
  $("orc-numero").value = maxN ? `${maxN + 1}/${new Date().getFullYear()}` : "";
  // Fase 40: responsável = quem está logado (continua editável)
  const selResp = $("orc-responsavel");
  if(selResp && typeof usuarioAtual !== "undefined" && usuarioAtual && [...selResp.options].some(o => o.value === usuarioAtual.id)){
    selResp.value = usuarioAtual.id;
  }
  $("orc-tipo-proposta").value  = "helice";
  $("orc-tipo-proposta").dataset.anterior = "helice";   // lote S49 (#134): base da troca de itens padrão
  $("orc-revisao").value        = "00";
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
  if($("orc-cgl-alimentacao")) $("orc-cgl-alimentacao").checked = false;   // lote S44 (L7, #62)
  // Fase 40: condição de pagamento já vem com o texto padrão do modelo (edita-se na negociação)
  if($("orc-prazo-pagamento")) $("orc-prazo-pagamento").value = "15";
  if($("orc-pagamento-forma")) $("orc-pagamento-forma").value = "deposito";
  if(typeof textoPagamentoPadrao === "function") $("orc-pagamento").value = textoPagamentoPadrao(15, "deposito"); // chamado #12
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
  $("orc-tipo-proposta").dataset.anterior = o.tipo_proposta || "helice";   // lote S49 (#134)
  $("orc-revisao").value         = o.numero_revisao || "00";
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
  if($("orc-prazo-pagamento")) $("orc-prazo-pagamento").value = String(o.prazo_pagamento_dias || 15);
  if($("orc-pagamento-forma")) $("orc-pagamento-forma").value = o.pagamento_forma || "deposito";
  $("orc-pagamento").value       = o.condicoes_pagamento || (typeof textoPagamentoPadrao === "function" ? textoPagamentoPadrao(o.prazo_pagamento_dias, o.pagamento_forma) : "");
  $("orc-prazo").value           = o.prazo_execucao || "";
  $("orc-local").value           = o.local_execucao || "";
  if($("orc-concorrencia")) $("orc-concorrencia").value = o.concorrencia || "";   // lote S47 (#111)
  $("orc-cgl-diesel").checked      = o.cgl_fornece_diesel === true;
  $("orc-diesel-preco").value      = o.diesel_preco_litro != null ? o.diesel_preco_litro : 8.34;
  $("orc-cgl-hospedagem").checked  = o.cgl_fornece_hospedagem === true;
  $("orc-hosp-valor").value        = o.hospedagem_valor_mensal != null ? o.hospedagem_valor_mensal : "";
  if($("orc-cgl-alimentacao")) $("orc-cgl-alimentacao").checked = o.cgl_fornece_alimentacao === true;   // lote S44 (L7, #62)

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
  $("orc-ficha-valor-chip").textContent = brl(orcTotalComIss(o));   // lote S44 (L8): total com ISS, igual ao da proposta
  if($("orc-ficha-validade-chip")) $("orc-ficha-validade-chip").textContent = dataBR(o.validade);
  $("orc-ficha-titulo").textContent = orcEditId ? `Orçamento ${o.numero} · Rev ${o.numero_revisao||"00"}` : "Novo orçamento";
  const btnNovoCli = $("btn-orc-novo-cliente");   // lote S49 (#140)
  if(btnNovoCli) btnNovoCli.style.display = orcPodeCadastrarCliente() ? "" : "none";

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
      .select("id,numero_revisao,status,valor_total,iss_percentual,iss_por_dentro,data_orcamento,updated_at")
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
      <td class="num" title="sem ISS: ${brl(r.valor_total||0)}">${brl(orcTotalComIss(r))}</td>
      <td>${dataBR(r.data_orcamento)}</td>
      <td>${new Date(r.updated_at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Revisão</th><th>Status</th><th class="num">Valor c/ ISS</th><th>Data</th><th>Atualizado em</th></tr></thead>
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

  // lote S44 (L4): código da obra no padrão da CGL ("8832-2026"), a partir do número do orçamento
  const pNum = orcNumeroPartes(orc.numero, orc.data_orcamento);
  const sugCodigo = pNum.num ? `${pNum.num}-${pNum.ano}` : orc.numero.replace(/^ORC-/i, "OB-");
  const codigo = prompt(`Código da obra (sugestão: ${sugCodigo}):`, sugCodigo);
  if(!codigo) return;
  const sugNome = `${mapaClientes[orc.cliente_id] || "Obra"} — ${orc.numero}`;
  const nome = prompt("Nome da obra:", sugNome);
  if(!nome) return;

  const origem = `orçamento ${orc.numero} Rev${orc.numero_revisao || "00"}`;
  // lote S45 (L9, decisão do Bernardo em 19/10): o valor contratado é o total COM ISS (o ISS por dentro está somado no
  // quadro de preços da proposta); orcamentos.valor_total continua sem ISS. Vai para obras_financeiro e para o contrato
  // do cliente (obras.js espelha o valor da obra no contrato a cada Salvar). Obras antigas: migration loteS45_valor_contratado_iss.
  const valorContratado = Math.round(orcTotalComIss(orc) * 100) / 100;

  // 1) Contrato do cliente (fica sob a aba Contrato da obra)
  const { data: contr, error: eContr } = await sb.from("contratos").insert({
    numero: codigo.trim(),
    orcamento_id: orcEditId,
    cliente_id: orc.cliente_id,
    descricao: `Contrato baseado no ${origem}`,
    status: "em_elaboracao",
    valor_total: valorContratado,
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

  // 2b) Valor da obra (fase 90): vive em obras_financeiro; a linha nasce zerada pelo gatilho e recebe aqui o total com ISS (S45, L9)
  const { error: eFin } = await sb.from("obras_financeiro").upsert({ obra_id: novaObraReg.id, valor_contratado: valorContratado });

  aviso("app-aviso", eFin
    ? `🏗️ Obra ${codigo} criada, mas o valor contratado não pôde ser gravado: ${eFin.message}`
    : `🏗️ Obra ${codigo} criada (status: planejada).`, eFin ? "erro" : "ok");
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
    _selecionarVarianteSelect(tr.querySelector(".it-cat"), item.variante_id);
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

function aplicarItemCatalogo(select, semAviso){
  const tr = select.closest("tr");
  const vid = select.value;
  if(!vid){ recalcularOrc(); return; }
  const v = _orcVarById[vid];
  if(!v) return;
  // lote S49 (#136): diâmetro sem preço na faixa do Modelo entra com a faixa mais próxima; avisa para conferir
  const todoCatalogo = tr.querySelector(".it-cat-all")?.classList.contains("ativo");
  if(!semAviso && !todoCatalogo && _orcFaixaAproximada(v, _orcCatFiltro)){
    aviso("app-aviso", `${v.nome}: este diâmetro não tem preço para ${ORC_FAIXA_LBL[_orcCatFiltro.faixa] || _orcCatFiltro.faixa}; entrou a faixa mais próxima. Confira o valor.`, "aviso");
  }
  tr.querySelector(".it-desc").value = _nomeItemCatalogoOrc(v);
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
  // Fase 40: ISS da proposta (por dentro = soma × p/(100-p), como na RG 11.8)
  // Chamado #18 (Thales, 21/09/2026): checkbox desmarcado = ISS NÃO compõe o somatório
  // (antes desmarcado virava "por fora" e continuava somando).
  // lote S44 (L8): conta única em orcIssSobre; o chip da ficha mostra o total com ISS, igual ao da proposta
  const p  = Number($("orc-iss-perc")?.value || 0);
  const pd = !!$("orc-iss-pdentro")?.checked;
  const iss = orcIssSobre(soma, { iss_percentual: p, iss_por_dentro: pd });
  const chip = $("orc-ficha-valor-chip");
  if(chip) chip.textContent = brl(soma + iss);
  if($("orc-iss-lbl"))   $("orc-iss-lbl").textContent   = pd ? `${p}% por dentro` : "não incluído";
  if($("orc-iss-valor")) $("orc-iss-valor").textContent = brl(iss);
  if($("orc-total-iss")) $("orc-total-iss").textContent = brl(soma + iss);
  return soma;
}

/* ---------- Lote S49 (#140): cliente novo sem sair do orçamento ----------
   O Frederico (engenheiro com o módulo extra de Orçamentos) não conseguia cadastrar cliente: a policy de clientes não
   tinha o extra (migration 20261022_loteS49_clientes_modulo_extra). O botão "+ Novo cliente" ao lado do Cliente abre um
   cadastro rápido; quem grava é quem cliPodeEditar() (clientes.js) deixa. Endereço e dados fiscais: ficha do cliente. */
function orcPodeCadastrarCliente(){ return typeof cliPodeEditar === "function" && cliPodeEditar(); }
function orcAbrirNovoCliente(){
  ["orc-cli-nome","orc-cli-doc","orc-cli-contato","orc-cli-tel","orc-cli-email","orc-cli-cidade"].forEach(id => { const el = $(id); if(el) el.value = ""; });
  if($("orc-cli-tipo")) $("orc-cli-tipo").value = "juridica";
  const uf = $("orc-cli-uf");
  if(uf && !uf.options.length) uf.innerHTML = `<option value="">—</option>` + UFS.map(u => `<option value="${u.toLowerCase()}">${u}</option>`).join("");
  if(uf) uf.value = "";
  $("orc-cli-modal").style.display = "flex";
  $("orc-cli-nome")?.focus();
}
function orcFecharNovoCliente(){ $("orc-cli-modal").style.display = "none"; }
async function orcSalvarNovoCliente(){
  const nome = $("orc-cli-nome").value.trim();
  if(!nome){ aviso("app-aviso", "Informe o nome/razão social do cliente.", "erro"); $("orc-cli-nome").focus(); return; }
  const doc = $("orc-cli-doc").value.trim();
  if(doc && typeof fiscalDocValido === "function" && !fiscalDocValido(doc)){
    aviso("app-aviso", "CPF/CNPJ inválido: confira os dígitos verificadores.", "erro"); $("orc-cli-doc").focus(); return;
  }
  const reg = {
    tipo_pessoa:  $("orc-cli-tipo").value || "juridica",
    nome,
    cpf_cnpj:     doc || null,
    contato_nome: $("orc-cli-contato").value.trim() || null,
    telefone:     $("orc-cli-tel").value.trim() || null,
    email:        $("orc-cli-email").value.trim() || null,
    cidade:       $("orc-cli-cidade").value.trim() || null,
    uf:           $("orc-cli-uf").value || null,
    ativo:        true
  };
  const { data, error } = await sb.from("clientes").insert(reg).select("id,nome,contato_nome,telefone,email").single();
  if(error){
    const m = (error.message || "").toLowerCase();
    aviso("app-aviso", m.includes("duplicate") || m.includes("unique") ? "Já existe um cliente com esse CPF/CNPJ: escolha-o na lista."
      : /row-level security|42501/.test(m) ? "Seu perfil não cadastra clientes (peça ao comercial ou à diretoria)."
      : "Não foi possível cadastrar o cliente: " + error.message, "erro");
    return;
  }
  // recarrega os selects de cliente (orçamento e obra) sem perder o que a ficha da obra tinha escolhido
  const obrCli = $("obr-cliente")?.value || "";
  if(typeof carregarClientesSelects === "function") await carregarClientesSelects();
  if($("obr-cliente") && obrCli) $("obr-cliente").value = obrCli;
  $("orc-cliente").value = data.id;
  const preencher = (k, val) => { const el = $(k); if(el && !el.value.trim() && val) el.value = val; };
  preencher("orc-contato-nome",  data.contato_nome);
  preencher("orc-contato-tel",   data.telefone);
  preencher("orc-contato-email", data.email);
  $("orc-ficha-cliente-chip").textContent = data.nome;
  orcFecharNovoCliente();
  aviso("app-aviso", `Cliente ${data.nome} cadastrado e escolhido neste orçamento.`, "ok");
  if(typeof carregarClientes === "function") carregarClientes();   // a lista do módulo Clientes também vê o novo
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

  // lote S44 (L4, #66): "8832" vira "8832/2026" (ano da data do orçamento); "8832/2026" fica como está
  const numero = orcNumeroNormalizado($("orc-numero").value, $("orc-data").value);
  if(!numero){ aviso("app-aviso","Informe o número do orçamento.","erro"); ativarTabOrc("geral"); $("orc-numero").focus(); return; }
  $("orc-numero").value = numero;

  const reg = {
    numero,
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
    cidade_emissao:             "Itabira/MG", // chamado #9 (Thales, aprovado pelo Bernardo em 16/09/2026): campo saiu da tela; a proposta é sempre emitida na sede
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
    prazo_pagamento_dias:       Number($("orc-prazo-pagamento")?.value) || 15,   // chamado #12
    pagamento_forma:            $("orc-pagamento-forma")?.value === "boleto" ? "boleto" : "deposito",
    prazo_execucao:             $("orc-prazo").value.trim() || null,
    local_execucao:             $("orc-local").value.trim() || null,
    cgl_fornece_diesel:         $("orc-cgl-diesel").checked,
    diesel_preco_litro:         Number($("orc-diesel-preco").value || 8.34),
    cgl_fornece_hospedagem:     $("orc-cgl-hospedagem").checked,
    hospedagem_valor_mensal:    $("orc-hosp-valor").value ? Number($("orc-hosp-valor").value) : null,
    cgl_fornece_alimentacao:    !!$("orc-cgl-alimentacao")?.checked   // lote S44 (L7, #62): migration 20261020_loteS44_orcamento_alimentacao
  };
  // lote S47 (#111): só grava a concorrência quando a coluna existe (migration 20261022_loteS47)
  if(_orcTemConcorrencia) reg.concorrencia = ($("orc-concorrencia")?.value || "").trim().replace(/\s+/g, " ") || null;

  let orcId = orcEditId;
  // lote S44 (L7): enquanto a migration 20261020_loteS44_orcamento_alimentacao não estiver aplicada, grava o
  // resto e avisa no console (mesmo padrão de obras.sinal_abatimento_modelo), em vez de perder o orçamento
  const gravarOrc = (r) => orcEditId
    ? sb.from("orcamentos").update(r).eq("id", orcEditId)
    : sb.from("orcamentos").insert(r).select("id").single();
  let res = await gravarOrc(reg);
  let semAlimentacao = false;
  if(res.error && /cgl_fornece_alimentacao/i.test(res.error.message || "")){
    const { cgl_fornece_alimentacao, ...semColuna } = reg;
    res = await gravarOrc(semColuna);
    semAlimentacao = true;
  }
  if(res.error){ aviso("app-aviso","Não foi possível salvar o orçamento: "+res.error.message,"erro"); return; }
  if(semAlimentacao) console.warn("orcamentos.cgl_fornece_alimentacao ainda não existe no banco — adicional de alimentação não gravado (aplicar a migration do lote S44).");
  if(orcEditId){
    const { error: errDel } = await sb.from("orcamento_itens").delete().eq("orcamento_id", orcEditId);
    if(errDel){ aviso("app-aviso","Erro ao substituir os itens: "+errDel.message+". Nada foi reinserido — tente salvar de novo.","erro"); return; }
  } else {
    orcId = res.data.id;
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
  ["orc-busca","orc-f-status","orc-f-cliente","orc-f-porte","orc-f-metodo"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "orc-busca" ? "input" : "change", id === "orc-busca" ? debounce(renderOrcamentos) : renderOrcamentos);
  });
  $("orc-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirOrcamento(tr.dataset.id);
  });

  $("btn-novo-orcamento")?.addEventListener("click", novoOrcamento);
  // lote S47: #112 cabeçalho ordena (estado na sessão); #111 concorrência no filtro e no Modelo
  _orcOrdem.ligar("orc-conteudo", renderOrcamentos);
  $("orc-f-conc")?.addEventListener("change", renderOrcamentos);
  $("orc-concorrencia")?.addEventListener("change", orcAoEscolherConcorrencia);
  $("btn-voltar-orc")?.addEventListener("click", mostrarPainelOrc);
  $("btn-salvar-orc")?.addEventListener("click", () => comBotaoTravado("btn-salvar-orc", () => salvarOrcamento()));
  $("btn-excluir-orc")?.addEventListener("click", excluirOrcamento);
  $("btn-add-item")?.addEventListener("click", adicionarItem);

  // Filtro do catálogo (aba Modelo → aba Itens) e validade derivada
  ["orc-tipo-obra","orc-porte","orc-faixa"].forEach(id => $(id)?.addEventListener("change", atualizarFiltroCatalogoOrc));
  $("orc-tipo-proposta")?.addEventListener("change", orcTrocarModelo);   // lote S49 (#134): troca também os itens padrão
  // Chamado #11: marcar "CGL fornece diesel/hospedagem" libera o serviço na aba Itens e já o acrescenta como item padrão; S45 (L10): alimentação idem
  ["orc-cgl-diesel","orc-cgl-hospedagem","orc-cgl-alimentacao"].forEach(id => $(id)?.addEventListener("change", (ev) => { atualizarFiltroCatalogoOrc(); if(ev.target.checked) carregarItensPadraoOrc(true); }));
  // Chamado #12: prazo e forma de pagamento regeneram o texto padrão (que continua editável)
  ["orc-prazo-pagamento","orc-pagamento-forma"].forEach(id => $(id)?.addEventListener("change", () => {
    if(typeof textoPagamentoPadrao === "function" && $("orc-pagamento")) $("orc-pagamento").value = textoPagamentoPadrao($("orc-prazo-pagamento")?.value, $("orc-pagamento-forma")?.value);
  }));
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

  // lote S49 (#140): cliente novo sem sair do orçamento
  $("btn-orc-novo-cliente")?.addEventListener("click", orcAbrirNovoCliente);
  $("btn-orc-cli-fechar")?.addEventListener("click", orcFecharNovoCliente);
  $("btn-orc-cli-salvar")?.addEventListener("click", () => comBotaoTravado("btn-orc-cli-salvar", orcSalvarNovoCliente));

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

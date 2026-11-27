






let _orcamentos = [];
let _orcView    = "lista";
let orcEditId   = null;

const ORC_STAGES = ["rascunho","enviado","em_negociacao","aprovado"];





function orcPodeEditar(){
  if(!usuarioAtual || ehSomenteLeitura()) return false;
  return ["diretor", "comercial"].includes(usuarioAtual.cargo) || temModuloExtra("orcamentos");
}
const ORC_BOTOES_ESCRITA = ["btn-novo-orcamento", "btn-salvar-orc", "btn-excluir-orc", "btn-orc-nova-revisao",
  "btn-orc-criar-obra", "btn-orc-itens-padrao", "btn-add-item", "btn-orc-novo-cliente", "btn-orc-sim-usar", "btn-orc-enviar",
  "btn-orc-whatsapp"];

function orcAplicarModoLeitura(){
  const pode = orcPodeEditar();
  const faixa = $("orc-aviso-leitura");
  if(faixa) faixa.style.display = pode ? "none" : "";
  if(pode) return;
  ORC_BOTOES_ESCRITA.forEach(id => { const b = $(id); if(b) b.style.display = "none"; });
  document.querySelectorAll("#orc-ficha .odoo-tab input, #orc-ficha .odoo-tab select, #orc-ficha .odoo-tab textarea")
    .forEach(el => { el.disabled = true; });
  document.querySelectorAll("#orc-itens .btn-rem, #orc-itens .it-cat-all, #orc-itens .btn-ordem").forEach(b => { b.style.display = "none"; });
}


function orcAtualizarSetasOrdem(st){
  const ok = orcPodeEditar() && (st || $("orc-status")?.value || "rascunho") === "rascunho";
  document.querySelectorAll("#orc-itens .btn-ordem").forEach(b => { b.hidden = !ok; });
}
function orcMoverItem(tr, passo){
  const alvo = passo < 0 ? tr.previousElementSibling : tr.nextElementSibling;
  if(!alvo) return;
  if(passo < 0) alvo.before(tr); else alvo.after(tr);
  tr.querySelector(`.btn-ordem[data-ordem="${passo}"]`)?.focus();
  recalcularOrc();
}


let _orcCatOptions  = '<option value="">— item livre (digitar) —</option>';
let _orcVarById     = {};
let _orcServUnidade = {};
let _orcServObs     = {};
let _orcServNota    = {};
let _orcServByCod   = {};
let _orcVarByCod    = {};
let _orcPrecos      = {};
let _orcServAgrupado = {};

let _orcServicos  = [];
let _orcServById  = {};
let _orcVariantes = [];
let _orcMetodos   = {};
let _orcCatFiltro = { tipoProp: "helice", tipoObra: "convencional", porte: "", faixa: "" };

const ORC_PORTE_LBL = { pequeno: "Pequeno porte", medio: "Médio porte", grande: "Grande porte" };
const ORC_FAIXA_LBL = { ate18: "até 18 m", "18a24": "18 a 24 m", "24a30": "24 a 30 m", mais30: "> 30 m" };
const ORC_TIPO_LBL  = { helice: "Hélice", trado: "Trado", raiz: "Raiz", secante: "Secante", outro: "Outro" };

const ORC_METODO_LBL = { helice: "Hélice contínua", secante: "Hélice secante", raiz: "Estaca raiz", trado: "Trado" };





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

function orcNumeroExibicao(numero, dataOrcamento){
  const p = orcNumeroPartes(numero, dataOrcamento);
  return `${p.num || "0000"} / ${p.ano}`;
}

function orcNumeroNormalizado(numero, dataOrcamento){
  const p = orcNumeroPartes(numero, dataOrcamento);
  if(!p.bruto) return "";
  return p.temAno ? String(numero).trim() : `${p.num}/${p.ano}`;
}




function orcIssSobre(subtotal, o){
  const p  = Number((o && o.iss_percentual) ?? 0);
  const pd = !o || o.iss_por_dentro !== false;
  return (pd && p > 0 && p < 100) ? Number(subtotal || 0) * (p / (100 - p)) : 0;
}
function orcTotalComIss(o){
  const sub = Number((o && o.valor_total) || 0);
  return sub + orcIssSobre(sub, o);
}


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















const ITENS_PADRAO_ORC = {
  helice: [
    { serv: "MOB.HC.SERV", perna: "ida", qtd: 1 },
    { serv: "MOB.HC.SERV", perna: "volta", qtd: 1 },
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
    { serv: "MOB.RZ.SERV", perna: "ida", qtd: 1 },
    { serv: "MOB.RZ.SERV", perna: "volta", qtd: 1 },
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
    { serv: "MOB.ESC.SERV", var: "MOB-ESC-IDA", perna: "ida", qtd: 1 },
    { serv: "MOB.ESC.SERV", var: "MOB-ESC-VOLTA", perna: "volta", qtd: 1 },
    { serv: "DIA.MDP.SERV" },
    { serv: "DIA.FM.ESC.SERV" },
    { serv: "INS.DI.SERV", var: "INS-DI-HC" },
    { serv: "VRB.ALH.SERV" },
    { serv: "VRB.ALC.SERV" }
  ],
  outro: []
};

ITENS_PADRAO_ORC.secante = ITENS_PADRAO_ORC.helice.concat([{ serv: "INS.GAB.SERV", var: "GAB-SEC" }]);


function _orcPadraoCasaVar(d, v){
  const cod = String(v?.codigo || "");
  return (!d.var || d.var === cod) && (!d.fim || cod.endsWith(d.fim)) && (!d.perna || v?.perna === d.perna);
}


function _orcVarPadraoFixa(tipoProp, v){
  return !!(tipoProp && v && v.codigo) && (ITENS_PADRAO_ORC[tipoProp] || []).some(d => d.var && d.var === v.codigo);
}








const EIXO_POR_TIPO_ESTACA = { helice_continua: "helice", hsa: "helice", escavada: "trado", strauss: "trado", raiz: "raiz", secante: "secante" };
function _eixoServicoOrc(texto, tipoEstaca){
  const t = (texto || "").toLowerCase();
  if(t.includes("secante")) return "secante";
  if(tipoEstaca && EIXO_POR_TIPO_ESTACA[tipoEstaca]) return EIXO_POR_TIPO_ESTACA[tipoEstaca];
  if(t.includes("hélice") || t.includes("helice")) return "helice";
  if(t.includes("raiz") || t.includes("raíz")) return "raiz";
  if(t.includes("trado") || t.includes("escavad")) return "trado";
  return null;
}

async function prepararCatalogoOrc(){
  const [srv, vrt, prc, cat] = await Promise.all([
    sb.from("servicos").select("id,codigo,nome,unidade,categoria_id,ativo,observacoes_padrao,nota_interna,tipo_estaca,ordem_exibicao").order("ordem_exibicao", { nullsFirst: false }).order("codigo"),
    sb.from("servico_variantes").select("id,servico_id,codigo,nome,descricao,ativo,tipo_obra,unidade,porte,faixa_prof,faixa_prof_min,faixa_prof_max,perna").order("codigo"),
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


  _orcVariantes = (vrt.data || []).filter(v => v.ativo !== false).map(v => ({ ...v, eixo: _eixoServicoOrc(v.nome, null) }));
  _orcServById  = {};
  _orcServicos.forEach(s => { _orcServById[s.id] = s; });

  _orcVarById = {};
  _orcServUnidade = {};
  _orcServObs = {};
  _orcServNota = {};
  _orcServByCod = {};
  _orcVarByCod = {};
  _orcPrecos = {};
  _orcServicos.forEach(s => {
    _orcServUnidade[s.id] = s.unidade;
    if(s.observacoes_padrao) _orcServObs[s.id] = s.observacoes_padrao;
    if(s.nota_interna && s.nota_interna.trim()) _orcServNota[s.id] = s.nota_interna.trim();
    if(s.codigo) _orcServByCod[s.codigo] = s;
  });
  _orcVariantes.forEach(v => { _orcVarById[v.id] = v; if(v.codigo) _orcVarByCod[v.codigo] = v; });
  (prc.data || []).forEach(p => {
    if(!(p.variante_id in _orcPrecos)) _orcPrecos[p.variante_id] = p.preco_referencia;
  });





  _orcServAgrupado = {};
  _orcServicos.forEach(s => {
    const vars = _orcVariantes.filter(v => v.servico_id === s.id);
    if(vars.length < 2) return;
    const precos = vars.map(v => _orcPrecos[v.id]);
    if(precos.some(p => p == null)) return;
    if(precos.every(p => Number(p) === Number(precos[0]))) _orcServAgrupado[s.id] = true;
  });
  _orcCatOptions = montarOpcoesCatalogoOrc(null);
}


function _rotuloVarianteOrc(v){
  if(!v) return "";
  if(_orcServAgrupado[v.servico_id]){
    const s = _orcServicos.find(x => x.id === v.servico_id);
    if(s) return s.nome || v.nome || "";
  }
  return v.nome || "";
}


function _faixaProfTextoOrc(v){
  const num = (x) => (x == null || x === "") ? null : Number(x);
  const min = num(v.faixa_prof_min), max = num(v.faixa_prof_max);
  const fmt = (x) => String(x).replace(".", ",");
  if(min == null && max == null) return "";
  if(max == null || max >= 999) return min ? `acima de ${fmt(min)} m` : "";
  if(!min) return `até ${fmt(max)} m`;
  return `${fmt(min)} a ${fmt(max)} m`;
}




function _nomeItemCatalogoOrc(v){
  if(!v) return "";
  if(_orcServAgrupado[v.servico_id]) return _rotuloVarianteOrc(v);
  const desc = (v.descricao || "").trim();
  if(!desc) return v.nome || "";
  const repete = _orcVariantes.some(x => x.id !== v.id && x.servico_id === v.servico_id && (x.descricao || "").trim() === desc);
  const faixa = repete ? _faixaProfTextoOrc(v) : "";
  return faixa ? `${desc} (${faixa})` : desc;
}



function _selecionarVarianteSelect(sel, vid){
  if(!vid){ sel.value = ""; return; }
  if([...sel.options].some(o => o.value === vid)){ sel.value = vid; return; }
  const grp = [...sel.options].find(o => o.dataset.grupo && o.dataset.grupo.split(",").includes(vid));
  if(grp){ grp.value = vid; sel.value = vid; return; }
  const v = _orcVarById[vid];
  sel.insertAdjacentHTML("beforeend", `<option value="${esc(vid)}">${esc(v ? _rotuloVarianteOrc(v) : "(item)")} · fora do filtro</option>`);
  sel.value = vid;
}

function _servicoVisivelOrc(s, tipoProp, f){

  const cod = String(s.codigo || "");
  if(f && cod.startsWith("INS.DI") && f.cglDiesel === false) return false;
  if(f && cod.startsWith("VRB.ALH") && f.cglHosp === false) return false;
  if(f && cod.startsWith("VRB.ALC") && f.cglAlim === false) return false;
  if(!tipoProp || tipoProp === "outro" || !s.eixo) return true;
  if(s.eixo === tipoProp) return true;
  if(tipoProp === "secante" && s.eixo === "helice") return true;
  return false;
}







const ORC_EIXOS_VARIANTE = { helice: ["helice"], secante: ["secante", "helice"], trado: ["trado", "helice"], raiz: ["raiz"] };






const ORC_FAIXAS = ["ate18", "18a24", "24a30", "mais30"];
function _orcGrupoFaixa(v){ const m = String(v.nome || "").match(/Ø\s*(\d+)/); return m ? "Ø" + m[1] : "_"; }
function _orcFaixaAproximada(v, f){ return !!(f && f.faixa && v && v.faixa_prof && v.faixa_prof !== f.faixa); }
function _variantesFiltradasOrc(s, f){
  let vars = _orcVariantes.filter(v => v.servico_id === s.id);
  if(!vars.length || !f) return vars;
  if(f.tipoProp && f.tipoProp !== "outro"){

    const ok = ORC_EIXOS_VARIANTE[f.tipoProp] || [f.tipoProp];
    vars = vars.filter(v => !v.eixo || ok.includes(v.eixo) || _orcVarPadraoFixa(f.tipoProp, v));
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


function montarOpcoesCatalogoOrc(f){
  let html = '<option value="">— item livre (digitar) —</option>';
  _orcServicos.forEach(s => {
    if(f && !_servicoVisivelOrc(s, f.tipoProp, f)) return;
    const vars = _variantesFiltradasOrc(s, f);
    if(!vars.length) return;
    if(_orcServAgrupado[s.id]){

      const todas = _orcVariantes.filter(v => v.servico_id === s.id).map(v => v.id).join(",");
      html += `<optgroup label="${esc(s.nome)}"><option value="${esc(vars[0].id)}" data-grupo="${esc(todas)}">${esc(s.nome)}</option></optgroup>`;
      return;
    }
    html += `<optgroup label="${esc(s.nome)}">`
          + vars.map(v => `<option value="${esc(v.id)}">${esc(v.nome)}${_orcFaixaAproximada(v, f) ? " · faixa mais próxima" : ""}</option>`).join("")
          + `</optgroup>`;
  });
  return   html;
}
function _opcoesFiltradasOrc(){ return montarOpcoesCatalogoOrc(_orcCatFiltro); }


function _trocarOpcoesSelect(sel, html){
  const atual = sel.value;
  sel.innerHTML = html;
  _selecionarVarianteSelect(sel, atual);
}





function atualizarFiltroCatalogoOrc(){
  _orcCatFiltro = {
    tipoProp: $("orc-tipo-proposta")?.value || "helice",
    cglDiesel: !!$("orc-cgl-diesel")?.checked,
    cglHosp:   !!$("orc-cgl-hospedagem")?.checked,
    cglAlim:   !!$("orc-cgl-alimentacao")?.checked,
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
    if(!s || !_servicoVisivelOrc(s, _orcCatFiltro.tipoProp)) return;

    let cand = _variantesFiltradasOrc(s, _orcCatFiltro).filter(c => c.id !== v.id && (c.perna || null) === (v.perna || null));

    const dP = (ITENS_PADRAO_ORC[_orcCatFiltro.tipoProp] || [])[_orcPadraoIdx(_orcCatFiltro.tipoProp, v)];
    if(dP && dP.fim) cand = cand.filter(c => _orcPadraoCasaVar(dP, c));
    if(cand.length > 1){

      const suf = (v.nome.match(/\(([^)]*)\)\s*$/) || [])[1];
      if(suf) cand = cand.filter(c => c.nome.endsWith(`(${suf})`));
    }
    if(cand.length > 1){


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



function carregarItensPadraoOrc(silencioso){
  const tipo  = $("orc-tipo-proposta")?.value || "helice";

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
    if(!v) v = _variantesFiltradasOrc(s, _orcCatFiltro).find(x => _orcPadraoCasaVar(d, x));
    if(!v || presentes.has(v.id)) return;
    if(d.fim || d.perna){

      if([...presentes].some(id => _orcVarById[id]?.servico_id === s.id && _orcPadraoCasaVar({ fim: d.fim, perna: d.perna }, _orcVarById[id]))) return;

      if(d.perna && [...presentes].some(id => { const x = _orcVarById[id]; return x?.servico_id === s.id && !x.perna && _orcVarByCod[x.codigo + "-IDA"]; })) return;
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








function _orcPadraoIdx(tipo, v){
  const s = v && _orcServById[v.servico_id];
  if(!s) return -1;
  return (ITENS_PADRAO_ORC[tipo] || []).findIndex(d => d.serv === s.codigo && _orcPadraoCasaVar(d, v));
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
    if(iAnt < 0 || _orcPadraoIdx(novo, v) >= 0) return;
    const d = ITENS_PADRAO_ORC[ant][iAnt];
    const qtd = Number(tr.querySelector(".it-qtd")?.value || 0);
    const vu = Number(tr.querySelector(".it-vu")?.value || 0);
    const ref = _orcPrecos[v.id] != null ? Number(_orcPrecos[v.id]) : 0;
    const desc = (tr.querySelector(".it-desc")?.value || "").trim();
    if(qtd === Number(d.qtd || 0) && Math.abs(vu - ref) < 0.005 && (desc === _nomeItemCatalogoOrc(v) || desc === (v.nome || ""))){ tr.remove(); removidos++; }
    else mantidos++;
  });
  const n = carregarItensPadraoOrc(true);
  if(removidos || n){

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


function recalcularValidadeOrc(){
  const d = $("orc-data")?.value;
  const dias = Number($("orc-validade-dias")?.value || 0);
  const alvo = $("orc-validade");
  if(!alvo || !d || !dias) return;
  const [y, m, dd] = d.split("-").map(Number);
  alvo.value = dataLocalISO(new Date(y, m - 1, dd + dias));
}


async function carregarOrcamentos(){
  if(Object.keys(_orcVarById).length === 0){
    try { await prepararCatalogoOrc(); } catch(_){   }
  }
  const COLS = "id,numero,numero_revisao,cliente_id,data_orcamento,status,valor_total,validade,responsavel_id,tipo_proposta,porte_equipamento,faixa_profundidade,iss_percentual,iss_por_dentro";
  const ler = (cols) => sb.from("orcamentos").select(cols).order("data_orcamento",{ ascending:false });
  const pRetornos = orcCarregarRetornos();
  let [{ data, error }, itensEixo] = await Promise.all([ler(COLS + ",concorrencia,motivo_encerramento"), orcBuscarItensEixo()]);

  if(error && /concorrencia|motivo_encerramento/i.test(error.message || "")) ({ data, error } = await ler(COLS));
  else if(!error) _orcTemConcorrencia = true;
  _orcamentos = orcSoVigentes(error ? [] : (data || []));
  orcAtualizarConcorrencias();


  _orcMetodos = {};
  itensEixo.forEach(it => {
    const eixo = _orcEixoVariante(it.variante_id);
    if(!eixo) return;
    (_orcMetodos[it.orcamento_id] = _orcMetodos[it.orcamento_id] || new Set()).add(eixo);
  });
  _orcRetornos = await pRetornos;
  await orcCarregarGruposClientes();
  renderOrcamentos();
  if(typeof psiAtualizarBadge === "function") psiAtualizarBadge();


  const aprov = _orcamentos.filter(o => ["aprovado","enviado","em_negociacao"].includes(o.status));
  const selectObrOrc = $("obr-con-orcamento");
  if(selectObrOrc){
    const atual = selectObrOrc.value;
    selectObrOrc.innerHTML = '<option value="">— nenhum —</option>' +
      aprov.map(o=>`<option value="${esc(o.id)}">${esc(o.numero)} — ${esc(mapaClientes[o.cliente_id]||"")}</option>`).join("");
    selectObrOrc.value = atual;
  }
}



const orcRevNum = (o) => parseInt(o && o.numero_revisao, 10) || 0;
function orcSoVigentes(lista){
  const porNum = new Map();
  lista.forEach(o => {
    const k = o.numero || o.id;
    const atual = porNum.get(k);
    if(!atual){ porNum.set(k, o); return; }
    const aprovA = atual.status === "aprovado", aprovO = o.status === "aprovado";
    if(aprovO !== aprovA ? aprovO : orcRevNum(o) > orcRevNum(atual)) porNum.set(k, o);
  });
  const vig = new Set(porNum.values());
  return lista.filter(o => vig.has(o));
}
const orcRevTxt = (o) => orcRevNum(o) > 0 ? ` · Rev ${String(o.numero_revisao).trim()}` : "";


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

function _orcEixoVariante(vid){
  const v = _orcVarById[vid];
  if(!v) return null;
  if(v.eixo) return v.eixo;
  const s = _orcServById[v.servico_id];
  return s ? (s.eixo || null) : null;
}

function orcTemMetodo(o, metodo){
  if(!metodo) return true;
  if(o.tipo_proposta === metodo) return true;
  const m = _orcMetodos[o.id];
  return !!(m && m.has(metodo));
}






let _orcTemConcorrencia = false;
let _orcConcorrencias = [];
const ORC_CONC_AGRUPAR = "__agrupar";
const orcConcChave = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
function orcAtualizarConcorrencias(){
  const mapa = {};
  _orcamentos.forEach(o => {
    const k = orcConcChave(o.concorrencia);
    if(!k) return;
    const g = mapa[k] || (mapa[k] = { nome: String(o.concorrencia).trim(), numeros: new Set(), aprov: new Set() });
    g.numeros.add(o.numero || o.id);
    if(o.status === "aprovado") g.aprov.add(o.numero || o.id);
  });
  _orcConcorrencias = Object.values(mapa).map(g => ({ nome: g.nome, propostas: g.numeros.size, aprovadas: g.aprov.size }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const dl = $("orc-conc-lista");
  if(dl) dl.innerHTML = _orcConcorrencias.map(c => `<option value="${esc(c.nome)}"></option>`).join("");
  const campo = $("orc-conc-campo");
  if(campo) campo.hidden = !_orcTemConcorrencia;
  const fc = $("orc-f-conc");
  if(fc) fc.style.display = _orcTemConcorrencia ? "" : "none";
}
const orcConcResumo = (g) => `${g.propostas} proposta${g.propostas === 1 ? "" : "s"} · ${g.aprovadas} aprovada${g.aprovadas === 1 ? "" : "s"}`;

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


function orcFiltrados(){
  const termo = ($("orc-busca")?.value || "").trim().toLowerCase();
  const fStat  = $("orc-f-status")?.value || "";
  const fCli   = $("orc-f-cliente")?.value || "";
  const fPorte = $("orc-f-porte")?.value || "";
  const fMet   = $("orc-f-metodo")?.value || "";
  const fConc  = $("orc-f-conc")?.value || "";
  const fGrupo = $("orc-f-grupo")?.value || "";
  const fRet   = $("orc-f-retorno")?.value || "";
  const fimSem = fRet === "semana" ? orcFimDaSemanaISO() : "";
  return _orcamentos.filter(o => {
    if(fRet === "semana" && !(_orcRetornos[o.id] && _orcRetornos[o.id] <= fimSem)) return false;
    if(fStat && o.status !== fStat) return false;
    if(fCli && o.cliente_id !== fCli) return false;
    if(fGrupo && (_orcCliGrupo[o.cliente_id] || "__sem") !== fGrupo) return false;
    if(fPorte && (o.porte_equipamento || "") !== fPorte) return false;
    if(fMet && !orcTemMetodo(o, fMet)) return false;
    if(fConc && fConc !== ORC_CONC_AGRUPAR && orcConcChave(o.concorrencia) !== fConc) return false;
    if(termo){
      const cli = (mapaClientes[o.cliente_id] || "").toLowerCase();

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
      Object.entries(ORC_PORTE_LBL).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
  }
  const selMet = $("orc-f-metodo");
  if(selMet && !selMet.options.length){
    selMet.innerHTML = `<option value="">Todos os métodos</option>` +
      Object.entries(ORC_METODO_LBL).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
  }
  const selConc = $("orc-f-conc");
  if(selConc){
    const atual = selConc.value;
    selConc.innerHTML = `<option value="">Todas as concorrências</option><option value="${ORC_CONC_AGRUPAR}">Agrupar por concorrência</option>` +
      _orcConcorrencias.map(c => `<option value="${esc(orcConcChave(c.nome))}">${esc(c.nome)} (${esc(orcConcResumo(c))})</option>`).join("");
    selConc.value = [...selConc.options].some(o => o.value === atual) ? atual : "";
  }
  const selGr = $("orc-f-grupo");
  if(selGr){
    const atual = selGr.value;
    selGr.innerHTML = `<option value="">Todos os grupos</option><option value="__sem">Sem grupo</option>` +
      _cliGrupos.map(g => `<option value="${esc(g.id)}">${esc(g.nome)}</option>`).join("");
    selGr.value = [...selGr.options].some(o => o.value === atual) ? atual : "";
  }
  const selCli = $("orc-f-cliente");
  if(selCli){
    const atual = selCli.value;
    const lista = Object.entries(mapaClientes).map(([id, nome]) => ({ id, nome }));
    selCli.innerHTML = `<option value="">Todos os clientes</option>` +
      lista.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
    selCli.value = atual;
  }
}



function _orcTipoPorteTxt(o){


  const apoio = ORC_EIXOS_VARIANTE[o.tipo_proposta] || [o.tipo_proposta];
  const extras = [...(_orcMetodos[o.id] || [])].filter(m => !apoio.includes(m)).map(m => "+ " + (ORC_TIPO_LBL[m] || m));
  return [ORC_TIPO_LBL[o.tipo_proposta] || "", ORC_PORTE_LBL[o.porte_equipamento], ORC_FAIXA_LBL[o.faixa_profundidade], ...extras]
    .filter(Boolean).join(" · ") || "—";
}

function renderOrcamentos(){

  const podePsi = typeof psiPodeLer === "function" && psiPodeLer();
  if(_orcView === "pedidos_site" && !podePsi) _orcView = "lista";
  if(typeof psiMostrarAba === "function") psiMostrarAba(_orcView === "pedidos_site");
  if(_orcView === "pedidos_site") return;
  preencherFiltrosOrc();
  const dados = orcFiltrados();
  const cont = $("orc-contador");
  if(cont) cont.textContent = `${dados.length} de ${_orcamentos.length}`;
  const btnNovo = $("btn-novo-orcamento");
  if(btnNovo) btnNovo.style.display = orcPodeEditar() ? "" : "none";
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
  const comConc = _orcTemConcorrencia;
  const nCols = comConc ? 8 : 7;
  const linha = (o) => `<tr class="linha-clicavel" data-id="${esc(o.id)}">
    <td>${esc(o.numero)}${esc(orcRevTxt(o))}${_orcRetornos[o.id] ? ` <span class="meta" title="Próximo retorno ao cliente (aba Negociação)">· retorno ${dataBR(_orcRetornos[o.id])}</span>` : ""}</td>
    <td>${esc(mapaClientes[o.cliente_id]||"—")}</td>
    ${comConc ? `<td>${o.concorrencia ? esc(o.concorrencia) : '<span class="meta">—</span>'}</td>` : ""}
    <td>${esc(_orcTipoPorteTxt(o))}</td>
    <td>${dataBR(o.data_orcamento)}</td>
    <td>${dataBR(o.validade)}</td>
    <td>${tagStatus("orcamento", o.status)}</td>
    <td class="num" title="Total da proposta, com ISS por dentro (sem ISS: ${brl(o.valor_total)})">${brl(orcTotalComIss(o))}</td>
  </tr>`;

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
      const rot = k ? `${g ? g.nome : grupos.get(k)[0].concorrencia} · ${g ? orcConcResumo(g) : ""}` : "Sem concorrência";
      return `<tr class="orc-grupo-conc"><td colspan="${nCols}">${esc(rot)}</td></tr>` + grupos.get(k).map(linha).join("");
    }).join("");
  } else corpo = ordenados.map(linha).join("");
  const th = (col, rot, extra) =>   _orcOrdem.th(col, rot, extra);
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      ${th("numero", "Número")}${th("cliente", "Cliente")}${comConc ? th("concorrencia", "Concorrência") : ""}${th("tipo", "Tipo · Porte")}${th("data", "Data")}${th("validade", "Validade")}${th("status", "Status")}${th("valor", "Valor c/ ISS", { cls: "num", title: "Total da proposta com ISS por dentro (lote S44, #65)" })}
    </tr></thead>
    <tbody>${  corpo}</tbody></table></div>`;
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
        <div class="serv-kan-card-nome">${esc(o.numero)}${esc(orcRevTxt(o))} ·${esc(mapaClientes[o.cliente_id]||"—")}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${dataBR(o.data_orcamento)}${o.validade ? " · val " + dataBR(o.validade) : ""} · ${esc(_orcTipoPorteTxt(o))}</span>
          ${o.concorrencia ? `<span class="meta" title="Concorrência (lote S47, #111)">🏗️ ${esc(o.concorrencia)}</span>` : ""}
          ${o.motivo_encerramento && (o.status === "rejeitado" || o.status === "cancelado") ? `<span class="meta" title="Motivo do encerramento">${esc(o.motivo_encerramento)}</span>` : ""}
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
  if(!orcPodeEditar()) return;
  habilitarDragKanban({
    container: "#orc-conteudo .serv-kanban",
    tabela: "orcamentos",
    onUpdate: async () => { await carregarOrcamentos(); }
  });
}


function mostrarPainelOrc(){
  $("orc-painel").style.display = "";
  $("orc-ficha").style.display = "none";
  orcEditId = null;
}







const ORC_BUCKET_ARQ = "orcamentos-arquivos";
const ORC_TIPO_ARQ_LBL = { projeto: "Projeto", sondagem: "Sondagem", planilha: "Planilha", pedido: "Pedido/e-mail" };
let _orcAssistente = null;
function orcLimparAssistente(){
  _orcAssistente = null;
  if(typeof psiLimparPendente === "function") psiLimparPendente();
  const f = $("orc-aviso-assistente"); if(f) f.style.display = "none";
}

function orcAtualizarChipCliente(){
  const chip = $("orc-ficha-cliente-chip"), sel = $("orc-cliente");
  if(chip && sel) chip.textContent = (sel.value && (mapaClientes[sel.value] || sel.options[sel.selectedIndex]?.text)) || "—";
  orcMostrarGrupoDoCliente();
}





let _orcGrupoCli = null;
let _orcGrupoVez = 0;
function orcGrupoDica(){
  const el = $("orc-grupo-dica"); if(!el) return;
  el.textContent = "";
  const c = _orcGrupoCli; if(!c) return;
  const txt = ($("orc-grupo")?.value || "").trim();
  if(txt && !cliGrupoPorNome(txt)){ el.textContent = `Criar o grupo "${txt}" ao sair do campo.`; return; }
  if(c.grupo_id){ el.textContent = `Vale para todos os orçamentos e obras de ${c.nome}.`; return; }
  const raiz = cliRaiz(c.cpf_cnpj);
  const g = raiz && _cliGrupos.find(x => x.cnpj_raiz === raiz && x.ativo !== false);
  if(g && !$("orc-grupo").disabled){
    el.innerHTML = `Este CNPJ é da raiz do grupo ${esc(g.nome)}. <button type="button" class="btn-sec btn-sm" id="btn-orc-grupo-raiz" title="Grava este grupo no cadastro do cliente">Usar este grupo</button>`;
    $("btn-orc-grupo-raiz")?.addEventListener("click", () => { $("orc-grupo").value = g.nome; orcGrupoMudou(); });
  }
}
function orcGrupoPreencherLista(){
  const dl = $("orc-grupos-lista");
  if(dl) dl.innerHTML = _cliGrupos.filter(g => g.ativo !== false).map(g => `<option value="${esc(g.nome)}"></option>`).join("");
}
async function orcMostrarGrupoDoCliente(){
  const el = $("orc-grupo"); if(!el) return;
  const id = $("orc-cliente")?.value || "";
  const vez = ++_orcGrupoVez;
  _orcGrupoCli = null; el.value = ""; el.disabled = true; orcGrupoDica();
  if(typeof orcGrupoHistorico === "function") orcGrupoHistorico();
  if(!id) return;
  const [{ data: c }] = await Promise.all([
    sb.from("clientes").select("id,nome,nome_fantasia,grupo_id,cpf_cnpj").eq("id", id).maybeSingle(),
    _cliGrupos.length ? null : cliCarregarGrupos()
  ]);
  if(vez !== _orcGrupoVez || !c) return;
  orcGrupoPreencherLista();
  _orcGrupoCli = { id: c.id, nome: String(c.nome_fantasia || "").trim() || c.nome || "", grupo_id: c.grupo_id || null, cpf_cnpj: c.cpf_cnpj || "" };
  el.value = cliGrupoNome(c.grupo_id);
  el.disabled = !orcPodeCadastrarCliente();
  orcGrupoDica();
  if(typeof orcGrupoHistorico === "function") orcGrupoHistorico();
}




let _orcCliGrupo = {};
async function orcCarregarGruposClientes(){
  const [{ data, error }] = await Promise.all([
    sb.from("clientes").select("id,grupo_id").not("grupo_id", "is", null),
    cliCarregarGrupos()
  ]);
  _orcCliGrupo = {};
  if(!error) (data || []).forEach(c => { _orcCliGrupo[c.id] = c.grupo_id; });
}
let _orcHistVez = 0;
async function orcGrupoHistorico(){
  const el = $("orc-grupo-hist"); if(!el) return;
  const c = _orcGrupoCli, gid = c && c.grupo_id;
  const vez = ++_orcHistVez;
  if(!gid){ el.hidden = true; el.textContent = ""; return; }
  const { data: clis, error } = await sb.from("clientes").select("id").eq("grupo_id", gid);
  if(vez !== _orcHistVez) return;
  if(error){ el.hidden = true; return; }
  const ids = (clis || []).map(x => x.id);
  ids.forEach(id => { _orcCliGrupo[id] = gid; });
  const idSet = new Set(ids);
  const orcs = _orcamentos.filter(o => idSet.has(o.cliente_id));
  const aprov = orcs.filter(o => o.status === "aprovado").length;
  const { count } = ids.length ? await sb.from("obras").select("id", { count: "exact", head: true }).in("cliente_id", ids) : { count: 0 };
  if(vez !== _orcHistVez) return;
  const nObras = count || 0;
  el.innerHTML = `${esc(cliGrupoNome(gid))}: <button type="button" class="ui-link" id="btn-orc-grupo-orcs" title="Abre o painel de Orçamentos só com os do grupo">${esc(orcs.length)} orçamento${orcs.length === 1 ? "" : "s"} (${esc(aprov)} aprovado${aprov === 1 ? "" : "s"})</button> · <button type="button" class="ui-link" id="btn-orc-grupo-obras" title="Abre o painel de Obras só com as obras dos clientes do grupo">${esc(nObras)} obra${nObras === 1 ? "" : "s"}</button>`;
  el.hidden = false;
  $("btn-orc-grupo-orcs")?.addEventListener("click", () => orcAbrirOrcamentosDoGrupo(gid).catch(err => aviso("app-aviso", err.message, "erro")));
  $("btn-orc-grupo-obras")?.addEventListener("click", () => orcAbrirObrasDoGrupo(gid, ids).catch(err => aviso("app-aviso", err.message, "erro")));
}
async function orcSairDaFichaPara(oQue){
  return uiConfirmar({ titulo: "Sair da ficha", texto: `Abrir ${oQue}? O que não foi salvo neste orçamento se perde.`, confirmar: "Abrir", cancelar: "Ficar" });
}
async function orcAbrirOrcamentosDoGrupo(gid){
  if(!await orcSairDaFichaPara("os orçamentos do grupo " + cliGrupoNome(gid))) return;
  mostrarPainelOrc();
  preencherFiltrosOrc();
  const sel = $("orc-f-grupo");
  if(sel){ sel.value = gid; }
  renderOrcamentos();
}
async function orcAbrirObrasDoGrupo(gid, ids){
  if(!await orcSairDaFichaPara("as obras do grupo " + cliGrupoNome(gid))) return;
  const { data, error } = await sb.from("obras").select("id").in("cliente_id", ids);
  if(error){ aviso("app-aviso", "Não foi possível ler as obras do grupo: " + error.message, "erro"); return; }
  if(!irParaSecao("obras")) return;
  if(typeof mostrarPainelObra === "function") mostrarPainelObra();
  renderObras({ ids: (data || []).map(o => o.id), rotulo: "Grupo " + cliGrupoNome(gid) });
}
async function orcGrupoMudou(){
  const el = $("orc-grupo"), c = _orcGrupoCli;
  if(!el || el.disabled || !c || $("orc-cliente")?.value !== c.id) return;
  const atual = cliGrupoNome(c.grupo_id);
  const txt = el.value.trim();
  if(txt.toLowerCase() === atual.trim().toLowerCase()){ el.value = atual; orcGrupoDica(); return; }
  const gid = await cliGrupoResolverTexto(txt, c.cpf_cnpj);
  if(gid === undefined || $("orc-cliente")?.value !== c.id || _orcGrupoCli !== c){ if(_orcGrupoCli === c){ el.value = atual; orcGrupoDica(); } return; }

  const { data: gravou, error } = await sb.from("clientes").update({ grupo_id: gid }).eq("id", c.id).select("id");
  if(error || !(gravou && gravou.length)){
    aviso("app-aviso", "Não foi possível gravar o grupo no cliente" + (error ? ": " + error.message : ": seu perfil não altera este cadastro."), "erro");
    el.value = atual; orcGrupoDica(); return;
  }
  c.grupo_id = gid;
  if(gid) _orcCliGrupo[c.id] = gid; else delete _orcCliGrupo[c.id];
  orcGrupoPreencherLista();
  el.value = cliGrupoNome(gid);
  aviso("app-aviso", gid ? `Grupo ${cliGrupoNome(gid)} gravado no cadastro de ${c.nome}.` : `Grupo tirado do cadastro de ${c.nome}.`, "ok");
  orcGrupoDica();
  if(typeof orcGrupoHistorico === "function") orcGrupoHistorico();
}
async function preencherOrcamentoDoAssistente(r, origem){
  if(!r || !irParaSecao("orcamentos")) return;
  await carregarOrcamentos();
  novoOrcamento();
  _orcAssistente = { conversa_id: origem?.conversa_id || null, arquivos: Array.isArray(origem?.arquivos) ? origem.arquivos : [] };
  const set = (id, v) => { const el = $(id); if(el && v != null && v !== "") el.value = v; };
  const setSel = (id, v) => { const el = $(id); if(el && v != null && [...el.options].some(o => o.value === String(v))) el.value = String(v); };
  const chk = (id, v) => { const el = $(id); if(el && typeof v === "boolean") el.checked = v; };
  setSel("orc-cliente", r.cliente?.id);
  orcAtualizarChipCliente();
  set("orc-ref-obra", r.referencia_obra);
  set("orc-local", r.local_execucao);
  set("orc-contato-nome", r.contato_nome);
  set("orc-contato-tel", r.contato_telefone);
  set("orc-contato-email", r.contato_email);
  set("orc-prazo", r.prazo_execucao);
  set("orc-sim-inicio", r.inicio_desejado);
  setSel("orc-porte", r.porte_equipamento);
  setSel("orc-faixa", r.faixa_profundidade);
  if(r.tipo_obra) definirTipoObraOrc(r.tipo_obra);
  chk("orc-proj-forn", r.projeto_fornecido);
  chk("orc-sond-forn", r.sondagem_fornecida);
  chk("orc-cgl-diesel", r.cgl_fornece_diesel);
  chk("orc-cgl-hospedagem", r.cgl_fornece_hospedagem);
  chk("orc-cgl-alimentacao", r.cgl_fornece_alimentacao);
  if(r.iss_percentual != null) $("orc-iss-perc").value = r.iss_percentual;
  chk("orc-iss-pdentro", r.iss_por_dentro);
  setSel("orc-pagamento-forma", r.pagamento_forma);
  setSel("orc-prazo-pagamento", r.prazo_pagamento_dias);
  if((r.pagamento_forma || r.prazo_pagamento_dias) && typeof textoPagamentoPadrao === "function"){
    $("orc-pagamento").value = textoPagamentoPadrao(Number($("orc-prazo-pagamento")?.value) || 15, $("orc-pagamento-forma")?.value || "deposito");
  }

  setSel("orc-tipo-proposta", r.tipo_proposta);
  orcTrocarModelo();
  atualizarFiltroCatalogoOrc();
  $("orc-itens").innerHTML = "";
  (Array.isArray(r.itens) ? r.itens : []).forEach(x => {
    const v = x.variante_id ? _orcVarById[x.variante_id] : null;
    adicionarItemPreenchido({
      variante_id: v ? v.id : null,
      descricao: (x.descricao || "").trim() || (v ? _nomeItemCatalogoOrc(v) : ""),
      quantidade: Number(x.quantidade) || 0,
      unidade: x.unidade || (v && (v.unidade || _orcServUnidade[v.servico_id])) || "un",
      valor_unitario: x.valor_unitario != null ? Number(x.valor_unitario) : 0,
      observacao: (v && _orcServObs[v.servico_id]) || ""
    });
  });
  recalcularOrc();
  const faixa = $("orc-aviso-assistente"); if(faixa) faixa.style.display = "";
  ativarTabOrc("itens");

  if(!r.cliente?.id && orcPodeCadastrarCliente()){
    orcAbrirNovoCliente();
    set("orc-cli-nome", r.cliente?.nome);
    set("orc-cli-doc", r.cliente?.cnpj);
  }
  aviso("app-aviso", "Orçamento montado pelo assistente: confira e clique em Salvar. Nada foi gravado.", "aviso");
}

async function orcLigarArquivosAssistente(orcId, arquivos){
  let falhas = 0;
  for(const a of arquivos || []){
    const destino = `${orcId}/${String(a.caminho || "").split("/").pop()}`;
    const cp = await sb.storage.from(ORC_BUCKET_ARQ).copy(a.caminho, destino);
    if(cp.error){ falhas++; continue; }
    const { error } = await sb.from("orcamento_arquivos").insert({ orcamento_id: orcId, tipo: a.tipo, caminho: destino, nome: a.nome,
      sha256: a.sha256 || null, tamanho_bytes: a.tamanho || null });
    if(error){ await sb.storage.from(ORC_BUCKET_ARQ).remove([destino]); falhas++; continue; }
    await sb.storage.from(ORC_BUCKET_ARQ).remove([a.caminho]);
  }
  return falhas;
}

async function carregarArquivosOrc(orcId){
  const cont = $("orc-arquivos-conteudo");
  if(!cont) return;
  if(!orcId){ cont.innerHTML = uiVazio("Os arquivos do pedido aparecem aqui depois de salvar."); if($("orc-arq-badge")) $("orc-arq-badge").textContent = ""; return; }
  const { data, error } = await sb.from("orcamento_arquivos").select("id,tipo,caminho,nome,tamanho_bytes,criado_em").eq("orcamento_id", orcId).order("criado_em");
  if(orcEditId !== orcId) return;
  if(error){ cont.innerHTML = uiVazio("Não foi possível ler os arquivos: " + error.message); return; }
  if($("orc-arq-badge")) $("orc-arq-badge").textContent = data.length || "";
  cont.innerHTML = data.length ? `<div class="orc-arq-lista">${data.map(a => `<div class="orc-arq-linha">
      <span class="chip">${esc(ORC_TIPO_ARQ_LBL[a.tipo] || a.tipo)}</span>
      <span class="orc-arq-nome" title="${esc(a.nome)}">${esc(a.nome)}</span>
      <span class="meta">${esc(a.tamanho_bytes ? (a.tamanho_bytes / 1048576).toFixed(1).replace(".", ",") + " MB · " : "")}${esc(dataBR(a.criado_em))}</span>
      <button type="button" class="btn-sec btn-sm" data-orc-arq-abrir="${esc(a.caminho)}">Abrir</button></div>`).join("")}</div>`
    : uiVazio("Nenhum arquivo do pedido neste orçamento.");
}
async function orcAbrirArquivo(caminho){
  const { data, error } = await sb.storage.from(ORC_BUCKET_ARQ).createSignedUrl(caminho, 120);
  if(error || !data?.signedUrl){ aviso("app-aviso", "Não foi possível abrir o arquivo: " + (error?.message || ""), "erro"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

async function orcCopiarArquivosParaObra(orc, obraId){
  const { data: arqs, error } = await sb.from("orcamento_arquivos").select("tipo,caminho,nome,tamanho_bytes").eq("orcamento_id", orc.id);
  if(error || !arqs?.length) return "";
  let ok = 0;
  for(const a of arqs){
    const d = await sb.storage.from(ORC_BUCKET_ARQ).download(a.caminho);
    if(d.error || !d.data) continue;
    const ext = (String(a.caminho).split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
    const mime = MIME_POR_EXTENSAO[ext] || d.data.type || "application/octet-stream";
    const caminho = `${obraId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb.storage.from("obras-documentos").upload(caminho, new Blob([d.data], { type: mime }), { contentType: mime, upsert: false });
    if(up.error) continue;
    const { error: eDoc } = await sb.from("obras_documentos").insert({
      obra_id: obraId, categoria: a.tipo === "projeto" ? "projeto" : a.tipo === "sondagem" ? "sondagem" : "outro",
      nome: a.nome, descricao: `Do orçamento ${orc.numero} (${ORC_TIPO_ARQ_LBL[a.tipo] || a.tipo})`, storage_path: caminho,
      mime_type: mime, tamanho_bytes: a.tamanho_bytes || d.data.size, enviado_por: usuarioAtual?.id || null, origem: "orcamento"
    });
    if(eDoc){ await sb.storage.from("obras-documentos").remove([caminho]); continue; }
    ok++;
  }
  return ok ? ` ${ok} arquivo(s) do orçamento copiado(s) para os documentos da obra.` : "";
}

function novoOrcamento(){
  orcEditId = null;
  orcLimparAssistente();
  carregarArquivosOrc(null);

  ["orc-numero","orc-cliente","orc-descricao","orc-validade","orc-responsavel","orc-obs",
   "orc-ref-obra","orc-escopo","orc-equipamento","orc-pagamento","orc-prazo","orc-local",
   "orc-hosp-valor","orc-porte","orc-faixa","orc-contato-nome","orc-contato-tel","orc-contato-email","orc-concorrencia"]
    .forEach(k => { const el = $(k); if(el) el.value = ""; });
  $("orc-itens").innerHTML = "";
  $("orc-status").value = "rascunho";
  $("orc-data").value = hojeISO();

  const maxN = _orcamentos.reduce((m, o) => { const n = parseInt(orcNumeroPartes(o.numero, o.data_orcamento).num, 10); return Number.isFinite(n) ? Math.max(m, n) : m; }, 0);
  $("orc-numero").value = maxN ? `${maxN + 1}/${new Date().getFullYear()}` : "";

  const selResp = $("orc-responsavel");
  if(selResp && typeof usuarioAtual !== "undefined" && usuarioAtual && [...selResp.options].some(o => o.value === usuarioAtual.id)){
    selResp.value = usuarioAtual.id;
  }
  $("orc-tipo-proposta").value  = "helice";
  $("orc-tipo-proposta").dataset.anterior = "helice";
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
  if($("orc-cgl-alimentacao")) $("orc-cgl-alimentacao").checked = false;

  if($("orc-prazo-pagamento")) $("orc-prazo-pagamento").value = "15";
  if($("orc-pagamento-forma")) $("orc-pagamento-forma").value = "deposito";
  if(typeof textoPagamentoPadrao === "function") $("orc-pagamento").value = textoPagamentoPadrao(15, "deposito");
  $("btn-excluir-orc").style.display = "none";
  abrirFichaOrcVisual({ numero: "(novo)", status: "rascunho", valor_total: 0 });
  carregarItensPadraoOrc(true);
}

async function abrirOrcamento(id){
  orcEditId = id;
  orcLimparAssistente();
  const { data:o, error } = await sb.from("orcamentos").select("*").eq("id",id).single();
  if(orcEditId !== id) return;
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
  $("orc-tipo-proposta").dataset.anterior = o.tipo_proposta || "helice";
  $("orc-revisao").value         = o.numero_revisao || "00";
  $("orc-validade-dias").value   = o.validade_dias != null ? o.validade_dias : 30;
  $("orc-porte").value           = o.porte_equipamento || "";
  $("orc-faixa").value           = o.faixa_profundidade || "";
  definirTipoObraOrc(o.tipo_obra || "convencional");
  if(!o.validade) recalcularValidadeOrc();
  $("orc-iss-perc").value        = o.iss_percentual != null ? o.iss_percentual : 5.00;
  $("orc-iss-pdentro").checked   = o.iss_por_dentro !== false;
  $("orc-proj-forn").checked     = o.projeto_fornecido === true || o.projeto_sondagem_fornecido === true;
  $("orc-sond-forn").checked     = o.sondagem_fornecida === true || o.projeto_sondagem_fornecido === true;
  $("orc-contato-nome").value    = o.contato_nome || "";
  $("orc-contato-tel").value     = o.contato_telefone || "";
  $("orc-contato-email").value   = o.contato_email || "";
  if(typeof cctOrcCarregar === "function") cctOrcCarregar(o.cliente_id || "");
  $("orc-ref-obra").value        = o.referencia_obra || "";
  $("orc-escopo").value          = o.escopo_servicos || "";
  $("orc-equipamento").value     = o.equipamento_considerado || "";
  if($("orc-prazo-pagamento")) $("orc-prazo-pagamento").value = String(o.prazo_pagamento_dias || 15);
  if($("orc-pagamento-forma")) $("orc-pagamento-forma").value = o.pagamento_forma || "deposito";
  $("orc-pagamento").value       = o.condicoes_pagamento || (typeof textoPagamentoPadrao === "function" ? textoPagamentoPadrao(o.prazo_pagamento_dias, o.pagamento_forma) : "");
  $("orc-prazo").value           = o.prazo_execucao || "";
  $("orc-local").value           = o.local_execucao || "";
  if($("orc-concorrencia")) $("orc-concorrencia").value = o.concorrencia || "";
  $("orc-cgl-diesel").checked      = o.cgl_fornece_diesel === true;
  $("orc-diesel-preco").value      = o.diesel_preco_litro != null ? o.diesel_preco_litro : 8.34;
  $("orc-cgl-hospedagem").checked  = o.cgl_fornece_hospedagem === true;
  $("orc-hosp-valor").value        = o.hospedagem_valor_mensal != null ? o.hospedagem_valor_mensal : "";
  if($("orc-cgl-alimentacao")) $("orc-cgl-alimentacao").checked = o.cgl_fornece_alimentacao === true;

  $("orc-itens").innerHTML = "";
  const { data:itens, error: errItens } = await sb.from("orcamento_itens")
    .select("*").eq("orcamento_id",id).order("ordem");

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

  orcSimPreparar(o);
  $("orc-ficha-numero").textContent = o.numero || "(novo)";
  if($("orc-ficha-revisao-chip")) $("orc-ficha-revisao-chip").textContent = `Rev ${o.numero_revisao || "00"}`;
  $("orc-ficha-cliente-chip").textContent = mapaClientes[o.cliente_id] || "—";
  orcMostrarGrupoDoCliente();
  $("orc-ficha-valor-chip").textContent = brl(orcTotalComIss(o));
  if($("orc-ficha-validade-chip")) $("orc-ficha-validade-chip").textContent = dataBR(o.validade);
  $("orc-ficha-titulo").textContent = orcEditId ? `Orçamento ${o.numero} · Rev ${o.numero_revisao||"00"}` : "Novo orçamento";
  const btnNovoCli = $("btn-orc-novo-cliente");
  if(btnNovoCli) btnNovoCli.style.display = orcPodeCadastrarCliente() ? "" : "none";

  atualizarStatusbarOrc(o.status);
  atualizarAcoesOrc(o);
  if(typeof psiAtualizarBotaoWhatsapp === "function") psiAtualizarBotaoWhatsapp();
  orcAplicarModoLeitura();

  if(orcEditId) carregarAbasOrc(o);
  else zerarAbasOrc();
  orcCarregarNegociacao(orcEditId);
  ativarTabOrc("geral");
}



async function orcEncerrarSemAprovar(){
  if(!orcEditId || !orcPodeEditar()) return;
  const v = await uiPedirValores({ titulo: "Encerrar sem aprovar", confirmar: "Encerrar",
    texto: "O orçamento sai do funil e vai para a coluna Perdida ou Cancelada. Para reabrir, mude o Status de volta.",
    campos: [
      { id: "desfecho", rotulo: "Desfecho", tipo: "select", valor: "rejeitado", obrigatorio: true,
        opcoes: [["rejeitado", "Perdida: o cliente fechou com outro ou recusou"], ["cancelado", "Cancelada: a obra não vai acontecer"]] },
      { id: "motivo", rotulo: "Motivo", tipo: "textarea", linhas: 2, obrigatorio: true, placeholder: "Ex.: preço acima do concorrente" },
      { id: "concorrente", rotulo: "Quem levou (se souber)", tipo: "text" }
    ] });
  if(!v) return;
  const motivo = String(v.motivo || "").trim();
  if(motivo.length < 5){ aviso("app-aviso", "Informe o motivo do encerramento (5 letras ou mais).", "erro"); return; }
  const st = v.desfecho === "cancelado" ? "cancelado" : "rejeitado";
  const { error } = await sb.from("orcamentos").update({ motivo_encerramento: motivo, concorrente: String(v.concorrente || "").trim() || null }).eq("id", orcEditId);
  if(error){ aviso("app-aviso", "Não foi possível encerrar: " + error.message, "erro"); return; }
  await salvarOrcamento(st);
}




async function atualizarAcoesOrc(o){
  const btnObra = $("btn-orc-criar-obra");
  const hint    = $("orc-acao-hint");
  if(!btnObra) return;
  btnObra.style.display = "none";
  if(hint) hint.textContent = "";

  const btnEnc = $("btn-orc-encerrar");
  if(btnEnc) btnEnc.hidden = !(orcEditId && orcPodeEditar() && ["enviado", "em_negociacao"].includes(o.status));
  if(orcEditId && (o.status === "rejeitado" || o.status === "cancelado") && hint){
    hint.textContent = `${o.status === "rejeitado" ? "Perdida" : "Cancelada"}${o.motivo_encerramento ? ": " + o.motivo_encerramento : ""}${o.concorrente ? " · fechou com " + o.concorrente : ""}`;
    return;
  }
  if(!orcEditId || !orcPodeEditar()) return;

  if(o.status !== "aprovado"){
    if(hint) hint.textContent = `Botão "Criar obra" aparece quando status = aprovado (atual: ${o.status}).`;
    return;
  }

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




async function carregarAbasOrc(o){
  if(!orcEditId || !o) return;

  const [revRes, contrRes, medRes] = await Promise.all([
    sb.from("orcamentos")
      .select("id,numero_revisao,status,valor_total,iss_percentual,iss_por_dentro,data_orcamento,updated_at")
      .eq("numero", o.numero)
      .order("updated_at", { ascending: false }),
    sb.from("contratos")
      .select("id,numero,status,data_assinatura,valor_total,obras:obras!contrato_id(id,codigo,nome,status)")
      .eq("orcamento_id", orcEditId),


    sb.from("medicao_itens")
      .select("medicao_id, valor_total, orcamento_item:orcamento_item_id!inner(orcamento_id), medicao:medicao_id(id,numero,status,data_medicao,obra:obra_id(codigo,nome))")
      .eq("orcamento_item.orcamento_id", orcEditId)
  ]);

  const revisoes  = revRes.data || [];
  const contratos = contrRes.data || [];
  const obras     = contratos.flatMap(c => c.obras || []);

  const medMap = {};
  (medRes.data || []).forEach(mi => {
    if(!mi.medicao) return;
    const m = mi.medicao;
    if(!medMap[m.id]) medMap[m.id] = { ...m, _itens: 0 };
    medMap[m.id]._itens++;
  });
  const medicoes = Object.values(medMap);
  _orcVinculos = { contratos, obras, medicoes };


  const setSB = (id, n) => {
    const el = $(id);
    if(!el) return;
    el.querySelector(".sb-num").textContent = n || 0;
    el.classList.toggle("zero", !n);
  };
  setSB("sb-orc-contratos", contratos.length);
  setSB("sb-orc-obras",     obras.length);
  setSB("sb-orc-medicoes",  medicoes.length);
  setSB("sb-orc-revisoes",  Math.max(0, revisoes.length - 1));


  if($("orc-rev-badge")) $("orc-rev-badge").textContent = revisoes.length > 1 ? revisoes.length - 1 : "";

  carregarArquivosOrc(orcEditId);
  carregarEnviosOrc(orcEditId);

  renderizarRevisoesOrc(revisoes, o);

  renderizarVinculosOrc(contratos, obras, medicoes);
}

function renderizarRevisoesOrc(revs, atual){
  const cont = $("orc-revisoes-conteudo");
  if(!cont) return;
  if(!revs.length){
    cont.innerHTML = `<p class="vazio">Apenas a revisão atual.</p>`;
    return;
  }

  revs.sort((a,b) => {
    const av = parseInt(a.numero_revisao,10) || 0;
    const bv = parseInt(b.numero_revisao,10) || 0;
    return bv - av;
  });
  const linhas = revs.map(r => {
    const ehAtual = r.id === atual.id;
    return `<tr class="${ehAtual ? "" : "linha-clicavel"}" data-id="${esc(r.id)}" style="${ehAtual ? "background:var(--info-bg);" : ""}">
      <td><strong>Rev ${esc(r.numero_revisao||"00")}</strong> ${ehAtual ? '<span class="badge-alterado" style="background:var(--acao);color:var(--txt-sobre);border-color:var(--acao);">ATUAL</span>' : ""}</td>
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
      <tbody>${contratos.map(c => `<tr class="linha-clicavel" data-abrir="contrato" data-id="${esc(c.id)}" title="Abrir contrato">
        <td><strong>${esc(c.numero||"—")}</strong></td>
        <td>${tagStatus("contrato", c.status)}</td>
        <td>${dataBR(c.data_assinatura)}</td>
        <td class="num">${brl(c.valor_total||0)}</td>
      </tr>`).join("")}</tbody></table></div>` : "";

  const blocoObras = obras.length ? `
    <h4>🏗️ Obras (${obras.length})</h4>
    <div class="tabela-rola" style="margin-bottom:14px;"><table>
      <thead><tr><th>Código</th><th>Nome</th><th>Status</th></tr></thead>
      <tbody>${obras.map(o => `<tr class="linha-clicavel" data-abrir="obra" data-id="${esc(o.id)}" title="Abrir obra">
        <td><strong>${esc(o.codigo||"—")}</strong></td>
        <td>${esc(o.nome||"—")}</td>
        <td>${tagStatus("obra", o.status)}</td>
      </tr>`).join("")}</tbody></table></div>` : "";

  const blocoMed = medicoes.length ? `
    <h4>💰 Medições (${medicoes.length})</h4>
    <div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Obra</th><th>Status</th><th>Data</th><th class="num">Itens com este orçamento</th></tr></thead>
      <tbody>${medicoes.map(m => `<tr class="linha-clicavel" data-abrir="medicao" data-id="${esc(m.id)}" title="Abrir medição">
        <td><strong>${esc(m.numero||"—")}</strong></td>
        <td>${esc(m.obra?.codigo||"")} ${esc(m.obra?.nome||"")}</td>
        <td>${tagStatus("medicao", m.status)}</td>
        <td>${dataBR(m.data_medicao)}</td>
        <td class="num">${esc(m._itens)}</td>
      </tr>`).join("")}</tbody></table></div>` : "";

  cont.innerHTML = blocoContrat + blocoObras + blocoMed;
}




async function criarNovaRevisaoOrc(){
  if(!orcEditId){ aviso("app-aviso","Salve o orçamento atual primeiro.","erro"); return; }
  const { data: atual, error: e1 } = await sb.from("orcamentos").select("*").eq("id", orcEditId).single();
  if(e1){ aviso("app-aviso","Erro: "+e1.message,"erro"); return; }

  const { data: irmas } = await sb.from("orcamentos").select("numero_revisao").eq("numero", atual.numero);
  const revAtual = Math.max(parseInt(atual.numero_revisao, 10) || 0, ...(irmas || []).map(r => parseInt(r.numero_revisao, 10) || 0));
  const novaRev  = String(revAtual + 1).padStart(2, "0");
  if(!await uiConfirmar({ titulo: "Criar nova revisão", texto: `Criar nova revisão ${novaRev} a partir da atual (Rev ${atual.numero_revisao || "00"})? Vai copiar todos os itens. Status inicial: rascunho.`, confirmar: "Criar revisão" })) return;


  const novo = { ...atual };
  delete novo.id; delete novo.created_at; delete novo.updated_at;
  novo.numero_revisao = novaRev;
  novo.status = "rascunho";
  novo.observacoes = (atual.observacoes ? atual.observacoes + "\n\n" : "") + `Criado a partir da Rev ${atual.numero_revisao || "00"} em ${new Date().toLocaleString("pt-BR")}.`;

  const { data: novoOrc, error: e2 } = await sb.from("orcamentos").insert(novo).select("id").single();
  if(e2){ aviso("app-aviso","Erro ao criar revisão: "+e2.message,"erro"); return; }



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



async function criarObraDoOrcamento(){
  if(!orcEditId){ aviso("app-aviso","Salve o orçamento primeiro.","erro"); return; }
  const { data: orc, error } = await sb.from("orcamentos").select("*").eq("id", orcEditId).single();
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  if(orc.status !== "aprovado"){ aviso("app-aviso","Status precisa ser 'aprovado' pra criar a obra.","erro"); return; }


  const pNum = orcNumeroPartes(orc.numero, orc.data_orcamento);
  const sugCodigo = pNum.num ? `${pNum.num}-${pNum.ano}` : orc.numero.replace(/^ORC-/i, "OB-");
  const sugNome = `${mapaClientes[orc.cliente_id] || "Obra"} — ${orc.numero}`;

  const vals = await uiPedirValores({ titulo: "Criar obra", confirmar: "Criar obra", campos: [
    { id: "codigo", rotulo: `Código da obra (sugestão: ${sugCodigo})`, valor: sugCodigo, obrigatorio: true },
    { id: "nome", rotulo: "Nome da obra", valor: sugNome, obrigatorio: true },
    { id: "projeto", rotulo: "Obra / Concorrência (como o cliente chama o empreendimento; deixe em branco se não houver)", valor: String(orc.concorrencia || "").trim() }
  ] });
  if(!vals) return;
  const codigo = vals.codigo, nome = vals.nome, nomeProjeto = vals.projeto;
  if(!codigo.trim()){ aviso("app-aviso", "Informe o código da obra.", "erro"); return; }
  if(!nome.trim()){ aviso("app-aviso", "Informe o nome da obra.", "erro"); return; }

  const origem = `orçamento ${orc.numero} Rev${orc.numero_revisao || "00"}`;



  const valorContratado = Math.round(orcTotalComIss(orc) * 100) / 100;


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


  const { data: novaObraReg, error: eObra } = await sb.from("obras").insert({
    codigo: codigo.trim(),
    nome: nome.trim(),
    nome_projeto: String(nomeProjeto || "").trim() || null,
    cliente_id: orc.cliente_id,
    contrato_id: contr.id,
    status: "planejada",
    descricao: `Obra gerada a partir do ${origem}`
  }).select("id").single();
  if(eObra){

    await sb.from("contratos").delete().eq("id", contr.id);
    const m = (eObra.message||"").toLowerCase();
    aviso("app-aviso", (m.includes("duplicate") || m.includes("unique"))
      ? `Já existe uma obra com o código ${codigo.trim()}. Escolha outro.`
      : "Erro ao criar a obra: "+eObra.message, "erro");
    return;
  }


  const { error: eFin } = await sb.from("obras_financeiro").upsert({ obra_id: novaObraReg.id, valor_contratado: valorContratado });




  const { data: mobId, error: eMob } = await sb.rpc("mobilizacao_prevista_do_orcamento", { p_obra: novaObraReg.id });
  const txtMob = eMob ? ` A mobilização prevista não pôde ser criada (${eMob.message}); crie pela aba Máquinas da obra.`
    : mobId ? " Mobilização prevista criada no quadro de Mobilizações." : "";


  const txtArq = await orcCopiarArquivosParaObra(orc, novaObraReg.id);

  aviso("app-aviso", eFin
    ? `🏗️ Obra ${codigo} criada, mas o valor contratado não pôde ser gravado: ${eFin.message}.${txtMob}${txtArq}`
    : `🏗️ Obra ${codigo} criada (status: planejada).${txtMob}${txtArq}`, eFin || eMob ? "erro" : "ok");
  if(typeof carregarObras === "function")     await carregarObras();
  if(typeof carregarContratos === "function") await carregarContratos();
  await carregarAbasOrc(orc);
  await atualizarAcoesOrc(orc);


  const navObras = document.querySelector('nav button[data-secao="obras"]');
  if(navObras) navObras.click();
  setTimeout(() => {
    if(typeof abrirObra === "function") abrirObra(novaObraReg.id);
  }, 120);
}

function atualizarStatusbarOrc(st){
  const bar = $("orc-statusbar");
  orcAtualizarSetasOrdem(st);
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





const ORC_SIM_TIPOS = { helice: "helice_continua", trado: "trado_mecanizado", raiz: "estaca_raiz", secante: "helice_secante" };
const ORC_SIM_CAMPOS = ["orc-sim-estacas", "orc-sim-metros", "orc-sim-diametro", "orc-sim-prof"];
let _orcSimMaquinas = null;
const orcSimRotulo = (m) => `${m.codigo || ""} — ${m.nome || ""}`;
async function orcSimCarregarMaquinas(){
  if(_orcSimMaquinas) return _orcSimMaquinas;
  const { data, error } = await sb.from("equipamentos").select("id,codigo,nome,ativo").eq("tipo", "perfuratriz").order("codigo");
  if(error){ console.error("Simulador:", error); return []; }
  _orcSimMaquinas = data || [];
  const dl = $("orc-sim-maquinas");
  if(dl) dl.innerHTML = _orcSimMaquinas.filter(m => m.ativo !== false).map(m => `<option value="${esc(orcSimRotulo(m))}"></option>`).join("");
  return _orcSimMaquinas;
}
async function orcSimPreparar(o){
  ORC_SIM_CAMPOS.concat("orc-sim-tipo").forEach(id => { const el = $(id); if(el){ el.value = ""; delete el.dataset.editado; } });
  if($("orc-sim-tipo")) $("orc-sim-tipo").value = ORC_SIM_TIPOS[o.tipo_proposta] || "helice_continua";
  if($("orc-sim-inicio")) $("orc-sim-inicio").value = o.inicio_desejado || "";
  if($("orc-sim-resultado")) $("orc-sim-resultado").innerHTML = "";
  if($("btn-orc-sim-usar")) $("btn-orc-sim-usar").style.display = "none";
  const inp = $("orc-sim-maquina");
  if(!inp) return;
  const id = o.equipamento_previsto_id || "";
  inp.dataset.id = id;
  inp.value = "";
  const lista = await orcSimCarregarMaquinas();
  const m = lista.find(x => x.id === id);
  if(m && inp.dataset.id === id) inp.value = orcSimRotulo(m);
}

function orcSimDoItens(){
  const linhas = [...document.querySelectorAll("#orc-itens tr")].map(tr => ({
    desc: tr.querySelector(".it-desc")?.value || "",
    un: tr.querySelector(".it-un")?.value || "",
    qtd: Number(tr.querySelector(".it-qtd")?.value || 0)
  }));
  const somar = (lista) => lista.reduce((s, l) => s + l.qtd, 0);
  const estacas = somar(linhas.filter(l => l.un === "un" && /estaca|Ø/i.test(l.desc)));
  const metros = somar(linhas.filter(l => l.un === "m"));
  const contagem = {};
  linhas.forEach(l => { const m = /[Øø]\s*(\d{2,4})/.exec(l.desc); if(m) contagem[m[1]] = (contagem[m[1]] || 0) + 1; });
  const diam = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a])[0];
  const preencher = (id, v) => { const el = $(id); if(el && !el.dataset.editado) el.value = v ? v : ""; };
  preencher("orc-sim-estacas", estacas ? Math.round(estacas) : "");
  preencher("orc-sim-metros", metros ? Math.round(metros * 100) / 100 : "");
  preencher("orc-sim-diametro", diam || "");
  if($("orc-sim-tipo") && !$("orc-sim-tipo").dataset.editado) $("orc-sim-tipo").value = ORC_SIM_TIPOS[$("orc-tipo-proposta")?.value] || $("orc-sim-tipo").value;
}
function orcSimMaquinaEscolhida(){
  const id = $("orc-sim-maquina")?.dataset.id || "";
  return id && _orcSimMaquinas ? _orcSimMaquinas.find(m => m.id === id) : null;
}

function orcSimEquipamentoConsiderado(){
  const m = orcSimMaquinaEscolhida();
  const texto = m ? (m.nome || m.codigo || "") : "";
  if(texto && $("orc-equipamento")) $("orc-equipamento").value = texto;
  return texto;
}
const orcSimPrazoTexto = (d) => d === 1 ? "~1 dia útil" : `~${d} dias úteis`;
const ORC_SIM_ORIGEM = {
  maquina_faixa: (d) => `desta máquina${d ? ` para Ø ${d}` : ""}`,
  maquina: () => "desta máquina neste tipo de serviço, sem base para este Ø",
  frota_faixa: (d) => `da frota${d ? ` para Ø ${d}` : ""}`,
  frota: () => "da frota neste tipo de serviço"
};
function orcSimRender(r, diametro){
  const alvo = $("orc-sim-resultado"), usar = $("btn-orc-sim-usar");
  if(!alvo) return;
  if(usar){ usar.style.display = "none"; delete usar.dataset.prazo; }
  if(r.erro){ alvo.innerHTML = `<p class="nota">${esc(r.erro)}</p>`; return; }
  const avisos = (r.avisos || []).filter(a => !/^Sem histórico/.test(a)).map(a => `<p class="nota">${esc(a)}</p>`).join("");
  if(r.sem_historico){ alvo.innerHTML = `<p><strong>Sem histórico:</strong> não há produção deste tipo de serviço para estimar o prazo.</p>${avisos}`; return; }
  const dias = Number(r.dias_uteis);
  const origem = (ORC_SIM_ORIGEM[r.ritmo_origem] || (() => ""))(diametro);
  const ritmo = `Ritmo histórico ${esc(origem)}: <strong>${num(r.ritmo_m_dia)} m/dia útil</strong> (${esc(r.ritmo_dias_base)} dia${Number(r.ritmo_dias_base) === 1 ? "" : "s"} de base), ${num(r.metros)} m → <strong>${esc(orcSimPrazoTexto(dias))}</strong>.`;
  const fila = r.obra_atual_codigo && r.obra_atual_termino
    ? `A máquina está na obra ${esc(r.obra_atual_codigo)} com término previsto em ${dataBR(r.obra_atual_termino)} + ${esc(r.mobilizacao_dias)} dias de mobilização → pode começar em <strong>${dataBR(r.inicio_possivel)}</strong> e terminar em <strong>${dataBR(r.termino_estimado)}</strong>.`
    : `${r.obra_atual_codigo ? `A máquina está na obra ${esc(r.obra_atual_codigo)}. ` : ""}Pode começar em <strong>${dataBR(r.inicio_possivel)}</strong> e terminar em <strong>${dataBR(r.termino_estimado)}</strong>.`;
  alvo.innerHTML = `<p>${  ritmo}</p><p>${  fila}</p>${  avisos}`;
  if(usar && orcPodeEditar()){
    usar.dataset.prazo = orcSimPrazoTexto(dias);
    usar.style.display = "";
  }
}
async function orcSimular(){
  orcSimDoItens();
  const valor = (id) => { const v = Number(String($(id)?.value || "").replace(",", ".")); return isFinite(v) && v > 0 ? v : null; };
  const estacas = valor("orc-sim-estacas"), diametro = valor("orc-sim-diametro");
  const { data, error } = await sb.rpc("orcamento_simular_prazo", {
    p_orcamento: orcEditId || null,
    p_estacas: estacas == null ? null : Math.round(estacas),
    p_metros: valor("orc-sim-metros"),
    p_diametro: diametro,
    p_prof_media: valor("orc-sim-prof"),
    p_tipo: $("orc-sim-tipo")?.value || null,
    p_equipamento: $("orc-sim-maquina")?.dataset.id || null,
    p_inicio: $("orc-sim-inicio")?.value || null
  });
  if(error){ aviso("app-aviso", "Não foi possível simular: " + error.message, "erro"); return; }
  orcSimRender(data, diametro);
}
function ligarOrcSimulador(){
  ORC_SIM_CAMPOS.concat("orc-sim-tipo").forEach(id => $(id)?.addEventListener("input", (e) => { e.target.dataset.editado = "1"; }));
  $("orc-sim-maquina")?.addEventListener("focus", orcSimCarregarMaquinas);
  $("orc-sim-maquina")?.addEventListener("input", (e) => {
    const m = (_orcSimMaquinas || []).find(x => orcSimRotulo(x) === e.target.value);
    e.target.dataset.id = m ? m.id : "";
  });
  $("btn-orc-sim-simular")?.addEventListener("click", () => comBotaoTravado("btn-orc-sim-simular", orcSimular));
  $("btn-orc-sim-usar")?.addEventListener("click", (e) => {
    const campo = $("orc-prazo");
    if(!campo || !e.currentTarget.dataset.prazo) return;
    campo.value = e.currentTarget.dataset.prazo;
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    aviso("app-aviso", `Prazo de execução preenchido com "${e.currentTarget.dataset.prazo}". Clique em Salvar para gravar; dá para editar antes.`, "ok");
  });
}







const ORC_NEG_CANAL = { ligacao: "Ligação", email: "E-mail", whatsapp: "WhatsApp", reuniao: "Reunião", visita: "Visita" };
let _orcRetornos = {};
let _orcNegLista = [];

function orcPodeLerNegociacao(){
  if(!usuarioAtual) return false;
  return ["diretor", "comercial", "financeiro", "auditor"].includes(usuarioAtual.cargo) || temModuloExtra("orcamentos");
}
const _orcNegMaisNova = (a, b) => String(b.data_hora).localeCompare(String(a.data_hora)) || String(b.created_at).localeCompare(String(a.created_at));

function orcNegRetornoAberto(lista){
  const ult = (lista || []).slice().sort(_orcNegMaisNova)[0];
  return ult && ult.proximo_em && !ult.sem_retorno ? ult : null;
}
async function orcCarregarRetornos(){
  if(!orcPodeLerNegociacao()) return {};
  const { data, error } = await lerTudo(() => sb.from("orcamento_interacoes").select("id,orcamento_id,data_hora,created_at,proximo_em,sem_retorno"));
  if(error) return {};
  const porOrc = {};
  data.forEach(i => { (porOrc[i.orcamento_id] = porOrc[i.orcamento_id] || []).push(i); });
  const out = {};
  Object.entries(porOrc).forEach(([id, l]) => { const ab = orcNegRetornoAberto(l); if(ab) out[id] = ab.proximo_em; });
  return out;
}

function orcFimDaSemanaISO(){
  const [a, m, d] = hojeISO().split("-").map(Number);
  const dt = new Date(a, m - 1, d);
  dt.setDate(dt.getDate() + (7 - dt.getDay()) % 7);
  return dataLocalISO(dt);
}
function orcNegNomeUsuario(id){
  const op = id && $("orc-responsavel") ? [...$("orc-responsavel").options].find(o => o.value === id) : null;
  return op ? op.textContent : "";
}
function orcNegAgoraLocal(){
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${dataLocalISO(d)}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function orcNegLimparForm(){
  if(!$("orc-neg-data")) return;
  $("orc-neg-data").value = orcNegAgoraLocal();
  $("orc-neg-canal").value = "ligacao";
  $("orc-neg-contato").value = $("orc-contato-nome")?.value || "";
  $("orc-neg-resumo").value = "";
  $("orc-neg-proximo").value = "";
  const sel = $("orc-neg-resp");
  sel.value = usuarioAtual && [...sel.options].some(o => o.value === usuarioAtual.id) ? usuarioAtual.id : "";
  $("orc-neg-aviso").textContent = "";
}
function orcNegAtualizarChip(aberto){
  const wrap = $("orc-ficha-retorno-wrap");
  if(!wrap) return;
  wrap.style.display = aberto ? "" : "none";
  if(!aberto) return;
  const venc = aberto.proximo_em < hojeISO();
  const quem = orcNegNomeUsuario(aberto.proximo_responsavel_id);
  $("orc-ficha-retorno-chip").textContent = `em ${dataBR(aberto.proximo_em)}${venc ? " (vencido)" : ""}`;
  wrap.title = `Próximo retorno agendado na aba Negociação${quem ? ", com " + quem : ""}`;
}
function renderOrcNegociacao(){
  const cont = $("orc-neg-lista");
  if(!cont) return;
  const pode = orcPodeEditar() && !!orcEditId;
  if($("orc-neg-form")) $("orc-neg-form").style.display = pode ? "" : "none";
  const aberto = orcNegRetornoAberto(_orcNegLista);
  const btnSem = $("btn-orc-neg-sem-retorno");
  if(btnSem) btnSem.style.display = pode && aberto ? "" : "none";
  if($("btn-orc-neg-registrar")) $("btn-orc-neg-registrar").title = aberto ? `Registrar o contato; o retorno de ${dataBR(aberto.proximo_em)} sai da Minha fila` : "Registrar o contato com o cliente";
  if($("orc-neg-badge")) $("orc-neg-badge").textContent = _orcNegLista.length || "";
  orcNegAtualizarChip(aberto);
  if(!orcEditId){ cont.innerHTML = uiVazio("Salve o orçamento para registrar a negociação."); return; }
  if(!_orcNegLista.length){ cont.innerHTML = uiVazio("Nenhuma interação registrada."); return; }
  const linhas = _orcNegLista.map(i => {
    const titulo = [ORC_NEG_CANAL[i.canal] || i.canal, i.contato_nome].filter(Boolean).join(" · ");
    const resp = orcNegNomeUsuario(i.proximo_responsavel_id);
    const ret = !i.proximo_em ? "" : i.sem_retorno ? `Retorno de ${dataBR(i.proximo_em)} encerrado sem retorno`
      : `Retorno em ${dataBR(i.proximo_em)}${resp ? " com " + resp : ""}`;
    const por = orcNegNomeUsuario(i.criado_por);
    const sub = [i.resumo, ret, por ? "por " + por : ""].filter(Boolean).join(" · ");
    return uiLinhaItem(titulo, sub, dataHoraBR(i.data_hora));
  }).join("");
  cont.innerHTML = `<h4 class="rotulo-caps">Histórico de negociação</h4>${  linhas}`;
}
async function orcCarregarNegociacao(id){
  _orcNegLista = [];
  const tab = $("orc-tab-negociacao");
  const pode = orcPodeLerNegociacao();
  if(tab) tab.style.display = pode ? "" : "none";
  if(!pode){ orcNegAtualizarChip(null); return; }
  orcNegLimparForm();
  if(!id){ renderOrcNegociacao(); return; }
  if($("orc-neg-lista")) $("orc-neg-lista").innerHTML = uiVazio("Carregando...");
  const { data, error } = await sb.from("orcamento_interacoes").select("*").eq("orcamento_id", id)
    .order("data_hora", { ascending: false }).order("created_at", { ascending: false });
  if(orcEditId !== id) return;
  if(error){ $("orc-neg-lista").innerHTML = uiVazio("Não foi possível carregar a negociação: " + error.message); return; }
  _orcNegLista = data || [];
  const ab = orcNegRetornoAberto(_orcNegLista);
  if(ab) _orcRetornos[id] = ab.proximo_em; else delete _orcRetornos[id];
  renderOrcNegociacao();
}
async function orcRegistrarInteracao(){
  const id = orcEditId;
  if(!id || !orcPodeEditar()) return;
  const resumo = $("orc-neg-resumo").value.trim();
  const proximo = $("orc-neg-proximo").value || null;
  const resp = $("orc-neg-resp").value || null;
  const dataHora = $("orc-neg-data").value ? new Date($("orc-neg-data").value) : new Date();
  if(!resumo){ $("orc-neg-aviso").textContent = "Escreva o resumo do contato."; $("orc-neg-resumo").focus(); return; }
  if(proximo && !resp){ $("orc-neg-aviso").textContent = "Escolha quem retorna ao cliente."; $("orc-neg-resp").focus(); return; }
  if(isNaN(dataHora.getTime())){ $("orc-neg-aviso").textContent = "Data e hora inválidas."; return; }
  const { error } = await sb.from("orcamento_interacoes").insert({
    orcamento_id: id, data_hora: dataHora.toISOString(), canal: $("orc-neg-canal").value, resumo,
    contato_nome: $("orc-neg-contato").value.trim() || null, proximo_em: proximo, proximo_responsavel_id: proximo ? resp : null
  });
  if(error){ aviso("app-aviso", "Erro ao registrar a interação: " + error.message, "erro"); return; }
  aviso("app-aviso", "Interação registrada.", "sucesso");
  await orcCarregarNegociacao(id);
}
async function orcMarcarSemRetorno(){
  const id = orcEditId;
  const aberto = orcNegRetornoAberto(_orcNegLista);
  if(!id || !aberto || !orcPodeEditar()) return;
  const { error } = await sb.from("orcamento_interacoes").update({ sem_retorno: true }).eq("id", aberto.id);
  if(error){ aviso("app-aviso", "Erro ao encerrar o retorno: " + error.message, "erro"); return; }
  aviso("app-aviso", `Retorno de ${dataBR(aberto.proximo_em)} encerrado sem retorno.`, "sucesso");
  await orcCarregarNegociacao(id);
}

function ativarTabOrc(nome){
  if(nome === "proposta") orcSimDoItens();
  document.querySelectorAll("#orc-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#orc-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}


function linhaItemHTML(){
  const uns = UNIDADES.map(u=>`<option value="${esc(u)}"${u==="un"?" selected":""}>${esc(u)}</option>`).join("");
  return `<tr>
    <td><div class="it-cat-wrap"><select class="it-cat">${_opcoesFiltradasOrc()}</select><button type="button" class="it-cat-all" title="Ver todo o catálogo nesta linha" aria-pressed="false">⋯</button></div></td>
    <td><input type="text" class="it-desc" placeholder="descrição do item" /></td>
    <td><input type="number" class="it-qtd" step="0.001" min="0" value="1" /></td>
    <td><select class="it-un">${uns}</select></td>
    <td><input type="number" class="it-vu" step="0.01" min="0" value="0" /></td>
    <td class="it-total num">R$ 0,00</td>
    <td><input type="text" class="it-obs" placeholder='(opcional) ex.: Obs: Item 3 - ...' /><div class="it-nota" title="Nota interna do catálogo: não sai na proposta" hidden><span class="rotulo-caps">Nota do catálogo</span> <span class="it-nota-txt"></span></div></td>
    <td class="col-acao col-acao-ordem"><button type="button" class="btn-ordem" data-ordem="-1" title="Subir este item (a ordem vai para a proposta)" aria-label="Subir item">▲</button><button type="button" class="btn-ordem" data-ordem="1" title="Descer este item (a ordem vai para a proposta)" aria-label="Descer item">▼</button><button type="button" class="btn-rem" title="remover">&times;</button></td>
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
  orcMostrarNotaItem(tr);
}



function orcMostrarNotaItem(tr){
  const box = tr && tr.querySelector(".it-nota");
  if(!box) return;
  const v = _orcVarById[tr.querySelector(".it-cat")?.value];
  const nota = v ? _orcServNota[v.servico_id] : "";
  box.querySelector(".it-nota-txt").textContent = nota || "";
  box.hidden = !nota;
}

function aplicarItemCatalogo(select, semAviso){
  const tr = select.closest("tr");
  const vid = select.value;
  orcMostrarNotaItem(tr);
  if(!vid){ recalcularOrc(); return; }
  const v = _orcVarById[vid];
  if(!v) return;

  const todoCatalogo = tr.querySelector(".it-cat-all")?.classList.contains("ativo");
  if(!semAviso && !todoCatalogo && _orcFaixaAproximada(v, _orcCatFiltro)){
    aviso("app-aviso", `${v.nome}: este diâmetro não tem preço para ${ORC_FAIXA_LBL[_orcCatFiltro.faixa] || _orcCatFiltro.faixa}; entrou a faixa mais próxima. Confira o valor.`, "aviso");
  }
  tr.querySelector(".it-desc").value = _nomeItemCatalogoOrc(v);
  const un = v.unidade || _orcServUnidade[v.servico_id];
  if(un){
    const selUn = tr.querySelector(".it-un");
    if(![...selUn.options].some(o=>o.value===un)){
      selUn.insertAdjacentHTML("beforeend", `<option value="${esc(un)}">${esc(un)}</option>`);
    }
    selUn.value = un;
  }
  const preco = _orcPrecos[vid];
  if(preco != null) tr.querySelector(".it-vu").value = Number(preco);


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
  orcAtualizarSetasOrdem();




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





function orcPodeCadastrarCliente(){ return typeof cliPodeEditar === "function" && cliPodeEditar(); }
function orcAbrirNovoCliente(){
  ["orc-cli-nome","orc-cli-doc","orc-cli-contato","orc-cli-tel","orc-cli-email","orc-cli-cidade"].forEach(id => { const el = $(id); if(el) el.value = ""; });
  if($("orc-cli-tipo")) $("orc-cli-tipo").value = "juridica";
  const uf = $("orc-cli-uf");
  if(uf && !uf.options.length) uf.innerHTML = `<option value="">—</option>` + UFS.map(u => `<option value="${esc(u.toLowerCase())}">${esc(u)}</option>`).join("");
  if(uf) uf.value = "";
  _orcCliCnpj = null; _orcCliDupId = null; orcCliDocStatus("");
  $("orc-cli-modal").style.display = "flex";
  $("orc-cli-nome")?.focus();
}
function orcFecharNovoCliente(){ $("orc-cli-modal").style.display = "none"; }






let _orcCliCnpj = null;
let _orcCliDupId = null;
let _orcCliBusca = 0;
function orcCliDocStatus(txt, erro, html){
  const st = $("orc-cli-doc-status");
  if(!st) return;
  if(html) st.innerHTML =   html; else st.textContent = txt || "";
  st.classList.toggle("txt-perigo", !!erro);
}
function _orcCliMascara(d){
  if(/^\d{14}$/.test(d)) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if(/^\d{11}$/.test(d)) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}
async function orcCliConferirDoc(forcar){
  const d = fiscalDocLimpo($("orc-cli-doc")?.value);
  _orcCliDupId = null;
  if(!d){ orcCliDocStatus(""); return; }
  if(d.length !== 11 && d.length !== 14){ orcCliDocStatus("CPF tem 11 dígitos; CNPJ, 14.", true); return; }
  if(!fiscalDocValido(d)){ orcCliDocStatus("Dígitos verificadores não conferem: confira o número com o cliente.", true); return; }
  const vez = ++_orcCliBusca;

  const { data: dup } = await sb.from("clientes").select("id,nome,contato_nome,telefone,email").in("cpf_cnpj", [d, _orcCliMascara(d)]).limit(1);
  if(vez !== _orcCliBusca) return;
  if(dup && dup.length){
    _orcCliDupId = dup[0].id;
    orcCliDocStatus("", true, `Já cadastrado: <b>${esc(dup[0].nome)}</b>. <button type="button" class="btn-sec btn-sm" id="btn-orc-cli-usar-dup">Usar este cliente</button>`);
    $("btn-orc-cli-usar-dup")?.addEventListener("click", () => orcUsarClienteExistente(dup[0]));
    return;
  }
  if(d.length === 11){ orcCliDocStatus(""); if($("orc-cli-tipo")) $("orc-cli-tipo").value = "fisica"; return; }
  if(!forcar && _orcCliCnpj && _orcCliCnpj.doc === d) return;
  orcCliDocStatus("Buscando o CNPJ na BrasilAPI…");
  const r = await fiscalBuscarCnpj(d);
  if(vez !== _orcCliBusca) return;
  if(r.erro){ orcCliDocStatus(r.erro, true); return; }
  _orcCliCnpj = { doc: d, dados: r };
  const pos = (id, v) => { const c = $(id); if(!c || !v || String(c.value || "").trim()) return; c.value = v; };
  pos("orc-cli-nome", r.razao_social);

  pos("orc-cli-cidade", r.cidade);
  const uf = $("orc-cli-uf");
  if(uf && !uf.value && r.uf && [...uf.options].some(o => o.value === r.uf)) uf.value = r.uf;
  if($("orc-cli-tipo")) $("orc-cli-tipo").value = "juridica";

  const nome = ($("orc-cli-nome")?.value || "").trim();
  const difere = r.razao_social && nome && nome.toUpperCase() !== r.razao_social.toUpperCase();
  if(!r.ativa) orcCliDocStatus(`Atenção: situação cadastral na Receita = ${r.situacao}. Razão social: ${r.razao_social || "—"}.`, true);
  else orcCliDocStatus(`${r.razao_social || "CNPJ encontrado"} · ${[r.cidade, (r.uf || "").toUpperCase()].filter(Boolean).join("/") || "sem município"} · situação ${r.situacao || "ativa"}`
    + (difere ? " · o nome digitado é diferente: confira." : " · endereço vai junto no cadastro."), difere);
}
function orcUsarClienteExistente(c){
  if(![...$("orc-cliente").options].some(o => o.value === c.id)){ aviso("app-aviso", `${c.nome} está inativo ou fora da lista: reative na ficha do cliente (menu Clientes).`, "erro"); return; }
  $("orc-cliente").value = c.id;
  $("orc-cliente").dispatchEvent(new Event("change", { bubbles: true }));
  const preencher = (k, val) => { const el = $(k); if(el && !el.value.trim() && val) el.value = val; };
  preencher("orc-contato-nome",  c.contato_nome);
  preencher("orc-contato-tel",   c.telefone);
  preencher("orc-contato-email", c.email);
  if($("orc-ficha-cliente-chip")) $("orc-ficha-cliente-chip").textContent = c.nome;
  orcFecharNovoCliente();
  aviso("app-aviso", `Cliente ${c.nome} já estava cadastrado e foi escolhido neste orçamento.`, "ok");
}
async function orcSalvarNovoCliente(){


  const docAntes = fiscalDocLimpo($("orc-cli-doc").value);
  if(fiscalDocValido(docAntes) && !_orcCliDupId && !(_orcCliCnpj && _orcCliCnpj.doc === docAntes)) await orcCliConferirDoc(false);
  const nome = $("orc-cli-nome").value.trim();
  if(!nome){ aviso("app-aviso", "Informe o nome/razão social do cliente.", "erro"); $("orc-cli-nome").focus(); return; }
  const doc = $("orc-cli-doc").value.trim();
  if(doc && typeof fiscalDocValido === "function" && !fiscalDocValido(doc)){
    aviso("app-aviso", "CPF/CNPJ inválido: confira os dígitos verificadores.", "erro"); $("orc-cli-doc").focus(); return;
  }
  if(_orcCliDupId){ aviso("app-aviso", "Já existe um cliente com esse CPF/CNPJ: use o botão \"Usar este cliente\".", "erro"); return; }
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

  if(_orcCliCnpj && _orcCliCnpj.doc === fiscalDocLimpo(doc)){
    const r = _orcCliCnpj.dados;
    Object.assign(reg, { nome_fantasia: r.nome_fantasia || null, cep: r.cep || null, logradouro: r.logradouro || null, numero: r.numero || null,
      complemento: r.complemento || null, bairro: r.bairro || null, codigo_ibge: r.ibge || null });
  }
  const { data, error } = await sb.from("clientes").insert(reg).select("id,nome,contato_nome,telefone,email").single();
  if(error){
    const m = (error.message || "").toLowerCase();
    aviso("app-aviso", m.includes("duplicate") || m.includes("unique") ? "Já existe um cliente com esse CPF/CNPJ: escolha-o na lista."
      : /row-level security|42501/.test(m) ? "Seu perfil não cadastra clientes (peça ao comercial ou à diretoria)."
      : "Não foi possível cadastrar o cliente: " + error.message, "erro");
    return;
  }

  const obrCli = $("obr-cliente")?.value || "";
  if(typeof carregarClientesSelects === "function") await carregarClientesSelects();
  if($("obr-cliente") && obrCli) $("obr-cliente").value = obrCli;
  $("orc-cliente").value = data.id;
  const preencher = (k, val) => { const el = $(k); if(el && !el.value.trim() && val) el.value = val; };
  preencher("orc-contato-nome",  data.contato_nome);
  preencher("orc-contato-tel",   data.telefone);
  preencher("orc-contato-email", data.email);
  $("orc-ficha-cliente-chip").textContent = data.nome;
  orcMostrarGrupoDoCliente();
  orcFecharNovoCliente();
  aviso("app-aviso", `Cliente ${data.nome} cadastrado e escolhido neste orçamento.`, "ok");
  if(typeof carregarClientes === "function") carregarClientes();
}


async function salvarOrcamento(novoStatus){
  if(!orcPodeEditar()){ aviso("app-aviso", "Seu acesso a Orçamentos é só de leitura.", "erro"); return; }
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
        secao:          null,
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
    cidade_emissao:             "Itabira/MG",
    referencia_obra:            $("orc-ref-obra").value.trim() || null,
    escopo_servicos:            $("orc-escopo").value || null,
    equipamento_considerado:    $("orc-equipamento").value.trim() || orcSimEquipamentoConsiderado() || null,
    equipamento_previsto_id:    $("orc-sim-maquina")?.dataset.id || null,
    inicio_desejado:            $("orc-sim-inicio")?.value || null,
    iss_percentual:             Number($("orc-iss-perc").value || 5),
    iss_por_dentro:             $("orc-iss-pdentro").checked,
    validade_dias:              Number($("orc-validade-dias").value || 30),
    porte_equipamento:          $("orc-porte").value || null,
    faixa_profundidade:         $("orc-faixa").value || null,
    projeto_fornecido:          $("orc-proj-forn").checked,
    sondagem_fornecida:         $("orc-sond-forn").checked,
    projeto_sondagem_fornecido: $("orc-proj-forn").checked && $("orc-sond-forn").checked,
    contato_nome:               $("orc-contato-nome").value.trim() || null,
    contato_telefone:           $("orc-contato-tel").value.trim() || null,
    contato_email:              $("orc-contato-email").value.trim() || null,
    condicoes_pagamento:        $("orc-pagamento").value.trim() || null,
    prazo_pagamento_dias:       Number($("orc-prazo-pagamento")?.value) || 15,
    pagamento_forma:            $("orc-pagamento-forma")?.value === "boleto" ? "boleto" : "deposito",
    prazo_execucao:             $("orc-prazo").value.trim() || null,
    local_execucao:             $("orc-local").value.trim() || null,
    cgl_fornece_diesel:         $("orc-cgl-diesel").checked,
    diesel_preco_litro:         Number($("orc-diesel-preco").value || 8.34),
    cgl_fornece_hospedagem:     $("orc-cgl-hospedagem").checked,
    hospedagem_valor_mensal:    $("orc-hosp-valor").value ? Number($("orc-hosp-valor").value) : null,
    cgl_fornece_alimentacao:    !!$("orc-cgl-alimentacao")?.checked
  };

  if(_orcTemConcorrencia) reg.concorrencia = ($("orc-concorrencia")?.value || "").trim().replace(/\s+/g, " ") || null;


  const doAssistente = !orcEditId && _orcAssistente ? _orcAssistente : null;
  if(doAssistente?.conversa_id) reg.assistente_conversa_id = doAssistente.conversa_id;

  const doPedidoSite = !orcEditId && typeof psiPedidoPendente === "function" ? psiPedidoPendente() : null;
  if(doPedidoSite?.whatsapp) reg.whatsapp_cliente = doPedidoSite.whatsapp;

  let orcId = orcEditId;


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
  let txtArq = "";
  if(doAssistente?.arquivos?.length){
    const falhas = await orcLigarArquivosAssistente(orcId, doAssistente.arquivos);
    txtArq = falhas ? ` ${falhas} arquivo(s) da conversa não foram ligados; anexe de novo pelo assistente.` : ` ${doAssistente.arquivos.length} arquivo(s) do pedido na aba Arquivos.`;
  }
  let erroLigar = null;
  if(doPedidoSite && typeof psiLigarOrcamento === "function"){
    erroLigar = await psiLigarOrcamento(doPedidoSite, orcId);
    txtArq += erroLigar ? " " + erroLigar : ` Pedido do site ${doPedidoSite.protocolo || ""} ligado a este orçamento.`;
  }
  orcLimparAssistente();
  aviso("app-aviso", "Orçamento salvo com sucesso." + txtArq, txtArq.includes("não foram") || erroLigar ? "aviso" : "ok");
  await carregarOrcamentos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  await abrirOrcamento(orcId);
}

async function excluirOrcamento(){
  if(!orcPodeEditar()) return;
  if(!orcEditId) return;
  if(!await uiConfirmar({ titulo: "Excluir orçamento", texto: "Excluir este orçamento e seus itens?", confirmar: "Excluir", perigo: true })) return;
  await sb.from("orcamento_itens").delete().eq("orcamento_id", orcEditId);
  const { error } = await sb.from("orcamentos").delete().eq("id", orcEditId);
  if(error){ aviso("app-aviso","Não foi possível excluir: "+error.message,"erro"); return; }
  aviso("app-aviso","Orçamento excluído.","ok");
  await carregarOrcamentos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  mostrarPainelOrc();
}


function ligarOrcamentos(){
  document.querySelectorAll("#orc-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#orc-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _orcView = b.dataset.view;
      renderOrcamentos();
    });
  });
  ["orc-busca","orc-f-status","orc-f-cliente","orc-f-grupo","orc-f-porte","orc-f-metodo"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "orc-busca" ? "input" : "change", id === "orc-busca" ? debounce(renderOrcamentos) : renderOrcamentos);
  });
  $("orc-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirOrcamento(tr.dataset.id);
  });

  $("btn-novo-orcamento")?.addEventListener("click", novoOrcamento);

  _orcOrdem.ligar("orc-conteudo", renderOrcamentos);
  $("orc-f-conc")?.addEventListener("change", renderOrcamentos);
  $("orc-f-retorno")?.addEventListener("change", renderOrcamentos);
  $("btn-orc-neg-registrar")?.addEventListener("click", () => comBotaoTravado("btn-orc-neg-registrar", orcRegistrarInteracao));
  $("btn-orc-neg-sem-retorno")?.addEventListener("click", () => comBotaoTravado("btn-orc-neg-sem-retorno", orcMarcarSemRetorno));
  $("orc-concorrencia")?.addEventListener("change", orcAoEscolherConcorrencia);
  $("btn-voltar-orc")?.addEventListener("click", mostrarPainelOrc);
  $("btn-salvar-orc")?.addEventListener("click", () => comBotaoTravado("btn-salvar-orc", () => salvarOrcamento()));
  $("btn-excluir-orc")?.addEventListener("click", excluirOrcamento);
  $("btn-add-item")?.addEventListener("click", adicionarItem);
  ligarOrcSimulador();


  ["orc-tipo-obra","orc-porte","orc-faixa"].forEach(id => $(id)?.addEventListener("change", atualizarFiltroCatalogoOrc));
  $("orc-tipo-proposta")?.addEventListener("change", orcTrocarModelo);

  ["orc-cgl-diesel","orc-cgl-hospedagem","orc-cgl-alimentacao"].forEach(id => $(id)?.addEventListener("change", (ev) => { atualizarFiltroCatalogoOrc(); if(ev.target.checked) carregarItensPadraoOrc(true); }));

  ["orc-prazo-pagamento","orc-pagamento-forma"].forEach(id => $(id)?.addEventListener("change", () => {
    if(typeof textoPagamentoPadrao === "function" && $("orc-pagamento")) $("orc-pagamento").value = textoPagamentoPadrao($("orc-prazo-pagamento")?.value, $("orc-pagamento-forma")?.value);
  }));
  ["orc-data","orc-validade-dias"].forEach(id => $(id)?.addEventListener("change", recalcularValidadeOrc));
  ["orc-iss-perc","orc-iss-pdentro"].forEach(id => $(id)?.addEventListener("change", recalcularOrc));
  $("btn-orc-ir-modelo")?.addEventListener("click", () => ativarTabOrc("proposta"));
  $("btn-orc-itens-padrao")?.addEventListener("click", () => carregarItensPadraoOrc(false));

  $("orc-cliente")?.addEventListener("change", async () => {
    const id = $("orc-cliente").value;
    orcAtualizarChipCliente();
    if(!id) return;
    const { data:c } = await sb.from("clientes").select("contato_nome,telefone,email").eq("id", id).maybeSingle();
    if(!c) return;
    const preencher = (k, val) => { const el = $(k); if(el && !el.value.trim() && val) el.value = val; };
    preencher("orc-contato-nome",  c.contato_nome);
    preencher("orc-contato-tel",   c.telefone);
    preencher("orc-contato-email", c.email);
  });


  $("btn-orc-novo-cliente")?.addEventListener("click", orcAbrirNovoCliente);

  $("orc-grupo")?.addEventListener("input", orcGrupoDica);
  $("orc-grupo")?.addEventListener("change", () => orcGrupoMudou().catch(err => aviso("app-aviso", err.message, "erro")));
  $("btn-orc-cli-fechar")?.addEventListener("click", orcFecharNovoCliente);
  $("btn-orc-cli-salvar")?.addEventListener("click", () => comBotaoTravado("btn-orc-cli-salvar", orcSalvarNovoCliente));
  $("orc-cli-doc")?.addEventListener("blur", () => orcCliConferirDoc(false));
  $("orc-cli-doc")?.addEventListener("input", () => { _orcCliDupId = null; orcCliDocStatus(""); });
  $("btn-orc-cli-cnpj")?.addEventListener("click", () => comBotaoTravado("btn-orc-cli-cnpj", () => orcCliConferirDoc(true)));


  $("btn-orc-nova-revisao")?.addEventListener("click", criarNovaRevisaoOrc);
  $("btn-orc-criar-obra")?.addEventListener("click", criarObraDoOrcamento);
  $("btn-orc-encerrar")?.addEventListener("click", orcEncerrarSemAprovar);
  $("orc-arquivos-conteudo")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-orc-arq-abrir]"); if(b) orcAbrirArquivo(b.dataset.orcArqAbrir);
  });


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
      if(e.target.classList.contains("btn-ordem")){
        if(!e.target.hidden) orcMoverItem(e.target.closest("tr"), Number(e.target.dataset.ordem));
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
      if(!orcPodeEditar()) return;
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

  $("btn-orc-enviar")?.addEventListener("click", abrirEnvioOrc);

  const navOrc = document.querySelector('nav button[data-secao="orcamentos"]');
  if(navOrc) navOrc.addEventListener("click", mostrarPainelOrc);
}







async function orcEnvioChamar(corpo){
  const { data, error } = await sb.functions.invoke("enviar-orcamento", { body: corpo });
  if(error){
    let msg = error.message || "erro";
    try { const c = await error.context?.json(); if(c?.error) msg = c.error; } catch(_e){}
    throw new Error(msg);
  }
  return data || {};
}
function orcFmtTamanho(n){
  if(n == null) return "";
  return n >= 1048576 ? (n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}
function orcDataHora(iso){ return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""; }
const ORC_ENVIO_STATUS = { enviado: "Enviado", falhou: "Falhou", rascunho: "Enviando" };

async function carregarEnviosOrc(orcId){
  const cont = $("orc-envios");
  if(!cont) return;
  if(!orcId){ cont.innerHTML = ""; return; }
  const { data, error } = await sb.from("orcamento_envios")
    .select("id,enviado_em,enviado_por,destinatarios_para,destinatarios_cc,anexos,status_envio,erro_mensagem,metodo")
    .eq("orcamento_id", orcId).order("enviado_em", { ascending: false }).limit(50);
  if(orcEditId !== orcId) return;
  if(error){ cont.innerHTML = uiSecao("documento", "Propostas enviadas", uiErro("Não foi possível carregar os envios: " + error.message)); return; }
  const envios = data || [];
  if(!envios.length){ cont.innerHTML = uiSecao("documento", "Propostas enviadas", uiVazio("Nenhuma proposta enviada ainda, nem pela orcamento@ nem pelo WhatsApp.")); return; }
  const ids = [...new Set(envios.map(e => e.enviado_por).filter(Boolean))];
  const nomes = {};
  if(ids.length){
    const { data: ps } = await sb.from("profiles").select("id,nome").in("id", ids);
    (ps || []).forEach(p => { nomes[p.id] = p.nome; });
  }
  const linhas = envios.map(e => {
    const quem = nomes[e.enviado_por] || "—";

    const wa = e.metodo === "whatsapp";
    const para = (e.destinatarios_para || []).map(x => wa && typeof psiFoneBR === "function" ? psiFoneBR(x) : x).join(", ");
    const anexos = (e.anexos || []).join(" · ");
    const sub = [`${wa ? "WhatsApp" : "E-mail"} para ${para}`, anexos, e.status_envio === "falhou" && e.erro_mensagem ? "Erro: " + e.erro_mensagem : ""].filter(Boolean).join(" — ");
    return uiLinhaItem(`${orcDataHora(e.enviado_em)} · ${quem}`, sub, ORC_ENVIO_STATUS[e.status_envio] || e.status_envio, "");
  }).join("");
  cont.innerHTML = uiSecao("documento", "Propostas enviadas", linhas, String(envios.length));
}

async function abrirEnvioOrc(){
  if(!orcPodeEditar()) return;
  if(!orcEditId){ uiAvisar("Salve o orçamento antes de enviar a proposta.", "aviso"); return; }
  if(appFormSujo()){ uiAvisar("Salve o orçamento antes de enviar: a proposta sai do que está gravado.", "aviso"); return; }
  const orcId = orcEditId;
  const { data: o, error: eO } = await sb.from("orcamentos").select("contato_email,email_origem_id,email_origem_assunto").eq("id", orcId).single();
  if(eO){ uiAvisar("Não foi possível abrir o envio: " + eO.message, "perigo"); return; }

  const corpo = `<div class="orc-envio">
    <div class="orc-envio-campos">
      ${  uiCampo({ id: "orc-env-para", rotulo: "Para", valor: o.contato_email || "", obrigatorio: true, placeholder: "e-mail do cliente", ajuda: "Vários: separe por vírgula." })}
      <div id="orc-env-sug" class="orc-env-sug"></div>
      ${  uiCampo({ id: "orc-env-cc", rotulo: "Cc (além da orcamento@)", placeholder: "opcional" })}
      ${  uiCampo({ id: "orc-env-fio", rotulo: "Responder ao pedido", tipo: "select", placeholder: "Mensagem nova", opcoes: [["", "Procurando pedidos na orcamento@…"]] })}
      ${  uiCampo({ id: "orc-env-obs", rotulo: "Observação (parágrafo opcional no e-mail)", tipo: "textarea" })}
      <div id="orc-env-manual"></div>
    </div>
    <div class="orc-envio-previa-cab"><span class="rotulo-caps">Assunto</span> <strong id="orc-env-assunto">…</strong></div>
    <div class="orc-envio-dest" id="orc-env-dest"></div>
    <iframe id="orc-env-previa" class="orc-envio-previa" sandbox="" title="Prévia do e-mail como vai sair"></iframe>
    <div id="orc-env-anexos">${  uiCarregando("Montando os anexos…")}</div>
    <div id="orc-env-msg"></div>
  </div>`;
  const d = document.createElement("dialog");
  d.className = "ui-modal";
  d.setAttribute("aria-label", "Enviar proposta");
  d.innerHTML = uiModalHTML({ titulo: "Enviar proposta pela orcamento@", corpoHTML: corpo, largura: "g", acoes: [
    { id: "cancelar", texto: "Cancelar" }, { id: "enviar", texto: "Enviar", primaria: true }
  ] });
  document.body.appendChild(d);
  const q = sel => d.querySelector(sel);
  let enviando = false, pdfBlob = null, pdfErro = null, anexosPrevia = [], seqPrevia = 0;



  let manualInfo = null, anexarManual = false;
  const fechar = () => { if(!enviando) d.close(); };
  d.addEventListener("close", () => d.remove());
  d.addEventListener("cancel", ev => { if(enviando) ev.preventDefault(); });

  const fioSel = q("#orc-env-fio");

  const pdfPronto = gerarPropostaPdfBlob(orcId).then(b => { pdfBlob = b; }).catch(err => { pdfErro = err; }).finally(() => renderAnexos());

  function renderAnexos(){
    const alvo = q("#orc-env-anexos");
    if(!alvo || !anexosPrevia.length) return;
    alvo.innerHTML = uiSecao("documento", "Anexos", anexosPrevia.map((a, i) => {
      const tam = i === 0 ? (pdfBlob ? orcFmtTamanho(pdfBlob.size) : pdfErro ? "erro" : "gerando…") : orcFmtTamanho(a.tamanho);
      return uiLinhaItem(a.nome, i === 0 ? "Proposta (mesmo PDF do botão PDF)" : a.tipo === "manual" ? "Manual do equipamento" : "Anexo fixo", tam, "");
    }).join(""), String(anexosPrevia.length));
    if(pdfErro) q("#orc-env-msg").innerHTML = uiErro("Não foi possível gerar o PDF da proposta: " + (pdfErro.message || pdfErro));
  }

  function lerCampos(){
    return { para: q("#orc-env-para").value, cc: q("#orc-env-cc").value, observacao: q("#orc-env-obs").value,
      email_origem_id: fioSel.value && fioSel.value !== "" ? fioSel.value : null, anexar_manual: !!manualInfo && anexarManual };
  }

  function renderManual(){
    const alvo = q("#orc-env-manual");
    if(!alvo) return;
    if(!manualInfo){ alvo.innerHTML = ""; return; }
    if(q("#orc-env-manual-cx")) return;
    alvo.innerHTML = `<label class="check-inline" title="Anexa o manual do equipamento do método desta proposta"><input type="checkbox" id="orc-env-manual-cx" ${anexarManual ? "checked" : ""} /> Anexar manual do equipamento (${esc(manualInfo.nome)})</label>`;
    q("#orc-env-manual-cx").addEventListener("change", ev => { anexarManual = ev.target.checked; atualizarPrevia(); });
  }

  async function atualizarPrevia(){
    const seq = ++seqPrevia;
    const c = lerCampos();
    if(!c.para.trim()){ q("#orc-env-assunto").textContent = "—"; q("#orc-env-dest").textContent = "Informe o e-mail do cliente em Para."; return; }
    try {
      const r = await orcEnvioChamar({ acao: "previa", orcamento_id: orcId, ...c });
      if(seq !== seqPrevia || !d.isConnected) return;
      q("#orc-env-assunto").textContent = r.assunto || "";
      q("#orc-env-dest").textContent = `Para: ${(r.para || []).join(", ")} · Cc: ${(r.cc || []).join(", ")}${r.no_fio ? " · resposta no fio do pedido" : ""}`;
      q("#orc-env-previa").srcdoc = r.html || "";
      anexosPrevia = r.anexos || [];
      const achouManual = !manualInfo && !!r.manual;
      manualInfo = r.manual || null;
      renderManual();
      renderAnexos();

      if(achouManual && anexarManual) atualizarPrevia();
      if(!pdfErro) q("#orc-env-msg").innerHTML = "";
    } catch(err){
      if(seq !== seqPrevia || !d.isConnected) return;
      q("#orc-env-dest").textContent = "";
      q("#orc-env-msg").innerHTML = uiErro("Prévia: " + (err.message || err));
    }
  }
  const previaDepois = debounce(atualizarPrevia, 500);
  ["#orc-env-para", "#orc-env-cc", "#orc-env-obs"].forEach(s => q(s).addEventListener("input", previaDepois));
  fioSel.addEventListener("change", atualizarPrevia);

  async function carregarPedidos(){
    let pedidos = [], aviso = "";
    try { const r = await orcEnvioChamar({ acao: "pedidos", orcamento_id: orcId, para: q("#orc-env-para").value }); pedidos = r.pedidos || []; aviso = r.aviso || ""; }
    catch(err){ aviso = "Não foi possível ler a orcamento@: " + (err.message || err); }
    if(!d.isConnected) return;
    fioSel.innerHTML = "";
    const novo = document.createElement("option");
    novo.value = ""; novo.textContent = pedidos.length ? "Mensagem nova" : "Mensagem nova (nenhum pedido do domínio do contato)";
    fioSel.appendChild(novo);
    if(o.email_origem_id && !pedidos.some(p => p.id === o.email_origem_id)){
      pedidos.unshift({ id: o.email_origem_id, assunto: o.email_origem_assunto || "pedido usado no último envio", nome: "", de: "", recebido_em: null });
    }
    pedidos.forEach(p => {
      const op = document.createElement("option");
      op.value = p.id;
      op.textContent = [p.recebido_em ? orcDataHora(p.recebido_em) : "último envio", p.nome || p.de, p.assunto].filter(Boolean).join(" · ").slice(0, 160);
      fioSel.appendChild(op);
    });
    fioSel.disabled = false;
    if(o.email_origem_id) fioSel.value = o.email_origem_id;
    if(aviso) q("#orc-env-msg").innerHTML = uiErro(aviso);
    atualizarPrevia();
  }

  async function enviar(btn){
    const c = lerCampos();
    if(!c.para.trim()){ q("#orc-env-msg").innerHTML = uiErro("Informe o e-mail do cliente em Para."); return; }
    enviando = true;
    q("#orc-env-msg").innerHTML = uiCarregando("Enviando pela orcamento@…");
    try {
      await pdfPronto;
      if(!pdfBlob) throw new Error("O PDF da proposta não foi gerado" + (pdfErro ? ": " + (pdfErro.message || pdfErro) : "."));
      const caminho = `${orcId}/${Date.now()}.pdf`;
      const { error: eUp } = await sb.storage.from("orcamentos-envio").upload(caminho, new Blob([pdfBlob], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
      if(eUp) throw new Error("Não foi possível subir o PDF: " + eUp.message);
      const r = await orcEnvioChamar({ acao: "enviar", orcamento_id: orcId, pdf_path: caminho, ...c });
      enviando = false;
      d.close();
      uiAvisar(`Proposta enviada pela orcamento@${r.no_fio ? " no fio do pedido" : ""}.${r.aviso ? " " + r.aviso : ""}`, r.aviso ? "aviso" : "ok");
      if(orcEditId === orcId) await abrirOrcamento(orcId);
    } catch(err){
      enviando = false;
      q("#orc-env-msg").innerHTML = uiErro(err.message || String(err));
      uiAvisar("A proposta não foi enviada: " + (err.message || err), "perigo");
      if(orcEditId === orcId) carregarEnviosOrc(orcId);
    }
  }

  d.addEventListener("click", ev => {
    const b = ev.target.closest("[data-acao]");
    if(b){
      if(b.dataset.acao === "enviar") comBotaoTravado(b, () => enviar(b));
      else fechar();
    } else if(ev.target === d) fechar();
  });
  d.showModal();
  q("#orc-env-para").focus();
  if(typeof cctOrcSugerirEmails === "function") cctOrcSugerirEmails(d, $("orc-cliente")?.value || "");
  carregarPedidos();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarOrcamentos);
} else {
  ligarOrcamentos();
}

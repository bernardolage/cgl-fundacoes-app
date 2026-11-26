











const MTZ_TELA_LIBERADA = true;

const MTZ_ACOES = { ver: "Vê", incluir: "Inclui", alterar: "Altera", apagar: "Apaga" };

const MTZ_RESPOSTA = {
  s: { texto: "sim", simbolo: "✓" },
  n: { texto: "não", simbolo: "✕" },
  p: { texto: "em parte", simbolo: "◐" },
  x: { texto: "não conferido", simbolo: "?" },
  z: { texto: "não se aplica", simbolo: "–" }
};
let _mtzModo = "cargo";
let _mtzCargo = null;
let _mtzModulo = null;
let _mtzDetalhes = [];

function mtzDados(){ return typeof MATRIZ_ACESSOS !== "undefined" && MATRIZ_ACESSOS && MATRIZ_ACESSOS.celulas ? MATRIZ_ACESSOS : null; }
function mtzTelaLiberada(){ return MTZ_TELA_LIBERADA && !!mtzDados(); }
function mtzRotuloCargo(cargo){ return (typeof CARGOS !== "undefined" && CARGOS[cargo]) || cargo; }


function mtzCelula(cod){
  const d = mtzDados();
  const m = /^([snpxz])(?:=([snp]))?(?::([\d,]+))?$/.exec(cod || "");
  if(!m || !d) return { v: "x", est: null, frases: [] };
  return { v: m[1], est: m[2] || null, frases: (m[3] ? m[3].split(",") : []).map(i => d.frases[Number(i)]).filter(Boolean) };
}
function mtzCelulas(modulo, cargo){
  const d = mtzDados();
  const txt = d && d.celulas[modulo] ? d.celulas[modulo][cargo] : null;
  return txt ? txt.split(" ").map(mtzCelula) : null;
}

function mtzResumoCargo(cargo){
  const d = mtzDados();
  if(!d || !d.cargos.includes(cargo)) return null;
  const r = { total: d.modulos.length, ve: 0, emParte: 0, naoConferido: 0, ressalva: d.sem_conferencia[cargo] || "" };
  d.modulos.forEach(m => {
    const c = (mtzCelulas(m.id, cargo) || [])[0];
    if(!c) return;
    if(c.v === "s") r.ve++;
    else if(c.v === "p"){ r.ve++; r.emParte++; }
    else if(c.v === "x" && c.est !== "n") r.naoConferido++;
  });
  return r;
}
function mtzFraseResumo(cargo){
  const r = mtzResumoCargo(cargo);
  if(!r) return "";
  if(r.naoConferido) return `Não conferido: pela leitura das regras, vê ${r.ve + r.naoConferido} dos ${r.total} módulos.`;
  return `Vê ${r.ve} dos ${r.total} módulos` + (r.emParte ? ` (${r.emParte} em parte).` : ".");
}


function mtzTextoCelula(c){
  const base = MTZ_RESPOSTA[c.v].texto;
  const partes = [];
  if(c.v === "x") partes.push("Não conferido: falta usuário ativo deste cargo, sem liberação por pessoa, para simular. Pela leitura das regras: " + (c.est ? MTZ_RESPOSTA[c.est].texto : "sem leitura") + ".");
  c.frases.forEach(f => partes.push(f));
  return partes.length ? base + ": " + partes.join(" ") : base;
}
function mtzCelulaHTML(c, onde){
  const r = MTZ_RESPOSTA[c.v];
  const leitura = c.v === "x" && c.est ? `<small>leitura: ${esc(MTZ_RESPOSTA[c.est].texto)}</small>` : "";
  const dentro = `<span class="mtz-simb" aria-hidden="true">${esc(r.simbolo)}</span> ${esc(r.texto)}${  leitura}`;
  if(c.v !== "x" && !c.frases.length) return `<span class="mtz-cel mtz-${esc(c.v)}">${  dentro}</span>`;
  const texto = mtzTextoCelula(c);
  _mtzDetalhes.push(onde + " · " + texto);
  return `<button type="button" class="mtz-cel mtz-${esc(c.v)} mtz-tem-detalhe" data-mtz-det="${_mtzDetalhes.length - 1}" title="${esc(texto)}">${  dentro}</button>`;
}
function mtzLinhaHTML(rotulo, celulas, onde){
  const acoes = Object.values(MTZ_ACOES);
  const tds = (celulas || []).map((c, i) => `<td>${  mtzCelulaHTML(c, onde + " · " + acoes[i])}</td>`).join("");
  return `<tr><th scope="row">${esc(rotulo)}</th>${  tds}</tr>`;
}

function mtzTabelaPorCargo(d, cargo){
  let grupo = null;
  const linhas = d.modulos.map(m => {
    const cab = m.grupo !== grupo ? `<tr class="mtz-grupo"><th colspan="5" scope="colgroup"><span class="rotulo-caps">${esc(m.grupo)}</span></th></tr>` : "";
    grupo = m.grupo;
    return cab + mtzLinhaHTML(m.rotulo, mtzCelulas(m.id, cargo), m.rotulo);
  }).join("");
  return linhas;
}
function mtzTabelaPorModulo(d, modulo){
  const m = d.modulos.find(x => x.id === modulo) || d.modulos[0];
  return d.cargos.map(c => mtzLinhaHTML(mtzRotuloCargo(c), mtzCelulas(m.id, c), mtzRotuloCargo(c))).join("");
}



function renderMatrizAcessos(alvo){
  const cont = alvo || $("usr-conteudo");
  if(!cont) return;
  const d = mtzDados();
  if(!d){ cont.innerHTML = uiVazio("A matriz de acessos não foi carregada."); return; }
  if(!_mtzCargo || !d.cargos.includes(_mtzCargo)) _mtzCargo = d.cargos[0];
  if(!_mtzModulo || !d.modulos.some(m => m.id === _mtzModulo)) _mtzModulo = d.modulos[0].id;
  _mtzDetalhes = [];

  const porCargo = _mtzModo === "cargo";
  const optCargos = d.cargos.map(c => `<option value="${esc(c)}"${c === _mtzCargo ? " selected" : ""}>${esc(mtzRotuloCargo(c))}</option>`).join("");
  const optModulos = d.modulos.map(m => `<option value="${esc(m.id)}"${m.id === _mtzModulo ? " selected" : ""}>${esc(m.rotulo)}</option>`).join("");
  const desc = typeof CARGO_DESCRICAO !== "undefined" && CARGO_DESCRICAO[_mtzCargo] ? CARGO_DESCRICAO[_mtzCargo].frase : "";
  const ressalva = d.sem_conferencia[_mtzCargo] || "";
  const topo = porCargo
    ? `<p class="mtz-desc"><strong>${esc(mtzRotuloCargo(_mtzCargo))}.</strong> ${esc(desc)}${desc ? "." : ""} <span class="meta">${esc(mtzFraseResumo(_mtzCargo))}</span></p>` +
      (ressalva ? `<p class="mtz-ressalva">${esc(ressalva)}</p>` : "")
    : `<p class="mtz-desc"><strong>${esc((d.modulos.find(m => m.id === _mtzModulo) || {}).rotulo || "")}.</strong> <span class="meta">O que cada cargo faz neste módulo.</span></p>`;
  const corpo = porCargo ? mtzTabelaPorCargo(d, _mtzCargo) : mtzTabelaPorModulo(d, _mtzModulo);
  const cabecalho = Object.values(MTZ_ACOES).map(a => `<th scope="col">${esc(a)}</th>`).join("");
  const legenda = Object.keys(MTZ_RESPOSTA).map(k => `<span class="mtz-cel mtz-${esc(k)}"><span class="mtz-simb" aria-hidden="true">${esc(MTZ_RESPOSTA[k].simbolo)}</span> ${esc(MTZ_RESPOSTA[k].texto)}</span>`).join("");

  cont.innerHTML = `<div class="mtz" id="mtz-raiz">
    <div class="serv-filtros mtz-controles">
      <div class="serv-views" role="group" aria-label="Como ler a matriz">
        <button type="button" class="serv-view-btn${porCargo ? " ativo" : ""}" data-mtz-modo="cargo" aria-pressed="${porCargo ? "true" : "false"}" title="Um cargo, todos os módulos">Por cargo</button>
        <button type="button" class="serv-view-btn${porCargo ? "" : " ativo"}" data-mtz-modo="modulo" aria-pressed="${porCargo ? "false" : "true"}" title="Um módulo, todos os cargos">Por módulo</button>
      </div>
      <select id="mtz-cargo" aria-label="Cargo" title="Cargo mostrado na matriz"${porCargo ? "" : " hidden"}>${  optCargos}</select>
      <select id="mtz-modulo" aria-label="Módulo" title="Módulo mostrado na matriz"${porCargo ? " hidden" : ""}>${  optModulos}</select>
    </div>
    ${  topo}
    <div class="tabela-rola"><table class="mtz-tabela">
      <thead><tr><th scope="col">${porCargo ? "Módulo" : "Cargo"}</th>${  cabecalho}</tr></thead>
      <tbody>${  corpo}</tbody>
    </table></div>
    <p class="mtz-detalhe" id="mtz-detalhe" aria-live="polite">Passe o mouse ou toque em uma resposta sublinhada para ver a condição.</p>
    <div class="mtz-legenda" aria-label="Legenda">${  legenda}</div>
    <p class="mtz-rodape">Retrato do banco em ${esc(dataBR(d.retrato))}. A permissão que vale é a do banco. Liberações por pessoa (módulo extra, responsável da obra, dono do custo), dados que exigem MFA e leituras ou gravações que passam por função do banco (por exemplo, os preços sugeridos ao montar a medição) não aparecem aqui.</p>
  </div>`;
  mtzLigar(cont);
}

function mtzLigar(cont){
  cont.querySelectorAll("[data-mtz-modo]").forEach(b => b.addEventListener("click", () => {
    _mtzModo = b.dataset.mtzModo === "modulo" ? "modulo" : "cargo";
    renderMatrizAcessos(cont);
  }));
  const selCargo = cont.querySelector("#mtz-cargo");
  if(selCargo) selCargo.addEventListener("change", () => { _mtzCargo = selCargo.value; renderMatrizAcessos(cont); });
  const selMod = cont.querySelector("#mtz-modulo");
  if(selMod) selMod.addEventListener("change", () => { _mtzModulo = selMod.value; renderMatrizAcessos(cont); });
  const tabela = cont.querySelector(".mtz-tabela");
  if(tabela) tabela.addEventListener("click", e => {
    const b = e.target.closest("[data-mtz-det]");
    if(!b) return;
    const det = cont.querySelector("#mtz-detalhe");
    if(det) det.textContent = _mtzDetalhes[Number(b.dataset.mtzDet)] || "";
    cont.querySelectorAll(".mtz-cel.mtz-sel").forEach(x => x.classList.remove("mtz-sel"));
    b.classList.add("mtz-sel");
  });
}


function mtzAbrirNoCargo(cargo){
  if(!mtzTelaLiberada()) return false;
  const d = mtzDados();
  if(d.cargos.includes(cargo)) _mtzCargo = cargo;
  _mtzModo = "cargo";
  return true;
}

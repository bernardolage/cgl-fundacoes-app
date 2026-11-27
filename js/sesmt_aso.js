










let _asoSub = "asos";
let _asoLista = [];
let _asoProximos = [];
let _asoCarregado = false;
let _asoEditId = null;
let _asoAso = null;
let _asoExames = [];

const ASO_TIPO = {
  admissional: "Admissional", admissional_obra: "Admissional por obra", periodico: "Periódico", retorno: "Retorno ao trabalho",
  mudanca_risco: "Mudança de risco", mudanca_funcao: "Mudança de função", demissional: "Demissional"
};
const ASO_RESULTADO = {
  apto: { label: "Apto", cor: "verde" },
  apto_com_restricao: { label: "Apto com restrição", cor: "ambar" },
  inapto: { label: "Inapto", cor: "vermelho" }
};
const ASO_VALIDADE = {
  ok: { label: "em dia", cor: "verde" },
  vence_30: { label: "vence em 30 d", cor: "ambar" },
  vencido: { label: "vencido", cor: "vermelho" },
  pendente: { label: "sem ASO válido", cor: "cinza" },
  sem: { label: "sem ASO registrado", cor: "cinza" }
};
const ASO_DESTINO = { sesmt: "Centro SESMT (sede)", obra: "Obra" };


function asoPodeVer(){ return sstPodeOperar() || (!!usuarioAtual && usuarioAtual.cargo === "rh" && !ehSomenteLeitura()); }
function asoTagResultado(r){ const o = ASO_RESULTADO[r]; return o ? `<span class="tag ${esc(o.cor)}">${esc(o.label)}</span>` : `<span class="tag cinza">sem resultado</span>`; }
function asoTagValidade(st){ const o = ASO_VALIDADE[st] || ASO_VALIDADE.sem; return `<span class="tag ${esc(o.cor)}">${esc(o.label)}</span>`; }
function asoExamesReqs(){ return (_sstReqs || []).filter(r => r.natureza === "exame"); }
function asoFornNome(id){ const f = (typeof _trnFornecedores !== "undefined" ? _trnFornecedores : []).find(x => x.id === id); return f ? f.nome : ""; }
function asoClinica(a){ return (a && (asoFornNome(a.fornecedor_id) || a.clinica_nome)) || "—"; }
function asoObraRot(id){ return id ? sstObraRotulo((_sstObras || []).find(o => o.id === id)) : "—"; }
function asoFuncNome(a){ return (a && a.funcionario && a.funcionario.nome) || ((_sstFuncs || []).find(f => f.id === (a && a.funcionario_id)) || {}).nome || "—"; }
function asoMfaMsg(){ return uiVazio("Os exames e os ASO são dado de saúde: entre de novo com o autenticador (MFA) para ver."); }


async function asoCarregar(forcar){
  if(_asoCarregado && !forcar) return true;
  const [l, p] = await Promise.all([
    lerTudo(() => sb.from("sst_asos").select("*, funcionario:funcionarios(nome), exames:sst_aso_exames(id,situacao)")),
    lerTudo(() => sb.rpc("sst_proximos_asos", { p_funcionarios: null }), "funcionario_id")
  ]);
  if(l.error || p.error){ aviso("app-aviso", "Erro ao carregar os ASO: " + (l.error || p.error).message, "erro"); return false; }
  _asoLista = (l.data || []).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  _asoProximos = p.data || [];
  if(typeof trnCarregarFornecedores === "function") await trnCarregarFornecedores();
  _asoCarregado = true;
  return true;
}


function asoFiltrosHTML(){
  return `<div class="serv-filtros" id="aso-filtros">
    <div class="serv-views" id="aso-sub" title="Como mostrar: um ASO por linha ou uma pessoa por linha com o ASO válido até">
      <button type="button" class="serv-view-btn${_asoSub === "asos" ? " ativo" : ""}" data-sub="asos" title="Todos os ASO registrados">ASOs</button>
      <button type="button" class="serv-view-btn${_asoSub === "pessoas" ? " ativo" : ""}" data-sub="pessoas" title="Funcionário ativo com o ASO válido até e o farol">Por pessoa</button>
    </div>
    <select id="aso-f-tipo" title="Filtrar pelo tipo de ASO"><option value="">Tipo</option>${Object.entries(ASO_TIPO).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>
    <select id="aso-f-res" title="Filtrar pelo resultado"><option value="">Resultado</option>${Object.entries(ASO_RESULTADO).map(([v, o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("")}<option value="sem">Sem resultado</option></select>
    <select id="aso-f-val" title="Filtrar pelo ASO válido até (por pessoa)"><option value="">Validade</option>${Object.entries(ASO_VALIDADE).map(([v, o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("")}</select>
    <select id="aso-f-obra" title="Filtrar pela obra do ASO"><option value="">Obra</option>${(_sstObras || []).map(o => `<option value="${esc(o.id)}">${esc(sstObraRotulo(o))}</option>`).join("")}</select>
    ${sstPodeOperar() ? `<button type="button" class="btn" id="btn-aso-novo" style="margin-left:auto;" title="Registra um ASO: os exames da matriz para o tipo entram marcados, com o preço da clínica">+ ASO</button>` : ""}
  </div><div id="aso-conteudo"><p class="vazio">Carregando…</p></div>`;
}
function asoLerFiltros(){
  return { tipo: $("aso-f-tipo")?.value || "", res: $("aso-f-res")?.value || "", val: $("aso-f-val")?.value || "",
    obra: $("aso-f-obra")?.value || "", busca: ($("sst-busca")?.value || "").trim().toLowerCase() };
}
async function renderSstExames(){
  const cont = $("sst-conteudo"); if(!cont) return;
  if(!asoPodeVer()){ cont.innerHTML = uiVazio("Exames e ASO são dado de saúde: só o SESMT e o RH veem."); return; }
  if(!(await sstSessaoAal2())){ cont.innerHTML = asoMfaMsg(); if($("sst-contador")) $("sst-contador").textContent = ""; return; }
  const f0 = asoLerFiltros();
  cont.innerHTML = asoFiltrosHTML();
  const mapa = { "aso-f-tipo": "tipo", "aso-f-res": "res", "aso-f-val": "val", "aso-f-obra": "obra" };
  Object.entries(mapa).forEach(([id, k]) => { $(id).value = f0[k]; $(id).addEventListener("change", asoRenderConteudo); });
  cont.querySelectorAll("#aso-sub .serv-view-btn").forEach(b => b.addEventListener("click", () => { _asoSub = b.dataset.sub; cont.querySelectorAll("#aso-sub .serv-view-btn").forEach(x => x.classList.toggle("ativo", x === b)); asoRenderConteudo(); }));
  $("btn-aso-novo")?.addEventListener("click", () => asoNovo(null));
  if(!(await asoCarregar(false))) return;
  asoRenderConteudo();
}
function asoRenderConteudo(){
  const cont = $("aso-conteudo"); if(!cont) return;
  const f = asoLerFiltros();
  const prox = new Map(_asoProximos.map(p => [p.funcionario_id, p]));
  if(_asoSub === "pessoas"){
    const linhas = (_sstFuncs || []).map(p => ({ p, x: prox.get(p.id) }))
      .filter(({ p, x }) => (!f.busca || String(p.nome || "").toLowerCase().includes(f.busca)) && (!f.val || (x ? x.status : "sem") === f.val))
      .sort((a, b) => String(a.x?.valido_ate || "0").localeCompare(String(b.x?.valido_ate || "0")) || String(a.p.nome).localeCompare(String(b.p.nome)));
    if($("sst-contador")) $("sst-contador").textContent = `${linhas.length} pessoa(s)`;
    const ultimo = id => _asoLista.find(a => a.funcionario_id === id);
    cont.innerHTML = linhas.length ? `<div class="tabela-rola"><table><thead><tr><th>Pessoa</th><th>Função</th><th>ASO válido até</th><th>Situação</th><th>Último ASO</th></tr></thead>
      <tbody>${linhas.map(({ p, x }) => { const u = ultimo(p.id); return `<tr${u ? ` class="linha-clicavel" data-id="${esc(u.id)}" title="Abrir o último ASO"` : ""}>
        <td>${esc(p.nome)}</td><td>${esc(p.funcao || "—")}</td><td>${dataBR(x && x.valido_ate)}</td><td>${asoTagValidade(x ? x.status : "sem")}</td>
        <td>${u ? `${dataBR(u.data)} · ${esc(ASO_TIPO[u.tipo] || u.tipo)}` : "—"}</td></tr>`; }).join("")}</tbody></table></div>`
      : uiVazio("Nenhuma pessoa neste filtro.");
  } else {
    const linhas = _asoLista.filter(a => {
      if(f.tipo && a.tipo !== f.tipo) return false;
      if(f.res && (a.resultado || "sem") !== f.res) return false;
      if(f.obra && a.obra_id !== f.obra) return false;
      if(f.val){ const x = prox.get(a.funcionario_id); if((x ? x.status : "sem") !== f.val) return false; }
      if(f.busca && !(`${asoFuncNome(a)} ${asoClinica(a)}`.toLowerCase().includes(f.busca))) return false;
      return true;
    });
    if($("sst-contador")) $("sst-contador").textContent = `${linhas.length} ASO`;
    cont.innerHTML = linhas.length ? `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Pessoa</th><th>Tipo</th><th>Clínica</th><th>Obra</th><th>Resultado</th><th>Válido até</th><th>Exames</th><th>Valor</th></tr></thead>
      <tbody>${linhas.map(a => `<tr class="linha-clicavel" data-id="${esc(a.id)}" title="Abrir o ASO">
        <td>${dataBR(a.data)}</td><td>${esc(asoFuncNome(a))}</td><td>${esc(ASO_TIPO[a.tipo] || a.tipo)}${a.transcricao ? ' <span class="tag cinza" title="Feito fora e transcrito">transcrição</span>' : ""}</td>
        <td>${esc(asoClinica(a))}</td><td>${esc(asoObraRot(a.obra_id))}</td><td>${asoTagResultado(a.resultado)}</td><td>${dataBR(a.valido_ate)}</td>
        <td>${Number((a.exames || []).filter(e => e.situacao === "realizado").length)}</td><td data-val-sens>${a.valor_total != null ? brl(a.valor_total) : "—"}</td></tr>`).join("")}</tbody></table></div>`
      : uiVazio(_asoLista.length ? "Nenhum ASO neste filtro." : "Nenhum ASO registrado ainda.");
  }
  cont.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => asoAbrir(tr.dataset.id)));
}


async function asoCustoLinhas(){
  const { data, error } = await sb.rpc("sst_custo_asos");
  if(error) return [];
  return (data || []).map(r => ({
    dest: r.destino === "obra" && r.obra_id ? asoObraRot(r.obra_id) : "Sede (centro SESMT)",
    mes: r.mes || "sem data", req: `ASO · ${ASO_TIPO[r.tipo] || r.tipo}`,
    turmas: Number(r.quantidade) || 0, pessoas: Number(r.quantidade) || 0, valor: Number(r.valor) || 0, planejado: 0
  }));
}


function asoMostrarFicha(){
  ["sst-painel", "sst-ficha-req", "sst-ficha-prog", "trn-ficha"].forEach(id => { if($(id)) $(id).style.display = "none"; });
  $("aso-ficha").style.display = "";
}
function asoFecharFicha(){
  $("aso-ficha").style.display = "none";
  _asoEditId = null; _asoAso = null; _asoExames = [];
  if(typeof sstMostrarPainel === "function") sstMostrarPainel();
  _sstView = "exames";
  renderSesmt();
}
function asoPreencherSelects(){
  const opts = (sel, lista, ph) => { if(sel) preencherSelect(sel, lista, "id", "t", ph); };
  opts($("aso-func"), (_sstFuncs || []).map(f => ({ id: f.id, t: f.nome })), "Escolha a pessoa");
  opts($("aso-fornecedor"), (typeof _trnFornecedores !== "undefined" ? _trnFornecedores : []).map(f => ({ id: f.id, t: f.nome })), "— clínica não cadastrada");
  opts($("aso-obra"), (_sstObras || []).map(o => ({ id: o.id, t: sstObraRotulo(o) })), "— nenhuma");
  const fill = (id, dic, ph) => { const s = $(id); if(s) s.innerHTML = (ph != null ? `<option value="">${esc(ph)}</option>` : "") + Object.entries(dic).map(([v, l]) => `<option value="${esc(v)}">${esc(typeof l === "string" ? l : l.label)}</option>`).join(""); };
  fill("aso-tipo", ASO_TIPO); fill("aso-resultado", ASO_RESULTADO, "— aguardando resultado"); fill("aso-destino", ASO_DESTINO, "Automático (obra no admissional por obra)");
  opts($("aso-add-exame"), asoExamesReqs().filter(r => r.ativo).map(r => ({ id: r.id, t: `${r.codigo} · ${r.nome}` })), "Acrescentar exame…");
}
async function asoPrepararFicha(){
  if(!irParaSecao("sesmt")) return false;
  await carregarSesmt(false);
  if(typeof trnCarregarFornecedores === "function") await trnCarregarFornecedores();
  if(!(await sstSessaoAal2())){ aviso("app-aviso", "ASO é dado de saúde: entre de novo com o autenticador (MFA).", "erro"); return false; }
  return true;
}
async function asoNovo(fid){
  if(!(await asoPrepararFicha())) return;
  _asoEditId = null; _asoAso = null; _asoExames = [];
  asoPreencherSelects();
  asoPreencherForm({ funcionario_id: fid || "", tipo: "periodico", data: hojeISO(), transcricao: false });
  asoRenderFichaVisual();
}
async function asoAbrir(id){
  if(!(await asoPrepararFicha())) return;
  const [a, e] = await Promise.all([
    sb.from("sst_asos").select("*, funcionario:funcionarios(nome)").eq("id", id).maybeSingle(),
    sb.from("sst_aso_exames").select("*").eq("aso_id", id).order("created_at")
  ]);
  if(a.error || !a.data){ aviso("app-aviso", "ASO não encontrado" + (a.error ? ": " + a.error.message : "."), "erro"); return; }
  _asoEditId = id; _asoAso = a.data; _asoExames = e.data || [];
  asoPreencherSelects();
  if(_asoAso.funcionario_id && !$("aso-func").querySelector(`option[value="${CSS.escape(_asoAso.funcionario_id)}"]`)){
    const o = document.createElement("option"); o.value = _asoAso.funcionario_id; o.textContent = asoFuncNome(_asoAso); $("aso-func").appendChild(o);
  }
  asoPreencherForm(_asoAso);
  asoRenderFichaVisual();
}
function asoPreencherForm(a){
  const v = (id, x) => { if($(id)) $(id).value = x ?? ""; };
  v("aso-func", a.funcionario_id); v("aso-tipo", a.tipo || "periodico"); v("aso-data", a.data); v("aso-fornecedor", a.fornecedor_id);
  v("aso-clinica-nome", a.clinica_nome); v("aso-obra", a.obra_id); v("aso-resultado", a.resultado); v("aso-obs", a.observacao_restrita);
  v("aso-destino", _asoEditId ? a.destino : ""); v("aso-valor", a.valor_total);
  $("aso-transcricao").checked = !!a.transcricao;
  $("aso-valor-manual").checked = !!a.valor_manual;
  asoValorManualUi();
}
function asoValorManualUi(){
  const man = $("aso-valor-manual").checked, opera = sstPodeOperar();
  $("aso-valor").disabled = !(opera && man);
  $("aso-valor").title = man ? "Valor digitado (fica no histórico)" : "Soma dos exames realizados pelo preço da clínica";
}
function asoRenderFichaVisual(){
  asoMostrarFicha();
  const a = _asoAso || {};
  const opera = sstPodeOperar();
  const nome = _asoEditId ? asoFuncNome(a) : ((_sstFuncs || []).find(f => f.id === $("aso-func").value) || {}).nome || "";
  $("aso-titulo").textContent = _asoEditId ? `ASO ${ASO_TIPO[a.tipo] ? ASO_TIPO[a.tipo].toLowerCase() : ""} · ${nome}` : "Novo ASO";
  $("aso-breadcrumb").innerHTML = uiBreadcrumb([{ texto: "SESMT", id: "painel" }, { texto: "Exames", id: "painel" }, { texto: _asoEditId ? nome : "Novo ASO" }]);
  $("aso-breadcrumb").querySelectorAll("[data-trilha]").forEach(b => b.addEventListener("click", asoFecharFicha));
  $("aso-statusbar").innerHTML = uiStatusbar([["novo", "Novo"], ["aguardando", "Aguardando resultado"], ["concluido", "Com resultado"]],
    !_asoEditId ? "novo" : a.resultado ? "concluido" : "aguardando");
  $("aso-chip-pessoa").textContent = nome || "—";
  $("aso-chip-tipo").textContent = ASO_TIPO[$("aso-tipo").value] || "—";
  $("aso-chip-clinica").textContent = asoFornNome($("aso-fornecedor").value) || $("aso-clinica-nome").value || "—";
  $("aso-chip-obra").textContent = asoObraRot($("aso-obra").value || null);
  $("aso-chip-resultado").innerHTML = _asoEditId ? asoTagResultado(a.resultado) : "—";
  $("aso-chip-validade").textContent = a.valido_ate ? dataBR(a.valido_ate) : "—";
  $("sb-aso-exames").querySelector(".sb-num").textContent = String(_asoExames.filter(e => e.situacao === "realizado").length);
  $("sb-aso-laudo").querySelector(".sb-num").textContent = a.storage_path ? "1" : "0";
  $("btn-aso-salvar").style.display = opera ? "" : "none";
  $("aso-ficha-mais").style.display = opera && _asoEditId ? "" : "none";
  $("aso-func").disabled = !opera || !!_asoEditId;
  document.querySelectorAll("#aso-ficha .odoo-tab[data-tab='dados'] input, #aso-ficha .odoo-tab[data-tab='dados'] select, #aso-ficha .odoo-tab[data-tab='dados'] textarea")
    .forEach(el => { if(el.id !== "aso-func" && el.id !== "aso-valor") el.disabled = !opera; });
  asoValorManualUi();
  ["exames", "laudo", "historico"].forEach(t => { const b = document.querySelector(`#aso-notebook button[data-tab="${t}"]`); if(b) b.style.display = _asoEditId ? "" : "none"; });
  sstAtivarTab("aso-ficha", "aso-notebook", "dados");
  asoRenderExames();
  asoRenderLaudo();
  if(_asoEditId && typeof montarHistorico === "function") montarHistorico("sst_asos", _asoEditId, "aso-historico");
}
function asoLerForm(){
  const tipo = $("aso-tipo").value, obra = $("aso-obra").value || null, destino = $("aso-destino").value || null;
  if(!$("aso-func").value) return { erro: "Escolha a pessoa." };
  if(!$("aso-data").value) return { erro: "Informe a data do ASO." };
  if(tipo === "admissional_obra" && !obra) return { erro: "O admissional por obra pede a obra." };
  if(destino === "obra" && !obra) return { erro: "Custo na obra pede a obra." };
  const man = $("aso-valor-manual").checked, valor = $("aso-valor").value;
  if(man && valor === "") return { erro: "Digite o valor ou desmarque Valor digitado." };
  return {
    funcionario_id: $("aso-func").value, tipo, data: $("aso-data").value, fornecedor_id: $("aso-fornecedor").value || null,
    clinica_nome: $("aso-clinica-nome").value.trim() || null, obra_id: obra, transcricao: $("aso-transcricao").checked,
    resultado: $("aso-resultado").value || null, observacao_restrita: $("aso-obs").value.trim() || null, destino,
    valor_manual: man, valor_total: man ? Number(valor) : undefined
  };
}
async function salvarAso(){
  const d = asoLerForm();
  if(d.erro){ aviso("app-aviso", d.erro, "erro"); return; }
  if(!(await sstSessaoAal2())){ aviso("app-aviso", "Gravar ASO exige sessão com MFA: entre de novo com o autenticador.", "erro"); return; }
  let id = _asoEditId;
  if(!id){
    const { data, error } = await sb.rpc("sst_aso_registrar", { p_dados: { ...d, valor_manual: undefined, valor_total: undefined } });
    if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não registra ASO."), "erro"); return; }
    id = data;
    if(d.valor_manual){
      const { error: e2 } = await sb.from("sst_asos").update({ valor_manual: true, valor_total: d.valor_total }).eq("id", id);
      if(e2) aviso("app-aviso", sstErroMsg(e2, "O valor digitado não gravou."), "erro");
    }
    aviso("app-aviso", "ASO registrado: confira os exames marcados pela matriz e anexe o laudo.", "ok");
  } else {
    const campos = { ...d }; delete campos.funcionario_id;
    if(!d.valor_manual) delete campos.valor_total;
    if(!campos.destino) delete campos.destino;
    const { error } = await sb.from("sst_asos").update(campos).eq("id", id);
    if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não altera ASO."), "erro"); return; }
    aviso("app-aviso", "ASO salvo.", "ok");
  }
  _asoCarregado = false; _sstSituacao = null;
  const novo = !_asoEditId;
  await asoAbrir(id);
  if(novo) sstAtivarTab("aso-ficha", "aso-notebook", "exames");
}
async function excluirAso(){
  if(!_asoEditId || !(await uiConfirmar({ titulo: "Excluir ASO", confirmar: "Excluir", perigo: true,
    texto: "Excluir este ASO, os exames e o documento ASO gerado na ficha da pessoa (e o laudo)?" }))) return;
  if(!_asoEditId) return;
  const path = _asoAso && _asoAso.storage_path;
  const { error } = await sb.from("sst_asos").delete().eq("id", _asoEditId);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não exclui ASO."), "erro"); return; }
  if(path) await sb.storage.from("sst-saude").remove([path]);
  aviso("app-aviso", "ASO excluído.", "ok");
  _asoCarregado = false; _sstSituacao = null;
  asoFecharFicha();
}


function asoRenderExames(){
  const cont = $("aso-exames"); if(!cont) return;
  const opera = sstPodeOperar();
  $("aso-add-linha").style.display = opera && _asoEditId ? "" : "none";
  if(!_asoEditId){ cont.innerHTML = uiVazio("Os exames da matriz para o tipo entram marcados ao registrar."); return; }
  const linhas = _asoExames.map(e => ({ e, r: sstReqPorId(e.requisito_id) }))
    .sort((x, y) => String(x.r?.codigo || "").localeCompare(String(y.r?.codigo || "")));
  const total = _asoExames.filter(e => e.situacao === "realizado").reduce((s, e) => s + (Number(e.valor) || 0), 0);
  cont.innerHTML = linhas.length ? `<div class="tabela-rola"><table><thead><tr><th>Exame</th><th>Origem</th><th>Situação</th><th>Data</th><th>Próximo em</th><th>Valor</th>${opera ? "<th></th>" : ""}</tr></thead>
    <tbody>${linhas.map(({ e, r }, i) => `<tr>
      <td>${r ? uiCodigo(r.codigo) + " " + esc(r.nome) : "—"}</td>
      <td>${e.extra ? `<span class="tag azul">acrescentado</span> <span class="meta">${esc(e.motivo || "")}</span>` : '<span class="meta">matriz</span>'}</td>
      <td>${opera ? `<select class="aso-ex-sit" data-i="${i}"><option value="realizado"${e.situacao === "realizado" ? " selected" : ""}>Realizado</option><option value="dispensado"${e.situacao === "dispensado" ? " selected" : ""}>Dispensado</option></select>` : esc(e.situacao === "dispensado" ? "Dispensado" : "Realizado")}</td>
      <td>${opera ? `<input type="date" class="aso-ex-data" data-i="${i}" value="${esc(e.data || "")}" title="Data do exame (vazio = a do ASO)" />` : dataBR(e.data)}</td>
      <td>${dataBR(e.proximo_em)}</td>
      <td data-val-sens>${opera ? `<input type="number" step="0.01" min="0" class="aso-ex-valor" data-i="${i}" value="${esc(e.valor ?? "")}" title="Preço vigente da clínica na data; edite se a cobrança veio diferente" />` : (e.valor != null ? brl(e.valor) : "—")}</td>
      ${opera ? `<td class="col-acao">${e.extra ? `<button type="button" class="btn-sec btn-sm aso-ex-tirar" data-i="${i}" title="Tira o exame acrescentado">Tirar</button>` : ""}</td>` : ""}
    </tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="5"><strong>Soma dos realizados</strong></td><td data-val-sens><strong>${brl(total)}</strong></td>${opera ? "<td></td>" : ""}</tr></tfoot></table></div>
    <p class="meta">Sem resultado de exame: o ASO guarda só apto, apto com restrição ou inapto. Sem tabela de preço da clínica, o valor fica em branco até ser digitado.</p>`
    : uiVazio("Nenhum exame marcado: a matriz não tem exame obrigatório para este tipo e função. Acrescente com o motivo.");
  const ex = el => linhas[Number(el.dataset.i)].e;
  cont.querySelectorAll(".aso-ex-sit").forEach(s => s.addEventListener("change", () => asoAtualizarExame(ex(s), { situacao: s.value })));
  cont.querySelectorAll(".aso-ex-data").forEach(s => s.addEventListener("change", () => asoAtualizarExame(ex(s), { data: s.value || _asoAso.data })));
  cont.querySelectorAll(".aso-ex-valor").forEach(s => s.addEventListener("change", () => asoAtualizarExame(ex(s), { valor: s.value === "" ? null : Number(s.value) })));
  cont.querySelectorAll(".aso-ex-tirar").forEach(b => b.addEventListener("click", () => asoTirarExame(ex(b))));
}
async function asoRecarregarAso(){
  const [a, e] = await Promise.all([
    sb.from("sst_asos").select("*, funcionario:funcionarios(nome)").eq("id", _asoEditId).maybeSingle(),
    sb.from("sst_aso_exames").select("*").eq("aso_id", _asoEditId).order("created_at")
  ]);
  if(a.data) _asoAso = a.data;
  _asoExames = e.data || [];
  $("aso-valor").value = _asoAso.valor_total ?? "";
  $("aso-chip-validade").textContent = _asoAso.valido_ate ? dataBR(_asoAso.valido_ate) : "—";
  $("sb-aso-exames").querySelector(".sb-num").textContent = String(_asoExames.filter(x => x.situacao === "realizado").length);
  _asoCarregado = false; _sstSituacao = null;
  asoRenderExames();
}
async function asoAtualizarExame(e, campos){
  const { error } = await sb.from("sst_aso_exames").update(campos).eq("id", e.id);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não altera exame do ASO."), "erro"); }
  await asoRecarregarAso();
}
async function asoAcrescentarExame(){
  const req = $("aso-add-exame").value, motivo = $("aso-add-motivo").value.trim();
  if(!req){ aviso("app-aviso", "Escolha o exame.", "erro"); return; }
  if(!motivo){ aviso("app-aviso", "Exame fora da matriz pede o motivo.", "erro"); return; }
  if(_asoExames.some(e => e.requisito_id === req)){ aviso("app-aviso", "Este exame já está no ASO.", "erro"); return; }
  const { error } = await sb.from("sst_aso_exames").insert({ aso_id: _asoEditId, requisito_id: req, extra: true, motivo });
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não acrescenta exame."), "erro"); return; }
  $("aso-add-exame").value = ""; $("aso-add-motivo").value = "";
  await asoRecarregarAso();
}
async function asoTirarExame(e){
  if(!(await uiConfirmar({ titulo: "Tirar exame", texto: "Tirar este exame do ASO?", confirmar: "Tirar", perigo: true }))) return;
  const { error } = await sb.from("sst_aso_exames").delete().eq("id", e.id);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não tira exame."), "erro"); return; }
  await asoRecarregarAso();
}


function asoRenderLaudo(){
  const cont = $("aso-laudo"); if(!cont) return;
  const a = _asoAso || {}, opera = sstPodeOperar();
  $("aso-laudo-linha").style.display = opera && _asoEditId ? "" : "none";
  cont.innerHTML = a.storage_path
    ? `<div class="form-acoes"><button type="button" class="btn-sec" id="btn-aso-laudo-abrir" title="Abre o laudo (link de 60 s)">Abrir laudo</button>${opera ? `<button type="button" class="btn-sec acao-perigo" id="btn-aso-laudo-tirar">Tirar laudo</button>` : ""}</div>
       <p class="meta">O mesmo arquivo vai para o documento ASO na aba Segurança do funcionário.</p>`
    : uiVazio("Nenhum laudo anexado.");
  $("btn-aso-laudo-abrir")?.addEventListener("click", () => sstAbrirArquivo("sst-saude", a.storage_path));
  $("btn-aso-laudo-tirar")?.addEventListener("click", asoTirarLaudo);
}
async function asoEnviarLaudo(file){
  if(!_asoEditId) return;
  if(file.size > 20971520){ aviso("app-aviso", "Arquivo maior que 20 MB.", "erro"); return; }
  if(!(await sstSessaoAal2())){ aviso("app-aviso", "Laudo é dado de saúde: entre de novo com o autenticador (MFA).", "erro"); return; }
  const ext = extensaoArquivo(file); const mime = mimeDoArquivo(file, ext);
  const path = `${_asoAso.funcionario_id}/ASO/${crypto.randomUUID()}.${ext}`;
  const { error: eUp } = await sb.storage.from("sst-saude").upload(path, corpoComMime(file, mime), { contentType: mime, upsert: false });
  if(eUp){ aviso("app-aviso", sstErroMsg(eUp, "Seu perfil não anexa laudo."), "erro"); return; }
  const antigo = _asoAso.storage_path;
  const { error } = await sb.from("sst_asos").update({ storage_path: path }).eq("id", _asoEditId);
  if(error){ await sb.storage.from("sst-saude").remove([path]); aviso("app-aviso", sstErroMsg(error, "Seu perfil não anexa laudo."), "erro"); return; }
  if(antigo) await sb.storage.from("sst-saude").remove([antigo]);
  aviso("app-aviso", "Laudo anexado.", "ok");
  await asoAbrir(_asoEditId);
  sstAtivarTab("aso-ficha", "aso-notebook", "laudo");
}
async function asoTirarLaudo(){
  if(!_asoAso || !_asoAso.storage_path || !(await uiConfirmar({ titulo: "Tirar laudo", texto: "Tirar o laudo deste ASO (o arquivo é apagado)?", confirmar: "Tirar laudo", perigo: true }))) return;
  if(!_asoAso || !_asoAso.storage_path) return;
  const path = _asoAso.storage_path;
  const { error } = await sb.from("sst_asos").update({ storage_path: null }).eq("id", _asoEditId);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não tira laudo."), "erro"); return; }
  await sb.storage.from("sst-saude").remove([path]);
  await asoAbrir(_asoEditId);
  sstAtivarTab("aso-ficha", "aso-notebook", "laudo");
}


async function asoFichaFuncCarregar(fid){
  const cont = $("func-aso-bloco"); if(!cont || !fid) return;
  if(!podeVerSesmt()){ cont.innerHTML = ""; return; }
  const ve = asoPodeVer() && (await sstSessaoAal2());
  const [p, l] = await Promise.all([
    sb.rpc("sst_proximos_asos", { p_funcionarios: [fid] }),
    ve ? sb.from("sst_asos").select("id,tipo,data,resultado,valido_ate,fornecedor_id,clinica_nome,transcricao").eq("funcionario_id", fid).order("data", { ascending: false }) : Promise.resolve({ data: [] })
  ]);
  if(typeof funcEditId !== "undefined" && fid !== funcEditId) return;
  const x = (p.data || [])[0];
  const lista = l.data || [];
  const opera = sstPodeOperar();
  const linha = `<div class="odoo-contexto"><div class="chip"><span>ASO válido até</span><strong>${x && x.valido_ate ? dataBR(x.valido_ate) : "—"}</strong></div><div class="chip"><span>Situação</span><strong>${asoTagValidade(x ? x.status : "sem")}</strong></div></div>`;
  const corpo = !ve ? `<p class="meta">O detalhe do ASO (tipo, clínica, exames, laudo) fica com o SESMT e o RH, com MFA.</p>`
    : (lista.length ? `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Tipo</th><th>Clínica</th><th>Resultado</th><th>Válido até</th></tr></thead>
      <tbody>${lista.map(a => `<tr class="linha-clicavel" data-aso="${esc(a.id)}" title="Abrir o ASO"><td>${dataBR(a.data)}</td><td>${esc(ASO_TIPO[a.tipo] || a.tipo)}${a.transcricao ? ' <span class="tag cinza">transcrição</span>' : ""}</td>
        <td>${esc(asoClinica(a))}</td><td>${asoTagResultado(a.resultado)}</td><td>${dataBR(a.valido_ate)}</td></tr>`).join("")}</tbody></table></div>`
      : uiVazio("Nenhum ASO registrado para esta pessoa."));
  cont.innerHTML = uiSecao("documento", "ASO", `
    ${opera && ve ? `<div class="form-acoes" style="margin:0 0 var(--esp-2);"><button type="button" class="btn-sec" id="btn-aso-ff-novo" title="Abre a ficha do ASO desta pessoa; os exames da matriz entram marcados">Registrar ASO</button></div>` : ""}
    ${  linha}
    ${  corpo}`, ve ? `${lista.length}` : "");
  cont.querySelectorAll("tr[data-aso]").forEach(tr => tr.addEventListener("click", () => asoAbrir(tr.dataset.aso)));
  $("btn-aso-ff-novo")?.addEventListener("click", () => asoNovo(fid));
}


function asoFornAplicarVisibilidade(){
  const b = document.querySelector('#forn-notebook button[data-tab="sesmt"]');
  if(b) b.style.display = sstPodeOperar() && typeof fornEditId !== "undefined" && fornEditId ? "" : "none";
}
async function asoFornCarregar(){
  const cont = $("forn-sesmt-conteudo"); if(!cont) return;
  const fid = typeof fornEditId !== "undefined" ? fornEditId : null;
  if(!fid || !sstPodeOperar()){ cont.innerHTML = ""; return; }
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  if(!(_sstReqs || []).length){ const { data } = await sb.from("sst_requisitos").select("*").order("ordem").order("codigo"); _sstReqs = data || []; }
  const { data, error } = await sb.from("sst_clinica_precos").select("*").eq("fornecedor_id", fid).order("vigencia_inicio", { ascending: false });
  if(fid !== fornEditId) return;
  if(error){ cont.innerHTML = uiVazio("Erro ao ler a tabela de preço: " + error.message); return; }
  const precos = data || [];
  const hoje = hojeISO();
  const vigente = p => p.vigencia_inicio <= hoje && (!p.vigencia_fim || p.vigencia_fim >= hoje)
    && !precos.some(q => q.requisito_id === p.requisito_id && q.id !== p.id && q.vigencia_inicio <= hoje && q.vigencia_inicio > p.vigencia_inicio && (!q.vigencia_fim || q.vigencia_fim >= hoje));
  const linhas = precos.map(p => ({ p, r: sstReqPorId(p.requisito_id) }))
    .sort((x, y) => String(x.r?.codigo || "").localeCompare(String(y.r?.codigo || "")) || String(y.p.vigencia_inicio).localeCompare(String(x.p.vigencia_inicio)));
  cont.innerHTML = `<p class="texto-apoio">Preço por exame desta clínica, com vigência. O ASO pega o preço vigente na data do exame; sem preço aqui, o valor do exame fica em branco até ser digitado. Preço novo: lance com a nova data de início (o anterior continua no histórico).</p>
    <div class="func-doc-inline-form">
      <div class="grade">
        <div class="campo largo"><label>Exame *</label><select id="aso-fp-req"><option value="">Escolha…</option>${asoExamesReqs().filter(r => r.ativo).map(r => `<option value="${esc(r.id)}">${esc(r.codigo)} · ${esc(r.nome)}</option>`).join("")}</select></div>
        <div class="campo" data-val-sens><label>Valor (R$) *</label><input id="aso-fp-valor" type="number" step="0.01" min="0" /></div>
        <div class="campo"><label>Vigente desde</label><input id="aso-fp-inicio" type="date" value="${esc(hoje)}" /></div>
        <div class="campo"><label>Até</label><input id="aso-fp-fim" type="date" title="Vazio = sem fim" /></div>
        <div class="campo largo"><label>Observações</label><input id="aso-fp-obs" /></div>
      </div>
      <div class="form-acoes"><button type="button" class="btn" id="btn-aso-fp-salvar">Lançar preço</button></div>
    </div>
    ${linhas.length ? `<div class="tabela-rola"><table><thead><tr><th>Exame</th><th>Valor</th><th>Vigente desde</th><th>Até</th><th>Situação</th><th>Observações</th><th></th></tr></thead>
      <tbody>${linhas.map(({ p, r }, i) => `<tr class="${vigente(p) ? "" : "meta"}"><td>${r ? uiCodigo(r.codigo) + " " + esc(r.nome) : "—"}</td><td data-val-sens>${brl(p.valor)}</td>
        <td>${dataBR(p.vigencia_inicio)}</td><td>${dataBR(p.vigencia_fim)}</td><td>${vigente(p) ? '<span class="tag verde">vigente</span>' : '<span class="tag cinza">fora da vigência</span>'}</td>
        <td>${esc(p.observacoes || "")}</td><td class="col-acao"><button type="button" class="btn-sec btn-sm aso-fp-del" data-i="${i}">Excluir</button></td></tr>`).join("")}</tbody></table></div>`
      : uiVazio("Nenhum preço lançado para esta clínica.")}`;
  $("btn-aso-fp-salvar").addEventListener("click", e => comBotaoTravado(e.currentTarget, () => asoFornSalvarPreco(fid)));
  cont.querySelectorAll(".aso-fp-del").forEach(b => b.addEventListener("click", () => asoFornExcluirPreco(linhas[Number(b.dataset.i)].p)));
}
async function asoFornSalvarPreco(fid){
  const req = $("aso-fp-req").value, valor = $("aso-fp-valor").value;
  if(!req || valor === ""){ aviso("app-aviso", "Escolha o exame e informe o valor.", "erro"); return; }
  const { error } = await sb.from("sst_clinica_precos").insert({
    fornecedor_id: fid, requisito_id: req, valor: Number(valor), vigencia_inicio: $("aso-fp-inicio").value || hojeISO(),
    vigencia_fim: $("aso-fp-fim").value || null, observacoes: $("aso-fp-obs").value.trim() || null
  });
  if(error){ aviso("app-aviso", error.code === "23505" ? "Já existe preço deste exame com essa data de início." : sstErroMsg(error, "Seu perfil não lança preço de clínica."), "erro"); return; }
  aviso("app-aviso", "Preço lançado.", "ok");
  await asoFornCarregar();
}
async function asoFornExcluirPreco(p){
  if(!p || !(await uiConfirmar({ titulo: "Excluir preço", texto: "Excluir este preço? ASO já lançado não muda.", confirmar: "Excluir", perigo: true }))) return;
  const { error } = await sb.from("sst_clinica_precos").delete().eq("id", p.id);
  if(error){ aviso("app-aviso", sstErroMsg(error, "Seu perfil não exclui preço de clínica."), "erro"); return; }
  await asoFornCarregar();
}


function ligarSesmtAso(){
  document.querySelector('#forn-notebook button[data-tab="sesmt"]')?.addEventListener("click", asoFornCarregar);
  if(!$("aso-ficha")) return;
  $("btn-aso-voltar")?.addEventListener("click", asoFecharFicha);
  $("btn-aso-salvar")?.addEventListener("click", e => comBotaoTravado(e.currentTarget, salvarAso));
  $("btn-aso-excluir")?.addEventListener("click", excluirAso);
  $("btn-aso-add")?.addEventListener("click", e => comBotaoTravado(e.currentTarget, asoAcrescentarExame));
  $("aso-laudo-arquivo")?.addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if(f) asoEnviarLaudo(f); });
  $("aso-valor-manual")?.addEventListener("change", asoValorManualUi);
  $("aso-func")?.addEventListener("change", () => { $("aso-chip-pessoa").textContent = ((_sstFuncs || []).find(f => f.id === $("aso-func").value) || {}).nome || "—"; });
  $("aso-tipo")?.addEventListener("change", () => { $("aso-chip-tipo").textContent = ASO_TIPO[$("aso-tipo").value] || "—"; });
  $("aso-obra")?.addEventListener("change", () => { $("aso-chip-obra").textContent = asoObraRot($("aso-obra").value || null); });
  const chipClin = () => { $("aso-chip-clinica").textContent = asoFornNome($("aso-fornecedor").value) || $("aso-clinica-nome").value || "—"; };
  $("aso-fornecedor")?.addEventListener("change", chipClin);
  $("aso-clinica-nome")?.addEventListener("input", chipClin);
  document.querySelectorAll("#aso-notebook button").forEach(b => b.addEventListener("click", () => sstAtivarTab("aso-ficha", "aso-notebook", b.dataset.tab)));
  document.querySelectorAll("#aso-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => { if(_asoEditId) sstAtivarTab("aso-ficha", "aso-notebook", b.dataset.gotoTab); }));
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarSesmtAso);
else ligarSesmtAso();

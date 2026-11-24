/* ====================================================================
   Módulo: Encontro de Contas (fase 190a, #214) — fechamento de caixa por funcionário (RG 8.5)
   Entradas (dinheiro que o funcionário recebeu), relatórios aprovados (abatem o saldo), prestação de contas (notinha
   entregue em mãos, só informação: NÃO soma no saldo) e fechamentos. Saldo = Σ entradas − Σ relatórios, sempre lido da
   vw_ec_saldos (o front não calcula saldo; o total do rodapé de cada aba é só a soma da lista).
   Leitura no banco por ec_pode_ler(): quem lê financeiro (menos o comercial) e o gestor da obra em que o funcionário
   está alocado. Grava: financeiro, admin e diretor. Fechar e desfazer só pelas RPCs; linha fechada não se edita.
   Prefixo: ecc-.
   ==================================================================== */

let _eccSaldos = [];       // vw_ec_saldos
let _eccFuncs = [];        // funcionários (id, nome, ativo) para abrir o caixa de quem ainda não tem lançamento
let _eccObras = [];        // obras (id, codigo, nome) para os selects e o filtro
let _eccAloc = {};         // funcionario_id -> Set(obra_id) da competência atual e da anterior
let _eccView = "lista";
let _eccCarregado = false;
let _eccAtual = null;      // { func, saldo, entradas, relatorios, prestacoes, fechamentos, perfis }
let _eccEdit = null;       // { tipo: "entrada"|"relatorio"|"prestacao", id }

const ECC_TIPOS = { deposito_conta: "Depósito em conta", caixa_financeiro: "Caixa Financeiro", cartao_flash: "Cartão Flash",
  cartao_vex: "Cartão VEX", reembolso: "Reembolso", outro: "Outro" };
const ECC_TABELA = { entrada: "ec_entradas", relatorio: "ec_relatorios", prestacao: "ec_prestacoes" };
const ECC_TITULO = { entrada: "Entrada", relatorio: "Relatório aprovado", prestacao: "Prestação de contas" };
const ECC_NOVO = { entrada: "Nova entrada", relatorio: "Novo relatório aprovado", prestacao: "Nova prestação de contas" };

/* Espelham ec_pode_ler() e as policies de escrita. O gestor de obra sem leitura financeira não tem o item no menu (hoje
   todos os gestores são engenheiros); o banco decide o que ele lê. */
function eccPodeVer(){ return podeVerEncontroContas(); }   // core.js (menu)
function eccPodeGravar(){ return !!usuarioAtual && ["diretor", "admin", "financeiro"].includes(usuarioAtual.cargo); }
function eccPodeDesfazer(){ return !!usuarioAtual && usuarioAtual.cargo === "diretor"; }
function eccObraRotulo(id){ if(!id) return "—"; const o = _eccObras.find(x => x.id === id); return obraRotulo(id) || (o ? `${o.codigo} — ${o.nome}` : "—"); }
function eccSaldoCls(v){ return Number(v) < 0 ? "txt-perigo" : ""; }
function eccSemAcento(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

/* ---------- carga ---------- */
async function carregarEncontroContas(force){
  const cont = $("ecc-conteudo"); if(!cont) return;
  if(force || !_eccCarregado){
    cont.innerHTML = `<p class="vazio">Carregando…</p>`;
    const ant = new Date(); ant.setDate(1); ant.setMonth(ant.getMonth() - 1);
    const [sal, fu, ob, al] = await Promise.all([
      lerTudo(() => sb.from("vw_ec_saldos").select("*"), "funcionario_id"),
      lerTudo(() => sb.from("funcionarios").select("id,nome,ativo"), "id"),
      lerTudo(() => sb.from("obras").select("id,codigo,nome"), "id"),
      lerTudo(() => sb.from("rh_alocacoes").select("id,funcionario_id,obra_id").gte("competencia", dataLocalISO(ant)), "id")
    ]);
    if(sal.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(sal.error.message)}</p>`; return; }
    _eccSaldos = sal.data; _eccFuncs = (fu.data || []).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    _eccObras = (ob.data || []).sort((a, b) => String(b.codigo).localeCompare(String(a.codigo), "pt-BR", { numeric: true }));
    _eccAloc = {};
    (al.data || []).forEach(a => { (_eccAloc[a.funcionario_id] = _eccAloc[a.funcionario_id] || new Set()).add(a.obra_id); });
    _eccCarregado = true;
    eccPreencherFiltros();
  }
  $("btn-ecc-abrir-func").style.display = eccPodeGravar() ? "" : "none";
  $("ecc-novo-func").style.display = eccPodeGravar() ? "" : "none";
  renderEncontroContas();
}
function eccPreencherFiltros(){
  const obrasAloc = new Set(); Object.values(_eccAloc).forEach(s => s.forEach(o => obrasAloc.add(o)));
  const sel = $("ecc-obra"), atual = sel.value;
  sel.innerHTML = `<option value="">Todas as obras</option>` + _eccObras.filter(o => obrasAloc.has(o.id))
    .map(o => `<option value="${esc(o.id)}">${esc(eccObraRotulo(o.id))}</option>`).join("");
  sel.value = atual;
  const nf = $("ecc-novo-func");
  nf.innerHTML = `<option value="">Abrir o caixa de…</option>` + _eccFuncs
    .map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.ativo ? "" : " (inativo)"}</option>`).join("");
}

/* ---------- painel ---------- */
function eccFiltrados(){
  const q = eccSemAcento($("ecc-busca")?.value || "").trim();
  const sit = $("ecc-situacao")?.value || "";
  const ativo = $("ecc-ativo")?.value || "";
  const obra = $("ecc-obra")?.value || "";
  return _eccSaldos.filter(s => (!q || eccSemAcento(s.nome).includes(q))
    && (sit === "" || (sit === "com_saldo" && Number(s.saldo) !== 0) || (sit === "negativo" && Number(s.saldo) < 0) || (sit === "aberto" && s.qtd_abertos > 0))
    && (ativo === "" || (ativo === "ativo") === !!s.ativo)
    && (!obra || (_eccAloc[s.funcionario_id] && _eccAloc[s.funcionario_id].has(obra))));
}
function renderEncontroContas(){
  const cont = $("ecc-conteudo"); if(!cont) return;
  document.querySelectorAll("#ecc-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _eccView));
  const prestar = _eccSaldos.filter(s => Number(s.saldo) > 0).reduce((t, s) => t + Number(s.saldo), 0);
  const devolver = _eccSaldos.filter(s => Number(s.saldo) < 0).reduce((t, s) => t - Number(s.saldo), 0);
  $("ecc-kpi-prestar").textContent = brl(prestar);
  $("ecc-kpi-devolver").textContent = brl(devolver);
  $("ecc-kpi-com-saldo").textContent = _eccSaldos.filter(s => Number(s.saldo) !== 0).length;
  $("ecc-kpi-abertos").textContent = _eccSaldos.filter(s => s.qtd_abertos > 0).length;
  const dados = eccFiltrados().sort((a, b) => Math.abs(Number(b.saldo)) - Math.abs(Number(a.saldo)) || a.nome.localeCompare(b.nome, "pt-BR"));
  $("ecc-contador").textContent = `${dados.length} de ${_eccSaldos.length}`;
  if(!_eccSaldos.length){ cont.innerHTML = `<p class="vazio">Nenhum lançamento ainda. Escolha um funcionário em "Abrir o caixa de…" para lançar.</p>`; return; }
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhum funcionário com esses filtros.</p>`; return; }
  if(_eccView === "cartoes"){ renderEccCartoes(dados); return; }
  const linha = s => `<tr class="linha-clicavel" data-id="${esc(s.funcionario_id)}" tabindex="0">
      <td><strong>${esc(s.nome)}</strong>${s.ativo ? "" : ' <span class="tag cinza">inativo</span>'}</td>
      <td class="num">${brl(s.total_entradas)}</td><td class="num">${brl(s.total_relatorios)}</td>
      <td class="num ${eccSaldoCls(s.saldo)}" data-val-sens><strong>${brl(s.saldo)}</strong></td>
      <td class="num">${s.qtd_abertos ? `<span class="tag ambar">${Number(s.qtd_abertos)}</span>` : "—"}</td>
      <td>${s.ultimo_fechamento ? dataBR(s.ultimo_fechamento) : "—"}</td><td>${s.ultima_entrada ? dataBR(s.ultima_entrada) : "—"}</td></tr>`;
  const t = dados.reduce((a, s) => ({ e: a.e + Number(s.total_entradas), r: a.r + Number(s.total_relatorios), s: a.s + Number(s.saldo) }), { e: 0, r: 0, s: 0 });
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Colaborador</th><th class="num" title="Soma das entradas (dinheiro que o funcionário recebeu)">Caixa de obra</th>
      <th class="num" title="Soma dos relatórios de despesas aprovados">Relatório aprovado</th>
      <th class="num" title="Positivo: o funcionário tem dinheiro da empresa a prestar contas. Negativo: a empresa deve a ele">Saldo</th>
      <th class="num" title="Entradas e relatórios ainda não fechados">Abertos</th><th>Último fechamento</th><th>Última entrada</th></tr></thead>
    <tbody>${dados.map(linha).join("")}</tbody>
    <tfoot><tr><td><strong>Total</strong></td><td class="num">${brl(t.e)}</td><td class="num">${brl(t.r)}</td><td class="num"><strong>${brl(t.s)}</strong></td><td colspan="3"></td></tr></tfoot>
  </table></div>`;
}
function renderEccCartoes(dados){
  const cols = [["A prestar contas", s => Number(s.saldo) > 0], ["Zerado", s => Number(s.saldo) === 0], ["A devolver ao funcionário", s => Number(s.saldo) < 0]];
  const card = s => `<div class="func-kan-card linha-clicavel" data-id="${esc(s.funcionario_id)}" tabindex="0">
      ${/* html */ uiAvatar(s.nome)}
      <div class="func-kan-card-body">
        <div class="func-kan-card-nome">${esc(s.nome)}</div>
        <div class="func-kan-card-funcao ${eccSaldoCls(s.saldo)}" data-val-sens>${brl(s.saldo)}</div>
        <div class="func-kan-card-rod"><span>${s.qtd_abertos ? Number(s.qtd_abertos) + " aberto(s)" : "sem aberto"}</span><span>${s.ativo ? "" : "inativo"}</span></div>
      </div></div>`;
  $("ecc-conteudo").innerHTML = `<div class="serv-kanban">${cols.map(([rot, f]) => {
    const itens = dados.filter(f);
    return `<div class="serv-kan-col"><div class="serv-kan-col-head">${esc(rot)}<span>${itens.length}</span></div>${itens.map(card).join("") || '<div class="kan-vazio">—</div>'}</div>`;
  }).join("")}</div>`;
}

/* ---------- ficha ---------- */
function mostrarPainelEncontro(){
  $("ecc-ficha").style.display = "none"; $("ecc-painel").style.display = "";
  _eccAtual = null;
  renderEncontroContas();
}
async function abrirEncontroContas(funcId){
  if(!funcId) return;
  $("ecc-painel").style.display = "none"; $("ecc-ficha").style.display = "";
  $("ecc-ficha-titulo").textContent = "Carregando…";
  const porFunc = tab => lerTudo(() => sb.from(tab).select("*").eq("funcionario_id", funcId), ["data", "id"]);
  const [fu, sal, en, re, pr, fe] = await Promise.all([
    sb.from("funcionarios").select("id,nome,funcao,matricula,ativo,status").eq("id", funcId).maybeSingle(),
    sb.from("vw_ec_saldos").select("*").eq("funcionario_id", funcId).maybeSingle(),
    porFunc("ec_entradas"), porFunc("ec_relatorios"), porFunc("ec_prestacoes"),
    sb.from("ec_fechamentos").select("*").eq("funcionario_id", funcId).order("fechado_em", { ascending: false })
  ]);
  const erro = [fu, sal, en, re, pr, fe].find(r => r.error);
  if(erro){ aviso("app-aviso", "Erro ao abrir o caixa: " + erro.error.message, "erro"); mostrarPainelEncontro(); return; }
  const ids = [...new Set((fe.data || []).flatMap(f => [f.fechado_por, f.desfeito_por]).filter(Boolean))];
  const perfis = {};
  if(ids.length){ const { data } = await sb.from("profiles").select("id,nome").in("id", ids); (data || []).forEach(p => perfis[p.id] = p.nome); }
  _eccAtual = { func: fu.data || { id: funcId, nome: "—" }, saldo: sal.data, entradas: en.data, relatorios: re.data, prestacoes: pr.data, fechamentos: fe.data || [], perfis };
  renderFichaEncontro();
}
function renderFichaEncontro(aba){
  const a = _eccAtual; if(!a) return;
  const s = a.saldo || { total_entradas: 0, total_relatorios: 0, saldo: 0, qtd_abertos: 0 };
  const grava = eccPodeGravar();
  $("ecc-ficha-titulo").textContent = a.func.nome + (a.func.ativo === false ? " (inativo)" : "");
  ["btn-ecc-nova-entrada", "btn-ecc-novo-relatorio", "btn-ecc-nova-prestacao", "btn-ecc-fechar", "btn-ecc-whatsapp"].forEach(id => $(id).style.display = grava ? "" : "none");
  $("ecc-statusbar").innerHTML = uiStatusbar([["aberto", "Com lançamento aberto"], ["fechado", "Tudo fechado"]], s.qtd_abertos > 0 ? "aberto" : "fechado");
  $("ecc-chip-entradas").textContent = brl(s.total_entradas);
  $("ecc-chip-relatorios").textContent = brl(s.total_relatorios);
  $("ecc-chip-saldo").textContent = brl(s.saldo);
  $("ecc-chip-saldo").className = eccSaldoCls(s.saldo);
  $("ecc-chip-fechamento").textContent = s.ultimo_fechamento ? dataBR(s.ultimo_fechamento) : "—";
  const setSb = (id, n) => { const b = $(id); if(b){ b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !n); } };
  setSb("sb-ecc-entradas", a.entradas.length); setSb("sb-ecc-relatorios", a.relatorios.length);
  setSb("sb-ecc-prestacoes", a.prestacoes.length); setSb("sb-ecc-fechamentos", a.fechamentos.filter(f => !f.desfeito_em).length);
  const sit = l => l.situacao === "fechada" || l.fechamento_id ? '<span class="tag cinza">fechada</span>' : '<span class="tag azul">aberta</span>';
  const obs = l => [l.observacao, l.info_fechamento_planilha].filter(Boolean).map(t => esc(t)).join("<br>");
  const acoes = (tipo, l) => grava && !(l.situacao === "fechada" || l.fechamento_id)
    ? `<button type="button" class="btn-sec btn-sm" data-ecc-editar="${esc(tipo)}" data-id="${esc(l.id)}">Editar</button> <button type="button" class="btn-sec btn-sm acao-perigo" data-ecc-excluir="${esc(tipo)}" data-id="${esc(l.id)}">Excluir</button>` : "";
  const soma = arr => arr.reduce((t, l) => t + Number(l.valor || 0), 0);
  const tabela = (cab, linhas, total, colsAntes, colsDepois) => !linhas ? "" : `<div class="tabela-rola"><table>
    <thead><tr>${/* html */ cab}</tr></thead><tbody>${/* html */ linhas}</tbody>
    <tfoot><tr><td colspan="${Number(colsAntes)}"><strong>Total</strong></td><td class="num"><strong>${brl(total)}</strong></td><td colspan="${Number(colsDepois)}"></td></tr></tfoot></table></div>`;
  const ordem = arr => [...arr].sort((x, y) => String(y.data).localeCompare(String(x.data)));
  $("ecc-entradas").innerHTML = !a.entradas.length ? uiVazio("Nenhuma entrada.") : tabela(
    "<th>Data</th><th>Tipo</th><th>Descrição</th><th>Obra</th><th class=\"num\">Valor</th><th>Situação</th><th>Observação</th><th></th>",
    ordem(a.entradas).map(l => `<tr><td>${dataBR(l.data)}</td><td>${esc(ECC_TIPOS[l.tipo] || l.tipo)}</td><td>${esc(l.descricao || "—")}</td>
      <td>${esc(eccObraRotulo(l.obra_id))}</td><td class="num">${brl(l.valor)}</td><td>${/* html */ sit(l)}</td><td class="meta">${/* html */ obs(l)}</td><td>${/* html */ acoes("entrada", l)}</td></tr>`).join(""),
    soma(a.entradas), 4, 3);
  $("ecc-relatorios").innerHTML = !a.relatorios.length ? uiVazio("Nenhum relatório aprovado.") : tabela(
    "<th>Data</th><th>Descrição</th><th>Obra</th><th class=\"num\">Valor</th><th>Situação</th><th>Observação</th><th></th>",
    ordem(a.relatorios).map(l => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.descricao || "—")}</td><td>${esc(eccObraRotulo(l.obra_id))}</td>
      <td class="num">${brl(l.valor)}</td><td>${/* html */ sit(l)}</td><td class="meta">${/* html */ obs(l)}</td><td>${/* html */ acoes("relatorio", l)}</td></tr>`).join(""),
    soma(a.relatorios), 3, 3);
  $("ecc-prestacoes").innerHTML = (!a.prestacoes.length ? uiVazio("Nenhuma prestação de contas.") : tabela(
    "<th>Data</th><th>Despesa</th><th class=\"num\">Valor</th><th>Situação</th><th>Observação</th><th></th>",
    ordem(a.prestacoes).map(l => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.despesa || "—")}</td><td class="num">${brl(l.valor)}</td>
      <td>${/* html */ sit(l)}</td><td class="meta">${/* html */ obs(l)}</td><td>${/* html */ acoes("prestacao", l)}</td></tr>`).join(""),
    soma(a.prestacoes), 2, 3)) + `<p class="meta">A prestação de contas é só informação para quem fecha o caixa: não entra no saldo.</p>`;
  const pode = eccPodeDesfazer();
  $("ecc-fechamentos").innerHTML = !a.fechamentos.length ? uiVazio("Nenhum fechamento registrado no app.") : `<div class="tabela-rola"><table>
    <thead><tr><th>Data</th><th class="num">Entradas</th><th class="num">Relatórios</th><th class="num">Saldo anterior</th><th class="num">Saldo levado</th>
      <th>Fechado por</th><th>Observação</th><th></th></tr></thead>
    <tbody>${a.fechamentos.map(f => `<tr${f.desfeito_em ? ' class="meta"' : ""}><td>${dataBR(f.data)}${f.desfeito_em ? ' <span class="tag cinza">desfeito</span>' : ""}</td>
      <td class="num">${brl(f.total_entradas)}</td><td class="num">${brl(f.total_relatorios)}</td><td class="num">${brl(f.saldo_anterior)}</td>
      <td class="num ${eccSaldoCls(f.saldo)}"><strong>${brl(f.saldo)}</strong></td>
      <td>${esc(a.perfis[f.fechado_por] || "—")}<br><span class="meta">${dataHoraBR(f.fechado_em)}</span></td>
      <td class="meta">${esc(f.observacao || "")}${f.desfeito_em ? `<br>Desfeito por ${esc(a.perfis[f.desfeito_por] || "—")}: ${esc(f.motivo_desfeito || "")}` : ""}</td>
      <td><button type="button" class="btn-sec btn-sm" data-ecc-imprimir="${esc(f.id)}">Imprimir</button>${pode && !f.desfeito_em ? ` <button type="button" class="btn-sec btn-sm acao-perigo" data-ecc-desfazer="${esc(f.id)}">Desfazer</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
  ativarTabEncontro(aba || document.querySelector("#ecc-notebook button.ativo")?.dataset.tab || "entradas");
}
function ativarTabEncontro(nome){
  document.querySelectorAll("#ecc-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#ecc-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}
/* depois de gravar: a ficha e a linha do painel voltam do banco (o saldo é da view) */
async function eccRecarregar(aba){
  const id = _eccAtual?.func?.id; if(!id) return;
  await abrirEncontroContas(id);
  if(aba) ativarTabEncontro(aba);
  const { data } = await sb.from("vw_ec_saldos").select("*").eq("funcionario_id", id).maybeSingle();
  const i = _eccSaldos.findIndex(s => s.funcionario_id === id);
  if(data){ if(i >= 0) _eccSaldos[i] = data; else _eccSaldos.push(data); } else if(i >= 0) _eccSaldos.splice(i, 1);
}

/* ---------- lançamento (entrada, relatório, prestação) ---------- */
function abrirLancamentoEcc(tipo, id){
  if(!eccPodeGravar() || !_eccAtual) return;
  const lista = { entrada: _eccAtual.entradas, relatorio: _eccAtual.relatorios, prestacao: _eccAtual.prestacoes }[tipo];
  const l = id ? lista.find(x => x.id === id) : null;
  _eccEdit = { tipo, id: l ? l.id : null };
  $("ecc-m-titulo").textContent = (l ? "Editar " + ECC_TITULO[tipo].toLowerCase() : ECC_NOVO[tipo]) + " · " + _eccAtual.func.nome;
  $("ecc-m-campo-tipo").style.display = tipo === "entrada" ? "" : "none";
  $("ecc-m-campo-obra").style.display = tipo === "prestacao" ? "none" : "";
  $("ecc-m-desc-rot").textContent = tipo === "prestacao" ? "Despesa" : "Descrição";
  $("ecc-m-tipo").innerHTML = Object.entries(ECC_TIPOS).map(([v, r]) => `<option value="${esc(v)}">${esc(r)}</option>`).join("");
  $("ecc-m-obra").innerHTML = `<option value="">— sem obra —</option>` + _eccObras.map(o => `<option value="${esc(o.id)}">${esc(eccObraRotulo(o.id))}</option>`).join("");
  $("ecc-m-data").value = l ? String(l.data).slice(0, 10) : hojeISO();
  $("ecc-m-valor").value = l ? l.valor : "";
  $("ecc-m-tipo").value = l?.tipo || "deposito_conta";
  $("ecc-m-desc").value = (tipo === "prestacao" ? l?.despesa : l?.descricao) || "";
  $("ecc-m-obra").value = l?.obra_id || "";
  $("ecc-m-obs").value = l?.observacao || "";
  $("ecc-m-aviso").textContent = ""; $("ecc-m-aviso").className = "aviso";
  $("ecc-modal").style.display = "flex";
  $("ecc-m-data").focus();
}
function fecharModalEcc(){ $("ecc-modal").style.display = "none"; _eccEdit = null; }
async function salvarLancamentoEcc(){
  if(!_eccEdit || !_eccAtual) return;
  const { tipo, id } = _eccEdit;
  const valor = Number(String($("ecc-m-valor").value).replace(",", "."));
  const data = $("ecc-m-data").value, desc = $("ecc-m-desc").value.trim();
  if(!data){ aviso("ecc-m-aviso", "Informe a data.", "erro"); return; }
  if(!Number.isFinite(valor) || valor === 0 || (tipo === "entrada" && valor < 0)){
    aviso("ecc-m-aviso", tipo === "relatorio" ? "Informe o valor (negativo só para ajuste)." : "Informe um valor maior que zero.", "erro"); return;
  }
  const reg = { data, valor, observacao: $("ecc-m-obs").value.trim() || null };
  if(tipo === "entrada"){
    reg.tipo = $("ecc-m-tipo").value;
    if(reg.tipo === "outro" && !desc){ aviso("ecc-m-aviso", "Tipo \"Outro\" exige a descrição.", "erro"); return; }
  }
  if(tipo === "prestacao") reg.despesa = desc || null; else { reg.descricao = desc || null; reg.obra_id = $("ecc-m-obra").value || null; }
  const tab = ECC_TABELA[tipo];
  const res = id ? await sb.from(tab).update(reg).eq("id", id).select("id")
                 : await sb.from(tab).insert({ ...reg, funcionario_id: _eccAtual.func.id }).select("id");
  if(res.error){ aviso("ecc-m-aviso", "Erro ao salvar: " + res.error.message, "erro"); return; }
  if(id && !(res.data || []).length){ aviso("ecc-m-aviso", "Não foi possível salvar: sem permissão ou lançamento já fechado.", "erro"); return; }
  fecharModalEcc();
  aviso("app-aviso", ECC_TITULO[tipo] + ": lançamento salvo.", "ok");
  await eccRecarregar({ entrada: "entradas", relatorio: "relatorios", prestacao: "prestacoes" }[tipo]);
}
async function excluirLancamentoEcc(tipo, id){
  if(!eccPodeGravar() || !confirm(`Excluir este lançamento (${ECC_TITULO[tipo].toLowerCase()})? Ele ainda está aberto; depois de fechado não se apaga.`)) return;
  const { data, error } = await sb.from(ECC_TABELA[tipo]).delete().eq("id", id).select("id");
  if(error){ aviso("app-aviso", "Erro ao excluir: " + error.message, "erro"); return; }
  if(!(data || []).length){ aviso("app-aviso", "Não foi possível excluir: sem permissão.", "erro"); return; }
  aviso("app-aviso", "Lançamento excluído.", "ok");
  await eccRecarregar();
}

/* ---------- fechar e desfazer ---------- */
function abrirFecharCaixaEcc(){
  if(!eccPodeGravar() || !_eccAtual) return;
  $("ecc-f-titulo").textContent = "Fechar caixa · " + _eccAtual.func.nome;
  $("ecc-f-data").value = hojeISO(); $("ecc-f-obs").value = "";
  $("ecc-f-aviso").textContent = ""; $("ecc-f-aviso").className = "aviso";
  eccResumoFechamento();
  $("ecc-fechar-modal").style.display = "flex";
}
function eccResumoFechamento(){
  const d = $("ecc-f-data").value, a = _eccAtual; if(!a) return;
  const ab = arr => arr.filter(l => l.situacao === "aberta" && String(l.data) <= d).length;
  const np = a.prestacoes.filter(l => !l.fechamento_id && String(l.data) <= d).length;
  $("ecc-f-resumo").textContent = d ? `Até ${dataBR(d)}: ${ab(a.entradas)} entrada(s), ${ab(a.relatorios)} relatório(s) aprovado(s) e ${np} prestação(ões) em aberto entram no fechamento. Os totais e o saldo levado para frente são calculados pelo banco.` : "";
}
async function confirmarFecharCaixaEcc(){
  const d = $("ecc-f-data").value;
  if(!d){ aviso("ecc-f-aviso", "Informe a data do fechamento.", "erro"); return; }
  const { error } = await sb.rpc("ec_fechar_caixa", { p_funcionario: _eccAtual.func.id, p_data: d, p_observacao: $("ecc-f-obs").value.trim() || null });
  if(error){ aviso("ecc-f-aviso", error.message, "erro"); return; }
  $("ecc-fechar-modal").style.display = "none";
  aviso("app-aviso", "Caixa fechado.", "ok");
  await eccRecarregar("fechamentos");
}
async function desfazerFechamentoEcc(id){
  if(!eccPodeDesfazer()) return;
  const motivo = prompt("Motivo para desfazer o fechamento (fica no histórico do funcionário):");
  if(motivo === null) return;
  if(!motivo.trim()){ aviso("app-aviso", "Informe o motivo.", "erro"); return; }
  const { error } = await sb.rpc("ec_desfazer_fechamento", { p_fechamento: id, p_motivo: motivo.trim() });
  if(error){ aviso("app-aviso", error.message, "erro"); return; }
  aviso("app-aviso", "Fechamento desfeito: os lançamentos voltaram a ficar abertos.", "ok");
  await eccRecarregar("fechamentos");
}

/* ---------- imprimir o fechamento (pelo navegador) ---------- */
function imprimirFechamentoEcc(id){
  const a = _eccAtual, f = a?.fechamentos.find(x => x.id === id); if(!f) return;
  const w = window.open("", "_blank"); if(!w){ aviso("app-aviso", "Permita pop-ups para imprimir.", "erro"); return; }
  const doF = arr => arr.filter(l => l.fechamento_id === id).sort((x, y) => String(x.data).localeCompare(String(y.data)));
  const tab = (titulo, cab, linhas, total) => `<h2>${esc(titulo)}</h2>${linhas ? `<table><thead><tr>${/* html */ cab}</tr></thead><tbody>${/* html */ linhas}</tbody>
    <tfoot><tr><td colspan="2">Total</td><td class="n">${brl(total)}</td></tr></tfoot></table>` : "<p>Nenhum.</p>"}`;
  const en = doF(a.entradas), re = doF(a.relatorios), pr = doF(a.prestacoes);
  const soma = arr => arr.reduce((t, l) => t + Number(l.valor || 0), 0);
  const html = `<h1>Fechamento de caixa · RG 8.5</h1>
    <p><strong>${esc(a.func.nome)}</strong>${a.func.matricula ? ` · matrícula ${esc(a.func.matricula)}` : ""} · fechado até ${dataBR(f.data)}
      por ${esc(a.perfis[f.fechado_por] || "—")} em ${dataHoraBR(f.fechado_em)}${f.desfeito_em ? " · <strong>DESFEITO</strong>" : ""}</p>
    ${/* html */ tab("Entradas (caixa de obra)", "<th>Data</th><th>Tipo / descrição</th><th class=\"n\">Valor</th>",
      en.map(l => `<tr><td>${dataBR(l.data)}</td><td>${esc(ECC_TIPOS[l.tipo] || l.tipo)}${l.descricao ? " · " + esc(l.descricao) : ""}</td><td class="n">${brl(l.valor)}</td></tr>`).join(""), soma(en))}
    ${/* html */ tab("Relatórios aprovados", "<th>Data</th><th>Descrição</th><th class=\"n\">Valor</th>",
      re.map(l => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.descricao || "")}</td><td class="n">${brl(l.valor)}</td></tr>`).join(""), soma(re))}
    ${/* html */ tab("Prestação de contas (não entra no saldo)", "<th>Data</th><th>Despesa</th><th class=\"n\">Valor</th>",
      pr.map(l => `<tr><td>${dataBR(l.data)}</td><td>${esc(l.despesa || "")}</td><td class="n">${brl(l.valor)}</td></tr>`).join(""), soma(pr))}
    <table class="res"><tr><td>Saldo anterior</td><td class="n">${brl(f.saldo_anterior)}</td></tr>
      <tr><td>+ Entradas</td><td class="n">${brl(f.total_entradas)}</td></tr><tr><td>− Relatórios aprovados</td><td class="n">${brl(f.total_relatorios)}</td></tr>
      <tr><td><strong>Saldo levado para frente</strong></td><td class="n"><strong>${brl(f.saldo)}</strong></td></tr></table>
    ${f.observacao ? `<p>Observação: ${esc(f.observacao)}</p>` : ""}
    <div class="ass"><div>Colaborador</div><div>Financeiro</div></div>`;
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Fechamento ${esc(a.func.nome)}</title><style>
    @page { size: A4; margin: 14mm; } body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: black; }
    h1 { font-size: 14pt; margin: 0 0 4px; } h2 { font-size: 11pt; margin: 14px 0 4px; }
    table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid silver; padding: 3px 4px; text-align: left; }
    .n { text-align: right; } tfoot td { font-weight: bold; } .res { width: 50%; margin: 16px 0 0 auto; }
    .ass { display: flex; gap: 40px; margin-top: 60px; } .ass div { flex: 1; border-top: 1px solid black; text-align: center; padding-top: 4px; }
  </style></head><body>${/* html */ html}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

/* ---------- WhatsApp do colaborador (fase 190d, D19): vincular e desvincular o número ---------- */
function eccFoneBR(e164){
  const d = String(e164 || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : String(e164 || "");
}
async function abrirWhatsAppEcc(){
  if(!eccPodeGravar() || !_eccAtual) return;
  const f = _eccAtual.func;
  const [ct, fu, ms] = await Promise.all([
    sb.from("ec_wa_contatos").select("numero_e164,vinculado_em").eq("funcionario_id", f.id).eq("ativo", true).maybeSingle(),
    sb.from("funcionarios").select("telefone").eq("id", f.id).maybeSingle(),
    sb.from("ec_wa_mensagens").select("created_at").eq("funcionario_id", f.id).order("created_at", { ascending: false }).limit(1)
  ]);
  const erro = [ct, fu, ms].find(r => r.error);
  if(erro){ uiAvisar("Erro ao abrir o WhatsApp: " + erro.error.message, "erro"); return; }
  const c = ct.data, ultima = (ms.data || [])[0]?.created_at;
  if(c){
    const corpo = uiRotuloValor("Número vinculado", uiCodigo(eccFoneBR(c.numero_e164)))
      + uiRotuloValor("Vinculado em", esc(dataHoraBR(c.vinculado_em)))
      + uiRotuloValor("Última mensagem", ultima ? esc(dataHoraBR(ultima)) : "Nenhuma ainda")
      + `<p class="meta">O colaborador registra as despesas mandando a foto da notinha para o WhatsApp da CGL a partir deste número.</p>`;
    const r = await uiModal({ titulo: "WhatsApp · " + f.nome, corpoHTML: corpo, largura: "p", acoes: [
      { id: "fechar", texto: "Fechar" }, { id: "trocar", texto: "Trocar número" }, { id: "desvincular", texto: "Desvincular", perigo: true }] });
    if(r === "trocar") return vincularWhatsAppEcc(eccFoneBR(c.numero_e164));
    if(r !== "desvincular") return;
    const ok = await uiConfirmar({ titulo: "Desvincular o WhatsApp", perigo: true, confirmar: "Desvincular",
      texto: `Desvincular o número ${eccFoneBR(c.numero_e164)} de ${f.nome}? Ele deixa de registrar despesas pelo WhatsApp; as despesas já registradas ficam.` });
    if(!ok) return;
    const { error } = await sb.rpc("ec_wa_desvincular", { p_funcionario: f.id });
    if(error){ uiAvisar(error.message, "erro"); return; }
    uiAvisar("WhatsApp desvinculado.", "ok");
    return;
  }
  return vincularWhatsAppEcc(fu.data?.telefone || "");
}
async function vincularWhatsAppEcc(sugerido){
  const f = _eccAtual?.func; if(!f) return;
  const v = await uiPedirValores({ titulo: "Vincular WhatsApp · " + f.nome, confirmar: "Vincular",
    texto: "Número de celular com DDD (vem da ficha do funcionário). Só este número poderá registrar despesas em nome dele pelo WhatsApp da CGL.",
    campos: [{ id: "ecc-wa-numero", rotulo: "Celular", tipo: "tel", valor: sugerido, obrigatorio: true, placeholder: "(31) 99999-0000" }] });
  if(!v) return;
  const numero = String(v["ecc-wa-numero"] || "").trim();
  if(numero.replace(/\D/g, "").length < 10){ uiAvisar("Informe o celular com DDD.", "erro"); return; }
  const { error } = await sb.rpc("ec_wa_vincular", { p_funcionario: f.id, p_numero: numero });
  if(error){ uiAvisar(error.message, "erro"); return; }
  uiAvisar("WhatsApp vinculado.", "ok");
}

/* ---------- smart-button "Caixa" na ficha do funcionário (D9) ---------- */
async function eccSmartFuncionario(funcId){
  const b = $("func-sb-caixa"); if(!b) return;
  b.style.display = "none"; b.dataset.id = funcId || "";
  if(!funcId || !eccPodeVer()) return;
  const { data, error } = await sb.from("vw_ec_saldos").select("saldo").eq("funcionario_id", funcId).maybeSingle();
  if(error || b.dataset.id !== funcId) return;
  $("func-sb-caixa-num").textContent = data ? brl(data.saldo) : brl(0);
  b.style.display = "";
}

/* ---------- ligação ---------- */
function ligarEncontroContas(){
  if(!$("sec-encontro-contas")) return;
  document.querySelector('nav button[data-secao="encontro-contas"]')?.addEventListener("click", () => { mostrarPainelEncontro(); carregarEncontroContas(false); });
  document.querySelectorAll("#ecc-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _eccView = b.dataset.view; renderEncontroContas(); }));
  $("ecc-busca")?.addEventListener("input", debounce(renderEncontroContas));
  ["ecc-situacao", "ecc-ativo", "ecc-obra"].forEach(id => $(id)?.addEventListener("change", renderEncontroContas));
  $("btn-ecc-atualizar")?.addEventListener("click", () => carregarEncontroContas(true));
  $("btn-ecc-abrir-func")?.addEventListener("click", () => {
    const id = $("ecc-novo-func").value;
    if(!id){ aviso("app-aviso", "Escolha o funcionário.", "erro"); return; }
    abrirEncontroContas(id);
  });
  const abrirDaLista = e => { const el = e.target.closest("[data-id]"); if(el && el.closest("#ecc-conteudo")) abrirEncontroContas(el.dataset.id); };
  $("ecc-conteudo")?.addEventListener("click", abrirDaLista);
  $("ecc-conteudo")?.addEventListener("keydown", e => { if(e.key === "Enter") abrirDaLista(e); });
  $("btn-ecc-voltar")?.addEventListener("click", mostrarPainelEncontro);
  $("btn-ecc-nova-entrada")?.addEventListener("click", () => abrirLancamentoEcc("entrada"));
  $("btn-ecc-novo-relatorio")?.addEventListener("click", () => abrirLancamentoEcc("relatorio"));
  $("btn-ecc-nova-prestacao")?.addEventListener("click", () => abrirLancamentoEcc("prestacao"));
  $("btn-ecc-fechar")?.addEventListener("click", abrirFecharCaixaEcc);
  $("btn-ecc-whatsapp")?.addEventListener("click", () => comBotaoTravado("btn-ecc-whatsapp", abrirWhatsAppEcc));
  document.querySelectorAll("#ecc-notebook button").forEach(b => b.addEventListener("click", () => ativarTabEncontro(b.dataset.tab)));
  document.querySelectorAll("#ecc-ficha .sb-btn[data-goto-tab]").forEach(b => b.addEventListener("click", () => ativarTabEncontro(b.dataset.gotoTab)));
  $("ecc-ficha")?.addEventListener("click", e => {
    const t = e.target.closest("button"); if(!t) return;
    if(t.dataset.eccEditar) abrirLancamentoEcc(t.dataset.eccEditar, t.dataset.id);
    else if(t.dataset.eccExcluir) excluirLancamentoEcc(t.dataset.eccExcluir, t.dataset.id);
    else if(t.dataset.eccImprimir) imprimirFechamentoEcc(t.dataset.eccImprimir);
    else if(t.dataset.eccDesfazer) desfazerFechamentoEcc(t.dataset.eccDesfazer);
  });
  $("btn-ecc-m-salvar")?.addEventListener("click", () => comBotaoTravado("btn-ecc-m-salvar", salvarLancamentoEcc));
  $("ecc-f-data")?.addEventListener("change", eccResumoFechamento);
  $("btn-ecc-f-confirmar")?.addEventListener("click", () => comBotaoTravado("btn-ecc-f-confirmar", confirmarFecharCaixaEcc));
  ["ecc-modal", "ecc-fechar-modal"].forEach(id => {
    const m = $(id); if(!m) return;
    m.querySelector(".modal-topo button")?.addEventListener("click", () => { m.style.display = "none"; _eccEdit = null; });
    m.addEventListener("click", e => { if(e.target === m){ m.style.display = "none"; _eccEdit = null; } });
  });
  $("func-sb-caixa")?.addEventListener("click", () => {
    const id = $("func-sb-caixa").dataset.id; if(!id) return;
    if(irParaSecao("encontro-contas")) abrirEncontroContas(id);
  });
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarEncontroContas);
else ligarEncontroContas();

/* ====================================================================
   Módulo: Contratos (Receita e Despesa)
   Layout: padrão Serviços + Odoo. Prefixo de IDs: con-.
   Fluxo: em_elaboração → aguardando_assinatura → vigente → encerrado / rescindido / cancelado.

   Fase 21: o contrato do CLIENTE passou a ser editado na aba "Contrato" da obra (obra_abas.js / obras.js).
   Fase 55: a seção virou "Contratos & Contas a pagar".
   Fase 180a (16/11/2026, D1, D6 e D7): a seção volta a ser só de contratos, com dois lados:
     Receita = natureza 'cliente' (nasce do orçamento aprovado; venda de bem a partir da 180c), lido por quem tem
               pode_ler_comercial() no banco (podeVerContratosReceita no core.js);
     Despesa = natureza 'fornecedor' (fornecedor, material, serviço, assinatura de sistema), lido por quem tem
               pode_ler_contas_pagar() (podeVerContratosDespesa).
   Contas a pagar (A pagar, Lançamentos avulsos, Exportações) foi para a seção própria sec-contaspagar (js/contas_pagar.js).
   O contrato de cliente continua nascendo do orçamento aprovado e ligado à obra por obras.contrato_id; a aba Contrato
   da obra mostra o resumo e o link para cá. Cliente, vigência, valor e responsável do contrato ligado a uma obra vêm da
   obra (salvarContratoDaObra espelha ao salvar a obra) e ficam travados aqui.
   ==================================================================== */

let _contratos = [];
let _conView   = "lista";
let _conLado   = "todos";        // fase 180a: receita | despesa | todos
let conEditId  = null;
let _conObrasPorContrato = {};   // fase 180a: contrato_id → [{id,codigo,nome}] (obras.contrato_id, lado Receita)
let _conObrasLista = [];         // obras para o filtro (id, codigo, nome)
let _conEquipMap = {};           // equipamento_id → "código — nome", só dos equipamentos ligados a contratos

const CON_STAGES = ["em_elaboracao","aguardando_assinatura","vigente","encerrado"];
const CON_LADO_LBL = { cliente: "Receita", fornecedor: "Despesa" };
/* meses por período, para o custo mensal das assinaturas */
const CON_MESES_RECORRENCIA = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };

/* Categorias dos anexos de contrato (tabela contratos_documentos) */
const CON_DOC_CATEGORIAS = {
  contrato_assinado: "Contrato assinado",
  aditivo:           "Aditivo",
  proposta:          "Proposta",
  anexo:             "Anexo",
  outro:             "Outro"
};

/* ---------- Permissões (fase 180a) ----------
   Escrita espelha a policy contratos_write: admin, financeiro e comprador em qualquer contrato (diretor por has_role) e
   comercial no contrato de cliente. O lado só é oferecido a quem também o lê. Auditor não grava. */
function conPodeEditar(natureza){
  if(!usuarioAtual || ehSomenteLeitura()) return false;
  const c = usuarioAtual.cargo;
  if(natureza === "cliente") return podeVerContratosReceita() && ["diretor","admin","financeiro","comprador","comercial"].includes(c);
  return podeVerContratosDespesa() && ["diretor","admin","financeiro","comprador"].includes(c);
}
function conLadosVisiveis(){
  const l = [];
  if(podeVerContratosReceita()) l.push("cliente");
  if(podeVerContratosDespesa()) l.push("fornecedor");
  return l;
}
function conContraparte(c){
  if(!c) return "";
  return c.natureza === "cliente" ? (mapaClientes[c.cliente_id] || "") : (mapaFornecedores[c.fornecedor_id] || "");
}
/* obras do contrato: as ligadas por obras.contrato_id (Receita) ou a obra que recebe o custo (Despesa) */
function conObrasDe(c){
  if(!c) return [];
  if(c.natureza === "cliente") return _conObrasPorContrato[c.id] || [];
  if(!c.obra_id) return [];
  const o = _conObrasLista.find(x => x.id === c.obra_id);
  return [o || { id: c.obra_id, codigo: (mapaObras && mapaObras[c.obra_id]) || "obra", nome: "" }];
}
function conObrasHTML(c){
  const obras = conObrasDe(c);
  return obras.length ? obras.map(o => linkObra(o.id, o.codigo)).join(", ") : "—";
}
/* custo mensal de um contrato recorrente (assinatura de sistema): valor da parcela ÷ meses do período */
function conCustoMensal(c){
  const m = CON_MESES_RECORRENCIA[c.forma_recorrencia];
  return m ? Number(c.valor_recorrente || 0) / m : null;
}

/* ---------- Vencimento ---------- */
/* Dias até o fim da vigência (negativo = já venceu; null = sem data) */
function diasParaVencer(c){
  if(!c || !c.data_fim_prevista) return null;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const fim  = new Date(String(c.data_fim_prevista).slice(0,10) + "T00:00:00");
  return Math.round((fim - hoje) / 86400000);
}

/* Contrato está dentro da janela de aviso configurada nele mesmo? */
function contratoEmAlerta(c){
  if(c.status !== "vigente") return false;
  const dias = diasParaVencer(c);
  if(dias === null) return false;
  const janela = Number(c.aviso_vencimento_dias || 0) || 30;
  return dias <= janela;
}

/* Usado pelo dashboard (js/dashboard.js) para as ações pendentes */
async function contratosVencendo(){
  const { data } = await sb.from("contratos")
    .select("id,numero,fornecedor_id,status,data_fim_prevista,aviso_vencimento_dias,renovacao_automatica")
    .eq("natureza","fornecedor")
    .eq("status","vigente")
    .not("data_fim_prevista","is",null);
  return (data || []).filter(contratoEmAlerta)
    .sort((a,b) => diasParaVencer(a) - diasParaVencer(b));
}

/* ---------- Carga ---------- */
let _conGerouTitulos = false;
async function carregarContratos(){
  // fase 56: completa o horizonte de títulos (3 meses) uma vez por sessão; o pg_cron faz o mesmo todo dia.
  // Lote S43 (L4): só quem gera títulos no banco (has_role admin/financeiro/comprador + diretor) chama a RPC.
  const geraTitulos = !!usuarioAtual && ["diretor", "admin", "financeiro", "comprador"].includes(usuarioAtual.cargo)
    && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura());
  if(!_conGerouTitulos && geraTitulos){
    _conGerouTitulos = true;
    await sb.rpc("contrato_gerar_titulos");
  }
  const lados = conLadosVisiveis();
  if(!lados.length){ _contratos = []; return; }
  const [rc, ro] = await Promise.all([
    lerTudo(() => sb.from("contratos")
      .select("id,numero,natureza,cliente_id,fornecedor_id,categoria,status,valor_total,valor_recorrente,forma_recorrencia,descricao,data_inicio,data_fim_prevista,aviso_vencimento_dias,renovacao_automatica,obra_id,equipamento_id,created_at")
      .in("natureza", lados)),
    lerTudo(() => sb.from("obras").select("id,codigo,nome,contrato_id"))
  ]);
  _contratos = rc.error ? [] : (rc.data || []).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  _conObrasLista = (ro.data || []).slice().sort((a, b) => String(a.codigo || "").localeCompare(String(b.codigo || ""), "pt-BR", { numeric: true }));
  _conObrasPorContrato = {};
  _conObrasLista.forEach(o => { if(o.contrato_id) (_conObrasPorContrato[o.contrato_id] = _conObrasPorContrato[o.contrato_id] || []).push(o); });
  const eqIds = [...new Set(_contratos.map(c => c.equipamento_id).filter(Boolean))];
  _conEquipMap = {};
  if(eqIds.length){
    const { data: eqs } = await sb.from("equipamentos").select("id,codigo,nome").in("id", eqIds);
    (eqs || []).forEach(e => { _conEquipMap[e.id] = `${e.codigo}${e.nome ? " — " + e.nome : ""}`; });
  }
  renderContratos();
}

/* ---------- Filtros ---------- */
function conFiltrados(){
  const termo = ($("con-busca")?.value || "").trim().toLowerCase();
  const fStat = $("con-f-status")?.value || "";
  const fCat  = $("con-f-categoria")?.value || "";
  const fVenc = $("con-f-vencimento")?.value || "";
  const fCp   = $("con-f-contraparte")?.value || "";
  const fObra = $("con-f-obra")?.value || "";
  const fEq   = $("con-f-equip")?.value || "";
  return _contratos.filter(c => {
    if(_conLado === "receita" && c.natureza !== "cliente") return false;
    if(_conLado === "despesa" && c.natureza !== "fornecedor") return false;
    if(fStat && c.status !== fStat) return false;
    if(fCat  && c.categoria !== fCat) return false;
    if(fCp   && (c.natureza === "cliente" ? "c:" + c.cliente_id : "f:" + c.fornecedor_id) !== fCp) return false;
    if(fObra && !conObrasDe(c).some(o => o.id === fObra)) return false;
    if(fEq   && c.equipamento_id !== fEq) return false;
    if(fVenc){
      const dias = diasParaVencer(c);
      if(dias === null) return false;
      if(fVenc === "vencidos"){ if(dias >= 0) return false; }
      else if(dias < 0 || dias > Number(fVenc)) return false;
    }
    if(termo){
      const alvo = `${c.numero||""} ${conContraparte(c)} ${c.descricao||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/* repõe as opções de um select mantendo a escolha, se ela ainda existir */
function conRepor(sel, html){
  if(!sel) return;
  const v = sel.value;
  sel.innerHTML = html;
  if(v && [...sel.options].some(o => o.value === v)) sel.value = v;
}

function preencherFiltrosCon(){
  const selSt = $("con-f-status");
  if(selSt && !selSt.options.length){
    selSt.innerHTML = `<option value="">Todas as situações</option>` + opcoesStatus("contrato");
  }
  const selCat = $("con-f-categoria");
  if(selCat && !selCat.options.length){
    selCat.innerHTML = `<option value="">Todas as categorias</option>` +
      Object.entries(CONTRATO_CATEGORIA).map(([v,l]) => `<option value="${esc(v)}">${esc(v === "assinatura" ? "Assinaturas (custo mensal)" : l)}</option>`).join("");
  }
  // contraparte, obra e equipamento: só os que aparecem nos contratos do lado escolhido
  const doLado = _contratos.filter(c => _conLado === "todos" || (_conLado === "receita") === (c.natureza === "cliente"));
  const cps = new Map();
  doLado.forEach(c => {
    const k = c.natureza === "cliente" ? "c:" + c.cliente_id : "f:" + c.fornecedor_id;
    if(!cps.has(k)) cps.set(k, conContraparte(c) || "(sem nome)");
  });
  const rotCp = _conLado === "receita" ? "Todos os clientes" : _conLado === "despesa" ? "Todos os fornecedores" : "Todos os clientes e fornecedores";
  conRepor($("con-f-contraparte"), `<option value="">${esc(rotCp)}</option>` +
    [...cps.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join(""));
  const obraIds = new Set(); doLado.forEach(c => conObrasDe(c).forEach(o => obraIds.add(o.id)));
  conRepor($("con-f-obra"), `<option value="">Todas as obras</option>` +
    _conObrasLista.filter(o => obraIds.has(o.id)).map(o => `<option value="${esc(o.id)}">${esc(o.codigo)}${o.nome ? " — " + esc(o.nome) : ""}</option>`).join(""));
  const eqIds = [...new Set(doLado.map(c => c.equipamento_id).filter(Boolean))];
  conRepor($("con-f-equip"), `<option value="">Todos os equipamentos</option>` +
    eqIds.map(id => [id, _conEquipMap[id] || "equipamento"]).sort((a, b) => a[1].localeCompare(b[1], "pt-BR", { numeric: true }))
      .map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join(""));
}

/* toggle Receita | Despesa | Todos: some o lado que o cargo não lê; com um lado só, ele fica fixo */
function conAjustarLados(){
  const lados = conLadosVisiveis();
  const rec = lados.includes("cliente"), des = lados.includes("fornecedor");
  const caixa = $("con-lados");
  if(caixa){
    caixa.style.display = rec && des ? "" : "none";
    if(!(rec && des)) _conLado = rec ? "receita" : "despesa";
    caixa.querySelectorAll("[data-lado]").forEach(b => b.classList.toggle("ativo", b.dataset.lado === _conLado));
  }
  const bNovo = $("btn-novo-contrato");
  if(bNovo) bNovo.style.display = (conPodeEditar("cliente") || conPodeEditar("fornecedor")) ? "" : "none";
}

/* ---------- Render ---------- */
function renderContratos(){
  conAjustarLados();
  preencherFiltrosCon();
  if(typeof capKpis === "function" && $("sec-contaspagar")?.classList.contains("ativa")) capKpis();
  const titulo = { receita: "Contratos de receita", despesa: "Contratos de despesa", todos: "Contratos" }[_conLado];
  if($("con-lista-titulo")) $("con-lista-titulo").textContent = titulo;
  const dados = conFiltrados();
  const doLado = _contratos.filter(c => _conLado === "todos" || (_conLado === "receita") === (c.natureza === "cliente"));
  const cont = $("con-contador");
  if(cont) cont.textContent = `${dados.length} de ${doLado.length}`;
  renderAlertaVencimento();
  renderResumoAssinaturas(dados);
  if(_conView === "kanban") renderConKanban(dados);
  else                       renderConLista(dados);
}

/* Filtro "Assinaturas": custo mensal de cada contrato na lista; a soma só para quem lê contas a pagar */
function renderResumoAssinaturas(dados){
  const box = $("con-assin-resumo");
  if(!box) return;
  if(($("con-f-categoria")?.value || "") !== "assinatura"){ box.innerHTML = ""; return; }
  const vigentes = dados.filter(c => ["vigente","renovado"].includes(c.status));
  const soma = podeVerContasPagar()
    ? ` Custo mensal das vigentes: <strong data-val-sens>${brl(vigentes.reduce((s, c) => s + (conCustoMensal(c) || 0), 0))}</strong>.`
    : "";
  box.innerHTML = `<p class="meta">${vigentes.length} assinatura(s) vigente(s).${/* html */ soma} O custo mensal de cada uma é a parcela dividida pelos meses do período.</p>`;
}

/* Faixa de alerta no topo do painel */
function renderAlertaVencimento(){
  const cont = $("con-alerta-venc");
  if(!cont) return;
  const emAlerta = _contratos
    .filter(c => _conLado === "todos" || (_conLado === "receita") === (c.natureza === "cliente"))
    .filter(contratoEmAlerta)
    .sort((a,b) => diasParaVencer(a) - diasParaVencer(b));
  if(!emAlerta.length){ cont.innerHTML = ""; return; }

  const temVencido = emAlerta.some(c => diasParaVencer(c) < 0);
  const itens = emAlerta.slice(0,6).map(c => {
    const dias = diasParaVencer(c);
    const quando = dias < 0
      ? `venceu há ${Math.abs(dias)} dia(s)`
      : dias === 0 ? "vence hoje" : `vence em ${dias} dia(s)`;
    const renova = c.renovacao_automatica ? " · renova automaticamente" : "";
    return `<li><button type="button" class="con-alerta-link" data-id="${esc(c.id)}"><strong>${esc(c.numero)}</strong></button>
      — ${esc(conContraparte(c) || "contraparte não informada")}, ${quando} (${dataBR(c.data_fim_prevista)})${renova}</li>`;
  }).join("");
  const resto = emAlerta.length > 6 ? `<li>… e mais ${emAlerta.length - 6} contrato(s).</li>` : "";

  cont.innerHTML = `<div class="con-alerta${temVencido ? " critico" : ""}">
    <span class="con-alerta-icone">${temVencido ? "⛔" : "⏰"}</span>
    <div>
      <strong>${emAlerta.length} contrato(s) exigindo atenção</strong>
      <ul>${itens}${resto}</ul>
    </div>
  </div>`;
  cont.querySelectorAll(".con-alerta-link").forEach(b => {
    b.addEventListener("click", () => abrirContrato(b.dataset.id));
  });
}

/* Tag de dias restantes ao lado da data de fim */
function tagDias(c){
  if(c.status !== "vigente") return "";
  const dias = diasParaVencer(c);
  if(dias === null) return "";
  const janela = Number(c.aviso_vencimento_dias || 0) || 30;
  if(dias > janela) return "";
  const txt = dias < 0 ? `${Math.abs(dias)}d vencido` : `${dias}d`;
  return `<span class="con-dias-tag${dias < 0 ? " critico" : ""}">${txt}</span>`;
}

function tagLado(c){
  return `<span class="tag ${c.natureza === "cliente" ? "verde" : "azul"}">${esc(CON_LADO_LBL[c.natureza] || c.natureza)}</span>`;
}

function renderConLista(dados){
  const cont = $("con-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = uiVazio("Nenhum contrato encontrado.");
    return;
  }
  const comLado = _conLado === "todos";
  const assin = ($("con-f-categoria")?.value || "") === "assinatura";
  const rotCp = _conLado === "receita" ? "Cliente" : _conLado === "despesa" ? "Fornecedor" : "Cliente / fornecedor";
  const linhas = dados.map(c => {
    const dias = diasParaVencer(c);
    let classe = "linha-clicavel";
    if(contratoEmAlerta(c)) classe += dias < 0 ? " con-vencido" : " con-vencendo";
    const mensal = conCustoMensal(c);
    return `<tr class="${esc(classe)}" data-id="${esc(c.id)}">
      <td>${uiCodigo(c.numero)}</td>
      ${comLado ? `<td>${tagLado(c)}</td>` : ""}
      <td>${esc(conContraparte(c) || "—")}</td>
      <td>${esc(CONTRATO_CATEGORIA[c.categoria] || c.categoria || "—")}</td>
      <td>${/* html */ conObrasHTML(c)}</td>
      <td>${dataBR(c.data_inicio)}</td>
      <td>${dataBR(c.data_fim_prevista)}${tagDias(c)}</td>
      <td>${tagStatus("contrato", c.status)}</td>
      ${assin ? `<td class="num">${mensal == null ? '<span class="meta">não recorrente</span>' : brl(mensal)}</td>` : ""}
      <td class="num">${brl(c.valor_total)}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Número</th>${comLado ? "<th>Lado</th>" : ""}<th>${esc(rotCp)}</th><th>Categoria</th><th>Obra</th>
      <th>Início</th><th>Fim da vigência</th><th>Situação</th>${assin ? `<th class="num">Custo mensal</th>` : ""}<th class="num">Valor</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderConKanban(dados){
  const cont = $("con-conteudo");
  if(!cont) return;
  const colunas = CON_STAGES.concat(["renovado","suspenso","rescindido","cancelado","vencido"]).map(st => {
    const itens = dados.filter(c => c.status === st);
    if(!itens.length && !CON_STAGES.includes(st)) return "";
    const stMeta = (STATUS.contrato && STATUS.contrato[st]) || { label: st, cor: "cinza" };
    const cards = itens.map(c => `<div class="serv-kan-card linha-clicavel" data-id="${esc(c.id)}">
        <div class="serv-kan-card-nome">${uiCodigo(c.numero)} · ${esc(conContraparte(c) || "—")}</div>
        <div class="serv-kan-card-meta">
          ${_conLado === "todos" ? tagLado(c) : ""}
          <span class="meta">${esc(CONTRATO_CATEGORIA[c.categoria] || "—")}</span>
          ${tagDias(c)}
        </div>
        <div class="serv-kan-card-rod">
          <span>${c.data_fim_prevista ? "Até " + dataBR(c.data_fim_prevista) : ""}</span>
          <strong>${brl(c.valor_total)}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  habilitarDragKanban({
    container: "#con-conteudo .serv-kanban",
    tabela: "contratos",
    onUpdate: async () => { await carregarContratos(); }
  });
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelCon(){
  $("con-painel").style.display = "";
  $("con-ficha").style.display = "none";
  conEditId = null;
}

/* Próximo número CT- livre.
   contratos.numero é UNIQUE na tabela inteira, então a sugestão precisa
   olhar também os contratos de cliente (que nascem na ficha da obra). */
async function proximoNumeroContrato(){
  const { data } = await sb.from("contratos").select("numero").like("numero","CT-%");
  const usados = (data || [])
    .map(c => /^CT-(\d+)$/.exec((c.numero || "").trim()))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));
  const proximo = usados.length ? Math.max(...usados) + 1 : 1;
  return "CT-" + String(proximo).padStart(4, "0");
}

/* fase 180a: mostra o campo de contraparte e os campos do lado (Despesa: recorrência, títulos e destino do custo) */
function conAplicarNatureza(natureza){
  const cli = natureza === "cliente";
  $("con-campo-cliente").style.display = cli ? "" : "none";
  $("con-campo-fornecedor").style.display = cli ? "none" : "";
  document.querySelectorAll("#con-ficha .con-so-despesa").forEach(el => { el.style.display = cli ? "none" : ""; });
  $("con-aba-titulos").style.display = cli ? "none" : "";
  $("sb-con-titulos").style.display = cli ? "none" : "";
  $("con-aba-parcelas").style.display = cli ? "" : "none";
  $("sb-con-parcelas").style.display = cli ? "" : "none";
  $("con-ficha-contraparte-lbl").textContent = cli ? "Cliente" : "Fornecedor";
}

/* fase 180a (D7): contrato de cliente ligado a obra — cliente, vigência, valor e responsável vêm da obra */
function conTravarCamposDaObra(c){
  const obras = c && c.id && c.natureza === "cliente" ? conObrasDe(c) : [];
  const travar = obras.length > 0;
  ["con-cliente","con-inicio","con-fim","con-valor","con-responsavel"].forEach(id => { const el = $(id); if(el) el.disabled = travar; });
  const box = $("con-aviso-obra");
  if(box) box.innerHTML = travar
    ? `<p class="ajuda-campo">Contrato da obra ${obras.map(o => linkObra(o.id, o.codigo)).join(", ")}: cliente, datas, valor e responsável vêm da ficha da obra e são atualizados quando a obra é salva.</p>`
    : "";
}

function conLimparCampos(){
  ["con-descricao","con-fornecedor","con-cliente","con-responsavel","con-assinatura",
   "con-inicio","con-fim","con-indice","con-obs"
  ].forEach(k => { const el = $(k); if(el) el.value = ""; });
}

async function novoContrato(){
  conEditId = null;
  const lados = ["cliente","fornecedor"].filter(conPodeEditar);
  if(!lados.length) return;
  conLimparCampos();
  // lado inicial: o do toggle, se o cargo grava nele
  const natureza = _conLado === "receita" && lados.includes("cliente") ? "cliente"
    : _conLado === "despesa" && lados.includes("fornecedor") ? "fornecedor" : lados[lados.length - 1];
  const selNat = $("con-natureza");
  [...selNat.options].forEach(o => { o.hidden = !lados.includes(o.value); o.disabled = !lados.includes(o.value); });
  selNat.value = natureza;
  selNat.disabled = lados.length < 2;
  $("con-numero").value = await proximoNumeroContrato();
  $("con-categoria").value = natureza === "cliente" ? "empreitada" : "prestacao_servico";
  $("con-status").value = "em_elaboracao";
  $("con-renovacao").checked = false;
  $("con-aviso").value = 30;
  $("con-recorrencia").value = "unica";
  $("con-valor-rec").value = 0;
  $("con-dia-venc").value = "";
  $("con-valor").value = 0;
  await conPreencherDestinos(); // fase 56
  $("con-obra").value = ""; $("con-equip").value = ""; $("con-cat-custo").value = ""; $("con-gera-titulos").checked = true;
  abrirFichaConVisual({ numero: $("con-numero").value, natureza, status: "em_elaboracao", valor_total: 0, categoria: $("con-categoria").value });
}

async function abrirContrato(id){
  conEditId = id;
  const { data:c, error } = await sb.from("contratos").select("*").eq("id",id).single();
  if(conEditId !== id) return;   // fase 142: abriu outra ficha enquanto esta carregava
  if(error){ aviso("app-aviso","Erro ao abrir contrato: "+error.message,"erro"); return; }
  conLimparCampos();
  const selNat = $("con-natureza");
  [...selNat.options].forEach(o => { o.hidden = false; o.disabled = false; });
  selNat.value = c.natureza || "fornecedor";
  selNat.disabled = true;   // o lado não muda depois de salvo (policy de escrita e títulos dependem dele)
  $("con-numero").value = c.numero || "";
  $("con-fornecedor").value = c.fornecedor_id || "";
  $("con-cliente").value = c.cliente_id || "";
  $("con-categoria").value = c.categoria || "prestacao_servico";
  $("con-status").value = c.status || "em_elaboracao";
  $("con-descricao").value = c.descricao || "";
  $("con-responsavel").value = c.responsavel_id || "";
  $("con-assinatura").value = c.data_assinatura || "";
  $("con-inicio").value = c.data_inicio || "";
  $("con-fim").value = c.data_fim_prevista || "";
  $("con-renovacao").checked = c.renovacao_automatica === true;
  $("con-aviso").value = c.aviso_vencimento_dias != null ? c.aviso_vencimento_dias : 30;
  $("con-recorrencia").value = c.forma_recorrencia || "unica";
  $("con-valor-rec").value = c.valor_recorrente || 0;
  $("con-dia-venc").value = c.dia_vencimento || "";
  $("con-valor").value = c.valor_total || 0;
  $("con-indice").value = c.indice_reajuste || "";
  $("con-obs").value = c.observacoes || "";
  await conPreencherDestinos(); // fase 56: destino do custo e geração de títulos
  $("con-obra").value = c.obra_id || ""; $("con-equip").value = c.equipamento_id || "";
  $("con-cat-custo").value = c.categoria_custo || ""; $("con-gera-titulos").checked = c.gera_titulos !== false;
  abrirFichaConVisual(c);
}

let _conAtual = null; // registro completo do contrato aberto (usado pela assinatura)

function abrirFichaConVisual(c){
  _conAtual = c;
  $("con-painel").style.display = "none";
  $("con-ficha").style.display = "";
  conAplicarNatureza(c.natureza);
  conTravarCamposDaObra(c);

  // gravação conforme o lado e o cargo (fase 180a); o contrato ligado a obra só se exclui pela obra
  const podeEditar = conPodeEditar(c.natureza);
  $("btn-salvar-con").style.display = podeEditar ? "" : "none";
  $("con-ficha-mais").style.display = podeEditar && conEditId && !conObrasDe(c).length ? "" : "none";
  $("btn-excluir-con").style.display = conEditId ? "" : "none";

  $("con-ficha-numero").textContent = c.numero || "(novo)";
  $("con-ficha-natureza-chip").innerHTML = c.natureza ? tagLado(c) : "—";
  $("con-ficha-contraparte-chip").textContent = conContraparte(c) || "—";
  $("con-ficha-categoria-chip").textContent = CONTRATO_CATEGORIA[c.categoria] || "—";
  const obras = conObrasDe(c);
  $("con-ficha-obra-box").style.display = obras.length ? "" : "none";
  $("con-ficha-obra-chip").innerHTML = conObrasHTML(c);
  $("con-ficha-equip-box").style.display = c.equipamento_id ? "" : "none";
  $("con-ficha-equip-chip").textContent = c.equipamento_id ? (_conEquipMap[c.equipamento_id] || (typeof cmpEq === "function" && cmpEq(c.equipamento_id)) || "equipamento") : "—";
  $("con-ficha-valor-chip").textContent = brl(c.valor_total || 0);
  conCarregarTitulos(c.natureza === "fornecedor" ? (c.id || null) : null); // fase 56
  conCarregarParcelas(c.natureza === "cliente" ? c : null);                 // fase 180a
  conCarregarAditivos(c.id || null);                                        // fase 180a
  const dias = diasParaVencer(c);
  $("con-ficha-vigencia-chip").innerHTML = c.data_inicio || c.data_fim_prevista
    ? `${dataBR(c.data_inicio)}${c.data_fim_prevista ? " → " + dataBR(c.data_fim_prevista) : ""}${tagDias(c)}`
    : "—";
  $("con-ficha-titulo").textContent = conEditId ? `Contrato ${c.numero}` : "Novo contrato";

  const chipAssin = $("con-ficha-assinatura-chip");
  if(chipAssin) chipAssin.innerHTML = tagAssinatura(c.assinatura_status);

  atualizarStatusbarCon(c.status);
  ativarTabCon("geral");
  carregarDocumentosDoContrato(conEditId, { natureza: c.natureza === "cliente" ? "cliente" : "fornecedor" });
  renderBlocoAssinatura(conEditId ? c : null, "con-assinatura-bloco", {
    recarregar: () => abrirContrato(conEditId)
  });
}

function atualizarStatusbarCon(st){
  const bar = $("con-statusbar");
  if(!bar) return;
  const idxAtual = CON_STAGES.indexOf(st === "renovado" ? "vigente" : st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    const idx = CON_STAGES.indexOf(el.dataset.status);
    if(st === "rescindido" || st === "cancelado" || st === "vencido"){
      if(idx === CON_STAGES.length - 1) el.classList.add("cancelada");
    } else if(idx === idxAtual){
      el.classList.add("atual");
    } else if(idx >= 0 && idx < idxAtual){
      el.classList.add("passada");
    }
  });
}

function ativarTabCon(nome){
  document.querySelectorAll("#con-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#con-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Salvar / excluir ---------- */
async function salvarContrato(novoStatus){
  const natureza = conEditId ? (_conAtual?.natureza || "fornecedor") : $("con-natureza").value;
  if(!conPodeEditar(natureza)){ aviso("app-aviso","Seu cargo não grava contratos deste lado.","erro"); return; }
  const cli = natureza === "cliente";
  const travado = cli && !!conEditId && conObrasDe(_conAtual).length > 0;   // D7: campos que vêm da obra
  const cliente_id = $("con-cliente").value || null;
  const fornecedor_id = $("con-fornecedor").value || null;
  if(cli && !cliente_id && !travado){ aviso("app-aviso","Selecione o cliente.","erro"); ativarTabCon("geral"); return; }
  if(!cli && !fornecedor_id){ aviso("app-aviso","Selecione o fornecedor.","erro"); ativarTabCon("geral"); return; }
  if(!$("con-numero").value){ aviso("app-aviso","Informe o número.","erro"); ativarTabCon("geral"); return; }

  const reg = {
    numero: $("con-numero").value.trim(),
    natureza,
    categoria: $("con-categoria").value,
    status: novoStatus || $("con-status").value,
    descricao: $("con-descricao").value.trim() || null,
    data_assinatura: $("con-assinatura").value || null,
    renovacao_automatica: $("con-renovacao").checked,
    aviso_vencimento_dias: Number($("con-aviso").value || 0),
    indice_reajuste: $("con-indice").value.trim() || null,
    equipamento_id: $("con-equip").value || null,
    observacoes: $("con-obs").value.trim() || null
  };
  if(!travado){
    Object.assign(reg, {
      responsavel_id: $("con-responsavel").value || null,
      data_inicio: $("con-inicio").value || null,
      data_fim_prevista: $("con-fim").value || null,
      valor_total: Number($("con-valor").value || 0)
    });
  }
  if(cli){
    if(!travado) reg.cliente_id = cliente_id;
    reg.fornecedor_id = null;
    if(!conEditId) reg.orcamento_id = null;
  } else {
    const dia = $("con-dia-venc").value;
    Object.assign(reg, {
      cliente_id: null,
      fornecedor_id,
      orcamento_id: null,
      forma_recorrencia: $("con-recorrencia").value,
      valor_recorrente: Number($("con-valor-rec").value || 0),
      dia_vencimento: dia ? Number(dia) : null,
      // fase 56: destino do custo (aba Custos da obra/TAG) e geração dos títulos a pagar (gatilho no banco)
      obra_id: $("con-obra").value || null,
      categoria_custo: $("con-cat-custo").value || null,
      gera_titulos: $("con-gera-titulos").checked
    });
  }

  let result;
  if(conEditId){
    result = await sb.from("contratos").update(reg).eq("id", conEditId).select().single();
  } else {
    result = await sb.from("contratos").insert(reg).select().single();
  }
  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    if(m.includes("duplicate") || m.includes("unique")){
      aviso("app-aviso",`Já existe um contrato com o número ${reg.numero} (o número é único no sistema inteiro, incluindo os contratos de obra).`,"erro");
      ativarTabCon("geral");
    } else {
      aviso("app-aviso", ehErroDePermissao(result.error) ? "Seu cargo não grava este contrato." : "Não foi possível salvar: "+result.error.message,"erro");
    }
    return;
  }
  conEditId = result.data.id;
  if(typeof _cmpContratosForn !== "undefined") _cmpContratosForn = null; // fase 57: lista de contratos do recebimento
  aviso("app-aviso","Contrato salvo.","ok");
  await carregarContratos();
  await abrirContrato(conEditId);
}

async function excluirContrato(){
  if(!conEditId) return;
  if(_conAtual && conObrasDe(_conAtual).length && _conAtual.natureza === "cliente"){
    aviso("app-aviso","Contrato ligado a obra: o vínculo é desfeito na ficha da obra.","erro"); return;
  }
  if(!confirm("Excluir este contrato? Os anexos enviados também serão removidos.")) return;
  // Remove os arquivos do Storage antes (o delete em cascata só apaga os metadados)
  const { data: docs } = await sb.from("contratos_documentos")
    .select("storage_path").eq("contrato_id", conEditId);
  if(docs && docs.length){
    await sb.storage.from("contratos-docs").remove(docs.map(d => d.storage_path));
  }
  const { error } = await sb.from("contratos").delete().eq("id", conEditId);
  if(error){ aviso("app-aviso","Não foi possível excluir: "+error.message,"erro"); return; }
  aviso("app-aviso","Contrato excluído.","ok");
  await carregarContratos();
  mostrarPainelCon();
}

/* ====================================================================
   ABA DOCUMENTOS — anexos do contrato (bucket contratos-docs)

   Serve duas fichas: a do contrato de fornecedor (padrão) e a aba
   Contrato da obra, que passa outro container/prefixo em `opts`.
   ==================================================================== */
const CON_DOC_PADRAO = {
  container:  "con-doc-conteudo",
  prefixo:    "con-doc",
  smartBtn:   "sb-con-documentos",
  msgSemPai:  "Salve o contrato primeiro para anexar arquivos.",
  natureza:   "fornecedor",   // hotfix 98: a aba Contrato da obra passa "cliente" (OBR_CON_DOC_CONF em obras.js)
  aditivos:   false           // hotfix 98: a aba Contrato da obra lista os aditivos (só leitura)
};

/* Hotfix 98 (#98, 21/10/2026): quem anexa documento de contrato. Espelha as policies de contratos_documentos e do bucket
   contratos-docs: admin, financeiro e comercial em qualquer contrato (diretor por has_role); engenheiro e assistente de
   engenharia só no contrato de cliente (o contrato assinado e o aditivo chegam por eles, em campo). Excluir anexo e
   cadastrar aditivo (contrato_aditivos: valor e prazo) continuam com admin, financeiro e comercial. */
const CON_DOC_CARGOS_GESTAO = ["diretor", "admin", "financeiro", "comercial"];
const CON_DOC_CARGOS_ENGENHARIA = ["engenheiro", "assistente_engenharia"];
const CON_DOC_EXTENSOES = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];   // = allowed_mime_types do bucket contratos-docs
const CON_DOC_LIMITE_BYTES = 20971520;                                    // = file_size_limit do bucket (20 MB)
function conCargoAtual(){ return (usuarioAtual && !ehSomenteLeitura()) ? usuarioAtual.cargo : null; }
function conPodeAnexar(natureza){
  const c = conCargoAtual();
  return !!c && (CON_DOC_CARGOS_GESTAO.includes(c) || (natureza === "cliente" && CON_DOC_CARGOS_ENGENHARIA.includes(c)));
}
function conPodeExcluirAnexo(){ return CON_DOC_CARGOS_GESTAO.includes(conCargoAtual()); }
function conPodeCadastrarAditivo(){ return CON_DOC_CARGOS_GESTAO.includes(conCargoAtual()); }

/* Hotfix 98: aditivos do contrato de cliente, só leitura, na aba Contrato da obra. Quem lê é pode_ler_financeiro()
   (engenharia inclusive); erro de leitura some com o bloco. */
const ADITIVO_TIPO = {
  valor: "Valor", prazo: "Prazo", valor_prazo: "Valor e prazo", escopo: "Escopo", reajuste: "Reajuste",
  supressao: "Supressão", distrato: "Distrato", outro: "Outro"
};
async function conAditivosHTML(contratoId, comValorArg){
  const { data, error } = await sb.from("contrato_aditivos")
    .select("id,numero,ordem,tipo,descricao,valor_delta,prazo_dias,nova_data_fim,assinatura_status,data_assinatura")
    .eq("contrato_id", contratoId)
    .order("ordem");
  if(error) return "";
  // quem lê aditivo e não cadastra (engenheiro e assistente; o auditor só lê e não precisa do aviso)
  const avisoCargo = (conPodeCadastrarAditivo() || ehSomenteLeitura()) ? ""
    : `<p class="meta">Aditivo é cadastrado pelo financeiro ou comercial. Aqui você anexa o PDF assinado (tipo "Aditivo").</p>`;
  const comValor = comValorArg === undefined ? podeVerValorObra() : comValorArg;   // fase 180a: no módulo, quem lê contas a pagar também vê
  if(!data || !data.length){
    return `<div style="margin-bottom:14px;"><h4 class="sub-titulo">Aditivos cadastrados (0)</h4>${avisoCargo}
      <p class="vazio">Nenhum aditivo cadastrado neste contrato.</p></div>`;
  }
  const linhas = data.map(a => {
    const prazo = a.nova_data_fim ? "até " + dataBR(a.nova_data_fim) : (a.prazo_dias ? a.prazo_dias + " dias" : "—");
    return `<tr>
      <td>${esc(a.numero)}</td>
      <td>${esc(ADITIVO_TIPO[a.tipo] || a.tipo)}</td>
      <td>${esc(a.descricao || "—")}</td>
      ${comValor ? `<td class="num">${brl(a.valor_delta)}</td>` : ""}
      <td>${esc(prazo)}</td>
      <td>${tagAssinatura(a.assinatura_status)}${a.data_assinatura ? " " + dataBR(a.data_assinatura) : ""}</td>
    </tr>`;
  }).join("");
  return `<div style="margin-bottom:14px;"><h4 class="sub-titulo">Aditivos cadastrados (${data.length})</h4>${avisoCargo}
    <div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Tipo</th><th>Descrição</th>${comValor ? `<th class="num">Valor</th>` : ""}<th>Prazo</th><th>Assinatura</th></tr></thead>
      <tbody>${linhas}</tbody></table></div></div>`;
}

async function carregarDocumentosDoContrato(contratoId, opts){
  const conf = Object.assign({}, CON_DOC_PADRAO, opts || {});
  const cont = $(conf.container);
  if(!cont) return;
  const setSB = (n) => {
    const el = conf.smartBtn ? $(conf.smartBtn) : null;
    if(!el) return;
    el.querySelector(".sb-num").textContent = n || 0;
    el.classList.toggle("zero", !n);
  };

  if(!contratoId){
    cont.innerHTML = `<p class="vazio">${esc(conf.msgSemPai)}</p>`;
    setSB(0);
    return;
  }

  const [{ data, error }, aditivos] = await Promise.all([
    sb.from("contratos_documentos")
      .select("id,categoria,nome,descricao,storage_path,mime_type,tamanho_bytes,created_at")
      .eq("contrato_id", contratoId)
      .order("created_at", { ascending:false }),
    conf.aditivos ? conAditivosHTML(contratoId) : Promise.resolve("")
  ]);
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; setSB(0); return; }
  setSB((data||[]).length);

  const px   = conf.prefixo;
  const cats = Object.entries(CON_DOC_CATEGORIAS)
    .map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  // hotfix 98: quem não anexa vê a lista sem o formulário (antes o formulário aparecia e o envio falhava na RLS)
  const podeAnexar = conPodeAnexar(conf.natureza);
  const podeExcluir = conPodeExcluirAnexo();
  const uploader = !podeAnexar
    ? `<p class="meta" style="margin:0 0 10px;">${conf.natureza === "cliente"
        ? "Anexo de contrato: financeiro, comercial e engenharia."
        : "Anexo de contrato de fornecedor: financeiro e comercial."}</p>`
    : `
    <div class="card" style="margin-bottom:14px;padding:12px;">
      <h4 style="margin:0 0 8px;font-size:var(--txt-md);">📤 Anexar arquivo</h4>
      <div class="grade">
        <div class="campo"><label>Tipo</label>
          <select id="${esc(px)}-categoria">${cats}</select>
        </div>
        <div class="campo"><label>Descrição (opcional)</label>
          <input id="${esc(px)}-descricao" placeholder="ex.: 1º aditivo de prazo" />
        </div>
        <div class="campo largo"><label>Arquivo — PDF, DOC/DOCX, JPG ou PNG (máx. 20 MB)</label>
          <input id="${esc(px)}-arquivo" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
        </div>
      </div>
      <div class="form-acoes">
        <button type="button" class="btn" id="btn-${esc(px)}-enviar">Enviar</button>
      </div>
    </div>`;

  if(!data || !data.length){
    cont.innerHTML = `${/* html */ aditivos}${uploader}<p class="vazio">Nenhum arquivo anexado ainda.</p>`;
    $(`btn-${px}-enviar`)?.addEventListener("click", () => enviarDocumentoContrato(contratoId, conf));
    return;
  }

  const linhas = data.map(d => {
    const tamKB = d.tamanho_bytes ? (d.tamanho_bytes/1024).toFixed(0) + " KB" : "—";
    return `<tr>
      <td>📄 ${esc(d.nome)}</td>
      <td>${esc(CON_DOC_CATEGORIAS[d.categoria] || d.categoria)}</td>
      <td>${esc(d.descricao || "—")}</td>
      <td>${tamKB}</td>
      <td>${new Date(d.created_at).toLocaleDateString("pt-BR")}</td>
      <td class="col-acao">
        <button type="button" class="btn-sec btn-sm doc-con-baixar" data-path="${esc(d.storage_path)}" data-nome="${esc(d.nome)}" title="Baixar">Baixar</button>
        ${podeExcluir ? `<button type="button" class="btn-sec btn-sm doc-con-excluir txt-perigo" data-id="${esc(d.id)}" data-path="${esc(d.storage_path)}" title="Excluir">Excluir</button>` : ""}
      </td>
    </tr>`;
  }).join("");

  cont.innerHTML = `${/* html */ aditivos}${uploader}<div class="tabela-rola"><table>
    <thead><tr><th>Arquivo</th><th>Tipo</th><th>Descrição</th><th>Tamanho</th><th>Enviado em</th><th class="col-acao"></th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;

  $(`btn-${px}-enviar`)?.addEventListener("click", () => enviarDocumentoContrato(contratoId, conf));
  cont.querySelectorAll(".doc-con-baixar").forEach(b => {
    b.addEventListener("click", () => baixarDocumentoContrato(b.dataset.path, b.dataset.nome));
  });
  cont.querySelectorAll(".doc-con-excluir").forEach(b => {
    b.addEventListener("click", () => excluirDocumentoContrato(b.dataset.id, b.dataset.path, contratoId, conf));
  });
}

async function enviarDocumentoContrato(contratoId, opts){
  const conf = Object.assign({}, CON_DOC_PADRAO, opts || {});
  const px   = conf.prefixo;
  const inp  = $(`${px}-arquivo`);
  if(!inp?.files || !inp.files[0]){ aviso("app-aviso","Selecione um arquivo.","erro"); return; }
  const file = inp.files[0];
  // hotfix 98: extensão e tamanho conferidos antes do upload, iguais ao bucket (antes o bucket recusava sem explicar)
  const ext = extensaoArquivo(file);   // core.js: entra no caminho do storage
  if(!CON_DOC_EXTENSOES.includes(ext) || file.size > CON_DOC_LIMITE_BYTES){
    aviso("app-aviso","Só PDF, DOC/DOCX, JPG e PNG até 20 MB.","erro");
    return;
  }

  const btn = $(`btn-${px}-enviar`);
  btn.disabled = true;
  const txtOrig = btn.textContent;
  btn.textContent = "Enviando...";

  try {
    const nomeUnico = `${contratoId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    // hotfix 98: MIME pela extensão e corpo reembalado em Blob (supabase-js ignora contentType com File; PDF salvo pelo
    // Windows chegava como application/octet-stream, que o bucket não aceita)
    const mime = mimeDoArquivo(file, ext);
    const { error: errUp } = await sb.storage.from("contratos-docs").upload(nomeUnico, corpoComMime(file, mime), {
      cacheControl: "3600", contentType: mime, upsert: false
    });
    if(errUp) throw errUp;

    const { data:{ user } } = await sb.auth.getUser();
    const { error: errIns } = await sb.from("contratos_documentos").insert({
      contrato_id: contratoId,
      categoria: $(`${px}-categoria`).value,
      nome: file.name,
      descricao: $(`${px}-descricao`).value.trim() || null,
      storage_path: nomeUnico,
      mime_type: mime,
      tamanho_bytes: file.size,
      enviado_por: user ? user.id : null
    });
    if(errIns){
      // se falhar o metadado, remove o arquivo pra não deixar órfão (engenharia não remove do bucket: fica o arquivo
      // sem linha, que nenhuma tela mostra; só acontece se a policy da tabela recusar depois da do bucket aceitar)
      await sb.storage.from("contratos-docs").remove([nomeUnico]);
      throw errIns;
    }
    aviso("app-aviso","Arquivo anexado.","ok");
    await carregarDocumentosDoContrato(contratoId, conf);
  } catch(err){
    // hotfix 98: recusa de policy (tabela ou bucket) vira frase de cargo, não o texto cru do Postgres
    aviso("app-aviso", ehErroDePermissao(err) ? "Seu cargo não anexa documentos de contrato." : "Erro ao enviar: "+(err.message||err), "erro");
  } finally {
    btn.disabled = false;
    btn.textContent = txtOrig;
  }
}

async function baixarDocumentoContrato(path, nome){
  const { data, error } = await sb.storage.from("contratos-docs").createSignedUrl(path, 60);
  if(error){ aviso("app-aviso","Erro ao gerar URL: "+error.message,"erro"); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl;
  a.download = nome;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function excluirDocumentoContrato(id, path, contratoId, opts){
  if(!confirm("Excluir este anexo?")) return;
  // hotfix 98: a linha sai primeiro e só depois o arquivo. A RLS do delete não dá erro (apaga 0 linhas): sem a
  // conferência o aviso dizia "excluído" para quem não exclui.
  const { data: apagadas, error } = await sb.from("contratos_documentos").delete().eq("id", id).select("id");
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  if(!apagadas || !apagadas.length){ aviso("app-aviso","Seu cargo não exclui documentos de contrato.","erro"); return; }
  await sb.storage.from("contratos-docs").remove([path]);
  aviso("app-aviso","Anexo excluído.","ok");
  await carregarDocumentosDoContrato(contratoId, opts);
}

/* ====================================================================
   ASSINATURA ELETRÔNICA (D4Sign) — fase 22

   Plano básico: 10 requisições/hora. O custo de cada ação aparece na
   tela e a Edge Function bloqueia o que não couber na cota. O bloco
   serve duas fichas: contrato de fornecedor e aba Contrato da obra.
   ==================================================================== */
const ASSINATURA_META = {
  nao_iniciada: { label: "Não iniciada", cor: "cinza"    },
  enviada:      { label: "Aguardando",   cor: "ambar"    },
  parcial:      { label: "Parcial",      cor: "ambar"    },
  concluida:    { label: "Assinado",     cor: "verde"    },
  cancelada:    { label: "Cancelada",    cor: "vermelho" }
};

function tagAssinatura(st){
  const m = ASSINATURA_META[st] || ASSINATURA_META.nao_iniciada;
  // Glifo redundante à cor (daltônicos não distinguem verde/âmbar/vermelho)
  const glifo = { verde: "✓ ", ambar: "◔ ", vermelho: "✕ ", azul: "→ " }[m.cor] || "○ ";
  return `<span class="tag ${esc(m.cor)}">${esc(glifo)}${esc(m.label)}</span>`;
}

/* Alvo atual do modal: contrato + como recarregar a ficha de origem */
let _d4sAlvo = null;

async function cotaD4SignUsada(){
  const { data, error } = await sb.rpc("d4sign_cota_usada");
  return error ? null : data;
}

/* Bloco de status + ações, renderizado na aba Documentos do contrato
   e na aba Contrato da obra. `contrato` = registro completo ou null. */
function renderBlocoAssinatura(contrato, containerId, conf){
  const cont = $(containerId);
  if(!cont) return;
  if(!contrato || !contrato.id){
    cont.innerHTML = "";
    return;
  }
  const st = contrato.assinatura_status || "nao_iniciada";
  const signatarios = Array.isArray(contrato.assinatura_signatarios)
    ? contrato.assinatura_signatarios.map(s => s.email).join(", ") : "";

  let meio = "";
  if(st === "enviada" || st === "parcial"){
    meio = `<span class="meta">enviado em ${contrato.data_envio_assinatura
      ? new Date(contrato.data_envio_assinatura).toLocaleDateString("pt-BR") : "—"}${
      signatarios ? " para " + esc(signatarios) : ""}</span>`;
  } else if(st === "concluida" && contrato.arquivo_assinado_url){
    meio = `<button type="button" class="btn-sec btn-sm" id="btn-d4s-baixar-${esc(containerId)}">Baixar assinado</button>`;
  }

  let acoes = "";
  if(st === "nao_iniciada" || st === "cancelada"){
    acoes = `<button type="button" class="btn-sec btn-sm" id="btn-d4s-abrir-${esc(containerId)}">Enviar para assinatura</button>`;
  } else if(st === "enviada" || st === "parcial"){
    acoes = `<button type="button" class="btn-sec btn-sm" id="btn-d4s-status-${esc(containerId)}" title="Consulta manual — gasta 1 requisição da cota">Atualizar status</button>`;
  }

  cont.innerHTML = `<div class="assin-bloco">
    <strong>Assinatura eletrônica</strong>
    ${tagAssinatura(st)}
    ${/* html */ meio}
    <div class="assin-acoes">${/* html */ acoes}</div>
  </div>`;

  $(`btn-d4s-abrir-${containerId}`)?.addEventListener("click", () => abrirModalAssinatura(contrato, conf));
  $(`btn-d4s-status-${containerId}`)?.addEventListener("click", () => atualizarStatusAssinatura(contrato.id, conf));
  $(`btn-d4s-baixar-${containerId}`)?.addEventListener("click", () =>
    baixarDocumentoContrato(contrato.arquivo_assinado_url, `Contrato ${contrato.numero} — assinado.pdf`));
}

async function abrirModalAssinatura(contrato, conf){
  _d4sAlvo = { contrato, conf };

  // Anexos disponíveis do contrato
  const { data: docs } = await sb.from("contratos_documentos")
    .select("id,nome,categoria")
    .eq("contrato_id", contrato.id)
    .neq("categoria", "contrato_assinado")
    .order("created_at", { ascending: false });
  if(!docs || !docs.length){
    aviso("app-aviso", "Anexe primeiro o PDF do contrato (aba Documentos) para poder enviá-lo.", "erro");
    return;
  }
  $("d4s-documento").innerHTML = docs.map(d =>
    `<option value="${esc(d.id)}">${esc(d.nome)} (${esc(CON_DOC_CATEGORIAS[d.categoria] || d.categoria)})</option>`).join("");

  // Limpa signatários e sugere o e-mail da contraparte
  for(let i = 1; i <= 3; i++){ $(`d4s-nome-${i}`).value = ""; $(`d4s-email-${i}`).value = ""; }
  $("d4s-mensagem").value = "";
  try {
    if(contrato.fornecedor_id){
      const { data: f } = await sb.from("fornecedores")
        .select("razao_social,email").eq("id", contrato.fornecedor_id).single();
      if(f?.email){ $("d4s-email-1").value = f.email; $("d4s-nome-1").value = f.razao_social || ""; }
    } else if(contrato.cliente_id){
      const { data: c } = await sb.from("clientes")
        .select("nome,email").eq("id", contrato.cliente_id).single();
      if(c?.email){ $("d4s-email-1").value = c.email; $("d4s-nome-1").value = c.nome || ""; }
    }
  } catch(_e){ /* sugestão é cortesia; sem e-mail o usuário digita */ }

  const usada = await cotaD4SignUsada();
  $("d4s-cota-nota").textContent = usada === null
    ? "O envio usa 4 das 10 requisições/hora do plano D4Sign."
    : `O envio usa 4 requisições. Cota da última hora: ${usada}/10 usadas.`;

  $("d4s-modal").style.display = "flex";
}

function fecharModalAssinatura(){
  $("d4s-modal").style.display = "none";
  _d4sAlvo = null;
}

async function enviarAssinaturaD4S(){
  if(!_d4sAlvo) return;
  const signatarios = [];
  for(let i = 1; i <= 3; i++){
    const email = $(`d4s-email-${i}`).value.trim();
    if(email) signatarios.push({ email, nome: $(`d4s-nome-${i}`).value.trim() });
  }
  if(!signatarios.length){ aviso("app-aviso", "Informe ao menos um e-mail de signatário.", "erro"); return; }

  const btn = $("btn-d4s-enviar");
  btn.disabled = true;
  const txt = btn.textContent;
  btn.textContent = "Enviando...";
  try {
    const { data, error } = await sb.functions.invoke("d4sign-api", {
      body: {
        acao: "enviar",
        contrato_id: _d4sAlvo.contrato.id,
        documento_id: $("d4s-documento").value,
        signatarios,
        mensagem: $("d4s-mensagem").value.trim() || undefined
      }
    });
    // FunctionsHttpError: o corpo com a mensagem real vem em error.context
    if(error){
      let msg = error.message || "erro";
      try { const corpo = await error.context?.json(); if(corpo?.error) msg = corpo.error; } catch(_e){}
      aviso("app-aviso", "Envio não realizado: " + msg, "erro");
      return;
    }
    aviso("app-aviso", `✍️ Documento enviado para assinatura.${data?.aviso ? " " + data.aviso : ""}`, "ok");
    const conf = _d4sAlvo.conf;
    fecharModalAssinatura();
    if(conf?.recarregar) await conf.recarregar();
  } catch(e){
    aviso("app-aviso", "Erro ao enviar: " + (e.message || e), "erro");
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
}

async function atualizarStatusAssinatura(contratoId, conf){
  if(!confirm("Consultar o status na D4Sign agora? Isso usa 1 requisição da cota (o normal é o status chegar sozinho pelo webhook).")) return;
  const { data, error } = await sb.functions.invoke("d4sign-api", {
    body: { acao: "status", contrato_id: contratoId }
  });
  if(error){
    let msg = error.message || "erro";
    try { const corpo = await error.context?.json(); if(corpo?.error) msg = corpo.error; } catch(_e){}
    aviso("app-aviso", "Consulta falhou: " + msg, "erro");
    return;
  }
  const nome = data?.status_d4sign?.statusName || "?";
  aviso("app-aviso", `Status na D4Sign: ${nome}.${data?.arquivo_baixado ? " PDF assinado baixado para a aba Documentos." : ""}`, "ok");
  if(conf?.recarregar) await conf.recarregar();
}

/* ---------- Listeners ---------- */
/* ---------- Fase 56: destino do custo + títulos gerados pelo contrato ---------- */
let _conDestinosOk = false;
async function conPreencherDestinos(){
  if(_conDestinosOk) return;
  if(typeof cmpCarregarBase === "function") await cmpCarregarBase(false); // obras ativas, TAGs e categorias de custo (compras.js)
  const obra = $("con-obra"), eq = $("con-equip"), cat = $("con-cat-custo");
  if(obra) obra.innerHTML = `<option value="">— nenhuma —</option>` + (typeof _cmpObras === "object" ? _cmpObras : []).map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} — ${esc(o.nome)}</option>`).join("");
  if(eq)   eq.innerHTML   = `<option value="">— nenhuma —</option>` + (typeof _cmpEquips === "object" ? _cmpEquips : []).map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("");
  if(cat)  cat.innerHTML  = `<option value="">— pela categoria do contrato —</option>` + Object.entries(typeof CMP_CAT_LBL === "object" ? CMP_CAT_LBL : {}).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("");
  _conDestinosOk = true;
}

/* aba Títulos a pagar da ficha: o que o contrato gerou (mês corrente + 3 meses; o passado fica no Compor 90) */
async function conCarregarTitulos(id){
  const cont = $("con-titulos-conteudo"), sbt = $("sb-con-titulos");
  const setSb = n => { if(sbt){ sbt.querySelector(".sb-num").textContent = n || 0; sbt.classList.toggle("zero", !n); } };
  if(!cont) return;
  if(!id){ setSb(0); cont.innerHTML = `<p class="vazio">Salve o contrato. Com status <strong>Vigente</strong>, recorrência, valor da parcela e dia de vencimento preenchidos, os títulos a pagar são gerados sozinhos: do mês atual até 3 meses à frente.</p>`; return; }
  if(typeof podeVerContasPagar === "function" && !podeVerContasPagar()){ setSb(0); cont.innerHTML = `<p class="vazio">Seu perfil não vê os títulos a pagar.</p>`; return; }
  const { data, error } = await sb.from("titulos_pagar").select("*").eq("contrato_id", id).order("vencimento");
  if(conEditId !== id) return;
  const tits = data || [];
  setSb(tits.length);
  const hoje = hojeISO();
  const gerar = `<button type="button" class="btn-sec btn-sm" id="btn-con-gerar-titulos" title="Completa os títulos que faltam até 3 meses à frente (o sistema faz isso sozinho todo dia)">Gerar títulos agora</button>`;
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  if(!tits.length){
    cont.innerHTML = `<div class="lista-topo compacta"><span class="meta">Nenhum título gerado. Confira: status Vigente (ou Renovado), recorrência, valor da parcela (ou total, se única), dia de vencimento e a opção "gera títulos" na aba Financeiro. Títulos de meses anteriores ao atual não são gerados.</span>${gerar}</div>`;
  } else {
    cont.innerHTML = `<div class="lista-topo compacta"><span class="meta">Títulos deste contrato. A exportação ao Compor 90 é feita em Contas a pagar, visão "A pagar". Reajuste de valor ou troca de dia/obra/TAG refaz os que ainda não foram exportados.</span>${gerar}</div>
      <div class="tabela-rola"><table><thead><tr><th>Competência</th><th>Vencimento</th><th class="num">Valor</th><th>Obra</th><th>TAG</th><th>Exportado</th></tr></thead>
      <tbody>${tits.map(t => `<tr><td>${t.competencia ? esc(String(t.competencia).slice(5, 7)) + "/" + esc(String(t.competencia).slice(0, 4)) : "—"}</td><td class="${!t.exportado_em && t.vencimento < hoje ? "txt-perigo" : ""}"><strong>${dataBR(t.vencimento)}</strong></td><td class="num">${brl(t.valor)}</td>
        <td>${t.obra_id ? linkObra(t.obra_id, (typeof cmpObra === "function" && cmpObra(t.obra_id)) || "obra") : "—"}</td><td>${t.equipamento_id ? esc((typeof cmpEq === "function" && cmpEq(t.equipamento_id)) || "TAG") : "—"}</td>
        <td>${t.exportado_em ? `<span class="tag verde">${dataBR(String(t.exportado_em).slice(0, 10))}</span>` : '<span class="tag ambar">pendente</span>'}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="2"><strong>Total</strong></td><td class="num"><strong>${brl(tits.reduce((s, t) => s + Number(t.valor || 0), 0))}</strong></td><td colspan="3"></td></tr></tfoot></table></div>`;
  }
  $("btn-con-gerar-titulos")?.addEventListener("click", () => comBotaoTravado("btn-con-gerar-titulos", async () => {
    const { data: n, error: e } = await sb.rpc("contrato_gerar_titulos", { p_contrato: id, p_meses: 3 });
    if(e){ aviso("app-aviso", "Não foi possível gerar: " + e.message, "erro"); return; }
    aviso("app-aviso", n ? `${n} título(s) gerado(s).` : "Nada a gerar: os títulos do horizonte já existem ou o contrato não atende às condições.", n ? "ok" : "erro");
    conCarregarTitulos(id);
  }));
}

/* ---------- Fase 180a: Parcelas (Receita) e Aditivos ----------
   Parcelas do contrato de cliente = medições do contrato (medicoes.contrato_id) ou das obras ligadas a ele; cada
   medição é uma parcela a receber. Sem soma aqui: o total da carteira fica na Carteira e nas Medições. */
async function conCarregarParcelas(c){
  const cont = $("con-parcelas-conteudo"), sbp = $("sb-con-parcelas");
  const setSb = n => { if(sbp){ sbp.querySelector(".sb-num").textContent = n || 0; sbp.classList.toggle("zero", !n); } };
  if(!cont) return;
  if(!c || !c.id){ setSb(0); cont.innerHTML = uiVazio("Salve o contrato. As medições da obra ligada a ele aparecem aqui como parcelas a receber."); return; }
  const id = c.id;
  const obraIds = conObrasDe(c).map(o => o.id);
  let q = sb.from("medicoes").select("id,numero,obra_id,status,data_medicao,periodo_inicio,periodo_fim,valor_final,nf_numero,nf_vencimento,recebido_valor,recebida_em");
  q = obraIds.length ? q.or(`contrato_id.eq.${id},obra_id.in.(${obraIds.join(",")})`) : q.eq("contrato_id", id);
  const { data, error } = await q.order("data_medicao", { ascending: true }).limit(1000);
  if(conEditId !== id) return;
  if(error){ setSb(0); cont.innerHTML = uiVazio(ehErroDePermissao(error) ? "Seu perfil não vê as medições." : "Erro: " + error.message); return; }
  const meds = data || [];
  setSb(meds.length);
  if(!meds.length){ cont.innerHTML = uiVazio("Nenhuma medição neste contrato ainda."); return; }
  cont.innerHTML = `<p class="meta">Cada medição é uma parcela a receber. Clique para abrir a medição.</p>
    <div class="tabela-rola"><table><thead><tr><th>Medição</th><th>Obra</th><th>Período</th><th>Situação</th><th>NF</th><th>Vencimento</th><th class="num">Valor</th><th class="num">Recebido</th></tr></thead>
    <tbody>${meds.map(m => `<tr class="linha-clicavel" data-med="${esc(m.id)}">
      <td>${uiCodigo(m.numero || "—")}</td>
      <td>${m.obra_id ? linkObra(m.obra_id, (conObrasDe(c).find(o => o.id === m.obra_id) || {}).codigo) : "—"}</td>
      <td>${m.periodo_inicio || m.periodo_fim ? `${dataBR(m.periodo_inicio)} a ${dataBR(m.periodo_fim)}` : dataBR(m.data_medicao)}</td>
      <td>${tagStatus("medicao", m.status)}</td>
      <td>${esc(m.nf_numero || "—")}</td>
      <td>${dataBR(m.nf_vencimento)}</td>
      <td class="num">${brl(m.valor_final)}</td>
      <td class="num">${m.recebido_valor ? brl(m.recebido_valor) : "—"}</td>
    </tr>`).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr[data-med]").forEach(tr => tr.addEventListener("click", e => {
    if(e.target.closest("a")) return;
    if(irParaSecao("medicoes") && typeof abrirMedicao === "function") abrirMedicao(tr.dataset.med);
  }));
}

async function conCarregarAditivos(id){
  const cont = $("con-aditivos-conteudo"), sba = $("sb-con-aditivos");
  const setSb = n => { if(sba){ sba.querySelector(".sb-num").textContent = n || 0; sba.classList.toggle("zero", !n); } };
  if(!cont) return;
  if(!id){ setSb(0); cont.innerHTML = uiVazio("Salve o contrato para ver os aditivos."); return; }
  const { count, error } = await sb.from("contrato_aditivos").select("id", { count: "exact", head: true }).eq("contrato_id", id);
  if(conEditId !== id) return;
  if(error){ setSb(0); cont.innerHTML = uiVazio("Seu perfil não vê os aditivos deste contrato."); return; }
  setSb(count || 0);
  const html = await conAditivosHTML(id, podeVerValorObra() || podeVerContasPagar());
  if(conEditId !== id) return;
  cont.innerHTML = html || uiVazio("Seu perfil não vê os aditivos deste contrato.");
}

function ligarContratos(){
  $("btn-d4s-enviar")?.addEventListener("click", enviarAssinaturaD4S);
  $("btn-d4s-cancelar")?.addEventListener("click", fecharModalAssinatura);
  // fase 180a: lado (Receita | Despesa | Todos) e visão (Lista | Kanban)
  document.querySelectorAll("#con-lados [data-lado]").forEach(b => {
    b.addEventListener("click", () => { _conLado = b.dataset.lado; renderContratos(); });
  });
  document.querySelectorAll("#con-views [data-view]").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#con-views [data-view]").forEach(x => x.classList.toggle("ativo", x === b));
      _conView = b.dataset.view;
      renderContratos();
    });
  });
  ["con-busca","con-f-status","con-f-categoria","con-f-vencimento","con-f-contraparte","con-f-obra","con-f-equip"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "con-busca" ? "input" : "change", id === "con-busca" ? debounce(renderContratos) : renderContratos);
  });
  $("con-conteudo")?.addEventListener("click", (e) => {
    if(e.target.closest("a")) return;   // link da obra abre a obra
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirContrato(tr.dataset.id);
  });
  $("con-natureza")?.addEventListener("change", e => {
    if(conEditId) return;
    conAplicarNatureza(e.target.value);
    $("con-ficha-natureza-chip").innerHTML = tagLado({ natureza: e.target.value });
  });

  $("btn-novo-contrato")?.addEventListener("click", novoContrato);
  $("btn-voltar-con")?.addEventListener("click", mostrarPainelCon);
  $("btn-salvar-con")?.addEventListener("click", () => comBotaoTravado("btn-salvar-con", () => salvarContrato()));
  $("btn-excluir-con")?.addEventListener("click", excluirContrato);

  document.querySelectorAll("#con-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabCon(b.dataset.tab));
  });
  ["documentos","titulos","parcelas","aditivos"].forEach(t => $("sb-con-" + t)?.addEventListener("click", () => ativarTabCon(t)));

  document.querySelectorAll("#con-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!conEditId){
        $("con-status").value = novo;
        atualizarStatusbarCon(novo);
        return;
      }
      if(novo === $("con-status").value) return;
      if(!conPodeEditar(_conAtual?.natureza)) return;
      await salvarContrato(novo);
    });
  });

  const navCon = document.querySelector('nav button[data-secao="contratos"]');
  if(navCon) navCon.addEventListener("click", () => { mostrarPainelCon(); renderContratos(); });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarContratos);
} else {
  ligarContratos();
}

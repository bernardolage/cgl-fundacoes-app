/* ====================================================================
   Módulo: Movimentações de Ativos
   Layout: padrão Serviços (painel + ficha) + Odoo (statusbar, header
   actions, notebook tabs). Ver memória feedback-padrao-ui.
   Fluxo: rascunho → emitida (com NF-e) → em_trânsito → recebida.
   ==================================================================== */

let mapaEquipamentos = {};            // id -> equipamento
let _movRegistros    = [];            // cache da lista (para filtros client-side)
let _movView         = "lista";       // visão atual: lista | kanban
let movimentacaoAtual = null;         // edição em andamento
let itensAtuais      = [];            // linhas do grid

const MOV_TIPOS = {
  remessa: "Remessa",
  retorno: "Retorno",
  transferencia: "Transferência",
  conserto: "Conserto",
  emprestimo: "Empréstimo",
  venda: "Venda",
  setup_inicial: "Setup inicial"
};

const MOV_STATUS = {
  rascunho:    { label: "Rascunho",    cor: "cinza"    },
  emitida:     { label: "Emitida",     cor: "azul"     },
  em_transito: { label: "Em trânsito", cor: "ambar"    },
  recebida:    { label: "Recebida",    cor: "verde"    },
  cancelada:   { label: "Cancelada",   cor: "vermelho" }
};

/* Ordem das etapas no statusbar (cancelada é "fora do fluxo") */
const STATUSBAR_STAGES = ["rascunho","emitida","em_transito","recebida"];

const LOC_TIPOS = {
  base: "Base",
  obra: "Obra",
  fornecedor_manutencao: "Fornecedor / manutenção",
  cliente: "Cliente",
  em_transito: "Em trânsito"
};

const FRETE_POR_CONTA = {
  remetente:    "Remetente",
  destinatario: "Destinatário",
  terceiro:     "Terceiro",
  proprio:      "Próprio CGL",
  sem_frete:    "Sem frete"
};

/* ---------- Carga inicial ---------- */
async function carregarMovimentacoes(){
  await carregarEquipamentosSelect();
  await fetchMovimentacoes();
  renderMovimentacoes();
}

async function carregarEquipamentosSelect(){
  const { data } = await sb.from("equipamentos")
    .select("id,codigo,nome,tipo,localizacao_tipo")
    .eq("ativo", true).order("codigo");
  mapaEquipamentos = {};
  (data||[]).forEach(e => mapaEquipamentos[e.id] = e);
}

async function fetchMovimentacoes(){
  const { data, error } = await sb.from("movimentacoes_ativos")
    .select("id,numero,tipo,status,origem_tipo,origem_descricao,destino_tipo,destino_descricao,data_emissao,nf_numero,nf_chave_acesso,valor_total_produtos")
    .order("created_at", { ascending: false })
    .limit(500);
  _movRegistros = error ? [] : (data || []);
}

/* ---------- Filtros (client-side) ---------- */
function movFiltrados(){
  const termo = ($("mov-busca")?.value || "").trim().toLowerCase();
  const fStatus = $("mov-f-status")?.value || "";
  const fTipo   = $("mov-f-tipo")?.value || "";
  return _movRegistros.filter(m => {
    if(fStatus && m.status !== fStatus) return false;
    if(fTipo   && m.tipo !== fTipo)     return false;
    if(termo){
      const alvo = `${m.numero||""} ${m.nf_numero||""} ${m.origem_descricao||""} ${m.destino_descricao||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/* ---------- Despachante de visões ---------- */
function renderMovimentacoes(){
  const dados = movFiltrados();
  const cont = $("mov-contador");
  if(cont) cont.textContent = `${dados.length} de ${_movRegistros.length}`;
  if(_movView === "kanban") renderMovKanban(dados);
  else                      renderMovLista(dados);
}

/* ---------- Visão Lista ---------- */
function renderMovLista(dados){
  const cont = $("mov-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhuma movimentação encontrada.</p>`;
    return;
  }
  const linhas = dados.map(m => {
    const st = MOV_STATUS[m.status] || { label: m.status, cor: "cinza" };
    return `<tr class="linha-clicavel" data-id="${esc(m.id)}">
      <td>${esc(m.numero)}</td>
      <td>${esc(MOV_TIPOS[m.tipo] || m.tipo)}</td>
      <td>${esc(LOC_TIPOS[m.origem_tipo])}${m.origem_descricao ? " · " + esc(m.origem_descricao) : ""}</td>
      <td>${esc(LOC_TIPOS[m.destino_tipo])}${m.destino_descricao ? " · " + esc(m.destino_descricao) : ""}</td>
      <td>${dataBR(m.data_emissao)}</td>
      <td>${m.nf_numero ? esc(m.nf_numero) : "—"}</td>
      <td class="num">${brl(m.valor_total_produtos)}</td>
      <td><span class="tag ${st.cor}">${esc(st.label)}</span></td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Número</th><th>Tipo</th><th>Origem</th><th>Destino</th>
      <th>Emissão</th><th>NF</th><th class="num">Total</th><th>Status</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

/* ---------- Visão Kanban (colunas = status) ---------- */
function renderMovKanban(dados){
  const cont = $("mov-conteudo");
  if(!cont) return;
  const colunas = STATUSBAR_STAGES.concat(["cancelada"]).map(st => {
    const itens = dados.filter(m => m.status === st);
    if(!itens.length && st === "cancelada") return "";
    const stMeta = MOV_STATUS[st];
    const cards = itens.map(m => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(m.id)}">
        <div class="serv-kan-card-nome">${esc(m.numero)} · ${esc(MOV_TIPOS[m.tipo]||m.tipo)}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">→ ${esc(m.destino_descricao || LOC_TIPOS[m.destino_tipo])}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${m.nf_numero ? "NF " + esc(m.nf_numero) : dataBR(m.data_emissao)}</span>
          <strong>${brl(m.valor_total_produtos)}</strong>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  habilitarDragKanban({
    container: "#mov-conteudo .serv-kanban",
    tabela: "movimentacoes_ativos",
    onUpdate: async () => { await carregarMovimentacoes(); }
  });
}

/* ---------- Ficha (nova / editar) ---------- */
function novaMovimentacao(){
  movimentacaoAtual = {
    tipo: "remessa",
    status: "rascunho",
    origem_tipo: "base",
    origem_descricao: "Base Itabira",
    origem_uf: "mg",
    destino_tipo: "obra",
    destino_descricao: "",
    destino_uf: null,
    data_emissao: hojeISO(),
    frete_por_conta: "proprio"
  };
  itensAtuais = [];
  mostrarFichaMovimentacao();
}

async function abrirMovimentacao(id){
  const { data: m, error } = await sb.from("movimentacoes_ativos")
    .select("*").eq("id", id).single();
  if(error){ aviso("app-aviso","Erro ao abrir movimentação: "+error.message, "erro"); return; }
  const { data: itens, error: errItens } = await sb.from("movimentacao_itens")
    .select("*").eq("movimentacao_id", id).order("created_at");
  // Itens não carregaram → não abrir: salvar faz delete+insert e reinseriria vazio.
  if(errItens){
    aviso("app-aviso","Não foi possível carregar os itens da movimentação ("+errItens.message+"). Tente abrir de novo.","erro");
    return;
  }
  movimentacaoAtual = m;
  itensAtuais = itens || [];
  mostrarFichaMovimentacao();
}

function voltarParaLista(){
  movimentacaoAtual = null;
  itensAtuais = [];
  $("mov-painel").style.display = "";
  $("mov-ficha").style.display = "none";
}

function mostrarFichaMovimentacao(){
  $("mov-painel").style.display = "none";
  $("mov-ficha").style.display = "";

  const m = movimentacaoAtual;

  // Form fields
  $("mov-tipo").value = m.tipo;
  $("mov-origem-tipo").value = m.origem_tipo || "base";
  $("mov-origem-descricao").value = m.origem_descricao || "";
  $("mov-origem-uf").value = m.origem_uf || "";
  $("mov-destino-tipo").value = m.destino_tipo || "obra";
  $("mov-destino-descricao").value = m.destino_descricao || "";
  $("mov-destino-uf").value = m.destino_uf || "";
  $("mov-data-emissao").value = m.data_emissao || hojeISO();
  $("mov-data-saida").value = m.data_saida || "";
  $("mov-data-recebimento").value = m.data_recebimento || "";
  $("mov-frete").value = m.frete_por_conta || "proprio";
  $("mov-transp-nome").value = m.transp_nome || "";
  $("mov-transp-cnpj").value = m.transp_cnpj || "";
  $("mov-transp-placa").value = m.transp_placa || m.placa_veiculo || "";
  $("mov-motorista").value = m.motorista || "";
  $("mov-nf-numero").value = m.nf_numero || "";
  $("mov-nf-serie").value = m.nf_serie || "1";
  $("mov-nf-chave").value = m.nf_chave_acesso || "";
  $("mov-nf-protocolo").value = m.nf_protocolo || "";
  $("mov-cfop").value = m.cfop || "";
  $("mov-natureza").value = m.natureza_operacao || "";
  $("mov-peso-bruto").value = m.peso_bruto_kg || "";
  $("mov-peso-liquido").value = m.peso_liquido_kg || "";
  $("mov-valor-produtos").value = m.valor_total_produtos || 0;
  $("mov-info-complementar").value = m.info_complementar || "";
  $("mov-observacoes").value = m.observacoes || "";

  toggleTransportadorVisivel();
  popularSelectEquipamentos();
  renderizarItens();
  atualizarStatusbar();
  atualizarChipsContexto();
  atualizarBotoesAcao();
  // sempre abre na primeira aba
  ativarTab("cabecalho");
}

function toggleTransportadorVisivel(){
  const tipo = $("mov-frete").value;
  $("bloco-transportador").style.display = (tipo === "terceiro") ? "" : "none";
}

/* ---------- Statusbar + chips ---------- */
function atualizarStatusbar(){
  const sb = $("mov-statusbar");
  if(!sb) return;
  const st = movimentacaoAtual.status;
  const idxAtual = STATUSBAR_STAGES.indexOf(st);
  sb.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    const idx = STATUSBAR_STAGES.indexOf(el.dataset.status);
    if(st === "cancelada"){
      // tudo cinza, último marcado vermelho
      if(idx === STATUSBAR_STAGES.length - 1) el.classList.add("cancelada");
    } else if(idx === idxAtual){
      el.classList.add("atual");
    } else if(idx < idxAtual){
      el.classList.add("passada");
    }
  });
}

function atualizarChipsContexto(){
  const m = movimentacaoAtual;
  $("mov-ficha-numero").textContent = m.numero || "(novo)";
  $("mov-ficha-tipo-chip").textContent = MOV_TIPOS[m.tipo] || m.tipo || "—";
  $("mov-ficha-origem-chip").textContent = m.origem_descricao || LOC_TIPOS[m.origem_tipo] || "—";
  $("mov-ficha-destino-chip").textContent = m.destino_descricao || LOC_TIPOS[m.destino_tipo] || "—";
  $("mov-ficha-nf-chip").textContent = m.nf_numero ? `${m.nf_numero}/${m.nf_serie || "1"}` : "—";
  $("mov-ficha-total-chip").textContent = brl(m.valor_total_produtos || 0);
}

/* ---------- Notebook (abas internas) ---------- */
function ativarTab(nome){
  document.querySelectorAll("#mov-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll(".odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Grid de itens ---------- */
function renderizarItens(){
  const tb = $("mov-itens");
  if(!itensAtuais.length){
    tb.innerHTML = `<tr><td colspan="6" class="vazio">Adicione equipamentos ou produtos abaixo.</td></tr>`;
    atualizarTotal();
    return;
  }
  tb.innerHTML = itensAtuais.map((it, idx) => `
    <tr>
      <td>${it.equipamento_id ? "🔧" : "📦"} ${esc(it.descricao)}</td>
      <td><input type="number" step="0.001" min="0" value="${esc(it.quantidade)}" data-idx="${idx}" data-field="quantidade" class="item-input" style="width:80px;text-align:right;" /></td>
      <td>${esc(it.unidade)}</td>
      <td><input type="number" step="0.01" min="0" value="${esc(it.valor_unitario || 0)}" data-idx="${idx}" data-field="valor_unitario" class="item-input" style="width:110px;text-align:right;" /></td>
      <td class="num">${brl((it.quantidade||0) * (it.valor_unitario||0))}</td>
      <td><button type="button" class="btn-sec btn-sm btn-remove-item" data-idx="${idx}">×</button></td>
    </tr>
  `).join("");

  tb.querySelectorAll(".item-input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      itensAtuais[idx][field] = Number(e.target.value || 0);
      atualizarTotal();
      const linha = e.target.closest("tr");
      const it = itensAtuais[idx];
      linha.querySelector(".num").textContent = brl((it.quantidade||0) * (it.valor_unitario||0));
    });
  });
  tb.querySelectorAll(".btn-remove-item").forEach(b => {
    b.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.idx);
      itensAtuais.splice(idx, 1);
      renderizarItens();
    });
  });
  atualizarTotal();
}

function atualizarTotal(){
  const total = itensAtuais.reduce((s,i) => s + (i.quantidade||0) * (i.valor_unitario||0), 0);
  $("mov-valor-produtos").value = total.toFixed(2);
  // atualiza chip também
  const chip = $("mov-ficha-total-chip");
  if(chip) chip.textContent = brl(total);
}

/* ---------- Adicionar equipamento ---------- */
function popularSelectEquipamentos(){
  const sel = $("mov-add-equip");
  if(!sel) return;
  const lista = Object.values(mapaEquipamentos);
  preencherSelect(sel, lista.map(e => ({
    id: e.id,
    txt: `${e.codigo} — ${e.nome} (${e.localizacao_tipo})`
  })), "id", "txt", "— escolha um equipamento —");
}

function adicionarEquipamento(){
  const sel = $("mov-add-equip");
  const id = sel.value;
  if(!id){ aviso("app-aviso","Escolha um equipamento.", "erro"); return; }
  const eq = mapaEquipamentos[id];
  if(itensAtuais.some(i => i.equipamento_id === id)){
    aviso("app-aviso","Esse equipamento já está na lista.", "erro");
    return;
  }
  itensAtuais.push({
    equipamento_id: id,
    produto_id: null,
    descricao: `${eq.codigo} — ${eq.nome}`,
    quantidade: 1,
    unidade: "un",
    valor_unitario: 0
  });
  sel.value = "";
  renderizarItens();
}

/* ---------- Buscar produto ---------- */
async function buscarProdutos(termo){
  if(!termo || termo.length < 2) return [];
  const { data } = await sb.from("produtos")
    .select("id,codigo,nome,unidade,custo_ultimo")
    .ilike("nome", "%"+termo+"%")
    .limit(20);
  return data || [];
}

let buscaProdTimeout = null;
function configurarBuscaProdutos(){
  const inp = $("mov-busca-produto");
  const lista = $("mov-resultados-produto");
  if(!inp) return;

  inp.addEventListener("input", () => {
    clearTimeout(buscaProdTimeout);
    buscaProdTimeout = setTimeout(async () => {
      const termo = inp.value.trim();
      if(!termo || termo.length < 2){
        lista.innerHTML = "";
        lista.style.display = "none";
        return;
      }
      const resultados = await buscarProdutos(termo);
      if(!resultados.length){
        lista.innerHTML = `<div class="resultado-item vazio">Nenhum produto encontrado.</div>`;
      } else {
        lista.innerHTML = resultados.map(p => `
          <div class="resultado-item" data-id="${esc(p.id)}" data-nome="${esc(p.nome)}" data-unid="${esc(p.unidade)}" data-custo="${esc(p.custo_ultimo)}">
            <strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <em>(${esc(p.unidade)})</em>
          </div>
        `).join("");
        lista.querySelectorAll(".resultado-item").forEach(div => {
          if(!div.dataset.id) return;
          div.addEventListener("click", () => {
            itensAtuais.push({
              equipamento_id: null,
              produto_id: div.dataset.id,
              descricao: div.dataset.nome,
              quantidade: 1,
              unidade: div.dataset.unid,
              valor_unitario: Number(div.dataset.custo || 0)
            });
            inp.value = "";
            lista.innerHTML = "";
            lista.style.display = "none";
            renderizarItens();
          });
        });
      }
      lista.style.display = "";
    }, 250);
  });
}

/* ---------- Botões de ação contextuais ---------- */
function atualizarBotoesAcao(){
  const st = movimentacaoAtual.status;
  $("btn-salvar-rascunho").style.display   = (st !== "recebida" && st !== "cancelada") ? "" : "none";
  $("btn-marcar-emitida").style.display    = (st === "rascunho") ? "" : "none";
  $("btn-marcar-transito").style.display   = (st === "emitida")  ? "" : "none";
  $("btn-marcar-recebida").style.display   = (st === "emitida" || st === "em_transito") ? "" : "none";
  $("btn-cancelar").style.display          = (st !== "cancelada" && st !== "recebida")  ? "" : "none";
  $("btn-dados-uninfe").style.display      = (st !== "cancelada") ? "" : "none";
  $("btn-recomenda-mdf").style.display     = (st === "emitida" || st === "em_transito") ? "" : "none";
  $("btn-sugerir-fiscais").style.display   = (st === "rascunho" || st === "emitida")    ? "" : "none";
}

/* ---------- Coletar dados do form ---------- */
function coletarDadosForm(){
  return {
    tipo: $("mov-tipo").value,
    origem_tipo: $("mov-origem-tipo").value,
    origem_descricao: $("mov-origem-descricao").value.trim() || null,
    origem_uf: $("mov-origem-uf").value || null,
    destino_tipo: $("mov-destino-tipo").value,
    destino_descricao: $("mov-destino-descricao").value.trim() || null,
    destino_uf: $("mov-destino-uf").value || null,
    data_emissao: $("mov-data-emissao").value || hojeISO(),
    data_saida: $("mov-data-saida").value || null,
    data_recebimento: $("mov-data-recebimento").value || null,
    frete_por_conta: $("mov-frete").value,
    transp_nome: $("mov-transp-nome").value.trim() || null,
    transp_cnpj: $("mov-transp-cnpj").value.trim() || null,
    transp_placa: $("mov-transp-placa").value.trim() || null,
    motorista: $("mov-motorista").value.trim() || null,
    nf_numero: $("mov-nf-numero").value.trim() || null,
    nf_serie: $("mov-nf-serie").value.trim() || "1",
    nf_chave_acesso: ($("mov-nf-chave").value.trim().replace(/\s/g,"")) || null,
    nf_protocolo: $("mov-nf-protocolo").value.trim() || null,
    cfop: $("mov-cfop").value.trim() || null,
    natureza_operacao: $("mov-natureza").value.trim() || null,
    peso_bruto_kg: Number($("mov-peso-bruto").value) || null,
    peso_liquido_kg: Number($("mov-peso-liquido").value) || null,
    valor_total_produtos: Number($("mov-valor-produtos").value) || 0,
    info_complementar: $("mov-info-complementar").value.trim() || null,
    observacoes: $("mov-observacoes").value.trim() || null
  };
}

/* ---------- Salvar (cabeçalho + itens) ---------- */
async function salvarMovimentacao(novoStatus){
  if(!itensAtuais.length){
    aviso("app-aviso","Adicione pelo menos um item.", "erro");
    ativarTab("itens");
    return null;
  }
  const dados = coletarDadosForm();
  if(novoStatus) dados.status = novoStatus;

  let movId = movimentacaoAtual.id;

  if(!movId){
    const { data: numData, error: numErr } = await sb.rpc("proximo_numero_movimentacao");
    if(numErr){ aviso("app-aviso","Erro gerando número: "+numErr.message, "erro"); return null; }
    dados.numero = numData;
    const { data: ins, error: insErr } = await sb.from("movimentacoes_ativos").insert(dados).select().single();
    if(insErr){ aviso("app-aviso","Erro ao salvar: "+insErr.message, "erro"); return null; }
    movId = ins.id;
    movimentacaoAtual = ins;
  } else {
    const { data: upd, error: updErr } = await sb.from("movimentacoes_ativos").update(dados).eq("id", movId).select().single();
    if(updErr){ aviso("app-aviso","Erro ao atualizar: "+updErr.message, "erro"); return null; }
    movimentacaoAtual = upd;
  }

  const { error: errDelItens } = await sb.from("movimentacao_itens").delete().eq("movimentacao_id", movId);
  if(errDelItens){ aviso("app-aviso","Erro ao substituir os itens: "+errDelItens.message+". Nada foi reinserido — tente salvar de novo.","erro"); return; }
  const itensInsert = itensAtuais.map(it => ({
    movimentacao_id: movId,
    equipamento_id: it.equipamento_id || null,
    produto_id: it.produto_id || null,
    descricao: it.descricao,
    quantidade: it.quantidade,
    unidade: it.unidade,
    valor_unitario: it.valor_unitario || 0,
    numero_serie: it.numero_serie || null,
    chassi: it.chassi || null,
    ncm: it.ncm || null,
    cst: it.cst || null,
    cfop_item: it.cfop_item || null
  }));
  const { error: itErr } = await sb.from("movimentacao_itens").insert(itensInsert);
  if(itErr){ aviso("app-aviso","Erro ao salvar itens: "+itErr.message, "erro"); return null; }

  aviso("app-aviso","Movimentação salva com sucesso.", "ok");
  await fetchMovimentacoes();
  renderMovimentacoes();
  await carregarEquipamentosSelect();
  await abrirMovimentacao(movId);
  return movId;
}

/* ---------- Sugerir CFOP/natureza ---------- */
async function sugerirDadosFiscais(){
  if(!movimentacaoAtual.id){
    aviso("app-aviso","Salve o rascunho primeiro pra sugerir CFOP.", "erro");
    return;
  }
  const { data, error } = await sb.rpc("sugerir_dados_fiscais", { p_movimentacao_id: movimentacaoAtual.id });
  if(error){ aviso("app-aviso","Erro: "+error.message, "erro"); return; }
  if(data && data.length){
    const s = data[0];
    $("mov-cfop").value = s.cfop;
    $("mov-natureza").value = s.natureza_operacao;
    ativarTab("fiscal");
    if(s.observacao) aviso("app-aviso", s.observacao, "ok");
    else aviso("app-aviso","CFOP e natureza sugeridos.", "ok");
  }
}

/* ---------- Painel "Dados pra UniNFe" ---------- */
function gerarBlocoUniNFe(){
  const m = movimentacaoAtual;
  const itens = itensAtuais;
  const linhas = [];
  linhas.push(`=== DADOS PARA EMISSÃO NO UNINFE (NF-e Modelo 55) ===`);
  linhas.push(``);
  linhas.push(`Natureza da operação: ${m.natureza_operacao || "(definir)"}`);
  linhas.push(`CFOP: ${m.cfop || "(definir)"}`);
  linhas.push(`Série: ${m.nf_serie || "1"}`);
  linhas.push(``);
  linhas.push(`DESTINATÁRIO`);
  linhas.push(`Tipo: ${LOC_TIPOS[m.destino_tipo]}`);
  linhas.push(`Descrição: ${m.destino_descricao || "—"}`);
  linhas.push(`UF: ${(m.destino_uf||"").toUpperCase()}`);
  linhas.push(``);
  linhas.push(`TRANSPORTADOR`);
  linhas.push(`Frete por conta: ${FRETE_POR_CONTA[m.frete_por_conta]}`);
  if(m.frete_por_conta === "terceiro"){
    linhas.push(`Nome: ${m.transp_nome || "—"}`);
    linhas.push(`CNPJ: ${m.transp_cnpj || "—"}`);
  }
  linhas.push(`Placa: ${m.transp_placa || "—"}`);
  linhas.push(`Motorista: ${m.motorista || "—"}`);
  linhas.push(``);
  linhas.push(`ITENS`);
  itens.forEach((it,i) => {
    linhas.push(`${i+1}. ${it.descricao}`);
    linhas.push(`   Qtd: ${it.quantidade} ${it.unidade} | Valor unit: R$ ${Number(it.valor_unitario).toFixed(2)} | Total: R$ ${((it.quantidade||0)*(it.valor_unitario||0)).toFixed(2)}`);
    if(it.ncm) linhas.push(`   NCM: ${it.ncm}`);
    if(it.numero_serie) linhas.push(`   Série: ${it.numero_serie}`);
    if(it.chassi) linhas.push(`   Chassi: ${it.chassi}`);
  });
  linhas.push(``);
  linhas.push(`TOTAIS`);
  linhas.push(`Valor produtos: R$ ${Number(m.valor_total_produtos||0).toFixed(2)}`);
  if(m.peso_bruto_kg)   linhas.push(`Peso bruto: ${m.peso_bruto_kg} kg`);
  if(m.peso_liquido_kg) linhas.push(`Peso líquido: ${m.peso_liquido_kg} kg`);
  linhas.push(``);
  linhas.push(`INFORMAÇÃO COMPLEMENTAR`);
  const origemTxt = `${(m.origem_descricao||LOC_TIPOS[m.origem_tipo])}/${(m.origem_uf||"").toUpperCase()}`;
  const destinoTxt = `${(m.destino_descricao||LOC_TIPOS[m.destino_tipo])}/${(m.destino_uf||"").toUpperCase()}`;
  const tipoOpStr = m.tipo === "remessa" ? "MOBILIZACAO" : m.tipo === "retorno" ? "DESMOBILIZACAO" : m.tipo.toUpperCase();
  const infoPadrao = `SAIDA:${origemTxt} DESTINO:${destinoTxt} ${tipoOpStr}`;
  linhas.push(m.info_complementar || infoPadrao);
  return linhas.join("\n");
}

function mostrarDadosUniNFe(){
  if(!movimentacaoAtual.id){
    aviso("app-aviso","Salve o rascunho primeiro.", "erro");
    return;
  }
  $("mov-uninfe-conteudo").textContent = gerarBlocoUniNFe();
  $("mov-uninfe-modal").style.display = "flex";
}

function copiarUniNFe(){
  const txt = $("mov-uninfe-conteudo").textContent;
  navigator.clipboard.writeText(txt).then(()=>{
    aviso("app-aviso","Copiado pra área de transferência.", "ok");
  });
}

/* ---------- Recomendação de MDF ---------- */
async function verificarMDFRecomendado(){
  if(!movimentacaoAtual.id) return;
  const { data, error } = await sb.rpc("recomenda_mdfe", { p_movimentacao_id: movimentacaoAtual.id });
  if(error) return;
  if(data === true){
    aviso("app-aviso","💡 MDF-e recomendado: frete próprio + UF de destino diferente da origem. Considere agrupar essa NF num manifesto.", "ok");
  } else {
    aviso("app-aviso","MDF-e não é obrigatório nessa movimentação.", "ok");
  }
}

/* ---------- Statusbar clicável (avança/recua status) ---------- */
function ligarStatusbarClicavel(){
  document.querySelectorAll("#mov-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!movimentacaoAtual.id){
        aviso("app-aviso","Salve o rascunho primeiro.","erro");
        return;
      }
      if(novo === movimentacaoAtual.status) return;
      // confirmações sensíveis
      if(novo === "emitida" && !$("mov-nf-numero").value){
        aviso("app-aviso","Informe o número da NF-e antes de marcar como emitida.","erro");
        ativarTab("fiscal");
        return;
      }
      if(novo === "recebida"){
        if(!confirm("Marcar como RECEBIDA? Isso atualiza a localização dos equipamentos automaticamente.")) return;
      }
      await salvarMovimentacao(novo);
    });
  });
}

/* ---------- Listeners ---------- */
function ligarFichaMovimentacao(){
  // Painel: visões + filtros + nova + clique nas linhas
  document.querySelectorAll("#mov-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#mov-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _movView = b.dataset.view;
      renderMovimentacoes();
    });
  });
  ["mov-busca","mov-f-status","mov-f-tipo"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "mov-busca" ? "input" : "change", id === "mov-busca" ? debounce(renderMovimentacoes) : renderMovimentacoes);
  });
  $("mov-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirMovimentacao(tr.dataset.id);
  });

  // Ficha — header actions
  $("btn-nova-movimentacao")?.addEventListener("click", novaMovimentacao);
  $("btn-voltar-mov")?.addEventListener("click", voltarParaLista);
  $("mov-frete")?.addEventListener("change", toggleTransportadorVisivel);
  $("btn-add-equipamento")?.addEventListener("click", adicionarEquipamento);

  $("btn-salvar-rascunho")?.addEventListener("click", () => salvarMovimentacao(movimentacaoAtual?.status || "rascunho"));
  $("btn-marcar-emitida")?.addEventListener("click", async () => {
    if(!$("mov-nf-numero").value){
      aviso("app-aviso","Informe o número da NF-e antes de marcar como emitida.","erro");
      ativarTab("fiscal");
      return;
    }
    await salvarMovimentacao("emitida");
  });
  $("btn-marcar-transito")?.addEventListener("click", () => salvarMovimentacao("em_transito"));
  $("btn-marcar-recebida")?.addEventListener("click", async () => {
    if(!confirm("Marcar como RECEBIDA? Isso atualiza a localização dos equipamentos automaticamente.")) return;
    await salvarMovimentacao("recebida");
  });
  $("btn-cancelar")?.addEventListener("click", async () => {
    if(!confirm("Cancelar esta movimentação?")) return;
    await salvarMovimentacao("cancelada");
  });

  $("btn-sugerir-fiscais")?.addEventListener("click", sugerirDadosFiscais);
  $("btn-dados-uninfe")?.addEventListener("click", mostrarDadosUniNFe);
  $("btn-fechar-uninfe")?.addEventListener("click", () => { $("mov-uninfe-modal").style.display = "none"; });
  $("btn-copiar-uninfe")?.addEventListener("click", copiarUniNFe);
  $("btn-recomenda-mdf")?.addEventListener("click", verificarMDFRecomendado);

  // Notebook (abas internas)
  document.querySelectorAll("#mov-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTab(b.dataset.tab));
  });

  ligarStatusbarClicavel();
  configurarBuscaProdutos();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarFichaMovimentacao);
} else {
  ligarFichaMovimentacao();
}

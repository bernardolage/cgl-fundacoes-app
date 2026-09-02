/* ====================================================================
   Módulo: Clientes
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   CRUD sem statusbar (cliente é ativo/inativo via checkbox).
   ==================================================================== */

let _clientes = [];
let _cliView  = "lista";
let cliEditId = null;

/* ---------- Carga ---------- */
async function carregarClientes(){
  const { data, error } = await sb.from("clientes")
    .select("id,nome,nome_fantasia,cpf_cnpj,tipo_pessoa,cidade,uf,telefone,email,ativo")
    .order("nome");
  _clientes = error ? [] : (data || []);
  renderClientes();
}

/* ---------- Filtros ---------- */
function cliFiltrados(){
  const termo = ($("cli-busca")?.value || "").trim().toLowerCase();
  const fTipo = $("cli-f-tipo")?.value || "";
  const fAtivo = $("cli-f-ativo")?.value || "";
  return _clientes.filter(c => {
    if(fTipo && c.tipo_pessoa !== fTipo) return false;
    if(fAtivo === "ativos" && c.ativo === false) return false;
    if(fAtivo === "inativos" && c.ativo !== false) return false;
    if(termo){
      const alvo = `${c.nome||""} ${c.nome_fantasia||""} ${c.cpf_cnpj||""} ${c.cidade||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/* ---------- Render ---------- */
function renderClientes(){
  const dados = cliFiltrados();
  const cont = $("cli-contador");
  if(cont) cont.textContent = `${dados.length} de ${_clientes.length}`;
  if(_cliView === "kanban") renderCliKanban(dados);
  else                       renderCliLista(dados);
  const legacy = $("tab-clientes");
  if(legacy) legacy.innerHTML = "";
}

function renderCliLista(dados){
  const cont = $("cli-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum cliente encontrado.</p>`;
    return;
  }
  const linhas = dados.map(c => `<tr class="linha-clicavel" data-id="${esc(c.id)}">
    <td>${esc(c.nome)} ${tagSituacao(c.ativo)}</td>
    <td>${esc(c.cpf_cnpj||"—")}</td>
    <td>${esc(c.tipo_pessoa === "fisica" ? "Pessoa Física" : "Pessoa Jurídica")}</td>
    <td>${esc([c.cidade,(c.uf||"").toUpperCase()].filter(Boolean).join("/")||"—")}</td>
    <td>${esc(c.telefone||"—")}</td>
    <td>${esc(c.email||"—")}</td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nome / Razão social</th><th>CPF / CNPJ</th><th>Tipo</th><th>Cidade/UF</th><th>Telefone</th><th>E-mail</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderCliKanban(dados){
  const cont = $("cli-conteudo");
  if(!cont) return;
  // Agrupa por UF
  const ufs = {};
  dados.forEach(c => {
    const uf = (c.uf || "—").toUpperCase();
    if(!ufs[uf]) ufs[uf] = [];
    ufs[uf].push(c);
  });
  const nomesUf = Object.keys(ufs).sort();
  const colunas = nomesUf.map(uf => {
    const itens = ufs[uf];
    const cards = itens.map(c => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(c.id)}">
        <div class="serv-kan-card-nome">${esc(c.nome)}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${esc(c.cidade || "—")} · ${esc(c.cpf_cnpj || "—")}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${esc(c.telefone || "")}</span>
          ${tagSituacao(c.ativo)}
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col">
      <div class="serv-kan-col-head">${esc(uf)}<span>${itens.length}</span></div>
      ${cards}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelCli(){
  $("cli-painel").style.display = "";
  $("cli-ficha").style.display = "none";
  cliEditId = null;
}

function novoCliente(){
  cliEditId = null;
  ["cli-nome","cli-fantasia","cli-doc","cli-ie","cli-email","cli-tel","cli-contato",
   "cli-cep","cli-logradouro","cli-numero","cli-complemento","cli-bairro","cli-cidade","cli-uf","cli-obs"
  ].forEach(k => { const el = $(k); if(el) el.value = ""; });
  $("cli-tipo").value = "juridica";
  $("cli-ativo").checked = true;
  $("btn-excluir-cli").style.display = "none";
  abrirFichaCliVisual({ nome: "(novo)", tipo_pessoa: "juridica", ativo: true });
  if(typeof ocultarHistorico === "function") ocultarHistorico("cli-historico");
}

async function abrirCliente(id){
  cliEditId = id;
  const { data, error } = await sb.from("clientes").select("*").eq("id",id).single();
  if(error){ aviso("app-aviso","Erro ao abrir cliente: "+error.message,"erro"); return; }
  $("cli-tipo").value        = data.tipo_pessoa || "juridica";
  $("cli-nome").value        = data.nome || "";
  $("cli-fantasia").value    = data.nome_fantasia || "";
  $("cli-doc").value         = data.cpf_cnpj || "";
  $("cli-ie").value          = data.inscricao_estadual || "";
  $("cli-email").value       = data.email || "";
  $("cli-tel").value         = data.telefone || "";
  $("cli-contato").value     = data.contato_nome || "";
  $("cli-cep").value         = data.cep || "";
  $("cli-logradouro").value  = data.logradouro || "";
  $("cli-numero").value      = data.numero || "";
  $("cli-complemento").value = data.complemento || "";
  $("cli-bairro").value      = data.bairro || "";
  $("cli-cidade").value      = data.cidade || "";
  $("cli-uf").value          = data.uf || "";
  $("cli-obs").value         = data.observacoes || "";
  $("cli-ativo").checked     = data.ativo !== false;
  $("btn-excluir-cli").style.display = "";
  abrirFichaCliVisual(data);
  if(typeof montarHistorico === "function") montarHistorico("clientes", id, "cli-historico");
}

function abrirFichaCliVisual(c){
  $("cli-painel").style.display = "none";
  $("cli-ficha").style.display = "";

  $("cli-ficha-nome").textContent = c.nome || "(novo)";
  $("cli-ficha-tipo-chip").textContent = c.tipo_pessoa === "fisica" ? "Pessoa Física" : "Pessoa Jurídica";
  $("cli-ficha-doc-chip").textContent = c.cpf_cnpj || "—";
  $("cli-ficha-cidade-chip").textContent = c.cidade
    ? `${c.cidade}${c.uf ? "/" + c.uf.toUpperCase() : ""}`
    : "—";
  $("cli-ficha-tel-chip").textContent = c.telefone || "—";
  $("cli-ficha-ativo-chip").innerHTML = (c.ativo === false)
    ? '<span class="tag cinza">Inativo</span>'
    : '<span class="tag verde">Ativo</span>';
  $("cli-ficha-titulo").textContent = cliEditId ? c.nome : "Novo cliente";

  ativarTabCli("geral");
}

function ativarTabCli(nome){
  document.querySelectorAll("#cli-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#cli-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Salvar / excluir ---------- */
async function salvarCliente(){
  if(!$("cli-nome").value.trim()){ aviso("app-aviso","Informe o nome/razão social.","erro"); ativarTabCli("geral"); return; }
  const reg = {
    tipo_pessoa:        $("cli-tipo").value,
    nome:               $("cli-nome").value.trim(),
    nome_fantasia:      $("cli-fantasia").value.trim() || null,
    cpf_cnpj:           $("cli-doc").value.trim() || null,
    inscricao_estadual: $("cli-ie").value.trim() || null,
    email:              $("cli-email").value.trim() || null,
    telefone:           $("cli-tel").value.trim() || null,
    contato_nome:       $("cli-contato").value.trim() || null,
    cep:                $("cli-cep").value.trim() || null,
    logradouro:         $("cli-logradouro").value.trim() || null,
    numero:             $("cli-numero").value.trim() || null,
    complemento:        $("cli-complemento").value.trim() || null,
    bairro:             $("cli-bairro").value.trim() || null,
    cidade:             $("cli-cidade").value.trim() || null,
    uf:                 $("cli-uf").value || null,
    observacoes:        $("cli-obs").value.trim() || null,
    ativo:              $("cli-ativo").checked
  };
  let result;
  if(cliEditId){
    result = await sb.from("clientes").update(reg).eq("id", cliEditId).select().single();
  } else {
    result = await sb.from("clientes").insert(reg).select().single();
  }
  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    if(m.includes("duplicate") || m.includes("unique"))
      aviso("app-aviso","Já existe um cliente com esse CPF/CNPJ.","erro");
    else
      aviso("app-aviso","Não foi possível salvar: "+result.error.message,"erro");
    return;
  }
  cliEditId = result.data.id;
  $("btn-excluir-cli").style.display = "";
  aviso("app-aviso","Cliente salvo.","ok");
  await carregarClientes();
  if(typeof carregarClientesSelects === "function") await carregarClientesSelects();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  await abrirCliente(cliEditId);
}

async function excluirCliente(){
  if(!cliEditId) return;
  if(!confirm("Excluir este cliente? A ação não pode ser desfeita.")) return;
  const { error } = await sb.from("clientes").delete().eq("id", cliEditId);
  if(error){ aviso("app-aviso","Não foi possível excluir: "+error.message,"erro"); return; }
  aviso("app-aviso","Cliente excluído.","ok");
  await carregarClientes();
  if(typeof carregarClientesSelects === "function") await carregarClientesSelects();
  mostrarPainelCli();
}

/* ---------- Listeners ---------- */
function ligarClientes(){
  document.querySelectorAll("#cli-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#cli-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _cliView = b.dataset.view;
      renderClientes();
    });
  });
  ["cli-busca","cli-f-tipo","cli-f-ativo"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "cli-busca" ? "input" : "change", id === "cli-busca" ? debounce(renderClientes) : renderClientes);
  });
  $("cli-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirCliente(tr.dataset.id);
  });

  $("btn-novo-cliente")?.addEventListener("click", novoCliente);
  $("btn-voltar-cli")?.addEventListener("click", mostrarPainelCli);
  $("btn-salvar-cli")?.addEventListener("click", () => comBotaoTravado("btn-salvar-cli", salvarCliente));
  $("btn-excluir-cli")?.addEventListener("click", excluirCliente);

  document.querySelectorAll("#cli-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabCli(b.dataset.tab));
  });

  const navCli = document.querySelector('nav button[data-secao="clientes"]');
  if(navCli) navCli.addEventListener("click", mostrarPainelCli);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarClientes);
} else {
  ligarClientes();
}

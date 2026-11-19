/* ====================================================================
   Módulo: Clientes
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   CRUD sem statusbar (cliente é ativo/inativo via checkbox).
   Fase 105a (22/10/2026): aba Fiscal (indicador da IE, IE, e-mail da nota), CEP → endereço e código IBGE pela
   ViaCEP, CPF/CNPJ conferido pelos dígitos verificadores (o banco recusa documento novo ou alterado inválido) e a
   visão "Pendências fiscais": clientes de obra em andamento sem o que a nota exige, obras sem IBGE, máquinas e
   acessórios em mobilização sem NCM e os dados fiscais da empresa (js/fiscal.js). Antes da migration da fase 105a os
   campos novos ficam desligados e não vão no salvar (_cliTemFiscal).
   ==================================================================== */

let _clientes = [];
let _cliView  = "lista";
let cliEditId = null;
let _cliTemFiscal = false;    // clientes.codigo_ibge / indicador_ie / email_nf existem (migration da fase 105a)
let _cliDocOriginal = "";     // documento ao abrir: o que já estava gravado não é barrado (o banco faz igual)
let _cliFiscal = null;        // dados da visão Pendências fiscais (obras em andamento, mobilizações, itens)
let _cliFiscalTodos = false;  // visão Pendências fiscais: mostrar também os clientes completos

const CLI_IND_IE = { contribuinte: "Contribuinte", isento: "Isento", nao_contribuinte: "Não contribuinte" };

/* Lote S49 (#140): quem cadastra e edita cliente. Espelha as policies de clientes: clientes_write (admin, comercial,
   financeiro; diretor por has_role) e as do módulo extra de Orçamentos (hotfix 113: insere e edita, não exclui).
   Os demais cargos veem a lista e a ficha sem os botões de gravar. */
function cliPodeEditar(){
  if(!usuarioAtual || (typeof ehSomenteLeitura === "function" && ehSomenteLeitura())) return false;
  return ["diretor", "admin", "comercial", "financeiro"].includes(usuarioAtual.cargo)
      || (typeof temModuloExtra === "function" && temModuloExtra("orcamentos"));
}
function cliPodeExcluir(){
  return !!usuarioAtual && ["diretor", "admin", "comercial", "financeiro"].includes(usuarioAtual.cargo);
}
function cliAplicarPermissoes(){
  const novo = $("btn-novo-cliente"); if(novo) novo.style.display = cliPodeEditar() ? "" : "none";
  const salvar = $("btn-salvar-cli"); if(salvar) salvar.style.display = cliPodeEditar() ? "" : "none";
  const excl = $("btn-excluir-cli"); if(excl) excl.style.display = cliEditId && cliPodeExcluir() ? "" : "none";
}

/* ---------- Fase 182a: grupo econômico ----------
   O grupo fica no cadastro do cliente (D1); a obra herda. Campo com busca e criação na hora ("Criar grupo 'X'" ao
   Salvar). Sugestão pela raiz do CNPJ (8 primeiros dígitos) só na tela: nunca grava sozinha. */
let _cliGrupos = [];
function cliPorId(id){ return id ? _clientes.find(c => c.id === id) || null : null; }
function cliRotulo(id){ const c = cliPorId(id); return c ? (String(c.nome_fantasia || "").trim() || c.nome || "") : (mapaClientes[id] || ""); }
function cliGrupoNome(id){ const g = _cliGrupos.find(x => x.id === id); return g ? g.nome : ""; }
function cliRaiz(doc){ const d = String(doc || "").replace(/\D/g, ""); return d.length === 14 ? d.slice(0, 8) : ""; }
async function cliCarregarGrupos(){
  const { data, error } = await sb.from("grupos_economicos").select("id,nome,cnpj_raiz,ativo").order("nome");
  _cliGrupos = error ? [] : (data || []);
  const dl = $("cli-grupos-lista");
  if(dl) dl.innerHTML = _cliGrupos.filter(g => g.ativo !== false).map(g => `<option value="${esc(g.nome)}"></option>`).join("");
  const f = $("cli-f-grupo");
  if(f){
    const atual = f.value;
    f.innerHTML = `<option value="">Todos os grupos</option><option value="__sem">Sem grupo</option>`
      + _cliGrupos.map(g => `<option value="${esc(g.id)}">${esc(g.nome)}</option>`).join("");
    f.value = atual;
  }
}
function cliGrupoPorNome(txt){ const n = String(txt || "").trim().toLowerCase(); return n ? _cliGrupos.find(g => g.nome.trim().toLowerCase() === n) || null : null; }
// dica embaixo do campo: grupo novo é criado ao Salvar
function cliGrupoDica(){
  const el = $("cli-grupo-dica"); if(!el) return;
  const txt = ($("cli-grupo")?.value || "").trim();
  el.textContent = txt && !cliGrupoPorNome(txt) ? `Criar grupo "${txt}" ao salvar.` : "";
}
// mesma raiz de CNPJ de outro cliente já agrupado → pergunta se usa o mesmo grupo
function cliAvisoRaiz(){
  const box = $("cli-grupo-aviso"); if(!box) return;
  box.innerHTML = ""; delete box.dataset.grupo;
  const raiz = cliRaiz($("cli-doc")?.value);
  if(!raiz) return;
  const atual = cliGrupoPorNome($("cli-grupo")?.value);
  const outro = _clientes.find(c => c.id !== cliEditId && c.grupo_id && cliRaiz(c.cpf_cnpj) === raiz && (!atual || atual.id !== c.grupo_id));
  const grupo = outro ? _cliGrupos.find(g => g.id === outro.grupo_id) : _cliGrupos.find(g => g.cnpj_raiz === raiz && (!atual || atual.id !== g.id));
  if(!grupo) return;
  box.dataset.grupo = grupo.nome;
  box.innerHTML = `${outro ? `Este CNPJ é da mesma raiz de ${esc(outro.nome)} (grupo ${esc(grupo.nome)}).` : `Este CNPJ é da raiz do grupo ${esc(grupo.nome)}.`} Usar o mesmo grupo?
    ${cliPodeEditar() ? `<button type="button" class="btn-sec btn-sm" data-cli-usar-grupo="1" title="Preenche o campo; grava só ao Salvar">Usar este grupo</button>` : ""}`;
}
// grupo do formulário → id (cria o grupo novo depois de confirmar). undefined = cancelou.
async function cliResolverGrupo(){
  const txt = ($("cli-grupo")?.value || "").trim();
  if(!txt) return null;
  const g = cliGrupoPorNome(txt);
  if(g) return g.id;
  if(!confirm(`Criar o grupo econômico "${txt}"?`)) return undefined;
  const raiz = cliRaiz($("cli-doc")?.value);
  const ja = raiz && _cliGrupos.some(x => x.cnpj_raiz === raiz);
  const { data, error } = await sb.from("grupos_economicos").insert({ nome: txt, cnpj_raiz: raiz && !ja ? raiz : null }).select("id").single();
  if(error){ aviso("app-aviso", "Não foi possível criar o grupo: " + error.message, "erro"); return undefined; }
  await cliCarregarGrupos();
  return data.id;
}
// smart-button "Obras do grupo": abre o painel de Obras só com as obras dos clientes do grupo
function cliObrasDoGrupo(grupoId){
  const ids = new Set(_clientes.filter(c => c.grupo_id === grupoId).map(c => c.id));
  return (typeof _obrRegistros !== "undefined" ? _obrRegistros : []).filter(o => ids.has(o.cliente_id)).map(o => o.id);
}
function cliAtualizarSmartGrupo(c){
  const b = $("cli-sb-obras-grupo"); if(!b) return;
  const gid = c && c.grupo_id;
  b.style.display = gid ? "" : "none";
  if(!gid) return;
  b.dataset.grupo = gid;
  b.querySelector(".sb-num").textContent = String(cliObrasDoGrupo(gid).length);
}
async function cliAbrirObrasDoGrupo(){
  const gid = $("cli-sb-obras-grupo")?.dataset.grupo;
  if(!gid || !irParaSecao("obras")) return;
  if(typeof mostrarPainelObra === "function") mostrarPainelObra();
  renderObras({ ids: cliObrasDoGrupo(gid), rotulo: "Grupo " + cliGrupoNome(gid) });
}

/* ---------- Carga ---------- */
async function carregarClientes(){
  // select("*"): as colunas fiscais (fase 105a) vêm quando existirem, sem quebrar antes da migration
  const [{ data, error }] = await Promise.all([sb.from("clientes").select("*").order("nome"), cliCarregarGrupos()]);
  _clientes = error ? [] : (data || []);
  _cliTemFiscal = _clientes.length ? Object.prototype.hasOwnProperty.call(_clientes[0], "codigo_ibge")
                                   : await fiscalColunaExiste("clientes", "codigo_ibge");
  renderClientes();
}

/* ---------- Filtros ---------- */
function cliFiltrados(){
  const termo = ($("cli-busca")?.value || "").trim().toLowerCase();
  const fTipo = $("cli-f-tipo")?.value || "";
  const fAtivo = $("cli-f-ativo")?.value || "";
  const fGrupo = $("cli-f-grupo")?.value || "";   // fase 182a
  return _clientes.filter(c => {
    if(fTipo && c.tipo_pessoa !== fTipo) return false;
    if(fGrupo === "__sem" && c.grupo_id) return false;
    if(fGrupo && fGrupo !== "__sem" && c.grupo_id !== fGrupo) return false;
    if(fAtivo === "ativos" && c.ativo === false) return false;
    if(fAtivo === "inativos" && c.ativo !== false) return false;
    if(termo){
      const alvo = `${c.nome||""} ${c.nome_fantasia||""} ${c.cpf_cnpj||""} ${c.cidade||""} ${cliGrupoNome(c.grupo_id)}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/* ---------- Render ---------- */
function renderClientes(){
  const card = $("cli-fiscal-empresa-card");
  if(card) card.style.display = _cliView === "fiscal" ? "" : "none";
  cliAplicarPermissoes();   // lote S49 (#140)
  if(_cliView === "fiscal"){ renderCliFiscal(); return; }
  if(_cliView === "corrigir" && typeof clsRender === "function"){ clsRender(); return; }   // fase 182b
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
    <td>${esc(c.nome)} ${tagSituacao(c.ativo)}${c.grupo_id ? `<div class="meta" title="Grupo econômico">${esc(cliGrupoNome(c.grupo_id))}</div>` : ""}</td>
    <td>${esc(c.cpf_cnpj||"—")}</td>
    <td>${esc(c.tipo_pessoa === "fisica" ? "Pessoa Física" : "Pessoa Jurídica")}</td>
    <td>${esc([c.cidade,(c.uf||"").toUpperCase()].filter(Boolean).join("/")||"—")}</td>
    <td>${esc(c.telefone||"—")}</td>
    <td class="td-email" title="${esc(c.email||"")}">${esc(c.email||"—")}</td>
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

/* ---------- Pendências fiscais (fase 105a) ----------
   Cliente de obra em andamento com o cadastro incompleto para a NF-e (fiscalClientePendencias, a mesma regra da function
   focus-nfe desde o hotfix NF-e de remessa A; o aviso urgente sai de vw_pendencias_cliente_fiscal); obra em andamento sem IBGE; máquina ou
   acessório de mobilização ativa (em preparação, em trânsito, em obra) sem NCM. */
const CLI_MOB_ATIVA = ["em_preparacao", "em_transito", "em_obra"];
async function cliCarregarFiscal(force){
  if(_cliFiscal && !force) return _cliFiscal;
  const [ob, mob] = await Promise.all([
    sb.from("obras").select("*").eq("status", "em_andamento").order("codigo"),
    sb.from("mobilizacoes").select("id,obra_id,status,equipamento_id,equipamentos_apoio,acessorios_ids").in("status", CLI_MOB_ATIVA)
  ]);
  const obras = ob.data || [], mobs = mob.data || [];
  const eqIds = [...new Set(mobs.flatMap(m => [m.equipamento_id, ...(m.equipamentos_apoio || [])]).filter(Boolean))];
  const acIds = [...new Set(mobs.flatMap(m => m.acessorios_ids || []).filter(Boolean))];
  const [eq, ac] = await Promise.all([
    eqIds.length ? sb.from("equipamentos").select("id,codigo,nome,tipo,ncm").in("id", eqIds) : Promise.resolve({ data: [] }),
    acIds.length ? sb.from("acessorios").select("id,marcacao,familia,tipo,ncm").in("id", acIds) : Promise.resolve({ data: [] })
  ]);
  const obraIbge = obras.length ? Object.prototype.hasOwnProperty.call(obras[0], "codigo_ibge") : await fiscalColunaExiste("obras", "codigo_ibge");
  // obras de cada máquina/acessório (pela mobilização ativa)
  const obrasDe = {};
  mobs.forEach(m => [m.equipamento_id, ...(m.equipamentos_apoio || []), ...(m.acessorios_ids || [])].filter(Boolean)
    .forEach(id => { (obrasDe[id] = obrasDe[id] || new Set()).add(m.obra_id); }));
  _cliFiscal = { obras, obraIbge, semNcm: !!(eq.error || ac.error), eq: eq.data || [], ac: ac.data || [], obrasDe, erro: ob.error || mob.error || null };
  return _cliFiscal;
}

async function renderCliFiscal(){
  const cont = $("cli-conteudo");
  if(!cont) return;
  const fe = $("cli-fe");
  if(fe && !fe.innerHTML) fiscalEmpresaRender("cli-fe");
  if(!_cliFiscal) cont.innerHTML = `<p class="vazio">Carregando pendências fiscais…</p>`;
  const f = await cliCarregarFiscal();
  if(_cliView !== "fiscal") return;
  if(f.erro){ cont.innerHTML = `<p class="vazio">Não foi possível carregar: ${esc(f.erro.message || "erro")}</p>`; return; }
  const termo = ($("cli-busca")?.value || "").trim().toLowerCase();
  const obrasCli = {};
  f.obras.forEach(o => { (obrasCli[o.cliente_id] = obrasCli[o.cliente_id] || []).push(o); });
  const linhas = _clientes.filter(c => obrasCli[c.id])
    .map(c => ({ c, falta: fiscalClientePendencias(c) }))
    .filter(x => (_cliFiscalTodos || x.falta.length)
      && (!termo || `${x.c.nome || ""} ${x.c.nome_fantasia || ""} ${x.c.cpf_cnpj || ""} ${x.c.cidade || ""}`.toLowerCase().includes(termo)))
    .sort((a, b) => b.falta.length - a.falta.length || String(a.c.nome).localeCompare(String(b.c.nome), "pt-BR"));
  const totalPend = _clientes.filter(c => obrasCli[c.id] && fiscalClientePendencias(c).length).length;
  const totalCli = _clientes.filter(c => obrasCli[c.id]).length;
  const contador = $("cli-contador");
  if(contador) contador.textContent = `${totalPend} de ${totalCli} com pendência`;
  const nada = '<span class="meta">—</span>';
  const tabCli = linhas.length ? `<div class="tabela-rola"><table>
    <thead><tr><th>Cliente</th><th>CPF / CNPJ</th><th>IE</th><th>CEP</th><th>IBGE</th><th>E-mail da nota</th><th>Obras em andamento</th><th>Falta</th></tr></thead>
    <tbody>${linhas.map(({ c, falta }) => {
      const docOk = fiscalDocValido(c.cpf_cnpj);
      const ie = c.indicador_ie ? `${esc(CLI_IND_IE[c.indicador_ie] || c.indicador_ie)}${c.inscricao_estadual ? " · " + esc(c.inscricao_estadual) : ""}` : (c.inscricao_estadual ? esc(c.inscricao_estadual) : nada);
      return `<tr class="linha-clicavel" data-cli-fiscal="${esc(c.id)}" title="Abrir a ficha do cliente na aba Fiscal">
        <td>${esc(c.nome)}</td>
        <td>${c.cpf_cnpj ? esc(fiscalFormatarDoc(c.cpf_cnpj)) + (docOk ? "" : ' <span class="tag vermelho">inválido</span>') : nada}</td>
        <td>${ie}</td>
        <td>${c.cep ? esc(c.cep) : nada}</td>
        <td>${c.codigo_ibge ? esc(c.codigo_ibge) : nada}</td>
        <td>${c.email_nf ? esc(c.email_nf) : (c.email ? `<span class="meta">${esc(c.email)}</span>` : nada)}</td>
        <td>${obrasCli[c.id].map(o => linkObra(o.id, o.codigo)).join(", ")}</td>
        <td>${falta.length ? falta.map(x => `<span class="tag ambar">${esc(x)}</span>`).join(" ") : '<span class="tag verde">completo</span>'}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`
    : `<p class="vazio">${totalCli ? "Nenhum cliente de obra em andamento com pendência fiscal." : "Nenhuma obra em andamento."}</p>`;

  const obrasSem = f.obraIbge ? f.obras.filter(o => !o.codigo_ibge) : [];
  const cliNome = id => (_clientes.find(c => c.id === id) || {}).nome || "";
  const tabObras = !f.obraIbge
    ? `<p class="meta">O código IBGE da obra chega com a atualização do banco da fase 105a.</p>`
    : obrasSem.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Obra</th><th>Cliente</th><th>Cidade/UF</th><th>CEP</th></tr></thead>
      <tbody>${obrasSem.map(o => `<tr class="linha-clicavel" data-obra-ibge="${esc(o.id)}" title="Abrir a obra na aba Endereço">
        <td><strong>${esc(o.codigo)}</strong> ${esc(o.nome || "")}</td><td>${esc(cliNome(o.cliente_id) || "—")}</td>
        <td>${esc([o.cidade, (o.uf || "").toUpperCase()].filter(Boolean).join("/") || "—")}</td><td>${o.cep ? esc(o.cep) : nada}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Todas as obras em andamento têm o município (IBGE).</p>`;

  const obrasTxt = id => [...(f.obrasDe[id] || [])].map(oid => {
    const o = f.obras.find(x => x.id === oid);
    return linkObra(oid, o ? o.codigo : ((typeof mapaObras === "object" && mapaObras && mapaObras[oid]) || "obra"));
  }).join(", ");
  const itensSem = [
    ...f.eq.filter(e => !e.ncm).map(e => ({ link: linkEquipamento(e.id, e.codigo + (e.nome ? " · " + e.nome : "")), tipo: "Máquina", id: e.id })),
    ...f.ac.filter(a => !a.ncm).map(a => ({ link: linkAcessorio(a.id, a.marcacao), tipo: "Acessório", id: a.id }))
  ];
  const tabItens = f.semNcm
    ? `<p class="meta">O NCM de máquinas e acessórios chega com a atualização do banco da fase 105a.</p>`
    : itensSem.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Item</th><th>Tipo</th><th>Mobilização (obra)</th></tr></thead>
      <tbody>${itensSem.map(i => `<tr><td>${/* html */ i.link}</td><td>${esc(i.tipo)}</td><td>${obrasTxt(i.id) || "—"}</td></tr>`).join("")}</tbody></table></div>
      <p class="meta">Abra a ficha e preencha a aba Fiscal. A carga em lote por tipo de máquina está em docs/cargas/ncm-equipamentos.md (depois do OK do contador).</p>`
    : `<p class="vazio">Todas as máquinas e acessórios em mobilização ativa têm NCM.</p>`;

  cont.innerHTML = `${_cliTemFiscal ? "" : '<p class="meta">Indicador da IE e código IBGE do cliente chegam com a atualização do banco da fase 105a; até lá a lista mostra o que já dá para conferir.</p>'}
    <div class="lista-topo compacta"><h4 class="sub-titulo">Clientes de obra em andamento</h4>
      <label class="check-inline"><input type="checkbox" id="cli-fiscal-todos" ${_cliFiscalTodos ? "checked" : ""} /> mostrar também os completos</label></div>
    ${tabCli}
    <h4 class="titulo-bloco">Obras em andamento sem município da prestação (IBGE) <span class="contador">${f.obraIbge ? obrasSem.length : ""}</span></h4>
    ${tabObras}
    <h4 class="titulo-bloco">Máquinas e acessórios em mobilização sem NCM <span class="contador">${f.semNcm ? "" : itensSem.length}</span></h4>
    ${tabItens}`;
  $("cli-fiscal-todos")?.addEventListener("change", e => { _cliFiscalTodos = e.target.checked; renderCliFiscal(); });
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelCli(){
  $("cli-painel").style.display = "";
  $("cli-ficha").style.display = "none";
  cliEditId = null;
}

function cliAplicarCamposFiscais(){
  document.querySelectorAll("#cli-ficha .cli-fiscal-novo input, #cli-ficha .cli-fiscal-novo select").forEach(el => { el.disabled = !_cliTemFiscal; });
  const av = $("cli-fiscal-aviso"); if(av) av.style.display = _cliTemFiscal ? "none" : "";
}

function novoCliente(){
  cliEditId = null;
  _cliDocOriginal = "";
  ["cli-nome","cli-fantasia","cli-doc","cli-ie","cli-email","cli-tel","cli-contato",
   "cli-cep","cli-logradouro","cli-numero","cli-complemento","cli-bairro","cli-cidade","cli-uf","cli-obs",
   "cli-ibge","cli-ind-ie","cli-email-nf","cli-grupo"
  ].forEach(k => { const el = $(k); if(el) el.value = ""; });
  cliGrupoDica(); cliAvisoRaiz();   // fase 182a
  $("cli-tipo").value = "juridica";
  $("cli-ativo").checked = true;
  if($("cli-cep-status")) $("cli-cep-status").textContent = "";
  if($("cli-cep")) delete $("cli-cep").dataset.ultimo;
  cliAplicarPermissoes();   // lote S49 (#140): sem Excluir no cliente novo
  cliAplicarCamposFiscais();
  abrirFichaCliVisual({ nome: "(novo)", tipo_pessoa: "juridica", ativo: true });
  if(typeof ocultarHistorico === "function") ocultarHistorico("cli-historico");
  if(typeof carregarCliContatos === "function") carregarCliContatos(null);   // fase 183a
  if(typeof carregarCliDocumentos === "function") carregarCliDocumentos(null);   // fase 183b
}

async function abrirCliente(id, aba){
  cliEditId = id;
  const { data, error } = await sb.from("clientes").select("*").eq("id",id).single();
  if(cliEditId !== id) return;   // fase 142: abriu outra ficha enquanto esta carregava
  if(error){ aviso("app-aviso","Erro ao abrir cliente: "+error.message,"erro"); return; }
  _cliTemFiscal = Object.prototype.hasOwnProperty.call(data, "codigo_ibge");
  _cliDocOriginal = data.cpf_cnpj || "";
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
  // fase 105a
  if($("cli-ibge"))     $("cli-ibge").value     = data.codigo_ibge || "";
  if($("cli-ind-ie"))   $("cli-ind-ie").value   = data.indicador_ie || "";
  if($("cli-email-nf")) $("cli-email-nf").value = data.email_nf || "";
  if($("cli-grupo")) $("cli-grupo").value = cliGrupoNome(data.grupo_id);   // fase 182a
  cliGrupoDica(); cliAvisoRaiz();
  if($("cli-cep-status")) $("cli-cep-status").textContent = "";
  if($("cli-cep")) $("cli-cep").dataset.ultimo = String(data.cep || "").replace(/\D/g, "");
  cliAplicarCamposFiscais();
  cliAplicarPermissoes();   // lote S49 (#140): Salvar/Excluir conforme o cargo e o módulo extra
  abrirFichaCliVisual(data);
  if(aba) ativarTabCli(aba);
  if(typeof montarHistorico === "function") montarHistorico("clientes", id, "cli-historico");
  if(typeof carregarCliContatos === "function") carregarCliContatos(id);   // fase 183a: aba Contatos e aviso
  if(typeof carregarCliDocumentos === "function") carregarCliDocumentos(id);   // fase 183b: documentos e quem assina
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
  if($("cli-ficha-grupo-chip")) $("cli-ficha-grupo-chip").textContent = cliGrupoNome(c.grupo_id) || "—";   // fase 182a
  cliAtualizarSmartGrupo(c);
  $("cli-ficha-ativo-chip").innerHTML = (c.ativo === false)
    ? '<span class="tag cinza">Inativo</span>'
    : '<span class="tag verde">Ativo</span>';
  $("cli-ficha-titulo").textContent = cliEditId ? c.nome : "Novo cliente";

  cliAtualizarFiscal();
  ativarTabCli("geral");
}

/* situação fiscal ao vivo (aba Fiscal, badge e o aviso do documento) a partir do que está no formulário */
function cliLerFormFiscal(){
  const v = id => $(id)?.value.trim();
  return { nome: v("cli-nome"), cpf_cnpj: v("cli-doc"), inscricao_estadual: v("cli-ie"), indicador_ie: $("cli-ind-ie")?.value || "",
           logradouro: v("cli-logradouro"), bairro: v("cli-bairro"), cidade: v("cli-cidade"), uf: $("cli-uf")?.value || "",
           cep: v("cli-cep"), codigo_ibge: v("cli-ibge") };
}
function cliAtualizarFiscal(){
  const f = cliLerFormFiscal();
  const falta = fiscalClientePendencias(f);
  const box = $("cli-fiscal-situacao");
  if(box) box.innerHTML = falta.length
    ? `<p class="meta">Falta para a nota: ${falta.map(x => `<span class="tag ambar">${esc(x)}</span>`).join(" ")}</p>`
    : `<p class="meta"><span class="tag verde">completo</span> CPF/CNPJ, IE e endereço com município prontos para a nota.</p>`;
  const badge = $("cli-fiscal-badge");
  if(badge) badge.textContent = _cliTemFiscal && falta.length ? String(falta.length) : "";
  const st = $("cli-doc-status");
  if(st){
    const d = fiscalDocLimpo(f.cpf_cnpj);
    st.textContent = !d ? "" : fiscalDocValido(d) ? "" : (d.length === 11 || d.length === 14 ? "Dígitos verificadores não conferem." : "CPF tem 11 dígitos; CNPJ, 14.");
    st.classList.toggle("txt-perigo", !!st.textContent);
  }
}

function ativarTabCli(nome){
  document.querySelectorAll("#cli-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#cli-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* lote S58 (#228): BrasilAPI preenche só campo vazio, com a mesma regra de Fornecedores. CPF não sai do app. */
async function cliBuscarCnpj(){
  const st = $("cli-doc-status");
  const msg = (txt, erro) => { if(st){ st.textContent = txt || ""; st.classList.toggle("txt-perigo", !!erro); } };
  const d = ($("cli-doc")?.value || "").replace(/\D/g, "");
  if(d.length !== 14){ msg(d.length === 11 ? "CPF não é consultado fora do app; preencha os dados à mão." : "Informe o CNPJ com 14 dígitos.", true); return; }
  msg("Buscando o CNPJ na BrasilAPI…");
  const r = await fiscalBuscarCnpj(d);
  if(r.erro){ msg(r.erro, true); return; }
  const pos = (id, v) => { const c = $(id); if(!c || !v || String(c.value || "").trim()) return; c.value = v; };
  pos("cli-nome", r.razao_social);
  pos("cli-fantasia", r.nome_fantasia);
  pos("cli-cep", r.cep);
  pos("cli-logradouro", r.logradouro);
  pos("cli-numero", r.numero);
  pos("cli-complemento", r.complemento);
  pos("cli-bairro", r.bairro);
  pos("cli-cidade", r.cidade);
  if($("cli-uf") && !$("cli-uf").value && r.uf && [...$("cli-uf").options].some(o => o.value === r.uf)) $("cli-uf").value = r.uf;
  pos("cli-ibge", r.ibge);
  pos("cli-tel", r.telefone);
  pos("cli-email", r.email);
  if($("cli-tipo").value !== "juridica") $("cli-tipo").value = "juridica";
  cliAtualizarFiscal();
  if(!r.ativa){
    msg(`Atenção: situação cadastral na Receita = ${r.situacao}.`, true);
    aviso("app-aviso", `CNPJ com situação cadastral "${r.situacao}" na Receita. Confira antes de seguir com este cliente.`, "aviso");
  } else {
    msg(`${r.razao_social || "CNPJ encontrado"} · situação ${r.situacao || "ativa"} (campos vazios preenchidos)`);
  }
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
  // fase 105a: documento novo ou alterado precisa conferir (o gatilho do banco recusa igual); o que já estava gravado passa
  if(reg.cpf_cnpj && reg.cpf_cnpj !== _cliDocOriginal && !fiscalDocValido(reg.cpf_cnpj)){
    aviso("app-aviso", "CPF/CNPJ inválido: confira os dígitos verificadores.", "erro"); ativarTabCli("geral"); return;
  }
  if(_cliTemFiscal){
    reg.indicador_ie = $("cli-ind-ie").value || null;
    reg.codigo_ibge  = ($("cli-ibge").value || "").replace(/\D/g, "") || null;
    reg.email_nf     = $("cli-email-nf").value.trim() || null;
    if(reg.indicador_ie === "contribuinte" && !reg.inscricao_estadual){
      aviso("app-aviso", "Contribuinte do ICMS precisa da inscrição estadual (ou marque isento / não contribuinte).", "erro"); ativarTabCli("fiscal"); return;
    }
    if(reg.codigo_ibge && reg.codigo_ibge.length !== 7){
      aviso("app-aviso", "Código IBGE do município tem 7 dígitos (busque pelo CEP).", "erro"); ativarTabCli("endereco"); return;
    }
    if(!fiscalEmailsValidos(reg.email_nf)){
      aviso("app-aviso", "E-mail para a nota inválido (vários: separe por vírgula).", "erro"); ativarTabCli("fiscal"); return;
    }
  }
  // fase 182a: grupo econômico (existente pelo nome, ou criado agora depois do OK)
  const grupoId = await cliResolverGrupo();
  if(grupoId === undefined){ ativarTabCli("geral"); return; }
  reg.grupo_id = grupoId;
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
  cliAplicarPermissoes();
  aviso("app-aviso","Cliente salvo.","ok");
  _cliFiscal = null;   // a visão Pendências fiscais relê
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

/* Atalho do "Para regularizar" (dashboard.js): um cliente abre a ficha na aba Fiscal; vários, a visão Pendências fiscais */
async function cliAbrirPendenciasFiscais(clienteId){
  if(!irParaSecao("clientes")) return;
  if(clienteId){ await abrirCliente(clienteId, "fiscal"); return; }
  _cliView = "fiscal";
  document.querySelectorAll("#cli-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === "fiscal"));
  mostrarPainelCli();
  _cliFiscal = null;
  renderClientes();
}

/* ---------- Listeners ---------- */
function ligarClientes(){
  document.querySelectorAll("#cli-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#cli-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _cliView = b.dataset.view;
      if(_cliView === "fiscal"){ _cliFiscal = null; const fe = $("cli-fe"); if(fe) fe.innerHTML = ""; }   // relê ao entrar
      renderClientes();
    });
  });
  ["cli-busca","cli-f-tipo","cli-f-ativo"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "cli-busca" ? "input" : "change", id === "cli-busca" ? debounce(renderClientes) : renderClientes);
  });
  $("cli-conteudo")?.addEventListener("click", (e) => {
    const fis = e.target.closest("[data-cli-fiscal]");
    if(fis){ abrirCliente(fis.dataset.cliFiscal, "fiscal"); return; }
    const ob = e.target.closest("[data-obra-ibge]");
    if(ob){
      if(typeof dashAbrirObra === "function") dashAbrirObra(ob.dataset.obraIbge, "endereco").then(() => { if(typeof obrFocarCampo === "function") obrFocarCampo("obr-cep"); });
      return;
    }
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirCliente(tr.dataset.id);
  });

  $("btn-novo-cliente")?.addEventListener("click", novoCliente);
  $("btn-voltar-cli")?.addEventListener("click", mostrarPainelCli);
  $("btn-salvar-cli")?.addEventListener("click", () => comBotaoTravado("btn-salvar-cli", salvarCliente));
  $("btn-excluir-cli")?.addEventListener("click", excluirCliente);
  $("btn-cli-cnpj")?.addEventListener("click", () => comBotaoTravado("btn-cli-cnpj", cliBuscarCnpj));   // lote S58 (#228)
  // fase 182a: grupo econômico
  $("cli-f-grupo")?.addEventListener("change", renderClientes);
  $("cli-grupo")?.addEventListener("input", () => { cliGrupoDica(); cliAvisoRaiz(); });
  $("cli-doc")?.addEventListener("input", cliAvisoRaiz);
  $("cli-grupo-aviso")?.addEventListener("click", (e) => {
    const box = e.currentTarget;
    if(!e.target.closest("[data-cli-usar-grupo]") || !box.dataset.grupo) return;
    $("cli-grupo").value = box.dataset.grupo;
    cliGrupoDica(); cliAvisoRaiz();
  });
  $("cli-sb-obras-grupo")?.addEventListener("click", cliAbrirObrasDoGrupo);

  document.querySelectorAll("#cli-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabCli(b.dataset.tab));
  });

  // fase 105a: CEP → endereço, cidade, UF e IBGE (ViaCEP); situação fiscal ao vivo
  fiscalLigarCep({ cep: "cli-cep", botao: "btn-cli-cep", status: "cli-cep-status", logradouro: "cli-logradouro",
                   bairro: "cli-bairro", cidade: "cli-cidade", uf: "cli-uf", ibge: "cli-ibge" });
  ["cli-nome", "cli-doc", "cli-ie", "cli-ind-ie", "cli-cep", "cli-ibge", "cli-logradouro", "cli-bairro", "cli-cidade", "cli-uf"].forEach(id => {
    const el = $(id); if(el) el.addEventListener(el.tagName === "SELECT" ? "change" : "input", cliAtualizarFiscal);
  });

  const navCli = document.querySelector('nav button[data-secao="clientes"]');
  if(navCli) navCli.addEventListener("click", mostrarPainelCli);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarClientes);
} else {
  ligarClientes();
}















const CCT_PAPEIS = [["comercial", "Comercial"], ["aprova_medicao", "Aprova a medição"], ["financeiro", "Financeiro"]];
const CCT_COLS = "id,cliente_id,nome,cargo,email,telefone,papeis,principal_em,ativo,origem,observacoes";
const CCT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let _cctSemTabela = false;
let _cctCliente = null;
let _cctContatos = [];
let _cctObras = [];
let _cctOrcContatos = [];
let _cctMedSeq = 0;

function cctSemTabela(err){
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "42703"
    || /cliente_contat|aprovador_cliente|schema cache|does not exist/i.test(String(err.message || "")));
}
function cctPapelRotulo(p){ const x = CCT_PAPEIS.find(a => a[0] === p); return x ? x[1] : p; }
function cctPodeEditar(){ return typeof cliPodeEditar === "function" ? !!cliPodeEditar() : false; }


async function cctLer(clienteId, soAtivos){
  let q = sb.from("cliente_contatos").select(CCT_COLS).eq("cliente_id", clienteId).order("nome");
  if(soAtivos) q = q.eq("ativo", true);
  const r = await q;
  if(r.error){ if(cctSemTabela(r.error)) _cctSemTabela = true; return { erro: r.error }; }
  const ids = (r.data || []).map(c => c.id);
  let vinc = [];
  if(ids.length){
    const v = await sb.from("cliente_contato_obras").select("contato_id,obra_id").in("contato_id", ids);
    if(!v.error) vinc = v.data || [];
  }
  return { contatos: (r.data || []).map(c => ({ ...c, obras: vinc.filter(x => x.contato_id === c.id).map(x => x.obra_id) })) };
}


async function carregarCliContatos(clienteId){
  const box = $("cli-ct-conteudo");
  if(!box) return;
  _cctCliente = clienteId || null;
  _cctContatos = []; _cctObras = [];
  cctAtualizarBadge();
  const btn = $("btn-cli-ct-novo");
  if(!clienteId){
    box.innerHTML = uiVazio("Salve o cliente antes de cadastrar os contatos.");
    if(btn) btn.hidden = true;
    cctAvisoCliente([]);
    return;
  }
  box.innerHTML = uiCarregando("Carregando contatos…");
  const [r, ob, pend] = await Promise.all([
    cctLer(clienteId),
    sb.from("obras").select("id,codigo,nome,status").eq("cliente_id", clienteId).order("codigo"),
    sb.from("vw_cliente_contatos_pendencias").select("tipo,obra_id,obra_codigo,texto").eq("cliente_id", clienteId)
  ]);
  if(_cctCliente !== clienteId) return;
  if(r.erro){
    box.innerHTML = _cctSemTabela ? uiVazio("Os contatos por papel chegam com a atualização do banco da fase 183a.")
                                  : uiErro("Não foi possível carregar os contatos: " + r.erro.message);
    if(btn) btn.hidden = true;
    return;
  }
  _cctContatos = r.contatos;
  _cctObras = ob.error ? [] : (ob.data || []);
  if(btn) btn.hidden = !cctPodeEditar();
  cctAvisoCliente(pend.error ? [] : (pend.data || []));
  renderCliContatos();
  cctAtualizarDatalistNf();
}

function cctAtualizarBadge(){
  const b = $("cli-ct-badge");
  if(b) b.textContent = _cctContatos.length ? String(_cctContatos.filter(c => c.ativo).length) : "";
}

function cctChipsPapeis(c){
  return (c.papeis || []).map(p => {
    const princ = (c.principal_em || []).includes(p);
    return `<span class="tag ${princ ? "azul" : "cinza"}" title="${princ ? "Principal neste papel" : "Papel do contato"}">${esc(cctPapelRotulo(p))}${princ ? " · principal" : ""}</span>`;
  }).join(" ");
}
function cctObrasTexto(c){
  if(!(c.papeis || []).includes("aprova_medicao")) return "";
  if(!c.obras.length) return "todas";
  return c.obras.map(id => { const o = _cctObras.find(x => x.id === id); return o ? o.codigo : "?"; }).join(", ");
}

function renderCliContatos(){
  const box = $("cli-ct-conteudo");
  if(!box) return;
  cctAtualizarBadge();
  const ordem = [..._cctContatos].sort((a, b) => (b.ativo - a.ativo) || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  const editar = cctPodeEditar();
  box.innerHTML = `<div id="cli-ct-form-box"></div>` + uiTabela({
    chaveLinha: "id",
    vazio: "Nenhum contato cadastrado. Use \"Novo contato\" para incluir quem cuida do comercial, quem aprova a medição e quem recebe a nota.",
    colunas: [
      { chave: "nome", rotulo: "Nome", html: c => `<strong>${esc(c.nome)}</strong>${c.cargo ? `<div class="meta">${esc(c.cargo)}</div>` : ""}` },
      { chave: "papeis", rotulo: "Papéis", html: cctChipsPapeis },
      { chave: "email", rotulo: "E-mail", html: c => c.email ? `<span class="cli-ct-email">${esc(c.email)}</span>` : "—" },
      { chave: "telefone", rotulo: "Telefone", html: c => esc(c.telefone || "—") },
      { chave: "obras", rotulo: "Obras (aprova)", html: c => esc(cctObrasTexto(c) || "—") },
      { chave: "ativo", rotulo: "Situação", html: c => c.ativo ? '<span class="tag verde">Ativo</span>' : '<span class="tag cinza">Inativo</span>' },
      { chave: "acao", rotulo: "", html: c => editar ? `<button type="button" class="ui-btn" data-cli-ct-editar="${esc(c.id)}">Editar</button>` : "" }
    ],
    linhas: ordem
  });
}

function cctFormHTML(c){
  const p = c ? c.papeis || [] : ["comercial"];
  const pr = c ? c.principal_em || [] : [];
  const ob = c ? c.obras || [] : [];
  const papeis = CCT_PAPEIS.map(([v, r]) => `<div class="cli-ct-papel">
      <label class="check-inline"><input type="checkbox" data-cli-ct-papel="${esc(v)}"${p.includes(v) ? " checked" : ""}> ${esc(r)}</label>
      <label class="check-inline cli-ct-princ" title="O principal do papel vai para o cadastro do cliente (contato, e-mail da proposta ou e-mail da nota)"><input type="checkbox" data-cli-ct-principal="${esc(v)}"${pr.includes(v) ? " checked" : ""}> principal</label>
    </div>`).join("");
  const obras = _cctObras.length
    ? _cctObras.map(o => `<label class="check-inline"><input type="checkbox" data-cli-ct-obra="${esc(o.id)}"${ob.includes(o.id) ? " checked" : ""}> <span class="ui-codigo">${esc(o.codigo)}</span> ${esc(o.nome || "")}</label>`).join("")
    : uiVazio("Cliente sem obras.");
  return `<div class="cli-ct-form" id="cli-ct-form" data-id="${esc(c ? c.id : "")}">
    <h3 class="cli-ct-form-tit">${c ? "Editar contato" : "Novo contato"}</h3>
    <div class="grade">
      ${  uiCampo({ id: "cli-ct-nome", rotulo: "Nome", valor: c ? c.nome : "", obrigatorio: true })}
      ${  uiCampo({ id: "cli-ct-cargo", rotulo: "Cargo", valor: c ? c.cargo : "", placeholder: "ex.: compras, fiscal da obra" })}
      ${  uiCampo({ id: "cli-ct-email", rotulo: "E-mail", tipo: "email", valor: c ? c.email : "" })}
      ${  uiCampo({ id: "cli-ct-tel", rotulo: "Telefone", tipo: "tel", valor: c ? c.telefone : "" })}
    </div>
    <fieldset class="cli-ct-grupo"><legend>Papéis</legend>${  papeis}</fieldset>
    <fieldset class="cli-ct-grupo" id="cli-ct-obras-box"${p.includes("aprova_medicao") ? "" : " hidden"}>
      <legend>Obras em que aprova a medição <span class="meta">(nenhuma marcada = todas as obras do cliente)</span></legend>
      <div class="cli-ct-obras">${  obras}</div>
    </fieldset>
    ${  uiCampo({ id: "cli-ct-obs", rotulo: "Observações", tipo: "textarea", valor: c ? c.observacoes : "", linhas: 2 })}
    <label class="check-inline"><input type="checkbox" id="cli-ct-ativo"${c && c.ativo === false ? "" : " checked"}> Ativo (inativo deixa de ser principal)</label>
    <div class="cli-ct-form-acoes">
      ${c ? '<button type="button" class="ui-btn ui-btn-perigo" data-cli-ct-acao="excluir">Excluir</button>' : ""}
      <button type="button" class="ui-btn" data-cli-ct-acao="cancelar">Cancelar</button>
      <button type="button" class="ui-btn ui-btn-prim" data-cli-ct-acao="salvar">Salvar contato</button>
    </div>
    <div id="cli-ct-msg"></div>
  </div>`;
}

function abrirCliContato(id){
  const box = $("cli-ct-form-box");
  if(!box || !cctPodeEditar()) return;
  const c = id ? _cctContatos.find(x => x.id === id) : null;
  box.innerHTML = cctFormHTML(c);
  $("cli-ct-nome")?.focus();
}

function cctLerForm(){
  const f = $("cli-ct-form");
  const v = id => ($(id)?.value || "").trim();
  const papeis = [...f.querySelectorAll("[data-cli-ct-papel]:checked")].map(x => x.dataset.cliCtPapel);
  return {
    id: f.dataset.id || null,
    reg: {
      nome: v("cli-ct-nome"), cargo: v("cli-ct-cargo") || null, email: v("cli-ct-email").toLowerCase() || null,
      telefone: v("cli-ct-tel") || null, observacoes: v("cli-ct-obs") || null, ativo: !!$("cli-ct-ativo")?.checked,
      papeis, principal_em: [...f.querySelectorAll("[data-cli-ct-principal]:checked")].map(x => x.dataset.cliCtPrincipal).filter(p => papeis.includes(p))
    },
    obras: papeis.includes("aprova_medicao") ? [...f.querySelectorAll("[data-cli-ct-obra]:checked")].map(x => x.dataset.cliCtObra) : []
  };
}


function cctValidar(reg){
  if(String(reg.nome || "").length < 2) return "Informe o nome do contato.";
  if(!reg.papeis.length) return "Marque pelo menos um papel.";
  if(reg.email && !CCT_EMAIL_RE.test(reg.email)) return "E-mail inválido.";
  return "";
}

async function salvarCliContato(){
  const { id, reg, obras } = cctLerForm();
  const msg = cctValidar(reg);
  const caixa = $("cli-ct-msg");
  if(msg){ if(caixa) caixa.innerHTML = uiErro(msg); return; }
  const r = id
    ? await sb.from("cliente_contatos").update(reg).eq("id", id).select("id").single()
    : await sb.from("cliente_contatos").insert({ ...reg, cliente_id: _cctCliente, origem: "manual" }).select("id").single();
  if(r.error){
    const txt = r.error.code === "23505" ? "Já existe um contato com este e-mail neste cliente." : "Não foi possível salvar: " + r.error.message;
    if(caixa) caixa.innerHTML = uiErro(txt);
    return;
  }
  const contatoId = r.data.id;
  const antes = id ? (_cctContatos.find(c => c.id === id)?.obras || []) : [];
  const tirar = antes.filter(o => !obras.includes(o));
  const por = obras.filter(o => !antes.includes(o));
  if(tirar.length){
    const d = await sb.from("cliente_contato_obras").delete().eq("contato_id", contatoId).in("obra_id", tirar);
    if(d.error){ if(caixa) caixa.innerHTML = uiErro("Contato salvo, mas as obras não: " + d.error.message); return; }
  }
  if(por.length){
    const i = await sb.from("cliente_contato_obras").insert(por.map(o => ({ contato_id: contatoId, obra_id: o })));
    if(i.error){ if(caixa) caixa.innerHTML = uiErro("Contato salvo, mas as obras não: " + i.error.message); return; }
  }
  uiAvisar("Contato salvo.", "ok");
  await cctRecarregarEspelho();
  carregarCliContatos(_cctCliente);
}

async function excluirCliContato(){
  const f = $("cli-ct-form");
  const id = f && f.dataset.id;
  if(!id) return;
  const c = _cctContatos.find(x => x.id === id);
  const ok = await uiConfirmar({ titulo: "Excluir contato", texto: `Excluir ${c ? c.nome : "o contato"}? Para guardar o histórico, prefira desmarcar "Ativo".`, confirmar: "Excluir", perigo: true });
  if(!ok) return;
  const { error } = await sb.from("cliente_contatos").delete().eq("id", id);
  if(error){ uiAvisar("Não foi possível excluir: " + error.message, "perigo"); return; }
  uiAvisar("Contato excluído.", "ok");
  await cctRecarregarEspelho();
  carregarCliContatos(_cctCliente);
}



async function cctRecarregarEspelho(){
  if(!_cctCliente || typeof cliEditId === "undefined" || cliEditId !== _cctCliente) return;
  const { data, error } = await sb.from("clientes").select("contato_nome,email,telefone,email_nf").eq("id", _cctCliente).single();
  if(error || !data) return;
  const por = (id, v) => { const el = $(id); if(el) el.value = v || ""; };
  por("cli-contato", data.contato_nome); por("cli-email", data.email); por("cli-tel", data.telefone); por("cli-email-nf", data.email_nf);
}


function cctAtualizarDatalistNf(){
  const inp = $("cli-email-nf"), dl = $("cli-ct-dl-nf");
  if(!inp || !dl) return;
  const fin = _cctContatos.filter(c => c.ativo && c.email && (c.papeis || []).includes("financeiro"));
  dl.innerHTML = fin.map(c => `<option value="${esc(c.email)}">${esc(c.nome)}</option>`).join("");
  if(fin.length) inp.setAttribute("list", "cli-ct-dl-nf"); else inp.removeAttribute("list");
  const dica = $("cli-ct-nf-dica");
  if(dica) dica.textContent = fin.length ? `Contatos Financeiro: ${fin.map(c => c.email).join(", ")}` : "";
}


function cctAvisoCliente(pend){
  const box = $("cli-ct-aviso");
  if(!box) return;
  const semFin = pend.some(p => p.tipo === "cliente_sem_financeiro");
  const obras = pend.filter(p => p.tipo === "obra_sem_aprovador").map(p => p.obra_codigo).filter(Boolean);
  const frases = [];
  if(semFin) frases.push("Cliente com obra em andamento sem contato Financeiro");
  if(obras.length) frases.push(`Sem "Aprova a medição": ${obras.join(", ")}`);
  box.innerHTML = frases.length ? uiFaixaSituacao(frases, "aviso") : "";
  box.hidden = !frases.length;
}

async function cctAvisoObra(obraId){
  const box = $("obr-cct-aviso");
  if(!box) return;
  box.innerHTML = ""; box.hidden = true;
  if(!obraId || _cctSemTabela) return;
  const { data, error } = await sb.from("vw_cliente_contatos_pendencias").select("tipo").eq("obra_id", obraId);
  if(error){ if(cctSemTabela(error)) _cctSemTabela = true; return; }
  if(!(data || []).length || (typeof obraEditId !== "undefined" && obraEditId !== obraId)) return;
  box.innerHTML = uiFaixaSituacao(["Obra em andamento sem contato \"Aprova a medição\"", "cadastre na aba Contatos do cliente ou na medição"], "aviso");
  box.hidden = false;
}


async function cctOrcCarregar(clienteId){
  const box = $("orc-ct-box"), sel = $("orc-ct-sel");
  if(!box || !sel) return;
  _cctOrcContatos = [];
  box.hidden = true;
  if(!clienteId || _cctSemTabela) return;
  const r = await cctLer(clienteId, true);
  if(r.erro || $("orc-cliente")?.value !== clienteId) return;
  _cctOrcContatos = r.contatos.filter(c => (c.papeis || []).includes("comercial"));
  sel.innerHTML = `<option value="">${_cctOrcContatos.length ? "— escolher contato Comercial —" : "— cliente sem contato Comercial —"}</option>`
    + _cctOrcContatos.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.email ? " · " + esc(c.email) : ""}${(c.principal_em || []).includes("comercial") ? " (principal)" : ""}</option>`).join("");
  const atual = String($("orc-contato-email")?.value || "").trim().toLowerCase();
  const nome = String($("orc-contato-nome")?.value || "").trim().toLowerCase();
  const achado = _cctOrcContatos.find(c => (atual && c.email === atual) || (!atual && nome && c.nome.toLowerCase() === nome));
  sel.value = achado ? achado.id : "";
  box.hidden = false;
  cctOrcBotao();
}

function cctOrcEscolher(){
  const c = _cctOrcContatos.find(x => x.id === $("orc-ct-sel")?.value);
  if(!c) return;
  const por = (id, v) => { const el = $(id); if(el){ el.value = v || ""; el.dispatchEvent(new Event("input", { bubbles: true })); } };
  por("orc-contato-nome", c.nome); por("orc-contato-tel", c.telefone); por("orc-contato-email", c.email);
  cctOrcBotao();
}


function cctOrcBotao(){
  const b = $("btn-orc-ct-gravar");
  if(!b) return;
  const nome = String($("orc-contato-nome")?.value || "").trim();
  const email = String($("orc-contato-email")?.value || "").trim().toLowerCase();
  const existe = _cctOrcContatos.some(c => (email && c.email === email) || c.nome.toLowerCase() === nome.toLowerCase());
  b.hidden = $("orc-ct-box")?.hidden || nome.length < 2 || existe || !cctPodeEditar();
}

async function cctOrcGravar(){
  const clienteId = $("orc-cliente")?.value;
  if(!clienteId) return;
  const reg = { cliente_id: clienteId, nome: String($("orc-contato-nome")?.value || "").trim(), papeis: ["comercial"], origem: "manual",
                email: String($("orc-contato-email")?.value || "").trim().toLowerCase() || null,
                telefone: String($("orc-contato-tel")?.value || "").trim() || null };
  const msg = cctValidar({ ...reg, papeis: ["comercial"] });
  if(msg){ uiAvisar(msg, "aviso"); return; }
  const { error } = await sb.from("cliente_contatos").insert(reg);
  if(error){ uiAvisar(error.code === "23505" ? "Este e-mail já é contato deste cliente." : "Não foi possível gravar o contato: " + error.message, "perigo"); return; }
  uiAvisar("Contato gravado no cadastro do cliente.", "ok");
  await cctOrcCarregar(clienteId);
}


async function cctOrcSugerirEmails(raiz, clienteId){
  const alvo = raiz && raiz.querySelector("#orc-env-sug"), para = raiz && raiz.querySelector("#orc-env-para");
  if(!alvo || !para || !clienteId || _cctSemTabela) return;
  const r = await cctLer(clienteId, true);
  if(r.erro || !raiz.isConnected) return;
  const lista = r.contatos.filter(c => c.email)
    .sort((a, b) => ((b.papeis || []).includes("comercial") - (a.papeis || []).includes("comercial")) || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  if(!lista.length) return;
  alvo.innerHTML = `<span class="meta">Contatos do cliente:</span> ` + lista.map(c =>
    `<button type="button" class="ui-filtro" data-cli-ct-sug="${esc(c.email)}" title="${esc((c.papeis || []).map(cctPapelRotulo).join(", "))}">${esc(c.nome)} · ${esc(c.email)}</button>`).join(" ");
  alvo.addEventListener("click", ev => {
    const b = ev.target.closest("[data-cli-ct-sug]");
    if(!b) return;
    const atuais = para.value.split(",").map(x => x.trim()).filter(Boolean);
    if(!atuais.map(x => x.toLowerCase()).includes(b.dataset.cliCtSug)) atuais.push(b.dataset.cliCtSug);
    para.value = atuais.join(", ");
    para.dispatchEvent(new Event("input", { bubbles: true }));
  });
}



async function cctMedPreencher(obraId, valor, orig){
  const campo = $("med-aprov-cli-campo"), sel = $("med-aprov-cli");
  if(!campo || !sel) return;
  const seq = ++_cctMedSeq;
  sel.dataset.orig = (orig === undefined ? valor : orig) || "";
  if(_cctSemTabela){ campo.hidden = true; return; }
  sel.innerHTML = '<option value="">— não informado —</option>';
  sel.value = "";
  campo.hidden = false;
  if(!obraId){ sel.disabled = true; return; }
  const { data: obra } = await sb.from("obras").select("cliente_id").eq("id", obraId).single();
  if(seq !== _cctMedSeq) return;
  if(!obra || !obra.cliente_id){ sel.disabled = true; return; }
  const r = await cctLer(obra.cliente_id, false);
  if(seq !== _cctMedSeq) return;
  if(r.erro){ if(_cctSemTabela) campo.hidden = true; return; }
  const validos = r.contatos.filter(c => (c.papeis || []).includes("aprova_medicao") && (!c.obras.length || c.obras.includes(obraId)));
  const lista = validos.filter(c => c.ativo || c.id === valor);
  sel.innerHTML = `<option value="">${lista.length ? "— não informado —" : "— cliente sem contato \"Aprova a medição\" —"}</option>`
    + lista.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}${c.cargo ? " · " + esc(c.cargo) : ""}${c.obras.length ? "" : " (todas as obras)"}</option>`).join("");
  if(valor && !lista.some(c => c.id === valor)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(valor)}">(contato que não aprova mais esta obra)</option>`);
  sel.value = valor || "";
  sel.disabled = false;
}


function cctMedParaGravar(){
  const campo = $("med-aprov-cli-campo"), sel = $("med-aprov-cli");
  if(!campo || !sel || campo.hidden || _cctSemTabela) return {};
  const v = sel.value || null;
  return (v || null) === (sel.dataset.orig || null) ? {} : { aprovador_cliente_contato_id: v };
}

async function cctNomeContato(id){
  if(!id) return "";
  const { data, error } = await sb.from("cliente_contatos").select("nome,cargo").eq("id", id).maybeSingle();
  if(error || !data) return "";
  return data.cargo ? `${data.nome} (${data.cargo})` : data.nome;
}


function ligarCliContatos(){
  $("btn-cli-ct-novo")?.addEventListener("click", () => abrirCliContato(null));
  $("cli-ct-conteudo")?.addEventListener("click", ev => {
    const ed = ev.target.closest("[data-cli-ct-editar]");
    if(ed){ abrirCliContato(ed.dataset.cliCtEditar); return; }
    const ac = ev.target.closest("[data-cli-ct-acao]");
    if(!ac) return;
    if(ac.dataset.cliCtAcao === "salvar") comBotaoTravado(ac, salvarCliContato);
    else if(ac.dataset.cliCtAcao === "excluir") excluirCliContato();
    else { const box = $("cli-ct-form-box"); if(box) box.innerHTML = ""; }
  });
  $("cli-ct-conteudo")?.addEventListener("change", ev => {
    const p = ev.target.closest("[data-cli-ct-papel]");
    if(p && p.dataset.cliCtPapel === "aprova_medicao"){ const o = $("cli-ct-obras-box"); if(o) o.hidden = !p.checked; }
    const pr = ev.target.closest("[data-cli-ct-principal]");
    if(pr && pr.checked){
      const papel = document.querySelector(`[data-cli-ct-papel="${pr.dataset.cliCtPrincipal}"]`);
      if(papel && !papel.checked){ papel.checked = true; if(pr.dataset.cliCtPrincipal === "aprova_medicao"){ const o = $("cli-ct-obras-box"); if(o) o.hidden = false; } }
    }
  });

  $("orc-cliente")?.addEventListener("change", () => cctOrcCarregar($("orc-cliente").value));
  $("orc-ct-sel")?.addEventListener("change", cctOrcEscolher);
  ["orc-contato-nome", "orc-contato-email"].forEach(id => $(id)?.addEventListener("input", debounce(cctOrcBotao)));
  $("btn-orc-ct-gravar")?.addEventListener("click", () => comBotaoTravado("btn-orc-ct-gravar", cctOrcGravar));

  $("med-obra")?.addEventListener("change", () => cctMedPreencher($("med-obra").value, "", $("med-aprov-cli")?.dataset.orig || ""));
}

if(typeof module !== "undefined" && module.exports){
  module.exports = { CCT_PAPEIS, cctValidar, cctSemTabela, cctPapelRotulo };
}

if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarCliContatos);
  else ligarCliContatos();
}

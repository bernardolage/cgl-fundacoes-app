/* ====================================================================
   Módulo: Usuários — gestão de logins (apenas admin)
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   ==================================================================== */

const CARGOS = {
  diretor:      "Diretor",        /* acesso total — has_role() no banco sempre passa */
  admin:        "Administrador",
  engenheiro:   "Engenheiro",
  comercial:    "Comercial",
  financeiro:   "Financeiro",
  comprador:    "Comprador",
  almoxarife:   "Almoxarife",
  mecanico:     "Mecânico",
  encarregado:  "Encarregado",
  operador:     "Operador",
  visualizador: "Visualizador"
};

let _usuarios   = [];
let _usrView    = "lista";
let usrEditId   = null;
let usrEditEmail = null;

/* ---------- Carga ---------- */
async function carregarUsuarios(){
  const { data, error } = await sb.from("profiles")
    .select("id,nome,email,cargo,telefone,ativo,created_at")
    .order("nome");
  _usuarios = error ? [] : (data || []);
  renderUsuarios();
}

/* ---------- Filtros ---------- */
function usrFiltrados(){
  const termo = ($("usr-busca")?.value || "").trim().toLowerCase();
  const fCargo = $("usr-f-cargo")?.value || "";
  const fAtivo = $("usr-f-ativo")?.value || "";
  return _usuarios.filter(u => {
    if(fCargo && u.cargo !== fCargo) return false;
    if(fAtivo === "ativos" && u.ativo === false) return false;
    if(fAtivo === "inativos" && u.ativo !== false) return false;
    if(termo){
      const alvo = `${u.nome||""} ${u.email||""} ${CARGOS[u.cargo]||u.cargo||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function preencherFiltrosUsr(){
  const sel = $("usr-f-cargo");
  if(sel && !sel.options.length){
    sel.innerHTML = `<option value="">Todos os cargos</option>` +
      Object.entries(CARGOS).map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  }
}

/* ---------- Render ---------- */
function renderUsuarios(){
  preencherFiltrosUsr();
  const dados = usrFiltrados();
  const cont = $("usr-contador");
  if(cont) cont.textContent = `${dados.length} de ${_usuarios.length}`;
  if(_usrView === "kanban") renderUsrKanban(dados);
  else                       renderUsrLista(dados);
  const legacy = $("tab-usuarios");
  if(legacy) legacy.innerHTML = "";
}

function renderUsrLista(dados){
  const cont = $("usr-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhum usuário encontrado.</p>`;
    return;
  }
  const linhas = dados.map(u => `<tr class="linha-clicavel" data-id="${esc(u.id)}">
    <td>${esc(u.nome||"—")}</td>
    <td>${esc(u.email||"—")}</td>
    <td>${esc(CARGOS[u.cargo] || u.cargo || "—")}</td>
    <td>${esc(u.telefone||"—")}</td>
    <td>${tagSituacao(u.ativo)}</td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nome</th><th>E-mail</th><th>Cargo</th><th>Telefone</th><th>Situação</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderUsrKanban(dados){
  const cont = $("usr-conteudo");
  if(!cont) return;
  // Agrupa por cargo
  const grupos = {};
  dados.forEach(u => {
    const k = CARGOS[u.cargo] || u.cargo || "Sem cargo";
    if(!grupos[k]) grupos[k] = [];
    grupos[k].push(u);
  });
  const nomes = Object.keys(grupos).sort();
  const colunas = nomes.map(nome => {
    const itens = grupos[nome];
    const cards = itens.map(u => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(u.id)}">
        <div class="serv-kan-card-nome">${esc(u.nome || "—")}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${esc(u.email || "—")}</span>
        </div>
        <div class="serv-kan-card-rod">
          <span>${esc(u.telefone || "")}</span>
          ${tagSituacao(u.ativo)}
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col">
      <div class="serv-kan-col-head">${esc(nome)}<span>${itens.length}</span></div>
      ${cards}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelUsr(){
  $("usr-painel").style.display = "";
  $("usr-ficha").style.display = "none";
  usrEditId = null;
  usrEditEmail = null;
}

function preencherCargosFicha(){
  $("usr-cargo").innerHTML = Object.entries(CARGOS)
    .map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
}

function novoUsuario(){
  preencherCargosFicha();
  usrEditId = null;
  usrEditEmail = null;
  $("usr-email").value = "";
  $("usr-email").disabled = false;
  $("usr-nome-input").value = "";
  $("usr-cargo").value = "visualizador";
  $("usr-telefone").value = "";
  $("usr-ativo").checked = true;
  $("btn-reset-senha-usr").style.display = "none";
  $("btn-salvar-usr").textContent = "📨 Enviar convite";
  abrirFichaUsrVisual({ nome: "(novo)", cargo: "visualizador", ativo: true });
}

function abrirUsuario(id){
  preencherCargosFicha();
  const u = _usuarios.find(x => x.id === id);
  if(!u){ aviso("app-aviso","Usuário não encontrado.","erro"); return; }
  usrEditId = id;
  usrEditEmail = u.email;
  $("usr-email").value     = u.email || "";
  $("usr-email").disabled  = true;
  $("usr-nome-input").value= u.nome || "";
  $("usr-cargo").value     = u.cargo || "visualizador";
  $("usr-telefone").value  = u.telefone || "";
  $("usr-ativo").checked   = u.ativo !== false;
  $("btn-reset-senha-usr").style.display = "";
  $("btn-salvar-usr").textContent = "💾 Salvar alterações";
  abrirFichaUsrVisual(u);
}

function abrirFichaUsrVisual(u){
  $("usr-painel").style.display = "none";
  $("usr-ficha").style.display = "";

  $("usr-ficha-nome").textContent = u.nome || "(novo)";
  $("usr-ficha-cargo-chip").textContent = CARGOS[u.cargo] || u.cargo || "—";
  $("usr-ficha-email-chip").textContent = u.email || "—";
  $("usr-ficha-tel-chip").textContent = u.telefone || "—";
  $("usr-ficha-ativo-chip").innerHTML = (u.ativo === false)
    ? '<span class="tag vermelho">Inativo</span>'
    : '<span class="tag verde">Ativo</span>';
  $("usr-ficha-titulo").textContent = usrEditId ? u.nome : "Convidar usuário";

  ativarTabUsr("perfil");
}

function ativarTabUsr(nome){
  document.querySelectorAll("#usr-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#usr-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}

/* ---------- Salvar (convite ou update) ---------- */
async function salvarUsuario(){
  const btn = $("btn-salvar-usr");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = usrEditId ? "Salvando..." : "Enviando convite...";

  const nome     = $("usr-nome-input").value.trim();
  const cargo    = $("usr-cargo").value;
  const telefone = $("usr-telefone").value.trim() || null;
  const ativo    = $("usr-ativo").checked;

  try {
    if(usrEditId){
      const { error } = await sb.from("profiles")
        .update({ nome, cargo, telefone, ativo })
        .eq("id", usrEditId);
      if(error) throw error;
      aviso("app-aviso","Usuário atualizado.","ok");
    } else {
      const email = $("usr-email").value.trim().toLowerCase();
      if(!email){ aviso("app-aviso","Informe o e-mail.","erro"); return; }
      const { data:{ session } } = await sb.auth.getSession();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/convidar-usuario`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token || ""}`,
          "apikey": SUPABASE_KEY
        },
        body: JSON.stringify({
          email, nome, cargo, telefone,
          /* URL completa do app (com subcaminho — ex.: /cgl-fundacoes-app/)
             para o link do convite voltar exatamente para cá; em file://
             não há URL válida e a function usa o Site URL do Supabase */
          redirect_to: location.protocol.startsWith("http")
            ? location.origin + location.pathname
            : undefined
        })
      });
      const body = await resp.json().catch(()=> ({}));
      if(!resp.ok){
        const msg = body?.error || `Falha no convite (HTTP ${resp.status})`;
        aviso("app-aviso", msg, "erro");
        return;
      }
      if(body.warning){
        aviso("app-aviso", body.warning, "erro");
      } else {
        aviso("app-aviso", `Convite enviado para ${email}.`, "ok");
      }
    }
    await carregarUsuarios();
    if(typeof carregarResponsaveis === "function") await carregarResponsaveis();
    mostrarPainelUsr();
  } catch (err) {
    aviso("app-aviso", "Erro: " + (err?.message || err), "erro");
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

async function resetarSenhaUsr(){
  if(!usrEditEmail) return;
  if(!confirm(`Enviar link de redefinição de senha para ${usrEditEmail}?`)) return;
  const btn = $("btn-reset-senha-usr");
  btn.disabled = true;
  const txt = btn.textContent;
  btn.textContent = "Enviando...";
  const { error } = await sb.auth.resetPasswordForEmail(usrEditEmail, {
    redirectTo: location.origin + location.pathname
  });
  btn.disabled = false;
  btn.textContent = txt;
  if(error){
    aviso("app-aviso","Não foi possível enviar: "+error.message,"erro");
  } else {
    aviso("app-aviso", `Link enviado para ${usrEditEmail}.`, "ok");
  }
}

/* ---------- Listeners ---------- */
function ligarUsuarios(){
  document.querySelectorAll("#usr-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#usr-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _usrView = b.dataset.view;
      renderUsuarios();
    });
  });
  ["usr-busca","usr-f-cargo","usr-f-ativo"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "usr-busca" ? "input" : "change", renderUsuarios);
  });
  $("usr-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirUsuario(tr.dataset.id);
  });

  $("btn-novo-usuario")?.addEventListener("click", novoUsuario);
  $("btn-voltar-usr")?.addEventListener("click", mostrarPainelUsr);
  $("btn-salvar-usr")?.addEventListener("click", salvarUsuario);
  $("btn-reset-senha-usr")?.addEventListener("click", resetarSenhaUsr);

  document.querySelectorAll("#usr-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabUsr(b.dataset.tab));
  });

  const navUsr = document.querySelector('nav button[data-secao="usuarios"]');
  if(navUsr) navUsr.addEventListener("click", mostrarPainelUsr);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarUsuarios);
} else {
  ligarUsuarios();
}

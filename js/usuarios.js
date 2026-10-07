/* ====================================================================
   Módulo: Usuários — gestão de logins (apenas admin)
   Layout: padrão Serviços + Odoo. Ver memória feedback-padrao-ui.
   ==================================================================== */

const CARGOS = {
  diretor:      "Diretor",        /* acesso total — has_role() no banco sempre passa */
  admin:        "Administrador",
  engenheiro:   "Engenheiro",
  assistente_engenharia: "Assistente de engenharia",  /* RDO + pendências (fase 39) */
  comercial:    "Comercial",
  financeiro:   "Financeiro",
  comprador:    "Comprador",
  almoxarife:   "Almoxarife",
  gestor_acessorios: "Gestor de acessórios",  /* trados, pontas, hastes, camisas… (fase 46) */
  mecanico:     "Mecânico",
  encarregado:  "Encarregado",
  operador:     "Operador",
  rh:           "RH (folha e dados sensíveis)",   /* só diretor atribui — trigger proteger_cargo_rh */
  sesmt:        "SESMT",
  logistica:    "Logística",
  gestor_frota: "Gestor de frota",  /* frota, equipamentos, manutenção/OS, requisições e compras (fase 77) */
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
  carregarRespServico();
}

/* ---------- Responsáveis por serviço (fase 75) ----------
   Tabela responsaveis_servico: destino dos avisos de "Para regularizar" no Início.
   Leitura para todo usuário ativo; escrita só diretor e admin (is_admin() no banco). */
const RESP_AREA  = { obras: "Obras e equipamentos", acessorios: "Acessórios" };
const RESP_TIPO  = { estaca_raiz: "Estaca raiz", helice_continua: "Hélice contínua", helice_secante: "Hélice secante", trado_mecanizado: "Trado mecanizado" };
const RESP_PAPEL = { gestor: "Gestor (indica o engenheiro de cada obra)", responsavel: "Responsável", acompanha: "Acompanha" };
const RESP_PAPEIS_AREA = { obras: ["gestor", "acompanha"], acessorios: ["responsavel", "acompanha"] };
let _respServico = [];

async function carregarRespServico(){
  const card = $("usr-resp-card");
  if(!card) return;
  const pode = ["diretor", "admin"].includes(usuarioAtual?.cargo);
  card.style.display = pode ? "" : "none";
  if(!pode) return;
  const { data, error } = await sb.from("responsaveis_servico")
    .select("id,area,tipo_servico,profile_id,papel,pessoa:profiles(nome,ativo)");
  const cont = $("usr-resp-conteudo");
  if(error){ if(cont) cont.innerHTML = `<p class="vazio">Não foi possível carregar (${esc(error.message)}).</p>`; return; }
  _respServico = data || [];
  renderRespServico();
}

function respPreencherPapel(){
  const area = $("usr-resp-area")?.value || "obras";
  const sel = $("usr-resp-papel");
  if(sel) sel.innerHTML = RESP_PAPEIS_AREA[area].map(p => `<option value="${p}">${esc(RESP_PAPEL[p])}</option>`).join("");
}

function renderRespServico(){
  const cont = $("usr-resp-conteudo");
  if(!cont) return;
  const pessoa = $("usr-resp-pessoa");
  if(pessoa) preencherSelect(pessoa, _usuarios.filter(u => u.ativo !== false), "id", "nome", "— pessoa —");
  if($("usr-resp-papel") && !$("usr-resp-papel").options.length) respPreencherPapel();
  if($("usr-resp-contador")) $("usr-resp-contador").textContent = `(${_respServico.length})`;
  const ordArea = Object.keys(RESP_AREA), ordTipo = Object.keys(RESP_TIPO), ordPapel = ["gestor", "responsavel", "acompanha"];
  const linhas = [..._respServico].sort((a, b) => ordArea.indexOf(a.area) - ordArea.indexOf(b.area)
    || ordTipo.indexOf(a.tipo_servico) - ordTipo.indexOf(b.tipo_servico) || ordPapel.indexOf(a.papel) - ordPapel.indexOf(b.papel));
  cont.innerHTML = linhas.length ? `<div class="tabela-rola"><table>
    <thead><tr><th>Área</th><th>Serviço</th><th>Pessoa</th><th>Papel</th><th class="col-acao"></th></tr></thead>
    <tbody>${linhas.map(r => `<tr>
      <td>${esc(RESP_AREA[r.area] || r.area)}</td><td>${esc(RESP_TIPO[r.tipo_servico] || r.tipo_servico)}</td>
      <td>${esc(r.pessoa?.nome || "—")}${r.pessoa && r.pessoa.ativo === false ? ' <span class="tag cinza">inativo</span>' : ""}</td>
      <td><select data-resp-papel="${esc(r.id)}" title="Trocar o papel">${(RESP_PAPEIS_AREA[r.area] || []).map(p => `<option value="${p}" ${p === r.papel ? "selected" : ""}>${esc(RESP_PAPEL[p])}</option>`).join("")}</select></td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm txt-perigo" data-resp-del="${esc(r.id)}" title="Remover">🗑️</button></td>
    </tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Nenhum responsável cadastrado: os avisos de cadastro ficam só no total da diretoria.</p>`;
}

async function salvarRespServico(){
  const reg = { area: $("usr-resp-area").value, tipo_servico: $("usr-resp-tipo").value,
                profile_id: $("usr-resp-pessoa").value, papel: $("usr-resp-papel").value };
  if(!reg.profile_id){ aviso("app-aviso", "Escolha a pessoa.", "erro"); return; }
  const { error } = await sb.from("responsaveis_servico").insert(reg);
  if(error){
    const m = (error.message || "").toLowerCase();
    aviso("app-aviso", m.includes("duplicate") || m.includes("unique")
      ? "Essa pessoa já está nesse serviço: troque o papel na própria linha."
      : "Não foi possível salvar: " + error.message, "erro");
    return;
  }
  aviso("app-aviso", "Responsável adicionado.", "ok");
  await carregarRespServico();
}

async function trocarPapelRespServico(id, papel){
  const { error } = await sb.from("responsaveis_servico").update({ papel }).eq("id", id);
  if(error) aviso("app-aviso", "Não foi possível trocar o papel: " + error.message, "erro");
  else aviso("app-aviso", "Papel atualizado.", "ok");
  await carregarRespServico();
}

async function excluirRespServico(id){
  const r = _respServico.find(x => x.id === id);
  if(!r || !confirm(`Remover ${r.pessoa?.nome || "esta pessoa"} de ${RESP_TIPO[r.tipo_servico]} (${RESP_AREA[r.area]})?`)) return;
  const { error } = await sb.from("responsaveis_servico").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
  await carregarRespServico();
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
  // perfil RH (vê salários e dados pessoais): só a diretoria atribui
  $("usr-cargo").innerHTML = Object.entries(CARGOS)
    .filter(([v]) => v !== "rh" || usuarioAtual?.cargo === "diretor")
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
        .update({ nome, cargo, telefone })
        .eq("id", usrEditId);
      if(error) throw error;
      // Fase 62: ativar/desativar passa pela function (ban no login + profiles.ativo)
      const antes = _usuarios.find(x => x.id === usrEditId);
      if(antes && (antes.ativo !== false) !== ativo){
        const { data:{ session } } = await sb.auth.getSession();
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/convidar-usuario`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token || ""}`,
            "apikey": SUPABASE_KEY
          },
          body: JSON.stringify({ acao: ativo ? "reativar" : "desativar", user_id: usrEditId })
        });
        const body = await resp.json().catch(()=> ({}));
        if(!resp.ok){
          aviso("app-aviso", "Dados salvos, mas não foi possível " + (ativo ? "reativar" : "desativar") + " o usuário: " +
            (body?.error || `HTTP ${resp.status}`), "erro");
          await carregarUsuarios();
          return;
        }
      }
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

  // Responsáveis por serviço (fase 75)
  $("usr-resp-area")?.addEventListener("change", respPreencherPapel);
  $("btn-usr-resp-add")?.addEventListener("click", () => comBotaoTravado("btn-usr-resp-add", salvarRespServico));
  $("usr-resp-conteudo")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-resp-del]");
    if(b) excluirRespServico(b.dataset.respDel);
  });
  $("usr-resp-conteudo")?.addEventListener("change", (e) => {
    const s = e.target.closest("[data-resp-papel]");
    if(s) trocarPapelRespServico(s.dataset.respPapel, s.value);
  });

  const navUsr = document.querySelector('nav button[data-secao="usuarios"]');
  if(navUsr) navUsr.addEventListener("click", mostrarPainelUsr);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarUsuarios);
} else {
  ligarUsuarios();
}

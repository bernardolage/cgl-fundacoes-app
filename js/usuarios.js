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
  visualizador: "Visualizador",
  auditor:      "Auditor (só leitura)",  /* usuário de revisão: vê o que a diretoria vê, menos dados sensíveis; não grava (fase 79) */
  auxiliar_almoxarifado: "Auxiliar de almoxarifado",  /* equipe do Julio: estoque, separações, produtos (consulta) e peças dos reparos; sem obras, compras nem valores (fase 90) */
  gestor_manutencao: "Gestor de manutenção"  /* Bruno: OS, planos preventivos, checklists e compras do setor; sem obras, medições nem contas a pagar (fase 92) */
};

let _usuarios   = [];
let _usrView    = "lista";
let usrEditId   = null;
let usrEditEmail = null;

/* ---------- Carga ---------- */
async function carregarUsuarios(){
  // fase 93b: login_cpf e senha_provisoria; se a migration da 93b ainda não estiver no banco (42703), lê sem elas
  // hotfix 147: + função cadastrada pelo RH (embed pela FK profiles.funcionario_id; nulo sem funcionário ligado).
  // Sem a relação (PGRST200) ou sem coluna (42703), lê como antes
  const cols = "id,nome,email,cargo,telefone,ativo,created_at,login_cpf,senha_provisoria,modulos_extras,modulos_extras_ate";
  let { data, error } = await sb.from("profiles")
    .select(cols + ",funcionario:funcionarios!profiles_funcionario_id_fkey(funcao)")
    .order("nome");
  if(error && (error.code === "PGRST200" || error.code === "42703")){
    ({ data, error } = await sb.from("profiles").select(cols).order("nome"));
  }
  if(error && error.code === "42703"){
    ({ data, error } = await sb.from("profiles").select("id,nome,email,cargo,telefone,ativo,created_at").order("nome"));
  }
  _usuarios = error ? [] : (data || []);
  renderUsuarios();
  carregarRespServico();
  carregarPoliticaSessaoCard();
  carregarPalavrasEtapaCard();   // fase 94
  carregarFiscalEmpresaCard();   // fase 105a
}

/* ---------- Dados fiscais da empresa (fase 105a) ----------
   Mesmo bloco da visão "Pendências fiscais" de Clientes (js/fiscal.js). Aqui aparece para quem vê Usuários (diretor e
   admin); grava só o diretor (podeEmitirFiscal / fiscal_pode_emitir: admin fora, decisão 6 do Bernardo). */
function carregarFiscalEmpresaCard(){
  const card = $("usr-fiscal-card");
  if(!card || typeof fiscalEmpresaRender !== "function") return;
  const pode = ["diretor", "admin"].includes(usuarioAtual?.cargo);
  card.style.display = pode ? "" : "none";
  if(pode) fiscalEmpresaRender("usr-fe");
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

/* ---------- Política de sessão (fase 87) ----------
   Card no painel, só diretor e admin (empresa_config_admin_write no banco). Os prazos valem para quem
   entrar ou recarregar depois de salvos (e para esta aba, na hora). "Encerrar todas" é só da diretoria:
   duas confirmações e motivo; a RPC apaga auth.sessions (menos a sessão de quem clicou) e registra em
   registros_log. "Encerrar sessões" de um usuário fica na ficha, ao lado de Resetar senha. */
async function carregarPoliticaSessaoCard(){
  const card = $("usr-sessao-card");
  if(!card) return;
  const pode = ["diretor", "admin"].includes(usuarioAtual?.cargo);
  card.style.display = pode ? "" : "none";
  if(!pode) return;
  const { data, error } = await sb.from("empresa_config")
    .select("sessao_inatividade_min,sessao_maxima_h,sessao_lembrar_dias,sessao_mfa_cargos,sessoes_revogadas_em")
    .eq("id", 1).maybeSingle();
  if(error || !data){ aviso("app-aviso", "Não foi possível ler a política de sessão" + (error ? ": " + error.message : "."), "erro"); return; }
  $("usr-sessao-inatividade").value = data.sessao_inatividade_min ?? 240;
  $("usr-sessao-maxima").value      = data.sessao_maxima_h ?? 12;
  $("usr-sessao-lembrar").value     = data.sessao_lembrar_dias ?? 7;
  const marcados = new Set(data.sessao_mfa_cargos || []);
  $("usr-sessao-mfa-cargos").innerHTML = Object.entries(CARGOS)
    .map(([v, l]) => `<label class="check-inline"><input type="checkbox" data-mfa-cargo="${esc(v)}" ${marcados.has(v) ? "checked" : ""} /> ${esc(l)}</label>`).join("");
  $("usr-sessao-revogadas").textContent = data.sessoes_revogadas_em
    ? "Última vez que todas as sessões foram encerradas: " + new Date(data.sessoes_revogadas_em).toLocaleString("pt-BR") : "";
  $("btn-usr-sessoes-todas").style.display = usuarioAtual?.cargo === "diretor" ? "" : "none";
}

async function salvarPoliticaSessao(){
  const n = (id, min, max) => { const v = Number($(id).value); return Number.isInteger(v) && v >= min && v <= max ? v : null; };
  const reg = {
    sessao_inatividade_min: n("usr-sessao-inatividade", 1, 1440),
    sessao_maxima_h:        n("usr-sessao-maxima", 1, 168),
    sessao_lembrar_dias:    n("usr-sessao-lembrar", 1, 90),
    sessao_mfa_cargos:      Array.from(document.querySelectorAll("#usr-sessao-mfa-cargos input:checked")).map(i => i.dataset.mfaCargo),
    updated_at: new Date().toISOString()
  };
  if(reg.sessao_inatividade_min == null || reg.sessao_maxima_h == null || reg.sessao_lembrar_dias == null){
    aviso("app-aviso", "Prazos inválidos: inatividade de 1 a 1440 min, sessão máxima de 1 a 168 h, manter conectado de 1 a 90 dias.", "erro");
    return;
  }
  if(!reg.sessao_mfa_cargos.includes("diretor") && !confirm("Diretor fora da lista de MFA obrigatório. Tem certeza?")) return;
  const { error } = await sb.from("empresa_config").update(reg).eq("id", 1);
  if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  aviso("app-aviso", "Política de sessão salva. Vale para quem entrar ou recarregar a partir de agora (e já nesta aba).", "ok");
  if(typeof carregarPoliticaSessao === "function") await carregarPoliticaSessao();
}

/* ---------- fase 94 (#75): palavras que marcam a estaca como executada pela observação do RDO ----------
   empresa_config.rdo_palavras_etapa_final, só diretor e admin (empresa_config_admin_write). O gatilho do banco
   (fn_rdo_exec_etapa_final) usa a lista na ordem; o front espelha em rdoEtapaFinal (js/rdo.js). */
async function carregarPalavrasEtapaCard(){
  const card = $("usr-rdo-card");
  if(!card) return;
  const pode = ["diretor", "admin"].includes(usuarioAtual?.cargo);
  card.style.display = pode ? "" : "none";
  if(!pode) return;
  const { data, error } = await sb.from("empresa_config").select("rdo_palavras_etapa_final").eq("id", 1).maybeSingle();
  if(error){ aviso("app-aviso", "Não foi possível ler as palavras de etapa final: " + error.message, "erro"); return; }
  $("usr-rdo-palavras").value = (data?.rdo_palavras_etapa_final || []).join(", ");
  // fase 101 (#99): classificações do solo (coluna nova; sem a migration o campo fica vazio e o salvar avisa)
  const sol = await sb.from("empresa_config").select("rdo_solo_classificacoes").eq("id", 1).maybeSingle();
  if($("usr-rdo-solo")) $("usr-rdo-solo").value = sol.error ? "" : (sol.data?.rdo_solo_classificacoes || []).join(", ");
}
async function salvarSoloClassificacoes(){
  const lista = [...new Set(($("usr-rdo-solo")?.value || "").split(/[,;\n]/).map(s => s.trim()).filter(Boolean))];
  if(!lista.length){ aviso("app-aviso", "Informe ao menos uma classificação (ex.: Argila, Rocha alterada).", "erro"); return; }
  const { error } = await sb.from("empresa_config").update({ rdo_solo_classificacoes: lista, updated_at: new Date().toISOString() }).eq("id", 1);
  if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  if(typeof _rdoSoloClassif !== "undefined") _rdoSoloClassif = null;   // o RDO relê na próxima abertura
  $("usr-rdo-solo").value = lista.join(", ");
  aviso("app-aviso", "Classificações salvas. Aparecem como sugestão nas camadas do RDO de raiz.", "ok");
}
async function salvarPalavrasEtapa(){
  const lista = [...new Set($("usr-rdo-palavras").value.split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean))];
  if(!lista.length){ aviso("app-aviso", "Informe ao menos uma palavra (ex.: injeção, concretagem, argamassado).", "erro"); return; }
  const { error } = await sb.from("empresa_config").update({ rdo_palavras_etapa_final: lista, updated_at: new Date().toISOString() }).eq("id", 1);
  if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  if(typeof _rdoPalavrasEtapa !== "undefined") _rdoPalavrasEtapa = null;   // a grade do RDO relê na próxima abertura
  $("usr-rdo-palavras").value = lista.join(", ");
  aviso("app-aviso", "Palavras salvas. Valem para as execuções gravadas a partir de agora.", "ok");
}

async function encerrarSessoesUsr(){
  if(!usrEditId) return;
  const u = _usuarios.find(x => x.id === usrEditId);
  const nome = u?.nome || "este usuário";
  if(!confirm(`Encerrar as sessões abertas de ${nome}? Ele sai do sistema em todos os aparelhos e precisa entrar de novo.`)) return;
  const { data, error } = await sb.rpc("sessoes_encerrar_usuario", { p_user: usrEditId, p_motivo: "ficha do usuário" });
  if(error){ aviso("app-aviso", "Não foi possível encerrar as sessões: " + error.message, "erro"); return; }
  const n = Number(data) || 0;
  aviso("app-aviso", n ? `${n} sessão(ões) de ${nome} encerrada(s). As abas abertas saem em até 5 min.` : `${nome} não tinha sessão aberta.`, "ok");
}

async function encerrarTodasSessoes(){
  if(usuarioAtual?.cargo !== "diretor"){ aviso("app-aviso", "Só a diretoria encerra todas as sessões.", "erro"); return; }
  const motivo = prompt("Encerrar TODAS as sessões (todos os usuários, em todos os aparelhos). Esta é a emergência da diretoria.\n\nMotivo (fica no histórico):");
  if(motivo === null) return;
  if(!motivo.trim()){ aviso("app-aviso", "Informe o motivo.", "erro"); return; }
  const conf = prompt("Segunda confirmação: digite ENCERRAR para derrubar todo mundo (a sua sessão nesta aba continua).");
  if((conf || "").trim().toUpperCase() !== "ENCERRAR"){ aviso("app-aviso", "Cancelado: a confirmação não foi digitada.", "aviso"); return; }
  const { data, error } = await sb.rpc("sessoes_encerrar_todas", { p_motivo: motivo.trim() });
  if(error){ aviso("app-aviso", "Não foi possível encerrar as sessões: " + error.message, "erro"); return; }
  aviso("app-aviso", `${Number(data) || 0} sessão(ões) encerrada(s). Quem estava com o app aberto sai em até 5 min; quem entrar agora entra normalmente.`, "ok");
  await carregarPoliticaSessaoCard();
}

/* ---------- Login por CPF (fase 93b) ----------
   Perfil criado pelo RH na aba Acesso da ficha do funcionário: o usuário entra com o CPF e profiles.email guarda
   só uma máscara (<uuid>@funcionarios.cglfundacoes.com.br). A tela nunca mostra e-mail para esses perfis — diz
   "login: CPF" —, não oferece "Resetar senha" (sem caixa postal; a nova senha sai da ficha do funcionário) e o
   campo E-mail da ficha fica só informativo. */
function usrLoginRotulo(u){
  if(u?.login_cpf) return `<span class="tag azul" title="Criado pelo RH na ficha do funcionário; entra com o CPF">login: CPF</span>${u.senha_provisoria ? ' <span class="tag ambar" title="Ainda não trocou a senha definida pelo RH">senha provisória</span>' : ""}`;
  return esc(u?.email || "—");
}
/* hotfix 147 (chamado #147): no login por CPF o que aparece é a função cadastrada pelo RH (funcionarios.funcao); o
   cargo de permissão é o "perfil de acesso" e fica em segundo plano. Convidado por e-mail: null (tudo como antes). */
function usrFuncaoRH(u){
  if(!u?.login_cpf) return null;
  return String(u.funcionario?.funcao || "").trim() || null;
}
function usrCargoRotulo(u){ return CARGOS[u?.cargo] || u?.cargo || "—"; }

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
      const alvo = `${u.nome||""} ${u.login_cpf ? "login cpf" : (u.email||"")} ${CARGOS[u.cargo]||u.cargo||""} ${usrFuncaoRH(u)||""}`.toLowerCase();   // hotfix 147: + função do RH
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
  // hotfix 147: login por CPF mostra a função do RH e, embaixo, o perfil de acesso; convidado por e-mail, o cargo
  const linhas = dados.map(u => {
    const funcao = usrFuncaoRH(u);
    return `<tr class="linha-clicavel" data-id="${esc(u.id)}">
    <td>${esc(u.nome||"—")}</td>
    <td>${usrLoginRotulo(u)}</td>
    <td>${funcao ? `${esc(funcao)}<div class="meta">perfil: ${esc(usrCargoRotulo(u))}</div>` : esc(usrCargoRotulo(u))}</td>
    <td>${esc(u.telefone||"—")}</td>
    <td>${tagSituacao(u.ativo)}</td>
  </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nome</th><th>E-mail / login</th><th>Função / perfil</th><th>Telefone</th><th>Situação</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderUsrKanban(dados){
  const cont = $("usr-conteudo");
  if(!cont) return;
  // Agrupa por cargo. Hotfix 147: login por CPF fica no grupo do perfil de acesso ("Mecânico · perfil de acesso"),
  // separado do cargo de quem foi convidado por e-mail, e o cartão mostra a função do RH
  const grupos = {};
  dados.forEach(u => {
    const rot = CARGOS[u.cargo] || u.cargo || "Sem cargo";
    const k = u.login_cpf ? `${rot} · perfil de acesso` : rot;
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
          ${usrFuncaoRH(u) ? `<span class="meta bloco">${esc(usrFuncaoRH(u))}</span>` : ""}
          <span class="meta">${usrLoginRotulo(u)}</span>
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
  usrGarantirChecksExtras();
}

/* Módulos extras (hotfix 113; lote S51 #150): acesso a um módulo além do cargo, por usuário, com UMA validade para todos
   (profiles.modulos_extras_ate). Só diretoria/admin gravam (gatilho no banco); o check profiles_modulos_extras_chk lista os
   valores aceitos. O checkbox de Orçamentos nasce no index.html; os demais são criados aqui, no mesmo campo. */
const USR_MODULOS_EXTRAS = [
  { id: "orcamentos", el: "usr-extra-orc", rotulo: "Orçamentos (além do cargo)" },
  { id: "produtos_sesmt", el: "usr-extra-prodsesmt", rotulo: "Produtos do SESMT (cadastro de EPI e uniformes)" }
];
function usrGarantirChecksExtras(){
  const campo = $("usr-extra-orc")?.closest(".campo"); if(!campo) return;
  USR_MODULOS_EXTRAS.forEach(m => {
    if($(m.el)) return;
    const lbl = document.createElement("label"); lbl.className = "check-inline";
    const inp = document.createElement("input"); inp.type = "checkbox"; inp.id = m.el;
    lbl.append(inp, " " + m.rotulo);
    campo.appendChild(lbl);
  });
}
/* lista a gravar: os marcados + os que o banco já tinha e esta tela não conhece (não apaga módulo de outra versão) */
function usrExtrasMarcados(antes){
  const conhecidos = USR_MODULOS_EXTRAS.map(m => m.id);
  return (Array.isArray(antes) ? antes : []).filter(m => !conhecidos.includes(m))
    .concat(USR_MODULOS_EXTRAS.filter(m => $(m.el)?.checked).map(m => m.id));
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
  USR_MODULOS_EXTRAS.forEach(m => { if($(m.el)) $(m.el).checked = false; });   // hotfix 113 + lote S51
  if($("usr-extra-ate")) $("usr-extra-ate").value = "";
  $("btn-reset-senha-usr").style.display = "none";
  if($("btn-encerrar-sessoes-usr")) $("btn-encerrar-sessoes-usr").style.display = "none";
  $("btn-salvar-usr").textContent = "📨 Enviar convite";
  abrirFichaUsrVisual({ nome: "(novo)", cargo: "visualizador", ativo: true });
}

function abrirUsuario(id){
  preencherCargosFicha();
  const u = _usuarios.find(x => x.id === id);
  if(!u){ aviso("app-aviso","Usuário não encontrado.","erro"); return; }
  usrEditId = id;
  // fase 93b: login por CPF não tem e-mail de verdade; a senha nova sai da aba Acesso da ficha do funcionário
  usrEditEmail = u.login_cpf ? null : u.email;
  $("usr-email").value     = u.login_cpf ? "login: CPF (criado pelo RH na ficha do funcionário)" : (u.email || "");
  $("usr-email").disabled  = true;
  $("usr-nome-input").value= u.nome || "";
  $("usr-cargo").value     = u.cargo || "visualizador";
  $("usr-telefone").value  = u.telefone || "";
  $("usr-ativo").checked   = u.ativo !== false;
  // hotfix 113 + lote S51: módulos extras com validade (uma data para todos)
  USR_MODULOS_EXTRAS.forEach(m => { if($(m.el)) $(m.el).checked = Array.isArray(u.modulos_extras) && u.modulos_extras.includes(m.id); });
  if($("usr-extra-ate")) $("usr-extra-ate").value = u.modulos_extras_ate ? String(u.modulos_extras_ate).slice(0, 10) : "";
  $("btn-reset-senha-usr").style.display = u.login_cpf ? "none" : "";
  if($("btn-encerrar-sessoes-usr")) $("btn-encerrar-sessoes-usr").style.display = "";   // fase 87
  $("btn-salvar-usr").textContent = "💾 Salvar alterações";
  abrirFichaUsrVisual(u);
}

function abrirFichaUsrVisual(u){
  $("usr-painel").style.display = "none";
  $("usr-ficha").style.display = "";

  $("usr-ficha-nome").textContent = u.nome || "(novo)";
  // hotfix 147: login por CPF mostra a função do RH no chip (o perfil de acesso em segundo plano) e o select de cargo
  // vira "Perfil de acesso"; convidado por e-mail continua "Cargo". Os rótulos são do index.html, trocados aqui
  const funcao = usrFuncaoRH(u);
  const chipCargo = $("usr-ficha-cargo-chip");
  const rotChipCargo = chipCargo.previousElementSibling;
  if(rotChipCargo) rotChipCargo.textContent = funcao ? "Função" : u.login_cpf ? "Perfil de acesso" : "Cargo";
  if(funcao) chipCargo.innerHTML = `${esc(funcao)} <small class="meta">· perfil ${esc(usrCargoRotulo(u))}</small>`;
  else chipCargo.textContent = usrCargoRotulo(u);
  const rotSelCargo = $("usr-cargo").closest(".campo")?.querySelector("label");
  if(rotSelCargo) rotSelCargo.textContent = u.login_cpf ? "Perfil de acesso *" : "Cargo *";
  $("usr-ficha-email-chip").innerHTML   = usrLoginRotulo(u);   // fase 93b: "login: CPF" no lugar do e-mail técnico
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
      // hotfix 113 + lote S51: módulos extras (só diretoria/admin; o banco confere no gatilho e no check)
      const extras = usrExtrasMarcados(_usuarios.find(x => x.id === usrEditId)?.modulos_extras);
      const extrasAte = extras.length ? ($("usr-extra-ate")?.value || null) : null;
      const { error } = await sb.from("profiles")
        .update({ nome, cargo, telefone, modulos_extras: extras, modulos_extras_ate: extrasAte })
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

  // Política de sessão (fase 87)
  $("btn-encerrar-sessoes-usr")?.addEventListener("click", () => comBotaoTravado("btn-encerrar-sessoes-usr", encerrarSessoesUsr));
  $("btn-usr-sessao-salvar")?.addEventListener("click", () => comBotaoTravado("btn-usr-sessao-salvar", salvarPoliticaSessao));
  $("btn-usr-rdo-salvar")?.addEventListener("click", () => comBotaoTravado("btn-usr-rdo-salvar", salvarPalavrasEtapa));   // fase 94
  $("btn-usr-rdo-solo-salvar")?.addEventListener("click", () => comBotaoTravado("btn-usr-rdo-solo-salvar", salvarSoloClassificacoes));   // fase 101
  $("btn-usr-sessoes-todas")?.addEventListener("click", () => comBotaoTravado("btn-usr-sessoes-todas", encerrarTodasSessoes));

  const navUsr = document.querySelector('nav button[data-secao="usuarios"]');
  if(navUsr) navUsr.addEventListener("click", mostrarPainelUsr);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarUsuarios);
} else {
  ligarUsuarios();
}

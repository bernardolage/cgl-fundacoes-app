/* ====================================================================
   App do operador (fase 129b) — op_init.js (carrega por último)
   Tela Entrar (CPF e senha), troca obrigatória da senha provisória, pedir a senha de novo sem perder a fila,
   arranque (perfil, fila do aparelho, diário guardado), service worker e os gatilhos da drenagem.
   Quem entra direto aqui: operador e encarregado (sem MFA, CLAUDE.md fase 93b). Engenharia, admin e diretor
   chegam pelo "Modo campo" do sistema, com a sessão (e o MFA) já feitos lá.
   ==================================================================== */

const CARGOS_LOGIN_DIRETO = ["operador", "encarregado"];

function mostrarLogin(msg, tipo){
  $("op-app").hidden = true;
  $("op-troca-senha").hidden = true;
  $("op-login").hidden = false;
  const cpf = prefLer("cpf");
  if(cpf && !$("op-login-cpf").value){ $("op-login-cpf").value = cpf; $("op-login-lembrar-cpf").checked = true; }
  const a = $("op-login-aviso");
  if(msg){ a.textContent = msg; a.className = "op-alerta op-alerta-" + (tipo || "perigo"); a.hidden = false; } else a.hidden = true;
  contarFilaDoAparelho().then(n => {
    const f = $("op-login-fila");
    if(!f) return;
    const tot = n.registros + n.fotos;
    f.hidden = !tot;
    f.textContent = tot ? `⏳ Este aparelho tem ${n.registros} registro(s) e ${n.fotos} foto(s) esperando envio. Entre para enviar.` : "";
  });
}

async function entrar(ev){
  ev.preventDefault();
  const btn = $("op-btn-entrar");
  const cpf = $("op-login-cpf").value.replace(/\D/g, "");
  if(cpf.length !== 11){ mostrarLogin("Digite os 11 números do CPF."); return; }
  if(!$("op-login-senha").value){ mostrarLogin("Digite a senha."); return; }
  btn.disabled = true; btn.textContent = "Entrando…";
  if($("op-login-manter").checked) lembrarGravar(7); else lembrarApagar();
  const { error } = await sb.auth.signInWithPassword({ email: loginParaEmail(cpf), password: $("op-login-senha").value });
  btn.disabled = false; btn.textContent = "Entrar";
  $("op-login-senha").value = "";
  if(error){
    const m = String(error.message || "").toLowerCase();
    if(m.includes("invalid login")) mostrarLogin("CPF ou senha inválidos. Sem a senha, peça ao RH um link de acesso.");
    else if(m.includes("banned")) mostrarLogin("Seu usuário está desativado. Fale com o RH.");
    else if(ehErroDeRede(error)) mostrarLogin("Sem sinal para entrar. O que está no aparelho continua guardado.", "aviso");
    else mostrarLogin("Falha no login: " + (error.message || "erro"));
    return;
  }
  prefGravar("cpf", $("op-login-lembrar-cpf").checked ? cpf : null);
  await iniciarOperador(true);
}

/* sessão vencida: pede só a senha, a fila e a tela ficam como estão */
async function entrarDeNovo(ev){
  ev.preventDefault();
  const senha = $("op-sv-senha").value;
  if(!senha) return;
  const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: {} }));
  const email = user?.email || (OP.cpfDigitos ? OP.cpfDigitos + "@" + LOGIN_CPF_DOMINIO : null);
  if(!email){ location.replace("operador.html"); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  $("op-sv-senha").value = "";
  if(error){ avisar(ehErroDeRede(error) ? "Sem sinal: tente quando voltar." : "Senha inválida.", "erro"); return; }
  $("op-sessao-vencida").hidden = true;
  OP.pausadoSessao = false;
  agendarDrenagem(0);
}

/* senha provisória do RH (fase 93b): troca obrigatória antes de qualquer outra tela */
let _trocaResolver = null;
function mostrarTrocaSenha(obrigatoria){
  $("op-troca-titulo").textContent = obrigatoria ? "Troque sua senha" : "Trocar a senha";
  $("op-troca-texto").textContent = obrigatoria
    ? "A senha que o RH passou vale só para o primeiro acesso. Escolha a sua (pelo menos 8 caracteres, diferente do CPF)."
    : "Pelo menos 8 caracteres, diferente do CPF.";
  $("op-btn-troca-cancelar").hidden = !!obrigatoria;
  $("op-troca-aviso").hidden = true;
  $("op-troca-senha").hidden = false;
  if(obrigatoria) $("op-app").hidden = true;
  $("op-troca-nova").focus();
  return new Promise(ok => { _trocaResolver = obrigatoria ? ok : null; });
}
async function salvarTrocaSenha(ev){
  ev.preventDefault();
  const s1 = $("op-troca-nova").value, s2 = $("op-troca-confirma").value;
  const aviso = (t) => { const a = $("op-troca-aviso"); a.textContent = t; a.hidden = false; };
  if(s1.length < 8){ aviso("A senha precisa de pelo menos 8 caracteres."); return; }
  if(s1 !== s2){ aviso("As senhas não conferem."); return; }
  if(OP.cpfDigitos && s1.replace(/\D/g, "") === OP.cpfDigitos){ aviso("A senha não pode ser o seu CPF."); return; }
  const btn = $("op-btn-troca-salvar");
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ password: s1 });
  btn.disabled = false;
  if(error){
    const m = String(error.message || "").toLowerCase();
    aviso(m.includes("different from the old") || m.includes("same password") ? "Escolha uma senha diferente da atual." : "Não foi possível salvar: " + (error.message || "erro"));
    return;
  }
  $("op-troca-nova").value = ""; $("op-troca-confirma").value = "";
  if(OP.perfil?.senha_provisoria){
    const { error: e2 } = await sb.rpc("rh_login_marcar_senha_trocada");
    if(e2) console.warn("rh_login_marcar_senha_trocada:", e2.message);
    OP.perfil.senha_provisoria = false;
  }
  $("op-troca-senha").hidden = true;
  $("op-app").hidden = false;
  avisar("Senha trocada. Use-a nos próximos acessos.", "ok");
  if(_trocaResolver){ const r = _trocaResolver; _trocaResolver = null; r(); }
}

async function iniciarOperador(veioDoLogin){
  let sessao = null;
  try { ({ data: { session: sessao } } = await sb.auth.getSession()); } catch(_){}
  if(!sessao){ mostrarLogin(); return; }
  OP.perfil = await lerPerfil().catch(() => null);
  if(!OP.perfil){
    // sem sinal com sessão guardada: abre o que está no aparelho, a fila espera
    if(!navigator.onLine && prefLer("ultimo_perfil")) OP.perfil = { id: prefLer("ultimo_perfil"), nome: prefLer("ultimo_nome") || "", cargo: prefLer("ultimo_cargo") };
    else { mostrarLogin(); return; }
  }
  if(OP.perfil.ativo === false){ await sb.auth.signOut(); mostrarLogin("Seu usuário está desativado. Fale com o RH."); return; }
  if(!CARGOS_CAMPO.includes(OP.perfil.cargo)){
    if(veioDoLogin){ await sb.auth.signOut(); mostrarLogin("Este acesso é do diário de campo. Seu perfil usa o sistema principal."); return; }
    location.replace("index.html"); return;
  }
  if(!CARGOS_LOGIN_DIRETO.includes(OP.perfil.cargo)){
    if(veioDoLogin){ await sb.auth.signOut(); mostrarLogin("Entre pelo sistema principal e use Modo campo."); return; }
    // engenharia, admin e diretor: sessão do sistema principal, com o MFA feito lá
    try {
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if(aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2"){ location.replace("index.html"); return; }
    } catch(_){}
  }
  try { OP.db = await idbAbrir(OP.perfil.id); }
  catch(_){ mostrarLogin("Este navegador não guarda dados (modo anônimo?). Abra no navegador normal do celular."); return; }
  prefGravar("ultimo_perfil", OP.perfil.id);
  prefGravar("ultimo_nome", OP.perfil.nome);
  prefGravar("ultimo_cargo", OP.perfil.cargo);
  const vencidas = await limparFilaVencida();
  $("op-login").hidden = true;
  $("op-app").hidden = false;
  if(OP.perfil.senha_provisoria) await mostrarTrocaSenha(true);
  if(vencidas) avisar(`${vencidas} registro(s) com mais de ${prefLer("fila_max_dias", "30")} dias saíram do aparelho sem subir. Fale com o engenheiro.`, "aviso");
  lerFuncionario().catch(() => {});
  try { navigator.storage?.persist?.(); } catch(_){}
  await atualizarFaixaFila();
  const rdo = prefLer("rdo_atual");
  if(rdo && await carregarDiaDoAparelho(rdo).catch(() => false)){
    irPara("dia");
    if(!filaTemPendenteDoDia()) recarregarDia(true).then(ok => { if(ok) renderTelaAtual(); });
  } else irPara("maquina");
  agendarDrenagem(0);
}

/* ---------- ligações ---------- */
$("op-form-login").addEventListener("submit", entrar);
$("op-form-sessao").addEventListener("submit", entrarDeNovo);
$("op-form-troca").addEventListener("submit", salvarTrocaSenha);
$("op-btn-troca-cancelar").addEventListener("click", () => { $("op-troca-senha").hidden = true; $("op-app").hidden = false; });
$("op-login-mostrar").addEventListener("change", (e) => { $("op-login-senha").type = e.target.checked ? "text" : "password"; });
$("op-sv-sair").addEventListener("click", () => sair());
window.addEventListener("online", () => { atualizarFaixaFila(); agendarDrenagem(0); });
window.addEventListener("offline", () => atualizarFaixaFila());
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && OP.db){ agendarDrenagem(0); conferirVersao(); } });
setInterval(() => { if(OP.db) agendarDrenagem(0); }, 120000);
setInterval(conferirVersao, 300000);
sb.auth.onAuthStateChange((evento) => { if(evento === "SIGNED_OUT" && OP.db && !OP.pausadoSessao) pedirSenhaDeNovo(); });

if("serviceWorker" in navigator && location.protocol === "https:"){
  navigator.serviceWorker.register("sw.js", { scope: "./operador" }).catch(e => console.warn("service worker:", e.message));
}
iniciarOperador(false);

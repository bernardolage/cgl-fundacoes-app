




const CARGOS = {
  diretor:      "Diretor",
  admin:        "Administrador",
  engenheiro:   "Engenheiro",
  assistente_engenharia: "Assistente de engenharia",
  comercial:    "Comercial",
  financeiro:   "Financeiro",
  comprador:    "Comprador",
  almoxarife:   "Almoxarife",
  gestor_acessorios: "Gestor de acessórios",
  mecanico:     "Mecânico",
  encarregado:  "Encarregado",
  operador:     "Operador",
  rh:           "RH (folha e dados sensíveis)",
  sesmt:        "SESMT",
  logistica:    "Logística",
  gestor_frota: "Gestor de frota",
  visualizador: "Visualizador",
  auditor:      "Auditor (só leitura)",
  auxiliar_almoxarifado: "Auxiliar de almoxarifado",
  gestor_manutencao: "Gestor de manutenção",
  juridico:     "Jurídico (contratos)"
};


const CARGOS_SO_DIRETORIA = ["rh", "juridico"];





const CARGO_DESCRICAO = {
  diretor:      { frase: "Acesso total. Só diretor dá ou tira os cargos Diretor e RH", modulos: ["usuarios", "carteira", "patrimonio"], sem: [] },
  admin:        { frase: "Administra o sistema e os logins. Não vê Serviços, Orçamentos, Carteira nem Patrimônio e não emite nota fiscal", modulos: ["usuarios"], sem: ["servicos", "orcamentos", "carteira", "patrimonio"] },
  engenheiro:   { frase: "Obras, estacas, RDO, medições e mobilização; responde pelas pendências das obras dele", modulos: ["obras", "rdo", "medicoes", "mobilizacoes"], sem: [] },
  assistente_engenharia: { frase: "Lança e confere RDO e trata as pendências das obras", modulos: ["rdo", "obras"], sem: [] },
  comercial:    { frase: "Serviços, orçamentos, propostas e contratos de receita", modulos: ["servicos", "orcamentos", "obras", "contratos"], sem: [] },
  financeiro:   { frase: "Medições, recebimentos, cauções e contas a pagar; emite nota fiscal", modulos: ["medicoes", "contratos", "contaspagar"], sem: [] },
  comprador:    { frase: "Requisições, cotações, pedidos, fornecedores e contas a pagar", modulos: ["compras", "fornecedores", "contratos", "contaspagar"], sem: [] },
  almoxarife:   { frase: "Estoque, separações, produtos e recebimento de material", modulos: ["estoque", "separacoes", "produtos", "compras"], sem: [] },
  auxiliar_almoxarifado: { frase: "Estoque, separações, produtos (edita, define custo, arquiva), recebe material de pedido e peças dos reparos; não cria pedido nem exclui produto", modulos: ["estoque", "separacoes", "produtos", "compras", "reparos"], sem: ["obras", "medicoes", "contratos", "contaspagar"] },
  gestor_acessorios: { frase: "Acessórios, reparos, fabricação e remessas; emite a nota de remessa", modulos: ["acessorios", "reparos", "fabricacao", "movimentacoes"], sem: [] },
  gestor_frota: { frase: "Frota, equipamentos, manutenção e compras da frota", modulos: ["frota", "equipamentos", "manutencao", "compras"], sem: [] },
  gestor_manutencao: { frase: "OS, planos preventivos, checklists, compras do setor, acessórios, reparos, fabricação, estoque e logística; sem clientes, medições nem contas a pagar", modulos: ["manutencao", "compras"], sem: ["clientes", "medicoes", "contratos", "contaspagar"] },
  mecanico:     { frase: "OS, reparos, checklists e apontamento de horas", modulos: ["manutencao", "reparos", "apontamentos"], sem: [] },
  encarregado:  { frase: "Diário das obras dele, no escritório e no celular", modulos: ["rdo", "diario-campo"], sem: [] },
  operador:     { frase: "Só o diário de campo no celular, nas obras em que está", modulos: ["diario-campo"], sem: ["inicio", "rdo", "obras"] },
  rh:           { frase: "Funcionários, dados sensíveis, folha e horas. Só diretor atribui", modulos: ["funcionarios", "rhh"], sem: [] },
  sesmt:        { frase: "Segurança do trabalho: programas, exames, EPI e ocorrências", modulos: ["sesmt", "sesmt-ocorrencias", "estoque"], sem: [] },
  logistica:    { frase: "Viagens, veículos, mobilizações e remessas; emite a nota de remessa", modulos: ["frota", "mobilizacoes", "movimentacoes"], sem: [] },
  visualizador: { frase: "Só consulta o que é aberto a todo usuário. Não grava nos cadastros: só abre chamado e lança as próprias horas de viagem", modulos: ["chamados", "rhv"], sem: ["usuarios", "carteira", "patrimonio"] },
  auditor:      { frase: "Só leitura: vê o que a diretoria vê, menos a gestão de logins, os dados sensíveis e a folha; não grava nada", modulos: ["carteira", "patrimonio", "medicoes", "contratos", "contaspagar"], sem: ["usuarios"] },
  juridico:     { frase: "Contratos dos dois lados, partes, garantias e obrigações; vê o valor de cada contrato e nunca a soma. Só diretor atribui", modulos: ["contratos"], sem: ["usuarios", "carteira", "patrimonio", "medicoes", "contaspagar"] }
};

let _usuarios   = [];
let _usrView    = "lista";
let usrEditId   = null;
let usrEditEmail = null;


async function carregarUsuarios(){



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


  _cfgCarregadas = { usuarios: true };
  if(_cfgAba !== "usuarios") cfgCarregarAba(_cfgAba);
  cfgCarregarResumo();
}






const CFG_ABAS = [
  { id: "usuarios",    rotulo: "Usuários e acessos" },
  { id: "empresa",     rotulo: "Empresa e fiscal" },
  { id: "integracoes", rotulo: "Integrações" },
  { id: "operacao",    rotulo: "Operação" },
  { id: "seguranca",   rotulo: "Segurança" }
];

function cfgData(v){
  const p = String(v || "").slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(v || "");
}
function cfgDataHora(v){
  const d = new Date(v);
  return isNaN(d) ? String(v || "") : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function cfgPlural(n, um, varios){ return `${n} ${Number(n) === 1 ? um : varios}`; }


function cfgAbasHTML(r, ativa){
  const x = r || {};
  const tem = k => !!r && x[k] !== undefined;
  const resumo = {
    usuarios:    tem("ativos") ? cfgPlural(x.ativos, "ativo", "ativos") : "",
    empresa:     tem("certificado") ? (x.certificado ? "certificado até " + cfgData(x.certificado) : "sem certificado") : "",
    integracoes: tem("geo") ? "Geodigitus " + (x.geo ? "ligado" : "desligado") : "",
    operacao:    tem("responsaveis") ? cfgPlural(x.responsaveis, "responsável", "responsáveis") : "",
    seguranca:   tem("mfa") ? `MFA em ${cfgPlural(x.mfa, "cargo", "cargos")}${x.inatividade != null ? " · sai após " + x.inatividade + " min" : ""}` : ""
  };
  return uiAbas(CFG_ABAS.map(a => ({ id: a.id, rotulo: a.rotulo, resumo: resumo[a.id] })), { ativa, rotulo: "Partes das configurações" });
}

function cfgIntegracoesHTML(d, erro){
  const tit = "Focus NFe e PlusFrota (só consulta)";
  if(erro) return uiSecao("documento", tit, uiErro(erro));
  if(!d) return uiSecao("documento", tit, uiVazio("Sem dados das integrações para mostrar."));
  const AMB = { producao: "Produção", homologacao: "Homologação" };
  const amb = v => AMB[v] || v || "não definido";
  const webhook = d.fiscal_focus_webhook_registrado_em
    ? esc(cfgDataHora(d.fiscal_focus_webhook_registrado_em) + (d.fiscal_focus_webhook_ambiente ? " · " + amb(d.fiscal_focus_webhook_ambiente) : ""))
    : "não registrado";
  const corpo =
    uiRotuloValor("Focus · ambiente da emissão", esc(amb(d.fiscal_ambiente))) +
    uiRotuloValor("Focus · webhook registrado em", webhook) +
    uiRotuloValor("Certificado A1 válido até", d.fiscal_certificado_validade ? esc(cfgData(d.fiscal_certificado_validade)) : "sem certificado") +
    `<p><button type="button" class="link-mini" data-cfg-aba="empresa" title="Abre a aba onde se alteram os dados fiscais, o certificado e o webhook">Alterar em Empresa e fiscal</button></p>` +
    uiRotuloValor("PlusFrota · sincronização", `${d.plusfrota_sync_ativo ? "ligada" : "desligada"} <span class="meta">(sem tela para ligar ou desligar)</span>`);
  return uiSecao("documento", tit, corpo);
}

function cfgParametrosHTML(d, erro){
  const tit = "Parâmetros de outros módulos (só consulta)";
  if(erro) return uiSecao("maquina", tit, uiErro(erro));
  if(!d) return uiSecao("maquina", tit, uiVazio("Sem parâmetros para mostrar."));
  const link = (secao, nome) => ` <button type="button" class="link-mini" data-cfg-secao="${esc(secao)}" title="Abre ${esc(nome)}, onde este valor se altera">Alterar em ${esc(nome)}</button>`;
  const n = v => v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR");
  const corpo =
    uiRotuloValor("Hora da oficina", (d.custo_hora_oficina != null ? uiFmt(d.custo_hora_oficina, "brl") + " por hora" : "não definida") + link("reparos", "Reparos")) +
    uiRotuloValor("Atenção da manutenção", esc(`${n(d.manutencao_atencao_h)} h · ${n(d.manutencao_atencao_km)} km antes do vencimento`) + link("manutencao", "Manutenção")) +
    uiRotuloValor("Almoxarife de plantão", (d.plantao ? esc(d.plantao) : "não definido") + link("separacoes", "Separações"));
  return uiSecao("maquina", tit, corpo);
}


let _cfgAba = "usuarios";
let _cfgCarregadas = { usuarios: true };
let _cfgResumo = null;

function cfgRenderCabecalho(){
  if(typeof uiPagina !== "function") return;
  const cab = $("cfg-cab");
  if(cab && !cab.firstChild) cab.innerHTML = uiPagina({ titulo: "Configurações", sub: "Usuários e acessos, dados da empresa, integrações e parâmetros do sistema." });
  const abas = $("cfg-abas");
  if(abas) abas.innerHTML = cfgAbasHTML(_cfgResumo, _cfgAba);
}

function cfgMostrarAba(id){
  if(!CFG_ABAS.some(a => a.id === id)) id = "usuarios";
  _cfgAba = id;
  CFG_ABAS.forEach(a => { const el = $("cfg-aba-" + a.id); if(el) el.hidden = a.id !== id; });
  cfgRenderCabecalho();
}

function cfgAbrirAba(id){
  cfgMostrarAba(id);
  cfgCarregarAba(_cfgAba);
}
function cfgCarregarAba(id){
  if(_cfgCarregadas[id]) return;
  _cfgCarregadas[id] = true;
  if(id === "empresa") carregarFiscalEmpresaCard();
  else if(id === "integracoes"){
    if(typeof geoEmpresaCarregarCard === "function") geoEmpresaCarregarCard();
    cfgCarregarIntegracoes();
  } else if(id === "operacao"){
    carregarRespServico();
    carregarPalavrasEtapaCard();
    cfgCarregarParametros();
  } else if(id === "seguranca") carregarPoliticaSessaoCard();
}

async function cfgCarregarResumo(){
  if(!["diretor", "admin"].includes(usuarioAtual?.cargo)) return;
  const r = { ativos: _usuarios.filter(u => u.ativo !== false).length };
  const [cfg, resp] = await Promise.all([
    sb.from("empresa_config").select("fiscal_certificado_validade,geodigitus_sync_ativo,sessao_mfa_cargos,sessao_inatividade_min").eq("id", 1).maybeSingle(),
    sb.from("responsaveis_servico").select("id", { count: "exact", head: true })
  ]);
  if(!cfg.error && cfg.data){
    r.certificado = cfg.data.fiscal_certificado_validade || null;
    r.geo = !!cfg.data.geodigitus_sync_ativo;
    r.mfa = (cfg.data.sessao_mfa_cargos || []).length;
    r.inatividade = cfg.data.sessao_inatividade_min;
  }
  if(!resp.error && resp.count != null) r.responsaveis = resp.count;
  _cfgResumo = r;
  cfgRenderCabecalho();
}
async function cfgCarregarIntegracoes(){
  const alvo = $("cfg-integ-leitura"); if(!alvo) return;
  alvo.innerHTML = uiCarregando();
  const { data, error } = await sb.from("empresa_config")
    .select("fiscal_ambiente,fiscal_focus_webhook_registrado_em,fiscal_focus_webhook_ambiente,fiscal_certificado_validade,plusfrota_sync_ativo")
    .eq("id", 1).maybeSingle();
  alvo.innerHTML = cfgIntegracoesHTML(data, error ? "Não foi possível ler as integrações: " + error.message : null);
}
async function cfgCarregarParametros(){
  const alvo = $("cfg-param-leitura"); if(!alvo) return;
  alvo.innerHTML = uiCarregando();
  const { data, error } = await sb.from("empresa_config")
    .select("custo_hora_oficina,manutencao_atencao_h,manutencao_atencao_km,almoxarife_padrao_id").eq("id", 1).maybeSingle();
  const d = data ? Object.assign({}, data, { plantao: data.almoxarife_padrao_id ? (_usuarios.find(u => u.id === data.almoxarife_padrao_id)?.nome || "?") : null }) : null;
  alvo.innerHTML = cfgParametrosHTML(d, error ? "Não foi possível ler os parâmetros: " + error.message : null);
}




function carregarFiscalEmpresaCard(){
  const card = $("usr-fiscal-card");
  if(!card || typeof fiscalEmpresaRender !== "function") return;
  const pode = ["diretor", "admin"].includes(usuarioAtual?.cargo);
  card.style.display = pode ? "" : "none";
  if(pode) fiscalEmpresaRender("usr-fe");
}




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
  if(sel) sel.innerHTML = RESP_PAPEIS_AREA[area].map(p => `<option value="${esc(p)}">${esc(RESP_PAPEL[p])}</option>`).join("");
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
      <td><select data-resp-papel="${esc(r.id)}" title="Trocar o papel">${(RESP_PAPEIS_AREA[r.area] || []).map(p => `<option value="${esc(p)}" ${p === r.papel ? "selected" : ""}>${esc(RESP_PAPEL[p])}</option>`).join("")}</select></td>
      <td class="col-acao"><button type="button" class="btn-sec btn-sm txt-perigo" data-resp-del="${esc(r.id)}" title="Remover">Remover</button></td>
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
  if(!r || !(await uiConfirmar({ titulo: "Remover responsável", texto: `Remover ${r.pessoa?.nome || "esta pessoa"} de ${RESP_TIPO[r.tipo_servico]} (${RESP_AREA[r.area]})?`, confirmar: "Remover", perigo: true }))) return;
  const { error } = await sb.from("responsaveis_servico").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível remover: " + error.message, "erro"); return; }
  await carregarRespServico();
}






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
  if(!reg.sessao_mfa_cargos.includes("diretor") && !(await uiConfirmar({ titulo: "Política de sessão", texto: "Diretor fora da lista de MFA obrigatório. Tem certeza?", confirmar: "Salvar assim", perigo: true }))) return;
  const { error } = await sb.from("empresa_config").update(reg).eq("id", 1);
  if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  aviso("app-aviso", "Política de sessão salva. Vale para quem entrar ou recarregar a partir de agora (e já nesta aba).", "ok");
  if(typeof carregarPoliticaSessao === "function") await carregarPoliticaSessao();
}




async function carregarPalavrasEtapaCard(){
  const card = $("usr-rdo-card");
  if(!card) return;
  const pode = ["diretor", "admin"].includes(usuarioAtual?.cargo);
  card.style.display = pode ? "" : "none";
  if(!pode) return;
  const { data, error } = await sb.from("empresa_config").select("rdo_palavras_etapa_final").eq("id", 1).maybeSingle();
  if(error){ aviso("app-aviso", "Não foi possível ler as palavras de etapa final: " + error.message, "erro"); return; }
  $("usr-rdo-palavras").value = (data?.rdo_palavras_etapa_final || []).join(", ");

  const sol = await sb.from("empresa_config").select("rdo_solo_classificacoes").eq("id", 1).maybeSingle();
  if($("usr-rdo-solo")) $("usr-rdo-solo").value = sol.error ? "" : (sol.data?.rdo_solo_classificacoes || []).join(", ");
}
async function salvarSoloClassificacoes(){
  const lista = [...new Set(($("usr-rdo-solo")?.value || "").split(/[,;\n]/).map(s => s.trim()).filter(Boolean))];
  if(!lista.length){ aviso("app-aviso", "Informe ao menos uma classificação (ex.: Argila, Rocha alterada).", "erro"); return; }
  const { error } = await sb.from("empresa_config").update({ rdo_solo_classificacoes: lista, updated_at: new Date().toISOString() }).eq("id", 1);
  if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  if(typeof _rdoSoloClassif !== "undefined") _rdoSoloClassif = null;
  $("usr-rdo-solo").value = lista.join(", ");
  aviso("app-aviso", "Classificações salvas. Aparecem como sugestão nas camadas do RDO de raiz.", "ok");
}
async function salvarPalavrasEtapa(){
  const lista = [...new Set($("usr-rdo-palavras").value.split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean))];
  if(!lista.length){ aviso("app-aviso", "Informe ao menos uma palavra (ex.: injeção, concretagem, argamassado).", "erro"); return; }
  const { error } = await sb.from("empresa_config").update({ rdo_palavras_etapa_final: lista, updated_at: new Date().toISOString() }).eq("id", 1);
  if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  if(typeof _rdoPalavrasEtapa !== "undefined") _rdoPalavrasEtapa = null;
  $("usr-rdo-palavras").value = lista.join(", ");
  aviso("app-aviso", "Palavras salvas. Valem para as execuções gravadas a partir de agora.", "ok");
}

async function encerrarSessoesUsr(){
  if(!usrEditId) return;
  const u = _usuarios.find(x => x.id === usrEditId);
  const nome = u?.nome || "este usuário";
  if(!(await uiConfirmar({ titulo: "Encerrar sessões", texto: `Encerrar as sessões abertas de ${nome}? Ele sai do sistema em todos os aparelhos e precisa entrar de novo.`, confirmar: "Encerrar", perigo: true }))) return;
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






function usrLoginRotulo(u){
  if(u?.login_cpf) return `<span class="tag azul" title="Criado pelo RH na ficha do funcionário; entra com o CPF">login: CPF</span>${u.senha_provisoria ? ' <span class="tag ambar" title="Ainda não trocou a senha definida pelo RH">senha provisória</span>' : ""}`;
  return esc(u?.email || "—");
}


function usrFuncaoRH(u){
  if(!u?.login_cpf) return null;
  return String(u.funcionario?.funcao || "").trim() || null;
}
function usrCargoRotulo(u){ return CARGOS[u?.cargo] || u?.cargo || "—"; }


function usrFiltrados(){
  const termo = ($("usr-busca")?.value || "").trim().toLowerCase();
  const fCargo = $("usr-f-cargo")?.value || "";
  const fAtivo = $("usr-f-ativo")?.value || "";
  return _usuarios.filter(u => {
    if(fCargo && u.cargo !== fCargo) return false;
    if(fAtivo === "ativos" && u.ativo === false) return false;
    if(fAtivo === "inativos" && u.ativo !== false) return false;
    if(termo){
      const alvo = `${u.nome||""} ${u.login_cpf ? "login cpf" : (u.email||"")} ${CARGOS[u.cargo]||u.cargo||""} ${usrFuncaoRH(u)||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function preencherFiltrosUsr(){
  const sel = $("usr-f-cargo");
  if(sel && !sel.options.length){
    sel.innerHTML = `<option value="">Todos os cargos</option>` +
      Object.entries(CARGOS).map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  }
}


function renderUsuarios(){
  preencherFiltrosUsr();
  const dados = usrFiltrados();
  const cont = $("usr-contador");
  if(cont) cont.textContent = `${dados.length} de ${_usuarios.length}`;

  const naMatriz = _usrView === "matriz" && typeof renderMatrizAcessos === "function";
  const filtros = document.querySelector("#usr-painel .card .serv-filtros");
  if(filtros) filtros.hidden = naMatriz;
  if(naMatriz){ renderMatrizAcessos($("usr-conteudo")); return; }
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


function mostrarPainelUsr(){
  cfgMostrarAba("usuarios");
  $("usr-painel").style.display = "";
  $("usr-ficha").style.display = "none";
  usrEditId = null;
  usrEditEmail = null;
}

function preencherCargosFicha(){

  $("usr-cargo").innerHTML = Object.entries(CARGOS)
    .filter(([v]) => !CARGOS_SO_DIRETORIA.includes(v) || usuarioAtual?.cargo === "diretor")
    .map(([v,l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  usrGarantirChecksExtras();
}




const USR_MODULOS_EXTRAS = [
  { id: "orcamentos", el: "usr-extra-orc", rotulo: "Orçamentos (além do cargo)" },

  { id: "orcamentos_leitura", el: "usr-extra-orcleit", rotulo: "Orçamentos (somente leitura)" },

  { id: "assistente_orcamento", el: "usr-extra-astorc", rotulo: "Montar orçamento pelo assistente (IA)" },
  { id: "produtos_sesmt", el: "usr-extra-prodsesmt", rotulo: "Produtos do SESMT (cadastro de EPI e uniformes)" },

  { id: "produtos", el: "usr-extra-prod", rotulo: "Produtos (cadastro: edita e cadastra, sem saldo nem custo)" },
  { id: "compras", el: "usr-extra-cmp", rotulo: "Compras (requisição e recebimento de NF, sem alçada)" },

  { id: "sesmt", el: "usr-extra-sesmt", rotulo: "SESMT (catálogo, matriz, documentos de segurança, programas legais)" },
  { id: "compras_sesmt", el: "usr-extra-compsesmt", rotulo: "Compras do SESMT (cria e edita pedido só de EPI e uniforme; vê só os próprios pedidos, sem Contas a Pagar)" },


  { id: "catalogo_estrutura", el: "usr-extra-catest", rotulo: "Estrutura do catálogo de serviços (nome, categoria, natureza e unidade; só a diretoria libera)" },
  { id: "login_funcionario", el: "usr-extra-loginfunc", rotulo: "Login de funcionário (cria e redefine a senha de operador, encarregado e mecânico; não desativa; sem ver o CPF)" }
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

function usrExtrasMarcados(antes){
  const conhecidos = USR_MODULOS_EXTRAS.map(m => m.id);
  return (Array.isArray(antes) ? antes : []).filter(m => !conhecidos.includes(m))
    .concat(USR_MODULOS_EXTRAS.filter(m => $(m.el)?.checked).map(m => m.id));
}




const USR_EXTRAS_SO_DIRETORIA = ["orcamentos", "orcamentos_leitura", "assistente_orcamento", "catalogo_estrutura"];
const USR_TRAVA_SO_DIRETORIA = "Só a diretoria libera ou retira este acesso.";
const USR_TRAVA_PRAZO_ORC = "Só a diretoria muda o prazo de quem tem acesso extra a Orçamentos.";
const USR_TRAVA_PROPRIO = "Você não altera o próprio cadastro neste campo: outra pessoa da diretoria ou da administração faz.";

function usrTravasFicha(u, eu){
  const proprio = !!(u && u.id && eu && u.id === eu.id);
  const diretor = !!eu && eu.cargo === "diretor";
  const temOrc = Array.isArray(u?.modulos_extras) && u.modulos_extras.some(m => USR_EXTRAS_SO_DIRETORIA.includes(m));
  const extras = {};
  USR_MODULOS_EXTRAS.forEach(m => {
    extras[m.id] = proprio ? USR_TRAVA_PROPRIO : (!diretor && USR_EXTRAS_SO_DIRETORIA.includes(m.id) ? USR_TRAVA_SO_DIRETORIA : "");
  });
  return {
    extras,
    prazo: proprio ? USR_TRAVA_PROPRIO : (!diretor && temOrc ? USR_TRAVA_PRAZO_ORC : ""),
    cargo: proprio ? USR_TRAVA_PROPRIO : "",
    ativo: proprio ? USR_TRAVA_PROPRIO : ""
  };
}
function usrAplicarTravas(u){
  const t = usrTravasFicha(u, usuarioAtual);
  const travar = (el, motivo) => {
    if(!el) return;
    if(el.dataset.titleBase === undefined) el.dataset.titleBase = el.title || "";
    el.disabled = !!motivo;
    el.title = motivo || el.dataset.titleBase;
    const rotulo = el.closest("label.check-inline");
    if(rotulo) rotulo.title = motivo || "";
  };
  USR_MODULOS_EXTRAS.forEach(m => travar($(m.el), t.extras[m.id]));
  travar($("usr-extra-ate"), t.prazo);
  travar($("usr-cargo"), t.cargo);
  travar($("usr-ativo"), t.ativo);
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
  USR_MODULOS_EXTRAS.forEach(m => { if($(m.el)) $(m.el).checked = false; });
  if($("usr-extra-ate")) $("usr-extra-ate").value = "";
  usrAplicarTravas(null);
  $("btn-reset-senha-usr").style.display = "none";
  if($("btn-encerrar-sessoes-usr")) $("btn-encerrar-sessoes-usr").style.display = "none";
  $("btn-salvar-usr").textContent = "Enviar convite";
  abrirFichaUsrVisual({ nome: "(novo)", cargo: "visualizador", ativo: true });
}

function abrirUsuario(id){
  cfgMostrarAba("usuarios");
  preencherCargosFicha();
  const u = _usuarios.find(x => x.id === id);
  if(!u){ aviso("app-aviso","Usuário não encontrado.","erro"); return; }
  usrEditId = id;

  usrEditEmail = u.login_cpf ? null : u.email;
  $("usr-email").value     = u.login_cpf ? "login: CPF (criado pelo RH na ficha do funcionário)" : (u.email || "");
  $("usr-email").disabled  = true;
  $("usr-nome-input").value= u.nome || "";
  $("usr-cargo").value     = u.cargo || "visualizador";
  $("usr-telefone").value  = u.telefone || "";
  $("usr-ativo").checked   = u.ativo !== false;

  USR_MODULOS_EXTRAS.forEach(m => { if($(m.el)) $(m.el).checked = Array.isArray(u.modulos_extras) && u.modulos_extras.includes(m.id); });
  if($("usr-extra-ate")) $("usr-extra-ate").value = u.modulos_extras_ate ? String(u.modulos_extras_ate).slice(0, 10) : "";
  usrAplicarTravas(u);
  $("btn-reset-senha-usr").style.display = u.login_cpf ? "none" : "";
  if($("btn-encerrar-sessoes-usr")) $("btn-encerrar-sessoes-usr").style.display = "";
  $("btn-salvar-usr").textContent = "Salvar alterações";
  abrirFichaUsrVisual(u);
}

function abrirFichaUsrVisual(u){
  $("usr-painel").style.display = "none";
  $("usr-ficha").style.display = "";

  $("usr-ficha-nome").textContent = u.nome || "(novo)";


  const funcao = usrFuncaoRH(u);
  const chipCargo = $("usr-ficha-cargo-chip");
  const rotChipCargo = chipCargo.previousElementSibling;
  if(rotChipCargo) rotChipCargo.textContent = funcao ? "Função" : u.login_cpf ? "Perfil de acesso" : "Cargo";
  if(funcao) chipCargo.innerHTML = `${esc(funcao)} <small class="meta">· perfil ${esc(usrCargoRotulo(u))}</small>`;
  else chipCargo.textContent = usrCargoRotulo(u);
  const rotSelCargo = $("usr-cargo").closest(".campo")?.querySelector("label");
  if(rotSelCargo) rotSelCargo.textContent = u.login_cpf ? "Perfil de acesso *" : "Cargo *";
  $("usr-ficha-email-chip").innerHTML   = usrLoginRotulo(u);
  $("usr-ficha-tel-chip").textContent = u.telefone || "—";
  $("usr-ficha-ativo-chip").innerHTML = (u.ativo === false)
    ? '<span class="tag vermelho">Inativo</span>'
    : '<span class="tag verde">Ativo</span>';
  $("usr-ficha-titulo").textContent = usrEditId ? u.nome : "Convidar usuário";

  usrMostrarDescricaoCargo();
  ativarTabUsr("perfil");
}



function usrMostrarDescricaoCargo(){
  const alvo = $("usr-cargo-desc");
  if(!alvo) return;
  const cargo = $("usr-cargo")?.value || "";
  const d = CARGO_DESCRICAO[cargo];
  if(!d){ alvo.innerHTML = ""; return; }
  const resumo = typeof mtzFraseResumo === "function" ? mtzFraseResumo(cargo) : "";
  const atalho = typeof mtzTelaLiberada === "function" && mtzTelaLiberada()
    ? ` <button type="button" class="link-mini" data-usr-matriz="${esc(cargo)}" title="Abre a matriz de acessos neste cargo">Ver a matriz deste cargo</button>` : "";
  alvo.innerHTML = `<span class="usr-cargo-frase">${esc(d.frase)}.</span>${resumo ? ` <span class="meta">${esc(resumo)}</span>` : ""}${  atalho}`;
}

function usrAbrirMatrizDoCargo(cargo){
  if(typeof mtzAbrirNoCargo !== "function" || !mtzAbrirNoCargo(cargo)) return;
  mostrarPainelUsr();
  _usrView = "matriz";
  document.querySelectorAll("#usr-painel .lista-topo .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === "matriz"));
  renderUsuarios();
}

function ativarTabUsr(nome){
  document.querySelectorAll("#usr-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#usr-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}


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

      const extras = usrExtrasMarcados(_usuarios.find(x => x.id === usrEditId)?.modulos_extras);
      const extrasAte = extras.length ? ($("usr-extra-ate")?.value || null) : null;
      const { error } = await sb.from("profiles")
        .update({ nome, cargo, telefone, modulos_extras: extras, modulos_extras_ate: extrasAte })
        .eq("id", usrEditId);
      if(error) throw error;

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
  if(!(await uiConfirmar({ titulo: "Resetar senha", texto: `Enviar link de redefinição de senha para ${usrEditEmail}?`, confirmar: "Enviar link" }))) return;
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



  $("usr-cargo")?.addEventListener("change", usrMostrarDescricaoCargo);
  $("usr-cargo-desc")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-usr-matriz]");
    if(b) usrAbrirMatrizDoCargo(b.dataset.usrMatriz);
  });
  const btnMatriz = $("usr-view-matriz");
  if(btnMatriz) btnMatriz.hidden = !(typeof mtzTelaLiberada === "function" && mtzTelaLiberada());


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


  $("btn-encerrar-sessoes-usr")?.addEventListener("click", () => comBotaoTravado("btn-encerrar-sessoes-usr", encerrarSessoesUsr));
  $("btn-usr-sessao-salvar")?.addEventListener("click", () => comBotaoTravado("btn-usr-sessao-salvar", salvarPoliticaSessao));
  $("btn-usr-rdo-salvar")?.addEventListener("click", () => comBotaoTravado("btn-usr-rdo-salvar", salvarPalavrasEtapa));
  $("btn-usr-rdo-solo-salvar")?.addEventListener("click", () => comBotaoTravado("btn-usr-rdo-solo-salvar", salvarSoloClassificacoes));
  $("btn-usr-sessoes-todas")?.addEventListener("click", () => comBotaoTravado("btn-usr-sessoes-todas", encerrarTodasSessoes));


  $("usr-painel")?.addEventListener("click", (e) => {
    const aba = e.target.closest("#cfg-abas [data-aba], [data-cfg-aba]");
    if(aba){ cfgAbrirAba(aba.dataset.aba || aba.dataset.cfgAba); return; }
    const sec = e.target.closest("[data-cfg-secao]");
    if(sec && typeof irParaSecao === "function") irParaSecao(sec.dataset.cfgSecao);
  });
  cfgRenderCabecalho();

  const navUsr = document.querySelector('nav button[data-secao="usuarios"]');
  if(navUsr) navUsr.addEventListener("click", mostrarPainelUsr);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarUsuarios);
} else {
  ligarUsuarios();
}

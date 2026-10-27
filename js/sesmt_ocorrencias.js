/* ====================================================================
   OCORRÊNCIAS SST — fase 109d (#108), prefixo sso-. Seção própria sec-sesmt-ocorrencias (separada da sec-sesmt da 109a).
   Registro rápido aberto a todo usuário ativo (D15: encarregado e operador pelo celular, login por CPF) pela RPC
   sst_ocorrencia_registrar; painel no padrão Serviços (lista, kanban por status, indicadores, lições aprendidas); ficha no
   padrão Odoo (header de ações, statusbar com os 6 estados, chips, smart-buttons, abas Descrição, Envolvidos, Investigação,
   Plano de ação, Lição aprendida, Saúde, Anexos, Histórico). Saúde só pelas RPCs auditadas sst_ocorrencia_saude_ler/gravar
   (SESMT e RH em sessão aal2). Anexos no bucket privado sst-ocorrencias (pasta = id); documento médico no bucket sst-saude
   da 109a (ocorrencias/<id>/). Regras de status, numeração e permissões vivem no banco (gatilhos e RLS da migration
   20261027_fase109d_sesmt_ocorrencias.sql): o front só mostra a mensagem.
   Permissões: espelha sst_pode_operar() / sst_pode_ler() / sst_pode_ler_saude() da 109a. Enquanto podeVerSesmt() e
   sstPodeOperar() do core.js (109a) não estiverem na main, as funções locais abaixo aplicam a mesma regra (a sessão de
   contexto remove o fallback na mesclagem).
   ==================================================================== */
let _ssoRegistros = [];        // sst_ocorrencias da lista (com embeds)
let _ssoView = "lista";        // lista | kanban | indicadores | licoes
let _ssoAtual = null;          // ocorrência aberta (null = nenhuma)
let _ssoEnvolvidos = [];
let _ssoAcoes = [];
let _ssoSaude = null;          // linhas de sst_ocorrencia_saude lidas pela RPC (null = não lidas)
let _ssoAnexos = [];
let _ssoTab = "descricao";
let _ssoCarregado = false;
let _ssoPreset = null;         // { filtro, id } vindo do Para regularizar
const _ssoBase = { obras: [], equipamentos: [], funcionarios: [], profiles: [], pronto: false };

/* ---------- permissões: espelham sstPodeOperar()/podeVerSesmt() do core.js (fase 109a) ---------- */
function ssoPodeOperar(){ return sstPodeOperar(); }
function ssoPodeLerSesmt(){ return podeVerSesmt(); }
/* D15: ocorrência completa = quem lê o SESMT + engenharia e gestor de manutenção (sst_ocorrencias_pode_ler no banco) */
function ssoPodeLerOcorrencias(){
  return ssoPodeLerSesmt() || (!!usuarioAtual && ["engenheiro", "assistente_engenharia", "gestor_manutencao"].includes(usuarioAtual.cargo));
}
/* saúde: SESMT ou RH; o MFA (aal2) é conferido pelo banco na RPC */
function ssoPodeLerSaude(){ return ssoPodeOperar() || (!!usuarioAtual && usuarioAtual.cargo === "rh"); }
function ssoPodeRegistrar(){ return !!usuarioAtual && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()); }

/* ---------- constantes (listas do levantamento, seção 4.10) ---------- */
STATUS.sst_ocorrencia = {
  registrada:          { label: "Registrada",          cor: "cinza"    },
  em_investigacao:     { label: "Em investigação",     cor: "azul"     },
  plano_de_acao:       { label: "Plano de ação",       cor: "ambar"    },
  acoes_concluidas:    { label: "Ações concluídas",    cor: "azul"     },
  eficacia_verificada: { label: "Eficácia verificada", cor: "verde"    },
  encerrada:           { label: "Encerrada",           cor: "verde"    }
};
const SSO_STAGES = ["registrada", "em_investigacao", "plano_de_acao", "acoes_concluidas", "eficacia_verificada", "encerrada"];
const SSO_CATEGORIAS = {
  acidente_com_afastamento: { label: "Acidente com afastamento", cor: "vermelho" },
  acidente_sem_afastamento: { label: "Acidente sem afastamento", cor: "ambar" },
  acidente_material:        { label: "Acidente material",        cor: "ambar" },
  quase_acidente:           { label: "Quase acidente",           cor: "azul" },
  desvio:                   { label: "Desvio",                   cor: "cinza" },
  acidente_fatal:           { label: "Acidente fatal",           cor: "vermelho" }
};
const SSO_LOCAIS = { obra: "Obra", patio: "Pátio", sede: "Sede", oficina: "Oficina", trajeto: "Trajeto", outro: "Outro" };
const SSO_TIPO_PERDA = { pessoal: "Pessoal", material: "Material", ambiental: "Ambiental", sem_perda: "Sem perda", comunidade: "Evento com comunidade", terceiro: "Terceiro" };
const SSO_RELACAO = { ocupacional: "Ocupacional", trajeto: "Trajeto", nao_ocupacional: "Não ocupacional" };
const SSO_METODO = { cinco_porques: "Cinco porquês", ishikawa: "Ishikawa", arvore_de_causas: "Árvore de causas" };
const SSO_PAPEL = { envolvido: "Envolvido", testemunha: "Testemunha" };
const SSO_VINCULO = { proprio: "Funcionário CGL", terceiro: "Terceiro", visitante: "Visitante", subcontratado: "Subcontratado" };
const SSO_ACAO_STATUS = {
  a_fazer:         { label: "A fazer",         cor: "cinza" },
  em_andamento:    { label: "Em andamento",    cor: "azul" },
  realizada:       { label: "Realizada",       cor: "verde" },
  depende_da_obra: { label: "Depende da obra", cor: "ambar" }
};
const SSO_AGENTES = ["Queda de altura", "Queda de mesmo nível", "Trajeto", "Doença", "Choque elétrico", "Batida contra objeto", "Contato com produto químico",
  "Esforço excessivo", "Máquinas e equipamentos", "Incêndio e explosão", "Queda de objetos", "Torção e luxação", "Prensamento", "Corte / perfuração",
  "Projeção de partículas", "Animal peçonhento", "Material (dano)", "Outro"];
const SSO_SETORES = ["Fundação", "Solda e caldeiraria", "Tornearia", "Mecânica", "Oficina", "Lavador", "Pátio", "Almoxarifado", "Administrativo", "Logística"];
const SSO_PARTES_CORPO = ["Cabeça", "Olhos", "Face", "Pescoço", "Ombro", "Braço", "Cotovelo", "Antebraço", "Punho", "Mão direita", "Mão esquerda", "Dedos da mão",
  "Tórax", "Abdômen", "Costas / coluna", "Quadril", "Coxa", "Joelho", "Perna", "Tornozelo", "Pé direito", "Pé esquerdo", "Dedos do pé", "Pele", "Sistema respiratório",
  "Órgãos internos", "Múltiplos"];
const SSO_SEV_DIMENSOES = ["seguranca", "meio_ambiente", "financeiro", "comunidade"];
const SSO_MSG_MIGRATION = "O módulo de ocorrências ainda não está no banco (migration da fase 109d pendente).";

/* ---------- helpers ---------- */
function ssoDtLocal(ts){
  if(!ts) return "";
  const d = new Date(ts), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function ssoDtISO(local){ return local ? new Date(local).toISOString() : null; }
function ssoDtBR(ts){ return ts ? esc(new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })) : "—"; }
function ssoOpcoes(obj, vazio){
  const ph = vazio != null ? `<option value="">${esc(vazio)}</option>` : "";
  return ph + Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}">${esc(typeof v === "string" ? v : v.label)}</option>`).join("");
}
function ssoTagCategoria(c){
  const m = SSO_CATEGORIAS[c];
  return m ? `<span class="tag ${esc(m.cor)}">${esc(m.label)}</span>` : `<span class="tag cinza" title="Ainda não classificada pelo SESMT">sem classificação</span>`;
}
function ssoTagAcao(st){
  const m = SSO_ACAO_STATUS[st] || { label: st, cor: "cinza" };
  return `<span class="tag ${esc(m.cor)}">${esc(m.label)}</span>`;
}
function ssoObraRotulo(o){ return o ? `${o.codigo} — ${o.nome}` : "—"; }
function ssoEquipRotulo(e){ return e ? `${e.codigo}${e.nome ? " · " + e.nome : ""}` : "—"; }
function ssoNomeProfile(id){ const p = _ssoBase.profiles.find(x => x.id === id); return p ? p.nome : "—"; }
function ssoNomeFunc(id){ const f = _ssoBase.funcionarios.find(x => x.id === id); return f ? f.nome : "—"; }
function ssoErroMigration(err){ return !!err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST202" || err.code === "42883"); }
function ssoMsgErro(err, prefixo){
  if(!err) return prefixo;
  if(ssoErroMigration(err)) return SSO_MSG_MIGRATION;
  if(typeof ehErroDePermissao === "function" && ehErroDePermissao(err)) return prefixo + ": seu perfil não tem permissão.";
  return prefixo + ": " + (err.message || err);
}
function ssoAviso(msg, tipo){ aviso("app-aviso", msg, tipo); }
function ssoShow(id, on){ const el = $(id); if(el) el.style.display = on ? "" : "none"; }

/* ---------- base (obras, máquinas, funcionários, usuários) ---------- */
async function ssoGarantirBase(){
  if(_ssoBase.pronto) return;
  const [obras, equips, funcs, profs] = await Promise.all([
    sb.from("obras").select("id,codigo,nome,status,cliente_id").order("codigo"),
    sb.from("equipamentos").select("id,codigo,nome,ativo").order("codigo"),
    sb.from("funcionarios").select("id,nome,funcao,ativo").eq("ativo", true).order("nome"),
    sb.from("profiles").select("id,nome,cargo,ativo").eq("ativo", true).order("nome")
  ]);
  _ssoBase.obras = obras.data || [];
  _ssoBase.equipamentos = (equips.data || []).filter(e => e.ativo !== false);
  _ssoBase.funcionarios = funcs.data || [];
  _ssoBase.profiles = (profs.data || []).filter(p => !p.cargo || !["visualizador", "auditor"].includes(p.cargo));
  _ssoBase.pronto = true;
  ssoPreencherSelects();
}
function ssoPreencherSelects(){
  const obrasAtivas = _ssoBase.obras.filter(o => o.status === "em_andamento").concat(_ssoBase.obras.filter(o => o.status !== "em_andamento"));
  const optObras = `<option value="">— sem obra —</option>` + obrasAtivas.map(o => `<option value="${esc(o.id)}">${esc(ssoObraRotulo(o))}${o.status === "em_andamento" ? "" : " (" + esc(o.status) + ")"}</option>`).join("");
  const optEquip = `<option value="">— nenhuma —</option>` + _ssoBase.equipamentos.map(e => `<option value="${esc(e.id)}">${esc(ssoEquipRotulo(e))}</option>`).join("");
  const optFunc = `<option value="">— nenhum —</option>` + _ssoBase.funcionarios.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}${f.funcao ? " · " + esc(f.funcao) : ""}</option>`).join("");
  const optProf = `<option value="">— a definir —</option>` + _ssoBase.profiles.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}${p.cargo ? " · " + esc(p.cargo) : ""}</option>`).join("");
  ["sso-reg-obra", "sso-obra"].forEach(id => { if($(id)) $(id).innerHTML = optObras; });
  ["sso-reg-equip", "sso-equip"].forEach(id => { if($(id)) $(id).innerHTML = optEquip; });
  ["sso-reg-func", "sso-env-func"].forEach(id => { if($(id)) $(id).innerHTML = optFunc; });
  ["sso-coordenador", "sso-aprovada-por", "sso-acao-resp"].forEach(id => { if($(id)) $(id).innerHTML = optProf; });
  ["sso-reg-local-tipo", "sso-local-tipo"].forEach(id => { if($(id)) $(id).innerHTML = ssoOpcoes(SSO_LOCAIS); });
  if($("sso-reg-categoria")) $("sso-reg-categoria").innerHTML = ssoOpcoes(SSO_CATEGORIAS, "— deixo para o SESMT —");
  if($("sso-categoria")) $("sso-categoria").innerHTML = ssoOpcoes(SSO_CATEGORIAS, "— sem classificação —");
  if($("sso-tipo-perda")) $("sso-tipo-perda").innerHTML = ssoOpcoes(SSO_TIPO_PERDA, "—");
  if($("sso-relacao")) $("sso-relacao").innerHTML = ssoOpcoes(SSO_RELACAO, "—");
  if($("sso-metodo")) $("sso-metodo").innerHTML = ssoOpcoes(SSO_METODO, "—");
  if($("sso-agente")) $("sso-agente").innerHTML = `<option value="">—</option>` + SSO_AGENTES.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  if($("sso-env-vinculo")) $("sso-env-vinculo").innerHTML = ssoOpcoes(SSO_VINCULO);
  if($("sso-env-papel")) $("sso-env-papel").innerHTML = ssoOpcoes(SSO_PAPEL);
  if($("sso-setores-lista")) $("sso-setores-lista").innerHTML = SSO_SETORES.map(s => `<option value="${esc(s)}"></option>`).join("");
  document.querySelectorAll(".sso-sev").forEach(sel => { sel.innerHTML = `<option value="">—</option>` + [1, 2, 3, 4, 5].map(n => `<option value="${Number(n)}">${Number(n)}</option>`).join(""); });
  // filtros do painel
  if($("sso-f-categoria")) $("sso-f-categoria").innerHTML = ssoOpcoes(SSO_CATEGORIAS, "Todas as categorias") + `<option value="__sem">Sem classificação</option>`;
  if($("sso-f-status")) $("sso-f-status").innerHTML = `<option value="">Todos os status</option><option value="__abertas">Abertas (não encerradas)</option>` + opcoesStatus("sst_ocorrencia");
  if($("sso-f-obra")) $("sso-f-obra").innerHTML = `<option value="">Todas as obras</option>` + obrasAtivas.map(o => `<option value="${esc(o.id)}">${esc(ssoObraRotulo(o))}</option>`).join("");
  if($("sso-f-setor")) $("sso-f-setor").innerHTML = `<option value="">Todos os setores</option>` + SSO_SETORES.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  if($("sso-f-ano")){
    const ano = new Date().getFullYear();
    $("sso-f-ano").innerHTML = `<option value="">Todos os anos</option>` + [ano, ano - 1, ano - 2].map(a => `<option value="${Number(a)}"${a === ano ? " selected" : ""}>${Number(a)}</option>`).join("");
  }
}

/* ====================================================================
   Painel
   ==================================================================== */
let _ssoCarregando = false;
async function carregarSsoOcorrencias(){
  _ssoCarregado = true; _ssoCarregando = true;
  try { await ssoCarregarMiolo(); } finally { _ssoCarregando = false; }
}
async function ssoCarregarMiolo(){
  const leitor = ssoPodeLerOcorrencias();
  document.querySelectorAll('#sso-views [data-so-leitor]').forEach(b => { b.style.display = leitor ? "" : "none"; });
  if(!leitor && ["kanban", "indicadores"].includes(_ssoView)) _ssoView = "lista";
  ssoShow("btn-sso-registrar", ssoPodeRegistrar());
  if($("sso-titulo-lista")) $("sso-titulo-lista").firstChild.textContent = leitor ? "Ocorrências " : "Minhas ocorrências ";
  await ssoGarantirBase();
  const { data, error } = await sb.from("sst_ocorrencias")
    .select("id,numero,data_hora,status,categoria,obra_id,equipamento_id,setor,local_tipo,local_descricao,descricao,registrado_por,licao_publicada_em,created_at,obra:obras(codigo,nome),equipamento:equipamentos(codigo,nome),acoes:sst_ocorrencia_acoes(status,prazo)")
    .order("data_hora", { ascending: false }).limit(2000);
  if(error){
    $("sso-conteudo").innerHTML = `<p class="vazio">${esc(ssoMsgErro(error, "Não foi possível carregar as ocorrências"))}</p>`;
    return;
  }
  _ssoRegistros = data || [];
  if(_ssoPreset){
    const p = _ssoPreset; _ssoPreset = null;
    if(p.id){ renderSsoOcorrencias(); abrirSsoOcorrencia(p.id); return; }
    if(p.filtro) ssoAplicarPreset(p.filtro);
  }
  renderSsoOcorrencias();
}
function ssoAplicarPreset(filtro){
  _ssoView = "lista";
  if($("sso-f-ano")) $("sso-f-ano").value = "";
  if($("sso-f-categoria")) $("sso-f-categoria").value = filtro === "sem_classificacao" ? "__sem" : "";
  if($("sso-f-status")) $("sso-f-status").value = filtro === "sem_classificacao" ? "registrada" : filtro === "sem_eficacia" ? "acoes_concluidas" : "__abertas";
  if($("sso-busca")) $("sso-busca").value = "";
  _ssoFiltroExtra = filtro === "acao_vencida" ? "acao_vencida" : null;
}
let _ssoFiltroExtra = null;
function ssoAcaoVencida(a){ return a && ["a_fazer", "em_andamento"].includes(a.status) && a.prazo && a.prazo < hojeISO(); }
function ssoFiltradas(){
  const busca = ($("sso-busca")?.value || "").trim().toLowerCase();
  const ano = $("sso-f-ano")?.value || "", cat = $("sso-f-categoria")?.value || "", st = $("sso-f-status")?.value || "";
  const obra = $("sso-f-obra")?.value || "", setor = ($("sso-f-setor")?.value || "").toLowerCase();
  return _ssoRegistros.filter(o => {
    if(ano && String(o.data_hora || "").slice(0, 4) !== ano) return false;
    if(cat === "__sem" ? o.categoria : (cat && o.categoria !== cat)) return false;
    if(st === "__abertas" ? o.status === "encerrada" : (st && o.status !== st)) return false;
    if(obra && o.obra_id !== obra) return false;
    if(setor && String(o.setor || "").toLowerCase() !== setor) return false;
    if(_ssoFiltroExtra === "acao_vencida" && !(o.acoes || []).some(ssoAcaoVencida)) return false;
    if(busca){
      const txt = [o.numero, o.descricao, o.local_descricao, o.setor, o.obra?.codigo, o.obra?.nome, o.equipamento?.codigo].join(" ").toLowerCase();
      if(!txt.includes(busca)) return false;
    }
    return true;
  });
}
function renderSsoOcorrencias(){
  document.querySelectorAll("#sso-views .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === _ssoView));
  ssoShow("sso-filtros", _ssoView === "lista" || _ssoView === "kanban");
  if(_ssoView === "indicadores"){ renderSsoIndicadores(); return; }
  if(_ssoView === "licoes"){ renderSsoLicoes(); return; }
  const dados = ssoFiltradas();
  if($("sso-contador")) $("sso-contador").textContent = `${dados.length} de ${_ssoRegistros.length}`;
  if(_ssoView === "kanban") renderSsoKanban(dados); else renderSsoLista(dados);
}
function renderSsoLista(dados){
  const cont = $("sso-conteudo");
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">${_ssoRegistros.length ? "Nenhuma ocorrência com esses filtros." : "Nenhuma ocorrência registrada. Use \"+ Registrar ocorrência\" para o primeiro registro."}</p>`;
    return;
  }
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr><th>Número</th><th>Quando</th><th>Categoria</th><th>Obra / local</th><th>Máquina</th><th>Descrição</th><th>Ações</th><th>Status</th></tr></thead>
    <tbody>${dados.map(o => {
      const acoes = o.acoes || [], venc = acoes.filter(ssoAcaoVencida).length;
      return `<tr class="linha-clicavel" data-id="${esc(o.id)}">
        <td><strong>${esc(o.numero || "—")}</strong></td>
        <td style="white-space:nowrap;">${ssoDtBR(o.data_hora)}</td>
        <td>${ssoTagCategoria(o.categoria)}</td>
        <td>${o.obra ? linkObra(o.obra_id, `${o.obra.codigo} — ${o.obra.nome}`) : esc(SSO_LOCAIS[o.local_tipo] || o.local_tipo || "—")}${o.local_descricao ? `<div class="meta">${esc(o.local_descricao)}</div>` : ""}</td>
        <td>${esc(o.equipamento ? o.equipamento.codigo : "—")}</td>
        <td>${esc(String(o.descricao || "").slice(0, 120))}${String(o.descricao || "").length > 120 ? "…" : ""}</td>
        <td style="white-space:nowrap;">${acoes.length ? `${acoes.filter(a => a.status === "realizada").length}/${acoes.length}` : "—"}${venc ? ` <span class="tag vermelho" title="ações vencidas">${Number(venc)} vencida(s)</span>` : ""}</td>
        <td>${tagStatus("sst_ocorrencia", o.status)}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
  cont.querySelectorAll("tr.linha-clicavel").forEach(tr => tr.addEventListener("click", () => abrirSsoOcorrencia(tr.dataset.id)));
}
function renderSsoKanban(dados){
  const colunas = SSO_STAGES.map(st => {
    const itens = dados.filter(o => o.status === st);
    const cards = itens.map(o => `<div class="serv-kan-card linha-clicavel" data-id="${esc(o.id)}">
        <div class="serv-kan-card-nome">${esc(o.numero || "—")} · ${esc(String(o.descricao || "").slice(0, 60))}</div>
        <div class="serv-kan-card-meta">${ssoTagCategoria(o.categoria)} ${ssoDtBR(o.data_hora)}</div>
        <div class="serv-kan-card-rod">${esc(o.obra ? o.obra.codigo : (SSO_LOCAIS[o.local_tipo] || "—"))}${o.equipamento ? " · " + esc(o.equipamento.codigo) : ""}</div>
      </div>`).join("");
    return `<div class="serv-kan-col"><div class="serv-kan-col-head">${esc(STATUS.sst_ocorrencia[st].label)}<span>${itens.length}</span></div>${cards || '<div class="kan-vazio">—</div>'}</div>`;
  }).join("");
  $("sso-conteudo").innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  $("sso-conteudo").querySelectorAll(".serv-kan-card").forEach(c => c.addEventListener("click", () => abrirSsoOcorrencia(c.dataset.id)));
}

/* ---------- indicadores (sst_indicadores: só agregados) ---------- */
async function renderSsoIndicadores(){
  const cont = $("sso-conteudo");
  const ano = Number($("sso-f-ano")?.value) || new Date().getFullYear();
  if($("sso-contador")) $("sso-contador").textContent = String(ano);
  cont.innerHTML = `<p class="vazio">Calculando…</p>`;
  const { data: k, error } = await sb.rpc("sst_indicadores", { p_ano: ano });
  if(error){ cont.innerHTML = `<p class="vazio">${esc(ssoMsgErro(error, "Não foi possível calcular os indicadores"))}</p>`; return; }
  const t = k.totais || {}, meses = k.meses || [];
  const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const tile = (rot, val, sub, cor) => `<div class="dash-card"><div class="dash-card-rot">${esc(rot)}</div><div class="dash-card-num">${cor ? `<span class="tag ${esc(cor)}">${esc(val)}</span>` : esc(val)}</div><div class="dash-card-sub">${esc(sub || "")}</div></div>`;
  const fmt = v => v == null ? "—" : num(v);
  const anos = [ano - 2, ano - 1, ano, ano + (new Date().getFullYear() > ano ? 1 : 0)].filter((a, i, arr) => arr.indexOf(a) === i && a <= new Date().getFullYear());
  cont.innerHTML = `
    <div class="serv-filtros"><label>Ano <select id="sso-ind-ano">${anos.map(a => `<option value="${Number(a)}"${a === ano ? " selected" : ""}>${Number(a)}</option>`).join("")}</select></label>
      <button type="button" class="btn-sec btn-sm" id="btn-sso-ind-xlsx">Exportar .xlsx</button></div>
    <div class="dash-epi-grade" style="margin:var(--esp-3) 0;">
      ${tile("Ocorrências no ano", String(t.ocorrencias || 0), `${t.quase_acidentes || 0} quase acidente(s) · ${t.desvios || 0} desvio(s)`)}
      ${tile("Acidentes", String(t.acidentes || 0), `${t.com_afastamento || 0} com afastamento · ${t.sem_afastamento || 0} sem · ${t.fatais || 0} fatal`, t.acidentes ? "vermelho" : "")}
      ${tile("Dias perdidos", String(t.dias_perdidos || 0), `${t.dias_debitados || 0} debitado(s) · ${t.cats || 0} CAT(s)`)}
      ${tile("Dias sem acidente", k.dias_sem_acidente == null ? "—" : String(k.dias_sem_acidente), k.ultimo_acidente_em ? "último em " + dataBR(k.ultimo_acidente_em) : "nenhum acidente registrado", k.dias_sem_acidente != null && k.dias_sem_acidente < 30 ? "ambar" : "verde")}
      ${tile("HHT no ano", fmt(t.hht), "horas da equipe do RDO")}
      ${tile("Taxa de frequência", fmt(t.taxa_frequencia), "acidentes × 10⁶ / HHT (NBR 14280)")}
      ${tile("Taxa de gravidade", fmt(t.taxa_gravidade), "dias perdidos + debitados × 10⁶ / HHT")}
      ${tile("Ações vencidas", String(k.acoes_vencidas || 0), `${k.abertas || 0} ocorrência(s) aberta(s) · ${k.sem_classificacao || 0} sem classificação`, k.acoes_vencidas ? "vermelho" : "")}
    </div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Mês</th><th>Ocorrências</th><th>Acidentes</th><th>Com afast.</th><th>Sem afast.</th><th>Material</th><th>Quase acid.</th><th>Desvios</th><th>Dias perdidos</th><th>CATs</th><th>HHT</th><th>TF</th><th>TG</th></tr></thead>
      <tbody>${meses.map(m => `<tr><td>${esc(MES[(m.mes || 1) - 1])}</td><td>${num(m.ocorrencias)}</td><td>${num(m.acidentes)}</td><td>${num(m.com_afastamento)}</td><td>${num(m.sem_afastamento)}</td><td>${num(m.material)}</td><td>${num(m.quase_acidentes)}</td><td>${num(m.desvios)}</td><td>${num(m.dias_perdidos)}</td><td>${num(m.cats)}</td><td>${fmt(m.hht)}</td><td>${fmt(m.taxa_frequencia)}</td><td>${fmt(m.taxa_gravidade)}</td></tr>`).join("")}
      <tr><th>Total</th><th>${num(t.ocorrencias)}</th><th>${num(t.acidentes)}</th><th>${num(t.com_afastamento)}</th><th>${num(t.sem_afastamento)}</th><th>${num(t.material)}</th><th>${num(t.quase_acidentes)}</th><th>${num(t.desvios)}</th><th>${num(t.dias_perdidos)}</th><th>${num(t.cats)}</th><th>${fmt(t.hht)}</th><th>${fmt(t.taxa_frequencia)}</th><th>${fmt(t.taxa_gravidade)}</th></tr></tbody></table></div>
    <p class="meta">${esc(k.hht_fonte || "")}</p>`;
  $("sso-ind-ano")?.addEventListener("change", e => { if($("sso-f-ano")) $("sso-f-ano").value = e.target.value; renderSsoIndicadores(); });
  $("btn-sso-ind-xlsx")?.addEventListener("click", () => {
    if(typeof XLSX === "undefined"){ ssoAviso("Biblioteca de planilha não carregada.", "erro"); return; }
    const linhas = meses.map(m => ({ Mês: MES[(m.mes || 1) - 1], Ocorrências: m.ocorrencias, Acidentes: m.acidentes, "Com afastamento": m.com_afastamento, "Sem afastamento": m.sem_afastamento,
      Material: m.material, "Quase acidentes": m.quase_acidentes, Desvios: m.desvios, "Dias perdidos": m.dias_perdidos, "Dias debitados": m.dias_debitados, CATs: m.cats, HHT: m.hht, TF: m.taxa_frequencia, TG: m.taxa_gravidade }));
    const ws = XLSX.utils.json_to_sheet(linhas), wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Indicadores ${ano}`);
    XLSX.writeFile(wb, `indicadores-sst-${ano}.xlsx`);
  });
}

/* ---------- lições aprendidas (vw_sst_licoes: publicadas, sem envolvido; todo usuário ativo) ---------- */
async function renderSsoLicoes(){
  const cont = $("sso-conteudo");
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  const { data, error } = await sb.from("vw_sst_licoes").select("*").order("licao_publicada_em", { ascending: false }).limit(500);
  if(error){ cont.innerHTML = `<p class="vazio">${esc(ssoMsgErro(error, "Não foi possível carregar as lições"))}</p>`; return; }
  const lista = data || [];
  if($("sso-contador")) $("sso-contador").textContent = String(lista.length);
  if(!lista.length){ cont.innerHTML = `<p class="vazio">Nenhuma lição aprendida publicada ainda.</p>`; return; }
  const leitor = ssoPodeLerOcorrencias();
  cont.innerHTML = lista.map(l => `<div class="hist-item${leitor ? " linha-clicavel" : ""}" data-id="${esc(l.id)}">
      <div class="hist-item-topo"><strong>${esc(l.numero || "")}</strong> ${ssoTagCategoria(l.categoria)} <span class="meta">${dataBR(l.data)}${l.obra_codigo ? " · " + esc(l.obra_codigo + " — " + (l.obra_nome || "")) : ""}${l.setor ? " · " + esc(l.setor) : ""}${l.equipamento_codigo ? " · " + esc(l.equipamento_codigo) : ""}</span></div>
      <div class="hist-item-corpo">${esc(l.licao_aprendida || "")}</div>
      <div class="meta">Publicada em ${ssoDtBR(l.licao_publicada_em)}${l.licao_divulgada_dss_em ? " · divulgada no DSS em " + dataBR(l.licao_divulgada_dss_em) : ""}</div>
    </div>`).join("");
  if(leitor) cont.querySelectorAll(".hist-item.linha-clicavel").forEach(el => el.addEventListener("click", () => abrirSsoOcorrencia(el.dataset.id)));
}

/* ====================================================================
   Registro rápido (RPC sst_ocorrencia_registrar) — qualquer usuário ativo
   ==================================================================== */
async function ssoAbrirRegistro(){
  if(!ssoPodeRegistrar()){ ssoAviso("Usuário de revisão não grava.", "erro"); return; }
  await ssoGarantirBase();
  ssoLimparRegistro();
  ssoShow("sso-registro-card", true);
  $("sso-registro-card").scrollIntoView({ behavior: "smooth", block: "start" });
}
function ssoLimparRegistro(){
  if($("sso-reg-data")) $("sso-reg-data").value = ssoDtLocal(new Date());
  ["sso-reg-local", "sso-reg-descricao", "sso-reg-acoes", "sso-reg-externo"].forEach(id => { if($(id)) $(id).value = ""; });
  ["sso-reg-obra", "sso-reg-equip", "sso-reg-categoria", "sso-reg-func"].forEach(id => { if($(id)) $(id).value = ""; });
  if($("sso-reg-local-tipo")) $("sso-reg-local-tipo").value = "obra";
  if($("sso-reg-fotos")) $("sso-reg-fotos").value = "";
  const av = $("sso-reg-aviso"); if(av){ av.textContent = ""; av.className = "aviso"; }
}
async function ssoEnviarRegistro(){
  const desc = ($("sso-reg-descricao").value || "").trim();
  if(!desc){ aviso("sso-reg-aviso", "Descreva o que aconteceu.", "erro"); return; }
  if(!$("sso-reg-data").value){ aviso("sso-reg-aviso", "Informe quando aconteceu.", "erro"); return; }
  const envolvidos = [];
  if($("sso-reg-func").value) envolvidos.push({ funcionario_id: $("sso-reg-func").value, papel: "envolvido" });
  if(($("sso-reg-externo").value || "").trim()) envolvidos.push({ nome_externo: $("sso-reg-externo").value.trim(), vinculo: "terceiro", papel: "envolvido" });
  const dados = {
    data_hora: ssoDtISO($("sso-reg-data").value), obra_id: $("sso-reg-obra").value || null, local_tipo: $("sso-reg-local-tipo").value || null,
    local_descricao: $("sso-reg-local").value || null, equipamento_id: $("sso-reg-equip").value || null, categoria: $("sso-reg-categoria").value || null,
    descricao: desc, acoes_imediatas: $("sso-reg-acoes").value || null, envolvidos
  };
  const { data, error } = await sb.rpc("sst_ocorrencia_registrar", { p_dados: dados });
  if(error){ aviso("sso-reg-aviso", ssoMsgErro(error, "Não foi possível registrar"), "erro"); return; }
  const arquivos = [...($("sso-reg-fotos").files || [])];
  let subidos = 0, falhas = 0;
  for(const f of arquivos){ const ok = await ssoSubirAnexo(data.id, f); if(ok) subidos++; else falhas++; }
  ssoAviso(`Ocorrência ${data.numero} registrada${arquivos.length ? ` com ${subidos} arquivo(s)${falhas ? ` (${falhas} não enviado(s))` : ""}` : ""}. O SESMT vai classificar.`, "ok");
  ssoLimparRegistro();
  ssoShow("sso-registro-card", false);
  await carregarSsoOcorrencias();
}
async function ssoSubirAnexo(ocorrenciaId, file){
  const ext = extensaoArquivo(file), mime = mimeDoArquivo(file, ext);
  const path = `${ocorrenciaId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("sst-ocorrencias").upload(path, corpoComMime(file, mime), { contentType: mime, upsert: false });
  if(error){ console.error("Anexo SST:", error); return false; }
  return true;
}

/* ====================================================================
   Ficha (Odoo)
   ==================================================================== */
function mostrarPainelSso(){
  ssoShow("sso-ficha", false); ssoShow("sso-painel", true);
  _ssoAtual = null;
  if(typeof ocultarHistorico === "function") ocultarHistorico("sso-historico");
}
async function abrirSsoOcorrencia(id){
  await ssoGarantirBase();
  const { data, error } = await sb.from("sst_ocorrencias").select("*,obra:obras(codigo,nome),equipamento:equipamentos(codigo,nome),registrado:profiles!sst_ocorrencias_registrado_por_fkey(nome)").eq("id", id).single();
  if(error || !data){ ssoAviso(ssoMsgErro(error, "Não foi possível abrir a ocorrência"), "erro"); return; }
  _ssoAtual = data; _ssoSaude = null;
  ssoShow("sso-painel", false); ssoShow("sso-ficha", true);
  ssoPreencherFicha(data);
  await Promise.all([ssoCarregarEnvolvidos(), ssoCarregarAcoes(), ssoCarregarAnexos()]);
  ssoAtivarTab(_ssoTab === "saude" && !ssoPodeLerSaude() ? "descricao" : _ssoTab);
  if(typeof montarHistorico === "function") montarHistorico("sst_ocorrencias", id, "sso-historico");
  window.scrollTo({ top: 0 });
}
function ssoPreencherFicha(o){
  const oper = ssoPodeOperar();
  $("sso-ficha-titulo").textContent = `${o.numero || "Ocorrência"} · ${SSO_CATEGORIAS[o.categoria]?.label || "sem classificação"}`;
  $("sso-chip-numero").textContent = o.numero || "—";
  $("sso-chip-categoria").innerHTML = ssoTagCategoria(o.categoria);
  $("sso-chip-data").innerHTML = ssoDtBR(o.data_hora);
  $("sso-chip-obra").innerHTML = o.obra ? linkObra(o.obra_id, `${o.obra.codigo} — ${o.obra.nome}`) : esc(SSO_LOCAIS[o.local_tipo] || "—");
  $("sso-chip-equip").textContent = o.equipamento ? ssoEquipRotulo(o.equipamento) : "—";
  $("sso-chip-registrado").textContent = o.registrado?.nome || "—";
  ssoAtualizarStatusbar(o.status);
  $("sso-data").value = ssoDtLocal(o.data_hora);
  $("sso-categoria").value = o.categoria || "";
  $("sso-local-tipo").value = o.local_tipo || "obra";
  $("sso-obra").value = o.obra_id || "";
  $("sso-equip").value = o.equipamento_id || "";
  $("sso-setor").value = o.setor || "";
  $("sso-local").value = o.local_descricao || "";
  $("sso-atividade").value = o.atividade || "";
  $("sso-tipo-perda").value = o.tipo_perda || "";
  $("sso-relacao").value = o.relacao_trabalho || "";
  $("sso-agente").value = o.agente || "";
  if(o.agente && !SSO_AGENTES.includes(o.agente)) $("sso-agente").insertAdjacentHTML("beforeend", `<option value="${esc(o.agente)}" selected>${esc(o.agente)}</option>`);
  $("sso-comunicado-cliente").value = ssoDtLocal(o.comunicado_cliente_em);
  $("sso-descricao").value = o.descricao || "";
  $("sso-acoes-imediatas").value = o.acoes_imediatas || "";
  $("sso-cronologia").value = Array.isArray(o.cronologia) ? o.cronologia.map(c => [c.hora, c.fato].filter(Boolean).join(" — ")).join("\n") : "";
  SSO_SEV_DIMENSOES.forEach(d => {
    $(`sso-sev-real-${d}`).value = (o.severidade_real && o.severidade_real[d]) || "";
    $(`sso-sev-pot-${d}`).value = (o.severidade_potencial && o.severidade_potencial[d]) || "";
  });
  $("sso-observacoes").value = o.observacoes || "";
  $("sso-metodo").value = o.metodo || "";
  $("sso-coordenador").value = o.coordenador_id || "";
  $("sso-equipe").value = o.equipe || "";
  $("sso-causa-imediata").value = o.causa_imediata || "";
  $("sso-causas-basicas").value = o.causas_basicas || "";
  $("sso-fatores").value = o.fatores_contribuintes || "";
  $("sso-fatores-positivos").value = o.fatores_positivos || "";
  $("sso-fatos-treinamento").value = o.fatos_treinamento || "";
  $("sso-fatos-epi").value = o.fatos_epi || "";
  $("sso-fatos-ferramenta").value = o.fatos_ferramenta || "";
  $("sso-fatos-ambiente").value = o.fatos_ambiente || "";
  $("sso-fatos-pessoas").value = o.fatos_outras_pessoas || "";
  $("sso-licao").value = o.licao_aprendida || "";
  $("sso-licao-publicada").value = ssoDtLocal(o.licao_publicada_em);
  $("sso-licao-dss").value = o.licao_divulgada_dss_em || "";
  $("sso-aprovada-por").value = o.aprovada_por || "";
  // quem não opera só lê: campos travados, botões de gravação escondidos
  document.querySelectorAll("#sso-ficha .odoo-body input, #sso-ficha .odoo-body select, #sso-ficha .odoo-body textarea").forEach(el => {
    if(el.closest("#sso-anexo-arquivos, #sso-saude-conteudo")) return;
    el.disabled = !oper;
  });
  ["btn-sso-salvar", "btn-sso-investigar", "btn-sso-encerrar", "btn-sso-env-add", "btn-sso-acao-add"].forEach(id => ssoShow(id, oper));
  ssoShow("btn-sso-excluir", oper && o.status === "registrada");
  ssoShow("btn-sso-investigar", oper && ["registrada", "em_investigacao"].includes(o.status));
  ssoShow("btn-sso-encerrar", oper && o.status !== "encerrada");
  ssoShow("sso-tab-saude-btn", ssoPodeLerSaude());
  // anexo: quem opera ou quem registrou (até a classificação)
  const podeAnexar = oper || (o.registrado_por === usuarioAtual?.id && o.status === "registrada");
  ["sso-anexo-arquivos", "btn-sso-anexo-enviar"].forEach(id => { ssoShow(id, podeAnexar); if($(id)) $(id).disabled = !podeAnexar; });
}
function ssoAtualizarStatusbar(st){
  const idx = SSO_STAGES.indexOf(st);
  document.querySelectorAll("#sso-statusbar .stage").forEach(el => {
    el.classList.remove("atual", "passada");
    const i = SSO_STAGES.indexOf(el.dataset.status);
    if(i === idx) el.classList.add("atual"); else if(i < idx) el.classList.add("passada");
  });
}
function ssoAtivarTab(nome){
  _ssoTab = nome;
  document.querySelectorAll("#sso-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#sso-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
  if(nome === "saude" && _ssoAtual && _ssoSaude === null) ssoCarregarSaude();
}
function ssoColetarFicha(){
  const sev = chave => { const r = {}; let tem = false; SSO_SEV_DIMENSOES.forEach(d => { const v = $(`sso-sev-${chave}-${d}`).value; if(v){ r[d] = Number(v); tem = true; } }); return tem ? r : null; };
  const cron = ($("sso-cronologia").value || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(\d{1,2}:\d{2})\s*[—–-]\s*(.*)$/); return m ? { hora: m[1], fato: m[2] } : { fato: l };
  });
  return {
    data_hora: ssoDtISO($("sso-data").value), categoria: $("sso-categoria").value || null, local_tipo: $("sso-local-tipo").value || "obra",
    obra_id: $("sso-obra").value || null, equipamento_id: $("sso-equip").value || null, setor: $("sso-setor").value.trim() || null,
    local_descricao: $("sso-local").value.trim() || null, atividade: $("sso-atividade").value.trim() || null,
    tipo_perda: $("sso-tipo-perda").value || null, relacao_trabalho: $("sso-relacao").value || null, agente: $("sso-agente").value || null,
    comunicado_cliente_em: ssoDtISO($("sso-comunicado-cliente").value), descricao: $("sso-descricao").value.trim(),
    acoes_imediatas: $("sso-acoes-imediatas").value.trim() || null, cronologia: cron.length ? cron : null,
    severidade_real: sev("real"), severidade_potencial: sev("pot"), observacoes: $("sso-observacoes").value.trim() || null,
    metodo: $("sso-metodo").value || null, coordenador_id: $("sso-coordenador").value || null, equipe: $("sso-equipe").value.trim() || null,
    causa_imediata: $("sso-causa-imediata").value.trim() || null, causas_basicas: $("sso-causas-basicas").value.trim() || null,
    fatores_contribuintes: $("sso-fatores").value.trim() || null, fatores_positivos: $("sso-fatores-positivos").value.trim() || null,
    fatos_treinamento: $("sso-fatos-treinamento").value.trim() || null, fatos_epi: $("sso-fatos-epi").value.trim() || null,
    fatos_ferramenta: $("sso-fatos-ferramenta").value.trim() || null, fatos_ambiente: $("sso-fatos-ambiente").value.trim() || null,
    fatos_outras_pessoas: $("sso-fatos-pessoas").value.trim() || null,
    licao_aprendida: $("sso-licao").value.trim() || null, licao_publicada_em: ssoDtISO($("sso-licao-publicada").value),
    licao_divulgada_dss_em: $("sso-licao-dss").value || null, aprovada_por: $("sso-aprovada-por").value || null
  };
}
async function salvarSsoOcorrencia(novoStatus){
  if(!_ssoAtual || !ssoPodeOperar()) return false;
  const dados = ssoColetarFicha();
  if(!dados.descricao){ ssoAviso("A descrição é obrigatória.", "erro"); ssoAtivarTab("descricao"); return false; }
  if(!dados.data_hora){ ssoAviso("Informe quando aconteceu.", "erro"); ssoAtivarTab("descricao"); return false; }
  if(novoStatus) dados.status = novoStatus;
  const { error } = await sb.from("sst_ocorrencias").update(dados).eq("id", _ssoAtual.id);
  if(error){ ssoAviso(ssoMsgErro(error, "Não foi possível salvar"), "erro"); return false; }
  ssoAviso(novoStatus ? `Ocorrência ${_ssoAtual.numero}: ${STATUS.sst_ocorrencia[novoStatus].label.toLowerCase()}.` : "Ocorrência salva.", "ok");
  await abrirSsoOcorrencia(_ssoAtual.id);
  if(_ssoCarregado) carregarSsoOcorrencias();
  return true;
}
async function ssoMudarStatus(novo){
  if(!_ssoAtual || !ssoPodeOperar() || novo === _ssoAtual.status) return;
  if(novo === "encerrada" && !($("sso-licao").value || "").trim()){
    ssoAviso("Escreva a lição aprendida antes de encerrar.", "erro"); ssoAtivarTab("licao"); return;
  }
  if(novo !== "registrada" && !$("sso-categoria").value){
    ssoAviso("Classifique a ocorrência (categoria) antes de mudar o status.", "erro"); ssoAtivarTab("descricao"); return;
  }
  await salvarSsoOcorrencia(novo);
}
async function excluirSsoOcorrencia(){
  if(!_ssoAtual || !ssoPodeOperar()) return;
  if(!confirm(`Excluir a ocorrência ${_ssoAtual.numero}? Só ocorrência ainda "registrada" pode ser excluída; envolvidos, ações e saúde vão junto.`)) return;
  const { error } = await sb.from("sst_ocorrencias").delete().eq("id", _ssoAtual.id);
  if(error){ ssoAviso(ssoMsgErro(error, "Não foi possível excluir"), "erro"); return; }
  ssoAviso("Ocorrência excluída.", "ok");
  mostrarPainelSso();
  carregarSsoOcorrencias();
}

/* ---------- envolvidos ---------- */
async function ssoCarregarEnvolvidos(){
  const { data } = await sb.from("sst_ocorrencia_envolvidos").select("*").eq("ocorrencia_id", _ssoAtual.id).order("created_at");
  _ssoEnvolvidos = data || [];
  const sbn = $("sb-sso-envolvidos"); sbn.querySelector(".sb-num").textContent = _ssoEnvolvidos.length; sbn.classList.toggle("zero", !_ssoEnvolvidos.length);
  const oper = ssoPodeOperar();
  $("sso-env-lista").innerHTML = !_ssoEnvolvidos.length ? `<p class="vazio">Nenhum envolvido informado.</p>` : `<div class="tabela-rola"><table>
    <thead><tr><th>Pessoa</th><th>Vínculo</th><th>Papel</th><th>Função na data</th>${oper ? "<th></th>" : ""}</tr></thead>
    <tbody>${_ssoEnvolvidos.map(e => `<tr>
      <td>${esc(e.funcionario_id ? ssoNomeFunc(e.funcionario_id) : (e.nome_externo || "—"))}</td>
      <td>${esc(SSO_VINCULO[e.vinculo] || e.vinculo)}</td><td>${esc(SSO_PAPEL[e.papel] || e.papel)}</td><td>${esc(e.funcao_na_data || "—")}</td>
      ${oper ? `<td class="col-acao"><button type="button" class="btn-rem" data-env-rem="${esc(e.id)}" title="Remover">×</button></td>` : ""}
    </tr>`).join("")}</tbody></table></div>`;
  $("sso-env-lista").querySelectorAll("[data-env-rem]").forEach(b => b.addEventListener("click", () => ssoRemoverEnvolvido(b.dataset.envRem)));
}
async function ssoAdicionarEnvolvido(){
  if(!_ssoAtual) return;
  const funcId = $("sso-env-func").value || null, externo = ($("sso-env-externo").value || "").trim() || null;
  if(!funcId && !externo){ ssoAviso("Escolha o funcionário ou informe o nome externo.", "erro"); return; }
  const f = funcId ? _ssoBase.funcionarios.find(x => x.id === funcId) : null;
  const { error } = await sb.from("sst_ocorrencia_envolvidos").insert({
    ocorrencia_id: _ssoAtual.id, funcionario_id: funcId, nome_externo: funcId ? null : externo,
    vinculo: funcId ? "proprio" : ($("sso-env-vinculo").value || "terceiro"), papel: $("sso-env-papel").value || "envolvido",
    funcao_na_data: ($("sso-env-funcao").value || "").trim() || (f && f.funcao) || null
  });
  if(error){ ssoAviso(ssoMsgErro(error, "Não foi possível adicionar"), "erro"); return; }
  ["sso-env-func", "sso-env-externo", "sso-env-funcao"].forEach(id => { $(id).value = ""; });
  await ssoCarregarEnvolvidos();
  if(_ssoSaude !== null) ssoCarregarSaude();
}
async function ssoRemoverEnvolvido(id){
  if(!confirm("Remover este envolvido? Os dados de saúde dele nesta ocorrência vão junto.")) return;
  const { error } = await sb.from("sst_ocorrencia_envolvidos").delete().eq("id", id);
  if(error){ ssoAviso(ssoMsgErro(error, "Não foi possível remover"), "erro"); return; }
  await ssoCarregarEnvolvidos();
}

/* ---------- plano de ação ---------- */
async function ssoCarregarAcoes(){
  const { data } = await sb.from("sst_ocorrencia_acoes").select("*").eq("ocorrencia_id", _ssoAtual.id).order("ordem").order("created_at");
  _ssoAcoes = data || [];
  const venc = _ssoAcoes.filter(ssoAcaoVencida).length;
  const set = (id, n) => { const b = $(id); b.querySelector(".sb-num").textContent = n; b.classList.toggle("zero", !n); };
  set("sb-sso-acoes", _ssoAcoes.length); set("sb-sso-acoes-vencidas", venc);
  const oper = ssoPodeOperar(), eu = usuarioAtual?.id;
  $("sso-acoes-lista").innerHTML = !_ssoAcoes.length ? `<p class="vazio">Nenhuma ação no plano.</p>` : `<div class="tabela-rola"><table>
    <thead><tr><th>Causa / fator</th><th>Ação</th><th>Responsável</th><th>Setor</th><th>Prazo</th><th>Status</th><th>Evidência</th><th>Eficácia</th>${oper ? "<th></th>" : ""}</tr></thead>
    <tbody>${_ssoAcoes.map(a => {
      const minha = a.responsavel_id === eu, podeAndar = oper || minha, vencida = ssoAcaoVencida(a);
      return `<tr${vencida ? ' class="txt-perigo"' : ""}>
        <td>${esc(a.causa_ou_fator || "—")}</td>
        <td>${esc(a.acao)}</td>
        <td>${esc(ssoNomeProfile(a.responsavel_id))}</td>
        <td>${esc(a.setor || "—")}</td>
        <td style="white-space:nowrap;">${a.prazo ? dataBR(a.prazo) : "—"}${vencida ? ' <span class="tag vermelho">vencida</span>' : ""}</td>
        <td>${podeAndar ? `<select data-acao-status="${esc(a.id)}">${ssoOpcoes(SSO_ACAO_STATUS)}</select>` : ssoTagAcao(a.status)}${a.realizada_em ? `<div class="meta">em ${dataBR(a.realizada_em)}</div>` : ""}</td>
        <td>${podeAndar ? `<input data-acao-evid="${esc(a.id)}" value="${esc(a.evidencia || "")}" placeholder="o que comprova" />` : esc(a.evidencia || "—")}</td>
        <td style="white-space:nowrap;">${oper ? `<input type="date" data-acao-efic="${esc(a.id)}" value="${esc(a.eficacia_verificada_em || "")}" title="Eficácia verificada em" />
            <select data-acao-efic-ok="${esc(a.id)}" title="Eficaz?"><option value="">—</option><option value="true">eficaz</option><option value="false">não eficaz</option></select>`
          : (a.eficacia_verificada_em ? `${dataBR(a.eficacia_verificada_em)} · ${a.eficacia_ok === true ? "eficaz" : a.eficacia_ok === false ? "não eficaz" : "—"}` : "—")}</td>
        ${oper ? `<td class="col-acao"><button type="button" class="btn-rem" data-acao-rem="${esc(a.id)}" title="Remover">×</button></td>` : ""}
      </tr>`;
    }).join("")}</tbody></table></div>
    <p class="meta">O responsável marca o andamento e a evidência da própria ação; o SESMT define a ação, o prazo e verifica a eficácia. O status da ocorrência não avança para "ações concluídas" com ação a fazer ou em andamento.</p>`;
  const cont = $("sso-acoes-lista");
  _ssoAcoes.forEach(a => {
    const s = cont.querySelector(`[data-acao-status="${a.id}"]`); if(s) s.value = a.status;
    const ok = cont.querySelector(`[data-acao-efic-ok="${a.id}"]`); if(ok) ok.value = a.eficacia_ok === true ? "true" : a.eficacia_ok === false ? "false" : "";
  });
  cont.querySelectorAll("[data-acao-status]").forEach(s => s.addEventListener("change", () => ssoAtualizarAcao(s.dataset.acaoStatus, { status: s.value })));
  cont.querySelectorAll("[data-acao-evid]").forEach(i => i.addEventListener("change", () => ssoAtualizarAcao(i.dataset.acaoEvid, { evidencia: i.value.trim() || null })));
  cont.querySelectorAll("[data-acao-efic]").forEach(i => i.addEventListener("change", () => ssoAtualizarAcao(i.dataset.acaoEfic, { eficacia_verificada_em: i.value || null })));
  cont.querySelectorAll("[data-acao-efic-ok]").forEach(s => s.addEventListener("change", () => ssoAtualizarAcao(s.dataset.acaoEficOk, { eficacia_ok: s.value === "" ? null : s.value === "true", eficacia_verificada_em: $("sso-acoes-lista").querySelector(`[data-acao-efic="${s.dataset.acaoEficOk}"]`)?.value || hojeISO() })));
  cont.querySelectorAll("[data-acao-rem]").forEach(b => b.addEventListener("click", () => ssoRemoverAcao(b.dataset.acaoRem)));
}
async function ssoAdicionarAcao(){
  if(!_ssoAtual) return;
  const texto = ($("sso-acao-texto").value || "").trim();
  if(!texto){ ssoAviso("Descreva a ação.", "erro"); return; }
  const { error } = await sb.from("sst_ocorrencia_acoes").insert({
    ocorrencia_id: _ssoAtual.id, causa_ou_fator: ($("sso-acao-causa").value || "").trim() || null, acao: texto,
    responsavel_id: $("sso-acao-resp").value || null, setor: ($("sso-acao-setor").value || "").trim() || null,
    prazo: $("sso-acao-prazo").value || null, ordem: _ssoAcoes.length + 1
  });
  if(error){ ssoAviso(ssoMsgErro(error, "Não foi possível adicionar a ação"), "erro"); return; }
  ["sso-acao-causa", "sso-acao-texto", "sso-acao-setor", "sso-acao-prazo", "sso-acao-resp"].forEach(id => { $(id).value = ""; });
  await ssoCarregarAcoes();
}
async function ssoAtualizarAcao(id, campos){
  const { data, error } = await sb.from("sst_ocorrencia_acoes").update(campos).eq("id", id).select("id");
  if(error){ ssoAviso(ssoMsgErro(error, "Não foi possível atualizar a ação"), "erro"); await ssoCarregarAcoes(); return; }
  if(!data || !data.length){ ssoAviso("Só o responsável da ação ou o SESMT atualiza esta ação.", "erro"); await ssoCarregarAcoes(); return; }
  await ssoCarregarAcoes();
}
async function ssoRemoverAcao(id){
  if(!confirm("Remover esta ação do plano?")) return;
  const { error } = await sb.from("sst_ocorrencia_acoes").delete().eq("id", id);
  if(error){ ssoAviso(ssoMsgErro(error, "Não foi possível remover"), "erro"); return; }
  await ssoCarregarAcoes();
}

/* ---------- saúde (área restrita; RPCs auditadas) ---------- */
async function ssoCarregarSaude(){
  const cont = $("sso-saude-conteudo");
  if(!ssoPodeLerSaude()){ cont.innerHTML = `<p class="vazio">Área restrita ao SESMT e ao RH.</p>`; return; }
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  const { data, error } = await sb.rpc("sst_ocorrencia_saude_ler", { p_ocorrencia: _ssoAtual.id });
  if(error){
    _ssoSaude = [];
    cont.innerHTML = `<p class="vazio">${esc(error.code === "42501" || /MFA|verificada/i.test(error.message || "") ? "Dado de saúde só com a sessão verificada (MFA). Saia e entre de novo com o código do autenticador." : ssoMsgErro(error, "Não foi possível ler"))}</p>`;
    return;
  }
  _ssoSaude = data || [];
  const oper = ssoPodeOperar();
  const envolvidos = _ssoEnvolvidos.filter(e => e.papel === "envolvido");
  if(!envolvidos.length){ cont.innerHTML = `<p class="vazio">Adicione o envolvido na aba Envolvidos para registrar lesão, afastamento e CAT.</p>`; return; }
  cont.innerHTML = envolvidos.map(e => {
    const s = _ssoSaude.find(x => x.envolvido_id === e.id) || {};
    const nome = e.funcionario_id ? ssoNomeFunc(e.funcionario_id) : (e.nome_externo || "—");
    const docs = Array.isArray(s.documentos) ? s.documentos : [];
    return `<div class="card compacto" data-saude-env="${esc(e.id)}">
      <div class="lista-topo compacta"><h4 class="titulo-linha">${esc(nome)}${e.funcao_na_data ? ` <span class="meta">· ${esc(e.funcao_na_data)}</span>` : ""}</h4></div>
      <div class="grade">
        <div class="campo"><label>Parte do corpo</label><select data-s="parte_corpo"><option value="">—</option>${SSO_PARTES_CORPO.map(p => `<option value="${esc(p)}"${s.parte_corpo === p ? " selected" : ""}>${esc(p)}</option>`).join("")}${s.parte_corpo && !SSO_PARTES_CORPO.includes(s.parte_corpo) ? `<option value="${esc(s.parte_corpo)}" selected>${esc(s.parte_corpo)}</option>` : ""}</select></div>
        <div class="campo"><label>Tipo de lesão</label><input data-s="tipo_lesao" value="${esc(s.tipo_lesao || "")}" placeholder="corte, fratura, contusão…" /></div>
        <div class="campo"><label>Afastamento</label><select data-s="afastamento"><option value="false"${!s.afastamento ? " selected" : ""}>Não</option><option value="true"${s.afastamento ? " selected" : ""}>Sim</option></select></div>
        <div class="campo"><label>Dias perdidos</label><input type="number" min="0" step="1" data-s="dias_perdidos" value="${esc(s.dias_perdidos ?? 0)}" /></div>
        <div class="campo"><label>Dias debitados</label><input type="number" min="0" step="1" data-s="dias_debitados" value="${esc(s.dias_debitados ?? 0)}" /></div>
        <div class="campo"><label>CAT emitida</label><select data-s="cat_emitida"><option value="false"${!s.cat_emitida ? " selected" : ""}>Não</option><option value="true"${s.cat_emitida ? " selected" : ""}>Sim</option></select></div>
        <div class="campo"><label>Número da CAT</label><input data-s="cat_numero" value="${esc(s.cat_numero || "")}" /></div>
        <div class="campo"><label>Data da CAT</label><input type="date" data-s="cat_data" value="${esc(s.cat_data || "")}" /></div>
        <div class="campo"><label>S-2210 enviado em</label><input type="date" data-s="s2210_enviado_em" value="${esc(s.s2210_enviado_em || "")}" /></div>
        <div class="campo largo"><label>Observação médica</label><textarea data-s="observacao_medica" rows="2">${esc(s.observacao_medica || "")}</textarea></div>
        <div class="campo largo"><label>Documentos médicos (bucket restrito)</label>
          ${docs.length ? `<ul class="meta">${docs.map(d => `<li><a href="#" data-saude-doc="${esc(d.path)}">${esc(d.nome || d.path)}</a></li>`).join("")}</ul>` : `<div class="meta">Nenhum documento.</div>`}
          ${oper ? `<input type="file" data-saude-arq accept="application/pdf,image/*" multiple />` : ""}
        </div>
      </div>
      ${oper ? `<div class="form-acoes compacta"><button type="button" class="btn" data-saude-salvar="${esc(e.id)}">💾 Salvar saúde</button></div>` : ""}
    </div>`;
  }).join("");
  cont.querySelectorAll("[data-saude-salvar]").forEach(b => b.addEventListener("click", () => comBotaoTravado(b, () => ssoSalvarSaude(b.dataset.saudeSalvar))));
  cont.querySelectorAll("[data-saude-doc]").forEach(a => a.addEventListener("click", async ev => {
    ev.preventDefault();
    const { data: u, error } = await sb.storage.from("sst-saude").createSignedUrl(a.dataset.saudeDoc, 120);
    if(error || !u?.signedUrl){ ssoAviso("Não foi possível abrir o documento (bucket sst-saude da 109a).", "erro"); return; }
    window.open(u.signedUrl, "_blank", "noopener");
  }));
  if(!oper) cont.querySelectorAll("input, select, textarea").forEach(el => { el.disabled = true; });
}
async function ssoSalvarSaude(envId){
  const bloco = $("sso-saude-conteudo").querySelector(`[data-saude-env="${envId}"]`);
  if(!bloco) return;
  const v = campo => bloco.querySelector(`[data-s="${campo}"]`)?.value ?? "";
  const atual = (_ssoSaude || []).find(x => x.envolvido_id === envId) || {};
  let documentos = Array.isArray(atual.documentos) ? atual.documentos.slice() : [];
  const arqs = [...(bloco.querySelector("[data-saude-arq]")?.files || [])];
  for(const f of arqs){
    const ext = extensaoArquivo(f), mime = mimeDoArquivo(f, ext);
    const path = `ocorrencias/${_ssoAtual.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from("sst-saude").upload(path, corpoComMime(f, mime), { contentType: mime, upsert: false });
    if(error){ ssoAviso(ssoMsgErro(error, `Documento ${f.name} não enviado (bucket sst-saude da 109a)`), "erro"); return; }
    documentos.push({ path, nome: f.name });
  }
  const dados = {
    envolvido_id: envId, parte_corpo: v("parte_corpo") || null, tipo_lesao: v("tipo_lesao").trim() || null, afastamento: v("afastamento") === "true",
    dias_perdidos: Number(v("dias_perdidos")) || 0, dias_debitados: Number(v("dias_debitados")) || 0, cat_emitida: v("cat_emitida") === "true",
    cat_numero: v("cat_numero").trim() || null, cat_data: v("cat_data") || null, s2210_enviado_em: v("s2210_enviado_em") || null,
    observacao_medica: v("observacao_medica").trim() || null, documentos
  };
  const { error } = await sb.rpc("sst_ocorrencia_saude_gravar", { p_dados: dados });
  if(error){ ssoAviso(error.code === "42501" ? "Dado de saúde só o SESMT grava, com a sessão verificada (MFA)." : ssoMsgErro(error, "Não foi possível gravar"), "erro"); return; }
  ssoAviso("Dados de saúde gravados.", "ok");
  _ssoSaude = null; ssoCarregarSaude();
}

/* ---------- anexos (bucket sst-ocorrencias) ---------- */
async function ssoCarregarAnexos(){
  const { data, error } = await sb.storage.from("sst-ocorrencias").list(_ssoAtual.id, { limit: 200, sortBy: { column: "created_at", order: "asc" } });
  _ssoAnexos = error ? [] : (data || []).filter(a => a.name && !a.name.startsWith("."));
  const sbn = $("sb-sso-anexos"); sbn.querySelector(".sb-num").textContent = _ssoAnexos.length; sbn.classList.toggle("zero", !_ssoAnexos.length);
  const oper = ssoPodeOperar();
  $("sso-anexos-lista").innerHTML = error ? `<p class="vazio">${esc(ssoMsgErro(error, "Não foi possível listar os anexos"))}</p>`
    : !_ssoAnexos.length ? `<p class="vazio">Nenhum anexo.</p>`
    : `<ul class="meta">${_ssoAnexos.map(a => `<li><a href="#" data-anexo="${esc(a.name)}">${esc(a.name)}</a>${a.metadata?.size ? ` <span class="meta">(${num(Math.round(a.metadata.size / 1024))} KB)</span>` : ""}${oper ? ` <button type="button" class="btn-rem" data-anexo-rem="${esc(a.name)}" title="Excluir">×</button>` : ""}</li>`).join("")}</ul>`;
  $("sso-anexos-lista").querySelectorAll("[data-anexo]").forEach(a => a.addEventListener("click", async ev => {
    ev.preventDefault();
    const { data: u, error: e2 } = await sb.storage.from("sst-ocorrencias").createSignedUrl(`${_ssoAtual.id}/${a.dataset.anexo}`, 120);
    if(e2 || !u?.signedUrl){ ssoAviso("Não foi possível abrir o anexo.", "erro"); return; }
    window.open(u.signedUrl, "_blank", "noopener");
  }));
  $("sso-anexos-lista").querySelectorAll("[data-anexo-rem]").forEach(b => b.addEventListener("click", async () => {
    if(!confirm("Excluir este anexo?")) return;
    const { error: e3 } = await sb.storage.from("sst-ocorrencias").remove([`${_ssoAtual.id}/${b.dataset.anexoRem}`]);
    if(e3){ ssoAviso(ssoMsgErro(e3, "Não foi possível excluir"), "erro"); return; }
    ssoCarregarAnexos();
  }));
}
async function ssoEnviarAnexos(){
  const arqs = [...($("sso-anexo-arquivos").files || [])];
  if(!arqs.length){ ssoAviso("Escolha os arquivos.", "erro"); return; }
  let ok = 0;
  for(const f of arqs){ if(await ssoSubirAnexo(_ssoAtual.id, f)) ok++; }
  $("sso-anexo-arquivos").value = "";
  ssoAviso(`${ok} de ${arqs.length} arquivo(s) enviado(s).`, ok === arqs.length ? "ok" : "erro");
  ssoCarregarAnexos();
}

/* ---------- PDFs: comunicação preliminar, investigação (RG 4.24 renovada) e lição aprendida ---------- */
async function ssoGerarPdf(tipo){
  if(!_ssoAtual) return;
  const o = _ssoAtual;
  const TIT = { preliminar: "Comunicação preliminar de ocorrência", investigacao: "Relatório de investigação de ocorrência", licao: "Lição aprendida" };
  const RG = { preliminar: "RG 4.24 · comunicação CGL", investigacao: "RG 4.24 · investigação de acidente / incidente", licao: "Lição aprendida · SESMT" };
  const cel = "border:1px solid;padding:1.4mm 2mm;font-size:9pt;vertical-align:top;";
  const lab = "font-weight:700;width:38mm;";
  // v já vem escapado pelos chamadores (esc, txt, ssoDtBR)
  const linha = (r, v) => `<tr><td style="${cel}${lab}">${esc(r)}</td><td style="${cel}">${/* html */ v}</td></tr>`;
  const txt = v => esc(v || "—").replace(/\n/g, "<br>");
  const envolvidos = tipo === "licao" ? [] : _ssoEnvolvidos;
  const cab = `<table style="width:100%;border-collapse:collapse;margin-top:3mm;">
    ${linha("Número", esc(o.numero || "—"))}
    ${linha("Data e hora", ssoDtBR(o.data_hora))}
    ${linha("Categoria", esc(SSO_CATEGORIAS[o.categoria]?.label || "sem classificação"))}
    ${linha("Local", esc([SSO_LOCAIS[o.local_tipo], o.obra ? `${o.obra.codigo} — ${o.obra.nome}` : null, o.setor, o.local_descricao].filter(Boolean).join(" · ")))}
    ${o.equipamento ? linha("Máquina", esc(ssoEquipRotulo(o.equipamento))) : ""}
    ${tipo !== "licao" ? linha("Status", esc(STATUS.sst_ocorrencia[o.status]?.label || o.status)) : ""}
  </table>`;
  let corpo = "";
  if(tipo !== "licao"){
    corpo += `<h3 style="font-size:11pt;margin:4mm 0 1mm;">Descrição</h3><p style="font-size:9.5pt;margin:0;">${txt(o.descricao)}</p>`;
    if(o.acoes_imediatas) corpo += `<h3 style="font-size:11pt;margin:4mm 0 1mm;">Ações imediatas</h3><p style="font-size:9.5pt;margin:0;">${txt(o.acoes_imediatas)}</p>`;
    if(envolvidos.length) corpo += `<h3 style="font-size:11pt;margin:4mm 0 1mm;">Envolvidos</h3><table style="width:100%;border-collapse:collapse;">
      <tr><th style="${cel}">Pessoa</th><th style="${cel}">Vínculo</th><th style="${cel}">Papel</th><th style="${cel}">Função</th></tr>
      ${envolvidos.map(e => `<tr><td style="${cel}">${esc(e.funcionario_id ? ssoNomeFunc(e.funcionario_id) : (e.nome_externo || "—"))}</td><td style="${cel}">${esc(SSO_VINCULO[e.vinculo] || "")}</td><td style="${cel}">${esc(SSO_PAPEL[e.papel] || "")}</td><td style="${cel}">${esc(e.funcao_na_data || "—")}</td></tr>`).join("")}</table>`;
  }
  if(tipo === "investigacao"){
    if(Array.isArray(o.cronologia) && o.cronologia.length) corpo += `<h3 style="font-size:11pt;margin:4mm 0 1mm;">Cronologia</h3><table style="width:100%;border-collapse:collapse;">${o.cronologia.map(c => `<tr><td style="${cel}width:20mm;">${esc(c.hora || "")}</td><td style="${cel}">${esc(c.fato || "")}</td></tr>`).join("")}</table>`;
    corpo += `<h3 style="font-size:11pt;margin:4mm 0 1mm;">Investigação (${esc(SSO_METODO[o.metodo] || "método não informado")})</h3><table style="width:100%;border-collapse:collapse;">
      ${linha("Coordenador", esc(ssoNomeProfile(o.coordenador_id)))}${linha("Equipe", txt(o.equipe))}
      ${linha("Causa imediata", txt(o.causa_imediata))}${linha("Causas básicas", txt(o.causas_basicas))}
      ${linha("Fatores contribuintes", txt(o.fatores_contribuintes))}${linha("Fatores positivos", txt(o.fatores_positivos))}
      ${linha("Treinamento", txt(o.fatos_treinamento))}${linha("EPI", txt(o.fatos_epi))}${linha("Ferramenta / equipamento", txt(o.fatos_ferramenta))}
      ${linha("Ambiente", txt(o.fatos_ambiente))}${linha("Outras pessoas", txt(o.fatos_outras_pessoas))}
    </table>`;
    corpo += `<h3 style="font-size:11pt;margin:4mm 0 1mm;">Plano de ação</h3>` + (!_ssoAcoes.length ? `<p style="font-size:9.5pt;margin:0;">Sem ações.</p>` : `<table style="width:100%;border-collapse:collapse;">
      <tr><th style="${cel}">Causa / fator</th><th style="${cel}">Ação</th><th style="${cel}">Responsável</th><th style="${cel}">Prazo</th><th style="${cel}">Status</th><th style="${cel}">Eficácia</th></tr>
      ${_ssoAcoes.map(a => `<tr><td style="${cel}">${esc(a.causa_ou_fator || "—")}</td><td style="${cel}">${esc(a.acao)}</td><td style="${cel}">${esc(ssoNomeProfile(a.responsavel_id))}</td><td style="${cel}">${a.prazo ? dataBR(a.prazo) : "—"}</td><td style="${cel}">${esc(SSO_ACAO_STATUS[a.status]?.label || a.status)}</td><td style="${cel}">${a.eficacia_verificada_em ? `${dataBR(a.eficacia_verificada_em)} · ${a.eficacia_ok === true ? "eficaz" : a.eficacia_ok === false ? "não eficaz" : "—"}` : "—"}</td></tr>`).join("")}</table>`);
    if(o.licao_aprendida) corpo += `<h3 style="font-size:11pt;margin:4mm 0 1mm;">Lição aprendida</h3><p style="font-size:9.5pt;margin:0;">${txt(o.licao_aprendida)}</p>`;
  }
  if(tipo === "licao"){
    corpo += `<h3 style="font-size:11pt;margin:4mm 0 1mm;">O que aconteceu</h3><p style="font-size:9.5pt;margin:0;">${txt(o.descricao)}</p>
      <h3 style="font-size:11pt;margin:4mm 0 1mm;">Lição aprendida</h3><p style="font-size:10.5pt;margin:0;">${txt(o.licao_aprendida || "(lição ainda não escrita)")}</p>
      ${o.licao_publicada_em ? `<p style="font-size:8.5pt;margin:3mm 0 0;">Publicada em ${ssoDtBR(o.licao_publicada_em)}${o.licao_divulgada_dss_em ? " · divulgada no DSS em " + dataBR(o.licao_divulgada_dss_em) : ""}.</p>` : ""}`;
  }
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;">
    ${pdfCabecalhoHTML(TIT[tipo], RG[tipo] + " · CGL Fundações Ltda")}
    ${/* html */ cab}${/* html */ corpo}
    <p style="font-size:7.5pt;margin:4mm 0 0;">Gerado pelo Controle CGL em ${dataBR(hojeISO())}. ${tipo === "licao" ? "Documento de divulgação: não cita nome de envolvido." : "Dados de saúde (lesão, afastamento, CAT) não constam deste documento."}</p>
  </div>`;
  const el = document.createElement("div"); el.innerHTML = html;
  await pdfGerar(el, { filename: `${tipo}-${String(o.numero || "ocorrencia").toLowerCase()}.pdf` });
}

/* ---------- atalho do Para regularizar e do card da Sala de Comando ---------- */
function ssoAbrirPreset(filtro, id){
  _ssoPreset = { filtro: filtro || null, id: id || null };
  // o clique no menu (irParaSecao) já disparou a carga, que consome o preset ao terminar; só recarrega se nada estiver em andamento
  if(!_ssoCarregando) carregarSsoOcorrencias();
}

/* ====================================================================
   Ligações
   ==================================================================== */
function ligarSsoOcorrencias(){
  if(!$("sso-painel")) return;
  document.querySelector('nav button[data-secao="sesmt-ocorrencias"]')?.addEventListener("click", () => { mostrarPainelSso(); carregarSsoOcorrencias(); });
  document.querySelectorAll("#sso-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _ssoView = b.dataset.view; _ssoFiltroExtra = null; renderSsoOcorrencias(); }));
  $("sso-busca")?.addEventListener("input", debounce(renderSsoOcorrencias, 150));
  ["sso-f-ano", "sso-f-categoria", "sso-f-status", "sso-f-obra", "sso-f-setor"].forEach(id => $(id)?.addEventListener("change", () => { _ssoFiltroExtra = null; renderSsoOcorrencias(); }));
  $("btn-sso-registrar")?.addEventListener("click", ssoAbrirRegistro);
  $("btn-sso-reg-fechar")?.addEventListener("click", () => ssoShow("sso-registro-card", false));
  $("btn-sso-reg-limpar")?.addEventListener("click", ssoLimparRegistro);
  $("btn-sso-reg-enviar")?.addEventListener("click", () => comBotaoTravado("btn-sso-reg-enviar", ssoEnviarRegistro));
  // ficha
  $("btn-sso-voltar")?.addEventListener("click", () => { mostrarPainelSso(); renderSsoOcorrencias(); });
  $("btn-sso-salvar")?.addEventListener("click", () => comBotaoTravado("btn-sso-salvar", () => salvarSsoOcorrencia()));
  $("btn-sso-investigar")?.addEventListener("click", () => comBotaoTravado("btn-sso-investigar", async () => { if(_ssoAtual?.status === "registrada") await ssoMudarStatus("em_investigacao"); ssoAtivarTab("investigacao"); }));
  $("btn-sso-encerrar")?.addEventListener("click", () => comBotaoTravado("btn-sso-encerrar", () => ssoMudarStatus("encerrada")));
  $("btn-sso-excluir")?.addEventListener("click", excluirSsoOcorrencia);
  $("btn-sso-pdf")?.addEventListener("click", () => comBotaoTravado("btn-sso-pdf", () => ssoGerarPdf($("sso-pdf-tipo").value)));
  document.querySelectorAll("#sso-statusbar .stage").forEach(el => el.addEventListener("click", () => ssoMudarStatus(el.dataset.status)));
  document.querySelectorAll("#sso-notebook button").forEach(b => b.addEventListener("click", () => ssoAtivarTab(b.dataset.tab)));
  document.querySelectorAll("#sso-ficha .sb-btn").forEach(b => b.addEventListener("click", () => ssoAtivarTab(b.dataset.gotoTab)));
  $("btn-sso-env-add")?.addEventListener("click", () => comBotaoTravado("btn-sso-env-add", ssoAdicionarEnvolvido));
  $("btn-sso-acao-add")?.addEventListener("click", () => comBotaoTravado("btn-sso-acao-add", ssoAdicionarAcao));
  $("btn-sso-anexo-enviar")?.addEventListener("click", () => comBotaoTravado("btn-sso-anexo-enviar", ssoEnviarAnexos));
  $("sso-env-func")?.addEventListener("change", () => { const f = _ssoBase.funcionarios.find(x => x.id === $("sso-env-func").value); if(f && !$("sso-env-funcao").value) $("sso-env-funcao").value = f.funcao || ""; if(f) $("sso-env-vinculo").value = "proprio"; });
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarSsoOcorrencias); else ligarSsoOcorrencias();

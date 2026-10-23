/* ====================================================================
   Módulo: Funcionários — Fase 19
   Foto, departamento hierárquico, tipo_contrato, CNH, documentos
   com validade, contato de emergência, supervisor.
   ==================================================================== */

let _funcs           = [];
let _funcView        = "lista";
let _depts           = [];
let _supervisores    = [];
let _funcDeptFiltro  = null;   // null = todos; uuid = dept + filhos
let funcEditId       = null;
// Fase 62: bucket funcionarios-fotos é privado; foto_url guarda o path e a exibição usa URL assinada (1 h)
let _funcFotoUrls    = {};     // path → { url, t }

const FUNC_STAGES = ["ativo","afastado","ferias","demitido"];

const TIPO_CONTRATO_META = {
  clt:          { label:"CLT",          cor:"var(--marca-600)" },
  pj:           { label:"PJ",           cor:"#7B3FA8" },
  estagiario:   { label:"Estagiário",   cor:"#0D7A5F" },
  autonomo:     { label:"Autônomo",     cor:"#B05A00" },
  terceirizado: { label:"Terceirizado", cor:"var(--txt-fraco)"    },
};

const DOC_TIPO_LABEL = {
  aso:"ASO", nr35:"NR-35", nr18:"NR-18", nr10:"NR-10",
  nr33:"NR-33", cipa:"CIPA", cnh:"CNH", crea:"CREA", cau:"CAU", outro:"Outro",
  // fase 93a: PDFs de admissão gerados pelo app (js/rh_documentos.js); ficam no bloco próprio da aba Documentos
  admissao_ficha:"Ficha cadastral (RG 5.17)", admissao_contrato:"Documentos admissionais (RG 5.4)",
  admissao_contrato_ajudante:"Documentos admissionais — ajudante (RG 5.5)", admissao_prorrogacao:"Prorrogação de experiência (RG 5.6)",
  admissao_contrato_trabalho:"Contrato de trabalho (RG 5.7)"
};
/* fase 93a: campos sensíveis novos da ficha de registro — id do input → coluna de funcionarios_sensiveis */
const FUNC_SENS_CAMPOS_93A = [
  ["func-pis","pis"],["func-rg-orgao","rg_orgao_emissor"],["func-ctps","ctps"],["func-ctps-serie","ctps_serie"],
  ["func-titulo-eleitor","titulo_eleitor"],["func-zona","zona_eleitoral"],["func-secao","secao_eleitoral"],["func-reservista","reservista"],
  ["func-sexo","sexo"],["func-estado-civil","estado_civil"],["func-conjuge","conjuge"],["func-naturalidade","naturalidade"],
  ["func-nacionalidade","nacionalidade"],["func-raca-cor","raca_cor"],["func-grau-instrucao","grau_instrucao"],["func-nome-mae","nome_mae"],
  ["func-nome-pai","nome_pai"],["func-dependentes","dependentes"],["func-horario-trabalho","horario_trabalho"],["func-intervalo","intervalo"],
  ["func-forma-pagamento","forma_pagamento"],["func-estr-chegada","estrangeiro_chegada_brasil"]
];
const FUNC_SENS_BOOL_93A = [["func-estr-casado","estrangeiro_casado_brasileira"],["func-estr-naturalizado","estrangeiro_naturalizado"],["func-estr-filhos","estrangeiro_filhos_brasileiros"]];

/* ---------- utilitários ---------- */
function iniciais(nome){
  if(!nome) return "?";
  const p = nome.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0]+p[p.length-1][0]).toUpperCase() : p[0].slice(0,2).toUpperCase();
}

function tagContrato(tipo){
  if(!tipo) return "";
  const m = TIPO_CONTRATO_META[tipo] || { label:tipo, cor:"var(--txt-fraco)" };
  return `<span class="func-contrato-tag" style="background:${m.cor}20;color:${m.cor};border-color:${m.cor}50">${m.label}</span>`;
}

function deptSubtreeIds(id){
  const result = new Set([id]);
  let changed = true;
  while(changed){
    changed = false;
    for(const d of _depts){
      if(d.parent_id && result.has(d.parent_id) && !result.has(d.id)){
        result.add(d.id); changed = true;
      }
    }
  }
  return result;
}

function deptNome(id){
  if(!id) return "—";
  return _depts.find(d => d.id === id)?.nome || "—";
}

function cnhStatus(validade){
  if(!validade) return "";
  const dias = Math.floor((new Date(String(validade).slice(0,10) + "T00:00:00") - new Date()) / 864e5); // fuso local
  if(dias < 0)   return `<span class="tag vermelho" title="${dataBR(validade)}">CNH vencida</span>`;
  if(dias <= 90) return `<span class="tag ambar" title="${dataBR(validade)}">CNH vence em ${dias}d</span>`;
  return "";
}

/* foto_url antiga (URL pública completa) ou path dentro do bucket → path */
function funcFotoPath(v){
  if(!v) return null;
  const m = String(v).match(/\/funcionarios-fotos\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : String(v);
}
/* Lote S43 (L6): a URL assinada valia 1 h e a lista redesenhava com link vencido depois de 1 h na mesma tela
   (12 GET 400 no storage em 16/10). Agora assina por 12 h (bucket privado, URL só na memória da aba), guarda
   `expira_em` por path, renova quando faltar menos de 5 min e, se a imagem falhar, assina de novo uma vez. */
const FUNC_FOTO_ASSINA_S = 12 * 3600;
const FUNC_FOTO_MARGEM_MS = 5 * 60 * 1000;
function funcFotoUrl(v){
  const c = _funcFotoUrls[funcFotoPath(v)];
  return c && (c.expira_em - Date.now()) > FUNC_FOTO_MARGEM_MS ? c.url : null;
}
function funcFotosVencidas(lista){
  return (lista || []).some(f => { const p = funcFotoPath(f.foto_url); return p && !funcFotoUrl(p); });
}
/* Assina em lote (uma chamada) as fotos da lista que ainda não têm URL válida */
async function funcAssinarFotos(lista){
  const paths = [...new Set(lista.map(f => funcFotoPath(f.foto_url)).filter(p => p && !funcFotoUrl(p)))];
  if(!paths.length) return;
  const { data, error } = await sb.storage.from("funcionarios-fotos").createSignedUrls(paths, FUNC_FOTO_ASSINA_S);
  if(error){ console.warn("Fotos de funcionários sem URL assinada:", error.message); return; }
  const expira_em = Date.now() + FUNC_FOTO_ASSINA_S * 1000;
  (data || []).forEach(d => { if(d.signedUrl && d.path) _funcFotoUrls[d.path] = { url: d.signedUrl, expira_em }; });
}
/* onerror do avatar: URL vencida ou revogada → assina de novo uma vez; na segunda falha, iniciais */
async function funcFotoFalhou(img){
  const path = img.dataset.path, wrap = img.parentElement;
  const iniciaisTxt = img.dataset.ini || "";
  if(!path || img.dataset.tentou){ if(wrap) wrap.textContent = iniciaisTxt; return; }
  img.dataset.tentou = "1";
  delete _funcFotoUrls[path];
  await funcAssinarFotos([{ foto_url: path }]);
  const url = funcFotoUrl(path);
  if(url) img.src = url; else if(wrap) wrap.textContent = iniciaisTxt;
}

function avatarHtml(f, sz=40){
  const style = `width:${sz}px;height:${sz}px;font-size:${Math.round(sz*0.35)}px;flex-shrink:0;`;
  const url = funcFotoUrl(f.foto_url);
  if(url){
    return `<div class="func-kan-avatar" style="${style}"><img src="${esc(url)}" alt="" loading="lazy" data-path="${esc(funcFotoPath(f.foto_url))}" data-ini="${esc(iniciais(f.nome))}" onerror="funcFotoFalhou(this)" /></div>`;
  }
  return `<div class="func-kan-avatar" style="${style}">${esc(iniciais(f.nome))}</div>`;
}

/* ---------- selects fixos ---------- */
function funcMontarSelectsFixos(){
  const selStatus = $("func-status");
  if(selStatus) selStatus.innerHTML = opcoesStatus("funcionario");

  const selUF = $("func-uf");
  if(selUF) selUF.innerHTML = '<option value="">—</option>' +
    UFS.map(u => `<option value="${u.toLowerCase()}">${u}</option>`).join("");

  const selFStat = $("func-f-status");
  if(selFStat && !selFStat.options.length)
    selFStat.innerHTML = `<option value="">Todos os status</option>` + opcoesStatus("funcionario");

  const selFContr = $("func-f-contrato");
  if(selFContr && !selFContr.options.length)
    selFContr.innerHTML = `<option value="">Todos os contratos</option>` +
      Object.entries(TIPO_CONTRATO_META).map(([v,m]) =>
        `<option value="${v}">${m.label}</option>`).join("");
}

/* ---------- departamentos ---------- */
async function funcCarregarDepts(){
  const { data } = await sb.from("departamentos").select("id,nome,parent_id,ordem").eq("ativo",true).order("ordem");
  _depts = data || [];
  funcPopularSelectDept();
}

function funcPopularSelectDept(){
  const sel = $("func-departamento");
  if(!sel) return;
  const items = [];
  function addLevel(parentId, prefix){
    _depts.filter(d => d.parent_id === parentId).sort((a,b) => a.ordem-b.ordem)
      .forEach(d => { items.push({ id:d.id, label: prefix+d.nome }); addLevel(d.id, prefix+"  "); });
  }
  _depts.filter(d => !d.parent_id).sort((a,b) => a.ordem-b.ordem)
    .forEach(r => { items.push({ id:r.id, label: r.nome }); addLevel(r.id, "  "); });
  sel.innerHTML = `<option value="">— Sem departamento —</option>` +
    items.map(i => `<option value="${i.id}">${esc(i.label)}</option>`).join("");
}

/* ---------- supervisores ---------- */
async function funcCarregarSupervisores(){
  const { data } = await sb.from("profiles").select("id,nome").eq("ativo",true).order("nome");
  _supervisores = data || [];
  const sel = $("func-supervisor");
  if(!sel) return;
  sel.innerHTML = `<option value="">— Sem supervisor —</option>` +
    _supervisores.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join("");
}

/* ---------- sidebar de departamentos ---------- */
function funcRenderizarSidebarDept(){
  const tree = $("func-dept-tree");
  if(!tree) return;

  function countDept(id){
    const sub = deptSubtreeIds(id);
    return _funcs.filter(f => f.departamento_id && sub.has(f.departamento_id)).length;
  }

  let html = `<div class="func-dept-item${!_funcDeptFiltro?" ativo":""}" data-dept-id="">
    <span>Todos</span><span class="dept-count">${_funcs.length}</span></div>`;

  function renderNivel(parentId, nivel){
    const cls = nivel===1 ? " dept-filho" : nivel>=2 ? " dept-neto" : "";
    _depts.filter(d => d.parent_id===parentId).sort((a,b)=>a.ordem-b.ordem).forEach(d => {
      const ativo = _funcDeptFiltro===d.id ? " ativo" : "";
      html += `<div class="func-dept-item${cls}${ativo}" data-dept-id="${d.id}">
        <span>${esc(d.nome)}</span><span class="dept-count">${countDept(d.id)}</span></div>`;
      renderNivel(d.id, nivel+1);
    });
  }

  _depts.filter(d=>!d.parent_id).sort((a,b)=>a.ordem-b.ordem).forEach(r => {
    const ativo = _funcDeptFiltro===r.id ? " ativo" : "";
    html += `<div class="func-dept-item${ativo}" data-dept-id="${r.id}">
      <span>${esc(r.nome)}</span><span class="dept-count">${countDept(r.id)}</span></div>`;
    renderNivel(r.id, 1);
  });

  tree.innerHTML = html;
}

/* ---------- dados sensíveis (fase 35) ----------
   CPF, RG, nascimento, salário, endereço e contato de emergência saíram de
   funcionarios e vivem em funcionarios_sensiveis: RLS só diretor e rh, e toda
   leitura passa por fn_funcionario_sensivel() (fica em registros_log). Para os
   demais cargos os campos nem aparecem na ficha. */
function funcVeSensivel(){
  return !!(usuarioAtual && ["diretor", "rh"].includes(usuarioAtual.cargo));
}
function funcAplicarVisibilidadeSensivel(){
  const ve = funcVeSensivel();
  document.querySelectorAll(".func-sens").forEach(el => { el.style.display = ve ? "" : "none"; });
  const av = $("func-sens-aviso"); if(av) av.style.display = ve ? "none" : "";
}
async function funcCarregarSensivel(id){
  const { data, error } = await sb.rpc("fn_funcionario_sensivel", { p_funcionario_id: id });
  if(error){ console.warn("dados sensíveis:", error.message); return null; }
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}
async function funcSalvarSensivel(funcId){
  if(!funcVeSensivel()) return null;
  const v = (id) => ($(id)?.value ?? "").toString().trim() || null;
  const n = (id) => ($(id)?.value ?? "") === "" ? null : Number($(id).value);
  const reg = {
    funcionario_id: funcId,
    cpf: v("func-cpf"), rg: v("func-rg"), data_nascimento: v("func-nascimento"),
    salario_contabil: $("func-salario")?.value !== "" ? Number($("func-salario").value) : null,
    banco: v("func-banco"), agencia: v("func-agencia"), operacao: v("func-operacao"), conta: v("func-conta"), chave_pix: v("func-pix"),
    salario_particular: n("func-salario-particular"), unimed: n("func-unimed"), unimed_copart: n("func-unimed-copart"), metlife: n("func-metlife"),
    seguro_vida: n("func-seguro-vida"), vale_transporte: n("func-vt"), vr: n("func-vr"), flash: n("func-flash"), consignado: n("func-consignado"),
    gratificacao: n("func-gratificacao"), insalubridade: n("func-insalubridade"), periculosidade: n("func-periculosidade"),
    ajuda_mensal: n("func-ajuda-mensal"), contribuicao_sindical: n("func-contrib-sindical"),
    cep: v("func-cep"), logradouro: v("func-logradouro"), numero: v("func-numero"), complemento: v("func-complemento"),
    bairro: v("func-bairro"), cidade: v("func-cidade"), uf: $("func-uf")?.value || null,
    contato_emergencia_nome: v("func-emerg-nome"), contato_emergencia_tel: v("func-emerg-tel"), contato_emergencia_parentesco: v("func-emerg-parentesco"),
    horas_semanais: n("func-horas-semanais")
  };
  // fase 93a: ficha de registro (texto) e estrangeiro (sim/não/—)
  FUNC_SENS_CAMPOS_93A.forEach(([id, k]) => { reg[k] = v(id); });
  FUNC_SENS_BOOL_93A.forEach(([id, k]) => { const x = $(id)?.value ?? ""; reg[k] = x === "" ? null : x === "true"; });
  const { error } = await sb.from("funcionarios_sensiveis").upsert(reg, { onConflict: "funcionario_id" });
  return error;
}

/* ---------- carga principal ---------- */
async function carregarFuncionarios(){
  funcMontarSelectsFixos();
  // Estado de origem (logística) usa a mesma lista de UF do endereço
  if($("func-estado-origem") && $("func-uf") && !$("func-estado-origem").options.length) $("func-estado-origem").innerHTML = $("func-uf").innerHTML;
  funcAplicarVisibilidadeSensivel();
  if(typeof funcAcessoAplicarVisibilidade === "function") funcAcessoAplicarVisibilidade();   // fase 93b: aba Acesso só rh/admin/diretor
  if(typeof epiAplicarVisibilidade === "function") epiAplicarVisibilidade();                 // fase 100: visão e aba EPI
  const [{ data, error }] = await Promise.all([
    sb.from("funcionarios")
      .select("id,nome,matricula,funcao,data_admissao,status,ativo,telefone,foto_url,departamento_id,tipo_contrato,cnh_validade,categoria_operacional,especialidade,coringa,avaliacao")
      .order("nome"),
    _depts.length ? Promise.resolve() : funcCarregarDepts(),
    _supervisores.length ? Promise.resolve() : funcCarregarSupervisores(),
  ]);
  _funcs = error ? [] : (data || []);
  funcPreencherDatalistFuncoes();   // lote S48 (#115): o campo Função da ficha sugere as funções existentes
  await funcAssinarFotos(_funcs);
  renderFuncionarios();
}

/* ---------- filtros ---------- */
function funcFiltrados(){
  const termo  = ($("func-busca")?.value||"").trim().toLowerCase();
  const fStat  = $("func-f-status")?.value||"";
  const fContr = $("func-f-contrato")?.value||"";
  const deptIds = _funcDeptFiltro ? deptSubtreeIds(_funcDeptFiltro) : null;

  return _funcs.filter(f => {
    if(fStat  && f.status         !== fStat)  return false;
    if(fContr && f.tipo_contrato  !== fContr) return false;
    if(deptIds && !deptIds.has(f.departamento_id)) return false;
    if(termo){
      const alvo = `${f.nome||""} ${f.matricula||""} ${f.funcao||""} ${f.categoria_operacional||""} ${f.especialidade||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/* ---------- render ---------- */
function renderFuncionarios(){
  // lote S43 (L6): URL assinada vencida (ou a menos de 5 min do fim) é renovada antes de redesenhar a lista
  if(funcFotosVencidas(_funcs)){ funcAssinarFotos(_funcs).then(renderFuncionariosAgora, renderFuncionariosAgora); return; }
  renderFuncionariosAgora();
}
function renderFuncionariosAgora(){
  funcRenderizarSidebarDept();
  const dados = funcFiltrados();
  const cont = $("func-contador");
  if(cont) cont.textContent = `${dados.length} de ${_funcs.length}`;
  const selComp = $("func-he-competencia"); if(selComp) selComp.style.display = _funcView === "he" ? "" : "none";
  if(_funcView==="kanban") renderFuncKanban(dados);
  else if(_funcView==="logistica") renderFuncLogistica();
  else if(_funcView==="he"){ funcPreencherCompetencias(); renderFuncHE(); }
  else if(_funcView==="aprop") renderFuncAprop();
  else if(_funcView==="promocoes") renderFuncPromocoes();   // fase 93a: plano de cargos
  else if(_funcView==="epi" && typeof epiRenderRelatorio === "function") epiRenderRelatorio("func-conteudo");   // fase 100: EPI por colaborador
  else                     renderFuncLista(dados);
}

function renderFuncLista(dados){
  const cont = $("func-conteudo");
  if(!cont) return;
  if(!dados.length){ cont.innerHTML = `<p class="vazio">Nenhum funcionário encontrado.</p>`; return; }
  const linhas = dados.map(f => `<tr class="linha-clicavel" data-id="${esc(f.id)}">
    <td style="width:36px;padding:6px 4px 6px 8px;">${avatarHtml(f,32)}</td>
    <td><strong>${esc(f.nome)}</strong></td>
    <td>${esc(f.matricula||"—")}</td>
    <td>${esc(f.funcao||"—")}</td>
    <td>${esc(deptNome(f.departamento_id))}</td>
    <td>${tagContrato(f.tipo_contrato)}</td>
    <td>${dataBR(f.data_admissao)}</td>
    <td>${tagStatus("funcionario",f.status)}</td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th></th><th>Nome</th><th>Matrícula</th><th>Função</th>
      <th>Departamento</th><th>Contrato</th><th>Admissão</th><th>Situação</th>
    </tr></thead><tbody>${linhas}</tbody></table></div>`;
}

function renderFuncKanban(dados){
  const cont = $("func-conteudo");
  if(!cont) return;
  const colunas = FUNC_STAGES.map(st => {
    const itens = dados.filter(f => f.status===st);
    const stMeta = STATUS?.funcionario?.[st] || { label:st };
    const cards = itens.map(f => `
      <div class="func-kan-card linha-clicavel" data-id="${esc(f.id)}">
        ${avatarHtml(f,40)}
        <div class="func-kan-card-body">
          <div class="func-kan-card-nome">${esc(f.nome)}</div>
          <div class="func-kan-card-funcao">${esc(f.funcao||"—")}</div>
          <div class="func-kan-card-tags">
            ${tagContrato(f.tipo_contrato)}${cnhStatus(f.cnh_validade)}
          </div>
          <div class="func-kan-card-rod">
            <span>${esc(deptNome(f.departamento_id))}</span>
            <span>${f.matricula?"mat "+esc(f.matricula):""}</span>
          </div>
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards||'<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
}

/* ---------- painel / ficha ---------- */
function mostrarPainelFunc(){
  $("func-painel").style.display = "";
  $("func-ficha").style.display = "none";
  if($("func-adm")) $("func-adm").style.display = "none";   // fase 93a: admissão em etapas
  funcEditId = null;
}

function novoFuncionario(){
  funcEditId = null;
  [
    "func-nome","func-cpf","func-rg","func-nascimento","func-matricula","func-funcao",
    "func-admissao","func-demissao","func-salario","func-email","func-telefone",
    "func-cep","func-logradouro","func-numero","func-complemento","func-bairro",
    "func-cidade","func-obs","func-cnh-validade",
    "func-emerg-nome","func-emerg-tel","func-emerg-parentesco",
    "func-pix","func-gratificacao","func-insalubridade","func-periculosidade","func-ajuda-mensal","func-contrib-sindical"
  ].forEach(k => { const el=$(k); if(el) el.value=""; });
  $("func-status").value         = "ativo";
  $("func-tipo-contrato").value  = "clt";
  $("func-departamento").value   = "";
  $("func-supervisor").value     = "";
  $("func-cnh-categoria").value  = "";
  $("func-ativo").checked        = true;
  // Folha e benefícios (RH): limpa o bloco inteiro, para nada do funcionário aberto antes ir para o novo
  $("func-folha-rh")?.querySelectorAll("input").forEach(el => { el.value = ""; });
  // fase 93a: dados civis e jornada (RH) idem; aba Funções e PDFs de admissão vazios até salvar
  ["func-civil-rh", "func-jornada-rh"].forEach(id => $(id)?.querySelectorAll("input, select").forEach(el => { el.value = ""; }));
  $("func-funcoes-lista").innerHTML = ""; $("func-funcoes-prox").innerHTML = ""; $("func-ff-form").style.display = "none";
  if($("func-rh-docs")) $("func-rh-docs").innerHTML = "";
  $("btn-excluir-func").style.display = "none";
  funcCarregarFoto(null, "");
  $("func-docs-lista").innerHTML = "";
  $("func-doc-form").style.display = "none";
  $("func-sb-docs").style.display = "none";
  $("func-sb-vencendo").style.display = "none";
  abrirFichaFuncVisual({ nome:"(novo)", status:"ativo", ativo:true });
}

async function abrirFuncionario(id){
  funcEditId = id;
  const { data, error } = await sb.from("funcionarios").select("*").eq("id",id).single();
  if(error){ aviso("app-aviso","Erro ao abrir funcionário: "+error.message,"erro"); return; }

  $("func-nome").value        = data.nome||"";
  $("func-matricula").value   = data.matricula||"";
  $("func-funcao").value      = data.funcao||"";
  $("func-status").value      = data.status||"ativo";
  const sens = funcVeSensivel() ? (await funcCarregarSensivel(id)) || {} : {};
  $("func-cpf").value         = sens.cpf||"";
  $("func-rg").value          = sens.rg||"";
  $("func-nascimento").value  = (sens.data_nascimento||"").slice(0,10);
  $("func-admissao").value    = (data.data_admissao||"").slice(0,10);
  $("func-demissao").value    = (data.data_demissao||"").slice(0,10);
  $("func-salario").value     = sens.salario_contabil??""  ;
  [["func-banco","banco"],["func-agencia","agencia"],["func-operacao","operacao"],["func-conta","conta"],["func-salario-particular","salario_particular"],["func-unimed","unimed"],["func-unimed-copart","unimed_copart"],["func-metlife","metlife"],["func-seguro-vida","seguro_vida"],["func-vt","vale_transporte"],["func-vr","vr"],["func-flash","flash"],["func-consignado","consignado"],
   ["func-pix","chave_pix"],["func-gratificacao","gratificacao"],["func-insalubridade","insalubridade"],["func-periculosidade","periculosidade"],["func-ajuda-mensal","ajuda_mensal"],["func-contrib-sindical","contribuicao_sindical"]]
    .forEach(([id, k]) => { const el = $(id); if(el) el.value = sens[k] ?? ""; });
  $("func-email").value       = data.email||"";
  $("func-telefone").value    = data.telefone||"";
  $("func-cep").value         = sens.cep||"";
  $("func-logradouro").value  = sens.logradouro||"";
  $("func-numero").value      = sens.numero||"";
  $("func-complemento").value = sens.complemento||"";
  $("func-bairro").value      = sens.bairro||"";
  $("func-cidade").value      = sens.cidade||"";
  $("func-uf").value          = sens.uf||"";
  $("func-obs").value         = data.observacoes||"";
  $("func-ativo").checked     = data.ativo!==false;
  $("func-tipo-contrato").value  = data.tipo_contrato||"clt";
  $("func-departamento").value   = data.departamento_id||"";
  $("func-supervisor").value     = data.supervisor_id||"";
  $("func-cnh-categoria").value  = data.cnh_categoria||"";
  $("func-cnh-validade").value   = (data.cnh_validade||"").slice(0,10);
  $("func-emerg-nome").value     = sens.contato_emergencia_nome||"";
  $("func-emerg-tel").value      = sens.contato_emergencia_tel||"";
  $("func-emerg-parentesco").value = sens.contato_emergencia_parentesco||"";
  // fase 93a: ficha de registro, jornada e estrangeiro
  FUNC_SENS_CAMPOS_93A.forEach(([id, k]) => { const el = $(id); if(el) el.value = (sens[k] ?? "").toString().slice(0, k === "estrangeiro_chegada_brasil" ? 10 : undefined); });
  FUNC_SENS_BOOL_93A.forEach(([id, k]) => { const el = $(id); if(el) el.value = sens[k] == null ? "" : String(sens[k]); });
  if($("func-horas-semanais")) $("func-horas-semanais").value = sens.horas_semanais ?? "";
  $("func-ff-form").style.display = "none"; $("func-funcoes-lista").innerHTML = ""; $("func-funcoes-prox").innerHTML = "";
  // logística (Planejamento Logística / RG 8.1)
  if($("func-estado-origem")) $("func-estado-origem").value = data.estado_origem||"";
  if($("func-categoria"))     $("func-categoria").value     = data.categoria_operacional||"";
  if($("func-especialidade")) $("func-especialidade").value = data.especialidade||"";
  if($("func-avaliacao"))     $("func-avaliacao").value     = data.avaliacao||"";
  if($("func-coringa"))       $("func-coringa").checked     = data.coringa===true;
  if($("func-ciclo-baixada")) $("func-ciclo-baixada").value = data.ciclo_baixada_dias??90;
  if($("func-obs-logistica")) $("func-obs-logistica").value = data.observacao_logistica||"";
  funcAplicarVisibilidadeSensivel();

  funcCarregarFoto(data.foto_url, data.nome);
  $("btn-excluir-func").style.display = "";
  $("func-doc-form").style.display = "none";
  await carregarDocsFuncionario();
  abrirFichaFuncVisual(data);
}

function abrirFichaFuncVisual(f){
  $("func-painel").style.display = "none";
  if($("func-adm")) $("func-adm").style.display = "none";   // fase 93a
  $("func-ficha").style.display  = "";

  $("func-ficha-nome").textContent      = f.nome||"(novo)";
  $("func-ficha-funcao-chip").textContent    = f.funcao||"—";
  $("func-ficha-depto-chip").textContent     = deptNome(f.departamento_id);
  $("func-ficha-matricula-chip").textContent = f.matricula||"—";
  $("func-ficha-admissao-chip").textContent  = dataBR(f.data_admissao);
  $("func-ficha-contrato-chip").innerHTML    = tagContrato(f.tipo_contrato);
  $("func-ficha-status-chip").innerHTML      = tagStatus("funcionario",f.status);

  atualizarStatusbarFunc(f.status);
  ativarTabFunc("pessoais");
  if(typeof funcAcessoAplicarVisibilidade === "function") funcAcessoAplicarVisibilidade();   // fase 100: almoxarife vê a aba Acesso só no setor dele
  if(typeof epiAplicarVisibilidadeFicha === "function") epiAplicarVisibilidadeFicha();       // fase 100: aba EPI (js/epi.js)
}

/* ---------- foto ---------- */
async function funcCarregarFoto(fotoUrl, nome){
  const preview = $("func-foto-preview");
  if(!preview) return;
  const path = funcFotoPath(fotoUrl);
  let url = null;
  if(path){
    const { data } = await sb.storage.from("funcionarios-fotos").createSignedUrl(path, FUNC_FOTO_ASSINA_S);
    url = data?.signedUrl || null;
    if(url) _funcFotoUrls[path] = { url, expira_em: Date.now() + FUNC_FOTO_ASSINA_S * 1000 };
  }
  if(url) preview.innerHTML = `<img src="${esc(url)}&t=${Date.now()}" alt="" />`;
  else    preview.innerHTML = `<span>${esc(iniciais(nome))}</span>`;
}

async function uploadFotoFuncionario(file){
  if(!funcEditId){ aviso("app-aviso","Salve o funcionário antes de adicionar foto.","aviso"); return; }
  // Extensão entra no caminho do storage: só letras/dígitos (1-5), senão cai em "jpg"
  const ext  = (String(file.name.split(".").pop()||"").toLowerCase().match(/^[a-z0-9]{1,5}$/)||[])[0] || "jpg";
  const path = `${funcEditId}/foto.${ext}`;
  const { error: upErr } = await sb.storage.from("funcionarios-fotos")
    .upload(path, file, { upsert:true, contentType:file.type });
  if(upErr){ aviso("app-aviso","Erro no upload: "+upErr.message,"erro"); return; }
  // Fase 62: grava só o path; a exibição gera URL assinada
  const { error: upd } = await sb.from("funcionarios")
    .update({ foto_url: path }).eq("id", funcEditId);
  if(upd){ aviso("app-aviso","Foto salva mas não vinculada: "+upd.message,"erro"); return; }
  delete _funcFotoUrls[path];
  await funcCarregarFoto(path, $("func-nome").value);
  await carregarFuncionarios();
  aviso("app-aviso","Foto atualizada.","ok");
}

/* ---------- smart buttons ---------- */
async function carregarDocsFuncionario(){
  if(!funcEditId){ $("func-docs-lista").innerHTML=""; return; }
  const { data, error } = await sb.from("funcionario_documentos")
    .select("*").eq("funcionario_id",funcEditId).order("validade");
  if(error){ $("func-docs-lista").innerHTML=`<p class="vazio">Erro ao carregar.</p>`; return; }
  // fase 93a: os PDFs de admissão (admissao_*) têm bloco próprio (js/rh_documentos.js); a lista geral fica com os demais
  const docs = (data||[]).filter(d => !/^admissao_/.test(String(d.tipo || "")));
  if(typeof rhdCarregar === "function") rhdCarregar(funcEditId);

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const em90 = new Date(hoje); em90.setDate(em90.getDate()+90);
  const alertas = docs.filter(d => {
    if(!d.validade) return false;
    // "T00:00:00" força fuso local; "YYYY-MM-DD" puro é UTC (= 21h do dia anterior no BR)
    return new Date(String(d.validade).slice(0,10) + "T00:00:00") <= em90;
  }).length;

  const sbDocs = $("func-sb-docs");
  const sbVenc = $("func-sb-vencendo");
  if(sbDocs){
    $("func-sb-docs-num").textContent = docs.length;
    sbDocs.style.display = docs.length>0 ? "" : "none";
  }
  if(sbVenc){
    $("func-sb-vencendo-num").textContent = alertas;
    sbVenc.style.display = alertas>0 ? "" : "none";
  }

  renderDocsFuncionario(docs);
}

function renderDocsFuncionario(docs){
  const cont = $("func-docs-lista");
  if(!cont) return;
  if(!docs.length){ cont.innerHTML=`<p class="vazio">Nenhum documento cadastrado.</p>`; return; }

  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const em90 = new Date(hoje); em90.setDate(em90.getDate()+90);

  const linhas = docs.map(d => {
    let valCls="", valTxt = dataBR(d.validade)||"—";
    if(d.validade){
      const v = new Date(String(d.validade).slice(0,10) + "T00:00:00"); // fuso local
      if(v<hoje)       { valCls="func-doc-vencido";  valTxt+=" ⚠️"; }
      else if(v<=em90) { valCls="func-doc-vencendo"; valTxt+=" ⚠️"; }
      else               valCls="func-doc-ok";
    }
    return `<tr>
      <td><strong>${esc(DOC_TIPO_LABEL[d.tipo]||d.tipo)}</strong></td>
      <td>${esc(d.descricao||"—")}</td>
      <td>${esc(d.numero||"—")}</td>
      <td>${dataBR(d.emissao)||"—"}</td>
      <td class="${valCls}">${valTxt}</td>
      <td><button type="button" class="btn-sec btn-sm func-doc-del" data-id="${esc(d.id)}">Excluir</button></td>
    </tr>`;
  }).join("");

  cont.innerHTML = `<div class="tabela-rola"><table class="func-docs-table">
    <thead><tr>
      <th>Tipo</th><th>Descrição</th><th>Número</th>
      <th>Emissão</th><th>Validade</th><th></th>
    </tr></thead><tbody>${linhas}</tbody></table></div>`;
  // data-id + listener (era onclick inline com interpolação — único do app)
  cont.querySelectorAll(".func-doc-del").forEach(b => {
    b.addEventListener("click", () => excluirDocFuncionario(b.dataset.id));
  });
}

async function salvarDocFuncionario(){
  if(!funcEditId){ aviso("func-docs-aviso","Salve o funcionário primeiro.","aviso"); return; }
  const reg = {
    funcionario_id: funcEditId,
    tipo:           $("func-doc-tipo").value,
    descricao:      $("func-doc-descricao").value.trim()||null,
    numero:         $("func-doc-numero").value.trim()||null,
    emissao:        $("func-doc-emissao").value||null,
    validade:       $("func-doc-validade").value||null,
    observacoes:    $("func-doc-obs").value.trim()||null,
  };
  const { error } = await sb.from("funcionario_documentos").insert(reg);
  if(error){ aviso("func-docs-aviso","Erro: "+error.message,"erro"); return; }
  $("func-doc-form").style.display = "none";
  ["func-doc-descricao","func-doc-numero","func-doc-emissao","func-doc-validade","func-doc-obs"]
    .forEach(k => { const el=$(k); if(el) el.value=""; });
  await carregarDocsFuncionario();
  aviso("func-docs-aviso","Documento salvo.","ok");
}

async function excluirDocFuncionario(id){
  if(!confirm("Excluir este documento?")) return;
  const { error } = await sb.from("funcionario_documentos").delete().eq("id",id);
  if(error){ aviso("app-aviso","Erro ao excluir: "+error.message,"erro"); return; }
  await carregarDocsFuncionario();
}

/* ---------- statusbar / tabs ---------- */
function atualizarStatusbarFunc(st){
  const bar = $("func-statusbar");
  if(!bar) return;
  const idxAtual = FUNC_STAGES.indexOf(st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    const idx = FUNC_STAGES.indexOf(el.dataset.status);
    if(idx===idxAtual){ el.classList.add("atual"); if(st==="demitido") el.classList.add("cancelada"); }
    else if(idx<idxAtual) el.classList.add("passada");
  });
}

function ativarTabFunc(nome){
  document.querySelectorAll("#func-notebook button").forEach(b =>
    b.classList.toggle("ativo", b.dataset.tab===nome));
  document.querySelectorAll("#func-ficha .odoo-tab").forEach(t =>
    t.classList.toggle("ativa", t.dataset.tab===nome));
}

/* ---------- salvar / excluir ---------- */
/* ---------- Homônimos (regra do Bernardo, 11/09/2026) ----------
   Nome igual a outro funcionário não entra, a não ser com CPF diferente. O CPF vive
   em funcionarios_sensiveis (só diretor/rh leem), então quem não vê CPF não consegue
   provar que é outra pessoa e o cadastro é recusado com orientação. Isso também protege
   o casamento por nome do import de RDO (fn_funcionario_por_nome e o preview),
   que com homônimos vira chute. */
function funcNormalizarNome(s){
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}
/* lote S48 (#115): fun\u00e7\u00e3o padronizada ao salvar \u2014 sem acento, espa\u00e7os simples, iniciais mai\u00fasculas, conectores
   (de, da, do, das, dos, e, em) min\u00fasculos, numeral romano e sigla curta em mai\u00fasculas ("Operador de Maquinas Junior",
   "Ajudante de Equipamentos II", "PJ"). Mesma regra da carga 20261022_loteS48_b (docs/cargas/funcoes-padronizadas-2026-10.md). */
const FUNC_CONECTORES = new Set(["de", "da", "do", "das", "dos", "e", "em"]);
function funcPadronizarFuncao(s){
  const t = String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  if(!t) return "";
  return t.split(" ").map((w, i) => {
    const lw = w.toLowerCase();
    if(i > 0 && FUNC_CONECTORES.has(lw)) return lw;
    if(/^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(w)) return w.toUpperCase();
    if(w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(" ");
}
async function funcBloqueiaHomonimo(nome){
  const n = funcNormalizarNome(nome);
  if(!n) return null;
  const iguais = _funcs.filter(f => f.id !== funcEditId && funcNormalizarNome(f.nome) === n);
  if(!iguais.length) return null;
  const rotulo = iguais.map(f => `${f.nome}${f.matricula ? " (matr. " + f.matricula + ")" : ""}${f.ativo === false ? " — inativo" : ""}`).join(", ");
  if(!funcVeSensivel()){
    return `Já existe funcionário com este nome: ${rotulo}. Nome igual só é aceito com CPF diferente, e o CPF só é visível para diretor/RH — peça a eles o cadastro ou confira se não é a mesma pessoa.`;
  }
  const soDigitos = (v) => String(v || "").replace(/\D/g, "");
  const cpfNovo = soDigitos($("func-cpf")?.value);
  if(!cpfNovo) return `Já existe funcionário com este nome: ${rotulo}. Para cadastrar um homônimo, informe o CPF (tem que ser diferente do dele).`;
  for(const f of iguais){
    const sens = await funcCarregarSensivel(f.id);
    const cpfOutro = soDigitos(sens?.cpf);
    if(!cpfOutro) return `Já existe funcionário com este nome (${f.nome}) e ele está sem CPF no cadastro. Preencha o CPF dele primeiro para o sistema conseguir distinguir os dois.`;
    if(cpfOutro === cpfNovo) return `${f.nome} já está cadastrado com este mesmo CPF — é a mesma pessoa. Abra o cadastro dele em vez de criar outro.`;
  }
  return null; // homônimo legítimo: CPFs diferentes
}

async function salvarFuncionario(novoStatus){
  if(!$("func-nome").value.trim()){
    aviso("app-aviso","Informe o nome.","erro"); ativarTabFunc("pessoais"); return;
  }
  const bloqueio = await funcBloqueiaHomonimo($("func-nome").value);
  if(bloqueio){ aviso("app-aviso", bloqueio, "erro"); ativarTabFunc("pessoais"); return; }
  const reg = {
    nome:            $("func-nome").value.trim(),
    matricula:       $("func-matricula").value.trim()||null,
    funcao:          funcPadronizarFuncao($("func-funcao").value),   // lote S48 (#115)
    status:          novoStatus||$("func-status").value||"ativo",
    data_admissao:   $("func-admissao").value||null,
    data_demissao:   $("func-demissao").value||null,
    email:           $("func-email").value.trim()||null,
    telefone:        $("func-telefone").value.trim()||null,
    observacoes:     $("func-obs").value.trim()||null,
    ativo:           $("func-ativo").checked,
    tipo_contrato:   $("func-tipo-contrato").value||"clt",
    departamento_id: $("func-departamento").value||null,
    supervisor_id:   $("func-supervisor").value||null,
    cnh_categoria:   $("func-cnh-categoria").value||null,
    cnh_validade:    $("func-cnh-validade").value||null,
    estado_origem:        $("func-estado-origem")?.value||null,
    categoria_operacional:$("func-categoria")?.value||null,
    especialidade:        $("func-especialidade")?.value||null,
    avaliacao:            $("func-avaliacao")?.value||null,
    coringa:              !!$("func-coringa")?.checked,
    ciclo_baixada_dias:   $("func-ciclo-baixada")?.value!=="" ? Number($("func-ciclo-baixada").value) : 90,
    observacao_logistica: $("func-obs-logistica")?.value.trim()||null,
  };

  let result;
  if(funcEditId) result = await sb.from("funcionarios").update(reg).eq("id",funcEditId).select().single();
  else           result = await sb.from("funcionarios").insert(reg).select().single();

  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    if(m.includes("cpf"))      aviso("app-aviso","Já existe um funcionário com este CPF.","erro");
    else if(m.includes("matricula")) aviso("app-aviso","Matrícula já em uso.","erro");
    else aviso("app-aviso","Erro ao salvar: "+result.error.message,"erro");
    return;
  }
  funcEditId = result.data.id;
  // dados sensíveis (só diretor/rh; o upsert respeita o RLS)
  const errSens = await funcSalvarSensivel(funcEditId);
  if(errSens){
    const ms = (errSens.message||"").toLowerCase();
    aviso("app-aviso", ms.includes("cpf") ? "Já existe um funcionário com este CPF." : "Funcionário salvo, mas os dados sensíveis não foram gravados: " + errSens.message, "erro");
    await carregarFuncionarios(); await abrirFuncionario(funcEditId); return;
  }
  $("btn-excluir-func").style.display = "";
  $("func-status").value = result.data.status;
  aviso("app-aviso","Funcionário salvo.","ok");
  _funcLog = null; // vista Logística recarrega
  await carregarFuncionarios();
  await abrirFuncionario(funcEditId);
}

async function excluirFuncionario(){
  if(!funcEditId) return;
  if(!confirm("Excluir este funcionário? Esta ação não pode ser desfeita.")) return;
  const { error } = await sb.from("funcionarios").delete().eq("id",funcEditId);
  if(error){
    aviso("app-aviso","Não foi possível excluir. Tente alterar para 'Demitido'.","erro"); return;
  }
  aviso("app-aviso","Funcionário excluído.","ok");
  await carregarFuncionarios();
  mostrarPainelFunc();
}

/* ---------- listeners ---------- */
function ligarFuncionarios(){
  document.querySelectorAll("#func-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#func-painel .serv-view-btn").forEach(x=>x.classList.remove("ativo"));
      b.classList.add("ativo");
      _funcView = b.dataset.view;
      renderFuncionarios();
    });
  });

  $("func-he-competencia")?.addEventListener("change", renderFuncionarios);
  ["func-busca","func-f-status","func-f-contrato"].forEach(id => {
    const el=$(id);
    if(el) el.addEventListener(id==="func-busca"?"input":"change", id==="func-busca" ? debounce(renderFuncionarios) : renderFuncionarios);
  });

  $("func-conteudo")?.addEventListener("click", e => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirFuncionario(tr.dataset.id);
  });

  $("func-dept-tree")?.addEventListener("click", e => {
    const item = e.target.closest(".func-dept-item");
    if(!item) return;
    _funcDeptFiltro = item.dataset.deptId||null;
    renderFuncionarios();
  });

  $("btn-novo-funcionario")?.addEventListener("click", novoFuncionario);
  $("btn-voltar-func")?.addEventListener("click", mostrarPainelFunc);
  $("btn-salvar-func")?.addEventListener("click", () => salvarFuncionario());
  $("btn-excluir-func")?.addEventListener("click", excluirFuncionario);

  document.querySelectorAll("#func-notebook button").forEach(b => {
    b.addEventListener("click", () => {
      ativarTabFunc(b.dataset.tab);
      if(b.dataset.tab==="documentos" && funcEditId) carregarDocsFuncionario();
      if(b.dataset.tab==="funcoes" && funcEditId) funcCarregarFuncoes(funcEditId);   // fase 93a
    });
  });

  // fase 93a: aba Funções (histórico + plano de cargos) e admissão em etapas
  $("btn-func-ff-novo")?.addEventListener("click", () => {
    if(!funcEditId){ aviso("func-funcoes-aviso", "Salve o funcionário primeiro.", "aviso"); return; }
    $("func-ff-funcao").value = ""; $("func-ff-data").value = hojeISO(); $("func-ff-motivo").value = "promocao_plano"; $("func-ff-obs").value = "";
    $("func-ff-form").style.display = ""; $("func-ff-funcao").focus();
  });
  $("btn-func-ff-salvar")?.addEventListener("click", () => comBotaoTravado("btn-func-ff-salvar", funcSalvarFuncao));
  $("btn-func-ff-cancelar")?.addEventListener("click", () => { $("func-ff-form").style.display = "none"; });
  $("btn-admitir-func")?.addEventListener("click", funcAdmAbrir);
  $("btn-adm-voltar")?.addEventListener("click", () => { if(confirm("Sair da admissão? O que foi digitado se perde.")) mostrarPainelFunc(); });
  $("btn-adm-anterior")?.addEventListener("click", () => funcAdmIr(_admEtapa - 1));
  $("btn-adm-proximo")?.addEventListener("click", () => funcAdmIr(_admEtapa + 1));
  $("btn-adm-concluir")?.addEventListener("click", () => comBotaoTravado("btn-adm-concluir", funcAdmConcluir));
  document.querySelectorAll("#adm-etapas .stage").forEach(el => el.addEventListener("click", () => funcAdmIr(Number(el.dataset.etapa))));
  ["adm-data", "adm-prazo", "adm-prorrogacao"].forEach(id => $(id)?.addEventListener("change", () => funcAdmCalcVencimentos(true)));
  $("adm-salario")?.addEventListener("input", () => { if($("adm-salario-extenso")) $("adm-salario-extenso").value = $("adm-salario").value !== "" && typeof rhExtenso === "function" ? rhExtenso($("adm-salario").value) : ""; });
  $("adm-funcao")?.addEventListener("change", funcAdmSugerirModelo);

  document.querySelectorAll("#func-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!funcEditId){ $("func-status").value=novo; atualizarStatusbarFunc(novo); return; }
      if(novo===$("func-status").value) return;
      await salvarFuncionario(novo);
    });
  });

  $("func-foto-wrap")?.addEventListener("click", () => $("func-foto-input").click());
  $("func-foto-input")?.addEventListener("change", e => {
    const file = e.target.files[0];
    if(!file) return;
    uploadFotoFuncionario(file);
    e.target.value = "";
  });

  $("btn-add-doc-func")?.addEventListener("click", () => {
    $("func-doc-form").style.display = "";
    $("func-doc-descricao")?.focus();
  });
  $("btn-salvar-doc-func")?.addEventListener("click", () => comBotaoTravado("btn-salvar-doc-func", salvarDocFuncionario));
  $("btn-cancelar-doc-func")?.addEventListener("click", () => {
    $("func-doc-form").style.display = "none";
  });

  $("func-sb-docs")?.addEventListener("click", () => ativarTabFunc("documentos"));
  $("func-sb-vencendo")?.addEventListener("click", () => ativarTabFunc("documentos"));

  const navFunc = document.querySelector('nav button[data-secao="funcionarios"]');
  if(navFunc) navFunc.addEventListener("click", mostrarPainelFunc);
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded", ligarFuncionarios);
} else {
  ligarFuncionarios();
}

/* ====================================================================
   Vista LOGÍSTICA (fase 35 · SPEC tela 1): onde cada um está, TAG, próxima baixada
   com semáforo — fonte vw_funcionarios_logistica (próxima = último retorno + ciclo,
   ou data acordada). Vista HORAS EXTRAS (tela 3): horas por colaborador × obra na
   competência, a partir de rdo_equipe. É o "HORAS EXTRAS – mês" da RG 8.1.3.
   ==================================================================== */
let _funcLog = null;
let _funcHE  = { comp: null, dados: null };
const FUNC_AVAL_LBL = { novato: "Novato", bom: "Bom", muito_bom: "Muito bom", excelente: "Excelente", atencao: "Atenção" };

async function renderFuncLogistica(){
  const cont = $("func-conteudo");
  if(!cont) return;
  if(!_funcLog){
    cont.innerHTML = `<p class="vazio">Carregando logística…</p>`;
    const { data, error } = await sb.from("vw_funcionarios_logistica").select("*").order("nome");
    if(error){ cont.innerHTML = `<p class="vazio">Erro ao carregar: ${esc(error.message)}</p>`; return; }
    _funcLog = data || [];
  }
  const termo = ($("func-busca")?.value || "").trim().toLowerCase();
  const fStatus = $("func-f-status")?.value || "", fContr = $("func-f-contrato")?.value || "";
  const lista = _funcLog
    .filter(f => (!fStatus || f.status === fStatus) && (!fContr || f.tipo_contrato === fContr))
    .filter(f => !termo || `${f.nome} ${f.funcao || ""} ${f.tag_atual || ""} ${f.obra_atual || ""} ${f.categoria_operacional || ""} ${f.especialidade || ""}`.toLowerCase().includes(termo))
    .sort((a, b) => (a.dias_para_baixada ?? 9999) - (b.dias_para_baixada ?? 9999) || a.nome.localeCompare(b.nome, "pt-BR"));
  const sem = (d) => d == null ? `<span class="tag cinza">sem baixada</span>`
    : d < 0 ? `<span class="tag vermelho">vencida há ${-d} d</span>` : d <= 30 ? `<span class="tag ambar">em ${d} d</span>` : `<span class="tag verde">em ${d} d</span>`;
  const venc = lista.filter(f => f.dias_para_baixada != null && f.dias_para_baixada < 0).length;
  const prox = lista.filter(f => f.dias_para_baixada != null && f.dias_para_baixada >= 0 && f.dias_para_baixada <= 30).length;
  cont.innerHTML = `<div class="meta" style="margin:0 0 8px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
      <span><strong>${lista.length}</strong> pessoas</span>
      <span class="tag vermelho">${venc} baixada vencida</span><span class="tag ambar">${prox} em até 30 dias</span>
      <span>próxima baixada = último retorno + ciclo (padrão 90 d) ou data acordada · clique na linha para abrir a ficha</span>
    </div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Nome</th><th>Função</th><th>Categoria</th><th>Frente</th><th>UF</th><th>TAG</th><th>Obra atual</th><th>Aval.</th><th>Últ. retorno</th><th>Próx. baixada</th><th>Situação</th><th>Obs. logística</th></tr></thead>
      <tbody>${lista.map(f => `<tr class="func-log-row" data-id="${esc(f.id)}">
        <td><strong>${esc(f.nome)}</strong>${f.coringa ? ' <span class="tag azul">coringa</span>' : ""}</td>
        <td>${esc(f.funcao || "—")}</td><td>${esc(f.categoria_operacional || "—")}</td><td>${esc(f.especialidade || "—")}</td>
        <td>${esc((f.estado_origem || "").toUpperCase() || "—")}</td><td>${esc(f.tag_atual || "—")}</td>
        <td>${esc(f.obra_atual ? f.obra_atual + (f.cidade_atual ? " · " + f.cidade_atual : "") : "—")}</td>
        <td>${esc(FUNC_AVAL_LBL[f.avaliacao] || "—")}</td>
        <td>${f.ultimo_retorno_baixada ? dataBR(f.ultimo_retorno_baixada) : "—"}</td>
        <td>${f.proxima_baixada ? dataBR(f.proxima_baixada) + " " : ""}${sem(f.dias_para_baixada)}${f.baixada_acordada ? ' <span class="tag azul">acordada</span>' : ""}</td>
        <td>${esc(f.status || "")}</td><td class="meta">${esc(f.observacao_logistica || "")}</td>
      </tr>`).join("") || `<tr><td colspan="12" class="vazio">Ninguém para os filtros.</td></tr>`}</tbody>
    </table></div>`;
  cont.querySelectorAll(".func-log-row").forEach(tr => tr.addEventListener("click", () => abrirFuncionario(tr.dataset.id)));
}

function funcPreencherCompetencias(){
  const sel = $("func-he-competencia");
  if(!sel || sel.options.length) return;
  const hoje = new Date(); const opts = [];
  for(let i = 0; i < 12; i++){
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    opts.push(`<option value="${v}">${d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</option>`);
  }
  sel.innerHTML = opts.join("");
}

async function renderFuncHE(){
  const cont = $("func-conteudo");
  if(!cont) return;
  const comp = $("func-he-competencia")?.value || hojeISO().slice(0, 7);
  if(!_funcHE.dados || _funcHE.comp !== comp){
    cont.innerHTML = `<p class="vazio">Apurando ${comp}…</p>`;
    const ini = comp + "-01";
    const fim = dataLocalISO(new Date(Number(comp.slice(0, 4)), Number(comp.slice(5, 7)), 0));
    const { data, error } = await sb.from("rdo_equipe")
      .select("funcionario_id,nome_avulso,funcao_no_dia,hora_entrada,hora_saida,horas_normais,horas_50,horas_100,horas_noturnas,rdo:rdo_id!inner(data,obra_id)")
      .gte("rdo.data", ini).lte("rdo.data", fim).limit(5000);
    if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
    _funcHE = { comp, dados: data || [] };
  }
  const nomeDe = (r) => r.funcionario_id ? ((_funcs.find(f => f.id === r.funcionario_id) || {}).nome || "?") : (r.nome_avulso || "—");
  const presenca = (r) => { if(!r.hora_entrada || !r.hora_saida) return 0; const [h1, m1] = r.hora_entrada.split(":").map(Number), [h2, m2] = r.hora_saida.split(":").map(Number); let d = (h2 * 60 + m2) - (h1 * 60 + m1); if(d < 0) d += 1440; return d / 60; };
  const g = new Map();
  _funcHE.dados.forEach(r => {
    const k = nomeDe(r) + "|" + (r.rdo?.obra_id || "");
    if(!g.has(k)) g.set(k, { nome: nomeDe(r), obra: mapaObras[r.rdo?.obra_id] || "—", obra_id: r.rdo?.obra_id || null, dias: new Set(), pres: 0, hn: 0, h50: 0, h100: 0, hnot: 0 });
    const a = g.get(k); a.dias.add(r.rdo?.data); a.pres += presenca(r);
    a.hn += Number(r.horas_normais) || 0; a.h50 += Number(r.horas_50) || 0; a.h100 += Number(r.horas_100) || 0; a.hnot += Number(r.horas_noturnas) || 0;
  });
  const termo = ($("func-busca")?.value || "").trim().toLowerCase();
  const linhas = [...g.values()].filter(a => !termo || `${a.nome} ${a.obra}`.toLowerCase().includes(termo))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.obra.localeCompare(b.obra, "pt-BR"));
  const f1 = (v) => Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const tot = linhas.reduce((s, a) => ({ dias: s.dias + a.dias.size, pres: s.pres + a.pres, hn: s.hn + a.hn, h50: s.h50 + a.h50, h100: s.h100 + a.h100, hnot: s.hnot + a.hnot }), { dias: 0, pres: 0, hn: 0, h50: 0, h100: 0, hnot: 0 });
  const semHoras = (tot.pres + tot.hn + tot.h50 + tot.h100 + tot.hnot) === 0 && linhas.length > 0;
  cont.innerHTML = `<div class="meta" style="margin:0 0 8px;">Competência <strong>${esc(comp)}</strong> · ${linhas.length} colaborador×obra · ${_funcHE.dados.length} presenças em RDO
      ${semHoras ? `<br><span class="txt-perigo">⚠️ Nenhum RDO desta competência tem entrada/saída ou horas preenchidas — a equipe do RDO precisa registrar os horários para este relatório substituir a planilha.</span>` : ""}
      <button type="button" class="btn-sec btn-sm" id="btn-func-he-csv" style="margin-left:8px;">⬇️ CSV</button></div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Colaborador</th><th>Obra</th><th class="num">Dias</th><th class="num">Horas (entrada→saída)</th><th class="num">Normais</th><th class="num">HE 50%</th><th class="num">HE 100%</th><th class="num">Noturnas</th></tr></thead>
      <tbody>${linhas.map(a => `<tr><td>${esc(a.nome)}</td><td>${linkObra(a.obra_id, a.obra)}</td><td class="num">${a.dias.size}</td><td class="num">${f1(a.pres)}</td><td class="num">${f1(a.hn)}</td><td class="num">${f1(a.h50)}</td><td class="num">${f1(a.h100)}</td><td class="num">${f1(a.hnot)}</td></tr>`).join("") || `<tr><td colspan="8" class="vazio">Sem presenças em RDO nesta competência.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2"><strong>Total</strong></td><td class="num"><strong>${tot.dias}</strong></td><td class="num"><strong>${f1(tot.pres)}</strong></td><td class="num"><strong>${f1(tot.hn)}</strong></td><td class="num"><strong>${f1(tot.h50)}</strong></td><td class="num"><strong>${f1(tot.h100)}</strong></td><td class="num"><strong>${f1(tot.hnot)}</strong></td></tr></tfoot>
    </table></div>`;
  $("btn-func-he-csv")?.addEventListener("click", () => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Colaborador;Obra;Dias;Horas_presenca;Normais;HE50;HE100;Noturnas"]
      .concat(linhas.map(a => [a.nome, a.obra, a.dias.size, a.pres.toFixed(2), a.hn, a.h50, a.h100, a.hnot].map(cel).join(";"))).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = `horas-extras-${comp}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  });
}

/* ====================================================================
   Fase 93a (chamados #69 e #70): aba FUN\u00c7\u00d5ES da ficha (hist\u00f3rico de fun\u00e7\u00e3o +
   pr\u00f3xima mudan\u00e7a pelo plano de cargos), vista FUN\u00c7\u00d5ES do painel
   (vw_rh_promocoes com sem\u00e1foro) e ADMISS\u00c3O EM ETAPAS (dados pessoais \u2192
   documentos \u2192 contrato \u2192 benef\u00edcios), que grava funcionarios +
   funcionarios_sensiveis + admissoes e gera os PDFs (js/rh_documentos.js).
   ==================================================================== */
const FUNC_FF_MOTIVO = { admissao: "Admiss\u00e3o", promocao_plano: "Promo\u00e7\u00e3o pelo plano", mudanca: "Mudan\u00e7a de fun\u00e7\u00e3o", correcao: "Corre\u00e7\u00e3o" };
let _funcPlano = null;                               // plano_cargos (cache da sess\u00e3o)
let _funcPromo = { dados: null, filtro: "todas" };   // vista Fun\u00e7\u00f5es: todas | 60dias | vencidas | no_prazo
let _admEtapa  = 1;

async function funcCarregarPlano(){
  if(_funcPlano) return _funcPlano;
  const { data, error } = await sb.from("plano_cargos").select("*").eq("ativo", true).order("grupo").order("meses");
  _funcPlano = error ? [] : (data || []);
  funcPreencherDatalistFuncoes();
  return _funcPlano;
}
/* sugest\u00f5es de fun\u00e7\u00e3o: as do plano de cargos + as j\u00e1 usadas no cadastro */
function funcPreencherDatalistFuncoes(){
  const dl = $("func-funcoes-datalist"); if(!dl) return;
  // lote S48 (#115): só a grafia padronizada entra na lista, para não nascer variante nova
  const nomes = new Set();
  const add = (n) => { const p = funcPadronizarFuncao(n); if(p) nomes.add(p); };
  (_funcPlano || []).forEach(p => { add(p.funcao_origem); add(p.funcao_destino); });
  _funcs.forEach(f => add(f.funcao));
  dl.innerHTML = [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR")).map(n => `<option value="${esc(n)}"></option>`).join("");
}
function funcPromoTag(p){
  if(!p) return "";
  if(p.semaforo === "vencida") return `<span class="tag vermelho">vencida h\u00e1 ${-p.dias_restantes} d</span>`;
  if(p.semaforo === "proxima") return `<span class="tag ambar">em ${p.dias_restantes} d</span>`;
  return `<span class="tag verde">em ${p.dias_restantes} d</span>`;
}

/* ---------- aba Fun\u00e7\u00f5es ---------- */
async function funcCarregarFuncoes(id){
  const cont = $("func-funcoes-lista"); if(!cont) return;
  cont.innerHTML = `<p class="vazio">Carregando\u2026</p>`;
  const vePlano = funcVeSensivel() || (usuarioAtual && ["admin", "auditor"].includes(usuarioAtual.cargo));
  const [hist, prom] = await Promise.all([
    sb.from("funcionario_funcoes").select("*").eq("funcionario_id", id).order("data_inicio", { ascending: false }),
    vePlano ? sb.from("vw_rh_promocoes").select("*").eq("funcionario_id", id).maybeSingle() : Promise.resolve({ data: null }),
    funcCarregarPlano()
  ]);
  if(funcEditId !== id) return;
  if(hist.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(hist.error.message)}</p>`; return; }
  const linhas = hist.data || [];
  $("func-funcoes-cont").textContent = linhas.length ? `${linhas.length}` : "";
  const p = prom?.data || null;
  $("func-funcoes-prox").innerHTML = p
    ? `Pr\u00f3xima mudan\u00e7a pelo plano de cargos: <strong>${esc(p.proxima_funcao)}</strong> prevista para <strong>${dataBR(p.data_prevista)}</strong> ${funcPromoTag(p)}
       <span class="meta">(${esc(p.funcao)} desde ${dataBR(p.funcao_desde)} \u00b7 regra de ${p.meses} meses${p.criterio ? " \u00b7 " + esc(p.criterio) : ""})</span>`
    : (vePlano ? `<span class="meta">Fun\u00e7\u00e3o atual fora do plano de cargos: sem mudan\u00e7a prevista.</span>` : "");
  const podeApagar = funcVeSensivel() && !ehSomenteLeitura();
  cont.innerHTML = linhas.length
    ? `<div class="tabela-rola"><table class="func-docs-table">
        <thead><tr><th>Fun\u00e7\u00e3o</th><th>In\u00edcio</th><th>Fim</th><th>Motivo</th><th>Observa\u00e7\u00f5es</th><th></th></tr></thead>
        <tbody>${linhas.map(l => `<tr>
          <td><strong>${esc(l.funcao)}</strong>${!l.data_fim ? ' <span class="tag verde">atual</span>' : ""}</td>
          <td>${dataBR(l.data_inicio)}</td><td>${l.data_fim ? dataBR(l.data_fim) : "\u2014"}</td>
          <td>${esc(FUNC_FF_MOTIVO[l.motivo] || l.motivo)}</td><td class="meta">${esc(l.observacoes || "")}</td>
          <td>${podeApagar ? `<button type="button" class="btn-sec btn-sm func-ff-del" data-id="${esc(l.id)}" title="Apagar este registro (a fun\u00e7\u00e3o da ficha passa a ser a linha anterior)">Excluir</button>` : ""}</td>
        </tr>`).join("")}</tbody></table></div>`
    : `<p class="vazio">Sem hist\u00f3rico de fun\u00e7\u00e3o.</p>`;
  cont.querySelectorAll(".func-ff-del").forEach(b => b.addEventListener("click", () => funcExcluirFuncao(b.dataset.id)));
}
async function funcSalvarFuncao(){
  if(!funcEditId) return;
  const funcao = funcPadronizarFuncao($("func-ff-funcao").value), data = $("func-ff-data").value;   // lote S48 (#115)
  if(!funcao || !data){ aviso("func-funcoes-aviso", "Informe a fun\u00e7\u00e3o e a data.", "erro"); return; }
  const reg = { funcionario_id: funcEditId, funcao, data_inicio: data, motivo: $("func-ff-motivo").value, observacoes: $("func-ff-obs").value.trim() || null };
  const { error } = await sb.from("funcionario_funcoes").insert(reg);
  if(error){
    aviso("func-funcoes-aviso", /unique|duplic/i.test(error.message) ? "J\u00e1 existe um registro de fun\u00e7\u00e3o nesta data para este funcion\u00e1rio." : "Erro: " + error.message, "erro");
    return;
  }
  $("func-ff-form").style.display = "none";
  aviso("func-funcoes-aviso", "Mudan\u00e7a de fun\u00e7\u00e3o registrada.", "ok");
  await funcAtualizarFuncaoEspelho();
}
async function funcExcluirFuncao(id){
  if(!confirm("Apagar este registro do hist\u00f3rico de fun\u00e7\u00e3o?")) return;
  const { error } = await sb.from("funcionario_funcoes").delete().eq("id", id);
  if(error){ aviso("func-funcoes-aviso", "Erro ao apagar: " + error.message, "erro"); return; }
  await funcAtualizarFuncaoEspelho();
}
/* a fun\u00e7\u00e3o da ficha \u00e9 espelho da \u00faltima linha do hist\u00f3rico (gatilho): rel\u00ea o cadastro e os chips */
async function funcAtualizarFuncaoEspelho(){
  await funcCarregarFuncoes(funcEditId);
  const { data: f } = await sb.from("funcionarios").select("funcao").eq("id", funcEditId).single();
  if(f){
    $("func-funcao").value = f.funcao || "";
    $("func-ficha-funcao-chip").textContent = f.funcao || "\u2014";
    const x = _funcs.find(y => y.id === funcEditId); if(x) x.funcao = f.funcao;
  }
  _funcPromo.dados = null;
}

/* ---------- vista Fun\u00e7\u00f5es do painel (plano de cargos) ---------- */
const FUNC_PROMO_FILTROS = { todas: "todas", vencidas: "vencidas", "60dias": "em 60 dias", no_prazo: "no prazo" };
async function renderFuncPromocoes(){
  const cont = $("func-conteudo"); if(!cont) return;
  if(!_funcPromo.dados){
    cont.innerHTML = `<p class="vazio">Carregando plano de cargos\u2026</p>`;
    const { data, error } = await sb.from("vw_rh_promocoes").select("*").order("data_prevista");
    if(error){ cont.innerHTML = `<p class="vazio">Erro ao carregar: ${esc(error.message)}</p>`; return; }
    _funcPromo.dados = data || [];
    if(_funcView !== "promocoes") return;
  }
  const termo = ($("func-busca")?.value || "").trim().toLowerCase();
  const f = _funcPromo.filtro;
  const todos = _funcPromo.dados;
  const lista = todos
    .filter(p => f === "todas" || (f === "vencidas" && p.semaforo === "vencida") || (f === "60dias" && p.semaforo === "proxima") || (f === "no_prazo" && p.semaforo === "no_prazo"))
    .filter(p => !termo || `${p.nome} ${p.matricula || ""} ${p.funcao} ${p.proxima_funcao}`.toLowerCase().includes(termo));
  const n = (s) => todos.filter(p => p.semaforo === s).length;
  const btn = (k, cls, txt) => `<button type="button" class="tag ${cls} func-promo-f" data-f="${k}" style="cursor:pointer;border:${f === k ? "2px solid var(--txt)" : "2px solid transparent"};">${txt}</button>`;
  cont.innerHTML = `<div class="meta" style="margin:0 0 8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <span><strong>${todos.length}</strong> no plano de cargos</span>
      ${btn("vencidas", "vermelho", n("vencida") + " vencidas")} ${btn("60dias", "ambar", n("proxima") + " em 60 dias")} ${btn("no_prazo", "verde", n("no_prazo") + " no prazo")} ${btn("todas", "cinza", "todas")}
      <span>data prevista = in\u00edcio da fun\u00e7\u00e3o atual + meses da regra \u00b7 clique na linha para abrir a aba Fun\u00e7\u00f5es</span>
      <button type="button" class="btn-sec btn-sm" id="btn-func-promo-csv">\u2b07\ufe0f CSV</button>
    </div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Nome</th><th>Matr\u00edcula</th><th>Fun\u00e7\u00e3o atual</th><th>Desde</th><th>Pr\u00f3xima fun\u00e7\u00e3o</th><th>Prevista</th><th>Situa\u00e7\u00e3o</th><th>Regra</th></tr></thead>
      <tbody>${lista.map(p => `<tr class="linha-clicavel func-promo-row" data-id="${esc(p.funcionario_id)}">
        <td><strong>${esc(p.nome)}</strong></td><td>${esc(p.matricula || "\u2014")}</td><td>${esc(p.funcao)}</td><td>${dataBR(p.funcao_desde)}</td>
        <td>${esc(p.proxima_funcao)}</td><td>${dataBR(p.data_prevista)}</td><td>${funcPromoTag(p)}</td><td class="meta">${p.meses} meses \u00b7 ${esc(p.grupo)}</td>
      </tr>`).join("") || `<tr><td colspan="8" class="vazio">Ningu\u00e9m para o filtro.</td></tr>`}</tbody>
    </table></div>
    <p class="meta">A data de in\u00edcio da fun\u00e7\u00e3o veio da data de admiss\u00e3o na carga inicial: quem j\u00e1 mudou de fun\u00e7\u00e3o precisa da data real registrada na aba Fun\u00e7\u00f5es (motivo "Corre\u00e7\u00e3o").</p>`;
  cont.querySelectorAll(".func-promo-f").forEach(b => b.addEventListener("click", () => { _funcPromo.filtro = b.dataset.f; renderFuncPromocoes(); }));
  cont.querySelectorAll(".func-promo-row").forEach(tr => tr.addEventListener("click", async () => { await abrirFuncionario(tr.dataset.id); ativarTabFunc("funcoes"); funcCarregarFuncoes(tr.dataset.id); }));
  $("btn-func-promo-csv")?.addEventListener("click", () => {
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["Nome;Matricula;Funcao_atual;Desde;Proxima_funcao;Prevista;Dias_restantes;Situacao"]
      .concat(lista.map(p => [p.nome, p.matricula, p.funcao, p.funcao_desde, p.proxima_funcao, p.data_prevista, p.dias_restantes, p.semaforo].map(cel).join(";"))).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a"); el.href = URL.createObjectURL(blob); el.download = `plano-de-cargos-${hojeISO()}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  });
}
/* Sala de Comando \u2192 vista Fun\u00e7\u00f5es j\u00e1 filtrada (vencidas | 60dias) */
function funcAbrirPromocoes(preset){
  _funcView = "promocoes"; _funcPromo.filtro = preset || "todas"; _funcPromo.dados = null;
  document.querySelectorAll("#func-painel .serv-view-btn").forEach(x => x.classList.toggle("ativo", x.dataset.view === "promocoes"));
  mostrarPainelFunc();
  renderFuncionarios();
}

/* ---------- admiss\u00e3o em etapas ---------- */
const ADM_PADROES = { "adm-nacionalidade": "Brasileira", "adm-banco": "Ita\u00fa", "adm-prazo": "45", "adm-prorrogacao": "45",
  "adm-horario": "de 7:00 \u00e0s 17:00 (seg a quin) 7:00 \u00e0s 16:00 (sex)", "adm-intervalo": "(uma) hora", "adm-horas-semanais": "44",
  "adm-forma-pagamento": "Mensalista", "adm-tipo-contrato": "clt", "adm-tipo-documento": "padrao" };
function funcAdmAbrir(){
  if(!funcVeSensivel()){ aviso("app-aviso", "Admiss\u00e3o: s\u00f3 RH e diretoria.", "erro"); return; }
  document.querySelectorAll("#func-adm input, #func-adm select").forEach(el => { if(el.type === "checkbox") el.checked = true; else el.value = ""; });
  if($("adm-uf") && $("func-uf")) $("adm-uf").innerHTML = $("func-uf").innerHTML;
  if($("adm-departamento") && $("func-departamento")) $("adm-departamento").innerHTML = $("func-departamento").innerHTML;
  Object.entries(ADM_PADROES).forEach(([id, v]) => { if($(id)) $(id).value = v; });
  $("adm-data").value = hojeISO();
  funcCarregarPlano();
  funcAdmCalcVencimentos(true);
  $("func-painel").style.display = "none"; $("func-ficha").style.display = "none"; $("func-adm").style.display = "";
  funcEditId = null;
  funcAdmMostrar(1);
}
function funcAdmIr(n){
  if(n < 1 || n > 4) return;
  if(n > _admEtapa){
    for(let e = _admEtapa; e < n; e++){
      const erro = funcAdmValidar(e);
      if(erro){ funcAdmMostrar(e); aviso("adm-aviso", erro, "erro"); return; }
    }
  }
  funcAdmMostrar(n);
}
function funcAdmMostrar(n){
  _admEtapa = n;
  document.querySelectorAll("#adm-etapas .stage").forEach(el => { const e = Number(el.dataset.etapa); el.classList.toggle("atual", e === n); el.classList.toggle("passada", e < n); });
  document.querySelectorAll("#func-adm .odoo-tab").forEach(t => t.classList.toggle("ativa", Number(t.dataset.etapa) === n));
  $("btn-adm-anterior").style.display = n > 1 ? "" : "none";
  $("btn-adm-proximo").style.display  = n < 4 ? "" : "none";
  $("btn-adm-concluir").style.display = n === 4 ? "" : "none";
  $("adm-aviso").className = "aviso"; $("adm-aviso").textContent = "";
  if(n === 4) funcAdmResumo();
}
function funcAdmValidar(e){
  const v = (id) => ($(id)?.value || "").trim();
  if(e === 1){
    if(!v("adm-nome")) return "Informe o nome completo.";
    if(v("adm-cpf").replace(/\D/g, "").length !== 11) return "O CPF precisa ter 11 d\u00edgitos.";
  }
  if(e === 3){
    if(!v("adm-funcao")) return "Informe a fun\u00e7\u00e3o.";
    if(!v("adm-data")) return "Informe a data de admiss\u00e3o.";
    if(v("adm-salario") === "") return "Informe o sal\u00e1rio.";
  }
  return null;
}
/* decis\u00e3o 2: experi\u00eancia 45 + 45; 1\u00ba vencimento = admiss\u00e3o + prazo \u2212 1 (o dia da admiss\u00e3o conta); 2\u00ba = 1\u00ba + prorroga\u00e7\u00e3o */
function funcAdmCalcVencimentos(forcar){
  const d = $("adm-data")?.value; if(!d) return;
  const prazo = Number($("adm-prazo").value || 0), pror = Number($("adm-prorrogacao").value || 0);
  const soma = (iso, dias) => dataLocalISO(new Date(new Date(iso + "T00:00:00").getTime() + dias * 864e5));
  if(forcar || !$("adm-venc1").value) $("adm-venc1").value = prazo > 0 ? soma(d, prazo - 1) : "";
  if(forcar || !$("adm-venc2").value) $("adm-venc2").value = (prazo > 0 && pror > 0 && $("adm-venc1").value) ? soma($("adm-venc1").value, pror) : "";
}
function funcAdmSugerirModelo(){
  const f = funcNormalizarNome($("adm-funcao").value);
  if(/AJUDANTE|SOLDADOR/.test(f)) $("adm-tipo-documento").value = "ajudante_soldador";
}
function funcAdmResumo(){
  const v = (id) => esc(($(id)?.value || "").trim() || "\u2014");
  const sal = $("adm-salario").value;
  const item = (r, val) => `<div><span class="meta">${r}</span><br><strong>${val}</strong></div>`;
  $("adm-resumo").innerHTML = `<strong>Resumo da admiss\u00e3o</strong>
    <div class="grade" style="margin-top:8px;">
      ${item("Nome", v("adm-nome"))}${item("Fun\u00e7\u00e3o", v("adm-funcao"))}${item("Admiss\u00e3o", dataBR($("adm-data").value) || "\u2014")}
      ${item("Sal\u00e1rio", sal !== "" ? brl(Number(sal)) : "\u2014")}${item("Experi\u00eancia", `${v("adm-prazo")} + ${v("adm-prorrogacao")} dias`)}
      ${item("1\u00ba / 2\u00ba vencimento", `${dataBR($("adm-venc1").value) || "\u2014"} / ${dataBR($("adm-venc2").value) || "\u2014"}`)}
      ${item("Modelo de contrato", esc($("adm-tipo-documento").selectedOptions[0]?.textContent || ""))}
      ${item("Departamento", esc($("adm-departamento").selectedOptions[0]?.textContent || "\u2014"))}
      ${item("Vale-transporte", esc($("adm-vt-opta").selectedOptions[0]?.textContent || "\u2014"))}
    </div>
    <p class="meta" style="margin-top:8px;">Ao concluir: cadastro do funcion\u00e1rio, dados sens\u00edveis, registro da admiss\u00e3o${$("adm-gerar-docs").checked ? " e PDFs (ficha cadastral + contrato)" : ""}. Depois, na aba Documentos, "Enviar para assinatura" manda cada PDF \u00e0 D4Sign.</p>`;
}
async function funcAdmConcluir(){
  for(let e = 1; e <= 3; e++){ const erro = funcAdmValidar(e); if(erro){ funcAdmMostrar(e); aviso("adm-aviso", erro, "erro"); return; } }
  const v = (id) => ($(id)?.value ?? "").toString().trim() || null;
  const n = (id) => ($(id)?.value ?? "") === "" ? null : Number($(id).value);
  const b = (id) => { const x = $(id)?.value ?? ""; return x === "" ? null : x === "true"; };
  const nome = v("adm-nome"), cpf = ($("adm-cpf").value || "").replace(/\D/g, "");
  // hom\u00f4nimo: a mesma regra da ficha (nome igual s\u00f3 com CPF diferente)
  for(const f of _funcs.filter(f => funcNormalizarNome(f.nome) === funcNormalizarNome(nome))){
    const s = await funcCarregarSensivel(f.id); const c = String(s?.cpf || "").replace(/\D/g, "");
    if(!c){ aviso("adm-aviso", `J\u00e1 existe funcion\u00e1rio com este nome (${f.nome}) sem CPF no cadastro. Preencha o CPF dele primeiro.`, "erro"); return; }
    if(c === cpf){ aviso("adm-aviso", `${f.nome} j\u00e1 est\u00e1 cadastrado com este CPF. Abra o cadastro dele em vez de admitir de novo.`, "erro"); return; }
  }
  const funcionario = {
    nome, matricula: v("adm-matricula"), funcao: funcPadronizarFuncao(v("adm-funcao")) || null, status: "ativo", ativo: true, data_admissao: v("adm-data"),
    email: v("adm-email"), telefone: v("adm-telefone"), tipo_contrato: v("adm-tipo-contrato") || "clt", departamento_id: v("adm-departamento"),
    cnh_categoria: v("adm-cnh-categoria"), cnh_validade: v("adm-cnh-validade"), categoria_operacional: v("adm-categoria"),
    especialidade: v("adm-especialidade"), observacoes: v("adm-obs")
  };
  const r1 = await sb.from("funcionarios").insert(funcionario).select().single();
  if(r1.error){ aviso("adm-aviso", /matricula/i.test(r1.error.message) ? "Matr\u00edcula j\u00e1 em uso." : "Erro ao cadastrar: " + r1.error.message, "erro"); return; }
  const id = r1.data.id;
  const sens = {
    funcionario_id: id, cpf, rg: v("adm-rg"), rg_orgao_emissor: v("adm-rg-orgao"), data_nascimento: v("adm-nascimento"), sexo: v("adm-sexo"),
    estado_civil: v("adm-estado-civil"), conjuge: v("adm-conjuge"), naturalidade: v("adm-naturalidade"), nacionalidade: v("adm-nacionalidade"),
    raca_cor: v("adm-raca-cor"), grau_instrucao: v("adm-grau-instrucao"), nome_mae: v("adm-nome-mae"), nome_pai: v("adm-nome-pai"), dependentes: v("adm-dependentes"),
    contato_emergencia_nome: v("adm-emerg-nome"), contato_emergencia_tel: v("adm-emerg-tel"), contato_emergencia_parentesco: v("adm-emerg-parentesco"),
    ctps: v("adm-ctps"), ctps_serie: v("adm-ctps-serie"), pis: v("adm-pis"), titulo_eleitor: v("adm-titulo-eleitor"), zona_eleitoral: v("adm-zona"), secao_eleitoral: v("adm-secao"), reservista: v("adm-reservista"),
    cep: v("adm-cep"), logradouro: v("adm-logradouro"), numero: v("adm-numero"), complemento: v("adm-complemento"), bairro: v("adm-bairro"), cidade: v("adm-cidade"), uf: $("adm-uf").value || null,
    banco: v("adm-banco"), agencia: v("adm-agencia"), operacao: v("adm-operacao"), conta: v("adm-conta"), chave_pix: v("adm-pix"),
    salario_contabil: n("adm-salario"), horario_trabalho: v("adm-horario"), intervalo: v("adm-intervalo"), horas_semanais: n("adm-horas-semanais"), forma_pagamento: v("adm-forma-pagamento")
  };
  const r2 = await sb.from("funcionarios_sensiveis").upsert(sens, { onConflict: "funcionario_id" });
  if(r2.error){
    aviso("app-aviso", /cpf/i.test(r2.error.message) ? "J\u00e1 existe um funcion\u00e1rio com este CPF (o cadastro ficou sem os dados sens\u00edveis)." : "Funcion\u00e1rio criado, mas os dados sens\u00edveis n\u00e3o foram gravados: " + r2.error.message, "erro");
    await carregarFuncionarios(); await abrirFuncionario(id); return;
  }
  const adm = {
    funcionario_id: id, data_admissao: v("adm-data"), funcao: funcPadronizarFuncao(v("adm-funcao")) || null, cbo: v("adm-cbo"), salario: n("adm-salario"),
    prazo_experiencia_dias: n("adm-prazo") ?? 45, prorrogacao_dias: n("adm-prorrogacao") ?? 45, vencimento_1: v("adm-venc1"), vencimento_2: v("adm-venc2"),
    periculosidade: v("adm-periculosidade"), insalubridade: v("adm-insalubridade"), vale_transporte_cartao: v("adm-vt-cartao"), vale_transporte_opta: b("adm-vt-opta"),
    unimed_cartao: v("adm-unimed-cartao"), auxilio_saude: v("adm-auxilio-saude"), obra_equipamento_inicial: v("adm-obra-equip"),
    tipo_documento: v("adm-tipo-documento") || "padrao", status: "rascunho", observacoes: v("adm-obs")
  };
  const r3 = await sb.from("admissoes").insert(adm).select().single();
  if(r3.error){
    aviso("app-aviso", "Funcion\u00e1rio criado, mas a admiss\u00e3o n\u00e3o foi registrada: " + r3.error.message, "erro");
    await carregarFuncionarios(); await abrirFuncionario(id); return;
  }
  _funcLog = null; _funcPromo.dados = null;
  await carregarFuncionarios();
  await abrirFuncionario(id);
  ativarTabFunc("documentos");
  if($("adm-gerar-docs").checked && typeof rhdGerarAdmissao === "function"){
    try {
      aviso("app-aviso", "Admiss\u00e3o registrada. Gerando a ficha cadastral e o contrato\u2026", "aviso");
      await rhdGerarAdmissao(id, r3.data);
      await carregarDocsFuncionario();
      aviso("app-aviso", "Admiss\u00e3o conclu\u00edda: funcion\u00e1rio cadastrado e PDFs gerados na aba Documentos.", "ok");
    } catch(e){
      aviso("app-aviso", "Admiss\u00e3o registrada, mas os PDFs n\u00e3o sa\u00edram: " + (e.message || e) + ". Gere pela aba Documentos.", "erro");
    }
  } else {
    aviso("app-aviso", "Admiss\u00e3o registrada. Gere os PDFs na aba Documentos.", "ok");
  }

}

/* ====================================================================
   Fase 93b (20/10/2026): aba ACESSO — login do funcionário criado pelo RH, com o CPF como usuário.
   Decisão 6 do Bernardo (19/10): operadores, encarregados, ajudantes, soldadores e mecânicos entram no app
   para lançar horas de viagem, assinar documentos e, depois, contribuir no RDO. A Jucirlene (rh), além de
   admin e diretor, cria o login aqui: a edge function convidar-usuario (ações *_login_funcionario) lê o CPF
   em funcionarios_sensiveis com service_role, cria o usuário no Auth com o e-mail técnico
   <cpf>@funcionarios.cglfundacoes.com.br e a senha digitada, e grava profiles.login_cpf / senha_provisoria /
   funcionario_id. O CPF nunca passa por aqui: a tela diz "login: CPF do funcionário" e só. Cargo pela função
   do cadastro (tabela CARGO_POR_FUNCAO na function) ou escolhido no select. Desativar o funcionário (status
   Demitido, data de demissão ou inativo) desativa o login por gatilho no banco.
   Bloco independente do resto do arquivo: só a linha de plumbing em carregarFuncionarios() o chama.
   ==================================================================== */
const FUNC_ACESSO_CARGOS = { operador: "Operador", encarregado: "Encarregado", mecanico: "Mecânico", auxiliar_almoxarifado: "Auxiliar de almoxarifado" };
let _funcAcesso = { funcionarioId: null, perfil: null, modo: null };   // modo: null | "senha" (formulário de nova senha aberto)

/* Fase 100 (chamado #102) e hotfix 145 (chamado #145): criadores de login com setor. Cada um cria o login e define
   nova senha só da equipe dele; não desativa nem reativa (RH e administração), não vê o CPF e não passa por MFA.
   - almoxarife (Julio, fase 100): funcionário de departamento "Almoxarif…" (o próprio ou o pai), cargo travado em
     Auxiliar de almoxarifado.
   - gestor_manutencao (Bruno, hotfix 145): funcionário de departamento "MANUTENÇÃO" (o próprio ou o pai), menos o
     subdepartamento Almoxarife (continua com o Julio e o RH; a exclusão vale só para o departamento do próprio
     funcionário), cargos Mecânico, Operador ou Encarregado.
   Nome do departamento comparado sem acento e em maiúsculas. A function convidar-usuario confere tudo de novo. */
const FUNC_ACESSO_CRIADORES = {
  almoxarife: {
    setor: /ALMOXARIF/, exclui: null, cargos: ["auxiliar_almoxarifado"],
    ajuda: "A equipe do almoxarifado entra como <em>Auxiliar de almoxarifado</em>."
  },
  gestor_manutencao: {
    setor: /MANUTEN/, exclui: /ALMOXARIF/, cargos: ["mecanico", "operador", "encarregado"],
    ajuda: "A equipe da manutenção entra como <em>Mecânico</em> (soldadores e mecânicos), <em>Operador</em> (operadores e ajudantes) ou <em>Encarregado</em> (encarregados), pela função do cadastro; outra função pede o cargo aqui, só entre esses três."
  },
};
/* cópia de CARGO_POR_FUNCAO da function convidar-usuario (mesma ordem): no front só serve para o select do criador
   com setor saber se o cargo automático é um dos dele; quem decide é a function */
const FUNC_ACESSO_CARGO_POR_FUNCAO = [
  [/ALMOXARIF/, "auxiliar_almoxarifado"],
  [/ENCARREGAD/, "encarregado"],
  [/SOLDADOR|MECANIC/, "mecanico"],
  [/OPERADOR|AJUDANTE/, "operador"],
];
function funcAcessoNorm(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase(); }
function funcAcessoCargoPelaFuncao(funcao){
  const f = funcAcessoNorm(funcao).replace(/\s+/g, " ").trim();
  const regra = FUNC_ACESSO_CARGO_POR_FUNCAO.find(([re]) => re.test(f));
  return regra ? regra[1] : null;
}
/* "mecânico, operador ou encarregado": rótulos dos cargos em minúsculas, para as mensagens */
function funcAcessoListaCargos(cargos, conjuncao){
  const r = (cargos || []).map(c => (FUNC_ACESSO_CARGOS[c] || c).toLowerCase());
  return r.length > 1 ? r.slice(0, -1).join(", ") + " " + conjuncao + " " + r[r.length - 1] : (r[0] || "");
}
/* criador com setor do usuário logado (almoxarife, gestor de manutenção) ou null (rh/admin/diretor e os demais) */
function funcAcessoCriador(){ return (usuarioAtual && FUNC_ACESSO_CRIADORES[usuarioAtual.cargo]) || null; }
function funcAcessoNoSetor(cr){
  if(!cr) return false;
  let d = (_depts || []).find(x => x.id === ($("func-departamento")?.value || ""));
  if(d && cr.exclui && cr.exclui.test(funcAcessoNorm(d.nome))) return false;   // hotfix 145: o Almoxarife da MANUTENÇÃO não é do gestor
  for(let nivel = 0; d && nivel < 2; nivel++){
    if(cr.setor.test(funcAcessoNorm(d.nome))) return true;
    d = d.parent_id ? _depts.find(x => x.id === d.parent_id) : null;
  }
  return false;
}
function funcAcessoPodeVer(){
  if(!usuarioAtual) return false;
  if(["diretor", "admin", "rh"].includes(usuarioAtual.cargo)) return true;
  const cr = funcAcessoCriador();
  return !!cr && !!funcEditId && funcAcessoNoSetor(cr);
}
function funcAcessoPodeOperar(){ return funcAcessoPodeVer() && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura()); }
function funcAcessoAplicarVisibilidade(){
  const b = document.querySelector('#func-notebook button[data-tab="acesso"]');
  if(b) b.style.display = funcAcessoPodeVer() ? "" : "none";
}

async function funcAcessoCarregar(){
  const cont = $("func-acesso-conteudo");
  if(!cont) return;
  if(!funcAcessoPodeVer()){ cont.innerHTML = `<p class="vazio">Só RH, administração e diretoria cuidam do login do funcionário (o almoxarife, da equipe do almoxarifado; o gestor de manutenção, da equipe da manutenção).</p>`; return; }
  if(!funcEditId){ cont.innerHTML = `<p class="vazio">Salve o funcionário primeiro; depois crie o login aqui.</p>`; return; }
  if(_funcAcesso.funcionarioId !== funcEditId) _funcAcesso = { funcionarioId: funcEditId, perfil: null, modo: null };
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  const { data, error } = await sb.from("profiles")
    .select("id,nome,cargo,ativo,login_cpf,senha_provisoria,created_at")
    .eq("funcionario_id", funcEditId).maybeSingle();
  if(error){
    // 42703: a migration da 93b ainda não está no banco
    cont.innerHTML = `<p class="vazio">${esc(error.code === "42703" ? "O login por CPF ainda não está liberado neste banco (migration da fase 93b pendente)." : "Não foi possível ler o login: " + error.message)}</p>`;
    return;
  }
  _funcAcesso.perfil = data || null;
  renderFuncAcesso();
}

function funcAcessoSenhaHtml(idSufixo, rotuloBotao, idBotao){
  return `<div class="grade">
      <div class="campo"><label>Senha (mín. 8 caracteres) *</label>
        <div class="senha-wrap"><input type="password" id="func-acesso-senha${idSufixo}" autocomplete="new-password" />
          <button type="button" class="ver-senha" data-ver-senha="func-acesso-senha${idSufixo}">mostrar</button></div></div>
      <div class="campo"><label>Confirmar senha *</label><input type="password" id="func-acesso-senha2${idSufixo}" autocomplete="new-password" /></div>
    </div>
    <p class="meta bloco">A senha é provisória: no primeiro acesso o sistema obriga a troca. Repasse ao funcionário junto com a orientação "entre com o CPF, só números". A senha não fica guardada aqui.</p>
    <div class="form-acoes compacta"><button type="button" class="btn" id="${idBotao}">${rotuloBotao}</button>${_funcAcesso.modo === "senha" ? ' <button type="button" class="btn-sec" id="btn-func-acesso-cancelar">Cancelar</button>' : ""}</div>`;
}

function renderFuncAcesso(){
  const cont = $("func-acesso-conteudo");
  if(!cont) return;
  const p = _funcAcesso.perfil;
  const opera = funcAcessoPodeOperar();
  const funcAtivo = ($("func-status")?.value || "ativo") !== "demitido" && !$("func-demissao")?.value && ($("func-ativo")?.checked !== false);
  const cr = funcAcessoCriador();   // fase 100 / hotfix 145: almoxarife e gestor de manutenção, só a equipe deles
  if(!p){
    const funcao = $("func-funcao")?.value || "";
    let selCargo;
    if(cr && cr.cargos.length === 1){
      // fase 100: o almoxarife não escolhe (Auxiliar de almoxarifado)
      selCargo = `<div class="campo"><label>Cargo no sistema</label><input value="${esc(FUNC_ACESSO_CARGOS[cr.cargos[0]] || cr.cargos[0])}" disabled />
          <div class="meta">Compras, fornecedores e outros cargos: a administração troca depois, na tela Usuários.</div></div>`;
    } else if(cr){
      // hotfix 145: o gestor de manutenção escolhe só entre os cargos dele; função sem cargo automático (ex.:
      // Apontador de Produção) ou com um cargo que não é dele exige a escolha (funcAcessoCriar não manda vazio)
      const auto = funcAcessoCargoPelaFuncao(funcao);
      const autoOk = !!auto && cr.cargos.includes(auto);
      selCargo = `<div class="campo"><label>Cargo no sistema${autoOk ? "" : " *"}</label>
        <select id="func-acesso-cargo">${autoOk
          ? `<option value="">Automático pela função (${esc(funcao)}): ${esc(FUNC_ACESSO_CARGOS[auto])}</option>`
          : `<option value="">Escolha o cargo</option>`}
          ${cr.cargos.map(v => `<option value="${v}">${esc(FUNC_ACESSO_CARGOS[v] || v)}</option>`).join("")}</select>
        <div class="meta">${autoOk ? "" : `A função ${esc(funcao || "—")} não tem cargo automático: escolha ${esc(funcAcessoListaCargos(cr.cargos, "ou"))}. `}Outros cargos: a administração troca depois, na tela Usuários.</div></div>`;
    } else {
      selCargo = `<div class="campo"><label>Cargo no sistema</label>
        <select id="func-acesso-cargo"><option value="">Automático pela função (${esc(funcao || "—")})</option>
          ${Object.entries(FUNC_ACESSO_CARGOS).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div>`;
    }
    cont.innerHTML = `<div class="meta bloco" style="margin-bottom:12px;"><span class="tag cinza">Sem login</span> Este funcionário ainda não entra no sistema.</div>
      ${!funcAtivo ? `<p class="vazio">Funcionário inativo ou demitido não recebe login.</p>` : !opera ? `<p class="vazio">Usuário de revisão não cria login.</p>` : `
      <p class="meta bloco" style="margin-bottom:8px;"><strong>Login:</strong> o CPF do funcionário (só números), que precisa estar preenchido em Dados pessoais${cr ? " (pelo RH)" : ""}. ${cr ? cr.ajuda : "Operadores e ajudantes entram como <em>Operador</em>, encarregados como <em>Encarregado</em>, soldadores e mecânicos como <em>Mecânico</em>, o pessoal do almoxarifado como <em>Auxiliar de almoxarifado</em>; outra função pede o cargo aqui."}</p>
      <div class="grade">${selCargo}</div>
      ${funcAcessoSenhaHtml("", "🔑 Criar login", "btn-func-acesso-criar")}`}`;
    return;
  }
  // fase 100 / hotfix 145: o criador com setor só mexe em login com os cargos que ele dá e não desativa/reativa
  const operaEste = opera && (!cr || cr.cargos.includes(p.cargo));
  const situacao = p.ativo === false ? `<span class="tag vermelho">Login desativado</span>`
    : p.senha_provisoria ? `<span class="tag ambar">Senha provisória</span> <span class="tag verde">Login ativo</span>`
    : `<span class="tag verde">Login ativo</span>`;
  cont.innerHTML = `<div class="odoo-contexto" style="margin:0 0 12px;">
      <div class="chip"><span>Situação</span><strong>${situacao}</strong></div>
      <div class="chip"><span>Login</span><strong>CPF do funcionário</strong></div>
      <div class="chip"><span>Cargo</span><strong>${esc(FUNC_ACESSO_CARGOS[p.cargo] || (typeof CARGOS !== "undefined" && CARGOS[p.cargo]) || p.cargo || "—")}</strong></div>
      <div class="chip"><span>Criado em</span><strong>${p.created_at ? dataBR(p.created_at.slice(0, 10)) : "—"}</strong></div>
    </div>
    <p class="meta bloco" style="margin-bottom:12px;">${p.ativo === false
      ? "O funcionário não consegue entrar. Reativar libera o acesso de novo (com a senha de antes ou uma nova)."
      : p.senha_provisoria ? "Ele ainda não trocou a senha provisória: no primeiro acesso o sistema obriga a troca."
      : "Senha já trocada pelo funcionário. Sem a senha, defina uma nova aqui e repasse."}${cr && !operaEste ? ` Este login não é de ${esc(funcAcessoListaCargos(cr.cargos, "nem"))}: quem cuida dele é o RH ou a administração.` : ""}</p>
    ${!operaEste ? "" : cr && p.ativo === false ? `<p class="vazio">Login desativado: reativar fica com o RH ou a administração.</p>` : _funcAcesso.modo === "senha"
      ? funcAcessoSenhaHtml("-nova", p.ativo === false ? "✅ Reativar com esta senha" : "🔑 Definir nova senha", p.ativo === false ? "btn-func-acesso-reativar-senha" : "btn-func-acesso-nova-senha-ok")
      : `<div class="form-acoes compacta">
          ${p.ativo === false
            ? `<button type="button" class="btn" id="btn-func-acesso-reativar" ${funcAtivo ? "" : 'disabled title="Reative o cadastro do funcionário antes"'}>✅ Reativar login</button>
               <button type="button" class="btn-sec" id="btn-func-acesso-abrir-senha" ${funcAtivo ? "" : "disabled"}>🔑 Reativar com nova senha</button>`
            : `<button type="button" class="btn-sec" id="btn-func-acesso-abrir-senha">🔑 Nova senha</button>
               ${cr ? "" : '<button type="button" class="btn-sec acao-perigo" id="btn-func-acesso-desativar" style="color:var(--perigo);">⛔ Desativar login</button>'}`}
        </div>`}`;
}

/* chama a edge function convidar-usuario (mesmo caminho da tela Usuários); erro vira exceção com a mensagem da function */
async function funcAcessoChamar(payload){
  const { data:{ session } } = await sb.auth.getSession();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/convidar-usuario`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token || ""}`, "apikey": SUPABASE_KEY },
    body: JSON.stringify(Object.assign({ funcionario_id: funcEditId }, payload))
  });
  const body = await resp.json().catch(() => ({}));
  if(!resp.ok){ const e = new Error(body?.error || `Falha na function (HTTP ${resp.status})`); e.body = body; throw e; }
  return body;
}

/* lê e valida o par de senhas do formulário; devolve a senha ou null (com aviso) */
function funcAcessoLerSenha(sufixo){
  const s1 = $(`func-acesso-senha${sufixo}`)?.value || "", s2 = $(`func-acesso-senha2${sufixo}`)?.value || "";
  if(s1.length < 8){ aviso("func-acesso-aviso", "A senha precisa de pelo menos 8 caracteres.", "erro"); return null; }
  if(s1 !== s2){ aviso("func-acesso-aviso", "As senhas não conferem.", "erro"); return null; }
  if(/^\d+$/.test(s1) && s1.length === 11){ aviso("func-acesso-aviso", "A senha não pode ser só os 11 dígitos de um CPF.", "erro"); return null; }
  return s1;
}

async function funcAcessoCriar(){
  if(!funcAcessoPodeOperar() || !funcEditId) return;
  const senha = funcAcessoLerSenha("");
  if(!senha) return;
  // fase 100: cargo travado para o almoxarife; hotfix 145: o gestor de manutenção escolhe entre os cargos dele e,
  // quando o cargo automático pela função não é um deles, a escolha é obrigatória (não vai vazio para a function)
  const cr = funcAcessoCriador();
  let cargo = $("func-acesso-cargo")?.value || "";
  if(cr && cr.cargos.length === 1) cargo = cr.cargos[0];
  else if(cr && cargo && !cr.cargos.includes(cargo)){
    aviso("func-acesso-aviso", `Escolha ${funcAcessoListaCargos(cr.cargos, "ou")} em "Cargo no sistema".`, "erro"); return;
  } else if(cr && !cargo && !cr.cargos.includes(funcAcessoCargoPelaFuncao($("func-funcao")?.value))){
    aviso("func-acesso-aviso", `A função deste funcionário não tem cargo automático: escolha ${funcAcessoListaCargos(cr.cargos, "ou")} em "Cargo no sistema".`, "erro");
    $("func-acesso-cargo")?.focus();
    return;
  }
  try {
    const r = await funcAcessoChamar({ acao: "criar_login_funcionario", senha, cargo: cargo || undefined });
    aviso("func-acesso-aviso", `Login criado como ${FUNC_ACESSO_CARGOS[r.cargo] || r.cargo}. Repasse ao funcionário: entrar com o CPF (só números) e a senha que você digitou; o sistema pede a troca no primeiro acesso.`, "ok");
  } catch(err){
    if(err.body?.cargo_indefinido) aviso("func-acesso-aviso", err.message + " Escolha em \"Cargo no sistema\".", "erro");
    else aviso("func-acesso-aviso", err.message, "erro");
    return;
  }
  _funcAcesso.modo = null;
  await funcAcessoCarregar();
}

async function funcAcessoNovaSenha(){
  if(!funcAcessoPodeOperar() || !_funcAcesso.perfil) return;
  const senha = funcAcessoLerSenha("-nova");
  if(!senha) return;
  if(!confirm("Definir a nova senha? A senha atual deixa de valer e o funcionário sai do sistema em todos os aparelhos.")) return;
  try {
    await funcAcessoChamar({ acao: "nova_senha_funcionario", senha });
    aviso("func-acesso-aviso", "Nova senha definida (provisória: ele troca no primeiro acesso). Repasse ao funcionário.", "ok");
  } catch(err){ aviso("func-acesso-aviso", err.message, "erro"); return; }
  _funcAcesso.modo = null;
  await funcAcessoCarregar();
}

async function funcAcessoDesativar(){
  if(!funcAcessoPodeOperar() || !_funcAcesso.perfil) return;
  if(!confirm(`Desativar o login de ${$("func-nome")?.value || "este funcionário"}? Ele sai do sistema agora e não entra mais até ser reativado. O cadastro do funcionário não muda.`)) return;
  try {
    await funcAcessoChamar({ acao: "desativar_login_funcionario" });
    aviso("func-acesso-aviso", "Login desativado.", "ok");
  } catch(err){ aviso("func-acesso-aviso", err.message, "erro"); return; }
  await funcAcessoCarregar();
}

async function funcAcessoReativar(comSenha){
  if(!funcAcessoPodeOperar() || !_funcAcesso.perfil) return;
  let senha = null;
  if(comSenha){ senha = funcAcessoLerSenha("-nova"); if(!senha) return; }
  try {
    await funcAcessoChamar(senha ? { acao: "reativar_login_funcionario", senha } : { acao: "reativar_login_funcionario" });
    aviso("func-acesso-aviso", senha ? "Login reativado com a nova senha (provisória). Repasse ao funcionário." : "Login reativado; a senha é a mesma de antes.", "ok");
  } catch(err){ aviso("func-acesso-aviso", err.message, "erro"); return; }
  _funcAcesso.modo = null;
  await funcAcessoCarregar();
}

function ligarFuncAcesso(){
  // a aba carrega a cada clique (o funcionário aberto pode ter mudado); nada muda em abrirFuncionario()
  document.querySelector('#func-notebook button[data-tab="acesso"]')?.addEventListener("click", () => {
    const av = $("func-acesso-aviso"); if(av){ av.textContent = ""; av.className = "aviso"; }
    _funcAcesso.modo = null;
    funcAcessoCarregar();
  });
  $("func-acesso-conteudo")?.addEventListener("click", (e) => {
    const ver = e.target.closest("[data-ver-senha]");
    if(ver){ const inp = $(ver.dataset.verSenha); if(inp){ const oculto = inp.type === "password"; inp.type = oculto ? "text" : "password"; ver.textContent = oculto ? "ocultar" : "mostrar"; } return; }
    const b = e.target.closest("button[id]");
    if(!b) return;
    switch(b.id){
      case "btn-func-acesso-criar":          comBotaoTravado(b, funcAcessoCriar); break;
      case "btn-func-acesso-abrir-senha":    _funcAcesso.modo = "senha"; renderFuncAcesso(); $("func-acesso-senha-nova")?.focus(); break;
      case "btn-func-acesso-cancelar":       _funcAcesso.modo = null; renderFuncAcesso(); break;
      case "btn-func-acesso-nova-senha-ok":  comBotaoTravado(b, funcAcessoNovaSenha); break;
      case "btn-func-acesso-desativar":      comBotaoTravado(b, funcAcessoDesativar); break;
      case "btn-func-acesso-reativar":       comBotaoTravado(b, () => funcAcessoReativar(false)); break;
      case "btn-func-acesso-reativar-senha": comBotaoTravado(b, () => funcAcessoReativar(true)); break;
    }
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarFuncAcesso);
} else {
  ligarFuncAcesso();
}

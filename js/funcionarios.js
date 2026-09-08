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
  nr33:"NR-33", cipa:"CIPA", cnh:"CNH", crea:"CREA", cau:"CAU", outro:"Outro"
};

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

function avatarHtml(f, sz=40){
  const style = `width:${sz}px;height:${sz}px;font-size:${Math.round(sz*0.35)}px;flex-shrink:0;`;
  if(f.foto_url){
    return `<div class="func-kan-avatar" style="${style}"><img src="${esc(f.foto_url)}" alt="" loading="lazy" /></div>`;
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
    banco: v("func-banco"), agencia: v("func-agencia"), operacao: v("func-operacao"), conta: v("func-conta"),
    salario_particular: n("func-salario-particular"), unimed: n("func-unimed"), unimed_copart: n("func-unimed-copart"), metlife: n("func-metlife"),
    seguro_vida: n("func-seguro-vida"), vale_transporte: n("func-vt"), vr: n("func-vr"), flash: n("func-flash"), consignado: n("func-consignado"),
    cep: v("func-cep"), logradouro: v("func-logradouro"), numero: v("func-numero"), complemento: v("func-complemento"),
    bairro: v("func-bairro"), cidade: v("func-cidade"), uf: $("func-uf")?.value || null,
    contato_emergencia_nome: v("func-emerg-nome"), contato_emergencia_tel: v("func-emerg-tel"), contato_emergencia_parentesco: v("func-emerg-parentesco")
  };
  const { error } = await sb.from("funcionarios_sensiveis").upsert(reg, { onConflict: "funcionario_id" });
  return error;
}

/* ---------- carga principal ---------- */
async function carregarFuncionarios(){
  funcMontarSelectsFixos();
  // Estado de origem (logística) usa a mesma lista de UF do endereço
  if($("func-estado-origem") && $("func-uf") && !$("func-estado-origem").options.length) $("func-estado-origem").innerHTML = $("func-uf").innerHTML;
  funcAplicarVisibilidadeSensivel();
  const [{ data, error }] = await Promise.all([
    sb.from("funcionarios")
      .select("id,nome,matricula,funcao,data_admissao,status,ativo,telefone,foto_url,departamento_id,tipo_contrato,cnh_validade,categoria_operacional,especialidade,coringa,avaliacao")
      .order("nome"),
    _depts.length ? Promise.resolve() : funcCarregarDepts(),
    _supervisores.length ? Promise.resolve() : funcCarregarSupervisores(),
  ]);
  _funcs = error ? [] : (data || []);
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
  funcRenderizarSidebarDept();
  const dados = funcFiltrados();
  const cont = $("func-contador");
  if(cont) cont.textContent = `${dados.length} de ${_funcs.length}`;
  const selComp = $("func-he-competencia"); if(selComp) selComp.style.display = _funcView === "he" ? "" : "none";
  if(_funcView==="kanban") renderFuncKanban(dados);
  else if(_funcView==="logistica") renderFuncLogistica();
  else if(_funcView==="he"){ funcPreencherCompetencias(); renderFuncHE(); }
  else if(_funcView==="aprop") renderFuncAprop();
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
  funcEditId = null;
}

function novoFuncionario(){
  funcEditId = null;
  [
    "func-nome","func-cpf","func-rg","func-nascimento","func-matricula","func-funcao",
    "func-admissao","func-demissao","func-salario","func-email","func-telefone",
    "func-cep","func-logradouro","func-numero","func-complemento","func-bairro",
    "func-cidade","func-obs","func-cnh-validade",
    "func-emerg-nome","func-emerg-tel","func-emerg-parentesco"
  ].forEach(k => { const el=$(k); if(el) el.value=""; });
  $("func-status").value         = "ativo";
  $("func-tipo-contrato").value  = "clt";
  $("func-departamento").value   = "";
  $("func-supervisor").value     = "";
  $("func-cnh-categoria").value  = "";
  $("func-ativo").checked        = true;
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
  [["func-banco","banco"],["func-agencia","agencia"],["func-operacao","operacao"],["func-conta","conta"],["func-salario-particular","salario_particular"],["func-unimed","unimed"],["func-unimed-copart","unimed_copart"],["func-metlife","metlife"],["func-seguro-vida","seguro_vida"],["func-vt","vale_transporte"],["func-vr","vr"],["func-flash","flash"],["func-consignado","consignado"]]
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
}

/* ---------- foto ---------- */
function funcCarregarFoto(url, nome){
  const preview = $("func-foto-preview");
  if(!preview) return;
  if(url) preview.innerHTML = `<img src="${esc(url)}?t=${Date.now()}" alt="" />`;
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
  const { data: urlData } = sb.storage.from("funcionarios-fotos").getPublicUrl(path);
  const { error: upd } = await sb.from("funcionarios")
    .update({ foto_url: urlData.publicUrl }).eq("id", funcEditId);
  if(upd){ aviso("app-aviso","Foto salva mas não vinculada: "+upd.message,"erro"); return; }
  funcCarregarFoto(urlData.publicUrl, $("func-nome").value);
  await carregarFuncionarios();
  aviso("app-aviso","Foto atualizada.","ok");
}

/* ---------- smart buttons ---------- */
async function carregarDocsFuncionario(){
  if(!funcEditId){ $("func-docs-lista").innerHTML=""; return; }
  const { data, error } = await sb.from("funcionario_documentos")
    .select("*").eq("funcionario_id",funcEditId).order("validade");
  if(error){ $("func-docs-lista").innerHTML=`<p class="vazio">Erro ao carregar.</p>`; return; }
  const docs = data||[];

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
async function salvarFuncionario(novoStatus){
  if(!$("func-nome").value.trim()){
    aviso("app-aviso","Informe o nome.","erro"); ativarTabFunc("pessoais"); return;
  }
  const reg = {
    nome:            $("func-nome").value.trim(),
    matricula:       $("func-matricula").value.trim()||null,
    funcao:          $("func-funcao").value.trim(),
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
    });
  });

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
    if(!g.has(k)) g.set(k, { nome: nomeDe(r), obra: mapaObras[r.rdo?.obra_id] || "—", dias: new Set(), pres: 0, hn: 0, h50: 0, h100: 0, hnot: 0 });
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
      <tbody>${linhas.map(a => `<tr><td>${esc(a.nome)}</td><td>${esc(a.obra)}</td><td class="num">${a.dias.size}</td><td class="num">${f1(a.pres)}</td><td class="num">${f1(a.hn)}</td><td class="num">${f1(a.h50)}</td><td class="num">${f1(a.h100)}</td><td class="num">${f1(a.hnot)}</td></tr>`).join("") || `<tr><td colspan="8" class="vazio">Sem presenças em RDO nesta competência.</td></tr>`}</tbody>
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

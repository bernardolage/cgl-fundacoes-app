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
  const dias = Math.floor((new Date(validade) - new Date()) / 864e5);
  if(dias < 0)   return `<span class="tag vermelho" title="${dataBR(validade)}">CNH vencida</span>`;
  if(dias <= 90) return `<span class="tag ambar" title="${dataBR(validade)}">CNH vence em ${dias}d</span>`;
  return "";
}

function avatarHtml(f, sz=40){
  const style = `width:${sz}px;height:${sz}px;font-size:${Math.round(sz*0.35)}px;flex-shrink:0;`;
  if(f.foto_url){
    return `<div class="func-kan-avatar" style="${style}"><img src="${esc(f.foto_url)}" alt="" loading="lazy" /></div>`;
  }
  return `<div class="func-kan-avatar" style="${style}">${iniciais(f.nome)}</div>`;
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

/* ---------- carga principal ---------- */
async function carregarFuncionarios(){
  funcMontarSelectsFixos();
  const [{ data, error }] = await Promise.all([
    sb.from("funcionarios")
      .select("id,nome,cpf,matricula,funcao,data_admissao,status,ativo,telefone,foto_url,departamento_id,tipo_contrato,cnh_validade")
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
      const alvo = `${f.nome||""} ${f.cpf||""} ${f.matricula||""} ${f.funcao||""}`.toLowerCase();
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
  if(_funcView==="kanban") renderFuncKanban(dados);
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
  $("func-cpf").value         = data.cpf||"";
  $("func-rg").value          = data.rg||"";
  $("func-nascimento").value  = (data.data_nascimento||"").slice(0,10);
  $("func-admissao").value    = (data.data_admissao||"").slice(0,10);
  $("func-demissao").value    = (data.data_demissao||"").slice(0,10);
  $("func-salario").value     = data.salario??""  ;
  $("func-email").value       = data.email||"";
  $("func-telefone").value    = data.telefone||"";
  $("func-cep").value         = data.cep||"";
  $("func-logradouro").value  = data.logradouro||"";
  $("func-numero").value      = data.numero||"";
  $("func-complemento").value = data.complemento||"";
  $("func-bairro").value      = data.bairro||"";
  $("func-cidade").value      = data.cidade||"";
  $("func-uf").value          = data.uf||"";
  $("func-obs").value         = data.observacoes||"";
  $("func-ativo").checked     = data.ativo!==false;
  $("func-tipo-contrato").value  = data.tipo_contrato||"clt";
  $("func-departamento").value   = data.departamento_id||"";
  $("func-supervisor").value     = data.supervisor_id||"";
  $("func-cnh-categoria").value  = data.cnh_categoria||"";
  $("func-cnh-validade").value   = (data.cnh_validade||"").slice(0,10);
  $("func-emerg-nome").value     = data.contato_emergencia_nome||"";
  $("func-emerg-tel").value      = data.contato_emergencia_tel||"";
  $("func-emerg-parentesco").value = data.contato_emergencia_parentesco||"";

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
  else    preview.innerHTML = `<span>${iniciais(nome)}</span>`;
}

async function uploadFotoFuncionario(file){
  if(!funcEditId){ aviso("app-aviso","Salve o funcionário antes de adicionar foto.","aviso"); return; }
  const ext  = file.name.split(".").pop().toLowerCase()||"jpg";
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
    return new Date(d.validade) <= em90;
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
      const v = new Date(d.validade); v.setHours(0,0,0,0);
      if(v<hoje)       { valCls="func-doc-vencido";  valTxt+=" ⚠️"; }
      else if(v<=em90) { valCls="func-doc-vencendo"; valTxt+=" ⚠️"; }
      else               valCls="func-doc-ok";
    }
    return `<tr>
      <td><strong>${DOC_TIPO_LABEL[d.tipo]||d.tipo}</strong></td>
      <td>${esc(d.descricao||"—")}</td>
      <td>${esc(d.numero||"—")}</td>
      <td>${dataBR(d.emissao)||"—"}</td>
      <td class="${valCls}">${valTxt}</td>
      <td><button type="button" class="btn-sec" style="font-size:11px;padding:3px 10px;"
          onclick="excluirDocFuncionario('${d.id}')">Excluir</button></td>
    </tr>`;
  }).join("");

  cont.innerHTML = `<div class="tabela-rola"><table class="func-docs-table">
    <thead><tr>
      <th>Tipo</th><th>Descrição</th><th>Número</th>
      <th>Emissão</th><th>Validade</th><th></th>
    </tr></thead><tbody>${linhas}</tbody></table></div>`;
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
    cpf:             $("func-cpf").value.trim()||null,
    rg:              $("func-rg").value.trim()||null,
    data_nascimento: $("func-nascimento").value||null,
    data_admissao:   $("func-admissao").value||null,
    data_demissao:   $("func-demissao").value||null,
    salario:         $("func-salario").value!==""?Number($("func-salario").value):null,
    email:           $("func-email").value.trim()||null,
    telefone:        $("func-telefone").value.trim()||null,
    cep:             $("func-cep").value.trim()||null,
    logradouro:      $("func-logradouro").value.trim()||null,
    numero:          $("func-numero").value.trim()||null,
    complemento:     $("func-complemento").value.trim()||null,
    bairro:          $("func-bairro").value.trim()||null,
    cidade:          $("func-cidade").value.trim()||null,
    uf:              $("func-uf").value||null,
    observacoes:     $("func-obs").value.trim()||null,
    ativo:           $("func-ativo").checked,
    tipo_contrato:   $("func-tipo-contrato").value||"clt",
    departamento_id: $("func-departamento").value||null,
    supervisor_id:   $("func-supervisor").value||null,
    cnh_categoria:   $("func-cnh-categoria").value||null,
    cnh_validade:    $("func-cnh-validade").value||null,
    contato_emergencia_nome:         $("func-emerg-nome").value.trim()||null,
    contato_emergencia_tel:          $("func-emerg-tel").value.trim()||null,
    contato_emergencia_parentesco:   $("func-emerg-parentesco").value.trim()||null,
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
  $("btn-excluir-func").style.display = "";
  $("func-status").value = result.data.status;
  aviso("app-aviso","Funcionário salvo.","ok");
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

  ["func-busca","func-f-status","func-f-contrato"].forEach(id => {
    const el=$(id);
    if(el) el.addEventListener(id==="func-busca"?"input":"change", renderFuncionarios);
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
  $("btn-salvar-doc-func")?.addEventListener("click", salvarDocFuncionario);
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

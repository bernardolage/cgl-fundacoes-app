/* ====================================================================
   Módulo: Chamados (fase 42 — 10/09/2026)
   Problemas, dúvidas e pedidos de mudança no sistema, abertos pelos
   colaboradores. SEM chat ao vivo: o colaborador abre, a triagem diária
   (18h, tarefa agendada da sessão de gestão) classifica e a resolução fica
   registrada no próprio chamado.

   Matriz de triagem (decisão do Bernardo): código/restauração = sem validação
   prévia; valor/regra/estrutura/exclusão = validação da diretoria antes.

   Tabelas (migration criada pela sessão de gestão — nomes centralizados aqui
   para alinhar com um único ajuste):
     chamados(id, numero, titulo, descricao, categoria, status, modulo, obra_id,
              registro_tipo, registro_id, aberto_por, criado_em, atualizado_em)
     chamado_comentarios(id, chamado_id, autor, texto, criado_em)
   Se as tabelas ainda não existirem, o módulo avisa e não quebra o resto do app.
   ==================================================================== */

const CHAM_TBL = { chamados: "chamados", comentarios: "chamado_comentarios" };
const CHAM_COL = { criado: "criado_em", atualizado: "atualizado_em", autor: "autor", abertoPor: "aberto_por" };

const CHAM_STATUS = {
  aberto:               { label: "Aberto",                cor: "vermelho" },
  em_analise:           { label: "Em análise",            cor: "ambar" },
  aguardando_validacao: { label: "Aguardando validação",  cor: "azul" },
  resolvido:            { label: "Resolvido",             cor: "verde" }
};
const CHAM_CATEGORIA = {
  codigo:      { label: "Erro do sistema (código)",             validacao: false, dica: "Correção de código: a triagem corrige direto, sem validação prévia." },
  restauracao: { label: "Dado perdido / restaurar",             validacao: false, dica: "Restauração de dado: feita direto, sem validação prévia." },
  valor:       { label: "Valor errado (preço, quantidade, medição)", validacao: true, dica: "Mudança de valor: só depois da validação da diretoria." },
  regra:       { label: "Regra de negócio",                     validacao: true,  dica: "Mudança de regra: só depois da validação da diretoria." },
  estrutura:   { label: "Campo / tela / relatório novo",        validacao: true,  dica: "Mudança de estrutura: só depois da validação da diretoria." },
  exclusao:    { label: "Excluir dado",                         validacao: true,  dica: "Exclusão de dado: só depois da validação da diretoria." },
  duvida:      { label: "Dúvida / como usar",                   validacao: false, dica: "Dúvida: respondida no próprio chamado." },
  outro:       { label: "Outro",                                validacao: false, dica: "" }
};
// registro_tipo → como reabrir a tela do registro a partir do chamado
const CHAM_ABRIR_REGISTRO = {
  obra:    (id) => { irParaSecao("obras"); if(typeof abrirObra === "function") abrirObra(id); },
  rdo:     (id) => { irParaSecao("rdo");   if(typeof abrirRDO  === "function") abrirRDO(id); },
  medicao: (id) => { irParaSecao("medicoes"); if(typeof abrirMedicaoExistente === "function") abrirMedicaoExistente(id); }
};

let _chamados      = [];
let _chamPerfis    = {};     // profiles.id → nome (quem abriu / comentou)
let _chamCarregado = false;
let _chamTabelaOk  = true;   // false quando a migration ainda não existe
let _chamAberto    = null;   // chamado aberto no drawer
let _chamComentarios = [];
let _chamContexto  = null;   // contexto capturado ao clicar em "Reportar problema"

const chamPodeTriar = () => !!(usuarioAtual && ["diretor","admin"].includes(usuarioAtual.cargo));
const chamNome = (id) => id ? (_chamPerfis[id] || (usuarioAtual && usuarioAtual.id === id ? usuarioAtual.nome : null) || "—") : "—";
function chamDataHora(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(isNaN(d)) return String(iso).slice(0, 16);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function chamTag(status){
  const st = CHAM_STATUS[status] || { label: status || "—", cor: "cinza" };
  return `<span class="tag ${st.cor}">${esc(st.label)}</span>`;
}
function chamModuloLabel(secao){
  if(!secao) return "—";
  const b = document.querySelector(`.sidebar-nav button[data-secao="${secao}"] span`);
  return b ? b.textContent.trim() : secao;
}
// Tabela ausente (migration ainda não aplicada) — PostgREST responde 404/PGRST205 ou 42P01
function chamErroTabela(err){
  const m = String(err?.message || "") + " " + String(err?.code || "");
  return /PGRST205|42P01|does not exist|Could not find the table|schema cache/i.test(m);
}

/* ---------- Carga ---------- */
async function carregarChamados(silencioso){
  const cont = $("cham-conteudo");
  const { data, error } = await sb.from(CHAM_TBL.chamados).select("*").order(CHAM_COL.criado, { ascending: false }).limit(500);
  if(error){
    _chamTabelaOk = !chamErroTabela(error);
    if(cont){
      cont.innerHTML = `<p class="vazio">${_chamTabelaOk
        ? "Erro ao carregar chamados: " + esc(error.message)
        : "O módulo de chamados está aguardando a migration do banco (tabelas <code>chamados</code> e <code>chamado_comentarios</code>). Assim que ela for aplicada, esta tela passa a funcionar sem nova publicação."}</p>`;
    }
    if(!silencioso) aviso("app-aviso", _chamTabelaOk ? "Erro ao carregar chamados: " + error.message : "Chamados: tabelas ainda não criadas no banco.", "erro");
    _chamados = [];
    atualizarBadgeChamados();
    return;
  }
  _chamTabelaOk = true;
  _chamados = data || [];
  _chamCarregado = true;
  await carregarPerfisChamados(_chamados.map(c => c[CHAM_COL.abertoPor]));
  preencherFiltrosChamados();
  renderChamados();
  atualizarBadgeChamados();
}
async function carregarPerfisChamados(ids){
  const faltam = [...new Set((ids || []).filter(Boolean))].filter(id => !_chamPerfis[id]);
  if(!faltam.length) return;
  const { data } = await sb.from("profiles").select("id,nome").in("id", faltam);
  (data || []).forEach(p => { _chamPerfis[p.id] = p.nome; });
}
function atualizarBadgeChamados(){
  const b = $("nav-chamados-badge");
  if(!b) return;
  const meus = usuarioAtual ? usuarioAtual.id : null;
  // gestão vê tudo que está aberto; os demais veem os próprios que ainda não foram resolvidos
  const n = _chamados.filter(c => c.status !== "resolvido" && (chamPodeTriar() || c[CHAM_COL.abertoPor] === meus)).length;
  b.textContent = n ? String(n) : "";
}
function preencherFiltrosChamados(){
  const fs = $("cham-f-status");
  if(fs && fs.options.length <= 1){
    fs.innerHTML = `<option value="">Abertos e em andamento</option><option value="todos">Todos</option>` +
      Object.entries(CHAM_STATUS).map(([v, o]) => `<option value="${v}">${esc(o.label)}</option>`).join("");
  }
  const fc = $("cham-f-categoria");
  if(fc && fc.options.length <= 1){
    fc.innerHTML = `<option value="">Todas as categorias</option>` +
      Object.entries(CHAM_CATEGORIA).map(([v, o]) => `<option value="${v}">${esc(o.label)}</option>`).join("");
  }
  const fo = $("cham-f-obra");
  if(fo){
    const atual = fo.value;
    const obras = Object.entries(mapaObras).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    fo.innerHTML = `<option value="">Todas as obras</option>` + obras.map(o => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join("");
    fo.value = atual;
  }
}

/* ---------- Lista ---------- */
function chamadosFiltrados(){
  const termo = ($("cham-busca")?.value || "").trim().toLowerCase();
  const fSt   = $("cham-f-status")?.value || "";
  const fCat  = $("cham-f-categoria")?.value || "";
  const fObra = $("cham-f-obra")?.value || "";
  const meus  = $("cham-f-meus")?.checked;
  return _chamados.filter(c => {
    if(fSt === "") { if(c.status === "resolvido") return false; }
    else if(fSt !== "todos" && c.status !== fSt) return false;
    if(fCat && c.categoria !== fCat) return false;
    if(fObra && c.obra_id !== fObra) return false;
    if(meus && usuarioAtual && c[CHAM_COL.abertoPor] !== usuarioAtual.id) return false;
    if(termo){
      const alvo = `${c.numero || ""} ${c.titulo || ""} ${c.descricao || ""} ${chamNome(c[CHAM_COL.abertoPor])}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}
function renderChamados(){
  const cont = $("cham-conteudo");
  if(!cont || !_chamTabelaOk) return;
  // KPIs
  const limite30 = Date.now() - 30 * 86400000;
  const cnt = (st) => _chamados.filter(c => c.status === st && (st !== "resolvido" || new Date(c[CHAM_COL.atualizado] || c[CHAM_COL.criado]).getTime() >= limite30)).length;
  const kpi = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  kpi("cham-kpi-aberto", cnt("aberto")); kpi("cham-kpi-analise", cnt("em_analise"));
  kpi("cham-kpi-validacao", cnt("aguardando_validacao")); kpi("cham-kpi-resolvido", cnt("resolvido"));

  const lista = chamadosFiltrados();
  if($("cham-contador")) $("cham-contador").textContent = lista.length ? `(${lista.length})` : "";
  if(!lista.length){
    cont.innerHTML = `<p class="vazio">Nenhum chamado ${_chamados.length ? "com estes filtros" : "aberto ainda"}. Use <strong>🐞 Reportar problema</strong> no topo de qualquer tela.</p>`;
    return;
  }
  cont.innerHTML = `<div class="tabela-rola"><table class="cham-lista">
    <thead><tr><th style="width:60px;">Nº</th><th>Chamado</th><th>Categoria</th><th>Onde</th><th>Aberto por</th><th>Status</th></tr></thead>
    <tbody>${lista.map(c => {
      const cat = CHAM_CATEGORIA[c.categoria] || { label: c.categoria || "—", validacao: false };
      const desc = (c.descricao || "").split("\n")[0];
      return `<tr class="linha-clicavel" data-id="${esc(c.id)}">
        <td><strong>${c.numero != null ? "#" + esc(c.numero) : "—"}</strong></td>
        <td><div class="cham-titulo">${esc(c.titulo || "(sem título)")}</div><div class="cham-desc">${esc(desc.length > 140 ? desc.slice(0, 140) + "…" : desc)}</div></td>
        <td>${esc(cat.label)}${cat.validacao ? ' <span class="tag ambar" title="Exige validação da diretoria antes de executar">validação</span>' : ""}</td>
        <td><div>${esc(chamModuloLabel(c.modulo))}</div><div class="meta">${esc(mapaObras[c.obra_id] || "")}</div></td>
        <td><div>${esc(chamNome(c[CHAM_COL.abertoPor]))}</div><div class="meta">${esc(chamDataHora(c[CHAM_COL.criado]))}</div></td>
        <td>${chamTag(c.status)}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
  if(typeof marcarAcionaveis === "function") marcarAcionaveis(cont);
}

/* ---------- Ficha (drawer) ---------- */
async function abrirChamado(id){
  const c = _chamados.find(x => x.id === id);
  if(!c) return;
  _chamAberto = c;
  const { data, error } = await sb.from(CHAM_TBL.comentarios).select("*").eq("chamado_id", id).order(CHAM_COL.criado, { ascending: true });
  _chamComentarios = error ? [] : (data || []);
  await carregarPerfisChamados([c[CHAM_COL.abertoPor], ..._chamComentarios.map(k => k[CHAM_COL.autor])]);
  renderFichaChamado(error ? error.message : null);
  $("cham-modal").style.display = "flex";
}
function renderFichaChamado(erroComentarios){
  const c = _chamAberto;
  const box = $("cham-modal-conteudo");
  if(!c || !box) return;
  const cat = CHAM_CATEGORIA[c.categoria] || { label: c.categoria || "—", validacao: false, dica: "" };
  const podeTriar = chamPodeTriar();
  const ehAutor = usuarioAtual && c[CHAM_COL.abertoPor] === usuarioAtual.id;
  const stages = Object.entries(CHAM_STATUS).map(([v, o]) => {
    const atual = v === c.status;
    // gestão muda qualquer status; quem abriu só pode marcar como resolvido o próprio chamado
    const pode = !atual && (podeTriar || (ehAutor && v === "resolvido"));
    return `<div class="stage${atual ? " atual" : ""}" data-status="${v}" ${pode ? "" : 'aria-disabled="true"'} title="${atual ? "Status atual" : pode ? "Mudar para " + esc(o.label) : "Só a diretoria muda este status"}">${esc(o.label)}</div>`;
  }).join("");
  const abreRegistro = c.registro_tipo && c.registro_id && CHAM_ABRIR_REGISTRO[c.registro_tipo];
  box.innerHTML = `
    <div class="modal-topo">
      <h3 class="titulo-linha">${c.numero != null ? "#" + esc(c.numero) + " · " : ""}${esc(c.titulo || "(sem título)")}</h3>
      <button type="button" class="btn-sec" id="btn-cham-fechar">×</button>
    </div>
    <div class="cham-contexto">
      <span class="chip">Status: ${chamTag(c.status)}</span>
      <span class="chip">Categoria: <strong>${esc(cat.label)}</strong>${cat.validacao ? " · exige validação" : ""}</span>
      <span class="chip">Módulo: <strong>${esc(chamModuloLabel(c.modulo))}</strong></span>
      ${c.obra_id ? `<span class="chip">Obra: <strong>${esc(mapaObras[c.obra_id] || c.obra_id)}</strong></span>` : ""}
      ${c.registro_tipo ? `<span class="chip">Registro: <strong>${esc(c.registro_tipo)}</strong> ${abreRegistro ? `<button type="button" class="btn-sec btn-sm" id="btn-cham-abrir-registro">abrir</button>` : ""}</span>` : ""}
      <span class="chip">Aberto por <strong>${esc(chamNome(c[CHAM_COL.abertoPor]))}</strong> em ${esc(chamDataHora(c[CHAM_COL.criado]))}</span>
    </div>
    <div class="cham-status-bar" id="cham-status-bar">${stages}</div>
    ${cat.dica ? `<p class="nota">${esc(cat.dica)}</p>` : ""}
    <div class="campo largo"><label>Descrição</label><div class="cham-desc" style="font-size:var(--txt-sm);color:var(--txt);">${esc(c.descricao || "—")}</div></div>
    <h4 class="titulo-bloco" style="margin-top:14px;">Andamento (${_chamComentarios.length})</h4>
    ${erroComentarios ? `<p class="vazio">Não foi possível ler os comentários: ${esc(erroComentarios)}</p>` : ""}
    <div id="cham-comentarios">${_chamComentarios.length ? _chamComentarios.map(k => {
      const txt = k.texto || "";
      const cls = /^\[status\]/i.test(txt) ? " sistema" : /^\[resolu[cç][aã]o\]/i.test(txt) ? " resolucao" : "";
      return `<div class="cham-comentario${cls}"><div class="meta">${esc(chamNome(k[CHAM_COL.autor]))} · ${esc(chamDataHora(k[CHAM_COL.criado]))}</div><div style="white-space:pre-wrap;">${esc(txt.replace(/^\[(status|resolu[cç][aã]o)\]\s*/i, ""))}</div></div>`;
    }).join("") : `<p class="vazio">Sem comentários ainda. A triagem diária (18h) registra aqui o andamento.</p>`}</div>
    <div class="campo largo" style="margin-top:10px;"><label>Comentar</label><textarea id="cham-novo-comentario" rows="3" placeholder="${podeTriar ? "Registre a triagem, a decisão ou a resolução. Prefixe com [resolução] para destacar." : "Complemente o chamado (mais detalhes, prints descritos, o que mudou)."}"></textarea></div>
    <div id="cham-ficha-aviso" class="aviso"></div>
    <div class="form-acoes compacta">
      <button type="button" class="btn" id="btn-cham-comentar">Enviar comentário</button>
      ${(podeTriar && c.status !== "resolvido") ? `<button type="button" class="btn btn-sucesso" id="btn-cham-resolver" title="Grava o comentário como [resolução] e marca o chamado como resolvido">✅ Resolver com este comentário</button>` : ""}
    </div>`;

  $("btn-cham-fechar").addEventListener("click", fecharChamado);
  $("btn-cham-comentar").addEventListener("click", () => comentarChamado(false));
  $("btn-cham-resolver")?.addEventListener("click", () => comentarChamado(true));
  $("btn-cham-abrir-registro")?.addEventListener("click", () => { fecharChamado(); CHAM_ABRIR_REGISTRO[c.registro_tipo](c.registro_id); });
  box.querySelectorAll("#cham-status-bar .stage").forEach(el => {
    if(el.getAttribute("aria-disabled") === "true" || el.classList.contains("atual")) return;
    el.addEventListener("click", () => mudarStatusChamado(el.dataset.status));
  });
}
function fecharChamado(){
  $("cham-modal").style.display = "none";
  _chamAberto = null; _chamComentarios = [];
}
async function mudarStatusChamado(novo){
  const c = _chamAberto;
  if(!c || !CHAM_STATUS[novo] || novo === c.status) return;
  const anterior = c.status;
  const { error } = await sb.from(CHAM_TBL.chamados).update({ status: novo }).eq("id", c.id);
  if(error){ aviso("cham-ficha-aviso", "Não foi possível mudar o status: " + error.message, "erro"); return; }
  c.status = novo;
  // trilha: a mudança de status vira um comentário de sistema
  await sb.from(CHAM_TBL.comentarios).insert({ chamado_id: c.id, [CHAM_COL.autor]: usuarioAtual?.id || null,
    texto: `[status] ${CHAM_STATUS[anterior]?.label || anterior} → ${CHAM_STATUS[novo].label}` });
  await abrirChamado(c.id);
  renderChamados(); atualizarBadgeChamados();
}
async function comentarChamado(resolver){
  const c = _chamAberto;
  const ta = $("cham-novo-comentario");
  const texto = (ta?.value || "").trim();
  if(!c) return;
  if(!texto){ aviso("cham-ficha-aviso", "Escreva o comentário.", "erro"); return; }
  const { error } = await sb.from(CHAM_TBL.comentarios).insert({ chamado_id: c.id, [CHAM_COL.autor]: usuarioAtual?.id || null,
    texto: resolver && !/^\[resolu/i.test(texto) ? "[resolução] " + texto : texto });
  if(error){ aviso("cham-ficha-aviso", "Não foi possível gravar: " + error.message, "erro"); return; }
  if(resolver && c.status !== "resolvido"){
    const { error: e2 } = await sb.from(CHAM_TBL.chamados).update({ status: "resolvido" }).eq("id", c.id);
    if(e2){ aviso("cham-ficha-aviso", "Comentário gravado, mas o status não mudou: " + e2.message, "erro"); }
    else c.status = "resolvido";
  }
  await abrirChamado(c.id);
  renderChamados(); atualizarBadgeChamados();
}

/* ---------- Novo chamado / Reportar problema ----------
   O contexto vem da tela aberta: módulo (item ativo do menu), obra e registro em edição.
   Cada módulo guarda o id em edição num global próprio (obraEditId, rdoEditId…); os
   typeof protegem contra módulo ausente. */
function chamadosContextoAtual(){
  const btn = document.querySelector(".sidebar-nav button.ativo");
  const secao = btn?.dataset.secao || null;
  const ctx = { modulo: secao, modulo_label: chamModuloLabel(secao), obra_id: null, registro_tipo: null, registro_id: null, registro_label: null };
  const visivel = (id) => { const el = $(id); return !!el && el.style.display !== "none" && el.offsetParent !== null; };
  const pega = (tipo, id, label) => { ctx.registro_tipo = tipo; ctx.registro_id = id; ctx.registro_label = label || null; };
  switch(secao){
    case "obras":
      if(typeof obraEditId !== "undefined" && obraEditId && visivel("obr-ficha")){ ctx.obra_id = obraEditId; pega("obra", obraEditId, $("obr-ficha-titulo")?.textContent); }
      break;
    case "rdo":
      if(visivel("rdo-ficha")){
        ctx.obra_id = $("rdo-obra")?.value || null;
        if(typeof rdoEditId !== "undefined" && rdoEditId) pega("rdo", rdoEditId, $("rdo-ficha-titulo")?.textContent);
      }
      break;
    case "medicoes":    if(typeof medEditId  !== "undefined" && medEditId)  pega("medicao", medEditId, $("med-ficha-titulo")?.textContent); break;
    case "orcamentos":  if(typeof orcEditId  !== "undefined" && orcEditId)  pega("orcamento", orcEditId, $("orc-ficha-titulo")?.textContent); break;
    case "contratos":   if(typeof conEditId  !== "undefined" && conEditId)  pega("contrato", conEditId, $("con-ficha-titulo")?.textContent); break;
    case "funcionarios":if(typeof funcEditId !== "undefined" && funcEditId) pega("funcionario", funcEditId, null); break;
    case "clientes":    if(typeof cliEditId  !== "undefined" && cliEditId)  pega("cliente", cliEditId, null); break;
    case "fornecedores":if(typeof fornEditId !== "undefined" && fornEditId) pega("fornecedor", fornEditId, null); break;
    case "produtos":    if(typeof prodEditId !== "undefined" && prodEditId) pega("produto", prodEditId, null); break;
    case "servicos":    if(typeof servEditId !== "undefined" && servEditId) pega("servico", servEditId, null); break;
    case "usuarios":    if(typeof usrEditId  !== "undefined" && usrEditId)  pega("usuario", usrEditId, null); break;
  }
  return ctx;
}
function abrirNovoChamado(ctx){
  if(!usuarioAtual){ aviso("app-aviso", "Entre no sistema para abrir um chamado.", "erro"); return; }
  _chamContexto = ctx || { modulo: null, modulo_label: "—" };
  const c = _chamContexto;
  $("chamn-contexto").innerHTML = `
    <span class="chip">Módulo: <strong>${esc(c.modulo_label || "—")}</strong></span>
    ${c.registro_tipo ? `<span class="chip">Registro: <strong>${esc(c.registro_tipo)}</strong>${c.registro_label ? " · " + esc(c.registro_label) : ""}</span>` : ""}
    <span class="chip">Quem: <strong>${esc(usuarioAtual.nome || "")}</strong></span>
    <span class="chip meta">${c.registro_tipo || c.obra_id ? "Contexto capturado da tela aberta — a triagem já sabe onde olhar." : "Abra pela tela do problema para o chamado sair com obra e registro."}</span>`;
  const selCat = $("chamn-categoria");
  selCat.innerHTML = Object.entries(CHAM_CATEGORIA).map(([v, o]) => `<option value="${v}">${esc(o.label)}</option>`).join("");
  selCat.value = "codigo";
  const selObra = $("chamn-obra");
  const obras = Object.entries(mapaObras).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  selObra.innerHTML = `<option value="">— nenhuma —</option>` + obras.map(o => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join("");
  selObra.value = c.obra_id || "";
  $("chamn-titulo").value = "";
  $("chamn-descricao").value = "";
  atualizarNotaCategoriaChamado();
  const av = $("chamn-aviso"); if(av){ av.textContent = ""; av.className = "aviso"; }
  $("cham-novo-modal").style.display = "flex";
  setTimeout(() => $("chamn-titulo")?.focus(), 50);
}
function atualizarNotaCategoriaChamado(){
  const cat = CHAM_CATEGORIA[$("chamn-categoria")?.value];
  const el = $("chamn-nota-categoria");
  if(el) el.textContent = cat ? (cat.validacao ? "⚠️ " : "✔️ ") + cat.dica : "";
}
function fecharNovoChamado(){ $("cham-novo-modal").style.display = "none"; }
async function criarChamado(){
  if(!usuarioAtual) return;
  const titulo = $("chamn-titulo").value.trim();
  const descricao = $("chamn-descricao").value.trim();
  const categoria = $("chamn-categoria").value;
  if(!titulo){ aviso("chamn-aviso", "Dê um título ao chamado.", "erro"); return; }
  if(!descricao){ aviso("chamn-aviso", "Descreva o problema: o que fez, o que esperava e o que aconteceu.", "erro"); return; }
  const c = _chamContexto || {};
  // rodapé automático: ajuda a triagem a reproduzir (tela, registro, navegador)
  const rodape = [`tela: ${c.modulo_label || "—"}`, c.registro_label ? `registro: ${c.registro_label}` : null,
    `navegador: ${(navigator.userAgent || "").replace(/\).*$/, ")").slice(0, 120)}`].filter(Boolean).join(" · ");
  const reg = {
    titulo, categoria, status: "aberto",
    descricao: descricao + "\n\n— contexto automático: " + rodape,
    modulo: c.modulo || null,
    obra_id: $("chamn-obra").value || null,
    registro_tipo: c.registro_tipo || null,
    registro_id: c.registro_id || null,
    [CHAM_COL.abertoPor]: usuarioAtual.id
  };
  const btn = $("btn-chamn-criar");
  btn.disabled = true;
  const { data, error } = await sb.from(CHAM_TBL.chamados).insert(reg).select("*").single();
  btn.disabled = false;
  if(error){
    aviso("chamn-aviso", chamErroTabela(error)
      ? "O módulo de chamados ainda não tem as tabelas no banco (migration pendente). Avise a diretoria pelo WhatsApp por enquanto."
      : "Não foi possível abrir o chamado: " + error.message, "erro");
    return;
  }
  fecharNovoChamado();
  aviso("app-aviso", `✅ Chamado ${data?.numero != null ? "#" + data.numero + " " : ""}aberto. A triagem diária às 18h dá o retorno no próprio chamado.`, "ok");
  await carregarChamados(true);
}

/* ---------- Listeners ---------- */
function ligarChamados(){
  document.querySelector('.sidebar-nav button[data-secao="chamados"]')?.addEventListener("click", () => carregarChamados(true));
  $("btn-cham-atualizar")?.addEventListener("click", () => carregarChamados(false));
  $("btn-cham-novo")?.addEventListener("click", () => abrirNovoChamado({ modulo: "chamados", modulo_label: "Chamados" }));
  $("btn-reportar-problema")?.addEventListener("click", () => abrirNovoChamado(chamadosContextoAtual()));
  $("btn-chamn-fechar")?.addEventListener("click", fecharNovoChamado);
  $("btn-chamn-criar")?.addEventListener("click", () => comBotaoTravado("btn-chamn-criar", criarChamado));
  $("chamn-categoria")?.addEventListener("change", atualizarNotaCategoriaChamado);
  ["cham-busca","cham-f-status","cham-f-categoria","cham-f-obra","cham-f-meus"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "cham-busca" ? "input" : "change", renderChamados);
  });
  document.querySelectorAll("#sec-chamados .ind-click[data-cham-status]").forEach(k => {
    k.addEventListener("click", () => { const f = $("cham-f-status"); if(f){ f.value = k.dataset.chamStatus; renderChamados(); } });
  });
  $("cham-conteudo")?.addEventListener("click", (e) => {
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirChamado(tr.dataset.id);
  });
  // fechar drawers clicando fora
  $("cham-modal")?.addEventListener("click", (e) => { if(e.target.id === "cham-modal") fecharChamado(); });
  $("cham-novo-modal")?.addEventListener("click", (e) => { if(e.target.id === "cham-novo-modal") fecharNovoChamado(); });
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarChamados);
} else {
  ligarChamados();
}

/* ====================================================================
   Módulo: Chamados (fase 42 — 10/09/2026)
   Problemas, dúvidas e pedidos de mudança no sistema, abertos pelos
   colaboradores. SEM chat ao vivo: o colaborador abre, a triagem diária
   (18h, rotina /triar-chamados da fase 64, só comenta e classifica) preenche
   prioridade, esforço e faixa, e a resolução fica registrada no próprio chamado.

   Matriz de triagem (decisão do Bernardo): código/restauração = sem validação
   prévia; valor/regra/estrutura/exclusão = validação da diretoria antes.

   Tabelas (migration criada pela sessão de gestão — nomes centralizados aqui
   para alinhar com um único ajuste):
     chamados(id, numero, titulo, descricao, categoria, status, modulo, obra_id,
              registro_tipo, registro_id, aberto_por, criado_em, atualizado_em)
     chamado_comentarios(id, chamado_id, autor, texto, criado_em)
   Se as tabelas ainda não existirem, o módulo avisa e não quebra o resto do app.
   ==================================================================== */

const CHAM_TBL = { chamados: "chamados", comentarios: "chamado_comentarios", anexos: "chamado_anexos" };
/* Fase 48 (21/09/2026): anexos do chamado — planilha, PDF ou foto do controle que a pessoa usa hoje.
   Bucket privado; só quem enviou, quem abriu o chamado e a diretoria conseguem baixar. */
const CHAM_ANEXO_BUCKET = "chamados-anexos";
const CHAM_ANEXO_MAX = 5, CHAM_ANEXO_MAX_BYTES = 20 * 1024 * 1024;
const CHAM_ANEXO_MIME = {
  pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12", csv: "text/csv", txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", doc: "application/msword",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp"
};
const CHAM_ANEXO_ACCEPT = Object.keys(CHAM_ANEXO_MIME).map(e => "." + e).join(",");
const CHAM_COL = { criado: "criado_em", atualizado: "atualizado_em", autor: "autor", abertoPor: "aberto_por" };

const CHAM_STATUS = {
  aberto:               { label: "Aberto",                cor: "vermelho" },
  em_analise:           { label: "Em análise",            cor: "ambar" },
  aguardando_validacao: { label: "Esperando resposta",    cor: "azul" },   // lote S47: sempre com destinatário e prazo
  planejado:            { label: "Planejado",             cor: "azul" },   // fase 64: entrou numa fase/lote/hotfix
  recusado:             { label: "Recusado",              cor: "cinza" },  // fase 64: duplicado ou fora do escopo
  resolvido:            { label: "Resolvido",             cor: "verde" }
};
/* Fase 64 (05/10/2026): backlog. A triagem (/triar-chamados) preenche; a diretoria ajusta na ficha. */
const CHAM_PRIORIDADE = {
  1: { label: "P1 · bloqueia operação",    cor: "vermelho" },
  2: { label: "P2 · erro com contorno",    cor: "ambar" },
  3: { label: "P3 · melhoria",             cor: "azul" },
  4: { label: "P4 · dúvida ou cosmético",  cor: "cinza" }
};
const CHAM_ESFORCO = { P: "Pequeno", M: "Médio", G: "Grande" };
const CHAM_FAIXA = { hotfix: "Hotfix", lote: "Lote semanal", decisao: "Decisão da diretoria", resposta: "Só resposta", recusar: "Recusar" };
const chamFechado = (st) => st === "resolvido" || st === "recusado";
const CHAM_CATEGORIA = {
  codigo:      { label: "Erro do sistema (código)",             validacao: false, dica: "Correção de código: a triagem corrige direto, sem validação prévia." },
  restauracao: { label: "Dado perdido / restaurar",             validacao: false, dica: "Restauração de dado: feita direto, sem validação prévia." },
  valor:       { label: "Valor errado (preço, quantidade, medição)", validacao: true, dica: "Mudança de valor: só depois da validação da diretoria." },
  regra:       { label: "Regra de negócio",                     validacao: true,  dica: "Mudança de regra: só depois da validação da diretoria." },
  estrutura:   { label: "Campo / tela / relatório novo",        validacao: true,  dica: "Mudança de estrutura: só depois da validação da diretoria." },
  melhoria:    { label: "Sugestão de melhoria",                 validacao: true,  dica: "Sugestão: a triagem avalia e a diretoria decide se entra na fila." },
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
let _chamAnexos = [];        // fase 48: anexos do chamado aberto
let _chamContexto  = null;   // contexto capturado ao clicar em "Relatar problema ou melhoria"

const chamPodeTriar = () => !!(usuarioAtual && ["diretor","admin"].includes(usuarioAtual.cargo));

/* ---------- Lote S47 (21/10/2026): quem responde, até quando, aprovar e reabrir ----------
   aguardando_de: 'autor' | 'diretoria' | 'usuario' (+ aguardando_de_id); aguardando_ate (5 dias úteis);
   aguardando_sugere (status que "Aprovar e enviar" aplica); resolvido_em (o autor reabre por 7 dias).
   Antes da migration 20261022_loteS47 as colunas não vêm no select("*"): chamTemEspera() devolve false e a
   ficha segue o fluxo antigo. */
const CHAM_REABRIR_DIAS = 7;
const CHAM_SUGERE = { em_analise: "Em análise", resolvido: "Resolvido", recusado: "Recusado" };
const chamTemEspera = (c) => !!c && Object.prototype.hasOwnProperty.call(c, "aguardando_de");
const chamEuId = () => usuarioAtual ? usuarioAtual.id : null;
function chamEsperaMinha(c){
  if(!c || c.status !== "aguardando_validacao" || !chamTemEspera(c) || !usuarioAtual) return false;
  if(c.aguardando_de === "diretoria") return chamPodeTriar();
  if(c.aguardando_de === "autor") return c[CHAM_COL.abertoPor] === chamEuId();
  return c.aguardando_de === "usuario" && c.aguardando_de_id === chamEuId();
}
// "Bernardo", "Diretoria", "você"
function chamEsperaQuem(c){
  if(!c || !c.aguardando_de) return "—";
  if(chamEsperaMinha(c)) return "você";
  if(c.aguardando_de === "diretoria") return "Diretoria";
  if(c.aguardando_de === "autor") return chamAutor(c[CHAM_COL.abertoPor], c.origem) + " (autor)";
  return chamNome(c.aguardando_de_id);
}
const chamPrazoVencido = (c) => !!(c && c.status === "aguardando_validacao" && c.aguardando_ate && c.aguardando_ate < hojeISO());
function chamEsperaTxt(c){
  return `Esperando: ${chamEsperaQuem(c)}${c.aguardando_ate ? " · até " + dataBR(c.aguardando_ate).slice(0, 5) : ""}`;
}
// resolvido há menos de 7 dias (o autor ainda pode reabrir)
function chamResolvidoRecente(c){
  if(!c || c.status !== "resolvido" || !c.resolvido_em) return false;
  return Date.now() - new Date(c.resolvido_em).getTime() < CHAM_REABRIR_DIAS * 86400000;
}
/* Lote S55 (#185): confirmação da correção pelo autor ("✅ Funcionou", RPC chamado_confirmar, mesma janela de 7 dias).
   "autor" = confirmou; "prazo" = resolvido há mais de 7 dias sem reabrir (só exibição; a diretoria não confirma em nome
   do autor); "pendente" = resolvido há menos de 7 dias sem confirmação; null = não está resolvido.
   Antes da migration do lote S55 a coluna confirmado_em não vem no select("*"): chamTemConfirmacao() devolve false e
   os botões não aparecem (o bloco "Confira a correção" segue com o "Não resolveu" de sempre). */
const chamTemConfirmacao = (c) => !!c && Object.prototype.hasOwnProperty.call(c, "confirmado_em");
function chamConfirmacao(c){
  if(!c || c.status !== "resolvido") return null;
  if(c.confirmado_em) return "autor";
  return chamResolvidoRecente(c) ? "pendente" : "prazo";
}
const CHAM_CONFIRMACAO_TXT = { autor: "confirmado pelo autor", prazo: "confirmado por prazo", pendente: "sem confirmação" };
const chamSomenteLeitura = () => typeof ehSomenteLeitura === "function" && ehSomenteLeitura();
// a última pergunta ou resposta sugerida do chamado aberto (o que a pessoa esperada precisa ler)
function chamPerguntaAtual(){
  for(let i = _chamComentarios.length - 1; i >= 0; i--){
    const t = _chamComentarios[i].texto || "";
    if(/\[resposta sugerida\]/i.test(t)) return { sugerida: true, texto: chamRespostaSugerida(t) };
    const m = t.match(/\[pergunta\]\s*([\s\S]+)$/i);
    if(m) return { sugerida: false, texto: m[1].replace(/\s*\[sugere:[^\]]*\]/gi, "").trim() };
  }
  return null;
}
const chamNome = (id) => id ? (_chamPerfis[id] || (usuarioAtual && usuarioAtual.id === id ? usuarioAtual.nome : null) || "—") : "—";
function chamDataHora(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(isNaN(d)) return String(iso).slice(0, 16);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function chamTag(status){
  const st = CHAM_STATUS[status] || { label: status || "—", cor: "cinza" };
  return `<span class="tag ${esc(st.cor)}">${esc(st.label)}</span>`;
}
function chamTagPrioridade(p, longo){
  const o = CHAM_PRIORIDADE[p];
  if(!o) return '<span class="meta">—</span>';
  return `<span class="tag ${esc(o.cor)}" title="${esc(o.label)}">${esc(longo ? o.label : "P" + p)}</span>`;
}
// quem abriu / quem comentou: a rotina de triagem grava sem usuário (origem = 'triagem')
function chamAutor(id, origem){ return !id && origem === "triagem" ? "Triagem automática" : chamNome(id); }
// só link http(s) vira <a>; o resto aparece como texto
function chamLinkPR(url){
  const u = String(url || "").trim();
  if(!u) return "—";
  return /^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?github\.com\//i, ""))}</a>` : esc(u);
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
  await carregarPerfisChamados(_chamados.flatMap(c => [c[CHAM_COL.abertoPor], c.aguardando_de_id]));   // lote S47: quem responde
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
  const n = _chamados.filter(c => !chamFechado(c.status) && (chamPodeTriar() || c[CHAM_COL.abertoPor] === meus)).length;
  b.textContent = n ? String(n) : "";
}
function preencherFiltrosChamados(){
  const fs = $("cham-f-status");
  if(fs && fs.options.length <= 1){
    // lote S47: atalhos "esperando a minha resposta", "prazo vencido" e "resolvidos nos últimos 7 dias"
    fs.innerHTML = `<option value="">Abertos e em andamento</option><option value="todos">Todos</option>` +
      `<option value="minha_resposta">Esperando minha resposta</option>` +
      (chamPodeTriar() ? `<option value="atrasados">Esperando resposta, prazo vencido</option>` : "") +
      `<option value="resolvidos7">Resolvidos nos últimos 7 dias</option>` +
      `<option value="resolvidos_sem_confirmacao">Resolvidos sem confirmação</option>` +   // lote S55 (#185)
      Object.entries(CHAM_STATUS).map(([v, o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("");
  }
  const fp = $("cham-f-prioridade");
  if(fp && fp.options.length <= 1){
    fp.innerHTML = `<option value="">Todas as prioridades</option>` +
      Object.entries(CHAM_PRIORIDADE).map(([v, o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("") +
      `<option value="sem">Sem prioridade (não triado)</option>`;
  }
  const fc = $("cham-f-categoria");
  if(fc && fc.options.length <= 1){
    fc.innerHTML = `<option value="">Todas as categorias</option>` +
      Object.entries(CHAM_CATEGORIA).map(([v, o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("");
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
  const fPri  = $("cham-f-prioridade")?.value || "";
  const meus  = $("cham-f-meus")?.checked;
  return _chamados.filter(c => {
    if(fSt === "") { if(chamFechado(c.status)) return false; }
    else if(fSt === "minha_resposta"){ if(!chamEsperaMinha(c)) return false; }   // lote S47
    else if(fSt === "atrasados"){ if(!chamPrazoVencido(c)) return false; }
    else if(fSt === "resolvidos7"){ if(!chamResolvidoRecente(c)) return false; }
    else if(fSt === "resolvidos_sem_confirmacao"){ if(chamConfirmacao(c) !== "pendente") return false; }   // lote S55
    else if(fSt !== "todos" && c.status !== fSt) return false;
    if(fPri === "sem" ? c.prioridade != null : (fPri && String(c.prioridade) !== fPri)) return false;
    if(fCat && c.categoria !== fCat) return false;
    if(fObra && c.obra_id !== fObra) return false;
    if(meus && usuarioAtual && c[CHAM_COL.abertoPor] !== usuarioAtual.id) return false;
    if(termo){
      const alvo = `${c.numero || ""} ${c.titulo || ""} ${c.descricao || ""} ${chamNome(c[CHAM_COL.abertoPor])}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  // fase 64: prioridade primeiro (sem prioridade por último), depois o mais recente
  }).sort((a, b) => (a.prioridade ?? 9) - (b.prioridade ?? 9) || String(b[CHAM_COL.criado] || "").localeCompare(String(a[CHAM_COL.criado] || "")));
}
let _chamSel = new Set();   // fase 64: chamados marcados para "Planejar na fase…"
function renderChamados(){
  const cont = $("cham-conteudo");
  if(!cont || !_chamTabelaOk) return;
  // KPIs
  const limite30 = Date.now() - 30 * 86400000;
  const cnt = (st) => _chamados.filter(c => c.status === st && (st !== "resolvido" || new Date(c.resolvido_em || c[CHAM_COL.atualizado] || c[CHAM_COL.criado]).getTime() >= limite30)).length;
  const kpi = (id, v) => { const el = $(id); if(el) el.textContent = v; };
  kpi("cham-kpi-aberto", cnt("aberto")); kpi("cham-kpi-analise", cnt("em_analise"));
  // lote S47: conta só o que espera o usuário logado (antes da migration, o total esperando)
  kpi("cham-kpi-validacao", _chamados.some(chamTemEspera) ? _chamados.filter(chamEsperaMinha).length : cnt("aguardando_validacao"));
  kpi("cham-kpi-resolvido", cnt("resolvido"));
  kpi("cham-kpi-p1", _chamados.filter(c => c.prioridade === 1 && ["aberto","em_analise"].includes(c.status)).length);
  // lote S55 (#185): resolvidos há menos de 7 dias ainda sem o "Funcionou" do autor; só a gestão vê o cartão
  const kSem = $("cham-kpi-semconf");
  if(kSem){
    kSem.textContent = _chamados.filter(c => chamConfirmacao(c) === "pendente").length;
    const ind = kSem.closest(".ind"); if(ind) ind.style.display = chamPodeTriar() ? "" : "none";
  }

  const lista = chamadosFiltrados();
  const podeTriar = chamPodeTriar();
  const idsLista = new Set(lista.map(c => c.id));
  _chamSel.forEach(id => { if(!idsLista.has(id)) _chamSel.delete(id); });
  if($("cham-contador")) $("cham-contador").textContent = lista.length ? `(${lista.length})` : "";
  chamAtualizarBarraPlanejar();
  if(!lista.length){
    cont.innerHTML = `<p class="vazio">Nenhum chamado ${_chamados.length ? "com estes filtros" : "aberto ainda"}. Use <strong>💡 Relatar problema ou melhoria</strong> no topo de qualquer tela.</p>`;
    return;
  }
  cont.innerHTML = `<div class="tabela-rola"><table class="cham-lista">
    <thead><tr>${podeTriar ? `<th style="width:28px;"><input type="checkbox" id="cham-sel-todos" title="Marcar todos da lista" ${lista.every(c => _chamSel.has(c.id)) ? "checked" : ""} /></th>` : ""}<th style="width:60px;">Nº</th><th style="width:48px;">Prior.</th><th>Chamado</th><th>Categoria</th><th>Onde</th><th>Aberto por</th><th>Status</th></tr></thead>
    <tbody>${lista.map(c => {
      const cat = CHAM_CATEGORIA[c.categoria] || { label: c.categoria || "—", validacao: false };
      const desc = (c.descricao || "").split("\n")[0];
      return `<tr class="linha-clicavel" data-id="${esc(c.id)}">
        ${podeTriar ? `<td><input type="checkbox" class="cham-sel" data-id="${esc(c.id)}" ${_chamSel.has(c.id) ? "checked" : ""} aria-label="Marcar #${esc(c.numero ?? "")}" /></td>` : ""}
        <td><strong>${c.numero != null ? "#" + esc(c.numero) : "—"}</strong></td>
        <td>${chamTagPrioridade(c.prioridade)}</td>
        <td><div class="cham-titulo">${esc(c.titulo || "(sem título)")}</div><div class="cham-desc">${esc(desc.length > 140 ? desc.slice(0, 140) + "…" : desc)}</div></td>
        <td>${esc(cat.label)}${cat.validacao ? ' <span class="tag ambar" title="Exige validação da diretoria antes de executar">validação</span>' : ""}</td>
        <td><div>${esc(chamModuloLabel(c.modulo))}</div><div class="meta">${c.obra_id ? linkObra(c.obra_id) : ""}</div></td>
        <td><div>${esc(chamAutor(c[CHAM_COL.abertoPor], c.origem))}</div><div class="meta">${esc(chamDataHora(c[CHAM_COL.criado]))}</div></td>
        <td>${chamTag(c.status)}${c.status === "aguardando_validacao" && c.aguardando_de ? `<div class="meta${chamPrazoVencido(c) ? " txt-perigo" : ""}">${esc(chamEsperaTxt(c))}</div>` : ""}${chamConfirmacao(c) ? `<div class="meta">${esc(chamConfirmacao(c) === "autor" ? "confirmado " + chamDataHora(c.confirmado_em).slice(0, 5) : CHAM_CONFIRMACAO_TXT[chamConfirmacao(c)])}</div>` : ""}${c.fase ? `<div class="meta">${esc(c.fase)}</div>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
  if(typeof marcarAcionaveis === "function") marcarAcionaveis(cont);
}
/* Fase 64: ação em massa "Planejar na fase…" (só gestão; campo inline, sem prompt) */
function chamAtualizarBarraPlanejar(){
  const bar = $("cham-planejar-bar");
  if(!bar) return;
  bar.style.display = chamPodeTriar() && _chamSel.size ? "" : "none";
  const n = $("cham-planejar-n"); if(n) n.textContent = `${_chamSel.size} marcado(s)`;
}
async function chamPlanejarSelecionados(){
  const fase = ($("cham-planejar-fase")?.value || "").trim();
  if(!_chamSel.size){ aviso("app-aviso", "Marque os chamados na lista.", "erro"); return; }
  if(!fase){ aviso("app-aviso", "Informe a fase, o lote ou o hotfix (ex.: lote-S41, hotfix-35, 66).", "erro"); $("cham-planejar-fase")?.focus(); return; }
  const { data, error } = await sb.rpc("chamado_planejar", { p_ids: [..._chamSel], p_fase: fase });
  if(error){ aviso("app-aviso", "Não foi possível planejar: " + error.message, "erro"); return; }
  if(!data){ aviso("app-aviso", "Nenhum chamado mudou (já resolvidos ou sem permissão).", "erro"); return; }
  aviso("app-aviso", `${data} chamado(s) planejado(s) em ${fase}.`, "ok");
  _chamSel.clear();
  if($("cham-planejar-fase")) $("cham-planejar-fase").value = "";
  await carregarChamados(true);
}

/* ---------- Ficha (drawer) ---------- */
async function abrirChamado(id){
  const c = _chamados.find(x => x.id === id);
  if(!c) return;
  _chamAberto = c;
  const { data, error } = await sb.from(CHAM_TBL.comentarios).select("*").eq("chamado_id", id).order(CHAM_COL.criado, { ascending: true });
  _chamComentarios = error ? [] : (data || []);
  const ax = await sb.from(CHAM_TBL.anexos).select("*").eq("chamado_id", id).order("criado_em", { ascending: true });
  _chamAnexos = ax.error ? [] : (ax.data || []); // RLS: vem vazio para quem não é autor/diretoria
  await carregarPerfisChamados([c[CHAM_COL.abertoPor], ..._chamComentarios.map(k => k[CHAM_COL.autor]), ..._chamAnexos.map(a => a.enviado_por)]);
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
    return `<div class="stage${atual ? " atual" : ""}" data-status="${esc(v)}" ${pode ? "" : 'aria-disabled="true"'} title="${atual ? "Status atual" : pode ? "Mudar para " + esc(o.label) : "Só a diretoria muda este status"}">${esc(o.label)}</div>`;
  }).join("");
  const abreRegistro = c.registro_tipo && c.registro_id && CHAM_ABRIR_REGISTRO[c.registro_tipo];
  box.innerHTML = `
    <div class="modal-topo">
      <h3 class="titulo-linha">${c.numero != null ? "#" + esc(c.numero) + " · " : ""}${esc(c.titulo || "(sem título)")}</h3>
      <button type="button" class="btn-sec" id="btn-cham-fechar">×</button>
    </div>
    <div class="cham-contexto">
      <span class="chip">Status: ${chamTag(c.status)}</span>
      ${c.status === "aguardando_validacao" && c.aguardando_de ? `<span class="chip${chamPrazoVencido(c) ? " txt-perigo" : ""}"><strong>${esc(chamEsperaTxt(c))}</strong>${chamPrazoVencido(c) ? " · prazo vencido" : ""}</span>` : ""}
      ${c.status === "resolvido" && c.resolvido_em ? `<span class="chip">Resolvido em <strong>${esc(chamDataHora(c.resolvido_em))}</strong></span>` : ""}
      ${chamConfirmacao(c) === "autor" ? `<span class="chip">Confirmado pelo autor em <strong>${esc(chamDataHora(c.confirmado_em).slice(0, 5))}</strong></span>` : ""}
      ${chamConfirmacao(c) === "prazo" ? `<span class="chip"><span class="meta">Confirmado por prazo (7 dias sem reabertura)</span></span>` : ""}
      ${chamConfirmacao(c) === "pendente" ? `<span class="chip">Aguardando confirmação do autor</span>` : ""}
      ${c.reaberto_n ? `<span class="chip">Reaberto <strong>${esc(c.reaberto_n)}×</strong></span>` : ""}
      <span class="chip">Categoria: <strong>${esc(cat.label)}</strong>${cat.validacao ? " · exige validação" : ""}</span>
      <span class="chip">Módulo: <strong>${esc(chamModuloLabel(c.modulo))}</strong></span>
      ${c.obra_id ? `<span class="chip">Obra: <strong>${linkObra(c.obra_id, mapaObras[c.obra_id] || c.obra_id)}</strong></span>` : ""}
      ${c.registro_tipo ? `<span class="chip">Registro: <strong>${esc(c.registro_tipo)}</strong> ${abreRegistro ? `<button type="button" class="btn-sec btn-sm" id="btn-cham-abrir-registro">abrir</button>` : ""}</span>` : ""}
      <span class="chip">Aberto por <strong>${esc(chamAutor(c[CHAM_COL.abertoPor], c.origem))}</strong> em ${esc(chamDataHora(c[CHAM_COL.criado]))}</span>
    </div>
    ${chamChipsBacklog(c, podeTriar)}
    <div class="cham-status-bar" id="cham-status-bar">${stages}</div>
    ${chamBlocoEspera(c, ehAutor, podeTriar)}
    ${cat.dica ? `<p class="nota">${esc(cat.dica)}</p>` : ""}
    <div class="campo largo"><label>Descrição</label><div class="cham-desc" style="font-size:var(--txt-sm);color:var(--txt);">${esc(c.descricao || "—")}</div></div>
    <h4 class="titulo-bloco" style="margin-top:14px;">📎 Anexos (${_chamAnexos.length})</h4>
    <div id="cham-anexos">${_chamAnexos.length ? _chamAnexos.map(a => `<div class="cham-anexo">
      <button type="button" class="btn-sec btn-sm btn-cham-anexo" data-path="${esc(a.storage_path)}" data-nome="${esc(a.nome)}" title="Baixar">⬇ ${esc(a.nome)}</button>
      <span class="meta">${esc(chamTamanho(a.tamanho_bytes))} · ${esc(chamNome(a.enviado_por))} · ${esc(chamDataHora(a.criado_em))}</span>
    </div>`).join("") : `<p class="vazio">Nenhum anexo visível. Os anexos só aparecem para quem enviou, para quem abriu o chamado e para a diretoria.</p>`}</div>
    <div class="cham-anexo-novo"><input type="file" id="cham-anexo-novo" multiple accept="${esc(CHAM_ANEXO_ACCEPT)}" />
      <button type="button" class="btn-sec btn-sm" id="btn-cham-anexar">📎 Anexar ao chamado</button></div>
    <h4 class="titulo-bloco" style="margin-top:14px;">Andamento (${_chamComentarios.length})</h4>
    ${erroComentarios ? `<p class="vazio">Não foi possível ler os comentários: ${esc(erroComentarios)}</p>` : ""}
    <div id="cham-comentarios">${_chamComentarios.length ? _chamComentarios.map((k, i) => {
      const txt = k.texto || "";
      const cls = /^\[status\]/i.test(txt) ? " sistema" : /^\[resolu[cç][aã]o\]/i.test(txt) ? " resolucao" : "";
      // fase 64: prefixos da triagem viram tag; o texto da [resposta sugerida] pode ser aprovado pela gestão
      // lote S47: [pergunta], [reaberto] e [decisão] também viram tag; "[sugere: x]" vira "ao aprovar: X"
      // lote S55: [confirmado] (o "Funcionou" do autor) vira tag verde
      const PREF_RE = /^\[(triagem|duplicado de #?\d+|resposta sugerida|pergunta|reaberto|decis[aã]o|confirmado)\]\s*/i;
      const pref = txt.match(PREF_RE);
      const corpo = txt.replace(/^\[(status|resolu[cç][aã]o)\]\s*/i, "").replace(PREF_RE, "");
      const sugerida = chamRespostaSugerida(txt);
      const corpoHtml = esc(corpo).replace(/^\[resposta sugerida\]/im, '<span class="tag verde">resposta sugerida</span>')
        .replace(/\[sugere:\s*([a-z_]+)\]/gi, (_m, st) => `<span class="tag cinza">ao aprovar: ${esc(CHAM_SUGERE[st.toLowerCase()] || st)}</span>`);
      const corPref = (p) => /^(resposta|confirmado)/i.test(p) ? "verde" : /^duplicado/i.test(p) ? "cinza" : /^(pergunta|reaberto)/i.test(p) ? "ambar" : "azul";
      // o botão antigo "Aprovar resposta" só existe antes da migration do lote S47 (depois, o bloco "Esperando" aprova)
      return `<div class="cham-comentario${cls}"><div class="meta">${esc(chamAutor(k[CHAM_COL.autor], k.origem))} · ${esc(chamDataHora(k[CHAM_COL.criado]))}</div>${pref ? `<span class="tag ${corPref(pref[1])}">${esc(pref[1].toLowerCase())}</span> ` : ""}<div style="white-space:pre-wrap;">${corpoHtml}</div>${sugerida && podeTriar && !chamFechado(c.status) && !chamTemEspera(c) && !chamSomenteLeitura() ? `<button type="button" class="btn-sec btn-sm btn-cham-aprovar" data-idx="${i}" title="Copia a resposta sugerida como comentário seu e resolve o chamado">✅ Aprovar resposta</button>` : ""}</div>`;
    }).join("") : `<p class="vazio">Sem comentários ainda. A triagem diária (18h) registra aqui o andamento.</p>`}</div>
    <div class="campo largo" style="margin-top:10px;"><label>Comentar</label><textarea id="cham-novo-comentario" rows="3" placeholder="${podeTriar ? "Registre a triagem, a decisão ou a resolução. Prefixe com [resolução] para destacar." : "Complemente o chamado (mais detalhes, prints descritos, o que mudou)."}"></textarea></div>
    <div id="cham-ficha-aviso" class="aviso"></div>
    <div class="form-acoes compacta">
      <button type="button" class="btn" id="btn-cham-comentar">Enviar comentário</button>
      ${(podeTriar && c.status !== "resolvido") ? `<button type="button" class="btn btn-sucesso" id="btn-cham-resolver" title="Grava o comentário como [resolução] e marca o chamado como resolvido">✅ Resolver com este comentário</button>` : ""}
    </div>`;

  $("btn-cham-fechar").addEventListener("click", fecharChamado);
  box.querySelectorAll(".btn-cham-anexo").forEach(b => b.addEventListener("click", () => chamBaixarAnexo(b.dataset.path, b.dataset.nome)));
  $("btn-cham-anexar")?.addEventListener("click", () => comBotaoTravado("btn-cham-anexar", chamAnexarNaFicha));
  $("btn-cham-comentar").addEventListener("click", () => comentarChamado(false));
  $("btn-cham-resolver")?.addEventListener("click", () => comentarChamado(true));
  $("btn-cham-abrir-registro")?.addEventListener("click", () => { fecharChamado(); CHAM_ABRIR_REGISTRO[c.registro_tipo](c.registro_id); });
  // fase 64: chips de backlog salvam um a um; "Aprovar resposta" reaproveita o fluxo de resolver
  box.querySelectorAll("[data-cham-campo]").forEach(el => el.addEventListener("change", () => comBotaoTravado(el, () => chamSalvarCampo(el.dataset.chamCampo, el.value))));
  box.querySelectorAll(".btn-cham-aprovar").forEach(b => b.addEventListener("click", () => {
    const ta = $("cham-novo-comentario");
    if(!ta) return;
    ta.value = chamRespostaSugerida(_chamComentarios[Number(b.dataset.idx)]?.texto || "");
    comBotaoTravado(b, () => comentarChamado(true));
  }));
  box.querySelectorAll("#cham-status-bar .stage").forEach(el => {
    if(el.getAttribute("aria-disabled") === "true" || el.classList.contains("atual")) return;
    // lote S47: "Esperando resposta" exige destinatário e prazo → abre o "Perguntar a…" em vez de mudar direto
    if(el.dataset.status === "aguardando_validacao" && chamTemEspera(c)){
      el.addEventListener("click", () => { const d = $("cham-perguntar"); if(d){ d.open = true; $("cham-perg-texto")?.focus(); } });
      return;
    }
    el.addEventListener("click", () => mudarStatusChamado(el.dataset.status));
  });
  // lote S47: aprovar / editar / responder, reabrir e perguntar
  $("btn-cham-aprovar-enviar")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, () => chamAprovarEspera(false)));
  $("btn-cham-aprovar-editar")?.addEventListener("click", () => {
    const w = $("cham-aprovar-edicao"); if(!w) return;
    w.style.display = ""; $("cham-aprovar-texto")?.focus();
  });
  $("btn-cham-aprovar-editado")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, () => chamAprovarEspera(true)));
  // lote S55: "✅ Funcionou" confirma; "↩️ Ainda não" primeiro abre a caixa do motivo, depois reabre
  $("btn-cham-confirmar")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, chamConfirmarChamado));
  $("btn-cham-reabrir")?.addEventListener("click", (e) => {
    const w = $("cham-reabrir-wrap");
    if(w && w.style.display === "none"){ w.style.display = ""; $("cham-reabrir-texto")?.focus(); return; }
    comBotaoTravado(e.currentTarget, chamReabrirChamado);
  });
  $("btn-cham-perguntar")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, chamPerguntarChamado));
  $("cham-perg-de")?.addEventListener("change", chamAtualizarPerguntarUsuario);
}
/* Lote S47: bloco abaixo da statusbar.
   - Esperando resposta: quem é, até quando, a pergunta; para quem está esperado, "Aprovar e enviar" / "Editar"
     (com resposta sugerida) ou "Responder e enviar" (sem resposta sugerida). Ao enviar, aplica o status sugerido.
   - Resolvido há menos de 7 dias: o autor vê "Não resolveu" (reabre com comentário obrigatório).
   - Diretoria: "Perguntar a…" (autor, diretoria ou um usuário; texto; status ao aprovar). */
function chamBlocoEspera(c, ehAutor, podeTriar){
  if(!chamTemEspera(c)) return "";
  const leitura = chamSomenteLeitura();
  let html = "";
  if(c.status === "aguardando_validacao"){
    const perg = chamPerguntaAtual();
    const minha = chamEsperaMinha(c) && !leitura;
    const vai = CHAM_SUGERE[c.aguardando_sugere || "em_analise"] || "Em análise";
    html += `<div class="cham-espera${chamPrazoVencido(c) ? " vencido" : ""}">
      <div><strong>${esc(chamEsperaTxt(c))}</strong>${chamPrazoVencido(c) ? ' <span class="tag vermelho">prazo vencido</span>' : ""}</div>
      ${perg ? `<div class="cham-espera-perg"><span class="tag ${perg.sugerida ? "verde" : "ambar"}">${perg.sugerida ? "resposta sugerida" : "pergunta"}</span> ${esc(perg.texto)}</div>` : `<div class="meta">Sem pergunta registrada: veja o andamento abaixo.</div>`}
      ${minha ? (perg && perg.sugerida ? `
        <div class="form-acoes compacta">
          <button type="button" class="btn btn-sucesso" id="btn-cham-aprovar-enviar" title="Envia a resposta sugerida em seu nome e muda o chamado para ${esc(vai)}">✅ Aprovar e enviar</button>
          <button type="button" class="btn-sec" id="btn-cham-aprovar-editar">✏️ Editar</button>
          <span class="meta">Ao enviar, o chamado vai para <strong>${esc(vai)}</strong>.</span>
        </div>
        <div id="cham-aprovar-edicao" style="display:none;">
          <textarea id="cham-aprovar-texto" rows="4">${esc(perg.texto)}</textarea>
          <div class="form-acoes compacta"><button type="button" class="btn" id="btn-cham-aprovar-editado">Enviar resposta editada</button></div>
        </div>` : `
        <div id="cham-aprovar-edicao">
          <textarea id="cham-aprovar-texto" rows="3" placeholder="Sua resposta (anexe o arquivo pedido em 📎 Anexos, se for o caso)"></textarea>
          <div class="form-acoes compacta"><button type="button" class="btn" id="btn-cham-aprovar-editado">Responder e enviar</button>
            <span class="meta">Ao enviar, o chamado vai para <strong>${esc(vai)}</strong>.</span></div>
        </div>`) : ""}
    </div>`;
  }
  if(ehAutor && !leitura && chamResolvidoRecente(c) && !c.confirmado_em){
    const ate = new Date(new Date(c.resolvido_em).getTime() + CHAM_REABRIR_DIAS * 86400000);
    // lote S55 (#185): com a coluna confirmado_em no banco, "✅ Funcionou" e "↩️ Ainda não" lado a lado; a caixa do motivo
    // só aparece ao clicar "Ainda não" (segundo clique reabre, texto obrigatório). Antes da migration, o fluxo da S47.
    const comConfirmacao = chamTemConfirmacao(c);
    html += `<div class="cham-espera">
      <div><strong>Confira a correção.</strong> ${comConfirmacao ? "Funcionou? Confirme aqui. Se não ficou certo, você pode reabrir" : "Se não ficou certo, você pode reabrir"} até ${esc(ate.toLocaleDateString("pt-BR"))}.</div>
      <div id="cham-reabrir-wrap" ${comConfirmacao ? 'style="display:none;"' : ""}>
        <textarea id="cham-reabrir-texto" rows="2" placeholder="O que continua errado? (obrigatório)"></textarea>
      </div>
      <div class="form-acoes compacta">
        ${comConfirmacao ? `<button type="button" class="btn btn-sucesso" id="btn-cham-confirmar" title="Registra que a correção funcionou e tira o chamado da sua fila">✅ Funcionou</button>` : ""}
        <button type="button" class="btn-sec" id="btn-cham-reabrir">${comConfirmacao ? "↩️ Ainda não" : "↩️ Não resolveu"}</button>
      </div>
    </div>`;
  }
  if(podeTriar && !leitura && !chamFechado(c.status)){
    const autorNome = c[CHAM_COL.abertoPor] ? chamNome(c[CHAM_COL.abertoPor]) : null;
    html += `<details class="cham-espera cham-perguntar" id="cham-perguntar">
      <summary>❓ Perguntar a…</summary>
      <div class="grade">
        <div class="campo"><label for="cham-perg-de">Quem responde</label>
          <select id="cham-perg-de">
            ${autorNome ? `<option value="autor">Autor (${esc(autorNome)})</option>` : ""}
            <option value="diretoria">Diretoria</option>
            <option value="usuario">Outra pessoa…</option>
          </select></div>
        <div class="campo" id="cham-perg-usuario-campo" style="display:none;"><label for="cham-perg-usuario">Pessoa</label>
          <select id="cham-perg-usuario"><option value="">Carregando…</option></select></div>
        <div class="campo"><label for="cham-perg-sugere">Ao aprovar, vai para</label>
          <select id="cham-perg-sugere">${Object.entries(CHAM_SUGERE).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div>
        <div class="campo largo"><label for="cham-perg-texto">Pergunta ou resposta sugerida</label>
          <textarea id="cham-perg-texto" rows="3" placeholder="Pergunta: o que falta para seguir. Para uma resposta pronta que a pessoa só aprova, comece com [resposta sugerida]."></textarea></div>
      </div>
      <div class="form-acoes compacta"><button type="button" class="btn" id="btn-cham-perguntar">Perguntar</button>
        <span class="meta">Prazo: 5 dias úteis. Entra na Minha fila de quem responde.</span></div>
    </details>`;
  }
  return html;
}
let _chamUsuariosAtivos = null;
async function chamAtualizarPerguntarUsuario(){
  const usar = $("cham-perg-de")?.value === "usuario";
  const campo = $("cham-perg-usuario-campo");
  if(campo) campo.style.display = usar ? "" : "none";
  if(!usar || _chamUsuariosAtivos) return;
  const { data, error } = await sb.from("profiles").select("id,nome").eq("ativo", true).order("nome");
  _chamUsuariosAtivos = error ? [] : (data || []);
  _chamUsuariosAtivos.forEach(p => { _chamPerfis[p.id] = p.nome; });
  const sel = $("cham-perg-usuario");
  if(sel) sel.innerHTML = `<option value="">— escolha —</option>` + _chamUsuariosAtivos.map(p => `<option value="${esc(p.id)}">${esc(p.nome || "—")}</option>`).join("");
}
async function chamDepoisDaRpc(id){
  await carregarChamados(true);
  await abrirChamado(id);
  if(typeof dashCarregarFila === "function") dashCarregarFila();
}
async function chamAprovarEspera(editado){
  const c = _chamAberto;
  if(!c) return;
  const texto = editado ? ($("cham-aprovar-texto")?.value || "").trim() : null;
  if(editado && !texto){ aviso("cham-ficha-aviso", "Escreva a resposta.", "erro"); return; }
  const { data, error } = await sb.rpc("chamado_aprovar", { p_id: c.id, p_texto: texto });
  if(error){ aviso("cham-ficha-aviso", "Não foi possível enviar: " + error.message, "erro"); return; }
  await chamDepoisDaRpc(c.id);
  aviso("cham-ficha-aviso", `Resposta enviada. Chamado em ${CHAM_STATUS[data]?.label || data}.`, "ok");
}
// lote S55 (#185): o autor confirma que a correção funcionou (RPC chamado_confirmar: só o autor, até 7 dias, uma vez)
async function chamConfirmarChamado(){
  const c = _chamAberto;
  if(!c) return;
  const { error } = await sb.rpc("chamado_confirmar", { p_id: c.id, p_texto: null });
  if(error){ aviso("cham-ficha-aviso", "Não foi possível confirmar: " + error.message, "erro"); return; }
  await chamDepoisDaRpc(c.id);
  aviso("cham-ficha-aviso", "Obrigado! Confirmação registrada.", "ok");
}
async function chamReabrirChamado(){
  const c = _chamAberto;
  const texto = ($("cham-reabrir-texto")?.value || "").trim();
  if(!c) return;
  if(!texto){ aviso("cham-ficha-aviso", "Diga o que não ficou certo para reabrir.", "erro"); $("cham-reabrir-texto")?.focus(); return; }
  const { error } = await sb.rpc("chamado_reabrir", { p_id: c.id, p_texto: texto });
  if(error){ aviso("cham-ficha-aviso", "Não foi possível reabrir: " + error.message, "erro"); return; }
  await chamDepoisDaRpc(c.id);
  aviso("cham-ficha-aviso", "Chamado reaberto. A triagem olha de novo.", "ok");
}
async function chamPerguntarChamado(){
  const c = _chamAberto;
  if(!c) return;
  const de = $("cham-perg-de")?.value || "";
  const deId = de === "usuario" ? ($("cham-perg-usuario")?.value || "") : "";
  const texto = ($("cham-perg-texto")?.value || "").trim();
  if(de === "usuario" && !deId){ aviso("cham-ficha-aviso", "Escolha a pessoa que responde.", "erro"); return; }
  if(!texto){ aviso("cham-ficha-aviso", "Escreva a pergunta.", "erro"); $("cham-perg-texto")?.focus(); return; }
  const { data, error } = await sb.rpc("chamado_perguntar", { p_id: c.id, p_de: de, p_de_id: deId || null, p_texto: texto,
    p_sugestao_status: $("cham-perg-sugere")?.value || null });
  if(error){ aviso("cham-ficha-aviso", "Não foi possível perguntar: " + error.message, "erro"); return; }
  await chamDepoisDaRpc(c.id);
  aviso("cham-ficha-aviso", data === "aguardando_validacao" ? "Pergunta registrada. Prazo de 5 dias úteis."
    : `Chamado aberto pela diretoria: a recomendação vale como decidida (${CHAM_STATUS[data]?.label || data}).`, "ok");
}
function fecharChamado(){
  $("cham-modal").style.display = "none";
  _chamAberto = null; _chamComentarios = []; _chamAnexos = [];
}
/* ---------- Backlog (fase 64): prioridade, esforço, faixa, fase e PR ---------- */
function chamChipsBacklog(c, podeTriar){
  if(!podeTriar){
    if(c.prioridade == null && !c.fase && !c.pr_url) return "";
    return `<div class="cham-contexto">
      ${c.prioridade != null ? `<span class="chip">Prioridade: ${chamTagPrioridade(c.prioridade, true)}</span>` : ""}
      ${c.esforco ? `<span class="chip">Esforço: <strong>${esc(CHAM_ESFORCO[c.esforco] || c.esforco)}</strong></span>` : ""}
      ${c.faixa ? `<span class="chip">Faixa: <strong>${esc(CHAM_FAIXA[c.faixa] || c.faixa)}</strong></span>` : ""}
      ${c.fase ? `<span class="chip">Fase: <strong>${esc(c.fase)}</strong></span>` : ""}
      ${c.pr_url ? `<span class="chip">PR: <strong>${chamLinkPR(c.pr_url)}</strong></span>` : ""}
    </div>`;
  }
  const opts = (mapa, atual) => `<option value="">—</option>` + Object.entries(mapa).map(([v, o]) => `<option value="${esc(v)}"${String(atual ?? "") === v ? " selected" : ""}>${esc(typeof o === "string" ? o : o.label)}</option>`).join("");
  return `<div class="cham-contexto" id="cham-backlog">
    <span class="chip">Prioridade <select id="cham-prioridade" data-cham-campo="prioridade" class="btn-sm">${opts(CHAM_PRIORIDADE, c.prioridade)}</select></span>
    <span class="chip">Esforço <select id="cham-esforco" data-cham-campo="esforco" class="btn-sm">${opts(CHAM_ESFORCO, c.esforco)}</select></span>
    <span class="chip">Faixa <select id="cham-faixa" data-cham-campo="faixa" class="btn-sm">${opts(CHAM_FAIXA, c.faixa)}</select></span>
    <span class="chip">Fase <input id="cham-fase" data-cham-campo="fase" value="${esc(c.fase || "")}" placeholder="ex.: lote-S41" size="9" /></span>
    <span class="chip">PR <input id="cham-pr" data-cham-campo="pr_url" value="${esc(c.pr_url || "")}" placeholder="link do PR" size="18" />${c.pr_url ? " " + chamLinkPR(c.pr_url) : ""}</span>
    ${c.triado_em ? `<span class="chip meta">Triado em ${esc(chamDataHora(c.triado_em))}</span>` : ""}
  </div>`;
}
async function chamSalvarCampo(campo, valor){
  const c = _chamAberto;
  if(!c || !["prioridade","esforco","faixa","fase","pr_url"].includes(campo)) return;
  let v = String(valor ?? "").trim() || null;
  if(campo === "prioridade" && v != null) v = Number(v);
  if(campo === "pr_url" && v && !/^https?:\/\//i.test(v)){ aviso("cham-ficha-aviso", "O PR precisa ser um link (https://…).", "erro"); return; }
  const { data: mudou, error } = await sb.from(CHAM_TBL.chamados).update({ [campo]: v }).eq("id", c.id).select("id");
  if(error){ aviso("cham-ficha-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  if(!mudou?.length){ aviso("cham-ficha-aviso", "Sem permissão para alterar este chamado.", "erro"); return; }
  c[campo] = v;
  aviso("cham-ficha-aviso", "Salvo.", "ok");
  renderChamados();
}
// texto a partir de "[resposta sugerida]" (pode vir no meio do comentário da triagem)
function chamRespostaSugerida(txt){
  const m = String(txt || "").match(/\[resposta sugerida\]\s*([\s\S]+)$/i);
  return m ? m[1].replace(/\s*\[sugere:[^\]]*\]/gi, "").trim() : "";   // lote S47: "[sugere: x]" não vai na resposta
}
async function mudarStatusChamado(novo){
  const c = _chamAberto;
  if(!c || !CHAM_STATUS[novo] || novo === c.status) return;
  const anterior = c.status;
  // lote S39 (#11 #12): update barrado pela policy volta sem erro e sem linha; sem o select o front não percebia
  const { data: mudou, error } = await sb.from(CHAM_TBL.chamados).update({ status: novo }).eq("id", c.id).select("id");
  if(error){ aviso("cham-ficha-aviso", "Não foi possível mudar o status: " + error.message, "erro"); return; }
  if(!mudou?.length){ aviso("cham-ficha-aviso", "Sem permissão para mudar o status deste chamado.", "erro"); return; }
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
    const { data: mudou, error: e2 } = await sb.from(CHAM_TBL.chamados).update({ status: "resolvido" }).eq("id", c.id).select("id");
    if(e2){ aviso("cham-ficha-aviso", "Comentário gravado, mas o status não mudou: " + e2.message, "erro"); }
    else if(!mudou?.length){ aviso("cham-ficha-aviso", "Comentário gravado, mas você não tem permissão para mudar o status deste chamado.", "erro"); }
    else c.status = "resolvido";
  }
  await abrirChamado(c.id);
  renderChamados(); atualizarBadgeChamados();
}

/* ---------- Anexos (fase 48, 21/09/2026) ----------
   Caminho no bucket: <usuario>/<chamado>/<timestamp>_<rand>.<ext> — a 1ª pasta é o id de quem enviou
   (é o que a policy do storage confere). O MIME vai pela extensão: o navegador manda octet-stream
   ou vazio para .xlsm/.csv em algumas máquinas e o bucket recusaria. */
function chamTamanho(bytes){
  const b = Number(bytes) || 0;
  return b >= 1048576 ? (b / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
}
function chamExtensao(nome){ return (String(nome || "").split(".").pop() || "").toLowerCase(); }
function chamValidarAnexos(arquivos){
  if(!arquivos.length) return null;
  if(arquivos.length > CHAM_ANEXO_MAX) return `Anexe no máximo ${CHAM_ANEXO_MAX} arquivos por vez.`;
  for(const f of arquivos){
    if(!CHAM_ANEXO_MIME[chamExtensao(f.name)]) return `"${f.name}": tipo não aceito. Use PDF, Excel (.xlsx/.xls/.xlsm), CSV, Word, TXT ou imagem.`;
    if(f.size > CHAM_ANEXO_MAX_BYTES) return `"${f.name}" tem ${chamTamanho(f.size)}; o limite é 20 MB por arquivo.`;
  }
  return null;
}
/* Envia os arquivos e registra em chamado_anexos. Devolve a lista de falhas (nome: motivo). */
async function chamEnviarAnexos(chamadoId, arquivos){
  const falhas = [];
  for(const f of arquivos){
    const ext = chamExtensao(f.name);
    const caminho = `${usuarioAtual.id}/${chamadoId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const mime = CHAM_ANEXO_MIME[ext];
    // supabase-js ignora `contentType` quando o corpo é File/Blob (vale o type do próprio arquivo): reembala com o MIME da extensão
    const corpo = f.type === mime ? f : new Blob([f], { type: mime });
    const up = await sb.storage.from(CHAM_ANEXO_BUCKET).upload(caminho, corpo, { cacheControl: "3600", contentType: mime, upsert: false });
    if(up.error){ falhas.push(`${f.name}: ${up.error.message}`); continue; }
    const ins = await sb.from(CHAM_TBL.anexos).insert({ chamado_id: chamadoId, nome: f.name, storage_path: caminho, mime_type: mime, tamanho_bytes: f.size, enviado_por: usuarioAtual.id });
    if(ins.error){
      await sb.storage.from(CHAM_ANEXO_BUCKET).remove([caminho]); // não deixa arquivo órfão
      falhas.push(`${f.name}: ${ins.error.message}`);
    }
  }
  return falhas;
}
async function chamBaixarAnexo(caminho, nome){
  const { data, error } = await sb.storage.from(CHAM_ANEXO_BUCKET).createSignedUrl(caminho, 120, { download: nome || true });
  if(error || !data?.signedUrl){ aviso("cham-ficha-aviso", "Não foi possível baixar o anexo: " + (error?.message || "sem permissão"), "erro"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
async function chamAnexarNaFicha(){
  const c = _chamAberto, inp = $("cham-anexo-novo");
  if(!c || !inp || !usuarioAtual) return;
  const arquivos = [...(inp.files || [])];
  if(!arquivos.length){ aviso("cham-ficha-aviso", "Escolha o arquivo antes de anexar.", "erro"); return; }
  const erro = chamValidarAnexos(arquivos);
  if(erro){ aviso("cham-ficha-aviso", erro, "erro"); return; }
  const falhas = await chamEnviarAnexos(c.id, arquivos);
  const enviados = arquivos.length - falhas.length;
  if(enviados){
    // trilha: o anexo vira um comentário de sistema, para a triagem ver que chegou material novo
    await sb.from(CHAM_TBL.comentarios).insert({ chamado_id: c.id, [CHAM_COL.autor]: usuarioAtual.id,
      texto: `[status] anexou ${enviados} arquivo(s): ${arquivos.filter(f => !falhas.some(x => x.startsWith(f.name + ":"))).map(f => f.name).join(", ")}` });
  }
  await abrirChamado(c.id);
  if(falhas.length) aviso("cham-ficha-aviso", "Não foi possível anexar: " + falhas.join(" · "), "erro");
  else aviso("cham-ficha-aviso", `${enviados} arquivo(s) anexado(s).`, "ok");
}

/* ---------- Novo chamado / Relatar problema ou melhoria ----------
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
  selCat.innerHTML = Object.entries(CHAM_CATEGORIA).map(([v, o]) => `<option value="${esc(v)}">${esc(o.label)}</option>`).join("");
  selCat.value = "codigo";
  const selObra = $("chamn-obra");
  const obras = Object.entries(mapaObras).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  selObra.innerHTML = `<option value="">— nenhuma —</option>` + obras.map(o => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join("");
  selObra.value = c.obra_id || "";
  $("chamn-titulo").value = "";
  $("chamn-titulo").placeholder = "ex.: Import do boletim não trouxe os trechos de solo · ou: seria útil filtrar RDOs por máquina";
  $("chamn-descricao").value = "";
  if($("chamn-anexos")){ $("chamn-anexos").value = ""; $("chamn-anexos").accept = CHAM_ANEXO_ACCEPT; }
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
  const arquivos = [...($("chamn-anexos")?.files || [])];
  const erroAnexo = chamValidarAnexos(arquivos); // valida ANTES de criar, para não abrir chamado sem o anexo prometido
  if(erroAnexo){ aviso("chamn-aviso", erroAnexo, "erro"); return; }
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
  let { data, error } = await sb.from(CHAM_TBL.chamados).insert(reg).select("*").single();
  // A check constraint de categoria no banco (migration 42c) ainda não conhece 'melhoria':
  // grava como 'estrutura' com o título prefixado, para o chamado não se perder.
  if(error && reg.categoria === "melhoria" && /categoria|check constraint/i.test(error.message || "")){
    ({ data, error } = await sb.from(CHAM_TBL.chamados).insert({ ...reg, categoria: "estrutura", titulo: "[Melhoria] " + reg.titulo }).select("*").single());
  }
  btn.disabled = false;
  if(error){
    aviso("chamn-aviso", chamErroTabela(error)
      ? "O módulo de chamados ainda não tem as tabelas no banco (migration pendente). Avise a diretoria pelo WhatsApp por enquanto."
      : "Não foi possível abrir o chamado: " + error.message, "erro");
    return;
  }
  let falhasAnexo = [];
  if(arquivos.length && data?.id){
    btn.disabled = true; btn.textContent = "Enviando anexos…";
    falhasAnexo = await chamEnviarAnexos(data.id, arquivos);
    btn.disabled = false; btn.textContent = "Abrir chamado";
  }
  fecharNovoChamado();
  aviso("app-aviso", `✅ Chamado ${data?.numero != null ? "#" + data.numero + " " : ""}aberto. A triagem diária às 18h dá o retorno no próprio chamado.`, "ok");
  await carregarChamados(true);
  if(falhasAnexo.length) aviso("app-aviso", `Chamado aberto, mas ${falhasAnexo.length} anexo(s) não subiram: ${falhasAnexo.join(" · ")}. Abra o chamado e anexe de novo.`, "erro");
}

/* ---------- Listeners ---------- */
function ligarChamados(){
  // Os modais nascem dentro de <section id="sec-chamados">, que fica display:none fora dessa tela.
  // O botao "Relatar problema" e global (topbar), entao o modal precisa viver fora das secoes
  // - senao abre invisivel (bug relatado em 14/09/2026).
  ["cham-novo-modal", "cham-modal"].forEach(id => { const m = $(id); if(m && m.closest(".secao")) document.body.appendChild(m); });
  document.querySelector('.sidebar-nav button[data-secao="chamados"]')?.addEventListener("click", () => carregarChamados(true));
  $("btn-cham-atualizar")?.addEventListener("click", () => carregarChamados(false));
  $("btn-cham-novo")?.addEventListener("click", () => abrirNovoChamado({ modulo: "chamados", modulo_label: "Chamados" }));
  $("btn-reportar-problema")?.addEventListener("click", () => abrirNovoChamado(chamadosContextoAtual()));
  $("btn-chamn-fechar")?.addEventListener("click", fecharNovoChamado);
  $("btn-chamn-criar")?.addEventListener("click", () => comBotaoTravado("btn-chamn-criar", criarChamado));
  $("chamn-categoria")?.addEventListener("change", atualizarNotaCategoriaChamado);
  ["cham-busca","cham-f-status","cham-f-prioridade","cham-f-categoria","cham-f-obra","cham-f-meus"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "cham-busca" ? "input" : "change", renderChamados);
  });
  document.querySelectorAll("#sec-chamados .ind-click[data-cham-status]").forEach(k => {
    k.addEventListener("click", () => {
      const f = $("cham-f-status");
      if(!f) return;
      // lote S47: antes da migration não há destinatário; "esperando minha resposta" cai no status puro
      const v = k.dataset.chamStatus;
      f.value = v === "minha_resposta" && !_chamados.some(chamTemEspera) ? "aguardando_validacao" : v;
      renderChamados();
    });
  });
  $("cham-conteudo")?.addEventListener("click", (e) => {
    // fase 64: marcar para planejar não abre a ficha
    const cb = e.target.closest(".cham-sel");
    if(cb){ cb.checked ? _chamSel.add(cb.dataset.id) : _chamSel.delete(cb.dataset.id); chamAtualizarBarraPlanejar(); return; }
    if(e.target.id === "cham-sel-todos"){
      chamadosFiltrados().forEach(c => e.target.checked ? _chamSel.add(c.id) : _chamSel.delete(c.id));
      renderChamados(); return;
    }
    const tr = e.target.closest(".linha-clicavel");
    if(tr && tr.dataset.id) abrirChamado(tr.dataset.id);
  });
  $("btn-cham-planejar")?.addEventListener("click", () => comBotaoTravado("btn-cham-planejar", chamPlanejarSelecionados));
  $("cham-planejar-fase")?.addEventListener("keydown", (e) => { if(e.key === "Enter") comBotaoTravado("btn-cham-planejar", chamPlanejarSelecionados); });
  $("btn-cham-planejar-limpar")?.addEventListener("click", () => { _chamSel.clear(); renderChamados(); });
  document.querySelector("#sec-chamados .ind-click[data-cham-prioridade]")?.addEventListener("click", () => {
    const fp = $("cham-f-prioridade"), fs = $("cham-f-status");
    if(fp) fp.value = "1"; if(fs) fs.value = "";
    renderChamados();
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

/* ====================================================================
   Módulo: Obras
   Layout: padrão Serviços (painel + ficha) + Odoo (statusbar, header
   actions, notebook). Ver memória feedback-padrao-ui.
   Cadastro, listagem, edição, exclusão.
   ==================================================================== */

let _obrRegistros = [];   // cache da lista (filtros client-side)
let _obrView      = "lista";
let obraEditId    = null; // null = nova; uuid = editando
let _obrContrato  = null; // contrato do cliente vinculado à obra aberta (fase 21)
let _obrContratoPend = []; // pendências do contrato da obra aberta (fase 26)
let _obrPendMap   = {};   // contrato_id -> [pendências] (badge na lista, fase 26)
let _obrFiltroIds = null; // { ids:Set, rotulo, aba, foco } — lista vinda do "Para regularizar" (fase 75)
let _obrAberta    = null; // fase 163: a obra da ficha aberta, como veio do banco (a faixa de 14 dias da aba RDOs lê status, início, UF, município e jornada de sábado)
let _obrEtq       = {};   // fase 182a: id -> linha da vw_obras_etiqueta (etiqueta, nome do projeto, cliente, obra para, grupo)

/* Etapas do statusbar (ordem do enum obra_status) */
const OBR_STAGES = ["planejada","em_andamento","paralisada","concluida"];

/* Config dos anexos do contrato dentro da ficha da obra (ver contratos.js) */
const OBR_CON_DOC_CONF = {
  container: "obr-con-doc-conteudo",
  prefixo:   "obr-con-doc",
  smartBtn:  null,
  msgSemPai: "Preencha o número do contrato e salve a obra para anexar o contrato assinado.",
  natureza:  "cliente",   // hotfix 98: engenheiro e assistente anexam (conPodeAnexar em contratos.js)
  aditivos:  true         // hotfix 98: aditivos do contrato, só leitura, acima dos anexos
};

/* Fase 90 (áudios do Julio, 18/10/2026): o valor contratado saiu de obras e vive em obras_financeiro, que no banco só
   pode_ler_financeiro() lê. Na lista ele vem como coluna da view (left join) e na ficha como embed `financeiro`; para
   quem não lê chega nulo e a tela nem desenha coluna, chip ou campo (podeVerValorObra, core.js). */
function obrValor(o){ return Number((o && (o.financeiro ? o.financeiro.valor_contratado : o.valor_contratado)) || 0); }   // obras_financeiro: embed na ficha, coluna da view na lista

/* ---------- Carga ---------- */
const OBR_COLS_LISTA = "id,codigo,nome,cliente_id,contrato_id,status,valor_contratado,data_inicio,data_fim_prevista,responsavel_id,cidade,uf";   // valor_contratado: coluna da view lida de obras_financeiro (fase 90)
async function carregarObras(){
  // lote S56c (#174): término da obra (real > previsto > calculado) vem da view; banco sem a migration → lê como antes
  let { data, error } = await sb.from("vw_obras_controle")
    .select(OBR_COLS_LISTA + ",data_termino,termino_origem")
    .order("codigo");
  if(error && /data_termino|termino_origem|column/i.test(error.message || "")){
    ({ data, error } = await sb.from("vw_obras_controle").select(OBR_COLS_LISTA).order("codigo"));
  }
  if(error){
    _obrRegistros = [];
  } else {
    _obrRegistros = data || [];
    mapaObras = {};
    _obrRegistros.forEach(o => mapaObras[o.id] = `${o.codigo} — ${o.nome}`);
  }
  await Promise.all([carregarPendenciasObras(), obrCarregarEtiquetas()]);
  renderObras();

  // alimenta selects que dependem de obras
  const selectMedObra = $("med-obra");
  if(selectMedObra){
    preencherSelect(selectMedObra,
      _obrRegistros.map(o => ({ id:o.id, txt:obraRotulo(o) })),
      "id","txt","— selecione —");
  }
}

/* Fase 182a: etiqueta (D4), nome do projeto, "obra para" e grupo de cada obra. Banco sem a migration → segue com
   "código — nome" (obraRotulo cai nele). mapaObras continua "código — nome": PDFs e contas antigas leem dele. */
async function obrCarregarEtiquetas(){
  _obrEtq = {};
  mapaObraEtiqueta = {};
  const { data, error } = await lerTudo(() => sb.from("vw_obras_etiqueta")
    .select("id,codigo,nome_projeto,cliente_id,cliente,obra_para_id,obra_para,obra_para_outro,grupo_id,grupo,etiqueta"));
  if(error) return;
  data.forEach(e => { _obrEtq[e.id] = e; if(e.etiqueta) mapaObraEtiqueta[e.id] = e.etiqueta; });
}

/* Carrega as pendências de contrato (mesma fonte da Carteira) e indexa por
   contrato_id, para destacar na lista/kanban de obras. Falha em silêncio
   se o perfil não puder ler a view. (fase 26) */
async function carregarPendenciasObras(){
  _obrPendMap = {};
  try {
    const { data, error } = await sb.from("vw_pendencias_contratos")
      .select("contrato_id,tipo,severidade");
    if(error || !data) return;
    data.forEach(p => { (_obrPendMap[p.contrato_id] ||= []).push(p); });
  } catch(_e) { /* sem permissão / view ausente: sem badge */ }
}

/* Badge de pendência para a lista/kanban de obras. Saldo negativo (precisa
   de aditivo) tem destaque vermelho; demais pendências, âmbar com contagem. */
function obrPendBadge(o){
  const pend = (o && o.contrato_id) ? _obrPendMap[o.contrato_id] : null;
  if(!pend || !pend.length) return "";
  if(pend.some(p => p.tipo === "saldo_negativo"))
    return `<span class="tag vermelho" title="Saldo negativo — precisa de aditivo">precisa aditivo</span>`;
  return `<span class="tag ambar" title="${pend.length} pendência(s) no contrato deste cliente">${pend.length} pend.</span>`;
}

/* ---------- Filtros ---------- */
function obrFiltradas(){
  const termo = ($("obr-busca")?.value || "").trim().toLowerCase();
  const fStatus = $("obr-f-status")?.value || "";
  const fCliente = $("obr-f-cliente")?.value || "";
  return _obrRegistros.filter(o => {
    if(_obrFiltroIds && !_obrFiltroIds.ids.has(o.id)) return false;
    if(fStatus && o.status !== fStatus) return false;
    if(fCliente && o.cliente_id !== fCliente) return false;
    if(termo){
      // fase 182a: acha também por nome do projeto, cliente (fantasia), "obra para" e grupo
      const e = _obrEtq[o.id] || {};
      const alvo = `${o.codigo||""} ${o.nome||""} ${mapaClientes[o.cliente_id]||""} ${o.cidade||""} ${e.nome_projeto||""} ${e.cliente||""} ${e.obra_para||""} ${e.grupo||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });
}

function preencherFiltrosObras(){
  // Status
  const sel = $("obr-f-status");
  if(sel && !sel.options.length){
    sel.innerHTML = `<option value="">Todos os status</option>` + opcoesStatus("obra");
  }
  // Cliente (popula a partir do mapaClientes carregado em core.js)
  const selCli = $("obr-f-cliente");
  if(selCli){
    const atual = selCli.value; // preserva a seleção (o render roda a cada tecla)
    const lista = Object.entries(mapaClientes).map(([id, nome]) => ({ id, nome }));
    selCli.innerHTML = `<option value="">Todos os clientes</option>` +
      lista.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("");
    selCli.value = atual;
  }
}

/* ---------- Render ----------
   opts (opcional, fase 75): { ids, rotulo, aba, foco } mostra só essas obras, com um chip
   para limpar; a obra aberta dessa lista já cai na aba e no campo que falta preencher. */
function renderObras(opts){
  if(opts && Array.isArray(opts.ids)){
    _obrFiltroIds = { ids: new Set(opts.ids), rotulo: opts.rotulo || "Filtro", aba: opts.aba || null, foco: opts.foco || null };
    ["obr-busca", "obr-f-status", "obr-f-cliente"].forEach(id => { const el = $(id); if(el) el.value = ""; });
  }
  const chip = $("obr-f-ids");
  if(chip){
    chip.style.display = _obrFiltroIds ? "" : "none";
    chip.innerHTML = _obrFiltroIds
      ? `<span class="tag azul">${esc(_obrFiltroIds.rotulo)} · ${_obrFiltroIds.ids.size} obra(s)</span> <button type="button" class="btn-sec btn-sm" id="obr-f-ids-limpar" title="Mostrar todas as obras">✕ limpar</button>`
      : "";
  }
  preencherFiltrosObras();
  const dados = obrFiltradas();
  const cont = $("obr-contador");
  if(cont) cont.textContent = `${dados.length} de ${_obrRegistros.length}`;
  if(_obrView === "kanban")     renderObrasKanban(dados);
  else if(_obrView === "nomes") renderObrasNomes(dados);   // fase 182a
  else                          renderObrasLista(dados);
  // mantém compatibilidade com código antigo que esperava #tab-obras populado
  const legacy = $("tab-obras");
  if(legacy && _obrView === "lista"){
    // já está dentro de #obr-conteudo, mas alguns lugares usam isto para contar; deixamos vazio aqui
    legacy.innerHTML = "";
  }
}

/* lote S56c (#174): término da obra — real; senão o previsto ("prev."); senão, em obra concluída, o calculado ("calc.":
   último RDO ou fim da última medição, vw_obras_controle). */
const OBR_TERMINO_ORIGEM = {
  real: { sufixo: "",      xlsx: "real",       titulo: "" },
  prev: { sufixo: "prev.", xlsx: "previsto",   titulo: "previsto no cadastro da obra" },
  calc: { sufixo: "calc.", xlsx: "calculado",  titulo: "calculado: último RDO ou fim da última medição (a obra está sem data de término)" }
};
function obrTerminoHtml(o){
  if(!o || !o.data_termino) return '<span class="meta">—</span>';
  const og = OBR_TERMINO_ORIGEM[o.termino_origem] || OBR_TERMINO_ORIGEM.real;
  return `${dataBR(o.data_termino)}${og.sufixo ? ` <span class="meta" title="${esc(og.titulo)}">${esc(og.sufixo)}</span>` : ""}`;
}

/* lote S56c (#174): .xlsx das obras visíveis (mesmos filtros e colunas da lista) */
function obrExportarXlsx(){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
  const dados = obrFiltradas();
  if(!dados.length){ aviso("app-aviso", "Nenhuma obra na lista para exportar.", "aviso"); return; }
  const comValor = podeVerValorObra();
  const dt = (s) => s ? new Date(String(s).slice(0, 10) + "T00:00:00") : null;
  const rot = (st) => (STATUS.obra && STATUS.obra[st] && STATUS.obra[st].label) || st || "";
  const cab = ["Código", "Nome", "Cliente", "Cidade/UF", "Início", "Término", "Origem do término", "Status"].concat(comValor ? ["Valor contratado"] : []);
  const aoa = [cab].concat(dados.map(o => [
    o.codigo || "", o.nome || "", mapaClientes[o.cliente_id] || "",
    (o.cidade || "") + (o.uf ? "/" + o.uf.toUpperCase() : ""),
    dt(o.data_inicio), dt(o.data_termino),
    o.data_termino ? (OBR_TERMINO_ORIGEM[o.termino_origem] || OBR_TERMINO_ORIGEM.real).xlsx : "",
    rot(o.status)
  ].concat(comValor ? [obrValor(o)] : [])));
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd/mm/yyyy" });
  ws["!cols"] = [{ wch: 12 }, { wch: 40 }, { wch: 32 }, { wch: 22 }, { wch: 11 }, { wch: 11 }, { wch: 16 }, { wch: 14 }].concat(comValor ? [{ wch: 16 }] : []);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "OBRAS");
  XLSX.writeFile(wb, `obras-${hojeISO()}.xlsx`);
}

function renderObrasLista(dados){
  const cont = $("obr-conteudo");
  if(!cont) return;
  if(!dados.length){
    cont.innerHTML = `<p class="vazio">Nenhuma obra encontrada.</p>`;
    return;
  }
  const comValor = podeVerValorObra();   // fase 90: a coluna de valor só para quem lê financeiro
  // fase 182a: a coluna Obra mostra a etiqueta (D4); o nome cadastrado fica no title e, se diferente, embaixo
  const linhas = dados.map(o => `<tr class="linha-clicavel" data-id="${esc(o.id)}">
    <td>${esc(o.codigo)} ${obrPendBadge(o)}</td>
    <td title="${esc("Nome cadastrado: " + (o.nome || ""))}">${esc(obraRotulo(o))}</td>
    <td>${esc(mapaClientes[o.cliente_id] || "—")}${obrObraParaMeta(o)}</td>
    <td>${esc((o.cidade||"") + (o.uf ? "/" + o.uf.toUpperCase() : ""))}</td>
    <td>${dataBR(o.data_inicio)}</td>
    <td>${obrTerminoHtml(o)}</td>
    <td>${tagStatus("obra", o.status)}</td>
    ${comValor ? `<td class="num">${brl(obrValor(o))}</td>` : ""}
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Código</th><th>Obra</th><th>Cliente</th><th>Cidade/UF</th>
      <th>Início</th><th>Término</th><th>Status</th>${comValor ? '<th class="num">Valor contratado</th>' : ""}
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

function renderObrasKanban(dados){
  const cont = $("obr-conteudo");
  if(!cont) return;
  const colunas = OBR_STAGES.concat(["cancelada"]).map(st => {
    const itens = dados.filter(o => o.status === st);
    if(!itens.length && st === "cancelada") return "";
    const stMeta = (STATUS.obra && STATUS.obra[st]) || { label: st, cor: "cinza" };
    const cards = itens.map(o => `
      <div class="serv-kan-card linha-clicavel" data-id="${esc(o.id)}">
        <div class="serv-kan-card-nome" title="${esc("Nome cadastrado: " + (o.nome || ""))}">${esc(obraRotulo(o))}</div>
        <div class="serv-kan-card-meta">
          <span class="meta">${esc(mapaClientes[o.cliente_id]||"—")}${obrObraParaMeta(o)}</span>
          ${obrPendBadge(o)}
        </div>
        <div class="serv-kan-card-rod">
          <span>${o.cidade ? esc(o.cidade) + "/" + esc((o.uf||"").toUpperCase()) : "—"}</span>
          ${podeVerValorObra() ? `<strong>${brl(obrValor(o))}</strong>` : ""}
        </div>
      </div>`).join("");
    return `<div class="serv-kan-col" data-status="${esc(st)}">
      <div class="serv-kan-col-head">${esc(stMeta.label)}<span>${itens.length}</span></div>
      ${cards || '<div class="kan-vazio">—</div>'}
    </div>`;
  }).join("");
  cont.innerHTML = `<div class="serv-kanban">${colunas}</div>`;
  habilitarDragKanban({
    container: "#obr-conteudo .serv-kanban",
    tabela: "obras",
    onUpdate: async () => { await carregarObras(); }
  });
}

/* ---------- Fase 182a: grupo, "Obra para", nome do projeto e etiqueta ---------- */
// "· para X" embaixo do cliente quando o empreendimento é de outra empresa
function obrObraParaMeta(o){
  const e = _obrEtq[o.id];
  return e && e.obra_para_outro && e.obra_para ? ` <span class="meta" title="Dono do empreendimento (Obra para)">· para ${esc(e.obra_para)}</span>` : "";
}
function obrEtiquetaFicha(obra){
  return (_obrEtq[obra.id] && _obrEtq[obra.id].etiqueta)
    || obraEtiquetaMontar(obra, typeof cliRotulo === "function" ? cliRotulo(obra.cliente_id) : (mapaClientes[obra.cliente_id] || ""));
}
// grupo econômico: só leitura, herdado do cliente escolhido no formulário
function obrAtualizarGrupo(){
  const el = $("obr-grupo");
  if(!el) return;
  const cli = typeof cliPorId === "function" ? cliPorId($("obr-cliente")?.value) : null;
  el.value = cli && cli.grupo_id && typeof cliGrupoNome === "function" ? cliGrupoNome(cli.grupo_id) : "";
  el.placeholder = cli ? "cliente sem grupo" : "";
}
// "Obra para" nasce igual ao cliente (D2); nome do projeto é digitado (D3), com a concorrência do orçamento como sugestão
function obrPreencherProjeto(d){
  const np = $("obr-nome-projeto"); if(np) np.value = d.nome_projeto || "";
  const op = $("obr-obra-para");
  if(op){ op.value = d.obra_para_id || d.cliente_id || ""; op.dataset.cliente = d.cliente_id || ""; }
  const sug = $("obr-projeto-sugestao"); if(sug){ sug.innerHTML = ""; delete sug.dataset.valor; }
  obrAtualizarGrupo();
  if(!d.nome_projeto && d.contrato_id) obrSugerirProjetoDoOrcamento(d.id, d.contrato_id);
}
async function obrSugerirProjetoDoOrcamento(obraId, contratoId){
  const { data } = await sb.from("contratos").select("orcamento:orcamento_id(numero,concorrencia)").eq("id", contratoId).maybeSingle();
  const conc = data && data.orcamento && String(data.orcamento.concorrencia || "").trim();
  const sug = $("obr-projeto-sugestao");
  if(!conc || !sug || obraEditId !== obraId || ($("obr-nome-projeto")?.value || "").trim()) return;
  sug.dataset.valor = conc;
  sug.innerHTML = `Sugestão do orçamento ${esc(data.orcamento.numero || "")}: <em>${esc(conc)}</em> <button type="button" class="btn-sec btn-sm" data-obr-projeto-usar="1" title="Copia a sugestão para o campo; grava só ao Salvar">Usar</button>`;
}
// cliente trocado: "Obra para" acompanha enquanto era o próprio cliente; o grupo é relido
function obrClienteMudou(){
  const op = $("obr-obra-para"), novo = $("obr-cliente")?.value || "";
  if(op && (!op.value || op.value === op.dataset.cliente)) op.value = novo;
  if(op) op.dataset.cliente = novo;
  obrAtualizarGrupo();
}

/* Lista de nomes a completar (visão "Nomes a completar"): obras sem nome do projeto cujo nome começa pelo cliente.
   Sugere o nome do projeto com o que sobra depois do cliente e do código, e "Obra para" quando a primeira palavra do
   que sobra é de outro cliente. Nada é gravado sem o clique em Gravar na linha (spec: parar e perguntar antes de lote). */
const OBR_PALAVRAS_GENERICAS = new Set(["CONSTRUTORA", "CONSTRUCOES", "CONSTRUCAO", "ENGENHARIA", "EMPREENDIMENTOS", "INCORPORADORA", "CONSORCIO", "GRUPO", "EMPRESA", "COMPANHIA", "CIA"]);
function obrNorm(s){ return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function obrPalavrasNorm(s){ return String(s || "").split(/\s+/).map(obrNorm).filter(Boolean); }
function obrNomeSugestao(o){
  const lista = typeof _clientes !== "undefined" ? _clientes : [];
  const c = lista.find(x => x.id === o.cliente_id) || { nome: mapaClientes[o.cliente_id] || "" };
  const orig = String(o.nome || "").trim().split(/\s+/);
  // prefixos do cliente: razão social, fantasia e a primeira palavra (do mais longo ao mais curto); palavra genérica
  // ("Construtora", "Engenharia"...) sozinha não serve: vai com a seguinte
  const pal = String(c.nome || "").split(/[\s,\-–—]+/).filter(Boolean);
  const curto = OBR_PALAVRAS_GENERICAS.has(obrNorm(pal[0])) ? pal.slice(0, 2).join(" ") : pal[0];
  const prefixos = [c.nome, c.nome_fantasia, curto]
    .map(obrPalavrasNorm).filter(p => p.length && p.join("").length >= 3).sort((a, b) => b.length - a.length);
  let corte = -1;
  for(const p of prefixos){
    let i = 0, k = 0;
    while(i < orig.length && k < p.length){
      const w = obrNorm(orig[i]);
      if(!w){ i++; continue; }
      if(w !== p[k]) break;
      i++; k++;
    }
    if(k === p.length){ corte = i; break; }
  }
  if(corte < 0) return null;
  const num = String(o.codigo || "").split(/[-\/]/)[0];
  const codigos = new Set([obrNorm(o.codigo), obrNorm(num)].filter(Boolean));
  const resto = orig.slice(corte).filter(w => {
    const n = obrNorm(w);
    if(n && codigos.has(n)) return false;                    // 8910-2026, 8910
    if(num && new RegExp("^" + num + "[\\/\\-]\\d{4}$").test(w.replace(/[^\d\/\-]/g, ""))) return false;   // 8910/2026
    return true;
  });
  // separadores soltos só saem das pontas ("— Belo Oriente / VALE" fica "Belo Oriente / VALE")
  while(resto.length && !obrNorm(resto[0])) resto.shift();
  while(resto.length && !obrNorm(resto[resto.length - 1])) resto.pop();
  if(resto.length){ resto[0] = resto[0].replace(/^[,\-–—·]+/, ""); resto[resto.length - 1] = resto[resto.length - 1].replace(/[,\-–—·]+$/, ""); }
  // tudo em caixa alta ("GERDAU 647CC") vira "Gerdau 647CC"; com minúsculas, fica como foi digitado
  const caixaAlta = !/[a-zà-ú]/.test(resto.join(" "));
  const titulo = !caixaAlta ? resto : resto.map(w => /\d/.test(w) ? w : w.length <= 2 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  let obraPara = null;
  if(resto.length){
    const prim = obrNorm(resto[0]);
    if(prim.length >= 4) obraPara = lista.find(x => x.id !== o.cliente_id && x.ativo !== false
      && (obrPalavrasNorm(x.nome_fantasia)[0] === prim || obrPalavrasNorm(x.nome)[0] === prim)) || null;
  }
  return { sugestao: titulo.join(" "), obraPara };
}
function obrPodeEditar(){
  return !!usuarioAtual && !(typeof ehSomenteLeitura === "function" && ehSomenteLeitura())
    && ["diretor", "admin", "engenheiro", "assistente_engenharia", "comercial"].includes(usuarioAtual.cargo);
}
function renderObrasNomes(dados){
  const cont = $("obr-conteudo");
  if(!cont) return;
  const linhas = dados.filter(o => !(_obrEtq[o.id] && _obrEtq[o.id].nome_projeto))
    .map(o => ({ o, s: obrNomeSugestao(o) })).filter(x => x.s);
  const cnt = $("obr-contador"); if(cnt) cnt.textContent = `${linhas.length} a completar`;
  if(!linhas.length){ cont.innerHTML = uiVazio("Nenhuma obra com nome a completar nos filtros atuais."); return; }
  const pode = obrPodeEditar();
  const tr = linhas.map(({ o, s }) => {
    const opOutro = _obrEtq[o.id] && _obrEtq[o.id].obra_para_outro;
    return `<tr data-obr-nome-id="${esc(o.id)}">
      <td>${linkObra(o.id, o.codigo || "")}</td>
      <td>${esc(o.nome || "")}<div class="meta">${esc(mapaClientes[o.cliente_id] || "")}</div></td>
      <td><input data-obr-nome-sug value="${esc(s.sugestao)}" placeholder="${s.sugestao ? "" : "só cliente + código: digite se houver"}" ${pode ? "" : "disabled"} title="Como o cliente chama o empreendimento; deixe em branco se não houver" /></td>
      <td>${s.obraPara && !opOutro
        ? `<label class="check-inline" title="Marque só se o empreendimento for desta empresa"><input type="checkbox" data-obr-nome-para="${esc(s.obraPara.id)}" ${pode ? "" : "disabled"} /> ${esc(s.obraPara.nome_fantasia || s.obraPara.nome)}?</label>`
        : `<span class="meta">${opOutro ? esc(_obrEtq[o.id].obra_para || "") : "—"}</span>`}</td>
      <td>${pode ? `<button type="button" class="btn-sec btn-sm" data-obr-nome-gravar="${esc(o.id)}" title="Grava o nome do projeto (e a Obra para, se marcada) só desta obra">Gravar</button>` : ""}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<p class="texto-apoio compacto">Obras sem nome do projeto cujo nome começa pelo cliente. A sugestão sai do que sobra depois do cliente e do código; confira e grave uma por uma. O nome cadastrado não muda.</p>
    <div class="tabela-rola"><table>
    <thead><tr><th>Código</th><th>Nome cadastrado</th><th>Nome do projeto (sugestão)</th><th>Obra para</th><th></th></tr></thead>
    <tbody>${tr}</tbody></table></div>`;
}
async function obrNomesGravar(id){
  const linha = document.querySelector(`#obr-conteudo tr[data-obr-nome-id="${CSS.escape(id)}"]`);
  if(!linha) return;
  const reg = { nome_projeto: (linha.querySelector("[data-obr-nome-sug]")?.value || "").trim() || null };
  const para = linha.querySelector("[data-obr-nome-para]");
  if(para && para.checked) reg.obra_para_id = para.dataset.obrNomePara;
  if(!reg.nome_projeto && !reg.obra_para_id){ aviso("app-aviso", "Digite o nome do projeto ou marque a Obra para.", "aviso"); return; }
  const { error } = await sb.from("obras").update(reg).eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível gravar: " + error.message, "erro"); return; }
  aviso("app-aviso", "Nome do projeto gravado.", "ok");
  await obrCarregarEtiquetas();
  renderObras();
}

/* ---------- Painel <-> Ficha ---------- */
function mostrarPainelObra(){
  $("obr-painel").style.display = "";
  $("obr-ficha").style.display = "none";
  obraEditId = null;
  _obrContrato = null;
}

function novaObra(){
  obraEditId = null;
  _obrContrato = null;
  // limpa form
  $("obr-codigo").value = "";
  $("obr-nome").value = "";
  $("obr-cliente").value = "";
  obrPreencherProjeto({});   // fase 182a
  $("obr-status").value = "planejada";
  obrValorResponsavel(null);
  $("obr-inicio").value = "";
  $("obr-fim-prev").value = "";
  $("obr-fim-real").value = "";
  $("obr-valor").value = 0;
  $("obr-cep").value = "";
  $("obr-logradouro").value = "";
  $("obr-numero").value = "";
  $("obr-complemento").value = "";
  $("obr-bairro").value = "";
  $("obr-cidade").value = "";
  $("obr-uf").value = "";
  obrPreencherIbge({});   // fase 105a
  $("obr-descricao").value = "";
  $("obr-obs").value = "";
  preencherParametrosObra({});
  limparAbaContratoObra();

  $("btn-excluir-obra").style.display = "none";
  abrirFichaObra({ codigo: "", nome: "(nova)", status: "planejada" });
  // Sem sugestão automática de código: sugerirNumeros() contava um <tbody> sempre
  // vazio e propunha "OB-0001" (já usado → erro de UNIQUE). O código da obra
  // segue o padrão da CGL (ex.: 7822-2025) e é informado pelo usuário.
}

/* Fase 105a: código IBGE do município da obra (local da prestação da NFS-e), preenchido pelo CEP (fiscalLigarCep em
   js/fiscal.js). obras.codigo_ibge só existe depois da migration da fase 105a: até lá o campo fica desligado e não vai
   no salvar (_obrTemIbge vem do select("*") da ficha; obra nova pergunta ao banco). */
let _obrTemIbge = false;
async function obrPreencherIbge(d){
  const el = $("obr-ibge");
  if(!el) return;
  el.value = d.codigo_ibge || "";
  const st = $("obr-cep-status"); if(st) st.textContent = "";
  const cep = $("obr-cep"); if(cep) cep.dataset.ultimo = String(d.cep || "").replace(/\D/g, "");
  _obrTemIbge = Object.prototype.hasOwnProperty.call(d, "codigo_ibge") || (typeof fiscalColunaExiste === "function" && await fiscalColunaExiste("obras", "codigo_ibge"));
  el.disabled = !_obrTemIbge;
  const av = $("obr-ibge-aviso"); if(av) av.style.display = _obrTemIbge ? "none" : "";
}

/* O select só lista a engenharia ativa (fase 75); responsável antigo de outro cargo ou
   inativo continua aparecendo, marcado, para não sumir ao salvar a obra. */
function obrValorResponsavel(id){
  const sel = $("obr-responsavel");
  if(!sel) return;
  sel.querySelectorAll("option[data-fora]").forEach(o => o.remove());
  if(id && ![...sel.options].some(o => o.value === id)){
    const o = document.createElement("option");
    o.value = id; o.dataset.fora = "1";
    o.textContent = "(fora da engenharia ativa)";
    sel.appendChild(o);
  }
  sel.value = id || "";
}

async function abrirObra(id){
  // fase 90: o valor vem de obras_financeiro embutido 1:1 (nulo para quem não lê financeiro)
  const { data, error } = await sb.from("obras").select("*, financeiro:obras_financeiro(valor_contratado,caucao_percentual,caucao_prazo_dias)").eq("id", id).single();   // fase 91: caução da obra
  if(error){ aviso("app-aviso","Erro ao abrir obra: "+error.message, "erro"); return; }
  obraEditId = id;

  $("obr-codigo").value = data.codigo || "";
  $("obr-nome").value = data.nome || "";
  $("obr-cliente").value = data.cliente_id || "";
  obrPreencherProjeto(data);   // fase 182a
  $("obr-status").value = data.status || "planejada";
  obrValorResponsavel(data.responsavel_id);
  $("obr-inicio").value = data.data_inicio || "";
  $("obr-fim-prev").value = data.data_fim_prevista || "";
  $("obr-fim-real").value = data.data_fim_real || "";
  $("obr-valor").value = obrValor(data);
  $("obr-cep").value = data.cep || "";
  $("obr-logradouro").value = data.logradouro || "";
  $("obr-numero").value = data.numero || "";
  $("obr-complemento").value = data.complemento || "";
  $("obr-bairro").value = data.bairro || "";
  $("obr-cidade").value = data.cidade || "";
  $("obr-uf").value = data.uf || "";
  obrPreencherIbge(data);   // fase 105a
  $("obr-descricao").value = data.descricao || "";
  $("obr-obs").value = data.observacoes || "";
  preencherParametrosObra(data);

  await carregarContratoDaObra(data.contrato_id);

  $("btn-excluir-obra").style.display = "";
  abrirFichaObra(data);
}

/* ====================================================================
   ABA CONTRATO — o contrato do cliente vive dentro da obra (fase 21)

   A tabela `contratos` continua sendo a fonte; a obra guarda o vínculo
   em contrato_id. Cliente, valor, datas e responsável são espelhados da
   obra ao salvar, então só os campos propriamente contratuais aparecem
   aqui.
   ==================================================================== */
function limparAbaContratoObra(){
  _obrContrato = null;
  _obrContratoPend = [];
  const box = $("obr-con-pendencias"); if(box) box.innerHTML = "";
  ["obr-con-numero","obr-con-assinatura","obr-con-orcamento","obr-con-indice","obr-con-descricao"]
    .forEach(k => { const el = $(k); if(el) el.value = ""; });
  const cat = $("obr-con-categoria"); if(cat) cat.value = "empreitada";
  const st  = $("obr-con-status");    if(st)  st.value  = "em_elaboracao";
  obrConModoResumo(null);
  atualizarBadgeContratoObra();
}

/* Fase 180a (D7): com contrato, a aba vira resumo (campos travados) e o link leva à ficha no módulo Contratos, onde fica a
   edição. Sem contrato, os campos continuam abertos para gerar o contrato ao salvar a obra. */
const OBR_CON_CAMPOS = ["obr-con-numero","obr-con-categoria","obr-con-status","obr-con-assinatura","obr-con-orcamento","obr-con-indice","obr-con-descricao"];
function obrConModoResumo(contrato){
  OBR_CON_CAMPOS.forEach(k => { const el = $(k); if(el) el.disabled = !!contrato; });
  const ajuda = $("obr-con-ajuda"); if(ajuda) ajuda.style.display = contrato ? "none" : "";
  const box = $("obr-con-modulo");
  if(!box) return;
  if(!contrato){ box.innerHTML = ""; return; }
  const link = typeof podeVerContratosReceita === "function" && podeVerContratosReceita()
    ? `<button type="button" class="btn-sec btn-sm" id="btn-obr-con-abrir-modulo" title="Abre a ficha deste contrato no módulo Contratos">Abrir no módulo Contratos</button>`
    : "";
  box.innerHTML = `<div class="dist-aviso neutro" style="margin-bottom:12px;">
    <strong>Contrato ${esc(contrato.numero)}</strong> ${tagStatus("contrato", contrato.status)}
    <span class="meta">resumo; a edição do contrato fica no módulo Contratos (cliente, datas, valor e responsável continuam vindo desta obra)</span>
    ${/* html */ link}
  </div>`;
  $("btn-obr-con-abrir-modulo")?.addEventListener("click", () => {
    if(irParaSecao("contratos") && typeof abrirContrato === "function") abrirContrato(contrato.id);
  });
}

async function carregarContratoDaObra(contratoId){
  if(!contratoId){ limparAbaContratoObra(); return; }
  const { data, error } = await sb.from("contratos").select("*").eq("id", contratoId).single();
  if(error || !data){ limparAbaContratoObra(); return; }
  _obrContrato = data;
  $("obr-con-numero").value     = data.numero || "";
  $("obr-con-categoria").value  = data.categoria || "empreitada";
  $("obr-con-status").value     = data.status || "em_elaboracao";
  $("obr-con-assinatura").value = data.data_assinatura || "";
  $("obr-con-orcamento").value  = data.orcamento_id || "";
  $("obr-con-indice").value     = data.indice_reajuste || "";
  $("obr-con-descricao").value  = data.descricao || "";
  obrConModoResumo(data);   // fase 180a
  atualizarBadgeContratoObra();
  renderPendenciasContratoObra(contratoId);
}

/* Bloco de pendências do contrato dentro da ficha da Obra (fase 26).
   Mesma fonte da Carteira (vw_pendencias_contratos), para a engenharia
   ver e resolver sem depender do acesso à Carteira. */
async function renderPendenciasContratoObra(contratoId){
  const box = $("obr-con-pendencias");
  _obrContratoPend = [];
  if(box) box.innerHTML = "";
  if(!contratoId){ atualizarBadgeContratoObra(); return; }
  const [{ data, error }, medPend] = await Promise.all([
    sb.from("vw_pendencias_contratos").select("tipo,detalhe,valor_impacto,severidade").eq("contrato_id", contratoId),
    // lote S39 (#26): pendências de medição da obra, clicáveis (a view pode não existir ainda: segue sem elas)
    obraEditId ? sb.from("vw_medicoes_pendencias").select("medicao_id,numero,tipo,detalhe,valor_impacto,severidade").eq("obra_id", obraEditId)
               : Promise.resolve({ data: [] })
  ]);
  if(error){ atualizarBadgeContratoObra(); return; }
  const medLinhas = (medPend?.error ? [] : (medPend?.data || [])).map(p => ({
    tipo: p.tipo === "producao_pendente" ? "medicao_producao_pendente" : "medicao_sem_itens",
    detalhe: `Medição ${p.numero || "?"}: ${p.tipo === "producao_pendente" ? "produção pendente (" + p.detalhe + ")" : p.detalhe}`,
    valor_impacto: p.valor_impacto, severidade: p.severidade, medicao_id: p.medicao_id
  }));
  // a view do contrato já traz a produção pendente sem o id da medição: fica a versão clicável
  const pend = (data || []).filter(p => !(medLinhas.length && p.tipo === "medicao_producao_pendente"))
    .concat(medLinhas).sort((a,b) => (a.severidade||9) - (b.severidade||9));
  _obrContratoPend = pend;
  atualizarBadgeContratoObra();
  if(!box) return;
  if(!pend.length){
    box.innerHTML = `<div class="dist-aviso ok" style="margin-bottom:14px;">✓ Sem pendências neste contrato.</div>`;
    return;
  }
  const meta = (typeof CART_PEND_META !== "undefined") ? CART_PEND_META : {};
  const itens = pend.map(p => {
    const m = meta[p.tipo] || { label: p.tipo, cor: "cinza" };
    let txt = esc(p.detalhe || "");
    if(p.tipo === "saldo_negativo" && p.valor_impacto != null)
      txt += ` <strong>(excede ${brl(p.valor_impacto)} — abra um aditivo)</strong>`;
    if(p.medicao_id) return `<li class="linha-clicavel" data-med="${esc(p.medicao_id)}" title="Abrir a medição"><span class="tag ${esc(m.cor)}">${esc(m.label)}</span> ${/* html */ txt}</li>`;
    return `<li><span class="tag ${esc(m.cor)}">${esc(m.label)}</span> ${/* html */ txt}</li>`;
  }).join("");
  const grave = pend.some(p => (p.severidade || 9) === 1);
  box.innerHTML = `<div class="dist-aviso ${grave ? "alerta" : "neutro"}" style="margin-bottom:14px;">
    <strong>⚠️ ${pend.length} pendência(s) neste contrato</strong>
    <span class="meta">resolva o quanto antes — cada linha some sozinha quando o cadastro é corrigido</span>
    <ul style="margin:6px 0 0;padding-left:18px;">${itens}</ul>
  </div>`;
  box.querySelectorAll("li[data-med]").forEach(li => li.addEventListener("click", () => {
    irParaSecao("medicoes");
    if(typeof abrirMedicao === "function") abrirMedicao(li.dataset.med);
  }));
}

/* Badge da aba: ✓ quando há contrato, alerta quando ele ainda não foi assinado */
function atualizarBadgeContratoObra(){
  const badge = $("obr-con-badge");
  if(!badge) return;
  // Pendências (fase 26) têm prioridade no badge: mostra a contagem em alerta.
  const nPend = (_obrContratoPend || []).length;
  if(nPend){
    badge.textContent = String(nPend);
    badge.className   = "aba-badge alerta";
    badge.title       = `${nPend} pendência(s) no contrato — ver aba Contrato`;
    return;
  }
  if(!_obrContrato){ badge.textContent = ""; badge.className = "aba-badge"; return; }
  const pendente = !_obrContrato.data_assinatura;
  badge.textContent = pendente ? "!" : "✓";
  badge.className   = pendente ? "aba-badge alerta" : "aba-badge";
  badge.title       = pendente ? "Contrato sem data de assinatura" : "Contrato registrado";
}

/* Cria ou atualiza o contrato do cliente a partir dos dados da obra.
   Devolve o id do contrato, ou null se a obra não tem contrato. */
async function salvarContratoDaObra(obra){
  const numero = ($("obr-con-numero")?.value || "").trim();

  // Sem número e sem contrato prévio: a obra simplesmente não tem contrato.
  if(!numero && !_obrContrato) return null;

  // Tinha contrato e o número foi apagado: mantém o registro, só avisa.
  if(!numero && _obrContrato){
    aviso("app-aviso","O número do contrato ficou em branco — o contrato existente foi mantido.","erro");
    return _obrContrato.id;
  }

  const reg = {
    numero,
    natureza: "cliente",
    cliente_id: obra.cliente_id,
    fornecedor_id: null,
    orcamento_id: $("obr-con-orcamento").value || null,
    categoria: $("obr-con-categoria").value,
    status: $("obr-con-status").value,
    descricao: ($("obr-con-descricao").value || "").trim() || obra.descricao || null,
    responsavel_id: obra.responsavel_id,
    data_assinatura: $("obr-con-assinatura").value || null,
    data_inicio: obra.data_inicio,
    data_fim_prevista: obra.data_fim_prevista,
    valor_total: (podeVerValorObra() && obra.valor_contratado != null) ? obrValor(obra) : (_obrContrato?.valor_total ?? 0),   // fase 90: só quem gravou obras_financeiro espelha o valor; os demais mantêm o do contrato
    indice_reajuste: ($("obr-con-indice").value || "").trim() || null
  };

  let result;
  if(_obrContrato){
    // fase 180a (D7): contrato existente é editado no módulo Contratos; daqui só vão os campos que vêm da obra, para não
    // desfazer o que foi mudado lá enquanto esta ficha estava aberta
    const espelho = { cliente_id: reg.cliente_id, responsavel_id: reg.responsavel_id, data_inicio: reg.data_inicio,
      data_fim_prevista: reg.data_fim_prevista, valor_total: reg.valor_total };
    result = await sb.from("contratos").update(espelho).eq("id", _obrContrato.id).select().single();
  } else {
    result = await sb.from("contratos").insert(reg).select().single();
  }
  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    const detalhe = (m.includes("duplicate") || m.includes("unique"))
      ? `já existe outro contrato com o número ${numero}`
      : result.error.message;
    aviso("app-aviso","Obra salva, mas o contrato não pôde ser gravado: "+detalhe,"erro");
    return _obrContrato ? _obrContrato.id : null;
  }
  _obrContrato = result.data;
  return result.data.id;
}

function abrirFichaObra(obra){
  _obrAberta = obra;   // fase 163
  $("obr-painel").style.display = "none";
  $("obr-ficha").style.display = "";

  // Chips de contexto
  $("obr-ficha-codigo").textContent = obra.codigo || "(novo)";
  $("obr-ficha-cliente-chip").textContent = mapaClientes[obra.cliente_id] || "—";
  // fase 90: valor só para quem lê financeiro (obras_financeiro); chip e campo somem para os demais
  const comValor = podeVerValorObra();
  $("obr-ficha-valor-chip").textContent = brl(obrValor(obra));
  if($("obr-ficha-valor-chip-box")) $("obr-ficha-valor-chip-box").style.display = comValor ? "" : "none";
  if($("obr-valor-campo")) $("obr-valor-campo").style.display = comValor ? "" : "none";
  if($("obr-caucao-bloco")) $("obr-caucao-bloco").style.display = comValor ? "" : "none";   // fase 91: caução vive em obras_financeiro
  $("obr-ficha-cidade-chip").textContent = obra.cidade
    ? `${obra.cidade}${obra.uf ? "/" + obra.uf.toUpperCase() : ""}`
    : "—";
  $("obr-ficha-titulo").textContent = obra.codigo ? obrEtiquetaFicha(obra) : "Nova obra";   // fase 182a: etiqueta (D4)
  if($("obr-ficha-titulo")) $("obr-ficha-titulo").title = obra.codigo ? "Nome cadastrado: " + (obra.nome || "") : "";
  obrAtualizarGrupo();   // fase 182a
  obrCarregarPrevisaoChip(obra.id);   // fase 140

  atualizarStatusbarObra(obra.status);
  obrAtualizarConcluir(obra);   // lote S44 (L9): "Concluir obra" para o financeiro
  ativarTabObra("geral");
  // Aba Contrato: badge + anexos + assinatura do contrato vinculado
  atualizarBadgeContratoObra();
  if(typeof carregarDocumentosDoContrato === "function"){
    carregarDocumentosDoContrato(_obrContrato ? _obrContrato.id : null, OBR_CON_DOC_CONF);
  }
  if(typeof renderBlocoAssinatura === "function"){
    renderBlocoAssinatura(_obrContrato, "obr-con-assinatura-bloco", {
      recarregar: async () => { await abrirObra(obraEditId); ativarTabObra("contrato"); }
    });
  }
  // Carrega estacas vinculadas (aba Estacas)
  if(typeof carregarEstacasDaObra === "function"){
    carregarEstacasDaObra(obraEditId);
  }
  // Carrega contagens dos smart-buttons (e prepara dados das abas)
  if(typeof carregarAbasObra === "function"){
    carregarAbasObra(obraEditId);
  }
}

/* ---------- Fase 140 (decisão 8): chip "faltam N estacas · M m · termina ~DD/MM (D d de folga)" ----------
   Lê vw_sc_obra_andamento por obra_id; a view só traz obra em andamento: nas demais o chip fica escondido. Sem valor financeiro. */
function obrRitmoTitulo(a){
  const base = Array.isArray(a.ritmo_base) ? a.ritmo_base : [];
  if(a.ritmo_origem === "maquinas" && base.length){
    return "Ritmo das máquinas em obra: " + base.map(b => `${b.codigo} ${num(b.m_dia)} m/dia (${b.dias_base} dia${Number(b.dias_base) === 1 ? "" : "s"} de base)`).join("; ");
  }
  if(a.ritmo_origem === "obra") return "Sem máquina em obra com RDO finalizado: usa a média dos últimos 14 dias com RDO da obra";
  return "";
}
function obrSemPrevisaoTitulo(a){
  if(!Number(a.faltam_metros)) return "Sem metros faltando: falta a profundidade das estacas no cadastro ou a meta de metros na aba Parâmetros";
  return "Sem ritmo: precisa de máquina em obra com RDO finalizado, ou de 3 dias com RDO na obra";
}
function obrTextoPrevisao(a){
  const fe = Number(a.faltam_estacas) || 0, fm = Number(a.faltam_metros) || 0;
  if(a.sem_previstas && !fm) return "sem previstas: informe a meta na aba Parâmetros";
  const partes = [];
  if(fe > 0) partes.push(`faltam ${fe.toLocaleString("pt-BR")} estaca${fe === 1 ? "" : "s"}`);
  if(fm > 0) partes.push(`${Math.round(fm).toLocaleString("pt-BR")} m`);
  if(a.previsao_termino){
    const folga = a.folga_dias == null ? "" : Number(a.folga_dias) < 0 ? ` (${Math.abs(a.folga_dias)} d de atraso)` : ` (${a.folga_dias} d de folga)`;
    partes.push(`termina ~${dataBR(a.previsao_termino).slice(0, 5)}${folga}`);
  } else if(fe > 0 || fm > 0){
    partes.push(fm > 0 ? "sem ritmo para prever" : "sem metros para prever");
  }
  return partes.join(" · ") || "nada faltando";
}
/* fase 163: a leitura do chip fica guardada (a promessa já disparada, uma só ida ao banco) para a aba RDOs escrever a previsão
   por extenso sem ler de novo. Cada abertura da ficha lê outra vez, como antes. */
let _obrPrevisaoLida = { obraId: null, promessa: null };
function obrPrevisaoLida(obraId){ return obraId && _obrPrevisaoLida.obraId === obraId ? _obrPrevisaoLida.promessa : null; }
async function obrCarregarPrevisaoChip(obraId){
  const box = $("obr-ficha-previsao-chip-box"), el = $("obr-ficha-previsao-chip");
  _obrPrevisaoLida = { obraId: null, promessa: null };
  if(!box || !el) return;
  box.style.display = "none";
  if(!obraId) return;
  const promessa = sb.from("vw_sc_obra_andamento")
    .select("faltam_estacas,faltam_metros,previsao_termino,folga_dias,sem_previstas,ritmo_origem,ritmo_base").eq("obra_id", obraId).maybeSingle().then(r => r);
  _obrPrevisaoLida = { obraId, promessa };
  const { data, error } = await promessa;
  if(error) console.error("Previsão da obra:", error);
  if(error || !data || obraId !== obraEditId) return;
  el.textContent = obrTextoPrevisao(data);
  el.title = data.previsao_termino ? obrRitmoTitulo(data) : obrSemPrevisaoTitulo(data);
  box.style.display = "";
}

function atualizarStatusbarObra(st){
  const bar = $("obr-statusbar");
  if(!bar) return;
  const idxAtual = OBR_STAGES.indexOf(st);
  bar.querySelectorAll(".stage").forEach(el => {
    el.classList.remove("atual","passada","cancelada");
    el.removeAttribute("aria-current"); // etapa atual é anunciada pelo leitor de tela
    const idx = OBR_STAGES.indexOf(el.dataset.status);
    if(st === "cancelada"){
      if(idx === OBR_STAGES.length - 1){ el.classList.add("cancelada"); el.setAttribute("aria-current", "step"); }
    } else if(idx === idxAtual){
      el.classList.add("atual");
      el.setAttribute("aria-current", "step");
    } else if(idx < idxAtual){
      el.classList.add("passada");
    }
  });
}

/* lote S44 (L9, chamado #67, decisão do Bernardo em 19/10): o financeiro marca a obra como concluída
   depois do último recebimento. O botão "Concluir obra" só aparece para o cargo `financeiro` (diretor,
   admin, engenharia e comercial mudam o status pela statusbar), com a obra em andamento e a última
   medição faturada. A gravação manda só status e data_fim_real: a policy `obras_concluir_financeiro`
   e o gatilho `trg_obras_concluir_financeiro` barram qualquer outro campo, e `trg_obras_log_status`
   registra quem concluiu e quando em registros_log (linha do tempo da obra). */
function obrEhFinanceiro(){ return !!usuarioAtual && usuarioAtual.cargo === "financeiro"; }
async function obrAtualizarConcluir(obra){
  const btn = $("btn-obr-concluir"), hint = $("obr-concluir-hint");
  if(!btn) return;
  btn.style.display = "none";
  if(hint){ hint.style.display = "none"; hint.textContent = ""; }
  if(!obrEhFinanceiro() || !obraEditId || !obra || obra.status !== "em_andamento") return;
  const { data: ult } = await sb.from("medicoes").select("numero,status").eq("obra_id", obraEditId)
    .order("data_medicao", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1);
  const m = ult && ult[0];
  const lblMed = m ? ((typeof STATUS === "object" && STATUS.medicao && STATUS.medicao[m.status]) ? STATUS.medicao[m.status].label : m.status) : "";
  // lote S45 (L11, decisão do Bernardo em 19/10) com a fase 91 no ar: a regra final é "última medição faturada E
  // recebida" = status "recebida" (medicao_recebimentos / fn_medicao_recebimentos_sync marcam a medição quando os
  // recebimentos cobrem o líquido; ninguém marca recebida à mão).
  if(m && m.status === "recebida"){
    btn.style.display = "";
    btn.title = `Última medição ${m.numero || ""} ${lblMed.toLowerCase()}: marca a obra como concluída (só status e data de término; fica registrado quem concluiu)`;
  } else if(hint){
    hint.style.display = "";
    hint.textContent = m
      ? `Concluir obra: disponível quando a última medição estiver faturada e recebida (hoje: ${m.numero || "—"} · ${lblMed})`
      : "Concluir obra: disponível quando houver medição faturada e recebida";
  }
}
async function obrConcluirObra(){
  if(!obraEditId) return;
  const fim = $("obr-fim-real").value || hojeISO();
  if(!confirm(`Marcar a obra como concluída em ${dataBR(fim)}?\n\nO financeiro só altera o status e a data de término; fica registrado quem concluiu e quando.`)) return;
  const { data, error } = await sb.from("obras").update({ status: "concluida", data_fim_real: fim })
    .eq("id", obraEditId).select("id,status,data_fim_real").maybeSingle();
  if(error || !data){
    aviso("app-aviso", "Não foi possível concluir a obra: " + (error ? error.message : "a obra não está em andamento ou o seu cargo não conclui obra."), "erro");
    return;
  }
  $("obr-status").value = "concluida";
  $("obr-fim-real").value = data.data_fim_real || fim;
  atualizarStatusbarObra("concluida");
  obrAtualizarConcluir({ status: "concluida" });
  aviso("app-aviso", "Obra marcada como concluída.", "ok");
  if(typeof carregarObras === "function") carregarObras();
}

function ativarTabObra(nome){
  document.querySelectorAll("#obr-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.tab === nome);
  });
  document.querySelectorAll("#obr-ficha .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.tab === nome);
  });
}
/* Foco num campo da ficha da obra (fase 75: "Indicar o engenheiro responsável" e jornada) */
function obrFocarCampo(id){
  const el = id ? $(id) : null;
  if(!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus();
}

/* ---------- Aba Parâmetros (fase 42): jornada e concretagem ----------
   Jornada fica na obra (valor da proposta, editável) e alimenta as horas extras da equipe
   do RDO. Concretagem parametriza o cálculo automático de volume (fn_volume_concreto):
   usinado → (Ø/2000)²·π·prof·perda; saco → peso_saco × sacos ÷ traço. */
const OBR_PARAM_DEFAULTS = { traco_kg_cimento_m3: 750, peso_saco_kg: 50, fator_perda_concreto: 1.20 };
function preencherParametrosObra(d){
  const hhmm = (t) => t ? String(t).slice(0, 5) : "";
  const set = (id, v) => { const el = $(id); if(el) el.value = v; };
  set("obr-jornada-entrada",     hhmm(d.jornada_entrada));
  set("obr-jornada-saida",       hhmm(d.jornada_saida));
  set("obr-jornada-sex-entrada", hhmm(d.jornada_sexta_entrada));
  set("obr-jornada-sex-saida",   hhmm(d.jornada_sexta_saida));
  if($("obr-dois-turnos")) $("obr-dois-turnos").checked = !!d.dois_turnos;   // fase 155a
  set("obr-jornada-not-entrada",     hhmm(d.jornada_noturno_entrada));       // fase 155b
  set("obr-jornada-not-saida",       hhmm(d.jornada_noturno_saida));
  set("obr-jornada-not-sex-entrada", hhmm(d.jornada_noturno_sexta_entrada));
  set("obr-jornada-not-sex-saida",   hhmm(d.jornada_noturno_sexta_saida));
  obrMostrarJornadaNoturna("diurno");   // hotfix 295: a ficha abre na aba diurna
  set("obr-iss-pct",             d.iss_percentual ?? 5);
  set("obr-cno",                 d.cno || "");                 // fase 93c: CNO do cliente (alocação mensal do RH)
  set("obr-meta-estacas",        d.meta_estacas || "");        // fase 140 (decisão 3): 0 no banco = sem meta
  set("obr-meta-metros",         d.meta_metros || "");
  set("obr-conc-tipo",           d.concretagem_tipo_padrao || "");
  set("obr-conc-fornecedor",     d.concreto_fornecedor || "");
  set("obr-conc-traco",          d.traco_kg_cimento_m3 ?? OBR_PARAM_DEFAULTS.traco_kg_cimento_m3);
  set("obr-conc-peso-saco",      d.peso_saco_kg ?? OBR_PARAM_DEFAULTS.peso_saco_kg);
  set("obr-conc-fator-perda",    d.fator_perda_concreto ?? OBR_PARAM_DEFAULTS.fator_perda_concreto);
  set("obr-sinal-modelo",        d.sinal_abatimento_modelo || "proporcional");
  // fase 91: caução contratual da obra (obras_financeiro embutido; vazio para quem não lê financeiro ou obra nova)
  set("obr-caucao-pct",          d.financeiro?.caucao_percentual ?? "");
  set("obr-caucao-prazo",        d.financeiro?.caucao_prazo_dias ?? "");
  obrProdMinPreencher(d);   // fase 179
  atualizarResumoParametrosObra();
}

/* ---------- Fase 179: produção mínima por dia (parâmetro do dia produtivo) ----------
   Grava pela RPC obra_producao_minima_gravar (engenheiro da obra, gestor do tipo de serviço e diretoria; o banco confere).
   A sugestão (obra_producao_minima_sugerir) devolve só metros e a fonte, sem R$, e nunca troca o valor já digitado. */
let _obrProdSeq = 0;
function obrProdMinPreencher(d){
  const inp = $("obr-prod-min"), fonte = $("obr-prod-min-fonte");
  if(!inp) return;
  inp.value = d && d.producao_minima_dia_m != null ? d.producao_minima_dia_m : "";
  if(fonte) fonte.textContent = d && d.producao_minima_dia_m != null ? (d.producao_minima_fonte || "manual") : "Sem parâmetro: vale a regra de reserva (com estaca e menos de 2 h paradas é produtivo).";
  const seq = ++_obrProdSeq, id = d && d.id;
  const travar = (pode) => { [inp, $("obr-btn-prod-sugerir"), $("obr-btn-prod-gravar")].forEach(el => { if(el) el.disabled = !pode; }); };
  travar(false);
  if(!id) return;
  sb.rpc("obra_producao_minima_pode_editar", { p_obra: id }).then(({ data, error }) => {
    if(seq !== _obrProdSeq) return;
    travar(!error && data === true);
    if(!error && data !== true && fonte) fonte.title = "Só o engenheiro da obra, o gestor do tipo de serviço ou a diretoria mudam este valor.";
  });
}
async function obrProdMinSugerir(){
  if(!obraEditId) return;
  const { data, error } = await sb.rpc("obra_producao_minima_sugerir", { p_obra: obraEditId });
  if(error){ aviso("app-aviso", "Não foi possível sugerir: " + error.message, "erro"); return; }
  const s = (data || [])[0] || {};
  const inp = $("obr-prod-min"), fonte = $("obr-prod-min-fonte");
  if(s.metros == null){ if(fonte) fonte.textContent = s.fonte || "Sem sugestão: digite o valor."; return; }
  const m = Number(s.metros);
  if(inp && inp.value === ""){
    inp.value = m;
    if(fonte) fonte.textContent = `Sugestão: ${num(m)} m (${s.fonte}). Confira e clique em Gravar produção mínima.`;
  } else if(fonte){
    fonte.textContent = `Sugestão: ${num(m)} m (${s.fonte}). O valor digitado foi mantido; para usar a sugestão, apague o campo e sugira de novo.`;
  }
}
async function obrProdMinGravar(){
  if(!obraEditId) return;
  const v = ($("obr-prod-min")?.value || "").trim();
  const m = v === "" ? null : Number(v.replace(",", "."));
  if(m !== null && !(m > 0)){ aviso("app-aviso", "A produção mínima precisa ser maior que zero (ou vazia para ficar sem parâmetro).", "erro"); return; }
  const { data, error } = await sb.rpc("obra_producao_minima_gravar", { p_obra: obraEditId, p_metros: m });
  if(error){ aviso("app-aviso", "Não foi possível gravar: " + error.message, "erro"); return; }
  if(typeof _obrAberta !== "undefined" && _obrAberta && _obrAberta.id === obraEditId){ _obrAberta.producao_minima_dia_m = m; _obrAberta.producao_minima_fonte = data?.fonte || null; }
  const fonte = $("obr-prod-min-fonte");
  if(fonte) fonte.textContent = m === null ? "Sem parâmetro: vale a regra de reserva (com estaca e menos de 2 h paradas é produtivo)." : (data?.fonte || "manual");
  aviso("app-aviso", m === null ? "Produção mínima apagada: a obra usa a regra de reserva." : `Produção mínima gravada: ${num(m)} m por dia.`, "ok");
}
function lerParametrosObra(){
  const t = (id) => { const v = $(id)?.value; return v ? v : null; };
  const n = (id, padrao) => { const v = $(id)?.value; if(v === "" || v == null) return padrao; const x = Number(String(v).replace(",", ".")); return isFinite(x) && x > 0 ? x : padrao; };
  return {
    // fase 155a: o banco não deixa desligar com diário noturno (trg_obras_dois_turnos_guarda); a mensagem sai no aviso do salvar
    ...($("obr-dois-turnos") ? { dois_turnos: $("obr-dois-turnos").checked } : {}),
    jornada_entrada:        t("obr-jornada-entrada"),
    jornada_saida:          t("obr-jornada-saida"),
    jornada_sexta_entrada:  t("obr-jornada-sex-entrada"),
    jornada_sexta_saida:    t("obr-jornada-sex-saida"),
    // fase 155b: jornada do turno noturno; o banco recusa ligar os dois turnos sem a de segunda a quinta
    ...($("obr-jornada-not-entrada") ? {
      jornada_noturno_entrada:       t("obr-jornada-not-entrada"),
      jornada_noturno_saida:         t("obr-jornada-not-saida"),
      jornada_noturno_sexta_entrada: t("obr-jornada-not-sex-entrada"),
      jornada_noturno_sexta_saida:   t("obr-jornada-not-sex-saida")
    } : {}),
    iss_percentual:         n("obr-iss-pct", 5), // ISS do município (16/09/2026): a medição herda
    cno:                    ($("obr-cno")?.value || "").trim() || null,   // fase 93c
    meta_estacas:           Math.round(n("obr-meta-estacas", 0)),   // fase 140 (decisão 3): colunas NOT NULL, vazio grava 0
    meta_metros:            n("obr-meta-metros", 0),
    concretagem_tipo_padrao: t("obr-conc-tipo"),
    concreto_fornecedor:     t("obr-conc-fornecedor"),
    traco_kg_cimento_m3:  n("obr-conc-traco", OBR_PARAM_DEFAULTS.traco_kg_cimento_m3),
    peso_saco_kg:         n("obr-conc-peso-saco", OBR_PARAM_DEFAULTS.peso_saco_kg),
    fator_perda_concreto: n("obr-conc-fator-perda", OBR_PARAM_DEFAULTS.fator_perda_concreto),
    sinal_abatimento_modelo: t("obr-sinal-modelo") || "proporcional"
  };
}
/* Exemplo ao vivo do que a parametrização produz (ajuda a pegar traço/perda errados) */
function atualizarResumoParametrosObra(){
  const el = $("obr-param-resumo");
  if(!el) return;
  const p = lerParametrosObra();
  const linhas = [];
  if(p.jornada_entrada && p.jornada_saida){
    const m = (s) => { const [h, mi] = s.split(":").map(Number); return h * 60 + mi; };
    let dur = m(p.jornada_saida) - m(p.jornada_entrada); if(dur < 0) dur += 1440;
    linhas.push(`Jornada seg–qui: ${p.jornada_entrada}–${p.jornada_saida} (${((dur - 60) / 60).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h úteis, já descontada 1 h de almoço; acima disso vira HE 100 %).`);
    if(p.jornada_sexta_entrada && p.jornada_sexta_saida){
      let durSex = m(p.jornada_sexta_saida) - m(p.jornada_sexta_entrada); if(durSex < 0) durSex += 1440;
      linhas.push(`Sexta: ${p.jornada_sexta_entrada}–${p.jornada_sexta_saida} (${((durSex - 60) / 60).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h úteis).`);
    } else {
      linhas.push("Sexta sem jornada própria: usa a de seg–qui.");
    }
    linhas.push("Sábado, domingo e feriado: todo o trabalhado é HE 100 % (regra RH 11/09/2026).");
  } else {
    // Desde o lote S40 (#31) a obra sem jornada própria usa a jornada padrão da empresa (campo_jornada_dia / jornadaEfetiva)
    const emp = typeof _rdoJornadaEmpresa === "undefined" ? undefined : _rdoJornadaEmpresa;
    const hm = (s) => String(s || "").slice(0, 5);
    if(emp === undefined){
      linhas.push("Sem jornada própria: a hora extra do RDO usa a jornada padrão da empresa.");
      if(typeof carregarJornadaEmpresa === "function") carregarJornadaEmpresa().then(() => atualizarResumoParametrosObra()).catch(() => {});
    } else if(emp){
      const sexta = emp.jornada_sexta_entrada && emp.jornada_sexta_saida ? `, sexta ${hm(emp.jornada_sexta_entrada)}–${hm(emp.jornada_sexta_saida)}` : "";
      linhas.push(`Sem jornada própria: a hora extra do RDO usa a jornada padrão da empresa (seg–qui ${hm(emp.jornada_entrada)}–${hm(emp.jornada_saida)}${sexta}).`);
    } else {
      linhas.push("Sem jornada cadastrada e sem jornada padrão da empresa: as horas extras da equipe no RDO ficam em branco para preencher à mão.");
    }
  }
  // fase 155b: jornada noturna (só em obra de dois turnos)
  if(p.dois_turnos){
    if(p.jornada_noturno_entrada && p.jornada_noturno_saida){
      const m = (s) => { const [h, mi] = s.split(":").map(Number); return h * 60 + mi; };
      const uteis = (ent, sai) => { let dur = m(sai) - m(ent); if(dur < 0) dur += 1440; return ((dur - 60) / 60).toLocaleString("pt-BR", { maximumFractionDigits: 2 }); };
      const virada = (ent, sai) => m(sai) < m(ent) ? ", saída no dia seguinte" : "";
      linhas.push(`Jornada noturna seg–qui: ${p.jornada_noturno_entrada}–${p.jornada_noturno_saida} (${uteis(p.jornada_noturno_entrada, p.jornada_noturno_saida)} h úteis${virada(p.jornada_noturno_entrada, p.jornada_noturno_saida)}).`);
      linhas.push(p.jornada_noturno_sexta_entrada && p.jornada_noturno_sexta_saida
        ? `Sexta noturna: ${p.jornada_noturno_sexta_entrada}–${p.jornada_noturno_sexta_saida} (${uteis(p.jornada_noturno_sexta_entrada, p.jornada_noturno_sexta_saida)} h úteis).`
        : "Sexta noturna sem jornada própria: usa a de seg–qui.");
    } else {
      linhas.push("Dois turnos sem jornada noturna: preencha a de segunda a quinta para salvar.");
    }
  }
  if(p.concretagem_tipo_padrao === "saco"){
    linhas.push(`Saco: 10 sacos de ${p.peso_saco_kg} kg com traço ${p.traco_kg_cimento_m3} kg/m³ = ${(p.peso_saco_kg * 10 / p.traco_kg_cimento_m3).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³.`);
  } else if(p.concretagem_tipo_padrao === "usinado"){
    const v = Math.pow(400 / 2000, 2) * Math.PI * 10 * p.fator_perda_concreto;
    linhas.push(`Usinado: estaca Ø400 mm × 10 m com perda ${p.fator_perda_concreto} = ${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³.`);
  } else {
    linhas.push("Sem tipo de concretagem: o cálculo automático do RDO assume usinado com os padrões.");
  }
  if(p.concreto_fornecedor === "cliente") linhas.push("Concreto fornecido pelo cliente: o volume calculado é controle de consumo, não custo da CGL.");
  if(p.sinal_abatimento_modelo === "cliente") linhas.push("Sinal: o cliente elabora o boletim e já consumiu o sinal no quadro dele; as medições desta obra não descontam sinal.");
  else if(p.sinal_abatimento_modelo === "percentual") linhas.push("Sinal: cada medição desconta o % do sinal sobre o contrato, até zerar o saldo.");
  else linhas.push("Sinal: cada medição desconta subtotal × saldo do sinal ÷ saldo a medir; aditivo ou redução do contrato ajustam a fração sozinhos.");
  el.textContent = linhas.join(" ");
}
/* Fase 155b: o bloco da jornada noturna aparece com a chave dos dois turnos (ou quando já tem jornada noturna gravada).
   Hotfix 295: o bloco virou as abas "diurno" e "noturno"; sem os dois turnos fica só a jornada diurna, sem abas.
   aba = "diurno" ou "noturno"; sem argumento mantém a aba aberta. */
function obrMostrarJornadaNoturna(aba){
  const bloco = $("obr-jornada-noturna-bloco");
  if(!bloco) return;
  const tem = ["obr-jornada-not-entrada","obr-jornada-not-saida","obr-jornada-not-sex-entrada","obr-jornada-not-sex-saida"].some(id => $(id)?.value);
  const abas = !!($("obr-dois-turnos")?.checked || tem);
  bloco.style.display = abas ? "" : "none";
  if(aba === "diurno" || aba === "noturno") obrMostrarJornadaNoturna.aba = aba;   // a aba aberta fica guardada na própria função
  const atual = abas && obrMostrarJornadaNoturna.aba === "noturno" ? "noturno" : "diurno";
  const pd = $("obr-jornada-painel-diurno"), pn = $("obr-jornada-painel-noturno");
  if(pd) pd.style.display = atual === "diurno" ? "" : "none";
  if(pn) pn.style.display = atual === "noturno" ? "" : "none";
  if(typeof document !== "undefined") document.querySelectorAll("#obr-jornada-abas [data-turno]").forEach(b => {
    const on = b.dataset.turno === atual;
    b.classList.toggle("ativo", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}

/* ---------- Salvar (insert ou update) ---------- */
async function salvarObra(novoStatus){
  const cliente_id = $("obr-cliente").value;
  if(!cliente_id){ aviso("app-aviso","Selecione o cliente da obra.","erro"); ativarTabObra("geral"); return; }
  if(!$("obr-codigo").value || !$("obr-nome").value){
    aviso("app-aviso","Preencha código e nome da obra.","erro"); ativarTabObra("geral"); return;
  }
  const reg = {
    codigo: $("obr-codigo").value.trim(),
    nome: $("obr-nome").value.trim(),
    cliente_id,
    status: novoStatus || $("obr-status").value,
    responsavel_id: $("obr-responsavel").value || null,
    data_inicio: $("obr-inicio").value || null,
    data_fim_prevista: $("obr-fim-prev").value || null,
    data_fim_real: $("obr-fim-real").value || null,
    cep: $("obr-cep").value.trim() || null,
    logradouro: $("obr-logradouro").value.trim() || null,
    numero: $("obr-numero").value.trim() || null,
    complemento: $("obr-complemento").value.trim() || null,
    bairro: $("obr-bairro").value.trim() || null,
    cidade: $("obr-cidade").value.trim() || null,
    uf: $("obr-uf").value || null,
    descricao: $("obr-descricao").value.trim() || null,
    observacoes: $("obr-obs").value.trim() || null,
    // fase 182a: nome do projeto (digitado, opcional) e "obra para" (nulo = o próprio cliente); obras.nome não muda
    nome_projeto: ($("obr-nome-projeto")?.value || "").trim() || null,
    obra_para_id: (($("obr-obra-para")?.value || "") !== cliente_id && $("obr-obra-para")?.value) || null,
    ...lerParametrosObra()
  };
  // fase 155b: mesma regra do gatilho trg_obras_dois_turnos_guarda, dita antes de ir ao banco
  if(reg.dois_turnos && "jornada_noturno_entrada" in reg && (!reg.jornada_noturno_entrada || !reg.jornada_noturno_saida)){
    aviso("app-aviso", "Preencha a jornada noturna (segunda a quinta) antes de ligar os dois turnos.", "erro");
    ativarTabObra("parametros"); obrMostrarJornadaNoturna("noturno"); obrFocarCampo(reg.jornada_noturno_entrada ? "obr-jornada-not-saida" : "obr-jornada-not-entrada");
    return;
  }
  // fase 105a: município da prestação (só com a coluna no banco)
  if(_obrTemIbge){
    reg.codigo_ibge = ($("obr-ibge")?.value || "").replace(/\D/g, "") || null;
    if(reg.codigo_ibge && reg.codigo_ibge.length !== 7){ aviso("app-aviso", "Código IBGE do município tem 7 dígitos (busque pelo CEP).", "erro"); ativarTabObra("endereco"); return; }
  }

  const obraNova = !obraEditId;   // fase 157a: obra nova com orçamento de mobilização já nasce com a mobilização prevista
  const gravar = (r) => obraEditId
    ? sb.from("obras").update(r).eq("id", obraEditId).select().single()
    : sb.from("obras").insert(r).select().single();
  let result = await gravar(reg);
  // obras.sinal_abatimento_modelo depende de migration da sessão de gestão: enquanto a coluna
  // não existe, grava o resto e avisa, em vez de perder a obra inteira
  let semColunaSinal = false;
  if(result.error && /sinal_abatimento_modelo/i.test(result.error.message || "")){
    const { sinal_abatimento_modelo, ...semSinal } = reg;
    result = await gravar(semSinal);
    semColunaSinal = true;
  }
  if(result.error){
    aviso("app-aviso","Não foi possível salvar a obra: "+result.error.message,"erro");
    return;
  }
  if(semColunaSinal) console.warn("obras.sinal_abatimento_modelo ainda não existe no banco — modelo de abatimento não gravado (usa 'proporcional').");
  obraEditId = result.data.id;
  $("btn-excluir-obra").style.display = "";
  $("obr-status").value = result.data.status;

  // Fase 90: o valor contratado vive em obras_financeiro (RLS própria: só quem lê financeiro). Grava só quando o
  // campo está visível; a linha da obra nova já nasceu zerada pelo gatilho trg_obras_financeiro_criar.
  let msgFim = "Obra salva com sucesso.", tipoFim = "ok";
  if(podeVerValorObra()){
    const valor = Number($("obr-valor").value || 0);
    // fase 91: % e prazo da caução negociados na obra (vazio = sem % sugerido / prazo padrão da empresa)
    const cauPct = $("obr-caucao-pct")?.value, cauPrazo = $("obr-caucao-prazo")?.value;
    const { error: eFin } = await sb.from("obras_financeiro").upsert({ obra_id: obraEditId, valor_contratado: valor,
      caucao_percentual: cauPct === "" || cauPct == null ? null : Number(cauPct),
      caucao_prazo_dias: cauPrazo === "" || cauPrazo == null ? null : parseInt(cauPrazo, 10) });
    if(eFin){ msgFim = "Obra salva, mas o valor contratado não pôde ser gravado: " + eFin.message; tipoFim = "erro"; }
    else result.data.valor_contratado = valor;   // espelho de obras_financeiro para o contrato do cliente (abaixo)
  }

  // Contrato do cliente (aba Contrato) — espelha os dados da obra recém-salva
  const contratoId = await salvarContratoDaObra(result.data);
  if(contratoId && contratoId !== result.data.contrato_id){
    const { error: errVinc } = await sb.from("obras")
      .update({ contrato_id: contratoId }).eq("id", obraEditId);
    if(errVinc) aviso("app-aviso","Contrato gravado, mas não foi possível vinculá-lo à obra: "+errVinc.message,"erro");
  }
  // fase 157a: só quando o contrato vem de orçamento com item MOB.* (sem orçamento a RPC devolve nulo e nada muda)
  if(obraNova){
    const { data: mobId, error: eMob } = await sb.rpc("mobilizacao_prevista_do_orcamento", { p_obra: obraEditId });
    if(eMob) console.warn("mobilização prevista da obra nova:", eMob.message);
    else if(mobId) msgFim += " Mobilização prevista criada no quadro de Mobilizações.";
  }

  aviso("app-aviso", msgFim, tipoFim);
  await carregarObras();
  await carregarDashboard();
  if(typeof carregarContratos === "function") await carregarContratos();
  // re-abre com dados frescos
  await abrirObra(obraEditId);
}

async function excluirObra(){
  if(!obraEditId) return;
  if(!confirm("Excluir esta obra? Esta ação não pode ser desfeita.")) return;
  const { error } = await sb.from("obras").delete().eq("id", obraEditId);
  if(error){
    aviso("app-aviso","Não foi possível excluir: "+error.message,"erro");
    return;
  }
  aviso("app-aviso","Obra excluída.","ok");
  await carregarObras();
  await carregarDashboard();
  mostrarPainelObra();
}

/* ---------- Listeners ---------- */
function ligarObras(){
  // fase 179: produção mínima por dia (aba Parâmetros), gravada à parte do Salvar da obra
  $("obr-btn-prod-sugerir")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, obrProdMinSugerir));
  $("obr-btn-prod-gravar")?.addEventListener("click", (e) => comBotaoTravado(e.currentTarget, obrProdMinGravar));
  // Painel: visões, filtros, clique nas linhas, nova obra
  document.querySelectorAll("#obr-painel .serv-view-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#obr-painel .serv-view-btn").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _obrView = b.dataset.view;
      renderObras();
    });
  });
  ["obr-busca","obr-f-status","obr-f-cliente"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "obr-busca" ? "input" : "change", id === "obr-busca" ? debounce(renderObras) : renderObras);
  });
  $("obr-conteudo")?.addEventListener("click", async (e) => {
    const gravar = e.target.closest("[data-obr-nome-gravar]");   // fase 182a: Nomes a completar, uma linha por vez
    if(gravar){ await comBotaoTravado(gravar, () => obrNomesGravar(gravar.dataset.obrNomeGravar)); return; }
    const tr = e.target.closest(".linha-clicavel");
    if(!tr || !tr.dataset.id) return;
    await abrirObra(tr.dataset.id);
    // fase 75: vindo do "Para regularizar", abre direto onde falta preencher
    if(_obrFiltroIds?.aba){ ativarTabObra(_obrFiltroIds.aba); obrFocarCampo(_obrFiltroIds.foco); }
  });
  $("obr-f-ids")?.addEventListener("click", (e) => {
    if(e.target.closest("#obr-f-ids-limpar")){ _obrFiltroIds = null; renderObras(); }
  });

  // fase 182a: "Obra para" acompanha o cliente; sugestão do orçamento só copia para o campo
  $("obr-cliente")?.addEventListener("change", obrClienteMudou);
  $("obr-projeto-sugestao")?.addEventListener("click", (e) => {
    const sug = e.currentTarget;
    if(!e.target.closest("[data-obr-projeto-usar]") || !sug.dataset.valor) return;
    $("obr-nome-projeto").value = sug.dataset.valor;
    sug.innerHTML = ""; delete sug.dataset.valor;
  });

  $("btn-nova-obra")?.addEventListener("click", novaObra);
  $("btn-obr-xlsx")?.addEventListener("click", obrExportarXlsx);   // lote S56c (#174)
  $("btn-voltar-obra")?.addEventListener("click", mostrarPainelObra);
  $("btn-salvar-obra")?.addEventListener("click", () => comBotaoTravado("btn-salvar-obra", () => salvarObra()));
  $("btn-excluir-obra")?.addEventListener("click", excluirObra);
  $("btn-obr-concluir")?.addEventListener("click", () => comBotaoTravado("btn-obr-concluir", obrConcluirObra));   // lote S44 (L9)

  // Notebook
  document.querySelectorAll("#obr-notebook button").forEach(b => {
    b.addEventListener("click", () => ativarTabObra(b.dataset.tab));
  });
  // fase 105a: CEP → endereço, cidade, UF e código IBGE do município (ViaCEP)
  if(typeof fiscalLigarCep === "function") fiscalLigarCep({ cep: "obr-cep", botao: "btn-obr-cep", status: "obr-cep-status",
    logradouro: "obr-logradouro", bairro: "obr-bairro", cidade: "obr-cidade", uf: "obr-uf", ibge: "obr-ibge" });
  // Aba Parâmetros: resumo ao vivo da jornada/concretagem
  // fase 155b; hotfix 295: ligar a chave abre a aba noturna (obrigatória para salvar), desligar volta à diurna
  $("obr-dois-turnos")?.addEventListener("change", (e) => { obrMostrarJornadaNoturna(e.target.checked ? "noturno" : "diurno"); atualizarResumoParametrosObra(); });
  document.querySelectorAll("#obr-jornada-abas [data-turno]").forEach(b => {
    b.addEventListener("click", () => obrMostrarJornadaNoturna(b.dataset.turno));
  });
  ["obr-jornada-entrada","obr-jornada-saida","obr-jornada-sex-entrada","obr-jornada-sex-saida",
   "obr-jornada-not-entrada","obr-jornada-not-saida","obr-jornada-not-sex-entrada","obr-jornada-not-sex-saida",
   "obr-conc-tipo","obr-conc-fornecedor","obr-conc-traco","obr-conc-peso-saco","obr-conc-fator-perda","obr-sinal-modelo"].forEach(id => {
    $(id)?.addEventListener("input", atualizarResumoParametrosObra);
    $(id)?.addEventListener("change", atualizarResumoParametrosObra);
  });

  // Statusbar clicável (muda status)
  document.querySelectorAll("#obr-statusbar .stage").forEach(el => {
    el.addEventListener("click", async () => {
      const novo = el.dataset.status;
      if(!obraEditId){
        // novo registro: só atualiza form
        $("obr-status").value = novo;
        atualizarStatusbarObra(novo);
        return;
      }
      if(novo === $("obr-status").value) return;
      // lote S44 (L9): o financeiro não grava o formulário inteiro (policy/gatilho barram); só conclui
      if(obrEhFinanceiro()){
        if(novo === "concluida" && $("btn-obr-concluir")?.style.display !== "none") await obrConcluirObra();
        else aviso("app-aviso", "Seu cargo só marca a obra como concluída depois do último recebimento (última medição faturada e recebida; até o controle de recebimentos entrar, faturada).", "erro");
        return;
      }
      await salvarObra(novo);
    });
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarObras);
} else {
  ligarObras();
}

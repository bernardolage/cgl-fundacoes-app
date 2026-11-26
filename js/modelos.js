













let _mdlModo = "contratos";
let _mdlRegistros = [];
let _mdlErro = "";
let _mdlCarregando = false;
let _mdlBusca = "";
let _mdlTipo = "";
let mdlEditId = null;
let _mdlVersoes = [];
let _mdlVersoesErro = "";
let _mdlNomes = {};
let _mdlAba = "texto";
let _mdlBuffer = null;
let _mdlCmp = { de: "", para: "" };
let _mdlCampos = {};

const MDL_TIPO = { proposta: "Proposta", contrato: "Contrato" };
const MDL_SEGMENTO = { helice: "Hélice contínua", trado: "Trado mecanizado", raiz: "Estaca raiz", secante: "Hélice secante" };
if(typeof STATUS === "object" && STATUS && !STATUS.modelo_versao){
  STATUS.modelo_versao = {
    rascunho:             { label: "Rascunho", cor: "cinza" },
    aguardando_aprovacao: { label: "Aguardando aprovação", cor: "ambar" },
    vigente:              { label: "Vigente", cor: "verde" },
    substituida:          { label: "Substituída", cor: "cinza" }
  };
}


function mdlPodeVer(){ return typeof podeVerContratos === "function" && podeVerContratos(); }
function mdlPodeEditar(){ return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "juridico"].includes(usuarioAtual.cargo); }

function mdlPodeAprovar(){ return !!usuarioAtual && usuarioAtual.cargo === "diretor"; }

const mdlNome = (id) => (id && _mdlNomes[id]) || "—";
const mdlSegmento = (m) => m && m.tipo === "proposta" ? (MDL_SEGMENTO[m.segmento] || m.segmento || "—") : (m && m.segmento) || "—";
const mdlModeloAberto = () => _mdlRegistros.find(m => m.id === mdlEditId) || null;
const mdlVigente = () => _mdlVersoes.find(v => v.situacao === "vigente") || null;
const mdlAberta = () => _mdlVersoes.find(v => v.situacao === "rascunho" || v.situacao === "aguardando_aprovacao") || null;

function mdlErrosTexto(m, texto){
  if(!m || m.tipo !== "proposta" || typeof propostaModeloLer !== "function") return [];
  return propostaModeloLer(texto).erros;
}
function mdlErroDoBanco(error){
  const semView = error && ["42P01", "PGRST205", "PGRST200", "42703"].includes(error.code);
  return semView ? "Modelos ainda não disponível: a migration da fase 180e não foi aplicada." : "Não foi possível carregar os modelos: " + ((error && error.message) || "erro desconhecido");
}


function mdlRenderModos(){
  const cx = $("con-modos");
  if(!cx) return;
  if(!mdlPodeVer()){ cx.innerHTML = ""; _mdlModo = "contratos"; mdlAplicarModo(); return; }
  const pend = _mdlRegistros.filter(m => m.aberta_situacao === "aguardando_aprovacao").length;
  cx.innerHTML = uiAbas([
    { id: "contratos", rotulo: "Contratos", resumo: "Receita e despesa" },
    { id: "modelos", rotulo: "Modelos", resumo: pend ? `${pend} aguardando aprovação` : "Contrato e proposta" }
  ], { ativa: _mdlModo, rotulo: "Contratos ou modelos" });
  mdlAplicarModo();
}
function mdlAplicarModo(){
  const area = $("con-area"), painel = $("mdl-painel");
  if(area) area.hidden = _mdlModo === "modelos";
  if(painel) painel.hidden = _mdlModo !== "modelos";
}
async function mdlAtivarModo(modo){
  _mdlModo = modo === "modelos" ? "modelos" : "contratos";
  mdlRenderModos();
  if(_mdlModo === "modelos"){ mdlEditId = null; await carregarModelos(); }
}


async function carregarModelos(){
  if(!mdlPodeVer()) return;
  _mdlCarregando = true; _mdlErro = "";
  if(!mdlEditId) renderModelos();
  const { data, error } = await sb.from("vw_modelos_documento").select("*").order("tipo", { ascending: false }).order("nome");
  _mdlCarregando = false;
  if(error){ _mdlErro = mdlErroDoBanco(error); _mdlRegistros = []; }
  else _mdlRegistros = data || [];
  mdlRenderModos();
  if(mdlEditId) await abrirModelo(mdlEditId, _mdlAba); else renderModelos();
}

function mdlSituacaoAberta(m){
  if(!m.aberta_id) return "—";
  if(m.aberta_situacao === "aguardando_aprovacao") return `${tagStatus("modelo_versao", "aguardando_aprovacao")} <span class="meta">v${Number(m.aberta_numero)}</span>`;
  return m.aberta_devolvido_em ? `<span class="tag vermelho">Devolvido</span> <span class="meta">v${Number(m.aberta_numero)}</span>`
    : `${tagStatus("modelo_versao", "rascunho")} <span class="meta">v${Number(m.aberta_numero)}</span>`;
}
function renderModelos(){
  const cx = $("mdl-painel");
  if(!cx) return;
  const busca = _mdlBusca.trim().toLowerCase();
  const lista = _mdlRegistros
    .filter(m => !_mdlTipo || m.tipo === _mdlTipo)
    .filter(m => !busca || `${m.nome || ""} ${m.descricao || ""} ${mdlSegmento(m)}`.toLowerCase().includes(busca));
  const colunas = [
    { chave: "tipo", rotulo: "Tipo", html: m => esc(MDL_TIPO[m.tipo] || m.tipo) },
    { chave: "segmento", rotulo: "Segmento", html: m => esc(mdlSegmento(m)) },
    { chave: "nome", rotulo: "Modelo", html: m => `<strong>${esc(m.nome)}</strong>${m.descricao ? `<div class="meta">${esc(m.descricao)}</div>` : ""}` },
    { chave: "vigente_numero", rotulo: "Vigente", html: m => m.vigente_id ? `${uiCodigo("v" + m.vigente_numero)} <span class="meta">${esc(dataBR(String(m.vigente_aprovado_em || "").slice(0, 10)))} · ${esc(m.vigente_aprovado_por_nome || "—")}</span>` : `<span class="meta">sem versão vigente</span>` },
    { chave: "aberta_situacao", rotulo: "Em andamento", html: m => mdlSituacaoAberta(m) },
    { chave: "versoes", rotulo: "Versões", tipo: "int" }
  ];
  const tipoOp = [["proposta", "Proposta"], ["contrato", "Contrato"]];
  cx.innerHTML = uiPagina({
      titulo: "Modelos de contrato e de proposta",
      sub: "O jurídico escreve o rascunho e envia; só o diretor aprova. A proposta imprime a versão vigente do segmento.",
      acoes: mdlPodeEditar() ? [{ id: "novo", texto: "Novo modelo", primaria: true, titulo: "Cria um modelo de contrato (ou de proposta de um segmento sem modelo)" }] : []
    })
    + `<div class="mdl-barra">${uiCampo({ id: "mdl-f-tipo", rotulo: "Tipo", tipo: "select", opcoes: tipoOp, valor: _mdlTipo, placeholder: "Todos" })}</div>`
    + uiFiltros({ id: "mdl-busca", busca: _mdlBusca, placeholder: "Buscar modelo ou segmento",
        filtros: [{ id: "tipo", rotulo: "Tipo", valor: _mdlTipo ? MDL_TIPO[_mdlTipo] : "" }],
        total: _mdlErro || _mdlCarregando ? null : lista.length, unidade: ["modelo", "modelos"] })
    + `<div class="mdl-lista">${uiTabela({ colunas, linhas: lista, chaveLinha: "id", erro: _mdlErro || null, carregando: _mdlCarregando && !_mdlRegistros.length,
        vazio: _mdlRegistros.length ? "Nenhum modelo com este filtro." : "Nenhum modelo que o seu perfil leia." })}</div>`;
}


async function abrirModelo(id, aba){
  mdlEditId = id;
  if(_mdlModo !== "modelos"){ _mdlModo = "modelos"; mdlRenderModos(); }
  _mdlVersoesErro = "";
  const { data, error } = await sb.from("modelos_documento_versoes")
    .select("id,modelo_id,numero,situacao,texto,resumo_alteracao,autor_id,enviado_por,enviado_em,aprovado_por,aprovado_em,substituida_em,devolvido_por,devolvido_em,devolvido_motivo,created_at,updated_at")
    .eq("modelo_id", id).order("numero", { ascending: false });
  if(error){ _mdlVersoesErro = mdlErroDoBanco(error); _mdlVersoes = []; }
  else _mdlVersoes = data || [];
  const ids = [...new Set(_mdlVersoes.flatMap(v => [v.autor_id, v.enviado_por, v.aprovado_por, v.devolvido_por]).filter(x => x && !_mdlNomes[x]))];
  if(ids.length){
    const { data: ps } = await sb.from("profiles").select("id,nome").in("id", ids);
    (ps || []).forEach(p => { _mdlNomes[p.id] = p.nome; });
  }
  const ab = mdlAberta();
  if(!_mdlBuffer || _mdlBuffer.modeloId !== id || (ab && _mdlBuffer.versaoId !== ab.id) || (!ab && _mdlBuffer.versaoId)){
    _mdlBuffer = ab && ab.situacao === "rascunho" ? { modeloId: id, versaoId: ab.id, texto: ab.texto, resumo: ab.resumo_alteracao || "", sujo: false } : null;
  }
  const vg = mdlVigente();
  _mdlCmp = { de: vg ? vg.id : (_mdlVersoes[1] || {}).id || "", para: ab ? ab.id : (vg ? vg.id : "") };
  if(ab && vg) _mdlCmp = { de: vg.id, para: ab.id };
  else if(!ab && vg){ const ant = _mdlVersoes.find(v => v.numero < vg.numero); _mdlCmp = { de: ant ? ant.id : vg.id, para: vg.id }; }
  _mdlAba = aba || (ab && ab.situacao === "aguardando_aprovacao" && mdlPodeAprovar() ? "comparar" : "texto");
  renderFichaModelo();
}

function mdlFaixa(m){
  const vg = mdlVigente(), ab = mdlAberta();
  const frases = [], tom = ab && ab.situacao === "aguardando_aprovacao" ? "aviso" : vg ? "ok" : "neutro";
  frases.push(vg ? `Vigente: versão ${vg.numero}` : "Sem versão vigente");
  if(vg) frases.push(`aprovada em ${dataBR(String(vg.aprovado_em || "").slice(0, 10))} por ${mdlNome(vg.aprovado_por)}`);
  if(ab && ab.situacao === "aguardando_aprovacao") frases.push(`versão ${ab.numero} aguardando a aprovação do diretor desde ${dataBR(String(ab.enviado_em || "").slice(0, 10))}`);
  else if(ab && ab.devolvido_em) frases.push(`versão ${ab.numero} devolvida pelo diretor em ${dataBR(String(ab.devolvido_em).slice(0, 10))}`);
  else if(ab) frases.push(`rascunho da versão ${ab.numero} em edição`);
  if(m.tipo === "proposta") frases.push("é o texto que sai na proposta de " + mdlSegmento(m).toLowerCase());
  return uiFaixaSituacao(frases, tom);
}

function renderFichaModelo(){
  const cx = $("mdl-painel");
  const m = mdlModeloAberto();
  if(!cx) return;
  if(!m){ mdlEditId = null; renderModelos(); return; }
  const vg = mdlVigente(), ab = mdlAberta();
  const aguardando = ab && ab.situacao === "aguardando_aprovacao";
  const acoes = [], menu = [];
  if(aguardando && mdlPodeAprovar()) acoes.push({ id: "aprovar", texto: "Revisar e aprovar", primaria: true, titulo: "Mostra o que mudou e aprova ou devolve" });
  if(!ab && mdlPodeEditar()) acoes.push({ id: "novo-rascunho", texto: "Novo rascunho", primaria: true, titulo: "Começa a versão seguinte a partir do texto vigente" });
  if(aguardando && mdlPodeAprovar()) menu.push({ id: "devolver", texto: "Devolver ao jurídico" });
  if(aguardando && mdlPodeEditar()) menu.push({ id: "retirar", texto: "Retirar do envio" });
  if(mdlPodeEditar()) menu.push({ id: "editar", texto: "Nome e descrição" });
  const podeVerAberta = !!ab || mdlPodeEditar();
  const abas = [
    { id: "texto", rotulo: "Texto vigente", resumo: vg ? `versão ${vg.numero}` : "sem vigente" },
    podeVerAberta ? { id: "rascunho", rotulo: aguardando ? "Em aprovação" : "Rascunho", resumo: ab ? `versão ${ab.numero}` : (_mdlBuffer ? "não salvo" : "nenhum") } : null,
    { id: "comparar", rotulo: "Comparar", resumo: "o que mudou" },
    { id: "versoes", rotulo: "Versões", resumo: `${_mdlVersoes.length}` }
  ].filter(Boolean);
  if(!abas.some(a => a.id === _mdlAba)) _mdlAba = "texto";
  cx.innerHTML = `<div class="mdl-ficha">`
    + uiPagina({ trilha: [{ texto: "Modelos", id: "voltar" }, { texto: m.nome }], titulo: m.nome,
        sub: `${MDL_TIPO[m.tipo] || m.tipo} · ${mdlSegmento(m)}${m.descricao ? " · " + m.descricao : ""}`, acoes, menuAcoes: menu, erro: _mdlVersoesErro || null })
    + mdlFaixa(m)
    + uiAbas(abas, { ativa: _mdlAba, rotulo: "Partes do modelo" })
    + `<div id="mdl-aba-corpo">${  mdlCorpoAba(m)}</div></div>`;
  mdlAtualizarErros();
}

function mdlCorpoAba(m){
  const vg = mdlVigente(), ab = mdlAberta();
  if(_mdlAba === "texto"){
    return vg ? uiTextoBloco(vg.texto, { numerar: true }) : uiVazio("Este modelo ainda não tem versão vigente: o diretor aprova a primeira.");
  }
  if(_mdlAba === "rascunho"){
    if(ab && ab.situacao === "aguardando_aprovacao"){
      return `<p class="mdl-ajuda">Enviada por ${esc(mdlNome(ab.enviado_por))} em ${esc(dataHoraBR(ab.enviado_em))}${ab.resumo_alteracao ? ` · ${esc(ab.resumo_alteracao)}` : ""}. O texto não muda enquanto espera o diretor; para corrigir, use "Retirar do envio".</p>`
        + uiTextoBloco(ab.texto, { numerar: true });
    }
    if(!mdlPodeEditar()) return ab ? uiTextoBloco(ab.texto, { numerar: true }) : uiVazio("Nenhum rascunho em edição.");
    if(!_mdlBuffer) return uiVazio('Nenhum rascunho em edição. Use "Novo rascunho" para começar a versão seguinte a partir do texto vigente.');
    const devolvido = ab && ab.devolvido_em
      ? `<p class="mdl-ajuda"><strong>Devolvido pelo diretor</strong> (${esc(mdlNome(ab.devolvido_por))}, ${esc(dataHoraBR(ab.devolvido_em))}): ${esc(ab.devolvido_motivo || "")}</p>` : "";
    const ajuda = m.tipo === "proposta"
      ? `<p class="mdl-ajuda">Uma linha por item. <strong>## Encargos</strong> abre a tabela de encargos; cada encargo começa com o responsável entre colchetes: [CGL], [CONTRATANTE], [NÃO APLICA], [CGL se diesel] (ou hospedagem, alimentação), [só com alimentação; CGL], e "; destaque" para a linha amarela. <strong>## Cláusulas: TÍTULO</strong> abre uma seção de cláusulas; [destaque] deixa a cláusula em negrito. Campos: {{pagamento}}, {{clausula_refuro}}, {{validade_dias}}, {{validade_extenso}}.</p>`
      : `<p class="mdl-ajuda">Texto do contrato. Campos entre chaves duplas, como {{cliente.razao_social}} e {{valor}}, ficam para o preenchimento.</p>`;
    return devolvido + ajuda
      + uiCampo({ id: "mdl-resumo", rotulo: "O que mudou nesta versão", valor: _mdlBuffer.resumo, placeholder: "Ex.: cláusula de chuva com 50% do faturamento mínimo" })
      + `<div class="mdl-editor">${uiCampo({ id: "mdl-texto", rotulo: `Texto da versão ${ab ? ab.numero : "nova"}`, tipo: "textarea", linhas: 28, valor: _mdlBuffer.texto })}</div>`
      + `<ul class="mdl-erros" id="mdl-erros" aria-live="polite"></ul>`
      + `<div class="mdl-barra">
          <button type="button" class="ui-btn ui-btn-prim" data-mdl="salvar">Salvar rascunho</button>
          <button type="button" class="ui-btn" data-mdl="enviar" title="Salva e manda para a aprovação do diretor">Enviar para aprovação</button>
          <button type="button" class="ui-btn ui-btn-perigo" data-mdl="excluir" title="Apaga este rascunho; a versão vigente continua valendo">${ab ? "Excluir rascunho" : "Descartar"}</button>
        </div>`;
  }
  if(_mdlAba === "comparar"){
    const op = _mdlVersoes.map(v => [v.id, `Versão ${v.numero} · ${STATUS.modelo_versao[v.situacao] ? STATUS.modelo_versao[v.situacao].label : v.situacao}`]);
    if(_mdlBuffer && _mdlBuffer.sujo) op.unshift(["buffer", "Rascunho na tela (não salvo)"]);
    const textoDe = (id) => id === "buffer" ? (_mdlBuffer ? _mdlBuffer.texto : "") : ((_mdlVersoes.find(v => v.id === id) || {}).texto || "");
    const rot = (id) => (op.find(o => o[0] === id) || [null, "—"])[1];
    return `<div class="mdl-barra">${uiCampo({ id: "mdl-cmp-de", rotulo: "De", tipo: "select", opcoes: op, valor: _mdlCmp.de })}${uiCampo({ id: "mdl-cmp-para", rotulo: "Para", tipo: "select", opcoes: op, valor: _mdlCmp.para })}</div>`
      + (op.length < 2 && !(_mdlBuffer && _mdlBuffer.sujo) ? uiVazio("Só há uma versão: nada a comparar ainda.")
        : uiDiffLinhas(textoDe(_mdlCmp.de), textoDe(_mdlCmp.para), { rotuloAntes: rot(_mdlCmp.de), rotuloDepois: rot(_mdlCmp.para) }));
  }
  const colunas = [
    { chave: "numero", rotulo: "Versão", html: v => uiCodigo("v" + v.numero) },
    { chave: "situacao", rotulo: "Situação", html: v => tagStatus("modelo_versao", v.situacao) },
    { chave: "autor_id", rotulo: "Autor", html: v => esc(mdlNome(v.autor_id)) },
    { chave: "enviado_em", rotulo: "Enviada", html: v => v.enviado_em ? esc(dataHoraBR(v.enviado_em)) : "—" },
    { chave: "aprovado_em", rotulo: "Aprovada", html: v => v.aprovado_em ? `${esc(dataHoraBR(v.aprovado_em))} <span class="meta">${esc(mdlNome(v.aprovado_por))}</span>` : "—" },
    { chave: "substituida_em", rotulo: "Substituída", html: v => v.substituida_em ? esc(dataHoraBR(v.substituida_em)) : "—" },
    { chave: "resumo_alteracao", rotulo: "O que mudou", html: v => esc(v.resumo_alteracao || (v.devolvido_motivo ? "Devolvida: " + v.devolvido_motivo : "")) }
  ];
  return `<div class="mdl-lista">${uiTabela({ colunas, linhas: _mdlVersoes, chaveLinha: "id", erro: _mdlVersoesErro || null, vazio: "Nenhuma versão que o seu perfil leia." })}</div>`;
}

function mdlAtualizarErros(){
  const ul = $("mdl-erros");
  if(!ul || !_mdlBuffer) return;
  const erros = mdlErrosTexto(mdlModeloAberto(), _mdlBuffer.texto);
  ul.innerHTML = erros.slice(0, 12).map(e => `<li>${e.linha ? `Linha ${Number(e.linha)}: ` : ""}${esc(e.msg)}</li>`).join("")
    + (erros.length > 12 ? `<li>… e mais ${Number(erros.length - 12)}.</li>` : "");
}


async function mdlRpc(nome, args, ok){
  const { data, error } = await sb.rpc(nome, args);
  if(error){ uiAvisar(error.message || "Não foi possível concluir.", "perigo"); return { erro: true }; }
  if(ok) uiAvisar(ok, "ok");
  return { data };
}
async function salvarModeloRascunho(){
  const m = mdlModeloAberto();
  if(!m || !_mdlBuffer) return null;
  const r = await mdlRpc("modelo_rascunho_salvar", { p_modelo: m.id, p_texto: _mdlBuffer.texto, p_resumo: _mdlBuffer.resumo || null });
  if(r.erro) return null;
  _mdlBuffer.versaoId = r.data; _mdlBuffer.sujo = false;
  return r.data;
}
async function mdlAcaoEditor(acao){
  const m = mdlModeloAberto();
  if(!m) return;
  if(acao === "salvar"){
    if(await salvarModeloRascunho()){ uiAvisar("Rascunho salvo. A versão vigente continua valendo até o diretor aprovar.", "ok"); await carregarModelos(); }
  } else if(acao === "enviar"){
    const erros = mdlErrosTexto(m, _mdlBuffer ? _mdlBuffer.texto : "");
    if(erros.length){ uiAvisar(`O texto tem ${erros.length} erro(s) de formato; corrija antes de enviar (a lista está embaixo do texto).`, "aviso"); return; }
    if(!(await uiConfirmar({ titulo: "Enviar para aprovação", texto: "O rascunho vai para a Minha fila do diretor e não muda mais até ele aprovar ou devolver. Até lá vale a versão vigente.", confirmar: "Enviar" }))) return;
    const id = await salvarModeloRascunho();
    if(!id) return;
    const r = await mdlRpc("modelo_versao_enviar", { p_versao: id, p_resumo: _mdlBuffer ? _mdlBuffer.resumo || null : null }, "Enviado para a aprovação do diretor.");
    if(!r.erro){ _mdlBuffer = null; _mdlAba = "rascunho"; await carregarModelos(); }
  } else if(acao === "excluir"){
    const ab = mdlAberta();
    if(!ab){ _mdlBuffer = null; _mdlAba = "texto"; renderFichaModelo(); return; }
    if(!(await uiConfirmar({ titulo: "Excluir rascunho", texto: `O rascunho da versão ${ab.numero} será apagado. A versão vigente continua valendo.`, confirmar: "Excluir", perigo: true }))) return;
    const r = await mdlRpc("modelo_rascunho_excluir", { p_versao: ab.id }, "Rascunho excluído.");
    if(!r.erro){ _mdlBuffer = null; _mdlAba = "texto"; await carregarModelos(); }
  }
}

async function mdlAprovar(){
  const m = mdlModeloAberto(), vg = mdlVigente(), ab = mdlAberta();
  if(!m || !ab || ab.situacao !== "aguardando_aprovacao") return;
  const erros = mdlErrosTexto(m, ab.texto);
  const corpo = `<p class="mdl-ajuda">Enviada por ${esc(mdlNome(ab.enviado_por))} em ${esc(dataHoraBR(ab.enviado_em))}${ab.resumo_alteracao ? ` · ${esc(ab.resumo_alteracao)}` : ""}.
      ${vg ? `Ao aprovar, a versão ${Number(vg.numero)} vira substituída e a ${Number(ab.numero)} passa a valer${m.tipo === "proposta" ? " nas propostas geradas daqui em diante" : ""}.` : "Será a primeira versão vigente."}</p>`
    + (erros.length ? `<ul class="mdl-erros">${erros.slice(0, 8).map(e => `<li>${e.linha ? `Linha ${Number(e.linha)}: ` : ""}${esc(e.msg)}</li>`).join("")}</ul><p class="mdl-ajuda">Com erro de formato a proposta não sai: devolva ao jurídico.</p>` : "")
    + uiDiffLinhas(vg ? vg.texto : "", ab.texto, { rotuloAntes: vg ? `vigente v${vg.numero}` : "sem vigente", rotuloDepois: `enviada v${ab.numero}` });
  const acoes = [{ id: "fechar", texto: "Cancelar" }, { id: "devolver", texto: "Devolver" }];
  if(!erros.length) acoes.push({ id: "aprovar", texto: `Aprovar a versão ${ab.numero}`, primaria: true });
  const r = await uiModal({ titulo: `Aprovar ${m.nome}`, corpoHTML: corpo, acoes, largura: "g" });
  if(r === "aprovar"){
    const x = await mdlRpc("modelo_versao_aprovar", { p_versao: ab.id }, `Versão ${ab.numero} aprovada: agora é a vigente.`);
    if(!x.erro){ _mdlAba = "texto"; await carregarModelos(); }
  } else if(r === "devolver") await mdlDevolver();
}
async function mdlDevolver(){
  const ab = mdlAberta();
  if(!ab || ab.situacao !== "aguardando_aprovacao") return;
  _mdlCampos["mdl-m-motivo"] = "";
  const r = await uiModal({ titulo: `Devolver a versão ${ab.numero}`, largura: "m",
    corpoHTML: uiCampo({ id: "mdl-m-motivo", rotulo: "O que precisa mudar", tipo: "textarea", linhas: 4, obrigatorio: true, ajuda: "Vai para a Minha fila de quem escreveu o rascunho." }),
    acoes: [{ id: "fechar", texto: "Cancelar" }, { id: "devolver", texto: "Devolver", primaria: true }] });
  if(r !== "devolver") return;
  const motivo = (_mdlCampos["mdl-m-motivo"] || "").trim();
  if(!motivo){ uiAvisar("Escreva o que precisa mudar para devolver.", "aviso"); return; }
  const x = await mdlRpc("modelo_versao_devolver", { p_versao: ab.id, p_motivo: motivo }, "Devolvido ao jurídico.");
  if(!x.erro) await carregarModelos();
}
async function mdlRetirar(){
  const ab = mdlAberta();
  if(!ab) return;
  if(!(await uiConfirmar({ titulo: "Retirar do envio", texto: `A versão ${ab.numero} sai da fila do diretor e volta a ser rascunho.`, confirmar: "Retirar" }))) return;
  const x = await mdlRpc("modelo_versao_retirar", { p_versao: ab.id }, "Voltou a ser rascunho.");
  if(!x.erro){ _mdlBuffer = null; _mdlAba = "rascunho"; await carregarModelos(); }
}
async function mdlEditarCadastro(){
  const m = mdlModeloAberto();
  if(!m) return;
  _mdlCampos = { "mdl-m-nome": m.nome || "", "mdl-m-descricao": m.descricao || "" };
  const r = await uiModal({ titulo: "Nome e descrição do modelo", largura: "m",
    corpoHTML: uiCampo({ id: "mdl-m-nome", rotulo: "Nome", valor: m.nome, obrigatorio: true }) + uiCampo({ id: "mdl-m-descricao", rotulo: "Descrição", tipo: "textarea", valor: m.descricao || "" }),
    acoes: [{ id: "fechar", texto: "Cancelar" }, { id: "salvar", texto: "Salvar", primaria: true }] });
  if(r !== "salvar") return;
  const x = await mdlRpc("modelo_documento_salvar", { p_modelo: m.id, p_nome: _mdlCampos["mdl-m-nome"], p_descricao: _mdlCampos["mdl-m-descricao"] || null }, "Modelo salvo.");
  if(!x.erro) await carregarModelos();
}
async function mdlNovoModelo(){
  const livres = Object.keys(MDL_SEGMENTO).filter(s => !_mdlRegistros.some(m => m.tipo === "proposta" && m.segmento === s));
  const tipos = [["contrato", "Contrato"]].concat(livres.length ? [["proposta", "Proposta"]] : []);
  _mdlCampos = { "mdl-m-tipo": "contrato", "mdl-m-segmento": "", "mdl-m-nome": "", "mdl-m-descricao": "" };
  const r = await uiModal({ titulo: "Novo modelo", largura: "m",
    corpoHTML: uiCampo({ id: "mdl-m-tipo", rotulo: "Tipo", tipo: "select", opcoes: tipos, valor: "contrato", obrigatorio: true })
      + uiCampo({ id: "mdl-m-segmento", rotulo: "Segmento ou categoria", valor: "",
          ajuda: livres.length ? `Na proposta, um destes (sem modelo ainda): ${livres.join(", ")}. No contrato, livre (ex.: empreitada, venda_bem).` : "No contrato, livre (ex.: empreitada, venda_bem). Os 4 segmentos de proposta já têm modelo." })
      + uiCampo({ id: "mdl-m-nome", rotulo: "Nome", valor: "", obrigatorio: true })
      + uiCampo({ id: "mdl-m-descricao", rotulo: "Descrição", tipo: "textarea", valor: "" })
      + `<p class="mdl-ajuda">O modelo nasce com o rascunho da versão 1, vazio; o texto vale depois que o diretor aprovar.</p>`,
    acoes: [{ id: "fechar", texto: "Cancelar" }, { id: "criar", texto: "Criar", primaria: true }] });
  if(r !== "criar") return;
  const c = _mdlCampos;
  const x = await mdlRpc("modelo_documento_criar", { p_tipo: c["mdl-m-tipo"] || "contrato", p_segmento: (c["mdl-m-segmento"] || "").trim() || null,
    p_nome: c["mdl-m-nome"], p_descricao: c["mdl-m-descricao"] || null, p_texto: "" }, "Modelo criado com o rascunho da versão 1.");
  if(x.erro) return;
  mdlEditId = x.data; _mdlAba = "rascunho"; _mdlBuffer = null;
  await carregarModelos();
}
function mdlNovoRascunho(){
  const m = mdlModeloAberto(), vg = mdlVigente();
  if(!m || mdlAberta()) return;
  _mdlBuffer = { modeloId: m.id, versaoId: null, texto: vg ? vg.texto : "", resumo: "", sujo: true };
  _mdlAba = "rascunho";
  renderFichaModelo();
}


async function mdlAbrirVersao(versaoId){
  if(!versaoId) { await mdlAtivarModo("modelos"); return; }
  const { data, error } = await sb.from("modelos_documento_versoes").select("modelo_id,situacao").eq("id", versaoId).maybeSingle();
  if(error || !data){ await mdlAtivarModo("modelos"); if(error) uiAvisar(mdlErroDoBanco(error), "perigo"); return; }
  _mdlModo = "modelos";
  mdlEditId = data.modelo_id;
  _mdlAba = data.situacao === "aguardando_aprovacao" && mdlPodeAprovar() ? "comparar" : data.situacao === "rascunho" ? "rascunho" : "texto";
  _mdlBuffer = null;
  await carregarModelos();
}


function ligarModelos(){
  const modos = $("con-modos"), painel = $("mdl-painel");
  if(modos) modos.addEventListener("click", e => {
    const b = e.target.closest("[data-aba]");
    if(b) mdlAtivarModo(b.dataset.aba);
  });
  document.querySelector('.sidebar-nav button[data-secao="contratos"]')?.addEventListener("click", () => {
    mdlRenderModos();
    if(mdlPodeVer() && !_mdlRegistros.length && !_mdlErro) carregarModelos();
  });

  document.addEventListener("input", e => { const id = e.target && e.target.id; if(id && id.startsWith("mdl-m-")) _mdlCampos[id] = e.target.value; });
  document.addEventListener("change", e => { const id = e.target && e.target.id; if(id && id.startsWith("mdl-m-")) _mdlCampos[id] = e.target.value; });
  if(!painel) return;
  painel.addEventListener("click", e => {
    const ac = e.target.closest("[data-acao]");
    if(ac){
      const a = ac.dataset.acao;
      const det = ac.closest("details"); if(det) det.open = false;
      if(a === "voltar"){ mdlEditId = null; _mdlBuffer = null; renderModelos(); }
      else if(a === "novo") mdlNovoModelo();
      else if(a === "novo-rascunho") mdlNovoRascunho();
      else if(a === "aprovar") mdlAprovar();
      else if(a === "devolver") mdlDevolver();
      else if(a === "retirar") mdlRetirar();
      else if(a === "editar") mdlEditarCadastro();
      return;
    }
    const rem = e.target.closest("[data-remover]");
    if(rem){ if(rem.dataset.remover === "tipo" || rem.dataset.remover === "*") _mdlTipo = ""; if(rem.dataset.remover === "*") _mdlBusca = ""; renderModelos(); return; }
    const aba = e.target.closest("[data-aba]");
    if(aba && mdlEditId){ _mdlAba = aba.dataset.aba; const det = aba.closest("details"); if(det) det.open = false; renderFichaModelo(); return; }
    const bt = e.target.closest("[data-mdl]");
    if(bt){ comBotaoTravado(bt, () => mdlAcaoEditor(bt.dataset.mdl)); return; }
    const tr = e.target.closest("tr[data-id]");
    if(!tr) return;
    if(!mdlEditId){ _mdlBuffer = null; abrirModelo(tr.dataset.id); return; }
    if(_mdlAba === "versoes"){
      const v = _mdlVersoes.find(x => x.id === tr.dataset.id);
      if(v) uiModal({ titulo: `Versão ${v.numero} · ${STATUS.modelo_versao[v.situacao] ? STATUS.modelo_versao[v.situacao].label : v.situacao}`, corpoHTML: uiTextoBloco(v.texto, { numerar: true }), largura: "g" });
    }
  });
  const atualizarErros = debounce(mdlAtualizarErros, 300);
  painel.addEventListener("input", e => {
    const id = e.target.id;
    if(id === "mdl-busca"){ _mdlBusca = e.target.value; debounceRenderModelos(); return; }
    if(!_mdlBuffer) return;
    if(id === "mdl-texto"){ _mdlBuffer.texto = e.target.value; _mdlBuffer.sujo = true; atualizarErros(); }
    else if(id === "mdl-resumo"){ _mdlBuffer.resumo = e.target.value; _mdlBuffer.sujo = true; }
  });
  painel.addEventListener("change", e => {
    const id = e.target.id;
    if(id === "mdl-f-tipo"){ _mdlTipo = e.target.value; renderModelos(); }
    else if(id === "mdl-cmp-de" || id === "mdl-cmp-para"){ _mdlCmp[id === "mdl-cmp-de" ? "de" : "para"] = e.target.value; renderFichaModelo(); }
  });
}

const debounceRenderModelos = debounce(() => {
  const ativo = document.activeElement && document.activeElement.id === "mdl-busca";
  const pos = ativo ? document.activeElement.selectionStart : null;
  renderModelos();
  if(ativo){ const el = $("mdl-busca"); if(el){ el.focus(); try { el.setSelectionRange(pos, pos); } catch(_e) {   } } }
}, 250);

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarModelos);
else ligarModelos();

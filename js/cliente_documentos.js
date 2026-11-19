/* ====================================================================
   Fase 183b: documentos do cliente e quem assina, com conferência (spec docs/specs/fase-183-contatos-signatarios-cliente.md).
   Aba "Documentos e assinaturas" da ficha do cliente. Prefixo cli-doc- no DOM e cdo nas funções.
   - Documentos no bucket privado clientes-docs (pasta = cliente_id), com validade; aviso 30 dias antes.
   - Signatários: nascem "aguardando conferência"; Conferir e Revogar só jurídico, financeiro e diretoria, nunca quem
     cadastrou (o banco confere de novo nas RPCs). Editar um conferido volta para "aguardando conferência".
   - CPF e RG: só quem confere, em sessão com MFA, pelas funções auditadas; nunca na lista.
   Sem a migration a aba diz que chega com a atualização do banco.
   ==================================================================== */

const CDO_BUCKET = "clientes-docs";
const CDO_TIPOS_DOC = [["contrato_social", "Contrato social"], ["alteracao_contratual", "Alteração contratual"], ["procuracao", "Procuração"],
  ["cartao_cnpj", "Cartão CNPJ"], ["certidao", "Certidão"], ["outro", "Outro"]];
const CDO_TIPOS_SIG = [["representante_legal", "Representante legal"], ["procurador", "Procurador"]];
const CDO_SITUACAO = { aguardando_conferencia: ["Aguardando conferência", "ambar"], conferido: ["Conferido", "verde"], vencido: ["Vencido", "vermelho"], revogado: ["Revogado", "cinza"] };
const CDO_AVISO_DIAS = 30;
let _cdoSemTabela = false;
let _cdoCliente = null;
let _cdoDocs = [];
let _cdoSigs = [];

function cdoSemTabela(err){
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || /cliente_documentos|cliente_signatarios|schema cache/i.test(String(err.message || "")));
}
function cdoRotulo(lista, v){ const x = lista.find(a => a[0] === v); return x ? x[1] : (v || "—"); }
function cdoCargo(){ return (typeof usuarioAtual !== "undefined" && usuarioAtual) ? usuarioAtual.cargo : ""; }
function cdoUid(){ return (typeof usuarioAtual !== "undefined" && usuarioAtual) ? usuarioAtual.id : ""; }
function cdoSoLeitura(){ return typeof ehSomenteLeitura === "function" && ehSomenteLeitura(); }
/* D3: quem confere (o banco tem a mesma lista em eh_conferente_signatario) */
function cdoPodeConferir(){ return !cdoSoLeitura() && ["diretor", "juridico", "financeiro"].includes(cdoCargo()); }
/* anexa e cadastra: quem confere + comercial e admin */
function cdoPodeAnexar(){ return cdoPodeConferir() || (!cdoSoLeitura() && ["admin", "comercial"].includes(cdoCargo())); }

/* dias até a validade (negativo = vencido); null sem validade */
function cdoDiasAte(dataISO, hoje){
  if(!dataISO) return null;
  const h = hoje || (typeof hojeISO === "function" ? hojeISO() : new Date().toISOString().slice(0, 10));
  return Math.round((Date.parse(dataISO + "T00:00:00Z") - Date.parse(h + "T00:00:00Z")) / 86400000);
}
function cdoTagValidade(dataISO, hoje){
  const d = cdoDiasAte(dataISO, hoje);
  if(d === null) return "—";
  const txt = typeof dataBR === "function" ? dataBR(dataISO) : dataISO;
  if(d < 0) return `${esc(txt)} <span class="tag vermelho">vencido</span>`;
  if(d <= CDO_AVISO_DIAS) return `${esc(txt)} <span class="tag ambar">vence em ${esc(d)} ${d === 1 ? "dia" : "dias"}</span>`;
  return esc(txt);
}
/* Conferir: só quem confere, nunca quem cadastrou, só aguardando e dentro da validade */
function cdoPodeConferirSig(s, uid, podeConferir, hoje){
  if(!podeConferir || !s || s.situacao !== "aguardando_conferencia") return false;
  if(s.criado_por && s.criado_por === uid) return false;
  const d = cdoDiasAte(s.valido_ate, hoje);
  return d === null || d >= 0;
}
function cdoMotivoSemConferir(s, uid, hoje){
  if(s.situacao !== "aguardando_conferencia") return "";
  if(s.criado_por && s.criado_por === uid) return "Você cadastrou: outra pessoa confere.";
  const d = cdoDiasAte(s.valido_ate, hoje);
  if(d !== null && d < 0) return "Validade vencida: anexe o documento novo.";
  return "";
}
function cdoValidarSig(r){
  if(String(r.nome || "").trim().length < 2) return "Informe o nome de quem assina.";
  if(!r.tipo) return "Escolha o tipo (representante legal ou procurador).";
  if(r.forma === "conjunta" && !(Number(r.minimo_assinaturas) >= 2)) return "Assinatura conjunta: informe o mínimo de assinaturas (2 ou mais).";
  if(r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) return "E-mail inválido.";
  if(r.tipo === "procurador" && !r.valido_ate) return "Procuração: informe a validade (ou a data de revisão combinada).";
  return "";
}

/* ---------------- carga ---------------- */
async function carregarCliDocumentos(clienteId){
  const box = $("cli-doc-conteudo");
  if(!box) return;
  _cdoCliente = clienteId || null;
  _cdoDocs = []; _cdoSigs = [];
  cdoBadge();
  if(!clienteId){ box.innerHTML = uiVazio("Salve o cliente antes de anexar documentos."); return; }
  box.innerHTML = uiCarregando("Carregando documentos e signatários…");
  const [d, s] = await Promise.all([
    sb.from("cliente_documentos").select("id,tipo,storage_path,nome,emitido_em,valido_ate,observacoes,enviado_por,created_at").eq("cliente_id", clienteId).order("created_at", { ascending: false }),
    sb.from("cliente_signatarios").select("id,nome,cargo,email,tipo,documento_id,poderes,forma,minimo_assinaturas,valido_ate,situacao,conferido_por,conferido_em,motivo,origem,criado_por").eq("cliente_id", clienteId).order("nome")
  ]);
  if(_cdoCliente !== clienteId) return;
  if(s.error){
    if(cdoSemTabela(s.error)) _cdoSemTabela = true;
    box.innerHTML = _cdoSemTabela ? uiVazio("Documentos e assinaturas chegam com a atualização do banco da fase 183b.") : uiErro("Não foi possível carregar: " + s.error.message);
    return;
  }
  _cdoSigs = s.data || [];
  _cdoDocs = d.error ? null : (d.data || []);   // documentos: só quem confere, comercial e admin leem (RLS)
  renderCliDocumentos();
}

function cdoBadge(){
  const b = $("cli-doc-badge");
  if(!b) return;
  const pend = _cdoSigs.filter(s => s.situacao === "aguardando_conferencia").length;
  const venc = _cdoSigs.filter(s => s.situacao === "conferido" && (cdoDiasAte(s.valido_ate) ?? 99) <= CDO_AVISO_DIAS).length;
  b.textContent = pend + venc ? String(pend + venc) : "";
}

function renderCliDocumentos(){
  const box = $("cli-doc-conteudo");
  if(!box) return;
  cdoBadge();
  const uid = cdoUid(), conf = cdoPodeConferir(), anexa = cdoPodeAnexar();
  // aviso: procuração ou signatário conferido vencendo em até 30 dias
  const vencendo = _cdoSigs.filter(s => s.situacao === "conferido" && s.valido_ate && cdoDiasAte(s.valido_ate) <= CDO_AVISO_DIAS)
    .map(s => `${s.nome}: vence em ${cdoDiasAte(s.valido_ate)} dias`);
  const pend = _cdoSigs.filter(s => s.situacao === "aguardando_conferencia").length;
  const frases = [];
  if(vencendo.length) frases.push("Procuração vencendo", ...vencendo);
  if(pend) frases.push(`${pend} ${pend === 1 ? "signatário aguardando" : "signatários aguardando"} conferência`);
  const aviso = frases.length ? uiFaixaSituacao(frases, "aviso") : "";

  const sigs = uiTabela({
    chaveLinha: "id",
    vazio: "Nenhum signatário cadastrado. Só signatário conferido entra no contrato e no D4Sign.",
    colunas: [
      { chave: "nome", rotulo: "Quem assina", html: s => `<strong>${esc(s.nome)}</strong>${s.cargo ? `<div class="meta">${esc(s.cargo)}</div>` : ""}${s.email ? `<div class="meta">${esc(s.email)}</div>` : ""}` },
      { chave: "tipo", rotulo: "Tipo", html: s => esc(cdoRotulo(CDO_TIPOS_SIG, s.tipo)) + (s.origem === "ia" ? ' <span class="tag azul" title="Sugerido pela leitura com IA">IA</span>' : "") },
      { chave: "forma", rotulo: "Forma", html: s => s.forma === "conjunta" ? `Conjunta (mín. ${esc(s.minimo_assinaturas)})` : "Isolada" },
      { chave: "poderes", rotulo: "Poderes", html: s => esc(s.poderes || "—") },
      { chave: "valido_ate", rotulo: "Validade", html: s => cdoTagValidade(s.valido_ate) },
      { chave: "situacao", rotulo: "Situação", html: s => {
          const [t, cor] = CDO_SITUACAO[s.situacao] || [s.situacao, "cinza"];
          const mot = (s.situacao === "revogado" || s.situacao === "vencido") && s.motivo ? `<div class="meta">${esc(s.motivo)}</div>` : "";
          const porque = cdoMotivoSemConferir(s, uid);
          return `<span class="tag ${esc(cor)}">${esc(t)}</span>${/* html */ mot}${conf && porque ? `<div class="meta">${esc(porque)}</div>` : ""}`;
        } },
      { chave: "acoes", rotulo: "", html: s => [
          cdoPodeConferirSig(s, uid, conf) ? `<button type="button" class="ui-btn ui-btn-prim" data-cli-doc-conferir="${esc(s.id)}">Conferir</button>` : "",
          conf && s.situacao !== "revogado" && s.criado_por !== uid ? `<button type="button" class="ui-btn" data-cli-doc-revogar="${esc(s.id)}">Revogar</button>` : "",
          anexa && s.situacao !== "revogado" ? `<button type="button" class="ui-btn" data-cli-doc-editar-sig="${esc(s.id)}">Editar</button>` : ""
        ].join(" ") }
    ],
    linhas: _cdoSigs
  });

  const docs = _cdoDocs === null ? uiVazio("Os documentos ficam visíveis para o jurídico, o financeiro, a diretoria e o comercial.") : uiTabela({
    chaveLinha: "id",
    vazio: "Nenhum documento anexado.",
    colunas: [
      { chave: "tipo", rotulo: "Tipo", html: d => esc(cdoRotulo(CDO_TIPOS_DOC, d.tipo)) },
      { chave: "nome", rotulo: "Documento", html: d => `<button type="button" class="ui-btn" data-cli-doc-abrir="${esc(d.id)}" title="Abre o arquivo (link de 2 minutos)">${esc(d.nome)}</button>` },
      { chave: "emitido_em", rotulo: "Emitido", tipo: "data" },
      { chave: "valido_ate", rotulo: "Validade", html: d => cdoTagValidade(d.valido_ate) },
      { chave: "acoes", rotulo: "", html: d => [
          typeof cdoIaBotao === "function" ? cdoIaBotao(d) : "",
          conf ? `<button type="button" class="ui-btn" data-cli-doc-excluir="${esc(d.id)}">Excluir</button>` : ""
        ].join(" ") }
    ],
    linhas: _cdoDocs
  });

  box.innerHTML = `${/* html */ aviso}
    <div class="cli-doc-secao">
      <div class="cli-doc-topo"><h3 class="cli-doc-sub">Quem assina pelo cliente</h3>${anexa ? '<button type="button" class="ui-btn ui-btn-prim" data-cli-doc-novo-sig="1">Novo signatário</button>' : ""}</div>
      <div id="cli-doc-sig-form"></div>
      ${/* html */ sigs}
    </div>
    <div class="cli-doc-secao">
      <div class="cli-doc-topo"><h3 class="cli-doc-sub">Documentos</h3>${anexa && _cdoDocs !== null ? '<button type="button" class="ui-btn ui-btn-prim" data-cli-doc-novo-doc="1">Anexar documento</button>' : ""}</div>
      <div id="cli-doc-form"></div>
      <div id="cli-doc-ia"></div>
      ${/* html */ docs}
    </div>`;
}

/* ---------------- documento: anexar, abrir, excluir ---------------- */
function abrirCliDocForm(){
  const box = $("cli-doc-form");
  if(!box) return;
  box.innerHTML = `<div class="cli-doc-form">
    <h3 class="cli-doc-form-tit">Anexar documento</h3>
    <div class="grade">
      ${/* html */ uiCampo({ id: "cli-doc-tipo", rotulo: "Tipo", tipo: "select", opcoes: CDO_TIPOS_DOC, valor: "contrato_social", obrigatorio: true })}
      <div class="ui-campo"><label for="cli-doc-arquivo">Arquivo <span class="ui-campo-obrig" aria-hidden="true">*</span></label><input type="file" id="cli-doc-arquivo" accept=".pdf,.jpg,.jpeg,.png"></div>
      ${/* html */ uiCampo({ id: "cli-doc-nome", rotulo: "Nome", placeholder: "vazio = nome do arquivo" })}
      ${/* html */ uiCampo({ id: "cli-doc-emitido", rotulo: "Emitido em", tipo: "date" })}
      ${/* html */ uiCampo({ id: "cli-doc-valido", rotulo: "Válido até", tipo: "date", ajuda: "Procuração e certidão: o aviso sai 30 dias antes." })}
    </div>
    <div class="cli-doc-form-acoes"><button type="button" class="ui-btn" data-cli-doc-cancelar="1">Cancelar</button><button type="button" class="ui-btn ui-btn-prim" id="btn-cli-doc-enviar">Anexar</button></div>
    <div id="cli-doc-msg"></div>
  </div>`;
}

async function salvarCliDocumento(){
  const f = $("cli-doc-arquivo")?.files?.[0];
  const msg = $("cli-doc-msg");
  if(!f){ if(msg) msg.innerHTML = uiErro("Escolha o arquivo."); return; }
  if(f.size > 20 * 1024 * 1024){ if(msg) msg.innerHTML = uiErro("Arquivo acima de 20 MB."); return; }
  const ext = extensaoArquivo(f), mime = mimeDoArquivo(f, ext);
  const caminho = `${_cdoCliente}/${Date.now()}.${ext}`;
  const up = await sb.storage.from(CDO_BUCKET).upload(caminho, corpoComMime(f, mime), { contentType: mime, upsert: false });
  if(up.error){ if(msg) msg.innerHTML = uiErro(ehErroDePermissao(up.error) ? "Seu perfil não anexa documento do cliente." : "Não foi possível enviar: " + up.error.message); return; }
  const reg = { cliente_id: _cdoCliente, tipo: $("cli-doc-tipo").value || "outro", storage_path: caminho,
    nome: ($("cli-doc-nome").value || "").trim() || f.name, emitido_em: $("cli-doc-emitido").value || null, valido_ate: $("cli-doc-valido").value || null };
  const { error } = await sb.from("cliente_documentos").insert(reg);
  if(error){
    await sb.storage.from(CDO_BUCKET).remove([caminho]);
    if(msg) msg.innerHTML = uiErro("Não foi possível gravar o documento: " + error.message);
    return;
  }
  uiAvisar("Documento anexado.", "ok");
  carregarCliDocumentos(_cdoCliente);
}

async function abrirArquivoCliDoc(id){
  const d = (_cdoDocs || []).find(x => x.id === id);
  if(!d) return;
  const { data, error } = await sb.storage.from(CDO_BUCKET).createSignedUrl(d.storage_path, 120);
  if(error || !data){ uiAvisar("Não foi possível abrir: " + (error ? error.message : "sem link"), "perigo"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

async function excluirCliDocumento(id){
  const d = (_cdoDocs || []).find(x => x.id === id);
  if(!d) return;
  const usado = _cdoSigs.filter(s => s.documento_id === id).length;
  const ok = await uiConfirmar({ titulo: "Excluir documento", perigo: true, confirmar: "Excluir",
    texto: `Excluir "${d.nome}"?${usado ? ` ${usado} signatário(s) perdem o vínculo com ele.` : ""}` });
  if(!ok) return;
  const { error } = await sb.from("cliente_documentos").delete().eq("id", id);
  if(error){ uiAvisar("Não foi possível excluir: " + error.message, "perigo"); return; }
  await sb.storage.from(CDO_BUCKET).remove([d.storage_path]);
  uiAvisar("Documento excluído.", "ok");
  carregarCliDocumentos(_cdoCliente);
}

/* ---------------- signatário: incluir e editar (formulário na própria aba) ---------------- */
function cdoSigFormHTML(s){
  const docs = (_cdoDocs || []).map(d => [d.id, `${cdoRotulo(CDO_TIPOS_DOC, d.tipo)} · ${d.nome}`]);
  const sens = s && cdoPodeConferir() ? `<fieldset class="cli-doc-grupo"><legend>CPF e RG <span class="meta">(só jurídico, financeiro e diretoria; exige o segundo fator)</span></legend>
      <div class="grade">${uiCampo({ id: "cli-doc-sig-cpf", rotulo: "CPF", placeholder: "não carregado" })}${uiCampo({ id: "cli-doc-sig-rg", rotulo: "RG", placeholder: "não carregado" })}</div>
      <div class="cli-doc-form-acoes"><button type="button" class="ui-btn" data-cli-doc-sens="ler">Mostrar CPF e RG</button><button type="button" class="ui-btn" data-cli-doc-sens="salvar">Salvar CPF e RG</button></div>
    </fieldset>` : "";
  return `<div class="cli-doc-form" id="cli-doc-sig" data-id="${esc(s ? s.id : "")}">
    <h3 class="cli-doc-form-tit">${s ? "Editar signatário" : "Novo signatário"}</h3>
    ${s && s.situacao === "conferido" ? uiFaixaSituacao(["Signatário conferido", "salvar uma mudança volta para aguardando conferência"], "aviso") : ""}
    <div class="grade">
      ${/* html */ uiCampo({ id: "cli-doc-sig-nome", rotulo: "Nome", valor: s ? s.nome : "", obrigatorio: true })}
      ${/* html */ uiCampo({ id: "cli-doc-sig-cargo", rotulo: "Cargo", valor: s ? s.cargo : "", placeholder: "ex.: sócio administrador" })}
      ${/* html */ uiCampo({ id: "cli-doc-sig-email", rotulo: "E-mail", tipo: "email", valor: s ? s.email : "", ajuda: "Vai para o D4Sign." })}
      ${/* html */ uiCampo({ id: "cli-doc-sig-tipo", rotulo: "Tipo", tipo: "select", opcoes: CDO_TIPOS_SIG, valor: s ? s.tipo : "representante_legal", obrigatorio: true })}
      ${/* html */ uiCampo({ id: "cli-doc-sig-doc", rotulo: "Documento que dá o poder", tipo: "select", opcoes: docs, valor: s ? s.documento_id : "", placeholder: "— nenhum —" })}
      ${/* html */ uiCampo({ id: "cli-doc-sig-forma", rotulo: "Forma", tipo: "select", opcoes: [["isolada", "Isolada (assina sozinho)"], ["conjunta", "Conjunta"]], valor: s ? s.forma : "isolada" })}
      ${/* html */ uiCampo({ id: "cli-doc-sig-minimo", rotulo: "Mínimo de assinaturas (conjunta)", tipo: "number", valor: s ? s.minimo_assinaturas : "" })}
      ${/* html */ uiCampo({ id: "cli-doc-sig-valido", rotulo: "Válido até", tipo: "date", valor: s ? s.valido_ate : "", ajuda: "Procuração: obrigatório." })}
    </div>
    ${/* html */ uiCampo({ id: "cli-doc-sig-poderes", rotulo: "Poderes", tipo: "textarea", valor: s ? s.poderes : "", linhas: 2, placeholder: "ex.: assinar contratos de prestação de serviço" })}
    ${/* html */ sens}
    <div class="cli-doc-form-acoes"><button type="button" class="ui-btn" data-cli-doc-cancelar="1">Cancelar</button><button type="button" class="ui-btn ui-btn-prim" id="btn-cli-doc-sig-salvar">Salvar signatário</button></div>
    <div id="cli-doc-sig-msg"></div>
  </div>`;
}

function abrirCliSignatario(id){
  const box = $("cli-doc-sig-form");
  if(!box) return;
  box.innerHTML = cdoSigFormHTML(id ? _cdoSigs.find(s => s.id === id) : null);
  $("cli-doc-sig-nome")?.focus();
}

async function salvarCliSignatario(){
  const f = $("cli-doc-sig");
  const v = id => ($(id)?.value || "").trim();
  const reg = { nome: v("cli-doc-sig-nome"), cargo: v("cli-doc-sig-cargo") || null, email: v("cli-doc-sig-email").toLowerCase() || null,
    tipo: v("cli-doc-sig-tipo"), documento_id: v("cli-doc-sig-doc") || null, forma: v("cli-doc-sig-forma") || "isolada",
    minimo_assinaturas: v("cli-doc-sig-forma") === "conjunta" ? (parseInt(v("cli-doc-sig-minimo"), 10) || null) : null,
    valido_ate: v("cli-doc-sig-valido") || null, poderes: v("cli-doc-sig-poderes") || null };
  const msg = cdoValidarSig(reg), caixa = $("cli-doc-sig-msg");
  if(msg){ if(caixa) caixa.innerHTML = uiErro(msg); return; }
  const id = f.dataset.id;
  const { error } = id ? await sb.from("cliente_signatarios").update(reg).eq("id", id)
                       : await sb.from("cliente_signatarios").insert({ ...reg, cliente_id: _cdoCliente });
  if(error){ if(caixa) caixa.innerHTML = uiErro("Não foi possível salvar: " + error.message); return; }
  uiAvisar("Signatário salvo: aguardando conferência.", "ok");
  carregarCliDocumentos(_cdoCliente);
}

async function conferirCliSignatario(id){
  const s = _cdoSigs.find(x => x.id === id);
  if(!s) return;
  const ok = await uiConfirmar({ titulo: "Conferir signatário", confirmar: "Conferir",
    texto: `Confirmo que ${s.nome} pode assinar pelo cliente (${cdoRotulo(CDO_TIPOS_SIG, s.tipo)}, ${s.forma === "conjunta" ? "conjunta, mínimo " + s.minimo_assinaturas : "isolada"}), conferido no documento.` });
  if(!ok) return;
  const { error } = await sb.rpc("cliente_signatario_conferir", { p_id: id });
  if(error){ uiAvisar(error.message, "perigo"); return; }
  uiAvisar("Signatário conferido.", "ok");
  carregarCliDocumentos(_cdoCliente);
}

/* revogar pede o motivo na própria linha (campo + confirmar), sem prompt() */
function abrirRevogarCliSignatario(id){
  const box = $("cli-doc-sig-form");
  const s = _cdoSigs.find(x => x.id === id);
  if(!box || !s) return;
  box.innerHTML = `<div class="cli-doc-form" id="cli-doc-rev" data-id="${esc(id)}">
    <h3 class="cli-doc-form-tit">Revogar ${esc(s.nome)}</h3>
    ${/* html */ uiCampo({ id: "cli-doc-rev-motivo", rotulo: "Motivo", obrigatorio: true, placeholder: "ex.: saiu da sociedade, procuração revogada" })}
    <div class="cli-doc-form-acoes"><button type="button" class="ui-btn" data-cli-doc-cancelar="1">Cancelar</button><button type="button" class="ui-btn ui-btn-perigo" id="btn-cli-doc-rev">Revogar</button></div>
    <div id="cli-doc-rev-msg"></div>
  </div>`;
  $("cli-doc-rev-motivo")?.focus();
}
async function revogarCliSignatario(){
  const id = $("cli-doc-rev")?.dataset.id, motivo = ($("cli-doc-rev-motivo")?.value || "").trim();
  if(motivo.length < 3){ const m = $("cli-doc-rev-msg"); if(m) m.innerHTML = uiErro("Informe o motivo."); return; }
  const { error } = await sb.rpc("cliente_signatario_revogar", { p_id: id, p_motivo: motivo });
  if(error){ uiAvisar(error.message, "perigo"); return; }
  uiAvisar("Signatário revogado.", "ok");
  carregarCliDocumentos(_cdoCliente);
}

/* CPF e RG: ler e gravar só pelas funções auditadas */
async function cdoSensivel(acao){
  const id = $("cli-doc-sig")?.dataset.id;
  if(!id) return;
  if(acao === "ler"){
    const { data, error } = await sb.rpc("fn_cliente_signatario_sensivel", { p_id: id });
    if(error){ uiAvisar(/mfa|dois fatores/i.test(error.message) ? "CPF e RG exigem o segundo fator nesta sessão." : error.message, "perigo"); return; }
    $("cli-doc-sig-cpf").value = data && data.cpf ? data.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : "";
    $("cli-doc-sig-rg").value = data && data.rg ? data.rg : "";
    return;
  }
  const { error } = await sb.rpc("cliente_signatario_sensivel_salvar", { p_id: id, p_cpf: $("cli-doc-sig-cpf").value || null, p_rg: $("cli-doc-sig-rg").value || null });
  if(error){ uiAvisar(error.message, "perigo"); return; }
  uiAvisar("CPF e RG gravados.", "ok");
}

/* ---------------- ligações ---------------- */
function ligarCliDocumentos(){
  const raiz = $("cli-doc-conteudo");
  if(!raiz) return;
  raiz.addEventListener("click", ev => {
    const t = ev.target.closest("button");
    if(!t) return;
    const ds = t.dataset;
    if(ds.cliDocNovoSig) abrirCliSignatario(null);
    else if(ds.cliDocEditarSig) abrirCliSignatario(ds.cliDocEditarSig);
    else if(ds.cliDocConferir) comBotaoTravado(t, () => conferirCliSignatario(ds.cliDocConferir));
    else if(ds.cliDocRevogar) abrirRevogarCliSignatario(ds.cliDocRevogar);
    else if(ds.cliDocNovoDoc) abrirCliDocForm();
    else if(ds.cliDocAbrir) abrirArquivoCliDoc(ds.cliDocAbrir);
    else if(ds.cliDocExcluir) excluirCliDocumento(ds.cliDocExcluir);
    else if(ds.cliDocSens) comBotaoTravado(t, () => cdoSensivel(ds.cliDocSens));
    else if(ds.cliDocCancelar){ const c = t.closest(".cli-doc-form"); if(c && c.parentElement) c.parentElement.innerHTML = ""; }
    else if(t.id === "btn-cli-doc-enviar") comBotaoTravado(t, salvarCliDocumento);
    else if(t.id === "btn-cli-doc-sig-salvar") comBotaoTravado(t, salvarCliSignatario);
    else if(t.id === "btn-cli-doc-rev") comBotaoTravado(t, revogarCliSignatario);
  });
}

if(typeof module !== "undefined" && module.exports){
  module.exports = { cdoDiasAte, cdoPodeConferirSig, cdoMotivoSemConferir, cdoValidarSig, CDO_AVISO_DIAS };
}
if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarCliDocumentos);
  else ligarCliDocumentos();
}

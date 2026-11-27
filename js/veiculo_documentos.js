












const VDOC_BUCKET = "equipamentos-documentos";
const VDOC_TIPOS = [["crlv", "CRLV"], ["apolice_seguro", "Apólice de seguro"], ["outro", "Outro"]];

const VDOC_RODADOS = [["01", "01 · Truck"], ["02", "02 · Toco"], ["03", "03 · Cavalo mecânico"], ["04", "04 · Van"], ["05", "05 · Utilitário"], ["06", "06 · Outros"]];
const VDOC_CARROCERIAS = [["00", "00 · Não aplicável"], ["01", "01 · Aberta"], ["02", "02 · Fechada / baú"], ["03", "03 · Graneleira"], ["04", "04 · Porta-contêiner"], ["05", "05 · Sider"]];
const VDOC_UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const VDOC_CAMPOS = ["renavam", "tara_kg", "capacidade_kg", "tipo_rodado", "tipo_carroceria", "uf_licenciamento"];
const VDOC_EXT = ["pdf", "jpg", "jpeg", "png", "webp"];

let _vdocVeic = null;
let _vdocDocs = [];
let _vdocErro = "";
let _vdocLeitura = null;
let _vdocDocPendente = null;
let _vdocTrocar = null;


function vdocPodeEnviar(){ return !!usuarioAtual && !ehSomenteLeitura() && ["diretor", "admin", "gestor_frota", "logistica", "gestor_acessorios"].includes(usuarioAtual.cargo); }
function vdocRotulo(lista, v){ const x = lista.find(a => a[0] === v); return x ? x[1] : (v || "—"); }


function vdocDiasAte(dataISO){
  if(!dataISO) return null;
  return Math.round((Date.parse(dataISO + "T00:00:00Z") - Date.parse(hojeISO() + "T00:00:00Z")) / 86400000);
}

function vdocValidadeEfetiva(d){
  if(!d) return null;
  if(d.validade) return d.validade;
  return d.exercicio ? `${Number(d.exercicio) + 1}-12-31` : null;
}

function vdocCrlvAtual(docs){
  return (docs || []).filter(d => d.tipo === "crlv").sort((a, b) =>
    (Number(b.exercicio) || 0) - (Number(a.exercicio) || 0) || String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
}
function vdocTagValidade(d){
  const v = d.tipo === "crlv" ? vdocValidadeEfetiva(d) : d.validade;
  const dias = vdocDiasAte(v);
  if(dias === null) return "—";
  const txt = esc(dataBR(v)) + (d.tipo === "crlv" && !d.validade ? ' <span class="meta" title="Sem validade informada: o exercício vale até o fim do ano seguinte">(pelo exercício)</span>' : "");
  if(dias < 0) return `${txt} <span class="tag vermelho">vencido</span>`;
  if(dias <= 30) return `${txt} <span class="tag ambar">vence em ${esc(dias)} ${dias === 1 ? "dia" : "dias"}</span>`;
  return txt;
}


async function vdocAbrir(v){
  ligarVdoc();
  _vdocVeic = v || null;
  _vdocDocs = []; _vdocErro = ""; _vdocLeitura = null; _vdocDocPendente = null; _vdocTrocar = null;
  renderVdocMdfe();
  const box = $("fveic-docs");
  if(!box) return;
  if(!v || !v.id){ box.innerHTML = uiSecao("documento", "Documentos", uiVazio("Salve o veículo antes de anexar o CRLV.")); return; }
  box.innerHTML = uiSecao("documento", "Documentos", uiCarregando("Carregando documentos…"));
  await vdocCarregar();
}
async function vdocCarregar(){
  const v = _vdocVeic;
  if(!v || !v.id) return;
  const { data, error } = await sb.from("equipamento_documentos")
    .select("id,tipo,numero,exercicio,emissao,validade,arquivo_path,arquivo_nome,observacoes,enviado_por,created_at")
    .eq("equipamento_id", v.id).order("created_at", { ascending: false });
  if(_vdocVeic !== v) return;
  _vdocErro = error ? ((error.code === "42P01" || error.code === "PGRST205") ? "Documentos do veículo chegam com a atualização do banco." : "Não foi possível carregar os documentos: " + error.message) : "";
  _vdocDocs = error ? [] : (data || []);
  renderVdocDocs();
}


function renderVdocMdfe(){
  const box = $("fveic-mdfe");
  if(!box) return;
  const v = _vdocVeic || {};
  const L = _vdocLeitura;
  const pode = vdocPodeEnviar() || (typeof frotaPodeEditar === "function" && frotaPodeEditar());
  const lido = k => L && L[k] != null && L[k] !== "";
  const val = (k, atual) => lido(k) ? L[k] : atual;
  const campo = (k, cfg) => `<div class="${lido(k) ? "vdoc-lido" : ""}">${  uiCampo(cfg)}</div>`;
  const ufAtual = v.uf_licenciamento ? String(v.uf_licenciamento).toUpperCase() : "";
  const avisos = [];
  if(L){
    if(L.aviso) avisos.push(uiFaixaSituacao([L.aviso], "perigo"));
    const lidoTxt = [L.especie_tipo, L.carroceria_texto, L.eixos ? `${L.eixos} eixos` : "", L.pbt_kg ? `PBT ${num(L.pbt_kg)} kg` : "", L.placa ? `placa ${L.placa}` : ""].filter(Boolean).join(" · ");
    avisos.push(uiFaixaSituacao(["Leitura do CRLV", "confira os campos destacados e clique em Salvar", lidoTxt], "info"));
    if((L.duvidas || []).length) avisos.push(`<ul class="vdoc-duvidas">${L.duvidas.map(d => `<li>${esc(d)}</li>`).join("")}</ul>`);
  }
  const faltam = VDOC_CAMPOS.filter(k => v[k] == null || v[k] === "").length;
  box.innerHTML = uiSecao("maquina", "Dados para o MDF-e", `${  avisos.join("")}
    <div class="vdoc-grade">
      ${  campo("renavam", { id: "vdoc-renavam", rotulo: "RENAVAM", valor: val("renavam", v.renavam || ""), placeholder: "só dígitos", somenteLeitura: !pode })}
      ${  campo("tara_kg", { id: "vdoc-tara", rotulo: "Tara (kg)", tipo: "number", valor: val("tara_kg", v.tara_kg ?? ""), somenteLeitura: !pode })}
      ${  campo("capacidade_kg", { id: "vdoc-capacidade", rotulo: "Capacidade (kg)", tipo: "number", valor: val("capacidade_kg", v.capacidade_kg ?? ""), somenteLeitura: !pode })}
      ${  campo("tipo_rodado", { id: "vdoc-rodado", rotulo: "Tipo de rodado", tipo: "select", opcoes: VDOC_RODADOS, valor: val("tipo_rodado", v.tipo_rodado || "") })}
      ${  campo("tipo_carroceria", { id: "vdoc-carroceria", rotulo: "Tipo de carroceria", tipo: "select", opcoes: VDOC_CARROCERIAS, valor: val("tipo_carroceria", v.tipo_carroceria || "") })}
      ${  campo("uf", { id: "vdoc-uf", rotulo: "UF de licenciamento", tipo: "select", opcoes: VDOC_UFS.map(u => [u, u]), valor: val("uf", ufAtual) })}
    </div>`, L ? "leitura a conferir" : faltam ? `${faltam} de 6 em branco` : "completo");
  if(!pode) box.querySelectorAll("select").forEach(el => { el.disabled = true; });
}

function vdocLerCampos(){
  const t = id => ($(id)?.value || "").trim();
  const renavam = t("vdoc-renavam").replace(/\D/g, "");
  const tara = t("vdoc-tara"), cap = t("vdoc-capacidade");
  const reg = {
    renavam: renavam || null,
    tara_kg: tara === "" ? null : Number(tara),
    capacidade_kg: cap === "" ? null : Number(cap),
    tipo_rodado: t("vdoc-rodado") || null,
    tipo_carroceria: t("vdoc-carroceria") || null,
    uf_licenciamento: t("vdoc-uf") ? t("vdoc-uf").toLowerCase() : null
  };
  if(reg.renavam && !/^[0-9]{9,11}$/.test(reg.renavam)) return { erro: "RENAVAM tem 9 a 11 dígitos." };
  if(reg.tara_kg != null && !(reg.tara_kg > 0)) return { erro: "A tara tem de ser maior que zero." };
  if(reg.capacidade_kg != null && !(reg.capacidade_kg > 0)) return { erro: "A capacidade tem de ser maior que zero." };
  return { reg };
}

async function vdocGravarPendente(){
  const p = _vdocDocPendente;
  if(!p || !p.id) return;
  const patch = {};
  if(p.exercicio) patch.exercicio = p.exercicio;
  if(p.numero) patch.numero = p.numero;
  _vdocDocPendente = null;
  if(Object.keys(patch).length) await sb.from("equipamento_documentos").update(patch).eq("id", p.id);
}

async function vdocSalvarSoMdfe(){
  if(!_vdocVeic || !_vdocVeic.id) return;
  const r = vdocLerCampos();
  if(r.erro){ frotaAvisoVeic(r.erro, "erro"); return; }
  const { error } = await sb.from("equipamentos").update(r.reg).eq("id", _vdocVeic.id);
  if(error){ frotaAvisoVeic(ehErroDePermissao(error) ? "Seu perfil não grava os dados do veículo." : "Erro ao salvar: " + error.message, "erro"); return; }
  await vdocGravarPendente();
  aviso("app-aviso", "Dados do MDF-e salvos.", "ok");
  fecharVeiculo();
  await carregarFrota(true);
}


function renderVdocDocs(){
  const box = $("fveic-docs");
  if(!box) return;
  const pode = vdocPodeEnviar();
  const atual = vdocCrlvAtual(_vdocDocs);
  let destaque;
  if(_vdocErro) destaque = uiFaixaSituacao([], "perigo", { erro: _vdocErro });
  else if(!atual) destaque = uiFaixaSituacao(["Sem CRLV anexado", "o MDF-e precisa dos dados do documento"], "aviso");
  else {
    const venc = vdocValidadeEfetiva(atual), dias = vdocDiasAte(venc);
    const frases = [`CRLV ${atual.exercicio || "sem exercício"}`, venc ? `válido até ${dataBR(venc)}${atual.validade ? "" : " (pelo exercício)"}` : "sem validade informada", atual.numero ? `nº ${atual.numero}` : ""];
    destaque = uiFaixaSituacao(dias !== null && dias < 0 ? [frases[0], "vencido desde " + dataBR(venc), frases[2]] : frases,
      dias !== null && dias < 0 ? "perigo" : dias !== null && dias <= 30 ? "aviso" : "ok");
  }
  const tabela = uiTabela({
    chaveLinha: "id",
    vazio: "Nenhum documento anexado.",
    erro: _vdocErro || null,
    colunas: [
      { chave: "tipo", rotulo: "Tipo", html: d => esc(vdocRotulo(VDOC_TIPOS, d.tipo)) + (atual && d.id === atual.id ? ' <span class="tag azul">atual</span>' : "") },
      { chave: "numero", rotulo: "Nº", html: d => d.numero ? uiCodigo(d.numero) : "—" },
      { chave: "exercicio", rotulo: "Exercício", html: d => esc(d.exercicio || "—") },
      { chave: "validade", rotulo: "Validade", html: d => vdocTagValidade(d) },
      { chave: "created_at", rotulo: "Enviado em", html: d => esc(dataBR(String(d.created_at || "").slice(0, 10))) },
      { chave: "acoes", rotulo: "", html: d => `<span class="vdoc-acoes">
          <button type="button" class="ui-btn" data-vdoc-ver="${esc(d.id)}" title="Abre o arquivo numa aba nova (link de 2 minutos)">Ver</button>
          <button type="button" class="ui-btn" data-vdoc-baixar="${esc(d.id)}" title="Baixa o arquivo">Baixar</button>
          ${pode ? `<button type="button" class="ui-btn" data-vdoc-trocar="${esc(d.id)}" title="Troca o arquivo deste documento por um novo">Substituir</button>` : ""}
          ${pode && d.tipo === "crlv" ? `<button type="button" class="ui-btn" data-vdoc-ler="${esc(d.id)}" title="A IA preenche os dados do MDF-e; nada é gravado sem você conferir e salvar">Ler com IA</button>` : ""}
          ${pode ? `<button type="button" class="ui-btn" data-vdoc-excluir="${esc(d.id)}" title="Exclui o documento e o arquivo">Excluir</button>` : ""}
        </span>` }
    ],
    linhas: _vdocDocs
  });
  box.innerHTML = uiSecao("documento", "Documentos", `${  destaque}
    <div class="vdoc-topo"><span class="meta">CRLV, apólice de seguro e outros documentos do veículo.</span>${pode && !_vdocErro ? '<button type="button" class="ui-btn ui-btn-prim" data-vdoc-novo="1">Enviar documento</button>' : ""}</div>
    <div id="vdoc-form"></div>
    <div id="vdoc-ia"></div>
    ${  tabela}
    <input type="file" id="vdoc-arquivo-troca" class="vdoc-arquivo" accept=".pdf,.jpg,.jpeg,.png,.webp" aria-label="Arquivo novo do documento">`,
    `${_vdocDocs.length} ${_vdocDocs.length === 1 ? "documento" : "documentos"}`);
}
function abrirVdocForm(){
  const box = $("vdoc-form");
  if(!box) return;
  box.innerHTML = `<div class="vdoc-form">
    <div class="vdoc-grade">
      ${  uiCampo({ id: "vdoc-tipo", rotulo: "Tipo", tipo: "select", opcoes: VDOC_TIPOS, valor: "crlv", obrigatorio: true })}
      <div class="ui-campo"><label for="vdoc-arquivo">Arquivo <span class="ui-campo-obrig" aria-hidden="true">*</span></label><input type="file" id="vdoc-arquivo" accept=".pdf,.jpg,.jpeg,.png,.webp"></div>
      ${  uiCampo({ id: "vdoc-numero", rotulo: "Número", placeholder: "opcional" })}
      ${  uiCampo({ id: "vdoc-exercicio", rotulo: "Exercício", tipo: "number", placeholder: String(new Date().getFullYear()), ajuda: "CRLV: a IA lê se ficar em branco" })}
      ${  uiCampo({ id: "vdoc-emissao", rotulo: "Emissão", tipo: "date" })}
      ${  uiCampo({ id: "vdoc-validade", rotulo: "Validade", tipo: "date", ajuda: "Sem validade, o CRLV vale até o fim do ano seguinte ao exercício" })}
    </div>
    <div class="vdoc-form-acoes"><button type="button" class="ui-btn" data-vdoc-cancelar="1">Cancelar</button><button type="button" class="ui-btn ui-btn-prim" id="btn-vdoc-enviar">Enviar</button></div>
    <div id="vdoc-msg"></div>
  </div>`;
}

async function vdocSubir(file){
  const ext = extensaoArquivo(file);
  if(!VDOC_EXT.includes(ext)) return { erro: "Envie PDF, JPG, PNG ou WEBP." };
  if(file.size > 20 * 1024 * 1024) return { erro: "Arquivo acima de 20 MB." };
  const mime = mimeDoArquivo(file, ext);
  const caminho = `${_vdocVeic.id}/${Date.now()}.${ext}`;
  const up = await sb.storage.from(VDOC_BUCKET).upload(caminho, corpoComMime(file, mime), { contentType: mime, upsert: false });
  if(up.error) return { erro: ehErroDePermissao(up.error) ? "Seu perfil não envia documento de veículo." : "Não foi possível enviar: " + up.error.message };
  return { caminho };
}
async function salvarVdocDocumento(){
  const msg = $("vdoc-msg");
  const f = $("vdoc-arquivo")?.files?.[0];
  if(!f){ if(msg) msg.innerHTML = uiErro("Escolha o arquivo."); return; }
  const ex = ($("vdoc-exercicio").value || "").trim();
  if(ex && !(Number(ex) >= 1990 && Number(ex) <= 2100)){ if(msg) msg.innerHTML = uiErro("Exercício fora do intervalo (1990 a 2100)."); return; }
  const s = await vdocSubir(f);
  if(s.erro){ if(msg) msg.innerHTML = uiErro(s.erro); return; }
  const reg = { equipamento_id: _vdocVeic.id, tipo: $("vdoc-tipo").value || "outro", numero: ($("vdoc-numero").value || "").trim() || null,
    exercicio: ex ? Number(ex) : null, emissao: $("vdoc-emissao").value || null, validade: $("vdoc-validade").value || null,
    arquivo_path: s.caminho, arquivo_nome: f.name };
  const { data, error } = await sb.from("equipamento_documentos").insert(reg).select("id").single();
  if(error){
    await sb.storage.from(VDOC_BUCKET).remove([s.caminho]);
    if(msg) msg.innerHTML = uiErro(ehErroDePermissao(error) ? "Seu perfil não envia documento de veículo." : "Não foi possível gravar: " + error.message);
    return;
  }
  uiAvisar("Documento enviado.", "ok");
  await vdocCarregar();
  if(reg.tipo === "crlv" && data) await vdocLerIA(data.id);
}

async function vdocSubstituir(file){
  const d = _vdocDocs.find(x => x.id === _vdocTrocar);
  _vdocTrocar = null;
  if(!d || !file) return;
  const s = await vdocSubir(file);
  if(s.erro){ uiAvisar(s.erro, "perigo"); return; }
  const { error } = await sb.from("equipamento_documentos").update({ arquivo_path: s.caminho, arquivo_nome: file.name }).eq("id", d.id);
  if(error){ await sb.storage.from(VDOC_BUCKET).remove([s.caminho]); uiAvisar("Não foi possível substituir: " + error.message, "perigo"); return; }
  await sb.storage.from(VDOC_BUCKET).remove([d.arquivo_path]);
  uiAvisar("Arquivo substituído.", "ok");
  await vdocCarregar();
  if(d.tipo === "crlv") await vdocLerIA(d.id);
}
async function vdocAbrirArquivo(id, baixar){
  const d = _vdocDocs.find(x => x.id === id);
  if(!d) return;
  const { data, error } = await sb.storage.from(VDOC_BUCKET).createSignedUrl(d.arquivo_path, 120, baixar ? { download: d.arquivo_nome || true } : undefined);
  if(error || !data){ uiAvisar("Não foi possível abrir: " + (error ? error.message : "sem link"), "perigo"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
async function excluirVdocDocumento(id){
  const d = _vdocDocs.find(x => x.id === id);
  if(!d) return;
  const ok = await uiConfirmar({ titulo: "Excluir documento", texto: `Excluir ${vdocRotulo(VDOC_TIPOS, d.tipo)}${d.exercicio ? " " + d.exercicio : ""} e o arquivo? Não dá para desfazer.`, confirmar: "Excluir", perigo: true });
  if(!ok) return;
  const { error } = await sb.from("equipamento_documentos").delete().eq("id", d.id);
  if(error){ uiAvisar("Não foi possível excluir: " + error.message, "perigo"); return; }
  await sb.storage.from(VDOC_BUCKET).remove([d.arquivo_path]);
  if(_vdocDocPendente && _vdocDocPendente.id === d.id) _vdocDocPendente = null;
  uiAvisar("Documento excluído.", "ok");
  await vdocCarregar();
}


async function vdocLerIA(docId){
  const box = $("vdoc-ia");
  if(box) box.innerHTML = uiCarregando("Lendo o CRLV com IA (até 1 minuto)…");
  let r;
  try {
    r = typeof iaInvocarComLimite === "function"
      ? await iaInvocarComLimite("extrair-crlv", { documento_id: docId }, "A leitura demorou demais. Digite os dados do MDF-e.")
      : await sb.functions.invoke("extrair-crlv", { body: { documento_id: docId } });
  } catch(e){ if(box) box.innerHTML = uiErro((e.message || String(e)) + " Digite os dados do MDF-e."); return; }
  if(r.error){
    let msg = r.error.message || "Falha na leitura.";
    try { const ctx = await r.error.context?.json?.(); if(ctx && ctx.error) msg = ctx.error; } catch(_){   }
    if(box) box.innerHTML = uiErro(msg + " Digite os dados do MDF-e.");
    return;
  }
  if(box) box.innerHTML = "";
  _vdocLeitura = r.data || null;
  if(_vdocLeitura){
    const d = _vdocDocs.find(x => x.id === docId);
    _vdocDocPendente = { id: docId, exercicio: d && d.exercicio ? null : _vdocLeitura.exercicio, numero: d && d.numero ? null : _vdocLeitura.numero_documento };
  }
  renderVdocMdfe();
  $("fveic-mdfe")?.scrollIntoView({ behavior: "smooth", block: "start" });
}


let _vdocFiltro = null;
function vdocFiltroHTML(){
  if(!_vdocFiltro) return "";
  return uiFaixaSituacao([_vdocFiltro.titulo, `${_vdocFiltro.ids.length} ${_vdocFiltro.ids.length === 1 ? "veículo" : "veículos"}`, "abra o veículo e envie o CRLV em Documentos"], "aviso",
    { acoes: [{ id: "vdoc-limpar", texto: "Mostrar todos" }] });
}

async function vdocAbrirRegularizar(a){
  if(!a || !irParaSecao("frota")) return;
  if(typeof carregarFrota === "function") await carregarFrota(false);
  _frotaView = "veiculos"; _frotaTipoFiltro = "";
  _vdocFiltro = { titulo: a.titulo || "Veículos", ids: (a.equipamento_ids || []).slice() };
  renderFrota();
  if(a.registro_id) abrirVeiculo(a.registro_id);
}


function ligarVdoc(){
  const box = $("fveic-docs");
  if(!box || box.dataset.ligado) return;
  box.dataset.ligado = "1";
  box.addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if(!b) return;
    if(b.dataset.vdocNovo) abrirVdocForm();
    else if(b.dataset.vdocCancelar){ const f = $("vdoc-form"); if(f) f.innerHTML = ""; }
    else if(b.id === "btn-vdoc-enviar") comBotaoTravado("btn-vdoc-enviar", salvarVdocDocumento);
    else if(b.dataset.vdocVer) vdocAbrirArquivo(b.dataset.vdocVer, false);
    else if(b.dataset.vdocBaixar) vdocAbrirArquivo(b.dataset.vdocBaixar, true);
    else if(b.dataset.vdocTrocar){ _vdocTrocar = b.dataset.vdocTrocar; const inp = $("vdoc-arquivo-troca"); if(inp){ inp.value = ""; inp.click(); } }
    else if(b.dataset.vdocLer) vdocLerIA(b.dataset.vdocLer);
    else if(b.dataset.vdocExcluir) excluirVdocDocumento(b.dataset.vdocExcluir);
  });
  box.addEventListener("change", ev => {
    if(ev.target.id === "vdoc-arquivo-troca") vdocSubstituir(ev.target.files?.[0]);
  });
}
document.addEventListener("DOMContentLoaded", ligarVdoc);

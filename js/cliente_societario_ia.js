/* ====================================================================
   Fase 183c: leitura por IA do contrato social, da alteração e da procuração (edge function extrair-societario).
   Na aba "Documentos e assinaturas" (fase 183b), cada documento desses tipos ganha "Ler com IA"; a prévia mostra os
   signatários sugeridos linha a linha e "Criar selecionados" grava em cliente_signatarios com origem "ia". O banco
   força "aguardando conferência": a conferência do jurídico, do financeiro ou da diretoria continua obrigatória.
   CPF e RG nunca vêm da IA: quando o documento traz, a prévia lembra quem confere de digitar na ficha do signatário.
   Prefixo cli-doc-ia- no DOM e csi nas funções.
   ==================================================================== */

const CSI_TIPOS = ["contrato_social", "alteracao_contratual", "procuracao"];
const CSI_EXT = ["pdf", "jpg", "jpeg", "png"];
let _csiLeitura = null;

function csiPodeLer(doc){
  if(!doc || !CSI_TIPOS.includes(doc.tipo)) return false;
  const ext = String(doc.storage_path || "").split(".").pop().toLowerCase();
  return CSI_EXT.includes(ext);
}
/* procuração sem validade não vira signatário (a 183b exige a validade do procurador) */
function csiPodeAceitar(s){ return !!s && !(s.tipo === "procurador" && !s.valido_ate); }
function csiParaRegistro(s, clienteId, documentoId){
  return { cliente_id: clienteId, documento_id: documentoId || null, nome: s.nome, cargo: s.cargo || null, tipo: s.tipo,
           poderes: s.poderes || null, forma: s.forma === "conjunta" ? "conjunta" : "isolada",
           minimo_assinaturas: s.forma === "conjunta" ? (s.minimo_assinaturas || 2) : null, valido_ate: s.valido_ate || null, origem: "ia" };
}

/* botão na linha do documento (chamado pela tabela da 183b) */
function cdoIaBotao(doc){
  if(typeof cdoPodeAnexar === "function" && !cdoPodeAnexar()) return "";
  return csiPodeLer(doc) ? `<button type="button" class="ui-btn" data-cli-doc-ia-ler="${esc(doc.id)}" title="A IA sugere quem assina; nada é gravado sem você aceitar">Ler com IA</button>` : "";
}

async function csiLer(docId){
  const box = $("cli-doc-ia");
  if(!box) return;
  _csiLeitura = null;
  box.innerHTML = uiCarregando("Lendo o documento com IA (até 2 minutos)…");
  let r;
  try {
    r = typeof iaInvocarComLimite === "function"
      ? await iaInvocarComLimite("extrair-societario", { documento_id: docId }, "A leitura demorou demais. Envie só as páginas da administração ou da procuração.")
      : await sb.functions.invoke("extrair-societario", { body: { documento_id: docId } });
  } catch(e){ box.innerHTML = uiErro(e.message || String(e)); return; }
  if(r.error){
    let msg = r.error.message || "Falha na leitura.";
    try { const ctx = await r.error.context?.json?.(); if(ctx && ctx.error) msg = ctx.error; } catch(_){ /* fica a mensagem genérica */ }
    box.innerHTML = uiErro(msg);
    return;
  }
  _csiLeitura = { ...r.data, documento_id: docId };
  renderCsiPrevia();
}

function renderCsiPrevia(){
  const box = $("cli-doc-ia"), L = _csiLeitura;
  if(!box || !L) return;
  const cab = [
    L.razao_social ? `Documento de ${L.razao_social}` : "Leitura com IA",
    L.cnpj ? (L.cnpj_confere ? "CNPJ confere com o cadastro" : `CNPJ ${L.cnpj}`) : "",
    L.data_documento && typeof dataBR === "function" ? `de ${dataBR(L.data_documento)}` : "",
    L.outorgante ? `outorgante: ${L.outorgante}` : ""
  ];
  const avisos = [];
  if(L.aviso) avisos.push(uiFaixaSituacao([L.aviso], "perigo"));
  if(L.documento_traz_cpf) avisos.push(uiFaixaSituacao(["O documento traz CPF ou RG", "a IA não copia: quem confere digita na ficha do signatário"], "info"));
  const duvidas = (L.duvidas || []).length ? `<ul class="cli-doc-ia-duvidas">${L.duvidas.map(d => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
  const lista = (L.signatarios || []).map((s, i) => {
    const pode = csiPodeAceitar(s);
    return `<label class="cli-doc-ia-linha">
      <input type="checkbox" data-cli-doc-ia-i="${esc(i)}"${pode ? " checked" : " disabled"}>
      <span><strong>${esc(s.nome)}</strong>${s.cargo ? ` · ${esc(s.cargo)}` : ""} · ${esc(s.tipo === "procurador" ? "Procurador" : "Representante legal")}
      · ${s.forma === "conjunta" ? `conjunta, mínimo ${esc(s.minimo_assinaturas)}` : "isolada"}${s.valido_ate ? ` · até ${esc(typeof dataBR === "function" ? dataBR(s.valido_ate) : s.valido_ate)}` : ""}
      ${s.poderes ? `<span class="meta">${esc(s.poderes)}</span>` : ""}
      ${(s.notas || []).map(n => `<span class="tag ambar">${esc(n)}</span>`).join(" ")}</span>
    </label>`;
  }).join("");
  box.innerHTML = `<div class="cli-doc-form">
    <h3 class="cli-doc-form-tit">${esc(cab.filter(Boolean).join(" · "))}</h3>
    ${/* html */ avisos.join("")}
    ${lista || uiVazio("A IA não encontrou quem assina neste documento.")}
    ${/* html */ duvidas}
    <p class="meta">Os aceitos entram como "Aguardando conferência"; o jurídico, o financeiro ou a diretoria conferem antes de valer para contrato.</p>
    <div class="cli-doc-form-acoes"><button type="button" class="ui-btn" data-cli-doc-ia-fechar="1">Descartar leitura</button>${lista ? '<button type="button" class="ui-btn ui-btn-prim" id="btn-cli-doc-ia-aceitar">Criar selecionados</button>' : ""}</div>
  </div>`;
}

async function csiAceitar(){
  const L = _csiLeitura;
  if(!L) return;
  const idx = [...document.querySelectorAll("[data-cli-doc-ia-i]:checked")].map(x => Number(x.dataset.cliDocIaI));
  const regs = idx.map(i => L.signatarios[i]).filter(csiPodeAceitar).map(s => csiParaRegistro(s, _cdoCliente, L.documento_id));
  if(!regs.length){ uiAvisar("Marque pelo menos um signatário.", "aviso"); return; }
  const { error } = await sb.from("cliente_signatarios").insert(regs);
  if(error){ uiAvisar("Não foi possível criar: " + error.message, "perigo"); return; }
  uiAvisar(`${regs.length} ${regs.length === 1 ? "signatário criado" : "signatários criados"}: aguardando conferência.`, "ok");
  _csiLeitura = null;
  const box = $("cli-doc-ia"); if(box) box.innerHTML = "";
  if(typeof carregarCliDocumentos === "function") carregarCliDocumentos(_cdoCliente);
}

function ligarCliSocietarioIa(){
  $("cli-doc-conteudo")?.addEventListener("click", ev => {
    const t = ev.target.closest("button");
    if(!t) return;
    if(t.dataset.cliDocIaLer) comBotaoTravado(t, () => csiLer(t.dataset.cliDocIaLer));
    else if(t.dataset.cliDocIaFechar){ _csiLeitura = null; const b = $("cli-doc-ia"); if(b) b.innerHTML = ""; }
    else if(t.id === "btn-cli-doc-ia-aceitar") comBotaoTravado(t, csiAceitar);
  });
}

if(typeof module !== "undefined" && module.exports){
  module.exports = { csiPodeLer, csiPodeAceitar, csiParaRegistro };
}
if(typeof document !== "undefined"){
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarCliSocietarioIa);
  else ligarCliSocietarioIa();
}

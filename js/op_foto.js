/* ====================================================================
   App do operador (fase 129b) — op_foto.js
   Tela 8: fotos do dia. A câmera do celular, redução no aparelho (lado maior = campo_fotos_max_px, JPEG),
   registro pela fila (rdo_campo_foto_registrar) e o arquivo sobe depois dos dados, com teto diário de MB.
   ==================================================================== */

const VINCULOS_FOTO = [
  ["diario", "Do dia (geral)"], ["boletim_assinado", "Boletim assinado"], ["estaca", "Estaca"],
  ["ocorrencia", "Parada"], ["horimetro", "Abastecimento / horímetro"]
];
const ROTULO_VINCULO = Object.fromEntries(VINCULOS_FOTO);
let _fotoTipo = "diario";
const _miniaturas = new Map();   // foto_id -> URL de objeto do Blob ainda no aparelho

function reduzirImagem(arquivo, ladoMax){
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const esc0 = Math.min(1, ladoMax / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * esc0), h = Math.round(img.naturalHeight * esc0);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : falha(new Error("Não consegui reduzir a foto.")), "image/jpeg", 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error("Arquivo não é uma imagem.")); };
    img.src = url;
  });
}

OP.telas.foto = async function(){
  const s = OP.snap, box = $("op-foto-conteudo");
  const ed = diaEditavel();
  const lista = (s.fotos || []).filter(f => !f.desconsiderada);
  const noAparelho = new Set(_filaCache.filter(o => o.rpc === "upload_foto" && o.situacao === "pendente").map(o => o.args?.foto_id));
  for(const id of noAparelho){
    if(!_miniaturas.has(id)){
      const f = await idbGet("fotos", id).catch(() => null);
      if(f?.blob) _miniaturas.set(id, URL.createObjectURL(f.blob));
    }
  }
  const execs = s.execucoes || [], pars = s.paradas || [], abs = s.abastecimentos || [];
  // o registro da foto só entra com o dia aberto (campo_exigir); o arquivo já registrado sobe mesmo depois do envio
  const podeFotografar = ed;
  box.innerHTML = `
    ${podeFotografar ? `<section class="op-bloco">
      <p class="op-meta">A foto é de</p>
      <div class="op-chips">${VINCULOS_FOTO.map(([v, r]) =>
        `<button type="button" class="op-chip-btn${_fotoTipo === v ? " ativo" : ""}" data-foto-tipo="${esc(v)}" aria-pressed="${_fotoTipo === v}">${esc(r)}</button>`).join("")}</div>
      ${_fotoTipo === "estaca" ? `<label class="op-campo">Qual estaca<select id="op-foto-exec"><option value="">Escolha…</option>${execs.map(x => `<option value="${esc(x.id)}">${esc(x.estaca_numero)}</option>`).join("")}</select></label>` : ""}
      ${_fotoTipo === "ocorrencia" ? `<label class="op-campo">Qual parada<select id="op-foto-oc"><option value="">Escolha…</option>${pars.map(p => `<option value="${esc(p.id)}">${esc(hhmm(p.periodo_inicio))} · ${esc(p.descricao || "")}</option>`).join("")}</select></label>` : ""}
      ${_fotoTipo === "horimetro" && abs.length ? `<label class="op-campo">Qual lançamento<select id="op-foto-ab"><option value="">Do dia</option>${abs.map(a => `<option value="${esc(a.id)}">${a.quantidade ? num(a.quantidade, 1) + " L" : "Horímetro"}${a.horimetro ? " · " + num(a.horimetro, 1) + " h" : ""}</option>`).join("")}</select></label>` : ""}
      <label class="op-campo">Legenda (opcional)<input type="text" id="op-foto-legenda" maxlength="200"></label>
      <label class="op-btn op-btn-primario op-btn-grande op-btn-arquivo">📷 Tirar foto
        <input type="file" id="op-foto-arquivo" accept="image/*" capture="environment"></label>
    </section>` : ""}
    ${noAparelho.size ? `<div class="op-alerta op-alerta-info">⏳ ${esc(noAparelho.size)} foto(s) no aparelho. Sobem depois dos dados, até o limite automático do dia.
      <button type="button" class="op-btn" id="op-btn-foto-forcar">Enviar fotos agora</button></div>` : ""}
    ${!lista.length && !noAparelho.size ? `<div class="op-vazio">Nenhuma foto no dia.</div>` : ""}
    <div class="op-fotos">${lista.map(f => {
      const local = _miniaturas.get(f.id);
      const estado = noAparelho.has(f.id) ? `<span class="op-selo op-selo-aviso">⏳ no aparelho</span>` : f.enviada ? `<span class="op-selo op-selo-ok">✓ enviada</span>` : seloEstado(f.id);
      return `<figure class="op-foto">
        ${local ? `<img src="${esc(local)}" alt="${esc(f.legenda || ROTULO_VINCULO[f.tipo] || "foto")}">` : `<div class="op-foto-sem" aria-hidden="true">📷</div>`}
        <figcaption>${esc(ROTULO_VINCULO[f.tipo] || f.tipo)}${f.legenda ? " · " + esc(f.legenda) : ""}<br>${estado}</figcaption>
        ${ed && f.enviada ? `<button type="button" class="op-btn op-btn-perigo" data-foto-desconsiderar="${esc(f.id)}">Desconsiderar</button>` : ""}
      </figure>`;
    }).join("")}</div>`;
};

async function tirarFoto(arquivo){
  const s = OP.snap;
  const vinculo = {};
  if(_fotoTipo === "estaca"){ const v = $("op-foto-exec")?.value; if(!v){ avisar("Escolha a estaca.", "aviso"); return; } vinculo.execucao_id = v; }
  if(_fotoTipo === "ocorrencia"){ const v = $("op-foto-oc")?.value; if(!v){ avisar("Escolha a parada.", "aviso"); return; } vinculo.ocorrencia_id = v; }
  if(_fotoTipo === "horimetro" && $("op-foto-ab")?.value) vinculo.abastecimento_id = $("op-foto-ab").value;
  let blob;
  try { blob = await reduzirImagem(arquivo, Number(s.config?.fotos_max_px) || 1600); }
  catch(e){ avisar(e.message, "erro"); return; }
  const id = novoId();
  const path = `rdo/${OP.rdoId}/${id}.jpg`;
  const legenda = $("op-foto-legenda")?.value.trim() || null;
  const tirada = new Date(arquivo.lastModified || Date.now()).toISOString();
  await idbPut("fotos", { id, blob, rdo_id: OP.rdoId, criado_em: new Date().toISOString() });
  (s.fotos || (s.fotos = [])).push({ id, tipo: _fotoTipo, legenda, enviada: false, desconsiderada: false });
  _miniaturas.set(id, URL.createObjectURL(blob));
  await enfileirar("rdo_campo_foto_registrar", { p_rdo: OP.rdoId, p_id: id, p_tipo: _fotoTipo, p_vinculo: Object.keys(vinculo).length ? vinculo : null,
    p_legenda: legenda, p_tirada_em: tirada }, { rotulo: "Foto: " + ROTULO_VINCULO[_fotoTipo], linha_id: id });
  await enfileirar("upload_foto", { foto_id: id, path, rdo_id: OP.rdoId }, { rotulo: "Arquivo da foto", linha_id: id });
  avisar(`Foto guardada (${num(blob.size / 1048576, 1)} MB).`, "ok");
  renderTelaAtual();
}

async function desconsiderarFoto(id){
  if(!navigator.onLine){ avisar("Desconsiderar foto precisa de sinal.", "aviso"); return; }
  const motivo = prompt("Por que desconsiderar esta foto?");
  if(motivo == null) return;
  if(motivo.trim().length < 5){ avisar("Escreva o motivo (pelo menos 5 letras).", "aviso"); return; }
  const { error } = await sb.rpc("rdo_campo_foto_desconsiderar", { p_id: id, p_motivo: motivo.trim() });
  if(error){ avisar(mensagemDoBanco(error), "erro"); return; }
  const f = (OP.snap.fotos || []).find(x => x.id === id);
  if(f) f.desconsiderada = true;
  avisar("Foto desconsiderada.", "ok");
  renderTelaAtual();
}

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button");
  if(!el || el.disabled) return;
  if(el.dataset.fotoTipo){ _fotoTipo = el.dataset.fotoTipo; renderTelaAtual(); return; }
  if(el.dataset.fotoDesconsiderar){ el.disabled = true; try { await desconsiderarFoto(el.dataset.fotoDesconsiderar); } finally { el.disabled = false; } return; }
  if(el.id === "op-btn-foto-forcar"){
    if(!navigator.onLine){ avisar("Sem sinal agora: as fotos sobem quando voltar.", "aviso"); return; }
    OP.forcarFotos = true;
    el.disabled = true;
    try { await drenar(); } finally { OP.forcarFotos = false; }
  }
});
document.addEventListener("change", async (ev) => {
  if(ev.target.id !== "op-foto-arquivo") return;
  const arq = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if(arq) await tirarFoto(arq);
});

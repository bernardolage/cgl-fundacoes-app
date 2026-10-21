/* ====================================================================
   Módulo: EPI por colaborador (fase 100, 21/10/2026 — chamados #97 e #100; spec docs/specs/fase-100-almoxarifado-epi.md)
   - Assinatura do recebimento na tela (toque ou mouse): canvas → PNG → Blob com MIME explícito → bucket privado
     epi-assinaturas/<funcionario_id>/<arquivo>.png → RPC epi_assinar (decisão 2 do Bernardo: D4Sign fora).
   - Aba "EPI" da ficha do funcionário (NR-6): item, CA, data, quantidade, assinatura, troca prevista, devolução e
     a ficha de EPI em PDF.
   - Relatório "EPI por colaborador e por obra": visão no painel de Estoque (card #epi-card) e no painel de
     Funcionários (visão "EPI", para o RH, que não tem Estoque no menu). Gasto por pessoa por mês com a média da
     função, por obra, por item, trocas vencidas, saídas sem pessoa e a conferência das categorias; .xlsx.
   - Card EPI da Sala de Comando (vw_sc_epi) e "Para regularizar" do SESMT (vw_sc_regularizar_sesmt, dashboard.js).
   Quem vê (podeVerEpi = pode_ver_epi() no banco): diretor, admin, almoxarife, sesmt, rh e auditor. O encarregado
   não vê (decisão 3); o auxiliar de almoxarifado entrega e colhe a assinatura no balcão, sem relatório (valores).
   Tudo lê das views da fase 100: sem a migration (view inexistente) as telas mostram aviso, sem quebrar.
   Prefixo dos IDs: epi-. Depende em tempo de execução de estoque.js (balCarregarFuncionarios, estPodeEditar),
   funcionarios.js (funcEditId, abrirFuncionario, _depts) e core.js.
   ==================================================================== */

const EPI_CAT_LBL = { epi: "EPI", uniforme: "Uniforme" };
const EPI_VISOES = [
  ["pessoa", "Por colaborador"], ["obra", "Por obra"], ["item", "Por item"],
  ["vencidas", "Trocas vencidas"], ["sem_pessoa", "Sem pessoa"], ["conferencia", "Conferência de categorias"]
];
const EPI_MES_LBL = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function podeVerEpi(){ return !!usuarioAtual && ["diretor", "admin", "almoxarife", "sesmt", "rh", "auditor"].includes(usuarioAtual.cargo); }
/* entrega, assinatura, devolução e "informar quem recebeu" (epi_pode_operar no banco: quem movimenta estoque + sesmt) */
function epiPodeOperar(){
  if(!usuarioAtual || (typeof ehSomenteLeitura === "function" && ehSomenteLeitura())) return false;
  return (typeof estPodeEditar === "function" && estPodeEditar()) || usuarioAtual.cargo === "sesmt";
}
/* marcar EPI/uniforme na conferência (epi_marcar_produtos) e CA/validade (produtos_write) */
function epiPodeMarcar(){ return !!usuarioAtual && ["diretor", "admin", "almoxarife", "sesmt"].includes(usuarioAtual.cargo); }
function epiPodeEditarProduto(){ return !!usuarioAtual && ["diretor", "admin", "almoxarife", "comprador", "gestor_acessorios"].includes(usuarioAtual.cargo); }
function epiViewAusente(error){ return !!error && ["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code); }
const EPI_MSG_MIGRATION = "O controle de EPI por colaborador entra quando a migration da fase 100 for aplicada no banco.";
function epiNorm(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function epiMesChave(iso){ return String(iso || "").slice(0, 7); }
function epiMesRotulo(chave){ const [a, m] = chave.split("-"); return `${EPI_MES_LBL[Number(m) - 1]}/${a.slice(2)}`; }
function epiMesesEntre(de, ate){
  const r = []; let [a, m] = de.split("-").map(Number); const [a2, m2] = ate.split("-").map(Number);
  while((a < a2 || (a === a2 && m <= m2)) && r.length < 36){ r.push(`${a}-${String(m).padStart(2, "0")}`); m++; if(m > 12){ m = 1; a++; } }
  return r;
}
function epiFimDoMes(chave){ const [a, m] = chave.split("-").map(Number); return dataLocalISO(new Date(a, m, 0, 12)); }
function epiDestino(r){ return r.obra_codigo ? `Obra ${r.obra_codigo}` : r.equipamento_codigo ? `TAG ${r.equipamento_codigo}` : (r.centro_nome || "—"); }

/* ====================================================================
   Assinatura na tela
   ==================================================================== */
let _epiAss = null;   // { funcionarioId, ids, aoConcluir, riscos, desenhando }
function epiModalAssinatura(){
  let m = $("epi-ass-modal");
  if(m) return m;
  m = document.createElement("div");
  m.className = "modal-fundo"; m.id = "epi-ass-modal"; m.style.display = "none";
  m.innerHTML = `<div class="modal-caixa" style="max-width:620px;">
      <div class="modal-topo"><h3>✍ Assinatura do recebimento de EPI</h3><button type="button" class="btn-sec" id="btn-epi-ass-fechar">×</button></div>
      <div id="epi-ass-texto" class="meta bloco"></div>
      <div id="epi-ass-itens"></div>
      <canvas id="epi-ass-canvas" class="epi-ass-canvas" aria-label="Área para assinar com o dedo ou o mouse"></canvas>
      <div class="meta">Assine com o dedo (celular ou tablet) ou com o mouse, dentro do quadro.</div>
      <div id="epi-ass-aviso" class="aviso"></div>
      <div class="form-acoes compacta">
        <button type="button" class="btn" id="btn-epi-ass-salvar">✍ Assinar e salvar</button>
        <button type="button" class="btn-sec" id="btn-epi-ass-limpar">Limpar</button>
        <button type="button" class="btn-sec" id="btn-epi-ass-depois" title="A entrega fica com a assinatura pendente na ficha de EPI">Assinar depois</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  const cv = m.querySelector("#epi-ass-canvas");
  const ponto = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener("pointerdown", e => {
    if(!_epiAss) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const ctx = cv.getContext("2d"), [x, y] = ponto(e);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke();
    _epiAss.desenhando = true; _epiAss.riscos++;
  });
  cv.addEventListener("pointermove", e => {
    if(!_epiAss || !_epiAss.desenhando) return;
    const ctx = cv.getContext("2d"), [x, y] = ponto(e);
    ctx.lineTo(x, y); ctx.stroke(); _epiAss.riscos++;
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(ev => cv.addEventListener(ev, () => { if(_epiAss) _epiAss.desenhando = false; }));
  m.querySelector("#btn-epi-ass-limpar").addEventListener("click", epiLimparCanvas);
  m.querySelector("#btn-epi-ass-fechar").addEventListener("click", () => epiFecharAssinatura(false));
  m.querySelector("#btn-epi-ass-depois").addEventListener("click", () => epiFecharAssinatura(false));
  m.querySelector("#btn-epi-ass-salvar").addEventListener("click", e => comBotaoTravado(e.currentTarget, epiSalvarAssinatura));
  return m;
}
/* o canvas é dimensionado ao abrir (largura real × devicePixelRatio) e a tinta é o token --txt */
function epiLimparCanvas(){
  const cv = $("epi-ass-canvas"); if(!cv) return;
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--txt").trim() || "black";
  if(_epiAss) _epiAss.riscos = 0;
}
/* itens: [{ id (saída), descricao }]; aoConcluir(assinou: boolean) */
function epiAbrirAssinatura({ funcionarioId, funcionarioNome, itens, aoConcluir }){
  if(!funcionarioId || !(itens || []).length) return;
  const m = epiModalAssinatura();
  _epiAss = { funcionarioId, ids: itens.map(i => i.id), aoConcluir, riscos: 0, desenhando: false };
  $("epi-ass-texto").innerHTML = `Eu, <strong>${esc(funcionarioNome || "colaborador")}</strong>, declaro que recebi da CGL Fundações os equipamentos abaixo, gratuitamente e em perfeito estado, e me comprometo a usá-los apenas para a finalidade a que se destinam, a guardá-los e conservá-los, a comunicar qualquer alteração que os torne impróprios para uso e a devolvê-los quando solicitado (NR-6, item 6.7.1).`;
  $("epi-ass-itens").innerHTML = `<ul class="meta" style="margin:6px 0 10px 18px;">${itens.map(i => `<li>${esc(i.descricao)}</li>`).join("")}</ul>`;
  const av = $("epi-ass-aviso"); av.textContent = ""; av.className = "aviso";
  m.style.display = "flex";
  requestAnimationFrame(epiLimparCanvas);
}
function epiFecharAssinatura(assinou){
  const m = $("epi-ass-modal"); if(m) m.style.display = "none";
  const cb = _epiAss?.aoConcluir; _epiAss = null;
  if(typeof cb === "function") cb(!!assinou);
}
async function epiSalvarAssinatura(){
  if(!_epiAss) return;
  if(_epiAss.riscos < 8){ aviso("epi-ass-aviso", "Assine dentro do quadro antes de salvar.", "erro"); return; }
  const cv = $("epi-ass-canvas");
  const png = await new Promise(ok => cv.toBlob(ok, "image/png"));
  if(!png){ aviso("epi-ass-aviso", "Não foi possível gerar a imagem da assinatura.", "erro"); return; }
  // regra de uploads (CLAUDE.md): MIME explícito, reembalado em Blob
  const blob = new Blob([png], { type: "image/png" });
  const path = `${_epiAss.funcionarioId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const up = await sb.storage.from("epi-assinaturas").upload(path, blob, { contentType: "image/png", upsert: false });
  if(up.error){ aviso("epi-ass-aviso", "A assinatura não subiu: " + up.error.message, "erro"); return; }
  const { error } = await sb.rpc("epi_assinar", { p_ids: _epiAss.ids, p_path: path });
  if(error){ aviso("epi-ass-aviso", "A assinatura não foi registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", "Assinatura registrada na ficha de EPI.", "ok");
  epiFecharAssinatura(true);
}
/* imagem da assinatura: URL assinada (bucket privado) ou data URL para o PDF */
async function epiUrlAssinatura(path){
  if(!path) return null;
  const { data } = await sb.storage.from("epi-assinaturas").createSignedUrl(path, 600);
  return data?.signedUrl || null;
}
async function epiDataUrlAssinatura(path){
  if(!path) return null;
  const { data, error } = await sb.storage.from("epi-assinaturas").download(path);
  if(error || !data) return null;
  return await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(data); });
}

/* ====================================================================
   Aba EPI da ficha do funcionário
   ==================================================================== */
let _epiFicha = { funcionarioId: null, linhas: [] };
function epiAplicarVisibilidadeFicha(){
  const b = document.querySelector('#func-notebook button[data-tab="epi"]');
  if(b) b.style.display = podeVerEpi() && typeof funcEditId !== "undefined" && funcEditId ? "" : "none";
}
async function epiCarregarFicha(){
  const cont = $("func-epi-conteudo"); if(!cont) return;
  if(!podeVerEpi()){ cont.innerHTML = `<p class="vazio">Só almoxarifado, SESMT, RH e diretoria veem a ficha de EPI.</p>`; return; }
  const id = typeof funcEditId !== "undefined" ? funcEditId : null;
  if(!id){ cont.innerHTML = `<p class="vazio">Salve o funcionário primeiro.</p>`; return; }
  cont.innerHTML = `<p class="vazio">Carregando…</p>`;
  const { data, error } = await sb.from("vw_epi_saidas").select("*").eq("funcionario_id", id)
    .order("data_movimentacao", { ascending: false }).limit(2000);
  if(id !== funcEditId) return;
  if(error){ cont.innerHTML = `<p class="vazio">${esc(epiViewAusente(error) ? EPI_MSG_MIGRATION : "Não foi possível ler a ficha de EPI: " + error.message)}</p>`; return; }
  _epiFicha = { funcionarioId: id, linhas: data || [] };
  renderEpiFicha();
}
function renderEpiFicha(){
  const cont = $("func-epi-conteudo"); if(!cont) return;
  const L = _epiFicha.linhas, opera = epiPodeOperar();
  const ano = dataLocalISO(new Date(Date.now() - 365 * 864e5));
  const vencidas = L.filter(r => r.troca_vencida).length;
  const pend = L.filter(r => r.categoria === "epi" && !r.assinatura_em && !r.epi_devolvido_em);
  const chip = (n, rot, cor) => `<div class="chip"><span>${esc(rot)}</span><strong>${cor ? `<span class="tag ${cor}">${n}</span>` : n}</strong></div>`;
  cont.innerHTML = `<div class="odoo-contexto" style="margin:0 0 10px;">
      ${chip(L.length, "Entregas")}
      ${chip(brl(L.filter(r => r.data_entrega >= ano).reduce((s, r) => s + Number(r.valor || 0), 0)), "Gasto em 12 meses")}
      ${chip(vencidas, "Trocas vencidas", vencidas ? "vermelho" : "")}
      ${chip(pend.length, "Sem assinatura", pend.length ? "ambar" : "")}
    </div>
    <div class="form-acoes compacta" style="margin:0 0 10px;">
      <button type="button" class="btn-sec" id="btn-epi-pdf" ${L.length ? "" : "disabled"}>🖨 Ficha de EPI (PDF)</button>
      ${opera && pend.length ? `<button type="button" class="btn" id="btn-epi-assinar-pend">✍ Colher assinatura (${pend.length} pendente${pend.length > 1 ? "s" : ""})</button>` : ""}
    </div>
    ${!L.length ? `<p class="vazio">Nenhuma entrega de EPI ou uniforme registrada para este colaborador. As entregas entram pela saída do Estoque com "Quem retira".</p>` : `
    <div class="tabela-rola"><table>
      <thead><tr><th>Entrega</th><th>Item</th><th>CA</th><th class="num">Qtd</th><th class="num">Valor</th><th>Destino</th><th>Assinatura</th><th>Troca prevista</th><th>Devolução</th></tr></thead>
      <tbody>${L.map((r, i) => `<tr>
        <td>${dataBR(r.data_entrega)}</td>
        <td>${esc(r.produto_nome || "—")} <span class="tag ${r.categoria === "epi" ? "azul" : "cinza"}">${esc(EPI_CAT_LBL[r.categoria] || r.categoria || "")}</span></td>
        <td>${esc(r.ca || "—")}</td>
        <td class="num">${num(r.quantidade)} <span class="meta">${esc(r.unidade || "")}</span></td>
        <td class="num">${brl(r.valor)}</td>
        <td>${esc(epiDestino(r))}</td>
        <td>${r.assinatura_em ? `<button type="button" class="link-mini" data-epi-ver-ass="${i}" title="ver a assinatura">✔ ${dataBR(String(r.assinatura_em).slice(0, 10))}</button>`
              : r.epi_devolvido_em ? '<span class="meta">—</span>' : '<span class="tag ambar">pendente</span>'}</td>
        <td>${r.troca_prevista ? dataBR(r.troca_prevista) : '<span class="meta">—</span>'}
            ${r.troca_vencida ? ' <span class="tag vermelho">vencida</span>' : r.substituida ? ' <span class="tag cinza">trocado</span>' : ""}</td>
        <td>${r.epi_devolvido_em ? `${dataBR(r.epi_devolvido_em)}${r.epi_devolucao_obs ? ` <span class="meta">${esc(r.epi_devolucao_obs)}</span>` : ""}`
              : opera ? `<button type="button" class="btn-sec btn-sm" data-epi-devolver="${i}">↩ Devolver</button>` : '<span class="meta">—</span>'}</td>
      </tr>`).join("")}</tbody></table></div>`}`;
}
async function epiFichaClique(e){
  const ver = e.target.closest("[data-epi-ver-ass]");
  if(ver){
    const r = _epiFicha.linhas[Number(ver.dataset.epiVerAss)]; const url = await epiUrlAssinatura(r?.assinatura_path);
    if(url) window.open(url, "_blank", "noopener"); else aviso("func-epi-aviso", "Não foi possível abrir a assinatura.", "erro");
    return;
  }
  const dev = e.target.closest("[data-epi-devolver]");
  if(dev){ await epiDevolver(_epiFicha.linhas[Number(dev.dataset.epiDevolver)]); return; }
  const b = e.target.closest("button[id]"); if(!b) return;
  if(b.id === "btn-epi-pdf") comBotaoTravado(b, () => epiGerarFichaPdf(_epiFicha.funcionarioId));
  if(b.id === "btn-epi-assinar-pend"){
    const pend = _epiFicha.linhas.filter(r => r.categoria === "epi" && !r.assinatura_em && !r.epi_devolvido_em);
    epiAbrirAssinatura({ funcionarioId: _epiFicha.funcionarioId, funcionarioNome: $("func-nome")?.value || pend[0]?.funcionario_nome,
      itens: pend.map(r => ({ id: r.id, descricao: `${dataBR(r.data_entrega)} · ${num(r.quantidade)} ${r.unidade || ""} · ${r.produto_nome}${r.ca ? " (CA " + r.ca + ")" : ""}` })),
      aoConcluir: assinou => { if(assinou) epiCarregarFicha(); } });
  }
}
async function epiDevolver(r){
  if(!r || !epiPodeOperar()) return;
  const data = prompt(`Devolução de ${r.produto_nome}: data (AAAA-MM-DD)`, hojeISO());
  if(data === null) return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.trim())){ aviso("func-epi-aviso", "Data inválida: use AAAA-MM-DD.", "erro"); return; }
  const obs = prompt("Observação da devolução (opcional): ex.: desgaste, troca, demissão", "") || "";
  const { error } = await sb.rpc("epi_registrar_devolucao", { p_id: r.id, p_data: data.trim(), p_obs: obs.trim() || null });
  if(error){ aviso("func-epi-aviso", "Devolução não registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("func-epi-aviso", "Devolução registrada.", "ok");
  await epiCarregarFicha();
}

/* Ficha de EPI em PDF (NR-6): cabeçalho com o logo, dados do colaborador, declaração, tabela com a assinatura de
   cada entrega. Gerador de PDF: estilo inline (roda fora do CSS do app), sem cor própria (bordas em currentColor). */
async function epiGerarFichaPdf(funcionarioId){
  if(!funcionarioId) return;
  const [{ data: f }, { data: linhas, error }] = await Promise.all([
    sb.from("funcionarios").select("nome,funcao,matricula,data_admissao,departamento_id").eq("id", funcionarioId).single(),
    sb.from("vw_epi_saidas").select("*").eq("funcionario_id", funcionarioId).order("data_movimentacao", { ascending: true }).limit(2000)
  ]);
  if(error){ aviso("func-epi-aviso", epiViewAusente(error) ? EPI_MSG_MIGRATION : "Não foi possível gerar a ficha: " + error.message, "erro"); return; }
  const imgs = await Promise.all((linhas || []).map(r => epiDataUrlAssinatura(r.assinatura_path)));
  const cel = "border:1px solid;padding:1.2mm 1.6mm;font-size:8.5pt;vertical-align:middle;";
  const dep = (typeof deptNome === "function" && f?.departamento_id) ? deptNome(f.departamento_id) : "—";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;">
    ${pdfCabecalhoHTML("Ficha de controle de entrega de EPI", "NR-6 · CGL Fundações Ltda")}
    <table style="width:100%;border-collapse:collapse;margin:5mm 0 3mm;" class="nao-quebrar"><tr>
      <td style="${cel}"><strong>Colaborador:</strong> ${esc(f?.nome || "—")}</td>
      <td style="${cel}"><strong>Matrícula:</strong> ${esc(f?.matricula || "—")}</td></tr>
      <tr><td style="${cel}"><strong>Função:</strong> ${esc(f?.funcao || "—")} · <strong>Setor:</strong> ${esc(dep)}</td>
      <td style="${cel}"><strong>Admissão:</strong> ${f?.data_admissao ? dataBR(f.data_admissao) : "—"}</td></tr></table>
    <p style="font-size:8.5pt;line-height:1.35;text-align:justify;margin:0 0 3mm;" class="nao-quebrar">Declaro ter recebido da CGL Fundações Ltda, gratuitamente,
      os equipamentos de proteção individual relacionados abaixo, em perfeito estado, e ter sido orientado sobre o uso correto. Comprometo-me a
      usá-los apenas para a finalidade a que se destinam, responsabilizar-me pela guarda e conservação, comunicar qualquer alteração que os torne
      impróprios para uso e devolvê-los quando solicitado, ciente de que a recusa injustificada ao uso constitui ato faltoso (NR-6, item 6.7.1, e CLT, art. 158).</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>${["Data", "Qtd", "Item", "CA", "Troca prevista", "Devolução", "Assinatura"].map(t => `<th style="${cel}font-weight:700;text-align:left;">${t}</th>`).join("")}</tr></thead>
      <tbody>${(linhas || []).map((r, i) => `<tr>
        <td style="${cel}white-space:nowrap;">${dataBR(r.data_entrega)}</td>
        <td style="${cel}text-align:right;">${num(r.quantidade)} ${esc(r.unidade || "")}</td>
        <td style="${cel}">${esc(r.produto_nome || "")}</td>
        <td style="${cel}">${esc(r.ca || "—")}</td>
        <td style="${cel}white-space:nowrap;">${r.troca_prevista ? dataBR(r.troca_prevista) : "—"}</td>
        <td style="${cel}white-space:nowrap;">${r.epi_devolvido_em ? dataBR(r.epi_devolvido_em) : ""}</td>
        <td style="${cel}width:38mm;height:11mm;">${imgs[i] ? `<img src="${imgs[i]}" alt="" style="display:block;max-height:10mm;max-width:36mm;">` : ""}</td>
      </tr>`).join("")}</tbody></table>
    <p style="font-size:7.5pt;margin:2mm 0 0;">Gerado pelo Controle CGL em ${dataBR(hojeISO())}. Assinaturas colhidas na tela no momento da entrega; as em branco estão pendentes.</p>
  </div>`;
  const el = document.createElement("div"); el.innerHTML = html;
  const nome = String(f?.nome || "colaborador").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  await pdfGerar(el, { filename: `ficha-epi-${nome}-${hojeISO()}.pdf` });
}

/* ====================================================================
   Relatório EPI por colaborador e por obra (Estoque › card EPI; Funcionários › visão EPI)
   ==================================================================== */
const _epiRel = { visao: "pessoa", de: null, ate: null, busca: "", dados: null, chave: null, extra: {}, linhasExport: [] };
function epiRelPeriodoPadrao(){
  if(_epiRel.de) return;
  const hoje = hojeISO(), d = new Date(hoje + "T12:00:00"); d.setMonth(d.getMonth() - 5);
  _epiRel.ate = epiMesChave(hoje); _epiRel.de = epiMesChave(dataLocalISO(d));
}
/* desenha a casca (visões + filtros) no container e liga os eventos uma vez */
function epiRenderRelatorio(alvoId){
  const cont = $(alvoId); if(!cont) return;
  if(!podeVerEpi()){ cont.innerHTML = `<p class="vazio">Só almoxarifado, SESMT, RH e diretoria veem o relatório de EPI.</p>`; return; }
  epiRelPeriodoPadrao();
  cont.innerHTML = `<div class="epi-rel">
      <div class="lista-topo compacta">
        <div class="serv-views">${EPI_VISOES.map(([v, l]) => `<button type="button" class="serv-view-btn${v === _epiRel.visao ? " ativo" : ""}" data-epi-visao="${v}">${esc(l)}</button>`).join("")}</div>
        <button type="button" class="btn-sec btn-sm" data-epi-xlsx="1" style="margin-left:auto;">⬇ Exportar .xlsx</button>
      </div>
      <div class="serv-filtros">
        <input data-epi-busca placeholder="Filtrar por colaborador, função, obra ou item…" value="${esc(_epiRel.busca)}" />
        <input type="month" data-epi-de value="${esc(_epiRel.de)}" title="mês inicial (trocas vencidas e conferência ignoram o período)" aria-label="mês inicial" />
        <input type="month" data-epi-ate value="${esc(_epiRel.ate)}" title="mês final" aria-label="mês final" />
      </div>
      <div class="epi-rel-corpo"><p class="vazio">Carregando…</p></div>
    </div>`;
  if(!cont.dataset.epiLigado){
    cont.dataset.epiLigado = "1";
    cont.addEventListener("click", e => epiRelClique(e, alvoId));
    cont.addEventListener("change", e => {
      if(e.target.matches("[data-epi-de]")){ _epiRel.de = e.target.value || _epiRel.de; _epiRel.dados = null; epiRelCarregar(alvoId); }
      if(e.target.matches("[data-epi-ate]")){ _epiRel.ate = e.target.value || _epiRel.ate; _epiRel.dados = null; epiRelCarregar(alvoId); }
      if(e.target.matches("[data-epi-cat]")) epiConfMarcar(e.target, alvoId);
      if(e.target.matches("[data-epi-ca], [data-epi-val]")) epiConfSalvarProduto(e.target);
    });
    cont.addEventListener("input", debounce(e => { if(e.target.matches("[data-epi-busca]")){ _epiRel.busca = e.target.value; epiRelDesenhar(alvoId); } }, 200));
  }
  epiRelCarregar(alvoId);
}
async function epiRelCarregar(alvoId){
  const cont = $(alvoId); const corpo = cont?.querySelector(".epi-rel-corpo"); if(!corpo) return;
  if(_epiRel.de > _epiRel.ate){ corpo.innerHTML = `<p class="vazio">O início do período é depois do fim.</p>`; return; }
  corpo.innerHTML = `<p class="vazio">Carregando…</p>`;
  const v = _epiRel.visao;
  let q;
  if(v === "vencidas") q = sb.from("vw_epi_saidas").select("*").eq("troca_vencida", true).eq("funcionario_ativo", true).order("troca_prevista").limit(5000);
  else if(v === "conferencia") q = sb.from("vw_epi_conferencia").select("*").order("categoria_sugerida", { nullsFirst: false }).order("nome").limit(5000);
  else {
    q = sb.from("vw_epi_saidas").select("*").gte("data_entrega", _epiRel.de + "-01").lte("data_entrega", epiFimDoMes(_epiRel.ate)).order("data_entrega").limit(20000);
    if(v === "sem_pessoa") q = q.is("funcionario_id", null).eq("categoria", "epi");
  }
  const { data, error } = await q;
  if(error){ corpo.innerHTML = `<p class="vazio">${esc(epiViewAusente(error) ? EPI_MSG_MIGRATION : "Não foi possível carregar: " + error.message)}</p>`; return; }
  _epiRel.dados = data || [];
  epiRelDesenhar(alvoId);
}
function epiRelFiltrar(L){
  const t = epiNorm(_epiRel.busca.trim()); if(!t) return L;
  return L.filter(r => epiNorm([r.funcionario_nome, r.funcao, r.produto_nome, r.produto_codigo, r.nome, r.codigo, r.obra_codigo, r.obra_nome, r.centro_nome, r.equipamento_codigo].filter(Boolean).join(" ")).includes(t));
}
function epiRelDesenhar(alvoId){
  const cont = $(alvoId); const corpo = cont?.querySelector(".epi-rel-corpo"); if(!corpo || !_epiRel.dados) return;
  cont.querySelectorAll("[data-epi-visao]").forEach(b => b.classList.toggle("ativo", b.dataset.epiVisao === _epiRel.visao));
  const L = epiRelFiltrar(_epiRel.dados), v = _epiRel.visao;
  const meses = epiMesesEntre(_epiRel.de, _epiRel.ate);
  if(v === "pessoa" || v === "obra"){
    const chave = v === "pessoa" ? (r => r.funcionario_id) : (r => r.obra_id || r.equipamento_id || r.centro_custo_id || "—");
    const grupos = new Map();
    L.filter(r => v === "obra" || r.funcionario_id).forEach(r => {
      const k = chave(r); let g = grupos.get(k);
      if(!g){ g = { id: k, nome: v === "pessoa" ? r.funcionario_nome : epiDestino(r) + (r.obra_nome ? " — " + r.obra_nome : ""), funcao: r.funcao || "", porMes: {}, total: 0, qtd: 0 }; grupos.set(k, g); }
      const m = epiMesChave(r.data_entrega); g.porMes[m] = (g.porMes[m] || 0) + Number(r.valor || 0); g.total += Number(r.valor || 0); g.qtd++;
    });
    const lista = [...grupos.values()].sort((a, b) => b.total - a.total);
    // média por função: total médio por pessoa da mesma função que recebeu algo no período
    const mediaFuncao = {};
    if(v === "pessoa"){ const agg = {}; lista.forEach(g => { const a = agg[g.funcao] || (agg[g.funcao] = { s: 0, n: 0 }); a.s += g.total; a.n++; }); Object.entries(agg).forEach(([k, a]) => { mediaFuncao[k] = a.n ? a.s / a.n : 0; }); }
    const semPessoa = v === "pessoa" ? L.filter(r => !r.funcionario_id).reduce((s, r) => s + Number(r.valor || 0), 0) : 0;
    const totMes = {}; lista.forEach(g => meses.forEach(m => { totMes[m] = (totMes[m] || 0) + (g.porMes[m] || 0); }));
    const totalGeral = lista.reduce((s, g) => s + g.total, 0);
    _epiRel.linhasExport = lista.map(g => Object.assign(v === "pessoa" ? { "Colaborador": g.nome, "Função": g.funcao } : { "Obra / destino": g.nome },
      Object.fromEntries(meses.map(m => [epiMesRotulo(m), Number((g.porMes[m] || 0).toFixed(2))])),
      { "Total": Number(g.total.toFixed(2)), "Entregas": g.qtd },
      v === "pessoa" ? { "Média da função": Number((mediaFuncao[g.funcao] || 0).toFixed(2)) } : {}));
    if(!lista.length){ corpo.innerHTML = `<p class="vazio">Nenhuma entrega${v === "pessoa" ? " com colaborador" : ""} no período.</p>`; return; }
    corpo.innerHTML = `<p class="meta" style="margin:0 0 6px;"><strong>${brl(totalGeral)}</strong> em ${lista.length} ${v === "pessoa" ? "colaborador(es)" : "destino(s)"} no período${semPessoa ? ` · ${brl(semPessoa)} em saídas sem pessoa (veja "Sem pessoa")` : ""}${v === "pessoa" ? " · clique no nome para abrir a ficha de EPI" : ""}</p>
      <div class="tabela-rola"><table>
        <thead><tr><th>${v === "pessoa" ? "Colaborador" : "Obra / destino"}</th>${v === "pessoa" ? "<th>Função</th>" : ""}${meses.map(m => `<th class="num">${epiMesRotulo(m)}</th>`).join("")}<th class="num">Total</th>${v === "pessoa" ? '<th class="num" title="Total médio por pessoa da mesma função no período">Média da função</th><th class="num">vs média</th>' : ""}</tr></thead>
        <tbody>${lista.map(g => { const med = mediaFuncao[g.funcao] || 0, dif = med ? (g.total / med - 1) * 100 : 0;
          return `<tr${v === "pessoa" ? ` class="linha-clicavel" data-epi-func="${esc(g.id)}"` : ""}>
            <td><strong>${esc(g.nome || "—")}</strong></td>${v === "pessoa" ? `<td>${esc(g.funcao || "—")}</td>` : ""}
            ${meses.map(m => `<td class="num">${g.porMes[m] ? brl(g.porMes[m]) : '<span class="meta">—</span>'}</td>`).join("")}
            <td class="num"><strong>${brl(g.total)}</strong></td>
            ${v === "pessoa" ? `<td class="num">${brl(med)}</td><td class="num">${med && Math.abs(dif) >= 1 ? `<span class="tag ${dif > 25 ? "vermelho" : dif > 0 ? "ambar" : "verde"}">${dif > 0 ? "+" : ""}${Math.round(dif)}%</span>` : '<span class="meta">—</span>'}</td>` : ""}
          </tr>`; }).join("")}</tbody>
        <tfoot><tr><td${v === "pessoa" ? ' colspan="2"' : ""}><strong>Total</strong></td>${meses.map(m => `<td class="num"><strong>${brl(totMes[m] || 0)}</strong></td>`).join("")}<td class="num"><strong>${brl(totalGeral)}</strong></td>${v === "pessoa" ? "<td></td><td></td>" : ""}</tr></tfoot>
      </table></div>`;
    return;
  }
  if(v === "item"){
    const grupos = new Map();
    L.forEach(r => { let g = grupos.get(r.produto_id); if(!g){ g = { codigo: r.produto_codigo, nome: r.produto_nome, cat: r.categoria, ca: r.ca, un: r.unidade, qtd: 0, valor: 0, pessoas: new Set() }; grupos.set(r.produto_id, g); }
      g.qtd += Number(r.quantidade || 0); g.valor += Number(r.valor || 0); if(r.funcionario_id) g.pessoas.add(r.funcionario_id); });
    const lista = [...grupos.values()].sort((a, b) => b.valor - a.valor);
    _epiRel.linhasExport = lista.map(g => ({ "Código": g.codigo, "Item": g.nome, "Categoria": EPI_CAT_LBL[g.cat] || g.cat, "CA": g.ca || "", "Quantidade": g.qtd, "Un": g.un || "", "Valor": Number(g.valor.toFixed(2)), "Colaboradores": g.pessoas.size }));
    corpo.innerHTML = !lista.length ? `<p class="vazio">Nenhuma saída de EPI ou uniforme no período.</p>` : `<div class="tabela-rola"><table>
      <thead><tr><th>Código</th><th>Item</th><th>Categoria</th><th>CA</th><th class="num">Quantidade</th><th class="num">Valor</th><th class="num">Colaboradores</th></tr></thead>
      <tbody>${lista.map(g => `<tr><td><strong>${esc(g.codigo)}</strong></td><td>${esc(g.nome)}</td><td><span class="tag ${g.cat === "epi" ? "azul" : "cinza"}">${esc(EPI_CAT_LBL[g.cat] || g.cat || "")}</span></td><td>${esc(g.ca || "—")}</td>
        <td class="num">${num(g.qtd)} <span class="meta">${esc(g.un || "")}</span></td><td class="num">${brl(g.valor)}</td><td class="num">${g.pessoas.size}</td></tr>`).join("")}</tbody></table></div>`;
    return;
  }
  if(v === "vencidas"){
    const hoje = new Date(hojeISO() + "T12:00:00");
    _epiRel.linhasExport = L.map(r => ({ "Colaborador": r.funcionario_nome, "Função": r.funcao || "", "Item": r.produto_nome, "CA": r.ca || "", "Entrega": dataBR(r.data_entrega), "Troca prevista": dataBR(r.troca_prevista) }));
    corpo.innerHTML = !L.length ? `<p class="vazio">✅ Nenhuma troca de EPI vencida.</p>` : `<p class="meta" style="margin:0 0 6px;">Última entrega de cada item ao colaborador ativo, sem devolução, com a troca prevista (entrega + validade do produto) já passada. Clique para abrir a ficha de EPI.</p>
      <div class="tabela-rola"><table><thead><tr><th>Colaborador</th><th>Função</th><th>Item</th><th>CA</th><th>Entrega</th><th>Troca prevista</th><th class="num">Atraso</th></tr></thead>
      <tbody>${L.map(r => `<tr class="linha-clicavel" data-epi-func="${esc(r.funcionario_id)}"><td><strong>${esc(r.funcionario_nome || "—")}</strong></td><td>${esc(r.funcao || "—")}</td><td>${esc(r.produto_nome)}</td><td>${esc(r.ca || "—")}</td>
        <td>${dataBR(r.data_entrega)}</td><td>${dataBR(r.troca_prevista)}</td><td class="num"><span class="tag vermelho">${Math.max(0, Math.round((hoje - new Date(r.troca_prevista + "T12:00:00")) / 864e5))} d</span></td></tr>`).join("")}</tbody></table></div>`;
    return;
  }
  if(v === "sem_pessoa"){
    const opera = epiPodeOperar();
    _epiRel.linhasExport = L.map(r => ({ "Data": dataBR(r.data_entrega), "Item": r.produto_nome, "Qtd": Number(r.quantidade || 0), "Valor": Number(r.valor || 0), "Destino": epiDestino(r), "Documento": r.documento || "" }));
    corpo.innerHTML = !L.length ? `<p class="vazio">✅ Nenhuma saída de EPI sem o colaborador no período.</p>` : `<p class="meta" style="margin:0 0 6px;">Saídas de EPI registradas sem quem recebeu (por outra tela ou antes da fase 100). ${opera ? "Informe o colaborador para a entrega entrar na ficha de EPI dele." : ""}</p>
      <div class="tabela-rola"><table><thead><tr><th>Data</th><th>Item</th><th class="num">Qtd</th><th class="num">Valor</th><th>Destino</th><th>Documento</th>${opera ? "<th>Quem recebeu</th>" : ""}</tr></thead>
      <tbody>${L.map((r, i) => `<tr><td>${dataBR(r.data_entrega)}</td><td>${esc(r.produto_nome)}</td><td class="num">${num(r.quantidade)}</td><td class="num">${brl(r.valor)}</td><td>${esc(epiDestino(r))}</td><td class="meta">${esc(r.documento || "")}</td>
        ${opera ? `<td style="white-space:nowrap;"><input list="epi-func-dl" data-epi-quem="${i}" placeholder="nome do colaborador" style="width:200px;" /> <button type="button" class="btn-sec btn-sm" data-epi-informar="${i}">✔</button></td>` : ""}</tr>`).join("")}</tbody></table></div>
      ${opera ? '<datalist id="epi-func-dl"></datalist>' : ""}`;
    if(opera && typeof balCarregarFuncionarios === "function") balCarregarFuncionarios().then(fs => { const dl = $("epi-func-dl"); if(dl) dl.innerHTML = fs.map(f => `<option value="${esc(f.nome)}">${esc(f.funcao || "")}</option>`).join(""); });
    return;
  }
  if(v === "conferencia"){
    const marca = epiPodeMarcar(), editaProd = epiPodeEditarProduto();
    const aplicaveis = L.filter(r => !r.categoria_atual && r.categoria_sugerida);
    const div = L.filter(r => !r.confere).length;
    _epiRel.linhasExport = L.map(r => ({ "Código": r.codigo, "Produto": r.nome, "Ativo": r.ativo ? "sim" : "não", "Categoria do Odoo": r.categoria_odoo || "", "Categoria atual": EPI_CAT_LBL[r.categoria_atual] || r.categoria_atual || "", "Sugerida pelo nome": EPI_CAT_LBL[r.categoria_sugerida] || "", "CA": r.ca || "", "Troca a cada (dias)": r.epi_validade_dias ?? "" }));
    corpo.innerHTML = `<p class="meta" style="margin:0 0 6px;">Produtos das categorias do Odoo "EPI / UNIFORMES" e "EPI" e os já marcados. A sugestão vem do nome; quem decide é o almoxarifado (com o SESMT). EPI exige "quem retira" na saída e entra na ficha do colaborador; uniforme entra na ficha quando sai com a pessoa. ${L.length} produto(s), ${div} diferente(s) da sugestão.</p>
      ${marca && aplicaveis.length ? `<div class="form-acoes compacta" style="margin:0 0 8px;"><button type="button" class="btn" data-epi-aplicar="1">✔ Aplicar sugestões (${aplicaveis.length} sem categoria)</button> <span class="meta">não mexe no que já tem categoria escolhida</span></div>` : ""}
      ${!L.length ? `<p class="vazio">Nenhum produto nas categorias de EPI.</p>` : `<div class="tabela-rola"><table>
      <thead><tr><th>Código</th><th>Produto</th><th>Categoria do Odoo</th><th>Sugerida</th><th>Categoria</th><th>CA</th><th class="num">Troca a cada (dias)</th></tr></thead>
      <tbody>${L.map(r => `<tr${r.ativo === false ? ' class="meta"' : ""}><td><strong>${esc(r.codigo)}</strong></td><td>${esc(r.nome)}${r.ativo === false ? " (inativo)" : ""}</td><td>${esc(r.categoria_odoo || "—")}</td>
        <td>${r.categoria_sugerida ? `<span class="tag ${r.categoria_sugerida === "epi" ? "azul" : "cinza"}">${esc(EPI_CAT_LBL[r.categoria_sugerida])}</span>` : '<span class="meta">—</span>'}</td>
        <td>${marca ? `<select data-epi-cat="${esc(r.id)}"><option value=""${!r.categoria_atual || !EPI_CAT_LBL[r.categoria_atual] ? " selected" : ""}>${r.categoria_atual && !EPI_CAT_LBL[r.categoria_atual] ? esc(r.categoria_atual) : "—"}</option><option value="epi"${r.categoria_atual === "epi" ? " selected" : ""}>EPI</option><option value="uniforme"${r.categoria_atual === "uniforme" ? " selected" : ""}>Uniforme</option></select>${r.confere ? "" : ' <span class="tag ambar" title="diferente da sugestão">≠</span>'}`
              : esc(EPI_CAT_LBL[r.categoria_atual] || r.categoria_atual || "—")}</td>
        <td>${editaProd ? `<input data-epi-ca="${esc(r.id)}" value="${esc(r.ca || "")}" placeholder="nº do CA" style="width:90px;" />` : esc(r.ca || "—")}</td>
        <td class="num">${editaProd ? `<input type="number" min="1" max="3650" step="1" data-epi-val="${esc(r.id)}" value="${esc(r.epi_validade_dias ?? "")}" style="width:72px;text-align:right;" />` : (r.epi_validade_dias ?? "—")}</td></tr>`).join("")}</tbody></table></div>`}`;
  }
}
async function epiRelClique(e, alvoId){
  const bv = e.target.closest("[data-epi-visao]");
  if(bv){ _epiRel.visao = bv.dataset.epiVisao; _epiRel.dados = null; epiRelCarregar(alvoId); return; }
  if(e.target.closest("[data-epi-xlsx]")){ epiRelExportar(); return; }
  const tr = e.target.closest("[data-epi-func]");
  if(tr && tr.dataset.epiFunc){ epiAbrirFichaFuncionario(tr.dataset.epiFunc); return; }
  const inf = e.target.closest("[data-epi-informar]");
  if(inf){ comBotaoTravado(inf, () => epiInformarRetirante(Number(inf.dataset.epiInformar), alvoId)); return; }
  const ap = e.target.closest("[data-epi-aplicar]");
  if(ap){ comBotaoTravado(ap, () => epiAplicarSugestoes(alvoId)); }
}
function epiRelExportar(){
  const linhas = _epiRel.linhasExport || [];
  if(!linhas.length){ aviso("app-aviso", "Nada para exportar nesta visão.", "aviso"); return; }
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "Biblioteca de planilha não carregada.", "erro"); return; }
  const rot = (EPI_VISOES.find(x => x[0] === _epiRel.visao) || [, "EPI"])[1];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), rot.slice(0, 31));
  XLSX.writeFile(wb, `epi-${_epiRel.visao}-${_epiRel.de}-a-${_epiRel.ate}.xlsx`);
}
async function epiInformarRetirante(i, alvoId){
  const r = epiRelFiltrar(_epiRel.dados || [])[i]; const cont = $(alvoId);
  const nome = (cont?.querySelector(`[data-epi-quem="${i}"]`)?.value || "").trim();
  if(!r || !nome){ aviso("app-aviso", "Escolha o colaborador na lista.", "erro"); return; }
  const fs = typeof balCarregarFuncionarios === "function" ? await balCarregarFuncionarios() : [];
  const achados = fs.filter(f => epiNorm(f.nome) === epiNorm(nome));
  if(achados.length !== 1){ aviso("app-aviso", achados.length ? "Há mais de um funcionário com esse nome." : "Funcionário ativo não encontrado com esse nome.", "erro"); return; }
  const { error } = await sb.rpc("epi_informar_retirante", { p_id: r.id, p_funcionario_id: achados[0].id });
  if(error){ aviso("app-aviso", "Não foi possível: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", `Saída ligada a ${achados[0].nome}: entra na ficha de EPI dele (assinatura pendente).`, "ok");
  _epiRel.dados = null; await epiRelCarregar(alvoId);
}
async function epiAplicarSugestoes(alvoId){
  if(!confirm("Marcar como EPI ou Uniforme, pela sugestão do nome, todos os produtos da lista que ainda não têm categoria? Quem já tem categoria escolhida não muda.")) return;
  const { data, error } = await sb.rpc("epi_aplicar_sugestoes");
  if(error){ aviso("app-aviso", "Não foi possível aplicar: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", `${data || 0} produto(s) marcado(s). Confira os que ficaram diferentes da sugestão.`, "ok");
  _epiRel.dados = null; await epiRelCarregar(alvoId);
}
async function epiConfMarcar(sel, alvoId){
  const { error } = await sb.rpc("epi_marcar_produtos", { p_ids: [sel.dataset.epiCat], p_categoria: sel.value });
  if(error){ aviso("app-aviso", "Não foi possível marcar: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  const r = (_epiRel.dados || []).find(x => x.id === sel.dataset.epiCat);
  if(r){ r.categoria_atual = sel.value || null; r.confere = (r.categoria_atual || "") === (r.categoria_sugerida || ""); }
  epiRelDesenhar(alvoId);
}
async function epiConfSalvarProduto(inp){
  const id = inp.dataset.epiCa || inp.dataset.epiVal;
  const reg = inp.dataset.epiCa ? { ca: inp.value.trim() || null } : { epi_validade_dias: inp.value === "" ? null : Math.round(Number(inp.value)) };
  if(reg.epi_validade_dias != null && !(reg.epi_validade_dias >= 1 && reg.epi_validade_dias <= 3650)){ aviso("app-aviso", "Troca entre 1 e 3650 dias.", "erro"); return; }
  const { error } = await sb.from("produtos").update(reg).eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível salvar: " + error.message, "erro"); return; }
  const r = (_epiRel.dados || []).find(x => x.id === id); if(r) Object.assign(r, reg);
}
/* abre a ficha do funcionário na aba EPI (de Estoque, do relatório ou da Sala de Comando) */
async function epiAbrirFichaFuncionario(funcionarioId){
  if(!funcionarioId || typeof abrirFuncionario !== "function") return;
  if(typeof irParaSecao === "function" && !irParaSecao("funcionarios")) return;
  await abrirFuncionario(funcionarioId);
  if(typeof ativarTabFunc === "function"){ ativarTabFunc("epi"); epiCarregarFicha(); }
}
/* "Para regularizar" e card da Sala de Comando: abre o relatório na visão pedida. O RH não tem Estoque no menu:
   vai para Funcionários › visão EPI. */
function epiAbrirRelatorio(visao){
  if(visao) { _epiRel.visao = visao; _epiRel.dados = null; }
  const semEstoque = typeof SECOES_OCULTAS_POR_CARGO === "object" && (SECOES_OCULTAS_POR_CARGO[usuarioAtual?.cargo] || []).includes("estoque");
  if(!semEstoque && typeof irParaSecao === "function" && irParaSecao("estoque")){
    if(typeof carregarEstoque === "function") carregarEstoque(false);
    const card = $("epi-card"); if(card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if(typeof irParaSecao === "function" && irParaSecao("funcionarios")){
    if(typeof _funcView !== "undefined") _funcView = "epi";
    document.querySelectorAll("#func-painel .serv-view-btn").forEach(b => b.classList.toggle("ativo", b.dataset.view === "epi"));
    if(typeof mostrarPainelFunc === "function") mostrarPainelFunc();
    if(typeof renderFuncionarios === "function") renderFuncionarios();
  }
}
/* card do Estoque e botão da visão EPI de Funcionários: só para quem vê */
function epiAplicarVisibilidade(){
  const pode = podeVerEpi();
  const card = $("epi-card"); if(card) card.style.display = pode ? "" : "none";
  document.querySelectorAll('#func-painel .serv-view-btn[data-view="epi"]').forEach(b => { b.style.display = pode ? "" : "none"; });
  epiAplicarVisibilidadeFicha();
}

function ligarEpi(){
  document.querySelector('#func-notebook button[data-tab="epi"]')?.addEventListener("click", () => {
    const av = $("func-epi-aviso"); if(av){ av.textContent = ""; av.className = "aviso"; }
    epiCarregarFicha();
  });
  $("func-epi-conteudo")?.addEventListener("click", epiFichaClique);
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarEpi);
} else {
  ligarEpi();
}

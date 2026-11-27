

















const EPI_CAT_LBL = { epi: "EPI", uniforme: "Uniforme" };
const EPI_VISOES = [
  ["pessoa", "Por colaborador"], ["obra", "Por obra"], ["item", "Por item"], ["consumo", "Consumo"],
  ["vencidas", "Trocas vencidas"], ["sem_pessoa", "Sem pessoa"], ["conferencia", "Conferência de categorias"]
];
const EPI_MES_LBL = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function podeVerEpi(){ return !!usuarioAtual && (["diretor", "admin", "almoxarife", "sesmt", "rh", "auditor"].includes(usuarioAtual.cargo) || temModuloExtra("sesmt")); }

function epiPodeOperar(){
  if(!usuarioAtual || (typeof ehSomenteLeitura === "function" && ehSomenteLeitura())) return false;
  return (typeof estPodeEditar === "function" && estPodeEditar()) || usuarioAtual.cargo === "sesmt" || temModuloExtra("sesmt");
}

function epiPodeMarcar(){ return !!usuarioAtual && (["diretor", "admin", "almoxarife", "sesmt"].includes(usuarioAtual.cargo) || sstPodeOperar()); }

function epiPodeEditarProduto(){ return !!usuarioAtual && !ehSomenteLeitura() && (["diretor", "admin", "almoxarife", "comprador", "gestor_acessorios", "gestor_manutencao", "sesmt"].includes(usuarioAtual.cargo) || temModuloExtra("produtos_sesmt")); }
function epiViewAusente(error){ return !!error && ["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code); }
const EPI_MSG_MIGRATION = "O controle de EPI por colaborador entra quando a migration da fase 100 for aplicada no banco.";
function epiNorm(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function epiMesChave(iso){ return String(iso || "").slice(0, 7); }
function epiMesRotulo(chave){ const [a, m] = chave.split("-"); return `${esc(EPI_MES_LBL[Number(m) - 1])}/${esc(a.slice(2))}`; }
function epiMesesEntre(de, ate){
  const r = []; let [a, m] = de.split("-").map(Number); const [a2, m2] = ate.split("-").map(Number);
  while((a < a2 || (a === a2 && m <= m2)) && r.length < 36){ r.push(`${a}-${String(m).padStart(2, "0")}`); m++; if(m > 12){ m = 1; a++; } }
  return r;
}
function epiFimDoMes(chave){ const [a, m] = chave.split("-").map(Number); return dataLocalISO(new Date(a, m, 0, 12)); }
function epiDestino(r){ return r.obra_codigo ? `Obra ${r.obra_codigo}` : r.equipamento_codigo ? `TAG ${r.equipamento_codigo}` : (r.centro_nome || "—"); }




let _epiAss = null;
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
        <button type="button" class="btn" id="btn-epi-ass-salvar">Assinar e salvar</button>
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


function epiLimparCanvas(){
  const cv = $("epi-ass-canvas"); if(!cv) return;
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tokens = getComputedStyle(document.documentElement);
  ctx.fillStyle = tokens.getPropertyValue("--doc-papel").trim() || "white";
  ctx.fillRect(0, 0, r.width, r.height);
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = tokens.getPropertyValue("--doc-tinta").trim() || "black";
  if(_epiAss) _epiAss.riscos = 0;
}

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

  const blob = new Blob([png], { type: "image/png" });
  const path = `${_epiAss.funcionarioId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const up = await sb.storage.from("epi-assinaturas").upload(path, blob, { contentType: "image/png", upsert: false });
  if(up.error){ aviso("epi-ass-aviso", "A assinatura não subiu: " + up.error.message, "erro"); return; }
  const { error } = await sb.rpc("epi_assinar", { p_ids: _epiAss.ids, p_path: path });
  if(error){ aviso("epi-ass-aviso", "A assinatura não foi registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("app-aviso", "Assinatura registrada na ficha de EPI.", "ok");
  epiFecharAssinatura(true);
}

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


function epiPendenteAssinatura(r){ return !!r && r.categoria === "epi" && !r.assinatura_em && !r.epi_devolvido_em; }
function epiFiltrarPendentes(L){ return (L || []).filter(epiPendenteAssinatura); }
function renderEpiFicha(){
  const cont = $("func-epi-conteudo"); if(!cont) return;
  const L = _epiFicha.linhas, opera = epiPodeOperar();
  const ano = dataLocalISO(new Date(Date.now() - 365 * 864e5));
  const vencidas = L.filter(r => r.troca_vencida).length;
  const pend = epiFiltrarPendentes(L);
  const chip = (n, rot, cor) => `<div class="chip"><span>${esc(rot)}</span><strong>${cor ? `<span class="tag ${esc(cor)}">${esc(n)}</span>` : esc(n)}</strong></div>`;
  cont.innerHTML = `<div class="odoo-contexto" style="margin:0 0 10px;">
      ${chip(L.length, "Entregas")}
      ${chip(brl(L.filter(r => r.data_entrega >= ano).reduce((s, r) => s + Number(r.valor || 0), 0)), "Gasto em 12 meses")}
      ${chip(vencidas, "Trocas vencidas", vencidas ? "vermelho" : "")}
      ${chip(pend.length, "Sem assinatura", pend.length ? "ambar" : "")}
    </div>
    <div class="form-acoes compacta" style="margin:0 0 10px;">
      <button type="button" class="btn-sec" id="btn-epi-pdf" ${L.length ? "" : "disabled"}>Ficha de EPI (PDF)</button>
      <button type="button" class="btn-sec" id="btn-epi-pdf-pend" title="Ficha de EPI só com as entregas ainda sem assinatura">Pendentes de assinatura (PDF)</button>
      ${opera && pend.length ? `<button type="button" class="btn" id="btn-epi-assinar-pend">Colher assinatura (${pend.length} pendente${pend.length > 1 ? "s" : ""})</button>` : ""}
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
        <td>${r.assinatura_em ? `<button type="button" class="link-mini" data-epi-ver-ass="${i}" title="ver a assinatura">${dataBR(String(r.assinatura_em).slice(0, 10))}</button>`
              : r.epi_devolvido_em ? '<span class="meta">—</span>' : '<span class="tag ambar">pendente</span>'}</td>
        <td>${r.troca_prevista ? dataBR(r.troca_prevista) : '<span class="meta">—</span>'}
            ${r.troca_vencida ? ' <span class="tag vermelho">vencida</span>' : r.substituida ? ' <span class="tag cinza">trocado</span>' : ""}</td>
        <td>${r.epi_devolvido_em ? `${dataBR(r.epi_devolvido_em)}${r.epi_devolucao_obs ? ` <span class="meta">${esc(r.epi_devolucao_obs)}</span>` : ""}`
              : opera ? `<button type="button" class="btn-sec btn-sm" data-epi-devolver="${i}">Devolver</button>` : '<span class="meta">—</span>'}</td>
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
  if(b.id === "btn-epi-pdf-pend") comBotaoTravado(b, () => epiGerarFichaPdf(_epiFicha.funcionarioId, { soPendentes: true, avisoId: "func-epi-aviso" }));
  if(b.id === "btn-epi-assinar-pend"){
    const pend = epiFiltrarPendentes(_epiFicha.linhas);
    epiAbrirAssinatura({ funcionarioId: _epiFicha.funcionarioId, funcionarioNome: $("func-nome")?.value || pend[0]?.funcionario_nome,
      itens: pend.map(r => ({ id: r.id, descricao: `${dataBR(r.data_entrega)} · ${num(r.quantidade)} ${r.unidade || ""} · ${r.produto_nome}${r.ca ? " (CA " + r.ca + ")" : ""}` })),
      aoConcluir: assinou => { if(assinou) epiCarregarFicha(); } });
  }
}
async function epiDevolver(r){
  if(!r || !epiPodeOperar()) return;
  const v = await uiPedirValores({ titulo: "Registrar devolução", texto: `Devolução de ${r.produto_nome}.`, confirmar: "Registrar devolução",
    campos: [{ id: "data", rotulo: "Data da devolução", tipo: "date", valor: hojeISO(), obrigatorio: true },
             { id: "obs", rotulo: "Observação (opcional)", tipo: "textarea", linhas: 2, placeholder: "Ex.: desgaste, troca, demissão" }] });
  if(!v) return;
  const data = String(v.data || "");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.trim())){ aviso("func-epi-aviso", "Data inválida: use AAAA-MM-DD.", "erro"); return; }
  const obs = String(v.obs || "");
  const { error } = await sb.rpc("epi_registrar_devolucao", { p_id: r.id, p_data: data.trim(), p_obs: obs.trim() || null });
  if(error){ aviso("func-epi-aviso", "Devolução não registrada: " + error.message.replace(/^.*?: /, ""), "erro"); return; }
  aviso("func-epi-aviso", "Devolução registrada.", "ok");
  await epiCarregarFicha();
}



async function epiGerarFichaPdf(funcionarioId, { soPendentes = false, avisoId = "func-epi-aviso" } = {}){
  if(!funcionarioId) return;

  const avisar = (msg, tipo) => { if(avisoId && $(avisoId)) aviso(avisoId, msg, tipo); else if(typeof uiAvisar === "function") uiAvisar(msg, tipo === "erro" ? "perigo" : tipo); };
  const [{ data: f }, { data: todas, error }] = await Promise.all([
    sb.from("funcionarios").select("nome,funcao,matricula,data_admissao,departamento_id").eq("id", funcionarioId).single(),
    sb.from("vw_epi_saidas").select("*").eq("funcionario_id", funcionarioId).order("data_movimentacao", { ascending: true }).limit(2000)
  ]);
  if(error){ avisar(epiViewAusente(error) ? EPI_MSG_MIGRATION : "Não foi possível gerar a ficha: " + error.message, "erro"); return; }
  const linhas = soPendentes ? epiFiltrarPendentes(todas) : (todas || []);
  if(soPendentes && !linhas.length){ avisar("Nenhuma entrega de EPI pendente de assinatura" + (f?.nome ? " para " + f.nome : "") + ".", "aviso"); return; }
  const imgs = await Promise.all((linhas || []).map(r => epiDataUrlAssinatura(r.assinatura_path)));
  const cel = "border:1px solid;padding:1.2mm 1.6mm;font-size:8.5pt;vertical-align:middle;";
  const dep = (typeof deptNome === "function" && f?.departamento_id) ? deptNome(f.departamento_id) : "—";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;">
    ${pdfCabecalhoHTML(soPendentes ? "Ficha de EPI: entregas pendentes de assinatura" : "Ficha de controle de entrega de EPI", "NR-6 · CGL Fundações Ltda")}
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
      <thead><tr>${["Data", "Qtd", "Item", "CA", "Troca prevista", "Devolução", "Assinatura"].map(t => `<th style="${cel}font-weight:700;text-align:left;">${esc(t)}</th>`).join("")}</tr></thead>
      <tbody>${(linhas || []).map((r, i) => `<tr>
        <td style="${cel}white-space:nowrap;">${dataBR(r.data_entrega)}</td>
        <td style="${cel}text-align:right;">${num(r.quantidade)} ${esc(r.unidade || "")}</td>
        <td style="${cel}">${esc(r.produto_nome || "")}</td>
        <td style="${cel}">${esc(r.ca || "—")}</td>
        <td style="${cel}white-space:nowrap;">${r.troca_prevista ? dataBR(r.troca_prevista) : "—"}</td>
        <td style="${cel}white-space:nowrap;">${r.epi_devolvido_em ? dataBR(r.epi_devolvido_em) : ""}</td>
        <td style="${cel}width:38mm;height:11mm;">${imgs[i] ? `<img src="${esc(imgs[i])}" alt="" style="display:block;max-height:10mm;max-width:36mm;">` : ""}</td>
      </tr>`).join("")}</tbody></table>
    <p style="font-size:7.5pt;margin:2mm 0 0;">Gerado pelo Controle CGL em ${dataBR(hojeISO())}. Assinaturas colhidas na tela no momento da entrega; as em branco estão pendentes.</p>
  </div>`;
  const el = document.createElement("div"); el.innerHTML = html;
  const nome = String(f?.nome || "colaborador").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  await pdfGerar(el, { filename: `ficha-epi-${nome}${soPendentes ? "-pendentes" : ""}-${hojeISO()}.pdf` });
}




const _epiRel = { visao: "pessoa", de: null, ate: null, busca: "", dados: null, chave: null, extra: {}, linhasExport: [] };
function epiRelPeriodoPadrao(){
  if(_epiRel.de) return;
  const hoje = hojeISO(), d = new Date(hoje + "T12:00:00"); d.setMonth(d.getMonth() - 5);
  _epiRel.ate = epiMesChave(hoje); _epiRel.de = epiMesChave(dataLocalISO(d));
}

function epiRenderRelatorio(alvoId){
  const cont = $(alvoId); if(!cont) return;
  if(!podeVerEpi()){ cont.innerHTML = `<p class="vazio">Só almoxarifado, SESMT, RH e diretoria veem o relatório de EPI.</p>`; return; }
  epiRelPeriodoPadrao();
  cont.innerHTML = `<div class="epi-rel">
      <div class="lista-topo compacta">
        <div class="serv-views">${EPI_VISOES.map(([v, l]) => `<button type="button" class="serv-view-btn${v === _epiRel.visao ? " ativo" : ""}" data-epi-visao="${esc(v)}">${esc(l)}</button>`).join("")}</div>
        <button type="button" class="btn-sec btn-sm" data-epi-xlsx="1" style="margin-left:auto;">Exportar .xlsx</button>
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
      if(e.target.closest(".epi-cns")){ epiCnsMudou(e, alvoId); return; }
      if(e.target.matches("[data-epi-de]")){ _epiRel.de = e.target.value || _epiRel.de; _epiRel.dados = null; epiRelCarregar(alvoId); }
      if(e.target.matches("[data-epi-ate]")){ _epiRel.ate = e.target.value || _epiRel.ate; _epiRel.dados = null; epiRelCarregar(alvoId); }
      if(e.target.matches("[data-epi-cat]")) epiConfMarcar(e.target, alvoId);
      if(e.target.matches("[data-epi-ca], [data-epi-val]")) epiConfSalvarProduto(e.target);
    });
    cont.addEventListener("input", debounce(e => { if(e.target.closest(".epi-cns") && e.target.matches('[data-filtro="busca"]')){ _epiCns.busca = e.target.value; epiCnsDesenhar(alvoId, true); return; }
      if(e.target.matches("[data-epi-busca]")){ _epiRel.busca = e.target.value; epiRelDesenhar(alvoId); } }, 200));
  }
  epiRelCarregar(alvoId);
}
async function epiRelCarregar(alvoId){
  const cont = $(alvoId); const corpo = cont?.querySelector(".epi-rel-corpo"); if(!corpo) return;

  const filtrosAntigos = cont.querySelector(".epi-rel > .serv-filtros"); if(filtrosAntigos) filtrosAntigos.hidden = _epiRel.visao === "consumo";
  if(_epiRel.visao === "consumo"){
    cont.querySelectorAll("[data-epi-visao]").forEach(b => b.classList.toggle("ativo", b.dataset.epiVisao === "consumo"));
    epiCnsCarregar(alvoId); return;
  }
  if(_epiRel.de > _epiRel.ate){ corpo.innerHTML = `<p class="vazio">O início do período é depois do fim.</p>`; return; }
  corpo.innerHTML = `<p class="vazio">Carregando…</p>`;
  const v = _epiRel.visao;
  const de = _epiRel.de + "-01", ate = epiFimDoMes(_epiRel.ate);
  let montar;
  if(v === "vencidas") montar = () => sb.from("vw_epi_saidas").select("*").eq("troca_vencida", true).eq("funcionario_ativo", true).order("troca_prevista");
  else if(v === "conferencia") montar = () => sb.from("vw_epi_conferencia").select("*").order("categoria_sugerida", { nullsFirst: false }).order("nome");
  else montar = () => {
    const q = sb.from("vw_epi_saidas").select("*").gte("data_entrega", de).lte("data_entrega", ate).order("data_entrega");
    return v === "sem_pessoa" ? q.is("funcionario_id", null).eq("categoria", "epi") : q;
  };
  const { data, error } = await lerTudo(montar);
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
    corpo.innerHTML = `<p class="meta" style="margin:0 0 6px;" data-val-sens><strong>${brl(totalGeral)}</strong> em ${lista.length} ${v === "pessoa" ? "colaborador(es)" : "destino(s)"} no período${semPessoa ? ` · ${brl(semPessoa)} em saídas sem pessoa (veja "Sem pessoa")` : ""}${v === "pessoa" ? " · clique no nome para abrir a ficha de EPI" : ""}</p>
      <div class="tabela-rola"><table>
        <thead><tr><th>${v === "pessoa" ? "Colaborador" : "Obra / destino"}</th>${v === "pessoa" ? "<th>Função</th>" : ""}${meses.map(m => `<th class="num">${epiMesRotulo(m)}</th>`).join("")}<th class="num">Total</th>${v === "pessoa" ? '<th class="num" title="Total médio por pessoa da mesma função no período">Média da função</th><th class="num">vs média</th><th>Ficha</th>' : ""}</tr></thead>
        <tbody>${lista.map(g => { const med = mediaFuncao[g.funcao] || 0, dif = med ? (g.total / med - 1) * 100 : 0;
          return `<tr${v === "pessoa" ? ` class="linha-clicavel" data-epi-func="${esc(g.id)}"` : ""}>
            <td><strong>${esc(g.nome || "—")}</strong></td>${v === "pessoa" ? `<td>${esc(g.funcao || "—")}</td>` : ""}
            ${meses.map(m => `<td class="num">${g.porMes[m] ? brl(g.porMes[m]) : '<span class="meta">—</span>'}</td>`).join("")}
            <td class="num"><strong>${brl(g.total)}</strong></td>
            ${v === "pessoa" ? `<td class="num">${brl(med)}</td><td class="num">${med && Math.abs(dif) >= 1 ? `<span class="tag ${dif > 25 ? "vermelho" : dif > 0 ? "ambar" : "verde"}">${dif > 0 ? "+" : ""}${Math.round(dif)}%</span>` : '<span class="meta">—</span>'}</td>
              <td><button type="button" class="btn-sec btn-sm" data-epi-pdf-pend="${esc(g.id)}" title="Ficha de EPI em PDF só com as entregas pendentes de assinatura">Pendentes (PDF)</button></td>` : ""}
          </tr>`; }).join("")}</tbody>
        <tfoot><tr><td${v === "pessoa" ? ' colspan="2"' : ""}><strong>Total</strong></td>${meses.map(m => `<td class="num"><strong>${brl(totMes[m] || 0)}</strong></td>`).join("")}<td class="num"><strong>${brl(totalGeral)}</strong></td>${v === "pessoa" ? "<td></td><td></td><td></td>" : ""}</tr></tfoot>
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
        ${opera ? `<td style="white-space:nowrap;"><input list="epi-func-dl" data-epi-quem="${i}" placeholder="nome do colaborador" style="width:200px;" /> <button type="button" class="btn-sec btn-sm" data-epi-informar="${i}">Informar</button></td>` : ""}</tr>`).join("")}</tbody></table></div>
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
      ${marca && aplicaveis.length ? `<div class="form-acoes compacta" style="margin:0 0 8px;"><button type="button" class="btn" data-epi-aplicar="1">Aplicar sugestões (${aplicaveis.length} sem categoria)</button> <span class="meta">não mexe no que já tem categoria escolhida</span></div>` : ""}
      ${!L.length ? `<p class="vazio">Nenhum produto nas categorias de EPI.</p>` : `<div class="tabela-rola"><table>
      <thead><tr><th>Código</th><th>Produto</th><th>Categoria do Odoo</th><th>Sugerida</th><th>Categoria</th><th>CA</th><th class="num">Troca a cada (dias)</th></tr></thead>
      <tbody>${L.map(r => `<tr${r.ativo === false ? ' class="meta"' : ""}><td><strong>${esc(r.codigo)}</strong></td><td>${esc(r.nome)}${r.ativo === false ? " (inativo)" : ""}</td><td>${esc(r.categoria_odoo || "—")}</td>
        <td>${r.categoria_sugerida ? `<span class="tag ${r.categoria_sugerida === "epi" ? "azul" : "cinza"}">${esc(EPI_CAT_LBL[r.categoria_sugerida])}</span>` : '<span class="meta">—</span>'}</td>
        <td>${marca ? `<select data-epi-cat="${esc(r.id)}"><option value=""${!r.categoria_atual || !EPI_CAT_LBL[r.categoria_atual] ? " selected" : ""}>${r.categoria_atual && !EPI_CAT_LBL[r.categoria_atual] ? esc(r.categoria_atual) : "—"}</option><option value="epi"${r.categoria_atual === "epi" ? " selected" : ""}>EPI</option><option value="uniforme"${r.categoria_atual === "uniforme" ? " selected" : ""}>Uniforme</option></select>${r.confere ? "" : ' <span class="tag ambar" title="diferente da sugestão">≠</span>'}`
              : esc(EPI_CAT_LBL[r.categoria_atual] || r.categoria_atual || "—")}</td>
        <td>${editaProd ? `<input data-epi-ca="${esc(r.id)}" value="${esc(r.ca || "")}" placeholder="nº do CA" style="width:90px;" />` : esc(r.ca || "—")}</td>
        <td class="num">${editaProd ? `<input type="number" min="1" max="3650" step="1" data-epi-val="${esc(r.id)}" value="${esc(r.epi_validade_dias ?? "")}" style="width:72px;text-align:right;" />` : esc(r.epi_validade_dias ?? "—")}</td></tr>`).join("")}</tbody></table></div>`}`;
  }
}
async function epiRelClique(e, alvoId){
  const bv = e.target.closest("[data-epi-visao]");
  if(bv){ _epiRel.visao = bv.dataset.epiVisao; _epiRel.dados = null; epiRelCarregar(alvoId); return; }
  if(e.target.closest("[data-epi-xlsx]")){ epiRelExportar(); return; }
  if(e.target.closest(".epi-cns")){ epiCnsClique(e, alvoId); return; }

  const bp = e.target.closest("[data-epi-pdf-pend]");
  if(bp){ e.stopPropagation(); comBotaoTravado(bp, () => epiGerarFichaPdf(bp.dataset.epiPdfPend, { soPendentes: true, avisoId: null })); return; }
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
  const per = _epiRel.visao === "consumo" ? `${_epiCns.aba}-${_epiCns.de}-a-${_epiCns.ate}` : `${_epiRel.de}-a-${_epiRel.ate}`;
  XLSX.writeFile(wb, `epi-${_epiRel.visao}-${per}.xlsx`);
}





const EPI_CNS_FR = "ODOO-009588";
const EPI_CNS_ABAS = [["maquina", "Por máquina"], ["pessoa", "Por pessoa"], ["mes", "Por mês"]];
const EPI_CNS_COLS = "id,data_entrega,funcionario_id,funcionario_nome,funcao,produto_id,produto_codigo,produto_nome,categoria,quantidade,valor,maquina_id,maquina_codigo,obra_id,obra_codigo,centro_custo_id,centro_nome,situacao_alocacao";
const EPI_CNS_FILTROS = { produto: "Produto", maquina: "Máquina", obra: "Obra", funcao: "Função", soAlocados: "Só alocados" };
const _epiCns = { de: null, ate: null, produto: "", maquina: "", obra: "", funcao: "", soAlocados: false, aba: "maquina", grade: "brl",
  busca: "", dados: null, chave: null, saldoFR: null, maqAberta: null };

function epiCnsMesSoma(chave, n){ const [a, m] = chave.split("-").map(Number); const d = new Date(a, m - 1 + n, 1, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function epiCnsMesTxt(chave){ const [a, m] = chave.split("-"); return `${EPI_MES_LBL[Number(m) - 1]}/${a.slice(2)}`; }

function epiCnsGrupoMaq(r){
  if(r.maquina_id) return { id: "m:" + r.maquina_id, nome: r.maquina_codigo || "—", ordem: 0 };
  if(r.situacao_alocacao === "sede") return { id: "c:" + r.centro_custo_id, nome: "Sede · " + (r.centro_nome || "centro de custo"), ordem: 1 };
  if(r.situacao_alocacao === "sem_pessoa") return { id: "sem_pessoa", nome: "Sem pessoa", ordem: 3 };
  return { id: "sem_alocacao", nome: "Sem alocação", ordem: 2 };
}
async function epiCnsCarregar(alvoId){
  const corpo = $(alvoId)?.querySelector(".epi-rel-corpo"); if(!corpo) return;
  if(!_epiCns.de){ _epiCns.de = _epiCns.ate = epiMesChave(hojeISO()); }
  if(_epiCns.de > _epiCns.ate){ corpo.innerHTML = uiErro("O início do período é depois do fim."); return; }

  const n = epiMesesEntre(_epiCns.de, _epiCns.ate).length;
  const ini = [epiCnsMesSoma(_epiCns.de, -n), epiCnsMesSoma(_epiCns.ate, -5)].sort()[0] + "-01", fim = epiFimDoMes(_epiCns.ate);
  const chave = ini + "|" + fim;
  if(_epiCns.chave !== chave || !_epiCns.dados){
    corpo.innerHTML = uiCarregando("Carregando o consumo…");
    const [r, fr] = await Promise.all([
      lerTudo(() => sb.from("vw_epi_consumo").select(EPI_CNS_COLS).gte("data_entrega", ini).lte("data_entrega", fim), "id"),
      sb.from("produtos").select("id,estoque_atual,unidade").eq("codigo", EPI_CNS_FR).maybeSingle()
    ]);
    if(_epiRel.visao !== "consumo") return;
    if(r.error){
      _epiCns.dados = null;
      corpo.innerHTML = epiViewAusente(r.error) ? uiVazio("O painel de consumo entra quando a migration da fase 199a for aplicada no banco.") : uiErro("Não foi possível carregar o consumo: " + r.error.message);
      return;
    }
    _epiCns.dados = r.data || []; _epiCns.chave = chave; _epiCns.saldoFR = fr.error ? null : fr.data;
  }
  epiCnsDesenhar(alvoId);
}
function epiCnsFiltrar(L, de, ate){
  const t = epiNorm(_epiCns.busca.trim()), p = _epiCns.produto;
  return L.filter(r => {
    const m = epiMesChave(r.data_entrega);
    if(m < de || m > ate) return false;
    if(p.startsWith("cat:") && r.categoria !== p.slice(4)) return false;
    if(p.startsWith("p:") && r.produto_id !== p.slice(2)) return false;
    if(_epiCns.maquina && epiCnsGrupoMaq(r).id !== _epiCns.maquina) return false;
    if(_epiCns.obra && r.obra_id !== _epiCns.obra) return false;
    if(_epiCns.funcao && (r.funcao || "") !== _epiCns.funcao) return false;
    if(_epiCns.soAlocados && r.situacao_alocacao !== "alocado") return false;
    return !t || epiNorm([r.funcionario_nome, r.funcao, r.produto_nome, r.produto_codigo, r.maquina_codigo, r.obra_codigo, r.centro_nome].filter(Boolean).join(" ")).includes(t);
  });
}
function epiCnsResumo(X){
  const comPessoa = X.filter(r => r.funcionario_id), pessoas = new Set(comPessoa.map(r => r.funcionario_id)).size;
  const soma = (Y, k) => Y.reduce((s, r) => s + Number(r[k] || 0), 0);
  return { n: X.length, valor: soma(X, "valor"), pecas: soma(X, "quantidade"), pessoas,
    medio: pessoas ? soma(comPessoa, "valor") / pessoas : 0, cobertura: X.length ? X.filter(r => r.maquina_id).length / X.length : null };
}

function epiCnsOpcoes(D, chave, rotulo){
  const m = new Map(); D.forEach(r => { const k = chave(r); if(k && !m.has(k)) m.set(k, rotulo(r)); });
  return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR", { numeric: true }));
}
function epiCnsTopo(){
  const D = _epiCns.dados || [];
  const fr = D.find(r => r.produto_codigo === EPI_CNS_FR);
  const prods = [["cat:epi", "Grupo: EPI"], ["cat:uniforme", "Grupo: Uniforme"]].concat(fr ? [["p:" + fr.produto_id, "Macacão FR"]] : [],
    epiCnsOpcoes(D, r => r.produto_codigo === EPI_CNS_FR ? null : "p:" + r.produto_id, r => r.produto_nome || r.produto_codigo));
  const maqs = epiCnsOpcoes(D, r => epiCnsGrupoMaq(r).id, r => epiCnsGrupoMaq(r).nome);
  const obras = epiCnsOpcoes(D, r => r.obra_id, r => r.obra_codigo);
  const funcoes = epiCnsOpcoes(D, r => r.funcao, r => r.funcao);
  const rot = (k, ops) => (ops.find(o => o[0] === _epiCns[k]) || [, _epiCns[k]])[1];
  const ativos = [
    { id: "produto", rotulo: EPI_CNS_FILTROS.produto, valor: _epiCns.produto ? rot("produto", prods) : "" },
    { id: "maquina", rotulo: EPI_CNS_FILTROS.maquina, valor: _epiCns.maquina ? rot("maquina", maqs) : "" },
    { id: "obra", rotulo: EPI_CNS_FILTROS.obra, valor: _epiCns.obra ? rot("obra", obras) : "" },
    { id: "funcao", rotulo: EPI_CNS_FILTROS.funcao, valor: _epiCns.funcao },
    { id: "soAlocados", rotulo: EPI_CNS_FILTROS.soAlocados, valor: _epiCns.soAlocados ? "sim" : "" }
  ];
  return `<div class="epi-cns-campos">
      ${uiCampo({ id: "epi-cns-de", rotulo: "De", tipo: "month", valor: _epiCns.de })}
      ${uiCampo({ id: "epi-cns-ate", rotulo: "Até", tipo: "month", valor: _epiCns.ate })}
      ${uiCampo({ id: "epi-cns-produto", rotulo: "Produto ou grupo", tipo: "select", opcoes: prods, valor: _epiCns.produto, placeholder: "Todos" })}
      ${uiCampo({ id: "epi-cns-maquina", rotulo: "Máquina", tipo: "select", opcoes: maqs, valor: _epiCns.maquina, placeholder: "Todas" })}
      ${uiCampo({ id: "epi-cns-obra", rotulo: "Obra", tipo: "select", opcoes: obras, valor: _epiCns.obra, placeholder: "Todas" })}
      ${uiCampo({ id: "epi-cns-funcao", rotulo: "Função", tipo: "select", opcoes: funcoes, valor: _epiCns.funcao, placeholder: "Todas" })}
      <label class="epi-cns-chk" title="Só as saídas de quem tinha alocação na data da entrega"><input type="checkbox" id="epi-cns-soaloc"${_epiCns.soAlocados ? " checked" : ""}> Só alocados</label>
      ${fr ? `<button type="button" class="ui-btn" data-cns-acao="fr" title="Filtra o macacão FR (#309)">Macacão FR</button>` : ""}
    </div>
    <div class="epi-cns-filtros">${uiFiltros({ id: "epi-cns-busca", busca: _epiCns.busca, placeholder: "Buscar pessoa, função, item, TAG ou obra", filtros: ativos, total: null })}</div>`;
}
function epiCnsDesenhar(alvoId, soResultados){
  const corpo = $(alvoId)?.querySelector(".epi-rel-corpo"); if(!corpo || !_epiCns.dados) return;
  if(!soResultados || !corpo.querySelector(".epi-cns-res")){
    corpo.innerHTML = `<div class="epi-cns" data-val-sens><div class="epi-cns-topo">${  epiCnsTopo()}</div><div class="epi-cns-res"></div></div>`;
  }
  corpo.querySelector(".epi-cns-res").innerHTML = epiCnsResultados();
}
function epiCnsResultados(){
  const D = _epiCns.dados, de = _epiCns.de, ate = _epiCns.ate;
  const meses = epiMesesEntre(de, ate), n = meses.length;
  const L = epiCnsFiltrar(D, de, ate), ant = epiCnsFiltrar(D, epiCnsMesSoma(de, -n), epiCnsMesSoma(de, -1));
  const a = epiCnsResumo(L), b = epiCnsResumo(ant);
  const delta = (x, y) => x != null && y ? (x - y) / y : null;
  const txtAnt = n === 1 ? "vs mês anterior" : `vs ${n} meses anteriores`;
  const cobBaixa = a.cobertura != null && a.cobertura < 0.8;
  let kCob = uiKpi(a.cobertura == null ? "—" : Math.round(a.cobertura * 100) + "%", "Saídas com máquina", cobBaixa ? "abaixo de 80%: falta Alocação" : "meta: 80% ou mais", { delta: delta(a.cobertura, b.cobertura), melhor: "maior", texto: txtAnt });
  if(cobBaixa) kCob = kCob.replace('class="ui-kpi"', 'class="ui-kpi epi-cns-alerta"');
  const kpis = `<div class="ui-kpis epi-cns-kpis">
      ${uiKpi(brl(a.valor), "Consumo no período", `${n} ${n === 1 ? "mês" : "meses"}, ${a.n} saída(s)`, { delta: delta(a.valor, b.valor), melhor: "menor", texto: txtAnt })}
      ${uiKpi(num(a.pecas), "Peças", null, { delta: delta(a.pecas, b.pecas), melhor: "menor", texto: txtAnt })}
      ${uiKpi(String(a.pessoas), "Pessoas atendidas", null, { delta: delta(a.pessoas, b.pessoas), texto: txtAnt })}
      ${uiKpi(brl(a.medio), "Custo médio por pessoa", null, { delta: delta(a.medio, b.medio), melhor: "menor", texto: txtAnt })}
      ${  kCob}
    </div>`;

  const semAloc = L.filter(r => r.situacao_alocacao === "sem_alocacao").length;
  const frasesFaixa = [semAloc ? `${semAloc} saída(s) sem alocação na data` : "Toda saída com pessoa tem alocação ou centro de custo na data"];
  const sfr = _epiCns.saldoFR, prodFR = !_epiCns.produto || _epiCns.produto === "cat:epi" || (sfr && _epiCns.produto === "p:" + sfr.id);
  if(sfr && Number(sfr.estoque_atual) < 0 && prodFR) frasesFaixa.push(`Macacão FR com saldo negativo (${num(sfr.estoque_atual)} ${sfr.unidade || "un"}): contagem física pendente`);
  const faixa = `<div class="epi-cns-faixa">${uiFaixaSituacao(frasesFaixa, semAloc || frasesFaixa.length > 1 ? "aviso" : "ok")}${semAloc ? `<button type="button" class="ui-btn" data-cns-acao="sem-aloc" title="Lista as pessoas sem alocação na data das saídas, para regularizar a Alocação">Ver quem está sem alocação</button>` : ""}</div>`;
  const abas = uiAbas(EPI_CNS_ABAS.map(([id, rotulo]) => ({ id, rotulo })), { ativa: _epiCns.aba, rotulo: "Visões do consumo" });
  let corpo = "";
  if(_epiCns.aba === "maquina") corpo = epiCnsPorMaquina(L, D);
  else if(_epiCns.aba === "pessoa") corpo = epiCnsPorPessoa(L, "Nenhuma saída com pessoa no período e nos filtros.");
  else corpo = epiCnsPorMes(D);
  return `${  faixa}${  kpis}${  abas}<p class="ui-filtros-cont epi-cns-cont" role="status">${esc(L.length.toLocaleString("pt-BR"))} saída(s) no período</p>${  corpo}`;
}

function epiCnsGrupos(L, D6){
  const g = new Map();
  const pega = r => { const x = epiCnsGrupoMaq(r); let o = g.get(x.id); if(!o){ o = { ...x, obras: new Set(), pessoas: new Set(), pecas: 0, valor: 0, porMes: {}, pecasMes: {} }; g.set(x.id, o); } return o; };
  L.forEach(r => { const o = pega(r); if(r.obra_codigo) o.obras.add(r.obra_codigo); if(r.funcionario_id) o.pessoas.add(r.funcionario_id); o.pecas += Number(r.quantidade || 0); o.valor += Number(r.valor || 0); });
  (D6 || []).forEach(r => { const o = g.get(epiCnsGrupoMaq(r).id); if(!o) return; const m = epiMesChave(r.data_entrega); o.porMes[m] = (o.porMes[m] || 0) + Number(r.valor || 0); o.pecasMes[m] = (o.pecasMes[m] || 0) + Number(r.quantidade || 0); });
  return [...g.values()].sort((x, y) => x.ordem - y.ordem || y.valor - x.valor || x.nome.localeCompare(y.nome, "pt-BR", { numeric: true }));
}
function epiCnsPorMaquina(L, D){
  const m6 = epiMesesEntre(epiCnsMesSoma(_epiCns.ate, -5), _epiCns.ate);
  const lista = epiCnsGrupos(L, epiCnsFiltrar(D, m6[0], _epiCns.ate));
  const linhas = lista.map(o => ({ id: o.id, nome: o.nome, obras: [...o.obras].sort().join(", "), pessoas: o.pessoas.size, pecas: o.pecas, valor: o.valor,
    porPessoa: o.pessoas.size ? o.valor / o.pessoas.size : null, evol: m6.map(m => o.porMes[m] || 0) }));
  _epiRel.linhasExport = linhas.map(l => Object.assign({ "Máquina / destino": l.nome, "Obras no período": l.obras, "Pessoas": l.pessoas, "Peças": l.pecas, "R$": Number(l.valor.toFixed(2)),
    "R$ por pessoa": l.porPessoa == null ? "" : Number(l.porPessoa.toFixed(2)) }, Object.fromEntries(m6.map((m, i) => [epiCnsMesTxt(m), Number(l.evol[i].toFixed(2))]))));
  const tot = epiCnsResumo(L);
  const tabela = uiTabela({
    colunas: [
      { chave: "nome", rotulo: "Máquina / destino", html: l => `<strong>${esc(l.nome)}</strong>${l.id === _epiCns.maqAberta ? ' <span class="meta">▾ pessoas abaixo</span>' : ""}` },
      { chave: "obras", rotulo: "Obras no período", html: l => l.obras ? esc(l.obras) : '<span class="meta">—</span>' },
      { chave: "pessoas", rotulo: "Pessoas", tipo: "int" },
      { chave: "pecas", rotulo: "Peças", tipo: "num" },
      { chave: "valor", rotulo: "R$", tipo: "brl" },
      { chave: "porPessoa", rotulo: "R$ por pessoa", tipo: "brl" },
      { chave: "evol", rotulo: `Evolução (${epiCnsMesTxt(m6[0])} a ${epiCnsMesTxt(m6[m6.length - 1])})`, html: l => `<div class="epi-cns-evol">${uiPulso(l.evol, null, { rotulos: m6.map(epiCnsMesTxt), vazio: "sem consumo" })}</div>` }
    ],
    linhas, chaveLinha: "id", vazio: "Nenhuma saída no período e nos filtros.",
    rodape: { nome: "Total", pessoas: tot.pessoas, pecas: tot.pecas, valor: tot.valor }
  });
  const aberta = _epiCns.maqAberta && linhas.find(l => l.id === _epiCns.maqAberta);
  const pessoas = aberta ? `<h4 class="epi-cns-sub">Pessoas em ${esc(aberta.nome)}</h4>${  epiCnsPorPessoa(L.filter(r => epiCnsGrupoMaq(r).id === aberta.id), "Nenhuma pessoa nesta linha.", true)}` : "";
  return `<p class="meta epi-cns-ajuda">Máquina e obra pela saída ou pela Alocação na data da entrega. Sem máquina, a saída vai para a sede (centro de custo) ou para "Sem alocação". Clique numa linha para ver as pessoas.</p>
    <div class="epi-cns-clicavel" data-cns-tabela="maquina">${  tabela}</div>${  pessoas}`;
}
function epiCnsPorPessoa(L, vazio, interna){
  const g = new Map();
  L.filter(r => r.funcionario_id).forEach(r => {
    let o = g.get(r.funcionario_id);
    if(!o){ o = { id: r.funcionario_id, nome: r.funcionario_nome || "—", funcao: r.funcao || "", pecas: 0, valor: 0, ult: null }; g.set(r.funcionario_id, o); }
    o.pecas += Number(r.quantidade || 0); o.valor += Number(r.valor || 0);
    if(!o.ult || r.data_entrega >= o.ult.data_entrega) o.ult = r;
  });
  const lista = [...g.values()];
  const agg = {}; lista.forEach(o => { const x = agg[o.funcao] || (agg[o.funcao] = { s: 0, n: 0 }); x.s += o.valor; x.n++; });
  const linhas = lista.map(o => { const med = agg[o.funcao].n ? agg[o.funcao].s / agg[o.funcao].n : 0;
    return { id: o.id, nome: o.nome, funcao: o.funcao, maquina: o.ult?.maquina_codigo || (o.ult?.situacao_alocacao === "sede" ? o.ult.centro_nome : ""), obra: o.ult?.obra_codigo || "",
      pecas: o.pecas, valor: o.valor, media: med, dif: med ? o.valor / med - 1 : null }; }).sort((x, y) => y.valor - x.valor);
  if(!interna) _epiRel.linhasExport = linhas.map(l => ({ "Pessoa": l.nome, "Função": l.funcao, "Máquina": l.maquina, "Obra": l.obra, "Peças": l.pecas, "R$": Number(l.valor.toFixed(2)),
    "Média da função": Number(l.media.toFixed(2)), "vs média": l.dif == null ? "" : Math.round(l.dif * 100) + "%" }));
  const tot = linhas.reduce((s, l) => ({ pecas: s.pecas + l.pecas, valor: s.valor + l.valor }), { pecas: 0, valor: 0 });
  const tabela = uiTabela({
    colunas: [
      { chave: "nome", rotulo: "Pessoa", html: l => `<strong>${esc(l.nome)}</strong>` },
      { chave: "funcao", rotulo: "Função" },
      { chave: "maquina", rotulo: "Máquina (última saída)" },
      { chave: "obra", rotulo: "Obra (última saída)" },
      { chave: "pecas", rotulo: "Peças", tipo: "num" },
      { chave: "valor", rotulo: "R$", tipo: "brl" },
      { chave: "media", rotulo: "Média da função", tipo: "brl" },
      { chave: "dif", rotulo: "vs média", html: l => l.dif == null || Math.abs(l.dif) < 0.01 ? '<span class="meta">—</span>' : `<span class="tag ${l.dif > 0.25 ? "vermelho" : l.dif > 0 ? "ambar" : "verde"}">${l.dif > 0 ? "+" : ""}${Math.round(l.dif * 100)}%</span>` }
    ],
    linhas, chaveLinha: "id", vazio, rodape: { nome: "Total", pecas: tot.pecas, valor: tot.valor }
  });
  return `<div class="epi-cns-clicavel" data-cns-tabela="pessoa" title="Clique para abrir a aba EPI da ficha">${  tabela}</div>`;
}
function epiCnsPorMes(D){
  const m6 = epiMesesEntre(epiCnsMesSoma(_epiCns.ate, -5), _epiCns.ate);
  const D6 = epiCnsFiltrar(D, m6[0], _epiCns.ate);
  const brlG = _epiCns.grade === "brl";
  const lista = epiCnsGrupos(D6, D6);
  const linhas = lista.map(o => Object.assign({ id: o.id, nome: o.nome, total: brlG ? o.valor : o.pecas }, Object.fromEntries(m6.map(m => ["m" + m, (brlG ? o.porMes : o.pecasMes)[m] || 0]))));
  _epiRel.linhasExport = linhas.map(l => Object.assign({ "Máquina / destino": l.nome }, Object.fromEntries(m6.map(m => [epiCnsMesTxt(m), Number(l["m" + m].toFixed(2))])), { [brlG ? "Total R$" : "Total peças"]: Number(l.total.toFixed(2)) }));
  const rod = { nome: "Total", total: linhas.reduce((s, l) => s + l.total, 0) };
  m6.forEach(m => { rod["m" + m] = linhas.reduce((s, l) => s + l["m" + m], 0); });
  const tipo = brlG ? "brl" : "num";
  const tabela = uiTabela({
    colunas: [{ chave: "nome", rotulo: "Máquina / destino", html: l => `<strong>${esc(l.nome)}</strong>` }].concat(m6.map(m => ({ chave: "m" + m, rotulo: epiCnsMesTxt(m), tipo })), [{ chave: "total", rotulo: "Total", tipo }]),
    linhas, vazio: "Nenhuma saída nos últimos 6 meses com estes filtros.", rodape: rod
  });
  return `<div class="epi-cns-grade-topo"><span class="meta">Últimos 6 meses até ${esc(epiCnsMesTxt(_epiCns.ate))}, com os filtros acima (o "De" não se aplica aqui).</span>
      <span class="epi-cns-grade-btns" role="group" aria-label="Unidade da grade"><button type="button" class="ui-btn${brlG ? " ui-btn-prim" : ""}" data-cns-grade="brl">R$</button><button type="button" class="ui-btn${brlG ? "" : " ui-btn-prim"}" data-cns-grade="pecas">Peças</button></span></div>
    ${  tabela}`;
}
function epiCnsMudou(e, alvoId){
  const id = e.target.id;
  if(id === "epi-cns-de" || id === "epi-cns-ate"){
    const v = e.target.value; if(!v) return;
    if(id === "epi-cns-de") _epiCns.de = v; else _epiCns.ate = v;
    _epiCns.maqAberta = null; epiCnsCarregar(alvoId); return;
  }
  const mapa = { "epi-cns-produto": "produto", "epi-cns-maquina": "maquina", "epi-cns-obra": "obra", "epi-cns-funcao": "funcao" };
  if(mapa[id]){ _epiCns[mapa[id]] = e.target.value; _epiCns.maqAberta = null; epiCnsDesenhar(alvoId); return; }
  if(id === "epi-cns-soaloc"){ _epiCns.soAlocados = e.target.checked; epiCnsDesenhar(alvoId); }
}
function epiCnsClique(e, alvoId){
  const rem = e.target.closest("[data-remover]");
  if(rem){ const k = rem.dataset.remover; (k === "*" ? Object.keys(EPI_CNS_FILTROS) : [k]).forEach(x => { _epiCns[x] = x === "soAlocados" ? false : ""; }); _epiCns.maqAberta = null; epiCnsDesenhar(alvoId); return; }
  const aba = e.target.closest("[data-aba]");
  if(aba){ _epiCns.aba = aba.dataset.aba; epiCnsDesenhar(alvoId, true); return; }
  const gr = e.target.closest("[data-cns-grade]");
  if(gr){ _epiCns.grade = gr.dataset.cnsGrade; epiCnsDesenhar(alvoId, true); return; }
  const ac = e.target.closest("[data-cns-acao]");
  if(ac){
    if(ac.dataset.cnsAcao === "sem-aloc"){ _epiCns.maquina = "sem_alocacao"; _epiCns.aba = "pessoa"; _epiCns.soAlocados = false; }
    if(ac.dataset.cnsAcao === "fr"){ const fr = (_epiCns.dados || []).find(r => r.produto_codigo === EPI_CNS_FR); if(fr) _epiCns.produto = "p:" + fr.produto_id; }
    _epiCns.maqAberta = null; epiCnsDesenhar(alvoId); return;
  }
  const tr = e.target.closest("tr[data-id]"), tab = e.target.closest("[data-cns-tabela]");
  if(!tr || !tab) return;
  if(tab.dataset.cnsTabela === "maquina"){ _epiCns.maqAberta = _epiCns.maqAberta === tr.dataset.id ? null : tr.dataset.id; epiCnsDesenhar(alvoId, true); return; }
  if(tab.dataset.cnsTabela === "pessoa") epiAbrirFichaFuncionario(tr.dataset.id);
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
  if(!await uiConfirmar({ titulo: "Aplicar sugestões", texto: "Marcar como EPI ou Uniforme, pela sugestão do nome, todos os produtos da lista que ainda não têm categoria? Quem já tem categoria escolhida não muda.", confirmar: "Marcar" })) return;
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

async function epiAbrirFichaFuncionario(funcionarioId){
  if(!funcionarioId || typeof abrirFuncionario !== "function") return;
  if(typeof irParaSecao === "function" && !irParaSecao("funcionarios")) return;
  await abrirFuncionario(funcionarioId);
  if(typeof ativarTabFunc === "function"){ ativarTabFunc("epi"); epiCarregarFicha(); }
}


function epiAbrirRelatorio(visao){
  if(visao) { _epiRel.visao = visao; _epiRel.dados = null; }

  if(typeof balSoEpi === "function" && balSoEpi() && typeof sstAbrirEpi === "function"){
    sstAbrirEpi().then(() => $("epi-card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
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










const EPI_OBR_ATIVAS = ["em_andamento", "planejada", "paralisada"];
const EPI_OBR_STATUS = { em_andamento: "Em andamento", planejada: "Planejada", paralisada: "Paralisada", concluida: "Concluída", cancelada: "Cancelada" };
const EPI_OBR_MSG_MIGRATION = "O saldo de EPI por obra entra quando a migration da fase 202a estiver no banco.";
const _epiObr = { aba: "estoque", modo: "lista", obraId: null, dados: null, erro: null, carregando: false,
                  funcs: null, maqs: null, form: null, hist: null, histErro: null };
function epiObrPodeOperar(){ return typeof sstPodeOperar === "function" && sstPodeOperar(); }
function epiObrNum(v){ return Number(v) || 0; }
function epiObrQtd(v){ return uiFmt(v, "num"); }
function epiObrBrl(v){ return `<span data-val-sens>${uiFmt(v, "brl")}</span>`; }
function epiObrDiaSP(iso){ return iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) : null; }
function epiObrErroMsg(error){ return epiViewAusente(error) ? EPI_OBR_MSG_MIGRATION : (error && error.message) || "Não foi possível carregar."; }


async function epiObrCarregar(force){
  const alvo = $("epi-obr-conteudo"); if(!alvo) return;
  if(_epiObr.carregando) return;
  if(_epiObr.dados && !force){ epiObrDesenhar(); return; }
  _epiObr.carregando = true;
  alvo.innerHTML = uiCarregando("Carregando o EPI nas obras…");
  const [saldo, obras, movs] = await Promise.all([
    lerTudo(() => sb.from("vw_epi_saldo_local").select("produto_id,produto_codigo,produto_nome,local,obra_id,obra_codigo,obra_nome,obra_status,quantidade,valor,atualizado_em"), ["produto_id", "obra_id"]),
    lerTudo(() => sb.from("obras").select("id,codigo,nome,status")),
    lerTudo(() => sb.from("movimentacoes_estoque").select("id,tipo,local_origem_obra_id,local_destino_obra_id,data_movimentacao,estorno_de")
      .or("local_origem_obra_id.not.is.null,local_destino_obra_id.not.is.null"))
  ]);
  _epiObr.carregando = false;
  const err = saldo.error || obras.error || movs.error;
  if(err){ _epiObr.dados = null; _epiObr.erro = epiObrErroMsg(err); epiObrDesenhar(); return; }
  _epiObr.erro = null;
  _epiObr.dados = { saldo: saldo.data, obras: obras.data, movs: movs.data };
  epiObrDesenhar();
}

function epiObrProdutos(){
  const m = new Map();
  for(const r of (_epiObr.dados?.saldo || [])) if(r.local === "base") m.set(r.produto_id, r);
  return m;
}
function epiObrSaldoObra(obraId){ return (_epiObr.dados?.saldo || []).filter(r => r.local === "obra" && r.obra_id === obraId && epiObrNum(r.quantidade) !== 0); }

function epiObrLinhasObras(){
  const D = _epiObr.dados; if(!D) return [];
  const porObra = new Map();
  for(const r of D.saldo) if(r.local === "obra" && epiObrNum(r.quantidade) !== 0){
    const a = porObra.get(r.obra_id) || { itens: 0, pecas: 0, valor: 0 };
    a.itens++; a.pecas += epiObrNum(r.quantidade); a.valor += epiObrNum(r.valor); porObra.set(r.obra_id, a);
  }
  const ult = new Map();
  const desfeitas = new Set(D.movs.filter(m => m.estorno_de).map(m => m.estorno_de));
  for(const m of D.movs){
    if(m.estorno_de || desfeitas.has(m.id)) continue;
    if(m.tipo === "transferencia" && m.local_destino_obra_id){
      const u = ult.get(m.local_destino_obra_id) || {}; if(!u.envio || m.data_movimentacao > u.envio) u.envio = m.data_movimentacao; ult.set(m.local_destino_obra_id, u);
    }
    if(m.tipo === "saida" && m.local_origem_obra_id){
      const u = ult.get(m.local_origem_obra_id) || {}; if(!u.consumo || m.data_movimentacao > u.consumo) u.consumo = m.data_movimentacao; ult.set(m.local_origem_obra_id, u);
    }
  }
  return D.obras.filter(o => EPI_OBR_ATIVAS.includes(o.status) || porObra.has(o.id)).map(o => {
    const a = porObra.get(o.id) || { itens: 0, pecas: 0, valor: 0 }; const u = ult.get(o.id) || {};
    return { id: o.id, codigo: o.codigo, nome: o.nome, status: o.status, encerrada: !EPI_OBR_ATIVAS.includes(o.status),
             itens: a.itens, pecas: a.pecas, valor: a.valor, envio: epiObrDiaSP(u.envio), consumo: epiObrDiaSP(u.consumo) };
  }).sort((a, b) => (b.encerrada && b.pecas > 0) - (a.encerrada && a.pecas > 0) || String(b.codigo || "").localeCompare(String(a.codigo || "")));
}


function epiObrFaixa(){
  if(_epiObr.erro) return uiFaixaSituacao([], null, { erro: _epiObr.erro });
  const base = [...epiObrProdutos().values()].filter(r => epiObrNum(r.quantidade) < 0);
  const conc = epiObrLinhasObras().filter(o => o.encerrada && o.pecas > 0);
  const frases = [];
  if(base.length) frases.push(`${base.length} ${base.length === 1 ? "produto de EPI com base negativa" : "produtos de EPI com base negativa"}: conte antes de enviar`);
  if(conc.length) frases.push(`${conc.length} ${conc.length === 1 ? "obra concluída com saldo" : "obras concluídas com saldo"} (${conc.map(o => o.codigo).join(", ")}): apontar as entregas por funcionário ou retornar à base`);
  if(!frases.length){
    const com = epiObrLinhasObras().filter(o => o.pecas > 0).length;
    return uiFaixaSituacao(["Saldo de EPI sem pendência", `${com} ${com === 1 ? "obra com EPI" : "obras com EPI"}`], "ok");
  }
  return uiFaixaSituacao(frases, conc.length ? "perigo" : "aviso");
}
function epiObrTopo(){
  const op = epiObrPodeOperar();
  const b = (id, txt, tit, prim) => `<button type="button" class="ui-btn${prim ? " ui-btn-prim" : ""}" data-acao="${esc(id)}" title="${esc(tit)}">${esc(txt)}</button>`;
  return `<div class="lista-topo epi-obr-topo"><h3>EPI nas obras</h3><div class="epi-obr-acoes">${op ? b("enviar", "Enviar para obra", "Transferir EPI e uniforme da base (SESMT) para uma obra; não gera custo", true)
    + b("consumo", "Consumo na obra", "Lançar o que cada funcionário recebeu na obra; baixa o saldo da obra e o custo cai na obra")
    + b("retornar", "Retorno à base", "Devolver à base o EPI que sobrou na obra; não é custo") : ""}${b("atualizar", "Atualizar", "Ler de novo os saldos")}</div></div>`;
}
function epiObrDesenhar(){
  const alvo = $("epi-obr-conteudo"); if(!alvo) return;
  if(_epiObr.erro && !_epiObr.dados){ alvo.innerHTML = epiObrTopo() + epiObrFaixa(); return; }
  if(!_epiObr.dados){ alvo.innerHTML = uiCarregando("Carregando o EPI nas obras…"); return; }
  if(_epiObr.modo === "obra") return epiObrDesenharObra();
  if(["enviar", "retornar", "consumo", "inventario"].includes(_epiObr.modo) && _epiObr.form) return epiObrDesenharForm();
  _epiObr.modo = "lista";
  const abas = [{ id: "estoque", rotulo: "Estoque por obra" }, { id: "pendentes", rotulo: "Pendentes de apontamento" }];
  if(epiObrPodeOperar()) abas.push({ id: "inventario", rotulo: "Inventário da obra", resumo: "contagem física" });
  if(!abas.some(a => a.id === _epiObr.aba)) _epiObr.aba = "estoque";
  const L = epiObrLinhasObras();
  let corpo;
  if(_epiObr.aba === "pendentes"){
    const P = L.filter(o => o.pecas > 0).sort((a, b) => (b.encerrada - a.encerrada) || b.pecas - a.pecas);
    const dias = d => d ? Math.max(0, Math.round((new Date(hojeISO() + "T12:00") - new Date(d + "T12:00")) / 864e5)) : null;
    corpo = `<p class="meta epi-obr-ajuda">Saldo que está na obra e ainda não foi apontado a funcionário. Ao fim da obra, o que foi entregue a cada pessoa é lançado no Consumo na obra, com a data de cada entrega; o que sobrou volta à base.</p>` + uiTabela({
      colunas: [
        { chave: "codigo", rotulo: "Obra", html: o => epiObrCelObra(o) },
        { chave: "status", rotulo: "Situação", html: o => esc(EPI_OBR_STATUS[o.status] || o.status) },
        { chave: "itens", rotulo: "Itens", tipo: "int" }, { chave: "pecas", rotulo: "Peças", tipo: "num" },
        { chave: "valor", rotulo: "R$", tipo: "brl", html: o => epiObrBrl(o.valor) },
        { chave: "consumo", rotulo: "Último consumo", tipo: "data" },
        { chave: "dias", rotulo: "Dias sem apontar", tipo: "int", html: o => { const d = dias(o.consumo || o.envio); return d == null ? "—" : uiFmt(d, "int"); } }
      ], linhas: P, chaveLinha: "id", vazio: "Nenhuma obra com EPI esperando apontamento."
    });
  } else if(_epiObr.aba === "inventario"){
    corpo = epiObrListaInventario(L);
  } else {
    const tot = L.reduce((a, o) => ({ itens: a.itens + o.itens, pecas: a.pecas + o.pecas, valor: a.valor + o.valor }), { itens: 0, pecas: 0, valor: 0 });
    corpo = uiTabela({
      colunas: [
        { chave: "codigo", rotulo: "Obra", html: o => epiObrCelObra(o) },
        { chave: "itens", rotulo: "Itens", tipo: "int" }, { chave: "pecas", rotulo: "Peças", tipo: "num" },
        { chave: "valor", rotulo: "R$", tipo: "brl", html: o => epiObrBrl(o.valor) },
        { chave: "envio", rotulo: "Último envio", tipo: "data" }, { chave: "consumo", rotulo: "Último consumo", tipo: "data" }
      ], linhas: L, chaveLinha: "id", vazio: "Nenhuma obra em andamento, planejada ou paralisada.",
      rodape: { codigo: `${L.length} obras`, itens: tot.itens, pecas: tot.pecas, valor: tot.valor }
    });
  }
  alvo.innerHTML = epiObrTopo() + epiObrFaixa() + uiAbas(abas, { ativa: _epiObr.aba, rotulo: "EPI nas obras" }) + `<div class="epi-obr-corpo epi-cns-clicavel">${  corpo}</div>`;
}
function epiObrCelObra(o){
  const aviso = o.encerrada && o.pecas > 0 ? ` <span class="tag vermelho" title="Obra encerrada com EPI: apontar as entregas por funcionário ou retornar à base">${esc((EPI_OBR_STATUS[o.status] || o.status).toLowerCase())} com saldo</span>` : "";
  const sem = !o.pecas ? ` <span class="tag cinza">sem saldo</span>` : "";
  return `${uiCodigo(o.codigo || "—")} ${esc(o.nome || "")}${  aviso}${  sem}`;
}
function epiObrListaInventario(L){
  return `<p class="meta epi-obr-ajuda">Contagem física de EPI e uniforme numa obra. A planilha de conferência traz a posição do Odoo em cada obra, só para comparar: a posição do Odoo nunca vira saldo sozinha. Escolha a obra para lançar a contagem.</p>` + uiTabela({
    colunas: [
      { chave: "codigo", rotulo: "Obra", html: o => epiObrCelObra(o) },
      { chave: "status", rotulo: "Situação", html: o => esc(EPI_OBR_STATUS[o.status] || o.status) },
      { chave: "itens", rotulo: "Itens no app", tipo: "int" }, { chave: "pecas", rotulo: "Peças no app", tipo: "num" }
    ], linhas: L, chaveLinha: "id", vazio: "Nenhuma obra para contar."
  });
}


async function epiObrAbrirObra(obraId){
  _epiObr.modo = "obra"; _epiObr.obraId = obraId; _epiObr.hist = null; _epiObr.histErro = null; _epiObr.form = null;
  epiObrDesenhar();
  const { data, error } = await lerTudo(() => sb.from("movimentacoes_estoque")
    .select("id,tipo,quantidade,custo_unitario,documento,observacoes,data_movimentacao,created_at,registrado_por,estorno_de,local_origem_obra_id,local_destino_obra_id,produto:produtos(codigo,nome),funcionario:funcionarios!movimentacoes_estoque_funcionario_id_fkey(nome),equipamento:equipamentos(codigo)")
    .or(`local_origem_obra_id.eq.${obraId},local_destino_obra_id.eq.${obraId}`));
  if(_epiObr.obraId !== obraId) return;
  _epiObr.hist = error ? [] : data.sort((a, b) => String(b.data_movimentacao).localeCompare(String(a.data_movimentacao)));
  _epiObr.histErro = error ? epiObrErroMsg(error) : null;
  if(_epiObr.modo === "obra") epiObrDesenhar();
}
function epiObrTipoMov(m, obraId){
  if(m.estorno_de) return "Estorno do consumo";
  if(m.tipo === "transferencia") return m.local_destino_obra_id === obraId ? (m.local_origem_obra_id ? "Transferência recebida" : "Envio da base") : (m.local_destino_obra_id ? "Transferência enviada" : "Retorno à base");
  if(m.tipo === "saida") return "Consumo";
  if(m.tipo === "ajuste") return "Inventário";
  return m.documento || m.tipo;
}
function epiObrDesenharObra(){
  const alvo = $("epi-obr-conteudo"); const id = _epiObr.obraId;
  const o = (_epiObr.dados?.obras || []).find(x => x.id === id) || {};
  const S = epiObrSaldoObra(id).sort((a, b) => String(a.produto_nome).localeCompare(String(b.produto_nome), "pt-BR"));
  const pecas = S.reduce((s, r) => s + epiObrNum(r.quantidade), 0), valor = S.reduce((s, r) => s + epiObrNum(r.valor), 0);
  const enc = !EPI_OBR_ATIVAS.includes(o.status);
  const op = epiObrPodeOperar();
  const b = (acao, txt, prim) => `<button type="button" class="ui-btn${prim ? " ui-btn-prim" : ""}" data-acao="${esc(acao)}">${esc(txt)}</button>`;
  const topo = `<div class="lista-topo epi-obr-topo"><button type="button" class="ui-btn" data-acao="voltar">‹ EPI nas obras</button><h3>${uiCodigo(o.codigo || "—")} ${esc(o.nome || "")}</h3><div class="epi-obr-acoes">${op ? (enc ? "" : b("enviar", "Enviar para esta obra", true)) + (S.length ? b("consumo", "Consumo na obra", enc) + b("retornar", "Retorno à base") : "") + b("inventario", "Inventário") : ""}</div></div>`;
  const faixa = uiFaixaSituacao([`${EPI_OBR_STATUS[o.status] || o.status || ""}`, `${S.length} ${S.length === 1 ? "item" : "itens"}`, `${pecas.toLocaleString("pt-BR")} peças`,
    enc && pecas > 0 ? "concluída com saldo: apontar as entregas por funcionário ou retornar à base" : ""], enc && pecas > 0 ? "perigo" : pecas > 0 ? "info" : "neutro");
  const prods = uiTabela({ colunas: [
      { chave: "produto_codigo", rotulo: "Código", tipo: "codigo" }, { chave: "produto_nome", rotulo: "Produto" },
      { chave: "quantidade", rotulo: "Quantidade", tipo: "num" }, { chave: "valor", rotulo: "R$", tipo: "brl", html: r => epiObrBrl(r.valor) }
    ], linhas: S, vazio: "Sem EPI nesta obra.", rodape: { produto_nome: "Total", quantidade: pecas, valor } });
  let hist;
  if(_epiObr.histErro) hist = uiErro(_epiObr.histErro);
  else if(!_epiObr.hist) hist = uiCarregando("Carregando o histórico…");
  else {
    const desfeitas = new Set(_epiObr.hist.filter(m => m.estorno_de).map(m => m.estorno_de));
    const agora = Date.now();
    const podeDesfazer = m => op && m.tipo === "saida" && !m.estorno_de && !desfeitas.has(m.id) && agora - new Date(m.created_at).getTime() < 10 * 60e3
      && (m.registrado_por === usuarioAtual?.id || ["admin", "diretor"].includes(usuarioAtual?.cargo));
    hist = uiTabela({ colunas: [
        { chave: "data_movimentacao", rotulo: "Data", tipo: "data", html: m => uiFmt(epiObrDiaSP(m.data_movimentacao), "data") },
        { chave: "tipo", rotulo: "Movimento", html: m => esc(epiObrTipoMov(m, id)) + (desfeitas.has(m.id) ? ' <span class="tag cinza">desfeito</span>' : "") },
        { chave: "produto", rotulo: "Produto", html: m => `${uiCodigo(m.produto?.codigo || "")} ${esc(m.produto?.nome || "")}` },
        { chave: "quantidade", rotulo: "Qtd", tipo: "num", html: m => epiObrQtd(m.tipo === "ajuste" ? epiObrNum(m.quantidade) : Math.abs(epiObrNum(m.quantidade))) },
        { chave: "funcionario", rotulo: "Funcionário / contato", html: m => esc(m.funcionario?.nome || "—") },
        { chave: "equipamento", rotulo: "Máquina", html: m => m.equipamento?.codigo ? uiCodigo(m.equipamento.codigo) : "—" },
        { chave: "observacoes", rotulo: "Observação", html: m => esc(m.observacoes || "") },
        { chave: "id", rotulo: "", html: m => podeDesfazer(m) ? `<button type="button" class="ui-btn" data-desfazer="${esc(m.id)}" title="Desfazer este consumo (até 10 minutos depois de lançar)">Desfazer</button>` : "" }
      ], linhas: _epiObr.hist, vazio: "Nenhum envio, consumo, retorno ou inventário nesta obra." });
  }
  alvo.innerHTML = topo + faixa + `<h4 class="epi-cns-sub">Produtos na obra</h4>${  prods}<h4 class="epi-cns-sub">Histórico</h4>${  hist}`;
}
async function epiObrDesfazer(id, btn){
  const ok = await uiConfirmar({ titulo: "Desfazer consumo", texto: "O saldo volta para a obra e o custo sai da obra. Desfazer?", confirmar: "Desfazer", perigo: true });
  if(!ok) return;
  await comBotaoTravado(btn, async () => {
    const { error } = await sb.rpc("estoque_saida_desfazer", { p_id: id });
    if(error){ uiAvisar(error.message, "perigo"); return; }
    uiAvisar("Consumo desfeito.", "ok");
    const obra = _epiObr.obraId;
    await epiObrCarregar(true);
    await epiObrAbrirObra(obra);
  });
}


async function epiObrCadastros(){
  if(!_epiObr.funcs){
    const { data } = await lerTudo(() => sb.from("funcionarios").select("id,nome,matricula").eq("ativo", true));
    const vistos = {};
    _epiObr.funcs = (data || []).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR")).map(f => {
      const n = String(f.nome || "").trim(); vistos[n] = (vistos[n] || 0) + 1;
      return { id: f.id, rotulo: vistos[n] > 1 ? `${n} · ${f.matricula || String(f.id).slice(0, 4)}` : n };
    });
  }
  if(!_epiObr.maqs){
    const { data } = await sb.from("equipamentos").select("id,codigo,nome").eq("ativo", true).not("tipo", "in", "(caminhao,veiculo)").order("codigo");
    _epiObr.maqs = data || [];
  }
}
function epiObrFuncId(txt){ const t = String(txt || "").trim(); return (_epiObr.funcs || []).find(f => f.rotulo === t)?.id || null; }
function epiObrProdRotulo(p){ return `${p.produto_codigo} · ${p.produto_nome}`; }

async function epiObrAbrirForm(modo, obraId){
  await epiObrCadastros();
  _epiObr.modo = modo;
  _epiObr.form = { obra: obraId || "", data: hojeISO(), contato: "", obs: "", motivo: "", itens: [], planilha: null };
  if(modo === "consumo") _epiObr.form.itens = [epiObrLinhaVazia(), epiObrLinhaVazia(), epiObrLinhaVazia()];
  if(modo === "enviar" && obraId && !epiObrObrasDoForm().some(o => o[0] === obraId)) _epiObr.form.obra = "";
  if((modo === "retornar" || modo === "inventario") && _epiObr.form.obra) epiObrPreencherDaObra();
  epiObrDesenhar();
}
function epiObrLinhaVazia(){ return { func: "", produto: "", qtd: "", maq: "", maqAuto: false, obs: "" }; }

function epiObrPreencherDaObra(){
  const f = _epiObr.form; if(!f || !f.obra) return;
  f.itens = epiObrSaldoObra(f.obra).sort((a, b) => String(a.produto_nome).localeCompare(String(b.produto_nome), "pt-BR"))
    .map(r => ({ produto: r.produto_id, qtd: "", odoo: null }));
  if(_epiObr.modo === "inventario" && f.planilha) epiObrAplicarPlanilha();
}
function epiObrObrasDoForm(){
  const D = _epiObr.dados; if(!D) return [];
  const comSaldo = new Set(D.saldo.filter(r => r.local === "obra" && epiObrNum(r.quantidade) > 0).map(r => r.obra_id));
  const m = _epiObr.modo;
  return D.obras.filter(o => m === "enviar" ? EPI_OBR_ATIVAS.includes(o.status)
      : m === "inventario" ? (EPI_OBR_ATIVAS.includes(o.status) || comSaldo.has(o.id)) : comSaldo.has(o.id))
    .sort((a, b) => String(b.codigo || "").localeCompare(String(a.codigo || "")))
    .map(o => [o.id, `${o.codigo} · ${o.nome || ""}${EPI_OBR_ATIVAS.includes(o.status) ? "" : " (" + (EPI_OBR_STATUS[o.status] || o.status).toLowerCase() + ")"}`]);
}
function epiObrSaldoNo(prodId, obraId){
  const r = (_epiObr.dados?.saldo || []).find(x => x.produto_id === prodId && (obraId ? x.local === "obra" && x.obra_id === obraId : x.local === "base"));
  return r ? epiObrNum(r.quantidade) : 0;
}
function epiObrDesenharForm(){
  const alvo = $("epi-obr-conteudo"); const f = _epiObr.form; const m = _epiObr.modo;
  const P = epiObrProdutos();
  const TIT = { enviar: "Enviar para obra", retornar: "Retorno à base", consumo: "Consumo na obra", inventario: "Inventário da obra" };
  const AJ = {
    enviar: "Sai da base (SESMT) e fica no saldo da obra. Não gera custo: o custo nasce no consumo. Produto com base negativa não sai até a contagem.",
    retornar: "Volta da obra para a base. Não é custo nem devolução de funcionário.",
    consumo: "Uma linha por entrega: quem recebeu, o quê, quanto e a máquina (vem da Alocação na data e pode ser trocada). Baixa o saldo da obra; o custo cai na obra na data da utilização. Uso coletivo da obra: sem funcionário, com observação.",
    inventario: "Contagem física nova na obra, com o motivo. Soma ao total do estoque (a base não muda). A coluna Odoo vem da planilha de conferência e serve só para comparar."
  };
  const obras = epiObrObrasDoForm();
  let campos = uiCampo({ id: "epi-obr-f-obra", rotulo: m === "retornar" ? "Obra de origem" : "Obra", tipo: "select", opcoes: obras, valor: f.obra, obrigatorio: true,
    placeholder: "Selecione a obra", ajuda: m === "consumo" || m === "retornar" ? "só as obras com saldo" : "" });
  campos += uiCampo({ id: "epi-obr-f-data", rotulo: m === "consumo" ? "Data da utilização" : m === "inventario" ? "Data da contagem" : "Data", tipo: "date", valor: f.data, obrigatorio: true });
  if(m === "enviar" || m === "retornar") campos += `<div class="ui-campo"><label for="epi-obr-f-contato">Contato <span class="meta">(opcional)</span></label><input id="epi-obr-f-contato" list="epi-obr-dl-func" value="${esc(f.contato)}" placeholder="quem leva ou traz" autocomplete="off"></div>`;
  if(m === "inventario") campos += uiCampo({ id: "epi-obr-f-motivo", rotulo: "Motivo", valor: f.motivo, obrigatorio: true, placeholder: "ex.: contagem inicial da obra (planilha do Odoo conferida)" });
  else campos += uiCampo({ id: "epi-obr-f-obs", rotulo: "Observação", valor: f.obs, placeholder: m === "consumo" ? "vale para as linhas sem observação própria" : "" });
  const dlFunc = `<datalist id="epi-obr-dl-func">${(_epiObr.funcs || []).map(x => `<option value="${esc(x.rotulo)}"></option>`).join("")}</datalist>`;
  const dlProd = `<datalist id="epi-obr-dl-prod">${[...P.values()].map(p => `<option value="${esc(epiObrProdRotulo(p))}"></option>`).join("")}</datalist>`;
  let grade;
  if(!f.obra && m !== "enviar") grade = uiVazio("Escolha a obra.");
  else if(m === "consumo") grade = epiObrGradeConsumo();
  else grade = epiObrGradeItens(P);
  const tot = epiObrTotais();
  const travar = !epiObrPodeOperar();
  const planilha = m === "inventario" && f.obra ? `<div class="epi-obr-planilha"><button type="button" class="ui-btn" data-acao="planilha" title="Lê a planilha de conferência (aba da obra): mostra a coluna Odoo e preenche o contado se a coluna Contado vier preenchida">Abrir planilha de conferência (.xlsx)</button><input type="file" id="epi-obr-arquivo" accept=".xlsx" hidden><span class="meta">${f.planilha ? esc(f.planilha.resumo) : "colunas Código, Odoo e Contado (ou Quantidade), na aba com o código da obra"}</span></div>` : "";
  const extra = m === "consumo" ? `<button type="button" class="ui-btn" data-acao="mais-linhas">+ 3 linhas</button>`
    : m === "retornar" ? `<button type="button" class="ui-btn" data-acao="tudo" title="Preenche a quantidade com todo o saldo da obra">Retornar tudo</button>` : "";
  alvo.innerHTML = `<div class="lista-topo epi-obr-topo"><button type="button" class="ui-btn" data-acao="voltar">‹ EPI nas obras</button><h3>${esc(TIT[m])}</h3></div>
    <p class="meta epi-obr-ajuda">${esc(AJ[m])}</p>
    <div class="epi-obr-campos">${  campos}</div>${  dlFunc}${  dlProd}${  planilha}
    <div class="epi-obr-grade">${  grade}</div>
    <div class="form-acoes compacta epi-obr-rodape"><span class="meta" data-val-sens>${esc(tot.txt)}</span>${  extra}
      <button type="button" class="ui-btn ui-btn-prim" id="epi-obr-confirmar" data-acao="confirmar"${travar ? ' title="Só o SESMT lança: o banco recusa para este perfil"' : ""}>${esc(m === "inventario" ? "Lançar contagem" : m === "consumo" ? "Lançar consumo" : TIT[m])}</button></div>`;
}
function epiObrGradeItens(P){
  const f = _epiObr.form, m = _epiObr.modo;
  const origem = m === "enviar" ? null : f.obra;
  const add = m === "retornar" ? "" : `<div class="epi-obr-add"><label for="epi-obr-add-prod" class="sr-only">Adicionar produto</label><input id="epi-obr-add-prod" list="epi-obr-dl-prod" placeholder="adicionar produto: código ou nome…" autocomplete="off"><button type="button" class="ui-btn" data-acao="add-prod">Adicionar</button></div>`;
  const temOdoo = m === "inventario" && !!f.planilha;
  const linhas = f.itens.map((it, i) => {
    const p = P.get(it.produto) || { produto_codigo: "?", produto_nome: "produto não encontrado" };
    const saldo = epiObrSaldoNo(it.produto, origem);
    return `<tr><td class="cod">${uiCodigo(p.produto_codigo)}</td><td>${esc(p.produto_nome)}</td><td class="num${saldo < 0 ? " epi-obr-neg" : ""}">${epiObrQtd(saldo)}</td>${temOdoo ? `<td class="num">${it.odoo == null ? "—" : epiObrQtd(it.odoo)}</td>` : ""}
      <td class="num"><label class="sr-only" for="epi-obr-q-${i}">Quantidade</label><input type="number" min="0" step="0.001" id="epi-obr-q-${i}" data-linha="${i}" data-campo="qtd" value="${esc(it.qtd)}"></td>
      <td>${m === "retornar" ? "" : `<button type="button" class="ui-btn" data-remover-linha="${i}" aria-label="Remover linha">×</button>`}</td></tr>`;
  }).join("");
  const rotSaldo = m === "enviar" ? "Saldo na base" : "No app (obra)";
  return `${  add}<div class="ui-tabela-rola"><table class="ui-tabela"><thead><tr><th>Código</th><th>Produto</th><th class="num">${esc(rotSaldo)}</th>${temOdoo ? '<th class="num">Odoo</th>' : ""}<th class="num">${esc(m === "inventario" ? "Contado" : "Quantidade")}</th><th></th></tr></thead>
    <tbody>${  linhas || `<tr class="ui-tabela-estado"><td colspan="${temOdoo ? 6 : 5}">${uiVazio(m === "retornar" ? "A obra não tem saldo." : "Nenhum item. Adicione acima.")}</td></tr>`}</tbody></table></div>`;
}
function epiObrGradeConsumo(){
  const f = _epiObr.form;
  const S = epiObrSaldoObra(f.obra).sort((a, b) => String(a.produto_nome).localeCompare(String(b.produto_nome), "pt-BR"));
  if(!S.length) return uiVazio("A obra não tem saldo de EPI no app. Envie da base ou lance o inventário da obra.");
  const usado = {}; f.itens.forEach(it => { if(it.produto) usado[it.produto] = (usado[it.produto] || 0) + epiObrNum(it.qtd); });
  const opProd = sel => `<option value="">— produto —</option>` + S.map(r => `<option value="${esc(r.produto_id)}"${r.produto_id === sel ? " selected" : ""}>${esc(epiObrProdRotulo(r))} (saldo ${esc(epiObrNum(r.quantidade).toLocaleString("pt-BR"))})</option>`).join("");
  const opMaq = sel => `<option value="">— sem máquina —</option>` + (_epiObr.maqs || []).map(q => `<option value="${esc(q.id)}"${q.id === sel ? " selected" : ""}>${esc(q.codigo)}</option>`).join("");
  const linhas = f.itens.map((it, i) => {
    const saldo = it.produto ? epiObrSaldoNo(it.produto, f.obra) : null;
    const resta = saldo == null ? null : saldo - (usado[it.produto] || 0);
    return `<tr><td><label class="sr-only" for="epi-obr-c-func-${i}">Funcionário</label><input id="epi-obr-c-func-${i}" list="epi-obr-dl-func" data-linha="${i}" data-campo="func" value="${esc(it.func)}" placeholder="funcionário" autocomplete="off"></td>
      <td><label class="sr-only" for="epi-obr-c-prod-${i}">Produto</label><select id="epi-obr-c-prod-${i}" data-linha="${i}" data-campo="produto">${  opProd(it.produto)}</select></td>
      <td class="num"><label class="sr-only" for="epi-obr-c-q-${i}">Quantidade</label><input type="number" min="0" step="0.001" id="epi-obr-c-q-${i}" data-linha="${i}" data-campo="qtd" value="${esc(it.qtd)}"></td>
      <td class="num${resta != null && resta < 0 ? " epi-obr-neg" : ""}" id="epi-obr-c-r-${i}">${resta == null ? "—" : epiObrQtd(resta)}</td>
      <td><label class="sr-only" for="epi-obr-c-maq-${i}">Máquina</label><select id="epi-obr-c-maq-${i}" data-linha="${i}" data-campo="maq" title="Máquina da entrega; sem ela, a da Alocação na data">${  opMaq(it.maq)}</select> <span class="meta" id="epi-obr-c-maqa-${i}"${it.maqAuto ? "" : " hidden"}>Alocação</span></td>
      <td><label class="sr-only" for="epi-obr-c-obs-${i}">Observação</label><input id="epi-obr-c-obs-${i}" data-linha="${i}" data-campo="obs" value="${esc(it.obs)}" placeholder="uso coletivo, tamanho…"></td>
      <td><button type="button" class="ui-btn" data-remover-linha="${i}" aria-label="Remover linha">×</button></td></tr>`;
  }).join("");
  return `<div class="ui-tabela-rola"><table class="ui-tabela epi-obr-consumo"><thead><tr><th>Funcionário</th><th>Produto (saldo na obra)</th><th class="num">Qtd</th><th class="num">Resta</th><th>Máquina</th><th>Observação</th><th></th></tr></thead><tbody>${  linhas}</tbody></table></div>`;
}

function epiObrCusto(prodId){
  const r = (_epiObr.dados?.saldo || []).find(x => x.produto_id === prodId && epiObrNum(x.quantidade) !== 0);
  return r ? epiObrNum(r.valor) / epiObrNum(r.quantidade) : 0;
}
function epiObrTotais(){
  const f = _epiObr.form; if(!f) return { pecas: 0, valor: 0, linhas: 0, itens: [], txt: "" };
  const L = f.itens.filter(it => it.produto && it.qtd !== "" && it.qtd != null && (_epiObr.modo === "inventario" || epiObrNum(it.qtd) > 0));
  const pecas = L.reduce((s, it) => s + epiObrNum(it.qtd), 0);
  const valor = L.reduce((s, it) => s + epiObrNum(it.qtd) * epiObrCusto(it.produto), 0);
  const txt = _epiObr.modo === "inventario" ? `${L.length} ${L.length === 1 ? "produto contado" : "produtos contados"}`
    : `${L.length} ${L.length === 1 ? "linha" : "linhas"} · ${pecas.toLocaleString("pt-BR")} peças · ${valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
  return { pecas, valor, linhas: L.length, itens: L, txt };
}

function epiObrLerCampos(){
  const f = _epiObr.form; if(!f) return;
  if($("epi-obr-f-obra")) f.obra = $("epi-obr-f-obra").value;
  if($("epi-obr-f-data")) f.data = $("epi-obr-f-data").value;
  if($("epi-obr-f-contato")) f.contato = $("epi-obr-f-contato").value;
  if($("epi-obr-f-obs")) f.obs = $("epi-obr-f-obs").value;
  if($("epi-obr-f-motivo")) f.motivo = $("epi-obr-f-motivo").value;
}

async function epiObrMaquinaDaAlocacao(i){
  const f = _epiObr.form; const it = f && f.itens[i]; if(!it) return;
  const fid = epiObrFuncId(it.func);
  if(!fid || !f.obra || (it.maq && !it.maqAuto)) return;
  const { data, error } = await sb.rpc("epi_alocacao_na_data", { p_funcionario: fid, p_data: f.data || hojeISO() });
  if(error || _epiObr.form !== f) return;
  const a = (data || []).find(x => x.obra_id === f.obra);
  if(it.maq && !it.maqAuto) return;
  it.maq = a?.equipamento_id || ""; it.maqAuto = !!a?.equipamento_id;
  const sel = $("epi-obr-c-maq-" + i); if(sel) sel.value = it.maq;
  const tag = $("epi-obr-c-maqa-" + i); if(tag) tag.hidden = !it.maqAuto;
}

function epiObrAtualizarParcial(){
  const f = _epiObr.form; if(!f) return;
  if(_epiObr.modo === "consumo"){
    const usado = {}; f.itens.forEach(it => { if(it.produto) usado[it.produto] = (usado[it.produto] || 0) + epiObrNum(it.qtd); });
    f.itens.forEach((it, i) => {
      const td = $("epi-obr-c-r-" + i); if(!td) return;
      const resta = it.produto ? epiObrSaldoNo(it.produto, f.obra) - (usado[it.produto] || 0) : null;
      td.textContent = resta == null ? "—" : Number(resta).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
      td.classList.toggle("epi-obr-neg", resta != null && resta < 0);
    });
  }
  const r = document.querySelector("#epi-obr-conteudo .epi-obr-rodape .meta"); if(r) r.textContent = epiObrTotais().txt;
}
async function epiObrConfirmar(btn){
  epiObrLerCampos();
  const f = _epiObr.form, m = _epiObr.modo;
  const t = epiObrTotais();
  if(!f.obra) return uiAvisar("Escolha a obra.", "aviso");
  if(!f.data) return uiAvisar("Informe a data.", "aviso");
  if(f.data > hojeISO()) return uiAvisar("A data não pode ser futura.", "aviso");
  if(!t.linhas) return uiAvisar(m === "inventario" ? "Informe o contado de pelo menos um produto." : "Informe a quantidade de pelo menos um item.", "aviso");
  const P = epiObrProdutos();
  const nome = id => { const p = P.get(id); return p ? p.produto_codigo : "?"; };
  let rpc, args, texto;
  if(m === "consumo"){
    const semQuem = t.itens.find(it => !epiObrFuncId(it.func) && !String(it.obs || f.obs || "").trim());
    if(semQuem) return uiAvisar(`Informe quem recebeu ${nome(semQuem.produto)} (uso coletivo só com observação).`, "aviso");
    const desconhecido = t.itens.find(it => String(it.func || "").trim() && !epiObrFuncId(it.func));
    if(desconhecido) return uiAvisar(`Funcionário não encontrado: ${desconhecido.func}. Escolha da lista.`, "aviso");
    rpc = "epi_consumir_obra";
    args = { p_obra: f.obra, p_data: f.data, p_itens: t.itens.map(it => ({ produto_id: it.produto, quantidade: epiObrNum(it.qtd), funcionario_id: epiObrFuncId(it.func),
      equipamento_id: it.maq || null, observacoes: String(it.obs || "").trim() || String(f.obs || "").trim() || null })) };
    texto = `Lançar o consumo na obra: ${t.txt}. O custo cai na obra em ${dataBR(f.data)}.`;
  } else if(m === "inventario"){
    if(!String(f.motivo || "").trim()) return uiAvisar("Informe o motivo do inventário.", "aviso");
    rpc = "epi_inventario_obra";
    args = { p_obra: f.obra, p_data: f.data, p_motivo: f.motivo.trim(), p_itens: t.itens.map(it => ({ produto_id: it.produto, quantidade: epiObrNum(it.qtd) })) };
    const mud = t.itens.filter(it => epiObrNum(it.qtd) !== epiObrSaldoNo(it.produto, f.obra)).length;
    texto = `Lançar a contagem de ${t.linhas} produto(s) na obra; ${mud} muda(m) o saldo do app. O total do estoque muda junto (a base não).`;
  } else {
    const contato = f.contato.trim() ? epiObrFuncId(f.contato) : null;
    if(f.contato.trim() && !contato) return uiAvisar("Contato não encontrado. Escolha da lista ou deixe vazio.", "aviso");
    rpc = "epi_transferir";
    args = { p_origem_obra: m === "enviar" ? null : f.obra, p_destino_obra: m === "enviar" ? f.obra : null, p_data: f.data, p_contato: contato,
      p_obs: f.obs.trim() || null, p_itens: t.itens.map(it => ({ produto_id: it.produto, quantidade: epiObrNum(it.qtd) })) };
    texto = `${m === "enviar" ? "Enviar para a obra" : "Retornar à base"}: ${t.txt}. Não gera custo.`;
  }
  const ok = await uiConfirmar({ titulo: { enviar: "Enviar para obra", retornar: "Retorno à base", consumo: "Consumo na obra", inventario: "Inventário da obra" }[m], texto, confirmar: "Confirmar" });
  if(!ok) return;
  await comBotaoTravado(btn, async () => {
    const { error } = await sb.rpc(rpc, args);
    if(error){ uiAvisar(error.message, "perigo"); return; }
    uiAvisar({ enviar: "Envio registrado.", retornar: "Retorno registrado.", consumo: "Consumo lançado. Desfazer vale por 10 minutos, na ficha da obra.", inventario: "Contagem lançada." }[m], "ok");
    const obra = f.obra;
    _epiObr.form = null;
    await epiObrCarregar(true);
    await epiObrAbrirObra(obra);
  });
}

async function epiObrLerPlanilha(file){
  const f = _epiObr.form; if(!file || !f || typeof XLSX === "undefined") return;
  const o = (_epiObr.dados?.obras || []).find(x => x.id === f.obra) || {};
  let wb;
  try { wb = XLSX.read(await file.arrayBuffer(), { type: "array" }); } catch(e){ uiAvisar("Não foi possível ler a planilha.", "perigo"); return; }
  const cod = String(o.codigo || "");
  const abas = wb.SheetNames.filter(n => n !== "Resumo");
  const nomeAba = abas.find(n => n === cod) || abas.find(n => n.split(/[-/]/)[0] === cod.split(/[-/]/)[0]) || (abas.length === 1 ? abas[0] : null);
  if(!nomeAba){ uiAvisar(`A planilha não tem a aba da obra ${cod}.`, "aviso"); return; }
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { defval: "" });
  const col = (l, nomes) => { const k = Object.keys(l).find(c => nomes.includes(epiNorm(c).trim())); return k ? l[k] : ""; };
  const lidas = linhas.map(l => ({ codigo: String(col(l, ["codigo"]) || "").trim(), odoo: col(l, ["odoo"]), contado: col(l, ["contado", "quantidade"]) })).filter(l => l.codigo);
  epiObrLerCampos();
  f.planilha = { aba: nomeAba, linhas: lidas, resumo: "" };
  epiObrAplicarPlanilha();
  epiObrDesenhar();
}
function epiObrAplicarPlanilha(){
  const f = _epiObr.form; if(!f || !f.planilha) return;
  const porCod = new Map([...epiObrProdutos().values()].map(p => [String(p.produto_codigo).toUpperCase(), p]));
  let novos = 0, contados = 0; const faltam = [];
  for(const l of f.planilha.linhas){
    const p = porCod.get(l.codigo.toUpperCase());
    if(!p){ faltam.push(l.codigo); continue; }
    let it = f.itens.find(x => x.produto === p.produto_id);
    if(!it){ it = { produto: p.produto_id, qtd: "", odoo: null }; f.itens.push(it); novos++; }
    it.odoo = l.odoo === "" ? null : epiObrNum(l.odoo);
    if(l.contado !== "" && l.contado != null){ it.qtd = String(epiObrNum(l.contado)); contados++; }
  }
  f.planilha.resumo = `aba ${f.planilha.aba}: ${f.planilha.linhas.length} linha(s), ${novos} produto(s) acrescentado(s), ${contados} contado(s) preenchido(s)${faltam.length ? `; sem par no app: ${faltam.slice(0, 5).join(", ")}${faltam.length > 5 ? "…" : ""}` : ""}`;
}


function epiObrClique(e){
  const el = e.target;
  const aba = el.closest("[data-aba]");
  if(aba){ _epiObr.aba = aba.dataset.aba; epiObrDesenhar(); return; }
  const des = el.closest("[data-desfazer]");
  if(des){ epiObrDesfazer(des.dataset.desfazer, des); return; }
  const rem = el.closest("[data-remover-linha]");
  if(rem && _epiObr.form){ epiObrLerCampos(); _epiObr.form.itens.splice(Number(rem.dataset.removerLinha), 1); epiObrDesenhar(); return; }
  const b = el.closest("[data-acao]");
  if(b){
    const a = b.dataset.acao;
    if(a === "atualizar") return epiObrCarregar(true);
    if(a === "voltar"){ _epiObr.modo = "lista"; _epiObr.form = null; return epiObrDesenhar(); }
    if(["enviar", "consumo", "retornar", "inventario"].includes(a)) return epiObrAbrirForm(a, _epiObr.modo === "obra" ? _epiObr.obraId : "");
    if(!_epiObr.form) return;
    if(a === "confirmar") return epiObrConfirmar(b);
    if(a === "mais-linhas"){ epiObrLerCampos(); _epiObr.form.itens.push(epiObrLinhaVazia(), epiObrLinhaVazia(), epiObrLinhaVazia()); return epiObrDesenhar(); }
    if(a === "tudo"){ epiObrLerCampos(); _epiObr.form.itens.forEach(it => { it.qtd = String(epiObrSaldoNo(it.produto, _epiObr.form.obra)); }); return epiObrDesenhar(); }
    if(a === "planilha"){ $("epi-obr-arquivo")?.click(); return; }
    if(a === "add-prod"){
      epiObrLerCampos();
      const txt = String($("epi-obr-add-prod")?.value || "").trim();
      const p = [...epiObrProdutos().values()].find(x => epiObrProdRotulo(x) === txt || String(x.produto_codigo).toUpperCase() === txt.toUpperCase());
      if(!p) return uiAvisar("Produto de EPI não encontrado. Escolha da lista.", "aviso");
      if(!_epiObr.form.itens.some(it => it.produto === p.produto_id)) _epiObr.form.itens.push({ produto: p.produto_id, qtd: "", odoo: null });
      epiObrDesenhar(); $("epi-obr-add-prod")?.focus();
    }
    return;
  }
  const tr = el.closest("tr[data-id]");
  if(tr && _epiObr.modo === "lista"){
    if(_epiObr.aba === "inventario") return epiObrAbrirForm("inventario", tr.dataset.id);
    if(_epiObr.aba === "pendentes" && epiObrPodeOperar()) return epiObrAbrirForm("consumo", tr.dataset.id);
    epiObrAbrirObra(tr.dataset.id);
  }
}
function epiObrMudou(e){
  const el = e.target; const f = _epiObr.form; if(!f) return;
  if(el.id === "epi-obr-arquivo"){ if(e.type === "change"){ epiObrLerPlanilha(el.files && el.files[0]); el.value = ""; } return; }
  if(el.id === "epi-obr-f-obra"){
    if(e.type !== "change") return;
    epiObrLerCampos();
    if(_epiObr.modo === "consumo") f.itens = [epiObrLinhaVazia(), epiObrLinhaVazia(), epiObrLinhaVazia()];
    if(_epiObr.modo === "retornar" || _epiObr.modo === "inventario") epiObrPreencherDaObra();
    return epiObrDesenhar();
  }
  if(el.id === "epi-obr-f-data"){
    if(e.type !== "change") return;
    epiObrLerCampos(); f.itens.forEach((it, i) => { if(it.maqAuto){ it.maq = ""; it.maqAuto = false; epiObrMaquinaDaAlocacao(i); } });
    return;
  }
  const i = el.dataset.linha; if(i == null) return;
  const it = f.itens[Number(i)]; if(!it) return;
  const campo = el.dataset.campo;
  if(campo === "maq"){ it.maq = el.value; it.maqAuto = false; const tag = $("epi-obr-c-maqa-" + i); if(tag) tag.hidden = true; return; }
  it[campo] = el.value;
  if(e.type === "change" && campo === "func"){ if(it.maqAuto){ it.maq = ""; it.maqAuto = false; } epiObrMaquinaDaAlocacao(Number(i)); }
  epiObrAtualizarParcial();
}


async function epiObrOndeEsta(produtoId){
  const alvo = $("epi-obr-onde"); if(!alvo) return;
  alvo.hidden = true; alvo.innerHTML = "";
  if(!produtoId || !podeVerEpi()) return;
  const { data, error } = await sb.from("vw_epi_saldo_local").select("local,obra_id,obra_codigo,obra_nome,obra_status,quantidade,valor").eq("produto_id", produtoId);
  if(typeof prodEditId !== "undefined" && prodEditId !== produtoId) return;
  if(error){ if(!epiViewAusente(error)){ alvo.innerHTML = uiSecao("", "Onde está", uiErro(error.message)); alvo.hidden = false; } return; }
  const base = (data || []).find(r => r.local === "base");
  if(!base) return;
  const obras = (data || []).filter(r => r.local === "obra").sort((a, b) => epiObrNum(b.quantidade) - epiObrNum(a.quantidade));
  const emObras = obras.reduce((s, r) => s + epiObrNum(r.quantidade), 0);
  const corpo = `<div class="epi-obr-onde-rv">${uiRotuloValor("Base (SESMT)", `<span class="${epiObrNum(base.quantidade) < 0 ? "epi-obr-neg" : ""}">${epiObrQtd(base.quantidade)}</span>`)}${uiRotuloValor("Em obras", epiObrQtd(emObras))}${uiRotuloValor("Total", epiObrQtd(epiObrNum(base.quantidade) + emObras))}</div>`
    + uiTabela({ colunas: [
        { chave: "obra_codigo", rotulo: "Obra", html: r => `${uiCodigo(r.obra_codigo || "")} ${esc(r.obra_nome || "")}${EPI_OBR_ATIVAS.includes(r.obra_status) ? "" : ` <span class="tag vermelho">${esc((EPI_OBR_STATUS[r.obra_status] || r.obra_status || "").toLowerCase())}</span>`}` },
        { chave: "quantidade", rotulo: "Quantidade", tipo: "num" }, { chave: "valor", rotulo: "R$", tipo: "brl", html: r => epiObrBrl(r.valor) }
      ], linhas: obras, vazio: "Nenhuma obra com este produto." });
  alvo.innerHTML = uiSecao("", "Onde está", corpo, `${obras.length} ${obras.length === 1 ? "obra" : "obras"}`);
  alvo.hidden = false;
}


function epiObrRender(){
  const card = $("epi-obr-card"); if(!card) return;
  const pode = podeVerEpi();
  card.hidden = !pode;
  if(!pode) return;
  const pai = $("sst-epi-aba"); if(pai && card.parentNode === pai && pai.lastElementChild !== card) pai.appendChild(card);
  epiObrCarregar(false);
}
function ligarEpiObr(){
  const c = $("epi-obr-conteudo"); if(!c) return;
  c.addEventListener("click", epiObrClique);
  c.addEventListener("change", epiObrMudou);
  c.addEventListener("input", epiObrMudou);
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarEpiObr);
else ligarEpiObr();

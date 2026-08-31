/* ====================================================================
   Módulo: Estacas (aba dentro da ficha de Obra)
   Lista, cadastro manual, edição, exclusão e importação via PDF (IA).
   Depende de: window.obraEditId (id da obra aberta na ficha)
   ==================================================================== */

let _estacas = [];            // cache das estacas da obra atual
let _estacaEdit = null;       // estaca em edição no modal
let _importPreview = [];      // estacas extraídas do PDF aguardando confirmação
let _estView = "lista";       // vista atual da aba Estacas: lista | planta
let _estExecId = null;        // estaca aberta no modal de execução rápida
let _estacaFuncs = [];        // cache funcionários para select operador
let _estacaEquips = [];       // cache equipamentos para select equipamento
let _plantaState = { zoom: 1, panX: 0, panY: 0 }; // estado do pan/zoom

const COR_STATUS = {
  prevista:    "var(--estaca-prevista)",
  em_execucao: "var(--aviso)",
  executada:   "var(--sucesso)",
  refugada:    "var(--perigo)"
};
const COR_HOJE = "var(--estaca-hoje)";

/* Normaliza nome da estaca (UPPER + trim) — mesmo formato que o trigger SQL usa.
   NOTA: NÃO remove BB. Em obras da CGL, BB1.1, B6.1_BB etc são nomes legítimos
   (estacas reais distintas de B1.1 / B6.1). Só normaliza caixa e espaços. */
function normalizarNumeroEstacaEstacas(s){
  if(!s) return "";
  return String(s).toUpperCase().trim().replace(/\s+/g, " ");
}

/* Reduz a string a apenas dígitos (pra comparar "B66" vs "B6.6" → ambos viram "66") */
function soDigitos(s){
  return String(s||"").replace(/\D/g, "");
}

/* Score de similaridade entre nome do CSV e nome cadastrado (0..1)
   Bônus / penalidade pra prefixo BB: ambos com BB ou ambos sem BB tem prioridade
   sobre cruzamentos (BB11 deve sugerir BB1.1 antes de B1.1). */
function scoreSimilaridade(csvNome, projNome){
  const a = String(csvNome||"").toUpperCase();
  const b = String(projNome||"").toUpperCase();
  if(a === b) return 1;
  const da = soDigitos(a);
  const db = soDigitos(b);
  if(!da || !db) return 0;
  // Indicador BB: começa com BB OU termina com _BB
  const isBBa = /^BB(?=\d)/.test(a) || /_BB$/.test(a);
  const isBBb = /^BB(?=\d)/.test(b) || /_BB$/.test(b);
  const ajusteBB = (isBBa === isBBb) ? 0 : -0.15;  // penaliza cruzamento BB↔não-BB
  let base = 0;
  if(da === db)                                base = 0.95;     // mesmos dígitos
  else if(da.includes(db) || db.includes(da))  base = 0.70;     // um contém o outro
  else if(da[0] === db[0])                     base = 0.40;     // mesmo primeiro dígito
  if(base === 0) return 0;
  return Math.max(0, Math.min(1, base + ajusteBB));
}

const ESTACA_TIPOS = {
  helice_continua: "Hélice contínua",
  pre_moldada: "Pré-moldada",
  raiz: "Raiz",
  escavada: "Escavada",
  strauss: "Strauss",
  metalica: "Metálica",
  franki: "Franki",
  hsa: "HSA",
  barrete: "Barrete",
  outro: "Outro"
};

const ESTACA_STATUS = {
  prevista:     { label: "Prevista",     cor: "cinza" },
  em_execucao:  { label: "Em execução",  cor: "ambar" },
  executada:    { label: "Executada",    cor: "verde" },
  refugada:     { label: "Refurada",     cor: "vermelho" }
};

/* ---------- Carga ---------- */
async function carregarEstacasDaObra(obraId){
  if(!obraId){
    _estacas = [];
    renderEstacas();
    return;
  }
  const [estsRes, execsRes] = await Promise.all([
    sb.from("estacas")
      .select("id,numero,tipo,status,diametro_mm,profundidade_m,cota_topo,cota_ponta,volume_concreto_m3,data_execucao,equipamento_id,operador_id,observacoes,alterada_em,alteracao_motivo")
      .eq("obra_id", obraId)
      .order("numero"),
    sb.from("rdo_execucao_estaca")
      .select("estaca_id, modalidade_execucao, rdo:rdo_id(obra_id)")
      .not("estaca_id", "is", null)
  ]);
  _estacas = estsRes.error ? [] : (estsRes.data || []);
  // Conta execuções por estaca pra detectar "ALTERADO" (refuros, casamentos errados)
  const contExec = {};
  (execsRes.data || []).forEach(re => {
    if(!re.rdo || re.rdo.obra_id !== obraId) return;
    if(!contExec[re.estaca_id]) contExec[re.estaca_id] = { total: 0, refuros: 0 };
    contExec[re.estaca_id].total++;
    if(re.modalidade_execucao === "refuro") contExec[re.estaca_id].refuros++;
  });
  // Anexa metadados nas estacas (não persiste — só uso em render)
  _estacas.forEach(e => {
    const c = contExec[e.id] || { total: 0, refuros: 0 };
    e._execs_total   = c.total;
    e._execs_refuros = c.refuros;
    // ALTERADO se: tem refuro OU se tem 2+ execuções (suspeito)
    e._alterada = c.total > 1;
  });
  renderEstacas();
  carregarContagemReconciliacao(obraId);
}

/* ---------- Render ---------- */
function renderEstacas(){
  // Mini-stats — contagem literal (todas as estacas cadastradas contam, incluindo BB)
  const total = _estacas.length;
  const exec  = _estacas.filter(e => e.status === "executada").length;
  const metragem = _estacas
    .filter(e => e.status === "executada")
    .reduce((s, e) => s + (Number(e.profundidade_m) || 0), 0);
  const pct = total ? Math.round((exec / total) * 100) : 0;
  $("est-stat-total").textContent      = total;
  $("est-stat-executadas").textContent = exec;
  $("est-stat-pct").textContent        = `${pct}%`;
  $("est-stat-metragem").textContent   = `${num(metragem)} m`;

  // Toggle vistas
  const wrapLista  = $("est-conteudo");
  const wrapPlanta = $("est-planta-wrap");
  if(_estView === "planta"){
    if(wrapLista)  wrapLista.style.display = "none";
    if(wrapPlanta) wrapPlanta.style.display = "";
    renderPlantaSVG();
    return;
  }
  if(wrapLista)  wrapLista.style.display = "";
  if(wrapPlanta) wrapPlanta.style.display = "none";

  const cont = wrapLista;
  if(!cont) return;

  // Filtros
  const fStatus = $("est-f-status")?.value || "";
  const fTipo   = $("est-f-tipo")?.value || "";
  const termo   = ($("est-busca")?.value || "").trim().toLowerCase();
  const filtradas = _estacas.filter(e => {
    if(fStatus && e.status !== fStatus) return false;
    if(fTipo && e.tipo !== fTipo) return false;
    if(termo){
      const alvo = `${e.numero||""} ${e.observacoes||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });

  if(!filtradas.length){
    cont.innerHTML = `<p class="vazio">${total ? "Nenhuma estaca encontrada para os filtros." : "Nenhuma estaca cadastrada. Use \"+ Nova\" ou \"📄 Importar PDF\"."}</p>`;
    return;
  }
  const linhas = filtradas.map(e => {
    const st = ESTACA_STATUS[e.status] || { label: e.status, cor: "cinza" };
    // Badge ALTERADO (estilo Maya). Prioridade:
    //   1) Alteração manual registrada (alterada_em) — sempre aparece, mesmo com 1 execução
    //   2) Tem refuro vinculado — verde
    //   3) Múltiplas execuções sem refuro — laranja "suspeito"
    let badgeAlt = "";
    if(e.alterada_em){
      const quando = new Date(e.alterada_em).toLocaleDateString("pt-BR");
      const motivo = e.alteracao_motivo || "Alteração manual";
      badgeAlt = `<span class="badge-alterado badge-alterado-suspeito" title="Alterada em ${quando} · ${esc(motivo)}">⚠️ ALTERADO</span>`;
    } else if(e._execs_refuros > 0){
      badgeAlt = `<span class="badge-alterado" title="Estaca tem ${e._execs_refuros} refuro(s) registrado(s)">🔄 REFURO</span>`;
    } else if(e._alterada){
      badgeAlt = `<span class="badge-alterado badge-alterado-suspeito" title="${e._execs_total} execuções vinculadas — verificar na Conferência">⚠️ ALTERADO</span>`;
    }
    return `<tr data-id="${esc(e.id)}">
      <td>${esc(e.numero)} ${badgeAlt}</td>
      <td>${esc(ESTACA_TIPOS[e.tipo] || e.tipo || "—")}</td>
      <td class="num">${e.diametro_mm != null ? num(e.diametro_mm) : "—"}</td>
      <td class="num">${e.profundidade_m != null ? num(e.profundidade_m) : "—"}</td>
      <td>${dataBR(e.data_execucao)}</td>
      <td><span class="tag ${st.cor}">${esc(st.label)}</span></td>
      <td class="col-acao">
        <button type="button" class="btn-sec btn-sm est-edit" data-id="${esc(e.id)}">✏️</button>
        <button type="button" class="btn-sec btn-sm est-del txt-perigo" data-id="${esc(e.id)}">🗑️</button>
      </td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nº</th><th>Tipo</th><th class="num">Ø (mm)</th><th class="num">Prof. (m)</th>
      <th>Execução</th><th>Status</th><th class="col-acao"></th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;

  cont.querySelectorAll(".est-edit").forEach(b => {
    b.addEventListener("click", () => abrirModalEstaca(b.dataset.id));
  });
  cont.querySelectorAll(".est-del").forEach(b => {
    b.addEventListener("click", () => excluirEstaca(b.dataset.id));
  });
}

/* ---------- Modal Estaca (nova / editar) ---------- */
function abrirModalEstaca(id){
  _estacaEdit = id ? _estacas.find(e => e.id === id) : null;
  const e = _estacaEdit || {};
  $("est-modal-titulo").textContent = id ? `Estaca ${e.numero}` : "Nova estaca";
  $("est-numero").value         = e.numero || "";
  $("est-tipo").value           = e.tipo || "helice_continua";
  $("est-status").value         = e.status || "prevista";
  $("est-diametro").value       = e.diametro_mm ?? "";
  $("est-profundidade").value   = e.profundidade_m ?? "";
  $("est-cota-topo").value      = e.cota_topo ?? "";
  $("est-cota-ponta").value     = e.cota_ponta ?? "";
  $("est-volume").value         = e.volume_concreto_m3 ?? "";
  $("est-data").value           = e.data_execucao || "";
  $("est-obs").value            = e.observacoes || "";
  $("est-modal").style.display = "flex";
}

function fecharModalEstaca(){
  $("est-modal").style.display = "none";
  _estacaEdit = null;
}

async function salvarEstaca(){
  if(!obraEditId){ aviso("app-aviso","Salve a obra antes de adicionar estacas.","erro"); return; }
  const numero = $("est-numero").value.trim();
  if(!numero){ aviso("app-aviso","Informe o nº da estaca.","erro"); return; }

  const reg = {
    obra_id: obraEditId,
    numero,
    tipo: $("est-tipo").value,
    status: $("est-status").value,
    diametro_mm: $("est-diametro").value !== "" ? Number($("est-diametro").value) : null,
    profundidade_m: $("est-profundidade").value !== "" ? Number($("est-profundidade").value) : null,
    cota_topo: $("est-cota-topo").value !== "" ? Number($("est-cota-topo").value) : null,
    cota_ponta: $("est-cota-ponta").value !== "" ? Number($("est-cota-ponta").value) : null,
    volume_concreto_m3: $("est-volume").value !== "" ? Number($("est-volume").value) : null,
    data_execucao: $("est-data").value || null,
    observacoes: $("est-obs").value.trim() || null
  };

  let result;
  if(_estacaEdit && _estacaEdit.id){
    result = await sb.from("estacas").update(reg).eq("id", _estacaEdit.id);
  } else {
    result = await sb.from("estacas").insert(reg);
  }
  if(result.error){
    const m = (result.error.message||"").toLowerCase();
    if(m.includes("duplicate") || m.includes("unique"))
      aviso("app-aviso","Já existe uma estaca com esse número nesta obra.","erro");
    else
      aviso("app-aviso","Não foi possível salvar: "+result.error.message,"erro");
    return;
  }
  aviso("app-aviso","Estaca salva.","ok");
  fecharModalEstaca();
  await carregarEstacasDaObra(obraEditId);
}

async function excluirEstaca(id){
  if(!confirm("Excluir esta estaca? A ação não pode ser desfeita.")) return;
  const { error } = await sb.from("estacas").delete().eq("id", id);
  if(error){ aviso("app-aviso","Não foi possível excluir: "+error.message,"erro"); return; }
  aviso("app-aviso","Estaca excluída.","ok");
  await carregarEstacasDaObra(obraEditId);
}

/* ---------- Importação via PDF ---------- */
async function importarEstacasPDF(){
  const fileInput = $("est-import-file");
  if(!fileInput.files || !fileInput.files[0]){
    aviso("app-aviso","Selecione um PDF.","erro");
    return;
  }
  if(!obraEditId){
    aviso("app-aviso","Salve a obra primeiro.","erro");
    return;
  }
  const btn = $("btn-est-extrair");
  btn.disabled = true;
  btn.textContent = "🤖 Extraindo... (~30s)";

  try {
    // Converte PDF → base64
    const file = fileInput.files[0];
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for(let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    // Chama Edge Function (extrai body mesmo em erro pra ver mensagem real)
    const { data, error } = await sb.functions.invoke("extrair-estacas-pdf", {
      body: { pdf_base64: base64, obra_id: obraEditId }
    });
    if(error){
      // supabase-js esconde o body de erro; tenta lê-lo via ctx.context
      let detalhe = error.message || "";
      try {
        if(error.context && typeof error.context.json === "function"){
          const body = await error.context.json();
          if(body){
            detalhe = body.error || JSON.stringify(body);
            if(body.sugestao) detalhe += "\n💡 " + body.sugestao;
            if(body.stop_reason) detalhe += " (motivo: " + body.stop_reason + ")";
            if(body.detalhes) detalhe += "\n" + body.detalhes;
          }
        }
      } catch(_e) { /* ignora */ }
      throw new Error(detalhe);
    }
    if(data && data.error){
      let msg = data.error;
      if(data.sugestao) msg += "\n💡 " + data.sugestao;
      throw new Error(msg);
    }

    const estacas = data.estacas || [];
    if(!estacas.length){
      aviso("app-aviso","A IA não encontrou estacas neste PDF. Tente outro arquivo ou cadastre manualmente.","erro");
      return;
    }
    _importPreview = estacas;
    // Junta aviso da heurística (se houver) às observações da IA
    let obsCombinadas = data.observacoes || "";
    if(data._aviso_confusao){
      obsCombinadas = `⚠️ ${data._aviso_confusao}\n\n${obsCombinadas}`;
    }
    renderImportPreview(obsCombinadas, data._meta);
    aviso("app-aviso", `IA extraiu ${estacas.length} estacas. Revise antes de importar.`, "ok");
  } catch(err){
    aviso("app-aviso","Erro ao extrair: " + err.message,"erro");
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 Extrair com IA";
  }
}

function renderImportPreview(observacoes, meta){
  $("est-import-preview").style.display = "";
  const obs = observacoes ? `<p style="font-size:12px;color:var(--txt-fraco);margin:0 0 8px;"><b>Notas da IA:</b> ${esc(observacoes)}</p>` : "";
  const metaTxt = meta ? `<p style="font-size:11px;color:var(--txt-sutil);margin:0 0 8px;">Modelo: ${esc(meta.modelo)} · Tokens: ${meta.tokens_input}/${meta.tokens_output}</p>` : "";

  // Conta quantas precisam de cada campo
  const semDiam = _importPreview.filter(e => e.diametro_mm == null).length;
  const semProf = _importPreview.filter(e => e.profundidade_m == null).length;
  const semTipo = _importPreview.filter(e => !e.tipo || e.tipo === "outro").length;
  const alerta = (semDiam || semProf || semTipo)
    ? `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:8px 12px;margin-bottom:10px;font-size:12px;">
        ⚠️ A IA não extraiu tudo:
        ${semDiam ? `<strong>${semDiam}</strong> sem diâmetro · ` : ""}
        ${semProf ? `<strong>${semProf}</strong> sem profundidade · ` : ""}
        ${semTipo ? `<strong>${semTipo}</strong> sem tipo definido` : ""}
        — use a barra abaixo pra aplicar valores em lote.
      </div>` : "";

  const COLUNAS_LBL = {
    numero: "Nº da estaca",
    bloco: "Bloco",
    tipo: "Tipo",
    diametro_mm: "Diâmetro (mm)",
    profundidade_m: "Profundidade (m)",
    observacoes: "Observações"
  };

  // Barra de reorganização de colunas
  const reorganizador = `
    <div style="background:#f0f7ff;border:1px solid #b6d4f5;border-radius:6px;padding:10px 12px;margin-bottom:10px;">
      <div style="font-size:12px;color:var(--marca-600);margin-bottom:8px;font-weight:600;">🔀 Reorganizar colunas (se a IA interpretou errado)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
        <div>
          <label class="meta bloco">Coluna A</label>
          <select id="reorg-a" class="col-xl">
            ${Object.entries(COLUNAS_LBL).map(([v,l],i) => `<option value="${v}" ${i===0?"selected":""}>${esc(l)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="meta bloco">Ação</label>
          <select id="reorg-acao" class="col-xl">
            <option value="swap">↔ Trocar A com B</option>
            <option value="mover">→ Mover A para B (limpa A)</option>
            <option value="copiar">⎘ Copiar A para B</option>
            <option value="limpar">🗑️ Limpar coluna A</option>
          </select>
        </div>
        <div>
          <label class="meta bloco">Coluna B</label>
          <select id="reorg-b" class="col-xl">
            ${Object.entries(COLUNAS_LBL).map(([v,l],i) => `<option value="${v}" ${i===1?"selected":""}>${esc(l)}</option>`).join("")}
          </select>
        </div>
        <button type="button" class="btn" id="btn-reorg-aplicar" style="padding:5px 12px;background:var(--marca-600);">Aplicar</button>
        <button type="button" class="btn-sec" id="btn-reorg-rapido" style="padding:5px 12px;" title="Atalho: troca Nº e Bloco">↔ Trocar Nº ↔ Bloco</button>
      </div>
    </div>`;

  // Barra de mass-edit
  const massEdit = `
    <div style="background:var(--sup-2);border:1px solid var(--borda-forte);border-radius:6px;padding:10px 12px;margin-bottom:10px;">
      <div style="font-size:12px;color:var(--txt-sec);margin-bottom:8px;font-weight:600;">📋 Aplicar a TODAS as estacas</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
        <div>
          <label class="meta bloco">Diâmetro (mm)</label>
          <input id="mass-diam" type="number" step="0.1" min="0" placeholder="ex.: 400" class="col-md"/>
        </div>
        <div>
          <label class="meta bloco">Profundidade (m)</label>
          <input id="mass-prof" type="number" step="0.01" min="0" placeholder="ex.: 14.5" class="col-md"/>
        </div>
        <div>
          <label class="meta bloco">Tipo</label>
          <select id="mass-tipo" class="col-xl">
            <option value="">— não alterar —</option>
            ${Object.entries(ESTACA_TIPOS).map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join("")}
          </select>
        </div>
        <label style="font-size:11px;color:var(--txt-fraco);display:flex;align-items:center;gap:4px;margin-bottom:6px;">
          <input type="checkbox" id="mass-so-vazios" checked />
          Só os vazios
        </label>
        <button type="button" class="btn" id="btn-mass-aplicar" style="padding:5px 12px;">Aplicar</button>
      </div>
    </div>`;

  const linhas = _importPreview.map((e, idx) => {
    const semDiamHl = e.diametro_mm == null ? 'style="background:var(--aviso-bg);"' : "";
    const semProfHl = e.profundidade_m == null ? 'style="background:var(--aviso-bg);"' : "";
    return `<tr>
      <td><input type="text" value="${esc(e.numero||"")}" data-idx="${idx}" data-field="numero" class="prev-input col-xs"/></td>
      <td><input type="text" value="${esc(e.bloco||"")}" data-idx="${idx}" data-field="bloco" class="prev-input col-xs"/></td>
      <td>
        <select data-idx="${idx}" data-field="tipo" class="prev-input">
          ${Object.entries(ESTACA_TIPOS).map(([v,l]) => `<option value="${v}" ${e.tipo===v?"selected":""}>${esc(l)}</option>`).join("")}
        </select>
      </td>
      <td ${semDiamHl}><input type="number" step="0.1" value="${esc(e.diametro_mm ?? "")}" data-idx="${idx}" data-field="diametro_mm" class="prev-input col-xs"/></td>
      <td ${semProfHl}><input type="number" step="0.01" value="${esc(e.profundidade_m ?? "")}" data-idx="${idx}" data-field="profundidade_m" class="prev-input col-xs"/></td>
      <td><input type="text" value="${esc(e.observacoes||"")}" data-idx="${idx}" data-field="observacoes" class="prev-input"/></td>
      <td><button type="button" class="btn-sec btn-sm prev-del txt-perigo" data-idx="${idx}">×</button></td>
    </tr>`;
  }).join("");

  $("est-import-preview-conteudo").innerHTML = `
    ${obs}${metaTxt}${alerta}${reorganizador}${massEdit}
    <div class="tabela-rola">
      <table>
        <thead><tr>
          <th>Nº</th><th>Bloco</th><th>Tipo</th><th>Ø (mm)</th><th>Prof. (m)</th><th>Obs.</th><th></th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
    <p style="margin-top:8px;font-size:12px;color:var(--txt-fraco);">${_importPreview.length} estacas extraídas. Edite o que precisar antes de importar. <span style="background:var(--aviso-bg);padding:1px 6px;">células amarelas</span> = campos vazios.</p>
  `;

  // listeners de edição inline
  $("est-import-preview-conteudo").querySelectorAll(".prev-input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      let v = e.target.value;
      if(field === "diametro_mm" || field === "profundidade_m") v = v !== "" ? Number(v) : null;
      _importPreview[idx][field] = v;
    });
  });
  $("est-import-preview-conteudo").querySelectorAll(".prev-del").forEach(b => {
    b.addEventListener("click", (e) => {
      _importPreview.splice(Number(e.target.dataset.idx), 1);
      renderImportPreview(observacoes, meta);
    });
  });

  // Reorganizador de colunas
  function aplicarReorg(acao, a, b){
    if(a === b && acao !== "limpar"){
      aviso("app-aviso","Escolha colunas diferentes pra A e B.","erro");
      return;
    }
    _importPreview.forEach(e => {
      const valA = e[a];
      const valB = e[b];
      if(acao === "swap"){ e[a] = valB; e[b] = valA; }
      else if(acao === "mover"){ e[b] = valA; e[a] = (a === "diametro_mm" || a === "profundidade_m") ? null : ""; }
      else if(acao === "copiar"){ e[b] = valA; }
      else if(acao === "limpar"){ e[a] = (a === "diametro_mm" || a === "profundidade_m") ? null : ""; }
    });
    const labelAcao = { swap: "Trocadas", mover: "Movidas", copiar: "Copiadas", limpar: "Limpas" }[acao];
    aviso("app-aviso", `${labelAcao} colunas em ${_importPreview.length} linhas.`, "ok");
    renderImportPreview(observacoes, meta);
  }
  $("btn-reorg-aplicar")?.addEventListener("click", () => {
    aplicarReorg($("reorg-acao").value, $("reorg-a").value, $("reorg-b").value);
  });
  $("btn-reorg-rapido")?.addEventListener("click", () => {
    aplicarReorg("swap", "numero", "bloco");
  });

  // Mass-edit
  $("btn-mass-aplicar")?.addEventListener("click", () => {
    const soVazios = $("mass-so-vazios").checked;
    const vDiam = $("mass-diam").value !== "" ? Number($("mass-diam").value) : null;
    const vProf = $("mass-prof").value !== "" ? Number($("mass-prof").value) : null;
    const vTipo = $("mass-tipo").value || null;
    if(vDiam == null && vProf == null && !vTipo){
      aviso("app-aviso","Preencha pelo menos um campo pra aplicar.","erro");
      return;
    }
    let alterados = 0;
    _importPreview.forEach(e => {
      if(vDiam != null && (!soVazios || e.diametro_mm == null)){ e.diametro_mm = vDiam; alterados++; }
      if(vProf != null && (!soVazios || e.profundidade_m == null)){ e.profundidade_m = vProf; }
      if(vTipo && (!soVazios || !e.tipo || e.tipo === "outro")){ e.tipo = vTipo; }
    });
    aviso("app-aviso", `Aplicado a ${alterados || _importPreview.length} estacas.`, "ok");
    renderImportPreview(observacoes, meta);
  });
}

async function confirmarImportEstacas(){
  if(!_importPreview.length){ aviso("app-aviso","Nada a importar.","erro"); return; }
  if(!obraEditId){ aviso("app-aviso","Obra não identificada.","erro"); return; }
  if(!confirm(`Importar ${_importPreview.length} estacas pra esta obra?`)) return;

  const regs = _importPreview
    .filter(e => e.numero)
    .map(e => ({
      obra_id: obraEditId,
      numero: normalizarNumeroEstacaEstacas(e.numero),
      tipo: e.tipo || "outro",
      status: "prevista",
      diametro_mm: e.diametro_mm ?? null,
      profundidade_m: e.profundidade_m ?? null,
      observacoes: e.bloco
        ? `Bloco ${e.bloco}${e.observacoes ? " · " + e.observacoes : ""}`
        : (e.observacoes || null)
    }));
  if(!regs.length){ aviso("app-aviso","Nenhuma estaca válida (todas sem nº).","erro"); return; }

  const { error } = await sb.from("estacas").insert(regs);
  if(error){
    aviso("app-aviso","Erro ao importar: " + error.message,"erro");
    return;
  }
  aviso("app-aviso", `${regs.length} estacas importadas com sucesso.`, "ok");
  _importPreview = [];
  fecharModalImport();
  await carregarEstacasDaObra(obraEditId);
}

function abrirModalImport(){
  if(!obraEditId){
    aviso("app-aviso","Salve a obra antes de importar estacas.","erro");
    return;
  }
  _importPreview = [];
  $("est-import-file").value = "";
  $("est-import-preview").style.display = "none";
  $("est-import-preview-conteudo").innerHTML = "";
  $("est-import-modal").style.display = "flex";
}

function fecharModalImport(){
  $("est-import-modal").style.display = "none";
  _importPreview = [];
}

/* ====================================================================
   PLANTA SVG
   ==================================================================== */

/* Extrai bloco de uma estaca (pode estar no campo bloco ou em observacoes "Bloco X · ...") */
function extrairBloco(e){
  if(e.bloco) return e.bloco;
  const obs = e.observacoes || "";
  const m = obs.match(/Bloco\s+([A-Z0-9\-_.]+)/i);
  return m ? m[1] : "";
}

/* Gera posições em grid agrupando por bloco quando estacas não têm coordenadas */
function gerarGridParaSemCoords(estacas){
  // Agrupa por bloco
  const blocos = {};
  estacas.forEach(e => {
    const k = extrairBloco(e) || "_SEM_BLOCO";
    if(!blocos[k]) blocos[k] = [];
    blocos[k].push(e);
  });
  const nomesBlocos = Object.keys(blocos).sort();
  const numBlocos = nomesBlocos.length;

  // Layout: distribui blocos numa grade (até 3 colunas) e dentro do bloco as estacas em mini-grid
  const VIEW_W = 600, VIEW_H = 400;
  const PADDING = 25;
  const colsB = Math.min(3, numBlocos);
  const rowsB = Math.ceil(numBlocos / colsB);
  const blocoW = (VIEW_W - PADDING * 2) / colsB;
  const blocoH = (VIEW_H - PADDING * 2) / rowsB;

  const posicoes = new Map(); // id -> {x, y, blocoNome, blocoOriginX, blocoOriginY, blocoW, blocoH}

  nomesBlocos.forEach((nome, bIdx) => {
    const estsBloco = blocos[nome];
    const bCol = bIdx % colsB;
    const bRow = Math.floor(bIdx / colsB);
    const x0 = PADDING + bCol * blocoW;
    const y0 = PADDING + bRow * blocoH;
    const innerPad = 18;
    const inW = blocoW - innerPad * 2;
    const inH = blocoH - innerPad * 2 - 12; // -12 pro título do bloco
    const n = estsBloco.length;
    const cols = Math.ceil(Math.sqrt(n * (inW / Math.max(inH, 1))));
    const rows = Math.ceil(n / cols);
    const stepX = cols > 1 ? inW / (cols - 1) : 0;
    const stepY = rows > 1 ? inH / (rows - 1) : 0;
    estsBloco.forEach((e, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = x0 + innerPad + (cols === 1 ? inW/2 : c * stepX);
      const y = y0 + innerPad + 12 + (rows === 1 ? inH/2 : r * stepY);
      posicoes.set(e.id, { x, y, blocoNome: nome === "_SEM_BLOCO" ? "" : nome,
        blocoOriginX: x0, blocoOriginY: y0, blocoW, blocoH });
    });
  });
  return posicoes;
}

function renderPlantaSVG(){
  const svg = $("est-planta-svg");
  if(!svg) return;
  const ns = "http://www.w3.org/2000/svg";

  // Aplica filtros (mesma lógica que a lista)
  const fStatus = $("est-f-status")?.value || "";
  const fTipo   = $("est-f-tipo")?.value || "";
  const termo   = ($("est-busca")?.value || "").trim().toLowerCase();
  const filtradas = _estacas.filter(e => {
    if(fStatus && e.status !== fStatus) return false;
    if(fTipo && e.tipo !== fTipo) return false;
    if(termo){
      const alvo = `${e.numero||""} ${e.observacoes||""}`.toLowerCase();
      if(!alvo.includes(termo)) return false;
    }
    return true;
  });

  svg.innerHTML = "";

  // Grupo que carrega o transform pan/zoom
  const g = document.createElementNS(ns, "g");
  g.setAttribute("id", "planta-g");
  g.setAttribute("transform", `translate(${_plantaState.panX}, ${_plantaState.panY}) scale(${_plantaState.zoom})`);
  svg.appendChild(g);

  const semCoords = filtradas.filter(e => e.pos_x == null || e.pos_y == null);
  let grid = null;
  let usandoGrid = false;
  if(semCoords.length && semCoords.length === filtradas.length){
    // todas sem coords: usa grid pra todas
    grid = gerarGridParaSemCoords(filtradas);
    usandoGrid = true;
  } else if(semCoords.length){
    // mistura: grid só pras sem coord (posiciona no rodapé)
    grid = gerarGridParaSemCoords(semCoords);
  }

  if(!filtradas.length){
    const txt = document.createElementNS(ns, "text");
    txt.setAttribute("class", "sem-coordenadas");
    txt.setAttribute("x", "300");
    txt.setAttribute("y", "200");
    txt.textContent = "Nenhuma estaca pra mostrar.";
    g.appendChild(txt);
  }

  // Se usando grid, desenha contornos dos blocos
  if(usandoGrid){
    const blocosVistos = new Set();
    grid.forEach(p => {
      if(blocosVistos.has(p.blocoNome)) return;
      blocosVistos.add(p.blocoNome);
      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", p.blocoOriginX + 6);
      rect.setAttribute("y", p.blocoOriginY + 6);
      rect.setAttribute("width", p.blocoW - 12);
      rect.setAttribute("height", p.blocoH - 12);
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", "#cfd8e3");
      rect.setAttribute("stroke-dasharray", "3 3");
      rect.setAttribute("rx", 4);
      g.appendChild(rect);
      if(p.blocoNome){
        const lbl = document.createElementNS(ns, "text");
        lbl.setAttribute("x", p.blocoOriginX + 12);
        lbl.setAttribute("y", p.blocoOriginY + 18);
        lbl.setAttribute("font-size", "9");
        lbl.setAttribute("fill", "#5a6b7d");
        lbl.setAttribute("font-weight", "600");
        lbl.textContent = p.blocoNome;
        g.appendChild(lbl);
      }
    });
  }

  const hoje = hojeISO();

  // Desenha cada estaca (com coords reais OU do grid)
  filtradas.forEach(e => {
    let x, y;
    if(e.pos_x != null && e.pos_y != null){
      x = e.pos_x; y = e.pos_y;
    } else if(grid && grid.has(e.id)){
      const p = grid.get(e.id);
      x = p.x; y = p.y;
    } else {
      return;
    }
    // adapta o objeto pra função interna que espera pos_x/pos_y
    desenharEstaca(g, ns, e, x, y, hoje);
  });

  // Atualiza barra de progresso (sobre o que está filtrado)
  const total = filtradas.length;
  const exec = filtradas.filter(e => e.status === "executada").length;
  const pct = total ? Math.round((exec/total) * 100) : 0;
  const fill = $("planta-progresso-fill");
  if(fill) fill.style.width = pct + "%";
  const txt = $("planta-progresso-texto");
  if(txt){
    let extra = "";
    if(usandoGrid) extra = " · 📐 posições em grid (planta original sem coordenadas)";
    else if(semCoords.length) extra = ` · ${semCoords.length} sem coords no grid auxiliar`;
    txt.textContent = `${exec} de ${total} executadas (${pct}%)${extra}`;
  }
}

function desenharEstaca(g, ns, e, x, y, hoje){
  const ehHoje = (e.data_execucao === hoje);
  const cor = ehHoje ? COR_HOJE : (COR_STATUS[e.status] || "var(--txt-sutil)");
  const circ = document.createElementNS(ns, "circle");
  circ.setAttribute("class", "estaca-circ");
  circ.setAttribute("cx", x);
  circ.setAttribute("cy", y);
  circ.setAttribute("r", 11);
  // via style, e não setAttribute: atributo de apresentação do SVG ignora tokens CSS
  circ.style.fill = cor;
  circ.style.stroke = "var(--sup-0)";
  circ.style.strokeWidth = "1.5";
  circ.dataset.id = e.id;
  g.appendChild(circ);

  const label = document.createElementNS(ns, "text");
  label.setAttribute("class", "estaca-label");
  label.setAttribute("x", x);
  label.setAttribute("y", y);
  const so_num = (e.numero || "").replace(/\D/g, "").slice(-3);
  label.textContent = so_num || (e.numero || "").slice(0,3);
  g.appendChild(label);

  circ.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalExecucao(e.id);
  });
  circ.addEventListener("mouseenter", (ev) => mostrarTooltipPlanta(ev, e));
  circ.addEventListener("mouseleave", esconderTooltipPlanta);
}

/* ---------- Tooltip ---------- */
function mostrarTooltipPlanta(ev, e){
  let tip = $("est-planta-tooltip");
  if(!tip){
    tip = document.createElement("div");
    tip.id = "est-planta-tooltip";
    $("est-planta-svg-container").appendChild(tip);
  }
  const tipoLbl = ESTACA_TIPOS[e.tipo] || e.tipo || "—";
  const stLbl = (ESTACA_STATUS[e.status] || {}).label || e.status;
  tip.innerHTML = `<strong>${esc(e.numero)}</strong> · ${esc(stLbl)}<br>
    ${esc(tipoLbl)} · Ø ${e.diametro_mm || "?"}mm · ${e.profundidade_m || "?"}m
    ${e.data_execucao ? "<br>Exec: " + dataBR(e.data_execucao) : ""}`;
  const cont = $("est-planta-svg-container").getBoundingClientRect();
  tip.style.left = (ev.clientX - cont.left + 12) + "px";
  tip.style.top  = (ev.clientY - cont.top  + 12) + "px";
}
function esconderTooltipPlanta(){
  const tip = $("est-planta-tooltip");
  if(tip) tip.remove();
}

/* ---------- Pan & Zoom ---------- */
function aplicarPlantaTransform(){
  const g = document.getElementById("planta-g");
  if(g) g.setAttribute("transform",
    `translate(${_plantaState.panX}, ${_plantaState.panY}) scale(${_plantaState.zoom})`);
}
function plantaZoom(delta, cx, cy){
  const novo = Math.max(0.5, Math.min(5, _plantaState.zoom + delta));
  if(cx != null && cy != null){
    // mantém o ponto sob o cursor estável
    _plantaState.panX = cx - (cx - _plantaState.panX) * (novo / _plantaState.zoom);
    _plantaState.panY = cy - (cy - _plantaState.panY) * (novo / _plantaState.zoom);
  }
  _plantaState.zoom = novo;
  aplicarPlantaTransform();
}
function plantaZoomFit(){
  _plantaState = { zoom: 1, panX: 0, panY: 0 };
  aplicarPlantaTransform();
}

function configurarPanZoom(){
  const svg = $("est-planta-svg");
  if(!svg || svg.dataset.panzoom === "1") return;
  svg.dataset.panzoom = "1";

  let dragging = false, lastX = 0, lastY = 0;
  svg.addEventListener("mousedown", (e) => {
    if(e.target.classList && e.target.classList.contains("estaca-circ")) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mousemove", (e) => {
    if(!dragging) return;
    _plantaState.panX += (e.clientX - lastX);
    _plantaState.panY += (e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    aplicarPlantaTransform();
  });
  window.addEventListener("mouseup", () => { dragging = false; });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    plantaZoom(e.deltaY < 0 ? 0.15 : -0.15, cx, cy);
  }, { passive: false });

  // Touch (mobile) - pan com 1 dedo, pinch com 2
  let touchStart = null, pinchDist = null;
  svg.addEventListener("touchstart", (e) => {
    if(e.touches.length === 1){
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if(e.touches.length === 2){
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchDist = Math.sqrt(dx*dx + dy*dy);
    }
  }, { passive: true });
  svg.addEventListener("touchmove", (e) => {
    if(e.touches.length === 1 && touchStart){
      const dx = e.touches[0].clientX - touchStart.x;
      const dy = e.touches[0].clientY - touchStart.y;
      _plantaState.panX += dx;
      _plantaState.panY += dy;
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      aplicarPlantaTransform();
    } else if(e.touches.length === 2 && pinchDist){
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const nova = Math.sqrt(dx*dx + dy*dy);
      const delta = (nova - pinchDist) * 0.005;
      pinchDist = nova;
      _plantaState.zoom = Math.max(0.5, Math.min(5, _plantaState.zoom + delta));
      aplicarPlantaTransform();
    }
  }, { passive: true });
  svg.addEventListener("touchend", () => { touchStart = null; pinchDist = null; });
}

/* ====================================================================
   MODAL DE EXECUÇÃO RÁPIDA (clique na bolinha da planta)
   ==================================================================== */

async function carregarAuxiliaresExec(){
  if(_estacaFuncs.length && _estacaEquips.length) return;
  const [f, eq] = await Promise.all([
    sb.from("funcionarios").select("id,nome").eq("ativo", true).order("nome"),
    sb.from("equipamentos").select("id,codigo,nome").eq("ativo", true).order("codigo")
  ]);
  _estacaFuncs = f.data || [];
  _estacaEquips = eq.data || [];
  // popula selects
  $("exec-equipamento").innerHTML = `<option value="">— nenhum —</option>` +
    _estacaEquips.map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome)}</option>`).join("");
  $("exec-operador").innerHTML = `<option value="">— nenhum —</option>` +
    _estacaFuncs.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`).join("");
}

async function abrirModalExecucao(id){
  await carregarAuxiliaresExec();
  const e = _estacas.find(x => x.id === id);
  if(!e) return;
  _estExecId = id;
  $("exec-titulo").textContent = e.numero || "(sem nº)";
  const tipoLbl = ESTACA_TIPOS[e.tipo] || e.tipo || "—";
  $("exec-resumo").innerHTML = `
    <strong>${esc(tipoLbl)}</strong>
    · Ø ${e.diametro_mm || "—"}mm
    · projeto ${e.profundidade_m || "?"}m
    ${e.observacoes ? "<br>" + esc(e.observacoes) : ""}
  `;
  $("exec-status").value = e.status || "prevista";
  $("exec-data").value = e.data_execucao || hojeISO();
  $("exec-profundidade").value = e.profundidade_m ?? "";
  $("exec-volume").value = e.volume_concreto_m3 ?? "";
  $("exec-equipamento").value = e.equipamento_id || "";
  $("exec-operador").value = e.operador_id || "";
  $("exec-obs").value = e.observacoes || "";
  $("est-exec-modal").style.display = "flex";
}

function fecharModalExecucao(){
  $("est-exec-modal").style.display = "none";
  _estExecId = null;
}

async function salvarExecucao(novoStatus){
  if(!_estExecId) return;
  const reg = {
    status: novoStatus || $("exec-status").value,
    data_execucao: $("exec-data").value || null,
    profundidade_m: $("exec-profundidade").value !== "" ? Number($("exec-profundidade").value) : null,
    volume_concreto_m3: $("exec-volume").value !== "" ? Number($("exec-volume").value) : null,
    equipamento_id: $("exec-equipamento").value || null,
    operador_id: $("exec-operador").value || null,
    observacoes: $("exec-obs").value.trim() || null
  };
  const { error } = await sb.from("estacas").update(reg).eq("id", _estExecId);
  if(error){ aviso("app-aviso","Erro ao salvar: "+error.message,"erro"); return; }
  aviso("app-aviso", `Estaca ${(_estacas.find(e=>e.id===_estExecId)||{}).numero || ""} atualizada.`, "ok");
  fecharModalExecucao();
  await carregarEstacasDaObra(obraEditId);
}

/* ====================================================================
   RECONCILIAÇÃO DE ESTACAS ÓRFÃS (execuções sem estaca vinculada)
   ==================================================================== */

let _recOrfas = [];      // execuções órfãs
let _recPrevs = [];      // estacas previstas da obra
let _recVinculos = {};   // { execucao_id: estaca_id_escolhida }
let _confDuplicadas = []; // grupos: [{ numero, estacas:[...] }, ...]
let _confRefuradas = [];  // estacas com status='refurada'
let _confAlteradas = [];  // estacas com 2+ execuções: [{ estaca, execs:[...] }]
let _confAbaAtual = "orfas";

async function carregarContagemReconciliacao(obraId){
  const btn = $("btn-est-reconciliar");
  if(!btn) return;
  // Botão sempre visível quando há obra carregada — permite conferência preventiva
  if(!obraId){ btn.style.display = "none"; return; }
  btn.style.display = "";

  // Conta os 3 tipos de problemas em paralelo
  const [orfasRes, estsRes] = await Promise.all([
    sb.from("rdo_execucao_estaca").select("id, rdo:rdo_id(obra_id)").is("estaca_id", null),
    sb.from("estacas").select("numero,status").eq("obra_id", obraId)
  ]);
  const orfas = (orfasRes.data || []).filter(r => r.rdo && r.rdo.obra_id === obraId);
  const ests = estsRes.data || [];
  // Duplicadas: grupos com mesmo número literal
  const cont = {};
  ests.forEach(e => {
    const k = (e.numero||"").trim().toUpperCase();
    cont[k] = (cont[k]||0) + 1;
  });
  const dups = Object.values(cont).filter(c => c > 1).reduce((s,c) => s + c, 0);
  // Refuradas
  const refs = ests.filter(e => e.status === "refurada").length;

  const total = orfas.length + dups + refs;
  const badge = $("est-reconciliar-badge");
  if(total){
    // Há pendências: badge vermelho com número
    if(badge){
      badge.textContent = total;
      badge.style.display = "";
      badge.style.background = "var(--perigo)";
    }
  } else {
    // Tudo certo: badge verde com ✓ (botão ainda permite abrir pra ver o estado)
    if(badge){
      badge.textContent = "✓";
      badge.style.display = "";
      badge.style.background = "var(--sucesso)";
    }
  }
}

async function abrirModalReconciliacao(){
  if(!obraEditId){ aviso("app-aviso","Salve a obra primeiro.","erro"); return; }
  ["est-reconciliar-conteudo","conf-alteradas-conteudo","conf-duplicadas-conteudo","conf-refuradas-conteudo"].forEach(id => {
    const el = $(id); if(el) el.innerHTML = `<p class="vazio">Carregando...</p>`;
  });
  $("est-reconciliar-modal").style.display = "flex";

  // Busca tudo em paralelo
  const [orfasRes, estsRes, todasExecsRes] = await Promise.all([
    sb.from("rdo_execucao_estaca")
      .select("id, estaca_numero, perfuracao_inicio, profundidade_executada, equipamento_id, rdo:rdo_id(obra_id)")
      .is("estaca_id", null),
    sb.from("estacas")
      .select("id, numero, tipo, diametro_mm, profundidade_m, status, data_execucao, observacoes")
      .eq("obra_id", obraEditId)
      .order("numero"),
    sb.from("rdo_execucao_estaca")
      .select("id, estaca_id, estaca_numero, perfuracao_inicio, profundidade_executada, volume_concreto_m3, modalidade_execucao, rdo:rdo_id(obra_id, data)")
      .not("estaca_id", "is", null)
  ]);

  // Tratamento de erro visível (antes era silencioso e zerava _recPrevs)
  if(orfasRes.error){ aviso("app-aviso","Erro ao carregar órfãs: "+orfasRes.error.message,"erro"); }
  if(estsRes.error){ aviso("app-aviso","Erro ao carregar previstas: "+estsRes.error.message,"erro"); }

  const orfas = (orfasRes.data || []).filter(r => r.rdo && r.rdo.obra_id === obraEditId);
  const previstas = estsRes.data || [];

  _recOrfas = orfas;
  _recPrevs = previstas;
  _recVinculos = {};

  // Detecta duplicadas: agrupa pelo nome LITERAL (UPPER + trim).
  // BB1.1 e B1.1 são estacas distintas — não agrupamos.
  const grupos = {};
  previstas.forEach(e => {
    const k = (e.numero||"").trim().toUpperCase();
    if(!grupos[k]) grupos[k] = [];
    grupos[k].push(e);
  });
  _confDuplicadas = Object.entries(grupos)
    .filter(([_, ests]) => ests.length > 1)
    .map(([num, ests]) => ({ numero: num, estacas: ests }));

  // Refuradas
  _confRefuradas = previstas.filter(e => e.status === "refurada");

  // Estacas alteradas (2+ execuções) — agrupar todas execs por estaca_id e filtrar
  const execsDestaObra = (todasExecsRes.data || []).filter(e => e.rdo && e.rdo.obra_id === obraEditId);
  const porEstaca = {};
  execsDestaObra.forEach(re => {
    if(!porEstaca[re.estaca_id]) porEstaca[re.estaca_id] = [];
    porEstaca[re.estaca_id].push(re);
  });
  _confAlteradas = Object.entries(porEstaca)
    .filter(([_, execs]) => execs.length > 1)
    .map(([estId, execs]) => {
      const estaca = previstas.find(p => p.id === estId);
      // Ordena por data (mais antiga primeiro)
      execs.sort((a,b) => (a.perfuracao_inicio||"").localeCompare(b.perfuracao_inicio||""));
      return { estaca, execs };
    })
    .filter(g => g.estaca); // ignora se a estaca já foi deletada

  // Atualiza badges das abas
  atualizarBadgesConferencia();
  // Renderiza tudo
  renderizarReconciliacao();
  renderizarAlteradas();
  renderizarDuplicadas();
  renderizarRefuradas();
  ativarConfAba(_confAbaAtual);
}

function atualizarBadgesConferencia(){
  const set = (id, n) => {
    const el = $(id);
    if(!el) return;
    el.textContent = n || "";
    el.classList.toggle("zero", n === 0);
  };
  set("conf-tab-orfas-badge", _recOrfas.length);
  set("conf-tab-alt-badge",  _confAlteradas.filter(g => g.execs.some(e => e.modalidade_execucao !== "refuro")).length); // só conta as suspeitas (sem refuro explícito)
  set("conf-tab-dups-badge", _confDuplicadas.reduce((s,g) => s + g.estacas.length, 0));
  set("conf-tab-ref-badge", _confRefuradas.length);
}

function ativarConfAba(nome){
  _confAbaAtual = nome;
  document.querySelectorAll("#conf-notebook button").forEach(b => {
    b.classList.toggle("ativo", b.dataset.confTab === nome);
  });
  document.querySelectorAll("#est-reconciliar-modal .odoo-tab").forEach(t => {
    t.classList.toggle("ativa", t.dataset.confTab === nome);
  });
  renderizarAcoesRodape(nome);
}

function renderizarAcoesRodape(aba){
  const rodape = $("conf-acoes-rodape");
  if(!rodape) return;
  if(aba === "orfas"){
    rodape.innerHTML = `
      <button type="button" class="btn-sec" id="btn-est-rec-aplicar-sugestoes" title="Pré-seleciona a sugestão Top em cada linha (você ainda precisa confirmar)">✨ Aplicar todas as sugestões</button>
      <button type="button" class="btn-sec" id="btn-est-rec-criar-todas" title="Cria as estacas previstas que faltam e vincula as execuções correspondentes">➕ Criar todas as previstas faltantes</button>
      <button type="button" class="btn" id="btn-est-rec-confirmar" style="background:var(--sucesso);">✅ Confirmar vínculos selecionados</button>
    `;
    $("btn-est-rec-aplicar-sugestoes")?.addEventListener("click", aplicarTodasSugestoes);
    $("btn-est-rec-criar-todas")?.addEventListener("click", criarTodasPrevistasFaltantes);
    $("btn-est-rec-confirmar")?.addEventListener("click", confirmarReconciliacao);
  } else if(aba === "alteradas"){
    rodape.innerHTML = `<p style="font-size:11px;color:var(--txt-sutil);margin:0;">Use as ações em cada execução extra: ↻ marcar como refuro (legítimo) ou → realocar para outra estaca prevista.</p>`;
  } else if(aba === "duplicadas"){
    rodape.innerHTML = `<p style="font-size:11px;color:var(--txt-sutil);margin:0;">Use as ações em cada grupo (manter / excluir / renomear).</p>`;
  } else if(aba === "refuradas"){
    rodape.innerHTML = `<p style="font-size:11px;color:var(--txt-sutil);margin:0;">Use as ações em cada estaca refurada.</p>`;
  }
}

function fecharModalReconciliacao(){
  $("est-reconciliar-modal").style.display = "none";
}

function renderizarReconciliacao(){
  const cont = $("est-reconciliar-conteudo");
  if(!cont) return;

  if(!_recOrfas.length){
    cont.innerHTML = `<p class="vazio">🎉 Não há execuções órfãs nesta obra.</p>`;
    return;
  }

  // Aviso útil quando não há previstas — não bloqueia, só orienta
  const semPrevistas = !_recPrevs.length;
  const avisoSemPrev = semPrevistas
    ? `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:12px;">
        ⚠️ Esta obra não tem estacas previstas cadastradas.
        Você pode <strong>criar cada estaca individualmente</strong> (botão <strong>+ Criar</strong> em cada linha)
        ou <strong>todas de uma vez</strong> com o botão verde do rodapé.
       </div>`
    : "";

  // Pra cada órfã, calcula sugestões e pré-seleciona a melhor
  const linhas = _recOrfas.map(o => {
    const sugs = _recPrevs
      .map(p => ({ p, score: scoreSimilaridade(o.estaca_numero, p.numero) }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0, 5);

    const optionsSugs = sugs.map(({p, score}) => {
      const exec = p.status==='executada' ? " ⚠ já executada" : "";
      const stars = score >= 0.9 ? "★★★" : score >= 0.6 ? "★★" : "★";
      const pct = (score*100).toFixed(0);
      return `<option value="${esc(p.id)}">${stars} ${esc(p.numero)} — ${pct}%${exec}</option>`;
    }).join("");

    const optionsTodas = _recPrevs
      .filter(p => !sugs.find(s => s.p.id === p.id))
      .map(p => {
        const exec = p.status==='executada' ? " ⚠ já executada" : "";
        return `<option value="${esc(p.id)}">${esc(p.numero)}${exec}</option>`;
      }).join("");

    const sugestaoTop = sugs[0];
    const sugId = sugestaoTop?.p.id || "";
    const data = o.perfuracao_inicio ? new Date(o.perfuracao_inicio).toLocaleDateString("pt-BR") : "";

    // Badge de confiança ao lado do select
    const badge = sugestaoTop
      ? `<span class="rec-badge rec-badge-${sugestaoTop.score >= 0.9 ? "alta" : sugestaoTop.score >= 0.6 ? "media" : "baixa"}" title="Confiança da sugestão">${(sugestaoTop.score*100).toFixed(0)}%</span>`
      : `<span class="rec-badge rec-badge-zero" title="Nenhuma estaca prevista parecida">sem match</span>`;

    return `<tr data-orfa-id="${esc(o.id)}">
      <td><strong>${esc(o.estaca_numero)}</strong><br><small style="color:var(--txt-sutil);">${esc(data)}</small></td>
      <td class="num">${num(o.profundidade_executada || 0)} m</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;">
          <select class="rec-select" data-orfa-id="${esc(o.id)}" data-sugestao="${esc(sugId)}" style="flex:1;min-width:0;">
            <option value="">— não vincular —</option>
            ${optionsSugs ? `<optgroup label="🤖 Sugestões automáticas">${optionsSugs}</optgroup>` : ""}
            ${optionsTodas ? `<optgroup label="Outras estacas previstas">${optionsTodas}</optgroup>` : ""}
          </select>
          ${badge}
        </div>
      </td>
      <td class="col-acao" style="white-space:nowrap;text-align:right;">
        <button type="button" class="btn btn-sm btn-rec-vincular" data-orfa-id="${esc(o.id)}" style="background:var(--sucesso);" title="Vincular à estaca selecionada no select">✓ Vincular</button>
        <button type="button" class="btn-sec btn-sm btn-rec-criar" data-orfa-id="${esc(o.id)}" data-numero="${esc(o.estaca_numero)}" data-prof="${esc(o.profundidade_executada||'')}" title="Criar estaca prevista com o nome '${esc(o.estaca_numero)}' e vincular">+ Criar</button>
      </td>
    </tr>`;
  }).join("");

  cont.innerHTML = `
    <div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:10px 14px;margin-bottom:10px;font-size:12px;">
      ⚠️ <strong>${_recOrfas.length} execução(ões) órfã(s)</strong> nesta obra · <strong>${_recPrevs.length}</strong> estacas previstas no projeto
    </div>
    ${avisoSemPrev}
    <div class="tabela-rola">
      <table>
        <thead><tr>
          <th style="width:18%;">Execução (CSV)</th>
          <th class="num" style="width:12%;">Prof. exec.</th>
          <th>Sugestão · vincular a</th>
          <th class="col-acao" style="width:200px;text-align:right;">Ações</th>
        </tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;

  // Pré-seleciona a sugestão top em cada linha (UX: economiza um clique)
  cont.querySelectorAll(".rec-select").forEach(sel => {
    const sug = sel.dataset.sugestao;
    if(sug){ sel.value = sug; _recVinculos[sel.dataset.orfaId] = sug; }
  });

  cont.querySelectorAll(".rec-select").forEach(sel => {
    sel.addEventListener("change", () => {
      _recVinculos[sel.dataset.orfaId] = sel.value || null;
      destacarConflitosVinculacao();
    });
  });
  // Roda uma vez já após renderizar (caso pré-seleção tenha gerado conflitos)
  destacarConflitosVinculacao();
  cont.querySelectorAll(".btn-rec-vincular").forEach(b => {
    b.addEventListener("click", () => vincularIndividual(b.dataset.orfaId));
  });
  cont.querySelectorAll(".btn-rec-criar").forEach(b => {
    b.addEventListener("click", () => criarPrevistaDaOrfa(b.dataset.orfaId, b.dataset.numero, b.dataset.prof));
  });
}

async function vincularIndividual(orfaId){
  const sel = document.querySelector(`.rec-select[data-orfa-id="${orfaId}"]`);
  const estacaId = sel?.value;
  if(!estacaId){
    aviso("app-aviso","Escolha uma estaca no select antes de vincular.","erro");
    return;
  }
  const { error } = await sb.from("rdo_execucao_estaca")
    .update({ estaca_id: estacaId })
    .eq("id", orfaId);
  if(error){ aviso("app-aviso","Erro ao vincular: "+error.message,"erro"); return; }
  aviso("app-aviso","Execução vinculada.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function criarPrevistaDaOrfa(orfaId, numero, profundidade){
  if(!obraEditId) return;
  const nomeNorm = normalizarNumeroEstacaEstacas(numero);
  // Verifica se já existe (pode ter sido criada por outra órfã na mesma sessão)
  const { data: existente } = await sb.from("estacas")
    .select("id").eq("obra_id", obraEditId)
    .ilike("numero", nomeNorm).maybeSingle();
  let estacaId;
  if(existente){
    estacaId = existente.id;
  } else {
    const reg = {
      obra_id: obraEditId,
      numero: nomeNorm,
      tipo: "helice_continua",  // default razoável; user ajusta depois
      status: "prevista",
      profundidade_m: profundidade ? Number(profundidade) : null,
      observacoes: "Criada automaticamente a partir de execução CSV"
    };
    const { data: novo, error } = await sb.from("estacas").insert(reg).select("id").single();
    if(error){
      aviso("app-aviso","Erro ao criar estaca: "+error.message,"erro");
      return;
    }
    estacaId = novo.id;
  }
  // Vincula a execução
  const { error: errVinc } = await sb.from("rdo_execucao_estaca")
    .update({ estaca_id: estacaId })
    .eq("id", orfaId);
  if(errVinc){ aviso("app-aviso","Estaca criada mas erro ao vincular: "+errVinc.message,"erro"); return; }
  aviso("app-aviso", `Estaca ${nomeNorm} criada e vinculada.`, "ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function criarTodasPrevistasFaltantes(){
  if(!_recOrfas.length){ aviso("app-aviso","Sem órfãs.","erro"); return; }
  if(!confirm(`Criar ${_recOrfas.length} estacas previstas a partir das execuções e vincular todas? Tipo default: hélice contínua.`)) return;

  const btn = $("btn-est-rec-criar-todas");
  if(btn){ btn.disabled = true; btn.textContent = "Criando..."; }

  let criadas = 0, vinculadas = 0;
  for(const o of _recOrfas){
    const nomeNorm = normalizarNumeroEstacaEstacas(o.estaca_numero);
    // Verifica/cria
    const { data: existente } = await sb.from("estacas")
      .select("id").eq("obra_id", obraEditId)
      .ilike("numero", nomeNorm).maybeSingle();
    let estacaId;
    if(existente){
      estacaId = existente.id;
    } else {
      const { data: novo, error } = await sb.from("estacas").insert({
        obra_id: obraEditId,
        numero: nomeNorm,
        tipo: "helice_continua",
        status: "prevista",
        profundidade_m: o.profundidade_executada ? Number(o.profundidade_executada) : null,
        observacoes: "Criada automaticamente a partir de execução CSV"
      }).select("id").single();
      if(error) continue;
      estacaId = novo.id;
      criadas++;
    }
    const { error: errV } = await sb.from("rdo_execucao_estaca")
      .update({ estaca_id: estacaId })
      .eq("id", o.id);
    if(!errV) vinculadas++;
  }

  aviso("app-aviso", `✅ ${criadas} estacas criadas e ${vinculadas} execuções vinculadas.`, "ok");
  fecharModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

function aplicarTodasSugestoes(){
  document.querySelectorAll(".rec-select").forEach(sel => {
    const sug = sel.dataset.sugestao;
    if(sug){
      sel.value = sug;
      _recVinculos[sel.dataset.orfaId] = sug;
    }
  });
  destacarConflitosVinculacao();
  const total = Object.values(_recVinculos).filter(Boolean).length;
  const conflitos = contarConflitosVinculacao();
  if(conflitos > 0){
    aviso("app-aviso", `⚠️ ${total} sugestões aplicadas, mas ${conflitos} execuções estão competindo pela mesma estaca — linhas em vermelho. Ajuste antes de confirmar.`, "erro");
  } else {
    aviso("app-aviso", `${total} sugestões aplicadas. Confira antes de confirmar.`, "ok");
  }
}

/* Conta quantas execuções estão apontando pra uma estaca que outra execução também aponta */
function contarConflitosVinculacao(){
  const cont = {};
  Object.values(_recVinculos).forEach(v => { if(v){ cont[v] = (cont[v]||0) + 1; } });
  let conflitos = 0;
  Object.values(cont).forEach(n => { if(n > 1) conflitos += n; });
  return conflitos;
}

/* Marca em vermelho as linhas cujo select aponta pra mesma estaca que outra(s) linha(s) */
function destacarConflitosVinculacao(){
  const cont = {};
  Object.entries(_recVinculos).forEach(([orfa, est]) => {
    if(!est) return;
    if(!cont[est]) cont[est] = [];
    cont[est].push(orfa);
  });
  document.querySelectorAll("tr[data-orfa-id]").forEach(tr => {
    tr.style.background = "";
    tr.title = "";
  });
  Object.entries(cont).forEach(([est, orfas]) => {
    if(orfas.length <= 1) return;
    orfas.forEach(orfa => {
      const tr = document.querySelector(`tr[data-orfa-id="${orfa}"]`);
      if(tr){
        tr.style.background = "var(--perigo-bg)";
        tr.title = `⚠️ Conflito: ${orfas.length} execuções apontam pra esta mesma estaca`;
      }
    });
  });
}

/* Move TODOS os RDOs desta obra (com órfãs) pra outra obra e recasa via RPC. */
async function moverExecucoesPraOutraObra(){
  const novaObraId = $("conf-mover-obra")?.value;
  if(!novaObraId){ aviso("app-aviso","Escolha a obra de destino.","erro"); return; }
  if(!confirm(`Mover todos os RDOs (e execuções) desta obra pra "${mapaObras[novaObraId]}"?\n\nVai recasar estacas automaticamente após o move.`)) return;

  // 1. Move todos os RDOs pra nova obra
  const { data: rdos, error: errRdo } = await sb.from("rdo").select("id").eq("obra_id", obraEditId);
  if(errRdo || !rdos || !rdos.length){
    aviso("app-aviso","Não foi possível listar RDOs desta obra.","erro");
    return;
  }
  const { error: errMove } = await sb.from("rdo")
    .update({ obra_id: novaObraId })
    .in("id", rdos.map(r => r.id));
  if(errMove){ aviso("app-aviso","Erro ao mover: "+errMove.message,"erro"); return; }

  // 2. Chama a RPC pra limpar estaca_id (que apontava pra obra antiga) e recasar com a nova
  const { data: result, error: errRpc } = await sb.rpc("recasar_execucoes_obra", { p_obra_id: novaObraId });
  if(errRpc){
    aviso("app-aviso", `Movidos ${rdos.length} RDOs, mas erro ao recasar: ${errRpc.message}`, "erro");
    return;
  }

  const vinc = result?.vinculadas ?? 0;
  const ests = result?.estacas_atualizadas ?? 0;
  aviso("app-aviso",
    `✅ ${rdos.length} RDO(s) movidos para "${mapaObras[novaObraId]}". ${vinc} execução(ões) vinculada(s), ${ests} estaca(s) atualizada(s).`,
    "ok");
  fecharModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

/* ====================================================================
   ABA ALTERADAS — estacas com 2+ execuções (refuros legítimos OU mal-casadas)
   ==================================================================== */

function renderizarAlteradas(){
  const cont = $("conf-alteradas-conteudo");
  if(!cont) return;
  if(!_confAlteradas.length){
    cont.innerHTML = `<p class="vazio">🎉 Todas as estacas têm execução única ou são refuros marcados corretamente.</p>`;
    return;
  }

  const linhas = _confAlteradas.map(g => {
    const todasRefuro = g.execs.every(e => e.modalidade_execucao === "refuro" || g.execs.indexOf(e) === 0);
    const algumRefuro = g.execs.some(e => e.modalidade_execucao === "refuro");
    const isSuspeito  = !algumRefuro;  // 2+ execs sem nenhuma marcada como refuro = suspeito
    const corTopo = isSuspeito ? "var(--perigo-bg)" : "var(--aviso-bg)";
    const bordaTopo = isSuspeito ? "var(--perigo)" : "var(--aviso)";
    const tagTopo = isSuspeito
      ? `<span class="rec-badge rec-badge-baixa">⚠️ SUSPEITO</span>`
      : `<span class="rec-badge rec-badge-alta">✓ Refuro confirmado</span>`;

    // Linhas das execuções
    const linhasExec = g.execs.map((re, idx) => {
      const data = re.perfuracao_inicio ? new Date(re.perfuracao_inicio).toLocaleDateString("pt-BR") : "—";
      const tag = re.modalidade_execucao === "refuro"
        ? `<span class="rec-badge rec-badge-alta">REFURO</span>`
        : (idx === 0 ? `<span class="rec-badge" style="background:var(--info-bg);color:var(--marca-600);">furo original</span>` : `<span class="rec-badge rec-badge-baixa">extra</span>`);
      // Select só com estacas AINDA PREVISTAS (não faz sentido realocar pra uma já executada)
      const optsPrev = _recPrevs
        .filter(p => p.id !== g.estaca.id && p.status === "prevista")
        .map(p => `<option value="${esc(p.id)}">${esc(p.numero)}</option>`).join("");
      const semPrevistas = optsPrev.length === 0;
      const selectBlock = semPrevistas
        ? `<small style="color:var(--txt-sutil);font-style:italic;">Nenhuma estaca prevista disponível pra realocar</small>`
        : `<select class="alt-realoc-sel" data-exec-id="${esc(re.id)}" style="font-size:11px;max-width:220px;">
             <option value="">— manter aqui —</option>
             ${optsPrev}
           </select>
           <button type="button" class="btn btn-sm btn-alt-realocar" data-exec-id="${esc(re.id)}" data-estaca-orig="${esc(g.estaca.id)}" style="background:var(--marca-600);">→ Realocar</button>`;
      return `<tr>
        <td>${tag}</td>
        <td>${esc(data)}</td>
        <td class="num">${num(re.profundidade_executada || 0)} m</td>
        <td class="num">${num(re.volume_concreto_m3 || 0)} m³</td>
        <td>
          ${idx > 0 ? `
            ${selectBlock}
            <button type="button" class="btn-sec btn-sm btn-alt-marcar-refuro" data-exec-id="${esc(re.id)}" title="Marcar esta execução como REFURO desta estaca">↻ Marcar refuro</button>
          ` : ""}
        </td>
      </tr>`;
    }).join("");

    return `<div style="border:1px solid ${bordaTopo};border-radius:6px;margin-bottom:12px;background:${corTopo};">
      <div style="padding:10px 14px;border-bottom:1px solid ${bordaTopo};display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong style="font-size:14px;">${esc(g.estaca.numero)}</strong>
        ${tagTopo}
        <span class="meta">${g.execs.length} execuções vinculadas</span>
      </div>
      <div style="padding:8px 14px;background:var(--sup-0);">
        <table style="width:100%;font-size:12px;">
          <thead><tr style="background:var(--sup-2);">
            <th>Tipo</th><th>Data</th><th class="num">Prof.</th><th class="num">Concreto</th><th>Ação</th>
          </tr></thead>
          <tbody>${linhasExec}</tbody>
        </table>
      </div>
    </div>`;
  }).join("");

  cont.innerHTML = `
    <div style="background:var(--info-bg);border-left:3px solid var(--marca-600);padding:10px 14px;margin-bottom:12px;font-size:12px;">
      📊 <strong>${_confAlteradas.length} estaca(s) com múltiplas execuções.</strong>
      Refuros legítimos (mesmo nome + R no CSV) já vêm marcados em verde.
      Casos suspeitos em <strong>vermelho</strong> precisam de revisão.
    </div>
    ${linhas}
  `;

  // Listeners
  cont.querySelectorAll(".btn-alt-realocar").forEach(b => {
    b.addEventListener("click", () => realocarExecucao(b.dataset.execId, b.dataset.estacaOrig));
  });
  cont.querySelectorAll(".btn-alt-marcar-refuro").forEach(b => {
    b.addEventListener("click", () => marcarComoRefuro(b.dataset.execId));
  });
}

async function realocarExecucao(execId, estacaOrigId){
  const sel = document.querySelector(`.alt-realoc-sel[data-exec-id="${execId}"]`);
  const novaEstacaId = sel?.value;
  if(!novaEstacaId){ aviso("app-aviso","Escolha a estaca de destino no select.","erro"); return; }
  // Busca nomes pra mensagem de motivo
  const orig = _recPrevs.find(p => p.id === estacaOrigId);
  const dest = _recPrevs.find(p => p.id === novaEstacaId);
  if(!confirm(`Realocar esta execução de "${orig?.numero||"?"}" pra "${dest?.numero||"?"}"? A estaca antiga ficará só com as execuções restantes.`)) return;

  const { error } = await sb.from("rdo_execucao_estaca")
    .update({ estaca_id: novaEstacaId })
    .eq("id", execId);
  if(error){ aviso("app-aviso","Erro ao realocar: "+error.message,"erro"); return; }

  // Registra ALTERAÇÃO MANUAL nas DUAS estacas (origem e destino)
  const motivoOrig = `Execução realocada para "${dest?.numero||"?"}" via Conferência`;
  const motivoDest = `Execução recebida de "${orig?.numero||"?"}" via Conferência`;
  await Promise.all([
    sb.rpc("registrar_alteracao_estaca", { p_estaca_id: estacaOrigId, p_motivo: motivoOrig }),
    sb.rpc("registrar_alteracao_estaca", { p_estaca_id: novaEstacaId, p_motivo: motivoDest })
  ]);

  aviso("app-aviso","Execução realocada e registrada como alteração.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function marcarComoRefuro(execId){
  if(!confirm("Marcar esta execução como REFURO? Os dados da estaca pai não serão sobrescritos por ela.")) return;
  // Busca a execução pra saber qual estaca registrar
  const { data: execData } = await sb.from("rdo_execucao_estaca").select("estaca_id").eq("id", execId).single();
  const { error } = await sb.from("rdo_execucao_estaca")
    .update({ modalidade_execucao: "refuro" })
    .eq("id", execId);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }

  // Registra alteração manual na estaca
  if(execData?.estaca_id){
    await sb.rpc("registrar_alteracao_estaca", {
      p_estaca_id: execData.estaca_id,
      p_motivo: "Execução marcada como REFURO via Conferência"
    });
  }

  aviso("app-aviso","Execução marcada como refuro e registrada como alteração.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

/* ====================================================================
   ABA DUPLICADAS — grupos de estacas com mesmo número
   ==================================================================== */

function renderizarDuplicadas(){
  const cont = $("conf-duplicadas-conteudo");
  if(!cont) return;
  if(!_confDuplicadas.length){
    cont.innerHTML = `<p class="vazio">🎉 Não há estacas duplicadas nesta obra.</p>`;
    return;
  }
  const blocos = _confDuplicadas.map(grupo => {
    const linhas = grupo.estacas.map((e, i) => {
      const stMeta = ESTACA_STATUS[e.status] || { label: e.status, cor: "cinza" };
      return `<tr data-id="${esc(e.id)}">
        <td><strong>#${i+1}</strong></td>
        <td>${esc(e.numero)}</td>
        <td>${esc(extrairBloco(e)||"—")}</td>
        <td>${esc((ESTACA_TIPOS[e.tipo]||e.tipo||"—"))}</td>
        <td class="num">${e.diametro_mm!=null ? num(e.diametro_mm) : "—"}</td>
        <td class="num">${e.profundidade_m!=null ? num(e.profundidade_m) : "—"}</td>
        <td><span class="tag ${stMeta.cor}">${esc(stMeta.label)}</span></td>
        <td class="col-acao">
          <button type="button" class="btn-sec btn-sm btn-dup-renomear" data-id="${esc(e.id)}" data-num="${esc(e.numero)}">✏️ Renomear</button>
          <button type="button" class="btn-sec btn-sm btn-dup-excluir txt-perigo" data-id="${esc(e.id)}" data-num="${esc(e.numero)}">🗑️</button>
        </td>
      </tr>`;
    }).join("");
    return `<div style="margin-bottom:18px;border:1px solid var(--aviso);border-radius:6px;padding:10px;background:#fff8e8;">
      <h4>
        ⚠️ Número <code style="background:var(--sup-0);padding:2px 8px;border-radius:3px;">${esc(grupo.numero)}</code> aparece <strong>${grupo.estacas.length}× </strong>
      </h4>
      <div class="tabela-rola"><table>
        <thead><tr>
          <th>#</th><th>Número</th><th>Bloco</th><th>Tipo</th>
          <th class="num">Ø</th><th class="num">Prof.</th><th>Status</th><th class="col-acao"></th>
        </tr></thead>
        <tbody>${linhas}</tbody></table></div>
    </div>`;
  }).join("");
  cont.innerHTML = blocos;

  cont.querySelectorAll(".btn-dup-renomear").forEach(b => {
    b.addEventListener("click", () => renomearEstacaDuplicada(b.dataset.id, b.dataset.num));
  });
  cont.querySelectorAll(".btn-dup-excluir").forEach(b => {
    b.addEventListener("click", () => excluirEstacaDuplicada(b.dataset.id, b.dataset.num));
  });
}

async function renomearEstacaDuplicada(id, numAtual){
  const novo = prompt(`Renomear estaca "${numAtual}" para:`, numAtual + "-2");
  if(!novo || novo.trim() === numAtual) return;
  const novoNorm = normalizarNumeroEstacaEstacas(novo);
  const { error } = await sb.from("estacas").update({ numero: novoNorm }).eq("id", id);
  if(error){
    if((error.message||"").toLowerCase().includes("duplicate"))
      aviso("app-aviso","Já existe outra estaca com esse número. Escolha um diferente.","erro");
    else
      aviso("app-aviso","Erro: "+error.message,"erro");
    return;
  }
  aviso("app-aviso", `Estaca renomeada para ${novoNorm}.`, "ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function excluirEstacaDuplicada(id, num){
  if(!confirm(`Excluir esta estaca "${num}"? A ação não pode ser desfeita.\n(Execuções vinculadas ficarão órfãs até serem realocadas).`)) return;
  const { error } = await sb.from("estacas").delete().eq("id", id);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  aviso("app-aviso","Estaca excluída.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

/* ====================================================================
   ABA REFURADAS — estacas com status=refurada
   ==================================================================== */

function renderizarRefuradas(){
  const cont = $("conf-refuradas-conteudo");
  if(!cont) return;
  if(!_confRefuradas.length){
    cont.innerHTML = `<p class="vazio">🎉 Não há estacas refuradas nesta obra.</p>`;
    return;
  }
  const linhas = _confRefuradas.map(e => `<tr data-id="${esc(e.id)}">
    <td><strong>${esc(e.numero)}</strong></td>
    <td>${esc(extrairBloco(e)||"—")}</td>
    <td class="num">${e.diametro_mm!=null ? num(e.diametro_mm) : "—"}</td>
    <td class="num">${e.profundidade_m!=null ? num(e.profundidade_m) + " m" : "—"}</td>
    <td>${dataBR(e.data_execucao)}</td>
    <td>${esc(e.observacoes || "—")}</td>
    <td class="col-acao">
      <button type="button" class="btn-sec btn-sm btn-ref-substituir" data-id="${esc(e.id)}" data-num="${esc(e.numero)}">➕ Criar substituta</button>
      <button type="button" class="btn-sec btn-sm btn-ref-restaurar" data-id="${esc(e.id)}" title="Voltar para 'prevista'">↩️ Restaurar</button>
    </td>
  </tr>`).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Nº</th><th>Bloco</th><th class="num">Ø</th><th class="num">Profund.</th>
      <th>Data</th><th>Observação</th><th class="col-acao"></th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;

  cont.querySelectorAll(".btn-ref-substituir").forEach(b => {
    b.addEventListener("click", () => criarSubstitutaRefurada(b.dataset.id, b.dataset.num));
  });
  cont.querySelectorAll(".btn-ref-restaurar").forEach(b => {
    b.addEventListener("click", () => restaurarRefurada(b.dataset.id));
  });
}

async function criarSubstitutaRefurada(idOriginal, numOriginal){
  const original = _confRefuradas.find(e => e.id === idOriginal);
  if(!original) return;
  const sugestao = numOriginal + "-S";
  const novoNum = prompt(`Número da estaca substituta (a refurada "${numOriginal}" continua no histórico):`, sugestao);
  if(!novoNum) return;
  const novoNorm = normalizarNumeroEstacaEstacas(novoNum);
  const reg = {
    obra_id: obraEditId,
    numero: novoNorm,
    tipo: original.tipo || "outro",
    status: "prevista",
    diametro_mm: original.diametro_mm,
    profundidade_m: original.profundidade_m,  // copia profundidade projetada
    observacoes: `Substituta de ${numOriginal} (refurada)` + (original.observacoes ? ` · ${original.observacoes}` : "")
  };
  const { error } = await sb.from("estacas").insert(reg);
  if(error){
    if((error.message||"").toLowerCase().includes("duplicate"))
      aviso("app-aviso","Já existe estaca com esse número. Escolha outro.","erro");
    else
      aviso("app-aviso","Erro: "+error.message,"erro");
    return;
  }
  aviso("app-aviso", `Estaca substituta ${novoNorm} criada como prevista.`, "ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function restaurarRefurada(id){
  if(!confirm("Restaurar esta estaca para status 'prevista'? Use só se a refuração foi marcada por engano.")) return;
  const { error } = await sb.from("estacas").update({
    status: "prevista",
    data_execucao: null
  }).eq("id", id);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  aviso("app-aviso","Estaca restaurada para prevista.","ok");
  await abrirModalReconciliacao();
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
}

async function confirmarReconciliacao(){
  const escolhidos = Object.entries(_recVinculos).filter(([_,v]) => v);
  if(!escolhidos.length){
    aviso("app-aviso","Nenhuma vinculação escolhida. Use 'Aplicar sugestões' ou selecione manualmente.","erro");
    return;
  }

  // Bloqueia confirmar se há 2+ execuções apontando pra mesma estaca (a menos que usuário confirme intencionalmente)
  const conflitos = contarConflitosVinculacao();
  if(conflitos > 0){
    const ok = confirm(
      `⚠️ ATENÇÃO: ${conflitos} execuções estão competindo pela mesma estaca (linhas em vermelho na tabela).\n\n` +
      `Se confirmar assim, algumas estacas receberão MAIS DE UMA execução (anomalia de cadastro).\n\n` +
      `Recomendado: cancelar, ajustar manualmente cada linha em vermelho, depois confirmar.\n\n` +
      `Deseja confirmar mesmo assim?`
    );
    if(!ok) return;
  }
  if(!confirm(`Vincular ${escolhidos.length} execução(ões) às estacas escolhidas? Isso atualiza status pra 'executada' e profundidade.`)) return;

  // Desabilita o botão pra evitar duplo-clique
  const btn = $("btn-est-rec-confirmar");
  if(btn){ btn.disabled = true; btn.textContent = "Vinculando..."; }

  let sucesso = 0, falhas = 0;
  const erros = [];
  for(const [execId, estacaId] of escolhidos){
    const { error } = await sb.from("rdo_execucao_estaca")
      .update({ estaca_id: estacaId })
      .eq("id", execId);
    if(error){ falhas++; erros.push(error.message); }
    else { sucesso++; }
  }

  // Toast de aviso (continua) — mas NÃO fecha mais o modal de cara
  aviso("app-aviso", `✅ ${sucesso} vinculada(s)${falhas ? ` · ${falhas} falha(s)` : ""}.`, sucesso > 0 ? "ok" : "erro");

  // Atualiza dados em background
  if(typeof carregarEstacasDaObra === "function") await carregarEstacasDaObra(obraEditId);
  if(typeof carregarContagemReconciliacao === "function") await carregarContagemReconciliacao(obraEditId);

  // Recarrega modal (vai mostrar 0 órfãs se tudo OK) e injeta banner de resumo no topo
  await abrirModalReconciliacao();
  const cont = $("est-reconciliar-conteudo");
  if(cont){
    const cor = falhas === 0 ? "var(--sucesso-bg)" : "var(--aviso-bg)";
    const borda = falhas === 0 ? "var(--sucesso)" : "var(--aviso)";
    const icone = falhas === 0 ? "✅" : "⚠️";
    const titulo = falhas === 0
      ? `${sucesso} execução(ões) vinculada(s) com sucesso!`
      : `${sucesso} vinculada(s) · ${falhas} falharam`;
    const detalhe = falhas > 0
      ? `<details style="margin-top:6px;font-size:11px;"><summary>Ver erros</summary><pre style="white-space:pre-wrap;">${esc(erros.slice(0,5).join("\n"))}</pre></details>`
      : `<div style="font-size:12px;margin-top:4px;color:var(--txt-sec);">As estacas previstas correspondentes foram marcadas como <strong>executada</strong> automaticamente.</div>`;
    const banner = `
      <div style="background:${cor};border-left:4px solid ${borda};padding:14px 18px;margin-bottom:14px;border-radius:4px;">
        <div style="font-size:14px;font-weight:600;color:var(--marca-900);">${icone} ${titulo}</div>
        ${detalhe}
      </div>`;
    cont.insertAdjacentHTML("afterbegin", banner);
  }
}

/* ---------- Listeners ---------- */
function ligarEstacas(){
  $("btn-est-nova")?.addEventListener("click", () => {
    if(!obraEditId){ aviso("app-aviso","Salve a obra antes de adicionar estacas.","erro"); return; }
    abrirModalEstaca(null);
  });
  $("btn-est-importar")?.addEventListener("click", abrirModalImport);
  $("btn-est-salvar")?.addEventListener("click", salvarEstaca);
  $("btn-est-cancelar")?.addEventListener("click", fecharModalEstaca);

  $("btn-est-extrair")?.addEventListener("click", importarEstacasPDF);
  $("btn-est-confirmar-import")?.addEventListener("click", confirmarImportEstacas);
  $("btn-est-fechar-import")?.addEventListener("click", fecharModalImport);

  // Conferência do Projeto (modal expandido)
  $("btn-est-reconciliar")?.addEventListener("click", abrirModalReconciliacao);
  $("btn-est-rec-fechar")?.addEventListener("click", fecharModalReconciliacao);

  // Switcher das abas internas do modal (event delegation)
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("#conf-notebook button[data-conf-tab]");
    if(t) ativarConfAba(t.dataset.confTab);
  });

  ["est-busca","est-f-status","est-f-tipo"].forEach(id => {
    const el = $(id);
    if(el) el.addEventListener(id === "est-busca" ? "input" : "change", renderEstacas);
  });

  // Toggle Lista | Planta
  document.querySelectorAll("[data-est-view]").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-est-view]").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      _estView = b.dataset.estView;
      renderEstacas();
      if(_estView === "planta") configurarPanZoom();
    });
  });

  // Zoom buttons
  $("btn-planta-zoom-in")?.addEventListener("click", () => plantaZoom(0.2));
  $("btn-planta-zoom-out")?.addEventListener("click", () => plantaZoom(-0.2));
  $("btn-planta-zoom-fit")?.addEventListener("click", plantaZoomFit);

  // Modal de execução rápida
  $("btn-exec-fechar")?.addEventListener("click", fecharModalExecucao);
  $("btn-exec-salvar")?.addEventListener("click", () => salvarExecucao());
  $("btn-exec-iniciar")?.addEventListener("click", () => salvarExecucao("em_execucao"));
  $("btn-exec-concluir")?.addEventListener("click", () => {
    if(!$("exec-profundidade").value){
      if(!confirm("Sem profundidade real informada. Marcar como executada mesmo assim?")) return;
    }
    salvarExecucao("executada");
  });
  $("btn-exec-refugar")?.addEventListener("click", () => {
    if(!confirm("Marcar esta estaca como REFURADA?")) return;
    salvarExecucao("refugada");
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarEstacas);
} else {
  ligarEstacas();
}

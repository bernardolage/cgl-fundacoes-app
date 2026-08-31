/* ====================================================================
   Módulo: Abas extras da ficha de Obra
   Equipamentos, Medições, RDOs, Documentos, Timeline.
   Cada função é chamada quando a aba correspondente é ativada na ficha.
   Depende de obraEditId (id da obra aberta) — set em obras.js.
   ==================================================================== */

let _obrAbasContagens = { estacas: 0, equipamentos: 0, rdos: 0, raiz: 0, medicoes: 0, documentos: 0 };

/* ---------- Despachante: carrega tudo quando a obra abre ---------- */
async function carregarAbasObra(obraId){
  if(!obraId) return;
  // Em paralelo, busca as contagens pra smart-buttons.
  // Estacas: contamos APENAS pela tabela `estacas` (literal, sem dedup — BB são nomes legítimos).
  // Execuções órfãs aparecem no badge separado "🔗 Reconciliar".
  const [eq, med, rdoG, doc, estsTotal, estsExec] = await Promise.all([
    sb.from("equipamentos").select("id", { count: "exact", head: true }).eq("localizacao_obra_id", obraId).eq("ativo", true),
    sb.from("medicoes").select("id", { count: "exact", head: true }).eq("obra_id", obraId),
    sb.from("rdo").select("id", { count: "exact", head: true }).eq("obra_id", obraId),
    sb.from("obras_documentos").select("id", { count: "exact", head: true }).eq("obra_id", obraId),
    sb.from("estacas").select("id", { count: "exact", head: true }).eq("obra_id", obraId),
    sb.from("estacas").select("id", { count: "exact", head: true }).eq("obra_id", obraId).eq("status", "executada")
  ]);
  _obrAbasContagens = {
    estacas: estsTotal.count || 0,
    estacas_previstas: estsTotal.count || 0,
    estacas_executadas: estsExec.count || 0,
    equipamentos: eq.count || 0,
    medicoes: med.count || 0,
    rdos: rdoG.count || 0,
    documentos: doc.count || 0
  };
  atualizarSmartButtons();
}

function atualizarSmartButtons(){
  const c = _obrAbasContagens;
  // Texto especial das estacas: "X executadas / Y total" se diferentes
  const estacasNum = c.estacas;
  const estacasLbl = (c.estacas_executadas != null && c.estacas_executadas !== c.estacas)
    ? `${c.estacas_executadas} exec. / ${c.estacas} total`
    : "estacas";
  const map = {
    "sb-estacas": [estacasNum, "🔧", estacasLbl],
    "sb-equipamentos": [c.equipamentos, "🚜", "equipamentos"],
    "sb-rdos": [c.rdos, "📋", "RDOs"],
    "sb-medicoes": [c.medicoes, "💰", "medições"],
    "sb-documentos": [c.documentos, "📎", "documentos"]
  };
  Object.entries(map).forEach(([id, [n, icone, lbl]]) => {
    const el = $(id);
    if(!el) return;
    el.querySelector(".sb-num").textContent = n;
    el.querySelector(".sb-lbl").textContent = lbl;
  });
}

/* ====================================================================
   ABA EQUIPAMENTOS — TAGs alocadas via Movimentações
   ==================================================================== */

async function carregarEquipamentosDaObra(obraId){
  const cont = $("obr-equip-conteudo");
  if(!cont) return;
  if(!obraId){
    cont.innerHTML = `<p class="vazio">Salve a obra primeiro.</p>`;
    return;
  }
  const { data, error } = await sb.from("vw_equipamentos_localizacao")
    .select("*")
    .eq("localizacao_obra_id", obraId);
  if(error){
    cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`;
    return;
  }
  if(!data || !data.length){
    cont.innerHTML = `<p class="vazio">Nenhum equipamento alocado a esta obra.<br>
      <button type="button" class="btn" id="btn-equip-mov-nova" style="margin-top:10px;">+ Registrar movimentação de chegada</button></p>`;
    $("btn-equip-mov-nova")?.addEventListener("click", () => abrirMovimentacaoPraObra());
    return;
  }
  const linhas = data.map(e => `<tr data-id="${esc(e.id)}">
    <td><strong>${esc(e.codigo)}</strong></td>
    <td>${esc(e.nome)}</td>
    <td>${esc(e.tipo)}</td>
    <td>${tagStatusEquip(e.status)}</td>
    <td>${e.localizacao_atualizada_em ? new Date(e.localizacao_atualizada_em).toLocaleDateString("pt-BR") : "—"}</td>
    <td class="col-acao">
      <button type="button" class="btn-sec btn-sm btn-equip-devolver" data-id="${esc(e.id)}" title="Devolver para base">↩ Devolver</button>
    </td>
  </tr>`).join("");
  cont.innerHTML = `
    <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
      <h4 style="margin:0;font-size:13px;">${data.length} equipamento${data.length>1?"s":""} alocado${data.length>1?"s":""} a esta obra</h4>
      <button type="button" class="btn" id="btn-equip-mov-nova">+ Nova movimentação</button>
    </div>
    <div class="tabela-rola"><table>
      <thead><tr>
        <th>TAG</th><th>Nome</th><th>Tipo</th><th>Status</th><th>Desde</th><th class="col-acao"></th>
      </tr></thead>
      <tbody>${linhas}</tbody></table></div>
    <p style="font-size:11px;color:var(--txt-sutil);margin-top:8px;">💡 Localizações são derivadas das Movimentações de Ativos. Para mudar, crie nova movimentação.</p>
  `;
  $("btn-equip-mov-nova")?.addEventListener("click", () => abrirMovimentacaoPraObra());
  cont.querySelectorAll(".btn-equip-devolver").forEach(b => {
    b.addEventListener("click", () => abrirMovimentacaoPraObra("retorno", b.dataset.id));
  });
}

function tagStatusEquip(st){
  const cores = { disponivel:"verde", em_uso:"azul", em_manutencao:"ambar", inativo:"cinza" };
  const lbls  = { disponivel:"Disponível", em_uso:"Em uso", em_manutencao:"Manutenção", inativo:"Inativo" };
  return `<span class="tag ${cores[st]||"cinza"}">${esc(lbls[st]||st)}</span>`;
}

/* Atalho: abre o módulo Movimentações com obra pré-preenchida */
function abrirMovimentacaoPraObra(tipo = "remessa", equipamentoIdPreSelecionado = null){
  // Muda pra seção Movimentações
  const navMov = document.querySelector('nav button[data-secao="movimentacoes"]');
  if(navMov) navMov.click();
  // Aguarda render e abre nova movimentação
  setTimeout(() => {
    if(typeof novaMovimentacao === "function"){
      novaMovimentacao();
      // Pré-preenche destino = esta obra
      const o = (_obrRegistros || []).find(x => x.id === obraEditId);
      const obraTxt = o ? `${o.codigo} — ${o.nome}` : "";
      if(tipo === "retorno"){
        $("mov-tipo").value = "retorno";
        $("mov-origem-tipo").value = "obra";
        $("mov-origem-descricao").value = obraTxt;
        $("mov-destino-tipo").value = "base";
        $("mov-destino-descricao").value = "Base Itabira";
        $("mov-destino-uf").value = "mg";
      } else {
        $("mov-destino-tipo").value = "obra";
        $("mov-destino-descricao").value = obraTxt;
      }
      // Pré-seleciona equipamento se passado
      if(equipamentoIdPreSelecionado && typeof adicionarEquipamento === "function"){
        const sel = $("mov-add-equip");
        if(sel){ sel.value = equipamentoIdPreSelecionado; adicionarEquipamento(); }
      }
      aviso("app-aviso","Movimentação pré-preenchida — revise antes de salvar.","ok");
    }
  }, 250);
}

/* ====================================================================
   ABA MEDIÇÕES — read-only + atalho pra criar nova
   ==================================================================== */

async function carregarMedicoesDaObra(obraId){
  const cont = $("obr-medic-conteudo");
  if(!cont) return;
  if(!obraId){
    cont.innerHTML = `<p class="vazio">Salve a obra primeiro.</p>`;
    return;
  }
  const { data, error } = await sb.from("medicoes")
    .select("id,numero,data_medicao,percentual,valor_medido,status,observacoes")
    .eq("obra_id", obraId)
    .order("data_medicao", { ascending: false });
  if(error){
    cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`;
    return;
  }
  const valorContratado = Number($("obr-valor").value || 0);
  const totalMedido = (data || []).reduce((s,m) => s + (Number(m.valor_medido) || 0), 0);
  const saldo = valorContratado - totalMedido;
  const pctTotal = valorContratado > 0 ? (totalMedido / valorContratado * 100) : 0;

  const stats = `
    <div class="indicadores" style="margin-bottom:14px;">
      <div class="ind"><div class="num">${data.length}</div><div class="rot">Medições</div></div>
      <div class="ind"><div class="num">${brl(totalMedido)}</div><div class="rot">Total medido</div></div>
      <div class="ind"><div class="num">${brl(saldo)}</div><div class="rot">Saldo contratual</div></div>
      <div class="ind"><div class="num">${pctTotal.toFixed(1)}%</div><div class="rot">% medido</div></div>
    </div>`;

  if(!data || !data.length){
    cont.innerHTML = `${stats}<p class="vazio">Nenhuma medição registrada.<br>
      <button type="button" class="btn" id="btn-medic-nova" style="margin-top:10px;">+ Nova medição</button></p>`;
    $("btn-medic-nova")?.addEventListener("click", abrirMedicaoPraObra);
    return;
  }
  const linhas = data.map(m => `<tr class="linha-clicavel" data-id="${esc(m.id)}">
    <td>${esc(m.numero)}</td>
    <td>${dataBR(m.data_medicao)}</td>
    <td>${num(m.percentual)}%</td>
    <td>${tagStatus("medicao", m.status)}</td>
    <td class="num">${brl(m.valor_medido)}</td>
  </tr>`).join("");
  cont.innerHTML = `${stats}
    <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
      <h4 style="margin:0;font-size:13px;">Medições da obra</h4>
      <button type="button" class="btn" id="btn-medic-nova">+ Nova medição</button>
    </div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Data</th><th>%</th><th>Status</th><th class="num">Valor</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
  `;
  $("btn-medic-nova")?.addEventListener("click", abrirMedicaoPraObra);
  cont.querySelectorAll(".linha-clicavel").forEach(tr => {
    tr.addEventListener("click", () => abrirMedicaoExistente(tr.dataset.id));
  });
}

function abrirMedicaoPraObra(){
  const obraIdAtual = obraEditId;
  const navMed = document.querySelector('nav button[data-secao="medicoes"]');
  if(navMed) navMed.click();
  setTimeout(() => {
    if(typeof novaMedicao === "function"){
      novaMedicao();
      if(obraIdAtual) $("med-obra").value = obraIdAtual;
    }
  }, 250);
}

function abrirMedicaoExistente(medId){
  const navMed = document.querySelector('nav button[data-secao="medicoes"]');
  if(navMed) navMed.click();
  setTimeout(() => {
    if(typeof abrirMedicao === "function") abrirMedicao(medId);
  }, 250);
}

/* ====================================================================
   ABA RDOs — geral + raiz, read-only
   ==================================================================== */

async function carregarRDOsDaObra(obraId){
  const cont = $("obr-rdo-conteudo");
  if(!cont) return;
  if(!obraId){
    cont.innerHTML = `<p class="vazio">Salve a obra primeiro.</p>`;
    return;
  }

  // Resumo dos RDOs + execuções por rdo (pra contar vinculadas)
  const [resumoRes, execsRes] = await Promise.all([
    sb.from("vw_rdo_resumo").select("*").eq("obra_id", obraId).order("data", { ascending: false }),
    sb.from("rdo_execucao_estaca").select("rdo_id, estaca_id, rdo:rdo_id(obra_id)")
  ]);
  if(resumoRes.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(resumoRes.error.message)}</p>`; return; }
  const data = resumoRes.data;

  // Mapa rdo_id -> { total, vinculadas }
  const vincPorRdo = {};
  (execsRes.data || []).forEach(e => {
    if(!e.rdo || e.rdo.obra_id !== obraId) return;
    if(!vincPorRdo[e.rdo_id]) vincPorRdo[e.rdo_id] = { total: 0, vinculadas: 0 };
    vincPorRdo[e.rdo_id].total++;
    if(e.estaca_id) vincPorRdo[e.rdo_id].vinculadas++;
  });

  const lblsTipo = {
    helice_continua: "🌀 Hélice contínua",
    trado_mecanizado: "🔩 Trado mecanizado",
    estaca_raiz: "🌱 Estaca raiz",
    helice_secante: "🛡️ Hélice secante"
  };

  const header = `
    <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
      <h4 style="margin:0;font-size:13px;">RDOs registrados</h4>
      <button type="button" class="btn" id="btn-rdo-novo">+ Novo RDO</button>
    </div>`;

  if(!data || !data.length){
    cont.innerHTML = `${header}<p class="vazio">Nenhum RDO registrado.</p>`;
    $("btn-rdo-novo")?.addEventListener("click", abrirRdoPraObra);
    return;
  }

  // Mini-gráfico de produção (últimos 30 dias)
  const ultimos = data.slice(0, 30).reverse();
  const maxProd = Math.max(...ultimos.map(r => Number(r.metragem_total) || 0), 1);
  const barras = ultimos.map(r => {
    const h = Math.round(((Number(r.metragem_total) || 0) / maxProd) * 60);
    return `<div title="${dataBR(r.data)}: ${num(r.metragem_total)} m" style="display:inline-block;width:14px;height:60px;vertical-align:bottom;margin:0 1px;">
      <div style="background:var(--marca-600);width:100%;height:${h}px;margin-top:${60-h}px;border-radius:2px 2px 0 0;"></div>
    </div>`;
  }).join("");
  const grafico = `
    <div style="background:var(--sup-2);border-radius:6px;padding:12px;margin-bottom:14px;">
      <div style="font-size:12px;color:var(--txt-sec);margin-bottom:6px;font-weight:600;">📊 Metragem diária — últimos ${ultimos.length} RDOs</div>
      <div style="display:flex;align-items:flex-end;height:62px;overflow-x:auto;">${barras}</div>
    </div>`;

  const linhas = data.map(r => {
    const v = vincPorRdo[r.id] || { total: 0, vinculadas: 0 };
    const orf = v.total - v.vinculadas;
    const corVinc = orf === 0
      ? "var(--sucesso)"     // tudo vinculado — verde
      : (v.vinculadas === 0 ? "var(--perigo)" : "var(--aviso)"); // nada / parcial
    const tituloVinc = orf === 0
      ? "Todas as execuções deste RDO estão vinculadas a estacas cadastradas"
      : `${orf} execução(ões) sem vínculo (órfãs)`;
    return `<tr class="linha-clicavel" data-id="${esc(r.id)}">
      <td>${dataBR(r.data)}</td>
      <td>${esc(lblsTipo[r.tipo_servico] || r.tipo_servico)}</td>
      <td>${r.qtd_estacas_executadas || 0}</td>
      <td title="${tituloVinc}" style="color:${corVinc};font-weight:600;">
        ${v.vinculadas} / ${v.total}${orf > 0 ? ` <small style="font-weight:400;">(${orf} órfã${orf>1?'s':''})</small>` : ""}
      </td>
      <td class="num">${num(r.metragem_total)} m</td>
      <td class="num">${num(r.concreto_total_m3)} m³</td>
      <td>${tagStatus("rdo", r.status)}</td>
    </tr>`;
  }).join("");

  cont.innerHTML = `${header}${grafico}
    <div class="tabela-rola"><table>
      <thead><tr>
        <th>Data</th><th>Tipo de serviço</th><th>Estacas</th>
        <th title="Execuções vinculadas a estacas cadastradas / total de execuções">Vinculadas</th>
        <th class="num">Metragem</th><th class="num">Concreto</th><th>Status</th>
      </tr></thead>
      <tbody>${linhas}</tbody></table></div>`;

  $("btn-rdo-novo")?.addEventListener("click", abrirRdoPraObra);
  cont.querySelectorAll(".linha-clicavel").forEach(tr => {
    tr.addEventListener("click", () => abrirRdoExistente(tr.dataset.id));
  });
}

function abrirRdoPraObra(){
  const obraIdAtual = obraEditId;
  const nav = document.querySelector('nav button[data-secao="rdo"]');
  if(nav) nav.click();
  setTimeout(() => {
    if(typeof novoRDO === "function"){
      const r = novoRDO();
      // novoRDO retorna void; preenche obra após o reset
      if(obraIdAtual && $("rdo-obra")) $("rdo-obra").value = obraIdAtual;
    }
  }, 250);
}

function abrirRdoExistente(id){
  const nav = document.querySelector('nav button[data-secao="rdo"]');
  if(nav) nav.click();
  setTimeout(() => { if(typeof abrirRDO === "function") abrirRDO(id); }, 250);
}

/* ====================================================================
   ABA DOCUMENTOS — upload Storage + lista
   ==================================================================== */

const DOC_CATEGORIAS = {
  art: "ART",
  contrato: "Contrato",
  boletim_medicao: "Boletim de medição",
  foto: "Foto",
  remessa_nf: "Remessa (NF)",
  sondagem: "Sondagem",
  projeto: "Projeto",
  outro: "Outro"
};

async function carregarDocumentosDaObra(obraId){
  const cont = $("obr-doc-conteudo");
  if(!cont) return;
  if(!obraId){
    cont.innerHTML = `<p class="vazio">Salve a obra primeiro.</p>`;
    return;
  }
  const { data, error } = await sb.from("obras_documentos")
    .select("id,categoria,nome,descricao,storage_path,mime_type,tamanho_bytes,origem,movimentacao_id,created_at,enviado_por")
    .eq("obra_id", obraId)
    .order("created_at", { ascending: false });
  if(error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }

  const cats = Object.entries(DOC_CATEGORIAS)
    .map(([v,l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  const uploader = `
    <div class="card" style="margin-bottom:14px;padding:12px;">
      <h4 style="margin:0 0 8px;font-size:13px;">📤 Enviar novo documento</h4>
      <div class="grade">
        <div class="campo"><label>Categoria</label>
          <select id="doc-categoria"><option value="outro">Outro</option>${cats}</select>
        </div>
        <div class="campo"><label>Descrição (opcional)</label>
          <input id="doc-descricao" placeholder="ex.: ART nº 12345" />
        </div>
        <div class="campo largo"><label>Arquivo (max 50MB)</label>
          <input id="doc-arquivo" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.doc,.xls,.txt,.csv" />
        </div>
      </div>
      <div class="form-acoes">
        <button type="button" class="btn" id="btn-doc-enviar">📤 Enviar</button>
      </div>
    </div>`;

  if(!data || !data.length){
    cont.innerHTML = `${uploader}<p class="vazio">Nenhum documento enviado ainda.</p>`;
    ligarUploadDoc(obraId);
    return;
  }

  // Agrupa por categoria
  const grupos = {};
  data.forEach(d => {
    const k = DOC_CATEGORIAS[d.categoria] || d.categoria;
    if(!grupos[k]) grupos[k] = [];
    grupos[k].push(d);
  });
  const blocos = Object.entries(grupos).map(([cat, docs]) => {
    const linhas = docs.map(d => {
      const isImg = (d.mime_type||"").startsWith("image/");
      const tamKB = d.tamanho_bytes ? (d.tamanho_bytes/1024).toFixed(0) + " KB" : "—";
      const origemBadge = d.origem === "movimentacao_ativa"
        ? '<span class="tag azul" style="font-size:10px;">auto</span>' : "";
      return `<tr>
        <td>${isImg ? '🖼️' : '📄'} ${esc(d.nome)} ${origemBadge}</td>
        <td>${esc(d.descricao||"—")}</td>
        <td>${tamKB}</td>
        <td>${new Date(d.created_at).toLocaleDateString("pt-BR")}</td>
        <td class="col-acao">
          <button type="button" class="btn-sec btn-sm btn-doc-baixar" data-path="${esc(d.storage_path)}" data-nome="${esc(d.nome)}" title="Baixar">⬇️</button>
          <button type="button" class="btn-sec btn-sm btn-doc-excluir txt-perigo" data-id="${esc(d.id)}" data-path="${esc(d.storage_path)}" title="Excluir">🗑️</button>
        </td>
      </tr>`;
    }).join("");
    return `<div style="margin-bottom:14px;">
      <h4 style="font-size:12px;color:var(--marca-600);text-transform:uppercase;letter-spacing:.4px;margin:0 0 6px;">${esc(cat)} (${docs.length})</h4>
      <div class="tabela-rola"><table>
        <thead><tr><th>Arquivo</th><th>Descrição</th><th>Tamanho</th><th>Enviado em</th><th class="col-acao"></th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
    </div>`;
  }).join("");
  cont.innerHTML = `${uploader}${blocos}`;
  ligarUploadDoc(obraId);
  cont.querySelectorAll(".btn-doc-baixar").forEach(b => {
    b.addEventListener("click", () => baixarDocumento(b.dataset.path, b.dataset.nome));
  });
  cont.querySelectorAll(".btn-doc-excluir").forEach(b => {
    b.addEventListener("click", () => excluirDocumento(b.dataset.id, b.dataset.path, obraId));
  });
}

function ligarUploadDoc(obraId){
  $("btn-doc-enviar")?.addEventListener("click", () => enviarDocumento(obraId));
}

async function enviarDocumento(obraId){
  const inp = $("doc-arquivo");
  if(!inp.files || !inp.files[0]){ aviso("app-aviso","Selecione um arquivo.","erro"); return; }
  const file = inp.files[0];
  if(file.size > 52428800){ aviso("app-aviso","Arquivo maior que 50MB.","erro"); return; }
  const btn = $("btn-doc-enviar");
  btn.disabled = true;
  const txtOrig = btn.textContent;
  btn.textContent = "Enviando...";

  try {
    const ext = file.name.split(".").pop().toLowerCase();
    const nomeUnico = `${obraId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const { error: errUp } = await sb.storage.from("obras-documentos").upload(nomeUnico, file, {
      cacheControl: "3600", contentType: file.type, upsert: false
    });
    if(errUp) throw errUp;

    const { data:{ user } } = await sb.auth.getUser();
    const reg = {
      obra_id: obraId,
      categoria: $("doc-categoria").value,
      nome: file.name,
      descricao: $("doc-descricao").value.trim() || null,
      storage_path: nomeUnico,
      mime_type: file.type,
      tamanho_bytes: file.size,
      enviado_por: user ? user.id : null,
      origem: "manual"
    };
    const { error: errIns } = await sb.from("obras_documentos").insert(reg);
    if(errIns){
      // se falhar metadata, remove o arquivo pra não vazar
      await sb.storage.from("obras-documentos").remove([nomeUnico]);
      throw errIns;
    }
    aviso("app-aviso","Documento enviado.","ok");
    inp.value = "";
    $("doc-descricao").value = "";
    await carregarDocumentosDaObra(obraId);
    await carregarAbasObra(obraId);
  } catch(err){
    aviso("app-aviso","Erro ao enviar: "+(err.message||err),"erro");
  } finally {
    btn.disabled = false;
    btn.textContent = txtOrig;
  }
}

async function baixarDocumento(path, nome){
  const { data, error } = await sb.storage.from("obras-documentos").createSignedUrl(path, 60);
  if(error){ aviso("app-aviso","Erro ao gerar URL: "+error.message,"erro"); return; }
  const a = document.createElement("a");
  a.href = data.signedUrl;
  a.download = nome;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function excluirDocumento(id, path, obraId){
  if(!confirm("Excluir este documento?")) return;
  await sb.storage.from("obras-documentos").remove([path]);
  const { error } = await sb.from("obras_documentos").delete().eq("id", id);
  if(error){ aviso("app-aviso","Erro: "+error.message,"erro"); return; }
  aviso("app-aviso","Documento excluído.","ok");
  await carregarDocumentosDaObra(obraId);
  await carregarAbasObra(obraId);
}

/* ====================================================================
   ABA TIMELINE — feed unificado
   ==================================================================== */

const TL_EVENTOS = {
  comentario:    { icone: "💬", cor: "var(--marca-600)", lbl: "Comentário" },
  obra:          { icone: "🏗️", cor: "var(--marca-600)", lbl: "Obra criada" },
  movimentacao:  { icone: "🚚", cor: "var(--aviso)", lbl: "Movimentação" },
  rdo:           { icone: "📋", cor: "var(--marca-900)", lbl: "RDO" },
  raiz:          { icone: "🌱", cor: "var(--marca-900)", lbl: "Boletim Raiz" },
  medicao:       { icone: "💰", cor: "var(--sucesso)", lbl: "Medição" },
  ocorrencia:    { icone: "⚠️", cor: "var(--perigo)", lbl: "Ocorrência" },
  documento:     { icone: "📎", cor: "#5a6b7d", lbl: "Documento" },
  estaca:        { icone: "🔧", cor: "var(--sucesso)", lbl: "Estaca" },
  alteracao:     { icone: "🔄", cor: "var(--aviso)", lbl: "Alteração manual" }
};

async function carregarTimelineDaObra(obraId){
  const cont = $("obr-timeline-conteudo");
  if(!cont) return;
  if(!obraId){
    cont.innerHTML = `<p class="vazio">Salve a obra primeiro.</p>`;
    return;
  }
  cont.innerHTML = `<p class="vazio">Carregando linha do tempo...</p>`;

  // Busca tudo em paralelo (incluindo criado_por / enviado_por / alterada_por pra mostrar autoria)
  const [obra, movs, rdos, medicoes, ocorrencias, docs, estacasExec, comentarios, usuariosAtivos] = await Promise.all([
    sb.from("obras").select("created_at,codigo,nome,criado_por").eq("id", obraId).single(),
    sb.from("movimentacoes_ativos").select("id,numero,tipo,status,data_emissao,destino_descricao,origem_descricao,valor_total_produtos,criado_por").or(`origem_obra_id.eq.${obraId},destino_obra_id.eq.${obraId}`).order("data_emissao", { ascending: false }),
    sb.from("rdo").select("id,data,tipo_servico,producao_dia_m,status,efetivo_proprio,efetivo_terceiro,criado_por").eq("obra_id", obraId).order("data", { ascending: false }),
    sb.from("medicoes").select("id,numero,data_medicao,valor_medido,status,criado_por").eq("obra_id", obraId).order("data_medicao", { ascending: false }),
    sb.from("ocorrencias").select("id,data,tipo,gravidade,status,descricao").eq("obra_id", obraId).order("data", { ascending: false }),
    sb.from("obras_documentos").select("id,nome,categoria,created_at,origem,enviado_por").eq("obra_id", obraId).order("created_at", { ascending: false }),
    sb.from("estacas").select("id,numero,data_execucao,alterada_em,alterada_por,alteracao_motivo,operador_id").eq("obra_id", obraId).eq("status","executada").not("data_execucao","is",null).order("data_execucao", { ascending: false }),
    sb.from("obras_comentarios").select("id,texto,autor_id,responsavel_id,resolvido,resolvido_em,resolvido_por,created_at").eq("obra_id", obraId).order("created_at", { ascending: false }),
    sb.from("profiles").select("id,nome,email").eq("ativo", true).order("nome")
  ]);

  // Coleta todos os user ids únicos pra buscar nomes em batch
  const userIds = new Set();
  if(obra.data?.criado_por) userIds.add(obra.data.criado_por);
  (movs.data||[]).forEach(m => { if(m.criado_por) userIds.add(m.criado_por); });
  (rdos.data||[]).forEach(r => { if(r.criado_por) userIds.add(r.criado_por); });
  (medicoes.data||[]).forEach(m => { if(m.criado_por) userIds.add(m.criado_por); });
  (docs.data||[]).forEach(d => { if(d.enviado_por) userIds.add(d.enviado_por); });
  (estacasExec.data||[]).forEach(e => { if(e.alterada_por) userIds.add(e.alterada_por); });
  (comentarios.data||[]).forEach(c => {
    if(c.autor_id) userIds.add(c.autor_id);
    if(c.responsavel_id) userIds.add(c.responsavel_id);
    if(c.resolvido_por) userIds.add(c.resolvido_por);
  });

  const mapaUsuarios = {};
  if(userIds.size){
    const { data: profs } = await sb.from("profiles").select("id,nome,email").in("id", [...userIds]);
    (profs||[]).forEach(p => { mapaUsuarios[p.id] = p.nome || p.email || "usuário"; });
  }
  const nomeDe = (uid) => uid ? (mapaUsuarios[uid] || "usuário desconhecido") : "sistema";

  const eventos = [];

  // Comentários (fase 23) — carregam dados extras pro render customizado
  (comentarios.data || []).forEach(c => {
    eventos.push({
      tipo: "comentario",
      data: c.created_at,
      titulo: c.texto,
      meta: "",
      autor: nomeDe(c.autor_id),
      coment: {
        id: c.id,
        responsavel: c.responsavel_id ? nomeDe(c.responsavel_id) : null,
        resolvido: c.resolvido,
        resolvidoPor: c.resolvido ? nomeDe(c.resolvido_por) : null,
        resolvidoEm: c.resolvido_em
      }
    });
  });

  // Obra criada
  if(obra.data){
    eventos.push({
      tipo: "obra",
      data: obra.data.created_at,
      titulo: `Obra criada: ${obra.data.codigo} — ${obra.data.nome}`,
      meta: "",
      autor: nomeDe(obra.data.criado_por)
    });
  }
  // Movimentações
  (movs.data || []).forEach(m => {
    const lbl = m.status === "recebida" ? "Recebida" :
                m.status === "em_transito" ? "Em trânsito" :
                m.status === "emitida" ? "Emitida" : "Rascunho";
    eventos.push({
      tipo: "movimentacao",
      data: m.data_emissao + "T12:00:00",
      titulo: `${m.numero} · ${m.tipo} (${lbl})`,
      meta: `${m.origem_descricao || "?"} → ${m.destino_descricao || "?"}${m.valor_total_produtos ? " · " + brl(m.valor_total_produtos) : ""}`,
      ref_id: m.id,
      autor: nomeDe(m.criado_por)
    });
  });
  // RDOs (com tipo de serviço)
  const lblsTipoRDO = {
    helice_continua: "🌀 Hélice",
    trado_mecanizado: "🔩 Trado",
    estaca_raiz: "🌱 Raiz",
    helice_secante: "🛡️ Secante"
  };
  // Para mostrar equipe nos RDOs, busca em batch (vw_rdo_equipe_completa traz nomes prontos)
  const rdoIds = (rdos.data || []).map(r => r.id);
  let equipePorRdo = {};
  if(rdoIds.length){
    const { data: eqs } = await sb.from("vw_rdo_equipe_completa")
      .select("rdo_id, nome, funcao_no_dia")
      .in("rdo_id", rdoIds)
      .order("ordem");
    (eqs || []).forEach(e => {
      if(!equipePorRdo[e.rdo_id]) equipePorRdo[e.rdo_id] = [];
      equipePorRdo[e.rdo_id].push(e.nome);
    });
  }
  (rdos.data || []).forEach(r => {
    const tipo = lblsTipoRDO[r.tipo_servico] || r.tipo_servico || "";
    const eq = equipePorRdo[r.id] || [];
    const equipeStr = eq.length
      ? ` · 👷 ${eq.slice(0,3).join(", ")}${eq.length > 3 ? ` +${eq.length-3}` : ""}`
      : "";
    eventos.push({
      tipo: r.tipo_servico === "estaca_raiz" ? "raiz" : "rdo",
      data: r.data + "T17:00:00",
      titulo: `RDO ${tipo} · ${dataBR(r.data)} (${r.status})`,
      meta: `Efetivo ${(r.efetivo_proprio||0)+(r.efetivo_terceiro||0)} · Produção ${num(r.producao_dia_m)} m${equipeStr}`,
      ref_id: r.id,
      autor: nomeDe(r.criado_por)
    });
  });
  // Medições
  (medicoes.data || []).forEach(m => {
    eventos.push({
      tipo: "medicao",
      data: m.data_medicao + "T12:00:00",
      titulo: `Medição ${m.numero} (${m.status})`,
      meta: brl(m.valor_medido),
      ref_id: m.id,
      autor: nomeDe(m.criado_por)
    });
  });
  // Ocorrências
  (ocorrencias.data || []).forEach(o => {
    eventos.push({
      tipo: "ocorrencia",
      data: o.data + "T12:00:00",
      titulo: `Ocorrência: ${o.tipo} (${o.gravidade})`,
      meta: o.descricao ? o.descricao.slice(0, 100) : "",
      autor: ""
    });
  });
  // Documentos
  (docs.data || []).forEach(d => {
    eventos.push({
      tipo: "documento",
      data: d.created_at,
      titulo: `📎 ${d.nome}`,
      meta: DOC_CATEGORIAS[d.categoria] + (d.origem === "movimentacao_ativa" ? " (auto)" : ""),
      autor: nomeDe(d.enviado_por)
    });
  });
  // Resolver nomes dos operadores (uuid de funcionarios → nome)
  const operadorIds = [...new Set((estacasExec.data||[]).map(e => e.operador_id).filter(Boolean))];
  const mapaOperadores = {};
  if(operadorIds.length){
    const { data: funcs } = await sb.from("funcionarios").select("id,nome").in("id", operadorIds);
    (funcs||[]).forEach(f => { mapaOperadores[f.id] = f.nome; });
  }

  // Estacas executadas — agrupa por data (e mostra operador(es) do dia se houver)
  const estacasPorData = {};
  (estacasExec.data || []).forEach(e => {
    const d = e.data_execucao;
    if(!estacasPorData[d]) estacasPorData[d] = { nums: [], operadores: new Set() };
    estacasPorData[d].nums.push(e.numero);
    if(e.operador_id) estacasPorData[d].operadores.add(mapaOperadores[e.operador_id] || "");
  });
  Object.entries(estacasPorData).forEach(([d, info]) => {
    const ops = [...info.operadores].filter(Boolean);
    const opsStr = ops.length ? ` · 👷 ${ops.join(", ")}` : "";
    eventos.push({
      tipo: "estaca",
      data: d + "T17:30:00",
      titulo: `${info.nums.length} estaca${info.nums.length>1?"s":""} executada${info.nums.length>1?"s":""}`,
      meta: info.nums.slice(0, 5).join(", ") + (info.nums.length > 5 ? ` +${info.nums.length-5}` : "") + opsStr,
      autor: ""
    });
  });
  // Estacas alteradas manualmente (vira evento separado)
  (estacasExec.data || []).forEach(e => {
    if(e.alterada_em){
      eventos.push({
        tipo: "alteracao",
        data: e.alterada_em,
        titulo: `🔄 ${e.numero} — ${e.alteracao_motivo || "alteração manual"}`,
        meta: "",
        autor: nomeDe(e.alterada_por)
      });
    }
  });

  // Ordena desc por data
  eventos.sort((a, b) => new Date(b.data) - new Date(a.data));

  // Caixa de novo comentário: registrar fatos que os eventos calculados
  // não capturam (ex.: projeto ausente na pasta do servidor) e marcar
  // quem providencia — o marcado vê a pendência no Início até resolver.
  const opcoesResp = (usuariosAtivos.data || [])
    .map(u => `<option value="${esc(u.id)}">${esc(u.nome || u.email)}</option>`).join("");
  const caixaComentario = `
    <div class="tl-nova-caixa">
      <input id="tl-novo-texto" placeholder="Registrar um comentário na obra... (ex.: projeto não localizado na pasta do servidor)" />
      <select id="tl-novo-resp" title="Quem fica responsável por providenciar">
        <option value="">— sem responsável —</option>${opcoesResp}
      </select>
      <button type="button" class="btn btn-sm" id="btn-tl-comentar">💬 Comentar</button>
    </div>`;

  if(!eventos.length){
    cont.innerHTML = `${caixaComentario}<p class="vazio">Nenhum evento registrado ainda.</p>`;
    ligarNovoComentario(obraId);
    return;
  }

  // Filtros por tipo
  const tiposPresentes = [...new Set(eventos.map(e => e.tipo))];
  const filtros = `
    <div class="tl-filtros">
      <button type="button" class="tl-filtro ativo" data-tl-tipo="">Todos (${eventos.length})</button>
      ${tiposPresentes.map(t => {
        const n = eventos.filter(e => e.tipo === t).length;
        return `<button type="button" class="tl-filtro" data-tl-tipo="${esc(t)}">
          ${TL_EVENTOS[t].icone} ${TL_EVENTOS[t].lbl} (${n})
        </button>`;
      }).join("")}
    </div>`;

  // Render eventos
  const renderEv = (lista) => lista.map(ev => {
    const meta = TL_EVENTOS[ev.tipo];
    const dia = new Date(ev.data);
    const dataFmt = dia.toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    const autorTag = ev.autor
      ? `<span class="tl-autor" title="Responsável pelo registro">👤 ${esc(ev.autor)}</span>`
      : "";

    // Comentário: mostra o responsável marcado e o estado da providência
    let linhaComent = "";
    if(ev.coment){
      const c = ev.coment;
      if(c.resolvido){
        linhaComent = `<div class="tl-meta">
          <span class="tag verde">Resolvido</span>
          ${c.resolvidoPor ? ` por ${esc(c.resolvidoPor)}` : ""}${
          c.resolvidoEm ? " em " + new Date(c.resolvidoEm).toLocaleDateString("pt-BR") : ""}</div>`;
      } else if(c.responsavel){
        linhaComent = `<div class="tl-meta">
          <span class="tag ambar">Aguardando providência</span>
          responsável: <strong>${esc(c.responsavel)}</strong>
          <button type="button" class="btn-sec btn-sm btn-tl-resolver" data-id="${esc(c.id)}">✓ Marcar resolvido</button>
        </div>`;
      }
    }

    return `<div class="tl-item" data-tl-tipo="${esc(ev.tipo)}">
      <div class="tl-icone" style="background:${meta.cor};">${meta.icone}</div>
      <div class="tl-conteudo">
        <div class="tl-titulo">${esc(ev.titulo)}</div>
        ${ev.meta ? `<div class="tl-meta">${esc(ev.meta)}</div>` : ""}
        ${linhaComent}
        <div class="tl-data">${dataFmt}${autorTag ? " · " + autorTag : ""}</div>
      </div>
    </div>`;
  }).join("");

  cont.innerHTML = `${caixaComentario}${filtros}<div class="tl-lista" id="tl-lista">${renderEv(eventos)}</div>`;
  ligarNovoComentario(obraId);

  // Resolver: delegation com bind único — o container persiste entre
  // recargas da timeline, então sem a guarda cada recarga somaria um
  // listener e um clique dispararia vários updates.
  if(!cont.dataset.tlResolverLigado){
    cont.dataset.tlResolverLigado = "1";
    cont.addEventListener("click", async (e) => {
      const btn = e.target.closest(".btn-tl-resolver");
      if(!btn) return;
      btn.disabled = true;
      const { error } = await sb.from("obras_comentarios").update({
        resolvido: true,
        resolvido_em: new Date().toISOString(),
        resolvido_por: usuarioAtual ? usuarioAtual.id : null
      }).eq("id", btn.dataset.id);
      if(error){
        btn.disabled = false;
        aviso("app-aviso", "Não foi possível resolver: " + error.message, "erro");
        return;
      }
      aviso("app-aviso", "Comentário marcado como resolvido.", "ok");
      await carregarTimelineDaObra(obraEditId);
      if(typeof carregarDashPendencias === "function") carregarDashPendencias();
    });
  }

  // Filtros listeners
  cont.querySelectorAll(".tl-filtro").forEach(b => {
    b.addEventListener("click", () => {
      cont.querySelectorAll(".tl-filtro").forEach(x => x.classList.remove("ativo"));
      b.classList.add("ativo");
      const tipo = b.dataset.tlTipo;
      const lista = $("tl-lista");
      if(!tipo) lista.innerHTML = renderEv(eventos);
      else lista.innerHTML = renderEv(eventos.filter(e => e.tipo === tipo));
    });
  });
}

/* Envio de novo comentário (a caixa é recriada a cada render, então o
   bind é refeito junto — sem risco de duplicar) */
function ligarNovoComentario(obraId){
  $("btn-tl-comentar")?.addEventListener("click", async () => {
    const texto = ($("tl-novo-texto")?.value || "").trim();
    if(!texto){ aviso("app-aviso", "Escreva o comentário.", "erro"); return; }
    const btn = $("btn-tl-comentar");
    btn.disabled = true;
    const { error } = await sb.from("obras_comentarios").insert({
      obra_id: obraId,
      autor_id: usuarioAtual ? usuarioAtual.id : null,
      responsavel_id: $("tl-novo-resp")?.value || null,
      texto
    });
    btn.disabled = false;
    if(error){
      aviso("app-aviso", "Não foi possível comentar: " + error.message, "erro");
      return;
    }
    aviso("app-aviso", "💬 Comentário registrado na timeline.", "ok");
    await carregarTimelineDaObra(obraId);
    if(typeof carregarDashPendencias === "function") carregarDashPendencias();
  });
  // Enter no campo de texto envia
  $("tl-novo-texto")?.addEventListener("keydown", (e) => {
    if(e.key === "Enter") $("btn-tl-comentar")?.click();
  });
}

/* ====================================================================
   Listener: troca de aba dispara load
   ==================================================================== */

function ligarAbasObra(){
  document.querySelectorAll("#obr-notebook button").forEach(b => {
    b.addEventListener("click", () => {
      const tab = b.dataset.tab;
      if(!obraEditId) return;
      if(tab === "equipamentos") carregarEquipamentosDaObra(obraEditId);
      else if(tab === "medicoes") carregarMedicoesDaObra(obraEditId);
      else if(tab === "rdos") carregarRDOsDaObra(obraEditId);
      else if(tab === "documentos") carregarDocumentosDaObra(obraEditId);
      else if(tab === "timeline") carregarTimelineDaObra(obraEditId);
    });
  });

  // Smart-buttons: clique vai pra aba correspondente
  document.querySelectorAll(".sb-btn[data-goto-tab]").forEach(b => {
    b.addEventListener("click", () => {
      const tab = b.dataset.gotoTab;
      const tabBtn = document.querySelector(`#obr-notebook button[data-tab="${tab}"]`);
      if(tabBtn) tabBtn.click();
    });
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarAbasObra);
} else {
  ligarAbasObra();
}

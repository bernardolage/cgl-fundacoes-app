/* ====================================================================
   Módulo: Abas extras da ficha de Obra
   Equipamentos, Medições, RDOs, Documentos, Timeline.
   Cada função é chamada quando a aba correspondente é ativada na ficha.
   Depende de obraEditId (id da obra aberta) — set em obras.js.
   ==================================================================== */

let _obrAbasContagens = { estacas: 0, equipamentos: 0, mobilizacoes: 0, rdos: 0, raiz: 0, medicoes: 0, documentos: 0 };
let _obrRdoFiltroMaq = "";   // fase 94 (#77): filtro de máquina da aba RDOs ("" todas · "sem" sem máquina · uuid); o Início define "sem"
let _obrRdoFiltroObra = null; // obra a que o filtro pertence: trocar de obra zera o filtro (salvo o preset do Início para a mesma obra)

/* ---------- Despachante: carrega tudo quando a obra abre ---------- */
async function carregarAbasObra(obraId){
  if(!obraId) return;
  // Em paralelo, busca as contagens pra smart-buttons.
  // Estacas: contamos APENAS pela tabela `estacas` (literal, sem dedup — BB são nomes legítimos).
  // Execuções órfãs aparecem no badge separado "🔗 Reconciliar".
  const [eq, med, rdoG, doc, estsTotal, estsExec, mob, ace, orf] = await Promise.all([
    sb.from("equipamentos").select("id", { count: "exact", head: true }).eq("localizacao_obra_id", obraId).eq("ativo", true),
    sb.from("medicoes").select("id", { count: "exact", head: true }).eq("obra_id", obraId),
    sb.from("rdo").select("id", { count: "exact", head: true }).eq("obra_id", obraId),
    sb.from("obras_documentos").select("id", { count: "exact", head: true }).eq("obra_id", obraId),
    sb.from("estacas").select("id", { count: "exact", head: true }).eq("obra_id", obraId),
    sb.from("estacas").select("id", { count: "exact", head: true }).eq("obra_id", obraId).eq("status", "executada"),
    sb.from("mobilizacoes").select("id", { count: "exact", head: true }).eq("obra_id", obraId).neq("status", "cancelada"),
    sb.from("acessorios").select("id", { count: "exact", head: true }).eq("local_obra_id", obraId).eq("local_tipo", "obra").eq("ativo", true),   // fase 80
    sb.from("rdo_execucao_estaca").select("id, rdo:rdo_id!inner(obra_id)", { count: "exact", head: true }).is("estaca_id", null).eq("rdo.obra_id", obraId)   // fase 94: execuções do campo sem par
  ]);
  // Guarda de corrida: outra obra foi aberta enquanto esta carregava → descarta
  if(obraId !== obraEditId) return;
  const bdV = $("obr-estv-badge");   // fase 94 (#80): badge da aba "Vincular estacas"
  if(bdV){ bdV.textContent = orf.count || ""; bdV.classList.toggle("alerta", !!orf.count); }
  _obrAbasContagens = {
    estacas: estsTotal.count || 0,
    estacas_previstas: estsTotal.count || 0,
    estacas_executadas: estsExec.count || 0,
    equipamentos: eq.count || 0,
    acessorios: ace.count || 0,
    mobilizacoes: mob.count || 0,
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
    "sb-equipamentos": [(c.equipamentos || 0) + (c.acessorios || 0), "🚜", `bens · ${c.equipamentos || 0} TAG${c.equipamentos === 1 ? "" : "s"}`],   // fase 80: TAGs + peças na obra agora
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
   ABA MOBILIZAÇÃO & EQUIPAMENTOS (15/09/2026, pedido do Bernardo)
   Em cima: as mobilizações da obra (processo — status, máquina e apoio, datas
   prevista/real, pendências abertas por setor e atrasos), lidas das mesmas views
   do quadro de Mobilizações. Embaixo: os equipamentos fisicamente na obra (TAGs
   alocadas via Movimentações), que continuam aqui porque 7 dos 27 equipamentos em
   obra hoje não pertencem a mobilização nenhuma (apoio, remessa direta).
   ==================================================================== */

// Garante o módulo Mobilizações carregado antes de abrir o drawer/modal dele a partir da obra
async function _obrMobPronto(){
  if(typeof carregarMobilizacoes === "function" && typeof _mobCarregado !== "undefined" && !_mobCarregado) await carregarMobilizacoes();
}

function _obrMobCardHTML(c, pend){
  const col = (typeof MOB_COLUNAS !== "undefined" ? MOB_COLUNAS : []).find(x => x.k === c.coluna) || {};
  const stLbl = (typeof MOB_STATUS !== "undefined" && MOB_STATUS[c.mob_status]) || c.mob_status || "—";
  const icone = (typeof MOB_TIPO_ICONE !== "undefined" && MOB_TIPO_ICONE[c.tipo_proposta]) || "⚙️";
  const setorLbl = (s) => (typeof MOB_SETOR !== "undefined" && MOB_SETOR[s]) || s || "—";
  const d = (v) => v ? dataBR(v) : "—";
  const abertas = pend.filter(p => !p.concluida);
  const atrasadas = abertas.filter(p => p.atrasada).length;
  const porSetor = {};
  abertas.forEach(p => { porSetor[p.setor] = (porSetor[p.setor] || 0) + 1; });
  const chipsSetor = Object.entries(porSetor).map(([s, n]) => `<span class="mob-chip">${esc(setorLbl(s))} ${n}</span>`).join("");
  const listaPend = abertas.slice(0, 6).map(p => `<li${p.atrasada ? ' class="txt-perigo"' : ""}>${p.atrasada ? "⏰ " : ""}${esc(p.titulo)} <span class="meta">· ${esc(setorLbl(p.setor))}${p.prazo ? " · até " + dataBR(p.prazo) : ""}</span></li>`).join("")
    + (abertas.length > 6 ? `<li class="meta">… mais ${abertas.length - 6}</li>` : "");
  const datas = [
    ["Prevista", c.data_mobilizacao_prev], ["Saída", c.data_saida_real], ["Chegada", c.data_chegada_real], ["Desmob.", c.data_desmob_real]
  ].filter(([, v]) => v).map(([l, v]) => `<span class="mob-chip" title="${l}">${l}: ${d(v)}</span>`).join("");
  return `<div class="mob-card obr-mob-card" data-id="${esc(c.id)}" style="border-left-color:${col.cor || "var(--sup-3)"};cursor:pointer;" tabindex="0" role="button" aria-label="Abrir mobilização">
    <div class="mob-card-titulo">${icone} ${esc(col.label || c.coluna || "Mobilização")} <span class="mob-chip st">${esc(stLbl)}</span></div>
    <div class="mob-card-chips">
      <span class="mob-chip tag">${esc(c.equipamento_tag || "sem máquina")}</span>${c.equipamento_nome ? `<span class="meta">${esc(c.equipamento_nome)}</span>` : ""}
      ${c.apoio_tags ? `<span class="mob-chip">+ apoio: ${esc(c.apoio_tags)}</span>` : ""}
      ${datas}
    </div>
    <div class="mob-card-rodape">
      <span>${abertas.length ? `${abertas.length} pendência${abertas.length > 1 ? "s" : ""} aberta${abertas.length > 1 ? "s" : ""}${atrasadas ? ` <span class="mob-badge perigo">⏰ ${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}</span>` : ""}` : (pend.length ? `<span class="mob-badge ok">✓ ${pend.length}/${pend.length} pendências concluídas</span>` : "sem pendências cadastradas")}</span>
      <span>${chipsSetor}</span>
    </div>
    ${abertas.length ? `<ul class="obr-mob-pend" style="margin:6px 0 0 16px;padding:0;font-size:var(--txt-xs);line-height:1.6;">${listaPend}</ul>` : ""}
  </div>`;
}

async function carregarEquipamentosDaObra(obraId){
  const cont = $("obr-equip-conteudo");
  if(!cont) return;
  if(!obraId){
    cont.innerHTML = `<p class="vazio">Salve a obra primeiro.</p>`;
    return;
  }
  const [eqRes, mobRes, pendRes, vgRes] = await Promise.all([
    sb.from("vw_equipamentos_localizacao").select("*").eq("localizacao_obra_id", obraId),
    sb.from("vw_mobilizacoes_quadro").select("*").eq("obra_id", obraId).order("data_mobilizacao_prev", { ascending: true, nullsFirst: false }),
    sb.from("vw_mobilizacao_pendencias_setor").select("*").eq("obra_id", obraId),
    // fase 89: viagens que atenderam a obra (origem, destino ou obra principal), com as notas de cada uma
    sb.from("viagens").select("id,numero,data,status,finalidade,km_total,valor_total,caminhao:equipamentos!caminhao_id(codigo),funcionario:funcionarios(nome),notas:movimentacoes_ativos(id,numero,nf_numero,status,interna)")
      .or(`obra_id.eq.${obraId},origem_obra_id.eq.${obraId},destino_obra_id.eq.${obraId}`).order("data", { ascending: false }).limit(60)
  ]);
  if(obraId !== obraEditId) return; // trocou de obra enquanto carregava
  if(eqRes.error){
    cont.innerHTML = `<p class="vazio">Erro: ${esc(eqRes.error.message)}</p>`;
    return;
  }
  const data = eqRes.data;
  const mobs = mobRes.error ? [] : (mobRes.data || []);
  const pends = pendRes.error ? [] : (pendRes.data || []);

  // ---- bloco 1: mobilizações da obra ----
  const cardsMob = mobs.map(c => _obrMobCardHTML(c, pends.filter(p => p.mobilizacao_id === c.id))).join("");
  const blocoMob = `
    <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
      <h4 style="margin:0;font-size:var(--txt-md);">🚚 ${mobs.length ? `${mobs.length} mobilizaç${mobs.length > 1 ? "ões" : "ão"} desta obra` : "Mobilização"}</h4>
      ${(typeof mobPodeEditar === "function" && mobPodeEditar()) ? `<button type="button" class="btn-sec" id="btn-obr-mob-nova">+ Nova mobilização</button>` : ""}
    </div>
    ${mobRes.error ? `<p class="vazio">Não foi possível ler as mobilizações: ${esc(mobRes.error.message)}</p>`
      : (cardsMob || `<p class="vazio" style="padding:10px 0;">Nenhuma mobilização cadastrada para esta obra. A mobilização acompanha preparação, saída, chegada e as pendências de cada setor.</p>`)}
    <p style="font-size:var(--txt-xs);color:var(--txt-sutil);margin:4px 0 16px;">Clique na mobilização para abrir a ficha (pendências, transições, remessa/retorno).</p>
    <hr style="border:none;border-top:1px solid var(--borda);margin:0 0 14px;">`;

  const ligarMob = () => {
    $("btn-obr-mob-nova")?.addEventListener("click", async () => { await _obrMobPronto(); if(typeof abrirNovaMobilizacao === "function") abrirNovaMobilizacao(obraId); });
    cont.querySelectorAll(".obr-mob-card").forEach(el => {
      const abrir = async () => {
        await _obrMobPronto();
        // quadro em cache sem esta mobilização (criada depois) → recarrega antes de abrir
        if(typeof _mobCards !== "undefined" && !_mobCards.some(c => c.id === el.dataset.id) && typeof carregarMobilizacoes === "function") await carregarMobilizacoes(true);
        if(typeof abrirMobilizacao === "function") abrirMobilizacao(el.dataset.id);
      };
      el.addEventListener("click", abrir);
      el.addEventListener("keydown", (e) => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); abrir(); } });
    });
  };

  // ---- fase 89: viagens da obra (a viagem ao lado da nota; o custo já cai na aba Custos por vw_custos) ----
  const vgs = vgRes.error ? [] : (vgRes.data || []);
  const vgFin = (typeof VG_FINALIDADES === "object" && VG_FINALIDADES) || {};
  const blocoViagens = `
    <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
      <h4 style="margin:0;font-size:var(--txt-md);">🚚 Viagens desta obra <span class="contador">${vgs.length}</span></h4>
      <span class="meta">Logística: caminhão, data e as notas (remessa/retorno) de cada viagem. O custo da viagem entra rateado na aba Custos.</span>
    </div>
    ${vgRes.error ? `<p class="vazio">Não foi possível ler as viagens: ${esc(vgRes.error.message)}</p>` : vgs.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Viagem</th><th>Data</th><th>Status</th><th>Finalidade</th><th>Caminhão</th><th>Motorista</th><th>Notas</th><th class="num">km</th><th class="num">Custo</th></tr></thead>
      <tbody>${vgs.map(v => `<tr class="linha-clicavel" data-vg="${esc(v.id)}">
        <td><strong>${esc(v.numero)}</strong></td><td>${dataBR(v.data)}</td><td>${tagStatus("viagem", v.status)}</td><td>${esc(vgFin[v.finalidade] || v.finalidade || "")}</td>
        <td>${esc(v.caminhao?.codigo || "—")}</td><td>${esc(v.funcionario?.nome || "—")}</td>
        <td>${(v.notas || []).filter(n => !n.interna).map(n => linkMovimentacao(n.id, n.nf_numero ? "NF " + n.nf_numero : n.numero)).join(", ") || '<span class="meta">—</span>'}</td>
        <td class="num">${v.km_total != null ? num(v.km_total) : "—"}</td><td class="num">${v.valor_total != null ? brl(v.valor_total) : "—"}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vazio" style="padding:10px 0;">Nenhuma viagem registrada para esta obra.</p>`}
    <hr style="border:none;border-top:1px solid var(--borda);margin:14px 0;">`;

  // ---- fase 80: bens do contrato (equipamentos e acessórios que passaram pela obra) ----
  cont.innerHTML = blocoMob + blocoViagens + `<div id="obr-bens-equip"><p class="vazio">Carregando equipamentos do contrato…</p></div>
    <hr style="border:none;border-top:1px solid var(--borda);margin:14px 0;">
    <div id="obr-bens-ace"><p class="vazio">Carregando acessórios do contrato…</p></div>`;
  ligarMob();
  cont.querySelectorAll("tr[data-vg]").forEach(tr => tr.addEventListener("click", e => {
    if(e.target.closest("a.link-cad, a.link-obra")) return;
    if(irParaSecao("frota") && typeof abrirViagem === "function") abrirViagem(tr.dataset.vg, null);
  }));
  _obrBensNaObraAgora = false;
  await Promise.all([obrRenderBensEquip(obraId, data || []), obrRenderBensAce(obraId)]);
}

/* ====================================================================
   BENS DO CONTRATO (fase 80): toda TAG e toda peça que passou pela obra, com período e custo direto.
   vw_obra_equipamentos_contrato / vw_obra_acessorios_contrato; perdas e reparos vêm de acessorio_eventos.
   ==================================================================== */
let _obrBensNaObraAgora = false;
let _obrBensEquip = [];
function obrCsv(nome, linhas){
  if(!linhas.length){ aviso("app-aviso", "Nada para exportar.", "erro"); return; }
  const cab = Object.keys(linhas[0]);
  const cel = v => { const t = v == null ? "" : String(v); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const csv = [cab.join(";"), ...linhas.map(l => cab.map(k => cel(l[k])).join(";"))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${nome}_${hojeISO()}.csv`; a.click();
}
const OBR_EQ_TIPO = { perfuratriz: "Perfuratriz", bomba: "Bomba", compressor: "Compressor", gerador: "Gerador", caminhao: "Caminhão", veiculo: "Veículo" };
async function obrRenderBensEquip(obraId, naObraLoc){
  const box = $("obr-bens-equip"); if(!box) return;
  const { data, error } = await sb.from("vw_obra_equipamentos_contrato").select("*").eq("obra_id", obraId).order("chegada", { ascending: true, nullsFirst: false });
  if(obraId !== obraEditId || !$("obr-bens-equip")) return;
  if(error){ box.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  _obrBensEquip = data || [];
  const pode = podeVerMovimentacoes();
  const render = () => {
    const lst = _obrBensEquip.filter(r => !_obrBensNaObraAgora || r.na_obra_agora);
    const diasMaq = lst.reduce((t, r) => t + Number(r.dias_na_obra || 0), 0), custo = lst.reduce((t, r) => t + Number(r.custo_periodo || 0), 0);
    const metros = lst.reduce((t, r) => t + Number(r.metros_executados || 0), 0);
    box.innerHTML = `
      <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
        <h4 style="margin:0;font-size:var(--txt-md);">🚜 Equipamentos no contrato <span class="contador">${_obrBensEquip.length}</span></h4>
        <div class="serv-views" id="obr-bens-eq-views">
          <button type="button" class="serv-view-btn${_obrBensNaObraAgora ? "" : " ativo"}" data-f="todos">Todos</button>
          <button type="button" class="serv-view-btn${_obrBensNaObraAgora ? " ativo" : ""}" data-f="agora">Na obra agora (${_obrBensEquip.filter(r => r.na_obra_agora).length})</button>
        </div>
        <span style="margin-left:auto;"></span>
        ${_obrBensEquip.length ? `<button type="button" class="btn-sec btn-sm" id="btn-obr-bens-eq-csv">⬇ Exportar CSV</button>` : ""}
        ${pode ? `<button type="button" class="btn-sec btn-sm" id="btn-equip-mov-nova">+ Nova movimentação</button>` : ""}
        ${typeof sepPodePedir === "function" && sepPodePedir() ? `<button type="button" class="btn btn-sm" id="btn-obr-pedir-material" title="Lista de separação para o almoxarifado (fase 83): substitui o pedido pelo WhatsApp">📦 Pedir material ao almoxarifado</button>` : ""}
      </div>
      ${lst.length ? `<div class="tabela-rola"><table>
        <thead><tr><th>TAG</th><th>Tipo</th><th>Chegada</th><th>Saída</th><th class="num">Dias na obra</th><th>Situação</th><th class="num">Custo no período</th><th class="num">Metros (RDO)</th><th>Origem</th><th class="col-acao"></th></tr></thead>
        <tbody>${lst.map(r => `<tr>
          <td><strong>${linkEquipamento(r.equipamento_id, r.codigo)}</strong> <span class="meta">${esc(r.nome || "")}</span>${r.principal ? "" : r.origem === "mobilizacao" ? ' <span class="meta">apoio</span>' : ""}</td>
          <td>${esc(OBR_EQ_TIPO[r.tipo] || r.tipo || "")}</td>
          <td>${r.chegada ? dataBR(r.chegada) : "—"}${r.origem === "localizacao" && r.chegada ? ' <span class="meta">(desde a localização)</span>' : ""}</td>
          <td>${r.saida ? dataBR(r.saida) : "—"}</td>
          <td class="num">${r.dias_na_obra != null ? num(r.dias_na_obra) : "—"}</td>
          <td>${r.na_obra_agora ? (r.situacao_origem === "em_transito" ? '<span class="tag ambar">em trânsito</span>' : '<span class="tag azul">na obra</span>') : '<span class="tag verde">retornou</span>'}</td>
          <td class="num">${brl(r.custo_periodo)}</td>
          <td class="num">${r.metros_executados != null ? num(r.metros_executados) : "—"}</td>
          <td class="meta">${esc({ mobilizacao: "mobilização", movimentacao: "movimentação", localizacao: "localização" }[r.origem] || r.origem)}</td>
          <td class="col-acao">${pode && r.na_obra_agora && naObraLoc.some(e => e.id === r.equipamento_id) ? `<button type="button" class="btn-sec btn-sm btn-equip-devolver" data-id="${esc(r.equipamento_id)}" title="Devolver para base">↩ Devolver</button>` : ""}</td>
        </tr>`).join("")}</tbody>
        <tfoot><tr><td colspan="4"><strong>${lst.length} passagem(ns)</strong></td><td class="num"><strong>${num(diasMaq)}</strong> <span class="meta">dias·máquina</span></td><td></td><td class="num"><strong>${brl(custo)}</strong></td><td class="num">${metros ? num(metros) : ""}</td><td colspan="2"></td></tr></tfoot>
      </table></div>
      <p style="font-size:var(--txt-xs);color:var(--txt-sutil);margin-top:6px;">Período: chegada e desmobilização reais da mobilização; sem elas, as datas das movimentações de ativos; sem nenhuma, desde a última atualização da localização. Custo: só o direto (compras, saídas de estoque, manutenções e avulsos com esta obra e esta TAG no período).</p>`
        : `<p class="vazio">${_obrBensNaObraAgora ? "Nenhum equipamento na obra agora." : "Nenhum equipamento passou por esta obra."}</p>`}`;
    box.querySelectorAll("#obr-bens-eq-views .serv-view-btn").forEach(b => b.addEventListener("click", () => { _obrBensNaObraAgora = b.dataset.f === "agora"; render(); }));
    $("btn-equip-mov-nova")?.addEventListener("click", () => abrirMovimentacaoPraObra());
    $("btn-obr-pedir-material")?.addEventListener("click", () => { if(typeof abrirPedidoMaterial === "function") abrirPedidoMaterial({ obra_id: obraId }); });   // fase 83
    box.querySelectorAll(".btn-equip-devolver").forEach(b => b.addEventListener("click", () => abrirMovimentacaoPraObra("retorno", b.dataset.id)));
    $("btn-obr-bens-eq-csv")?.addEventListener("click", () => obrCsv("equipamentos_contrato", _obrBensEquip.map(r => ({
      TAG: r.codigo, Nome: r.nome || "", Tipo: OBR_EQ_TIPO[r.tipo] || r.tipo || "", Chegada: r.chegada ? dataBR(r.chegada) : "", "Saída": r.saida ? dataBR(r.saida) : "",
      "Dias na obra": r.dias_na_obra ?? "", "Situação": r.na_obra_agora ? "na obra" : "retornou", "Custo no período": Number(r.custo_periodo || 0).toFixed(2).replace(".", ","),
      "Metros (RDO)": r.metros_executados != null ? String(r.metros_executados).replace(".", ",") : "", Origem: r.origem, Apoio: r.principal ? "" : "sim" }))));
  };
  render();
}
async function obrRenderBensAce(obraId){
  const box = $("obr-bens-ace"); if(!box) return;
  const lerTudo = async () => { const out = []; for(let de = 0; out.length === de; de += 1000){ const r = await sb.from("vw_obra_acessorios_contrato").select("*").eq("obra_id", obraId).order("marcacao").range(de, de + 999); if(r.error) return r; out.push(...(r.data || [])); } return { data: out }; };
  const [pas, evs] = await Promise.all([
    lerTudo(),
    sb.from("acessorio_eventos").select("id,tipo,data,acessorio_id,observacao,autor_nome,para_descricao,acessorio:acessorios(marcacao,familia)").eq("de_ref_id", obraId).in("tipo", ["perda", "reparo"]).order("data", { ascending: false })
  ]);
  if(obraId !== obraEditId || !$("obr-bens-ace")) return;
  if(pas.error){ box.innerHTML = `<p class="vazio">Erro: ${esc(pas.error.message)}</p>`; return; }
  const lst = pas.data || [];
  const modIds = [...new Set(lst.map(r => r.modelo_id).filter(Boolean))];
  const { data: mods } = modIds.length ? await sb.from("acessorio_modelos").select("id,descricao").in("id", modIds) : { data: [] };
  if(obraId !== obraEditId || !$("obr-bens-ace")) return;
  const modDesc = {}; (mods || []).forEach(m => modDesc[m.id] = m.descricao);
  const famLbl = f => (typeof ACE_FAMILIA_LBL !== "undefined" && ACE_FAMILIA_LBL[f]) || f || "Sem família";
  const desc = r => modDesc[r.modelo_id] || [(typeof ACE_TIPO_LBL !== "undefined" && ACE_TIPO_LBL[r.tipo]) || r.tipo, r.diametro_mm ? "Ø" + r.diametro_mm : ""].filter(Boolean).join(" ");
  const agora = lst.filter(r => r.na_obra_agora), transito = lst.filter(r => r.em_transito), passaram = lst.filter(r => r.saida);
  const perdas = evs.error ? [] : (evs.data || []);
  // (a) na obra agora, por família → descrição, lista expansível
  const porFam = {};
  agora.forEach(r => { const f = famLbl(r.familia); porFam[f] = porFam[f] || {}; const d = desc(r); (porFam[f][d] = porFam[f][d] || []).push(r); });
  const blocoAgora = Object.keys(porFam).sort().map(f => { const grupos = porFam[f]; const n = Object.values(grupos).reduce((t, g) => t + g.length, 0);
    return `<details class="obr-bens-fam"><summary><strong>${esc(f)}</strong> <span class="contador">${n}</span> <span class="meta">${Object.keys(grupos).length} modelo(s)</span></summary>
      <div class="mov-ace-sug-lista">${Object.keys(grupos).sort().map(d => `<div class="mov-ace-sug-grupo"><div class="mov-ace-sug-grupo-t">${esc(d)} <span class="meta">${grupos[d].length}</span></div>
        ${grupos[d].map(r => `<div class="mov-ace-sug-item"><strong>${linkAcessorio(r.acessorio_id, r.marcacao)}</strong>${r.jogo ? ` <span class="meta">jogo ${esc(r.jogo)}</span>` : ""} <span class="meta">${r.entrada ? "desde " + dataBR(r.entrada) : ""}</span></div>`).join("")}</div>`).join("")}</div></details>`; }).join("");
  const csvLinha = r => ({ "Peça": r.marcacao, "Família": famLbl(r.familia), "Descrição": desc(r), Jogo: r.jogo || "", Entrada: r.entrada ? dataBR(r.entrada) : "", "Saída": r.saida ? dataBR(r.saida) : "", Dias: r.dias ?? "", "Situação": r.na_obra_agora ? "na obra" : r.em_transito ? "em trânsito" : "saiu" });
  box.innerHTML = `
    <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
      <h4 style="margin:0;font-size:var(--txt-md);">⚙️ Acessórios no contrato</h4>
      <span class="meta">${agora.length} na obra agora${transito.length ? ` · ${transito.length} em trânsito` : ""} · ${passaram.length} passagem(ns) encerrada(s) · ${perdas.length} perda(s)/reparo(s)</span>
    </div>
    <div class="lista-topo compacta" style="border:none;padding:0;"><strong>Na obra agora</strong> <span class="contador">${agora.length}</span>
      ${agora.length ? `<button type="button" class="btn-sec btn-sm" id="btn-obr-ace-csv-agora" style="margin-left:auto;">⬇ Exportar CSV</button>` : ""}</div>
    ${blocoAgora || `<p class="vazio">Nenhuma peça registrada na obra.</p>`}
    <div class="lista-topo compacta" style="border:none;padding:0;margin-top:12px;"><strong>Passaram pela obra</strong> <span class="contador">${passaram.length}</span>
      ${passaram.length ? `<button type="button" class="btn-sec btn-sm" id="btn-obr-ace-csv-pas" style="margin-left:auto;">⬇ Exportar CSV</button>` : ""}</div>
    ${passaram.length ? `<div class="tabela-rola"><table><thead><tr><th>Peça</th><th>Descrição</th><th>Entrada</th><th>Saída</th><th class="num">Dias</th></tr></thead>
      <tbody>${passaram.map(r => `<tr><td><strong>${linkAcessorio(r.acessorio_id, r.marcacao)}</strong></td><td>${esc(desc(r))}</td><td>${r.entrada ? dataBR(r.entrada) : "—"}</td><td>${dataBR(r.saida)}</td><td class="num">${r.dias ?? "—"}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vazio">Nenhuma peça entrou e saiu desta obra pelos registros de localização.</p>`}
    <div class="lista-topo compacta" style="border:none;padding:0;margin-top:12px;"><strong>Perdas e reparos na obra</strong> <span class="contador">${perdas.length}</span>
      ${perdas.length ? `<button type="button" class="btn-sec btn-sm" id="btn-obr-ace-csv-perdas" style="margin-left:auto;">⬇ Exportar CSV</button>` : ""}</div>
    ${perdas.length ? `<div class="tabela-rola"><table><thead><tr><th>Data</th><th>Peça</th><th>Evento</th><th>Para</th><th>Obs.</th><th>Quem</th></tr></thead>
      <tbody>${perdas.map(e => `<tr><td>${dataBR(String(e.data).slice(0, 10))}</td><td><strong>${linkAcessorio(e.acessorio_id, e.acessorio?.marcacao || "peça")}</strong></td><td><span class="tag ${e.tipo === "perda" ? "vermelho" : "ambar"}">${e.tipo === "perda" ? "perda" : "reparo"}</span></td><td class="meta">${esc(e.para_descricao || "")}</td><td class="meta">${esc(e.observacao || "")}</td><td class="meta">${esc(e.autor_nome || "")}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vazio">Nenhuma perda ou reparo registrado com origem nesta obra.</p>`}`;
  $("btn-obr-ace-csv-agora")?.addEventListener("click", () => obrCsv("acessorios_na_obra", agora.map(csvLinha)));
  $("btn-obr-ace-csv-pas")?.addEventListener("click", () => obrCsv("acessorios_passaram", passaram.map(csvLinha)));
  $("btn-obr-ace-csv-perdas")?.addEventListener("click", () => obrCsv("acessorios_perdas_reparos", perdas.map(e => ({ Data: dataBR(String(e.data).slice(0, 10)), "Peça": e.acessorio?.marcacao || "", Evento: e.tipo, Para: e.para_descricao || "", Obs: e.observacao || "", Quem: e.autor_nome || "" }))));
}

function tagStatusEquip(st){
  const cores = { disponivel:"verde", em_uso:"azul", em_manutencao:"ambar", inativo:"cinza" };
  const lbls  = { disponivel:"Disponível", em_uso:"Em uso", em_manutencao:"Manutenção", inativo:"Inativo" };
  return `<span class="tag ${cores[st]||"cinza"}">${esc(lbls[st]||st)}</span>`;
}

/* Atalho: abre o módulo Movimentações com obra pré-preenchida */
function abrirMovimentacaoPraObra(tipo = "remessa", equipamentoIdPreSelecionado = null){
  // Muda pra seção Movimentações
  if(!irParaSecao("movimentacoes")) return; // fase 53: barra quem não tem o módulo no menu
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
        if(typeof movDefinirObra === "function") movDefinirObra("origem", obraEditId);
      } else {
        $("mov-destino-tipo").value = "obra";
        $("mov-destino-descricao").value = obraTxt;
        if(typeof movDefinirObra === "function") movDefinirObra("destino", obraEditId);
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
  const [{ data, error }, sinal] = await Promise.all([
    sb.from("medicoes")
      .select("id,numero,data_medicao,percentual,valor_medido,valor_final,tipo_medicao,desconto_sinal,status,observacoes,origem")
      .eq("obra_id", obraId)
      .order("data_medicao", { ascending: false }),
    typeof calcularSaldoSinalObra === "function" ? calcularSaldoSinalObra(obraId, null) : Promise.resolve(null)
  ]);
  if(error){
    cont.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`;
    return;
  }
  const valorContratado = Number($("obr-valor").value || 0);
  const valorEfetivo = (m) => Number(m.valor_final) || Number(m.valor_medido) || 0;
  const totalMedido = (data || []).filter(m => m.status !== "rejeitada").reduce((s,m) => s + valorEfetivo(m), 0);
  const saldo = valorContratado - totalMedido;
  const pctTotal = valorContratado > 0 ? (totalMedido / valorContratado * 100) : 0;

  // Painel do sinal contratual: recebido, abatido nas medições seguintes e o que falta abater
  let blocoSinal = "";
  if(sinal && sinal.recebido > 0){
    const modeloLbl = (typeof SINAL_MODELOS !== "undefined" && SINAL_MODELOS[sinal.modelo]) || sinal.modelo;
    const zerado = sinal.saldoSinal < 0.005;
    blocoSinal = `
    <div style="background:${zerado ? "var(--sucesso-bg)" : "var(--marca-50)"};border-left:3px solid ${zerado ? "var(--sucesso)" : "var(--marca-600)"};padding:10px 14px;margin-bottom:14px;font-size:var(--txt-sm);">
      <strong>Sinal contratual</strong> · ${(sinal.pctSinal * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% do contrato atual (${brl(sinal.valorContratado)})
      <div class="indicadores" style="margin:8px 0 6px;">
        <div class="ind"><div class="num">${brl(sinal.recebido)}</div><div class="rot">Recebido (${sinal.qtdSinais} medição${sinal.qtdSinais > 1 ? "ões" : ""})</div></div>
        <div class="ind"><div class="num">${brl(sinal.abatido)}</div><div class="rot">Já abatido</div></div>
        <div class="ind"><div class="num" style="color:${zerado ? "var(--sucesso)" : "var(--aviso-txt)"};">${brl(sinal.saldoSinal)}</div><div class="rot">A abater</div></div>
        <div class="ind"><div class="num">${brl(sinal.saldoAMedir)}</div><div class="rot">Saldo a medir</div></div>
      </div>
      <div class="meta">Modelo: ${esc(modeloLbl)} — define-se em Parâmetros. ${zerado ? "Sinal totalmente abatido." : sinal.modelo === "cliente" ? "O cliente já consumiu o sinal no quadro dele; conciliar contra o saldo do boletim do cliente." : "Cada nova medição sugere o abatimento pelo botão ✨ na aba Resumo."}</div>
    </div>`;
  }

  const stats = `${blocoSinal}
    <div class="indicadores" style="margin-bottom:14px;">
      <div class="ind"><div class="num">${data.length}</div><div class="rot">Medições</div></div>
      <div class="ind"><div class="num">${brl(totalMedido)}</div><div class="rot">Total medido</div></div>
      <div class="ind"><div class="num">${brl(saldo)}</div><div class="rot">Saldo contratual</div></div>
      <div class="ind"><div class="num">${pctTotal.toFixed(1)}%</div><div class="rot">% medido</div></div>
    </div>`;

  // fase 88 (#54): boletim já emitido (PDF do Maya ou da planilha) entra conferido e nasce aprovado
  const podeImportar = typeof medImpPodeImportar === "function" && medImpPodeImportar();
  const btnImportar = podeImportar
    ? `<button type="button" class="btn-sec" id="btn-medic-importar" title="Lê o PDF do boletim que a CGL enviou ao cliente (Maya ou planilha), você confere contra a cascata de preço e a medição nasce aprovada com o PDF anexado">📄 Importar boletim (PDF)</button>`
    : "";
  if(!data || !data.length){
    cont.innerHTML = `${stats}<p class="vazio">Nenhuma medição registrada.<br>
      <span style="display:inline-flex;gap:8px;margin-top:10px;">${btnImportar}<button type="button" class="btn" id="btn-medic-nova">+ Nova medição</button></span></p>`;
    $("btn-medic-nova")?.addEventListener("click", abrirMedicaoPraObra);
    $("btn-medic-importar")?.addEventListener("click", () => abrirImportBoletimPDF(obraId));
    return;
  }
  const tipoLbl = { sinal_contratual: "Sinal", quinzenal: "Quinzenal", final: "Final", avulsa: "Avulsa" };
  const linhas = data.map(m => `<tr class="linha-clicavel" data-id="${esc(m.id)}">
    <td>${esc(m.numero)}${m.origem === "importada_pdf" ? ' <span title="Importada do boletim (PDF)">📄</span>' : ""}</td>
    <td>${dataBR(m.data_medicao)}</td>
    <td>${esc(tipoLbl[m.tipo_medicao] || m.tipo_medicao || "—")}</td>
    <td>${num(m.percentual)}%</td>
    <td>${tagStatus("medicao", m.status)}</td>
    <td class="num">${Number(m.desconto_sinal) ? "− " + brl(m.desconto_sinal) : "—"}</td>
    <td class="num">${brl(valorEfetivo(m))}</td>
  </tr>`).join("");
  cont.innerHTML = `${stats}
    <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
      <h4 style="margin:0;font-size:var(--txt-md);">Medições da obra</h4>
      <span style="display:inline-flex;gap:8px;">${btnImportar}<button type="button" class="btn" id="btn-medic-nova">+ Nova medição</button></span>
    </div>
    <div class="tabela-rola"><table>
      <thead><tr><th>Nº</th><th>Data</th><th>Tipo</th><th>%</th><th>Status</th><th class="num" title="Abatimento do sinal contratual nesta medição">Sinal abatido</th><th class="num">Valor</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
  `;
  $("btn-medic-nova")?.addEventListener("click", abrirMedicaoPraObra);
  $("btn-medic-importar")?.addEventListener("click", () => abrirImportBoletimPDF(obraId));
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
    // !inner + eq: só execuções desta obra (antes vinha a tabela inteira)
    sb.from("rdo_execucao_estaca").select("rdo_id, estaca_id, rdo:rdo_id!inner(obra_id)").eq("rdo.obra_id", obraId)
  ]);
  if(resumoRes.error){ cont.innerHTML = `<p class="vazio">Erro: ${esc(resumoRes.error.message)}</p>`; return; }
  const todos = resumoRes.data || [];

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

  // fase 94 (#77): um diário por máquina — filtro por máquina, coluna Máquina e aviso dos diários sem máquina
  if(_obrRdoFiltroObra !== obraId){ _obrRdoFiltroMaq = ""; _obrRdoFiltroObra = obraId; }
  const maquinas = [...new Map(todos.filter(r => r.equipamento_id).map(r => [r.equipamento_id, r.maquina || "?"])).entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR", { numeric: true }));
  const semMaq = todos.filter(r => !r.equipamento_id).length;
  if(_obrRdoFiltroMaq && _obrRdoFiltroMaq !== "sem" && !maquinas.some(([id]) => id === _obrRdoFiltroMaq)) _obrRdoFiltroMaq = "";
  const data = todos.filter(r => _obrRdoFiltroMaq === "sem" ? !r.equipamento_id : (!_obrRdoFiltroMaq || r.equipamento_id === _obrRdoFiltroMaq));

  const header = `
    <div class="lista-topo" style="border:none;padding:0;margin-bottom:10px;">
      <h4 style="margin:0;font-size:var(--txt-md);">RDOs registrados <span class="contador">${data.length} de ${todos.length}</span></h4>
      <select id="obr-rdo-f-maq" title="Fase 94: um diário por máquina na mesma data" style="max-width:220px;">
        <option value="">Todas as máquinas</option>
        <option value="sem"${_obrRdoFiltroMaq === "sem" ? " selected" : ""}>Sem máquina${semMaq ? ` (${semMaq})` : ""}</option>
        ${maquinas.map(([id, cod]) => `<option value="${esc(id)}"${_obrRdoFiltroMaq === id ? " selected" : ""}>${esc(cod)}</option>`).join("")}
      </select>
      <button type="button" class="btn" id="btn-rdo-novo">+ Novo RDO</button>
    </div>
    ${semMaq ? `<div style="background:var(--aviso-bg);border-left:3px solid var(--aviso);padding:8px 12px;margin-bottom:10px;font-size:var(--txt-sm);">
      ⚠️ <strong>${semMaq} diário${semMaq > 1 ? "s" : ""} sem máquina</strong> — abra cada um e informe a máquina no cabeçalho; até lá ficam em "Para regularizar" do responsável da obra. Diário com execuções de duas máquinas tem o botão "Dividir por máquina".
    </div>` : ""}`;
  const ligarFiltroMaq = () => $("obr-rdo-f-maq")?.addEventListener("change", (ev) => { _obrRdoFiltroMaq = ev.target.value; carregarRDOsDaObra(obraId); });

  if(!data || !data.length){
    cont.innerHTML = `${header}<p class="vazio">${todos.length ? "Nenhum RDO para esta máquina." : "Nenhum RDO registrado."}</p>`;
    $("btn-rdo-novo")?.addEventListener("click", abrirRdoPraObra);
    ligarFiltroMaq();
    return;
  }

  // Mini-gráfico de produção (últimos 30 dias). Fase 94: soma a obra no dia (todas as máquinas), o "Resumo diário"
  const porDia = {};
  todos.forEach(r => { porDia[r.data] = (porDia[r.data] || 0) + (Number(r.metragem_total) || 0); });
  const ultimos = Object.entries(porDia).sort((a, b) => a[0].localeCompare(b[0])).slice(-30);
  const maxProd = Math.max(...ultimos.map(([, m]) => m), 1);
  const barras = ultimos.map(([d, m]) => {
    const h = Math.round((m / maxProd) * 60);
    return `<div title="${dataBR(d)}: ${num(m)} m" style="display:inline-block;width:14px;height:60px;vertical-align:bottom;margin:0 1px;">
      <div style="background:var(--marca-600);width:100%;height:${h}px;margin-top:${60-h}px;border-radius:2px 2px 0 0;"></div>
    </div>`;
  }).join("");
  const grafico = `
    <div style="background:var(--sup-2);border-radius:6px;padding:12px;margin-bottom:14px;">
      <div style="font-size:var(--txt-sm);color:var(--txt-sec);margin-bottom:6px;font-weight:600;">📊 Metragem diária da obra — últimos ${ultimos.length} dias (todas as máquinas)</div>
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
      <td>${r.equipamento_id ? esc(r.maquina || "?") : '<span class="tag ambar" title="Diário sem máquina: abra e informe a máquina no cabeçalho">sem máquina</span>'}</td>
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
        <th>Data</th><th title="Fase 94: um diário por máquina">Máquina</th><th>Tipo de serviço</th><th>Estacas</th>
        <th title="Execuções vinculadas a estacas cadastradas / total de execuções">Vinculadas</th>
        <th class="num">Metragem</th><th class="num">Concreto</th><th>Status</th>
      </tr></thead>
      <tbody>${linhas}</tbody></table></div>`;

  $("btn-rdo-novo")?.addEventListener("click", abrirRdoPraObra);
  ligarFiltroMaq();
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
  const obraOrigem = (typeof obraEditId !== "undefined" && obraEditId) || null;
  const nav = document.querySelector('nav button[data-secao="rdo"]');
  if(nav) nav.click();
  setTimeout(() => {
    if(typeof abrirRDO === "function") abrirRDO(id);
    // chamado #8 (Isaque, 16/09/2026): o Voltar da ficha do RDO devolve para esta obra, aba RDOs
    if(typeof _rdoVoltarPara !== "undefined") _rdoVoltarPara = obraOrigem;
  }, 250);
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
  nfs: "Nota fiscal de serviço",   /* lote S39, chamado #27 */
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
      <h4 style="margin:0 0 8px;font-size:var(--txt-md);">📤 Enviar novo documento</h4>
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
      // lote S45 (L8): o boletim importado (origem medicao_importada) aponta para o mesmo PDF da medição
      // (medicoes.arquivo_origem_url): sem 🗑️ aqui, senão a medição ficaria sem o arquivo.
      const boletim = d.origem === "medicao_importada";
      const origemBadge = d.origem === "movimentacao_ativa"
        ? '<span class="tag azul" style="font-size:var(--txt-xs);">auto</span>'
        : boletim ? '<span class="tag azul" style="font-size:var(--txt-xs);" title="PDF da medição importada; abre também pela ficha da medição">boletim</span>' : "";
      return `<tr>
        <td>${isImg ? '🖼️' : '📄'} ${esc(d.nome)} ${origemBadge}</td>
        <td>${esc(d.descricao||"—")}</td>
        <td>${tamKB}</td>
        <td>${new Date(d.created_at).toLocaleDateString("pt-BR")}</td>
        <td class="col-acao">
          <button type="button" class="btn-sec btn-sm btn-doc-baixar" data-path="${esc(d.storage_path)}" data-nome="${esc(d.nome)}" title="Baixar">⬇️</button>
          ${boletim ? "" : `<button type="button" class="btn-sec btn-sm btn-doc-excluir txt-perigo" data-id="${esc(d.id)}" data-path="${esc(d.storage_path)}" title="Excluir">🗑️</button>`}
        </td>
      </tr>`;
    }).join("");
    return `<div style="margin-bottom:14px;">
      <h4 style="font-size:var(--txt-sm);color:var(--marca-600);text-transform:uppercase;letter-spacing:.4px;margin:0 0 6px;">${esc(cat)} (${docs.length})</h4>
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

/* MIME por extensão: o navegador manda "application/octet-stream" (ou vazio) para .dwg/.dxf/.zip
   e o bucket obras-documentos recusava. Lista alinhada aos allowed_mime_types do bucket. */
const MIME_POR_EXTENSAO = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword", xls: "application/vnd.ms-excel", txt: "text/plain", csv: "text/csv",
  dwg: "image/vnd.dwg", dxf: "image/vnd.dxf", zip: "application/zip"
};
function mimeDoArquivo(file, ext){
  const t = String(file.type || "").toLowerCase();
  if(t && t !== "application/octet-stream") return t;
  return MIME_POR_EXTENSAO[ext] || "application/octet-stream";
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
    // Extensão entra no caminho do storage: só letras/dígitos (1-5), senão "bin"
    const ext = (String(file.name.split(".").pop()||"").toLowerCase().match(/^[a-z0-9]{1,5}$/)||[])[0] || "bin";
    const nomeUnico = `${obraId}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const mime = mimeDoArquivo(file, ext);
    // supabase-js ignora `contentType` quando o corpo é File/Blob (vale o type do próprio arquivo): reembala com o MIME da extensão
    const corpo = file.type === mime ? file : new Blob([file], { type: mime });
    const { error: errUp } = await sb.storage.from("obras-documentos").upload(nomeUnico, corpo, {
      cacheControl: "3600", contentType: mime, upsert: false
    });
    if(errUp) throw errUp;

    const { data:{ user } } = await sb.auth.getUser();
    const reg = {
      obra_id: obraId,
      categoria: $("doc-categoria").value,
      nome: file.name,
      descricao: $("doc-descricao").value.trim() || null,
      storage_path: nomeUnico,
      mime_type: mime,
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
    sb.from("movimentacoes_ativos").select("id,numero,tipo,status,data_emissao,destino_descricao,origem_descricao,valor_total_produtos,criado_por,interna,viagem:viagens(id,numero,data,caminhao:equipamentos!caminhao_id(codigo))").or(`origem_obra_id.eq.${obraId},destino_obra_id.eq.${obraId}`).order("data_emissao", { ascending: false }),
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
      titulo: `${m.numero} · ${m.interna ? "itens da viagem" : m.tipo} (${lbl})`,
      // fase 89: a viagem que levou a nota (número, data e caminhão) ao lado
      meta: `${m.origem_descricao || "?"} → ${m.destino_descricao || "?"}${m.valor_total_produtos ? " · " + brl(m.valor_total_produtos) : ""}${m.viagem ? ` · Viagem ${m.viagem.numero} em ${dataBR(m.viagem.data)}${m.viagem.caminhao ? " (" + m.viagem.caminhao.codigo + ")" : ""}` : ""}`,
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
      else if(tab === "vincular" && typeof estvCarregar === "function") estvCarregar(obraEditId);   // fase 94 (#80)
      else if(tab === "documentos") carregarDocumentosDaObra(obraEditId);
      else if(tab === "timeline") carregarTimelineDaObra(obraEditId);
      else if(tab === "custos" && typeof custosRender === "function") custosRender("obr-custos", { obra_id: obraEditId });
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

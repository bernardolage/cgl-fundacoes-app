/* ====================================================================
   Mobilizações: visão Cronograma (fase 189a, #230). Prefixo mcr-.
   O cronograma de equipamentos da RG 11.15 é uma VISÃO das mobilizações (D1): nada é cadastrado duas vezes.
   - Uma linha por máquina ativa (perfuratriz, bomba, compressor, gerador), agrupada como na planilha (D4, D5):
     vw_equipamentos_cronograma. O grupo vem de equipamentos.grupo_cronograma ou da metodologia.
   - Início = chegada real ou início previsto; término = desmobilização real ou prevista; sem ela, a previsão de
     término da obra (fase 140, vw_sc_obra_andamento) ou a data prevista da obra, com aviso (D6).
   - A previsão de término muda pela RPC mobilizacao_prever_termino: só data_desmob_prev, com chatter. Status e
     localização continuam pela ficha da mobilização (gatilho, §8).
   - Reserva (D2): orçamento em negociação ou nome livre + data. Converter = equipamento_reserva_converter.
   - Exporta .xlsx no leiaute da RG 11.15 (SheetJS de vendor/).
   ==================================================================== */

let _mcrLinhas    = [];      // linhas de vw_equipamentos_cronograma
let _mcrPrevObra  = {};      // obra_id -> previsão de término pelo ritmo (vw_sc_obra_andamento, fase 140)
let _mcrCarregado = false;
let _mcrOrcs      = null;    // orçamentos em negociação (lidos ao abrir a primeira reserva)
let _mcrRes       = null;    // { linha, reserva } aberta no modal
const _mcrFiltro  = { metodo: "", cliente: "", situacao: "", livreAte: "" };

// Mesma lista de mobilizacoes_write (o banco confere de novo na RPC e na policy); auditor fica fora
const MCR_CARGOS_EDITAM = ["diretor", "admin", "engenheiro", "assistente_engenharia", "comercial", "encarregado", "logistica"];
const MCR_METODO = { helice: "Hélice contínua", secante: "Secante", raiz: "Estaca raiz", trado: "Trado", bomba: "Bomba de concreto", compressor: "Compressor", gerador: "Gerador" };
const MCR_ORDEM  = ["helice", "secante", "raiz", "trado", "bomba", "compressor", "gerador"];
const MCR_SITUACAO = { obra: "Em obra", patio: "Pátio", manutencao: "Manutenção", livre: "Livre" };

function mcrPodeEditar(){ return !!usuarioAtual && MCR_CARGOS_EDITAM.includes(usuarioAtual.cargo); }

async function mcrCarregar(forcar){
  if(_mcrCarregado && !forcar) return;
  const [cRes, pRes] = await Promise.all([
    sb.from("vw_equipamentos_cronograma").select("*").order("codigo"),
    sb.from("vw_sc_obra_andamento").select("obra_id,previsao_termino")   // fase 140; erro = só perde a estimativa
  ]);
  if(cRes.error) aviso("app-aviso", "Não foi possível carregar o cronograma: " + cRes.error.message, "erro");
  _mcrLinhas = cRes.error ? [] : (cRes.data || []);
  _mcrPrevObra = {};
  (pRes.error ? [] : (pRes.data || [])).forEach(p => { if(p.previsao_termino) _mcrPrevObra[p.obra_id] = String(p.previsao_termino).slice(0, 10); });
  _mcrCarregado = true;
}

/* ---------- Regras da linha ---------- */
function mcrSituacao(l){
  if(l.mob_id && ["em_obra", "em_transito"].includes(l.mob_status)) return "obra";
  if(l.status === "em_manutencao" || l.localizacao_tipo === "fornecedor_manutencao") return "manutencao";
  return "patio";
}
function mcrLivre(l){ return mcrSituacao(l) === "patio" && !l.mob_id && !l.prox_mob_id && !l.reserva_id; }
// término efetivo: { data, origem } (mob = da mobilização; ritmo = previsão da obra pela produção; obra = data prevista da obra)
function mcrTermino(l){
  if(!l.mob_id) return null;
  if(l.termino) return { data: l.termino, origem: "mob" };
  if(_mcrPrevObra[l.obra_id]) return { data: _mcrPrevObra[l.obra_id], origem: "ritmo" };
  if(l.obra_fim_prevista) return { data: l.obra_fim_prevista, origem: "obra" };
  return null;
}
// data em que a máquina fica livre (ISO) ou null quando não se sabe
function mcrLivreEm(l){
  if(l.mob_id){ const t = mcrTermino(l); return t ? t.data : null; }
  if(mcrSituacao(l) === "manutencao") return null;
  return hojeISO();
}
function mcrOndeTexto(l){
  if(l.localizacao_tipo === "fornecedor_manutencao") return "Manutenção externa";
  if(l.status === "em_manutencao") return "Manutenção";
  if(l.localizacao_tipo === "base") return "Pátio";
  return l.localizacao_descricao || MCR_SITUACAO[mcrSituacao(l)] || "";
}
function mcrProximaTexto(l){
  if(l.prox_mob_id) return [l.prox_obra_codigo, l.prox_cliente].filter(Boolean).join(" · ");
  if(l.reserva_id) return `${l.reserva_rotulo || "Reserva"} (reserva)`;
  return "";
}

/* ---------- Filtro e agrupamento ---------- */
function mcrFiltradas(){
  const termo = ($("mob-busca")?.value || "").trim().toLowerCase();
  const f = _mcrFiltro;
  return _mcrLinhas.filter(l => {
    if(f.metodo && (l.metodologia || "") !== f.metodo) return false;
    if(f.cliente && l.cliente !== f.cliente && l.prox_cliente !== f.cliente) return false;
    if(f.situacao === "livre" ? !mcrLivre(l) : (f.situacao && mcrSituacao(l) !== f.situacao)) return false;
    if(f.livreAte){ const d = mcrLivreEm(l); if(!d || d > f.livreAte) return false; }
    if(termo && !`${l.codigo} ${l.nome || ""} ${l.obra_codigo || ""} ${l.obra_nome || ""} ${l.cliente || ""} ${l.operadores || ""} ${mcrProximaTexto(l)}`.toLowerCase().includes(termo)) return false;
    return true;
  });
}
function mcrGrupos(linhas){
  const mapa = new Map();
  linhas.forEach(l => {
    const k = l.grupo || "Sem metodologia";
    if(!mapa.has(k)) mapa.set(k, { grupo: k, metodo: l.metodologia || "", linhas: [] });
    mapa.get(k).linhas.push(l);
  });
  const ordem = g => { const i = MCR_ORDEM.indexOf(g.metodo); return i < 0 ? 99 : i; };
  const grupos = [...mapa.values()].sort((a, b) => ordem(a) - ordem(b) || a.grupo.localeCompare(b.grupo, "pt-BR", { numeric: true }));
  grupos.forEach(g => g.linhas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR", { numeric: true })));
  return grupos;
}

/* ---------- Render ---------- */
function renderCronogramaMob(){
  const cont = $("mob-conteudo");
  if(!cont) return;
  if(!_mcrCarregado){
    cont.innerHTML = `<p class="vazio">Carregando cronograma…</p>`;
    mcrCarregar(false).then(() => { if(_mobView === "cronograma") renderCronogramaMob(); });
    return;
  }
  const pode = mcrPodeEditar();
  const linhas = mcrFiltradas();
  const grupos = mcrGrupos(linhas);
  const clientes = [...new Set(_mcrLinhas.flatMap(l => [l.cliente, l.prox_cliente]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const metodos = MCR_ORDEM.filter(m => _mcrLinhas.some(l => l.metodologia === m));
  const opt = (v, rot, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(rot)}</option>`;
  const semDesmob = _mcrLinhas.filter(l => l.mob_id && !l.data_desmob_prev && !l.termino).length;

  cont.innerHTML = `
    <p class="meta">Cronograma de equipamentos (RG 11.15) tirado das mobilizações: uma linha por máquina, a obra atual, até quando fica e a próxima obra. A previsão de término muda a desmobilização prevista da mobilização e fica registrada na conversa dela. Status e localização continuam pela ficha da mobilização.</p>
    <div class="mcr-filtros">
      <select id="mcr-f-metodo" aria-label="Metodologia"><option value="">Todas as metodologias</option>${metodos.map(m => opt(m, MCR_METODO[m], _mcrFiltro.metodo)).join("")}</select>
      <select id="mcr-f-cliente" aria-label="Cliente"><option value="">Todos os clientes</option>${clientes.map(c => opt(c, c, _mcrFiltro.cliente)).join("")}</select>
      <select id="mcr-f-situacao" aria-label="Situação"><option value="">Qualquer situação</option>${Object.keys(MCR_SITUACAO).map(s => opt(s, MCR_SITUACAO[s], _mcrFiltro.situacao)).join("")}</select>
      <label title="Máquinas que ficam livres até esta data (fim da obra atual ou já livres no pátio)">Livre até <input type="date" id="mcr-f-livre" value="${esc(_mcrFiltro.livreAte)}" /></label>
      <span class="contador" id="mcr-contador">${linhas.length} de ${_mcrLinhas.length} máquinas</span>
      ${semDesmob ? `<span class="meta mcr-aviso" title="Mobilização em obra sem desmobilização prevista: o término mostrado é a previsão da obra. Informe a data na coluna Previsão de término.">${semDesmob} sem desmobilização prevista</span>` : ""}
      <button type="button" class="btn-sec btn-sm" id="btn-mcr-xlsx" style="margin-left:auto;" title="Baixa a planilha no leiaute da RG 11.15, com os filtros aplicados">Exportar .xlsx</button>
    </div>
    ${grupos.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Equipamento</th><th>Metodologia</th><th>Cliente</th><th>Obra</th><th>Operador</th><th>Início da execução</th><th>Previsão de término</th><th>Próxima obra</th><th>Início da próxima</th>${pode ? "<th></th>" : ""}</tr></thead>
      <tbody>${grupos.map(g => `<tr class="mcr-grupo" data-metodo="${esc(g.metodo)}"><td colspan="${pode ? 10 : 9}">${esc(g.grupo)} <span class="contador">(${g.linhas.length})</span></td></tr>${g.linhas.map(l => mcrLinhaHTML(l, pode)).join("")}`).join("")}</tbody>
    </table></div>` : uiVazio("Nenhuma máquina com esses filtros.")}`;
  mcrLigar(cont);
}

function mcrLinhaHTML(l, pode){
  const t = mcrTermino(l);
  const linkMob = (id, cod, txt) => `<a href="#" data-mcr-mob="${esc(id)}">${uiCodigo(cod || "obra")}</a>${txt ? ` <span class="meta">${esc(txt)}</span>` : ""}`;
  const stMob = l.mob_id && l.mob_status !== "em_obra" ? ` <span class="mob-chip st">${esc((typeof MOB_STATUS === "object" && MOB_STATUS[l.mob_status]) || l.mob_status)}</span>` : "";
  const apoio = l.mob_id && l.mob_como === "apoio" ? ` <span class="meta" title="A máquina está como apoio desta mobilização">apoio</span>` : "";
  const estimativa = t && t.origem !== "mob"
    ? `<div class="meta mcr-aviso" title="${esc(t.origem === "ritmo" ? "Previsão de término da obra pelo ritmo de produção (fase 140)" : "Data prevista de término da obra")}">sem desmobilização prevista · obra: ${esc(dataBR(t.data))}</div>`
    : (l.mob_id && !t ? `<div class="meta mcr-aviso">sem desmobilização prevista</div>` : "");
  let termino;
  if(l.mob_id && pode){
    termino = `<input type="date" class="mcr-termino" data-mcr-termino="${esc(l.mob_id)}" value="${esc(l.data_desmob_prev || "")}"${l.inicio_real && l.inicio ? ` min="${esc(l.inicio)}"` : ""} aria-label="Previsão de término da ${esc(l.codigo)}" title="Muda a desmobilização prevista da mobilização (fica registrado na conversa dela)" />${estimativa}`;
  } else {
    termino = l.mob_id ? `${t && t.origem === "mob" ? esc(dataBR(t.data)) : '<span class="meta">—</span>'}${estimativa}` : '<span class="meta">—</span>';
  }
  const operador = l.operadores ? esc(l.operadores)
    : (l.mob_id ? `<span class="meta" title="A equipe da mobilização não tem operador. Informe na aba Equipe da ficha da mobilização.">sem operador na equipe</span>` : '<span class="meta">—</span>');
  const reserva = l.reserva_id
    ? `<button type="button" class="mcr-reserva" data-mcr-res="${esc(l.reserva_id)}" data-mcr-eq="${esc(l.equipamento_id)}" title="Reserva para obra em negociação${l.reserva_fim ? " até " + esc(dataBR(l.reserva_fim)) : ""}. Clique para abrir.">Reserva: ${esc(l.reserva_rotulo || "")}</button>`
    : "";
  const proxima = l.prox_mob_id
    ? `${linkMob(l.prox_mob_id, l.prox_obra_codigo, l.prox_cliente)}${reserva ? `<br>${/* html */ reserva}` : ""}`
    : (reserva || '<span class="meta">—</span>');
  const proxInicio = [l.prox_mob_id ? (l.prox_inicio ? dataBR(l.prox_inicio) : "sem data") : "", l.reserva_id ? dataBR(l.reserva_data) + " (reserva)" : ""].filter(Boolean);
  return `<tr>
    <td>${uiCodigo(l.codigo)}${l.nome ? ` <span class="meta">${esc(l.nome)}</span>` : ""}</td>
    <td>${esc(MCR_METODO[l.metodologia] || "—")}</td>
    <td>${l.mob_id ? esc(l.cliente || "") : `<span class="meta">${esc(mcrOndeTexto(l))}</span>`}</td>
    <td>${l.mob_id ? `${linkMob(l.mob_id, l.obra_codigo, l.obra_nome)}${stMob}${apoio}` : '<span class="meta">—</span>'}</td>
    <td>${operador}</td>
    <td>${l.inicio ? `${esc(dataBR(l.inicio))}${l.inicio_real ? "" : ' <span class="meta" title="Início previsto (a máquina ainda não chegou)">prev.</span>'}` : '<span class="meta">—</span>'}</td>
    <td>${/* html */ termino}</td>
    <td>${/* html */ proxima}</td>
    <td>${proxInicio.length ? proxInicio.map(x => esc(x)).join("<br>") : '<span class="meta">—</span>'}</td>
    ${pode ? `<td><button type="button" class="btn-sec btn-sm" data-mcr-reservar="${esc(l.equipamento_id)}" title="Reservar a ${esc(l.codigo)} para uma obra em negociação">Reservar</button>${l.reserva_id ? ` <button type="button" class="btn-sec btn-sm" data-mcr-conv="${esc(l.reserva_id)}" data-mcr-eq="${esc(l.equipamento_id)}" title="A reserva vira mobilização prevista">Converter</button>` : ""}</td>` : ""}
  </tr>`;
}

function mcrLigar(cont){
  const muda = (id, campo) => $(id)?.addEventListener("change", () => { _mcrFiltro[campo] = $(id).value || ""; renderCronogramaMob(); });
  muda("mcr-f-metodo", "metodo"); muda("mcr-f-cliente", "cliente"); muda("mcr-f-situacao", "situacao"); muda("mcr-f-livre", "livreAte");
  $("btn-mcr-xlsx")?.addEventListener("click", () => mcrExportarXlsx(mcrFiltradas()));
  cont.querySelectorAll("a[data-mcr-mob]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); abrirMobilizacao(a.dataset.mcrMob); }));
  cont.querySelectorAll("input[data-mcr-termino]").forEach(inp => inp.addEventListener("change", () => mcrPreverTermino(inp)));
  cont.querySelectorAll("button[data-mcr-reservar]").forEach(b => b.addEventListener("click", () => mcrAbrirReserva(b.dataset.mcrReservar, null)));
  cont.querySelectorAll("button[data-mcr-res]").forEach(b => b.addEventListener("click", () => mcrAbrirReserva(b.dataset.mcrEq, b.dataset.mcrRes)));
  cont.querySelectorAll("button[data-mcr-conv]").forEach(b => b.addEventListener("click", () => mcrAbrirReserva(b.dataset.mcrEq, b.dataset.mcrConv, true)));
}

async function mcrRecarregar(){
  _mcrCarregado = false;
  if(typeof carregarMobilizacoes === "function") await carregarMobilizacoes(true);   // renderMobilizacoes relê o cronograma
  else { await mcrCarregar(true); renderCronogramaMob(); }
}

/* ---------- Previsão de término (D1, D9) ---------- */
async function mcrPreverTermino(inp){
  const mob = inp.dataset.mcrTermino, data = inp.value;
  if(!mcrPodeEditar()){ aviso("app-aviso", "Seu cargo não pode alterar esta mobilização.", "erro"); return; }
  if(!data){ aviso("app-aviso", "Informe a data. Para tirar a previsão, use a ficha da mobilização.", "erro"); renderCronogramaMob(); return; }
  inp.disabled = true;
  const { error } = await sb.rpc("mobilizacao_prever_termino", { p_mob: mob, p_data: data, p_motivo: null });
  if(error){ aviso("app-aviso", "Não foi possível mudar a previsão: " + error.message, "erro"); inp.disabled = false; renderCronogramaMob(); return; }
  aviso("app-aviso", `Previsão de término: ${dataBR(data)}. Ficou registrada na conversa da mobilização.`, "ok");
  await mcrRecarregar();
}

/* ---------- Reserva (D2) ---------- */
async function mcrCarregarOrcs(){
  if(_mcrOrcs) return _mcrOrcs;
  const ler = cols => sb.from("orcamentos").select(cols).in("status", ["rascunho", "enviado", "em_negociacao"]).order("data_orcamento", { ascending: false }).limit(500);
  let { data, error } = await ler("id,numero,referencia_obra,status,clientes(nome,nome_fantasia)");
  if(error) ({ data, error } = await ler("id,numero,referencia_obra,status"));
  _mcrOrcs = error ? [] : (data || []);   // quem não lê o comercial fica só com o nome livre
  return _mcrOrcs;
}
function mcrOrcRotulo(o){
  const cli = o.clientes ? (o.clientes.nome_fantasia || o.clientes.nome) : "";
  return [o.numero, cli, o.referencia_obra].filter(Boolean).join(" · ");
}

async function mcrAbrirReserva(equipId, reservaId, focoConverter){
  const linha = _mcrLinhas.find(l => l.equipamento_id === equipId);
  if(!linha){ aviso("app-aviso", "Máquina não encontrada no cronograma.", "erro"); return; }
  let reserva = null;
  if(reservaId){
    const { data, error } = await sb.from("equipamento_reservas").select("*").eq("id", reservaId).maybeSingle();
    if(error || !data){ aviso("app-aviso", "Não foi possível abrir a reserva" + (error ? ": " + error.message : "."), "erro"); return; }
    reserva = data;
  }
  _mcrRes = { linha, reserva };
  const pode = mcrPodeEditar();
  $("mcr-res-titulo").textContent = reserva ? "Reserva da máquina" : "Reservar máquina";
  $("mcr-res-maquina").textContent = `${linha.codigo}${linha.nome ? " · " + linha.nome : ""}${linha.mob_id ? ` · em ${linha.obra_codigo || "obra"}` : ""}`;
  const orcs = await mcrCarregarOrcs();
  const sel = $("mcr-res-orc");
  const atual = reserva && reserva.orcamento_id;
  const lista = atual && !orcs.some(o => o.id === atual) ? [{ id: atual, numero: "Orçamento da reserva" }, ...orcs] : orcs;
  sel.innerHTML = `<option value="">${orcs.length ? "— sem orçamento —" : "— nenhum orçamento disponível —"}</option>` + lista.map(o => `<option value="${esc(o.id)}">${esc(mcrOrcRotulo(o))}</option>`).join("");
  sel.value = atual || "";
  $("mcr-res-nome").value = reserva ? (reserva.nome_livre || "") : "";
  $("mcr-res-data").value = reserva ? (reserva.data_prevista || "") : (mcrLivreEm(linha) || hojeISO());
  $("mcr-res-fim").value = reserva ? (reserva.data_fim_prevista || "") : "";
  $("mcr-res-obs").value = reserva ? (reserva.observacao || "") : "";
  ["mcr-res-orc", "mcr-res-nome", "mcr-res-data", "mcr-res-fim", "mcr-res-obs"].forEach(id => { $(id).disabled = !pode; });
  $("btn-mcr-res-salvar").style.display = pode ? "" : "none";
  $("btn-mcr-res-cancelar").style.display = pode && reserva ? "" : "none";
  const conv = $("mcr-res-converter");
  conv.style.display = pode && reserva ? "" : "none";
  if(pode && reserva){
    const obras = (typeof _mobObras !== "undefined" ? _mobObras : []).filter(o => !["concluida", "cancelada"].includes(o.status));
    $("mcr-res-obra").innerHTML = `<option value="">— escolha a obra —</option>` + obras.map(o => `<option value="${esc(o.id)}">${esc(o.codigo)} · ${esc(o.nome || "")}</option>`).join("");
  }
  $("mcr-res-modal").style.display = "flex";
  (focoConverter && pode && reserva ? $("mcr-res-obra") : $("mcr-res-orc"))?.focus();
}
function mcrFecharReserva(){ $("mcr-res-modal").style.display = "none"; _mcrRes = null; }

async function mcrSalvarReserva(){
  if(!_mcrRes || !mcrPodeEditar()) return;
  const reg = {
    equipamento_id: _mcrRes.linha.equipamento_id,
    orcamento_id: $("mcr-res-orc").value || null,
    nome_livre: $("mcr-res-nome").value.trim() || null,
    data_prevista: $("mcr-res-data").value || null,
    data_fim_prevista: $("mcr-res-fim").value || null,
    observacao: $("mcr-res-obs").value.trim() || null
  };
  if(!reg.orcamento_id && !reg.nome_livre){ aviso("app-aviso", "Escolha o orçamento ou escreva o nome da obra em negociação.", "erro"); $("mcr-res-orc").focus(); return; }
  if(!reg.data_prevista){ aviso("app-aviso", "Informe o início previsto.", "erro"); $("mcr-res-data").focus(); return; }
  if(reg.data_fim_prevista && reg.data_fim_prevista < reg.data_prevista){ aviso("app-aviso", "O término previsto é anterior ao início.", "erro"); return; }
  const q = _mcrRes.reserva
    ? sb.from("equipamento_reservas").update(reg).eq("id", _mcrRes.reserva.id)
    : sb.from("equipamento_reservas").insert(reg);
  const { error } = await q;
  if(error){ aviso("app-aviso", "Não foi possível salvar a reserva: " + error.message, "erro"); return; }
  aviso("app-aviso", `Reserva da ${_mcrRes.linha.codigo} salva.`, "ok");
  mcrFecharReserva();
  _mcrCarregado = false; await mcrCarregar(true); renderCronogramaMob();
}

async function mcrCancelarReserva(){
  if(!_mcrRes || !_mcrRes.reserva || !mcrPodeEditar()) return;
  if(!confirm(`Cancelar a reserva da ${_mcrRes.linha.codigo}? Ela sai do cronograma.`)) return;
  const { error } = await sb.from("equipamento_reservas").update({ status: "cancelada" }).eq("id", _mcrRes.reserva.id);
  if(error){ aviso("app-aviso", "Não foi possível cancelar a reserva: " + error.message, "erro"); return; }
  aviso("app-aviso", "Reserva cancelada.", "ok");
  mcrFecharReserva();
  _mcrCarregado = false; await mcrCarregar(true); renderCronogramaMob();
}

async function mcrConverterReserva(){
  if(!_mcrRes || !_mcrRes.reserva || !mcrPodeEditar()) return;
  const obra = $("mcr-res-obra").value;
  if(!obra){ aviso("app-aviso", "Escolha a obra.", "erro"); $("mcr-res-obra").focus(); return; }
  const { data, error } = await sb.rpc("equipamento_reserva_converter", { p_reserva: _mcrRes.reserva.id, p_obra: obra });
  if(error){ aviso("app-aviso", "Não foi possível converter: " + error.message, "erro"); return; }
  aviso("app-aviso", "Reserva convertida em mobilização prevista.", "ok");
  mcrFecharReserva();
  await mcrRecarregar();
  if(data) abrirMobilizacao(data);
}

/* ---------- Exportar .xlsx no leiaute da RG 11.15 (D10) ---------- */
function mcrExportarXlsx(linhas){
  if(typeof XLSX === "undefined"){ aviso("app-aviso", "A biblioteca de planilhas não carregou. Recarregue a página.", "erro"); return; }
  if(!linhas.length){ aviso("app-aviso", "Nenhuma máquina com esses filtros para exportar.", "erro"); return; }
  const dt = iso => iso ? new Date(String(iso).slice(0, 10) + "T12:00:00") : "";
  const COLS = ["Equipamento", "Metodologia", "Cliente", "Obra", "Operador", "Início da execução", "Previsão de término", "Próxima obra", "Previsão de início da próxima obra"];
  const aoa = [
    ["CGL FUNDAÇÕES — SISTEMA DE GESTÃO DA QUALIDADE"],
    ["RG 11.15 — CRONOGRAMA DE EQUIPAMENTOS"],
    [`Emitido em ${dataBR(hojeISO())} pelo app, a partir das mobilizações`],
    [],
    COLS
  ];
  const merges = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: COLS.length - 1 } }));
  mcrGrupos(linhas).forEach(g => {
    merges.push({ s: { r: aoa.length, c: 0 }, e: { r: aoa.length, c: COLS.length - 1 } });
    aoa.push([g.grupo.toUpperCase()]);
    g.linhas.forEach(l => {
      const t = mcrTermino(l);
      aoa.push([
        [l.codigo, l.nome].filter(Boolean).join(" · "),
        MCR_METODO[l.metodologia] || "",
        l.mob_id ? (l.cliente || "") : mcrOndeTexto(l),
        l.mob_id ? [l.obra_codigo, l.obra_nome].filter(Boolean).join(" · ") : "",
        l.operadores || "",
        dt(l.inicio),
        t ? dt(t.data) : "",
        mcrProximaTexto(l),
        dt(l.prox_mob_id ? l.prox_inicio : l.reserva_data)
      ]);
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd/mm/yyyy" });
  ws["!merges"] = merges;
  ws["!cols"] = [{ wch: 28 }, { wch: 16 }, { wch: 26 }, { wch: 34 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "RG 11.15");
  XLSX.writeFile(wb, `RG-11.15-cronograma-equipamentos-${hojeISO()}.xlsx`);
}

/* ---------- Listeners do modal ---------- */
function ligarCronogramaMob(){
  $("btn-mcr-res-fechar")?.addEventListener("click", mcrFecharReserva);
  $("mcr-res-modal")?.addEventListener("click", e => { if(e.target.id === "mcr-res-modal") mcrFecharReserva(); });
  $("btn-mcr-res-salvar")?.addEventListener("click", () => comBotaoTravado("btn-mcr-res-salvar", mcrSalvarReserva));
  $("btn-mcr-res-cancelar")?.addEventListener("click", () => comBotaoTravado("btn-mcr-res-cancelar", mcrCancelarReserva));
  $("btn-mcr-res-converter")?.addEventListener("click", () => comBotaoTravado("btn-mcr-res-converter", mcrConverterReserva));
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarCronogramaMob); else ligarCronogramaMob();

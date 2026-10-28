/* ====================================================================
   VIAGENS — ficha da viagem (fase 89 · 19/10/2026), prefixo vg-
   Ficha estilo Odoo dentro de sec-frota (Logística): header de ações, statusbar clicável
   (planejada → em trânsito → concluída), chips, smart-buttons e abas Geral, Itens
   transportados, Documentos (notas e MDF-e) e Custo (km × R$/km e rateio por obra).
   Regras: km_total e valor_total são colunas geradas no banco; o km do caminhão vem do
   gatilho; concluir exige km de chegada ≥ saída. "+ Item" grava na movimentação INTERNA da
   viagem (uma por viagem, sem NF-e, interna = true). A nota (remessa/retorno) nasce ligada
   à viagem e abre a ficha de Movimentações (sec-movimentacoes), que volta para cá.
   Depende de js/frota.js (listas de veículos, funcionários e obras; logPodeOperar()).
   Fase 130 (27/10/2026, #186): finalidade "Frete terceirizado" troca Caminhão/Motorista por Transportador
   (fornecedor com busca, placa e motorista em texto) e o bloco km × R$/km pelo bloco Frete (valor combinado,
   vencimento, nº do CT-e/NF, emissão, observações). O valor vive em viagem_fretes (só pode_ler_contas_pagar() lê)
   e é gravado pela RPC viagem_frete_gravar: quem não lê informa e não vê de volta (a viagem guarda só
   frete_status). O título a pagar nasce no banco (gatilho) e aparece no smart-button Título e na aba Custo.
   Aba Documentos ganha "Anexos do transporte" (bucket privado viagens-anexos, MIME pela extensão + Blob).
   ==================================================================== */
let _vgAtual = null;        // registro de viagens aberto (id null = nova)
let _vgMovs = [];           // movimentacoes_ativos da viagem, com itens
let _vgMdfes = [];          // manifestos_mdfe da viagem
let _vgRateio = [];         // vw_viagem_obras
let _vgTab = "geral";
let _vgVoltarPara = null;   // callback do "Voltar" quando a ficha foi aberta de outra tela (mobilização)
let _vgAnexos = [];         // fase 130: viagem_anexos (documentos do transportador)
let _vgTitulo = null;       // fase 130: titulos_pagar da viagem (só para quem lê contas a pagar)
let _vgTranspSel = null;    // fase 130: transportador escolhido na busca { id, razao_social, ... }

const VG_FIN_TIPO_MOV = { mobilizacao: "remessa", desmobilizacao: "retorno", apoio: "remessa", entrega_material: "remessa", manutencao: "conserto", outro: "remessa", frete_terceirizado: "remessa" };
/* fase 130: anexos do transporte */
const VG_ANEXO_BUCKET = "viagens-anexos";
const VG_ANEXO_TIPOS = { cte: "CT-e", nf_remessa: "NF de simples remessa", mdfe: "MDF-e do transportador", comprovante: "Comprovante", outro: "Outro" };
const VG_ANEXO_MIME = { pdf: "application/pdf", xml: "application/xml", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const VG_ANEXO_MAX_BYTES = 20 * 1024 * 1024;
const VG_MDFE_STATUS = { rascunho: ["Rascunho", "cinza"], emitido: ["Emitido", "azul"], em_transito: ["Em trânsito", "ambar"], encerrado: ["Encerrado", "verde"], cancelado: ["Cancelado", "vermelho"] };

/* ---------- helpers ---------- */
function vgDtLocal(ts){
  if(!ts) return "";
  const d = new Date(ts), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function vgDtISO(local){ return local ? new Date(local).toISOString() : null; }
function vgDtBR(ts){ return ts ? new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
function vgVeiculo(id){ return _frotaVeic.find(v => v.id === id) || null; }
function vgMotorista(id){ return _frotaFuncs.find(f => f.id === id) || null; }
function vgObra(id){ return _frotaObras.find(o => o.id === id) || null; }
function vgUfDe(v, lado){
  const tipo = v[lado + "_tipo"], obra = vgObra(v[lado + "_obra_id"]);
  if((tipo === "obra" || tipo === "cliente") && obra && obra.uf) return String(obra.uf).toLowerCase();
  return "mg";   // base e fornecedores da CGL: Itabira/MG
}
function vgItensTodos(){ return _vgMovs.flatMap(m => (m.itens || []).map(i => ({ ...i, mov: m }))); }
function vgNotas(){ return _vgMovs.filter(m => !m.interna); }
function vgShow(id, on){ const el = $(id); if(el) el.style.display = on ? "" : "none"; }

async function vgGarantirBase(){
  if(!_frotaVeic.length || !_frotaObras.length) await carregarFrota(false);
  vgPreencherSelects();
}
function vgPreencherSelects(){
  const opt = (lista, rot, vazio) => `<option value="">${esc(vazio)}</option>` + lista.map(v => `<option value="${esc(v.id)}">${esc(rot(v))}</option>`).join("");
  const caminhoes = _frotaVeic.filter(v => v.tipo === "caminhao" && v.ativo !== false).concat(_frotaVeic.filter(v => v.tipo !== "caminhao" && v.ativo !== false));
  $("vg-caminhao").innerHTML = opt(caminhoes, v => `${v.codigo} · ${v.nome || ""}${v.placa ? " · " + v.placa : ""}`, "— a definir —");
  $("vg-motorista").innerHTML = opt(_frotaFuncs, f => f.nome + (f.funcao ? " · " + f.funcao : ""), "— a definir —");
  $("vg-equip").innerHTML = opt(_frotaEquipOutros.filter(e => e.ativo !== false), e => `${e.codigo} · ${e.nome || ""}`, "— nenhum —");
  $("vg-finalidade").innerHTML = Object.entries(VG_FINALIDADES).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("");
  ["vg-origem-tipo", "vg-destino-tipo"].forEach(id => { $(id).innerHTML = Object.entries(VG_LOC).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join(""); });
  ["vg-origem-obra", "vg-destino-obra"].forEach(id => { $(id).innerHTML = opt(_frotaObras, o => `${o.codigo} — ${o.nome}${o.status === "em_andamento" ? "" : " (" + o.status + ")"}`, "— escolha a obra —"); });
}

/* ---------- abrir / nova ---------- */
async function novaViagem(pre = {}){
  if(!logPodeOperar()){ aviso("app-aviso", "Seu perfil não registra viagens.", "erro"); return; }
  await vgGarantirBase();
  _vgAtual = {
    id: null, numero: null, data: pre.data || hojeISO(), status: "planejada", finalidade: pre.finalidade || "outro",
    caminhao_id: pre.caminhao_id || null, funcionario_id: null, equipamento_atendido_id: pre.equipamento_atendido_id || null,
    origem_tipo: pre.origem_tipo || "base", origem_obra_id: pre.origem_obra_id || null, origem_descricao: pre.origem_tipo ? null : "Base Itabira",
    destino_tipo: pre.destino_tipo || (pre.destino_obra_id ? "obra" : "base"), destino_obra_id: pre.destino_obra_id || null, destino_descricao: null,
    km_saida: null, km_chegada: null, valor_km: null, data_saida: null, data_chegada: null, mobilizacao_id: pre.mobilizacao_id || null, observacoes: pre.observacoes || null,
    transportador_id: null, transportador_placa: null, transportador_motorista: null, frete_status: null, frete: null, transportador: null   // fase 130
  };
  _vgMovs = []; _vgMdfes = []; _vgRateio = []; _vgAnexos = []; _vgTitulo = null; _vgTranspSel = null; _vgTab = "geral";
  _vgVoltarPara = pre.voltar || null;
  vgMostrarFicha();
}

async function abrirViagem(id, voltarPara){
  await vgGarantirBase();
  // fase 105b: status da NF-e emitida pelo app (só depois da migration; sem ela a nota vem como antes)
  const nfeCols = typeof fiscalColunaExiste === "function" && await fiscalColunaExiste("movimentacoes_ativos", "nf_status") ? ",nf_status,nf_ambiente" : "";
  const [v, movs, mdfes, rat, anexos, tit] = await Promise.all([
    // mobilizacoes tem três caminhos até viagens (mobilizacao_id, viagem_ida_id, viagem_volta_id): o hint pela coluna evita a ambiguidade do PostgREST
    // fase 130: transportador e frete (viagem_fretes vem nulo para quem não lê contas a pagar; sem erro)
    sb.from("viagens").select("*, caminhao:equipamentos!caminhao_id(id,codigo,nome,placa), funcionario:funcionarios(id,nome,funcao), mobilizacao:mobilizacoes!mobilizacao_id(id,obra_id,status), transportador:fornecedores!transportador_id(id,razao_social,nome_fantasia,cpf_cnpj), frete:viagem_fretes(valor_frete,frete_vencimento,frete_documento,frete_emissao,frete_observacoes,updated_at)").eq("id", id).single(),
    sb.from("movimentacoes_ativos").select("id,numero,tipo,status,interna,nf_numero,nf_serie,nf_chave_acesso,valor_total_produtos,peso_bruto_kg,origem_tipo,origem_obra_id,origem_descricao,origem_uf,destino_tipo,destino_obra_id,destino_descricao,destino_uf,data_emissao,mdfe_id" + nfeCols + ",itens:movimentacao_itens(id,equipamento_id,produto_id,acessorio_id,descricao,quantidade,unidade,valor_unitario,numero_serie,chassi)").eq("viagem_id", id).order("created_at"),
    sb.from("manifestos_mdfe").select("*").eq("viagem_id", id).order("created_at"),
    sb.from("vw_viagem_obras").select("obra_id,fracao").eq("viagem_id", id),
    sb.from("viagem_anexos").select("id,tipo,nome,storage_path,mime_type,tamanho_bytes,created_at,enviado_por,autor:profiles!enviado_por(nome)").eq("viagem_id", id).order("created_at"),
    vgPodeVerFrete() ? sb.from("titulos_pagar").select("id,valor,vencimento,emissao,nf_numero,exportado_em,exportacao_id,obra_id").eq("viagem_id", id).maybeSingle() : Promise.resolve({ data: null })
  ]);
  if(v.error || !v.data){ aviso("app-aviso", "Não foi possível abrir a viagem" + (v.error ? ": " + v.error.message : "."), "erro"); return; }
  _vgAtual = v.data;
  _vgMovs = movs.error ? [] : (movs.data || []);
  _vgMdfes = mdfes.error ? [] : (mdfes.data || []);
  _vgRateio = rat.error ? [] : (rat.data || []);
  _vgAnexos = anexos.error ? [] : (anexos.data || []);
  _vgTitulo = tit && !tit.error ? (tit.data || null) : null;
  _vgTranspSel = _vgAtual.transportador || null;
  if(voltarPara !== undefined) _vgVoltarPara = voltarPara || null;
  vgMostrarFicha();
}
async function vgRecarregar(){ if(_vgAtual?.id) await abrirViagem(_vgAtual.id); }

function vgVoltar(){
  const f = _vgVoltarPara; _vgVoltarPara = null; _vgAtual = null;
  if(f){ const p = $("frota-painel"); if(p) p.style.display = ""; const fi = $("vg-ficha"); if(fi) fi.style.display = "none"; f(); return; }
  mostrarPainelFrota(true);
}

function vgMostrarFicha(){
  const painel = $("frota-painel"); if(painel) painel.style.display = "none";
  $("vg-ficha").style.display = "";
  vgPreencherForm();
  vgStatusbar();
  vgChips();
  vgBotoes();
  vgRenderItens();
  vgRenderDocs();
  vgRenderCusto();
  vgAtivarTab(_vgAtual.id ? _vgTab : "geral");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- formulário (aba Geral) ---------- */
function vgPreencherForm(){
  const v = _vgAtual;
  $("vg-data").value = v.data || hojeISO();
  $("vg-finalidade").value = v.finalidade || "outro";
  $("vg-caminhao").value = v.caminhao_id || "";
  $("vg-motorista").value = v.funcionario_id || "";
  $("vg-equip").value = v.equipamento_atendido_id || "";
  $("vg-origem-tipo").value = v.origem_tipo || "base";
  $("vg-origem-obra").value = v.origem_obra_id || "";
  $("vg-origem-desc").value = v.origem_descricao || "";
  $("vg-destino-tipo").value = v.destino_tipo || "base";
  $("vg-destino-obra").value = v.destino_obra_id || "";
  $("vg-destino-desc").value = v.destino_descricao || "";
  $("vg-km-saida").value = v.km_saida ?? "";
  $("vg-km-chegada").value = v.km_chegada ?? "";
  $("vg-valor-km").value = v.valor_km ?? "";
  $("vg-data-saida").value = vgDtLocal(v.data_saida);
  $("vg-data-chegada").value = vgDtLocal(v.data_chegada);
  $("vg-obs").value = v.observacoes || "";
  // fase 130: transportador e frete
  $("vg-transp-busca").value = _vgTranspSel ? (_vgTranspSel.razao_social || _vgTranspSel.nome_fantasia || "") : "";
  $("vg-transp-placa").value = v.transportador_placa || "";
  $("vg-transp-motorista").value = v.transportador_motorista || "";
  const f = vgFrete(v);
  $("vg-frete-valor").value = f && f.valor_frete != null ? f.valor_frete : "";
  $("vg-frete-venc").value = f?.frete_vencimento || "";
  $("vg-frete-doc").value = f?.frete_documento || "";
  $("vg-frete-emissao").value = f?.frete_emissao || "";
  $("vg-frete-obs").value = f?.frete_observacoes || "";
  // quem não lê contas a pagar informa e não vê de volta: o campo fica vazio e diz o que o banco guarda
  const restrito = vgEhFrete(v) && !vgPodeVerFrete() && v.id;
  $("vg-frete-valor").placeholder = restrito && v.frete_status && v.frete_status !== "a_informar" ? "informado (visível ao financeiro)" : "0,00";
  vgToggleObra();
  vgToggleFinalidade();
  if(!v.id) vgSugerirDoVeiculo();
  const pode = logPodeOperar() && v.status !== "cancelada";
  document.querySelectorAll('#vg-ficha .odoo-tab[data-tab="geral"] input, #vg-ficha .odoo-tab[data-tab="geral"] select').forEach(el => { el.disabled = !pode; });
  // título exportado: valor, vencimento, documento e emissão do frete travam no banco; a observação continua livre
  if(v.frete_status === "exportado") ["vg-frete-valor", "vg-frete-venc", "vg-frete-doc", "vg-frete-emissao", "vg-transp-busca"].forEach(id => { $(id).disabled = true; });
}
/* fase 130: a finalidade decide os blocos da aba Geral (frota própria × frete terceirizado) e os rótulos dos chips */
function vgToggleFinalidade(){
  const frete = $("vg-finalidade").value === "frete_terceirizado";
  ["vg-campo-caminhao", "vg-campo-motorista", "vg-bloco-km"].forEach(id => vgShow(id, !frete));
  ["vg-campo-transp", "vg-campo-transp-placa", "vg-campo-transp-motorista", "vg-bloco-frete"].forEach(id => vgShow(id, frete));
  const nota = $("vg-frete-nota");
  if(nota && frete){
    nota.textContent = vgPodeVerFrete()
      ? "O título a pagar nasce no banco quando há valor maior que zero e vencimento, acompanha as alterações e some se a viagem for cancelada; depois de exportado ao financeiro ele não muda mais (\"título já exportado: ajuste em Contas a pagar\"). O custo cai nas obras atendidas (aba Custo)."
      : "Você informa o valor, o vencimento e o documento; eles ficam visíveis só para quem lê Contas a pagar (financeiro, comprador, admin, diretoria). Depois de salvar o campo volta vazio e o chip Frete mostra o estado do título. Para corrigir, informe de novo.";
  }
}
function vgToggleObra(){
  ["origem", "destino"].forEach(l => {
    const tipo = $(`vg-${l}-tipo`).value;
    const mostra = tipo === "obra" || tipo === "cliente";
    $(`vg-${l}-obra-campo`).style.display = mostra ? "" : "none";
    if(!mostra) $(`vg-${l}-obra`).value = "";
  });
}
function vgObraEscolhida(lado){
  const o = vgObra($(`vg-${lado}-obra`).value);
  const desc = $(`vg-${lado}-desc`);
  if(o && !desc.value.trim()) desc.value = `${o.codigo} — ${o.nome}`;
}
/* R$/km vem do veículo; km de saída sugerido é o km atual do caminhão (viagem nova ou sem km) */
function vgSugerirDoVeiculo(){
  if($("vg-finalidade").value === "frete_terceirizado") return;   // fase 130: frete não tem caminhão
  const v = vgVeiculo($("vg-caminhao").value);
  if(!v) return;
  if(!$("vg-valor-km").value && v.valor_km != null) $("vg-valor-km").value = v.valor_km;
  if(!$("vg-km-saida").value && v.km != null && _vgAtual?.status !== "concluida") $("vg-km-saida").value = v.km;
}
function vgColetar(){
  const num = id => $(id).value === "" ? null : Number($(id).value);
  const oTipo = $("vg-origem-tipo").value, dTipo = $("vg-destino-tipo").value;
  const frete = $("vg-finalidade").value === "frete_terceirizado";   // fase 130
  return {
    data: $("vg-data").value || null,
    finalidade: $("vg-finalidade").value || "outro",
    caminhao_id: frete ? null : ($("vg-caminhao").value || null),
    funcionario_id: frete ? null : ($("vg-motorista").value || null),
    transportador_id: frete ? (_vgTranspSel?.id || null) : null,
    transportador_placa: frete ? (frotaSoAlfaNum($("vg-transp-placa").value) || null) : null,
    transportador_motorista: frete ? ($("vg-transp-motorista").value.trim() || null) : null,
    equipamento_atendido_id: $("vg-equip").value || null,
    origem_tipo: oTipo, origem_obra_id: (oTipo === "obra" || oTipo === "cliente") ? ($("vg-origem-obra").value || null) : null,
    origem_descricao: $("vg-origem-desc").value.trim() || null,
    destino_tipo: dTipo, destino_obra_id: (dTipo === "obra" || dTipo === "cliente") ? ($("vg-destino-obra").value || null) : null,
    destino_descricao: $("vg-destino-desc").value.trim() || null,
    km_saida: frete ? null : num("vg-km-saida"), km_chegada: frete ? null : num("vg-km-chegada"), valor_km: frete ? null : num("vg-valor-km"),
    data_saida: vgDtISO($("vg-data-saida").value), data_chegada: vgDtISO($("vg-data-chegada").value),
    observacoes: $("vg-obs").value.trim() || null
  };
}
/* fase 130: campos do frete (vão pela RPC viagem_frete_gravar, não pelo insert/update de viagens) */
function vgColetarFrete(){
  const valor = $("vg-frete-valor").value;
  return {
    informado: valor !== "",
    valor: valor === "" ? null : Number(valor),
    vencimento: $("vg-frete-venc").value || null,
    documento: $("vg-frete-doc").value.trim() || null,
    emissao: $("vg-frete-emissao").value || null,
    observacoes: $("vg-frete-obs").value.trim() || null
  };
}
/* grava o frete pela RPC (security definer: a logística informa sem ler viagem_fretes). Devolve false se o banco recusou. */
async function vgGravarFrete(viagemId, fr){
  const { data, error } = await sb.rpc("viagem_frete_gravar", { p_viagem_id: viagemId, p_valor: fr.valor, p_vencimento: fr.vencimento, p_documento: fr.documento, p_emissao: fr.emissao, p_observacoes: fr.observacoes });
  if(error){ aviso("app-aviso", "Viagem salva, mas o frete não foi gravado: " + error.message, "erro"); return false; }
  const st = data?.frete_status;
  if(st === "gerado") aviso("app-aviso", "Frete informado; título a pagar " + (data?.titulo_exportado ? "já exportado (valor mantido)." : "gerado em Contas a pagar."), "ok");
  else if(st === "a_gerar") aviso("app-aviso", "Frete informado. O título nasce quando houver valor maior que zero e vencimento.", "ok");
  else if(st === "exportado") aviso("app-aviso", "Observação do frete gravada; o título já exportado não muda.", "ok");
  return true;
}

/* ---------- salvar e status ---------- */
async function salvarViagem(extra = {}, silencioso){
  if(!logPodeOperar()){ aviso("app-aviso", "Seu perfil não registra viagens.", "erro"); return null; }
  const reg = vgColetar();
  if(!reg.data){ aviso("app-aviso", "Informe a data da viagem.", "erro"); vgAtivarTab("geral"); return null; }
  if(reg.km_saida != null && reg.km_chegada != null && reg.km_chegada < reg.km_saida){ aviso("app-aviso", "km de chegada menor que km de saída.", "erro"); vgAtivarTab("geral"); return null; }
  // fase 130: frete terceirizado exige o transportador; valor negativo não entra
  const frete = reg.finalidade === "frete_terceirizado";
  const fr = frete ? vgColetarFrete() : null;
  if(frete && !reg.transportador_id){ aviso("app-aviso", "Escolha o transportador (fornecedor) do frete.", "erro"); vgAtivarTab("geral"); $("vg-transp-busca").focus(); return null; }
  if(frete && fr.informado && !(fr.valor >= 0)){ aviso("app-aviso", "Valor do frete inválido.", "erro"); vgAtivarTab("geral"); $("vg-frete-valor").focus(); return null; }
  Object.assign(reg, extra);
  if(_vgAtual.mobilizacao_id && !_vgAtual.id) reg.mobilizacao_id = _vgAtual.mobilizacao_id;
  const r = _vgAtual.id
    ? await sb.from("viagens").update(reg).eq("id", _vgAtual.id).select("id").single()
    : await sb.from("viagens").insert(reg).select("id").single();
  if(r.error){ aviso("app-aviso", "Não foi possível salvar a viagem: " + r.error.message, "erro"); return null; }
  // valor/vencimento/documento do frete: só quando a pessoa digitou (quem não lê vê o campo vazio e não apaga o que já está lá)
  let freteOk = true;
  if(frete && fr.informado && !$("vg-frete-valor").disabled) freteOk = await vgGravarFrete(r.data.id, fr);
  if(!silencioso && freteOk && !(frete && fr.informado)) aviso("app-aviso", "Viagem salva.", "ok");
  _frotaViagens.chave = null; _frotaDocs = null;
  await abrirViagem(r.data.id);
  return r.data.id;
}
async function vgIniciar(){
  const frete = $("vg-finalidade").value === "frete_terceirizado";
  if(frete && !_vgTranspSel?.id){ aviso("app-aviso", "Defina o transportador antes de iniciar a viagem.", "erro"); vgAtivarTab("geral"); $("vg-transp-busca").focus(); return; }
  if(!frete && !$("vg-caminhao").value){ aviso("app-aviso", "Defina o caminhão antes de iniciar a viagem.", "erro"); vgAtivarTab("geral"); $("vg-caminhao").focus(); return; }
  vgSugerirDoVeiculo();
  const id = await salvarViagem({ status: "em_transito", data_saida: vgDtISO($("vg-data-saida").value) || new Date().toISOString() }, true);
  if(id) aviso("app-aviso", "Viagem em trânsito.", "ok");
}
async function vgConcluir(){
  const frete = $("vg-finalidade").value === "frete_terceirizado";   // fase 130: frete fecha sem km (o custo é o valor combinado)
  const ks = $("vg-km-saida").value, kc = $("vg-km-chegada").value;
  if(!frete && (ks === "" || kc === "")){ aviso("app-aviso", "Informe km de saída e km de chegada para concluir (fecham o custo da viagem).", "erro"); vgAtivarTab("geral"); $(kc === "" ? "vg-km-chegada" : "vg-km-saida").focus(); return; }
  if(!frete && Number(kc) < Number(ks)){ aviso("app-aviso", "km de chegada menor que km de saída.", "erro"); vgAtivarTab("geral"); return; }
  if(!frete && !$("vg-caminhao").value){ aviso("app-aviso", "Defina o caminhão antes de concluir.", "erro"); vgAtivarTab("geral"); return; }
  if(frete && !_vgTranspSel?.id){ aviso("app-aviso", "Defina o transportador antes de concluir.", "erro"); vgAtivarTab("geral"); return; }
  const abertos = _vgMdfes.filter(m => ["emitido", "em_transito"].includes(m.status));
  const id = await salvarViagem({ status: "concluida", data_chegada: vgDtISO($("vg-data-chegada").value) || new Date().toISOString() }, true);
  if(!id) return;
  if(abertos.length){
    const { error } = await sb.from("manifestos_mdfe").update({ status: "encerrado", data_encerramento: hojeISO() }).in("id", abertos.map(m => m.id));
    if(error) aviso("app-aviso", "Viagem concluída, mas o MDF-e não foi encerrado: " + error.message, "erro");
    else { aviso("app-aviso", `Viagem concluída; ${abertos.length} MDF-e encerrado(s).`, "ok"); await vgRecarregar(); }
  } else aviso("app-aviso", "Viagem concluída.", "ok");
}
async function vgCancelar(){
  if(!confirm("Cancelar esta viagem? O custo dela sai do rateio das obras; as notas continuam ligadas para consulta.")) return;
  const id = await salvarViagem({ status: "cancelada" }, true);
  if(id) aviso("app-aviso", "Viagem cancelada.", "ok");
}
async function vgReabrir(){
  const id = await salvarViagem({ status: "planejada" }, true);
  if(id) aviso("app-aviso", "Viagem reaberta como planejada.", "ok");
}
async function excluirViagem(){
  const v = _vgAtual; if(!v?.id) return;
  if(_vgMovs.length || _vgMdfes.length){ aviso("app-aviso", "A viagem tem nota ou MDF-e ligado: cancele em vez de excluir.", "erro"); return; }
  if(v.frete_status === "exportado"){ aviso("app-aviso", "O título do frete já foi exportado ao financeiro: cancele a viagem em vez de excluir (ajuste em Contas a pagar).", "erro"); return; }
  if(!confirm(`Excluir a viagem ${v.numero}?${vgEhFrete(v) ? " O frete, o título a pagar não exportado e os anexos vão junto." : ""}`)) return;
  const { error } = await sb.from("viagens").delete().eq("id", v.id);
  if(error){ aviso("app-aviso", "Não foi possível excluir: " + error.message, "erro"); return; }
  aviso("app-aviso", "Viagem excluída.", "ok");
  _vgAtual = null; _vgVoltarPara = null;
  mostrarPainelFrota(true);
}

/* ---------- statusbar, chips, smart-buttons, botões ---------- */
function vgStatusbar(){
  const st = _vgAtual.status, idxAtual = VG_STAGES.indexOf(st);
  document.querySelectorAll("#vg-statusbar .stage").forEach(el => {
    el.classList.remove("atual", "passada", "cancelada");
    el.removeAttribute("aria-current");
    const idx = VG_STAGES.indexOf(el.dataset.status);
    if(st === "cancelada"){ if(idx === VG_STAGES.length - 1){ el.classList.add("cancelada"); el.setAttribute("aria-current", "step"); } }
    else if(idx === idxAtual){ el.classList.add("atual"); el.setAttribute("aria-current", "step"); }
    else if(idx < idxAtual) el.classList.add("passada");
  });
}
function vgChips(){
  const v = _vgAtual, cam = v.caminhao || vgVeiculo(v.caminhao_id), mot = v.funcionario || vgMotorista(v.funcionario_id);
  const frete = vgEhFrete(v), fr = vgFrete(v);
  $("vg-chip-numero").innerHTML = v.numero ? `${esc(v.numero)} ${tagStatus("viagem", v.status)}${frete ? ' <span class="tag azul">Frete terceirizado</span>' : ""}` : "(nova)";
  // fase 130: no frete os chips Caminhão/Motorista viram Transportador/Motorista do transportador, km vira Frete
  const rotulo = (id, txt) => { const el = $(id)?.previousElementSibling; if(el) el.textContent = txt; };
  rotulo("vg-chip-caminhao", frete ? "Transportador" : "Caminhão");
  rotulo("vg-chip-motorista", frete ? "Motorista (transp.)" : "Motorista");
  rotulo("vg-chip-km", frete ? "Frete" : "km");
  $("vg-chip-caminhao").textContent = frete ? vgTransportadorTxt(v) : vgCaminhaoTxt(cam);
  $("vg-chip-motorista").textContent = frete ? (v.transportador_motorista || "—") : (mot ? mot.nome : "—");
  $("vg-chip-destino").innerHTML = (v.destino_tipo === "obra" || v.destino_tipo === "cliente") && v.destino_obra_id ? linkObra(v.destino_obra_id, vgLado(v, "destino")) : esc(vgLado(v, "destino"));
  $("vg-chip-mob").innerHTML = v.mobilizacao_id ? `<a href="#" id="vg-abrir-mob" title="Abrir a mobilização">${esc(VG_FINALIDADES[v.finalidade] || "mobilização")} ↗</a>` : "—";
  if(frete){
    $("vg-chip-km").innerHTML = vgTagFreteStatus(v.frete_status) || "—";
    $("vg-chip-custo").innerHTML = fr && fr.valor_frete != null ? `${frotaMoeda(fr.valor_frete)}${fr.frete_vencimento ? ` <span class="meta">vence ${dataBR(fr.frete_vencimento)}</span>` : ""}` : (vgPodeVerFrete() ? "—" : '<span class="meta" title="valor do frete visível só para quem lê Contas a pagar">restrito</span>');
  } else {
    $("vg-chip-km").textContent = v.km_total != null ? frotaNum(v.km_total) + " km" : "—";
    $("vg-chip-custo").textContent = v.valor_total != null ? frotaMoeda(v.valor_total) : "—";
  }
  $("vg-abrir-mob")?.addEventListener("click", async e => {
    e.preventDefault();
    if(!irParaSecao("mobilizacoes")) return;
    if(typeof carregarMobilizacoes === "function") await carregarMobilizacoes(false);
    if(typeof abrirMobilizacao === "function") abrirMobilizacao(v.mobilizacao_id);
  });
  const setSb = (id, n, txt) => { const b = $(id); if(!b) return; b.querySelector(".sb-num").textContent = txt != null ? txt : (n || 0); b.classList.toggle("zero", !n); };
  const itens = vgItensTodos().length, notas = vgNotas().length;
  setSb("sb-vg-itens", itens);
  setSb("sb-vg-notas", notas);
  setSb("sb-vg-mdfe", _vgMdfes.length);
  const valor = vgValorViagem(v);
  setSb("sb-vg-custo", Number(valor) || 0, valor != null ? frotaMoeda(valor).replace(",00", "") : "—");
  // fase 130: título do frete e anexos do transporte
  vgShow("sb-vg-titulo", frete);
  if(frete){
    const stTit = v.frete_status === "exportado" ? "exportado" : v.frete_status === "gerado" ? "gerado" : v.frete_status === "cancelado" ? "cancelado" : "a gerar";
    setSb("sb-vg-titulo", ["gerado", "exportado"].includes(v.frete_status) ? 1 : 0, stTit);
  }
  setSb("sb-vg-anexos", _vgAnexos.length);
}
function vgBotoes(){
  const v = _vgAtual, pode = logPodeOperar(), st = v.status, novo = !v.id;
  vgShow("btn-vg-salvar", pode && st !== "cancelada");
  vgShow("btn-vg-iniciar", pode && !novo && st === "planejada");
  vgShow("btn-vg-concluir", pode && !novo && (st === "planejada" || st === "em_transito"));
  vgShow("btn-vg-cancelar", pode && !novo && st !== "cancelada" && st !== "concluida");
  vgShow("btn-vg-excluir", pode && !novo && !_vgMovs.length && !_vgMdfes.length);
  vgShow("btn-vg-romaneio", !novo);
}
function vgAtivarTab(nome){
  _vgTab = nome;
  document.querySelectorAll("#vg-notebook button").forEach(b => b.classList.toggle("ativo", b.dataset.tab === nome));
  document.querySelectorAll("#vg-ficha .odoo-tab").forEach(t => t.classList.toggle("ativa", t.dataset.tab === nome));
}

/* ---------- aba Itens transportados ---------- */
function vgItemNome(it){
  if(it.acessorio_id) return "⚙️ " + linkAcessorio(it.acessorio_id, it.descricao);
  if(it.equipamento_id) return "🔧 " + linkEquipamento(it.equipamento_id, it.descricao);
  if(it.produto_id) return "📦 " + linkProduto(it.produto_id, it.descricao);
  return esc(it.descricao || "item");
}
function vgRenderItens(){
  const box = $("vg-itens"); if(!box) return;
  const v = _vgAtual, pode = logPodeOperar() && v.status !== "cancelada";
  const itens = vgItensTodos();
  const movSt = (typeof MOV_STATUS === "object" && MOV_STATUS) || {};
  box.innerHTML = `
    <p class="meta" style="margin:0 0 8px;">União dos itens de todas as notas da viagem, com a nota de origem em cada linha. "+ Item" grava no documento interno da viagem (sem NF-e); quando a nota de remessa for criada, esses itens podem ir para ela.</p>
    ${itens.length ? `<div class="tabela-rola"><table class="itens-tabela">
      <thead><tr><th>Item</th><th>Documento</th><th class="num" style="width:90px;">Qtd</th><th style="width:60px;">Un</th><th>Série / chassi</th><th class="col-acao"></th></tr></thead>
      <tbody>${itens.map(it => `<tr>
        <td>${vgItemNome(it)}</td>
        <td>${it.mov.interna ? '<span class="meta">itens da viagem (sem NF-e)</span>' : `${linkMovimentacao(it.mov.id, it.mov.numero)} ${movSt[it.mov.status] ? `<span class="tag ${esc(movSt[it.mov.status].cor)}">${esc(movSt[it.mov.status].label)}</span>` : ""}${it.mov.nf_numero ? ` <span class="meta">NF ${esc(it.mov.nf_numero)}</span>` : ""}`}</td>
        <td class="num">${num(it.quantidade)}</td><td>${esc(it.unidade || "un")}</td>
        <td class="meta">${esc([it.numero_serie, it.chassi].filter(Boolean).join(" · ") || "—")}</td>
        <td class="col-acao">${pode && it.mov.interna && it.mov.status === "rascunho" ? `<button type="button" class="btn-rem vg-item-rem" data-id="${esc(it.id)}" title="tirar da viagem">&times;</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>` : `<p class="vazio">${v.id ? "Nenhum item lançado. Use os campos abaixo ou crie a nota de remessa na aba Documentos." : "Salve a viagem para lançar itens."}</p>`}
    ${pode && v.id ? `<div class="grade" style="margin-top:12px;">
      <div class="campo"><label>+ Equipamento (TAG)</label>
        <div style="display:flex;gap:6px;"><select id="vg-add-equip" style="flex:1;"><option value="">— escolha —</option>${_frotaEquipOutros.concat(_frotaVeic).filter(e => e.ativo !== false).map(e => `<option value="${esc(e.id)}">${esc(e.codigo)} — ${esc(e.nome || "")}</option>`).join("")}</select><button type="button" class="btn-sec" id="btn-vg-add-equip">Adicionar</button></div></div>
      <div class="campo largo"><label>+ Acessório (marcação, jogo ou descrição)</label><input id="vg-add-ace" placeholder="ex.: CGL-12-3, H12, camisa 250…" autocomplete="off" /><div id="vg-add-ace-res" class="autocomplete-lista" style="display:none;"></div></div>
      <div class="campo largo"><label>+ Produto (nome)</label><input id="vg-add-prod" placeholder="digite ≥ 2 letras…" autocomplete="off" /><div id="vg-add-prod-res" class="autocomplete-lista" style="display:none;"></div></div>
    </div>` : ""}`;
  box.querySelectorAll(".vg-item-rem").forEach(b => b.addEventListener("click", () => vgRemoverItem(b.dataset.id)));
  $("btn-vg-add-equip")?.addEventListener("click", () => {
    const id = $("vg-add-equip").value; if(!id){ aviso("app-aviso", "Escolha o equipamento.", "erro"); return; }
    const e = _frotaEquipOutros.concat(_frotaVeic).find(x => x.id === id) || {};
    vgAddItem({ equipamento_id: id, descricao: [e.codigo, e.nome].filter(Boolean).join(" — ") || "Equipamento" });
  });
  vgLigarBuscaAcessorio();
  vgLigarBuscaProduto();
}
function vgLigarBuscaAcessorio(){
  const inp = $("vg-add-ace"), lista = $("vg-add-ace-res");
  if(!inp || !lista) return;
  let t = null;
  const fechar = () => { inp.value = ""; lista.innerHTML = ""; lista.style.display = "none"; };
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = inp.value.trim().toLowerCase();
      if(termo.length < 2){ lista.innerHTML = ""; lista.style.display = "none"; return; }
      if(typeof aceCatalogo !== "function"){ lista.innerHTML = `<div class="resultado-item vazio">Catálogo de acessórios indisponível.</div>`; lista.style.display = ""; return; }
      let cat = []; try { cat = await aceCatalogo(); } catch(e){ aviso("app-aviso", "Não foi possível carregar os acessórios: " + (e.message || e), "erro"); return; }
      const descr = a => (typeof aceDescr === "function" ? aceDescr(a) : (a.tipo || "Acessório"));
      const onde = a => (typeof aceOnde === "function" ? aceOnde(a) : (a.local_tipo || ""));
      const disp = cat.filter(a => a.ativo !== false && a.local_tipo !== "perdido" && a.condicao !== "baixado");
      const hits = disp.filter(a => String(a.marcacao || "").toLowerCase().includes(termo) || String(a.jogo || "").toLowerCase() === termo || descr(a).toLowerCase().includes(termo));
      const jogos = [...new Set(disp.filter(a => a.jogo && String(a.jogo).toLowerCase().includes(termo)).map(a => a.jogo))].slice(0, 5);
      if(!hits.length && !jogos.length){ lista.innerHTML = `<div class="resultado-item vazio">Nenhuma peça encontrada.</div>`; lista.style.display = ""; return; }
      const naLista = new Set(vgItensTodos().map(i => i.acessorio_id).filter(Boolean));
      lista.innerHTML = jogos.map(j => `<div class="resultado-item vg-ace-jogo" data-jogo="${esc(j)}"><strong>🧩 Jogo ${esc(j)}</strong> — adicionar as ${disp.filter(a => a.jogo === j).length} peça(s)</div>`).join("") +
        hits.slice(0, 30).map(a => `<div class="resultado-item${naLista.has(a.id) ? " ja" : ""}" data-id="${esc(a.id)}"><strong>${esc(a.marcacao)}</strong> — ${esc(descr(a))}${a.jogo ? ` <span class="meta">jogo ${esc(a.jogo)}</span>` : ""} <span class="meta" style="float:right;">${esc(onde(a))}${naLista.has(a.id) ? " · já na viagem" : ""}</span></div>`).join("") +
        (hits.length > 30 ? `<div class="resultado-item vazio">… e mais ${hits.length - 30}. Refine a busca.</div>` : "");
      lista.style.display = "";
      const item = a => ({ acessorio_id: a.id, descricao: `${descr(a)} · ${a.marcacao}`, valor_unitario: Number(a.modelo?.preco_referencia || 0) });
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => { const a = cat.find(x => x.id === d.dataset.id); fechar(); if(a) vgAddItem(item(a)); }));
      lista.querySelectorAll(".vg-ace-jogo").forEach(d => d.addEventListener("click", () => { const pecas = disp.filter(a => a.jogo === d.dataset.jogo); fechar(); vgAddItens(pecas.map(item)); }));
    }, 200);
  });
}
function vgLigarBuscaProduto(){
  const inp = $("vg-add-prod"), lista = $("vg-add-prod-res");
  if(!inp || !lista) return;
  let t = null;
  inp.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = inp.value.trim();
      if(termo.length < 2){ lista.innerHTML = ""; lista.style.display = "none"; return; }
      const { data } = await sb.from("produtos").select("id,codigo,nome,unidade,custo_ultimo").or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%`).limit(20);
      const res = data || [];
      lista.innerHTML = res.length ? res.map(p => `<div class="resultado-item" data-id="${esc(p.id)}"><strong>${esc(p.codigo)}</strong> — ${esc(p.nome)} <em>(${esc(p.unidade)})</em></div>`).join("") : `<div class="resultado-item vazio">Nenhum produto encontrado.</div>`;
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => {
        const p = res.find(x => x.id === d.dataset.id); inp.value = ""; lista.innerHTML = ""; lista.style.display = "none";
        if(p) vgAddItem({ produto_id: p.id, descricao: `${p.codigo} — ${p.nome}`, unidade: p.unidade || "un", valor_unitario: Number(p.custo_ultimo || 0) });
      }));
    }, 250);
  });
}
/* documento interno da viagem (uma movimentação por viagem, sem NF-e) para os itens lançados direto na ficha */
async function vgGarantirInterna(){
  let m = _vgMovs.find(x => x.interna);
  if(m) return m;
  const v = _vgAtual;
  if(!v.id){ aviso("app-aviso", "Salve a viagem antes de lançar itens.", "erro"); return null; }
  const { data: numero, error: errNum } = await sb.rpc("proximo_numero_movimentacao");
  if(errNum){ aviso("app-aviso", "Erro gerando número do documento: " + errNum.message, "erro"); return null; }
  const cam = vgVeiculo(v.caminhao_id), mot = vgMotorista(v.funcionario_id), frete = vgEhFrete(v);
  const reg = {
    numero, tipo: VG_FIN_TIPO_MOV[v.finalidade] || "remessa", status: "rascunho", interna: true, viagem_id: v.id,
    origem_tipo: v.origem_tipo, origem_obra_id: v.origem_obra_id, origem_descricao: v.origem_descricao || vgLado(v, "origem"), origem_uf: vgUfDe(v, "origem"),
    destino_tipo: v.destino_tipo, destino_obra_id: v.destino_obra_id, destino_descricao: v.destino_descricao || vgLado(v, "destino"), destino_uf: vgUfDe(v, "destino"),
    data_emissao: v.data || hojeISO(), frete_por_conta: frete ? "terceiro" : "proprio",   // fase 130: frete terceirizado leva placa e motorista do transportador
    motorista: frete ? (v.transportador_motorista || null) : (mot ? mot.nome : null), transp_placa: frete ? (v.transportador_placa || null) : (cam?.placa || null),
    observacoes: `Itens transportados da viagem ${v.numero} (documento interno, sem NF-e).`
  };
  const { data, error } = await sb.from("movimentacoes_ativos").insert(reg).select("id,numero,tipo,status,interna,nf_numero").single();
  if(error){ aviso("app-aviso", "Não foi possível criar o documento interno da viagem: " + error.message, "erro"); return null; }
  m = { ...data, itens: [] };
  _vgMovs.push(m);
  return m;
}
async function vgAddItens(lista){
  const mov = await vgGarantirInterna(); if(!mov) return;
  const todos = vgItensTodos();
  const novos = lista.filter(it => !(it.acessorio_id && todos.some(x => x.acessorio_id === it.acessorio_id)) && !(it.equipamento_id && todos.some(x => x.equipamento_id === it.equipamento_id)));
  if(!novos.length){ aviso("app-aviso", "Esses itens já estão na viagem.", "erro"); return; }
  const regs = novos.map(it => ({ movimentacao_id: mov.id, equipamento_id: it.equipamento_id || null, produto_id: it.produto_id || null, acessorio_id: it.acessorio_id || null,
    descricao: it.descricao, quantidade: it.quantidade || 1, unidade: it.unidade || "un", valor_unitario: it.valor_unitario || 0 }));
  const { error } = await sb.from("movimentacao_itens").insert(regs);
  if(error){ aviso("app-aviso", "Não foi possível adicionar: " + error.message, "erro"); return; }
  aviso("app-aviso", `${novos.length} item(ns) na viagem.`, "ok");
  _vgTab = "itens";
  await vgRecarregar();
}
async function vgAddItem(it){ return vgAddItens([it]); }
async function vgRemoverItem(id){
  const { error } = await sb.from("movimentacao_itens").delete().eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível tirar o item: " + error.message, "erro"); return; }
  _vgTab = "itens";
  await vgRecarregar();
}

/* ---------- aba Custo ---------- */
function vgRenderCusto(){
  const box = $("vg-custo"); if(!box) return;
  const v = _vgAtual, frete = vgEhFrete(v), fr = vgFrete(v), podeVer = vgPodeVerFrete();
  const obras = _vgRateio.map(r => ({ ...r, nome: vgObraTxt(r.obra_id) || "obra" }));
  const valor = vgValorViagem(v) || 0;
  const valorTxt = frete ? (fr && fr.valor_frete != null ? frotaMoeda(fr.valor_frete) : (podeVer ? "—" : '<span class="meta" title="visível só para quem lê Contas a pagar">restrito</span>')) : "";
  // fase 130: frete terceirizado mostra valor combinado, vencimento, documento e o título (quem lê contas a pagar)
  const cabecalho = frete ? `
    <div class="grade">
      <div class="campo"><label>Transportador</label><strong>${esc(vgTransportadorTxt(v))}</strong></div>
      <div class="campo"><label>Valor do frete</label><strong>${valorTxt}</strong></div>
      <div class="campo"><label>Vencimento</label><strong>${fr?.frete_vencimento ? dataBR(fr.frete_vencimento) : "—"}</strong></div>
      <div class="campo"><label>CT-e / NF do transportador</label><strong>${esc(fr?.frete_documento || "—")}${fr?.frete_emissao ? ` <span class="meta">emitido em ${dataBR(fr.frete_emissao)}</span>` : ""}</strong></div>
      <div class="campo"><label>Título a pagar</label><strong>${vgTagFreteStatus(v.frete_status) || "—"}${_vgTitulo ? ` <span class="meta">${frotaMoeda(_vgTitulo.valor)} · vence ${dataBR(_vgTitulo.vencimento)}${_vgTitulo.exportado_em ? " · exportado em " + dataBR(String(_vgTitulo.exportado_em).slice(0, 10)) : " · pendente de exportação"}</span>` : ""}</strong></div>
      <div class="campo"><label>Saída → chegada</label><strong>${vgDtBR(v.data_saida)} → ${vgDtBR(v.data_chegada)}</strong></div>
    </div>
    ${podeVer ? `<p class="meta" style="margin:0 0 8px;"><a href="#" id="vg-abrir-titulos">Abrir em Contas a pagar (títulos com origem Viagem) ↗</a></p>` : ""}
    ${fr?.frete_observacoes ? `<p class="meta" style="margin:0 0 8px;">Obs. do frete: ${esc(fr.frete_observacoes)}</p>` : ""}` : `
    <div class="grade">
      <div class="campo"><label>km rodado</label><strong>${v.km_total != null ? frotaNum(v.km_total) + " km" : "—"}</strong></div>
      <div class="campo"><label>R$/km</label><strong>${v.valor_km != null ? frotaNum(v.valor_km, 2) : "—"}</strong></div>
      <div class="campo"><label>Custo da viagem</label><strong>${v.valor_total != null ? frotaMoeda(v.valor_total) : "—"}</strong></div>
      <div class="campo"><label>Saída → chegada</label><strong>${vgDtBR(v.data_saida)} → ${vgDtBR(v.data_chegada)}</strong></div>
    </div>`;
  box.innerHTML = `
    ${/* html */ cabecalho}
    <h3 class="titulo-bloco">Rateio por obra <span class="meta">(partes iguais entre a obra principal e as obras de destino das notas; vw_viagem_obras)</span></h3>
    ${obras.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Obra</th><th class="num">Fração</th><th class="num">Valor</th><th class="col-acao"></th></tr></thead>
      <tbody>${obras.map(o => `<tr><td>${linkObra(o.obra_id, o.nome)}</td><td class="num">${Math.round(Number(o.fracao) * 100)}%</td><td class="num">${frete && !(fr && fr.valor_frete != null) ? (podeVer ? "—" : '<span class="meta">restrito</span>') : frotaMoeda(valor * Number(o.fracao))}</td>
        <td class="col-acao"><button type="button" class="btn-sec btn-sm vg-obra-custos" data-obra="${esc(o.obra_id)}" title="Aba Custos da obra">💰 Custos da obra</button></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="vazio">${frete ? "Viagem sem obra: o frete fica sem rateio (o título a pagar nasce sem obra). Defina a obra de destino ou ligue uma nota com destino em obra." : "Viagem sem obra: o custo fica só no caminhão (aba Custos do equipamento). Defina a obra de destino ou ligue uma nota com destino em obra."}</p>`}
    <p class="nota">${frete
      ? 'O frete entra em <code>vw_custos</code> como origem "deslocamento", subtipo <code>frete_terceirizado</code>, com o transportador como fornecedor, sem equipamento e com a fração de cada obra; o valor aparece para quem lê Contas a pagar e para a engenharia (fase 130b). O título a pagar (origem Viagem) nasce com valor maior que zero e vencimento; viagem cancelada apaga o título não exportado.'
      : 'O custo entra em <code>vw_custos</code> como origem "deslocamento" (subtipo frota_propria, categoria deslocamento), com o caminhão como equipamento e a fração de cada obra. Viagem cancelada ou sem km não gera custo.'}</p>`;
  box.querySelectorAll(".vg-obra-custos").forEach(b => b.addEventListener("click", async () => {
    if(!irParaSecao("obras") || typeof abrirObra !== "function") return;
    await abrirObra(b.dataset.obra);
    document.querySelector('#obr-notebook button[data-tab="custos"]')?.click();
  }));
  $("vg-abrir-titulos")?.addEventListener("click", e => {
    e.preventDefault();
    if(!irParaSecao("contratos")) return;
    if(typeof _capFiltroOrigem !== "undefined"){ _capFiltroOrigem = "viagem"; _capIncluirExp = true; _capLote = null; }
    if(typeof capAtivarView === "function") capAtivarView("titulos");
  });
}

/* ---------- fase 130: anexos do transporte (CT-e, NF de simples remessa, MDF-e do transportador, comprovante) ----------
   Bucket privado viagens-anexos, caminho <viagem_id>/<arquivo>. MIME pela extensão e corpo reembalado em Blob (regra do
   CLAUDE.md: o supabase-js ignora contentType quando o corpo é File). Download por URL assinada (2 min). */
function vgTamanho(b){ b = Number(b || 0); return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? Math.round(b / 1024) + " KB" : b + " B"; }
function vgHtmlAnexos(pode){
  const v = _vgAtual, frete = vgEhFrete(v);
  return `
    <div class="lista-topo compacta" style="border:none;padding:0;"><h4 style="margin:0;font-size:var(--txt-md);">📎 Anexos do transporte <span class="contador">${_vgAnexos.length}</span></h4>
      <span class="meta">${frete ? "CT-e, NF de simples remessa, MDF-e do transportador e comprovantes do frete terceirizado." : "Documentos do transporte que não saem do app (comprovante, PDF do transportador…)."} PDF, XML ou imagem até 20 MB.</span></div>
    ${_vgAnexos.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Tipo</th><th>Arquivo</th><th>Enviado</th><th class="num">Tamanho</th><th class="col-acao"></th></tr></thead>
      <tbody>${_vgAnexos.map(a => `<tr>
        <td><span class="tag cinza">${esc(VG_ANEXO_TIPOS[a.tipo] || a.tipo)}</span></td>
        <td><a href="#" class="vg-anexo-baixar" data-id="${esc(a.id)}" title="baixar (URL assinada)">${esc(a.nome)}</a></td>
        <td class="meta">${dataBR(String(a.created_at || "").slice(0, 10))}${a.autor?.nome ? " · " + esc(a.autor.nome) : ""}</td>
        <td class="num meta">${esc(vgTamanho(a.tamanho_bytes))}</td>
        <td class="col-acao">${pode ? `<button type="button" class="btn-rem vg-anexo-rem" data-id="${esc(a.id)}" title="remover o anexo">&times;</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>` : `<p class="vazio">${v.id ? "Nenhum anexo." : "Salve a viagem para anexar documentos."}</p>`}
    ${pode && v.id ? `<div class="grade" style="margin-top:8px;">
      <div class="campo"><label>Tipo</label><select id="vg-anexo-tipo">${Object.entries(VG_ANEXO_TIPOS).map(([k, l]) => `<option value="${esc(k)}"${k === (frete ? "cte" : "comprovante") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="campo largo"><label>Arquivo(s)</label><input type="file" id="vg-anexo-arq" multiple accept=".pdf,.xml,.jpg,.jpeg,.png,.webp" /></div>
      <div class="campo"><label>&nbsp;</label><button type="button" class="btn-sec" id="btn-vg-anexar">📎 Anexar</button></div>
    </div>` : ""}`;
}
function vgLigarAnexos(){
  const box = $("vg-docs"); if(!box) return;
  box.querySelectorAll(".vg-anexo-baixar").forEach(a => a.addEventListener("click", e => { e.preventDefault(); vgBaixarAnexo(a.dataset.id); }));
  box.querySelectorAll(".vg-anexo-rem").forEach(b => b.addEventListener("click", () => vgRemoverAnexo(b.dataset.id)));
  $("btn-vg-anexar")?.addEventListener("click", () => comBotaoTravado("btn-vg-anexar", vgAnexar));
}
async function vgAnexar(){
  const v = _vgAtual, inp = $("vg-anexo-arq");
  if(!v?.id || !inp || !usuarioAtual) return;
  const arquivos = [...(inp.files || [])];
  if(!arquivos.length){ aviso("app-aviso", "Escolha o arquivo antes de anexar.", "erro"); return; }
  const tipo = $("vg-anexo-tipo")?.value || "outro";
  const falhas = [];
  for(const f of arquivos){
    const ext = extensaoArquivo(f), mime = VG_ANEXO_MIME[ext];
    if(!mime){ falhas.push(`${f.name}: tipo não aceito (PDF, XML, JPG, PNG ou WEBP)`); continue; }
    if(f.size > VG_ANEXO_MAX_BYTES){ falhas.push(`${f.name}: ${vgTamanho(f.size)}; o limite é 20 MB`); continue; }
    const caminho = `${v.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb.storage.from(VG_ANEXO_BUCKET).upload(caminho, corpoComMime(f, mime), { cacheControl: "3600", contentType: mime, upsert: false });
    if(up.error){ falhas.push(`${f.name}: ${ehErroDePermissao(up.error) ? "seu perfil não anexa documentos da viagem" : up.error.message}`); continue; }
    const ins = await sb.from("viagem_anexos").insert({ viagem_id: v.id, tipo, nome: f.name, storage_path: caminho, mime_type: mime, tamanho_bytes: f.size, enviado_por: usuarioAtual.id });
    if(ins.error){ await sb.storage.from(VG_ANEXO_BUCKET).remove([caminho]); falhas.push(`${f.name}: ${ins.error.message}`); }
  }
  const enviados = arquivos.length - falhas.length;
  _vgTab = "documentos";
  await vgRecarregar();
  if(falhas.length) aviso("app-aviso", (enviados ? `${enviados} anexado(s). ` : "") + "Não foi possível anexar: " + falhas.join(" · "), "erro");
  else aviso("app-aviso", `${enviados} arquivo(s) anexado(s) à viagem.`, "ok");
}
async function vgBaixarAnexo(id){
  const a = _vgAnexos.find(x => x.id === id); if(!a) return;
  const { data, error } = await sb.storage.from(VG_ANEXO_BUCKET).createSignedUrl(a.storage_path, 120, { download: a.nome || true });
  if(error || !data?.signedUrl){ aviso("app-aviso", "Não foi possível baixar o anexo: " + (error?.message || "sem permissão"), "erro"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
async function vgRemoverAnexo(id){
  const a = _vgAnexos.find(x => x.id === id); if(!a) return;
  if(!confirm(`Remover o anexo "${a.nome}"?`)) return;
  const { error, count } = await sb.from("viagem_anexos").delete({ count: "exact" }).eq("id", id);
  if(error || !count){ aviso("app-aviso", "Não foi possível remover: " + (error?.message || "seu perfil não altera anexos da viagem"), "erro"); return; }
  await sb.storage.from(VG_ANEXO_BUCKET).remove([a.storage_path]);
  _vgTab = "documentos";
  await vgRecarregar();
}
/* busca do transportador (fornecedores ativos, por nome ou CNPJ) */
function vgLigarBuscaTransportador(){
  const inp = $("vg-transp-busca"), lista = $("vg-transp-res");
  if(!inp || !lista) return;
  let t = null;
  const fechar = () => { lista.innerHTML = ""; lista.style.display = "none"; };
  inp.addEventListener("input", () => {
    _vgTranspSel = null;   // digitou: a escolha anterior cai até clicar num resultado
    clearTimeout(t);
    t = setTimeout(async () => {
      const termo = inp.value.trim();
      if(termo.length < 2){ fechar(); return; }
      const like = `%${termo.replace(/[%_,()]/g, " ")}%`;
      const { data, error } = await sb.from("fornecedores").select("id,razao_social,nome_fantasia,cpf_cnpj,cidade,uf").eq("ativo", true)
        .or(`razao_social.ilike.${like},nome_fantasia.ilike.${like},cpf_cnpj.ilike.${like}`).order("razao_social").limit(20);
      if(error){ lista.innerHTML = `<div class="resultado-item vazio">Erro: ${esc(error.message)}</div>`; lista.style.display = ""; return; }
      const res = data || [];
      lista.innerHTML = res.length ? res.map(f => `<div class="resultado-item" data-id="${esc(f.id)}"><strong>${esc(f.razao_social)}</strong>${f.nome_fantasia && f.nome_fantasia !== f.razao_social ? ` (${esc(f.nome_fantasia)})` : ""} <span class="meta" style="float:right;">${esc([f.cpf_cnpj, [f.cidade, f.uf].filter(Boolean).join("/")].filter(Boolean).join(" · "))}</span></div>`).join("")
        : `<div class="resultado-item vazio">Nenhum fornecedor ativo com esse nome. Cadastre o transportador em Compras › Fornecedores.</div>`;
      lista.style.display = "";
      lista.querySelectorAll(".resultado-item[data-id]").forEach(d => d.addEventListener("click", () => {
        const f = res.find(x => x.id === d.dataset.id); fechar();
        if(f){ _vgTranspSel = f; inp.value = f.razao_social; }
      }));
    }, 250);
  });
  inp.addEventListener("blur", () => setTimeout(fechar, 200));
}

/* ---------- ir para a ficha da nota e voltar para a viagem ---------- */
async function vgIrParaMov(id){
  const vid = _vgAtual?.id;
  if(!irParaSecao("movimentacoes")) return;
  if(typeof carregarMovimentacoes === "function" && !(typeof _movRegistros !== "undefined" && _movRegistros.length)) await carregarMovimentacoes();
  if(typeof _movVoltarPara !== "undefined") _movVoltarPara = () => { if(irParaSecao("frota") && vid) abrirViagem(vid); };
  if(typeof abrirMovimentacao === "function") abrirMovimentacao(id);
}

/* ---------- aba Documentos: notas de remessa/retorno (NF-e) e MDF-e ----------
   A nota nasce ligada à viagem com origem, destino, motorista e placa herdados e abre a ficha de Movimentações
   (sec-movimentacoes), que volta para cá. O MDF-e agrupa as notas emitidas da viagem; encerra ao concluir. */
let _vgNotasSoltas = null;
function vgRenderDocs(){
  const box = $("vg-docs"); if(!box) return;
  const v = _vgAtual, pode = logPodeOperar() && v.status !== "cancelada";
  const movLbl = (typeof MOV_TIPOS === "object" && MOV_TIPOS) || {};
  const movSt = (typeof MOV_STATUS === "object" && MOV_STATUS) || {};
  const notas = vgNotas();
  const emitidasSemMdfe = notas.filter(m => m.nf_numero && ["emitida", "em_transito", "recebida"].includes(m.status) && !m.mdfe_id);
  const mdfeNum = id => (_vgMdfes.find(x => x.id === id) || {}).numero;
  box.innerHTML = `
    <div class="lista-topo compacta" style="border:none;padding:0;"><h4 style="margin:0;font-size:var(--txt-md);">🧾 Notas da viagem <span class="contador">${notas.length}</span></h4>
      ${pode && v.id ? `<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="btn-sec btn-sm" id="btn-vg-nota-remessa" title="cria a nota de remessa já ligada à viagem, com origem, destino, motorista e placa herdados">+ Nota de remessa</button>
        <button type="button" class="btn-sec btn-sm" id="btn-vg-nota-retorno">+ Nota de retorno</button>
        <button type="button" class="btn-sec btn-sm" id="btn-vg-vincular" title="nota já criada em Movimentações, ainda sem viagem">🔗 Vincular nota existente</button></span>` : ""}
    </div>
    ${notas.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Nota</th><th>Tipo</th><th>Status</th><th>NF-e</th><th>Chave</th><th class="num">Itens</th><th class="num">Valor</th><th>MDF-e</th><th class="col-acao"></th></tr></thead>
      <tbody>${notas.map(m => `<tr>
        <td><a href="#" class="vg-nota-abrir" data-id="${esc(m.id)}" title="abrir a ficha da nota"><strong>${esc(m.numero)}</strong></a></td>
        <td>${esc(movLbl[m.tipo] || m.tipo)}</td>
        <td>${movSt[m.status] ? `<span class="tag ${esc(movSt[m.status].cor)}">${esc(movSt[m.status].label)}</span>` : esc(m.status)}</td>
        <td>${m.nf_numero ? esc(`${m.nf_numero}/${m.nf_serie || "1"}`) : '<span class="meta">—</span>'}${m.nf_status ? " " + tagStatus("nfe", m.nf_status) : ""}${m.nf_status && m.nf_ambiente === "homologacao" ? ' <span class="tag ambar" title="emitida em homologação: sem valor fiscal">homolog.</span>' : ""}</td>
        <td class="meta" title="${esc(m.nf_chave_acesso || "")}">${m.nf_chave_acesso ? esc(String(m.nf_chave_acesso).slice(0, 8)) + "…" : "—"}</td>
        <td class="num">${(m.itens || []).length}</td><td class="num">${brl(m.valor_total_produtos)}</td>
        <td>${m.mdfe_id ? esc(mdfeNum(m.mdfe_id) || "sim") : '<span class="meta">—</span>'}</td>
        <td class="col-acao">${pode && m.status === "rascunho" ? `<button type="button" class="btn-rem vg-nota-desvincular" data-id="${esc(m.id)}" title="tirar a nota desta viagem (ela continua existindo, sem viagem)">&times;</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>` : `<p class="vazio">${v.id ? "Nenhuma nota nesta viagem. Crie a nota de remessa ou retorno, ou vincule uma existente." : "Salve a viagem para criar notas."}</p>`}
    <div id="vg-vincular-box" style="display:none;margin:8px 0;"></div>
    <hr style="border:none;border-top:1px solid var(--borda);margin:14px 0;">
    <div class="lista-topo compacta" style="border:none;padding:0;"><h4 style="margin:0;font-size:var(--txt-md);">📑 MDF-e <span class="contador">${_vgMdfes.length}</span></h4>
      ${pode && v.id ? `<button type="button" class="btn-sec btn-sm" id="btn-vg-gerar-mdfe" style="margin-left:auto;" ${emitidasSemMdfe.length ? "" : 'disabled title="precisa de nota emitida (com número de NF-e) ainda sem manifesto"'}>+ Gerar MDF-e${emitidasSemMdfe.length ? ` (${emitidasSemMdfe.length} nota(s))` : ""}</button>` : ""}
    </div>
    ${_vgMdfes.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>MDF-e</th><th>Status</th><th>Emissão</th><th>Placa · motorista</th><th>UF</th><th class="num">Notas</th><th>Chave de acesso</th><th>Protocolo</th><th class="col-acao"></th></tr></thead>
      <tbody>${_vgMdfes.map(d => {
        const st = VG_MDFE_STATUS[d.status] || [d.status, "cinza"];
        const edit = pode && ["rascunho", "emitido"].includes(d.status);
        const nNotas = notas.filter(m => m.mdfe_id === d.id).length;
        return `<tr>
          <td><strong>${esc(d.numero || "—")}</strong>${d.data_encerramento ? `<br><span class="meta">encerrado em ${dataBR(d.data_encerramento)}</span>` : ""}</td>
          <td><span class="tag ${esc(st[1])}">${esc(st[0])}</span></td><td>${dataBR(d.data_emissao)}</td>
          <td>${esc(d.placa)}<br><span class="meta">${esc(d.motorista_nome)}</span></td>
          <td>${esc(String(d.uf_origem).toUpperCase())} → ${esc(String(d.uf_destino).toUpperCase())}</td>
          <td class="num">${nNotas}</td>
          <td>${edit ? `<input class="vg-mdfe-chave" data-id="${esc(d.id)}" value="${esc(d.chave_acesso || "")}" placeholder="44 dígitos" maxlength="44" style="width:170px;" />` : `<span class="meta" title="${esc(d.chave_acesso || "")}">${d.chave_acesso ? esc(String(d.chave_acesso).slice(0, 8)) + "…" : "—"}</span>`}</td>
          <td>${edit ? `<input class="vg-mdfe-prot" data-id="${esc(d.id)}" value="${esc(d.protocolo || "")}" style="width:120px;" />` : esc(d.protocolo || "—")}</td>
          <td class="col-acao" style="white-space:nowrap;">${pode ? /* html */ [
            edit ? `<button type="button" class="btn-sec btn-sm vg-mdfe-salvar" data-id="${esc(d.id)}" title="guardar chave e protocolo">💾</button>` : "",
            d.status === "rascunho" ? `<button type="button" class="btn-sec btn-sm vg-mdfe-st" data-id="${esc(d.id)}" data-st="emitido" title="marcar como emitido no UniNFe">✓ Emitido</button>` : "",
            d.status === "emitido" ? `<button type="button" class="btn-sec btn-sm vg-mdfe-st" data-id="${esc(d.id)}" data-st="em_transito">🚛 Trânsito</button>` : "",
            ["emitido", "em_transito"].includes(d.status) ? `<button type="button" class="btn-sec btn-sm vg-mdfe-st" data-id="${esc(d.id)}" data-st="encerrado" title="encerra o manifesto (chegada)">🔒 Encerrar</button>` : "",
            !["encerrado", "cancelado"].includes(d.status) ? `<button type="button" class="btn-sec btn-sm acao-perigo vg-mdfe-st" data-id="${esc(d.id)}" data-st="cancelado">✗</button>` : ""
          ].join(" ") : ""}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="vazio">Nenhum MDF-e. O manifesto agrupa as notas emitidas da viagem (frete próprio); "Gerar MDF-e" monta com a placa, o motorista e as UFs.</p>`}
    <p class="nota">NF-e e MDF-e são emitidos no UniNFe; o sistema guarda número, chave, protocolo e PDF. "Dados UniNFe" na ficha da nota monta o texto para digitar lá. Ao concluir a viagem, os MDF-e emitidos ou em trânsito são encerrados.</p>
    <hr style="border:none;border-top:1px solid var(--borda);margin:14px 0;">
    ${/* html */ vgHtmlAnexos(pode)}`;
  vgLigarAnexos();
  box.querySelectorAll(".vg-nota-abrir").forEach(a => a.addEventListener("click", e => { e.preventDefault(); vgIrParaMov(a.dataset.id); }));
  box.querySelectorAll(".vg-nota-desvincular").forEach(b => b.addEventListener("click", () => vgDesvincularNota(b.dataset.id)));
  $("btn-vg-nota-remessa")?.addEventListener("click", () => comBotaoTravado("btn-vg-nota-remessa", () => vgNovaNota("remessa")));
  $("btn-vg-nota-retorno")?.addEventListener("click", () => comBotaoTravado("btn-vg-nota-retorno", () => vgNovaNota("retorno")));
  $("btn-vg-vincular")?.addEventListener("click", vgMostrarVincular);
  $("btn-vg-gerar-mdfe")?.addEventListener("click", () => comBotaoTravado("btn-vg-gerar-mdfe", vgGerarMdfe));
  box.querySelectorAll(".vg-mdfe-salvar").forEach(b => b.addEventListener("click", () => vgMdfeSalvar(b.dataset.id)));
  box.querySelectorAll(".vg-mdfe-st").forEach(b => b.addEventListener("click", () => vgMdfeStatus(b.dataset.id, b.dataset.st)));
}
function vgNotaBase(tipo){
  const v = _vgAtual, cam = v.caminhao || vgVeiculo(v.caminhao_id), mot = v.funcionario || vgMotorista(v.funcionario_id), frete = vgEhFrete(v);
  return {
    tipo, status: "rascunho", interna: false, viagem_id: v.id,
    origem_tipo: v.origem_tipo, origem_obra_id: v.origem_obra_id, origem_descricao: v.origem_descricao || vgLado(v, "origem"), origem_uf: vgUfDe(v, "origem"),
    destino_tipo: v.destino_tipo, destino_obra_id: v.destino_obra_id, destino_descricao: v.destino_descricao || vgLado(v, "destino"), destino_uf: vgUfDe(v, "destino"),
    data_emissao: hojeISO(), data_saida: v.data || null, frete_por_conta: frete ? "terceiro" : "proprio",
    motorista: frete ? (v.transportador_motorista || null) : (mot ? mot.nome : null), transp_placa: frete ? (v.transportador_placa || null) : (cam?.placa || null),
    observacoes: `Nota da viagem ${v.numero}.`
  };
}
async function vgNovaNota(tipo){
  const v = _vgAtual;
  if(!v.id){ aviso("app-aviso", "Salve a viagem primeiro.", "erro"); return; }
  const { data: numero, error: errNum } = await sb.rpc("proximo_numero_movimentacao");
  if(errNum){ aviso("app-aviso", "Erro gerando número da nota: " + errNum.message, "erro"); return; }
  const { data: mov, error } = await sb.from("movimentacoes_ativos").insert({ numero, ...vgNotaBase(tipo) }).select("id").single();
  if(error){ aviso("app-aviso", "Não foi possível criar a nota: " + error.message, "erro"); return; }
  // itens lançados direto na viagem (documento interno) passam para a nota; o interno vazio é removido
  const interna = _vgMovs.find(m => m.interna);
  if(interna && (interna.itens || []).length && confirm(`Levar os ${interna.itens.length} item(ns) lançados na viagem para esta nota?`)){
    const { error: e2 } = await sb.from("movimentacao_itens").update({ movimentacao_id: mov.id }).eq("movimentacao_id", interna.id);
    if(e2) aviso("app-aviso", "A nota foi criada, mas os itens não foram movidos: " + e2.message, "erro");
    else await sb.from("movimentacoes_ativos").delete().eq("id", interna.id);
  }
  _frotaViagens.chave = null; _frotaDocs = null;
  aviso("app-aviso", `Nota ${numero} criada e ligada à viagem.`, "ok");
  _vgTab = "documentos";
  if(typeof podeVerMovimentacoes === "function" && podeVerMovimentacoes()) await vgIrParaMov(mov.id);
  else await vgRecarregar();
}
async function vgMostrarVincular(){
  const box = $("vg-vincular-box"); if(!box) return;
  if(box.style.display !== "none"){ box.style.display = "none"; return; }
  box.style.display = "";
  box.innerHTML = `<p class="meta">Buscando notas sem viagem…</p>`;
  const { data, error } = await sb.from("movimentacoes_ativos").select("id,numero,tipo,status,nf_numero,data_emissao,origem_descricao,destino_descricao")
    .is("viagem_id", null).eq("interna", false).neq("status", "cancelada").order("data_emissao", { ascending: false }).limit(100);
  if(error){ box.innerHTML = `<p class="vazio">Erro: ${esc(error.message)}</p>`; return; }
  _vgNotasSoltas = data || [];
  if(!_vgNotasSoltas.length){ box.innerHTML = `<p class="vazio">Nenhuma nota sem viagem.</p>`; return; }
  const movLbl = (typeof MOV_TIPOS === "object" && MOV_TIPOS) || {};
  box.innerHTML = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><select id="vg-vinc-sel" style="flex:1;min-width:280px;"><option value="">— escolha a nota —</option>${_vgNotasSoltas.map(m => `<option value="${esc(m.id)}">${esc(m.numero)} · ${esc(movLbl[m.tipo] || m.tipo)} · ${esc(m.status)}${m.nf_numero ? " · NF " + esc(m.nf_numero) : ""} · ${dataBR(m.data_emissao)} · ${esc(m.origem_descricao || "?")} → ${esc(m.destino_descricao || "?")}</option>`).join("")}</select>
    <button type="button" class="btn btn-sm" id="btn-vg-vinc-ok">Vincular</button></div>`;
  $("btn-vg-vinc-ok")?.addEventListener("click", () => comBotaoTravado("btn-vg-vinc-ok", async () => {
    const id = $("vg-vinc-sel").value; if(!id){ aviso("app-aviso", "Escolha a nota.", "erro"); return; }
    const { error: e2 } = await sb.from("movimentacoes_ativos").update({ viagem_id: _vgAtual.id }).eq("id", id);
    if(e2){ aviso("app-aviso", "Não foi possível vincular: " + e2.message, "erro"); return; }
    aviso("app-aviso", "Nota vinculada à viagem.", "ok");
    _frotaViagens.chave = null; _frotaDocs = null; _vgTab = "documentos";
    await vgRecarregar();
  }));
}
async function vgDesvincularNota(id){
  if(!confirm("Tirar esta nota da viagem? Ela continua existindo, sem viagem (aparece em Documentos de Logística).")) return;
  const { error } = await sb.from("movimentacoes_ativos").update({ viagem_id: null }).eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível desvincular: " + error.message, "erro"); return; }
  _frotaViagens.chave = null; _frotaDocs = null; _vgTab = "documentos";
  await vgRecarregar();
}
/* MDF-e = manifesto desta viagem: placa e motorista da viagem, UFs das notas (ou das obras), notas emitidas sem manifesto */
async function vgGerarMdfe(){
  const v = _vgAtual; if(!v.id) return;
  const notas = vgNotas().filter(m => m.nf_numero && ["emitida", "em_transito", "recebida"].includes(m.status) && !m.mdfe_id);
  if(!notas.length){ aviso("app-aviso", "Nenhuma nota emitida sem MDF-e nesta viagem. Emita a NF-e no UniNFe e marque a nota como emitida.", "erro"); return; }
  // fase 130: no frete terceirizado o MDF-e do app leva a placa e o motorista do transportador (o MDF-e dele vai em Anexos)
  const frete = vgEhFrete(v);
  const cam = frete ? { placa: v.transportador_placa } : (v.caminhao || vgVeiculo(v.caminhao_id));
  const mot = frete ? (v.transportador_motorista ? { nome: v.transportador_motorista } : null) : (v.funcionario || vgMotorista(v.funcionario_id));
  if(!cam?.placa){ aviso("app-aviso", frete ? "Informe a placa do transportador antes de gerar o MDF-e." : "Defina o caminhão (com placa cadastrada) antes de gerar o MDF-e.", "erro"); vgAtivarTab("geral"); return; }
  if(!mot){ aviso("app-aviso", frete ? "Informe o motorista do transportador antes de gerar o MDF-e." : "Defina o motorista antes de gerar o MDF-e.", "erro"); vgAtivarTab("geral"); return; }
  const { data: numero, error: errNum } = await sb.rpc("proximo_numero_mdfe");
  if(errNum){ aviso("app-aviso", "Erro gerando número do MDF-e: " + errNum.message, "erro"); return; }
  const reg = {
    numero, status: "rascunho", data_emissao: hojeISO(), data_inicio_viagem: v.data || hojeISO(),
    uf_origem: notas[0].origem_uf || vgUfDe(v, "origem"), uf_destino: notas[0].destino_uf || vgUfDe(v, "destino"),
    motorista_nome: mot.nome, placa: cam.placa, tomador_tipo: "remetente", viagem_id: v.id,
    peso_total_kg: notas.reduce((s, m) => s + Number(m.peso_bruto_kg || 0), 0) || null,
    valor_carga: notas.reduce((s, m) => s + Number(m.valor_total_produtos || 0), 0) || null,
    observacoes: `Manifesto da viagem ${v.numero}: ${notas.map(m => "NF " + m.nf_numero).join(", ")}.`
  };
  const { data: mdfe, error } = await sb.from("manifestos_mdfe").insert(reg).select("id").single();
  if(error){ aviso("app-aviso", "Não foi possível gerar o MDF-e: " + error.message, "erro"); return; }
  const { error: e2 } = await sb.from("movimentacoes_ativos").update({ mdfe_id: mdfe.id }).in("id", notas.map(m => m.id));
  if(e2) aviso("app-aviso", "MDF-e criado, mas as notas não foram ligadas: " + e2.message, "erro");
  const { data: rec } = await sb.rpc("recomenda_mdfe", { p_movimentacao_id: notas[0].id });
  aviso("app-aviso", `MDF-e ${numero} gerado com ${notas.length} nota(s).${rec === false ? " Observação: frete próprio dentro do mesmo estado não exige MDF-e." : ""}`, "ok");
  _frotaDocs = null; _vgTab = "documentos";
  await vgRecarregar();
}
async function vgMdfeSalvar(id){
  const chave = (document.querySelector(`.vg-mdfe-chave[data-id="${id}"]`)?.value || "").replace(/\s/g, "") || null;
  const prot = (document.querySelector(`.vg-mdfe-prot[data-id="${id}"]`)?.value || "").trim() || null;
  if(chave && !/^\d{44}$/.test(chave)){ aviso("app-aviso", "A chave de acesso tem 44 dígitos.", "erro"); return; }
  const { error } = await sb.from("manifestos_mdfe").update({ chave_acesso: chave, protocolo: prot }).eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível salvar o MDF-e: " + error.message, "erro"); return; }
  aviso("app-aviso", "MDF-e salvo.", "ok");
  _vgTab = "documentos";
  await vgRecarregar();
}
async function vgMdfeStatus(id, status){
  const d = _vgMdfes.find(x => x.id === id); if(!d) return;
  if(status === "emitido"){
    const chave = (document.querySelector(`.vg-mdfe-chave[data-id="${id}"]`)?.value || d.chave_acesso || "").replace(/\s/g, "");
    if(!/^\d{44}$/.test(chave)){ aviso("app-aviso", "Informe a chave de acesso (44 dígitos) do MDF-e emitido no UniNFe.", "erro"); return; }
    await vgMdfeSalvar(id);
  }
  if(status === "cancelado" && !confirm("Cancelar este MDF-e? As notas ficam sem manifesto.")) return;
  const upd = { status };
  if(status === "encerrado") upd.data_encerramento = hojeISO();
  const { error } = await sb.from("manifestos_mdfe").update(upd).eq("id", id);
  if(error){ aviso("app-aviso", "Não foi possível mudar o MDF-e: " + error.message, "erro"); return; }
  if(status === "cancelado") await sb.from("movimentacoes_ativos").update({ mdfe_id: null }).eq("mdfe_id", id);
  aviso("app-aviso", `MDF-e ${(VG_MDFE_STATUS[status] || [status])[0].toLowerCase()}.`, "ok");
  _frotaDocs = null; _vgTab = "documentos";
  await vgRecarregar();
}

/* ---------- Romaneio (PDF): substitui o papel do pátio ----------
   Viagem, caminhão, motorista, origem → destino, itens (tipo, código/descrição, quantidade, série/marcação, nota),
   notas e MDF-e, assinatura do motorista e do recebedor. Estilo inline com hex porque roda fora do CSS do app. */
async function vgRomaneio(){
  const v = _vgAtual; if(!v?.id) return;
  const frete = vgEhFrete(v);   // fase 130: transportador no lugar do caminhão/motorista da CGL
  const cam = frete ? { codigo: vgTransportadorTxt(v), placa: null } : (v.caminhao || vgVeiculo(v.caminhao_id));
  const mot = frete ? (v.transportador_motorista ? { nome: v.transportador_motorista } : null) : (v.funcionario || vgMotorista(v.funcionario_id));
  const itens = vgItensTodos(), notas = vgNotas();
  const movLbl = (typeof MOV_TIPOS === "object" && MOV_TIPOS) || {};
  const td = "border:1px solid #777;padding:4px 5px;vertical-align:top;";
  const tipoItem = it => it.acessorio_id ? "Acessório" : it.equipamento_id ? "Equipamento (TAG)" : it.produto_id ? "Produto" : "Item";
  const linhas = itens.map((it, n) => `<tr><td style="${td}text-align:center;">${n + 1}</td><td style="${td}">${esc(tipoItem(it))}</td><td style="${td}">${esc(it.descricao || "")}</td>
    <td style="${td}text-align:right;">${num(it.quantidade)} ${esc(it.unidade || "un")}</td><td style="${td}">${esc([it.numero_serie, it.chassi].filter(Boolean).join(" · ") || "")}</td>
    <td style="${td}">${it.mov.interna ? "—" : esc(it.mov.nf_numero ? "NF " + it.mov.nf_numero : it.mov.numero)}</td><td style="${td}width:46px;"></td></tr>`).join("")
    || `<tr><td colspan="7" style="${td}text-align:center;color:#666;">Nenhum item lançado na viagem.</td></tr>`;
  const notasTxt = notas.length ? notas.map(m => `${esc(m.numero)}${m.nf_numero ? ` (NF ${esc(m.nf_numero)}/${esc(m.nf_serie || "1")})` : ""} · ${esc(movLbl[m.tipo] || m.tipo)} · ${esc(m.status)}`).join("<br>") : "Sem nota fiscal nesta viagem.";
  const mdfeTxt = _vgMdfes.map(d => `${esc(d.numero || "MDF-e")} · ${esc(d.status)}${d.chave_acesso ? " · chave " + esc(d.chave_acesso) : ""}`).join("<br>");
  const html = `<div style="font-family:'Open Sans',Arial,sans-serif;font-size:11px;color:#111;">
    ${typeof pdfCabecalhoHTML === "function" ? pdfCabecalhoHTML("Romaneio de carga", `Viagem ${v.numero} · ${dataBR(v.data)}`) : `<h2>Romaneio de carga — ${esc(v.numero)}</h2>`}
    <table style="width:100%;border-collapse:collapse;margin:10px 0 12px;"><tr>
      <td style="padding:3px;width:34%;"><b>${frete ? "Transportador" : "Caminhão"}:</b> ${esc(cam ? `${cam.codigo}${cam.nome ? " · " + cam.nome : ""}${cam.placa ? " · placa " + cam.placa : ""}` : "a definir")}</td>
      <td style="padding:3px;width:33%;"><b>Motorista:</b> ${esc(mot ? mot.nome : "a definir")}</td>
      <td style="padding:3px;"><b>Finalidade:</b> ${esc(VG_FINALIDADES[v.finalidade] || v.finalidade || "")}</td></tr><tr>
      <td style="padding:3px;"><b>Origem:</b> ${esc(vgLado(v, "origem"))}</td>
      <td style="padding:3px;"><b>Destino:</b> ${esc(vgLado(v, "destino"))}</td>
      <td style="padding:3px;"><b>Saída:</b> ${esc(vgDtBR(v.data_saida))}${v.km_saida != null ? ` · km ${frotaNum(v.km_saida)}` : ""}</td></tr></table>
    <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#eee;">
      <th style="${td}width:26px;">#</th><th style="${td}width:90px;text-align:left;">Tipo</th><th style="${td}text-align:left;">Código / descrição</th><th style="${td}width:70px;">Qtd</th><th style="${td}width:120px;text-align:left;">Série / marcação</th><th style="${td}width:90px;text-align:left;">Nota</th><th style="${td}">✔</th></tr></thead>
      <tbody>${linhas}</tbody></table>
    <p style="margin:10px 0 4px;"><b>Notas fiscais:</b><br>${notasTxt}</p>
    ${mdfeTxt ? `<p style="margin:4px 0;"><b>MDF-e:</b><br>${mdfeTxt}</p>` : ""}
    ${v.observacoes ? `<p style="margin:4px 0;"><b>Obs.:</b> ${esc(v.observacoes)}</p>` : ""}
    <table style="width:100%;margin-top:28px;border-collapse:collapse;"><tr>
      <td style="width:45%;border-top:1px solid #333;padding-top:4px;text-align:center;">Motorista<br><span style="color:#555;">${esc(mot ? mot.nome : "")}</span></td><td style="width:10%;"></td>
      <td style="width:45%;border-top:1px solid #333;padding-top:4px;text-align:center;">Recebedor (nome legível e data)</td></tr></table>
    <p style="margin-top:12px;font-size:9px;color:#555;">Conferir item a item na carga e na descarga. Divergência: anotar no romaneio e registrar na nota correspondente no sistema.</p>
  </div>`;
  const wrap = document.createElement("div"); wrap.innerHTML = html;
  if(typeof html2pdf === "undefined" || typeof pdfGerar !== "function"){
    const w = window.open("", "_blank"); if(!w){ aviso("app-aviso", "Permita pop-ups para imprimir.", "erro"); return; }
    w.document.write(`<html><head><title>${esc(v.numero)}</title><style>@page { size: A4; margin: 14mm; }</style></head><body>${html}</body></html>`); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); return;
  }
  try { await pdfGerar(wrap, { filename: `Romaneio_${v.numero}.pdf`, largura: 182, topo: 14 }); }
  catch(e){ aviso("app-aviso", "Não foi possível gerar o PDF: " + (e.message || e), "erro"); }
}

/* ---------- ligação ---------- */
function ligarViagens(){
  if(!$("vg-ficha")) return;
  $("btn-vg-voltar")?.addEventListener("click", vgVoltar);
  $("btn-vg-salvar")?.addEventListener("click", () => comBotaoTravado("btn-vg-salvar", () => salvarViagem()));
  $("btn-vg-iniciar")?.addEventListener("click", () => comBotaoTravado("btn-vg-iniciar", vgIniciar));
  $("btn-vg-concluir")?.addEventListener("click", () => comBotaoTravado("btn-vg-concluir", vgConcluir));
  $("btn-vg-cancelar")?.addEventListener("click", vgCancelar);
  $("btn-vg-excluir")?.addEventListener("click", excluirViagem);
  $("btn-vg-romaneio")?.addEventListener("click", () => { if(typeof vgRomaneio === "function") comBotaoTravado("btn-vg-romaneio", vgRomaneio); });
  document.querySelectorAll("#vg-statusbar .stage").forEach(el => el.addEventListener("click", () => {
    const novo = el.dataset.status, v = _vgAtual;
    if(!v || !logPodeOperar()) return;
    if(!v.id){ aviso("app-aviso", "Salve a viagem primeiro.", "erro"); return; }
    if(novo === v.status) return;
    if(novo === "em_transito") vgIniciar();
    else if(novo === "concluida") vgConcluir();
    else if(novo === "planejada" && v.status !== "cancelada") vgReabrir();
  }));
  document.querySelectorAll("#vg-notebook button").forEach(b => b.addEventListener("click", () => vgAtivarTab(b.dataset.tab)));
  document.querySelectorAll("#vg-ficha .sb-btn").forEach(b => b.addEventListener("click", () => vgAtivarTab(b.dataset.gotoTab)));
  $("vg-origem-tipo")?.addEventListener("change", vgToggleObra);
  $("vg-destino-tipo")?.addEventListener("change", vgToggleObra);
  $("vg-origem-obra")?.addEventListener("change", () => vgObraEscolhida("origem"));
  $("vg-destino-obra")?.addEventListener("change", () => vgObraEscolhida("destino"));
  $("vg-caminhao")?.addEventListener("change", () => { $("vg-valor-km").value = ""; vgSugerirDoVeiculo(); });
  $("vg-finalidade")?.addEventListener("change", vgToggleFinalidade);   // fase 130
  vgLigarBuscaTransportador();
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarViagens); else ligarViagens();

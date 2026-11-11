/* ====================================================================
   Módulo: Foto do quadro da oficina (fase 156b, #262, 11/11/2026)
   A edge function extrair-quadro-oficina transcreve a foto do "Quadro de acompanhamento da produção"; aqui cada
   linha do quadro é casada com o documento (RP/OS/OF) e o funcionário e vira linha da grade de Apontamentos
   (js/apontamentos.js), com origem 'quadro'. Nada grava sem a conferência e o Gravar de quem aponta.
   Regras (decisões do Bernardo de 10/11/2026):
   - prefixo do app (RP, OS, OF) casa só com aquele tipo, pelo número do app: um aberto vem escolhido;
   - OR, OP ou outro texto: lista os candidatos (número do app de qualquer tipo e código do Odoo da OF) sem escolher;
   - EQ sem documento não grava: lista os documentos abertos do equipamento;
   - funcionário pelo primeiro nome; com homônimos, vale quem lançou hora na oficina nos últimos 60 dias;
   - atividade que passa do dia é dividida pela jornada (seg-qui 07:00–17:00, sex 07:00–16:00); as partes em sábado,
     domingo ou feriado ficam sem "incluir" para a pessoa confirmar e, incluídas, vão para aprovação;
   - "Paralizado DD/MM HH:MM" grava até a paralisação e deixa a atividade pendente; sem fim, a linha espera a foto
     do dia seguinte; mesma hora já gravada aparece "já lançada".
   Registro em apontamento_importacoes (foto no bucket apontamentos-quadro, JSON da IA e o que foi gravado).
   Prefixo: aq / apt-quadro-.
   ==================================================================== */

let _aqImport = null;          // { id, data_foto, gravadas: [] } da leitura aberta na grade
let _aqFuncsOficina = null;    // Set de funcionario_id com hora de oficina nos últimos 60 dias
const AQ_LETRA_TIPO = { OR: "RP", RP: "RP", OS: "OS", OP: "OF", OF: "OF" };
const AQ_JORNADA_INI = "07:00";

function aqNorm(s){ return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }
function aqFimJornada(d){ return new Date(d + "T12:00:00").getDay() === 5 ? "16:00" : "17:00"; }
function aqProxDia(d){ const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + 1); return dataLocalISO(x); }
function aqNumApp(numero){ const p = String(numero || "").match(/^(RP|OS|OF)-\d{4}-0*(\d+)$/); return p ? Number(p[2]) : null; }

/* candidatos a documento para "OR 734", "OS 1410", "OP 072", "EQ HG/07"… → { doc, candidatos: [{ doc, sugestao }], porque } */
async function aqCandidatosDoc(tipoTxt, numTxt){
  const tipo = String(tipoTxt || "").toUpperCase().replace(/[^A-Z]/g, "");
  const numStr = String(numTxt || "").trim();
  if(tipo === "EQ") return aqCandidatosEquip(numStr);
  const n = Number((numStr.match(/(\d+)\s*$/) || [])[1]);
  if(!n) return { doc: null, candidatos: [], porque: `"${[tipoTxt, numTxt].filter(Boolean).join(" ")}": documento não reconhecido, escolha na lista.` };
  if(["RP", "OS", "OF"].includes(tipo)){
    const abertos = _aptDocs.filter(d => d.tipo === tipo && aqNumApp(d.numero) === n);
    if(abertos.length === 1) return { doc: abertos[0], candidatos: [], porque: `${tipo} ${numStr} = ${abertos[0].numero} (número do app).` };
    if(abertos.length > 1) return { doc: null, candidatos: abertos.map(d => ({ doc: d, sugestao: false })), porque: "Mais de um documento com esse número: escolha." };
    const fechado = await aptProcurarFechado([tipo], n);
    return fechado
      ? { doc: null, candidatos: [{ doc: fechado, sugestao: false }], porque: `${fechado.numero} está ${aptStatusDoc(fechado.status)}: não recebe hora (quem pode reabrir decide).` }
      : { doc: null, candidatos: [], porque: `${tipo} ${numStr} não está entre os documentos abertos que você pode lançar.` };
  }
  // OR, OP ou outro: número do app de qualquer tipo + código do Odoo (WH/MO/000NN) da OF; nenhum vem escolhido
  const alvo = AQ_LETRA_TIPO[tipo] || null;
  const vistos = new Set();
  const cands = _aptDocs.filter(d => aqNumApp(d.numero) === n
      || (d.tipo === "OF" && Number((String(d.codigo_externo || "").match(/(\d+)\s*$/) || [])[1]) === n))
    .filter(d => !vistos.has(d.id) && vistos.add(d.id));
  if(cands.length){
    const doTipo = cands.filter(d => d.tipo === alvo);
    const lista = cands.map(d => ({ doc: d, sugestao: doTipo.length === 1 && d === doTipo[0] }));
    const sug = lista.find(c => c.sugestao);
    return { doc: null, candidatos: lista,
      porque: `"${tipo} ${numStr}" não é prefixo do app (RP, OS, OF): escolha${sug ? `; sugestão ${sug.doc.numero}` : ""}${cands.length > 1 ? ` (${cands.length} possíveis: número do app e código do Odoo)` : ""}.` };
  }
  const fechado = await aptProcurarFechado(alvo ? [alvo] : ["RP", "OS", "OF"], n);
  return fechado
    ? { doc: null, candidatos: [{ doc: fechado, sugestao: false }], porque: `Só ${fechado.numero} (${aptStatusDoc(fechado.status)}): não recebe hora; escolha outro documento.` }
    : { doc: null, candidatos: [], porque: `"${tipo} ${numStr}": nenhum documento aberto com esse número.` };
}
/* "EQ 07", "EQ HG/07", "EQ 78": documentos abertos do equipamento (código NN-XX), nenhum escolhido */
function aqCandidatosEquip(numStr){
  const t = String(numStr || "").toUpperCase();
  const n = Number((t.match(/(\d+)/) || [])[1]);
  const letras = (t.match(/[A-Z]+/) || [])[0] || "";
  const casa = d => { const p = String(d.equipamento || "").toUpperCase().match(/^0*(\d+)(?:-([A-Z]+))?$/); return p && Number(p[1]) === n && (!letras || p[2] === letras); };
  const cands = n ? _aptDocs.filter(casa) : [];
  return { doc: null, candidatos: cands.map(d => ({ doc: d, sugestao: false })),
    porque: `EQ ${numStr || ""} sem documento: abra a OS antes de apontar${cands.length ? ` ou escolha um dos ${cands.length} documento(s) aberto(s) do equipamento` : " (nenhum documento aberto do equipamento)"}.` };
}
/* primeiro nome → funcionário; homônimos: quem lançou hora na oficina nos últimos 60 dias */
function aqCasarFunc(nome){
  const pn = aqNorm(nome).split(/\s+/)[0];
  if(!pn) return { id: "", porque: "Sem responsável no quadro: escolha o funcionário." };
  let c = _aptFuncs.filter(f => aqNorm(f.nome).split(/\s+/)[0] === pn);
  if(c.length > 1 && _aqFuncsOficina){ const o = c.filter(f => _aqFuncsOficina.has(f.id)); if(o.length) c = o; }
  if(c.length === 1) return { id: c[0].id, porque: "" };
  return { id: "", porque: c.length ? `"${nome}": ${c.length} funcionários com esse nome, escolha.` : `"${nome}" não está entre os funcionários ativos: escolha.` };
}
async function aqCarregarFuncsOficina(){
  if(_aqFuncsOficina) return;
  const de = new Date(); de.setDate(de.getDate() - 60);
  const { data, error } = await lerTudo(() => sb.from("vw_apontamentos").select("id,funcionario_id").gte("data", dataLocalISO(de)), "id");
  _aqFuncsOficina = new Set(error ? [] : (data || []).map(h => h.funcionario_id).filter(Boolean));
}
/* "AAAA-MM-DDTHH:MM" → partes por dia pela jornada */
function aqDividir(ini, fim){
  const [d0, h0] = ini.split("T"), [d1, h1] = fim.split("T");
  if(d1 < d0 || (d1 === d0 && h1 <= h0)) return [];
  if(d0 === d1) return [{ data: d0, inicio: h0, fim: h1 }];
  const partes = [];
  for(let d = d0; d <= d1 && partes.length < 15; d = aqProxDia(d)){
    const i = d === d0 ? h0 : AQ_JORNADA_INI, f = d === d1 ? h1 : aqFimJornada(d);
    if(f > i) partes.push({ data: d, inicio: i, fim: f });
  }
  return partes;
}
/* "Paralizado 03/11 10:00" → "2026-11-03T10:00" (ano do início) */
function aqParalisadoDaObs(obs, ini){
  const m = String(obs || "").match(/(\d{1,2})\s*\/\s*(\d{1,2})\D+(\d{1,2})\s*[:h.]\s*(\d{2})/);
  if(!m || !ini) return null;
  return `${ini.slice(0, 4)}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${m[3].padStart(2, "0")}:${m[4]}`;
}

/* linhas da IA → linhas da grade */
async function aqCasarLinhas(lista, dataFoto){
  if(!_aptDocs.length) await aptCarregarDocs();
  if(!_aptFuncs.length) await aptCarregarCadastros();
  await aqCarregarFuncsOficina();
  const saida = [];
  for(const q of lista || []){
    const dc = await aqCandidatosDoc(q.doc_tipo, q.doc_numero);
    const fn = aqCasarFunc(q.responsavel);
    const quadro = { ordem: q.ordem, texto: [q.doc_tipo, q.doc_numero].filter(Boolean).join(" "), responsavel: q.responsavel,
      situacao: q.situacao, observacao: q.observacao, candidatos: dc.candidatos, confianca: q.confianca || {},
      porque: [dc.porque, fn.porque].filter(Boolean).join(" ") };
    const base = { ...aptLinhaNova(), origem: "quadro", doc: dc.doc, docTxt: dc.doc ? aptRotuloDoc(dc.doc) : quadro.texto,
      funcionario_id: fn.id, observacao: q.atividade || "", incluir: true };
    if(dc.doc?.tipo === "OS"){ await aptCarregarAtividades(dc.doc.id); }
    const paralisada = q.situacao === "paralisado";
    const fim = q.fim || (paralisada ? (q.paralisado_em || aqParalisadoDaObs(q.observacao, q.inicio)) : null);
    if(!q.inicio){ saida.push({ ...base, quadro, data: dataFoto || base.data, incluir: false, msg: "Sem data e hora de início no quadro: preencha ou deixe de fora." }); continue; }
    if(!fim){ saida.push({ ...base, quadro, data: q.inicio.slice(0, 10), inicio: q.inicio.slice(11), incluir: false,
      msg: "Em andamento: o quadro não tem fim; a hora entra com a foto do dia em que terminar." }); continue; }
    const partes = aqDividir(q.inicio, fim);
    if(!partes.length){ saida.push({ ...base, quadro, data: q.inicio.slice(0, 10), inicio: q.inicio.slice(11), fim: fim.slice(11), incluir: false, msg: "O fim no quadro é antes do início: confira." }); continue; }
    for(const [k, p] of partes.entries()){
      const aprov = await aptExigeAprovacao(p.data);
      const l = { ...base, quadro: { ...quadro }, data: p.data, inicio: p.inicio, fim: p.fim,
        hora_extra: !!(dc.doc && aprov), incluir: !(partes.length > 1 && aprov) };
      l.atividade_id = aptSugerirAtividade(l);
      l.msg = [partes.length > 1 ? `Parte ${k + 1} de ${partes.length}, pela jornada.` : "",
        aprov ? (partes.length > 1 ? "Sábado, domingo ou feriado: marque \"incluir\" se houve trabalho; vai para aprovação." : "Sábado, domingo ou feriado: vai para aprovação.") : "",
        paralisada && k === partes.length - 1 ? "Paralisada: grava até a paralisação e a atividade fica pendente." : ""].filter(Boolean).join(" ");
      saida.push(l);
    }
  }
  // já lançadas: a foto do dia seguinte repete o quadro
  for(const l of saida){
    if(!l.doc || !l.funcionario_id || !l.inicio || l.incluir === false) continue;
    const { ja } = await aptJaLancada(l.doc, l);
    if(ja){ l.estado = "repetida"; l.existente = ja; l.incluir = false; l.msg = `Já lançada em ${l.doc.numero} (fim ${aptHora(ja.fim)}).`; }
  }
  return saida;
}

/* ---------- leitura da foto ---------- */
function aqAbrir(){
  $("apt-quadro-box").style.display = "";
  if(!$("apt-quadro-data").value) $("apt-quadro-data").value = hojeISO();
  $("apt-quadro-status").textContent = "";
}
async function aqLerFoto(){
  const f = $("apt-quadro-arq").files?.[0], dataFoto = $("apt-quadro-data").value || hojeISO();
  if(!f){ aviso("app-aviso", "Escolha a foto do quadro.", "erro"); return; }
  const mime = mimeDoArquivo(f);
  if(!["image/jpeg", "image/png", "image/webp"].includes(mime)){ aviso("app-aviso", "Envie a foto em JPG, PNG ou WEBP.", "erro"); return; }
  if(f.size > 5 * 1024 * 1024){ aviso("app-aviso", "Foto acima de 5 MB: reduza e tente de novo.", "erro"); return; }
  if(_aqImport && _aptGrade.some(l => l.quadro)){ aviso("app-aviso", "Termine ou cancele a leitura do quadro que está na grade antes de ler outra foto.", "erro"); return; }
  const st = $("apt-quadro-status");
  st.textContent = "Guardando a foto…";
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mime];
  const caminho = `${usuarioAtual.id}/${dataFoto}_${Date.now()}.${ext}`;
  const { error: eUp } = await sb.storage.from("apontamentos-quadro").upload(caminho, corpoComMime(f, mime), { contentType: mime });
  if(eUp){ st.textContent = ""; aviso("app-aviso", "Não foi possível guardar a foto: " + eUp.message, "erro"); return; }
  st.textContent = "Lendo o quadro (até 1 minuto)…";
  const arq = await _imagemParaBase64Reduzida(f);
  const { data, error } = await iaInvocarComLimite("extrair-quadro-oficina", { arquivo_base64: arq.base64, media_type: arq.media_type, data_foto: dataFoto },
    "A leitura demorou demais. Tente de novo com uma foto de frente para o quadro.", 200000);
  if(error){
    let detalhe = error.message || "";
    try { if(error.context && typeof error.context.json === "function"){ const b = await error.context.json(); if(b?.error) detalhe = b.error; } } catch(_){ /* fica a mensagem */ }
    st.textContent = ""; aviso("app-aviso", "Não foi possível ler a foto: " + detalhe, "erro"); return;
  }
  const { data: imp, error: eImp } = await sb.from("apontamento_importacoes").insert({ data_foto: dataFoto, foto_path: caminho,
    ia_chamada_id: data.ia_chamada_id || null, extraido: data, criado_por: usuarioAtual.id }).select("id").single();
  if(eImp){ st.textContent = ""; aviso("app-aviso", "A foto foi lida, mas a importação não foi registrada: " + eImp.message, "erro"); return; }
  _aqImport = { id: imp.id, data_foto: dataFoto, gravadas: [] };
  st.textContent = "Casando as linhas com os documentos…";
  const linhas = await aqCasarLinhas(data.linhas || [], dataFoto);
  _aptGrade = _aptGrade.filter(l => l.docTxt || l.funcionario_id || l.inicio || l.fim).concat(linhas);
  $("apt-quadro-box").style.display = "none"; $("apt-quadro-arq").value = ""; st.textContent = "";
  $("btn-apt-quadro-cancelar").style.display = "";
  await aptAbrirGrade();
  const prontas = linhas.filter(l => l.doc && l.funcionario_id && l.incluir !== false).length;
  aviso("app-aviso", `${(data.linhas || []).length} linha(s) lidas no quadro, ${linhas.length} na grade; ${prontas} com documento e funcionário sugeridos. Confira cada uma antes de Gravar.`
    + (data.duvidas?.length ? ` Dúvidas da leitura: ${data.duvidas.join("; ")}` : ""), "aviso");
}
/* depois do Gravar: guarda na importação o que foi gravado (a diferença para o extraído é o que a pessoa corrigiu) */
async function aqAposGravar(usadas){
  if(!_aqImport) return;
  const novas = usadas.filter(l => l.quadro && ["gravada", "aguardando"].includes(l.estado));
  if(!novas.length) return;
  _aqImport.gravadas.push(...novas.map(l => ({ ordem: l.quadro.ordem, documento: l.doc?.numero || null, documento_id: l.doc?.id || null,
    funcionario_id: l.funcionario_id, data: l.data, inicio: l.inicio, fim: l.fim, observacao: l.observacao, hora_extra: !!l.hora_extra,
    centro_trabalho_id: l.centro_trabalho_id || null, estado: l.estado })));
  const { error } = await sb.from("apontamento_importacoes").update({ confirmado: _aqImport.gravadas,
    linhas_gravadas: _aqImport.gravadas.length, status: "conferida" }).eq("id", _aqImport.id);
  if(error) aviso("app-aviso", "As horas gravaram, mas o registro da importação não foi atualizado: " + error.message, "aviso");
  if(!_aptGrade.some(l => l.quadro && !["gravada", "aguardando"].includes(l.estado) && !novas.includes(l))) aqEncerrar();
}
async function aqCancelar(){
  if(!_aqImport) return;
  const pendentes = _aptGrade.filter(l => l.quadro).length;
  if(!confirm(`Descartar as ${pendentes} linha(s) do quadro que ainda estão na grade? As já gravadas continuam.`)) return;
  const { error } = await sb.from("apontamento_importacoes").update({ status: _aqImport.gravadas.length ? "conferida" : "cancelada" }).eq("id", _aqImport.id);
  if(error){ aviso("app-aviso", "Não foi possível cancelar: " + error.message, "erro"); return; }
  _aptGrade = _aptGrade.filter(l => !l.quadro);
  if(!_aptGrade.length) _aptGrade = [aptLinhaNova()];
  aqEncerrar(); aptRenderGrade();
  aviso("app-aviso", "Leitura do quadro descartada.", "ok");
}
function aqEncerrar(){ _aqImport = null; $("btn-apt-quadro-cancelar").style.display = "none"; }

function ligarApontamentosQuadro(){
  if(!$("btn-apt-quadro")) return;
  $("btn-apt-quadro").addEventListener("click", aqAbrir);
  $("btn-apt-quadro-fechar").addEventListener("click", () => { $("apt-quadro-box").style.display = "none"; });
  $("btn-apt-quadro-ler").addEventListener("click", () => comBotaoTravado("btn-apt-quadro-ler", () => aqLerFoto().catch(e => {
    $("apt-quadro-status").textContent = ""; aviso("app-aviso", "Não foi possível ler a foto: " + e.message, "erro"); })));
  $("btn-apt-quadro-cancelar").addEventListener("click", () => comBotaoTravado("btn-apt-quadro-cancelar", aqCancelar));
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarApontamentosQuadro);
else ligarApontamentosQuadro();

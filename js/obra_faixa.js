/* ====================================================================
   Módulo: faixa dos últimos 14 dias do diário na ficha da obra — fase 163 (prefixo obf-)
   Carregado depois de js/obra_abas.js. Só leitura: nada é gravado e nenhum estado novo existe no banco.
   - Quem chama é carregarRDOsDaObra (js/obra_abas.js): obfReservaHTML() devolve o lugar do bloco "Últimos 14 dias" no topo da
     aba RDOs e obfPreencher() lê o que falta e desenha, sem segurar a tabela de diários.
   - Uma faixa por obra (não por máquina). Com o filtro de máquina da aba ligado, a faixa segue o filtro.
   - Estado do dia, nesta ordem: estaca do computador de bordo sem diário > devolvido ao campo > rascunho (ou "enviado pelo
     campo", quando todos os rascunhos do dia foram enviados) > finalizado > sem diário > hoje > dia que não conta para a obra.
     Dia que não conta mas tem diário mostra o estado do diário. Dia sem dado é "sem diário": nenhum estado é inventado.
   - Dia que conta = a regra de somar_dias_uteis_obra (fase 140a), refeita aqui com a tabela feriados: fora domingo, sábado
     de obra sem jornada_sabado_entrada, feriado nacional, da UF ou do município da obra; e fora o que vem antes do início.
   - Leituras novas, todas por obra e pela janela de 14 dias: os carimbos do campo em rdo, as estacas do Geodigitus que
     ainda não estão em diário e os feriados. O resto vem de vw_rdo_resumo (que a aba já lê) e da obra aberta.
   - A previsão de término por extenso usa a leitura que o chip do cabeçalho já fez (obrPrevisaoLida, js/obras.js).
   obfMontarDias, obfDiaConta, obfResumo, obfFrases, obfTituloDia, obfLinhaPrevisao e obfFaixaHTML são puras (sem tela nem
   banco) e testadas por scripts/testar-fase163.mjs.
   ==================================================================== */

const OBF_DIAS = 14;
const OBF_VAZIO_SEM_RDO = "Esta obra ainda não tem diário. O diário nasce em RDO › Novo, pela importação (Geodigitus, planilha do Maya, PDF ou foto) ou pelo app do operador.";
const OBF_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const OBF_SEMANA_LONGO = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
// texto curto da casa: o estado não depende só da cor
const OBF_CURTO = { estaca_sem_diario: "! estaca", devolvido: "devolvido", rascunho: "rascunho", finalizado: "finalizado", sem_diario: "sem diário", hoje: "hoje", nao_conta: "—" };
const OBF_MOTIVO = { domingo: "domingo", sabado: "sábado, e a obra não tem jornada de sábado", antes_inicio: "antes do início da obra" };
const OBF_FERIADO = { nacional: "feriado nacional", uf: "feriado estadual", municipio: "feriado do município" };
const OBF_LEGENDA = [
  ["finalizado", "finalizado"], ["rascunho", "rascunho ou enviado pelo campo"], ["devolvido", "devolvido ao campo"],
  ["estaca_sem_diario", "estaca do computador de bordo sem diário"], ["sem_diario", "sem diário"],
  ["nao_conta", "não conta (domingo, sábado sem jornada, feriado ou antes do início)"]
];

/* ---------- datas: conta de calendário em UTC, sem hora e sem fuso (a data entra e sai como aaaa-mm-dd) ---------- */
function obfPartes(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if(!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === m[0] ? t : null;   // 2026-13-40 não é data
}
function obfSomarDias(iso, n){
  const t = obfPartes(iso);
  return t == null ? "" : new Date(t + n * 86400000).toISOString().slice(0, 10);
}
function obfDiaSemana(iso){
  const t = obfPartes(iso);
  return t == null ? null : new Date(t).getUTCDay();
}
const obfDataBR = (iso) => { const p = String(iso || "").slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : ""; };
const obfDiaMes = (iso) => obfDataBR(iso).slice(0, 5);
const obfNumero = (v, casas = 1) => (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const obfPlural = (n, um, varios) => `${obfNumero(n, 0)} ${Number(n) === 1 ? um : varios}`;

/* o mesmo dia de geoDia (js/geodigitus.js) e do resolver: início da perfuração em Brasília. Sem hora válida, a estaca não tem dia. */
function obfDiaGeo(g){
  if(!g || !g.perfuracao_inicio) return "";
  const d = new Date(g.perfuracao_inicio);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
/* devolvido ao campo e ainda não reenviado: a mesma regra de situacaoDoDia (js/op_dia.js) e de rdoDevolvidoAberto (js/rdo.js) */
function obfDevolvido(r){ return !!(r && r.devolvido_em && (!r.enviado_em || r.devolvido_em > r.enviado_em)); }

/* O dia conta para a obra? A regra de somar_dias_uteis_obra, mais o início da obra. Comparação exata de UF e de município, como no banco. */
function obfDiaConta(iso, obra, feriados){
  const o = obra || {};
  if(o.data_inicio && iso < String(o.data_inicio).slice(0, 10)) return { conta: false, motivo: "antes_inicio", abrangencia: null };
  const ds = obfDiaSemana(iso);
  if(ds === 0) return { conta: false, motivo: "domingo", abrangencia: null };
  if(ds === 6 && !o.jornada_sabado_entrada) return { conta: false, motivo: "sabado", abrangencia: null };
  const f = (Array.isArray(feriados) ? feriados : []).find(x => x && typeof x === "object" && String(x.data || "").slice(0, 10) === iso && (
    x.abrangencia === "nacional"
    || (x.abrangencia === "uf" && x.uf != null && o.uf != null && x.uf === o.uf)
    || (x.abrangencia === "municipio" && x.codigo_ibge != null && o.codigo_ibge != null && x.codigo_ibge === o.codigo_ibge)));
  if(f) return { conta: false, motivo: "feriado", abrangencia: f.abrangencia };
  return { conta: true, motivo: "", abrangencia: null };
}

/* Os 14 dias, do mais antigo para hoje.
   rdos: linhas de vw_rdo_resumo (id, data, status, equipamento_id, maquina, turno_campo, qtd_estacas_executadas, metragem_total)
         com enviado_em e devolvido_em de rdo; estacasGeo: perfuracao_inicio, rdo_id, situacao de geodigitus_estacas;
   obra: status, data_inicio, uf, codigo_ibge, jornada_sabado_entrada; feriados: data, abrangencia, uf, codigo_ibge. */
function obfMontarDias(hojeISO, rdos, estacasGeo, obra, feriados){
  const hoje = String(hojeISO || "").slice(0, 10);
  if(obfPartes(hoje) == null || hoje !== String(hojeISO)) return [];
  const porDia = new Map(), semDiario = new Map();
  (Array.isArray(rdos) ? rdos : []).forEach(r => {
    if(!r || typeof r !== "object" || !r.data) return;
    const d = String(r.data).slice(0, 10);
    if(!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(r);
  });
  // estaca com diário não avisa; estaca ignorada foi descartada por quem conferiu e nunca terá diário
  (Array.isArray(estacasGeo) ? estacasGeo : []).forEach(g => {
    if(!g || typeof g !== "object" || g.rdo_id || g.situacao === "ignorada") return;
    const d = obfDiaGeo(g);
    if(d) semDiario.set(d, (semDiario.get(d) || 0) + 1);
  });
  const dias = [];
  for(let i = OBF_DIAS - 1; i >= 0; i--){
    const data = obfSomarDias(hoje, -i);
    const diarios = (porDia.get(data) || []).map(r => {
      const finalizado = r.status === "finalizado", devolvido = !finalizado && obfDevolvido(r);
      return { id: r.id ?? null, maquina: r.equipamento_id ? (r.maquina || "?") : null, periodo: r.turno_campo === "noturno" ? "noturno" : "diurno",
        status: finalizado ? "finalizado" : "rascunho", enviado: !finalizado && !!r.enviado_em && !devolvido, devolvido,
        estacas: Number(r.qtd_estacas_executadas) || 0, metros: Number(r.metragem_total) || 0 };
    }).sort((a, b) => (a.maquina == null) - (b.maquina == null) || String(a.maquina || "").localeCompare(String(b.maquina || ""), "pt-BR", { numeric: true })
      || (a.periodo === "noturno") - (b.periodo === "noturno"));
    const estacasSemDiario = semDiario.get(data) || 0;
    const c = obfDiaConta(data, obra, feriados);
    const rascunhos = diarios.filter(x => x.status !== "finalizado");
    let estado, enviadoCampo = false;
    if(estacasSemDiario) estado = "estaca_sem_diario";
    else if(diarios.some(x => x.devolvido)) estado = "devolvido";
    else if(rascunhos.length){ estado = "rascunho"; enviadoCampo = rascunhos.every(x => x.enviado); }
    else if(diarios.length) estado = "finalizado";
    else if(data === hoje) estado = "hoje";
    else if(c.conta) estado = "sem_diario";
    else estado = "nao_conta";
    dias.push({ data, diaSemana: obfDiaSemana(data), hoje: data === hoje, conta: c.conta, motivo: c.motivo, abrangencia: c.abrangencia,
      estado, enviadoCampo, diarios, estacasSemDiario });
  }
  return dias;
}

/* Contagens: hoje fica fora da conta dos dias sem diário (ainda não é falta) */
function obfResumo(dias){
  const l = Array.isArray(dias) ? dias : [], passados = l.filter(d => d.conta && !d.hoje);
  return {
    diasEstacaSemDiario: l.filter(d => d.estacasSemDiario > 0).length,
    estacasSemDiario: l.reduce((t, d) => t + (d.estacasSemDiario || 0), 0),
    diasQueContam: passados.length,
    diasSemDiario: passados.filter(d => !d.diarios.length).length
  };
}
/* As frases do resumo. O aviso é só o da estaca do computador de bordo sem diário; dia sem diário é contagem neutra. */
function obfFrases(r){
  const x = r || {}, n = x.diasSemDiario || 0, m = x.diasQueContam || 0, e = x.diasEstacaSemDiario || 0;
  return {
    aviso: e ? `${obfPlural(e, "dia", "dias")} com estaca do computador de bordo e sem diário` : "",
    contagem: !m ? "Nenhum dia que conta para a obra nas duas semanas, fora hoje."
      : n ? `${obfNumero(n, 0)} de ${obfPlural(m, "dia que conta", "dias que contam")} sem diário nas duas semanas. Se a obra trabalhou nesses dias, falta lançar.`
      : "Diário lançado em todos os dias que contam."
  };
}

/* O estado do dia por extenso, com os diários do dia (texto do title da casa) */
function obfEstadoTexto(d){
  if(d.estado === "estaca_sem_diario") return `${obfPlural(d.estacasSemDiario, "estaca", "estacas")} do computador de bordo sem diário`;
  if(d.estado === "devolvido") return "diário devolvido ao campo, aguardando o reenvio";
  if(d.estado === "rascunho") return d.enviadoCampo ? "enviado pelo campo, a conferir e finalizar" : "diário em rascunho";
  if(d.estado === "finalizado") return "diário finalizado";
  if(d.estado === "sem_diario") return "sem diário, em dia que conta para a obra";
  if(d.estado === "hoje") return "hoje, ainda sem diário";
  return "não conta para a obra: " + (d.motivo === "feriado" ? (OBF_FERIADO[d.abrangencia] || "feriado") : (OBF_MOTIVO[d.motivo] || "dia sem expediente"));
}
function obfTituloDia(d){
  if(!d) return "";
  const linhas = [`${OBF_SEMANA_LONGO[d.diaSemana] || ""}, ${obfDataBR(d.data)}: ${obfEstadoTexto(d)}`];
  (d.diarios || []).forEach(x => linhas.push(`${x.maquina || "sem máquina"} · ${x.periodo === "noturno" ? "noturno" : "diurno"} · ${
    x.status === "finalizado" ? "finalizado" : x.devolvido ? "devolvido ao campo" : x.enviado ? "enviado pelo campo" : "rascunho"} · ${
    obfPlural(x.estacas, "estaca", "estacas")} · ${obfNumero(x.metros)} m`));
  const n = (d.diarios || []).length;
  if(n === 1) linhas.push("Clique para abrir o diário.");
  else if(n > 1) linhas.push(`Clique para ver os ${n} diários do dia na tabela abaixo.`);
  return linhas.join("\n");
}

/* Previsão de término por extenso: o que hoje só está no title do chip do cabeçalho (obrRitmoTitulo e obrSemPrevisaoTitulo,
   js/obras.js), com o que falta e a folga. a = linha de vw_sc_obra_andamento já lida pelo chip; sem linha, não há texto. */
function obfLinhaPrevisao(a, hojeISO){
  if(!a || typeof a !== "object") return null;
  const fe = Number(a.faltam_estacas) || 0, fm = Number(a.faltam_metros) || 0;
  const falta = [];
  if(fe > 0) falta.push(obfPlural(fe, "estaca", "estacas"));
  if(fm > 0) falta.push(`${obfNumero(Math.round(fm), 0)} m`);
  const faltam = falta.length ? `${fe === 1 && falta.length === 1 ? "Falta" : "Faltam"} ${falta.join(" e ")}.` : "";
  if(a.previsao_termino){
    const p = String(a.previsao_termino).slice(0, 10);
    const frases = [];
    if(faltam) frases.push(faltam);
    if(a.folga_dias == null) frases.push("Sem data de fim prevista na obra, não há folga a medir.");
    else {
      const f = Number(a.folga_dias) || 0;
      frases.push(f < 0 ? `${obfPlural(-f, "dia", "dias")} de atraso sobre o fim previsto da obra.`
        : f === 0 ? "Termina no fim previsto da obra, sem sobra." : `${obfPlural(f, "dia", "dias")} de folga até o fim previsto da obra.`);
    }
    const ritmo = typeof obrRitmoTitulo === "function" ? obrRitmoTitulo(a) : "";
    if(ritmo) frases.push(ritmo + ".");
    frases.push("A conta: metros que faltam ÷ ritmo, em dias úteis da obra (sem domingo, feriado e sábado sem jornada).");
    return { temPrevisao: true, titulo: `Termina por volta de ${obfDiaMes(p)}${p.slice(0, 4) !== String(hojeISO || "").slice(0, 4) ? "/" + p.slice(0, 4) : ""}`, frases };
  }
  if(a.sem_previstas && !fm) return { temPrevisao: false, titulo: "Sem previsão de término", frases: ["Sem estacas previstas: informe a meta na aba Parâmetros."] };
  if(!fe && !fm) return { temPrevisao: false, titulo: "Sem previsão de término", frases: ["Nada faltando pela conta da obra."] };
  const porque = typeof obrSemPrevisaoTitulo === "function" ? obrSemPrevisaoTitulo(a) : "";
  return { temPrevisao: false, titulo: "Sem previsão de término", frases: [faltam, porque ? porque + "." : ""].filter(Boolean) };
}

/* ---------- HTML ---------- */
function obfCasaHTML(d){
  const n = d.diarios.length;
  const curto = d.estado === "rascunho" && d.enviadoCampo ? "do campo" : d.estado === "nao_conta" && d.motivo === "feriado" ? "feriado" : OBF_CURTO[d.estado];
  const classes = `obf-dia obf-${esc(d.estado)}${d.hoje ? " obf-eh-hoje" : ""}`;
  // o contador de diários fica na linha do dia, depois do número: no fluxo, nunca por cima do texto da casa
  const miolo = `<span class="obf-dia-topo"><span class="obf-dia-sem">${esc(OBF_SEMANA[d.diaSemana])}</span><span class="obf-dia-num">${esc(d.data.slice(8, 10))}</span>${
    n > 1 ? `<span class="obf-dia-qtd" aria-hidden="true">${esc(n)}</span>` : ""}</span><span class="obf-dia-est">${esc(curto)}</span>`;
  const titulo = obfTituloDia(d);
  if(!n) return `<div class="${/* html */ classes}" title="${esc(titulo)}">${/* html */ miolo}</div>`;
  return `<button type="button" class="${/* html */ classes}" data-obf-dia="${esc(d.data)}"${n === 1 && d.diarios[0].id != null ? ` data-obf-rdo="${esc(d.diarios[0].id)}"` : ' aria-pressed="false"'} title="${esc(titulo)}">${/* html */ miolo}</button>`;
}
function obfFaixaHTML(dias){
  if(!Array.isArray(dias) || !dias.length) return "";
  return `<div class="obf-faixa" role="group" aria-label="Diário da obra nos últimos 14 dias">${dias.map(d => obfCasaHTML(d)).join("")}</div>`;
}
function obfLegendaHTML(){
  return `<p class="obf-legenda">${OBF_LEGENDA.map(l => `<span class="obf-leg"><span class="obf-leg-cor obf-${esc(l[0])}" aria-hidden="true"></span>${esc(l[1])}</span>`).join("")}</p>`;
}
/* Corpo do bloco: faixa, legenda e resumo (ou só o aviso, na obra sem nenhum diário), a previsão e o que não deu para ler */
function obfCorpoHTML(dias, o){
  const f = obfFrases(obfResumo(dias)), partes = [];
  const aviso = f.aviso ? `<span class="tag ambar" title="As estacas estão em Diário de Obra › Chegadas do Geodigitus: procure pelo código da obra e lance ou vincule o diário.">${esc(f.aviso)}</span> ` : "";
  if(!o.semRdo){
    partes.push(obfFaixaHTML(dias), obfLegendaHTML(),
      `<p class="obf-nota" id="obf-filtro-dia" hidden><span></span> <button type="button" class="btn-sec btn-sm" id="obf-filtro-limpar" title="Volta a mostrar todos os diários na tabela">Mostrar todos</button></p>`,
      `<p class="obf-resumo">${/* html */ aviso}${esc(f.contagem)}</p>`);
  } else if(aviso) partes.push(`<p class="obf-resumo">${/* html */ aviso}</p>`);
  if(o.previsao) partes.push(`<p class="obf-previsao"><strong>${esc(o.previsao.titulo)}</strong> ${esc(o.previsao.frases.join(" "))}</p>`);
  if(o.erros && o.erros.length) partes.push(`<p class="meta">Não foi possível ler ${esc(o.erros.join("; "))}.</p>`);
  return partes.join("");
}

/* ---------- tela ---------- */
let _obfSeq = 0;          // só a última leitura desenha
let _obfDiaFiltro = "";   // dia em que a tabela de diários está filtrada pelo clique na faixa ("" = todos)

const obfObraAtiva = (obra) => !!obra && (obra.status === "em_andamento" || obra.status === "paralisada");
function obfObraDaFicha(obraId){
  return typeof _obrAberta !== "undefined" && _obrAberta && obraId && _obrAberta.id === obraId ? _obrAberta : null;
}

/* Lugar do bloco no topo da aba RDOs. Obra que não está em andamento nem paralisada não tem faixa; sem nenhum diário, a
   explicação de onde o diário nasce entra no lugar dela. o = { semRdo, filtro (código da máquina filtrada) } */
function obfReservaHTML(obraId, o){
  const semRdo = !!(o && o.semRdo);
  if(!obfObraAtiva(obfObraDaFicha(obraId))) return semRdo ? `<div class="obf-solto">${uiVazio(OBF_VAZIO_SEM_RDO)}</div>` : "";
  const hoje = hojeISO();
  const extra = `${obfDiaMes(obfSomarDias(hoje, -(OBF_DIAS - 1)))} a ${obfDiaMes(hoje)}${o && o.filtro ? " · só " + o.filtro : ""}`;
  const corpo = `${semRdo ? uiVazio(OBF_VAZIO_SEM_RDO) : ""}<div id="obf-corpo">${semRdo ? "" : uiVazio("Carregando os últimos 14 dias…")}</div>`;
  return `<div class="obf-bloco" id="obf-bloco">${uiSecao("relogio", "Últimos 14 dias", corpo, extra)}</div>`;
}

/* As três leituras novas, por obra e pela janela de 14 dias (poucas linhas: nenhuma chega perto do corte de 1.000), e a
   previsão que o chip do cabeçalho já leu. Erro de leitura nunca derruba a aba: volta em { error } e a tela diz o que faltou. */
let _obfFeriados = { janela: "", lido: null };   // os feriados da janela valem para todas as obras: uma leitura por dia de uso
async function obfLer(obraId, hoje, comDiarioNaJanela){
  const ini = obfSomarDias(hoje, -(OBF_DIAS - 1));
  const seguro = (p) => Promise.resolve(p).then(r => r || { data: null, error: null }, e => ({ data: null, error: e }));
  const guardado = _obfFeriados.janela === ini + "|" + hoje ? _obfFeriados.lido : null;
  const [campo, geo, feriados, previsao] = await Promise.all([
    // os envios do campo só interessam quando há diário na janela
    seguro(comDiarioNaJanela ? sb.from("rdo").select("id,data,enviado_em,devolvido_em").eq("obra_id", obraId).gte("data", ini).lte("data", hoje) : null),
    // só a estaca que ainda não está em diário (é a que avisa); o início da janela é a meia-noite de Brasília
    seguro(sb.from("geodigitus_estacas").select("perfuracao_inicio,rdo_id,equipamento_id,situacao").eq("obra_id", obraId).is("rdo_id", null).gte("perfuracao_inicio", `${ini}T00:00:00-03:00`)),
    seguro(guardado || sb.from("feriados").select("data,abrangencia,uf,codigo_ibge").gte("data", ini).lte("data", hoje)),
    seguro(typeof obrPrevisaoLida === "function" ? obrPrevisaoLida(obraId) : null)
  ]);
  if(!feriados.error) _obfFeriados = { janela: ini + "|" + hoje, lido: feriados };
  return { campo, geo, feriados, previsao };
}

/* Desenha o bloco reservado por obfReservaHTML. o = { rdos (vw_rdo_resumo da obra, já no filtro de máquina), semRdo, filtroMaq } */
async function obfPreencher(obraId, o){
  const seq = ++_obfSeq;
  _obfDiaFiltro = "";
  const obra = obfObraDaFicha(obraId);
  if(!$("obf-corpo") || !obfObraAtiva(obra)) return;
  const hoje = hojeISO(), op = o || {}, ini = obfSomarDias(hoje, -(OBF_DIAS - 1));
  const lido = await obfLer(obraId, hoje, (op.rdos || []).some(r => r && r.data >= ini && String(r.data).slice(0, 10) <= hoje));
  const corpo = $("obf-corpo");
  if(seq !== _obfSeq || !corpo || typeof obraEditId === "undefined" || obraId !== obraEditId) return;
  const erros = [];
  if(lido.campo.error){ console.error("Faixa do diário, envio do campo:", lido.campo.error); erros.push("os envios do campo (diário enviado ou devolvido aparece como rascunho)"); }
  if(lido.geo.error){ console.error("Faixa do diário, estacas do Geodigitus:", lido.geo.error); erros.push("as estacas do computador de bordo (o aviso de estaca sem diário não foi conferido)"); }
  if(lido.feriados.error){ console.error("Faixa do diário, feriados:", lido.feriados.error); erros.push("os feriados (feriado pode aparecer como dia sem diário)"); }
  const carimbo = new Map((lido.campo.data || []).map(r => [r.id, r]));
  const rdos = (op.rdos || []).map(r => ({ ...r, enviado_em: carimbo.get(r.id)?.enviado_em ?? null, devolvido_em: carimbo.get(r.id)?.devolvido_em ?? null }));
  const geo = (lido.geo.data || []).filter(g => !op.filtroMaq ? true : op.filtroMaq === "sem" ? !g.equipamento_id : g.equipamento_id === op.filtroMaq);
  const dias = obfMontarDias(hoje, rdos, geo, obra, lido.feriados.data || []);
  // previsão: a view só traz obra em andamento; na paralisada a linha diz isso, e erro de leitura não vira texto
  let previsao = lido.previsao.error ? null : obfLinhaPrevisao(lido.previsao.data, hoje);
  if(!previsao && !lido.previsao.error && obra.status === "paralisada") previsao = { temPrevisao: false, titulo: "Sem previsão de término", frases: ["A previsão só é calculada para obra em andamento."] };
  corpo.innerHTML = obfCorpoHTML(dias, { semRdo: !!op.semRdo, previsao, erros });
  corpo.addEventListener("click", obfClique);
}
/* Clique na faixa: um diário abre o RDO; vários filtram a tabela de baixo naquele dia; nenhum não faz nada */
function obfClique(ev){
  if(ev.target.closest("#obf-filtro-limpar")){ obfFiltrarTabela(""); return; }
  const b = ev.target.closest("button.obf-dia");
  if(!b) return;
  if(b.dataset.obfRdo){ if(typeof abrirRdoExistente === "function") abrirRdoExistente(b.dataset.obfRdo); return; }
  obfFiltrarTabela(b.dataset.obfDia === _obfDiaFiltro ? "" : b.dataset.obfDia);
}
/* Mostra na tabela de diários só as linhas do dia (sem reler o banco); "" volta a mostrar todas */
function obfFiltrarTabela(dia){
  const cont = $("obr-rdo-conteudo");
  if(!cont) return;
  _obfDiaFiltro = dia || "";
  let n = 0;
  cont.querySelectorAll("tr.linha-clicavel[data-dia]").forEach(tr => {
    const fora = !!_obfDiaFiltro && tr.dataset.dia !== _obfDiaFiltro;
    tr.style.display = fora ? "none" : "";
    if(!fora) n++;
  });
  cont.querySelectorAll("button.obf-dia").forEach(b => {
    const sel = !!_obfDiaFiltro && b.dataset.obfDia === _obfDiaFiltro;
    b.classList.toggle("obf-sel", sel);
    if(b.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", sel ? "true" : "false");
  });
  const nota = $("obf-filtro-dia");
  if(!nota) return;
  nota.hidden = !_obfDiaFiltro;
  const txt = nota.querySelector("span");
  if(txt) txt.textContent = !_obfDiaFiltro ? "" : n ? `Tabela abaixo só com ${obfPlural(n, "diário", "diários")} de ${obfDataBR(_obfDiaFiltro)}.`
    : `Nenhum diário de ${obfDataBR(_obfDiaFiltro)} na tabela com o filtro de período ligado.`;
}

// teste em Node (scripts/testar-fase163.mjs): as funções puras também saem por module.exports
if(typeof module === "object" && module && module.exports){
  module.exports = { OBF_DIAS, OBF_VAZIO_SEM_RDO, obfSomarDias, obfDiaSemana, obfDiaGeo, obfDevolvido, obfDiaConta, obfMontarDias, obfResumo, obfFrases,
    obfTituloDia, obfLinhaPrevisao, obfCasaHTML, obfFaixaHTML, obfLegendaHTML, obfCorpoHTML };
}

















function rdoDataMeioDia(iso){
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null;
}

function rdoDataFrase(iso){
  const d = rdoDataMeioDia(iso);
  return d ? new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d) : "";
}

function rdoDataCurta(iso){
  const d = rdoDataMeioDia(iso);
  if(!d) return "—";
  const p = {};
  new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).formatToParts(d).forEach(x => { p[x.type] = x.value.replace(/\./g, ""); });
  return `${p.day} ${p.month} · ${p.weekday}`;
}

function rdoHoraParede(v){
  const m = String(v == null ? "" : v).match(/(?:T|^)(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}
function rdoMinParede(v){ const h = rdoHoraParede(v); return h ? +h.slice(0, 2) * 60 + +h.slice(3) : null; }
const rdoUmaCasa = (n) => num(Math.round(Number(n || 0) * 10) / 10);



function rdoResumoKpis(execs, tipo, paradas){
  const xs = execs || [], ps = paradas || [];
  const metros = xs.reduce((s, e) => s + (Number(e.profundidade_executada) || 0), 0);
  const comMetro = xs.filter(e => Number(e.profundidade_executada) > 0).length;
  const refuradas = xs.filter(e => e.modalidade_execucao === "refuro").length;
  let m3 = null, m3Rotulo = "Concreto (m³)", m3Contexto = "";
  if(tipo === "estaca_raiz"){
    const t = rdoTotaisInjecao(xs);
    m3Rotulo = "Injeção (m³)";
    m3 = t.temVol ? t.vol : null;
    m3Contexto = t.temVol ? "volume injetado no dia" : "sem volume lançado";
  } else {
    const com = xs.filter(e => e.volume_concreto_m3 != null && e.volume_concreto_m3 !== "");
    m3 = com.length ? com.reduce((s, e) => s + (Number(e.volume_concreto_m3) || 0), 0) : null;
    m3Contexto = com.length ? `${com.length} de ${xs.length} com volume` : "sem volume lançado";
  }
  const horasParadas = ps.reduce((s, p) => s + (Number(p.horas_paradas) || 0), 0);

  const sp = paradaSomar(ps);
  return { estacas: xs.length, comMetro, refuradas, metros, m3, m3Rotulo, m3Contexto, paradas: ps.length, horasParadas,
    horasCliente: sp.cliente, paradasSemResposta: sp.semResposta };
}

function rdoResumoParadasTxt(k){
  if(!k || !k.paradas) return "nenhuma registrada";
  return [`${num(k.horasParadas)} h paradas`, k.horasCliente ? `${num(k.horasCliente)} h em razão do cliente` : "",
    k.paradasSemResposta ? `${num(k.paradasSemResposta)} sem resposta` : ""].filter(Boolean).join(" · ");
}

function rdoResumoAtividades(execs, tipo){
  const rotulo = (typeof TIPO_SERVICO === "object" && TIPO_SERVICO[tipo] && TIPO_SERVICO[tipo].label) || "Estaca";
  const grupos = new Map();
  (execs || []).forEach(e => {
    const refuro = e.modalidade_execucao === "refuro";
    const chave = `${refuro ? "r" : "n"}|${e.diametro_mm == null ? "" : e.diametro_mm}`;
    const g = grupos.get(chave) || { refuro, diam: Number(e.diametro_mm) || null, n: 0, metros: 0, comMetro: 0, nomes: [] };
    const m = Number(e.profundidade_executada) || 0;
    g.n++; g.metros += m; if(m > 0) g.comMetro++;
    const nome = String(e.estaca_numero || "").trim();
    if(nome && !g.nomes.includes(nome)) g.nomes.push(nome);
    grupos.set(chave, g);
  });
  return [...grupos.values()].sort((a, b) => (a.refuro - b.refuro) || ((a.diam || 0) - (b.diam || 0))).map(g => {
    const nomes = g.nomes.slice(0, 6).join(", ") + (g.nomes.length > 6 ? ` e mais ${g.nomes.length - 6}` : "");
    return {
      titulo: `${g.refuro ? "Refurada" : rotulo}${g.diam ? ` Ø${g.diam} mm` : " (sem diâmetro)"}`,
      sub: [`${g.n} ${g.n === 1 ? "estaca" : "estacas"}`, nomes, g.comMetro ? `média ${rdoUmaCasa(g.metros / g.comMetro)} m` : "sem metragem lançada"].filter(Boolean).join(" · "),
      valor: num(g.metros), unidade: "m", n: g.n, metros: g.metros, refuro: g.refuro, diam: g.diam
    };
  });
}


function rdoResumoTimeline(atividades, paradas, turno){
  const ordem = (v) => { const x = rdoMinParede(v); return x == null ? 99999 : (turno === "noturno" && x < 720 ? x + 1440 : x); };
  const itens = [];
  (atividades || []).forEach(a => {
    if(!a || (!a.motivo && !a.h_inicial)) return;
    itens.push({ tipo: "atividade", ini: rdoHoraParede(a.h_inicial), fim: rdoHoraParede(a.h_final), texto: String(a.motivo || "").trim(), o: ordem(a.h_inicial) });
  });
  (paradas || []).forEach(p => {
    if(!p) return;
    const motivo = (typeof RDO_MOTIVO_PARADA === "object" && RDO_MOTIVO_PARADA[p.motivo]) || p.tipo || "sem motivo";
    itens.push({ tipo: "parada", ini: rdoHoraParede(p.periodo_inicio), fim: rdoHoraParede(p.periodo_fim), aberta: !!(p.periodo_inicio && !p.periodo_fim),
      texto: `${motivo}${p.descricao ? ": " + String(p.descricao).trim() : ""}`, horas: p.horas_paradas == null ? null : Number(p.horas_paradas), o: ordem(p.periodo_inicio),
      cliente: p.em_razao_cliente === true });
  });
  return itens.sort((x, y) => x.o - y.o);
}

function rdoResumoEquipe(equipe, funcs){
  return (equipe || []).filter(e => e && (e.funcionario_id || (e.nome_avulso && String(e.nome_avulso).trim()))).map(e => {
    const f = (funcs || []).find(x => x.id === e.funcionario_id) || {};
    const st = typeof rdoStatusDia === "function" ? rdoStatusDia(e.status_dia) : null;
    const ent = rdoHoraParede(e.hora_entrada), sai = rdoHoraParede(e.hora_saida);
    return { nome: f.nome || e.nome_avulso || "?", funcao: e.funcao_no_dia || f.funcao || "", horario: ent && sai ? `${ent} – ${sai}` : ent,
      situacao: st ? st.l : "", ausente: !!(st && st.aus), he: Number(e.horas_100) || 0 };
  });
}

function rdoResumoAssinaturas(cab, status, fotos, nomeDe){
  const devolvido = !!(cab && cab.devolvido_em && (!cab.enviado_em || cab.devolvido_em > cab.enviado_em));
  const enviado = !!(cab && cab.enviado_em) && !devolvido;
  const boletim = (fotos || []).find(f => f.tipo === "boletim_assinado" && !f.desconsiderada_motivo) || null;
  const quem = typeof nomeDe === "function" ? nomeDe : (() => "usuário do campo");
  return [
    { papel: "Encarregado", ok: enviado, boletim: boletim ? boletim.storage_path : null,
      texto: enviado ? `Enviado pelo app do campo ${rdoHoraCampo(cab.enviado_em, cab.data)} por ${quem(cab.enviado_por)}${boletim ? "" : ". Sem foto do boletim assinado."}`
        : devolvido ? "Devolvido ao campo: espera o operador corrigir e enviar de novo." : "Pendente: o diário não foi enviado pelo app do campo." },
    { papel: "Engenharia", ok: status === "finalizado",
      texto: status === "finalizado" ? `Finalizado${cab && cab.updated_at ? ". Última alteração em " + dataHoraBR(cab.updated_at) : ""}.` : "Pendente: o diário está em rascunho." },
    { papel: "Cliente", ok: false, texto: "Pendente: a formalização com o cliente é feita na medição." }
  ];
}


function rdoResumoHTML(d){
  const k = rdoResumoKpis(d.execs, d.tipo, d.paradas);
  const ativ = rdoResumoAtividades(d.execs, d.tipo);
  const tl = rdoResumoTimeline(d.atividades, d.paradas, d.turno);
  const eq = rdoResumoEquipe(d.equipe, d.funcs);
  const ass = rdoResumoAssinaturas(d.cab, d.status, d.fotos, d.nomeDe);

  const climaTxt = (v) => (typeof climaOpcaoRotulo === "function" ? climaOpcaoRotulo(v) : "") || (typeof CONDICAO_TEMPO === "object" && CONDICAO_TEMPO[v]) || "";
  const periodo = d.mostraPeriodo ? (d.turno === "noturno" ? "Noturno" : "Diurno") : "";
  const codigo = ["RDO", d.dataISO || "sem data", d.maquina && d.maquina.codigo, periodo].filter(Boolean).join(" · ");
  const climaCurto = [climaTxt(d.climaManha), climaTxt(d.climaTarde)].filter(Boolean).join(" / ");


  const doc = `<section class="ui-secao rdo-res-doc">
    <div class="rdo-res-doc-topo">
      <div class="rdo-res-doc-id">
        ${  uiCodigo(codigo)}
        <h3 class="rdo-res-titulo">Diário de obra${d.dataISO ? " — " + esc(rdoDataFrase(d.dataISO)) : ""}</h3>
        <div class="rdo-res-obra">${  d.obraHTML || "—"}</div>
      </div>
      <div class="rdo-res-datas">${d.cab && d.cab.created_at ? `Criado em ${esc(dataHoraBR(d.cab.created_at))}` : "Diário ainda não salvo"}${d.cab && d.cab.updated_at ? `<br>Modificado em ${esc(dataHoraBR(d.cab.updated_at))}` : ""}</div>
    </div>
    <div class="rdo-res-rv">
      ${  uiRotuloValor("Responsável", esc(d.responsavel || "não informado"))}
      ${  uiRotuloValor("Máquina", d.maquina ? esc(d.maquina.codigo) : '<span class="tag ambar">sem máquina</span>')}
      ${  uiRotuloValor("Local / frente", esc(d.local || "não informado"))}
      ${  uiRotuloValor("Clima", esc(climaCurto || "não informado"))}
      ${  d.dia ? uiRotuloValor("Dia", `${  tagStatus("rdo_dia", d.dia.estado)}${d.dia.motivo && typeof rdoDiaMotivoTexto === "function" ? " " + esc(rdoDiaMotivoTexto(d.dia)) : ""}`) : ""}
    </div>
  </section>`;

  const kpis = `<div class="ui-kpis rdo-res-kpis">
    ${  uiKpi(String(k.estacas), "Estacas no dia", k.refuradas ? `${k.refuradas} ${k.refuradas === 1 ? "Refurada" : "Refuradas"}` : (k.estacas ? "nenhuma Refurada" : "nenhuma execução lançada"))}
    ${  uiKpi(num(k.metros), "Metragem (m)", k.comMetro ? `média ${rdoUmaCasa(k.metros / k.comMetro)} m por estaca com metragem` : (k.estacas ? "sem metragem lançada" : ""))}
    ${  uiKpi(k.m3 == null ? "—" : num(k.m3), k.m3Rotulo, k.m3Contexto)}
    ${  uiKpi(String(k.paradas), "Paradas", rdoResumoParadasTxt(k))}
  </div>`;


  const injecao = d.tipo === "estaca_raiz" ? rdoTotaisInjecaoTxt(rdoTotaisInjecao(d.execs)) : [];
  const secAtiv = uiSecao("check", "Atividades executadas",
    (ativ.length ? ativ.map(a => uiLinhaItem(a.titulo, a.sub, a.valor, a.unidade)).join("") : uiVazio("Nenhuma execução lançada neste diário."))
    + (injecao.length ? uiLinhaItem("Injeção do dia", injecao.map(([rot, v]) => `${rot} ${v}`).join(" · "), "", "") : "")
    + (ativ.length ? `<p class="rdo-res-rodape"><button type="button" class="ui-link" data-rdo-ir-aba="execucoes">ver estaca a estaca →</button></p>` : ""),
    k.estacas ? `${k.estacas} ${k.estacas === 1 ? "estaca" : "estacas"} · ${num(k.metros)} m` : "");

  const pessoa = (p) => `<div class="rdo-res-pessoa${p.ausente ? " ausente" : ""}">${  uiAvatar(p.nome)}<div class="rdo-res-pessoa-txt"><strong>${esc(p.nome)}</strong><span>${esc(p.funcao || "função não informada")}</span></div><div class="rdo-res-hora">${p.situacao ? `<span class="tag ${p.ausente ? "cinza" : "azul"}">${esc(p.situacao)}</span> ` : ""}${esc(p.horario || (p.situacao ? "" : "sem horário"))}</div></div>`;
  const he = eq.reduce((s, p) => s + p.he, 0);
  const secEquipe = uiSecao("equipe", "Equipe presente",
    eq.length ? eq.slice(0, 4).map(pessoa).join("") + (eq.length > 4 ? `<details class="rdo-res-mais"><summary>+${eq.length - 4} ${eq.length - 4 === 1 ? "outro" : "outros"}</summary>${  eq.slice(4).map(pessoa).join("")}</details>` : "")
      : uiVazio("Nenhuma pessoa lançada na equipe deste diário."),
    eq.length ? `${eq.length} ${eq.length === 1 ? "pessoa" : "pessoas"}${he ? ` · ${num(he)} h extras` : ""}` : "");

  const nFotos = (d.fotos || []).length;
  const secFotos = uiSecao("foto", "Registros fotográficos",
    `<div id="rdo-resumo-fotos">${  nFotos ? uiVazio("Carregando as fotos…") : uiVazio("Nenhuma foto enviada pelo app do campo neste diário.")}</div>`,
    nFotos ? `${nFotos} ${nFotos === 1 ? "foto" : "fotos"}` : "");

  const linhaTl = (t) => `<li class="${t.tipo === "parada" ? "parada" : ""}"><time>${esc(t.ini || "—")}${t.fim ? "–" + esc(t.fim) : ""}</time><div>${t.tipo === "parada" ? `<span class="tag ambar">parada${t.horas != null ? " · " + num(t.horas) + " h" : t.aberta ? " · em andamento" : ""}${t.cliente ? " · em razão do cliente" : ""}</span> ` : ""}${esc(t.texto || "sem descrição")}</div></li>`;
  const obs = String(d.obs || "").trim();
  const secOcorr = uiSecao("relogio", "Ocorrências e observações",
    (tl.length ? `<ol class="rdo-res-tl">${  tl.map(linhaTl).join("")}</ol>` : uiVazio("Nenhuma atividade ou parada lançada neste diário."))
    + (obs ? `<div class="rdo-res-obs"><span class="rotulo-caps">Observações</span><p>${esc(obs)}</p></div>` : ""),
    tl.length ? `${tl.length} ${tl.length === 1 ? "registro" : "registros"}` : "");




  const ca = (d.cab && d.cab.clima_auto) || null;
  const notaClima = (per, v) => {
    const a = ca && ca[per];
    if(v && a && a.valor === v)
      return `<span class="meta" title="Preenchido sozinho pela Open-Meteo na localização da obra: ${esc(num(a.chuva_mm))} mm de chuva e ${esc(String(a.nuvens_pct))}% de nuvens no período. Pode ser trocado no campo Tempo da ficha.">automático · Open-Meteo</span>`;
    if(!v && ca && ca.erro === "sem_local")
      return '<span class="meta" title="O clima é preenchido sozinho quando a obra tem cidade e UF no cadastro ou estacas do Geodigitus com GPS">sem localização da obra</span>';
    return "";
  };
  const climaDet = (v, per) => { const t = typeof climaDetalhe === "function" ? climaDetalhe(v, ca && ca[per]) : ""; return t ? `<span class="meta">${esc(t)}</span>` : ""; };
  const clima = (rot, v, per) => `<div><span class="rotulo-caps">${esc(rot)}</span><strong>${esc(climaTxt(v) || "não informado")}</strong>${  climaDet(v, per)}${  notaClima(per, v)}</div>`;
  const secClima = uiSecao("clima", "Clima e condições", `<div class="rdo-res-clima${d.climaManha || d.climaTarde ? "" : " vazio"}">${  clima("Manhã", d.climaManha, "manha")}${  clima("Tarde", d.climaTarde, "tarde")}</div>`);

  const maqs = [d.maquina ? uiLinhaItem(d.maquina.codigo, d.maquina.nome || "máquina do diário", "", "") : ""]
    .concat((d.apoio || []).map(m => uiLinhaItem(m.codigo, (m.nome ? m.nome + " · " : "") + "também lançada nas execuções", "", ""))).join("");
  const secMaq = uiSecao("maquina", "Equipamentos em uso", maqs || uiVazio("Diário sem máquina informada."));

  const linhaAss = (a) => `<div class="rdo-res-ass"><span class="rdo-res-ass-marca ${a.ok ? "ok" : "pend"}" aria-hidden="true">${a.ok ? "✓" : "…"}</span><div><strong>${esc(a.papel)}</strong><span>${esc(a.texto)}</span>${a.boletim ? ` <button type="button" class="ui-link" data-rdo-ir-aba="fotos">ver a foto do boletim assinado</button>` : ""}</div></div>`;
  const secAss = uiSecao("assinatura", "Assinaturas", ass.map(linhaAss).join(""), `${ass.filter(a => a.ok).length} de ${ass.length}`);

  return `<div class="rdo-resumo">${  doc}${  kpis}
    <div class="rdo-res-grade">
      <div class="rdo-res-col">${  secAtiv}${  secEquipe}${  secFotos}${  secOcorr}</div>
      <div class="rdo-res-col">${  secClima}${  secMaq}${  secAss}</div>
    </div></div>`;
}


function renderRdoResumo(){
  const cont = $("rdo-resumo");
  if(!cont) return;
  const cab = rdoEditId ? (_rdoCampo.rdo || null) : null;
  const tipo = $("rdo-tipo-servico")?.value || cab?.tipo_servico || "";
  const turno = $("rdo-turno")?.value || cab?.turno_campo || "diurno";
  const eqId = $("rdo-equipamento")?.value || cab?.equipamento_id || null;
  const obraId = $("rdo-obra")?.value || cab?.obra_id || null;
  const maq = eqId ? (_rdoEquipsCache.find(q => q.id === eqId) || null) : null;
  const apoio = [...new Set((_rdoExecucoes || []).map(e => e.equipamento_id).filter(id => id && id !== eqId))]
    .map(id => _rdoEquipsCache.find(q => q.id === id)).filter(Boolean);
  const selResp = $("rdo-responsavel");
  cont.innerHTML = rdoResumoHTML({
    cab, tipo, turno, status: $("rdo-status")?.value || cab?.status || "rascunho",
    dataISO: ($("rdo-data")?.value || cab?.data || "").slice(0, 10),
    mostraPeriodo: !!(_rdoObraParams && _rdoObraParams.dois_turnos) || turno === "noturno",
    obraHTML: obraId ? linkObra(obraId) : "",
    maquina: maq, apoio,
    responsavel: selResp && selResp.value ? (selResp.selectedOptions[0]?.textContent || "").trim() : "",
    local: $("rdo-local")?.value || "",

    climaManha: (typeof rdoClimaValor === "function" ? rdoClimaValor("rdo-tempo-manha") : $("rdo-tempo-manha")?.value) || "",
    climaTarde: (typeof rdoClimaValor === "function" ? rdoClimaValor("rdo-tempo-tarde") : $("rdo-tempo-tarde")?.value) || "",
    dia: rdoEditId && typeof _rdoDia !== "undefined" ? _rdoDia : null,
    execs: _rdoExecucoes || [], equipe: _rdoEquipe || [], funcs: _rdoFuncs || [], atividades: _rdoAtividades || [],
    paradas: rdoEditId ? (_rdoCampo.paradas || []) : [], fotos: rdoEditId ? (_rdoCampo.fotos || []) : [],
    obs: $("rdo-obs")?.value || "", nomeDe: rdoNomeCampo
  });
  rdoResumoCarregarFotos();
}

function rdoResumoAtualizar(){
  if(document.querySelector('#rdo-notebook button[data-tab="resumo"].ativo')) renderRdoResumo();
}

async function rdoResumoCarregarFotos(){
  const cont = $("rdo-resumo-fotos");
  const fs = rdoEditId ? (_rdoCampo.fotos || []) : [];
  if(!cont || !fs.length) return;
  const id = rdoEditId, enviadas = fs.filter(f => f.enviada);
  const urls = {};
  if(enviadas.length){
    const { data } = await sb.storage.from("rdo-fotos").createSignedUrls(enviadas.map(f => f.storage_path), 3600);
    (data || []).forEach(u => { if(u.signedUrl) urls[u.path] = u.signedUrl; });
  }
  const alvo = $("rdo-resumo-fotos");
  if(rdoEditId !== id || !alvo) return;
  alvo.innerHTML = `<div class="rdo-res-fotos">${  fs.map(f => {
    const url = urls[f.storage_path], tipo = RDO_FOTO_TIPO[f.tipo] || f.tipo || "Foto";
    return `<figure class="${f.desconsiderada_motivo ? "descons" : ""}">${url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="Abrir a foto em tamanho real"><img src="${esc(url)}" alt="${esc(tipo + (f.legenda ? ": " + f.legenda : ""))}" loading="lazy" /></a>`
      : `<div class="falta">${f.enviada ? "sem acesso ao arquivo" : "aguardando o envio do celular"}</div>`}<figcaption><span class="tag cinza">${esc(tipo)}</span></figcaption></figure>`;
  }).join("")}</div><p class="rdo-res-rodape"><button type="button" class="ui-link" data-rdo-ir-aba="fotos">ver todas na aba Fotos →</button></p>`;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest ? e.target.closest("#rdo-resumo [data-rdo-ir-aba]") : null;
  if(b && typeof ativarTabRDO === "function") ativarTabRDO(b.dataset.rdoIrAba);
});
